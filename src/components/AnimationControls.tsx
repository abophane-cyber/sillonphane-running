import { useEffect, useRef, useState } from 'react'
import type { AnimationState, GpxTrack } from '../types'
import type { WeatherInfo } from '../lib/meteo'
import { formatDistance, formatElevation } from '../lib/gpx'
import { AnchoredBubble } from './AnchoredBubble'
import { CHARACTER_ICON, CHARACTER_IDS, CHARACTER_LABEL, type CharacterId } from '../lib/characters'
import { AlbumIcon } from './AlbumIcon'
import { FilmIcon } from './FilmIcon'
import { RibbonIcon } from './RibbonIcon'
import { AppLogoIcon } from './AppLogoIcon'
import { probeVideoEncoder } from '../lib/encoderProbe'
import { FILM_HD_AVAILABLE, getFilmHd, setFilmHd } from '../lib/filmQuality'
import { diag } from '../lib/diag'

type ActivityMode = 'randonneur'

export interface AddPanelInfo {
  type: 'locality' | 'col'
  name: string
  placeType?: string
  ele?: number
  /** Position connue (lieu trouvé le long du parcours) ; sinon repli sur le curseur ou le milieu du tracé. */
  lon?: number
  lat?: number
}

interface Props {
  state: AnimationState
  totalDistance: number
  totalElevGain: number
  weather?: WeatherInfo | null
  activityMode?: ActivityMode
  onModeChange?: (mode: ActivityMode) => void
  lookahead?: number
  onLookahead?: (v: number) => void
  characters?: CharacterId[]
  onToggleCharacter?: (id: CharacterId) => void
  /** « Ruban seul » (aucun personnage) comme choix possible à côté des personnages. */
  ribbonOnly?: boolean
  onToggleRibbon?: () => void
  onPlay: () => void
  onPause: () => void
  onReset: () => void
  onRestart: () => void
  onSeek: (t: number) => void
  onAddPanel?: (info: AddPanelInfo) => void
  onRecord?: () => void
  recState?: 'idle' | 'recording' | 'processing'
  lastFilmUrl?: string | null
  onRecord3d?: () => void
  /** Clic sur « Film 3D » encore bloqué (aperçu à terminer, tracé à enregistrer) : intention 3D
   *  claire -> App lance le préchargement du terrain 3D (useFilm3dPrefetch.ts). */
  onFilm3dIntent?: () => void
  rec3dState?: 'idle' | 'recording' | 'processing'
  lastFilm3dUrl?: string | null
  /** « Voir le film » (2D ou 3D) : renvoie vers la fiche du tracé dans « Mes sillons »
   * (liste des films + ajout d'une bande-son), au lieu d'un lecteur inline. */
  onViewFilm?: (kind: '2d' | '3d') => void
  /** Aperçu joué jusqu'au bout ET tracé enregistré (voir useVoyageSaveModal — malgré son nom,
   * ne passe à true qu'une fois la popup de fin d'animation validée, pas juste au premier play). */
  previewFinished?: boolean
  /** Tracé enregistré dans un sillon. Prérequis pour créer un film (2D ou 3D) : le film y est
   * rangé, et « Voir le film » renvoie vers sa fiche pour proposer d'ajouter une bande-son. */
  trackSaved?: boolean
  voyageTrack?: GpxTrack
  voyageGpxData?: string
  voyageTrackName?: string
  onVoyages?: () => void
  onSaveTrack?: () => void
  onAlbum?: () => void
  wizardInProgress?: boolean
  showPreviewHint?: boolean
  onDismissPreviewHint?: () => void
  showExportHint?: boolean
  onDismissExportHint?: () => void
}

export function AnimationControls({
  state, totalDistance, totalElevGain: _teg, weather: _weather,
  onPlay, onPause, onReset: _onReset, onRestart, onSeek,
  lookahead: _lookahead, onLookahead: _onLookahead,
  onRecord, recState = 'idle', lastFilmUrl,
  onRecord3d, onFilm3dIntent, rec3dState = 'idle', lastFilm3dUrl,
  onViewFilm,
  previewFinished = false, trackSaved = false,
  characters = ['coureuse1'], onToggleCharacter, ribbonOnly = false, onToggleRibbon,
  onVoyages, onSaveTrack, onAlbum,
  wizardInProgress = false,
  showPreviewHint, onDismissPreviewHint, showExportHint, onDismissExportHint,
}: Props) {
  const [showSaveRequiredPopup, setShowSaveRequiredPopup] = useState(false)
  // Bulle « terminez les panneaux », posée sur le bouton cliqué (Aperçu ou Film).
  const [wizardHintAt, setWizardHintAt] = useState<'preview' | 'film' | null>(null)
  const showWizardBlockedHint = wizardHintAt !== null
  const setShowWizardBlockedHint = (v: boolean) => setWizardHintAt(v ? 'preview' : null)
  const [showCharacterBlockedHint, setShowCharacterBlockedHint] = useState(false)
  const previewGroupRef = useRef<HTMLDivElement>(null)
  const filmGroupRef = useRef<HTMLDivElement>(null)
  // Diagnostic anticipé de l'encodeur vidéo (encoderProbe.ts) : lancé quelques secondes après l'ouverture
  // (laisse la carte de l'aperçu se charger d'abord), une seule fois par session. Bulle seulement si les
  // films ne pourront pas être créés sur ce navigateur.
  const [encoderBroken, setEncoderBroken] = useState(false)
  const [encoderWarnDismissed, setEncoderWarnDismissed] = useState(false)
  const [filmHd, setFilmHdState] = useState(getFilmHd)
  useEffect(() => {
    if (!onRecord && !onRecord3d) return
    let cancelled = false
    const t = setTimeout(() => {
      void probeVideoEncoder().then(r => {
        diag('encodeur vidéo', r)
        if (!cancelled && r === 'broken') setEncoderBroken(true)
      })
    }, 4000)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePlayClick() {
    if (wizardInProgress) {
      setShowWizardBlockedHint(true)
      return
    }
    if (!hasChoice) {
      setShowCharacterBlockedHint(true)
      return
    }
    onPlay()
  }

  // Les bulles n'ont de sens que tant que leur condition bloque effectivement l'aperçu — on les
  // referme automatiquement dès qu'elle est remplie plutôt que de les laisser périmées à l'écran.
  useEffect(() => {
    if (!wizardInProgress) setShowWizardBlockedHint(false)
  }, [wizardInProgress])
  // La bulle demande de valider les panneaux : l'assistant descend tout seul jusqu'à « Terminer ».
  useEffect(() => {
    if (!showWizardBlockedHint) return
    const card = document.querySelector('.pwiz-card')
    card?.scrollTo({ top: card.scrollHeight, behavior: 'smooth' })
  }, [showWizardBlockedHint])
  useEffect(() => {
    if (characters.length > 0 || ribbonOnly) setShowCharacterBlockedHint(false)
  }, [characters.length, ribbonOnly])

  // Parcours guidé : une fois le wizard des panneaux terminé, met en avant (agrandit) la section
  // dont c'est le tour, dans l'ordre — Personnage(s) tant qu'aucun n'est choisi, puis Création une
  // fois le personnage choisi ET le tracé enregistré (l'aperçu est facultatif). Pas d'emphase sur "Enregistrer le tracé" : la popup qui s'ouvre
  // automatiquement en fin d'animation suffit déjà à attirer l'attention.
  // Un film est en cours de création : les bulles d'aide (aperçu, export) n'ont plus lieu d'être.
  const filmBusy = recState !== 'idle' || rec3dState !== 'idle'
  // Choix fait : au moins un personnage, ou le ruban seul. Lire l'aperçu n'est pas nécessaire pour créer un film.
  const hasChoice = characters.length > 0 || ribbonOnly
  const needsCharacter = !wizardInProgress && !hasChoice
  // Personnage choisi mais tracé pas encore enregistré : l'enregistrement est un prérequis du film.
  const needsSave       = !wizardInProgress && hasChoice && !trackSaved
  const readyToCreate    = !wizardInProgress && (previewFinished || hasChoice) && trackSaved

  // Referme la popup « enregistrement requis » dès que le tracé est enregistré.
  useEffect(() => {
    if (trackSaved) setShowSaveRequiredPopup(false)
  }, [trackSaved])

  const pct = Math.round(state.progress * 100)

  return (
    <>
    <div className="controls">

      {/* ── Ligne stats ── */}
      <div className="controls__stats">
        <div className="controls__stat-chip">
          <span className="controls__stat-icon">📍</span>
          <div className="controls__stat-body">
            <span className="controls__stat-label">Distance</span>
            <span className="controls__stat-values">
              <span className="controls__stat-value">{formatDistance(state.distanceCovered)}</span>
              <span className="controls__stat-sep">/</span>
              <span className="controls__stat-total">{formatDistance(totalDistance)}</span>
            </span>
          </div>
        </div>
        <div className="controls__stat-chip">
          <span className="controls__stat-icon">⛰️</span>
          <div className="controls__stat-body">
            <span className="controls__stat-label">Dénivelé</span>
            <span className="controls__stat-value">+{formatElevation(state.elevCovered)}</span>
          </div>
        </div>
        <div className="controls__stat-chip">
          <span className="controls__stat-icon">🔼</span>
          <div className="controls__stat-body">
            <span className="controls__stat-label">Altitude</span>
            <span className="controls__stat-value">{formatElevation(state.currentEle)}</span>
          </div>
        </div>
      </div>

      {/* ── Scrubber ── */}
      <div className="controls__progress">
        <div className="controls__track">
          <div className="controls__track-fill" style={{ width: `${pct}%` }} />
          <div className="controls__track-thumb" style={{ left: `${pct}%` }} />
          <input
            type="range" min={0} max={1} step={0.001}
            value={state.progress}
            onChange={e => onSeek(parseFloat(e.target.value))}
            className="controls__scrubber"
          />
        </div>
      </div>

      {/* ── Boutons ── une seule rangée flex, 6 groupes répartis par justify-content:
          space-between (gaps égaux) : Navigation · Personnages · Enregistrer · Mes sillons ·
          Film · Créer mon album ── */}
      <div className="controls__buttons">

          {/* Section Navigation : Retour / Aperçu regroupés dans un même encadré */}
          <div className={`controls__section controls__section--nav`}>
            <div className="controls__subgroup">
              <span className="controls__group-label">Retour</span>
              <button className="ctrl-btn ctrl-btn--icon" onClick={onRestart} title="Retour au début">⏮</button>
            </div>

            <div className="controls__divider" />

            <div className="controls__subgroup" ref={previewGroupRef}>
              {showPreviewHint && !filmBusy && onDismissPreviewHint && (
                <AnchoredBubble icon="▶️" onClose={onDismissPreviewHint} anchorRef={previewGroupRef}>
                  Choisissez votre coureur (ou le ruban seul), puis créez votre film : lancer l'aperçu est facultatif.
                </AnchoredBubble>
              )}
              {wizardHintAt === 'preview' && (
                <AnchoredBubble icon="✏️" onClose={() => setShowWizardBlockedHint(false)} anchorRef={previewGroupRef}>
                  Terminez d'abord la validation des panneaux ci-dessus
                </AnchoredBubble>
              )}
              {showCharacterBlockedHint && (
                <AnchoredBubble icon="🧍" onClose={() => setShowCharacterBlockedHint(false)} anchorRef={previewGroupRef}>
                  Choisissez d'abord un coureur, ou le ruban seul, ci-contre
                </AnchoredBubble>
              )}
              <span className="controls__group-label">Aperçu</span>
              {state.playing
                ? <button className="ctrl-btn ctrl-btn--play" onClick={onPause} title="Pause">⏸</button>
                : <button className="ctrl-btn ctrl-btn--play" onClick={handlePlayClick} title="Lecture">▶</button>
              }
            </div>

          </div>

          {/* Section Personnage — un seul, choisi au clic */}
          <div className={`controls__group controls__group--character${needsCharacter ? ' controls__group--emphasize' : ''}`}>
            <span className="controls__group-label">{onToggleRibbon ? 'Personnage ou ruban seul' : 'Personnage'}</span>
            <div className="controls__appearance-icons">
              {CHARACTER_IDS.map(id => (
                <button
                  key={id}
                  className={`controls__mode-icon${characters.includes(id) ? ' active' : ''}`}
                  title={CHARACTER_LABEL[id]}
                  onClick={() => onToggleCharacter?.(id)}
                >
                  <img src={CHARACTER_ICON[id]} style={{ height: 44, width: 'auto', display: 'block' }} />
                </button>
              ))}
              {onToggleRibbon && (
                <button
                  className={`controls__mode-icon${ribbonOnly ? ' active' : ''}`}
                  title="Ruban seul (sans personnage)"
                  onClick={onToggleRibbon}
                >
                  <RibbonIcon height={44} />
                </button>
              )}
            </div>
          </div>

          {/* "Enregistrer le tracé" — bouton nu (pas d'encadré) */}
          {onSaveTrack && (
            <button
              className={`ctrl-btn ctrl-btn--save-track${needsSave ? ' ctrl-btn--save-track--required' : ''}`}
              onClick={onSaveTrack}
              title={needsSave ? 'Enregistrez ce tracé pour pouvoir créer un film' : 'Enregistrer ce tracé'}
            >
              💾 Enregistrer le tracé
            </button>
          )}

          {/* "Mes sillons" — un peu plus gros que les autres boutons */}
          {onVoyages && (
            <div className="ctrl-tile">
              <span className="ctrl-tile__label">Mes sillons</span>
              <button className="ctrl-btn ctrl-btn--voyages-icon" onClick={onVoyages} title="Mes sillons">
                <AppLogoIcon size={32} />
              </button>
            </div>
          )}

          {/* Film + « Créer mon album » forment un seul groupe : l'album se place tout contre la section Film. */}
          <div className="controls__film-album">
          {/* Section "Film" — Film 2D + Film 3D dans un même encadré titré */}
          {(onRecord || onRecord3d) && (
            <div className={`controls__section controls__section--film${readyToCreate ? ' controls__section--emphasize' : ''}`}>
              <span className="controls__section-title">Film</span>
              <div className="controls__section-row">
              {FILM_HD_AVAILABLE && (
                <>
                  <label
                    className={`controls__film-hd${filmHd ? ' controls__film-hd--on' : ''}`}
                    title="Film en 2560×1440 : plus net sur YouTube, environ deux fois plus lourd et plus long à créer"
                  >
                    <span className="controls__film-hd-title">Qualité YouTube</span>
                    <span className="controls__film-hd-box">
                      <input
                        type="checkbox" checked={filmHd} disabled={filmBusy}
                        onChange={e => { setFilmHd(e.target.checked); setFilmHdState(e.target.checked) }}
                      />
                      1440p
                    </span>
                  </label>
                  <div className="controls__divider" />
                </>
              )}
              {onRecord && (
                <div className="controls__subgroup controls__subgroup--tile" ref={filmGroupRef}>
                  {encoderBroken && !encoderWarnDismissed && !filmBusy && (
                    <AnchoredBubble icon="⚠️" onClose={() => setEncoderWarnDismissed(true)} anchorRef={filmGroupRef}>
                      Ce navigateur ne parvient pas à encoder la vidéo : la création des films risque d'échouer.
                      Mettez-le à jour ou essayez Chrome ou Edge à jour ; l'album-photo, lui, fonctionne normalement.
                    </AnchoredBubble>
                  )}
                  {wizardHintAt === 'film' && (
                    <AnchoredBubble icon="✏️" onClose={() => setWizardHintAt(null)} anchorRef={filmGroupRef}>
                      Terminez d'abord la validation des panneaux : cliquez sur Terminer en bas de la liste
                    </AnchoredBubble>
                  )}
                  {showExportHint && !filmBusy && onDismissExportHint && !wizardInProgress && !(encoderBroken && !encoderWarnDismissed) && (
                    <AnchoredBubble icon="🎬" onClose={onDismissExportHint} anchorRef={filmGroupRef}>
                      Vous pouvez maintenant créer votre film ou votre album-photo souvenir.
                    </AnchoredBubble>
                  )}
                  <div className="ctrl-tile">
                    <span className="ctrl-tile__label">
                      {recState === 'idle' && lastFilmUrl ? 'Voir le film 2D'
                        : recState === 'recording' ? 'Arrêter'
                        : recState === 'processing' ? 'Traitement…'
                        : 'Film 2D'}
                    </span>
                    <button
                      className={`ctrl-btn ctrl-btn--film-icon${recState === 'recording' ? ' active' : ''}`}
                      onClick={recState === 'idle' && lastFilmUrl ? () => onViewFilm?.('2d') : recState === 'idle' && wizardInProgress ? () => setWizardHintAt('film') : !hasChoice ? () => setShowCharacterBlockedHint(true) : !trackSaved ? () => setShowSaveRequiredPopup(true) : onRecord}
                      disabled={recState === 'processing'}
                      title={
                        recState === 'idle' && lastFilmUrl ? 'Voir le film 2D créé'
                        : recState === 'idle' && wizardInProgress ? 'Terminez d\'abord la validation des panneaux'
                        : !hasChoice ? 'Choisissez d\'abord un coureur ou le ruban seul'
                        : !trackSaved ? 'Enregistrez d\'abord ce tracé dans un sillon'
                        : recState === 'idle' ? 'Créer le film 2D'
                        : recState === 'recording' ? 'Arrêter et télécharger'
                        : 'Traitement…'
                      }
                    >
                      <FilmIcon size={28} />
                    </button>
                  </div>
                </div>
              )}

              <div className="controls__divider" />

              {onRecord3d && (
                <div className="controls__subgroup controls__subgroup--tile">
                  <div className="ctrl-tile">
                    <span className="ctrl-tile__label">
                      {rec3dState === 'idle' && lastFilm3dUrl ? 'Voir le film 3D'
                        : rec3dState === 'recording' ? 'Arrêter'
                        : rec3dState === 'processing' ? 'Traitement…'
                        : 'Film 3D'}
                    </span>
                    <button
                      className={`ctrl-btn ctrl-btn--film-icon ctrl-btn--film3d-icon${rec3dState === 'recording' ? ' active' : ''}`}
                      onClick={rec3dState === 'idle' && lastFilm3dUrl ? () => onViewFilm?.('3d') : rec3dState === 'idle' && wizardInProgress ? () => { onFilm3dIntent?.(); setWizardHintAt('film') } : !hasChoice ? () => { onFilm3dIntent?.(); setShowCharacterBlockedHint(true) } : !trackSaved ? () => { onFilm3dIntent?.(); setShowSaveRequiredPopup(true) } : onRecord3d}
                      disabled={rec3dState === 'processing'}
                      title={
                        rec3dState === 'idle' && lastFilm3dUrl ? 'Voir le film 3D créé'
                        : rec3dState === 'idle' && wizardInProgress ? 'Terminez d\'abord la validation des panneaux'
                        : !hasChoice ? 'Choisissez d\'abord un coureur ou le ruban seul'
                        : !trackSaved ? 'Enregistrez d\'abord ce tracé dans un sillon'
                        : rec3dState === 'idle' ? 'Créer le film 3D (survol du relief)'
                        : rec3dState === 'recording' ? 'Annuler le rendu'
                        : 'Traitement…'
                      }
                    >
                      <FilmIcon size={28} />
                    </button>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}

          {/* "Créer mon affiche" — bouton nu, dernier groupe de la rangée */}
          {onAlbum && (
            <div className={`ctrl-tile controls__album-tile${readyToCreate ? ' controls__album-tile--emphasize' : ''}`}>
              <span className="ctrl-tile__label">Créer mon affiche</span>
              <button className="ctrl-btn ctrl-btn--album-icon" onClick={onAlbum} title="Créer l'affiche de ma course">
                <AlbumIcon size={28} />
              </button>
            </div>
          )}
          </div>

      </div>
    </div>

    {showSaveRequiredPopup && (
      <div className="preview-required-overlay" onClick={() => setShowSaveRequiredPopup(false)}>
        <div className="preview-required-popup" onClick={e => e.stopPropagation()}>
          <p className="preview-required-popup__icon">💾</p>
          <p className="preview-required-popup__title">Enregistrez d'abord ce tracé</p>
          <p className="preview-required-popup__msg">
            Le film est rangé dans votre sillon, et « Voir le film » vous y renvoie ensuite pour
            ajouter une bande-son. Enregistrez ce tracé pour continuer.
          </p>
          <button
            className="preview-required-popup__close"
            onClick={() => { setShowSaveRequiredPopup(false); onSaveTrack?.() }}
          >
            Enregistrer le tracé
          </button>
        </div>
      </div>
    )}

    </>
  )
}
