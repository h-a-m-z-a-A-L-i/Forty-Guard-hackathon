# ShadeRoute — Project Details for Presentation & Script Generation

> **Purpose of this file:** Everything an AI tool needs to generate presentation slides and a pitch script for the ShadeRoute hackathon submission. It contains the full product story, technical architecture, verified metrics, demo numbers, and a ready-to-adapt slide outline + script skeleton.

---

## 1. One-Line Pitch

**ShadeRoute** is a heat-aware navigation app that compares alternate routes between any two U.S. addresses by **real-time road-surface temperature** and tells you which route keeps you coolest — and what time to leave.

---

## 2. Problem Statement

- **Urban heat is dangerous and invisible.** Heat islands can make city surfaces 10–25°C hotter than the air around them. Navigation apps today optimize for *time* and *distance* — never for *heat exposure*.
- **Heat exposure ≠ weather-app temperature.** Weather apps (AccuWeather, etc.) report one air temperature per city, measured at an airport 2 m above ground in a shaded screen. What actually bakes a pedestrian is the **surface temperature of the street they walk on** — asphalt, concrete, and pavement absorb and re-radiate heat.
- **The people who need this most** — pedestrians, cyclists, delivery riders, outdoor workers, elderly residents — currently have **no way to choose a cooler route**.

---

## 3. Solution

ShadeRoute answers three questions for any origin → destination:

1. **Which route is coolest?** — Compares up to 3 alternate routes, scoring each with FortyGuard's hyperlocal surface-temperature model across the entire route corridor (apples-to-apples).
2. **How hot will it actually be?** — Shows average/max surface temp, feels-like (heat index), wet-bulb temperature (the WBGT heat-stroke metric), "% of route above 35°C" and hours above threshold.
3. **When should I leave?** — Uses FortyGuard's +12-hour forecast window to recommend the **coolest departure time** ("Leave at 6 PM — surfaces 6.8°C cooler").

---

## 4. Key Features (what the demo shows)

| Feature | What it does | Data source |
|---|---|---|
| **Route comparison** | Up to 3 candidate routes, ranked by average corridor surface temp | OSRM + FortyGuard tcm |
| **Heat-grid overlay** | Real per-60m temperature grid rendered on the map (toggleable) | FortyGuard `map_data` GeoJSON |
| **Wet-bulb temp** | WBGT heat-stroke metric alongside feels-like | FortyGuard `env_params` |
| **% of route > 35°C** | Percent of corridor cells above heat threshold (shown only when > 0) | FortyGuard `map_data` |
| **Hours above 35°C** | Total hours above threshold for the day | FortyGuard `exceedance` analytic |
| **Heat spread ±°C** | Standard deviation along the route ("steady heat" vs "hot pockets") | FortyGuard `stats_data` |
| **Coolest-departure planner** | Probes +2/+4/+6h forecast, recommends the coolest hour to leave | FortyGuard forecast window |
| **Route focus / isolation** | Click a route to isolate it; hover cards highlight routes | Frontend |
| **Dark / light themes** | Theme-aware map tiles and route colors | Frontend |
| **Permanent dotted routes** | Coolest route animated dots, others dotted; markers distinct | Frontend |

---

## 5. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 24, Express 4.21.2, @turf/turf 7.2.0 (corridor geometry), axios |
| Frontend | React 18.3.1, Vite 6.4.3, Leaflet 1.9.4 + react-leaflet 4.2.1 |
| Routing | OSRM (OpenStreetMap public foot routing, `alternatives=2`) |
| Geocoding | Nominatim (OpenStreetMap, free, no key) |
| Heat intelligence | **FortyGuard Temperature API** (confirmed **Premium** plan) |
| Verification | Open-Meteo (independent air-temp ground truth) |
| Hosting | Express serves the built frontend statically (single server, port 4000) |

---

## 6. Architecture & Data Flow

```
User enters address pair
        │  (frontend/src/api/client.js)
        ▼
1. Nominatim geocode  ──►  lat/lng (US, Montana-validated)
        ▼
2. POST /api/compare-routes (backend/server.js)
        ▼
3. OSRM routed-foot  ──►  up to 3 alternative geometries (GeoJSON)
        ▼
4. Corridor builder (backend/lib/corridor.js)
   turf.buffer(route, 60m) → simplify → validate ≤ 9.5 mi²
        ▼
5. Per route, CONCURRENTLY (backend/lib/fortyguard.js):
   • tcm heatmap        → avg/max surface temp + per-cell grid
   • exceedance (35°C)  → hours above threshold
        ▼
6. FortyGuard async pattern: POST /v1/heatmap → activity_id
   → poll GET /v1/status/{id} until "Completed" (LRU cache: 200 entries, 30 min TTL)
        ▼
7. env_params on coolest-route midpoint → feels-like + wet-bulb + humidity
        ▼
8. Response: { routes, coolestRouteId, feelsLike, analyzedAt }
   Each route: { avgTemp, maxTemp, spread, hoursAboveThreshold, pctAbove35, heatGrid }
        ▼
9. Frontend renders: heat grid → colored dotted routes → markers → cards → verdict
        ▼
10. Non-blocking: POST /api/departure-window (probes +2/+4/+6h forecast
    + today's continuous >35°C persistence) → "Coolest departure" banner
```

**Latency profile (measured):**
- Cold request (FortyGuard queue): ~30–60s total (dominated by their async job queue)
- Warm/cached request: ~0–2s
- OSRM: ~1–3s · Geocoding: <1s · Corridor build: ~1.5–3s
- Optimization: tcm + exceedance now run **concurrently** per route (previously serial — halved per-route wall time)

---

## 7. Verification & Credibility (data-verification pipeline)

An independent pipeline (`data-verification/`) hits the **raw live APIs** (no cache, no app code paths) and checks 4 claims per scenario across 7 Montana scenarios:

1. **Optimality** — the recommended ("coolest") route is truly the coolest of the alternatives ✅
2. **Real-time** — data corresponds to the requested hour, freshness < 4h ✅
3. **Ground truth** — surface temps vs Open-Meteo air temps within expected physics ✅
4. **Plausibility & consistency** — physically sane values, repeat requests identical ✅

**Measured surface-vs-air deltas (daytime):** FortyGuard surface runs +4–5°C above air (asphalt radiates heat) — expected.
**Measured surface-vs-air deltas (nighttime, live 2026-08-30):** surface runs −2 to −5°C below air (radiational cooling) — also expected.

| City (night test) | Surface (app) | Air (Open-Meteo) | Gap |
|---|---|---|---|
| Helena → Capitol | 10.1°C | 15.4°C | −5.3°C |
| Missoula | 7.2°C | 10.4°C | −3.2°C |
| Billings | 15.3°C | 17.3°C | −2.0°C |
| Great Falls | 10.9°C | 14.5°C | −3.6°C |
| Big Sky | 6.0°C | 8.4°C | −2.4°C |

> **Pitch takeaway:** "The app is verified against an independent source. Surface ≠ air — that's the whole point: at night surfaces cool below the air, by day they bake above it. ShadeRoute measures the number that actually matters."

---

## 8. FortyGuard API Usage (documented in api_docs.txt — the source of the upgrade plan)

**Endpoints used:**
- `POST /v1/heatmap` — `analytic_type: tcm` (temperature per tile) + `exceedance` (hours above 35°C), `filter_type: 1/3`, `granularity: 60`
- `POST /v1/env_params` — `heat_index_celsius`, `wet_bulb_temperature_celsius`, `relative_humidity_percent`
- `GET /v1/status/{activity_id}` — async polling

**Endpoints confirmed available (key is PREMIUM — verified via `/api/plan` probe):**
- `POST /v1/satellite` — land-cover segmentation (tree/asphalt/building/water % per location) — **untapped, biggest remaining opportunity** ("why is this route hot" explainer)
- `POST /v1/streetview` — ground-level segmentation
- `POST /v1/heat_intelligence` — multi-dimensional PDF reports
- Full `env_params` — air quality (AQI), solar irradiance (GHI/DNI/DHI), precipitation, cloud cover, elevation

**Untapped analytics (would strengthen future iterations):**
- `analytic_type: persistence` — longest continuous stretch above threshold (real heat-risk number)
- `analytic_type: time_of_measure` — hour of peak heat per tile
- `filter_type: 2` (≤23h range) — full day temperature profile per route
- `filter_type: 4` (≤1 month) — weekly/monthly trends
- `direction: below` — hours in comfortable range

---

## 9. Development Timeline (git history)

| Commit | What |
|---|---|
| `53be01e` / `342fe76` | Initial project + repo commits |
| `d7c7755` | Security cleanup — removed leaked proxy keys from git history |
| `ebaad57` | Testing infrastructure, validation, documentation |
| `e214fab` | Fixed 0.0°C bug — real FortyGuard schema + hour rounding |
| `e893328` | Latency measurement, optimizations, standalone verification pipeline |
| `8bbfd61` | Redesign: dark thermal theme, route focus/isolation, SVG icons |
| `ec26b9a` | Light/dark theme toggle + theme-aware tiles |
| `c47faf7` | Fixed map tiles (CartoDB→keyless Esri canvas basemaps) |
| `61e279d` | Permanent dotted routes + robust PathStyler matching |
| `363e6a9` | "Above 35°C" shown only when there's real heat risk |
| `b5d41a8` | **Departure-window planner (+12h forecast), %-above-35 stat, heat-spread, plan probe** |
| `5299c71` | Removed "Recommended" badge (cleaner cards) |

---

## 10. How to Run

```bash
# 1. Root .env with the FortyGuard key (never committed)
echo 'FORTYGUARD_API_KEY=your_key_here' > .env

# 2. Build frontend (served statically by Express)
cd frontend && npm install && npm run build && cd ..

# 3. Run backend (port 4000)
cd backend && npm install && node server.js

# Open http://localhost:4000
```

---

## 11. Security Notes

- API key lives only in a gitignored root `.env`; read via `process.env.FORTYGUARD_API_KEY`.
- A leaked key from an earlier iteration was **purged from git history** (`d7c7755`); proxy scripts are gitignored.
- FortyGuard `download_link` (Heat Intelligence) is temporary/signed — never logged.

---

## 12. Differentiation vs. Competitors

| | Google/Apple Maps | Weather apps | **ShadeRoute** |
|---|---|---|---|
| What it optimizes | Time / distance | Nothing (reports only) | **Heat exposure** |
| Spatial detail | Route-level | One temp per city | **Per-60m corridor cells** |
| Measured quantity | — | Air temp @ 2m | **Surface temp** |
| Route-vs-route heat comparison | ✗ | ✗ | ✅ |
| Best time to leave (heat-aware) | ✗ | ✗ | ✅ |

---

## 13. Suggested Slide Outline (for the AI tool)

1. **Title** — ShadeRoute · Find the Coolest Route in Montana · *FortyGuard Global AI Hackathon '26*
2. **The Problem** — urban heat is invisible, deadly, and unequal; nav apps ignore it
3. **Surface ≠ Air** — the physics insight (asphalt up to +25°C in day, radiational cooling at night)
4. **The Solution** — heat-aware routing: which route, how hot, when to leave
5. **Live Demo** — enter addresses → heat grid → coolest route → departure planner (screenshot/video)
6. **How It Works** — architecture diagram (Section 6)
7. **Data Credibility** — verification results (Section 7)
8. **Tech Stack** — Section 5
9. **FortyGuard API Deep-Dive** — tcm, exceedance, env_params, forecast window (Premium confirmed)
10. **Business / Real-World Impact** — outdoor workers, heat-vulnerable residents, delivery fleets, city planning (Resilient Cities track)
11. **Future Roadmap** — satellite "why-hot" explainer, persistence, air quality, city-scale audits
12. **Thank You / Links** — repo: `github.com/h-a-m-z-a-A-L-i/Forty-Guard-hackathon`

---

## 14. Demo Script Skeleton (60–90 seconds)

1. *(0–10s)* "Open any navigation app and it optimizes for time. But in a heatwave, the street you choose can be 25°C hotter than the one next to it."
2. *(10–20s)* "ShadeRoute compares up to three routes by **real road-surface temperature** — not airport air temp, the actual surface you'd walk on."
3. *(20–35s)* "Here's Bozeman → Belgrade. The heat grid shows the live 60-meter temperature model across both corridors. Route 2 wins by 0.4°C — and notice its wet-bulb reading, the standard heat-stroke metric."
4. *(35–50s)* "The coolest route isn't always the fastest — here it costs 45 extra minutes for 0.4°C. ShadeRoute shows you the tradeoff and lets you decide."
5. *(50–70s)* "And it doesn't just pick the route — it picks the hour. The departure planner scans the 12-hour forecast and says: leave at 21:00 UTC, surfaces will be **6.8°C cooler**."
6. *(70–90s)* "Every number is verified against an independent source. This is hyperlocal heat intelligence — powered by FortyGuard's Large Temperature Models — built for people who actually have to walk outside."

---

*Generated: 2026-08-30 · Project: ShadeRoute (FortyGuard Global AI Hackathon '26) · Repo: https://github.com/h-a-m-z-a-A-L-i/Forty-Guard-hackathon*
