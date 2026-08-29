/**
 * Test scenarios — different Montana addresses, distances, and route profiles.
 *
 * ⚠️ SCOPE: the FortyGuard API key is licensed for Montana only (Montana State
 * area). All default scenarios stay inside Montana so coverage is guaranteed.
 * You CAN add out-of-state scenarios, but expect them to fail the
 * plausibility check with n_cells = 0 (no coverage) — which is itself a
 * useful credibility finding.
 *
 * `time`:
 *   - "now"           → current UTC hour (what the app does) — tests "real-time"
 *   - ISO past hour   → pinned historical hour — needed for the consistency test
 *                      (FortyGuard results for a past hour are immutable, so two
 *                      identical requests MUST return identical data)
 *
 * `profile`: 'foot' | 'driving' (driving = project-osrm, foot = openstreetmap.de)
 *
 * `repeat`: run the scenario twice and compare (consistency check). Expensive
 *           (2× queue time), so only on one scenario by default.
 */
const yesterdayNoon = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(15, 0, 0, 0);
  return d.toISOString();
})();

const scenarios = [
  {
    id: 'bozeman-walk',
    label: 'Bozeman → Montana State University (short walk, city streets)',
    origin: 'Bozeman, MT, USA',
    destination: 'Montana State University, Bozeman, MT, USA',
    profile: 'foot',
    time: 'now'
  },
  {
    id: 'msu-museum-walk',
    label: 'MSU → Museum of the Rockies (very short walk, campus)',
    origin: 'Montana State University, Bozeman, MT, USA',
    destination: 'Museum of the Rockies, Bozeman, MT, USA',
    profile: 'foot',
    time: 'now'
  },
  {
    id: 'bozeman-belgrade-drive',
    label: 'Bozeman → Belgrade (short drive ~10 km, valley floor)',
    origin: 'Bozeman, MT, USA',
    destination: 'Belgrade, MT, USA',
    profile: 'driving',
    time: 'now'
  },
  {
    id: 'bozeman-livingston-drive',
    label: 'Bozeman → Livingston (drive ~40 km, Gallatin Valley + canyon)',
    origin: 'Bozeman, MT, USA',
    destination: 'Livingston, MT, USA',
    profile: 'driving',
    time: 'now'
  },
  {
    id: 'bozeman-bigsky-drive',
    label: 'Bozeman → Big Sky (mountain drive ~65 km, elevation gain)',
    origin: 'Bozeman, MT, USA',
    destination: 'Big Sky, MT, USA',
    profile: 'driving',
    time: 'now'
  },
  {
    id: 'bozeman-threeforks-drive',
    label: 'Bozeman → Three Forks (drive ~50 km, open prairie)',
    origin: 'Bozeman, MT, USA',
    destination: 'Three Forks, MT, USA',
    profile: 'driving',
    time: 'now'
  },
  {
    id: 'bozeman-repeat',
    label: 'Bozeman → MSU — pinned past hour, run TWICE (consistency + determinism)',
    origin: 'Bozeman, MT, USA',
    destination: 'Montana State University, Bozeman, MT, USA',
    profile: 'foot',
    time: yesterdayNoon,
    repeat: true
  }
];

module.exports = { scenarios };
