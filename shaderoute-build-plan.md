# ShadeRoute — End-to-End Build Plan
### Heat-Aware Route Navigation powered by FortyGuard Temperature API

**Goal:** Given an origin and destination, return 2-3 candidate routes and show which is coolest vs. fastest, using real hyperlocal temperature data — not generic weather averages. Target demo: type two US addresses, see routes color-coded by heat exposure, with a "feels like" headline and hours-above-threshold stat.

**Hackathon constraints:** Weekend deadline. US-only coverage (FortyGuard limitation). Open theme.

---

## 1. TECH STACK

- **Backend:** Node.js + Express
- **Routing engine:** OSRM public demo server (free, no key required) — `router.project-osrm.org`
- **Geometry buffering:** `@turf/turf` npm package
- **Frontend:** React + Mapbox GL JS (or Leaflet if no Mapbox token available)
- **Geocoding (address → lat/lng):** Mapbox Geocoding API free tier, or Nominatim (OSM, free, no key) as fallback
- **HTTP client:** axios

Install:
```bash
npm init -y
npm install express axios @turf/turf cors dotenv
```

Frontend (if separate React app):
```bash
npx create-react-app shaderoute-frontend
cd shaderoute-frontend
npm install mapbox-gl axios
```

---

## 2. ENVIRONMENT SETUP

Create `.env` in backend root:
```
FORTYGUARD_API_KEY=your_api_key_here
PORT=4000
```

**IMPORTANT:** Never hardcode the API key in source files. Always read from `process.env.FORTYGUARD_API_KEY`. Add `.env` to `.gitignore`.

---

## 3. FORTYGUARD API — FULL REFERENCE

### 3.1 Authentication
Every request needs this header (no OAuth, no token exchange):
```
api-key: YOUR_API_KEY
Content-Type: application/json
```

### 3.2 Base URL
```
https://api.fortyguard.com/v1
```

### 3.3 Async pattern (applies to ALL endpoints)
1. `POST` to the relevant endpoint → immediately returns `activity_id`
2. Poll `GET /v1/status/{activity_id}` repeatedly until `status` is `"Completed"` or `"Failed"`
3. On `"Completed"`, the SAME status response includes `data.result` with the actual payload
4. Credits are only deducted on successful `Completed` status — failed/in-progress polls are free, so poll aggressively (every 2-3 seconds is fine)
5. `"Failed"` is terminal — stop polling, do not retry that activity_id

### 3.4 Status/response codes
| Code | Meaning |
|---|---|
| 400 / 422 | Invalid request / validation error |
| 401 | Missing or invalid API key |
| 403 | Insufficient plan access |
| 404 | Activity not found (or too soon after submission) |
| 429 | Rate limit exceeded |
| 500 | Server-side error |

### 3.5 Plan limits (relevant ones)
- Basic plan: 1,000,000 credits/month, Heatmap max area = **10 mi²**, US-only coverage
- Granularity must be exactly **60, 80, or 100** (meters) — no other values allowed
- `filter_type` must be 1 (Single Hour), 2 (Range of Hours, max 23hrs), 3 (Single Day), or 4 (Range of Days, ≤1 month, heatmap only)
- Date range: 2019-01-01 through **12 hours into the future** (forecast window). Anything outside this = 400 error.
- Coordinates must fall within the United States or you get a 400 error

---

### 3.6 ENDPOINT: Create Heatmap (primary endpoint for this project)

`POST https://api.fortyguard.com/v1/heatmap`

**Request body:**
```json
{
  "polygon_aoi": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {},
        "geometry": {
          "type": "Polygon",
          "coordinates": [[
            [-74.0170, 40.7050],
            [-74.0030, 40.7050],
            [-74.0030, 40.7180],
            [-74.0170, 40.7180],
            [-74.0170, 40.7050]
          ]]
        }
      }
    ]
  },
  "date_time": {
    "start_date": "2024-07-15",
    "start_time": "14:00",
    "filter_type": 1
  },
  "granularity": 100,
  "analytic_type": "tcm",
  "threshold": 30,
  "direction": "above"
}
```

**Field notes:**
- `polygon_aoi` — MUST be this exact FeatureCollection/Feature/Polygon nesting shape, not a bare Polygon. Coordinates must form a closed ring (first coord === last coord).
- `date_time.filter_type`:
  - `1` = Single Hour → requires `start_date` + `start_time` (end_time auto = start_time + 1hr)
  - `2` = Range of Hours (same day) → requires `start_date`, `start_time`, `end_time` (max 23hr range)
  - `3` = Single Day → requires only `start_date` (covers 00:00–23:59)
  - `4` = Range of Days (week/month, ≤1 month) → requires `start_date` + `end_date`
- `granularity` — one of `60`, `80`, `100` (meters). Smaller = finer resolution, use 60 for route corridors.
- `analytic_type` (optional, default `"tcm"`):
  - `"tcm"` — temperature snapshot, °C per tile (use this for basic route comparison)
  - `"time_of_measure"` — hour of day (0-23 UTC) peak temp occurs
  - `"exceedance"` — number of hours temp passes `threshold` (returns hours, not °C) — **use for "X hours above 35°C" stat**
  - `"persistence"` — longest continuous run of hours past `threshold` (returns hours)
- `threshold` (optional, default 30°C) — only used by exceedance/persistence
- `direction` (optional, default `"above"`) — `"above"` or `"below"`, only used by exceedance/persistence

**Submit response:**
```json
{
  "error": false,
  "status_code": 200,
  "message": "Heatmap Submitted Successfully",
  "data": { "activity_id": "f52d2453-6a59-4b31-afa3-8fe3bb1ac5df" }
}
```

**Poll `GET /v1/status/{activity_id}` — Completed response:**
```json
{
  "error": false,
  "status_code": 200,
  "message": "Completed",
  "data": {
    "activity_id": "f52d2453-6a59-4b31-afa3-8fe3bb1ac5df",
    "status": "Completed",
    "result": {
      "map_data": {},
      "stats_data": {
        "Temperature_stats": {
          "Minimum": 0,
          "Maximum": 0,
          "Mean": 0,
          "Standard_deviation": 0
        },
        "Overall_temperature_distribution": [],
        "Normal_temperature_distribution": { "x_axis": [], "y_axis": [] },
        "Temperature_frequency": {}
      }
    }
  }
}
```

**KEY INSIGHT:** `result.stats_data.Temperature_stats.Mean` and `.Maximum` give you an instant aggregate score for an entire route-corridor polygon — no need to manually sample individual tiles from `map_data` unless you want finer per-segment detail later. Use `Mean`/`Maximum` for the MVP.

When `analytic_type` is `exceedance` or `persistence`, the same `Temperature_stats.Mean`/`.Maximum` fields contain HOURS, not °C (check `stats_data.units` if present).

---

### 3.7 ENDPOINT: Environmental Parameters (stretch goal — "feels like" data)

`POST https://api.fortyguard.com/v1/env_params`

**Request body:**
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "temperature": 32.5,
  "date_time": {
    "start_date": "2024-07-15",
    "start_time": "14:00",
    "filter_type": 1
  },
  "analysis": ["heat_index_celsius", "apparent_temperature_celsius", "relative_humidity_percent"]
}
```

**Notes:**
- `temperature` should be the actual °C value you got back from a heatmap call for this same location/date/time (they must match)
- `analysis` is optional — omit to get all available parameters. **API Basic plan is limited to 3 parameters per request** — always pass an explicit array of ≤3 items on Basic plan.
- Available parameters: `heat_index_celsius`, `apparent_temperature_celsius`, `wet_bulb_temperature_celsius`, `relative_humidity_percent`, `precipitation_mm`, `cloud_cover_octas`, `elevation`, plus various air-quality/gas fields, plus `solar_irradiance`
- Missing values return `null` (never interpret as zero)

**Submit response:** same activity_id pattern as heatmap.

**Poll result:**
```json
{
  "data": {
    "status": "Completed",
    "result": {
      "metadata": {
        "timezone": "...",
        "timezone_offset_hours": 0,
        "time_range": { "start": "...", "end": "...", "interval": "...", "count": 0 },
        "timestamps": ["..."]
      },
      "locations": [
        {
          "lat": 0, "lon": 0, "elevation": 0, "temperature": 0,
          "parameters": {
            "heat_index_celsius": [0],
            "apparent_temperature_celsius": [0],
            "relative_humidity_percent": [0]
          },
          "solar_irradiance": {
            "clear_sky": { "ghi": 0, "dni": 0, "dhi": 0 },
            "description": "..."
          }
        }
      ]
    }
  }
}
```

---

### 3.8 ENDPOINT: Satellite View Segmentation (NOT used in MVP — Premium plan only, reference only)

`POST https://api.fortyguard.com/v1/satellite` — analyzes land cover/vegetation at a single lat/lng. Skip unless plan is Premium and time allows a "why is this spot hot" explainer feature.

### 3.9 ENDPOINT: Street View Segmentation (NOT used in MVP — Premium plan only, reference only)

`POST https://api.fortyguard.com/v1/streetview` — analyzes ground-level imagery. Skip for MVP.

### 3.10 ENDPOINT: Heat Intelligence (NOT used in MVP — Premium plan only, reference only)

`POST https://api.fortyguard.com/v1/heat_intelligence` — generates a PDF report. Returns `data.result.download_link` (temporary signed URL) instead of inline JSON. Skip for MVP — too slow (multi-minute) for a live demo.

### 3.11 ENDPOINT: Check Status (used by everything above)

`GET https://api.fortyguard.com/v1/status/{activity_id}`

Headers: `api-key: YOUR_API_KEY`

Processing response:
```json
{ "error": false, "status_code": 200, "message": "Processing", "data": { "activity_id": "...", "status": "Processing" } }
```

---

## 4. ARCHITECTURE

```
[React Frontend — Mapbox GL JS]
  - Address search (origin + destination) → Mapbox Geocoding or Nominatim
  - Time picker (now / +2h / +4h, within forecast window)
  - Map showing 2-3 routes, color-coded by temperature
  - Comparison cards: duration, distance, avg temp, feels-like, hours-above-threshold
        │
        │ POST /api/compare-routes  { origin, destination, startTime }
        ▼
[Node/Express Backend]
  1. Call OSRM → get 2-3 alternative route geometries (GeoJSON LineStrings)
  2. For each route: turf.buffer() → polygon corridor (~60m width)
  3. Check corridor area < 10 mi² (split/shrink if needed)
  4. POST /v1/heatmap per corridor (analytic_type: tcm) → activity_id
  5. Poll /v1/status/{activity_id} until Completed → stats_data.Temperature_stats
  6. (stretch) POST /v1/heatmap again per corridor (analytic_type: exceedance, threshold: 35) → hours-above stat
  7. (stretch) POST /v1/env_params on winning route midpoint → feels-like temp
  8. Return combined JSON to frontend
        │
        ▼
[FortyGuard API]  https://api.fortyguard.com/v1
```

---

## 5. FILE STRUCTURE

```
shaderoute/
├── backend/
│   ├── .env                      (FORTYGUARD_API_KEY — not committed)
│   ├── .gitignore
│   ├── package.json
│   ├── server.js                 (Express app + routes)
│   ├── lib/
│   │   ├── fortyguard.js         (submitHeatmap, pollResult, submitEnvParams)
│   │   ├── corridor.js           (route → buffered polygon, area check)
│   │   └── osrm.js               (fetch alternative routes)
│   └── cache/
│       └── demo-fallback.json    (pre-baked responses for demo safety net)
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── MapView.jsx
    │   │   ├── AddressSearch.jsx
    │   │   ├── TimePicker.jsx
    │   │   └── RouteComparisonCards.jsx
    │   └── api/
    │       └── client.js         (axios wrapper to call backend)
    └── package.json
```

---

## 6. BACKEND CODE

### 6.1 `backend/lib/fortyguard.js`

```javascript
const axios = require('axios');

const API_KEY = process.env.FORTYGUARD_API_KEY;
const BASE = 'https://api.fortyguard.com/v1';

function headers() {
  return { 'api-key': API_KEY, 'Content-Type': 'application/json' };
}

/**
 * Submit a heatmap generation task.
 * @param {Array} polygonCoords - GeoJSON Polygon coordinates array (closed ring)
 * @param {Object} opts - { startDate, startTime, endTime, filterType, granularity, analyticType, threshold, direction }
 * @returns {Promise<string>} activity_id
 */
async function submitHeatmap(polygonCoords, opts) {
  const {
    startDate, startTime, endTime, endDate,
    filterType = 1, granularity = 60,
    analyticType = 'tcm', threshold, direction
  } = opts;

  const payload = {
    polygon_aoi: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: polygonCoords }
      }]
    },
    date_time: {
      start_date: startDate,
      ...(startTime && { start_time: startTime }),
      ...(endTime && { end_time: endTime }),
      ...(endDate && { end_date: endDate }),
      filter_type: filterType
    },
    granularity,
    analytic_type: analyticType,
    ...(threshold !== undefined && { threshold }),
    ...(direction && { direction })
  };

  const res = await axios.post(`${BASE}/heatmap`, payload, { headers: headers() });
  return res.data.data.activity_id;
}

/**
 * Submit an environmental parameters task.
 */
async function submitEnvParams(lat, lng, temperature, opts) {
  const { startDate, startTime, filterType = 1, analysis } = opts;
  const payload = {
    latitude: lat,
    longitude: lng,
    temperature,
    date_time: { start_date: startDate, start_time: startTime, filter_type: filterType },
    ...(analysis && { analysis }) // max 3 items on Basic plan
  };
  const res = await axios.post(`${BASE}/env_params`, payload, { headers: headers() });
  return res.data.data.activity_id;
}

/**
 * Poll an activity until Completed or Failed.
 */
async function pollResult(activityId, { maxAttempts = 40, intervalMs = 2500 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await axios.get(`${BASE}/status/${activityId}`, { headers: headers() });
    const status = res.data.data.status;
    if (status === 'Completed') return res.data.data.result;
    if (status === 'Failed') throw new Error(`FortyGuard activity ${activityId} failed`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`FortyGuard activity ${activityId} timed out after ${maxAttempts} attempts`);
}

module.exports = { submitHeatmap, submitEnvParams, pollResult };
```

### 6.2 `backend/lib/corridor.js`

```javascript
const turf = require('@turf/turf');

const MAX_AREA_MI2 = 9.5; // stay under the 10 mi² Basic plan cap with margin

/**
 * Convert a GeoJSON LineString route into a buffered polygon corridor.
 * @param {Object} lineStringGeoJSON - { type: 'LineString', coordinates: [[lng,lat], ...] }
 * @param {number} bufferMeters - corridor half-width in meters
 * @returns {Array} polygon coordinates array ready for fortyguard.submitHeatmap
 */
function routeToCorridor(lineStringGeoJSON, bufferMeters = 60) {
  const line = { type: 'Feature', properties: {}, geometry: lineStringGeoJSON };
  const buffered = turf.buffer(line, bufferMeters / 1000, { units: 'kilometers' });

  const areaMi2 = turf.area(buffered) / 2_589_988;
  if (areaMi2 > MAX_AREA_MI2) {
    throw new Error(`Corridor area ${areaMi2.toFixed(2)} mi² exceeds plan limit. Reduce bufferMeters or split route into segments.`);
  }

  return buffered.geometry.coordinates;
}

/**
 * Get the midpoint of a route line (for env_params "feels like" lookup).
 */
function routeMidpoint(lineStringGeoJSON) {
  const line = { type: 'Feature', properties: {}, geometry: lineStringGeoJSON };
  const length = turf.length(line, { units: 'kilometers' });
  const mid = turf.along(line, length / 2, { units: 'kilometers' });
  return { lat: mid.geometry.coordinates[1], lng: mid.geometry.coordinates[0] };
}

module.exports = { routeToCorridor, routeMidpoint };
```

### 6.3 `backend/lib/osrm.js`

```javascript
const axios = require('axios');

/**
 * Get alternative walking routes between two points using the free OSRM demo server.
 * @param {{lat:number,lng:number}} origin
 * @param {{lat:number,lng:number}} destination
 * @returns {Promise<Array>} array of { geometry, duration, distance }
 */
async function getAlternativeRoutes(origin, destination, profile = 'foot') {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const res = await axios.get(url, {
    params: { alternatives: true, geometries: 'geojson', overview: 'full' }
  });
  if (!res.data.routes || res.data.routes.length === 0) {
    throw new Error('No routes found from OSRM');
  }
  return res.data.routes.slice(0, 3).map(r => ({
    geometry: r.geometry, // GeoJSON LineString
    duration: r.duration, // seconds
    distance: r.distance  // meters
  }));
}

module.exports = { getAlternativeRoutes };
```

### 6.4 `backend/server.js`

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { submitHeatmap, submitEnvParams, pollResult } = require('./lib/fortyguard');
const { routeToCorridor, routeMidpoint } = require('./lib/corridor');
const { getAlternativeRoutes } = require('./lib/osrm');

const app = express();
app.use(cors());
app.use(express.json());

// Helper: format Date object → FortyGuard date/time strings
function formatDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  const startDate = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const startTime = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return { startDate, startTime };
}

app.post('/api/compare-routes', async (req, res) => {
  try {
    const { origin, destination, atTime } = req.body;
    // origin/destination: { lat, lng }
    // atTime: optional ISO string; defaults to now. Must be within [2019-01-01, now+12h] per FortyGuard limits.
    const targetDate = atTime ? new Date(atTime) : new Date();
    const { startDate, startTime } = formatDateTime(targetDate);

    const routes = await getAlternativeRoutes(origin, destination);

    const enriched = await Promise.all(routes.map(async (route, idx) => {
      const corridorCoords = routeToCorridor(route.geometry, 60);

      // 1. Temperature snapshot (tcm)
      const tcmActivityId = await submitHeatmap(corridorCoords, {
        startDate, startTime, filterType: 1, granularity: 60, analyticType: 'tcm'
      });
      const tcmResult = await pollResult(tcmActivityId);
      const avgTemp = tcmResult.stats_data.Temperature_stats.Mean;
      const maxTemp = tcmResult.stats_data.Temperature_stats.Maximum;

      // 2. Exceedance (hours above 35°C today) — single day, so use filterType 3
      const exceedanceActivityId = await submitHeatmap(corridorCoords, {
        startDate, filterType: 3, granularity: 60,
        analyticType: 'exceedance', threshold: 35, direction: 'above'
      });
      const exceedanceResult = await pollResult(exceedanceActivityId);
      const hoursAboveThreshold = exceedanceResult.stats_data.Temperature_stats.Mean;

      return {
        routeId: idx,
        geometry: route.geometry,
        durationSeconds: route.duration,
        distanceMeters: route.distance,
        avgTemp,
        maxTemp,
        hoursAboveThreshold
      };
    }));

    // Determine coolest route
    const coolest = enriched.reduce((a, b) => (a.avgTemp < b.avgTemp ? a : b));

    // 3. Feels-like on the coolest route's midpoint (stretch goal, Basic plan = max 3 params)
    let feelsLike = null;
    try {
      const coolestRoute = routes[coolest.routeId];
      const mid = routeMidpoint(coolestRoute.geometry);
      const envActivityId = await submitEnvParams(mid.lat, mid.lng, coolest.avgTemp, {
        startDate, startTime, filterType: 1,
        analysis: ['heat_index_celsius', 'apparent_temperature_celsius', 'relative_humidity_percent']
      });
      const envResult = await pollResult(envActivityId);
      feelsLike = envResult.locations[0].parameters;
    } catch (e) {
      console.warn('env_params enrichment failed (non-fatal):', e.message);
    }

    res.json({ routes: enriched, coolestRouteId: coolest.routeId, feelsLike });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`ShadeRoute backend running on port ${PORT}`));
```

---

## 7. FRONTEND CODE

### 7.1 `frontend/src/api/client.js`

```javascript
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';

export async function compareRoutes(origin, destination, atTime) {
  const res = await axios.post(`${BACKEND_URL}/api/compare-routes`, {
    origin, destination, atTime
  });
  return res.data;
}

// Free geocoding via Nominatim (no key required) — swap for Mapbox Geocoding if you have a token
export async function geocode(query) {
  const res = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: query, format: 'json', countrycodes: 'us', limit: 1 }
  });
  if (!res.data.length) throw new Error(`No results for "${query}"`);
  return { lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon) };
}
```

### 7.2 `frontend/src/components/MapView.jsx`

```jsx
import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

// Color scale: green (cool) -> yellow -> red (hot). Adjust min/max to your city's typical range.
function tempToColor(temp, min = 25, max = 45) {
  const t = Math.max(0, Math.min(1, (temp - min) / (max - min)));
  const r = Math.round(255 * t);
  const g = Math.round(255 * (1 - t));
  return `rgb(${r},${g},60)`;
}

export default function MapView({ routes, coolestRouteId }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-97.5, 38], // default center US
      zoom: 3
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routes || routes.length === 0) return;

    const draw = () => {
      routes.forEach((route, idx) => {
        const sourceId = `route-${idx}`;
        const layerId = `route-layer-${idx}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: route.geometry }
        });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': tempToColor(route.avgTemp),
            'line-width': idx === coolestRouteId ? 7 : 4,
            'line-opacity': idx === coolestRouteId ? 1 : 0.6
          }
        });
      });

      // Fit bounds to first route
      const coords = routes[0].geometry.coordinates;
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 60 });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [routes, coolestRouteId]);

  return <div ref={mapContainer} style={{ width: '100%', height: '500px' }} />;
}
```

### 7.3 `frontend/src/components/RouteComparisonCards.jsx`

```jsx
import React from 'react';

function formatDuration(seconds) {
  const min = Math.round(seconds / 60);
  return `${min} min`;
}

export default function RouteComparisonCards({ routes, coolestRouteId, feelsLike }) {
  if (!routes) return null;

  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '16px' }}>
      {routes.map((route) => (
        <div
          key={route.routeId}
          style={{
            border: route.routeId === coolestRouteId ? '2px solid #2e7d32' : '1px solid #ccc',
            borderRadius: '8px',
            padding: '16px',
            minWidth: '220px'
          }}
        >
          <h3>{route.routeId === coolestRouteId ? '🌿 Coolest Route' : `Route ${route.routeId + 1}`}</h3>
          <p>⏱ {formatDuration(route.durationSeconds)} · {(route.distanceMeters / 1609).toFixed(1)} mi</p>
          <p>🌡 Avg {route.avgTemp.toFixed(1)}°C (max {route.maxTemp.toFixed(1)}°C)</p>
          <p>⚠️ {route.hoursAboveThreshold.toFixed(1)} hrs above 35°C today</p>
          {route.routeId === coolestRouteId && feelsLike && (
            <p>
              🥵 Feels like {feelsLike.heat_index_celsius?.[0]?.toFixed(1) ?? '—'}°C
              (humidity {feelsLike.relative_humidity_percent?.[0]?.toFixed(0) ?? '—'}%)
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
```

### 7.4 `frontend/src/App.jsx`

```jsx
import React, { useState } from 'react';
import MapView from './components/MapView';
import RouteComparisonCards from './components/RouteComparisonCards';
import { compareRoutes, geocode } from './api/client';

export default function App() {
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const origin = await geocode(originQuery);
      const destination = await geocode(destQuery);
      const data = await compareRoutes(origin, destination);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px', fontFamily: 'sans-serif' }}>
      <h1>🌡 ShadeRoute</h1>
      <p>Find the coolest way to get there — powered by FortyGuard hyperlocal temperature data.</p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          placeholder="From (e.g. Phoenix Sky Harbor Airport)"
          value={originQuery}
          onChange={e => setOriginQuery(e.target.value)}
          style={{ flex: 1, padding: '8px' }}
        />
        <input
          placeholder="To (e.g. Downtown Phoenix)"
          value={destQuery}
          onChange={e => setDestQuery(e.target.value)}
          style={{ flex: 1, padding: '8px' }}
        />
        <button type="submit" disabled={loading}>{loading ? 'Calculating…' : 'Compare Routes'}</button>
      </form>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {result && (
        <>
          <MapView routes={result.routes} coolestRouteId={result.coolestRouteId} />
          <RouteComparisonCards
            routes={result.routes}
            coolestRouteId={result.coolestRouteId}
            feelsLike={result.feelsLike}
          />
        </>
      )}
    </div>
  );
}
```

---

## 8. BUILD ORDER / TIMELINE

**Phase 1 — Backend core proof-of-life (do first, before any UI)**
1. Set up `backend/` folder, install deps, add `.env` with real API key
2. Add `lib/fortyguard.js`
3. Write a throwaway test script that calls `submitHeatmap()` with the sample NYC polygon from the docs and `pollResult()` — confirm you get back real `stats_data` with non-zero numbers
4. **Milestone: you see a real Mean/Maximum temperature printed to console**

**Phase 2 — Routing + corridor logic**
5. Add `lib/osrm.js`, test it standalone with two real US coordinates → confirm you get 2-3 route geometries
6. Add `lib/corridor.js`, buffer a real route geometry, confirm the area check passes (<9.5 mi²)
7. Wire corridor output into `submitHeatmap()` from Phase 1 — confirm each route now returns a distinct avg temperature

**Phase 3 — Full backend endpoint**
8. Add `server.js` with `/api/compare-routes`, test end-to-end with curl/Postman using a real US city pair (Phoenix, Miami, or Dallas recommended — hottest, most visually dramatic results)
9. Add exceedance call, confirm hours-above-threshold numbers make sense
10. Add env_params feels-like call as a try/catch (non-fatal if it fails)

**Phase 4 — Frontend**
11. Scaffold React app, add `api/client.js`
12. Add `MapView.jsx`, get routes rendering with color gradient
13. Add `RouteComparisonCards.jsx`, wire up `App.jsx`
14. Test full flow: type two addresses → see colored routes + cards

**Phase 5 — Demo safety net + polish**
15. Pick 2-3 known-good address pairs in a hot city where the heat difference between routes is visually dramatic; cache their full API responses to `backend/cache/demo-fallback.json` in case live polling is slow/rate-limited during judging
16. Add a loading spinner during the ~10-20 second poll cycle (3 heatmap calls × poll time can take a while — set expectations in the UI, e.g. "Analyzing hyperlocal temperature data…")
17. Final pass: one clear headline stat on screen ("2.4°C cooler, only 3 min slower")

---

## 9. DEMO SCRIPT (60-90 seconds)

1. Type a real US address pair in a hot city, live in front of judges
2. Wait for routes to render (narrate what's happening: "we're pulling real hyperlocal 2-meter precision temperature data along each candidate route")
3. Point at the coolest route card: "This route is 2-3°C cooler and only costs you a few extra minutes"
4. Point at the exceedance stat: "This street will be above 35°C for X hours today — that's a real public-health number a city could track"
5. Mention the feels-like stat if humidity makes it dramatic: "It says 39°C but feels like 46°C with humidity factored in"
6. Close with who'd use this daily: parents walking kids, runners, delivery drivers, elderly residents — and that it's built entirely on FortyGuard's actual differentiator (hyperlocal precision, not generic weather-model averages)

---

## 10. TROUBLESHOOTING NOTES FOR THE CODING AGENT

- If `submitHeatmap` returns 400: check `polygon_aoi` nesting (must be FeatureCollection → Feature → Polygon, not a bare Polygon), check granularity is exactly 60/80/100, check date is within [2019-01-01, now+12h], check coordinates are within the US
- If corridor area check throws: reduce `bufferMeters` in `routeToCorridor()` (try 40 instead of 60) or split very long routes into shorter segments before buffering
- If polling never completes: increase `maxAttempts` in `pollResult()`, but also log the raw status response — a stuck "Processing" for >2 min likely means a malformed request that silently accepted
- If `env_params` 400s: on Basic plan, `analysis` array must have ≤3 items — don't omit it (omitting requests all params, which exceeds Basic plan limit)
- Credits are only spent on `Completed` status, so aggressive polling and repeated testing during development is free — don't worry about burning quota while debugging
