/*
 * EXPERIMENT: does corridor complexity affect FortyGuard queue time?
 * Compares: full 60m buffer vs simplified vs 30m buffer, for tcm + exceedance.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const turf = require('@turf/turf');

if (!process.env.FORTYGUARD_API_KEY && !process.env.api) {
  const raw = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
  const m = raw.match(/['"]?api['"]?\s*=\s*["']?([^"'\r\n\s]+)["']?/i);
  if (m) process.env.api = m[1];
}
const KEY = process.env.FORTYGUARD_API_KEY || process.env.api;
const BASE = 'https://api.fortyguard.com/v1';
const H = { 'api-key': KEY, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = new Date();
now.setUTCMinutes(0, 0, 0);
const dt = { start_date: now.toISOString().slice(0, 10), start_time: now.toISOString().slice(11, 16) };

async function run(label, polygonCoords, analyticType) {
  const payload = {
    polygon_aoi: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } }] },
    date_time: { ...dt, filter_type: analyticType === 'exceedance' ? 3 : 1 },
    granularity: 60,
    ...(analyticType !== 'tcm' && { analytic_type: analyticType }),
    ...(analyticType === 'exceedance' && { threshold: 35, direction: 'above' })
  };
  const t = Date.now();
  const res = await axios.post(`${BASE}/heatmap`, payload, { headers: H, timeout: 30000 });
  const submit = Date.now() - t;
  const id = res.data?.data?.activity_id;
  let attempts = 0;
  let complete = null;
  while (attempts < 30) {
    attempts++;
    const r = await axios.get(`${BASE}/status/${id}`, { headers: H, timeout: 30000 });
    const st = r.data?.data?.status;
    if (st === 'Completed') { complete = Date.now() - t; break; }
    if (st === 'Failed') { complete = 'FAILED'; break; }
    await sleep(1000);
  }
  console.log(label.padEnd(36), `submit=${submit}ms  complete@${typeof complete === 'number' ? complete + 'ms' : complete}  polls=${attempts}`);
}

(async () => {
  console.log('fetching OSRM driving route (fast)...');
  const os = await axios.get(
    'https://router.project-osrm.org/route/v1/driving/-111.0495,45.6770;-111.0600,45.6699?alternatives=true&geometries=geojson&overview=full',
    { timeout: 30000 }
  );
  const geom = os.data.routes[0].geometry;
  const buf60 = turf.buffer(turf.feature(geom), 60 / 1000, { units: 'kilometers' });
  const full = buf60.geometry.coordinates;
  const simp = turf.simplify(turf.clone(buf60), { tolerance: 0.0005, highQuality: true }).geometry.coordinates;
  const small = turf.buffer(turf.feature(geom), 30 / 1000, { units: 'kilometers' }).geometry.coordinates;

  console.log(`full rings=${full[0].length}  simplified rings=${simp[0].length}  30m rings=${small[0].length}`);
  console.log('--- TCM queue-time comparison ---');
  await run('tcm full 60m buffer', full, 'tcm');
  await run('tcm simplified 60m', simp, 'tcm');
  await run('tcm 30m buffer', small, 'tcm');
  console.log('--- EXCEEDANCE comparison ---');
  await run('exceedance full 60m', full, 'exceedance');
  await run('exceedance simplified', simp, 'exceedance');
})().catch(e => { console.error('EXPERIMENT FAILED:', e.response?.data || e.message); process.exitCode = 1; });
