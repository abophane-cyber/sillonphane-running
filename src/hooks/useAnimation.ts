import { useCallback, useEffect, useRef, useState } from 'react'
import type { GpxPoint, AnimationState } from '../types'
import { interpolateTrack, buildDistanceArray } from '../lib/gpx'

// Parcourt le tracé en ~60s à ×1, ~30s à ×2
/** Progression par seconde à la vitesse 1 (la marche dure 60 / speed secondes sans ralenti). */
export const BASE_SPEED = 1 / 60

interface UseAnimationOptions {
  points: GpxPoint[]
  totalDistance: number
  totalElevGain: number
  onProgress?: (state: AnimationState) => void
  /** Facteur de vitesse (≤ 1) selon la progression : ralenti des randonneurs 3D dans les virages (trackPacing.ts). */
  speedFactorRef?: { current: ((progress: number, speed: number) => number) | null }
}

export function useAnimation({ points, totalDistance, totalElevGain, onProgress, speedFactorRef }: UseAnimationOptions) {
  const [state, setState] = useState<AnimationState>({
    playing: false,
    speed: 2,
    progress: 0,
    currentPoint: null,
    distanceCovered: 0,
    elevCovered: 0,
    currentEle: 0,
  })

  const distancesRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)

  // Refs "live" pour accéder aux valeurs fraîches depuis la boucle RAF sans la redémarrer
  const stateRef = useRef(state)
  stateRef.current = state
  // playingRef est mis à jour immédiatement par play()/pause(), AVANT le re-render React
  // Cela évite la race condition où le RAF suivant lit stateRef.current.playing=true
  // alors que pause() vient d'être appelé mais React n'a pas encore re-rendu
  const playingRef = useRef(false)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const pointsRef = useRef(points)
  pointsRef.current = points
  const totalDistanceRef = useRef(totalDistance)
  totalDistanceRef.current = totalDistance
  const totalElevGainRef = useRef(totalElevGain)
  totalElevGainRef.current = totalElevGain

  useEffect(() => {
    distancesRef.current = buildDistanceArray(points)
  }, [points])

  // Boucle RAF stable — ne se réinitialise jamais à cause des deps changeantes
  const tick = useCallback((timestamp: number) => {
    // playingRef est mis à jour IMMÉDIATEMENT par play()/pause(), avant tout re-render
    if (!playingRef.current) return

    if (lastTimeRef.current === null) lastTimeRef.current = timestamp
    const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.1)
    lastTimeRef.current = timestamp

    const s = stateRef.current
    const pts = pointsRef.current
    const totDist = totalDistanceRef.current
    const totElev = totalElevGainRef.current

    const factor = speedFactorRef?.current?.(s.progress, s.speed) ?? 1
    const newProgress = Math.min(1, s.progress + dt * BASE_SPEED * s.speed * factor)
    const currentPoint = interpolateTrack(pts, distancesRef.current, totDist, newProgress)
    const distanceCovered = newProgress * totDist
    const elevCovered = newProgress * totElev

    const stillPlaying = newProgress < 1 && playingRef.current
    const nextState: AnimationState = {
      ...s,
      progress: newProgress,
      currentPoint,
      distanceCovered,
      elevCovered,
      currentEle: currentPoint.ele,
      playing: stillPlaying,
    }

    stateRef.current = nextState
    setState(nextState)
    onProgressRef.current?.(nextState)

    if (stillPlaying) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [])

  useEffect(() => {
    if (state.playing) {
      lastTimeRef.current = null
      rafRef.current = requestAnimationFrame(tick)
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [state.playing, tick])

  const play = useCallback(() => {
    setState(s => {
      // Fin d'animation : repositionner au départ sans lancer
      if (s.progress >= 1) {
        playingRef.current = false
        return {
          ...s,
          playing: false,
          progress: 0,
          currentPoint: pointsRef.current[0] ?? null,
          distanceCovered: 0,
          elevCovered: 0,
          currentEle: pointsRef.current[0]?.ele ?? 0,
        }
      }
      playingRef.current = true
      return { ...s, playing: true }
    })
  }, [])
  const pause = useCallback(() => {
    playingRef.current = false
    setState(s => ({ ...s, playing: false }))
  }, [])
  const reset = useCallback(() => {
    playingRef.current = false
    setState(s => ({
      ...s,
      playing: false,
      progress: 0,
      currentPoint: pointsRef.current[0] ?? null,
      distanceCovered: 0,
      elevCovered: 0,
      currentEle: pointsRef.current[0]?.ele ?? 0,
    }))
  }, [])
  const setSpeed = useCallback((speed: number) => setState(s => ({ ...s, speed })), [])
  const seek = useCallback((progress: number) => {
    setState(s => {
      const currentPoint = interpolateTrack(pointsRef.current, distancesRef.current, totalDistanceRef.current, progress)
      return {
        ...s,
        progress,
        currentPoint,
        distanceCovered: progress * totalDistanceRef.current,
        elevCovered: progress * totalElevGainRef.current,
        currentEle: currentPoint.ele,
      }
    })
  }, [])

  return { state, play, pause, reset, setSpeed, seek }
}
