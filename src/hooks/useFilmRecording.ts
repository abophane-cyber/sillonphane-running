import { useRef, useState } from 'react'
import { useRecorder } from './useRecorder'
import { exportFilm, PREFETCH_PROGRESS_BUDGET } from '../lib/filmExport'
import { beginExportKeepAlive } from '../lib/exportKeepAlive'
import { makeExportEta } from '../lib/exportEta'
import { addFilmToVoyage } from '../lib/voyageDB'
import { animDurationS, ANIM_ZOOM } from './useAnimationSettings'
import { formatTrailDate } from '../lib/terrain3d/appAdapters'
import type { LocalityInfo } from './useLocality'
import type { GpxTrack } from '../types'
import type { WeatherInfo } from '../lib/meteo'
import type { CharacterId } from '../lib/characters'
import type { Borne, EndCard, Ravito } from '../lib/raceSplits'
import type { StreetRun } from '../lib/routeStreets'
import { ESSAI_FILM_S, isEssaiFilm } from '../lib/filmEssai'

export interface CreateFilmContext {
  activeTrack: GpxTrack
  distances: number[]
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
  manualDate?: string
  weather: WeatherInfo | null
  characters: CharacterId[]
  /** Bornes tous les 5 km avec temps de passage (cf. raceSplits.ts). */
  bornes: Borne[]
  /** Numéro inscrit sur le dossard du personnage. */
  bibNumber?: string
  /** Heure de départ « HH:MM » (fiche épreuve), affichée à l'ouverture du film. */
  startTime?: string
  /** Heure de départ prévue (« Départ prévu… ») plutôt que réelle d'un GPX horodaté (« Départ… »). */
  startTimePlanned?: boolean
  /** Ravitaillements placés sur le tracé. */
  ravitos?: Ravito[]
  /** Rues empruntées choisies, écrites le long du tracé. */
  streets?: StreetRun[]
  /** Carton de fin du film (intitulé, date, distance, dénivelé, temps, moyenne). */
  endCard?: EndCard
  /** Chrono de l'encart du haut : heures réelles du GPX ou vitesses prévues (cf. raceClock). */
  raceTiming?: { useRealTimes: boolean; speedsKmh?: number[] }
  trackName: string
  activeSillonId: string | null
  /** Id du tracé déjà enregistré dans le sillon actif (posé à la sauvegarde / à l'ouverture
   *  depuis Mes sillons). Sert à rattacher le film au bon tracé sans deviner par le nom —
   *  deux sorties du même jour portent le même nom auto ("Parcours du JJ/MM/AAAA"). */
  activeSillonTrackId: string | null
  hasPlayedPreview: boolean
  pause: () => void
}

/** Enregistrement caméra (webm) et export du film final (rendu hors-écran + sauvegarde sillon). */
export function useFilmRecording() {
  const [filmProgress, setFilmProgress] = useState<number | null>(null)  // null = pas en cours
  const [filmEtaS, setFilmEtaS] = useState<number | null>(null)  // temps restant estimé (s)
  const [lastFilmUrl, setLastFilmUrl] = useState<string | null>(null)
  const filmAbortRef = useRef<AbortController | null>(null)
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawFrameRef = useRef<((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null>(null)
  const { recState, start: startRec, stop: stopRec, cancel: cancelRec, onFrameRef } = useRecorder()

  /** À rappeler à chaque render pour que le dessin de l'overlay ait des données fraîches. */
  function updateDrawFrame(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    drawFrameRef.current = fn
    onFrameRef.current = fn
  }

  async function handleRecordToggle(playing: boolean, onNeedsPlay: () => void, trackName: string) {
    if (recState === 'idle') {
      if (!mapCanvasRef.current) return
      startRec(mapCanvasRef.current, onFrameRef)
      if (!playing) onNeedsPlay()
    } else if (recState === 'recording') {
      const blob = await stopRec()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${(trackName || 'sillonphane').replace(/\s+/g, '_')}_2D.webm`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  async function handleCreateFilm(ctx: CreateFilmContext) {
    if (filmAbortRef.current) { filmAbortRef.current.abort(); filmAbortRef.current = null; setFilmProgress(null); setFilmEtaS(null); return }
    if (!ctx.hasPlayedPreview) return

    const abort = new AbortController()
    filmAbortRef.current = abort
    setFilmProgress(0)
    ctx.pause()

    // Wake Lock écran + nœud audio quasi-muet le temps de l'export : empêche la veille écran et
    // limite le throttling des timers de Chrome si l'onglet passe en arrière-plan pendant le
    // rendu (sinon une image peut attendre >40 s au lieu de 6). Libéré dans le finally.
    const releaseKeepAlive = beginExportKeepAlive()

    const distKm = ctx.activeTrack.distance / 1000
    // Film d'essai (?essai) : la marche seule, ESSAI_FILM_S au total (cf. filmEssai.ts).
    const essai = isEssaiFilm()
    const durationS = essai ? ESSAI_FILM_S : animDurationS(distKm)
    const eta = makeExportEta('2d', durationS, PREFETCH_PROGRESS_BUDGET)

    // Debug local (?filmdebug dans l'URL) : ne rend que les premières secondes de marche, à la
    // VRAIE vitesse et au VRAI fps du film (durationS et fps inchangés — les modifier fausse le
    // rendu, ce qui est contre-productif pour observer le tremblement caméra). Écran-titre et
    // plans de fin sautés, randonneur masqué, préchargement limité à cette portion du tracé :
    // c'est uniquement le nombre d'images à produire qui est réduit.
    const filmDebug = new URLSearchParams(window.location.search).has('filmdebug')
    const FPS = 30
    const debugMaxFrames = filmDebug ? Math.round(8 * FPS) : undefined
    if (filmDebug) console.log('[filmdebug]', { durationS, debugMaxFrames, fps: FPS, search: window.location.search })

    try {
      const blob = await exportFilm({
        points: ctx.activeTrack.points,
        distances: ctx.distances,
        totalDistance: ctx.activeTrack.distance,
        elevGain: ctx.activeTrack.elevGain,
        elevLoss: ctx.activeTrack.elevLoss,
        previewLocalities: ctx.previewLocalities.filter(l => !ctx.suppressedNames.has(l.name)),
        // Panneaux ajoutés manuellement : jamais filtrés par le jeu de noms masqués (gérés
        // par ajout/retrait explicite), sinon un col homonyme d'un lieu décoché disparaît.
        customLocalities: ctx.customLocalities,
        startName: ctx.startName,
        endName:   ctx.endName,
        startColEle: ctx.startColEle,
        endColEle:   ctx.endColEle,
        startLieudit: ctx.startLieudit,
        endLieudit:   ctx.endLieudit,
        title:     ctx.trackName,
        trailDate: formatTrailDate(ctx.manualDate ?? ctx.activeTrack.startTime),
        weather:   ctx.weather ?? null,
        characters: ctx.characters,
        bornes: ctx.bornes,
        bibNumber: ctx.bibNumber,
        startTime: ctx.startTime,
        startTimePlanned: ctx.startTimePlanned,
        ravitos: ctx.ravitos,
        streets: ctx.streets,
        endCard: ctx.endCard,
        raceTiming: ctx.raceTiming,
        // « 21,1 km » du carton final -> 21 100 m (illisible : distance du tracé).
        shownDistanceM: (() => {
          const km = parseFloat((ctx.endCard?.distance ?? '').replace(',', '.'))
          return km > 0 ? km * 1000 : undefined
        })(),
        trackName: ctx.trackName,
        durationS,
        zoom: ANIM_ZOOM,
        fps: FPS,
        onProgress: r => { setFilmProgress(Math.max(0, r)); setFilmEtaS(eta.update(r)) },
        signal: abort.signal,
        debugSkipCharacter: filmDebug,
        debugMaxFrames,
        essai,
      })

      if (!abort.signal.aborted && blob.size > 0) {
        if (!filmDebug) eta.finish()
        const ext      = blob.type.includes('mp4') ? 'mp4' : 'webm'
        const filmName = (ctx.trackName || 'sillonphane').replace(/\s+/g, '_')

        // Enregistrer le film dans le sillon actif (si tracé déjà enregistré) — pas pour les
        // clips de debug (?filmdebug), qui n'ont pas à polluer "Mes sillons".
        try {
          const sillonId = ctx.activeSillonId
          if (sillonId && !filmDebug) {
            // Id réel du tracé si on le connaît. Repli sur le rapprochement par nom seulement
            // pour les cas anciens où il n'a pas été posé (jamais deux tracés homonymes alors).
            let trackId = ctx.activeSillonTrackId ?? undefined
            if (!trackId) {
              const { getVoyage } = await import('../lib/voyageDB')
              const sillon = await getVoyage(sillonId)
              trackId = sillon?.tracks.find(t =>
                t.name.trim().toLowerCase() === ctx.trackName.trim().toLowerCase()
              )?.id
            }
            const meta = {
              name: `${filmName}_2D.${ext}`,
              trackId,
              durationSec: durationS,
              sizeBytes: blob.size,
            }
            // Pas de repli sans blob en cas d'échec : une fiche de film sans vidéo jouable serait
            // indiscernable d'un film valide dans "Mes sillons", sans mécanisme de détection ni
            // de nettoyage (contrairement aux photos orphelines). Le téléchargement direct plus
            // bas reste la sauvegarde de secours pour l'utilisateur dans ce cas.
            await addFilmToVoyage(sillonId, meta, blob)
          }
        } catch (e) {
          console.warn('[film] enregistrement sillon:', e)
        }

        // Téléchargement
        const url = URL.createObjectURL(blob)
        const a   = document.createElement('a')
        a.href    = url
        a.download = `${filmName}_2D.${ext}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        // Gardée en vie (pas révoquée) pour le bouton "Voir le film" — remplacée/révoquée au
        // prochain film créé ou au chargement d'un nouveau tracé.
        setLastFilmUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
      }
    } catch (e) {
      console.error('[filmExport]', e)
      // Échec réel (pas une annulation) : le dire, au lieu de refermer la fenêtre sans un mot.
      const msg = e instanceof Error ? e.message : ''
      if (!abort.signal.aborted && msg && msg !== 'aborted' && (e as Error).name !== 'AbortError') {
        alert(`Le film 2D n'a pas pu être créé.\n\n${msg}`)
      }
    } finally {
      releaseKeepAlive()
      filmAbortRef.current = null
      setFilmProgress(null)
      setFilmEtaS(null)
    }
  }

  return {
    filmProgress, filmEtaS, recState, cancelRec,
    filmAbortRef, mapCanvasRef, drawFrameRef, onFrameRef,
    updateDrawFrame, handleRecordToggle, handleCreateFilm,
    lastFilmUrl, setLastFilmUrl,
  }
}
