const turf = require('@turf/turf');
const MAX_AREA_MI2 = 9.5;
function routeToCorridor(geometry, bufferMeters = 60) {
  const buffered = turf.buffer(turf.feature(geometry), bufferMeters / 1000, { units: 'kilometers' });
  if (!buffered?.geometry?.coordinates?.length) throw new Error('Could not create route corridor');
  const areaMi2 = turf.area(buffered) / 2589988;
  if (areaMi2 > MAX_AREA_MI2) throw new Error(`Route corridor is ${areaMi2.toFixed(2)} mi²; choose a shorter route`);
  return buffered.geometry.coordinates;
}
function routeMidpoint(geometry) { const mid = turf.along(turf.feature(geometry), turf.length(turf.feature(geometry), { units: 'kilometers' }) / 2, { units: 'kilometers' }); return { lat: mid.geometry.coordinates[1], lng: mid.geometry.coordinates[0] }; }
module.exports = { routeToCorridor, routeMidpoint };
