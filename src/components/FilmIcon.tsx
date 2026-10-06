import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

/** Icône film animée (le clap de cinéma claque puis se rouvre, en boucle). */
export function FilmIcon({ size = 28, className }: Props) {
  const bgId = useId()
  const strokeId = useId()
  const clipId = useId()
  const animName = `filmIconClap-${bgId.replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg viewBox="0 0 320 320" width={size} height={size} className={className} style={{ borderRadius: 8, flexShrink: 0 }}>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A2723" /><stop offset="100%" stopColor="#15130F" />
        </linearGradient>
        <linearGradient id={strokeId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#2F5C45" /><stop offset="50%" stopColor="#D97A3D" /><stop offset="100%" stopColor="#F4EDE0" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="108" y="142" width="104" height="24" rx="6" />
        </clipPath>
      </defs>

      <rect width="320" height="320" rx="60" fill={`url(#${bgId})`} />

      <rect x="72" y="72" width="176" height="176" rx="28"
            fill={`url(#${bgId})`} stroke={`url(#${strokeId})`} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />

      <rect x="108" y="164" width="104" height="46" rx="8" fill="#F4EDE0" />
      <circle cx="108" cy="166" r="6" fill="#D97A3D" />

      <g style={{ transformBox: 'fill-box', transformOrigin: '0% 100%', animation: `${animName} 3.2s ease-in-out infinite` }}>
        <rect x="108" y="142" width="104" height="24" rx="6" fill="#F4EDE0" />
        <g clipPath={`url(#${clipId})`}>
          <rect x="116" y="140" width="10" height="30" fill="#D97A3D" transform="skewX(-20)" />
          <rect x="138" y="140" width="10" height="30" fill="#2A2723" transform="skewX(-20)" />
          <rect x="160" y="140" width="10" height="30" fill="#D97A3D" transform="skewX(-20)" />
          <rect x="182" y="140" width="10" height="30" fill="#2A2723" transform="skewX(-20)" />
          <rect x="204" y="140" width="10" height="30" fill="#D97A3D" transform="skewX(-20)" />
        </g>
      </g>

      <style>{`
        @keyframes ${animName} {
          0%   { transform: rotate(-16deg); }
          44%  { transform: rotate(-16deg); }
          48%  { transform: rotate(3deg); }
          52%  { transform: rotate(0deg); }
          75%  { transform: rotate(0deg); }
          90%  { transform: rotate(-16deg); }
          100% { transform: rotate(-16deg); }
        }
      `}</style>
    </svg>
  )
}
