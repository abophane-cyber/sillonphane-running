import { useState } from 'react'
import { filmFileKind, saveFileWithPicker } from '../lib/saveFile'
import type { FilmKind } from './FilmProgressDock'

/** Film tout juste rendu, gardé en mémoire jusqu'au prochain film ou au prochain tracé. */
export interface ReadyFilm {
  blob: Blob
  name: string
  /** Rangé dans le sillon actif (sinon seul ce blob en mémoire permet de le récupérer). */
  stored: boolean
}

interface Props {
  kind: FilmKind
  film: ReadyFilm
  onViewInSillon: () => void
  onClose: () => void
}

const KIND_LABEL: Record<FilmKind, string> = { '2d': 'Film 2D', '3d': 'Film 3D' }

/**
 * Fenêtre « Film prêt » affichée à la fin du rendu. Le téléchargement part d'un clic sur son
 * bouton : un téléchargement lancé automatiquement plusieurs minutes après le clic sur « Film »
 * était bloqué ou ignoré sans un mot par certains navigateurs (Safari, mobiles), et inerte dans
 * le WebView de l'APK.
 */
export function FilmReadyPopup({ kind, film, onViewInSillon, onClose }: Props) {
  const [saving, setSaving] = useState(false)

  async function handleDownload() {
    setSaving(true)
    try {
      const result = await saveFileWithPicker(film.blob, film.name, filmFileKind(film.name))
      if (result === 'saved' && film.stored) onClose()
    } catch (e) {
      console.error('[film] téléchargement :', e)
      alert(`Le film n'a pas pu être téléchargé : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="preview-required-overlay" onClick={onClose}>
      <div className="preview-required-popup" onClick={e => e.stopPropagation()}>
        <p className="preview-required-popup__icon">🎬</p>
        <p className="preview-required-popup__title">{KIND_LABEL[kind]} prêt</p>
        <p className="preview-required-popup__msg">
          {film.stored
            ? 'Il est rangé dans votre sillon. Vous pouvez aussi le télécharger dès maintenant.'
            : "Il n'a pas pu être rangé dans votre sillon (espace de stockage insuffisant sur cet appareil ?). Téléchargez-le maintenant pour le garder."}
        </p>
        <div className="film-ready-popup__actions">
          <button className="preview-required-popup__close" onClick={handleDownload} disabled={saving}>
            {saving ? 'Préparation…' : '⬇ Télécharger le film'}
          </button>
          {film.stored && (
            <button className="film-ready-popup__secondary" onClick={onViewInSillon}>Voir dans Mes sillons</button>
          )}
          <button className="film-ready-popup__secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}
