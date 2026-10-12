import type { useBackupControls } from '../hooks/useBackupControls'
import { BackupOverlay } from './BackupOverlay'
import './BackupTools.css'

interface Props {
  /** Contrôles de sauvegarde de la page (useBackupControls), partagés avec ses autres boutons éventuels. */
  backup: ReturnType<typeof useBackupControls>
}

/** « Sauvegarder » et « Restaurer » en haut à droite de la page (Mes sillons, un sillon, le livre et sa mise en
 *  page) : sur la photo à droite, ou au-dessus du contenu, alignés à droite, quand la place manque. */
export function BackupTools({ backup }: Props) {
  const { backupBusy, backupInputRef, handleExportBackup, handleImportBackup, overlayProps } = backup
  return (
    <>
      <div className="backup-tools">
        <input ref={backupInputRef} type="file" accept="application/zip,.zip,application/json,.json,.txt,text/plain" style={{ display: 'none' }} onChange={handleImportBackup} />
        <button type="button" className="backup-tools__btn" disabled={!!backupBusy} onClick={handleExportBackup}
          title="Enregistre tous vos sillons (tracés, photos, films) dans un fichier — à déposer dans un dossier synchronisé (pCloud, Drive, OneDrive…) pour le retrouver sur un autre appareil">
          💾 Sauvegarder
        </button>
        <button type="button" className="backup-tools__btn" disabled={!!backupBusy} onClick={() => backupInputRef.current?.click()}
          title="Restaure les sillons depuis un fichier de sauvegarde">
          📂 Restaurer
        </button>
      </div>
      {backupBusy && <BackupOverlay {...overlayProps} />}
    </>
  )
}
