/**
 * Nominatim geocoding — turns free-text addresses into coordinates.
 * NOTE: geocoding is NOT part of what we verify (it is user input UX);
 * it only lets the pipeline run scenarios from addresses, like the app does.
 */
const axios = require('axios');

async function geocode(query) {
  if (!query) throw new Error('Empty geocode query');
  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: query, format: 'json', limit: 1 },
    headers: { 'User-Agent': 'ShadeRoute-data-verification/1.0' },
    timeout: 15000
  });
  const hit = res.data?.[0];
  if (!hit) throw new Error(`Geocoding failed for "${query}"`);
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: hit.display_name?.split(',').slice(0, 3).join(',') || query
  };
}

module.exports = { geocode };
