// Export du livre de Mes sillons (cf. lib/book.ts), au format de l'imprimeur choisi :
// - WhiteWall : pages paysage 27,3 × 21,1 cm (fond perdu 3 mm inclus), deux PDF comme le demande son éditeur :
//   l'intérieur, et la couverture à plat (4e de couverture | dos | 1re de couverture, dos selon le nombre de pages).
// - Flexilivre : A4 paysage 29,7 × 21 cm sans fond perdu (photos à distance du bord), un seul PDF : 1re de couverture,
//   pages intérieures, 4e de couverture.
// Pages intérieures dessinées une à une sur canvas à 300 dpi. Page 1 (à droite) : titre ; 2 | 3 : records |
// progression ; 4 | 5 : palmarès | sommaire ; puis une double page par course (affiche | carnet), suivie en option
// d'une double page photos ; pages blanches jusqu'au multiple de 4 (minimum de l'imprimeur), la dernière portant
// l'adresse du site en petit.
// Les photos d'une course ne sont chargées que le temps de dessiner ses pages (mémoire du téléphone).
import type { PosterSettings, VoyagePhoto } from '../types'
import type { BookCourse, BookPrinterInfo } from './book'
import { printedPageCount } from './book'
import {
  buildPosterData, colorAtStops, drawPhoto, drawPoster, drawProfile, fitFont, loadFonts, posterHeight, resolvePoster,
  ribbonStops, roundRect, setSpacing, wrapFit, POSTER_W, SANS, SERIF, type PosterData, type Resolved, type Theme,
} from './poster'
import { formatElapsed, formatPace, type RaceAnalysis } from './raceSplits'
import { RECORD_CATEGORIES, type RecordCategory } from './records'
import { wrapSpreadForPages } from './printProfiles'
import { getPhotoBlob } from './voyageDB'
import { sanitizeFilename } from './saveFile'

const DPI = 300
const PX_PER_MM = DPI / 25.4
/** Unités de dessin d'une page : 1000 de large ; hauteur selon le format de l'imprimeur (fixée par prepareBook). */
const UW = 1000
let UH = 773
/** Photo pleine page jusqu'au bord : seulement avec un fond perdu (WhiteWall) ; sinon, marges (Flexilivre). */
let fullBleed = true
/** Marge intérieure (≈ 1,7 cm), bien au-delà du fond perdu de 3 mm. */
const M = 62
/** Photos d'une course : 2 dans le carnet, 8 au plus sur sa double page photos. */
const MAX_PHOTOS = 8

const PAPER = '#F6F2EA'
const INK = '25,24,23'
const ACCENT = '#C15C3D'
const GREEN = '#2F7A3E'
const NIGHT = '#121714'
const CREAM = '244,237,224'
const ink = (a: number) => `rgba(${INK},${a})`
const cream = (a: number) => `rgba(${CREAM},${a})`
const THEME: Theme = { light: true, fg: INK, bg: PAPER, accent: '#E4602A' }
/** Ruban de la couverture et de la page de titre : vert · orange · crème, signature du site. */
const TRACE_STOPS = ribbonStops('trois-couleurs')

export interface BookOptions {
  title: string
  name: string
  photoSpreads: boolean
  printer: BookPrinterInfo
}

export interface PreparedBook {
  /** Fichiers à enregistrer, dans l'ordre : WhiteWall = intérieur puis couverture ; Flexilivre = un seul. */
  files: { blob: Blob; name: string; label: string }[]
  /** Pages intérieures (hors couverture), à indiquer chez l'imprimeur. */
  pages: number
}

/** Course prête à dessiner. */
interface Entry {
  course: BookCourse
  data: PosterData
  settings: PosterSettings
  r: Resolved
  category?: RecordCategory
  /** Temps retenu (saisi sur l'affiche, sinon durée du GPX). */
  timeS?: number
  /** Photos de la course : celles de l'affiche d'abord, puis les autres par date. */
  photos: VoyagePhoto[]
  /** Page (numéro dans le livre) de son affiche. */
  page: number
}

type Page =
  | { kind: 'title' } | { kind: 'records' } | { kind: 'progress' } | { kind: 'palmares' } | { kind: 'toc' }
  | { kind: 'poster'; e: Entry } | { kind: 'carnet'; e: Entry } | { kind: 'photos'; e: Entry; half: 0 | 1 }
  | { kind: 'blank' } | { kind: 'colophon' }

// ── Outils ───────────────────────────────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function formatDateLong(iso: string): string {
  if (!iso) return ''
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
function formatDateShort(iso: string): string {
  if (!iso) return ''
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function formatMonth(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}
/** « 4'53" » (allure sans « /km »). */
const pace = (sPerKm: number) => formatPace(sPerKm).replace('/km', '')

function periodLabel(entries: Entry[]): string {
  const years = [...new Set(entries.map(e => e.course.date.slice(0, 4)))].sort()
  if (!years.length) return ''
  return years.length === 1 ? years[0] : `${years[0]} — ${years[years.length - 1]}`
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string,
  align: CanvasTextAlign = 'left', spacing = 0) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  setSpacing(ctx, spacing)
  ctx.fillText(s, x, y)
  setSpacing(ctx, 0)
}

/** Coupe `s` avec « … » pour tenir dans `w` (police déjà posée). */
function ellipsize(ctx: CanvasRenderingContext2D, s: string, w: number): string {
  if (ctx.measureText(s).width <= w) return s
  let t = s
  while (t.length > 1 && ctx.measureText(`${t}…`).width > w) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Petite capitale d'en-tête de page : « RECORDS », numéro de page en bas, côté extérieur. */
function pageHead(ctx: CanvasRenderingContext2D, kicker: string, title: string) {
  text(ctx, kicker.toUpperCase(), M, M + 10, `700 11px ${SANS}`, ACCENT, 'left', 3)
  text(ctx, title, M, M + 58, `600 44px ${SERIF}`, ink(0.95))
  ctx.strokeStyle = ink(0.18); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(M, M + 78); ctx.lineTo(UW - M, M + 78); ctx.stroke()
}

function folio(ctx: CanvasRenderingContext2D, n: number) {
  const right = n % 2 === 1
  text(ctx, String(n), right ? UW - M : M, UH - 30, `600 11px ${SANS}`, ink(0.45), right ? 'right' : 'left', 1)
}

/** Tracés des courses en vignettes, au ruban vert · orange · crème, dans le cadre donné. */
function drawTraces(ctx: CanvasRenderingContext2D, entries: Entry[], x: number, y: number, w: number, h: number, lineW: number) {
  const n = entries.length
  if (!n) return
  const cols = Math.max(1, Math.round(Math.sqrt(n * w / h)))
  const rows = Math.ceil(n / cols)
  const cw = w / cols, ch = h / rows
  entries.forEach((e, i) => {
    const pts = e.data.points
    if (pts.length < 2) return
    const col = i % cols, row = Math.floor(i / cols)
    // Dernière rangée incomplète : centrée.
    const inRow = row === rows - 1 ? n - row * cols : cols
    const ox = x + (w - inRow * cw) / 2 + col * cw, oy = y + row * ch
    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length
    const kx = Math.cos(lat0 * Math.PI / 180)
    const xs = pts.map(p => p.lon * kx), ys = pts.map(p => -p.lat)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = Math.min(cw, ch) * 0.14
    const s = Math.min((cw - 2 * pad) / Math.max(1e-9, maxX - minX), (ch - 2 * pad) / Math.max(1e-9, maxY - minY))
    const dx = ox + (cw - (maxX - minX) * s) / 2, dy = oy + (ch - (maxY - minY) * s) / 2
    const X = (j: number) => dx + (xs[j] - minX) * s, Y = (j: number) => dy + (ys[j] - minY) * s
    ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const step = Math.max(1, Math.floor(pts.length / 400))
    for (let j = step; j < pts.length; j += step) {
      ctx.strokeStyle = colorAtStops(TRACE_STOPS, j / pts.length)
      ctx.beginPath(); ctx.moveTo(X(j - step), Y(j - step)); ctx.lineTo(X(j), Y(j)); ctx.stroke()
    }
  })
}

// ── Pages d'en-tête ──────────────────────────────────────────────────────────

function drawTitlePage(ctx: CanvasRenderingContext2D, entries: Entry[], o: BookOptions) {
  drawTraces(ctx, entries, M + 40, M + 30, UW - 2 * M - 80, UH * 0.46, 3)
  const cx = UW / 2
  const t = wrapFit(ctx, o.title, 600, SERIF, 64, 30, UW - 2 * M - 80, 2)
  let y = UH * 0.46 + M + 90
  t.lines.forEach(l => { text(ctx, l, cx, y, `600 ${t.size}px ${SERIF}`, ink(0.95), 'center'); y += t.size * 1.12 })
  text(ctx, periodLabel(entries), cx, y + 8, `600 16px ${SANS}`, ACCENT, 'center', 4)
  const km = entries.reduce((s, e) => s + e.data.officialM, 0) / 1000
  const meta = `${entries.length} course${entries.length > 1 ? 's' : ''} · ${Math.round(km).toLocaleString('fr-FR')} km`
  text(ctx, meta, cx, y + 40, `500 14px ${SANS}`, ink(0.6), 'center', 1)
  if (o.name) text(ctx, o.name, cx, UH - M - 6, `italic 500 22px ${SERIF}`, ink(0.85), 'center')
}

function bestByCategory(entries: Entry[]): Partial<Record<RecordCategory, Entry>> {
  const best: Partial<Record<RecordCategory, Entry>> = {}
  for (const e of entries) {
    if (!e.category || !e.timeS) continue
    if (!best[e.category] || e.timeS < best[e.category]!.timeS!) best[e.category] = e
  }
  return best
}

function drawRecords(ctx: CanvasRenderingContext2D, entries: Entry[]) {
  pageHead(ctx, 'Vos meilleurs temps', 'Records')
  const best = bestByCategory(entries)
  const top = M + 110, gap = 18
  const cw = (UW - 2 * M - gap) / 2, ch = (UH - top - M - 90 - gap) / 2
  RECORD_CATEGORIES.forEach((c, i) => {
    const x = M + (i % 2) * (cw + gap), y = top + Math.floor(i / 2) * (ch + gap)
    const e = best[c.id]
    roundRect(ctx, x, y, cw, ch, 10)
    ctx.fillStyle = e ? 'rgba(193,92,61,0.07)' : ink(0.03); ctx.fill()
    text(ctx, c.label.toUpperCase(), x + 22, y + 34, `700 13px ${SANS}`, e ? ACCENT : ink(0.4), 'left', 3)
    if (e) {
      text(ctx, formatElapsed(e.timeS!), x + 22, y + ch * 0.62, `600 ${Math.min(52, ch * 0.32)}px ${SERIF}`, ink(0.95))
      ctx.font = `500 13px ${SANS}`
      const line = ellipsize(ctx, `${e.r.title} · ${formatDateLong(e.course.date)}`, cw - 44)
      text(ctx, line, x + 22, y + ch - 24, `500 13px ${SANS}`, ink(0.6))
    } else {
      text(ctx, '—', x + 22, y + ch * 0.62, `600 40px ${SERIF}`, ink(0.25))
    }
  })
  // Totaux
  const km = entries.reduce((s, e) => s + e.data.officialM, 0) / 1000
  const timeS = entries.reduce((s, e) => s + (e.timeS ?? 0), 0)
  const items = [
    [String(entries.length), entries.length > 1 ? 'courses' : 'course'],
    [Math.round(km).toLocaleString('fr-FR'), 'km courus'],
    [timeS ? formatElapsed(timeS).replace(/'\d+"$/, '\'') : '—', 'de course'],
  ]
  const y = UH - M - 30, w = (UW - 2 * M) / items.length
  items.forEach(([v, l], i) => {
    text(ctx, v, M + w * i + w / 2, y, `600 30px ${SERIF}`, ink(0.9), 'center')
    text(ctx, l.toUpperCase(), M + w * i + w / 2, y + 24, `700 10px ${SANS}`, ink(0.5), 'center', 2.5)
  })
}

function drawProgress(ctx: CanvasRenderingContext2D, entries: Entry[]) {
  pageHead(ctx, 'Course après course', 'Progression')
  const cats = RECORD_CATEGORIES
    .map(c => ({ c, list: entries.filter(e => e.category === c.id && e.timeS) }))
    .filter(x => x.list.length)
  const top = M + 104
  if (!cats.length) {
    const t = wrapFit(ctx, 'Saisissez votre temps officiel sur l\'affiche de vos courses de 5 km, 10 km, semi ou marathon : leur progression s\'affichera ici.',
      400, SERIF, 22, 14, UW - 2 * M - 120, 4)
    t.lines.forEach((l, i) => text(ctx, l, UW / 2, top + 140 + i * t.size * 1.4, `italic 400 ${t.size}px ${SERIF}`, ink(0.6), 'center'))
    return
  }
  const cols = cats.length === 1 ? 1 : 2, rows = Math.ceil(cats.length / cols)
  const gap = 26
  const cw = (UW - 2 * M - gap * (cols - 1)) / cols, ch = (UH - top - M - gap * (rows - 1)) / rows
  cats.forEach(({ c, list }, i) => {
    const x = M + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap)
    const first = list[0].timeS!, best = Math.min(...list.map(e => e.timeS!))
    text(ctx, `${c.label.toUpperCase()} · ${list.length} COURSE${list.length > 1 ? 'S' : ''}`, x, y + 12, `700 12px ${SANS}`, ACCENT, 'left', 2.5)
    if (list.length > 1 && best < first) {
      text(ctx, `${formatElapsed(first)} → ${formatElapsed(best)}  (−${formatElapsed(first - best)})`, x + cw, y + 12,
        `600 12px ${SANS}`, GREEN, 'right')
    }
    // Graphique : plus rapide en haut.
    const gx = x + 8, gy = y + 46, gw = cw - 16, gh = ch - 92
    const times = list.map(e => e.timeS!)
    const lo = Math.min(...times), hi = Math.max(...times), span = Math.max(30, hi - lo)
    const Y = (t: number) => gy + ((t - (lo - span * 0.25)) / (span * 1.5)) * gh
    const X = (j: number) => (list.length === 1 ? gx + gw / 2 : gx + 20 + j * (gw - 40) / (list.length - 1))
    ctx.strokeStyle = ink(0.15); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.stroke()
    if (list.length > 1) {
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'
      ctx.beginPath(); list.forEach((e, j) => (j ? ctx.lineTo(X(j), Y(e.timeS!)) : ctx.moveTo(X(j), Y(e.timeS!)))); ctx.stroke()
    }
    const labels = list.length <= 10
    list.forEach((e, j) => {
      const isBest = e.timeS === best
      ctx.beginPath(); ctx.arc(X(j), Y(e.timeS!), isBest ? 6 : 4.5, 0, Math.PI * 2)
      ctx.fillStyle = isBest ? GREEN : ACCENT; ctx.fill()
      ctx.strokeStyle = PAPER; ctx.lineWidth = 2; ctx.stroke()
      if (labels) {
        text(ctx, formatElapsed(e.timeS!), X(j), Y(e.timeS!) - 12, `600 ${list.length > 6 ? 10 : 12}px ${SANS}`, ink(isBest ? 0.95 : 0.7), 'center')
        text(ctx, formatMonth(e.course.date), X(j), gy + gh + 18, `500 10px ${SANS}`, ink(0.5), 'center')
      }
    })
  })
}

function drawPalmares(ctx: CanvasRenderingContext2D, entries: Entry[]) {
  pageHead(ctx, 'Toutes vos courses', 'Palmarès')
  const top = M + 112, avail = UH - top - M - 10
  const rowH = Math.max(12, Math.min(30, avail / (entries.length + 1)))
  const fs = Math.max(7, Math.min(13, rowH * 0.48))
  const anyRank = entries.some(e => e.r.rank && e.r.show('rank'))
  const cols: { label: string; w: number; align: CanvasTextAlign }[] = [
    { label: 'Date', w: 90, align: 'left' },
    { label: 'Course', w: 0, align: 'left' },
    { label: 'Distance', w: 90, align: 'right' },
    { label: 'Temps', w: 110, align: 'right' },
    { label: 'Allure', w: 90, align: 'right' },
    ...(anyRank ? [{ label: 'Class.', w: 70, align: 'right' as CanvasTextAlign }] : []),
  ]
  const fixed = cols.reduce((s, c) => s + c.w, 0)
  cols[1].w = UW - 2 * M - fixed
  const colX: number[] = []
  cols.reduce((x, c) => { colX.push(x); return x + c.w }, M)
  const cellX = (i: number) => (cols[i].align === 'right' ? colX[i] + cols[i].w : colX[i])
  cols.forEach((c, i) => text(ctx, c.label.toUpperCase(), cellX(i), top, `700 ${Math.min(10, fs)}px ${SANS}`, ink(0.5), c.align, 2))
  entries.forEach((e, j) => {
    const y = top + (j + 1) * rowH
    if (j % 2 === 0) { ctx.fillStyle = ink(0.035); ctx.fillRect(M - 8, y - rowH * 0.68, UW - 2 * M + 16, rowH) }
    const km = e.r.distanceKm
    const cells = [
      formatDateShort(e.course.date),
      e.r.title,
      e.r.distance,
      e.timeS ? formatElapsed(e.timeS) : '—',
      e.timeS && km ? pace(e.timeS / km) : '—',
      ...(anyRank ? [e.r.rank && e.r.show('rank') ? e.r.rank : ''] : []),
    ]
    cells.forEach((v, i) => {
      ctx.font = `${i === 1 ? 600 : 500} ${fs}px ${i === 1 ? SERIF : SANS}`
      const s = i === 1 ? ellipsize(ctx, v, cols[i].w - 14) : v
      text(ctx, s, cellX(i), y, ctx.font, ink(i === 3 ? 0.95 : 0.75), cols[i].align)
    })
  })
}

function drawToc(ctx: CanvasRenderingContext2D, entries: Entry[]) {
  pageHead(ctx, 'Au fil des pages', 'Sommaire')
  const rows: [string, string, number][] = [
    ['Records', '', 2], ['Progression', '', 3], ['Palmarès', '', 4],
    ...entries.map(e => [e.r.title, formatDateLong(e.course.date), e.page] as [string, string, number]),
  ]
  const top = M + 118, avail = UH - top - M - 10
  const rowH = Math.max(12, Math.min(28, avail / rows.length))
  const fs = Math.max(7, Math.min(15, rowH * 0.55))
  rows.forEach(([title, sub, page], j) => {
    const y = top + j * rowH
    ctx.font = `${sub ? 600 : 500} ${fs}px ${SERIF}`
    const label = ellipsize(ctx, title, UW - 2 * M - 220)
    text(ctx, label, M, y, ctx.font, ink(sub ? 0.92 : 0.6))
    const lw = ctx.measureText(label).width
    let sw = 0
    if (sub) {
      ctx.font = `500 ${fs * 0.75}px ${SANS}`
      sw = ctx.measureText(sub).width
      text(ctx, sub, UW - M - 46, y, ctx.font, ink(0.5), 'right')
    }
    // Points de conduite
    ctx.fillStyle = ink(0.25)
    for (let x = M + lw + 10; x < UW - M - 56 - sw - 10; x += 7) ctx.fillRect(x, y - 2, 1.4, 1.4)
    text(ctx, String(page), UW - M, y, `600 ${fs}px ${SANS}`, ACCENT, 'right')
  })
}

// ── Pages d'une course ───────────────────────────────────────────────────────

async function drawPosterPage(ctx: CanvasRenderingContext2D, e: Entry, posterImgs: HTMLImageElement[], k: number) {
  const ratio = posterHeight(e.settings) / POSTER_W
  let h = UH - 2 * 44, w = h / ratio
  if (w > UW - 2 * M) { w = UW - 2 * M; h = w * ratio }
  const x = (UW - w) / 2, y = (UH - h) / 2
  const tmp = document.createElement('canvas')
  await drawPoster(tmp, Math.round(w * k), e.data, e.settings, posterImgs, () => true, false)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.drawImage(tmp, x, y, w, h)
  tmp.width = tmp.height = 0
}

function drawSplitsTable(ctx: CanvasRenderingContext2D, a: RaceAnalysis, x: number, y: number, w: number, h: number) {
  const n = a.kmSplitsS.length
  const rowsMax = Math.max(4, Math.floor((h - 22) / 17))
  const cols = Math.ceil(n / rowsMax), rows = Math.ceil(n / cols)
  const cw = w / cols
  const rowH = Math.min(19, (h - 22) / rows)
  const fs = Math.max(7, Math.min(12, rowH * 0.66, cw / 12))
  let cum = 0
  for (let c = 0; c < cols; c++) {
    const cx = x + c * cw
    text(ctx, 'KM', cx, y + 10, `700 ${Math.min(9, fs)}px ${SANS}`, ink(0.45), 'left', 1.5)
    text(ctx, 'PASSAGE', cx + cw * 0.55, y + 10, `700 ${Math.min(9, fs)}px ${SANS}`, ink(0.45), 'right', 1.5)
    text(ctx, 'ALLURE', cx + cw - 10, y + 10, `700 ${Math.min(9, fs)}px ${SANS}`, ink(0.45), 'right', 1.5)
  }
  a.kmSplitsS.forEach((s, i) => {
    cum += s
    const c = Math.floor(i / rows), r = i % rows
    const cx = x + c * cw, ry = y + 22 + (r + 0.75) * rowH
    const isBest = i + 1 === a.best.km, isWorst = i + 1 === a.worst.km
    const color = isBest ? GREEN : isWorst ? ACCENT : ink(0.8)
    text(ctx, String(i + 1), cx, ry, `600 ${fs}px ${SANS}`, ink(0.5))
    text(ctx, formatElapsed(cum), cx + cw * 0.55, ry, `500 ${fs}px ${SANS}`, ink(0.85), 'right')
    text(ctx, pace(s), cx + cw - 10, ry, `${isBest || isWorst ? 700 : 500} ${fs}px ${SANS}`, color, 'right')
  })
}

async function drawCarnet(ctx: CanvasRenderingContext2D, e: Entry, imgs: HTMLImageElement[], k: number, pageNo: number) {
  const { r, data } = e
  const kicker = [formatDateLong(e.course.date), r.city].filter(Boolean).join(' · ').toUpperCase()
  text(ctx, kicker, M, M + 10, `700 11px ${SANS}`, ACCENT, 'left', 3)
  const t = wrapFit(ctx, r.title, 600, SERIF, 38, 20, UW - 2 * M, 2)
  let y = M + 14
  t.lines.forEach(l => { y += t.size * 1.12; text(ctx, l, M, y, `600 ${t.size}px ${SERIF}`, ink(0.95)) })

  // Chiffres de la course
  const stats: [string, string][] = [
    [r.chronoLabel, r.chronoS ? formatElapsed(r.chronoS) : '—'],
    ['Distance', r.distance],
    ...(r.pace ? [['Allure', r.pace.replace(/\s*\/\s*km/, ' /km')] as [string, string]] : []),
    ...(e.course.track.elevGainM ? [['Dénivelé', `${Math.round(e.course.track.elevGainM)} m D+`] as [string, string]] : []),
    ...(r.bib && r.show('bib') ? [['Dossard', r.bib] as [string, string]] : []),
    ...(r.rank && r.show('rank') ? [['Classement', r.rank] as [string, string]] : []),
  ]
  y += 22
  const sw = (UW - 2 * M) / stats.length
  stats.forEach(([l, v], i) => {
    const sx = M + i * sw
    text(ctx, l.toUpperCase(), sx, y + 10, `700 9px ${SANS}`, ink(0.5), 'left', 2)
    fitFont(ctx, v, i === 0 ? 700 : 600, i === 0 ? SANS : SERIF, i === 0 ? 26 : 22, 11, sw - 12)
    text(ctx, v, sx, y + 40, ctx.font, i === 0 ? ACCENT : ink(0.9))
  })
  y += 62
  ctx.strokeStyle = ink(0.15); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(UW - M, y); ctx.stroke()

  // Bas de page : profil
  const profH = 112, profY = UH - M - profH
  if (data.points.length > 1) drawProfile(ctx, data, r, THEME, M, profY, UW - 2 * M, profH)

  // Colonne gauche : temps de passage ; colonne droite : note et photos.
  const bodyY = y + 22, bodyH = profY - 26 - bodyY
  const note = e.course.track.bookNote?.trim()
  const photos = imgs.slice(0, 2)
  const right = photos.length > 0 || !!note
  const leftW = right ? (UW - 2 * M) * 0.56 : UW - 2 * M
  const a = data.analysis
  text(ctx, 'TEMPS DE PASSAGE', M, bodyY, `700 11px ${SANS}`, ACCENT, 'left', 2.5)
  if (a) {
    const sumH = 44
    drawSplitsTable(ctx, a, M, bodyY + 12, leftW - 20, bodyH - 12 - sumH)
    const half = a.halvesS[1] - a.halvesS[0]
    const l1 = `Meilleur km : ${a.best.km}e en ${pace(a.best.s)}  ·  Moins bon : ${a.worst.km}e en ${pace(a.worst.s)}`
    const l2 = `1re moitié ${formatElapsed(a.halvesS[0])}  ·  2de moitié ${formatElapsed(a.halvesS[1])} (${half >= 0 ? '+' : '−'}${formatElapsed(Math.abs(half))})`
    ctx.font = `500 11px ${SANS}`
    text(ctx, ellipsize(ctx, l1, leftW - 20), M, bodyY + bodyH - 22, ctx.font, ink(0.7))
    text(ctx, ellipsize(ctx, l2, leftW - 20), M, bodyY + bodyH - 4, ctx.font, ink(0.7))
  } else {
    const msg = wrapFit(ctx, 'Cette trace n\'a pas les heures réelles d\'une course : les temps de passage apparaissent avec le GPX enregistré par votre montre ou votre téléphone.',
      400, SERIF, 15, 11, leftW - 30, 5)
    msg.lines.forEach((l, i) => text(ctx, l, M, bodyY + 34 + i * msg.size * 1.45, `italic 400 ${msg.size}px ${SERIF}`, ink(0.55)))
  }

  if (right) {
    const rx = M + leftW, rw = UW - M - rx
    let ry = bodyY - 10
    if (note) {
      const nt = wrapFit(ctx, `« ${note} »`, 400, SERIF, 16, 10, rw, photos.length ? 4 : 12)
      nt.lines.forEach((l, i) => text(ctx, l, rx, ry + 14 + i * nt.size * 1.4, `italic 400 ${nt.size}px ${SERIF}`, ink(0.8)))
      ry += 14 + nt.lines.length * nt.size * 1.4 + 10
    }
    const ph = bodyY + bodyH - ry
    if (photos.length && ph > 60) {
      const gap = 10
      if (photos.length === 1) drawPhoto(ctx, photos[0], rx, ry, rw, ph, k, 6)
      else {
        const each = (ph - gap) / 2
        photos.forEach((img, i) => drawPhoto(ctx, img, rx, ry + i * (each + gap), rw, each, k, 6))
      }
    }
  }
  folio(ctx, pageNo)
}

/** Une photo recadrée sur toute la double page : moitié gauche (half 0) ou droite (half 1). Sans fond perdu, elle
 * s'arrête à la marge des bords extérieurs et ne touche que le pli. */
function drawSpreadPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, half: 0 | 1) {
  const inset = fullBleed ? 0 : M
  const pw = UW - inset, ph = UH - 2 * inset
  const W = pw * 2
  const s = Math.max(W / img.naturalWidth, ph / img.naturalHeight)
  const sw = W / s, sh = ph / s
  const sx = (img.naturalWidth - sw) / 2 + half * sw / 2, sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw / 2, sh, half === 0 ? inset : 0, inset, pw, ph)
}

function drawPhotoGrid(ctx: CanvasRenderingContext2D, imgs: HTMLImageElement[], k: number) {
  const n = imgs.length
  if (n === 1) {
    if (fullBleed) drawPhoto(ctx, imgs[0], 0, 0, UW, UH, k, 0)
    else drawPhoto(ctx, imgs[0], M, M, UW - 2 * M, UH - 2 * M, k, 4)
    return
  }
  const x = M, y = M, w = UW - 2 * M, h = UH - 2 * M, g = 14
  if (n === 2) {
    const cw = (w - g) / 2
    imgs.forEach((img, i) => drawPhoto(ctx, img, x + i * (cw + g), y, cw, h, k, 4))
  } else if (n === 3) {
    const bw = (w - g) * 0.6, sw = w - g - bw, sh = (h - g) / 2
    drawPhoto(ctx, imgs[0], x, y, bw, h, k, 4)
    drawPhoto(ctx, imgs[1], x + bw + g, y, sw, sh, k, 4)
    drawPhoto(ctx, imgs[2], x + bw + g, y + sh + g, sw, sh, k, 4)
  } else {
    const cw = (w - g) / 2, ch = (h - g) / 2
    imgs.slice(0, 4).forEach((img, i) => drawPhoto(ctx, img, x + (i % 2) * (cw + g), y + Math.floor(i / 2) * (ch + g), cw, ch, k, 4))
  }
}

function drawPhotosPage(ctx: CanvasRenderingContext2D, imgs: HTMLImageElement[], half: 0 | 1, k: number) {
  const list = imgs.slice(0, MAX_PHOTOS)
  if (!list.length) return
  if (list.length === 1) { drawSpreadPhoto(ctx, list[0], half); return }
  const first = Math.ceil(list.length / 2)
  drawPhotoGrid(ctx, half === 0 ? list.slice(0, first) : list.slice(first), k)
}

// ── Couverture ───────────────────────────────────────────────────────────────
// Dessinée en millimètres, sur fond vert nuit. Zone sûre : 15 mm à l'intérieur du bord rogné (rabats de la couverture
// rigide chez WhiteWall, rognage chez Flexilivre).

const COVER_SAFE = 15

/** Toile en millimètres (300 dpi, moins pour l'aperçu), peinte en vert nuit. */
function coverCanvas(wMm: number, hMm: number, pxPerMm = PX_PER_MM) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(wMm * pxPerMm); canvas.height = Math.round(hMm * pxPerMm)
  const ctx = canvas.getContext('2d')!
  ctx.scale(pxPerMm, pxPerMm)
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, wMm, hMm)
  return { canvas, ctx }
}

/** 1re de couverture : titre, période, nom ; tracés de toutes les courses. */
function drawCoverFront(ctx: CanvasRenderingContext2D, entries: Entry[], o: BookOptions, x: number, w: number, top: number, bottom: number) {
  const t = wrapFit(ctx, o.title, 600, SERIF, 20, 10, w, 2)
  let y = top + t.size
  t.lines.forEach(l => { text(ctx, l, x, y, `600 ${t.size}px ${SERIF}`, cream(0.96)); y += t.size * 1.1 })
  text(ctx, periodLabel(entries), x, y + 2, `600 5px ${SANS}`, '#F07D1A', 'left', 1.2)
  if (o.name) text(ctx, o.name, x, y + 11, `italic 500 6px ${SERIF}`, cream(0.8))
  drawTraces(ctx, entries, x, y + 20, w, bottom - y - 20, 0.9)
}

/** 4e de couverture : records, totaux et adresse du site. */
function drawCoverBack(ctx: CanvasRenderingContext2D, entries: Entry[], x: number, w: number, top: number, bottom: number) {
  const best = bestByCategory(entries)
  let y = top + 10
  text(ctx, 'RECORDS', x, y, `700 3.6px ${SANS}`, '#F07D1A', 'left', 1)
  y += 10
  for (const c of RECORD_CATEGORIES) {
    const e = best[c.id]
    if (!e) continue
    text(ctx, c.label, x, y, `500 4.4px ${SANS}`, cream(0.7))
    text(ctx, formatElapsed(e.timeS!), x + w, y, `600 5.5px ${SERIF}`, cream(0.95), 'right')
    y += 9
  }
  const km = entries.reduce((s, e) => s + e.data.officialM, 0) / 1000
  text(ctx, `${entries.length} course${entries.length > 1 ? 's' : ''} · ${Math.round(km).toLocaleString('fr-FR')} km`, x, y + 4,
    `500 4px ${SANS}`, cream(0.6))
  text(ctx, 'sillonphane.fr/running', x + w / 2, bottom, `500 3px ${SANS}`, cream(0.45), 'center', 0.4)
}

/** WhiteWall : couverture à plat d'un tenant (4e de couverture | dos | 1re de couverture), en PDF séparé. */
async function renderWrapCover(entries: Entry[], o: BookOptions, pages: number): Promise<Blob> {
  const spread = wrapSpreadForPages(o.printer.profile, pages)!
  const SW = spread.sheetCm.w * 10, SH = spread.sheetCm.h * 10, spine = spread.spineCm * 10, bleed = spread.bleedCm * 10
  const { canvas, ctx } = coverCanvas(SW, SH)
  const half = (SW - spine) / 2
  const top = bleed + COVER_SAFE, bottom = SH - bleed - COVER_SAFE
  const fx = half + spine + COVER_SAFE
  drawCoverFront(ctx, entries, o, fx, SW - bleed - COVER_SAFE - fx, top, bottom)
  drawCoverBack(ctx, entries, bleed + COVER_SAFE, half - bleed - 2 * COVER_SAFE, top, bottom)
  // Dos : titre et période, de haut en bas.
  if (spine >= 6) {
    ctx.save()
    ctx.translate(half + spine / 2, SH / 2)
    ctx.rotate(Math.PI / 2)
    const label = `${o.title} · ${periodLabel(entries)}`
    fitFont(ctx, label, 600, SERIF, spine * 0.42, 1.5, SH - 2 * bleed - 30)
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = cream(0.9)
    ctx.fillText(label, 0, 0)
    ctx.restore()
  }
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'cm', format: [spread.sheetCm.w, spread.sheetCm.h], compress: true })
  doc.addImage(await canvasJpeg(canvas), 'JPEG', 0, 0, spread.sheetCm.w, spread.sheetCm.h)
  canvas.width = canvas.height = 0
  return doc.output('blob')
}

/** Flexilivre : 1re ou 4e de couverture sur une page du format du livre (1re et dernière page du PDF unique). */
function renderCoverPage(entries: Entry[], o: BookOptions, side: 'front' | 'back', pxPerMm = PX_PER_MM): HTMLCanvasElement {
  const { w, h } = o.printer.profile.pageCm
  const { canvas, ctx } = coverCanvas(w * 10, h * 10, pxPerMm)
  const x = COVER_SAFE, cw = w * 10 - 2 * COVER_SAFE, top = COVER_SAFE, bottom = h * 10 - COVER_SAFE
  if (side === 'front') drawCoverFront(ctx, entries, o, x, cw, top, bottom)
  else drawCoverBack(ctx, entries, x + cw * 0.25, cw * 0.5, top, bottom)
  return canvas
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Image de page impossible'))), 'image/jpeg', 0.9))
  return new Uint8Array(await blob.arrayBuffer())
}

// ── Assemblage ───────────────────────────────────────────────────────────────

function buildEntries(courses: BookCourse[]): Entry[] {
  const entries: Entry[] = []
  for (const course of courses) {
    let data: PosterData
    try { data = buildPosterData(course.track) } catch (err) { console.error('[livre] trace illisible', course.track.name, err); continue }
    const settings = course.track.poster ?? {}
    const r = resolvePoster(data, settings)
    const posterIds = settings.photoIds ?? []
    const own = course.voyage.photos.filter(p => p.trackId === course.track.id)
    const photos = [
      ...posterIds.map(id => course.voyage.photos.find(p => p.id === id)).filter((p): p is VoyagePhoto => !!p),
      ...own.filter(p => !posterIds.includes(p.id)).sort((a, b) => (a.takenAt || a.createdAt).localeCompare(b.takenAt || b.createdAt)),
    ].slice(0, MAX_PHOTOS)
    entries.push({
      course, data, settings, r, photos, page: 0,
      category: RECORD_CATEGORIES.find(c => c.m === data.officialM)?.id,
      timeS: r.chronoS,
    })
  }
  return entries
}

async function loadPhotos(list: VoyagePhoto[], urls: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>()
  for (const p of list) {
    const blob = await getPhotoBlob(p.id).catch(() => null)
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    urls.push(url)
    const img = await loadImage(url).catch(() => null)
    if (img) out.set(p.id, img)
  }
  return out
}

/** Format des pages de l'imprimeur (hauteur des unités de dessin, fond perdu). */
function setFormat(printer: BookPrinterInfo) {
  const { w, h } = printer.profile.pageCm
  UH = UW * h / w
  fullBleed = printer.profile.coverMode === 'wrap-spread'
}

/** Courses lisibles et plan des pages intérieures, complété de pages blanches jusqu'au nombre imprimé. */
function layoutBook(courses: BookCourse[], o: BookOptions): { entries: Entry[]; plan: Page[] } {
  const entries = buildEntries(courses)
  if (!entries.length) throw new Error('Aucune course lisible dans le livre')
  setFormat(o.printer)
  const plan: Page[] = [{ kind: 'title' }, { kind: 'records' }, { kind: 'progress' }, { kind: 'palmares' }, { kind: 'toc' }]
  for (const e of entries) {
    e.page = plan.length + 1
    plan.push({ kind: 'poster', e }, { kind: 'carnet', e })
    if (o.photoSpreads && e.photos.length) plan.push({ kind: 'photos', e, half: 0 }, { kind: 'photos', e, half: 1 })
  }
  const total = printedPageCount(plan.length, o.printer)
  while (plan.length < total - 1) plan.push({ kind: 'blank' })
  if (plan.length < total) plan.push({ kind: 'colophon' })
  return { entries, plan }
}

/** Dessine la page intérieure n° `n` sur `ctx` (toile de UW × UH unités à l'échelle `k`). */
async function drawPage(ctx: CanvasRenderingContext2D, page: Page, n: number, k: number, entries: Entry[], o: BookOptions,
  loaded: Map<string, HTMLImageElement>) {
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, UW, UH)
  const imgsOf = (e: Entry) => e.photos.map(p => loaded.get(p.id)).filter((x): x is HTMLImageElement => !!x)
  switch (page.kind) {
    case 'title': drawTitlePage(ctx, entries, o); break
    case 'records': drawRecords(ctx, entries); folio(ctx, n); break
    case 'progress': drawProgress(ctx, entries); folio(ctx, n); break
    case 'palmares': drawPalmares(ctx, entries); folio(ctx, n); break
    case 'toc': drawToc(ctx, entries); folio(ctx, n); break
    case 'poster': {
      const ids = page.e.settings.photoIds ?? []
      await drawPosterPage(ctx, page.e, ids.map(id => loaded.get(id)).filter((x): x is HTMLImageElement => !!x), k)
      break
    }
    case 'carnet': await drawCarnet(ctx, page.e, imgsOf(page.e), k, n); break
    case 'photos': drawPhotosPage(ctx, imgsOf(page.e), page.half, k); break
    case 'colophon':
      text(ctx, 'Livre composé avec Sillonphane · sillonphane.fr/running', UW / 2, UH - M, `500 10px ${SANS}`, ink(0.4), 'center', 1)
      break
    case 'blank': break
  }
}

/**
 * Prépare le ou les PDF du livre pour l'imprimeur choisi. `onProgress(fait, total)` compte les pages (couverture
 * comprise) ; `isLive` permet d'abandonner (écran quitté) : la promesse est alors rejetée.
 */
export async function prepareBook(courses: BookCourse[], o: BookOptions,
  onProgress?: (done: number, total: number) => void, isLive: () => boolean = () => true): Promise<PreparedBook> {
  await loadFonts()
  const { entries, plan } = layoutBook(courses, o)
  const pageCm = o.printer.profile.pageCm
  const wrap = o.printer.profile.coverMode === 'wrap-spread'
  const steps = plan.length + (wrap ? 1 : 2)
  let done = 0
  const step = () => onProgress?.(++done, steps)

  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'cm', format: [pageCm.w, pageCm.h], compress: true })
  let first = true
  async function addPage(c: HTMLCanvasElement) {
    if (!first) doc.addPage([pageCm.w, pageCm.h], 'landscape')
    first = false
    doc.addImage(await canvasJpeg(c), 'JPEG', 0, 0, pageCm.w, pageCm.h)
  }
  async function addCoverPage(side: 'front' | 'back') {
    const c = renderCoverPage(entries, o, side)
    await addPage(c)
    c.width = c.height = 0
    step()
  }

  if (!wrap) await addCoverPage('front')

  const pxW = Math.round(pageCm.w / 2.54 * DPI), pxH = Math.round(pageCm.h / 2.54 * DPI)
  const k = pxW / UW
  const canvas = document.createElement('canvas')
  canvas.width = pxW; canvas.height = pxH
  const ctx = canvas.getContext('2d')!

  // Photos de la course en cours de dessin seulement.
  let loadedFor: Entry | null = null
  let loaded = new Map<string, HTMLImageElement>()
  let urls: string[] = []
  const release = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; loaded = new Map(); loadedFor = null }

  try {
    for (let i = 0; i < plan.length; i++) {
      if (!isLive()) throw new Error('Export du livre abandonné')
      const page = plan[i]
      if ('e' in page && loadedFor !== page.e) {
        release()
        loadedFor = page.e
        loaded = await loadPhotos(page.e.photos, urls)
      }
      await drawPage(ctx, page, i + 1, k, entries, o, loaded)
      await addPage(canvas)
      step()
    }
  } finally {
    release()
    canvas.width = canvas.height = 0
  }
  if (!isLive()) throw new Error('Export du livre abandonné')

  const base = sanitizeFilename(o.title) || 'Livre'
  const pages = plan.length
  if (!wrap) {
    await addCoverPage('back')
    return { pages, files: [{ blob: doc.output('blob'), name: `${base} - livre ${o.printer.label} (${pages} pages).pdf`, label: 'Livre (PDF)' }] }
  }
  const interior = doc.output('blob')
  const cover = await renderWrapCover(entries, o, pages)
  step()
  return {
    pages,
    files: [
      { blob: interior, name: `${base} - livre intérieur (${pages} pages).pdf`, label: 'Pages intérieures (PDF)' },
      { blob: cover, name: `${base} - livre couverture.pdf`, label: 'Couverture (PDF)' },
    ],
  }
}

// ── Aperçu ───────────────────────────────────────────────────────────────────

/** Côté d'une vue de l'aperçu : 1re ou 4e de couverture, numéro de page intérieure, ou rien. */
export type PreviewSide = 'front' | 'back' | number | null

export interface BookPreview {
  /** Vues à feuilleter, [gauche, droite] : 1re de couverture (à droite), page 1 (à droite), doubles pages, 4e de
   * couverture (à gauche). */
  views: [PreviewSide, PreviewSide][]
  /** Pages intérieures, pages blanches de fin comprises. */
  pages: number
  /** Largeur / hauteur d'une page. */
  pageRatio: number
  /** Dessine la vue n° `i` en basse définition (toile de `widthPx` de large, deux pages côte à côte) ; null si
   * abandonnée (`isLive` faux). */
  renderView(i: number, widthPx: number, isLive?: () => boolean): Promise<HTMLCanvasElement | null>
}

/**
 * Aperçu du livre tel qu'il sera exporté (mêmes pages, même dessin), vue par vue. Ne pas dessiner pendant un export :
 * le format de page est commun aux deux.
 */
export async function openBookPreview(courses: BookCourse[], o: BookOptions): Promise<BookPreview> {
  await loadFonts()
  const { entries, plan } = layoutBook(courses, o)
  const pageCm = o.printer.profile.pageCm
  const views: [PreviewSide, PreviewSide][] = [[null, 'front'], [null, 1]]
  for (let p = 2; p <= plan.length; p += 2) views.push([p, p + 1 <= plan.length ? p + 1 : null])
  views.push(['back', null])

  async function renderView(i: number, widthPx: number, isLive: () => boolean = () => true) {
    const view = views[i]
    if (!view) return null
    setFormat(o.printer)
    const pw = Math.round(widthPx / 2), ph = Math.round(pw * pageCm.h / pageCm.w)
    const out = document.createElement('canvas')
    out.width = pw * 2; out.height = ph
    const octx = out.getContext('2d')!
    for (let side = 0; side < 2; side++) {
      const s = view[side]
      if (s === null) continue
      if (!isLive()) return null
      const x = side * pw
      if (s === 'front' || s === 'back') {
        const c = renderCoverPage(entries, o, s, pw / (pageCm.w * 10))
        octx.drawImage(c, x, 0, pw, ph)
        c.width = c.height = 0
        continue
      }
      const page = plan[s - 1]
      const c = document.createElement('canvas')
      c.width = pw; c.height = ph
      const urls: string[] = []
      try {
        const loaded = 'e' in page ? await loadPhotos(page.e.photos, urls) : new Map<string, HTMLImageElement>()
        if (!isLive()) return null
        await drawPage(c.getContext('2d')!, page, s, pw / UW, entries, o, loaded)
      } finally {
        urls.forEach(u => URL.revokeObjectURL(u))
      }
      octx.drawImage(c, x, 0)
      c.width = c.height = 0
    }
    // Pli central d'une double page intérieure.
    if (typeof view[0] === 'number' && typeof view[1] === 'number') {
      const g = octx.createLinearGradient(pw - 24, 0, pw + 24, 0)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      octx.fillStyle = g; octx.fillRect(pw - 24, 0, 48, ph)
    }
    return isLive() ? out : null
  }

  return { views, pages: plan.length, pageRatio: pageCm.w / pageCm.h, renderView }
}
