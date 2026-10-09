// Ruban du chemin parcouru, partagé par l'aperçu (TrackMap) et le film 2D (filmExport) : crème au niveau du coureur,
// la trace laissée derrière lui passe à l'orange puis au vert en s'éloignant (couleur selon la distance DERRIÈRE le
// coureur, pas selon la position sur le parcours). Liseré de contour très léger. La tête du ruban est redessinée
// par-dessus (sur une boucle, le ruban repasse sur lui-même et sa tête disparaissait sous un passage antérieur).

const CREAM: [number, number, number] = [0xf4, 0xed, 0xe0]
const ORANGE: [number, number, number] = [0xd9, 0x7a, 0x3d]
const GREEN: [number, number, number] = [0x2f, 0x5c, 0x45]

/** Distances derrière le coureur (part du parcours) : crème jusqu'à CREAM_F, orange atteint à ORANGE_F, vert à GREEN_F. */
const CREAM_F = 0.02, ORANGE_F = 0.07, GREEN_F = 0.18

export const RIBBON_HEAD_COLOR = '#F4EDE0'
/** Même couleur, transparente : début en fondu de la tête du ruban. */
export const RIBBON_HEAD_FADE = 'rgba(244,237,224,0)'
/** Liseré de contour, très léger. */
export const RIBBON_OUTLINE = 'rgba(20,30,20,0.32)'

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`

/** Couleur du ruban à `behindM` mètres derrière le coureur, sur un parcours de `totalDistance` m. */
export function ribbonAgeColor(behindM: number, totalDistance: number): string {
  const f = Math.max(0, behindM) / Math.max(1, totalDistance)
  if (f <= CREAM_F) return rgb(CREAM)
  if (f <= ORANGE_F) return rgb(mix(CREAM, ORANGE, (f - CREAM_F) / (ORANGE_F - CREAM_F)))
  if (f <= GREEN_F) return rgb(mix(ORANGE, GREEN, (f - ORANGE_F) / (GREEN_F - ORANGE_F)))
  return rgb(GREEN)
}

/** Expression MapLibre `line-gradient` (line-progress : 0 = départ, 1 = coureur) pour `coveredM` mètres parcourus. */
export function ribbonGradient(coveredM: number, totalDistance: number): unknown[] {
  const at = (f: number) => 1 - (f * totalDistance) / Math.max(1, coveredM) // part du ruban à f derrière le coureur
  const stops: [number, string][] = [
    [at(GREEN_F), rgb(GREEN)], [at(ORANGE_F), rgb(ORANGE)], [at(CREAM_F), rgb(CREAM)],
  ]
  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress'], 0, ribbonAgeColor(coveredM, totalDistance)]
  for (const [p, c] of stops) if (p > 0 && p < 1) expr.push(p, c)
  expr.push(1, rgb(CREAM))
  return expr
}

/** Course terminée (vue générale de fin) : dégradé d'origine réparti sur tout le parcours (vert au départ, orange au
 * milieu, crème à l'arrivée) et liseré plus marqué, pour bien lire le tracé entier. */
export const RIBBON_FULL_GRADIENT = ['interpolate', ['linear'], ['line-progress'], 0, rgb(GREEN), 0.5, rgb(ORANGE), 1, rgb(CREAM)]
export const RIBBON_OUTLINE_FULL = 'rgba(20,30,20,0.55)'
/** Couleur du dégradé d'origine à la part `f` (0 = départ, 1 = arrivée) du parcours. */
export function ribbonColorAt(f: number): string {
  const x = Math.max(0, Math.min(1, f))
  return rgb(x <= 0.5 ? mix(GREEN, ORANGE, x / 0.5) : mix(ORANGE, CREAM, (x - 0.5) / 0.5))
}

/** Pendant la course, le ruban s'arrête juste derrière le coureur : écart (px à l'écran, taille de marche) ×
 * l'échelle du personnage. Sinon il passait sous ses pieds, voire devant lui. */
export const RIBBON_LAG_PX = 16

/** Renflement au bout du ruban : ses derniers RIBBON_TIP_PX px (à l'écran) sont plus larges (× RIBBON_TIP_SWELL) et
 * apparaissent en fondu, pour bien voir le bout quand il repasse sur le tracé déjà parcouru. */
export const RIBBON_TIP_PX = 34
export const RIBBON_TIP_SWELL = 1.7

/** Derniers `px` pixels d'une polyligne à l'écran (départ → bout), coupés au point près. */
export function tailByPixels<T>(pts: T[], px: number, project: (p: T) => { x: number; y: number }, lerp: (a: T, b: T, t: number) => T): T[] {
  if (pts.length < 2) return []
  const out: T[] = [pts[pts.length - 1]]
  let prev = project(pts[pts.length - 1]), left = px
  for (let i = pts.length - 2; i >= 0; i--) {
    const q = project(pts[i])
    const d = Math.hypot(q.x - prev.x, q.y - prev.y)
    if (d >= left) { out.push(lerp(pts[i + 1], pts[i], d ? left / d : 0)); break }
    out.push(pts[i]); left -= d; prev = q
  }
  return out.reverse()
}

/** Longueur de la tête du ruban (m) : 2 % du parcours, entre 80 et 500 m. */
export function ribbonHeadM(totalDistance: number): number {
  return Math.max(80, Math.min(500, totalDistance * 0.02))
}
