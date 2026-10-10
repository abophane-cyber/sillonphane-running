import { useEffect, useMemo, useRef, useState } from 'react'
import type { Voyage } from '../types'
import { getAllVoyages, saveTrackBook } from '../lib/voyageDB'
import {
  BOOK_FRONT_PAGES, BOOK_MIN_PAGES, bookCourses, bookPageCount, coursePages, defaultRunnerName, inPeriod, isInBook,
  loadBookPrefs, printedPageCount, saveBookPrefs, type BookCourse, type BookPrefs,
} from '../lib/book'
import { prepareBook, type PreparedBook } from '../lib/bookExport'
import { raceResult, formatRecordTime } from '../lib/records'
import { saveFileWithPicker } from '../lib/saveFile'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { RecordsBanner, PosterThumb } from './SillonRecords'
import { PrintOfferOverlay } from './PrintOfferOverlay'
import './LivrePage.css'

interface Props {
  onBack: () => void
  /** Ouvre l'écran de l'affiche de cette course. */
  onOpenPoster: (voyageId: string, trackId: string) => void
}

type ExportState =
  | { phase: 'busy'; done: number; total: number }
  | { phase: 'ready'; book: PreparedBook; saved: { interior: boolean; cover: boolean } }
  | { phase: 'error'; message: string }

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatKm(m?: number) {
  return m ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : ''
}

const PDF_KIND = { mimeType: 'application/pdf', extension: '.pdf', description: 'Document PDF' }

/** Écran « Créer le livre » : choix des courses de tous les sillons (filtre par période), compteur de pages, export. */
export function LivrePage({ onBack, onOpenPoster }: Props) {
  const [voyages, setVoyages] = useState<Voyage[] | null>(null)
  const [prefs, setPrefs] = useState<BookPrefs>(loadBookPrefs)
  const [noteOpen, setNoteOpen] = useState<string | null>(null)
  const [exp, setExp] = useState<ExportState | null>(null)
  const [printOffer, setPrintOffer] = useState(false)
  const alive = useRef(true)

  useEffect(() => { getAllVoyages().then(setVoyages) }, [])
  useEffect(() => { saveBookPrefs(prefs) }, [prefs])
  useEffect(() => () => { alive.current = false }, [])
  useHeaderBack('Retour', onBack)

  const courses = useMemo(() => bookCourses(voyages ?? []), [voyages])
  const shown = courses.filter(c => inPeriod(c.date, prefs))
  const chosen = shown.filter(c => isInBook(c.track))
  const photoSpreads = !!prefs.photoSpreads
  const pages = bookPageCount(chosen, photoSpreads)
  const missing = Math.max(0, BOOK_MIN_PAGES - pages)
  const printed = printedPageCount(pages)
  const years = [...new Set(courses.map(c => c.date.slice(0, 4)))].sort()
  const runnerDefault = useMemo(() => defaultRunnerName(courses), [courses])

  // Records des seules courses choisies.
  const chosenIds = new Set(chosen.map(c => c.track.id))
  const chosenKey = [...chosenIds].join('|')
  const chosenVoyages = useMemo(
    () => (voyages ?? []).map(v => ({ ...v, tracks: v.tracks.filter(t => chosenIds.has(t.id)) })),
    [voyages, chosenKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Le livre préparé ne correspond plus au choix dès que celui-ci change.
  const choiceKey = JSON.stringify([chosenKey, photoSpreads, prefs.title, prefs.name])
  const exportedKey = useRef('')
  const latestKey = useRef(choiceKey)
  latestKey.current = choiceKey
  useEffect(() => {
    if (exp?.phase === 'ready' && exportedKey.current !== choiceKey) setExp(null)
  }, [choiceKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function patchTracks(ids: Set<string>, patch: { inBook?: boolean; bookNote?: string }) {
    setVoyages(vs => vs?.map(v => ({ ...v, tracks: v.tracks.map(t => (ids.has(t.id) ? { ...t, ...patch } : t)) })) ?? null)
  }

  function setInBook(list: BookCourse[], inBook: boolean) {
    const ids = new Set(list.filter(c => isInBook(c.track) !== inBook).map(c => c.track.id))
    if (!ids.size) return
    patchTracks(ids, { inBook })
    list.filter(c => ids.has(c.track.id)).forEach(c => {
      saveTrackBook(c.voyage.id, c.track.id, { inBook }).catch(e => console.error('[livre] sauvegarde', e))
    })
  }

  function saveNote(c: BookCourse, note: string) {
    const bookNote = note.trim()
    if (bookNote === (c.track.bookNote ?? '')) return
    patchTracks(new Set([c.track.id]), { bookNote })
    saveTrackBook(c.voyage.id, c.track.id, { bookNote }).catch(e => console.error('[livre] note', e))
  }

  const title = prefs.title?.trim() || 'Mes courses'
  const name = prefs.name ?? runnerDefault

  async function startExport() {
    exportedKey.current = choiceKey
    setExp({ phase: 'busy', done: 0, total: printed + 1 })
    try {
      const book = await prepareBook(chosen, { title, name: name.trim(), photoSpreads },
        (done, total) => { if (alive.current) setExp({ phase: 'busy', done, total }) }, () => alive.current)
      // Choix modifié pendant la préparation : ce livre n'est plus le bon.
      if (alive.current) setExp(latestKey.current === exportedKey.current ? { phase: 'ready', book, saved: { interior: false, cover: false } } : null)
    } catch (e) {
      console.error('[livre] export', e)
      if (alive.current) {
        setExp({ phase: 'error', message: 'Le livre n\'a pas pu être préparé. Vérifiez la connexion (les fonds de carte des affiches viennent de l\'IGN), puis réessayez.' })
      }
    }
  }

  async function save(which: 'interior' | 'cover') {
    if (exp?.phase !== 'ready') return
    const { book } = exp
    const result = which === 'interior'
      ? await saveFileWithPicker(book.interior, book.interiorName, PDF_KIND)
      : await saveFileWithPicker(book.cover, book.coverName, PDF_KIND)
    if (result !== 'saved') return
    const saved = { ...exp.saved, [which]: true }
    setExp({ ...exp, saved })
    if (saved.interior && saved.cover) setPrintOffer(true)
  }

  const setPeriod = (from?: string, to?: string) => setPrefs(p => ({ ...p, from: from || undefined, to: to || undefined }))
  const yearOn = (y: string) => prefs.from === `${y}-01-01` && prefs.to === `${y}-12-31`
  const busy = exp?.phase === 'busy'

  if (!voyages) return <div className="livre"><p className="livre__empty">Chargement…</p></div>

  return (
    <div className="livre">
      <h1 className="livre__title">Créer le livre</h1>
      <p className="livre__lead">
        Choisissez les courses de vos sillons : chacune occupe une double page (son affiche, et en face son carnet :
        temps de passage, profil, photos, votre note). En tête du livre : page de titre, records, progression, palmarès
        et sommaire.
      </p>

      {courses.length === 0 ? (
        <p className="livre__empty">
          Aucune course dans Mes sillons pour l'instant. Importez une trace GPX, enregistrez-la dans un sillon, puis
          créez son affiche.
        </p>
      ) : (
        <>
          <section className="livre__counter" aria-live="polite">
            <div className="livre__counter-row">
              <strong>{pages} pages</strong>
              <span> sur {BOOK_MIN_PAGES} minimum</span>
              <span className="livre__counter-detail">
                · {chosen.length} course{chosen.length > 1 ? 's' : ''}
                {chosen.length > 0 && ` + ${BOOK_FRONT_PAGES} pages d'en-tête`}
              </span>
            </div>
            <div className="livre__bar"><span style={{ width: `${Math.min(100, (pages / BOOK_MIN_PAGES) * 100)}%` }} /></div>
            <p className="livre__counter-note">
              {missing > 0
                ? `Encore ${missing} page${missing > 1 ? 's' : ''} : l'imprimeur (WhiteWall) demande ${BOOK_MIN_PAGES} pages au moins. Ajoutez des courses, élargissez la période${photoSpreads ? '' : ' ou ajoutez les doubles pages photos'}.`
                : printed > pages
                  ? `Assez de pages pour l'impression. Le fichier en comptera ${printed} : WhiteWall relie les pages par 4, des pages blanches complètent la fin.`
                  : 'Assez de pages pour l\'impression.'}
            </p>

            {exp?.phase === 'busy' && (
              <div className="livre__progress">
                <span>Préparation du livre… page {Math.min(exp.done + 1, exp.total)} sur {exp.total}</span>
                <div className="livre__bar"><span style={{ width: `${(exp.done / exp.total) * 100}%` }} /></div>
                <small>Gardez cet écran ouvert : chaque affiche est redessinée en haute définition.</small>
              </div>
            )}
            {exp?.phase === 'error' && <p className="livre__error">{exp.message}</p>}
            {exp?.phase === 'ready' ? (
              <div className="livre__ready">
                <p>
                  <strong>Votre livre est prêt : {exp.book.pages} pages.</strong> WhiteWall demande deux fichiers :
                  enregistrez-les l'un après l'autre.
                </p>
                <div className="livre__ready-btns">
                  <button type="button" className="vp-btn" onClick={() => save('interior')}>
                    {exp.saved.interior ? '✓ ' : '1. '}Pages intérieures (PDF)
                  </button>
                  <button type="button" className="vp-btn" onClick={() => save('cover')}>
                    {exp.saved.cover ? '✓ ' : '2. '}Couverture (PDF)
                  </button>
                  {(exp.saved.interior || exp.saved.cover) && (
                    <button type="button" className="vp-btn vp-btn--ghost" onClick={() => setPrintOffer(true)}>Imprimer chez WhiteWall</button>
                  )}
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="vp-btn livre__export"
                disabled={missing > 0 || busy || !chosen.length}
                title={missing > 0 ? 'Pas assez de pages' : undefined}
                onClick={startExport}
              >
                {busy ? 'Préparation…' : 'Exporter le livre'}
              </button>
            )}
          </section>

          <section className="livre__sec">
            <h2 className="livre__h">Le livre</h2>
            <div className="livre__fields">
              <label>Titre<input value={prefs.title ?? ''} placeholder="Mes courses" onChange={e => setPrefs(p => ({ ...p, title: e.target.value }))} /></label>
              <label>Votre nom<input value={name} placeholder="Alex Martin" onChange={e => setPrefs(p => ({ ...p, name: e.target.value }))} /></label>
            </div>
          </section>

          <section className="livre__sec">
            <h2 className="livre__h">Période</h2>
            <div className="livre__chips" role="group" aria-label="Période">
              <button type="button" aria-pressed={!prefs.from && !prefs.to} onClick={() => setPeriod()}>Toutes</button>
              {years.map(y => (
                <button key={y} type="button" aria-pressed={yearOn(y)} onClick={() => setPeriod(`${y}-01-01`, `${y}-12-31`)}>{y}</button>
              ))}
            </div>
            <div className="livre__dates">
              <label>Du <input type="date" value={prefs.from ?? ''} onChange={e => setPeriod(e.target.value, prefs.to)} /></label>
              <label>au <input type="date" value={prefs.to ?? ''} onChange={e => setPeriod(prefs.from, e.target.value)} /></label>
            </div>
            <label className="livre__option">
              <input
                type="checkbox"
                checked={photoSpreads}
                onChange={e => setPrefs(p => ({ ...p, photoSpreads: e.target.checked }))}
              />
              Ajouter une double page de photos aux courses qui en ont
            </label>
          </section>

          <section className="livre__sec">
            <div className="livre__list-head">
              <h2 className="livre__h">Courses ({chosen.length} sur {shown.length})</h2>
              {shown.length > 0 && (
                <div className="livre__all">
                  <button type="button" onClick={() => setInBook(shown, true)}>Tout cocher</button>
                  <button type="button" onClick={() => setInBook(shown, false)}>Tout décocher</button>
                </div>
              )}
            </div>
            {shown.length === 0 && <p className="livre__empty">Aucune course sur cette période.</p>}
            <ul className="livre__list">
              {shown.map(c => {
                const on = isInBook(c.track)
                const result = raceResult(c.voyage.id, c.track)
                const n = coursePages(c, photoSpreads)
                const note = c.track.bookNote ?? ''
                return (
                  <li key={c.track.id} className={`livre__item${on ? ' is-on' : ''}`}>
                    <div className="livre__row">
                      <label className="livre__check">
                        <input type="checkbox" checked={on} onChange={() => setInBook([c], !on)} aria-label={`Inclure ${c.track.poster?.title || c.track.name} dans le livre`} />
                      </label>
                      {c.track.poster
                        ? <PosterThumb track={c.track} className="livre__thumb" />
                        : <span className="livre__thumb livre__thumb--none">Affiche<br />à faire</span>}
                      <div className="livre__body">
                        <span className="livre__date">{formatDate(c.date)}</span>
                        <strong className="livre__name">{c.track.poster?.title || c.track.name}</strong>
                        <span className="livre__meta">
                          {[formatKm(c.track.distanceM), result && `${formatRecordTime(result.timeS)}${result.gps ? ' (GPS)' : ''}`,
                            `sillon « ${c.voyage.name} »`].filter(Boolean).join(' · ')}
                        </span>
                        {on && <span className="livre__pages">{n} pages{n > 2 ? ' (dont photos)' : ''}</span>}
                      </div>
                      <div className="livre__actions">
                        <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" onClick={() => setNoteOpen(id => (id === c.track.id ? null : c.track.id))}>
                          {note ? '✎ Note' : '+ Note'}
                        </button>
                        <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" onClick={() => onOpenPoster(c.voyage.id, c.track.id)}>
                          {c.track.poster ? 'Modifier l\'affiche' : 'Créer l\'affiche'}
                        </button>
                      </div>
                    </div>
                    {noteOpen === c.track.id && (
                      <textarea
                        className="livre__note"
                        defaultValue={note}
                        autoFocus
                        rows={3}
                        maxLength={600}
                        placeholder="Un souvenir de cette course, écrit dans son carnet : la météo, le public, le dernier kilomètre…"
                        onBlur={e => saveNote(c, e.target.value)}
                      />
                    )}
                    {noteOpen !== c.track.id && note && <p className="livre__note-text">« {note} »</p>}
                  </li>
                )
              })}
            </ul>
            {chosen.some(c => !c.track.poster) && (
              <p className="livre__hint">Les courses sans affiche entreront dans le livre avec une affiche par défaut : créez-la pour la personnaliser.</p>
            )}
          </section>

          {chosen.length > 0 && <RecordsBanner voyages={chosenVoyages} title="Records du livre" />}
        </>
      )}

      {printOffer && exp?.phase === 'ready' && (
        <PrintOfferOverlay
          partnerId="whitewall"
          pageNote={`Indiquez ${exp.book.pages} pages chez WhiteWall, puis téléversez les pages intérieures et la couverture.`}
          demo={chosen.some(c => c.voyage.demo)}
          onClose={() => setPrintOffer(false)}
        />
      )}
    </div>
  )
}
