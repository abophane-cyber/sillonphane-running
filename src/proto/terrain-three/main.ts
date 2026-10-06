import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { Water } from 'three/examples/jsm/objects/Water.js'
import waterNormalsUrl from './waternormals.jpg'

// Prototype isolé : relief 3D réaliste (Three.js + DEM + orthophoto IGN),
// hors du pipeline principal de l'app. Tracé GPX réel : boucle Sotteville-sur-Mer / Veules-les-
// Roses (Côte d'Albâtre) — test rando EN BOUCLE (départ = arrivée) + littoral (bord de mer).

// Plafonds de zoom : rabaissés automatiquement pour un grand tracé (bloc adaptatif après BBOX)
// afin que la mosaïque ortho et le MNT tiennent en mémoire et n'inondent pas IGN de requêtes.
let ZOOM_ORTHO = 16 // texture aérienne (grille Web Mercator)
let ZOOM_ELEV = 14 // relief RGE ALTI ~5m (grille géographique WGS84G_6_14)

// Scénario météo/heure (dans l'app réelle : WeatherInfo issu de fetchHistoricalWeather, voir
// src/lib/meteo.ts) piloté ici à la main pour démontrer que ces données peuvent piloter le ciel
// et la lumière ambiante plutôt que des réglages fixes.
const WEATHER_SCENARIO = {
  hourOfDay: 16, // après-midi : soleil à ~42°, modelé long et lumière chaude
  cloudCover: 0.35, // un peu de directionnel conservé -> ombres douces qui brouillent la couture de mosaïque
}

const TRAIL_DATE = '10 août 2026' // date affichée dans le cartel de titre

function sunElevationForHour(hour: number): number {
  // Approximation simple : élévation max ~62° vers 13h (été, latitude France), decroît
  // linéairement de part et d'autre, ne descend jamais sous l'horizon dans cette plage de test.
  const solarNoon = 13
  return Math.max(8, 62 - Math.abs(hour - solarNoon) * 6.5)
}

// Panneaux de localité/col affichés pendant le survol, sur le même principe que les "panneaux"
// choisis lors de l'export du film 2D (voir filmExport.ts, LocalityEvent) : nom, position,
// style, déclenchés quand la caméra passe à proximité du point du tracé le plus proche.
const PANELS: { name: string; lon: number; lat: number; style: 'lieudit' | 'col' | 'standard'; ele?: number }[] = [
  { name: 'Veules-les-Roses', lon: 0.8006, lat: 49.8709, style: 'lieudit' },
]

// Panneaux départ/arrivée (comme departureEvent/arrivalEvent de filmExport.ts) : affichés en
// début et fin de survol plutôt que déclenchés par proximité le long du tracé.
const DEPARTURE_NAME = 'Sotteville-sur-Mer'
const ARRIVAL_NAME = 'Sotteville-sur-Mer' // boucle

const TRAIL: [number, number][] = [ // Sotteville-Veules — 117 pts, 7.8 km, BOUCLE (depart = arrivee), cote normande
  [0.82973, 49.88728],
  [0.82754, 49.88673],
  [0.82567, 49.88601],
  [0.82393, 49.88525],
  [0.82538, 49.88291],
  [0.82689, 49.88193],
  [0.82794, 49.88180],
  [0.82800, 49.88154],
  [0.82802, 49.88127],
  [0.82814, 49.88006],
  [0.82812, 49.87961],
  [0.82810, 49.87919],
  [0.82713, 49.87924],
  [0.82570, 49.87917],
  [0.82389, 49.87899],
  [0.82375, 49.87900],
  [0.82377, 49.87883],
  [0.82360, 49.87862],
  [0.82336, 49.87830],
  [0.82302, 49.87793],
  [0.82261, 49.87747],
  [0.82235, 49.87718],
  [0.82213, 49.87692],
  [0.82180, 49.87645],
  [0.82157, 49.87613],
  [0.82126, 49.87584],
  [0.82046, 49.87529],
  [0.82020, 49.87509],
  [0.81982, 49.87481],
  [0.81942, 49.87451],
  [0.81886, 49.87411],
  [0.81857, 49.87391],
  [0.81823, 49.87365],
  [0.81795, 49.87342],
  [0.81761, 49.87313],
  [0.81732, 49.87288],
  [0.81678, 49.87243],
  [0.81641, 49.87211],
  [0.81600, 49.87177],
  [0.81578, 49.87160],
  [0.81552, 49.87142],
  [0.81519, 49.87119],
  [0.81458, 49.87082],
  [0.81382, 49.87037],
  [0.81305, 49.86998],
  [0.81232, 49.86966],
  [0.81174, 49.86942],
  [0.81142, 49.86929],
  [0.81129, 49.86957],
  [0.81116, 49.86982],
  [0.81090, 49.87009],
  [0.81052, 49.87044],
  [0.81030, 49.87064],
  [0.80992, 49.87095],
  [0.80947, 49.87129],
  [0.80909, 49.87157],
  [0.80873, 49.87182],
  [0.80838, 49.87204],
  [0.80805, 49.87229],
  [0.80760, 49.87257],
  [0.80713, 49.87286],
  [0.80608, 49.87245],
  [0.80553, 49.87226],
  [0.80487, 49.87201],
  [0.80396, 49.87159],
  [0.80229, 49.87117],
  [0.80258, 49.87091],
  [0.80256, 49.87066],
  [0.80244, 49.87045],
  [0.80217, 49.87025],
  [0.80193, 49.87003],
  [0.80159, 49.87022],
  [0.80128, 49.87042],
  [0.80088, 49.87064],
  [0.80068, 49.87083],
  [0.80093, 49.87108],
  [0.80114, 49.87149],
  [0.80120, 49.87171],
  [0.80122, 49.87198],
  [0.80120, 49.87226],
  [0.80116, 49.87252],
  [0.80110, 49.87277],
  [0.80087, 49.87303],
  [0.80047, 49.87336],
  [0.79996, 49.87377],
  [0.79966, 49.87404],
  [0.79934, 49.87422],
  [0.79900, 49.87449],
  [0.79899, 49.87475],
  [0.79888, 49.87497],
  [0.79889, 49.87530],
  [0.79896, 49.87568],
  [0.79908, 49.87601],
  [0.79944, 49.87630],
  [0.79932, 49.87640],
  [0.79884, 49.87650],
  [0.79877, 49.87670],
  [0.79889, 49.87692],
  [0.79903, 49.87712],
  [0.79870, 49.87713],
  [0.79909, 49.87718],
  [0.79929, 49.87736],
  [0.80031, 49.87774],
  [0.80093, 49.87797],
  [0.80348, 49.87900],
  [0.80570, 49.88000],
  [0.80782, 49.88077],
  [0.81001, 49.88132],
  [0.81476, 49.88260],
  [0.81796, 49.88386],
  [0.82113, 49.88499],
  [0.82262, 49.88561],
  [0.82563, 49.88714],
  [0.82893, 49.88844],
  [0.82951, 49.88833],
  [0.82975, 49.88766],
  [0.82973, 49.88728],
]

// (3) Marge de terrain chargée autour du tracé, proportionnelle à son envergure (bornée), au
// lieu d'une valeur fixe : un petit tracé ne charge pas 3 km de rab, un grand en a assez.
const _trailLons = TRAIL.map(p => p[0])
const _trailLats = TRAIL.map(p => p[1])
const _trailSpan = Math.max(
  Math.max(..._trailLons) - Math.min(..._trailLons),
  Math.max(..._trailLats) - Math.min(..._trailLats),
)
const PAD = Math.min(0.045, Math.max(0.014, _trailSpan * 0.18))

// (3) Emprise clampée à la France métropolitaine : évite de charger la haute mer / l'étranger
// au-delà de ce cadre. La frange transfrontalière fine reste gérée tuile par tuile (404).
const FR_BOUNDS = { minLon: -5.3, maxLon: 8.35, minLat: 41.3, maxLat: 51.15 }
const BBOX = {
  minLon: Math.max(FR_BOUNDS.minLon, Math.min(..._trailLons) - PAD),
  maxLon: Math.min(FR_BOUNDS.maxLon, Math.max(..._trailLons) + PAD),
  minLat: Math.max(FR_BOUNDS.minLat, Math.min(..._trailLats) - PAD),
  maxLat: Math.min(FR_BOUNDS.maxLat, Math.max(..._trailLats) + PAD),
}

// (3) Zoom adaptatif : un tracé long couvre trop de tuiles à z16 — la mosaïque dépasse la
// mémoire raisonnable et IGN throttle la rafale. On rabaisse le zoom tant que la mosaïque
// dépasse un budget en MÉGAPIXELS (ce qui compte pour la mémoire : ~4 o/px + la copie faite
// par le grade / l'inpaint) ou 16384 px sur un côté (limite de texture GPU). Un budget "plus
// grand côté" pénalisait à tort les bbox allongées : z14 (flou) là où z15 passait très bien.
function _tileGrid(z: number, isElev: boolean): { nx: number; ny: number } {
  if (isElev) {
    const deg = 180 / 2 ** z
    const c0 = Math.floor((BBOX.minLon + 180) / deg)
    const c1 = Math.floor((BBOX.maxLon + 180) / deg)
    const r0 = Math.floor((90 - BBOX.maxLat) / deg)
    const r1 = Math.floor((90 - BBOX.minLat) / deg)
    return { nx: c1 - c0 + 1, ny: r1 - r0 + 1 }
  }
  const x0 = Math.floor(lon2tileX(BBOX.minLon, z))
  const x1 = Math.floor(lon2tileX(BBOX.maxLon, z))
  const y0 = Math.floor(lat2tileY(BBOX.maxLat, z))
  const y1 = Math.floor(lat2tileY(BBOX.minLat, z))
  return { nx: x1 - x0 + 1, ny: y1 - y0 + 1 }
}
const MAX_ORTHO_MP = 60 // mégapixels de mosaïque ortho
const MAX_ELEV_MP = 44
const MAX_TILES_SIDE = 62 // 62 * 256 < 16384 (limite de texture GPU)
function _fits(z: number, isElev: boolean, maxMP: number): boolean {
  const { nx, ny } = _tileGrid(z, isElev)
  return nx <= MAX_TILES_SIDE && ny <= MAX_TILES_SIDE && nx * ny * 65536 <= maxMP * 1e6
}
while (ZOOM_ORTHO > 12 && !_fits(ZOOM_ORTHO, false, MAX_ORTHO_MP)) ZOOM_ORTHO--
while (ZOOM_ELEV > 11 && !_fits(ZOOM_ELEV, true, MAX_ELEV_MP)) ZOOM_ELEV--
console.info(`[proto] tracé ${_trailSpan.toFixed(3)}° -> ZOOM_ORTHO=${ZOOM_ORTHO}, ZOOM_ELEV=${ZOOM_ELEV}`)

// Affichage d'erreur minimal (l'ancien HUD d'info en haut à gauche a été retiré).
function showError(text: string) {
  let el = document.getElementById('load-error')
  if (!el) {
    el = document.createElement('div')
    el.id = 'load-error'
    el.style.cssText = 'position:absolute;top:12px;left:12px;z-index:20;font:12px/1.5 system-ui,sans-serif;' +
      'color:#fff;background:rgba(150,20,20,0.9);padding:10px 14px;border-radius:8px;max-width:340px'
    document.getElementById('app')!.appendChild(el)
  }
  el.textContent = text
}

const distanceBadge = document.getElementById('distance-badge')!
function formatDistanceKm(m: number): string {
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

// Cartel du profil altimétrique : dessine la courbe d'altitude du tracé dans #profile et renvoie
// une fonction qui déplace le curseur de position en fonction de la progression t (0..1).
function buildProfileCard(
  pts: THREE.Vector3[],
  totalDistanceM: number,
  altOffset: number,
): (t: number) => void {
  const host = document.getElementById('profile') as HTMLElement
  const W = 408, H = 108 // +20 %
  const n = pts.length - 1

  // Altitudes MNT échantillonnées le long du tracé : on les débruite (médiane 3 puis moyenne
  // glissante) avant de tracer. Sinon un pic ponctuel du MNT (pont, digue, pylône) — lissé sur
  // le maillage grossier du terrain, donc invisible au survol — écrase l'échelle du profil et
  // apparaît comme une fausse "grosse montée".
  const rawElev = pts.map(p => p.y + altOffset)
  const med = rawElev.map((_, i) => {
    const a = rawElev[Math.max(0, i - 1)], b = rawElev[i], c = rawElev[Math.min(rawElev.length - 1, i + 1)]
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  })
  const SM = 4
  const elev = med.map((_, i) => {
    let s = 0, w = 0
    for (let k = -SM; k <= SM; k++) { const j = i + k; if (j >= 0 && j < med.length) { s += med[j]; w++ } }
    return s / w
  })

  let elevMin = Infinity, elevMax = -Infinity
  for (const a of elev) { if (a < elevMin) elevMin = a; if (a > elevMax) elevMax = a }

  // Fenêtre altimétrique DESSINÉE : au moins MIN_SPAN mètres. Sans ça le profil est toujours
  // étiré au max (elevMin..elevMax) et un tracé de plaine — 40 m d'amplitude sur 25 km —
  // ressemble à une étape de montagne. Avec un plancher, un tracé plat a l'air plat ; un vrai
  // gros dénivelé remplit quand même toute la carte.
  const MIN_SPAN = 180
  let drawLo = elevMin, drawHi = elevMax
  if (drawHi - drawLo < MIN_SPAN) {
    const mid = (drawLo + drawHi) / 2
    drawLo = mid - MIN_SPAN / 2
    drawHi = mid + MIN_SPAN / 2
  }
  const range = Math.max(1, drawHi - drawLo)

  const altAt = (u: number) => {
    const fi = Math.max(0, Math.min(n, u * n))
    const i0 = Math.floor(fi), i1 = Math.min(n, i0 + 1), f = fi - i0
    return elev[i0] * (1 - f) + elev[i1] * f
  }
  const xAt = (u: number) => u * W
  const yAt = (u: number) => H - ((altAt(u) - drawLo) / range) * (H - 6) - 3

  const N = 160
  let line = `M ${xAt(0).toFixed(1)} ${yAt(0).toFixed(1)}`
  for (let k = 1; k <= N; k++) line += ` L ${xAt(k / N).toFixed(1)} ${yAt(k / N).toFixed(1)}`
  const area = `${line} L ${W} ${H} L 0 ${H} Z`

  // D+ sur un pas décimé (~1/25e du tracé) : évite d'accumuler le bruit d'échantillonnage du
  // MNT en un dénivelé positif fantôme, comme le font les apps de rando avec un seuil.
  let gain = 0
  const gStep = Math.max(1, Math.round(elev.length / 25))
  for (let i = gStep; i < elev.length; i += gStep) { const dz = elev[i] - elev[i - gStep]; if (dz > 0) gain += dz }

  host.innerHTML =
    `<div class="title">Profil du tracé</div>` +
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<path d="${area}" fill="rgba(230,150,90,0.38)"/>` +
      `<path d="${line}" fill="none" stroke="#ffb072" stroke-width="2.4"/>` +
      `<line id="pf-line" x1="0" y1="0" x2="0" y2="${H}" stroke="#fff" stroke-width="1.6"/>` +
      `<circle id="pf-dot" cx="0" cy="${yAt(0).toFixed(1)}" r="4" fill="#fff" stroke="#000" stroke-width="0.8"/>` +
    `</svg>` +
    `<div class="stats">Alt. <b>${Math.round(elevMin)}</b>–<b>${Math.round(elevMax)}</b> m` +
    ` · D+ <b>${Math.round(gain)}</b> m` +
    ` · <b>${(totalDistanceM / 1000).toFixed(1).replace('.', ',')}</b> km</div>`

  const lineEl = host.querySelector('#pf-line') as SVGLineElement
  const dotEl = host.querySelector('#pf-dot') as SVGCircleElement

  return (t: number) => {
    host.style.display = 'block'
    const u = Math.max(0, Math.min(1, t))
    const x = xAt(u).toFixed(1), y = yAt(u).toFixed(1)
    lineEl.setAttribute('x1', x); lineEl.setAttribute('x2', x)
    dotEl.setAttribute('cx', x); dotEl.setAttribute('cy', y)
  }
}

function lon2tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}
function lat2tileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}
function tileX2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}
function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

const TILE = 256

const txMin = Math.floor(lon2tileX(BBOX.minLon, ZOOM_ORTHO))
const txMax = Math.floor(lon2tileX(BBOX.maxLon, ZOOM_ORTHO))
const tyMin = Math.floor(lat2tileY(BBOX.maxLat, ZOOM_ORTHO))
const tyMax = Math.floor(lat2tileY(BBOX.minLat, ZOOM_ORTHO))
const nx = txMax - txMin + 1
const ny = tyMax - tyMin + 1

const covLonMin = tileX2lon(txMin, ZOOM_ORTHO)
const covLonMax = tileX2lon(txMax + 1, ZOOM_ORTHO)
const covLatMax = tileY2lat(tyMin, ZOOM_ORTHO)
const covLatMin = tileY2lat(tyMax + 1, ZOOM_ORTHO)

const lat0 = (covLatMin + covLatMax) / 2
const lon0 = (covLonMin + covLonMax) / 2
const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON = 111320 * Math.cos((lat0 * Math.PI) / 180)

function project(lon: number, lat: number): [number, number] {
  return [(lon - lon0) * M_PER_DEG_LON, -(lat - lat0) * M_PER_DEG_LAT]
}

const elevTileDeg = 180 / 2 ** ZOOM_ELEV
function lon2elevPxGlobal(lon: number): number {
  return ((lon + 180) / elevTileDeg) * TILE
}
function lat2elevPxGlobal(lat: number): number {
  return ((90 - lat) / elevTileDeg) * TILE
}

const ecolMin = Math.floor(lon2elevPxGlobal(covLonMin) / TILE)
const ecolMax = Math.floor(lon2elevPxGlobal(covLonMax) / TILE)
const erowMin = Math.floor(lat2elevPxGlobal(covLatMax) / TILE)
const erowMax = Math.floor(lat2elevPxGlobal(covLatMin) / TILE)
const enx = ecolMax - ecolMin + 1
const eny = erowMax - erowMin + 1

function elevPixelForLonLat(lon: number, lat: number): [number, number] {
  return [lon2elevPxGlobal(lon) - ecolMin * TILE, lat2elevPxGlobal(lat) - erowMin * TILE]
}

// Exécute des tâches asynchrones par lots de `limit` : évite d'ouvrir 1000+ requêtes tuiles d'un
// coup (IGN throttle -> rafale de 404 -> mosaïque trouée) sur un grand tracé.
async function runPooled(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let idx = 0
  const worker = async () => {
    while (idx < tasks.length) {
      const my = idx++
      await tasks[my]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
}

interface OrthoResult { canvas: HTMLCanvasElement; ok: boolean[]; cols: number; rows: number }

async function fetchOrthoTiles(
  txMinP: number, tyMinP: number, nxP: number, nyP: number, zoom: number
): Promise<OrthoResult> {
  const canvas = document.createElement('canvas')
  canvas.width = nxP * TILE
  canvas.height = nyP * TILE
  const ctx = canvas.getContext('2d')!
  const ok = new Array<boolean>(nxP * nyP).fill(false)
  const jobs: (() => Promise<void>)[] = []
  for (let jy = 0; jy < nyP; jy++) {
    for (let jx = 0; jx < nxP; jx++) {
      const x = txMinP + jx
      const y = tyMinP + jy
      const url = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${zoom}&TILEROW=${y}&TILECOL=${x}`
      const slot = jy * nxP + jx
      // Tuile manquante côté IGN (404, ou hors couverture : mer, étranger) -> on la marque et on
      // comble ensuite depuis les tuiles voisines (voir inpaintOrthoHoles).
      jobs.push(() =>
        loadImage(url)
          .then(img => { ctx.drawImage(img, jx * TILE, jy * TILE); ok[slot] = true })
          .catch(() => console.warn(`Tuile ortho manquante (comblée) : z${zoom} ${x},${y}`))
      )
    }
  }
  await runPooled(jobs, 6)
  return { canvas, ok, cols: nxP, rows: nyP }
}

function fetchOrthoGrid(): Promise<OrthoResult> {
  return fetchOrthoTiles(txMin, tyMin, nx, ny, ZOOM_ORTHO)
}

// (2) Comble les tuiles ortho manquantes par propagation de la couleur depuis le bord des zones
// valides (flood BFS) : pas de vert plat ni de gris strié, juste une teinte plausible qui se
// fond dans le reste + le brouillard.
function inpaintOrthoHoles(canvas: HTMLCanvasElement, ok: boolean[], cols: number, rows: number): void {
  if (ok.every(Boolean)) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const W = canvas.width, H = canvas.height
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const bad = new Uint8Array(W * H)
  let nBad = 0
  for (let y = 0; y < H; y++) {
    const ty = Math.min(rows - 1, (y / TILE) | 0)
    for (let x = 0; x < W; x++) {
      const tx = Math.min(cols - 1, (x / TILE) | 0)
      if (!ok[ty * cols + tx]) { bad[y * W + x] = 1; nBad++ }
    }
  }
  if (!nBad || nBad === W * H) return
  floodFillRGB(d, W, H, bad)
  ctx.putImageData(img, 0, 0)
}

// BFS borné (MAX_RINGS anneaux) avec file Int32Array fixe : propage la couleur depuis le bord
// des zones valides sans exploser en mémoire même quand la moitié de l'image est hors couverture.
function floodFillRGB(d: Uint8ClampedArray, W: number, H: number, bad: Uint8Array): void {
  const MAX_RINGS = 260 // ~300 m de bande comblée à z16 ; au-delà c'est sous du maillage découpé
  const known = Uint8Array.from(bad, v => (v ? 0 : 1))
  const queued = new Uint8Array(W * H)
  const q = new Int32Array(W * H)
  let head = 0, tail = 0
  for (let i = 0; i < W * H; i++) {
    if (!bad[i]) continue
    const x = i % W, y = (i / W) | 0
    if ((x > 0 && known[i - 1]) || (x < W - 1 && known[i + 1]) ||
        (y > 0 && known[i - W]) || (y < H - 1 && known[i + W])) { q[tail++] = i; queued[i] = 1 }
  }
  let ring = 0, ringEnd = tail
  while (head < tail && ring < MAX_RINGS) {
    const i = q[head++]
    const x = i % W, y = (i / W) | 0
    let r = 0, g = 0, b = 0, n = 0
    if (x > 0 && known[i - 1]) { r += d[(i - 1) * 4]; g += d[(i - 1) * 4 + 1]; b += d[(i - 1) * 4 + 2]; n++ }
    if (x < W - 1 && known[i + 1]) { r += d[(i + 1) * 4]; g += d[(i + 1) * 4 + 1]; b += d[(i + 1) * 4 + 2]; n++ }
    if (y > 0 && known[i - W]) { r += d[(i - W) * 4]; g += d[(i - W) * 4 + 1]; b += d[(i - W) * 4 + 2]; n++ }
    if (y < H - 1 && known[i + W]) { r += d[(i + W) * 4]; g += d[(i + W) * 4 + 1]; b += d[(i + W) * 4 + 2]; n++ }
    if (n) { d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; d[i * 4 + 3] = 255; known[i] = 1 }
    if (x > 0 && bad[i - 1] && !known[i - 1] && !queued[i - 1]) { q[tail++] = i - 1; queued[i - 1] = 1 }
    if (x < W - 1 && bad[i + 1] && !known[i + 1] && !queued[i + 1]) { q[tail++] = i + 1; queued[i + 1] = 1 }
    if (y > 0 && bad[i - W] && !known[i - W] && !queued[i - W]) { q[tail++] = i - W; queued[i - W] = 1 }
    if (y < H - 1 && bad[i + W] && !known[i + W] && !queued[i + W]) { q[tail++] = i + W; queued[i + W] = 1 }
    if (head === ringEnd) { ring++; ringEnd = tail }
  }
}

function computeMercatorRange(lon: number, lat: number, radiusMeters: number, zoom: number) {
  const dLon = radiusMeters / M_PER_DEG_LON
  const dLat = radiusMeters / M_PER_DEG_LAT
  const txMinP = Math.floor(lon2tileX(lon - dLon, zoom))
  const txMaxP = Math.floor(lon2tileX(lon + dLon, zoom))
  const tyMinP = Math.floor(lat2tileY(lat + dLat, zoom))
  const tyMaxP = Math.floor(lat2tileY(lat - dLat, zoom))
  return {
    txMinP, tyMinP,
    nxP: txMaxP - txMinP + 1,
    nyP: tyMaxP - tyMinP + 1,
    covLonMinP: tileX2lon(txMinP, zoom),
    covLonMaxP: tileX2lon(txMaxP + 1, zoom),
    covLatMaxP: tileY2lat(tyMinP, zoom),
    covLatMinP: tileY2lat(tyMaxP + 1, zoom),
  }
}

interface ElevResult { data: Float32Array; width: number; height: number; origBad: Uint8Array }

async function fetchElevationGrid(): Promise<ElevResult> {
  const width = enx * TILE
  const height = eny * TILE
  const data = new Float32Array(width * height)
  const tileOk = new Array<boolean>(enx * eny).fill(false)
  const jobs: (() => Promise<void>)[] = []
  for (let jy = 0; jy < eny; jy++) {
    for (let jx = 0; jx < enx; jx++) {
      const col = ecolMin + jx
      const row = erowMin + jy
      const slot = jy * enx + jx
      const url = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLE=normal&FORMAT=image/x-bil;bits=32&TILEMATRIXSET=WGS84G_6_14&TILEMATRIX=${ZOOM_ELEV}&TILEROW=${row}&TILECOL=${col}`
      jobs.push(() =>
        fetch(url)
          .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(buf => {
            if (buf.byteLength < TILE * TILE * 4) throw new Error('tuile relief tronquée')
            const tile = new Float32Array(buf, 0, TILE * TILE)
            for (let ty = 0; ty < TILE; ty++) {
              const destOffset = (jy * TILE + ty) * width + jx * TILE
              data.set(tile.subarray(ty * TILE, (ty + 1) * TILE), destOffset)
            }
            tileOk[slot] = true
          })
          .catch(() => console.warn(`Tuile relief manquante (comblée) : z${ZOOM_ELEV} ${col},${row}`))
      )
    }
  }
  await runPooled(jobs, 5)

  // (2) Masque des pixels sans donnée = tuiles absentes + nodata résiduel (altitude <= 0 ou non
  // finie, impossible sur du relief RGE ALTI utile).
  const origBad = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const ty = Math.min(eny - 1, (y / TILE) | 0)
    for (let x = 0; x < width; x++) {
      const tx = Math.min(enx - 1, (x / TILE) | 0)
      const i = y * width + x
      if (!tileOk[ty * enx + tx] || !Number.isFinite(data[i]) || data[i] <= 0) origBad[i] = 1
    }
  }
  let nBad = 0
  for (let i = 0; i < origBad.length; i++) nBad += origBad[i]
  if (nBad > 0 && nBad < origBad.length) inpaintElevation(data, width, height, origBad)
  return { data, width, height, origBad }
}

// (2) BFS borné : comble depuis les bords valides sur MAX_RINGS anneaux, file en Int32Array de
// taille fixe (pas de blowup mémoire quand une moitié de la zone est hors couverture). Ce qui
// reste au-delà est laissé "bad" -> découpé du maillage (item 1).
function inpaintElevation(data: Float32Array, W: number, H: number, bad: Uint8Array): void {
  const DRIFT = 0.6 // m de descente par anneau
  const MAX_RINGS = 90
  const known = Uint8Array.from(bad, v => (v ? 0 : 1))
  const queued = new Uint8Array(W * H)
  const q = new Int32Array(W * H)
  let head = 0, tail = 0
  for (let i = 0; i < W * H; i++) {
    if (!bad[i]) continue
    const x = i % W, y = (i / W) | 0
    if ((x > 0 && known[i - 1]) || (x < W - 1 && known[i + 1]) ||
        (y > 0 && known[i - W]) || (y < H - 1 && known[i + W])) { q[tail++] = i; queued[i] = 1 }
  }
  let ring = 0, ringEnd = tail
  while (head < tail && ring < MAX_RINGS) {
    const i = q[head++]
    const x = i % W, y = (i / W) | 0
    let s = 0, n = 0
    if (x > 0 && known[i - 1]) { s += data[i - 1]; n++ }
    if (x < W - 1 && known[i + 1]) { s += data[i + 1]; n++ }
    if (y > 0 && known[i - W]) { s += data[i - W]; n++ }
    if (y < H - 1 && known[i + W]) { s += data[i + W]; n++ }
    if (n) { data[i] = s / n - DRIFT; known[i] = 1 }
    if (x > 0 && bad[i - 1] && !known[i - 1] && !queued[i - 1]) { q[tail++] = i - 1; queued[i - 1] = 1 }
    if (x < W - 1 && bad[i + 1] && !known[i + 1] && !queued[i + 1]) { q[tail++] = i + 1; queued[i + 1] = 1 }
    if (y > 0 && bad[i - W] && !known[i - W] && !queued[i - W]) { q[tail++] = i - W; queued[i - W] = 1 }
    if (y < H - 1 && bad[i + W] && !known[i + W] && !queued[i + W]) { q[tail++] = i + W; queued[i + W] = 1 }
    if (head === ringEnd) { ring++; ringEnd = tail }
  }
}

function gradeTerrainColors(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const mx = Math.max(r, g, b)
    if (mx < 30 || mx > 236) continue // ombres profondes / blancs : on ne touche pas

    if (g >= r && g > b && g > 40) {
      // Végétation (forêts, prairies) : on renforce la dominante verte, plus fort sur les
      // verts sombres des forêts que sur les verts pâles.
      d[i] = r * 0.92
      d[i + 1] = Math.min(255, g * 1.09)
      d[i + 2] = b * 0.90
    } else if (r >= g && r > b) {
      // Champs (jaunes, orangés, terres nues) : on creuse la saturation en baissant le bleu
      // et en relevant un peu le rouge -> teintes plus franches.
      d[i] = Math.min(255, r * 1.06)
      d[i + 1] = Math.min(255, g * 1.01)
      d[i + 2] = b * 0.86
    }
  }
  ctx.putImageData(img, 0, 0)
}

// Hydrographie vectorielle IGN (BD TOPO, via WFS Géoplateforme) peinte sur l'ortho : plutôt
// qu'une heuristique de couleur sur les pixels (qui bleuissait aussi ombres et routes), on
// récupère la GÉOMÉTRIE réelle des surfaces en eau et des cours d'eau et on la colorie. La
// teinte est semi-transparente -> la texture de l'eau (reflets, bancs de sable) reste visible.
// Hors couverture France / échec réseau -> rien de peint, silencieux.
interface HydroFeatures { surfaces: any[]; lines: any[] }

async function fetchHydroFeatures(
  lonMin: number, lonMax: number, latMin: number, latMax: number,
): Promise<HydroFeatures> {
  if (lonMax <= lonMin || latMax <= latMin) return { surfaces: [], lines: [] }
  const base = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&SRSNAME=CRS:84&OUTPUTFORMAT=application/json&COUNT=12000' +
    `&BBOX=${lonMin},${latMin},${lonMax},${latMax},CRS:84`
  const get = (typename: string): Promise<any[]> =>
    fetch(`${base}&TYPENAMES=${typename}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(j => (j && Array.isArray(j.features) ? j.features : []))
      .catch(() => {
        console.warn(`Hydrographie ${typename} indisponible -> non peinte`)
        return []
      })
  const [surfaces, lines] = await Promise.all([
    get('BDTOPO_V3:surface_hydrographique'),
    get('BDTOPO_V3:cours_d_eau'),
  ])
  return { surfaces, lines }
}

// Peint les features hydro sur un canvas quelconque dont on connaît l'emprise lon/lat. Sert pour
// la texture d'ensemble ET pour chaque tuile du corridor de détail -> l'eau reste cohérente.
function paintHydroOnCanvas(
  canvas: HTMLCanvasElement, feats: HydroFeatures,
  lonMin: number, lonMax: number, latMin: number, latMax: number,
): void {
  const { surfaces, lines } = feats
  if (!surfaces.length && !lines.length) return

  const W = canvas.width, H = canvas.height
  const ctx = canvas.getContext('2d')!
  const X = (lon: number) => ((lon - lonMin) / (lonMax - lonMin)) * W
  const Y = (lat: number) => ((latMax - lat) / (latMax - latMin)) * H
  const WATER = '#3f6f7e' // bleu-gris plus naturel (le bleu franc faisait "piscine")

  const traceRing = (ring: number[][]) => {
    if (!ring || ring.length < 2) return
    ctx.moveTo(X(ring[0][0]), Y(ring[0][1]))
    for (let i = 1; i < ring.length; i++) ctx.lineTo(X(ring[i][0]), Y(ring[i][1]))
    ctx.closePath()
  }
  const tracePolygon = (poly: number[][][]) => { for (const ring of poly) traceRing(ring) }

  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.fillStyle = WATER
  ctx.beginPath()
  for (const f of surfaces) {
    const g = f && f.geometry
    if (!g) continue
    if (g.type === 'Polygon') tracePolygon(g.coordinates)
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) tracePolygon(poly)
  }
  ctx.fill('evenodd')

  // Cours d'eau étroits (ruisseaux) : simple trait bleu de quelques pixels.
  ctx.globalAlpha = 0.48
  ctx.strokeStyle = WATER
  ctx.lineWidth = Math.max(1.5, W / 2600)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const drawLine = (l: number[][]) => {
    if (!l || l.length < 2) return
    ctx.moveTo(X(l[0][0]), Y(l[0][1]))
    for (let i = 1; i < l.length; i++) ctx.lineTo(X(l[i][0]), Y(l[i][1]))
  }
  for (const f of lines) {
    const g = f && f.geometry
    if (!g) continue
    if (g.type === 'LineString') drawLine(g.coordinates)
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) drawLine(l)
  }
  ctx.stroke()
  ctx.restore()
}

// Normal map tangent-space dérivée du DEM (opérateur de Sobel simplifié / différences finies) :
// donne du micro-relief (rugosité de la roche, herbe) sans alourdir la géométrie.
function generateNormalMapFromDEM(
  elevGrid: { data: Float32Array; width: number; height: number },
  strength = 1.6
): THREE.DataTexture {
  const { data, width, height } = elevGrid
  const normals = new Uint8Array(width * height * 4)
  const g = (i: number) => { const v = data[i]; return (Number.isFinite(v) && v > -500 && v < 9000) ? v : 0 }

  for (let y = 0; y < height; y++) {
    const yPrev = Math.max(0, y - 1) * width
    const yNext = Math.min(height - 1, y + 1) * width
    const yCurr = y * width

    for (let x = 0; x < width; x++) {
      const xPrev = Math.max(0, x - 1)
      const xNext = Math.min(width - 1, x + 1)

      // Gradient horizontal (dz/dx) et vertical (dz/dy) par différences finies
      const dzdx = (g(yCurr + xNext) - g(yCurr + xPrev)) * strength
      const dzdy = (g(yNext + x) - g(yPrev + x)) * strength

      // Normale en tangent-space : X = -dzdx, Y = -dzdy, Z = 1.0 (haut)
      const nx = -dzdx
      const ny = -dzdy
      const nz = 1.0

      const len = Math.hypot(nx, ny, nz)
      const nXNorm = nx / len
      const nYNorm = ny / len
      const nZNorm = nz / len

      // Encodage standard Three.js : [-1, 1] -> [0, 255]
      // R = X (tangente), G = Y (bitangente), B = Z (normale)
      const idx = (y * width + x) * 4
      normals[idx] = ((nXNorm * 0.5 + 0.5) * 255) | 0
      normals[idx + 1] = ((nYNorm * 0.5 + 0.5) * 255) | 0
      normals[idx + 2] = ((nZNorm * 0.5 + 0.5) * 255) | 0
      normals[idx + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(normals, width, height, THREE.RGBAFormat)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true

  return texture
}

// Jupe de terrain : ferme les bords du maillage principal par une bande extrudée vers le bas,
// pour masquer le vide visible sous la montagne quand la caméra passe sous l'horizon du plan.
function addTerrainSkirt(geom: THREE.PlaneGeometry, depth = 400): THREE.Mesh {
  const pos = geom.attributes.position
  const res = Math.round(Math.sqrt(pos.count)) // GEOM_RES : grille carrée
  const skirtPositions: number[] = []
  const skirtIndices: number[] = []

  function pushQuad(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const base = skirtPositions.length / 3
    skirtPositions.push(ax, ay, az, bx, by, bz, bx, -depth, bz, ax, -depth, az)
    skirtIndices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }

  function edgeQuad(i0: number, i1: number) {
    pushQuad(
      pos.getX(i0), pos.getY(i0), pos.getZ(i0),
      pos.getX(i1), pos.getY(i1), pos.getZ(i1)
    )
  }

  // Parcourt les 4 bordures de la grille dans l'ordre, pour fermer un anneau continu.
  for (let ix = 0; ix < res - 1; ix++) edgeQuad(ix, ix + 1) // haut, gauche -> droite
  for (let iz = 0; iz < res - 1; iz++) edgeQuad(iz * res + (res - 1), (iz + 1) * res + (res - 1)) // droite, haut -> bas
  for (let ix = res - 1; ix > 0; ix--) edgeQuad((res - 1) * res + ix, (res - 1) * res + (ix - 1)) // bas, droite -> gauche
  for (let iz = res - 1; iz > 0; iz--) edgeQuad(iz * res, (iz - 1) * res) // gauche, bas -> haut

  const skirtGeom = new THREE.BufferGeometry()
  skirtGeom.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3))
  skirtGeom.setIndex(skirtIndices)
  skirtGeom.computeVertexNormals()

  const skirtMat = new THREE.MeshStandardMaterial({ color: '#4a3c30', roughness: 1, metalness: 0, side: THREE.DoubleSide })
  const skirt = new THREE.Mesh(skirtGeom, skirtMat)
  skirt.receiveShadow = true
  return skirt
}

async function main() {

  const [ortho, elevGrid] = await Promise.all([fetchOrthoGrid(), fetchElevationGrid()])
  const orthoCanvas = ortho.canvas
  inpaintOrthoHoles(orthoCanvas, ortho.ok, ortho.cols, ortho.rows) // (2) comble les tuiles absentes

  function elevAtPixel(px: number, py: number): number {
    px = Math.max(0, Math.min(elevGrid.width - 1, px))
    py = Math.max(0, Math.min(elevGrid.height - 1, py))
    const v = elevGrid.data[py * elevGrid.width + px]
    // nodata résiduel (tuile mer non comblée au-delà du plafond BFS) : soit NaN, soit la
    // SENTINELLE RGE ALTI (-99999, finie mais absurde). Hors de la plage réelle du relief de
    // France [-500, 9000] m -> 0. Sinon un point du tracé qui tombe dessus (ou son voisinage
    // bilinéaire) propage une valeur énorme dans les courbes -> segments de ruban qui partent
    // à l'infini (les "lignes oranges" / quadrillage).
    return (Number.isFinite(v) && v > -500 && v < 9000) ? v : 0
  }

  function elevBilinear(px: number, py: number): number {
    const x0 = Math.floor(px), y0 = Math.floor(py)
    const fx = px - x0, fy = py - y0
    const a = elevAtPixel(x0, y0), b = elevAtPixel(x0 + 1, y0)
    const c = elevAtPixel(x0, y0 + 1), d = elevAtPixel(x0 + 1, y0 + 1)
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
  }

  function elevAtLonLat(lon: number, lat: number): number {
    const [px, py] = elevPixelForLonLat(lon, lat)
    return elevBilinear(px, py)
  }

  // --- Scène & Rendu Three.js ---
  const app = document.getElementById('app')!
  const scene = new THREE.Scene()
  // Voile atmosphérique léger (les bords du maillage sont surtout estompés par le fondu alpha
  // du terrain, voir plus bas) ; l'horizon fond dans le bas du dégradé de ciel.
  scene.fog = new THREE.FogExp2('#d8e8f5', 0.00024) // estompe le bord du maillage dans la brume

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 50000)
  // Calque 1 = objets exclus de la caméra de réflexion du Water (elle ne rend que le calque 0).
  // Le ruban, son fil, les marqueurs et les panneaux y sont placés : sinon leur reflet flottant
  // au-dessus de l'eau apparaît comme des traits verts/oranges qui "traînent" sur la mer.
  const NO_REFLECT_LAYER = 1
  camera.layers.enable(NO_REFLECT_LAYER)
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(1) // bloqué à 1:1 natif : le post-processing (bloom) en 1.5x/2x plombait le FPS

  // Tone mapping ACES Filmic & espace sRGB
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.9 // évite que le ciel HDR sature vers le blanc

  // Ombres coupées : test pour isoler si c'est bien leur coût qui plombe le FPS malgré les
  // optimisations précédentes (PCF simple, shadow map 1024, terrain.castShadow=false). Les
  // lignes castShadow/receiveShadow des objets sont laissées en l'état, elles ne coûtent rien
  // tant que shadowMap.enabled est false.
  renderer.shadowMap.enabled = false
  app.appendChild(renderer.domElement)

  // Le bloom (UnrealBloomPass) a été retiré après diagnostic (voir historique de commits) :
  // dès que le ciel HDR couvrait une large portion de l'écran, il saturait toute la zone en
  // blanc. EffectComposer n'a donc plus d'utilité ici — render() direct, ça évite un aller-
  // retour render-to-texture + passe de copie à chaque frame pour rien.

  // Ciel : dégradé de bleu vertical (le shader Sky procédural saturait vers le blanc). Le bas du
  // dégradé rejoint la couleur du brouillard pour que l'horizon se fonde.
  void Sky
  {
    const g = document.createElement('canvas')
    g.width = 4; g.height = 256
    const gx = g.getContext('2d')!
    const grad = gx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#96c1e1') // zénith : bleu clair
    grad.addColorStop(0.55, '#bcd7ee')
    grad.addColorStop(1, '#d8e8f5') // horizon : quasi blanc bleuté, rejoint le brouillard
    gx.fillStyle = grad
    gx.fillRect(0, 0, 4, 256)
    const skyTex = new THREE.CanvasTexture(g)
    skyTex.colorSpace = THREE.SRGBColorSpace
    scene.background = skyTex
  }

  // Élévation du soleil dérivée de l'heure du scénario météo. Azimut laissé fixe.
  const sunPosition = new THREE.Vector3()
  const elevation = sunElevationForHour(WEATHER_SCENARIO.hourOfDay)
  const azimuth = -140
  const phi = THREE.MathUtils.degToRad(90 - elevation)
  const theta = THREE.MathUtils.degToRad(azimuth)
  sunPosition.setFromSphericalCoords(1, phi, theta)

  const cc = WEATHER_SCENARIO.cloudCover

  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    coreMat.resolution.set(w, h)
  })

  // --- Terrain ---
  const GEOM_RES = 180 // était 260 : la normal map dérivée du DEM compense le micro-relief perdu
  const [wx0] = project(covLonMin, lat0)
  const [wx1] = project(covLonMax, lat0)
  const [, wz0] = project(lon0, covLatMax)
  const [, wz1] = project(lon0, covLatMin)
  const worldW = wx1 - wx0
  const worldD = wz1 - wz0

  const geometry = new THREE.PlaneGeometry(worldW, worldD, GEOM_RES - 1, GEOM_RES - 1)
  geometry.rotateX(-Math.PI / 2)

  const posAttr = geometry.attributes.position
  const hasHoles = elevGrid.origBad.some(v => v)
  const vertBad = new Uint8Array(GEOM_RES * GEOM_RES)
  let minElev = Infinity
  let minElevValid = Infinity // min sur les seuls sommets à donnée IGN réelle (pour détecter le littoral)
  for (let iz = 0; iz < GEOM_RES; iz++) {
    for (let ix = 0; ix < GEOM_RES; ix++) {
      const u = ix / (GEOM_RES - 1)
      const v = iz / (GEOM_RES - 1)
      const lon = covLonMin + u * (covLonMax - covLonMin)
      const lat = covLatMax - v * (covLatMax - covLatMin)
      const elev = elevAtLonLat(lon, lat)
      minElev = Math.min(minElev, elev)
      posAttr.setY(iz * GEOM_RES + ix, elev)
      let isBad = 0
      if (hasHoles) {
        const [px, py] = elevPixelForLonLat(lon, lat)
        const gx = Math.max(0, Math.min(elevGrid.width - 1, Math.round(px)))
        const gy = Math.max(0, Math.min(elevGrid.height - 1, Math.round(py)))
        isBad = elevGrid.origBad[gy * elevGrid.width + gx]
        vertBad[iz * GEOM_RES + ix] = isBad
      }
      if (!isBad) minElevValid = Math.min(minElevValid, elev)
    }
  }

  // Tracé côtier = (a) l'IGN n'a pas de donnée sur une part notable de l'emprise (la mer),
  // (b) le TRACÉ LUI-MÊME descend au niveau de la mer -> le randonneur marche au bord de l'eau.
  // Sans (b), une simple bbox qui effleure la côte (tracé sur un plateau à l'intérieur) donnait
  // l'océan tout autour et l'impression d'être sur une île.
  const seaBadFrac = elevGrid.origBad.reduce((s: number, v: number) => s + v, 0) / elevGrid.origBad.length
  let trailMinElev = Infinity
  for (const [lon, lat] of TRAIL) trailMinElev = Math.min(trailMinElev, elevAtLonLat(lon, lat))
  const isCoastal = hasHoles && seaBadFrac > 0.02 && trailMinElev < 12

  // Sur un tracé côtier : les sommets sans donnée (mer : tuile absente OU altitude <= 0) sont
  // enfoncés bien sous le niveau 0. Le maillage n'est PAS découpé -> pas d'escalier en dents de
  // scie le long de la côte ; l'océan (opaque, ~1 m sous 0) recouvre toute cette zone enfoncée
  // et le trait de côte devient la ligne où le vrai relief croise le plan d'eau (lisse,
  // interpolée dans la maille, pas calée sur la grille).
  const SEA_SINK = minElev - 25
  if (isCoastal) {
    for (let i = 0; i < posAttr.count; i++) {
      if (vertBad[i]) posAttr.setY(i, SEA_SINK)
    }
    minElev = SEA_SINK
  }

  for (let i = 0; i < posAttr.count; i++) posAttr.setY(i, posAttr.getY(i) - minElev)
  posAttr.needsUpdate = true

  // Altitude du plan d'eau (repère local) : ~1 m sous le 0 absolu.
  const seaLocalY = -minElev - 1

  // Côtier : on ne fond QUE la lèvre au niveau de l'eau (là où le terrain perce le plan d'eau et
  // fait scintiller), et on garde la PLAGE opaque. Alpha : 0 à ~1 m sous l'eau -> 1 dès
  // BEACH_KEEP m au-dessus. Le bas de l'estran reste semi-transparent (sable mouillé), la plage
  // sèche et la dune sont pleinement visibles, et il n'y a plus d'arête franche à faire vibrer.
  if (isCoastal) {
    const FADE_LOW = seaLocalY - 1 // alpha 0 en dessous
    const BEACH_KEEP = 3 // m au-dessus de l'eau à partir desquels le terrain est opaque (plage visible)
    const col = new Float32Array(posAttr.count * 4)
    for (let i = 0; i < posAttr.count; i++) {
      const s = Math.max(0, Math.min(1, (posAttr.getY(i) - FADE_LOW) / (BEACH_KEEP + 1)))
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1
      col[i * 4 + 3] = s * s * (3 - 2 * s) // smoothstep
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 4))
  }

  // Hauteur du maillage RENDU (grille GEOM_RES, interpolée) en un point monde x,z : c'est contre
  // cette surface — pas le DEM pleine résolution, qui diffère de dizaines de mètres sur les
  // pentes — qu'on cale le ruban pour l'anti-collision.
  const meshY = new Float32Array(GEOM_RES * GEOM_RES)
  for (let i = 0; i < meshY.length; i++) meshY[i] = posAttr.getY(i)
  function meshHeightAt(wx: number, wz: number): number {
    const gx = Math.max(0, Math.min(GEOM_RES - 1, ((wx + worldW / 2) / worldW) * (GEOM_RES - 1)))
    const gz = Math.max(0, Math.min(GEOM_RES - 1, ((wz + worldD / 2) / worldD) * (GEOM_RES - 1)))
    const ix0 = gx | 0, iz0 = gz | 0
    const ix1 = Math.min(GEOM_RES - 1, ix0 + 1), iz1 = Math.min(GEOM_RES - 1, iz0 + 1)
    const fx = gx - ix0, fz = gz - iz0
    const a = meshY[iz0 * GEOM_RES + ix0], b = meshY[iz0 * GEOM_RES + ix1]
    const c = meshY[iz1 * GEOM_RES + ix0], d = meshY[iz1 * GEOM_RES + ix1]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz
  }

  // (1) Coupe le maillage là où il n'y a pas de donnée : on retire les cellules dont les 4
  // sommets sont sans relief IGN. En côtier on NE coupe PAS (les sommets "mer" ont été enfoncés
  // plus haut et l'océan les recouvre) -> pas de bord en dents de scie sur la grille.
  if (hasHoles && !isCoastal) {
    const idx: number[] = []
    for (let iz = 0; iz < GEOM_RES - 1; iz++) {
      for (let ix = 0; ix < GEOM_RES - 1; ix++) {
        const A = iz * GEOM_RES + ix
        const B = (iz + 1) * GEOM_RES + ix
        const C = (iz + 1) * GEOM_RES + ix + 1
        const D = iz * GEOM_RES + ix + 1
        if (vertBad[A] && vertBad[B] && vertBad[C] && vertBad[D]) continue
        idx.push(A, B, D, B, C, D)
      }
    }
    geometry.setIndex(idx)
  }
  geometry.computeVertexNormals()

  gradeTerrainColors(orthoCanvas)
  // Eau peinte APRÈS le grade (sinon le boost vert la reteinte) et avant la texture GPU. Les
  // features sont récupérées une fois puis réutilisées pour les tuiles du corridor de détail.
  const hydro = await fetchHydroFeatures(covLonMin, covLonMax, covLatMin, covLatMax)
  paintHydroOnCanvas(orthoCanvas, hydro, covLonMin, covLonMax, covLatMin, covLatMax)

  const orthoTexture = new THREE.CanvasTexture(orthoCanvas)
  orthoTexture.colorSpace = THREE.SRGBColorSpace
  orthoTexture.wrapS = THREE.ClampToEdgeWrapping
  orthoTexture.wrapT = THREE.ClampToEdgeWrapping
  // Vue rasante du survol : le sol loin du centre est très minifié -> le filtrage anisotrope
  // (au lieu du trilinéaire par défaut, aniso = 1) restitue beaucoup de netteté sans coût mémoire.
  orthoTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

  // Normal map dérivée du relief RGE ALTI, pour du micro-relief sans alourdir la géométrie
  const terrainNormalMap = generateNormalMapFromDEM(elevGrid, 1.8)

  const terrainMat = new THREE.MeshStandardMaterial({
    map: orthoTexture,
    normalMap: terrainNormalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.97,
    metalness: 0.0,
    // côtier : alpha par sommet (fondu du bord de plage). depthWrite off -> pas de "marche"
    // de profondeur laissée par la frange quasi transparente ; sans danger ici, le littoral
    // est plat (rien derrière un relief à masquer).
    ...(isCoastal ? { vertexColors: true, transparent: true, depthWrite: false } : {}),
  })
  const terrain = new THREE.Mesh(geometry, terrainMat)
  terrain.receiveShadow = true
  terrain.castShadow = false // le terrain ne s'auto-rend pas dans le shadow map : gain majeur
  if (isCoastal) terrain.renderOrder = 1 // après l'océan -> la frange se dégrade par-dessus l'eau
  scene.add(terrain)

  scene.add(addTerrainSkirt(geometry, 400))

  // Vue mer : océan animé (three/examples Water — reflet de la scène + normal map qui ondule) à
  // la place du dégradé de ciel qui remplissait le vide au-delà du trait de côte. Les sommets
  // "mer" du terrain ont été enfoncés bien plus bas -> l'océan (opaque) recouvre toute la zone.
  let water: Water | null = null
  if (isCoastal) {
    const span = Math.min(40000, Math.max(worldW, worldD) * 4)
    const waterNormals = new THREE.TextureLoader().load(waterNormalsUrl, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    })
    water = new Water(new THREE.PlaneGeometry(span, span), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: sunPosition.clone().normalize(),
      sunColor: 0xffeeda, // même teinte chaude que le directionnel d'après-midi
      waterColor: 0x274b57, // bleu-vert profond, s'éclaircit vers l'horizon avec le brouillard
      distortionScale: 2.6, // mer plutôt calme (défaut 20 = très agitée)
      fog: scene.fog !== undefined,
    })
    water.rotation.x = -Math.PI / 2
    water.position.y = seaLocalY
    // L'océan (opaque) est dessiné en premier ; le terrain côtier (renderOrder 1, frange en
    // transparence) se dégrade par-dessus -> aucune arête franche, plus de scintillement.
    water.renderOrder = 0
    scene.add(water)
    console.info(`[proto] tracé côtier -> océan animé (nodata ${(seaBadFrac * 100).toFixed(0)} %, alt. mini tracé ${trailMinElev.toFixed(0)} m)`)
  }

  // --- Patchs de détail (Départ / Arrivée) ---
  const DETAIL_ZOOM = 18 // ~0,6 m/px, bien plus fin que le fond (z15) ; 2 patchs seulement -> léger
  const DETAIL_RADIUS = 320 // m autour du point (le fondu radial n'utilise que ~90% du rayon)
  const DETAIL_RES = 90

  async function buildDetailPatch(lon: number, lat: number): Promise<THREE.Mesh> {
    const r = computeMercatorRange(lon, lat, DETAIL_RADIUS, DETAIL_ZOOM)
    const patchCanvas = (await fetchOrthoTiles(r.txMinP, r.tyMinP, r.nxP, r.nyP, DETAIL_ZOOM)).canvas
    gradeTerrainColors(patchCanvas)
    paintHydroOnCanvas(patchCanvas, hydro, r.covLonMinP, r.covLonMaxP, r.covLatMinP, r.covLatMaxP)
    const tex = new THREE.CanvasTexture(patchCanvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()

    // Estompe le patch en DISQUE (fondu radial depuis le centre) et non par bord carré : c'est
    // le bord rectangulaire net-sur-flou qui se voyait comme un "rectangle flou" sous le panneau.
    // alpha = 1 au centre -> 0 avant d'atteindre le bord, donc aucun coin visible.
    const FADE_IN = 0.35 // rayon normalisé (0=centre, 1=milieu de bord) où l'alpha commence à descendre
    const FADE_OUT = 0.92 // rayon normalisé où l'alpha atteint 0
    const positions: number[] = []
    const uvs: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    for (let iz = 0; iz < DETAIL_RES; iz++) {
      for (let ix = 0; ix < DETAIL_RES; ix++) {
        const u = ix / (DETAIL_RES - 1)
        const v = iz / (DETAIL_RES - 1)
        const plon = r.covLonMinP + u * (r.covLonMaxP - r.covLonMinP)
        const plat = r.covLatMaxP - v * (r.covLatMaxP - r.covLatMinP)
        const [x, z] = project(plon, plat)
        const y = elevAtLonLat(plon, plat) - minElev
        positions.push(x, y, z)
        uvs.push(u, v)

        const rad = Math.hypot(u - 0.5, v - 0.5) / 0.5 // 0 au centre, 1 au milieu d'un bord
        const s = Math.max(0, Math.min(1, (rad - FADE_IN) / (FADE_OUT - FADE_IN)))
        const alpha = 1 - s * s * (3 - 2 * s) // smoothstep décroissant
        colors.push(1, 1, 1, alpha)
      }
    }
    for (let iz = 0; iz < DETAIL_RES - 1; iz++) {
      for (let ix = 0; ix < DETAIL_RES - 1; ix++) {
        const a = iz * DETAIL_RES + ix
        const b = a + 1
        const c = a + DETAIL_RES
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
    geom.setIndex(indices)
    geom.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexColors: true,
      transparent: true,
      depthWrite: false, // évite le tri de transparence contre le terrain sous le patch
    })
    const patchMesh = new THREE.Mesh(geom, mat)
    patchMesh.receiveShadow = true
    return patchMesh
  }

  // Patchs de détail départ/arrivée retirés : à chaque essai ils créaient des artefacts (carré
  // visible net-sur-flou, disque sombre sur une zone d'ortho dégradée, rendu bizarre sur relief
  // pentu). buildDetailPatch est conservé pour un éventuel usage futur. Le rapprochement caméra
  // à l'intro / l'arrivée (introRiseK, arrivalZoomK) est gardé.
  void buildDetailPatch

  // --- Tracé GPX (ruban émissif) ---
  function unproject(x: number, z: number): [number, number] {
    return [x / M_PER_DEG_LON + lon0, -z / M_PER_DEG_LAT + lat0]
  }

  function smoothTrail(points: [number, number][], iterations = 5, radius = 4): [number, number][] {
    const n = points.length
    let lons = points.map(p => p[0])
    let lats = points.map(p => p[1])
    for (let iter = 0; iter < iterations; iter++) {
      const newLons = lons.slice()
      const newLats = lats.slice()
      for (let i = 1; i < n - 1; i++) {
        let sumLon = 0, sumLat = 0, wSum = 0
        for (let k = -radius; k <= radius; k++) {
          const j = i + k
          if (j < 0 || j >= n) continue
          const w = radius + 1 - Math.abs(k)
          sumLon += lons[j] * w
          sumLat += lats[j] * w
          wSum += w
        }
        newLons[i] = sumLon / wSum
        newLats[i] = sumLat / wSum
      }
      lons = newLons
      lats = newLats
    }
    return lons.map((lon, i) => [lon, lats[i]] as [number, number])
  }

  // Une CatmullRom à travers un virage en épingle (le tracé descend à la plage puis fait
  // demi-tour) OVERSHOOTE : la spline bulge au-delà du virage. Si l'épingle est au bord de
  // l'eau, le bulge part au large -> un ou deux échantillons du ruban se retrouvent en mer =
  // les segments verts/oranges qui traînent sur la mer. On borne donc chaque échantillon à
  // MAX_DEV mètres de la polyligne source (les vrais points GPX lissés), ce qui écrête ces
  // pointes sans toucher aux portions normales.
  function clampToPolyline(x: number, z: number, poly: THREE.Vector3[], maxDev: number): [number, number] {
    let bx = poly[0].x, bz = poly[0].z, bd = Infinity
    for (let i = 1; i < poly.length; i++) {
      const ax = poly[i - 1].x, az = poly[i - 1].z
      const ex = poly[i].x - ax, ez = poly[i].z - az
      const l2 = ex * ex + ez * ez || 1
      let u = ((x - ax) * ex + (z - az) * ez) / l2
      u = u < 0 ? 0 : u > 1 ? 1 : u
      const cx = ax + u * ex, cz = az + u * ez
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz)
      if (d < bd) { bd = d; bx = cx; bz = cz }
    }
    const dist = Math.sqrt(bd)
    if (dist <= maxDev) return [x, z]
    const k = maxDev / dist
    return [bx + (x - bx) * k, bz + (z - bz) * k]
  }

  // Lissage du ruban très réduit (défaut 5/4) -> le ruban colle au plus près du vrai tracé GPX.
  const rawPts: THREE.Vector3[] = smoothTrail(TRAIL, 2, 2).map(([lon, lat]) => {
    const [x, z] = project(lon, lat)
    const y = elevAtLonLat(lon, lat) - minElev
    return new THREE.Vector3(x, y, z)
  })
  const shapeCurve = new THREE.CatmullRomCurve3(rawPts)

  const RESAMPLE_COUNT = 500
  const trailPts: THREE.Vector3[] = []
  for (let i = 0; i <= RESAMPLE_COUNT; i++) {
    const s = shapeCurve.getPointAt(i / RESAMPLE_COUNT)
    const [x, z] = clampToPolyline(s.x, s.z, rawPts, 20)
    const [lon, lat] = unproject(x, z)
    const y = elevAtLonLat(lon, lat) - minElev + 3.5
    trailPts.push(new THREE.Vector3(x, y, z))
  }
  const curve = new THREE.CatmullRomCurve3(trailPts)

  // Courbe dédiée à la caméra, beaucoup plus lissée que le tracé réel (ribbon/curve) : la
  // caméra suit un chemin plus "propre" avec moins de petits virages, pendant que le ruban
  // continue lui de refléter fidèlement le vrai tracé. Découple le confort de vue du détail
  // géométrique du parcours.
  const cameraRawPts: THREE.Vector3[] = smoothTrail(TRAIL, 10, 14).map(([lon, lat]) => {
    const [x, z] = project(lon, lat)
    const y = elevAtLonLat(lon, lat) - minElev
    return new THREE.Vector3(x, y, z)
  })
  const cameraShapeCurve = new THREE.CatmullRomCurve3(cameraRawPts)
  const CAMERA_RESAMPLE_COUNT = 150 // bien moins de points que trailPts -> chemin plus lisse
  const cameraPts: THREE.Vector3[] = []
  for (let i = 0; i <= CAMERA_RESAMPLE_COUNT; i++) {
    const s = cameraShapeCurve.getPointAt(i / CAMERA_RESAMPLE_COUNT)
    const [x, z] = clampToPolyline(s.x, s.z, cameraRawPts, 45)
    const [lon, lat] = unproject(x, z)
    const y = elevAtLonLat(lon, lat) - minElev + 3.5
    cameraPts.push(new THREE.Vector3(x, y, z))
  }
  const cameraCurve = new THREE.CatmullRomCurve3(cameraPts)

  // Distance réelle du tracé (mètres), pour l'indicateur "X km" affiché pendant le survol
  const distSegments: number[] = [0]
  for (let i = 1; i < trailPts.length; i++) distSegments.push(distSegments[i - 1] + trailPts[i].distanceTo(trailPts[i - 1]))
  const TOTAL_DISTANCE_M = distSegments[distSegments.length - 1]

  // --- Profil de vitesse selon la pente : le survol ralentit dans les montées raides et
  // accélère sur le plat, à durée totale (DURATION) constante. On échantillonne la pente le long
  // de `curve`, on la lisse, on pondère le "coût de temps" de chaque pas par (1 + k·pente),
  // puis on inverse le cumul -> table t(progression linéaire).
  const SLOPE_SLOWDOWN = 2.2 // 0 = vitesse constante ; plus haut = ralentit davantage en côte
  const SLOPE_REF = 12 // % de pente donnant un coût de +1 (au-delà : clampé à SLOPE_CAP)
  const SLOPE_CAP = 3 // multiplicateur de coût max pour une pente
  const slopeRemap: number[] = (() => {
    const S = 400 // échantillons de pente
    const _pa = new THREE.Vector3(), _pb = new THREE.Vector3()
    const slope: number[] = []
    for (let i = 0; i <= S; i++) {
      const u = i / S
      curve.getPointAt(Math.max(0, u - 0.004), _pa)
      curve.getPointAt(Math.min(1, u + 0.004), _pb)
      const dxz = Math.hypot(_pb.x - _pa.x, _pb.z - _pa.z) || 1e-6
      slope.push((Math.abs(_pb.y - _pa.y) / dxz) * 100)
    }
    // lissage (moyenne glissante ±3)
    const sm = slope.slice()
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= S; i++) {
        let acc = 0, n = 0
        for (let k = -3; k <= 3; k++) { const j = i + k; if (j < 0 || j > S) continue; acc += sm[j]; n++ }
        sm[i] = acc / n
      }
    }
    // coût cumulé
    const cost: number[] = [0]
    for (let i = 1; i <= S; i++) {
      const w = 1 + SLOPE_SLOWDOWN * Math.min(SLOPE_CAP, sm[i] / SLOPE_REF)
      cost.push(cost[i - 1] + w)
    }
    const total = cost[S]
    // table inverse : pour REMAP+1 valeurs de progression linéaire p, le paramètre de courbe t
    const REMAP = 256
    const table: number[] = []
    let j = 0
    for (let r = 0; r <= REMAP; r++) {
      const target = (r / REMAP) * total
      while (j < S && cost[j + 1] < target) j++
      const span = cost[j + 1] - cost[j] || 1
      table.push((j + (target - cost[j]) / span) / S)
    }
    return table
  })()
  function slopeRemapT(p: number): number {
    const x = Math.max(0, Math.min(1, p)) * (slopeRemap.length - 1)
    const i = Math.floor(x)
    if (i + 1 >= slopeRemap.length) return slopeRemap[slopeRemap.length - 1]
    const f = x - i
    return slopeRemap[i] * (1 - f) + slopeRemap[i + 1] * f
  }

  // Dégradé de la charte Sillon (vert -> orangé -> crème), répété en boucle sur toute la
  // longueur du tracé plutôt qu'un dégradé unique départ->arrivée.
  const BRAND_GREEN = new THREE.Color('#3E9E68') // éclairci : le vert foncé d'origine se perdait sur l'ortho
  const BRAND_ORANGE = new THREE.Color('#D97A3D')
  const BRAND_CREAM = new THREE.Color('#F4EDE0')
  const GRADIENT_REPEATS = 8 // nombre de cycles vert/orangé/crème sur tout le tracé
  function cyclicBrandColor(t: number): THREE.Color {
    const p = (t * GRADIENT_REPEATS) % 1
    let c: THREE.Color
    if (p < 1 / 3) c = BRAND_GREEN.clone().lerp(BRAND_ORANGE, p * 3)
    else if (p < 2 / 3) c = BRAND_ORANGE.clone().lerp(BRAND_CREAM, (p - 1 / 3) * 3)
    else c = BRAND_CREAM.clone().lerp(BRAND_GREEN, (p - 2 / 3) * 3) // reboucle vers le vert
    // Ruban plus lisible sur l'ortho : on pousse la saturation et on remonte un peu la
    // luminosité pour que la couleur ressorte même sous une lumière rasante.
    return c.offsetHSL(0, 0.28, 0.05)
  }

  const RIBBON_SEGMENTS = 1600
  const RIBBON_WIDTH = 10 // largeur du ruban en unités monde (était 4.5)
  const RIBBON_CLEARANCE = 3 // hauteur mini du ruban au-dessus de la SURFACE RENDUE
  // Anti-collision : chaque BORD du ruban est calé au-dessus du maillage rendu SOUS CE BORD, et
  // on échantillonne aussi quelques points intermédiaires le long du segment pour attraper une
  // bosse entre deux sections. En dévers, le bord amont remonte -> le ruban s'incline avec la
  // pente sans jamais s'enfoncer.
  const ribbonPositions: number[] = []
  const ribbonColors: number[] = []
  const ribbonIndices: number[] = []
  // Fil central à largeur ÉCRAN constante (Line2) : superposé au ruban, il garde le tracé
  // visible même quand la caméra est loin et que le ruban plat se réduit à un cheveu.
  const corePositions: number[] = []
  const coreColors: number[] = []
  // Garde-fous contre une géométrie de courbe dégénérée (points GPX confondus, aller-retours,
  // boucle départ=arrivée) : une tangente nulle -> right = NaN -> sommet de ruban à l'infini.
  // On réutilise alors le dernier "right"/point valide.
  const _p = new THREE.Vector3()
  const _tan = new THREE.Vector3()
  let lastRX = RIBBON_WIDTH / 2, lastRZ = 0
  let lastPx = 0, lastPy = 0, lastPz = 0
  curve.getPointAt(0, _p)
  if (Number.isFinite(_p.x)) { lastPx = _p.x; lastPy = _p.y; lastPz = _p.z }
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS
    curve.getPointAt(t, _p)
    curve.getTangentAt(t, _tan)
    const px = Number.isFinite(_p.x) ? _p.x : lastPx
    const py = Number.isFinite(_p.y) ? _p.y : lastPy
    const pz = Number.isFinite(_p.z) ? _p.z : lastPz
    lastPx = px; lastPy = py; lastPz = pz
    let rX = -_tan.z, rZ = _tan.x
    const rl = Math.sqrt(rX * rX + rZ * rZ)
    if (Number.isFinite(rl) && rl > 1e-5) {
      rX = (rX / rl) * (RIBBON_WIDTH / 2); rZ = (rZ / rl) * (RIBBON_WIDTH / 2)
      lastRX = rX; lastRZ = rZ
    } else { rX = lastRX; rZ = lastRZ }
    const lx = px + rX, lz = pz + rZ
    const rx = px - rX, rz = pz - rZ
    // relief max sous toute la largeur du ruban (axe + bords + 2 quarts)
    let gmax = -Infinity
    for (let k = -2; k <= 2; k++) {
      const f = k / 4 // -0.5..0.5
      const h = meshHeightAt(px + rX * f * 2, pz + rZ * f * 2)
      if (h > gmax) gmax = h
    }
    const yTop = Math.max(py, gmax + RIBBON_CLEARANCE)
    const ly = Math.max(yTop, meshHeightAt(lx, lz) + RIBBON_CLEARANCE)
    const ry = Math.max(yTop, meshHeightAt(rx, rz) + RIBBON_CLEARANCE)
    ribbonPositions.push(lx, ly, lz, rx, ry, rz)
    const c = cyclicBrandColor(t)
    ribbonColors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    corePositions.push(px, Math.max(yTop, ly, ry) + 1.2, pz)
    coreColors.push(c.r, c.g, c.b)
    if (i < RIBBON_SEGMENTS) {
      const i0 = i * 2, i1 = i * 2 + 1, i2 = i * 2 + 2, i3 = i * 2 + 3
      ribbonIndices.push(i0, i2, i1, i1, i2, i3)
    }
  }
  const ribbonGeom = new THREE.BufferGeometry()
  ribbonGeom.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3))
  ribbonGeom.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3))
  ribbonGeom.setIndex(ribbonIndices)
  ribbonGeom.computeVertexNormals()
  ribbonGeom.setDrawRange(0, 6)

  const ribbonMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.22, // plus brillant -> le ruban accroche la lumière et ressort mieux
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat)
  ribbonMesh.layers.set(NO_REFLECT_LAYER)
  scene.add(ribbonMesh)

  const coreGeom = new LineGeometry()
  coreGeom.setPositions(corePositions)
  coreGeom.setColors(coreColors)
  const coreMat = new LineMaterial({
    vertexColors: true,
    worldUnits: false, // linewidth exprimé en PIXELS -> épaisseur constante à l'écran
    linewidth: 3.2,
    alphaToCoverage: false,
    transparent: true,
    opacity: 0.95,
  })
  coreMat.resolution.set(window.innerWidth, window.innerHeight)
  const ribbonCore = new Line2(coreGeom, coreMat)
  ribbonCore.renderOrder = 2
  ribbonCore.frustumCulled = false
  ribbonCore.layers.set(NO_REFLECT_LAYER)
  coreGeom.instanceCount = 1 // révélé progressivement, comme le ruban (setDrawRange)
  scene.add(ribbonCore)

  // Marqueurs départ / arrivée
  const markerGeom = new THREE.SphereGeometry(6, 24, 24)
  const startMarker = new THREE.Mesh(
    markerGeom,
    new THREE.MeshStandardMaterial({ color: '#38ef7d', emissive: '#25f47c', emissiveIntensity: 2.0 })
  )
  startMarker.position.copy(trailPts[0])
  startMarker.layers.set(NO_REFLECT_LAYER)
  scene.add(startMarker)

  const endMarker = new THREE.Mesh(
    markerGeom,
    new THREE.MeshStandardMaterial({ color: '#ff416c', emissive: '#ff1d53', emissiveIntensity: 2.0 })
  )
  endMarker.position.copy(trailPts[trailPts.length - 1])
  endMarker.layers.set(NO_REFLECT_LAYER)
  scene.add(endMarker)

  // --- Panneaux de localité/col (même principe que le choix des panneaux du film 2D) ---
  // Sprite = billboard qui fait toujours face à la caméra, le plus simple pour du texte lisible
  // en survol. Chaque panneau se déclenche quand la progression du survol (t) approche le point
  // du tracé le plus proche du panneau, et reste affiché un court instant (comme PANEL_FRAMES
  // dans filmExport.ts).
  // Même charte que les panneaux 2D (drawInfoBoard dans filmExport.ts / TrackMap.tsx) :
  // lieudit = fond orange italique, col = fond vert avec altitude, standard = fond blanc,
  // bordure rouge, texte majuscule — juste redessiné à plus haute résolution pour la 3D.
  function panelTexture(name: string, style: 'lieudit' | 'col' | 'standard', ele?: number): THREE.CanvasTexture {
    const SCALE = 6
    const FONT_SIZE = 15 * SCALE
    const PAD_X = 12 * SCALE, PAD_Y = 6 * SCALE
    const BORDER = 3.5 * SCALE, RADIUS = 7 * SCALE
    const POLE_W = 6 * SCALE, POLE_H = 34 * SCALE
    const MARGIN = 20 * SCALE

    const isLieudit = style === 'lieudit'
    const isCol = style === 'col'
    const label = isLieudit ? name : name.toUpperCase()
    const fontStyle = isLieudit ? 'italic 800' : '800'
    const FONT = `${fontStyle} ${FONT_SIZE}px 'Arial Narrow', Arial, sans-serif`
    const FONT2 = `600 ${10 * SCALE}px 'Arial Narrow', Arial, sans-serif`

    const measure = document.createElement('canvas').getContext('2d')!
    measure.font = FONT
    const textW = measure.measureText(label).width
    const eleStr = isCol && ele != null ? `Alt. ${ele} m` : ''
    measure.font = FONT2
    const eleW = eleStr ? measure.measureText(eleStr).width : 0

    const boardW = Math.max(textW, eleW) + PAD_X * 2
    const boardH = isCol && eleStr ? FONT_SIZE + 12 * SCALE + PAD_Y * 2 : FONT_SIZE + PAD_Y * 2

    const c = document.createElement('canvas')
    c.width = boardW + MARGIN * 2
    c.height = boardH + POLE_H + MARGIN * 2
    const ctx = c.getContext('2d')!

    const px = c.width / 2
    const py = c.height - MARGIN
    const poleX = px - POLE_W / 2
    const poleY = py - POLE_H
    const boardX = px - boardW / 2
    const boardY = poleY - boardH

    const bgColor = isLieudit ? '#b84400' : isCol ? '#253d17' : '#fff'
    const textColor = isLieudit || isCol ? '#fff' : '#111'
    const borderColor = isLieudit || isCol ? 'transparent' : '#c0000c'

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 8 * SCALE
    ctx.shadowOffsetY = 3 * SCALE

    const grad = ctx.createLinearGradient(poleX, 0, poleX + POLE_W, 0)
    grad.addColorStop(0, '#888'); grad.addColorStop(0.5, '#ddd'); grad.addColorStop(1, '#888')
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.roundRect(poleX, poleY, POLE_W, POLE_H, [0, 0, 3 * SCALE, 3 * SCALE]); ctx.fill()

    if (borderColor !== 'transparent') {
      ctx.fillStyle = borderColor
      ctx.beginPath(); ctx.roundRect(boardX - BORDER, boardY - BORDER, boardW + BORDER * 2, boardH + BORDER * 2, RADIUS); ctx.fill()
    }
    ctx.fillStyle = bgColor
    ctx.beginPath(); ctx.roundRect(boardX, boardY, boardW, boardH, borderColor !== 'transparent' ? RADIUS - BORDER : RADIUS); ctx.fill()
    ctx.restore()

    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = FONT
    const textY = isCol && eleStr ? boardY + PAD_Y + FONT_SIZE / 2 : boardY + boardH / 2
    ctx.fillText(label, px, textY)
    if (eleStr) {
      ctx.font = FONT2
      ctx.fillText(eleStr, px, boardY + boardH - PAD_Y - (10 * SCALE) / 2)
    }

    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // La texture n'a plus un ratio fixe (largeur dépend du nom) : on dimensionne le sprite dans le
  // monde 3D à partir du ratio réel de la texture générée, pour une largeur de panneau constante.
  function sizeSpriteFromTexture(sprite: THREE.Sprite, tex: THREE.CanvasTexture, worldWidth = 200): void {
    const img = tex.image as HTMLCanvasElement
    sprite.scale.set(worldWidth, worldWidth * (img.height / img.width), 1)
  }


  const panelSprites: { sprite: THREE.Sprite; t: number }[] = PANELS.map(p => {
    // Point du tracé rééchantillonné le plus proche du panneau (comme le calcul de distance
    // minimale de LocalityEvent dans filmExport.ts)
    const [px, pz] = project(p.lon, p.lat)
    let bestI = 0, bestD = Infinity
    for (let i = 0; i < trailPts.length; i++) {
      const dx = trailPts[i].x - px, dz = trailPts[i].z - pz
      const d = dx * dx + dz * dz
      if (d < bestD) { bestD = d; bestI = i }
    }
    const anchor = trailPts[bestI]
    const tex = panelTexture(p.name, p.style, p.ele)
    renderer.initTexture(tex) // envoie la texture au GPU maintenant, pas au 1er frame visible
    // alphaTest : écarte le halo d'ombre quasi transparent autour du panneau (rectangle grisâtre
    // visible quand le fond est sombre, p. ex. la mer derrière un panneau côtier).
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, alphaTest: 0.4 })
    const sprite = new THREE.Sprite(mat)
    sizeSpriteFromTexture(sprite, tex, p.style === 'col' ? 280 : 200) // panneaux de col plus grands
    sprite.center.set(0.5, 0) // ancre le sprite par sa base (le pied du poteau), pas son centre
    sprite.position.set(anchor.x, anchor.y, anchor.z)
    sprite.visible = false
    sprite.layers.set(NO_REFLECT_LAYER) // pas de panneau reflété dans la mer
    scene.add(sprite)
    return { sprite, t: bestI / RESAMPLE_COUNT }
  })

  // Three.js n'envoie la texture d'un objet au GPU que lorsqu'il est rendu au moins une fois —
  // un sprite créé avec visible=false n'est jamais parcouru par le renderer, donc sa texture
  // (upload + génération des mipmaps) reste différée jusqu'à son 1er affichage. Comme ça tombait
  // pile au moment où chaque panneau devait apparaître pendant le survol, ça créait un gel
  // synchrone perceptible exactement à ces distances. renderer.initTexture() force l'envoi tout
  // de suite, pendant le chargement, au lieu d'en plein vol.
  function makeEndpointPanel(name: string, anchor: THREE.Vector3): THREE.Sprite {
    const tex = panelTexture(name, 'standard')
    renderer.initTexture(tex)
    // alphaTest : écarte le halo d'ombre quasi transparent autour du panneau (rectangle grisâtre
    // visible quand le fond est sombre, p. ex. la mer derrière un panneau côtier).
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, alphaTest: 0.4 })
    const sprite = new THREE.Sprite(mat)
    sizeSpriteFromTexture(sprite, tex)
    sprite.center.set(0.5, 0) // ancre le sprite par sa base (le pied du poteau), pas son centre
    sprite.position.set(anchor.x, anchor.y, anchor.z)
    sprite.visible = false
    sprite.layers.set(NO_REFLECT_LAYER)
    scene.add(sprite)
    return sprite
  }
  const departurePanel = makeEndpointPanel(DEPARTURE_NAME, trailPts[0])
  const arrivalPanel = makeEndpointPanel(ARRIVAL_NAME, trailPts[trailPts.length - 1])

  // --- Éclairage orienté d'après le soleil, modulé par la nébulosité du scénario météo ---
  // Ciel couvert : lumière plus diffuse (ambiante/hémisphérique montent) et moins directionnelle
  // (le soleil direct descend) — approxime l'effet d'un ciel nuageux sur l'éclairage ambiant.
  // Ambiance zénithale : la lumière globale diffuse (ambiante + hémisphérique) domine, le soleil
  // direct n'est qu'un léger modelé neutre — pas de rasant chaud.
  // Entre-deux : lumière globale diffuse encore dominante, mais on rend assez de modelé
  // directionnel pour que les ombres douces du relief brouillent la couture de la mosaïque.
  scene.add(new THREE.AmbientLight('#fff7ed', 0.62 + cc * 0.25))
  scene.add(new THREE.HemisphereLight('#e7eae1', '#5b5c41', 0.5 + cc * 0.25))

  const sun = new THREE.DirectionalLight('#ffeeda', 1.35 * (1 - cc * 0.4))
  sun.position.copy(sunPosition).multiplyScalar(2500)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024) // était 1536
  sun.shadow.camera.near = 100
  sun.shadow.camera.far = 5000
  const shadowBounds = Math.max(worldW, worldD) * 0.55
  sun.shadow.camera.left = -shadowBounds
  sun.shadow.camera.right = shadowBounds
  sun.shadow.camera.top = shadowBounds
  sun.shadow.camera.bottom = -shadowBounds
  sun.shadow.bias = -0.0008
  scene.add(sun)

  // --- Contrôles et Animation Caméra ---
  const mid = trailPts[Math.floor(trailPts.length / 2)]
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(mid)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.enabled = false

  let flythrough = true

  // --- Caméra "travelling" type Relive : décalage monde dont l'azimut pivote lentement ---
  // La caméra ne suit pas la tangente instantanée (ça pivotait brutalement dans chaque lacet).
  // Elle garde un décalage en espace monde par rapport au point courant ; seul l'azimut de ce
  // décalage tourne, lentement et une seule fois, sur toute la durée du survol : la caméra part
  // DERRIÈRE le point, pivote par la gauche, et finit DEVANT à l'arrivée (comportement Relive).
  // Le cap de référence est la tangente de cameraCurve (déjà fortement lissée), donc
  // "derrière/devant" s'entend par rapport au sens de marche sans réintroduire de saccade.
  const CAM_OFFSET_ALT = 470 // altitude constante au-dessus du point courant
  const CAM_OFFSET_DIST = 700 // recul horizontal constant (réduit -> caméra plus proche)
  const HEADING_INERTIA = 0.006 // recalage très lent de la direction "derrière" -> caméra toujours ~derrière le point, sans pivot dans les lacets
  const LOOK_RAISE = 60 // le point visé est relevé de tant -> incline doucement la caméra vers le sol
  const LOOK_AHEAD = 0.02 // avance sur la courbe (0..1) pour le point visé
  const DURATION = 35 // défilement accéléré (était 55)

  // Test "offset à rotation lente" : au lieu d'un balayage azimutal scénarisé, la caméra reste
  // toujours ~derrière le point, mais la direction "derrière" n'est PAS le cap instantané : elle
  // est recalée image par image vers le cap courant avec une très forte inertie (HEADING_INERTIA).
  // -> pas de pivot brutal dans les lacets, la relation du point à l'écran reste ~constante.
  const _oa = new THREE.Vector3()
  const _ob = new THREE.Vector3()
  const _smoothHeading = new THREE.Vector3()
  let smoothHeadingInit = false
  function cameraWorldOffset(t: number, out: THREE.Vector3): void {
    cameraCurve.getPointAt(Math.max(0, t - 0.001), _oa)
    cameraCurve.getPointAt(Math.min(1, t + 0.001), _ob)
    _ob.sub(_oa).setY(0).normalize() // cap instantané (courbe déjà lissée)
    if (!smoothHeadingInit) {
      _smoothHeading.copy(_ob)
      smoothHeadingInit = true
    } else {
      _smoothHeading.lerp(_ob, HEADING_INERTIA).normalize()
    }
    out.set(
      -_smoothHeading.x * CAM_OFFSET_DIST,
      CAM_OFFSET_ALT,
      -_smoothHeading.z * CAM_OFFSET_DIST,
    )
  }
  const _camOff = new THREE.Vector3()
  // Pause finale : pose caméra figée capturée à l'entrée de la pause (pas de recalcul du cap
  // -> aucune rotation, juste le zoom).
  const _pauseAnchor = new THREE.Vector3()
  const _pauseOff = new THREE.Vector3()
  let pauseCaptured = false

  const START_PAUSE = 3
  const END_PAUSE = 5
  const END_ZOOM = 0.58 // recul caméra ramené à ce facteur en fin de parcours (symétrique de l'intro)
  const ZOOM_LEAD = 12 // s : le zoom d'arrivée démarre ZOOM_LEAD avant la fin du survol
  const INTRO_FRAC = 0.12 // fraction du tracé sur laquelle la caméra remonte à son altitude de croisière
  const INTRO_PROX = 0.58 // recul/altitude au tout début, en fraction de l'offset de croisière

  const PHASE1_END = START_PAUSE
  const PHASE2_END = PHASE1_END + DURATION
  const TOTAL_CYCLE = PHASE2_END + END_PAUSE

  // Facteur de zoom d'arrivée : 1 jusqu'à ZOOM_LEAD s avant la fin du survol, puis descend
  // linéairement (progression régulière) jusqu'à END_ZOOM à la toute fin de la pause.
  function arrivalZoomK(elapsed: number): number {
    const z = (elapsed - (PHASE2_END - ZOOM_LEAD)) / (ZOOM_LEAD + END_PAUSE)
    return 1 - (1 - END_ZOOM) * Math.max(0, Math.min(1, z))
  }

  // Rapprochement au départ : la caméra part basse et proche du sol (INTRO_PROX × l'offset) puis
  // remonte en douceur (smoothstep) jusqu'à son altitude de croisière sur les INTRO_FRAC premiers
  // du tracé. Pendant que introRiseK monte, arrivalZoomK vaut 1 -> les deux ne se combattent pas.
  function introRiseK(t: number): number {
    if (t >= INTRO_FRAC) return 1
    const u = t / INTRO_FRAC
    const e = u * u * (3 - 2 * u)
    return INTRO_PROX + (1 - INTRO_PROX) * e
  }

  // Anti-collision caméra : la caméra reculée traversait les crêtes sur les tracés de montagne.
  // On la remonte pour (a) ne jamais être sous le sol et (b) que la ligne caméra->point visé
  // passe au-dessus d'une crête intermédiaire. Remontée seulement (pas de contournement latéral,
  // qui ferait pivoter le cadrage et donnerait le mal de mer). Le lissage de currentCamPos
  // absorbe les variations frame à frame -> la caméra "s'élève" doucement au-dessus de l'obstacle.
  const CAM_GROUND_CLEARANCE = 55 // m mini entre la caméra et le sol juste sous elle
  const RIDGE_CLEARANCE = 40 // m mini entre la ligne de visée et une crête entre caméra et cible
  const RIDGE_SAMPLES = 14
  function avoidTerrain(cam: THREE.Vector3, target: THREE.Vector3): void {
    const groundUnderCam = meshHeightAt(cam.x, cam.z) + CAM_GROUND_CLEARANCE
    if (cam.y < groundUnderCam) cam.y = groundUnderCam

    let lift = 0
    for (let i = 1; i < RIDGE_SAMPLES; i++) {
      const s = i / RIDGE_SAMPLES
      const sx = cam.x + (target.x - cam.x) * s
      const sz = cam.z + (target.z - cam.z) * s
      const segY = cam.y + (target.y - cam.y) * s
      const need = meshHeightAt(sx, sz) + RIDGE_CLEARANCE - segY
      if (need > 0) lift = Math.max(lift, need / (1 - s)) // remonter la caméra de need/(1-s) relève le segment de `need` en s
    }
    cam.y += lift
  }

  const clock = new THREE.Clock()

  const currentCamPos = new THREE.Vector3()
  const targetCamPos = new THREE.Vector3()
  const currentLookAt = new THREE.Vector3()
  const targetLookAt = new THREE.Vector3()

  // Vecteurs réutilisés dans animate() : curve.getPointAt() sans cible alloue un nouveau Vector3
  // à chaque appel, plusieurs fois par frame -> pression GC qui hachait la lecture (petites
  // pauses périodiques du garbage collector).
  const _pos = new THREE.Vector3()
  const _lookPos = new THREE.Vector3()

  // Temps d'animation propre (au lieu de clock.getElapsedTime), pour pouvoir moduler la vitesse
  // globale du survol via la barre "Vitesse" sans casser la synchro des phases.
  let animT = 0
  let speedMul = 1
  let paused = false
  const speedRange = document.getElementById('speed-range') as HTMLInputElement
  const speedVal = document.getElementById('speed-val') as HTMLElement
  speedRange.addEventListener('input', () => {
    speedMul = parseFloat(speedRange.value)
    speedVal.textContent = `${speedMul.toFixed(1)}×`
  })

  function resetToStart() {
    smoothHeadingInit = false
    pauseCaptured = false
    animT = 0
    paused = false
    clock.getDelta() // purge le delta accumulé -> pas de saut au redémarrage
    cameraWorldOffset(0, _camOff)
    currentCamPos.set(
      trailPts[0].x + _camOff.x,
      trailPts[0].y + _camOff.y,
      trailPts[0].z + _camOff.z,
    )
    currentLookAt.set(trailPts[0].x, trailPts[0].y + LOOK_RAISE, trailPts[0].z)
    camera.position.copy(currentCamPos)
    camera.lookAt(currentLookAt)
  }
  resetToStart()

  // Clic dans la vue ou barre d'espace : pause/reprise pendant la lecture, relance quand figé.
  const WATERMARK_LEAD = 4 // s avant la fin : apparition du watermark sillonphane.fr/rando
  const REPLAY_TXT = '↻ Cliquer ou Espace pour rejouer'
  const PAUSE_TXT = '⏸ Cliquer ou Espace pour reprendre'
  let atEnd = false
  const replayHint = document.getElementById('replay') as HTMLElement
  const watermarkEl = document.getElementById('watermark') as HTMLElement
  function togglePlayback() {
    if (!flythrough) return
    if (atEnd) { // figé en fin de tracé -> on rejoue depuis le début
      atEnd = false
      replayHint.style.display = 'none'
      watermarkEl.style.display = 'none'
      resetToStart()
      return
    }
    paused = !paused
    replayHint.textContent = PAUSE_TXT
    replayHint.style.display = paused ? 'block' : 'none'
  }
  renderer.domElement.addEventListener('click', togglePlayback)
  window.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); togglePlayback(); return }
    if (e.key.toLowerCase() === 'o') {
      flythrough = !flythrough
      controls.enabled = !flythrough
      atEnd = false
      replayHint.style.display = 'none'
      watermarkEl.style.display = 'none'
      if (flythrough) resetToStart()
    }
  })

  // --- Cartel de titre (haut) ---
  ;(document.getElementById('titlebar') as HTMLElement).innerHTML =
    `<span class="date">${TRAIL_DATE}</span> — ` +
    `<span class="route">${DEPARTURE_NAME} → ${ARRIVAL_NAME}</span>`

  // --- Cartel du profil altimétrique du tracé ---
  const updateProfileMarker = buildProfileCard(trailPts, TOTAL_DISTANCE_M, minElev - 3.5)

  function animate() {
    requestAnimationFrame(animate)

    if (flythrough) {
      const dt = Math.min(0.1, clock.getDelta()) // clamp : pas de saut après un onglet en veille
      if (!atEnd && !paused) animT += dt * speedMul // vitesse globale pilotée par la barre
      const raw = animT
      const elapsed = Math.min(raw, TOTAL_CYCLE) // pas de boucle : arrêt sur image à la fin
      if (raw >= TOTAL_CYCLE && !atEnd) {
        atEnd = true
        replayHint.textContent = REPLAY_TXT
        replayHint.style.display = 'block'
      }
      watermarkEl.style.display = raw > TOTAL_CYCLE - WATERMARK_LEAD ? 'block' : 'none'

      if (elapsed < PHASE1_END) {
        smoothHeadingInit = false // chaque cycle : on repart verrouillé derrière le cap de départ
        pauseCaptured = false
        cameraWorldOffset(0, _camOff)
        _camOff.multiplyScalar(INTRO_PROX) // pose d'attente déjà basse et proche du départ
        targetCamPos.set(
          trailPts[0].x + _camOff.x,
          trailPts[0].y + _camOff.y,
          trailPts[0].z + _camOff.z,
        )
        targetLookAt.set(trailPts[0].x, trailPts[0].y + LOOK_RAISE, trailPts[0].z)
        avoidTerrain(targetCamPos, targetLookAt)
        ribbonGeom.setDrawRange(0, 6)
        coreGeom.instanceCount = 1
        for (const { sprite } of panelSprites) sprite.visible = false
        departurePanel.visible = true
        arrivalPanel.visible = false
        distanceBadge.style.display = 'block'
        distanceBadge.textContent = formatDistanceKm(0)
        updateProfileMarker(0)
      } else if (elapsed < PHASE2_END) {
        // Travelling : la caméra reste ~derrière le point, direction "derrière" recalée très
        // lentement vers le cap courant (voir cameraWorldOffset / HEADING_INERTIA). Le pivot de
        // position suit cameraCurve (lissée) ; le point regardé reste sur le vrai tracé (curve),
        // légèrement en avant, pour garder cadré le ruban.
        // p = progression linéaire dans le temps ; t = paramètre de courbe, ralenti dans les
        // montées raides (voir slopeRemap).
        const p = (elapsed - PHASE1_END) / DURATION
        const t = slopeRemapT(p)
        cameraCurve.getPointAt(t, _pos)
        const lookT = Math.min(t + LOOK_AHEAD, 1)
        curve.getPointAt(lookT, _lookPos)

        cameraWorldOffset(t, _camOff)
        // intro : caméra basse au départ qui remonte ; arrivée : arrivalZoomK redescend au plus près
        const zk = introRiseK(t) * arrivalZoomK(elapsed)
        targetCamPos.set(
          _pos.x + _camOff.x * zk,
          _pos.y + _camOff.y * zk,
          _pos.z + _camOff.z * zk,
        )
        targetLookAt.set(_lookPos.x, _lookPos.y + LOOK_RAISE, _lookPos.z)
        avoidTerrain(targetCamPos, targetLookAt) // remonte au-dessus des crêtes traversées

        // Déroule le ruban jusqu'au point regardé (lookT), pas jusqu'à la position de la
        // caméra : la caméra reculée regarde en avant, donc réveler seulement jusqu'à "t"
        // laisserait le bout du ruban hors champ (derrière l'axe de vue).
        const visibleSegments = Math.max(1, Math.round(lookT * RIBBON_SEGMENTS))
        ribbonGeom.setDrawRange(0, visibleSegments * 6)
        coreGeom.instanceCount = visibleSegments

        // Un panneau apparaît quand le survol atteint sa position et reste ensuite affiché
        // (il ne disparaît plus une fois "arrivé").
        for (const { sprite, t: panelT } of panelSprites) {
          if (t >= panelT) sprite.visible = true
        }
        departurePanel.visible = true // reste affiché tout le long du survol
        arrivalPanel.visible = false
        distanceBadge.style.display = 'block'
        distanceBadge.textContent = formatDistanceKm(t * TOTAL_DISTANCE_M)
        updateProfileMarker(t)
      } else {
        // Pause finale : pose figée (capturée à l'entrée) + léger zoom vers l'arrivée. Aucun
        // recalcul du cap -> la caméra ne tourne pas autour du point, elle se rapproche juste.
        if (!pauseCaptured) {
          cameraCurve.getPointAt(1, _pauseAnchor)
          cameraWorldOffset(1, _pauseOff)
          curve.getPointAt(1, _lookPos)
          pauseCaptured = true
        }
        const zoomK = arrivalZoomK(elapsed) // continue la progression régulière amorcée en phase 2
        targetCamPos.set(
          _pauseAnchor.x + _pauseOff.x * zoomK,
          _pauseAnchor.y + _pauseOff.y * zoomK,
          _pauseAnchor.z + _pauseOff.z * zoomK,
        )
        targetLookAt.set(_lookPos.x, _lookPos.y + LOOK_RAISE, _lookPos.z)
        avoidTerrain(targetCamPos, targetLookAt)
        ribbonGeom.setDrawRange(0, ribbonIndices.length)
        coreGeom.instanceCount = RIBBON_SEGMENTS
        // les panneaux de localité atteints pendant le survol restent affichés
        departurePanel.visible = true
        arrivalPanel.visible = true
        distanceBadge.style.display = 'block'
        distanceBadge.textContent = formatDistanceKm(TOTAL_DISTANCE_M)
        updateProfileMarker(1)
      }

      // Amortissement : le travelling ne fait que translater (plus de rotation dans les lacets),
      // donc on peut suivre d'assez près la cible sans à-coups. Lissage réduit -> caméra plus
      // réactive, moins "flottante".
      currentCamPos.lerp(targetCamPos, 0.045)
      currentLookAt.lerp(targetLookAt, 0.06)

      camera.position.copy(currentCamPos)
      camera.lookAt(currentLookAt)
    } else {
      controls.update()
      ribbonGeom.setDrawRange(0, ribbonIndices.length)
      coreGeom.instanceCount = RIBBON_SEGMENTS
      distanceBadge.style.display = 'none'
      watermarkEl.style.display = 'none'
      ;(document.getElementById('profile') as HTMLElement).style.display = 'none'
    }

    if (water) (water.material as THREE.ShaderMaterial).uniforms['time'].value += 1 / 60

    renderer.render(scene, camera)
  }

  animate()
}

main().catch(err => {
  console.error(err)
  showError(`Erreur de chargement : ${err instanceof Error ? err.message : String(err)}`)
})
