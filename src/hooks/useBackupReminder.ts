import { useEffect } from 'react'
import { getBackupStatus } from '../lib/voyageDB'

// Affiche la confirmation native "quitter le site ?" du navigateur quand des changements
// n'ont pas encore été sauvegardés — seul rappel possible avant fermeture (les navigateurs
// modernes ignorent tout message personnalisé dans beforeunload).
export function useBackupReminder() {
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!getBackupStatus().hasPendingChanges) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])
}
