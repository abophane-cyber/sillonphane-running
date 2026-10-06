/**
 * Export vidéo — rendu WebGL MapLibre hors-écran + overlays 2D Canvas.
 * Synchronisé à 100% sur le comportement de la Preview (TrackMap + useAnimation).
 */

import maplibregl from 'maplibre-gl'
import type { GpxPoint } from '../types'
import { makeStyle } from '../components/TrackMap'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { drawElevOverlay, elevOverlayRect } from './drawElevOverlay'
import type { CharacterId } from './characters'
import { buildRouteTileUrls, buildBoundingBoxTileUrls, prefetchTiles } from './tilePrefetch'
import { buildFilmAudioTrack, encodeFilmAudio, filmAudioSupported, hasFilmAudio, MUXER_AUDIO_CONFIG, type FilmAudioSpec } from './filmAudio'
import { smoothTrackPoints } from './gpx'
import { createQpRateControl } from './qpRateControl'
import { encoderFailMessage, noteEncoderFrame, noteEncoderSetup, waitEncoderQueue } from './encoderWait'
import { buildMapMosaic, projectToScreen, mosaicCropOrigin, type MapMosaic } from './filmMapMosaic'
import type { Hiker3dSprite } from './hiker3dSprite'
import {
  HIKER3D_CLOSE_ZOOM, HIKER3D_END_ZOOM_MS, HIKER3D_START_DEZOOM_MS, HIKER3D_OVERVIEW_MS, HIKER3D_PAIR_PX,
  HIKER3D_FOLLOW_PX, HIKER3D_MERGE_TAU_S, HIKER3D_ENABLED, hiker3dScaleForZoom, smoothEase, metersPerPixel,
} from './hiker3dStaging'
import { getTrackPacing, headingToScreen } from './trackPacing'

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
  speedLevel?:       1 | 2 // niveau de vitesse de l'aperçu (×1 / ×2)
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
        i === 0 ? path.moveTo(pt.x, pt.y) : path.lineTo(pt.x, pt.y)
      }
      path.lineTo(tipPt.x, tipPt.y)
      return path
    }
    const path = buildPath()

    // Liseré sombre sous le dégradé (même traitement que TrackMap/track-done-halo) : sans lui,
    // la fin du dégradé (blanc cassé) devient quasi invisible sur un fond de carte clair.
    ctx.strokeStyle = 'rgba(20,30,20,0.55)'
    ctx.lineWidth   = 7
    ctx.globalAlpha = 1
    ctx.stroke(path)

    // Dégradé du symbole Sillon (vert → orangé → blanc cassé), même palette que TrackMap.
    const startPt = project(points[0].lon, points[0].lat)
    const grad = ctx.createLinearGradient(startPt.x, startPt.y, tipPt.x, tipPt.y)
    grad.addColorStop(0,   '#2F5C45')
    grad.addColorStop(0.5, '#D97A3D')
    grad.addColorStop(1,   '#F4EDE0')
    ctx.strokeStyle = grad
    ctx.lineWidth   = 4.5
    ctx.globalAlpha = 0.97
    ctx.stroke(path)
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

type SignStyle = 'standard' | 'lieudit' | 'col' | 'poi'

interface LocSignSprite { canvas: HTMLCanvasElement; offX: number; offY: number }
type LocSignCache = Map<string, LocSignSprite>

function buildLocSignSprite(name: string, style: SignStyle, ele?: number): LocSignSprite {
  const FONT_SIZE = 15
  const PAD_X = 12, PAD_Y = 6
  const BORDER = 3.5, RADIUS = 7
  const POLE_W = 6, POLE_H = 34
  const MARGIN = 16 // marge autour du sprite pour laisser respirer l'ombre portée (blur 8 + offsetY 3)

  const isLieudit = style === 'lieudit'
  const isCol     = style === 'col'
  const isPoi     = style === 'poi' // point d'intérêt : panneau touristique marron, liseré blanc

  const label     = isLieudit || isPoi ? name : name.toUpperCase()
  const fontStyle = isLieudit ? 'italic 800' : isPoi ? '700' : '800'
  const FONT      = `${fontStyle} ${FONT_SIZE}px 'Arial Narrow', Arial, sans-serif`
  const FONT2     = `600 10px 'Arial Narrow', Arial, sans-serif`

  const measureCtx = document.createElement('canvas').getContext('2d')!
  measureCtx.font = FONT
  const textW  = measureCtx.measureText(label).width
  const eleStr = isCol && ele != null ? `Alt. ${ele} m` : ''
  measureCtx.font = FONT2
  const eleW   = eleStr ? measureCtx.measureText(eleStr).width : 0
  const boardW = Math.max(textW, eleW) + PAD_X * 2
  const boardH = isCol && eleStr ? FONT_SIZE + 12 + PAD_Y * 2 : FONT_SIZE + PAD_Y * 2

  const canvas = document.createElement('canvas')
  canvas.width  = Math.ceil(boardW + BORDER * 2 + MARGIN * 2)
  canvas.height = Math.ceil(boardH + POLE_H + BORDER + MARGIN * 2)
  const ctx = canvas.getContext('2d')!

  // Point d'ancrage dans le sprite : centre horizontal (mât + pancarte), pied du mât en bas.
  const px = canvas.width / 2
  const py = canvas.height - MARGIN

  const poleX  = px - POLE_W / 2
  const poleY  = py - POLE_H
  const boardX = px - boardW / 2
  const boardY = poleY - boardH

  const bgColor     = isLieudit ? '#b84400' : isCol ? '#253d17' : isPoi ? '#5b3a1e' : '#fff'
  const textColor   = isLieudit || isCol || isPoi ? '#fff' : '#111'
  const borderColor = isLieudit || isCol || isPoi ? 'transparent' : '#c0000c'

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur  = 8; ctx.shadowOffsetY = 3

  const grad = ctx.createLinearGradient(poleX, 0, poleX + POLE_W, 0)
  grad.addColorStop(0, '#888'); grad.addColorStop(0.5, '#ddd'); grad.addColorStop(1, '#888')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.roundRect(poleX, poleY, POLE_W, POLE_H, [0, 0, 3, 3]); ctx.fill()

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
  const textY = isCol && eleStr ? boardY + PAD_Y + FONT_SIZE / 2 : boardY + boardH / 2
  ctx.fillText(label, px, textY)

  if (isCol && eleStr) {
    ctx.font = FONT2
    ctx.fillText(eleStr, px, boardY + boardH - PAD_Y - 5)
  }

  return { canvas, offX: px, offY: py }
}

function drawLocSign(
  ctx: CanvasRenderingContext2D,
  cache: LocSignCache,
  name: string,
  px: number, py: number,
  style: SignStyle = 'standard',
  ele?: number,
  alpha = 1,
) {
  if (alpha <= 0) return
  const key = `${style}|${name}|${ele ?? ''}`
  let sprite = cache.get(key)
  if (!sprite) { sprite = buildLocSignSprite(name, style, ele); cache.set(key, sprite) }
  if (alpha >= 1) {
    ctx.drawImage(sprite.canvas, px - sprite.offX, py - sprite.offY)
  } else {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.drawImage(sprite.canvas, px - sprite.offX, py - sprite.offY)
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

// ─── Watermark de fin ─────────────────────────────────────────────────────────
// Reprend le tracé du logo Sillonphane-Rando (AppLogoIcon.tsx) : même chemin, même dégradé,
// même animation (le trait se dessine puis les deux points apparaissent), rejouée ici image par
// image plutôt qu'en CSS puisqu'il s'agit d'une vidéo exportée en frames.
// Affiché à la fin, CENTRÉ, juste au-dessus du kilométrage : le logo se déroule en filigrane,
// puis « sillonphane.fr/rando » se révèle en balayage sous le logo (retirable à terme si l'appli
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

  // Bloc : logo (filigrane) au-dessus, « sillonphane.fr/rando » en dessous ; bord bas du texte = bottomY.
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

  // ── « sillonphane.fr/rando » : révélé par balayage gauche → droite (fenêtre de clip qui s'ouvre) ──
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
    const tw = ctx.measureText('sillonphane.fr/rando').width
    ctx.beginPath()
    ctx.rect(cx - tw / 2 - 2, textBaseY - textSize * 1.1, tw * textReveal + 4, textSize * 1.6)
    ctx.clip()
    ctx.fillText('sillonphane.fr/rando', cx, textBaseY)
    ctx.restore()
  }
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
  ctx.fillText('sillonphane.fr/rando', cw - cw * 0.03, barBottom - barH * 0.35)
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

export async function exportFilm(opts: FilmExportOptions): Promise<Blob> {
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
  const tileRadius = Math.max(1, Math.ceil(Math.max(OUT_W, OUT_H) / 2 / 256 * 1.6))
  // Niveaux de zoom à couvrir : de la lecture (zoom / zoom+1) jusqu'au plan d'ensemble final
  // (recul de caméra ≈ 4 crans plus bas). Aux crans bas, la bbox ne fait que quelques tuiles.
  // debugMaxFrames ne rend le plan d'ensemble QUE s'il excède la durée naturelle du tracé (sinon
  // renderFrames < totalFrames et ce plan est sauté, voir plus bas) — un tracé court/accéléré
  // (vitesse ×2, ANIM_SETTINGS) peut très bien tenir sous le plafond debug et enchaîner dessus.
  // Le confondre avec "jamais rendu" a fait louper le préchargement des zooms bas dans ce cas :
  // le plan d'ensemble allait alors chercher ses tuiles en direct, très lentement (surtout sans le
  // cache HTTP local déjà chaud d'une session de dev — invisible en local, très visible en prod).
  const totalFramesEstimate = Math.ceil(durationS * fps)
  const overviewWillRun = !opts.debugMaxFrames || opts.debugMaxFrames >= totalFramesEstimate
  const zHi = Math.ceil(zoom)
  const zLo = overviewWillRun ? Math.max(6, Math.floor(zoom) - 4) : Math.floor(zoom)
  const prefetchZooms: number[] = []
  for (let z = zLo; z <= zHi; z++) prefetchZooms.push(z)
  // Liste dédupliquée : couloir du tracé (zooms de lecture, rayon large) + rectangle englobant
  // complet à TOUS les niveaux de zoom, y compris ceux traversés par le dézoom final. Tout doit
  // être en cache AVANT la boucle : pendant la capture, une tuile non préchargée se charge en
  // direct, se fait throttler par le serveur, et MapLibre fige une tuile parente étirée -> voile
  // flou sur la vidéo.
  // Randonneurs 3D : plans serrés au départ et à l'arrivée (zoom de marche + HIKER3D_CLOSE_ZOOM) -> tuiles de ces
  // zooms autour des deux extrémités, en plus.
  // « Ruban seul » (aucun personnage choisi), ou appareil sans WebGL2 : aucun randonneur dans le film.
  const noCharacter = !!opts.debugSkipCharacter || opts.characters.length === 0
  const want3d = !noCharacter && HIKER3D_ENABLED
  const closeZooms: number[] = []
  if (want3d) for (let z = Math.ceil(zoom) + 1; z <= Math.ceil(zoom + HIKER3D_CLOSE_ZOOM); z++) closeZooms.push(z)
  const prefetchUrls = [...new Set([
    ...buildRouteTileUrls(prefetchPoints, [Math.floor(zoom), Math.ceil(zoom)], tileRadius),
    ...buildBoundingBoxTileUrls(prefetchPoints, prefetchZooms, OUT_W / OUT_H),
    ...(closeZooms.length ? buildRouteTileUrls([points[0], points[points.length - 1]], closeZooms, tileRadius) : []),
  ])]
  _idleStats.calls = 0; _idleStats.timeouts = 0; _idleStats.worstMs = 0
  console.log(`[film2d] ${prefetchUrls.length} tuiles à précharger (zoom ${zoom}, zooms ${prefetchZooms.join(',')})`)
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
      hikers = opts.characters.slice(0, 2).map(id => createHiker3dSprite(id, { manual: true }))
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
  const H3_START_HOLD_S = 1
  // Allure (comme l'aperçu) : cap du chemin, et marche ralentie dans les virages pour des pivots en douceur -> la
  // marche dure walkS au lieu de durationS, et la distance parcourue n'est plus proportionnelle au temps.
  const pacing = hikers3d ? getTrackPacing(visualPoints, distances) : null
  const nominalMps = totalDistance / durationS
  pacing?.setNominalSpeed(nominalMps)
  const walkWarp = pacing ? pacing.timeWarp() : null
  const walkS = walkWarp ? walkWarp.totalS : durationS
  const H3_OUTRO_S = hikers3d ? Math.max(...hikers.map(h => h.outroDurationS())) : 0
  const H3_END_HOLD_S = Math.max(0.5, (HIKER3D_END_ZOOM_MS / 1000) * 0.6 + H3_OUTRO_S + 0.3 - HIKER3D_END_ZOOM_MS / 1000)
  const filmDurationS = hikers3d
    ? walkS + (4 + 1.6 + H3_START_HOLD_S + HIKER3D_START_DEZOOM_MS / 1000)
      + (HIKER3D_END_ZOOM_MS / 1000 + H3_END_HOLD_S + HIKER3D_OVERVIEW_MS / 1000 + 5)
    : durationS + (4 + 1.6 - 0.5) + (1.5 + 5)
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
    const style: SignStyle = loc.type === 'col' ? 'col' : loc.placeType === 'poi' ? 'poi' : (loc.placeType === 'hamlet' || loc.placeType === 'locality') ? 'lieudit' : 'standard'
    return { name: loc.name, lon: loc.lon, lat: loc.lat, style, ele: loc.ele, showFrame, hideFrame: arriveFrame + SIGN_STAY_FRAMES, arriveFrame }
  })

  const departureEvent: LocalityEvent | null = opts.startName ? { name: opts.startName, lon: points[0].lon, lat: points[0].lat, style: opts.startColEle != null ? 'col' : opts.startLieudit ? 'lieudit' : 'standard', ele: opts.startColEle, showFrame: 0, hideFrame: Infinity, arriveFrame: 0 } : null
  const arrivalEvent: LocalityEvent | null   = opts.endName   ? { name: opts.endName,   lon: points[points.length - 1].lon, lat: points[points.length - 1].lat, style: opts.endColEle != null ? 'col' : opts.endLieudit ? 'lieudit' : 'standard', ele: opts.endColEle, showFrame: 0, hideFrame: Infinity, arriveFrame: estTotalFrames } : null

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
    : Math.round((TITLE_IN_S + SCENE_REVEAL_S - RIBBON_EARLY_S) * fps)
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
  const HOLD_OV = Math.round(5 * fps)
  const openingTitle = (opts.title?.trim())
    || [opts.startName, opts.endName].filter(Boolean).join(' → ') || 'Sillonphane'
  const openingDate = opts.trailDate?.trim() ?? ''
  const openingKm = `${(totalDistance / 1000).toFixed(1).replace('.', ',')} km`
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
      // Signature : logo + « sillonphane.fr/rando » se déroulent sur l'écran-titre noir, puis
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
  const lngLatAtM = (m: number) => lngLatAtProgress(visualPoints, distances, totalDistance, Math.max(0, Math.min(1, m / totalDistance)))
  /** Avance les personnages d'une image et les dessine, pieds en (x, y). `scale` : 1 = taille de marche. */
  function drawHikers3d(x: number, y: number, scale: number, alpha = 1) {
    const s = scale * FILM_SCALE
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
  const mapMosaic = await buildMapMosaic(prefetchPoints, zoom, tileRadius, 8192, signal)
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
  exportMap.jumpTo({ center: [points[0].lon, points[0].lat], zoom: hikers3d && introFrames ? closeZoom : zoom })
  await waitForMapIdle(exportMap, signal)
  if (hikers3d) hikers.forEach(h => h.resetToStart())
  const standUpFrame = Math.round(TITLE_IN_S * fps)
  for (let fi = 0; fi < introFrames && !signal?.aborted; fi++) {
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
    catch { ctx.fillStyle = '#e8e0d5'; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 0)
    if (departureEvent) {
      const pt = exportMap.project([departureEvent.lon, departureEvent.lat])
      if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200)
        drawLocSign(ctx, locSignCache, departureEvent.name, pt.x, pt.y, departureEvent.style, departureEvent.ele)
    }
    if (hikers3d) {
      if (fi === standUpFrame) hikers.forEach(h => h.startIntro())
      const p0 = exportMap.project([points[0].lon, points[0].lat])
      drawHikers3d(p0.x, p0.y, hiker3dScaleForZoom(closeZoom, zoom))
    }
    drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 0)
    drawElevOverlay(ctx, OUT_W, OUT_H, {
      points, distances, progress: 0, distanceCovered: 0, totalDistance,
      elevGain: opts.elevGain, elevLoss: opts.elevLoss,
      currentEle: currentElevation(points, distances, 0), trackName: '',
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
    exportMap.jumpTo({ center: [points[0].lon, points[0].lat], zoom: z })
    await waitForMapIdle(exportMap, signal)
    if (signal?.aborted) break
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
    catch { ctx.fillStyle = '#e8e0d5'; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 0)
    if (departureEvent) {
      const pt = exportMap.project([departureEvent.lon, departureEvent.lat])
      if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200)
        drawLocSign(ctx, locSignCache, departureEvent.name, pt.x, pt.y, departureEvent.style, departureEvent.ele)
    }
    const p0 = exportMap.project([points[0].lon, points[0].lat])
    drawHikers3d(p0.x, p0.y, hiker3dScaleForZoom(z, zoom))
    drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 0)
    drawElevOverlay(ctx, OUT_W, OUT_H, {
      points, distances, progress: 0, distanceCovered: 0, totalDistance,
      elevGain: opts.elevGain, elevLoss: opts.elevLoss,
      currentEle: currentElevation(points, distances, 0), trackName: '',
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
      catch { ctx.fillStyle = '#e8e0d5'; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    } else {
      // Appliquer la position finale de la caméra, attendre que ses tuiles soient chargées (pas
      // seulement qu'une frame ait été peinte) pour éviter de capturer le fond beige par défaut.
      exportMap.jumpTo({ center: [camLng, camLat], zoom })
      await waitForMapIdle(exportMap, signal)
      if (signal?.aborted) break
      try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
      catch { ctx.fillStyle = '#e8e0d5'; ctx.fillRect(0, 0, OUT_W, OUT_H) }
    }

    // 2. Tracé GPX (projeté de manière synchrone)
    drawTrack(ctx, project, visualPoints, distances, totalDistance, progress)

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
        drawLocSign(ctx, locSignCache, ev.name, pt.x, pt.y, ev.style, ev.ele, signA)
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
      distanceCovered: progress * totalDistance, totalDistance,
      elevGain: opts.elevGain, elevLoss: opts.elevLoss,
      currentEle: currentElevation(points, distances, progress),
      trackName: '',
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
      // Le salut démarre aux 60 % du zoom (comme l'aperçu).
      if (hikers3d && f === Math.round(END_ZOOM_FRAMES * 0.6)) hikers.forEach(h => h.startOutro())

      ctx.clearRect(0, 0, OUT_W, OUT_H)
      try { ctx.drawImage(exportMap.getCanvas(), 0, 0, OUT_W, OUT_H) }
      catch { ctx.fillStyle = '#e8e0d5'; ctx.fillRect(0, 0, OUT_W, OUT_H) }

      drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 1)

      for (const ev of [...localityEvents, ...(departureEvent ? [departureEvent] : []), ...(arrivalEvent ? [arrivalEvent] : [])]) {
        const pt = exportMap.project([ev.lon, ev.lat])
        if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200)
          drawLocSign(ctx, locSignCache, ev.name, pt.x, pt.y, ev.style, ev.ele)
      }

      drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 1)
      drawElevOverlay(ctx, OUT_W, OUT_H, {
        points, distances, progress: 1,
        distanceCovered: totalDistance, totalDistance,
        elevGain: opts.elevGain, elevLoss: opts.elevLoss,
        currentEle: currentElevation(points, distances, 1), trackName: '',
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
    const WATERMARK_FRAMES = HOLD_OV
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
        ctx.fillStyle = '#e8e0d5'; ctx.fillRect(0, 0, OUT_W, OUT_H)
      }

      drawTrack(ctx, (lon, lat) => exportMap.project([lon, lat]), visualPoints, distances, totalDistance, 1)

      // Vue d'ensemble, alignée sur le film 3D : cols, départ et arrivée restent ; les localités
      // intermédiaires s'effacent en fondu pendant le premier tiers du dézoom (image finale allégée).
      const locFade = 1 - Math.min(1, f / Math.max(1, EASE_OV * 0.35))
      for (const ev of [...localityEvents, ...(departureEvent ? [departureEvent] : []), ...(arrivalEvent ? [arrivalEvent] : [])]) {
        const isEndpoint = ev === departureEvent || ev === arrivalEvent
        const a = isEndpoint || ev.style === 'col' ? 1 : locFade
        if (a <= 0) continue
        const pt = exportMap.project([ev.lon, ev.lat])
        if (pt.x > -300 && pt.x < OUT_W + 300 && pt.y > -200 && pt.y < OUT_H + 200) {
          ctx.save()
          ctx.globalAlpha = a
          drawLocSign(ctx, locSignCache, ev.name, pt.x, pt.y, ev.style, ev.ele)
          ctx.restore()
        }
      }

      drawWeatherCard(ctx, OUT_W, opts.weather ?? null, 1)
      // Désormais en haut-gauche (plus petite, voir ELEV_OVERLAY_SCALE) : ne gêne plus la vue
      // d'ensemble, reste affichée jusqu'à la fin sans fondu de sortie.
      drawElevOverlay(ctx, OUT_W, OUT_H, {
        points, distances, progress: 1,
        distanceCovered: totalDistance, totalDistance,
        elevGain: opts.elevGain, elevLoss: opts.elevLoss,
        currentEle: currentElevation(points, distances, 1),
        trackName: '',
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
        drawEndAddress(ctx, OUT_W, OUT_H, Math.min(1, intoWatermark / WATERMARK_FADE_FRAMES))
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
