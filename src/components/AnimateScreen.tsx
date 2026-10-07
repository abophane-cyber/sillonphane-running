import { useMemo } from 'react'
import { TrackMap } from './TrackMap'
import { AnimationControls } from './AnimationControls'
import { ElevationMiniMap } from './ElevationMiniMap'
import { PanelWizard } from './PanelWizard'
import { GuidedTour } from './GuidedTour'
import type { GpxTrack } from '../types'
import type { WeatherInfo } from '../lib/meteo'
import type { CharacterId } from '../lib/characters'
import type { ActivityMode } from '../hooks/useAnimationSettings'
import type { EndpointKind } from '../hooks/useTrackNaming'
import { formatEta } from '../lib/exportEta'
import type { Borne, Ravito, RaceSettings } from '../lib/raceSplits'
import type { BannerText } from '../lib/raceSplits'
import type { useAnimation } from '../hooks/useAnimation'
import type { useLocalityPanels } from '../hooks/useLocalityPanels'
import type { useLocality, useColMarkers } from '../hooks/useLocality'

type AnimationState = ReturnType<typeof useAnimation>['state']
type LocalityPanels = ReturnType<typeof useLocalityPanels>
type Locality = ReturnType<typeof useLocality>['current']
type ColMarkers = ReturnType<typeof useColMarkers>

interface Props {
  activeTrack: GpxTrack
  rawGpx: string | null
  distances: number[]
  state: AnimationState
  fitBoundsCount: number
  seekCount: number
  zoomToStartCount: number
  targetZoom: number | null
  zoomResetSeq: number
  handleMapIdle: () => void
  activityMode: ActivityMode
  characters: CharacterId[]
  onToggleCharacter: (id: CharacterId) => void
  /** « Ruban seul » : aucun personnage, le ruban seul avance (aperçu et film). */
  ribbonOnly: boolean
  onToggleRibbon: () => void
  speedLevel: 1 | 2
  locality: Locality
  colMarkers: ColMarkers
  panels: LocalityPanels
  /** Reçoit la durée de la séquence d'arrivée des randonneurs 3D (délai avant la popup d'enregistrement). */
  endDelayMsRef: { current: number }
  /** Pause avant la marche (dézoom du randonneur 3D en 2D), cf. usePlaybackCountdown. */
  startDelayMsRef: { current: number }
  startName: string
  endName: string
  onStartNameChange: (v: string) => void
  onEndNameChange: (v: string) => void
  effectiveStartName?: string
  effectiveEndName?: string
  /** Altitude du col quand le départ / l'arrivée est un col : panneau au style col. */
  startColEle?: number
  endColEle?: number
  /** Départ / arrivée sur un hameau / lieu-dit : panneau au style lieu-dit. */
  startLieudit?: boolean
  endLieudit?: boolean
  onStartKindChange: (k: EndpointKind) => void
  onEndKindChange: (k: EndpointKind) => void
  /** Bornes tous les 5 km et temps de passage (cf. raceSplits.ts). */
  race: RaceSettings
  onRaceChange: (r: RaceSettings) => void
  /** Le GPX porte des heures réelles. */
  realTimes: boolean
  bornes: Borne[]
  /** Ravitaillements placés sur le tracé (km saisis dans le widget). */
  ravitos: Ravito[]
  /** Inscription par défaut de l'épreuve (exemples des champs du widget). */
  bannerDefaults: BannerText
  /** Titre du film, modifiable dans le widget (rubrique Épreuve). */
  onCustomTitleChange: (v: string) => void
  departureTime: string
  onDepartureTimeChange: (v: string) => void
  onMapCanvasReady: (canvas: HTMLCanvasElement | null) => void
  countdown: number | null
  waitingMap: boolean
  weather: WeatherInfo | null
  filmProgress: number | null
  /** Temps restant estimé de l'export (s), null si inconnu — idem pour le 3D. */
  filmEtaS?: number | null
  handleCreateFilm: () => void
  lastFilmUrl: string | null
  film3dProgress: number | null
  film3dPhase: 'prepare' | 'render' | null
  /** Temps restant estimé de l'export 3D (s), null si inconnu. */
  film3dEtaS?: number | null
  handleCreateFilm3d: () => void
  /** Intention « Film 3D » exprimée (clic encore bloqué) : déclenche le préchargement du terrain 3D. */
  onFilm3dIntent: () => void
  lastFilm3dUrl: string | null
  /** Tracé rouvert depuis Mes sillons avec un film déjà créé (pas d'URL de film en mémoire). */
  trackHasSavedFilm: boolean
  onViewFilm: (kind: '2d' | '3d') => void
  dismissedHints: Set<string>
  dismissHint: (id: string) => void
  handlePlay: () => void
  handlePause: () => void
  handleReset: () => void
  handleRestart: () => void
  onSeek: (t: number) => void
  handleModeChange: (mode: ActivityMode, speedLevel?: 1 | 2) => void
  lookahead: number
  setLookahead: (v: number) => void
  hasPlayedPreview: boolean
  previewFinished: boolean
  trackSaved: boolean
  customTitle: string
  onVoyages: () => void
  onSaveTrack: () => void
  onAlbum: () => void
  guideOn: boolean
  guideReplayNonce: number
  onGuideClose: () => void
}


export function AnimateScreen({
  activeTrack, rawGpx, distances, state,
  fitBoundsCount, seekCount, zoomToStartCount, targetZoom, zoomResetSeq,
  handleMapIdle, activityMode, characters, onToggleCharacter, ribbonOnly, onToggleRibbon, speedLevel,
  locality, colMarkers, panels, endDelayMsRef, startDelayMsRef,
  startName, endName, onStartNameChange, onEndNameChange,
  effectiveStartName, effectiveEndName, startColEle, endColEle, startLieudit, endLieudit, onStartKindChange, onEndKindChange, onMapCanvasReady,
  race, onRaceChange, realTimes, bornes, ravitos, bannerDefaults, departureTime, onDepartureTimeChange,
  countdown, waitingMap, weather, filmProgress, handleCreateFilm, lastFilmUrl,
  filmEtaS, film3dProgress, film3dPhase, film3dEtaS, handleCreateFilm3d, onFilm3dIntent, lastFilm3dUrl,
  trackHasSavedFilm, onViewFilm,
  dismissedHints, dismissHint,
  handlePlay, handlePause, handleReset, handleRestart, onSeek,
  handleModeChange, lookahead, setLookahead,
  hasPlayedPreview, previewFinished, trackSaved, customTitle, onCustomTitleChange,
  onVoyages, onSaveTrack, onAlbum,
  guideOn, guideReplayNonce, onGuideClose,
}: Props) {
  const {
    previewLocalities, localitiesLoading, customLocalities,
    suppressedLocalities,
    wizardStep, setWizardStep, wizardDone, setWizardDone,
    suppressLocality, restoreLocality, toggleSuppressLocality,
    handleAddPanel, handleRemoveCustomLocality, handleMoveCustomLocality, finalizePanels,
  } = panels

  // Calque de guidage animé : l'état (guideOn / rejeu) et le bouton « Revoir le
  // guide » vivent dans le header (App). Ici on ne fait qu'afficher le calque et,
  // quand il est masqué, laisser les bulles d'aide historiques reprendre le relais.
  const wizardInProgress = wizardStep > 0 && !wizardDone

  // Lire l'aperçu n'est pas nécessaire pour créer un film : un personnage (ou le ruban seul) choisi suffit.
  const choiceMade = characters.length > 0 || ribbonOnly
  // Cols décochés (par défaut ou par l'utilisateur) : ni panneau sur la carte, ni dans le film.
  // Un col qui sert de départ / d'arrivée est affiché par le panneau de départ / d'arrivée.
  const isEndpointCol = (name: string) => name === effectiveStartName || name === effectiveEndName
  const visibleColMarkers = useMemo(
    () => colMarkers.filter(c => !suppressedLocalities.has(c.name) && !isEndpointCol(c.name)),
    [colMarkers, suppressedLocalities, effectiveStartName, effectiveEndName], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const wizardCols = useMemo(
    () => colMarkers.filter(c => c.name !== 'Col' && c.name !== startName && c.name !== endName),
    [colMarkers, startName, endName],
  )

  return (
    <div className="viewer">
      {localitiesLoading && (
        <div className="localities-loading">Chargement des localités…</div>
      )}
      {/* Carte + overlay minimap */}
      <div className="viewer__map-wrap">
        <TrackMap
          points={activeTrack.points}
          distances={distances}
          totalDistance={activeTrack.distance}
          progress={state.progress}
          markerPosition={state.currentPoint}
          followMarker={true}
          animating={true}
          playing={state.playing}
          fitBounds={fitBoundsCount}
          seekCount={seekCount}
          zoomToStart={zoomToStartCount}
          targetZoom={targetZoom}
          zoomResetSeq={zoomResetSeq}
          onZoomChange={() => {}}
          onMapIdle={handleMapIdle}
          activityMode={activityMode}
          characters={characters}
          speedLevel={speedLevel}
          panelDuration={3000}
          localityDedupKm={speedLevel === 2 ? 2 : 1}
          localityDedupMinScore={5}
          locality={locality}
          colMarkers={visibleColMarkers}
          previewLocalities={previewLocalities}
          customLocalities={customLocalities}
          bornes={bornes}
          ravitos={ravitos}
          streets={race.streets}
          bibNumber={race.bibNumber}
          onRemoveCustomLocality={handleRemoveCustomLocality}
          onMoveCustomLocality={handleMoveCustomLocality}
          onSuppressLocality={suppressLocality}
          onRestoreLocality={restoreLocality}
          departureNameOverride={effectiveStartName}
          arrivalNameOverride={effectiveEndName}
          departureColEle={startColEle}
          arrivalColEle={endColEle}
          departureLieudit={startLieudit}
          arrivalLieudit={endLieudit}
          detectedDepartureName={previewLocalities[0]?.name}
          detectedArrivalName={previewLocalities[previewLocalities.length - 1]?.name}
          onMapCanvasReady={onMapCanvasReady}
          animationEnded={!state.playing && state.progress >= 1}
          wizardPanelStep={wizardStep === 3}
          externalSuppressed={suppressedLocalities}
          countdown={countdown}
          endDelayMsRef={endDelayMsRef}
          startDelayMsRef={startDelayMsRef}
        />
        {/* Source du fond (Plan IGN, licence Etalab 2.0 : citer « © IGN »). Coin bas-droit : l'échelle et les +/− occupent le bas-gauche. Élément DOM,
            hors des canvas : les films incrustent leur propre mention (filmExport.ts). */}
        <div className="map-credit" aria-label="Source du fond de carte : IGN">© IGN</div>
        {wizardStep > 0 && !wizardDone && (
          <PanelWizard
            startName={startName}
            endName={endName}
            cols={wizardCols}
            localities={previewLocalities.filter(l => {
              const n = l.name.trim().toLowerCase()
              return !wizardCols.some(c => c.name === l.name)
                && n !== startName.trim().toLowerCase()
                && n !== endName.trim().toLowerCase()
            })}
            excluded={suppressedLocalities}
            customLocalities={customLocalities}
            onStartNameChange={onStartNameChange}
            onEndNameChange={onEndNameChange}
            startKind={startLieudit ? 'lieudit' : 'localite'}
            endKind={endLieudit ? 'lieudit' : 'localite'}
            startIsCol={startColEle != null}
            endIsCol={endColEle != null}
            onStartKindChange={onStartKindChange}
            onEndKindChange={onEndKindChange}
            race={race}
            onRaceChange={onRaceChange}
            realTimes={realTimes}
            totalDistance={activeTrack.distance}
            ravitoCount={ravitos.length}
            points={activeTrack.points}
            distances={distances}
            bannerDefaults={bannerDefaults}
            filmTitle={customTitle}
            onFilmTitleChange={onCustomTitleChange}
            departureTime={departureTime}
            onDepartureTimeChange={onDepartureTimeChange}
            onToggleLocality={toggleSuppressLocality}
            onAddPanel={handleAddPanel}
            onRemoveCustomLocality={handleRemoveCustomLocality}
            onComplete={finalizePanels}
            showHint={!guideOn && !wizardDone && !dismissedHints.has('panel')}
            onDismissHint={() => dismissHint('panel')}
          />
        )}
        {(countdown !== null || waitingMap) && (
          <div className="countdown-overlay">
            {waitingMap
              ? <span className="countdown-number countdown-number--map">🗺️</span>
              : <span className="countdown-number">{countdown}</span>
            }
          </div>
        )}
        {weather && (() => {
          const snap = state.progress < 0.5 ? weather.departure : weather.arrival
          const icon = snap?.icon ?? null
          const desc = snap?.description ?? null
          const tempDep = weather.departure?.temp ?? weather.tempMin
          const tempArr = weather.arrival?.temp ?? weather.tempMax
          const temp = Math.round(tempDep + (tempArr - tempDep) * state.progress)
          return icon ? (
            <div className="weather-card">
              <span className="weather-card__icon">{icon}</span>
              <div className="weather-card__info">
                <span className="weather-card__temp">{temp}°C</span>
                {desc && <span className="weather-card__desc">{desc}</span>}
              </div>
            </div>
          ) : null
        })()}
        <div className={`elev-minimap-overlay${!state.playing ? ' elev-minimap-overlay--hidden' : ''}`}>
          <ElevationMiniMap
            points={activeTrack.points}
            distances={distances}
            progress={state.progress}
            totalDistance={activeTrack.distance}
            elevGain={activeTrack.elevGain}
            elevLoss={activeTrack.elevLoss}
            distanceCovered={state.distanceCovered}
            currentEle={state.currentEle}
          />
        </div>

        {/* Modal de création du film (2D ou 3D — un seul actif à la fois) */}
        {(filmProgress !== null || film3dProgress !== null) && (() => {
          const is3d = filmProgress === null
          const etaS = is3d ? film3dEtaS : filmEtaS
          const prog = (is3d ? film3dProgress : filmProgress) ?? 0
          const title = is3d
            ? (film3dPhase === 'prepare' ? 'Préparation du terrain…' : prog >= 1 ? 'Finalisation…' : 'Rendu du survol…')
            : (prog < 0 ? 'Chargement des tuiles…' : prog < 1 ? 'Création du film…' : 'Finalisation…')
          return (
            <div className="film-modal-overlay">
              <div className="film-modal">
                <p className="film-modal__title">{title}</p>
                <div className="film-modal__bar-bg">
                  <div
                    className={`film-modal__bar-fill${prog === 1 ? ' film-modal__bar-fill--indeterminate' : ''}`}
                    style={{ width: `${Math.round(Math.abs(prog) * 100)}%` }}
                  />
                </div>
                <p className="film-modal__pct">
                  {/* prog avance en continu jusqu'à ~100% (rendu image par image inclus, plans de
                      fin compris) ; ne se bloque à 1 que pour l'encodage final, l'enregistrement
                      et le téléchargement, qui n'ont pas de progression fine possible. */}
                  {prog === 1 ? 'Presque prêt…' : `${Math.round(Math.abs(prog) * 100)} %`}
                  {prog < 1 && etaS != null && ` · ${formatEta(etaS)}`}
                </p>
                <p className="film-modal__hint">
                  Vous pouvez aller sur une autre page de l'appli (album, Mes sillons…) : la création continue.
                  Gardez cependant cet onglet affiché : sur certains navigateurs, elle se met en pause dans un onglet caché.
                </p>
                <button className="film-modal__cancel" onClick={is3d ? handleCreateFilm3d : handleCreateFilm}>
                  Annuler
                </button>
              </div>
            </div>
          )
        })()}

      </div>

      {guideOn && filmProgress === null && film3dProgress === null && (
        <GuidedTour
          wizardDone={wizardDone}
          charactersChosen={choiceMade}
          ribbonOption
          // L'aperçu est facultatif : le guide propose la création du film dès que panneaux et personnage sont faits.
          previewFinished={previewFinished || (wizardDone && choiceMade)}
          trackSaved={trackSaved}
          onReopenPanels={() => { setWizardDone(false); setWizardStep(1) }}
          replayNonce={guideReplayNonce}
          onClose={onGuideClose}
        />
      )}

      {wizardStep === 0 && wizardDone && filmProgress === null && film3dProgress === null && (
        <div className={`pwiz-reopen-wrap${state.playing ? ' pwiz-reopen-wrap--hidden' : ''}`}>
          <button className="pwiz-reopen-btn" onClick={() => { setWizardDone(false); setWizardStep(1) }} title="Modifier, ajouter ou retirer des panneaux">
            ✏️ Panneaux
          </button>
        </div>
      )}

      <div className="viewer__bottom">
          <AnimationControls
            state={state}
            totalDistance={activeTrack.distance}
            totalElevGain={activeTrack.elevGain}
            weather={weather}
            activityMode={activityMode}
            speedLevel={speedLevel}
            onModeChange={handleModeChange}
            lookahead={lookahead}
            onLookahead={setLookahead}
            characters={characters}
            onToggleCharacter={onToggleCharacter}
            ribbonOnly={ribbonOnly}
            onToggleRibbon={onToggleRibbon}
            onPlay={handlePlay}
            wizardInProgress={wizardInProgress}
            onPause={handlePause}
            onReset={handleReset}
            onRestart={handleRestart}
            onSeek={onSeek}
            onAddPanel={handleAddPanel}
            onRecord={handleCreateFilm}
            recState={filmProgress === null ? 'idle' : filmProgress < 1 ? 'recording' : 'processing'}
            lastFilmUrl={lastFilmUrl}
            onRecord3d={handleCreateFilm3d}
            onFilm3dIntent={onFilm3dIntent}
            rec3dState={film3dProgress === null ? 'idle' : film3dProgress < 1 ? 'recording' : 'processing'}
            lastFilm3dUrl={lastFilm3dUrl}
            onViewFilm={onViewFilm}
            previewFinished={previewFinished}
            trackSaved={trackSaved}
            voyageTrack={activeTrack}
            voyageGpxData={rawGpx ?? undefined}
            voyageTrackName={customTitle || activeTrack.name}
            onVoyages={onVoyages}
            onSaveTrack={onSaveTrack}
            onAlbum={onAlbum}
            showPreviewHint={!guideOn && wizardDone && !hasPlayedPreview && !dismissedHints.has('preview')}
            onDismissPreviewHint={() => dismissHint('preview')}
            // La bulle « créez votre film » ne doit apparaître qu'APRÈS l'ordre attendu :
            // panneaux terminés → aperçu joué. Ouvrir un tracé déjà enregistré force
            // previewFinished/hasPlayedPreview à true (boutons déverrouillés) sans que le wizard
            // soit fait — d'où les gardes wizardDone + hasPlayedPreview ici, sinon deux bulles
            // s'affichaient en même temps (panneaux ET film).
            // Jamais pendant un aperçu en cours (compte à rebours, lecture, pause en route) : une fois
            // l'aperçu déjà vu, la relancer faisait surgir la bulle dès l'appui sur lecture. Elle
            // (ré)apparaît à la fin de la lecture, ou à l'arrêt revenu au début.
            // Inutile aussi dès qu'un film (2D ou 3D) a été créé pour ce tracé — dans cette séance
            // ou avant (tracé rouvert depuis Mes sillons avec un film rangé).
            showExportHint={!guideOn && wizardDone && choiceMade && trackSaved && !dismissedHints.has('export')
              && !state.playing && countdown === null && !waitingMap && (state.progress <= 0 || state.progress >= 1)
              && !lastFilmUrl && !lastFilm3dUrl && !trackHasSavedFilm}
            onDismissExportHint={() => dismissHint('export')}
          />
      </div>
    </div>
  )
}
