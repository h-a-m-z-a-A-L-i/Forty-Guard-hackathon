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
      return { routeId, geometry: route.geometry, durationSeconds: route.duration, distanceMeters: route.distance, avgTemp: metric(tcm, 'Mean'), maxTemp: metric(tcm, 'Maximum'), hoursAboveThreshold };    }));
    const coolest = enriched.reduce((a,b) => (a.avgTemp == null ? b : b.avgTemp == null ? a : a.avgTemp < b.avgTemp ? a : b)); let feelsLike = null;
    try { const mid = routeMidpoint(routes[coolest.routeId].geometry); const env = await envParamsCached(mid.lat, mid.lng, coolest.avgTemp, { startDate, startTime, analysis: ['heat_index_celsius','apparent_temperature_celsius','relative_humidity_percent'] }); feelsLike = env?.locations?.[0]?.parameters || null; } catch (e) { console.warn('Feels-like failed:', e.message); }
    res.json({ routes: enriched, coolestRouteId: coolest.routeId, feelsLike, analyzedAt: { startDate, startTime } });
  } catch (e) { console.error(e); res.status(500).json({ error: e.response?.data?.message || e.message || 'Route comparison failed' }); }
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), err => err && res.status(404).send('Frontend build not found. Run: cd frontend; npm run build'));
});
const port = Number(process.env.PORT) || 4000; app.listen(port, () => console.log(`ShadeRoute backend running on port ${port}`));
