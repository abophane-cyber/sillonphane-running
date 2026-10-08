/**
 * Export vidéo du survol 3D (modèle Relive : pas d'aperçu temps réel, on livre une vidéo rendue).
 *
 * Rendu HORS ÉCRAN, image par image, à résolution et framerate fixes (1920×1080 / 30 fps) :
 *   1. pas de temps fixe (`1/fps` par frame, aucune horloge) -> rendu déterministe, rejouable ;
 *   2. frames -> `VideoFrame` -> `mp4-muxer` (repli MediaRecorder), sur le modèle de filmExport.ts ;
 *   3. phase « préparation du terrain » : tous les fetch tuiles/DEM/WFS AVANT la 1re frame, avec
 *      progression et abandon propre en cas d'échec (pas de vidéo à moitié trouée).
 *
 * Points todolist encore à faire ICI (après visionnage du 1er rendu) :
 *   - (4) réactiver les ombres douces (PCFSoftShadowMap) : gratuit en offline, gros gain cinéma ;
 *   - intégration app (P2) : durée/panneaux/météo/caméra pilotés par l'app au lieu des constantes.
 *
 * Le prototype interactif (main.ts) n'est PAS touché : ce fichier duplique volontairement
 * l'assemblage de scène + la logique caméra/ruban, adaptés au rendu déterministe. La
 * déduplication est le point P5 #20.
 */

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { isPlaceName, PLACE_HOLD_S } from '../routeStreets'
import {
  buildFilmAudioTrack, encodeFilmAudio, filmAudioSupported, hasFilmAudio,
  MUXER_AUDIO_CONFIG, type FilmAudioSpec,
} from '../filmAudio'
import waterNormalsUrl from './waternormals.jpg'
import { makeProgressCreep } from '../progressCreep'
import { encoderFailMessage, noteEncoderFrame, noteEncoderSetup, waitEncoderQueue, yieldTask } from '../encoderWait'
import { diag } from '../diag'
import {
  computeCoverage, fetchOrthoTiles, fetchElevationTiles, inpaintOrthoHoles,
  gradeTerrainColors, fetchHydroFeatures, paintHydroOnCanvas,
  generateNormalMapFromDEM, addTerrainSkirt, fetchFarTerrain,
  lon2tileX, lat2tileY, tileX2lon, tileY2lat,
} from './terrainSources'
import { cancel3dPrefetch } from './prefetch3d'
import { startClock } from '../raceSplits'
import { drawStartTimePill } from '../startTimePill'
import type { Hiker3dSprite } from '../hiker3dSprite'
import { HIKER3D_BODY_SCALE, HIKER3D_ENABLED, startPresentAt, smoothEase } from '../hiker3dStaging'
import type { CharacterId } from '../characters'
import { StreetCaption, type StreetSpan } from '../streetCaption'
import { drawBorneLayer, drawEndCard, OVERVIEW_BORNE_SCALE, type LocSignCache } from '../filmExport'
import type { Borne, EndCard, Ravito } from '../raceSplits'

/** Adresse du site, signée sur l'écran-titre et en fin de film (comme le film 2D). */
const SITE_ADDRESS = 'sillonphane.fr/running'
const OUT_W = 1920
const OUT_H = 1080

// ── Renderer WebGL PARTAGÉ entre exports ─────────────────────────────────────────────────────
// Un navigateur limite le nombre de contextes WebGL vivants (~16) ; en créer un neuf à chaque
// export finissait par faire évincer le plus ancien = la carte MapLibre de l'aperçu (carte qui
// disparaît, page blanche). On garde donc UN seul renderer/contexte pour tous les survols 3D ;
// entre deux, on ne libère que les ressources de la scène (voir disposeScene), pas le contexte.
let _sharedRenderer: THREE.WebGLRenderer | null = null
function getSharedRenderer(): THREE.WebGLRenderer {
  if (_sharedRenderer && !_sharedRenderer.getContext().isContextLost()) {
    _sharedRenderer.resetState()
    return _sharedRenderer
  }
  const canvas = document.createElement('canvas')
  canvas.width = OUT_W; canvas.height = OUT_H
  const r = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // on lit le canvas GL après render() pour composer les overlays
  })
  r.setSize(OUT_W, OUT_H, false)
  r.setPixelRatio(1)
  r.outputColorSpace = THREE.SRGBColorSpace
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.toneMappingExposure = 0.9
  r.shadowMap.enabled = true
  r.shadowMap.type = THREE.PCFShadowMap // PCFSoftShadowMap est déprécié (three r183+) et retombe sur PCF
  _sharedRenderer = r
  return r
}

/** Libère toutes les ressources GPU d'une scène (géométries, matériaux, textures) sans toucher
 *  au contexte WebGL. À appeler en fin d'export (le renderer, lui, est réutilisé). */
function disposeScene(scene: THREE.Scene): void {
  const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
    'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap', 'specularMap']
  const disposeMat = (m: THREE.Material) => {
    const rec = m as unknown as Record<string, unknown>
    for (const k of TEX_KEYS) {
      const v = rec[k] as { isTexture?: boolean; dispose?: () => void } | undefined
      if (v && v.isTexture) v.dispose!()
    }
    m.dispose()
  }
  scene.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(mat)) mat.forEach(disposeMat)
    else if (mat) disposeMat(mat)
  })
  const bg = scene.background as THREE.Texture | null
  if (bg && bg.isTexture) bg.dispose()
  scene.clear()
}

// Simulation à cadence fixe 60 Hz, découplée du framerate vidéo : la caméra du proto amortit sa
// position d'un pas constant PAR IMAGE (lerp 0.045 / 0.06). En rendant à 30 fps on n'émet qu'une
// image toutes les 2 sous-étapes -> le "feeling" de la caméra reste celui de l'aperçu ~60 fps,
// et le rendu reste parfaitement déterministe (aucune horloge).
const SIM_HZ = 60
const SIM_DT = 1 / SIM_HZ

export interface Panel3d {
  name: string
  lon: number
  lat: number
  style: 'lieudit' | 'col' | 'standard' | 'poi'
  ele?: number
}

/** Données d'affichage du cartel météo (bas gauche du film 3D). Structurellement compatible
 *  avec `WeatherInfo` de src/lib/meteo.ts — passé tel quel par l'app (voir useFilm3dExport.ts).
 *  Distinct de `weather` ci-dessous, qui ne pilote que le ciel / la position du soleil. */
export interface WeatherCardData {
  tempMin: number
  tempMax: number
  departure?: { temp: number; icon?: string; description?: string } | null
  arrival?:   { temp: number; icon?: string; description?: string } | null
}

export interface FilmExport3dOptions {
  trail:          [number, number][]
  trailDate:      string
  departureName:  string
  arrivalName:    string
  /** Titre affiché sur l'écran-titre d'ouverture. Défaut : « Départ → Arrivée ». */
  title?:         string
  /** Masque le cartel planté au départ / à l'arrivée (l'utilisateur a décoché ce panneau).
   *  Le nom reste utilisé pour l'étiquette « Départ → Arrivée » de l'overlay. Défaut : affiché. */
  showDeparturePanel?: boolean
  showArrivalPanel?:   boolean
  /** Altitude du col quand le départ / l'arrivée est un col : cartel au style col (nom + altitude). */
  departureColEle?: number
  arrivalColEle?:   number
  /** Départ / arrivée sur un hameau / lieu-dit : cartel au style lieu-dit. */
  departureLieudit?: boolean
  arrivalLieudit?:   boolean
  /** D+ du tracé (celui du bandeau de profil, calculé à l'import du GPX) pour l'écran-titre.
   *  Absent -> estimé depuis le relief 3D (moins fiable : bruit du MNT). */
  elevGainM?:     number
  panels?:        Panel3d[]
  /** Scénario météo/heure (P2 : issu de fetchHistoricalWeather / meteo.ts). */
  weather?:       { hourOfDay: number; cloudCover: number }
  /** Cartel météo affiché en bas à gauche (température + icône + description). Optionnel :
   *  absent -> pas de cartel (ex. banc de test). */
  weatherCard?:   WeatherCardData | null
  /** Heure de départ « HH:MM », écrite sous le nom du départ pendant l'ouverture (pause sur le départ). */
  startTime?:     string
  /** Heure prévue (« Départ prévu… ») plutôt que réelle d'un GPX horodaté (« Départ… »). */
  /** Heure du premier point d'un GPX horodaté : secondes de l'horloge de départ. */
  trackStart?:    Date
  startTimePlanned?: boolean
  /** Durée du survol lui-même (hors pauses intro/outro), en s. Défaut 35. */
  durationS?:     number
  /** Film d'essai (?essai dans l'URL) : le survol seul, en `durationS` exactement, sans écran-titre, pause de
   *  départ ni plans de fin. */
  essai?:         boolean
  fps?:           number
  /** Plafond de débit vidéo (Mb/s) au-dessus de la qualité constante. Défaut 16 (voir QP_CAP_BPS). */
  videoMaxMbps?:  number
  /** Bande-son optionnelle (musique de fond / ambiance / fichier utilisateur). Mux AAC, chemin WebCodecs uniquement. */
  audio?:         FilmAudioSpec
  /** `etaS` : temps restant estimé (s), affiné en continu (voir « Estimation du temps restant »). */
  onProgress?:    (p: { phase: 'prepare' | 'render'; ratio: number; label: string; etaS?: number }) => void
  signal?:        AbortSignal
  /** Personnage courant en tête du ruban (le premier choisi) ; absent ou vide = ruban seul. */
  characters?:    CharacterId[]
  /** Numéro inscrit sur son dossard. */
  bibNumber?:     string
  /** Rues empruntées (part du parcours) : nom en haut de l'écran pendant que la tête du ruban y passe. */
  streets?:       StreetSpan[]
  /** Bornes (km et temps de passage) et ravitaillements, comme le film 2D, placés sur le ruban à leur km. */
  bornes?:        Borne[]
  ravitos?:       Ravito[]
  /** Distance du tracé dans l'appli (m) : km des bornes -> part du parcours. */
  trackDistanceM?: number
  /** Distance annoncée de l'épreuve (m, celle du carton final) : fin du compteur, écran-titre, profil. */
  shownDistanceM?: number
  /** Carton final du film 2D (titre, date, distance, D+, temps, moyenne), à la place de l'adresse seule. */
  endCard?:       EndCard
}

// ─── Estimation du temps restant ───────────────────────────────────────────────────────────
// Dès le lancement : tuiles à télécharger × temps par tuile + préparation fixe + images à rendre ×
// temps par image. Les vitesses de départ sont celles MESURÉES au dernier export sur cet appareil
// (localStorage), à défaut des valeurs moyennes ; pendant l'export, on les remplace par les
// vitesses réelles dès qu'on a assez d'échantillons. Mémorisées en fin d'export (moyenne avec
// l'historique, pour lisser un export atypique : tuiles en cache, réseau saturé…).
const ETA_KEY = 'sillon.film3d.rates'
interface EtaRates { msPerTile: number; prepFixedMs: number; msPerFrame: number }
const ETA_DEFAULTS: EtaRates = { msPerTile: 45, prepFixedMs: 15_000, msPerFrame: 70 }
function loadEtaRates(): EtaRates {
  try {
    const r = JSON.parse(localStorage.getItem(ETA_KEY) ?? 'null') as Partial<EtaRates> | null
    if (r && [r.msPerTile, r.prepFixedMs, r.msPerFrame].every(v => typeof v === 'number' && v > 0 && Number.isFinite(v)))
      return r as EtaRates
  } catch { /* stockage indisponible */ }
  return ETA_DEFAULTS
}
function saveEtaRates(prev: EtaRates, measured: Partial<EtaRates>): void {
  const mix = (a: number, b?: number) => (b && Number.isFinite(b) && b > 0 ? (a + b) / 2 : a)
  try {
    localStorage.setItem(ETA_KEY, JSON.stringify({
      msPerTile: mix(prev.msPerTile, measured.msPerTile),
      prepFixedMs: mix(prev.prepFixedMs, measured.prepFixedMs),
      msPerFrame: mix(prev.msPerFrame, measured.msPerFrame),
    }))
  } catch { /* stockage indisponible */ }
}

// ─── Cartel du profil altimétrique (port canvas de buildProfileCard de main.ts) ──────────────

function buildProfileCardCanvas(
  pts: THREE.Vector3[], totalDistanceM: number, altOffset: number,
): (ctx: CanvasRenderingContext2D, t: number) => void {
  const GW = 408, GH = 108
  const n = pts.length - 1

  const rawElev = pts.map(p => p.y + altOffset)
  const med = rawElev.map((_, i) => {
    const a = rawElev[Math.max(0, i - 1)], b = rawElev[i], c = rawElev[Math.min(rawElev.length - 1, i + 1)]
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  })
  const SM = 4
  const elev = med.map((_, i) => {
    let s = 0, w = 0
    for (let k = -SM; k <= SM; k++) { const j = i + k; if (j >= 0 && j < med.length) { s += med[j]; w++ } }
    return s / w
  })

  let elevMin = Infinity, elevMax = -Infinity
  for (const a of elev) { if (a < elevMin) elevMin = a; if (a > elevMax) elevMax = a }

  const MIN_SPAN = 180
  let drawLo = elevMin, drawHi = elevMax
  if (drawHi - drawLo < MIN_SPAN) {
    const mid = (drawLo + drawHi) / 2
    drawLo = mid - MIN_SPAN / 2
    drawHi = mid + MIN_SPAN / 2
  }
  const range = Math.max(1, drawHi - drawLo)

  const altAt = (u: number) => {
    const fi = Math.max(0, Math.min(n, u * n))
    const i0 = Math.floor(fi), i1 = Math.min(n, i0 + 1), f = fi - i0
    return elev[i0] * (1 - f) + elev[i1] * f
  }
  const xAt = (u: number) => u * GW
  const yAt = (u: number) => GH - ((altAt(u) - drawLo) / range) * (GH - 6) - 3

  let gain = 0
  const gStep = Math.max(1, Math.round(elev.length / 25))
  for (let i = gStep; i < elev.length; i += gStep) { const dz = elev[i] - elev[i - gStep]; if (dz > 0) gain += dz }
  const statsLine =
    `Alt. ${Math.round(elevMin)}–${Math.round(elevMax)} m   ·   ` +
    `D+ ${Math.round(gain)} m   ·   ${(totalDistanceM / 1000).toFixed(1).replace('.', ',')} km`

  const PAD_L = 17, PAD_T = 13
  const TITLE_H = 22, GAP = 8

  return (ctx: CanvasRenderingContext2D, t: number) => {
    const cardX = 16
    const cardY = 16 // haut gauche
    const gx0 = cardX + PAD_L
    const gy0 = cardY + PAD_T + TITLE_H

    // Pas de fond (comme le film 2D) : posé sur le paysage, textes clairs cernés d'un halo sombre.
    const haloText = (text: string, x: number, y: number) => {
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 4
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6
      ctx.strokeText(text, x, y)
      ctx.restore()
      ctx.fillText(text, x, y)
    }

    ctx.save()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.font = "700 13px system-ui, sans-serif"
    haloText('PROFIL DU TRACÉ', gx0, cardY + PAD_T)

    // Aire sous la courbe
    ctx.beginPath()
    ctx.moveTo(gx0 + xAt(0), gy0 + yAt(0))
    const N = 160
    for (let k = 1; k <= N; k++) ctx.lineTo(gx0 + xAt(k / N), gy0 + yAt(k / N))
    ctx.lineTo(gx0 + GW, gy0 + GH)
    ctx.lineTo(gx0, gy0 + GH)
    ctx.closePath()
    ctx.fillStyle = 'rgba(230,150,90,0.38)'
    ctx.fill()

    // Ligne de crête
    ctx.beginPath()
    ctx.moveTo(gx0 + xAt(0), gy0 + yAt(0))
    for (let k = 1; k <= N; k++) ctx.lineTo(gx0 + xAt(k / N), gy0 + yAt(k / N))
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4
    ctx.strokeStyle = '#ffb072'; ctx.lineWidth = 2.4; ctx.stroke()
    ctx.restore()

    // Curseur de position
    const u = Math.max(0, Math.min(1, t))
    const cx = gx0 + xAt(u), cy = gy0 + yAt(u)
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.moveTo(cx, gy0); ctx.lineTo(cx, gy0 + GH); ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()

    ctx.fillStyle = '#fff'
    ctx.font = "15px system-ui, sans-serif"
    haloText(statsLine, gx0, gy0 + GH + GAP + 2)
    ctx.restore()
  }
}

// ─── Panneaux de localité (port de panelTexture de main.ts) ──────────────────────────────────

function panelTexture(name: string, style: 'lieudit' | 'col' | 'standard' | 'poi', ele?: number): THREE.CanvasTexture {
  const SCALE = 6
  const FONT_SIZE = 15 * SCALE
  const PAD_X = 12 * SCALE, PAD_Y = 6 * SCALE
  const BORDER = 3.5 * SCALE, RADIUS = 7 * SCALE
  const POLE_W = 6 * SCALE, POLE_H = 34 * SCALE
  const MARGIN = 20 * SCALE

  const isLieudit = style === 'lieudit'
  const isCol = style === 'col'
  const isPoi = style === 'poi' // point d'intérêt : panneau touristique marron, liseré blanc
  const label = isLieudit || isPoi ? name : name.toUpperCase()
  const fontStyle = isLieudit ? 'italic 800' : isPoi ? '700' : '800'
  const FONT = `${fontStyle} ${FONT_SIZE}px 'Arial Narrow', Arial, sans-serif`
  const FONT2 = `600 ${10 * SCALE}px 'Arial Narrow', Arial, sans-serif`

  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = FONT
  const textW = measure.measureText(label).width
  const eleStr = isCol && ele != null ? `Alt. ${ele} m` : ''
  measure.font = FONT2
  const eleW = eleStr ? measure.measureText(eleStr).width : 0

  const boardW = Math.max(textW, eleW) + PAD_X * 2
  const boardH = isCol && eleStr ? FONT_SIZE + 12 * SCALE + PAD_Y * 2 : FONT_SIZE + PAD_Y * 2

  const c = document.createElement('canvas')
  c.width = boardW + MARGIN * 2
  c.height = boardH + POLE_H + MARGIN * 2
  const ctx = c.getContext('2d')!

  const px = c.width / 2
  const py = c.height - MARGIN
  const poleX = px - POLE_W / 2
  const poleY = py - POLE_H
  const boardX = px - boardW / 2
  const boardY = poleY - boardH

  const bgColor = isLieudit ? '#b84400' : isCol ? '#253d17' : isPoi ? '#5b3a1e' : '#fff'
  const textColor = isLieudit || isCol || isPoi ? '#fff' : '#111'
  const borderColor = isLieudit || isCol || isPoi ? 'transparent' : '#c0000c'

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 8 * SCALE
  ctx.shadowOffsetY = 3 * SCALE

  const grad = ctx.createLinearGradient(poleX, 0, poleX + POLE_W, 0)
  grad.addColorStop(0, '#888'); grad.addColorStop(0.5, '#ddd'); grad.addColorStop(1, '#888')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.roundRect(poleX, poleY, POLE_W, POLE_H, [0, 0, 3 * SCALE, 3 * SCALE]); ctx.fill()

  if (borderColor !== 'transparent') {
    ctx.fillStyle = borderColor
    ctx.beginPath(); ctx.roundRect(boardX - BORDER, boardY - BORDER, boardW + BORDER * 2, boardH + BORDER * 2, RADIUS); ctx.fill()
  }
  ctx.fillStyle = bgColor
  ctx.beginPath(); ctx.roundRect(boardX, boardY, boardW, boardH, borderColor !== 'transparent' ? RADIUS - BORDER : RADIUS); ctx.fill()
  ctx.restore()

  if (isPoi) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * SCALE
    ctx.beginPath(); ctx.roundRect(boardX + 3 * SCALE, boardY + 3 * SCALE, boardW - 6 * SCALE, boardH - 6 * SCALE, RADIUS - 3 * SCALE); ctx.stroke()
  }

  ctx.fillStyle = textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = FONT
  const textY = isCol && eleStr ? boardY + PAD_Y + FONT_SIZE / 2 : boardY + boardH / 2
  ctx.fillText(label, px, textY)
  if (eleStr) {
    ctx.font = FONT2
    ctx.fillText(eleStr, px, boardY + boardH - PAD_Y - (10 * SCALE) / 2)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Noms de lieux écrits à même le sol, sans pancarte — mêmes polices et couleurs que le film 2D (GROUND_LABEL de
 * src/lib/filmExport.ts) et l'aperçu (.loc-sign) : localité en grandes lettres blanches cernées de noir, lieu-dit
 * en italique plus petit, point d'intérêt en italique doré à empattements cerné de brun. Les cols gardent leur
 * pancarte (panelTexture), comme en 2D. */
const GROUND_LABEL_3D: Record<'standard' | 'lieudit' | 'poi', { font: string; size: number; fill: string; stroke: string }> = {
  standard: { font: '700 {s}px Arial, Helvetica, sans-serif', size: 24, fill: '#fff', stroke: '#1b1b1b' },
  lieudit:  { font: 'italic 700 {s}px Arial, Helvetica, sans-serif', size: 19, fill: '#fff', stroke: '#1b1b1b' },
  poi:      { font: 'italic 700 {s}px Georgia, "Times New Roman", serif', size: 20, fill: '#ffe3a3', stroke: '#4a2a10' },
}
/** Résolution du canvas des noms au sol (px canvas par px « logique » 2D). */
const GROUND_LABEL_RES = 6

function groundLabelTexture(name: string, style: 'standard' | 'lieudit' | 'poi'): THREE.CanvasTexture {
  const g = GROUND_LABEL_3D[style]
  const R = GROUND_LABEL_RES
  const STROKE = 4.5, MARGIN = 8
  const FONT = g.font.replace('{s}', String(g.size * R))
  const m = document.createElement('canvas').getContext('2d')!
  m.font = FONT
  const textW = m.measureText(name).width / R
  const W = Math.ceil(textW + STROKE * 2 + MARGIN * 2)
  const H = Math.ceil(g.size * 1.3 + STROKE * 2 + MARGIN * 2)
  const c = document.createElement('canvas')
  c.width = W * R; c.height = H * R
  const ctx = c.getContext('2d')!
  ctx.font = FONT
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4 * R; ctx.shadowOffsetY = 1 * R
  ctx.strokeStyle = g.stroke; ctx.lineWidth = STROKE * R
  ctx.strokeText(name, c.width / 2, c.height / 2)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = g.fill
  ctx.fillText(name, c.width / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ─── Courbes du tracé (port de main.ts) ─────────────────────────────────────────────────────

function smoothTrail(points: [number, number][], iterations = 5, radius = 4): [number, number][] {
  const n = points.length
  let lons = points.map(p => p[0])
  let lats = points.map(p => p[1])
  for (let iter = 0; iter < iterations; iter++) {
    const newLons = lons.slice()
    const newLats = lats.slice()
    for (let i = 1; i < n - 1; i++) {
      let sumLon = 0, sumLat = 0, wSum = 0
      for (let k = -radius; k <= radius; k++) {
        const j = i + k
        if (j < 0 || j >= n) continue
        const w = radius + 1 - Math.abs(k)
        sumLon += lons[j] * w; sumLat += lats[j] * w; wSum += w
      }
      newLons[i] = sumLon / wSum
      newLats[i] = sumLat / wSum
    }
    lons = newLons; lats = newLats
  }
  return lons.map((lon, i) => [lon, lats[i]] as [number, number])
}

function clampToPolyline(x: number, z: number, poly: THREE.Vector3[], maxDev: number): [number, number] {
  let bx = poly[0].x, bz = poly[0].z, bd = Infinity
  for (let i = 1; i < poly.length; i++) {
    const ax = poly[i - 1].x, az = poly[i - 1].z
    const ex = poly[i].x - ax, ez = poly[i].z - az
    const l2 = ex * ex + ez * ez || 1
    let u = ((x - ax) * ex + (z - az) * ez) / l2
    u = u < 0 ? 0 : u > 1 ? 1 : u
    const cx = ax + u * ex, cz = az + u * ez
    const d = (x - cx) * (x - cx) + (z - cz) * (z - cz)
    if (d < bd) { bd = d; bx = cx; bz = cz }
  }
  const dist = Math.sqrt(bd)
  if (dist <= maxDev) return [x, z]
  const k = maxDev / dist
  return [bx + (x - bx) * k, bz + (z - bz) * k]
}

// ─── Export principal ──────────────────────────────────────────────────────────────────────

export async function exportFilm3d(opts: FilmExport3dOptions): Promise<Blob> {
  // Préparation : glissement continu entre les étapes (0.02, 0.08, 0.7…), cf. progressCreep.ts.
  let label = ''
  let etaGetter: () => number | undefined = () => undefined
  const creep = makeProgressCreep(ratio => opts.onProgress?.({ phase: 'prepare', ratio, label, etaS: etaGetter() }))
  try { return await exportFilm3dImpl(opts, creep, l => { label = l }, g => { etaGetter = g }) }
  finally { creep.stop() }
}

async function exportFilm3dImpl(
  opts: FilmExport3dOptions, creep: ReturnType<typeof makeProgressCreep>, setLabel: (l: string) => void,
  setEtaGetter: (g: () => number | undefined) => void,
): Promise<Blob> {
  const { trail, fps = 30, signal, onProgress } = opts
  const report = (phase: 'prepare' | 'render', ratio: number, label: string, next?: number) => {
    if (phase === 'prepare') { setLabel(label); creep.set(ratio, next); return }
    creep.stop()
    onProgress?.({ phase, ratio, label, etaS: etaNow() })
  }
  const aborted = () => new Error('aborted')
  if (trail.length < 2) return new Blob()

  // ── PHASE 1 : PRÉPARATION DU TERRAIN (tous les fetch avant la 1re frame) ──────────────────
  // Préchargement de fond éventuel (prefetch3d.ts) : on le coupe pour ne pas redemander les mêmes
  // URLs en parallèle ; ce qu'il a déjà téléchargé est servi par le cache aux fetch ci-dessous.
  cancel3dPrefetch()
  const cov = computeCoverage(trail)

  // Téléchargement = l'essentiel de l'attente : progression réelle tuile par tuile (8 → 68 %).
  const DL_LABEL = 'Téléchargement des photos aériennes et du relief…'
  const nTiles = cov.nx * cov.ny + cov.enx * cov.eny
  let tilesDone = 0

  // Estimation du temps restant (voir loadEtaRates). Nombre d'images estimé d'avance comme la
  // timeline plus bas (survol plafonné à 2 min + ~20 s d'intro/arrivée/vue d'ensemble) ; recalé
  // sur le vrai total au début du rendu.
  const etaRates = loadEtaRates()
  let trailKm = 0
  for (let i = 1; i < trail.length; i++) {
    const [lo0, la0] = trail[i - 1], [lo1, la1] = trail[i]
    trailKm += 6371 * Math.hypot((la1 - la0) * Math.PI / 180, (lo1 - lo0) * Math.PI / 180 * Math.cos(la0 * Math.PI / 180))
  }
  const estAsked = opts.durationS && opts.durationS > 0 ? opts.durationS : 52
  let etaTotalFrames = Math.ceil((Math.max(estAsked, Math.min(120, trailKm * 1.8 * 1.3)) + 20) * fps)
  let etaStage: 'dl' | 'post' | 'render' = 'dl'
  let etaFrame = 0
  const dlStart = performance.now()
  let dlEnd = 0, renderStart = 0
  function etaNow(): number {
    const now = performance.now()
    if (etaStage === 'dl') {
      const mpt = tilesDone >= 20 ? (now - dlStart) / tilesDone : etaRates.msPerTile
      return ((nTiles - tilesDone) * mpt + etaRates.prepFixedMs + etaTotalFrames * etaRates.msPerFrame) / 1000
    }
    if (etaStage === 'post')
      return (Math.max(3000, etaRates.prepFixedMs - (now - dlEnd)) + etaTotalFrames * etaRates.msPerFrame) / 1000
    const mpf = etaFrame >= 30 ? (now - renderStart) / etaFrame : etaRates.msPerFrame
    return ((etaTotalFrames - etaFrame) * mpf + 3000) / 1000
  }
  setEtaGetter(etaNow)
  report('prepare', 0.02, "Calcul de l'emprise…", 0.08)

  const dlRatio = (n: number) => 0.08 + 0.6 * Math.min(1, n / Math.max(1, nTiles))
  const onTileDone = () => { tilesDone++; report('prepare', dlRatio(tilesDone), DL_LABEL, dlRatio(tilesDone + 1)) }
  report('prepare', 0.08, DL_LABEL, dlRatio(1))
  // Terrain de fond (lointain), téléchargé en parallèle : carré de FAR_SPAN_K × l'emprise, au moins
  // 40 km. Voir fetchFarTerrain et la construction du maillage plus bas.
  const FAR_SPAN_K = 3.2
  const covSpanM = Math.max(
    (cov.covLonMax - cov.covLonMin) * 111320 * Math.cos((cov.lat0 * Math.PI) / 180),
    (cov.covLatMax - cov.covLatMin) * 110540,
  )
  const farSideM = Math.min(400_000, Math.max(40_000, covSpanM * FAR_SPAN_K))
  const farPromise = fetchFarTerrain(cov, farSideM, signal).catch(() => null)
  const [ortho, elevGrid] = await Promise.all([
    fetchOrthoTiles(cov.txMin, cov.tyMin, cov.nx, cov.ny, cov.ZOOM_ORTHO, signal, undefined, onTileDone),
    fetchElevationTiles(cov.ecolMin, cov.erowMin, cov.enx, cov.eny, cov.ZOOM_ELEV, signal, undefined, onTileDone),
  ])
  // Après les tuiles : repli relief mondial + comblements (sans progression fine) -> glisse vers 70 %.
  etaStage = 'post'; dlEnd = performance.now()
  report('prepare', dlRatio(nTiles), DL_LABEL, 0.7)
  if (signal?.aborted) throw aborted()

  // Abandon propre : sans un minimum de données, on ne sort pas une vidéo trouée.
  if (!ortho.ok.some(Boolean))
    throw new Error("Préparation impossible : aucune photo aérienne (couverture IGN ou réseau).")
  if (elevGrid.origBad.every(v => v === 1))
    throw new Error('Préparation impossible : relief indisponible sur cette zone.')

  const orthoCanvas = ortho.canvas
  inpaintOrthoHoles(orthoCanvas, ortho.ok, ortho.cols, ortho.rows)

  report('prepare', 0.7, 'Hydrographie (cours d\'eau, plans d\'eau)…', 0.85)
  const hydro = await fetchHydroFeatures(cov.covLonMin, cov.covLonMax, cov.covLatMin, cov.covLatMax, signal)
  if (signal?.aborted) throw aborted()

  report('prepare', 0.85, 'Assemblage du terrain…', 0.92)

  // Échantillonnage du relief (port de main.ts)
  function elevAtPixel(px: number, py: number): number {
    px = Math.max(0, Math.min(elevGrid.width - 1, px))
    py = Math.max(0, Math.min(elevGrid.height - 1, py))
    const v = elevGrid.data[py * elevGrid.width + px]
    return (Number.isFinite(v) && v > -500 && v < 9000) ? v : 0
  }
  function elevBilinear(px: number, py: number): number {
    const x0 = Math.floor(px), y0 = Math.floor(py)
    const fx = px - x0, fy = py - y0
    const a = elevAtPixel(x0, y0), b = elevAtPixel(x0 + 1, y0)
    const c = elevAtPixel(x0, y0 + 1), d = elevAtPixel(x0 + 1, y0 + 1)
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
  }
  function elevAtLonLat(lon: number, lat: number): number {
    const [px, py] = cov.elevPixelForLonLat(lon, lat)
    return elevBilinear(px, py)
  }

  // ── PHASE 2 : SCÈNE THREE.JS HORS ÉCRAN ─────────────────────────────────────────────────
  let renderer: THREE.WebGLRenderer
  try {
    renderer = getSharedRenderer()
  } catch (e) {
    throw new Error('Rendu 3D indisponible : ce navigateur n\'expose pas WebGL. ' +
      (e instanceof Error ? e.message : String(e)), { cause: e })
  }
  const glCanvas = renderer.domElement

  const scene = new THREE.Scene()

  // Idempotent : appelé sur abandon, en fin de rendu ET dans le catch de la boucle. Libère les
  // ressources GPU de la scène (géométries/matériaux/textures, jusqu'à 84 MP d'ortho) SANS
  // détruire le contexte WebGL — celui-ci est partagé et réutilisé (voir getSharedRenderer).
  let _cleanedUp = false
  /** Coureuse en tête du ruban (cf. drawRunner) ; déclarée ici pour être libérée par cleanup. */
  let runner: Hiker3dSprite | null = null
  const cleanup = () => {
    if (_cleanedUp) return
    _cleanedUp = true
    runner?.dispose()
    try { disposeScene(scene); renderer.renderLists.dispose(); renderer.info.reset() } catch { /* */ }
  }

  scene.fog = new THREE.FogExp2('#d8e8f5', 0.00024)

  const NO_REFLECT_LAYER = 1
  const camera = new THREE.PerspectiveCamera(55, OUT_W / OUT_H, 1, 50000)
  camera.layers.enable(NO_REFLECT_LAYER)

  // Ciel : dégradé vertical (comme main.ts)
  {
    const g = document.createElement('canvas'); g.width = 4; g.height = 256
    const gx = g.getContext('2d')!
    const grad = gx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#96c1e1'); grad.addColorStop(0.55, '#bcd7ee'); grad.addColorStop(1, '#d8e8f5')
    gx.fillStyle = grad; gx.fillRect(0, 0, 4, 256)
    const skyTex = new THREE.CanvasTexture(g)
    skyTex.colorSpace = THREE.SRGBColorSpace
    scene.background = skyTex
  }

  // Soleil dérivé de l'heure du scénario météo
  const weather = opts.weather ?? { hourOfDay: 16, cloudCover: 0.35 }
  const sunElevationForHour = (hour: number) => Math.max(8, 62 - Math.abs(hour - 13) * 6.5)
  const sunPosition = new THREE.Vector3()
  sunPosition.setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - sunElevationForHour(weather.hourOfDay)),
    THREE.MathUtils.degToRad(-140),
  )
  const cc = weather.cloudCover

  // --- Terrain ---
  // Résolution du maillage : 420 (vs 180 dans le proto temps réel). Rendu hors-écran => on peut se
  // permettre ~176 k sommets ; à 180 les facettes (~65 m sur un tracé de 12 km) donnaient un relief
  // « pixellisé » anguleux quand la caméra passe près d'un versant. Le DEM IGN (~5 m/px) alimente
  // largement cette densité.
  const GEOM_RES = 420
  const [wx0] = cov.project(cov.covLonMin, cov.lat0)
  const [wx1] = cov.project(cov.covLonMax, cov.lat0)
  const [, wz0] = cov.project(cov.lon0, cov.covLatMax)
  const [, wz1] = cov.project(cov.lon0, cov.covLatMin)
  const worldW = wx1 - wx0
  const worldD = wz1 - wz0

  const geometry = new THREE.PlaneGeometry(worldW, worldD, GEOM_RES - 1, GEOM_RES - 1)
  geometry.rotateX(-Math.PI / 2)
  const posAttr = geometry.attributes.position
  const hasHoles = elevGrid.origBad.some(v => v)
  // Emprise partiellement hors couverture (résidu que même le repli DEM mondial ne couvre pas) :
  // brouillard un peu plus dense pour fondre ce lointain comblé dans la brume.
  if (hasHoles && scene.fog instanceof THREE.FogExp2) scene.fog.density = 0.00034
  // Masque BRUT (avant repli terrarium) : sert au littoral — le repli remplit la mer par ~0, il
  // ne faut donc pas la lire comme de la terre ferme.
  const hasRawHoles = elevGrid.rawBad.some(v => v)
  const vertBad = new Uint8Array(GEOM_RES * GEOM_RES)
  let minElev = Infinity
  for (let iz = 0; iz < GEOM_RES; iz++) {
    for (let ix = 0; ix < GEOM_RES; ix++) {
      const u = ix / (GEOM_RES - 1)
      const v = iz / (GEOM_RES - 1)
      const lon = cov.covLonMin + u * (cov.covLonMax - cov.covLonMin)
      const lat = cov.covLatMax - v * (cov.covLatMax - cov.covLatMin)
      const elev = elevAtLonLat(lon, lat)
      minElev = Math.min(minElev, elev)
      posAttr.setY(iz * GEOM_RES + ix, elev)
      if (hasRawHoles) {
        const [px, py] = cov.elevPixelForLonLat(lon, lat)
        const gx = Math.max(0, Math.min(elevGrid.width - 1, Math.round(px)))
        const gy = Math.max(0, Math.min(elevGrid.height - 1, Math.round(py)))
        vertBad[iz * GEOM_RES + ix] = elevGrid.rawBad[gy * elevGrid.width + gx]
      }
    }
  }

  const seaBadFrac = elevGrid.rawBad.reduce((s: number, v: number) => s + v, 0) / elevGrid.rawBad.length
  let trailMinElev = Infinity
  for (const [lon, lat] of trail) trailMinElev = Math.min(trailMinElev, elevAtLonLat(lon, lat))
  const isCoastal = hasRawHoles && seaBadFrac > 0.02 && trailMinElev < 12

  // Littoral. AVANT : les sommets « mer » (1 tous les ~160 m sur un GR de 200 km, grille fixe
  // GEOM_RES) étaient enfoncés de 25 m et la transparence interpolée d'un sommet à l'autre -> côte
  // en escalier / dents de scie, et terrain qui plongeait sous l'eau avant le vrai rivage.
  // MAINTENANT : les sommets mer sont posés JUSTE AU-DESSUS du plan d'eau (SEA_TOP_M) — plus de pente
  // vers le fond — et c'est un masque terre/mer en image (coastAlphaMap, calculé pixel par pixel sur le
  // relief IGN) qui rend la mer transparente : la côte suit son vrai contour.
  // L'origine locale reste SEA_SINK (seaLocalY inchangé pour le reste de la scène).
  const SEA_SINK = minElev - 25
  // Altitude (m) des sommets mer : 0,3 m au-dessus du plan d'eau (-1 m) — assez pour ne pas passer dessous,
  // assez peu pour que la jupe du maillage (addTerrainSkirt) ne dépasse pas de l'eau au large.
  const SEA_TOP_M = -0.7
  if (isCoastal) {
    for (let i = 0; i < posAttr.count; i++) if (vertBad[i]) posAttr.setY(i, SEA_TOP_M)
    minElev = SEA_SINK
  }
  for (let i = 0; i < posAttr.count; i++) posAttr.setY(i, posAttr.getY(i) - minElev)
  posAttr.needsUpdate = true

  const seaLocalY = -minElev - 1

  let coastAlphaMap: THREE.CanvasTexture | null = null
  if (isCoastal) {
    const AW = 2048, AH = 2048
    const ac = document.createElement('canvas')
    ac.width = AW; ac.height = AH
    const actx = ac.getContext('2d')!
    const img = actx.createImageData(AW, AH)
    const rb = elevGrid.rawBad, EW = elevGrid.width, EH = elevGrid.height
    const badAt = (x: number, y: number) =>
      rb[Math.max(0, Math.min(EH - 1, y)) * EW + Math.max(0, Math.min(EW - 1, x))]
    for (let py = 0; py < AH; py++) {
      const lat = cov.covLatMax - ((py + 0.5) / AH) * (cov.covLatMax - cov.covLatMin)
      for (let px = 0; px < AW; px++) {
        const lon = cov.covLonMin + ((px + 0.5) / AW) * (cov.covLonMax - cov.covLonMin)
        const [ex, ey] = cov.elevPixelForLonLat(lon, lat)
        const x0 = Math.floor(ex), y0 = Math.floor(ey), fx = ex - x0, fy = ey - y0
        // part de « mer » interpolée, puis bord net mais anti-crénelé (smoothstep autour de 0,5)
        const sea = (badAt(x0, y0) * (1 - fx) + badAt(x0 + 1, y0) * fx) * (1 - fy)
          + (badAt(x0, y0 + 1) * (1 - fx) + badAt(x0 + 1, y0 + 1) * fx) * fy
        const s = Math.max(0, Math.min(1, (0.62 - sea) / 0.24))
        const a = Math.round(255 * s * s * (3 - 2 * s))
        const k = (py * AW + px) * 4
        img.data[k] = img.data[k + 1] = img.data[k + 2] = a; img.data[k + 3] = 255
      }
    }
    actx.putImageData(img, 0, 0)
    coastAlphaMap = new THREE.CanvasTexture(ac)
    coastAlphaMap.wrapS = coastAlphaMap.wrapT = THREE.ClampToEdgeWrapping
  }

  const meshY = new Float32Array(GEOM_RES * GEOM_RES)
  for (let i = 0; i < meshY.length; i++) meshY[i] = posAttr.getY(i)
  function meshHeightAt(wx: number, wz: number): number {
    const gx = Math.max(0, Math.min(GEOM_RES - 1, ((wx + worldW / 2) / worldW) * (GEOM_RES - 1)))
    const gz = Math.max(0, Math.min(GEOM_RES - 1, ((wz + worldD / 2) / worldD) * (GEOM_RES - 1)))
    const ix0 = gx | 0, iz0 = gz | 0
    const ix1 = Math.min(GEOM_RES - 1, ix0 + 1), iz1 = Math.min(GEOM_RES - 1, iz0 + 1)
    const fx = gx - ix0, fz = gz - iz0
    const a = meshY[iz0 * GEOM_RES + ix0], b = meshY[iz0 * GEOM_RES + ix1]
    const c = meshY[iz1 * GEOM_RES + ix0], d = meshY[iz1 * GEOM_RES + ix1]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz
  }

  // Zones hors couverture (étranger, hors emprise IGN) : on NE découpe PLUS le maillage — ça
  // laissait un bord en dents de scie et un trou sur le ciel (visible sur les tracés frontaliers).
  // Le relief y est désormais comblé de bout en bout (fetchElevationTiles/inpaintElevation, rayon
  // étendu) + repli DEM mondial ; l'ortho est comblée ou repliée sur Esri, et le brouillard noie
  // le lointain. Cas littoral (`isCoastal`) : mer rendue transparente par le masque coastAlphaMap.
  geometry.computeVertexNormals()

  gradeTerrainColors(orthoCanvas)
  paintHydroOnCanvas(orthoCanvas, hydro, cov.covLonMin, cov.covLonMax, cov.covLatMin, cov.covLatMax)

  const maxAniso = renderer.capabilities.getMaxAnisotropy()
  const orthoTexture = new THREE.CanvasTexture(orthoCanvas)
  orthoTexture.colorSpace = THREE.SRGBColorSpace
  orthoTexture.wrapS = THREE.ClampToEdgeWrapping
  orthoTexture.wrapT = THREE.ClampToEdgeWrapping
  // Filtrage explicite : en vue rasante (caméra qui regarde vers l'avant dans une vallée), le
  // mipmapping écrase la résolution des pentes lointaines -> bouillie floue. L'anisotropie max
  // rattrape la netteté sur ces surfaces vues de biais. (Reste inhérent : l'ortho est une
  // projection verticale, donc étirée sur les parois quasi-verticales — cf. GEOM_RES + ZOOM_ORTHO.)
  orthoTexture.generateMipmaps = true
  orthoTexture.minFilter = THREE.LinearMipmapLinearFilter
  orthoTexture.magFilter = THREE.LinearFilter
  orthoTexture.anisotropy = maxAniso
  orthoTexture.needsUpdate = true

  const terrainNormalMap = generateNormalMapFromDEM(elevGrid, 1.8)
  terrainNormalMap.anisotropy = maxAniso
  terrainNormalMap.needsUpdate = true

  const terrainMat = new THREE.MeshStandardMaterial({
    map: orthoTexture,
    normalMap: terrainNormalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.97,
    metalness: 0.0,
    ...(isCoastal && coastAlphaMap ? { alphaMap: coastAlphaMap, transparent: true, depthWrite: false } : {}),
  })
  const terrain = new THREE.Mesh(geometry, terrainMat)
  terrain.receiveShadow = true
  terrain.castShadow = true // auto-ombrage du relief (désactivé dans main.ts pour le FPS temps réel)
  if (isCoastal) terrain.renderOrder = 1
  scene.add(terrain)
  scene.add(addTerrainSkirt(geometry, 400))

  // ── Terrain de fond (lointain) ────────────────────────────────────────────────────────────
  // Vue de très haut (vue d'ensemble de fin), le maillage détaillé ne couvre qu'une partie de
  // l'image : au-delà, on voyait le plan d'eau (« de la mer sur la terre ») puis le vide. Maillage
  // grossier sur farSideM, ortho + DEM mondial basse résolution, TROUÉ là où le maillage détaillé
  // existe. Les cellules à cheval le chevauchent : leurs sommets situés dans l'emprise reprennent
  // ses hauteurs, abaissées de 5 m, pour que le détaillé gagne sans marche visible. PAS de
  // polygonOffset : vu de 100 km, il repoussait tout le fond d'~100 m, sous le plan d'eau (terre
  // basse noyée). Altitude ≤ 0,5 m = mer : enfoncée sous le plan d'eau.
  let farMinY = 0
  {
    const far = await farPromise
    if (signal?.aborted) throw aborted()
    if (far) {
      const N = 400 // ~500 m par maille sur 200 km : la côte des presqu'îles reste lisible
      const half = farSideM / 2
      let meanAbs = 0
      for (let i = 0; i < meshY.length; i++) meanAbs += meshY[i]
      meanAbs = meanAbs / meshY.length + minElev
      const pos = new Float32Array((N + 1) * (N + 1) * 3)
      const uv = new Float32Array((N + 1) * (N + 1) * 2)
      const inside = new Uint8Array((N + 1) * (N + 1))
      const ys = new Float32Array((N + 1) * (N + 1))  // hauteur locale
      const low = new Uint8Array((N + 1) * (N + 1))   // « grignotable » par la mer (voir plus bas)
      const sea = new Uint8Array((N + 1) * (N + 1))
      // Le relief mondial est flou sur les côtes : il place le trait de côte, haut des falaises
      // compris, jusqu'à ~500 m trop au large, ce qui faisait ressortir une bande verte au-dessus
      // du plan d'eau. On « grignote » donc la côte : un point SANS donnée IGN (mer, ou étranger),
      // à moins de COAST_ERODE_M d'un point de mer et sous COAST_LOW_M, devient de la mer. Là où
      // l'IGN a une donnée, c'est de la terre : le grignotage s'arrête au vrai trait de côte.
      const COAST_LOW_M = 100
      const COAST_ERODE_M = 1500
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const k = j * (N + 1) + i
          const x = -half + (i / N) * farSideM, z = -half + (j / N) * farSideM
          const [lon, lat] = cov.unproject(x, z)
          const inMain = Math.abs(x) < worldW / 2 && Math.abs(z) < worldD / 2
          inside[k] = inMain ? 1 : 0
          if (inMain) {
            ys[k] = meshHeightAt(x, z) - 5
            sea[k] = isCoastal && ys[k] < seaLocalY ? 1 : 0
          } else {
            let e = far.elevAt ? far.elevAt(lon, lat) : NaN
            if (!Number.isFinite(e)) e = meanAbs
            sea[k] = e <= 0.5 || (e < 15 && far.isWaterAt(lon, lat)) ? 1 : 0
            low[k] = e < COAST_LOW_M && far.ignNoDataAt(lon, lat) ? 1 : 0
            ys[k] = e - minElev
          }
          pos[k * 3] = x; pos[k * 3 + 2] = z
          uv[k * 2] = (lon2tileX(lon, far.zoom) - far.txMin) / far.nx
          uv[k * 2 + 1] = 1 - (lat2tileY(lat, far.zoom) - far.tyMin) / far.ny
        }
      }
      const erodeSteps = Math.max(1, Math.round(COAST_ERODE_M / (farSideM / N)))
      for (let s = 0; s < erodeSteps; s++) {
        const next = sea.slice()
        for (let j = 1; j < N; j++) {
          for (let i = 1; i < N; i++) {
            const k = j * (N + 1) + i
            if (sea[k] || !low[k]) continue
            if (sea[k - 1] || sea[k + 1] || sea[k - N - 1] || sea[k + N + 1]) next[k] = 1
          }
        }
        sea.set(next)
      }
      farMinY = Infinity
      for (let k = 0; k < ys.length; k++) {
        // mer hors emprise : enfoncée à -30 m absolus, sous le plan d'eau
        const y = !inside[k] && sea[k] ? -30 - minElev : ys[k]
        pos[k * 3 + 1] = y
        farMinY = Math.min(farMinY, y)
      }
      const idx: number[] = []
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1
          if (inside[a] && inside[b] && inside[c] && inside[d]) continue
          idx.push(a, c, b, b, c, d)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      g.setIndex(idx)
      g.computeVertexNormals()
      const tex = new THREE.CanvasTexture(far.canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
      tex.anisotropy = maxAniso
      const farMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.97, metalness: 0,
        // (pas de polygonOffset : voir plus haut)
      }))
      scene.add(farMesh)
    }
  }

  // ── Gros plan (ortho haute définition) au départ et à l'arrivée ──────────────────────────
  // Sur un long tracé, le zoom ortho global tombe (contrainte mémoire/texture) -> le lieu
  // d'arrivée, sur lequel la caméra fait sa pause finale, est flou. On replaque ici un petit
  // encart d'orthophoto ~2 à 4 niveaux de zoom plus fins, calé sur le relief, juste au-dessus
  // du terrain, avec un fondu radial des bords pour se raccorder à la texture globale.
  async function buildOrthoInset(lon: number, lat: number): Promise<THREE.Mesh | null> {
    const HALF_M = 240
    const zoom = Math.min(18, cov.ZOOM_ORTHO + 3)
    if (zoom <= cov.ZOOM_ORTHO) return null // rien à gagner si le global est déjà aussi fin
    const dLat = HALF_M / 111320
    const dLon = HALF_M / (111320 * Math.cos(lat * Math.PI / 180))
    const txMin = Math.floor(lon2tileX(lon - dLon, zoom))
    const txMax = Math.floor(lon2tileX(lon + dLon, zoom))
    const tyMin = Math.floor(lat2tileY(lat + dLat, zoom))
    const tyMax = Math.floor(lat2tileY(lat - dLat, zoom))
    const nx = txMax - txMin + 1, ny = tyMax - tyMin + 1
    if (nx <= 0 || ny <= 0 || nx * ny > 90) return null // garde-fou (trop de tuiles)
    const res = await fetchOrthoTiles(txMin, tyMin, nx, ny, zoom, signal)
    if (!res.ok.some(Boolean)) return null
    gradeTerrainColors(res.canvas)
    const tex = new THREE.CanvasTexture(res.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = maxAniso
    tex.needsUpdate = true
    // Bornes géo réelles du canvas assemblé (tuiles entières) -> emprise monde de l'encart.
    const cLonMin = tileX2lon(txMin, zoom), cLonMax = tileX2lon(txMax + 1, zoom)
    const cLatMax = tileY2lat(tyMin, zoom), cLatMin = tileY2lat(tyMax + 1, zoom)
    const [ex0] = cov.project(cLonMin, lat)
    const [ex1] = cov.project(cLonMax, lat)
    const [, ez0] = cov.project(lon, cLatMax)
    const [, ez1] = cov.project(lon, cLatMin)
    const w = ex1 - ex0, d = ez1 - ez0
    const cenX = (ex0 + ex1) / 2, cenZ = (ez0 + ez1) / 2
    const SEG = 40
    const g = new THREE.PlaneGeometry(w, d, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const pa = g.attributes.position
    const col = new Float32Array(pa.count * 4)
    for (let i = 0; i < pa.count; i++) {
      const nX = pa.getX(i) / (w / 2), nZ = pa.getZ(i) / (d / 2) // -1..1 depuis le centre
      const wx = pa.getX(i) + cenX, wz = pa.getZ(i) + cenZ
      pa.setX(i, wx); pa.setZ(i, wz)
      const hg = meshHeightAt(wx, wz)
      pa.setY(i, hg + 0.6) // un cheveu au-dessus du terrain global
      const r = Math.max(Math.abs(nX), Math.abs(nZ))
      const s = Math.max(0, Math.min(1, 1 - (r - 0.6) / 0.4)) // opaque au centre, 0 au bord
      // Côté mer (terrain au ras de l'eau) : encart transparent, sinon la photo de la mer se superposait à
      // l'eau (la transparence de la mer vient du masque du terrain, que l'encart n'a pas ; et l'eau
      // n'écrit plus la profondeur, voir le plan d'eau : un encart enfoncé serait visible quand même).
      const onSea = isCoastal && hg < seaLocalY + 0.6
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1
      col[i * 4 + 3] = onSea ? 0 : s * s * (3 - 2 * s)
    }
    pa.needsUpdate = true
    g.setAttribute('color', new THREE.BufferAttribute(col, 4))
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.97, metalness: 0,
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }))
    m.renderOrder = 2
    m.receiveShadow = true
    return m
  }
  report('prepare', 0.92, 'Gros plan du départ et de l\'arrivée…', 1)
  for (const [lon, lat] of [trail[0], trail[trail.length - 1]]) {
    try {
      const inset = await buildOrthoInset(lon, lat)
      if (inset) scene.add(inset)
    } catch { /* réseau/couverture : on garde la texture globale */ }
    if (signal?.aborted) throw aborted()
  }

  let water: Water | null = null
  if (isCoastal) {
    // Couvre au moins le terrain de fond : la vue d'ensemble finale (caméra très haute) le montre
    // en entier — un plan d'eau plus petit laissait voir sa bordure sur les longs tracés.
    const span = Math.max(Math.min(40000, Math.max(worldW, worldD) * 4), farSideM * 1.05)
    const waterNormals = new THREE.TextureLoader().load(waterNormalsUrl, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    })
    water = new Water(new THREE.PlaneGeometry(span, span), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: sunPosition.clone().normalize(),
      sunColor: 0xffeeda,
      waterColor: 0x14476a, // = WATER_CRUISE (mis à jour à chaque image)
      distortionScale: 2.6,
      fog: scene.fog !== undefined,
    })
    water.rotation.x = -Math.PI / 2
    water.position.y = seaLocalY
    // Anti-clignotement du littoral : le terrain côtier est à 30 cm au-dessus de l'eau (mer rendue transparente
    // par son masque) ; vu de plusieurs km, le z-buffer ne départageait plus les deux -> scintillement. L'eau
    // est donc dessinée APRÈS les autres objets opaques (qui la masquent normalement : ruban, fond lointain
    // immergé…) et n'écrit PAS la profondeur : le terrain transparent, dessiné ensuite, passe toujours dessus.
    water.renderOrder = 10
    // Mer bleu profond (cf. Relive) : en vue rasante, la réflectance de Fresnel du shader Water monte vers 1 et
    // la surface n'est plus que le reflet du ciel clair (+ brume) -> mer gris-mauve quelle que soit waterColor.
    // On plafonne la réflectance et on teinte le reflet vers un bleu profond (patch du shader three.js).
    {
      const wm = water.material as THREE.ShaderMaterial
      const src = wm.fragmentShader
      const patched = src
        .replace(
          'float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );',
          'float reflectance = min( 0.35, rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 ) );',
        )
        .replace(
          'reflectionSample + specularLight, reflectance',
          'mix( reflectionSample, vec3( 0.03, 0.14, 0.25 ), 0.7 ) + specularLight, reflectance',
        )
      if (patched === src) console.warn('[film3d] shader Water : patch de couleur non appliqué (version de three ?)')
      wm.fragmentShader = patched
      wm.needsUpdate = true
    }
    ;(water.material as THREE.ShaderMaterial).depthWrite = false
    scene.add(water)
  }

  // Fond de brume sous tout le terrain : au-delà même du terrain de fond, le dégradé du ciel
  // apparaissait dans les coins de l'image vue de haut. Plan couleur brouillard, sous le point le
  // plus bas : invisible là où il y a du terrain, il prolonge l'horizon ailleurs.
  {
    const S = farSideM * 6
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(S, S),
      new THREE.MeshBasicMaterial({ color: '#d8e8f5' }),
    )
    skirt.rotation.x = -Math.PI / 2
    skirt.position.y = Math.min(-30, farMinY - 40)
    skirt.renderOrder = -1
    scene.add(skirt)
  }

  // --- Tracé GPX (ruban émissif) ---
  const rawPts: THREE.Vector3[] = smoothTrail(trail, 2, 2).map(([lon, lat]) => {
    const [x, z] = cov.project(lon, lat)
    return new THREE.Vector3(x, elevAtLonLat(lon, lat) - minElev, z)
  })
  const shapeCurve = new THREE.CatmullRomCurve3(rawPts)

  const RESAMPLE_COUNT = 500
  const trailPts: THREE.Vector3[] = []
  for (let i = 0; i <= RESAMPLE_COUNT; i++) {
    const s = shapeCurve.getPointAt(i / RESAMPLE_COUNT)
    const [x, z] = clampToPolyline(s.x, s.z, rawPts, 20)
    const [lon, lat] = cov.unproject(x, z)
    trailPts.push(new THREE.Vector3(x, elevAtLonLat(lon, lat) - minElev + 3.5, z))
  }
  const curve = new THREE.CatmullRomCurve3(trailPts)

  const cameraRawPts: THREE.Vector3[] = smoothTrail(trail, 10, 14).map(([lon, lat]) => {
    const [x, z] = cov.project(lon, lat)
    return new THREE.Vector3(x, elevAtLonLat(lon, lat) - minElev, z)
  })
  const cameraShapeCurve = new THREE.CatmullRomCurve3(cameraRawPts)
  const CAMERA_RESAMPLE_COUNT = 150
  const cameraPts: THREE.Vector3[] = []
  for (let i = 0; i <= CAMERA_RESAMPLE_COUNT; i++) {
    const s = cameraShapeCurve.getPointAt(i / CAMERA_RESAMPLE_COUNT)
    const [x, z] = clampToPolyline(s.x, s.z, cameraRawPts, 45)
    const [lon, lat] = cov.unproject(x, z)
    cameraPts.push(new THREE.Vector3(x, elevAtLonLat(lon, lat) - minElev + 3.5, z))
  }
  const cameraCurve = new THREE.CatmullRomCurve3(cameraPts)

  // Correspondance ruban -> caméra. La courbe caméra est très lissée : elle coupe baies et estuaires
  // (GR34 : 146 km contre 189 km de ruban). Suivre les deux à la même FRACTION de leur longueur
  // décalait la caméra jusqu'à 3,4 km du bout du ruban : la caméra filait tout droit pendant que le
  // ruban faisait le tour d'un estuaire, puis le ruban la rattrapait -> vitesse apparente du ruban
  // incompréhensible. On projette donc chaque point du ruban sur la courbe caméra (projection
  // MONOTONE, recherche dans une fenêtre en avant), puis on lisse la table.
  const camTFor: (t: number) => number = (() => {
    const N = 2000, M = 1500, WIN = Math.ceil(M * 0.05)
    const camPoly: THREE.Vector3[] = []
    for (let j = 0; j <= M; j++) camPoly.push(cameraCurve.getPointAt(j / M))
    const raw = new Float32Array(N + 1)
    const p = new THREE.Vector3()
    let jPrev = 0
    for (let i = 0; i <= N; i++) {
      curve.getPointAt(i / N, p)
      let best = jPrev, bd = Infinity
      for (let j = jPrev; j <= Math.min(M, jPrev + WIN); j++) {
        const dx = camPoly[j].x - p.x, dz = camPoly[j].z - p.z
        const d = dx * dx + dz * dz
        if (d < bd) { bd = d; best = j }
      }
      jPrev = best
      raw[i] = best / M
    }
    raw[0] = 0; raw[N] = 1
    // Lissage (moyenne glissante ±1 % du tracé) : pas de à-coups quand la projection saute l'embouchure
    // d'une baie ; puis monotonie et bornes 0 / 1.
    const R = Math.round(N * 0.01)
    const map = new Float32Array(N + 1)
    for (let i = 0; i <= N; i++) {
      let s = 0, n = 0
      for (let k = Math.max(0, i - R); k <= Math.min(N, i + R); k++) { s += raw[k]; n++ }
      map[i] = s / n
    }
    map[0] = 0; map[N] = 1
    for (let i = 1; i <= N; i++) map[i] = Math.max(map[i], map[i - 1])
    return (t: number) => {
      const x = Math.max(0, Math.min(1, t)) * N
      const i = Math.min(N - 1, Math.floor(x))
      return map[i] + (map[i + 1] - map[i]) * (x - i)
    }
  })()

  const distSegments: number[] = [0]
  for (let i = 1; i < trailPts.length; i++)
    distSegments.push(distSegments[i - 1] + trailPts[i].distanceTo(trailPts[i - 1]))
  const TOTAL_DISTANCE_M = distSegments[distSegments.length - 1]
  /** Distance affichée (compteur, bornes) : celle du tracé dans l'appli, comme le film 2D ; le ruban 3D, lissé, est
   * un peu plus court (20,5 km au lieu de 21,1 sur le semi de Lille). */
  const TRACK_M = opts.trackDistanceM ?? TOTAL_DISTANCE_M
  /** Distance annoncée (carton final : 21,1 km pour un semi, même si le GPX mesure 21,17 km) : le compteur s'y arrête,
   * l'écran-titre et le profil l'affichent. Les bornes restent au km mesuré sur le tracé. */
  const SHOWN_M = opts.shownDistanceM ?? TRACK_M

  // Dénivelé positif cumulé (pour l'écran-titre) : celui du tracé s'il est fourni, pour afficher
  // la même valeur que le bandeau de profil. Sinon, estimation depuis le relief, échantillonnage
  // grossier : on ne veut pas additionner le bruit du DEM sur chaque micro-pas de courbe.
  let elevGainM = opts.elevGainM ?? 0
  if (opts.elevGainM == null) {
    const step = Math.max(1, Math.round(trailPts.length / 60))
    for (let i = step; i < trailPts.length; i += step) {
      const d = trailPts[i].y - trailPts[i - step].y
      if (d > 0) elevGainM += d
    }
  }

  // Garde-fou : un panneau à plus de PANEL_MAX_OFF_M du tracé est une erreur en amont (ex. localités d'un
  // tracé précédent restées en mémoire : celles du GR34 breton sur un tracé corse) — sinon tous
  // s'accrochaient au même point du tracé le plus proche et s'empilaient. On les écarte.
  const PANEL_MAX_OFF_M = 3000
  const scenePanels = (opts.panels ?? []).filter(pnl => {
    const [px, pz] = cov.project(pnl.lon, pnl.lat)
    let best = Infinity
    for (const p of trailPts) best = Math.min(best, (p.x - px) ** 2 + (p.z - pz) ** 2)
    const keep = best <= PANEL_MAX_OFF_M ** 2
    if (!keep) console.warn(`[film3d] panneau « ${pnl.name} » écarté : à ${Math.round(Math.sqrt(best) / 1000)} km du tracé`)
    return keep
  })

  // Paramètre de courbe (0..1) du point le plus proche de chaque panneau de localité — sert au
  // ralenti près des panneaux (ci-dessous) et au déclenchement des sprites (plus bas).
  const panelCurveParams: number[] = scenePanels.map(pnl => {
    const [px, pz] = cov.project(pnl.lon, pnl.lat)
    let bestI = 0, bestD = Infinity
    for (let i = 0; i < trailPts.length; i++) {
      const dx = trailPts[i].x - px, dz = trailPts[i].z - pz
      const d = dx * dx + dz * dz
      if (d < bestD) { bestD = d; bestI = i }
    }
    return bestI / RESAMPLE_COUNT
  })

  // Profil de vitesse le long du tracé, à DURÉE TOTALE CONSTANTE (la table normalise par le
  // coût cumulé) : le "coût de temps" de chaque pas de courbe est pondéré, puis on inverse le
  // cumul. On ralentit (a) dans les montées raides, (b) au voisinage d'un panneau de localité —
  // le temps de le lire. Le temps "dépensé" ici est "emprunté" aux portions plates et rapides.
  // (Le démarrage progressif « mise en route » est géré à part, par un ease sur le temps — voir
  //  startupEase / STARTUP_RAMP_S dans la timeline.)
  // VITESSE CONSTANTE (demande utilisateur 2026-09-28, GR34 : « trop de variation de vitesse
  // incompréhensible ») : ralentis de pente et de panneaux mis à 0. Le mécanisme de profil est conservé
  // (poids = 1 partout -> progression linéaire) pour pouvoir le réactiver.
  const SLOPE_SLOWDOWN = 0, SLOPE_REF = 12, SLOPE_CAP = 3 // (2,2 avant)
  const DESCENT_SLOWDOWN = 0, DESCENT_REF = 12, DESCENT_CAP = 3 // (1,3 avant) : vitesse constante
  // Exception (2026-09-28, GTA J3 : « la montée vers le col de la Corne est très rapide alors que la
  // pente est très importante ») : ralenti SEULEMENT dans les vraies montées raides — rien sous
  // STEEP_FROM % (vallonnements, côtes du GR34 inchangés), montée progressive jusqu'à ×(1 + STEEP_SLOWDOWN)
  // à STEEP_FULL %. Pente lissée sur ~200-300 m (courts tracés) : un raidillon de 30 m ne compte pas.
  const STEEP_FROM = 12, STEEP_FULL = 30, STEEP_SLOWDOWN = 2
  const PANEL_SLOWDOWN = 0         // (3,5 avant) pas de ralenti aux panneaux : vitesse du ruban constante
  // Demi-largeurs de la bosse de ralenti, en fraction du tracé MAIS plafonnées en mètres : 4 % / 1,3 %
  // donnaient 8 km d'approche et 2,7 km de sortie sur un GR de 200 km — le ruban rampait des km avant
  // chaque panneau, et le temps ainsi perdu était repris en sprint entre les panneaux. Tracés courts
  // (< ~37 km) : inchangés.
  const PANEL_SLOW_WIDTH_IN = Math.min(0.04, 1500 / TOTAL_DISTANCE_M)   // AVANT le panneau (approche)
  const PANEL_SLOW_WIDTH_OUT = Math.min(0.013, 500 / TOTAL_DISTANCE_M)  // APRÈS : ré-accélération rapide
  // Poids maximal d'un pas (1 = plat hors panneau) : borne l'écart lent / rapide à ~×3,5, quels que
  // soient la pente et le nombre de panneaux voisins.
  const SPEED_WEIGHT_CAP = 3.5
  // Coût moyen du remap (Σ poids / nb de pas) : facteur de sur-vitesse des portions de croisière
  // vs une traversée linéaire — sert au plafond de vitesse de croisière (voir DURATION plus bas).
  let cruiseStretch = 1
  const slopeRemap: number[] = (() => {
    // Un pas tous les 150 m au plus (400 minimum) : sur un long tracé, 400 pas (515 m sur 206 km)
    // étaient plus grossiers que la sortie de bosse d'un panneau (500 m).
    const S = Math.max(400, Math.ceil(TOTAL_DISTANCE_M / 150))
    const SMOOTH_K = Math.max(3, Math.round((3 * S) / 400)) // même lissage de pente (en fraction) qu'à 400 pas
    const _pa = new THREE.Vector3(), _pb = new THREE.Vector3()
    const slopeUp: number[] = []
    const slopeDown: number[] = []
    for (let i = 0; i <= S; i++) {
      const u = i / S
      curve.getPointAt(Math.max(0, u - 0.004), _pa)
      curve.getPointAt(Math.min(1, u + 0.004), _pb)
      const dxz = Math.hypot(_pb.x - _pa.x, _pb.z - _pa.z) || 1e-6
      const dy = _pb.y - _pa.y
      // Montée et descente ralentissent chacune le ruban, la descente moins fort (voir DESCENT_SLOWDOWN).
      slopeUp.push((Math.max(0, dy) / dxz) * 100)
      slopeDown.push((Math.max(0, -dy) / dxz) * 100)
    }
    const smUp = slopeUp.slice()
    const smDown = slopeDown.slice()
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= S; i++) {
        let accUp = 0, accDown = 0, n = 0
        for (let k = -SMOOTH_K; k <= SMOOTH_K; k++) {
          const j = i + k; if (j < 0 || j > S) continue
          accUp += smUp[j]; accDown += smDown[j]; n++
        }
        smUp[i] = accUp / n
        smDown[i] = accDown / n
      }
    }
    const cost: number[] = [0]
    for (let i = 1; i <= S; i++) {
      const u = i / S
      let w = 1 + SLOPE_SLOWDOWN * Math.min(SLOPE_CAP, smUp[i] / SLOPE_REF)
        + STEEP_SLOWDOWN * Math.max(0, Math.min(1, (smUp[i] - STEEP_FROM) / (STEEP_FULL - STEEP_FROM)))
        + DESCENT_SLOWDOWN * Math.min(DESCENT_CAP, smDown[i] / DESCENT_REF)
      // Bosse de ralenti ASYMÉTRIQUE : approche douce avant le panneau, puis flanc arrière beaucoup
      // plus court -> le ruban ré-accélère vite juste après l'avoir dépassé. On prend la bosse du
      // panneau le PLUS PROCHE (max), pas la somme : un groupe de localités rapprochées empilait ses
      // ralentis et figeait le ruban (jusqu'à ~×10 plus lent qu'ailleurs sur le GR34).
      let bump = 0
      for (const pt of panelCurveParams) {
        const half = u <= pt ? PANEL_SLOW_WIDTH_IN : PANEL_SLOW_WIDTH_OUT
        const d = Math.abs(u - pt) / half
        if (d < 1) { const b = 1 - d * d; bump = Math.max(bump, PANEL_SLOWDOWN * b * b) }
      }
      w = Math.min(SPEED_WEIGHT_CAP, w + bump)
      cost.push(cost[i - 1] + w)
    }
    const total = cost[S]
    cruiseStretch = total / S
    const REMAP = 256
    const table: number[] = []
    let j = 0
    for (let r = 0; r <= REMAP; r++) {
      const target = (r / REMAP) * total
      while (j < S && cost[j + 1] < target) j++
      const span = cost[j + 1] - cost[j] || 1
      table.push((j + (target - cost[j]) / span) / S)
    }
    return table
  })()
  function slopeRemapT(p: number): number {
    const x = Math.max(0, Math.min(1, p)) * (slopeRemap.length - 1)
    const i = Math.floor(x)
    if (i + 1 >= slopeRemap.length) return slopeRemap[slopeRemap.length - 1]
    const f = x - i
    return slopeRemap[i] * (1 - f) + slopeRemap[i + 1] * f
  }

  // Ruban + fil central (port de main.ts)
  const BRAND_GREEN = new THREE.Color('#3E9E68')
  const BRAND_ORANGE = new THREE.Color('#D97A3D')
  const BRAND_CREAM = new THREE.Color('#F4EDE0')
  const GRADIENT_REPEATS = 8
  function cyclicBrandColor(t: number): THREE.Color {
    const p = (t * GRADIENT_REPEATS) % 1
    let c: THREE.Color
    if (p < 1 / 3) c = BRAND_GREEN.clone().lerp(BRAND_ORANGE, p * 3)
    else if (p < 2 / 3) c = BRAND_ORANGE.clone().lerp(BRAND_CREAM, (p - 1 / 3) * 3)
    else c = BRAND_CREAM.clone().lerp(BRAND_GREEN, (p - 2 / 3) * 3)
    return c.offsetHSL(0, 0.28, 0.05)
  }

  // 4000 (et non 1600) : la révélation du ruban se fait par pas entiers de segment
  // (setDrawRange / instanceCount). Dans les zones de ralenti (voisinage d'un panneau,
  // montée raide) l'avancée par frame passe sous 1/1600 de tracé -> le bout saute d'un
  // segment toutes les quelques frames (saccades). Segments plus fins = pas ~2,5× plus
  // courts, sous le seuil perceptible. Le surcoût de construction (une passe de plus sur
  // meshHeightAt) reste < 0,5 s, hors boucle d'encodage.
  const RIBBON_SEGMENTS = 4000
  const RIBBON_WIDTH = 10
  const RIBBON_CLEARANCE = 3
  const ribbonPositions: number[] = []
  const ribbonColors: number[] = []
  const ribbonIndices: number[] = []
  const corePositions: number[] = []
  const coreColors: number[] = []
  const _p = new THREE.Vector3()
  const _tan = new THREE.Vector3()
  let lastRX = RIBBON_WIDTH / 2, lastRZ = 0
  let lastPx = 0, lastPy = 0, lastPz = 0
  curve.getPointAt(0, _p)
  if (Number.isFinite(_p.x)) { lastPx = _p.x; lastPy = _p.y; lastPz = _p.z }
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS
    curve.getPointAt(t, _p)
    curve.getTangentAt(t, _tan)
    const px = Number.isFinite(_p.x) ? _p.x : lastPx
    const py = Number.isFinite(_p.y) ? _p.y : lastPy
    const pz = Number.isFinite(_p.z) ? _p.z : lastPz
    lastPx = px; lastPy = py; lastPz = pz
    let rX = -_tan.z, rZ = _tan.x
    const rl = Math.sqrt(rX * rX + rZ * rZ)
    if (Number.isFinite(rl) && rl > 1e-5) {
      rX = (rX / rl) * (RIBBON_WIDTH / 2); rZ = (rZ / rl) * (RIBBON_WIDTH / 2)
      lastRX = rX; lastRZ = rZ
    } else { rX = lastRX; rZ = lastRZ }
    const lx = px + rX, lz = pz + rZ
    const rx = px - rX, rz = pz - rZ
    let gmax = -Infinity
    for (let k = -2; k <= 2; k++) {
      const f = k / 4
      const h = meshHeightAt(px + rX * f * 2, pz + rZ * f * 2)
      if (h > gmax) gmax = h
    }
    const yTop = Math.max(py, gmax + RIBBON_CLEARANCE)
    const ly = Math.max(yTop, meshHeightAt(lx, lz) + RIBBON_CLEARANCE)
    const ry = Math.max(yTop, meshHeightAt(rx, rz) + RIBBON_CLEARANCE)
    ribbonPositions.push(lx, ly, lz, rx, ry, rz)
    const c = cyclicBrandColor(t)
    ribbonColors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    corePositions.push(px, Math.max(yTop, ly, ry) + 1.2, pz)
    coreColors.push(c.r, c.g, c.b)
    if (i < RIBBON_SEGMENTS) {
      const i0 = i * 2, i1 = i * 2 + 1, i2 = i * 2 + 2, i3 = i * 2 + 3
      ribbonIndices.push(i0, i2, i1, i1, i2, i3)
    }
  }
  const ribbonGeom = new THREE.BufferGeometry()
  ribbonGeom.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3))
  ribbonGeom.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3))
  ribbonGeom.setIndex(ribbonIndices)
  ribbonGeom.computeVertexNormals()
  ribbonGeom.setDrawRange(0, 6)

  // Largeur constante : le ruban se termine en coupe franche (rectangle), sans rétrécissement
  // vers la ligne centrale sur les derniers segments. La révélation se fait uniquement par
  // `setDrawRange` (voir simStep). Un capuchon en demi-disque (`tipCap`, plus bas) coiffe
  // l'extrémité révélée pour la terminer en rond (comme un `lineCap:'round'`).
  const ribbonMesh = new THREE.Mesh(ribbonGeom, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.22, metalness: 0, side: THREE.DoubleSide,
  }))
  ribbonMesh.layers.set(NO_REFLECT_LAYER)
  scene.add(ribbonMesh)

  const coreGeom = new LineGeometry()
  coreGeom.setPositions(corePositions)
  coreGeom.setColors(coreColors)
  const coreMat = new LineMaterial({
    vertexColors: true, worldUnits: false, linewidth: 3.2,
    alphaToCoverage: false, transparent: true, opacity: 0.95,
  })
  coreMat.resolution.set(OUT_W, OUT_H)
  const ribbonCore = new Line2(coreGeom, coreMat)
  ribbonCore.renderOrder = 2
  ribbonCore.frustumCulled = false
  ribbonCore.layers.set(NO_REFLECT_LAYER)
  coreGeom.instanceCount = 1
  scene.add(ribbonCore)

  // ── Capuchon du bout du ruban : DEMI-DISQUE (bout arrondi façon `lineCap:'round'`, comme les
  // extrémités du tracé du logo). Posé à plat sur l'extrémité révélée : demi-disque de rayon
  // RIBBON_WIDTH/2 qui déborde vers l'avant (+X local = tangente), + un petit recouvrement
  // arrière pour masquer la couture avec la coupe franche du ruban. Réorienté et recoloré à
  // chaque frame (voir updateTipCap) pour suivre le bout pendant la révélation.
  const tipCapGeom = (() => {
    const hw = RIBBON_WIDTH / 2, ARC = 18, OVERLAP = Math.min(3, hw)
    const outline: [number, number][] = [[-OVERLAP, hw]]                     // arrière +Z
    for (let k = 0; k <= ARC; k++) {                                        // demi-cercle avant : +90° -> -90°
      const a = Math.PI / 2 - (k / ARC) * Math.PI
      outline.push([hw * Math.cos(a), hw * Math.sin(a)])
    }
    outline.push([-OVERLAP, -hw])                                           // arrière -Z
    const pos: number[] = [], nrm: number[] = []
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i], q = outline[(i + 1) % outline.length]
      pos.push(0, 0, 0, p[0], 0, p[1], q[0], 0, q[1])                       // éventail depuis l'origine (bout du ruban)
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    return g
  })()
  const tipCap = new THREE.Mesh(tipCapGeom, new THREE.MeshStandardMaterial({
    roughness: 0.22, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }))
  tipCap.layers.set(NO_REFLECT_LAYER)
  tipCap.renderOrder = 1
  tipCap.frustumCulled = false
  tipCap.visible = false
  scene.add(tipCap)
  // Le capuchon est calé sur la DERNIÈRE ARÊTE VISIBLE du ruban (ses 2 sommets de bord), pas sur
  // la courbe : sinon, sur une pente raide, le disque plat flottait/perçait le ruban incliné
  // -> pointes et encoches au bout. On reconstruit ici le repère local exact du ruban à son bout.
  const _cL = new THREE.Vector3(), _cR = new THREE.Vector3(), _cLp = new THREE.Vector3(), _cRp = new THREE.Vector3()
  const _cX = new THREE.Vector3(), _cY = new THREE.Vector3(), _cZ = new THREE.Vector3()
  const _cMat = new THREE.Matrix4()
  function ribbonSeg(i: number, L: THREE.Vector3, R: THREE.Vector3): void {
    const b = Math.max(0, Math.min(RIBBON_SEGMENTS, i)) * 6
    L.set(ribbonPositions[b], ribbonPositions[b + 1], ribbonPositions[b + 2])
    R.set(ribbonPositions[b + 3], ribbonPositions[b + 4], ribbonPositions[b + 5])
  }
  // `seg` peut être FRACTIONNAIRE (position exacte du bout révélé, pas arrondie au segment) :
  // le capuchon glisse alors en continu même quand le corps du ruban, lui, ne peut avancer que
  // par segments entiers -> le pas résiduel du corps passe sous le disque en mouvement.
  /** Position de la tête du ruban, en segment fractionnaire (cf. drawRunner). */
  let runnerSeg = 0
  /** Tête du ruban arrivée au bout : la visée en avant l'y amène avant la fin du survol (cf. simStep). */
  let runnerAtEnd = false
  /** Part du parcours atteinte par la tête du ruban pendant le survol (rue affichée, cf. StreetCaption). */
  let headFrac = 0
  function updateTipCap(seg: number, colorT: number): void {
    const sf = Math.max(1, Math.min(RIBBON_SEGMENTS, seg))
    const s0 = Math.min(RIBBON_SEGMENTS - 1, Math.floor(sf))
    const fr = sf - s0
    // Arête de tête = interpolation entre le segment s0 et s0+1 (glissement sous-segment).
    ribbonSeg(s0, _cL, _cR)
    ribbonSeg(s0 + 1, _cLp, _cRp)
    _cL.lerp(_cLp, fr); _cR.lerp(_cRp, fr)
    // Référence "avant" : un segment en arrière du bout (direction de progression).
    ribbonSeg(Math.max(0, s0 - 1), _cLp, _cRp)
    const midX = (_cL.x + _cR.x) / 2, midY = (_cL.y + _cR.y) / 2, midZ = (_cL.z + _cR.z) / 2
    _cZ.subVectors(_cR, _cL)                                          // axe latéral du ruban
    _cX.set(midX - (_cLp.x + _cRp.x) / 2, midY - (_cLp.y + _cRp.y) / 2, midZ - (_cLp.z + _cRp.z) / 2) // avant
    runnerSeg = sf // coureuse : pieds sur la tête du ruban (cf. drawRunner)
    // Repère dégénéré (segment nul, épingle serrée…) -> on masque le capuchon plutôt que de
    // produire un quaternion NaN qui polluerait tout le rendu de l'image.
    if (_cZ.lengthSq() < 1e-6 || _cX.lengthSq() < 1e-6 ||
        !Number.isFinite(midX) || !Number.isFinite(midY) || !Number.isFinite(midZ)) {
      tipCap.visible = false
      return
    }
    _cZ.normalize(); _cX.normalize()
    _cY.crossVectors(_cZ, _cX)
    if (_cY.lengthSq() < 1e-6) { tipCap.visible = false; return }
    _cY.normalize()
    _cX.crossVectors(_cY, _cZ).normalize()                           // ré-orthogonalise -> repère propre
    _cMat.makeBasis(_cX, _cY, _cZ)
    tipCap.quaternion.setFromRotationMatrix(_cMat)
    tipCap.position.set(midX, midY, midZ).addScaledVector(_cY, 0.4)  // décollé d'un cheveu (anti z-fight)
    ;(tipCap.material as THREE.MeshStandardMaterial).color.copy(cyclicBrandColor(colorT))
    tipCap.visible = true
  }

  // Marqueurs départ / arrivée
  const markerGeom = new THREE.SphereGeometry(6, 24, 24)
  const startMarker = new THREE.Mesh(markerGeom,
    new THREE.MeshStandardMaterial({ color: '#38ef7d', emissive: '#25f47c', emissiveIntensity: 2.0 }))
  startMarker.position.copy(trailPts[0])
  startMarker.layers.set(NO_REFLECT_LAYER)
  scene.add(startMarker)
  const endMarker = new THREE.Mesh(markerGeom,
    new THREE.MeshStandardMaterial({ color: '#ff416c', emissive: '#ff1d53', emissiveIntensity: 2.0 }))
  endMarker.position.copy(trailPts[trailPts.length - 1])
  endMarker.layers.set(NO_REFLECT_LAYER)
  scene.add(endMarker)

  // Panneaux localité + départ/arrivée
  // Toujours au premier plan (sans test de profondeur) : un panneau planté dans un vallon ou derrière
  // une crête était sinon tranché par le relief (« enchâssé dans la montagne »). Comme des étiquettes
  // (façon Relive), ils restent lisibles même quand le relief les masque.
  function makePanelSprite(tex: THREE.CanvasTexture): THREE.Sprite {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, alphaTest: 0.4 }))
    sprite.renderOrder = 10
    return sprite
  }
  function sizeSpriteFromTexture(sprite: THREE.Sprite, tex: THREE.CanvasTexture, worldWidth = 240): void {
    const img = tex.image as HTMLCanvasElement
    sprite.scale.set(worldWidth, worldWidth * (img.height / img.width), 1)
  }
  /** Taille monde d'un px « logique » des noms au sol : lettres à taille constante, quelle que soit la longueur du nom. */
  const GROUND_LABEL_WORLD_PER_PX = 1.7
  /** Nom de lieu comme en 2D : écrit au sol (centré sur le point, sans poteau) ; les cols gardent leur pancarte. */
  function makeLocSprite(name: string, style: 'lieudit' | 'col' | 'standard' | 'poi', anchor: THREE.Vector3, ele?: number, colWidth = 340): THREE.Sprite {
    const isCol = style === 'col'
    const tex = isCol ? panelTexture(name, style, ele) : groundLabelTexture(name, style)
    renderer.initTexture(tex)
    const sprite = makePanelSprite(tex)
    if (isCol) {
      sizeSpriteFromTexture(sprite, tex, colWidth)
      sprite.center.set(0.5, 0)
    } else {
      const img = tex.image as HTMLCanvasElement
      const k = GROUND_LABEL_WORLD_PER_PX / GROUND_LABEL_RES
      sprite.scale.set(img.width * k, img.height * k, 1)
      sprite.center.set(0.5, 0.5)
    }
    sprite.position.set(anchor.x, anchor.y, anchor.z)
    sprite.visible = false
    sprite.layers.set(NO_REFLECT_LAYER)
    scene.add(sprite)
    return sprite
  }
  const panelSprites: { sprite: THREE.Sprite; t: number; isCol: boolean }[] = scenePanels.map((pnl, idx) => {
    const panelT = panelCurveParams[idx]
    const anchor = trailPts[Math.round(panelT * RESAMPLE_COUNT)]
    const sprite = makeLocSprite(pnl.name, pnl.style, anchor, pnl.ele)
    return { sprite, t: panelT, isCol: pnl.style === 'col' }
  })
  function makeEndpointPanel(name: string, anchor: THREE.Vector3, colEle?: number, lieudit?: boolean): THREE.Sprite {
    const isCol = colEle != null
    return makeLocSprite(name, isCol ? 'col' : lieudit ? 'lieudit' : 'standard', anchor, colEle)
  }
  const departurePanel = opts.showDeparturePanel === false
    ? null : makeEndpointPanel(opts.departureName, trailPts[0], opts.departureColEle, opts.departureLieudit)
  const arrivalPanel = opts.showArrivalPanel === false
    ? null : makeEndpointPanel(opts.arrivalName, trailPts[trailPts.length - 1], opts.arrivalColEle, opts.arrivalLieudit)
  // Taille apparente minimale des panneaux : au-delà de ~1,5 km, la largeur monde fixe tombe
  // sous ~150 px et le texte devient illisible. On agrandit alors le sprite proportionnellement
  // à la distance caméra (largeur ≥ PANEL_MIN_ANGULAR · distance, ≈ 170 px à 1080p, FOV 55°).
  // Noms au sol : minimum sur la HAUTEUR (lettres ≥ ~24 px à 1080p, comme l'ancien panneau), la largeur suivant
  // la longueur du nom.
  const PANEL_MIN_ANGULAR = 0.165
  const LABEL_MIN_ANGULAR_H = 0.055
  const panelBaseScales = [
    ...panelSprites.map(p => p.sprite),
    ...[departurePanel, arrivalPanel].filter((s): s is THREE.Sprite => s != null),
  ].map(sprite => ({ sprite, w: sprite.scale.x, h: sprite.scale.y, isLabel: sprite.center.y === 0.5 }))
  function enforcePanelMinSize(camPos: THREE.Vector3): void {
    for (const { sprite, w, h, isLabel } of panelBaseScales) {
      if (!sprite.visible) continue
      const d = sprite.position.distanceTo(camPos)
      const k = Math.max(1, isLabel ? (d * LABEL_MIN_ANGULAR_H) / h : (d * PANEL_MIN_ANGULAR) / w)
      sprite.scale.set(w * k, h * k, 1)
    }
  }

  // Lumières
  scene.add(new THREE.AmbientLight('#fff7ed', 0.62 + cc * 0.25))
  scene.add(new THREE.HemisphereLight('#e7eae1', '#5b5c41', 0.5 + cc * 0.25))
  const sun = new THREE.DirectionalLight('#ffeeda', 1.35 * (1 - cc * 0.4))
  // Offline : shadow map 4096 (vs 1024 en temps réel) et frustum d'ombre calé sur l'emprise.
  // Ces 4 réglages peuvent demander une passe de retouche selon le relief (acné / ombres coupées).
  const sceneSpan = Math.max(worldW, worldD)
  sun.position.copy(sunPosition).multiplyScalar(sceneSpan * 1.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048) // 2048 (pas 4096) : -48 Mo de mémoire GPU retenue tout l'export, invisible en PCF à 1080p
  sun.shadow.camera.near = sceneSpan * 0.2
  sun.shadow.camera.far = sceneSpan * 2.8
  const shadowBounds = sceneSpan * 0.62
  sun.shadow.camera.left = -shadowBounds
  sun.shadow.camera.right = shadowBounds
  sun.shadow.camera.top = shadowBounds
  sun.shadow.camera.bottom = -shadowBounds
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 2.5 // décale l'échantillonnage le long de la normale -> tue l'acné sur le maillage grossier
  scene.add(sun)

  // ── PHASE 3 : RIG CAMÉRA + TIMELINE (port de main.ts, sans slider/orbite/replay) ─────────
  const CAM_OFFSET_ALT = 590 // (470 avant) caméra un peu plus haute : le relief est mieux dominé
  const CAM_OFFSET_DIST = 700
  const HEADING_INERTIA = 0.006
  const LOOK_RAISE = 60
  const LOOK_AHEAD = 0.02
  const LOOK_AHEAD_RAMP_S = 3.5 // s : montée progressive de l'avance de visée en début de survol
  // Avance de déclenchement des panneaux (en paramètre de courbe 0..1) : le panneau apparaît
  // avant que le ruban ne l'atteigne, pour qu'il soit déjà à l'écran quand la caméra arrive
  // dessus (sinon, caméra rapide + proche = pas le temps de le lire).
  const PANEL_LEAD = 0.05
  // « Mise en route » : accélération progressive de 0 -> vitesse de croisière sur les
  // STARTUP_RAMP_S premières SECONDES du survol (durée FIXE, pas une fraction du film — un film
  // long ne doit pas avoir un démarrage plus long). Après la rampe, la progression du temps est
  // linéaire ; elle tourne un poil plus vite (1/(1-f/2)) pour rattraper le temps « perdu ».
  const STARTUP_RAMP_S = 3
  // Vitesse du ruban : on PLAFONNE la croisière (portions plates, hors panneau) à un plancher de
  // secondes-par-km, indépendamment de la durée demandée. Sur les longs tracés la durée passée par
  // l'app sature (clamp max) et le ruban filait de plus en plus vite d'un tracé à l'autre. Si la
  // durée demandée impliquerait une croisière plus rapide que CRUISE_MIN_SPKM (≈ 550 m/s), on
  // ALLONGE le survol pour tenir le plafond : le film est plus long, la croisière reste constante.
  //   cruise m/s ≈ DISTANCE · cruiseStretch · CRUISE_COMP / DURATION
  // L'extension est BORNÉE à MAX_FLIGHT_S (2 min) : au-delà (GR de 200 km…), le ruban dépasse le
  // plafond au sol, et c'est la CAMÉRA qui compense en prenant de la hauteur (camK ci-dessous),
  // comme Relive (219 km en 106 s, caméra à plusieurs km). effStretch borné à 2 : un tracé à
  // panneaux rapprochés (cruiseStretch 4-5) ne démultiplie pas la durée.
  const CRUISE_MIN_SPKM = 1.8
  const MAX_FLIGHT_S = 120
  const askedDuration = opts.durationS && opts.durationS > 0 ? opts.durationS : 52
  const CRUISE_COMP = 1 / (1 - Math.min(0.5, STARTUP_RAMP_S / askedDuration) / 2)
  const effStretch = Math.min(2.0, cruiseStretch)
  const cruiseCapDuration = (TOTAL_DISTANCE_M / 1000) * effStretch * CRUISE_COMP * CRUISE_MIN_SPKM
  const DURATION = opts.essai ? askedDuration : Math.max(askedDuration, Math.min(MAX_FLIGHT_S, cruiseCapDuration))
  // Vitesse PERÇUE = vitesse au sol / distance caméra. Quand la croisière dépasse CAM_REF_SPEED
  // (m/s, ≈ celle d'une rando de 30-40 km), on éloigne la caméra d'autant : le défilement à l'écran
  // reste celui d'une rando ordinaire. camK = 1 sur les tracés courts (rien ne change).
  const CAM_REF_SPEED = 400
  const cruiseSpeed = (TOTAL_DISTANCE_M * cruiseStretch * CRUISE_COMP) / DURATION
  const camK = Math.min(12, Math.max(1, cruiseSpeed / CAM_REF_SPEED))
  // f = part de la progression normalisée (0..1) couverte par la rampe = STARTUP_RAMP_S / DURATION.
  const startupFrac = Math.min(0.5, STARTUP_RAMP_S / DURATION)
  function startupEase(x: number): number {
    const f = startupFrac
    const h = x < f ? (x * x) / (2 * f) : x - f / 2
    return h / (1 - f / 2)
  }
  // Ouverture, en 2 temps :
  //  1. écran NOIR, le titre (date + nom + km + D+) s'y inscrit en fondu sur TITLE_IN_S ;
  //  2. le noir se lève sur SCENE_REVEAL_S ET le titre se ferme EN MÊME TEMPS -> on ne voit
  //     jamais le titre sur le paysage. Le survol démarre 0,5 s AVANT la fin de la levée du noir.
  const TITLE_IN_S = 4         // écran noir tenu pendant que le titre s'inscrit en fondu
  const SCENE_REVEAL_S = 1.6   // levée du noir = fermeture du titre (simultanées)
  const RIBBON_EARLY_S = 0.5   // le ruban démarre ce délai avant la fin de la levée du noir
  const INTRO_CARD_S = TITLE_IN_S + SCENE_REVEAL_S - RIBBON_EARLY_S // = début du survol
  // Pause caméra fixe sur le départ, le temps de le lire : 1,5 s visible une fois le noir entièrement levé (la pause
  // commence RIBBON_EARLY_S avant la fin de la levée). Avec une heure de départ : écran fixe START_CLOCK_SHOW_S, heure
  // affichée, puis heure effacée sur START_CLOCK_FADE_S ; le survol ne part qu'ensuite.
  const START_CLOCK_SHOW_S = 2, START_CLOCK_FADE_S = 0.6
  const hasStartClock = startClock(opts.startTime, opts.startTimePlanned ?? true) != null
  const START_PAUSE = (hasStartClock ? START_CLOCK_SHOW_S + START_CLOCK_FADE_S : 1.5) + RIBBON_EARLY_S
  // Arrivée : pas de rapprochement caméra (demande 2026-09-28 : « juste un dézoom pour l'ensemble du tracé
  // et image fixe »), mais une pause caméra fixe de 2 s sur l'arrivée avant la montée vers la vue
  // d'ensemble (demande 2026-09-29).
  const END_PAUSE = 2
  const ARRIVAL_PANEL_LEAD_S = 5 // le panneau d'arrivée apparaît 5 s avant que le ruban arrive au bout
  // Vue d'ensemble finale : après la pause d'arrivée, la caméra s'élève (zoom arrière à échelle
  // log) jusqu'à cadrer TOUT le tracé, puis tient ce plan. Les panneaux intermédiaires s'effacent.
  const OVERVIEW_RISE_S = 4.5
  // Image fixe finale : OVERVIEW_CLEAN_S sans le carton du bas (le tracé seul), puis l'adresse en fondu, 5 s.
  const OVERVIEW_CLEAN_S = 2
  const OVERVIEW_HOLD_S = OVERVIEW_CLEAN_S + 5
  const END_ZOOM = 1 // (0,58 avant) plus de rapprochement à l'arrivée : on dézoome directement vers la vue d'ensemble
  const ZOOM_LEAD = 12
  const INTRO_FRAC = 0.12
  const INTRO_PROX = 0.58
  const PHASE0_END = INTRO_CARD_S                 // fin de l'écran-titre
  const PHASE1_END = PHASE0_END + START_PAUSE     // fin de la pause caméra fixe
  const PHASE2_END = PHASE1_END + DURATION        // fin du survol
  const PHASE3_END = PHASE2_END + END_PAUSE        // fin de la pause d'arrivée
  const TOTAL_CYCLE = PHASE3_END + OVERVIEW_RISE_S + OVERVIEW_HOLD_S
  const WATERMARK_LEAD = 5 // adresse de fin sur les 5 dernières secondes (vue d'ensemble), comme le film 2D
  // Essai : seul le survol est rendu (de PHASE1_END à PHASE2_END) ; ce qui précède est simulé sans image.
  const RENDER_FROM = opts.essai ? PHASE1_END : 0
  const FILM_S = (opts.essai ? PHASE2_END : TOTAL_CYCLE) - RENDER_FROM

  const _oa = new THREE.Vector3()
  const _ob = new THREE.Vector3()
  const _smoothHeading = new THREE.Vector3()
  let smoothHeadingInit = false
  let camTcur = 0              // position courante sur la courbe caméra (vitesse plafonnée, voir simStep)
  const CAM_MAX_SPEED_K = 1.6  // vitesse d'avance max de la caméra, en multiple de sa vitesse moyenne
  // Cap de la caméra (elle se place « derrière » le ruban) : tangente de la courbe caméra mesurée sur une
  // base proportionnelle à la distance caméra (et non ±0,1 % du tracé : ±150 m sur le GR34, bruité), et
  // inertie d'autant plus forte que la caméra est loin — à ~5 km derrière le ruban, un virage de 90°
  // lui faisait balayer ~7 km en 2-3 s (paysage qui tourne très vite).
  const camCurveLen = cameraCurve.getLength()
  const HEAD_WIN = Math.min(0.05, Math.max(0.001, (CAM_OFFSET_DIST * camK) / camCurveLen))
  const headingInertia = HEADING_INERTIA / Math.sqrt(camK)
  /** `ct` : position sur la COURBE CAMÉRA (0..1), pas sur le ruban (voir camTFor / camTcur). */
  function cameraWorldOffset(ct: number, out: THREE.Vector3): void {
    cameraCurve.getPointAt(Math.max(0, ct - HEAD_WIN), _oa)
    cameraCurve.getPointAt(Math.min(1, ct + HEAD_WIN), _ob)
    _ob.sub(_oa).setY(0).normalize()
    if (!smoothHeadingInit) { _smoothHeading.copy(_ob); smoothHeadingInit = true }
    else _smoothHeading.lerp(_ob, headingInertia).normalize()
    out.set(-_smoothHeading.x * CAM_OFFSET_DIST, CAM_OFFSET_ALT, -_smoothHeading.z * CAM_OFFSET_DIST)
  }
  function arrivalZoomK(elapsed: number): number {
    const z = (elapsed - (PHASE2_END - ZOOM_LEAD)) / (ZOOM_LEAD + END_PAUSE)
    return 1 - (1 - END_ZOOM) * Math.max(0, Math.min(1, z))
  }
  /** Facteur d'éloignement caméra : part de INTRO_PROX × camK (proche du départ, mais déjà haut sur un
   *  long tracé) et monte jusqu'à camK (hauteur de croisière) sur les INTRO_FRAC premiers % du tracé. */
  function introRiseK(t: number): number {
    if (t >= INTRO_FRAC) return camK
    const u = t / INTRO_FRAC
    return camK * (INTRO_PROX + (1 - INTRO_PROX) * (u * u * (3 - 2 * u)))
  }
  // Distance horizontale minimale caméra <-> point visé. Sans ça, le rapprochement d'arrivée
  // (arrivalZoomK -> END_ZOOM) amène la caméra à ~410 m (croisière ~700 m) : un panneau situé
  // près de la fin du tracé défile alors trop vite et trop près pour être lu. On repousse la
  // caméra le long de l'axe caméra->cible dès qu'elle passe sous ce seuil (avant avoidTerrain,
  // qui garde le dernier mot sur les crêtes).
  const MIN_CAM_TARGET_DIST = 520
  // Rapprochement de la caméra à l'approche d'un panneau (localité, col…) : en croisière la
  // caméra est à ~850 m du tracé ET vise ~2 % de courbe en avant (> 1 km sur un long tracé),
  // le panneau apparaît donc loin et illisible. On resserre l'offset jusqu'à PANEL_ZOOM sur les
  // PANEL_ZOOM_IN_M mètres qui précèdent le panneau, puis on relâche vite après.
  // 1 = pas de rapprochement : il accélérait le ruban à l'écran (×1,7) près de chaque panneau. Vitesse
  // constante voulue (2026-09-28) ; la taille minimale à l'écran (enforcePanelMinSize) garde les panneaux lisibles.
  const PANEL_ZOOM = 1
  const PANEL_ZOOM_IN_M = 2500
  const PANEL_ZOOM_OUT_M = 700
  function panelZoomK(t: number): number {
    let prox = 0
    for (const pt of panelCurveParams) {
      // Fenêtres élargies de camK : caméra haute = ruban rapide au sol, même durée d'approche.
      const dm = (t - pt) * TOTAL_DISTANCE_M / camK
      const u = dm <= 0 ? 1 + dm / PANEL_ZOOM_IN_M : 1 - dm / PANEL_ZOOM_OUT_M
      if (u > 0) prox = Math.max(prox, Math.min(1, u) * Math.min(1, u) * (3 - 2 * Math.min(1, u)))
    }
    return 1 - (1 - PANEL_ZOOM) * prox
  }
  function enforceMinStandoff(cam: THREE.Vector3, target: THREE.Vector3): void {
    const dx = cam.x - target.x, dz = cam.z - target.z
    const d = Math.hypot(dx, dz)
    if (d >= MIN_CAM_TARGET_DIST || d < 1e-3) return
    const k = MIN_CAM_TARGET_DIST / d
    cam.x = target.x + dx * k
    cam.z = target.z + dz * k
  }

  const CAM_GROUND_CLEARANCE = 55
  const RIDGE_CLEARANCE = 40
  const RIDGE_SAMPLES = 14
  function avoidTerrain(cam: THREE.Vector3, target: THREE.Vector3): void {
    const groundUnderCam = meshHeightAt(cam.x, cam.z) + CAM_GROUND_CLEARANCE
    if (cam.y < groundUnderCam) cam.y = groundUnderCam
    let lift = 0
    for (let i = 1; i < RIDGE_SAMPLES; i++) {
      const s = i / RIDGE_SAMPLES
      const sx = cam.x + (target.x - cam.x) * s
      const sz = cam.z + (target.z - cam.z) * s
      const segY = cam.y + (target.y - cam.y) * s
      const need = meshHeightAt(sx, sz) + RIDGE_CLEARANCE - segY
      if (need > 0) lift = Math.max(lift, need / (1 - s))
    }
    cam.y += lift
  }

  // ── Vue d'ensemble finale : cadrage de tout le tracé ──────────────────────────────────────
  // Plongée fixe (OVERVIEW_PITCH) ; l'azimut est cherché à ±60° autour de la visée d'arrivée
  // (pas de demi-tour de caméra) pour le plus serré des cadrages. La distance est trouvée par
  // dichotomie : tous les points du tracé doivent tenir dans la zone utile de l'image (le bas est
  // réservé au bandeau de profil et au badge kilométrage).
  const OVERVIEW_PITCH = THREE.MathUtils.degToRad(58)
  const ovCenter = new THREE.Vector3()
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ySum = 0
    for (const p of trailPts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
      ySum += p.y
    }
    ovCenter.set((x0 + x1) / 2, ySum / trailPts.length, (z0 + z1) / 2)
  }
  const ovSamples = trailPts.filter((_, i) => i % 2 === 0)
  const _ovCam = new THREE.PerspectiveCamera(55, OUT_W / OUT_H, 1, 1e7)
  const _ovV = new THREE.Vector3()
  function overviewCamPos(az: number, dist: number, out: THREE.Vector3): void {
    const h = Math.cos(OVERVIEW_PITCH) * dist
    out.set(ovCenter.x - Math.sin(az) * h, ovCenter.y + Math.sin(OVERVIEW_PITCH) * dist, ovCenter.z - Math.cos(az) * h)
  }
  function overviewFits(az: number, dist: number): boolean {
    overviewCamPos(az, dist, _ovCam.position)
    _ovCam.lookAt(ovCenter)
    _ovCam.updateMatrixWorld()
    for (const p of ovSamples) {
      _ovV.copy(p).project(_ovCam)
      if (_ovV.z > 1 || Math.abs(_ovV.x) > 0.8 || _ovV.y > 0.8 || _ovV.y < -0.62) return false
    }
    return true
  }
  /** Position caméra de la vue d'ensemble, visée = ovCenter. `lookAz` : azimut de la visée courante. */
  function computeOverviewPos(lookAz: number, out: THREE.Vector3): void {
    let best = Infinity, bestAz = lookAz
    for (let k = -4; k <= 4; k++) {
      const az = lookAz + THREE.MathUtils.degToRad(15 * k)
      let lo = 300, hi = 600_000
      if (!overviewFits(az, hi)) continue
      for (let it = 0; it < 32; it++) {
        const mid = Math.sqrt(lo * hi)
        if (overviewFits(az, mid)) hi = mid; else lo = mid
      }
      const score = hi * (1 + 0.04 * Math.abs(k)) // à cadrage égal, on préfère ne pas tourner
      if (score < best) { best = score; bestAz = az }
    }
    let lo = 300, hi = 600_000
    for (let it = 0; it < 32; it++) {
      const mid = Math.sqrt(lo * hi)
      if (overviewFits(bestAz, mid)) hi = mid; else lo = mid
    }
    overviewCamPos(bestAz, hi, out)
  }
  let overviewCaptured = false
  const _ovStartLook = new THREE.Vector3()
  const _ovDir0 = new THREE.Vector3()
  const _ovDir1 = new THREE.Vector3()
  const _ovEndPos = new THREE.Vector3()
  let ovD0 = 1, ovD1 = 1
  let overviewK = 0 // 0..1 : avancement de la montée (lu par la boucle de rendu)
  // Mer bleu soutenu dès la croisière (0x274b57 avant : gris-vert ardoise, loin du bleu profond de Relive).
  const WATER_CRUISE = new THREE.Color(0x14476a)
  const WATER_OVERVIEW = new THREE.Color(0x1f6a92)
  const baseFogDensity = scene.fog instanceof THREE.FogExp2 ? scene.fog.density : 0

  const currentCamPos = new THREE.Vector3()
  const targetCamPos = new THREE.Vector3()
  const currentLookAt = new THREE.Vector3()
  const targetLookAt = new THREE.Vector3()
  const _pos = new THREE.Vector3()
  const _lookPos = new THREE.Vector3()
  const _camOff = new THREE.Vector3()
  const _pauseAnchor = new THREE.Vector3()
  const _pauseOff = new THREE.Vector3()
  let pauseCaptured = false

  // Init caméra (port de resetToStart, sans horloge)
  cameraWorldOffset(0, _camOff)
  _camOff.multiplyScalar(INTRO_PROX * camK)
  currentCamPos.set(trailPts[0].x + _camOff.x, trailPts[0].y + _camOff.y, trailPts[0].z + _camOff.z)
  currentLookAt.set(trailPts[0].x, trailPts[0].y + LOOK_RAISE, trailPts[0].z)

  interface Overlay { distanceM: number; profileT: number }

  // Une sous-étape de simulation à 60 Hz (port du corps de animate() de main.ts).
  function simStep(elapsed: number): Overlay {
    let distanceM = 0, profileT = 0
    if (elapsed < PHASE1_END) {
      smoothHeadingInit = false
      camTcur = 0
      pauseCaptured = false
      cameraWorldOffset(0, _camOff)
      _camOff.multiplyScalar(INTRO_PROX * camK) // long tracé : départ déjà en hauteur
      targetCamPos.set(trailPts[0].x + _camOff.x, trailPts[0].y + _camOff.y, trailPts[0].z + _camOff.z)
      targetLookAt.set(trailPts[0].x, trailPts[0].y + LOOK_RAISE, trailPts[0].z)
      avoidTerrain(targetCamPos, targetLookAt)
      ribbonGeom.setDrawRange(0, 6)
      coreGeom.instanceCount = 1
      tipCap.visible = false
      for (const { sprite } of panelSprites) sprite.visible = false
      if (departurePanel) departurePanel.visible = false // écrit en haut de l'écran (drawStartHeader)
      if (arrivalPanel) arrivalPanel.visible = false
    } else if (elapsed < PHASE2_END) {
      const p = startupEase((elapsed - PHASE1_END) / DURATION)
      const t = slopeRemapT(p)
      // Position caméra calée sur le bout du ruban (camTFor), avec une vitesse d'avance PLAFONNÉE
      // (CAM_MAX_SPEED_K × sa vitesse moyenne) : à la sortie d'un estuaire, la projection du ruban
      // sur la courbe caméra, restée en attente, rattrapait d'un coup (caméra qui file).
      const camMaxStep = (CAM_MAX_SPEED_K * SIM_DT) / DURATION
      camTcur += Math.max(-camMaxStep, Math.min(camMaxStep, camTFor(t) - camTcur))
      cameraCurve.getPointAt(camTcur, _pos)
      // L'avance de visée (donc le ruban révélé) monte de 0 -> LOOK_AHEAD sur les
      // LOOK_AHEAD_RAMP_S premières secondes du survol : sans ça, LOOK_AHEAD constant révèle
      // ~2 % du ruban d'un coup dès la fin de la pause (le "saut" au démarrage).
      const laK = Math.min(1, (elapsed - PHASE1_END) / LOOK_AHEAD_RAMP_S)
      const lookT = Math.min(t + LOOK_AHEAD * laK, 1)
      // Point VISÉ sur la courbe caméra lissée (et non sur le ruban brut, qui suit chaque crique : la
      // visée, 2 % du tracé en avant, sautait d'un bord de baie à l'autre -> caméra qui pivote vite).
      // Avance de visée au moins égale à la moitié de la nominale : dans un estuaire (projection figée), la
      // visée ne doit pas tomber sous la caméra.
      const lookAheadCam = Math.max(camTFor(lookT) - camTFor(t), LOOK_AHEAD * laK * 0.5)
      cameraCurve.getPointAt(Math.min(1, camTcur + lookAheadCam), _lookPos)
      cameraWorldOffset(camTcur, _camOff)
      const zk = introRiseK(t) * Math.min(arrivalZoomK(elapsed), panelZoomK(t))
      targetCamPos.set(_pos.x + _camOff.x * zk, _pos.y + _camOff.y * zk, _pos.z + _camOff.z * zk)
      targetLookAt.set(_lookPos.x, _lookPos.y + LOOK_RAISE, _lookPos.z)
      enforceMinStandoff(targetCamPos, targetLookAt)
      avoidTerrain(targetCamPos, targetLookAt)
      // Corps du ruban : segments entiers (contrainte setDrawRange / instanceCount). On prend
      // ceil pour que le corps atteigne toujours AU MOINS la position du capuchon fractionnaire
      // (jamais de trou devant lui) ; le léger dépassement (< 1 segment) est masqué par le disque.
      const bodySegments = Math.max(1, Math.min(RIBBON_SEGMENTS, Math.ceil(lookT * RIBBON_SEGMENTS)))
      ribbonGeom.setDrawRange(0, bodySegments * 6)
      coreGeom.instanceCount = bodySegments
      updateTipCap(lookT * RIBBON_SEGMENTS, lookT)
      runnerAtEnd = lookT >= 1
      headFrac = lookT
      for (const { sprite, t: panelT } of panelSprites) if (t >= panelT - PANEL_LEAD) sprite.visible = true
      // Nom du départ écrit en haut de l'écran à l'ouverture (cf. drawStartHeader) : pas au sol pendant le survol,
      // où il chevauchait le repère voisin (« Lille » sur « Porte de Paris »). Il revient sur la vue d'ensemble.
      if (departurePanel) departurePanel.visible = false
      // Panneau d'arrivée affiché ARRIVAL_PANEL_LEAD_S avant la fin du survol (et non à l'arrêt seulement) :
      // il est déjà là quand le ruban arrive au bout.
      if (arrivalPanel) arrivalPanel.visible = elapsed >= PHASE2_END - ARRIVAL_PANEL_LEAD_S
      // Compteur et curseur du profil sur la tête du ruban (coureuse, bornes), pas sur la caméra qui la suit en
      // retard : sinon « 14,0 km » au passage de la borne 15.
      distanceM = Math.min(lookT * TRACK_M, SHOWN_M)
      profileT = lookT
    } else if (elapsed < PHASE3_END) {
      if (!pauseCaptured) {
        cameraCurve.getPointAt(1, _pauseAnchor)
        cameraWorldOffset(1, _pauseOff)
        curve.getPointAt(1, _lookPos)
        pauseCaptured = true
      }
      const zoomK = arrivalZoomK(elapsed)
      targetCamPos.set(
        _pauseAnchor.x + _pauseOff.x * zoomK * camK,
        _pauseAnchor.y + _pauseOff.y * zoomK * camK,
        _pauseAnchor.z + _pauseOff.z * zoomK * camK,
      )
      targetLookAt.set(_lookPos.x, _lookPos.y + LOOK_RAISE, _lookPos.z)
      enforceMinStandoff(targetCamPos, targetLookAt)
      avoidTerrain(targetCamPos, targetLookAt)
      ribbonGeom.setDrawRange(0, ribbonIndices.length)
      coreGeom.instanceCount = RIBBON_SEGMENTS
      updateTipCap(RIBBON_SEGMENTS, 1)
      if (departurePanel) departurePanel.visible = true
      if (arrivalPanel) arrivalPanel.visible = true
      distanceM = SHOWN_M
      profileT = 1
    } else {
      // Vue d'ensemble : on part de la dernière pose d'arrivée et on monte vers le cadrage global.
      // Distance interpolée en échelle LOG (zoom arrière régulier à l'œil, de 500 m à 50 km),
      // direction et point visé interpolés linéairement.
      if (!overviewCaptured) {
        _ovStartLook.copy(targetLookAt)
        _ovDir0.subVectors(targetCamPos, targetLookAt)
        ovD0 = Math.max(1, _ovDir0.length()); _ovDir0.normalize()
        computeOverviewPos(Math.atan2(-_ovDir0.x, -_ovDir0.z), _ovEndPos)
        _ovDir1.subVectors(_ovEndPos, ovCenter)
        ovD1 = Math.max(ovD0, _ovDir1.length()); _ovDir1.normalize()
        for (const { sprite } of panelSprites) {
          const m = sprite.material as THREE.SpriteMaterial
          m.alphaTest = 0; m.needsUpdate = true // sinon le fondu « coupe » net à 0,4
        }
        overviewCaptured = true
      }
      const u = Math.min(1, (elapsed - PHASE3_END) / OVERVIEW_RISE_S)
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
      overviewK = e
      targetLookAt.lerpVectors(_ovStartLook, ovCenter, e)
      _camOff.lerpVectors(_ovDir0, _ovDir1, e).normalize()
      targetCamPos.copy(targetLookAt).addScaledVector(_camOff, ovD0 * Math.pow(ovD1 / ovD0, e))
      avoidTerrain(targetCamPos, targetLookAt)
      ribbonGeom.setDrawRange(0, ribbonIndices.length)
      coreGeom.instanceCount = RIBBON_SEGMENTS
      updateTipCap(RIBBON_SEGMENTS, 1)
      // Localités : fondu de sortie. Cols : restent affichés sur la vue d'ensemble (comme le film 2D+),
      // avec le départ et l'arrivée.
      const panelA = 1 - Math.min(1, u / 0.35)
      for (const { sprite, isCol } of panelSprites) {
        ;(sprite.material as THREE.SpriteMaterial).opacity = isCol ? 1 : panelA
        sprite.visible = isCol || panelA > 0
      }
      if (departurePanel) departurePanel.visible = true
      if (arrivalPanel) arrivalPanel.visible = true
      distanceM = SHOWN_M
      profileT = 1
    }

    currentCamPos.lerp(targetCamPos, 0.045)
    currentLookAt.lerp(targetLookAt, 0.06)
    if (water) (water.material as THREE.ShaderMaterial).uniforms['time'].value += SIM_DT
    return { distanceM, profileT }
  }

  // ── PHASE 4 : ENCODEUR (lift de filmExport.ts) ──────────────────────────────────────────
  // ── Coureuse en tête du ruban : le personnage animé du film 2D (hiker3dSprite, sa propre petite fenêtre WebGL),
  // dessiné par-dessus l'image à l'endroit du bout du ruban, à taille fixe à l'écran (comme en 2D). En cas d'échec,
  // film sans coureuse.
  if (HIKER3D_ENABLED && opts.characters?.length) {
    try {
      const { createHiker3dSprite } = await import('../hiker3dSprite')
      runner = createHiker3dSprite(opts.characters[0], { manual: true, bibNumber: opts.bibNumber })
      signal?.addEventListener('abort', () => runner?.dispose(), { once: true })
      await Promise.race([runner.whenReady(), new Promise(r => setTimeout(r, 30_000))])
      runner.resetToStart()
    } catch (e) {
      console.warn('[film3d] coureuse indisponible, film sans coureuse :', e)
      runner?.dispose(); runner = null
    }
  }
  /** Taille de la coureuse à l'écran : celle de la marche du film 2D en 1080p. */
  const RUNNER_SCALE = (OUT_H / 720) * HIKER3D_BODY_SCALE
  const START_PRESENT_3D = startPresentAt(OUT_W, OUT_H)
  /** Présentation au départ (comme le film 2D) : en grand, pieds en bas à gauche (startPresentAt), puis elle rejoint
   * le départ du ruban à sa taille de course sur les PRESENT_MOVE_S dernières secondes de la pause sur le départ. */
  const PRESENT_MOVE_S = 1.2
  /** Avance de la coureuse devant la tête du ruban, en hauteurs de corps à l'écran, mesurée LE LONG du parcours (dans un
   * virage, elle reste sur la route au lieu de partir tout droit hors du ruban). */
  const RUNNER_LEAD_BODY = 0.3
  let runnerStage: 'wait' | 'intro' | 'run' | 'outro' = 'wait'
  let presentTurned = false // tournée vers le chemin au début du glissement vers le ruban
  let runnerLead = 0
  const _rp = new THREE.Vector3(), _rL = new THREE.Vector3(), _rR = new THREE.Vector3(), _rL2 = new THREE.Vector3(), _rR2 = new THREE.Vector3()
  /** Milieu du ruban au segment fractionnaire `seg`, à l'écran (z >= 1 : derrière la caméra). */
  function ribbonScreenAt(seg: number): { x: number; y: number; z: number } {
    const sf = Math.max(0, Math.min(RIBBON_SEGMENTS, seg))
    const s0 = Math.min(RIBBON_SEGMENTS - 1, Math.floor(sf)), fr = sf - s0
    ribbonSeg(s0, _rL, _rR); ribbonSeg(s0 + 1, _rL2, _rR2)
    _rL.lerp(_rL2, fr); _rR.lerp(_rR2, fr)
    _rp.addVectors(_rL, _rR).multiplyScalar(0.5).project(camera)
    return { x: (_rp.x + 1) / 2 * OUT_W, y: (1 - _rp.y) / 2 * OUT_H, z: _rp.z }
  }
  function drawRunner(ctx: CanvasRenderingContext2D, elapsed: number, progress: number, dt: number) {
    if (!runner) return
    // Pieds : à runnerLead px devant la tête du ruban, en suivant le parcours (pas de 0,25 segment).
    const leadTarget = runnerStage === 'run' ? RUNNER_LEAD_BODY * runner.layout().body * RUNNER_SCALE : 0
    runnerLead += (leadTarget - runnerLead) * Math.min(1, dt / 0.4) // pas de saut au départ ni à l'arrivée
    let seg = runnerSeg, p = ribbonScreenAt(seg), walked = 0
    while (walked < runnerLead && seg < RIBBON_SEGMENTS) {
      const q = ribbonScreenAt(seg + 0.25)
      walked += Math.hypot(q.x - p.x, q.y - p.y)
      seg += 0.25; p = q
    }
    // Direction de course à l'écran : corde du parcours autour de sa position.
    const back = ribbonScreenAt(seg - 1.5), ahead = ribbonScreenAt(seg + 1.5)
    const dx = ahead.x - back.x, dy = ahead.y - back.y, dl = Math.hypot(dx, dy)
    // Étapes : attente au départ, se lève avec la levée du voile, court pendant le survol, salue à l'arrivée.
    if (runnerStage === 'wait' && elapsed >= TITLE_IN_S) { runner.startIntro(); runnerStage = 'intro' }
    if (runnerStage === 'intro' && elapsed >= PHASE1_END) { runner.turnTo(dx, dy); runner.setPlaying(true); runnerStage = 'run' }
    // Victoire dès que la tête du ruban est au bout (sinon elle courait sur place jusqu'à la fin du survol).
    if (runnerStage === 'run' && (runnerAtEnd || elapsed >= PHASE2_END)) { runner.turnTo(0, 1); runner.startOutro(); runnerStage = 'outro' }
    // Cadence naturelle du clip, constante : calée sur la vitesse à l'écran, elle variait avec la caméra (allures
    // changeantes). Enchaînement des allures selon la distance parcourue, comme le film 2D.
    if (runnerStage === 'run') {
      if (dl > 0.5) runner.setDirection(dx, dy)
      runner.setProgress(progress)
    }
    runner.renderFrame(dt)
    // Vue d'ensemble : s'efface pendant la première moitié de la montée de la caméra.
    const alpha = Math.max(0, Math.min(1, 1 - (elapsed - PHASE3_END) / (OVERVIEW_RISE_S * 0.5)))
    const { w, h, feet, body } = runner.layout()
    // Présentation : k = 1 en grand en bas à gauche, 0 sur le ruban à taille de course.
    const k = 1 - smoothEase(Math.max(0, Math.min(1, (elapsed - (PHASE1_END - PRESENT_MOVE_S)) / PRESENT_MOVE_S)))
    if (k > 0 && !presentTurned && elapsed >= PHASE1_END - PRESENT_MOVE_S) { runner.turnTo(dx, dy); presentTurned = true }
    const onRoute = p.z < 1
    if (alpha <= 0 || (!onRoute && k < 1)) return
    const presentScale = (OUT_H * START_PRESENT_3D.body) / Math.max(1, body)
    const scale = RUNNER_SCALE + (presentScale - RUNNER_SCALE) * k
    const fx = onRoute ? p.x + (START_PRESENT_3D.feetX * OUT_W - p.x) * k : START_PRESENT_3D.feetX * OUT_W
    const fy = onRoute ? p.y + (START_PRESENT_3D.feetY * OUT_H - p.y) * k : START_PRESENT_3D.feetY * OUT_H
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.drawImage(runner.element, fx - (w * scale) / 2, fy - (h - feet) * scale, w * scale, h * scale)
    ctx.restore()
  }

  const streetCaption = new StreetCaption((opts.streets ?? []).map(s => ({ ...s, minS: isPlaceName(s.name) ? PLACE_HOLD_S : undefined })))
  const borneSignCache: LocSignCache = new Map()
  const trackM = TRACK_M

  const composite = document.createElement('canvas')
  composite.width = OUT_W; composite.height = OUT_H
  const ctx2d = composite.getContext('2d')!
  const drawProfile = buildProfileCardCanvas(trailPts, SHOWN_M, minElev - 3.5)
  const startTimeText = startClock(opts.startTime, opts.startTimePlanned ?? true, opts.trackStart)

  const hasWC = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  let useWC = false
  let muxer: InstanceType<typeof Muxer<ArrayBufferTarget>> | null = null
  let encoder: VideoEncoder | null = null
  // Erreur remontée par l'encodeur (il passe alors à l'état 'closed') : arrête le rendu au lieu
  // de continuer à encoder dans le vide.
  let encoderError: unknown = null
  // QUALITÉ CONSTANTE (bitrateMode 'quantizer', QP fixe par image) quand l'encodeur le permet :
  // même netteté partout, peu de bits sur les plans quasi fixes (écran-titre, pause d'arrivée,
  // fin de la vue d'ensemble), beaucoup sur le défilement des photos aériennes. Un débit moyen
  // imposé (VBR 8 Mb/s) laissait des blocs de compression dès que la caméra survolait un paysage
  // détaillé (l'encodeur matériel du navigateur est moins efficace que x264 à débit égal).
  // Repli : VBR à FALLBACK_BITRATE. Avant tout ça : 26 Mb/s CBR, 200-350 Mo par film.
  // Profil/niveau : Main@4.1 (avc1.4d0029). ATTENTION : le niveau 4.0 (…0028) plafonne à
  // 20 Mb/s ; les pointes doivent rester sous le plafond du niveau, sinon les lecteurs stricts
  // (Lecteur multimédia Windows, décodeurs matériels) saccadent / bufferisent en boucle, alors
  // que VLC (qui ignore le niveau) passe. Le 4.1 autorise 50 Mb/s.
  // Profil Main (pas High) : sur certaines machines le High retombe en encodage logiciel.
  // Mesuré (boucle de 8 km, 42 s) : QP 25 -> 45 Mo, sans blocs ; VBR 8 Mb/s -> 42 Mo, blocs.
  const VIDEO_QP = 25 // 0 (sans perte) … 51 ; ~23-26 = très propre en 1080p
  const FALLBACK_BITRATE = 14_000_000
  const bitrate = Math.min(FALLBACK_BITRATE, opts.videoMaxMbps && opts.videoMaxMbps > 0 ? opts.videoMaxMbps * 1e6 : Infinity)
  let useQP = false
  // Plafond de débit par-dessus la qualité constante (≈ x264 « CRF + maxrate ») : si le débit des
  // QP_WINDOW_S dernières secondes dépasse QP_CAP_BPS (passages très chargés : montée vers la vue
  // d'ensemble, survol rapide de villes), la qualité baisse d'un cran ; elle remonte vers
  // VIDEO_QP, jamais au-delà, dès que le débit redescend. Pas plus d'un cran toutes les
  // QP_STEP_EVERY images : pas de saut de qualité visible.
  const QP_CAP_BPS = opts.videoMaxMbps && opts.videoMaxMbps > 0 ? opts.videoMaxMbps * 1e6 : 16_000_000
  const QP_MAX = 42 // assez haut pour tenir un plafond bas (test à 5 Mb/s) ; à 16 Mb/s on reste bien en dessous
  const QP_WINDOW_S = 2
  const QP_STEP_EVERY = 6
  let curQP = VIDEO_QP
  let qpMaxUsed = VIDEO_QP
  let lastQpStep = 0
  const chunkBytes: number[] = []
  const onChunk = (c: EncodedVideoChunk) => {
    chunkBytes.push(c.byteLength)
    if (chunkBytes.length > QP_WINDOW_S * fps) chunkBytes.shift()
  }
  function nextQP(f: number): number {
    if (f - lastQpStep < QP_STEP_EVERY || chunkBytes.length < fps / 2) return curQP
    let sum = 0
    for (const b of chunkBytes) sum += b
    const bps = (sum * 8 * fps) / chunkBytes.length
    if (bps > QP_CAP_BPS && curQP < QP_MAX) { curQP++; lastQpStep = f; qpMaxUsed = Math.max(qpMaxUsed, curQP) }
    else if (bps < QP_CAP_BPS * 0.75 && curQP > VIDEO_QP) { curQP--; lastQpStep = f }
    return curQP
  }

  // ── Bande-son (chemin WebCodecs uniquement) : mixée sur toute la durée du cycle ──
  let audioBuffer: AudioBuffer | null = null
  if (hasWC && hasFilmAudio(opts.audio) && filmAudioSupported()) {
    try {
      audioBuffer = await buildFilmAudioTrack(opts.audio, FILM_S, signal)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      console.warn('[film3d] bande-son ignorée :', e)
    }
  }

  if (hasWC) {
    for (const codec of ['avc1.4d0029', 'avc1.4d0028', 'avc1.42001e']) {
      try {
        const base = { codec, width: OUT_W, height: OUT_H, framerate: fps, latencyMode: 'quality' as const }
        const qpCfg: VideoEncoderConfig = { ...base, bitrateMode: 'quantizer' }
        const vbrCfg: VideoEncoderConfig = { ...base, bitrate, bitrateMode: 'variable' }
        const qpOk = await VideoEncoder.isConfigSupported(qpCfg).then(s => !!s.supported, () => false)
        if (qpOk || (await VideoEncoder.isConfigSupported(vbrCfg)).supported) {
          muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: OUT_W, height: OUT_H, frameRate: fps }, ...(audioBuffer ? { audio: MUXER_AUDIO_CONFIG } : {}), fastStart: 'in-memory' })
          encoder = new VideoEncoder({ output: (c, m) => { onChunk(c); muxer!.addVideoChunk(c, m) }, error: e => { console.error('[film3d] encoder:', e); encoderError = e } })
          encoder.configure(qpOk ? qpCfg : vbrCfg)
          useQP = qpOk
          noteEncoderSetup(`film 3D, ${codec} ${qpOk ? 'QP' : 'VBR'} ${OUT_W}×${OUT_H}`)
          useWC = true; break
        }
      } catch { /* codec suivant */ }
    }
  }

  const mrChunks: Blob[] = []
  let mr: MediaRecorder | null = null
  let mrTrack: (MediaStreamTrack & { requestFrame?(): void }) | null = null
  let mrMime = 'video/webm'
  if (!useWC) {
    const supported = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .filter(m => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } })
    mrMime = supported[0] ?? 'video/webm'
    const s = composite.captureStream(0)
    mrTrack = s.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?(): void }
    try { mr = new MediaRecorder(s, { mimeType: mrMime, videoBitsPerSecond: bitrate }) } catch { mr = new MediaRecorder(s) }
    mr.ondataavailable = e => { if (e.data.size > 0) mrChunks.push(e.data) }
    mr.start(200)
  }

  // Bake unique de la shadow map : soleil et terrain sont fixes, inutile de re-rendre une carte
  // de profondeur 4096² à chaque image. Le ruban qui se révèle et le capuchon ne
  // projettent qu'une ombre négligeable. Gain net sur la durée d'export.
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  // ── BOUCLE DE RENDU : pas de temps fixe, une image tous les (SIM_HZ/fps) ticks 60 Hz ────
  const ticksPerFrame = Math.max(1, Math.round(SIM_HZ / fps))
  const totalFrames = Math.ceil(FILM_S * fps)
  etaTotalFrames = totalFrames; etaStage = 'render'; renderStart = performance.now()
  const msPerFrame = 1000 / fps
  // GOP ~1,6 s (48 images) : moins d'images-clés = moins de pics de débit/décodage sur les
  // lecteurs légers qu'avec 15. Image-clé forcée en plus juste au démarrage du ruban (le moment
  // le plus dur : fin de la partie quasi-fixe -> survol) pour que le décodeur reparte d'une
  // image complète à cet instant précis.
  const GOP = 48
  const motionStartFrame = Math.round((PHASE1_END - RENDER_FROM) * fps)
  let simElapsed = 0
  let lastOverlay: Overlay = { distanceM: 0, profileT: 0 }
  while (simElapsed < RENDER_FROM) { simElapsed += SIM_DT; lastOverlay = simStep(simElapsed) }
  // Journal (diag.ts, copy(__sillonDiag()) dans la console) : début du rendu, puis un point toutes les
  // 10 s — de quoi voir à distance si et où le rendu s'arrête (image atteinte, file de l'encodeur, onglet).
  diag('film 3D : début du rendu', {
    encodeur: useWC ? (useQP ? 'WebCodecs QP' : 'WebCodecs VBR') : `MediaRecorder ${mrMime}`, images: totalFrames,
  })
  let lastDiagAt = performance.now()

  try {
  for (let f = 0; f <= totalFrames; f++) {
    if (performance.now() - lastDiagAt > 10_000) {
      lastDiagAt = performance.now()
      diag('film 3D : rendu', { image: f, file: encoder?.encodeQueueSize, état: encoder?.state, onglet: document.hidden ? 'caché' : 'visible' })
    }
    if (signal?.aborted) {
      cleanup()
      if (mr && mr.state !== 'inactive') mr.stop()
      throw aborted()
    }

    for (let k = 0; k < ticksPerFrame; k++) {
      simElapsed = Math.min(simElapsed + SIM_DT, TOTAL_CYCLE)
      lastOverlay = simStep(simElapsed)
    }

    // Vue d'ensemble : caméra jusqu'à ~100 km. Plans near/far et brume suivent la distance (sinon
    // tout est coupé à 50 km ou noyé dans le brouillard) ; le fil central du ruban s'épaissit et
    // passe devant le relief (à cette distance la précision du z-buffer ne le sépare plus du sol).
    const camDist = currentCamPos.distanceTo(currentLookAt)
    // near ∝ distance (rien n'est jamais à moins de 1/300 de la distance de visée) : garde la
    // précision du z-buffer à 100 km, sinon terrain de fond et détaillé scintillent au raccord.
    const far = Math.max(50000, camDist * 4)
    const near = Math.max(1, camDist / 300)
    if (camera.far !== far || camera.near !== near) {
      camera.far = far; camera.near = near; camera.updateProjectionMatrix()
    }
    if (scene.fog instanceof THREE.FogExp2) scene.fog.density = Math.min(baseFogDensity, 0.25 / camDist)
    // Mer vue de haut : la teinte de croisière (sombre, faite pour la vue rasante qui reflète le
    // ciel) paraissait gris ardoise ; on la ravive vers un bleu mer pendant la montée.
    if (water) {
      const u = (water.material as THREE.ShaderMaterial).uniforms
      ;(u['waterColor'].value as THREE.Color).copy(WATER_CRUISE).lerp(WATER_OVERVIEW, overviewK)
    }
    // Caméra haute (long tracé, camK > 1) : trait un peu plus épais pour rester lisible.
    const baseLineW = 3.2 + Math.min(1.3, (camK - 1) * 0.5)
    coreMat.linewidth = baseLineW + (5 - baseLineW) * overviewK
    coreMat.depthTest = camDist < 6000
    camera.position.copy(currentCamPos)
    camera.lookAt(currentLookAt)
    enforcePanelMinSize(currentCamPos)
    renderer.render(scene, camera)

    // Composition : image GL + overlays 2D
    ctx2d.clearRect(0, 0, OUT_W, OUT_H)
    ctx2d.drawImage(glCanvas, 0, 0, OUT_W, OUT_H)
    // Bornes et ravitaillements (comme le film 2D) : au passage de la tête du ruban pendant la course, tous à
    // l'arrivée ; effacés au début de la montée vers la vue d'ensemble, puis de retour, agrandis et sans
    // chevauchement, après OVERVIEW_CLEAN_S de vue d'ensemble sans infos.
    if (opts.bornes?.length || opts.ravitos?.length) {
      const place = (it: Borne | Ravito) => {
        const p = ribbonScreenAt((it.km * 1000 / trackM) * RIBBON_SEGMENTS)
        return p.z < 1 ? p : null
      }
      const ovU = (simElapsed - PHASE3_END) / OVERVIEW_RISE_S
      const draw = (scale: number, alpha: number, coveredM: number, overview = false) =>
        drawBorneLayer(ctx2d, borneSignCache, opts.bornes ?? [], opts.ravitos ?? [], place, scale, alpha, coveredM, overview)
      if (simElapsed < PHASE2_END) draw(1, 1, simElapsed < PHASE1_END ? -Infinity : headFrac * trackM)
      else if (ovU <= 0) draw(1, 1, Infinity)
      else if (ovU < 1) draw(1, Math.max(0, 1 - ovU / 0.35), Infinity)
      else draw(OVERVIEW_BORNE_SCALE, Math.max(0, Math.min(1, (simElapsed - PHASE3_END - OVERVIEW_RISE_S - OVERVIEW_CLEAN_S) / 0.5)), Infinity, true)
    }
    drawRunner(ctx2d, simElapsed, lastOverlay.profileT, 1 / fps)
    // Rue empruntée, en haut de l'écran : après l'effacement du nom de départ, jusqu'à la fin du survol.
    streetCaption.update(simElapsed >= PHASE1_END + 2.2 && simElapsed < PHASE2_END ? headFrac : null, 1 / fps)
    streetCaption.draw(ctx2d, OUT_W / 2)
    const intoWatermark = simElapsed - (TOTAL_CYCLE - WATERMARK_LEAD)
    drawOverlays(ctx2d, {
      date: opts.trailDate,
      route: `${opts.departureName} → ${opts.arrivalName}`,
      distanceM: lastOverlay.distanceM,
      profileT: lastOverlay.profileT,
      weather: opts.weatherCard ?? null,
      // adresse de fin (bas droite) : fondu sur 0,5 s, comme le film 2D
      // Carton final saisi : il porte déjà l'adresse, on n'ajoute pas l'adresse seule.
      watermarkReveal: opts.endCard ? 0 : Math.max(0, Math.min(1, intoWatermark / 0.5)),
      kmAlpha: 1 - Math.max(0, Math.min(1, intoWatermark / 0.5)),
    }, drawProfile)
    // Nom du départ et heure de départ, en haut de l'écran sous le titre. L'heure s'efface sur START_CLOCK_FADE_S à
    // la fin de la pause sur le départ ; le nom reste jusqu'à la première seconde du survol, puis s'efface sur 0,6 s.
    const startA = Math.max(0, Math.min(1, (PHASE1_END + 1.6 - simElapsed) / 0.6))
    const clockA = Math.max(0, Math.min(1, (PHASE1_END - simElapsed) / START_CLOCK_FADE_S))
    if (startA > 0) drawStartHeader(ctx2d, departurePanel ? opts.departureName : null, opts.departureLieudit, startTimeText, startA, clockA)
    // Carton final (comme le film 2D) : sur la vue d'ensemble, après OVERVIEW_CLEAN_S sans infos, en fondu sur 0,5 s.
    if (opts.endCard && intoWatermark > 0) drawEndCard(ctx2d, OUT_W, OUT_H, opts.endCard, Math.min(1, intoWatermark / 0.5))

    // Ouverture. (1) Voile noir : plein pendant TITLE_IN_S (le titre s'y inscrit), puis se lève
    // sur SCENE_REVEAL_S -> le paysage se découvre DERRIÈRE le titre. Dessiné AVANT l'écran-titre.
    const revealT = simElapsed - TITLE_IN_S
    const blackA = revealT <= 0 ? 1
      : revealT >= SCENE_REVEAL_S ? 0
      : 1 - revealT / SCENE_REVEAL_S
    if (blackA > 0) {
      const b = blackA * blackA * (3 - 2 * blackA)
      ctx2d.fillStyle = `rgba(0,0,0,${b})`
      ctx2d.fillRect(0, 0, OUT_W, OUT_H)
    }

    // (2) Écran-titre : fondu d'ouverture sur TITLE_IN_S (sur le noir), puis fondu de FERMETURE
    // calé sur la levée du noir (blackA) -> le titre disparaît pendant que le paysage se
    // découvre, jamais visible par-dessus le paysage.
    const introIn = Math.min(1, simElapsed / TITLE_IN_S)
    const introA = Math.min(introIn, blackA)
    if (introA > 0) {
      const s = Math.max(0, Math.min(1, introA))
      drawIntroCard(ctx2d, {
        title: opts.title?.trim() || `${opts.departureName} → ${opts.arrivalName}`,
        date: opts.trailDate,
        km: `${(SHOWN_M / 1000).toFixed(1).replace('.', ',')} km`,
        gain: `D+ ${Math.round(elevGainM / 10) * 10} m`,
        alpha: s * s * (3 - 2 * s),
      })
      // Signature : logo + « sillonphane.fr/running » se déroulent sur l'écran-titre noir, EXACTEMENT
      // à la même place qu'à la fin du film (au-dessus du badge kilométrage), puis s'effacent
      // avec la levée du voile.
      drawEndWatermark(
        ctx2d, OUT_W, OUT_H,
        s * s * (3 - 2 * s),
        Math.min(1, simElapsed / 2.2),
        OUT_H - Math.round(OUT_H * 0.12) - 50 - Math.round(OUT_H * 0.02),
      )
    }

    if (useWC && encoder) {
      try {
        const vf = new VideoFrame(composite, { timestamp: Math.round(f * 1_000_000 / fps) })
        encoder.encode(vf, {
          keyFrame: f % GOP === 0 || f === motionStartFrame,
          ...(useQP ? { avc: { quantizer: nextQP(f) } } : {}),
        }); vf.close()
      } catch (e) { console.error('[film3d] VideoFrame:', e) }
      // On ATTEND l'encodeur s'il prend du retard, au lieu de laisser la file gonfler et de tout
      // payer sur encoder.flush() en fin de rendu (c'était ça, la « finalisation longue » — et
      // des centaines de VideoFrame 1080p en file = ~8 Mo pièce, grosse pression mémoire).
      // Garde-fou encodeur bloqué / en erreur, attentes non ralenties en arrière-plan : encoderWait.ts.
      noteEncoderFrame(f, totalFrames)
      if (!await waitEncoderQueue(encoder, 6, () => encoderError != null, signal)) {
        diag('film 3D : encodeur en échec', encoderFailMessage())
        throw new Error(encoderFailMessage())
      }
      if (f % 15 === 0) await yieldTask()
    } else if (mrTrack) {
      mrTrack.requestFrame?.()
      await new Promise(r => setTimeout(r, msPerFrame))
    }

    etaFrame = f
    report('render', totalFrames > 0 ? f / totalFrames : 1, 'Rendu de la vidéo…')
  }
  } catch (e) {
    cleanup()
    if (mr && mr.state !== 'inactive') try { mr.stop() } catch { /* */ }
    throw e
  }

  cleanup()

  // Vitesses mesurées -> estimation de départ du prochain export (voir loadEtaRates).
  // Téléchargement trop court (< 20 tuiles, ou tuiles en cache < 1 s) : non représentatif.
  saveEtaRates(etaRates, {
    msPerTile: tilesDone >= 20 && dlEnd - dlStart > 1000 ? (dlEnd - dlStart) / tilesDone : undefined,
    prepFixedMs: renderStart - dlEnd,
    msPerFrame: totalFrames > 0 ? (performance.now() - renderStart) / totalFrames : undefined,
  })

  if (useWC && encoder && muxer) {
    report('render', 1, 'Finalisation de la vidéo…')
    await encoder.flush(); encoder.close()
    if (audioBuffer) {
      try { await encodeFilmAudio(audioBuffer, muxer, signal) }
      catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        console.warn('[film3d] encodage bande-son échoué (film livré muet) :', e)
      }
    }
    if (useQP) console.info(`[film3d] qualité constante QP ${VIDEO_QP}, QP max atteint ${qpMaxUsed} (plafond ${QP_CAP_BPS / 1e6} Mb/s)`)
    muxer.finalize()
    return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' })
  }
  if (mr) {
    return new Promise(resolve => {
      mr!.onstop = () => resolve(new Blob(mrChunks, { type: mrMime.includes('mp4') ? 'video/mp4' : 'video/webm' }))
      mr!.stop()
    })
  }
  return new Blob()
}

// ─── Watermark de fin — repris à l'identique du film 2D (src/lib/filmExport.ts) ──────────────
// Copié plutôt qu'importé : filmExport.ts tire maplibre-gl en tête de module.

const SILLAGE_LOGO_D = 'M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60'
let sillonLogoCache: { path: Path2D; length: number } | null = null

function getSillonLogoPath(): { path: Path2D; length: number } {
  if (!sillonLogoCache) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    el.setAttribute('d', SILLAGE_LOGO_D)
    sillonLogoCache = { path: new Path2D(SILLAGE_LOGO_D), length: el.getTotalLength() }
  }
  return sillonLogoCache
}

function drawEndWatermark(
  ctx: CanvasRenderingContext2D,
  cw: number, ch: number,
  opacity: number,
  revealT: number,
  bottomY: number = ch - Math.round(ch * 0.20),
) {
  if (opacity <= 0) return

  const logoSize = Math.round(ch * 0.135)
  const textSize = Math.round(ch * 0.030)
  const gap      = Math.round(ch * 0.016)
  const cx       = cw / 2

  // Bloc : logo (filigrane) au-dessus, « sillonphane.fr/running » en dessous ; bord bas du texte = bottomY.
  const textBaseY   = bottomY
  const logoBottomY = textBaseY - textSize - gap
  const logoTopY    = logoBottomY - logoSize

  // ── Logo Sillon en filigrane : le tracé se déroule (comme l'en-tête de l'appli) ──
  const { path, length } = getSillonLogoPath()
  const scale = logoSize / 320
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(cx - logoSize / 2, logoTopY)
  ctx.scale(scale, scale)
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 16
  const drawProgress = Math.min(1, revealT / 0.55)
  const strokeGrad = ctx.createLinearGradient(0, 320, 0, 0)
  strokeGrad.addColorStop(0,    '#2F5C45')
  strokeGrad.addColorStop(0.32, '#357049') // reste vert plus longtemps sur le début du tracé
  strokeGrad.addColorStop(0.62, '#D97A3D')
  strokeGrad.addColorStop(0.86, '#F4EDE0') // crème atteint plus tôt -> fin du tracé plus crème
  strokeGrad.addColorStop(1,    '#F4EDE0')
  ctx.strokeStyle = strokeGrad
  ctx.lineWidth = 30
  ctx.lineCap = 'round'
  ctx.setLineDash([length])
  ctx.lineDashOffset = length * (1 - drawProgress)
  ctx.stroke(path)
  ctx.setLineDash([])

  const dotsT = Math.min(1, Math.max(0, (revealT - 0.45) / 0.12))
  if (dotsT > 0) {
    ctx.globalAlpha = dotsT * opacity
    ctx.fillStyle = '#F4EDE0'
    ctx.beginPath(); ctx.arc(138, 225, 10, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#2F5C45'
    ctx.beginPath(); ctx.arc(220, 60, 10, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#F4EDE0'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(220, 60, 10, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()

  // ── « sillonphane.fr/running » : révélé par balayage gauche → droite (fenêtre de clip qui s'ouvre) ──
  const textReveal = Math.max(0, Math.min(1, (revealT - 0.5) / 0.45))
  if (textReveal > 0) {
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.font = `bold ${textSize}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#fff'
    const tw = ctx.measureText(SITE_ADDRESS).width
    ctx.beginPath()
    ctx.rect(cx - tw / 2 - 2, textBaseY - textSize * 1.1, tw * textReveal + 4, textSize * 1.6)
    ctx.clip()
    ctx.fillText(SITE_ADDRESS, cx, textBaseY)
    ctx.restore()
  }
}

// Adresse « sillonphane.fr/running » en bas à droite, affichée à la FIN du film (fondu simple, sans
// logo) — copie conforme de drawEndAddress (src/lib/filmExport.ts), utilisée par les films 2D et 2D+.
function drawEndAddress(ctx: CanvasRenderingContext2D, cw: number, ch: number, opacity: number) {
  if (opacity <= 0) return

  const marginBottom = Math.round(ch * 0.09)
  const barBottom = ch - marginBottom
  const barH = Math.round(ch * 0.09)

  // Dégradé sombre fondu dans le bord bas -> lisibilité du texte sur fond clair.
  ctx.save()
  ctx.globalAlpha = opacity
  const barTop = ch - Math.round(ch * 0.24)
  const grad = ctx.createLinearGradient(0, barTop, 0, ch)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = grad
  ctx.fillRect(0, barTop, cw, ch - barTop)
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = `bold ${Math.round(ch * 0.032)}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 6
  ctx.fillText(SITE_ADDRESS, cw - cw * 0.03, barBottom - barH * 0.35)
  ctx.restore()
}

// Cartel météo (port de drawWeatherCard de src/lib/filmExport.ts) — placé en bas à gauche,
// bord bas aligné sur le badge kilométrage.
function drawWeatherCard(ctx: CanvasRenderingContext2D, weather: WeatherCardData | null, progress: number) {
  if (!weather) return

  const hasDep = weather.departure != null
  const hasArr = weather.arrival != null
  let icon: string, tempStr: string, desc: string

  if (hasDep && hasArr) {
    const dep = weather.departure!, arr = weather.arrival!
    const temp = Math.round(dep.temp + progress * (arr.temp - dep.temp))
    const side = progress < 0.5 ? dep : arr
    icon = side.icon ?? '🌡️'; tempStr = `${temp}°C`; desc = side.description ?? ''
  } else if (hasDep) {
    icon = weather.departure!.icon ?? '🌡️'; tempStr = `${weather.departure!.temp}°C`; desc = weather.departure!.description ?? ''
  } else if (hasArr) {
    icon = weather.arrival!.icon ?? '🌡️'; tempStr = `${weather.arrival!.temp}°C`; desc = weather.arrival!.description ?? ''
  } else {
    icon = '🌡️'; tempStr = `${weather.tempMin}–${weather.tempMax}°C`; desc = ''
  }

  const PAD = 21, ICON_W = 72, cardH = 102
  const cardY = 16 // haut droite

  ctx.save()
  ctx.font = 'bold 38px "Segoe UI", system-ui, sans-serif'
  const tempW = ctx.measureText(tempStr).width
  ctx.font = '22px "Segoe UI", system-ui, sans-serif'
  const descW = desc ? ctx.measureText(desc).width : 0
  const cardW = PAD + ICON_W + Math.max(tempW, descW) + PAD
  const cardX = OUT_W - cardW - 16

  ctx.fillStyle = 'rgba(10,26,14,0.82)'
  ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 12); ctx.fill()

  ctx.font = '51px serif'; ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  ctx.fillText(icon, cardX + PAD, cardY + cardH / 2)

  const colX = cardX + PAD + ICON_W, midY = cardY + cardH / 2
  ctx.font = 'bold 38px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#e8f5e9'
  ctx.textBaseline = desc ? 'alphabetic' : 'middle'
  ctx.fillText(tempStr, colX, desc ? midY - 1 : midY)

  if (desc) {
    ctx.font = '22px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#a5c8a8'
    ctx.textBaseline = 'top'; ctx.fillText(desc, colX, midY + 6)
  }

  ctx.restore()
}

// ─── Overlays 2D (port canvas des cartels HTML de index.html) ────────────────────────────────

/** Ouverture : nom du lieu de départ (lettres blanches cernées, comme les noms au sol ; italique pour un lieu-dit)
 * et horloge de départ en dessous, centrés dans la bande haute de l'écran, sous le titre. */
function drawStartHeader(
  ctx: CanvasRenderingContext2D, name: string | null, lieudit: boolean | undefined,
  start: { label: string; clock: string } | null, alpha: number, clockAlpha = alpha,
) {
  if (!name && !start) return
  const cx = OUT_W / 2
  let top = 150
  if (name) {
    const size = 54
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `${lieudit ? 'italic ' : ''}700 ${size}px Arial, Helvetica, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = size * 0.2
    ctx.strokeText(name, cx, top)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#fff'
    ctx.fillText(name, cx, top)
    ctx.restore()
    top += size * 0.75
  }
  if (start) drawStartTimePill(ctx, start, cx, top, 40, Math.min(alpha, clockAlpha))
}

// Écran-titre d'ouverture : voile sombre + date + titre (2 lignes max) + pastilles km / D+.
function drawIntroCard(
  ctx: CanvasRenderingContext2D,
  o: { title: string; date: string; km: string; gain: string; alpha: number },
): void {
  ctx.save()
  ctx.globalAlpha = o.alpha
  // Voile léger seulement : le voile noir plein est géré à part (ouverture). Ici on garde juste
  // ce qu'il faut pour que le titre reste lisible quand le paysage est découvert derrière.
  ctx.fillStyle = 'rgba(6,10,14,0.42)'
  ctx.fillRect(0, 0, OUT_W, OUT_H)

  const cx = OUT_W / 2
  let y = OUT_H / 2 - 72
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '600 20px system-ui, sans-serif'
  ctx.fillText(o.date.toUpperCase(), cx, y)
  y += 48

  ctx.fillStyle = '#fff'
  ctx.font = '800 46px system-ui, sans-serif'
  const maxW = OUT_W * 0.78
  const lines: string[] = []
  let cur = ''
  for (const w of o.title.split(/\s+/)) {
    const test = cur ? `${cur} ${w}` : w
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w } else cur = test
  }
  if (cur) lines.push(cur)
  const shown = lines.slice(0, 2)
  if (lines.length > 2) shown[1] = `${shown[1].replace(/\s*\S*$/, '')}…`
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12
  for (const ln of shown) { ctx.fillText(ln, cx, y); y += 56 }
  ctx.shadowColor = 'transparent'
  y += 10

  ctx.font = '800 22px system-ui, sans-serif'
  const gap = 16, pad = 20, h = 44
  const w1 = ctx.measureText(o.km).width + pad * 2
  const w2 = ctx.measureText(o.gain).width + pad * 2
  let px = cx - (w1 + gap + w2) / 2
  const drawPill = (txt: string, w: number, bg: string) => {
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.roundRect(px, y, w, h, 999); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(txt, px + w / 2, y + h / 2 + 1)
    ctx.textBaseline = 'alphabetic'
    px += w + gap
  }
  drawPill(o.km, w1, '#e31c1c')
  drawPill(o.gain, w2, 'rgba(255,255,255,0.18)')
  ctx.restore()
}

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  o: { date: string; route: string; distanceM: number; profileT: number; weather: WeatherCardData | null; watermarkReveal: number; kmAlpha: number },
  drawProfile: (ctx: CanvasRenderingContext2D, t: number) => void,
): void {
  // Titre (route) centré en haut, date juste EN DESSOUS (même casse : MAJUSCULES).
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  ctx.shadowColor = 'rgba(0,0,0,0.65)'
  ctx.shadowBlur = 8; ctx.shadowOffsetY = 2
  ctx.font = "800 22px system-ui, sans-serif"
  ctx.fillStyle = '#fff'
  ctx.fillText(o.route, OUT_W / 2, 33)
  ctx.font = "600 15px system-ui, sans-serif"
  ctx.fillStyle = '#dfe6ec'
  ctx.fillText(o.date.toUpperCase(), OUT_W / 2, 55)
  ctx.restore()

  // Adresse « sillonphane.fr/running » en bas à droite sur la fin du film (comme les films 2D et 2D+).
  drawEndAddress(ctx, OUT_W, OUT_H, o.watermarkReveal)

  // Crédits sources (bas GAUCHE, discret) — orthophotos IGN + repli Esri World Imagery,
  // relief RGE ALTI IGN + repli AWS Terrain Tiles.
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = "500 12px system-ui, sans-serif"
  ctx.fillStyle = 'rgba(255,255,255,0.66)'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 4
  ctx.fillText('© IGN · Esri, Maxar · AWS Terrain Tiles', 16, OUT_H - 12)
  ctx.restore()

  // Badge distance (bas centre) — remonté pour ne pas passer sous la barre de lecture du lecteur. Effacé quand les
  // infos de fin (bornes, carton final) apparaissent.
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, o.kmAlpha))
  const km = `${(o.distanceM / 1000).toFixed(1).replace('.', ',')} km`
  ctx.font = "800 26px system-ui, sans-serif"
  const kmW = ctx.measureText(km).width
  const padX = 24, badgeH = 50
  const badgeW = kmW + padX * 2
  const bx = (OUT_W - badgeW) / 2, by = OUT_H - Math.round(OUT_H * 0.12) - badgeH
  ctx.fillStyle = '#e31c1c'
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3
  ctx.beginPath(); ctx.roundRect(bx, by, badgeW, badgeH, 999); ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(km, OUT_W / 2, by + badgeH / 2 + 1)
  ctx.restore()

  // Cartel météo (bas gauche, même niveau que le badge kilométrage)
  drawWeatherCard(ctx, o.weather, o.profileT)

  // Profil altimétrique (bas droite, même niveau que le badge kilométrage)
  drawProfile(ctx, o.profileT)
}
