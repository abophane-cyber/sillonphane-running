import type { GpxPoint, GpxTrack, ParsedGpx } from '../types'

const R = 6371000 // rayon Terre en mètres

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLon * sinLon
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Cap (relèvement) de a vers b, en degrés 0–360 (0 = nord). */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Plus petit écart angulaire entre deux caps, en degrés 0–180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// Dénivelé : additionner les écarts bruts d'un point à l'autre compte chaque pic de bruit deux
// fois (aller + retour). Les altitudes issues d'un MNT en terrain escarpé (falaises) ont des pics
// isolés de ±50 m : sur « Les Aiguilles de Bavella », 1669 m bruts contre ~815 m réels (VisuGPX).
// D'où : médiane glissante (supprime les pics isolés), moyenne glissante (atténue le bruit fin),
// puis seuil d'hystérésis. Fenêtres en DISTANCE, pas en nombre de points : un tracé clairsemé
// (points à plusieurs centaines de mètres) n'a qu'un point par fenêtre et reste intact.
const ELE_MEDIAN_WINDOW_M = 150
const ELE_MEAN_WINDOW_M = 100
const ELE_HYSTERESIS_M = 3

function windowIndices(dist: number[], i: number, halfW: number): [number, number] {
  let lo = i, hi = i
  while (lo > 0 && dist[i] - dist[lo - 1] <= halfW) lo--
  while (hi < dist.length - 1 && dist[hi + 1] - dist[i] <= halfW) hi++
  return [lo, hi]
}

export function computeElevGainLoss(points: GpxPoint[], dist: number[]): { elevGain: number; elevLoss: number } {
  const raw = points.map(p => p.ele)
  const median = raw.map((_, i) => {
    const [lo, hi] = windowIndices(dist, i, ELE_MEDIAN_WINDOW_M / 2)
    const w = raw.slice(lo, hi + 1).sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  const smooth = median.map((_, i) => {
    const [lo, hi] = windowIndices(dist, i, ELE_MEAN_WINDOW_M / 2)
    let s = 0
    for (let j = lo; j <= hi; j++) s += median[j]
    return s / (hi - lo + 1)
  })
  let elevGain = 0
  let elevLoss = 0
  let ref = smooth[0]
  for (const e of smooth) {
    if (e - ref >= ELE_HYSTERESIS_M) { elevGain += e - ref; ref = e }
    else if (ref - e >= ELE_HYSTERESIS_M) { elevLoss += ref - e; ref = e }
  }
  return { elevGain, elevLoss }
}

function computeStats(points: GpxPoint[]): Pick<GpxTrack, 'distance' | 'elevGain' | 'elevLoss'> {
  const dist = [0]
  for (let i = 1; i < points.length; i++) dist.push(dist[i - 1] + haversine(points[i - 1], points[i]))
  return { distance: dist[dist.length - 1], ...computeElevGainLoss(points, dist) }
}

export function parseKml(xmlText: string): ParsedGpx {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Fichier KML invalide')

  const name = doc.querySelector('Document > name, Folder > name')?.textContent ?? undefined
  const tracks: GpxTrack[] = []

  // LineString / MultiGeometry tracks
  for (const placemark of doc.querySelectorAll('Placemark')) {
    const trkName = placemark.querySelector('name')?.textContent ?? 'Parcours'
    const coordNodes = placemark.querySelectorAll('LineString > coordinates, MultiGeometry > LineString > coordinates')
    if (coordNodes.length === 0) continue

    const points: GpxPoint[] = []
    for (const coordNode of coordNodes) {
      const raw = (coordNode.textContent ?? '').trim()
      for (const triplet of raw.split(/\s+/)) {
        const parts = triplet.split(',')
        if (parts.length < 2) continue
        const lon = parseFloat(parts[0])
        const lat = parseFloat(parts[1])
        const ele = parts[2] ? parseFloat(parts[2]) : 0
        if (isNaN(lat) || isNaN(lon)) continue
        points.push({ lat, lon, ele: isNaN(ele) ? 0 : ele })
      }
    }

    if (points.length < 2) continue
    const stats = computeStats(points)
    tracks.push({ name: trkName, points, ...stats, startTime: undefined, endTime: undefined, duration: undefined })
  }

  if (tracks.length === 0) throw new Error('Aucun tracé trouvé dans ce fichier KML')
  return { tracks, waypoints: [], name }
}

export function parseGpx(xmlText: string): ParsedGpx {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Fichier GPX invalide')

  const name = doc.querySelector('metadata > name')?.textContent ?? doc.querySelector('trk > name')?.textContent ?? undefined

  const tracks: GpxTrack[] = []
  for (const trk of doc.querySelectorAll('trk')) {
    const trkName = trk.querySelector('name')?.textContent ?? 'Parcours'
    const points: GpxPoint[] = []

    for (const trkpt of trk.querySelectorAll('trkpt')) {
      const lat = parseFloat(trkpt.getAttribute('lat') ?? '0')
      const lon = parseFloat(trkpt.getAttribute('lon') ?? '0')
      const ele = parseFloat(trkpt.querySelector('ele')?.textContent ?? '0')
      const timeStr = trkpt.querySelector('time')?.textContent
      const time = timeStr ? new Date(timeStr) : undefined
      points.push({ lat, lon, ele, time })
    }

    if (points.length < 2) continue

    const stats = computeStats(points)
    const startTime = points[0].time
    const endTime = points[points.length - 1].time
    const duration = startTime && endTime ? (endTime.getTime() - startTime.getTime()) / 1000 : undefined

    tracks.push({ name: trkName, points, ...stats, startTime, endTime, duration })
  }

  const waypoints: GpxPoint[] = []
  for (const wpt of doc.querySelectorAll('wpt')) {
    waypoints.push({
      lat: parseFloat(wpt.getAttribute('lat') ?? '0'),
      lon: parseFloat(wpt.getAttribute('lon') ?? '0'),
      ele: parseFloat(wpt.querySelector('ele')?.textContent ?? '0'),
    })
  }

  return { tracks, waypoints, name: name ?? undefined }
}

// Interpolation fluide : renvoie le point sur le tracé à la progression t (0..1)
export function interpolateTrack(points: GpxPoint[], distances: number[], totalDist: number, t: number): GpxPoint {
  const target = t * totalDist
  let lo = 0
  let hi = points.length - 1

  // Recherche binaire du segment
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (distances[mid] <= target) lo = mid
    else hi = mid
  }

  const segLen = distances[hi] - distances[lo]
  if (segLen === 0) return points[lo]
  const frac = (target - distances[lo]) / segLen

  return {
    lat: points[lo].lat + frac * (points[hi].lat - points[lo].lat),
    lon: points[lo].lon + frac * (points[hi].lon - points[lo].lon),
    ele: points[lo].ele + frac * (points[hi].ele - points[lo].ele),
    time: undefined,
  }
}

// Lisse la géométrie du tracé (moyenne mobile pondérée, plusieurs passes) pour adoucir les
// angles vifs dus au bruit GPS. N'affecte que lon/lat ; distances/altitude réelles utilisées
// ailleurs (marqueur, altimétrie, progression) restent basées sur les points d'origine.
/** Lissage du tracé affiché. Running : léger par défaut (2 passes, rayon 2) — on suit fidèlement les rues ; la
 * rando lissait fort (5, 4) pour adoucir les lacets. */
export const TRACK_SMOOTH = { iterations: 2, radius: 2 }

export function smoothTrackCoords(points: GpxPoint[], iterations = TRACK_SMOOTH.iterations, radius = TRACK_SMOOTH.radius): [number, number][] {
  const n = points.length
  let lons = points.map(p => p.lon)
  let lats = points.map(p => p.lat)
  for (let iter = 0; iter < iterations; iter++) {
    const newLons = lons.slice()
    const newLats = lats.slice()
    for (let i = 1; i < n - 1; i++) {
      let sumLon = 0, sumLat = 0, wSum = 0
      for (let k = -radius; k <= radius; k++) {
        const j = i + k
        if (j < 0 || j >= n) continue
        const w = radius + 1 - Math.abs(k)
        sumLon += lons[j] * w
        sumLat += lats[j] * w
        wSum += w
      }
      newLons[i] = sumLon / wSum
      newLats[i] = sumLat / wSum
    }
    lons = newLons
    lats = newLats
  }
  return lons.map((lon, i) => [lon, lats[i]] as [number, number])
}

/** Variante de smoothTrackCoords qui renvoie directement des GpxPoint (lon/lat lissés, ele et
 *  autres champs conservés depuis le point d'origine). Pratique pour réutiliser telles quelles
 *  les fonctions qui attendent un tableau de GpxPoint (interpolateTrack, projection carte…). */
export function smoothTrackPoints(points: GpxPoint[], iterations = TRACK_SMOOTH.iterations, radius = TRACK_SMOOTH.radius): GpxPoint[] {
  const coords = smoothTrackCoords(points, iterations, radius)
  return points.map((p, i) => ({ ...p, lon: coords[i][0], lat: coords[i][1] }))
}

/** Lissage EN MÈTRES (et non en nombre de points) : le tracé est rééchantillonné tous les `stepM` m, lissé sur ±`radiusM`
 * (moyenne pondérée, `iterations` passes, extrémités fixes), puis chaque point d'origine est replacé sur la courbe lissée
 * à sa propre distance (`distances`) — mêmes indices et mêmes distances que `points`. Un lissage par nombre de points
 * déforme un tracé aux points irréguliers (tracé de planification : longues droites à 2 points, boucles très denses) :
 * la courbe y raccourcit et ce qui la suit à vitesse constante en mètres semble ralentir à l'écran. */
export function smoothTrackPointsByDistance(points: GpxPoint[], distances: number[], radiusM: number, iterations = 3, stepM = 5): GpxPoint[] {
  const total = distances[distances.length - 1] ?? 0
  if (points.length < 3 || !(total > 0)) return points.map(p => ({ ...p }))
  const n = Math.max(2, Math.ceil(total / stepM) + 1)
  let lons = new Float64Array(n), lats = new Float64Array(n)
  for (let i = 0, seg = 1; i < n; i++) {
    const m = Math.min(total, i * stepM)
    while (seg < distances.length - 1 && distances[seg] < m) seg++
    const d0 = distances[seg - 1], d1 = distances[seg]
    const t = d1 > d0 ? (m - d0) / (d1 - d0) : 0
    const a = points[seg - 1], b = points[seg]
    lons[i] = a.lon + (b.lon - a.lon) * t
    lats[i] = a.lat + (b.lat - a.lat) * t
  }
  const r = Math.max(1, Math.round(radiusM / stepM))
  for (let iter = 0; iter < iterations; iter++) {
    const nl = lons.slice(), na = lats.slice()
    for (let i = 1; i < n - 1; i++) {
      let sl = 0, sa = 0, ws = 0
      for (let k = -r; k <= r; k++) {
        const j = i + k
        if (j < 0 || j >= n) continue
        const w = r + 1 - Math.abs(k)
        sl += lons[j] * w; sa += lats[j] * w; ws += w
      }
      nl[i] = sl / ws; na[i] = sa / ws
    }
    lons = nl; lats = na
  }
  return points.map((p, i) => {
    const x = Math.min(n - 1, distances[i] / stepM)
    const j = Math.min(n - 2, Math.floor(x)), t = x - j
    return { ...p, lon: lons[j] + (lons[j + 1] - lons[j]) * t, lat: lats[j] + (lats[j + 1] - lats[j]) * t }
  })
}

// Cumul des distances de chaque point depuis le départ
export function buildDistanceArray(points: GpxPoint[]): number[] {
  const d = [0]
  for (let i = 1; i < points.length; i++) {
    d.push(d[i - 1] + haversine(points[i - 1], points[i]))
  }
  return d
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}h${String(m).padStart(2, '0')}`
    : `${m}min${String(sec).padStart(2, '0')}`
}

export function formatSpeed(metersPerSecond: number): string {
  if (!isFinite(metersPerSecond) || metersPerSecond <= 0) return '– km/h'
  return `${(metersPerSecond * 3.6).toFixed(1)} km/h`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Reconnaît un GPX produit par buildGpxXml (enregistrement GPS en direct de l'appli) plutôt
// qu'un fichier importé d'une source tierce. Sert de rattrapage pour les tracés enregistrés
// avant l'ajout du champ VoyageTrack.source : le creator a toujours été « Sillage-Randonnée »
// (avant renommage), « Sillon-Rando » puis « Sillonphane-Rando » ; « Sillonphane-Running » pour Running.
export function isRecordedGpx(gpxData: string): boolean {
  return /creator="Sill(age-Randonnée|on-Rando|onphane-Rando|onphane-Running)"/.test(gpxData)
}

// Sérialise un tracé enregistré en direct au format GPX standard, relisible par parseGpx
export function buildGpxXml(points: GpxPoint[], name: string): string {
  const trkpts = points.map(p => {
    const time = p.time ? `<time>${p.time.toISOString()}</time>` : ''
    return `      <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele.toFixed(1)}</ele>${time}</trkpt>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Sillonphane-Running" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}
