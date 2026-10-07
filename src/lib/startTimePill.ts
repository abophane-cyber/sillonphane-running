// Heure de départ des films 2D et 3D : pastille arrondie (horloge + « Départ 9 h 00 ») sous le nom du lieu de départ.

/** Couleur de la pastille : l'orange du ruban, en attendant la couleur choisie pour l'épreuve. */
export const START_PILL_COLOR = '#D97A3D'

/** Dessine la pastille centrée en `cx`, son bord haut en `top` (px de l'image) ; `fontPx` : taille du texte. */
export function drawStartTimePill(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, fontPx: number, alpha: number) {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `700 ${Math.round(fontPx)}px Arial, Helvetica, sans-serif`
  const r = fontPx * 0.42                       // rayon de l'horloge
  const padL = fontPx * 0.55, padR = fontPx * 0.75, gap = fontPx * 0.4
  const h = fontPx * 1.7
  const w = padL + 2 * r + gap + ctx.measureText(text).width + padR
  const x = cx - w / 2, cy = top + h / 2
  const border = Math.max(2, fontPx * 0.11)

  // Fond : pilule de couleur, liseré blanc, ombre légère pour la détacher du satellite.
  ctx.beginPath()
  ctx.roundRect(x, top, w, h, h / 2)
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = fontPx * 0.4; ctx.shadowOffsetY = fontPx * 0.08
  ctx.fillStyle = START_PILL_COLOR
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = border; ctx.strokeStyle = '#fff'
  ctx.stroke()

  // Horloge : cercle et aiguilles (9 h).
  const ix = x + padL + r
  ctx.lineWidth = Math.max(1.5, fontPx * 0.09); ctx.lineCap = 'round'
  ctx.beginPath(); ctx.arc(ix, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ix, cy - r * 0.6); ctx.lineTo(ix, cy); ctx.lineTo(ix - r * 0.45, cy)
  ctx.stroke()

  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(text, ix + r + gap, cy + fontPx * 0.04)
  ctx.restore()
}
