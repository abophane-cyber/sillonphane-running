import { useState } from 'react'
import type { GpxTrack } from '../types'
import { getDefaultSillon, addTrackToVoyage } from '../lib/voyageDB'

interface Props {
  track: GpxTrack
  gpxData: string
  trackName: string
}

export function AddToVoyageButton({ track, gpxData, trackName }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')

  async function save() {
    if (state !== 'idle') return
    setState('saving')
    try {
      const sillon = await getDefaultSillon()
      const already = sillon.tracks.some(t => t.name === trackName)
      if (!already) {
        await addTrackToVoyage(sillon.id, {
          name: trackName,
          gpxData,
          distanceM: track.distance,
          elevGainM: track.elevGain,
          durationSec: track.duration,
          date: track.startTime?.toISOString().slice(0, 10),
        })
      }
      setState('done')
      setTimeout(() => setState('idle'), 2500)
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      className={`atv__btn${state === 'done' ? ' atv__btn--done' : ''}`}
      onClick={save}
      disabled={state === 'saving'}
      title="Enregistrer dans Mes sillons"
    >
      {state === 'done' ? '✓ Enregistré' : state === 'saving' ? '…' : '📂 Mes sillons'}
    </button>
  )
}
