import { useEffect, useMemo, useState } from 'react'
import type { Voyage } from '../types'
import { getAllVoyages, saveTrackInBook } from '../lib/voyageDB'
import {
  BOOK_FRONT_PAGES, BOOK_MIN_PAGES, bookCourses, bookPageCount, coursePages, inPeriod, isInBook,
  loadBookPrefs, saveBookPrefs, type BookCourse, type BookPrefs,
} from '../lib/book'
import { raceResult, formatRecordTime } from '../lib/records'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { RecordsBanner, PosterThumb } from './SillonRecords'
import './LivrePage.css'

interface Props {
  onBack: () => void
  /** Ouvre l'écran de l'affiche de cette course. */
  onOpenPoster: (voyageId: string, trackId: string) => void
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatKm(m?: number) {
  return m ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : ''
}

/** Écran « Créer le livre » : choix des courses de tous les sillons (filtre par période) et compteur de pages. */
export function LivrePage({ onBack, onOpenPoster }: Props) {
  const [voyages, setVoyages] = useState<Voyage[] | null>(null)
  const [prefs, setPrefs] = useState<BookPrefs>(loadBookPrefs)

  useEffect(() => { getAllVoyages().then(setVoyages) }, [])
  useEffect(() => { saveBookPrefs(prefs) }, [prefs])
  useHeaderBack('Retour', onBack)

  const courses = useMemo(() => bookCourses(voyages ?? []), [voyages])
  const shown = courses.filter(c => inPeriod(c.date, prefs))
  const chosen = shown.filter(c => isInBook(c.track))
  const photoSpreads = !!prefs.photoSpreads
  const pages = bookPageCount(chosen, photoSpreads)
  const missing = Math.max(0, BOOK_MIN_PAGES - pages)
  const years = [...new Set(courses.map(c => c.date.slice(0, 4)))].sort()

  // Records des seules courses choisies.
  const chosenIds = new Set(chosen.map(c => c.track.id))
  const chosenKey = [...chosenIds].join('|')
  const chosenVoyages = useMemo(
    () => (voyages ?? []).map(v => ({ ...v, tracks: v.tracks.filter(t => chosenIds.has(t.id)) })),
    [voyages, chosenKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  function setInBook(list: BookCourse[], inBook: boolean) {
    const ids = new Set(list.filter(c => isInBook(c.track) !== inBook).map(c => c.track.id))
    if (!ids.size) return
    setVoyages(vs => vs?.map(v => ({ ...v, tracks: v.tracks.map(t => (ids.has(t.id) ? { ...t, inBook } : t)) })) ?? null)
    list.filter(c => ids.has(c.track.id)).forEach(c => {
      saveTrackInBook(c.voyage.id, c.track.id, inBook).catch(e => console.error('[livre] sauvegarde', e))
    })
  }

  const setPeriod = (from?: string, to?: string) => setPrefs(p => ({ ...p, from: from || undefined, to: to || undefined }))
  const yearOn = (y: string) => prefs.from === `${y}-01-01` && prefs.to === `${y}-12-31`

  if (!voyages) return <div className="livre"><p className="livre__empty">Chargement…</p></div>

  return (
    <div className="livre">
      <h1 className="livre__title">Créer le livre</h1>
      <p className="livre__lead">
        Choisissez les courses de vos sillons : chacune occupe une double page (son affiche, et en face son carnet :
        temps de passage, profil, photos). En tête du livre : vos records, votre progression, votre palmarès et le
        sommaire.
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
                : 'Assez de pages pour l\'impression.'}
            </p>
            <button type="button" className="vp-btn livre__export" disabled title={missing > 0 ? 'Pas assez de pages' : 'L\'export du livre arrive bientôt'}>
              {missing > 0 ? 'Exporter le livre' : 'Exporter le livre (bientôt)'}
            </button>
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
                return (
                  <li key={c.track.id} className={`livre__item${on ? ' is-on' : ''}`}>
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
                    <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost livre__poster-btn" onClick={() => onOpenPoster(c.voyage.id, c.track.id)}>
                      {c.track.poster ? 'Modifier l\'affiche' : 'Créer l\'affiche'}
                    </button>
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
    </div>
  )
}
