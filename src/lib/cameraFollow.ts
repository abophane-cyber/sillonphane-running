// Suivi caméra à zone libre (aperçu et film 2D) : la caméra reste immobile et laisse le coureur s'approcher d'un bord.
// Un peu avant (CHASE_ZONE), elle recadre d'avance : mouvement ample mais lent, qui replace le coureur de l'autre côté
// du centre (LEAD), puis elle s'arrête jusqu'au prochain déclenchement. Plus près du bord (GUARD_ZONE), un garde-fou
// proportionnel au dépassement reprend la main si le coureur va plus vite que le recadrage, pour ne jamais perdre le
// tracé. La caméra a sa propre vitesse, lissée : elle accélère et surtout ralentit progressivement (sans elle, la fin
// d'un recadrage, où la caméra file encore à la vitesse du coureur, se faisait d'une image à l'autre : effet de gel),
// et ne dépasse pas MAX_SPEED fois celle du coureur.
// Vitesses en px par unité de gain k (k ≈ temps écoulé / constante de temps) : indépendantes du nombre d'images par
// seconde et du nombre d'appels par image.
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
/** Vitesse du recadrage, en part de l'écart restant (plus petit = mouvement plus lent et plus doux). */
const CHASE_GAIN = 0.6
/** Vitesse maximale du recadrage, en multiple de celle du coureur à l'écran : un recadrage plus rapide obligerait
 *  l'aperçu à charger les vues aériennes trop vite (à-coups), et paraîtrait brusque. Le garde-fou n'est pas bridé. */
const MAX_SPEED = 1.75
/** Recadrage terminé quand le coureur est à moins de cette fraction de l'image de sa position visée. */
const SETTLE = 0.015
/** Lissage de la vitesse caméra, en multiple du gain d'amorti (plus petit = accélérations et arrêts plus doux). */
const SMOOTH = 1.2

type Axis = { target: number | null; v: number; moved: number; prevD: number | null }

/**
 * Crée un suivi (un par film ou par carte : il garde l'état du recadrage en cours).
 * `step` renvoie les fractions de l'écart caméra → coureur (en longitude et en latitude) à parcourir à cette image.
 * `dx`, `dy` : position du coureur par rapport au centre (px) ; `k` : gain d'amorti de base ; `shrink` (0..1) réduit la
 * zone libre (1 = plus de zone : suivi complet, ex. coureur sur le cartel d'altitude du film).
 * `reset` arrête net la caméra (suivi interrompu : pause, saut dans l'animation).
 */
export function createFreeZoneFollow() {
  const newAxis = (): Axis => ({ target: null, v: 0, moved: 0, prevD: null })
  let ax = newAxis(), ay = newAxis()
  // Vitesse du coureur à l'écran (hors mouvement de caméra), lissée.
  let runnerSpeed = 0

  // Déplacement propre du coureur sur un axe depuis l'appel précédent : variation de d, plus le recul dû à la caméra.
  const runnerMove = (a: Axis, d: number) => (a.prevD == null ? 0 : d - a.prevD + a.moved)

  // Déplacement de la caméra sur un axe à cet appel (px, positif = vers le coureur), renvoyé en fraction de l'écart.
  function axisStep(a: Axis, d: number, size: number, chaseZone: number, guardZone: number, g: number, k: number, shrink: number, vMax: number) {
    if (a.target == null && Math.abs(d) > chaseZone) a.target = -Math.sign(d) * size * LEAD * (1 - shrink)
    let want = 0
    if (a.target != null) {
      const err = d - a.target
      // Arrivé (ou dépassé : le coureur a fait demi-tour) → la caméra ralentit jusqu'à l'arrêt.
      // (Comparé au côté de départ, opposé à la cible, et non au signe de d, qui s'inverse au passage du centre.)
      if (Math.abs(err) < size * SETTLE || Math.sign(err) !== -Math.sign(a.target)) a.target = null
      else want = Math.max(-vMax, Math.min(vMax, CHASE_GAIN * err))
    }
    a.v += (want - a.v) * Math.min(1, k * SMOOTH)
    // Fin du ralenti : arrêt franc sous 1 px par unité de gain, sinon la carte serait repositionnée indéfiniment.
    if (a.target == null && Math.abs(a.v) < 1) a.v = 0
    let move = a.v * k
    // Garde-fou : ramène le coureur d'une fraction g vers le bord de sa zone, quelle que soit la vitesse lissée.
    const e = Math.max(0, Math.abs(d) - guardZone)
    if (e && Math.sign(d) * move < g * e) {
      move = Math.sign(d) * g * e
      if (k > 1e-4) a.v = move / k
    }
    a.moved = move
    a.prevD = d
    return d ? move / d : 0
  }

  return {
    step(dx: number, dy: number, w: number, h: number, k: number, shrink = 0): { fx: number; fy: number } {
      const zx = w * GUARD_ZONE * (1 - shrink), zy = h * GUARD_ZONE * (1 - shrink)
      const ex = Math.max(0, Math.abs(dx) - zx), ey = Math.max(0, Math.abs(dy) - zy)
      const maxEx = Math.min(w, h) * MAX_EXCESS, excess = Math.hypot(ex, ey)
      const g = excess > maxEx ? Math.min(0.5, k * (excess / maxEx)) : k
      if (k > 1e-4) runnerSpeed += (Math.hypot(runnerMove(ax, dx), runnerMove(ay, dy)) / k - runnerSpeed) * Math.min(1, k * 2)
      const vMax = MAX_SPEED * runnerSpeed
      return {
        fx: axisStep(ax, dx, w, w * CHASE_ZONE * (1 - shrink), zx, g, k, shrink, vMax),
        fy: axisStep(ay, dy, h, h * CHASE_ZONE * (1 - shrink), zy, g, k, shrink, vMax),
      }
    },
    reset() { ax = newAxis(); ay = newAxis(); runnerSpeed = 0 },
  }
}
