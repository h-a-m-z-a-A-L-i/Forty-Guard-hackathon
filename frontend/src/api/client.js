import axios from 'axios';
const API = import.meta.env.VITE_BACKEND_URL || (window.location.port === '5173' ? 'http://localhost:4000' : '');
export const compareRoutes = (origin, destination, atTime, signal) => axios.post(`${API}/api/compare-routes`, { origin, destination, atTime }, { signal, timeout: 120000 }).then(r => r.data);
export async function geocode(query, signal) { const r = await axios.get('https://nominatim.openstreetmap.org/search', { params: { q: `${query}, Montana`, format: 'json', countrycodes: 'us', limit: 1 }, headers: { Accept: 'application/json' }, signal, timeout: 15000 }); if (!r.data.length) throw new Error(`No US location found for “${query}”`); return { lat: Number(r.data[0].lat), lng: Number(r.data[0].lon), label: r.data[0].display_name }; }
