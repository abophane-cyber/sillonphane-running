// Affiche de course (remplace l'album pour Running) : une page 3:4 par course — titre, tracé du ruban sur un fond au
// choix (vues aériennes IGN assombries, Plan IGN nuit ou clair, uni), bornes, temps, temps de passage, profil et
// jusqu'à deux photos. Dessinée sur un canvas, à n'importe quelle taille : aperçu à l'écran, image pour les réseaux ou
// fichier 30 × 40 cm à 300 dpi pour le tirage. Maquette d'origine : maquettes/affiche-course.html.
import type { GpxPoint, VoyageTrack, PosterSettings, PosterBackground, PosterInfo } from '../types'
import { parseGpx, parseKml, buildDistanceArray } from './gpx'
import {
  analyzeRace, computeBornes, formatBannerDate, formatBannerDistance, formatElapsed, formatPace, hasRealTimes,
  parseEventName, type Borne, type RaceAnalysis,
} from './raceSplits'
import { BASEMAP_TILE_URL, IGN_TILE_URL } from './tileSources'

/** Unités de dessin : l'affiche est conçue à 720 × 960 puis mise à l'échelle. */
export const POSTER_W = 720
export const POSTER_H = 960
/** Tirage 30 × 40 cm à 300 dpi. */
export const POSTER_PRINT_PX = { w: 3543, h: 4724 }
/** Image pour les réseaux (3:4). */
export const POSTER_SOCIAL_PX = { w: 1080, h: 1440 }
export const POSTER_MAX_PHOTOS = 2

export const POSTER_BACKGROUNDS: { id: PosterBackground; label: string }[] = [
  { id: 'sat', label: 'Vues aériennes' },
  { id: 'plan-nuit', label: 'Plan nuit' },
  { id: 'clair', label: 'Plan clair' },
  { id: 'uni', label: 'Uni' },
]
/** Couleurs de papier proposées (le sélecteur de couleur permet aussi une teinte libre). */
export const POSTER_PAPERS: { color: string; label: string }[] = [
  { color: '#121714', label: 'Vert nuit' },
  { color: '#0E0E0E', label: 'Noir' },
  { color: '#25282D', label: 'Anthracite' },
  { color: '#15213A', label: 'Bleu nuit' },
  { color: '#3B1A1C', label: 'Bordeaux' },
  { color: '#F4EFE5', label: 'Crème' },
  { color: '#FFFFFF', label: 'Blanc' },
]
/** Papier par défaut : crème avec le Plan clair, vert nuit sinon. */
export function defaultPaper(background: PosterBackground): string {
  return background === 'clair' ? '#F4EFE5' : '#121714'
}
export const POSTER_INFOS: { id: PosterInfo; label: string; needsTimes?: boolean }[] = [
  { id: 'bib', label: 'Dossard' },
  { id: 'rank', label: 'Classement' },
  { id: 'pace', label: 'Allure moyenne' },
  { id: 'splits', label: 'Temps de passage', needsTimes: true },
  { id: 'notes', label: 'Meilleur km, moitiés', needsTimes: true },
  { id: 'profile', label: 'Profil' },
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
  defaults: { title: string; subtitle: string; chrono: string; bib: string }
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
  const subtitle = [
    formatBannerDistance(officialM).toLowerCase(),
    formatBannerDate(track.date),
    parsedName.place ?? place,
  ].filter(Boolean).join(' · ')
  return {
    points, distances, total, officialM,
    bornes: computeBornes(points, distances, { useRealTimes: false }),
    analysis, gpxDurationS,
    defaults: {
      title: parsedName.title ?? track.name,
      subtitle,
      chrono: gpxDurationS ? formatChronoInput(gpxDurationS) : '',
      bib: track.panelBibNumber ?? '',
    },
  }
}

/** Réglages effectifs : saisie de l'utilisateur, sinon valeurs tirées du tracé. */
export function resolvePoster(data: PosterData, s: PosterSettings) {
  const hidden = new Set(s.hidden ?? [])
  const chronoText = s.chrono ?? data.defaults.chrono
  const chronoS = parseChrono(chronoText)
  return {
    title: s.title ?? data.defaults.title,
    subtitle: s.subtitle ?? data.defaults.subtitle,
    chronoS,
    /** Temps saisi par l'utilisateur (« temps officiel ») ou lu dans le GPX (« temps »). */
    chronoLabel: s.chrono != null && s.chrono.trim() ? 'Temps officiel' : 'Temps',
    bib: (s.bib ?? data.defaults.bib).trim(),
    rank: (s.rank ?? '').trim(),
    background: s.background ?? 'sat',
    paper: s.paper ?? defaultPaper(s.background ?? 'sat'),
    show: (k: PosterInfo) => !hidden.has(k),
  }
}

/** Temps de passage affichés : 4 au plus, puis l'arrivée (pas de 1, 2, 5 ou 10 km selon la distance). */
function posterSplits(data: PosterData, finishS: number | undefined) {
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
    const restKm = data.officialM / 1000 - prevKm
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

// ── Dessin ───────────────────────────────────────────────────────────────────

/** Couleurs du logo Sillonphane (dégradé du sillon, de bas en haut), reprises par le ruban de l'affiche. */
const LOGO_FOREST = '#2F4839'
const LOGO_TERRACOTTA = '#C15C3D'
const LOGO_CREAM = '#F5F3EF'

/** Dégradé du logo : vert forêt (0, en bas) → terracotta (0,5) → crème (1, en haut). */
const LOGO_STOPS: [number, string][] = [[0, LOGO_FOREST], [0.5, LOGO_TERRACOTTA], [1, LOGO_CREAM]]

/** Couleur du dégradé du logo à la hauteur `f` (0 = bas, 1 = haut). */
function logoColorAt(f: number): string {
  const x = Math.max(0, Math.min(1, f))
  return x <= 0.5 ? mixHex(LOGO_FOREST, LOGO_TERRACOTTA, x / 0.5) : mixHex(LOGO_TERRACOTTA, LOGO_CREAM, (x - 0.5) / 0.5)
}

interface Theme { fg: string; bg: string; mapBg: string; outline: string; accent: string }

/** Luminance relative (0 = noir, 1 = blanc) d'une couleur « #RRGGBB ». */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16)
  const c = [16, 8, 0].map(sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t))
  return `rgb(${c.join(',')})`
}

/** Couleurs de l'affiche selon la couleur du papier : texte crème sur papier foncé, encre sur papier clair. */
function makeTheme(paper: string, background: PosterBackground): Theme {
  const light = luminance(paper) > 0.4
  return {
    fg: light ? '25,24,23' : '244,237,224',
    bg: paper,
    // Fond uni : le papier, à peine assombri ou éclairci pour détacher la carte.
    mapBg: background === 'uni' ? mixHex(paper, light ? '#000000' : '#ffffff', 0.05) : light ? '#E9E3D6' : '#1b221d',
    outline: light ? 'rgba(25,24,23,0.55)' : 'rgba(10,16,12,0.75)',
    accent: light ? '#C15C3D' : '#D97A3D',
  }
}

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

const wx = (lon: number, z: number) => (lon + 180) / 360 * 256 * 2 ** z
const wy = (lat: number, z: number) => {
  const s = Math.sin(lat * Math.PI / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z
}

/** Carte (fond + ruban + bornes) dans le rectangle (x, y, w, h) en unités, `k` = pixels par unité. */
async function drawMap(ctx: CanvasRenderingContext2D, data: PosterData, bg: PosterBackground, theme: Theme,
  x: number, y: number, w: number, h: number, k: number, isLive: () => boolean) {
  const { points, distances, total } = data
  const W = Math.round(w * k), H = Math.round(h * k), PAD = 34 * k
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon)
  const x0 = wx(Math.min(...lons), 0), x1 = wx(Math.max(...lons), 0)
  const y0 = wy(Math.max(...lats), 0), y1 = wy(Math.min(...lats), 0)
  const zf = Math.min(18, Math.log2(Math.min((W - 2 * PAD) / Math.max(1e-9, x1 - x0), (H - 2 * PAD) / Math.max(1e-9, y1 - y0))))
  const cx = (x0 + x1) / 2 * 2 ** zf, cy = (y0 + y1) / 2 * 2 ** zf
  const px = (p: { lat: number; lon: number }) => wx(p.lon, zf) - cx + W / 2
  const py = (p: { lat: number; lon: number }) => wy(p.lat, zf) - cy + H / 2

  // Fond sur un canvas à part : les opérations de couleur (désaturation, inversion) ne touchent que la carte.
  const off = document.createElement('canvas')
  off.width = W; off.height = H
  const m = off.getContext('2d')!
  m.fillStyle = theme.mapBg
  m.fillRect(0, 0, W, H)
  if (bg !== 'uni') {
    const zt = Math.max(0, Math.min(18, Math.round(zf))), sc = 2 ** (zf - zt)
    const ox = cx / sc - W / 2 / sc, oy = cy / sc - H / 2 / sc
    const tpl = bg === 'sat' ? BASEMAP_TILE_URL : IGN_TILE_URL
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
    if (!isLive()) return
    const op = (mode: GlobalCompositeOperation, fill: string) => {
      m.globalCompositeOperation = mode; m.fillStyle = fill; m.fillRect(0, 0, W, H)
    }
    if (bg === 'sat') { op('saturation', 'rgba(128,128,128,0.45)'); op('source-over', 'rgba(8,12,10,0.58)') }
    if (bg === 'plan-nuit') { op('difference', '#fff'); op('saturation', 'rgba(128,128,128,0.7)'); op('source-over', 'rgba(8,12,10,0.38)') }
    if (bg === 'clair') { op('saturation', 'rgba(128,128,128,0.75)'); op('source-over', 'rgba(244,239,229,0.22)') }
    m.globalCompositeOperation = 'source-over'
  }

  // Ruban : une seule ligne peinte comme le sillon du logo — dégradé vertical sur l'emprise du tracé, vert forêt en
  // bas, terracotta au milieu, crème en haut — posée sur un liseré sombre (le carré noir du logo).
  const ys = points.map(py)
  const yBottom = Math.max(...ys), yTop = Math.min(...ys)
  const heightAt = (y: number) => (yBottom - y) / Math.max(1, yBottom - yTop) // 0 = bas, 1 = haut
  const grad = m.createLinearGradient(0, yBottom, 0, yTop)
  LOGO_STOPS.forEach(([at, c]) => grad.addColorStop(at, c))
  m.lineJoin = 'round'; m.lineCap = 'round'
  const trace = () => { m.beginPath(); points.forEach((p, i) => (i ? m.lineTo(px(p), py(p)) : m.moveTo(px(p), py(p)))) }
  trace(); m.strokeStyle = theme.outline; m.lineWidth = 10 * k; m.stroke()
  trace(); m.strokeStyle = grad; m.lineWidth = 6 * k; m.stroke()

  // Bornes tous les 5 km (le semi n'est pas repris : la borne des 20 km suffit), départ et arrivée.
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  m.textAlign = 'center'; m.textBaseline = 'middle'
  for (const b of data.bornes.filter(b => Number.isInteger(b.km))) {
    const bx = px(b), by = py(b)
    m.beginPath(); m.arc(bx, by, 12 * k, 0, Math.PI * 2)
    m.fillStyle = theme.bg; m.fill()
    m.lineWidth = 2 * k; m.strokeStyle = logoColorAt(heightAt(by)); m.stroke()
    m.fillStyle = fg(1); m.font = `800 ${11 * k}px ${SANS}`
    m.fillText(String(b.km), bx, by + 0.5 * k)
  }
  // Pastilles du logo : départ crème plein, arrivée vert forêt cerclée de crème.
  const flag = (p: GpxPoint, label: string, fill: string, ring: string | null, dy: number) => {
    m.beginPath(); m.arc(px(p), py(p), 7 * k, 0, Math.PI * 2)
    m.fillStyle = fill; m.fill()
    if (ring) { m.lineWidth = 2.5 * k; m.strokeStyle = ring; m.stroke() }
    m.textAlign = 'left'; m.font = `700 ${10 * k}px ${SANS}`; setSpacing(m, 1.5 * k)
    m.fillStyle = fg(1); m.fillText(label, px(p) + 11 * k, py(p) + dy * k)
    setSpacing(m, 0)
  }
  flag(points[0], 'DÉPART', LOGO_CREAM, null, 12)
  flag(points[points.length - 1], 'ARRIVÉE', LOGO_FOREST, LOGO_CREAM, -10)

  m.textAlign = 'right'; m.textBaseline = 'alphabetic'
  m.font = `${9 * k}px ${SANS}`; m.fillStyle = fg(0.55)
  if (bg !== 'uni') m.fillText(bg === 'sat' ? 'Vues aériennes © IGN' : 'Plan © IGN', W - 8 * k, H - 7 * k)

  ctx.save()
  roundRect(ctx, x, y, w, h, 6)
  ctx.clip()
  ctx.drawImage(off, x, y, w, h)
  ctx.restore()
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / r, sh = h / r
  ctx.save()
  roundRect(ctx, x, y, w, h, 6)
  ctx.clip()
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h)
  ctx.restore()
}

/** Plus grande taille de police (≤ `max`) pour que `text` tienne dans `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, min: number, width: number) {
  let size = max
  for (; size > min; size -= 1) {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= width) break
  }
  return size
}

/**
 * Dessine l'affiche sur `canvas`, à `widthPx` pixels de large (hauteur = 4/3). `isLive` permet d'abandonner un
 * dessin devenu inutile (réglage modifié pendant le chargement des tuiles). Renvoie false s'il a été abandonné.
 */
export async function drawPoster(canvas: HTMLCanvasElement, widthPx: number, data: PosterData, settings: PosterSettings,
  photos: HTMLImageElement[], isLive: () => boolean = () => true, signature = true): Promise<boolean> {
  await loadFonts()
  const r = resolvePoster(data, settings)
  const theme = makeTheme(r.paper, r.background)
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const k = widthPx / POSTER_W

  // Dessin hors écran, recopié d'un coup : l'aperçu ne clignote pas pendant le chargement des tuiles.
  const work = document.createElement('canvas')
  work.width = Math.round(widthPx); work.height = Math.round(widthPx * POSTER_H / POSTER_W)
  const ctx = work.getContext('2d')!
  ctx.scale(k, k)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, POSTER_W, POSTER_H)

  const L = 34, R = POSTER_W - 34, CW = R - L
  const finishS = r.chronoS
  const hasTimes = !!data.analysis
  const splits = r.show('splits') && hasTimes ? posterSplits(data, finishS) : []
  const notes = r.show('notes') && hasTimes ? data.analysis! : undefined

  // En-tête
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  ctx.fillStyle = theme.accent; ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3.5)
  ctx.fillText(finishS ? 'FINISHER' : 'PARCOURS', L, 46)
  setSpacing(ctx, 0)
  const titleSize = fitFont(ctx, r.title, 700, SERIF, 46, 26, CW)
  ctx.fillStyle = fg(1)
  ctx.fillText(r.title, L, 64 + titleSize * 0.82)
  ctx.font = `15px ${SANS}`; setSpacing(ctx, 0.6); ctx.fillStyle = fg(0.75)
  ctx.fillText(r.subtitle, L, 136)
  setSpacing(ctx, 0)

  // Bas de l'affiche, de bas en haut : pied, profil, notes, temps de passage, ligne du temps → la carte prend le reste.
  let bottom = POSTER_H - 22
  const footY = bottom; bottom -= 22
  let profileY: number | undefined
  if (r.show('profile')) { profileY = bottom - 74; bottom = profileY - 10 }
  let notesY: number | undefined
  if (notes) { notesY = bottom; bottom -= 26 }
  let splitsY: number | undefined
  if (splits.length) { splitsY = bottom - 64; bottom = splitsY - 18 }
  const timeY = bottom // ligne de base du grand chiffre
  const mapTop = 156, mapBottom = timeY - 112

  // Carte et photos
  const photoW = photos.length ? 200 : 0
  const mapW = CW - (photoW ? photoW + 12 : 0)
  await drawMap(ctx, data, r.background, theme, L, mapTop, mapW, mapBottom - mapTop, k, isLive)
  if (!isLive()) return false
  if (photos.length) {
    const gap = 12, ph = (mapBottom - mapTop - gap * (photos.length - 1)) / photos.length
    photos.forEach((img, i) => drawCover(ctx, img, R - photoW, mapTop + i * (ph + gap), photoW, ph))
  }

  // Temps (ou distance si aucun temps)
  ctx.textAlign = 'left'
  ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3); ctx.fillStyle = fg(0.6)
  ctx.fillText((finishS ? r.chronoLabel : 'Distance').toUpperCase(), L, timeY - 70)
  setSpacing(ctx, 0)
  ctx.font = `700 78px ${SERIF}`; ctx.fillStyle = fg(1)
  ctx.fillText(finishS ? formatElapsed(finishS) : formatBannerDistance(data.officialM).toLowerCase(), L, timeY)
  const facts: [string, string][] = []
  if (r.show('bib') && r.bib) facts.push(['Dossard', r.bib])
  if (r.show('rank') && r.rank) facts.push(['Classement', r.rank])
  if (r.show('pace') && finishS) facts.push(['Allure moyenne', formatPace(finishS / (data.officialM / 1000))])
  ctx.textAlign = 'right'
  facts.forEach(([label, value], i) => {
    const fy = timeY - 6 - (facts.length - 1 - i) * 21
    ctx.font = `700 13px ${SANS}`; ctx.fillStyle = fg(1)
    ctx.fillText(value, R, fy)
    const vw = ctx.measureText(value).width
    ctx.font = `13px ${SANS}`; ctx.fillStyle = fg(0.55)
    ctx.fillText(label, R - vw - 16, fy)
  })

  // Temps de passage
  if (splitsY != null) {
    ctx.strokeStyle = fg(0.18); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(L, splitsY); ctx.lineTo(R, splitsY); ctx.moveTo(L, splitsY + 64); ctx.lineTo(R, splitsY + 64); ctx.stroke()
    const cw = CW / splits.length
    ctx.textAlign = 'center'
    splits.forEach((c, i) => {
      const cx = L + cw * (i + 0.5)
      if (i) { ctx.strokeStyle = fg(0.12); ctx.beginPath(); ctx.moveTo(L + cw * i, splitsY + 8); ctx.lineTo(L + cw * i, splitsY + 56); ctx.stroke() }
      ctx.fillStyle = theme.accent; ctx.font = `700 10px ${SANS}`; setSpacing(ctx, 2)
      ctx.fillText(c.label.toUpperCase(), cx, splitsY + 19)
      setSpacing(ctx, 0)
      ctx.fillStyle = fg(1); ctx.font = `700 ${splits.length > 4 ? 18 : 20}px ${SANS}`
      ctx.fillText(c.time, cx, splitsY + 41)
      ctx.fillStyle = fg(0.6); ctx.font = `11px ${SANS}`
      ctx.fillText(c.pace, cx, splitsY + 56)
    })
  }

  // Meilleur et moins bon km, moitiés
  if (notesY != null && notes) {
    const mmss = (s: number) => formatElapsed(s)
    const parts: [string, string][] = [
      ['Meilleur km : ', `${notes.best.km}e · ${mmss(notes.best.s)}`],
      ['Moins bon : ', `${notes.worst.km}e · ${mmss(notes.worst.s)}`],
      ['Moitiés : ', `${mmss(notes.halvesS[0])} / ${mmss(notes.halvesS[1])}`],
    ]
    const aligns: CanvasTextAlign[] = ['left', 'center', 'right']
    const xs = [L, L + CW / 2, R]
    parts.forEach(([label, value], i) => {
      ctx.font = `12px ${SANS}`
      const lw = ctx.measureText(label).width
      ctx.font = `700 12px ${SANS}`
      const vw = ctx.measureText(value).width
      const start = aligns[i] === 'left' ? xs[i] : aligns[i] === 'center' ? xs[i] - (lw + vw) / 2 : xs[i] - lw - vw
      ctx.textAlign = 'left'
      ctx.font = `12px ${SANS}`; ctx.fillStyle = fg(0.75); ctx.fillText(label, start, notesY!)
      ctx.font = `700 12px ${SANS}`; ctx.fillStyle = fg(1); ctx.fillText(value, start + lw, notesY!)
    })
  }

  // Profil d'altitude
  if (profileY != null) drawProfile(ctx, data, theme, L, profileY, CW, 74)

  // Signature : sur l'aperçu et l'image pour les réseaux, jamais sur le tirage.
  if (signature) {
    ctx.textAlign = 'right'; ctx.font = `700 13px ${SERIF}`; ctx.fillStyle = fg(0.7)
    ctx.fillText('Sillonphane', R, footY)
  }

  if (!isLive()) return false
  canvas.width = work.width; canvas.height = work.height
  canvas.getContext('2d')!.drawImage(work, 0, 0)
  return true
}

function drawProfile(ctx: CanvasRenderingContext2D, data: PosterData, theme: Theme, x: number, y: number, w: number, h: number) {
  const { points, distances, total } = data
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const top = y + 6, base = y + h - 14
  const n = points.length
  const sm = points.map((_, i) => {
    let s = 0, c = 0
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { s += points[j].ele; c++ }
    return s / c
  })
  const lo = Math.min(...sm) - 3, hi = Math.max(...sm) + 3
  const X = (d: number) => x + d / total * w
  const Y = (e: number) => base - (e - lo) / (hi - lo) * (base - top)
  const grad = ctx.createLinearGradient(x, 0, x + w, 0)
  LOGO_STOPS.forEach(([at, c]) => grad.addColorStop(at, c))
  ctx.beginPath()
  ctx.moveTo(x, base)
  sm.forEach((e, i) => ctx.lineTo(X(distances[i]), Y(e)))
  ctx.lineTo(x + w, base)
  ctx.closePath()
  ctx.globalAlpha = 0.28; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1
  ctx.beginPath()
  sm.forEach((e, i) => (i ? ctx.lineTo(X(distances[i]), Y(e)) : ctx.moveTo(X(distances[i]), Y(e))))
  ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.stroke()
  const step = total > 25000 ? 10 : 5
  ctx.font = `9px ${SANS}`; ctx.fillStyle = fg(0.55); ctx.strokeStyle = fg(0.45); ctx.lineWidth = 1
  for (let km = 0; km * 1000 <= total; km += step) {
    const tx = Math.min(x + w - 1, X(km * 1000))
    ctx.beginPath(); ctx.moveTo(tx, base); ctx.lineTo(tx, base + 4); ctx.stroke()
    ctx.textAlign = km ? 'center' : 'left'
    ctx.fillText(`${km} km`, tx, y + h - 1)
  }
  ctx.textAlign = 'right'
  ctx.fillText(`${Math.round(Math.min(...sm))} – ${Math.round(Math.max(...sm))} m`, x + w, top + 8)
}

/** Rend l'affiche en JPEG à la taille demandée (tirage ou réseaux). */
export async function exportPoster(data: PosterData, settings: PosterSettings, photos: HTMLImageElement[], widthPx: number,
  signature: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas')
  await drawPoster(canvas, widthPx, data, settings, photos, () => true, signature)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export de l\'affiche impossible'))), 'image/jpeg', 0.92))
}
