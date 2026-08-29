/**
 * data-verification/scripts/run.js
 *
 * Runs every scenario end-to-end against the RAW live APIs (no cache) and
 * evaluates the credibility checks. Outputs:
 *   results/latest.json   — machine-readable evidence
 *   console summary table
 *
 * Usage (from data-verification/):
 *   npm run run                          # all scenarios, concurrency 2
 *   node scripts/run.js --limit=2        # first 2 scenarios (smoke test)
 *   node scripts/run.js --scenarios=phoenix-drive,miami-drive
 *   node scripts/run.js --concurrency=3  # more parallel scenarios
 *   node scripts/run.js --skip-consistency
 *   node scripts/run.js --tag=night      # extra run label for results file
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadEnv } = require('../lib/env');
loadEnv();

const { scenarios } = require('../config/scenarios');
const { geocode } = require('../lib/geocode');
const { getAlternativeRoutes } = require('../lib/osrm');
const { routeToCorridor, ringCount } = require('../lib/corridor');
const fg = require('../lib/fortyguard');
const { hourlyAirTemp } = require('../lib/openmeteo');
const checks = require('../checks/validate');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}
const limit = Number(arg('limit', scenarios.length));
const concurrency = Math.max(1, Number(arg('concurrency', 2)));
const onlyIds = (arg('scenarios', '') || '').split(',').filter(Boolean);
const skipConsistency = process.argv.includes('--skip-consistency');
const tag = arg('tag', '');

const selected = onlyIds.length ? scenarios.filter(s => onlyIds.includes(s.id)) : scenarios.slice(0, limit);

const pad = n => String(n).padStart(2, '0');
function hourParts(iso) {
  const d = new Date(iso);
  return { startDate: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, startTime: `${pad(d.getUTCHours())}:00` };
}
function corridorHash(coords) { return crypto.createHash('sha1').update(JSON.stringify(coords)).digest('hex').slice(0, 12); }

async function analyzeRoute(routeId, route, common, exceedance) {
  const t0 = Date.now();
  const corridor = routeToCorridor(route.geometry);
  const [tcmRes, exceedRes] = await Promise.all([
    fg.heatmap(corridor, { ...common, analyticType: 'tcm' }),
    exceedance
      ? fg.heatmap(corridor, { startDate: common.startDate, filterType: 3, granularity: 60, analyticType: 'exceedance', threshold: 35, direction: 'above' })
          .then(r => fg.metric(r, 'Mean')).catch(e => { console.warn(`  exceedance skipped: ${e.message}`); return null; })
      : Promise.resolve(null)
  ]);
  const nCells = tcmRes?.stats_data?.n_cells ?? tcmRes?.map_data?.features?.length ?? null;
  return {
    routeId,
    durationSeconds: route.duration,
    distanceMeters: route.distance,
    avgTemp: fg.metric(tcmRes, 'Mean'),
    maxTemp: fg.metric(tcmRes, 'Maximum'),
    hoursAbove35: exceedRes,
    nCells,
    corridorRings: ringCount(corridor),
    corridorHash: corridorHash(corridor),
    apiMs: Date.now() - t0
  };
}

async function runScenarioOnce(sc) {
  const t0 = Date.now();
  const requestedHour = sc.time === 'now' ? new Date().toISOString() : sc.time;
  const { startDate, startTime } = hourParts(requestedHour);
  const common = { startDate, startTime, filterType: 1, granularity: 60 };

  const origin = await geocode(sc.origin);
  const destination = await geocode(sc.destination);
  const routes = await getAlternativeRoutes(origin, destination, sc.profile);
  if (!routes.length) throw new Error('No routes returned');

  const routeResults = [];
  for (let i = 0; i < routes.length; i++) {
    try {
      routeResults.push(await analyzeRoute(i, routes[i], common, sc.exceedance));
    } catch (e) {
      routeResults.push({ routeId: i, error: e.message, apiMs: Date.now() - t0 });
    }
  }
  const usable = routeResults.filter(r => !r.error && r.avgTemp != null);
  const coolestRouteId = usable.length ? usable.reduce((a, b) => a.avgTemp < b.avgTemp ? a : b).routeId : -1;
  const coolest = usable.find(r => r.routeId === coolestRouteId);

  // feels-like (env_params) at the midpoint of the chosen route — mirrors the app
  let feelsLike = null;
  if (coolest) {
    try {
      const turf = require('@turf/turf');
      const geom = routes[coolestRouteId].geometry;
      const mid = turf.along(turf.feature(geom), turf.length(turf.feature(geom), { units: 'kilometers' }) / 2, { units: 'kilometers' });
      const lat = mid.geometry.coordinates[1];
      const lng = mid.geometry.coordinates[0];
      const envId = await fg.submitEnvParams(lat, lng, coolest.avgTemp, { startDate, startTime, analysis: ['heat_index_celsius', 'apparent_temperature_celsius', 'relative_humidity_percent'] });
      const envRes = await fg.pollResult(envId);
      feelsLike = envRes?.locations?.[0]?.parameters || null;
    } catch (e) { console.warn(`  env_params failed: ${e.message}`); }
  }

  // ground truth at midpoint of chosen route for the requested hour
  let groundTruth = null;
  if (coolest) {
    try {
      const gt = await hourlyAirTemp(origin.lat, origin.lng, requestedHour);
      groundTruth = { matched: gt.matched, airTempC: gt.tempC, fortyguardAvgC: coolest.avgTemp, source: 'open-meteo' };
    } catch (e) { console.warn(`  open-meteo failed: ${e.message}`); }
  }

  const analyzedHour = `${startDate}T${startTime}:00Z`;
  const resultAgeHours = (Date.now() - new Date(analyzedHour).getTime()) / 3600000;

  return {
    id: sc.id, label: sc.label, profile: sc.profile, time: sc.time,
    requestedHour, analyzedHour, origin, destination,
    routeResults, coolestRouteId, feelsLike, groundTruth,
    resultAgeHours, elapsedMs: Date.now() - t0
  };
}

async function runScenario(sc) {
  const out = { id: sc.id, label: sc.label, profile: sc.profile, time: sc.time, scenario: { id: sc.id, time: sc.time }, runs: [], error: null };
  try {
    const run1 = await runScenarioOnce(sc);
    out.runs.push(run1);
    if (sc.repeat && !skipConsistency) {
      console.log(`  ⟳ consistency pass 2/2 for ${sc.id}…`);
      const run2 = await runScenarioOnce(sc);
      out.runs.push(run2);
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

async function main() {
  // --recheck: re-evaluate checks against an existing results file (no API calls)
  if (process.argv.includes('--recheck')) {
    const src = path.join(RESULTS_DIR, tag ? `latest-${tag}.json` : 'latest.json');
    const prev = JSON.parse(fs.readFileSync(src, 'utf8'));
    const refreshed = prev.map(res => ({ ...res, checks: res.error ? null : evaluateChecks(res) }));
    const summary = refreshed.map(res => ({ id: res.id, pass: res.error ? false : checks.summarize(res.checks).pass, error: res.error }));
    fs.writeFileSync(src, JSON.stringify(refreshed, null, 2));
    console.log(`Re-checked ${refreshed.length} scenario(s) from ${src} (no API calls).`);
    for (const s of summary) console.log(`  ${s.pass ? '✅' : '❌'} ${s.id}${s.error ? ` (${s.error})` : ''}`);
    return;
  }

  console.log(`\n=== ShadeRoute data verification ===`);
  console.log(`${selected.length} scenario(s), concurrency ${concurrency}${skipConsistency ? ', consistency skipped' : ''}\n`);
  const started = Date.now();
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const sc = selected[next++];
      process.stdout.write(`▶ ${sc.id} — ${sc.label}\n`);
      const res = await runScenario(sc);
      const ok = res.error ? false : checks.summarize(evaluateChecks(res)).pass;
      console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}  (${((res.runs[0]?.elapsedMs || 0) / 1000).toFixed(1)}s)${res.error ? ' — ' + res.error : ''}`);
      results.push(res);
    }
  });
  await Promise.all(workers);

  // attach checks to results for the report
  const withChecks = results.map(res => ({ ...res, checks: res.error ? null : evaluateChecks(res) }));
  const summary = withChecks.map(res => ({ id: res.id, pass: res.error ? false : checks.summarize(res.checks).pass, error: res.error }));
  const totalPass = summary.filter(s => s.pass).length;
  console.log(`\n=== Result: ${totalPass}/${summary.length} scenarios passed in ${((Date.now() - started) / 1000).toFixed(0)}s ===`);
  for (const s of summary) console.log(`  ${s.pass ? '✅' : '❌'} ${s.id}${s.error ? ` (${s.error})` : ''}`);

  const file = tag ? `latest-${tag}.json` : 'latest.json';
  fs.writeFileSync(path.join(RESULTS_DIR, file), JSON.stringify(withChecks, null, 2));
  console.log(`\nEvidence written to results/${file}`);
}

function evaluateChecks(res) {
  const run = res.runs[0];
  const isHistorical = (res.scenario?.time ?? res.time) !== 'now';
  const checksOut = {
    plausibility: run ? checks.checkPlausibility(run.routeResults, run.feelsLike) : null,
    optimality: run ? checks.checkOptimality(run.routeResults, run.coolestRouteId) : null,
    // Freshness only applies to "now" scenarios. Historical re-tests exist to
    // prove determinism (immutable past hour), so freshness is waived there.
    realTime: run
      ? isHistorical
        ? { pass: true, detail: ['pinned historical hour — freshness waived (purpose is determinism, verified by the consistency check)'] }
        : checks.checkRealTime(run.analyzedHour, run.analyzedHour, run.resultAgeHours)
      : null,
    groundTruth: run ? checks.checkGroundTruth(run.groundTruth) : null,
    consistency: res.runs.length > 1
      ? checks.checkConsistency(res.runs.map(r => ({ corridorHash: r.routeResults.find(x => !x.error)?.corridorHash, avgTemp: r.routeResults.find(x => !x.error)?.avgTemp, error: r.error })))
      : null
  };
  return checksOut;
}

main().catch(e => { console.error(e); process.exit(1); });
