import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { BackgroundGeolocationPlugin, Location, CallbackError } from '@capacitor-community/background-geolocation'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

// Ouvre l'écran des paramètres de l'appli (d'où l'utilisateur peut accéder à Batterie → Sans
// restriction, et à Autorisations → Position → Toujours autoriser) — utile car Android étrangle
// ou tue le suivi GPS en arrière-plan si l'optimisation de batterie ou la restriction de
// position restent actives pour l'appli.
export function openAppSettings(): Promise<void> {
  return BackgroundGeolocation.openSettings()
}

// Demande la permission de localisation en arrière-plan (ACCESS_BACKGROUND_LOCATION, « Autoriser
// tout le temps »). Sans elle, Android 10+ ne délivre que quelques relevés par heure dès que
// l'appli n'est plus au premier plan — le tracé enregistré se réduisait alors à quelques points.
// Le plugin d'origine ne la demande jamais ; méthode ajoutée par patch (voir patches/).
// Sur Android 11+, le système n'ouvre pas de dialogue mais l'écran de réglages : l'appelant
// (RecordScreen) propose alors un bouton « Ouvrir les paramètres » si le retour est { granted:false }.
// Renvoie true hors natif (rien à demander) ou si la méthode patchée est absente (ancien build).
export async function requestBackgroundLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    const plugin = BackgroundGeolocation as unknown as {
      requestBackgroundPermission?: () => Promise<{ granted?: boolean }>
    }
    if (typeof plugin.requestBackgroundPermission !== 'function') return true
    const res = await plugin.requestBackgroundPermission()
    return res?.granted === true
  } catch (e) {
    console.error('[geoBackend] requestBackgroundPermission :', e instanceof Error ? e.message : String(e))
    return false
  }
}

interface DrainedLocation {
  latitude: number
  longitude: number
  altitude: number | null
  accuracy: number | null
  time: number
  baroGain?: number | null
  baroLoss?: number | null
}

// Récupère (et vide côté natif) les positions que le foreground service a écrites sur disque
// pendant que l'Activity Android était détruite — l'appli en arrière-plan/verrouillée : le service
// GPS continue de tourner mais la WebView n'existe plus pour recevoir les positions en direct.
// Sans ce rattrapage, tout ce tronçon (potentiellement des heures de marche) était perdu.
// Renvoie [] sur le web ou si le pont natif n'expose pas la méthode (ancienne version du plugin).
export async function drainNativeGeoBuffer(): Promise<GeoFix[]> {
  if (!Capacitor.isNativePlatform()) return []
  try {
    const plugin = BackgroundGeolocation as unknown as {
      drainBufferedLocations?: () => Promise<{ locations?: DrainedLocation[] }>
    }
    if (typeof plugin.drainBufferedLocations !== 'function') return []
    const res = await plugin.drainBufferedLocations()
    const locations = res?.locations ?? []
    return locations
      .filter(l => l && Number.isFinite(l.latitude) && Number.isFinite(l.longitude) && Number.isFinite(l.time))
      .map(l => ({
        lat: l.latitude,
        lon: l.longitude,
        ele: l.altitude ?? 0,
        time: l.time,
        accuracy: l.accuracy ?? undefined,
        baroGain: l.baroGain ?? undefined,
        baroLoss: l.baroLoss ?? undefined,
      }))
  } catch (e) {
    console.error('[geoBackend] échec drainBufferedLocations :', e instanceof Error ? e.message : String(e))
    return []
  }
}

export interface GeoFix {
  lat: number
  lon: number
  ele: number
  time: number
  accuracy?: number
  // Dénivelé barométrique cumulé depuis le début du suivi (gain / perte, mètres), calculé
  // nativement par le service. Absent si l'appareil n'a pas de capteur de pression → le moteur
  // retombe sur l'altitude GPS. Cumulé, pas incrémental : le moteur en fait la différence.
  baroGain?: number
  baroLoss?: number
}

export interface GeoBackend {
  watch(onFix: (fix: GeoFix) => void, onError: (message: string) => void): Promise<void>
  clear(): Promise<void>
}

// Backend web : navigator.geolocation. Ne fonctionne de façon fiable qu'au premier plan, écran allumé —
// le navigateur suspend ce contexte JS dès que l'onglet passe en arrière-plan ou que l'écran se verrouille.
function createWebBackend(): GeoBackend {
  let watchId: number | null = null
  return {
    async watch(onFix, onError) {
      if (!('geolocation' in navigator)) {
        onError("La géolocalisation n'est pas disponible sur cet appareil.")
        return
      }
      watchId = navigator.geolocation.watchPosition(
        pos => onFix({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          ele: pos.coords.altitude ?? 0,
          time: pos.timestamp,
          accuracy: pos.coords.accuracy,
        }),
        err => onError(err.message),
        { enableHighAccuracy: true, maximumAge: 0 },
      )
    },
    async clear() {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
        watchId = null
      }
    },
  }
}

// Backend natif (Capacitor Android/iOS) : foreground service avec notification persistante,
// continue de tourner écran éteint — même principe qu'OpenTracks. Le plugin n'a aucune option
// de synchronisation réseau : tout reste sur l'appareil.
function createNativeBackend(): GeoBackend {
  let watcherId: string | null = null
  return {
    async watch(onFix, onError) {
      try {
        // Android 13+ : sans la permission POST_NOTIFICATIONS, le service au premier plan
        // ne peut pas afficher sa notification persistante et Android le tue silencieusement
        // dès que l'appli passe en arrière-plan — d'où l'enregistrement qui s'arrête.
        await LocalNotifications.requestPermissions()
        watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundTitle: 'Sillonphane enregistre votre parcours',
            backgroundMessage: "Suivi GPS en cours — appuyez pour revenir à l'application",
            requestPermissions: true,
            stale: false,
            // Volontairement 0 (pas de filtre au niveau du GPS natif) : la détection d'arrêt de
            // GpsRecordingEngine a besoin d'un relevé régulier même à l'arrêt pour mesurer le
            // temps écoulé sans mouvement. Le filtrage à 10m entre deux points du tracé stocké
            // (RECORD_DISTANCE_M) est fait plus haut, dans le moteur, sans priver ce dernier des
            // relevés bruts nécessaires au calcul de distance/dénivelé/repos en temps réel.
            distanceFilter: 0,
          },
          (location?: Location, error?: CallbackError) => {
            if (error) {
              onError(error.message)
              return
            }
            if (!location) return
            // baroGain / baroLoss : ajoutés au payload par le plugin patché (extras du broadcast),
            // absents du typage Location d'origine → accès non typé.
            const baro = location as unknown as { baroGain?: number; baroLoss?: number }
            onFix({
              lat: location.latitude,
              lon: location.longitude,
              ele: location.altitude ?? 0,
              time: location.time ?? Date.now(),
              accuracy: location.accuracy,
              baroGain: baro.baroGain,
              baroLoss: baro.baroLoss,
            })
          },
        )
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e))
      }
    },
    async clear() {
      if (watcherId !== null) {
        const id = watcherId
        watcherId = null
        try {
          await BackgroundGeolocation.removeWatcher({ id })
        } catch (e) {
          // Sans ce catch, un rejet ici (ex. service natif pas encore lié) remontait comme une
          // "Unhandled Promise Rejection" illisible ([object Object]) côté logcat, et surtout
          // laissait le service/la notification tourner sans possibilité de le savoir depuis l'UI.
          console.error('[geoBackend] échec removeWatcher :', e instanceof Error ? e.message : String(e))
        }
      }
    },
  }
}

export function createGeoBackend(): GeoBackend {
  return Capacitor.isNativePlatform() ? createNativeBackend() : createWebBackend()
}
