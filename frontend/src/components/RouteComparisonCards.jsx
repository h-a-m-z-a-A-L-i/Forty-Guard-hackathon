import React from 'react';

const value = (n, digits = 1) => (n == null || !Number.isFinite(Number(n))) ? '—' : Number(n).toFixed(digits);
const mins = s => Number.isFinite(Number(s)) ? `${Math.round(s / 60)} min` : '—';
const miles = m => Number.isFinite(Number(m)) ? `${Number(m / 1609.34).toFixed(1)} mi` : '—';

export default function RouteComparisonCards({ routes, coolestRouteId, feelsLike, hoveredRouteId, onHoverRoute, focusedRouteId, onFocusRoute }) {
  const fastest = routes.reduce((a, b) => !a || b.durationSeconds < a.durationSeconds ? b : a, null);

  return (
    <div className="cards">
      {routes.map(r => {
        const cool = r.routeId === coolestRouteId;
        const fast = fastest && r.routeId === fastest.routeId;
        const focused = focusedRouteId === r.routeId;
        const dimmed = focusedRouteId != null && !focused;
        let delta = null;
        if (cool && !fast) delta = { type: 'cool', text: `${Math.max(0, fastest.avgTemp - r.avgTemp).toFixed(1)}°C cooler than Route ${fastest.routeId + 1}` };
        else if (fast && !cool) delta = { type: 'fast', text: `Fastest — ${mins(r.durationSeconds)}` };
        else if (cool && fast) delta = { type: 'cool', text: 'Coolest & fastest — no tradeoff' };

        return (
          <article
            key={r.routeId}
            role="button"
            tabIndex={0}
            className={`card${cool ? ' cool' : ''}${hoveredRouteId === r.routeId ? ' hover' : ''}${focused ? ' focused' : ''}${dimmed ? ' dimmed' : ''}`}
            onClick={() => onFocusRoute?.(r.routeId)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocusRoute?.(r.routeId); } }}
            onMouseEnter={() => onHoverRoute?.(r.routeId)}
            onMouseLeave={() => onHoverRoute?.(null)}
          >
            <div className="card-head">
              <h3>{cool ? 'Coolest route' : `Route ${r.routeId + 1}`}</h3>
              {cool && <span className="badge cool">Recommended</span>}
              {fast && !cool && <span className="badge fast">Fastest</span>}
            </div>

            <div className="card-temp">{value(r.avgTemp)}<small>°C avg</small></div>

            <div className="card-stats">
              <div className="stat-chip"><small>Duration</small><b>{mins(r.durationSeconds)}</b></div>
              <div className="stat-chip"><small>Distance</small><b>{miles(r.distanceMeters)}</b></div>
              <div className="stat-chip"><small>Max temp</small><b>{value(r.maxTemp)}°C</b></div>
              {(r.pctAbove35 ?? 0) > 0 && (
                <div className="stat-chip"><small>Hot now</small><b>{r.pctAbove35}% of route</b></div>
              )}
              {(r.hoursAboveThreshold ?? 0) > 0 && (
                <div className="stat-chip"><small>Above 35°C</small><b>{value(r.hoursAboveThreshold)}h{r.pctAbove35 > 0 ? ` · ${r.pctAbove35}%` : ''}</b></div>
              )}
            </div>

            {delta && <div className={`delta ${delta.type}`}>{delta.text}</div>}
            {cool && feelsLike?.heat_index_celsius?.[0] != null && (
              <div className={`delta ${cool ? 'cool' : ''}`} style={{ marginTop: 8 }}>
                Feels like {value(feelsLike.heat_index_celsius[0])}°C
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
