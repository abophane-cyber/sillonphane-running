import { useEffect, useRef, useState } from 'react'
import type { TraceBox } from '../lib/bookCover'

interface Props {
  /** Place actuelle du tracé (fractions du cadre de la 1re de couverture). */
  box: TraceBox
  /** Largeur / hauteur du tracé. */
  aspect: number
  /** Largeur / hauteur de la 1re de couverture. */
  frameRatio: number
  /** Appelé au lâcher (déplacement ou redimensionnement terminé). */
  onChange: (box: TraceBox) => void
}

type Drag = { kind: 'move' | 'size'; x0: number; y0: number; start: TraceBox }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Cadre du tracé sur l'aperçu de la couverture : glisser pour le déplacer, tirer un coin pour l'agrandir ou le
 * réduire (proportions gardées, autour de son centre). L'aperçu est redessiné au lâcher. */
export function CoverTraceHandles({ box, aspect, frameRatio, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<TraceBox | null>(null)
  const drag = useRef<Drag | null>(null)
  useEffect(() => { setLive(null) }, [box.cx, box.cy, box.w])

  const b = live ?? box
  const h = b.w * frameRatio / aspect

  function down(kind: Drag['kind'], e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { kind, x0: e.clientX, y0: e.clientY, start: b }
  }
  function move(e: React.PointerEvent) {
    const d = drag.current, r = ref.current?.getBoundingClientRect()
    if (!d || !r) return
    if (d.kind === 'move') {
      setLive({ ...d.start, cx: clamp(d.start.cx + (e.clientX - d.x0) / r.width, 0, 1), cy: clamp(d.start.cy + (e.clientY - d.y0) / r.height, 0, 1) })
    } else {
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height
      const w = Math.max(2 * Math.abs(px - d.start.cx), 2 * Math.abs(py - d.start.cy) * aspect / frameRatio)
      setLive({ ...d.start, w: clamp(w, 0.06, 1.2) })
    }
  }
  function up() {
    if (drag.current && live) onChange(live)
    drag.current = null
  }

  return (
    <div ref={ref} className="cover-handles" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div
        className="cover-handles__box"
        style={{ left: `${(b.cx - b.w / 2) * 100}%`, top: `${(b.cy - h / 2) * 100}%`, width: `${b.w * 100}%`, height: `${h * 100}%` }}
        onPointerDown={e => down('move', e)}
        title="Glisser pour déplacer le tracé"
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map(c => (
          <span key={c} className={`cover-handles__knob is-${c}`} onPointerDown={e => down('size', e)} title="Tirer pour agrandir ou réduire" />
        ))}
      </div>
    </div>
  )
}
