import type { GpxPoint } from '../types'
import { BASEMAP_TILE_URL } from './tileSources'

export function lonLatToTileXY(lon: number, lat: number, zoom: number) {
  const latRad = lat * Math.PI / 180
  const n = 2 ** zoom
  const x = Math.floor((lon + 180) / 360 * n)
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) }
}

function tileUrl(z: number, x: number, y: number) {
  return BASEMAP_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** Construit l'ensemble dédupliqué des URLs de tuiles couvrant le tracé, pour les niveaux de
 * zoom susceptibles d'être utilisés pendant la lecture, avec une marge de `radius` tuiles autour
 * de chaque point échantillonné pour couvrir le déplacement du marqueur et un léger recadrage.
 * `radius` par défaut (1, soit un voisinage 3×3) convient à l'aperçu dans l'app, dont le cadre de
 * carte fait au plus quelques centaines de pixels de large ; l'export vidéo (canvas fixe jusqu'à
 * 1920px) a besoin d'un voisinage bien plus large pour ne pas laisser les bords du cadre non
 * couverts (voir l'appel depuis filmExport.ts). */
export function buildRouteTileUrls(
  points: GpxPoint[], zoomLevels: number[], radius = 1,
): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  // Échantillonne le tracé pour limiter le nombre de tuiles calculées sur les longs parcours
  const step = Math.max(1, Math.floor(points.length / 400))
  for (let i = 0; i < points.length; i += step) {
    const p = points[i]
    for (const zoom of zoomLevels) {
      const { x, y } = lonLatToTileXY(p.lon, p.lat, zoom)
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const key = `${zoom}/${x + dx}/${y + dy}`
          if (seen.has(key)) continue
          seen.add(key)
          urls.push(tileUrl(zoom, x + dx, y + dy))
        }
      }
    }
  }
  return urls
}

/** Construit l'ensemble des URLs de tuiles couvrant tout le rectangle englobant du tracé (et pas
 * seulement ses abords), pour les niveaux de zoom "vue d'ensemble". Un tracé sinueux ou étroit
 * peut laisser de larges zones du rectangle assez loin du chemin lui-même — un simple survol des
 * points du tracé les manquerait alors que fitBounds() les affiche bel et bien à l'écran.
 * fitBounds() cale la bbox du tracé dans le viewport en respectant son ratio d'aspect : si l'écran
 * est bien plus large (ou haut) que le tracé n'est long (ou large), la dimension manquante est
 * comblée en élargissant la vue très au-delà de la bbox exacte — pas juste de quelques tuiles.
 * On calcule donc la marge exacte nécessaire à partir du ratio d'aspect réel du viewport, plutôt
 * qu'un pourcentage fixe qui ne suffit pas pour un tracé très étroit sur un écran très large. */
export function buildBoundingBoxTileUrls(
  points: GpxPoint[], zoomLevels: number[], viewportAspect = 1.6,
): string[] {
  const seen = new Set<string>()
  const urls: string[] = []

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }

  const midLat = (minLat + maxLat) / 2
  const kmPerLonDeg = 111.32 * Math.cos(midLat * Math.PI / 180)
  const kmPerLatDeg = 110.54
  const lonSpanKm = Math.max((maxLon - minLon) * kmPerLonDeg, 0.05)
  const latSpanKm = Math.max((maxLat - minLat) * kmPerLatDeg, 0.05)
  const trackAspect = lonSpanKm / latSpanKm

  if (viewportAspect > trackAspect) {
    // Écran relativement plus large que le tracé : élargir en longitude pour remplir la largeur
    const extraLonKm = (latSpanKm * viewportAspect - lonSpanKm) / 2
    const extraLonDeg = extraLonKm / kmPerLonDeg
    minLon -= extraLonDeg; maxLon += extraLonDeg
  } else {
    // Écran relativement plus haut que le tracé : élargir en latitude pour remplir la hauteur
    const extraLatKm = (lonSpanKm / viewportAspect - latSpanKm) / 2
    const extraLatDeg = extraLatKm / kmPerLatDeg
    minLat -= extraLatDeg; maxLat += extraLatDeg
  }
  // Marge de sécurité supplémentaire (padding de fitBounds(), arrondis) : +20%
  const lonPad = (maxLon - minLon) * 0.1
  const latPad = (maxLat - minLat) * 0.1
  minLon -= lonPad; maxLon += lonPad
  minLat -= latPad; maxLat += latPad

  for (const zoom of zoomLevels) {
    // +1 tuile de marge de chaque côté en plus, pour couvrir le padding de fitBounds()
    const { x: xMin, y: yMax } = lonLatToTileXY(minLon, minLat, zoom)
    const { x: xMax, y: yMin } = lonLatToTileXY(maxLon, maxLat, zoom)
    for (let x = xMin - 1; x <= xMax + 1; x++) {
      for (let y = yMin - 1; y <= yMax + 1; y++) {
        const key = `${zoom}/${x}/${y}`
        if (seen.has(key)) continue
        seen.add(key)
        urls.push(tileUrl(zoom, x, y))
      }
    }
  }
  return urls
}

/** Précharge une liste de tuiles dans le cache HTTP du navigateur, avec une concurrence limitée
 * et annulable. Utilisé pendant que l'utilisateur configure les panneaux (temps mort avant la
 * lecture) pour que l'animation démarre sans tuiles manquantes (fond beige) ni à-coups réseau.
 * Concurrence volontairement basse : le navigateur limite les connexions simultanées par serveur
 * (~6), donc un préchargement trop agressif retarde les propres requêtes de tuiles de la carte
 * (aperçu en direct, export vidéo), au lieu de les aider. */
export function prefetchTiles(
  urls: string[],
  opts: {
    concurrency?: number; signal?: AbortSignal; tileTimeoutMs?: number; retries?: number
    onProgress?: (ratio: number) => void
  } = {},
): Promise<void> {
  const { concurrency = 2, signal, tileTimeoutMs = 8000, retries = 0, onProgress } = opts
  if (urls.length === 0) return Promise.resolve()
  let index = 0
  let completed = 0
  let okCount = 0, failCount = 0
  const total0 = urls.length
  const t0 = performance.now()
  const attempts = new Map<string, number>() // relance bornée sur erreur/timeout (throttling IGN)
  // Retourne une promesse résolue une fois toutes les tuiles réglées (chargées, en erreur ou
  // abandonnées) — les appelants qui n'en ont pas besoin (préchargement en tâche de fond pendant
  // le wizard) peuvent l'ignorer sans rien changer à leur usage existant ; l'export vidéo, lui,
  // peut désormais attendre la fin du préchargement avant de démarrer la capture image par image.
  return new Promise<void>(resolve => {
    const finishOne = () => {
      completed++
      onProgress?.(Math.min(1, completed / Math.max(total0, urls.length)))
      if (completed >= urls.length) {
        console.log(`[prefetch] ${okCount}/${total0} tuiles OK, ${failCount} échecs (dont relances), ${Math.round(performance.now() - t0)}ms`)
        resolve()
      }
    }
    function next() {
      if (signal?.aborted) { resolve(); return }
      if (index >= urls.length) return
      const url = urls[index++]
      let settled = false
      const done = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (ok) okCount++; else failCount++
        const n = (attempts.get(url) ?? 0) + 1
        if (!ok && n <= retries) {
          // Échec (souvent un 429/timeout de throttling) : on remet la tuile en fin de file pour
          // un nouvel essai plus tard, quand la pression réseau sera retombée.
          attempts.set(url, n)
          urls.push(url)
        }
        finishOne()
        next()
      }
      // fetch() et PAS <img> : MapLibre récupère lui aussi ses tuiles par fetch() (mode cors),
      // donc pour que le préchargement remplisse le cache HTTP que la carte va réutiliser, il faut
      // la MÊME méthode/mode — sinon les deux requêtes ont des clés de cache différentes et le
      // préchargement ne sert à rien (tuiles rechargées en direct pendant la capture -> flou).
      // On consomme le corps (arrayBuffer) pour que la réponse entre bien en cache, puis on jette.
      const ctl = new AbortController()
      const timer = setTimeout(() => { ctl.abort(); done(false) }, tileTimeoutMs)
      const onOuterAbort = () => ctl.abort()
      signal?.addEventListener('abort', onOuterAbort, { once: true })
      fetch(url, { mode: 'cors', signal: ctl.signal }) // credentials par défaut : comme MapLibre
        .then(r => (r.ok ? r.arrayBuffer().then(() => done(true)) : done(false)))
        .catch(() => done(false))
        .finally(() => signal?.removeEventListener('abort', onOuterAbort))
    }
    for (let i = 0; i < concurrency; i++) next()
  })
}
