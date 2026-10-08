import { useEffect } from 'react'
import type { GpxPoint, GpxTrack } from '../types'
import { prefetchFilm2dTiles } from '../lib/filmExport'

// Délai avant de lancer le préchargement : laisse d'abord la carte de l'aperçu (et son propre préchargement, cf.
// TrackMap.tsx) prendre la bande passante.
const START_DELAY_MS = 5000

/**
 * Pendant de useFilm3dPrefetch.ts pour le film 2D : tant que la page animation est ouverte (`enabled`, cf.
 * App.tsx), précharge en tâche de fond les tuiles du fond de carte propres au film (cadre 1920×1080, dézoom final,
 * plans serrés des coureurs — prefetchFilm2dTiles), en plus de celles que la carte de l'aperçu charge déjà. Peu de
 * requêtes (quelques centaines au plus), d'où un lancement dès l'ouverture, contrairement au terrain 3D. La phase de
 * préchargement du film 2D retrouve ensuite tout en cache. Relancé si le zoom de lecture (vitesse) ou la présence de
 * personnages change (plans serrés des coureurs). Best-effort : toute erreur est ignorée.
 */
export function useFilm2dPrefetch(
  activeTrack: GpxTrack | null, points: GpxPoint[], zoom: number, withCharacters: boolean, enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !activeTrack || points.length < 2) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      prefetchFilm2dTiles(points, zoom, withCharacters, ctrl.signal).catch(() => { /* best-effort */ })
    }, START_DELAY_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, enabled, zoom, withCharacters])
}
