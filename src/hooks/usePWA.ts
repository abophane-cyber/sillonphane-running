import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isAndroidBrowser } from '../lib/device'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePWA() {
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      // Sur Android, la PWA ne permet pas l'enregistrement GPS écran éteint/appli fermée
      // (contrairement à l'APK) : on n'y propose donc plus l'installation PWA — PWAPrompt affiche
      // à la place un lien de téléchargement de l'APK (voir isAndroidBrowser).
      if (isAndroidBrowser()) return
      installPromptRef.current = e as BeforeInstallPromptEvent
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setCanInstall(false))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!installPromptRef.current) return
    await installPromptRef.current.prompt()
    const { outcome } = await installPromptRef.current.userChoice
    if (outcome === 'accepted') {
      installPromptRef.current = null
      setCanInstall(false)
    }
  }

  // registerType 'autoUpdate' : le nouveau SW s'active seul et recharge la page. useRegisterSW ne
  // vérifie une nouvelle version qu'une fois, au chargement — si l'appli reste ouverte (ou repasse
  // au premier plan) sans rechargement complet, un déploiement plus récent peut ne jamais être
  // détecté. On revérifie donc périodiquement tant que l'onglet est visible, et à chaque retour au
  // premier plan.
  useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const checkForUpdate = () => { if (document.visibilityState === 'visible') registration.update() }
      setInterval(checkForUpdate, 60 * 1000)
      document.addEventListener('visibilitychange', checkForUpdate)
    },
  })

  return { canInstall, install }
}
