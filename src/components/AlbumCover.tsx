import { useLayoutEffect, useRef, useState } from 'react'
import type { AlbumBox, CoverElKey, CoverElOverride, CoverOverrides, CoverTemplateId, VoyagePhoto } from '../types'
import { coverTemplate, coverTheme, themeColor, COVER_PLACEHOLDER } from '../lib/coverTemplates'
import type { CoverTextLayout, CoverMapLayout, CoverDecorKind } from '../lib/coverTemplates'
import { boxZIndex, coverBoxShadow, shadowSign } from '../lib/albumPages'
import { AlbumFreeBox } from './AlbumFreeBox'
import { CoverDecor, DecorShape } from './CoverDecor'
import { usePhotoBackgroundSize } from '../hooks/usePhotoBackgroundSize'

/** Poignées et rappels d'édition — présents uniquement dans l'éditeur (VoyageCoverEditor).
 * Absents = rendu figé (visionneuse, vignette, export PDF). */
export interface CoverEditHandlers {
  photos: VoyagePhoto[]
  photoUrls: Record<string, string>
  pickedPhotoId: string | null
  selectedBoxId: string | null
  onElTextChange: (el: CoverElKey, value: string) => void
  /** Clic simple sur un élément de gabarit (titre, dates, texte, carte) → ouvrir sa section
   * de réglages dans le panneau de gauche. */
  onElSelect?: (el: CoverElKey) => void
  onElDragStart: (e: React.MouseEvent | React.TouchEvent, el: CoverElKey) => void
  onElResizeStart?: (e: React.MouseEvent | React.TouchEvent, el: CoverElKey) => void
  onPhotoPick: (boxId: string) => void
  onPhotoClear: (boxId: string, e: React.MouseEvent) => void
  onPhotoSelect: (boxId: string) => void
  onTextBoxChange: (boxId: string, value: string) => void
  onPhotoDragStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onPhotoResizeStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onPhotoRotateStart: (e: React.MouseEvent | React.TouchEvent, boxId: string) => void
  onLayerClick?: () => void
  layerRef?: React.Ref<HTMLDivElement>
  mapPickable?: boolean
  onMapPick?: () => void
}

export interface AlbumCoverContentProps {
  template: CoverTemplateId
  cover?: CoverOverrides
  /** Cases libres de la couverture : `kind:'photo'` (clusters de polaroïds) et `kind:'text'`. */
  boxes?: AlbumBox[]
  /** photoId → URL (résolue) — pour le rendu figé ; en édition, `edit.photoUrls` est utilisé. */
  photoUrls?: Record<string, string>
  /** URL du visuel principal (carte du tracé ou photo qui la remplace). */
  mapUrl?: string
  /** Aperçu « gabarit » (vignette du sélecteur) : carte et photos remplacées par des blocs
   * neutres + tracé stylisé, pour montrer la mise en page sans le bruit visuel de la vraie carte. */
  schematic?: boolean
  className?: string
  innerRef?: React.Ref<HTMLDivElement>
  edit?: CoverEditHandlers
}

type TextElKey = 'eyebrow' | 'title' | 'dates' | 'body'
const EL_KEYS: TextElKey[] = ['eyebrow', 'title', 'dates', 'body']

function fontStack(font: string | undefined, fallback: string): string {
  return font || fallback
}

/** Style commun d'un élément de texte, à partir de la mise en page du gabarit + surcharges.
 * La taille est exprimée en `cqw` (% de la largeur du plan de composition) via `--albcov-size`,
 * pour que le texte suive la taille du gabarit quel que soit le format de la couverture. */
function textElStyle(base: CoverTextLayout, ov: CoverElOverride | undefined, fallbackFont: string): React.CSSProperties {
  const scale = ov?.scale ?? 1
  const x = ov?.x ?? base.x
  const y = ov?.y ?? base.y
  const w = ov?.w ?? base.w
  const rotate = ov?.rotate ?? base.rotate ?? 0
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: `${w}%`,
    ['--albcov-size' as string]: base.size * scale,
    fontFamily: fontStack(ov?.font, fallbackFont),
    fontWeight: base.weight ?? 400,
    fontStyle: base.italic ? 'italic' : undefined,
    lineHeight: base.lineHeight ?? 1.2,
    letterSpacing: base.tracking ? `${base.tracking}em` : undefined,
    textTransform: base.uppercase ? 'uppercase' : undefined,
    borderBottom: base.rule ? '0.12em solid currentColor' : undefined,
    textAlign: ov?.align ?? base.align,
    color: ov?.color ?? undefined,
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
    ...(base.box
      ? { background: base.box, padding: '0.55em 0.85em', borderRadius: '2px', boxShadow: '0 3px 8px rgba(0,0,0,0.12)' }
      : base.rule ? { paddingBottom: '0.3em' } : null),
  }
}

/** Case photo (rendu figé, hors édition) de la couverture — sous-composant pour pouvoir calculer
 * le `background-size` par case via `usePhotoBackgroundSize` (a besoin d'un ref par case). */
function AlbumCoverPolaroidBox({ box, zIndex, url }: { box: AlbumBox; zIndex: number; url: string | undefined }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const backgroundSize = usePhotoBackgroundSize(boxRef, url, box.photoScale ?? 1, box.photoFit ?? 'cover')

  return (
    <div
      ref={boxRef}
      className="albcov-poladroid"
      style={{
        left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
        zIndex,
        ...coverBoxShadow(box),
      }}
    >
      {url
        ? <div className="albcov-map__bg" style={{
            backgroundImage: `url(${url})`,
            backgroundSize,
            backgroundPosition: `${box.photoOffsetX ?? 50}% ${box.photoOffsetY ?? 50}%`,
          }} />
        : null}
    </div>
  )
}

/** Tracé stylisé pour la vignette « gabarit » — un fond de carte neutre + une courbe. */
function MapSchematic() {
  return (
    <svg className="albcov-map__schema" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect width="100" height="100" fill="#e9e5db" />
      <path d="M58 3 C 42 22, 70 40, 50 60 C 38 74, 46 90, 54 99"
        fill="none" stroke="#8ea0b0" strokeWidth="3" strokeLinecap="round" />
      <circle cx="58" cy="3" r="3.4" fill="#6d7f8d" />
      <circle cx="54" cy="99" r="3.4" fill="#6d7f8d" />
    </svg>
  )
}

export function AlbumCoverContent({
  template, cover, boxes = [], photoUrls = {}, mapUrl, schematic, className, innerRef, edit,
}: AlbumCoverContentProps) {
  const tpl = coverTemplate(template)
  const ov = cover?.el ?? {}
  const theme = coverTheme(tpl, cover)
  const bg = themeColor(cover?.bg ?? tpl.background, theme)
  // `bgImage` : id de photo du voyage, OU URL directe (data:/blob:/http — gabarit importé).
  const bgImageUrl = cover?.bgImage
    ? (/^(data:|blob:|https?:)/.test(cover.bgImage) ? cover.bgImage : (edit?.photoUrls ?? photoUrls)[cover.bgImage])
    : undefined
  // Une image de fond = « gabarit importé » : la feuille sert de toile nue, le décor et la carte
  // du gabarit ne sont pas rendus (on compose librement par-dessus).
  const blankSlate = !!bgImageUrl
  const decorColor = themeColor(cover?.decorColor ?? tpl.colors.decor, theme)!
  const editable = !!edit

  // Plan de composition à proportion fixe (gabarits « board ») : on ajuste sa taille (px, dans
  // l'espace de mise en page non transformé) pour qu'il tienne entièrement dans la couverture,
  // centré ; le fond de la couverture comble autour.
  const coverElRef = useRef<HTMLDivElement>(null)
  const [boardBox, setBoardBox] = useState<{ w: number; h: number } | null>(null)
  const board = tpl.board
  useLayoutEffect(() => {
    const host = coverElRef.current
    if (!host || !board) { setBoardBox(null); return }
    const fit = () => {
      const W = host.offsetWidth, H = host.offsetHeight
      if (!W || !H) return
      const availW = W * 0.96, availH = H * 0.96
      let w = availW, h = w / board
      if (h > availH) { h = availH; w = h * board }
      setBoardBox(prev => (prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    return () => ro.disconnect()
  }, [board])

  // Cases libres (photo / texte / décor) visibles, triées par calque (zIndex).
  const layerBoxes = boxes
    .filter(b => b.visible !== false)
    .slice()
    .sort((a, b) => boxZIndex(a) - boxZIndex(b))

  // Décor : le jeton {dates} reprend le texte des dates ; les couleurs `@nom` sont résolues.
  const datesText = ov.dates?.text || COVER_PLACEHOLDER.dates
  const decorPieces = tpl.decor.map(p => ({
    ...p,
    text: p.text?.includes('{dates}') ? p.text.replace('{dates}', datesText) : p.text,
    color: themeColor(p.color, theme),
  }))

  // ── Carte / visuel principal ──────────────────────────────────────────────
  const mapOv = ov.map
  const mapBase: CoverMapLayout = tpl.elements.map
  const mapHidden = mapOv?.hidden ?? mapBase.hidden
  // Sur un gabarit importé (fond image) on ne rend PAS la carte du gabarit par défaut, mais on
  // rend la « photo principale » si l'utilisateur en a choisi une (section « Photo principale »).
  const showMap = !mapHidden && (!blankSlate || !!mapOv?.photoId)
  const mapFrame = mapOv?.frame ?? mapBase.frame
  const mapScale = mapOv?.scale ?? 1
  const mapStyle: React.CSSProperties = {
    left: `${mapOv?.x ?? mapBase.x}%`,
    top: `${mapOv?.y ?? mapBase.y}%`,
    width: `${(mapOv?.w ?? mapBase.w ?? 50) * mapScale}%`,
    transform: `rotate(${mapOv?.rotate ?? mapBase.rotate}deg)`,
  }
  if (mapOv?.h != null) {
    // Hauteur fixée par l'utilisateur (redimensionnement libre) — prime sur `ar` / gabarit.
    mapStyle.height = `${mapOv.h * mapScale}%`
  } else if (mapBase.ar) {
    // Carte à proportion fixe : la hauteur suit la largeur (rendu stable quel que soit le format
    // de la couverture). `aspect-ratio` compte le padding du cadre `--card`/`--strip`.
    mapStyle.aspectRatio = String(mapBase.ar)
  } else {
    mapStyle.height = `${(mapBase.h ?? 60) * mapScale}%`
  }
  // Ombre du cadre de la carte / photo principale — réglable ; sinon celle du CSS (--card/--strip/--plain).
  if (mapOv?.shadow !== undefined || mapOv?.shadowLevel !== undefined || mapOv?.shadowDir !== undefined) {
    if (mapOv?.shadow === false) {
      mapStyle.boxShadow = 'none'
    } else {
      const lvl = Math.max(1, Math.min(4, Math.round(mapOv?.shadowLevel ?? 2)))
      const k = lvl / 2
      const { sx, sy } = shadowSign(mapOv?.shadowDir)
      mapStyle.boxShadow = `${sx * Math.round(12 * k)}px ${sy * Math.round(16 * k)}px ${Math.round(34 * k)}px rgba(0,0,0,${(0.12 + 0.06 * lvl).toFixed(2)}), `
        + `${sx * Math.round(2 * k)}px ${sy * Math.round(3 * k)}px ${Math.round(9 * k)}px rgba(0,0,0,${(0.06 + 0.03 * lvl).toFixed(2)})`
    }
  }

  return (
    <div
      ref={coverElRef}
      className={`asp2-a4 asp2-a4--cover albcov--tpl-${tpl.id}${className ? ` ${className}` : ''}`}
      style={{
        backgroundColor: bg,
        backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
        backgroundSize: bgImageUrl ? 'cover' : undefined,
        backgroundPosition: bgImageUrl ? 'center' : undefined,
        backgroundRepeat: bgImageUrl ? 'no-repeat' : undefined,
        ['--albcov-title-color' as string]: themeColor(tpl.colors.title, theme),
        ['--albcov-dates-color' as string]: themeColor(tpl.colors.dates, theme),
        ['--albcov-body-color' as string]: themeColor(tpl.colors.body, theme),
        ['--albcov-eyebrow-color' as string]: themeColor(tpl.colors.eyebrow ?? tpl.colors.dates, theme),
      } as React.CSSProperties}
    >
      <div
        className={`albcov-inner${board ? ' albcov-inner--board' : ''}`}
        ref={innerRef}
        style={board && boardBox ? { width: `${boardBox.w}px`, height: `${boardBox.h}px` } : undefined}
      >
        {!cover?.decorHidden && !blankSlate && decorPieces.length > 0 && (
          <CoverDecor pieces={decorPieces} color={decorColor} />
        )}

        {showMap && (
          <div
            className={`albcov-map albcov-map--${mapFrame}${edit?.mapPickable ? ' albcov-map--pickable' : ''}`}
            style={mapStyle}
            onClick={edit ? () => { if (edit.mapPickable) edit.onMapPick?.(); else edit.onElSelect?.('map') } : undefined}
          >
            {editable && (
              <span
                className="albcov-el__handle" title="Déplacer la carte"
                onMouseDown={e => edit!.onElDragStart(e, 'map')}
                onTouchStart={e => edit!.onElDragStart(e, 'map')}
                onClick={e => e.stopPropagation()}
              >⠿</span>
            )}
            {schematic
              ? <MapSchematic />
              : mapUrl
                ? <div className="albcov-map__bg" style={{ backgroundImage: `url(${mapUrl})`, backgroundSize: mapOv?.fit === 'contain' ? 'contain' : undefined }} />
                : <span className="albcov-map__empty">carte</span>}
            {editable && edit!.onElResizeStart && (
              <span
                className="albcov-el__resize" title="Redimensionner la carte / la photo"
                onMouseDown={e => edit!.onElResizeStart!(e, 'map')}
                onTouchStart={e => edit!.onElResizeStart!(e, 'map')}
                onClick={e => e.stopPropagation()}
              />
            )}
          </div>
        )}

        {schematic && tpl.photoSlots.slice(0, 2).map((s, i) => (
          <div
            key={i}
            className="albcov-poladroid albcov-poladroid--schema"
            style={{
              left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h ?? 28}%`,
              transform: `rotate(${s.rotate}deg)`, zIndex: 15,
            }}
          >
            <span />
          </div>
        ))}

        {!blankSlate && EL_KEYS.map(key => {
          const base = tpl.elements[key]
          if (!base) return null   // eyebrow : présent seulement sur certains gabarits
          const o = ov[key]
          if (o?.hidden ?? base.hidden) return null
          const text = o?.text ?? ''
          const ph = tpl.placeholders?.[key] ?? COVER_PLACEHOLDER[key]
          const fallbackFont = key === 'eyebrow' ? (tpl.fonts.eyebrow ?? tpl.fonts.title)
            : key === 'title' ? tpl.fonts.title : key === 'dates' ? tpl.fonts.dates : tpl.fonts.body
          const style = textElStyle(base, o, fallbackFont)
          return (
            <div
              key={key}
              className={`albcov-el albcov-el--${key}${editable ? ' albcov-el--editable' : ''}`}
              style={style}
              onMouseDown={editable ? () => edit!.onElSelect?.(key) : undefined}
            >
              {editable && (
                <span
                  className="albcov-el__handle" title="Déplacer"
                  onMouseDown={e => edit!.onElDragStart(e, key)}
                  onTouchStart={e => edit!.onElDragStart(e, key)}
                >⠿</span>
              )}
              {key === 'dates' && editable ? (
                /* Dates : <input> (une seule ligne) et non <textarea> — un textarea a une hauteur
                 * minimale imposée par le navigateur (~1,5 ligne) qui décalait l'étiquette par
                 * rapport au rendu figé (aperçu / PDF), lequel n'affiche qu'une <div> d'une ligne.
                 * Un <input> haut d'exactement 1 line-height s'aligne dessus. */
                <input
                  type="text"
                  value={text}
                  onChange={e => edit!.onElTextChange(key, e.target.value)}
                  onFocus={() => edit!.onElSelect?.(key)}
                  placeholder={ph.replace(/\n/g, ' ')}
                />
              ) : editable ? (
                <textarea
                  value={text}
                  onChange={e => edit!.onElTextChange(key, e.target.value)}
                  onFocus={() => edit!.onElSelect?.(key)}
                  placeholder={ph.replace(/\n/g, ' ')}
                  rows={key === 'body' ? 5 : 2}
                />
              ) : (
                (text || ph).split('\n').map((line, i) => <div key={i}>{line || ' '}</div>)
              )}
            </div>
          )
        })}

        {/* Cases libres : photos, cases-texte, décors manipulables — triées par calque (zIndex). */}
        {layerBoxes.length > 0 && (
          <div
            className="albcov-photo-layer"
            ref={edit?.layerRef}
            onClick={edit?.onLayerClick ? (e => { if (e.target === e.currentTarget) edit!.onLayerClick!() }) : undefined}
          >
            {layerBoxes.map(box => {
              const z = boxZIndex(box)
              if (editable) {
                return (
                  <AlbumFreeBox
                    key={box.id}
                    box={box}
                    zIndex={z}
                    decorColor={box.kind === 'decor' ? (themeColor(box.color, theme) ?? decorColor) : undefined}
                    photos={edit!.photos}
                    photoUrls={edit!.photoUrls}
                    pickedPhotoId={edit!.pickedPhotoId}
                    isSelected={box.id === edit!.selectedBoxId}
                    onPick={edit!.onPhotoPick}
                    onClear={edit!.onPhotoClear}
                    onTextChange={edit!.onTextBoxChange}
                    onSelect={edit!.onPhotoSelect}
                    onDragStart={edit!.onPhotoDragStart}
                    onResizeStart={edit!.onPhotoResizeStart}
                    onRotateStart={edit!.onPhotoRotateStart}
                  />
                )
              }
              if (box.kind === 'decor') {
                return (
                  <div
                    key={box.id}
                    className="albcov-decor-box"
                    data-box-id={box.id}
                    style={{
                      left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
                      transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
                      color: themeColor(box.color, theme) ?? decorColor,
                      zIndex: z,
                      ...coverBoxShadow(box),
                    }}
                  >
                    {box.photoId && photoUrls[box.photoId]
                      ? (box.color
                          ? <div style={{
                              width: '100%', height: '100%', backgroundColor: themeColor(box.color, theme) ?? decorColor,
                              WebkitMaskImage: `url(${photoUrls[box.photoId]})`, maskImage: `url(${photoUrls[box.photoId]})`,
                              WebkitMaskSize: 'contain', maskSize: 'contain',
                              WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                              WebkitMaskPosition: 'center', maskPosition: 'center',
                            }} />
                          : <img src={photoUrls[box.photoId]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />)
                      : <DecorShape kind={(box.decorType ?? 'stamp') as CoverDecorKind} text={box.text} id={box.id} filled={box.decorFilled} />}
                  </div>
                )
              }
              if (box.kind === 'photo') {
                return (
                  <AlbumCoverPolaroidBox
                    key={box.id}
                    box={box}
                    zIndex={z}
                    url={box.photoId ? photoUrls[box.photoId] : undefined}
                  />
                )
              }
              return (
                <div
                  key={box.id}
                  className="albcov-freebox"
                  style={{
                    left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
                    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
                    zIndex: z,
                    background: box.bgColor === 'transparent' ? 'transparent' : (box.bgColor || 'transparent'),
                    border: box.borderColor ? `1px solid ${box.borderColor}` : 'none',
                    fontSize: box.fontSize ? `${box.fontSize}px` : undefined,
                    fontFamily: box.fontFamily || undefined,
                    fontWeight: box.bold ? 'bold' : undefined,
                    fontStyle: box.italic ? 'italic' : undefined,
                    textAlign: box.textAlign || undefined,
                    color: box.textColor || undefined,
                  }}
                >{box.text}</div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
