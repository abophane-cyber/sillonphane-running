import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

/** Icône d'enregistrement GPS animée (anneau qui pulse autour du point, en boucle). */
export function RecordIcon({ size = 28, className }: Props) {
  const bgId = useId()
  const animName = `recordIconPulse-${bgId.replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg viewBox="0 0 320 320" width={size} height={size} className={className} style={{ borderRadius: 8, flexShrink: 0 }}>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A2723" /><stop offset="100%" stopColor="#15130F" />
        </linearGradient>
      </defs>
      <rect width="320" height="320" rx="60" fill={`url(#${bgId})`} />

      <circle cx="160" cy="160" r="34" fill="none" stroke="#D97A3D" strokeWidth="10"
              style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `${animName} 2.2s ease-out infinite` }} />
      <circle cx="160" cy="160" r="30" fill="#D97A3D" stroke="#F4EDE0" strokeWidth="4" />

      <style>{`
        @keyframes ${animName} {
          0%   { transform: scale(0.9); opacity: 0.9; }
          70%  { transform: scale(1.9); opacity: 0; }
          100% { transform: scale(1.9); opacity: 0; }
        }
      `}</style>
    </svg>
  )
}
