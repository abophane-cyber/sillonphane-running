import { useState } from 'react'
import type { GpxTrack } from '../types'

export type ActivityMode = 'randonneur'

export const ANIM_SETTINGS = {
  randonneur: {
    // Running : 2,6 s par km (le nom des rues, en haut de l'écran, a le temps d'être lu), plafond 120 s — un semi
    // ≈ 55 s, un marathon ≈ 110 s (plan : 100 à 120 s).
    1: { secondsPerKm: 2.6, min: 10, max: 120, minSpeedMps: 200 },
    // Vitesse de déplacement ×2,5 réelle (bouton toujours étiqueté "×2") : mêmes bornes que le
    // niveau 1, divisées par 2,5. La cadence des pas des randonneurs 3D suit la vitesse au sol
    // (cf. hiker3dSprite.setGroundSpeed).
    2: { secondsPerKm: 2.6 / 2.5, min: 10 / 2.5, max: 120 / 2.5, minSpeedMps: 200 * 2.5 },
  },
}

// Running : caméra de course plus proche (14,5 ; 13,5 pour un niveau ×2, plus utilisé).
export const ZOOMS: [number, number] = [14.5, 13.5]

/** Durée de marche (s) pour un tracé de distKm, bornée [min, max]. Sur un tracé court, le plancher
 * `min` ferait tomber la vitesse apparente (distance / durée) très bas — le randonneur semble
 * marcher au ralenti. On resserre alors ce plancher pour ne jamais descendre sous minSpeedMps,
 * quitte à raccourcir la marche en dessous de `min`. */
export function animDurationS(level: 1 | 2, distKm: number): number {
  const s = ANIM_SETTINGS.randonneur[level]
  const rawS = distKm * s.secondsPerKm
  const speedFloorS = (distKm * 1000) / s.minSpeedMps
  const effectiveMin = Math.min(s.min, speedFloorS)
  return Math.min(s.max, Math.max(effectiveMin, rawS))
}

export function animSpeed(_mode: ActivityMode, level: 1 | 2, distKm: number): number {
  return 60 / animDurationS(level, distKm)  // BASE_SPEED=1/60 → durée totale = 60/speed secondes
}

/** Mode d'activité, vitesse de lecture, lookahead des localités, et zoom cible associé. */
export function useAnimationSettings(activeTrack: GpxTrack | null, setSpeed: (speed: number) => void) {
  const [activityMode, setActivityMode] = useState<ActivityMode>('randonneur')
  const [speedLevel, setSpeedLevel] = useState<1 | 2>(1)
  const [lookaheadBySpeed, setLookaheadBySpeed] = useState<Record<1 | 2, number>>({ 1: 3000, 2: 6000 })
  const [targetZoom, setTargetZoom] = useState<number | null>(null)
  const [zoomResetSeq, setZoomResetSeq] = useState(0)

  const lookahead = lookaheadBySpeed[speedLevel]
  const setLookahead = (v: number) => setLookaheadBySpeed(prev => ({ ...prev, [speedLevel]: v }))

  function handleModeChange(mode: ActivityMode, level: 1 | 2 = 1) {
    const distKm = (activeTrack?.distance ?? 0) / 1000
    setActivityMode(mode)
    setSpeedLevel(level)
    setTargetZoom(ZOOMS[level - 1])
    setZoomResetSeq(s => s + 1)
    setSpeed(animSpeed(mode, level, distKm))
  }

  function handleSpeedLevel(level: 1 | 2) {
    const distKm = (activeTrack?.distance ?? 0) / 1000
    setSpeedLevel(level)
    setTargetZoom(ZOOMS[level - 1])
    setZoomResetSeq(s => s + 1)
    setSpeed(animSpeed(activityMode, level, distKm))
  }

  return {
    activityMode, speedLevel,
    lookahead, setLookahead,
    targetZoom, setTargetZoom,
    zoomResetSeq, setZoomResetSeq,
    handleModeChange, handleSpeedLevel,
  }
}
