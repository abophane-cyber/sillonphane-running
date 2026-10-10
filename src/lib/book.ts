// Livre de Mes sillons : les affiches des courses choisies dans tous les sillons, une double page par course (affiche +
// carnet : temps de passage, profil, photos, notes), double page photos en option ; en tête records, progression,
// palmarès et sommaire. Le nombre de pages doit atteindre le minimum de l'imprimeur (WhiteWall : 28) pour l'export.
import type { Voyage, VoyageTrack } from '../types'
import { PRINT_PROFILES } from './printProfiles'
import { STORAGE_PREFIX } from './appIdentity'

/** Pages d'en-tête : records + progression (double page), palmarès + sommaire (double page). */
export const BOOK_FRONT_PAGES = 4

/** Minimum de pages intérieures exigé par l'imprimeur du livre (WhiteWall). */
export const BOOK_MIN_PAGES = PRINT_PROFILES.find(p => p.id === 'whitewall')?.coverSpread?.pageRange?.min ?? 28

export interface BookCourse {
  voyage: Voyage
  track: VoyageTrack
  /** Date de la course « AAAA-MM-JJ » (affiche, sinon tracé, sinon ajout). */
  date: string
  /** Photos du sillon rattachées à cette course. */
  photoCount: number
}

/** Une course est dans le livre si on l'y a mise ; par défaut, dès que son affiche est faite. */
export function isInBook(track: VoyageTrack): boolean {
  return track.inBook ?? !!track.poster
}

/** Toutes les courses de tous les sillons, de la plus ancienne à la plus récente. */
export function bookCourses(voyages: Voyage[]): BookCourse[] {
  return voyages
    .flatMap(voyage => voyage.tracks.map(track => ({
      voyage, track,
      date: (track.poster?.date || track.date || track.addedAt).slice(0, 10),
      photoCount: voyage.photos.filter(p => p.trackId === track.id).length,
    })))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Pages d'une course : sa double page, plus une double page photos si l'option est prise et qu'elle a des photos. */
export function coursePages(course: BookCourse, photoSpreads: boolean): number {
  return 2 + (photoSpreads && course.photoCount > 0 ? 2 : 0)
}

/** Pages intérieures du livre (hors couverture). Aucun en-tête tant qu'aucune course n'est choisie. */
export function bookPageCount(courses: BookCourse[], photoSpreads: boolean): number {
  if (!courses.length) return 0
  return BOOK_FRONT_PAGES + courses.reduce((n, c) => n + coursePages(c, photoSpreads), 0)
}

/** Réglages de l'écran « Créer le livre », gardés sur l'appareil. */
export interface BookPrefs {
  /** Période « AAAA-MM-JJ » (bornes incluses) ; vides = sans limite. */
  from?: string
  to?: string
  photoSpreads?: boolean
}

const PREFS_KEY = `${STORAGE_PREFIX}livre`

export function loadBookPrefs(): BookPrefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as BookPrefs } catch { return {} }
}

export function saveBookPrefs(prefs: BookPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* stockage indisponible */ }
}

export function inPeriod(date: string, prefs: BookPrefs): boolean {
  return (!prefs.from || date >= prefs.from) && (!prefs.to || date <= prefs.to)
}
