// Records sur 5 km, 10 km, semi et marathon, d'après les courses rangées dans Mes sillons. Temps retenu : celui saisi
// pour l'affiche (temps officiel), sinon la durée du GPX quand ses heures sont réelles (marqué « GPS »). Les tracés de
// planification (heures fictives) et les distances hors catégorie n'entrent pas dans les records.
import type { Voyage, VoyageTrack } from '../types'
import { parseGpx, parseKml, buildDistanceArray } from './gpx'
import { hasRealTimes } from './raceSplits'
import { officialDistanceM, parseChrono, formatChronoInput } from './poster'

export type RecordCategory = '5k' | '10k' | 'semi' | 'marathon'

export const RECORD_CATEGORIES: { id: RecordCategory; label: string; m: number }[] = [
  { id: '5k', label: '5 km', m: 5000 },
  { id: '10k', label: '10 km', m: 10000 },
  { id: 'semi', label: 'Semi', m: 21097.5 },
  { id: 'marathon', label: 'Marathon', m: 42195 },
]

export interface RaceResult {
  voyageId: string
  trackId: string
  name: string
  date?: string
  category: RecordCategory
  timeS: number
  /** true = durée du GPX (aucun temps officiel saisi). */
  gps: boolean
}

/** Mesures tirées du GPX (coûteuses à recalculer) : distance mesurée et durée si les heures sont réelles. */
const gpxCache = new Map<string, { totalM: number; durationS?: number }>()

function measureGpx(track: VoyageTrack): { totalM: number; durationS?: number } {
  const key = `${track.id}:${track.gpxData.length}`
  const hit = gpxCache.get(key)
  if (hit) return hit
  let out: { totalM: number; durationS?: number } = { totalM: track.distanceM ?? 0 }
  try {
    let parsed
    try { parsed = parseGpx(track.gpxData) } catch { parsed = parseKml(track.gpxData) }
    if (!parsed.tracks.length) parsed = parseKml(track.gpxData)
    const points = parsed.tracks.flatMap(t => t.points)
    const distances = buildDistanceArray(points)
    const totalM = distances[distances.length - 1] ?? 0
    out = { totalM }
    if (hasRealTimes(points, distances)) {
      const t0 = points.find(p => p.time)?.time, t1 = [...points].reverse().find(p => p.time)?.time
      if (t0 && t1 && t1 > t0) out.durationS = (t1.getTime() - t0.getTime()) / 1000
    }
  } catch { /* trace illisible : seule la distance enregistrée reste */ }
  gpxCache.set(key, out)
  return out
}

/** Résultat d'une course (catégorie et temps), ou null si elle n'entre dans aucune catégorie ou n'a pas de temps. */
export function raceResult(voyageId: string, track: VoyageTrack): RaceResult | null {
  const { totalM, durationS } = measureGpx(track)
  const official = officialDistanceM(totalM)
  const category = RECORD_CATEGORIES.find(c => c.m === official)?.id
  if (!category) return null
  const chrono = parseChrono(track.poster?.chrono)
  const timeS = chrono ?? durationS
  if (!timeS) return null
  return {
    voyageId, trackId: track.id, name: track.poster?.title || track.name,
    date: track.poster?.date || track.date, category, timeS, gps: chrono === undefined,
  }
}

/** Meilleur temps par catégorie parmi les courses des sillons donnés. */
export function bestRecords(voyages: Voyage[]): Partial<Record<RecordCategory, RaceResult>> {
  const best: Partial<Record<RecordCategory, RaceResult>> = {}
  for (const v of voyages) {
    for (const t of v.tracks) {
      const r = raceResult(v.id, t)
      if (r && (!best[r.category] || r.timeS < best[r.category]!.timeS)) best[r.category] = r
    }
  }
  return best
}

export const formatRecordTime = formatChronoInput
