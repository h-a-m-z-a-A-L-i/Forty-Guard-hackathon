/**
 * RAW FortyGuard client for verification.
 *
 * IMPORTANT: intentionally NO cache — every call hits the live API so the
 * pipeline measures what the user would actually get on a cold request.
 * Mirrors the request shapes used by backend/lib/fortyguard.js.
 */
const axios = require('axios');
const BASE = 'https://api.fortyguard.com/v1';

function headers() {
  const key = process.env.FORTYGUARD_API_KEY || process.env.api;
  if (!key) throw new Error('FortyGuard API key not found. Add FORTYGUARD_API_KEY to the project root .env');
  return { 'api-key': key, 'Content-Type': 'application/json' };
}

async function submitHeatmap(polygonCoords, opts) {
  const { startDate, startTime, endTime, endDate, filterType = 1, granularity = 60, analyticType = 'tcm', threshold, direction } = opts;
  const payload = {
    polygon_aoi: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } }] },
    date_time: { start_date: startDate, ...(startTime && { start_time: startTime }), ...(endTime && { end_time: endTime }), ...(endDate && { end_date: endDate }), filter_type: filterType },
    granularity,
    ...(analyticType !== 'tcm' && { analytic_type: analyticType }),
    ...(threshold !== undefined && { threshold }),
    ...(direction && { direction })
  };
  const res = await axios.post(`${BASE}/heatmap`, payload, { headers: headers(), timeout: 30000 });
  const id = res.data?.data?.activity_id;
  if (!id) throw new Error(res.data?.message || 'FortyGuard did not return an activity id');
  return id;
}

async function submitEnvParams(lat, lng, temperature, opts) {
  const { startDate, startTime, filterType = 1, analysis } = opts;
  const res = await axios.post(`${BASE}/env_params`, {
    latitude: lat, longitude: lng, temperature,
    date_time: { start_date: startDate, start_time: startTime, filter_type: filterType },
    analysis
  }, { headers: headers(), timeout: 30000 });
  return res.data.data.activity_id;
}

async function pollResult(activityId, { maxAttempts = 40, fastIntervalMs = 500, fastAttempts = 8, intervalMs = 1500 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const delay = i < fastAttempts ? fastIntervalMs : intervalMs;
    let res;
    try {
      res = await axios.get(`${BASE}/status/${activityId}`, { headers: headers(), timeout: 30000 });
    } catch (e) {
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

async function heatmap(polygonCoords, opts) {
  const id = await submitHeatmap(polygonCoords, opts);
  return pollResult(id);
}

/** Mirrors server.js metric(): handles the 3 known response shapes. */
function metric(result, key) {
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
  const values = result?.map_data?.features?.map(f => Number(f?.properties?.[field])).filter(Number.isFinite) || [];
  if (!values.length) return null;
  return key === 'Minimum' ? Math.min(...values) : key === 'Maximum' ? Math.max(...values) : values.reduce((s, v) => s + v, 0) / values.length;
}

module.exports = { submitHeatmap, submitEnvParams, pollResult, heatmap, metric };
