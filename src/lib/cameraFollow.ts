// Suivi caméra à zone libre (aperçu et film 2D) : la caméra reste immobile et laisse le coureur s'approcher d'un bord.
// Un peu avant (CHASE_ZONE), elle recadre d'avance : mouvement ample mais lent, qui replace le coureur de l'autre côté
// du centre (LEAD), puis elle s'arrête jusqu'au prochain déclenchement. Le recadrage démarre en douceur (gain qui
// monte progressivement) et finit en s'amortissant. Plus près du bord (GUARD_ZONE), un garde-fou proportionnel au
// dépassement reprend la main si le coureur va plus vite que le recadrage, pour ne jamais perdre le tracé.
// Carte nord en haut : x ne dépend que de la longitude, y que de la latitude, d'où un réglage indépendant par axe.

/** Déclenchement du recadrage : demi-largeur et demi-hauteur de la zone libre, en fraction de l'image (0,28 = le
 *  recadrage part quand le coureur arrive à 22 % du bord). */
const CHASE_ZONE = 0.28
/** Garde-fou : au-delà (0,36 = 14 % du bord), la caméra retient le coureur quoi qu'il arrive. */
const GUARD_ZONE = 0.36
/** Dépassement du garde-fou (fraction du petit côté) au-delà duquel le suivi se resserre fortement. */
const MAX_EXCESS = 0.06
/** Recadrage : position visée pour le coureur, de l'autre côté du centre (fraction de l'image). */
const LEAD = 0.2
/** Vitesse du recadrage, en part du gain d'amorti (plus petit = mouvement plus lent et plus doux). */
const CHASE_GAIN = 0.6
/** Recadrage terminé quand le coureur est à moins de cette fraction de l'image de sa position visée. */
const SETTLE = 0.015
/** Montée du gain au début d'un recadrage, en multiple du gain d'amorti (plus petit = départ plus progressif). */
const RAMP = 0.8

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
    return (k * CHASE_GAIN * r * err) / d
  }

  return {
    step(dx: number, dy: number, w: number, h: number, k: number, shrink = 0): { fx: number; fy: number } {
      const cx = w * CHASE_ZONE * (1 - shrink), cy = h * CHASE_ZONE * (1 - shrink)
      const zx = w * GUARD_ZONE * (1 - shrink), zy = h * GUARD_ZONE * (1 - shrink)
      const ex = Math.max(0, Math.abs(dx) - zx), ey = Math.max(0, Math.abs(dy) - zy)
      const maxEx = Math.min(w, h) * MAX_EXCESS, excess = Math.hypot(ex, ey)
      const g = excess > maxEx ? Math.min(0.5, k * (excess / maxEx)) : k
      return {
        fx: Math.max(guard(dx, zx, g), chase(ax, dx, w, cx, k, shrink)),
        fy: Math.max(guard(dy, zy, g), chase(ay, dy, h, cy, k, shrink)),
      }
    },
  }
}
