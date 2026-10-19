// Suivi caméra à zone libre (aperçu et film 2D), guidé par le tracé à venir : la caméra reste immobile pendant que le
// coureur traverse l'image. Elle regarde où sera le tracé un peu plus loin (point situé à LOOK de parcours, mesuré à
// l'écran) : quand ce point va sortir de la zone libre (CHASE_ZONE), elle recadre d'avance, dans le sens où va le tracé,
// et replace le coureur loin de l'autre côté du centre (LEAD : il repart du bas de l'image s'il monte). Si le tracé
// tourne et revient vers le coureur, le recadrage s'interrompt en douceur. Plus près du bord (GUARD_ZONE), un garde-fou
// proportionnel au dépassement reprend la main si le coureur va plus vite que le recadrage, pour ne jamais le perdre.
// La caméra a sa propre vitesse, lissée (départ et arrêt progressifs), bornée à MAX_SPEED fois celle du coureur.
// Vitesses en px par unité de gain k (k ≈ temps écoulé / constante de temps) : indépendantes du nombre d'images par
// seconde et du nombre d'appels par image.
// Carte nord en haut : x ne dépend que de la longitude, y que de la latitude, d'où un réglage indépendant par axe.

import type { GpxPoint } from '../types'

/** Distance d'anticipation : point du tracé regardé en avance, à cette longueur de parcours à l'écran (fraction du
 *  petit côté de l'image). */
export const LOOK = 0.18
/** Déclenchement : le recadrage part quand le point d'anticipation dépasse cette demi-largeur ou demi-hauteur (fraction
 *  de l'image ; 0,4 = à 10 % du bord). */
const CHASE_ZONE = 0.4
/** Garde-fou : au-delà (0,38 = 12 % du bord), la caméra retient le coureur quoi qu'il arrive. */
const GUARD_ZONE = 0.38
/** Dépassement du garde-fou (fraction du petit côté) au-delà duquel le suivi se resserre fortement. */
const MAX_EXCESS = 0.06
/** Recadrage : position visée pour le coureur, de l'autre côté du centre (fraction de l'image ; 0,32 = à 18 % du bord). */
const LEAD = 0.32
/** Vitesse du recadrage, en part de l'écart restant (plus petit = mouvement plus lent et plus doux). */
const CHASE_GAIN = 0.6
/** Vitesse maximale du recadrage, en multiple de celle du coureur à l'écran : un recadrage plus rapide obligerait
 *  l'aperçu à charger les vues aériennes trop vite (à-coups), et paraîtrait brusque. Le garde-fou n'est pas bridé. */
const MAX_SPEED = 2.2
/** Recadrage terminé quand le coureur est à moins de cette fraction de l'image de sa position visée. */
const SETTLE = 0.015
/** Le tracé « revient » (recadrage interrompu) quand le point d'anticipation est de ce côté du coureur, au-delà de
 *  cette fraction de l'image. */
const TURN_BACK = 0.03
/** Lissage de la vitesse caméra, en multiple du gain d'amorti (plus petit = accélérations et arrêts plus doux). */
const SMOOTH = 1.2

type Axis = { target: number | null; v: number; moved: number; prevD: number | null }
type Pt = { x: number; y: number }

/**
 * Point d'anticipation : position à l'écran du tracé, `lenPx` de parcours (mesuré à l'écran) après le point atteint
 * (`coveredM` mètres). `project` donne la position à l'écran d'un point du tracé.
 */
export function aheadOnScreen(
  points: GpxPoint[], distances: number[], coveredM: number, here: Pt, lenPx: number, project: (lon: number, lat: number) => Pt,
): Pt {
  let i = 0, hi = distances.length - 1
  while (hi - i > 1) { const m = (i + hi) >> 1; if (distances[m] <= coveredM) i = m; else hi = m }
  let prev = here, left = lenPx
  for (let j = i + 1, n = 0; j < points.length && n < 3000; j++, n++) {
    const p = project(points[j].lon, points[j].lat)
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y)
    if (seg >= left) { const f = left / seg; return { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f } }
    left -= seg
    prev = p
  }
  return prev
}

/**
 * Crée un suivi (un par film ou par carte : il garde l'état du recadrage en cours).
 * `step` renvoie les fractions de l'écart caméra → coureur (en longitude et en latitude) à parcourir à cette image.
 * `dx`, `dy` : position du coureur par rapport au centre (px) ; `k` : gain d'amorti de base ; `shrink` (0..1) réduit la
 * zone libre (1 = plus de zone : suivi complet, ex. coureur sur le cartel d'altitude du film) ; `ahead` : point
 * d'anticipation par rapport au centre (px, cf. aheadOnScreen ; absent = position du coureur).
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
  // `f` : point d'anticipation sur cet axe (sans anticipation : f = d, et le coureur est censé s'éloigner du centre).
  function axisStep(a: Axis, d: number, f: number, size: number, guardZone: number, g: number, k: number, shrink: number, vMax: number) {
    const heading = f === d ? d : f - d
    // Déclenchement : le tracé va sortir de la zone, et il s'éloigne du centre.
    if (a.target == null && Math.abs(f) > size * CHASE_ZONE * (1 - shrink) && heading * f > 0)
      a.target = -Math.sign(f) * size * LEAD * (1 - shrink)
    let want = 0
    if (a.target != null) {
      const err = d - a.target
      // Arrivé, dépassé (comparé au côté de départ, opposé à la cible, et non au signe de d, qui s'inverse au passage
      // du centre) ou tracé qui revient vers la cible → la caméra ralentit jusqu'à l'arrêt.
      if (Math.abs(err) < size * SETTLE || Math.sign(err) !== -Math.sign(a.target)
        || (heading * a.target > 0 && Math.abs(heading) > size * TURN_BACK)) a.target = null
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
    step(dx: number, dy: number, w: number, h: number, k: number, shrink = 0, ahead?: Pt): { fx: number; fy: number } {
      const zx = w * GUARD_ZONE * (1 - shrink), zy = h * GUARD_ZONE * (1 - shrink)
      const ex = Math.max(0, Math.abs(dx) - zx), ey = Math.max(0, Math.abs(dy) - zy)
      const maxEx = Math.min(w, h) * MAX_EXCESS, excess = Math.hypot(ex, ey)
      const g = excess > maxEx ? Math.min(0.5, k * (excess / maxEx)) : k
      if (k > 1e-4) runnerSpeed += (Math.hypot(runnerMove(ax, dx), runnerMove(ay, dy)) / k - runnerSpeed) * Math.min(1, k * 2)
      const vMax = MAX_SPEED * runnerSpeed
      return {
        fx: axisStep(ax, dx, ahead?.x ?? dx, w, zx, g, k, shrink, vMax),
        fy: axisStep(ay, dy, ahead?.y ?? dy, h, zy, g, k, shrink, vMax),
      }
    },
    reset() { ax = newAxis(); ay = newAxis(); runnerSpeed = 0 },
  }
}
