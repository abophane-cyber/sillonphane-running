// Modèle 4 — la carte : grand titre en capitales et date sur papier clair, petite carte de France avec la ville de
// départ en haut à droite, puis une grande carte sombre bordée de papier qui porte le tracé lumineux, les kilomètres
// écrits le long du parcours et les noms du départ et de l'arrivée. Sur le bas de la carte : grand temps, nom, dossard
// et allure à gauche ; petit profil d'altitude (distance et D+) à droite. Pas de photo.
import type { PosterData, Resolved, Theme, MapOptions } from './poster'
import {
  POSTER_W, SANS, drawMap, drawSocialFooter, formatChronoInput, ribbonStops, roundRect, setSpacing, wrapFit,
} from './poster'
import { computeElevGainLoss } from './gpx'

/** France métropolitaine simplifiée (lon, lat), puis la Corse. */
const FRANCE: [number, number][][] = [[
  [2.54, 51.09], [3.16, 50.78], [4.15, 50.28], [4.8, 50.15], [4.87, 49.8], [5.47, 49.5], [6.36, 49.46], [7.1, 49.15],
  [8.2, 48.97], [7.6, 48.1], [7.55, 47.58], [6.85, 47.45], [6.95, 47.0], [6.1, 46.45], [6.8, 46.4], [7.0, 45.9],
  [6.8, 45.15], [7.1, 44.25], [7.55, 43.8], [6.9, 43.43], [6.2, 43.1], [5.0, 43.35], [4.2, 43.45], [3.1, 43.05],
  [3.17, 42.45], [1.75, 42.45], [0.7, 42.8], [-0.3, 42.8], [-1.75, 43.35], [-1.45, 43.6], [-1.2, 44.6], [-1.1, 45.6],
  [-1.45, 46.2], [-2.15, 46.9], [-2.5, 47.3], [-3.0, 47.55], [-4.4, 47.8], [-4.75, 48.35], [-4.55, 48.62],
  [-3.6, 48.75], [-2.7, 48.55], [-1.95, 48.68], [-1.6, 48.65], [-1.85, 49.7], [-1.25, 49.65], [-1.1, 49.35],
  [0.2, 49.45], [0.1, 49.7], [1.4, 50.1], [1.6, 50.85],
], [
  [9.4, 43.0], [9.55, 42.6], [9.4, 41.4], [9.1, 41.4], [8.6, 41.9], [8.6, 42.35], [9.3, 42.7],
]]

function inPolygon(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Petite carte de France (`size` unités de côté, coin haut gauche en x, y) et point sur la ville de départ. */
function drawFrance(ctx: CanvasRenderingContext2D, theme: Theme, lon: number, lat: number, x: number, y: number, size: number) {
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const cos = Math.cos(46.5 * Math.PI / 180)
  const lon0 = -4.8, lat1 = 51.1, span = Math.max((9.6 - lon0) * cos, lat1 - 41.3)
  const s = size / span
  const X = (lo: number) => x + (lo - lon0) * cos * s, Y = (la: number) => y + (lat1 - la) * s
  ctx.beginPath()
  for (const poly of FRANCE) poly.forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la))))
  ctx.closePath()
  ctx.fillStyle = theme.light ? '#FFFFFF' : fg(0.08); ctx.fill()
  ctx.lineJoin = 'round'; ctx.strokeStyle = fg(0.8); ctx.lineWidth = 1.1; ctx.stroke()
  ctx.beginPath(); ctx.arc(X(lon), Y(lat), 5.5, 0, Math.PI * 2); ctx.strokeStyle = fg(1); ctx.lineWidth = 1.2; ctx.stroke()
  ctx.beginPath(); ctx.arc(X(lon), Y(lat), 2.6, 0, Math.PI * 2); ctx.fillStyle = fg(1); ctx.fill()
}

/** « 1 500 m » avec une espace fine, comme sur le reste de l'affiche. */
const meters = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} m`

/** Profil d'altitude en blanc, posé sur la carte : titre « PROFIL : 21,1 KM · 120 m D+ », altitudes, kilomètres. */
function drawProfileOverlay(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, x: number, y: number, w: number, h: number) {
  const { points, distances, total } = data
  const white = (a: number) => `rgba(255,255,255,${a})`
  const gain = computeElevGainLoss(points, distances).elevGain
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right'
  ctx.font = `700 10px ${SANS}`; ctx.fillStyle = white(0.95); setSpacing(ctx, 0.6)
  ctx.fillText(`PROFIL : ${r.distance.toUpperCase()} · ${meters(gain)} D+`, x + w, y + 9)
  setSpacing(ctx, 0)

  const n = points.length
  const sm = points.map((_, i) => {
    let s = 0, c = 0
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { s += points[j].ele; c++ }
    return s / c
  })
  const lo = Math.min(...sm), hi = Math.max(...sm)
  // Graduations d'altitude « rondes » (4 au plus), de 0 m ou juste sous le point le plus bas.
  const rawStep = Math.max(10, (hi - lo) / 3)
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(v => v >= rawStep)!
  const floor = Math.floor(lo / step) * step, ceil = Math.max(floor + step, Math.ceil(hi / step) * step)
  ctx.font = `9px ${SANS}`
  const labelW = ctx.measureText(meters(ceil)).width + 6
  const gx = x + labelW, gw = w - labelW, top = y + 20, base = y + h - 14
  const X = (d: number) => gx + d / total * gw
  const Y = (e: number) => base - (e - floor) / (ceil - floor) * (base - top)

  ctx.strokeStyle = white(0.18); ctx.lineWidth = 0.8; ctx.fillStyle = white(0.75); ctx.textAlign = 'right'
  for (let e = floor; e <= ceil + 1e-6; e += step) {
    ctx.beginPath(); ctx.moveTo(gx, Y(e)); ctx.lineTo(gx + gw, Y(e)); ctx.stroke()
    ctx.fillText(meters(e), gx - 5, Y(e) + 3)
  }
  const kmStep = total > 25000 ? 5 : total > 12000 ? 2 : 1
  ctx.textAlign = 'center'
  for (let km = 0; km * 1000 <= total; km += kmStep) ctx.fillText(String(km), Math.min(gx + gw - 3, X(km * 1000)), y + h - 1)

  const stops = r.ribbon === 'aucun' ? [[0, '#FFFFFF'], [1, '#FFFFFF']] as [number, string][] : ribbonStops(r.ribbon)
  const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0)
  stops.forEach(([at, c]) => grad.addColorStop(at, c))
  ctx.beginPath()
  ctx.moveTo(gx, base)
  sm.forEach((e, i) => ctx.lineTo(X(distances[i]), Y(e)))
  ctx.lineTo(gx + gw, base)
  ctx.closePath()
  ctx.globalAlpha = 0.25; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1
  ctx.beginPath()
  sm.forEach((e, i) => (i ? ctx.lineTo(X(distances[i]), Y(e)) : ctx.moveTo(X(distances[i]), Y(e))))
  ctx.strokeStyle = grad; ctx.lineWidth = 1.8; ctx.stroke()
  // Arrivée : petit point blanc au bout du profil.
  ctx.beginPath(); ctx.arc(X(total), Y(sm[n - 1]), 2.6, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill()
}

export async function drawCarte(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, theme: Theme,
  k: number, isLive: () => boolean, signature: boolean): Promise<boolean> {
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const H = r.H, L = 34, R = POSTER_W - 34, CW = R - L
  const sq = r.format.id === 'carre'
  const start = data.points[0]

  // Carte de France en haut à droite, si le départ est en France métropolitaine.
  const franceSize = sq ? 74 : 92
  const inFrance = !!start && FRANCE.some(p => inPolygon(start.lon, start.lat, p))
  if (inFrance) drawFrance(ctx, theme, start.lon, start.lat, R - franceSize, 30, franceSize)

  // Titre en capitales (deux lignes au plus) et date « 07.07.2024 »
  const titleW = CW - (inFrance ? franceSize + 24 : 0)
  const { size, lines } = wrapFit(ctx, r.title.toUpperCase(), 800, SANS, sq ? 42 : 52, 22, titleW, 2)
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = fg(1)
  ctx.font = `800 ${size}px ${SANS}`
  let ty = 30 + size * 0.86
  lines.forEach((line, i) => { if (i) ty += size * 0.98; ctx.fillText(line, L, ty) })
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.dateISO)
  const dateText = d ? `${d[3]}.${d[2]}.${d[1]}` : r.dateText
  if (dateText) {
    ty += sq ? 24 : 28
    ctx.font = `700 ${sq ? 15 : 18}px ${SANS}`; ctx.fillStyle = fg(0.9)
    ctx.fillText(dateText, L, ty)
  }

  // Grande carte bordée de papier
  const top = Math.max(ty + (sq ? 18 : 24), inFrance ? 30 + franceSize + 12 : 0)
  const bottom = H - (signature ? 46 : 34)
  const mapH = bottom - top
  const ovH = sq ? 120 : 150
  const radius = 10
  if (r.show('map')) {
    const mapOpts: MapOptions = {
      bg: r.background, ribbon: r.ribbon, theme, bornes: r.show('bornes'), radius, glow: true,
      padBottom: Math.max(0, ovH - 50),
      labels: { stepKm: data.total > 25000 ? 5 : data.total > 7000 ? 2 : 1, start: r.city || undefined },
    }
    if (!await drawMap(ctx, data, mapOpts, L, top, CW, mapH, k, isLive)) return false
  } else {
    roundRect(ctx, L, top, CW, mapH, radius); ctx.fillStyle = '#1b221d'; ctx.fill()
  }

  // Bas de la carte assombri : les textes restent lisibles quel que soit le fond.
  ctx.save()
  roundRect(ctx, L, top, CW, mapH, radius); ctx.clip()
  const shade = ctx.createLinearGradient(0, bottom - ovH - 30, 0, bottom)
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.62)')
  ctx.fillStyle = shade; ctx.fillRect(L, bottom - ovH - 30, CW, ovH + 30)
  ctx.restore()

  // Gauche : grand temps (ou distance), nom, dossard et classement, allure
  const white = (a: number) => `rgba(255,255,255,${a})`
  const pad = sq ? 16 : 20
  const finishS = r.chronoS
  const small: [string, number, string][] = [] // texte, taille, couleur
  if (r.name) small.push([r.name.toUpperCase(), sq ? 15 : 18, white(1)])
  const bibRank = [r.show('bib') && r.bib ? `N° ${r.bib}` : '', r.show('rank') && r.rank ? `Classement ${r.rank}` : '']
    .filter(Boolean).join('  ·  ')
  if (bibRank) small.push([bibRank, sq ? 12 : 14, white(0.9)])
  if (r.pace) small.push([r.pace, sq ? 12 : 14, white(0.9)])
  const big = finishS ? formatChronoInput(finishS) : r.distance.toUpperCase()
  const bigSize = sq ? 40 : 50
  let y = bottom - pad - small.reduce((s, [, sz]) => s + sz * 1.3, 0)
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.font = `800 ${bigSize}px ${SANS}`; ctx.fillStyle = white(1)
  ctx.fillText(big, L + pad, y)
  small.forEach(([text, sz, color], i) => {
    y += sz * 1.3 + (i ? 0 : 2)
    ctx.font = `${i === 0 && r.name ? 700 : 500} ${sz}px ${SANS}`; ctx.fillStyle = color
    ctx.fillText(text, L + pad, y)
  })

  // Droite : profil d'altitude
  if (r.show('profile')) {
    const pw = Math.min(sq ? 260 : 300, CW * 0.46), ph = ovH - 34
    drawProfileOverlay(ctx, data, r, R - pad - pw, bottom - pad - ph, pw, ph)
  }

  if (signature) drawSocialFooter(ctx, theme, L, R, H)
  return true
}
