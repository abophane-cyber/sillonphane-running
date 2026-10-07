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
  /** Échelle de la tablette (défaut ELEV_OVERLAY_SCALE) : plus grande pour qu'elle reste lisible sur un écran de téléphone. */
  scale?: number
}

/** Couleurs de la tablette transparente : claires, pour la vue aérienne assombrie. */
const UP = '#7ee08f'
const DOWN = '#ff8a80'

function fmt(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

function smoothEle(points: GpxPoint[], idx: number): number {
  const r = 3
  const lo = Math.max(0, idx - r), hi = Math.min(points.length - 1, idx + r)
  let s = 0; for (let i = lo; i <= hi; i++) s += points[i].ele
  return s / (hi - lo + 1)
}

function currentSlope(points: GpxPoint[], distances: number[], progress: number): number {
  const total = distances[distances.length - 1]
  const posDist = progress * total
  const WIN = 100
  const dLo = Math.max(0, posDist - WIN / 2)
  const dHi = Math.min(total, posDist + WIN / 2)
  let iLo = 0, iHi = points.length - 1
  for (let i = 0; i < points.length - 1; i++) {
    if (distances[i] <= dLo) iLo = i
    if (distances[i] <= dHi) iHi = i
  }
  const dDist = distances[iHi] - distances[iLo]
  if (dDist < 20) return 0
  return Math.round((smoothEle(points, iHi) - smoothEle(points, iLo)) / dDist * 100)
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

// Réduction de la tablette de profil (elle n'a plus besoin d'être aussi grande en haut-gauche
// qu'elle ne l'était en bas, où elle devait rester lisible à côté du randonneur). Appliquée par
// un ctx.scale() dans drawElevOverlay : le contenu est dessiné à sa taille "logique" d'origine
// (ELEV_OVERLAY_W0 × ELEV_OVERLAY_H0) puis réduit d'un bloc, sans retoucher chaque police/marge.
export const ELEV_OVERLAY_SCALE = 0.8
const ELEV_OVERLAY_W0 = 680
const ELEV_OVERLAY_H0 = 160

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

export function drawElevOverlay(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  state: OverlayState,
) {
  const { points, distances, progress, distanceCovered, totalDistance, elevGain, elevLoss, currentEle, trackName } = state
  const S = state.scale ?? ELEV_OVERLAY_SCALE
  if (points.length < 2) return

  // ── Titre du tracé (haut gauche) ──
  if (trackName) {
    ctx.save()
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif'
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

  // ── Panneau élévation (haut gauche) ─────────────────────────────────────────
  // Dessiné à sa taille logique d'origine (ELEV_OVERLAY_W0/H0), puis réduit d'un bloc par un
  // ctx.scale() (voir ELEV_OVERLAY_SCALE) : PX/PY valent donc 0 ici, pas la position écran réelle
  // (16,16, appliquée par le translate ci-dessous) — elevOverlayRect() reste la source de vérité
  // pour cette position/taille réelle, utilisée ailleurs pour éviter le panneau (le randonneur).
  const { x: realPX, y: realPY } = elevOverlayRect(cw, ch, S)
  const PX = 0, PY = 0, PW = Math.min(cw - 32, ELEV_OVERLAY_W0), PH = ELEV_OVERLAY_H0
  const PAD = { top: 14, right: 18, bottom: 14, left: 18 }
  const STAT_H = 50

  ctx.save()
  ctx.translate(realPX, realPY)
  ctx.scale(S, S)
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'alphabetic'

  // Pas de fond : la tablette est transparente, posée sur la carte. Textes clairs cernés d'un halo sombre pour
  // rester lisibles sur la vue aérienne, claire ou foncée.
  const haloText = (text: string, x: number, y: number) => {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 4
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6
    ctx.strokeText(text, x, y)
    ctx.restore()
    ctx.fillText(text, x, y)
  }

  // ── Stats : 4 colonnes avec label au-dessus + valeur bold ──
  const slope = currentSlope(points, distances, progress)
  const slopeStr = `${slope > 0 ? '+' : ''}${slope}%`
  const slopeColor = slope > 3 ? UP : slope < -3 ? DOWN : '#fff'

  const innerW = PW - PAD.left - PAD.right
  // Distance : 35%, les 4 autres : 16.25% chacun
  const colWidths = [innerW * 0.35, innerW * 0.1625, innerW * 0.1625, innerW * 0.1625, innerW * 0.1625]
  const cols = [
    { icon: '↔', label: 'Distance',  val: `${fmt(distanceCovered)} / ${fmt(totalDistance)}`, color: '#fff' },
    { icon: '↑', label: 'Montée',    val: `+ ${Math.round(elevGain)} m`,                      color: UP },
    { icon: '↓', label: 'Descente',  val: `- ${Math.round(elevLoss)} m`,                      color: DOWN },
    { icon: '⛰', label: 'Altitude', val: `${Math.round(currentEle)} m`,                      color: '#fff' },
    { icon: '▲', label: 'Pente',     val: slopeStr,                                            color: slopeColor },
  ]
  const topY = PY + PAD.top
  let colX = PX + PAD.left

  cols.forEach((c, i) => {
    // Séparateur vertical entre colonnes
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(colX - 9, topY + 2); ctx.lineTo(colX - 9, topY + STAT_H - 6); ctx.stroke()
    }

    // Label blanc, fin
    ctx.font = '14px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    haloText(c.label, colX, topY + 14)

    // Icône + valeur bold colorée
    ctx.font = 'bold 21px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = c.color
    haloText(`${c.icon} ${c.val}`, colX, topY + 40)

    colX += colWidths[i]
  })

  // Graphe
  const gX = PX + PAD.left
  const gY = PY + PAD.top + STAT_H
  const gW = PW - PAD.left - PAD.right
  const gH = PH - PAD.top - PAD.bottom - STAT_H
  const sampled = sample(points, distances, Math.min(points.length, 200))
  const eles = sampled.map(p => p.ele)
  const minEle = Math.min(...eles)
  const maxEle = Math.max(...eles)
  const range = maxEle - minEle || 1

  function toY(ele: number) { return gY + gH - ((ele - minEle) / range) * gH }
  function toX(x: number)   { return gX + x * gW }

  // Remplissage zone non parcourue (vert pâle)
  ctx.beginPath()
  ctx.moveTo(toX(sampled[0].x), toY(sampled[0].ele))
  sampled.forEach(p => ctx.lineTo(toX(p.x), toY(p.ele)))
  ctx.lineTo(toX(sampled[sampled.length - 1].x), gY + gH)
  ctx.lineTo(toX(sampled[0].x), gY + gH)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fill()

  // Partie parcourue (vert plus soutenu)
  ctx.save()
  ctx.beginPath()
  ctx.rect(gX, gY, progress * gW, gH + 4)
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(toX(sampled[0].x), toY(sampled[0].ele))
  sampled.forEach(p => ctx.lineTo(toX(p.x), toY(p.ele)))
  ctx.lineTo(toX(sampled[sampled.length - 1].x), gY + gH)
  ctx.lineTo(toX(sampled[0].x), gY + gH)
  ctx.closePath()
  ctx.fillStyle = 'rgba(124,227,139,0.42)'
  ctx.fill()
  ctx.restore()

  // Ligne profil verte
  ctx.beginPath()
  ctx.moveTo(toX(sampled[0].x), toY(sampled[0].ele))
  sampled.forEach(p => ctx.lineTo(toX(p.x), toY(p.ele)))
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4
  ctx.strokeStyle = UP
  ctx.lineWidth   = 2.5
  ctx.stroke()
  ctx.restore()

  // Curseur
  const dotX = gX + progress * gW
  const idx   = Math.round(progress * (sampled.length - 1))
  const dotY  = toY(sampled[Math.min(idx, sampled.length - 1)]?.ele ?? minEle)
  ctx.beginPath()
  ctx.arc(dotX, dotY, 6.5, 0, Math.PI * 2)
  ctx.fillStyle   = '#2e9e44'
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth   = 2
  ctx.stroke()

  // Min/max alti
  ctx.font      = 'bold 16px "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = '#fff'
  haloText(`${Math.round(maxEle)}m`, gX + 2, gY + 16)
  haloText(`${Math.round(minEle)}m`, gX + 2, gY + gH)

  ctx.restore()
}
