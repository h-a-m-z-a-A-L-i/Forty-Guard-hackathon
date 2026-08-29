/**
 * Route fetching — same endpoints the app uses (mirrors backend/lib/osrm.js),
 * but independent code so the pipeline is a true black-box test.
 */
const axios = require('axios');

const ENDPOINTS = {
  foot: [
    'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
    'https://router.project-osrm.org/route/v1/foot'
  ],
  driving: ['https://router.project-osrm.org/route/v1/driving']
};

async function getAlternativeRoutes(origin, destination, profile = 'foot') {
  const urls = (ENDPOINTS[profile] || ENDPOINTS.foot).map(
    base => `${base}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
  );
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        params: { alternatives: true, geometries: 'geojson', overview: 'full' },
        timeout: 15000
      });
      if (res.data.code !== 'Ok' || !res.data.routes?.length) {
        lastError = new Error('No routes found for these locations');
        continue;
      }
      return res.data.routes.slice(0, 3).map(({ geometry, duration, distance }) => ({ geometry, duration, distance }));
    } catch (e) {
      lastError = e.response?.status === 400 ? new Error('No routes found for these locations') : e;
      if (e.response?.status === 400) throw lastError;
    }
  }
  throw lastError;
}

module.exports = { getAlternativeRoutes };
