import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

/** Icône smartphone animée (un point GPS avance le long d'un tracé sur l'écran, en boucle). */
export function PhoneIcon({ size = 28, className }: Props) {
  const bgId = useId()
  const strokeId = useId()
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

      <rect x="108" y="56" width="104" height="208" rx="20"
            fill="none" stroke={`url(#${strokeId})`} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="140" y1="228" x2="180" y2="228" stroke="#F4EDE0" strokeWidth="10" strokeLinecap="round" opacity="0.6" />

      <path d="M 128,190 C 140,160 150,190 162,160 C 174,130 184,160 192,130"
            fill="none" stroke="#F4EDE0" strokeWidth="8" strokeLinecap="round" opacity="0.4" />

      <circle r="11" fill="#D97A3D" stroke="#F4EDE0" strokeWidth="3">
        <animateMotion
          dur="4.4s" repeatCount="indefinite"
          path="M 128,190 C 140,160 150,190 162,160 C 174,130 184,160 192,130"
          keyPoints="0;0;1;1" keyTimes="0;0.05;0.55;1" calcMode="linear"
        />
      </circle>
    </svg>
  )
}
