import { useEffect, useMemo, useRef, useState } from 'react'
import { parseGpx, buildDistanceArray } from '../lib/gpx'
import type { VoyageTrack } from '../types'
import { AlbumMap } from './AlbumMap'
import { AlbumElevationChart } from './AlbumElevationChart'
import { fetchHistoricalWeather, type WeatherInfo } from '../lib/meteo'
import { buildEditorialText } from '../lib/editorialTemplate'

interface Props {
  track: VoyageTrack
  voyageName: string
  photos?: { id: string; url: string }[]
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onBack: () => void
  onPrint?: () => void
}

export interface AlbumSpreadContentProps {
  track: VoyageTrack
  voyageName: string
  photos?: { id: string; url: string }[]
  pageNumber?: number
  /** Appelé quand la carte MapLibre a fini de peindre (tuiles + tracé) — utilisé avant impression
   * pour ne déclencher window.print() qu'une fois la carte réellement visible. */
  onMapIdle?: () => void
  /** Appelé une fois la requête météo terminée (succès, échec ou non applicable) — même usage
   * que onMapIdle, pour éviter d'imprimer une page où la météo affiche encore "--". */
  onWeatherReady?: () => void
  /** Classe(s) additionnelle(s) fusionnée(s) sur la racine .asp2-a4 — notamment .albed-preview
   * pour réduire la page à l'écran (elle doit s'appliquer directement au .asp2-a4, pas à un
   * conteneur englobant, sinon le rétrécissement n'a aucun effet). */
  className?: string
  /** Texte éditorial persisté (saisi à la main) ; absent = texte par défaut calculé à partir des
   * données de l'étape. Sans onTextChange, le texte est affiché en lecture seule. */
  text?: string
  /** Appelé à chaque modification du texte éditorial (saisie manuelle) — absent en lecture seule
   * (visionneuse, export PDF), où le texte n'est jamais réécrit dans la page. */
  onTextChange?: (value: string) => void
}

function parseTrackLabels(name: string): { prefix: string; start: string; end: string } {
  const sep = name.includes(' - ') ? ' - ' : name.includes(' – ') ? ' – ' : null
  if (!sep) return { prefix: '', start: name, end: '' }
  const parts = name.split(sep)
  const prefixMatch = parts[0].match(/^(J\d+)\s+(.+)/)
  const prefix = prefixMatch ? prefixMatch[1] : ''
  const start = (prefixMatch ? prefixMatch[2] : parts[0]).trim()
  const end = parts.slice(1).join(sep).trim()
  return { prefix, start, end }
}

// Tronque un nom de ville à maxChars caractères
function shortCity(name: string, maxChars = 14): string {
  return name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name
}

/** Contenu de la page résumé (carte, dénivelé, météo) — sans la barre de navigation, pour
 * pouvoir être intégré tel quel dans l'éditeur de composition, la visionneuse et l'impression. */
export function AlbumSpreadContent({ track, voyageName, pageNumber = 1, onMapIdle, onWeatherReady, className, text, onTextChange }: AlbumSpreadContentProps) {
  const [weather, setWeather] = useState<WeatherInfo | null>(null)
  const descRef = useRef<HTMLParagraphElement>(null)

  const { points, distances } = useMemo(() => {
    try {
      const pts = parseGpx(track.gpxData).tracks[0]?.points ?? []
      return { points: pts, distances: buildDistanceArray(pts) }
    } catch { return { points: [], distances: [] } }
  }, [track.gpxData])

  const { start: startLabel, end: endLabel } = useMemo(() => parseTrackLabels(track.name), [track.name])

  const totalDistance = track.distanceM ?? distances[distances.length - 1] ?? 0
  const elevGain = track.elevGainM ?? 0
  const elevLoss = track.elevLossM ?? 0

  const dateStr = track.date
    ? new Date(track.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : track.addedAt
    ? new Date(track.addedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : ''

  useEffect(() => {
    setWeather(null)
    if (!track.date || points.length < 2) { onWeatherReady?.(); return }
    let cancelled = false
    const first = points[0]
    const last = points[points.length - 1]
    // Priorité aux heures réelles du GPX (déjà présentes dans le tracé enregistré),
    // sinon on retombe sur les heures saisies manuellement à l'enregistrement.
    const depHour = first.time
      ? first.time.getHours()
      : track.departureTime ? parseInt(track.departureTime.split(':')[0]) : undefined
    const arrHour = last.time
      ? last.time.getHours()
      : track.arrivalTime ? parseInt(track.arrivalTime.split(':')[0]) : undefined
    fetchHistoricalWeather(first.lat, first.lon, new Date(track.date + 'T12:00:00'), depHour, arrHour)
      .then(w => { if (!cancelled) setWeather(w) })
      .catch(() => {})
      .finally(() => { if (!cancelled) onWeatherReady?.() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.date, track.departureTime, track.arrivalTime, points])

  // Texte par défaut, calculé localement à partir des seules données chiffrées de l'étape.
  const defaultDesc = useMemo(() => buildEditorialText({
    startLabel,
    endLabel,
    distanceKm: totalDistance / 1000,
    elevGain,
    seed: track.id,
  }), [track.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise la description quand on change d'étape — le texte persisté prime sur le défaut.
  useEffect(() => {
    if (descRef.current) descRef.current.textContent = text || defaultDesc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, defaultDesc])

  function handleDescInput() {
    onTextChange?.(descRef.current?.textContent ?? '')
  }

  const wDep = weather?.departure ?? (weather ? { temp: weather.tempMin, icon: '🌡', description: '' } : null)
  const wArr = weather?.arrival   ?? (weather ? { temp: weather.tempMax, icon: '🌡', description: '' } : null)

  const sidebarTitle = startLabel && endLabel
    ? `${startLabel} ➔ ${endLabel}`
    : track.name

  return (
        <div className={`asp2-a4${className ? ` ${className}` : ''}`}>

          {/* Sidebar gauche */}
          <div className="asp2-sb">
            <div className="asp2-sb-top">
              <div className="asp2-sb-voyage">{voyageName}</div>
              <div className="asp2-sb-date">{dateStr}</div>
              <h2 className="asp2-sb-title">{sidebarTitle}</h2>
              <div className="asp2-sb-desc-wrap">
                <p
                  ref={descRef}
                  className="asp2-sb-desc"
                  contentEditable={!!onTextChange}
                  suppressContentEditableWarning
                  onInput={handleDescInput}
                  onBlur={handleDescInput}
                  data-placeholder="Ajoutez un texte éditorial…"
                />
                {/* Repère d'édition uniquement (jamais dans la visionneuse ni le PDF) : signale que
                 * le texte affiché est le gabarit par défaut, tant que l'utilisateur n'a rien saisi. */}
                {onTextChange && !text && (
                  <div className="asp2-sb-desc-hint" aria-hidden="true">(texte proposé — en attente de votre propre texte)</div>
                )}
              </div>
            </div>
            {/* Filigrane numéro d'étape */}
            <div className="asp2-sb-watermark" aria-hidden="true">{pageNumber}</div>
          </div>

          {/* Zone droite */}
          <div className="asp2-right">

            {/* Carte IGN */}
            <div className="asp2-map-box">
              <AlbumMap
                points={points}
                startLabel={startLabel || 'Départ'}
                endLabel={endLabel || 'Arrivée'}
                onIdle={onMapIdle}
              />
            </div>

            {/* Dashboard bas */}
            <div className="asp2-dashboard">

              {/* 1. Profil altimétrique */}
              <div className="asp2-db-profile">
                <div className="asp2-db-label">Profil d'altitude</div>
                <div className="asp2-db-chart">
                  {points.length >= 2 && (
                    <AlbumElevationChart points={points} distances={distances} />
                  )}
                </div>
              </div>

              <div className="asp2-db-divider" />

              {/* 2. Stats */}
              <div className="asp2-db-stats">
                <div className="asp2-db-stat">
                  <div className="asp2-db-val">{(totalDistance / 1000).toFixed(1)}<span className="asp2-db-unit"> km</span></div>
                  <div className="asp2-db-key">Distance</div>
                </div>
                <div className="asp2-db-stat">
                  <div className="asp2-db-val">+{Math.round(elevGain)}<span className="asp2-db-unit"> m</span></div>
                  <div className="asp2-db-key">Dénivelé +</div>
                </div>
                <div className="asp2-db-stat">
                  <div className="asp2-db-val">−{Math.round(elevLoss)}<span className="asp2-db-unit"> m</span></div>
                  <div className="asp2-db-key">Dénivelé −</div>
                </div>
              </div>

              <div className="asp2-db-divider" />

              {/* 3. Météo */}
              <div className="asp2-db-weather">
                <div className="asp2-db-label">Météo du jour</div>
                <div className="asp2-db-wrow">
                  <span className="asp2-db-wcity">{shortCity(startLabel || 'Départ')}</span>
                  <span className="asp2-db-wtemp">{wDep?.icon ?? '🌡'} {wDep ? `${wDep.temp}°C` : '—'}</span>
                </div>
                <div className="asp2-db-wrow">
                  <span className="asp2-db-wcity">{shortCity(endLabel || 'Arrivée')}</span>
                  <span className="asp2-db-wtemp">{wArr?.icon ?? '🌡'} {wArr ? `${wArr.temp}°C` : '—'}</span>
                </div>
              </div>

            </div>
          </div>
        </div>
  )
}

/** Coque avec barre de navigation (compteur + précédent/suivant) autour de la page résumé —
 * utilisée pour l'ancien affichage plein écran (tracés sans page résumé dans leur composition). */
export function AlbumSpread({ track, voyageName, photos, index, total, onPrev, onNext, onBack, onPrint }: Props) {
  return (
    <div className="asp2-shell">
      <div className="asp2-nav">
        <button className="asp2-back-btn" onClick={onBack}>← Sélection</button>
        <span className="asp2-nav-counter">{index + 1} / {total}</span>
        {onPrint && <button className="asp2-pdf-btn" onClick={onPrint}>🖨 Exporter en PDF</button>}
        <div className="asp2-nav-arrows">
          <button className="asp2-nav-btn" onClick={onPrev} disabled={index === 0}>‹</button>
          <button className="asp2-nav-btn" onClick={onNext} disabled={index === total - 1}>›</button>
        </div>
      </div>
      <div className="asp2-outer">
        <AlbumSpreadContent track={track} voyageName={voyageName} photos={photos} pageNumber={index + 1} />
      </div>
    </div>
  )
}
