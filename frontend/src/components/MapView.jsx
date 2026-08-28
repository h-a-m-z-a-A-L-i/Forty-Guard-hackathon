import React, { useMemo } from 'react';
const routeColor = temp => { const ratio = Math.max(0, Math.min(1, (Number(temp) - 20) / 25)); return `rgb(${Math.round(40 + 215 * ratio)},${Math.round(180 - 130 * ratio)},70)`; };
export default function MapView({ routes, coolestRouteId }) {
  const points = useMemo(() => routes?.flatMap(route => route.geometry.coordinates) || [], [routes]);
  if (!points.length) return null;
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1]); const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const project = ([lng, lat]) => `${20 + ((lng - minLng) / (maxLng - minLng || 1)) * 760},${380 - ((lat - minLat) / (maxLat - minLat || 1)) * 340}`;
  const start = project(routes[0].geometry.coordinates[0]).split(','), end = project(routes[0].geometry.coordinates.at(-1)).split(',');
  return <div className="map" role="img" aria-label="Temperature-colored route map"><div className="map-label">MONTANA STATE ROUTES</div><svg viewBox="0 0 800 400" preserveAspectRatio="none"><rect width="800" height="400" fill="#dfe9d5" />{routes.map(route => <polyline key={route.routeId} points={route.geometry.coordinates.map(project).join(' ')} fill="none" stroke={routeColor(route.avgTemp)} strokeWidth={route.routeId === coolestRouteId ? 9 : 5} strokeOpacity={route.routeId === coolestRouteId ? 1 : .6} strokeLinecap="round" strokeLinejoin="round" />)}<circle cx={start[0]} cy={start[1]} r="8" fill="#1d3027" /><circle cx={end[0]} cy={end[1]} r="8" fill="#cf6239" /></svg></div>;
}
