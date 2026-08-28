const axios = require('axios');
async function getAlternativeRoutes(origin, destination, profile = 'foot') {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  let res;
  try {
    res = await axios.get(url, { params: { alternatives: true, geometries: 'geojson', overview: 'full' }, timeout: 30000 });
  } catch (e) {
    if (e.response?.status === 400) throw new Error('No routes found for these locations');
    throw e;
  }
  if (res.data.code !== 'Ok' || !res.data.routes?.length) throw new Error('No routes found for these locations');
  return res.data.routes.slice(0, 3).map(({ geometry, duration, distance }) => ({ geometry, duration, distance }));
}
module.exports = { getAlternativeRoutes };
