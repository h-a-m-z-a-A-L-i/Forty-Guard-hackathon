import React, { useState, useRef, useEffect } from 'react';
import MapView from './components/MapView';
import RouteComparisonCards from './components/RouteComparisonCards';
import { compareRoutes, geocode } from './api/client';

const temp = value => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `${Number(value).toFixed(1)}°C`;

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

export default function App() {
  const [from, setFrom] = useState(() => localStorage.getItem('sr-from') || 'Bozeman, MT');
  const [to, setTo] = useState(() => localStorage.getItem('sr-to') || 'Montana State University, Bozeman, MT');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState(null); // timestamp of a restored cache result
  const abortRef = useRef(null);

  const cacheKey = `${from.trim().toLowerCase()}|${to.trim().toLowerCase()}`;

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
      localStorage.setItem('sr-result', JSON.stringify({ key: cacheKey, value, at: Date.now() }));
    } catch (x) {
      if (x?.code !== 'ERR_CANCELED') setError(x.response?.data?.error || x.message);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const winner = result?.routes?.find(r => r.routeId === result.coolestRouteId) || result?.routes?.[0];

  return (
    <main>
      <header>
        <div className="eyebrow">MONTANA STATE · HEAT-AWARE NAVIGATION</div>
        <h1>Shade<span>Route</span></h1>
        <p>Find the coolest way to get there, using hyperlocal temperature data.</p>
      </header>

      <form onSubmit={go}>
        <label>From
          <input value={from} onChange={e => setFrom(e.target.value)} required disabled={loading} />
        </label>
        <label>To
          <input value={to} onChange={e => setTo(e.target.value)} required disabled={loading} />
        </label>
        <button disabled={loading}>{loading ? 'Analyzing heat…' : 'Compare routes'}</button>
      </form>

      {cachedAt && !loading && (
        <div className="notice">
          Showing cached results from {Math.max(1, Math.round((Date.now() - cachedAt) / 60000))} min ago.
          {' '}Press “Compare routes” for fresh data.
        </div>
      )}

      {error && <div className="error">⚠ {error}</div>}

      {loading && (
        <div className="loading">
          <div className="loading-spinner" aria-hidden="true" />
          <p className="loading-title">Analyzing heat corridors…</p>
          <p className="loading-sub">{STAGE_MESSAGES[stageIdx]}</p>
          <p className="loading-elapsed">⏱ {elapsed}s elapsed — first request usually takes 30–60s</p>
          <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(92, (elapsed / 50) * 100)}%` }} /></div>
          <button type="button" className="cancel-btn" onClick={() => abortRef.current?.abort()}>Cancel</button>
        </div>
      )}

      {result && winner && (
        <>
          <section className="headline">
            <div>
              <small>COOLEST OPTION</small>
              <strong>{temp(winner.avgTemp)} average</strong>
              <span>Real hyperlocal temperature along your route</span>
            </div>
            {result.analyzedAt && <div className="headline-meta">Analyzed for {result.analyzedAt.startDate} {result.analyzedAt.startTime} UTC</div>}
          </section>
          <MapView {...result} />
          <RouteComparisonCards {...result} />
        </>
      )}
    </main>
  );
}
