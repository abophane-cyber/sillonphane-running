import { useRef } from 'react'
import type { ResolvedBox } from '../lib/albumPages'
import { usePhotoBackgroundSize } from '../hooks/usePhotoBackgroundSize'

export interface AlbumComposedPageProps {
  voyageName: string
  trackName: string
  date?: string
  boxes: ResolvedBox[]
  showHeader?: boolean
}

/** Page A4 en positionnement libre (boxes photo/texte placées par l'utilisateur) — réutilisable
 * pour la visionneuse et l'export PDF. */
export function AlbumComposedPageContent({ voyageName, trackName, date, boxes, showHeader = true }: AlbumComposedPageProps) {
  const dateStr = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : ''

  return (
    <div className="asp2-a4 asp2-a4--photos asp2-a4--freeform">
      {showHeader && (
        <div className="asp2-pp-header">
          <div className="asp2-pp-voyage">{voyageName}</div>
          {dateStr && <div className="asp2-pp-date">{dateStr}</div>}
          <h2 className="asp2-pp-title">{trackName}</h2>
        </div>
      )}
      <div className="asp2-pp-canvas">
        {boxes.map(box => <AlbumComposedBox key={box.id} box={box} />)}
      </div>
    </div>
  )
}

function AlbumComposedBox({ box }: { box: ResolvedBox }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const backgroundSize = usePhotoBackgroundSize(boxRef, box.kind === 'photo' ? box.url : undefined, box.photoScale ?? 1, box.photoFit ?? 'cover')

  return (
    <div
      ref={boxRef}
      className={`asp2-pp-box${box.kind === 'text' ? ' asp2-pp-box--text' : ''}${box.kind === 'photo' && !box.url ? ' asp2-pp-box--empty' : ''}`}
      style={{
        left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
        ...(box.kind === 'text' ? {
          background: box.bgColor === 'transparent' ? 'transparent' : (box.bgColor || '#fff'),
          border: box.borderColor ? `1px solid ${box.borderColor}` : 'none',
        } : {}),
      }}
    >
      {box.kind === 'photo' && box.url && (
        <>
          <div
            className="asp2-pp-box__photo"
            style={{
              backgroundImage: `url(${box.url})`,
              backgroundSize,
              backgroundPosition: `${box.photoOffsetX ?? 50}% ${box.photoOffsetY ?? 50}%`,
            }}
          />
          {box.photoCaption && <div className="asp2-pp-cell__caption">{box.photoCaption}</div>}
        </>
      )}
      {box.kind === 'text' && (
        <p style={{
          fontSize: box.fontSize ? `${box.fontSize}px` : undefined,
          fontFamily: box.fontFamily || undefined,
          fontWeight: box.bold ? 'bold' : undefined,
          fontStyle: box.italic ? 'italic' : undefined,
          textAlign: box.textAlign || undefined,
          color: box.textColor || undefined,
        }}>{box.text}</p>
      )}
    </div>
  )
}
