export interface BackupProgress { done: number; total: number }

interface Props {
  mode?: 'export' | 'import'
  /** Libellé personnalisé (ex. export PDF) — sinon déduit de `mode` (sauvegarde/restauration). */
  label?: string
  progress?: BackupProgress | null
  /** Fichier prêt, en attente d'un clic pour déclencher l'enregistrement (voir saveBackup dans voyageDB). */
  readyToSave?: boolean
  onSaveClick?: () => void
}

export function BackupOverlay({ mode, label, progress, readyToSave, onSaveClick }: Props) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
  const text = label ?? (mode === 'export' ? 'Sauvegarde en cours…' : 'Restauration en cours…')
  return (
    <div className="backup-overlay">
      {readyToSave ? (
        <>
          <span className="backup-overlay__label">Fichier prêt</span>
          <button className="backup-overlay__save-btn" onClick={onSaveClick}>💾 Enregistrer</button>
        </>
      ) : (
        <>
          <div className="backup-overlay__spinner">
            {pct !== null && <span className="backup-overlay__pct">{pct}%</span>}
          </div>
          <span className="backup-overlay__label">{text}</span>
        </>
      )}
    </div>
  )
}
