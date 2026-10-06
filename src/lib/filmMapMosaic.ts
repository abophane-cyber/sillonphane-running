/**
 * Fond de carte pré-composé pour le plan de marche principal du film 2D (filmExport.ts).
 *
 * Le rendu MapLibre habituel (jumpTo + attente de rendu + capture du canvas WebGL, à chaque
 * image) recompose la vue à partir de tuiles raster individuelles à chaque frame — un mécanisme
 * qui peut introduire un très léger scintillement d'une image à l'autre pendant un panoramique
 * continu (bruit de recomposition de tuiles, indépendant du contenu/style de la carte : constaté
 * sur tous les fonds de carte essayés). Ici, toutes les tuiles nécessaires à la portion du tracé
 * concernée sont chargées et composées UNE SEULE FOIS dans un grand canvas fixe ; chaque image du
 * film n'est plus alors qu'un recadrage (translation pure, aucun rendu GPU) de cette mosaïque, ce
 * qui élimine par construction tout scintillement de recomposition.
 *
 * Le fond de carte ET les éléments dessinés par-dessus (ruban, panneaux, marqueur) utilisent la
 * même projection Web Mercator déterministe (projectToScreen) — aucun écart possible entre les
 * deux, contrairement à project() de MapLibre dont le résultat dépend du cycle de rendu en cours.
 *
 * Portée volontairement limitée au plan de marche à zoom fixe (pas de rotation/inclinaison dans
 * tout le pipeline 2D) : l'écran-titre (caméra immobile) et le plan d'ensemble final (dézoom à
 * travers plusieurs niveaux de zoom) restent sur le rendu MapLibre existant.
 */

import type { GpxPoint } from '../types'
import { IGN_TILE_URL } from './tileSources'
import { lonLatToTileXY } from './tilePrefetch'

const TILE_SIZE = 256
// Fond de la carte quand une tuile manque : même couleur que le calque « background » de TrackMap.tsx.
const MAP_BACKGROUND = '#e8e0d5'
const MOSAIC_CONCURRENCY = 8 // le WMTS de l'IGN n'a pas de limite de débit (CGU Géoplateforme)
const TILE_ATTEMPTS = 3
const TILE_TIMEOUT_MS = 15000

/** Charge une tuile (image CORS), avec réessais espacés ; null si elle reste introuvable. */
async function loadTileImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  for (let attempt = 0; attempt < TILE_ATTEMPTS; attempt++) {
    if (signal?.aborted) return null
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt))
    const img = await new Promise<HTMLImageElement | null>(resolve => {
      const im = new Image()
      im.crossOrigin = 'anonymous'
      const timer = setTimeout(() => { im.src = ''; resolve(null) }, TILE_TIMEOUT_MS)
      im.onload = () => { clearTimeout(timer); resolve(im) }
      im.onerror = () => { clearTimeout(timer); resolve(null) } // 404/429/CORS/réseau
      im.src = url
    })
    if (img) return img
  }
  return null
}

function drawTile(ctx: CanvasRenderingContext2D, img: HTMLImageElement, col: number, row: number) {
  try { ctx.drawImage(img, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE) }
  catch { /* tuile décodée mais dessin échoué (rare) : case laissée au fond */ }
}

/** Exécute `task` sur chaque élément, au plus `limit` à la fois. */
async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => { while (next < items.length) await task(items[next++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

function tileUrl(z: number, x: number, y: number) {
  return IGN_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

interface MosaicTile { url: string; x: number; y: number }

function buildMosaicTiles(points: GpxPoint[], zoom: number, radius: number): MosaicTile[] {
  const seen = new Set<string>()
  const tiles: MosaicTile[] = []
  // Échantillonne le tracé comme buildRouteTileUrls (tilePrefetch.ts) : limite le nombre de
  // points traités sur les longs parcours, sans perdre de couverture utile.
  const step = Math.max(1, Math.floor(points.length / 400))
  for (let i = 0; i < points.length; i += step) {
    const p = points[i]
    const { x, y } = lonLatToTileXY(p.lon, p.lat, zoom)
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const tx = x + dx, ty = y + dy
        const key = `${tx}/${ty}`
        if (seen.has(key)) continue
        seen.add(key)
        tiles.push({ url: tileUrl(zoom, tx, ty), x: tx, y: ty })
      }
    }
  }
  return tiles
}

export interface MapMosaic {
  canvas: HTMLCanvasElement
  xMin: number
  yMin: number
  zoom: number
}

/** Charge et compose toutes les tuiles couvrant le tracé (au zoom entier le plus proche du zoom
 *  de lecture) en une seule image fixe. `null` si le tracé est trop long pour tenir dans une
 *  mosaïque de taille raisonnable (`maxSize`) — l'appelant retombe alors sur le rendu MapLibre
 *  existant, image par image. */
export async function buildMapMosaic(
  points: GpxPoint[], zoom: number, radius: number, maxSize = 8192,
  signal?: AbortSignal,
): Promise<MapMosaic | null> {
  const mosaicZoom = Math.round(zoom)
  const tiles = buildMosaicTiles(points, mosaicZoom, radius)
  if (tiles.length === 0) return null

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
  for (const t of tiles) {
    if (t.x < xMin) xMin = t.x; if (t.x > xMax) xMax = t.x
    if (t.y < yMin) yMin = t.y; if (t.y > yMax) yMax = t.y
  }
  const w = (xMax - xMin + 1) * TILE_SIZE
  const h = (yMax - yMin + 1) * TILE_SIZE
  if (w > maxSize || h > maxSize) return null

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Chargement par petits groupes et avec réessais. Avant : toutes les tuiles d'un coup (souvent
  // plusieurs centaines de requêtes) et aucune reprise — une tuile en échec (délai, erreur réseau,
  // 429) restait transparente, donc NOIRE dans la vidéo, sur toute la marche.
  const failed: MosaicTile[] = []
  await runPool(tiles, MOSAIC_CONCURRENCY, async t => {
    const img = await loadTileImage(t.url, signal)
    if (signal?.aborted) return
    if (img) drawTile(ctx, img, t.x - xMin, t.y - yMin)
    else failed.push(t)
  })
  if (signal?.aborted) return null

  // Dernier recours pour les tuiles introuvables : le quart correspondant de la tuile du niveau de
  // zoom au-dessus, agrandi (un peu flou, mais pas de trou). Une même tuile parente sert à ses
  // quatre enfants.
  const stillMissing: MosaicTile[] = []
  if (failed.length > 0) {
    const parents = new Map<string, Promise<HTMLImageElement | null>>()
    await runPool(failed, MOSAIC_CONCURRENCY, async t => {
      const pz = mosaicZoom - 1, px = t.x >> 1, py = t.y >> 1
      const key = `${px}/${py}`
      if (!parents.has(key)) parents.set(key, pz >= 0 ? loadTileImage(tileUrl(pz, px, py), signal) : Promise.resolve(null))
      const parent = await parents.get(key)!
      if (signal?.aborted) return
      if (!parent) { stillMissing.push(t); return }
      const half = TILE_SIZE / 2
      try {
        ctx.drawImage(parent, (t.x & 1) * half, (t.y & 1) * half, half, half,
          (t.x - xMin) * TILE_SIZE, (t.y - yMin) * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      } catch { stillMissing.push(t) }
    })
    if (signal?.aborted) return null
    console.warn(`[film2d] mosaïque : ${failed.length} tuile(s) en échec, ${failed.length - stillMissing.length} remplacée(s) par le zoom inférieur, ${stillMissing.length} laissée(s) au fond beige`)
  }

  // Le Plan IGN brut est assez délavé : TrackMap.tsx (makeStyle) lui applique un retraitement
  // visuel (contraste/saturation/teinte) via les paint properties raster-* de MapLibre. La
  // mosaïque contourne le pipeline de rendu MapLibre (c'est tout l'intérêt), donc ce retraitement
  // doit être reproduit ici à la main pour garder le même rendu que l'aperçu/le reste du film.
  applyIgnColorAdjust(ctx, w, h)

  // Cases restées vides — tuiles introuvables, et cases du rectangle trop loin du tracé pour avoir
  // été demandées : couleur du fond de la carte (calque « background » de TrackMap.tsx), posée
  // APRÈS le retraitement pour être identique à celle du rendu MapLibre. Jamais de noir.
  const drawn = new Set(tiles.map(t => `${t.x}/${t.y}`))
  for (const t of stillMissing) drawn.delete(`${t.x}/${t.y}`)
  ctx.fillStyle = MAP_BACKGROUND
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      if (!drawn.has(`${x}/${y}`)) ctx.fillRect((x - xMin) * TILE_SIZE, (y - yMin) * TILE_SIZE, TILE_SIZE, TILE_SIZE)
    }
  }

  return { canvas, xMin, yMin, zoom: mosaicZoom }
}

// Reproduit exactement le calcul du shader raster de MapLibre (raster.fragment.glsl +
// rasterUniformValues dans maplibre-gl) pour les valeurs fixes utilisées par bg-ign dans
// TrackMap.tsx (raster-contrast: 0.48, raster-saturation: 0.21, raster-brightness-max: 0.58,
// raster-hue-rotate: 17). Si ces valeurs changent là-bas, les reporter ici aussi.
function applyIgnColorAdjust(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const CONTRAST = 0.48, SATURATION = 0.21, BRIGHTNESS_MIN = 0, BRIGHTNESS_MAX = 0.58, HUE_DEG = 17

  const contrastFactor = CONTRAST > 0 ? 1 / (1 - CONTRAST) : 1 + CONTRAST
  const saturationFactor = SATURATION > 0 ? 1 - 1 / (1.001 - SATURATION) : -SATURATION
  const angle = HUE_DEG * Math.PI / 180
  const s = Math.sin(angle), c = Math.cos(angle)
  const sq3 = Math.sqrt(3)
  const w0 = (2 * c + 1) / 3
  const w1 = (-sq3 * s - c + 1) / 3
  const w2 = (sq3 * s - c + 1) / 3

  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255
    // teinte (matrice "spin" du shader)
    const nr = r * w0 + g * w1 + b * w2
    const ng = r * w2 + g * w0 + b * w1
    const nb = r * w1 + g * w2 + b * w0
    r = nr; g = ng; b = nb
    // saturation
    const avg = (r + g + b) / 3
    r += (avg - r) * saturationFactor
    g += (avg - g) * saturationFactor
    b += (avg - b) * saturationFactor
    // contraste
    r = (r - 0.5) * contrastFactor + 0.5
    g = (g - 0.5) * contrastFactor + 0.5
    b = (b - 0.5) * contrastFactor + 0.5
    // luminosité (mix(brightness_min, brightness_max, rgb))
    r = BRIGHTNESS_MIN + (BRIGHTNESS_MAX - BRIGHTNESS_MIN) * r
    g = BRIGHTNESS_MIN + (BRIGHTNESS_MAX - BRIGHTNESS_MIN) * g
    b = BRIGHTNESS_MIN + (BRIGHTNESS_MAX - BRIGHTNESS_MIN) * b
    d[i]     = Math.max(0, Math.min(255, r * 255))
    d[i + 1] = Math.max(0, Math.min(255, g * 255))
    d[i + 2] = Math.max(0, Math.min(255, b * 255))
  }
  ctx.putImageData(imgData, 0, 0)
}

function lngToWorldPx(lon: number, zoom: number) {
  return (lon + 180) / 360 * TILE_SIZE * 2 ** zoom
}
function latToWorldPx(lat: number, zoom: number) {
  const latRad = lat * Math.PI / 180
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * TILE_SIZE * 2 ** zoom
}

/** Projection Web Mercator manuelle (sans rotation/inclinaison — jamais utilisées dans le film
 *  2D), pour un point (lon, lat) à l'écran, caméra centrée sur (centerLng, centerLat). Remplace
 *  exportMap.project() pendant le plan de marche : mêmes formules que mosaicCropOrigin, donc
 *  aucun écart possible entre le fond de carte affiché et les éléments dessinés par-dessus. */
export function projectToScreen(
  lon: number, lat: number, centerLng: number, centerLat: number, zoom: number, outW: number, outH: number,
): { x: number; y: number } {
  return {
    x: outW / 2 + (lngToWorldPx(lon, zoom) - lngToWorldPx(centerLng, zoom)),
    y: outH / 2 + (latToWorldPx(lat, zoom) - latToWorldPx(centerLat, zoom)),
  }
}

/** Coin haut-gauche à recadrer dans la mosaïque pour centrer la caméra sur (centerLng, centerLat). */
export function mosaicCropOrigin(
  mosaic: MapMosaic, centerLng: number, centerLat: number, outW: number, outH: number,
): { x: number; y: number } {
  return {
    x: lngToWorldPx(centerLng, mosaic.zoom) - mosaic.xMin * TILE_SIZE - outW / 2,
    y: latToWorldPx(centerLat, mosaic.zoom) - mosaic.yMin * TILE_SIZE - outH / 2,
  }
}
