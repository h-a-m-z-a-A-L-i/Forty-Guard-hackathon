import React, { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Popup, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Temperature→color ramp tuned for the dark basemap (cool cyan → hot red).
// In light mode the ramp is darkened ~20% to keep contrast on pale tiles.
export const routeColor = (temp, light = false) => {
  if (temp == null || !Number.isFinite(Number(temp))) return light ? '#6b7a8a' : '#8b98a8';
  const ratio = Math.max(0, Math.min(1, (Number(temp) - 20) / 25));
  let r = 45 + 210 * ratio, g = 212 - 135 * ratio, b = 191 - 114 * ratio;
  if (light) { r *= 0.78; g *= 0.78; b *= 0.78; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
};

const fmt = n => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(1);
const mins = s => Number.isFinite(Number(s)) ? `${Math.round(s / 60)} min` : '—';
const miles = m => fmt(Number(m) / 1609.34);

// react-leaflet v4 ignores `className` in pathOptions, so we stamp styling
// classes directly onto the rendered SVG paths. We match each leaflet layer to
// its route by geometry (not DOM order, which puts markers before routes), so
// the classes always land on the right paths in every focus/hover state.
function PathStyler({ routes, coolestRouteId, hoveredRouteId, focusedRouteId }) {
  const map = useMap();
  useEffect(() => {
    let raf;
    const isLatLng = p => p && typeof p === 'object' && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
    // Only Polyline layers return flat LatLng arrays. Heat-grid GeoJSON layers
    // return nested rings — return null for those so we skip them safely.
    const keyOf = ll => (Array.isArray(ll) && ll.every(isLatLng))
      ? JSON.stringify(ll.map(p => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]))
      : null;
    const routeByKey = new Map(
      (routes || []).map(r => [keyOf((r.geometry?.coordinates || []).map(([lng, lat]) => ({ lat, lng }))), r])
    );
    const stamp = () => {
      map.eachLayer(layer => {
        // Skip non-route layers: TileLayer (no getLatLngs) and CircleMarkers (getRadius).
        if (typeof layer.getLatLngs !== 'function' || typeof layer.getRadius === 'function') return;
        const key = keyOf(layer.getLatLngs());
        if (key == null) return; // nested latlngs (heat grid) or empty
        const route = routeByKey.get(key);
        const el = layer.getElement();
        if (!route || !el) return;
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

export default function MapView({ routes = [], coolestRouteId, origin, destination, hoveredRouteId, focusedRouteId, onFocusRoute, theme = 'dark' }) {

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
  const light = theme === 'light';
  const tiles = light
    ? { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', stroke: '#1c2733' }
    : { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', stroke: '#e8edf2' };

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
          attribution='Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ'
          url={tiles.url}
        />
        <ZoomControl position="topright" />

        {/* Routes colored by average temperature */}
        {visible.map(({ route, points }) => {
          const focused = focusedRouteId != null;
          const cool = focused ? route.routeId === focusedRouteId : route.routeId === coolestRouteId;
          const hovered = !focused && hoveredRouteId === route.routeId;
          const color = routeColor(route.avgTemp, light);
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
                dashArray: '2 9', // every route is born dotted — never solid
              }}
            >
              <Tooltip sticky>
                <strong>{title}</strong>
                <br />Avg {fmt(route.avgTemp)}°C · Max {fmt(route.maxTemp)}°C{route.spread != null && route.spread >= 0.3 ? ` · ±${Number(route.spread).toFixed(1)}°C spread` : ''}
                <br />{mins(route.durationSeconds)} · {miles(route.distanceMeters)} mi
              </Tooltip>
              <Popup>
                <strong>{title}</strong>
                <div>Avg temperature: {fmt(route.avgTemp)}°C</div>
                <div>Max temperature: {fmt(route.maxTemp)}°C</div>
                {Number(route.hoursAboveThreshold) > 0 && <div>{fmt(route.hoursAboveThreshold)} hrs above 35°C{route.pctAbove35 > 0 ? ` · ${route.pctAbove35}% of route` : ''}</div>}
                {route.spread != null && route.spread >= 0.3 && <div>Heat spread ±{Number(route.spread).toFixed(1)}°C</div>}
                <div>{mins(route.durationSeconds)} · {miles(route.distanceMeters)} mi</div>
              </Popup>
            </Polyline>
          );
        })}

        {/* Start / end markers */}
        {origin && (
          <CircleMarker center={[origin.lat, origin.lng]} radius={9} pathOptions={{ color: tiles.stroke, weight: 3, fillColor: '#38d9a9', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -12]} permanent>Start</Tooltip>
            <Popup><strong>Start</strong><div>{origin.label}</div></Popup>
          </CircleMarker>
        )}
        {destination && (
          <CircleMarker center={[destination.lat, destination.lng]} radius={9} pathOptions={{ color: tiles.stroke, weight: 3, fillColor: '#ff6b35', fillOpacity: 1 }}>
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
              <span className="dot" style={{ background: routeColor(route.avgTemp, light) }} />
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
