// Rues et routes empruntées par le parcours, d'après la BD TOPO de l'IGN (tronçons de route, Géoplateforme,
// licence Etalab) : nom abrégé en capitales comme sur le Plan IGN (« BD DE LA LIBERTE », « R DE PUEBLA »).
// Le tracé est échantillonné tous les SAMPLE_M ; chaque échantillon prend le nom du tronçon le plus proche qui va
// dans le même sens ; les suites d'échantillons d'un même nom forment les portions empruntées.
import type { GpxPoint } from '../types'

/** Portion du parcours empruntant une rue : nom, étendue (m depuis le départ) et importance IGN (1 = axe majeur,
 * 6 = desserte ; la plus forte des tronçons suivis). */
export interface StreetRun { name: string; startM: number; endM: number; importance?: number }

/** Rue « importante », proposée d'office dans le widget : axe d'importance IGN 1 à 3, ou au moins 600 m empruntés. */
export function isMainStreet(runs: StreetRun[]): boolean {
  const total = runs.reduce((a, r) => a + r.endM - r.startM, 0)
  return runs.some(r => (r.importance ?? 6) <= 3) || total >= 600
}

const SAMPLE_M = 15
/** Distance maximale entre le tracé et l'axe du tronçon (m) : chaussée large, GPS approximatif. */
const MAX_DIST_M = 22
/** Écart d'angle maximal entre le tracé et le tronçon (une rue croisée n'est pas une rue empruntée). */
const MAX_ANGLE_DEG = 35
/** Trou toléré dans une portion (carrefour, place traversée) avant de la couper. */
const GAP_M = 90
/** Longueur minimale d'une portion proposée. */
export const STREET_MIN_M = 120
/** Longueur de parcours par requête IGN (emprise réduite = réponse légère). */
const CHUNK_M = 1500

type Seg = { ax: number; ay: number; bx: number; by: number; name: string; importance: number }

/** Types de voie abrégés comme sur le Plan IGN (premier mot du nom). */
const ABBREV: Record<string, string> = {
  RUE: 'R', AVENUE: 'AV', BOULEVARD: 'BD', PLACE: 'PL', ROUTE: 'RTE', CHEMIN: 'CHE', ALLEE: 'ALL', QUAI: 'QU',
  IMPASSE: 'IMP', SQUARE: 'SQ', PROMENADE: 'PROM', COURS: 'CRS', PASSAGE: 'PAS', CHAUSSEE: 'CHS', ESPLANADE: 'ESP',
  PONT: 'PONT', SENTIER: 'SEN', RUELLE: 'RLE', CARREFOUR: 'CAR', ROND: 'RD',
}
/** Nom au format du Plan IGN : capitales sans accents, type de voie abrégé (« Avenue Léon Jouhaux » -> « AV LEON
 * JOUHAUX ») ; les noms déjà à ce format restent tels quels. */
export function ignStreetName(name: string): string {
  const up = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/s+/g, ' ').trim()
  const [first, ...rest] = up.split(' ')
  return ABBREV[first] ? [ABBREV[first], ...rest].join(' ') : up
}

/** Rues empruntées, par ordre de passage. Rejette en cas d'échec du service IGN. */
export async function fetchRouteStreets(points: GpxPoint[], distances: number[], signal?: AbortSignal): Promise<StreetRun[]> {
  if (points.length < 2) return []
  const total = distances[distances.length - 1]
  const lat0 = points[0].lat
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540
  const toXY = (lon: number, lat: number) => ({ x: lon * kx, y: lat * ky })

  // Échantillons réguliers le long du tracé, avec leur cap.
  const samples: { m: number; lon: number; lat: number; hx: number; hy: number }[] = []
  let j = 0
  for (let m = 0; m <= total; m += SAMPLE_M) {
    while (j < distances.length - 2 && distances[j + 1] < m) j++
    const span = Math.max(1e-6, distances[j + 1] - distances[j])
    const t = Math.min(1, Math.max(0, (m - distances[j]) / span))
    const a = points[j], b = points[j + 1]
    const pa = toXY(a.lon, a.lat), pb = toXY(b.lon, b.lat)
    const hl = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1
    samples.push({ m, lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t, hx: (pb.x - pa.x) / hl, hy: (pb.y - pa.y) / hl })
  }

  // Une requête par tranche de parcours, emprise de la tranche élargie de MAX_DIST_M.
  const chunks: typeof samples[] = []
  for (const s of samples) {
    const k = Math.floor(s.m / CHUNK_M)
    ;(chunks[k] ??= []).push(s)
  }
  const padLon = (MAX_DIST_M * 2) / kx, padLat = (MAX_DIST_M * 2) / ky
  const names: (string | null)[] = new Array(samples.length).fill(null)
  const importances: number[] = new Array(samples.length).fill(6)
  const cosMax = Math.cos((MAX_ANGLE_DEG * Math.PI) / 180)

  async function matchChunk(chunk: typeof samples) {
    const lons = chunk.map(s => s.lon), lats = chunk.map(s => s.lat)
    const bbox = [Math.min(...lons) - padLon, Math.min(...lats) - padLat, Math.max(...lons) + padLon, Math.max(...lats) + padLat]
    const url = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
      '&TYPENAMES=BDTOPO_V3:troncon_de_route&SRSNAME=CRS:84&OUTPUTFORMAT=application/json&COUNT=10000' +
      '&PROPERTYNAME=nom_collaboratif_gauche,nom_collaboratif_droite,importance,geometrie' +
      `&BBOX=${bbox.join(',')},CRS:84`
    const r = await fetch(url, { signal })
    if (!r.ok) throw new Error(`IGN tronçons de route : HTTP ${r.status}`)
    const j = await r.json()
    const segs: Seg[] = []
    for (const f of j?.features ?? []) {
      const name = ignStreetName(f.properties?.nom_collaboratif_gauche || f.properties?.nom_collaboratif_droite || '')
      if (!name) continue
      const lines: number[][][] = f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : []
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = toXY(line[i][0], line[i][1]), b = toXY(line[i + 1][0], line[i + 1][1])
          segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, name, importance: Number(f.properties?.importance) || 6 })
        }
      }
    }
    for (const s of chunk) {
      const p = toXY(s.lon, s.lat)
      let best = MAX_DIST_M, bestName: string | null = null, bestImp = 6
      for (const g of segs) {
        const dx = g.bx - g.ax, dy = g.by - g.ay
        const l2 = dx * dx + dy * dy
        if (l2 < 1) continue
        const t = Math.max(0, Math.min(1, ((p.x - g.ax) * dx + (p.y - g.ay) * dy) / l2))
        const d = Math.hypot(p.x - (g.ax + dx * t), p.y - (g.ay + dy * t))
        if (d >= best) continue
        if (Math.abs((dx * s.hx + dy * s.hy) / Math.sqrt(l2)) < cosMax) continue // tronçon croisé, pas suivi
        best = d; bestName = g.name; bestImp = g.importance
      }
      names[s.m / SAMPLE_M] = bestName
      importances[s.m / SAMPLE_M] = bestImp
    }
  }
  // 4 requêtes à la fois au plus.
  const queue = chunks.filter(Boolean)
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) await matchChunk(c)
  }))

  // Portions : échantillons consécutifs d'un même nom, trous courts tolérés.
  const runs: StreetRun[] = []
  for (let i = 0; i < samples.length; i++) {
    const name = names[i]
    if (!name) continue
    const last = runs[runs.length - 1]
    if (last && last.name === name && samples[i].m - last.endM <= GAP_M) {
      last.endM = samples[i].m
      last.importance = Math.min(last.importance ?? 6, importances[i])
    } else runs.push({ name, startM: samples[i].m, endM: samples[i].m, importance: importances[i] })
  }
  // Bouts trop courts retirés (carrefour, rue voisine frôlée), puis portions voisines d'un même nom réunies.
  const merged: StreetRun[] = []
  for (const r of runs.filter(r => r.endM - r.startM >= STREET_MIN_M)) {
    const last = merged[merged.length - 1]
    if (last && last.name === r.name && r.startM - last.endM <= 3 * GAP_M) {
      last.endM = r.endM
      last.importance = Math.min(last.importance ?? 6, r.importance ?? 6)
    } else merged.push({ ...r })
  }
  return merged
}
