const axios = require('axios');
const BASE = 'https://api.fortyguard.com/v1';
const API_KEY = process.env.FORTYGUARD_API_KEY || process.env.api;
function headers() { return { 'api-key': API_KEY, 'Content-Type': 'application/json' }; }
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
async function pollResult(activityId, { maxAttempts = 40, intervalMs = 2500 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await axios.get(`${BASE}/status/${activityId}`, { headers: headers(), timeout: 30000 });
    const status = res.data?.data?.status;
    if (status === 'Completed') return res.data.data.result;
    if (status === 'Failed') throw new Error(`FortyGuard activity failed: ${res.data?.message || activityId}`);
    if (i < maxAttempts - 1) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`FortyGuard activity timed out after ${maxAttempts} attempts`);
}
module.exports = { submitHeatmap, submitEnvParams, pollResult };
