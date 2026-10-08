// Nom de la rue empruntée, affiché dans la bande haute de l'écran (sous le titre) pendant que la coureuse y court :
// les noms se succèdent, chacun en fondu d'entrée et de sortie. Partagé par les films 2D et 3D.

/** Hauteur du nom à l'écran (px, centre de la ligne) : bande haute, sous le titre. */
export const STREET_CAPTION_Y = 110
const FADE_S = 0.4

/** Portion de rue en part du parcours (0 = départ, 1 = arrivée) ; `minS` : durée d'affichage minimale (s, places). */
export interface StreetSpan { name: string; from: number; to: number; minS?: number }

/** Nom affiché, avec fondu : `update` chaque image avec la position de la coureuse (part du parcours), puis `draw`. */
export class StreetCaption {
  private shown: string | null = null
  private shownMinS = 0
  private heldS = 0
  private alpha = 0
  private spans: StreetSpan[]
  constructor(spans: StreetSpan[]) { this.spans = spans }

  update(pos: number | null, dt: number) {
    const span = pos == null ? undefined : this.spans.find(s => pos >= s.from && pos <= s.to)
    let active = span?.name ?? null
    if (this.shown) this.heldS += dt
    // Nom tenu sa durée minimale (place traversée en un instant), même une fois la portion dépassée.
    if (active !== this.shown && this.shown && this.heldS < this.shownMinS) active = this.shown
    if (active === this.shown) this.alpha = Math.min(1, this.alpha + dt / FADE_S)
    else {
      // Autre rue (ou plus de rue) : le nom affiché s'efface d'abord, puis le suivant apparaît.
      this.alpha = Math.max(0, this.alpha - dt / FADE_S)
      if (this.alpha === 0) { this.shown = active; this.shownMinS = span?.minS ?? 0; this.heldS = 0 }
    }
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, y = STREET_CAPTION_Y) {
    if (!this.shown || this.alpha <= 0) return
    const size = 28
    ctx.save()
    ctx.globalAlpha = this.alpha * this.alpha * (3 - 2 * this.alpha)
    ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`
    ctx.letterSpacing = `${size * 0.12}px`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2
    ctx.strokeStyle = 'rgba(15,18,22,0.9)'; ctx.lineWidth = size * 0.2
    ctx.strokeText(this.shown, cx, y)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#f4f1ea'
    ctx.fillText(this.shown, cx, y)
    ctx.restore()
  }
}
