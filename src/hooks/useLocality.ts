import { useEffect, useMemo, useRef, useState } from 'react'
import type { GpxPoint } from '../types'

// ── Helpers géométrie ─────────────────────────────────────────────────────────
// Normalise un nom de commune : minuscules, sans accents, sans article initial
function normalizeLocalityName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''ʼ]/g, "'")
    .replace(/^(le |la |les |l')/, '')
    .replace(/[-\s]+/g, '')
    .replace(/'/g, '')
}

function approxDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = (lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180)
  const dy = (lat2 - lat1) * 110540
  return Math.sqrt(dx * dx + dy * dy)
}

function minDistToTrack(lon: number, lat: number, points: GpxPoint[]): number {
  // Distance au segment le plus proche (pas seulement au point le plus proche)
  const px = lon * 111320 * Math.cos(lat * Math.PI / 180)
  const py = lat * 110540
  let min = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i].lon   * 111320 * Math.cos(lat * Math.PI / 180)
    const ay = points[i].lat   * 110540
    const bx = points[i+1].lon * 111320 * Math.cos(lat * Math.PI / 180)
    const by = points[i+1].lat * 110540
    const dx = bx - ax, dy = by - ay
    const lenSq = dx * dx + dy * dy
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0
    const cx = ax + t * dx, cy = ay + t * dy
    const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
    if (d < min) min = d
  }
  return min
}

function smoothed(points: GpxPoint[], idx: number, r = 5): number {
  const lo = Math.max(0, idx - r), hi = Math.min(points.length - 1, idx + r)
  let s = 0; for (let i = lo; i <= hi; i++) s += points[i].ele
  return s / (hi - lo + 1)
}

// ── Toponymes OSM via Overpass (requis une seule fois à la bbox du tracé) ─────
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Score de priorité : plus haut = affiché en priorité si même distance
const TYPE_SCORE: Record<string, number> = {
  city:     6,
  town:     5,
  village:  4,
  hamlet:   3,
  locality: 2,
}

// Proximité max par type (mètres)
// Distance max entre le centre du lieu et le tracé (pré-filtre)
const TRACK_DIST_RANDO: Record<string, number> = {
  city:     5000,
  town:     3000,
  village:   500,
  hamlet:    300,
  locality:  200,
}

// Distance max entre le curseur et le centre du lieu (déclenchement animation)
const TYPE_PROXIMITY_RANDO: Record<string, number> = {
  city:    5000,
  town:    3000,
  village:  800,
  hamlet:   400,
  locality: 300,
}

interface OsmToponym {
  name: string
  lon: number
  lat: number
  type: string
  score: number       // type + importance OSM
}

// Cache par bbox — en mémoire + localStorage (survit au rechargement)
const bboxCache = new Map<string, Promise<OsmToponym[]>>()
const LS_BBOX = 'sillon_bbox_'

function lsGetBbox(key: string): OsmToponym[] | null {
  try { const v = localStorage.getItem(LS_BBOX + key); return v ? JSON.parse(v) : null } catch { return null }
}
function lsSetBbox(key: string, val: OsmToponym[]) {
  try { localStorage.setItem(LS_BBOX + key, JSON.stringify(val)) } catch { /* stockage local plein ou indisponible */ }
}

function bboxKey(points: GpxPoint[]): string {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  return `${minLat.toFixed(3)},${minLon.toFixed(3)},${maxLat.toFixed(3)},${maxLon.toFixed(3)}`
}

async function doOverpassFetch(points: GpxPoint[]): Promise<OsmToponym[]> {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  const M = 0.045 // ~5 km
  const bbox = `${(minLat - M).toFixed(4)},${(minLon - M).toFixed(4)},${(maxLat + M).toFixed(4)},${(maxLon + M).toFixed(4)}`
  const query = `[out:json][timeout:30];node["place"~"^(city|town|village|hamlet|locality)$"](${bbox});out body;`
  const r = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'sillon/1.0' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!r.ok) return []
  const data = await r.json()
  const ROAD_RE = /^(ancien(ne)?s?\s+|vieux?\s+|grand[e]?\s+)?(chemin|route|voie|sentier|allée|rue|avenue|boulevard|passage|impasse|draille|draye|piste|chemin\s+de|route\s+de|route\s+du|route\s+des|route\s+d')\b/i
  return (data.elements ?? [])
    .filter((e: { type: string; tags?: { name?: string; place?: string } }) =>
      e.type === 'node' && e.tags?.name && e.tags?.place && !ROAD_RE.test(e.tags.name ?? '')
    )
    .map((e: { tags: Record<string, string>; lon: number; lat: number }) => {
      const pop = parseInt(e.tags.population ?? '0') || 0
      const baseScore = TYPE_SCORE[e.tags.place] ?? 0
      const popBonus = pop > 0 ? Math.min(2, Math.log10(pop) / 2) : 0
      return { name: e.tags.name, lon: e.lon, lat: e.lat, type: e.tags.place, score: baseScore + popBonus }
    })
    .filter((t: OsmToponym, _: number, all: OsmToponym[]) => {
      if (t.type !== 'hamlet' && t.type !== 'locality') return true
      return !all.some(other => {
        if (other.type !== 'city' && other.type !== 'town' && other.type !== 'village') return false
        const dlat = (t.lat - other.lat) * Math.PI / 180
        const dlon = (t.lon - other.lon) * Math.PI / 180
        const dist = Math.sqrt(dlat * dlat + dlon * dlon) * 6371000
        const limit = other.type === 'city' ? 3000 : other.type === 'town' ? 1500 : 500
        return dist < limit
      })
    })
}

export async function prefetchToponyms(points: GpxPoint[]): Promise<void> {
  if (points.length < 2) return
  fetchToponymsForTrack(points).catch(() => {})
}

async function fetchToponymsForTrack(points: GpxPoint[]): Promise<OsmToponym[]> {
  const key = bboxKey(points)
  if (bboxCache.has(key)) return bboxCache.get(key)!

  // Vérifier le cache localStorage avant de faire le réseau
  const lsCached = lsGetBbox(key)
  if (lsCached && lsCached.length > 0) {
    const p = Promise.resolve(lsCached)
    bboxCache.set(key, p)
    return p
  }

  // Retry automatique : jusqu'à 3 tentatives avec délai croissant si résultat vide
  const p = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt))
      try {
        const result = await doOverpassFetch(points)
        if (result.length > 0) { lsSetBbox(key, result); return result }
      } catch { /* retry */ }
    }
    return []
  })()

  bboxCache.set(key, p)
  p.then(result => { if (result.length === 0) bboxCache.delete(key) })
  return p
}

// ── Départ / arrivée : Photon (stable, résultats fiables) ────────────────────
const HAMLET_TYPES = new Set(['village', 'town', 'city', 'hamlet', 'locality', 'isolated_dwelling'])
const COMMUNE_TYPES = new Set(['village', 'town', 'city'])
/** Types OSM affichés en panneau lieu-dit (orange, italique) plutôt qu'en panneau de localité. */
export function isLieuditPlaceType(t?: string): boolean {
  return t === 'hamlet' || t === 'locality' || t === 'isolated_dwelling'
}

export interface EndpointPlace { name: string; lon: number; lat: number; placeType?: string }

async function fetchHamlet(lon: number, lat: number): Promise<EndpointPlace | null> {
  const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=20`)
  const data = await r.json()
  const feat = (data.features ?? []).find((f: { properties: { osm_key?: string; osm_value?: string } }) =>
    f.properties.osm_key === 'place' && HAMLET_TYPES.has(f.properties.osm_value ?? '')
  )
  if (!feat) return null
  const [flon, flat] = feat.geometry.coordinates as [number, number]
  return { name: feat.properties.name ?? '', lon: flon, lat: flat, placeType: feat.properties.osm_value }
}

// ── Commune (géocodage inverse) ───────────────────────────────────────────────
// Source principale : géocodage inverse de la Géoplateforme IGN (data.geopf.fr, licence Etalab,
// sans clé, CGU 50 req/s par IP). Index `parcel` : la parcelle cadastrale la plus proche porte
// toujours le nom de sa commune (`city`), y compris en pleine montagne loin de toute adresse
// (l'index `address` y renvoie une liste vide ; l'index `poi` renvoie le chef-lieu le plus proche,
// qui n'est pas forcément la commune où l'on se trouve). Le cadastre ne couvre que la France :
// hors de France (ou en mer), la liste revient vide, et seulement là on se replie sur Nominatim.
interface CommunePlace { name: string; lon: number; lat: number }

async function fetchCommuneIgn(lon: number, lat: number): Promise<string> {
  const r = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${lon}&lat=${lat}&index=parcel&limit=1`)
  if (!r.ok) throw new Error(`IGN ${r.status}`)   // erreur réseau/serveur : pas mise en cache
  const d = await r.json() as { features?: Array<{ properties?: { city?: string } }> }
  return (d.features?.[0]?.properties?.city ?? '').trim()
}

// Nominatim (repli hors de France) : politique d'usage ≤ 1 requête/s. File sérialisée au niveau
// du module : chaque appel attend la fin du précédent + 1,1 s, quel que soit l'appelant.
const NOMINATIM_GAP_MS = 1100
let nominatimQueue: Promise<unknown> = Promise.resolve()
function fetchCommuneNominatim(lon: number, lat: number): Promise<string> {
  const run = async () => {
    const nr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=10`, {
      headers: { 'Accept-Language': 'fr' },
    })
    if (!nr.ok) throw new Error(`Nominatim ${nr.status}`)
    const nd = await nr.json()
    const a = nd?.address ?? {}
    return String(a.village ?? a.town ?? a.city ?? a.municipality ?? '').trim()
  }
  const p = nominatimQueue.then(run)
  // Le créneau suivant s'ouvre 1,1 s après la fin de celui-ci, succès ou échec.
  nominatimQueue = p.catch(() => {}).then(() => new Promise(res => setTimeout(res, NOMINATIM_GAP_MS)))
  return p
}

async function fetchCommuneUncached(lon: number, lat: number): Promise<CommunePlace | null> {
  let name = await fetchCommuneIgn(lon, lat)
  if (!name) name = await fetchCommuneNominatim(lon, lat)
  if (!name) return null
  // Chercher les coordonnées OSM du centre via Photon (le bourg, pas le centroïde de la commune)
  const pr = await fetch(`https://photon.komoot.io/api?q=${encodeURIComponent(name)}&limit=10&lang=fr`)
  const pd = await pr.json()
  const placeFeat = (pd.features ?? []).find((f: { properties: { osm_value?: string; name?: string }; geometry: { coordinates: [number, number] } }) => {
    if (!COMMUNE_TYPES.has(f.properties.osm_value ?? '')) return false
    if ((f.properties.name ?? '').toLowerCase() !== name.toLowerCase()) return false
    const [flon, flat] = f.geometry.coordinates
    return approxDist(lon, lat, flon, flat) < 50000
  })
  const coords: [number, number] = placeFeat?.geometry?.coordinates ?? [lon, lat]
  return { name, lon: coords[0], lat: coords[1] }
}

// Cache : Map mémoire (promesse partagée, donc dédoublonnage des appels concurrents — Promise.all
// départ/arrivée, réessais, repli de cachedPhotonFetch) + localStorage. Clé arrondie à 3 décimales
// (≈ 100 m). Le résultat « pas de commune » est mis en cache aussi ({ v: null }) ; seules les
// erreurs réseau/HTTP ne le sont pas (la promesse est retirée de la Map pour permettre un réessai).
const communeCache = new Map<string, Promise<CommunePlace | null>>()
const COMMUNE_LS_PREFIX = 'sillon_com1_'

function fetchCommune(lon: number, lat: number): Promise<CommunePlace | null> {
  const key = `${lon.toFixed(3)},${lat.toFixed(3)}`
  const inMem = communeCache.get(key)
  if (inMem) return inMem
  try {
    const raw = localStorage.getItem(COMMUNE_LS_PREFIX + key)
    if (raw) {
      const stored = JSON.parse(raw) as { v: CommunePlace | null }
      if (stored && 'v' in stored) {
        const p = Promise.resolve(stored.v)
        communeCache.set(key, p)
        return p
      }
    }
  } catch { /* localStorage indisponible ou entrée corrompue : on regéocode */ }
  const p = fetchCommuneUncached(lon, lat).then(
    v => {
      try { localStorage.setItem(COMMUNE_LS_PREFIX + key, JSON.stringify({ v })) } catch { /* quota */ }
      return v
    },
    e => { communeCache.delete(key); throw e },
  )
  communeCache.set(key, p)
  return p
}

// Choisit le meilleur lieu Overpass dans un rayon de l'endpoint (score + proximité)
function bestEndpointPlace(
  lon: number, lat: number,
  toponyms: OsmToponym[],
  commune: CommunePlace | null,
  radiusM = 2000,
): { name: string; lon: number; lat: number; score: number } | null {
  let best: OsmToponym | null = null
  let bestCombined = -Infinity
  for (const t of toponyms) {
    const dist = approxDist(lon, lat, t.lon, t.lat)
    if (dist > radiusM) continue
    const combined = t.score * 1000 - dist   // même formule que la détection animée
    if (combined > bestCombined) { bestCombined = combined; best = t }
  }
  if (best) return { name: best.name, lon: best.lon, lat: best.lat, score: best.score }
  if (commune) return { name: commune.name, lon: commune.lon, lat: commune.lat, score: TYPE_SCORE.village }
  return null
}

const localityCache = new Map<string, Promise<EndpointPlace | null>>()
// v2 : l'entrée garde le type OSM (placeType) ; les anciennes entrées sans type sont regéocodées.
const LS_PREFIX = 'sillon_loc2_'

function lsGet(key: string) {
  try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : null } catch { return null }
}
function lsSet(key: string, val: EndpointPlace) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)) } catch { /* stockage local plein ou indisponible */ }
}

function cachedPhotonFetch(lon: number, lat: number): Promise<EndpointPlace | null> {
  const key = `${lon.toFixed(4)},${lat.toFixed(4)}`
  if (!localityCache.has(key)) {
    const cached = lsGet(key)
    if (cached) {
      localityCache.set(key, Promise.resolve(cached))
    } else {
      localityCache.set(key,
        fetchHamlet(lon, lat)
          .then(r => r?.name ? r : fetchCommune(lon, lat).then(c => c && { ...c, placeType: 'village' }))
          .then(r => { if (r?.name) lsSet(key, r); return r?.name ? r : null })
          .catch(() => null)
      )
    }
  }
  return localityCache.get(key)!
}

export async function fetchLocalityName(lon: number, lat: number): Promise<string | null> {
  const r = await cachedPhotonFetch(lon, lat)
  return r?.name ?? null
}

export async function fetchLocalityInfo(lon: number, lat: number): Promise<EndpointPlace | null> {
  return cachedPhotonFetch(lon, lat)
}

// ── Cols ──────────────────────────────────────────────────────────────────────
interface ColInfo { idx: number; dist: number; ele: number; lon: number; lat: number }

function findCols(points: GpxPoint[], distances: number[]): ColInfo[] {
  if (points.length < 20) return []
  const WIN = 800, DROP = 30
  const cols: ColInfo[] = []
  for (let i = 5; i < points.length - 5; i++) {
    const d = distances[i]
    const ele = smoothed(points, i)
    let lo = i, hi = i
    while (lo > 0 && d - distances[lo] < WIN) lo--
    while (hi < points.length - 1 && distances[hi] - d < WIN) hi++
    let isMax = true
    for (let j = lo; j <= hi; j++) {
      if (smoothed(points, j) > ele + 6) { isMax = false; break }
    }
    if (!isMax) continue
    if (ele - smoothed(points, lo) < DROP) continue
    if (ele - smoothed(points, hi) < DROP) continue
    const last = cols[cols.length - 1]
    if (last && d - last.dist < 500) {
      if (ele > last.ele) cols[cols.length - 1] = { idx: i, dist: d, ele: Math.round(points[i].ele), lon: points[i].lon, lat: points[i].lat }
      continue
    }
    cols.push({ idx: i, dist: d, ele: Math.round(points[i].ele), lon: points[i].lon, lat: points[i].lat })
  }
  return cols
}

const LS_COL = 'sillon_col_'
function lsGetCol(key: string) { try { const v = localStorage.getItem(LS_COL + key); return v ? JSON.parse(v) : null } catch { return null } }
function lsSetCol(key: string, val: { name: string; lon: number; lat: number }) { try { localStorage.setItem(LS_COL + key, JSON.stringify(val)) } catch { /* stockage local plein ou indisponible */ } }

async function fetchColName(lon: number, lat: number): Promise<{ name: string; lon: number; lat: number }> {
  const cacheKey = `${lon.toFixed(4)},${lat.toFixed(4)}`
  const cached = lsGetCol(cacheKey)
  if (cached) return cached
  const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=20`)
  const data = await r.json()
  const feat = (data.features ?? []).find((f: { properties: { osm_value?: string; osm_key?: string; name?: string } }) => {
    const v = f.properties.osm_value ?? ''
    const k = f.properties.osm_key ?? ''
    const n = (f.properties.name ?? '').toLowerCase()
    return v === 'saddle' || k === 'mountain_pass'
      || (k === 'natural' && (n.startsWith('col ') || n.startsWith('col d') || n.startsWith('pas ') || n.startsWith('port ')))
  })
  if (feat) {
    const [flon, flat] = feat.geometry.coordinates as [number, number]
    // Rejeter si le col OSM est à plus de 400m du point du tracé
    const R = 6371000
    const dLat = (flat - lat) * Math.PI / 180
    const dLon = (flon - lon) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(lat * Math.PI/180) * Math.cos(flat * Math.PI/180) * Math.sin(dLon/2)**2
    const distM = R * 2 * Math.asin(Math.sqrt(a))
    if (distM <= 400) {
      const result = { name: feat.properties.name ?? 'Col', lon: flon, lat: flat }
      lsSetCol(cacheKey, result)
      return result
    }
  }
  const fallback = { name: 'Col', lon, lat }
  lsSetCol(cacheKey, fallback)
  return fallback
}

// Géocodage direct d'un col nommé par l'utilisateur (panneau ajouté à la main) : cherche le
// toponyme sur Photon, biaisé vers le tracé, puis le rattache au point du tracé le plus proche.
// Renvoie null si rien de crédible n'est trouvé (l'appelant garde alors sa position de repli).
const LS_COL_FWD = 'sillon_colfwd_'
export async function fetchColLatLonByName(
  name: string,
  points: GpxPoint[],
): Promise<{ lon: number; lat: number } | null> {
  const q = name.trim()
  if (!q || points.length < 2) return null

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  const cLon = (minLon + maxLon) / 2, cLat = (minLat + maxLat) / 2
  const cacheKey = LS_COL_FWD + `${q.toLowerCase()}|${cLat.toFixed(2)},${cLon.toFixed(2)}`
  let cached: { lon: number; lat: number } | null = null
  try { const v = localStorage.getItem(cacheKey); cached = v ? JSON.parse(v) : null } catch { /* ignore */ }
  if (cached && minDistToTrack(cached.lon, cached.lat, points) < 4000) {
    return snapToTrack(cached.lon, cached.lat, points)
  }

  const nq = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  try {
    const r = await fetch(
      `https://photon.komoot.io/api?q=${encodeURIComponent(q)}&lat=${cLat}&lon=${cLon}&limit=15&lang=fr`,
    )
    const data = await r.json()
    type Feat = { properties: { osm_value?: string; osm_key?: string; name?: string }; geometry: { coordinates: [number, number] } }
    let best: { lon: number; lat: number } | null = null
    let bestDist = Infinity
    for (const f of (data.features ?? []) as Feat[]) {
      const [flon, flat] = f.geometry.coordinates
      const v = f.properties.osm_value ?? '', k = f.properties.osm_key ?? ''
      const fn = (f.properties.name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const looksLikeCol = v === 'saddle' || k === 'mountain_pass'
        || fn.startsWith('col ') || fn.startsWith('pas ') || fn.startsWith('port ') || fn.startsWith('collet ')
      const nameMatches = fn === nq || fn.includes(nq) || nq.includes(fn)
      if (!looksLikeCol && !nameMatches) continue
      const dTrack = minDistToTrack(flon, flat, points)
      if (dTrack > 4000) continue
      if (dTrack < bestDist) { bestDist = dTrack; best = { lon: flon, lat: flat } }
    }
    if (best) {
      try { localStorage.setItem(cacheKey, JSON.stringify(best)) } catch { /* ignore */ }
      return snapToTrack(best.lon, best.lat, points)
    }
  } catch { /* réseau indisponible — repli côté appelant */ }
  return null
}

/** Rattache un point (lon/lat) au sommet du tracé le plus proche. */
function snapToTrack(lon: number, lat: number, points: GpxPoint[]): { lon: number; lat: number } {
  let bestIdx = 0, bestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = approxDist(lon, lat, points[i].lon, points[i].lat)
    if (d < bestD) { bestD = d; bestIdx = i }
  }
  return { lon: points[bestIdx].lon, lat: points[bestIdx].lat }
}

// Cols OSM au ras du tracé : un col en replat (sentier en balcon, montée qui continue après le col) n'est pas un
// sommet du profil d'altitude et échappe à findCols — on le retrouve donc directement dans OSM.
const PASS_MAX_TRACK_DIST = 150 // m entre le nœud OSM du col et le tracé
const PASS_NAME_RE = /^(col|pas|port|collet|br[eè]che|passo)\b/i
const LS_PASSES = 'sillon_passes_'
const passCache = new Map<string, Promise<ColMarker[]>>()

async function fetchOsmPassesNearTrack(points: GpxPoint[]): Promise<ColMarker[]> {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  const key = LS_PASSES + bboxKey(points)
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v) } catch { /* ignore */ }
  const M = 0.003 // ~300 m
  const bbox = `${(minLat - M).toFixed(4)},${(minLon - M).toFixed(4)},${(maxLat + M).toFixed(4)},${(maxLon + M).toFixed(4)}`
  const query = `[out:json][timeout:30];(node["mountain_pass"="yes"]["name"](${bbox});node["natural"="saddle"]["name"](${bbox}););out body;`
  const r = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'sillon/1.0' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!r.ok) throw new Error('overpass')
  const data = await r.json()
  const out: ColMarker[] = []
  for (const e of (data.elements ?? []) as { type: string; lon: number; lat: number; tags?: Record<string, string> }[]) {
    const name = e.tags?.name
    if (e.type !== 'node' || !name) continue
    if (e.tags?.mountain_pass !== 'yes' && !PASS_NAME_RE.test(name)) continue
    if (minDistToTrack(e.lon, e.lat, points) > PASS_MAX_TRACK_DIST) continue
    let idx = 0, best = Infinity
    for (let i = 0; i < points.length; i++) {
      const d = approxDist(e.lon, e.lat, points[i].lon, points[i].lat)
      if (d < best) { best = d; idx = i }
    }
    out.push({ idx, ele: Math.round(points[idx].ele), lon: e.lon, lat: e.lat, name })
  }
  try { localStorage.setItem(key, JSON.stringify(out)) } catch { /* ignore */ }
  return out
}

function osmPassesForTrack(points: GpxPoint[]): Promise<ColMarker[]> {
  const key = bboxKey(points)
  if (!passCache.has(key)) {
    const p = fetchOsmPassesNearTrack(points).catch(() => { passCache.delete(key); return [] as ColMarker[] })
    passCache.set(key, p)
  }
  return passCache.get(key)!
}

export interface ColMarker {
  idx: number; ele: number; lon: number; lat: number; name: string
}

export function useColMarkers(points: GpxPoint[], distances: number[]): ColMarker[] {
  const cols = useMemo(() => findCols(points, distances), [points, distances])
  const [colMarkers, setColMarkers] = useState<ColMarker[]>([])
  const [osmPasses, setOsmPasses] = useState<ColMarker[]>([])

  useEffect(() => {
    if (cols.length === 0) { setColMarkers([]); return }
    const results: ColMarker[] = cols.map(c => ({ ...c, name: 'Col' }))
    setColMarkers([...results])
    cols.forEach((col, i) => {
      fetchColName(col.lon, col.lat)
        .then(({ name, lon, lat }) => {
          // Col OSM trouvé près du point haut : altitude (et index) du point du tracé le plus proche du col,
          // pas celle du point haut, qui peut être un sommet voisin (ex. 1441 m pour le col du Béal à 1390 m).
          let idx = results[i].idx
          if (name !== 'Col') {
            let best = Infinity
            for (let j = 0; j < points.length; j++) {
              const d = approxDist(lon, lat, points[j].lon, points[j].lat)
              if (d < best) { best = d; idx = j }
            }
          }
          results[i] = { ...results[i], name, lon, lat, idx, ele: Math.round(points[idx].ele) }
          setColMarkers([...results])
        })
        .catch(() => {})
    })
  }, [cols]) // eslint-disable-line react-hooks/exhaustive-deps -- points : dérivés dans cols

  useEffect(() => {
    setOsmPasses([])
    if (points.length < 20) return
    let cancelled = false
    osmPassesForTrack(points).then(p => { if (!cancelled) setOsmPasses(p) })
    return () => { cancelled = true }
  }, [points])

  // Un col OSM déjà couvert par un sommet détecté (même nom, ou à moins de 400 m) n'est pas ajouté deux fois.
  return useMemo(() => {
    const extra = osmPasses.filter(p => !colMarkers.some(c =>
      normalizeLocalityName(c.name) === normalizeLocalityName(p.name)
      || approxDist(c.lon, c.lat, p.lon, p.lat) < 400))
    return extra.length ? [...colMarkers, ...extra].sort((a, b) => a.idx - b.idx) : colMarkers
  }, [colMarkers, osmPasses])
}

/** Col nommé situé au départ ou à l'arrivée du tracé (à moins de 300 m du point extrême) : le panneau
 * de départ/arrivée prend alors son nom et le style col plutôt que celui de la localité voisine. */
const ENDPOINT_COL_RADIUS = 300
export function endpointCol(colMarkers: ColMarker[], point: GpxPoint | undefined): ColMarker | null {
  if (!point) return null
  let best: ColMarker | null = null, bestD = ENDPOINT_COL_RADIUS
  for (const c of colMarkers) {
    if (c.name === 'Col') continue
    const d = approxDist(c.lon, c.lat, point.lon, point.lat)
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LocalityInfo {
  type: 'locality' | 'col'
  name: string
  ele?: number
  lon: number
  lat: number
  placeType?: string  // city | town | village | hamlet
  /** Panneau ajouté déplacé à la main (glissé sur la carte, ou déposé depuis la liste) : position à conserver telle
   *  quelle, jamais remplacée par le géocodage du nom (cols). */
  userPlaced?: boolean
  score?: number
}

export interface LocalityResult {
  current: LocalityInfo | null
}

// Seuil de déclenchement (distance parcourue entre deux détections)
const TRIGGER_RANDO = 400   // m — vérification tous les 400m

// ── Pré-calcul de toutes les localités du tracé ───────────────────────────────
export async function computeAllLocalities(
  points: GpxPoint[],
  distances: number[],
  _mode: 'randonneur',
  _lookahead: number,
): Promise<LocalityInfo[]> {
  if (points.length < 2) return []

  const last = points[points.length - 1]
  const [toponyms, depNom, arrNom] = await Promise.all([
    fetchToponymsForTrack(points),
    fetchCommune(points[0].lon, points[0].lat),
    fetchCommune(last.lon, last.lat),
  ])
  // Préfère le meilleur lieu Overpass dans 2km de l'endpoint sur la commune (IGN)
  const departureInfo = bestEndpointPlace(points[0].lon, points[0].lat, toponyms, depNom)
  const arrivalInfo   = bestEndpointPlace(last.lon, last.lat, toponyms, arrNom)
  const total = distances[distances.length - 1] || 1

  const filtered = toponyms.filter(t => {
    const d = minDistToTrack(t.lon, t.lat, points)
    const limit = TRACK_DIST_RANDO[t.type] ?? 200
    return d < limit
  })

  const LOOKAHEAD = 150
  const proximityTable = TYPE_PROXIMITY_RANDO
  // Échantillonnage plus fin que le trigger d'affichage (400m) pour ne manquer aucun
  // lieu candidat que la lecture en direct pourrait détecter entre deux points de grille
  const PRECOMPUTE_STEP = 50

  const results: LocalityInfo[] = []
  const shownNames = new Set<string>()

  for (let covered = PRECOMPUTE_STEP; covered <= total; covered += PRECOMPUTE_STEP) {
    const ghostDist = Math.min(covered + LOOKAHEAD, total)
    let lon = points[0].lon, lat = points[0].lat
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] >= ghostDist) {
        const t2 = (ghostDist - distances[i - 1]) / (distances[i] - distances[i - 1])
        lon = points[i - 1].lon + t2 * (points[i].lon - points[i - 1].lon)
        lat = points[i - 1].lat + t2 * (points[i].lat - points[i - 1].lat)
        break
      }
    }

    let best: OsmToponym | null = null
    let bestScore = -1
    for (const t of filtered) {
      const proximity = proximityTable[t.type] ?? 300
      const dist = approxDist(lon, lat, t.lon, t.lat)
      if (dist > proximity) continue
      const combined = t.score * 1000 - dist
      if (combined > bestScore) { bestScore = combined; best = t }
    }

    if (best && !shownNames.has(best.name)) {
      shownNames.add(best.name)
      results.push({ type: 'locality', name: best.name, lon: best.lon, lat: best.lat, placeType: best.type, score: best.score })
    }
  }

  // Injecte la commune de départ en tête si absente
  if (departureInfo?.name && !results.some(r => r.name === departureInfo.name)) {
    results.unshift({ type: 'locality', name: departureInfo.name, lon: departureInfo.lon, lat: departureInfo.lat, placeType: 'village', score: 4 })
  }
  // Injecte la commune d'arrivée en queue si absente et différente du départ
  if (arrivalInfo?.name && arrivalInfo.name !== departureInfo?.name && !results.some(r => r.name === arrivalInfo.name)) {
    results.push({ type: 'locality', name: arrivalInfo.name, lon: arrivalInfo.lon, lat: arrivalInfo.lat, placeType: 'village', score: 4 })
  }

  // Supprime les localités intermédiaires trop proches du départ ou de l'arrivée (< 1 km)
  // pour éviter les doublons visuels avec les marqueurs endpoint
  const ENDPOINT_EXCLUSION_RADIUS = 1000
  const depPoint = points[0]
  const arrPoint = points[points.length - 1]
  const filtered2 = results.filter((r, i) => {
    const isEndpoint = i === 0 || i === results.length - 1
    if (isEndpoint) return true
    const nearDep = approxDist(r.lon, r.lat, depPoint.lon, depPoint.lat) < ENDPOINT_EXCLUSION_RADIUS
    const nearArr = approxDist(r.lon, r.lat, arrPoint.lon, arrPoint.lat) < ENDPOINT_EXCLUSION_RADIUS
    return !nearDep && !nearArr
  })

  return filtered2
}

// ── Localité dynamique ────────────────────────────────────────────────────────
export function useLocality(
  markerPosition: GpxPoint | null,
  points: GpxPoint[],
  distances: number[],
  progress: number,
  mode: 'randonneur' = 'randonneur',
  _lookahead = 1000,
  departureOverride?: string,
  arrivalOverride?: string,
): LocalityResult {
  const [current, setCurrent] = useState<LocalityInfo | null>(null)
  const lastDistRef      = useRef(0)
  const currentKeyRef    = useRef('')
  const toponymsRef      = useRef<OsmToponym[]>([])
  const departureRef     = useRef<OsmToponym | null>(null)
  const arrivalRef       = useRef<OsmToponym | null>(null)

  // Télécharge les toponymes OSM à la bbox du tracé au chargement
  useEffect(() => {
    setCurrent(null)
    lastDistRef.current = 0
    currentKeyRef.current = ''
    toponymsRef.current = []
    departureRef.current = null
    arrivalRef.current = null
    if (points.length < 2) return

    const last = points[points.length - 1]

    fetchToponymsForTrack(points).then(async toponyms => {
      toponymsRef.current = toponyms.filter(t => {
        const d = minDistToTrack(t.lon, t.lat, points)
        const limit = TRACK_DIST_RANDO[t.type] ?? 200
        return d < limit
      })
      lastDistRef.current = 0
      currentKeyRef.current = ''

      const [depNom, arrNom] = await Promise.all([
        fetchCommune(points[0].lon, points[0].lat).catch(() => null),
        fetchCommune(last.lon, last.lat).catch(() => null),
      ])
      const dep = bestEndpointPlace(points[0].lon, points[0].lat, toponyms, depNom)
      const arr = bestEndpointPlace(last.lon, last.lat, toponyms, arrNom)
      if (dep) departureRef.current = { name: dep.name, lon: dep.lon, lat: dep.lat, type: 'village', score: dep.score }
      if (arr) arrivalRef.current   = { name: arr.name, lon: arr.lon, lat: arr.lat, type: 'village', score: arr.score }
    }).catch(() => {})
  }, [points, mode])

  useEffect(() => {
    if (!markerPosition || points.length < 2) return
    if (progress < 0.01) {
      lastDistRef.current = 0
      currentKeyRef.current = ''
      setCurrent(null)
      return
    }
    // Au tout début de l'animation, afficher la localité de départ (une seule fois)
    if (progress < 0.08 && currentKeyRef.current === '') {
      const dep = departureRef.current
      const name = departureOverride || dep?.name
      const lon = dep?.lon ?? points[0].lon
      const lat = dep?.lat ?? points[0].lat
      if (name) {
        setCurrent({ type: 'locality', name, lon, lat, placeType: dep?.type ?? 'village', score: dep?.score ?? 4 })
        currentKeyRef.current = `loc:${name}`
      }
    }
    // À la fin de l'animation, afficher la commune d'arrivée
    if (progress >= 0.97) {
      const arr = arrivalRef.current
      const last = points[points.length - 1]
      const name = arrivalOverride || arr?.name
      const key = `loc:${name}`
      if (name && currentKeyRef.current !== key) {
        setCurrent({ type: 'locality', name, lon: arr?.lon ?? last.lon, lat: arr?.lat ?? last.lat, placeType: arr?.type ?? 'village', score: arr?.score ?? 4 })
        currentKeyRef.current = key
      }
    }
    if (progress >= 0.99) return

    const total   = distances[distances.length - 1] || 1
    const covered = progress * total
    const trigger = TRIGGER_RANDO

    if (Math.abs(covered - lastDistRef.current) < trigger) return

    const toponyms = toponymsRef.current
    // Ne pas avancer lastDistRef si le fetch n'est pas encore terminé —
    // le reset dans le .then() redéclenchera depuis la position courante
    if (toponyms.length === 0) return

    lastDistRef.current = covered

    const LOOKAHEAD = 150 // m
    const ghostDist = Math.min(covered + LOOKAHEAD, total)
    let lon = markerPosition.lon, lat = markerPosition.lat
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] >= ghostDist) {
        const t = (ghostDist - distances[i - 1]) / (distances[i] - distances[i - 1])
        lon = points[i - 1].lon + t * (points[i].lon - points[i - 1].lon)
        lat = points[i - 1].lat + t * (points[i].lat - points[i - 1].lat)
        break
      }
    }

    let best: OsmToponym | null = null
    let bestScore = -1

    for (const t of toponyms) {
      const proximity = TYPE_PROXIMITY_RANDO[t.type] ?? 300
      const dist = approxDist(lon, lat, t.lon, t.lat)
      if (dist > proximity) continue

      // Score combiné : type + proximité inverse (plus proche = meilleur)
      const combined = t.score * 1000 - dist
      if (combined > bestScore) {
        bestScore = combined
        best = t
      }
    }

    if (!best) return

    // Supprimer les hameaux/lieux-dits dans un rayon de 2km autour d'un endpoint (réduire le bruit)
    // Les villages, bourgs et villes proches d'un endpoint restent affichés
    const isMinorPlace = best.type === 'hamlet' || best.type === 'locality'
    if (isMinorPlace) {
      const anchors = [departureRef.current, arrivalRef.current].filter(Boolean) as OsmToponym[]
      const suppressed = anchors.some(anchor => {
        if (anchor.name === best!.name) return false
        return approxDist(anchor.lon, anchor.lat, best!.lon, best!.lat) < 2000
      })
      if (suppressed) return
    }

    // Si ce lieu est le nom d'arrivée ou de départ, ne pas l'afficher maintenant (le panneau dédié prime)
    if (arrivalOverride && best.name === arrivalOverride) return
    if (departureOverride && best.name === departureOverride) return

    setCurrent({ type: 'locality', name: best.name, lon: best.lon, lat: best.lat, placeType: best.type, score: best.score })
  }, [progress, markerPosition, points, distances, mode, departureOverride, arrivalOverride])

  return { current }
}
