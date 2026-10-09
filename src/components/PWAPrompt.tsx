import { Capacitor } from '@capacitor/core'
import { usePWA } from '../hooks/usePWA'
import { isAndroidBrowser } from '../lib/device'

export function PWAPrompt() {
  const { canInstall, install } = usePWA()

  // Sur Android (hors appli déjà installée), la PWA seule ne permet pas l'enregistrement GPS
  // écran éteint/appli fermée — on pousse vers l'APK plutôt que l'installation PWA.
  if (isAndroidBrowser() && !Capacitor.isNativePlatform()) {
    return (
      <a className="pwa-prompt" href={`${import.meta.env.BASE_URL}downloads/sillonphane-running.apk`} download>
        <span className="pwa-prompt__text">Télécharger l'appli Android (recommandé)</span>
        <span className="pwa-prompt__btn">Télécharger</span>
      </a>
    )
  }

  if (canInstall) {
    return (
      <div className="pwa-prompt">
        <span className="pwa-prompt__text">Installer l'application</span>
        <button className="pwa-prompt__btn" onClick={install}>
          Installer
        </button>
      </div>
    )
  }

  return null
}
