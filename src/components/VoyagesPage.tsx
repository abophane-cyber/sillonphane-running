import { useEffect, useRef, useState } from 'react'
import type { Voyage, VoyageTrack, VoyageFilm, ComposedAlbumPage } from '../types'
import {
  getAllVoyages, saveVoyage, deleteVoyage, createVoyage, FILMS_CHANGED_EVENT,
  removeTrackFromVoyage, removeFilmFromVoyage, removePhotoFromVoyage, markFilmSeen,
  addTrackToVoyage, addFilmToVoyage, getFilmBlob, getPhotoBlob, saveTrackAlbumPages, repairOrphanedPhotos,
  getBackupStatus,
} from '../lib/voyageDB'
import { FILM_MUSIC, filmAudioSupported, type FilmAudioSpec } from '../lib/filmAudio'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { useBackupControls } from '../hooks/useBackupControls'
import { BackupOverlay } from './BackupOverlay'
import { AlbumPageEditor } from './AlbumPageEditor'
import { AlbumPrintView } from './AlbumPrintView'
import { AlbumPhotoPage } from './AlbumPhotoPage'
import { AlbumComposedPageContent } from './AlbumComposedPage'
import { AlbumSpreadContent } from './AlbumSpread'
import { sanitizeTrackPages, resolvePageBoxes } from '../lib/albumPages'
import { AlbumIcon } from './AlbumIcon'
import { RecordsBanner, PosterThumb } from './SillonRecords'
import { AppLogoIcon } from './AppLogoIcon'
import { isRecordedGpx } from '../lib/gpx'
import { saveFileWithPicker } from '../lib/saveFile'
import { BookAside, BookIcon, DotsIcon, MountainIcon, PencilIcon, PlusIcon, RunnerIcon, TrashIcon } from './SillonDetailParts'
import './SillonDetail.css'

interface Props {
  onBack: () => void
  onOpenTrack?: (voyageId: string, track: VoyageTrack, hasComposition: boolean, hasFilm: boolean) => void
  onCreateAlbum?: (voyageId: string, trackId: string) => void
  onAlbum?: () => void
  /** Ouvre l'écran « Créer le livre » (courses de tous les sillons). */
  onBook?: () => void
  /** Ouvre d'emblée ce sillon et met en avant les films de ce tracé (retour d'un « Voir le film »). */
  focusTarget?: { sillonId: string; trackId: string } | null
  onFocusConsumed?: () => void
}

function formatDist(m?: number) {
  if (!m) return '—'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function formatSize(bytes?: number) {
  if (!bytes) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} Go`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} Mo`
  return `${Math.round(bytes / 1e3)} Ko`
}
function sortTracksByDate(tracks: VoyageTrack[]): VoyageTrack[] {
  return [...tracks].sort((a, b) => (a.date || a.addedAt).localeCompare(b.date || b.addedAt))
}
const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.']
/** Pavé de date d'une course : « 10 / OCT. / 2025 ». */
function dateParts(iso?: string): { day: number; month: string; year: number } | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : { day: d.getDate(), month: MONTHS[d.getMonth()], year: d.getFullYear() }
}

// Note de musique en SVG plutôt qu'un emoji 🎵 : l'emoji se lisait mal (petit, multicolore) et
// Android le rendait de toute façon en couleur système, ignorant la teinte du bouton.
function MusicNoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z" />
    </svg>
  )
}

// Flèche de téléchargement en SVG (l'emoji ⬇ se lisait mal et Android le colorisait).
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

// ── Détail d'un sillon ───────────────────────────────────────────────────────
function SillonDetail({
  voyage, onBack, onChange, onOpenTrack, onCreateAlbum, onBook, focusTrackId,
}: {
  voyage: Voyage
  onBack: () => void
  onChange: (v: Voyage) => void
  onOpenTrack?: (voyageId: string, track: VoyageTrack, hasComposition: boolean, hasFilm: boolean) => void
  onCreateAlbum?: (voyageId: string, trackId: string) => void
  /** « Créer mon livre » : carte fixe à droite, visible pendant tout le défilement. */
  onBook?: () => void
  /** Tracé à déplier + faire défiler à l'ouverture (retour d'un « Voir le film »). */
  focusTrackId?: string | null
}) {
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const playerVideoRef = useRef<HTMLVideoElement>(null)
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const gpxInputRef = useRef<HTMLInputElement>(null)
  const [editingAlbumTrack, setEditingAlbumTrack] = useState<VoyageTrack | null>(null)
  const [viewingAlbumTrack, setViewingAlbumTrack] = useState<VoyageTrack | null>(null)
  const [viewingPageIndex, setViewingPageIndex] = useState(0)
  const [printingAlbumTrack, setPrintingAlbumTrack] = useState<VoyageTrack | null>(null)
  const [editorPhotoUrls, setEditorPhotoUrls] = useState<Record<string, string>>({})
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  // Repli des films par tracé. Non renseigné = repli par défaut si beaucoup de films.
  const [expandedTracks, setExpandedTracks] = useState<Record<string, boolean>>({})
  const [flashTrackId, setFlashTrackId] = useState<string | null>(null)
  // Bande-son a posteriori (menu « 🎵 » d'une ligne de film).
  const [mixMenuFilmId, setMixMenuFilmId] = useState<string | null>(null)
  const [mixingFilmId, setMixingFilmId] = useState<string | null>(null)
  const mixFileInputRef = useRef<HTMLInputElement>(null)
  const mixUploadTargetRef = useRef<VoyageFilm | null>(null)
  const audioSupported = filmAudioSupported()
  // Menu « ⋮ » d'une course (GPX, album, sélection, suppression).
  const [menuTrackId, setMenuTrackId] = useState<string | null>(null)
  useEffect(() => {
    if (!menuTrackId) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('.sd-menu')) setMenuTrackId(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuTrackId])

  async function handleRename() {
    const name = prompt('Nom du sillon', voyage.name)?.trim()
    if (!name || name === voyage.name) return
    const updated = { ...voyage, name }
    await saveVoyage(updated)
    onChange(updated)
  }

  function toggleTrackExpanded(trackId: string, current: boolean) {
    setExpandedTracks(prev => ({ ...prev, [trackId]: !current }))
  }

  // Retour d'un « Voir le film » : déplie les films du tracé ciblé, l'amène à l'écran et le
  // souligne brièvement.
  useEffect(() => {
    if (!focusTrackId) return
    setExpandedTracks(prev => ({ ...prev, [focusTrackId]: true }))
    setFlashTrackId(focusTrackId)
    const scrollT = setTimeout(() => {
      document.getElementById(`vp-track-${focusTrackId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    const flashT = setTimeout(() => setFlashTrackId(null), 2600)
    return () => { clearTimeout(scrollT); clearTimeout(flashT) }
  }, [focusTrackId])

  // Mode « focus » au retour d'un « Voir le film » : on éteint les autres tracés pour guider
  // l'œil vers celui qui vient d'être filmé. Se lève à la première interaction (ou après 7 s).
  // On mémorise l'id écarté (plutôt qu'un booléen remis à zéro par effet) : une nouvelle cible
  // ré-active le focus d'elle-même, sans setState synchrone dans un effet.
  const [dismissedFocusId, setDismissedFocusId] = useState<string | null>(null)
  const focusMode = !!focusTrackId && dismissedFocusId !== focusTrackId
  useEffect(() => {
    if (!focusMode || !focusTrackId) return
    const lift = () => setDismissedFocusId(focusTrackId)
    const t = setTimeout(lift, 7000)
    window.addEventListener('pointerdown', lift, { once: true })
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', lift) }
  }, [focusMode, focusTrackId])

  // Ferme le menu « 🎵 » au clic à l'extérieur.
  useEffect(() => {
    if (!mixMenuFilmId) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('.vp-mix')) setMixMenuFilmId(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [mixMenuFilmId])

  // Mixe une bande-son sur un film exporté et ajoute le résultat comme NOUVEAU film (le muet
  // d'origine est conservé). Remux seulement : pas de re-rendu ni de ré-encodage vidéo.
  async function handleMixFilm(
    film: VoyageFilm,
    choice: { kind: 'music'; url: string; label: string } | { kind: 'upload'; file: File },
  ) {
    setMixMenuFilmId(null)
    setMixingFilmId(film.id)
    try {
      const src = await getFilmBlob(film.id)
      if (!src) { alert('Vidéo source introuvable sur cet appareil.'); return }
      const spec: FilmAudioSpec = {
        sources: [choice.kind === 'upload'
          ? { kind: 'upload', blob: choice.file }
          : { kind: 'music', url: choice.url }],
      }
      const { remuxFilmAudio } = await import('../lib/filmRemux')
      const out = await remuxFilmAudio(src, spec)
      const suffix = choice.kind === 'upload'
        ? (choice.file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40) || 'musique')
        : choice.label.toLowerCase()
      const base = film.name.replace(/\.mp4$/i, '')
      const meta = await addFilmToVoyage(voyage.id, {
        name: `${base}_${suffix}.mp4`,
        trackId: film.trackId,
        durationSec: film.durationSec,
        sizeBytes: out.size,
      }, out)
      onChange({ ...voyage, films: [...voyage.films, meta] })
    } catch (e) {
      console.error('[remux]', e)
      alert(`Échec du mixage : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setMixingFilmId(null)
    }
  }

  // Charge les miniatures des photos du tracé dont on consulte ou compose l'album
  const albumPhotoTrack = editingAlbumTrack ?? viewingAlbumTrack
  useEffect(() => {
    if (!albumPhotoTrack) return
    let cancelled = false
    const urls: string[] = []
    const trackPhotos = voyage.photos.filter(p => p.trackId === albumPhotoTrack.id)
    ;(async () => {
      const entries: [string, string][] = []
      for (const p of trackPhotos) {
        const blob = await getPhotoBlob(p.id)
        if (blob) {
          const url = URL.createObjectURL(blob)
          urls.push(url)
          entries.push([p.id, url])
        }
      }
      if (!cancelled) setEditorPhotoUrls(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
      urls.forEach(u => URL.revokeObjectURL(u))
    }
  }, [albumPhotoTrack, voyage.photos])

  async function handleSaveAlbumPages(trackId: string, pages: ComposedAlbumPage[]) {
    const albumContentVersion = await saveTrackAlbumPages(voyage.id, trackId, pages)
    onChange({ ...voyage, tracks: voyage.tracks.map(t => t.id === trackId ? { ...t, albumPages: pages, albumContentVersion } : t) })
  }

  async function handleDeleteUnusedPhotos(photoIds: string[]) {
    for (const photoId of photoIds) await removePhotoFromVoyage(voyage.id, photoId)
    const deleted = new Set(photoIds)
    onChange({ ...voyage, photos: voyage.photos.filter(p => !deleted.has(p.id)) })
  }

  async function handleDeleteTrackFull(track: VoyageTrack) {
    const trackFilms = voyage.films.filter(f => f.trackId === track.id)
    const albumCount = track.albumPages?.length ?? 0
    const parts = [`le tracé "${track.name}"`]
    if (trackFilms.length > 0) parts.push(`${trackFilms.length} film${trackFilms.length > 1 ? 's' : ''}`)
    if (albumCount > 0) parts.push(`l'album (${albumCount} page${albumCount > 1 ? 's' : ''})`)
    if (!confirm(`Supprimer définitivement ${parts.join(', ')} ?\n\nCette action est irréversible.`)) return
    for (const f of trackFilms) await removeFilmFromVoyage(voyage.id, f.id)
    await removeTrackFromVoyage(voyage.id, track.id)
    onChange({
      ...voyage,
      tracks: voyage.tracks.filter(t => t.id !== track.id),
      films: voyage.films.filter(f => f.trackId !== track.id),
    })
  }

  async function handleDeleteFilm(film: VoyageFilm) {
    if (!confirm(`Supprimer le film "${film.name}" ?`)) return
    await removeFilmFromVoyage(voyage.id, film.id)
    onChange({ ...voyage, films: voyage.films.filter(f => f.id !== film.id) })
  }

  function toggleSelected(itemKey: string) {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemKey)) next.delete(itemKey); else next.add(itemKey)
      return next
    })
  }

  async function handleDeleteSelected() {
    const trackIds = new Set([...selectedItems].filter(k => k.startsWith('track:')).map(k => k.slice(6)))
    const filmIds = new Set([
      ...[...selectedItems].filter(k => k.startsWith('film:')).map(k => k.slice(5)),
      ...voyage.films.filter(f => f.trackId && trackIds.has(f.trackId)).map(f => f.id),
    ])
    if (trackIds.size === 0 && filmIds.size === 0) return
    const parts: string[] = []
    if (trackIds.size > 0) parts.push(`${trackIds.size} tracé${trackIds.size > 1 ? 's' : ''}`)
    if (filmIds.size > 0) parts.push(`${filmIds.size} film${filmIds.size > 1 ? 's' : ''}`)
    if (!confirm(`Supprimer ${parts.join(' et ')} sélectionné${trackIds.size + filmIds.size > 1 ? 's' : ''} ?\n\nCette action est irréversible.`)) return
    for (const filmId of filmIds) await removeFilmFromVoyage(voyage.id, filmId)
    for (const trackId of trackIds) await removeTrackFromVoyage(voyage.id, trackId)
    onChange({
      ...voyage,
      tracks: voyage.tracks.filter(t => !trackIds.has(t.id)),
      films: voyage.films.filter(f => !filmIds.has(f.id)),
    })
    setSelectedItems(new Set())
  }

  async function handlePlayFilm(film: VoyageFilm) {
    markSeen(film)
    if (playingUrl) { URL.revokeObjectURL(playingUrl); setPlayingUrl(null) }
    setPlayerError(null)
    try {
      const blob = await getFilmBlob(film.id)
      if (!blob) { alert('Vidéo non disponible.'); return }
      setPlayingUrl(URL.createObjectURL(blob))
    } catch (e) {
      // Sans ce try/catch, une erreur ici (accès IndexedDB, blob corrompu…) échouait
      // silencieusement : ni lecteur, ni message, le clic sur ▶ ne faisait rien.
      console.error('[film] lecture:', e)
      alert(`Impossible de charger ce film : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // L'attribut autoPlay seul ne suffit pas toujours : la lecture du blob depuis IndexedDB est
  // asynchrone, ce qui peut faire perdre le geste utilisateur nécessaire aux politiques
  // d'autoplay du navigateur (surtout Safari/iOS) — la vidéo se charge alors sans jamais démarrer.
  // On déclenche donc aussi play() explicitement une fois la source posée. Le lecteur est aussi
  // amené à l'écran : il s'affiche en haut de page, donc pour un film d'un tracé plus bas dans la
  // liste rien ne semblait se passer au clic (la lecture démarrait bien, mais hors champ).
  useEffect(() => {
    if (!playingUrl) return
    playerVideoRef.current?.play().catch(() => {})
    playerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [playingUrl])

  // Tout film créé reste surligné tant qu'il n'a été ni lu ni téléchargé (plusieurs à la fois si
  // on enchaîne 2D puis 3D). Les films antérieurs à ce marquage n'ont pas le drapeau : non surlignés.
  function markSeen(film: VoyageFilm) {
    if (!film.unseen) return
    onChange({ ...voyage, films: voyage.films.map(f => f.id === film.id ? { ...f, unseen: undefined } : f) })
    markFilmSeen(voyage.id, film.id).catch(e => console.error('[film] marquage vu :', e))
  }

  async function handleDownloadFilm(film: VoyageFilm) {
    markSeen(film)
    const blob = await getFilmBlob(film.id)
    if (!blob) return alert('Vidéo non disponible (espace insuffisant sur cet appareil).')
    // saveFileWithPicker : choix d'emplacement (ordinateur) ou partage natif (Android). Un simple
    // <a download> reste inerte dans le WebView de l'APK.
    await saveFileWithPicker(blob, film.name, {
      mimeType: 'video/mp4', extension: '.mp4', description: 'Film du parcours',
    })
  }

  // Exporte le GPX brut d'un tracé vers un vrai fichier .gpx (choix d'emplacement sur ordinateur,
  // partage natif Android — « Enregistrer dans Fichiers », pCloud, etc.) pour le réutiliser
  // ailleurs (VisuGPX, OsmAnd, montre GPS…). Un <a download> nu ne déclenche rien dans le WebView
  // de l'APK, d'où saveFileWithPicker (même chemin que l'export PDF / la sauvegarde .zip).
  async function handleDownloadGpx(track: VoyageTrack) {
    const safeName = track.name.trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'trace'
    const blob = new Blob([track.gpxData], { type: 'application/gpx+xml' })
    await saveFileWithPicker(blob, `${safeName}.gpx`, {
      mimeType: 'application/gpx+xml', extension: '.gpx', description: 'Tracé GPX',
      // Android restreint le partage de fichiers à une liste de types "sûrs" qui exclut
      // application/gpx+xml — on partage donc le même contenu (XML texte) en text/plain, en
      // gardant l'extension .gpx pour qu'OsmAnd/VisuGPX le reconnaissent.
      shareMimeType: 'text/plain', shareExtension: '.gpx',
    })
  }

  async function handleImportGpx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/\.gpx$/i.test(file.name)) {
      e.target.value = ''
      return
    }
    const gpxData = await file.text()
    const entry = await addTrackToVoyage(voyage.id, {
      name: file.name.replace(/\.gpx$/i, ''),
      gpxData,
    })
    onChange({ ...voyage, tracks: [...voyage.tracks, entry] })
    e.target.value = ''
  }

  const trackIds = new Set(voyage.tracks.map(t => t.id))
  const orphanFilms = voyage.films.filter(f => !f.trackId || !trackIds.has(f.trackId))

  useHeaderBack('Mes sillons', onBack, !editingAlbumTrack && !printingAlbumTrack && !viewingAlbumTrack)

  if (viewingAlbumTrack) {
    const trackPhotos = voyage.photos.filter(p => p.trackId === viewingAlbumTrack.id)
    const pages = sanitizeTrackPages(viewingAlbumTrack.albumPages ?? [])
    // Un tracé hérité d'une ancienne version peut n'avoir que des pages couverture/dos vides,
    // filtrées par sanitizeTrackPages — sans ce garde, page vaudrait undefined et page.kind
    // planterait plus bas.
    if (pages.length === 0) { setViewingAlbumTrack(null); return null }
    const index = Math.min(viewingPageIndex, pages.length - 1)
    const page = pages[index]
    return (
      <AlbumPhotoPage
        index={index}
        total={pages.length}
        onPrev={() => setViewingPageIndex(i => Math.max(0, i - 1))}
        onNext={() => setViewingPageIndex(i => Math.min(pages.length - 1, i + 1))}
        onBack={() => setViewingAlbumTrack(null)}
        onEdit={() => { setEditingAlbumTrack(viewingAlbumTrack); setViewingAlbumTrack(null) }}
        onPrint={() => setPrintingAlbumTrack(viewingAlbumTrack)}
      >
        {page.kind === 'summary' ? (
          <AlbumSpreadContent
            track={viewingAlbumTrack}
            voyageName={voyage.name}
            photos={trackPhotos.map(p => ({ id: p.id, url: editorPhotoUrls[p.id] })).filter(p => p.url)}
            text={page.summaryText}
          />
        ) : (
          <AlbumComposedPageContent
            voyageName={page.headerSubtitle ?? voyage.name}
            trackName={page.headerTitle ?? viewingAlbumTrack.name}
            date={viewingAlbumTrack.date}
            boxes={resolvePageBoxes(page, trackPhotos, editorPhotoUrls)}
            showHeader={page.header !== false}
          />
        )}
      </AlbumPhotoPage>
    )
  }

  if (editingAlbumTrack) {
    const trackPhotos = voyage.photos.filter(p => p.trackId === editingAlbumTrack.id)
    return (
      <AlbumPageEditor
        voyageName={voyage.name}
        trackName={editingAlbumTrack.name}
        date={editingAlbumTrack.date}
        track={editingAlbumTrack}
        photos={trackPhotos}
        photoUrls={editorPhotoUrls}
        initialPages={sanitizeTrackPages(editingAlbumTrack.albumPages ?? [])}
        onSave={pages => handleSaveAlbumPages(editingAlbumTrack.id, pages)}
        onDeleteUnusedPhotos={handleDeleteUnusedPhotos}
        onBack={() => setEditingAlbumTrack(null)}
      />
    )
  }

  if (printingAlbumTrack) {
    const trackPhotos = voyage.photos.filter(p => p.trackId === printingAlbumTrack.id)
    return (
      <AlbumPrintView
        voyageName={voyage.name}
        trackName={printingAlbumTrack.name}
        date={printingAlbumTrack.date}
        track={printingAlbumTrack}
        pages={printingAlbumTrack.albumPages ?? []}
        photos={trackPhotos}
        pageCm={voyage.albumPageCm}
        onBack={() => setPrintingAlbumTrack(null)}
      />
    )
  }

  return (
    <div className="sd">
      {/* Pas d'accept : sur Android le fournisseur de fichiers grise les fichiers dont le MIME
          détecté ne correspond pas au filtre ".gpx" (aucun MIME standard pour ce format) — le
          fichier reste alors non sélectionnable même s'il est visible. Filtrage par extension
          fait dans handleImportGpx. */}
      <input ref={gpxInputRef} type="file" style={{ display: 'none' }} onChange={handleImportGpx} />
      <input
        ref={mixFileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          const target = mixUploadTargetRef.current
          e.target.value = ''
          if (file && target) handleMixFilm(target, { kind: 'upload', file })
        }}
      />

      <div className={`sd__layout${onBook ? ' sd__layout--book' : ''}`}>
        <div className="sd__main">
          <header className="sd__head">
            <span className="sd__badge"><RunnerIcon size={42} /></span>
            <div className="sd__heading">
              <div className="sd__title-row">
                <h1 className="sd__title">{voyage.name}</h1>
                <button type="button" className="sd__rename" onClick={handleRename} title="Renommer ce sillon"><PencilIcon size={18} /></button>
              </div>
              <span className="sd__stats">{countLabel(voyage)}</span>
            </div>
            <p className="sd__quote">Des kilomètres de souvenirs<br />à feuilleter pour toujours.</p>
          </header>

          <RecordsBanner voyages={[voyage]} title="Records de ce sillon" />

          {playingUrl && (
            <div className="vp-player" ref={playerContainerRef}>
              <video
                ref={playerVideoRef} className="vp-player__video" src={playingUrl} controls autoPlay playsInline
                onError={() => setPlayerError('Ce film ne peut pas être lu sur cet appareil (format vidéo non supporté par ce navigateur).')}
              />
              {playerError && <p className="vp-player__error">{playerError}</p>}
              <button className="vp-player__close" onClick={() => { URL.revokeObjectURL(playingUrl); setPlayingUrl(null) }}>
                ✕ Fermer
              </button>
            </div>
          )}

          {voyage.tracks.length === 0 && voyage.films.length === 0 ? (
            <p className="vp-empty">Aucun contenu. Importez un GPX ou enregistrez un tracé depuis la carte.</p>
          ) : (
            <ul className={`sd-list${focusMode ? ' sd-list--focus' : ''}`}>
              {sortTracksByDate(voyage.tracks).map(t => {
                const trackFilms = voyage.films.filter(f => f.trackId === t.id)
                const defaultExpanded = trackFilms.length <= 3
                const filmsExpanded = expandedTracks[t.id] ?? defaultExpanded
                const d = dateParts(t.date || t.addedAt)
                const recorded = t.source === 'recorded' || isRecordedGpx(t.gpxData)
                const editPoster = () => onCreateAlbum ? onCreateAlbum(voyage.id, t.id) : setEditingAlbumTrack(t)
                return (
                  <li
                    key={t.id}
                    id={`vp-track-${t.id}`}
                    className={`sd-card${flashTrackId === t.id ? ' sd-card--flash' : ''}${focusMode && focusTrackId === t.id ? ' sd-card--focus' : ''}`}
                  >
                    <div className="sd-card__row">
                      <div className="sd-card__date">
                        {d ? <><strong>{d.day}</strong><span>{d.month}</span><span>{d.year}</span></> : <span>—</span>}
                      </div>
                      {t.poster
                        ? <PosterThumb track={t} className="sd-card__thumb" />
                        : <span className="sd-card__thumb sd-card__thumb--empty">🗺</span>}
                      <div className="sd-card__info">
                        <span className="sd-card__name">{t.name}</span>
                        <span className="sd-card__meta">
                          <MountainIcon />
                          {formatDist(t.distanceM).replace('.', ',')}
                          {t.elevGainM ? ` · ↑ ${Math.round(t.elevGainM)} m` : ''}
                          <span className={`sd-badge${t.poster ? ' sd-badge--done' : ''}`}>{t.poster ? 'Affiche faite' : 'Affiche à faire'}</span>
                        </span>
                      </div>
                      <div className="sd-card__actions">
                        {trackFilms.length > 0 && (
                          <button
                            type="button"
                            className="sd-btn sd-btn--light"
                            onClick={() => toggleTrackExpanded(t.id, filmsExpanded)}
                            aria-expanded={filmsExpanded}
                            title={filmsExpanded ? 'Replier les films' : 'Afficher les films'}
                          >
                            <span className="sd-btn__caret">{filmsExpanded ? '▾' : '▸'}</span> 🎬 Voir {trackFilms.length > 1 ? `les films (${trackFilms.length})` : 'le film'}
                          </button>
                        )}
                        {onOpenTrack && (
                          <button
                            type="button"
                            className="sd-btn sd-btn--brick"
                            // hasComposition : l'utilisateur a déjà travaillé ce tracé (film, pages
                            // d'album, ou assistant panneaux validé). Sinon (tracé brut tout juste
                            // enregistré/importé) l'écran d'animation doit repartir de zéro — guide
                            // complet, aperçu obligatoire avant de créer un film.
                            onClick={() => onOpenTrack(
                              voyage.id, t,
                              trackFilms.length > 0 || (t.albumPages?.length ?? 0) > 0 || !!t.panelWizardDone,
                              trackFilms.length > 0,
                            )}
                          >
                            <BookIcon size={16} /> Ouvrir
                          </button>
                        )}
                        {t.poster
                          ? <button type="button" className="sd-btn sd-btn--outline" onClick={editPoster}><PencilIcon size={15} /> Modifier l'affiche</button>
                          : <button type="button" className="sd-btn sd-btn--green" onClick={editPoster}><PlusIcon size={15} /> Créer l'affiche</button>}
                        <span className="sd-menu">
                          <button
                            type="button"
                            className="sd-menu__toggle"
                            onClick={() => setMenuTrackId(menuTrackId === t.id ? null : t.id)}
                            aria-expanded={menuTrackId === t.id}
                            title="Plus d'actions"
                          ><DotsIcon /></button>
                          {menuTrackId === t.id && (
                            <span className="sd-menu__list">
                              {recorded && (
                                <button type="button" onClick={() => { setMenuTrackId(null); handleDownloadGpx(t) }}>
                                  <DownloadIcon /> Télécharger le GPX
                                </button>
                              )}
                              {t.albumPages?.length ? (
                                <button type="button" onClick={() => { setMenuTrackId(null); setViewingPageIndex(0); setViewingAlbumTrack(t) }}>
                                  👁 Voir l'album ({t.albumPages.length})
                                </button>
                              ) : null}
                              <button type="button" onClick={() => { setMenuTrackId(null); toggleSelected(`track:${t.id}`) }}>
                                {selectedItems.has(`track:${t.id}`) ? '☑ Retirer de la sélection' : '☐ Sélectionner'}
                              </button>
                              <button type="button" className="sd-menu__danger" onClick={() => { setMenuTrackId(null); handleDeleteTrackFull(t) }}>
                                <TrashIcon /> Supprimer la course
                              </button>
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    {trackFilms.length > 0 && filmsExpanded && (
                      <ul className="sd-films">
                        {trackFilms.map(f => (
                          <li key={f.id} className={`sd-film${f.unseen ? ' sd-film--new' : ''}`}>
                            <label className="sd-film__select">
                              <input type="checkbox" checked={selectedItems.has(`film:${f.id}`)} onChange={() => toggleSelected(`film:${f.id}`)} />
                            </label>
                            <span className="sd-film__icon">🎬</span>
                            <div className="sd-film__info">
                              <span className="sd-film__name">{f.name}</span>
                              <span className="sd-film__meta">{formatDate(f.createdAt)} · {formatSize(f.sizeBytes)}</span>
                            </div>
                            <div className="sd-film__actions">
                              <button type="button" className="sd-icon sd-icon--play" onClick={() => handlePlayFilm(f)} title="Lire le film">▶</button>
                              {audioSupported && (
                                <span className="vp-mix">
                                  <button
                                    type="button"
                                    className="sd-icon"
                                    disabled={mixingFilmId !== null}
                                    onClick={() => setMixMenuFilmId(mixMenuFilmId === f.id ? null : f.id)}
                                    title="Ajouter une bande-son (nouveau fichier)"
                                  >
                                    {mixingFilmId === f.id ? '⏳' : <MusicNoteIcon />}
                                  </button>
                                  {mixMenuFilmId === f.id && (
                                    <div className="vp-mix__menu">
                                      <span className="vp-mix__title">Ajouter une musique</span>
                                      {FILM_MUSIC.map(m => (
                                        <button
                                          key={m.id}
                                          className="vp-mix__item"
                                          onClick={() => handleMixFilm(f, { kind: 'music', url: m.url, label: m.label })}
                                        >
                                          <span className="vp-mix__label">{m.label}</span>
                                          <span className="vp-mix__hint">{m.hint}</span>
                                        </button>
                                      ))}
                                      <button
                                        className="vp-mix__item"
                                        onClick={() => { mixUploadTargetRef.current = f; setMixMenuFilmId(null); mixFileInputRef.current?.click() }}
                                      >
                                        <span className="vp-mix__label">Mon fichier…</span>
                                        <span className="vp-mix__hint">mp3, m4a, wav…</span>
                                      </button>
                                    </div>
                                  )}
                                </span>
                              )}
                              <button type="button" className="sd-icon" onClick={() => handleDownloadFilm(f)} title="Télécharger le film"><DownloadIcon /></button>
                              <button type="button" className="sd-icon sd-icon--danger" onClick={() => handleDeleteFilm(f)} title="Supprimer le film"><TrashIcon size={17} /></button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
              {orphanFilms.length > 0 && (
                <li className="sd-card">
                  <ul className="sd-films sd-films--orphan">
                    {orphanFilms.map(f => (
                      <li key={f.id} className="sd-film">
                        <label className="sd-film__select">
                          <input type="checkbox" checked={selectedItems.has(`film:${f.id}`)} onChange={() => toggleSelected(`film:${f.id}`)} />
                        </label>
                        <span className="sd-film__icon">🎬</span>
                        <div className="sd-film__info">
                          <span className="sd-film__name">{f.name}</span>
                          <span className="sd-film__meta">{formatDate(f.createdAt)} · {formatSize(f.sizeBytes)}</span>
                        </div>
                        <div className="sd-film__actions">
                          <button type="button" className="sd-icon sd-icon--play" onClick={() => handlePlayFilm(f)} title="Lire le film">▶</button>
                          <button type="button" className="sd-icon" onClick={() => handleDownloadFilm(f)} title="Télécharger le film"><DownloadIcon /></button>
                          <button type="button" className="sd-icon sd-icon--danger" onClick={() => handleDeleteFilm(f)} title="Supprimer le film"><TrashIcon size={17} /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          )}

          {selectedItems.size > 0 && (
            <div className="vp-bulkbar">
              <span>{selectedItems.size} sélectionné{selectedItems.size > 1 ? 's' : ''}</span>
              <button className="vp-btn vp-btn--sm vp-btn--ghost" onClick={() => setSelectedItems(new Set())}>Annuler</button>
              <button className="vp-btn vp-btn--sm vp-btn--danger" onClick={handleDeleteSelected}>🗑 Supprimer la sélection</button>
            </div>
          )}
        </div>

        {onBook && <BookAside poster={latestPoster(voyage)} onBook={onBook} />}
      </div>
    </div>
  )
}

// ── Page principale Mes sillons ──────────────────────────────────────────────
/** « 6 courses · 4 affiches · 2 films ». */
function countLabel(v: Voyage): string {
  const n = v.tracks.length, p = v.tracks.filter(t => t.poster).length, f = v.films.length
  return [`${n} course${n !== 1 ? 's' : ''}`, `${p} affiche${p !== 1 ? 's' : ''}`, `${f} film${f !== 1 ? 's' : ''}`].join(' · ')
}

/** Course la plus récente du sillon qui a une affiche (vignette du sillon). */
function latestPoster(v: Voyage): VoyageTrack | undefined {
  return v.tracks.filter(t => t.poster)
    .sort((a, b) => (b.date || b.addedAt).localeCompare(a.date || a.addedAt))[0]
}

export function VoyagesPage({ onBack, onOpenTrack, onCreateAlbum, onAlbum, onBook, focusTarget, onFocusConsumed }: Props) {
  const [voyages, setVoyages]   = useState<Voyage[]>([])
  const [selected, setSelected] = useState<Voyage | null>(null)
  const [focusTrackId, setFocusTrackId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [loading, setLoading]   = useState(true)
  const [backupStatus, setBackupStatus] = useState(() => getBackupStatus())
  const {
    backupBusy, backupInputRef, overlayProps,
    handleExportBackup, handleImportBackup,
  } = useBackupControls({
    onImported: async () => {
      const repaired = await Promise.all((await getAllVoyages()).map(repairOrphanedPhotos))
      setVoyages(repaired.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    },
    afterSaved: () => setBackupStatus(getBackupStatus()),
  })
  const hasContent = voyages.some(v => v.tracks.length > 0 || v.photos.length > 0 || v.films.length > 0)

  useEffect(() => {
    getAllVoyages().then(async v => {
      const repaired = await Promise.all(v.map(repairOrphanedPhotos))
      setVoyages(repaired.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setLoading(false)
      setBackupStatus(getBackupStatus())
    })
  }, [])

  // Film fini pendant qu'on est sur Mes sillons (rendu en arrière-plan) : rechargement, pour qu'il apparaisse.
  useEffect(() => {
    const onFilm = () => {
      getAllVoyages().then(async v => {
        const repaired = await Promise.all(v.map(repairOrphanedPhotos))
        setVoyages(repaired.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        setSelected(prev => (prev ? repaired.find(x => x.id === prev.id) ?? prev : prev))
      })
    }
    window.addEventListener(FILMS_CHANGED_EVENT, onFilm)
    return () => window.removeEventListener(FILMS_CHANGED_EVENT, onFilm)
  }, [])

  // Retour d'un « Voir le film » : ouvre le sillon ciblé et retient le tracé à mettre en avant.
  // La cible est consommée aussitôt (one-shot) — `focusTrackId` reste local pour SillonDetail.
  useEffect(() => {
    if (!focusTarget || loading) return
    const v = voyages.find(x => x.id === focusTarget.sillonId)
    if (!v) return
    setSelected(v)
    setFocusTrackId(focusTarget.trackId)
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, voyages, loading])

  async function handleCreate() {
    const name = newName.trim() || 'Nouveau sillon'
    const v = createVoyage(name)
    await saveVoyage(v)
    setVoyages(prev => [v, ...prev])
    setNewName('')
    setCreating(false)
    setSelected(v)
    setBackupStatus(getBackupStatus())
  }

  async function handleDelete(voyage: Voyage) {
    if (!confirm(`Supprimer "${voyage.name}" et tout son contenu ?`)) return
    await deleteVoyage(voyage.id)
    setVoyages(prev => prev.filter(v => v.id !== voyage.id))
    if (selected?.id === voyage.id) setSelected(null)
    setBackupStatus(getBackupStatus())
  }

  function handleVoyageChange(updated: Voyage) {
    setSelected(updated)
    setVoyages(prev => prev.map(v => v.id === updated.id ? updated : v))
    setBackupStatus(getBackupStatus())
  }

  useHeaderBack('Retour', onBack, !selected)

  if (selected) {
    return (
      <SillonDetail
        voyage={selected}
        onBack={() => { setSelected(null); setFocusTrackId(null) }}
        onChange={handleVoyageChange}
        onOpenTrack={onOpenTrack}
        onCreateAlbum={onCreateAlbum}
        onBook={onBook}
        focusTrackId={focusTrackId}
      />
    )
  }

  return (
    <div className="vp-page">
      <div className="vp-page__header">
        <div className="vp-page__title-row">
          <AppLogoIcon size={30} />
          <h1 className="vp-page__title">Mes sillons</h1>
        </div>
        <div className="vp-page__header-actions">
          <input ref={backupInputRef} type="file" accept="application/zip,.zip,application/json,.json,.txt,text/plain" style={{ display: 'none' }} onChange={handleImportBackup} />
          <button className="vp-btn vp-btn--sm vp-btn--ghost" disabled={!!backupBusy} onClick={handleExportBackup} title="Enregistre tous vos sillons (tracés, photos, films) dans un fichier — à déposer dans un dossier synchronisé (pCloud, Drive, OneDrive…) pour le retrouver sur un autre appareil">
            💾 Sauvegarder
          </button>
          <button className="vp-btn vp-btn--sm vp-btn--ghost" disabled={!!backupBusy} onClick={() => backupInputRef.current?.click()} title="Restaure les sillons depuis un fichier de sauvegarde">
            📂 Restaurer
          </button>
          <button className="vp-btn" onClick={() => setCreating(true)}>+ Nouveau dossier</button>
          {onAlbum && (
            <button className="vp-btn vp-btn--ghost" onClick={onAlbum}><AlbumIcon size={18} /> Créer mon affiche</button>
          )}
          {onBook && voyages.some(v => v.tracks.length > 0) && (
            <button className="vp-btn" onClick={onBook} title="Réunir les affiches de vos courses, tous sillons confondus, en un livre">📖 Créer mon livre</button>
          )}
        </div>
      </div>

      {hasContent && backupStatus.hasPendingChanges && (
        <div className="vp-backup-banner">
          <span>
            📌 Modifications non sauvegardées
            {backupStatus.lastBackupAt ? ` (dernière sauvegarde le ${formatDate(backupStatus.lastBackupAt)})` : ' — jamais sauvegardé'}
          </span>
          <button className="vp-btn vp-btn--sm" disabled={!!backupBusy} onClick={handleExportBackup}>Sauvegarder maintenant</button>
        </div>
      )}

      {creating && (
        <div className="vp-create">
          <input
            className="vp-create__input"
            autoFocus
            placeholder="Nom du sillon (ex : Saison 2026, Mes marathons…)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
          />
          <button className="vp-btn" onClick={handleCreate}>Créer</button>
          <button className="vp-btn vp-btn--ghost" onClick={() => setCreating(false)}>Annuler</button>
        </div>
      )}

      {!loading && <RecordsBanner voyages={voyages} title="Mes records" />}

      {loading ? (
        <p className="vp-empty">Chargement…</p>
      ) : voyages.length === 0 ? (
        <p className="vp-empty">Aucun sillon. À la fin d'une lecture, un popup vous proposera d'enregistrer le tracé.</p>
      ) : (
        <div className="vp-grid">
          {voyages.map(v => (
            <div key={v.id} className="vp-card" onClick={() => setSelected(v)}>
              <div className="vp-card__icon">
                {latestPoster(v) ? <PosterThumb track={latestPoster(v)!} className="vp-card__poster" /> : <svg viewBox="0 0 512 512" width="36" height="36" xmlns="http://www.w3.org/2000/svg" style={{ borderRadius: 6, display: 'block' }}>
                  <defs>
                    <linearGradient id="sg-vp" x1="330" y1="140" x2="180" y2="390" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#f0cfa8"/>
                      <stop offset="40%" stopColor="#d07840"/>
                      <stop offset="75%" stopColor="#5a8a60"/>
                      <stop offset="100%" stopColor="#1e4a2a"/>
                    </linearGradient>
                  </defs>
                  <rect width="512" height="512" fill="#000"/>
                  <path d="M 330 140 C 175 80, 50 215, 256 258 C 462 300, 340 450, 182 390" fill="none" stroke="url(#sg-vp)" strokeWidth="62" strokeLinecap="round"/>
                  <circle cx="330" cy="140" r="20" fill="#f0e0c8"/>
                  <circle cx="182" cy="390" r="20" fill="#f0f0f0"/>
                </svg>}
              </div>
              <div className="vp-card__body">
                <span className="vp-card__name">{v.name}</span>
                <span className="vp-card__meta">
                  {countLabel(v)}
                </span>
              </div>
              <button
                className="vp-card__delete"
                onClick={e => { e.stopPropagation(); handleDelete(v) }}
                title="Supprimer"
              >×</button>
            </div>
          ))}
        </div>
      )}
      {backupBusy && <BackupOverlay {...overlayProps} />}
    </div>
  )
}
