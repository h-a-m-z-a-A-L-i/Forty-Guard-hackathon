/**
 * Credibility checks — each answers one of the user's questions:
 *
 *  1. plausibility  — is the data physically sane? (temps in range, cells > 0, sane distances)
 *  2. optimality    — is the "optimized" route actually the coolest of the alternatives?
 *  3. realTime      — does the returned data correspond to the hour we asked for, and is it fresh?
 *  4. groundTruth   — do temperatures agree with an independent source (Open-Meteo)?
 *  5. consistency   — same request twice → same corridor and same temperatures (raw API, no cache)
 *
 * Every check returns { pass, detail: [strings...] }. A scenario passes if
 * all checks pass. NOTE: groundTruth tolerance is generous (12°C) because
 * FortyGuard = road-surface temp vs Open-Meteo = air temp; the REPORT
 * surfaces the actual delta so the reader can judge the spread.
 */

const GROUND_TRUTH_TOLERANCE_C = 12;
const CONSISTENCY_TEMP_TOLERANCE_C = 0.5;

function checkPlausibility(routeResults, feelsLike) {
  const detail = [];
  let pass = true;
  for (const r of routeResults) {
    if (r.error) { detail.push(`route ${r.routeId}: ERROR ${r.error}`); pass = false; continue; }
    if (r.avgTemp == null || !Number.isFinite(r.avgTemp)) { detail.push(`route ${r.routeId}: no avg temperature returned`); pass = false; continue; }
    if (r.avgTemp < -30 || r.avgTemp > 60) { detail.push(`route ${r.routeId}: avg temp ${r.avgTemp}°C outside physical range [-30,60]`); pass = false; }
    if (r.maxTemp != null && (r.maxTemp < r.avgTemp)) { detail.push(`route ${r.routeId}: max ${r.maxTemp}°C < avg ${r.avgTemp}°C (impossible)`); pass = false; }
    if (r.nCells === 0) { detail.push(`route ${r.routeId}: n_cells = 0 — FortyGuard may not have data for this corridor/hour`); pass = false; }
    if (r.distanceMeters < 50 || r.distanceMeters > 500000) { detail.push(`route ${r.routeId}: distance ${r.distanceMeters}m outside sane range`); pass = false; }
    if (r.corridorRings === 0) { detail.push(`route ${r.routeId}: empty corridor polygon`); pass = false; }
  }
  // env_params returns arrays of readings (e.g. [25.7]) — unwrap to the first
  // value. Only the 3 fields the app displays are required to be sane; the
  // extra fields (air quality, co2, …) are bonus and may be "N/A" strings.
  if (feelsLike) {
    const unwrap = v => (Array.isArray(v) ? v[0] : v);
    const used = ['heat_index_celsius', 'apparent_temperature_celsius', 'relative_humidity_percent'];
    for (const k of used) {
      const v = unwrap(feelsLike[k]);
      if (v == null) { detail.push(`feels-like ${k} missing`); pass = false; continue; }
      const n = Number(v);
      if (!Number.isFinite(n)) { detail.push(`feels-like ${k} is not a number (${JSON.stringify(v)})`); pass = false; }
      else if (k === 'relative_humidity_percent' && (n < 0 || n > 100)) { detail.push(`relative humidity ${n}% out of range [0,100]`); pass = false; }
    }
    const hi = Number(unwrap(feelsLike.heat_index_celsius));
    const at = Number(unwrap(feelsLike.apparent_temperature_celsius));
    if (Number.isFinite(hi) && Number.isFinite(at) && at > hi) detail.push(`note: apparent ${at}°C > heat index ${hi}°C (plausible in dry/cool conditions)`);
  }
  if (!detail.length) detail.push('all values physically plausible');
  return { pass, detail };
}

function checkOptimality(routeResults, coolestRouteId) {
  const detail = [];
  const ok = routeResults.filter(r => !r.error && r.avgTemp != null);
  if (ok.length < 2) {
    return { pass: true, detail: [`only ${ok.length} usable route(s) — optimality needs ≥2 alternatives to compare`] };
  }
  const actualMin = Math.min(...ok.map(r => r.avgTemp));
  const chosen = ok.find(r => r.routeId === coolestRouteId);
  if (!chosen) { detail.push(`chosen route ${coolestRouteId} has no temperature data`); return { pass: false, detail }; }
  const pass = Math.abs(chosen.avgTemp - actualMin) < 1e-9;
  const sorted = [...ok].sort((a, b) => a.avgTemp - b.avgTemp);
  const margin = sorted.length > 1 ? sorted[1].avgTemp - sorted[0].avgTemp : 0;
  const fastest = [...ok].sort((a, b) => a.durationSeconds - b.durationSeconds)[0];
  const timePenalty = chosen.durationSeconds - fastest.durationSeconds;
  detail.push(
    `chosen route ${chosen.routeId} avg ${chosen.avgTemp.toFixed(1)}°C — margin vs next-coolest: ${margin.toFixed(1)}°C`,
    `coolest-by-temp is ${pass ? 'the chosen route' : `route ${sorted[0].routeId} (chosen was ${chosen.routeId}) — MISMATCH`}`,
    `vs fastest route: ${(timePenalty / 60).toFixed(1)} min slower for ${margin.toFixed(1)}°C cooler` // the "tradeoff story"
  );
  return { pass, detail };
}

function checkRealTime(requested, returned, resultAgeHours) {
  const detail = [];
  const pass = requested === returned && resultAgeHours != null && resultAgeHours < 4;
  detail.push(`requested hour ${requested} vs returned hour ${returned} → ${requested === returned ? 'match' : 'MISMATCH'}`);
  detail.push(`result age ${resultAgeHours == null ? 'unknown' : resultAgeHours.toFixed(1) + 'h'} → ${resultAgeHours != null && resultAgeHours < 4 ? 'fresh' : 'STALE'}`);
  return { pass, detail };
}

function checkGroundTruth(gt) {
  const detail = [];
  if (!gt || !gt.matched) {
    return { pass: true, detail: ['Open-Meteo had no reading for the requested hour — skipped (not a failure)'] };
  }
  const delta = Math.abs(gt.fortyguardAvgC - gt.airTempC);
  const pass = delta <= GROUND_TRUTH_TOLERANCE_C;
  detail.push(
    `FortyGuard surface avg ${gt.fortyguardAvgC.toFixed(1)}°C vs Open-Meteo air ${gt.airTempC.toFixed(1)}°C → Δ ${delta.toFixed(1)}°C (surface is expected hotter in daylight)`
  );
  if (!pass) detail.push(`Δ exceeds tolerance ${GROUND_TRUTH_TOLERANCE_C}°C — investigate`);
  return { pass, detail };
}

function checkConsistency(runs) {
  const detail = [];
  if (runs.length < 2) return { pass: true, detail: ['consistency run needs 2 executions (set scenario.repeat = true)'] };
  const [a, b] = runs;
  if (a.error || b.error) return { pass: false, detail: ['one of the consistency runs failed'] };
  const pass = a.corridorHash === b.corridorHash && Math.abs(a.avgTemp - b.avgTemp) <= CONSISTENCY_TEMP_TOLERANCE_C;
  detail.push(
    `corridor sha1 identical across runs: ${a.corridorHash === b.corridorHash ? 'yes' : 'NO'}`,
    `tcm mean run1 ${a.avgTemp.toFixed(2)}°C vs run2 ${b.avgTemp.toFixed(2)}°C (Δ ${Math.abs(a.avgTemp - b.avgTemp).toFixed(2)}°C)`
  );
  return { pass, detail };
}

function summarize(checks) {
  const entries = Object.entries(checks).filter(([, c]) => c);
  const failed = entries.filter(([, c]) => !c.pass);
  return { pass: failed.length === 0, passed: entries.length - failed.length, total: entries.length, failed: failed.map(([name]) => name) };
}

module.exports = { checkPlausibility, checkOptimality, checkRealTime, checkGroundTruth, checkConsistency, summarize, GROUND_TRUTH_TOLERANCE_C };
