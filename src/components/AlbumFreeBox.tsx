import { useRef } from 'react'
import type { AlbumBox, VoyagePhoto } from '../types'
import { DecorShape } from './CoverDecor'
import { coverBoxShadow } from '../lib/albumPages'
import type { CoverDecorKind } from '../lib/coverTemplates'
import { usePhotoBackgroundSize } from '../hooks/usePhotoBackgroundSize'

/** Case libre (photo, texte ou décor) déplaçable / redimensionnable / pivotable — partagée par
 * l'éditeur du dos et l'éditeur de la couverture (VoyageCoverEditor). Le rendu figé (aperçu / PDF)
 * est fait ailleurs (AlbumComposedPage pour le dos, AlbumCover pour la couverture). */
export function AlbumFreeBox({
  box, zIndex, decorColor, photos, photoUrls, pickedPhotoId, isSelected,
  onPick, onClear, onTextChange, onSelect, onDragStart, onResizeStart, onRotateStart,
}: {
  box: AlbumBox
  zIndex?: number
  decorColor?: string
  photos: VoyagePhoto[]
  photoUrls: Record<string, string>
  pickedPhotoId: string | null
  isSelected: boolean
  onPick: (boxId: string) => void
  onClear: (boxId: string, e: React.MouseEvent) => void
  onTextChange: (boxId: string, value: string) => void
  onSelect: (boxId: string) => void
  onDragStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onResizeStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onRotateStart?: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
}) {
  const photo = box.photoId ? photos.find(p => p.id === box.photoId) : undefined
  const url = photo ? photoUrls[photo.id] : undefined
  const boxRef = useRef<HTMLDivElement>(null)
  const backgroundSize = usePhotoBackgroundSize(boxRef, box.kind === 'photo' ? url : undefined, box.photoScale ?? 1, box.photoFit ?? 'cover')

  const movable = box.movable !== false
  const resizable = box.resizable !== false
  const rotatable = box.rotatable !== false
  const deletable = box.deletable !== false

  return (
    <div
      ref={boxRef}
      className={`albed-box${box.kind === 'text' ? ' albed-box--text' : ''}${box.kind === 'decor' ? ' albed-box--decor' : ''}${box.kind === 'photo' && !url ? ' albed-box--empty' : ''}${pickedPhotoId && box.kind === 'photo' ? ' albed-box--pickable' : ''}${isSelected ? ' albed-box--selected' : ''}`}
      style={{
        left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        zIndex,
        color: box.kind === 'decor' ? decorColor : undefined,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
        ...coverBoxShadow(box),
        ...(box.kind === 'text' ? {
          background: box.bgColor === 'transparent' ? 'transparent' : (box.bgColor || '#fff'),
          border: box.borderColor ? `1px solid ${box.borderColor}` : 'none',
        } : {}),
      }}
      onClick={() => (box.kind === 'photo' && pickedPhotoId) ? onPick(box.id) : onSelect(box.id)}
    >
      {movable && (
        <span
          className="albed-box__handle" title="Déplacer"
          onMouseDown={e => onDragStart(e, box.id)}
          onTouchStart={e => onDragStart(e, box.id)}
        >⠿</span>
      )}
      {rotatable && onRotateStart && (
        <span
          className="albed-box__rotate" title="Pivoter"
          onMouseDown={e => onRotateStart(e, box.id)}
          onTouchStart={e => onRotateStart(e, box.id)}
        >⟳</span>
      )}
      {deletable && (
        <button className="albed-box__clear" onClick={e => onClear(box.id, e)} title="Supprimer">✕</button>
      )}

      {box.kind === 'text' ? (
        <textarea
          value={box.text ?? ''}
          onChange={e => onTextChange(box.id, e.target.value)}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onFocus={() => onSelect(box.id)}
          placeholder="Texte…"
          style={{
            fontSize: `${box.fontSize ?? 14}px`,
            fontFamily: box.fontFamily || undefined,
            fontWeight: box.bold ? 'bold' : undefined,
            fontStyle: box.italic ? 'italic' : undefined,
            textAlign: box.textAlign || undefined,
            color: box.textColor || undefined,
          }}
        />
      ) : box.kind === 'decor' ? (
        box.photoId && url
          ? (box.color
              ? <div style={{
                  width: '100%', height: '100%', backgroundColor: decorColor,
                  WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`,
                  WebkitMaskSize: 'contain', maskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center', maskPosition: 'center',
                }} />
              : <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />)
          : <DecorShape kind={(box.decorType ?? 'stamp') as CoverDecorKind} text={box.text} id={box.id} filled={box.decorFilled} />
      ) : url ? (
        <div className="albed-box__photo" style={{
          backgroundImage: `url(${url})`,
          backgroundSize,
          backgroundPosition: `${box.photoOffsetX ?? 50}% ${box.photoOffsetY ?? 50}%`,
        }} />
      ) : (
        <div className="albed-slot__empty-inner">
          <span className="albed-slot__plus">+</span>
        </div>
      )}

      {resizable && (
        <span
          className="albed-box__resize" title="Redimensionner"
          onMouseDown={e => onResizeStart(e, box.id)}
          onTouchStart={e => onResizeStart(e, box.id)}
        />
      )}
    </div>
  )
}
