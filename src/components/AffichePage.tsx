import { useEffect, useMemo, useRef, useState } from 'react'
import type { Voyage, VoyageTrack, VoyagePhoto, PosterSettings, PosterInfo } from '../types'
import { getAllVoyages, getPhotoBlob, addPhotoToVoyage, saveTrackPoster } from '../lib/voyageDB'
import {
  buildPosterData, drawPoster, exportPoster, POSTER_BACKGROUNDS, POSTER_INFOS, POSTER_MAX_PHOTOS,
  POSTER_PRINT_PX, POSTER_SOCIAL_PX, POSTER_W, type PosterData,
} from '../lib/poster'
import { saveFileWithPicker, sanitizeFilename } from '../lib/saveFile'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { PrintOfferOverlay } from './PrintOfferOverlay'
import './AffichePage.css'

interface Props {
  onBack: () => void
  initialTrack?: { voyageId: string; trackId: string } | null
}

interface Current { voyage: Voyage; track: VoyageTrack }

function formatDate(iso?: string) {
  if (!iso) return ''
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Affiche de course : remplace l'album pour Running (une page par course, cf. lib/poster.ts). */
export function AffichePage({ onBack, initialTrack }: Props) {
  const [voyages, setVoyages] = useState<Voyage[] | null>(null)
  const [current, setCurrent] = useState<Current | null>(null)

  useEffect(() => {
    getAllVoyages().then(all => {
      setVoyages(all)
      if (initialTrack) {
        const voyage = all.find(v => v.id === initialTrack.voyageId)
        const track = voyage?.tracks.find(t => t.id === initialTrack.trackId)
        if (voyage && track) setCurrent({ voyage, track })
      }
    })
  }, [initialTrack])

  useHeaderBack('Retour', () => (current && !initialTrack ? setCurrent(null) : onBack()))

  if (!voyages) return <div className="affiche"><p className="affiche__empty">Chargement…</p></div>
  if (current) {
    return (
      <PosterEditor
        key={current.track.id}
        voyage={current.voyage}
        track={current.track}
        onVoyageChange={v => {
          setVoyages(list => list?.map(x => (x.id === v.id ? v : x)) ?? null)
          setCurrent(c => (c ? { voyage: v, track: v.tracks.find(t => t.id === c.track.id) ?? c.track } : c))
        }}
      />
    )
  }

  const tracks = voyages
    .flatMap(voyage => voyage.tracks.map(track => ({ voyage, track })))
    .sort((a, b) => (b.track.date || b.track.addedAt).localeCompare(a.track.date || a.track.addedAt))
  return (
    <div className="affiche">
      <h1 className="affiche__title">Créer l'affiche d'une course</h1>
      <p className="affiche__lead">Choisissez une course enregistrée : son affiche réunit le tracé, votre temps, vos temps de passage et le profil.</p>
      {tracks.length === 0 && (
        <p className="affiche__empty">Aucune course enregistrée pour l'instant. Importez une trace GPX, puis enregistrez-la dans « Mes sillons ».</p>
      )}
      <ul className="affiche__list">
        {tracks.map(({ voyage, track }) => (
          <li key={track.id}>
            <button type="button" className="affiche__item" onClick={() => setCurrent({ voyage, track })}>
              <strong>{track.name}</strong>
              <span>{[track.distanceM ? `${(track.distanceM / 1000).toFixed(1).replace('.', ',')} km` : '', formatDate(track.date)].filter(Boolean).join(' · ')}</span>
              <em>{track.poster ? 'Modifier l\'affiche' : 'Créer l\'affiche'} →</em>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function PosterEditor({ voyage, track, onVoyageChange }: { voyage: Voyage; track: VoyageTrack; onVoyageChange: (v: Voyage) => void }) {
  const data: PosterData | null = useMemo(() => {
    try { return buildPosterData(track) } catch (e) { console.error('[affiche]', e); return null }
  }, [track.gpxData]) // eslint-disable-line react-hooks/exhaustive-deps
  const [settings, setSettings] = useState<PosterSettings>(track.poster ?? {})
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [photoImgs, setPhotoImgs] = useState<HTMLImageElement[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [printOffer, setPrintOffer] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const renderNo = useRef(0)
  const [wrapW, setWrapW] = useState(0)

  // Photos du sillon : celles de ce tracé d'abord.
  const photos = useMemo(() => [...voyage.photos].sort((a, b) =>
    Number(b.trackId === track.id) - Number(a.trackId === track.id) || (a.takenAt || a.createdAt).localeCompare(b.takenAt || b.createdAt)),
  [voyage.photos, track.id])
  const chosenIds = (settings.photoIds ?? []).filter(id => photos.some(p => p.id === id))

  useEffect(() => {
    let alive = true
    const made: string[] = []
    Promise.all(photos.map(async p => {
      const blob = await getPhotoBlob(p.id)
      if (!blob) return null
      const url = URL.createObjectURL(blob)
      made.push(url)
      return [p.id, url] as const
    })).then(pairs => { if (alive) setPhotoUrls(Object.fromEntries(pairs.filter(Boolean) as [string, string][])) })
    return () => { alive = false; made.forEach(u => URL.revokeObjectURL(u)) }
  }, [photos])

  useEffect(() => {
    let alive = true
    Promise.all(chosenIds.map(id => (photoUrls[id] ? loadImage(photoUrls[id]).catch(() => null) : null)))
      .then(imgs => { if (alive) setPhotoImgs(imgs.filter((i): i is HTMLImageElement => !!i)) })
    return () => { alive = false }
  }, [chosenIds.join('|'), photoUrls]) // eslint-disable-line react-hooks/exhaustive-deps

  // Largeur de l'aperçu
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Aperçu : redessiné à chaque réglage (le dessin en cours est abandonné s'il devient périmé).
  useEffect(() => {
    if (!data || !canvasRef.current || !wrapW) return
    const no = ++renderNo.current
    const t = setTimeout(() => {
      const px = Math.min(POSTER_W * 2, Math.round(wrapW * (window.devicePixelRatio || 1)))
      drawPoster(canvasRef.current!, px, data, settings, photoImgs, () => no === renderNo.current)
        .catch(e => console.error('[affiche] aperçu', e))
    }, 120)
    return () => clearTimeout(t)
  }, [data, settings, photoImgs, wrapW])

  // Enregistrement des réglages (différé, pour ne pas écrire à chaque frappe).
  const savedSettings = useRef(settings)
  useEffect(() => {
    if (settings === savedSettings.current) return
    const t = setTimeout(() => {
      saveTrackPoster(voyage.id, track.id, settings).catch(e => console.error('[affiche] sauvegarde', e))
    }, 500)
    return () => clearTimeout(t)
  }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="affiche"><p className="affiche__empty">Impossible de lire la trace de cette course.</p></div>

  const set = (patch: Partial<PosterSettings>) => setSettings(s => ({ ...s, ...patch }))
  const hidden = new Set(settings.hidden ?? [])
  const toggleInfo = (id: PosterInfo) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id); else next.add(id)
    set({ hidden: [...next] })
  }
  const togglePhoto = (id: string) => {
    if (chosenIds.includes(id)) set({ photoIds: chosenIds.filter(x => x !== id) })
    else if (chosenIds.length < POSTER_MAX_PHOTOS) set({ photoIds: [...chosenIds, id] })
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    let added: VoyagePhoto[] = []
    for (const file of Array.from(files)) {
      added = [...added, await addPhotoToVoyage(voyage.id, { name: file.name, trackId: track.id, sizeBytes: file.size }, file)]
    }
    onVoyageChange({ ...voyage, photos: [...voyage.photos, ...added] })
    const room = POSTER_MAX_PHOTOS - chosenIds.length
    if (room > 0) set({ photoIds: [...chosenIds, ...added.slice(0, room).map(p => p.id)] })
  }

  async function save(kind: 'print' | 'social') {
    if (!data) return
    setBusy(kind)
    try {
      const size = kind === 'print' ? POSTER_PRINT_PX : POSTER_SOCIAL_PX
      const blob = await exportPoster(data, settings, photoImgs, size.w)
      const title = settings.title ?? data.defaults.title
      const name = `${sanitizeFilename(title)} - affiche${kind === 'print' ? ' 30x40' : ''}.jpg`
      const result = await saveFileWithPicker(blob, name, { mimeType: 'image/jpeg', extension: '.jpg', description: 'Image JPEG' })
      if (result === 'saved' && kind === 'print') setPrintOffer(true)
    } catch (e) {
      console.error('[affiche] export', e)
      alert('L\'affiche n\'a pas pu être enregistrée. Vérifiez la connexion (les fonds de carte viennent de l\'IGN), puis réessayez.')
    } finally {
      setBusy(null)
    }
  }

  const hasTimes = !!data.analysis
  const field = (label: string, key: 'title' | 'subtitle' | 'chrono' | 'bib' | 'rank', placeholder?: string) => (
    <label className="affiche__field">
      {label}
      <input
        value={settings[key] ?? (key === 'rank' ? '' : data.defaults[key])}
        placeholder={placeholder}
        onChange={e => set({ [key]: e.target.value })}
      />
    </label>
  )

  return (
    <div className="affiche affiche--editor">
      <div className="affiche__preview" ref={wrapRef}>
        <canvas ref={canvasRef} className="affiche__canvas" aria-label="Aperçu de l'affiche" />
      </div>

      <aside className="affiche__panel">
        <section className="affiche__card">
          <h2>Vos informations</h2>
          <p>Saisies par vous : l'appli ne va rien chercher ailleurs.</p>
          {field('Titre', 'title')}
          {field('Distance · date · ville', 'subtitle')}
          <div className="affiche__row">
            {field('Temps officiel', 'chrono', '1:43:10')}
            {field('Dossard', 'bib')}
          </div>
          {field('Classement', 'rank', '1 284e sur 9 512')}
          <p className="affiche__label">À afficher sur l'affiche</p>
          <div className="affiche__checks">
            {POSTER_INFOS.map(info => (
              <label key={info.id} className={info.needsTimes && !hasTimes ? 'is-off' : ''}>
                <input
                  type="checkbox"
                  checked={!hidden.has(info.id) && (!info.needsTimes || hasTimes)}
                  disabled={info.needsTimes && !hasTimes}
                  onChange={() => toggleInfo(info.id)}
                />
                {info.label}
              </label>
            ))}
          </div>
          {!hasTimes && (
            <p className="affiche__hint">
              Temps de passage indisponibles : cette trace n'a pas les heures réelles d'une course (tracé de parcours
              ou heures de planification). Ils apparaissent avec le GPX enregistré par votre montre ou votre téléphone.
            </p>
          )}
        </section>

        <section className="affiche__card">
          <h2>Fond</h2>
          <div className="affiche__seg" role="group" aria-label="Fond">
            {POSTER_BACKGROUNDS.map(b => (
              <button key={b.id} type="button" aria-pressed={(settings.background ?? 'sat') === b.id} onClick={() => set({ background: b.id })}>
                {b.label}
              </button>
            ))}
          </div>
        </section>

        <section className="affiche__card">
          <h2>Photos</h2>
          <p>Facultatives : deux au plus, l'arrivée et la médaille par exemple.</p>
          {photos.length > 0 && (
            <div className="affiche__photos">
              {photos.map(p => photoUrls[p.id] && (
                <button
                  key={p.id}
                  type="button"
                  className={chosenIds.includes(p.id) ? 'is-on' : ''}
                  onClick={() => togglePhoto(p.id)}
                  title={chosenIds.includes(p.id) ? 'Retirer de l\'affiche' : 'Mettre sur l\'affiche'}
                >
                  <img src={photoUrls[p.id]} alt="" />
                  {chosenIds.includes(p.id) && <span>{chosenIds.indexOf(p.id) + 1}</span>}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="affiche__btn affiche__btn--ghost" onClick={() => fileRef.current?.click()}>+ Ajouter une photo</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
        </section>

        <section className="affiche__card">
          <h2>Enregistrer</h2>
          <p>En haute définition pour le tirage, ou en image pour les réseaux.</p>
          <div className="affiche__btns">
            <button type="button" className="affiche__btn" disabled={!!busy} onClick={() => save('print')}>
              {busy === 'print' ? 'Préparation…' : 'Affiche 30 × 40 cm'}
            </button>
            <button type="button" className="affiche__btn affiche__btn--ghost" disabled={!!busy} onClick={() => save('social')}>
              {busy === 'social' ? 'Préparation…' : 'Image pour les réseaux'}
            </button>
          </div>
          <p className="affiche__hint">Le tirage chez nos partenaires, avec le code de réduction, vous est proposé juste après.</p>
        </section>

        <section className="affiche__card affiche__card--dossards">
          <h2>Bientôt : Mes dossards</h2>
          <p>Au fil des courses, vos affiches se rangent dans vos dossards. Réunissez-les en un livre : une page par course, vos records sur 5 km, 10 km, semi et marathon, votre progression saison après saison.</p>
        </section>
      </aside>

      {printOffer && <PrintOfferOverlay poster demo={!!voyage.demo} onClose={() => setPrintOffer(false)} />}
    </div>
  )
}
