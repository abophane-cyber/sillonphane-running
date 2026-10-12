import type { GpxPoint, ParsedGpx } from '../types'
import { buildGpxXml, parseGpx, parseKml } from './gpx'

// Import d'une course depuis un fichier : GPX, KML, mais aussi FIT (format natif des montres Garmin, Coros, Suunto…,
// « Exporter l'original » de Strava) et TCX, éventuellement compressés en .gz (archive de compte Strava :
// activities/123456.fit.gz). FIT et TCX sont convertis en GPX : le reste de l'appli (gpxData, film, affiche, records)
// ne lit que du GPX ou du KML.

export const IMPORT_FORMATS_LABEL = 'GPX, KML, FIT ou TCX'

export interface ImportedActivity {
  parsed: ParsedGpx
  /** Texte rangé dans VoyageTrack.gpxData : le fichier d'origine (GPX, KML) ou le GPX converti (FIT, TCX). */
  raw: string
  /** Nom tiré du fichier, sans extension ; undefined pour un simple numéro d'activité (archive Strava). */
  fileName?: string
}

export async function readActivityFile(file: File): Promise<ImportedActivity> {
  let lower = file.name.toLowerCase()
  let data: Blob = file
  if (lower.endsWith('.gz')) {
    data = new Blob([await gunzip(file)])
    lower = lower.slice(0, -3)
  }
  const ext = lower.match(/\.(gpx|kml|fit|tcx)$/)?.[1]
  if (!ext) throw new Error(`Veuillez sélectionner un fichier ${IMPORT_FORMATS_LABEL}`)

  const stem = file.name.replace(/\.gz$/i, '').replace(/\.(gpx|kml|fit|tcx)$/i, '').trim()
  const fileName = stem && !/^\d+$/.test(stem) ? stem : undefined

  if (ext === 'gpx' || ext === 'kml') {
    const raw = await data.text()
    const parsed = ext === 'kml' ? parseKml(raw) : parseGpx(raw)
    if (parsed.tracks.length === 0) throw new Error('Aucun tracé trouvé dans ce fichier')
    return { parsed, raw, fileName }
  }

  const points = ext === 'fit' ? parseFit(await data.arrayBuffer()) : parseTcx(await data.text())
  if (points.length < 2) throw new Error('Aucun tracé GPS dans ce fichier (activité sans position, sur tapis ?)')
  const name = fileName ?? defaultName(points)
  const raw = buildGpxXml(points, name, `Import ${ext.toUpperCase()} - Sillonphane`)
  const parsed = parseGpx(raw)
  return { parsed, raw, fileName: name }
}

function defaultName(points: GpxPoint[]): string {
  const t = points[0].time
  return t ? `Course du ${t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Course'
}

async function gunzip(blob: Blob): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Ce navigateur ne sait pas ouvrir les fichiers .gz : décompressez-le d’abord')
  }
  try {
    return await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  } catch {
    throw new Error('Fichier .gz illisible')
  }
}

// ── TCX (Garmin Training Center) ────────────────────────────────────────────────────────────────────────────────────

function parseTcx(text: string): GpxPoint[] {
  // Les TCX de Strava commencent par des espaces avant <?xml, ce que DOMParser refuse : d'où le trim.
  const doc = new DOMParser().parseFromString(text.trim(), 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Fichier TCX invalide')
  const points: GpxPoint[] = []
  let lastEle = NaN
  for (const tp of doc.querySelectorAll('Trackpoint')) {
    const lat = parseFloat(tp.querySelector('LatitudeDegrees')?.textContent ?? '')
    const lon = parseFloat(tp.querySelector('LongitudeDegrees')?.textContent ?? '')
    if (isNaN(lat) || isNaN(lon)) continue // pause ou point sans GPS
    const ele = parseFloat(tp.querySelector('AltitudeMeters')?.textContent ?? '')
    if (!isNaN(ele)) lastEle = ele
    const timeStr = tp.querySelector('Time')?.textContent
    const time = timeStr ? new Date(timeStr) : undefined
    points.push({ lat, lon, ele: isNaN(lastEle) ? 0 : lastEle, time: time && !isNaN(time.getTime()) ? time : undefined })
  }
  return fillLeadingEle(points)
}

// ── FIT (Flexible and Interoperable Data Transfer, Garmin) ──────────────────────────────────────────────────────────
// Fichier binaire : en-tête « .FIT », puis des messages de définition (structure d'un type local) et des messages de
// données. Seul le message « record » (n° global 20) nous intéresse : position (semi-cercles), altitude, heure.

const FIT_EPOCH_S = 631065600 // 31/12/1989 00:00 UTC, origine des horodatages FIT
const MSG_RECORD = 20
const F_TIMESTAMP = 253, F_LAT = 0, F_LON = 1, F_ALT = 2, F_ENH_ALT = 78

interface FitDef { le: boolean; global: number; fields: { num: number; size: number }[]; devSize: number }

function parseFit(buf: ArrayBuffer): GpxPoint[] {
  const dv = new DataView(buf)
  const bytes = new Uint8Array(buf)
  const points: GpxPoint[] = []
  let lastEle = NaN
  let pos = 0
  // Un fichier peut enchaîner plusieurs blocs FIT (en-tête + données + CRC).
  while (pos + 12 <= bytes.length) {
    const headerSize = bytes[pos]
    const sig = String.fromCharCode(bytes[pos + 8], bytes[pos + 9], bytes[pos + 10], bytes[pos + 11])
    if (headerSize < 12 || sig !== '.FIT') {
      if (pos === 0) throw new Error('Fichier FIT invalide')
      break
    }
    const end = Math.min(bytes.length, pos + headerSize + dv.getUint32(pos + 4, true))
    const defs = new Map<number, FitDef>()
    let lastTs = NaN
    let p = pos + headerSize
    try {
      while (p < end) {
        const h = bytes[p++]
        let local: number
        let compressedTs: number | undefined
        if (h & 0x80) {
          // En-tête à horodatage compressé : 5 bits de décalage par rapport au dernier horodatage complet.
          local = (h >> 5) & 0x03
          const offset = h & 0x1f
          if (!isNaN(lastTs)) {
            let ts = lastTs - (lastTs % 32) + offset
            if (offset < lastTs % 32) ts += 32
            compressedTs = lastTs = ts
          }
        } else if (h & 0x40) {
          const hasDev = (h & 0x20) !== 0
          const le = bytes[p + 1] === 0
          const global = dv.getUint16(p + 2, le)
          const n = bytes[p + 4]
          p += 5
          const fields: FitDef['fields'] = []
          for (let i = 0; i < n; i++, p += 3) fields.push({ num: bytes[p], size: bytes[p + 1] })
          let devSize = 0
          if (hasDev) {
            const nd = bytes[p++]
            for (let i = 0; i < nd; i++, p += 3) devSize += bytes[p + 1]
          }
          defs.set(h & 0x0f, { le, global, fields, devSize })
          continue
        } else {
          local = h & 0x0f
        }

        const def = defs.get(local)
        if (!def) throw new Error('Fichier FIT invalide')
        let ts = compressedTs, lat = NaN, lon = NaN, alt = NaN, enhAlt = NaN
        for (const f of def.fields) {
          if (f.num === F_TIMESTAMP && f.size === 4) {
            const v = dv.getUint32(p, def.le)
            if (v !== 0xffffffff) ts = lastTs = v
          } else if (def.global === MSG_RECORD) {
            if ((f.num === F_LAT || f.num === F_LON) && f.size === 4) {
              const v = dv.getInt32(p, def.le)
              if (v !== 0x7fffffff) { if (f.num === F_LAT) lat = v * 180 / 2 ** 31; else lon = v * 180 / 2 ** 31 }
            } else if (f.num === F_ALT && f.size === 2) {
              const v = dv.getUint16(p, def.le)
              if (v !== 0xffff) alt = v / 5 - 500
            } else if (f.num === F_ENH_ALT && f.size === 4) {
              const v = dv.getUint32(p, def.le)
              if (v !== 0xffffffff) enhAlt = v / 5 - 500
            }
          }
          p += f.size
        }
        p += def.devSize

        if (def.global === MSG_RECORD && !isNaN(lat) && !isNaN(lon)) {
          const ele = !isNaN(enhAlt) ? enhAlt : alt
          if (!isNaN(ele)) lastEle = ele
          points.push({
            lat, lon,
            ele: isNaN(lastEle) ? 0 : lastEle,
            time: ts !== undefined && !isNaN(ts) ? new Date((ts + FIT_EPOCH_S) * 1000) : undefined,
          })
        }
      }
    } catch (e) {
      // Fichier tronqué (montre éteinte en cours d'écriture) : on garde les points déjà lus.
      if (!(e instanceof RangeError)) throw e
      break
    }
    pos = end + 2 // CRC
  }
  return fillLeadingEle(points)
}

// Les premiers points peuvent arriver avant la première altitude (baromètre pas encore prêt) : on leur donne celle-ci
// plutôt que 0, qui fausserait le profil et le dénivelé.
function fillLeadingEle(points: GpxPoint[]): GpxPoint[] {
  const first = points.findIndex(p => p.ele !== 0)
  if (first > 0) for (let i = 0; i < first; i++) points[i].ele = points[first].ele
  return points
}
