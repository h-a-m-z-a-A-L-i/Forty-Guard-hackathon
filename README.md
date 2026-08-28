# Forty Guard - Heat-Aware Route Navigation 🌿

A hackathon project that uses hyperlocal temperature data to help you find the **coolest route** between two locations, not just the fastest or shortest.

## Features

✅ **Temperature-aware routing** - Compare 2-3 alternative routes by actual heat exposure  
✅ **Real hyperlocal data** - Uses FortyGuard's granular temperature API (not generic weather)  
✅ **Heat visualization** - SVG map with color-coded routes (blue = cool, red = hot)  
✅ **Route comparison cards** - Shows avg temp, max temp, duration, distance, hours above threshold  
✅ **"Feels like" temperature** - Environmental parameters (heat index, humidity) on coolest route  
✅ **US coverage** - Works anywhere in the United States  

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js + Express |
| **Frontend** | React + Vite |
| **Routing** | OSRM (Open Source Routing Machine) |
| **Temperature Data** | FortyGuard API |
| **Route Buffering** | Turf.js |
| **Geocoding** | Nominatim (OpenStreetMap) |

## Project Structure

```
Forty Guard/
├── backend/
│   ├── server.js                    # Express server + /api/compare-routes endpoint
│   ├── lib/
│   │   ├── fortyguard.js           # FortyGuard API client (heatmap, env_params)
│   │   ├── corridor.js             # Route → buffered polygon conversion
│   │   └── osrm.js                 # OSRM routing client
│   ├── scripts/
│   │   └── test-fortyguard.js      # Manual API testing script
│   ├── tests/
│   │   ├── unit/                   # Unit tests for lib functions
│   │   └── integration/            # End-to-end route comparison tests
│   ├── .env                         # FortyGuard API key (NOT committed)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Main app component
│   │   ├── components/
│   │   │   ├── MapView.jsx         # SVG route visualization
│   │   │   └── RouteComparisonCards.jsx  # Route stats display
│   │   └── api/
│   │       └── client.js           # Axios HTTP client
│   ├── dist/                        # Built frontend (generated)
│   └── package.json
├── shaderoute-build-plan.md        # Original project specification
└── README.md                        # This file
```

## Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn
- FortyGuard API key (free tier available)

### Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/h-a-m-z-a-A-L-i/Forty-Guard-hackathon.git
   cd "Forty Guard"
   ```

2. **Configure API key:**
   ```bash
   # Create backend/.env with your FortyGuard API key
   cd backend
   echo 'FORTYGUARD_API_KEY=your_api_key_here' > .env
   echo 'PORT=4000' >> .env
   ```
   Get a free API key at: https://www.fortyguard.com/

3. **Install dependencies:**
   ```bash
   # Backend
   cd backend && npm install
   
   # Frontend (already built, but you can rebuild)
   cd ../frontend && npm install && npm run build
   ```

4. **Start the app:**
   ```bash
   # Terminal 1: Start backend
   cd backend
   npm start
   # Server runs on http://localhost:4000
   
   # Terminal 2: (Optional) Watch for changes
   npm run dev
   ```

5. **Open in browser:**
   ```
   http://localhost:4000
   ```

## Usage

1. Enter origin address (e.g., "Bozeman, MT")
2. Enter destination address (e.g., "Montana State University, Bozeman, MT")
3. Click "Compare routes"
4. View:
   - **Map**: Color-coded routes (green/blue = cooler, orange/red = hotter)
   - **Comparison cards**: Temperature, duration, distance, hours above 35°C
   - **Feels like**: Heat index for the coolest route

## Testing

### Unit Tests (Backend)

Test individual functions for corridor creation, area validation, and API parsing:

```bash
cd backend
npm test
```

Tests cover:
- `corridor.js` - Route buffering & area calculation
- `fortyguard.js` - API response parsing
- `osrm.js` - Route geometry validation

### Integration Tests

Test the full `/api/compare-routes` workflow with mock data:

```bash
cd backend
npm run test:integration
```

Validates:
- Origin/destination validation
- OSRM route fetching
- FortyGuard heatmap submission & polling
- Temperature metric extraction
- Response format

### Manual Test Script

Interactive script to test FortyGuard API directly:

```bash
cd backend
npm run test:fortyguard
```

This script:
- Tests heatmap submission & polling
- Tests environmental parameters (feels-like data)
- Shows raw API responses
- Validates activity status polling

### Postman/curl Testing

Test `/api/compare-routes` endpoint directly:

```bash
curl -X POST http://localhost:4000/api/compare-routes \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "lat": 45.6769, "lng": -111.0429 },
    "destination": { "lat": 45.6619, "lng": -111.0419 },
    "atTime": "2024-08-28T14:00:00Z"
  }'
```

**Expected response:**
```json
{
  "routes": [
    {
      "routeId": 0,
      "geometry": { "type": "LineString", "coordinates": [...] },
      "durationSeconds": 300,
      "distanceMeters": 2500,
      "avgTemp": 28.5,
      "maxTemp": 31.2,
      "hoursAboveThreshold": 2
    },
    ...
  ],
  "coolestRouteId": 0,
  "feelsLike": {
    "heat_index_celsius": [32.1],
    "apparent_temperature_celsius": [29.8],
    "relative_humidity_percent": [55]
  },
  "analyzedAt": { "startDate": "2024-08-28", "startTime": "14:00" }
}
```

## API Reference

### POST `/api/compare-routes`

**Request:**
```json
{
  "origin": { "lat": 45.6769, "lng": -111.0429 },
  "destination": { "lat": 45.6619, "lng": -111.0419 },
  "atTime": "2024-08-28T14:00:00Z"  // Optional, defaults to now
}
```

**Response:**
```json
{
  "routes": [...],           // Array of route objects
  "coolestRouteId": 0,       // Index of coolest route
  "feelsLike": {...},        // Environmental parameters for coolest route
  "analyzedAt": {...}        // Analysis timestamp
}
```

### GET `/api/health`

Health check endpoint:
```bash
curl http://localhost:4000/api/health
# Response: { "ok": true, "apiConfigured": true }
```

## Environment Variables

**backend/.env** (required, never commit):
```
FORTYGUARD_API_KEY=your_api_key_here
PORT=4000
```

## Error Handling

The app handles common errors gracefully:

| Error | Response | Action |
|-------|----------|--------|
| Missing origin/destination | 400 Bad Request | Validate coordinates before submit |
| Invalid API key | 401 Unauthorized | Check `.env` FORTYGUARD_API_KEY |
| Route too long | 400 Bad Request | Corridor > 10 mi², route is too long |
| No US coverage | 400 Bad Request | Only US coordinates supported |
| API rate limit | 429 Too Many Requests | Wait & retry |
| Network timeout | 500 Server Error | Check FortyGuard API status |

## Debugging

### Enable detailed logging:

Edit `backend/server.js` and uncomment console logs:
```javascript
console.log('📍 Origin:', origin);
console.log('📍 Destination:', destination);
console.log('🗺️  Routes fetched:', routes.length);
```

### Check FortyGuard API status:
```bash
curl -H "api-key: YOUR_API_KEY" https://api.fortyguard.com/v1/status/test-id
```

### Test Nominatim geocoding:
```bash
curl "https://nominatim.openstreetmap.org/search?q=Bozeman,%20Montana&format=json"
```

## Troubleshooting

### "Frontend build not found"
```bash
cd frontend && npm run build
```

### "FortyGuard API key is not configured"
```bash
# Check backend/.env exists and has FORTYGUARD_API_KEY
cat backend/.env
```

### "No routes found for these locations"
- Ensure coordinates are valid US addresses
- Try a longer distance (>1 km)
- Check OSRM is reachable: `curl https://router.project-osrm.org/route/v1/foot/-111.0429,45.6769;-111.0419,45.6619?alternatives=true`

### "Route corridor is X mi²; choose a shorter route"
- The route is too long (area > 10 mi²)
- Try locations closer together
- Shorten the buffer distance in `backend/lib/corridor.js` (60m default)

## Architecture Diagram

```
┌─────────────────────────────────────┐
│   React Frontend (Browser)          │
│  - Address input                    │
│  - SVG route map                    │
│  - Comparison cards                 │
└────────────────┬────────────────────┘
                 │ POST /api/compare-routes
                 ▼
┌─────────────────────────────────────┐
│   Express Backend (Node.js)         │
│  - Input validation                 │
│  - Route orchestration              │
└────────────────┬────────────────────┘
                 │
        ┌────────┴──────────┐
        │                   │
        ▼                   ▼
    ┌──────────┐      ┌──────────────────┐
    │   OSRM   │      │  FortyGuard API  │
    │ Routing  │      │  Heatmap Data    │
    └──────────┘      │  Env Parameters  │
                      └──────────────────┘
```

## Development

### Local development (with hot reload):

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
# Restarts on file changes
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Vite dev server on http://localhost:5173
```

Then set `VITE_BACKEND_URL=http://localhost:4000` for frontend.

### Building for production:

```bash
# Frontend
cd frontend && npm run build

# Backend (no build needed, runs directly)
# Just deploy `backend/` to your server
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Limitations & Future Work

- **US-only** (FortyGuard Basic plan limitation)
- **3 routes max** (OSRM limitation, but adjustable)
- **10 mi² max** (FortyGuard Basic plan limit per request)
- **Real-time only** (no historical heat data, forecast limited to +12 hours)

**Potential enhancements:**
- [ ] Multi-route segmentation (break long routes into <10 mi² segments)
- [ ] User preferences (prefer shade, water features, etc.)
- [ ] Heat alerts (push notification if threshold exceeded)
- [ ] Route caching (avoid redundant API calls)
- [ ] Premium data (satellite view, street-level analysis)

## License

See [LICENSE](LICENSE) file.

## Support

- 📧 Email: [your-email@example.com]
- 🐛 Issues: GitHub Issues
- 💬 Discussions: GitHub Discussions

## Acknowledgments

- **FortyGuard API** - Hyperlocal temperature data
- **OSRM** - Open Source Routing Machine
- **Turf.js** - Geospatial analysis
- **Nominatim** - Geocoding (OpenStreetMap)

---

**Built at Hackathon 2024** 🚀  
**Status:** ✅ Testing Ready | Ready for Production Deployment
