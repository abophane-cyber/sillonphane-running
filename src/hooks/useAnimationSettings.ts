import { useState } from 'react'
import type { GpxTrack } from '../types'

export type ActivityMode = 'randonneur'

// Une seule vitesse d'animation (l'ancien choix ×1 / ×2 a été retiré).
// Running : 2,6 s par km (le nom des rues, en haut de l'écran, a le temps d'être lu), plafond 120 s — un semi
// ≈ 55 s, un marathon ≈ 110 s (plan : 100 à 120 s).
export const ANIM_SETTINGS = {
  randonneur: { secondsPerKm: 2.6, min: 10, max: 120, minSpeedMps: 200 },
}

/** Zoom de la carte pendant la course (aperçu et film 2D) : caméra de course proche (14,2 : un peu plus haute
 *  qu'à 14,5, environ 1,25 fois plus de surface visible). */
export const ANIM_ZOOM = 14.2

/** Durée de marche (s) pour un tracé de distKm, bornée [min, max]. Sur un tracé court, le plancher
 * `min` ferait tomber la vitesse apparente (distance / durée) très bas — le randonneur semble
 * marcher au ralenti. On resserre alors ce plancher pour ne jamais descendre sous minSpeedMps,
 * quitte à raccourcir la marche en dessous de `min`. */
export function animDurationS(distKm: number): number {
  const s = ANIM_SETTINGS.randonneur
  const rawS = distKm * s.secondsPerKm
  const speedFloorS = (distKm * 1000) / s.minSpeedMps
  const effectiveMin = Math.min(s.min, speedFloorS)
  return Math.min(s.max, Math.max(effectiveMin, rawS))
}

export function animSpeed(_mode: ActivityMode, distKm: number): number {
  return 60 / animDurationS(distKm)  // BASE_SPEED=1/60 → durée totale = 60/speed secondes
}

/** Mode d'activité, lookahead des localités, et zoom cible associé. */
export function useAnimationSettings(activeTrack: GpxTrack | null, setSpeed: (speed: number) => void) {
  const [activityMode, setActivityMode] = useState<ActivityMode>('randonneur')
  const [lookahead, setLookahead] = useState(3000)
  const [targetZoom, setTargetZoom] = useState<number | null>(null)
  const [zoomResetSeq, setZoomResetSeq] = useState(0)

  function handleModeChange(mode: ActivityMode) {
    const distKm = (activeTrack?.distance ?? 0) / 1000
    setActivityMode(mode)
    setTargetZoom(ANIM_ZOOM)
    setZoomResetSeq(s => s + 1)
    setSpeed(animSpeed(mode, distKm))
  }

  return {
    activityMode,
    lookahead, setLookahead,
    targetZoom, setTargetZoom,
    zoomResetSeq, setZoomResetSeq,
    handleModeChange,
  }
}
