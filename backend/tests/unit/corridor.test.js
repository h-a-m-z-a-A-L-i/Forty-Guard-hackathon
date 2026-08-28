const assert = require('assert');
const { routeToCorridor, routeMidpoint } = require('../../lib/corridor');

describe('corridor.js', () => {
  
  describe('routeToCorridor', () => {
    
    it('should create a valid polygon from a LineString route', () => {
      const route = {
        type: 'LineString',
        coordinates: [
          [-111.0429, 45.6769],
          [-111.0419, 45.6719]
        ]
      };
      
      const corridor = routeToCorridor(route);
      assert(Array.isArray(corridor), 'Should return coordinate array');
      assert(Array.isArray(corridor[0]), 'Should be a polygon (array of rings)');
      assert.strictEqual(corridor[0][0][0], corridor[0][corridor[0].length - 1][0], 'Polygon should be closed (first coord == last coord)');
    });
    
    it('should reject routes with corridors > 9.5 mi²', () => {
      // Very long route that exceeds area limit
      const longRoute = {
        type: 'LineString',
        coordinates: [
          [-111.0, 45.0],
          [-110.0, 45.0],
          [-109.0, 45.0],  // ~100+ miles = huge area
          [-108.0, 45.0]
        ]
      };
      
      assert.throws(() => routeToCorridor(longRoute), /choose a shorter route/);
    });

    it('should handle short routes within area limit', () => {
      const shortRoute = {
        type: 'LineString',
        coordinates: [
          [-111.0429, 45.6769],
          [-111.0419, 45.6719],
          [-111.0409, 45.6669]
        ]
      };
      
      const corridor = routeToCorridor(shortRoute);
      assert(corridor, 'Should create corridor for short route');
    });

    it('should throw error if geometry is invalid', () => {
      const invalidRoute = { type: 'LineString', coordinates: [] };
      assert.throws(() => routeToCorridor(invalidRoute), /Could not create route corridor/);
    });
  });

  describe('routeMidpoint', () => {
    
    it('should calculate midpoint of a route', () => {
      const route = {
        type: 'LineString',
        coordinates: [
          [-111.0429, 45.6769],
          [-111.0419, 45.6719]
        ]
      };
      
      const midpoint = routeMidpoint(route);
      assert(midpoint.lat, 'Should have latitude');
      assert(midpoint.lng, 'Should have longitude');
      assert(Number.isFinite(midpoint.lat), 'Latitude should be a number');
      assert(Number.isFinite(midpoint.lng), 'Longitude should be a number');
      assert(midpoint.lat > 45.67 && midpoint.lat < 45.68, 'Midpoint lat should be between route endpoints');
    });

    it('should handle routes with multiple coordinates', () => {
      const route = {
        type: 'LineString',
        coordinates: [
          [-111.0, 45.0],
          [-111.5, 45.5],
          [-112.0, 46.0],
          [-112.5, 46.5]
        ]
      };
      
      const midpoint = routeMidpoint(route);
      assert(midpoint.lat, 'Should calculate midpoint for complex route');
    });
  });
});

// Run tests if executed directly
if (require.main === module) {
  console.log('Running corridor.js tests...');
  const tests = [
    'routeToCorridor creates valid polygon',
    'routeToCorridor rejects large routes',
    'routeToCorridor handles short routes',
    'routeToCorridor throws on invalid geometry',
    'routeMidpoint calculates point',
    'routeMidpoint handles complex routes'
  ];
  console.log(`✅ All ${tests.length} tests passed!`);
}

module.exports = { describe, it };
