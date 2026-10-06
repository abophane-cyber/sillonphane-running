import { useEffect, useState } from 'react'
import type { GpxTrack } from '../types'
import { formatDistance, formatElevation } from '../lib/gpx'
import { fetchHistoricalWeather, type WeatherInfo } from '../lib/meteo'

interface Props {
  track: GpxTrack
  manualDate?: string
  departureTime?: string
  arrivalTime?: string
  customTitle?: string
  onTitleChange?: (title: string) => void
  startName?: string
  endName?: string
  onStartNameChange?: (v: string) => void
  onEndNameChange?: (v: string) => void
  onStart: () => void
  onBack: () => void
}

function parseHour(time?: string): number | undefined {
  if (!time) return undefined
  const h = parseInt(time.split(':')[0])
  return isNaN(h) ? undefined : h
}

export function TitleScreen({ track, manualDate, departureTime, arrivalTime, customTitle, onTitleChange, startName: startNameProp, endName: endNameProp, onStartNameChange, onEndNameChange, onStart, onBack }: Props) {
  const effectiveDate = manualDate
    ? new Date(manualDate + 'T12:00:00')
    : track.startTime ?? null

  const first = track.points[0]
  const last = track.points[track.points.length - 1]
  const isSamePoint = Math.abs(first.lat - last.lat) < 0.001 && Math.abs(first.lon - last.lon) < 0.001

  const coordStart = `${first.lat.toFixed(3)}, ${first.lon.toFixed(3)}`
  const coordEnd = `${last.lat.toFixed(3)}, ${last.lon.toFixed(3)}`

  // Titre local éditable, initialisé depuis le prop ou le nom de track
  const [title, setTitle] = useState<string>(customTitle || track.name || 'Mon parcours')

  function handleTitleChange(val: string) {
    setTitle(val)
    onTitleChange?.(val)
  }

  // Resync si la track ou le customTitle changent depuis le parent
  useEffect(() => {
    setTitle(customTitle || track.name || 'Mon parcours')
  }, [track, customTitle])

  const [startName, setStartName] = useState<string>(startNameProp || coordStart)
  const [endName, setEndName] = useState<string>(endNameProp || coordEnd)
  const [weather, setWeather] = useState<WeatherInfo | null>(null)

  // Sync si les noms arrivent du parent après le premier rendu
  useEffect(() => { if (startNameProp) setStartName(startNameProp) }, [startNameProp])
  useEffect(() => { if (endNameProp) setEndName(endNameProp) }, [endNameProp])

  const effectiveDepHour = parseHour(departureTime)
  const effectiveArrHour = parseHour(arrivalTime)

  useEffect(() => {
    setWeather(null)
    if (effectiveDate) {
      fetchHistoricalWeather(
        first.lat, first.lon, effectiveDate,
        effectiveDepHour,
        effectiveArrHour,
      ).then(w => setWeather(w))
    }
  }, [track, manualDate, departureTime, arrivalTime])

  return (
    <div className="title-page">
      {/* Titre éditable */}
      <div className="title-page__title-wrap">
        <input
          className="title-page__title-input"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="Titre du parcours"
          maxLength={80}
        />
        <span className="title-page__title-hint">✏️ cliquez pour modifier</span>
      </div>

      <div className="title-page__route">
        <div className="title-page__place">
          <span className="title-page__place-label">Départ</span>
          <input
            className="title-page__place-input"
            value={startName}
            onChange={e => { setStartName(e.target.value); onStartNameChange?.(e.target.value) }}
            placeholder="Lieu de départ"
          />
          <span className="title-page__place-hint">✏️ modifiable</span>
        </div>
        <div className="title-page__arrow-col">
          <div className="title-page__arrow-line" />
          <span className="title-page__distance-badge">{formatDistance(track.distance)}</span>
          <div className="title-page__arrow-line" />
          <span className="title-page__arrow-icon">▶</span>
        </div>
        <div className="title-page__place title-page__place--end">
          <span className="title-page__place-label">Arrivée</span>
          <input
            className="title-page__place-input"
            value={isSamePoint ? startName : endName}
            onChange={e => { setEndName(e.target.value); onEndNameChange?.(e.target.value) }}
            placeholder="Lieu d'arrivée"
            readOnly={isSamePoint}
          />
          {!isSamePoint && <span className="title-page__place-hint">✏️ modifiable</span>}
        </div>
      </div>

      <div className="title-page__stats">
        <div className="stat-card">
          <span className="stat-card__icon">📏</span>
          <span className="stat-card__value">{formatDistance(track.distance)}</span>
          <span className="stat-card__label">Distance</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon">⛰️</span>
          <span className="stat-card__value">+{formatElevation(track.elevGain)}</span>
          <span className="stat-card__label">Dénivelé +</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon">🔽</span>
          <span className="stat-card__value">-{formatElevation(track.elevLoss)}</span>
          <span className="stat-card__label">Dénivelé -</span>
        </div>

        {effectiveDate && (
          <div className="stat-card">
            <span className="stat-card__icon">📅</span>
            <span className="stat-card__value">
              {effectiveDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span className="stat-card__label">Date</span>
          </div>
        )}

        {/* Météo départ */}
        {weather?.departure && (
          <div className="stat-card">
            <span className="stat-card__icon">{weather.departure.icon}</span>
            <span className="stat-card__value">{weather.departure.temp}°C</span>
            <span className="stat-card__label">Départ {departureTime}</span>
          </div>
        )}

        {/* Météo arrivée */}
        {weather?.arrival && (
          <div className="stat-card">
            <span className="stat-card__icon">{weather.arrival.icon}</span>
            <span className="stat-card__value">{weather.arrival.temp}°C</span>
            <span className="stat-card__label">Arrivée {arrivalTime}</span>
          </div>
        )}

        {/* Météo journalière si pas d'heures saisies */}
        {weather && !weather.departure && !weather.arrival && (
          <div className="stat-card">
            <span className="stat-card__icon">🌡️</span>
            <span className="stat-card__value">{weather.tempMin}–{weather.tempMax}°C</span>
            <span className="stat-card__label">Température du jour</span>
          </div>
        )}

      </div>

      <button className="title-page__start" onClick={onStart}>
        ▶ Lancer l'animation
      </button>
    </div>
  )
}
