/*
 * Standalone FortyGuard API smoke test.
 * This intentionally does not import or modify the ShadeRoute comparison flow.
 * Usage:
 *   node scripts/test-fortyguard.js
 *   node scripts/test-fortyguard.js --analytic=tcm
 *   node scripts/test-fortyguard.js --analytic=exceedance --threshold=35
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
const base = 'https://api.fortyguard.com/v1';
const headers = { 'api-key': apiKey, 'Content-Type': 'application/json' };

// Small corridor around Montana State University, Bozeman.
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

async function submit() {
  const when = currentUtcHour();
  const body = {
    polygon_aoi: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygon } }] },
    date_time: { start_date: when.date, start_time: when.time, filter_type: analytic === 'exceedance' ? 3 : 1 },
    granularity, ...(!args.minimal && analytic !== 'tcm' && { analytic_type: analytic }),
    ...(analytic === 'exceedance' && { threshold, direction: 'above' })
  };
  console.log(JSON.stringify({ endpoint: `${base}/heatmap`, parameters: { ...body, api_key: '[redacted]' } }, null, 2));
  const response = await axios.post(`${base}/heatmap`, body, { headers, timeout: 30000 });
  console.log(`Submit HTTP ${response.status}: ${response.data.message || 'OK'}`);
  const id = response.data?.data?.activity_id;
  if (!id) throw new Error(`No activity_id returned: ${JSON.stringify(response.data)}`);
  return id;
}

async function poll(id) {
  for (let attempt = 1; attempt <= 60; attempt++) {
    const response = await axios.get(`${base}/status/${id}`, { headers, timeout: 30000 });
    const data = response.data?.data || {};
    console.log(`Poll ${attempt}/60: ${data.status || response.data.message || 'unknown'}`);
    if (data.status === 'Completed') return data.result;
    if (data.status === 'Failed') throw new Error(`Activity failed: ${JSON.stringify(response.data)}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Polling timed out after 120 seconds');
}

(async () => {
  console.log(`Testing FortyGuard heatmap: place=${args.place || 'montana'}, analytic_type=${analytic}, granularity=${granularity}`);
  const result = await poll(await submit());
  const stats = result?.stats_data?.Temperature_stats;
  const cellCount = Number(result?.stats_data?.n_cells || result?.map_data?.features?.length || 0);
  const tileValues = result?.map_data?.features?.map(feature => Number(feature?.properties?.average_temperature)).filter(Number.isFinite) || [];
  const hasNumericStats = ['Mean', 'Minimum', 'Maximum'].some(key => Number.isFinite(Number(stats?.[key]))) || tileValues.length > 0;
  if (cellCount === 0 || !hasNumericStats) {
    console.error('\nREAL-DATA VALIDATION FAILED: FortyGuard completed the job but returned no populated cells or numeric statistics.');
    console.error(JSON.stringify({ n_cells: result?.stats_data?.n_cells ?? null, features: result?.map_data?.features?.length ?? null, stats: stats || null }, null, 2));
    fs.writeFileSync(path.resolve(__dirname, 'fortyguard-last-result.json'), JSON.stringify(result, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log('\nCompleted result summary:');
  const fallbackStats = tileValues.length ? { Minimum: Math.min(...tileValues), Maximum: Math.max(...tileValues), Mean: tileValues.reduce((a, b) => a + b, 0) / tileValues.length } : null;
  console.log(JSON.stringify({
    stats: stats || fallbackStats,
    units: result?.stats_data?.units || null,
    mapDataKeys: result?.map_data ? Object.keys(result.map_data) : [],
    distributionSamples: result?.stats_data?.Overall_temperature_distribution?.slice?.(0, 3) || []
  }, null, 2));
  console.log('\nFull result saved to backend/scripts/fortyguard-last-result.json');
  fs.writeFileSync(path.resolve(__dirname, 'fortyguard-last-result.json'), JSON.stringify(result, null, 2));
})().catch(error => {
  console.error('\nFortyGuard test failed:', error.response?.data || error.message);
  process.exitCode = 1;
});
