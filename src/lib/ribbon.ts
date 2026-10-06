// Ruban du chemin parcouru, partagé par l'aperçu (TrackMap) et le film 2D (filmExport) : dégradé du symbole Sillon
// (vert → orangé → blanc cassé) le long de la distance, et tête du ruban redessinée par-dessus (sur une boucle, le
// ruban repasse sur lui-même et sa tête disparaissait sous un passage antérieur).

const STOPS: [number, [number, number, number]][] = [
  [0, [0x2f, 0x5c, 0x45]],
  [0.5, [0xd9, 0x7a, 0x3d]],
  [1, [0xf4, 0xed, 0xe0]],
]

/** Couleur du dégradé à la part `f` (0 = départ, 1 = tête) du chemin parcouru. */
export function ribbonColorAt(f: number): string {
  const x = Math.max(0, Math.min(1, f))
  let k = 1
  while (k < STOPS.length - 1 && x > STOPS[k][0]) k++
  const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k]
  const t = (x - a) / (b - a || 1)
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** Couleur de la tête du ruban (fin du dégradé). */
export const RIBBON_HEAD_COLOR = '#F4EDE0'

/** Longueur de la tête du ruban (m) : 2 % du parcours, entre 80 et 500 m. */
export function ribbonHeadM(totalDistance: number): number {
  return Math.max(80, Math.min(500, totalDistance * 0.02))
}
