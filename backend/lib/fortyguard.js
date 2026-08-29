const axios = require('axios');
const crypto = require('crypto');
const BASE = 'https://api.fortyguard.com/v1';
const API_KEY = process.env.FORTYGUARD_API_KEY || process.env.api;
function headers() { return { 'api-key': API_KEY, 'Content-Type': 'application/json' }; }

/* ------------------------------------------------------------------
 * In-memory LRU result cache.
 *
 * FortyGuard results are immutable for a given hour, and the same
 * origin/destination pairs (especially the demo route) get requested
 * repeatedly. Caching turns repeat requests from ~20-40s into ~0ms.
 * Keyed by a hash of polygon + date/time + analytic options.
 * ------------------------------------------------------------------ */
const cache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
function cacheKey(polygonCoords, opts) {
  const hash = crypto.createHash('sha1')
    .update(JSON.stringify({ polygonCoords, opts }))
    .digest('hex');
  return hash;
}
function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // evict oldest
  cache.set(key, { at: Date.now(), value });
}

async function submitHeatmap(polygonCoords, opts) {
  const { startDate, startTime, endTime, endDate, filterType = 1, granularity = 60, analyticType = 'tcm', threshold, direction } = opts;
  const payload = { polygon_aoi: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } }] }, date_time: { start_date: startDate, ...(startTime && { start_time: startTime }), ...(endTime && { end_time: endTime }), ...(endDate && { end_date: endDate }), filter_type: filterType }, granularity, ...(analyticType !== 'tcm' && { analytic_type: analyticType }), ...(threshold !== undefined && { threshold }), ...(direction && { direction }) };
  const res = await axios.post(`${BASE}/heatmap`, payload, { headers: headers(), timeout: 30000 });
  const id = res.data?.data?.activity_id;
  if (!id) throw new Error(res.data?.message || 'FortyGuard did not return an activity id');
  return id;
}
async function submitEnvParams(lat, lng, temperature, opts) {
  const { startDate, startTime, filterType = 1, analysis } = opts;
  const res = await axios.post(`${BASE}/env_params`, { latitude: lat, longitude: lng, temperature, date_time: { start_date: startDate, start_time: startTime, filter_type: filterType }, analysis }, { headers: headers(), timeout: 30000 });
  return res.data.data.activity_id;
}
async function envParamsCached(lat, lng, temperature, opts) {
  const key = cacheKey({ lat, lng, temperature }, opts);
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const id = await submitEnvParams(lat, lng, temperature, opts);
  const result = await pollResult(id);
  cacheSet(key, result);
  return result;
}
async function pollResult(activityId, { maxAttempts = 40, fastIntervalMs = 500, fastAttempts = 8, intervalMs = 1500 } = {}) {
  // Adaptive polling: most activities complete in 5-30s. Poll fast at first
  // (500ms x8) so a quick completion is caught almost immediately, then fall
  // back to 1.5s. The old fixed 2.5s interval added up to 2.5s of dead time
  // after every completion.
  for (let i = 0; i < maxAttempts; i++) {
    const delay = i < fastAttempts ? fastIntervalMs : intervalMs;
    let res;
    try {
      res = await axios.get(`${BASE}/status/${activityId}`, { headers: headers(), timeout: 30000 });
    } catch (e) {
      // Transient "Activity not found" (404) — the activity may not be registered yet.
      if (e.response?.status === 404 && i < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
    const status = res.data?.data?.status;
    if (status === 'Completed') return res.data.data.result;
    if (status === 'Failed') throw new Error(`FortyGuard activity failed: ${res.data?.message || activityId}`);
    if (i < maxAttempts - 1) await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error(`FortyGuard activity timed out after ${maxAttempts} attempts`);
}

/* Cached variants used by the route-comparison flow */
async function heatmapCached(polygonCoords, opts) {
  const key = cacheKey(polygonCoords, opts);
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const id = await submitHeatmap(polygonCoords, opts);
  const result = await pollResult(id);
  cacheSet(key, result);
  return result;
}

module.exports = { submitHeatmap, submitEnvParams, pollResult, heatmapCached, envParamsCached, _cache: cache };
