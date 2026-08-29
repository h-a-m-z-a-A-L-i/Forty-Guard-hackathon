import React, { useState, useRef, useEffect } from 'react';
import MapView from './components/MapView';
import RouteComparisonCards from './components/RouteComparisonCards';
import { compareRoutes, geocode } from './api/client';

const temp = value => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `${Number(value).toFixed(1)}°C`;
const mins = s => Number.isFinite(Number(s)) ? `${Math.round(s / 60)} min` : '—';
const miles = m => Number.isFinite(Number(m)) ? `${Number(m / 1609.34).toFixed(1)} mi` : '—';

const Icon = ({ d, extra, sw = 2, size = 15 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}{extra}</svg>
);
const LEAF = <>
  <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
  <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
</>;
const PIN = <>
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
  <circle cx="12" cy="10" r="3" />
</>;
const FLAG = <>
  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
  <line x1="4" x2="4" y1="22" y2="15" />
</>;
const THERMO = <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />;
const COMPASS = <>
  <circle cx="12" cy="12" r="10" />
  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
</>;
const CHECK = <polyline points="20 6 9 17 4 12" />;
const SWAP = <>
  <path d="M8 3 4 7l4 4" /><path d="M4 7h16" />
  <path d="m16 21 4-4-4-4" /><path d="M20 17H4" />
</>;

// Rotating status messages shown while the backend polls FortyGuard.
// A cold request takes ~30-60s; cached requests finish in ~2s.
const STAGE_MESSAGES = [
  'Contacting routing service…',
  'Buffering route corridors…',
  'Requesting hyperlocal temperature models…',
  'Waiting for heat data (this can take ~30s)…',
  'Comparing corridors & computing feels-like…',
  'Almost there…',
];

const SUGGESTIONS = [
  ['Bozeman, MT', 'Montana State University, Bozeman, MT'],
  ['Bozeman, MT', 'Belgrade, MT'],
  ['Bozeman, MT', 'Livingston, MT'],
];

export default function App() {
  const [from, setFrom] = useState(() => localStorage.getItem('sr-from') || 'Bozeman, MT');
  const [to, setTo] = useState(() => localStorage.getItem('sr-to') || 'Montana State University, Bozeman, MT');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState(null); // timestamp of a restored cache result
  const [hoveredRouteId, setHoveredRouteId] = useState(null); // route highlighted from cards
  const [focusedRouteId, setFocusedRouteId] = useState(null); // isolate a single route (map + info)
  const abortRef = useRef(null);

  const cacheKey = `${from.trim().toLowerCase()}|${to.trim().toLowerCase()}`;
  const focusRoute = id => setFocusedRouteId(prev => (prev === id ? null : id));

  // Restore last result from localStorage if it matches the current query.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sr-result'));
      if (saved && saved.key === cacheKey) {
        setResult(saved.value);
        setCachedAt(saved.at);
      }
    } catch (e) { /* ignore corrupt cache */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer + rotating messages while loading.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0); setStageIdx(0);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    const rotator = setInterval(() => setStageIdx(i => (i + 1) % STAGE_MESSAGES.length), 6000);
    return () => { clearInterval(timer); clearInterval(rotator); };
  }, [loading]);

  const swap = () => { setFrom(to); setTo(from); };

  const go = async e => {
    e.preventDefault();
    if (loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true); setError(''); setCachedAt(null);
    localStorage.setItem('sr-from', from);
    localStorage.setItem('sr-to', to);
    try {
      const o = await geocode(from, controller.signal);
      const d = await geocode(to, controller.signal);
      const data = await compareRoutes(o, d, null, controller.signal);
      const value = { ...data, origin: o, destination: d };
      setResult(value);
      setFocusedRouteId(null);
      localStorage.setItem('sr-result', JSON.stringify({ key: cacheKey, value, at: Date.now() }));
    } catch (x) {
      if (x?.code !== 'ERR_CANCELED') setError(x.response?.data?.error || x.message);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const routes = result?.routes || [];
  const winner = routes.find(r => r.routeId === result.coolestRouteId) || routes[0];
  const fastest = routes.reduce((a, b) => !a || b.durationSeconds < a.durationSeconds ? b : a, null);
  const feelsLike = result?.feelsLike?.heat_index_celsius?.[0];
  const timePenalty = winner && fastest && winner.routeId !== fastest.routeId
    ? Math.round((winner.durationSeconds - fastest.durationSeconds) / 60) : 0;
  const focused = routes.find(r => r.routeId === focusedRouteId) || null;

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">
          <span className="brand-mark"><Icon d={LEAF} size={18} /></span> ShadeRoute
        </div>
        <div className="status-pill"><span className="status-dot" />Live · Montana</div>
      </nav>

      <section className="hero">
        <div className="hero-eyebrow">Montana State · Heat-Aware Navigation</div>
        <h1>Beat the heat.<br /><span className="grad-text">Find your coolest route.</span></h1>
        <p className="hero-sub">
          ShadeRoute compares <strong>real-time road-surface temperatures</strong> across alternate
          routes and shows you the one that keeps you coolest.
        </p>
        <div className="suggestions">
          {SUGGESTIONS.map(([a, b], i) => (
            <button key={i} type="button" className="suggestion" disabled={loading}
              onClick={() => { setFrom(a); setTo(b); }}>
              {a.split(',')[0]} → {b.split(',')[0]}
            </button>
          ))}
        </div>
      </section>

      <form className="form-panel" onSubmit={go}>
        <div className="field">
          <label htmlFor="from">From</label>
          <div className="input-wrap">
            <span className="input-icon"><Icon d={PIN} size={15} /></span>
            <input id="from" value={from} onChange={e => setFrom(e.target.value)} placeholder="e.g. Bozeman, MT" required disabled={loading} />
          </div>
        </div>
        <button type="button" className="swap-btn" onClick={swap} disabled={loading} title="Swap start & destination" aria-label="Swap"><Icon d={SWAP} size={18} /></button>
        <div className="field">
          <label htmlFor="to">To</label>
          <div className="input-wrap">
            <span className="input-icon"><Icon d={FLAG} size={15} /></span>
            <input id="to" value={to} onChange={e => setTo(e.target.value)} placeholder="e.g. Montana State University" required disabled={loading} />
          </div>
        </div>
        <button className="cta-btn" disabled={loading}>
          {loading ? 'Analyzing heat…' : 'Find my coolest route'} <span aria-hidden>→</span>
        </button>
      </form>

      {cachedAt && !loading && (
        <div className="notice">
          Showing cached results from {Math.max(1, Math.round((Date.now() - cachedAt) / 60000))} min ago.
          {' '}Press “Find my coolest route” for fresh data.
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {loading && (
        <div className="loading">
          <div className="loading-ring" aria-hidden="true" />
          <p className="loading-title">Analyzing heat corridors…</p>
          <p className="loading-sub">{STAGE_MESSAGES[stageIdx]}</p>
          <p className="loading-elapsed">{elapsed}s elapsed — first request usually takes 30–60s</p>
          <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(92, (elapsed / 50) * 100)}%` }} /></div>
          <button type="button" className="cancel-btn" onClick={() => abortRef.current?.abort()}>Cancel</button>
        </div>
      )}

      {result && winner && (
        <>
          {/* --- Verdict: the single most important answer --- */}
          <section className="verdict">
            <div className="verdict-inner">
              <div className="verdict-badge" aria-hidden="true"><Icon d={LEAF} size={36} /></div>
              <div className="verdict-main">
                <small>Coolest route</small>
                <h2>{result.origin?.label?.split(',').slice(0, 2).join(',') || 'Start'} → {result.destination?.label?.split(',').slice(0, 2).join(',') || 'End'}</h2>
                <div className="verdict-temp">
                  {temp(winner.avgTemp)} average <span>· max {temp(winner.maxTemp)}</span>
                </div>
              </div>
              <div className="verdict-stats">
                <div className="stat">
                  <div className="stat-label">Feels like</div>
                  <div className="stat-value good">{feelsLike == null ? '—' : `${Number(feelsLike).toFixed(1)}°C`}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">vs fastest route</div>
                  <div className="stat-value good">
                    {fastest && winner.routeId !== fastest.routeId
                      ? `${Math.max(0, (fastest.avgTemp - winner.avgTemp)).toFixed(1)}°C cooler`
                      : 'No tradeoff'}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Time penalty</div>
                  <div className="stat-value">{timePenalty > 0 ? `+${timePenalty} min` : 'Same time'}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Distance</div>
                  <div className="stat-value">{miles(winner.distanceMeters)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Above 35°C</div>
                  <div className="stat-value warn">{winner.hoursAboveThreshold == null ? '—' : `${Number(winner.hoursAboveThreshold).toFixed(1)} hrs`}</div>
                </div>
              </div>
              {result.analyzedAt && (
                <div className="verdict-meta">Analyzed {result.analyzedAt.startDate} {result.analyzedAt.startTime} UTC · live FortyGuard surface model · {routes.length} alternate routes</div>
              )}
            </div>
          </section>

          <div className="section">
            <span className="section-eyebrow">Heat map</span>
            <h3>Routes on the map</h3>
            <span className="section-note">
              {focused ? `Showing only Route ${focused.routeId + 1}` : 'Click a route to isolate it'}
            </span>
          </div>

          {focused && (
            <div className="focus-panel">
              <div className="focus-head">
                <small>{focused.routeId === winner.routeId ? 'Coolest route' : `Route ${focused.routeId + 1}`}</small>
                <h4>{result.origin?.label?.split(',').slice(0, 2).join(',') || 'Start'} → {result.destination?.label?.split(',').slice(0, 2).join(',') || 'End'}</h4>
              </div>
              <div className="focus-stats">
                <div className="focus-stat"><small>Avg temp</small><b>{temp(focused.avgTemp)}</b></div>
                <div className="focus-stat"><small>Max temp</small><b>{temp(focused.maxTemp)}</b></div>
                <div className="focus-stat"><small>Feels like</small><b>{feelsLike == null ? '—' : `${Number(feelsLike).toFixed(1)}°C`}</b></div>
                <div className="focus-stat"><small>Duration</small><b>{mins(focused.durationSeconds)}</b></div>
                <div className="focus-stat"><small>Distance</small><b>{miles(focused.distanceMeters)}</b></div>
                <div className="focus-stat"><small>Above 35°C</small><b>{focused.hoursAboveThreshold == null ? '—' : `${Number(focused.hoursAboveThreshold).toFixed(1)} hrs`}</b></div>
                <div className="focus-stat"><small>vs coolest</small><b>{focused.routeId === winner.routeId ? 'Coolest' : `+${Math.max(0, focused.avgTemp - winner.avgTemp).toFixed(1)}°C`}</b></div>
              </div>
              <button className="focus-reset" onClick={() => setFocusedRouteId(null)}>× Show all routes</button>
            </div>
          )}

          <MapView {...result} hoveredRouteId={hoveredRouteId} focusedRouteId={focusedRouteId} onFocusRoute={focusRoute} />

          <div className="section">
            <span className="section-eyebrow">Compare</span>
            <h3>Route-by-route breakdown</h3>
            <span className="section-note">
              The winner is the route with the lowest average surface temperature across its full
              corridor — every alternative is scored by the same live heat model, so the ranking is apples-to-apples.
            </span>
          </div>
          <RouteComparisonCards {...result} hoveredRouteId={hoveredRouteId} onHoverRoute={setHoveredRouteId}
            focusedRouteId={focusedRouteId} onFocusRoute={focusRoute} />

          <div className="section">
            <span className="section-eyebrow">Why trust this</span>
            <h3>Data, verified</h3>
          </div>
          <div className="trust">
            <div className="trust-card">
              <div className="t-icon"><Icon d={THERMO} size={18} /></div>
              <h4>Live surface temperatures</h4>
              <p>FortyGuard hyperlocal heat model, refreshed in real time for your exact corridor.</p>
            </div>
            <div className="trust-card">
              <div className="t-icon"><Icon d={COMPASS} size={18} /></div>
              <h4>Fair comparison</h4>
              <p>Every route runs through the same corridor analysis — same time, same model.</p>
            </div>
            <div className="trust-card">
              <div className="t-icon"><Icon d={CHECK} sw={2.5} size={18} /></div>
              <h4>Cross-checked vs ground truth</h4>
              <p>Verified against Open-Meteo observations — within a few °C in our test pipeline.</p>
            </div>
          </div>
        </>
      )}

      <footer>
        <span>Built for <b>Montana State</b> · FortyGuard · OSRM · Open-Meteo</span>
        <span>ShadeRoute — demo build</span>
      </footer>
    </div>
  );
}
