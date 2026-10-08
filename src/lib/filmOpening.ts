// Ouverture des films 2D et 3D : la carte se découvre dans la lumière du matin, le ruban du parcours s'y dessine
// (vert au départ, orange, crème à l'arrivée : le dégradé signature, réparti une fois sur le parcours), le titre de
// l'épreuve s'inscrit à gauche dans une zone assombrie, puis la caméra plonge vers le départ. Ce module ne dessine
// que les calques 2D (lumière, ruban, titre) ; chaque film gère sa caméra et appelle ces fonctions à chaque image.

import { formatBannerDistance } from './raceSplits'

/** Couleurs du ruban (celles du ruban du film 3D) : vert, orange, crème. */
const GREEN: [number, number, number] = [0x3e, 0x9e, 0x68]
const ORANGE: [number, number, number] = [0xe0, 0x7f, 0x3c]
const CREAM: [number, number, number] = [0xf6, 0xef, 0xe2]

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
/** Dégradé signature à la part `f` du parcours : vert franc au départ, orange à mi-course, crème sur la fin. Le passage
 * vert → orange se fait par la teinte (via un jaune lumineux) : un mélange RVB passait par un kaki terne. */
function ribbonColor(f: number): string {
  const x = Math.max(0, Math.min(1, f))
  if (x <= 0.12) return rgb(GREEN)
  if (x <= 0.5) { const u = smooth((x - 0.12) / 0.38); return rgb(fromHsl(GREEN_HSL.map((v, i) => v + (ORANGE_HSL[i] - v) * u))) }
  return rgb(mix(ORANGE, CREAM, smooth((x - 0.5) / 0.4)))
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u) }
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)

// ─── Déroulé ─────────────────────────────────────────────────────────────────

/** Durées de l'ouverture (s). La carte se découvre, le ruban se dessine, le titre s'inscrit, plan tenu, puis plongée
 * de la caméra vers le départ (le titre s'efface au début de la plongée, le ruban d'ouverture pendant). */
export const OPENING = {
  /** Levée du voile sombre : la carte apparaît dans la lumière du matin. */
  mapInS: 1.8,
  /** Le ruban commence à se dessiner… */
  ribbonFromS: 0.9,
  /** … et atteint l'arrivée. */
  ribbonToS: 5.2,
  /** Début de l'inscription du titre. */
  titleFromS: 2.0,
  /** Début de la plongée vers le départ (fin du plan d'ensemble). */
  diveFromS: 7.4,
  /** Durée de la plongée. */
  diveS: 3.4,
} as const
/** Durée totale de l'ouverture (fin de la plongée : la caméra est sur le départ). */
export const OPENING_S = OPENING.diveFromS + OPENING.diveS

/** Avancée de la plongée (0..1, adoucie aux deux bouts) à l'instant `t` de l'ouverture. */
export function openingDiveK(t: number): number {
  const u = clamp01((t - OPENING.diveFromS) / OPENING.diveS)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}
/** Part du parcours dessinée par le ruban d'ouverture à l'instant `t`. */
export function openingRibbonHead(t: number): number {
  const u = clamp01((t - OPENING.ribbonFromS) / (OPENING.ribbonToS - OPENING.ribbonFromS))
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
}
/** Opacité du ruban d'ouverture : plein jusqu'à mi-plongée, puis s'efface (le ruban de la course prend le relais). */
export function openingRibbonAlpha(t: number): number {
  return 1 - smooth((t - OPENING.diveFromS - OPENING.diveS * 0.25) / (OPENING.diveS * 0.5))
}
/** Opacité de l'habillage du film (encart du haut, météo, flèche du nord, coureur) : arrive en fin de plongée. */
export function openingHudAlpha(t: number): number {
  return smooth((t - (OPENING_S - 0.5)) / 0.8)
}
/** Décalage horizontal du cadre (part de la largeur) : le parcours se tient à droite, le titre à gauche ; revient à 0
 * pendant la plongée. */
export const OPENING_FRAME_SHIFT = 0.17
export function openingFrameShift(t: number): number {
  return OPENING_FRAME_SHIFT * (1 - openingDiveK(t))
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
          await document.fonts.load(`700 40px ${FONT}`)
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

// ─── Lumière du matin ────────────────────────────────────────────────────────

/**
 * Lumière douce et dorée du matin sur la carte, zone sombre à gauche pour le titre, voile de levée du début.
 * `t` : temps de l'ouverture (s). Tout s'atténue pendant la plongée : la course garde son image habituelle.
 */
export function drawOpeningLight(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const strength = 1 - openingDiveK(t)
  if (strength > 0) {
    ctx.save()
    // Lumière chaude, douce, de biais depuis le haut à droite (soleil du matin bas sur l'horizon).
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = 0.55 * strength
    ctx.fillStyle = '#ffcf94'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = strength
    const sun = ctx.createRadialGradient(w * 0.9, -h * 0.15, 0, w * 0.9, -h * 0.15, w * 0.85)
    sun.addColorStop(0, 'rgba(255,222,170,0.42)')
    sun.addColorStop(0.45, 'rgba(255,205,140,0.16)')
    sun.addColorStop(1, 'rgba(255,200,130,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, w, h)
    // Zone sombre et dégagée à gauche (titre), bords haut et bas légèrement assombris.
    ctx.globalCompositeOperation = 'source-over'
    const left = ctx.createLinearGradient(0, 0, w * 0.6, 0)
    left.addColorStop(0, 'rgba(7,11,17,0.82)')
    left.addColorStop(0.42, 'rgba(7,11,17,0.55)')
    left.addColorStop(1, 'rgba(7,11,17,0)')
    ctx.fillStyle = left
    ctx.fillRect(0, 0, w, h)
    const vert = ctx.createLinearGradient(0, 0, 0, h)
    vert.addColorStop(0, 'rgba(7,11,17,0.35)')
    vert.addColorStop(0.22, 'rgba(7,11,17,0)')
    vert.addColorStop(0.8, 'rgba(7,11,17,0)')
    vert.addColorStop(1, 'rgba(7,11,17,0.4)')
    ctx.fillStyle = vert
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
  // Levée du voile : la carte apparaît (bleu nuit très sombre, pas un noir plein).
  const veil = 1 - smooth(t / OPENING.mapInS)
  if (veil > 0) {
    ctx.save()
    ctx.fillStyle = `rgba(6,9,14,${veil})`
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
}

// ─── Ruban ───────────────────────────────────────────────────────────────────

/** Point du parcours à l'écran ; `f` = part du parcours (0 départ, 1 arrivée) ; `ok` faux = hors champ (derrière). */
export interface OpeningPt { x: number; y: number; f: number; ok?: boolean }

let glowCanvas: HTMLCanvasElement | null = null

/**
 * Ruban d'ouverture : il se dessine du départ jusqu'à `head` (part du parcours), dégradé vert → orange → crème, avec
 * un halo lumineux (l'élément le plus lumineux de l'image) et une tête crème brillante.
 */
export function drawOpeningRibbon(
  ctx: CanvasRenderingContext2D, w: number, h: number, pts: OpeningPt[], head: number, alpha: number,
): void {
  if (alpha <= 0 || head <= 0 || pts.length < 2) return
  const k = h / 1080
  // Points visibles jusqu'à la tête (dernier point interpolé).
  const path: OpeningPt[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.f <= head) { path.push(p); continue }
    const q = pts[i - 1]
    if (q && p.f > q.f) {
      const u = (head - q.f) / (p.f - q.f)
      path.push({ x: q.x + (p.x - q.x) * u, y: q.y + (p.y - q.y) * u, f: head, ok: p.ok !== false && q.ok !== false })
    }
    break
  }
  if (path.length < 2) return

  const CHUNKS = 90
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
      c.strokeStyle = ribbonColor((f0 + path[Math.min(j, path.length - 1)].f) / 2)
      c.stroke()
      i = Math.max(i + 1, j)
    }
  }

  // Halo : ruban épais dessiné à demi-résolution, flouté, ajouté en mode « screen » (lumière).
  const gw = Math.round(w / 2), gh = Math.round(h / 2)
  if (!glowCanvas) glowCanvas = document.createElement('canvas')
  if (glowCanvas.width !== gw || glowCanvas.height !== gh) { glowCanvas.width = gw; glowCanvas.height = gh }
  const g = glowCanvas.getContext('2d')!
  g.clearRect(0, 0, gw, gh)
  g.filter = `blur(${Math.round(9 * k)}px)`
  strokeRibbon(g, 16 * k, 0.5)
  g.filter = 'none'

  ctx.save()
  ctx.globalAlpha = alpha
  // Liseré sombre très léger : détache le ruban des toits clairs.
  ctx.strokeStyle = 'rgba(10,14,12,0.38)'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 11 * k
  ctx.beginPath()
  path.forEach((p, i) => (i === 0 || path[i - 1].ok === false ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.globalCompositeOperation = 'screen'
  ctx.drawImage(glowCanvas, 0, 0, w, h)
  ctx.globalAlpha = alpha * 0.5 // second passage plus léger : les croisements du parcours ne saturent pas en blanc
  ctx.drawImage(glowCanvas, 0, 0, w, h)
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'source-over'
  strokeRibbon(ctx, 6.5 * k)
  // Filet clair au cœur du ruban : brillance.
  ctx.globalAlpha = alpha * 0.45
  ctx.strokeStyle = '#fffaf0'
  ctx.lineWidth = 1.8 * k
  ctx.beginPath()
  path.forEach((p, i) => (i === 0 || path[i - 1].ok === false ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()

  // Tête : point lumineux tant que le ruban se dessine.
  const tip = path[path.length - 1]
  const tipA = alpha * (1 - smooth((head - 0.985) / 0.015))
  if (tipA > 0) {
    ctx.globalAlpha = tipA
    ctx.globalCompositeOperation = 'screen'
    const r = 30 * k
    const halo = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r)
    halo.addColorStop(0, 'rgba(255,248,232,0.95)')
    halo.addColorStop(0.3, `${ribbonColor(head).replace('rgb', 'rgba').replace(')', ',0.55)')}`)
    halo.addColorStop(1, 'rgba(255,240,210,0)')
    ctx.fillStyle = halo
    ctx.beginPath(); ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#fffaf0'
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 4.5 * k, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

// ─── Titre ───────────────────────────────────────────────────────────────────

export interface OpeningText {
  /** Titre secondaire : « SEMI-MARATHON ». */
  kicker: string
  /** Élément principal : « LILLE ». */
  main: string
  /** Année, à la suite de l'élément principal : « 2026 ». */
  year: string
  /** « 17 SEPTEMBRE 2026 ». */
  date: string
  /** « 21,1 KM ». */
  km: string
  /** « D+ 50 M ». */
  gain: string
}

/** Textes de l'ouverture : « Semi-marathon 2026 » + « Lille » -> SEMI-MARATHON / LILLE 2026. Sans localité, le titre
 * devient l'élément principal. */
export function openingText(o: {
  title?: string; place?: string; date?: string; distanceM: number; elevGainM: number
}): OpeningText {
  const yearRe = /\b(19|20)\d{2}\b/
  let title = (o.title ?? '').trim()
  const place = (o.place ?? '').trim()
  const year = title.match(yearRe)?.[0] ?? o.date?.match(yearRe)?.[0] ?? ''
  title = title.replace(yearRe, ' ')
  if (place) {
    const esc = place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`(\\s+(de|du|d')\\s*)?(^|\\s)${esc}(?=\\s|$)`, 'i'), ' ')
  }
  title = title.replace(/\s+/g, ' ').replace(/^[\s·–-]+|[\s·–-]+$/g, '').trim()
  const km = formatBannerDistance(o.distanceM) // « 21,1 KM » pour un semi, « 42,195 KM » pour un marathon
  const gain = `D+ ${Math.round(o.elevGainM / 10) * 10} M`
  const up = (s: string) => s.toLocaleUpperCase('fr-FR')
  return {
    kicker: place ? up(title) : '',
    main: up(place || title || 'Sillonphane'),
    year,
    date: up(o.date ?? ''),
    km, gain,
  }
}

const LOGO_D = 'M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60'
let logoCache: { path: Path2D; length: number } | null = null
function logoPath(): { path: Path2D; length: number } {
  if (!logoCache) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    el.setAttribute('d', LOGO_D)
    logoCache = { path: new Path2D(LOGO_D), length: el.getTotalLength() }
  }
  return logoCache
}

/** Sigle Sillonphane (le « S » du site) dans un carré de `size` px, coin haut gauche (x, y), tracé à `reveal`. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, reveal: number, alpha: number) {
  if (alpha <= 0) return
  const { path, length } = logoPath()
  // Le tracé occupe x 122..234, y 60..232 du repère 320 : on le cadre sur ce rectangle.
  const s = size / 172
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x - 122 * s + (size - 112 * s) / 2, y - 60 * s)
  ctx.scale(s, s)
  const grad = ctx.createLinearGradient(0, 232, 0, 60)
  grad.addColorStop(0, '#3E9E68')
  grad.addColorStop(0.32, '#3E9E68')
  grad.addColorStop(0.62, '#E07F3C')
  grad.addColorStop(0.86, '#F6EFE2')
  grad.addColorStop(1, '#F6EFE2')
  ctx.strokeStyle = grad
  ctx.lineWidth = 30
  ctx.lineCap = 'round'
  ctx.setLineDash([length])
  ctx.lineDashOffset = length * (1 - clamp01(reveal))
  ctx.stroke(path)
  ctx.restore()
}

/** Texte espacé (letter-spacing) aligné à gauche ; renvoie sa largeur. */
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacingPx: number): number {
  ctx.letterSpacing = `${spacingPx}px`
  ctx.fillText(text, x, y)
  const wd = ctx.measureText(text).width
  ctx.letterSpacing = '0px'
  return wd
}

/**
 * Bloc titre à gauche : date, filet au dégradé signature, SEMI-MARATHON, LILLE 2026, distance et D+, puis sigle et
 * adresse du site, discrets. Chaque ligne entre en fondu avec une légère montée, décalée de la précédente ; le bloc
 * s'efface au début de la plongée. `t` : temps de l'ouverture (s).
 */
export function drawOpeningTitle(ctx: CanvasRenderingContext2D, w: number, h: number, txt: OpeningText, t: number): void {
  const out = 1 - smooth((t - OPENING.diveFromS) / 0.9)
  const tt = t - OPENING.titleFromS
  if (out <= 0 || tt <= 0) return
  const k = h / 1080
  const x = Math.round(118 * k)
  const maxW = w * 0.4
  /** Opacité et montée d'une ligne qui entre à `delay` s. */
  const enter = (delay: number, dur = 1.1) => {
    const u = easeOut((tt - delay) / dur)
    return { a: u * out, dy: (1 - u) * 22 * k }
  }

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 18 * k

  // Tailles : l'élément principal se réduit pour tenir dans maxW.
  let mainSize = 150 * k
  const mainText = txt.year ? `${txt.main} ${txt.year}` : txt.main
  ctx.font = `800 ${mainSize}px ${FONT}`
  ctx.letterSpacing = `${-1.5 * k}px`
  while (ctx.measureText(mainText).width > maxW && mainSize > 60 * k) {
    mainSize -= 4 * k
    ctx.font = `800 ${mainSize}px ${FONT}`
  }
  ctx.letterSpacing = '0px'
  let kickerSize = 58 * k
  ctx.font = `700 ${kickerSize}px ${FONT}`
  while (txt.kicker && ctx.measureText(txt.kicker).width + txt.kicker.length * 3 * k > maxW && kickerSize > 28 * k) {
    kickerSize -= 2 * k
    ctx.font = `700 ${kickerSize}px ${FONT}`
  }

  // Bloc centré verticalement un peu au-dessus du milieu.
  const blockH = 22 * k + 34 * k + (txt.kicker ? kickerSize * 1.05 : 0) + mainSize * 0.92 + 70 * k
  let y = Math.round(h * 0.47 - blockH / 2)

  // Date (très secondaire).
  if (txt.date) {
    const e = enter(0)
    ctx.globalAlpha = e.a * 0.8
    ctx.fillStyle = '#ffffff'
    ctx.font = `500 ${Math.round(22 * k)}px ${FONT}`
    spaced(ctx, txt.date, x, y + 22 * k + e.dy, 9 * k)
  }
  y += 22 * k + 22 * k
  // Filet au dégradé signature, qui se déroule.
  {
    const u = easeOut((tt - 0.25) / 1.3)
    const lw = 150 * k * u
    if (lw > 0) {
      ctx.globalAlpha = out
      ctx.shadowColor = 'transparent'
      const g = ctx.createLinearGradient(x, 0, x + 150 * k, 0)
      g.addColorStop(0, rgb(GREEN)); g.addColorStop(0.5, rgb(ORANGE)); g.addColorStop(1, rgb(CREAM))
      ctx.fillStyle = g
      ctx.fillRect(x, y, lw, 3 * k)
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
    }
  }
  y += 12 * k

  // SEMI-MARATHON (titre secondaire).
  if (txt.kicker) {
    const e = enter(0.35)
    y += kickerSize
    ctx.globalAlpha = e.a * 0.92
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${kickerSize}px ${FONT}`
    spaced(ctx, txt.kicker, x, y + e.dy, 3 * k)
    y += kickerSize * 0.05
  }

  // LILLE 2026 (élément principal) : l'année au dégradé orange → crème.
  {
    const e = enter(0.6, 1.3)
    y += mainSize * 0.9
    ctx.globalAlpha = e.a
    ctx.font = `800 ${mainSize}px ${FONT}`
    ctx.letterSpacing = `${-1.5 * k}px`
    ctx.fillStyle = '#ffffff'
    const mainW = ctx.measureText(`${txt.main} `).width
    ctx.fillText(`${txt.main} `, x, y + e.dy)
    if (txt.year) {
      const g = ctx.createLinearGradient(0, y - mainSize * 0.75, 0, y)
      g.addColorStop(0, rgb(CREAM)); g.addColorStop(0.55, '#f2b46a'); g.addColorStop(1, rgb(ORANGE))
      ctx.fillStyle = g
      ctx.fillText(txt.year, x + mainW, y + e.dy)
    }
    ctx.letterSpacing = '0px'
  }

  // 21,1 KM | D+ 50 M (informations).
  {
    const e = enter(1.05)
    y += 64 * k
    const size = Math.round(28 * k)
    ctx.globalAlpha = e.a * 0.92
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${size}px ${FONT}`
    let cx = x + spaced(ctx, txt.km, x, y + e.dy, 5 * k) + 24 * k
    ctx.globalAlpha = e.a * 0.45
    ctx.fillRect(cx, y + e.dy - size * 0.78, 1.5 * k, size * 0.95)
    cx += 24 * k
    ctx.globalAlpha = e.a * 0.92
    spaced(ctx, txt.gain, cx, y + e.dy, 5 * k)
  }

  // Sigle + adresse du site (très secondaires), en bas du bloc.
  {
    const e = enter(1.5)
    const size = 46 * k
    const ly = Math.round(h * 0.82)
    drawLogo(ctx, x, ly - size + e.dy, size, (tt - 1.5) / 1.1, e.a * 0.95)
    ctx.globalAlpha = e.a * 0.72
    ctx.fillStyle = '#ffffff'
    ctx.font = `500 ${Math.round(20 * k)}px ${FONT}`
    spaced(ctx, 'sillonphane.fr/running', x + size + 14 * k, ly - size * 0.32 + e.dy, 1.5 * k)
  }
  ctx.restore()
}

/** Ouverture complète par-dessus l'image de la carte : lumière, ruban (points à l'écran), titre. */
export function drawOpening(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, ribbon: OpeningPt[], txt: OpeningText,
): void {
  if (t >= OPENING_S) return
  drawOpeningLight(ctx, w, h, t)
  drawOpeningRibbon(ctx, w, h, ribbon, openingRibbonHead(t), openingRibbonAlpha(t))
  drawOpeningTitle(ctx, w, h, txt, t)
}
