export interface WeatherSnapshot {
  temp: number
  weatherCode: number
  description: string
  icon: string
}

export interface WeatherInfo {
  tempMax: number
  tempMin: number
  departure?: WeatherSnapshot   // météo à l'heure de départ
  arrival?: WeatherSnapshot     // météo à l'heure d'arrivée
}

// ─── Codes condition Meteostat → WMO-like ────────────────────────────────────
// https://dev.meteostat.net/formats.html#condition-codes
const METEOSTAT_CODES: Record<number, { description: string; icon: string; wmo: number }> = {
  1:  { description: 'Ciel dégagé',          icon: '☀️',  wmo: 0 },
  2:  { description: 'Peu nuageux',           icon: '🌤️', wmo: 1 },
  3:  { description: 'Partiellement nuageux', icon: '⛅',  wmo: 2 },
  4:  { description: 'Couvert',               icon: '☁️',  wmo: 3 },
  5:  { description: 'Brouillard',            icon: '🌫️', wmo: 45 },
  6:  { description: 'Brouillard givrant',    icon: '🌫️', wmo: 48 },
  7:  { description: 'Pluie légère',          icon: '🌦️', wmo: 61 },
  8:  { description: 'Pluie',                 icon: '🌧️', wmo: 63 },
  9:  { description: 'Pluie forte',           icon: '🌧️', wmo: 65 },
  10: { description: 'Pluie verglaçante',     icon: '🌧️', wmo: 66 },
  11: { description: 'Pluie verglaçante forte', icon: '🌧️', wmo: 67 },
  12: { description: 'Grésil',               icon: '🌨️', wmo: 77 },
  14: { description: 'Neige légère',          icon: '❄️',  wmo: 71 },
  15: { description: 'Neige',                 icon: '❄️',  wmo: 73 },
  16: { description: 'Neige forte',           icon: '❄️',  wmo: 75 },
  21: { description: 'Orage',                 icon: '⛈️',  wmo: 95 },
  22: { description: 'Orage violent',         icon: '⛈️',  wmo: 99 },
}

// ─── Codes WMO (fallback Open-Meteo) ─────────────────────────────────────────
const WMO_CODES: Record<number, { description: string; icon: string }> = {
  0:  { description: 'Ciel dégagé',          icon: '☀️' },
  1:  { description: 'Peu nuageux',           icon: '🌤️' },
  2:  { description: 'Partiellement nuageux', icon: '⛅' },
  3:  { description: 'Couvert',               icon: '☁️' },
  45: { description: 'Brouillard',            icon: '🌫️' },
  48: { description: 'Brouillard givrant',    icon: '🌫️' },
  51: { description: 'Bruine légère',         icon: '🌦️' },
  61: { description: 'Pluie légère',          icon: '🌧️' },
  63: { description: 'Pluie modérée',         icon: '🌧️' },
  65: { description: 'Pluie forte',           icon: '🌧️' },
  71: { description: 'Neige légère',          icon: '❄️' },
  73: { description: 'Neige modérée',         icon: '❄️' },
  75: { description: 'Neige forte',           icon: '❄️' },
  80: { description: 'Averses légères',       icon: '🌦️' },
  81: { description: 'Averses',               icon: '🌧️' },
  95: { description: 'Orage',                 icon: '⛈️' },
}

function decodeWmo(code: number) {
  return WMO_CODES[code] ?? { description: 'Conditions inconnues', icon: '🌡️' }
}

// ─── Meteostat ────────────────────────────────────────────────────────────────
async function fetchMeteostat(
  lat: number, lon: number, dateStr: string,
  departureHour?: number, arrivalHour?: number,
): Promise<WeatherInfo | null> {
  const key = import.meta.env.VITE_METEOSTAT_KEY as string | undefined
  if (!key) return null

  const url = `https://meteostat.p.rapidapi.com/point/hourly` +
    `?lat=${lat}&lon=${lon}&start=${dateStr}&end=${dateStr}&tz=Europe/Paris`

  try {
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'meteostat.p.rapidapi.com',
      },
    })
    if (!res.ok) return null
    const json = await res.json()
    const rows: Array<{ time: string; temp: number; coco: number | null; tsun: number | null }> = json.data ?? []
    if (rows.length === 0) return null

    const temps = rows.map(r => r.temp).filter(t => t != null)
    const tempMax = Math.round(Math.max(...temps))
    const tempMin = Math.round(Math.min(...temps))

    function snapAt(targetHour: number): WeatherSnapshot | undefined {
      let best: typeof rows[0] | null = null
      let bestDiff = Infinity
      for (const row of rows) {
        const h = new Date(row.time.replace(' ', 'T')).getHours()
        const diff = Math.abs(h - targetHour)
        if (diff < bestDiff) { bestDiff = diff; best = row }
      }
      if (!best) return undefined

      // tsun = minutes de soleil dans l'heure (0-60)
      // Si tsun est disponible, on l'utilise en priorité sur coco
      let coco = best.coco ?? 1
      if (best.tsun != null) {
        if (best.tsun >= 50) coco = 1       // Peu nuageux à dégagé
        else if (best.tsun >= 30) coco = 2  // Partiellement nuageux
        else if (best.tsun >= 10) coco = 3  // Nuageux
        // tsun < 10 : garder coco original
      }

      const meta = METEOSTAT_CODES[coco] ?? METEOSTAT_CODES[4]
      return { temp: Math.round(best.temp), weatherCode: meta.wmo, description: meta.description, icon: meta.icon }
    }

    const noonSnap = snapAt(12)
    return {
      tempMax, tempMin,
      departure: departureHour !== undefined ? snapAt(departureHour) : noonSnap,
      arrival:   arrivalHour   !== undefined ? snapAt(arrivalHour)   : noonSnap,
    }
  } catch {
    return null
  }
}

// ─── Open-Meteo ERA5-Land (fallback) ─────────────────────────────────────────
function cloudCoverToCode(pct: number): number {
  if (pct < 15) return 0
  if (pct < 35) return 1
  if (pct < 70) return 2
  return 3
}

function snapshotAt(
  hourlyTimes: string[], temps: number[], codes: number[], cloudCovers: number[] | undefined,
  targetHour: number,
): WeatherSnapshot | undefined {
  let best = -1
  let bestDiff = Infinity
  for (let i = 0; i < hourlyTimes.length; i++) {
    const h = new Date(hourlyTimes[i]).getHours()
    const diff = Math.abs(h - targetHour)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  if (best < 0) return undefined

  let code = codes[best] ?? 0
  if (cloudCovers) {
    const cc = cloudCovers[best]
    if (cc != null && code <= 3) code = cloudCoverToCode(cc)
  }

  return { temp: Math.round(temps[best]), weatherCode: code, ...decodeWmo(code) }
}

async function fetchOpenMeteo(
  lat: number, lon: number, dateStr: string,
  departureHour?: number, arrivalHour?: number,
): Promise<WeatherInfo | null> {
  const url = `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${dateStr}&end_date=${dateStr}` +
    `&hourly=temperature_2m,weathercode,cloud_cover` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=auto` +
    `&models=era5_land`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()

    const daily = data.daily
    const hourly = data.hourly
    if (!daily?.temperature_2m_max?.[0]) return null

    const info: WeatherInfo = {
      tempMax: Math.round(daily.temperature_2m_max[0]),
      tempMin: Math.round(daily.temperature_2m_min[0]),
    }

    if (hourly) {
      const cc = hourly.cloud_cover
      const noonSnap = snapshotAt(hourly.time, hourly.temperature_2m, hourly.weathercode, cc, 12)
      info.departure = departureHour !== undefined
        ? snapshotAt(hourly.time, hourly.temperature_2m, hourly.weathercode, cc, departureHour)
        : noonSnap
      info.arrival = arrivalHour !== undefined
        ? snapshotAt(hourly.time, hourly.temperature_2m, hourly.weathercode, cc, arrivalHour)
        : noonSnap
    }

    return info
  } catch {
    return null
  }
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────
// Heures par défaut quand une date est renseignée mais pas d'heure de départ/arrivée
// (ex. tracé sans horodatage GPX et sans saisie manuelle) : on affiche quand même la
// météo, avec des conditions plausibles de journée de rando plutôt que "à midi".
const DEFAULT_DEPARTURE_HOUR = 6
const DEFAULT_ARRIVAL_HOUR = 18

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  date: Date,
  departureHour?: number,
  arrivalHour?: number,
): Promise<WeatherInfo | null> {
  const dateStr = date.toISOString().slice(0, 10)
  const dh = departureHour ?? DEFAULT_DEPARTURE_HOUR
  const ah = arrivalHour ?? DEFAULT_ARRIVAL_HOUR
  // Meteostat en priorité (données stations réelles), fallback Open-Meteo
  return (
    await fetchMeteostat(lat, lon, dateStr, dh, ah) ??
    await fetchOpenMeteo(lat, lon, dateStr, dh, ah)
  )
}
