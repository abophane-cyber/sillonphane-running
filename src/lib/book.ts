// Livre de Mes sillons : les affiches des courses choisies dans tous les sillons, une double page par course (affiche +
// carnet : temps de passage, profil, photos, note), double page photos en option ; en tête sommaire, records,
// progression et palmarès. Le nombre de pages doit atteindre le minimum de l'imprimeur (WhiteWall : 28,
// Flexilivre : 24) pour l'export. Dessin et PDF : lib/bookExport.ts.
import type { Voyage, VoyageTrack } from '../types'
import { PRINT_PROFILES, type PrintProfile } from './printProfiles'
import { STORAGE_PREFIX } from './appIdentity'
import type { RecordCategory } from './records'
import type { CoverModel } from './bookCover'

/** Pages d'en-tête, dans l'ordre : sommaire (page 1, à droite), records | progression, palmarès. Chacune se retire
 * depuis l'écran « Mise en page du livre » (components/LivreMiseEnPage.tsx) ; le sommaire ne liste que celles gardées.
 * (Plus de page de titre : la couverture la remplace.) */
export type FrontPageId = 'toc' | 'records' | 'progress' | 'palmares'
export const FRONT_PAGES: { id: FrontPageId; label: string }[] = [
  { id: 'toc', label: 'Sommaire' },
  { id: 'records', label: 'Records' },
  { id: 'progress', label: 'Progression' },
  { id: 'palmares', label: 'Palmarès' },
]

/** Fond de la couverture : vert nuit (défaut), papier crème, une photo d'une des courses, ou « vagues » (graphique
 * sans photo, une course ; cf. drawGraphicCover). L'ancien fond noir enregistré s'affiche en vert nuit. */
export type CoverBg = 'nuit' | 'papier' | 'photo' | 'vagues'

/** Mise en page du livre. Absent = valeur par défaut. */
export interface BookLayout {
  coverBg?: CoverBg
  /** Photo de couverture (fond « photo »). */
  coverPhotoId?: string
  /** Fond « photo » : la photo telle quelle (défaut), redessinée en gravure, ou en affiche illustrée (cf. bookCover.ts). */
  coverModel?: CoverModel
  /** Fond « photo » : courses dont le tracé est sur la couverture (3 au plus) ; absent = les 3 premières. */
  coverTraceIds?: string[]
  /** Fond « photo » : devise en haut à droite, un mot ou groupe par ligne ; absent = « Courir / Explorer / Se dépasser
   *  / Se souvenir », vide = sans devise. */
  coverMotto?: string
  /** Modèle dessin : phrase du bas ; absent = « Des kilomètres qui ont du sens », vide = sans phrase. */
  coverTagline?: string
  /** Sous-titre de la couverture ; absent = la période (« 2025 — 2026 »). */
  coverSubtitle?: string
  /** Tracés des courses sur la couverture (défaut oui). */
  coverTraces?: boolean
  /** Titre en haut (défaut) ou en bas de la couverture. */
  coverTitlePos?: 'haut' | 'bas'
  /** 4e de couverture : records et totaux (défaut oui), texte libre. */
  backRecords?: boolean
  backText?: string
  /** Pages d'en-tête retirées. */
  hidden?: FrontPageId[]
  /** Distances montrées sur la page Records ; absent = les quatre. */
  recordCats?: RecordCategory[]
  /** Totaux (courses, km, temps) en bas de la page Records (défaut oui). */
  recordTotals?: boolean
  /** Carnet de chaque course : temps de passage, profil, photos (défaut oui). */
  carnetSplits?: boolean
  carnetProfile?: boolean
  carnetPhotos?: boolean
}

/** Pages d'en-tête gardées, dans l'ordre. */
export function frontPages(layout: BookLayout | undefined): FrontPageId[] {
  const hidden = layout?.hidden ?? []
  return FRONT_PAGES.map(p => p.id).filter(id => !hidden.includes(id))
}

/** Pages occupées par l'en-tête : un nombre impair (page blanche ajoutée au besoin), pour que chaque course commence
 * sur une page de gauche (affiche à gauche, carnet en face). */
export function frontPageCount(layout: BookLayout | undefined): number {
  const n = frontPages(layout).length
  return n % 2 === 1 ? n : n + 1
}

/** Imprimeurs du livre : WhiteWall (paysage 27,3 × 21,1 cm, 28 pages au moins, intérieur et couverture à plat en deux
 * PDF) ou Flexilivre (A4 paysage sans fond perdu, 24 pages au moins, un seul PDF : couverture en 1re page, 4e de
 * couverture en dernière). Profils et minimums : lib/printProfiles.ts. */
export type BookPrinter = 'whitewall' | 'flexilivre'

export interface BookPrinterInfo {
  id: BookPrinter
  label: string
  profile: PrintProfile
  /** Pages intérieures au moins (hors couverture). */
  minPages: number
}

function printerInfo(id: BookPrinter, label: string, profileId: string): BookPrinterInfo {
  const profile = PRINT_PROFILES.find(p => p.id === profileId)!
  return { id, label, profile, minPages: profile.coverSpread?.pageRange?.min ?? profile.pageCount?.min ?? 24 }
}

export const BOOK_PRINTERS: BookPrinterInfo[] = [
  printerInfo('whitewall', 'WhiteWall', 'whitewall'),
  printerInfo('flexilivre', 'Flexilivre', 'flexilivre-a4'),
]

export function bookPrinter(id: BookPrinter | undefined): BookPrinterInfo {
  return BOOK_PRINTERS.find(p => p.id === id) ?? BOOK_PRINTERS[0]
}

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
export function bookPageCount(courses: BookCourse[], photoSpreads: boolean, layout?: BookLayout): number {
  if (!courses.length) return 0
  return frontPageCount(layout) +courses.reduce((n, c) => n + coursePages(c, photoSpreads), 0)
}

/** Réglages de l'écran « Créer le livre », gardés sur l'appareil. */
export interface BookPrefs {
  /** Période « AAAA-MM-JJ » (bornes incluses) ; vides = sans limite. */
  from?: string
  to?: string
  photoSpreads?: boolean
  printer?: BookPrinter
  /** Titre du livre (défaut « Mes courses ») et nom du coureur (défaut : celui des affiches). */
  title?: string
  name?: string
  layout?: BookLayout
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

/** Pages intérieures du fichier livré : complétées de pages blanches jusqu'au multiple de 4 (cahiers), au minimum de
 * l'imprimeur. */
export function printedPageCount(contentPages: number, printer: BookPrinterInfo): number {
  return Math.max(printer.minPages, Math.ceil(contentPages / 4) * 4)
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
