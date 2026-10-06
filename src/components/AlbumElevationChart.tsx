import { useMemo } from 'react'
import type { GpxPoint } from '../types'

interface Props {
  points: GpxPoint[]
  distances: number[]
}

const W = 400
const H = 60
const PAD = { top: 14, right: 6, bottom: 16, left: 6 }

function sample(points: GpxPoint[], distances: number[], n: number) {
  if (points.length === 0) return []
  const total = distances[distances.length - 1]
  const out: { x: number; ele: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const d = t * total
    let lo = 0, hi = points.length - 1
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (distances[m] < d) lo = m; else hi = m }
    const f = distances[hi] === distances[lo] ? 0 : (d - distances[lo]) / (distances[hi] - distances[lo])
    out.push({ x: t, ele: points[lo].ele + f * (points[hi].ele - points[lo].ele) })
  }
  return out
}

export function AlbumElevationChart({ points, distances }: Props) {
  const { pathD, fillD, minEle, maxEle } = useMemo(() => {
    if (points.length < 2) return { pathD: '', fillD: '', minEle: 0, maxEle: 0 }
    const sampled = sample(points, distances, Math.min(points.length, 200))
    const minEle = Math.min(...sampled.map(p => p.ele))
    const maxEle = Math.max(...sampled.map(p => p.ele))
    const range = maxEle - minEle || 1
    const iW = W - PAD.left - PAD.right
    const iH = H - PAD.top - PAD.bottom
    const pts = sampled.map(p => ({
      x: PAD.left + p.x * iW,
      y: PAD.top + iH - ((p.ele - minEle) / range) * iH,
    }))
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const last = pts[pts.length - 1]
    const fillD = `${pathD} L${last.x.toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${PAD.left},${(H - PAD.bottom).toFixed(1)} Z`
    return { pathD, fillD, minEle, maxEle }
  }, [points, distances])

  if (!pathD) return null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="alb-elev-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2F5C45" stopOpacity="0.45"/>
          <stop offset="100%" stopColor="#2F5C45" stopOpacity="0.03"/>
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#alb-elev-grad)"/>
      <path d={pathD} fill="none" stroke="#2F5C45" strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round"/>
      {/* Altitude max en haut à gauche */}
      <text x={PAD.left + 2} y={PAD.top - 3}
        fill="#64748B" fontSize="8" fontFamily="Helvetica Neue, Arial, sans-serif"
        fontWeight="600">
        {Math.round(maxEle)} m
      </text>
      {/* Altitude min en bas à gauche */}
      <text x={PAD.left + 2} y={H - 3}
        fill="#64748B" fontSize="8" fontFamily="Helvetica Neue, Arial, sans-serif"
        fontWeight="600">
        {Math.round(minEle)} m
      </text>
    </svg>
  )
}
