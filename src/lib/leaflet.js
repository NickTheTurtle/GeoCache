import { buildMapStyle } from './mapstyle.js';

// Center of San Francisco, shared by every map view.
export const SF_CENTER = [37.7749, -122.4194];

// Basemap attribution. Only the OpenStreetMap credit is legally required (ODbL);
// the OpenFreeMap credit is optional.
export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Attach the MapLibre GL vector basemap to a Leaflet map. Pass attribution=null
// for embedded maps (e.g. modal) that hide the attribution control.
export function addBaseLayer(L, map, attribution = MAP_ATTRIBUTION) {
  return L.maplibreGL({ style: buildMapStyle(), ...(attribution ? { attribution } : {}) }).addTo(map);
}

// Client-only loader: returns the Leaflet namespace with the MapLibre GL plugin
// (L.maplibreGL) attached. The plugin is UMD and reads window.L / window.maplibregl,
// so we set those before importing it. Call only in the browser (onMount).
let cached = null;

export async function loadLeaflet() {
  if (cached) return cached;
  const L = (await import('leaflet')).default;
  const maplibregl = (await import('maplibre-gl')).default;
  window.L = L;
  window.maplibregl = maplibregl;
  await import('@maplibre/maplibre-gl-leaflet');
  cached = L;
  return L;
}
