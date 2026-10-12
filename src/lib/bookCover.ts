// Couvertures du livre faites à partir d'une photo choisie (fond « photo » de BookLayout), trois modèles :
// - « photo » : la photo en fond, titre en haut à gauche, jusqu'à 3 tracés en bas (date, distance, D+) ;
// - « dessin » : la photo redessinée en gravure sépia sur papier crème (traits, hachures), courbes de niveau, 3 tracés ;
// - « illustration » : la photo en aplats de couleur (affiche illustrée) qui se fond dans le papier à gauche,
//   un seul tracé sous le titre.
// Dessin en millimètres (toile déjà mise à l'échelle), positions reprises des maquettes (1536 × 1024 px) et calées
// dans la zone sûre de la couverture.
import { colorAtStops, ribbonStops, setSpacing, wrapFit, fitFont, SANS, SERIF } from './poster'

export type CoverModel = 'photo' | 'dessin' | 'illustration'

/** Course montrée sur la couverture. */
export interface CoverItem {
  points: { lat: number; lon: number }[]
  /** « 12 OCT. 2025 ». */
  date: string
  /** « 21,1 km ». */
  km: string
  /** « 750 m » (absent : pas de dénivelé connu). */
  dplus?: string
}

/** Textes de la couverture ; `motto` : lignes de la devise (vide = sans), `tagline` : phrase du bas du modèle dessin (vide = sans). */
export interface CoverTexts { title: string; subtitle: string; name: string; motto: string[]; tagline: string }

/** Cadre de la 1re de couverture (jusqu'au bord rogné, fond perdu compris) et zone sûre du texte, en mm. */
export interface CoverFrame { x: number; y: number; w: number; h: number }
export interface CoverSafe { l: number; r: number; t: number; b: number }

/** Mots en colonne, en haut à droite. */
const PAPER_RGB: [number, number, number] = [244, 239, 228]
const PAPER = `rgb(${PAPER_RGB.join(',')})`
const ORANGE = '#E8892B'
const DARK = '#17201B'
const START_GREEN = '#35B04A'

/** Papier crème au dos et sur la tranche (modèles dessinés) ; la photo garde le vert nuit. */
export function coverModelOnPaper(model: CoverModel | undefined): boolean {
  return model === 'dessin' || model === 'illustration'
}

// ── Texte et pictogrammes ────────────────────────────────────────────────────

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string,
  align: CanvasTextAlign = 'left', spacing = 0) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  setSpacing(ctx, spacing)
  // Lettres espacées centrées : l'espace ajouté après la dernière lettre décentre le mot.
  ctx.fillText(s, align === 'center' ? x + spacing / 2 : x, y)
  setSpacing(ctx, 0)
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.16; ctx.lineJoin = 'round'
  const r = s * 0.42, cy = y - s * 0.62
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.arc(x, cy, r, Math.PI * 0.78, Math.PI * 0.22)
  ctx.closePath(); ctx.stroke()
  ctx.beginPath(); ctx.arc(x, cy, r * 0.36, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function mountain(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.14; ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x - s * 0.75, y); ctx.lineTo(x - s * 0.2, y - s * 0.8); ctx.lineTo(x + s * 0.1, y - s * 0.4)
  ctx.lineTo(x + s * 0.35, y - s * 0.62); ctx.lineTo(x + s * 0.75, y); ctx.closePath(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x - s * 0.38, y - s * 0.55); ctx.lineTo(x - s * 0.2, y - s * 0.45); ctx.lineTo(x - s * 0.05, y - s * 0.58); ctx.stroke()
  ctx.restore()
}

/** Ligne « ⌖ 21,1 km   ⛰ 750 m », centrée sur `cx` (ou partant de `cx` si `left`). */
function statsLine(ctx: CanvasRenderingContext2D, it: CoverItem, cx: number, y: number, size: number, color: string) {
  ctx.font = `500 ${size}px ${SANS}`
  const ic = size * 1.05, gap = size * 0.55, sep = size * 1.6
  const wKm = ctx.measureText(it.km).width
  const wD = it.dplus ? ctx.measureText(it.dplus).width : 0
  const total = ic + gap + wKm + (it.dplus ? sep + ic + gap + wD : 0)
  let x = cx - total / 2
  pin(ctx, x + ic / 2, y + size * 0.12, ic, ORANGE); x += ic + gap
  text(ctx, it.km, x, y, `500 ${size}px ${SANS}`, color); x += wKm
  if (it.dplus) {
    x += sep
    mountain(ctx, x + ic / 2, y, ic, ORANGE); x += ic + gap
    text(ctx, it.dplus, x, y, `500 ${size}px ${SANS}`, color)
  }
}

// ── Tracés ───────────────────────────────────────────────────────────────────

function hexLum(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}
/** Ruban vert · orange · crème ; sur papier clair, la partie crème devient grise (sinon invisible). */
function traceStops(light: boolean): [number, string][] {
  const stops = ribbonStops('trois-couleurs')
  return light ? stops.map(([t, c]) => [t, hexLum(c) > 0.72 ? '#8F8D86' : c] as [number, string]) : stops
}

/** Tracé d'une course dans le cadre (centré, proportions gardées), point vert au départ, orange à l'arrivée. */
function drawTrace(ctx: CanvasRenderingContext2D, pts: { lat: number; lon: number }[], x: number, y: number, w: number, h: number,
  lineW: number, light: boolean) {
  if (pts.length < 2) return
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const kx = Math.cos(lat0 * Math.PI / 180)
  const xs = pts.map(p => p.lon * kx), ys = pts.map(p => -p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const s = Math.min(w / Math.max(1e-9, maxX - minX), h / Math.max(1e-9, maxY - minY))
  const dx = x + (w - (maxX - minX) * s) / 2, dy = y + (h - (maxY - minY) * s) / 2
  const X = (j: number) => dx + (xs[j] - minX) * s, Y = (j: number) => dy + (ys[j] - minY) * s
  const stops = traceStops(light)
  ctx.save()
  ctx.lineWidth = lineW; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (!light) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = lineW * 3 }
  const step = Math.max(1, Math.floor(pts.length / 500))
  for (let j = step; j < pts.length; j += step) {
    ctx.strokeStyle = colorAtStops(stops, j / pts.length)
    ctx.beginPath(); ctx.moveTo(X(j - step), Y(j - step)); ctx.lineTo(X(j), Y(j)); ctx.stroke()
  }
  ctx.shadowBlur = 0
  const last = pts.length - 1
  for (const [j, c] of [[0, START_GREEN], [last, ORANGE]] as const) {
    ctx.fillStyle = c
    ctx.beginPath(); ctx.arc(X(j), Y(j), lineW * 2.3, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/** Rangée de 1 à 3 tracés : tracé, date, distance et D+ ; filets orange entre les colonnes. */
function traceRow(ctx: CanvasRenderingContext2D, items: CoverItem[], l: number, r: number, top: number, P: number, light: boolean) {
  const n = items.length
  if (!n) return
  const colW = (r - l) / 3
  const x0 = l + (r - l - n * colW) / 2
  const fg = light ? DARK : '#F4EEE3'
  items.forEach((it, i) => {
    const cx = x0 + colW * (i + 0.5)
    drawTrace(ctx, it.points, cx - colW * 0.3, top, colW * 0.6, 160 * P, 2.6 * P, light)
    text(ctx, it.date, cx, top + 200 * P, `500 ${17 * P}px ${SANS}`, fg, 'center', 4.5 * P)
    statsLine(ctx, it, cx, top + 240 * P, 19 * P, fg)
    if (i > 0) {
      ctx.strokeStyle = light ? 'rgba(193,120,50,0.55)' : 'rgba(232,137,43,0.7)'; ctx.lineWidth = 0.9 * P
      ctx.beginPath(); ctx.moveTo(x0 + colW * i, top + 10 * P); ctx.lineTo(x0 + colW * i, top + 250 * P); ctx.stroke()
    }
  })
}

/** Mots en colonne (devise), filet vertical à gauche, calés sur le bord droit de la zone sûre ; rien sans mots. */
function motto(ctx: CanvasRenderingContext2D, lines: string[], right: number, top: number, P: number, color: string, rule: string) {
  if (!lines.length) return
  ctx.font = `400 ${14 * P}px ${SANS}`
  setSpacing(ctx, 4 * P)
  const w = Math.max(...lines.map(m => ctx.measureText(m).width))
  setSpacing(ctx, 0)
  const x = right - w
  ctx.strokeStyle = rule; ctx.lineWidth = 1.2 * P
  ctx.beginPath(); ctx.moveTo(x - 44 * P, top); ctx.lineTo(x - 44 * P, top + 20 * P + lines.length * 30 * P - 10 * P); ctx.stroke()
  lines.forEach((m, i) => text(ctx, m, x, top + 16 * P + i * 30 * P, `400 ${14 * P}px ${SANS}`, color, 'left', 4 * P))
}

/** Devise d'origine (en haut à droite) et phrase du bas du modèle dessin, quand l'utilisateur n'a rien saisi. */
export const DEFAULT_COVER_MOTTO = 'Courir\nExplorer\nSe dépasser\nSe souvenir'
export const DEFAULT_COVER_TAGLINE = 'Des kilomètres qui ont du sens'
/** Lignes de la devise saisie (6 au plus, en capitales) ; texte vide = pas de devise. */
export function mottoLines(s: string | undefined): string[] {
  return (s ?? DEFAULT_COVER_MOTTO).split('\n').map(l => l.trim().toUpperCase()).filter(Boolean).slice(0, 6)
}

// ── Stylisation de la photo ──────────────────────────────────────────────────

/** Photo recadrée (comme « cover ») sur une toile de w × h px, floutée de `blur` px si demandé. */
function cropTo(img: HTMLImageElement, w: number, h: number, blur = 0): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / r, sh = h / r
  if (blur > 0) g.filter = `blur(${blur}px)` // ignoré par les navigateurs qui ne le gèrent pas : rendu un peu plus dur
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h)
  g.filter = 'none'
  return c
}

/** Luminance (0 à 1) de chaque pixel. */
function lumaOf(d: Uint8ClampedArray, n: number): Float32Array {
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) L[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255
  return L
}

/** Contours (filtre de Sobel), 0 à ~1. */
function sobel(L: Float32Array, w: number, h: number): Float32Array {
  const E = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]
      E[i] = Math.sqrt(gx * gx + gy * gy) / 4
    }
  }
  return E
}

/** Gravure sépia : traits des contours, trois aplats de ton et hachures croisées dans les ombres, sur papier crème. */
function stylizeDessin(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = cropTo(img, w, h, Math.max(0.6, w / 1100))
  const g = c.getContext('2d')!
  const im = g.getImageData(0, 0, w, h)
  const d = im.data
  const L = lumaOf(d, w * h)
  const E = sobel(L, w, h)
  const ink: [number, number, number] = [156, 116, 66]
  const period = Math.max(3, Math.round(w / 210))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const tone = 1 - L[i]
      let a = Math.min(1, Math.max(0, (E[i] - 0.05) * 5.5)) * 0.95
      a += tone > 0.78 ? 0.42 : tone > 0.58 ? 0.24 : tone > 0.38 ? 0.1 : 0
      if (tone > 0.5 && (x - y + 10000 * period) % period === 0) a += 0.3
      if (tone > 0.7 && (x + y) % period === 0) a += 0.3
      a = Math.min(0.92, a)
      d[i * 4] = PAPER_RGB[0] + (ink[0] - PAPER_RGB[0]) * a
      d[i * 4 + 1] = PAPER_RGB[1] + (ink[1] - PAPER_RGB[1]) * a
      d[i * 4 + 2] = PAPER_RGB[2] + (ink[2] - PAPER_RGB[2]) * a
      d[i * 4 + 3] = 255
    }
  }
  g.putImageData(im, 0, 0)
  return c
}

/** Affiche illustrée : couleurs adoucies, ravivées et réduites à quelques aplats, contours légèrement soulignés. */
function stylizeIllustration(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const c = cropTo(img, w, h, Math.max(1, w / 520))
  const g = c.getContext('2d')!
  const im = g.getImageData(0, 0, w, h)
  const d = im.data
  const L = lumaOf(d, w * h)
  const E = sobel(L, w, h)
  const levels = 6
  const q = (v: number) => Math.round(Math.max(0, Math.min(255, v)) / 255 * (levels - 1)) / (levels - 1) * 255
  for (let i = 0; i < w * h; i++) {
    let r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]
    const m = (r + gg + b) / 3
    r = m + (r - m) * 1.3 + 8; gg = m + (gg - m) * 1.3 + 8; b = m + (b - m) * 1.3 + 6
    let rr = q(r), g2 = q(gg), b2 = q(b)
    // Aplats un peu plus doux que la quantification brute : mélange avec la couleur ravivée.
    rr = rr * 0.7 + Math.min(255, r) * 0.3; g2 = g2 * 0.7 + Math.min(255, gg) * 0.3; b2 = b2 * 0.7 + Math.min(255, b) * 0.3
    const k = E[i] > 0.16 ? 0.72 : 1
    d[i * 4] = rr * k; d[i * 4 + 1] = g2 * k; d[i * 4 + 2] = b2 * k
  }
  g.putImageData(im, 0, 0)
  return c
}

/** Dernières photos stylisées (l'aperçu redessine la couverture à chaque réglage). */
const styled = new Map<string, HTMLCanvasElement>()
function styledPhoto(img: HTMLImageElement, key: string, model: CoverModel, w: number, h: number): HTMLCanvasElement {
  const k = `${key}|${model}|${w}x${h}`
  const hit = styled.get(k)
  if (hit) return hit
  const c = model === 'dessin' ? stylizeDessin(img, w, h) : model === 'illustration' ? stylizeIllustration(img, w, h) : cropTo(img, w, h)
  styled.set(k, c)
  while (styled.size > 4) styled.delete(styled.keys().next().value!)
  return c
}

/** Luminance moyenne d'une zone de la toile (0 à 1), pour choisir un texte foncé ou clair. */
function zoneLuma(c: HTMLCanvasElement, x: number, y: number, w: number, h: number): number {
  const g = c.getContext('2d')!
  const X = Math.max(0, Math.round(x)), Y = Math.max(0, Math.round(y))
  const W = Math.max(1, Math.min(c.width - X, Math.round(w))), H = Math.max(1, Math.min(c.height - Y, Math.round(h)))
  const d = g.getImageData(X, Y, W, H).data
  let s = 0, n = 0
  for (let i = 0; i < d.length; i += 16) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++ }
  return n ? s / n / 255 : 0.5
}

/** Courbes de niveau décoratives (modèle dessin), dans les coins du bas. */
function contours(ctx: CanvasRenderingContext2D, f: CoverFrame, P: number) {
  ctx.save()
  ctx.lineWidth = 0.8 * P
  for (let k = 0; k < 7; k++) {
    for (const side of [0, 1]) {
      ctx.strokeStyle = k % 3 === 0 ? 'rgba(214,128,52,0.28)' : 'rgba(150,120,90,0.2)'
      ctx.beginPath()
      for (let t = 0; t <= 60; t++) {
        const u = t / 60
        const x = side ? f.x + f.w * (0.62 + u * 0.38) : f.x + f.w * u * 0.36
        const base = f.y + f.h * (0.76 + k * 0.035)
        const y = base + Math.sin(u * 5 + k * 0.8 + side * 2) * f.h * 0.018 + Math.sin(u * 11 + k) * f.h * 0.006
        if (t) ctx.lineTo(x, y); else ctx.moveTo(x, y)
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Dégradé du papier vers la transparence entre `from` et `to` (verticaux ou horizontaux). */
function fade(ctx: CanvasRenderingContext2D, f: CoverFrame, x0: number, y0: number, x1: number, y1: number, alpha = 1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, `rgba(${PAPER_RGB.join(',')},${alpha})`); g.addColorStop(1, `rgba(${PAPER_RGB.join(',')},0)`)
  ctx.fillStyle = g; ctx.fillRect(f.x, f.y, f.w, f.h)
}

// ── Couverture ───────────────────────────────────────────────────────────────

/**
 * 1re de couverture d'après une photo, selon le modèle. `items` : 1 à 3 courses (le modèle illustration n'en montre
 * qu'une). `key` identifie la photo (cache de la stylisation).
 */
export function drawPhotoCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, key: string, model: CoverModel,
  items: CoverItem[], t: CoverTexts, f: CoverFrame, safe: CoverSafe, pxPerMm: number) {
  // Échelle des maquettes : 870 px de haut (y 100 à 970) dans la zone sûre.
  const P = (safe.b - safe.t) / 870
  const Y = (yd: number) => safe.t + (yd - 100) * P
  const workW = Math.max(200, Math.min(1500, Math.round(f.w * pxPerMm)))
  const workH = Math.max(100, Math.round(workW * f.h / f.w))
  // Illustration : image sur les 82 % de droite seulement.
  const IL = 0.18
  const pic = styledPhoto(img, key, model, model === 'illustration' ? Math.round(workW * (1 - IL)) : workW, workH)
  const toPx = workW / f.w
  ctx.save()
  ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip()

  if (model === 'photo') {
    ctx.drawImage(pic, f.x, f.y, f.w, f.h)
    const left = Math.max(safe.l, f.x + f.w * 0.12)
    // Texte foncé sur un ciel clair, sinon crème sur un voile sombre.
    const lum = zoneLuma(pic, (left - f.x) * toPx, (Y(100) - f.y) * toPx, f.w * 0.42 * toPx, 230 * P * toPx)
    const dark = lum > 0.62
    if (!dark) {
      const g = ctx.createLinearGradient(f.x, f.y, f.x + f.w * 0.6, Y(420))
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(f.x, f.y, f.w, f.h)
    }
    const g = ctx.createLinearGradient(0, Y(600), 0, f.y + f.h)
    g.addColorStop(0, 'rgba(10,14,12,0)'); g.addColorStop(0.55, 'rgba(10,14,12,0.62)'); g.addColorStop(1, 'rgba(10,14,12,0.85)')
    ctx.fillStyle = g; ctx.fillRect(f.x, f.y, f.w, f.h)
    const fg = dark ? DARK : '#F6F0E6'
    const width = f.w * 0.5
    text(ctx, t.title.toUpperCase(), left, Y(135), `500 ${24 * P}px ${SANS}`, fg, 'left', 9 * P)
    const big = t.subtitle || t.title
    const size = fitFont(ctx, big, 600, SERIF, 104 * P, 40 * P, width)
    text(ctx, big, left, Y(135) + size * 1.02, `600 ${size}px ${SERIF}`, fg)
    const ry = Y(135) + size * 1.02 + 30 * P
    ctx.fillStyle = ORANGE; ctx.fillRect(left, ry, 68 * P, 3.6 * P)
    if (t.name) text(ctx, t.name.toUpperCase(), left, ry + 46 * P, `400 ${19 * P}px ${SANS}`, fg, 'left', 7.5 * P)
    const rLum = zoneLuma(pic, (safe.r - f.x - f.w * 0.16) * toPx, (Y(112) - f.y) * toPx, f.w * 0.16 * toPx, 110 * P * toPx)
    motto(ctx, t.motto, safe.r, Y(112), P, rLum > 0.62 ? 'rgba(23,32,27,0.85)' : 'rgba(246,240,230,0.9)', rLum > 0.62 ? 'rgba(23,32,27,0.7)' : 'rgba(246,240,230,0.75)')
    traceRow(ctx, items.slice(0, 3), Math.max(safe.l, f.x + f.w * 0.05), Math.min(safe.r, f.x + f.w * 0.95), Y(700), P, false)
  } else if (model === 'dessin') {
    ctx.fillStyle = PAPER; ctx.fillRect(f.x, f.y, f.w, f.h)
    ctx.drawImage(pic, f.x, f.y, f.w, f.h)
    // Dessin dans la bande du milieu : papier nu sous le titre et sous les tracés.
    fade(ctx, f, 0, f.y + f.h * 0.12, 0, f.y + f.h * 0.36, 0.95)
    fade(ctx, f, 0, f.y + f.h, 0, f.y + f.h * 0.6, 1)
    fade(ctx, f, f.x, 0, f.x + f.w * 0.32, 0, 0.55)
    contours(ctx, f, P)
    const left = Math.max(safe.l, f.x + f.w * 0.085)
    const tt = wrapFit(ctx, t.title, 600, SERIF, 116 * P, 50 * P, f.w * 0.55, 1)
    const ty = Y(100) + tt.size * 0.8
    text(ctx, tt.lines[0] ?? '', left, ty, `600 ${tt.size}px ${SERIF}`, DARK)
    let y = ty + 66 * P
    if (t.subtitle) { text(ctx, t.subtitle, left, y, `600 ${36 * P}px ${SANS}`, ORANGE, 'left', 11 * P); y += 34 * P }
    ctx.fillStyle = ORANGE; ctx.fillRect(left, y, 92 * P, 2.4 * P)
    if (t.name) text(ctx, t.name.toUpperCase(), left, y + 48 * P, `400 ${21 * P}px ${SANS}`, DARK, 'left', 7 * P)
    motto(ctx, t.motto, safe.r, Y(105), P, 'rgba(23,32,27,0.85)', 'rgba(23,32,27,0.7)')
    traceRow(ctx, items.slice(0, 3), Math.max(safe.l, f.x + f.w * 0.07), Math.min(safe.r, f.x + f.w * 0.93), Y(660), P, true)
    const msg = t.tagline.trim().toUpperCase()
    if (msg) {
      const fy = Y(960)
      const cx = f.x + f.w / 2
      // Phrase longue : lettres réduites (jusqu'à 8 px de maquette) pour tenir dans 70 % de la largeur.
      const fs = fitFont(ctx, msg, 500, SANS, 14 * P, 8 * P, f.w * 0.7 - msg.length * 5 * P)
      setSpacing(ctx, 5 * P)
      const mw = ctx.measureText(msg).width; setSpacing(ctx, 0)
      text(ctx, msg, cx, fy, `500 ${fs}px ${SANS}`, 'rgba(23,32,27,0.8)', 'center', 5 * P)
      ctx.strokeStyle = 'rgba(23,32,27,0.5)'; ctx.lineWidth = 0.8 * P
      for (const s of [-1, 1]) {
        const x0 = cx + s * (mw / 2 + 28 * P)
        ctx.beginPath(); ctx.moveTo(x0, fy - 5 * P); ctx.lineTo(x0 + s * 56 * P, fy - 5 * P); ctx.stroke()
      }
    }
  } else {
    ctx.fillStyle = PAPER; ctx.fillRect(f.x, f.y, f.w, f.h)
    // Image à droite, fondue dans le papier à gauche (et un peu en haut, sous la devise).
    ctx.drawImage(pic, f.x + f.w * IL, f.y, f.w * (1 - IL), f.h)
    fade(ctx, f, f.x + f.w * 0.3, 0, f.x + f.w * 0.56, 0, 1)
    fade(ctx, f, 0, f.y, 0, f.y + f.h * 0.22, 0.5)
    const left = Math.max(safe.l, f.x + f.w * 0.085)
    const tt = wrapFit(ctx, t.title, 800, SANS, 112 * P, 48 * P, f.w * 0.56, 1)
    const ty = Y(110) + tt.size * 0.78
    text(ctx, tt.lines[0] ?? '', left, ty, `800 ${tt.size}px ${SANS}`, '#0F1B2A', 'left', -1.5 * P)
    let y = ty + 66 * P
    if (t.subtitle) { text(ctx, t.subtitle, left, y, `600 ${36 * P}px ${SANS}`, '#E06A1B', 'left', 11 * P); y += 32 * P }
    ctx.fillStyle = '#E06A1B'; ctx.fillRect(left, y, 92 * P, 2.4 * P)
    if (t.name) text(ctx, t.name.toUpperCase(), left, y + 46 * P, `400 ${21 * P}px ${SANS}`, DARK, 'left', 7 * P)
    const rLum = zoneLuma(pic, (safe.r - f.x - f.w * (0.16 + IL)) * toPx, (Y(130) - f.y) * toPx, f.w * 0.16 * toPx, 110 * P * toPx)
    motto(ctx, t.motto, safe.r, Y(130), P, rLum > 0.55 ? 'rgba(23,32,27,0.85)' : 'rgba(246,240,230,0.92)', rLum > 0.55 ? 'rgba(23,32,27,0.7)' : 'rgba(246,240,230,0.75)')
    const it = items[0]
    if (it) {
      drawTrace(ctx, it.points, left + 20 * P, Y(420), 230 * P, 220 * P, 2.6 * P, true)
      text(ctx, it.date, left, Y(712), `500 ${23 * P}px ${SANS}`, DARK, 'left', 4.5 * P)
      const ic = 26 * P
      pin(ctx, left + ic / 2, Y(770), ic, '#E06A1B')
      text(ctx, it.km, left + ic + 34 * P, Y(768), `500 ${20 * P}px ${SANS}`, DARK)
      if (it.dplus) {
        mountain(ctx, left + ic / 2, Y(814), ic, '#E06A1B')
        text(ctx, it.dplus, left + ic + 34 * P, Y(814), `500 ${20 * P}px ${SANS}`, DARK)
      }
    }
  }
  ctx.restore()
}

// ── Couverture « Vagues » (sans photo) ───────────────────────────────────────

/** Place du tracé sur la couverture, en fractions du cadre de la 1re de couverture : centre et largeur (la hauteur
 * suit les proportions du tracé). Réglée avec les poignées de l'aperçu (écran « Mise en page du livre »). */
export interface TraceBox { cx: number; cy: number; w: number }

/** Largeur / hauteur du tracé (en distances réelles), 1 si dégénéré. */
export function traceAspect(pts: { lat: number; lon: number }[]): number {
  if (pts.length < 2) return 1
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity, s = 0
  for (const p of pts) { a = Math.min(a, p.lon); b = Math.max(b, p.lon); c = Math.min(c, p.lat); d = Math.max(d, p.lat); s += p.lat }
  const w = (b - a) * Math.cos(s / pts.length * Math.PI / 180), h = d - c
  return w > 0 && h > 0 ? Math.max(0.15, Math.min(7, w / h)) : 1
}

/** Place par défaut : au milieu, au-dessus des vagues, dans 40 % × 36 % du cadre. */
export function defaultTraceBox(aspect: number, frameRatio: number): TraceBox {
  return { cx: 0.53, cy: 0.4, w: Math.min(0.4, 0.36 * aspect / frameRatio) }
}

/** Rectangle du tracé (fractions du cadre) : largeur réglée, hauteur selon ses proportions. */
export function traceRect(pts: { lat: number; lon: number }[], box: TraceBox | undefined, frameRatio: number) {
  const aspect = traceAspect(pts)
  const bx = box ?? defaultTraceBox(aspect, frameRatio)
  const h = bx.w * frameRatio / aspect
  return { x: bx.cx - bx.w / 2, y: bx.cy - h / 2, w: bx.w, h }
}

function calendar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = s * 0.1; ctx.lineJoin = 'round'
  const l = x - s * 0.5, t = y - s * 0.85, w = s, h = s * 0.85
  ctx.strokeRect(l, t, w, h)
  ctx.beginPath(); ctx.moveTo(l, t + h * 0.28); ctx.lineTo(l + w, t + h * 0.28); ctx.stroke()
  for (const dx of [0.28, 0.72]) { ctx.beginPath(); ctx.moveTo(l + w * dx, t - s * 0.12); ctx.lineTo(l + w * dx, t + s * 0.1); ctx.stroke() }
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) ctx.fillRect(l + w * (0.22 + c * 0.25), t + h * (0.48 + r * 0.24), s * 0.08, s * 0.08)
  ctx.restore()
}

/**
 * 1re de couverture « Vagues », sans photo : papier clair, grand titre, devise, une course (date, distance, D+ en
 * colonne et son tracé en travers de la page), vagues bleu nuit et orange en bas, courbes de niveau. Formes reprises
 * de la maquette (1536 × 1024) sur tout le cadre ; textes dans la zone sûre.
 */
export function drawGraphicCover(ctx: CanvasRenderingContext2D, item: CoverItem | undefined, t: CoverTexts,
  f: CoverFrame, safe: CoverSafe, box?: TraceBox) {
  const P = (safe.b - safe.t) / 870
  const Y = (yd: number) => safe.t + (yd - 100) * P
  const X = (xd: number) => f.x + xd / 1536 * f.w, Yf = (yd: number) => f.y + yd / 1024 * f.h
  const NAVY = '#1E2A33', ORANGE2 = '#EE7F2D'
  ctx.save()
  ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip()
  ctx.fillStyle = '#F3F1EC'; ctx.fillRect(f.x, f.y, f.w, f.h)

  // Courbes de niveau, au milieu.
  ctx.lineWidth = 0.7 * P
  for (let k = 0; k < 9; k++) {
    ctx.strokeStyle = k % 4 === 0 ? 'rgba(238,127,45,0.22)' : 'rgba(120,118,110,0.18)'
    ctx.beginPath()
    for (let i = 0; i <= 80; i++) {
      const u = i / 80
      const xd = 120 + u * 1300
      const yd = 760 - u * 420 + k * 28 + Math.sin(u * 7 + k * 0.7) * 26 + Math.sin(u * 17 + k) * 7
      if (i) ctx.lineTo(X(xd), Yf(yd)); else ctx.moveTo(X(xd), Yf(yd))
    }
    ctx.stroke()
  }

  /** Forme fermée : suite de courbes de Bézier en coordonnées de maquette. */
  const shape = (fill: string, start: [number, number], curves: number[][], close: [number, number][] = []) => {
    ctx.beginPath(); ctx.moveTo(X(start[0]), Yf(start[1]))
    for (const c of curves) {
      if (c.length === 6) ctx.bezierCurveTo(X(c[0]), Yf(c[1]), X(c[2]), Yf(c[3]), X(c[4]), Yf(c[5]))
      else ctx.lineTo(X(c[0]), Yf(c[1]))
    }
    for (const [x, y] of close) ctx.lineTo(X(x), Yf(y))
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
  }
  const line = (stroke: string, w: number, start: [number, number], curves: number[][]) => {
    ctx.beginPath(); ctx.moveTo(X(start[0]), Yf(start[1]))
    for (const c of curves) ctx.bezierCurveTo(X(c[0]), Yf(c[1]), X(c[2]), Yf(c[3]), X(c[4]), Yf(c[5]))
    ctx.strokeStyle = stroke; ctx.lineWidth = w * P; ctx.stroke()
  }
  // Voiles gris clair à droite.
  shape('rgba(214,210,200,0.55)', [960, 700], [[1120, 600, 1220, 380, 1536, 290]], [[1536, 1024], [960, 1024]])
  shape('rgba(226,222,214,0.7)', [1100, 760], [[1250, 640, 1350, 560, 1536, 540]], [[1536, 1024], [1100, 1024]])
  // Vague bleu nuit à droite.
  shape(NAVY, [1170, 640], [[1290, 560, 1340, 420, 1536, 410], [1536, 720], [1400, 700, 1300, 640, 1170, 640]])
  // Bande orange.
  shape(ORANGE2, [470, 880], [[650, 820, 760, 640, 900, 610], [1050, 580, 1200, 640, 1536, 715], [1536, 780],
    [1250, 700, 1100, 665, 960, 685], [820, 705, 700, 860, 520, 905]])
  // Grande vague bleu nuit en bas.
  shape(NAVY, [0, 780], [[150, 760, 300, 800, 450, 850], [600, 905, 700, 770, 850, 770], [1000, 770, 1250, 850, 1536, 960]],
    [[1536, 1024], [0, 1024]])
  shape('#24323C', [0, 900], [[300, 860, 600, 880, 800, 940], [900, 970, 1000, 1000, 1050, 1024]], [[0, 1024]])
  // Bande orange dans la vague du bas.
  shape(ORANGE2, [300, 1024], [[500, 940, 750, 892, 960, 902], [965, 922], [760, 918, 540, 962, 400, 1024]])
  // Filets.
  line(ORANGE2, 1.4, [0, 800], [[260, 740, 260, 900, 0, 920]])
  line('rgba(255,255,255,0.75)', 0.9, [1060, 1024], [[1220, 900, 1380, 830, 1536, 790]])
  line(ORANGE2, 1.2, [1170, 560], [[1330, 460, 1440, 380, 1536, 250]])
  line(ORANGE2, 1.2, [1180, 860], [[1300, 900, 1420, 950, 1536, 1000]])

  // Textes.
  const left = Math.max(safe.l, f.x + f.w * 0.08)
  const tt = wrapFit(ctx, t.title, 800, SANS, 118 * P, 48 * P, f.w * 0.6, 1)
  const ty = Y(100) + tt.size * 0.8
  text(ctx, tt.lines[0] ?? '', left, ty, `800 ${tt.size}px ${SANS}`, '#0F1B2A', 'left', -1.5 * P)
  let y = ty + 66 * P
  if (t.subtitle) { text(ctx, t.subtitle, left, y, `600 ${36 * P}px ${SANS}`, ORANGE2, 'left', 11 * P); y += 32 * P }
  ctx.fillStyle = ORANGE2; ctx.fillRect(left, y, 92 * P, 2.4 * P)
  if (t.name) text(ctx, t.name.toUpperCase(), left, y + 46 * P, `400 ${21 * P}px ${SANS}`, DARK, 'left', 7 * P)
  motto(ctx, t.motto, safe.r, Y(100), P, 'rgba(15,27,42,0.85)', 'rgba(15,27,42,0.85)')

  if (item) {
    const b = traceRect(item.points, box, f.w / f.h)
    drawTrace(ctx, item.points, f.x + b.x * f.w, f.y + b.y * f.h, b.w * f.w, b.h * f.h, 4.6 * P, true)
    const ic = 28 * P, tx = left + ic + 34 * P
    calendar(ctx, left + ic / 2, Y(505), ic, ORANGE2)
    text(ctx, item.date, tx, Y(500), `500 ${21 * P}px ${SANS}`, DARK, 'left', 2 * P)
    pin(ctx, left + ic / 2, Y(560), ic, ORANGE2)
    text(ctx, item.km, tx, Y(555), `500 ${21 * P}px ${SANS}`, DARK, 'left', 1 * P)
    if (item.dplus) {
      mountain(ctx, left + ic / 2, Y(610), ic, ORANGE2)
      text(ctx, item.dplus, tx, Y(608), `500 ${21 * P}px ${SANS}`, DARK, 'left', 1 * P)
    }
  }
  ctx.restore()
}
