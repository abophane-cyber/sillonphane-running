import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { NATIVE_VERSION_CODE } from '../nativeVersion'

// Uniquement pour l'APK natif : la version web se met à jour seule via le service worker PWA.
// L'APK n'a pas d'auto-update (distribution hors Play Store), donc on vérifie nous-mêmes en
// comparant NATIVE_VERSION_CODE (figé dans ce build) au fichier public/downloads/version.json,
// mis à jour à chaque reconstruction de l'APK.
//
// URL absolue obligatoire : dans l'APK, l'appli tourne sur l'origine locale du bundle embarqué
// (pas sur sillonphane.fr/running), et android:sync supprime dist/downloads avant l'empaquetage — un
// fetch relatif (`${import.meta.env.BASE_URL}downloads/version.json`) échouerait donc toujours en silence (404 local).
//
// Domaine SANS www obligatoire : www.sillonphane.fr/running fait un 308 vers sillonphane.fr/running, et cette
// redirection ne porte pas d'en-tête CORS — un fetch cross-origin (mode 'cors' par défaut) échoue
// alors silencieusement ("Failed to fetch") en suivant la redirection, même si la réponse finale
// a bien Access-Control-Allow-Origin. Cibler l'apex directement évite la redirection.
const VERSION_URL = 'https://sillonphane.fr/running/downloads/version.json'

// Renvoie le versionCode en ligne s'il est plus récent que le build installé, sinon null.
// (Avant : un booléen — mais l'appelant a besoin du numéro pour mémoriser un « masquer » ciblé.)
export function useAppUpdateCheck(): number | null {
  const [latestVersionCode, setLatestVersionCode] = useState<number | null>(null)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    // Version Play Store (npm run android:play) : c'est le Store qui met à jour, et Google interdit
    // de proposer une installation hors Store (l'APK du site, signé autrement, échouerait de toute façon).
    if (import.meta.env.VITE_DISTRIBUTION === 'play') return

    fetch(VERSION_URL, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { versionCode?: number } | null) => {
        if (data?.versionCode && data.versionCode > NATIVE_VERSION_CODE) {
          setLatestVersionCode(data.versionCode)
        }
      })
      .catch(() => {
        // Pas de réseau ou site injoignable : on ne bloque rien, on réessaiera au prochain lancement.
      })
  }, [])

  return latestVersionCode
}
