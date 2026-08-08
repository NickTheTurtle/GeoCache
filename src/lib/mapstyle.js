// Shared MapLibre GL vector style for GeoCache SF.
// Goal: warm parchment land, a SINGLE uniform color for every street,
// clear water, no individual buildings, no house numbers - high contrast
// and legible to match the nautical/treasure-map theme.

const LAND = '#efe6cf'; // warm parchment
const WATER = '#9fc0cf'; // muted nautical blue
const PARK = '#bcd79a'; // greener parks
const ROAD = '#fdfaf2'; // creamy white - ONE uniform color for all streets
const ROAD_EDGE = '#c9b487'; // soft tan casing that defines the streets
const LABEL = '#4a3d27'; // brown ink
const LABEL_HALO = '#f7f1e3';

export function buildMapStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': LAND } },

      { id: 'landcover-green', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['in', 'class', 'wood', 'grass'],
        paint: { 'fill-color': PARK, 'fill-opacity': 0.9 } },

      { id: 'landuse-green', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        filter: ['in', 'class', 'park', 'recreation_ground', 'golf_course', 'cemetery', 'grass'],
        paint: { 'fill-color': PARK, 'fill-opacity': 0.85 } },

      { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
        paint: { 'fill-color': PARK, 'fill-opacity': 0.9 } },

      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
        paint: { 'fill-color': WATER } },

      /* Tan casing defines every street with a soft edge */
      { id: 'road-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['!in', 'class', 'ferry', 'rail', 'path', 'track'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROAD_EDGE,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.6, 14, 5.5, 17, 12],
        } },

      /* Every street the SAME creamy color; width varies only for readability */
      { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['!in', 'class', 'ferry', 'rail', 'path', 'track'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROAD,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 14, 3, 17, 8],
        } },

      { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
        filter: ['<=', 'admin_level', 4],
        paint: { 'line-color': '#b0863c', 'line-dasharray': [2, 2], 'line-width': 1 } },

      /* Major road labels only - no house numbers */
      { id: 'road-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: { 'text-color': LABEL, 'text-halo-color': LABEL_HALO, 'text-halo-width': 1.4 } },

      /* Neighborhood / place labels */
      { id: 'place-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['in', 'class', 'suburb', 'neighbourhood', 'quarter'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 15, 14],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: { 'text-color': LABEL, 'text-halo-color': LABEL_HALO, 'text-halo-width': 1.6 } },
    ],
  };
}
