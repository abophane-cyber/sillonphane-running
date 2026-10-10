import { useEffect, useMemo, useRef, useState } from 'react'
import type { Voyage, VoyageTrack, VoyagePhoto, PosterSettings, PosterInfo, PosterStyle } from '../types'
import { getAllVoyages, getPhotoBlob, addPhotoToVoyage, saveTrackPoster, saveTrackInBook } from '../lib/voyageDB'
import { BOOK_MIN_PAGES, isInBook } from '../lib/book'
import {
  buildPosterData, computedPace, drawPoster, exportPoster, posterBackground, posterFond, posterFormat, posterHeight,
  posterRibbon, posterStyle, POSTER_BACKGROUNDS, POSTER_FONDS, POSTER_FORMATS, POSTER_INFOS, POSTER_MAX_PHOTOS,
  POSTER_RIBBONS, POSTER_SOCIAL_W, POSTER_STYLES, POSTER_W, type PosterData,
} from '../lib/poster'
import { saveFileWithPicker, sanitizeFilename } from '../lib/saveFile'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { PrintOfferOverlay } from './PrintOfferOverlay'
import './AffichePage.css'

interface Props {
  onBack: () => void
  initialTrack?: { voyageId: string; trackId: string } | null
  /** Ouvre l'écran « Créer le livre ». */
  onBook?: () => void
}

interface Current { voyage: Voyage; track: VoyageTrack }

function formatDate(iso?: string) {
  if (!iso) return ''
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Affiche de course : remplace l'album pour Running (une page par course, cf. lib/poster.ts). */
export function AffichePage({ onBack, initialTrack, onBook }: Props) {
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
        onBook={onBook}
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

/** Titre de section numéroté : « 01  La course ». */
function Head({ n, children, note }: { n: string; children: string; note?: string }) {
  return <h2 className="aff-head"><span>{n}</span>{children}{note && <small> {note}</small>}</h2>
}

/** Pastille d'une couleur de parcours : dégradé (logo, vert · orange · crème) ou couleur unie. */
function ribbonSwatch(id: string): string {
  if (id === 'logo') return 'linear-gradient(0deg, #2F4839, #C15C3D, #F5F3EF)'
  if (id === 'trois-couleurs') return 'linear-gradient(90deg, #3DB54A 33%, #F07D1A 33% 66%, #F7EBD3 66%)'
  return id
}

function PosterEditor({ voyage, track, onVoyageChange, onBook }: {
  voyage: Voyage; track: VoyageTrack; onVoyageChange: (v: Voyage) => void; onBook?: () => void
}) {
  const data: PosterData | null = useMemo(() => {
    try { return buildPosterData(track) } catch (e) { console.error('[affiche]', e); return null }
  }, [track.gpxData]) // eslint-disable-line react-hooks/exhaustive-deps
  const [settings, setSettings] = useState<PosterSettings>(track.poster ?? {})
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [photoImgs, setPhotoImgs] = useState<HTMLImageElement[]>([])
  const [pickFromSillon, setPickFromSillon] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'print' | 'social' | null>(null)
  const [printOffer, setPrintOffer] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const thumbRefs = useRef<Partial<Record<PosterStyle, HTMLCanvasElement | null>>>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const renderNo = useRef(0)
  const thumbNo = useRef(0)
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

  // Vignettes des trois styles, avec les informations de la course (redessinées moins souvent).
  useEffect(() => {
    if (!data) return
    const no = ++thumbNo.current
    const t = setTimeout(async () => {
      for (const st of POSTER_STYLES) {
        const c = thumbRefs.current[st.id]
        if (!c || no !== thumbNo.current) continue
        const s: PosterSettings = { ...settings, style: st.id, fond: undefined, background: undefined, ribbon: undefined, paper: undefined }
        await drawPoster(c, 240, data, s, photoImgs, () => no === thumbNo.current).catch(() => {})
      }
    }, 700)
    return () => clearTimeout(t)
  }, [data, settings.title, settings.name, settings.chrono, settings.city, settings.date, settings.distance, // eslint-disable-line react-hooks/exhaustive-deps
    settings.format, settings.hidden, settings.bib, settings.rank, photoImgs])

  // Enregistrement des réglages (différé, pour ne pas écrire à chaque frappe).
  const savedSettings = useRef(settings)
  useEffect(() => {
    if (settings === savedSettings.current) return
    const t = setTimeout(() => {
      saveTrackPoster(voyage.id, track.id, settings).catch(e => console.error('[affiche] sauvegarde', e))
    }, 500)
    return () => clearTimeout(t)
  }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Livre : choix explicite, sinon la course y entre dès que son affiche existe (modifiée ici ou déjà enregistrée).
  const [bookChoice, setBookChoice] = useState<boolean | undefined>(track.inBook)
  const inBook = bookChoice ?? (isInBook(track) || settings !== savedSettings.current)
  function toggleInBook(on: boolean) {
    setBookChoice(on)
    saveTrackInBook(voyage.id, track.id, on).catch(e => console.error('[affiche] livre', e))
    onVoyageChange({ ...voyage, tracks: voyage.tracks.map(t => (t.id === track.id ? { ...t, inBook: on } : t)) })
  }

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
  /** Place la photo `id` à l'emplacement `to` (ordre = placement sur l'affiche) ; l'autre photo prend sa place. */
  const swapPhoto = (id: string, to: number) => {
    const from = chosenIds.indexOf(id)
    if (from < 0 || to < 0 || to >= chosenIds.length || to === from) return
    const next = [...chosenIds]
    ;[next[from], next[to]] = [next[to], next[from]]
    set({ photoIds: next })
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

  const format = posterFormat(settings)
  async function download(purpose: 'print' | 'social') {
    if (!data) return
    setBusy(purpose)
    try {
      const blob = await exportPoster(data, settings, photoImgs, purpose)
      const title = settings.title ?? data.defaults.title
      const name = `${sanitizeFilename(title)} - affiche ${format.label}${purpose === 'social' ? ' réseaux' : ''}.jpg`
      const result = await saveFileWithPicker(blob, name, { mimeType: 'image/jpeg', extension: '.jpg', description: 'Image JPEG' })
      if (result === 'saved' && purpose === 'print') setPrintOffer(true)
    } catch (e) {
      console.error('[affiche] export', e)
      alert('L\'affiche n\'a pas pu être enregistrée. Vérifiez la connexion (les fonds de carte viennent de l\'IGN), puis réessayez.')
    } finally {
      setBusy(null)
    }
  }

  const hasTimes = !!data.analysis
  const style = posterStyle(settings)
  const fond = posterFond(settings)
  const ribbon = posterRibbon(settings)
  const background = posterBackground(settings)
  const text = (key: 'title' | 'distance' | 'city' | 'chrono' | 'bib') => settings[key] ?? data.defaults[key]
  const input = (key: keyof PosterSettings, value: string, placeholder?: string, type = 'text') => (
    <input type={type} value={value} placeholder={placeholder} onChange={e => set({ [key]: e.target.value })} />
  )
  const others = photos.filter(p => !chosenIds.includes(p.id) && photoUrls[p.id])

  return (
    <div className="affiche affiche--editor">
      <aside className="affiche__panel affiche__panel--left">
        <section className="aff-sec">
          <Head n="01">La course</Head>
          <label className="aff-field">Nom de la course{input('title', text('title'))}</label>
          <div className="aff-row">
            <label className="aff-field">Distance{input('distance', text('distance'), '21,1 km')}</label>
            <label className="aff-field">Date{input('date', settings.date ?? data.defaults.date, undefined, 'date')}</label>
          </div>
          <label className="aff-field">Ville{input('city', text('city'), 'Lille')}</label>
        </section>

        <section className="aff-sec">
          <Head n="02" note="(optionnel)">Votre nom</Head>
          <label className="aff-field">Votre nom ou pseudo{input('name', settings.name ?? '', 'Alex Martin')}</label>
          <p className="aff-hint">Il apparaîtra en haut de l'affiche, comme sur un dossard.</p>
        </section>

        <section className="aff-sec">
          <Head n="03">Vos performances</Head>
          <div className="aff-row">
            <label className="aff-field">Temps officiel{input('chrono', text('chrono'), '1:43:10')}</label>
            <label className="aff-field">Dossard{input('bib', text('bib'), '254')}</label>
          </div>
          <div className="aff-row">
            <label className="aff-field">Classement{input('rank', settings.rank ?? '', '742')}</label>
            <label className="aff-field">Allure moyenne{input('pace', settings.pace ?? computedPace(data, settings), '4\'53" / km')}</label>
          </div>
          <p className="aff-hint">Saisis par vous : l'appli ne va rien chercher ailleurs.</p>
        </section>

        <section className="aff-sec">
          <Head n="04" note={`(${POSTER_MAX_PHOTOS} max)`}>Vos photos</Head>
          <div className="aff-photos">
            {chosenIds.map((id, i) => (
              <div
                key={id}
                className={`aff-photo${dragId === id ? ' is-drag' : ''}`}
                draggable={chosenIds.length > 1}
                title={chosenIds.length > 1 ? 'Glisser pour intervertir' : undefined}
                onDragStart={e => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }}
                onDragEnd={() => setDragId(null)}
                onDragOver={e => { if (dragId && dragId !== id) e.preventDefault() }}
                onDrop={e => { e.preventDefault(); if (dragId) swapPhoto(dragId, i); setDragId(null) }}
              >
                {photoUrls[id] && <img src={photoUrls[id]} alt="" draggable={false} />}
                {chosenIds.length > 1 && <span className="aff-photo-num">{i + 1}</span>}
                <button type="button" aria-label="Retirer la photo" onClick={() => togglePhoto(id)}>×</button>
                {chosenIds.length > 1 && (
                  <div className="aff-photo-move">
                    <button type="button" aria-label="Avancer la photo" disabled={i === 0} onClick={() => swapPhoto(id, i - 1)}>‹</button>
                    <button type="button" aria-label="Reculer la photo" disabled={i === chosenIds.length - 1} onClick={() => swapPhoto(id, i + 1)}>›</button>
                  </div>
                )}
              </div>
            ))}
            {chosenIds.length < POSTER_MAX_PHOTOS && (
              <button type="button" className="aff-photo aff-photo--add" onClick={() => fileRef.current?.click()}>
                <span>+</span>Ajouter une photo
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
          {others.length > 0 && chosenIds.length < POSTER_MAX_PHOTOS && (
            <>
              <button type="button" className="aff-link" onClick={() => setPickFromSillon(v => !v)}>
                {pickFromSillon ? 'Masquer les photos du sillon' : `Choisir parmi les photos du sillon (${others.length})`}
              </button>
              {pickFromSillon && (
                <div className="aff-pick">
                  {others.map(p => (
                    <button key={p.id} type="button" onClick={() => togglePhoto(p.id)} title="Mettre sur l'affiche">
                      <img src={photoUrls[p.id]} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="aff-sec">
          <Head n="05">Éléments à afficher</Head>
          <div className="aff-checks">
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
            <p className="aff-hint">
              Temps de passage indisponibles : cette trace n'a pas les heures réelles d'une course. Ils apparaissent avec
              le GPX enregistré par votre montre ou votre téléphone.
            </p>
          )}
        </section>
      </aside>

      <div className="affiche__preview" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="affiche__canvas"
          style={{ aspectRatio: `${POSTER_W} / ${posterHeight(settings)}` }}
          aria-label="Aperçu de l'affiche"
        />
        <div className="aff-box">
          <p>
            <strong>Pour l'impression</strong> ({format.label}, {format.sub}, haute qualité) : le logo et la marque
            Sillonphane sont retirés du fichier ; seule l'adresse sillonphane.fr/running reste, toute petite, dans la marge
            du bas. Le tirage chez nos partenaires, avec le
            code de réduction, vous est proposé juste après.
          </p>
          <p>
            <strong>Pour les réseaux</strong> : image de {POSTER_SOCIAL_W} px de large, avec le logo et « Sillonphane.fr »
            en bas.
          </p>
          <div className="aff-book">
            <p>
              <strong>Livre.</strong> Réunissez les affiches de vos courses, tous sillons confondus, en un livre : une
              double page par course, avec vos records sur 5 km, 10 km, semi et marathon et votre progression
              ({BOOK_MIN_PAGES} pages au moins pour l'impression).
            </p>
            <label className="aff-book__check">
              <input type="checkbox" checked={inBook} onChange={e => toggleInBook(e.target.checked)} />
              Inclure dans le livre
            </label>
            {onBook && <button type="button" className="aff-link" onClick={onBook}>Créer le livre →</button>}
          </div>
        </div>
      </div>

      <aside className="affiche__panel affiche__panel--right">
        <section className="aff-sec">
          <Head n="06">Style de l'affiche</Head>
          <div className="aff-seg" role="group" aria-label="Style de l'affiche">
            {POSTER_STYLES.map(st => (
              <button
                key={st.id}
                type="button"
                aria-pressed={style === st.id}
                onClick={() => set({ style: st.id, fond: undefined, background: undefined, ribbon: undefined, paper: undefined })}
              >
                {st.label}
              </button>
            ))}
          </div>
          <div className="aff-thumbs">
            {POSTER_STYLES.map(st => (
              <button
                key={st.id}
                type="button"
                className={style === st.id ? 'is-on' : ''}
                aria-label={st.label}
                onClick={() => set({ style: st.id, fond: undefined, background: undefined, ribbon: undefined, paper: undefined })}
              >
                <canvas ref={el => { thumbRefs.current[st.id] = el }} style={{ aspectRatio: `${POSTER_W} / ${posterHeight(settings)}` }} />
              </button>
            ))}
          </div>
        </section>

        <section className="aff-sec">
          <Head n="07">Fond de l'affiche</Head>
          <div className="aff-fonds" role="group" aria-label="Fond de l'affiche">
            {POSTER_FONDS.map(f => (
              <button key={f.id} type="button" aria-pressed={fond.id === f.id} onClick={() => set({ fond: f.id, paper: undefined })}>
                <span className={`aff-fond aff-fond--${f.texture ?? 'uni'}`} style={{ backgroundColor: f.color }} />
                {f.label}
              </button>
            ))}
          </div>
          <p className="aff-label">Carte</p>
          <div className="aff-seg aff-seg--small" role="group" aria-label="Fond de carte">
            {POSTER_BACKGROUNDS.map(b => (
              <button key={b.id} type="button" aria-pressed={background === b.id} onClick={() => set({ background: b.id })}>
                {b.label}
              </button>
            ))}
          </div>
        </section>

        <section className="aff-sec">
          <Head n="08">Couleur du parcours</Head>
          <div className="aff-colors" role="group" aria-label="Couleur du parcours">
            {POSTER_RIBBONS.map(c => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={ribbon === c.id}
                style={{ background: ribbonSwatch(c.id) }}
                onClick={() => set({ ribbon: c.id })}
              />
            ))}
            <label
              className="aff-wheel"
              title="Couleur unie : choisir à la roue"
              aria-pressed={ribbon.startsWith('#')}
            >
              {ribbon.startsWith('#') && <span style={{ background: ribbon }} />}
              <input
                type="color"
                aria-label="Couleur unie"
                value={ribbon.startsWith('#') ? ribbon.toLowerCase() : '#ec6a2c'}
                onChange={e => set({ ribbon: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="aff-notrace"
              title="Sans tracé"
              aria-label="Sans tracé"
              aria-pressed={ribbon === 'aucun'}
              onClick={() => set({ ribbon: 'aucun' })}
            />
          </div>
        </section>

        <section className="aff-sec">
          <Head n="09">Format &amp; export</Head>
          <div className="aff-formats" role="group" aria-label="Format">
            {POSTER_FORMATS.map(f => (
              <button key={f.id} type="button" aria-pressed={format.id === f.id} onClick={() => set({ format: f.id })}>
                <span className={`aff-format-ic aff-format-ic--${f.id}`} />
                <strong>{f.label}</strong>
                <small>({f.sub})</small>
              </button>
            ))}
          </div>
          <button type="button" className="aff-download" disabled={!!busy} onClick={() => download('print')}>
            {busy === 'print' ? 'Préparation…' : '⤓  Télécharger pour l\'impression'}
          </button>
          <button type="button" className="aff-download aff-download--ghost" disabled={!!busy} onClick={() => download('social')}>
            {busy === 'social' ? 'Préparation…' : '⤓  Télécharger pour les réseaux'}
          </button>
        </section>
      </aside>

      {printOffer && <PrintOfferOverlay poster demo={!!voyage.demo} onClose={() => setPrintOffer(false)} />}
    </div>
  )
}
