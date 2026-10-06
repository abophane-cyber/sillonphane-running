import { useId } from 'react'

/**
 * Filigrane décoratif : le tracé du logo Sillage se redessine en boucle, très discret,
 * derrière le contenu de la page. Légèrement coloré (dégradé vert → terracotta → sable de
 * la charte). Purement ornemental (aria-hidden, pointer-events: none).
 */
export function PageWatermark() {
  const gradientId = useId()
  return (
    <div className="page-watermark" aria-hidden="true">
      <svg viewBox="0 0 320 320" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#2F5C45" />
            <stop offset="55%" stopColor="#D97A3D" />
            <stop offset="100%" stopColor="#E8C9A0" />
          </linearGradient>
        </defs>
        <path
          pathLength={1}
          d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
          stroke={`url(#${gradientId})`}
          strokeWidth={24}
          strokeLinecap="round"
          className="page-watermark__stroke"
        />
      </svg>
    </div>
  )
}
