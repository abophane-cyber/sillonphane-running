import { useMemo, useState } from 'react'
import { buildDistanceArray } from '../lib/gpx'
import type { ParsedGpx, GpxTrack } from '../types'

/** Le GPX chargé, son tracé actif, et les données dérivées (points/distances). */
export function useGpxSession() {
  const [gpx, setGpx] = useState<ParsedGpx | null>(null)
  const [activeTrack, setActiveTrack] = useState<GpxTrack | null>(null)
  const [rawGpx, setRawGpx] = useState('')

  const points = useMemo(() => activeTrack?.points ?? [], [activeTrack])
  const distances = useMemo(
    () => (activeTrack ? buildDistanceArray(activeTrack.points) : []),
    [activeTrack],
  )

  /** Charge un nouveau GPX et sélectionne son premier tracé — ne touche à rien d'autre. */
  function loadTrack(parsed: ParsedGpx, raw?: string) {
    if (raw !== undefined) setRawGpx(raw)
    setGpx(parsed)
    setActiveTrack(parsed.tracks[0])
  }

  function clear() {
    setGpx(null)
    setActiveTrack(null)
  }

  return { gpx, setGpx, activeTrack, setActiveTrack, rawGpx, points, distances, loadTrack, clear }
}
