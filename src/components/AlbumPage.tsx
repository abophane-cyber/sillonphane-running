import { useEffect, useMemo, useRef, useState } from 'react'
import * as exifr from 'exifr'
import type { Voyage, VoyageTrack, VoyagePhoto, ComposedAlbumPage } from '../types'
import {
  getAllVoyages, addPhotoToVoyage, removePhotoFromVoyage, getPhotoBlob, updatePhotos,
  saveTrackAlbumPages, renameTrack, saveVoyageCoverPages, saveVoyageAlbumPageCm, saveVoyageWrapPageCount, repairOrphanedPhotos, getBackupStatus,
} from '../lib/voyageDB'
import { hashFileExact } from '../lib/photoHash'
import { AlbumPageEditor } from './AlbumPageEditor'
import { VoyageCoverEditor } from './VoyageCoverEditor'
import { MultiAlbumExport } from './MultiAlbumExport'
import { AppLogoIcon } from './AppLogoIcon'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { useBackupControls } from '../hooks/useBackupControls'
import { BackupOverlay } from './BackupOverlay'
import { sanitizeTrackPages } from '../lib/albumPages'
import { PrintOfferOverlay } from './PrintOfferOverlay'
import { DEFAULT_ALBUM_PAGE_CM } from '../lib/clientPdfExport'
import { PROMO_SCHEDULE, currentPromo } from '../lib/printPartners'
import { PRINT_PROFILES, getPrintProfile, wrapSpreadForPages, snapWrapPageCount, pagesToPad, type PrintProfile } from '../lib/printProfiles'

export interface SelectedTrack {
  voyageId: string
  voyageName: string
  track: VoyageTrack
  photos: VoyagePhoto[]
}

interface Props {
  onBack: (track?: VoyageTrack) => void
  initialTrack?: { voyageId: string; trackId: string } | null
}

function formatDist(m?: number) {
  if (!m) return '—'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function sortTracksByDate(tracks: VoyageTrack[]): VoyageTrack[] {
  return [...tracks].sort((a, b) => (a.date || a.addedAt).localeCompare(b.date || b.addedAt))
}
function sortPhotosByDate(photos: VoyagePhoto[]): VoyagePhoto[] {
  return [...photos].sort((a, b) => (a.takenAt || a.createdAt).localeCompare(b.takenAt || b.createdAt))
}

/** Nom court d'un profil d'imprimeur, pour les cartes et résumés. */
function profileName(p: PrintProfile): string {
  return p.id === 'custom' ? 'PDF libre' : p.label.replace(' — ', ' ')
}

/** Règle de fabrication du profil, en une phrase (écran ① « Le livre »). */
function profileRule(p: PrintProfile): string {
  if (p.coverMode === 'wrap-spread') return 'Deux fichiers PDF : la couverture (feuille d\'un seul tenant avec le dos) et les pages intérieures, de 28 à 200 pages par multiples de 4.'
  if (p.coverMode === 'inline-first-last') return 'Un seul fichier PDF : couverture en 1re page, dos en dernière, pages intérieures complétées à un multiple de 4.'
  return 'Un seul fichier PDF, à imprimer où vous voulez : couverture et dos en tête du fichier.'
}

/** Réduction offerte chez l'imprimeur du profil, sans jamais montrer le code lui-même : il n'est
 * donné qu'en fin d'export (PrintOfferOverlay). Le pourcentage (« -15 % ») n'est affiché qu'à
 * l'écran Impression (`withPct`) ; à l'écran Le livre on signale seulement la réduction. Vide si
 * aucun code en cours. */
function promoText(p: PrintProfile, withPct = false): string | null {
  if (!p.partnerId) return null
  const promo = currentPromo(PROMO_SCHEDULE, p.partnerId)
  return promo ? `code de réduction${withPct && promo.label ? ` ${promo.label}` : ''}` : null
}

function fmtCm(n: number): string {
  return String(n).replace('.', ',')
}

/** « 3 pages blanches » : chaque mot prend un s au pluriel. */
function plural(n: number, words: string): string {
  return `${n} ${n > 1 ? words.split(' ').map(w => `${w}s`).join(' ') : words}`
}

export function AlbumPage({ onBack, initialTrack }: Props) {
  const [voyages, setVoyages] = useState<Voyage[]>([])
  const [loading, setLoading] = useState(true)
  // Parcours en 3 écrans : ① le livre (sillon + imprimeur) → ② le contenu → ③ l'impression.
  const [step, setStep] = useState<1 | 2 | 3>(1)
  // Un album = un sillon : celui choisi à l'écran ①.
  const [bookVoyageId, setBookVoyageId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set()) // étapes incluses dans le livre — clé = voyageId::trackId
  const [openPhotoTracks, setOpenPhotoTracks] = useState<Set<string>>(new Set()) // étapes dont les photos sont dépliées
  const [scrollToTrackKey, setScrollToTrackKey] = useState<string | null>(null) // étape à amener à l'écran (arrivée depuis Mes sillons)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Set<string>>(new Set())
  const [uploadingTrackKey, setUploadingTrackKey] = useState<string | null>(null)
  // Étape en cours de renommage (clé voyageId:trackId) et texte saisi.
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<{ voyageId: string; trackId: string } | null>(null)
  const captionSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set())
  const lastClickedPhotoRef = useRef<string | null>(null)
  const shiftHeldRef = useRef(false)
  const dragSelectRef = useRef<{ dragging: boolean; value: boolean; startId: string | null }>({ dragging: false, value: true, startId: null })
  const [preview, setPreview] = useState<{ voyageId: string; photos: VoyagePhoto[]; index: number } | null>(null)
  const [editingTrack, setEditingTrack] = useState<{ voyage: Voyage; track: VoyageTrack } | null>(null)
  const [editingVoyageCover, setEditingVoyageCover] = useState<Voyage | null>(null)
  const [coverEditorSide, setCoverEditorSide] = useState<'cover' | 'backcover'>('cover')
  const [multiAlbumOpen, setMultiAlbumOpen] = useState(false)
  // Export WhiteWall en deux fichiers enchaînés : la couverture d'abord, puis les pages intérieures.
  const [wrapChain, setWrapChain] = useState<'cover' | 'interior' | null>(null)
  // « PDF déjà créé ? » : récapitulatif imprimeur (liens + code promo) sans rien re-générer.
  const [printOffer, setPrintOffer] = useState<{ partnerId?: string; demo: boolean } | null>(null)
  const existingPdfInputRef = useRef<HTMLInputElement>(null)
  // Sillon dont la couverture et le dos partent à l'export (posé par handleCreatePdfs).
  const [coverVoyageId, setCoverVoyageId] = useState<string | null>(null)
  const bookVoyage = voyages.find(v => v.id === bookVoyageId)
  const { backupBusy, backupInputRef, overlayProps, handleExportBackup, handleImportBackup } = useBackupControls({
    onImported: async () => {
      const repaired = await Promise.all((await getAllVoyages()).map(repairOrphanedPhotos))
      setVoyages(repaired.filter(v => v.tracks.length > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    },
  })

  // Glisser-cocher : maintenir le clic sur une case et survoler d'autres photos les ajoute (ou
  // retire) toutes à la sélection en une fois, pratique pour sélectionner un groupe visuel de photos.
  useEffect(() => {
    function onMouseUp() { dragSelectRef.current.dragging = false }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  // Taille de page de la vue d'album ouverte (éditeur, couverture, aperçu/export PDF) : on pose la
  // géométrie réelle sur <html> — variables CSS --alb-page-w/h/ar (feuille, aperçus réduits,
  // vignette de couverture), data-album-orientation (mise en page de la page résumé) et un @page
  // dynamique (impression navigateur). App.css garde un défaut sur :root quand aucune vue n'est
  // ouverte.
  const openAlbumVoyageId =
    editingTrack ? editingTrack.voyage.id
    : editingVoyageCover ? editingVoyageCover.id
    : multiAlbumOpen ? (getSelectedTracks()[0]?.voyageId ?? coverVoyageId ?? null)
    : null
  const openPage = openAlbumVoyageId ? voyagePageCm(openAlbumVoyageId) : null
  useEffect(() => {
    const el = document.documentElement
    if (!openPage) return
    const { w, h } = openPage
    const px = (cm: number) => `${(cm / 2.54 * 96).toFixed(2)}px` // cm → px à 96 dpi
    el.style.setProperty('--alb-page-w', px(w))
    el.style.setProperty('--alb-page-h', px(h))
    el.style.setProperty('--alb-page-ar', `${w} / ${h}`)
    if (h > w) el.dataset.albumOrientation = 'portrait'
    else delete el.dataset.albumOrientation
    const styleEl = document.createElement('style')
    styleEl.textContent = `@page { size: ${w}cm ${h}cm; margin: 0 }`
    document.head.appendChild(styleEl)
    return () => {
      el.style.removeProperty('--alb-page-w')
      el.style.removeProperty('--alb-page-h')
      el.style.removeProperty('--alb-page-ar')
      delete el.dataset.albumOrientation
      styleEl.remove()
    }
    // openPage n'est utilisé que via ses primitives w/h (seules qui comptent pour la géométrie).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPage?.w, openPage?.h])

  function handlePhotoDragStart(photoId: string) {
    dragSelectRef.current = { dragging: true, value: !selectedPhotoIds.has(photoId), startId: photoId }
  }

  function handlePhotoDragEnter(photoId: string) {
    if (!dragSelectRef.current.dragging || photoId === dragSelectRef.current.startId) return
    const value = dragSelectRef.current.value
    setSelectedPhotoIds(prev => {
      const next = new Set(prev)
      if (value) next.add(photoId); else next.delete(photoId)
      return next
    })
  }

  useEffect(() => {
    getAllVoyages().then(async v => {
      const repaired = await Promise.all(v.map(repairOrphanedPhotos))
      const sorted = repaired
        .filter(voy => voy.tracks.length > 0)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setVoyages(sorted)
      setLoading(false)
      // « Créer l'album » depuis Mes sillons : on ouvre directement le contenu du livre de ce
      // sillon, l'étape amenée à l'écran avec ses photos dépliées. Un seul sillon : il est
      // choisi d'office.
      const voy = initialTrack ? sorted.find(x => x.id === initialTrack.voyageId) : (sorted.length === 1 ? sorted[0] : undefined)
      if (!voy) return
      chooseBook(voy)
      const track = initialTrack ? voy.tracks.find(t => t.id === initialTrack.trackId) : undefined
      if (track) {
        const k = key(voy.id, track.id)
        setOpenPhotoTracks(new Set([k]))
        setScrollToTrackKey(k)
        setStep(2)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Clé stable représentant l'ensemble des photos présentes (peu importe leurs autres champs) :
  // setVoyages(prev => prev.map(...)) crée une nouvelle référence de tableau pour la moindre
  // édition (légende, "Garder"…), ce qui recréerait sinon toutes les URLs de toutes les photos de
  // tous les voyages à chaque frappe. En ne dépendant que de cette clé, l'effet ne se relance que
  // quand des photos sont réellement ajoutées/supprimées.
  const photoIdsKey = useMemo(() => voyages.flatMap(v => v.photos.map(p => p.id)).join(','), [voyages])

  // Charge les miniatures de toutes les photos (et libère les anciennes URLs).
  // Une photo dont le blob est introuvable (métadonnée orpheline, ex. après un import
  // interrompu) est répertoriée à part pour pouvoir être nettoyée en un clic.
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    ;(async () => {
      const entries: [string, string][] = []
      const broken: string[] = []
      for (const v of voyages) {
        for (const p of v.photos) {
          const blob = await getPhotoBlob(p.id)
          if (blob) {
            const url = URL.createObjectURL(blob)
            urls.push(url)
            entries.push([p.id, url])
          } else {
            broken.push(p.id)
          }
        }
      }
      if (!cancelled) {
        setPhotoUrls(Object.fromEntries(entries))
        setBrokenPhotoIds(new Set(broken))
      }
    })()
    return () => {
      cancelled = true
      urls.forEach(u => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIdsKey])

  // Navigation clavier dans la visionneuse
  useEffect(() => {
    if (!preview) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreview(null)
      if (e.key === 'ArrowLeft') setPreview(p => p && p.index > 0 ? { ...p, index: p.index - 1 } : p)
      if (e.key === 'ArrowRight') setPreview(p => p && p.index < p.photos.length - 1 ? { ...p, index: p.index + 1 } : p)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview])

  // Synchronise `wrapPageCount` (nombre de pages déclaré à WhiteWall, qui pilote la largeur du dos
  // de la couverture) avec le contenu réel dès qu'il change. Pas de saisie manuelle possible pour
  // cette valeur : la largeur du dos est une conséquence physique du nombre de pages réellement
  // imprimées chez WhiteWall, pas un réglage qu'on peut choisir indépendamment côté app.
  const wrapAutoSyncedInteriorRef = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    voyages.forEach(v => {
      const profile = getPrintProfile(v.printProfileId)
      if (profile.coverMode !== 'wrap-spread') return
      const interior = v.tracks.reduce(
        (sum, t) => sum + Math.max(1, sanitizeTrackPages(t.albumPages ?? []).length), 0,
      )
      if (interior === 0 || wrapAutoSyncedInteriorRef.current.get(v.id) === interior) return
      wrapAutoSyncedInteriorRef.current.set(v.id, interior)
      const target = snapWrapPageCount(profile, interior + pagesToPad(interior, profile.pageCount))
      if (v.wrapPageCount !== target) handleSetVoyageWrapPages(v.id, target)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voyages])

  function handleUploadClick(voyageId: string, trackId: string) {
    uploadTargetRef.current = { voyageId, trackId }
    photoInputRef.current?.click()
  }

  async function handlePhotoFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const target = uploadTargetRef.current
    const allFiles = Array.from(e.target.files ?? [])
    // Sans attribut accept sur le champ (voir plus bas), on filtre les images ici plutôt que de
    // laisser le système le faire — nécessaire pour que les fournisseurs de fichiers (pCloud,
    // Drive…) apparaissent dans le sélecteur natif Android.
    const files = allFiles.filter(f => f.type.startsWith('image/'))
    const nonImageCount = allFiles.length - files.length
    if (!target || files.length === 0) {
      if (nonImageCount > 0) alert('Aucune image sélectionnée — seuls les fichiers image sont acceptés.')
      return
    }
    const trackKey = key(target.voyageId, target.trackId)
    setUploadingTrackKey(trackKey)
    try {
      const voyage = voyages.find(v => v.id === target.voyageId)
      const existingHashes = new Set((voyage?.photos ?? []).map(p => p.hash).filter((h): h is string => !!h))
      const newPhotos: VoyagePhoto[] = []
      let skipped = 0
      for (const file of files) {
        const hash = await hashFileExact(file)
        if (existingHashes.has(hash)) { skipped++; continue }
        existingHashes.add(hash)
        const exif = await exifr.parse(file, ['DateTimeOriginal']).catch(() => undefined)
        const entry = await addPhotoToVoyage(target.voyageId, {
          name: file.name,
          trackId: target.trackId,
          sizeBytes: file.size,
          takenAt: exif?.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toISOString() : undefined,
          hash,
        }, file)
        newPhotos.push(entry)
      }
      if (newPhotos.length > 0) {
        setVoyages(prev => prev.map(v => v.id === target.voyageId ? { ...v, photos: [...v.photos, ...newPhotos] } : v))
      }
      const messages: string[] = []
      if (skipped > 0) messages.push(`${skipped} photo${skipped > 1 ? 's' : ''} déjà présente${skipped > 1 ? 's' : ''}, ignorée${skipped > 1 ? 's' : ''}`)
      if (nonImageCount > 0) messages.push(`${nonImageCount} fichier${nonImageCount > 1 ? 's' : ''} non-image ignoré${nonImageCount > 1 ? 's' : ''}`)
      if (messages.length > 0) alert(messages.join(' — ') + '.')
    } finally {
      setUploadingTrackKey(null)
      uploadTargetRef.current = null
      e.target.value = ''
    }
  }

  async function handleDeletePhoto(voyageId: string, photo: VoyagePhoto): Promise<boolean> {
    if (!confirm(`Supprimer la photo "${photo.name}" ?`)) return false
    await removePhotoFromVoyage(voyageId, photo.id)
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, photos: v.photos.filter(p => p.id !== photo.id) } : v))
    setSelectedPhotoIds(prev => { const next = new Set(prev); next.delete(photo.id); return next })
    return true
  }

  async function handleDeleteUnusedPhotos(voyageId: string, photoIds: string[]) {
    for (const photoId of photoIds) await removePhotoFromVoyage(voyageId, photoId)
    const deleted = new Set(photoIds)
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, photos: v.photos.filter(p => !deleted.has(p.id)) } : v))
  }

  async function handleKeepPhoto(voyageId: string, photoId: string) {
    await updatePhotos(voyageId, [{ photoId, patch: { aiKeep: true } }])
    setVoyages(prev => prev.map(v => v.id === voyageId
      ? { ...v, photos: v.photos.map(p => p.id === photoId ? { ...p, aiKeep: true } : p) }
      : v))
  }

  // Mise à jour locale immédiate (frappe fluide) + sauvegarde différée (debounce),
  // sans dépendre de la perte de focus qui n'est pas toujours fiable
  function handleCaptionChange(voyageId: string, photoId: string, value: string) {
    setVoyages(prev => prev.map(v => v.id === voyageId
      ? { ...v, photos: v.photos.map(p => p.id === photoId ? { ...p, aiCaption: value } : p) }
      : v))
    clearTimeout(captionSaveTimers.current[photoId])
    captionSaveTimers.current[photoId] = setTimeout(() => {
      handleCaptionSave(voyageId, photoId, value)
    }, 600)
  }

  async function handleCaptionSave(voyageId: string, photoId: string, value: string) {
    clearTimeout(captionSaveTimers.current[photoId])
    await updatePhotos(voyageId, [{ photoId, patch: { aiCaption: value.trim() || undefined } }])
  }

  async function handleClearCaption(voyageId: string, photoId: string) {
    clearTimeout(captionSaveTimers.current[photoId])
    setVoyages(prev => prev.map(v => v.id === voyageId
      ? { ...v, photos: v.photos.map(p => p.id === photoId ? { ...p, aiCaption: undefined } : p) }
      : v))
    await updatePhotos(voyageId, [{ photoId, patch: { aiCaption: undefined } }])
  }

  function togglePhotoSelected(photoId: string) {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId)
      return next
    })
  }

  // Clic normal : bascule une photo. Maj+clic : sélectionne toute la plage depuis le dernier clic
  // (dans le même tracé), comme dans un sélecteur de fichiers classique.
  function handlePhotoCheckboxChange(trackPhotos: VoyagePhoto[], photoId: string) {
    if (shiftHeldRef.current && lastClickedPhotoRef.current) {
      const ids = trackPhotos.map(p => p.id)
      const lastIdx = ids.indexOf(lastClickedPhotoRef.current)
      const curIdx = ids.indexOf(photoId)
      if (lastIdx !== -1 && curIdx !== -1) {
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx]
        const rangeIds = ids.slice(from, to + 1)
        setSelectedPhotoIds(prev => {
          const next = new Set(prev)
          rangeIds.forEach(id => next.add(id))
          return next
        })
        lastClickedPhotoRef.current = photoId
        return
      }
    }
    togglePhotoSelected(photoId)
    lastClickedPhotoRef.current = photoId
  }

  function handleSelectAllTrackPhotos(trackPhotos: VoyagePhoto[]) {
    const allSelected = trackPhotos.length > 0 && trackPhotos.every(p => selectedPhotoIds.has(p.id))
    setSelectedPhotoIds(prev => {
      const next = new Set(prev)
      trackPhotos.forEach(p => allSelected ? next.delete(p.id) : next.add(p.id))
      return next
    })
  }

  async function handleDeleteSelectedPhotos(voyage: Voyage, trackPhotos: VoyagePhoto[]) {
    const toDelete = trackPhotos.filter(p => selectedPhotoIds.has(p.id))
    if (toDelete.length === 0) return
    if (!confirm(`Supprimer ${toDelete.length} photo${toDelete.length > 1 ? 's' : ''} ?`)) return
    for (const p of toDelete) {
      await removePhotoFromVoyage(voyage.id, p.id)
    }
    const deletedIds = new Set(toDelete.map(p => p.id))
    setVoyages(prev => prev.map(v => v.id === voyage.id ? { ...v, photos: v.photos.filter(p => !deletedIds.has(p.id)) } : v))
    setSelectedPhotoIds(prev => {
      const next = new Set(prev)
      deletedIds.forEach(id => next.delete(id))
      return next
    })
  }

  // Retire les photos dont l'image n'a jamais pu être retrouvée (métadonnée orpheline sans
  // blob associé) : elles bloquent le hash à l'import ("déjà présente") sans jamais s'afficher.
  async function handleDeleteBrokenPhotos(voyage: Voyage, trackPhotos: VoyagePhoto[]) {
    const toDelete = trackPhotos.filter(p => brokenPhotoIds.has(p.id))
    if (toDelete.length === 0) return
    if (!confirm(`Supprimer ${toDelete.length} photo${toDelete.length > 1 ? 's' : ''} sans image (jamais affichée) ?`)) return
    for (const p of toDelete) {
      await removePhotoFromVoyage(voyage.id, p.id)
    }
    const deletedIds = new Set(toDelete.map(p => p.id))
    setVoyages(prev => prev.map(v => v.id === voyage.id ? { ...v, photos: v.photos.filter(p => !deletedIds.has(p.id)) } : v))
    setBrokenPhotoIds(prev => {
      const next = new Set(prev)
      deletedIds.forEach(id => next.delete(id))
      return next
    })
  }

  async function handleSaveAlbumPages(voyageId: string, trackId: string, pages: ComposedAlbumPage[]) {
    const albumContentVersion = await saveTrackAlbumPages(voyageId, trackId, pages)
    const albumUpdatedAt = new Date().toISOString()
    setVoyages(prev => prev.map(v => v.id === voyageId
      ? { ...v, tracks: v.tracks.map(t => t.id === trackId ? { ...t, albumPages: pages, albumUpdatedAt, albumContentVersion } : t) }
      : v))
  }

  /** Renomme l'étape : le nouveau nom devient le titre de ses pages d'album. */
  async function handleRenameTrack(voyageId: string, trackId: string, raw: string) {
    setRenaming(null)
    const name = raw.trim()
    const current = voyages.find(v => v.id === voyageId)?.tracks.find(t => t.id === trackId)?.name
    if (!name || name === current) return
    const albumContentVersion = await renameTrack(voyageId, trackId, name)
    setVoyages(prev => prev.map(v => v.id === voyageId
      ? { ...v, tracks: v.tracks.map(t => t.id === trackId ? { ...t, name, albumContentVersion } : t) }
      : v))
  }

  async function handleSaveVoyageCoverPages(
    voyageId: string, coverPage: ComposedAlbumPage | undefined, backCoverPage: ComposedAlbumPage | undefined,
  ) {
    const coverContentVersion = await saveVoyageCoverPages(voyageId, coverPage, backCoverPage)
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, coverPage, backCoverPage, coverContentVersion } : v))
    setEditingVoyageCover(v => v && v.id === voyageId ? { ...v, coverPage, backCoverPage } : v)
  }

  /** Photos chargées depuis l'éditeur couverture/dos — déjà enregistrées en base par le composant
   * (addPhotoToVoyage), il ne reste qu'à les répercuter dans l'état local. */
  function handleVoyagePhotosAdded(voyageId: string, newPhotos: VoyagePhoto[], urls: Record<string, string>) {
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, photos: [...v.photos, ...newPhotos] } : v))
    setPhotoUrls(prev => ({ ...prev, ...urls }))
    setEditingVoyageCover(v => v && v.id === voyageId ? { ...v, photos: [...v.photos, ...newPhotos] } : v)
  }

  function handleBack() {
    // Bouton « Retour » de l'en-tête : revient d'abord à l'écran précédent du parcours.
    if (step > 1) { setStep(step === 3 ? 2 : 1); return }
    if (getBackupStatus().hasPendingChanges && !confirm('Modifications non sauvegardées. Quitter sans sauvegarder ?')) return
    onBack(getSelectedTracks()[0]?.track)
  }

  function key(voyageId: string, trackId: string) { return `${voyageId}::${trackId}` }

  /** Taille de page d'album du voyage, en cm (défaut Flexilivre A4 paysage). */
  function voyagePageCm(voyageId: string): { w: number; h: number } {
    return voyages.find(v => v.id === voyageId)?.albumPageCm ?? DEFAULT_ALBUM_PAGE_CM
  }

  /** Profil d'imprimeur du voyage (Flexilivre A4 par défaut). */
  function voyageProfile(voyageId: string) {
    return getPrintProfile(voyages.find(v => v.id === voyageId)?.printProfileId)
  }

  /** Choisit un profil d'imprimeur : préremplit la taille de page et invalide les PDF en cache. */
  async function handleSetVoyageProfile(voyageId: string, profileId: string) {
    const profile = getPrintProfile(profileId)
    const next = profile.id === 'custom' ? voyagePageCm(voyageId) : profile.pageCm
    const coverContentVersion = await saveVoyageAlbumPageCm(voyageId, next, profile.id)
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, albumPageCm: next, printProfileId: profile.id, coverContentVersion } : v))
    setEditingVoyageCover(v => v && v.id === voyageId ? { ...v, albumPageCm: next, printProfileId: profile.id, coverContentVersion } : v)
  }

  /** Change la taille de page (cm) pour tout le voyage — invalide les PDF en cache (rasterisés à
   * l'ancien format) et impose une régénération. `w`/`h` NaN ou ≤ 0 ⇒ ignoré. */
  async function handleSetVoyagePageCm(voyageId: string, pageCm: { w: number; h: number }) {
    const cur = voyagePageCm(voyageId)
    const w = Number.isFinite(pageCm.w) && pageCm.w > 0 ? pageCm.w : cur.w
    const h = Number.isFinite(pageCm.h) && pageCm.h > 0 ? pageCm.h : cur.h
    if (w === cur.w && h === cur.h) return
    const next = { w, h }
    const coverContentVersion = await saveVoyageAlbumPageCm(voyageId, next)
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, albumPageCm: next, coverContentVersion } : v))
    setEditingVoyageCover(v => v && v.id === voyageId ? { ...v, albumPageCm: next, coverContentVersion } : v)
  }

  /** Nombre de pages intérieures pour un profil wrap-spread — détermine la largeur du dos de la
   * feuille de couverture. N'affecte que le PDF de couverture (pas les pages intérieures) ; on
   * n'invalide donc que le cache couverture. La saisie est ramenée aux bornes / au pas du profil
   * (WhiteWall : 28–200, de 4 en 4). */
  async function handleSetVoyageWrapPages(voyageId: string, pages: number) {
    const profile = voyageProfile(voyageId)
    const def = profile.coverSpread?.pageRange?.min ?? 0
    const cur = voyages.find(v => v.id === voyageId)?.wrapPageCount ?? def
    const next = Number.isFinite(pages) ? snapWrapPageCount(profile, pages) : def
    if (next === cur) return
    const coverContentVersion = await saveVoyageWrapPageCount(voyageId, next)
    setVoyages(prev => prev.map(v => v.id === voyageId ? { ...v, wrapPageCount: next, coverContentVersion } : v))
    setEditingVoyageCover(v => v && v.id === voyageId ? { ...v, wrapPageCount: next, coverContentVersion } : v)
  }

  /** Choisit le sillon du livre : toutes ses étapes y sont incluses d'office. */
  function chooseBook(voyage: Voyage) {
    if (voyage.id === bookVoyageId) return
    setBookVoyageId(voyage.id)
    setSelected(new Set(voyage.tracks.map(t => key(voyage.id, t.id))))
  }

  function toggleTrack(voyageId: string, trackId: string) {
    const k = key(voyageId, trackId)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

  function togglePhotos(trackKey: string) {
    setOpenPhotoTracks(prev => {
      const next = new Set(prev)
      if (next.has(trackKey)) next.delete(trackKey); else next.add(trackKey)
      return next
    })
  }

  function getSelectedTracks(): SelectedTrack[] {
    const result: SelectedTrack[] = []
    for (const voyage of voyages) {
      for (const track of sortTracksByDate(voyage.tracks)) {
        if (selected.has(key(voyage.id, track.id))) {
          result.push({
            voyageId: voyage.id,
            voyageName: voyage.name,
            track,
            photos: sortPhotosByDate(voyage.photos.filter(p => p.trackId === track.id)),
          })
        }
      }
    }
    return result
  }
  /** La sélection contient la rando d'exemple (étape ou couverture) : pas de code de réduction. */
  function selectionIsDemo(entries: SelectedTrack[], coverVoyage?: Voyage): boolean {
    return !!coverVoyage?.demo || entries.some(e => voyages.find(v => v.id === e.voyageId)?.demo)
  }

  /** PDF déjà créé lors d'une session précédente : on ne relance aucun rendu, on ouvre directement
   * le récapitulatif imprimeur (liens affiliés + code promo). L'import du fichier ne sert qu'à
   * confirmer le geste — son contenu n'est pas utilisé. */
  function handleExistingPdfSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const hasFile = !!e.target.files?.length
    e.target.value = ''
    if (!hasFile || !bookVoyage) return
    setPrintOffer({ partnerId: voyageProfile(bookVoyage.id).partnerId, demo: !!bookVoyage.demo })
  }

  /** Ce que « Créer mes PDF » va produire pour le livre — affiché à l'écran ③ avant de lancer. */
  function bookPlan(voyage: Voyage) {
    const profile = voyageProfile(voyage.id)
    const entries = getSelectedTracks().filter(e => e.voyageId === voyage.id && e.photos.length > 0)
    // Étapes incluses mais sans photo : elles ne produisent aucune page, on le signale.
    const skipped = sortTracksByDate(voyage.tracks)
      .filter(t => selected.has(key(voyage.id, t.id)) && !voyage.photos.some(p => p.trackId === t.id))
    const interior = entries.reduce(
      (n, e) => n + Math.max(1, sanitizeTrackPages(e.track.albumPages ?? []).length), 0,
    )
    const pad = entries.length > 0 ? pagesToPad(interior, profile.pageCount) : 0
    return { profile, entries, skipped, interior, pad, hasCover: !!voyage.coverPage, hasBack: !!voyage.backCoverPage }
  }

  /** Lance l'export du livre selon les règles de l'imprimeur : couverture et dos composés inclus
   * d'office ; WhiteWall enchaîne deux fichiers (couverture, puis pages intérieures). */
  function handleCreatePdfs(voyage: Voyage) {
    const { profile, entries, hasCover, hasBack } = bookPlan(voyage)
    const withCover = hasCover || hasBack
    setCoverVoyageId(withCover ? voyage.id : null)
    setWrapChain(profile.coverMode === 'wrap-spread' && withCover && entries.length > 0 ? 'cover' : null)
    setMultiAlbumOpen(true)
  }

  useHeaderBack('Retour', handleBack, editingTrack === null && editingVoyageCover === null && !multiAlbumOpen)

  if (multiAlbumOpen) {
    const entries = getSelectedTracks().filter(t => t.photos.length > 0)
    const coverVoyage = coverVoyageId ? voyages.find(v => v.id === coverVoyageId) : undefined
    // Album multi-tracés : format et profil suivent le premier voyage concerné (à défaut, celui de
    // la couverture). Mélanger des voyages de profils différents dans un même PDF n'est pas prévu.
    const refVoyageId = entries[0]?.voyageId ?? coverVoyage?.id ?? ''
    const exportPageCm = entries[0] ? voyagePageCm(entries[0].voyageId) : (coverVoyage?.albumPageCm ?? DEFAULT_ALBUM_PAGE_CM)
    const profile = voyageProfile(refVoyageId)
    const closeExport = () => { setMultiAlbumOpen(false); setWrapChain(null) }
    if (wrapChain === 'cover' && coverVoyage) {
      return (
        <MultiAlbumExport
          key="wrap-cover"
          entries={[]}
          photoUrls={photoUrls}
          coverPage={coverVoyage.coverPage}
          backCoverPage={coverVoyage.backCoverPage}
          pageCm={coverVoyage.albumPageCm ?? DEFAULT_ALBUM_PAGE_CM}
          coverMode={profile.coverMode}
          coverSpread={wrapSpreadForPages(profile, coverVoyage.wrapPageCount)}
          title="Fichier 1/2 — Couverture"
          onBack={closeExport}
          onSaved={() => setWrapChain('interior')}
        />
      )
    }
    return (
      <MultiAlbumExport
        key={wrapChain === 'interior' ? 'wrap-interior' : 'album'}
        title={wrapChain === 'interior' ? 'Fichier 2/2 — Pages intérieures' : undefined}
        entries={entries}
        photoUrls={photoUrls}
        coverPage={coverVoyage?.coverPage}
        backCoverPage={coverVoyage?.backCoverPage}
        pageCm={exportPageCm}
        coverMode={profile.coverMode}
        coverSpread={wrapSpreadForPages(profile, coverVoyage?.wrapPageCount)}
        pageCount={profile.pageCount}
        printPartnerId={profile.partnerId}
        demo={selectionIsDemo(entries, coverVoyage)}
        onBack={closeExport}
      />
    )
  }

  if (editingVoyageCover) {
    const voyagePhotos = editingVoyageCover.photos
    const coverProfile = getPrintProfile(editingVoyageCover.printProfileId)
    return (
      <VoyageCoverEditor
        voyageId={editingVoyageCover.id}
        voyageName={editingVoyageCover.name}
        photos={voyagePhotos}
        photoUrls={photoUrls}
        initialCoverPage={editingVoyageCover.coverPage}
        initialBackCoverPage={editingVoyageCover.backCoverPage}
        initialSide={coverEditorSide}
        wrapSpread={coverProfile.coverMode === 'wrap-spread' ? wrapSpreadForPages(coverProfile, editingVoyageCover.wrapPageCount) : undefined}
        pageCm={editingVoyageCover.albumPageCm ?? DEFAULT_ALBUM_PAGE_CM}
        onSave={(coverPage, backCoverPage) => handleSaveVoyageCoverPages(editingVoyageCover.id, coverPage, backCoverPage)}
        onPhotosAdded={(newPhotos, urls) => handleVoyagePhotosAdded(editingVoyageCover.id, newPhotos, urls)}
        onDeleteUnusedPhotos={photoIds => handleDeleteUnusedPhotos(editingVoyageCover.id, photoIds)}
        onBack={() => setEditingVoyageCover(null)}
      />
    )
  }

  if (editingTrack) {
    const trackPhotos = sortPhotosByDate(editingTrack.voyage.photos.filter(p => p.trackId === editingTrack.track.id))
    return (
      <AlbumPageEditor
        voyageName={editingTrack.voyage.name}
        trackName={editingTrack.track.name}
        date={editingTrack.track.date}
        track={editingTrack.track}
        photos={trackPhotos}
        photoUrls={photoUrls}
        initialPages={sanitizeTrackPages(editingTrack.track.albumPages ?? [])}
        onSave={pages => handleSaveAlbumPages(editingTrack.voyage.id, editingTrack.track.id, pages)}
        onDeleteUnusedPhotos={photoIds => handleDeleteUnusedPhotos(editingTrack.voyage.id, photoIds)}
        onBack={() => setEditingTrack(null)}
      />
    )
  }

  // ── Écran ① : le livre (sillon + imprimeur) ─────────────────────────────────
  function renderBookStep() {
    const profile = bookVoyage ? getPrintProfile(bookVoyage.printProfileId) : null
    const pg = bookVoyage ? voyagePageCm(bookVoyage.id) : null
    return (
      <>
        <section className="albw-section">
          <h2 className="albw-h">Quel sillon ?</h2>
          <p className="albw-sub">Un album rassemble les étapes d'un sillon.</p>
          <div className="albw-cards">
            {voyages.map(v => (
              <button
                key={v.id}
                type="button"
                className={`albw-card${v.id === bookVoyageId ? ' albw-card--on' : ''}`}
                onClick={() => chooseBook(v)}
                aria-pressed={v.id === bookVoyageId}
              >
                <span className="albw-card__title">{v.name}</span>
                <span className="albw-card__meta">{plural(v.tracks.length, 'étape')} · {plural(v.photos.length, 'photo')}</span>
              </button>
            ))}
          </div>
        </section>

        {bookVoyage && profile && pg && (
          <section className="albw-section">
            <h2 className="albw-h">Quel imprimeur ?</h2>
            <p className="albw-sub">Le format fixe la mise en page : choisissez-le avant de composer.</p>
            <div className="albw-cards">
              {PRINT_PROFILES.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`albw-card${p.id === profile.id ? ' albw-card--on' : ''}`}
                  onClick={() => { if (p.id !== profile.id) handleSetVoyageProfile(bookVoyage.id, p.id) }}
                  aria-pressed={p.id === profile.id}
                  title={p.note}
                >
                  <span className="albw-card__title">{profileName(p)}</span>
                  <span className="albw-card__meta">
                    {p.id === 'custom' ? 'taille au choix' : `${fmtCm(p.pageCm.w)} × ${fmtCm(p.pageCm.h)} cm`}
                    {p.tag ? ` · ${p.tag}` : ''}
                  </span>
                  {promoText(p) && (
                    <span className="albw-card__promo">🎁 {promoText(p)}{bookVoyage.demo ? ' (vos propres randos)' : ''}</span>
                  )}
                </button>
              ))}
            </div>
            {profile.id === 'custom' && (
              <div className="albw-size">
                <span>Taille des pages</span>
                <input
                  type="number" step="0.01" min="1" className="alb-voyage__format-in"
                  key={`w-${pg.w}`} defaultValue={pg.w} aria-label="Largeur (cm)"
                  onBlur={e => handleSetVoyagePageCm(bookVoyage.id, { w: Number(e.target.value), h: pg.h })}
                />
                <span>×</span>
                <input
                  type="number" step="0.01" min="1" className="alb-voyage__format-in"
                  key={`h-${pg.h}`} defaultValue={pg.h} aria-label="Hauteur (cm)"
                  onBlur={e => handleSetVoyagePageCm(bookVoyage.id, { w: pg.w, h: Number(e.target.value) })}
                />
                <span>cm</span>
              </div>
            )}
            <p className="albw-rule">{profileRule(profile)}</p>
            {promoText(profile) && (
              <p className="albw-promo">
                🎁 Avec {profileName(profile).split(' ')[0]}, un {promoText(profile)} vous est donné à la fin, une fois vos PDF créés
                {bookVoyage.demo ? ' — pour les albums de vos propres randonnées (pas pour la rando d\x27exemple)' : ''}.
              </p>
            )}
            {!profile.partnerId && (
              <p className="albw-sub">
                Pour le faire imprimer, choisissez Flexilivre ou WhiteWall : le format suit alors leurs
                exigences et un code de réduction vous est offert{bookVoyage.demo ? ' pour les albums de vos propres randonnées' : ''}.
              </p>
            )}
          </section>
        )}

        <div className="albw-nav">
          <span />
          {bookVoyage && (
            <button type="button" className="albw-next" onClick={() => setStep(2)}>Le contenu →</button>
          )}
        </div>
      </>
    )
  }

  // ── Écran ② : le contenu (sommaire du livre, dans l'ordre d'impression) ────────
  function renderCoverRow(voyage: Voyage, side: 'cover' | 'backcover', inWrap: boolean) {
    const done = side === 'cover' ? !!voyage.coverPage : !!voyage.backCoverPage
    return (
      <li key={side} className="alb-track alb-track--cover albw-row">
        <div className="alb-track__row">
          <span className="alb-track__cover-icon" aria-hidden="true">{side === 'cover' ? '🖼' : '📖'}</span>
          <div className="alb-track__info">
            <span className="alb-track__name">{side === 'cover' ? 'Couverture' : 'Dos (4e de couverture)'}</span>
            <span className="alb-track__meta">
              {done ? (side === 'cover' ? 'Composée' : 'Composé') : 'À composer'}
              {side === 'backcover' && inWrap ? ' · sur la même feuille que la couverture' : ''}
            </span>
          </div>
          {done && <span className="albw-ok" title="Prêt">✓</span>}
          <button
            className={`alb-track__compose-btn${done ? ' alb-track__compose-btn--done' : ''}`}
            onClick={() => { setCoverEditorSide(side); setEditingVoyageCover(voyage) }}
          >
            {done ? '✏️ Modifier' : '✏️ Composer'}
          </button>
        </div>
      </li>
    )
  }

  function renderTrackRow(voyage: Voyage, track: VoyageTrack) {
    const k = key(voyage.id, track.id)
    const trackPhotos = sortPhotosByDate(voyage.photos.filter(p => p.trackId === track.id))
    const included = selected.has(k)
    const composed = (track.albumPages?.length ?? 0) > 0
    const pageCount = Math.max(1, sanitizeTrackPages(track.albumPages ?? []).length)
    const photosOpen = openPhotoTracks.has(k)
    const trackSelectedPhotoCount = trackPhotos.filter(p => selectedPhotoIds.has(p.id)).length
    const trackBrokenCount = trackPhotos.filter(p => brokenPhotoIds.has(p.id)).length
    const uploadBtn = (
      <button
        className="alb-track__photo-btn"
        onClick={() => handleUploadClick(voyage.id, track.id)}
        disabled={uploadingTrackKey === k}
        title="Les photos sont classées par date de prise de vue (donnée EXIF de l'appareil). Sans cette donnée, elles gardent l'ordre de sélection — choisissez-les alors dans l'ordre chronologique pour un affichage chronologique."
      >
        {uploadingTrackKey === k ? 'Chargement…' : '📷 Ajouter des photos'}
      </button>
    )
    return (
      <li
        key={track.id}
        className={`alb-track albw-row${included ? ' alb-track--selected' : ' albw-row--off'}`}
        ref={k === scrollToTrackKey ? el => {
          if (!el) return
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          setScrollToTrackKey(null)
        } : undefined}
      >
        <div className="alb-track__row">
          <label className="alb-check" title={included ? 'Retirer cette étape du livre' : 'Inclure cette étape dans le livre'}>
            <input type="checkbox" checked={included} onChange={() => toggleTrack(voyage.id, track.id)} />
          </label>
          <div className="alb-track__info">
            {renaming?.key === k ? (
              <input
                className="alb-track__name-input"
                autoFocus
                value={renaming.value}
                onChange={e => setRenaming({ key: k, value: e.target.value })}
                onBlur={() => handleRenameTrack(voyage.id, track.id, renaming.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  else if (e.key === 'Escape') setRenaming(null)
                }}
                aria-label="Titre de l'étape"
              />
            ) : (
              <button
                type="button"
                className="alb-track__name alb-track__name--editable"
                onClick={() => setRenaming({ key: k, value: track.name })}
                title="Renommer l'étape — ce titre apparaît sur ses pages d'album"
              >
                {track.name} <span className="alb-track__rename-icon">✏️</span>
              </button>
            )}
            <span className="alb-track__meta">
              {formatDate(track.date || track.addedAt)} · {formatDist(track.distanceM)}
              {track.elevGainM ? ` · ↑ ${Math.round(track.elevGainM)} m` : ''}
              {' · '}
              {trackPhotos.length > 0 ? `${plural(pageCount, 'page')} · ${plural(trackPhotos.length, 'photo')}` : 'pas encore de photo'}
              {!included ? ' · hors du livre' : ''}
            </span>
          </div>
          {composed && <span className="albw-ok" title="Pages composées">✓</span>}
          {trackPhotos.length > 0 ? (
            <button
              className="alb-track__collapse-btn"
              onClick={() => togglePhotos(k)}
              aria-expanded={photosOpen}
              title={photosOpen ? 'Replier les photos' : 'Voir, ajouter ou retirer des photos'}
            >
              📷 Photos ({trackPhotos.length}) <span className="alb-track__collapse-arrow">{photosOpen ? '▴' : '▾'}</span>
            </button>
          ) : uploadBtn}
          {trackPhotos.length > 0 && (
            <button
              className={`alb-track__compose-btn${composed ? ' alb-track__compose-btn--done' : ''}`}
              onClick={() => setEditingTrack({ voyage, track })}
            >
              {composed ? '✏️ Modifier' : '✏️ Composer'}
            </button>
          )}
        </div>
        {photosOpen && trackPhotos.length > 0 && (
          <div className="albw-photos">
            <div className="albw-photos__bar">
              {uploadBtn}
              <label className="alb-track__select-all">
                <input
                  type="checkbox"
                  checked={trackPhotos.every(p => selectedPhotoIds.has(p.id))}
                  ref={el => { if (el) el.indeterminate = trackSelectedPhotoCount > 0 && trackSelectedPhotoCount < trackPhotos.length }}
                  onChange={() => handleSelectAllTrackPhotos(trackPhotos)}
                />
                Tout sélectionner
              </label>
              {trackSelectedPhotoCount > 0 && (
                <button className="alb-track__bulk-delete-btn" onClick={() => handleDeleteSelectedPhotos(voyage, trackPhotos)}>
                  🗑 Supprimer ({trackSelectedPhotoCount})
                </button>
              )}
              {trackBrokenCount > 0 && (
                <button
                  className="alb-track__bulk-delete-btn"
                  onClick={() => handleDeleteBrokenPhotos(voyage, trackPhotos)}
                  title="Photos importées sans image récupérable — elles bloquent le hash et ne s'affichent jamais"
                >
                  🧹 Vider les photos cassées ({trackBrokenCount})
                </button>
              )}
            </div>
            <div className="alb-track__photos">
              <p className="alb-track__photos-hint">
                💡 Cliquez une photo pour la voir en grand et choisir de la garder ou non.
              </p>
              {trackPhotos.map(p => {
                const flagged = p.aiKeep === false
                const broken = brokenPhotoIds.has(p.id)
                return (
                  <div key={p.id} className={`alb-track__photo${flagged ? ' alb-track__photo--reject' : ''}${broken ? ' alb-track__photo--broken' : ''}`}>
                    {photoUrls[p.id] && (
                      <img
                        src={photoUrls[p.id]}
                        alt={p.name}
                        onClick={() => setPreview({ voyageId: voyage.id, photos: trackPhotos, index: trackPhotos.indexOf(p) })}
                      />
                    )}
                    {broken && <span className="alb-track__photo-broken-icon" title="Image introuvable">⚠</span>}
                    <label
                      className="alb-track__photo-select"
                      title="À supprimer (Maj+clic = plage, glisser = plusieurs)"
                      onMouseDown={() => handlePhotoDragStart(p.id)}
                      onMouseEnter={() => handlePhotoDragEnter(p.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPhotoIds.has(p.id)}
                        onClick={e => { shiftHeldRef.current = e.shiftKey }}
                        onChange={() => handlePhotoCheckboxChange(trackPhotos, p.id)}
                      />
                    </label>
                    {p.aiCaption && (
                      <div
                        className="alb-track__photo-caption"
                        title={`${p.aiCaption} (cliquer pour modifier)`}
                        onClick={() => setPreview({ voyageId: voyage.id, photos: trackPhotos, index: trackPhotos.indexOf(p) })}
                      >
                        {flagged && <span className="alb-track__photo-badge">à exclure</span>}
                        {p.aiCaption}
                      </div>
                    )}
                    {flagged && (
                      <div className="alb-track__photo-decision">
                        <button className="alb-track__photo-keep" onClick={() => handleKeepPhoto(voyage.id, p.id)} title="Je garde cette photo">✓ Garder</button>
                        <button className="alb-track__photo-remove" onClick={() => handleDeletePhoto(voyage.id, p)} title="Je supprime cette photo">✕ Supprimer</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </li>
    )
  }

  function renderContentStep(voyage: Voyage) {
    const profile = getPrintProfile(voyage.printProfileId)
    const inWrap = profile.coverMode === 'wrap-spread' // le dos est sur la feuille de couverture
    const { interior } = bookPlan(voyage)
    return (
      <section className="albw-section">
        <h2 className="albw-h">Sommaire du livre</h2>
        <p className="albw-sub">
          {voyage.name} · {profileName(profile)} — dans l'ordre d'impression. Décochez une étape pour la laisser hors du livre.
        </p>
        <ul className="alb-tracks albw-toc">
          {renderCoverRow(voyage, 'cover', inWrap)}
          {inWrap && renderCoverRow(voyage, 'backcover', inWrap)}
          {sortTracksByDate(voyage.tracks).map(track => renderTrackRow(voyage, track))}
          {!inWrap && renderCoverRow(voyage, 'backcover', inWrap)}
        </ul>
        <div className="albw-nav">
          <button type="button" className="albw-prev" onClick={() => setStep(1)}>← Le livre</button>
          <span className="albw-nav__info">{plural(interior, 'page intérieure')}</span>
          <button type="button" className="albw-next" onClick={() => setStep(3)}>Impression →</button>
        </div>
      </section>
    )
  }

  // ── Écran ③ : l'impression ────────────────────────────────────────────────────
  function renderPrintStep(voyage: Voyage) {
    const { profile, entries, skipped, interior, pad, hasCover, hasBack } = bookPlan(voyage)
    const withCover = hasCover || hasBack
    const pg = voyagePageCm(voyage.id)
    const size = `${fmtCm(pg.w)} × ${fmtCm(pg.h)} cm`
    const total = interior + pad
    const interiorLine = pad > 0
      ? `${plural(interior, 'page intérieure')} + ${plural(pad, 'page blanche')} ajoutée${pad > 1 ? 's' : ''} = ${total} pages`
      : plural(interior, 'page intérieure')
    const files: { title: string; lines: string[] }[] = []
    if (profile.coverMode === 'wrap-spread') {
      if (withCover) {
        const sheet = wrapSpreadForPages(profile, voyage.wrapPageCount)?.sheetCm
        files.push({
          title: 'Couverture',
          lines: [
            `Feuille d'un seul tenant${sheet ? ` de ${fmtCm(Math.round(sheet.w * 100) / 100)} × ${fmtCm(sheet.h)} cm` : ''} : 4e de couverture + dos + 1re de couverture`,
            ...(!hasCover ? ['⚠️ 1re de couverture non composée'] : []),
            ...(!hasBack ? ['⚠️ 4e de couverture non composée'] : []),
          ],
        })
      }
      if (entries.length > 0) {
        files.push({
          title: 'Pages intérieures',
          lines: [`${interiorLine} · ${size}`, `Nombre de pages à déclarer chez WhiteWall avant le téléversement : ${total}`],
        })
      }
    } else if (entries.length > 0 || withCover) {
      const lines = profile.coverMode === 'inline-first-last'
        ? [
            hasCover ? '1re page : couverture' : '⚠️ Pas de couverture composée',
            ...(entries.length > 0 ? [interiorLine] : []),
            hasBack ? 'Dernière page : dos (4e de couverture)' : 'Pas de dos composé',
          ]
        : [
            hasCover ? 'Couverture' : '⚠️ Pas de couverture composée',
            hasBack ? 'Dos (4e de couverture)' : 'Pas de dos composé',
            ...(entries.length > 0 ? [interiorLine] : []),
          ]
      files.push({ title: `Album complet · ${size}`, lines })
    }
    const partner = profile.partnerId ? profileName(profile).split(' ')[0] : null
    return (
      <section className="albw-section">
        <h2 className="albw-h">Ce qui va être créé</h2>
        <p className="albw-sub">{voyage.name} · {profileName(profile)}</p>
        {files.length === 0 ? (
          <p className="albw-warn">
            Rien à imprimer pour l'instant : composez la couverture ou ajoutez des photos à une étape
            (écran « Le contenu »).
          </p>
        ) : (
          <div className="albw-files">
            {files.map((f, i) => (
              <div key={f.title} className="albw-file">
                <span className="albw-file__icon" aria-hidden="true">📄</span>
                <div>
                  <div className="albw-file__title">{files.length > 1 ? `Fichier ${i + 1} — ` : ''}{f.title}</div>
                  <ul className="albw-file__lines">{f.lines.map(l => <li key={l}>{l}</li>)}</ul>
                </div>
              </div>
            ))}
          </div>
        )}
        {skipped.length > 0 && (
          <p className="albw-warn">
            {skipped.length > 1 ? 'Ces étapes n\'ont' : 'Cette étape n\'a'} pas encore de photo, donc pas de page :{' '}
            {skipped.map(t => t.name).join(', ')}.
          </p>
        )}
        {files.length > 0 && partner && promoText(profile) && (
          <p className="albw-promo">
            {voyage.demo
              ? <>🎁 Chez {partner} : {promoText(profile, true)} sur les albums de vos propres randonnées. Pas pour la rando d'exemple : elle sert à essayer.</>
              : <>🎁 Chez {partner} : {promoText(profile, true)}. Le code vous est donné juste après la création des PDF.</>}
          </p>
        )}
        {files.length > 0 && (
          <div className="albw-create-row">
            <button className="malb-export-btn albw-create" onClick={() => handleCreatePdfs(voyage)}>
              <AppLogoIcon size={24} />
              <span>Créer mes PDF</span>
            </button>
            <span className="albw-sub">
              {files.length > 1 ? 'Les deux fichiers se préparent l\'un après l\'autre : enregistrez le premier, le second suit. ' : ''}
              {partner ? `Ensuite : le lien vers ${partner}${promoText(profile) && !voyage.demo ? ' et votre code' : ''}.` : ''}
            </span>
          </div>
        )}
        <div className="albw-nav">
          <button type="button" className="albw-prev" onClick={() => setStep(2)}>← Le contenu</button>
          <span />
          {partner && (
            <>
              <input ref={existingPdfInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handleExistingPdfSelected} />
              <button
                type="button"
                className="alb-footer__existing-pdf-link"
                onClick={() => existingPdfInputRef.current?.click()}
                title="Le PDF n'est pas re-généré : il sert juste à confirmer que vous l'avez déjà"
              >
                🖨️ PDF déjà créé ? Aller chez {partner}
              </button>
            </>
          )}
        </div>
      </section>
    )
  }

  const STEPS: [1 | 2 | 3, string][] = [[1, 'Le livre'], [2, 'Le contenu'], [3, 'Impression']]

  return (
    <div className="alb-page albw">
      <div className="alb-header">
        <h1 className="alb-title">Créer mon album-photo</h1>
        <div className="vp-page__header-actions">
          <input ref={backupInputRef} type="file" accept="application/zip,.zip,application/json,.json,.txt,text/plain" style={{ display: 'none' }} onChange={handleImportBackup} />
          <button className="vp-btn vp-btn--sm vp-btn--ghost alb-backup-btn alb-backup-btn--save" disabled={!!backupBusy} onClick={handleExportBackup} title="Enregistre tous vos sillons (tracés, photos, films, albums) dans un fichier — à déposer dans un dossier synchronisé (pCloud, Drive, OneDrive…) pour le retrouver sur un autre appareil">
            💾 Sauvegarder
          </button>
          <button className="vp-btn vp-btn--sm vp-btn--ghost alb-backup-btn alb-backup-btn--restore" disabled={!!backupBusy} onClick={() => backupInputRef.current?.click()} title="Restaure les sillons depuis un fichier de sauvegarde">
            📂 Restaurer
          </button>
        </div>
      </div>
      <nav className="albw-steps" aria-label="Étapes de création de l'album">
        {STEPS.map(([n, label]) => (
          <button
            key={n}
            type="button"
            className={`albw-steps__item${step === n ? ' albw-steps__item--on' : ''}${step > n ? ' albw-steps__item--done' : ''}`}
            onClick={() => { if (n === 1 || bookVoyage) setStep(n) }}
            aria-current={step === n ? 'step' : undefined}
          >
            <span className="albw-steps__num">{step > n ? '✓' : n}</span>
            {label}
          </button>
        ))}
      </nav>
      <input
        // Pas d'attribut accept : sur Android, toute restriction à "image/*" (seul ou mélangé à
        // des extensions) peut déclencher le sélecteur de photos simplifié de Chrome, qui ne
        // liste que les rares apps intégrant l'API Android Photo Picker — pas pCloud, Drive,
        // etc. Sans accept, Android/Chrome utilise le sélecteur de fichiers classique, qui liste
        // tous les fournisseurs de documents installés. Le filtrage des images se fait ensuite
        // côté app (handlePhotoFilesChosen).
        ref={photoInputRef} type="file" multiple
        style={{ display: 'none' }} onChange={handlePhotoFilesChosen}
      />

      {loading ? (
        <p className="vp-empty">Chargement…</p>
      ) : voyages.length === 0 ? (
        <p className="vp-empty">Aucun sillon avec des tracés. Enregistrez d'abord des étapes.</p>
      ) : step === 1 || !bookVoyage ? (
        renderBookStep()
      ) : step === 2 ? (
        renderContentStep(bookVoyage)
      ) : (
        renderPrintStep(bookVoyage)
      )}

      {preview && (() => {
        const photo = preview.photos[preview.index]
        return (
          <div className="alb-lightbox" onClick={() => setPreview(null)}>
            <button className="alb-lightbox__close" onClick={() => setPreview(null)} title="Fermer (Échap)">✕</button>
            {preview.index > 0 && (
              <button
                className="alb-lightbox__nav alb-lightbox__nav--prev"
                onClick={e => { e.stopPropagation(); setPreview(p => p && { ...p, index: p.index - 1 }) }}
              >‹</button>
            )}
            {preview.index < preview.photos.length - 1 && (
              <button
                className="alb-lightbox__nav alb-lightbox__nav--next"
                onClick={e => { e.stopPropagation(); setPreview(p => p && { ...p, index: p.index + 1 }) }}
              >›</button>
            )}
            <div className="alb-lightbox__content" onClick={e => e.stopPropagation()}>
              <img className="alb-lightbox__img" src={photoUrls[photo.id]} alt={photo.name} />
              <div className="alb-lightbox__caption-wrap">
                {photo.aiKeep === false && <span className="alb-track__photo-badge">à exclure</span>}
                <textarea
                  key={photo.id}
                  className="alb-lightbox__caption-input"
                  defaultValue={photo.aiCaption ?? ''}
                  placeholder="Aucune légende — écrivez-en une ou laissez vide"
                  onChange={e => handleCaptionChange(preview.voyageId, photo.id, e.target.value)}
                  onBlur={e => handleCaptionSave(preview.voyageId, photo.id, e.target.value)}
                />
                {photo.aiCaption && (
                  <button
                    className="alb-lightbox__caption-clear"
                    onClick={() => handleClearCaption(preview.voyageId, photo.id)}
                    title="Effacer la légende"
                  >✕</button>
                )}
              </div>
              <div className="alb-lightbox__actions">
                <span className="alb-lightbox__counter">{preview.index + 1} / {preview.photos.length}</span>
                <label className="alb-lightbox__select">
                  <input
                    type="checkbox"
                    checked={selectedPhotoIds.has(photo.id)}
                    onChange={() => togglePhotoSelected(photo.id)}
                  />
                  À supprimer
                </label>
              </div>
            </div>
          </div>
        )
      })()}
      {backupBusy && <BackupOverlay {...overlayProps} />}
      {printOffer && <PrintOfferOverlay partnerId={printOffer.partnerId} demo={printOffer.demo} onClose={() => setPrintOffer(null)} />}
    </div>
  )
}
