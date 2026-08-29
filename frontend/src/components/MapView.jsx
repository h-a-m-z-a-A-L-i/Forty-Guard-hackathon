import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Same temperature→color ramp used previously, exported for the legend.
export const routeColor = temp => {
  if (temp == null || !Number.isFinite(Number(temp))) return '#9aa4a0';
  const ratio = Math.max(0, Math.min(1, (Number(temp) - 20) / 25));
  return `rgb(${Math.round(40 + 215 * ratio)},${Math.round(180 - 130 * ratio)},70)`;
};

const fmt = n => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(1);
const mins = s => Number.isFinite(Number(s)) ? `${Math.round(s / 60)} min` : '—';
const miles = m => fmt(Number(m) / 1609.34);

export default function MapView({ routes = [], coolestRouteId, origin, destination }) {
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

  return (
    <div className="map">
      <div className="map-label">
        {origin?.label || 'Start'} → {destination?.label || 'End'}
      </div>
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [40, 40] }}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Routes colored by average temperature */}
        {latlngs.map(({ route, points }) => {
          const cool = route.routeId === coolestRouteId;
          return (
            <Polyline
              key={route.routeId}
              positions={points}
              pathOptions={{
                color: routeColor(route.avgTemp),
                weight: cool ? 8 : 4,
                opacity: cool ? 1 : 0.65,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            >
              <Tooltip sticky>
                <strong>{cool ? '🌿 Coolest route' : `Route ${route.routeId + 1}`}</strong>
                <br />Avg {fmt(route.avgTemp)}°C · Max {fmt(route.maxTemp)}°C
                <br />{mins(route.durationSeconds)} · {miles(route.distanceMeters)} mi
              </Tooltip>
              <Popup>
                <strong>{cool ? '🌿 Coolest route' : `Route ${route.routeId + 1}`}</strong>
                <div>Avg temperature: {fmt(route.avgTemp)}°C</div>
                <div>Max temperature: {fmt(route.maxTemp)}°C</div>
                <div>{route.hoursAboveThreshold == null ? '⚠ Unavailable' : `${fmt(route.hoursAboveThreshold)} hrs above 35°C`}</div>
                <div>{mins(route.durationSeconds)} · {miles(route.distanceMeters)} mi</div>
              </Popup>
            </Polyline>
          );
        })}

        {/* Start / end markers */}
        {origin && (
          <CircleMarker center={[origin.lat, origin.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d3027', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -10]} permanent>Start</Tooltip>
          </CircleMarker>
        )}
        {destination && (
          <CircleMarker center={[destination.lat, destination.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#cf6239', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -10]} permanent>End</Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      {/* Temperature legend */}
      <div className="legend">
        <span className="legend-title">Avg temp</span>
        <div className="legend-bar" />
        <div className="legend-scale"><span>20°C</span><span>45°C</span></div>
      </div>
    </div>
  );
}
