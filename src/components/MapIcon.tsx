import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

/** Icône carte animée (le tracé se dessine sur une carte pliée, en boucle). */
export function MapIcon({ size = 28, className }: Props) {
  const bgId = useId()
  const strokeId = useId()
  const animName = `mapIconDraw-${bgId.replace(/[^a-zA-Z0-9]/g, '')}`
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

      <path d="M 72,96 L 138,72 L 182,96 L 248,72 L 248,224 L 182,248 L 138,224 L 72,248 Z"
            fill="none" stroke="#F4EDE0" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <line x1="138" y1="72" x2="138" y2="224" stroke="#F4EDE0" strokeWidth="10" strokeDasharray="2 16" strokeLinecap="round" opacity="0.35" />
      <line x1="182" y1="96" x2="182" y2="248" stroke="#F4EDE0" strokeWidth="10" strokeDasharray="2 16" strokeLinecap="round" opacity="0.35" />

      <path
        pathLength="1"
        d="M 96,200 C 120,170 108,140 138,132 C 168,124 160,96 196,88"
        fill="none" stroke={`url(#${strokeId})`} strokeWidth="20" strokeLinecap="round"
        style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: `${animName} 4.4s ease-in-out infinite` }}
      />
      <circle cx="96" cy="200" r="12" fill="#F4EDE0" />
      <circle cx="196" cy="88" r="12" fill="#D97A3D" stroke="#F4EDE0" strokeWidth="3" />

      <style>{`
        @keyframes ${animName} {
          0%   { stroke-dashoffset: 1; }
          40%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  )
}
