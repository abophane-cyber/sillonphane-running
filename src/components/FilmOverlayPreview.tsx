import { useEffect, useRef, useState } from 'react'
import { drawElevOverlay } from '../lib/drawElevOverlay'
import { drawEventCartouche, drawScaleNorth, drawWeatherCard, type EventCartouche } from '../lib/filmExport'
import { metersPerPixel } from '../lib/hiker3dStaging'
import type { GpxPoint } from '../types'
import type { WeatherInfo } from '../lib/meteo'
import type { RaceClock } from '../lib/raceSplits'

interface Props {
  points: GpxPoint[]
  distances: number[]
  progress: number
  distanceCovered: number
  totalDistance: number
  elevGain: number
  elevLoss: number
  currentEle: number
  clock: RaceClock
  weather: WeatherInfo | null
  cartouche: EventCartouche
  /** Zoom de la carte (échelle) ; null tant qu'il n'est pas connu. */
  mapZoom: number | null
}

/** Largeur de référence des films (px) : les incrustations sont dessinées dans ce repère, puis réduites à la
 * fenêtre d'animation, pour y paraître exactement comme dans le film. */
const FILM_W = 1920

/** Incrustations des films (encart du haut, météo, cartouche d'épreuve) par-dessus la carte de l'aperçu, avec les
 * mêmes fonctions de dessin que le film 2D. */
export function FilmOverlayPreview(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    const s = size.w / FILM_W
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0)
    const vh = size.h / s
    drawElevOverlay(ctx, FILM_W, vh, {
      points: p.points, distances: p.distances, progress: p.progress,
      distanceCovered: p.distanceCovered, totalDistance: p.totalDistance,
      elevGain: p.elevGain, elevLoss: p.elevLoss, currentEle: p.currentEle, trackName: '',
      elapsedS: p.clock.elapsedAtM(p.progress * p.totalDistance), timeLabel: p.clock.label,
    })
    drawWeatherCard(ctx, FILM_W, p.weather, p.progress)
    drawEventCartouche(ctx, FILM_W, vh, p.cartouche, 1)
    // Échelle : mètres par pixel CSS de la carte, ramenés au repère du film (1 px du film = s px CSS).
    if (p.mapZoom != null && p.points.length) drawScaleNorth(ctx, FILM_W, vh, metersPerPixel(p.points[0].lat, p.mapZoom) * s)
  }, [size, p.points, p.distances, p.progress, p.distanceCovered, p.totalDistance, p.elevGain, p.elevLoss, p.currentEle, p.clock, p.weather, p.cartouche, p.mapZoom])

  return <canvas ref={canvasRef} className="film-overlay-preview" style={{ width: size.w, height: size.h }} aria-hidden="true" />
}
