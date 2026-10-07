// Bornes kilométriques et temps de passage (course sur route) : une borne tous les 5 km, plus le semi sur un
// parcours assez long. Temps réels d'un GPX enregistré, ou temps PRÉVUS calculés depuis l'heure de départ et une
// vitesse attendue par tranche de 10 km (course pas encore faite). Partagé par l'aperçu (TrackMap) et le film 2D.
import type { GpxPoint } from '../types'

export const BORNE_EVERY_KM = 5
export const SEMI_KM = 21.0975
/** Taille d'une tranche de vitesse prévue (km). */
export const SPEED_SLICE_KM = 10
export const DEFAULT_SPEED_KMH = 10

/** Réglages des bornes, saisis dans le widget des panneaux et mémorisés avec le tracé. */
export interface RaceSettings {
  bornesOff: boolean
  /** Temps prévus même si le GPX a des heures réelles. */
  plannedTimes: boolean
  /** Vitesse attendue (km/h) par tranche de SPEED_SLICE_KM ; 0 = non renseignée. */
  speeds: number[]
  /** Inscription de l'épreuve (nom, date, distance) ; vide = valeur par défaut (titre du parcours, date, distance). */
  eventName?: string
  bannerDate?: string
  bannerDistance?: string
  /** Numéro inscrit sur le dossard de la coureuse ; vide = dossard blanc. */
  bibNumber?: string
  /** Kilomètres des ravitaillements, tels que saisis (« 5 ; 9 ; 14 ; 18,5 »). */
  ravitos?: string
}
/** Inscription de l'épreuve (nom, date, distance), saisie dans le widget des panneaux. */
export interface BannerText {
  title: string
  date?: string
  distance?: string
}

export const DEFAULT_RACE_SETTINGS: RaceSettings = { bornesOff: false, plannedTimes: false, speeds: [] }

/** Distance de l'épreuve : « 42,195 KM » (marathon), « 21,1 KM » (semi), sinon au dixième. */
export function formatBannerDistance(m: number): string {
  if (Math.abs(m - 42195) < 500) return '42,195 KM'
  if (Math.abs(m - 21097.5) < 300) return '21,1 KM'
  return `${(m / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')} KM`
}

/** Date de l'épreuve : « 25 octobre 2026 » (date « AAAA-MM-JJ »). */
export function formatBannerDate(iso: string | undefined): string | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return undefined
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export interface Borne {
  /** Libellé principal : « 10 KM », « SEMI ». */
  label: string
  km: number
  lat: number
  lon: number
  /** Temps depuis le départ (s), si connu. */
  elapsedS?: number
  /** Heure de passage « 10 h 52 », si l'heure de départ est connue. */
  clock?: string
}

/** Temps réels exploitables : horodatage sur presque tous les points, croissant, à une allure de course plausible
 * (un tracé de planification porte souvent des heures fictives : toutes identiques ou à vitesse irréaliste). */
export function hasRealTimes(points: GpxPoint[], distances: number[]): boolean {
  if (points.length < 2) return false
  const timed = points.filter(p => p.time).length
  if (timed < points.length * 0.9) return false
  const t0 = points.find(p => p.time)!.time!.getTime()
  const t1 = [...points].reverse().find(p => p.time)!.time!.getTime()
  const durS = (t1 - t0) / 1000
  if (durS <= 60) return false
  const kmh = (distances[distances.length - 1] / 1000) / (durS / 3600)
  if (!(kmh > 2 && kmh < 30)) return false
  // Allure trop régulière d'un point à l'autre : heures calculées par un outil de planification (Openrunner…), à
  // allure plausible mais constante (seule la pente la module). Écart relatif des vitesses : ≈ 0,08 pour un tel
  // tracé, ≈ 0,3 pour une trace enregistrée (bruit GPS, virages, arrêts).
  const speeds: number[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].time, b = points[i].time
    if (!a || !b) continue
    const dt = (b.getTime() - a.getTime()) / 1000
    if (dt > 0) speeds.push((distances[i] - distances[i - 1]) / dt)
  }
  if (speeds.length < 20) return true
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length
  const sd = Math.sqrt(speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length)
  return sd / mean >= PLANNED_PACE_MAX_CV
}

/** En dessous de cet écart relatif des vitesses entre points, les heures du GPX sont jugées fictives (cf. hasRealTimes). */
const PLANNED_PACE_MAX_CV = 0.15

/** Nombre de tranches de vitesse prévue pour une distance (au moins une). */
export function speedSliceCount(totalM: number): number {
  return Math.max(1, Math.ceil(totalM / 1000 / SPEED_SLICE_KM))
}

/** Vitesse saisie utilisable (km/h). */
const validSpeed = (v: number | undefined): v is number => typeof v === 'number' && v > 0 && v < 40

/** Au moins une vitesse prévue saisie. */
export function hasPlannedSpeeds(speedsKmh: number[] | undefined): boolean {
  return !!speedsKmh?.some(validSpeed)
}

/** Temps prévu (s) pour parcourir `km` depuis le départ, tranche par tranche ; une tranche non renseignée reprend
 * la vitesse de la précédente (ou de la première renseignée). */
export function plannedElapsedS(km: number, speedsKmh: number[]): number {
  let v = speedsKmh.find(validSpeed) ?? DEFAULT_SPEED_KMH
  let s = 0
  for (let a = 0, i = 0; a < km; a += SPEED_SLICE_KM, i++) {
    if (validSpeed(speedsKmh[i])) v = speedsKmh[i]
    s += (Math.min(SPEED_SLICE_KM, km - a) / v) * 3600
  }
  return s
}

/** « 1 h 02'31" », « 52'31" ». */
export function formatElapsed(s: number): string {
  const t = Math.round(s)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h} h ${mm}'${ss}"` : `${mm}'${ss}"`
}

/** « 10 h 52 ». */
export function formatClock(d: Date): string {
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`
}

/** Ligne d'heure de départ de l'ouverture des films : « Départ prévu à 9 h 00 » (heure saisie, temps prévus) ou
 * « Départ à 9 h 00 » (GPX horodaté). Sans heure « HH:MM » valide : null. */
export function startTimeLine(hhmm: string | undefined, planned: boolean): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m) return null
  return `${planned ? 'Départ prévu à' : 'Départ à'} ${Number(m[1])} h ${m[2]}`
}

function pointAtM(points: GpxPoint[], distances: number[], m: number) {
  let i = 1
  while (i < distances.length - 1 && distances[i] < m) i++
  const t = (m - distances[i - 1]) / ((distances[i] - distances[i - 1]) || 1)
  const a = points[i - 1], b = points[i]
  const ta = a.time?.getTime(), tb = b.time?.getTime()
  return {
    lat: a.lat + t * (b.lat - a.lat),
    lon: a.lon + t * (b.lon - a.lon),
    timeMs: ta != null && tb != null ? ta + t * (tb - ta) : undefined,
  }
}

export interface BorneOptions {
  /** Temps du GPX (s'ils sont réels) plutôt que les temps prévus. */
  useRealTimes: boolean
  /** Heure de départ prévue « HH:MM » (temps prévus). */
  startTime?: string
  /** Date de la course « AAAA-MM-JJ » (temps prévus), sinon aujourd'hui. */
  date?: string
  /** Vitesse attendue (km/h) par tranche de SPEED_SLICE_KM ; absente = pas de temps prévus. */
  speedsKmh?: number[]
}

export function computeBornes(points: GpxPoint[], distances: number[], opts: BorneOptions): Borne[] {
  const total = distances[distances.length - 1] ?? 0
  if (points.length < 2 || total < BORNE_EVERY_KM * 1000) return []
  const kms: { km: number; label: string }[] = []
  for (let km = BORNE_EVERY_KM; km * 1000 < total - 200; km += BORNE_EVERY_KM) kms.push({ km, label: `${km} KM` })
  // Semi : seulement sur un parcours nettement plus long (sinon c'est l'arrivée).
  if (total > (SEMI_KM + 1) * 1000) kms.push({ km: SEMI_KM, label: 'SEMI' })
  kms.sort((a, b) => a.km - b.km)

  const t0 = points[0].time?.getTime()
  let plannedStart: Date | undefined
  if (!opts.useRealTimes && opts.startTime && /^\d{1,2}:\d{2}$/.test(opts.startTime)) {
    const [h, m] = opts.startTime.split(':').map(Number)
    plannedStart = opts.date ? new Date(`${opts.date}T00:00:00`) : new Date()
    plannedStart.setHours(h, m, 0, 0)
  }

  return kms.map(({ km, label }) => {
    const p = pointAtM(points, distances, km * 1000)
    const b: Borne = { label, km, lat: p.lat, lon: p.lon }
    if (opts.useRealTimes) {
      if (t0 != null && p.timeMs != null) {
        b.elapsedS = (p.timeMs - t0) / 1000
        b.clock = formatClock(new Date(p.timeMs))
      }
    } else if (opts.speedsKmh && hasPlannedSpeeds(opts.speedsKmh)) {
      b.elapsedS = plannedElapsedS(km, opts.speedsKmh)
      if (plannedStart) b.clock = formatClock(new Date(plannedStart.getTime() + b.elapsedS * 1000))
    }
    return b
  })
}

/** Carton de fin du film (bandeau bas) : intitulé, date, distance, dénivelé, temps mis et moyenne. */
export interface EndCard {
  title: string
  date?: string
  distance?: string
  /** « +52 m ». */
  elevGain?: string
  /** « 1 h 45'12" » ; absent = temps inconnu (ni GPX enregistré ni vitesses prévues). */
  time?: string
  /** « TEMPS » (GPX enregistré) ou « TEMPS PRÉVU » (vitesses saisies). */
  timeLabel?: string
  /** « 12,0 km/h ». */
  avgSpeed?: string
}

/** Temps du parcours (s) : réel (heures du GPX) ou prévu (vitesses saisies), sinon undefined. */
export function raceDurationS(points: GpxPoint[], totalM: number, opts: { useRealTimes: boolean; speedsKmh?: number[] }): { s: number; planned: boolean } | undefined {
  if (opts.useRealTimes) {
    const t0 = points.find(p => p.time)?.time, t1 = [...points].reverse().find(p => p.time)?.time
    if (t0 && t1 && t1 > t0) return { s: (t1.getTime() - t0.getTime()) / 1000, planned: false }
    return undefined
  }
  if (opts.speedsKmh && hasPlannedSpeeds(opts.speedsKmh)) return { s: plannedElapsedS(totalM / 1000, opts.speedsKmh), planned: true }
  return undefined
}

/** Ravitaillement placé sur le tracé à un kilomètre donné. */
export interface Ravito { km: number; lat: number; lon: number; label: string }

/** Kilomètres lus dans la saisie : « Km 5, Km 9, 18,5 », « 5 ; 9 ; 14 ; 18.5 »… (virgule suivie d'un espace =
 * séparateur, virgule collée = décimale), triés, sans doublon. */
export function parseRavitoKms(text: string | undefined): number[] {
  if (!text) return []
  const nums = text.replace(/,\s/g, ';').match(/\d+(?:[.,]\d+)?/g) ?? []
  return [...new Set(nums.map(n => parseFloat(n.replace(',', '.'))).filter(n => n > 0))].sort((a, b) => a - b)
}

/** « 18,5 » */
export function formatKm(km: number): string {
  return Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',')
}

/** Ravitaillements sur le tracé (ceux au-delà de l'arrivée sont ignorés). */
export function computeRavitos(points: GpxPoint[], distances: number[], kms: number[]): Ravito[] {
  const total = distances[distances.length - 1] ?? 0
  if (points.length < 2) return []
  return kms.filter(km => km * 1000 < total).map(km => {
    const p = pointAtM(points, distances, km * 1000)
    return { km, lat: p.lat, lon: p.lon, label: `Ravito · km ${formatKm(km)}` }
  })
}

/** Une borne apparaît à l'approche (ce nombre de mètres avant elle), puis reste : sur une boucle, la borne des 20 km
 * passe près du départ et ne doit pas se montrer avant celle des 5 km. */
export const BORNE_LEAD_M = 1000
export function borneReached(b: { km: number }, coveredM: number): boolean {
  return coveredM >= b.km * 1000 - BORNE_LEAD_M
}

/** Nombre inscrit sur la borne : « 10 », « 21,1 » (semi). */
export function borneNumber(b: Borne): string {
  return Number.isInteger(b.km) ? String(b.km) : b.km.toFixed(1).replace('.', ',')
}

/** Deuxième ligne d'une borne : « 10 h 52 · 52'31" », ou l'un des deux, ou rien. */
export function borneTimeLine(b: Borne): string {
  return [b.clock, b.elapsedS != null ? formatElapsed(b.elapsedS) : undefined].filter(Boolean).join(' · ')
}
