/*
 * API DATA-RECEIVING LATENCY PROBE
 * ------------------------------------------------------------------
 * Standalone script that measures exactly where wall-clock time goes
 * when the frontend calls /api/compare-routes:
 *
 *   1. OSRM route fetch        (public routing API)
 *   2. Corridor buffering      (turf CPU time, server-side)
 *   3. TCM heatmap submit      (FortyGuard POST /v1/heatmap)
 *   4. TCM heatmap poll        (FortyGuard GET /v1/status/:id)
 *   5. Exceedance submit+poll  (per route, runs in parallel w/ tcm)
 *   6. Env params submit+poll  (after coolest route known)
 *   7. END-TO-END HTTP call    (if backend server is running)
 *
 * TTFT (time-to-first-byte) is measured on the e2e HTTP call so we
 * know how long the user stares at a spinner before any bytes arrive.
 *
 * Usage:
 *   node scripts/api-latency.js                    # Bozeman demo route
 *   node scripts/api-latency.js --e2e              # also hit local server
 *   node scripts/api-latency.js --repeat=3         # average 3 runs
 *   node scripts/api-latency.js --json             # machine-readable output
 *   node scripts/api-latency.js --no-fortyguard    # skip paid API calls
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const turf = require('@turf/turf');

/* ---------- env / key ---------- */
if (!process.env.FORTYGUARD_API_KEY && !process.env.api) {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
    const match = raw.match(/['"]?api['"]?\s*=\s*["']?([^"'\r\n\s]+)["']?/i);
    if (match) process.env.api = match[1];
  } catch (e) { /* no .env */ }
}
const apiKey = process.env.FORTYGUARD_API_KEY || process.env.api;

/* ---------- args ---------- */
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const repeat = Number(args.repeat || 1);
const jsonOut = Boolean(args.json);
const doE2E = Boolean(args.e2e);
const doFortyGuard = apiKey && !args['no-fortyguard'];
const backendPort = Number(args.port || 4000);

/* ---------- timing helpers ---------- */
const t0 = () => process.hrtime.bigint();
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- demo route (Bozeman -> MSU, same as frontend default) ---------- */
const DEMO = {
  origin: { lat: 45.6770, lng: -111.0495, label: 'Bozeman, MT' },
  destination: { lat: 45.6699, lng: -111.0600, label: 'Montana State University' },
  label: 'Bozeman → MSU'
};

function currentUtcHour() {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return { startDate: now.toISOString().slice(0, 10), startTime: now.toISOString().slice(11, 16) };
}

/* ---------- stage 1: OSRM ---------- */
async function timeOsrm(origin, destination, profile = 'foot') {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const start = t0();
  const res = await axios.get(url, { params: { alternatives: true, geometries: 'geojson', overview: 'full' }, timeout: 30000 });
  const elapsed = ms(start);
  const routes = (res.data?.routes || []).slice(0, 3).map(({ geometry, duration, distance }) => ({ geometry, duration, distance }));
  return { ms: elapsed, httpStatus: res.status, routeCount: routes.length, payloadKb: JSON.stringify(res.data).length / 1024, routes };
}

/* ---------- stage 2: corridor (turf CPU) ---------- */
function timeCorridor(geometry, bufferMeters = 60) {
  const start = t0();
  const buffered = turf.buffer(turf.feature(geometry), bufferMeters / 1000, { units: 'kilometers' });
  const msElapsed = ms(start);
  return {
    ms: msElapsed,
    ringCount: buffered?.geometry?.coordinates?.[0]?.length || 0,
    polygon: buffered?.geometry?.coordinates || null
  };
}

/* ---------- stage 3/4: FortyGuard submit + poll ---------- */
const FG_BASE = 'https://api.fortyguard.com/v1';
const fgHeaders = () => ({ 'api-key': apiKey, 'Content-Type': 'application/json' });

async function submitHeatmap(polygonCoords, opts) {
  const { startDate, startTime, filterType = 1, granularity = 60, analyticType = 'tcm', threshold, direction } = opts;
  const payload = {
    polygon_aoi: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } }] },
    date_time: { start_date: startDate, start_time: startTime, filter_type: filterType },
    granularity,
    ...(analyticType !== 'tcm' && { analytic_type: analyticType }),
    ...(threshold !== undefined && { threshold }),
    ...(direction && { direction })
  };
  const start = t0();
  const res = await axios.post(`${FG_BASE}/heatmap`, payload, { headers: fgHeaders(), timeout: 30000 });
  const submitMs = ms(start);
  const id = res.data?.data?.activity_id;
  if (!id) throw new Error(res.data?.message || 'FortyGuard returned no activity_id');
  return { submitMs, httpStatus: res.status, id };
}

async function pollStatus(id, { intervalMs = 2500, maxAttempts = 40, fastIntervalMs = 400, fastAttempts = 6 } = {}) {
  // Adaptive: poll fast at first (400ms x6), then settle at the given interval.
  const pollStart = t0();
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    const p = t0();
    let res;
    try {
      res = await axios.get(`${FG_BASE}/status/${id}`, { headers: fgHeaders(), timeout: 30000 });
    } catch (e) {
      if (e.response?.status === 404 && i < maxAttempts - 1) { await sleep(i < fastAttempts ? fastIntervalMs : intervalMs); continue; }
      throw e;
    }
    const perPollMs = ms(p);
    const status = res.data?.data?.status;
    if (status === 'Completed') return { attempts, perPollMs, totalMs: ms(pollStart), result: res.data.data.result };
    if (status === 'Failed') throw new Error(`Activity failed: ${res.data?.message || id}`);
    if (i < maxAttempts - 1) await sleep(i < fastAttempts ? fastIntervalMs : intervalMs);
  }
  throw new Error('Polling timed out');
}

async function submitEnvParams(lat, lng, temperature, opts) {
  const { startDate, startTime, analysis } = opts;
  const start = t0();
  const res = await axios.post(`${FG_BASE}/env_params`, {
    latitude: lat, longitude: lng, temperature,
    date_time: { start_date: startDate, start_time: startTime, filter_type: 1 },
    analysis
  }, { headers: fgHeaders(), timeout: 30000 });
  return { submitMs: ms(start), id: res.data?.data?.activity_id };
}

/* ---------- stage 7: e2e HTTP call against local backend ---------- */
function timeE2E(origin, destination) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ origin, destination });
    const start = t0();
    const req = http.request({
      host: '127.0.0.1', port: backendPort,
      path: '/api/compare-routes', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      const ttfb = ms(start);
      let size = 0;
      res.on('data', chunk => { size += chunk.length; });
      res.on('end', () => resolve({ httpStatus: res.statusCode, ttfbMs: ttfb, totalMs: ms(start), payloadKb: size / 1024 }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('e2e timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

/* ---------- one full simulated run (mirrors server flow) ---------- */
async function runOnce(label) {
  const when = currentUtcHour();
  const stages = {};
  const row = { label };

  /* 1. OSRM */
  const osrm = await timeOsrm(DEMO.origin, DEMO.destination);
  row.osrmMs = osrm.ms;
  row.osrmRoutes = osrm.routeCount;
  row.osrmPayloadKb = osrm.payloadKb;
  stages.osrm = { ms: osrm.ms, note: `alternatives=${osrm.routeCount}` };

  /* 2. corridors (parallel CPU) */
  const corridorStart = t0();
  const corridors = osrm.routes.map(r => timeCorridor(r.geometry));
  const corridorMs = ms(corridorStart);
  row.corridorMs = corridorMs;
  stages.corridor = { ms: corridorMs, note: `rings=${corridors.map(c => c.ringCount).join(',')}` };

  if (!doFortyGuard) {
    row.skipped = 'fortyguard';
    return { row, stages };
  }

  /* 3/4. TCM + exceedance per route, parallel across routes (server behavior) */
  const fgStart = t0();
  const perRoute = await Promise.all(corridors.map(async (corridor, i) => {
    const common = { startDate: when.startDate, startTime: when.startTime, granularity: 60 };
    const tcm = await submitHeatmap(corridor.polygon, { ...common, filterType: 1, analyticType: 'tcm' });
    const tcmDone = await pollStatus(tcm.id);
    let ex = null;
    try {
      const exSubmit = await submitHeatmap(corridor.polygon, { ...common, filterType: 3, analyticType: 'exceedance', threshold: 35, direction: 'above' });
      const exDone = await pollStatus(exSubmit.id);
      ex = { submitMs: exSubmit.submitMs, totalMs: exDone.totalMs, attempts: exDone.attempts };
    } catch (e) { ex = { error: e.message }; }
    return { routeId: i, tcm: { submitMs: tcm.submitMs, totalMs: tcmDone.totalMs, attempts: tcmDone.attempts }, ex };
  }));
  const fgWallMs = ms(fgStart);
  row.fortyGuardWallMs = fgWallMs;
  stages.fortyguard = { ms: fgWallMs, note: `${perRoute.length} routes in parallel` };
  perRoute.forEach((r, i) => {
    stages[`route${i}.tcm`] = { ms: r.tcm.totalMs, note: `submit=${r.tcm.submitMs.toFixed(0)}ms polls=${r.tcm.attempts}` };
    if (r.ex) stages[`route${i}.exceedance`] = { ms: r.ex.totalMs, note: `submit=${r.ex.submitMs.toFixed(0)}ms polls=${r.ex.attempts}${r.ex.error ? ' FAILED' : ''}` };
    row[`tcm${i}Ms`] = r.tcm.totalMs;
    row[`ex${i}Ms`] = r.ex?.totalMs ?? null;
  });

  /* 5. env params (single, after coolest determined) */
  const envStart = t0();
  try {
    const e = await submitEnvParams(DEMO.destination.lat, DEMO.destination.lng, 25, { startDate: when.startDate, startTime: when.startTime, analysis: ['heat_index_celsius', 'apparent_temperature_celsius', 'relative_humidity_percent'] });
    const eDone = await pollStatus(e.id);
    row.envParamsMs = ms(envStart);
    stages.env_params = { ms: row.envParamsMs, note: `submit=${e.submitMs.toFixed(0)}ms polls=${eDone.attempts}` };
  } catch (e) {
    row.envParamsMs = null;
    stages.env_params = { ms: 0, note: `FAILED ${e.message}` };
  }

  row.totalMs = osrm.ms + corridorMs + fgWallMs + (row.envParamsMs || 0);
  stages.total = { ms: row.totalMs, note: 'osrm + corridor + fortyguard + env_params' };

  return { row, stages };
}

/* ---------- report printing ---------- */
function printWaterfall(stages) {
  const entries = Object.entries(stages).filter(([, v]) => v.ms > 0.05);
  const total = stages.total?.ms || entries.reduce((a, [, v]) => a + v.ms, 0);
  const maxBar = Math.max(...entries.map(([, v]) => v.ms), 1);
  console.log('\n  WATERFALL (server-side simulated flow)');
  console.log('  ' + '-'.repeat(72));
  for (const [name, v] of entries) {
    const barLen = Math.round((v.ms / maxBar) * 40);
    const pct = ((v.ms / total) * 100).toFixed(1);
    console.log(`  ${String(name).padEnd(22)} ${String(v.ms.toFixed(0)).padStart(7)} ms  ${'█'.repeat(barLen).padEnd(40)} ${pct}%  ${v.note || ''}`);
  }
  console.log('  ' + '-'.repeat(72));
  console.log(`  ${'TOTAL (simulated)'.padEnd(22)} ${String(total.toFixed(0)).padStart(7)} ms`);
}

function printSummary(rows, doE2E, e2eRows) {
  console.log('\n  ═══ LATENCY SUMMARY ═══');
  const avg = (key) => {
    const vals = rows.map(r => r[key]).filter(Number.isFinite);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0) : 'n/a';
  };
  const table = rows.map(r => ({
    'run': r.label,
    'osrm(ms)': r.osrmMs?.toFixed(0),
    'corridor(ms)': r.corridorMs?.toFixed(0),
    'fg-wall(ms)': r.fortyGuardWallMs?.toFixed(0),
    'env(ms)': r.envParamsMs?.toFixed(0),
    'total(ms)': r.totalMs?.toFixed(0),
  }));
  console.table(table);
  console.log(`  Averages: osrm=${avg('osrmMs')}ms  corridor=${avg('corridorMs')}ms  fortyguard-wall=${avg('fortyGuardWallMs')}ms  env=${avg('envParamsMs')}ms  TOTAL=${avg('totalMs')}ms`);
  if (doE2E && e2eRows.length) {
    const ttfbAvg = (e2eRows.reduce((a, r) => a + r.ttfbMs, 0) / e2eRows.length).toFixed(0);
    const totalAvg = (e2eRows.reduce((a, r) => a + r.totalMs, 0) / e2eRows.length).toFixed(0);
    console.log(`  E2E HTTP (localhost:${backendPort}/api/compare-routes): ttfb_avg=${ttfbAvg}ms  total_avg=${totalAvg}ms  (n=${e2eRows.length})`);
  }
}

/* ---------- main ---------- */
(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  API DATA-RECEIVING LATENCY PROBE — ShadeRoute');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  route: ${DEMO.label}   repeats: ${repeat}   fortyguard: ${doFortyGuard ? 'ON' : 'OFF'}`);
  if (!apiKey) console.log('  ⚠ no FortyGuard API key — heatmap stages will be skipped');

  const rows = [];
  const e2eRows = [];

  for (let i = 0; i < repeat; i++) {
    const tag = repeat > 1 ? `run ${i + 1}/${repeat}` : 'single run';
    console.log(`\n── ${tag} ──`);
    try {
      const { row, stages } = await runOnce(tag);
      rows.push(row);
      printWaterfall(stages);
    } catch (e) {
      console.error('  run failed:', e.response?.data || e.message);
    }
  }

  if (doE2E) {
    console.log(`\n── end-to-end HTTP against local backend (port ${backendPort}) ──`);
    for (let i = 0; i < repeat; i++) {
      try {
        const r = await timeE2E(DEMO.origin, DEMO.destination);
        e2eRows.push(r);
        console.log(`  e2e ${i + 1}: http=${r.httpStatus}  ttfb=${r.ttfbMs.toFixed(0)}ms  total=${r.totalMs.toFixed(0)}ms  payload=${r.payloadKb.toFixed(1)}kB`);
      } catch (e) {
        console.error(`  e2e failed: ${e.message}  (is the backend running? node backend/server.js)`);
      }
    }
  }

  if (jsonOut) {
    console.log('\n── JSON ──');
    console.log(JSON.stringify({ rows, e2e: e2eRows }, null, 2));
  } else {
    printSummary(rows, doE2E, e2eRows);
  }

  console.log('\n  DONE.');
})().catch(e => { console.error('Probe crashed:', e); process.exitCode = 1; });
