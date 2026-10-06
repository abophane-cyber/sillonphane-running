import { useRef, useState } from 'react'
import type { AnimationState } from '../types'

/**
 * Décompte avant lecture + attente que la carte soit "idle" (tuiles chargées) avant de
 * démarrer réellement — enveloppe play/pause/reset de useAnimation avec cette logique.
 */
export function usePlaybackCountdown(
  state: AnimationState,
  play: () => void,
  pause: () => void,
  reset: () => void,
  speedLevel: 1 | 2,
  ZOOMS: [number, number],
  setTargetZoom: (zoom: number | null) => void,
  bumpZoomResetSeq: () => void,
  bumpZoomToStart: () => void,
  setHasPlayedPreview: (v: boolean) => void,
  onReset: () => void,
  /** Pause (ms) entre la fin du décompte et le début de la marche (dézoom du randonneur 3D) ; lue à chaque départ. */
  startDelayMsRef?: { current: number },
) {
  const [countdown, setCountdown] = useState<number | null>(null)
  const [waitingMap, setWaitingMap] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapIdleRef = useRef(false)
  const pendingPlayRef = useRef(false)
  const waitingMapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startCountdown(onDone: () => void, seconds = 3) {
    if (countdownRef.current) clearTimeout(countdownRef.current)
    setCountdown(seconds)
    const tick = (n: number) => {
      if (n <= 0) {
        setCountdown(null)
        const delay = startDelayMsRef?.current ?? 0
        if (delay > 0) {
          // Dézoom avant la marche : on attend sa fin (ce minuteur est annulé par une pause, comme le décompte).
          countdownRef.current = setTimeout(() => { countdownRef.current = null; launch() }, delay)
          return
        }
        launch()
        return
      }
      setCountdown(n)
      countdownRef.current = setTimeout(() => tick(n - 1), 1000)
    }
    const launch = () => {
      // Attendre que la carte soit idle avant de lancer
      if (mapIdleRef.current) {
        onDone()
      } else {
        pendingPlayRef.current = true
        setWaitingMap(true)
        // Filet de sécurité : si la carte ne devient jamais "idle" (tuiles lentes,
        // requête bloquée...), on démarre quand même après un délai plutôt que de
        // rester bloqué indéfiniment (randonneur qui ne s'affiche jamais).
        if (waitingMapTimeoutRef.current) clearTimeout(waitingMapTimeoutRef.current)
        waitingMapTimeoutRef.current = setTimeout(() => {
          if (pendingPlayRef.current) {
            pendingPlayRef.current = false
            setWaitingMap(false)
            onDone()
          }
        }, 5000)
      }
    }
    countdownRef.current = setTimeout(() => tick(seconds - 1), 1000)
  }

  function handleMapIdle() {
    mapIdleRef.current = true
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false
      setWaitingMap(false)
      if (waitingMapTimeoutRef.current) { clearTimeout(waitingMapTimeoutRef.current); waitingMapTimeoutRef.current = null }
      play()
    }
  }

  function handlePlay() {
    setHasPlayedPreview(true)
    mapIdleRef.current = false
    setTargetZoom(ZOOMS[speedLevel - 1])
    bumpZoomResetSeq()
    // En fin d'animation : reset + retour au départ avant de relancer
    if (state.progress >= 1) {
      reset()
      bumpZoomToStart()
      startCountdown(() => play())
      return
    }
    const needsCountdown = state.progress < 0.01
    if (needsCountdown) {
      startCountdown(() => play())
    } else {
      play()
    }
  }

  function handlePause() {
    if (countdownRef.current) { clearTimeout(countdownRef.current); countdownRef.current = null }
    if (waitingMapTimeoutRef.current) { clearTimeout(waitingMapTimeoutRef.current); waitingMapTimeoutRef.current = null }
    setCountdown(null)
    setWaitingMap(false)
    pendingPlayRef.current = false
    pause()
  }

  function handleReset() {
    reset()
    onReset()
  }

  function handleRestart() {
    reset()
    bumpZoomToStart()
  }

  return {
    countdown, waitingMap, mapIdleRef,
    handleMapIdle, handlePlay, handlePause, handleReset, handleRestart,
  }
}
