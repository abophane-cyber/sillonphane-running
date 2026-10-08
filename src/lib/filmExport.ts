/**
 * Export vidéo — rendu WebGL MapLibre hors-écran + overlays 2D Canvas.
 * Synchronisé à 100% sur le comportement de la Preview (TrackMap + useAnimation).
 */

import maplibregl from 'maplibre-gl'
import type { GpxPoint } from '../types'
import { makeStyle } from './mapStyle'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { drawElevOverlay, elevOverlayRect } from './drawElevOverlay'
import type { CharacterId } from './characters'
import { buildRouteTileUrls, buildBoundingBoxTileUrls, prefetchTiles } from './tilePrefetch'
import { buildFilmAudioTrack, encodeFilmAudio, filmAudioSupported, hasFilmAudio, MUXER_AUDIO_CONFIG, type FilmAudioSpec } from './filmAudio'
import { smoothTrackPoints } from './gpx'
import { BASEMAP_BACKGROUND } from './tileSources'
import { RIBBON_HEAD_COLOR, RIBBON_HEAD_FADE, RIBBON_LAG_PX, RIBBON_OUTLINE, RIBBON_OUTLINE_FULL, ribbonAgeColor, ribbonColorAt, ribbonHeadM } from './ribbon'
import { createQpRateControl } from './qpRateControl'
import { encoderFailMessage, noteEncoderFrame, noteEncoderSetup, waitEncoderQueue } from './encoderWait'
import { buildMapMosaic, projectToScreen, mosaicCropOrigin } from './filmMapMosaic'
import type { Hiker3dSprite } from './hiker3dSprite'
import { drawStartTimePill } from './startTimePill'
import { borneNumber, borneReached, borneTimeLine, raceClock, startClock, type Borne, type EndCard, type Ravito } from './raceSplits'
import {
  HIKER3D_CLOSE_ZOOM, HIKER3D_END_ZOOM_MS, HIKER3D_END_HOLD_MS,HIKER3D_START_DEZOOM_MS, HIKER3D_OVERVIEW_MS, HIKER3D_PAIR_PX,
  HIKER3D_FOLLOW_PX, HIKER3D_MERGE_TAU_S, HIKER3D_ENABLED, hiker3dScaleForZoom, smoothEase, metersPerPixel,
  START_SIGN_OFFSET_PX, HIKER3D_BODY_SCALE, HIKER3D_OUTRO_AT, START_PRESENT,
} from './hiker3dStaging'
import { getTrackPacing, headingToScreen } from './trackPacing'
import type { StreetRun } from './routeStreets'
import { StreetCaption } from './streetCaption'

export interface FilmExportOptions {
  points:            GpxPoint[]
  distances:         number[]
  totalDistance:     number
  elevGain:          number
  elevLoss:          number
  previewLocalities: { name: string; lat: number; lon: number; placeType?: string; type?: 'locality' | 'col'; ele?: number }[]
  customLocalities?: { name: string; lat: number; lon: number; placeType?: string; type?: 'locality' | 'col'; ele?: number }[]
  startName?:        string
  endName?:          string
  /** Altitude du col quand le départ / l'arrivée est un col : panneau au style col (nom + altitude). */
  startColEle?:      number
  endColEle?:        number
  /** Départ / arrivée sur un hameau / lieu-dit : panneau au style lieu-dit. */
  startLieudit?:     boolean
  endLieudit?:       boolean
  /** Écran-titre d'ouverture (mêmes paramètres que le film 3D). Défaut titre : « Départ → Arrivée ». */
  title?:            string
  trailDate?:        string
  weather?:          { tempMin: number; tempMax: number; departure?: { temp: number; icon?: string; description?: string } | null; arrival?: { temp: number; icon?: string; description?: string } | null } | null
  characters:        CharacterId[]
  /** Bornes tous les 5 km (km + temps de passage), couchées sur la carte comme les panneaux. */
  bornes?:           Borne[]
  /** Numéro inscrit sur le dossard du personnage (cf. Hiker3dSprite.setBibNumber). */
  bibNumber?:        string
  /** Heure de départ « HH:MM », écrite sous le nom du lieu de départ pendant l'ouverture (plan serré du départ). */
  startTime?:        string
  /** Heure de départ prévue (« Départ prévu… ») plutôt que réelle d'un GPX horodaté (« Départ… »). */
  startTimePlanned?: boolean
  /** Ravitaillements (km saisis dans le widget), écrits au sol sur le tracé comme les bornes. */
  ravitos?:          Ravito[]
  /** Rues empruntées (IGN) choisies dans le widget : nom affiché en haut de l'écran pendant que la coureuse y court. */
  streets?:          StreetRun[]
  /** Carton de fin (bandeau bas sur la vue d'ensemble finale) ; sans, l'adresse du site seule. */
  endCard?:          EndCard
  /** Chrono de l'encart : heures réelles du GPX, ou vitesses prévues (cf. raceClock) ; absent = temps estimé. */
  raceTiming?:       { useRealTimes: boolean; speedsKmh?: number[] }
  /** Distance annoncée de l'épreuve (m, celle du carton final : 21,1 km pour un semi) : fin du compteur et écran-titre ;
   * absent = distance mesurée sur le tracé. */
  shownDistanceM?:   number
  trackName:         string
  durationS:         number // Défaut: 30s (correspond à la Preview)
  zoom:              number
  fps?:              number  // défaut 30
  /** Bande-son optionnelle (musique de fond / ambiance / fichier utilisateur). Mux AAC, chemin WebCodecs uniquement. */
  audio?:            FilmAudioSpec
  onProgress?:       (ratio: number) => void
  signal?:           AbortSignal
  /** Debug local uniquement (voir ?filmdebug dans useFilmRecording) : n'affiche pas le
   *  randonneur, pour itérer plus vite sur le tracé/les panneaux/la caméra. */
  debugSkipCharacter?: boolean
  /** Debug local uniquement : tronque le rendu aux N premières images de marche (à la VRAIE
   *  vitesse du film — durationS n'est pas raccourci), et saute l'écran-titre et les plans de
   *  fin. Contrairement à raccourcir durationS (qui accélère toute l'animation et rend le
   *  tremblement caméra moins visible), ça donne un extrait fidèle au rendu normal. Le
   *  préchargement de tuiles est aussi limité à la portion du tracé concernée. */
  debugMaxFrames?: number
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
const OUT_W   = IS_MOBILE ? 1280 : 1920
const OUT_H   = IS_MOBILE ?  720 : 1080

// ─── Web Mercator ─────────────────────────────────────────────────────────────

function lngLatAtProgress(
  pts: GpxPoint[], dists: number[], total: number, p: number,
): [number, number] {
  if (p <= 0) return [pts[0].lon, pts[0].lat]
  if (p >= 1) return [pts[pts.length - 1].lon, pts[pts.length - 1].lat]
  const t = p * total
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (dists[m] <= t) lo = m; else hi = m }
  const f = (t - dists[lo]) / Math.max(1, dists[hi] - dists[lo])
  return [
    pts[lo].lon + f * (pts[hi].lon - pts[lo].lon),
    pts[lo].lat + f * (pts[hi].lat - pts[lo].lat),
  ]
}

// ─── WebGL frame capture ──────────────────────────────────────────────────────

// Attend que TOUTES les tuiles du cadrage courant soient réellement chargées avant de capturer.
// On n'utilise plus l'événement `idle` de MapLibre : il se déclenche parfois avant que les
// tuiles natives n'aient remplacé les tuiles parentes étirées (-> image floue figée dans la
// vidéo), et parfois jamais (une requête bloquée -> attente inutile de 20s). On sonde
// `areTilesLoaded()` image par image à la place.
const _idleStats = { calls: 0, timeouts: 0, worstMs: 0 } // diagnostic export

function waitForMapIdle(map: maplibregl.Map, signal?: AbortSignal): Promise<void> {
  _idleStats.calls++
  const _t0 = performance.now()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return }
    let done = false
    const onAbort = () => { if (done) return; done = true; cleanup(); reject(new Error('aborted')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    // Cap court : le préchargement exhaustif (voir plus bas) met normalement toutes les tuiles en
    // cache AVANT la boucle -> areTilesLoaded() passe true en 2-3 sondages. Si une tuile a malgré
    // tout échoué, mieux vaut capturer vite (léger flou local) qu'attendre 20s × ~700 frames.
    const deadline = performance.now() + 6_000
    let pollTimer = 0, renderTimer = 0, ticks = 0
    const onRender = () => finish()
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(pollTimer); clearTimeout(renderTimer)
      map.off('render', onRender)
    }
    const finish = () => { if (done) return; done = true; cleanup(); resolve() }
    const poll = () => {
      if (done) return
      ticks++
      // Les 2 premiers sondages : on laisse MapLibre enregistrer les tuiles du nouveau cadrage
      // (sinon areTilesLoaded() renvoie true trop tôt, avant d'avoir vu la nouvelle vue).
      const ready = ticks > 2 && map.areTilesLoaded()
      if (ready || performance.now() > deadline) {
        if (!ready) _idleStats.timeouts++
        _idleStats.worstMs = Math.max(_idleStats.worstMs, performance.now() - _t0)
        // On ne résout qu'APRÈS un vrai cycle de rendu WebGL au cadrage COURANT. Sinon on capture
        // le framebuffer de l'image précédente (autre centre de caméra) alors que le tracé et le
        // marqueur, eux, sont projetés au nouveau centre -> le ruban « glisse » sur la carte le
        // temps d'une image, puis se recale. Si `render` tarde (frame lourde, GPU occupé), on
        // relance triggerRepaint() plutôt que de résoudre sur une image périmée — jusqu'à ~5
        // essais de 150 ms, après quoi on abandonne et on capte ce qu'on a (frame rare et déjà
        // dégradée). Coût sur une image normale : identique (le `render` arrive en ~1 frame).
        let settleTries = 0
        const settle = () => {
          if (done) return
          map.once('render', onRender) // onRender -> finish()
          renderTimer = window.setTimeout(() => {
            if (done) return
            map.off('render', onRender)
            if (++settleTries < 5) { map.triggerRepaint(); settle() }
            else finish()
          }, 150)
          map.triggerRepaint()
        }
        settle()
        return
      }
      pollTimer = window.setTimeout(poll, 25)
    }
    poll()
  })
}

// ─── Tracé GPX ───────────────────────────────────────────────────────────────

type ProjectFn = (lon: number, lat: number) => { x: number; y: number }

function drawTrack(
  ctx: CanvasRenderingContext2D,
  project: ProjectFn,
  points: GpxPoint[],
  distances: number[],
  totalDistance: number,
  progress: number,
) {
  if (points.length < 2) return

  const t = progress * totalDistance
  let lo = 0, hi = points.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (distances[m] <= t) lo = m; else hi = m }
  const f = (t - distances[lo]) / Math.max(1, distances[hi] - distances[lo])
  const tipLng = points[lo].lon + f * (points[hi].lon - points[lo].lon)
  const tipLat = points[lo].lat + f * (points[hi].lat - points[lo].lat)

  ctx.save()
  ctx.lineCap  = 'round'
  ctx.lineJoin = 'round'

  if (lo >= 1 || f > 0) {
    const tipPt = project(tipLng, tipLat)

    const buildPath = () => {
      const path = new Path2D()
      for (let i = 0; i <= lo; i++) {
        const pt = project(points[i].lon, points[i].lat)
        if (i === 0) path.moveTo(pt.x, pt.y); else path.lineTo(pt.x, pt.y)
      }
      path.lineTo(tipPt.x, tipPt.y)
      return path
    }
    const path = buildPath()

    // Liseré de contour très léger sous le ruban (comme TrackMap/track-done-halo).
    // Course finie (arrivée, vue générale) : dégradé d'origine sur tout le parcours et liseré marqué, sans tête.
    const finished = progress >= 1
    ctx.strokeStyle = finished ? RIBBON_OUTLINE_FULL : RIBBON_OUTLINE
    ctx.lineWidth   = finished ? 7 : 6.5
    ctx.globalAlpha = 1
    ctx.stroke(path)

    // Couleur selon la distance DERRIÈRE le coureur (ribbonAgeColor : crème, puis orange, puis vert), par tronçons
    // dessinés dans l'ordre (le plus récent passe dessus) : juste sur les boucles aussi.
    const CHUNKS = 120
    ctx.lineWidth   = 4.5
    ctx.globalAlpha = 0.97
    let i = 0
    for (let c = 1; c <= CHUNKS; c++) {
      const until = c === CHUNKS ? Infinity : (t * c) / CHUNKS
      const seg = new Path2D()
      const p0 = project(points[i].lon, points[i].lat)
      seg.moveTo(p0.x, p0.y)
      let n = 0
      while (i < lo && distances[i + 1] <= until) { i++; const pt = project(points[i].lon, points[i].lat); seg.lineTo(pt.x, pt.y); n++ }
      if (c === CHUNKS) { seg.lineTo(tipPt.x, tipPt.y); n++ }
      if (!n) continue // tronçon plus court qu'un écart entre deux points : la couleur suivante prend le relais
      ctx.strokeStyle = finished ? ribbonColorAt((c - 0.5) / CHUNKS) : ribbonAgeColor(t - (t * (c - 0.5)) / CHUNKS, totalDistance)
      ctx.stroke(seg)
    }

    // Tête du ruban (derniers mètres) par-dessus tout, avec un liseré : toujours visible sur une boucle.
    if (finished) { ctx.restore(); return }
    const headFrom = t - ribbonHeadM(totalDistance)
    let h = lo
    while (h > 0 && distances[h] > headFrom) h--
    const head = new Path2D()
    const hp = project(points[h].lon, points[h].lat)
    head.moveTo(hp.x, hp.y)
    for (let k = h + 1; k <= lo; k++) { const pt = project(points[k].lon, points[k].lat); head.lineTo(pt.x, pt.y) }
    head.lineTo(tipPt.x, tipPt.y)
    // Fondu depuis le début de la tête (comme l'aperçu) : pas de petit trait sombre en travers du ruban.
    const fade = (from: string, to: string) => {
      const g = ctx.createLinearGradient(hp.x, hp.y, tipPt.x, tipPt.y)
      g.addColorStop(0, from); g.addColorStop(0.35, to); g.addColorStop(1, to)
      return g
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = fade('rgba(20,30,20,0)', RIBBON_OUTLINE)
    ctx.lineWidth   = 6.5
    ctx.stroke(head)
    ctx.strokeStyle = fade(RIBBON_HEAD_FADE, RIBBON_HEAD_COLOR)
    ctx.lineWidth   = 4.5
    ctx.stroke(head)
  }

  ctx.restore()
}

// ─── Panneau localité ──────────────────────────────────────────────────────────
// Pré-rendu une seule fois en bitmap (par nom+style+altitude), puis simplement repositionné
// (drawImage) à chaque image. Dessiner le texte à chaque image à une position sous-pixel qui
// varie en continu (la caméra suit le randonneur en glissant) fait scintiller l'anti-aliasing
// des glyphes d'une image à l'autre ; un bitmap déplacé ne scintille pas de la même façon.
// (Arrondir la position à l'entier avait été tenté avant et donnait un autre défaut : un saut
// d'1 px quand la position franchit un seuil entier — d'où l'usage d'un cache par appel de film.)

type SignStyle = 'standard' | 'lieudit' | 'col' | 'poi' | 'ravito' | 'borne'

// Running : panneaux COUCHÉS sur la carte (sans mât, centrés sur le lieu), à la taille des personnages selon le zoom
// (cf. hiker3dScaleForZoom) ; pré-rendus en haute résolution (SIGN_RES) pour rester nets dans les plans serrés.
const SIGN_RES = 2.5
/** Taille minimale des bornes sur la vue d'ensemble de fin : km et temps de passage lisibles en 1080p. */
export const OVERVIEW_BORNE_SCALE = 1.15

interface LocSignSprite { canvas: HTMLCanvasElement; offX: number; offY: number }
export type LocSignCache = Map<string, LocSignSprite>

/** Écriture des noms de lieux à même la carte, par type — mêmes valeurs que l'aperçu (.loc-sign dans App.css).
 * Localité : grandes lettres blanches cernées de noir ; lieu-dit : idem en italique, plus petit ; point d'intérêt :
 * italique doré à empattements cerné de brun ; ravitaillement : pastille bleue (goutte) + nom cerné de bleu. */
const GROUND_LABEL: Partial<Record<SignStyle, { font: string; size: number; fill: string; stroke: string }>> = {
  standard: { font: '700 {s}px Arial, Helvetica, sans-serif', size: 24, fill: '#fff', stroke: '#1b1b1b' },
  lieudit:  { font: 'italic 700 {s}px Arial, Helvetica, sans-serif', size: 19, fill: '#fff', stroke: '#1b1b1b' },
  poi:      { font: 'italic 700 {s}px Georgia, "Times New Roman", serif', size: 20, fill: '#ffe3a3', stroke: '#4a2a10' },
  ravito:   { font: '700 {s}px Arial, Helvetica, sans-serif', size: 18, fill: '#fff', stroke: '#0a3d6b' },
}

/** Nom de lieu écrit à même la carte, sans pancarte (cf. GROUND_LABEL). */
function buildGroundLabelSprite(name: string, style: SignStyle): LocSignSprite {
  const g = GROUND_LABEL[style] ?? GROUND_LABEL.standard!
  const isRavito = style === 'ravito'
  const STROKE = 4.5
  const MARGIN = 8
  const ICON = isRavito ? 26 : 0 // pastille du ravitaillement, à gauche du nom
  const GAP = isRavito ? 6 : 0
  const FONT = g.font.replace('{s}', String(g.size))
  const m = document.createElement('canvas').getContext('2d')!
  m.font = FONT
  const textW = m.measureText(name).width
  const W = Math.ceil(ICON + GAP + textW + STROKE * 2 + MARGIN * 2)
  const H = Math.ceil(Math.max(g.size * 1.3, ICON) + STROKE * 2 + MARGIN * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(W * SIGN_RES)
  canvas.height = Math.ceil(H * SIGN_RES)
  const ctx = canvas.getContext('2d')!
  ctx.scale(SIGN_RES, SIGN_RES)
  const cy = H / 2
  if (isRavito) {
    // Pastille bleue cerclée de blanc, goutte d'eau blanche.
    const cx = MARGIN + STROKE + ICON / 2
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1
    ctx.fillStyle = '#1f7ae0'
    ctx.beginPath(); ctx.arc(cx, cy, ICON / 2, 0, Math.PI * 2); ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(cx, cy - 8)
    ctx.bezierCurveTo(cx + 2, cy - 4, cx + 6, cy, cx + 6, cy + 3)
    ctx.arc(cx, cy + 3, 6, 0, Math.PI)
    ctx.bezierCurveTo(cx - 6, cy, cx - 2, cy - 4, cx, cy - 8)
    ctx.fill()
  }
  const tx = MARGIN + STROKE + ICON + GAP + textW / 2
  ctx.font = FONT
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1
  ctx.strokeStyle = g.stroke; ctx.lineWidth = STROKE
  ctx.strokeText(name, tx, cy)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = g.fill
  ctx.fillText(name, tx, cy)
  // Ancre : la goutte du ravitaillement sur le point exact (texte à sa droite) ; sinon, centre du nom.
  return { canvas, offX: isRavito ? MARGIN + STROKE + ICON / 2 : tx, offY: cy }
}

/** Borne kilométrique « médaille » : jeton bleu nuit cerclé d'or (km en grand), pastille dorée (heure · chrono),
 * pointe sur le tracé — ancre = bout de la pointe. Même dessin que l'aperçu (.loc-sign--borne dans App.css). */
function buildBorneMedalSprite(num: string, time?: string): LocSignSprite {
  const R = 30, RING = 4, MARGIN = 8, TIP = 9
  const PILL_H = 22, PILL_FONT = `700 14px Arial, Helvetica, sans-serif`
  const m = document.createElement('canvas').getContext('2d')!
  m.font = PILL_FONT
  const pillW = time ? m.measureText(time).width + 20 : 0
  const W = Math.ceil(Math.max(2 * R, pillW) + MARGIN * 2)
  const pillY = MARGIN + 2 * R - 6 // la pastille chevauche le bas du jeton
  const H = Math.ceil((time ? pillY + PILL_H : MARGIN + 2 * R) + TIP + MARGIN)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(W * SIGN_RES)
  canvas.height = Math.ceil(H * SIGN_RES)
  const ctx = canvas.getContext('2d')!
  ctx.scale(SIGN_RES, SIGN_RES)
  const cx = W / 2, cy = MARGIN + R
  const tipTop = time ? pillY + PILL_H - 1 : MARGIN + 2 * R - 2
  // Pointe dorée, puis jeton (ombre courte : posé au sol).
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1
  ctx.fillStyle = '#ffd166'
  ctx.beginPath(); ctx.moveTo(cx - 7, tipTop); ctx.lineTo(cx + 7, tipTop); ctx.lineTo(cx, tipTop + TIP); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#14213d'
  ctx.beginPath(); ctx.arc(cx, cy, R - RING, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  let px = 28
  do { ctx.font = `700 ${px}px 'Arial Narrow', Arial, sans-serif`; px -= 1 } while (ctx.measureText(num).width > (R - RING) * 1.6 && px > 12)
  ctx.fillText(num, cx, cy - 4)
  ctx.font = `700 9.5px Arial, Helvetica, sans-serif`
  ctx.fillText('K M', cx, cy + 15)
  if (time) {
    ctx.fillStyle = '#ffd166'
    ctx.beginPath(); ctx.roundRect(cx - pillW / 2, pillY, pillW, PILL_H, PILL_H / 2); ctx.fill()
    ctx.strokeStyle = '#14213d'; ctx.lineWidth = 1.5; ctx.stroke() // liseré sombre : lisible sur la photo
    ctx.fillStyle = '#14213d'; ctx.font = PILL_FONT
    ctx.fillText(time, cx, pillY + PILL_H / 2 + 0.5)
  }
  return { canvas, offX: cx, offY: tipTop + TIP }
}

function buildLocSignSprite(name: string, style: SignStyle, ele?: number, sub?: string): LocSignSprite {
  if (style === 'borne') return buildBorneMedalSprite(name, sub)
  if (style !== 'col') return buildGroundLabelSprite(name, style)
  const FONT_SIZE = 15
  const PAD_X = 12, PAD_Y = 6
  const BORDER = 3.5, RADIUS = 7
  const MARGIN = 8 // marge autour du sprite pour l'ombre au sol (blur 4 + offsetY 1)

  const st = style as SignStyle // pancartes : col et borne (les noms de lieux passent par buildGroundLabelSprite)
  const isLieudit = st === 'lieudit'
  const isCol     = st === 'col'
  const isPoi     = st === 'poi'
  const isBorne   = st === 'borne' // borne kilométrique : bleu nuit, km + temps de passage (cf. raceSplits.ts)

  const label     = isLieudit || isPoi ? name : name.toUpperCase()
  const fontStyle = isLieudit ? 'italic 800' : isPoi ? '700' : '800'
  const FONT      = `${fontStyle} ${FONT_SIZE}px 'Arial Narrow', Arial, sans-serif`
  const FONT2     = `600 10px 'Arial Narrow', Arial, sans-serif`

  const measureCtx = document.createElement('canvas').getContext('2d')!
  measureCtx.font = FONT
  const textW  = measureCtx.measureText(label).width
  const eleStr = isCol && ele != null ? `Alt. ${ele} m` : isBorne && sub ? sub : ''
  measureCtx.font = FONT2
  const eleW   = eleStr ? measureCtx.measureText(eleStr).width : 0
  const boardW = Math.max(textW, eleW) + PAD_X * 2
  const boardH = eleStr ? FONT_SIZE + 12 + PAD_Y * 2 : FONT_SIZE + PAD_Y * 2

  const W = Math.ceil(boardW + BORDER * 2 + MARGIN * 2)
  const H = Math.ceil(boardH + BORDER * 2 + MARGIN * 2)
  const canvas = document.createElement('canvas')
  canvas.width  = Math.ceil(W * SIGN_RES)
  canvas.height = Math.ceil(H * SIGN_RES)
  const ctx = canvas.getContext('2d')!
  ctx.scale(SIGN_RES, SIGN_RES)

  // Point d'ancrage dans le sprite (unités de dessin) : centre de la pancarte, posée à plat sur le lieu.
  const px = W / 2
  const py = H / 2

  const boardX = px - boardW / 2
  const boardY = py - boardH / 2

  const bgColor     = isLieudit ? '#b84400' : isCol ? '#253d17' : isPoi ? '#5b3a1e' : isBorne ? '#14213d' : '#fff'
  const textColor   = isLieudit || isCol || isPoi || isBorne ? '#fff' : '#111'
  const borderColor = isLieudit || isCol || isPoi || isBorne ? 'transparent' : '#c0000c'

  ctx.save()
  // Ombre courte : la pancarte est au sol, pas dressée.
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur  = 4; ctx.shadowOffsetY = 1

  if (borderColor !== 'transparent') {
    ctx.fillStyle = borderColor
    ctx.beginPath(); ctx.roundRect(boardX - BORDER, boardY - BORDER, boardW + BORDER * 2, boardH + BORDER * 2, RADIUS); ctx.fill()
  }

  ctx.fillStyle = bgColor
  ctx.beginPath(); ctx.roundRect(boardX, boardY, boardW, boardH, borderColor !== 'transparent' ? RADIUS - BORDER : RADIUS); ctx.fill()

  ctx.restore()

  if (isPoi) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(boardX + 3, boardY + 3, boardW - 6, boardH - 6, RADIUS - 3); ctx.stroke()
  }

  ctx.font = FONT; ctx.fillStyle = textColor
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const textY = eleStr ? boardY + PAD_Y + FONT_SIZE / 2 : boardY + boardH / 2
  ctx.fillText(label, px, textY)

  if (eleStr) {
    ctx.font = FONT2
    if (isBorne) ctx.fillStyle = '#ffd166'
    ctx.fillText(eleStr, px, boardY + boardH - PAD_Y - 5)
  }

  return { canvas, offX: px, offY: py }
}

/** Flèche dorée cernée de sombre, de (x0, y0) vers (x1, y1) : relie une borne décalée à son endroit sur le tracé. */
function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, scale: number, alpha: number) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 4) return
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len
  const head = Math.min(len, 11 * scale), half = 6 * scale
  const bx = x1 - ux * head, by = y1 - uy * head
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const path = () => {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(bx, by); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx - uy * half, by + ux * half); ctx.lineTo(bx + uy * half, by - ux * half); ctx.closePath()
  }
  ctx.strokeStyle = '#14213d'; ctx.lineWidth = 5 * scale
  path(); ctx.stroke()
  ctx.strokeStyle = '#ffd166'; ctx.fillStyle = '#ffd166'; ctx.lineWidth = 2.5 * scale
  path(); ctx.fill()
  ctx.restore()
}

/** Bornes kilométriques (km et temps de passage) et ravitaillements, au sol sur le tracé ; partagé par les films 2D
 * et 3D. `place` : position à l'écran d'une borne ou d'un ravitaillement (null = hors champ, derrière la caméra).
 * `coveredM` : pendant la course, seules les bornes approchées (borneReached) ; sans, toutes (fin, vue d'ensemble).
 * `overview` (vue d'ensemble de fin) : une borne qui chevauche une autre borne ou un ravitaillement est décalée
 * du plus petit écart qui la dégage, et une flèche pointe son endroit sur le tracé. */
export function drawBorneLayer(
  ctx: CanvasRenderingContext2D, locSignCache: LocSignCache, bornes: Borne[], ravitos: Ravito[],
  place: (it: Borne | Ravito) => { x: number; y: number } | null,
  scale: number, alpha = 1, coveredM = Infinity, overview = false,
) {
  const outW = ctx.canvas.width, outH = ctx.canvas.height
  if (alpha <= 0) return
  const s = Math.max(1, scale)
  type Box = { x: number; y: number; w: number; h: number }
  const placed: Box[] = []
  const hits = (a: Box) => placed.some(p => a.x < p.x + p.w && a.x + a.w > p.x && a.y < p.y + p.h && a.y + a.h > p.y)
  const sprite = (name: string, style: SignStyle, sub?: string) => {
    const key = `${style}|${name}||${sub ?? ''}`
    let sp = locSignCache.get(key)
    if (!sp) { sp = buildLocSignSprite(name, style, undefined, sub); locSignCache.set(key, sp) }
    return sp
  }
  const inView = (pt: { x: number; y: number } | null): pt is { x: number; y: number } => !!pt && pt.x > -300 && pt.x < outW + 300 && pt.y > -200 && pt.y < outH + 200
  for (const r of ravitos) {
    if (!borneReached(r, coveredM)) continue
    const pt = place(r)
    if (!inView(pt)) continue
    if (overview) {
      // Ravitaillement : reste à sa place, mais les bornes l'évitent (marge d'ombre de 8 px retirée).
      const sp = sprite(r.label, 'ravito')
      placed.push({ x: pt.x - (sp.offX - 8) * s, y: pt.y - (sp.offY - 8) * s, w: (sp.canvas.width / SIGN_RES - 16) * s, h: (sp.canvas.height / SIGN_RES - 16) * s })
    }
    drawLocSign(ctx, locSignCache, r.label, pt.x, pt.y, 'ravito', undefined, alpha, s)
  }
  for (const b of bornes) {
    if (!borneReached(b, coveredM)) continue
    const pt = place(b)
    if (!inView(pt)) continue
    const num = borneNumber(b), sub = borneTimeLine(b) || undefined
    let x = pt.x, y = pt.y
    if (overview) {
      const sp = sprite(num, 'borne', sub)
      const w = (sp.canvas.width / SIGN_RES - 16) * s, h = (sp.canvas.height / SIGN_RES - 16) * s
      const box = (cx: number, cy: number): Box => ({ x: cx - w / 2, y: cy - h, w, h })
      // Écarts croissants dans 8 directions (vers le haut d'abord) : le premier qui dégage la borne.
      const dirs = [[0, -1], [0.7, -0.7], [-0.7, -0.7], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0, 1]]
      let off: [number, number] = [0, 0]
      if (hits(box(x, y))) {
        search: for (let k = 0.25; k <= 2; k += 0.25)
          for (const [dx, dy] of dirs) {
            const o: [number, number] = [dx * w * k, dy * h * k]
            if (!hits(box(pt.x + o[0], pt.y + o[1]))) { off = o; break search }
          }
      }
      x = pt.x + off[0]; y = pt.y + off[1]
      placed.push(box(x, y))
      if (off[0] || off[1]) drawArrow(ctx, x, y, pt.x, pt.y, s, alpha)
    }
    drawLocSign(ctx, locSignCache, num, x, y, 'borne', undefined, alpha, s, sub)
  }
}

function drawLocSign(
  ctx: CanvasRenderingContext2D,
  cache: LocSignCache,
  name: string,
  px: number, py: number,
  style: SignStyle = 'standard',
  ele?: number,
  alpha = 1,
  scale = 1,
  sub?: string,
) {
  if (alpha <= 0) return
  const key = `${style}|${name}|${ele ?? ''}|${sub ?? ''}`
  let sprite = cache.get(key)
  if (!sprite) { sprite = buildLocSignSprite(name, style, ele, sub); cache.set(key, sprite) }
  const w = (sprite.canvas.width / SIGN_RES) * scale, h = (sprite.canvas.height / SIGN_RES) * scale
  const draw = () => ctx.drawImage(sprite.canvas, px - sprite.offX * scale, py - sprite.offY * scale, w, h)
  if (alpha >= 1) draw()
  else {
    ctx.save()
    ctx.globalAlpha = alpha
    draw()
    ctx.restore()
  }
}

/** Fondu d'apparition/disparition d'un panneau : 0 hors de [showFrame, hideFrame], monte à 1 sur
 *  SIGN_FADE_FRAMES à l'entrée et redescend à 0 sur la même durée à la sortie (jamais les deux à
 *  la fois pour un panneau plus court que 2×la durée du fondu). hideFrame: Infinity (panneaux
 *  départ/arrivée) -> pas de fondu de sortie. */
function signAlpha(f: number, showFrame: number, hideFrame: number, fadeFrames: number): number {
  if (f < showFrame || f >= hideFrame) return 0
  const fadeIn  = Math.min(1, (f - showFrame) / fadeFrames)
  const fadeOut = Math.min(1, (hideFrame - f) / fadeFrames)
  return Math.min(fadeIn, fadeOut)
}

// ─── Carte météo ─────────────────────────────────────────────────────────────


export function drawWeatherCard(ctx: CanvasRenderingContext2D, cw: number, weather: FilmExportOptions['weather'], progress: number) {
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

  // Dimensions encore agrandies (x1.3 supplémentaire), à la demande (plus lisible sur le film exporté)
  const PAD = 21, ICON_W = 72, cardH = 102, cardY = 34

  ctx.save()
  ctx.font = 'bold 38px "Segoe UI", system-ui, sans-serif'
  const tempW = ctx.measureText(tempStr).width
  ctx.font = '22px "Segoe UI", system-ui, sans-serif'
  const descW = desc ? ctx.measureText(desc).width : 0
  const cardW = PAD + ICON_W + Math.max(tempW, descW) + PAD
  // Haut-droite, un peu plus bas que le bord.
  const cardX = cw - cardW - 16

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

// Hauteur réservée au-dessus des pieds du randonneur pour éviter le cartel d'altitude (suivi caméra).
const MARKER_H = 150

/** Adresse du site, signée dans les films. */
const SITE_ADDRESS = 'sillonphane.fr/running'

// ─── Watermark de fin ─────────────────────────────────────────────────────────
// Reprend le tracé du logo Sillonphane-Rando (AppLogoIcon.tsx) : même chemin, même dégradé,
// même animation (le trait se dessine puis les deux points apparaissent), rejouée ici image par
// image plutôt qu'en CSS puisqu'il s'agit d'une vidéo exportée en frames.
// Affiché à la fin, CENTRÉ, juste au-dessus du kilométrage : le logo se déroule en filigrane,
// puis « sillonphane.fr/running » se révèle en balayage sous le logo (retirable à terme si l'appli
// est achetée — un seul appel à supprimer).

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

export function drawEndWatermark(
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

  // Points : apparaissent vers la fin du tracé, comme app-logo-dot-in
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

/** Carton de fin, bandeau bas (style générique TV) sur la vue d'ensemble : date dorée et intitulé en italique à
 * gauche ; à droite, après un filet doré, distance, dénivelé, temps et moyenne ; adresse du site en petit au-dessus.
 * Bleu nuit et or des médailles km. Fondu d'apparition (`opacity`) avec une légère montée. */
export function drawEndCard(ctx: CanvasRenderingContext2D, cw: number, ch: number, card: EndCard, opacity: number) {
  if (opacity <= 0) return
  const GOLD = '#ffd166', SOFT = '#c9cfdc'
  const padX = cw * 0.04, baseY = ch - ch * 0.06 + (1 - opacity) * ch * 0.02
  ctx.save()
  ctx.globalAlpha = opacity
  // Fond : dégradé sombre court, seulement derrière le texte (le tracé et les repères du bas restent nets) ; une
  // ombre portée sous les lettres garde la lisibilité sur une vue claire.
  const top = ch * 0.8
  const g = ctx.createLinearGradient(0, top, 0, ch)
  g.addColorStop(0, 'rgba(8,12,20,0)'); g.addColorStop(0.45, 'rgba(8,12,20,0.6)'); g.addColorStop(1, 'rgba(8,12,20,0.85)')
  ctx.fillStyle = g
  ctx.fillRect(0, top, cw, ch - top)
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = ch * 0.008; ctx.shadowOffsetY = ch * 0.0015

  // Chiffres, de droite à gauche.
  const stats: [string, string, boolean][] = []
  if (card.distance) stats.push([card.distance, 'DISTANCE', false])
  if (card.elevGain) stats.push([card.elevGain, 'DÉNIVELÉ', false])
  if (card.time) stats.push([card.time, card.timeLabel ?? 'TEMPS', true])
  if (card.avgSpeed) stats.push([card.avgSpeed, 'MOYENNE', false])
  const VAL = `700 ${Math.round(ch * 0.032)}px Arial, Helvetica, sans-serif`
  const LAB = `700 ${Math.round(ch * 0.013)}px Arial, Helvetica, sans-serif`
  const gap = ch * 0.036
  ctx.textBaseline = 'alphabetic'
  const widths = stats.map(([v, l]) => { ctx.font = VAL; const wv = ctx.measureText(v).width; ctx.font = LAB; return Math.max(wv, ctx.measureText(l).width + l.length * ch * 0.003) })
  let x = cw - padX
  const labY = baseY, valY = baseY - ch * 0.024
  for (let i = stats.length - 1; i >= 0; i--) {
    const [v, l, gold] = stats[i]
    ctx.textAlign = 'right'
    ctx.font = VAL; ctx.fillStyle = gold ? GOLD : '#fff'
    ctx.fillText(v, x, valY)
    ctx.font = LAB; ctx.fillStyle = SOFT
    ctx.letterSpacing = `${ch * 0.003}px`
    ctx.fillText(l, x, labY)
    ctx.letterSpacing = '0px'
    x -= widths[i] + gap
  }
  // Filet doré vertical entre l'intitulé et les chiffres.
  const sepX = x + gap * 0.5
  if (stats.length) {
    ctx.fillStyle = GOLD
    ctx.fillRect(sepX, valY - ch * 0.036, Math.max(1.5, ch * 0.0018), ch * 0.064)
  }

  // Intitulé (italique, ajusté à la place restante) et date dorée au-dessus.
  const maxTitleW = (stats.length ? sepX - gap * 0.5 : cw - padX) - padX
  let ts = Math.round(ch * 0.044)
  do { ctx.font = `italic ${ts}px Georgia, "Times New Roman", serif`; ts -= 2 } while (ctx.measureText(card.title).width > maxTitleW && ts > 14)
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'
  ctx.fillText(card.title, padX, baseY)
  const dateLine = [card.date?.toUpperCase(), 'ARRIVÉE'].filter(Boolean).join('  ·  ')
  ctx.font = `700 ${Math.round(ch * 0.015)}px Arial, Helvetica, sans-serif`
  ctx.fillStyle = GOLD
  ctx.letterSpacing = `${ch * 0.004}px`
  ctx.fillText(dateLine, padX, baseY - ts - ch * 0.012)
  ctx.letterSpacing = '0px'

  // Adresse du site, discrète, en haut à droite du bandeau.
  ctx.textAlign = 'right'
  ctx.font = `700 ${Math.round(ch * 0.015)}px Arial, Helvetica, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillText(SITE_ADDRESS, cw - padX, valY - ch * 0.055)
  ctx.restore()
}

// Adresse discrète en bas à droite, affichée à la FIN du film (fondu simple, sans logo).
export function drawEndAddress(ctx: CanvasRenderingContext2D, cw: number, ch: number, opacity: number) {
  if (opacity <= 0) return

  const marginBottom = Math.round(ch * 0.09)
  const barBottom = ch - marginBottom
  const barH = Math.round(ch * 0.09)

  // Dégradé sombre fondu dans le bord bas -> lisibilité du texte sur fond de carte clair.
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

// Source du fond de carte (Plan IGN, licence Etalab 2.0 : « © IGN » obligatoire), incrustée sur CHAQUE image des
// films 2D, juste avant l'encodage. Bas GAUCHE, discrète, même facture que les
// crédits du film 3D (drawOverlays, filmExport3d.ts) : le bas-droit porte l'adresse de fin (drawEndAddress), le
// le haut-gauche le profil — rien d'autre n'occupe ce coin.
export function drawMapCredit(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `500 ${Math.max(11, Math.round(ch * 0.012))}px system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4
  ctx.fillText('© IGN', Math.round(ch * 0.015), ch - Math.round(ch * 0.011))
  ctx.restore()
}

// Écran-titre d'ouverture (copie conforme du film 3D : voile sombre + date + titre 2 lignes max
// + pastilles km / D+). Le voile noir plein de l'ouverture est géré à part par l'appelant.
function drawIntroCard(
  ctx: CanvasRenderingContext2D,
  o: { title: string; date: string; km: string; gain: string; alpha: number },
): void {
  ctx.save()
  ctx.globalAlpha = o.alpha
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

function currentElevation(points: GpxPoint[], distances: number[], progress: number): number {
  const total = distances[distances.length - 1], t = progress * total
  let lo = 0, hi = points.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (distances[m] <= t) lo = m; else hi = m }
  const f = (t - distances[lo]) / Math.max(1, distances[hi] - distances[lo])
  return points[lo].ele + f * (points[hi].ele - points[lo].ele)
}

// ─── Export principal ─────────────────────────────────────────────────────────

/** Part de la barre de progression réservée au préchargement des tuiles (le reste couvre le rendu
 * image par image). Partagée avec l'estimation du temps restant (exportEta.ts), qui estime les deux
 * phases séparément. */
export const PREFETCH_PROGRESS_BUDGET = 0.15

/**
 * Tuiles du fond de carte dont le film 2D aura besoin (liste dédupliquée) : couloir du tracé aux zooms de
 * lecture, avec un rayon couvrant le cadre d'export (1920×1080 ordinateur / 1280×720 mobile, +60 %) —
 * nettement plus grand que la carte de l'aperçu, qui a donc déjà pu charger des tuiles utiles à la
 * lecture mais insuffisantes au film ; rectangle englobant complet à TOUS les zooms du dézoom final
 * (≈ 4 crans sous la lecture) ; plans serrés des coureurs 3D autour du départ et de l'arrivée.
 * Tout doit être en cache AVANT la capture : une tuile chargée en direct se fait throttler par le
 * serveur et MapLibre fige une tuile parente étirée -> voile flou sur la vidéo.
 * `zoom` : zoom de lecture du film, déjà corrigé pour le mobile.
 */
// Rayon en tuiles (256 px) couvrant la moitié du plus grand côté du cadre d'export, +60 % de marge.
const FILM_TILE_RADIUS = Math.max(1, Math.ceil(Math.max(OUT_W, OUT_H) / 2 / 256 * 1.6))

function buildFilm2dTileUrls(
  points: GpxPoint[], zoom: number, withHikers: boolean, withOverview: boolean, endPoints: GpxPoint[] = points,
): string[] {
  const tileRadius = FILM_TILE_RADIUS
  const zHi = Math.ceil(zoom)
  const zLo = withOverview ? Math.max(6, Math.floor(zoom) - 4) : Math.floor(zoom)
  const zooms: number[] = []
  for (let z = zLo; z <= zHi; z++) zooms.push(z)
  const closeZooms: number[] = []
  if (withHikers) for (let z = Math.ceil(zoom) + 1; z <= Math.ceil(zoom + HIKER3D_CLOSE_ZOOM); z++) closeZooms.push(z)
  return [...new Set([
    ...buildRouteTileUrls(points, [Math.floor(zoom), Math.ceil(zoom)], tileRadius),
    ...buildBoundingBoxTileUrls(points, zooms, OUT_W / OUT_H),
    ...(closeZooms.length ? buildRouteTileUrls([endPoints[0], endPoints[endPoints.length - 1]], closeZooms, tileRadius) : []),
  ])]
}

/**
 * Précharge (best-effort) les tuiles du film 2D dès l'ouverture de l'animation (useFilm2dPrefetch.ts) : la phase
 * de préchargement du film retrouve ensuite tout en cache. Concurrence basse (2) pour ne pas gêner la carte de
 * l'aperçu. `zoomRaw` : zoom de lecture (ANIM_ZOOM), comme `opts.zoom` d'exportFilm.
 */
export function prefetchFilm2dTiles(points: GpxPoint[], zoomRaw: number, withCharacters: boolean, signal: AbortSignal): Promise<void> {
  if (points.length < 2) return Promise.resolve()
  const zoom = IS_MOBILE ? zoomRaw + 1 : zoomRaw
  const urls = buildFilm2dTileUrls(points, zoom, withCharacters && HIKER3D_ENABLED, true)
  // Contrôleur propre, que exportFilm coupe à son lancement : il redemande les mêmes URLs, à pleine concurrence ;
  // ce qui est déjà téléchargé reste en cache.
  const ctrl = new AbortController()
  signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  previewPrefetch?.abort()
  previewPrefetch = ctrl
  return prefetchTiles(urls, { concurrency: 2, retries: 1, tileTimeoutMs: 9000, signal: ctrl.signal })
    .finally(() => { if (previewPrefetch === ctrl) previewPrefetch = null })
}
let previewPrefetch: AbortController | null = null

export async function exportFilm(opts: FilmExportOptions): Promise<Blob> {
  previewPrefetch?.abort(); previewPrefetch = null // cf. prefetchFilm2dTiles
  // Encodeur vidéo en échec : on coupe le rendu via un signal d'annulation interne (relié à celui de l'appelant),
  // puis on remonte une erreur explicite — y compris si une attente a rejeté « aborted » entre-temps.
  let encoderFailed = false
  const ctrl = new AbortController()
  const outer = opts.signal
  const onOuterAbort = () => ctrl.abort()
  if (outer?.aborted) ctrl.abort(); else outer?.addEventListener('abort', onOuterAbort)
  try {
    const blob = await exportFilmImpl({ ...opts, signal: ctrl.signal }, () => { encoderFailed = true; ctrl.abort() })
    if (encoderFailed) throw new Error(encoderFailMessage())
    return blob
  } catch (e) {
    if (encoderFailed) throw new Error(encoderFailMessage(), { cause: e })
    throw e
  } finally {
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

async function exportFilmImpl(opts: FilmExportOptions, onEncoderFail: () => void): Promise<Blob> {
  const { points, distances, totalDistance, durationS = 30, zoom: zoomRaw, fps = 30, onProgress, signal } = opts
  // Sur smartphone, vue rapprochée : altitude divisée par 2 (+1 niveau de zoom)
  const zoom = IS_MOBILE ? zoomRaw + 1 : zoomRaw
  if (points.length < 2) return new Blob()
  // Tracé lissé (bruit GPS) pour le ruban dessiné et la position du randonneur — mêmes distances
  // cumulées que les points réels (voir smoothTrackPoints), pour ne pas décaler la
  // progression/l'altimétrie.
  const visualPoints = smoothTrackPoints(points)
  // Tracé beaucoup plus lissé, réservé à la cible que poursuit la caméra : un lissage léger
  // (visualPoints) laissait encore un résidu de bruit GPS transmis au filtre exponentiel de
  // suivi de caméra (FOLLOW_K plus bas), qui fait trembler TOUT ce qui est projeté avec elle
  // (fond de carte, ruban, panneaux). Même principe à deux courbes que filmExport3d.ts (trail vs
  // cameraCurve), qui n'a pas ce défaut — paramètres repris tels quels (10 passes, rayon 14).
  const cameraPoints = smoothTrackPoints(points, 10, 14)

  // Précharge dès maintenant les tuiles qu'empruntera la caméra pendant la capture (mêmes niveaux
  // de zoom que la boucle principale), en parallèle de l'initialisation de la carte hors-écran et
  // du chargement des randonneurs 3D ci-dessous — sans ça, chaque image de la boucle principale peut attendre
  // individuellement (jusqu'à 20s, voir waitForMapIdle) une tuile pas encore en cache, ce qui
  // explique une bonne part des exports très lents sur un serveur de tuiles chargé.
  // Rayon en tuiles (256px) couvrant la moitié du plus grand côté du cadre d'export (1920×1080
  // desktop / 1280×720 mobile), +30% de marge : le cadre exporté est nettement plus grand que la
  // fenêtre de carte affichée pendant l'aperçu (qui a donc déjà pu charger des tuiles utiles à la
  // lecture mais insuffisantes à l'export), sans quoi une bonne partie des tuiles nécessaires à la
  // capture ne serait jamais dans ce préchargement.
  // debugMaxFrames : la capture ne visitera que le tout début du tracé -> inutile de précharger
  // les tuiles du reste de la route (gain de temps direct sur cette phase, cf. commentaire de
  // debugMaxFrames plus haut). Marge ×1.3 (caméra qui avance un peu vite en fin de segment).
  const prefetchPoints = opts.debugMaxFrames
    ? points.slice(0, Math.max(2, Math.ceil(points.length * Math.min(1,
        (opts.debugMaxFrames / fps) / durationS * 1.3))))
    : points
  // debugMaxFrames ne rend le plan d'ensemble QUE s'il excède la durée naturelle du tracé (sinon
  // renderFrames < totalFrames et ce plan est sauté, voir plus bas) — un tracé court/accéléré
  // (vitesse ×2, ANIM_SETTINGS) peut très bien tenir sous le plafond debug et enchaîner dessus.
  // Le confondre avec "jamais rendu" a fait louper le préchargement des zooms bas dans ce cas :
  // le plan d'ensemble allait alors chercher ses tuiles en direct, très lentement (surtout sans le
  // cache HTTP local déjà chaud d'une session de dev — invisible en local, très visible en prod).
  const totalFramesEstimate = Math.ceil(durationS * fps)
  const overviewWillRun = !opts.debugMaxFrames || opts.debugMaxFrames >= totalFramesEstimate
  // « Ruban seul » (aucun personnage choisi), ou appareil sans WebGL2 : aucun randonneur dans le film.
  const noCharacter = !!opts.debugSkipCharacter || opts.characters.length === 0
  const want3d = !noCharacter && HIKER3D_ENABLED
  const prefetchUrls = buildFilm2dTileUrls(prefetchPoints, zoom, want3d, overviewWillRun, points)
  _idleStats.calls = 0; _idleStats.timeouts = 0; _idleStats.worstMs = 0
  console.log(`[film2d] ${prefetchUrls.length} tuiles à précharger (zoom ${zoom})`)
  // Abort dédié : sans ça, les requêtes de préchargement encore en vol après le délai d'attente
  // ci-dessous continuaient en tâche de fond PENDANT toute la boucle de capture, se disputant les
  // mêmes connexions réseau (~6 par serveur) que les propres tuiles de la carte hors-écran.
  // Le préchargement peut prendre plusieurs dizaines de secondes (voire la limite de 120s
  // ci-dessous) sur un tracé long ou un serveur de tuiles chargé. Sans remontée de progression
  // pendant cette phase, la barre affichée à l'utilisateur restait bloquée à 0% tout ce temps
  // (impression d'export figé/planté). On lui réserve une part du budget de progression, le
  // reste étant couvert par la capture image par image ci-dessous (voir frameProgress()).
  const tilePrefetchAbort = new AbortController()
  // Relié à l'annulation du film : sans ça, les requêtes de tuiles continuaient en arrière-plan
  // jusqu'à la fin naturelle du préchargement (ou le plafond de 120s ci-dessous) même après un
  // clic sur "Annuler", qui ne faisait alors que masquer la barre de progression.
  if (signal?.aborted) tilePrefetchAbort.abort()
  else signal?.addEventListener('abort', () => tilePrefetchAbort.abort(), { once: true })
  const tilePrefetchDone = prefetchTiles(prefetchUrls, {
    // Concurrence basse + relance bornée : moins de 429 de throttling IGN, et une tuile qui a
    // quand même échoué est remise en file au lieu de rester un trou flou pour tout le film.
    concurrency: 4, retries: 2, tileTimeoutMs: 9000, signal: tilePrefetchAbort.signal,
    onProgress: ratio => onProgress?.(ratio * PREFETCH_PROGRESS_BUDGET),
  })

  // ── Carte MapLibre hors-écran ─────────────────────────────────────────────
  const mapContainer = document.createElement('div')
  mapContainer.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${OUT_W}px;height:${OUT_H}px;pointer-events:none;`
  document.body.appendChild(mapContainer)

  const exportMap = new maplibregl.Map({
    container: mapContainer,
    style: makeStyle(),
    center: [points[0].lon, points[0].lat],
    zoom,
    bearing: 0, pitch: 0,
    ...({ preserveDrawingBuffer: true, pixelRatio: 1, antialias: true } as object),
    attributionControl: false,
    fadeDuration: 0,
    maxTileCacheSize: 5000,
  })

  await new Promise<void>(resolve => exportMap.once('load', resolve))

  onProgress?.(-0)
  await waitForMapIdle(exportMap, signal)
  if (signal?.aborted) { exportMap.remove(); mapContainer.remove(); return new Blob() }

  // Randonneurs 3D (mode film : rendu image par image) ; en cas d'échec, film sans randonneur (ruban seul).
  let hikers: Hiker3dSprite[] = []
  if (want3d) {
    try {
      const { createHiker3dSprite } = await import('./hiker3dSprite')
      hikers = opts.characters.slice(0, 2).map(id => createHiker3dSprite(id, { manual: true, bibNumber: opts.bibNumber }))
      // Annulation : contextes WebGL libérés tout de suite (le navigateur n'en garde qu'un nombre limité).
      signal?.addEventListener('abort', () => hikers.forEach(h => h.dispose()), { once: true })
      await Promise.race([Promise.all(hikers.map(h => h.whenReady())), new Promise(r => setTimeout(r, 30_000))])
    } catch (e) {
      console.warn('[film2d] randonneurs 3D indisponibles, film sans randonneur :', e)
      hikers.forEach(h => h.dispose())
      hikers = []
    }
    if (signal?.aborted) { hikers.forEach(h => h.dispose()); return new Blob() }
  }
  const hikers3d = hikers.length > 0

  const canvas = document.createElement('canvas')
  canvas.width = OUT_W; canvas.height = OUT_H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const hasWC = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  let useWC   = false, muxer: InstanceType<typeof Muxer<ArrayBufferTarget>> | null = null, encoder: VideoEncoder | null = null
  let encoderError: unknown = null

  // ── Bande-son (chemin WebCodecs uniquement) ───────────────────────────────────
  // Durée totale du film = intro (écran-titre) + survol + plan d'ensemble/watermark (dézoom 1,5 s
  // + maintien 5 s, avec le fondu de sortie du randonneur PENDANT ce plan, qui se termine sur une
  // image fixe, sans fondu au noir — plus de plan rapproché figé intermédiaire, voir END_HOLD_FRAMES).
  // Constantes reprises telles quelles plus bas ; l'écart de quelques images dû aux arrondis est
  // inaudible et masqué par le fondu sonore.
  // Randonneurs 3D : même mise en scène que l'aperçu. Départ : écran-titre sur un plan serré (personnages en
  // attente, ou qui se lèvent), maintien, dézoom pendant lequel ils pivotent vers le chemin. Arrivée : zoom (le
  // salut démarre aux 60 %), maintien jusqu'à la fin du salut, vue d'ensemble pendant laquelle ils rapetissent et
  // s'effacent.
  // Heure de départ : écran de départ fixe START_CLOCK_SHOW_S une fois le voile noir levé, heure affichée, puis heure
  // effacée sur START_CLOCK_FADE_S ; la course ne part qu'ensuite. Sans heure, rythme habituel.
  const START_CLOCK_SHOW_S = 2, START_CLOCK_FADE_S = 0.6
  const hasStartClock = startClock(opts.startTime, opts.startTimePlanned ?? true) != null
  const START_CLOCK_HOLD_S = hasStartClock ? START_CLOCK_SHOW_S + START_CLOCK_FADE_S : 0
  const H3_START_HOLD_S = hasStartClock ? START_CLOCK_HOLD_S : 1
  // Vue d'ensemble finale : d'abord OVERVIEW_CLEAN_S sans bornes ni carton du bas (le tracé seul), puis ces infos
  // apparaissent en fondu et restent 5 s.
  const OVERVIEW_CLEAN_S = 2
  // Allure (comme l'aperçu) : cap du chemin, et marche ralentie dans les virages pour des pivots en douceur -> la
  // marche dure walkS au lieu de durationS, et la distance parcourue n'est plus proportionnelle au temps.
  const pacing = hikers3d ? getTrackPacing(visualPoints, distances) : null
  const nominalMps = totalDistance / durationS
  pacing?.setNominalSpeed(nominalMps)
  const walkWarp = pacing ? pacing.timeWarp() : null
  const walkS = walkWarp ? walkWarp.totalS : durationS
  const H3_END_HOLD_S = HIKER3D_END_HOLD_MS / 1000
  const filmDurationS = hikers3d
    ? walkS + (4 + 1.6 + H3_START_HOLD_S + HIKER3D_START_DEZOOM_MS / 1000)
      + (HIKER3D_END_ZOOM_MS / 1000 + H3_END_HOLD_S + HIKER3D_OVERVIEW_MS / 1000 + OVERVIEW_CLEAN_S + 5)
    : durationS + (4 + 1.6 + (hasStartClock ? START_CLOCK_HOLD_S : -0.5)) + (1.5 + OVERVIEW_CLEAN_S + 5)
  let audioBuffer: AudioBuffer | null = null
  if (hasWC && hasFilmAudio(opts.audio) && filmAudioSupported()) {
    try {
      audioBuffer = await buildFilmAudioTrack(opts.audio, filmDurationS, opts.signal)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      console.warn('[film2d] bande-son ignorée :', e)
    }
  }
  // QUALITÉ CONSTANTE + PLAFOND (voir qpRateControl.ts). Avant : CBR 60 Mb/s desktop / 16 mobile en
  // High 4.0 (hors limite du niveau, 25 Mb/s) — choisi pour combattre le flou en travelling sur
  // la carte topo (contenu à très haute fréquence spatiale) : si le flou revient, c'est le
  // plafond qu'il faut relever (Main 4.1 autorise 50 Mb/s).
  // Profil Main@4.1 : le niveau 4.0 plafonne à 20 Mb/s, les lecteurs stricts saccadent au-delà.
  // Repli : VBR à FALLBACK_BITRATE si le mode quantizer n'est pas proposé par le navigateur.
  const VIDEO_QP = 25
  const FALLBACK_BITRATE = 10_000_000
  const bitrate = FALLBACK_BITRATE
  let useQP = false
  // 10 Mb/s (16 au départ, comme le 3D) : la carte topo en défilement reste collée au plafond sur tout le
  // film, la taille du fichier en découle directement (16 Mb/s -> ~112 Mo pour 50 s, jugé trop lourd).
  const QP_CAP_BPS = 10_000_000
  const rc = createQpRateControl({ fps, baseQp: VIDEO_QP, maxQp: 42, capBps: QP_CAP_BPS })
  // GOP ~1,6 s comme le 3D : le GOP court (15) servait à « reconverger » en CBR ; en qualité
  // constante il ne ferait que gaspiller le budget du plafond en images-clés.
  const GOP = 48
  // Encode l'image courante du canvas ; `fi` = index global de l'image dans le film.
  // On ATTEND l'encodeur s'il prend du retard (comme filmExport3d.ts) : la marche sur mosaïque produit ses images
  // bien plus vite que l'encodeur ne les traite. Sans ça, (1) la file gonflait et tout se payait sur encoder.flush()
  // en fin de rendu (long écran « Finalisation… » sans progression réelle), (2) le régulateur de débit décidait sur des tailles
  // d'images vieilles de plusieurs secondes et ne tenait pas le plafond de débit.
  // Garde-fou (encoderWait.ts) : encodeur en erreur ou bloqué -> onEncoderFail() annule le rendu par le même
  // chemin qu'une annulation (toutes les boucles testent signal.aborted et nettoient la carte), et exportFilm
  // remonte alors encoderFailMessage().
  async function encodeFrame(fi: number, keyFrame: boolean) {
    if (encoderError != null || encoder!.state === 'closed') { onEncoderFail(); return }
    noteEncoderFrame(fi)
    const vf = new VideoFrame(canvas, { timestamp: Math.round(fi * 1_000_000 / fps) })
    try {
      encoder!.encode(vf, { keyFrame: keyFrame || fi % GOP === 0, ...(useQP ? { avc: { quantizer: rc.next(fi) } } : {}) })
    } finally { vf.close() }
    if (!await waitEncoderQueue(encoder!, 2, () => encoderError != null, signal)) onEncoderFail()
  }

  if (hasWC) {
    // H.264 uniquement : HEVC est encodable sur certains navigateurs (Safari) mais pas décodable
    // par la plupart des autres (Chrome/Firefox/Android) — un film exporté en HEVC lisait
    // silencieusement dans le vide (aucune erreur, juste rien qui se joue) sur ces appareils.
    for (const codec of ['avc1.4d0029', 'avc1.4d0028', 'avc1.42001e']) {
      try {
        const base = { codec, width: OUT_W, height: OUT_H, framerate: fps, latencyMode: 'quality' as const }
        const qpCfg: VideoEncoderConfig = { ...base, bitrateMode: 'quantizer' }
        const vbrCfg: VideoEncoderConfig = { ...base, bitrate, bitrateMode: 'variable' }
        const qpOk = await VideoEncoder.isConfigSupported(qpCfg).then(s => !!s.supported, () => false)
        if (qpOk || (await VideoEncoder.isConfigSupported(vbrCfg)).supported) {
          muxer   = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: OUT_W, height: OUT_H, frameRate: fps }, ...(audioBuffer ? { audio: MUXER_AUDIO_CONFIG } : {}), fastStart: 'in-memory' })
          encoder = new VideoEncoder({ output: (c, m) => { rc.onChunk(c); muxer!.addVideoChunk(c, m) }, error: e => { console.error('[film] encoder:', e); encoderError = e } })
          encoder.configure(qpOk ? qpCfg : vbrCfg)
          useQP = qpOk
          noteEncoderSetup(`film 2D, ${codec} ${qpOk ? 'QP' : 'VBR'} ${OUT_W}×${OUT_H}`)
          useWC = true; break
        }
      } catch { /**/ }
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
    try {
      const s  = canvas.captureStream(0)
      mrTrack  = s.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?(): void }
      try { mr = new MediaRecorder(s, { mimeType: mrMime, videoBitsPerSecond: bitrate }) } catch { mr = new MediaRecorder(s) }
      mr.ondataavailable = e => { if (e.data.size > 0) mrChunks.push(e.data) }
      mr.start(200)
    } catch {
      throw new Error('Navigateur non supporté.')
    }
  }

  // Avance d'apparition : le panneau (y compris les cols) surgit ~3 s AVANT que le randonneur
  // n'atteigne le point le plus proche, et reste affiché ~3 s après.
  const SIGN_LEAD_FRAMES = Math.round(3 * fps)
  const SIGN_STAY_FRAMES = Math.round(3 * fps)
  // Fondu d'apparition/disparition des panneaux (au lieu d'un pop-in/pop-out net à showFrame/
  // hideFrame). Les panneaux départ/arrivée (hideFrame: Infinity) ne font que l'entrée.
  const SIGN_FADE_FRAMES = Math.max(1, Math.round(0.4 * fps))
  interface LocalityEvent { name: string; lon: number; lat: number; style: SignStyle; ele?: number; showFrame: number; hideFrame: number; arriveFrame: number }

  const depName = opts.startName?.trim().toLowerCase() ?? ''
  const arrName = opts.endName?.trim().toLowerCase() ?? ''
  // Localités détectées : on retire celles qui doublonnent le panneau départ/arrivée.
  // Les panneaux ajoutés manuellement sont conservés tels quels — leur nom peut coïncider
  // avec le départ/arrivée (ex. un col ajouté au bout du tracé) sans devoir disparaître.
  const previewLocs = (opts.previewLocalities ?? []).filter(loc => {
    const n = loc.name.trim().toLowerCase()
    return (!depName || n !== depName) && (!arrName || n !== arrName)
  })
  const allLocs = [...previewLocs, ...(opts.customLocalities ?? [])]

  const estTotalFrames = Math.ceil(walkS * fps)
  const localityEvents: LocalityEvent[] = allLocs.map(loc => {
    let minDist = Infinity, closestDist = 0
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].lon - loc.lon, dy = points[i].lat - loc.lat
      const d  = dx * dx + dy * dy
      if (d < minDist) { minDist = d; closestDist = distances[i] }
    }
    const triggerProgress = Math.min(closestDist / totalDistance, 1)
    const arriveFrame = walkWarp ? Math.round(walkWarp.timeAtM(triggerProgress * totalDistance) * fps) : Math.round(triggerProgress * estTotalFrames)
    const showFrame = Math.max(0, arriveFrame - SIGN_LEAD_FRAMES)
    const style: SignStyle = loc.type === 'col' ? 'col' : loc.placeType === 'poi' ? 'poi' : loc.placeType === 'ravito' ? 'ravito' : (loc.placeType === 'hamlet' || loc.placeType === 'locality') ? 'lieudit' : 'standard'
    return { name: loc.name, lon: loc.lon, lat: loc.lat, style, ele: loc.ele, showFrame, hideFrame: arriveFrame + SIGN_STAY_FRAMES, arriveFrame }
  })

  const departureEvent: LocalityEvent | null = opts.startName ? { name: opts.startName, lon: points[0].lon, lat: points[0].lat, style: opts.startColEle != null ? 'col' : opts.startLieudit ? 'lieudit' : 'standard', ele: opts.startColEle, showFrame: 0, hideFrame: Infinity, arriveFrame: 0 } : null
  const arrivalEvent: LocalityEvent | null   = opts.endName   ? { name: opts.endName,   lon: points[points.length - 1].lon, lat: points[points.length - 1].lat, style: opts.endColEle != null ? 'col' : opts.endLieudit ? 'lieudit' : 'standard', ele: opts.endColEle, showFrame: 0, hideFrame: Infinity, arriveFrame: estTotalFrames } : null

  // Rues empruntées : nom affiché en haut de l'écran (cf. streetCaption.ts), selon la part du parcours faite.
  const streetCaption = new StreetCaption((opts.streets ?? []).map(st => ({ name: st.name, from: st.startM / totalDistance, to: st.endM / totalDistance })))

  const totalFrames       = Math.ceil(walkS * fps)
  // debugMaxFrames tronque la marche à la vraie vitesse (durationS inchangé) au lieu de la
  // compresser — le seul moyen d'observer le tremblement caméra à une vitesse représentative du
  // rendu normal. Les plans de fin (garde `renderFrames === totalFrames`) sont alors sautés
  // automatiquement puisque renderFrames < totalFrames.
  const renderFrames      = opts.debugMaxFrames ? Math.min(totalFrames, opts.debugMaxFrames) : totalFrames
  const msPerFrame        = 1000 / fps

  // ── Écran-titre d'ouverture (mêmes paramètres que le film 3D) ─────────────
  //  1. écran NOIR, le titre s'y inscrit en fondu sur TITLE_IN_S ;
  //  2. le noir se lève sur SCENE_REVEAL_S ET le titre se ferme EN MÊME TEMPS ;
  //  3. la marche démarre RIBBON_EARLY_S avant la fin de la levée du noir.
  const TITLE_IN_S = 4
  const SCENE_REVEAL_S = 1.6
  const RIBBON_EARLY_S = 0.5
  // Randonneurs 3D : le voile se lève entièrement sur le plan serré, puis maintien (le temps de se lever) ; la
  // marche ne part qu'après le dézoom (START_DEZOOM_FRAMES).
  const INTRO_FRAMES = hikers3d
    ? Math.round((TITLE_IN_S + SCENE_REVEAL_S + H3_START_HOLD_S) * fps)
    : Math.round((TITLE_IN_S + SCENE_REVEAL_S + (hasStartClock ? START_CLOCK_HOLD_S : -RIBBON_EARLY_S)) * fps)
  const START_DEZOOM_FRAMES = hikers3d && !opts.debugMaxFrames ? Math.round((HIKER3D_START_DEZOOM_MS / 1000) * fps) : 0
  // Durées des plans de fin (vue d'ensemble) : comptées ici aussi pour que la barre de
  // progression continue d'avancer pendant ces phases au lieu de rester bloquée à 100% ("Presque
  // prêt…" figé plusieurs secondes, impression d'export planté).
  // Plan rapproché figé intermédiaire supprimé (transition directe marche -> vue d'ensemble) :
  // il repassait par le rendu MapLibre (pas la mosaïque de la marche), avec un aspect plus flou
  // et une coupure nette entre les trois plans successifs.
  // Randonneurs 3D : ce plan revient — zoom sur l'arrivée puis maintien pendant le salut (cf. H3_END_HOLD_S).
  const END_ZOOM_FRAMES = hikers3d ? Math.round((HIKER3D_END_ZOOM_MS / 1000) * fps) : 0
  const END_HOLD_FRAMES = hikers3d ? END_ZOOM_FRAMES + Math.round(H3_END_HOLD_S * fps) : 0
  const EASE_OV = Math.round((hikers3d ? HIKER3D_OVERVIEW_MS / 1000 : 1.5) * fps)
  const HOLD_OV = Math.round((OVERVIEW_CLEAN_S + 5) * fps)
  const openingTitle = (opts.title?.trim())
    || [opts.startName, opts.endName].filter(Boolean).join(' → ') || 'Sillonphane'
  const openingDate = opts.trailDate?.trim() ?? ''
  // Distance annoncée (carton final) : le compteur s'y arrête, l'écran-titre l'affiche (bornes : km mesuré).
  const shownM = opts.shownDistanceM ?? totalDistance
  // Chrono de l'encart du haut : temps écoulé au point atteint (réel, prévu ou estimé).
  const clock = raceClock(points, distances, opts.raceTiming ?? { useRealTimes: false })
  const timeAt = (pr: number) => ({ elapsedS: clock.elapsedAtM(pr * totalDistance), timeLabel: clock.label })
  const openingKm = `${(shownM / 1000).toFixed(1).replace('.', ',')} km`
  const openingGain = `D+ ${Math.round(opts.elevGain / 10) * 10} m`
  function drawOpening(tSec: number): void {
    const revealT = tSec - TITLE_IN_S
    const blackA = revealT <= 0 ? 1 : revealT >= SCENE_REVEAL_S ? 0 : 1 - revealT / SCENE_REVEAL_S
    if (blackA > 0) {
      const b = blackA * blackA * (3 - 2 * blackA)
      ctx.fillStyle = `rgba(0,0,0,${b})`
      ctx.fillRect(0, 0, OUT_W, OUT_H)
    }
    const introA = Math.min(Math.min(1, tSec / TITLE_IN_S), blackA)
    if (introA > 0) {
      const s = Math.max(0, Math.min(1, introA))
      drawIntroCard(ctx, {
        title: openingTitle, date: openingDate, km: openingKm, gain: openingGain,
        alpha: s * s * (3 - 2 * s),
      })
      // Signature : logo + « sillonphane.fr/running » se déroulent sur l'écran-titre noir, puis
      // s'effacent avec la levée du voile. Même dispositif et même position que le film 3D
      // (bloc calé au tiers bas, cf. filmExport3d.ts).
      drawEndWatermark(
        ctx, OUT_W, OUT_H,
        s * s * (3 - 2 * s),
        Math.min(1, tSec / 2.2),
        OUT_H - Math.round(OUT_H * 0.12) - 50 - Math.round(OUT_H * 0.02),
      )
    }
  }

  // ── PARAMÈTRES CAMÉRA ────────────────────────────────────────────────────

  // Zone à éviter pour le randonneur (panneau élévation bas gauche) : élargie vers le haut de
  // MARKER_H, le personnage étant dessiné au-dessus de son point d'ancrage (les pieds).
  const elevRect = elevOverlayRect(OUT_W, OUT_H)
  const AVOID_PAD = 40

  // Suivi caméra CONTINU (remplace le rattrapage déclenché au bord + easeTo de 2s). La caméra
  // trace en permanence vers le randonneur par lissage exponentiel : plus de pic de vitesse au
  // moment du rattrapage -> beaucoup moins de flou de compression sur les travellings. Le
  // randonneur n'est plus pile au centre, il traîne légèrement dans le sens de la marche
  // (cadrage « on regarde devant ») ; on resserre s'il s'écarte trop du centre ou s'il entre
  // dans la zone du cartel d'altitude.
  const FOLLOW_K       = IS_MOBILE ? 0.075 : 0.038
  const FOLLOW_MAX_LAG = Math.min(OUT_W, OUT_H) * (IS_MOBILE ? 0.24 : 0.30)
  const STARTUP_FRAMES = Math.round((IS_MOBILE ? 0.8 : 1.4) * fps)

  let camLng = points[0].lon
  let camLat = points[0].lat

  // Cache des sprites de panneaux localité (voir buildLocSignSprite) : une entrée par nom+style,
  // réutilisée pour toutes les images du film.
  const locSignCache: LocSignCache = new Map()

  function easeQuad(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t }


  // ── Randonneurs 3D (même mise en scène que l'aperçu, cf. TrackMap.tsx) ──────────────────────
  // Taille : l'aperçu est calibré pour ~720 px de haut ; le film les agrandit d'autant (1080p -> ×1,5).
  const FILM_SCALE = OUT_H / 720
  const dtF = 1 / fps
  // Décalages du duo en taille de marche (×échelle à l'affichage) : côte à côte, ou en file pendant la marche.
  const hkOffs = hikers.length > 1 ? [{ x: -HIKER3D_PAIR_PX, y: 0 }, { x: HIKER3D_PAIR_PX, y: 0 }] : [{ x: 0, y: 0 }]
  let hkFollow: { x: number; y: number } | null = null // second du duo en file (px film, relatif au premier)
  const hkDir = { x: 1, y: 0 }                          // cap lissé commun (vecteur écran unitaire)
  let hkSpeedPx = 0                                     // avancement à l'écran pendant la marche (px film / s)
  let hkMergeWas = false                                // mise en file du second en cours à l'image précédente
  /** Taille des panneaux couchés au zoom affiché : celle des personnages (1 pendant la course). */
  const signScale = () => hiker3dScaleForZoom(exportMap.getZoom(), zoom)
  const startTimeText = startClock(opts.startTime, opts.startTimePlanned ?? true, opts.points[0]?.time)
  /** Écart (px, taille de marche) entre le nom du lieu de départ et le haut de la pastille d'heure en dessous. */
  const START_TIME_DY = 16
  /** Scène de départ : le panneau de départ est au premier plan, décalé vers le bas devant les personnages. */
  const signY = (ev: unknown, y: number, scale: number) =>
    ev === departureEvent ? y + START_SIGN_OFFSET_PX * scale * FILM_SCALE : y
  /** Ouverture et dézoom du départ : panneau de départ et panneaux déjà visibles au début de la course (repère tout
   * proche du départ, ex. « Porte de Paris »). */
  function drawStartSigns(timeAlpha = 0) {
    const startEvents = [...localityEvents.filter(e => e.showFrame === 0), ...(departureEvent ? [departureEvent] : [])]
    for (const ev of startEvents) {
      const pt = exportMap.project([ev.lon, ev.lat])
      if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200)
        drawLocSign(ctx, locSignCache, ev.name, pt.x, signY(ev, pt.y, signScale()), ev.style, ev.ele, 1, signScale())
    }
    // Heure de départ, sous le repère le plus proche du départ (ex. « Porte de Paris »), sinon sous le panneau de départ.
    const landmarks = localityEvents.filter(e => e.showFrame === 0)
    if (startTimeText && timeAlpha > 0 && startEvents.length) {
      const d2 = (ev: LocalityEvent) => (ev.lon - points[0].lon) ** 2 + (ev.lat - points[0].lat) ** 2
      const ev = landmarks.length ? landmarks.reduce((a, b) => (d2(b) < d2(a) ? b : a)) : departureEvent!
      const pt = exportMap.project([ev.lon, ev.lat])
      const s = signScale()
      drawStartTimePill(ctx, startTimeText, pt.x, signY(ev, pt.y, s) + START_TIME_DY * s, 20 * s, timeAlpha)
    }
  }
  /** Bornes et ravitaillements (cf. drawBorneLayer), à leur point lon/lat. */
  function drawBornes(project: (lon: number, lat: number) => { x: number; y: number }, scale: number, alpha = 1, coveredM = Infinity, overview = false) {
    drawBorneLayer(ctx, locSignCache, opts.bornes ?? [], opts.ravitos ?? [], it => project(it.lon, it.lat), scale, alpha, coveredM, overview)
  }
  const lngLatAtM = (m: number) => lngLatAtProgress(visualPoints, distances, totalDistance, Math.max(0, Math.min(1, m / totalDistance)))
  /** Avance les personnages d'une image et les dessine, pieds en (x, y). `scale` : 1 = taille de marche. */
  function drawHikers3d(x: number, y: number, scale: number, alpha = 1) {
    const s = scale * FILM_SCALE * HIKER3D_BODY_SCALE
    const targets = hikers.length === 1 ? [{ x: 0, y: 0 }]
      : hkFollow ? [{ x: 0, y: 0 }, { x: hkFollow.x / s, y: hkFollow.y / s }]
      : [{ x: -HIKER3D_PAIR_PX, y: 0 }, { x: HIKER3D_PAIR_PX, y: 0 }]
    const items = hikers.map((h, i) => {
      const o = hkOffs[i]
      // Mise en file au départ : plus lente, et le second y marche en biais (orienté selon son déplacement, cadence
      // sur sa propre vitesse) au lieu de glisser vers le chemin.
      const intoFile = i === 1 && !!hkFollow
      const a = 1 - Math.exp(-dtF / (intoFile ? HIKER3D_MERGE_TAU_S : 0.4))
      const ox = o.x, oy = o.y
      o.x += (targets[i].x - o.x) * a
      o.y += (targets[i].y - o.y) * a
      if (intoFile && hkSpeedPx > 0) {
        if (Math.hypot(targets[i].x - o.x, targets[i].y - o.y) > 2) {
          const vx = hkDir.x * hkSpeedPx + ((o.x - ox) * s) / dtF, vy = hkDir.y * hkSpeedPx + ((o.y - oy) * s) / dtF
          h.turnTo(vx, vy)
          h.setGroundSpeed(Math.hypot(vx, vy) / Math.max(1, h.layout().body * FILM_SCALE))
          hkMergeWas = true
        } else if (hkMergeWas) { hkMergeWas = false; h.turnTo(hkDir.x, hkDir.y) }
      }
      h.renderFrame(dtF)
      return { h, x: x + o.x * s, y: y + o.y * s }
    }).sort((p, q) => p.y - q.y) // le plus bas à l'écran passe devant
    if (alpha <= 0) return
    ctx.save()
    ctx.globalAlpha = Math.min(1, alpha)
    for (const it of items) {
      const { w, h, feet } = it.h.layout()
      ctx.drawImage(it.h.element, it.x - (w * s) / 2, it.y - (h - feet) * s, w * s, h * s)
    }
    ctx.restore()
  }
  /** Marche : cap filtré (visée loin devant, lissage, cf. hiker3dSprite.setDirection) et second du duo en file,
   * à une vraie distance à l'écran même dans les lacets. */
  function steerHikers3d(project: ProjectFn, coveredM: number, here: { x: number; y: number }, lat: number) {
    // Zoom réellement affiché pendant la marche : celui de la mosaïque (arrondi au niveau entier) s'il y en a une.
    const mpp = metersPerPixel(lat, mapMosaic ? mapMosaic.zoom : zoom)
    // Anti-patinage : vitesse d'avancement à cet endroit (ralentie dans les virages), convertie en hauteurs de corps
    // par seconde à l'écran -> cadence des pas (cf. hiker3dSprite.setGroundSpeed).
    const bodyPx = Math.max(1, hikers[0].layout().body * FILM_SCALE)
    hkSpeedPx = nominalMps * (pacing ? pacing.factorAt(coveredM) : 1) / mpp
    // Hors des lacets, le ruban accélère mais les pas gardent leur allure.
    const stepPx = hkSpeedPx * (pacing ? pacing.stepScaleAt(coveredM) : 1)
    hikers.forEach(h => h.setGroundSpeed(stepPx / bodyPx))
    hikers.forEach(h => h.setProgress(coveredM / totalDistance)) // allure selon la distance parcourue (coureurs)
    // Cap : celui du chemin à l'endroit où se trouve chaque personnage (virages et lacets suivis).
    const d = headingToScreen(pacing ? pacing.headingAt(coveredM) : 0)
    hkDir.x = d.x; hkDir.y = d.y
    hikers[0].setDirection(d.x, d.y)
    hkFollow = null
    if (hikers.length > 1 && coveredM > 1) {
      const gapPx = HIKER3D_FOLLOW_PX * FILM_SCALE
      let bM = Math.max(0, coveredM - gapPx * mpp)
      let bp = project(...lngLatAtM(bM))
      for (let k = 0; k < 24 && bM > 0 && Math.hypot(bp.x - here.x, bp.y - here.y) < gapPx; k++) {
        bM = Math.max(0, bM - gapPx * mpp * 0.25)
        bp = project(...lngLatAtM(bM))
      }
      hkFollow = { x: bp.x - here.x, y: bp.y - here.y }
      // Le second suit le chemin là où il est (il prend le virage après le premier).
      const d2 = headingToScreen(pacing ? pacing.headingAt(bM) : 0)
      hikers[1].setDirection(d2.x, d2.y)
    } else if (hikers.length > 1) hikers[1].setDirection(d.x, d.y)
  }

  // On ATTEND vraiment la fin du préchargement (toutes zones, tous zooms, fonds de repli inclus)
  // avant de lancer la capture : la boucle tourne ensuite entièrement sur le cache HTTP, sans
  // requête réseau concurrente ni image floue. Cap de sécurité à 120s pour ne pas bloquer si le
  // serveur de tuiles est en rade ; le timeout par image de waitForMapIdle reste le dernier filet.
  let prefetchFinished = false
  tilePrefetchDone.then(() => { prefetchFinished = true })
  const abortWait = new Promise<void>(resolve => {
    if (signal?.aborted) { resolve(); return }
    signal?.addEventListener('abort', () => resolve(), { once: true })
  })
  await Promise.race([tilePrefetchDone, new Promise(r => setTimeout(r, 120_000)), abortWait])
  tilePrefetchAbort.abort()
  console.log(`[film2d] préchargement ${prefetchFinished ? 'terminé' : 'INTERROMPU (cap 120s atteint)'} ; encodeur=${useWC ? (useQP ? `WebCodecs QP ${VIDEO_QP}, plafond ${QP_CAP_BPS / 1e6}Mb/s` : `WebCodecs VBR ${bitrate / 1e6}Mb/s`) : `MediaRecorder ${mrMime}`}`)
  if (signal?.aborted) { exportMap.remove(); mapContainer.remove(); return new Blob() }

  // Mosaïque pré-composée du fond de carte pour le plan de marche (voir filmMapMosaic.ts) : les
  // tuiles nécessaires sont déjà en cache HTTP grâce au préchargement ci-dessus, donc ce
  // chargement/décodage est rapide. `null` (tracé trop long) -> repli sur le rendu MapLibre
  // existant, comme avant cette optimisation.
  const mapMosaic = await buildMapMosaic(prefetchPoints, zoom, FILM_TILE_RADIUS, 8192, signal)
  if (signal?.aborted) { exportMap.remove(); mapContainer.remove(); return new Blob() }
  console.log(`[film2d] mosaïque fond de carte : ${mapMosaic ? `${mapMosaic.canvas.width}×${mapMosaic.canvas.height}px (zoom ${mapMosaic.zoom})` : 'indisponible (tracé trop long ?), repli MapLibre'}`)

  // debugMaxFrames : écran-titre sauté (on veut voir la carte/les panneaux tout de suite, pas le
  // voile noir), et les timestamps de la boucle de marche ne tiennent plus compte de sa durée.
  const introFrames = opts.debugMaxFrames ? 0 : INTRO_FRAMES
  // Images avant la marche : écran-titre + dézoom de départ des randonneurs 3D.
  const preWalkFrames = introFrames + START_DEZOOM_FRAMES
  // Progression remontée à l'appelant, pondérée par coût réel par image et non par nombre brut
  // d'images. La mosaïque (marche) dessine une image quasi instantanément (voir filmMapMosaic.ts),
  // mais chaque image attend désormais l'encodeur (voir encodeFrame) : ~15-20 ms en 1080p, le même
  // coût que l'écran-titre (carte figée). Poids 0,15 tant que l'encodage n'était pas attendu : la
  // barre finissait alors sur un long « Finalisation… » (rattrapage de l'encodeur).
  const WALK_FRAME_WEIGHT = 1
  const grandTotal = preWalkFrames + totalFrames * WALK_FRAME_WEIGHT + END_HOLD_FRAMES + EASE_OV + HOLD_OV
  // Progression remontée à l'appelant sur le reste du budget, après la part réservée au
  // préchargement des tuiles (voir PREFETCH_PROGRESS_BUDGET plus haut).
  const frameProgress = (weightedFi: number) => PREFETCH_PROGRESS_BUDGET + (1 - PREFETCH_PROGRESS_BUDGET) * (weightedFi / grandTotal)
  // ── Écran-titre d'ouverture : carte figée sur le départ, voile noir + titre par-dessus ────
  // Randonneurs 3D : plan serré sur eux (en attente, face à nous) ; ils commencent à se lever quand le voile se lève.
  const closeZoom = zoom + HIKER3D_CLOSE_ZOOM
  // Plan serré du départ : coureuse en grand, entièrement visible (corps = FILM_START_BODY de la hauteur de
  // l'image), pieds en bas à gauche (FILM_START_FEET, en part de l'image) ; elle revient en douceur au centre et à sa
  // taille de course pendant le dézoom (part `frac` du plan serré).
  const FILM_START_BODY = START_PRESENT.body // même place que la présentation de l'aperçu
  const FILM_START_FEET = { x: START_PRESENT.feetX, y: START_PRESENT.feetY }
  const startFrac = (z: number) => Math.max(0, Math.min(1, (z - zoom) / HIKER3D_CLOSE_ZOOM))
  const body1 = hikers[0] ? hikers[0].layout().body : 98 // ≈ taille du corps à l'échelle 1 (hiker3dSprite : H × 0,53)
  const closeScale = (OUT_H * FILM_START_BODY) / (body1 * FILM_SCALE * HIKER3D_BODY_SCALE)
  const startScale = (z: number) => {
    const f = startFrac(z)
    return hiker3dScaleForZoom(z, zoom) * (1 - f) + closeScale * f
  }
  /** Caméra du départ au zoom z : au plan serré, le point de départ (pieds) est placé en FILM_START_FEET. */
  const jumpToStart = (z: number) => {
    const start: [number, number] = [points[0].lon, points[0].lat]
    exportMap.jumpTo({ center: start, zoom: z })
    const f = hikers3d ? startFrac(z) : 0
    if (f > 0) {
      const ps = exportMap.project(start)
      const dx = (0.5 - FILM_START_FEET.x) * OUT_W * f, dy = (0.5 - FILM_START_FEET.y) * OUT_H * f
      exportMap.jumpTo({ center: exportMap.unproject([ps.x + dx, ps.y + dy]), zoom: z })
    }
  }
  jumpToStart(hikers3d && introFrames ? closeZoom : zoom)
  await waitForMapIdle(exportMap, signal)
  if (hikers3d) hikers.forEach(h => h.resetToStart())
  const standUpFrame = Math.round(TITLE_IN_S * fps)
  for (let fi = 0; fi < introFrames && !signal?.aborted; fi++) {
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
    catch { ctx.fillStyle = BASEMAP_BACKGROUND; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 0)
    // Heure de départ : affichée START_CLOCK_SHOW_S après la levée du voile, puis effacée avant le départ.
    const clockOffS = TITLE_IN_S + SCENE_REVEAL_S + START_CLOCK_SHOW_S
    drawStartSigns(Math.max(0, Math.min(1, (clockOffS + START_CLOCK_FADE_S - fi / fps) / START_CLOCK_FADE_S)))
    if (hikers3d) {
      if (fi === standUpFrame) hikers.forEach(h => h.startIntro())
      const p0 = exportMap.project([points[0].lon, points[0].lat])
      drawHikers3d(p0.x, p0.y, startScale(closeZoom))
    }
    drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 0)
    drawElevOverlay(ctx, OUT_W, OUT_H, {
      points, distances, progress: 0, distanceCovered: 0, totalDistance: shownM,
      elevGain: opts.elevGain, elevLoss: opts.elevLoss,
      currentEle: currentElevation(points, distances, 0), trackName: '', ...timeAt(0),
    })
    drawOpening(fi / fps)
    drawMapCredit(ctx, OUT_W, OUT_H) // « © IGN » sur chaque image, par-dessus tout l'habillage
    if (useWC && encoder) {
      try {
        await encodeFrame(fi, false)
      } catch (e) { console.error('[film] VideoFrame intro:', e) }
      if (fi % 30 === 0) await new Promise(r => setTimeout(r, 0))
    } else if (mrTrack) {
      mrTrack.requestFrame?.()
      await new Promise(r => setTimeout(r, msPerFrame))
    }
    onProgress?.(frameProgress(fi))
  }

  // ── Randonneurs 3D : dézoom de départ, ils pivotent vers le chemin (la marche ne part qu'ensuite) ──
  if (START_DEZOOM_FRAMES > 0 && !signal?.aborted) {
    const d0 = headingToScreen(pacing ? pacing.headingAt(0) : 0)
    hkDir.x = d0.x; hkDir.y = d0.y
    hikers.forEach(h => h.turnTo(d0.x, d0.y))
  }
  for (let k = 0; k < START_DEZOOM_FRAMES && !signal?.aborted; k++) {
    const fi = introFrames + k
    const z = closeZoom - HIKER3D_CLOSE_ZOOM * smoothEase((k + 1) / START_DEZOOM_FRAMES)
    jumpToStart(z)
    await waitForMapIdle(exportMap, signal)
    if (signal?.aborted) break
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
    catch { ctx.fillStyle = BASEMAP_BACKGROUND; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 0)
    drawStartSigns() // heure de départ déjà effacée pendant le maintien sur le plan serré
    const p0 = exportMap.project([points[0].lon, points[0].lat])
    drawHikers3d(p0.x, p0.y, startScale(z))
    drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 0)
    drawElevOverlay(ctx, OUT_W, OUT_H, {
      points, distances, progress: 0, distanceCovered: 0, totalDistance: shownM,
      elevGain: opts.elevGain, elevLoss: opts.elevLoss,
      currentEle: currentElevation(points, distances, 0), trackName: '', ...timeAt(0),
    })
    drawMapCredit(ctx, OUT_W, OUT_H)
    if (useWC && encoder) {
      try { await encodeFrame(fi, false) } catch (e) { console.error('[film] VideoFrame dézoom départ:', e) }
      if (k % 30 === 0) await new Promise(r => setTimeout(r, 0))
    } else if (mrTrack) {
      mrTrack.requestFrame?.()
      await new Promise(r => setTimeout(r, msPerFrame))
    }
    onProgress?.(frameProgress(fi))
  }

  for (let f = 0; f <= renderFrames; f++) {
    if (signal?.aborted) break

    const progress = walkWarp ? walkWarp.mAtTime(f / fps) / totalDistance : f / totalFrames
    const [lng, lat] = lngLatAtProgress(cameraPoints, distances, totalDistance, progress)

    // Suivi continu : lissage exponentiel de la caméra vers le randonneur. Avec la mosaïque, la
    // projection est une fonction pure du centre caméra : pas besoin de jumpTo pour "interroger"
    // une position avant d'avoir mis à jour camLng/camLat (contrairement à MapLibre).
    if (!mapMosaic) exportMap.jumpTo({ center: [camLng, camLat], zoom })
    const px = mapMosaic
      ? projectToScreen(lng, lat, camLng, camLat, mapMosaic.zoom, OUT_W, OUT_H)
      : exportMap.project([lng, lat])
    const lagPx = Math.hypot(px.x - OUT_W / 2, px.y - OUT_H / 2)
    // Proximité continue à la zone du cartel d'altitude (1 = dedans, 0 = à AVOID_PAD ou plus,
    // rampe linéaire entre les deux). Un seuil net ici (marqueur qui oscille pile à la frontière
    // de la zone, à cause du bruit résiduel du suivi lui-même) peut faire sauter le gain k d'un
    // coup à chaque image, et entretenir une oscillation de la caméra — donc de tout ce qui est
    // projeté avec elle (fond de carte, ruban, panneaux). Une rampe continue supprime ce à-coup.
    const padX = Math.max(elevRect.x - px.x, px.x - (elevRect.x + elevRect.w), 0)
    const padY = Math.max(elevRect.y - MARKER_H - px.y, px.y - (elevRect.y + elevRect.h), 0)
    const elevFactor = Math.max(0, Math.min(1, 1 - Math.max(padX, padY) / AVOID_PAD))
    // Gain de suivi : monte doucement au démarrage (caméra immobile sur le départ), se resserre
    // si le randonneur s'éloigne trop du centre (il ne sortira jamais du cadre) ou entre dans la
    // zone du cartel d'altitude.
    let k = FOLLOW_K * Math.min(1, f / Math.max(1, STARTUP_FRAMES))
    if (lagPx > FOLLOW_MAX_LAG) k = Math.min(0.5, k * (lagPx / FOLLOW_MAX_LAG))
    if (elevFactor > 0) k = Math.max(k, k + (0.12 - k) * elevFactor)
    camLng += (lng - camLng) * k
    camLat += (lat - camLat) * k

    // 1. Fond de carte : recadrage pur de la mosaïque pré-composée (aucun rendu GPU par image,
    // voir filmMapMosaic.ts), ou repli sur le rendu MapLibre habituel si elle est indisponible.
    const project: ProjectFn = mapMosaic
      ? (lon, lat) => projectToScreen(lon, lat, camLng, camLat, mapMosaic.zoom, OUT_W, OUT_H)
      : (lon, lat) => exportMap.project([lon, lat])
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    if (mapMosaic) {
      const origin = mosaicCropOrigin(mapMosaic, camLng, camLat, OUT_W, OUT_H)
      try { ctx.drawImage(mapMosaic.canvas, origin.x, origin.y, OUT_W, OUT_H, 0, 0, OUT_W, OUT_H) }
      catch { ctx.fillStyle = BASEMAP_BACKGROUND; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    } else {
      // Appliquer la position finale de la caméra, attendre que ses tuiles soient chargées (pas
      // seulement qu'une frame ait été peinte) pour éviter de capturer le fond beige par défaut.
      exportMap.jumpTo({ center: [camLng, camLat], zoom })
      await waitForMapIdle(exportMap, signal)
      if (signal?.aborted) break
      try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
      catch { ctx.fillStyle = BASEMAP_BACKGROUND; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    }

    // 2. Tracé GPX (projeté de manière synchrone) : le ruban s'arrête juste derrière la coureuse (RIBBON_LAG_PX).
    const lagM = hikers3d && progress < 1
      ? RIBBON_LAG_PX * FILM_SCALE * metersPerPixel(points[0].lat, mapMosaic ? mapMosaic.zoom : zoom) : 0
    drawTrack(ctx, project, visualPoints, distances, totalDistance, Math.max(0, progress - lagM / totalDistance))
    drawBornes(project, 1, 1, progress * totalDistance) // bornes approchées, au sol sous les panneaux
    // Rue empruntée : son nom en haut de l'écran pendant que la coureuse y court, les rues se succédant en fondu.
    streetCaption.update(progress, 1 / fps)
    streetCaption.draw(ctx, OUT_W / 2)

    // 3. Panneaux localités
    // Évite la collision visuelle avec le randonneur : un panneau de lieu-dit qui se déclenche
    // pile au moment où le personnage passe devant (ex. hameau proche du tracé) le recouvrait
    // presque entièrement, ne laissant dépasser qu'un éclat de couleur au-dessus de sa tête.
    // Ne s'applique qu'aux panneaux transitoires (hideFrame fini) : les panneaux de départ/arrivée
    // doivent au contraire rester visibles même quand le randonneur les rejoint.
    for (const ev of [...localityEvents, ...(departureEvent ? [departureEvent] : []), ...(arrivalEvent ? [arrivalEvent] : [])]) {
      const signA = signAlpha(f, ev.showFrame, ev.hideFrame, SIGN_FADE_FRAMES)
      if (signA <= 0) continue
      const pt = project(ev.lon, ev.lat)
      // (Plus de masquage du panneau quand le randonneur passe devant : il reste affiché.)
      if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200) {
        drawLocSign(ctx, locSignCache, ev.name, pt.x, signY(ev, pt.y, 1), ev.style, ev.ele, signA)
      }
    }

    // 4. Randonneurs 3D : jusqu'au bout du tracé (le salut se fait au panneau d'arrivée, comme l'aperçu).
    if (hikers3d) {
      if (f === 0) hikers.forEach(h => h.setPlaying(true))
      const [lngPos, latPos] = lngLatAtProgress(visualPoints, distances, totalDistance, progress)
      const mk = project(lngPos, latPos)
      steerHikers3d(project, progress * totalDistance, mk, latPos)
      drawHikers3d(mk.x, mk.y, 1)
    }

    drawWeatherCard(ctx, OUT_W, opts.weather ?? null, progress)
    drawElevOverlay(ctx, OUT_W, OUT_H, {
      points, distances, progress,
      distanceCovered: Math.min(progress * totalDistance, shownM), totalDistance: shownM,
      elevGain: opts.elevGain, elevLoss: opts.elevLoss,
      currentEle: currentElevation(points, distances, progress),
      trackName: '', ...timeAt(progress),
    })

    // Fin de la levée du voile noir de l'ouverture : elle déborde de RIBBON_EARLY_S sur le
    // début de la marche (le ruban part avant que le noir ait fini de se lever). Sautée en
    // debugMaxFrames (introFrames = 0 -> le voile est déjà entièrement levé dès la 1ère image).
    if (!opts.debugMaxFrames) drawOpening((introFrames + f) / fps)

    drawMapCredit(ctx, OUT_W, OUT_H) // « © IGN » sur chaque image, par-dessus tout l'habillage
    if (useWC && encoder) {
      try {
        await encodeFrame(preWalkFrames + f, f === 0)
      } catch (e) { console.error('[film] VideoFrame:', e) }
      if (f % 30 === 0) await new Promise(r => setTimeout(r, 0))
    } else if (mrTrack) {
      mrTrack.requestFrame?.()
      await new Promise(r => setTimeout(r, msPerFrame))
    }

    onProgress?.(frameProgress(preWalkFrames + f * WALK_FRAME_WEIGHT))
  }

  console.log(`[film2d] boucle principale : ${_idleStats.calls} attentes tuiles, ${_idleStats.timeouts} en timeout 6s (= tuiles jamais chargées -> flou), pire attente ${Math.round(_idleStats.worstMs)}ms`)

  // ── Plan de fin, phase 1 : le randonneur reste FIGÉ juste avant le panneau d'arrivée
  //    (le temps de lire le panneau), caméra immobile sur le plan rapproché. ──────────────
  // Randonneurs 3D : ils vont jusqu'au bout du tracé ; caméra qui se resserre sur eux pendant END_ZOOM_FRAMES.
  const [endLng, endLat] = lngLatAtProgress(visualPoints, distances, totalDistance, 1)
  const endCamLng = camLng, endCamLat = camLat
  const endCam = (f: number) => {
    if (!hikers3d) return { lng: endCamLng, lat: endCamLat, z: zoom }
    const t = smoothEase(Math.min(1, (f + 1) / Math.max(1, END_ZOOM_FRAMES)))
    return { lng: endCamLng + (endLng - endCamLng) * t, lat: endCamLat + (endLat - endCamLat) * t, z: zoom + HIKER3D_CLOSE_ZOOM * t }
  }
  if (!signal?.aborted && renderFrames === totalFrames) {
    exportMap.jumpTo({ center: [camLng, camLat], zoom })
    await waitForMapIdle(exportMap, signal)
    if (hikers3d) {
      hkFollow = null // côte à côte à l'arrivée
      hikers.forEach(h => h.turnTo(0, 1)) // tournés vers nous dès l'arrivée, avant le zoom et le salut
    }

    for (let f = 0; f < END_HOLD_FRAMES && !signal?.aborted; f++) {
      const fi = preWalkFrames + renderFrames + f
      const cam = endCam(f)
      exportMap.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.z })
      if (hikers3d && f <= END_ZOOM_FRAMES) { await waitForMapIdle(exportMap, signal); if (signal?.aborted) break }
      // Geste d'arrivée à HIKER3D_OUTRO_AT du zoom (comme l'aperçu) : dès la ligne franchie en course.
      if (hikers3d && f === Math.round(END_ZOOM_FRAMES * HIKER3D_OUTRO_AT)) hikers.forEach(h => h.startOutro())

      ctx.clearRect(0, 0, OUT_W, OUT_H)
      try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
      catch { ctx.fillStyle = BASEMAP_BACKGROUND; ctx.fillRect(0, 0, OUT_W, OUT_H) }

      drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 1)
      drawBornes((lon, lat) => exportMap.project([lon, lat]), signScale())

      for (const ev of [...localityEvents, ...(departureEvent ? [departureEvent] : []), ...(arrivalEvent ? [arrivalEvent] : [])]) {
        const pt = exportMap.project([ev.lon, ev.lat])
        if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200)
          drawLocSign(ctx, locSignCache, ev.name, pt.x, signY(ev, pt.y, signScale()), ev.style, ev.ele, 1, signScale())
      }

      drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 1)
      drawElevOverlay(ctx, OUT_W, OUT_H, {
        points, distances, progress: 1,
        distanceCovered: shownM, totalDistance: shownM,
        elevGain: opts.elevGain, elevLoss: opts.elevLoss,
        currentEle: currentElevation(points, distances, 1), trackName: '', ...timeAt(1),
      })

      // Randonneurs 3D à l'arrivée : ils saluent, passent devant le panneau d'arrivée (comme l'aperçu).
      if (hikers3d) {
        const mkPt = exportMap.project([endLng, endLat])
        drawHikers3d(mkPt.x, mkPt.y, hiker3dScaleForZoom(cam.z, zoom))
      }

      drawMapCredit(ctx, OUT_W, OUT_H) // « © IGN » sur chaque image, par-dessus tout l'habillage
      if (useWC && encoder) {
        try {
          await encodeFrame(fi, f === 0)
        } catch (e) { console.error('[film] VideoFrame fin randonneur:', e) }
        if (f % 30 === 0) await new Promise(r => setTimeout(r, 0))
      } else if (mrTrack) {
        mrTrack.requestFrame?.()
        await new Promise(r => setTimeout(r, msPerFrame))
      }
      onProgress?.(frameProgress(fi))
    }
  }

  // ── Vue finale (Overview) ──────────────────────────────────────────────────
  if (!signal?.aborted && renderFrames === totalFrames) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const pt of points) {
      if (pt.lon < minLng) minLng = pt.lon
      if (pt.lon > maxLng) maxLng = pt.lon
      if (pt.lat < minLat) minLat = pt.lat
      if (pt.lat > maxLat) maxLat = pt.lat
    }
    const overviewLng = (minLng + maxLng) / 2
    const overviewLat = (minLat + maxLat) / 2

    let overviewZoom = zoom
    for (let z = zoom; z >= 1; z -= 0.25) {
      exportMap.jumpTo({ center: [overviewLng, overviewLat], zoom: z })
      const p1 = exportMap.project([minLng, minLat])
      const p2 = exportMap.project([maxLng, maxLat])
      if (Math.abs(p2.x - p1.x) < OUT_W * 0.80 && Math.abs(p2.y - p1.y) < OUT_H * 0.80) {
        overviewZoom = z; break
      }
    }

    // (Le dézoom final ne fait plus de préchargement dédié : la vue d'ensemble et tous les niveaux
    // de zoom traversés par le recul de caméra sont déjà couverts par le préchargement initial.)
    exportMap.jumpTo({ center: [overviewLng, overviewLat], zoom: overviewZoom })
    await waitForMapIdle(exportMap, signal)

    // Randonneurs 3D : la vue d'ensemble part du plan serré sur l'arrivée (fin du salut).
    const startLng = hikers3d ? endLng : camLng, startLat = hikers3d ? endLat : camLat
    const startZoom = hikers3d ? zoom + HIKER3D_CLOSE_ZOOM : zoom

    // Watermark de fin : apparaît en fondu sur la dernière partie du plan d'ensemble, avec le
    // logo Sillon qui se dessine (comme dans l'en-tête de l'appli) juste avant le texte.
    // Couvre tout le plan d'ensemble final (HOLD_OV) pour rester affiché le plus longtemps
    // possible, plutôt que de n'apparaître que sur les 5 dernières secondes.
    const WATERMARK_FRAMES = HOLD_OV - Math.round(OVERVIEW_CLEAN_S * fps) // après la vue d'ensemble sans infos
    const WATERMARK_FADE_FRAMES = Math.round(0.5 * fps)

    for (let f = 0; f < EASE_OV + HOLD_OV; f++) {
      if (signal?.aborted) break
      const t  = Math.min(f / EASE_OV, 1)
      const te = hikers3d ? smoothEase(t) : easeQuad(t)
      const cLng  = startLng  + te * (overviewLng  - startLng)
      const cLat  = startLat  + te * (overviewLat  - startLat)
      const cZoom = startZoom + te * (overviewZoom - startZoom)
      // Décalé du plan rapproché figé (END_HOLD_FRAMES) inséré juste avant.
      const fi    = preWalkFrames + renderFrames + END_HOLD_FRAMES + f

      exportMap.jumpTo({ center: [cLng, cLat], zoom: cZoom })
      await waitForMapIdle(exportMap, signal)
      if (signal?.aborted) break

      ctx.clearRect(0, 0, OUT_W, OUT_H)
      try {
        ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H)
      } catch {
        ctx.fillStyle = BASEMAP_BACKGROUND; ctx.fillRect(0, 0, OUT_W, OUT_H)
      }

      drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 1)

      // Vue d'ensemble, alignée sur le film 3D : cols, départ et arrivée restent ; les localités
      // intermédiaires s'effacent en fondu pendant le premier tiers du dézoom (image finale allégée).
      const locFade = 1 - Math.min(1, f / Math.max(1, EASE_OV * 0.35))
      // Bornes : s'effacent avec les localités pendant le dézoom, puis reviennent agrandies (km et temps de passage
      // lisibles) après OVERVIEW_CLEAN_S de vue d'ensemble sans infos, en même temps que le carton du bas.
      const infoA = Math.max(0, Math.min(1, (f - EASE_OV - OVERVIEW_CLEAN_S * fps) / WATERMARK_FADE_FRAMES))
      if (f < EASE_OV) drawBornes((lon, lat) => exportMap.project([lon, lat]), signScale(), locFade)
      else drawBornes((lon, lat) => exportMap.project([lon, lat]), Math.max(signScale(), OVERVIEW_BORNE_SCALE), infoA, Infinity, true)
      for (const ev of [...localityEvents, ...(departureEvent ? [departureEvent] : []), ...(arrivalEvent ? [arrivalEvent] : [])]) {
        const isEndpoint = ev === departureEvent || ev === arrivalEvent
        const a = isEndpoint || ev.style === 'col' ? 1 : locFade
        if (a <= 0) continue
        const pt = exportMap.project([ev.lon, ev.lat])
        if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200) {
          ctx.save()
          ctx.globalAlpha = a
          drawLocSign(ctx, locSignCache, ev.name, pt.x, signY(ev, pt.y, signScale()), ev.style, ev.ele, 1, signScale())
          ctx.restore()
        }
      }

      drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 1)
      // Désormais en haut-gauche (plus petite, voir ELEV_OVERLAY_SCALE) : ne gêne plus la vue
      // d'ensemble, reste affichée jusqu'à la fin sans fondu de sortie.
      drawElevOverlay(ctx, OUT_W, OUT_H, {
        points, distances, progress: 1,
        distanceCovered: shownM, totalDistance: shownM,
        elevGain: opts.elevGain, elevLoss: opts.elevLoss,
        currentEle: currentElevation(points, distances, 1),
        trackName: '', ...timeAt(1),
      })

      // Randonneurs 3D : ils rapetissent avec le dézoom et s'effacent en même temps (comme l'aperçu).
      if (hikers3d && f < EASE_OV) {
        const mkPt = exportMap.project([endLng, endLat])
        drawHikers3d(mkPt.x, mkPt.y, hiker3dScaleForZoom(cZoom, zoom), 1 - t)
      }

      // Pas de fondu au noir : le film se termine sur l'image fixe de la vue d'ensemble.
      // Adresse : reste visible jusqu'à la toute dernière image.
      const framesFromEnd = (EASE_OV + HOLD_OV) - f
      if (framesFromEnd <= WATERMARK_FRAMES) {
        const intoWatermark = WATERMARK_FRAMES - framesFromEnd
        const a = Math.min(1, intoWatermark / WATERMARK_FADE_FRAMES)
        if (opts.endCard) drawEndCard(ctx, OUT_W, OUT_H, opts.endCard, a)
        else drawEndAddress(ctx, OUT_W, OUT_H, a)
      }

      drawMapCredit(ctx, OUT_W, OUT_H) // « © IGN » sur chaque image, par-dessus tout l'habillage
      if (useWC && encoder) {
        try {
          await encodeFrame(fi, f === 0)
        } catch (e) { console.error('[film] VideoFrame overview:', e) }
        if (f % 30 === 0) await new Promise(r => setTimeout(r, 0))
      } else if (mrTrack) {
        mrTrack.requestFrame?.()
        await new Promise(r => setTimeout(r, msPerFrame))
      }

      // fi (ci-dessus) sert au timestamp vidéo (temps réel) ; la progression, elle, doit compter
      // la marche à son poids réduit (voir WALK_FRAME_WEIGHT) comme grandTotal.
      onProgress?.(frameProgress(preWalkFrames + totalFrames * WALK_FRAME_WEIGHT + END_HOLD_FRAMES + f))
    }
  }

  // Nettoyage
  hikers.forEach(h => h.dispose())
  exportMap.remove()
  mapContainer.remove()

  // Rendu image par image terminé. Ce qui reste (vidage de l'encodeur, déjà à jour à 2 images
  // près, bande-son, mux, enregistrement) ne dure que quelques instants : on reste sur l'écran
  // « Création du film… » à 99 % plutôt que de basculer sur un écran « Finalisation… ».
  onProgress?.(0.99)

  if (useWC && encoder && muxer && !signal?.aborted) {
    await encoder.flush(); encoder.close()
    if (useQP) console.info(`[film2d] qualité constante QP ${VIDEO_QP}, QP max atteint ${rc.maxUsed} (plafond ${QP_CAP_BPS / 1e6} Mb/s)`)
    if (audioBuffer) {
      try { await encodeFilmAudio(audioBuffer, muxer, signal) }
      catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        console.warn('[film2d] encodage bande-son échoué (film livré muet) :', e)
      }
    }
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
