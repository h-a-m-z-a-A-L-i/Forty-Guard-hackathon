# ShadeRoute — Data Verification Pipeline

A **standalone test pipeline** that verifies the credibility of the data behind
ShadeRoute. It is deliberately **separate from the app backend**:

- ✅ Hits the **raw live APIs directly — no cache, no app code paths**
- ✅ Uses the **same credentials** (project root `.env`) and the **same request
  shapes** as the app, so it tests exactly what production does
- ✅ Runs against **different places, climates, and route profiles**
- ✅ Answers the two big questions:
  1. *How do we know the recommended route is the most optimized?*
  2. *How do we know the temperature is real and real-time?*

## What it verifies

| Check | Question answered |
|---|---|
| `plausibility` | Are temps in a physical range, cells > 0, distances sane? |
| `optimality` | Is the chosen route actually the **coolest** of all OSRM alternatives — and by how much (°C margin)? |
| `realTime` | Does the data correspond to the **requested hour**, and is it **fresh** (< 4 h old)? |
| `groundTruth` | Do FortyGuard temps agree with an **independent source** (Open-Meteo hourly air temp)? |
| `consistency` | Do two identical raw requests return **identical** corridors & temperatures (deterministic)? |

## Setup

```bash
cd data-verification
npm install
```

Requires the project root `.env` with `FORTYGUARD_API_KEY` (same one the app uses).

## Run

```bash
# everything (7 scenarios, ~2-4 min — FortyGuard queue is ~20-40 s per job)
npm run run

# smoke test — just the first scenario
node scripts/run.js --limit=1

# specific scenarios
node scripts/run.js --scenarios=bozeman-walk,bozeman-livingston-drive

# more parallelism
node scripts/run.js --concurrency=3

# skip the expensive double-run consistency scenario
node scripts/run.js --skip-consistency

# label a run (results/latest-night.json + report-night.md)
node scripts/run.js --tag=night

# generate the markdown report from the latest run
npm run report
```

## Output

- `results/latest.json` — full machine-readable evidence (every route's temps,
  corridors, ground truth, check pass/fail, timings)
- `results/report.md` — the human-readable credibility report + the "story"

## Scenario coverage

> ⚠️ **Scope:** the FortyGuard API key is licensed for **Montana only** (Montana
> State area). All default scenarios are inside Montana. Out-of-state scenarios
> can be added, but will fail the plausibility check with `n_cells = 0`
> (no coverage) — which is itself a useful finding.

| id | Route | Profile | Distance |
|---|---|---|---|
| `bozeman-walk` | Bozeman → MSU | foot | ~4 km walk |
| `msu-museum-walk` | MSU → Museum of the Rockies | foot | <1 km campus walk |
| `bozeman-belgrade-drive` | Bozeman → Belgrade | driving | ~10 km valley |
| `bozeman-livingston-drive` | Bozeman → Livingston | driving | ~40 km canyon |
| `bozeman-bigsky-drive` | Bozeman → Big Sky | driving | ~65 km mountain |
| `bozeman-threeforks-drive` | Bozeman → Three Forks | driving | ~50 km prairie |
| `bozeman-repeat` | Bozeman → MSU (pinned past hour ×2) | foot | consistency/determinism |

Add your own scenarios in `config/scenarios.js` — each entry is `origin`,
`destination`, `profile`, and `time` (`"now"` or an ISO past hour for
deterministic re-tests).
