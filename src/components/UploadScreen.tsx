import { useEffect, useRef } from 'react'
import { GpxUploader } from './GpxUploader'
import { SavedTracksBoxes } from './SavedTracksBoxes'
import { CalendarIcon, ClockIcon, CheckIcon } from './icons'
import type { ParsedGpx } from '../types'

interface Props {
  gpx: ParsedGpx | null
  gpxTracksCount: number
  onLoad: (parsed: ParsedGpx, fileName?: string, raw?: string) => void
  onAlbum: () => void
  onVoyages: () => void
  customTitle: string
  onCustomTitleChange: (v: string) => void
  manualDate: string
  onManualDateChange: (v: string) => void
  departureTime: string
  onDepartureTimeChange: (v: string) => void
  arrivalTime: string
  onArrivalTimeChange: (v: string) => void
  normalizeTime: (v: string) => string
  triedContinue: boolean
  setTriedContinue: (v: boolean) => void
  onContinue: () => void
  onSaveToSillons: () => void
  /** Le tracé chargé vient d'un enregistrement direct (pas d'un import de fichier). */
  recordedLive: boolean
  /** Enregistrement direct terminé mais pas encore traité (ni animation lancée, ni rangé
   *  explicitement) : le panneau d'action s'affiche alors tout en haut, puis disparaît. */
  recordingPending: boolean
}

// Les archives météo (Meteostat / Open-Meteo ERA5-Land) ont quelques jours de
// retard : une rando trop récente n'a souvent pas encore de données disponibles.
const WEATHER_DATA_LAG_DAYS = 5

function isDateTooRecentForWeather(dateStr: string): boolean {
  const date = new Date(dateStr + 'T12:00:00')
  const ageDays = (Date.now() - date.getTime()) / 86_400_000
  return ageDays < WEATHER_DATA_LAG_DAYS
}

/** Date postérieure à aujourd'hui (course prévue). */
function isFutureDate(dateStr: string): boolean {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return dateStr > todayStr
}

export function UploadScreen({
  gpx, gpxTracksCount, onLoad, onAlbum, onVoyages,
  customTitle, onCustomTitleChange,
  manualDate, onManualDateChange,
  departureTime, onDepartureTimeChange,
  arrivalTime, onArrivalTimeChange,
  normalizeTime, triedContinue, setTriedContinue,
  onContinue, onSaveToSillons, recordedLive, recordingPending,
}: Props) {
  // Le panneau du tracé chargé (titre, date, « Créer l'animation ») est en tête de l'écran ; on y ramène l'écran dès
  // qu'un nouveau tracé est chargé (le sélecteur de fichier est plus bas), pas à l'arrivée avec un tracé déjà présent.
  const panelRef = useRef<HTMLDivElement>(null)
  const seenGpx = useRef(gpx)
  useEffect(() => {
    if (gpx && gpx !== seenGpx.current) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    seenGpx.current = gpx
  }, [gpx])

  // Panneau d'action sur le tracé chargé (titre, date, horaires, boutons Créer l'animation /
  // Enregistrer). Rendu à deux endroits possibles selon l'origine du tracé (voir plus bas).
  const trackPanel = gpx && (
    <div className="upload-gpx-panel" ref={panelRef}>
      {/* Rappel réseau après un enregistrement : la suite (noms de localités, cols, météo) a
          besoin d'une connexion, souvent coupée pendant la marche. */}
      {recordedLive && (
        <p className="upload-gpx-netreminder">
          📶 Pensez à réactiver le <strong>Wi-Fi</strong> ou les <strong>données mobiles</strong> :
          c'est nécessaire pour retrouver les noms de lieux (localités, cols) et la météo de votre
          parcours.
        </p>
      )}

      {/* Titre éditable */}
      <div className="upload-gpx-loaded">
        <CheckIcon size={18} className="upload-gpx-loaded__check" />{' '}
        <input
          className="upload-gpx-title-input"
          value={customTitle}
          onChange={e => onCustomTitleChange(e.target.value)}
          placeholder="Titre du parcours"
          maxLength={80}
        />
        {gpxTracksCount > 1 && <span className="upload-gpx-tracks"> ({gpxTracksCount} tracés)</span>}
      </div>

      {/* Date */}
      <div className="date-input-row">
        <label className="date-input-label"><CalendarIcon size={15} /> Date du parcours</label>
        <input
          type="date"
          className="date-input"
          value={manualDate}
          onChange={e => { onManualDateChange(e.target.value); setTriedContinue(false) }}
          onClick={e => (e.currentTarget as HTMLInputElement).showPicker?.()}
        />

        {/* Horaires (si date renseignée) */}
        {manualDate && (
          <div className="time-inputs-row">
            <div className="time-input-group">
              <label className="date-input-label"><ClockIcon size={15} /> Heure de départ</label>
              <input
                type="text"
                className="date-input time-input"
                value={departureTime}
                placeholder="06:00"
                maxLength={5}
                onChange={e => { onDepartureTimeChange(e.target.value); setTriedContinue(false) }}
                onBlur={e => onDepartureTimeChange(normalizeTime(e.target.value))}
              />
            </div>
            <div className="time-input-group">
              <label className="date-input-label"><ClockIcon size={15} /> Heure d'arrivée</label>
              <input
                type="text"
                className="date-input time-input"
                value={arrivalTime}
                placeholder="18:00"
                maxLength={5}
                onChange={e => { onArrivalTimeChange(e.target.value); setTriedContinue(false) }}
                onBlur={e => onArrivalTimeChange(normalizeTime(e.target.value))}
              />
            </div>
          </div>
        )}
      </div>

      {/* Avertissements — uniquement après tentative de continuer */}
      {triedContinue && (
        <div className="upload-info-warn">
          <span>ℹ️</span>
          <div>
            {!manualDate && <p>Sans date, la météo du parcours ne sera pas affichée.</p>}
            {manualDate && isFutureDate(manualDate) && <p>Course à venir : la météo ne sera pas affichée.</p>}
            {manualDate && !isFutureDate(manualDate) && isDateTooRecentForWeather(manualDate) && <p>Date trop récente : la météo n'est peut-être pas encore disponible pour ce jour.</p>}
            {manualDate && (!departureTime || !arrivalTime) && <p>Sans horaires, la météo sera moins précise (conditions par défaut à 06:00 - 18:00).</p>}
          </div>
        </div>
      )}

      <div className="upload-continue-row">
        <button
          className="btn-primary btn-large"
          onClick={onContinue}
        >
          {triedContinue ? 'Continuer quand même →' : 'Créer l’animation →'}
        </button>
        <button
          className="btn-secondary btn-large"
          onClick={onSaveToSillons}
        >
          Enregistrer dans Mes sillons
        </button>
      </div>
      <p className="upload-continue-hint">
        « Créer l’animation » ouvre l’éditeur de film. « Enregistrer dans Mes sillons »
        range simplement le tracé pour le retrouver plus tard.
      </p>
    </div>
  )

  // Tracé chargé → le panneau d'action est tout en haut de l'écran, pour ne pas avoir à le chercher sous le héros et les
  // encarts (sur un téléphone il était hors de vue). Après un enregistrement direct, il disparaît une fois l'animation
  // lancée ou le tracé rangé (recordingPending repasse à false côté App) ; un tracé importé le garde.
  const pinnedTop = recordedLive ? recordingPending : true

  return (
    <div className="upload-screen">
      {pinnedTop && trackPanel}

      <div className="upload-screen__hero">
        <span className="upload-screen__eyebrow">Espace création</span>
        <h1>Ouvrez votre prochaine aventure</h1>
        <p>Pas de compte à créer — tout reste sur votre appareil.</p>
      </div>

      <div className="upload-screen__boxes">
        <GpxUploader onLoad={onLoad} />
        <SavedTracksBoxes onAlbum={onAlbum} onVoyages={onVoyages} />
      </div>

    </div>
  )
}
