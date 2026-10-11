import { useEffect, useMemo, useState } from 'react'
import type { VoyagePhoto } from '../types'
import { FRONT_PAGES, frontPageCount, frontPages, type BookCourse, type BookLayout, type BookPrefs, type CoverBg, type FrontPageId } from '../lib/book'
import type { BookOptions, PreviewTarget } from '../lib/bookExport'
import { RECORD_CATEGORIES, raceResult, type RecordCategory } from '../lib/records'
import { getPhotoBlob } from '../lib/voyageDB'
import { LivreApercu } from './LivreApercu'

interface Props {
  /** Courses choisies pour le livre. */
  courses: BookCourse[]
  /** Options du livre telles qu'exportées (titre et nom par défaut résolus). */
  options: BookOptions
  prefs: BookPrefs
  setPrefs: (update: (p: BookPrefs) => BookPrefs) => void
  /** Nom proposé (celui des affiches). */
  nameDefault: string
  previewKey: string
  pages: number
  minPages: number
  /** Retour à « Créer le livre ». */
  onClose: () => void
}

type Tab = 'couverture' | 'pages'

const COVER_BGS: { id: CoverBg; label: string; swatch: string }[] = [
  { id: 'nuit', label: 'Vert nuit', swatch: '#121714' },
  { id: 'noir', label: 'Noir', swatch: '#0B0B0A' },
  { id: 'papier', label: 'Papier crème', swatch: '#F6F2EA' },
  { id: 'photo', label: 'Une photo', swatch: 'linear-gradient(135deg,#6b8f71,#d9a066)' },
]

/** Photos montrées au choix de la couverture, au plus. */
const MAX_COVER_PHOTOS = 48

/** Écran « Mise en page du livre » : couverture (fond, photo, textes, tracés), 4e de couverture, pages d'en-tête
 * gardées, cases de la page Records, contenu des carnets ; l'aperçu montre la page en cours de réglage. */
export function LivreMiseEnPage({ courses, options, prefs, setPrefs, nameDefault, previewKey, pages, minPages, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('couverture')
  const [focus, setFocus] = useState<PreviewTarget>('front')
  const layout = prefs.layout ?? {}
  const setLayout = (patch: Partial<BookLayout>) => setPrefs(p => ({ ...p, layout: { ...p.layout, ...patch } }))

  // Photos des courses choisies, pour le fond « photo ».
  const photos = useMemo(() => {
    const seen = new Set<string>()
    const out: VoyagePhoto[] = []
    for (const c of courses) {
      for (const p of c.voyage.photos) {
        if (seen.has(p.id) || !(p.trackId === c.track.id || c.track.poster?.photoIds?.includes(p.id))) continue
        seen.add(p.id); out.push(p)
      }
    }
    return out.slice(0, MAX_COVER_PHOTOS)
  }, [courses])
  const photoKey = photos.map(p => p.id).join('|')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    if (layout.coverBg !== 'photo') return
    let live = true
    const urls: string[] = []
    ;(async () => {
      for (const p of photos) {
        const blob = await getPhotoBlob(p.id).catch(() => null)
        if (!live) return
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        urls.push(url)
        setThumbs(t => ({ ...t, [p.id]: url }))
      }
    })()
    return () => { live = false; urls.forEach(u => URL.revokeObjectURL(u)); setThumbs({}) }
  }, [photoKey, layout.coverBg === 'photo']) // eslint-disable-line react-hooks/exhaustive-deps

  // Distances courues (avec un temps) parmi les courses choisies.
  const runCats = useMemo(() => new Set(courses.map(c => raceResult(c.voyage.id, c.track)?.category).filter(Boolean)), [courses])

  const kept = frontPages(layout)
  const front = frontPageCount(layout)
  const cats = layout.recordCats ?? RECORD_CATEGORIES.map(c => c.id)

  function toggleFront(id: FrontPageId) {
    const hidden = layout.hidden ?? []
    setLayout({ hidden: hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id] })
    if (hidden.includes(id)) setFocus(id)
  }
  function toggleCat(id: RecordCategory) {
    const next = cats.includes(id) ? cats.filter(c => c !== id) : [...cats, id]
    setLayout({ recordCats: RECORD_CATEGORIES.map(c => c.id).filter(c => next.includes(c)) })
  }
  function pickBg(bg: CoverBg) {
    setLayout({ coverBg: bg, ...(bg === 'photo' && !layout.coverPhotoId && photos[0] ? { coverPhotoId: photos[0].id } : {}) })
  }

  const sec = (target: PreviewTarget) => ({ onPointerDown: () => setFocus(target), onFocusCapture: () => setFocus(target) })
  const recordsOn = kept.includes('records')

  return (
    <div className="livre livre--wide">
      <div className="livre-mep__head">
        <h1 className="livre__title">Mise en page du livre</h1>
        <button type="button" className="vp-btn vp-btn--sm" onClick={onClose}>✓ Terminé</button>
      </div>
      <p className="livre__lead">
        Réglez la couverture et les pages intérieures : l'aperçu montre la page que vous modifiez. Chaque réglage vaut pour
        tout le livre ; les affiches se modifient depuis la liste des courses.
      </p>

      <div className="livre-mep">
        <div className="livre-mep__preview">
          <LivreApercu courses={courses} options={options} bookKey={previewKey} paused={false} focus={focus} />
          <p className={`livre-mep__count${pages < minPages ? ' is-short' : ''}`}>
            {pages} pages sur {minPages} minimum · dont {front} page{front > 1 ? 's' : ''} d'en-tête
          </p>
        </div>

        <div className="livre-mep__panel">
          <div className="livre__chips livre-mep__tabs" role="tablist">
            <button type="button" role="tab" aria-pressed={tab === 'couverture'} onClick={() => { setTab('couverture'); setFocus('front') }}>Couverture</button>
            <button type="button" role="tab" aria-pressed={tab === 'pages'} onClick={() => { setTab('pages'); setFocus(kept[0] ?? 'carnet') }}>Pages intérieures</button>
          </div>

          {tab === 'couverture' && (
            <>
              <section className="livre__sec" {...sec('front')}>
                <h2 className="livre__h">1re de couverture</h2>
                <div className="livre__fields">
                  <label>Titre<input value={prefs.title ?? ''} placeholder="Mes courses" onChange={e => setPrefs(p => ({ ...p, title: e.target.value }))} /></label>
                  <label>Sous-titre<input value={layout.coverSubtitle ?? ''} placeholder="La période (ex. 2025 — 2026)" onChange={e => setLayout({ coverSubtitle: e.target.value })} /></label>
                  <label>Votre nom<input value={prefs.name ?? nameDefault} placeholder="Alex Martin" onChange={e => setPrefs(p => ({ ...p, name: e.target.value }))} /></label>
                </div>
                <p className="livre__label">Fond</p>
                <div className="livre-mep__swatches" role="group" aria-label="Fond de la couverture">
                  {COVER_BGS.map(b => (
                    <button key={b.id} type="button" aria-pressed={(layout.coverBg ?? 'nuit') === b.id} onClick={() => pickBg(b.id)}
                      disabled={b.id === 'photo' && !photos.length} title={b.id === 'photo' && !photos.length ? 'Aucune photo dans les courses choisies' : undefined}>
                      <span style={{ background: b.swatch }} />{b.label}
                    </button>
                  ))}
                </div>
                {layout.coverBg === 'photo' && (
                  <div className="livre-mep__photos" role="group" aria-label="Photo de couverture">
                    {photos.map(p => (
                      <button key={p.id} type="button" aria-pressed={layout.coverPhotoId === p.id} onClick={() => setLayout({ coverPhotoId: p.id })} title={p.name}>
                        {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.name} /> : <span />}
                      </button>
                    ))}
                  </div>
                )}
                <p className="livre__label">Titre</p>
                <div className="livre__chips" role="group" aria-label="Place du titre">
                  <button type="button" aria-pressed={layout.coverTitlePos !== 'bas'} onClick={() => setLayout({ coverTitlePos: 'haut' })}>En haut</button>
                  <button type="button" aria-pressed={layout.coverTitlePos === 'bas'} onClick={() => setLayout({ coverTitlePos: 'bas' })}>En bas</button>
                </div>
                <label className="livre__option">
                  <input type="checkbox" checked={layout.coverTraces ?? layout.coverBg !== 'photo'} onChange={e => setLayout({ coverTraces: e.target.checked })} />
                  Tracés des courses
                </label>
              </section>

              <section className="livre__sec" {...sec('back')}>
                <h2 className="livre__h">4e de couverture</h2>
                <label className="livre__option">
                  <input type="checkbox" checked={layout.backRecords !== false} onChange={e => setLayout({ backRecords: e.target.checked })} />
                  Records, nombre de courses et kilomètres
                </label>
                <textarea
                  className="livre__note"
                  rows={4}
                  maxLength={500}
                  value={layout.backText ?? ''}
                  placeholder="Un texte au dos du livre (facultatif) : une dédicace, la saison en quelques mots…"
                  onChange={e => setLayout({ backText: e.target.value })}
                />
              </section>
            </>
          )}

          {tab === 'pages' && (
            <>
              <section className="livre__sec">
                <h2 className="livre__h">Pages d'en-tête</h2>
                {FRONT_PAGES.map(p => (
                  <label key={p.id} className="livre__option" onPointerDown={() => kept.includes(p.id) && setFocus(p.id)}>
                    <input type="checkbox" checked={kept.includes(p.id)} onChange={() => toggleFront(p.id)} />
                    {p.label}
                  </label>
                ))}
                {kept.length % 2 === 0 && (
                  <p className="livre__hint">
                    Une page blanche complète l'en-tête : chaque course commence ainsi sur une page de gauche (affiche à
                    gauche, carnet en face).
                  </p>
                )}
              </section>

              <section className={`livre__sec${recordsOn ? '' : ' is-off'}`} {...sec('records')}>
                <h2 className="livre__h">Page Records</h2>
                <p className="livre__label">Distances affichées</p>
                <div className="livre__chips" role="group" aria-label="Distances de la page Records">
                  {RECORD_CATEGORIES.map(c => (
                    <button key={c.id} type="button" disabled={!recordsOn} aria-pressed={cats.includes(c.id)} onClick={() => toggleCat(c.id)}
                      title={runCats.has(c.id) ? undefined : 'Aucun temps sur cette distance'}>
                      {c.label}{runCats.has(c.id) ? '' : ' —'}
                    </button>
                  ))}
                </div>
                <div className="livre__all livre-mep__quick">
                  <button type="button" disabled={!recordsOn || !runCats.size}
                    onClick={() => setLayout({ recordCats: RECORD_CATEGORIES.map(c => c.id).filter(c => runCats.has(c)) })}>
                    Seulement mes distances
                  </button>
                  <button type="button" disabled={!recordsOn} onClick={() => setLayout({ recordCats: undefined })}>Les quatre</button>
                </div>
                <label className="livre__option">
                  <input type="checkbox" disabled={!recordsOn} checked={layout.recordTotals !== false} onChange={e => setLayout({ recordTotals: e.target.checked })} />
                  Totaux en bas de page (courses, km, temps de course)
                </label>
                {!recordsOn && <p className="livre__hint">Page retirée du livre.</p>}
              </section>

              <section className="livre__sec" {...sec('carnet')}>
                <h2 className="livre__h">Carnet de chaque course</h2>
                <p className="livre__hint livre-mep__sub">Page en face de l'affiche : titre et chiffres de la course, puis…</p>
                <label className="livre__option">
                  <input type="checkbox" checked={layout.carnetSplits !== false} onChange={e => setLayout({ carnetSplits: e.target.checked })} />
                  Temps de passage
                </label>
                <label className="livre__option">
                  <input type="checkbox" checked={layout.carnetProfile !== false} onChange={e => setLayout({ carnetProfile: e.target.checked })} />
                  Profil de la course
                </label>
                <label className="livre__option">
                  <input type="checkbox" checked={layout.carnetPhotos !== false} onChange={e => setLayout({ carnetPhotos: e.target.checked })} />
                  Photos (2 au plus)
                </label>
              </section>
            </>
          )}

          <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost livre-mep__reset" disabled={!prefs.layout}
            onClick={() => setPrefs(p => ({ ...p, layout: undefined }))}>
            Revenir à la mise en page d'origine
          </button>
        </div>
      </div>
    </div>
  )
}
