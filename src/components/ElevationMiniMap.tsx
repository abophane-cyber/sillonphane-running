import { useMemo } from 'react'
import type { GpxPoint } from '../types'

interface Props {
  points: GpxPoint[]
  distances: number[]
  progress: number
  totalDistance: number
  elevGain: number
  elevLoss: number
  distanceCovered: number
  currentEle: number
}

const W = 320
const H = 80
const PAD = { top: 8, right: 10, bottom: 8, left: 10 }

function sample(points: GpxPoint[], distances: number[], n: number): { x: number; ele: number }[] {
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

// Altitude lissée : moyenne sur ±3 points voisins
function smoothEle(points: GpxPoint[], idx: number): number {
  const r = 3
  const lo = Math.max(0, idx - r), hi = Math.min(points.length - 1, idx + r)
  let s = 0; for (let i = lo; i <= hi; i++) s += points[i].ele
  return s / (hi - lo + 1)
}

// Pente moyenne sur le tronçon de 100m centré sur la position courante
function currentSlope(points: GpxPoint[], distances: number[], progress: number): number {
  const total = distances[distances.length - 1]
  const posDist = progress * total
  const WIN = 100
  const dLo = Math.max(0, posDist - WIN / 2)
  const dHi = Math.min(total, posDist + WIN / 2)

  let iLo = 0, iHi = points.length - 1
  for (let i = 0; i < points.length - 1; i++) {
    if (distances[i] <= dLo) iLo = i
    if (distances[i] <= dHi) iHi = i
  }
  const dDist = distances[iHi] - distances[iLo]
  if (dDist < 20) return 0
  const dEle = smoothEle(points, iHi) - smoothEle(points, iLo)
  return Math.round((dEle / dDist) * 100)
}

function interpolateY(sampled: { x: number; ele: number }[], progress: number, minEle: number, range: number, innerH: number): number {
  const idx = sampled.findIndex(p => p.x >= progress)
  if (idx <= 0) return PAD.top + innerH - ((sampled[0]?.ele ?? 0 - minEle) / range) * innerH
  const a = sampled[idx - 1], b = sampled[idx]
  const f = (progress - a.x) / (b.x - a.x)
  return PAD.top + innerH - ((a.ele + f * (b.ele - a.ele) - minEle) / range) * innerH
}

function fmt(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m` }

export function ElevationMiniMap({ points, distances, progress, totalDistance, elevGain, elevLoss, distanceCovered, currentEle }: Props) {
  const avgSlope = totalDistance > 0 ? Math.round((elevGain / totalDistance) * 100) : 0
  const { pathD, fillD, minEle, maxEle, sampled } = useMemo(() => {
    if (points.length < 2) return { pathD: '', fillD: '', minEle: 0, maxEle: 0, sampled: [] }
    const sampled = sample(points, distances, Math.min(points.length, 300))
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
    const fillD = pathD + ` L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`
    return { pathD, fillD, minEle, maxEle, sampled }
  }, [points, distances])

  const slope = useMemo(
    () => progress >= 0.98 ? avgSlope : currentSlope(points, distances, progress),
    [points, distances, progress, avgSlope]
  )

  if (!pathD) return null

  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom
  const range = maxEle - minEle || 1
  const dotX = PAD.left + progress * iW
  const dotY = interpolateY(sampled, progress, minEle, range, iH)

  return (
    <div className="elev-minimap">
      <div className="elev-minimap__stats">
        <span className="elev-minimap__stat">
          <span className="elev-minimap__icon">↔</span>
          {fmt(distanceCovered)} <span className="elev-minimap__total">/ {fmt(totalDistance)}</span>
        </span>
        <span className="elev-minimap__stat">
          <span className="elev-minimap__icon elev-minimap__icon--up">↑</span>
          {Math.round(elevGain)} m
        </span>
        <span className="elev-minimap__stat">
          <span className="elev-minimap__icon elev-minimap__icon--down">↓</span>
          {Math.round(elevLoss)} m
        </span>
        <span className="elev-minimap__stat">
          <span className="elev-minimap__icon">⛰</span>
          {Math.round(currentEle)} m
        </span>
        <span className="elev-minimap__stat">
          <span className="elev-minimap__icon">▲</span>
          {slope}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          <linearGradient id="mini-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(26,107,60,0.22)" />
            <stop offset="100%" stopColor="rgba(26,107,60,0.04)" />
          </linearGradient>
        </defs>
        <clipPath id="done-clip">
          <rect x={PAD.left} y={0} width={progress * iW} height={H} />
        </clipPath>
        <path d={fillD} fill="url(#mini-grad)" />
        <path d={fillD} fill="rgba(26,107,60,0.20)" clipPath="url(#done-clip)" />
        <path d={pathD} fill="none" stroke="rgba(0,0,0,0.20)" strokeWidth="2" />
        <path d={pathD} fill="none" stroke="#1a6b3c" strokeWidth="2.5" clipPath="url(#done-clip)" />
        <circle cx={dotX} cy={dotY} r="6" fill="#1a6b3c" stroke="#fff" strokeWidth="2" />
        <circle cx={dotX} cy={dotY} r="3" fill="#fff" />
        <text x={PAD.left + 3} y={PAD.top + 11} fontSize="11" fontWeight="700" fill="#1a1a1a" stroke="#fff" strokeWidth="3" paintOrder="stroke">{Math.round(maxEle)} m</text>
        <text x={PAD.left + 3} y={H - PAD.bottom + 1} fontSize="11" fontWeight="700" fill="#1a1a1a" stroke="#fff" strokeWidth="3" paintOrder="stroke">{Math.round(minEle)} m</text>
      </svg>
    </div>
  )
}
