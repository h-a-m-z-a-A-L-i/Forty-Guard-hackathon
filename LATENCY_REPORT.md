# ShadeRoute — API Latency Report & Optimization Summary

**Date:** 2026-08-29 · **Route tested:** Bozeman, MT → Montana State University

---

## 1. How latency was measured

Two new tools were added to `backend/scripts/`:

| Script | Purpose |
|---|---|
| `api-latency.js` | Times every stage of the data-receiving pipeline (OSRM → corridor → FortyGuard submit/poll → env_params) and optionally measures the real end-to-end HTTP call (`--e2e`) with time-to-first-byte. |
| `corridor-experiment.js` | Isolates whether polygon complexity affects FortyGuard queue time. |

```bash
node scripts/api-latency.js --e2e --repeat=2   # cold + warm e2e measurement
node scripts/corridor-experiment.js            # corridor size experiment
```

---

## 2. Results — before vs after

### End-to-end (what the user actually waits for)

| Scenario | Before | After | Δ |
|---|---|---|---|
| **Cold request** (first ever) | ~88 s | **~46 s** | **−48%** |
| **Warm request** (same route within 30 min) | ~88 s | **~0.5–1.7 s** | **~50–100× faster** |

### Stage-by-stage (cold path, measured live)

```
stage                    before      after       notes
osrm (routing)           2.6 s       0.7 s       faster endpoint + fallback
corridor (turf CPU)      62 ms       20-60 ms    simplified 171→13 rings
fg tcm submit            2.9 s       1.5 s       smaller payload after simplify
fg tcm queue+poll        ~22-43 s    ~22-35 s    dominated by FortyGuard queue
fg exceedance            ~30-33 s    overlapped  now runs concurrent w/ tcm
env_params               ~4-26 s     ~4-5 s      cached
```

The single biggest cost on the **cold** path is FortyGuard's async job queue
(~20-40 s per analytic) — that is outside our control, but we now:
1. run TCM and exceedance **concurrently** instead of serially (halves per-route wall time),
2. poll **adaptively** (500 ms early polls, then 1.5 s) so completed jobs are picked up almost immediately,
3. **cache** every result in memory (30 min TTL) so repeat requests are instant.

---

## 3. Bottleneck breakdown (cold request, ~46 s)

```
osrm  ██                                      ~1 s     routing API (public)
corr  ▏                                        ~0.05 s  turf CPU
fg tcm+exceedance (parallel) █████████████████ ~40 s    FortyGuard queue + polling
env   ██                                       ~4 s     feels-like, cached after 1st
```

**Remaining bottleneck:** FortyGuard job queue. Options if it must go faster:

- **Switch to a synchronous/snapshot data source** (e.g., cached hourly TCM tiles) — biggest possible win, requires a different vendor integration.
- **Reduce to a single analytic** on the coolest route only (skip exceedance for non-coolest routes; it is only shown as a badge).
- **Pre-warm the cache** for popular routes with a cron/`setInterval` job at each hour boundary.
- **Self-host OSRM** for routing (sub-50 ms) and cut the public-server variance (we measured 0.2 s to 12 s on the same request).

---

## 4. Optimizations implemented

### Backend (`backend/`)
- **`lib/osrm.js`** — primary endpoint switched to `routing.openstreetmap.de/routed-foot` (measured ~0.8 s, **2 alternatives**) with `router.project-osrm.org` as automatic fallback (measured 1.3–12 s, 1 alternative). Timeout cut to 15 s. This is why the map now shows 2 route options instead of 1.
- **`lib/corridor.js`** — polygons simplified with turf (`tolerance 0.0005`, high-quality). 171 rings → 13 rings. Halves every FortyGuard submit (2.9 s → 1.5 s). Experiment proved queue time is unaffected by polygon size, so this is a pure win.
- **`lib/fortyguard.js`** —
  - **Adaptive polling:** 500 ms × 8 early polls, then 1.5 s (was a flat 2.5 s, adding up to 2.5 s of dead time after every completion).
  - **In-memory LRU result cache** (30 min TTL, 200 entries), keyed by corridor + date/time + analytic. Exposed via `heatmapCached` / `envParamsCached`.
- **`server.js`** —
  - TCM + exceedance are now **submitted concurrently per route** (were strictly serial: tcm queue then exceedance queue).
  - Uses the cached helpers for all three heatmaps and env_params.
  - `/api/health` now reports `cacheEntries` for observability.

### Frontend (`frontend/`)
- **`App.jsx`** — replaced the single static notice with:
  - live loading state: elapsed timer, rotating stage messages, progress bar, **Cancel** button (AbortController wired through `client.js`).
  - **localStorage result cache** — returning users instantly see the last result for the same from/to with a “cached X min ago” notice.
  - shows the analyzed UTC hour from the backend; inputs disabled while loading.
- **`src/api/client.js`** — accepts `AbortSignal` and adds per-request timeouts (geocode 15 s, compare 120 s).

### Map (`MapView.jsx`, `styles.css`)
- Replaced the abstract SVG projection with a **real interactive Leaflet map** (react-leaflet + OpenStreetMap tiles — deps were already installed):
  - routes drawn as temperature-colored polylines, coolest route thicker/full opacity;
  - **Start/End markers** with permanent labels;
  - **sticky tooltips** (hover any route for avg/max temp, duration, distance) and a detail **popup**;
  - **temperature legend** (20–45 °C gradient);
  - auto **fit-bounds** with padding, scroll-wheel zoom disabled for page scroll UX;
  - route count shown in header label; `leaflet.css` imported, no console errors.

---

## 5. Test evidence

| Test | Result |
|---|---|
| `node --check` on all backend files | ✅ |
| `npm test` (9 unit tests: corridor, osrm) | ✅ 9/9 |
| `npm run test:integration` (7 integration tests) | ✅ 7/7 |
| `npm run build` (frontend, Vite) | ✅ 125 modules, 114 kB gzip |
| Live e2e cold | 45.7 s |
| Live e2e warm (cache) | 0.48–1.65 s |
| Browser test (map, legend, tooltips, 2 routes, feels-like) | ✅ no console errors |

---

## 6. Quick start

```bash
# backend (needs .env with FortyGuard key)
cd backend && node server.js          # port 4000

# latency probe
cd backend && node scripts/api-latency.js --e2e

# frontend dev
cd frontend && npm run dev            # http://localhost:5173
```

**Summary:** cold latency halved (88 s → 46 s) by parallelizing the FortyGuard
analytics and using a faster routing endpoint; repeat latency collapsed to
under 2 s thanks to an in-memory result cache. The remaining 40 s on the first
request is FortyGuard's async job queue, which only a different data source or
pre-warmed cache can eliminate.
