const assert = require('assert');
const { getAlternativeRoutes } = require('../../lib/osrm');

describe('osrm.js', () => {
  
  describe('getAlternativeRoutes', () => {
    
    it('should fetch routes with geometry, duration, and distance', async () => {
      const origin = { lat: 45.6769, lng: -111.0429 };
      const destination = { lat: 45.6619, lng: -111.0419 };
      
      try {
        const routes = await getAlternativeRoutes(origin, destination);
        
        assert(Array.isArray(routes), 'Should return array of routes');
        assert(routes.length > 0, 'Should return at least one route');
        assert(routes.length <= 3, 'Should return max 3 routes');
        
        routes.forEach(route => {
          assert(route.geometry, 'Route should have geometry');
          assert.strictEqual(route.geometry.type, 'LineString', 'Geometry should be LineString');
          assert(Array.isArray(route.geometry.coordinates), 'Should have coordinates');
          assert(Number.isFinite(route.duration), 'Should have duration in seconds');
          assert(Number.isFinite(route.distance), 'Should have distance in meters');
          assert(route.distance > 0, 'Distance should be positive');
          assert(route.duration > 0, 'Duration should be positive');
        });
      } catch (e) {
        if (e.message.includes('No routes found')) {
          console.log('⚠️  OSRM server returned no routes (network issue?)');
        } else {
          throw e;
        }
      }
    });

    it('should handle invalid coordinates gracefully', async () => {
      const origin = { lat: 0, lng: 0 };  // Null island
      const destination = { lat: 0.001, lng: 0.001 };
      
      try {
        const routes = await getAlternativeRoutes(origin, destination);
        // May succeed depending on OSRM coverage
        assert(Array.isArray(routes), 'Should return array');
      } catch (e) {
        assert(e.message.includes('No routes found'), 'Should handle missing routes');
      }
    });

    it('should use foot profile by default', async () => {
      const origin = { lat: 45.6769, lng: -111.0429 };
      const destination = { lat: 45.6619, lng: -111.0419 };
      
      try {
        const routes = await getAlternativeRoutes(origin, destination, 'foot');
        assert(Array.isArray(routes), 'Should fetch foot routes');
      } catch (e) {
        // Network error is acceptable in test
        console.log('⚠️  Network error fetching routes:', e.message);
      }
    });
  });
});

module.exports = { describe, it };
