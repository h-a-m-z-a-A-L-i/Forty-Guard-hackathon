/*
 * FortyGuard API LATENCY PROBE
 * ------------------------------------------------------------------
 * Measures the real wall-clock latency of every step in the ShadeRoute
 * data-receiving pipeline so we can identify and justify optimizations.
 *
 * It times, per analytic:
 *   1. SUBMIT   — time to POST /v1/heatmap (or /v1/env_params) and get activity_id
 *   2. QUEUE    — time from submit response until first status shows "Completed"
 *   3. TOTAL    — full wall time (submit response -> completed result)
 *   4. POLLS    — number of status polls required
 *
 * It also records how long an OSRM route fetch takes, because that is part of
 * the total end-to-end latency a user experiences before the map renders.
 *
 * Usage:
 *   node scripts/latency-test.js                     # default: montana, tcm
 *   node scripts/latency-test.js --place=nyc
 *   node scripts/latency-test.js --analytic=exceedance --threshold=35
 *   node scripts/latency-test.js --repeat=3          # run each analytic 3x
 *   node scripts/latency-test.js --envparams         # also time env_params
 *   node scripts/latency-test.js --osrm              # also time an OSRM route
 *   node scripts/latency-test.js --interval=1000     # poll every 1000ms
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

/* ---------- env / key ---------- */
if (!process.env.FORTYGUARD_API_KEY && !process.env.api) {
  const raw = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
  const match = raw.match(/['"]?api['"]?\s*=\s*["']?([^"'\r\n\s]+)["']?/i);
  if (match) process.env.api = match[1];
}
const apiKey = process.env.FORTYGUARD_API_KEY || process.env.api;
if (!apiKey) throw new Error('No FortyGuard API key found in .env');

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));

const analytic = args.analytic || 'tcm';
const threshold = Number(args.threshold || 35);
const granularity = Number(args.granularity || 60);
const repeat = Number(args.repeat || 1);
const intervalMs = Number(args.interval || 2500);
const base = 'https://api.fortyguard.com/v1';
const headers = { 'api-key': apiKey, 'Content-Type': 'application/json' };

/* ---------- sample corridors ---------- */
const montanaPolygon = [[
  [-111.0600, 45.6650], [-111.0450, 45.6650],
  [-111.0450, 45.6750], [-111.0600, 45.6750],
  [-111.0600, 45.6650]
]];
const nycPolygon = [[[-74.0170, 40.7050], [-74.0030, 40.7050], [-74.0030, 40.7180], [-74.0170, 40.7180], [-74.0170, 40.7050]]];
const polygon = args.place === 'nyc' ? nycPolygon : montanaPolygon;

function currentUtcHour() {
  if (args.date) return { date: args.date, time: args.time || '14:00' };
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 16) };
}

/* ---------- tiny helpers ---------- */
const t0 = () => process.hrtime.bigint();
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* ---------- measured operations ---------- */
async function timeSubmit(when) {
  const body = {
    polygon_aoi: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygon } }] },
    date_time: { start_date: when.date, start_time: when.time, filter_type: analytic === 'exceedance' ? 3 : 1 },
    granularity,
    ...(analytic !== 'tcm' && { analytic_type: analytic }),
    ...(analytic === 'exceedance' && { threshold, direction: 'above' })
  };
  const start = t0();
  const response = await axios.post(`${base}/heatmap`, body, { headers, timeout: 30000 });
  const id = response.data?.data?.activity_id;
  return { submitMs: ms(start), httpStatus: response.status, id };
}

async function timePoll(id) {
  let attempts = 0;
  let firstCompleteSaw = null;
  const pollStart = t0();
  for (let i = 0; i < 60; i++) {
    attempts++;
    const pStart = t0();
    const response = await axios.get(`${base}/status/${id}`, { headers, timeout: 30000 });
    const perPollMs = ms(pStart);
    const status = response.data?.data?.status;
    const pollClockMs = ms(pollStart);
    if (status === 'Completed') {
      firstCompleteSaw = pollClockMs;
      return { attempts, perPollMs, firstCompleteSaw, result: response.data.data.result };
    }
    if (status === 'Failed') throw new Error(`Activity failed: ${response.data?.message || id}`);
    if (i < 59) await sleep(intervalMs);
  }
  throw new Error('Polling timed out');
}

async function timeEnvParams() {
  const when = currentUtcHour();
  const body = {
    latitude: polygon[0][0][1], longitude: polygon[0][0][0], temperature: 25,
    date_time: { start_date: when.date, start_time: when.time, filter_type: 1 },
    analysis: ['heat_index_celsius', 'apparent_temperature_celsius', 'relative_humidity_percent']
  };
  const start = t0();
  const res = await axios.post(`${base}/env_params`, body, { headers, timeout: 30000 });
  const submitMs = ms(start);
  const id = res.data?.data?.activity_id;
  const pid = t0();
  let attempts = 0;
  let firstCompleteSaw = null;
  for (let i = 0; i < 60; i++) {
    attempts++;
    const r = await axios.get(`${base}/status/${id}`, { headers, timeout: 30000 });
    if (r.data?.data?.status === 'Completed') { firstCompleteSaw = ms(pid); break; }
    if (i < 59) await sleep(intervalMs);
  }
  return { submitMs, attempts, firstCompleteSaw, totalMs: submitMs + firstCompleteSaw };
}

async function timeOsrm(from, to) {
  const url = `https://router.project-osrm.org/route/v1/foot/${from};${to}?alternatives=true&geometries=geojson&overview=full`;
  const start = t0();
  const res = await axios.get(url, { timeout: 30000 });
  return { totalMs: ms(start), httpStatus: res.status, routes: res.data?.routes?.length ?? 0 };
}

/* ---------- run ---------- */
async function runHeatmapAnalytic() {
  const when = currentUtcHour();
  console.log(`\n=== HEATMAP  analytic=${analytic}  place=${args.place || 'montana'}  granularity=${granularity} ===`);
  const { submitMs, httpStatus, id } = await timeSubmit(when);
  const { attempts, perPollMs, firstCompleteSaw } = await timePoll(id);
  const totalMs = submitMs + firstCompleteSaw;
  console.log(JSON.stringify({
    submit_http: httpStatus,
    submit_ms: submitMs.toFixed(1),
    queue_plus_poll_ms: firstCompleteSaw.toFixed(1),
    total_ms: totalMs.toFixed(1),
    poll_attempts: attempts,
    per_poll_ms: perPollMs.toFixed(1),
    effective_poll_interval_ms: intervalMs
  }, null, 2));
  return { submitMs, firstCompleteSaw, totalMs, attempts };
}

(async () => {
  console.log(`FortyGuard LATENCY PROBE`);
  console.log(`  repeat=${repeat}  poll_interval_ms=${intervalMs}`);
  console.log(`  analytic(s): ${analytic}${args.envparams ? ' (+env_params)' : ''}${args.osrm ? ' (+osrm route)' : ''}`);

  const summary = [];

  for (let i = 0; i < repeat; i++) {
    try {
      const heat = await runHeatmapAnalytic();
      summary.push({ analytic, ...heat });
    } catch (e) {
      console.error(`  heatmap run ${i + 1} FAILED:`, e.response?.data || e.message);
    }
  }

  if (args.envparams) {
    console.log(`\n=== ENV_PARAMS (point meteorology) ===`);
    const e = await timeEnvParams();
    console.log(JSON.stringify({ submit_ms: e.submitMs.toFixed(1), queue_plus_poll_ms: e.firstCompleteSaw.toFixed(1), total_ms: e.totalMs.toFixed(1), poll_attempts: e.attempts }, null, 2));
    summary.push({ analytic: 'env_params', totalMs: e.totalMs });
  }

  if (args.osrm) {
    console.log(`\n=== OSRM ROUTE FETCH (part of end-to-end latency) ===`);
    // Bozeman -> MSU (the demo route)
    const r = await timeOsrm('-111.0495,45.6700', '-111.0600,45.6770');
    console.log(JSON.stringify({ http: r.httpStatus, total_ms: r.totalMs.toFixed(1), candidate_routes: r.routes }, null, 2));
    summary.push({ analytic: 'osrm_route', totalMs: r.totalMs });
  }

  if (summary.length) {
    const totals = summary.map(s => s.totalMs);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const max = Math.max(...totals);
    console.log(`\n=== LATENCY SUMMARY (ms) ===`);
    console.log(JSON.stringify({ runs: summary, mean_total_ms: avg.toFixed(1), worst_total_ms: max.toFixed(1) }, null, 2));
  }
})().catch(e => { console.error('Latency probe failed:', e.response?.data || e.message); process.exitCode = 1; });
