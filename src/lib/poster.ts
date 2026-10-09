// Affiche de course (remplace l'album pour Running) : une page par course, dessinée sur un canvas à n'importe quelle
// taille (aperçu, A3/A4 pour le tirage, carré pour les réseaux). Trois styles : éditorial (papier clair, titres à
// empattements, carte et photos côte à côte), sportif (même mise en page, fond sombre, titres bâton) et souvenir
// (grande photo en noir et blanc portant le tracé). Maquette d'origine : maquettes/affiche-course.html.
import type {
  GpxPoint, VoyageTrack, PosterSettings, PosterBackground, PosterInfo, PosterRibbon, PosterStyle, PosterFond, PosterFormat,
} from '../types'
import { parseGpx, parseKml, buildDistanceArray } from './gpx'
import {
  analyzeRace, computeBornes, formatBannerDate, formatBannerDistance, formatElapsed, formatPace, hasRealTimes,
  parseEventName, type Borne, type RaceAnalysis,
} from './raceSplits'
import { BASEMAP_TILE_URL, IGN_TILE_URL } from './tileSources'

/** Unités de dessin : l'affiche est conçue à 720 de large (hauteur selon le format) puis mise à l'échelle. */
export const POSTER_W = 720
export const POSTER_MAX_PHOTOS = 2

export const POSTER_FORMATS: { id: PosterFormat; label: string; sub: string; ratio: number; exportW: number; print: boolean }[] = [
  { id: 'a3', label: 'A3', sub: '29,7 × 42 cm', ratio: Math.SQRT2, exportW: 3508, print: true },
  { id: 'a4', label: 'A4', sub: '21 × 29,7 cm', ratio: Math.SQRT2, exportW: 2480, print: true },
  { id: 'carre', label: 'Carré', sub: '1080 × 1080 px', ratio: 1, exportW: 1080, print: false },
]
export function posterFormat(s: PosterSettings) {
  return POSTER_FORMATS.find(f => f.id === s.format) ?? POSTER_FORMATS[0]
}
/** Hauteur de l'affiche (unités) pour son format. */
export function posterHeight(s: PosterSettings): number {
  return Math.round(POSTER_W * posterFormat(s).ratio)
}

/** Libellés provisoires « 1er / 2e / 3e modèle », dans l'ordre des modèles de référence : souvenir (grande photo
 * en noir et blanc), éditorial (photo qui se dissout dans le papier), sportif (en attente du 3e modèle). */
export const POSTER_STYLES: { id: PosterStyle; label: string }[] = [
  { id: 'souvenir', label: '1er modèle' },
  { id: 'editorial', label: '2e modèle' },
  { id: 'sportif', label: '3e modèle' },
]
/** Réglages par défaut de chaque style (le choix d'un style les rétablit). */
const STYLE_DEFAULTS: Record<PosterStyle, { fond: PosterFond; background: PosterBackground; ribbon: PosterRibbon }> = {
  editorial: { fond: 'blanc-casse', background: 'plan-nuit', ribbon: 'logo' },
  sportif: { fond: 'blanc-casse', background: 'plan-nuit', ribbon: 'logo' },
  souvenir: { fond: 'blanc-casse', background: 'plan-nuit', ribbon: '#FFFFFF' },
}

export const POSTER_FONDS: { id: PosterFond; label: string; color: string; texture?: 'grain' | 'lin' }[] = [
  { id: 'blanc-casse', label: 'Blanc cassé', color: '#F6F2EA' },
  { id: 'papier', label: 'Papier', color: '#F0E9DA', texture: 'grain' },
  { id: 'lin', label: 'Lin', color: '#ECE6DA', texture: 'lin' },
  { id: 'gris-clair', label: 'Gris clair', color: '#E4E4E1' },
  { id: 'nuit', label: 'Vert nuit', color: '#121714' },
  { id: 'noir', label: 'Noir', color: '#101010' },
]

export const POSTER_BACKGROUNDS: { id: PosterBackground; label: string }[] = [
  { id: 'plan-nuit', label: 'Plan nuit' },
  { id: 'sat', label: 'Vues aériennes' },
  { id: 'clair', label: 'Plan clair' },
  { id: 'uni', label: 'Uni' },
]

/** Couleurs du parcours : dégradés (logo, vert · orange · crème) puis couleurs unies. */
export const POSTER_RIBBONS: { id: PosterRibbon; label: string }[] = [
  { id: 'logo', label: 'Couleurs du logo' },
  { id: 'trois-couleurs', label: 'Vert · orange · crème' },
  { id: '#EC6A2C', label: 'Orange' },
  { id: '#F2A27A', label: 'Pêche' },
  { id: '#2F5C45', label: 'Vert foncé' },
  { id: '#4E9B6E', label: 'Vert' },
  { id: '#3B6FE0', label: 'Bleu' },
  { id: '#9B5DE5', label: 'Violet' },
  { id: '#FFFFFF', label: 'Blanc' },
]

export const POSTER_INFOS: { id: PosterInfo; label: string; needsTimes?: boolean }[] = [
  { id: 'map', label: 'Carte du parcours' },
  { id: 'bornes', label: 'Nom des kilomètres' },
  { id: 'profile', label: 'Profil d\'altitude' },
  { id: 'bib', label: 'Dossard' },
  { id: 'photos', label: 'Photos' },
  { id: 'rank', label: 'Classement' },
  { id: 'splits', label: 'Temps de passage', needsTimes: true },
  { id: 'notes', label: 'Meilleur km, moitiés', needsTimes: true },
]

// ── Données tirées du tracé ──────────────────────────────────────────────────

export interface PosterData {
  points: GpxPoint[]
  distances: number[]
  /** Distance mesurée (m). */
  total: number
  /** Distance de l'épreuve (m) : 5 km, 10 km, semi ou marathon reconnus, sinon la distance mesurée. */
  officialM: number
  bornes: Borne[]
  /** Analyse des temps (GPX enregistré en course seulement). */
  analysis?: RaceAnalysis
  /** Durée réelle du GPX (s), si ses heures sont réelles. */
  gpxDurationS?: number
  /** Valeurs proposées tant que l'utilisateur n'a rien saisi. */
  defaults: { title: string; distance: string; date: string; city: string; chrono: string; bib: string }
}

function officialDistanceM(m: number): number {
  for (const [d, tol] of [[5000, 250], [10000, 400], [21097.5, 600], [42195, 1000]] as const)
    if (Math.abs(m - d) < tol) return d
  return m
}

/** « 1:43:10 » (saisie du temps officiel). */
export function formatChronoInput(s: number): string {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`
}

/** Lit « 1:43:10 », « 1h43'10 », « 43:10 » → secondes ; undefined si illisible. */
export function parseChrono(text: string | undefined): number | undefined {
  const nums = (text ?? '').match(/\d+/g)?.map(Number)
  if (!nums || nums.length < 2 || nums.length > 3) return undefined
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]]
  if (m >= 60 || s >= 60) return undefined
  const total = h * 3600 + m * 60 + s
  return total > 0 ? total : undefined
}

/** Distance saisie « 21,1 km » → km ; undefined si illisible. */
function parseKm(text: string): number | undefined {
  const m = text.replace(',', '.').match(/\d+(\.\d+)?/)
  const v = m ? parseFloat(m[0]) : NaN
  return v > 0 ? v : undefined
}

export function buildPosterData(track: VoyageTrack): PosterData {
  let parsed
  try { parsed = parseGpx(track.gpxData) } catch { parsed = parseKml(track.gpxData) }
  if (!parsed.tracks.length) parsed = parseKml(track.gpxData)
  const points = parsed.tracks.flatMap(t => t.points)
  const distances = buildDistanceArray(points)
  const total = distances[distances.length - 1] ?? 0
  const officialM = officialDistanceM(total)
  const real = hasRealTimes(points, distances)
  const analysis = real ? analyzeRace(points, distances) : undefined
  let gpxDurationS: number | undefined
  if (real) {
    const t0 = points.find(p => p.time)?.time, t1 = [...points].reverse().find(p => p.time)?.time
    if (t0 && t1 && t1 > t0) gpxDurationS = (t1.getTime() - t0.getTime()) / 1000
  }
  const place = track.panelStartName?.trim() || undefined
  const parsedName = parseEventName(track.panelEventName || track.name, place)
  return {
    points, distances, total, officialM,
    bornes: computeBornes(points, distances, { useRealTimes: false }),
    analysis, gpxDurationS,
    defaults: {
      title: parsedName.title ?? track.name,
      distance: formatBannerDistance(officialM).toLowerCase(),
      date: track.date ?? '',
      city: parsedName.place ?? place ?? '',
      chrono: gpxDurationS ? formatChronoInput(gpxDurationS) : '',
      bib: track.panelBibNumber ?? '',
    },
  }
}

/** Style effectif (défaut : éditorial). */
export function posterStyle(s: PosterSettings): PosterStyle {
  return POSTER_STYLES.some(x => x.id === s.style) ? s.style! : 'editorial'
}

/** Couleur du parcours effective ; un style retiré (« éclatant ») devient vert · orange · crème. */
export function posterRibbon(s: PosterSettings): PosterRibbon {
  const r = s.ribbon
  if (!r) return STYLE_DEFAULTS[posterStyle(s)].ribbon
  return r === 'logo' || r === 'trois-couleurs' || /^#[0-9a-f]{6}$/i.test(r) ? r : 'trois-couleurs'
}

/** Fond effectif : id de la liste, ou ancienne couleur libre (première version de l'affiche). */
export function posterFond(s: PosterSettings): { id?: PosterFond; color: string; texture?: 'grain' | 'lin' } {
  const f = POSTER_FONDS.find(x => x.id === s.fond)
  if (f) return f
  if (s.paper && /^#[0-9a-f]{6}$/i.test(s.paper)) return { color: s.paper }
  return POSTER_FONDS.find(x => x.id === STYLE_DEFAULTS[posterStyle(s)].fond)!
}

export function posterBackground(s: PosterSettings): PosterBackground {
  return s.background ?? STYLE_DEFAULTS[posterStyle(s)].background
}

/** Allure moyenne calculée d'après le temps (« 4'53" / km »). */
export function computedPace(data: PosterData, s: PosterSettings): string {
  const chronoS = parseChrono(s.chrono ?? data.defaults.chrono)
  const km = parseKm(s.distance ?? data.defaults.distance) ?? data.officialM / 1000
  return chronoS ? formatPace(chronoS / km).replace('/km', ' / km') : ''
}

/** Réglages effectifs : saisie de l'utilisateur, sinon valeurs tirées du tracé. */
export function resolvePoster(data: PosterData, s: PosterSettings) {
  const hidden = new Set(s.hidden ?? [])
  const chronoS = parseChrono(s.chrono ?? data.defaults.chrono)
  const dateISO = s.date ?? data.defaults.date
  const city = (s.city ?? data.defaults.city).trim()
  const distance = (s.distance ?? data.defaults.distance).trim()
  return {
    style: posterStyle(s),
    format: posterFormat(s),
    H: posterHeight(s),
    title: (s.title ?? data.defaults.title).trim(),
    name: (s.name ?? '').trim(),
    distance,
    distanceKm: parseKm(distance) ?? data.officialM / 1000,
    dateISO,
    dateText: formatBannerDate(dateISO) ?? '',
    city,
    chronoS,
    /** Temps saisi par l'utilisateur (« temps officiel ») ou lu dans le GPX (« temps »). */
    chronoLabel: s.chrono != null && s.chrono.trim() ? 'Temps officiel' : 'Temps',
    bib: (s.bib ?? data.defaults.bib).trim(),
    rank: (s.rank ?? '').trim(),
    pace: (s.pace ?? computedPace(data, s)).trim(),
    fond: posterFond(s),
    background: posterBackground(s),
    ribbon: posterRibbon(s),
    show: (k: PosterInfo) => !hidden.has(k),
  }
}
type Resolved = ReturnType<typeof resolvePoster>

/** Temps de passage affichés : 4 au plus, puis l'arrivée (pas de 1, 2, 5 ou 10 km selon la distance). */
function posterSplits(data: PosterData, finishS: number | undefined, officialKm: number) {
  const a = data.analysis
  if (!a) return []
  const cum = (km: number) => a.kmSplitsS.slice(0, km).reduce((s, v) => s + v, 0)
  const maxKm = (data.total - 200) / 1000
  const step = [1, 2, 5, 10].find(st => Math.floor(maxKm / st) <= 4) ?? 10
  const cells: { label: string; time: string; pace: string }[] = []
  let prevKm = 0, prevS = 0
  for (let km = step; km <= maxKm && km <= a.kmSplitsS.length; km += step) {
    const t = cum(km)
    cells.push({ label: `${km} km`, time: formatElapsed(t), pace: formatPace((t - prevS) / (km - prevKm)) })
    prevKm = km; prevS = t
  }
  const end = finishS ?? data.gpxDurationS
  if (end) {
    const restKm = officialKm - prevKm
    cells.push({ label: 'Arrivée', time: formatElapsed(end), pace: restKm > 0 ? formatPace((end - prevS) / restKm) : '' })
  }
  return cells
}

// ── Polices et tuiles ────────────────────────────────────────────────────────

const SERIF = '"PosterSerif", "Playfair Display", Georgia, serif'
const SANS = '"PosterSans", "Plus Jakarta Sans", system-ui, sans-serif'
let fontsReady: Promise<void> | null = null
function loadFonts(): Promise<void> {
  if (!fontsReady) {
    const base = import.meta.env.BASE_URL
    const faces = [
      new FontFace('PosterSerif', `url(${base}fonts/playfair-display-latin.woff2)`, { weight: '400 900' }),
      new FontFace('PosterSans', `url(${base}fonts/plus-jakarta-sans-latin.woff2)`, { weight: '400 800' }),
    ]
    fontsReady = Promise.all(faces.map(f => f.load().then(ff => { document.fonts.add(ff) }).catch(() => {}))).then(() => {})
  }
  return fontsReady
}

const tileCache = new Map<string, Promise<HTMLImageElement | null>>()
function loadTile(url: string): Promise<HTMLImageElement | null> {
  let p = tileCache.get(url)
  if (!p) {
    // fetch CORS puis image locale (blob) : l'affiche reste exportable (canvas non « taché »). En cas d'échec, une
    // seconde tentative sans le cache HTTP : une tuile déjà vue par une <img> ordinaire y est gardée sans l'en-tête
    // CORS et serait refusée à chaque fois.
    const get = (cache: RequestCache) => fetch(url, { mode: 'cors', cache }).then(r => (r.ok ? r.blob() : Promise.reject(r.status)))
    p = get('default').catch(() => get('reload')).then(blob => new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image()
      const src = URL.createObjectURL(blob)
      img.onload = () => { URL.revokeObjectURL(src); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(src); resolve(null) }
      img.src = src
    })).catch(() => null)
    p.then(img => { if (!img) tileCache.delete(url) }) // tuile manquante : on réessaiera au prochain dessin
    tileCache.set(url, p)
  }
  return p
}

// ── Couleurs ─────────────────────────────────────────────────────────────────

/** Couleurs du logo Sillonphane (dégradé du sillon, de bas en haut). */
const LOGO_FOREST = '#2F4839'
const LOGO_TERRACOTTA = '#C15C3D'
const LOGO_CREAM = '#F5F3EF'
/** Dégradé du logo : vert forêt (0, en bas) → terracotta (0,5) → crème (1, en haut). */
const LOGO_STOPS: [number, string][] = [[0, LOGO_FOREST], [0.5, LOGO_TERRACOTTA], [1, LOGO_CREAM]]
/** « Vert · orange · crème » : un tiers du parcours chacune, fondus courts centrés sur 1/3 et 2/3. */
const THREE_STOPS: [number, string][] = [
  [0, '#3DB54A'], [0.28, '#3DB54A'], [0.38, '#F07D1A'], [0.62, '#F07D1A'], [0.72, '#F7EBD3'], [1, '#F7EBD3'],
]

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16)
  const c = [16, 8, 0].map(sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t))
  return `rgb(${c.join(',')})`
}
function colorAtStops(stops: [number, string][], f: number): string {
  const x = Math.max(0, Math.min(1, f))
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i]
    if (x <= b) return mixHex(ca, cb, b > a ? (x - a) / (b - a) : 0)
  }
  return stops[stops.length - 1][1]
}
/** Dégradé du ruban posé de gauche à droite (profil, bande de couleur) ; couleur unie : deux arrêts identiques. */
function ribbonStops(ribbon: PosterRibbon): [number, string][] {
  if (ribbon === 'logo') return LOGO_STOPS
  if (ribbon === 'trois-couleurs') return THREE_STOPS
  return [[0, ribbon], [1, ribbon]]
}

/** Luminance relative (0 = noir, 1 = blanc) d'une couleur « #RRGGBB ». */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

interface Theme { light: boolean; fg: string; bg: string; accent: string }
/** Couleurs du texte selon le fond : encre sur papier clair, crème sur papier foncé ; accent orange. */
function makeTheme(paper: string): Theme {
  const light = luminance(paper) > 0.4
  return { light, fg: light ? '25,24,23' : '244,237,224', bg: paper, accent: light ? '#E4602A' : '#F07A3A' }
}

// ── Outils de dessin ─────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`
}

/** Plus grande taille de police (≤ `max`) pour que `text` tienne dans `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, min: number, width: number) {
  let size = max
  for (; size > min; size -= 1) {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= width) break
  }
  ctx.font = `${weight} ${size}px ${family}`
  return size
}

/** Générateur pseudo-aléatoire reproductible : la texture du papier est la même à l'aperçu et à l'export. */
function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

/** Papier : couleur, plus grain ou trame de lin. */
function paintPaper(ctx: CanvasRenderingContext2D, W: number, H: number, fond: { color: string; texture?: 'grain' | 'lin' }) {
  ctx.fillStyle = fond.color
  ctx.fillRect(0, 0, W, H)
  if (fond.texture === 'grain') {
    const rand = rng(7)
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = rand() < 0.5 ? `rgba(70,55,30,${0.03 + rand() * 0.05})` : `rgba(255,255,255,${0.05 + rand() * 0.08})`
      const s = 0.5 + rand() * 1.1
      ctx.fillRect(rand() * W, rand() * H, s, s)
    }
  } else if (fond.texture === 'lin') {
    const rand = rng(11)
    ctx.lineWidth = 0.5
    for (let y = 0; y < H; y += 1.7) {
      ctx.strokeStyle = `rgba(80,65,40,${0.02 + rand() * 0.04})`
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + (rand() - 0.5)); ctx.stroke()
    }
    for (let x = 0; x < W; x += 1.7) {
      ctx.strokeStyle = `rgba(80,65,40,${0.015 + rand() * 0.035})`
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rand() - 0.5), H); ctx.stroke()
    }
  }
}

const wx = (lon: number, z: number) => (lon + 180) / 360 * 256 * 2 ** z
const wy = (lat: number, z: number) => {
  const s = Math.sin(lat * Math.PI / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z
}

/** Projection Mercator du tracé, centré dans un cadre W × H (pixels) avec une marge. */
function project(points: GpxPoint[], W: number, H: number, pad: number) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon)
  const x0 = wx(Math.min(...lons), 0), x1 = wx(Math.max(...lons), 0)
  const y0 = wy(Math.max(...lats), 0), y1 = wy(Math.min(...lats), 0)
  const zf = Math.min(18, Math.log2(Math.min((W - 2 * pad) / Math.max(1e-9, x1 - x0), (H - 2 * pad) / Math.max(1e-9, y1 - y0))))
  const cx = (x0 + x1) / 2 * 2 ** zf, cy = (y0 + y1) / 2 * 2 ** zf
  return {
    zf, cx, cy,
    px: (p: { lat: number; lon: number }) => wx(p.lon, zf) - cx + W / 2,
    py: (p: { lat: number; lon: number }) => wy(p.lat, zf) - cy + H / 2,
  }
}

/** Photo recadrée pour remplir w × h (pixels), en noir et blanc si demandé. */
function coverCanvas(img: HTMLImageElement, W: number, H: number, bw: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(W)); c.height = Math.max(1, Math.round(H))
  const g = c.getContext('2d')!
  const r = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight)
  const sw = c.width / r, sh = c.height / r
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height)
  if (bw) {
    g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height)
    g.globalCompositeOperation = 'source-over'
  }
  return c
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, k: number, radius: number, bw = false) {
  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()
  ctx.drawImage(coverCanvas(img, w * k, h * k, bw), x, y, w, h)
  ctx.restore()
}

interface MapOptions {
  bg: PosterBackground
  ribbon: PosterRibbon
  theme: Theme
  bornes: boolean
  /** Fond = cette photo (noir et blanc) au lieu des tuiles de carte (style souvenir). */
  photo?: HTMLImageElement
  radius: number
  /** Bords fondus dans le papier : part (0 à 1) de la largeur ou de la hauteur, de chaque côté. */
  fade?: { left?: number; right?: number; top?: number; bottom?: number }
}

/** Carte (fond + ruban + bornes) dans le rectangle (x, y, w, h) en unités, `k` = pixels par unité. */
async function drawMap(ctx: CanvasRenderingContext2D, data: PosterData, o: MapOptions,
  x: number, y: number, w: number, h: number, k: number, isLive: () => boolean): Promise<boolean> {
  const { points, distances, total } = data
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k))
  const { zf, cx, cy, px, py } = project(points, W, H, (o.photo ? 56 : 34) * k)
  const lightPaper = o.theme.light

  // Fond sur un canvas à part : les opérations de couleur (désaturation, inversion) ne touchent que la carte.
  const off = document.createElement('canvas')
  off.width = W; off.height = H
  const m = off.getContext('2d')!
  const mapBg = o.bg === 'uni' ? mixHex(o.theme.bg, lightPaper ? '#000000' : '#ffffff', 0.05) : o.bg === 'clair' ? '#E9E3D6' : '#1b221d'
  m.fillStyle = mapBg
  m.fillRect(0, 0, W, H)
  if (o.photo) {
    m.drawImage(coverCanvas(o.photo, W, H, true), 0, 0)
  } else if (o.bg !== 'uni') {
    const zt = Math.max(0, Math.min(18, Math.round(zf))), sc = 2 ** (zf - zt)
    const ox = cx / sc - W / 2 / sc, oy = cy / sc - H / 2 / sc
    const tpl = o.bg === 'sat' ? BASEMAP_TILE_URL : IGN_TILE_URL
    const jobs: Promise<void>[] = []
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W / sc) / 256); tx++)
      for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H / sc) / 256); ty++) {
        const url = tpl.replace('{z}', String(zt)).replace('{x}', String(tx)).replace('{y}', String(ty))
        jobs.push(loadTile(url).then(img => {
          // +0,5 px de recouvrement : pas de joint visible entre tuiles
          if (img) m.drawImage(img, (tx * 256 - ox) * sc, (ty * 256 - oy) * sc, 256 * sc + 0.5, 256 * sc + 0.5)
        }))
      }
    await Promise.all(jobs)
    if (!isLive()) return false
    const op = (mode: GlobalCompositeOperation, fill: string) => {
      m.globalCompositeOperation = mode; m.fillStyle = fill; m.fillRect(0, 0, W, H)
    }
    if (o.bg === 'sat') { op('saturation', 'rgba(128,128,128,0.45)'); op('source-over', 'rgba(8,12,10,0.58)') }
    if (o.bg === 'plan-nuit') { op('difference', '#fff'); op('saturation', 'rgba(128,128,128,0.7)'); op('source-over', 'rgba(8,12,10,0.38)') }
    if (o.bg === 'clair') { op('saturation', 'rgba(128,128,128,0.75)'); op('source-over', 'rgba(244,239,229,0.22)') }
    m.globalCompositeOperation = 'source-over'
  }

  // Ruban, sur un liseré sombre. « Couleurs du logo » : dégradé vertical sur l'emprise du tracé (vert forêt en bas,
  // terracotta au milieu, crème en haut) ; « vert · orange · crème » : le long du parcours ; sinon couleur unie.
  const ys = points.map(py)
  const yBottom = Math.max(...ys), yTop = Math.min(...ys)
  const heightAt = (yy: number) => (yBottom - yy) / Math.max(1, yBottom - yTop)
  const ribbonColor = (yy: number, atM: number) =>
    o.ribbon === 'logo' ? colorAtStops(LOGO_STOPS, heightAt(yy))
      : o.ribbon === 'trois-couleurs' ? colorAtStops(THREE_STOPS, atM / total) : o.ribbon
  m.lineJoin = 'round'; m.lineCap = 'round'
  const trace = () => { m.beginPath(); points.forEach((p, i) => (i ? m.lineTo(px(p), py(p)) : m.moveTo(px(p), py(p)))) }
  trace(); m.strokeStyle = o.photo ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.4)'; m.lineWidth = 10 * k; m.stroke()
  m.lineWidth = 6 * k
  if (o.ribbon === 'logo') {
    const grad = m.createLinearGradient(0, yBottom, 0, yTop)
    LOGO_STOPS.forEach(([at, c]) => grad.addColorStop(at, c))
    trace(); m.strokeStyle = grad; m.stroke()
  } else if (o.ribbon === 'trois-couleurs') {
    const STEP = Math.max(1, Math.round(points.length / 400))
    for (let i = 0; i < points.length - 1; i += STEP) {
      m.strokeStyle = colorAtStops(THREE_STOPS, distances[i] / total)
      m.beginPath()
      m.moveTo(px(points[i]), py(points[i]))
      for (let j = i + 1; j <= Math.min(points.length - 1, i + STEP); j++) m.lineTo(px(points[j]), py(points[j]))
      m.stroke()
    }
  } else {
    trace(); m.strokeStyle = o.ribbon; m.stroke()
  }

  // Bornes tous les 5 km (le semi n'est pas repris : la borne des 20 km suffit).
  if (o.bornes) {
    m.textAlign = 'center'; m.textBaseline = 'middle'
    for (const b of data.bornes.filter(b => Number.isInteger(b.km))) {
      const bx = px(b), by = py(b)
      m.beginPath(); m.arc(bx, by, 12 * k, 0, Math.PI * 2)
      m.fillStyle = '#FFFFFF'; m.fill()
      m.lineWidth = 2.2 * k; m.strokeStyle = ribbonColor(by, b.km * 1000); m.stroke()
      m.fillStyle = '#191817'; m.font = `800 ${11 * k}px ${SANS}`
      m.fillText(String(b.km), bx, by + 0.5 * k)
    }
  }
  // Départ : pastille blanche ; arrivée : drapeau à damier.
  const a = points[0], z = points[points.length - 1]
  m.beginPath(); m.arc(px(a), py(a), 7 * k, 0, Math.PI * 2)
  m.fillStyle = '#FFFFFF'; m.fill(); m.lineWidth = 2.5 * k; m.strokeStyle = '#191817'; m.stroke()
  const fx = px(z), fy = py(z), fr = 10 * k
  m.save()
  m.beginPath(); m.arc(fx, fy, fr, 0, Math.PI * 2); m.clip()
  const sq = fr / 2.2
  for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) {
    m.fillStyle = (i + j) % 2 === 0 ? '#191817' : '#FFFFFF'
    m.fillRect(fx + i * sq, fy + j * sq, sq, sq)
  }
  m.restore()
  m.beginPath(); m.arc(fx, fy, fr, 0, Math.PI * 2); m.lineWidth = 2 * k; m.strokeStyle = '#FFFFFF'; m.stroke()

  if (!o.photo && o.bg !== 'uni') {
    m.textAlign = 'right'; m.textBaseline = 'alphabetic'
    m.font = `${9 * k}px ${SANS}`; m.fillStyle = o.bg === 'clair' ? 'rgba(25,24,23,0.55)' : 'rgba(244,237,224,0.55)'
    m.fillText(o.bg === 'sat' ? 'Vues aériennes © IGN' : 'Plan © IGN', W - 8 * k, H - 7 * k)
  }

  // Bords qui se dissolvent dans le papier (3e modèle) : part de la largeur / hauteur fondue de chaque côté.
  if (o.fade) {
    m.globalCompositeOperation = 'destination-in'
    const f = o.fade
    const hz = m.createLinearGradient(0, 0, W, 0)
    hz.addColorStop(0, `rgba(0,0,0,${f.left ? 0 : 1})`); hz.addColorStop(f.left ?? 0, 'rgba(0,0,0,1)')
    hz.addColorStop(1 - (f.right ?? 0), 'rgba(0,0,0,1)'); hz.addColorStop(1, `rgba(0,0,0,${f.right ? 0 : 1})`)
    m.fillStyle = hz; m.fillRect(0, 0, W, H)
    const vt = m.createLinearGradient(0, 0, 0, H)
    vt.addColorStop(0, `rgba(0,0,0,${f.top ? 0 : 1})`); vt.addColorStop(f.top ?? 0, 'rgba(0,0,0,1)')
    vt.addColorStop(1 - (f.bottom ?? 0), 'rgba(0,0,0,1)'); vt.addColorStop(1, `rgba(0,0,0,${f.bottom ? 0 : 1})`)
    m.fillStyle = vt; m.fillRect(0, 0, W, H)
    m.globalCompositeOperation = 'source-over'
  }

  ctx.save()
  roundRect(ctx, x, y, w, h, o.radius)
  ctx.clip()
  ctx.drawImage(off, x, y, w, h)
  ctx.restore()
  return true
}

function drawProfile(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, theme: Theme, x: number, y: number, w: number, h: number) {
  const { points, distances, total } = data
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  ctx.textBaseline = 'alphabetic'
  // Titre : « PROFIL D'ALTITUDE · 0 — 21,1 KM »
  ctx.textAlign = 'left'; ctx.fillStyle = theme.accent; ctx.font = `700 10px ${SANS}`; setSpacing(ctx, 2.5)
  ctx.fillText(`PROFIL D'ALTITUDE · 0 — ${r.distance.toUpperCase()}`, x, y + 9)
  setSpacing(ctx, 0)
  const gx = x + 34, gw = w - 34, top = y + 22, base = y + h - 14
  const n = points.length
  const sm = points.map((_, i) => {
    let s = 0, c = 0
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { s += points[j].ele; c++ }
    return s / c
  })
  const lo = Math.min(...sm), hi = Math.max(...sm)
  const span = Math.max(10, hi - lo), floor = lo - span * 0.15, ceil = hi + span * 0.15
  const X = (d: number) => gx + d / total * gw
  const Y = (e: number) => base - (e - floor) / (ceil - floor) * (base - top)
  const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0)
  ribbonStops(r.ribbon).forEach(([at, c]) => grad.addColorStop(at, c))
  ctx.beginPath()
  ctx.moveTo(gx, base)
  sm.forEach((e, i) => ctx.lineTo(X(distances[i]), Y(e)))
  ctx.lineTo(gx + gw, base)
  ctx.closePath()
  ctx.globalAlpha = 0.3; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1
  ctx.beginPath()
  sm.forEach((e, i) => (i ? ctx.lineTo(X(distances[i]), Y(e)) : ctx.moveTo(X(distances[i]), Y(e))))
  ctx.strokeStyle = r.ribbon === '#FFFFFF' && theme.light ? fg(0.6) : grad; ctx.lineWidth = 2; ctx.stroke()
  ctx.strokeStyle = fg(0.25); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(gx, base); ctx.lineTo(gx + gw, base); ctx.stroke()
  // Axes : altitudes à gauche, kilomètres en bas
  ctx.font = `9px ${SANS}`; ctx.fillStyle = fg(0.55); ctx.textAlign = 'left'
  ctx.fillText(`${Math.round(hi)} m`, x, Y(hi) + 3)
  ctx.fillText(`${Math.round(lo)} m`, x, Y(lo) + 3)
  const step = total > 25000 ? 10 : 5
  ctx.strokeStyle = fg(0.4)
  for (let km = 0; km * 1000 <= total; km += step) {
    const tx = Math.min(gx + gw - 1, X(km * 1000))
    ctx.beginPath(); ctx.moveTo(tx, base); ctx.lineTo(tx, base + 4); ctx.stroke()
    ctx.textAlign = km ? 'center' : 'left'
    ctx.fillText(`${km} km`, tx, y + h - 1)
  }
}

// ── Mises en page ────────────────────────────────────────────────────────────

/** Découpe `text` en lignes (au plus `maxLines`) à la plus grande taille ≤ `max` qui tient dans `width`. */
function wrapFit(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, min: number,
  width: number, maxLines: number): { size: number; lines: string[] } {
  const words = text.split(/\s+/).filter(Boolean)
  for (let size = max; size >= min; size -= 1) {
    ctx.font = `${weight} ${size}px ${family}`
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w
      if (ctx.measureText(t).width <= width || !cur) cur = t
      else { lines.push(cur); cur = w }
    }
    if (cur) lines.push(cur)
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= width)) return { size, lines }
  }
  ctx.font = `${weight} ${min}px ${family}`
  return { size: min, lines: [text] }
}

/** Photo qui se dissout dans le papier : opaque en haut à droite, fondue vers la gauche (opacité `leftAlpha` au bord
 * gauche, pleine à `leftTo` de la largeur) et vers le bas (à partir de `bottomFrom` de la hauteur). */
function drawFadingPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, k: number,
  leftAlpha = 0, leftTo = 0.42, bottomFrom = 0.62) {
  const c = coverCanvas(img, w * k, h * k, false)
  const g = c.getContext('2d')!
  g.globalCompositeOperation = 'destination-in'
  const hz = g.createLinearGradient(0, 0, c.width, 0)
  hz.addColorStop(0, `rgba(0,0,0,${leftAlpha})`); hz.addColorStop(leftTo, 'rgba(0,0,0,1)'); hz.addColorStop(1, 'rgba(0,0,0,1)')
  g.fillStyle = hz; g.fillRect(0, 0, c.width, c.height)
  const vt = g.createLinearGradient(0, 0, 0, c.height)
  vt.addColorStop(0, 'rgba(0,0,0,1)'); vt.addColorStop(bottomFrom, 'rgba(0,0,0,1)'); vt.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = vt; g.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(c, x, y, w, h)
}

/** Éditorial et sportif : en-tête (nom, course, distance · date · ville), carte et photos, temps, profil.
 * Éditorial (2e modèle) : la 1re photo, collée en haut à droite, se dissout dans le papier derrière le titre ; carte
 * presque carrée à gauche, 2e photo à droite calée sur le bas de la carte. Sportif : carte et colonne de photos. */
async function drawClassic(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, theme: Theme,
  photos: HTMLImageElement[], k: number, isLive: () => boolean, signature: boolean): Promise<boolean> {
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  // Le 3e modèle (« sportif ») a sa propre mise en page (drawModel3) ; en carré, il reprend celle du 2e modèle.
  const sport = false
  const editorial = !sport
  const fam = sport ? SANS : SERIF, tw = sport ? 800 : 700
  const sq = r.format.id === 'carre'
  const H = r.H, L = 34, R = POSTER_W - 34, CW = R - L
  const finishS = r.chronoS
  const hasTimes = !!data.analysis
  const showMap = r.show('map'), shownPhotos = r.show('photos') ? photos : []
  // Éditorial : 1re photo en tête (fondue), la 2e à côté de la carte.
  const headPhoto = editorial && !sq ? shownPhotos[0] : undefined
  const midPhotos = headPhoto ? shownPhotos.slice(1) : shownPhotos

  // Bas de l'affiche, de bas en haut : pied, profil, notes, temps de passage, temps → le milieu prend le reste.
  const plan = (useSplits: boolean, useNotes: boolean, profileH: number) => {
    let b = H - (signature ? 46 : 30)
    let profileY: number | undefined
    if (r.show('profile')) { profileY = b - profileH; b = profileY - (editorial ? 30 : 20) }
    let notesY: number | undefined
    if (useNotes) { notesY = b; b -= 28 }
    let splitsY: number | undefined
    if (useSplits) { splitsY = b - 64; b = splitsY - 20 }
    const timeTop = b - 104
    return { profileY, profileH, notesY, splitsY, timeTop, midBottom: timeTop - 22 }
  }

  // Photo d'en-tête, dessinée d'abord : le titre passe par-dessus sa partie fondue.
  let p = plan(r.show('splits') && hasTimes, r.show('notes') && hasTimes, sq ? 64 : 92)
  if (headPhoto) {
    const hx = POSTER_W * 0.5, hy = 0
    const hBottom = midPhotos.length && showMap ? p.midBottom - (p.midBottom - 230) * 0.5 - 14 : 440
    drawFadingPhoto(ctx, headPhoto, hx, hy, POSTER_W - hx, Math.max(200, hBottom - hy), k)
  }

  // En-tête
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  let y = 44
  const kicker = [finishS ? 'FINISHER' : 'PARCOURS', r.city.toUpperCase(), r.dateISO.slice(0, 4)].filter(Boolean).join('  /  ')
  ctx.fillStyle = theme.accent; ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3.5)
  ctx.fillText(kicker, L, y)
  setSpacing(ctx, 0)
  if (signature && !headPhoto) {
    ctx.textAlign = 'right'; ctx.fillStyle = fg(0.8); ctx.font = `700 10px ${SANS}`; setSpacing(ctx, 3)
    ctx.fillText('SILLONPHANE', R, y)
    ctx.textAlign = 'left'; setSpacing(ctx, 0)
  }
  y += 14
  ctx.fillStyle = fg(1)
  const textW = headPhoto ? CW * 0.8 : CW
  if (r.name) {
    const nameText = sport ? r.name.toUpperCase() : r.name
    const ns = fitFont(ctx, nameText, tw, fam, sq ? 44 : 58, 26, textW)
    y += ns * 0.86
    ctx.fillText(nameText, L, y)
    y += 14
    ctx.fillStyle = theme.accent; ctx.fillRect(L, y, 46, 3)
    y += 10
    const ts = fitFont(ctx, r.title, tw, fam, sq ? 28 : 36, 18, textW)
    y += ts * 0.86
    ctx.fillStyle = fg(1); ctx.fillText(r.title, L, y)
  } else {
    const t = wrapFit(ctx, r.title, tw, fam, sq ? 44 : editorial ? 62 : 50, 22, textW, 2)
    t.lines.forEach((line, i) => {
      y += i ? t.size * 1.0 : t.size * 0.86
      ctx.fillText(line, L, y)
    })
    if (editorial) { y += 12; ctx.fillStyle = theme.accent; ctx.fillRect(L, y, 62, 2.5); y += 2 }
  }
  y += 24
  ctx.font = `16px ${SANS}`; ctx.fillStyle = fg(0.75)
  ctx.fillText([r.distance, r.dateText, r.city].filter(Boolean).join(' · '), L, y)
  const midTop = y + 26

  // Mise en page du bas, en libérant de la place si le milieu est trop petit.
  const hasMid = showMap || midPhotos.length > 0
  const minMid = sq ? 170 : 300
  let useSplits = r.show('splits') && hasTimes, useNotes = r.show('notes') && hasTimes
  if (p.midBottom - midTop < minMid && useSplits) { useSplits = false; p = plan(useSplits, useNotes, p.profileH) }
  if (p.midBottom - midTop < minMid && useNotes) { useNotes = false; p = plan(useSplits, useNotes, p.profileH) }
  if (!hasMid) p = plan(useSplits, useNotes, p.profileH + Math.max(0, p.midBottom - midTop - 20))

  // Carte et photos
  if (hasMid) {
    const midH = p.midBottom - midTop, gap = 14
    const mapOpts: MapOptions = { bg: r.background, ribbon: r.ribbon, theme, bornes: r.show('bornes'), radius: editorial ? 3 : 8 }
    const rad = editorial ? 3 : 8
    if (showMap && midPhotos.length && editorial) {
      // Carte à gauche, photo(s) à droite calée(s) sur le bas de la carte
      const mw = Math.round(CW * 0.6), pw = CW - mw - gap
      if (!await drawMap(ctx, data, mapOpts, L, midTop, mw, midH, k, isLive)) return false
      const ph = Math.min(midH, midH * 0.5)
      midPhotos.forEach((img, i) => drawPhoto(ctx, img, R - pw, p.midBottom - ph - i * (ph + gap), pw, ph, k, rad))
    } else if (showMap && midPhotos.length) {
      const pw = Math.round(CW * 0.34)
      if (!await drawMap(ctx, data, mapOpts, L, midTop, CW - pw - gap, midH, k, isLive)) return false
      const ph = (midH - gap * (midPhotos.length - 1)) / midPhotos.length
      midPhotos.forEach((img, i) => drawPhoto(ctx, img, R - pw, midTop + i * (ph + gap), pw, ph, k, rad))
    } else if (showMap) {
      // Éditorial avec photo d'en-tête : la carte laisse la photo respirer à droite
      const mw = headPhoto ? Math.round(CW * 0.6) : CW
      if (!await drawMap(ctx, data, mapOpts, L, midTop, mw, midH, k, isLive)) return false
    } else {
      const pw = (CW - gap * (midPhotos.length - 1)) / midPhotos.length
      midPhotos.forEach((img, i) => drawPhoto(ctx, img, L + i * (pw + gap), midTop, pw, midH, k, rad))
    }
  }

  // Temps (ou distance si aucun temps), séparateur, puis dossard, classement, allure
  const tt = p.timeTop
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.accent; ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3.5)
  ctx.fillText((finishS ? r.chronoLabel : 'Distance').toUpperCase(), L, tt + 12)
  setSpacing(ctx, 0)
  const bigSize = sq ? 62 : 80
  ctx.font = `${tw} ${bigSize}px ${fam}`; ctx.fillStyle = fg(1)
  const big = finishS ? formatElapsed(finishS) : r.distance
  ctx.fillText(big, L, tt + 26 + bigSize * 0.78)
  const bigW = ctx.measureText(big).width
  const facts: [string, string][] = []
  if (r.show('bib') && r.bib) facts.push(['Dossard', r.bib])
  if (r.show('rank') && r.rank) facts.push(['Classement', r.rank])
  if (r.pace) facts.push(['Allure moyenne', r.pace])
  if (facts.length) {
    const fx = Math.max(L + bigW + 44, R - 250)
    ctx.strokeStyle = fg(0.2); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(fx - 22, tt + 10); ctx.lineTo(fx - 22, tt + 100); ctx.stroke()
    facts.forEach(([label, value], i) => {
      const fy = tt + 40 + i * 26 + (3 - facts.length) * 13
      ctx.font = `14px ${SANS}`; ctx.fillStyle = fg(0.65); ctx.fillText(label, fx, fy)
      ctx.font = `700 15px ${SANS}`; ctx.fillStyle = fg(1); ctx.fillText(value, fx + 118, fy)
    })
  }

  // Temps de passage
  if (useSplits && p.splitsY != null) {
    const splits = posterSplits(data, finishS, r.distanceKm)
    const sy = p.splitsY
    ctx.strokeStyle = fg(0.18); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(L, sy); ctx.lineTo(R, sy); ctx.moveTo(L, sy + 64); ctx.lineTo(R, sy + 64); ctx.stroke()
    const cw = CW / Math.max(1, splits.length)
    ctx.textAlign = 'center'
    splits.forEach((c, i) => {
      const cx = L + cw * (i + 0.5)
      if (i) { ctx.strokeStyle = fg(0.12); ctx.beginPath(); ctx.moveTo(L + cw * i, sy + 8); ctx.lineTo(L + cw * i, sy + 56); ctx.stroke() }
      ctx.fillStyle = theme.accent; ctx.font = `700 10px ${SANS}`; setSpacing(ctx, 2)
      ctx.fillText(c.label.toUpperCase(), cx, sy + 19)
      setSpacing(ctx, 0)
      ctx.fillStyle = fg(1); ctx.font = `700 ${splits.length > 4 ? 18 : 20}px ${SANS}`
      ctx.fillText(c.time, cx, sy + 41)
      ctx.fillStyle = fg(0.6); ctx.font = `11px ${SANS}`
      ctx.fillText(c.pace, cx, sy + 56)
    })
  }

  // Meilleur et moins bon km, moitiés
  if (useNotes && p.notesY != null && data.analysis) {
    const a = data.analysis
    const parts: [string, string][] = [
      ['Meilleur km : ', `${a.best.km}e · ${formatElapsed(a.best.s)}`],
      ['Moins bon : ', `${a.worst.km}e · ${formatElapsed(a.worst.s)}`],
      ['Moitiés : ', `${formatElapsed(a.halvesS[0])} / ${formatElapsed(a.halvesS[1])}`],
    ]
    const xs = [L, L + CW / 2, R]
    parts.forEach(([label, value], i) => {
      ctx.font = `12px ${SANS}`
      const lw = ctx.measureText(label).width
      ctx.font = `700 12px ${SANS}`
      const vw = ctx.measureText(value).width
      const start = i === 0 ? xs[i] : i === 1 ? xs[i] - (lw + vw) / 2 : xs[i] - lw - vw
      ctx.textAlign = 'left'
      ctx.font = `12px ${SANS}`; ctx.fillStyle = fg(0.75); ctx.fillText(label, start, p.notesY!)
      ctx.font = `700 12px ${SANS}`; ctx.fillStyle = fg(1); ctx.fillText(value, start + lw, p.notesY!)
    })
  }

  if (p.profileY != null) {
    if (editorial) {
      ctx.strokeStyle = fg(0.15); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(L, p.profileY - 14); ctx.lineTo(R, p.profileY - 14); ctx.stroke()
    }
    drawProfile(ctx, data, r, theme, L, p.profileY, CW, p.profileH)
  }

  // Pied : phrase et signature, sur l'image pour les réseaux seulement, jamais sur le tirage.
  if (signature) {
    ctx.textAlign = 'left'; ctx.font = `13px ${SANS}`; ctx.fillStyle = fg(0.65)
    ctx.fillText('Une course. Des souvenirs. Toujours plus loin.', L, H - 22)
    ctx.textAlign = 'right'; ctx.font = `700 15px ${SERIF}`; ctx.fillStyle = fg(0.9)
    ctx.fillText('Sillonphane', R, H - 22)
  }
  return true
}

/** Souvenir : bande de couleur, ville et date à gauche, dossard, temps, distance et nom à droite, puis grande photo
 * en noir et blanc portant le tracé (sans photo : la carte). */
async function drawSouvenir(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, theme: Theme,
  photos: HTMLImageElement[], k: number, isLive: () => boolean, signature: boolean): Promise<boolean> {
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const sq = r.format.id === 'carre'
  const H = r.H, L = 34, R = POSTER_W - 34, CW = R - L
  const finishS = r.chronoS

  // Bande aux couleurs du parcours
  const bandW = sq ? 150 : 190
  const band = ctx.createLinearGradient(L, 0, L + bandW, 0)
  ribbonStops(r.ribbon === '#FFFFFF' ? 'logo' : r.ribbon).forEach(([at, c]) => band.addColorStop(at, c))
  ctx.fillStyle = band
  ctx.fillRect(L, 30, bandW, 6)

  // Gauche : ville (sinon nom de la course) et date
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = fg(1)
  const head = r.city || r.title
  const hs = fitFont(ctx, head, 800, SANS, sq ? 46 : 60, 26, CW * 0.55)
  const headY = 46 + hs * 0.86
  ctx.fillText(head, L, headY)
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.dateISO)
  ctx.font = `500 ${sq ? 18 : 22}px ${SANS}`; ctx.fillStyle = fg(0.85)
  ctx.fillText(d ? `${d[3]}.${d[2]}.${d[1]}` : r.dateText, L, headY + (sq ? 28 : 34))

  // Droite : dossard, temps et distance, nom
  ctx.textAlign = 'right'
  let ry = 58
  if (r.show('bib') && r.bib) { ctx.font = `600 ${sq ? 18 : 22}px ${SANS}`; ctx.fillStyle = fg(1); ctx.fillText(`#${r.bib}`, R, ry); ry += 6 }
  ry += sq ? 22 : 26
  const stats: [string, string][] = []
  if (finishS) stats.push([formatChronoInput(finishS), 'TEMPS'])
  stats.push([String(r.distanceKm).replace('.', ','), 'KM'])
  if (r.show('rank') && r.rank) stats.push([r.rank, 'CLASSEMENT'])
  let sx = R
  for (let i = stats.length - 1; i >= 0; i--) {
    const [v, lbl] = stats[i]
    ctx.font = `700 ${sq ? 14 : 16}px ${SANS}`; ctx.fillStyle = fg(1)
    const vw = ctx.measureText(v).width
    ctx.fillText(v, sx, ry)
    ctx.font = `600 9px ${SANS}`; ctx.fillStyle = fg(0.7); setSpacing(ctx, 0.8)
    ctx.fillText(lbl, sx, ry + 14)
    const lw = ctx.measureText(lbl).width
    setSpacing(ctx, 0)
    sx -= Math.max(vw, lw, 30) + 20
  }
  ry += sq ? 40 : 46
  const who = r.name || r.title
  fitFont(ctx, who, 700, SANS, sq ? 18 : 22, 12, CW * 0.42); ctx.fillStyle = fg(1)
  ctx.fillText(who, R, ry)

  // Grande photo (ou carte) portant le tracé, profil éventuel dessous
  const top = Math.max(headY + (sq ? 50 : 60), ry + 22)
  const profH = r.show('profile') ? (sq ? 60 : 78) : 0
  const bottom = H - (signature ? 44 : 34) - (profH ? profH + 18 : 0)
  const photo = r.show('photos') ? photos[0] : undefined
  const mapOpts: MapOptions = { bg: r.background, ribbon: r.ribbon, theme, bornes: r.show('bornes'), radius: 2, photo }
  if (photo || r.show('map')) {
    if (!await drawMap(ctx, data, mapOpts, L, top, CW, bottom - top, k, isLive)) return false
  }
  if (profH) drawProfile(ctx, data, r, theme, L, bottom + 18, CW, profH)

  if (signature) {
    ctx.textAlign = 'right'; ctx.font = `700 13px ${SERIF}`; ctx.fillStyle = fg(0.7)
    ctx.fillText('Sillonphane', R, H - 18)
  }
  return true
}

/** 3e modèle : 1re photo en fond de toute la moitié haute, fondue dans le papier ; nom, course et sous-titre
 * par-dessus ; carte collée au bord gauche aux bords dissous ; à droite le temps officiel, dossard, classement, allure,
 * puis la 2e photo ; profil sur toute la largeur. Pas de place pour les temps de passage. */
async function drawModel3(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, theme: Theme,
  photos: HTMLImageElement[], k: number, isLive: () => boolean, signature: boolean): Promise<boolean> {
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const H = r.H, L = 34, R = POSTER_W - 34, CW = R - L
  const finishS = r.chronoS
  const shown = r.show('photos') ? photos : []

  // Photo de fond, moitié haute
  if (shown[0]) {
    drawFadingPhoto(ctx, shown[0], 0, 0, POSTER_W, H * 0.56, k, 0.3, 0.62, 0.6)
    // Voile couleur papier derrière le texte (coin haut gauche clair, comme une brume) : l'en-tête reste lisible.
    const veil = ctx.createLinearGradient(0, 0, POSTER_W * 0.78, 0)
    const pc = theme.bg.startsWith('#') ? theme.bg : '#F6F2EA'
    const rgb = [1, 3, 5].map(i => parseInt(pc.slice(i, i + 2), 16)).join(',')
    veil.addColorStop(0, `rgba(${rgb},0.88)`); veil.addColorStop(0.5, `rgba(${rgb},0.62)`); veil.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = veil
    ctx.fillRect(0, 0, POSTER_W, H * 0.4)
    const veilV = ctx.createLinearGradient(0, H * 0.36, 0, H * 0.46)
    veilV.addColorStop(0, `rgba(${rgb},0.5)`); veilV.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = veilV
    ctx.fillRect(0, H * 0.36, POSTER_W * 0.6, H * 0.1)
  }

  // En-tête
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  let y = 44
  const kicker = [finishS ? 'FINISHER' : 'PARCOURS', r.city.toUpperCase(), r.dateISO.slice(0, 4)].filter(Boolean).join('  /  ')
  ctx.fillStyle = theme.accent; ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3.5)
  ctx.fillText(kicker, L, y)
  setSpacing(ctx, 0)
  y += 14
  ctx.fillStyle = fg(1)
  if (r.name) {
    const ns = fitFont(ctx, r.name, 700, SERIF, 60, 26, CW * 0.8)
    y += ns * 0.86
    ctx.fillText(r.name, L, y)
    y += 16
    ctx.fillStyle = theme.accent; ctx.fillRect(L, y, 46, 2.5)
    y += 8
    const t = wrapFit(ctx, r.title, 700, SERIF, 46, 20, CW * 0.82, 2)
    ctx.fillStyle = fg(1)
    t.lines.forEach((line, i) => { y += i ? t.size * 1.0 : t.size * 0.9; ctx.fillText(line, L, y) })
  } else {
    const t = wrapFit(ctx, r.title, 700, SERIF, 58, 22, CW * 0.82, 2)
    t.lines.forEach((line, i) => { y += i ? t.size * 1.0 : t.size * 0.86; ctx.fillText(line, L, y) })
    y += 12; ctx.fillStyle = theme.accent; ctx.fillRect(L, y, 62, 2.5); y += 2
  }
  y += 26
  ctx.font = `16px ${SANS}`; ctx.fillStyle = fg(0.8)
  ctx.fillText([r.distance, r.dateText, r.city].filter(Boolean).join(' · '), L, y)

  // Profil en bas, sur toute la largeur
  const footer = signature ? 46 : 30
  const profH = r.show('profile') ? 92 : 0
  const profY = H - footer - profH
  const blockBottom = profH ? profY - 22 : H - footer - 10

  // Carte collée au bord gauche, bords dissous dans le papier
  const mapTop = Math.max(y + 22, H * 0.3)
  const mapW = Math.round(POSTER_W * 0.585)
  if (r.show('map')) {
    const mapOpts: MapOptions = {
      bg: r.background, ribbon: r.ribbon, theme, bornes: r.show('bornes'), radius: 0,
      fade: { right: 0.16, top: 0.1, bottom: 0.1 },
    }
    if (!await drawMap(ctx, data, mapOpts, 0, mapTop, mapW, blockBottom - mapTop, k, isLive)) return false
  }

  // Colonne de droite : temps, chiffres, 2e photo
  const cx = POSTER_W * 0.61, colW = R - cx
  let ty = H * 0.535
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.accent; ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3.5)
  ctx.fillText((finishS ? r.chronoLabel : 'Distance').toUpperCase(), cx, ty)
  setSpacing(ctx, 0)
  const big = finishS ? formatElapsed(finishS) : r.distance
  const bs = fitFont(ctx, big, 700, SERIF, 66, 30, colW)
  ctx.fillStyle = fg(1)
  ty += 10 + bs * 0.82
  ctx.fillText(big, cx, ty)
  ty += 16
  ctx.strokeStyle = fg(0.2); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx, ty); ctx.lineTo(R, ty); ctx.stroke()
  const facts: [string, string][] = []
  if (r.show('bib') && r.bib) facts.push(['Dossard', r.bib])
  if (r.show('rank') && r.rank) facts.push(['Classement', r.rank])
  if (r.pace) facts.push(['Allure moyenne', r.pace])
  facts.forEach(([label, value]) => {
    ty += 24
    ctx.font = `14px ${SANS}`; ctx.fillStyle = fg(0.7); ctx.fillText(label, cx, ty)
    ctx.font = `700 15px ${SANS}`; ctx.fillStyle = fg(1); ctx.fillText(value, cx + 112, ty)
  })
  if (shown[1]) {
    const pTop = Math.max(ty + 22, H * 0.695)
    if (blockBottom - pTop > 60) drawPhoto(ctx, shown[1], cx, pTop, colW, blockBottom - pTop, k, 6)
  }

  if (profH) drawProfile(ctx, data, r, theme, L, profY, CW, profH)

  if (signature) {
    ctx.textAlign = 'left'; ctx.font = `13px ${SANS}`; ctx.fillStyle = fg(0.65)
    ctx.fillText('Une course. Des souvenirs. Toujours plus loin.', L, H - 22)
    ctx.textAlign = 'right'; ctx.font = `700 15px ${SERIF}`; ctx.fillStyle = fg(0.9)
    ctx.fillText('Sillonphane', R, H - 22)
  }
  return true
}

/**
 * Dessine l'affiche sur `canvas`, à `widthPx` pixels de large (hauteur selon le format). `isLive` permet d'abandonner
 * un dessin devenu inutile (réglage modifié pendant le chargement des tuiles). Renvoie false s'il a été abandonné.
 * `signature` : « Sillonphane » sur l'affiche (format carré, pour les réseaux) ; jamais sur le tirage.
 */
export async function drawPoster(canvas: HTMLCanvasElement, widthPx: number, data: PosterData, settings: PosterSettings,
  photos: HTMLImageElement[], isLive: () => boolean = () => true, signature = !posterFormat(settings).print): Promise<boolean> {
  await loadFonts()
  const r = resolvePoster(data, settings)
  const theme = makeTheme(r.fond.color)
  const k = widthPx / POSTER_W

  // Dessin hors écran, recopié d'un coup : l'aperçu ne clignote pas pendant le chargement des tuiles.
  const work = document.createElement('canvas')
  work.width = Math.round(widthPx); work.height = Math.round(widthPx * r.H / POSTER_W)
  const ctx = work.getContext('2d')!
  ctx.scale(k, k)
  paintPaper(ctx, POSTER_W, r.H, r.fond)

  const ok = r.style === 'souvenir'
    ? await drawSouvenir(ctx, data, r, theme, photos, k, isLive, signature)
    : r.style === 'sportif' && r.format.id !== 'carre'
      ? await drawModel3(ctx, data, r, theme, photos, k, isLive, signature)
      : await drawClassic(ctx, data, r, theme, photos, k, isLive, signature)
  if (!ok || !isLive()) return false
  canvas.width = work.width; canvas.height = work.height
  canvas.getContext('2d')!.drawImage(work, 0, 0)
  return true
}

/** Rend l'affiche en JPEG au format choisi (A3/A4 à 300 dpi pour le tirage, carré 1080 px pour les réseaux). */
export async function exportPoster(data: PosterData, settings: PosterSettings, photos: HTMLImageElement[]): Promise<Blob> {
  const canvas = document.createElement('canvas')
  await drawPoster(canvas, posterFormat(settings).exportW, data, settings, photos)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export de l\'affiche impossible'))), 'image/jpeg', 0.92))
}
