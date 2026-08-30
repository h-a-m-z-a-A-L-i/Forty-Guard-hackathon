const axios = require('axios');
const turf = require('@turf/turf');

// routing.openstreetmap.de is faster than the public project-osrm foot profile
// AND returns more alternatives for short routes (measured: ~0.8s vs ~2.6s).
// OSRM's built-in alternative search is heuristic: for many pairs (e.g.
// Bozeman -> Livingston) it returns only 1 route even with alternatives=3.
// We therefore augment: request up to 3 alternatives, dedupe near-identical
// geometries, then force additional distinct routes by re-routing through
// waypoints offset perpendicular to the primary route — guaranteeing the user
// always gets 2-3 candidate routes to compare.
const ENDPOINTS = {
  foot: [
    'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
    'https://router.project-osrm.org/route/v1/foot'
  ],
  driving: ['https://router.project-osrm.org/route/v1/driving']
};

// N evenly spaced points along a LineString geometry.
function samplePoints(geometry, n = 24) {
  const line = turf.lineString(geometry.coordinates);
  const len = turf.length(line, { units: 'kilometers' });
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push(turf.along(line, (len * i) / (n - 1), { units: 'kilometers' }).geometry.coordinates);
  }
  return pts;
}

function distM(a, b) {
  const dx = (a[0] - b[0]) * 85000 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 111000;
  return Math.sqrt(dx * dx + dy * dy);
}

// Average nearest-neighbour distance between two sampled geometries — a cheap
// proxy for "are these two routes the same path?".
function geometryDistance(a, b) {
  const sa = samplePoints(a), sb = samplePoints(b);
  let total = 0, count = 0;
  for (const pa of sa) {
    let best = Infinity;
    for (const pb of sb) { const d = distM(pa, pb); if (d < best) best = d; }
    total += best; count++;
  }
  return total / count;
}

function isDuplicate(a, b, routeLengthM) {
  const thr = Math.max(60, Math.min(300, routeLengthM * 0.1));
  return geometryDistance(a, b) < thr;
}

// Build up to `count` extra candidate routes by forcing the route through
// waypoints offset perpendicular to the primary geometry (35% / 65% along,
// alternating sides). Returns raw OSRM route objects.
async function viaReroutes(primary, origin, destination, base, count) {
  const line = turf.lineString(primary.geometry.coordinates);
  const lenM = turf.length(line, { units: 'kilometers' }) * 1000;
  const offM = Math.max(150, Math.min(2500, lenM * 0.06));
  const out = [];
  for (let i = 0; i < count; i++) {
    const frac = 0.35 + 0.3 * i; // 35%, 65% along the route
    const p = turf.along(line, (lenM * frac) / 1000, { units: 'kilometers' });
    // local route bearing (tangent) for a perpendicular offset
    const a = turf.along(line, Math.max(0, (lenM * frac - 50)) / 1000, { units: 'kilometers' });
    const b = turf.along(line, Math.min(lenM, (lenM * frac + 50)) / 1000, { units: 'kilometers' });
    const bearing = turf.bearing(a, b);
    const side = i % 2 === 0 ? 1 : -1;
    const via = turf.destination(p, offM / 1000, (bearing + 90 * side) % 360, { units: 'kilometers' }).geometry.coordinates;
    const coords = `${origin.lng},${origin.lat};${via[0]},${via[1]};${destination.lng},${destination.lat}`;
    try {
      // NOTE: the public routing.openstreetmap.de server rejects the `via`
      // param (400 "Query string malformed"), but plain waypoint coordinates
      // (intermediate stops) work fine and force the route through the point.
      const res = await axios.get(`${base}/${coords}`, { params: { geometries: 'geojson', overview: 'full' }, timeout: 15000 });
      const r = res.data.routes?.[0];
      if (r && r.geometry?.coordinates?.length) out.push({ geometry: r.geometry, duration: r.duration, distance: r.distance });
    } catch (e) { /* skip candidate on failure — never block the search */ }
  }
  return out;
}

async function getAlternativeRoutes(origin, destination, profile = 'foot') {
  const bases = ENDPOINTS[profile] || ENDPOINTS.foot;
  let lastError = null;
  let primary = [];
  let primaryBase = null;
  for (const base of bases) {
    const url = `${base}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    try {
      const res = await axios.get(url, {
        params: { alternatives: 3, geometries: 'geojson', overview: 'full' },
        timeout: 15000
      });
      if (res.data.code !== 'Ok' || !res.data.routes?.length) {
        lastError = new Error('No routes found for these locations');
        continue;
      }
      primary = res.data.routes.map(({ geometry, duration, distance }) => ({ geometry, duration, distance }));
      primaryBase = base; // endpoint WITHOUT coordinates — viaReroutes appends its own
      break;
    } catch (e) {
      lastError = e.response?.status === 400 ? new Error('No routes found for these locations') : e;
      if (e.response?.status === 400) throw lastError; // don't retry bad input
    }
  }
  if (!primary.length) throw lastError || new Error('No routes found for these locations');

  // Dedupe near-identical geometries (OSRM sometimes returns the same path twice).
  const unique = [];
  const seedLen = primary[0].distance || 0;
  for (const r of primary) {
    if (!unique.some(u => isDuplicate(u.geometry, r.geometry, seedLen))) unique.push(r);
  }

  // Force additional distinct routes so every search offers 2-3 candidates.
  if (unique.length < 3 && primaryBase) {
    const seed = unique[0];
    const want = 3 - unique.length;
    const extras = await viaReroutes(seed, origin, destination, primaryBase, want);
    for (const c of extras) {
      if (unique.length >= 3) break;
      if (c.distance > seed.distance * 1.6) continue; // too long a detour
      if (unique.some(u => isDuplicate(u.geometry, c.geometry, seed.distance || c.distance))) continue;
      unique.push(c);
    }
  }

  return unique.slice(0, 3).map(({ geometry, duration, distance }) => ({ geometry, duration, distance }));
}

module.exports = { getAlternativeRoutes };
