/**
 * data-verification/scripts/report.js
 *
 * Turns results/latest.json into results/report.md — a human-readable
 * credibility report: per-scenario evidence + the overall "story".
 *
 * Usage (from data-verification/):
 *   npm run report            # uses results/latest.json
 *   node scripts/report.js --tag=night
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const tag = (process.argv.find(a => a.startsWith('--tag=')) || '').split('=')[1] || '';
const input = path.join(RESULTS_DIR, tag ? `latest-${tag}.json` : 'latest.json');
const results = JSON.parse(fs.readFileSync(input, 'utf8'));

const fmt = n => (n == null ? '—' : (Number.isInteger(n) ? n : Number(n).toFixed(1)));
const badge = pass => (pass === true ? '✅' : pass === false ? '❌' : '➖');

function minMaxDelta(run) {
  const usable = run.routeResults.filter(r => !r.error && r.avgTemp != null);
  if (usable.length < 2) return null;
  const sorted = [...usable].sort((a, b) => a.avgTemp - b.avgTemp);
  return sorted[1].avgTemp - sorted[0].avgTemp;
}

function routeTable(run) {
  if (!run) return '';
  let md = '| Route | Duration | Distance | Avg °C | Max °C | >35°C hrs | Cells | Corridor rings |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const r of run.routeResults) {
    if (r.error) { md += `| ${r.routeId} | — | — | ERROR: ${r.error} | — | — | — | — |\n`; continue; }
    const chosen = r.routeId === run.coolestRouteId ? ' 🏆' : '';
    md += `| ${r.routeId}${chosen} | ${(r.durationSeconds / 60).toFixed(0)} min | ${(r.distanceMeters / 1000).toFixed(1)} km | ${fmt(r.avgTemp)} | ${fmt(r.maxTemp)} | ${fmt(r.hoursAbove35)} | ${fmt(r.nCells)} | ${fmt(r.corridorRings)} |\n`;
  }
  return md;
}

let md = `# ShadeRoute Data Credibility Report
**Generated:** ${new Date().toISOString()} · **Scenarios:** ${results.length} · **Source:** raw live API calls (no cache)

## How to read this report
This pipeline verifies **four claims** the app makes, per scenario:

1. **Optimality** — the route the app recommends ("coolest") is truly the coolest of the OSRM alternatives, and by how much.
2. **Real-time** — the temperature data corresponds to the requested hour and is fresh (age < 4 h).
3. **Ground truth** — FortyGuard surface temperatures agree with an independent source (Open-Meteo hourly air temperature). Surface ≠ air (asphalt radiates heat), so we allow ±12 °C but report the real delta.
4. **Plausibility & consistency** — values are physically sane, and repeat requests return identical data (deterministic).

## Summary

| Scenario | Routes | Chosen avg | Δ vs 2nd | Ground-truth Δ | Fresh | Checks | Result |
|---|---|---|---|---|---|---|---|
`;

const all = [];
for (const res of results) {
  const run = res.runs?.[0];
  const checksObj = res.checks;
  if (!checksObj) { md += `| ${res.id} | — | — | — | — | — | — | ❌ ${res.error} |\n`; continue; }
  const usable = run?.routeResults?.filter(r => !r.error && r.avgTemp != null) || [];
  const chosen = usable.find(r => r.routeId === run.coolestRouteId);
  const margin = minMaxDelta(run);
  const gt = run?.groundTruth;
  const gtDelta = gt?.matched ? Math.abs(gt.fortyguardAvgC - gt.airTempC) : null;
  const sum = summarizeFriendly(checksObj);
  all.push(sum);
  md += `| ${res.id} | ${usable.length}/${run.routeResults.length} | ${fmt(chosen?.avgTemp)}°C | ${margin == null ? '—' : fmt(margin) + '°C'} | ${gtDelta == null ? '—' : fmt(gtDelta) + '°C'} | ${fmt(run.resultAgeHours)}h | ${sum.passed}/${sum.total} | ${sum.pass ? '✅ PASS' : '❌ FAIL'} |\n`;
}
md += '\n';

for (const res of results) {
  if (!res.checks) {
    md += `## ${res.id} — ❌ FAILED\n\n\`${res.error}\`\n\n`;
    continue;
  }
  const run = res.runs[0];
  const sum = summarizeFriendly(res.checks);
  md += `## ${res.id} — ${sum.pass ? '✅ PASS' : '❌ FAIL'} (${sum.passed}/${sum.total} checks)\n\n`;
  md += `**${res.label}** · profile: \`${res.profile}\` · requested hour: \`${run.analyzedHour}\` (age ${fmt(run.resultAgeHours)} h)\n\n`;
  md += `**Geocoded:** ${run.origin.label} → ${run.destination.label}\n\n`;
  md += routeTable(run);
  md += '\n';
  for (const [name, c] of Object.entries(res.checks)) {
    if (!c) continue;
    md += `### ${name} ${badge(c.pass)}\n`;
    for (const d of c.detail) md += `- ${d}\n`;
    md += '\n';
  }
}

const passes = all.filter(s => s.pass).length;
md += `---\n\n## The story — what did we prove?\n\n`;
md += `**1. How do we know the recommended route is the most optimized?**\n`;
md += `Every scenario fetches all OSRM alternatives, computes each one's corridor, and measures the average surface temperature of EACH route from FortyGuard — not just the chosen one. The check passes only when the app's chosen route has the minimum average temperature. The margin column shows how much cooler it is than the second-best route, and the route table shows the time penalty you pay for the cooler route (the "comfort vs. time" tradeoff).\n\n`;
md += `**2. How do we know the temperature is real / real-time?**\n`;
md += `- **Real-time:** the requested hour is recorded, the result age is computed, and freshness is required (< 4 h). An old or cached value would fail.\n`;
md += `- **Real:** temperatures are cross-checked against Open-Meteo hourly air temperature at the same place and hour. Surface temps run hotter than air in daylight — the report shows the exact delta so you can see the spread, and flags anything beyond ±12 °C.\n`;
md += `- **Deterministic:** the consistency scenario runs the identical request twice against the raw API and requires identical corridors and temperatures — proof the numbers aren't random noise.\n\n`;
md += `**3. Caveats (be honest about these in any pitch/demo):**\n`;
md += `- FortyGuard reports **road-surface** temperature, not air temperature — in sun, asphalt is hotter. That's a feature (you feel the road heat), but it means deltas vs. weather apps are expected.\n`;
md += `- FortyGuard processes requests **asynchronously (queue ~20-40 s)** — the value is real-time for the hour requested, not sub-second.\n`;
md += `- The API key is **licensed for Montana only** (Montana State area). All scenarios are in-state; out-of-state requests return no coverage (n_cells = 0). Any Montana scenario showing n_cells = 0 would indicate a real coverage gap (e.g., very remote roads).\n\n`;

const finalScore = `${passes}/${results.length} scenarios passed`;
md += `**Final score:** ${finalScore}.\n`;

const outFile = path.join(RESULTS_DIR, tag ? `report-${tag}.md` : 'report.md');
fs.writeFileSync(outFile, md);
console.log(`Report written to ${outFile}`);
console.log(`\n${finalScore}\n`);

function summarizeFriendly(checksObj) {
  const entries = Object.entries(checksObj).filter(([, c]) => c);
  const passed = entries.filter(([, c]) => c.pass).length;
  return { pass: entries.every(([, c]) => c.pass), passed, total: entries.length };
}
