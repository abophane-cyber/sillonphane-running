import { useState } from 'react'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { FileOpener } from '@capacitor-community/file-opener'
import { useAppUpdateCheck } from '../hooks/useAppUpdateCheck'

const APK_FILENAME = 'sillonphane-rando.apk'
const APK_URL = 'https://sillonphane.fr/rando/downloads/sillonphane-rando.apk'
// versionCode que l'utilisateur a explicitement masqué : la bannière ne réapparaît que pour une
// version STRICTEMENT plus récente que celle-ci.
const DISMISS_KEY = 'sillon-update-dismissed'

function readDismissed(): number {
  try { return Number(localStorage.getItem(DISMISS_KEY)) || 0 } catch { return 0 }
}

export function UpdatePrompt() {
  const latestVersionCode = useAppUpdateCheck()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(false)

  if (latestVersionCode == null || latestVersionCode <= dismissed) return null

  const hide = () => {
    setDismissed(latestVersionCode)
    try { localStorage.setItem(DISMISS_KEY, String(latestVersionCode)) } catch { /* stockage indisponible */ }
  }

  // Essais précédents qui n'aboutissent pas à l'installeur Android (diagnostiqués via adb logcat) :
  // - `window.open(url, '_system')` délègue au navigateur système par défaut, qui peut réutiliser
  //   un onglet déjà ouvert sur un tout autre site au lieu de naviguer vers l'APK.
  // - `Share.share(...)` (feuille de partage) envoie un intent ACTION_SEND : le Gestionnaire de
  //   paquets Android ne s'y inscrit pas (seul ACTION_VIEW le fait), donc il n'apparaît jamais
  //   parmi les cibles — Chrome, choisi à la place, se contente de re-télécharger le fichier dans
  //   ses propres téléchargements sans jamais proposer d'installer.
  // - `fetch()` + écriture (même en flux, par morceaux) : le fetch de l'appli passe par le plugin
  //   CapacitorHttp, qui rebuffériste la réponse entière côté natif avant de la relivrer au JS —
  //   `response.body.getReader()` ne renvoie donc qu'un seul gros morceau, et convertir ~50 Mo en
  //   base64 d'un coup fait déborder le tas du WebView (OutOfMemoryError constaté en test).
  // `Filesystem.downloadFile` télécharge et écrit sur le disque entièrement côté natif, sans jamais
  // faire transiter les octets par le pont JS/base64 : plus de limite de mémoire liée à la taille
  // du fichier. On ouvre ensuite l'APK avec FileOpener (ACTION_VIEW + type MIME
  // application/vnd.android.package-archive), ce que le Gestionnaire de paquets gère : Android
  // affiche directement l'écran d'installation (au premier lancement, un aller-retour vers
  // « Autoriser cette source » peut apparaître — normal pour un APK hors Play Store).
  async function handleUpdate() {
    if (downloading) return
    setDownloading(true)
    setError(false)
    try {
      await Filesystem.downloadFile({ url: APK_URL, path: APK_FILENAME, directory: Directory.Cache })
      // downloadFile ne renvoie qu'un `path` (parfois relatif selon la plateforme) : on redemande
      // l'URI file:// canonique du fichier écrit, celle qu'attend FileOpener.
      const { uri } = await Filesystem.getUri({ path: APK_FILENAME, directory: Directory.Cache })
      await FileOpener.open({ filePath: uri, contentType: 'application/vnd.android.package-archive' })
    } catch (e) {
      console.error('[UpdatePrompt] téléchargement/ouverture échoués :', e instanceof Error ? e.message : String(e))
      setError(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="pwa-prompt pwa-prompt--update">
      <button className="pwa-prompt__main" onClick={handleUpdate} disabled={downloading}>
        <span className="pwa-prompt__text">
          {downloading ? 'Téléchargement en cours…'
            : error ? 'Échec du téléchargement — réessayer'
            : "Une nouvelle version de l'appli est disponible"}
        </span>
        <span className="pwa-prompt__btn">{downloading ? '…' : 'Mettre à jour'}</span>
      </button>
      <button className="pwa-prompt__close" onClick={hide} aria-label="Masquer" disabled={downloading}>✕</button>
    </div>
  )
}
