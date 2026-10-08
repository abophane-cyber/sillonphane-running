import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { GpxPoint } from '../types'
import { IGN_TILE_URL } from '../lib/tileSources'

interface Props {
  points: GpxPoint[]
  startLabel?: string
  endLabel?: string
  onIdle?: () => void
}

export function AlbumMap({ points, onIdle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const onIdleRef = useRef(onIdle)
  useEffect(() => { onIdleRef.current = onIdle })

  useEffect(() => {
    if (!containerRef.current || points.length < 2) { onIdleRef.current?.(); return }

    const lons = points.map(p => p.lon)
    const lats = points.map(p => p.lat)
    const minLon = Math.min(...lons), maxLon = Math.max(...lons)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const padLon = (maxLon - minLon) * 0.12
    const padLat = (maxLat - minLat) * 0.12
    const trackBounds: [number, number, number, number] = [
      minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat,
    ]
    const FIT_PADDING = 20

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          ign: { type: 'raster', tiles: [IGN_TILE_URL], tileSize: 256, attribution: '© IGN', maxzoom: 18 },
        },
        layers: [
          // Contraste renforcé : cohérent avec TrackMap.tsx, pour que le tracé ressorte mieux sur le fond IGN.
          { id: 'bg', type: 'raster', source: 'ign', paint: { 'raster-fade-duration': 0, 'raster-contrast': 0.48, 'raster-saturation': 0.21, 'raster-brightness-max': 0.58, 'raster-hue-rotate': 17 } },
        ],
      },
      bounds: trackBounds,
      fitBoundsOptions: { padding: FIT_PADDING },
      interactive: false,
      attributionControl: false,
      // Sans ça, le tampon de rendu WebGL peut être effacé avant que Chrome ne capture le
      // contenu de la page pour l'impression/export PDF — la carte apparaît alors vide dans le
      // PDF alors qu'elle s'affiche normalement à l'écran.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })

    mapRef.current = map

    // Recadre sur l'emprise complète du tracé. Indispensable après un map.resize() : `resize`
    // ajuste la taille du canvas mais garde le zoom calculé pour l'ancienne taille du conteneur,
    // ce qui peut laisser une partie du tracé hors champ (conteneur pas encore à sa taille finale
    // à l'initialisation, page réduite dans l'éditeur, mise en page d'impression…).
    const fitTrack = () => map.fitBounds(trackBounds, { padding: FIT_PADDING, animate: false })

    // Filet de sécurité pour l'impression : le conteneur peut ne pas avoir sa taille finale au
    // moment où MapLibre s'initialise (mise en page d'impression appliquée après coup par
    // Chrome), ce qui fige le canvas WebGL à une taille erronée — carte vide ou tronquée dans le
    // PDF. Le ResizeObserver recale la carte dès que ses dimensions réelles se stabilisent.
    const resizeObserver = new ResizeObserver(() => { map.resize(); fitTrack() })
    resizeObserver.observe(containerRef.current)

    map.on('load', () => {
      const coords = points.map(p => [p.lon, p.lat] as [number, number])
      const start = coords[0]
      const end = coords[coords.length - 1]

      // Tracé avec dégradé natif MapLibre (lineMetrics requis)
      map.addSource('track', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
      })
      // Tracé rouge carmin
      map.addLayer({ id: 'track-shadow', type: 'line', source: 'track',
        paint: { 'line-color': '#fff', 'line-width': 5, 'line-opacity': 0.55 } })
      map.addLayer({ id: 'track-line', type: 'line', source: 'track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#DC2626', 'line-width': 2.5 },
      })

      // Marqueurs circulaires A / B
      addCircleMarker(map, start, 'A')
      addCircleMarker(map, end, 'B')

      // Recadrage une fois le style chargé : le conteneur a désormais sa taille réelle.
      fitTrack()

      // 'idle' : tuiles + tracé effectivement peints, pas seulement le style chargé — c'est le
      // signal utilisé avant impression pour ne pas capturer une carte encore vide.
      map.once('idle', () => onIdleRef.current?.())
    })

    return () => { resizeObserver.disconnect(); map.remove(); mapRef.current = null }
  }, [points])

  if (points.length < 2) return <div className="asp2-map-placeholder">Tracé indisponible</div>

  // Mention « © IGN » (Plan IGN, licence Etalab 2.0) en élément DOM superposé à la carte, et non
  // dessinée dans le canvas WebGL : le PDF des pages intérieures est rasterisé par html2canvas
  // (clientPdfExport.ts), qui capture le DOM — la mention part donc dans le PDF comme les pastilles
  // A/B (marqueurs DOM eux aussi), et reste visible à l'écran.
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        aria-label="Source du fond de carte : IGN"
        style={{
          position: 'absolute', right: 3, bottom: 2, zIndex: 2, pointerEvents: 'none',
          padding: '0 4px', borderRadius: 2, background: 'rgba(255,255,255,0.7)',
          color: 'rgba(0,0,0,0.65)', font: '8px/1.4 Arial, sans-serif',
        }}
      >© IGN</div>
    </div>
  )
}

function addCircleMarker(map: maplibregl.Map, coord: [number, number], letter: 'A' | 'B') {
  const isB = letter === 'B'
  const el = document.createElement('div')
  el.style.cssText = `
    width: 22px; height: 22px; border-radius: 50%;
    background: ${isB ? '#DC2626' : '#fff'};
    border: 2px solid ${isB ? '#fff' : '#1a1a1a'};
    box-shadow: 0 1px 5px rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px; font-weight: 800;
    color: ${isB ? '#fff' : '#1a1a1a'};
    cursor: default;
  `
  el.textContent = letter
  new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(coord)
    .addTo(map)
}
