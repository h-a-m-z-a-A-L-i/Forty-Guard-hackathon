import React, { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Popup, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Temperature→color ramp tuned for the dark basemap (cool cyan → hot red).
export const routeColor = temp => {
  if (temp == null || !Number.isFinite(Number(temp))) return '#8b98a8';
  const ratio = Math.max(0, Math.min(1, (Number(temp) - 20) / 25));
  return `rgb(${Math.round(45 + 210 * ratio)},${Math.round(212 - 135 * ratio)},${Math.round(191 - 114 * ratio)})`;
};

const fmt = n => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(1);
const mins = s => Number.isFinite(Number(s)) ? `${Math.round(s / 60)} min` : '—';
const miles = m => fmt(Number(m) / 1609.34);

// react-leaflet v4 ignores `className` in pathOptions, so we stamp styling
// classes directly onto the rendered SVG paths. Rendered inside the map, it
// sees every layeradd/layerremove and re-stamps after each change.
function PathStyler({ routes, coolestRouteId, hoveredRouteId, focusedRouteId }) {
  const map = useMap();
  useEffect(() => {
    let raf;
    const stamp = () => {
      const svg = map.getPane('overlayPane')?.querySelector('svg');
      if (!svg) return;
      const paths = Array.from(svg.querySelectorAll('path'));
      const visibleRoutes = (routes || []).filter(r => focusedRouteId == null || r.routeId === focusedRouteId);
      paths.slice(0, visibleRoutes.length).forEach((el, i) => {
        const route = visibleRoutes[i];
        if (!route) return;
        const highlighted = focusedRouteId != null ? route.routeId === focusedRouteId : route.routeId === coolestRouteId;
        el.classList.remove('route-cool', 'route-other', 'route-hover');
        if (highlighted) el.classList.add('route-cool');
        else if (hoveredRouteId === route.routeId) el.classList.add('route-hover');
        else el.classList.add('route-other');
      });
    };
    const onLayer = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(stamp); };
    map.on('layeradd layerremove', onLayer);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(stamp);
    return () => { map.off('layeradd layerremove', onLayer); cancelAnimationFrame(raf); };
  }, [map, routes, coolestRouteId, hoveredRouteId, focusedRouteId]);
  return null;
}

export default function MapView({ routes = [], coolestRouteId, origin, destination, hoveredRouteId, focusedRouteId, onFocusRoute }) {

  const { latlngs, bounds } = useMemo(() => {
    const ll = (routes || []).map(route => ({
      route,
      points: (route.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    }));
    const flat = ll.flatMap(r => r.points);
    const bounds = flat.length
      ? [[Math.min(...flat.map(p => p[0])), Math.min(...flat.map(p => p[1]))],
         [Math.max(...flat.map(p => p[0])), Math.max(...flat.map(p => p[1]))]]
      : null;
    return { latlngs: ll, bounds };
  }, [routes]);

  if (!latlngs.length) return null;
  const visible = latlngs.filter(({ route }) => (focusedRouteId == null ? true : route.routeId === focusedRouteId));

  return (
    <div className="map">
      <div className="map-label">
        {origin?.label || 'Start'} → {destination?.label || 'End'}
      </div>
      <div className="map-note"><i />Hyperlocal surface temps</div>

      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [60, 60] }}
        scrollWheelZoom={false}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
        />
        <ZoomControl position="topright" />

        {/* Routes colored by average temperature */}
        {visible.map(({ route, points }) => {
          const focused = focusedRouteId != null;
          const cool = focused ? route.routeId === focusedRouteId : route.routeId === coolestRouteId;
          const hovered = !focused && hoveredRouteId === route.routeId;
          const color = routeColor(route.avgTemp);
          const title = route.routeId === coolestRouteId ? 'Coolest route' : `Route ${route.routeId + 1}`;
          return (
            <Polyline
              key={route.routeId}
              positions={points}
              pathOptions={{
                color,
                weight: cool ? 7 : hovered ? 6 : 3.5,
                opacity: cool ? 0.95 : hovered ? 0.95 : 0.55,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            >
              <Tooltip sticky>
                <strong>{title}</strong>
                <br />Avg {fmt(route.avgTemp)}°C · Max {fmt(route.maxTemp)}°C
                <br />{mins(route.durationSeconds)} · {miles(route.distanceMeters)} mi
              </Tooltip>
              <Popup>
                <strong>{title}</strong>
                <div>Avg temperature: {fmt(route.avgTemp)}°C</div>
                <div>Max temperature: {fmt(route.maxTemp)}°C</div>
                <div>{route.hoursAboveThreshold == null ? 'Unavailable' : `${fmt(route.hoursAboveThreshold)} hrs above 35°C`}</div>
                <div>{mins(route.durationSeconds)} · {miles(route.distanceMeters)} mi</div>
              </Popup>
            </Polyline>
          );
        })}

        {/* Start / end markers */}
        {origin && (
          <CircleMarker center={[origin.lat, origin.lng]} radius={9} pathOptions={{ color: '#e8edf2', weight: 3, fillColor: '#38d9a9', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -12]} permanent>Start</Tooltip>
            <Popup><strong>Start</strong><div>{origin.label}</div></Popup>
          </CircleMarker>
        )}
        {destination && (
          <CircleMarker center={[destination.lat, destination.lng]} radius={9} pathOptions={{ color: '#e8edf2', weight: 3, fillColor: '#ff6b35', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -12]} permanent>End</Tooltip>
            <Popup><strong>End</strong><div>{destination.label}</div></Popup>
          </CircleMarker>
        )}

        <PathStyler routes={routes} coolestRouteId={coolestRouteId} hoveredRouteId={hoveredRouteId} focusedRouteId={focusedRouteId} />
      </MapContainer>

      {focusedRouteId != null && (
        <button type="button" className="map-focus-btn" onClick={() => onFocusRoute?.(null)}>
          × Show all routes
        </button>
      )}

      {/* Route focus chips */}
      <div className="chips">
        {latlngs.map(({ route }) => {
          const active = focusedRouteId === route.routeId;
          const cool = route.routeId === coolestRouteId;
          return (
            <button key={route.routeId} type="button"
              className={`chip${cool ? ' cool' : ''}${active ? ' active' : ''}`}
              onClick={() => onFocusRoute?.(route.routeId)}
              title={active ? 'Show all routes' : `Show only Route ${route.routeId + 1}`}
            >
              <span className="dot" style={{ background: routeColor(route.avgTemp) }} />
              {cool ? 'Coolest' : `Route ${route.routeId + 1}`}
              <span className="chip-temp">{fmt(route.avgTemp)}°C</span>
            </button>
          );
        })}
      </div>

      {/* Temperature legend */}
      <div className="legend">
        <span className="legend-title">Avg surface temp</span>
        <div className="legend-bar" />
        <div className="legend-scale"><span>20°C</span><span>32°C</span><span>45°C</span></div>
      </div>
    </div>
  );
}
