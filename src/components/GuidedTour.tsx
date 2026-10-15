import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CHARACTER_FACE, CHARACTER_IDS } from '../lib/characters'

// Calque de guidage « bulle de BD » de l'écran d'animation : une seule bulle,
// montée en permanence tant que le calque est actif, qui glisse d'une zone à
// l'autre au fil de la progression (transition CSS sur left/top). Voir
// AnimateScreen pour l'activation/désactivation (localStorage) et le repli sur
// les bulles historiques quand le calque est masqué.

// Pas d'étape « aperçu » : il est facultatif pour créer les films.
type Step = 'intro' | 'panels' | 'characters' | 'create'
const STEPS: Step[] = ['intro', 'panels', 'characters', 'create']

const STEP_TEXT: Record<Step, ReactNode> = {
  intro:
    "Ici vous allez animer votre parcours. Cette étape est nécessaire pour créer " +
    "votre film et la première page de votre album-photo.",
  panels: (
    <>
      D'abord, choisissez les panneaux que vous souhaitez voir. Vous pouvez aussi
      les modifier ou en ajouter.{' '}
      <strong className="guided-tour__mark">Important</strong> : cliquez sur
      «&nbsp;Terminer&nbsp;» en bas de la fenêtre.
    </>
  ),
  characters: "Choisissez votre personnage pour le film.",
  create:
    "Et voilà ! Vous pouvez maintenant créer votre film 2D ou 3D, ou composer " +
    "votre album-photo.",
}

const INTRO_SEEN_KEY = 'running:sillon.animGuide.introSeen'

// Personnage illustrant la bulle à chaque étape : un différent par étape (portraits
// pré-cadrés, voir CHARACTER_FACE), et tous réunis à la dernière étape. Les personnages sans portrait sont omis.
const FACES = CHARACTER_IDS.flatMap(id => CHARACTER_FACE[id] ?? [])
const STEP_FACES: Record<Step, string[]> = {
  intro: FACES.slice(0, 1),
  panels: FACES.slice(1, 2),
  characters: FACES.slice(2, 3),
  create: FACES,
}

interface Props {
  wizardDone: boolean
  charactersChosen: boolean
  previewFinished: boolean
  /** « Ruban seul » proposé à côté des personnages : l'étape « personnages » le mentionne. */
  ribbonOption?: boolean
  /** Tracé déjà rangé dans un sillon : l'étape « création » ne demande plus de l'enregistrer. */
  trackSaved?: boolean
  /** Rejeu du guide sur l'étape « panneaux » alors que l'assistant est déjà terminé (donc fermé) : le rouvre, pour
   * que le « Terminer » demandé par la bulle existe. */
  onReopenPanels?: () => void
  // Incrémenté par le bouton « Revoir le guide » du header : rejoue la visite
  // depuis la toute première bulle.
  replayNonce: number
  onClose: () => void
}

interface Pos {
  cx: number
  cy: number
  arrow: 'down' | 'left' | 'right' | 'none'
  arrowAt: number
}

export function GuidedTour({
  wizardDone, charactersChosen, previewFinished, ribbonOption = false, trackSaved = false, onReopenPanels, replayNonce, onClose,
}: Props) {
  // L'intro n'a de sens qu'une fois par session : après « Suivant » (ou une visite
  // précédente) on démarre directement sur l'étape « panneaux ».
  const [introDismissed, setIntroDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(INTRO_SEEN_KEY) === '1' } catch { return false }
  })

  // Mode « rejeu » : déclenché par le bouton « Revoir le guide » du header, il
  // repart de la toute première bulle et avance manuellement (Suivant) d'une étape
  // à l'autre, sans tenir compte de la progression réelle.
  // - nonce > 0 au montage : le calque vient d'être rouvert par ce bouton (seule
  //   voie de réactivation), on démarre donc en rejeu ;
  // - nonce qui change alors que le calque est déjà affiché : on relance le rejeu.
  // Adaptation d'état pendant le rendu (motif React) : pas d'effet, pas de ref.
  const [replaySeen, setReplaySeen] = useState(replayNonce)
  // « Suivant » cliqué à l'étape « panneaux » alors que l'assistant n'est pas terminé : la bulle se change en rappel.
  const [terminerNudge, setTerminerNudge] = useState(false)
  const [replayStep, setReplayStep] = useState<Step | null>(replayNonce > 0 ? 'intro' : null)
  // Suivi des signaux de progression pour détecter le *moment* où l'utilisateur
  // franchit une étape (ex. clic sur « Terminer » dans l'assistant des panneaux) :
  // en rejeu, la bulle glisse alors vers l'étape suivante sans attendre « Suivant ».
  // On ne réagit qu'à la transition (false→true), pas à un état déjà acquis, pour
  // ne pas sauter des bulles quand tout est déjà fait.
  const [prevDone, setPrevDone] = useState({ wizardDone, charactersChosen, previewFinished })
  const progressChanged =
    prevDone.wizardDone !== wizardDone ||
    prevDone.charactersChosen !== charactersChosen ||
    prevDone.previewFinished !== previewFinished
  if (progressChanged) setPrevDone({ wizardDone, charactersChosen, previewFinished })

  if (replayNonce !== replaySeen) {
    setReplaySeen(replayNonce)
    setReplayStep('intro')
    setTerminerNudge(false)
  } else if (replayStep === 'panels' && wizardDone && !prevDone.wizardDone) {
    setReplayStep('characters')
  } else if (replayStep === 'characters' && charactersChosen && !prevDone.charactersChosen) {
    setReplayStep('create')
  }

  // Étape dérivée de la progression réelle : la bulle suit l'état, en avant comme
  // en arrière (ex. retour à la validation des panneaux).
  const derivedStep: Step =
    previewFinished ? 'create'
    : wizardDone && charactersChosen ? 'create'
    : wizardDone ? 'characters'
    : introDismissed ? 'panels'
    : 'intro'

  const replaying = replayStep !== null
  const step: Step = replayStep ?? derivedStep

  function nextFromIntro() {
    try { sessionStorage.setItem(INTRO_SEEN_KEY, '1') } catch { /* stockage indispo */ }
    setIntroDismissed(true)
  }

  // Rejeu à l'étape « panneaux » avec l'assistant déjà terminé : on le rouvre pour que « Terminer » soit cliquable.
  useEffect(() => {
    if (replaying && step === 'panels' && wizardDone) onReopenPanels?.()
    // Seulement à l'arrivée sur l'étape (pas à chaque changement de wizardDone : « Terminer » le repasse à vrai).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaying, step])

  function replayAdvance() {
    // Impossible de passer aux personnages sans avoir cliqué sur « Terminer » : la bulle demande de le faire.
    // Le panneau descend tout seul jusqu'au bouton, souvent caché sous la liste des lieux.
    if (step === 'panels' && !wizardDone) {
      setTerminerNudge(true)
      const card = document.querySelector('.pwiz-card')
      card?.scrollTo({ top: card.scrollHeight, behavior: 'smooth' })
      return
    }
    const i = STEPS.indexOf(step)
    if (i < STEPS.length - 1) setReplayStep(STEPS[i + 1])
    else { setReplayStep(null); onClose() }
  }

  function handleClose() {
    setReplayStep(null)
    onClose()
  }

  const bubbleRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos>(() => ({
    cx: window.innerWidth / 2, cy: window.innerHeight * 0.46, arrow: 'none', arrowAt: 0,
  }))

  useEffect(() => {
    function rect(sel: string): DOMRect | null {
      const el = document.querySelector(sel)
      return el ? el.getBoundingClientRect() : null
    }
    function measure() {
      const bubble = bubbleRef.current
      const bw = bubble?.offsetWidth ?? 320
      const bh = bubble?.offsetHeight ?? 160
      const vw = window.innerWidth
      const vh = window.innerHeight
      const GAP = 16
      const center = (): Pos => ({ cx: vw / 2, cy: vh * 0.46, arrow: 'none', arrowAt: 0 })

      let next: Pos | null

      if (step === 'intro') {
        next = center()
      } else if (step === 'panels') {
        // La carte des panneaux est ancrée en haut à droite : on pose la bulle dans
        // l'espace libre à sa gauche, la flèche pointant vers elle. En rejeu après
        // coup, la carte est refermée : on vise alors le bouton « Panneaux ».
        const r = rect('.pwiz-card') ?? rect('.pwiz-reopen-btn')
        if (!r) {
          next = center()
        } else {
          const targetCy = r.top + Math.min(r.height / 2, 130)
          const topLimit = bh / 2 + 18 // garde la croix hors du bord haut
          const cy = Math.max(topLimit, Math.min(vh - bh / 2 - 8, targetCy))
          const cxLeft = r.left - GAP - bw / 2
          if (cxLeft >= bw / 2 + 8) {
            next = {
              cx: cxLeft, cy, arrow: 'right',
              arrowAt: Math.max(16, Math.min(bh - 16, targetCy - (cy - bh / 2))),
            }
          } else {
            // Écran étroit : au-dessus de la carte.
            next = {
              cx: Math.max(bw / 2 + 8, Math.min(vw - bw / 2 - 8, r.left + r.width / 2)),
              cy: Math.max(topLimit, r.top - GAP - bh / 2),
              arrow: 'none', arrowAt: 0,
            }
          }
        }
      } else {
        // characters / create — ancrés au-dessus de la barre de contrôle
        let targetCx: number | null = null
        let targetTop: number | null = null
        if (step === 'create') {
          const film = rect('.controls__section--film')
          const album = rect('.controls__album-tile')
          if (film && album) { targetCx = (film.right + album.left) / 2; targetTop = Math.min(film.top, album.top) }
          else if (film) { targetCx = film.left + film.width / 2; targetTop = film.top }
          else if (album) { targetCx = album.left + album.width / 2; targetTop = album.top }
        } else {
          const r = rect(step === 'characters' ? '.controls__group--character' : '.controls__section--nav')
          if (r) { targetCx = r.left + r.width / 2; targetTop = r.top }
        }
        if (targetCx == null || targetTop == null) {
          next = null // cible pas encore montée : on garde la position courante
        } else {
          // On remonte la bulle au-dessus de toute la barre de contrôle (et du
          // mini-profil d'altitude s'il est affiché pendant la lecture) pour ne
          // masquer ni les stats ni le graphe.
          const bar = rect('.controls')
          const mini = document.querySelector('.elev-minimap-overlay:not(.elev-minimap-overlay--hidden)')
          const miniTop = mini ? mini.getBoundingClientRect().top : Infinity
          const ceiling = Math.min(targetTop, bar ? bar.top : targetTop, miniTop)
          const cx = Math.max(bw / 2 + 8, Math.min(vw - bw / 2 - 8, targetCx))
          const cy = Math.max(bh / 2 + 8, ceiling - GAP - bh / 2)
          next = {
            cx, cy, arrow: 'down',
            arrowAt: Math.max(20, Math.min(bw - 20, targetCx - (cx - bw / 2))),
          }
        }
      }

      if (!next) return
      const n = next
      setPos(prev =>
        Math.abs(prev.cx - n.cx) < 0.5 && Math.abs(prev.cy - n.cy) < 0.5 &&
        prev.arrow === n.arrow && Math.abs(prev.arrowAt - n.arrowAt) < 0.5
          ? prev : n,
      )
    }

    measure()
    const raf = requestAnimationFrame(measure)
    const id = window.setInterval(measure, 120)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [step])

  return createPortal(
    <div
      ref={bubbleRef}
      className="guided-tour"
      style={{ '--gt-x': `${pos.cx}px`, '--gt-y': `${pos.cy}px` } as CSSProperties}
      role="dialog"
      aria-live="polite"
    >
      <button className="guided-tour__close" onClick={handleClose} aria-label="Masquer le guide">✕</button>
      <div className="guided-tour__inner">
        <span className={`guided-tour__fig${STEP_FACES[step].length > 1 ? ' guided-tour__fig--group' : ''}`}>
          {STEP_FACES[step].map(src => <img key={src} src={src} alt="" />)}
        </span>
        <div className="guided-tour__body">
          <p className="guided-tour__text">
            {step === 'panels' && replaying && !wizardDone && terminerNudge
              ? 'Cliquez sur « Terminer » en bas de la fenêtre des panneaux pour poursuivre.'
              : step === 'characters' && ribbonOption
              ? 'Choisissez votre personnage, ou le ruban seul.'
              : step === 'create'
                ? (trackSaved
                  ? 'Et voilà ! Vous pouvez créer votre film 2D ou 3D, ou composer votre album-photo. Lancer l\'aperçu est facultatif.'
                  : 'Et voilà ! Enregistrez votre tracé, puis créez votre film 2D ou 3D, ou composez votre album-photo. Lancer l\'aperçu est facultatif.')
                : STEP_TEXT[step]}
          </p>
          {replaying ? (
            // Étape « panneaux » : « Suivant » sans avoir cliqué sur « Terminer » transforme la bulle en rappel « Cliquez sur
            // Terminer pour poursuivre » ; elle avance toute seule dès que l'assistant est terminé.
            step === 'panels' && !wizardDone && terminerNudge ? null : (
              <div className="guided-tour__actions">
                <button className="guided-tour__btn" onClick={replayAdvance}>
                  {step === 'create' ? 'Terminer' : 'Suivant →'}
                </button>
              </div>
            )
          ) : step === 'intro' ? (
            <div className="guided-tour__actions">
              <button className="guided-tour__btn" onClick={nextFromIntro}>Suivant →</button>
            </div>
          ) : step === 'create' ? (
            <div className="guided-tour__actions">
              <button className="guided-tour__btn" onClick={handleClose}>J'ai compris</button>
            </div>
          ) : null}
        </div>
      </div>
      {pos.arrow === 'down' && (
        <span className="guided-tour__arrow guided-tour__arrow--down" style={{ left: pos.arrowAt }} />
      )}
      {pos.arrow === 'left' && (
        <span className="guided-tour__arrow guided-tour__arrow--left" style={{ top: pos.arrowAt }} />
      )}
      {pos.arrow === 'right' && (
        <span className="guided-tour__arrow guided-tour__arrow--right" style={{ top: pos.arrowAt }} />
      )}
    </div>,
    document.body,
  )
}
