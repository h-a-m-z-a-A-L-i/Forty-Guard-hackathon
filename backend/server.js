require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
if (!process.env.FORTYGUARD_API_KEY && !process.env.api) {
  const fs = require('fs');
  const rawEnv = fs.readFileSync(require('path').resolve(__dirname, '../.env'), 'utf8');
  const match = rawEnv.match(/['"]?api['"]?\s*=\s*["']?([^"'\r\n\s]+)["']?/i);
  if (match) process.env.api = match[1];
}
const express = require('express'); const cors = require('cors'); const path = require('path');
const { submitHeatmap, submitEnvParams, pollResult, heatmapCached, envParamsCached } = require('./lib/fortyguard');
const { routeToCorridor, routeMidpoint } = require('./lib/corridor'); const { getAlternativeRoutes } = require('./lib/osrm');
const app = express(); app.use(cors()); app.use(express.json());
const API_KEY = process.env.FORTYGUARD_API_KEY || process.env.api;
const frontendDist = path.resolve(__dirname, '../frontend/dist');

// Validate API key on startup
if (!API_KEY) {
  console.error('❌ ERROR: FORTYGUARD_API_KEY not found in backend/.env');
  console.error('Please create backend/.env with: FORTYGUARD_API_KEY=your_key_here');
  process.exit(1);
}
console.log('✅ FortyGuard API key configured');
app.use(express.static(frontendDist));
const pad = n => String(n).padStart(2, '0');
function dateTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error('Invalid atTime');
  // FortyGuard granularity=60 expects a whole-hour start_time; round down to the hour.
  d.setUTCMinutes(0, 0, 0);
  return { startDate: `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`, startTime: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
// Shift a (startDate, startTime) pair by whole hours (used to probe the
// +12h forecast window for the "coolest time to leave" planner).
function shiftHours(dateStr, timeStr, hours) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm) + hours * 3600 * 1000);
  return { startDate: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, startTime: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` };
}
function metric(result, key) {
  // Three real FortyGuard response shapes:
  //   1. plan docs:      stats_data.Temperature_stats.Mean
  //   2. tcm API:        stats_data.temperature_stats.mean
  //   3. exceedance API: stats_data.mean  (direct keys min/max/mean)
  const directStats = result?.stats_data || {};
  const nested = directStats.Temperature_stats || directStats.temperature_stats || {};
  const keyMap = { Mean: ['mean', 'Mean'], Minimum: ['minimum', 'Minimum', 'min'], Maximum: ['maximum', 'Maximum', 'max'] };
  for (const source of [nested, directStats]) {
    for (const candidate of keyMap[key] || []) {
      const v = Number(source?.[candidate]);
      if (Number.isFinite(v)) return v;
    }
  }
  const field = { Mean: 'average_temperature', Minimum: 'min_temperature', Maximum: 'max_temperature' }[key];
  const values = result?.map_data?.features?.map(feature => Number(feature?.properties?.[field])).filter(Number.isFinite) || [];
  if (!values.length) return null;
  return key === 'Minimum' ? Math.min(...values) : key === 'Maximum' ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0) / values.length;
}
app.get('/api/health', (_, res) => res.json({ ok: true, apiConfigured: Boolean(API_KEY), cacheEntries: require('./lib/fortyguard')._cache.size }));
// Validation helpers
function validateCoordinates(lat, lng, name = 'Location') {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return `${name} must have valid lat/lng`;
  if (lat < 25 || lat > 49) return `${name} latitude out of US range (25-49)`;
  if (lng < -125 || lng > -66) return `${name} longitude out of US range (-125 to -66)`;
  return null;
}

function validateDateTime(atTime) {
  if (!atTime) return null; // Optional, defaults to now
  try {
    const d = new Date(atTime);
    if (Number.isNaN(d.getTime())) return 'Invalid date format';
    const now = new Date();
    const maxFuture = new Date(now.getTime() + 12 * 60 * 60 * 1000); // +12 hours
    if (d < new Date('2019-01-01')) return 'Date must be after 2019-01-01';
    if (d > maxFuture) return 'Date must be within 12 hours in the future';
    return null;
  } catch (e) { return 'Invalid date format'; }
}

app.post('/api/compare-routes', async (req, res) => {
  try {
    const { origin, destination, atTime } = req.body || {};
    
    // Validate origin
    const originError = validateCoordinates(origin?.lat, origin?.lng, 'Origin');
    if (originError) return res.status(400).json({ error: originError });
    
    // Validate destination
    const destError = validateCoordinates(destination?.lat, destination?.lng, 'Destination');
    if (destError) return res.status(400).json({ error: destError });
    
    // Validate date/time
    const dateError = validateDateTime(atTime);
    if (dateError) return res.status(400).json({ error: dateError });
    const { startDate, startTime } = dateTime(atTime); const routes = await getAlternativeRoutes(origin, destination);
    const enriched = await Promise.all(routes.map(async (route, routeId) => {
      const corridor = routeToCorridor(route.geometry); const common = { startDate, startTime, filterType: 1, granularity: 60 };
      // Submit tcm + exceedance concurrently per route (was serial: tcm queue
      // then exceedance queue — that roughly doubled per-route wall time).
      const [tcm, hoursAboveThreshold] = await Promise.all([
        heatmapCached(corridor, { ...common, analyticType: 'tcm' }),
        (async () => { try { const ex = await heatmapCached(corridor, { startDate, filterType: 3, granularity: 60, analyticType: 'exceedance', threshold: 35, direction: 'above' }); return metric(ex, 'Mean'); } catch (e) { console.warn('Exceedance failed:', e.message); return null; } })()
      ]);
      // map_data = per-60m-cell temperature grid returned with every tcm
      // result. We derive the "% of corridor above 35°C right now" stat and
      // forward a lightweight copy of the grid to the frontend for the
      // heat-map overlay — both at zero extra API cost.
      const cells = tcm?.map_data?.features || [];
      const pctAbove35 = cells.length
        ? Math.round((cells.filter(c => Number(c?.properties?.average_temperature) > 35).length / cells.length) * 100)
        : null;
      const heatGrid = cells.length
        ? { type: 'FeatureCollection', features: cells.map(c => ({ type: 'Feature', properties: { t: Number(c?.properties?.average_temperature) }, geometry: c.geometry })) }
        : null;
      // Standard deviation = how unevenly heat is spread along the corridor
      // ("steady heat" vs "cool pockets") — zero extra cost, part of stats_data.
      const spread = Number(tcm?.stats_data?.temperature_stats?.standard_deviation ?? tcm?.stats_data?.Temperature_stats?.Standard_deviation) || null;
      return { routeId, geometry: route.geometry, durationSeconds: route.duration, distanceMeters: route.distance, avgTemp: metric(tcm, 'Mean'), maxTemp: metric(tcm, 'Maximum'), spread, hoursAboveThreshold, pctAbove35, heatGrid };    }));
    const coolest = enriched.reduce((a,b) => (a.avgTemp == null ? b : b.avgTemp == null ? a : a.avgTemp < b.avgTemp ? a : b)); let feelsLike = null;
    try { const mid = routeMidpoint(routes[coolest.routeId].geometry); const env = await envParamsCached(mid.lat, mid.lng, coolest.avgTemp, { startDate, startTime, analysis: ['heat_index_celsius','wet_bulb_temperature_celsius','relative_humidity_percent'] }); feelsLike = env?.locations?.[0]?.parameters || null; } catch (e) { console.warn('Feels-like failed:', e.message); }
    res.json({ routes: enriched, coolestRouteId: coolest.routeId, feelsLike, analyzedAt: { startDate, startTime } });
  } catch (e) { console.error(e); res.status(500).json({ error: e.response?.data?.message || e.message || 'Route comparison failed' }); }
});

// Best-departure planner: probes the +12h forecast window for the coolest
// route's corridor and recommends the coolest hour to leave. Runs tcm at
// +2/+4/+6h (each cached per corridor+hour) plus today's continuous >35°C
// exposure (persistence, filter_type 3) — all submitted in parallel.
app.post('/api/departure-window', async (req, res) => {
  try {
    const { origin, destination, atTime } = req.body || {};
    const oErr = validateCoordinates(origin?.lat, origin?.lng, 'Origin'); if (oErr) return res.status(400).json({ error: oErr });
    const dErr = validateCoordinates(destination?.lat, destination?.lng, 'Destination'); if (dErr) return res.status(400).json({ error: dErr });
    const tErr = validateDateTime(atTime); if (tErr) return res.status(400).json({ error: tErr });
    const base = dateTime(atTime);
    const routes = await getAlternativeRoutes(origin, destination);
    const corridors = routes.map(r => routeToCorridor(r.geometry));
    // Base-hour temps are cached from /api/compare-routes, so this is instant;
    // use them to pick which corridor to forecast.
    const baseTemps = await Promise.all(corridors.map(c =>
      heatmapCached(c, { startDate: base.startDate, startTime: base.startTime, filterType: 1, granularity: 60, analyticType: 'tcm' })
        .then(t => metric(t, 'Mean')).catch(() => null)));
    let coolIdx = 0; baseTemps.forEach((t, i) => { if (t != null && (baseTemps[coolIdx] == null || t < baseTemps[coolIdx])) coolIdx = i; });
    const corridor = corridors[coolIdx];
    const probes = [2, 4, 6].map(h => ({ offset: h, ...shiftHours(base.startDate, base.startTime, h) }));
    const [future, persistenceHours] = await Promise.all([
      Promise.all(probes.map(p => heatmapCached(corridor, { startDate: p.startDate, startTime: p.startTime, filterType: 1, granularity: 60, analyticType: 'tcm' }).then(t => metric(t, 'Mean')).catch(() => null))),
      heatmapCached(corridor, { startDate: base.startDate, filterType: 3, granularity: 60, analyticType: 'persistence', threshold: 35, direction: 'above' })
        .then(t => metric(t, 'Mean')).catch(() => null)
    ]);
    const hours = [0, 2, 4, 6].map((offset, i) => ({
      offset,
      label: shiftHours(base.startDate, base.startTime, offset).startTime + ' UTC',
      temp: i === 0 ? baseTemps[coolIdx] : future[i - 1],
    }));
    const valid = hours.filter(h => h.temp != null);
    let best = valid[0] || null; valid.forEach(h => { if (h.temp < best.temp) best = h; });
    const now = valid.find(h => h.offset === 0);
    const saving = best && now && best.offset !== 0 && now.temp != null ? Math.round((now.temp - best.temp) * 10) / 10 : 0;
    res.json({ coolestRouteId: coolIdx, hours, best, saving, persistenceHours });
  } catch (e) { console.error(e); res.status(500).json({ error: e.response?.data?.message || e.message || 'Departure window failed' }); }
});

// Plan probe — Satellite Segmentation is Premium-only: a 200 means the key
// has Premium access, 403 means Basic (every feature we ship works on Basic).
app.get('/api/plan', async (_, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch('https://api.fortyguard.com/v1/satellite', {
      method: 'POST',
      headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sat: { latitude: 46.5857, longitude: -112.0184 }, date_time: { start_date: today, start_time: '14:00', filter_type: 1 }, granularity: 80 }),
      signal: AbortSignal.timeout(20000),
    });
    res.json({ premium: r.status === 200, probe: r.status, body: await r.json().catch(() => null) });
  } catch (e) {
    res.json({ premium: false, probe: e.cause?.code || e.name || 'network-error', body: e.message });
  }
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), err => err && res.status(404).send('Frontend build not found. Run: cd frontend; npm run build'));
});
const port = Number(process.env.PORT) || 4000; app.listen(port, () => console.log(`ShadeRoute backend running on port ${port}`));
