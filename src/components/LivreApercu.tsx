import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BookCourse } from '../lib/book'
import { openBookPreview, type BookOptions, type BookPreview, type PreviewSide, type PreviewTarget } from '../lib/bookExport'

interface Props {
  courses: BookCourse[]
  options: BookOptions
  /** Change dès que le livre change (courses, notes, titre, imprimeur…) : l'aperçu est alors refait. */
  bookKey: string
  /** Export en cours : rien n'est dessiné (le format de page est commun à l'export et à l'aperçu). */
  paused: boolean
  /** Page à montrer (écran « Mise en page du livre ») : l'aperçu y revient à chaque réglage. */
  focus?: PreviewTarget
  /** Calque posé sur la 1re de couverture (moitié droite de la vue « Couverture »), hors plein écran : poignées du
   * tracé de la couverture vagues. */
  frontOverlay?: ReactNode
}

/** Largeur de dessin d'une double page (px) : assez pour lire les titres, léger pour un téléphone. */
const RENDER_W = 1200
/** Plein écran : dessin à la taille de l'écran (densité de pixels comprise), plafonné pour la mémoire. */
const FULL_MAX_W = 3000

function viewLabel([l, r]: [PreviewSide, PreviewSide]): string {
  if (r === 'front') return 'Couverture'
  if (l === 'back') return '4e de couverture'
  if (typeof l === 'number' && typeof r === 'number') return `Pages ${l} – ${r}`
  return `Page ${typeof l === 'number' ? l : r}`
}

/** Largeur de dessin plein écran : double page logée dans la fenêtre, barre de navigation comprise. */
function fullWidth(ratio: number): number {
  const w = Math.min(window.innerWidth - 32, (window.innerHeight - 110) * ratio)
  return Math.min(FULL_MAX_W, Math.round(Math.max(320, w) * (window.devicePixelRatio || 1)))
}

/** Vues dessinées d'un aperçu, par largeur de dessin puis par vue. */
interface Images { preview: BookPreview | null; byWidth: Map<number, Map<number, string>> }

/** Aperçu du livre, feuilleté double page par double page, dessiné comme l'export (en basse définition) ; plein écran
 * sur demande. */
export function LivreApercu({ courses, options, bookKey, paused, focus, frontOverlay }: Props) {
  const [preview, setPreview] = useState<BookPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState(0)
  const [full, setFull] = useState(false)
  // L'image d'un aperçu précédent reste affichée (estompée) le temps de dessiner la nouvelle.
  const [images, setImages] = useState<Images>({ preview: null, byWidth: new Map() })
  const imagesRef = useRef(images)
  imagesRef.current = images
  const latest = useRef({ courses, options })
  latest.current = { courses, options }

  // Aperçu refait (après une courte pause, le temps de finir de taper le titre) dès que le livre change.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      openBookPreview(latest.current.courses, latest.current.options)
        .then(p => { if (live) { setPreview(p); setFailed(false) } })
        .catch(e => { console.error('[livre] aperçu', e); if (live) { setPreview(null); setFailed(true) } })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [bookKey])

  // Page réglée : montrée dès qu'on la choisit et après chaque réglage (l'aperçu refait).
  useEffect(() => {
    if (!preview || !focus) return
    const i = preview.viewOf(focus)
    if (i >= 0) setView(i)
  }, [preview, focus])

  const count = preview?.views.length ?? 0
  const current = Math.min(view, Math.max(0, count - 1))
  const ratio = preview ? preview.pageRatio * 2 : 2 * 27.3 / 21.1
  const width = full ? fullWidth(ratio) : RENDER_W

  // Dessin de la vue affichée, puis des voisines (feuilletage sans attente), une à la fois.
  useEffect(() => {
    if (!preview || paused) return
    let live = true
    const isLive = () => live
    ;(async () => {
      for (const i of [current, current + 1, current - 1]) {
        if (i < 0 || i >= preview.views.length) continue
        const cur = imagesRef.current
        if (cur.preview === preview && cur.byWidth.get(width)?.has(i)) continue
        try {
          const c = await preview.renderView(i, width, isLive)
          if (!c || !live) return
          const url = c.toDataURL('image/jpeg', full ? 0.9 : 0.85)
          c.width = c.height = 0
          const s = imagesRef.current
          const byWidth = new Map(s.preview === preview ? s.byWidth : [])
          byWidth.set(width, new Map(byWidth.get(width) ?? []).set(i, url))
          imagesRef.current = { preview, byWidth }
          setImages(imagesRef.current)
        } catch (e) {
          console.error('[livre] aperçu de la vue', i, e)
        }
      }
    })()
    return () => { live = false }
  }, [preview, current, paused, width, full])

  const prev = () => setView(Math.max(0, current - 1))
  const next = () => setView(Math.min(count - 1, current + 1))

  // Plein écran : flèches du clavier et Échap.
  useEffect(() => {
    if (!full) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFull(false)
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Flèches du clavier quand l'aperçu (dans la page) a le focus.
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    if (e.key === 'ArrowRight') { e.preventDefault(); next() }
  }

  if (failed) return <p className="livre__empty">L'aperçu n'a pas pu être dessiné.</p>

  // Image de la vue : à la bonne largeur, sinon à une autre largeur du même aperçu (en attendant), sinon d'un aperçu
  // précédent (estompée).
  const same = images.preview === preview
  const exact = same ? images.byWidth.get(width)?.get(current) : undefined
  const any = [...images.byWidth.values()].map(m => m.get(current)).find(Boolean)
  const src = exact ?? any
  const stale = !src || !same
  const label = preview ? viewLabel(preview.views[current]) : ''

  const onFront = !!preview && preview.views[current]?.[1] === 'front'
  const stage = (cls: string, width?: string, overlay?: ReactNode) => (
    <div className={cls} style={{ aspectRatio: String(ratio), width }}>
      {src && <img src={src} alt={preview ? `Aperçu : ${label}` : 'Aperçu'} className={stale ? 'is-stale' : ''} />}
      {overlay && onFront && (
        <div className="livre-apercu__front" onClick={e => e.stopPropagation()}>{overlay}</div>
      )}
      {!exact && (!src || stale) && (
        <span className="livre-apercu__wait">{paused ? 'Aperçu en pause pendant l\'export…' : 'Dessin de l\'aperçu…'}</span>
      )}
    </div>
  )

  const nav = (inFull: boolean) => preview && (
    <div className="livre-apercu__nav">
      <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" disabled={current === 0} onClick={prev} aria-label="Vue précédente">‹</button>
      <input type="range" min={0} max={count - 1} value={current} onChange={e => setView(Number(e.target.value))} aria-label="Feuilleter le livre" />
      <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" disabled={current >= count - 1} onClick={next} aria-label="Vue suivante">›</button>
      <span className="livre-apercu__label">{label} <small>· {preview.pages} pages</small></span>
      <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" onClick={() => setFull(!inFull)}>
        {inFull ? '✕ Fermer' : '⛶ Plein écran'}
      </button>
    </div>
  )

  return (
    <div className="livre-apercu" tabIndex={0} onKeyDown={onKey} aria-label="Aperçu du livre">
      <div onClick={() => preview && setFull(true)} className="livre-apercu__open" title="Voir en plein écran">
        {stage('livre-apercu__stage', undefined, frontOverlay)}
      </div>
      {nav(false)}
      {full && createPortal(
        <div className="livre-apercu-full" role="dialog" aria-modal="true" aria-label={`Aperçu du livre : ${label}`}>
          <div className="livre-apercu-full__body" onClick={e => { if (e.target === e.currentTarget) setFull(false) }}>
            <button type="button" className="livre-apercu-full__side is-prev" disabled={current === 0} onClick={prev} aria-label="Vue précédente">‹</button>
            {stage('livre-apercu__stage livre-apercu-full__stage', `min(calc(100vw - 32px), calc((100dvh - 110px) * ${ratio}))`)}
            <button type="button" className="livre-apercu-full__side is-next" disabled={current >= count - 1} onClick={next} aria-label="Vue suivante">›</button>
          </div>
          {nav(true)}
        </div>,
        document.body,
      )}
    </div>
  )
}
