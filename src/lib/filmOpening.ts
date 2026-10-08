// Ouverture des films 2D et 3D, façon affiche de film sportif : la vraie carte vue d'ensemble dans une lumière de
// matin, le ruban du parcours FIXE (vert au départ, orange, crème à l'arrivée : le dégradé signature, réparti une fois
// sur le parcours), quelques lieux connus, le titre de l'épreuve à gauche sur une zone assombrie ; plan presque fixe
// (lent rapprochement), puis la caméra plonge vers le départ. Ce module ne dessine que les calques 2D (lumière, ruban,
// lieux, titre) ; chaque film gère sa caméra et appelle drawOpening à chaque image.

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
  if (x <= 0.08) return rgb(GREEN)
  if (x <= 0.45) { const u = smooth((x - 0.08) / 0.37); return rgb(fromHsl(GREEN_HSL.map((v, i) => v + (ORANGE_HSL[i] - v) * u))) }
  return rgb(mix(ORANGE, CREAM, smooth((x - 0.55) / 0.4)))
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u) }

// ─── Déroulé ─────────────────────────────────────────────────────────────────

/** Durées de l'ouverture (s) : la carte apparaît avec le ruban déjà en place, le titre entre d'un seul fondu, plan
 * tenu (lent rapprochement), puis plongée de la caméra vers le départ (titre, lieux et ruban d'ouverture s'effacent). */
export const OPENING = {
  /** Levée du voile sombre du tout début. */
  mapInS: 0.8,
  /** Fondu d'entrée du titre. */
  titleFromS: 0.4,
  titleInS: 1.0,
  /** Début de la plongée vers le départ (fin du plan d'ensemble). */
  diveFromS: 6.6,
  /** Durée de la plongée. */
  diveS: 3.2,
} as const
/** Durée totale de l'ouverture (fin de la plongée : la caméra est sur le départ). */
export const OPENING_S = OPENING.diveFromS + OPENING.diveS

/** Avancée de la plongée (0..1, adoucie aux deux bouts) à l'instant `t` de l'ouverture. */
export function openingDiveK(t: number): number {
  const u = clamp01((t - OPENING.diveFromS) / OPENING.diveS)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}
/** Opacité du ruban d'ouverture : présent dès la première image, s'efface pendant la plongée (le ruban de la course
 * prend le relais). */
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
/** Opacité du titre et des lieux : un fondu d'entrée, effacés au début de la plongée. */
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

// ─── Lumière du matin ────────────────────────────────────────────────────────

/**
 * Étalonnage de la carte : contraste renforcé, lumière de matin venue du haut à droite, légère brume de profondeur
 * vers l'horizon, zone sombre à gauche pour le titre, vignette ; voile de levée du tout début. Couleurs gardées
 * naturelles (pas de teinte orangée d'ensemble). `t` : temps de l'ouverture (s). Tout s'atténue pendant la plongée.
 */
export function drawOpeningLight(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const strength = 1 - openingDiveK(t)
  if (strength > 0) {
    ctx.save()
    // Contraste : l'image fondue sur elle-même en « soft-light ».
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = 0.5 * strength
    ctx.drawImage(ctx.canvas, 0, 0, w, h)
    // Lumière de matin, douce, depuis le haut à droite.
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = strength
    const sun = ctx.createRadialGradient(w * 0.95, -h * 0.1, 0, w * 0.95, -h * 0.1, w * 0.75)
    sun.addColorStop(0, 'rgba(255,214,160,0.36)')
    sun.addColorStop(0.5, 'rgba(255,205,150,0.1)')
    sun.addColorStop(1, 'rgba(255,200,140,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, w, h)
    // Brume de profondeur : le haut de l'image (le lointain) un peu voilé, bleuté.
    const haze = ctx.createLinearGradient(0, 0, 0, h * 0.4)
    haze.addColorStop(0, 'rgba(170,190,210,0.16)')
    haze.addColorStop(1, 'rgba(170,190,210,0)')
    ctx.fillStyle = haze
    ctx.fillRect(0, 0, w, h * 0.4)
    // Zone sombre à gauche (titre), vignette haut, bas et coins.
    ctx.globalCompositeOperation = 'source-over'
    const left = ctx.createLinearGradient(0, 0, w * 0.62, 0)
    left.addColorStop(0, 'rgba(6,9,14,0.86)')
    left.addColorStop(0.45, 'rgba(6,9,14,0.6)')
    left.addColorStop(1, 'rgba(6,9,14,0)')
    ctx.fillStyle = left
    ctx.fillRect(0, 0, w, h)
    const vert = ctx.createLinearGradient(0, 0, 0, h)
    vert.addColorStop(0, 'rgba(6,9,14,0.3)')
    vert.addColorStop(0.2, 'rgba(6,9,14,0)')
    vert.addColorStop(0.78, 'rgba(6,9,14,0)')
    vert.addColorStop(1, 'rgba(6,9,14,0.5)')
    ctx.fillStyle = vert
    ctx.fillRect(0, 0, w, h)
    const vig = ctx.createRadialGradient(w * 0.6, h * 0.5, h * 0.45, w * 0.6, h * 0.5, w * 0.75)
    vig.addColorStop(0, 'rgba(6,9,14,0)')
    vig.addColorStop(1, 'rgba(6,9,14,0.35)')
    ctx.fillStyle = vig
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
  // Levée du voile du tout début (bleu nuit très sombre, pas un noir plein).
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
 * Ruban d'ouverture, FIXE : tout le parcours, dégradé vert → orange → crème, épais, avec un halo diffus qui le garde
 * élément le plus lumineux de la carte sans l'écraser.
 */
export function drawOpeningRibbon(ctx: CanvasRenderingContext2D, w: number, h: number, path: OpeningPt[], alpha: number): void {
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
      c.strokeStyle = ribbonColor((f0 + path[Math.min(j, path.length - 1)].f) / 2)
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

  // Halo : ruban épais dessiné à demi-résolution, flouté, ajouté en mode « screen » (lumière).
  const gw = Math.round(w / 2), gh = Math.round(h / 2)
  if (!glowCanvas) glowCanvas = document.createElement('canvas')
  if (glowCanvas.width !== gw || glowCanvas.height !== gh) { glowCanvas.width = gw; glowCanvas.height = gh }
  const g = glowCanvas.getContext('2d')!
  g.clearRect(0, 0, gw, gh)
  g.filter = `blur(${Math.round(10 * k)}px)`
  strokeRibbon(g, 20 * k, 0.5)
  g.filter = 'none'

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  // Liseré sombre léger : détache le ruban des toits clairs.
  ctx.strokeStyle = 'rgba(8,12,10,0.4)'
  strokePlain(13 * k)
  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = alpha * 0.85
  ctx.drawImage(glowCanvas, 0, 0, w, h)
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'source-over'
  strokeRibbon(ctx, 8 * k)
  // Filet clair au cœur du ruban : brillance.
  ctx.globalAlpha = alpha * 0.5
  ctx.strokeStyle = '#fffaf0'
  strokePlain(2 * k)
  ctx.restore()
}

// ─── Lieux connus ────────────────────────────────────────────────────────────

/** Lieu connu (point d'intérêt) à l'écran. */
export interface OpeningPoi { x: number; y: number; name: string; ok?: boolean }

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

/** Points d'intérêt : point blanc cerclé, tige, nom blanc au-dessus (étiquette flottante). Au plus 5, hors zone du
 * titre et hors champ écartés. Pas de noms de rues sur l'ouverture. */
function drawOpeningPois(ctx: CanvasRenderingContext2D, w: number, h: number, pois: OpeningPoi[], alpha: number): void {
  if (alpha <= 0 || !pois.length) return
  const k = h / 1080
  const shown = pois.filter(p => p.ok !== false && p.x > w * 0.42 && p.x < w - 80 * k && p.y > 120 * k && p.y < h - 60 * k).slice(0, 5)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const size = Math.round(21 * k)
  ctx.font = `600 ${size}px ${FONT}`
  for (const p of shown) {
    const stem = 30 * k
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5 * k
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - stem); ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(p.x, p.y, 5 * k, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(10,14,18,0.7)'
    ctx.lineWidth = 2 * k
    ctx.stroke()
    const lines = poiLines(p.name)
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 8 * k
    ctx.fillStyle = '#ffffff'
    lines.forEach((l, i) => ctx.fillText(l, p.x, p.y - stem - 8 * k - (lines.length - 1 - i) * size * 1.15))
    ctx.shadowColor = 'transparent'
  }
  ctx.restore()
}

// ─── Titre ───────────────────────────────────────────────────────────────────

export interface OpeningText {
  /** Première ligne du titre : « SEMI-MARATHON ». */
  kicker: string
  /** Élément principal : « LILLE ». */
  main: string
  /** Année, à la suite de l'élément principal : « 2026 ». */
  year: string
  /** « 17 SEPTEMBRE 2026 ». */
  date: string
  /** « 21,1 km ». */
  km: string
  /** « D+ 50 m ». */
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
  const up = (s: string) => s.toLocaleUpperCase('fr-FR')
  return {
    kicker: place ? up(title) : '',
    main: up(place || title || 'Sillonphane'),
    year,
    date: up(o.date ?? ''),
    // « 21,1 km » pour un semi, « 42,195 km » pour un marathon.
    km: formatBannerDistance(o.distanceM).replace(/ KM$/, ' km'),
    gain: `D+ ${Math.round(o.elevGainM / 10) * 10} m`,
  }
}

// Logo Sillonphane : le tracé et les couleurs d'AppLogoIcon.tsx (sillon au dégradé, deux points), sans son fond noir.
const LOGO_D = 'M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60'
let logoPath: Path2D | null = null

/** Logo Sillonphane, hauteur `size` px, coin haut gauche (x, y). */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  if (!logoPath) logoPath = new Path2D(LOGO_D)
  // Le tracé (trait de 29 compris) occupe x 107..249, y 45..247 du repère 320 : on le cadre sur ce rectangle.
  const s = size / 202
  ctx.save()
  ctx.translate(x - 107 * s, y - 45 * s)
  ctx.scale(s, s)
  const grad = ctx.createLinearGradient(0, 232, 0, 60)
  grad.addColorStop(0, '#2F5C45')
  grad.addColorStop(0.5, '#D97A3D')
  grad.addColorStop(1, '#F4EDE0')
  ctx.strokeStyle = grad
  ctx.lineWidth = 29
  ctx.lineCap = 'round'
  ctx.stroke(logoPath)
  ctx.fillStyle = '#2F5C45'
  ctx.strokeStyle = '#F4EDE0'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(220, 60, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#F4EDE0'
  ctx.beginPath(); ctx.arc(138, 225, 10, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/** Pictogramme coureur (badge de distance), tenant dans un carré de `s` px centré en (cx, cy). */
function drawRunnerIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx - s / 2, cy - s / 2)
  ctx.scale(s / 24, s / 24)
  ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath(); ctx.arc(15, 4, 2.4, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(8, 10); ctx.lineTo(12, 8); ctx.lineTo(15, 9.5); ctx.lineTo(17, 13) // bras arrière, épaule, bras avant
  ctx.moveTo(12.5, 8.5); ctx.lineTo(10.5, 14) // buste
  ctx.lineTo(14, 17); ctx.lineTo(13, 22) // jambe avant
  ctx.moveTo(10.5, 14); ctx.lineTo(8, 18); ctx.lineTo(4, 18) // jambe arrière
  ctx.stroke()
  ctx.restore()
}
/** Pictogramme dénivelé (deux sommets), tenant dans un carré de `s` px centré en (cx, cy). */
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

/** Badge arrondi (icône + texte) ; renvoie sa largeur. */
function drawBadge(
  ctx: CanvasRenderingContext2D, x: number, y: number, hgt: number, text: string,
  icon: (c: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void, accent: boolean,
): number {
  const k = hgt / 56
  const size = Math.round(25 * k)
  ctx.font = `600 ${size}px ${FONT}`
  const iconS = 26 * k, padX = 20 * k, gap = 12 * k
  const wd = padX + iconS + gap + ctx.measureText(text).width + padX
  ctx.beginPath()
  ctx.roundRect(x, y, wd, hgt, hgt / 2)
  if (accent) {
    const g = ctx.createLinearGradient(x, 0, x + wd, 0)
    g.addColorStop(0, '#d9262c'); g.addColorStop(1, '#e8492c')
    ctx.fillStyle = g
    ctx.fill()
  } else {
    ctx.fillStyle = 'rgba(14,18,24,0.55)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1.5 * k
    ctx.stroke()
  }
  icon(ctx, x + padX + iconS / 2, y + hgt / 2, iconS)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX + iconS + gap, y + hgt / 2 + 1 * k)
  ctx.textBaseline = 'alphabetic'
  return wd
}

/** Filet au dégradé signature (vert → orange, fondu au bout). */
function drawSignatureLine(ctx: CanvasRenderingContext2D, x: number, y: number, wd: number, hgt: number) {
  const g = ctx.createLinearGradient(x, 0, x + wd, 0)
  g.addColorStop(0, rgb(GREEN)); g.addColorStop(0.6, rgb(ORANGE)); g.addColorStop(1, 'rgba(224,127,60,0)')
  ctx.fillStyle = g
  ctx.fillRect(x, y, wd, hgt)
}

/**
 * Bloc titre à gauche, façon affiche : date en capitales espacées, filet, SEMI-MARATHON et LILLE 2026 en très grand
 * (l'année orange doré), filet au dégradé signature, badges distance et D+, logo Sillonphane et adresse du site.
 * Un seul fondu d'entrée ; effacé au début de la plongée. `t` : temps de l'ouverture (s).
 */
export function drawOpeningTitle(ctx: CanvasRenderingContext2D, w: number, h: number, txt: OpeningText, t: number): void {
  const a = titleAlpha(t)
  if (a <= 0) return
  const k = h / 1080
  const x = Math.round(96 * k)
  const maxW = w * 0.4

  ctx.save()
  ctx.globalAlpha = a
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // Tailles : le titre se réduit pour tenir dans maxW (même taille pour ses deux lignes).
  const mainText = txt.year ? `${txt.main} ${txt.year}` : txt.main
  let size = 124 * k
  const fits = () => {
    ctx.font = `800 ${size}px ${FONT}`
    ctx.letterSpacing = `${-2 * k}px`
    return Math.max(ctx.measureText(mainText).width, txt.kicker ? ctx.measureText(txt.kicker).width : 0) <= maxW
  }
  while (!fits() && size > 56 * k) size -= 3 * k
  ctx.letterSpacing = '0px'

  let y = Math.round(h * 0.14)
  // Date : petite, capitales espacées, discrète.
  if (txt.date) {
    ctx.fillStyle = 'rgba(235,238,242,0.88)'
    ctx.font = `500 ${Math.round(27 * k)}px ${FONT}`
    ctx.letterSpacing = `${9 * k}px`
    ctx.fillText(txt.date, x, y)
    ctx.letterSpacing = '0px'
  }
  y += 22 * k
  drawSignatureLine(ctx, x, y, 150 * k, 3 * k)
  y += 22 * k

  // SEMI-MARATHON / LILLE 2026 : très grand, blanc, gras ; l'année orange doré, un peu lumineuse.
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 22 * k
  ctx.font = `800 ${size}px ${FONT}`
  ctx.letterSpacing = `${-2 * k}px`
  ctx.fillStyle = '#ffffff'
  if (txt.kicker) {
    y += size * 0.86
    ctx.fillText(txt.kicker, x, y)
    y += size * 0.12
  }
  y += size * 0.86
  const mainW = ctx.measureText(`${txt.main} `).width
  ctx.fillText(`${txt.main} `, x, y)
  if (txt.year) {
    const g = ctx.createLinearGradient(0, y - size * 0.72, 0, y)
    g.addColorStop(0, '#ffcf5a'); g.addColorStop(1, '#f07a2a')
    ctx.fillStyle = g
    ctx.shadowColor = 'rgba(255,150,50,0.45)'
    ctx.shadowBlur = 26 * k
    ctx.fillText(txt.year, x + mainW, y)
  }
  ctx.letterSpacing = '0px'
  ctx.shadowColor = 'transparent'
  y += 34 * k
  drawSignatureLine(ctx, x, y, Math.min(maxW, 440 * k), 3 * k)

  // Badges distance (accent rouge orangé) et D+ (sombre, contour discret).
  y += 30 * k
  const bh = 56 * k
  const bw = drawBadge(ctx, x, y, bh, txt.km, drawRunnerIcon, true)
  drawBadge(ctx, x + bw + 16 * k, y, bh, txt.gain, drawMountainIcon, false)
  y += bh

  // Logo Sillonphane (assez grand, discret) et adresse du site.
  y += 58 * k
  const logoH = 112 * k
  ctx.globalAlpha = a * 0.95
  drawLogo(ctx, x + 6 * k, y, logoH)
  y += logoH + 44 * k
  ctx.globalAlpha = a * 0.8
  ctx.fillStyle = '#e8eaee'
  ctx.font = `500 ${Math.round(25 * k)}px ${FONT}`
  ctx.fillText('sillonphane.fr/running', x, y)
  ctx.restore()
}

/** Ouverture complète par-dessus l'image de la carte : étalonnage et lumière, ruban fixe, lieux connus, titre. */
export function drawOpening(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, ribbon: OpeningPt[], txt: OpeningText,
  pois: OpeningPoi[] = [],
): void {
  if (t >= OPENING_S) return
  drawOpeningLight(ctx, w, h, t)
  drawOpeningRibbon(ctx, w, h, ribbon, openingRibbonAlpha(t))
  drawOpeningPois(ctx, w, h, pois, titleAlpha(t))
  drawOpeningTitle(ctx, w, h, txt, t)
}
