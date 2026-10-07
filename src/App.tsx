import { useEffect, useMemo, useRef, useState } from 'react'
import SplashScreen from './components/SplashScreen'
import { HowItWorks } from './components/HowItWorks'
import { ChoiceScreen } from './components/ChoiceScreen'
import { RecordScreen } from './components/RecordScreen'
import { AppLogoIcon } from './components/AppLogoIcon'
import { UploadScreen } from './components/UploadScreen'
import { AnimateScreen } from './components/AnimateScreen'
import { useLocality, useColMarkers, endpointCol, prefetchToponyms, type LocalityInfo } from './hooks/useLocality'
import { TitleScreen } from './components/TitleScreen'
import { useAnimation, BASE_SPEED } from './hooks/useAnimation'
import { getTrackPacing } from './lib/trackPacing'
import { HIKER3D_ENABLED } from './lib/hiker3dStaging'
import { parseGpx } from './lib/gpx'
import { openDemoTrip } from './lib/demoTrip'
import { fetchStartLandmark } from './lib/startLandmark'
import type { ParsedGpx, PanelLocality, GpxTrack } from './types'
import { PWAPrompt } from './components/PWAPrompt'
import { UpdatePrompt } from './components/UpdatePrompt'
import { VoyagesPage } from './components/VoyagesPage'
import { AlbumPage } from './components/AlbumPage'
import { getDefaultSillon, getBackupStatus, saveTrackPanelSettings, addTrackToVoyage } from './lib/voyageDB'
import { drawElevOverlay } from './lib/drawElevOverlay'
import { SaveToSillonModal } from './components/SaveToSillonModal'
import { FilmProgressDock, type FilmKind } from './components/FilmProgressDock'
import { HeaderBackContext, type HeaderBackState } from './hooks/useHeaderBack'
import { useMapTriggers } from './hooks/useMapTriggers'
import { useVoyageSaveModal } from './hooks/useVoyageSaveModal'
import { useUploadForm, normalizeTime } from './hooks/useUploadForm'
import { useTrackNaming, type EndpointKind } from './hooks/useTrackNaming'
import { useWeather } from './hooks/useWeather'
import {
  computeBornes, computeRavitos, parseRavitoKms, hasRealTimes, formatBannerDate, formatBannerDistance, formatElapsed, raceDurationS, DEFAULT_RACE_SETTINGS,
  type BannerText, type EndCard, type RaceSettings,
} from './lib/raceSplits'
import { useAnimationSettings, ZOOMS, animSpeed } from './hooks/useAnimationSettings'
import { useGpxSession } from './hooks/useGpxSession'
import { hasActiveRecording } from './hooks/useGpsRecorder'
import { useLocalityPanels, type PendingPanelRestore } from './hooks/useLocalityPanels'
import { usePlaybackCountdown } from './hooks/usePlaybackCountdown'
import { useFilmRecording } from './hooks/useFilmRecording'
import { useFilm3dExport } from './hooks/useFilm3dExport'
import { useFilm3dPrefetch } from './hooks/useFilm3dPrefetch'
import { useBackupReminder } from './hooks/useBackupReminder'
import { canRecordGps } from './lib/device'
import { DEFAULT_CHARACTERS, toggleCharacter, type CharacterId } from './lib/characters'
import { HomeIcon } from './components/icons'
import { diag } from './lib/diag'
import './App.css'

type AppView = 'home' | 'how' | 'choice' | 'record' | 'upload' | 'title' | 'animate' | 'voyages' | 'album'

export default function App() {
  useBackupReminder()
  const { gpx, setGpx, activeTrack, setActiveTrack, rawGpx, points, distances, loadTrack, clear: clearGpxSession } = useGpxSession()
  // Un enregistrement était en cours à la fermeture de l'appli (checkpoint survivant, voir
  // useGpsRecorder) : on rouvre directement l'écran d'enregistrement plutôt que l'accueil.
  // ?start : lien "Ouvrir l'appli" depuis la landing (déjà convaincue/expliquée) — entre
  // directement dans l'outil (import/album/sillons). Sans ?start (ex. appli installée lancée
  // sur /app.html, vieux favori…), on renvoie vers la landing : l'entrée dans l'outil se fait
  // toujours par le bouton "Ouvrir l'appli" de la landing.
  const cameFromLandingRef = useRef(new URLSearchParams(window.location.search).has('start'))
  // ?demo : bouton « Essayer avec une rando d'exemple » de la landing — on ouvre directement la
  // rando d'exemple (trace + photos rangées dans un sillon dédié, voir demoTrip.ts).
  const demoRequestedRef = useRef(new URLSearchParams(window.location.search).has('demo'))
  const [view, setView] = useState<AppView>(() => {
    if (hasActiveRecording()) return 'record'
    if (cameFromLandingRef.current) {
      if (demoRequestedRef.current) return 'upload'
      return canRecordGps() ? 'choice' : 'upload'
    }
    return 'home'
  })
  // Appli ouverte sur /app.html sans ?start (vieux favori, ancien start_url de PWA…) : on
  // renvoie vers la landing, l'entrée dans l'outil se faisant par son bouton "Ouvrir l'appli".
  // On ne redirige pas si le chemin est déjà "/" (build Android : app.html copié en index.html
  // servi à la racine) — dans ce cas c'est le SplashScreen qui prend le relais.
  useEffect(() => {
    // En dev, /app.html?splash affiche le SplashScreen de l'APK pour le prévisualiser.
    const previewSplash = import.meta.env.DEV && new URLSearchParams(window.location.search).has('splash')
    if (view === 'home' && window.location.pathname !== '/' && !previewSplash) window.location.replace('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [headerBack, setHeaderBack] = useState<HeaderBackState | null>(null)
  // Le tracé actif vient d'un enregistrement GPS en direct (vs import .gpx / réouverture d'un
  // tracé importé) — propagé à SaveToSillonModal pour marquer source:'recorded'.
  const [recordedLive, setRecordedLive] = useState(false)
  const [characters, setCharacters] = useState<CharacterId[]>(DEFAULT_CHARACTERS)
  // « Ruban seul » : aucun personnage (aperçu et film), exclusif avec le choix des personnages.
  const [ribbonOnly, setRibbonOnly] = useState(false)
  const {
    manualDate, setManualDate, departureTime, setDepartureTime,
    arrivalTime, setArrivalTime, triedContinue, setTriedContinue, handleUploadContinue,
  } = useUploadForm()
  const colMarkers = useColMarkers(points, distances)
  // Tracé qui part / finit sur un col nommé : le panneau de départ / d'arrivée devient celui du col.
  const startCol = endpointCol(colMarkers, points[0])
  const endCol   = endpointCol(colMarkers, points[points.length - 1])
  const { customTitle, setCustomTitle, startName, setStartName, endName, setEndName, restoreNames, startLieudit: startLieuditGeo, endLieudit: endLieuditGeo, startKind, endKind, setStartKind, setEndKind } = useTrackNaming(activeTrack, startCol?.name, endCol?.name)
  const weather = useWeather(activeTrack, manualDate, departureTime, arrivalTime)
  // Bornes tous les 5 km et temps de passage : réels (GPX enregistré) ou prévus (heure de départ + vitesses).
  const [race, setRace] = useState<RaceSettings>(DEFAULT_RACE_SETTINGS)
  const realTimes = useMemo(() => hasRealTimes(points, distances), [points, distances])
  const bornes = useMemo(() => race.bornesOff ? [] : computeBornes(points, distances, {
    useRealTimes: realTimes && !race.plannedTimes,
    startTime: departureTime, date: manualDate, speedsKmh: race.speeds,
  }), [points, distances, race, realTimes, departureTime, manualDate])
  const ravitos = useMemo(() => computeRavitos(points, distances, parseRavitoKms(race.ravitos)), [points, distances, race.ravitos])
  // Inscription de l'épreuve : nom, date, distance — saisis dans le widget des panneaux,
  // sinon titre du parcours, date de la sortie, distance du tracé.
  const bannerDefaults = useMemo<BannerText>(() => ({
    title: customTitle || activeTrack?.name || '',
    date: formatBannerDate(manualDate),
    distance: activeTrack ? formatBannerDistance(activeTrack.distance) : undefined,
  }), [customTitle, activeTrack, manualDate])
  // Carton de fin du film : intitulé, date, distance, dénivelé, temps mis (réel ou prévu) et moyenne.
  const endCard = useMemo<EndCard | undefined>(() => {
    if (!activeTrack) return undefined
    const dur = raceDurationS(points, activeTrack.distance, { useRealTimes: realTimes && !race.plannedTimes, speedsKmh: race.speeds })
    return {
      title: bannerDefaults.title, // titre du film (= nom de l'épreuve, saisi dans le widget)
      date: race.bannerDate?.trim() || bannerDefaults.date,
      distance: (race.bannerDistance?.trim() || bannerDefaults.distance)?.replace(/ ?KM$/i, ' km'),
      elevGain: activeTrack.elevGain > 0 ? `+${Math.round(activeTrack.elevGain)} m` : undefined,
      time: dur ? formatElapsed(dur.s) : undefined,
      timeLabel: dur ? (dur.planned ? 'TEMPS PRÉVU' : 'TEMPS') : undefined,
      avgSpeed: dur && dur.s > 0 ? `${(activeTrack.distance / 1000 / (dur.s / 3600)).toFixed(1).replace('.', ',')} km/h` : undefined,
    }
  }, [activeTrack, points, realTimes, race, bannerDefaults])
  const { fitBoundsCount, seekCount, zoomToStartCount, bumpFitBounds, bumpSeek, bumpZoomToStart } = useMapTriggers()
  const [hasPlayedPreview, setHasPlayedPreview] = useState(false)
  const [previewFinished, setPreviewFinished] = useState(false)
  // Tracé rouvert depuis Mes sillons avec un film déjà créé (voir handleGpxLoad / restore.hasFilm).
  const [trackHasSavedFilm, setTrackHasSavedFilm] = useState(false)
  const [albumInitialTrack, setAlbumInitialTrack] = useState<{ voyageId: string; trackId: string } | null>(null)
  const [activeSillonTrackId, setActiveSillonTrackId] = useState<string | null>(null)
  // Cible à ouvrir dans « Mes sillons » après un « Voir le film » (déplie + fait défiler jusqu'aux films du tracé).
  const [filmFocus, setFilmFocus] = useState<{ sillonId: string; trackId: string } | null>(null)
  const pendingPanelRestoreRef = useRef<PendingPanelRestore | null>(null)
  const [dismissedHints, setDismissedHints] = useState<Set<string>>(new Set())
  const dismissHint = (id: string) => setDismissedHints(prev => new Set(prev).add(id))
  // Calque de guidage de l'écran d'animation. Activé par défaut ; le bouton
  // « Revoir le guide » du header le réaffiche depuis la 1re bulle (nonce ++).
  const GUIDE_KEY = 'sillon.animGuide'
  const [guideOn, setGuideOn] = useState<boolean>(() => {
    try { return localStorage.getItem(GUIDE_KEY) !== 'off' } catch { return true }
  })
  const [guideReplayNonce, setGuideReplayNonce] = useState(0)
  const setGuide = (on: boolean) => {
    setGuideOn(on)
    try { localStorage.setItem(GUIDE_KEY, on ? 'on' : 'off') } catch { /* stockage indispo */ }
  }
  const replayGuide = () => { setGuide(true); setGuideReplayNonce(n => n + 1) }
  // Enregistrement direct terminé, en attente d'un choix de l'utilisateur (créer l'animation
  // ou ranger le tracé) : tant que c'est le cas, l'écran d'import épingle le panneau d'action
  // tout en haut. Repasse à false dès qu'un des deux boutons est actionné.
  const [recordingPending, setRecordingPending] = useState(false)
  const {
    filmProgress, filmEtaS, recState, cancelRec, mapCanvasRef,
    updateDrawFrame, handleCreateFilm: filmRecordingCreateFilm,
    lastFilmUrl, setLastFilmUrl,
  } = useFilmRecording()
  const {
    film3dProgress, film3dPhase, film3dEtaS, lastFilm3dUrl, setLastFilm3dUrl,
    handleCreateFilm3d: film3dCreate,
  } = useFilm3dExport()

  // Création de film en cours : le rendu tourne ici (niveau appli) et se poursuit quand on quitte
  // l'écran d'animation ; FilmProgressDock en affiche alors la progression par-dessus les autres pages.
  const runningFilm: { kind: FilmKind; progress: number; phase: 'prepare' | 'render' | null; etaS: number | null } | null =
    filmProgress !== null ? { kind: '2d', progress: filmProgress, phase: null, etaS: filmEtaS }
    : film3dProgress !== null ? { kind: '3d', progress: film3dProgress, phase: film3dPhase, etaS: film3dEtaS }
    : null
  // Film terminé pendant qu'on était sur une autre page : signalé par le même indicateur.
  const [filmDone, setFilmDone] = useState<{ kind: FilmKind; saved: boolean } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const notifyFilmDone = (kind: FilmKind, url: string | null) => {
    if (url && viewRef.current !== 'animate') setFilmDone({ kind, saved: activeSillonId !== null })
  }
  useEffect(() => notifyFilmDone('2d', lastFilmUrl), [lastFilmUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => notifyFilmDone('3d', lastFilm3dUrl), [lastFilm3dUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'animate') setFilmDone(null) }, [view])
  useEffect(() => { diag('vue', { view, tracé: activeTrack?.name ?? null, points: points.length }) }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tracé < 20km en V2 : plafonner le DF à 40% pour ne pas sauter les localités en début de tracé
  const trackDist = activeTrack?.distance ?? Infinity

  // Durée (ms) de la séquence d'arrivée des randonneurs 3D (zoom, salut, vue d'ensemble — cf. TrackMap), avant
  // d'ouvrir la popup « Enregistrer le tracé ».
  const endDelayMsRef = useRef(0)
  // Pause (ms) entre la fin du décompte et le début de la marche : dézoom du randonneur 3D (cf. TrackMap) ; 0 sinon.
  const startDelayMsRef = useRef(0)
  // Randonneurs 3D : ralenti dans les virages, pour qu'ils suivent les lacets en pivotant en douceur (trackPacing.ts).
  const pacing = useMemo(() => (HIKER3D_ENABLED && points.length >= 2 ? getTrackPacing(points, distances) : null), [points, distances])
  const speedFactorRef = useRef<((progress: number, speed: number) => number) | null>(null)
  useEffect(() => {
    speedFactorRef.current = pacing && activeTrack
      ? (p, speed) => { pacing.setNominalSpeed(BASE_SPEED * speed * activeTrack.distance); return pacing.factorAt(p * activeTrack.distance) }
      : null
  }, [pacing, activeTrack])
  const { state, play, pause, reset, setSpeed, seek } = useAnimation({
    points,
    totalDistance: activeTrack?.distance ?? 0,
    totalElevGain: activeTrack?.elevGain ?? 0,
    speedFactorRef,
  })

  const {
    activityMode, speedLevel, lookahead, setLookahead,
    targetZoom, setTargetZoom, zoomResetSeq, setZoomResetSeq,
    handleModeChange,
  } = useAnimationSettings(activeTrack, setSpeed)

  // Bouton retour du header : cas gérés directement par App (les autres vues s'enregistrent via useHeaderBack).
  // "Retour" ramène toujours à l'écran d'accueil de l'outil (upload : import / album / mes sillons),
  // sans réinitialiser le tracé chargé (l'écran upload propose alors de reprendre l'animation).
  useEffect(() => {
    if (view === 'title' || view === 'animate') {
      setHeaderBack({ label: 'Retour', onClick: () => setView('upload') })
      return () => setHeaderBack(null)
    }
  }, [view])

  // Filet de sécurité : les vues 'title' et 'animate' n'affichent rien sans tracé actif
  // (→ écran vert figé). Si on y arrive sans tracé, on renvoie vers l'écran d'import.
  useEffect(() => {
    if ((view === 'title' || view === 'animate') && !activeTrack) setView('upload')
  }, [view, activeTrack])

  // Prefetch Overpass dès le chargement du tracé pour que le cache soit prêt
  useEffect(() => {
    if (points.length >= 2) prefetchToponyms(points)
  }, [activeTrack]) // eslint-disable-line react-hooks/exhaustive-deps

  // Préchauffe le cache terrain du film 3D (1 000 à 2 300 requêtes IGN) seulement quand l'intention
  // « Film 3D » est claire : clic sur « Film 3D » encore bloqué (aperçu à terminer, tracé à
  // enregistrer) -> le terrain se télécharge pendant ce temps mort. Mémorisé par tracé (comparaison
  // d'objet) : changer de tracé annule l'intention sans effet de remise à zéro.
  const [film3dIntentTrack, setFilm3dIntentTrack] = useState<GpxTrack | null>(null)
  useFilm3dPrefetch(activeTrack, points, view === 'animate' && film3dIntentTrack !== null && film3dIntentTrack === activeTrack)
  const panels = useLocalityPanels(activeTrack, points, distances, activityMode, lookahead, view === 'animate', state.currentPoint, pendingPanelRestoreRef)
  const {
    previewLocalities, customLocalities, setCustomLocalities,
    suppressedLocalities, suppressedLocalitiesRef,
    wizardDone,
  } = panels
  // Localités décochées d'office : le départ et l'arrivée (dont les noms sont connus après géocodage) restent cochés.
  useEffect(() => { panels.releaseAutoSuppressed([startName, endName]) }, [startName, endName, previewLocalities]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveStartName = startName && !suppressedLocalities.has(startName) ? startName : undefined
  // Circuit en boucle (même nom au départ et à l'arrivée) : un seul panneau, celui du départ.
  const isLoopNames = !!startName && !!endName && startName.trim().toLowerCase() === endName.trim().toLowerCase()
  const effectiveEndName   = endName   && !isLoopNames && !suppressedLocalities.has(endName) ? endName : undefined
  // Altitude du col quand le panneau de départ / d'arrivée porte son nom -> style col (nom + altitude).
  const startColEle = effectiveStartName && startCol?.name === effectiveStartName ? startCol.ele : undefined
  const endColEle   = effectiveEndName   && endCol?.name   === effectiveEndName   ? endCol.ele   : undefined
  // Départ / arrivée sur un hameau ou lieu-dit (type OSM du géocodage) -> panneau lieu-dit.
  const startLieudit = !!effectiveStartName && startColEle == null && startLieuditGeo
  const endLieudit   = !!effectiveEndName   && endColEle   == null && endLieuditGeo

  // previewFinished dès la fin naturelle de l'aperçu (même déclencheur que l'ouverture de la
  // popup "Enregistrer") : ne dépend pas de la validation de cette popup, sinon la fermer sans
  // enregistrer (ex. tracé déjà sauvegardé) prive la bulle "vous pouvez créer votre film".
  const { showSaveModal, setShowSaveModal, activeSillonId, setActiveSillonId } = useVoyageSaveModal(
    state, activeTrack, () => { bumpFitBounds(); setPreviewFinished(true) }, endDelayMsRef,
  )
  // La popup "Enregistrer dans un sillon" peut être ouverte depuis l'écran d'import (bouton
  // "Enregistrer dans Mes sillons", sans passer par l'animation) : dans ce cas, après l'enregistrement
  // on bascule directement vers "Mes sillons" plutôt que de rester sur l'écran d'import.
  const [saveModalFromUpload, setSaveModalFromUpload] = useState(false)

  const { current: locality } = useLocality(
    state.currentPoint,
    points,
    distances,
    state.progress,
    activityMode,
    lookahead,
    effectiveStartName,
    effectiveEndName,
  )

  // Cols repérés : décochés d'office sur un tracé neuf, au fur et à mesure que leur nom est résolu.
  useEffect(() => {
    panels.deselectColsByDefault(colMarkers.filter(c => c.name !== 'Col').map(c => c.name))
  }, [colMarkers]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cols détectés automatiquement (affichés en permanence sur la carte via `colMarkers`) :
  // convertis en localités `type: 'col'` pour que les films 2D et 3D les affichent aussi — sans
  // ça, seuls les cols ajoutés à la main (customLocalities) apparaissaient dans les films.
  // On écarte le placeholder « Col » (géocodage inverse pas encore résolu) et les cols masqués.
  const colLocalities: LocalityInfo[] = colMarkers
    .filter(c => c.name !== 'Col' && !suppressedLocalities.has(c.name)
      && c.name !== effectiveStartName && c.name !== effectiveEndName)
    .map(c => ({ type: 'col', name: c.name, ele: c.ele, lon: c.lon, lat: c.lat }))

  function handleGpxLoad(parsed: ParsedGpx, _fileName?: string, raw?: string, restore?: {
    voyageId: string
    trackId: string
    startName?: string
    endName?: string
    startKind?: EndpointKind
    endKind?: EndpointKind
    suppressed?: string[]
    customLocalities?: PanelLocality[]
    wizardDone?: boolean
    race?: RaceSettings
    // Le tracé a déjà une composition (film, pages d'album, ou assistant panneaux validé) : on
    // reprend la progression (aperçu considéré comme fait). Sinon — tracé brut, dont un
    // enregistrement direct tout juste rangé dans Mes sillons — on repart de zéro.
    hasComposition?: boolean
    // Un film de ce tracé est déjà rangé dans le sillon : pas de bulle « créez votre film ».
    hasFilm?: boolean
    // Date et heures enregistrées avec le tracé (saisies à la main si le GPX n'a pas d'horodatage) :
    // prioritaires sur celles du GPX, sinon la météo disparaissait à la réouverture.
    date?: string
    departureTime?: string
    arrivalTime?: string
  }) {
    loadTrack(parsed, raw)
    setLastFilmUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    // Idem pour le survol 3D : sans ça, le bouton reste sur "Voir le film 3D" et rejoue
    // le film du tracé précédent au lieu de proposer d'en créer un nouveau.
    setLastFilm3dUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    // Réouverture depuis « Mes sillons » d'un tracé DÉJÀ travaillé (film créé, album composé, ou
    // assistant panneaux validé) : on reprend là où on en était — l'aperçu a déjà été joué, on le
    // considère comme fait, sinon chaque nouveau film (ex. 2D après un 3D) redemande de relancer
    // l'aperçu. En revanche un tracé BRUT (GPX neuf, ou enregistrement direct tout juste rangé
    // dans Mes sillons sans film) doit repartir de zéro : guide complet, aperçu obligatoire avant
    // de pouvoir créer un film (voir AnimateScreen / previewRequired).
    setHasPlayedPreview(!!restore?.hasComposition)
    setPreviewFinished(!!restore?.hasComposition)
    setTrackHasSavedFilm(!!restore?.hasFilm)
    setActiveSillonId(restore?.voyageId ?? null)
    setActiveSillonTrackId(restore?.trackId ?? null)
    setShowSaveModal(false)
    setCustomTitle(parsed.name ?? parsed.tracks[0]?.name ?? '')
    restoreNames(restore?.startName || '', restore?.endName || '', restore?.startKind, restore?.endKind)
    setCustomLocalities(restore?.customLocalities ?? [])
    // Nouveau tracé (pas une réouverture avec ses panneaux) : repère le plus proche du départ ajouté d'office comme
    // point d'intérêt, visible dès l'ouverture (ex. « Porte de Paris » au départ du semi de Lille).
    const p0 = parsed.tracks[0]?.points[0]
    if (p0 && !restore?.customLocalities) {
      fetchStartLandmark(p0.lon, p0.lat).then(lm => {
        if (lm) setCustomLocalities(prev => prev.some(l => l.name === lm.name) ? prev
          : [...prev, { type: 'locality', name: lm.name, lon: lm.lon, lat: lm.lat, placeType: 'poi' }])
      }).catch(() => { /* repère facultatif */ })
    }
    setRace(restore?.race ?? DEFAULT_RACE_SETTINGS)
    pendingPanelRestoreRef.current = restore ? { suppressed: restore.suppressed, wizardDone: restore.wizardDone } : null
    reset()
    // Vitesse initiale selon le mode et la distance
    const distKm = (parsed.tracks[0]?.distance ?? 0) / 1000
    setTargetZoom(ZOOMS[0])
    setSpeed(animSpeed(activityMode, 1, distKm))
    // Auto-remplir date et heures depuis les timestamps GPX
    // (à la réouverture d'un sillon, les valeurs enregistrées avec le tracé priment).
    const start = parsed.tracks[0]?.startTime
    const end   = parsed.tracks[0]?.endTime
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    setManualDate(restore?.date || (start ? start.toISOString().slice(0, 10) : ''))
    setDepartureTime(restore?.departureTime || (start ? hhmm(start) : ''))
    setArrivalTime(restore?.arrivalTime || (end ? hhmm(end) : ''))
  }

  // Rando d'exemple (?demo) : chargée une fois au démarrage, comme une réouverture depuis
  // « Mes sillons » (le tracé est rattaché à son sillon, où l'album trouve les photos). On retire
  // ?demo de l'URL pour qu'un rechargement ne rouvre pas l'exemple par-dessus un autre tracé.
  useEffect(() => {
    if (!demoRequestedRef.current) return
    const url = new URL(window.location.href)
    url.searchParams.delete('demo')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    openDemoTrip().then(({ voyageId, track, parsed }) => {
      setRecordedLive(false)
      handleGpxLoad(parsed, track.name, track.gpxData, {
        voyageId, trackId: track.id,
        date: track.date,
        departureTime: track.departureTime,
        arrivalTime: track.arrivalTime,
      })
      setView('upload')
    }).catch(e => {
      console.error('[demo]', e)
      alert("La rando d'exemple n'a pas pu être chargée. Vérifiez votre connexion et réessayez.")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sauvegarde différée de la personnalisation des panneaux sur le tracé du sillon actif — pour
  // qu'un tracé déjà enregistré retrouve exactement sa configuration à la prochaine ouverture.
  useEffect(() => {
    if (!activeSillonId || !activeSillonTrackId) return
    const timer = setTimeout(() => {
      saveTrackPanelSettings(activeSillonId, activeSillonTrackId, {
        startName: startName || undefined,
        endName: endName || undefined,
        startKind: startKind ?? undefined,
        endKind: endKind ?? undefined,
        suppressed: suppressedLocalities.size > 0 ? Array.from(suppressedLocalities) : undefined,
        customLocalities: customLocalities.length > 0 ? customLocalities : undefined,
        wizardDone,
        bornesOff: race.bornesOff || undefined,
        plannedTimes: race.plannedTimes || undefined,
        raceSpeeds: race.speeds.length > 0 ? race.speeds : undefined,
        eventName: race.eventName?.trim() || undefined,
        bannerDate: race.bannerDate?.trim() || undefined,
        bannerDistance: race.bannerDistance?.trim() || undefined,
        bibNumber: race.bibNumber?.trim() || undefined,
        ravitos: race.ravitos?.trim() || undefined,
      }).catch(e => console.error('[panels] save:', e))
    }, 600)
    return () => clearTimeout(timer)
  }, [activeSillonId, activeSillonTrackId, startName, endName, startKind, endKind, suppressedLocalities, customLocalities, wizardDone, race])

  const { countdown, waitingMap, mapIdleRef, handleMapIdle, handlePlay, handlePause, handleReset, handleRestart } = usePlaybackCountdown(
    state, play, pause, reset, speedLevel, ZOOMS, setTargetZoom, () => setZoomResetSeq(s => s + 1),
    bumpZoomToStart, setHasPlayedPreview, () => setView('title'),
    startDelayMsRef,
  )


  // ── Enregistrement vidéo ────────────────────────────────────────────────────
  // Met à jour la fonction de dessin à chaque render pour avoir les données fraîches
  if (activeTrack) {
    updateDrawFrame((ctx, w, h) => {
      drawElevOverlay(ctx, w, h, {
        points: activeTrack.points,
        distances,
        progress: state.progress,
        distanceCovered: state.distanceCovered,
        totalDistance: activeTrack.distance,
        elevGain: activeTrack.elevGain,
        elevLoss: activeTrack.elevLoss,
        currentEle: state.currentEle,
        trackName: customTitle || activeTrack.name,
      })
    })
  }

  function handleCreateFilm() {
    if (!activeTrack) return
    filmRecordingCreateFilm({
      activeTrack,
      distances,
      previewLocalities: [...previewLocalities, ...colLocalities],
      customLocalities,
      suppressedNames: suppressedLocalitiesRef.current,
      startName: effectiveStartName,
      endName: effectiveEndName,
      startColEle,
      endColEle,
      startLieudit,
      endLieudit,
      manualDate,
      weather,
      characters,
      bornes,
      bibNumber: race.bibNumber?.trim() || undefined,
      startTime: departureTime || undefined,
      startTimePlanned: !(realTimes && !race.plannedTimes),
      ravitos,
      endCard,
      trackName: customTitle || activeTrack.name,
      speedLevel,
      activeSillonId,
      activeSillonTrackId,
      // Lire l'aperçu n'est pas nécessaire : le film prépare ses propres données.
      hasPlayedPreview: true,
      pause,
    })
  }

  function handleCreateFilm3d() {
    if (!activeTrack) return
    film3dCreate({
      activeTrack,
      previewLocalities: [...previewLocalities, ...colLocalities],
      customLocalities,
      suppressedNames: suppressedLocalitiesRef.current,
      startName: effectiveStartName,
      endName: effectiveEndName,
      startColEle,
      endColEle,
      startLieudit,
      endLieudit,
      rawStartName: startName,
      rawEndName: endName,
      weather,
      manualDate,
      departureTime,
      startTimePlanned: !(realTimes && !race.plannedTimes),
      arrivalTime,
      trackName: customTitle || activeTrack.name,
      speedLevel,
      activeSillonId,
      activeSillonTrackId,
      hasPlayedPreview: true,
      pause,
    })
  }

  // « Voir le film » (2D ou 3D) : renvoie vers la fiche du tracé dans « Mes sillons », où la
  // liste des films permet d'en lire un et bientôt d'y ajouter une bande-son. Le tracé est
  // forcément enregistré à ce stade (prérequis du film) -> activeSillonId/TrackId sont posés.
  function handleViewFilm(_kind: '2d' | '3d') {
    if (activeSillonId && activeSillonTrackId) {
      setFilmFocus({ sillonId: activeSillonId, trackId: activeSillonTrackId })
    }
    setView('voyages')
  }

  function cancelRunningFilm() {
    if (!runningFilm) return
    if (runningFilm.kind === '2d') handleCreateFilm()
    else handleCreateFilm3d()
  }

  function goToVoyages() {
    setFilmFocus(null)
    setView('voyages')
  }

  // Changer les personnages (en remplacer un, passer de 1 à 2…) doit permettre de refaire le
  // film : sans ça, une fois un film créé, les boutons restaient bloqués sur « Voir le film » et
  // il n'y avait aucun moyen de le régénérer avec la nouvelle sélection. On repasse donc les
  // boutons sur « Créer le film » (comme au chargement d'un nouveau tracé) dès que la sélection
  // change réellement (`toggleCharacter` renvoie le même tableau si le clic est sans effet).
  function clearCreatedFilms() {
    setLastFilmUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setLastFilm3dUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  function handleToggleRibbon() {
    if (ribbonOnly) { setRibbonOnly(false); clearCreatedFilms(); return }
    setRibbonOnly(true)
    setCharacters([])
    clearCreatedFilms()
  }

  function handleToggleCharacter(id: CharacterId) {
    // Choisir un personnage quitte le mode « ruban seul ».
    if (ribbonOnly) { setRibbonOnly(false); setCharacters([id]); clearCreatedFilms(); return }
    const next = toggleCharacter(characters, id)
    if (next === characters) return
    setCharacters(next)
    clearCreatedFilms()
  }

  function goToLanding() {
    if (getBackupStatus().hasPendingChanges && !confirm('Avez-vous pensé à sauvegarder vos sillons ?')) return
    window.location.href = '/'
  }

  return (
    <div className="app">
    <HeaderBackContext.Provider value={setHeaderBack}>
      <PWAPrompt />
      <UpdatePrompt />
      {showSaveModal && activeTrack && (
        <SaveToSillonModal
          track={activeTrack}
          gpxData={rawGpx}
          recordedLive={recordedLive}
          trackName={customTitle || activeTrack.name}
          manualDate={manualDate || undefined}
          departureTime={departureTime || undefined}
          arrivalTime={arrivalTime || undefined}
          defaultSillonId={activeSillonId ?? undefined}
          onSaved={(id, trackId) => {
            setActiveSillonId(id); setActiveSillonTrackId(trackId); setShowSaveModal(false); setPreviewFinished(true)
            setRecordingPending(false)
            if (saveModalFromUpload) { setSaveModalFromUpload(false); goToVoyages() }
          }}
          onClose={() => { setShowSaveModal(false); setSaveModalFromUpload(false) }}
        />
      )}
      {view !== 'animate' && (
        <FilmProgressDock
          running={runningFilm}
          done={filmDone}
          onOpen={() => { if (activeTrack) setView('animate') }}
          onCancel={cancelRunningFilm}
          onViewFilm={() => {
            const done = filmDone
            setFilmDone(null)
            if (done?.saved) handleViewFilm(done.kind)
            else if (activeTrack) setView('animate')
          }}
          onDismissDone={() => setFilmDone(null)}
        />
      )}
      <header className="app-header">
        <div className="app-header__left">
          {headerBack && (
            <button className="btn-back" onClick={headerBack.onClick}>← {headerBack.label}</button>
          )}
        </div>
        {view === 'animate' && activeTrack && (
          <button
            className="app-header__guide"
            onClick={replayGuide}
            title="Revoir le guide depuis le début"
          >
            🎓 Revoir le guide
          </button>
        )}
        {view === 'album' && (
          // Accès direct à « Mes sillons » depuis l'album (même garde que le bouton Retour de l'album).
          <button
            className="app-header__voyages"
            onClick={() => {
              if (getBackupStatus().hasPendingChanges && !confirm('Modifications non sauvegardées. Quitter sans sauvegarder ?')) return
              setAlbumInitialTrack(null)
              goToVoyages()
            }}
            title="Mes sillons"
          >
            <AppLogoIcon size={22} />
            <span className="app-header__voyages-label">Mes sillons</span>
          </button>
        )}
        {/* Maison + logo + nom = un seul bouton qui ramène à la landing page (présent sur toutes
            les pages de l'appli ; la landing elle-même est un autre document, index.html) */}
        <button className="app-logo" onClick={goToLanding} title="Page d'accueil" aria-label="Page d'accueil">
          <HomeIcon size={16} className="app-logo__home-icon" />
          <AppLogoIcon size={28} />
          Sillonphane-Rando
        </button>
      </header>

      {/* Web : /app.html sans ?start est redirigé vers la landing (useEffect ci-dessus).
          Android (app.html servi à la racine) : pas de redirection, on garde le SplashScreen. */}
      {view === 'home' && <SplashScreen onNext={() => setView('how')} />}

      <main className={`app-main${view === 'voyages' || view === 'upload' ? ' app-main--light' : ''}`}>
        {view === 'voyages' && (
          <VoyagesPage
            onBack={() => setView('upload')}
            focusTarget={filmFocus}
            onFocusConsumed={() => setFilmFocus(null)}
            onOpenTrack={(voyageId, track, hasComposition, hasFilm) => {
              try {
                const parsed = parseGpx(track.gpxData)
                setRecordedLive(track.source === 'recorded')
                handleGpxLoad(parsed, track.name, track.gpxData, {
                  voyageId, trackId: track.id,
                  startName: track.panelStartName,
                  endName: track.panelEndName,
                  startKind: track.panelStartKind,
                  endKind: track.panelEndKind,
                  suppressed: track.panelSuppressed,
                  customLocalities: track.panelCustomLocalities,
                  wizardDone: track.panelWizardDone,
                  race: {
                    bornesOff: !!track.panelBornesOff,
                    plannedTimes: !!track.panelPlannedTimes,
                    speeds: track.panelRaceSpeeds ?? [],
                    eventName: track.panelEventName,
                    bannerDate: track.panelBannerDate,
                    bannerDistance: track.panelBannerDistance,
                    bibNumber: track.panelBibNumber,
                    ravitos: track.panelRavitos,
                  },
                  hasComposition,
                  hasFilm,
                  date: track.date,
                  departureTime: track.departureTime,
                  arrivalTime: track.arrivalTime,
                })
                setView('animate')
                // Ouverture d'un tracé enregistré : la progression restaurée
                // (previewFinished, wizardDone…) ferait démarrer le guide sur une
                // bulle avancée. On le rejoue depuis la 1re bulle — sauf s'il a
                // déjà été fermé (guideOn === false) : alors aucune bulle.
                if (guideOn) setGuideReplayNonce(n => n + 1)
              } catch (e) {
                console.error('[open track]', e)
              }
            }}
            onCreateAlbum={(voyageId, trackId) => {
              setAlbumInitialTrack({ voyageId, trackId })
              setView('album')
            }}
            onAlbum={() => {
              setAlbumInitialTrack(null)
              setView('album')
            }}
          />
        )}

        {view === 'album' && (
          <AlbumPage
            initialTrack={albumInitialTrack}
            onBack={() => {
              setAlbumInitialTrack(null)
              setView('upload')
            }}
          />
        )}

        {view === 'how' && (
          <HowItWorks
            onStart={() => {
              handleModeChange('randonneur', 1)
              setView(canRecordGps() ? 'choice' : 'upload')
            }}
            onBack={() => { window.location.href = '/' }}
          />
        )}

        {view === 'choice' && (
          <ChoiceScreen
            onRecord={() => setView('record')}
            onUpload={() => setView('upload')}
            onAlbum={() => setView('album')}
            onVoyages={goToVoyages}
            onBack={() => setView('how')}
          />
        )}

        {view === 'record' && (
          <RecordScreen
            onFinish={(parsed, gpxData, startedAt, endedAt) => {
              handleGpxLoad(parsed, undefined, gpxData)
              // Filet de sécurité : les timestamps GPX (issus des relevés GPS) peuvent manquer ou
              // être peu fiables selon l'appareil — l'heure de démarrage/arrêt de l'horloge du
              // téléphone, elle, est toujours connue et sert de repli garanti.
              if (!parsed.tracks[0]?.startTime) {
                const start = new Date(startedAt)
                setManualDate(start.toISOString().slice(0, 10))
                setDepartureTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`)
              }
              if (!parsed.tracks[0]?.endTime) {
                const end = new Date(endedAt)
                setArrivalTime(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`)
              }
              setRecordedLive(true)
              setView('upload')
              // Sauvegarde immédiate dans "Mes sillons" (dossier par défaut) dès l'arrêt de
              // l'enregistrement, comme OpenTracks — sans ça, la trace ne vivait qu'en mémoire
              // et était perdue si on fermait l'appli avant d'aller au bout de l'aperçu du film.
              // On ignore les enregistrements quasi instantanés (démarrage accidentel suivi d'un
              // arrêt immédiat) pour ne pas polluer "Mes sillons" d'entrées à distance nulle.
              const track = parsed.tracks[0]
              if ((track?.distance ?? 0) < 20 && (track?.duration ?? 0) < 15) return
              // Panneau d'action épinglé en haut de l'écran d'import jusqu'à ce que
              // l'utilisateur lance l'animation ou range le tracé.
              setRecordingPending(true)
              const name = parsed.name ?? track?.name ?? 'Parcours'
              getDefaultSillon().then(sillon =>
                addTrackToVoyage(sillon.id, {
                  name,
                  gpxData,
                  source: 'recorded',
                  distanceM: track?.distance ?? 0,
                  elevGainM: track?.elevGain ?? 0,
                  elevLossM: track?.elevLoss ?? 0,
                  durationSec: track?.duration ?? 0,
                  date: track?.startTime?.toISOString().slice(0, 10),
                }).then(entry => {
                  setActiveSillonId(sillon.id)
                  setActiveSillonTrackId(entry.id)
                }),
              ).catch(e => console.error('[record] auto-save échoué :', e instanceof Error ? e.message : String(e)))
            }}
            onCancel={() => setView('choice')}
          />
        )}



        {view === 'upload' && (
          <UploadScreen
            gpx={gpx}
            gpxTracksCount={gpx?.tracks.length ?? 0}
            onLoad={(parsed, fileName, raw) => { setRecordedLive(false); handleGpxLoad(parsed, fileName, raw) }}
            onAlbum={() => setView('album')}
            onVoyages={goToVoyages}
            customTitle={customTitle}
            onCustomTitleChange={setCustomTitle}
            manualDate={manualDate}
            onManualDateChange={setManualDate}
            departureTime={departureTime}
            onDepartureTimeChange={setDepartureTime}
            arrivalTime={arrivalTime}
            onArrivalTimeChange={setArrivalTime}
            normalizeTime={normalizeTime}
            triedContinue={triedContinue}
            setTriedContinue={setTriedContinue}
            recordedLive={recordedLive}
            recordingPending={recordingPending}
            onContinue={() => { if (activeTrack && handleUploadContinue(triedContinue)) { setRecordingPending(false); setView('title') } }}
            onSaveToSillons={() => { if (activeTrack) { setSaveModalFromUpload(true); setShowSaveModal(true) } }}
          />
        )}

        {view === 'title' && activeTrack && (
          <TitleScreen
            track={activeTrack}
            manualDate={manualDate || undefined}
            departureTime={departureTime || undefined}
            arrivalTime={arrivalTime || undefined}
            customTitle={customTitle || undefined}
            onTitleChange={setCustomTitle}
            startName={startName || undefined}
            endName={endName || undefined}
            onStartNameChange={setStartName}
            onEndNameChange={setEndName}
            onStart={() => setView('animate')}
            onBack={() => setView('upload')}
          />
        )}

        {view === 'animate' && activeTrack && (
          <AnimateScreen
            activeTrack={activeTrack}
            rawGpx={rawGpx}
            distances={distances}
            state={state}
            fitBoundsCount={fitBoundsCount}
            seekCount={seekCount}
            zoomToStartCount={zoomToStartCount}
            targetZoom={targetZoom}
            zoomResetSeq={zoomResetSeq}
            handleMapIdle={handleMapIdle}
            activityMode={activityMode}
            characters={characters}
            onToggleCharacter={handleToggleCharacter}
            ribbonOnly={ribbonOnly}
            onToggleRibbon={handleToggleRibbon}
            speedLevel={speedLevel}
            locality={locality}
            colMarkers={colMarkers}
            panels={panels}
            endDelayMsRef={endDelayMsRef}
            startDelayMsRef={startDelayMsRef}
            startName={startName}
            endName={endName}
            onStartNameChange={setStartName}
            onEndNameChange={setEndName}
            effectiveStartName={effectiveStartName}
            effectiveEndName={effectiveEndName}
            startColEle={startColEle}
            endColEle={endColEle}
            startLieudit={startLieudit}
            endLieudit={endLieudit}
            onStartKindChange={setStartKind}
            onEndKindChange={setEndKind}
            race={race}
            onRaceChange={setRace}
            realTimes={realTimes}
            bornes={bornes}
            ravitos={ravitos}
            bannerDefaults={bannerDefaults}
            onCustomTitleChange={setCustomTitle}
            departureTime={departureTime}
            onDepartureTimeChange={setDepartureTime}
            onMapCanvasReady={canvas => { mapCanvasRef.current = canvas }}
            countdown={countdown}
            waitingMap={waitingMap}
            weather={weather}
            filmProgress={filmProgress}
            filmEtaS={filmEtaS}
            handleCreateFilm={handleCreateFilm}
            lastFilmUrl={lastFilmUrl}
            film3dProgress={film3dProgress}
            film3dPhase={film3dPhase}
            film3dEtaS={film3dEtaS}
            handleCreateFilm3d={handleCreateFilm3d}
            onFilm3dIntent={() => setFilm3dIntentTrack(activeTrack)}
            lastFilm3dUrl={lastFilm3dUrl}
            trackHasSavedFilm={trackHasSavedFilm}
            dismissedHints={dismissedHints}
            dismissHint={dismissHint}
            handlePlay={handlePlay}
            handlePause={handlePause}
            handleReset={handleReset}
            handleRestart={handleRestart}
            onSeek={t => { seek(t); bumpSeek() }}
            handleModeChange={handleModeChange}
            lookahead={lookahead}
            setLookahead={setLookahead}
            hasPlayedPreview={hasPlayedPreview}
            previewFinished={previewFinished}
            trackSaved={activeSillonId !== null}
            onViewFilm={handleViewFilm}
            customTitle={customTitle}
            onVoyages={goToVoyages}
            onSaveTrack={() => setShowSaveModal(true)}
            onAlbum={() => setView('album')}
            guideOn={guideOn}
            guideReplayNonce={guideReplayNonce}
            onGuideClose={() => setGuide(false)}
          />
        )}
      </main>
    </HeaderBackContext.Provider>
    </div>
  )
}
