import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

/** Logo Sillonphane-Rando animé (le tracé se dessine puis les deux points apparaissent, en boucle). */
export function AppLogoIcon({ size = 28, className }: Props) {
  const gradientId = useId()
  return (
    <svg viewBox="0 0 320 320" width={size} height={size} className={className} style={{ borderRadius: 8, flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#2F5C45" />
          <stop offset="50%" stopColor="#D97A3D" />
          <stop offset="100%" stopColor="#F4EDE0" />
        </linearGradient>
      </defs>
      <rect width="320" height="320" fill="#000" />
      <path
        pathLength="1"
        d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
        fill="none" stroke={`url(#${gradientId})`} strokeWidth="29" strokeLinecap="round"
        className="app-logo__stroke"
      />
      <circle cx="220" cy="60" r="10" fill="#2F5C45" stroke="#F4EDE0" strokeWidth="3" className="app-logo__dot app-logo__dot--end" />
      <circle cx="138" cy="225" r="10" fill="#F4EDE0" className="app-logo__dot app-logo__dot--start" />
    </svg>
  )
}
