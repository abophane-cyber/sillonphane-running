import type { Voyage, VoyageTrack, VoyageFilm, VoyagePhoto, ComposedAlbumPage, PanelLocality, PosterSettings } from '../types'
import { migrateLegacyCover } from './albumPages'
import { saveFileWithPicker } from './saveFile'
import { uuid } from './uuid'
import { APP_ID, APP_NAME, APP_NAMES, STORAGE_DB } from './appIdentity'

const DB_NAME = STORAGE_DB // propre à Running : les sillons des autres déclinaisons n'y apparaissent pas
const DB_VERSION = 3
const STORE_VOYAGES    = 'voyages'
const STORE_BLOBS      = 'film-blobs'    // clé = filmId, valeur = Blob vidéo
const STORE_PHOTO_BLOBS = 'photo-blobs'  // clé = photoId, valeur = Blob image
const STORE_TRACK_PDF_CACHE = 'track-pdf-cache'  // clé = trackId, valeur = { trackId, contentVersion, blob }
const STORE_COVER_PDF_CACHE = 'cover-pdf-cache'  // clé = voyageId, valeur = { voyageId, contentVersion, blob }

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_VOYAGES)) {
        db.createObjectStore(STORE_VOYAGES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS)
      }
      if (!db.objectStoreNames.contains(STORE_PHOTO_BLOBS)) {
        db.createObjectStore(STORE_PHOTO_BLOBS)
      }
      if (!db.objectStoreNames.contains(STORE_TRACK_PDF_CACHE)) {
        db.createObjectStore(STORE_TRACK_PDF_CACHE, { keyPath: 'trackId' })
      }
      if (!db.objectStoreNames.contains(STORE_COVER_PDF_CACHE)) {
        db.createObjectStore(STORE_COVER_PDF_CACHE, { keyPath: 'voyageId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror  = () => reject(req.error)
  })
}

// Les voyages enregistrés avant l'ajout des photos n'ont pas ce champ ; les couvertures à
// l'ancien format (mise en page figée) sont converties vers coverTemplate + cover.
function normalize(v: Voyage): Voyage {
  const photos = v.photos ?? []
  const coverPage = v.coverPage ? migrateLegacyCover(v.coverPage) : v.coverPage
  if (photos === v.photos && coverPage === v.coverPage) return v
  return { ...v, photos, coverPage }
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store)
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// Sérialise les cycles lecture-modification-écriture sur un même voyage : sans ça,
// deux appels concurrents (ex. cliquer "Garder" sur plusieurs photos rapidement)
// lisent le même état de départ et le second écrase le premier.
const voyageLocks = new Map<string, Promise<unknown>>()

function withVoyageLock<T>(voyageId: string, fn: () => Promise<T>): Promise<T> {
  const previous = voyageLocks.get(voyageId) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  voyageLocks.set(voyageId, next.catch(() => {}))
  return next
}

// ── Sillon unique par défaut ─────────────────────────────────────────────────

const DEFAULT_ID = 'mes-sillons-default'

export async function getDefaultSillon(): Promise<Voyage> {
  let v = await getVoyage(DEFAULT_ID)
  if (!v) {
    v = { id: DEFAULT_ID, name: 'Mes sillons', createdAt: new Date().toISOString(), tracks: [], films: [], photos: [], printProfileId: NEW_VOYAGE_PRINT_PROFILE_ID }
    await saveVoyage(v)
  }
  return v
}

// ── CRUD Voyages ──────────────────────────────────────────────────────────────

export async function getAllVoyages(): Promise<Voyage[]> {
  const db = await openDB()
  const all = await wrap<Voyage[]>(tx(db, STORE_VOYAGES, 'readonly').getAll())
  return all.map(normalize)
}

export async function getVoyage(id: string): Promise<Voyage | undefined> {
  const db = await openDB()
  const v = await wrap<Voyage | undefined>(tx(db, STORE_VOYAGES, 'readonly').get(id))
  return v ? normalize(v) : undefined
}

export async function saveVoyage(voyage: Voyage): Promise<void> {
  const db = await openDB()
  await wrap(tx(db, STORE_VOYAGES, 'readwrite').put(voyage))
  markBackupPending()
}

export async function deleteVoyage(id: string): Promise<void> {
  return withVoyageLock(id, async () => {
    const db = await openDB()
    const voyage = await getVoyage(id)
    await wrap(tx(db, STORE_VOYAGES, 'readwrite').delete(id))
    if (voyage) {
      const blobStore = tx(db, STORE_BLOBS, 'readwrite')
      for (const film of voyage.films) blobStore.delete(film.id)
      const photoBlobStore = tx(db, STORE_PHOTO_BLOBS, 'readwrite')
      for (const photo of voyage.photos) photoBlobStore.delete(photo.id)
      const trackPdfCacheStore = tx(db, STORE_TRACK_PDF_CACHE, 'readwrite')
      for (const track of voyage.tracks) trackPdfCacheStore.delete(track.id)
      tx(db, STORE_COVER_PDF_CACHE, 'readwrite').delete(id)
    }
    markBackupPending()
  })
}

// Nouveau sillon : profil d'imprimeur « Personnalisé » d'emblée, pour ne pas orienter vers un
// imprimeur (on indique dans « Créer mon album » qu'on peut en choisir un). Les sillons plus anciens,
// sans printProfileId, restent sur l'ancien défaut Flexilivre A4 (voir getPrintProfile).
export const NEW_VOYAGE_PRINT_PROFILE_ID = 'custom'

export function createVoyage(name: string): Voyage {
  return { id: uuid(), name, createdAt: new Date().toISOString(), tracks: [], films: [], photos: [], printProfileId: NEW_VOYAGE_PRINT_PROFILE_ID }
}

// ── Tracés ────────────────────────────────────────────────────────────────────

/** Tracé déjà rangé dans le sillon pour ce même fichier GPX (réenregistrement), sinon undefined.
 * Jamais par le nom : deux courses différentes portent souvent le même titre (« Mon semi-marathon »)
 * et doivent rester deux tracés distincts, chacun avec son affiche et ses films. */
export function findSameTrack(tracks: VoyageTrack[], gpxData: string): VoyageTrack | undefined {
  return gpxData ? tracks.find(t => t.gpxData === gpxData) : undefined
}

/** Repli des films sans id de tracé connu : rapprochement par nom, seulement s'il est sans ambiguïté. */
export function findTrackByUniqueName(tracks: VoyageTrack[], name: string): VoyageTrack | undefined {
  const key = name.trim().toLowerCase()
  const matches = tracks.filter(t => t.name.trim().toLowerCase() === key)
  return matches.length === 1 ? matches[0] : undefined
}

export async function addTrackToVoyage(
  voyageId: string,
  track: Omit<VoyageTrack, 'id' | 'addedAt'>,
): Promise<VoyageTrack> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) throw new Error('Voyage introuvable')
    const entry: VoyageTrack = { ...track, id: uuid(), addedAt: new Date().toISOString() }
    voyage.tracks.push(entry)
    await saveVoyage(voyage)
    return entry
  })
}

export async function removeTrackFromVoyage(voyageId: string, trackId: string): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    voyage.tracks = voyage.tracks.filter(t => t.id !== trackId)
    await saveVoyage(voyage)
    await deleteTrackPdfCache(trackId)
  })
}

/** Renvoie le nouvel albumContentVersion généré, pour que l'appelant puisse le répercuter dans son
 * état local (voir handleSaveAlbumPages dans AlbumPage.tsx/VoyagesPage.tsx) — sans quoi la case ✓
 * du PDF en cache resterait affichée comme valide après une modification, l'état local gardant
 * l'ancienne version tant que le voyage n'est pas rechargé depuis l'IndexedDB. */
export async function saveTrackAlbumPages(
  voyageId: string,
  trackId: string,
  albumPages: ComposedAlbumPage[],
): Promise<string> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return 'none'
    const albumContentVersion = uuid()
    voyage.tracks = voyage.tracks.map(t => t.id === trackId
      ? { ...t, albumPages, albumUpdatedAt: new Date().toISOString(), albumContentVersion }
      : t)
    await saveVoyage(voyage)
    return albumContentVersion
  })
}

/** Renomme un tracé. Son nom sert de titre aux pages de l'album (bandeau des pages photos,
 * page résumé) : on régénère albumContentVersion pour que le PDF en cache soit refait. */
export async function renameTrack(voyageId: string, trackId: string, name: string): Promise<string> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return 'none'
    const albumContentVersion = uuid()
    voyage.tracks = voyage.tracks.map(t => t.id === trackId ? { ...t, name, albumContentVersion } : t)
    await saveVoyage(voyage)
    return albumContentVersion
  })
}

/** Mémorise les réglages de l'affiche d'un tracé (cf. lib/poster.ts). */
export async function saveTrackPoster(voyageId: string, trackId: string, poster: PosterSettings): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    voyage.tracks = voyage.tracks.map(t => t.id === trackId ? { ...t, poster } : t)
    await saveVoyage(voyage)
  })
}

/** Retire un tracé du raccourci "Reprendre la composition" (composition considérée terminée),
 * sans toucher aux pages d'album déjà composées. */
export async function clearTrackAlbumUpdatedAt(voyageId: string, trackId: string): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    voyage.tracks = voyage.tracks.map(t => t.id === trackId ? { ...t, albumUpdatedAt: undefined } : t)
    await saveVoyage(voyage)
  })
}

/** Mémorise la personnalisation des panneaux (wizard) d'un tracé — pour qu'ouvrir un tracé déjà
 * enregistré depuis "Mes sillons" retrouve directement la configuration précédente, sans avoir
 * à refaire le wizard ni un nouvel aperçu. */
export async function saveTrackPanelSettings(
  voyageId: string,
  trackId: string,
  settings: {
    startName?: string
    endName?: string
    startKind?: 'localite' | 'lieudit'
    endKind?: 'localite' | 'lieudit'
    suppressed?: string[]
    customLocalities?: PanelLocality[]
    wizardDone?: boolean
    bornesOff?: boolean
    plannedTimes?: boolean
    raceSpeeds?: number[]
    eventName?: string
    bannerDate?: string
    bannerDistance?: string
    bibNumber?: string
    ravitos?: string
    streets?: { name: string; startM: number; endM: number }[]
    /** Titre du film (rubrique Épreuve) = nom du tracé ; changé seulement s'il diffère (renommer refait le PDF). */
    name?: string
    /** Date et heures saisies (heure de départ prévue de la rubrique Épreuve). */
    date?: string
    departureTime?: string
    arrivalTime?: string
  },
): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    voyage.tracks = voyage.tracks.map(t => t.id === trackId ? {
      ...t,
      ...(settings.name && settings.name !== t.name ? { name: settings.name, albumContentVersion: uuid() } : {}),
      date: settings.date,
      departureTime: settings.departureTime,
      arrivalTime: settings.arrivalTime,
      panelStartName: settings.startName,
      panelEndName: settings.endName,
      panelStartKind: settings.startKind,
      panelEndKind: settings.endKind,
      panelSuppressed: settings.suppressed,
      panelCustomLocalities: settings.customLocalities,
      panelWizardDone: settings.wizardDone,
      panelBornesOff: settings.bornesOff,
      panelPlannedTimes: settings.plannedTimes,
      panelRaceSpeeds: settings.raceSpeeds,
      panelEventName: settings.eventName,
      panelBannerDate: settings.bannerDate,
      panelBannerDistance: settings.bannerDistance,
      panelBibNumber: settings.bibNumber,
      panelRavitos: settings.ravitos,
      panelStreets: settings.streets,
    } : t)
    await saveVoyage(voyage)
  })
}


/** Format de page de l'album (cm, l × h) pour tout le voyage — saisi dans la liste « Créer mon
 * album-photo », tel que demandé par l'imprimeur. On renouvelle aussi coverContentVersion : les
 * PDF en cache (couverture comme étapes) ont été rasterisés à l'ancien format et doivent être
 * régénérés. */
export async function saveVoyageAlbumPageCm(
  voyageId: string,
  pageCm: { w: number; h: number },
  printProfileId?: string,
): Promise<string> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return 'none'
    const coverContentVersion = uuid()
    await saveVoyage({
      ...voyage,
      albumPageCm: pageCm,
      ...(printProfileId !== undefined ? { printProfileId } : {}),
      coverContentVersion,
    })
    return coverContentVersion
  })
}

/** Nombre de pages intérieures pour un profil wrap-spread — celui demandé par WhiteWall, d'où on
 * déduit la largeur du dos (voir spineMmForPages) et donc les dimensions de la feuille de
 * couverture. On renouvelle coverContentVersion pour régénérer le PDF de couverture en cache,
 * rasterisé à l'ancien dos. */
export async function saveVoyageWrapPageCount(
  voyageId: string,
  wrapPageCount: number,
): Promise<string> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return 'none'
    const coverContentVersion = uuid()
    await saveVoyage({ ...voyage, wrapPageCount, coverContentVersion })
    return coverContentVersion
  })
}

/** Renvoie le nouvel coverContentVersion généré — voir la note de saveTrackAlbumPages ci-dessus,
 * même besoin côté couverture. */
export async function saveVoyageCoverPages(
  voyageId: string,
  coverPage: ComposedAlbumPage | undefined,
  backCoverPage: ComposedAlbumPage | undefined,
): Promise<string> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return 'none'
    const coverContentVersion = uuid()
    await saveVoyage({ ...voyage, coverPage, backCoverPage, coverContentVersion })
    return coverContentVersion
  })
}

// ── Cache des PDF générés par étape / couverture ────────────────────────────
// Un PDF par étape (ou pour la couverture+dos) une fois généré (voir "Générer le PDF" dans
// AlbumPage) est mis en cache ici pour que l'export d'un album multi-tracés puisse fusionner ces
// PDF déjà rendus (voir pdfMerge.ts) plutôt que de tout re-rasteriser (cartes/météo comprises) à
// chaque export. contentVersion sert de clé d'invalidation : tant qu'elle correspond à la version
// courante de la composition (albumContentVersion / coverContentVersion), le PDF en cache reste
// valide.

interface TrackPdfCacheEntry { trackId: string; contentVersion: string; blob: Blob }
interface CoverPdfCacheEntry { voyageId: string; contentVersion: string; blob: Blob }

export async function getTrackPdfCache(trackId: string): Promise<TrackPdfCacheEntry | undefined> {
  const db = await openDB()
  return wrap<TrackPdfCacheEntry | undefined>(tx(db, STORE_TRACK_PDF_CACHE, 'readonly').get(trackId))
}

export async function setTrackPdfCache(trackId: string, contentVersion: string, blob: Blob): Promise<void> {
  const db = await openDB()
  await wrap(tx(db, STORE_TRACK_PDF_CACHE, 'readwrite').put({ trackId, contentVersion, blob } satisfies TrackPdfCacheEntry))
}

export async function deleteTrackPdfCache(trackId: string): Promise<void> {
  const db = await openDB()
  await wrap(tx(db, STORE_TRACK_PDF_CACHE, 'readwrite').delete(trackId))
}

/** Version en cache par tracé, sans charger les blobs (potentiellement volumineux) — pour
 * afficher l'état ✓/à générer dans la liste des étapes. */
export async function listTrackPdfCacheVersions(): Promise<Record<string, string>> {
  const db = await openDB()
  const all = await wrap<TrackPdfCacheEntry[]>(tx(db, STORE_TRACK_PDF_CACHE, 'readonly').getAll())
  return Object.fromEntries(all.map(e => [e.trackId, e.contentVersion]))
}

export async function getCoverPdfCache(voyageId: string): Promise<CoverPdfCacheEntry | undefined> {
  const db = await openDB()
  return wrap<CoverPdfCacheEntry | undefined>(tx(db, STORE_COVER_PDF_CACHE, 'readonly').get(voyageId))
}

export async function setCoverPdfCache(voyageId: string, contentVersion: string, blob: Blob): Promise<void> {
  const db = await openDB()
  await wrap(tx(db, STORE_COVER_PDF_CACHE, 'readwrite').put({ voyageId, contentVersion, blob } satisfies CoverPdfCacheEntry))
}

export async function deleteCoverPdfCache(voyageId: string): Promise<void> {
  const db = await openDB()
  await wrap(tx(db, STORE_COVER_PDF_CACHE, 'readwrite').delete(voyageId))
}

export async function listCoverPdfCacheVersions(): Promise<Record<string, string>> {
  const db = await openDB()
  const all = await wrap<CoverPdfCacheEntry[]>(tx(db, STORE_COVER_PDF_CACHE, 'readonly').getAll())
  return Object.fromEntries(all.map(e => [e.voyageId, e.contentVersion]))
}

// ── Films ─────────────────────────────────────────────────────────────────────

/** Événement (window) envoyé quand un film est rangé dans un sillon ; `detail` : id du sillon. */
export const FILMS_CHANGED_EVENT = 'sillon-films-changed'

export async function addFilmToVoyage(
  voyageId: string,
  meta: Omit<VoyageFilm, 'id' | 'createdAt'>,
  blob?: Blob,
): Promise<VoyageFilm> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) throw new Error('Voyage introuvable')
    const film: VoyageFilm = { unseen: true, ...meta, id: uuid(), createdAt: new Date().toISOString() }
    if (blob) {
      const db = await openDB()
      await wrap(tx(db, STORE_BLOBS, 'readwrite').put(blob, film.id))
    }
    voyage.films.push(film)
    await saveVoyage(voyage)
    // Mes sillons déjà ouvert (film fini pendant qu'on y est) : la page se recharge (cf. VoyagesPage).
    window.dispatchEvent(new CustomEvent(FILMS_CHANGED_EVENT, { detail: voyageId }))
    return film
  })
}

export async function getFilmBlob(filmId: string): Promise<Blob | undefined> {
  const db = await openDB()
  return wrap<Blob | undefined>(tx(db, STORE_BLOBS, 'readonly').get(filmId))
}

/** Retire la marque « pas encore vu » d'un film (lu ou téléchargé). */
export async function markFilmSeen(voyageId: string, filmId: string): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    const film = voyage?.films.find(f => f.id === filmId)
    if (!voyage || !film?.unseen) return
    delete film.unseen
    await saveVoyage(voyage)
  })
}

export async function removeFilmFromVoyage(voyageId: string, filmId: string): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    voyage.films = voyage.films.filter(f => f.id !== filmId)
    await saveVoyage(voyage)
    const db = await openDB()
    await wrap(tx(db, STORE_BLOBS, 'readwrite').delete(filmId))
  })
}

// ── Photos ────────────────────────────────────────────────────────────────────

export async function addPhotoToVoyage(
  voyageId: string,
  meta: Omit<VoyagePhoto, 'id' | 'createdAt'>,
  blob: Blob,
): Promise<VoyagePhoto> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) throw new Error('Voyage introuvable')
    const photo: VoyagePhoto = { ...meta, id: uuid(), createdAt: new Date().toISOString() }
    const db = await openDB()
    await wrap(tx(db, STORE_PHOTO_BLOBS, 'readwrite').put(blob, photo.id))
    voyage.photos.push(photo)
    await saveVoyage(voyage)
    return photo
  })
}

/** Remplace l'image d'une photo existante (même id : compositions d'album inchangées). Sert à mettre
 * à jour les photos de la rando d'exemple (voir demoTrip.ts). */
export async function replacePhotoBlob(voyageId: string, photoId: string, blob: Blob): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const db = await openDB()
    await wrap(tx(db, STORE_PHOTO_BLOBS, 'readwrite').put(blob, photoId))
  })
}

export async function getPhotoBlob(photoId: string): Promise<Blob | undefined> {
  const db = await openDB()
  return wrap<Blob | undefined>(tx(db, STORE_PHOTO_BLOBS, 'readonly').get(photoId))
}

export async function removePhotoFromVoyage(voyageId: string, photoId: string): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    voyage.photos = voyage.photos.filter(p => p.id !== photoId)
    await saveVoyage(voyage)
    const db = await openDB()
    await wrap(tx(db, STORE_PHOTO_BLOBS, 'readwrite').delete(photoId))
  })
}

export async function updatePhotos(
  voyageId: string,
  patches: { photoId: string; patch: Partial<VoyagePhoto> }[],
): Promise<void> {
  return withVoyageLock(voyageId, async () => {
    const voyage = await getVoyage(voyageId)
    if (!voyage) return
    const patchMap = new Map(patches.map(p => [p.photoId, p.patch]))
    voyage.photos = voyage.photos.map(p => patchMap.has(p.id) ? { ...p, ...patchMap.get(p.id) } : p)
    await saveVoyage(voyage)
  })
}

/**
 * Réassocie les photos orphelines (sans trackId, héritées de l'ancien import de photos
 * au niveau du voyage) au tracé quand le voyage n'en compte qu'un seul, cas non ambigu.
 * Sans ça, ces photos restent invisibles dans l'album (filtré par tracé).
 */
export async function repairOrphanedPhotos(voyage: Voyage): Promise<Voyage> {
  if (voyage.tracks.length !== 1) return voyage
  const trackId = voyage.tracks[0].id
  // Avec un seul tracé, toute photo du voyage lui appartient forcément — qu'elle n'ait pas de
  // trackId (ancien import) ou qu'elle pointe vers un id de tracé disparu (re-import du GPX
  // ayant généré un nouvel id, orphelinant les photos déjà attachées à l'ancien).
  const orphaned = voyage.photos.filter(p => p.trackId !== trackId)
  if (orphaned.length === 0) return voyage
  await updatePhotos(voyage.id, orphaned.map(p => ({ photoId: p.id, patch: { trackId } })))
  return { ...voyage, photos: voyage.photos.map(p => p.trackId === trackId ? p : { ...p, trackId }) }
}

// ── Sauvegarde / restauration complète (tous les sillons, avec photos et films) ──
// Format dédié à la synchro manuelle entre appareils (via un dossier cloud partagé,
// pCloud/Drive/OneDrive/etc.) : les ids sont conservés pour que réimporter la même
// sauvegarde mette à jour les sillons existants (put/upsert)
// plutôt que de créer des doublons à chaque synchro.

const LS_LAST_BACKUP_AT = 'running:sillon-last-backup-at'
const LS_BACKUP_PENDING = 'running:sillon-backup-pending'

// localStorage plutôt que la DB : lu de façon synchrone par le rappel avant fermeture (beforeunload),
// qui n'a pas le temps d'attendre une lecture IndexedDB async.
function markBackupPending() {
  try { localStorage.setItem(LS_BACKUP_PENDING, '1') } catch { /* stockage indisponible (navigation privée) */ }
}

function markBackedUp() {
  try {
    localStorage.setItem(LS_LAST_BACKUP_AT, new Date().toISOString())
    localStorage.removeItem(LS_BACKUP_PENDING)
  } catch { /* stockage indisponible */ }
}

export function getBackupStatus(): { lastBackupAt: string | null; hasPendingChanges: boolean } {
  let lastBackupAt: string | null = null
  let hasPendingChanges = false
  try {
    lastBackupAt = localStorage.getItem(LS_LAST_BACKUP_AT)
    hasPendingChanges = localStorage.getItem(LS_BACKUP_PENDING) === '1'
  } catch { /* stockage indisponible */ }
  return { lastBackupAt, hasPendingChanges }
}

// fetch(dataUrl) plutôt qu'un décodage manuel plantait silencieusement sur certains WebView
// Android (Capacitor) pour les data URL volumineuses (films en base64) — d'où ce décodage
// base64 → Uint8Array qui ne dépend pas du support de fetch() pour le schéma data:.
// Toujours utilisé pour relire les anciennes sauvegardes .json (format v1).
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const match = dataUrl.match(/^data:([^;,]*);base64,([\s\S]*)$/)
  if (!match) throw new Error('Data URL invalide')
  const [, mime, base64] = match
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Uint8Array(len)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Format v1 (ancien) : un seul JSON, toutes les photos/films en base64. Conservé en LECTURE
// seule — ces .json existent déjà chez les utilisateurs. Sa restauration exige de charger tout
// le fichier dans une seule chaîne JS, impossible sur smartphone au-delà de ~256 Mo.
interface SillonBackupV1 {
  version: 1
  exportedAt: string
  voyages: Voyage[]
  photoBlobs: Record<string, string>
  filmBlobs: Record<string, string>
}

// Format v2 (actuel) : archive ZIP. manifest.json (voyages + types MIME) en première entrée,
// puis un binaire brut par photo (photos/<id>) et par film (films/<id>), stockés sans
// compression (médias déjà compressés). Restauration en flux, entrée par entrée : le pic
// mémoire vaut ≈ un seul média, plus la somme de toute la sauvegarde — d'où la levée de la
// limite qui bloquait la restauration sur smartphone.
interface BackupManifestV2 {
  format: 'sillon-backup'
  version: 2
  /** Appli d'origine (« running ») : une sauvegarde d'une autre déclinaison (Rando, Cyclo…) est refusée. */
  app?: string
  exportedAt: string
  voyages: Voyage[]
  photoTypes: Record<string, string>  // photoId -> type MIME
  filmTypes: Record<string, string>   // filmId  -> type MIME
}

const MANIFEST_NAME = 'manifest.json'

export interface PreparedBackup { blob: Blob; filename: string }

// Rassemble tout le contenu (potentiellement long : lecture de toutes les photos/films) sans
// toucher à l'enregistrement — séparé de saveBackup() pour que l'appel à showSaveFilePicker/
// navigator.share() puisse être déclenché par un clic frais (voir saveBackup).
export async function prepareBackup(onProgress?: (done: number, total: number) => void): Promise<PreparedBackup> {
  const { Zip, ZipPassThrough } = await import('fflate')
  const voyages = await getAllVoyages()
  const total = voyages.reduce((n, v) => n + v.photos.length + v.films.length, 0)
  let done = 0
  onProgress?.(0, total)

  // Passe 1 : relève les types MIME (simple propriété du Blob, aucun décodage) pour le
  // manifeste. Les blobs ne sont pas conservés — ils seront relus un par un en passe 2.
  const photoTypes: Record<string, string> = {}
  const filmTypes: Record<string, string> = {}
  for (const voyage of voyages) {
    for (const photo of voyage.photos) {
      const blob = await getPhotoBlob(photo.id)
      if (blob) photoTypes[photo.id] = blob.type || 'application/octet-stream'
    }
    for (const film of voyage.films) {
      const blob = await getFilmBlob(film.id)
      if (blob) filmTypes[film.id] = blob.type || 'application/octet-stream'
    }
  }
  const manifest: BackupManifestV2 = {
    format: 'sillon-backup', version: 2, app: APP_ID, exportedAt: new Date().toISOString(),
    voyages, photoTypes, filmTypes,
  }

  // Passe 2 : écrit l'archive. fflate pousse les octets au fil de l'eau ; on les accumule pour
  // bâtir le Blob final (que le navigateur peut adosser au disque).
  const parts: Uint8Array[] = []
  let zipError: unknown = null
  const zip = new Zip((err, chunk) => {
    if (err) { zipError = zipError ?? err; return }
    if (chunk.length) parts.push(chunk)
  })
  const addEntry = (name: string, bytes: Uint8Array) => {
    const entry = new ZipPassThrough(name)  // stocké, pas de compression
    zip.add(entry)
    entry.push(bytes, true)
    if (zipError) throw zipError
  }

  addEntry(MANIFEST_NAME, new TextEncoder().encode(JSON.stringify(manifest)))
  for (const voyage of voyages) {
    for (const photo of voyage.photos) {
      const blob = await getPhotoBlob(photo.id)
      if (blob) addEntry(`photos/${photo.id}`, new Uint8Array(await blob.arrayBuffer()))
      onProgress?.(++done, total)
    }
    for (const film of voyage.films) {
      const blob = await getFilmBlob(film.id)
      if (blob) addEntry(`films/${film.id}`, new Uint8Array(await blob.arrayBuffer()))
      onProgress?.(++done, total)
    }
  }
  zip.end()
  if (zipError) throw zipError

  const blob = new Blob(parts as BlobPart[], { type: 'application/zip' })
  // Heure locale (pas toISOString, qui est en UTC) — "h" au lieu de ":", invalide dans un nom
  // de fichier Windows.
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}h${pad(now.getMinutes())}`
  const filename = `sillonphane-running-sauvegarde-${stamp}.zip`
  return { blob, filename }
}

// À appeler depuis un gestionnaire de clic direct (pas après un await) : showSaveFilePicker et
// navigator.share exigent tous deux un geste utilisateur récent ("transient activation", ~quelques
// secondes sous Chrome/Android) — si prepareBackup() a pris trop de temps (beaucoup de photos), ce
// geste a expiré et l'appel échoue silencieusement, d'où la séparation en deux étapes.
export async function saveBackup(prepared: PreparedBackup): Promise<'saved' | 'cancelled'> {
  const { blob, filename } = prepared
  const result = await saveFileWithPicker(blob, filename, {
    mimeType: 'application/zip', extension: '.zip', description: `Sauvegarde ${APP_NAME}`,
    // .zip figure dans la liste d'extensions "sûres" de canShare() sous Chrome (au contraire de
    // .json) : le partage natif Android peut donc servir le fichier tel quel, sans détour.
  })
  if (result === 'saved') markBackedUp()
  return result
}

// Erreur de restauration due à la taille du fichier : file.text() rejette, ou JSON.parse lève un
// RangeError « Invalid string length », quand la sauvegarde (photos/films en base64) dépasse ce que
// le moteur JS peut tenir en une seule chaîne — plafond bien plus bas sur smartphone (WebView
// Android) que sur ordinateur.
/** Sauvegarde venant d'une autre déclinaison : on explique pourquoi elle est refusée. */
function wrongAppMessage(app: string): string {
  const origin = APP_NAMES[app]
    ? `Cette sauvegarde vient de ${APP_NAMES[app]}`
    : `Cette sauvegarde ne vient pas de ${APP_NAME} (autre appli Sillonphane, Rando par exemple, ou ancienne version)`
  return `${origin} : elle ne peut pas être restaurée dans ${APP_NAME}.\n\n` +
    `Chaque appli Sillonphane (Rando, Running, Cyclo…) garde ses propres sillons. Restaurez ce fichier dans l'appli qui l'a créé.`
}

const TOO_BIG_MESSAGE =
  "Fichier trop volumineux pour être restauré sur ce téléphone.\n\n" +
  "La sauvegarde contient trop de photos/films pour la mémoire de l'appareil. " +
  "Restaurez-la depuis un ordinateur (navigateur Chrome ou Edge)."

function isSizeError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err).toLowerCase()
  return err instanceof RangeError
    || msg.includes('invalid string length')
    || msg.includes('string length')
    || msg.includes('out of memory')
    || msg.includes('allocation')
}

export async function importAllBackup(file: File, onProgress?: (done: number, total: number) => void): Promise<number> {
  // Signature ZIP « PK\x03\x04 » → format v2 (lecture en flux). Sinon, ancien JSON v1.
  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  } catch (err) {
    throw new Error(`Lecture du fichier impossible — ${errText(err)}`, { cause: err })
  }
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  return isZip
    ? importZipBackup(file, onProgress)
    : importLegacyJsonBackup(file, onProgress)
}

// Restauration du format v2 : le fichier est lu par tranches et donné au décompresseur au fur
// et à mesure. Chaque entrée (manifeste, puis un média à la fois) est écrite en base locale
// puis libérée avant la suivante — le pic mémoire ne dépend plus de la taille totale.
async function importZipBackup(file: File, onProgress?: (done: number, total: number) => void): Promise<number> {
  const { Unzip, UnzipInflate } = await import('fflate')
  const db = await openDB()

  // Objet-conteneur plutôt qu'un `let` : TypeScript ne « rétrécit » pas les affectations faites
  // dans une closure (onfile/ondata), il croirait manifest toujours nul.
  const state: { manifest: BackupManifestV2 | null; parseError: unknown; wrongApp: string | null; total: number; done: number } = {
    manifest: null, parseError: null, wrongApp: null, total: 0, done: 0,
  }

  // Écritures IndexedDB sérialisées, avec contre-pression : on arrête d'alimenter le
  // décompresseur tant que trop d'entrées attendent d'être écrites — sinon les blobs
  // s'accumuleraient en mémoire, précisément ce qu'on cherche à éviter.
  let chain: Promise<void> = Promise.resolve()
  let queued = 0
  const MAX_QUEUED = 3

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (entry) => {
    const chunks: Uint8Array[] = []
    entry.ondata = (err, chunk, final) => {
      if (err) { state.parseError = state.parseError ?? err; return }
      if (chunk.length) chunks.push(chunk)
      if (!final) return
      if (state.wrongApp) return  // sauvegarde refusée : on n'écrit plus rien
      const bytes = concatBytes(chunks)
      chunks.length = 0

      if (entry.name === MANIFEST_NAME) {
        try {
          state.manifest = JSON.parse(new TextDecoder().decode(bytes)) as BackupManifestV2
        } catch (e) { state.parseError = state.parseError ?? e; return }
        const mf = state.manifest
        // Sauvegarde d'une autre appli (Rando, Cyclo…) ou d'avant le marquage : refusée avant d'écrire quoi que ce soit.
        if (mf.app !== APP_ID) { state.wrongApp = mf.app ?? 'inconnue'; state.parseError = new Error('wrong-app'); return }
        state.total = (Array.isArray(mf.voyages) ? mf.voyages.length : 0)
          + Object.keys(mf.photoTypes ?? {}).length
          + Object.keys(mf.filmTypes ?? {}).length
        onProgress?.(0, state.total)
        return
      }

      const m = entry.name.match(/^(photos|films)\/(.+)$/)
      if (!m) return  // entrée inattendue : ignorée
      const [, kind, id] = m
      queued++
      chain = chain.then(async () => {
        const types = kind === 'photos' ? state.manifest?.photoTypes : state.manifest?.filmTypes
        const type = types?.[id] || 'application/octet-stream'
        const store = kind === 'photos' ? STORE_PHOTO_BLOBS : STORE_BLOBS
        await wrap(tx(db, store, 'readwrite').put(new Blob([bytes as BlobPart], { type }), id))
        queued--
        onProgress?.(++state.done, state.total)
      })
    }
    entry.start()
  }

  try {
    if (typeof file.stream === 'function') {
      const reader = file.stream().getReader()
      try {
        for (;;) {
          while (queued >= MAX_QUEUED && !state.parseError) await chain
          if (state.parseError) break
          const { done: rDone, value } = await reader.read()
          if (rDone) { unzip.push(new Uint8Array(0), true); break }
          unzip.push(value, false)
        }
      } finally {
        reader.releaseLock()
      }
    } else {
      // WebView sans Blob.stream() : un seul Uint8Array (jusqu'à 2 Go, sans l'inflation base64
      // ni le doublement de JSON.parse de l'ancien format).
      unzip.push(new Uint8Array(await file.arrayBuffer()), true)
    }
    await chain
  } catch (err) {
    if (isSizeError(err)) throw new Error(TOO_BIG_MESSAGE, { cause: err })
    throw new Error(`Restauration interrompue — ${errText(err)}`, { cause: err })
  }

  if (state.wrongApp) throw new Error(wrongAppMessage(state.wrongApp))
  if (state.parseError) {
    if (isSizeError(state.parseError)) throw new Error(TOO_BIG_MESSAGE)
    throw new Error(`Archive illisible (fichier .zip incomplet ?) — ${errText(state.parseError)}`)
  }
  const manifest = state.manifest
  if (!manifest) throw new Error("Ce fichier .zip n'est pas une sauvegarde Sillon (manifeste absent).")
  if (!Array.isArray(manifest.voyages)) throw new Error('Sauvegarde Sillon incomplète (liste des sillons absente).')

  for (const voyage of manifest.voyages) {
    await saveVoyage(voyage)
    onProgress?.(++state.done, state.total)
  }
  markBackedUp() // les données locales reflètent maintenant cette sauvegarde, rien à re-synchroniser
  return manifest.voyages.length
}

// Restauration des anciennes sauvegardes .json (format v1). Charge tout le fichier dans une
// seule chaîne — d'où l'échec « fichier trop volumineux » sur smartphone au-delà de ~256 Mo,
// que le format v2 supprime.
async function importLegacyJsonBackup(file: File, onProgress?: (done: number, total: number) => void): Promise<number> {
  let text: string
  try {
    text = await file.text()
  } catch (err) {
    if (isSizeError(err)) throw new Error(TOO_BIG_MESSAGE, { cause: err })
    throw new Error(`Lecture du fichier impossible — ${errText(err)}`, { cause: err })
  }
  if (!text.trim()) throw new Error('Le fichier est vide.')
  // L'ancien format .json n'a été produit que par Sillonphane-Rando : jamais restauré dans Running.
  throw new Error(wrongAppMessage('rando'))
  let backup: SillonBackupV1
  try {
    backup = JSON.parse(text) as SillonBackupV1
  } catch (err) {
    if (isSizeError(err)) throw new Error(TOO_BIG_MESSAGE, { cause: err })
    throw new Error(`Le fichier n'est pas un JSON valide (tronqué à l'enregistrement, ou ce n'est pas une sauvegarde Sillon) — ${errText(err)}`, { cause: err })
  }
  if (!backup || !Array.isArray(backup.voyages)) throw new Error("Ce fichier n'a pas la structure d'une sauvegarde Sillon.")
  const db = await openDB()
  const photoEntries = Object.entries(backup.photoBlobs ?? {})
  const filmEntries = Object.entries(backup.filmBlobs ?? {})
  const total = photoEntries.length + filmEntries.length + backup.voyages.length
  let done = 0
  onProgress?.(0, total)
  for (const [photoId, dataUrl] of photoEntries) {
    const blob = await dataUrlToBlob(dataUrl)
    await wrap(tx(db, STORE_PHOTO_BLOBS, 'readwrite').put(blob, photoId))
    onProgress?.(++done, total)
  }
  for (const [filmId, dataUrl] of filmEntries) {
    const blob = await dataUrlToBlob(dataUrl)
    await wrap(tx(db, STORE_BLOBS, 'readwrite').put(blob, filmId))
    onProgress?.(++done, total)
  }
  for (const voyage of backup.voyages) {
    await saveVoyage(voyage)
    onProgress?.(++done, total)
  }
  markBackedUp() // les données locales reflètent maintenant cette sauvegarde, rien à re-synchroniser
  return backup.voyages.length
}
