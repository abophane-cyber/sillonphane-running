import { useMemo } from 'react'
import type { GpxPoint } from '../types'

interface Props {
  points: GpxPoint[]
  distances: number[]
  totalDistance: number
  progress: number
  onSeek: (t: number) => void
}

const W = 1000
const H = 72
const PAD_X = 0
const PAD_TOP = 6
const PAD_BOT = 4

// Sous-échantillonne à N points pour lisser le profil
function sample(points: GpxPoint[], distances: number[], n: number): { x: number; ele: number }[] {
  if (points.length === 0) return []
  const total = distances[distances.length - 1]
  const result: { x: number; ele: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const targetDist = t * total
    let lo = 0, hi = points.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (distances[mid] < targetDist) lo = mid; else hi = mid
    }
    const frac = distances[hi] === distances[lo] ? 0 : (targetDist - distances[lo]) / (distances[hi] - distances[lo])
    result.push({ x: t, ele: points[lo].ele + frac * (points[hi].ele - points[lo].ele) })
  }
  return result
}

export function ElevationProfile({ points, distances, progress, onSeek }: Props) {
  const { pathD, fillD, minEle, maxEle } = useMemo(() => {
    if (points.length < 2) return { pathD: '', fillD: '', minEle: 0, maxEle: 0 }

    const sampled = sample(points, distances, Math.min(points.length, 300))
    const minEle = Math.min(...sampled.map(p => p.ele))
    const maxEle = Math.max(...sampled.map(p => p.ele))
    const range = maxEle - minEle || 1
    const innerH = H - PAD_TOP - PAD_BOT
    const innerW = W - PAD_X * 2

    const pts = sampled.map(p => ({
      x: PAD_X + p.x * innerW,
      y: PAD_TOP + innerH - ((p.ele - minEle) / range) * innerH,
    }))

    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const fillD = pathD + ` L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`

    return { pathD, fillD, minEle, maxEle }
  }, [points, distances])

  const cursorX = PAD_X + progress * (W - PAD_X * 2)

  function onClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(t)
  }

  if (!pathD) return null

  return (
    <div className="elevation-profile">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onClick={onClick}
        style={{ cursor: 'crosshair', width: '100%', height: H, display: 'block' }}
      >
        <defs>
          <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
          </linearGradient>
        </defs>

        {/* Aire remplie */}
        <path d={fillD} fill="url(#elev-grad)" />
        {/* Contour */}
        <path d={pathD} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />

        {/* Curseur */}
        <line x1={cursorX} y1={PAD_TOP} x2={cursorX} y2={H} stroke="var(--color-accent)" strokeWidth="2" />
        <circle cx={cursorX} cy={PAD_TOP + 6} r="4" fill="var(--color-accent)" stroke="#fff" strokeWidth="1.5" />

        {/* Labels altitude */}
        <text x="6" y={PAD_TOP + 10} fontSize="11" fill="rgba(255,255,255,0.6)">{Math.round(maxEle)}m</text>
        <text x="6" y={H - PAD_BOT - 2} fontSize="11" fill="rgba(255,255,255,0.6)">{Math.round(minEle)}m</text>
      </svg>
    </div>
  )
}
