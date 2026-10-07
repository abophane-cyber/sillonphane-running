// Heure de départ des films 2D et 3D : horloge de course (cadre noir, « DÉPART » et chiffres jaunes « 09:00 »)
// sous le nom du lieu de départ.

/** Dessine l'horloge centrée en `cx`, son bord haut en `top` (px de l'image) ; `fontPx` : taille des chiffres. */
export function drawStartTimePill(
  ctx: CanvasRenderingContext2D, start: { label: string; clock: string }, cx: number, top: number, fontPx: number, alpha: number,
) {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  const labelFont = `700 ${Math.round(fontPx * 0.36)}px Arial, Helvetica, sans-serif`
  const clockFont = `700 ${Math.round(fontPx)}px "Courier New", Courier, monospace`
  const track = fontPx * 0.07                   // espacement des lettres du libellé
  const padX = fontPx * 0.4, gap = fontPx * 0.35
  ctx.font = labelFont
  const labelW = ctx.measureText(start.label).width + track * (start.label.length - 1)
  ctx.font = clockFont
  const clockW = ctx.measureText(start.clock).width
  const w = padX + labelW + gap + clockW + padX
  const h = fontPx * 1.3
  const x = cx - w / 2, cy = top + h / 2

  // Cadre : fond noir, bord gris, ombre légère pour le détacher du satellite.
  ctx.beginPath()
  ctx.roundRect(x, top, w, h, fontPx * 0.13)
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = fontPx * 0.4; ctx.shadowOffsetY = fontPx * 0.08
  ctx.fillStyle = '#111'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = Math.max(2, fontPx * 0.07); ctx.strokeStyle = '#444'
  ctx.stroke()

  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  ctx.font = labelFont; ctx.fillStyle = '#bbb'
  let lx = x + padX
  for (const ch of start.label) { ctx.fillText(ch, lx, cy); lx += ctx.measureText(ch).width + track }
  ctx.font = clockFont; ctx.fillStyle = '#ffd23f'
  ctx.fillText(start.clock, x + padX + labelW + gap, cy + fontPx * 0.04)
  ctx.restore()
}
