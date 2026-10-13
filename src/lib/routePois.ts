// Points d'intérêt le long du parcours (à moins de 100 m du tracé), lus dans OpenStreetMap via Overpass : monuments,
// mairie, musées, curiosités, stades, places, ponts… Seuls les lieux connus sont gardés (fiche Wikidata /
// Wikipédia, ou type marquant comme une mairie, un musée ou une place), puis espacés le long du parcours pour ne pas surcharger le
// film. Ajoutés d'office comme points d'intérêt (modifiables et supprimables dans l'assistant des panneaux).
// Mis en cache par tracé.
import type { GpxPoint } from '../types'
import { ignStreetName, isPlaceName, type StreetRun } from './routeStreets'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
// v3 : lieux moins connus gardés aussi en cache (liste « Lieux connus » de l'assistant des panneaux).
// v4 : places des petites communes rangées parmi les lieux moins connus.
const LS_KEY = 'running:sillon_route_pois4_'
const RADIUS_M = 100
/** Écart minimal le long du parcours entre deux points d'intérêt retenus. */
const MIN_GAP_M = 1000
/** Écart minimal à vol d'oiseau (étiquettes superposées sur la carte quand le parcours repasse au même endroit). */
const MIN_SEP_M = 300
/** Score minimal pour être retenu : une église ou un parc sans article Wikipédia n'y arrive pas. */
const MIN_SCORE = 4
/** Score minimal pour figurer dans la liste de l'assistant, parmi les « lieux moins connus ». */
const LIST_MIN_SCORE = 2
/** Noms trop vagues pour un panneau (« Immeuble », « Maisons », « Hôtel particulier »…). */
const GENERIC_RE = /^(immeubles?|maisons?|hôtel particulier|bâtiments?|ensemble|monument|calvaire|croix)$/i
/** Nom d'une place : la voie qui la borde (« Place de la Gare », souvent une simple rue dans OSM) compte comme la place. */
const SQUARE_NAME_RE = /^(place |parvis |esplanade |grand[- '’]?place)/i
/** Une place n'est ajoutée d'office que dans une commune importante (ville, bourg, village d'au moins 1 500 habitants) ;
 * ailleurs (« Place de l'Église » d'un hameau), elle reste à valider dans l'assistant. */
const IMPORTANT_VILLAGE_POP = 1500
/** Distance max entre une place et le centre (nœud OSM) de sa commune. */
const COMMUNE_RADIUS_M = 3000

export interface RoutePoi { name: string; lon: number; lat: number }
/** Lieu trouvé le long du parcours : position sur le tracé (m depuis le départ) et notoriété. */
export interface RoutePoiCandidate extends RoutePoi { at: number; score: number }

/** Lieu assez connu pour être ajouté d'office (les autres sont listés comme « moins connus »). */
export function isWellKnownPoi(c: RoutePoiCandidate): boolean {
  return c.score >= MIN_SCORE
}

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
  // Place : repère de coureur (Grand-Place, place de la Gare), retenue même sans article Wikipédia.
  'place=square': 4,
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
  if (tags.name && SQUARE_NAME_RE.test(tags.name)) w = Math.max(w, WEIGHTS['place=square'])
  return w
}

/** Place déjà écrite sur le tracé comme rue empruntée (« PL DU GENERAL DE GAULLE » en cercle) : son point d'intérêt
 * ferait doublon. Même nom au format IGN, ou lieu nommé comme une place (« Grand-Place ») à moins de 150 m de la
 * portion de tracé de cette place. */
export function isPoiOnChosenPlace(poi: RoutePoi, streets: StreetRun[], points: GpxPoint[], distances: number[]): boolean {
  const places = streets.filter(s => isPlaceName(s.name))
  if (!places.length) return false
  const ign = ignStreetName(poi.name)
  if (places.some(s => s.name === ign)) return true
  if (!SQUARE_NAME_RE.test(poi.name.trim())) return false
  return places.some(s => points.some((p, i) =>
    distances[i] >= s.startM - 50 && distances[i] <= s.endM + 50 && distM(p.lon, p.lat, poi.lon, poi.lat) < 150))
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
way["highway"]["name"~"^(Place |Parvis |Esplanade |Grand[- '’]?Place)",i]${a};
node["name"]["place"~"^(city|town|village)$"](around:${COMMUNE_RADIUS_M},${line});
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
 * Points d'intérêt connus à moins de 100 m du parcours, espacés d'au moins 1 km le long du tracé et à plus de 300 m
 * (à vol d'oiseau) des autres et des repères déjà posés (`existing`, ex. le repère du départ). Un pour ~4 km de course, entre 3 et 10.
 */
export async function fetchRoutePois(points: GpxPoint[], existing: RoutePoi[] = []): Promise<RoutePoi[]> {
  if (points.length < 2) return []
  const { cum } = simplify(points)
  const candidates = (await fetchRoutePoiCandidates(points).catch(() => [])).filter(isWellKnownPoi)
  const max = Math.max(3, Math.min(10, Math.round(cum[cum.length - 1] / 4000)))
  const kept: RoutePoiCandidate[] = []
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (kept.length >= max) break
    if (existing.some(x => x.name === c.name || distM(x.lon, x.lat, c.lon, c.lat) < MIN_SEP_M)) continue
    if (kept.some(k => Math.abs(k.at - c.at) < MIN_GAP_M || distM(k.lon, k.lat, c.lon, c.lat) < MIN_SEP_M)) continue
    kept.push(c)
  }
  return kept.sort((a, b) => a.at - b.at).map(({ name, lon, lat }) => ({ name, lon, lat }))
}

/** Tous les lieux trouvés à moins de 100 m du parcours (connus et moins connus), par ordre de passage. Rejette si
 * Overpass ne répond pas. */
export async function fetchRoutePoiCandidates(points: GpxPoint[]): Promise<RoutePoiCandidate[]> {
  if (points.length < 2) return []
  const { pts, cum } = simplify(points)
  const first = points[0], last = points[points.length - 1]
  const key = `${LS_KEY}${first.lat.toFixed(4)},${first.lon.toFixed(4)}_${last.lat.toFixed(4)},${last.lon.toFixed(4)}_${Math.round(cum[cum.length - 1] / 100)}`

  let candidates: RoutePoiCandidate[] | null = null
  try { const v = localStorage.getItem(key); if (v) candidates = JSON.parse(v) } catch { /* ignore */ }

  if (!candidates) {
    let els: OverpassEl[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      try { els = await queryOverpass(pts); break }
      catch (e) { if (attempt === 0) await new Promise(r => setTimeout(r, 1500)); else throw e }
    }
    // Un même lieu est souvent découpé en plusieurs éléments OSM (la Grand-Place de Lille : une place, une attraction,
    // des morceaux de voirie) : on les réunit par nom, à moins de 500 m, en gardant le meilleur type et la fiche wiki.
    const groups: { name: string; lon: number; lat: number; weight: number; wiki: number; posW: number; square: boolean }[] = []
    // Centres des communes autour du parcours, pour juger de l'importance de la commune d'une place.
    const communes: { lon: number; lat: number; important: boolean }[] = []
    for (const e of els) {
      const tags = e.tags ?? {}
      if (tags.place === 'city' || tags.place === 'town' || tags.place === 'village') {
        if (e.lat == null || e.lon == null) continue
        const pop = parseInt(tags.population ?? '0') || 0
        communes.push({ lon: e.lon, lat: e.lat, important: tags.place !== 'village' || pop >= IMPORTANT_VILLAGE_POP })
        continue
      }
      // Nom d'usage quand OSM le donne : « Grand-Place » plutôt que « Place du Général de Gaulle » à Lille.
      const usual = [tags.loc_name, tags.alt_name, tags.short_name].find(n => n && /^grand[- '’]?place$/i.test(n.trim()))
      const name = usual ?? tags.name
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon
      if (!name || lat == null || lon == null || GENERIC_RE.test(name.trim())) continue
      const weight = weightOf(tags)
      // Lieu connu : article Wikipédia (le meilleur indice), sinon simple fiche Wikidata.
      const wiki = tags.wikipedia ? 3 : tags.wikidata ? 1 : 0
      const square = tags.place === 'square' || SQUARE_NAME_RE.test(name.trim())
      const g = groups.find(x => x.name === name && distM(x.lon, x.lat, lon, lat) < 500)
      if (!g) { groups.push({ name, lon, lat, weight, wiki, posW: weight, square }); continue }
      g.square ||= square
      g.wiki = Math.max(g.wiki, wiki)
      if (weight > g.weight) g.weight = weight
      if (weight > g.posW) { g.lon = lon; g.lat = lat; g.posW = weight }
    }
    candidates = []
    for (const g of groups) {
      let score = g.weight + g.wiki
      if (score < LIST_MIN_SCORE) continue
      // Place d'une petite commune (centre de commune le plus proche) : à valider dans l'assistant, pas ajoutée d'office.
      if (g.square) {
        let near: { important: boolean } | null = null, nd = COMMUNE_RADIUS_M
        for (const c of communes) {
          const d = distM(g.lon, g.lat, c.lon, c.lat)
          if (d < nd) { nd = d; near = c }
        }
        if (!near?.important) score = Math.min(score, MIN_SCORE - 1)
      }
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
  return [...candidates].sort((a, b) => a.at - b.at)
}
