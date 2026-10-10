import { useEffect, useState } from 'react'
import type { Voyage } from '../types'
import { getAllVoyages, saveVoyage, createVoyage, addTrackToVoyage, findSameTrack } from '../lib/voyageDB'
import type { GpxTrack } from '../types'

interface Props {
  track: GpxTrack
  gpxData: string
  trackName: string
  manualDate?: string
  departureTime?: string
  arrivalTime?: string
  // Tracé issu d'un enregistrement GPS en direct : marque source:'recorded' sur la nouvelle
  // entrée (active le téléchargement .gpx côté « Mes sillons »).
  recordedLive?: boolean
  // Sillon dans lequel ce tracé a déjà été auto-sauvegardé à l'arrêt de l'enregistrement (voir
  // App.tsx) : présélectionné pour que "Enregistrer" ici retrouve la même entrée au lieu d'en
  // créer une deuxième dans le dossier le plus récemment créé.
  defaultSillonId?: string
  onSaved: (sillonId: string, trackId: string) => void
  onClose: () => void
}

export function SaveToSillonModal({ track, gpxData, trackName, manualDate, departureTime, arrivalTime, recordedLive, defaultSillonId, onSaved, onClose }: Props) {
  const [sillons, setSillons]   = useState<Voyage[]>([])
  const [newName, setNewName]     = useState('')
  const [selected, setSelected]   = useState<string | 'new'>('new')
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    getAllVoyages().then(v => {
      const sorted = v.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setSillons(sorted)
      const preselect = defaultSillonId && sorted.some(s => s.id === defaultSillonId) ? defaultSillonId : sorted[0]?.id
      if (preselect) setSelected(preselect)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      let sillonId: string
      if (selected === 'new' || sillons.length === 0) {
        const name = newName.trim() || trackName
        const v = createVoyage(name)
        await saveVoyage(v)
        sillonId = v.id
      } else {
        sillonId = selected
      }
      const existing = findSameTrack(sillons.find(v => v.id === sillonId)?.tracks ?? [], gpxData)
      let trackId: string
      if (existing) {
        trackId = existing.id
      } else {
        const entry = await addTrackToVoyage(sillonId, {
          name: trackName,
          gpxData,
          ...(recordedLive ? { source: 'recorded' as const } : {}),
          distanceM: track.distance,
          elevGainM: track.elevGain,
          elevLossM: track.elevLoss,
          durationSec: track.duration,
          date: manualDate || track.startTime?.toISOString().slice(0, 10),
          departureTime,
          arrivalTime,
        })
        trackId = entry.id
      }
      onSaved(sillonId, trackId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ssm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ssm-modal">
        <h2 className="ssm-title">Enregistrer le tracé</h2>

        {sillons.length > 0 && (
          <div className="ssm-section">
            <p className="ssm-label">Ajouter à un dossier Sillon existant</p>
            <ul className="ssm-list">
              {sillons.map(v => (
                <li key={v.id}>
                  <button
                    className={`ssm-item${selected === v.id ? ' ssm-item--active' : ''}`}
                    onClick={() => setSelected(v.id)}
                  >
                    <span className="ssm-item__name">{v.name}</span>
                    <span className="ssm-item__count">{v.tracks.length} tracé{v.tracks.length !== 1 ? 's' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="ssm-section">
          <p className="ssm-label">Ou créer un nouveau dossier Sillon</p>
          <div className="ssm-new-row">
            <input
              className={`ssm-input${selected === 'new' ? ' ssm-input--active' : ''}`}
              placeholder="Nom du sillon (ex : Saison 2026, Mes marathons…)"
              value={newName}
              onFocus={() => setSelected('new')}
              onChange={e => { setNewName(e.target.value); setSelected('new') }}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
        </div>

        <div className="ssm-actions">
          <button className="ssm-btn ssm-btn--ghost" onClick={onClose}>Plus tard</button>
          <button className="ssm-btn ssm-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? '…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
