import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GpxPoint } from '../types'
import type { LocalityInfo, ColMarker } from '../hooks/useLocality'
import { fetchLocalityInfo } from '../hooks/useLocality'
import { ANIM_ZOOM } from '../hooks/useAnimationSettings'
import { buildRouteTileUrls, buildBoundingBoxTileUrls, prefetchTiles } from '../lib/tilePrefetch'
import { DEFAULT_CHARACTERS, type CharacterId } from '../lib/characters'
import { smoothTrackCoords } from '../lib/gpx'
import { PANEL_DRAG_MIME, isPanelDrag, snapToTrack } from '../lib/panelDrag'
import type { Hiker3dSprite } from '../lib/hiker3dSprite'
import {
  HIKER3D_CLOSE_ZOOM, HIKER3D_END_ZOOM_MS, HIKER3D_START_DEZOOM_MS, HIKER3D_OVERVIEW_MS, HIKER3D_PAIR_PX, HIKER3D_FOLLOW_PX,
  HIKER3D_MERGE_TAU_S, HIKER3D_ENABLED, startPresentAt, HIKER3D_MAX_SCALE, HIKER3D_BODY_SCALE, HIKER3D_OUTRO_AT, HIKER3D_END_HOLD_MS, hiker3dScaleForZoom, smoothEase, metersPerPixel,
} from '../lib/hiker3dStaging'
import { getTrackPacing, headingToScreen } from '../lib/trackPacing'
import { borneNumber, borneReached, borneTimeLine, type Borne, type Ravito } from '../lib/raceSplits'
import { CAPTION_HOLD_S, type StreetRun } from '../lib/routeStreets'
import { PLACE_HOLD_S, drawStreetAlongPath, poiIconFor, poiLines, streetLabel, streetLabelAlpha } from '../lib/mapLabels'
import { ANIM_SETTINGS } from '../hooks/useAnimationSettings'
import { RIBBON_FULL_GRADIENT, RIBBON_LAG_PX, RIBBON_OUTLINE, RIBBON_OUTLINE_FULL, ribbonGradient, ribbonHeadM } from '../lib/ribbon'
import { makeStyle, EMPTY_FC } from '../lib/mapStyle'

// Randonneurs 3D (cf. hiker3dSprite.ts) dès que l'appareil a WebGL2 ; sinon, le ruban seul.
// Module 3D chargé à la demande (Three.js hors du bundle principal).
const HIKER3D = HIKER3D_ENABLED
/** Suivi caméra de l'aperçu : constante de temps de l'amorti (s), comme le film 2D (FOLLOW_K ≈ 0,038 par image à 30 i/s). */
const CAMERA_FOLLOW_TAU_S = 0.8

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _computeBearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => d * Math.PI / 180
  const [lon1, lat1] = from.map(toRad)
  const [lon2, lat2] = to.map(toRad)
  const dLon = lon2 - lon1
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function _lerpBearing(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}

function trackBounds(points: GpxPoint[]): maplibregl.LngLatBoundsLike {
  let minLon = points[0].lon, maxLon = points[0].lon
  let minLat = points[0].lat, maxLat = points[0].lat
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  return [[minLon, minLat], [maxLon, maxLat]]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  points: GpxPoint[]
  distances: number[]
  totalDistance: number
  progress: number
  markerPosition: GpxPoint | null
  followMarker: boolean
  animating: boolean
  playing?: boolean
  fitBounds?: number
  seekCount?: number
  zoomToStart?: number
  onZoomChange?: (zoom: number) => void
  onMapIdle?: () => void
  targetZoom?: number | null
  zoomResetSeq?: number
  activityMode?: 'randonneur'
  characters?: CharacterId[]
  panelDuration?: number
  localityDedupKm?: number
  localityDedupMinScore?: number
  locality?: LocalityInfo | null
  colMarkers?: ColMarker[]
  previewLocalities?: LocalityInfo[]
  customLocalities?: LocalityInfo[]
  /** Bornes tous les 5 km (km + temps de passage), couchées sur le tracé. */
  bornes?: Borne[]
  /** Numéro inscrit sur le dossard du personnage. */
  bibNumber?: string
  /** Ravitaillements (km saisis dans le widget), écrits au sol sur le tracé. */
  ravitos?: Ravito[]
  /** Rues empruntées choisies (IGN) : nom en haut de la carte pendant que la coureuse y court. */
  streets?: StreetRun[]
  onRemoveCustomLocality?: (name: string) => void
  onMoveCustomLocality?: (name: string, lon: number, lat: number) => void
  onSuppressLocality?: (name: string) => void
  onRestoreLocality?: (name: string) => void
  departureNameOverride?: string
  arrivalNameOverride?: string
  /** Altitude du col quand le départ / l'arrivée est un col : marqueur au style col (nom + altitude). */
  departureColEle?: number
  arrivalColEle?: number
  /** Départ / arrivée sur un hameau / lieu-dit : marqueur au style lieu-dit. */
  departureLieudit?: boolean
  arrivalLieudit?: boolean
  detectedDepartureName?: string
  detectedArrivalName?: string
  onMapCanvasReady?: (canvas: HTMLCanvasElement) => void
  animationEnded?: boolean
  wizardPanelStep?: boolean
  externalSuppressed?: Set<string>
  /** Décompte avant lecture (randonneur 3D : se lève, zoom de départ). */
  countdown?: number | null
  /** Durée de la séquence d'arrivée avant la popup « Enregistrer » (randonneur 3D : salut + zoom). */
  endDelayMsRef?: { current: number }
  /** Pause entre la fin du décompte et la marche (randonneur 3D : dézoom), cf. usePlaybackCountdown. */
  startDelayMsRef?: { current: number }
}

// Markup interne d'un panneau localité / lieu-dit / col (sans le <div> extérieur porteur
// des classes d'état). `withClose` ajoute le bouton × ; `col` bascule sur le format col
// (nom + altitude) au lieu du format localité.
function signBoardHtml(loc: LocalityInfo, withClose: boolean): string {
  const close = withClose ? `<button class="loc-sign__close" type="button" title="Fermer">×</button>` : ''
  if (loc.type === 'col') {
    return `<div class="loc-sign__board">${close}` +
      `<span class="loc-sign__col-name">${loc.name.toUpperCase()}</span>` +
      `${loc.ele ? `<span class="loc-sign__col-ele">Alt. ${loc.ele} m</span>` : ''}` +
      `</div><div class="loc-sign__pole"></div>`
  }
  // Casse d'origine : nom écrit à même la carte (cf. .loc-sign dans App.css) ; POI sur deux lignes si long, comme les films.
  const nameStr = loc.placeType === 'poi' ? poiLines(loc.name).join('<br>') : loc.name
  return `<div class="loc-sign__board">${close}${nameStr}</div><div class="loc-sign__pole"></div>`
}

/** Classe du <div> extérieur d'un panneau selon son type. */
function signOuterClass(loc: LocalityInfo): string {
  if (loc.type === 'col') return 'loc-sign loc-sign--col'
  if (loc.placeType === 'poi') return `loc-sign loc-sign--poi loc-sign--poi-${poiIconFor(loc.name)}`
  if (loc.placeType === 'ravito') return 'loc-sign loc-sign--ravito'
  const isLieuDit = loc.placeType === 'hamlet' || loc.placeType === 'locality'
  return isLieuDit ? 'loc-sign loc-sign--lieudit' : 'loc-sign'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TrackMap({
  points, distances, totalDistance, progress,
  markerPosition, followMarker, animating,
  playing, fitBounds, seekCount, zoomToStart,
  onZoomChange, onMapIdle, targetZoom, zoomResetSeq = 0,
  activityMode = 'randonneur', characters = DEFAULT_CHARACTERS,
  panelDuration = 3000,
  localityDedupKm = 5,
  localityDedupMinScore = 6,
  locality, colMarkers = [], previewLocalities, customLocalities = [], bornes, ravitos, streets, bibNumber = '', onRemoveCustomLocality, onMoveCustomLocality, onSuppressLocality, onRestoreLocality,
  departureNameOverride, arrivalNameOverride, departureColEle, arrivalColEle, departureLieudit, arrivalLieudit,
  detectedDepartureName, detectedArrivalName,
  onMapCanvasReady, animationEnded = false,
  wizardPanelStep = false, externalSuppressed,
  countdown = null, endDelayMsRef, startDelayMsRef,
}: Props) {
  const containerRef       = useRef<HTMLDivElement>(null)
  const mapRef             = useRef<maplibregl.Map | null>(null)
  const loadedRef          = useRef(false)
  const localityRef        = useRef<LocalityInfo | null>(null)
  const departureMarkerRef = useRef<maplibregl.Marker | null>(null)
  const depNameRef         = useRef<string | null>(null)
  const arrNameRef         = useRef<string | null>(null)
  const [fetchedDepName, setFetchedDepName] = useState<string | null>(null)
  const [fetchedArrName, setFetchedArrName] = useState<string | null>(null)
  const markerRef    = useRef<maplibregl.Marker | null>(null)
  const markerElRef  = useRef<HTMLDivElement | null>(null)
  const startMarkerRef = useRef<maplibregl.Marker | null>(null)
  const endMarkerRef   = useRef<maplibregl.Marker | null>(null)

  const flyingRef        = useRef(false)
  const bearingRef       = useRef(0)
  const prevLngLatRef    = useRef<[number, number] | null>(null)
  const lastCameraUpdateRef = useRef(0)
  const hiker3dRef       = useRef<Hiker3dSprite[]>([])
  const hiker3dTokenRef  = useRef(0) // dernier montage demandé (les imports en retard sont ignorés)
  const countdownRef     = useRef(countdown)
  countdownRef.current   = countdown
  // Duo en marche : position du second (px écran, relative au premier), en file derrière lui SUR le ruban ;
  // null hors marche (départ, arrivée) : côte à côte. Décalages affichés lissés (pas de saut au changement).
  const hikerFollowRef   = useRef<{ x: number; y: number } | null>(null)
  const hikerOffsRef     = useRef([{ x: -HIKER3D_PAIR_PX, y: 0 }, { x: HIKER3D_PAIR_PX, y: 0 }])
  const hikerScaleRef    = useRef(1)
  // Mise en file du second (départ) : sa vitesse propre vers la file (px/s) et l'état de la manœuvre.
  const hikerMergeRef    = useRef({ vx: 0, vy: 0, merging: false, was: false })
  const hikerLayoutTimeRef = useRef(0)
  const hikerLayoutRafRef  = useRef(0)
  // Cap lissé (vecteur unitaire écran) commun aux randonneurs.
  const hikerDirRef      = useRef({ x: 1, y: 0 })
  // Vitesse d'avancement au sol (m/s lissés) : dernière distance parcourue et son instant.
  const hikerGroundRef   = useRef({ t: 0, m: 0, mps: 0 })
  // Place chaque randonneur 3D autour du point du tracé : taille selon le zoom (plans serrés de départ et
  // d'arrivée), pieds sur le point. Duo côte à côte au départ et à l'arrivée ; en marche, l'un derrière l'autre
  // sur le ruban (côte à côte, ils se balançaient autour du ruban dans les virages).
  const layoutHiker3d = () => {
    const sprites = hiker3dRef.current
    const map = mapRef.current
    if (!sprites.length || !map) return
    const base = targetZoomRef.current ?? ANIM_ZOOM
    const f = hiker3dScaleForZoom(map.getZoom(), base) * HIKER3D_BODY_SCALE
    hikerScaleRef.current = f
    // Décalages exprimés en taille de MARCHE (×f à l'affichage) : l'écart grandit et rapetisse avec les personnages.
    // Avant, lissé en px écran et seulement quand la carte bougeait, il restait figé pendant le décompte puis
    // s'ouvrait d'un coup au dézoom (personnages qui s'écartaient puis se rapprochaient).
    const follow = hikerFollowRef.current
    const targets = sprites.length === 1 ? [{ x: 0, y: 0 }]
      : follow ? [{ x: 0, y: 0 }, { x: follow.x / f, y: follow.y / f }]
      : [{ x: -HIKER3D_PAIR_PX, y: 0 }, { x: HIKER3D_PAIR_PX, y: 0 }]
    // Lissage selon le temps écoulé (≈ 0,4 s), indépendant de la fréquence des appels. Mise en file au départ : plus
    // lente (HIKER3D_MERGE_TAU_S), le second y rejoint le chemin EN MARCHANT (cf. hikerMergeRef), pas en glissant.
    const now = performance.now()
    const dt = Math.min(0.2, (now - hikerLayoutTimeRef.current) / 1000)
    hikerLayoutTimeRef.current = now
    let settled = true
    const merge = hikerMergeRef.current
    merge.merging = false
    sprites.forEach((s, i) => {
      s.setScale(f)
      const { w, h, feet } = s.layout()
      const o = hikerOffsRef.current[i]
      const intoFile = i === 1 && !!follow
      const a = 1 - Math.exp(-dt / (intoFile ? HIKER3D_MERGE_TAU_S : 0.4))
      const ox = o.x, oy = o.y
      o.x += (targets[i].x - o.x) * a
      o.y += (targets[i].y - o.y) * a
      if (intoFile && dt > 0) {
        // Vitesse propre du déplacement vers la file (px écran / s), ajoutée à l'avancement pour l'orienter.
        merge.vx = ((o.x - ox) * f) / dt
        merge.vy = ((o.y - oy) * f) / dt
        merge.merging = Math.hypot(targets[i].x - o.x, targets[i].y - o.y) > 2
      }
      if (Math.abs(targets[i].x - o.x) > 0.3 || Math.abs(targets[i].y - o.y) > 0.3) settled = false
      const x = o.x * f, y = o.y * f
      s.element.style.left = `${Math.round(x - w / 2)}px`
      s.element.style.top = `${Math.round(y - (h - feet))}px`
      s.element.style.zIndex = String(Math.round(100 + y)) // le plus bas à l'écran passe devant
    })
    // Pas encore en place : on continue d'image en image, même carte immobile (décompte, pause).
    if (!settled && !hikerLayoutRafRef.current) {
      hikerLayoutRafRef.current = requestAnimationFrame(() => { hikerLayoutRafRef.current = 0; layoutHiker3d() })
    }
  }
  // Remplace le contenu du marqueur par des randonneurs 3D (un par personnage) ; rien sans WebGL2 (ruban seul).
  const mountHiker3d = (el: HTMLDivElement, chars: CharacterId[]) => {
    hiker3dRef.current.forEach(s => s.dispose())
    hiker3dRef.current = []
    const token = ++hiker3dTokenRef.current
    void import('../lib/hiker3dSprite').then(m => {
      if (markerElRef.current !== el || token !== hiker3dTokenRef.current) return
      if (!m.supportsHiker3d()) return
      el.innerHTML = ''
      el.style.zIndex = '3' // devant les panneaux (celui d'arrivée le cachait pendant le salut)
      // Marqueur réduit à un point (le point du tracé) : chaque personnage y est placé par layoutHiker3d().
      el.style.width = '0'
      el.style.height = '0'
      el.dataset.hiker3d = '1'
      hiker3dRef.current = chars.slice(0, 2).map(id => {
        const s = m.createHiker3dSprite(id, { bibNumber: bibNumberRef.current })
        if (progressRef.current >= 0.01) s.skipToWalk()
        else if (countdownRef.current !== null) s.startIntro()
        s.setPlaying(playingRef.current)
        el.appendChild(s.element)
        s.onFeet(() => layoutHiker3d())
        return s
      })
      // Nouveaux personnages : placés directement à leur place de départ (pas de glissement à l'apparition).
      hikerOffsRef.current = hiker3dRef.current.length === 1
        ? [{ x: 0, y: 0 }, { x: 0, y: 0 }]
        : [{ x: -HIKER3D_PAIR_PX, y: 0 }, { x: HIKER3D_PAIR_PX, y: 0 }]
      layoutHiker3d()
    })
  }
  const progressRef      = useRef(progress)
  progressRef.current    = progress
  const playingRef       = useRef(playing ?? false)
  playingRef.current     = playing ?? false
  const targetZoomRef    = useRef(targetZoom ?? null)
  targetZoomRef.current  = targetZoom ?? null
  const onZoomChangeRef  = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const onMapIdleRef = useRef(onMapIdle)
  onMapIdleRef.current = onMapIdle
  const lastSeekCountRef  = useRef(seekCount ?? 0)
  const prevPlayingRef    = useRef(false)


  // Géométrie lissée du tracé (rendu uniquement — le marqueur et les distances restent exacts)
  const smoothedCoords = useMemo(() => smoothTrackCoords(points), [points])

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(),
      center: [2.5, 46.5],
      zoom: 14,
      pitch: 0,
      bearing: 0,
      ...({ preserveDrawingBuffer: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) } as object),
      attributionControl: false,
      fadeDuration: 0,
      maxTileCacheSize: 2000,
    })
    mapRef.current = map

    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
    // Boutons +/− de zoom (coin bas-gauche, au-dessus de l'échelle : en haut à droite ils passaient sous le widget
    // des panneaux) : purement DOM, hors du canvas WebGL capturé pour le film — n'apparaissent donc pas dans
    // l'export. Pas de boussole (le cap tourne pendant l'anim).
    map.addControl(new maplibregl.NavigationControl({ showZoom: true, showCompass: false }), 'bottom-left')

    map.on('load', () => {
      loadedRef.current = true
      onMapCanvasReady?.(map.getCanvas())
      if (!playingRef.current && progressRef.current < 0.01) {
        pendingPreviewRef.current?.()
      }
      pendingCustomRef.current?.()
    })

    map.on('idle', () => {
      onMapIdleRef.current?.()
    })

    const updateAlt = () => {
      const z = map.getZoom()
      onZoomChangeRef.current?.(z)
    }
    map.on('zoom', updateAlt)
    map.on('moveend', updateAlt)
    // Pancartes couchées sur la carte : même taille que les personnages selon le zoom (cf. .loc-sign dans App.css).
    const updateGroundScale = () => containerRef.current?.style.setProperty('--ground-scale',
      String(hiker3dScaleForZoom(map.getZoom(), targetZoomRef.current ?? ANIM_ZOOM)))
    map.on('zoom', updateGroundScale)
    updateGroundScale()

    return () => {
      loadedRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Préchargement des tuiles pendant le temps mort avant la lecture (wizard des panneaux,
  // relecture des réglages…) : évite le fond beige et les à-coups au lancement de l'aperçu.
  // Deux stratégies selon le niveau de zoom : aux zooms de lecture (proches), seuls les abords du
  // chemin sont jamais visibles, donc un survol des points du tracé suffit. Aux zooms "vue
  // d'ensemble" (fitBounds au chargement, plan final de l'export), c'est tout le rectangle
  // englobant qui s'affiche — un tracé sinueux peut laisser de larges zones loin du chemin mais
  // bien visibles à l'écran (coins du cadrage), d'où un préchargement par zone plutôt que par point. ──
  useEffect(() => {
    if (points.length < 2) return
    const animZooms = [Math.floor(ANIM_ZOOM), Math.ceil(ANIM_ZOOM)]
    const overviewZooms = [9, 10, 11]
    const rect = containerRef.current?.getBoundingClientRect()
    const viewportAspect = rect && rect.height > 0 ? rect.width / rect.height : 1.6
    const controller = new AbortController()
    prefetchTiles([
      // Vue d'ensemble telle qu'affichée à l'écran (fitBounds, ratio du viewport réel)
      ...buildBoundingBoxTileUrls(points, overviewZooms, viewportAspect),
      // Plan final de l'export vidéo : ratio fixe 16:9, indépendant de l'écran de l'utilisateur
      ...buildBoundingBoxTileUrls(points, overviewZooms, 16 / 9),
      ...buildRouteTileUrls(points, animZooms),
    ], { signal: controller.signal })
    return () => controller.abort()
  }, [points])

  // ── Track ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || points.length < 2) return

    const fullFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: smoothedCoords }, properties: {} }],
    }

    const setTrack = () => {
      ;(map.getSource('track-full') as maplibregl.GeoJSONSource).setData(fullFC)
      ;(map.getSource('track-done') as maplibregl.GeoJSONSource).setData(EMPTY_FC)

      // Start marker
      if (startMarkerRef.current) startMarkerRef.current.remove()
      const startEl = document.createElement('div')
      startEl.className = 'track-marker track-marker--start'
      startEl.textContent = '▶'
      startMarkerRef.current = new maplibregl.Marker({ element: startEl, anchor: 'center' })
        .setLngLat([points[0].lon, points[0].lat])
        .addTo(map)

      // End marker
      if (endMarkerRef.current) endMarkerRef.current.remove()
      const endEl = document.createElement('div')
      endEl.className = 'track-marker track-marker--end'
      endEl.textContent = '⬛'
      endMarkerRef.current = new maplibregl.Marker({ element: endEl, anchor: 'center' })
        .setLngLat([points[points.length - 1].lon, points[points.length - 1].lat])
        .addTo(map)

      // Remove position marker (will be recreated on first frame)
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null }
      hiker3dRef.current.forEach(s => s.dispose())
      hiker3dRef.current = []
      hiker3dTokenRef.current++

      // Initial view: full track extent
      map.fitBounds(trackBounds(points), { padding: 60, duration: 0, pitch: 0, bearing: 0 })
      prevPlayingRef.current = false
    }

    if (loadedRef.current) {
      setTrack()
    } else {
      map.once('load', setTrack)
    }
  }, [points]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Play start / seek ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || points.length < 2) return
    if (playing && !prevPlayingRef.current) {
      // Masquer le tracé pointillé (pré-lecture) au démarrage
      ;(map.getSource('track-full') as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC)

      const freshStart = progressRef.current < 0.01
      const wasSeeked  = (seekCount ?? 0) > lastSeekCountRef.current
      bearingRef.current = 0
      prevLngLatRef.current = null
      if (wasSeeked) {
        // Seek : vol vers la position recherchée
        lastSeekCountRef.current = seekCount ?? 0
        const idx = Math.round(progressRef.current * (points.length - 1))
        const pt  = points[Math.min(idx, points.length - 1)]
        flyingRef.current = true
        map.once('moveend', () => { flyingRef.current = false })
        map.flyTo({ center: [pt.lon, pt.lat], zoom: map.getZoom(), bearing: 0, pitch: 0, duration: 1200 })
      } else if (freshStart) {
        // Départ frais : jumpTo déjà fait par zoomResetSeq, rien à faire
        flyingRef.current = false
      }
    }
    prevPlayingRef.current = playing ?? false
  }, [playing, points, seekCount])

  // ── Retour au départ ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!zoomToStart || !map || points.length < 2) return
    flyingRef.current = true
    map.once('moveend', () => { flyingRef.current = false })
    if (countdownRef.current === null && HIKER3D && characters.length) {
      // Bouton « Retour au début » (sans relance) : plan général du parcours, coureur à nouveau présenté en grand.
      map.fitBounds(trackBounds(points), { padding: 60, duration: 1000, pitch: 0, bearing: 0 })
      placeHikerAtStart()
      hiker3dRef.current.forEach(s => s.resetToStart())
      showPresentation()
      return
    }
    map.flyTo({ center: [points[0].lon, points[0].lat], zoom: map.getZoom(), duration: 1000 })
  }, [zoomToStart, points]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dézoom fin d'animation ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitBounds || points.length < 2) return
    flyingRef.current = true
    bearingRef.current = 0
    prevLngLatRef.current = null
    const sprites = hiker3dRef.current
    if (sprites.length) {
      // Randonneur 3D : zoom sur lui à l'arrivée, il salue / s'assoit, puis vue d'ensemble.
      // Ils se tournent vers nous dès l'arrivée (pas seulement au salut, pendant le zoom).
      sprites.forEach(s => s.turnTo(0, 1))
      const end = points[points.length - 1]
      map.easeTo({ center: [end.lon, end.lat], zoom: (targetZoomRef.current ?? map.getZoom()) + HIKER3D_CLOSE_ZOOM, duration: HIKER3D_END_ZOOM_MS, easing: smoothEase, essential: true })
      const t1 = window.setTimeout(() => sprites.forEach(s => s.startOutro()), HIKER3D_END_ZOOM_MS * HIKER3D_OUTRO_AT)
      const t2 = window.setTimeout(() => {
        map.once('moveend', () => { flyingRef.current = false })
        map.fitBounds(trackBounds(points), { padding: 60, duration: HIKER3D_OVERVIEW_MS, easing: smoothEase, essential: true, pitch: 0, bearing: 0 })
        // Ils rapetissent avec le dézoom et s'effacent en même temps. Sur les fenêtres 3D et non sur le marqueur :
        // MapLibre réécrit l'opacité de ses marqueurs à chaque mouvement de carte, ce qui annulait le fondu.
        sprites.forEach(s => { s.element.style.transition = `opacity ${HIKER3D_OVERVIEW_MS}ms ease-in`; s.element.style.opacity = '0' })
      }, HIKER3D_END_ZOOM_MS + HIKER3D_END_HOLD_MS)
      return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
    }
    map.once('moveend', () => { flyingRef.current = false })
    map.fitBounds(trackBounds(points), { padding: 60, duration: 1500, pitch: 0, bearing: 0 })
  }, [fitBounds, points])

  // ── Marqueur + tracé parcouru + suivi caméra ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !markerPosition || points.length < 2) return

    const lngLat: [number, number] = [markerPosition.lon, markerPosition.lat]

    // Position marker
    if (!markerRef.current) {
      const el = document.createElement('div')
      markerElRef.current = el
      if (HIKER3D) mountHiker3d(el, characters)
      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(lngLat)
        .addTo(map)
    } else {
      markerRef.current.setLngLat(lngLat)
    }

    // Randonneurs 3D : cap, cadence des pas, duo en file (cf. hiker3dSprite.ts, trackPacing.ts).
    {
      const coveredM = progress * totalDistance
      const herePx = map.project(lngLat)
      if (hiker3dRef.current.length) {
        // Randonneur 3D : il pivote vers la direction de marche (pas de retournement en miroir).
        const sprites = hiker3dRef.current
        // Cap : celui du chemin à l'endroit où se trouve chaque personnage (virages et lacets suivis) ; la douceur
        // vient du ralenti dans les virages (trackPacing, appliqué par useAnimation) et du pivot borné du personnage.
        const pacing = getTrackPacing(points, distances)
        const mPerPx = metersPerPixel(lngLat[1], map.getZoom())
        const dir = headingToScreen(pacing.headingAt(coveredM))
        hikerDirRef.current = dir
        // Anti-patinage : vitesse d'avancement au sol (m/s mesurés sur la progression, lissés) convertie en hauteurs
        // de corps par seconde à l'écran -> la cadence des pas s'y cale (cf. hiker3dSprite.setGroundSpeed).
        const nowMs = performance.now()
        const gs = hikerGroundRef.current
        if (!playing) gs.t = 0 // reprise après pause : pas de mesure à cheval sur la pause
        else {
          if (gs.t > 0 && nowMs > gs.t) {
            const mps = Math.max(0, (coveredM - gs.m) / ((nowMs - gs.t) / 1000))
            if (mps < 5000) gs.mps = gs.mps ? gs.mps + (mps - gs.mps) * 0.2 : mps // ignore les sauts (curseur déplacé)
          }
          gs.t = nowMs; gs.m = coveredM
        }
        if (gs.mps > 0) {
          const body = sprites[0].layout().body
          // Hors des lacets, le ruban accélère mais les pas gardent leur allure.
          const stepMps = gs.mps * pacing.stepScaleAt(coveredM)
          sprites.forEach(s => s.setGroundSpeed(stepMps / mPerPx / Math.max(1, body)))
        }
        sprites.forEach(s => s.setProgress(progress)) // allure selon la distance parcourue (coureurs)
        sprites[0].setDirection(dir.x, dir.y)
        // Duo en marche : le second suit sur le ruban, un peu en arrière.
        hikerFollowRef.current = null
        if (sprites.length > 1 && progress > 0.002 && progress < 1) {
          const gapPx = HIKER3D_FOLLOW_PX * hikerScaleRef.current
          const pxAt = (m: number) => {
            let lon = points[0].lon, lat = points[0].lat
            for (let i = 1; i < distances.length; i++) {
              if (distances[i] >= m) {
                const t2 = (m - distances[i - 1]) / ((distances[i] - distances[i - 1]) || 1)
                lon = points[i - 1].lon + t2 * (points[i].lon - points[i - 1].lon)
                lat = points[i - 1].lat + t2 * (points[i].lat - points[i - 1].lat)
                break
              }
            }
            return map.project([lon, lat])
          }
          // Recule le long du ruban jusqu'à être VRAIMENT à gapPx du premier à l'écran : dans un lacet, la même
          // distance le long du ruban les rapprochait jusqu'à se chevaucher.
          let behindM = Math.max(0, coveredM - gapPx * mPerPx)
          let bPx = pxAt(behindM)
          for (let k = 0; k < 24 && behindM > 0 && Math.hypot(bPx.x - herePx.x, bPx.y - herePx.y) < gapPx; k++) {
            behindM = Math.max(0, behindM - gapPx * mPerPx * 0.25)
            bPx = pxAt(behindM)
          }
          const follow = { x: bPx.x - herePx.x, y: bPx.y - herePx.y }
          hikerFollowRef.current = follow
          // Le second suit le chemin là où il est (il prend le virage après le premier).
          const d2 = headingToScreen(pacing.headingAt(behindM))
          sprites[1].setDirection(d2.x, d2.y)
        } else if (sprites.length > 1) sprites[1].setDirection(dir.x, dir.y)
        layoutHiker3d()
        // Mise en file au départ : le second marche en biais vers le chemin (cap = avancement + déplacement latéral,
        // cadence sur sa propre vitesse), puis reprend le cap commun une fois en place.
        const merge = hikerMergeRef.current
        if (sprites.length > 1 && playing && gs.mps > 0) {
          if (merge.merging) {
            const speedPx = gs.mps / mPerPx
            const vx = dir.x * speedPx + merge.vx, vy = dir.y * speedPx + merge.vy
            sprites[1].turnTo(vx, vy)
            sprites[1].setGroundSpeed(Math.hypot(vx, vy) / Math.max(1, sprites[1].layout().body))
            merge.was = true
          } else if (merge.was) {
            merge.was = false
            sprites[1].turnTo(dir.x, dir.y)
          }
        }
        // Popup « Enregistrer » seulement après la séquence d'arrivée (zoom, salut, vue d'ensemble) ; lu à la fin de la marche.
        if (endDelayMsRef) {
          endDelayMsRef.current = HIKER3D_END_ZOOM_MS + HIKER3D_END_HOLD_MS + HIKER3D_OVERVIEW_MS
        }
      }
    }
    prevLngLatRef.current = lngLat

    // Tracé parcouru : jusqu'à la position exacte du coureur, moins un petit écart (RIBBON_LAG_PX) pour qu'il soit
    // un peu devant le ruban ; sans personnage ou course finie, jusqu'au bout.
    const fullCovered = progress * totalDistance
    const lagM = hiker3dRef.current.length && progress < 1
      ? RIBBON_LAG_PX * hikerScaleRef.current * metersPerPixel(lngLat[1], map.getZoom()) : 0
    const covered = Math.max(0, fullCovered - lagM)
    const doneCoords: [number, number][] = []
    for (let i = 0; i < points.length; i++) {
      if (i > 0 && distances[i] > covered) {
        const t = (covered - distances[i - 1]) / ((distances[i] - distances[i - 1]) || 1)
        const a = smoothedCoords[i - 1], b = smoothedCoords[i]
        doneCoords.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
        break
      }
      doneCoords.push(smoothedCoords[i])
    }
    const doneFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: doneCoords.length > 1
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: doneCoords }, properties: {} }]
        : [],
    }
    ;(map.getSource('track-done') as maplibregl.GeoJSONSource | undefined)?.setData(doneFC)
    // Pendant la course : crème au coureur, orange puis vert derrière lui ; course finie (vue générale) : dégradé
    // d'origine sur tout le parcours et liseré plus marqué, sans tête de ruban.
    const finished = progress >= 1
    if (map.getLayer('track-done-line') && covered > 0) {
      map.setPaintProperty('track-done-line', 'line-gradient', (finished ? RIBBON_FULL_GRADIENT : ribbonGradient(covered, totalDistance)) as maplibregl.ExpressionSpecification)
      map.setPaintProperty('track-done-halo', 'line-color', finished ? RIBBON_OUTLINE_FULL : RIBBON_OUTLINE)
      map.setPaintProperty('track-done-halo', 'line-width', finished ? 8 : 7.5)
    }
    // Tête du ruban : derniers mètres parcourus, au-dessus de tout (cf. ribbonHeadM).
    const headFrom = finished ? Infinity : covered - ribbonHeadM(totalDistance)
    let h0 = doneCoords.length - 1
    while (h0 > 0 && distances[h0 - 1] > headFrom) h0--
    const headCoords = finished ? [] : doneCoords.slice(Math.max(0, h0 - 1))
    ;(map.getSource('track-head') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: headCoords.length > 1
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: headCoords }, properties: {} }]
        : [],
    })
    // Boule au bout du ruban (cf. RIBBON_TIP_BALL).
    ;(map.getSource('track-tip') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: headCoords.length > 1
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: headCoords[headCoords.length - 1] }, properties: {} }]
        : [],
    })

    // Suivi caméra : glissement continu et amorti vers le coureur à chaque image (comme le film 2D, FOLLOW_K),
    // au lieu d'un rattrapage quand il approchait du bord. Amorti resserré s'il s'éloigne trop du centre.
    if (followMarker && animating && !flyingRef.current) {
      const now = performance.now()
      const dt = Math.min(0.1, Math.max(0, (now - lastCameraUpdateRef.current) / 1000))
      lastCameraUpdateRef.current = now
      const { clientWidth: cw, clientHeight: ch } = map.getContainer()
      const c = map.getCenter()
      const pc = map.project(c), pm = map.project(lngLat)
      const lagPx = Math.hypot(pm.x - pc.x, pm.y - pc.y)
      const maxLag = Math.min(cw, ch) * 0.3
      let k = 1 - Math.exp(-dt / CAMERA_FOLLOW_TAU_S)
      if (lagPx > maxLag) k = Math.min(0.5, k * (lagPx / maxLag))
      const zoom = targetZoomRef.current != null ? targetZoomRef.current : map.getZoom()
      map.jumpTo({ center: [c.lng + (lngLat[0] - c.lng) * k, c.lat + (lngLat[1] - c.lat) * k], zoom })
    } else {
      lastCameraUpdateRef.current = performance.now()
    }
  }, [markerPosition, progress, followMarker, animating, points, distances, totalDistance]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Changement de personnages : randonneurs 3D recréés ──────────────────────
  useEffect(() => {
    const el = markerElRef.current
    if (el && HIKER3D) mountHiker3d(el, characters)
  }, [activityMode, characters]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom mode activité ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || targetZoom == null || points.length < 2) return
    const center: [number, number] = progressRef.current < 0.01
      ? [points[0].lon, points[0].lat]
      : [map.getCenter().lng, map.getCenter().lat]
    // jumpTo instantané : le décompte overlay cache la transition et donne 3s complètes
    // pour charger les tuiles au bon niveau de zoom avant le début de l'animation.
    map.jumpTo({ center, zoom: targetZoom })
    flyingRef.current = false
  }, [targetZoom, zoomResetSeq]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Randonneur 3D : posé au départ, en attente, dès qu'un personnage est choisi (avant même la lecture) ──
  // Le marqueur n'est normalement créé qu'au premier pas de la lecture.
  const placeHikerAtStart = () => {
    const map = mapRef.current
    if (!map || !loadedRef.current || markerRef.current || points.length < 2 || !characters.length) return
    const el = document.createElement('div')
    markerElRef.current = el
    markerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([points[0].lon, points[0].lat]).addTo(map)
    mountHiker3d(el, characters)
  }
  useEffect(() => {
    if (!HIKER3D || progressRef.current >= 0.01 || playingRef.current) return
    if (!characters.length) {
      // Aucun personnage choisi : rien au départ.
      removePresentation()
      hiker3dTokenRef.current++
      hiker3dRef.current.forEach(s => s.dispose())
      hiker3dRef.current = []
      markerRef.current?.remove(); markerRef.current = null; markerElRef.current = null
      return
    }
    // Running : le coureur choisi est présenté en grand PAR-DESSUS la carte (qui ne bouge pas), dossard lisible,
    // jusqu'au lancement (cf. showPresentation / joinStartLine).
    const present = () => { placeHikerAtStart(); showPresentation() }
    if (loadedRef.current) present()
    else mapRef.current?.once('load', present)
  }, [characters.join(','), points]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Présentation du coureur : un personnage à part, en grand, pieds sur le bas de la carte ; son pendant au
  // départ reste caché. Au lancement, il rapetisse et glisse jusqu'au point de départ (joinStartLine). ──
  const presentRef = useRef<{ wrap: HTMLDivElement; sprite: Hiker3dSprite; token: number } | null>(null)
  const presentTokenRef = useRef(0)
  const presentScaleRef = useRef(1)
  const removePresentation = () => {
    presentTokenRef.current++
    presentRef.current?.sprite.dispose()
    presentRef.current?.wrap.remove()
    presentRef.current = null
    if (markerElRef.current) markerElRef.current.style.visibility = ''
  }
  /** Taille de la carte et échelle de présentation (cf. startPresentAt). */
  const presentLayout = () => {
    const p = presentRef.current
    const map = mapRef.current
    if (!p || !map) return null
    const { clientWidth: cw, clientHeight: ch } = map.getContainer()
    const body1 = p.sprite.layout().body / Math.max(0.01, presentScaleRef.current)
    const sp = startPresentAt(cw, ch)
    return { cw, ch, feetX: sp.feetX, feetY: sp.feetY, scale: Math.min(HIKER3D_MAX_SCALE, (ch * sp.body) / body1) }
  }
  /** Place le coureur présenté : pieds en (x, y) (px de la carte), à l'échelle `scale`. */
  const placePresented = (x: number, y: number, scale: number) => {
    const p = presentRef.current
    if (!p) return
    presentScaleRef.current = scale
    p.sprite.setScale(scale)
    const { w, h, feet } = p.sprite.layout()
    p.sprite.element.style.left = `${Math.round(x - w / 2)}px`
    p.sprite.element.style.top = `${Math.round(y - (h - feet))}px`
  }
  const showPresentation = () => {
    removePresentation()
    const map = mapRef.current
    if (!HIKER3D || !map || !characters.length || countdownRef.current !== null || playingRef.current || progressRef.current >= 0.01) return
    if (markerElRef.current) markerElRef.current.style.visibility = 'hidden'
    const token = presentTokenRef.current
    void import('../lib/hiker3dSprite').then(m => {
      if (token !== presentTokenRef.current || !m.supportsHiker3d()) return
      const wrap = document.createElement('div')
      wrap.className = 'hiker-present'
      const sprite = m.createHiker3dSprite(characters[0], { bibNumber: bibNumberRef.current })
      sprite.resetToStart()
      wrap.appendChild(sprite.element)
      map.getContainer().appendChild(wrap)
      presentRef.current = { wrap, sprite, token }
      const layout = () => {
        const L = presentLayout()
        if (L) placePresented(L.cw * L.feetX, L.ch * L.feetY, L.scale)
      }
      sprite.onFeet(layout)
      layout()
    })
  }
  /** Lancement : le coureur présenté rapetisse et glisse jusqu'au point de départ (suivi image par image, la carte
   * bougeant en même temps), puis laisse la place au personnage du départ. */
  const joinStartLine = (durationMs: number) => {
    const p = presentRef.current
    const map = mapRef.current
    const L = presentLayout()
    if (!p || !map || !L) { removePresentation(); return }
    const x0 = L.cw * L.feetX, y0 = L.ch * L.feetY, s0 = presentScaleRef.current
    const token = p.token
    const t0 = performance.now()
    const frame = (now: number) => {
      if (presentRef.current?.token !== token) return
      const t = Math.min(1, (now - t0) / durationMs), e = smoothEase(t)
      const o = map.project([points[0].lon, points[0].lat])
      const s1 = hiker3dScaleForZoom(map.getZoom(), targetZoomRef.current ?? ANIM_ZOOM) * HIKER3D_BODY_SCALE
      placePresented(x0 + (o.x - x0) * e, y0 + (o.y - y0) * e, s0 + (s1 - s0) * e)
      if (t < 1) requestAnimationFrame(frame)
      else removePresentation()
    }
    requestAnimationFrame(frame)
  }
  useEffect(() => () => removePresentation(), [])

  // ── Randonneur 3D : la marche attend la fin du dézoom de départ ──
  useEffect(() => {
    if (!startDelayMsRef) return
    // Pas de dézoom de départ en « ruban seul » : la marche part dès la fin du décompte.
    startDelayMsRef.current = HIKER3D && characters.length ? HIKER3D_START_DEZOOM_MS : 0
    return () => { startDelayMsRef.current = 0 }
  }, [startDelayMsRef, characters.length])

  // ── Dossard : numéro saisi dans le widget, reporté sur les personnages déjà montés ──
  const bibNumberRef = useRef(bibNumber)
  bibNumberRef.current = bibNumber
  useEffect(() => {
    hiker3dRef.current.forEach(s => s.setBibNumber(bibNumber))
    presentRef.current?.sprite.setBibNumber(bibNumber)
  }, [bibNumber])

  // ── Noms de rue : inscrits le long du parcours, comme dans les films (mapLabels.ts), à l'approche de la rue et tenus
  // au moins CAPTION_HOLD_S ; canvas par-dessus la carte, redessiné à chaque rendu de MapLibre ──
  const coveredM = progress * (distances[distances.length - 1] ?? 0)
  const streetCanvasRef = useRef<HTMLCanvasElement>(null)
  const streetLabels = useMemo(() => (streets ?? []).map(st => ({ ...st, label: streetLabel(st.name, st.importance) })), [streets])
  useEffect(() => {
    const map = mapRef.current, c = streetCanvasRef.current
    if (!map || !c) return
    const mps = 1000 / ANIM_SETTINGS.randonneur.secondsPerKm // vitesse de l'aperçu (m de parcours par s)
    const draw = () => {
      const { clientWidth: w, clientHeight: h } = map.getContainer()
      const dpr = window.devicePixelRatio || 1
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (!(progress > 0 && progress < 1)) return
      for (const st of streetLabels) {
        // Rues et places (nom en cercle) : à l'approche, la place reste plus longtemps (PLACE_HOLD_S).
        const a = streetLabelAlpha(coveredM, st.startM, st.endM, (st.label.place ? PLACE_HOLD_S : CAPTION_HOLD_S) * mps, 0.6 * mps)
        if (a <= 0) continue
        const pts: { x: number; y: number }[] = []
        for (let i = 0; i < distances.length && distances[i] <= st.endM; i++)
          if (distances[i] >= st.startM) pts.push(map.project([points[i].lon, points[i].lat]))
        // Fond lu sur le canvas de la carte (preserveDrawingBuffer), une fois ses tuiles chargées : nom blanc sur fond
        // sombre, noir sur fond clair.
        const bg = map.areTilesLoaded() ? { src: map.getCanvas(), scale: map.getCanvas().width / w } : null
        drawStreetAlongPath(ctx, st.label, pts, a, Math.max(0.6, w / 1920), 20, { w, h }, bg)
      }
    }
    draw()
    map.on('render', draw)
    return () => { map.off('render', draw) }
  }, [coveredM, progress, streetLabels, distances, points])

  // ── Bornes kilométriques (cf. raceSplits.ts) : couchées sur le tracé, elles apparaissent au fil de la course, à
  // l'approche (sur une boucle, pas de « 20 KM » avant « 5 KM »), et sont toutes là à la fin ──
  const borneElsRef = useRef<HTMLDivElement[]>([])
  // Ravitaillements : même apparition au fil de la course que les bornes, écriture « ravitaillement » (goutte bleue).
  const ravitoElsRef = useRef<HTMLDivElement[]>([])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ravitos?.length) return
    ravitoElsRef.current = []
    const markers = ravitos.map(r => {
      const el = document.createElement('div')
      el.innerHTML = `<div class="loc-sign loc-sign--ravito"><div class="loc-sign__board">${r.label}</div></div>`
      ravitoElsRef.current.push(el)
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.lon, r.lat]).addTo(map)
    })
    return () => { markers.forEach(m => m.remove()); ravitoElsRef.current = [] }
  }, [ravitos])
  useEffect(() => {
    if (!ravitos?.length) return
    const coveredM = progress * (distances[distances.length - 1] ?? 0)
    ravitos.forEach((r, i) => {
      const el = ravitoElsRef.current[i]
      if (el) el.style.visibility = progress >= 1 || borneReached(r, coveredM) ? '' : 'hidden'
    })
  }, [ravitos, progress, distances])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !bornes?.length) return
    borneElsRef.current = []
    const markers = bornes.map(b => {
      const el = document.createElement('div')
      const time = borneTimeLine(b)
      // Médaille (même dessin que buildBorneMedalSprite dans filmExport.ts) : km dans le jeton, heure · chrono dessous.
      el.innerHTML = `<div class="loc-sign loc-sign--borne"><div class="borne-medal">` +
        `<span class="borne-medal__num">${borneNumber(b)}</span><span class="borne-medal__km">K M</span></div>` +
        (time ? `<div class="borne-medal__time">${time}</div>` : '') + '<div class="borne-medal__tip"></div></div>'
      borneElsRef.current.push(el)
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([b.lon, b.lat]).addTo(map)
    })
    return () => { markers.forEach(m => m.remove()); borneElsRef.current = [] }
  }, [bornes])
  useEffect(() => {
    if (!bornes?.length) return
    const all = progress >= 1
    const coveredM = progress * (distances[distances.length - 1] ?? 0)
    bornes.forEach((b, i) => {
      const el = borneElsRef.current[i]
      if (el) el.style.visibility = all || borneReached(b, coveredM) ? '' : 'hidden'
    })
  }, [bornes, progress, distances])
  // Course commencée (lecture, barre de lecture) : plus de coureur présenté en grand.
  useEffect(() => { if (progress >= 0.01 && presentRef.current) removePresentation() }, [progress])

  // ── Randonneur 3D : sa taille suit le zoom de la carte (plans serrés de départ et d'arrivée) ──
  useEffect(() => {
    const map = mapRef.current
    if (!HIKER3D || !map) return
    const onZoom = () => layoutHiker3d()
    map.on('zoom', onZoom)
    return () => { map.off('zoom', onZoom) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Randonneur 3D : décompte de départ = zoom serré sur lui, il se lève (ou attend) ──
  const prevCountdownRef = useRef<number | null>(null)
  useEffect(() => {
    const was = prevCountdownRef.current
    prevCountdownRef.current = countdown
    if (!HIKER3D || !characters.length) return // « ruban seul » : ni plan serré ni dézoom
    if (countdown === null && was !== null && !playingRef.current && progressRef.current < 0.01) {
      // Fin du décompte : dézoom à vitesse normale, les personnages toujours en attente ; la marche ne démarre
      // qu'une fois le dézoom fini (startDelayMsRef, usePlaybackCountdown).
      const map = mapRef.current
      if (!map || points.length < 2) return
      // Ils pivotent vers le chemin pendant le dézoom, pour partir directement dans le bon sens.
      const d0 = headingToScreen(getTrackPacing(points, distances).headingAt(0))
      hikerDirRef.current = d0
      hiker3dRef.current.forEach(s => s.turnTo(d0.x, d0.y))
      flyingRef.current = true
      map.once('moveend', () => { flyingRef.current = false })
      map.easeTo({ center: [points[0].lon, points[0].lat], zoom: targetZoomRef.current ?? ANIM_ZOOM, duration: HIKER3D_START_DEZOOM_MS, easing: smoothEase, essential: true })
      // Coureur présenté en grand : pendant que la carte zoome sur le départ, il rapetisse jusqu'à sa taille de
      // course, pieds sur le point de départ.
      if (presentRef.current) {
        presentRef.current.sprite.turnTo(d0.x, d0.y)
        joinStartLine(HIKER3D_START_DEZOOM_MS)
      }
      return
    }
    if (countdown === null || was !== null) return
    hiker3dRef.current.forEach(s => { s.resetToStart(); s.startIntro() })
    const map = mapRef.current
    if (!map || points.length < 2 || progressRef.current >= 0.01) return
    placeHikerAtStart()
    // Coureur présenté en grand : il reste en grand, carte immobile, pendant le décompte (voir la fin du décompte).
    if (presentRef.current) return
    map.jumpTo({ center: [points[0].lon, points[0].lat], zoom: (targetZoomRef.current ?? map.getZoom()) + HIKER3D_CLOSE_ZOOM })
  }, [countdown]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Marqueurs de col permanents ───────────────────────────────────────────
  const colMapMarkersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    const map = mapRef.current
    colMapMarkersRef.current.forEach(m => m.remove())
    colMapMarkersRef.current = []
    if (!map || colMarkers.length === 0) return

    const place = () => {
      colMapMarkersRef.current.forEach(m => m.remove())
      colMapMarkersRef.current = []
      for (const col of colMarkers.filter(c => c.name !== 'Col')) {
        const el = document.createElement('div')
        el.innerHTML = `
          <div class="loc-sign loc-sign--col">
            <div class="loc-sign__board">
              <span class="loc-sign__col-name">${col.name.toUpperCase()}</span>
              <span class="loc-sign__col-ele">Alt. ${col.ele} m</span>
            </div>
            <div class="loc-sign__pole"></div>
          </div>`
        colMapMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([col.lon, col.lat])
            .addTo(map)
        )
      }
    }
    if (loadedRef.current) place()
    else map.once('load', place)
  }, [colMarkers])

  // ── Panneaux localité ────────────────────────────────────────────────────
  const localityMarkersRef = useRef<maplibregl.Marker[]>([])
  const activeLocalityRef  = useRef<{ marker: maplibregl.Marker; score: number; timerId: ReturnType<typeof setTimeout>; shownAt: number } | null>(null)
  const queuedLocalityRef  = useRef<LocalityInfo | null>(null)
  const shownLocalityKeysRef = useRef<Set<string>>(new Set())
  const lastShownPosRef      = useRef<{ lon: number; lat: number } | null>(null)
  const customTriggerCacheRef = useRef<Map<string, { posKey: string; triggerDist: number }>>(new Map())
  const LOW_SCORE_DEDUP_KM = localityDedupKm
  const panelDurationRef = useRef(panelDuration)
  useEffect(() => { panelDurationRef.current = panelDuration }, [panelDuration])
  const onSuppressLocalityRef = useRef(onSuppressLocality)
  useEffect(() => { onSuppressLocalityRef.current = onSuppressLocality }, [onSuppressLocality])
  const onRestoreLocalityRef = useRef(onRestoreLocality)
  useEffect(() => { onRestoreLocalityRef.current = onRestoreLocality }, [onRestoreLocality])
  const onMoveCustomLocalityRef = useRef(onMoveCustomLocality)
  useEffect(() => { onMoveCustomLocalityRef.current = onMoveCustomLocality }, [onMoveCustomLocality])

  // Localités intermédiaires sélectionnées par l'utilisateur en preview (toutes sélectionnées par défaut)
  const [selectedLocalities, setSelectedLocalities] = useState<ReadonlySet<string>>(new Set())

  // Modifications utilisateur sur les panneaux preview (persistées pendant l'animation)
  const suppressedLocalitiesRef = useRef<Set<string>>(new Set())
  const movedLocalitiesRef      = useRef<Map<string, { lon: number; lat: number }>>(new Map())

  useEffect(() => {
    localityMarkersRef.current.forEach(m => m.remove())
    localityMarkersRef.current = []
    if (activeLocalityRef.current) {
      clearTimeout(activeLocalityRef.current.timerId)
      activeLocalityRef.current = null
    }
    queuedLocalityRef.current = null
    shownLocalityKeysRef.current.clear()
    lastShownPosRef.current = null
    suppressedLocalitiesRef.current.clear()
    movedLocalitiesRef.current.clear()
    customTriggerCacheRef.current.clear()
    setSelectedLocalities(new Set())
  }, [points])

  useEffect(() => {
    suppressedLocalitiesRef.current.clear()
  }, [activityMode])

  // Initialise la sélection avec toutes les localités (toutes sélectionnées par défaut)
  useEffect(() => {
    setSelectedLocalities(new Set((previewLocalities ?? []).map(l => l.name)))
  }, [previewLocalities])

  // showLocality extrait en callback stable (utilise uniquement des refs)
  const showLocality = useCallback((loc: LocalityInfo) => {
    const map = mapRef.current
    if (!map) return
    const el = document.createElement('div')
    el.innerHTML = `<div class="${signOuterClass(loc)}">${signBoardHtml(loc, true)}</div>`
    const movedPos = movedLocalitiesRef.current.get(loc.name) ?? movedLocalitiesRef.current.get(`custom:${loc.name}`)
    const markerLon = movedPos?.lon ?? loc.lon
    const markerLat = movedPos?.lat ?? loc.lat
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: false })
      .setLngLat([markerLon, markerLat])
      .addTo(map)
    marker.on('dragend', () => {
      const pos = marker.getLngLat()
      const moved = { lon: pos.lng, lat: pos.lat }
      movedLocalitiesRef.current.set(loc.name, moved)
      movedLocalitiesRef.current.set(`custom:${loc.name}`, moved)
    })
    localityMarkersRef.current.push(marker)
    function suppressMarker() {
      clearTimeout(timerId)
      suppressedLocalitiesRef.current.add(loc.name)
      onSuppressLocalityRef.current?.(loc.name)
      // Feedback visuel : grise le panneau puis retire
      const board = el.querySelector('.loc-sign__board') as HTMLElement | null
      if (board) { board.style.opacity = '0.35'; board.style.filter = 'grayscale(1)' }
      setTimeout(() => {
        marker.remove()
        localityMarkersRef.current = localityMarkersRef.current.filter(m => m !== marker)
        if (activeLocalityRef.current?.marker === marker) { activeLocalityRef.current = null; lastShownPosRef.current = null }
        shownLocalityKeysRef.current.delete(`loc:${loc.name}`)
        if (localityMarkersRef.current.length === 0) lastShownPosRef.current = null
      }, 500)
    }

    // Clic sur le panneau lui-même ou sur ×
    const board = el.querySelector('.loc-sign__board') as HTMLElement | null
    board?.addEventListener('click', e => { e.stopPropagation(); suppressMarker() })
    const closeBtn = el.querySelector('.loc-sign__close')
    closeBtn?.addEventListener('mousedown', e => e.stopPropagation())
    const timerId = setTimeout(() => {
      marker.remove()
      localityMarkersRef.current = localityMarkersRef.current.filter(m => m !== marker)
      if (activeLocalityRef.current?.marker === marker) {
        activeLocalityRef.current = null
        lastShownPosRef.current = null
      }
      if (localityMarkersRef.current.length === 0) lastShownPosRef.current = null
    }, panelDurationRef.current)
    const key = `loc:${loc.name}`
    shownLocalityKeysRef.current.add(key)
    lastShownPosRef.current = { lon: loc.lon, lat: loc.lat }
    activeLocalityRef.current = { marker, score: loc.score ?? 0, timerId, shownAt: Date.now() }
  }, [])

  // ── Wizard étape 3 : affiche/masque les localités en temps réel selon externalSuppressed ──
  useEffect(() => {
    if (!wizardPanelStep || !previewLocalities?.length) return
    const map = mapRef.current
    if (!map) return
    localityMarkersRef.current.forEach(m => m.remove())
    localityMarkersRef.current = []
    // Ne pas dupliquer le panneau départ/arrivée (déjà affiché par son propre marqueur) si une
    // localité intermédiaire détectée porte le même nom (ex: le tracé se termine dans la ville).
    const normN = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[''ʼ]/g, "'").replace(/^(le |la |les |l')/, '').replace(/[-\s]+/g, '').replace(/'/g, '')
    const epNorms = new Set([departureNameOverride, arrivalNameOverride].filter(Boolean).map(n => normN(n!)))
    for (const loc of previewLocalities) {
      if (epNorms.has(normN(loc.name))) continue
      const isExcluded = externalSuppressed?.has(loc.name)
      const el = document.createElement('div')
      const isLieuDit = loc.placeType === 'hamlet' || loc.placeType === 'locality'
      const signClass = isLieuDit ? 'loc-sign loc-sign--lieudit' : 'loc-sign'
      const excludedClass = isExcluded ? ' loc-sign--unselected' : ''
      const nameStr = loc.name
      el.innerHTML = `<div class="${signClass}${excludedClass}"><div class="loc-sign__board">${nameStr}</div><div class="loc-sign__pole"></div></div>`
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: false })
        .setLngLat([loc.lon, loc.lat])
        .addTo(map)
      localityMarkersRef.current.push(marker)
    }
  }, [wizardPanelStep, previewLocalities, externalSuppressed, departureNameOverride, arrivalNameOverride])

  // ── Fin d'animation : affiche toutes les localités visitées simultanément ──
  useEffect(() => {
    if (!animationEnded) {
      // Redémarrage : effacer les marqueurs de fin pour qu'ils réapparaissent au fil du tracé
      localityMarkersRef.current.forEach(m => m.remove())
      localityMarkersRef.current = []
      shownLocalityKeysRef.current.clear()
      lastShownPosRef.current = null
      if (activeLocalityRef.current) {
        clearTimeout(activeLocalityRef.current.timerId)
        activeLocalityRef.current = null
      }
      // Sortie de la fin (relecture, curseur déplacé) : le personnage quitte sa pose d'arrivée et réapparaît.
      hiker3dRef.current.forEach(s => { if (progressRef.current >= 0.01) s.skipToWalk(); else s.resetToStart() })
      hiker3dRef.current.forEach(s => { s.element.style.transition = ''; s.element.style.opacity = '' })
      return
    }
    if (!previewLocalities?.length) return
    const map = mapRef.current
    if (!map) return
    // Supprimer les panneaux transitoires en cours
    if (activeLocalityRef.current) {
      clearTimeout(activeLocalityRef.current.timerId)
      activeLocalityRef.current.marker.remove()
      activeLocalityRef.current = null
    }
    localityMarkersRef.current.forEach(m => m.remove())
    localityMarkersRef.current = []
    // Réafficher toutes les localités non-supprimées, sans timer. Les panneaux ajoutés
    // manuellement (col compris) sont gérés séparément par l'effet customLocalities-driven,
    // qui les affiche aussi bien avant la lecture qu'une fois l'animation terminée.
    // Départ/arrivée : déjà affichés par leurs propres marqueurs, on n'en double pas un de même nom.
    const normEnd = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[''ʼ]/g, "'").replace(/^(le |la |les |l')/, '').replace(/[-\s]+/g, '').replace(/'/g, '')
    const epNormsEnd = new Set([
      departureNameOverride || fetchedDepName || depNameRef.current,
      arrivalNameOverride || fetchedArrName || arrNameRef.current,
    ].filter(Boolean).map(n => normEnd(n!)))
    for (const loc of previewLocalities) {
      if (suppressedLocalitiesRef.current.has(loc.name) || externalSuppressed?.has(loc.name)) continue
      if (epNormsEnd.has(normEnd(loc.name))) continue
      const el = document.createElement('div')
      el.innerHTML = `<div class="${signOuterClass(loc)}">${signBoardHtml(loc, false)}</div>`
      const movedPos = movedLocalitiesRef.current.get(loc.name)
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([movedPos?.lon ?? loc.lon, movedPos?.lat ?? loc.lat])
        .addTo(map)
      localityMarkersRef.current.push(marker)
    }

    // Randonneurs 3D : la marche s'arrête (la séquence d'arrivée prend le relais).
    hiker3dRef.current.forEach(s => s.setPlaying(false))
  }, [animationEnded, previewLocalities, externalSuppressed, departureNameOverride, arrivalNameOverride, fetchedDepName, fetchedArrName])

  // Randonneurs 3D : libérés au démontage de la carte.
  useEffect(() => () => {
    hiker3dTokenRef.current++
    cancelAnimationFrame(hikerLayoutRafRef.current)
    hiker3dRef.current.forEach(s => s.dispose())
    hiker3dRef.current = []
  }, [])

  // Pause/reprise des randonneurs 3D
  useEffect(() => {
    if (animationEnded) return
    hiker3dRef.current.forEach(s => s.setPlaying(!!playing))
  }, [playing, animationEnded])

  // Effet useLocality → affiche les localités détectées dynamiquement (col inclus)
  useEffect(() => {
    localityRef.current = locality ?? null
    const map = mapRef.current
    if (!map || !locality || locality.type === 'col') return
    if (progressRef.current < 0.01 && !playingRef.current) return
    const normLoc = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[''ʼ]/g, "'").replace(/^(le |la |les |l')/, '').replace(/[-\s]+/g, '').replace(/'/g, '')
    const locNorm = normLoc(locality.name)
    const effectiveDepName = departureNameOverride || fetchedDepName || depNameRef.current
    const effectiveArrName = arrivalNameOverride || fetchedArrName || arrNameRef.current
    if ([effectiveDepName, effectiveArrName].some(n => n && normLoc(n) === locNorm)) return

    const addMarker = () => {
      if (suppressedLocalitiesRef.current.has(locality.name) || externalSuppressed?.has(locality.name)) return
      if (shownLocalityKeysRef.current.has(`loc:${locality.name}`)) return
      const newScore = locality.score ?? 0
      const mandatory = newScore >= localityDedupMinScore
      if (!mandatory && lastShownPosRef.current) {
        const R = 6371
        const dLat = (locality.lat - lastShownPosRef.current.lat) * Math.PI / 180
        const dLon = (locality.lon - lastShownPosRef.current.lon) * Math.PI / 180
        const a = Math.sin(dLat/2)**2 + Math.cos(lastShownPosRef.current.lat * Math.PI/180) * Math.cos(locality.lat * Math.PI/180) * Math.sin(dLon/2)**2
        const distKm = R * 2 * Math.asin(Math.sqrt(a))
        if (distKm < LOW_SCORE_DEDUP_KM) {
          const currentScore = activeLocalityRef.current?.score ?? 0
          if (newScore <= currentScore) return
          localityMarkersRef.current.forEach(m => m.remove())
          localityMarkersRef.current = []
          if (activeLocalityRef.current) { clearTimeout(activeLocalityRef.current.timerId); activeLocalityRef.current = null }
          shownLocalityKeysRef.current.clear()
        }
      }
      showLocality(locality)
    }

    if (loadedRef.current) addMarker()
    else map.once('load', addMarker)
  }, [locality, fetchedDepName, fetchedArrName, departureNameOverride, arrivalNameOverride, showLocality]) // eslint-disable-line react-hooks/exhaustive-deps

  // Catch-up : si previewLocalities arrive après que l'animation a déjà commencé,
  // affiche immédiatement les localités dont le point du tracé le plus proche est déjà dépassé.
  const prevPreviewLenRef = useRef(0)
  useEffect(() => {
    const newLen = previewLocalities?.length ?? 0
    const prev = prevPreviewLenRef.current
    prevPreviewLenRef.current = newLen
    if (prev > 0 || newLen === 0 || progress < 0.01 || !points.length) return

    const total = distances[distances.length - 1] || 1
    const covered = progress * total
    const normN = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[''ʼ]/g, "'").replace(/^(le |la |les |l')/, '').replace(/[-\s]+/g, '').replace(/'/g, '')
    const effectiveDepName = departureNameOverride || ''
    const effectiveArrName = arrivalNameOverride || ''
    const epNorms = new Set([effectiveDepName, effectiveArrName].filter(Boolean).map(n => normN(n)))

    for (const loc of previewLocalities!) {
      if (shownLocalityKeysRef.current.has(`loc:${loc.name}`)) continue
      if (suppressedLocalitiesRef.current.has(loc.name) || externalSuppressed?.has(loc.name)) continue
      if (epNorms.has(normN(loc.name))) continue
      // Trouver la distance du tracé au point le plus proche de la localité
      let minDist = Infinity, closestTrackDist = 0
      for (let i = 0; i < points.length; i++) {
        const dx = (loc.lon - points[i].lon) * 111320 * Math.cos(loc.lat * Math.PI / 180)
        const dy = (loc.lat - points[i].lat) * 110540
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < minDist) { minDist = d; closestTrackDist = distances[i] }
      }
      if (closestTrackDist <= covered) showLocality(loc)
    }
  }, [previewLocalities, progress, points, distances, departureNameOverride, arrivalNameOverride, showLocality]) // eslint-disable-line react-hooks/exhaustive-deps

  // Effet previewLocalities → pilote l'animation directement depuis la liste validée
  // Garantit que toutes les localités sélectionnées s'affichent (sans dépendre du trigger 400m)
  useEffect(() => {
    if (progress < 0.01) return
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    if (!previewLocalities?.length || !points.length) return

    const normN = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[''ʼ]/g, "'").replace(/^(le |la |les |l')/, '').replace(/[-\s]+/g, '').replace(/'/g, '')
    const effectiveDepName = departureNameOverride || fetchedDepName || depNameRef.current
    const effectiveArrName = arrivalNameOverride || fetchedArrName || arrNameRef.current
    const epNorms = new Set([effectiveDepName, effectiveArrName].filter(Boolean).map(n => normN(n!)))

    const total = distances[distances.length - 1] || 1
    const covered = progress * total
    const ghostDist = Math.min(covered + 150, total)

    // Position du fantôme
    let gLon = points[0].lon, gLat = points[0].lat
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] >= ghostDist) {
        const t = (ghostDist - distances[i - 1]) / (distances[i] - distances[i - 1])
        gLon = points[i - 1].lon + t * (points[i].lon - points[i - 1].lon)
        gLat = points[i - 1].lat + t * (points[i].lat - points[i - 1].lat)
        break
      }
    }

    // Seuils de proximité par type de lieu (localités OSM)
    const PROX: Record<string, number> = { city: 5000, town: 3000, village: 800, hamlet: 400, locality: 300 }

    // Localités OSM : proximité du fantôme
    for (const loc of previewLocalities ?? []) {
      if (shownLocalityKeysRef.current.has(`loc:${loc.name}`)) continue
      if (suppressedLocalitiesRef.current.has(loc.name) || externalSuppressed?.has(loc.name)) continue
      if (epNorms.has(normN(loc.name))) continue
      const prox = PROX[loc.placeType ?? 'hamlet'] ?? 400
      const dx = (loc.lon - gLon) * 111320 * Math.cos(gLat * Math.PI / 180)
      const dy = (loc.lat - gLat) * 110540
      if (Math.sqrt(dx * dx + dy * dy) > prox) continue
      showLocality(loc)
    }

    // Localités custom : déclenchement basé sur la distance le long du tracé
    // (utilise la position déplacée si l'utilisateur a déplacé le panneau)
    // Le point du tracé le plus proche est mis en cache (par position) pour éviter
    // de reparcourir tous les points du tracé à chaque frame (60x/s) tant que la
    // localité n'a pas encore été déclenchée.
    for (const loc of customLocalities ?? []) {
      if (shownLocalityKeysRef.current.has(`loc:${loc.name}`)) continue
      if (suppressedLocalitiesRef.current.has(loc.name) || externalSuppressed?.has(loc.name)) continue
      const refPos = movedLocalitiesRef.current.get(loc.name)
        ?? movedLocalitiesRef.current.get(`custom:${loc.name}`)
        ?? { lon: loc.lon, lat: loc.lat }
      const posKey = `${refPos.lon},${refPos.lat}`
      const cached = customTriggerCacheRef.current.get(loc.name)
      let triggerDist: number
      if (cached && cached.posKey === posKey) {
        triggerDist = cached.triggerDist
      } else {
        // Point du tracé le plus proche de la position de référence
        let minDist = Infinity
        triggerDist = 0
        for (let i = 0; i < points.length; i++) {
          const dx = (refPos.lon - points[i].lon) * 111320 * Math.cos(refPos.lat * Math.PI / 180)
          const dy = (refPos.lat - points[i].lat) * 110540
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < minDist) { minDist = d; triggerDist = distances[i] }
        }
        customTriggerCacheRef.current.set(loc.name, { posKey, triggerDist })
      }
      if (covered < triggerDist) continue
      showLocality(loc)
    }
  }, [progress, previewLocalities, customLocalities, points, distances, departureNameOverride, arrivalNameOverride, fetchedDepName, fetchedArrName, showLocality]) // eslint-disable-line react-hooks/exhaustive-deps

  // Masque le randonneur dès que la lecture est terminée
  useEffect(() => {
    if (!markerRef.current) return
    // Randonneur 3D : il reste à l'arrivée pour saluer (séquence de fin).
    const hide = !HIKER3D && (animationEnded || progress >= 1)
    markerRef.current.getElement().style.display = hide ? 'none' : ''
  }, [progress, animationEnded])

  // ── Marqueurs preview (avant lecture) ────────────────────────────────────
  const previewMarkersRef = useRef<maplibregl.Marker[]>([])
  // Fonction de placement stockée ici pour être appelée depuis le handler load de la carte
  const pendingPreviewRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const map = mapRef.current
    const shouldShow = progress < 0.01 && !playing && !!previewLocalities?.length

    // Nettoyer les marqueurs existants et la fonction en attente
    previewMarkersRef.current.forEach(m => m.remove())
    previewMarkersRef.current = []
    pendingPreviewRef.current = null

    if (!shouldShow || !map) return

    const locs = previewLocalities!

    const place = () => {
      // Re-vérifier l'état au moment du placement (cas où la carte charge après le fetch Overpass)
      if (playingRef.current || progressRef.current >= 0.01) return
      // Restaurer le tracé pointillé complet (peut avoir été effacé par une lecture précédente)
      if (points.length >= 2) {
        const fullFC: FeatureCollection = {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: smoothedCoords }, properties: {} }],
        }
        ;(map.getSource('track-full') as maplibregl.GeoJSONSource | undefined)?.setData(fullFC)
      }
      previewMarkersRef.current.forEach(m => m.remove())
      previewMarkersRef.current = []
      // Normalise un nom : minuscules, sans accents, apostrophes et séparateurs uniformisés
      const norm = (s: string) => s.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // retire accents
        .replace(/['’ʼ]/g, "'")                    // uniformise apostrophes → '
        .replace(/^(le |la |les |l')/, '')                   // retire article initial
        .replace(/[-\s]+/g, '')                              // retire tirets et espaces
        .replace(/'/g, '')                                    // retire apostrophes restantes
      // Exclure uniquement le nom affiché sur le marqueur endpoint (override prioritaire)
      const effectiveDepName = departureNameOverride || fetchedDepName || detectedDepartureName || depNameRef.current
      const effectiveArrName = arrivalNameOverride || fetchedArrName || detectedArrivalName || arrNameRef.current
      const epNorms = new Set([effectiveDepName, effectiveArrName].filter(Boolean).map(n => norm(n!)))
      for (const loc of locs) {
        // Ne pas dupliquer un marqueur endpoint déjà affiché (même nom normalisé)
        if (epNorms.has(norm(loc.name))) continue
        const el = document.createElement('div')
        const isLieuDit = loc.placeType === 'hamlet' || loc.placeType === 'locality'
        const isSelected = selectedLocalities.has(loc.name)
          && !externalSuppressed?.has(loc.name)
          && !suppressedLocalitiesRef.current.has(loc.name)
        const baseClass = isLieuDit ? 'loc-sign loc-sign--lieudit loc-sign--preview' : 'loc-sign loc-sign--preview'
        const selClass = isSelected ? ' loc-sign--selected' : ' loc-sign--unselected'
        const nameStr = loc.name
        el.innerHTML = `<div class="${baseClass}${selClass}"><div class="loc-sign__board">${nameStr}</div><div class="loc-sign__pole"></div></div>`
        const movedPos = movedLocalitiesRef.current.get(loc.name)
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: false })
          .setLngLat([movedPos?.lon ?? loc.lon, movedPos?.lat ?? loc.lat])
          .addTo(map)
        marker.on('dragend', () => {
          const pos = marker.getLngLat()
          movedLocalitiesRef.current.set(loc.name, { lon: pos.lng, lat: pos.lat })
        })
        previewMarkersRef.current.push(marker)
        // Clic sur le panneau : basculer sélection. La source de vérité est l'état masqué
        // courant (interne + `externalSuppressed` remonté du hook) — sinon un panneau masqué
        // pendant la lecture de l'aperçu ne pourrait plus jamais être réactivé.
        const board = el.querySelector('.loc-sign__board') as HTMLElement | null
        board?.addEventListener('click', e => {
          e.stopPropagation()
          const signEl = el.querySelector('.loc-sign')
          const currentlySuppressed = suppressedLocalitiesRef.current.has(loc.name)
            || externalSuppressed?.has(loc.name)
          if (currentlySuppressed) {
            suppressedLocalitiesRef.current.delete(loc.name)
            onRestoreLocalityRef.current?.(loc.name)
            setSelectedLocalities(prev => new Set(prev).add(loc.name))
            signEl?.classList.add('loc-sign--selected')
            signEl?.classList.remove('loc-sign--unselected')
          } else {
            suppressedLocalitiesRef.current.add(loc.name)
            onSuppressLocalityRef.current?.(loc.name)
            setSelectedLocalities(prev => {
              const next = new Set(prev)
              next.delete(loc.name)
              return next
            })
            signEl?.classList.remove('loc-sign--selected')
            signEl?.classList.add('loc-sign--unselected')
          }
        })
      }
    }

    if (loadedRef.current) {
      place()
    } else {
      // Stocker pour être appelé depuis le handler load de la carte
      pendingPreviewRef.current = place
    }
  }, [previewLocalities, playing, progress, departureNameOverride, arrivalNameOverride, detectedDepartureName, detectedArrivalName, fetchedDepName, fetchedArrName, selectedLocalities, externalSuppressed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Panneaux custom (ajoutés manuellement) ───────────────────────────────
  const customMarkersRef = useRef<maplibregl.Marker[]>([])
  const pendingCustomRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const map = mapRef.current
    customMarkersRef.current.forEach(m => m.remove())
    customMarkersRef.current = []
    // Affiché avant la lecture ET une fois l'animation terminée (progress ≈ 1) — pendant la
    // lecture, ces panneaux passent par l'effet previewLocalities-driven (showLocality), qui
    // gère leur minuterie. Sans le cas « animation terminée », les panneaux ajoutés (col
    // compris) disparaissaient définitivement dès la fin de l'aperçu.
    const finished = progress >= 0.999
    if (!map || customLocalities.length === 0 || playing || (progress >= 0.01 && !finished)) return

    const place = () => {
      customMarkersRef.current.forEach(m => m.remove())
      customMarkersRef.current = []
      for (const loc of customLocalities) {
        const el = document.createElement('div')
        const movedPos = movedLocalitiesRef.current.get(`custom:${loc.name}`)
        el.innerHTML = `<div class="${signOuterClass(loc)}">${signBoardHtml(loc, true)}</div>`
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true })
          .setLngLat([movedPos?.lon ?? loc.lon, movedPos?.lat ?? loc.lat])
          .addTo(map)
        marker.on('dragend', () => {
          const pos = marker.getLngLat()
          const moved = { lon: pos.lng, lat: pos.lat }
          movedLocalitiesRef.current.set(`custom:${loc.name}`, moved)
          movedLocalitiesRef.current.set(loc.name, moved)
          // Remonter la position au state pour que le film 2D/3D suive le panneau déplacé.
          onMoveCustomLocalityRef.current?.(loc.name, pos.lng, pos.lat)
        })
        customMarkersRef.current.push(marker)
        const closeBtn = el.querySelector('.loc-sign__close')
        closeBtn?.addEventListener('mousedown', e => e.stopPropagation())
        closeBtn?.addEventListener('click', e => {
          e.stopPropagation()
          marker.remove()
          customMarkersRef.current = customMarkersRef.current.filter(m => m !== marker)
          movedLocalitiesRef.current.delete(`custom:${loc.name}`)
          onRemoveCustomLocality?.(loc.name)
        })
      }
    }

    if (loadedRef.current) {
      place()
    } else {
      pendingCustomRef.current = place
    }
  }, [customLocalities, playing, progress]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Marqueurs départ/arrivée ─────────────────────────────────────────────────
  // Coordonnées géocodées stockées en refs, placement piloté par les overrides
  const arrivalMarkerRef  = useRef<maplibregl.Marker | null>(null)
  const depCoordsRef      = useRef<{ lon: number; lat: number } | null>(null)
  const arrCoordsRef      = useRef<{ lon: number; lat: number } | null>(null)

  // Géocodage : stocke les coordonnées + noms pour déduplication, sans placer de marqueur
  useEffect(() => {
    departureMarkerRef.current?.remove(); departureMarkerRef.current = null
    arrivalMarkerRef.current?.remove();   arrivalMarkerRef.current   = null
    depCoordsRef.current = null
    arrCoordsRef.current = null
    depNameRef.current   = null
    arrNameRef.current   = null
    setFetchedDepName(null)
    setFetchedArrName(null)
    if (points.length < 2) return
    let cancelled = false
    Promise.all([
      fetchLocalityInfo(points[0].lon, points[0].lat).catch(() => null),
      fetchLocalityInfo(points[points.length - 1].lon, points[points.length - 1].lat).catch(() => null),
    ]).then(([dep, arr]) => {
      if (cancelled) return
      depCoordsRef.current = dep ? { lon: dep.lon, lat: dep.lat } : { lon: points[0].lon, lat: points[0].lat }
      arrCoordsRef.current = arr ? { lon: arr.lon, lat: arr.lat } : { lon: points[points.length - 1].lon, lat: points[points.length - 1].lat }
      depNameRef.current  = dep?.name ?? null
      arrNameRef.current  = arr?.name ?? null
      setFetchedDepName(dep?.name ?? null)
      setFetchedArrName(arr?.name ?? null)
    })
    return () => { cancelled = true }
  }, [points])

  // Placement / mise à jour / suppression des marqueurs selon les overrides du wizard
  const makeEndpointEl = (name: string, colEle: number | undefined, lieudit: boolean | undefined, ref: React.MutableRefObject<maplibregl.Marker | null>) => {
    const el = document.createElement('div')
    // Départ / arrivée sur un col : même panneau que les cols (nom + altitude), sinon panneau localité.
    const loc: LocalityInfo = colEle != null
      ? { type: 'col', name, ele: colEle, lon: 0, lat: 0 }
      : { type: 'locality', name, lon: 0, lat: 0, placeType: lieudit ? 'hamlet' : undefined }
    el.innerHTML = `<div class="${signOuterClass(loc)}">${signBoardHtml(loc, true)}</div>`
    const btn = el.querySelector('.loc-sign__close')
    btn?.addEventListener('mousedown', e => e.stopPropagation())
    btn?.addEventListener('click', e => { e.stopPropagation(); ref.current?.remove(); ref.current = null })
    return el
  }

  useEffect(() => {
    if (departureNameOverride === undefined) {
      departureMarkerRef.current?.remove(); departureMarkerRef.current = null; return
    }
    const coords = depCoordsRef.current ?? (points[0] ? { lon: points[0].lon, lat: points[0].lat } : null)
    if (!coords || !mapRef.current) return
    const place = () => {
      // Recréé à chaque changement (nom ou style col/localité) en gardant la position s'il a été déplacé.
      const at = departureMarkerRef.current?.getLngLat() ?? { lng: coords.lon, lat: coords.lat }
      departureMarkerRef.current?.remove()
      const el = makeEndpointEl(departureNameOverride, departureColEle, departureLieudit, departureMarkerRef)
      el.classList.add('loc-sign-anchor--depart') // au premier plan, devant la coureuse (cf. START_SIGN_OFFSET_PX)
      departureMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true })
        .setLngLat(at).addTo(mapRef.current!)
    }
    if (loadedRef.current) place(); else mapRef.current.once('load', place)
  }, [departureNameOverride, departureColEle, departureLieudit, points])

  useEffect(() => {
    if (arrivalNameOverride === undefined) {
      arrivalMarkerRef.current?.remove(); arrivalMarkerRef.current = null; return
    }
    const coords = arrCoordsRef.current ?? (points.length > 0 ? { lon: points[points.length-1].lon, lat: points[points.length-1].lat } : null)
    if (!coords || !mapRef.current) return
    const place = () => {
      const at = arrivalMarkerRef.current?.getLngLat() ?? { lng: coords.lon, lat: coords.lat }
      arrivalMarkerRef.current?.remove()
      arrivalMarkerRef.current = new maplibregl.Marker({ element: makeEndpointEl(arrivalNameOverride, arrivalColEle, arrivalLieudit, arrivalMarkerRef), anchor: 'bottom', draggable: true })
        .setLngLat(at).addTo(mapRef.current!)
    }
    if (loadedRef.current) place(); else mapRef.current.once('load', place)
  }, [arrivalNameOverride, arrivalColEle, arrivalLieudit, points])

  // Dépôt d'un panneau ajouté glissé depuis la liste de l'assistant (panelDrag.ts) : posé au point du
  // tracé le plus proche du point de dépôt. La position « déplacée » interne est mise à jour aussi,
  // sinon le marqueur resterait à son ancienne place (elle prime sur lon/lat dans l'effet de placement).
  const onDragOver = (e: React.DragEvent) => {
    if (!isPanelDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (e: React.DragEvent) => {
    const map = mapRef.current
    if (!map || !isPanelDrag(e) || points.length === 0) return
    e.preventDefault()
    const name = e.dataTransfer.getData(PANEL_DRAG_MIME)
    const rect = map.getCanvasContainer().getBoundingClientRect()
    const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
    const p = snapToTrack(points, ll.lng, ll.lat)
    const moved = { lon: p.lon, lat: p.lat }
    movedLocalitiesRef.current.set(`custom:${name}`, moved)
    movedLocalitiesRef.current.set(name, moved)
    onMoveCustomLocalityRef.current?.(name, p.lon, p.lat)
  }

  return (
    <div className="track-map" onDragOver={onDragOver} onDrop={onDrop}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas ref={streetCanvasRef} className="street-labels" aria-hidden="true" />
    </div>
  )
}
