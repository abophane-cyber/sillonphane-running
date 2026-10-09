// Repère nommé le plus proche du départ (porte de ville, monument, place, hôtel de ville…), lu dans OpenStreetMap via
// Photon (géocodage inverse filtré par type, déjà utilisé par l'appli pour nommer les lieux) : ajouté d'office comme
// point d'intérêt, visible dès l'ouverture (« Porte de Paris » au départ du semi de Lille). Mis en cache par position.

const PHOTON_REVERSE = 'https://photon.komoot.io/reverse'
const RADIUS_KM = 0.4
const LS_KEY = 'running:sillon_start_landmark_'
/** Types interrogés et leur priorité (plus grand = préféré à distance égale). */
const KINDS: [string, number][] = [
  ['historic', 3], ['amenity:townhall', 2], ['tourism:museum', 2], ['tourism:attraction', 2], ['place:square', 1.5],
]

export interface StartLandmark { name: string; lon: number; lat: number }

function distM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111320
}

interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: { name?: string } }

export async function fetchStartLandmark(lon: number, lat: number): Promise<StartLandmark | null> {
  const key = `${LS_KEY}${lat.toFixed(4)},${lon.toFixed(4)}`
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v) } catch { /* ignore */ }
  const results = await Promise.all(KINDS.map(async ([tag, w]) => {
    const r = await fetch(`${PHOTON_REVERSE}?lon=${lon}&lat=${lat}&limit=5&radius=${RADIUS_KM}&osm_tag=${tag}`)
    if (!r.ok) return []
    const data = await r.json() as { features?: PhotonFeature[] }
    return (data.features ?? []).map(f => ({ f, w }))
  }))
  let best: StartLandmark | null = null, bestScore = -Infinity
  for (const { f, w } of results.flat()) {
    const name = f.properties?.name, c = f.geometry?.coordinates
    if (!name || !c) continue
    // Score : proche d'abord ; une porte ou un monument l'emporte sur une place un peu plus proche.
    const score = w - distM(lon, lat, c[0], c[1]) / 150
    if (score > bestScore) { bestScore = score; best = { name, lon: c[0], lat: c[1] } }
  }
  try { localStorage.setItem(key, JSON.stringify(best)) } catch { /* ignore */ }
  return best
}
