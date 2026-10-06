import { useId } from 'react'

/** Figurine « ruban seul » du cartouche des personnages : le S du logo Sillonphane-Rando (même tracé, mêmes couleurs
 * vert → orange → crème et mêmes deux points), à la taille des figurines des personnages. */
export function RibbonIcon({ height = 44 }: { height?: number }) {
  const gradientId = useId()
  // Cadrage serré autour du S du logo (viewBox d'origine 320×320).
  const VB = { x: 96, y: 36, w: 152, h: 216 }
  return (
    <svg
      width={(height * VB.w) / VB.h} height={height} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      aria-hidden="true" style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#2F5C45" />
          <stop offset="50%" stopColor="#D97A3D" />
          <stop offset="100%" stopColor="#F4EDE0" />
        </linearGradient>
      </defs>
      <path
        d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
        fill="none" stroke={`url(#${gradientId})`} strokeWidth="29" strokeLinecap="round"
      />
      <circle cx="220" cy="60" r="10" fill="#2F5C45" stroke="#F4EDE0" strokeWidth="3" />
      <circle cx="138" cy="225" r="10" fill="#F4EDE0" />
    </svg>
  )
}
