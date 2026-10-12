import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { VoyagePhoto } from '../types'
import { FRONT_PAGES, frontPageCount, frontPages, type BookCourse, type BookLayout, type BookPrefs, type CoverBg, type FrontPageId } from '../lib/book'
import type { BookOptions, PreviewTarget } from '../lib/bookExport'
import { RECORD_CATEGORIES, raceResult, type RecordCategory } from '../lib/records'
import { getPhotoBlob } from '../lib/voyageDB'
import { DEFAULT_COVER_MOTTO, DEFAULT_COVER_TAGLINE, defaultTraceBox, traceAspect, type CoverModel } from '../lib/bookCover'
import { buildPosterData } from '../lib/poster'
import { CoverTraceHandles } from './CoverTraceHandles'
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
  /** Boutons Sauvegarder / Restaurer, en haut à droite (comme sur les autres pages). */
  tools?: ReactNode
}

type Tab = 'couverture' | 'pages'

const COVER_BGS: { id: CoverBg; label: string; swatch: string }[] = [
  { id: 'nuit', label: 'Vert nuit', swatch: '#121714' },
  { id: 'papier', label: 'Papier crème', swatch: '#F6F2EA' },
  { id: 'photo', label: 'Une photo', swatch: 'linear-gradient(135deg,#6b8f71,#d9a066)' },
  { id: 'vagues', label: 'Vagues', swatch: 'linear-gradient(160deg,#F3F1EC 0 45%,#EE7F2D 45% 60%,#1E2A33 60%)' },
]

/** Modèles de la couverture photo (cf. lib/bookCover.ts). */
const COVER_MODELS: { id: CoverModel; label: string; hint: string }[] = [
  { id: 'photo', label: 'Photo', hint: 'La photo en fond, le titre en haut, jusqu\'à 3 tracés en bas.' },
  { id: 'dessin', label: 'Dessin', hint: 'La photo redessinée à l\'encre sépia sur papier crème, 3 tracés en bas.' },
  { id: 'illustration', label: 'Illustration', hint: 'La photo en affiche illustrée qui se fond dans le papier, un tracé sous le titre.' },
]
const MAX_COVER_TRACES = 3

/** Photos montrées au choix de la couverture, au plus. */
const MAX_COVER_PHOTOS = 48

/** Écran « Mise en page du livre » : couverture (fond, photo, textes, tracés), 4e de couverture, pages d'en-tête
 * gardées, cases de la page Records, contenu des carnets ; l'aperçu montre la page en cours de réglage. */
export function LivreMiseEnPage({ courses, options, prefs, setPrefs, nameDefault, previewKey, pages, minPages, onClose, tools }: Props) {
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

  // Couverture photo : modèle et tracés montrés (absent = les 3 premières courses ; même règle que coverItems).
  const model: CoverModel = layout.coverModel ?? 'photo'
  const traceIds = (layout.coverTraceIds ?? courses.map(c => c.track.id)).filter(id => courses.some(c => c.track.id === id))
    .slice(0, MAX_COVER_TRACES)
  // Un seul tracé : modèle illustration et fond vagues.
  const single = layout.coverBg === 'vagues' || model === 'illustration'
  function toggleTrace(id: string) {
    if (single) { setLayout({ coverTraceIds: [id, ...traceIds.filter(t => t !== id)] }); return }
    const next = traceIds.includes(id) ? traceIds.filter(t => t !== id) : [...traceIds, id].slice(0, MAX_COVER_TRACES)
    // Ordre des courses (chronologique), pas celui des clics.
    setLayout({ coverTraceIds: courses.map(c => c.track.id).filter(t => next.includes(t)) })
  }

  // Couverture vagues : cadre à poignées sur l'aperçu pour placer et dimensionner le tracé.
  const vaguesTrack = layout.coverBg === 'vagues' ? courses.find(c => c.track.id === traceIds[0])?.track : undefined
  const vaguesAspect = useMemo(() => {
    if (!vaguesTrack) return 1
    try { return traceAspect(buildPosterData(vaguesTrack).points) } catch { return 1 }
  }, [vaguesTrack])
  const frameRatio = options.printer.profile.pageCm.w / options.printer.profile.pageCm.h
  const traceHandles = vaguesTrack && (
    <CoverTraceHandles
      box={layout.coverTraceBox ?? defaultTraceBox(vaguesAspect, frameRatio)}
      aspect={vaguesAspect}
      frameRatio={frameRatio}
      onChange={box => setLayout({ coverTraceBox: box })}
    />
  )

  const sec = (target: PreviewTarget) => ({ onPointerDown: () => setFocus(target), onFocusCapture: () => setFocus(target) })
  const recordsOn = kept.includes('records')

  return (
    <div className="livre livre--wide">
      {tools}
      <button type="button" className="livre__back" onClick={onClose}>← Le livre</button>
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
          <LivreApercu courses={courses} options={options} bookKey={previewKey} paused={false} focus={focus} frontOverlay={traceHandles || undefined} />
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
                    <button key={b.id} type="button" aria-pressed={(COVER_BGS.some(c => c.id === layout.coverBg) ? layout.coverBg : 'nuit') === b.id} onClick={() => pickBg(b.id)}
                      disabled={b.id === 'photo' && !photos.length} title={b.id === 'photo' && !photos.length ? 'Aucune photo dans les courses choisies' : undefined}>
                      <span style={{ background: b.swatch }} />{b.label}
                    </button>
                  ))}
                </div>
                {layout.coverBg === 'photo' || layout.coverBg === 'vagues' ? (
                  <>
                    {layout.coverBg === 'photo' && (<>
                    <p className="livre__label">Photo</p>
                    <div className="livre-mep__photos" role="group" aria-label="Photo de couverture">
                      {photos.map(p => (
                        <button key={p.id} type="button" aria-pressed={layout.coverPhotoId === p.id} onClick={() => setLayout({ coverPhotoId: p.id })} title={p.name}>
                          {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.name} /> : <span />}
                        </button>
                      ))}
                    </div>
                    <p className="livre__label">Modèle</p>
                    <div className="livre__chips" role="group" aria-label="Modèle de couverture">
                      {COVER_MODELS.map(m => (
                        <button key={m.id} type="button" aria-pressed={model === m.id} onClick={() => setLayout({ coverModel: m.id })} title={m.hint}>{m.label}</button>
                      ))}
                    </div>
                    <p className="livre__hint">{COVER_MODELS.find(m => m.id === model)?.hint}</p>
                    </>)}
                    {layout.coverBg === 'vagues' && (
                      <>
                        <p className="livre__hint">
                          Sans photo : vagues bleu nuit et orange, une course en grand avec sa date, sa distance et son D+.
                          Sur l'aperçu, glissez le cadre pointillé pour déplacer le tracé, tirez un coin pour changer sa taille.
                        </p>
                        {layout.coverTraceBox && (
                          <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost livre-mep__reset" onClick={() => setLayout({ coverTraceBox: undefined })}>
                            Remettre le tracé à sa place
                          </button>
                        )}
                      </>
                    )}
                    <p className="livre__label">Devise en haut à droite (un mot ou groupe de mots par ligne)</p>
                    <textarea
                      className="livre__note"
                      rows={4}
                      maxLength={160}
                      value={layout.coverMotto ?? DEFAULT_COVER_MOTTO}
                      placeholder="Laissez vide pour ne rien afficher"
                      onChange={e => setLayout({ coverMotto: e.target.value })}
                    />
                    {layout.coverBg === 'photo' && model === 'dessin' && (
                      <div className="livre__fields">
                        <label>Phrase du bas
                          <input value={layout.coverTagline ?? DEFAULT_COVER_TAGLINE} maxLength={60} placeholder="Laissez vide pour ne rien afficher"
                            onChange={e => setLayout({ coverTagline: e.target.value })} />
                        </label>
                      </div>
                    )}
                    {(layout.coverMotto !== undefined || layout.coverTagline !== undefined) && (
                      <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost livre-mep__reset" onClick={() => setLayout({ coverMotto: undefined, coverTagline: undefined })}>
                        Remettre les textes d'origine
                      </button>
                    )}
                    <p className="livre__label">
                      {single ? 'Tracé sur la couverture' : `Tracés sur la couverture (${MAX_COVER_TRACES} au plus)`}
                    </p>
                    {courses.map(c => {
                      const on = traceIds.includes(c.track.id)
                      const full = single ? traceIds.length >= 1 : traceIds.length >= MAX_COVER_TRACES
                      return (
                        <label key={c.track.id} className="livre__option">
                          <input
                            type={single ? 'radio' : 'checkbox'}
                            name="livre-cover-trace"
                            checked={single ? traceIds[0] === c.track.id : on}
                            disabled={!single && !on && full}
                            onChange={() => toggleTrace(c.track.id)}
                          />
                          {c.track.poster?.title || c.track.name} · {new Date(`${c.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </label>
                      )
                    })}
                  </>
                ) : (
                  <>
                    <p className="livre__label">Titre</p>
                    <div className="livre__chips" role="group" aria-label="Place du titre">
                      <button type="button" aria-pressed={layout.coverTitlePos !== 'bas'} onClick={() => setLayout({ coverTitlePos: 'haut' })}>En haut</button>
                      <button type="button" aria-pressed={layout.coverTitlePos === 'bas'} onClick={() => setLayout({ coverTitlePos: 'bas' })}>En bas</button>
                    </div>
                    <label className="livre__option">
                      <input type="checkbox" checked={layout.coverTraces ?? true} onChange={e => setLayout({ coverTraces: e.target.checked })} />
                      Tracés des courses
                    </label>
                  </>
                )}
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
