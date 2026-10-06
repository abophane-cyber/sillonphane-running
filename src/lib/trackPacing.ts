// Allure des randonneurs 3D le long du tracé, partagée par l'aperçu (useAnimation, TrackMap) et le film 2D
// (filmExport) :
//  - cap du chemin à chaque endroit (les personnages suivent les virages et les lacets) ;
//  - ralenti dans les virages : l'avancement est freiné là où le chemin tourne vite, pour que les personnages
//    pivotent en douceur. Le ralenti commence avant le virage et se relâche après (anticipation + lissage).
// La longueur sur laquelle on mesure la direction du chemin suit la vitesse d'avancement (≈ LOOK_S secondes de
// marche) : l'animation parcourt plusieurs centaines de m/s, et à cette allure les épingles les plus serrées sont
// prises comme une courbe continue — sans quoi le personnage pivoterait de 180° en une fraction de seconde.
import type { GpxPoint } from '../types'

const STEP_M = 10
const LOOK_S = 0.8
const LOOK_MIN_M = 120
const LOOK_MAX_M = 700
/** Vitesse de pivot visée au plus fort d'un virage (degrés par seconde d'animation). */
const MAX_TURN_DEG_PER_S = 130
/** Ralenti maximal (fraction de la vitesse normale). Running : aucun (1) — le ruban avance à vitesse constante,
 * sans à-coups ; les pivots restent doux grâce au cap mesuré loin devant. */
const MIN_FACTOR = 1
/** Vitesse hors des virages (fraction de la vitesse normale). Running : 1, pas d'accélération sur les lignes droites. */
const MAX_FACTOR = 1
/** Cadence des pas plafonnée à la vitesse normale : l'accélération hors des lacets ne fait pas trotter les personnages. */
const STEP_MAX_FACTOR = 1
/** Le ralenti s'installe ANTICIPATE_M avant le virage et dure autant après ; puis lissage sur ±BLUR_M. */
const ANTICIPATE_M = 120
const BLUR_M = 80

export interface TimeWarp {
  /** Durée de la marche (s) avec les ralentis. */
  totalS: number
  /** Distance parcourue (m) après t secondes de marche. */
  mAtTime(t: number): number
  /** Instant (s) où la distance m est atteinte. */
  timeAtM(m: number): number
}

export interface TrackPacing {
  /** Vitesse normale d'avancement (m/s, sans ralenti) : règle la longueur de mesure du cap et le ralenti. */
  setNominalSpeed(mps: number): void
  /** Cap du chemin à la distance m (radians, 0 = nord, sens horaire). */
  headingAt(m: number): number
  /** Facteur de vitesse (MIN_FACTOR..MAX_FACTOR) à la distance m. */
  factorAt(m: number): number
  /** Correction de la cadence des pas à la distance m (≤ 1) : ramène l'accélération hors des virages à la vitesse
   * normale, pour que les pas gardent leur allure. À appliquer à la vitesse au sol avant setGroundSpeed. */
  stepScaleAt(m: number): number
  /** Marche à la vitesse normale ralentie dans les virages (film : temps <-> distance). */
  timeWarp(): TimeWarp
}

const cache = new WeakMap<GpxPoint[], TrackPacing>()

/** Allure du tracé (une par tableau de points ; profils calculés à la demande). */
export function getTrackPacing(points: GpxPoint[], distances: number[]): TrackPacing {
  let p = cache.get(points)
  if (!p) { p = buildTrackPacing(points, distances); cache.set(points, p) }
  return p
}

interface Profile { heading: Float64Array; curv: Float64Array }

function buildTrackPacing(points: GpxPoint[], distances: number[]): TrackPacing {
  const total = distances[distances.length - 1] || 0
  const n = Math.max(2, Math.ceil(total / STEP_M) + 1)
  const lat0 = (points[0]?.lat ?? 0) * Math.PI / 180
  const kx = 111320 * Math.cos(lat0), ky = 110540
  // Positions (m, repère local) tous les STEP_M.
  const px = new Float64Array(n), py = new Float64Array(n)
  for (let i = 0, seg = 1; i < n; i++) {
    const m = Math.min(total, i * STEP_M)
    while (seg < distances.length - 1 && distances[seg] < m) seg++
    const d0 = distances[seg - 1], d1 = distances[seg]
    const t = d1 > d0 ? (m - d0) / (d1 - d0) : 0
    const a = points[seg - 1], b = points[seg] ?? a
    px[i] = (a.lon + (b.lon - a.lon) * t) * kx
    py[i] = (a.lat + (b.lat - a.lat) * t) * ky
  }
  const interp = (arr: Float64Array, m: number) => {
    const x = Math.max(0, Math.min(n - 1, m / STEP_M))
    const i = Math.floor(x), t = x - i
    return i >= n - 1 ? arr[n - 1] : arr[i] + (arr[i + 1] - arr[i]) * t
  }

  const profiles = new Map<number, Profile>()
  function profile(lookM: number): Profile {
    const key = Math.round(lookM / 20) * 20
    let pr = profiles.get(key)
    if (pr) return pr
    const half = Math.max(1, Math.round(key / 2 / STEP_M))
    // Cap (déroulé, sans saut de 2π) mesuré sur ±key/2 autour de chaque pas.
    const heading = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half), b = Math.min(n - 1, i + half)
      let h = Math.atan2(px[b] - px[a], py[b] - py[a])
      if (i > 0) { const prev = heading[i - 1]; h = prev + Math.atan2(Math.sin(h - prev), Math.cos(h - prev)) }
      heading[i] = h
    }
    // Courbure (rad/m), étendue avant/après chaque virage (max glissant) puis lissée (moyenne glissante).
    const raw = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
      raw[i] = Math.abs(heading[b] - heading[a]) / (STEP_M * Math.max(1, b - a))
    }
    const ant = Math.round(ANTICIPATE_M / STEP_M), blur = Math.round(BLUR_M / STEP_M)
    const wide = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let mx = 0
      for (let j = Math.max(0, i - ant); j <= Math.min(n - 1, i + ant); j++) mx = Math.max(mx, raw[j])
      wide[i] = mx
    }
    const curv = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0
      for (let j = Math.max(0, i - blur); j <= Math.min(n - 1, i + blur); j++) { s += wide[j]; c++ }
      curv[i] = s / c
    }
    pr = { heading, curv }
    profiles.set(key, pr)
    return pr
  }

  let nominal = 0
  const current = () => profile(Math.max(LOOK_MIN_M, Math.min(LOOK_MAX_M, nominal * LOOK_S)))
  const omega = (MAX_TURN_DEG_PER_S * Math.PI) / 180
  const factorAt = (m: number) => {
    const k = interp(current().curv, m)
    if (!(nominal > 0)) return 1
    if (!(k > 0)) return MAX_FACTOR
    return Math.max(MIN_FACTOR, Math.min(MAX_FACTOR, omega / (k * nominal)))
  }
  return {
    setNominalSpeed(mps) { nominal = mps > 0 ? mps : 0 },
    headingAt: m => interp(current().heading, m),
    factorAt,
    stepScaleAt(m) { const f = factorAt(m); return f > STEP_MAX_FACTOR ? STEP_MAX_FACTOR / f : 1 },
    timeWarp() {
      const v = nominal > 0 ? nominal : 1
      // Temps cumulé à chaque pas : dt = pas / (v × facteur).
      const time = new Float64Array(n)
      for (let i = 1; i < n; i++) {
        const len = Math.min(total, i * STEP_M) - Math.min(total, (i - 1) * STEP_M)
        time[i] = time[i - 1] + len / (v * factorAt((i - 0.5) * STEP_M))
      }
      const totalS = time[n - 1]
      return {
        totalS,
        timeAtM(m) { return interp(time, m) },
        mAtTime(t) {
          if (t <= 0) return 0
          if (t >= totalS) return total
          let lo = 0, hi = n - 1
          while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (time[mid] <= t) lo = mid; else hi = mid }
          const m0 = Math.min(total, lo * STEP_M), m1 = Math.min(total, hi * STEP_M)
          const f = time[hi] > time[lo] ? (t - time[lo]) / (time[hi] - time[lo]) : 0
          return m0 + (m1 - m0) * f
        },
      }
    },
  }
}

/** Cap (radians, 0 = nord, sens horaire) -> direction à l'écran (carte nord en haut : y vers le bas). */
export function headingToScreen(h: number): { x: number; y: number } {
  return { x: Math.sin(h), y: -Math.cos(h) }
}
