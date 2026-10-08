import type { PhotoLayout } from '../types'

export type { PhotoLayout }

interface PhotoEntry {
  id: string
  url: string
  caption?: string
}

interface TextEntry {
  text: string
}

// Contenu d'un emplacement du gabarit : une photo, un texte libre, ou vide (null)
export type PageCell = PhotoEntry | TextEntry | null

function isPhoto(c: PageCell): c is PhotoEntry {
  return !!c && 'url' in c
}

function Cell({ c, className = '' }: { c: PageCell; className?: string }) {
  if (!c) return <div className={`asp2-pp-cell asp2-pp-cell--empty ${className}`} />
  if (isPhoto(c)) {
    return (
      <div className={`asp2-pp-cell ${className}`}>
        <img src={c.url} alt="" />
        {c.caption && <div className="asp2-pp-cell__caption">{c.caption}</div>}
      </div>
    )
  }
  return (
    <div className={`asp2-pp-cell asp2-pp-cell--text ${className}`}>
      <p>{c.text}</p>
    </div>
  )
}

export interface AlbumPageContentProps {
  voyageName: string
  trackName: string
  date?: string
  layout: PhotoLayout
  photos: PageCell[]  // position = emplacement du gabarit
  distanceKm?: number
  elevGain?: number
  text?: string          // texte de la zone récit (composition manuelle) ; sinon texte généré
  showHeader?: boolean  // bandeau voyage/date/titre ; true par défaut
}

/** Le contenu d'une page A4 d'album (sans la barre de navigation) — réutilisable pour la visionneuse et l'export PDF. */
export function AlbumPageContent({
  voyageName, trackName, date, layout, photos, distanceKm, elevGain, text, showHeader = true,
}: AlbumPageContentProps) {
  const dateStr = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : ''

  const heroPhoto = photos[0] && isPhoto(photos[0]) ? photos[0] : null
  const defaultText = text || `Une étape de ${(distanceKm ?? 0).toFixed(1)} km${elevGain ? `, ${Math.round(elevGain)} m de dénivelé positif` : ''}, entre découvertes et respiration. Le rythme du pas s'accorde peu à peu à celui du paysage.`

  const cell = (i: number, cls?: string) => (
    <Cell key={i} c={photos[i] ?? null} className={cls} />
  )

  return (
    <div className={`asp2-a4 asp2-a4--photos asp2-a4--${layout}`}>
      {layout !== 'hero' && showHeader && (
        <div className="asp2-pp-header">
          <div className="asp2-pp-voyage">{voyageName}</div>
          {dateStr && <div className="asp2-pp-date">{dateStr}</div>}
          <h2 className="asp2-pp-title">{trackName}</h2>
        </div>
      )}

      {layout === 'hero' && (
        <div className="asp2-pp-hero">
          {heroPhoto && <img src={heroPhoto.url} alt="" />}
          <div className="asp2-pp-hero__overlay">
            <div className="asp2-pp-hero__voyage">{voyageName}{dateStr ? ` · ${dateStr}` : ''}</div>
            <h2 className="asp2-pp-hero__title">{trackName}</h2>
            {heroPhoto?.caption && <p className="asp2-pp-hero__caption">{heroPhoto.caption}</p>}
          </div>
        </div>
      )}

      {layout === 'duo' && (
        <div className="asp2-pp-duo">
          <div className="asp2-pp-duo__photos">{cell(0)}{cell(1)}</div>
          <div className="asp2-pp-duo__text">{defaultText}</div>
        </div>
      )}

      {layout === 'magazine3' && (
        <div className="asp2-pp-mag3">
          {cell(0, 'asp2-pp-mag3__big')}
          <div className="asp2-pp-mag3__side">{cell(1)}{cell(2)}</div>
        </div>
      )}

      {layout === 'gallery4' && (
        <div className="asp2-pp-gallery4">{cell(0)}{cell(1)}{cell(2)}{cell(3)}</div>
      )}

      {layout === 'notebook3' && (
        <div className="asp2-pp-notebook">
          <div className="asp2-pp-notebook__notes">
            <div className="asp2-pp-notebook__label">Carnet de bord</div>
            <ul>
              {photos.filter(isPhoto).filter(p => p.caption).slice(0, 3).map(p => (
                <li key={p.id}>{p.caption}</li>
              ))}
              {!photos.some(p => isPhoto(p) && p.caption) && <li>{defaultText}</li>}
            </ul>
          </div>
          <div className="asp2-pp-notebook__photos">{cell(0)}{cell(1)}{cell(2)}</div>
        </div>
      )}

      {layout === 'mosaic5' && (
        <div className="asp2-pp-mosaic5">
          <div className="asp2-pp-mosaic5__top">{cell(0)}{cell(1)}{cell(2)}</div>
          <div className="asp2-pp-mosaic5__bottom">{cell(3, 'asp2-pp-mosaic5__large')}{cell(4)}</div>
        </div>
      )}

      {layout === 'triptych' && (
        <div className="asp2-pp-triptych">{cell(0)}{cell(1)}{cell(2)}</div>
      )}

      {layout === 'soloText' && (
        <div className="asp2-pp-solotext">
          {cell(0, 'asp2-pp-solotext__photo')}
          <div className="asp2-pp-solotext__text">{defaultText}</div>
        </div>
      )}

      {layout === 'triptychPortrait' && (
        <div className="asp2-pp-triptych-portrait">{cell(0)}{cell(1)}{cell(2)}</div>
      )}

      {layout === 'mixedOrientation' && (
        <div className="asp2-pp-mixedorient">
          {cell(0, 'asp2-pp-mixedorient__portrait')}
          <div className="asp2-pp-mixedorient__side">{cell(1)}{cell(2)}</div>
        </div>
      )}

      {layout === 'grid' && (
        <div className="asp2-pp-flexgrid">
          {photos.map((c, i) => <Cell key={i} c={c} />)}
        </div>
      )}

      {layout === 'triangle3' && (
        <div className="asp2-pp-triangle3">
          <div className="asp2-pp-triangle3__top">{cell(0)}{cell(1)}</div>
          <div className="asp2-pp-triangle3__bottom">{cell(2)}</div>
        </div>
      )}

      {layout === 'stack2' && (
        <div className="asp2-pp-stack2">{cell(0)}{cell(1)}</div>
      )}
    </div>
  )
}

interface Props {
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onBack: () => void
  onPrint?: () => void
  onEdit?: () => void
  children: React.ReactNode
}

/** Barre de navigation (compteur + précédent/suivant) autour d'une page A4 — le contenu de la
 * page (gabarit figé ou composition libre) est fourni par l'appelant. */
export function AlbumPhotoPage({ index, total, onPrev, onNext, onBack, onPrint, onEdit, children }: Props) {
  return (
    <div className="asp2-shell">
      <div className="asp2-nav">
        <button className="asp2-back-btn" onClick={onBack}>← Sélection</button>
        <span className="asp2-nav-counter">{index + 1} / {total}</span>
        {onEdit && <button className="asp2-pdf-btn" onClick={onEdit}>✏️ Éditer</button>}
        {onPrint && <button className="asp2-pdf-btn" onClick={onPrint}>🖨 Exporter en PDF</button>}
        <div className="asp2-nav-arrows">
          <button className="asp2-nav-btn" onClick={onPrev} disabled={index === 0}>‹</button>
          <button className="asp2-nav-btn" onClick={onNext} disabled={index === total - 1}>›</button>
        </div>
      </div>

      <div className="asp2-outer">
        {children}
      </div>
    </div>
  )
}
