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
/** Lieu connu (point d'intérêt) à l'écran. */
export interface OpeningPoi { x: number; y: number; name: string; type?: string; ok?: boolean }
/** Ce que chaque film calcule avec sa caméra, image par image : parcours et lieux à l'écran. */
export interface OpeningFrame { ribbon: OpeningPt[]; pois: OpeningPoi[] }

// ─── Réglages ────────────────────────────────────────────────────────────────

/** Couleurs du ruban (celles du ruban du film 3D et du logo) : vert, orange, crème. */
const GREEN: [number, number, number] = [0x3e, 0x9e, 0x68]
const ORANGE: [number, number, number] = [0xe0, 0x7f, 0x3c]
const CREAM: [number, number, number] = [0xf6, 0xef, 0xe2]
/** Dégradé du ruban, en part de la distance parcourue : vert au départ, vert → orange jusqu'à `orangeFrom`, orange
 * jusqu'à `orangeTo`, puis orange → crème jusqu'à l'arrivée. Une seule fois sur tout le parcours. */
export const RIBBON_STOPS = { orangeFrom: 0.45, orangeTo: 0.7 }
/** Ruban : largeur du trait, largeur et opacité du léger halo (en px pour une image de 1080 px de haut). */
export const RIBBON_STYLE = { width: 7, glowWidth: 13, glowBlur: 5, glowAlpha: 0.35 }

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

/**
 * Étalonnage de la carte : contraste un peu renforcé, lumière douce et chaude de matin depuis le haut à droite, brume
 * de profondeur vers l'horizon, gauche assombrie pour le titre (sans noircir la carte). Couleurs naturelles. Voile de
 * levée du tout début. Tout s'atténue pendant le passage à la première scène.
 */
export function drawOpeningMapGrade(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const strength = 1 - openingDiveK(t)
  if (strength > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = 0.4 * strength
    ctx.drawImage(ctx.canvas, 0, 0, w, h)
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = 0.22 * strength
    ctx.fillStyle = '#ffd9a8'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = strength
    const sun = ctx.createRadialGradient(w * 0.97, 0, 0, w * 0.97, 0, w * 0.6)
    sun.addColorStop(0, 'rgba(255,222,175,0.22)')
    sun.addColorStop(1, 'rgba(255,215,165,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, w, h)
    const haze = ctx.createLinearGradient(0, 0, 0, h * 0.42)
    haze.addColorStop(0, 'rgba(190,205,220,0.14)')
    haze.addColorStop(1, 'rgba(190,205,220,0)')
    ctx.fillStyle = haze
    ctx.fillRect(0, 0, w, h * 0.42)
    ctx.globalCompositeOperation = 'source-over'
    const left = ctx.createLinearGradient(0, 0, w * 0.6, 0)
    left.addColorStop(0, 'rgba(6,9,14,0.74)')
    left.addColorStop(0.45, 'rgba(6,9,14,0.46)')
    left.addColorStop(1, 'rgba(6,9,14,0)')
    ctx.fillStyle = left
    ctx.fillRect(0, 0, w, h)
    const vert = ctx.createLinearGradient(0, 0, 0, h)
    vert.addColorStop(0.82, 'rgba(6,9,14,0)')
    vert.addColorStop(1, 'rgba(6,9,14,0.35)')
    ctx.fillStyle = vert
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
  const veil = 1 - smooth(t / OPENING.mapInS)
  if (veil > 0) {
    ctx.save()
    ctx.fillStyle = `rgba(6,9,14,${veil})`
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

/** Ruban du parcours, FIXE, posé sur la carte : dégradé à la distance parcourue, liseré sombre, très léger halo pour
 * la lisibilité (pas de néon : la carte reste visible autour). */
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
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(8,12,10,0.45)'
  strokePlain((RIBBON_STYLE.width + 4) * k)
  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = alpha * RIBBON_STYLE.glowAlpha
  ctx.drawImage(glowCanvas, 0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = alpha
  strokeRibbon(ctx, RIBBON_STYLE.width * k)
  ctx.globalAlpha = alpha * 0.3
  ctx.strokeStyle = '#fffaf0'
  strokePlain(1.6 * k)
  ctx.restore()
}

// ─── Lieux connus ────────────────────────────────────────────────────────────

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

/** Lieux connus : point blanc cerclé, tige, nom blanc au-dessus (étiquette flottante). Au plus 5 ; hors champ et zone
 * du titre écartés. Pas de noms de rues sur l'ouverture. */
export function drawPoiLabels(ctx: CanvasRenderingContext2D, w: number, h: number, pois: OpeningPoi[], alpha: number): void {
  if (alpha <= 0 || !pois.length) return
  const k = h / 1080
  const shown = pois.filter(p => p.ok !== false && p.x > w * 0.42 && p.x < w - 80 * k && p.y > 120 * k && p.y < h - 60 * k).slice(0, 5)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const size = Math.round(22 * k)
  ctx.font = `600 ${size}px ${FONT}`
  for (const p of shown) {
    const stem = 30 * k
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5 * k
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - stem); ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(p.x, p.y, 5.5 * k, 0, Math.PI * 2); ctx.fill()
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

// ─── Titre, chiffres, logo ───────────────────────────────────────────────────

/** Marge gauche du bloc titre et largeur maximale du titre. */
const titleX = (h: number) => Math.round(96 * (h / 1080))
const titleMaxW = (w: number) => w * 0.4

/** Filet au dégradé signature (vert → orange, fondu au bout). */
function drawSignatureLine(ctx: CanvasRenderingContext2D, x: number, y: number, wd: number, hgt: number) {
  const g = ctx.createLinearGradient(x, 0, x + wd, 0)
  g.addColorStop(0, rgb(GREEN)); g.addColorStop(0.6, rgb(ORANGE)); g.addColorStop(1, 'rgba(224,127,60,0)')
  ctx.fillStyle = g
  ctx.fillRect(x, y, wd, hgt)
}

/** Date, nom de la course, ville et année (orange doré, même hauteur que la ville), filets. Renvoie le bas du bloc. */
export function drawEventTitle(ctx: CanvasRenderingContext2D, w: number, h: number, ev: OpeningEvent): number {
  const k = h / 1080
  const x = titleX(h), maxW = titleMaxW(w)
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // Taille commune aux deux lignes, réduite pour tenir dans maxW.
  const cityLine = ev.year ? `${ev.city} ${ev.year}` : ev.city
  let size = 124 * k
  const fits = () => {
    ctx.font = `800 ${size}px ${FONT}`
    ctx.letterSpacing = `${-2 * k}px`
    return Math.max(ctx.measureText(cityLine).width, ev.title ? ctx.measureText(ev.title).width : 0) <= maxW
  }
  while (!fits() && size > 56 * k) size -= 3 * k

  let y = Math.round(h * 0.14)
  if (ev.date) {
    ctx.letterSpacing = `${9 * k}px`
    ctx.fillStyle = 'rgba(235,238,242,0.88)'
    ctx.font = `500 ${Math.round(27 * k)}px ${FONT}`
    ctx.fillText(ev.date, x, y)
  }
  y += 22 * k
  drawSignatureLine(ctx, x, y, 150 * k, 3 * k)
  y += 22 * k

  ctx.font = `800 ${size}px ${FONT}`
  ctx.letterSpacing = `${-2 * k}px`
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 22 * k
  ctx.fillStyle = '#ffffff'
  if (ev.title) {
    y += size * 0.86
    ctx.fillText(ev.title, x, y)
    y += size * 0.12
  }
  y += size * 0.86
  const cityW = ctx.measureText(`${ev.city} `).width
  ctx.fillText(`${ev.city} `, x, y)
  if (ev.year) {
    const g = ctx.createLinearGradient(0, y - size * 0.72, 0, y)
    g.addColorStop(0, '#ffcf5a'); g.addColorStop(1, '#f07a2a')
    ctx.fillStyle = g
    ctx.shadowColor = 'rgba(255,150,50,0.4)'
    ctx.shadowBlur = 22 * k
    ctx.fillText(ev.year, x + cityW, y)
  }
  ctx.restore()
  y += 34 * k
  drawSignatureLine(ctx, x, y, Math.min(maxW, 440 * k), 3 * k)
  return y + 3 * k
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
/** Badge arrondi (icône + texte) ; renvoie sa largeur. */
function drawBadge(
  ctx: CanvasRenderingContext2D, x: number, y: number, hgt: number, text: string,
  icon: (c: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void, accent: boolean,
): number {
  const k = hgt / 56
  ctx.font = `600 ${Math.round(25 * k)}px ${FONT}`
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

/** Badges distance (accent rouge orangé) et D+ (sombre, contour discret), à partir de `y`. Renvoie leur bas. */
export function drawEventStats(ctx: CanvasRenderingContext2D, h: number, ev: OpeningEvent, y: number): number {
  const k = h / 1080, x = titleX(h), bh = 56 * k
  ctx.save()
  const bw = drawBadge(ctx, x, y, bh, ev.distance, drawRunnerIcon, true)
  drawBadge(ctx, x + bw + 16 * k, y, bh, ev.elevation, drawMountainIcon, false)
  ctx.restore()
  return y + bh
}

// Logo Sillonphane : le tracé et les couleurs d'AppLogoIcon.tsx (sillon au dégradé, deux points), sans son fond noir.
const LOGO_D = 'M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60'
let logoPath: Path2D | null = null

/** Logo Sillonphane (identique pour toutes les épreuves) et adresse du site, à partir de `y`. */
export function drawBranding(ctx: CanvasRenderingContext2D, h: number, y: number): void {
  const k = h / 1080, x = titleX(h), size = 112 * k
  if (!logoPath) logoPath = new Path2D(LOGO_D)
  // Le tracé (trait de 29 compris) occupe x 107..249, y 45..247 du repère 320 : on le cadre sur ce rectangle.
  const s = size / 202
  ctx.save()
  ctx.save()
  ctx.translate(x + 6 * k - 107 * s, y - 45 * s)
  ctx.scale(s, s)
  const grad = ctx.createLinearGradient(0, 232, 0, 60)
  grad.addColorStop(0, '#2F5C45'); grad.addColorStop(0.5, '#D97A3D'); grad.addColorStop(1, '#F4EDE0')
  ctx.strokeStyle = grad
  ctx.lineWidth = 29
  ctx.lineCap = 'round'
  ctx.stroke(logoPath)
  ctx.fillStyle = '#2F5C45'; ctx.strokeStyle = '#F4EDE0'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(220, 60, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#F4EDE0'
  ctx.beginPath(); ctx.arc(138, 225, 10, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  ctx.globalAlpha *= 0.85
  ctx.fillStyle = '#e8eaee'
  ctx.textAlign = 'left'
  ctx.font = `500 ${Math.round(25 * k)}px ${FONT}`
  ctx.fillText('sillonphane.fr/running', x, y + size + 44 * k)
  ctx.restore()
}

// ─── Scène ───────────────────────────────────────────────────────────────────

/** Page d'ouverture complète, par-dessus l'image de la carte déjà dessinée : étalonnage, ruban fixe, lieux connus,
 * titre, chiffres, logo. `t` : temps de l'ouverture (s). */
export function drawOpeningScene(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, ev: OpeningEvent, frame: OpeningFrame,
): void {
  if (t >= OPENING_S) return
  drawOpeningMapGrade(ctx, w, h, t)
  drawRouteRibbon(ctx, w, h, frame.ribbon, openingRibbonAlpha(t))
  const a = titleAlpha(t)
  drawPoiLabels(ctx, w, h, frame.pois, a)
  if (a <= 0) return
  ctx.save()
  ctx.globalAlpha = a
  const k = h / 1080
  const y = drawEventStats(ctx, h, ev, drawEventTitle(ctx, w, h, ev) + 30 * k)
  drawBranding(ctx, h, y + 58 * k)
  ctx.restore()
}
