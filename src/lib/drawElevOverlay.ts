import type { GpxPoint } from '../types'

interface OverlayState {
  points: GpxPoint[]
  distances: number[]
  progress: number
  distanceCovered: number
  totalDistance: number
  elevGain: number
  elevLoss: number
  currentEle: number
  trackName: string
  /** Temps écoulé au point atteint (s) et son intitulé (« TEMPS », « TEMPS PRÉVU », « TEMPS ESTIMÉ », cf. raceClock) ;
   * absent = l'altitude prend la quatrième case. */
  elapsedS?: number
  timeLabel?: string
  /** Échelle de la tablette (défaut ELEV_OVERLAY_SCALE) : plus grande pour qu'elle reste lisible sur un écran de téléphone. */
  scale?: number
}

/** Tablette sombre translucide : pictogrammes jaunes, chiffres blancs, profil vert lumineux. */
const ICON = '#f7b500'
const LINE = '#7be36f'
const PANEL_BG = 'rgba(8,14,12,0.78)'
const SANS = '"Segoe UI", system-ui, sans-serif'

/** « 3,4 km », « 850 m ». */
function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`
}

function smoothEle(points: GpxPoint[], idx: number): number {
  const r = 3
  const lo = Math.max(0, idx - r), hi = Math.min(points.length - 1, idx + r)
  let s = 0; for (let i = lo; i <= hi; i++) s += points[i].ele
  return s / (hi - lo + 1)
}

/** Pente moyenne (%) sur SLOPE_WIN_M autour du point atteint. */
const SLOPE_WIN_M = 200
function currentSlope(points: GpxPoint[], distances: number[], progress: number): number {
  const total = distances[distances.length - 1]
  const posDist = progress * total
  const dLo = Math.max(0, posDist - SLOPE_WIN_M / 2)
  const dHi = Math.min(total, posDist + SLOPE_WIN_M / 2)
  let iLo = 0, iHi = points.length - 1
  for (let i = 0; i < points.length - 1; i++) {
    if (distances[i] <= dLo) iLo = i
    if (distances[i] <= dHi) iHi = i
  }
  const dDist = distances[iHi] - distances[iLo]
  if (dDist < 20) return 0
  return (smoothEle(points, iHi) - smoothEle(points, iLo)) / dDist * 100
}

function sample(points: GpxPoint[], distances: number[], n: number) {
  if (points.length === 0) return []
  const total = distances[distances.length - 1]
  const out: { x: number; ele: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const d = t * total
    let lo = 0, hi = points.length - 1
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1
      if (distances[m] < d) lo = m; else hi = m
    }
    const f = distances[hi] === distances[lo] ? 0 : (d - distances[lo]) / (distances[hi] - distances[lo])
    out.push({ x: t, ele: points[lo].ele + f * (points[hi].ele - points[lo].ele) })
  }
  return out
}

/** Profil échantillonné et montée cumulée (brute, sur le profil échantillonné), calculés une fois par tracé :
 * l'encart est redessiné à chaque image du film. */
const PROFILE_N = 240
const profileCache = new WeakMap<GpxPoint[], { sampled: { x: number; ele: number }[]; cumGain: number[] }>()
function profileOf(points: GpxPoint[], distances: number[]) {
  let p = profileCache.get(points)
  if (!p) {
    const sampled = sample(points, distances, Math.min(points.length, PROFILE_N))
    const cumGain = [0]
    for (let i = 1; i < sampled.length; i++) cumGain.push(cumGain[i - 1] + Math.max(0, sampled[i].ele - sampled[i - 1].ele))
    p = { sampled, cumGain }
    profileCache.set(points, p)
  }
  return p
}

// Réduction de la tablette (haut gauche) : appliquée par un ctx.scale() dans drawElevOverlay ; le contenu est
// dessiné à sa taille "logique" (ELEV_OVERLAY_W0 × ELEV_OVERLAY_H0) puis réduit d'un bloc.
export const ELEV_OVERLAY_SCALE = 0.8
const ELEV_OVERLAY_W0 = 680
const ELEV_OVERLAY_H0 = 186

/** Rectangle écran du panneau élévation (haut gauche), pour que d'autres éléments (le
 *  randonneur) puissent l'éviter. Doit rester en phase avec les constantes utilisées dans
 *  drawElevOverlay. */
export function elevOverlayRect(cw: number, ch: number, scale = ELEV_OVERLAY_SCALE) {
  const PW = Math.min(cw - 32, ELEV_OVERLAY_W0) * scale
  const PH = ELEV_OVERLAY_H0 * scale
  const PX = 16
  const PY = 16
  return { x: PX, y: PY, w: PW, h: PH }
}

// ── Pictogrammes jaunes pleins (carré de 30 px dont (x, y) est le coin haut gauche ; fillStyle = strokeStyle = ICON) ──
type IconFn = (ctx: CanvasRenderingContext2D, x: number, y: number) => void
const CUT = 'rgba(8,14,12,1)' // découpes sombres dans les pictogrammes pleins

/** Distance : triangle de relief plein, sentier sombre en zigzag. */
const iconDistance: IconFn = (ctx, x, y) => {
  ctx.beginPath()
  ctx.moveTo(x + 15, y + 2); ctx.lineTo(x + 29, y + 27); ctx.lineTo(x + 1, y + 27); ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.strokeStyle = CUT; ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(x + 9, y + 24); ctx.lineTo(x + 18, y + 20); ctx.lineTo(x + 12, y + 16); ctx.lineTo(x + 16, y + 11)
  ctx.stroke()
  ctx.restore()
}

/** Dénivelé positif : deux sommets pleins, flèche montante. */
const iconGain: IconFn = (ctx, x, y) => {
  ctx.beginPath()
  ctx.moveTo(x + 1, y + 28); ctx.lineTo(x + 11, y + 10); ctx.lineTo(x + 16, y + 18); ctx.lineTo(x + 21, y + 12); ctx.lineTo(x + 29, y + 28); ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + 24, y + 9); ctx.lineTo(x + 24, y + 1)
  ctx.moveTo(x + 20.5, y + 4.5); ctx.lineTo(x + 24, y + 1); ctx.lineTo(x + 27.5, y + 4.5)
  ctx.stroke()
}

/** Pente : triangle rectangle épais, rayé de deux traits. */
const iconSlope: IconFn = (ctx, x, y) => {
  ctx.beginPath()
  ctx.moveTo(x + 2, y + 26); ctx.lineTo(x + 28, y + 26); ctx.lineTo(x + 28, y + 5); ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + 13, y + 26); ctx.lineTo(x + 16, y + 17)
  ctx.moveTo(x + 20, y + 26); ctx.lineTo(x + 22, y + 13)
  ctx.stroke()
}

/** Temps : compteur (arc ouvert en bas, aiguille, moyeu). */
const iconTime: IconFn = (ctx, x, y) => {
  ctx.beginPath(); ctx.arc(x + 15, y + 17, 12, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x + 15, y + 17); ctx.lineTo(x + 22, y + 10); ctx.stroke()
  ctx.beginPath(); ctx.arc(x + 15, y + 17, 3, 0, Math.PI * 2); ctx.fill()
}

/** Altitude (quatrième case sans chrono) : sommet plein. */
const iconAltitude: IconFn = (ctx, x, y) => {
  ctx.beginPath()
  ctx.moveTo(x + 1, y + 27); ctx.lineTo(x + 15, y + 4); ctx.lineTo(x + 29, y + 27); ctx.closePath()
  ctx.fill()
}

/** « 4:27 min », « 1:05:12 ». */
function fmtTime(s: number) {
  const t = Math.max(0, Math.round(s))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec} min`
}

/** Drapeau à damier de l'arrivée, dans un rond. */
function drawFinishDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.clip()
  const n = 4, c = (2 * r) / n
  ctx.fillStyle = '#111'
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2) ctx.fillRect(cx - r + i * c, cy - r + j * c, c, c)
  ctx.restore()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
}

export function drawElevOverlay(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  state: OverlayState,
) {
  const { points, distances, progress, distanceCovered, elevGain, currentEle, trackName, elapsedS, timeLabel } = state
  const S = state.scale ?? ELEV_OVERLAY_SCALE
  if (points.length < 2) return

  // ── Titre du tracé (haut gauche) ──
  if (trackName) {
    ctx.save()
    ctx.font = `bold 20px ${SANS}`
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const tw = ctx.measureText(trackName).width
    const pad = 12
    ctx.beginPath()
    ctx.roundRect(16, 14, tw + pad * 2, 36, 8)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(trackName, 16 + pad, 14 + 24)
    ctx.restore()
  }

  // Dessiné à sa taille logique (ELEV_OVERLAY_W0/H0), puis réduit d'un bloc par ctx.scale() ; elevOverlayRect()
  // reste la source de vérité de la position/taille réelle, utilisée ailleurs pour éviter le panneau.
  const { x: realPX, y: realPY } = elevOverlayRect(cw, ch, S)
  const PW = Math.min(cw - 32, ELEV_OVERLAY_W0), PH = ELEV_OVERLAY_H0
  const PADX = 22
  const STAT_H = 78
  const { sampled, cumGain } = profileOf(points, distances)
  const p = Math.max(0, Math.min(1, progress))

  ctx.save()
  ctx.translate(realPX, realPY)
  ctx.scale(S, S)
  ctx.textBaseline = 'alphabetic'

  // ── Fond ──
  ctx.beginPath(); ctx.roundRect(0, 0, PW, PH, 18)
  ctx.fillStyle = PANEL_BG; ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5; ctx.stroke()

  // ── Chiffres : 4 cases, pictogramme jaune, valeur, intitulé ──
  // Dénivelé positif cumulé jusqu'au point atteint : part de la montée brute du profil, rapportée au D+ du tracé
  // (il vaut exactement le D+ annoncé à l'arrivée).
  const k = Math.round(p * (sampled.length - 1))
  const gainTotal = cumGain[cumGain.length - 1]
  const gainNow = gainTotal > 0 ? elevGain * cumGain[k] / gainTotal : 0
  const slope = currentSlope(points, distances, p)
  const slopeStr = `${Math.abs(slope) < 0.05 ? '0' : slope.toFixed(1).replace('.', ',').replace('-', '−')} %`
  const cells: { icon: IconFn; val: string; label: string }[] = [
    { icon: iconDistance, val: fmtDist(distanceCovered), label: 'DISTANCE' },
    { icon: iconGain, val: `+${Math.round(gainNow)} m`, label: 'D+' },
    { icon: iconSlope, val: slopeStr, label: 'PENTE MOYENNE' },
    elapsedS != null
      ? { icon: iconTime, val: fmtTime(elapsedS), label: timeLabel ?? 'TEMPS' }
      : { icon: iconAltitude, val: `${Math.round(currentEle)} m`, label: 'ALTITUDE' },
  ]
  const cellW = (PW - PADX * 2) / cells.length
  cells.forEach((c, i) => {
    const x = PADX + i * cellW
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x - 8, 18); ctx.lineTo(x - 8, STAT_H - 14); ctx.stroke()
    }
    ctx.save()
    ctx.strokeStyle = ICON; ctx.fillStyle = ICON; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    c.icon(ctx, x + 4, 18)
    ctx.restore()
    // Valeur : réduite si elle déborde de sa case (« 1 h 05'12" »).
    const tx = x + 42, maxW = cellW - 58
    let size = 30
    do { ctx.font = `bold ${size}px ${SANS}`; size -= 1 } while (ctx.measureText(c.val).width > maxW && size > 18)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
    ctx.fillText(c.val, tx, 44)
    // Intitulé : réduit, lui aussi, s'il déborde (« PENTE MOYENNE »).
    ctx.letterSpacing = '1px'
    let lsize = 12.5
    do { ctx.font = `600 ${lsize}px ${SANS}`; lsize -= 0.5 } while (ctx.measureText(c.label).width > maxW + 6 && lsize > 9)
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.fillText(c.label, tx, 64)
    ctx.letterSpacing = '0px'
  })
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(0, STAT_H + 4); ctx.lineTo(PW, STAT_H + 4); ctx.stroke()

  // ── Profil ──
  const gX = PADX + 10, gW = PW - PADX * 2 - 20
  const gY = STAT_H + 38, gH = 36
  const eles = sampled.map(s => s.ele)
  const minEle = Math.min(...eles), maxEle = Math.max(...eles)
  const range = maxEle - minEle || 1
  const toY = (ele: number) => gY + gH - ((ele - minEle) / range) * gH
  const toX = (x: number) => gX + x * gW
  const line = () => {
    ctx.beginPath()
    sampled.forEach((s, i) => (i ? ctx.lineTo(toX(s.x), toY(s.ele)) : ctx.moveTo(toX(s.x), toY(s.ele))))
  }
  const area = () => {
    line()
    ctx.lineTo(toX(1), gY + gH + 8); ctx.lineTo(toX(0), gY + gH + 8); ctx.closePath()
  }
  const fill = ctx.createLinearGradient(0, gY, 0, gY + gH + 8)
  fill.addColorStop(0, 'rgba(123,227,111,0.5)'); fill.addColorStop(1, 'rgba(123,227,111,0.04)')

  // Profil entier, d'un seul éclat : aire remplie en dégradé, ligne lumineuse.
  ctx.save()
  area(); ctx.fillStyle = fill; ctx.fill()
  ctx.shadowColor = 'rgba(123,227,111,0.85)'; ctx.shadowBlur = 10
  line(); ctx.strokeStyle = LINE; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.stroke()
  ctx.restore()

  // Altitudes du départ et de l'arrivée, au-dessus des extrémités.
  const startEle = sampled[0].ele, endEle = sampled[sampled.length - 1].ele
  ctx.font = `bold 17px ${SANS}`; ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'; ctx.fillText(`${Math.round(startEle)} m`, gX - 8, gY - 14)
  ctx.textAlign = 'right'; ctx.fillText(`${Math.round(endEle)} m`, gX + gW + 8, gY - 14)

  // Départ (rond blanc cerclé de vert) et arrivée (damier).
  const sx = toX(0), sy = toY(startEle)
  ctx.beginPath(); ctx.arc(sx, sy, 8.5, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.strokeStyle = '#3ad15a'; ctx.lineWidth = 3.5; ctx.stroke()
  drawFinishDot(ctx, toX(1), toY(endEle), 8)

  ctx.font = `italic bold 15px ${SANS}`; ctx.fillStyle = '#fff'
  ctx.letterSpacing = '1px'
  ctx.textAlign = 'left'; ctx.fillText('DÉPART', gX - 8, PH - 12)
  ctx.textAlign = 'right'; ctx.fillText('ARRIVÉE', gX + gW + 8, PH - 12)
  ctx.letterSpacing = '0px'

  ctx.restore()
}
