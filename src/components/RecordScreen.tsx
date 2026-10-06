import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { useHeaderBack } from '../hooks/useHeaderBack'
import { useGpsRecorder, hasActiveRecording } from '../hooks/useGpsRecorder'
import { openAppSettings, requestBackgroundLocationPermission } from '../lib/geoBackend'
import { parseGpx, formatDistance, formatElevation, formatDuration, formatSpeed } from '../lib/gpx'
import type { ParsedGpx } from '../types'

const BATTERY_POLL_MS = 60_000

interface Props {
  onFinish: (parsed: ParsedGpx, gpxData: string, startedAt: number, endedAt: number) => void
  onCancel: () => void
}

function defaultTitle() {
  const now = new Date()
  const d = now.toLocaleDateString('fr-FR')
  return `Parcours du ${d}`
}

export function RecordScreen({ onFinish, onCancel }: Props) {
  useHeaderBack('Retour', onCancel)
  const { stats, start, pause, resume, stop, buildGpx, restoreAndResume, clearIdle, getStartedAt } = useGpsRecorder()
  const [title, setTitle] = useState(defaultTitle())
  const [finishing, setFinishing] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const [showWifiTip, setShowWifiTip] = useState(false)
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null)
  // Permission de localisation en arrière-plan (« Autoriser tout le temps »). null = pas encore
  // vérifié. Sans elle, Android 10+ étrangle le GPS en arrière-plan → tracé réduit à quelques
  // points. On la demande dès l'écran de démarrage, et on re-vérifie au retour de l'appli au
  // premier plan (l'utilisateur revient des réglages Android).
  const [bgLocGranted, setBgLocGranted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    const check = () => { void requestBackgroundLocationPermission().then(ok => { if (!cancelled) setBgLocGranted(ok) }) }
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    if (!showWifiTip) return
    const t = setTimeout(() => setShowWifiTip(false), 6000)
    return () => clearTimeout(t)
  }, [showWifiTip])

  // Surveille la batterie pendant l'enregistrement — pas besoin de rafraîchir souvent, le niveau
  // évolue lentement.
  useEffect(() => {
    if (stats.status !== 'recording' && stats.status !== 'paused') return
    let cancelled = false
    const poll = () => {
      Device.getBatteryInfo()
        .then(info => {
          if (!cancelled && info.batteryLevel != null) {
            setBattery({ level: info.batteryLevel, charging: !!info.isCharging })
          }
        })
        .catch(() => { /* indisponible sur cette plateforme */ })
    }
    poll()
    const id = window.setInterval(poll, BATTERY_POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [stats.status])

  // Un enregistrement était en cours quand l'appli a été fermée (checkpoint survivant, voir
  // useGpsRecorder) : on reprend directement plutôt que de reproposer l'écran de démarrage.
  useEffect(() => {
    if (hasActiveRecording()) setTitle(restoreAndResume() || defaultTitle())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const avgSpeedMoving = stats.movingDurationMs > 0 ? stats.distance / (stats.movingDurationMs / 1000) : 0
  const avgSpeedTotal = stats.totalDurationMs > 0 ? stats.distance / (stats.totalDurationMs / 1000) : 0

  async function handleStop() {
    setFinishing(true)
    setStopError(null)
    const startedAt = getStartedAt()
    // stop() rapatrie d'abord les relevés bufferisés nativement pendant que l'écran était
    // verrouillé (WebView gelée) — on attend qu'il ait fini avant de construire le GPX.
    await stop()
    const gpxData = buildGpx(title.trim() || defaultTitle())
    try {
      const parsed = parseGpx(gpxData)
      // Aucun tracé exploitable : le GPS n'a pas fourni au moins 2 points (permission refusée,
      // signal absent en intérieur, plugin GPS défaillant sur l'appareil…). Sans ce garde-fou,
      // on continuait vers l'écran suivant avec un tracé vide → écran vert figé au « Continuer ».
      if (parsed.tracks.length === 0) {
        setStopError("Aucun point GPS n'a été enregistré. Vérifiez que la localisation est autorisée et réessayez en extérieur.")
        setFinishing(false)
        return
      }
      onFinish(parsed, gpxData, startedAt, Date.now())
    } catch (e) {
      console.error('[record] finalisation GPX', e)
      setStopError("La finalisation du tracé a échoué. Réessayez.")
      setFinishing(false)
    }
  }

  if (stats.status === 'idle') {
    return (
      <div className="record-screen record-screen--start">
        <div className="record-screen__hero">
          <div className="record-screen__icon">🔴</div>
          <h1>Enregistrer un tracé</h1>
          <p>Sillonphane va suivre votre position GPS pendant la sortie et créer un fichier GPX à la fin.</p>
        </div>

        <input
          className="record-screen__title-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Titre du parcours"
          maxLength={80}
        />

        <p className="record-screen__battery-tip">
          🔋 Pour économiser de la batterie, vous pouvez couper le{' '}
          <svg className="record-screen__wifi-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 8.5C7.5 3.5 16.5 3.5 22 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M5.5 12.5C9.5 9 14.5 9 18.5 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M9 16.5C10.8 15 13.2 15 15 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="19.5" r="1.3" fill="currentColor" />
          </svg>{' '}
          Wi-Fi et les{' '}
          <svg className="record-screen__wifi-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M8 5V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.5 15.5L8 19L11.5 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.5 8.5L16 5L19.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>{' '}
          données mobiles : le suivi utilise le GPS brut, qui fonctionne sans réseau. Les garder
          activés les toutes premières minutes aide seulement le GPS à se caler un peu plus vite.
        </p>

        {Capacitor.isNativePlatform() && (
          <div className="record-screen__battery-warning">
            <p>⚠️ Deux réglages Android à vérifier, sans quoi le tracé enregistré en arrière-plan
              sera incomplet :</p>
            <ol className="record-screen__perm-list">
              <li>
                <strong>Position</strong> réglée sur <strong>« Autoriser tout le temps »</strong>
                {bgLocGranted === true && ' ✓'}
                {bgLocGranted === false && ' — actuellement limitée à « pendant l’utilisation »'}
              </li>
              <li>
                <strong>Batterie</strong> de l’appli réglée sur <strong>« Sans restriction »</strong>{' '}
                (ou « Non restreinte »)
              </li>
            </ol>
            <button
              type="button"
              className="record-screen__battery-settings-btn"
              onClick={() => openAppSettings().catch(() => {})}
            >
              Ouvrir les paramètres
            </button>
          </div>
        )}

        {stats.error && (
          <div className="app-toast app-toast--error">
            <span>⚠️ {stats.error}</span>
          </div>
        )}

        <button
          className="btn-primary btn-large record-screen__start-btn"
          onClick={() => {
            start(title.trim() || defaultTitle())
            setShowWifiTip(true)
            // La permission d'arrière-plan ne peut être demandée qu'une fois la localisation de
            // base accordée (règle Android) — ce qui se produit dans start() → addWatcher. On la
            // réclame donc juste après ; le retour met à jour l'encart au prochain visibilitychange.
            void requestBackgroundLocationPermission().then(setBgLocGranted)
          }}
        >
          Démarrer l'enregistrement
        </button>
      </div>
    )
  }

  return (
    <div className="record-screen record-screen--live">
      {showWifiTip && (
        <div className="app-toast" onClick={() => setShowWifiTip(false)}>
          <span>📶 Vous pouvez couper le Wi-Fi et les données mobiles</span>
          <button className="app-toast__close" onClick={e => { e.stopPropagation(); setShowWifiTip(false) }} aria-label="Fermer">✕</button>
        </div>
      )}
      {stats.error && (
        <div className="app-toast app-toast--error">
          <span>⚠️ {stats.error}</span>
        </div>
      )}
      {stopError && (
        <div className="app-toast app-toast--error" onClick={() => setStopError(null)}>
          <span>⚠️ {stopError}</span>
          <button className="app-toast__close" onClick={e => { e.stopPropagation(); setStopError(null) }} aria-label="Fermer">✕</button>
        </div>
      )}

      <div className="record-screen__status">
        {stats.status === 'recording' && <span className="record-screen__dot" />}
        <span>
          {stats.status === 'recording' && 'Enregistrement en cours'}
          {stats.status === 'paused' && 'En pause'}
          {stats.status === 'stopped' && 'Terminé'}
        </span>
      </div>

      {/* Diagnostic terrain (léger) : d'où viennent — ou ne viennent pas — les points GPS.
          « reçus » = relevés arrivés en direct ; « arrière-plan » = récupérés du tampon natif
          après un passage écran verrouillé ; « imprécis » = jetés faute de précision. */}
      <p className="record-screen__diag" style={{ fontSize: '.75rem', opacity: .6, textAlign: 'center', margin: '2px 0 0' }}>
        GPS : {stats.acceptedFixCount} reçus · {stats.recoveredFromBuffer} arrière-plan · {stats.rejectedAccuracyCount} imprécis
      </p>
      {/* 2e ligne : où partent les relevés perdus. « écartés » = relevés jetés pour vitesse/
          distance aberrante et les mètres ainsi non tracés ; « sans précision » = relevés arrivés
          sans info de précision (gardés, mais soumis au filtre) ; « doublons » = relevés déjà
          ingérés, re-présentés au retour de l'appli (tampon natif vidé, puis Capacitor rejoue les
          mêmes callbacks en file d'attente) et rejetés à raison ; « coupures » = segments longs
          acceptés après une perte de signal. */}
      <p className="record-screen__diag" style={{ fontSize: '.7rem', opacity: .5, textAlign: 'center', margin: '1px 0 0' }}>
        {stats.jumpCount} écartés (−{Math.round(stats.jumpMetersDropped)} m) · {stats.noAccuracyFixCount} sans précision · {stats.rejectedTimeCount} doublons · {stats.longGapCount} coupures · dénivelé {stats.elevSource === 'baro' ? 'baromètre' : 'GPS'}
      </p>

      <div className="record-screen__stats">
        <div className="record-screen__stat record-screen__stat--main">
          <span className="record-screen__stat-value">{formatDistance(stats.distance)}</span>
          <span className="record-screen__stat-label">Distance</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">{formatDuration(stats.movingDurationMs / 1000)}</span>
          <span className="record-screen__stat-label">En déplacement</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">{formatDuration(stats.totalDurationMs / 1000)}</span>
          <span className="record-screen__stat-label">Durée totale</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">{formatSpeed(avgSpeedMoving)}</span>
          <span className="record-screen__stat-label">Vitesse moy. en déplacement</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">{formatSpeed(avgSpeedTotal)}</span>
          <span className="record-screen__stat-label">Vitesse moy. générale</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">{formatElevation(stats.currentEle)}</span>
          <span className="record-screen__stat-label">Altitude</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">+{formatElevation(stats.elevGain)}</span>
          <span className="record-screen__stat-label">Dénivelé positif</span>
        </div>
        <div className="record-screen__stat">
          <span className="record-screen__stat-value">-{formatElevation(stats.elevLoss)}</span>
          <span className="record-screen__stat-label">Dénivelé négatif</span>
        </div>
        {battery && (
          <div className="record-screen__stat">
            <span className="record-screen__stat-value">
              {battery.charging ? '⚡' : '🔋'} {Math.round(battery.level * 100)}%
            </span>
            <span className="record-screen__stat-label">Batterie</span>
          </div>
        )}
      </div>

      <div className="record-screen__controls">
        {stats.status === 'recording' && (
          <button className="btn-secondary record-screen__pause-btn" onClick={pause}>⏸ Pause</button>
        )}
        {stats.status === 'paused' && (
          <button className="btn-primary record-screen__pause-btn" onClick={resume}>▶ Reprendre</button>
        )}
        <button
          className={`record-screen__stop-btn${stats.status === 'recording' && stats.isIdle ? ' record-screen__stop-btn--idle' : ''}`}
          onClick={stats.status === 'recording' && stats.isIdle ? clearIdle : handleStop}
          disabled={finishing}
        >
          {finishing
            ? 'Finalisation…'
            : stats.status === 'recording' && stats.isIdle
              ? 'Reprise si déplacement (10m min.) ou appui'
              : '⏹ Arrêter et enregistrer'}
        </button>
      </div>
    </div>
  )
}
