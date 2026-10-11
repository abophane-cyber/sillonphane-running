import type { VoyageTrack } from '../types'
import { PosterThumb } from './SillonRecords'

/** Icônes et carte « Mon livre » de l'écran d'un sillon (VoyagesPage → SillonDetail). */

interface IconProps { size?: number }

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function RunnerIcon({ size = 40 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...stroke} strokeWidth={2.2}>
      <circle cx="14.5" cy="4" r="1.9" fill="currentColor" stroke="none" />
      <path d="M10 21l2.4-5.2 3 2.6V22" />
      <path d="M12.4 15.8L13.6 10l-3.6 1.4L8 14.5" />
      <path d="M13.6 10l2.2 2.6 3.2.6" />
      <path d="M12.4 15.8l-2 .6-3.4-1" />
    </svg>
  )
}

export function BookIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...stroke}>
      <path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z" />
      <path d="M12 6.5v13" />
    </svg>
  )
}

export function PencilIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...stroke}>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  )
}

export function TrashIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...stroke}>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }: IconProps) {
  return <svg viewBox="0 0 24 24" width={size} height={size} {...stroke} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>
}

export function DotsIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
    </svg>
  )
}

export function MountainIcon({ size = 14 }: IconProps) {
  return <svg viewBox="0 0 24 24" width={size} height={size} {...stroke}><path d="M3 19l6-10 4 6 3-4 5 8z" /></svg>
}

function CheckDot() {
  return (
    <span className="sd-book__check" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={14} height={14} {...stroke} strokeWidth={3}><path d="M6 12.5l4 4 8-9" /></svg>
    </span>
  )
}

function Leaf({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 60 120" className={`sd-book__leaf ${className}`} aria-hidden="true">
      <path d="M30 118C30 80 30 40 30 4" stroke="#4E7A45" strokeWidth="2" fill="none" />
      {[20, 40, 60, 80].map((y, i) => (
        <g key={y}>
          <path d={`M30 ${y + 10}C14 ${y + 4} 6 ${y - 8} 8 ${y - 16}C20 ${y - 12} 28 ${y - 2} 30 ${y + 10}z`} fill={i % 2 ? '#6E9B5C' : '#5A8A4E'} />
          <path d={`M30 ${y + 18}C46 ${y + 12} 54 ${y} 52 ${y - 8}C40 ${y - 4} 32 ${y + 6} 30 ${y + 18}z`} fill={i % 2 ? '#5A8A4E' : '#7FAA6A'} />
        </g>
      ))}
    </svg>
  )
}

/** Carte « Mon livre » : livre ouvert (affiche la plus récente à gauche), atouts, bouton « Créer mon livre ». */
export function BookAside({ poster, onBook }: { poster?: VoyageTrack; onBook: () => void }) {
  return (
    <aside className="sd-book">
      <h2 className="sd-book__title"><BookIcon size={34} /> Mon livre</h2>
      <p className="sd-book__lead">Vos courses prennent vie<br />dans un livre unique</p>
      <div className="sd-book__art" aria-hidden="true">
        <Leaf className="sd-book__leaf--left" />
        <Leaf className="sd-book__leaf--right" />
        <div className="sd-book__open">
          <div className="sd-book__page sd-book__page--left">
            {poster ? <PosterThumb track={poster} className="sd-book__poster" /> : <span className="sd-book__photo" />}
          </div>
          <div className="sd-book__page sd-book__page--right">
            <span className="sd-book__hand">Mes<br />courses<br />en images</span>
          </div>
        </div>
      </div>
      <ul className="sd-book__list">
        <li><CheckDot /> Vos affiches en un livre</li>
        <li><CheckDot /> Vos records et votre progression</li>
        <li><CheckDot /> Une belle mise en page automatique</li>
      </ul>
      <button type="button" className="sd-book__btn" onClick={onBook}>
        <BookIcon size={24} /> Créer mon livre <span aria-hidden="true">→</span>
      </button>
    </aside>
  )
}
