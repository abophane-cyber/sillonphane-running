import { useEffect, useRef, useState } from 'react'
import type { VoyagePhoto, ComposedAlbumPage, AlbumBox, PhotoLayout, VoyageTrack } from '../types'
import { PHOTOS_PER_LAYOUT, LAYOUT_LABELS } from './AlbumPhotoPage'
import { uuid } from '../lib/uuid'
import { createPageFromPreset, createSummaryPage, autoFillPages } from '../lib/albumPages'
import { TEXT_FONTS, TEXT_ALIGNS } from '../lib/textStyles'
import { AlbumSpreadContent } from './AlbumSpread'
import { usePhotoBackgroundSize } from '../hooks/usePhotoBackgroundSize'
import { useBlockPageZoom } from '../hooks/useBlockPageZoom'

interface Props {
  voyageName: string
  trackName: string
  date?: string
  track: VoyageTrack
  photos: VoyagePhoto[]
  photoUrls: Record<string, string>
  initialPages: ComposedAlbumPage[]
  onSave: (pages: ComposedAlbumPage[]) => void
  onDeleteUnusedPhotos?: (photoIds: string[]) => void | Promise<void>
  onBack: () => void
}

const ALL_LAYOUTS = Object.keys(PHOTOS_PER_LAYOUT) as PhotoLayout[]
const MIN_BOX_SIZE = 8 // % — taille minimale d'une box en largeur/hauteur

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** Position du pointeur, qu'il s'agisse d'un événement souris ou tactile. */
function getPoint(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e) {
    const t = e.touches[0] ?? e.changedTouches[0]
    return { x: t.clientX, y: t.clientY }
  }
  return { x: e.clientX, y: e.clientY }
}

function LayoutIcon({ layout }: { layout: PhotoLayout }) {
  const cell = (cls?: string) => <span className={`lyicon-cell ${cls ?? ''}`} />
  const text = <span className="lyicon-text" />
  switch (layout) {
    case 'hero':
      return <div className="lyicon">{cell()}</div>
    case 'duo':
      return (
        <div className="lyicon lyicon--col">
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}</div>
          {text}
        </div>
      )
    case 'magazine3':
      return (
        <div className="lyicon lyicon--row">
          {cell('lyicon-cell--wide')}
          <div className="lyicon-col">{cell()}{cell()}</div>
        </div>
      )
    case 'gallery4':
      return (
        <div className="lyicon lyicon--col">
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}</div>
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}</div>
        </div>
      )
    case 'notebook3':
      return (
        <div className="lyicon lyicon--row">
          {text}
          <div className="lyicon-col">{cell()}{cell()}{cell()}</div>
        </div>
      )
    case 'mosaic5':
      return (
        <div className="lyicon lyicon--col">
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}{cell()}</div>
          <div className="lyicon-row lyicon-row--grow">{cell('lyicon-cell--wide')}{cell()}</div>
        </div>
      )
    case 'triptych':
      return <div className="lyicon lyicon--row">{cell()}{cell()}{cell()}</div>
    case 'soloText':
      return (
        <div className="lyicon lyicon--row">
          {cell('lyicon-cell--wide')}
          {text}
        </div>
      )
    case 'triptychPortrait':
      return (
        <div className="lyicon lyicon--row lyicon--centered">
          {cell('lyicon-cell--narrow')}{cell('lyicon-cell--narrow')}{cell('lyicon-cell--narrow')}
        </div>
      )
    case 'mixedOrientation':
      return (
        <div className="lyicon lyicon--row">
          {cell('lyicon-cell--narrow')}
          <div className="lyicon-col">{cell()}{cell()}</div>
        </div>
      )
    case 'grid':
      return (
        <div className="lyicon lyicon--col">
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}{cell()}</div>
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}{cell()}</div>
        </div>
      )
    case 'triangle3':
      return (
        <div className="lyicon lyicon--col">
          <div className="lyicon-row lyicon-row--grow">{cell()}{cell()}</div>
          <div className="lyicon-row lyicon-row--grow lyicon--centered">{cell('lyicon-cell--narrow')}</div>
        </div>
      )
    case 'stack2':
      return (
        <div className="lyicon lyicon--col">
          <div className="lyicon-row lyicon-row--grow lyicon--centered">{cell('lyicon-cell--wide')}</div>
          <div className="lyicon-row lyicon-row--grow lyicon--centered">{cell('lyicon-cell--wide')}</div>
        </div>
      )
  }
}

interface DragState {
  mode: 'move' | 'resize'
  boxId: string
  startClientX: number
  startClientY: number
  startBox: AlbumBox
  canvasW: number
  canvasH: number
}

function Box({
  box, photos, photoUrls, pickedPhotoId, isSelected, onPick, onClear, onToggleCaption, onTextChange,
  onToggleSettings, onSelect, onDragStart, onResizeStart, onBringToFront, onSendToBack,
}: {
  box: AlbumBox
  photos: VoyagePhoto[]
  photoUrls: Record<string, string>
  pickedPhotoId: string | null
  isSelected: boolean
  onPick: (boxId: string) => void
  onClear: (boxId: string, e: React.MouseEvent) => void
  onToggleCaption: (boxId: string, e: React.MouseEvent) => void
  onTextChange: (boxId: string, value: string) => void
  onToggleSettings: (boxId: string, e: React.MouseEvent) => void
  onSelect: (boxId: string) => void
  onDragStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onResizeStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onBringToFront: (boxId: string, e: React.MouseEvent) => void
  onSendToBack: (boxId: string, e: React.MouseEvent) => void
}) {
  const photo = box.photoId ? photos.find(p => p.id === box.photoId) : undefined
  const url = photo ? photoUrls[photo.id] : undefined
  const captionShown = box.caption !== false
  const fontSize = box.fontSize ?? 14
  const boxRef = useRef<HTMLDivElement>(null)
  const backgroundSize = usePhotoBackgroundSize(boxRef, url, box.photoScale ?? 1, box.photoFit ?? 'cover')

  return (
    <div
      ref={boxRef}
      className={`albed-box${box.kind === 'text' ? ' albed-box--text' : ''}${box.kind === 'photo' && !url ? ' albed-box--empty' : ''}${pickedPhotoId && box.kind === 'photo' ? ' albed-box--pickable' : ''}${isSelected ? ' albed-box--selected' : ''}`}
      style={{
        left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
        ...(box.kind === 'text' ? {
          background: box.bgColor === 'transparent' ? 'transparent' : (box.bgColor || '#fff'),
          border: box.borderColor ? `1px solid ${box.borderColor}` : 'none',
        } : {}),
      }}
      onClick={() => box.kind === 'photo' && onPick(box.id)}
    >
      <span
        className="albed-box__handle" title="Déplacer"
        onMouseDown={e => onDragStart(e, box.id)}
        onTouchStart={e => onDragStart(e, box.id)}
      >⠿</span>
      <button className="albed-box__settings" title="Réglages" onClick={e => onToggleSettings(box.id, e)}>⚙</button>
      <button className="albed-box__layer albed-box__layer--front" title="Passer au premier plan" onClick={e => onBringToFront(box.id, e)}>▲</button>
      <button className="albed-box__layer albed-box__layer--back" title="Passer à l'arrière-plan" onClick={e => onSendToBack(box.id, e)}>▼</button>
      <button className="albed-box__clear" onClick={e => onClear(box.id, e)} title="Supprimer">✕</button>

      {box.kind === 'text' ? (
        <textarea
          value={box.text ?? ''}
          onChange={e => onTextChange(box.id, e.target.value)}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onFocus={() => onSelect(box.id)}
          placeholder="Texte…"
          style={{
            fontSize: `${fontSize}px`,
            fontFamily: box.fontFamily || undefined,
            fontWeight: box.bold ? 'bold' : undefined,
            fontStyle: box.italic ? 'italic' : undefined,
            textAlign: box.textAlign || undefined,
            color: box.textColor || undefined,
          }}
        />
      ) : url ? (
        <>
          <div
            className="albed-box__photo"
            style={{
              backgroundImage: `url(${url})`,
              backgroundSize,
              backgroundPosition: `${box.photoOffsetX ?? 50}% ${box.photoOffsetY ?? 50}%`,
            }}
          />
          {photo?.aiCaption && captionShown && (
            <div className="albed-slot__caption">
              <span>{photo.aiCaption}</span>
              <button onClick={e => onToggleCaption(box.id, e)} title="Masquer la légende">✕</button>
            </div>
          )}
          {photo?.aiCaption && !captionShown && (
            <button className="albed-slot__caption-restore" onClick={e => onToggleCaption(box.id, e)} title="Afficher la légende">
              💬 Légende masquée
            </button>
          )}
        </>
      ) : (
        <div className="albed-slot__empty-inner">
          <span className="albed-slot__plus">+</span>
        </div>
      )}

      <span
        className="albed-box__resize" title="Redimensionner"
        onMouseDown={e => onResizeStart(e, box.id)}
        onTouchStart={e => onResizeStart(e, box.id)}
      />
    </div>
  )
}

export function AlbumPageEditor({ voyageName, trackName, date, track, photos, photoUrls, initialPages, onSave, onDeleteUnusedPhotos, onBack }: Props) {
  useBlockPageZoom()
  const dateStr = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : ''
  const [pages, setPages] = useState<ComposedAlbumPage[]>(() => {
    // Composition neuve : la page résumé seule — les pages suivantes s'ajoutent avec « + Page »
    // (ou « Remplissage auto »), pas de page vide imposée d'office.
    if (initialPages.length === 0) return [createSummaryPage()]
    // Compositions faites avant l'introduction de la page résumé dans l'éditeur : on lui en
    // ajoute une (en mémoire, enregistrée au prochain changement) pour que l'export depuis
    // cette page reste complet, sans dépendre d'une logique de secours ailleurs.
    if (!initialPages.some(p => p.kind === 'summary')) return [createSummaryPage(), ...initialPages]
    return initialPages
  })
  const [activeIndex, setActiveIndex] = useState(0)
  const [pickedPhotoId, setPickedPhotoId] = useState<string | null>(null)
  const [dragPageIndex, setDragPageIndex] = useState<number | null>(null)
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)
  const [leftPanelMode, setLeftPanelMode] = useState<'photo' | 'text'>('photo')
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const boxTextTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const summaryTextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headerTextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave })

  const activePage = pages[Math.min(activeIndex, pages.length - 1)]
  const selectedBox = selectedBoxId ? activePage.boxes.find(b => b.id === selectedBoxId) ?? null : null

  useEffect(() => { setSelectedBoxId(null); setLeftPanelMode('photo') }, [activeIndex])

  function commit(next: ComposedAlbumPage[]) {
    setPages(next)
    onSave(next)
  }

  function updateActiveBoxes(fn: (boxes: AlbumBox[]) => AlbumBox[]) {
    setPages(prev => {
      const next = [...prev]
      next[activeIndex] = { ...next[activeIndex], boxes: fn(next[activeIndex].boxes) }
      return next
    })
  }

  function handleChooseLayout(layout: PhotoLayout) {
    const next = [...pages]
    next[activeIndex] = createPageFromPreset(layout)
    commit(next)
  }

  function handleAddPage() {
    const next = [...pages, createPageFromPreset('gallery4')]
    commit(next)
    setActiveIndex(next.length - 1)
  }

  /** Remplace toutes les pages (sauf le résumé) par un premier jet généré automatiquement à
   * partir des photos du tracé — un point de départ rapide, à affiner ensuite à la main. */
  function handleAutoFill() {
    if (photos.length === 0) return
    if (!confirm('Remplacer toutes les pages actuelles (hors résumé) par une composition automatique avec vos photos ?')) return
    const summary = pages.find(p => p.kind === 'summary') ?? createSummaryPage()
    const next = [summary, ...autoFillPages(photos)]
    commit(next)
    setActiveIndex(0)
  }

  /** Intervertit la page courante avec sa voisine et la suit dans sa nouvelle position. */
  function handleMovePage(dir: -1 | 1) {
    const target = activeIndex + dir
    if (target < 0 || target >= pages.length) return
    const next = [...pages]
    ;[next[activeIndex], next[target]] = [next[target], next[activeIndex]]
    commit(next)
    setActiveIndex(target)
  }

  /** Réordonne par glisser-déposer sur les pastilles de page. */
  function handleDropPage(from: number, to: number) {
    if (from === to) return
    const next = [...pages]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    commit(next)
    setActiveIndex(to)
  }

  function handleDeletePage() {
    if (pages.length <= 1) return
    const next = pages.filter((_, i) => i !== activeIndex)
    commit(next)
    setActiveIndex(i => Math.min(i, next.length - 1))
  }

  function handlePickBox(boxId: string) {
    if (!pickedPhotoId) return
    const next = [...pages]
    next[activeIndex] = {
      ...next[activeIndex],
      boxes: next[activeIndex].boxes.map(b => b.id === boxId ? { ...b, photoId: pickedPhotoId } : b),
    }
    commit(next)
    setPickedPhotoId(null)
  }

  function handleClearBox(boxId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = [...pages]
    next[activeIndex] = { ...next[activeIndex], boxes: next[activeIndex].boxes.filter(b => b.id !== boxId) }
    commit(next)
    setSelectedBoxId(id => id === boxId ? null : id)
  }

  /** Ordre d'empilement des cases qui se chevauchent : déterminé par leur ordre dans le tableau
   * (rendues dans cet ordre, donc les dernières sont visuellement au-dessus). */
  function handleBringToFront(boxId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = [...pages]
    const boxes = next[activeIndex].boxes
    const box = boxes.find(b => b.id === boxId)
    if (!box) return
    next[activeIndex] = { ...next[activeIndex], boxes: [...boxes.filter(b => b.id !== boxId), box] }
    commit(next)
  }

  function handleSendToBack(boxId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = [...pages]
    const boxes = next[activeIndex].boxes
    const box = boxes.find(b => b.id === boxId)
    if (!box) return
    next[activeIndex] = { ...next[activeIndex], boxes: [box, ...boxes.filter(b => b.id !== boxId)] }
    commit(next)
  }

  function handleToggleSettings(boxId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const box = activePage.boxes.find(b => b.id === boxId)
    if (box?.kind === 'text') {
      setSelectedBoxId(boxId)
      setLeftPanelMode('text')
    } else {
      setSelectedBoxId(id => id === boxId ? null : boxId)
    }
  }

  function handleSelectTextBox(boxId: string) {
    setSelectedBoxId(boxId)
    setLeftPanelMode('text')
  }

  function handleToggleCaption(boxId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = [...pages]
    next[activeIndex] = {
      ...next[activeIndex],
      boxes: next[activeIndex].boxes.map(b => b.id === boxId ? { ...b, caption: b.caption === false } : b),
    }
    commit(next)
  }

  function handleBoxTextChange(boxId: string, value: string) {
    updateActiveBoxes(boxes => boxes.map(b => b.id === boxId ? { ...b, text: value } : b))
    clearTimeout(boxTextTimers.current[boxId])
    boxTextTimers.current[boxId] = setTimeout(() => {
      setPages(current => { onSaveRef.current(current); return current })
    }, 600)
  }

  function handleSummaryTextChange(value: string) {
    setPages(prev => {
      const next = [...prev]
      next[activeIndex] = { ...next[activeIndex], summaryText: value }
      return next
    })
    if (summaryTextTimer.current) clearTimeout(summaryTextTimer.current)
    summaryTextTimer.current = setTimeout(() => {
      setPages(current => { onSaveRef.current(current); return current })
    }, 600)
  }

  function handleHeaderTextChange(field: 'headerTitle' | 'headerSubtitle', value: string) {
    setPages(prev => {
      const next = [...prev]
      next[activeIndex] = { ...next[activeIndex], [field]: value }
      return next
    })
    if (headerTextTimer.current) clearTimeout(headerTextTimer.current)
    headerTextTimer.current = setTimeout(() => {
      setPages(current => { onSaveRef.current(current); return current })
    }, 600)
  }

  function handleBoxStyleChange(boxId: string, patch: Partial<AlbumBox>) {
    const next = [...pages]
    next[activeIndex] = { ...next[activeIndex], boxes: next[activeIndex].boxes.map(b => b.id === boxId ? { ...b, ...patch } : b) }
    commit(next)
  }

  /** Active/désactive l'affichage intégral d'une photo. À l'activation, la case est aussi
   * redimensionnée pour épouser les proportions réelles de la photo (comme "contain" l'aurait
   * fait visuellement) au lieu de garder ses anciennes dimensions et l'espace vide qui va avec —
   * la mise en page n'a alors plus à composer avec une case bien plus grande que la photo visible. */
  function handleTogglePhotoFit(boxId: string, contain: boolean) {
    if (!contain) {
      handleBoxStyleChange(boxId, { photoFit: undefined })
      return
    }
    const pageIndexAtToggle = activeIndex
    const box = activePage.boxes.find(b => b.id === boxId)
    const photo = box?.photoId ? photos.find(p => p.id === box.photoId) : undefined
    const url = photo ? photoUrls[photo.id] : undefined
    const canvas = canvasRef.current
    if (!box || !url || !canvas) {
      handleBoxStyleChange(boxId, { photoFit: 'contain' })
      return
    }
    const canvasRect = canvas.getBoundingClientRect()
    const img = new Image()
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        handleBoxStyleChange(boxId, { photoFit: 'contain' })
        return
      }
      const boxPxW = box.w / 100 * canvasRect.width
      const boxPxH = box.h / 100 * canvasRect.height
      const photoRatio = img.naturalWidth / img.naturalHeight
      const boxRatio = boxPxW / boxPxH
      const newPxW = photoRatio > boxRatio ? boxPxW : boxPxH * photoRatio
      const newPxH = photoRatio > boxRatio ? boxPxW / photoRatio : boxPxH
      const newW = newPxW / canvasRect.width * 100
      const newH = newPxH / canvasRect.height * 100
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      const newX = clamp(cx - newW / 2, 0, 100 - newW)
      const newY = clamp(cy - newH / 2, 0, 100 - newH)
      setPages(prev => {
        const pg = prev[pageIndexAtToggle]
        if (!pg || !pg.boxes.some(b => b.id === boxId)) return prev
        const next = [...prev]
        next[pageIndexAtToggle] = {
          ...pg,
          boxes: pg.boxes.map(b => b.id === boxId ? { ...b, photoFit: 'contain' as const, x: newX, y: newY, w: newW, h: newH } : b),
        }
        onSaveRef.current(next)
        return next
      })
    }
    img.src = url
  }

  function handleAddPhotoBox() {
    const next = [...pages]
    next[activeIndex] = {
      ...next[activeIndex],
      boxes: [...next[activeIndex].boxes, { id: uuid(), kind: 'photo', x: 30, y: 30, w: 40, h: 40 }],
    }
    commit(next)
    setSelectedBoxId(null)
    setLeftPanelMode('photo')
  }

  function handleAddTextBox() {
    const next = [...pages]
    const box: AlbumBox = { id: uuid(), kind: 'text', x: 30, y: 30, w: 40, h: 30, text: '' }
    next[activeIndex] = { ...next[activeIndex], boxes: [...next[activeIndex].boxes, box] }
    commit(next)
    setSelectedBoxId(box.id)
    setLeftPanelMode('text')
  }

  // Photos jamais placées sur aucune page de l'album : proposées à la suppression en quittant,
  // pour ne pas alourdir les sauvegardes avec des photos chargées mais jamais utilisées.
  async function handleBack() {
    const usedPhotoIds = new Set(pages.flatMap(p => p.boxes.map(b => b.photoId).filter((id): id is string => !!id)))
    const unused = photos.filter(p => !usedPhotoIds.has(p.id))
    if (unused.length > 0 && onDeleteUnusedPhotos) {
      const label = unused.length > 1 ? `${unused.length} photos non utilisées` : '1 photo non utilisée'
      if (confirm(`${label} dans l'album. Les supprimer du tracé ?`)) {
        await onDeleteUnusedPhotos(unused.map(p => p.id))
      }
    }
    onBack()
  }

  function handleToggleHeader() {
    const next = [...pages]
    next[activeIndex] = { ...next[activeIndex], header: activePage.header === false }
    commit(next)
  }

  // Les écouteurs sont créés dans beginDrag pour que add/removeEventListener partagent la même
  // identité de fonction — un handler défini au niveau du composant change à chaque render et
  // ne serait jamais retiré, laissant s'empiler les écouteurs d'un glisser à l'autre.
  // Souris et tactile partagent la même logique : on ne lit que clientX/clientY, que ce soit
  // depuis l'événement souris ou le premier point de contact tactile.
  function beginDrag(e: React.MouseEvent | React.TouchEvent, boxId: string, mode: 'move' | 'resize') {
    // React enregistre ses écouteurs tactiles en mode passif par défaut : preventDefault() y
    // lève un avertissement sans effet. Le touchmove global posé plus bas (non passif) suffit
    // à bloquer le défilement pendant le geste.
    if (e.cancelable && e.nativeEvent.type !== 'touchstart') e.preventDefault()
    e.stopPropagation()
    const canvas = canvasRef.current
    const box = activePage.boxes.find(b => b.id === boxId)
    if (!canvas || !box) return
    const rect = canvas.getBoundingClientRect()
    const start = getPoint(e.nativeEvent)
    const drag: DragState = {
      mode, boxId, startClientX: start.x, startClientY: start.y, startBox: box,
      canvasW: rect.width, canvasH: rect.height,
    }
    dragRef.current = drag

    function onMove(ev: MouseEvent | TouchEvent) {
      ev.preventDefault()
      const p = getPoint(ev)
      const { startBox } = drag
      const dxPct = (p.x - drag.startClientX) / drag.canvasW * 100
      const dyPct = (p.y - drag.startClientY) / drag.canvasH * 100
      if (drag.mode === 'move') {
        const x = clamp(startBox.x + dxPct, 0, 100 - startBox.w)
        const y = clamp(startBox.y + dyPct, 0, 100 - startBox.h)
        updateActiveBoxes(boxes => boxes.map(b => b.id === drag.boxId ? { ...b, x, y } : b))
      } else {
        const w = clamp(startBox.w + dxPct, MIN_BOX_SIZE, 100 - startBox.x)
        const h = clamp(startBox.h + dyPct, MIN_BOX_SIZE, 100 - startBox.y)
        updateActiveBoxes(boxes => boxes.map(b => b.id === drag.boxId ? { ...b, w, h } : b))
      }
    }

    function onUp() {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
      setPages(current => { onSaveRef.current(current); return current })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
  }

  return (
    <div className="albed-shell">
      <div className="albed-topbar">
        <button className="asp2-back-btn" onClick={handleBack}>← Retour</button>
        <div className="albed-topbar__title">{voyageName} · {trackName}</div>
        <div className="albed-pages-nav">
          {pages.length > 1 && (
            <button
              className="albed-move-page"
              onClick={() => handleMovePage(-1)}
              disabled={activeIndex === 0}
              title="Déplacer la page vers la gauche"
            >◀</button>
          )}
          {pages.map((pg, i) => (
            <button
              key={pg.id}
              className={`albed-page-dot${i === activeIndex ? ' albed-page-dot--active' : ''}${dragPageIndex === i ? ' albed-page-dot--dragging' : ''}`}
              onClick={() => setActiveIndex(i)}
              draggable
              onDragStart={() => setDragPageIndex(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragPageIndex !== null) handleDropPage(dragPageIndex, i); setDragPageIndex(null) }}
              onDragEnd={() => setDragPageIndex(null)}
              title={pg.kind === 'summary' ? 'Page résumé (carte, dénivelé, météo)' : 'Glisser pour réordonner'}
            >{pg.kind === 'summary' ? '🗺' : i + 1}</button>
          ))}
          {pages.length > 1 && (
            <button
              className="albed-move-page"
              onClick={() => handleMovePage(1)}
              disabled={activeIndex === pages.length - 1}
              title="Déplacer la page vers la droite"
            >▶</button>
          )}
          <button className="albed-add-page" onClick={handleAddPage}>+ Page</button>
          {pages.length > 1 && <button className="albed-del-page" onClick={handleDeletePage}>🗑 Page</button>}
          <button
            className="albed-auto-fill-btn"
            onClick={handleAutoFill}
            disabled={photos.length === 0}
            title="Génère automatiquement des pages avec vos photos — à retoucher ensuite"
          >
            🪄 Remplissage auto
          </button>
        </div>
      </div>

      <div className="albed-body">
        <div className="albed-left">
          {activePage.kind === 'summary' ? (
            <>
              <p className="albed-empty-hint">
                Page résumé générée automatiquement à partir du tracé (carte, dénivelé, météo).
                Choisissez un gabarit à droite pour la remplacer par une page libre, ou supprimez-la
                avec « 🗑 Page » si vous n'en voulez pas.
              </p>
              {/* Encadré distinct : l'ajout de pages se fait depuis la barre du haut, peu visible. */}
              <div className="albed-addpages-tip">
                <span className="albed-addpages-tip__title">➕ Ajouter des pages à l'album</span>
                <span>Utilisez les boutons de la barre du haut :</span>
                <span><strong>+ Page</strong> : cela ajoute une page vide à composer.</span>
                <span><strong>🪄 Remplissage auto</strong> : cela crée des pages avec vos photos, à retoucher ensuite.</span>
              </div>
            </>
          ) : (
            <>
              <div className="albed-add-box-row">
                <button className={`albed-add-box-btn${leftPanelMode === 'photo' ? ' albed-add-box-btn--active' : ''}`} onClick={handleAddPhotoBox}>+ Photo</button>
                <button className={`albed-add-box-btn${leftPanelMode === 'text' ? ' albed-add-box-btn--active' : ''}`} onClick={handleAddTextBox}>+ Texte</button>
              </div>

              {leftPanelMode === 'text' ? (
                selectedBox && selectedBox.kind === 'text' ? (
                  <>
                    <div className="albed-panel-label">Case de texte</div>
                    <div className="albcov-field-label">Police</div>
                    <select
                      value={selectedBox.fontFamily ?? ''}
                      onChange={e => handleBoxStyleChange(selectedBox.id, { fontFamily: e.target.value || undefined })}
                    >
                      {TEXT_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <div className="albcov-field-label">Style</div>
                    <div className="albed-box-settings__row">
                      <button
                        type="button"
                        className={selectedBox.bold ? 'active' : ''}
                        style={{ fontWeight: 'bold' }}
                        onClick={() => handleBoxStyleChange(selectedBox.id, { bold: !selectedBox.bold })}
                        title="Gras"
                      >G</button>
                      <button
                        type="button"
                        className={selectedBox.italic ? 'active' : ''}
                        style={{ fontStyle: 'italic' }}
                        onClick={() => handleBoxStyleChange(selectedBox.id, { italic: !selectedBox.italic })}
                        title="Italique"
                      >I</button>
                    </div>
                    <div className="albcov-field-label">Alignement</div>
                    <div className="albed-box-settings__row">
                      {TEXT_ALIGNS.map(a => (
                        <button
                          key={a.value}
                          type="button"
                          className={(selectedBox.textAlign ?? 'left') === a.value ? 'active' : ''}
                          onClick={() => handleBoxStyleChange(selectedBox.id, { textAlign: a.value === 'left' ? undefined : a.value })}
                          title={a.title}
                        >{a.label}</button>
                      ))}
                    </div>
                    <div className="albcov-field-label">Couleur du texte</div>
                    <div className="albed-box-settings__row">
                      <input
                        type="color"
                        value={selectedBox.textColor ?? '#1c1b18'}
                        onChange={e => handleBoxStyleChange(selectedBox.id, { textColor: e.target.value })}
                      />
                      <button
                        type="button"
                        className={!selectedBox.textColor ? 'active' : ''}
                        onClick={() => handleBoxStyleChange(selectedBox.id, { textColor: undefined })}
                      >Défaut</button>
                    </div>
                    <div className="albcov-field-label">Taille</div>
                    <div className="albcov-title-scale">
                      <input
                        type="range" min={8} max={48} step={1}
                        value={selectedBox.fontSize ?? 14}
                        onChange={e => handleBoxStyleChange(selectedBox.id, { fontSize: Number(e.target.value) })}
                      />
                      <span>{selectedBox.fontSize ?? 14}px</span>
                    </div>
                    <div className="albcov-field-label">Fond</div>
                    <div className="albed-box-settings__row">
                      <input
                        type="color"
                        value={selectedBox.bgColor && selectedBox.bgColor !== 'transparent' ? selectedBox.bgColor : '#ffffff'}
                        disabled={selectedBox.bgColor === 'transparent'}
                        onChange={e => handleBoxStyleChange(selectedBox.id, { bgColor: e.target.value })}
                      />
                      <button
                        type="button"
                        className={selectedBox.bgColor === 'transparent' ? 'active' : ''}
                        onClick={() => handleBoxStyleChange(selectedBox.id, { bgColor: selectedBox.bgColor === 'transparent' ? undefined : 'transparent' })}
                      >Transparent</button>
                    </div>
                    <div className="albcov-field-label">Cadre</div>
                    <div className="albed-box-settings__row">
                      <input
                        type="color"
                        value={selectedBox.borderColor ?? '#94A3B8'}
                        disabled={!selectedBox.borderColor}
                        onChange={e => handleBoxStyleChange(selectedBox.id, { borderColor: e.target.value })}
                      />
                      <button
                        type="button"
                        className={selectedBox.borderColor ? 'active' : ''}
                        onClick={() => handleBoxStyleChange(selectedBox.id, { borderColor: selectedBox.borderColor ? undefined : '#94A3B8' })}
                      >{selectedBox.borderColor ? 'Retirer' : 'Ajouter'}</button>
                    </div>
                    <div className="albcov-field-label">Inclinaison</div>
                    <div className="albcov-title-scale">
                      <input
                        type="range" min={-20} max={20} step={1}
                        value={selectedBox.rotation ?? 0}
                        onChange={e => handleBoxStyleChange(selectedBox.id, { rotation: Number(e.target.value) })}
                      />
                      <span>{selectedBox.rotation ?? 0}°</span>
                    </div>
                  </>
                ) : (
                  <p className="albed-empty-hint">Cliquez une case de texte sur la page pour régler sa police, sa taille, son fond et son inclinaison.</p>
                )
              ) : (
                <>
                  <div className="albed-panel-label">
                    {pickedPhotoId ? 'Cliquez une case-photo pour la placer' : 'Photos — cliquez pour choisir'}
                  </div>
                  <div className="albed-photo-list">
                    {photos.map(p => {
                      const usedElsewhere = pages.some(pg => pg.boxes.some(b => b.photoId === p.id))
                      return (
                        <div
                          key={p.id}
                          className={`albed-photo-item${pickedPhotoId === p.id ? ' albed-photo-item--picked' : ''}${usedElsewhere ? ' albed-photo-item--used' : ''}`}
                          onClick={() => setPickedPhotoId(id => id === p.id ? null : p.id)}
                          title={usedElsewhere ? 'Déjà placée sur une page' : ''}
                        >
                          {photoUrls[p.id] && <img src={photoUrls[p.id]} alt="" />}
                          {usedElsewhere && <span className="albed-photo-item__badge">✓</span>}
                        </div>
                      )
                    })}
                    {photos.length === 0 && <p className="albed-empty-hint">Aucune photo chargée pour ce tracé.</p>}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="albed-center">
          {activePage.kind === 'summary' ? (
            <div className="albed-preview">
              <AlbumSpreadContent
                track={track}
                voyageName={voyageName}
                photos={photos.map(p => ({ id: p.id, url: photoUrls[p.id] })).filter(p => p.url)}
                pageNumber={activeIndex + 1}
                text={activePage.summaryText}
                onTextChange={handleSummaryTextChange}
              />
            </div>
          ) : (
            <div className="albed-preview">
              <div className="asp2-a4 asp2-a4--photos asp2-a4--freeform">
                {activePage.header !== false && (
                  <div className="asp2-pp-header albed-header">
                    <button className="albed-header__remove" onClick={handleToggleHeader} title="Supprimer le bandeau">✕</button>
                    <input
                      className="asp2-pp-voyage albed-header__input"
                      value={activePage.headerSubtitle ?? voyageName}
                      onChange={e => handleHeaderTextChange('headerSubtitle', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      placeholder={voyageName}
                    />
                    {dateStr && <div className="asp2-pp-date">{dateStr}</div>}
                    <input
                      className="asp2-pp-title albed-header__input albed-header__input--title"
                      value={activePage.headerTitle ?? trackName}
                      onChange={e => handleHeaderTextChange('headerTitle', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      placeholder={trackName}
                    />
                  </div>
                )}
                {activePage.header === false && (
                  <button className="albed-header__restore" onClick={handleToggleHeader}>+ Afficher le bandeau</button>
                )}
                <div className="asp2-pp-canvas" ref={canvasRef} onClick={() => setSelectedBoxId(null)}>
                  {activePage.boxes.map(box => (
                    <Box
                      key={box.id}
                      box={box}
                      photos={photos}
                      photoUrls={photoUrls}
                      pickedPhotoId={pickedPhotoId}
                      isSelected={box.id === selectedBoxId}
                      onPick={handlePickBox}
                      onClear={handleClearBox}
                      onToggleCaption={handleToggleCaption}
                      onTextChange={handleBoxTextChange}
                      onToggleSettings={handleToggleSettings}
                      onSelect={handleSelectTextBox}
                      onDragStart={(e, id) => beginDrag(e, id, 'move')}
                      onResizeStart={(e, id) => beginDrag(e, id, 'resize')}
                      onBringToFront={handleBringToFront}
                      onSendToBack={handleSendToBack}
                    />
                  ))}
                  {selectedBox && selectedBox.kind === 'photo' && (
                    <div
                      className="albed-box-settings"
                      style={{ left: `calc(${Math.min(selectedBox.x + selectedBox.w, 78)}% + 8px)`, top: `${selectedBox.y}%` }}
                      onClick={e => e.stopPropagation()}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      <div className="albed-box-settings__header">
                        <span>Photo</span>
                        <button onClick={() => setSelectedBoxId(null)} title="Fermer">✕</button>
                      </div>
                      <label className="albed-box-settings__checkbox">
                        <input
                          type="checkbox"
                          checked={selectedBox.photoFit === 'contain'}
                          onChange={e => handleTogglePhotoFit(selectedBox.id, e.target.checked)}
                        />
                        Voir la photo entière (sans recadrage)
                      </label>
                      <div className="albcov-field-label">Inclinaison</div>
                      <div className="albcov-title-scale">
                        <input
                          type="range" min={-20} max={20} step={1}
                          value={selectedBox.rotation ?? 0}
                          onChange={e => handleBoxStyleChange(selectedBox.id, { rotation: Number(e.target.value) })}
                        />
                        <span>{selectedBox.rotation ?? 0}°</span>
                      </div>
                      <div className="albcov-field-label">Position horizontale</div>
                      <div className="albcov-title-scale">
                        <input
                          type="range" min={0} max={100} step={1}
                          value={selectedBox.photoOffsetX ?? 50}
                          onChange={e => handleBoxStyleChange(selectedBox.id, { photoOffsetX: Number(e.target.value) })}
                        />
                        <span>{selectedBox.photoOffsetX ?? 50}%</span>
                      </div>
                      <div className="albcov-field-label">Position verticale</div>
                      <div className="albcov-title-scale">
                        <input
                          type="range" min={0} max={100} step={1}
                          value={selectedBox.photoOffsetY ?? 50}
                          onChange={e => handleBoxStyleChange(selectedBox.id, { photoOffsetY: Number(e.target.value) })}
                        />
                        <span>{selectedBox.photoOffsetY ?? 50}%</span>
                      </div>
                      <div className="albcov-field-label">Taille</div>
                      <div className="albcov-title-scale">
                        <input
                          type="range" min={0.4} max={1.5} step={0.05}
                          value={selectedBox.photoScale ?? 1}
                          onChange={e => handleBoxStyleChange(selectedBox.id, { photoScale: Number(e.target.value) })}
                        />
                        <span>{Math.round((selectedBox.photoScale ?? 1) * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="albed-right">
          <div className="albed-panel-label">Ajouter une case</div>
          <div className="albed-add-box-row">
            <button className="albed-add-box-btn" onClick={handleAddPhotoBox}>+ Photo</button>
          </div>

          <div className="albed-panel-label">Modèles de départ</div>
          <div className="albed-layout-grid">
            {ALL_LAYOUTS.map(l => (
              <button
                key={l}
                className="albed-layout-btn"
                onClick={() => handleChooseLayout(l)}
                title={LAYOUT_LABELS[l]}
              >
                <LayoutIcon layout={l} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
