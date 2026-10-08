import maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { ensureVegetationProtocol, VEG_PROTOCOL } from './vegetation'
import { BASEMAP_ADJUST, BASEMAP_BACKGROUND, BASEMAP_TILE_URL } from './tileSources'
import { RIBBON_HEAD_COLOR, RIBBON_HEAD_FADE, RIBBON_OUTLINE } from './ribbon'

// Style MapLibre commun à la carte de l'aperçu (TrackMap.tsx) et au film 2D (filmExport.ts).

export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function makeStyle(): maplibregl.StyleSpecification {
  ensureVegetationProtocol(maplibregl) // végétation recoloriée au chargement des tuiles (vegetation.ts)
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'tiles-ign':  { type: 'raster', tiles: [BASEMAP_TILE_URL.replace('https://', `${VEG_PROTOCOL}://`)], tileSize: 256, maxzoom: 19, attribution: '© IGN' },
      'track-full': { type: 'geojson', data: EMPTY_FC },
      // lineMetrics: nécessaire pour line-gradient (dégradé le long du tracé parcouru)
      'track-done': { type: 'geojson', data: EMPTY_FC, lineMetrics: true },
      // Tête du ruban (derniers mètres parcourus), redessinée par-dessus : sur une boucle, le ruban repasse sur
      // lui-même et sa tête disparaissait sous un passage antérieur.
      'track-head': { type: 'geojson', data: EMPTY_FC, lineMetrics: true },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': BASEMAP_BACKGROUND } },
      // Vues aériennes assombries (BASEMAP_ADJUST, reproduit sur la mosaïque du film dans filmMapMosaic.ts).
      { id: 'bg-ign', type: 'raster', source: 'tiles-ign', paint: {
        'raster-fade-duration': 0, 'raster-contrast': BASEMAP_ADJUST.contrast, 'raster-saturation': BASEMAP_ADJUST.saturation,
        'raster-brightness-max': BASEMAP_ADJUST.brightnessMax, 'raster-hue-rotate': BASEMAP_ADJUST.hueRotate,
      } },
      {
        id: 'track-full-line', type: 'line', source: 'track-full',
        paint: { 'line-color': '#ffffff', 'line-width': 3.5, 'line-opacity': 0.7, 'line-dasharray': [3, 3] }, // clair sur les vues aériennes assombries
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        // Liseré de contour très léger sous le ruban.
        id: 'track-done-halo', type: 'line', source: 'track-done',
        paint: { 'line-color': RIBBON_OUTLINE, 'line-width': 7.5 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'track-done-line', type: 'line', source: 'track-done',
        // Crème au coureur, puis orange et vert derrière lui (ribbonGradient, recalculé à chaque avancée).
        paint: {
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, RIBBON_HEAD_COLOR, 1, RIBBON_HEAD_COLOR],
          'line-width': 5.5, 'line-opacity': 0.97,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        // Liseré et tête apparaissent en fondu depuis leur début : un bout arrondi net y dessinait un petit trait
        // sombre en travers du ruban, qui avançait avec lui.
        id: 'track-head-halo', type: 'line', source: 'track-head',
        paint: {
          'line-width': 7.5,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(20,30,20,0)', 0.35, RIBBON_OUTLINE],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'track-head-line', type: 'line', source: 'track-head',
        paint: {
          'line-width': 5.5,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, RIBBON_HEAD_FADE, 0.35, RIBBON_HEAD_COLOR],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
    ],
  }
}
