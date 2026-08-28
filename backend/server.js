require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
if (!process.env.FORTYGUARD_API_KEY && !process.env.api) {
  const fs = require('fs');
  const rawEnv = fs.readFileSync(require('path').resolve(__dirname, '../.env'), 'utf8');
  const match = rawEnv.match(/['"]?api['"]?\s*=\s*["']?([^"'\r\n\s]+)["']?/i);
  if (match) process.env.api = match[1];
}
const express = require('express'); const cors = require('cors'); const path = require('path');
const { submitHeatmap, submitEnvParams, pollResult } = require('./lib/fortyguard');
const { routeToCorridor, routeMidpoint } = require('./lib/corridor'); const { getAlternativeRoutes } = require('./lib/osrm');
const app = express(); app.use(cors()); app.use(express.json());
const API_KEY = process.env.FORTYGUARD_API_KEY || process.env.api;
const frontendDist = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
const pad = n => String(n).padStart(2, '0');
function dateTime(value) { const d = value ? new Date(value) : new Date(); if (Number.isNaN(d.getTime())) throw new Error('Invalid atTime'); return { startDate: `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`, startTime: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }; }
function metric(result, key) {
  const direct = Number(result?.stats_data?.Temperature_stats?.[key]);
  if (Number.isFinite(direct)) return direct;
  const field = { Mean: 'average_temperature', Minimum: 'min_temperature', Maximum: 'max_temperature' }[key];
  const values = result?.map_data?.features?.map(feature => Number(feature?.properties?.[field])).filter(Number.isFinite) || [];
  if (!values.length) return null;
  return key === 'Minimum' ? Math.min(...values) : key === 'Maximum' ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0) / values.length;
}
app.get('/api/health', (_, res) => res.json({ ok: true, apiConfigured: Boolean(API_KEY) }));
app.post('/api/compare-routes', async (req, res) => {
  try {
    const { origin, destination, atTime } = req.body || {};
    if (![origin, destination].every(p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)))) return res.status(400).json({ error: 'Origin and destination must include valid lat/lng' });
    if (!API_KEY) return res.status(500).json({ error: 'FortyGuard API key is not configured' });
    const { startDate, startTime } = dateTime(atTime); const routes = await getAlternativeRoutes(origin, destination);
    const enriched = await Promise.all(routes.map(async (route, routeId) => {
      const corridor = routeToCorridor(route.geometry); const common = { startDate, startTime, filterType: 1, granularity: 60 };
      const tcm = await pollResult(await submitHeatmap(corridor, { ...common, analyticType: 'tcm' }));
      let hoursAboveThreshold = null; try { const ex = await pollResult(await submitHeatmap(corridor, { startDate, filterType: 3, granularity: 60, analyticType: 'exceedance', threshold: 35, direction: 'above' })); hoursAboveThreshold = metric(ex, 'Mean'); } catch (e) { console.warn('Exceedance failed:', e.message); }
      return { routeId, geometry: route.geometry, durationSeconds: route.duration, distanceMeters: route.distance, avgTemp: metric(tcm, 'Mean'), maxTemp: metric(tcm, 'Maximum'), hoursAboveThreshold };
    }));
    const coolest = enriched.reduce((a,b) => (a.avgTemp == null ? b : b.avgTemp == null ? a : a.avgTemp < b.avgTemp ? a : b)); let feelsLike = null;
    try { const mid = routeMidpoint(routes[coolest.routeId].geometry); const env = await pollResult(await submitEnvParams(mid.lat, mid.lng, coolest.avgTemp, { startDate, startTime, analysis: ['heat_index_celsius','apparent_temperature_celsius','relative_humidity_percent'] })); feelsLike = env?.locations?.[0]?.parameters || null; } catch (e) { console.warn('Feels-like failed:', e.message); }
    res.json({ routes: enriched, coolestRouteId: coolest.routeId, feelsLike, analyzedAt: { startDate, startTime } });
  } catch (e) { console.error(e); res.status(500).json({ error: e.response?.data?.message || e.message || 'Route comparison failed' }); }
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), err => err && res.status(404).send('Frontend build not found. Run: cd frontend; npm run build'));
});
const port = Number(process.env.PORT) || 4000; app.listen(port, () => console.log(`ShadeRoute backend running on port ${port}`));
