interface Props {
  size?: number
  className?: string
}

/** Petites icônes utilitaires en trait, couleur héritée (currentColor) — pour labels et boutons
 * inline, par opposition aux badges illustrés (AlbumIcon, MapIcon…) réservés aux cartes d'accueil. */

export function CalendarIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  )
}

export function ClockIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 16,14" />
    </svg>
  )
}

export function CheckIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="7.5,12.5 10.5,15.5 16.5,9" />
    </svg>
  )
}

export function HomeIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4,11 L12,4 L20,11" />
      <path d="M6,10 L6,20 L18,20 L18,10" />
    </svg>
  )
}

export function FolderIcon({ size = 16, className }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3,7 C3,5.9 3.9,5 5,5 L9,5 L11,7.5 L19,7.5 C20.1,7.5 21,8.4 21,9.5 L21,17 C21,18.1 20.1,19 19,19 L5,19 C3.9,19 3,18.1 3,17 Z" />
    </svg>
  )
}
