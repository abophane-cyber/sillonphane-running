// Livre de Mes sillons : les affiches des courses choisies dans tous les sillons, une double page par course (affiche +
// carnet : temps de passage, profil, photos, note), double page photos en option ; en tête page de titre, records,
// progression, palmarès et sommaire. Le nombre de pages doit atteindre le minimum de l'imprimeur (WhiteWall : 28) pour
// l'export. Dessin et PDF : lib/bookExport.ts.
import type { Voyage, VoyageTrack } from '../types'
import { PRINT_PROFILES } from './printProfiles'
import { STORAGE_PREFIX } from './appIdentity'

/** Pages d'en-tête : page de titre (à droite), records | progression, palmarès | sommaire. Les courses commencent
 * ainsi sur une page de gauche : affiche à gauche, carnet en face. */
export const BOOK_FRONT_PAGES = 5

/** Minimum de pages intérieures exigé par l'imprimeur du livre (WhiteWall). */
export const BOOK_MIN_PAGES = PRINT_PROFILES.find(p => p.id === 'whitewall')?.coverSpread?.pageRange?.min ?? 28

export interface BookCourse {
  voyage: Voyage
  track: VoyageTrack
  /** Date de la course « AAAA-MM-JJ » (affiche, sinon tracé, sinon ajout). */
  date: string
  /** Photos de la course : celles de son tracé et celles choisies pour son affiche. */
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
      photoCount: voyage.photos.filter(p => p.trackId === track.id || track.poster?.photoIds?.includes(p.id)).length,
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
  /** Titre du livre (défaut « Mes courses ») et nom du coureur (défaut : celui des affiches). */
  title?: string
  name?: string
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

/** Pages du fichier livré : complété de pages blanches jusqu'au multiple de 4 exigé par WhiteWall (28 au moins). */
export function printedPageCount(contentPages: number): number {
  return Math.max(BOOK_MIN_PAGES, Math.ceil(contentPages / 4) * 4)
}

/** Nom du coureur proposé : celui saisi le plus souvent sur les affiches. */
export function defaultRunnerName(courses: BookCourse[]): string {
  const count = new Map<string, number>()
  for (const c of courses) {
    const n = c.track.poster?.name?.trim()
    if (n) count.set(n, (count.get(n) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}
