// Suivi caméra à zone libre (aperçu et film 2D) : la caméra reste immobile tant que le coureur est dans la zone centrale
// de l'image. Quand il en franchit le bord, elle ne se contente pas de le retenir au bord (elle bougerait alors sans
// arrêt) : elle recadre d'avance, en replaçant le coureur de l'autre côté du centre, puis s'arrête jusqu'au prochain
// franchissement. Le recadrage démarre en douceur (gain qui monte progressivement) et finit en s'amortissant.
// Un garde-fou proportionnel au dépassement de la zone empêche en plus le coureur d'approcher du bord.
// Carte nord en haut : x ne dépend que de la longitude, y que de la latitude, d'où un réglage indépendant par axe.

/** Demi-largeur et demi-hauteur de la zone libre, en fraction de l'image (0,18 = la caméra bouge quand le coureur
 *  arrive à 32 % du bord). */
export const FREE_ZONE = 0.18
/** Dépassement de la zone (fraction du petit côté) au-delà duquel le suivi se resserre fortement. */
const MAX_EXCESS = 0.06
/** Recadrage : position visée pour le coureur, de l'autre côté du centre (fraction de l'image). */
const LEAD = 0.12
/** Recadrage terminé quand le coureur est à moins de cette fraction de l'image de sa position visée. */
const SETTLE = 0.015
/** Montée du gain au début d'un recadrage, en multiple du gain d'amorti (1,5 → ~2/3 de la constante de temps). */
const RAMP = 1.5

type Axis = { target: number | null; ramp: number }

/**
 * Crée un suivi (un par film ou par carte : il garde l'état du recadrage en cours).
 * `step` renvoie les fractions de l'écart caméra → coureur (en longitude et en latitude) à parcourir à cette image.
 * `dx`, `dy` : position du coureur par rapport au centre (px) ; `k` : gain d'amorti de base ; `shrink` (0..1) réduit la
 * zone libre (1 = plus de zone : suivi complet, ex. coureur sur le cartel d'altitude du film).
 */
export function createFreeZoneFollow() {
  const ax: Axis = { target: null, ramp: 0 }, ay: Axis = { target: null, ramp: 0 }

  // Garde-fou : ramène le coureur d'une fraction g vers le bord de la zone.
  function guard(d: number, zone: number, g: number) {
    const e = Math.max(0, Math.abs(d) - zone)
    return d && e ? (g * e) / Math.abs(d) : 0
  }

  // Recadrage d'avance sur un axe : déclenché au franchissement de la zone, vise le coureur à LEAD de l'autre côté.
  function chase(a: Axis, d: number, size: number, zone: number, k: number, shrink: number) {
    if (a.target == null && Math.abs(d) > zone) { a.target = -Math.sign(d) * size * LEAD * (1 - shrink); a.ramp = 0 }
    if (a.target == null || !d) return 0
    const err = d - a.target
    // Arrivé (ou dépassé : le coureur a fait demi-tour) → caméra de nouveau immobile.
    if (Math.abs(err) < size * SETTLE || Math.sign(err) !== Math.sign(d)) { a.target = null; return 0 }
    a.ramp = Math.min(1, a.ramp + k * RAMP)
    const r = a.ramp * a.ramp * (3 - 2 * a.ramp)
    return (k * r * err) / d
  }

  return {
    step(dx: number, dy: number, w: number, h: number, k: number, shrink = 0): { fx: number; fy: number } {
      const zx = w * FREE_ZONE * (1 - shrink), zy = h * FREE_ZONE * (1 - shrink)
      const ex = Math.max(0, Math.abs(dx) - zx), ey = Math.max(0, Math.abs(dy) - zy)
      const maxEx = Math.min(w, h) * MAX_EXCESS, excess = Math.hypot(ex, ey)
      const g = excess > maxEx ? Math.min(0.5, k * (excess / maxEx)) : k
      return {
        fx: Math.max(guard(dx, zx, g), chase(ax, dx, w, zx, k, shrink)),
        fy: Math.max(guard(dy, zy, g), chase(ay, dy, h, zy, k, shrink)),
      }
    },
  }
}
