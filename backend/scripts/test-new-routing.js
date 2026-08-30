// Test the new getAlternativeRoutes (alternatives=3 + via-point augmentation)
// for pairs that previously returned only 1 route.
const { getAlternativeRoutes } = require('../lib/osrm');

const pairs = [
  ['Bozeman->Livingston', { lat: 45.6770, lng: -111.0429 }, { lat: 45.6624, lng: -110.5585 }],
  ['Bozeman->Belgrade', { lat: 45.6770, lng: -111.0429 }, { lat: 45.7760, lng: -111.1769 }],
  ['MSU->Museum', { lat: 45.6681, lng: -111.0493 }, { lat: 45.6630, lng: -111.0483 }],
];

(async () => {
  for (const [name, o, d] of pairs) {
    const t0 = Date.now();
    try {
      const routes = await getAlternativeRoutes(o, d);
      console.log(`${name}: ${routes.length} routes (${Date.now() - t0}ms)`);
      routes.forEach((r, i) => console.log(`  [${i}] dist=${Math.round(r.distance)}m dur=${Math.round(r.duration)}s pts=${r.geometry.coordinates.length}`));
    } catch (e) {
      console.log(`${name}: ERROR ${e.message}`);
    }
  }
})();
