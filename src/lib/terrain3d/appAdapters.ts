// Adaptateurs entre les données de l'app (localités, météo, dates) et les entrées de
// `exportFilm3d`. Isolés ici pour que `filmExport3d.ts` reste indépendant des types de l'app
// et que le banc de test continue de l'appeler avec des littéraux.

import type { Panel3d } from './filmExport3d'
import type { LocalityInfo } from '../../hooks/useLocality'
import type { WeatherInfo } from '../meteo'

/** Panneaux 3D depuis la même sélection que le film 2D (voir src/lib/filmExport.ts:572-590). */
export function localitiesToPanels3d(
  previewLocalities: LocalityInfo[],
  customLocalities: LocalityInfo[],
  suppressedNames: Set<string>,
  startName?: string,
  endName?: string,
): Panel3d[] {
  const dep = startName?.trim().toLowerCase() ?? ''
  const arr = endName?.trim().toLowerCase() ?? ''
  // Localités détectées : on retire celles décochées et celles qui doublonnent le panneau
  // départ/arrivée. Les panneaux ajoutés manuellement, eux, sont toujours conservés : ils
  // ont été explicitement demandés (retrait = bouton ✕), et leur nom peut légitimement
  // coïncider avec celui du départ/arrivée (ex. un col ajouté au bout du tracé) sans devoir
  // disparaître si l'utilisateur masque le panneau d'arrivée homonyme.
  const preview = previewLocalities.filter(loc => {
    if (suppressedNames.has(loc.name)) return false
    const n = loc.name.trim().toLowerCase()
    return (!dep || n !== dep) && (!arr || n !== arr)
  })
  return [...preview, ...customLocalities]
    .map(loc => ({
      name: loc.name,
      lon: loc.lon,
      lat: loc.lat,
      ele: loc.ele,
      style: loc.type === 'col' ? 'col'
        : loc.placeType === 'poi' ? 'poi'
        : (loc.placeType === 'hamlet' || loc.placeType === 'locality') ? 'lieudit'
        : 'standard',
    }))
}

// weatherCode WMO (voir src/lib/meteo.ts) -> couverture nuageuse 0..1 pour piloter le ciel et
// l'intensité du directionnel dans le survol 3D.
const WMO_CLOUD_COVER: Record<number, number> = {
  0: 0.0, 1: 0.15, 2: 0.4, 3: 0.75,
  45: 0.9, 48: 0.9,
  51: 0.85, 61: 0.85, 63: 0.85, 65: 0.85, 66: 0.85, 67: 0.85, 80: 0.85, 81: 0.85,
  71: 0.8, 73: 0.8, 75: 0.8, 77: 0.8,
  95: 0.95, 99: 0.95,
}

function hourFromHHMM(s?: string): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = parseInt(m[1], 10) + parseInt(m[2], 10) / 60
  return h >= 0 && h < 24 ? h : null
}

/** `WeatherInfo` + heures de départ/arrivée -> scénario météo/heure de `exportFilm3d`. */
export function weatherToScenario(
  weather: WeatherInfo | null,
  departureTime?: string,
  arrivalTime?: string,
): { hourOfDay: number; cloudCover: number } {
  const hd = hourFromHHMM(departureTime)
  const ha = hourFromHHMM(arrivalTime)
  const hourOfDay = hd != null && ha != null ? (hd + ha) / 2 : hd ?? ha ?? 14

  const snap = weather?.departure ?? weather?.arrival ?? null
  const cloudCover = snap ? WMO_CLOUD_COVER[snap.weatherCode] ?? 0.5 : 0.35

  return { hourOfDay, cloudCover }
}

/** "10 août 2026" pour le cartel de titre du survol. */
export function formatTrailDate(d: string | Date | undefined | null): string {
  let date: Date
  if (d instanceof Date) date = d
  else if (typeof d === 'string' && d) date = new Date(d.length <= 10 ? `${d}T12:00:00` : d)
  else date = new Date()
  if (isNaN(date.getTime())) date = new Date()
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}
