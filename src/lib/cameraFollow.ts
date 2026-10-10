// Suivi caméra à zone libre (aperçu et film 2D) : la caméra reste immobile tant que le coureur est dans la zone centrale
// de l'image, et ne glisse que pour l'empêcher d'approcher du bord (risque de perdre le tracé). Le glissement est amorti
// et proportionnel au dépassement de la zone : il part de zéro quand le coureur en franchit le bord, sans à-coup.
// Carte nord en haut : x ne dépend que de la longitude, y que de la latitude, d'où un réglage indépendant par axe.

/** Demi-largeur et demi-hauteur de la zone libre, en fraction de l'image (0,18 = la caméra bouge quand le coureur
 *  arrive à 32 % du bord). */
export const FREE_ZONE = 0.18
/** Dépassement de la zone (fraction du petit côté) au-delà duquel le suivi se resserre fortement. */
const MAX_EXCESS = 0.06

/**
 * Fractions de l'écart caméra → coureur (en longitude et en latitude) à parcourir à cette image.
 * `dx`, `dy` : position du coureur par rapport au centre (px) ; `k` : gain d'amorti de base ; `shrink` (0..1) réduit la
 * zone libre (1 = plus de zone : suivi complet, ex. coureur sur le cartel d'altitude du film).
 */
export function freeZoneStep(dx: number, dy: number, w: number, h: number, k: number, shrink = 0): { fx: number; fy: number } {
  const zx = w * FREE_ZONE * (1 - shrink), zy = h * FREE_ZONE * (1 - shrink)
  const ex = Math.max(0, Math.abs(dx) - zx), ey = Math.max(0, Math.abs(dy) - zy)
  if (!ex && !ey) return { fx: 0, fy: 0 }
  const maxEx = Math.min(w, h) * MAX_EXCESS, excess = Math.hypot(ex, ey)
  const g = excess > maxEx ? Math.min(0.5, k * (excess / maxEx)) : k
  // Part de l'écart total à combler sur chaque axe pour ramener le coureur d'une fraction g vers le bord de la zone.
  return { fx: dx ? (g * ex) / Math.abs(dx) : 0, fy: dy ? (g * ey) / Math.abs(dy) : 0 }
}
