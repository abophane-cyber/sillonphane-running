import { formatEta } from '../lib/exportEta'

export type FilmKind = '2d' | '3d'

const KIND_LABEL: Record<FilmKind, string> = { '2d': 'Film 2D', '3d': 'Film 3D' }

interface Props {
  /** Film en cours de création (null si aucun). */
  running: { kind: FilmKind; progress: number; phase: 'prepare' | 'render' | null; etaS: number | null } | null
  /** Film terminé pendant qu'on était sur une autre page (null si aucun à signaler). */
  done: { kind: FilmKind; saved: boolean } | null
  onOpen: () => void
  onCancel: () => void
  onViewFilm: () => void
  onDismissDone: () => void
}

/**
 * Indicateur flottant de la création d'un film, affiché par-dessus les autres pages (album, Mes
 * sillons…) : le rendu tourne au niveau de l'appli et se poursuit quand on quitte l'écran
 * d'animation, où la fenêtre modale de progression n'est alors plus visible.
 */
export function FilmProgressDock({ running, done, onOpen, onCancel, onViewFilm, onDismissDone }: Props) {
  if (running) {
    const prog = running.progress
    const status = running.phase === 'prepare' ? 'Préparation…'
      : prog >= 1 ? 'Presque prêt…'
      : `${Math.round(Math.abs(prog) * 100)} %${running.etaS != null ? ` · ${formatEta(running.etaS)}` : ''}`
    return (
      <div className="film-dock" role="status" aria-live="polite">
        <button className="film-dock__main" onClick={onOpen} title="Revenir à l'écran du film">
          <span className="film-dock__title">🎬 {KIND_LABEL[running.kind]} en création</span>
          <span className="film-dock__bar-bg">
            <span
              className={`film-dock__bar-fill${prog >= 1 ? ' film-modal__bar-fill--indeterminate' : ''}`}
              style={{ width: `${Math.round(Math.min(1, Math.abs(prog)) * 100)}%` }}
            />
          </span>
          <span className="film-dock__status">{status}</span>
        </button>
        <button className="film-dock__close" onClick={onCancel} title="Annuler la création du film" aria-label="Annuler la création du film">✕</button>
      </div>
    )
  }
  if (done) {
    return (
      <div className="film-dock film-dock--done" role="status" aria-live="polite">
        <button className="film-dock__main" onClick={onViewFilm} title="Voir le film">
          <span className="film-dock__title">✅ {KIND_LABEL[done.kind]} prêt</span>
          <span className="film-dock__status">{done.saved ? 'Rangé dans Mes sillons · ' : ''}Voir le film →</span>
        </button>
        <button className="film-dock__close" onClick={onDismissDone} title="Fermer" aria-label="Fermer">✕</button>
      </div>
    )
  }
  return null
}
