import { useEffect, useMemo, useRef, useState } from 'react'
import type { Voyage } from '../types'
import { getAllVoyages, saveTrackBook } from '../lib/voyageDB'
import {
  BOOK_PRINTERS, bookCourses, bookPrinter, bookPageCount, coursePages, defaultRunnerName, frontPageCount, inPeriod, isInBook,
  loadBookPrefs, printedPageCount, saveBookPrefs, type BookCourse, type BookPrefs,
} from '../lib/book'
import { prepareBook, type PreparedBook } from '../lib/bookExport'
import { raceResult, formatRecordTime } from '../lib/records'
import { saveFileWithPicker } from '../lib/saveFile'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { useBackupControls } from '../hooks/useBackupControls'
import { BackupTools } from './BackupTools'
import { RecordsBanner, PosterThumb } from './SillonRecords'
import { BookIcon } from './SillonDetailParts'
import { PrintOfferOverlay } from './PrintOfferOverlay'
import { LivreApercu } from './LivreApercu'
import { LivreMiseEnPage } from './LivreMiseEnPage'
import './LivrePage.css'

interface Props {
  onBack: () => void
  /** Ouvre l'écran de l'affiche de cette course. */
  onOpenPoster: (voyageId: string, trackId: string) => void
}

type ExportState =
  | { phase: 'busy'; done: number; total: number }
  | { phase: 'ready'; book: PreparedBook; saved: boolean[] }
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
  // Écran « Mise en page du livre » (couverture et pages intérieures) ouvert par-dessus la liste.
  const [editing, setEditing] = useState(false)
  const alive = useRef(true)

  useEffect(() => { getAllVoyages().then(setVoyages) }, [])
  // Sauvegarder / Restaurer en haut à droite ; une restauration recharge les courses.
  const backup = useBackupControls({ onImported: async () => { setVoyages(await getAllVoyages()) } })
  const tools = <BackupTools backup={backup} />
  useEffect(() => { saveBookPrefs(prefs) }, [prefs])
  useEffect(() => () => { alive.current = false }, [])
  useHeaderBack('Retour', () => (editing ? setEditing(false) : onBack()))

  const courses = useMemo(() => bookCourses(voyages ?? []), [voyages])
  const shown = courses.filter(c => inPeriod(c.date, prefs))
  const chosen = shown.filter(c => isInBook(c.track))
  const photoSpreads = !!prefs.photoSpreads
  const layout = prefs.layout ?? {}
  const pages = bookPageCount(chosen, photoSpreads, layout)
  const printer = bookPrinter(prefs.printer)
  const minPages = printer.minPages
  const wrap = printer.profile.coverMode === 'wrap-spread'
  const missing = Math.max(0, minPages - pages)
  const printed = printedPageCount(pages, printer)
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
  const choiceKey = JSON.stringify([chosenKey, photoSpreads, prefs.title, prefs.name, printer.id, layout])
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
  // Tout ce que l'aperçu dessine : choix, réglages, affiches et notes des courses.
  const previewKey = JSON.stringify([chosenKey, photoSpreads, title, name.trim(), printer.id, layout,
    chosen.map(c => [c.track.bookNote, c.track.poster])])
  const bookOptions = { title, name: name.trim(), photoSpreads, printer, layout }

  async function startExport() {
    exportedKey.current = choiceKey
    setExp({ phase: 'busy', done: 0, total: printed + (wrap ? 1 : 2) })
    try {
      const book = await prepareBook(chosen, bookOptions,
        (done, total) => { if (alive.current) setExp({ phase: 'busy', done, total }) }, () => alive.current)
      // Choix modifié pendant la préparation : ce livre n'est plus le bon.
      if (alive.current) setExp(latestKey.current === exportedKey.current ? { phase: 'ready', book, saved: book.files.map(() => false) } : null)
    } catch (e) {
      console.error('[livre] export', e)
      if (alive.current) {
        setExp({ phase: 'error', message: 'Le livre n\'a pas pu être préparé. Vérifiez la connexion (les fonds de carte des affiches viennent de l\'IGN), puis réessayez.' })
      }
    }
  }

  async function save(i: number) {
    if (exp?.phase !== 'ready') return
    const file = exp.book.files[i]
    if (await saveFileWithPicker(file.blob, file.name, PDF_KIND) !== 'saved') return
    const saved = exp.saved.map((s, j) => s || j === i)
    setExp({ ...exp, saved })
    if (saved.every(Boolean)) setPrintOffer(true)
  }

  const setPeriod = (from?: string, to?: string) => setPrefs(p => ({ ...p, from: from || undefined, to: to || undefined }))
  const yearOn = (y: string) => prefs.from === `${y}-01-01` && prefs.to === `${y}-12-31`
  const busy = exp?.phase === 'busy'

  if (!voyages) return <div className="livre"><p className="livre__empty">Chargement…</p></div>

  if (editing && chosen.length > 0) {
    return (
      <LivreMiseEnPage
        courses={chosen}
        options={bookOptions}
        prefs={prefs}
        setPrefs={setPrefs}
        nameDefault={runnerDefault}
        previewKey={previewKey}
        pages={pages}
        minPages={minPages}
        onClose={() => setEditing(false)}
        tools={tools}
      />
    )
  }

  return (
    <div className="livre">
      {tools}
      <button type="button" className="livre__back" onClick={onBack}>← Mes sillons</button>
      <header className="livre__head">
        <span className="livre__badge"><BookIcon size={40} /></span>
        <h1 className="livre__title">Créer mon livre</h1>
      </header>
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
              <span> sur {minPages} minimum</span>
              <span className="livre__counter-detail">
                · {chosen.length} course{chosen.length > 1 ? 's' : ''}
                {chosen.length > 0 && ` + ${frontPageCount(layout)} page${frontPageCount(layout) > 1 ? 's' : ''} d'en-tête`}
              </span>
            </div>
            <div className="livre__bar"><span style={{ width: `${Math.min(100, (pages / minPages) * 100)}%` }} /></div>
            <p className="livre__counter-note">
              {missing > 0
                ? `Encore ${missing} page${missing > 1 ? 's' : ''} : ${printer.label} demande ${minPages} pages au moins. Ajoutez des courses, élargissez la période${photoSpreads ? '' : ' ou ajoutez les doubles pages photos'}.`
                : printed > pages
                  ? `Assez de pages pour l'impression. Le livre en comptera ${printed} : ${printer.label} relie les pages par 4, des pages blanches complètent la fin.`
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
                  <strong>Votre livre est prêt : {exp.book.pages} pages.</strong>{' '}
                  {exp.book.files.length > 1
                    ? `${printer.label} demande ${exp.book.files.length} fichiers : enregistrez-les l'un après l'autre.`
                    : 'Un seul fichier, couverture comprise (en première et dernière page).'}
                </p>
                <div className="livre__ready-btns">
                  {exp.book.files.map((file, i) => (
                    <button key={file.name} type="button" className="vp-btn" onClick={() => save(i)}>
                      {exp.saved[i] ? '✓ ' : exp.book.files.length > 1 ? `${i + 1}. ` : ''}{file.label}
                    </button>
                  ))}
                  {exp.saved.some(Boolean) && (
                    <button type="button" className="vp-btn vp-btn--ghost" onClick={() => setPrintOffer(true)}>Imprimer chez {printer.label}</button>
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

          {chosen.length > 0 && (
            <section className="livre__sec">
              <div className="livre__list-head">
                <h2 className="livre__h">Aperçu du livre</h2>
                <button type="button" className="vp-btn vp-btn--sm" disabled={busy} onClick={() => setEditing(true)}>
                  ✎ Modifier la couverture et les pages
                </button>
              </div>
              <LivreApercu
                courses={chosen}
                options={bookOptions}
                bookKey={previewKey}
                paused={busy}
              />
            </section>
          )}

          <section className="livre__sec">
            <h2 className="livre__h">Le livre</h2>
            <div className="livre__fields">
              <label>Titre<input value={prefs.title ?? ''} placeholder="Mes courses" onChange={e => setPrefs(p => ({ ...p, title: e.target.value }))} /></label>
              <label>Votre nom<input value={name} placeholder="Alex Martin" onChange={e => setPrefs(p => ({ ...p, name: e.target.value }))} /></label>
            </div>
            <p className="livre__label">Imprimeur</p>
            <div className="livre__printers" role="group" aria-label="Imprimeur">
              {BOOK_PRINTERS.map(p => (
                <button key={p.id} type="button" aria-pressed={printer.id === p.id} onClick={() => setPrefs(x => ({ ...x, printer: p.id }))}>
                  <strong>{p.label}</strong>
                  <span>
                    {p.minPages} pages au moins · {p.profile.pageCm.w.toLocaleString('fr-FR')} × {p.profile.pageCm.h.toLocaleString('fr-FR')} cm
                    {p.profile.coverMode === 'wrap-spread' ? ' · intérieur et couverture en 2 PDF' : ' · un seul PDF'}
                    {p.profile.tag ? ` · ${p.profile.tag}` : ''}
                  </span>
                </button>
              ))}
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
          partnerId={printer.id}
          pageNote={exp.book.files.length > 1
            ? `Indiquez ${exp.book.pages} pages chez ${printer.label}, puis téléversez les pages intérieures et la couverture.`
            : `Livre de ${exp.book.pages} pages intérieures, couverture comprise dans le fichier : téléversez-le chez ${printer.label}.`}
          demo={chosen.some(c => c.voyage.demo)}
          onClose={() => setPrintOffer(false)}
        />
      )}
    </div>
  )
}
