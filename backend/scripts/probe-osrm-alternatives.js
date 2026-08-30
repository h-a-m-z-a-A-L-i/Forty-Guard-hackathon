// Probe: how many routes does OSRM return for Bozeman → Livingston (and a short route)
// at various alternatives= values? Also test via-point rerouting for guaranteed 3.
const axios = require('axios');
const ENDPOINTS = [
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  'https://router.project-osrm.org/route/v1/foot'
];
const pairs = [
  ['Bozeman->Livingston', '-111.0429,45.6770;-110.5585,45.6624'],
  ['Bozeman->Belgrade', '-111.0429,45.6770;-111.1769,45.7760'],
];
(async () => {
  for (const [name, coords] of pairs) {
    for (const base of ENDPOINTS) {
      for (const alt of [1, 2, 3, 5]) {
        try {
          const res = await axios.get(`${base}/${coords}`, { params: { alternatives: alt, geometries: 'geojson', overview: 'full' }, timeout: 20000 });
          const routes = (res.data.routes || []).map(r => ({ d: r.duration, dist: r.distance, n: r.geometry.coordinates.length }));
          console.log(`${name} | ${base.split('/')[2]} | alt=${alt} -> ${routes.length} routes:`, JSON.stringify(routes.slice(0, 4)));
        } catch (e) {
          console.log(`${name} | ${base.split('/')[2]} | alt=${alt} -> ERROR ${e.response?.status || e.message}`);
        }
      }
    }
  }
})();
