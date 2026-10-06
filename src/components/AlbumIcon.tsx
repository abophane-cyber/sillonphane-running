import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

/** Icône album-photo animée (une photo glisse en place par-dessus l'autre, en boucle). */
export function AlbumIcon({ size = 28, className }: Props) {
  const bgId = useId()
  const strokeId = useId()
  const animName = `albumIconSlide-${bgId.replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg viewBox="0 0 320 320" width={size} height={size} className={className} style={{ borderRadius: 8, flexShrink: 0 }}>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A2723" /><stop offset="100%" stopColor="#15130F" />
        </linearGradient>
        <linearGradient id={strokeId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#2F5C45" /><stop offset="50%" stopColor="#D97A3D" /><stop offset="100%" stopColor="#F4EDE0" />
        </linearGradient>
      </defs>
      <rect width="320" height="320" rx="60" fill={`url(#${bgId})`} />

      <rect x="64" y="76" width="176" height="176" rx="28"
            fill="none" stroke={`url(#${strokeId})`} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="138" cy="128" r="15" fill="#D97A3D" />
      <polyline points="100,215 128,168 152,195 178,158 205,215"
                fill="none" stroke="#F4EDE0" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />

      <g style={{ animation: `${animName} 4.4s cubic-bezier(.2,.7,.3,1) infinite` }}>
        <rect x="88" y="100" width="176" height="176" rx="28"
              fill={`url(#${bgId})`} stroke={`url(#${strokeId})`} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M118,216 L176,148 L234,216 Z" fill="#F4EDE0" />
        <path d="M159,216 L176,180 L193,216 Z" fill="#D97A3D" />
        <line x1="112" y1="216" x2="240" y2="216" stroke="#F4EDE0" strokeWidth="8" strokeLinecap="round" />
      </g>

      <style>{`
        @keyframes ${animName} {
          0%   { transform: translate(90px,90px); opacity: 0; }
          3%   { opacity: 1; }
          40%  { transform: translate(0,0); opacity: 1; }
          88%  { transform: translate(0,0); opacity: 1; }
          100% { transform: translate(0,0); opacity: 0; }
        }
      `}</style>
    </svg>
  )
}
