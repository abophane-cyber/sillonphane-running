// Films d'essai : « ?essai » dans l'URL de l'appli -> films 2D et 3D réduits aux ESSAI_FILM_S premières secondes du
// parcours, à vitesse normale, sans écran-titre ni plans de fin. Seule cette portion du tracé est préparée (vues
// aériennes, terrain 3D) : la création est bien plus rapide. Rangés dans Mes sillons comme les autres.
import type { GpxPoint } from '../types'

export const ESSAI_FILM_S = 15

export function isEssaiFilm(): boolean {
  return new URLSearchParams(window.location.search).has('essai')
}

/** Début du tracé couvert en ESSAI_FILM_S par un film qui le parcourt entier en `filmS` : nombre de points gardés,
 * longueur (m) et distance de chaque point depuis le départ (tout le tracé). */
export function essaiPortion(points: GpxPoint[], filmS: number): { count: number; portionM: number; dist: number[] } {
  const dist = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const dx = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), dy = (b.lat - a.lat) * 110540
    dist.push(dist[i - 1] + Math.hypot(dx, dy))
  }
  const totalM = dist[dist.length - 1]
  const portionM = totalM * Math.min(1, ESSAI_FILM_S / Math.max(ESSAI_FILM_S, filmS))
  let count = dist.findIndex(d => d >= portionM) + 1
  if (count <= 0) count = points.length
  return { count: Math.max(2, count), portionM: dist[Math.max(1, count - 1)], dist }
}
