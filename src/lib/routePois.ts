// Points d'intérêt le long du parcours (à moins de 200 m du tracé), lus dans OpenStreetMap via Overpass : monuments,
// mairie, musées, curiosités, stades, grandes places, ponts… Seuls les lieux connus sont gardés (fiche Wikidata /
// Wikipédia, ou type marquant comme une mairie ou un musée), puis espacés le long du parcours pour ne pas surcharger le
// film. Ajoutés d'office comme points d'intérêt (modifiables et supprimables dans l'assistant des panneaux).
// Mis en cache par tracé.
import type { GpxPoint } from '../types'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const LS_KEY = 'running:sillon_route_pois_'
const RADIUS_M = 200
/** Écart minimal le long du parcours entre deux points d'intérêt retenus. */
const MIN_GAP_M = 1000
/** Écart minimal à vol d'oiseau (étiquettes superposées sur la carte quand le parcours repasse au même endroit). */
const MIN_SEP_M = 300
/** Score minimal pour être retenu : une église ou un parc sans article Wikipédia n'y arrive pas. */
const MIN_SCORE = 4
/** Noms trop vagues pour un panneau (« Immeuble », « Maisons », « Hôtel particulier »…). */
const GENERIC_RE = /^(immeubles?|maisons?|hôtel particulier|bâtiments?|ensemble|monument|calvaire|croix)$/i

export interface RoutePoi { name: string; lon: number; lat: number }

/** Poids par type OSM (clé=valeur, ou clé seule pour toute valeur). */
const WEIGHTS: Record<string, number> = {
  'historic=city_gate': 3.5, 'historic=castle': 3, 'historic=fort': 3, 'historic=monument': 2.5, 'historic=citywalls': 2.5,
  // Patrimoine courant (bâtiment classé, mémorial…) : retenu seulement s'il a son article Wikipédia.
  'historic': 1,
  'tourism=museum': 3,
  // « attraction » est posé sur presque tous les monuments historiques français : peu discriminant.
  'tourism=attraction': 1.5, 'tourism=gallery': 1.5, 'tourism=artwork': 1, 'tourism=viewpoint': 1,
  'amenity=townhall': 3, 'amenity=theatre': 2.5, 'amenity=place_of_worship': 1.5,
  'leisure=stadium': 2.5, 'leisure=park': 2,
  'place=square': 2.5,
  'man_made=bridge': 1.5, 'bridge': 1,
}

function weightOf(tags: Record<string, string>): number {
  let w = 0
  for (const k of ['historic', 'tourism', 'amenity', 'leisure', 'place', 'man_made']) {
    const v = tags[k]
    if (v) w = Math.max(w, WEIGHTS[`${k}=${v}`] ?? WEIGHTS[k] ?? 0)
  }
  // Pont nommé porté par la route elle-même (way bridge=yes) : faible poids, retenu seulement s'il est connu.
  if (!w && tags.bridge && tags.bridge !== 'no') w = WEIGHTS.bridge
  return w
}

function distM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111320
}

/** Tracé allégé (un point tous les ~250 m) et distance cumulée de chaque point. */
function simplify(points: GpxPoint[]): { pts: GpxPoint[]; cum: number[] } {
  const pts: GpxPoint[] = [points[0]], cum = [0]
  let total = 0, sinceLast = 0
  for (let i = 1; i < points.length; i++) {
    const d = distM(points[i - 1].lon, points[i - 1].lat, points[i].lon, points[i].lat)
    total += d; sinceLast += d
    if (sinceLast >= 250 || i === points.length - 1) { pts.push(points[i]); cum.push(total); sinceLast = 0 }
  }
  return { pts, cum }
}

interface OverpassEl { type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

async function queryOverpass(pts: GpxPoint[]): Promise<OverpassEl[]> {
  const line = pts.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',')
  const a = `(around:${RADIUS_M},${line})`
  const query = `[out:json][timeout:40];(
nwr["name"]["historic"]${a};
nwr["name"]["tourism"~"^(museum|attraction|gallery|artwork|viewpoint)$"]${a};
nwr["name"]["amenity"~"^(townhall|theatre|place_of_worship)$"]${a};
nwr["name"]["leisure"~"^(stadium|park)$"]${a};
nwr["name"]["place"="square"]${a};
nwr["name"]["man_made"="bridge"]${a};
way["name"]["bridge"]["wikidata"]${a};
);out center tags;`
  const r = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!r.ok) throw new Error('overpass')
  const data = await r.json() as { elements?: OverpassEl[] }
  return data.elements ?? []
}

/**
 * Points d'intérêt connus à moins de 200 m du parcours, espacés d'au moins 1 km le long du tracé et à plus de 300 m
 * (à vol d'oiseau) des autres et des repères déjà posés (`existing`, ex. le repère du départ). Un pour ~4 km de course, entre 3 et 10.
 */
export async function fetchRoutePois(points: GpxPoint[], existing: RoutePoi[] = []): Promise<RoutePoi[]> {
  if (points.length < 2) return []
  const { pts, cum } = simplify(points)
  const first = points[0], last = points[points.length - 1]
  const key = `${LS_KEY}${first.lat.toFixed(4)},${first.lon.toFixed(4)}_${last.lat.toFixed(4)},${last.lon.toFixed(4)}_${Math.round(cum[cum.length - 1] / 100)}`

  let candidates: (RoutePoi & { score: number; at: number })[] | null = null
  try { const v = localStorage.getItem(key); if (v) candidates = JSON.parse(v) } catch { /* ignore */ }

  if (!candidates) {
    let els: OverpassEl[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      try { els = await queryOverpass(pts); break }
      catch { if (attempt === 0) await new Promise(r => setTimeout(r, 1500)); else return [] }
    }
    // Un même lieu est souvent découpé en plusieurs éléments OSM (la Grand-Place de Lille : une place, une attraction,
    // des morceaux de voirie) : on les réunit par nom, à moins de 500 m, en gardant le meilleur type et la fiche wiki.
    const groups: { name: string; lon: number; lat: number; weight: number; wiki: number; posW: number }[] = []
    for (const e of els) {
      const tags = e.tags ?? {}, name = tags.name
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon
      if (!name || lat == null || lon == null || GENERIC_RE.test(name.trim())) continue
      const weight = weightOf(tags)
      // Lieu connu : article Wikipédia (le meilleur indice), sinon simple fiche Wikidata.
      const wiki = tags.wikipedia ? 3 : tags.wikidata ? 1 : 0
      const g = groups.find(x => x.name === name && distM(x.lon, x.lat, lon, lat) < 500)
      if (!g) { groups.push({ name, lon, lat, weight, wiki, posW: weight }); continue }
      g.wiki = Math.max(g.wiki, wiki)
      if (weight > g.weight) g.weight = weight
      if (weight > g.posW) { g.lon = lon; g.lat = lat; g.posW = weight }
    }
    candidates = []
    for (const g of groups) {
      const score = g.weight + g.wiki
      if (score < MIN_SCORE) continue
      // Position le long du parcours : point du tracé allégé le plus proche.
      let bi = 0, bd = Infinity
      for (let i = 0; i < pts.length; i++) {
        const d = distM(g.lon, g.lat, pts[i].lon, pts[i].lat)
        if (d < bd) { bd = d; bi = i }
      }
      candidates.push({ name: g.name, lon: g.lon, lat: g.lat, score, at: cum[bi] })
    }
    try { localStorage.setItem(key, JSON.stringify(candidates)) } catch { /* stockage local plein ou indisponible */ }
  }

  const max = Math.max(3, Math.min(10, Math.round(cum[cum.length - 1] / 4000)))
  const kept: (RoutePoi & { at: number })[] = []
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (kept.length >= max) break
    if (existing.some(x => x.name === c.name || distM(x.lon, x.lat, c.lon, c.lat) < MIN_SEP_M)) continue
    if (kept.some(k => Math.abs(k.at - c.at) < MIN_GAP_M || distM(k.lon, k.lat, c.lon, c.lat) < MIN_SEP_M)) continue
    kept.push(c)
  }
  return kept.sort((a, b) => a.at - b.at).map(({ name, lon, lat }) => ({ name, lon, lat }))
}
