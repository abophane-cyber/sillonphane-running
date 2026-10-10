import { useEffect, useRef, useState } from 'react'
import type { BookCourse } from '../lib/book'
import { openBookPreview, type BookOptions, type BookPreview, type PreviewSide } from '../lib/bookExport'

interface Props {
  courses: BookCourse[]
  options: BookOptions
  /** Change dès que le livre change (courses, notes, titre, imprimeur…) : l'aperçu est alors refait. */
  bookKey: string
  /** Export en cours : rien n'est dessiné (le format de page est commun à l'export et à l'aperçu). */
  paused: boolean
}

/** Largeur de dessin d'une double page (px) : assez pour lire les titres, léger pour un téléphone. */
const RENDER_W = 1200

function viewLabel([l, r]: [PreviewSide, PreviewSide]): string {
  if (r === 'front') return 'Couverture'
  if (l === 'back') return '4e de couverture'
  if (typeof l === 'number' && typeof r === 'number') return `Pages ${l} – ${r}`
  return `Page ${typeof l === 'number' ? l : r}`
}

/** Aperçu du livre, feuilleté double page par double page, dessiné comme l'export (en basse définition). */
export function LivreApercu({ courses, options, bookKey, paused }: Props) {
  const [preview, setPreview] = useState<BookPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState(0)
  // Vues dessinées, par aperçu : l'ancienne image reste affichée (estompée) le temps de dessiner la nouvelle.
  const [images, setImages] = useState<{ preview: BookPreview | null; urls: Map<number, string> }>({ preview: null, urls: new Map() })
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

  const count = preview?.views.length ?? 0
  const current = Math.min(view, Math.max(0, count - 1))

  // Dessin de la vue affichée, puis des voisines (feuilletage sans attente), une à la fois.
  useEffect(() => {
    if (!preview || paused) return
    let live = true
    const isLive = () => live
    ;(async () => {
      for (const i of [current, current + 1, current - 1]) {
        if (i < 0 || i >= preview.views.length) continue
        if (imagesRef.current.preview === preview && imagesRef.current.urls.has(i)) continue
        try {
          const c = await preview.renderView(i, RENDER_W, isLive)
          if (!c || !live) return
          const url = c.toDataURL('image/jpeg', 0.85)
          c.width = c.height = 0
          const s = imagesRef.current
          imagesRef.current = { preview, urls: new Map(s.preview === preview ? s.urls : []).set(i, url) }
          setImages(imagesRef.current)
        } catch (e) {
          console.error('[livre] aperçu de la vue', i, e)
        }
      }
    })()
    return () => { live = false }
  }, [preview, current, paused])

  // Flèches du clavier quand l'aperçu a le focus.
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setView(Math.max(0, current - 1)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setView(Math.min(count - 1, current + 1)) }
  }

  if (failed) return <p className="livre__empty">L'aperçu n'a pas pu être dessiné.</p>
  const fresh = images.preview === preview ? images.urls.get(current) : undefined
  const src = fresh ?? images.urls.get(current)
  const ratio = preview ? preview.pageRatio * 2 : 2 * 27.3 / 21.1

  return (
    <div className="livre-apercu" tabIndex={0} onKeyDown={onKey} aria-label="Aperçu du livre">
      <div className="livre-apercu__stage" style={{ aspectRatio: String(ratio) }}>
        {src && <img src={src} alt={preview ? `Aperçu : ${viewLabel(preview.views[current])}` : 'Aperçu'} className={fresh ? '' : 'is-stale'} />}
        {!fresh && <span className="livre-apercu__wait">{paused ? 'Aperçu en pause pendant l\'export…' : 'Dessin de l\'aperçu…'}</span>}
      </div>
      {preview && (
        <div className="livre-apercu__nav">
          <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" disabled={current === 0} onClick={() => setView(current - 1)} aria-label="Vue précédente">‹</button>
          <input
            type="range" min={0} max={count - 1} value={current}
            onChange={e => setView(Number(e.target.value))}
            aria-label="Feuilleter le livre"
          />
          <button type="button" className="vp-btn vp-btn--sm vp-btn--ghost" disabled={current >= count - 1} onClick={() => setView(current + 1)} aria-label="Vue suivante">›</button>
          <span className="livre-apercu__label">{viewLabel(preview.views[current])} <small>· {preview.pages} pages</small></span>
        </div>
      )}
    </div>
  )
}
