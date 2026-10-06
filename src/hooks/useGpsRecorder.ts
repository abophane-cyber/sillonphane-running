import { useCallback, useEffect, useRef, useState } from 'react'
import { GpsRecordingEngine } from '../lib/gpsRecording'
import { buildGpxXml } from '../lib/gpx'
import { createGeoBackend, drainNativeGeoBuffer, type GeoBackend } from '../lib/geoBackend'

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'

export interface RecorderStats {
  status: RecordingStatus
  distance: number          // mètres
  elevGain: number
  elevLoss: number
  movingDurationMs: number
  totalDurationMs: number   // hors pauses manuelles
  currentEle: number
  isIdle: boolean           // le moteur détecte un arrêt (marche stoppée), indépendant de la pause manuelle
  error: string | null
  acceptedFixCount: number      // diagnostic terrain : relevés GPS reçus et ingérés
  rejectedAccuracyCount: number // diagnostic terrain : relevés jetés faute de précision
  recoveredFromBuffer: number   // diagnostic terrain : points récupérés du tampon natif d'arrière-plan
  noAccuracyFixCount: number     // diagnostic terrain : relevés sans info de précision (gardés)
  rejectedTimeCount: number     // diagnostic terrain : relevés jetés (horodatage non croissant)
  jumpCount: number             // diagnostic terrain : relevés écartés (vitesse/distance aberrante)
  jumpMetersDropped: number     // diagnostic terrain : mètres de ces relevés écartés
  longGapCount: number          // diagnostic terrain : segments acceptés après une coupure de signal
  elevSource: 'baro' | 'gps'    // diagnostic terrain : source du dénivelé (baromètre ou altitude GPS)
}

const initialStats: RecorderStats = {
  status: 'idle', distance: 0, elevGain: 0, elevLoss: 0,
  movingDurationMs: 0, totalDurationMs: 0, currentEle: 0, isIdle: false, error: null,
  acceptedFixCount: 0, rejectedAccuracyCount: 0, recoveredFromBuffer: 0,
  noAccuracyFixCount: 0, rejectedTimeCount: 0, jumpCount: 0, jumpMetersDropped: 0, longGapCount: 0,
  elevSource: 'gps',
}

// Persistance d'un enregistrement en cours : l'Activity Android (et donc tout l'état React) est
// détruite quand on ferme complètement l'appli, même si le service GPS natif continue de tourner
// en arrière-plan. Sans ce checkpoint, rouvrir l'appli pendant un enregistrement retombait sur
// l'écran d'accueil sans aucune trace du parcours en cours.
const CHECKPOINT_KEY = 'sillon-active-recording'

interface RecordingCheckpoint {
  points: { lat: number; lon: number; ele: number; time: number }[]
  startedAt: number
  pausedAccum: number
  title: string
  status: 'recording' | 'paused'
}

// Espacement des écritures du checkpoint (en multiples du tick de 1s) : réécrire tout le tableau
// de points à chaque seconde devient coûteux et volumineux sur une sortie de plusieurs heures,
// avec un risque de dépasser le quota de localStorage (l'échec est alors silencieux).
const CHECKPOINT_EVERY_N_TICKS = 10

export function hasActiveRecording(): boolean {
  try { return localStorage.getItem(CHECKPOINT_KEY) !== null } catch { return false }
}

export function useGpsRecorder() {
  const engineRef = useRef(new GpsRecordingEngine())
  const backendRef = useRef<GeoBackend | null>(null)
  const tickRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const pausedAccumRef = useRef(0)
  const pauseStartRef = useRef<number | null>(null)
  const titleRef = useRef('')
  const tickCountRef = useRef(0)
  const recoveredRef = useRef(0)

  const [stats, setStats] = useState<RecorderStats>(initialStats)

  const saveCheckpoint = useCallback((status: 'recording' | 'paused') => {
    try {
      const checkpoint: RecordingCheckpoint = {
        points: engineRef.current.points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: (p.time ?? new Date()).getTime() })),
        startedAt: startedAtRef.current,
        pausedAccum: pausedAccumRef.current,
        title: titleRef.current,
        status,
      }
      localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint))
    } catch { /* stockage indisponible ou plein */ }
  }, [])

  // N'écrit le checkpoint qu'une fois toutes les CHECKPOINT_EVERY_N_TICKS secondes (voir plus haut).
  // L'intervalle tourne aussi pendant une pause (comportement existant, pour garder les stats à
  // jour) : le statut doit donc refléter l'état réel plutôt que d'être figé à 'recording'.
  const maybeSaveCheckpoint = useCallback(() => {
    tickCountRef.current += 1
    if (tickCountRef.current % CHECKPOINT_EVERY_N_TICKS === 0) {
      saveCheckpoint(pauseStartRef.current !== null ? 'paused' : 'recording')
    }
  }, [saveCheckpoint])

  const clearCheckpoint = useCallback(() => {
    try { localStorage.removeItem(CHECKPOINT_KEY) } catch { /* stockage indisponible */ }
  }, [])

  const refreshStats = useCallback((overrides?: Partial<RecorderStats>) => {
    const snap = engineRef.current.snapshot()
    const now = Date.now()
    const pausedMs = pausedAccumRef.current + (pauseStartRef.current ? now - pauseStartRef.current : 0)
    const totalDurationMs = startedAtRef.current ? Math.max(0, now - startedAtRef.current - pausedMs) : 0
    setStats(s => ({
      ...s,
      distance: snap.distance,
      elevGain: snap.elevGain,
      elevLoss: snap.elevLoss,
      movingDurationMs: snap.movingDurationMs,
      currentEle: snap.currentEle,
      isIdle: snap.idle,
      totalDurationMs,
      acceptedFixCount: snap.acceptedFixCount,
      rejectedAccuracyCount: snap.rejectedAccuracyCount,
      recoveredFromBuffer: recoveredRef.current,
      noAccuracyFixCount: snap.noAccuracyFixCount,
      rejectedTimeCount: snap.rejectedTimeCount,
      jumpCount: snap.jumpCount,
      jumpMetersDropped: snap.jumpMetersDropped,
      longGapCount: snap.longGapCount,
      elevSource: snap.elevSource,
      ...overrides,
    }))
  }, [])

  // Vide le tampon natif d'arrière-plan et réinjecte les relevés que le hook n'a jamais reçus en
  // direct (WebView suspendue pendant que l'écran était verrouillé / l'appli en arrière-plan).
  // Le filtre `time > lastFixTime` évite de recompter un relevé déjà ingéré via le callback live.
  const drainAndIngest = useCallback(async () => {
    const buffered = await drainNativeGeoBuffer()
    if (!buffered.length) return
    const cutoff = engineRef.current.lastFixTime
    let added = 0
    for (const f of buffered) {
      if (f.time > cutoff && engineRef.current.ingest(f)) added++
    }
    if (added) {
      recoveredRef.current += added
      refreshStats()
    }
  }, [refreshStats])

  const handleFix = useCallback((fix: { lat: number; lon: number; ele: number; time: number; accuracy?: number }) => {
    engineRef.current.ingest(fix)
    // Recevoir un relevé (même rejeté par le moteur pour précision insuffisante) prouve que le
    // GPS fonctionne à nouveau : on efface une éventuelle erreur précédente (ex. "GPS désactivé").
    refreshStats({ error: null })
  }, [refreshStats])

  const handleError = useCallback((message: string) => {
    setStats(s => ({ ...s, error: message }))
  }, [])

  const watch = useCallback(() => {
    backendRef.current = createGeoBackend()
    backendRef.current.watch(handleFix, handleError)
  }, [handleFix, handleError])

  const clearWatch = useCallback(() => {
    backendRef.current?.clear()
    backendRef.current = null
  }, [])

  const start = useCallback((title: string) => {
    engineRef.current = new GpsRecordingEngine()
    titleRef.current = title
    startedAtRef.current = Date.now()
    pausedAccumRef.current = 0
    pauseStartRef.current = null
    tickCountRef.current = 0
    recoveredRef.current = 0
    setStats({ ...initialStats, status: 'recording' })
    // Jette un éventuel tampon natif résiduel d'un enregistrement précédent, pour ne pas le
    // réinjecter dans ce nouveau tracé.
    void drainNativeGeoBuffer()
    watch()
    // Checkpoint immédiat : sans ça, fermer l'appli dans les toutes premières secondes (avant le
    // premier palier de maybeSaveCheckpoint, toutes les CHECKPOINT_EVERY_N_TICKS secondes) laissait
    // aucune trace du démarrage et renvoyait à l'accueil au lieu de reprendre l'enregistrement.
    saveCheckpoint('recording')
    tickRef.current = window.setInterval(() => {
      // Toutes les 5 s, rapatrie ce que le service natif a écrit sur disque pendant que la WebView
      // était gelée (écran verrouillé). Ne tourne de fait que quand l'appli est au premier plan.
      if (tickCountRef.current % 5 === 0) void drainAndIngest()
      refreshStats()
      maybeSaveCheckpoint()
    }, 1000)
  }, [watch, refreshStats, maybeSaveCheckpoint, saveCheckpoint, drainAndIngest])

  // Reprend un enregistrement dont le checkpoint a survécu à la fermeture de l'appli (voir
  // CHECKPOINT_KEY) : rejoue les points déjà captés dans un nouveau moteur, puis continue de
  // suivre le GPS (ou reste en pause si c'était son état au moment de la fermeture). Les points
  // captés nativement pendant que l'appli était fermée (l'Activity, et donc ce hook, n'existaient
  // plus pour les recevoir) restent perdus. Renvoie le titre du parcours repris (chaîne vide si
  // aucun checkpoint valide n'a été trouvé).
  const restoreAndResume = useCallback((): string => {
    const engine = new GpsRecordingEngine()
    let title = ''
    let wasPaused = false
    try {
      const raw = localStorage.getItem(CHECKPOINT_KEY)
      if (raw) {
        const checkpoint = JSON.parse(raw) as RecordingCheckpoint
        for (const p of checkpoint.points) engine.ingest({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time })
        startedAtRef.current = checkpoint.startedAt
        pausedAccumRef.current = checkpoint.pausedAccum
        title = checkpoint.title
        wasPaused = checkpoint.status === 'paused'
      }
    } catch { /* checkpoint corrompu ou stockage indisponible : on repart d'un enregistrement propre */ }
    if (!startedAtRef.current) startedAtRef.current = Date.now()
    pauseStartRef.current = wasPaused ? Date.now() : null
    tickCountRef.current = 0
    engineRef.current = engine
    titleRef.current = title
    recoveredRef.current = 0
    setStats({ ...initialStats, status: wasPaused ? 'paused' : 'recording' })

    // Rattrapage des points captés par le foreground service pendant que l'Activity était détruite
    // (appli en arrière-plan/verrouillée) : le checkpoint localStorage s'arrête ~10s avant la mort
    // de l'Activity, mais le service natif a continué d'écrire chaque position sur disque.
    // drainAndIngest filtre sur `lastFixTime` (dernier point rejoué) pour ne rien recompter.
    void drainAndIngest().then(() => saveCheckpoint(pauseStartRef.current !== null ? 'paused' : 'recording'))

    if (!wasPaused) watch()
    saveCheckpoint(wasPaused ? 'paused' : 'recording')
    tickRef.current = window.setInterval(() => {
      // Toutes les 5 s, rapatrie ce que le service natif a écrit sur disque pendant que la WebView
      // était gelée (écran verrouillé). Ne tourne de fait que quand l'appli est au premier plan.
      if (tickCountRef.current % 5 === 0) void drainAndIngest()
      refreshStats()
      maybeSaveCheckpoint()
    }, 1000)
    return title
  }, [watch, refreshStats, maybeSaveCheckpoint, saveCheckpoint, drainAndIngest])

  const pause = useCallback(() => {
    clearWatch()
    pauseStartRef.current = Date.now()
    setStats(s => ({ ...s, status: 'paused' }))
    saveCheckpoint('paused')
  }, [clearWatch, saveCheckpoint])

  const resume = useCallback(() => {
    if (pauseStartRef.current) {
      pausedAccumRef.current += Date.now() - pauseStartRef.current
      pauseStartRef.current = null
    }
    setStats(s => ({ ...s, status: 'recording' }))
    watch()
    saveCheckpoint('recording')
  }, [watch, saveCheckpoint])

  const stop = useCallback(async () => {
    clearWatch()
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    // Rapatrie une dernière fois ce que le service natif a écrit sur disque pendant que la WebView
    // était gelée (écran verrouillé toute la sortie) AVANT de finaliser : sans ça, tout un
    // enregistrement fait écran éteint ressortait vide (0 relevé reçu en direct).
    await drainAndIngest()
    engineRef.current.finalize()
    clearCheckpoint()
    void drainNativeGeoBuffer()
    refreshStats({ status: 'stopped' })
  }, [clearWatch, refreshStats, clearCheckpoint, drainAndIngest])

  const reset = useCallback(() => {
    clearWatch()
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    clearCheckpoint()
    void drainNativeGeoBuffer()
    engineRef.current = new GpsRecordingEngine()
    startedAtRef.current = 0
    pausedAccumRef.current = 0
    pauseStartRef.current = null
    setStats(initialStats)
  }, [clearWatch, clearCheckpoint])

  useEffect(() => () => {
    clearWatch()
    if (tickRef.current !== null) window.clearInterval(tickRef.current)
  }, [clearWatch])

  // Retour de l'appli au premier plan (déverrouillage écran, retour depuis une autre appli) :
  // la WebView reprend, on rapatrie aussitôt ce que le service natif a bufferisé pendant la
  // suspension pour que les stats affichées reflètent la marche réellement parcourue.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void drainAndIngest() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [drainAndIngest])

  const buildGpx = useCallback((name: string) => buildGpxXml(engineRef.current.points, name), [])
  const getPoints = useCallback(() => engineRef.current.points, [])
  // Heure de démarrage réelle (horloge de l'appareil), indépendante des timestamps GPS des points
  // (potentiellement absents/peu fiables sur certains appareils) — sert de repli garanti pour
  // pré-remplir la date/heure du parcours à l'arrêt de l'enregistrement.
  const getStartedAt = useCallback(() => startedAtRef.current, [])

  // Appui explicite sur le bouton de reprise pendant l'état "à l'arrêt" (isIdle) : le GPS tourne
  // déjà (contrairement à une pause manuelle), il suffit de forcer la sortie de l'arrêt sans
  // attendre les 10m de mouvement détecté.
  const clearIdle = useCallback(() => {
    engineRef.current.clearIdle()
    refreshStats()
  }, [refreshStats])

  return { stats, start, pause, resume, stop, reset, buildGpx, getPoints, restoreAndResume, clearIdle, getStartedAt }
}
