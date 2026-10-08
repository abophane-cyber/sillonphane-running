import { useRef, useState } from 'react'
import { addFilmToVoyage } from '../lib/voyageDB'
import { ANIM_SETTINGS } from './useAnimationSettings'
import { beginExportKeepAlive } from '../lib/exportKeepAlive'
import { localitiesToPanels3d, weatherToScenario, formatTrailDate } from '../lib/terrain3d/appAdapters'
import type { LocalityInfo } from './useLocality'
import type { GpxTrack } from '../types'
import type { WeatherInfo } from '../lib/meteo'
import type { CharacterId } from '../lib/characters'
import type { StreetRun } from '../lib/routeStreets'
import type { Borne, EndCard, Ravito } from '../lib/raceSplits'
import type { EventCartouche } from '../lib/filmExport'
import { ESSAI_FILM_S, essaiPortion, isEssaiFilm } from '../lib/filmEssai'
import { captionStreets } from '../lib/routeStreets'

export interface CreateFilm3dContext {
  activeTrack: GpxTrack
  previewLocalities: LocalityInfo[]
  customLocalities: LocalityInfo[]
  suppressedNames: Set<string>
  startName?: string
  endName?: string
  startColEle?: number
  endColEle?: number
  /** Départ / arrivée géocodés sur un hameau / lieu-dit : panneau au style lieu-dit. */
  startLieudit?: boolean
  endLieudit?: boolean
  /** Noms bruts de départ/arrivée (avant application des masquages) — pour savoir si le
   *  panneau départ/arrivée a été explicitement décoché par l'utilisateur. */
  rawStartName?: string
  rawEndName?: string
  weather: WeatherInfo | null
  manualDate?: string
  departureTime?: string
  /** Heure de départ prévue (« Départ prévu… ») plutôt que réelle (« Départ… »). */
  startTimePlanned?: boolean
  arrivalTime?: string
  /** Personnage en tête du ruban (le premier) et numéro de son dossard. */
  characters?: CharacterId[]
  bibNumber?: string
  /** Rues empruntées choisies (m depuis le départ), affichées en haut de l'écran. */
  streets?: StreetRun[]
  /** Bornes, ravitaillements et carton final, comme le film 2D. */
  bornes?: Borne[]
  ravitos?: Ravito[]
  endCard?: EndCard
  /** Encart du haut et cartouche d'épreuve, comme le film 2D. */
  raceTiming?: { useRealTimes: boolean; speedsKmh?: number[] }
  eventCartouche?: EventCartouche
  trackName: string
  activeSillonId: string | null
  /** Id du tracé déjà enregistré dans le sillon actif — cf. useFilmRecording.ts (rattachement
   *  fiable du film, sans deviner par le nom auto commun à deux sorties du même jour). */
  activeSillonTrackId: string | null
  hasPlayedPreview: boolean
  pause: () => void
}

/**
 * Export du survol 3D (type Relive) : phase préparation du terrain + rendu hors-écran, puis
 * enregistrement dans le sillon actif et téléchargement. Three.js est chargé en import dynamique
 * (voir src/lib/clientPdfExport.ts / pdfMerge.ts pour le même pattern).
 */
export function useFilm3dExport() {
  const [film3dProgress, setFilm3dProgress] = useState<number | null>(null) // null = pas en cours
  const [film3dPhase, setFilm3dPhase] = useState<'prepare' | 'render' | null>(null)
  // Temps restant estimé (s), lissé : les estimations brutes arrivent ~5 fois par seconde et
  // bougent à chaque mesure ; la moyenne glissante évite un affichage qui saute.
  const [film3dEtaS, setFilm3dEtaS] = useState<number | null>(null)
  const etaSmoothRef = useRef<number | null>(null)
  const [lastFilm3dUrl, setLastFilm3dUrl] = useState<string | null>(null)
  const film3dAbortRef = useRef<AbortController | null>(null)

  async function handleCreateFilm3d(ctx: CreateFilm3dContext) {
    if (film3dAbortRef.current) {
      film3dAbortRef.current.abort()
      film3dAbortRef.current = null
      setFilm3dProgress(null)
      setFilm3dPhase(null)
      setFilm3dEtaS(null); etaSmoothRef.current = null
      return
    }
    if (!ctx.hasPlayedPreview) return

    const abort = new AbortController()
    film3dAbortRef.current = abort
    setFilm3dProgress(0)
    setFilm3dPhase('prepare')
    ctx.pause()
    // Écran allumé pendant le rendu (plusieurs minutes) : sa mise en veille gelait la boucle de
    // rendu, la barre restait figée sur « Rendu du survol ». Même parade que le film 2D.
    const releaseKeepAlive = beginExportKeepAlive()

    // Durée du survol : même calcul que le film 2D (voir useFilmRecording.ts), rallongé d'un
    // facteur — le survol 3D a plus à montrer (relief, panneaux à lire, ralentis aux localités)
    // qu'un simple défilement de carte. Ce facteur est aussi le levier « vitesse du ruban » :
    // l'augmenter ralentit tout uniformément SANS toucher aux proportions (montées plus lentes
    // que le plat, dwell aux panneaux, mise en route) — c'est un pur changement d'échelle du temps.
    const FILM3D_DURATION_FACTOR = 1.6
    const s = ANIM_SETTINGS.randonneur
    const base = Math.min(s.max, Math.max(s.min, (ctx.activeTrack.distance / 1000) * s.secondsPerKm))
    const fullDurationS = base * FILM3D_DURATION_FACTOR
    // Film d'essai (?essai, cf. filmEssai.ts) : le survol seul de la portion du tracé couverte en ESSAI_FILM_S à
    // vitesse normale. Seule cette portion est préparée (terrain plus petit) ; bornes, ravitaillements, rues et
    // panneaux au-delà sont écartés, pas de panneau d'arrivée.
    const essai = isEssaiFilm()
    const cut = essai ? essaiPortion(ctx.activeTrack.points, fullDurationS) : null
    const durationS = cut ? ESSAI_FILM_S : fullDurationS
    const points = cut ? ctx.activeTrack.points.slice(0, cut.count) : ctx.activeTrack.points
    const trackM = cut ? cut.portionM : ctx.activeTrack.distance
    const inCut = (m: number) => !cut || m <= cut.portionM
    /** Distance depuis le départ du point du tracé le plus proche d'un lieu. */
    const alongM = (lon: number, lat: number) => {
      if (!cut) return 0
      let best = Infinity, at = 0
      ctx.activeTrack.points.forEach((p, i) => {
        const d = (p.lon - lon) ** 2 + ((p.lat - lat) * 1.6) ** 2
        if (d < best) { best = d; at = cut.dist[i] }
      })
      return at
    }

    try {
      const { exportFilm3d } = await import('../lib/terrain3d/filmExport3d')

      // Panneau départ/arrivée décoché dans le wizard : on garde le nom pour l'étiquette
      // « Départ → Arrivée » mais on n'implante pas le cartel dans la scène 3D.
      const depSuppressed = !!ctx.rawStartName && ctx.suppressedNames.has(ctx.rawStartName)
      // Boucle (même nom au départ et à l'arrivée) : pas de second cartel.
      const isLoop = !!ctx.rawStartName && !!ctx.rawEndName
        && ctx.rawStartName.trim().toLowerCase() === ctx.rawEndName.trim().toLowerCase()
      const arrSuppressed = isLoop || (!!ctx.rawEndName && ctx.suppressedNames.has(ctx.rawEndName))

      const blob = await exportFilm3d({
        trail: points.map(p => [p.lon, p.lat] as [number, number]),
        trailDate: formatTrailDate(ctx.manualDate ?? ctx.activeTrack.startTime),
        title: ctx.trackName,
        departureName: ctx.startName ?? ctx.rawStartName ?? ctx.previewLocalities[0]?.name ?? 'Départ',
        arrivalName: ctx.endName ?? ctx.rawEndName ?? ctx.previewLocalities[ctx.previewLocalities.length - 1]?.name ?? 'Arrivée',
        showDeparturePanel: !depSuppressed,
        showArrivalPanel: !arrSuppressed && !cut,
        departureColEle: ctx.startColEle,
        arrivalColEle: ctx.endColEle,
        departureLieudit: ctx.startLieudit,
        arrivalLieudit: ctx.endLieudit,
        elevGainM: ctx.activeTrack.elevGain,
        panels: localitiesToPanels3d(
          ctx.previewLocalities, ctx.customLocalities, ctx.suppressedNames, ctx.startName, ctx.endName,
        ).filter(pnl => inCut(alongM(pnl.lon, pnl.lat))),
        weather: weatherToScenario(ctx.weather, ctx.departureTime, ctx.arrivalTime),
        weatherCard: ctx.weather,
        startTime: ctx.departureTime || undefined,
        startTimePlanned: ctx.startTimePlanned,
        trackStart: ctx.activeTrack.startTime,
        characters: ctx.characters,
        bibNumber: ctx.bibNumber,
        bornes: ctx.bornes?.filter(b => inCut(b.km * 1000)),
        ravitos: ctx.ravitos?.filter(r => inCut(r.km * 1000)),
        endCard: ctx.endCard,
        profilePoints: points,
        raceTiming: ctx.raceTiming,
        eventCartouche: ctx.eventCartouche,
        trackDistanceM: trackM,
        // « 21,1 km » du carton final -> 21 100 m (illisible : distance du tracé).
        shownDistanceM: cut ? undefined : (() => {
          const km = parseFloat((ctx.endCard?.distance ?? '').replace(',', '.'))
          return km > 0 ? km * 1000 : undefined
        })(),
        streets: captionStreets(ctx.streets).filter(s => inCut(s.startM))
          .map(s => ({ name: s.name, from: s.startM / trackM, to: Math.min(1, s.endM / trackM), importance: s.importance })),
        durationS,
        essai,
        fps: 30,
        onProgress: p => {
          setFilm3dProgress(Math.max(0, p.ratio)); setFilm3dPhase(p.phase)
          if (p.etaS != null && Number.isFinite(p.etaS)) {
            const prev = etaSmoothRef.current
            etaSmoothRef.current = prev == null ? p.etaS : prev * 0.9 + p.etaS * 0.1
            setFilm3dEtaS(etaSmoothRef.current)
          }
        },
        signal: abort.signal,
      })

      if (!abort.signal.aborted && blob.size > 0) {
        const filmName = (ctx.trackName || 'sillonphane').replace(/\s+/g, '_')

        // Enregistrer dans le sillon actif (si tracé déjà enregistré) — cf. useFilmRecording.ts.
        try {
          const sillonId = ctx.activeSillonId
          if (sillonId) {
            let trackId = ctx.activeSillonTrackId ?? undefined
            if (!trackId) {
              const { getVoyage } = await import('../lib/voyageDB')
              const sillon = await getVoyage(sillonId)
              trackId = sillon?.tracks.find(t =>
                t.name.trim().toLowerCase() === ctx.trackName.trim().toLowerCase()
              )?.id
            }
            await addFilmToVoyage(sillonId, {
              name: `${filmName}_3d.mp4`,
              trackId,
              durationSec: durationS,
              sizeBytes: blob.size,
            }, blob)
          }
        } catch (e) {
          console.warn('[film3d] enregistrement sillon:', e)
        }

        // Téléchargement
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${filmName}_3d.mp4`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setLastFilm3dUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
      }
    } catch (e) {
      // Le message d'échec de la phase préparation est déjà explicite (voir filmExport3d.ts).
      console.error('[filmExport3d]', e)
      // Échec réel (pas une annulation) : le dire, au lieu de refermer la fenêtre sans un mot.
      const msg = e instanceof Error ? e.message : ''
      if (!abort.signal.aborted && msg && msg !== 'aborted' && (e as Error).name !== 'AbortError') {
        alert(`Le film 3D n'a pas pu être créé.\n\n${msg}`)
      }
    } finally {
      releaseKeepAlive()
      film3dAbortRef.current = null
      setFilm3dProgress(null)
      setFilm3dPhase(null)
      setFilm3dEtaS(null); etaSmoothRef.current = null
    }
  }

  return {
    film3dProgress, film3dPhase, film3dEtaS, lastFilm3dUrl, setLastFilm3dUrl,
    film3dAbortRef, handleCreateFilm3d,
  }
}
