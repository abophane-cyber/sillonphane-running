import type { VoyageTrack } from '../types'

/** Aides d'affichage des courses (écran d'un sillon, choix de l'affiche). */

const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.']
/** Pavé de date d'une course : « 10 / OCT. / 2025 ». */
export function dateParts(iso?: string): { day: number; month: string; year: number } | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : { day: d.getDate(), month: MONTHS[d.getMonth()], year: d.getFullYear() }
}

/** Course la plus récente qui a une affiche (page gauche du livre ouvert). */
export function latestPosterTrack(tracks: VoyageTrack[]): VoyageTrack | undefined {
  return tracks.filter(t => t.poster)
    .sort((a, b) => (b.date || b.addedAt).localeCompare(a.date || a.addedAt))[0]
}
