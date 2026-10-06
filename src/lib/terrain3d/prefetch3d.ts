// Préchauffage du cache réseau pour le film 3D : dès que l'utilisateur manifeste l'intention d'en
// faire un (clic sur « Film 3D » encore bloqué par l'aperçu à terminer ou le tracé à enregistrer,
// cf. useFilm3dPrefetch.ts), on télécharge en tâche de fond les tuiles ortho IGN + le MNT RGE ALTI
// + l'hydrographie du tracé. Quand l'export démarre ensuite, la phase « préparation du terrain » de
// exportFilm3d retrouve tout en cache (Service Worker ign-tiles-v2 en prod, cache HTTP en dev).
//
// On appelle les MÊMES fonctions que exportFilm3d (URLs et mode de requête identiques -> clés
// de cache compatibles) ; les résultats (canvas, grille) sont simplement jetés.

import { computeCoverage, fetchOrthoTiles, fetchElevationTiles, fetchHydroFeatures } from './terrainSources'

let inFlight: { key: string; promise: Promise<void>; ctrl: AbortController } | null = null

function trailKey(trail: [number, number][]): string {
  const a = trail[0], b = trail[trail.length - 1]
  return `${trail.length}|${a[0].toFixed(4)},${a[1].toFixed(4)}|${b[0].toFixed(4)},${b[1].toFixed(4)}`
}

/**
 * Précharge (best-effort) les données terrain du film 3D pour ce tracé. Concurrence réduite
 * (2 / 2) pour ne pas concurrencer les tuiles de l'aperçu carte. Idempotent : un appel avec le
 * même tracé qu'un préchargement déjà en cours renvoie la même promesse.
 */
export function prefetch3dTerrain(trail: [number, number][], signal?: AbortSignal): Promise<void> {
  if (trail.length < 2) return Promise.resolve()
  const key = trailKey(trail)
  if (inFlight && inFlight.key === key) return inFlight.promise

  let cov
  try {
    cov = computeCoverage(trail)
  } catch {
    return Promise.resolve()
  }

  // Contrôleur propre, relié au signal de l'appelant : permet aussi à l'export de couper ce
  // préchargement (cancel3dPrefetch) sans dépendre du composant qui l'a lancé.
  const ctrl = new AbortController()
  if (signal?.aborted) ctrl.abort()
  else signal?.addEventListener('abort', () => ctrl.abort(), { once: true })

  const promise = Promise.allSettled([
    fetchOrthoTiles(cov.txMin, cov.tyMin, cov.nx, cov.ny, cov.ZOOM_ORTHO, ctrl.signal, 2),
    fetchElevationTiles(cov.ecolMin, cov.erowMin, cov.enx, cov.eny, cov.ZOOM_ELEV, ctrl.signal, 2),
    fetchHydroFeatures(cov.covLonMin, cov.covLonMax, cov.covLatMin, cov.covLatMax, ctrl.signal),
  ]).then(() => { /* résultats jetés : seul le remplissage du cache réseau compte */ })

  inFlight = { key, promise, ctrl }
  void promise.finally(() => { if (inFlight?.key === key) inFlight = null })
  return promise
}

/**
 * Coupe le préchargement en cours, appelé au lancement de l'export 3D : celui-ci redemande les
 * MÊMES URLs (à pleine concurrence) — laisser tourner le préchargement doublerait en parallèle
 * toutes les requêtes pas encore servies. Ce qui est déjà téléchargé reste en cache et sert à
 * l'export ; seules les requêtes encore en vol sont abandonnées (l'export les refait une fois).
 */
export function cancel3dPrefetch(): void {
  inFlight?.ctrl.abort()
  inFlight = null
}
