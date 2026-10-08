// Ouverture des films 2D et 3D, façon affiche de film sportif : la vraie carte en vue aérienne oblique dans une lumière
// de matin, le ruban du parcours FIXE (vert au départ, orange, crème à l'arrivée), quelques lieux connus, le titre de
// l'épreuve à gauche ; plan presque fixe (lent rapprochement), puis passage à la première scène du film.
//
// Composant réutilisable pour toute épreuve : il ne connaît aucune ville. Il reçoit
//   A. les DONNÉES de l'épreuve (OpeningEvent, construites par buildOpeningEvent à partir du titre, de la ville, de la
//      date, de la distance et du D+ du film) ;
//   B. l'IMAGE de la carte et la position à l'écran du parcours et des lieux (OpeningFrame), calculées par chaque film
//      avec sa propre caméra (cadrage automatique sur l'emprise du parcours, cf. filmExport.ts / filmExport3d.ts).
// Rendu : drawOpeningScene = étalonnage de la carte (drawOpeningMapGrade), ruban (drawRouteRibbon), lieux
// (drawPoiLabels), titre (drawEventTitle), chiffres (drawEventStats), logo et adresse (drawBranding).

import { formatBannerDistance } from './raceSplits'

// ─── Données de l'épreuve ────────────────────────────────────────────────────

/** Épreuve à afficher. Tout est texte prêt à afficher, rien n'est propre à une ville. */
export interface OpeningEvent {
  /** Nom de la course : « SEMI-MARATHON », « MARATHON »… (vide : la ville seule fait le titre). */
  title: string
  /** Ville : « LILLE », « PARIS »… */
  city: string
  /** Année, à la suite de la ville : « 2026 ». */
  year: string
  /** « 17 SEPTEMBRE 2026 ». */
  date: string
  /** « 21,1 km », « 42,195 km ». */
  distance: string
  /** « D+ 50 m ». */
  elevation: string
}

/** Données de l'épreuve à partir de celles du film : titre (« Semi-marathon 2026 ») et ville (« Lille ») ->
 * SEMI-MARATHON / LILLE 2026 ; sans ville, le titre devient l'élément principal. */
export function buildOpeningEvent(o: {
  title?: string; city?: string; date?: string; distanceM: number; elevGainM: number
}): OpeningEvent {
  const yearRe = /\b(19|20)\d{2}\b/
  let title = (o.title ?? '').trim()
  const city = (o.city ?? '').trim()
  const year = title.match(yearRe)?.[0] ?? o.date?.match(yearRe)?.[0] ?? ''
  title = title.replace(yearRe, ' ')
  if (city) {
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`(\\s+(de|du|d')\\s*)?(^|\\s)${esc}(?=\\s|$)`, 'i'), ' ')
  }
  title = title.replace(/\s+/g, ' ').replace(/^[\s·–-]+|[\s·–-]+$/g, '').trim()
  const up = (s: string) => s.toLocaleUpperCase('fr-FR')
  return {
    title: city ? up(title) : '',
    city: up(city || title || 'Sillonphane'),
    year,
    date: up(o.date ?? ''),
    distance: formatBannerDistance(o.distanceM).replace(/ KM$/, ' km'),
    elevation: `D+ ${Math.round(o.elevGainM / 10) * 10} m`,
  }
}

/** Point du parcours à l'écran ; `f` = part du parcours, à la DISTANCE cumulée (0 départ, 1 arrivée) ; `ok` faux =
 * hors champ (derrière la caméra). */
export interface OpeningPt { x: number; y: number; f: number; ok?: boolean }
/** Lieu à l'écran : point d'intérêt (`type` 'poi' ou absent) ou quartier / commune (`type` 'district'). */
export interface OpeningPoi { x: number; y: number; name: string; type?: string; icon?: string; ok?: boolean }
/** Cours d'eau nommé, en points à l'écran le long de son tracé. */
export interface OpeningWater { name: string; pts: { x: number; y: number }[] }
/** Ce que chaque film calcule avec sa caméra, image par image : parcours et lieux à l'écran. */
export interface OpeningFrame { ribbon: OpeningPt[]; pois: OpeningPoi[]; waters?: OpeningWater[] }

// ─── Réglages ────────────────────────────────────────────────────────────────

/** Couleurs du ruban (celles du ruban du film 3D et du logo) : vert, orange, crème. */
const GREEN: [number, number, number] = [0x3e, 0x9e, 0x68]
const ORANGE: [number, number, number] = [0xe0, 0x7f, 0x3c]
const CREAM: [number, number, number] = [0xf6, 0xef, 0xe2]
/** Dégradé du ruban, en part de la distance parcourue : vert au départ, vert → orange jusqu'à `orangeFrom`, orange
 * jusqu'à `orangeTo`, puis orange → crème jusqu'à l'arrivée. Une seule fois sur tout le parcours. */
export const RIBBON_STOPS = { orangeFrom: 0.45, orangeTo: 0.7 }
/** Ruban : largeur du trait, largeur et opacité du léger halo (en px pour une image de 1080 px de haut). */
export const RIBBON_STYLE = { width: 13, glowWidth: 18, glowBlur: 5, glowAlpha: 0.14 }

/** Durées de l'ouverture (s) : la carte apparaît avec le ruban déjà en place, le titre entre d'un seul fondu, plan
 * tenu (lent rapprochement), puis passage à la première scène (« plongée ») ; titre, lieux et ruban s'effacent. */
export const OPENING = {
  /** Levée du voile sombre du tout début. */
  mapInS: 0.8,
  /** Fondu d'entrée du titre. */
  titleFromS: 0.4,
  titleInS: 1.0,
  /** Début du passage à la première scène (fin du plan d'ensemble). */
  diveFromS: 6.6,
  /** Durée du passage. */
  diveS: 3.2,
} as const
/** Durée totale de l'ouverture. */
export const OPENING_S = OPENING.diveFromS + OPENING.diveS

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u) }

/** Avancée du passage à la première scène (0..1, adoucie aux deux bouts) à l'instant `t` de l'ouverture. */
export function openingDiveK(t: number): number {
  const u = clamp01((t - OPENING.diveFromS) / OPENING.diveS)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}
/** Opacité du ruban d'ouverture : présent dès la première image, s'efface pendant le passage (le ruban de la course
 * prend le relais). */
export function openingRibbonAlpha(t: number): number {
  return 1 - smooth((t - OPENING.diveFromS - OPENING.diveS * 0.25) / (OPENING.diveS * 0.5))
}
/** Opacité de l'habillage du film (encart du haut, météo, flèche du nord, coureur) : arrive en fin d'ouverture. */
export function openingHudAlpha(t: number): number {
  return smooth((t - (OPENING_S - 0.5)) / 0.8)
}
/** Décalage horizontal du cadre 3D (part de la largeur) : le parcours se tient à droite, le titre à gauche ; revient à
 * 0 pendant la plongée. */
export const OPENING_FRAME_SHIFT = 0.17
export function openingFrameShift(t: number): number {
  return OPENING_FRAME_SHIFT * (1 - openingDiveK(t))
}
/** Opacité du titre et des lieux : un fondu d'entrée, effacés au début du passage. */
function titleAlpha(t: number): number {
  return smooth((t - OPENING.titleFromS) / OPENING.titleInS) * (1 - smooth((t - OPENING.diveFromS) / 0.8))
}

// ─── Police ──────────────────────────────────────────────────────────────────

const FONT = '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif'
let fontPromise: Promise<void> | null = null
/** Charge la police du site (Plus Jakarta Sans) pour le canvas ; repli silencieux sur Segoe UI. */
export function loadOpeningFont(): Promise<void> {
  if (!fontPromise) {
    fontPromise = (async () => {
      try {
        if ([...document.fonts].some(f => f.family.replace(/"/g, '') === 'Plus Jakarta Sans')) {
          await document.fonts.load(`800 40px ${FONT}`)
          return
        }
        const face = new FontFace('Plus Jakarta Sans', `url(${import.meta.env.BASE_URL}fonts/plus-jakarta-sans-latin.woff2)`,
          { weight: '400 800', style: 'normal' })
        await face.load()
        document.fonts.add(face)
      } catch (e) {
        console.warn('[ouverture] police indisponible, repli système :', e)
      }
    })()
  }
  return fontPromise
}

// ─── Carte : étalonnage ──────────────────────────────────────────────────────

/** Crème du voile de gauche et de l'apparition. */
const PAPER = '247,241,231'

/**
 * Étalonnage par-dessus la carte claire (déjà éclaircie par openingMap.ts) : léger voile crème sur toute l'image,
 * voile crème plus dense à gauche (zone du titre, la carte s'y efface en douceur). Apparition depuis le crème au tout
 * début. Tout s'atténue pendant le passage à la première scène.
 */
export function drawOpeningMapGrade(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const strength = 1 - openingDiveK(t)
  if (strength > 0) {
    ctx.save()
    ctx.globalAlpha = strength
    ctx.fillStyle = `rgba(${PAPER},0.16)`
    ctx.fillRect(0, 0, w, h)
    const left = ctx.createLinearGradient(0, 0, w * 0.6, 0)
    left.addColorStop(0, `rgba(${PAPER},0.94)`)
    left.addColorStop(0.42, `rgba(${PAPER},0.8)`)
    left.addColorStop(0.75, `rgba(${PAPER},0.3)`)
    left.addColorStop(1, `rgba(${PAPER},0)`)
    ctx.fillStyle = left
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
  const veil = 1 - smooth(t / OPENING.mapInS)
  if (veil > 0) {
    ctx.save()
    ctx.fillStyle = `rgba(${PAPER},${veil})`
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
}

// ─── Ruban ───────────────────────────────────────────────────────────────────

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`
/** Teinte, saturation, luminosité (0..1) d'une couleur RVB, et retour. */
function toHsl([r, g, b]: number[]): number[] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const hue = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [hue / 6, s, l]
}
function fromHsl([hh, s, l]: number[]): number[] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh * 6) % 2) - 1)), m = l - c / 2
  const i = Math.floor(hh * 6) % 6
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i]
  return [r, g, b].map(v => Math.round((v + m) * 255))
}
const GREEN_HSL = toHsl(GREEN), ORANGE_HSL = toHsl(ORANGE)
/** Couleur du ruban à la part `f` de la distance parcourue (RIBBON_STOPS). Le passage vert → orange se fait par la
 * teinte (via un jaune lumineux) : un mélange RVB passait par un kaki terne. */
export function ribbonColorAtDistance(f: number): string {
  const x = clamp01(f), { orangeFrom, orangeTo } = RIBBON_STOPS
  if (x <= orangeFrom) { const u = smooth(x / orangeFrom); return rgb(fromHsl(GREEN_HSL.map((v, i) => v + (ORANGE_HSL[i] - v) * u))) }
  if (x <= orangeTo) return rgb(ORANGE)
  return rgb(mix(ORANGE, CREAM, smooth((x - orangeTo) / (1 - orangeTo))))
}

let glowCanvas: HTMLCanvasElement | null = null

/** Ruban du parcours, FIXE, posé sur la carte : dégradé à la distance parcourue, halo doux de sa couleur (lisible sur
 * la carte claire, sans l'effacer), liseré fin orangé qui détache la partie crème du fond clair. */
export function drawRouteRibbon(ctx: CanvasRenderingContext2D, w: number, h: number, path: OpeningPt[], alpha: number): void {
  if (alpha <= 0 || path.length < 2) return
  const k = h / 1080
  const CHUNKS = 120
  const strokeRibbon = (c: CanvasRenderingContext2D, width: number, s = 1) => {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = width
    let i = 0
    while (i < path.length - 1) {
      const f0 = path[i].f
      c.beginPath()
      c.moveTo(path[i].x * s, path[i].y * s)
      let j = i + 1
      for (; j < path.length; j++) {
        if (path[j].ok === false) break
        c.lineTo(path[j].x * s, path[j].y * s)
        if (path[j].f - f0 >= 1 / CHUNKS) break
      }
      c.strokeStyle = ribbonColorAtDistance((f0 + path[Math.min(j, path.length - 1)].f) / 2)
      c.stroke()
      i = Math.max(i + 1, j)
    }
  }
  const strokePlain = (width: number) => {
    ctx.lineWidth = width
    ctx.beginPath()
    path.forEach((p, i) => (i === 0 || path[i - 1].ok === false ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }

  const gw = Math.round(w / 2), gh = Math.round(h / 2)
  if (!glowCanvas) glowCanvas = document.createElement('canvas')
  if (glowCanvas.width !== gw || glowCanvas.height !== gh) { glowCanvas.width = gw; glowCanvas.height = gh }
  const g = glowCanvas.getContext('2d')!
  g.clearRect(0, 0, gw, gh)
  g.filter = `blur(${Math.max(1, Math.round(RIBBON_STYLE.glowBlur * k))}px)`
  strokeRibbon(g, RIBBON_STYLE.glowWidth * k, 0.5)
  g.filter = 'none'

  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.globalAlpha = alpha * RIBBON_STYLE.glowAlpha
  ctx.drawImage(glowCanvas, 0, 0, w, h)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(176,64,24,0.6)'
  strokePlain((RIBBON_STYLE.width + 3) * k)
  strokeRibbon(ctx, RIBBON_STYLE.width * k)
  ctx.globalAlpha = alpha * 0.18
  ctx.strokeStyle = '#fffaf0'
  strokePlain(2 * k)
  ctx.restore()
}

// ─── Lieux ───────────────────────────────────────────────────────────────────

/** Coupe un nom en deux lignes équilibrées au-delà de 14 caractères (« Citadelle / de Lille »). */
function poiLines(name: string): string[] {
  if (name.length <= 14 || !name.includes(' ')) return [name]
  const words = name.split(' ')
  let best = [name], bestD = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const d = Math.abs(a.length - b.length)
    if (d < bestD) { bestD = d; best = [a, b] }
  }
  return best
}

/** Pictogramme d'un point d'intérêt, blanc, dans un carré de `s` px centré en (cx, cy) : `fort` (étoile de
 * citadelle), `arena` (dôme), `gate` (porte, arc), `park` (arbre), sinon `monument` (fronton à colonnes). */
function drawPoiIcon(ctx: CanvasRenderingContext2D, icon: string | undefined, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx - s / 2, cy - s / 2)
  ctx.scale(s / 24, s / 24)
  ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.beginPath()
  if (icon === 'fort') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.6 : 10.5
      if (i) ctx.lineTo(12 + Math.cos(a) * r, 12.5 + Math.sin(a) * r); else ctx.moveTo(12 + Math.cos(a) * r, 12.5 + Math.sin(a) * r)
    }
    ctx.closePath(); ctx.stroke()
  } else if (icon === 'arena') {
    ctx.moveTo(3, 19); ctx.lineTo(21, 19); ctx.moveTo(4.5, 19); ctx.lineTo(4.5, 15); ctx.lineTo(19.5, 15); ctx.lineTo(19.5, 19)
    ctx.moveTo(5, 15); ctx.arc(12, 15, 7, Math.PI, 0); ctx.moveTo(12, 8); ctx.lineTo(12, 5)
    for (const x of [8, 12, 16]) { ctx.moveTo(x, 15); ctx.lineTo(x, 19) }
    ctx.stroke()
  } else if (icon === 'gate') {
    ctx.moveTo(3, 20); ctx.lineTo(3, 7); ctx.lineTo(21, 7); ctx.lineTo(21, 20)
    ctx.moveTo(2, 4.5); ctx.lineTo(22, 4.5)
    ctx.moveTo(8.5, 20); ctx.lineTo(8.5, 14); ctx.arc(12, 14, 3.5, Math.PI, 0); ctx.lineTo(15.5, 20)
    ctx.stroke()
  } else if (icon === 'park') {
    ctx.arc(12, 9.5, 6.5, 0, Math.PI * 2); ctx.moveTo(12, 16); ctx.lineTo(12, 21); ctx.stroke()
  } else {
    ctx.moveTo(2.5, 8); ctx.lineTo(12, 3); ctx.lineTo(21.5, 8); ctx.closePath()
    ctx.moveTo(3, 20.5); ctx.lineTo(21, 20.5); ctx.moveTo(4, 18); ctx.lineTo(20, 18)
    for (const x of [5.5, 9.5, 14.5, 18.5]) { ctx.moveTo(x, 10); ctx.lineTo(x, 17) }
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Lieux sur la carte. Points d'intérêt (`type` 'poi' ou absent, au plus 5) : rond blanc cerclé de noir sur le lieu, tige fine,
 * étiquette sombre arrondie avec pictogramme (`icon`) et nom en blanc, relevée si elle chevauche une autre. Quartiers et
 * communes (`type` 'district', au plus 6) : capitales gris foncé espacées, auréolées de clair. Hors champ et zone du
 * titre écartés. Pas de noms de rues sur l'ouverture.
 */
export function drawPoiLabels(ctx: CanvasRenderingContext2D, w: number, h: number, pois: OpeningPoi[], alpha: number): void {
  if (alpha <= 0 || !pois.length) return
  const k = h / 1080
  const inView = (p: OpeningPoi) => p.ok !== false && p.x > w * 0.45 && p.x < w - 90 * k && p.y > 70 * k && p.y < h - 50 * k
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'center'
  // Quartiers.
  ctx.font = `600 ${Math.round(24 * k)}px ${FONT}`
  ctx.letterSpacing = `${4 * k}px`
  ctx.textBaseline = 'middle'
  for (const p of pois.filter(q => q.type === 'district' && inView(q)).slice(0, 6)) {
    const t = p.name.toLocaleUpperCase('fr-FR')
    ctx.shadowColor = 'rgba(250,246,238,0.95)'; ctx.shadowBlur = 14 * k
    ctx.fillStyle = 'rgba(250,246,238,0.6)'
    ctx.fillText(t, p.x, p.y)
    ctx.fillStyle = '#34373c'
    ctx.fillText(t, p.x, p.y)
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
  ctx.letterSpacing = '0px'
  // Points d'intérêt.
  const size = Math.round(18 * k)
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // Placement : pour chaque lieu, première position libre parmi des tiges de plus en plus longues et une étiquette
  // centrée, à gauche ou à droite de sa tige. Libre = l'étiquette ne touche ni une autre étiquette ni une autre tige, et
  // sa tige ne traverse aucune étiquette déjà posée, et l'étiquette ne couvre le repère d'aucun autre lieu.
  type Box = { x0: number; x1: number; y0: number; y1: number }
  type Stem = { x: number; y0: number; y1: number }
  const boxes: Box[] = [], stems: Stem[] = []
  const overlap = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
  const crosses = (s: Stem, b: Box) => s.x > b.x0 - 3 * k && s.x < b.x1 + 3 * k && s.y0 < b.y1 && s.y1 > b.y0
  const layout: { p: OpeningPoi; lines: string[]; box: Box; stem: Stem }[] = []
  const padX = 11 * k, padY = 7 * k, lineH = size * 1.1, iconS = 27 * k, gap = 9 * k
  const shown = pois.filter(q => q.type !== 'district' && inView(q)).slice(0, 5)
  const coversPoint = (b: Box, self: OpeningPoi) =>
    shown.some(q => q !== self && q.x > b.x0 - 10 * k && q.x < b.x1 + 10 * k && q.y > b.y0 - 10 * k && q.y < b.y1 + 10 * k)
  for (const p of shown) {
    const lines = poiLines(p.name)
    const textW = Math.max(...lines.map(l => ctx.measureText(l).width))
    const bw = padX + iconS + gap + textW + padX, bh = Math.max(iconS, lines.length * lineH) + padY * 2
    let chosen: { box: Box; stem: Stem } | null = null
    for (let i = 0; i < 5 && !chosen; i++) {
      const len = 24 * k + i * (bh + 6 * k)
      for (const dx of [-bw / 2, -bw + 16 * k, -16 * k]) {
        const box = { x0: p.x + dx, x1: p.x + dx + bw, y1: p.y - len, y0: p.y - len - bh }
        const stem = { x: p.x, y0: box.y1, y1: p.y }
        if (boxes.some(b => overlap(box, b)) || stems.some(s => crosses(s, box)) || boxes.some(b => crosses(stem, b)) ||
          coversPoint(box, p)) continue
        chosen = { box, stem }
        break
      }
    }
    if (!chosen) {
      const box = { x0: p.x - bw / 2, x1: p.x + bw / 2, y1: p.y - 24 * k, y0: p.y - 24 * k - bh }
      chosen = { box, stem: { x: p.x, y0: box.y1, y1: p.y } }
    }
    boxes.push(chosen.box); stems.push(chosen.stem)
    layout.push({ p, lines, ...chosen })
  }
  // Tiges discrètes (fines, à demi transparentes), puis étiquettes, puis repères.
  ctx.strokeStyle = 'rgba(29,38,44,0.5)'
  ctx.lineWidth = 1.2 * k
  for (const { stem } of layout) { ctx.beginPath(); ctx.moveTo(stem.x, stem.y1); ctx.lineTo(stem.x, stem.y0); ctx.stroke() }
  for (const { p, lines, box: r } of layout) {
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 10 * k; ctx.shadowOffsetY = 3 * k
    ctx.fillStyle = 'rgba(29,38,44,0.94)'
    ctx.beginPath(); ctx.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 9 * k); ctx.fill()
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.5 * k
    ctx.stroke()
    drawPoiIcon(ctx, p.icon, r.x0 + padX + iconS / 2, (r.y0 + r.y1) / 2, iconS)
    ctx.fillStyle = '#ffffff'
    const ty = (r.y0 + r.y1) / 2 - ((lines.length - 1) * lineH) / 2 + size * 0.36
    lines.forEach((l, i) => ctx.fillText(l, r.x0 + padX + iconS + gap, ty + i * lineH))
  }
  for (const { p } of layout) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(p.x, p.y, 6.5 * k, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1d262c'; ctx.lineWidth = 2.5 * k
    ctx.stroke()
  }
  ctx.restore()
}

/** Noms des cours d'eau, en italique blanc, inscrits le long de l'eau (au milieu du tronçon visible), lettre par
 * lettre et toujours dans le sens de la lecture. */
export function drawWaterLabels(ctx: CanvasRenderingContext2D, w: number, h: number, waters: OpeningWater[], alpha: number): void {
  if (alpha <= 0 || !waters.length) return
  const k = h / 1080
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `italic 600 ${Math.round(25 * k)}px ${FONT}`
  ctx.letterSpacing = `${1 * k}px`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(20,50,80,0.55)'; ctx.shadowBlur = 6 * k
  for (const wtr of waters) {
    let pts = wtr.pts
    // Sens de lecture : de gauche à droite.
    if (pts[pts.length - 1].x < pts[0].x) pts = [...pts].reverse()
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
    const total = cum[cum.length - 1]
    const textW = ctx.measureText(wtr.name).width
    if (textW > total * 0.9) continue
    /** Point et direction (moyennée sur ±span px, pour des lettres alignées malgré les méandres) à l'abscisse s. */
    const at = (s: number) => {
      const pos = (d: number) => {
        const c = Math.max(0, Math.min(total, d))
        let i = 1
        while (i < cum.length - 1 && cum[i] < c) i++
        const u = (c - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u }
      }
      const span = 40 * k, a = pos(s - span), b = pos(s + span)
      return { ...pos(s), angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    let s = total / 2 - textW / 2
    for (const ch of wtr.name) {
      const cw = ctx.measureText(ch).width
      const p = at(s + cw / 2)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.angle)
      ctx.fillText(ch, 0, 0)
      ctx.restore()
      s += cw
    }
  }
  ctx.restore()
}


// ─── Titre, chiffres, logo ───────────────────────────────────────────────────

/** Marge gauche du bloc titre et largeur maximale du titre. */
const titleX = (h: number) => Math.round(84 * (h / 1080))
const titleMaxW = (w: number) => w * 0.42
const INK = '#111214'

/** Filet au dégradé signature (vert → orange, fondu au bout). */
function drawSignatureLine(ctx: CanvasRenderingContext2D, x: number, y: number, wd: number, hgt: number) {
  const g = ctx.createLinearGradient(x, 0, x + wd, 0)
  g.addColorStop(0, rgb(GREEN)); g.addColorStop(0.35, '#e9a23b'); g.addColorStop(0.7, rgb(ORANGE)); g.addColorStop(1, 'rgba(224,127,60,0)')
  ctx.fillStyle = g
  ctx.fillRect(x, y, wd, hgt)
}

/** Date, nom de la course, ville et année (orange, même hauteur que la ville), filets. Renvoie le bas du bloc. */
export function drawEventTitle(ctx: CanvasRenderingContext2D, w: number, h: number, ev: OpeningEvent): number {
  const k = h / 1080
  const x = titleX(h), maxW = titleMaxW(w)
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // Taille commune aux deux lignes, réduite pour tenir dans maxW.
  const cityLine = ev.year ? `${ev.city} ${ev.year}` : ev.city
  let size = 150 * k
  const fits = () => {
    ctx.font = `800 ${size}px ${FONT}`
    ctx.letterSpacing = `${-3 * k}px`
    return Math.max(ctx.measureText(cityLine).width, ev.title ? ctx.measureText(ev.title).width : 0) <= maxW
  }
  while (!fits() && size > 56 * k) size -= 3 * k

  let y = Math.round(h * 0.12)
  if (ev.date) {
    ctx.letterSpacing = `${11 * k}px`
    ctx.fillStyle = INK
    ctx.font = `500 ${Math.round(28 * k)}px ${FONT}`
    ctx.fillText(ev.date, x, y)
  }
  y += 26 * k
  drawSignatureLine(ctx, x, y, 170 * k, 4 * k)
  y += 26 * k

  ctx.font = `800 ${size}px ${FONT}`
  ctx.letterSpacing = `${-3 * k}px`
  ctx.fillStyle = INK
  if (ev.title) {
    y += size * 0.84
    ctx.fillText(ev.title, x, y)
    y += size * 0.12
  }
  y += size * 0.84
  const cityW = ctx.measureText(`${ev.city} `).width
  ctx.fillText(`${ev.city} `, x, y)
  if (ev.year) {
    const g = ctx.createLinearGradient(0, y - size * 0.72, 0, y)
    g.addColorStop(0, '#f39a1e'); g.addColorStop(1, '#e8481c')
    ctx.fillStyle = g
    ctx.fillText(ev.year, x + cityW, y)
  }
  ctx.restore()
  y += 36 * k
  drawSignatureLine(ctx, x, y, Math.min(maxW, 520 * k), 4 * k)
  return y + 4 * k
}

/** Pictogramme coureur, dans un carré de `s` px centré en (cx, cy). */
function drawRunnerIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx - s / 2, cy - s / 2)
  ctx.scale(s / 24, s / 24)
  ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath(); ctx.arc(15, 4, 2.4, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(8, 10); ctx.lineTo(12, 8); ctx.lineTo(15, 9.5); ctx.lineTo(17, 13)
  ctx.moveTo(12.5, 8.5); ctx.lineTo(10.5, 14)
  ctx.lineTo(14, 17); ctx.lineTo(13, 22)
  ctx.moveTo(10.5, 14); ctx.lineTo(8, 18); ctx.lineTo(4, 18)
  ctx.stroke()
  ctx.restore()
}
/** Pictogramme dénivelé (deux sommets), dans un carré de `s` px centré en (cx, cy). */
function drawMountainIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx - s / 2, cy - s / 2)
  ctx.scale(s / 24, s / 24)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(2, 19); ctx.lineTo(9, 7); ctx.lineTo(13, 13); ctx.lineTo(15.5, 10); ctx.lineTo(22, 19); ctx.closePath()
  ctx.stroke()
  ctx.beginPath(); ctx.moveTo(7, 10.5); ctx.lineTo(9, 12); ctx.lineTo(11, 10.5); ctx.stroke()
  ctx.restore()
}
/** Badge arrondi (icône + texte blanc) ; renvoie sa largeur. */
function drawBadge(
  ctx: CanvasRenderingContext2D, x: number, y: number, hgt: number, text: string,
  icon: (c: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void, fill: string,
): number {
  const k = hgt / 60
  ctx.font = `600 ${Math.round(27 * k)}px ${FONT}`
  const iconS = 30 * k, padX = 24 * k, gap = 16 * k
  const wd = padX + iconS + gap + ctx.measureText(text).width + padX
  ctx.beginPath()
  ctx.roundRect(x, y, wd, hgt, hgt / 2)
  ctx.fillStyle = fill
  ctx.fill()
  icon(ctx, x + padX + iconS / 2, y + hgt / 2, iconS)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX + iconS + gap, y + hgt / 2 + 1 * k)
  ctx.textBaseline = 'alphabetic'
  return wd
}

/** Badges distance (rouge orangé) et D+ (anthracite), à partir de `y`. Renvoie leur bas. */
export function drawEventStats(ctx: CanvasRenderingContext2D, h: number, ev: OpeningEvent, y: number): number {
  const k = h / 1080, x = titleX(h), bh = 60 * k
  ctx.save()
  const bw = drawBadge(ctx, x, y, bh, ev.distance, drawRunnerIcon, '#e8392b')
  drawBadge(ctx, x + bw + 16 * k, y, bh, ev.elevation, drawMountainIcon, '#2a2d30')
  ctx.restore()
  return y + bh
}

// Logo Sillonphane : le tracé et les couleurs d'AppLogoIcon.tsx (sillon au dégradé, deux points), sans son fond noir.
const LOGO_D = 'M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60'
let logoPath: Path2D | null = null

/** Logo Sillonphane (identique pour toutes les épreuves) et adresse du site, à partir de `y`. Sur le fond clair, une
 * ombre douce détache la partie crème du logo. */
export function drawBranding(ctx: CanvasRenderingContext2D, h: number, y: number): void {
  const k = h / 1080, x = titleX(h), size = 140 * k
  if (!logoPath) logoPath = new Path2D(LOGO_D)
  // Le tracé (trait de 29 compris) occupe x 107..249, y 45..247 du repère 320 : on le cadre sur ce rectangle.
  const s = size / 202
  ctx.save()
  ctx.save()
  ctx.translate(x + 8 * k - 107 * s, y - 45 * s)
  ctx.scale(s, s)
  ctx.shadowColor = 'rgba(60,40,20,0.35)'
  ctx.shadowBlur = 10
  const grad = ctx.createLinearGradient(0, 232, 0, 60)
  grad.addColorStop(0, '#2F5C45'); grad.addColorStop(0.5, '#D97A3D'); grad.addColorStop(1, '#F4EDE0')
  ctx.strokeStyle = grad
  ctx.lineWidth = 29
  ctx.lineCap = 'round'
  ctx.stroke(logoPath)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#2F5C45'; ctx.strokeStyle = '#F4EDE0'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(220, 60, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#F4EDE0'; ctx.strokeStyle = '#2F5C45'
  ctx.beginPath(); ctx.arc(138, 225, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.restore()
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.font = `500 ${Math.round(28 * k)}px ${FONT}`
  ctx.fillText('sillonphane.fr/running', x, y + size + 48 * k)
  ctx.restore()
}

// ─── Scène ───────────────────────────────────────────────────────────────────

/** Page d'ouverture complète, par-dessus l'image de la carte déjà dessinée : étalonnage, ruban fixe, lieux, titre,
 * chiffres, logo. `t` : temps de l'ouverture (s). */
export function drawOpeningScene(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, ev: OpeningEvent, frame: OpeningFrame,
): void {
  if (t >= OPENING_S) return
  drawOpeningMapGrade(ctx, w, h, t)
  drawRouteRibbon(ctx, w, h, frame.ribbon, openingRibbonAlpha(t))
  const a = titleAlpha(t)
  drawWaterLabels(ctx, w, h, frame.waters ?? [], a)
  drawPoiLabels(ctx, w, h, frame.pois, a)
  if (a <= 0) return
  ctx.save()
  ctx.globalAlpha = a
  const k = h / 1080
  const y = drawEventStats(ctx, h, ev, drawEventTitle(ctx, w, h, ev) + 30 * k)
  drawBranding(ctx, h, y + 56 * k)
  ctx.restore()
}
