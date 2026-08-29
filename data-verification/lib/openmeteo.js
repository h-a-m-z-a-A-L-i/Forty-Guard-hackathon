/**
 * Independent ground-truth weather source: Open-Meteo (free, no API key).
 * Gives us hourly AIR temperature for any past/current hour at a location.
 *
 * Why is this a good check? FortyGuard reports ROAD-SURFACE temperature
 * (TCM). Surface temps are typically hotter than air temp in daylight
 * (radiant heating), especially on asphalt in summer. So we don't expect
 * exact equality — we expect a bounded, explainable delta. A huge delta
 * (or a delta that flips sign at night) would be a credibility flag.
 */
const axios = require('axios');

async function hourlyAirTemp(lat, lng, isoHourUTC) {
  // isoHourUTC like "2026-08-29T14:00:00Z"
  const target = new Date(isoHourUTC);
  if (Number.isNaN(target.getTime())) throw new Error(`Bad hour: ${isoHourUTC}`);
  const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: lat, longitude: lng,
      hourly: 'temperature_2m',
      past_days: 3, forecast_days: 1,
      timezone: 'UTC'
    },
    timeout: 15000
  });
  const times = res.data?.hourly?.time || [];
  const temps = res.data?.hourly?.temperature_2m || [];
  const idx = times.findIndex(t => t === target.toISOString().slice(0, 13) + ':00');
  if (idx === -1 || idx >= temps.length) return { matched: false, tempC: null };
  return { matched: true, tempC: temps[idx] };
}

module.exports = { hourlyAirTemp };
