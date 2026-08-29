/**
 * Corridor building — mirrors backend/lib/corridor.js so we verify the SAME
 * geometry the app feeds to FortyGuard.
 */
const turf = require('@turf/turf');
const MAX_AREA_MI2 = 9.5;
const SIMPLIFY_TOLERANCE = 0.0005;

function routeToCorridor(geometry, bufferMeters = 60) {
  const buffered = turf.buffer(turf.feature(geometry), bufferMeters / 1000, { units: 'kilometers' });
  if (!buffered?.geometry?.coordinates?.length) throw new Error('Could not create route corridor');
  const areaMi2 = turf.area(buffered) / 2589988;
  if (areaMi2 > MAX_AREA_MI2) throw new Error(`Route corridor is ${areaMi2.toFixed(2)} mi²; choose a shorter route`);
  const simplified = turf.simplify(turf.clone(buffered), { tolerance: SIMPLIFY_TOLERANCE, highQuality: true });
  const coords = simplified?.geometry?.coordinates || buffered.geometry.coordinates;
  return coords;
}

function ringCount(polygonCoords) {
  return polygonCoords?.[0]?.length || 0;
}

module.exports = { routeToCorridor, ringCount };
