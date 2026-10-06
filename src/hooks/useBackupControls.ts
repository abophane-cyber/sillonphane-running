import { useRef, useState } from 'react'
import { prepareBackup, saveBackup, importAllBackup, type PreparedBackup } from '../lib/voyageDB'
import type { BackupProgress } from '../components/BackupOverlay'

interface Options {
  /** Reçoit le nombre de sillons restaurés après un import réussi, pour rafraîchir l'état local de l'appelant. */
  onImported?: (count: number) => void | Promise<void>
  /** Appelé après une sauvegarde ou une restauration réussie (ex. rafraîchir un indicateur "dernière sauvegarde"). */
  afterSaved?: () => void
}

/**
 * Sauvegarde/restauration complète — logique partagée par Mes sillons, Créer mon album-photo
 * et l'éditeur d'album (jusqu'ici copiée-collée à l'identique dans les trois, avec le risque que
 * la moindre correction n'atteigne pas toutes les copies).
 */
export function useBackupControls({ onImported, afterSaved }: Options = {}) {
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null)
  const [preparedBackup, setPreparedBackup] = useState<PreparedBackup | null>(null)
  const [savingBackup, setSavingBackup] = useState(false)
  const backupInputRef = useRef<HTMLInputElement>(null)

  async function handleExportBackup() {
    setBackupBusy('export')
    setBackupProgress(null)
    try {
      const prepared = await prepareBackup((done, total) => setBackupProgress({ done, total }))
      setPreparedBackup(prepared)
    } catch {
      alert('Échec de la préparation de la sauvegarde.')
      setBackupBusy(null)
    } finally {
      setBackupProgress(null)
    }
  }

  // Déclenché par un clic direct (pas après un await) : showSaveFilePicker/navigator.share
  // exigent un geste utilisateur récent, expiré si on l'appelait juste après prepareBackup() —
  // d'où la séparation en deux étapes (préparer, puis un second clic pour enregistrer).
  async function handleSaveBackupClick() {
    if (!preparedBackup) return
    setSavingBackup(true)
    try {
      await saveBackup(preparedBackup)
      afterSaved?.()
    } catch {
      alert('Échec de la sauvegarde.')
    } finally {
      setSavingBackup(false)
      setPreparedBackup(null)
      setBackupBusy(null)
    }
  }

  async function handleImportBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBackupBusy('import')
    setBackupProgress(null)
    try {
      const count = await importAllBackup(file, (done, total) => setBackupProgress({ done, total }))
      await onImported?.(count)
      afterSaved?.()
      alert(`${count} sillon${count > 1 ? 's' : ''} restauré${count > 1 ? 's' : ''}.`)
    } catch (err) {
      // Erreur générique affichée à l'utilisateur mais le détail reste en console pour le diagnostic
      // (ex. via chrome://inspect sur l'app Android) — le message alert seul ne suffit pas à distinguer
      // un fichier vraiment invalide d'un bug de décodage.
      console.error('Échec de la restauration :', err)
      // Détail affiché à l'utilisateur : sur smartphone il n'a pas accès à la console pour
      // distinguer un fichier tronqué, trop gros, ou pas une sauvegarde Sillon.
      const detail = err instanceof Error ? err.message : String(err)
      alert(`Restauration impossible.\n\n${detail}`)
    } finally {
      setBackupBusy(null)
      setBackupProgress(null)
    }
  }

  return {
    backupBusy,
    backupProgress,
    preparedBackup,
    backupInputRef,
    handleExportBackup,
    handleSaveBackupClick,
    handleImportBackup,
    /** Prêt à passer à <BackupOverlay {...overlayProps} /> quand backupBusy est vrai. */
    overlayProps: {
      mode: backupBusy ?? undefined,
      progress: backupProgress,
      readyToSave: backupBusy === 'export' && !!preparedBackup && !savingBackup,
      label: savingBackup ? 'Enregistrement du fichier…' : undefined,
      onSaveClick: handleSaveBackupClick,
    },
  }
}
