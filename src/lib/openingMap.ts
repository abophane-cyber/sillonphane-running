// Fond de la page d'ouverture (films 2D et 3D) : la ville de l'épreuve vue du dessus, façon plan clair et lumineux.
//   - fond : les vues aériennes IGN du projet (makeStyle, comme l'aperçu et le film 2D), ici sans l'assombrissement
//     du film, avivées (OPENING_VIEW.grade), avec par-dessus le Plan IGN vectoriel (végétation, bâtiments, routes)
//     pour un aspect de carte illustrée, et l'eau repeinte en bleu (BD TOPO) ;
//   - cadrage calculé sur l'emprise du parcours (calculateOpeningCamera) : rien n'est propre à une ville.
// La vue est rendue UNE fois (carte hors écran, à la taille du film), puis la carte est détruite ; les calques
// (ruban, lieux, titre) sont posés par-dessus par filmOpening.ts.

import maplibregl from 'maplibre-gl'
import { makeStyle } from './mapStyle'
import type { OpeningPoi, OpeningPt, OpeningWater } from './filmOpening'

/** Plan IGN vectoriel (Géoplateforme, licence Etalab : « © IGN » déjà affiché sur les films). */
const PLAN_IGN_TILES = 'https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf'

/** Réglages de la vue d'ouverture. */
export const OPENING_VIEW = {
  /** Zone de l'image (en part de la largeur / hauteur) où doit tenir le parcours : à droite ; la gauche reste au
   * titre. */
  box: { x0: 0.46, x1: 0.97, y0: 0.05, y1: 0.96 },
  /** Orientations essayées (cap de la caméra, degrés) : on garde celle où le parcours couvre le plus de surface. Nord
   * en haut seulement : une carte vue du dessus se lit nord en haut. */
  bearings: [0],
  /** Étalonnage de l'image (filtre canvas) : couleurs plus vives. */
  grade: 'saturate(1.3) brightness(1.04) contrast(1.2)',
  /** Plan IGN vectoriel posé sur la photo (aspect de carte illustrée). */
  style: { vegetation: '#6fb24f', building: '#ead8bd', buildingEdge: '#b49a7a', road: '#fffaf0' },
  /** Eau (surfaces et cours d'eau de la BD TOPO) repeinte en bleu doux : sur la photo aérienne, l'eau est sombre. */
  water: '#84aecb',
} as const

export interface OpeningMapInput {
  /** Parcours (lon/lat) et distance cumulée de chaque point depuis le départ (m). */
  route: { lon: number; lat: number }[]
  dist: number[]
  /** Lieux de l'épreuve : points d'intérêt (`type` 'poi') et quartiers ou communes (`type` 'district'). */
  pois: { name: string; lon: number; lat: number; type?: string; icon?: string }[]
  width: number
  height: number
  signal?: AbortSignal
}
export interface OpeningShot {
  /** Image de la vue (taille du film), déjà étalonnée. */
  image: HTMLCanvasElement
  /** Parcours et lieux à l'écran sur cette image. */
  ribbon: OpeningPt[]
  pois: OpeningPoi[]
  /** Cours d'eau nommés à l'écran. */
  waters: OpeningWater[]
}

/** Attend que `ready()` soit vrai en forçant le dessin de la carte (map.redraw) : MapLibre ne dessine qu'aux images
 * d'animation du navigateur, suspendues quand l'onglet est caché. Plafond `maxMs` : on continue alors avec ce qu'on a. */
function pumpUntil(map: maplibregl.Map, ready: () => boolean, maxMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t0 = performance.now()
    const tick = () => {
      try { map.redraw() } catch { /* style pas encore prêt */ }
      if (ready() || signal?.aborted || performance.now() - t0 > maxMs) { clearInterval(id); resolve() }
    }
    const id = setInterval(tick, 120)
  })
}

/**
 * Caméra de l'ouverture : pour chaque orientation essayée, zoom le plus serré (dichotomie) et centre (quelques
 * itérations) tels que tout le parcours tienne dans OPENING_VIEW.box ; on garde l'orientation où le parcours couvre le
 * plus de surface à l'écran. La carte est laissée sur la caméra retenue.
 */
export function calculateOpeningCamera(map: maplibregl.Map, route: { lon: number; lat: number }[], w: number, h: number): void {
  const step = Math.max(1, Math.floor(route.length / 300))
  const pts = route.filter((_, i) => i % step === 0)
  let lo0 = Infinity, lo1 = -Infinity, la0 = Infinity, la1 = -Infinity
  for (const p of route) { lo0 = Math.min(lo0, p.lon); lo1 = Math.max(lo1, p.lon); la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat) }
  const { box } = OPENING_VIEW
  const bx0 = box.x0 * w, bx1 = box.x1 * w, by0 = box.y0 * h, by1 = box.y1 * h
  /** Place la caméra ; renvoie la surface occupée par le parcours à l'écran, 0 s'il ne tient pas dans la zone. */
  const place = (bearing: number, zoom: number): number => {
    let center: [number, number] = [(lo0 + lo1) / 2, (la0 + la1) / 2]
    let area = 0
    for (let it = 0; it < 5; it++) {
      map.jumpTo({ center, zoom, pitch: 0, bearing })
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (const p of pts) {
        const q = map.project([p.lon, p.lat])
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y)
      }
      if (!isFinite(x0 + x1 + y0 + y1)) return 0
      area = x1 - x0 <= bx1 - bx0 && y1 - y0 <= by1 - by0 ? (x1 - x0) * (y1 - y0) : 0
      const dx = (x0 + x1) / 2 - (bx0 + bx1) / 2, dy = (y0 + y1) / 2 - (by0 + by1) / 2
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break
      const c = map.unproject([w / 2 + dx, h / 2 + dy])
      center = [c.lng, c.lat]
    }
    return area
  }
  const fit = (bearing: number): { zoom: number; area: number } => {
    let lo = 6, hi = 18
    for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (place(bearing, mid) > 0) lo = mid; else hi = mid }
    return { zoom: lo, area: place(bearing, lo) }
  }
  let best = { bearing: 0, zoom: 12, area: -1 }
  for (const b of OPENING_VIEW.bearings) {
    const f = fit(b)
    if (f.area > best.area * 1.03) best = { bearing: b, ...f }
  }
  place(best.bearing, best.zoom)
}

/** Hydrographie IGN (BD TOPO, WFS Géoplateforme) dans l'emprise de la vue, peinte en bleu sur l'image. Renvoie les
 * cours d'eau nommés à l'écran (le plus long tronçon visible de chacun, les plus importants d'abord) pour inscrire
 * leur nom. Échec réseau : image sans eau repeinte, sans noms. */
async function paintWater(g: CanvasRenderingContext2D, map: maplibregl.Map, w: number, h: number, signal?: AbortSignal): Promise<OpeningWater[]> {
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => map.unproject([x, y]))
  const lon0 = Math.min(...corners.map(c => c.lng)), lon1 = Math.max(...corners.map(c => c.lng))
  const lat0 = Math.min(...corners.map(c => c.lat)), lat1 = Math.max(...corners.map(c => c.lat))
  const base = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&SRSNAME=CRS:84' +
    `&OUTPUTFORMAT=application/json&COUNT=5000&BBOX=${lon0},${lat0},${lon1},${lat1},CRS:84&TYPENAMES=`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = async (type: string): Promise<any[]> => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 20_000)
      signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
      const r = await fetch(base + type, { signal: ctrl.signal })
      clearTimeout(t)
      return r.ok ? ((await r.json()).features ?? []) : []
    } catch { return [] }
  }
  const [surfaces, lines] = await Promise.all([get('BDTOPO_V3:surface_hydrographique'), get('BDTOPO_V3:cours_d_eau')])
  const trace = (ring: number[][], close: boolean) => {
    ring.forEach(([lon, lat], i) => { const q = map.project([lon, lat]); if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y) })
    if (close) g.closePath()
  }
  const lineParts = (geo: { type?: string; coordinates?: number[][] | number[][][] } | undefined): number[][][] =>
    geo?.type === 'LineString' ? [geo.coordinates as number[][]] : geo?.type === 'MultiLineString' ? geo.coordinates as number[][][] : []
  g.save()
  g.fillStyle = OPENING_VIEW.water
  g.globalAlpha = 0.85
  g.beginPath()
  for (const f of surfaces) {
    const geo = f?.geometry
    if (geo?.type === 'Polygon') for (const r of geo.coordinates) trace(r, true)
    else if (geo?.type === 'MultiPolygon') for (const p of geo.coordinates) for (const r of p) trace(r, true)
  }
  g.fill('evenodd')
  g.strokeStyle = OPENING_VIEW.water
  g.lineWidth = Math.max(2, h / 400)
  g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath()
  for (const f of lines) for (const l of lineParts(f?.geometry)) trace(l, false)
  g.stroke()
  g.restore()

  // Noms : pour chaque cours d'eau, le plus long tronçon continu dans l'image.
  const best = new Map<string, OpeningWater & { len: number; importance: number }>()
  for (const f of lines) {
    const raw = String(f?.properties?.toponyme ?? '').trim()
    if (!raw) continue
    const name = raw.charAt(0).toLocaleUpperCase('fr-FR') + raw.slice(1)
    const importance = Number(f?.properties?.importance) || 9
    for (const l of lineParts(f?.geometry)) {
      let run: { x: number; y: number }[] = []
      const flush = () => {
        let len = 0
        for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y)
        const cur = best.get(name)
        if (run.length > 1 && (!cur || len > cur.len)) best.set(name, { name, pts: run, len, importance })
        run = []
      }
      for (const [lon, lat] of l) {
        const q = map.project([lon, lat])
        if (q.x > 0 && q.x < w && q.y > 0 && q.y < h) run.push({ x: q.x, y: q.y })
        else flush()
      }
      flush()
    }
  }
  return [...best.values()]
    .filter(r => r.len > w * 0.12)
    .sort((a, b) => a.importance - b.importance || b.len - a.len)
    .slice(0, 3)
    .map(({ name, pts }) => ({ name, pts }))
}

/** Rend la vue d'ouverture (carte hors écran détruite ensuite). */

export async function captureOpeningView(inp: OpeningMapInput): Promise<OpeningShot> {
  const { width: w, height: h, signal } = inp
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${w}px;height:${h}px;pointer-events:none;`
  document.body.appendChild(container)
  const map = new maplibregl.Map({
    container,
    style: makeStyle(),
    center: [inp.route[0].lon, inp.route[0].lat],
    zoom: 13,
    ...({ preserveDrawingBuffer: true, pixelRatio: 1, antialias: true } as object),
    attributionControl: false,
    fadeDuration: 0,
    interactive: false,
  })
  try {
    let loaded = false
    map.once('load', () => { loaded = true })
    await pumpUntil(map, () => loaded, 30_000, signal)
    // Photo aérienne sans l'assombrissement du film (BASEMAP_ADJUST) : l'étalonnage clair est fait ensuite.
    map.setPaintProperty('bg-ign', 'raster-brightness-max', 1)
    map.setPaintProperty('bg-ign', 'raster-contrast', 0)
    map.setPaintProperty('bg-ign', 'raster-saturation', 0)
    map.setPaintProperty('bg-ign', 'raster-hue-rotate', 0)
    // Plan IGN vectoriel par-dessus la photo, façon carte illustrée : végétation d'un vert franc, bâtiments beige chaud
    // cernés d'un trait plus soutenu, routes blanc crème (grands axes plus larges).
    map.addSource('opening-plan', { type: 'vector', tiles: [PLAN_IGN_TILES], minzoom: 0, maxzoom: 18 })
    const before = 'track-full-line'
    const width = (min: number, max: number): maplibregl.ExpressionSpecification =>
      ['interpolate', ['exponential', 1.6], ['zoom'], 11, min, 16, max]
    const MAJOR = ['AUTOROU', 'BRET_AUTO', 'PRINCIPALE', 'REGIONALE', 'BRET_PRINCIPALE', 'BRET_REGIONALE']
    const isMajor: maplibregl.ExpressionSpecification =
      ['any', ...MAJOR.map(m => ['==', ['slice', ['coalesce', ['get', 'symbo'], ''], 0, m.length], m] as maplibregl.ExpressionSpecification)]
    map.addLayer({ id: 'opening-veg', type: 'fill', source: 'opening-plan', 'source-layer': 'ocs_vegetation_surf',
      paint: { 'fill-color': OPENING_VIEW.style.vegetation, 'fill-opacity': 0.4 } }, before)
    map.addLayer({ id: 'opening-bati', type: 'fill', source: 'opening-plan', 'source-layer': 'bati_surf', minzoom: 12,
      paint: { 'fill-color': OPENING_VIEW.style.building, 'fill-opacity': 0.5, 'fill-outline-color': OPENING_VIEW.style.buildingEdge } }, before)
    map.addLayer({ id: 'opening-roads', type: 'line', source: 'opening-plan', 'source-layer': 'routier_route', filter: ['!', isMajor],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': OPENING_VIEW.style.road, 'line-opacity': 0.8, 'line-width': width(0.5, 5) } }, before)
    map.addLayer({ id: 'opening-roads-major', type: 'line', source: 'opening-plan', 'source-layer': 'routier_route', filter: isMajor,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': OPENING_VIEW.style.road, 'line-opacity': 0.92, 'line-width': width(1.4, 10) } }, before)

    calculateOpeningCamera(map, inp.route, w, h)
    // Trois passages « tout chargé » d'affilée : les tuiles appelées par les premiers dessins sont arrivées.
    let calm = 0
    await pumpUntil(map, () => (map.areTilesLoaded() && map.isStyleLoaded() ? ++calm : (calm = 0)) >= 3, 40_000, signal)
    map.redraw()

    const image = document.createElement('canvas')
    image.width = w; image.height = h
    const g = image.getContext('2d')!
    g.filter = OPENING_VIEW.grade
    g.drawImage(map.getCanvas(), 0, 0, w, h)
    g.filter = 'none'
    const waters = await paintWater(g, map, w, h, signal)

    const total = inp.dist[inp.dist.length - 1] || 1
    const step = Math.max(1, Math.floor(inp.route.length / 2000))
    const ribbon: OpeningPt[] = []
    for (let i = 0; i < inp.route.length; i += step) {
      const q = map.project([inp.route[i].lon, inp.route[i].lat])
      ribbon.push({ x: q.x, y: q.y, f: inp.dist[i] / total })
    }
    const last = inp.route[inp.route.length - 1], ql = map.project([last.lon, last.lat])
    ribbon.push({ x: ql.x, y: ql.y, f: 1 })
    const pois: OpeningPoi[] = inp.pois.map(p => ({ ...map.project([p.lon, p.lat]), name: p.name, type: p.type, icon: p.icon }))
    return { image, ribbon, pois, waters }
  } finally {
    map.remove()
    container.remove()
  }
}

/** Distance cumulée (m) le long d'un parcours lon/lat. */
export function cumulativeDistances(route: { lon: number; lat: number }[]): number[] {
  const d = [0]
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i]
    d.push(d[i - 1] + Math.hypot((b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110540))
  }
  return d
}
