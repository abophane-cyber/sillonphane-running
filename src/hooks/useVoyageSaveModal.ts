import { useEffect, useRef, useState } from 'react'
import type { GpxTrack } from '../types'

interface AnimStateSlice {
  playing: boolean
  progress: number
}

/**
 * Popup "Enregistrer dans un sillon" — état + ouverture automatique en fin d'animation
 * (dézoom via onAnimationEnd, puis affichage de la popup si un tracé est actif).
 */
export function useVoyageSaveModal(
  state: AnimStateSlice,
  activeTrack: GpxTrack | null,
  onAnimationEnd: () => void,
  /** Délai (ms) avant d'ouvrir la popup après la fin de la marche : les randonneurs 3D jouent encore leur
   * séquence d'arrivée et la vue d'ensemble finale (cf. TrackMap.tsx) ; 0 avec les GIF. */
  endDelayMsRef?: { current: number },
) {
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [activeSillonId, setActiveSillonId] = useState<string | null>(null)
  const prevPlayingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracé déjà rangé dans un sillon (enregistré ou ouvert depuis « Mes sillons ») : inutile de reproposer la popup.
  const alreadySavedRef = useRef(false)
  useEffect(() => { alreadySavedRef.current = activeSillonId !== null }, [activeSillonId])

  useEffect(() => {
    if (!state.playing && prevPlayingRef.current && state.progress >= 1) {
      onAnimationEnd()
      if (activeTrack && activeSillonId === null) {
        const delay = endDelayMsRef?.current ?? 0
        if (timerRef.current) clearTimeout(timerRef.current)
        if (delay > 0) timerRef.current = setTimeout(() => { timerRef.current = null; if (!alreadySavedRef.current) setShowSaveModal(true) }, delay)
        else setShowSaveModal(true)
      }
    }
    // Nouvelle lecture avant l'échéance : la popup ne doit plus s'ouvrir.
    if ((state.playing || state.progress < 1) && timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    prevPlayingRef.current = state.playing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playing, state.progress, activeTrack])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return { showSaveModal, setShowSaveModal, activeSillonId, setActiveSillonId }
}
