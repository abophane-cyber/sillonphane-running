import { useEffect } from 'react'
import type { GpxPoint, GpxTrack } from '../types'

/**
 * Préchauffe en tâche de fond le cache réseau du film 3D (tuiles ortho + MNT + hydro du tracé,
 * 1 000 à 2 300 requêtes IGN) — UNIQUEMENT une fois l'intention de faire un film exprimée (`enabled`,
 * cf. App.tsx : lecture de l'aperçu, ou clic sur « Film 3D » alors que le tracé reste à enregistrer),
 * pour ne pas solliciter la Géoplateforme pour qui ne fait qu'ouvrir l'animation. L'export lancé ensuite coupe ce préchargement et réutilise ce qui est déjà en
 * cache (cancel3dPrefetch, prefetch3d.ts). Best-effort : toute erreur est ignorée. Le module (et
 * donc Three.js via terrainSources) est chargé en import dynamique -> reste hors du bundle principal.
 */
export function useFilm3dPrefetch(activeTrack: GpxTrack | null, points: GpxPoint[], enabled: boolean) {
  useEffect(() => {
    if (!enabled || !activeTrack || points.length < 2) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        const { prefetch3dTerrain } = await import('../lib/terrain3d/prefetch3d')
        if (ctrl.signal.aborted) return
        await prefetch3dTerrain(points.map(p => [p.lon, p.lat] as [number, number]), ctrl.signal)
      } catch { /* best-effort */ }
    })()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, enabled])
}
