import { parseGpx } from './gpx'
import { getVoyage, saveVoyage, createVoyage, addTrackToVoyage, addPhotoToVoyage, replacePhotoBlob, deleteTrackPdfCache } from './voyageDB'
import type { ParsedGpx, VoyageTrack } from '../types'

// Rando d'exemple ouverte par les boutons « Essayer avec une rando d'exemple » de la landing
// (/app.html?start&demo) : la trace (étape GTA J17 en Vanoise, 15 km, descente vers Pralognan, recalée sur l'heure et
// la position des photos géolocalisées) et les photos de cette même journée, rangées dans un sillon dédié pour pouvoir tester le
// film ET l'album sans rien importer. Le sillon est créé une seule fois puis réutilisé.
const DEMO_GPX = `${import.meta.env.BASE_URL}demo/rando-exemple.gpx`
// Photos réduites et filigranées (sillonphane.fr/rando) : l'encodage efface l'EXIF, l'heure de prise de
// vue est donc reportée ici.
const DEMO_PHOTOS: { url: string; takenAt: string }[] = [
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_073836.jpg`, takenAt: '2025-08-01T05:38:36Z' },
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_092219.jpg`, takenAt: '2025-08-01T07:22:19Z' },
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_095935.jpg`, takenAt: '2025-08-01T07:59:35Z' },
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_105202.jpg`, takenAt: '2025-08-01T08:52:02Z' },
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_113421.jpg`, takenAt: '2025-08-01T09:34:21Z' },
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_115907.jpg`, takenAt: '2025-08-01T09:59:07Z' },
  { url: `${import.meta.env.BASE_URL}demo/vanoise/20250801_124814.jpg`, takenAt: '2025-08-01T10:48:14Z' },
]
// À incrémenter à chaque changement des fichiers photo (ex. filigrane) : un sillon d'exemple d'une
// version antérieure voit ses photos remplacées à la réouverture, et l'URL versionnée contourne le
// cache HTTP du navigateur. 1 = filigrane en bas à droite, 2 = bande pleine largeur, 3 = bande allégée,
// 4 = adresse sillonphane.fr/rando (photos régénérées depuis les originaux : scripts/demo-photos.mjs).
const DEMO_VERSION = 4
const demoPhotoUrl = (url: string) => `${url}?v=${DEMO_VERSION}`
async function fetchDemoPhoto(url: string): Promise<Blob> {
  const r = await fetch(demoPhotoUrl(url))
  if (!r.ok) throw new Error(String(r.status))
  return r.blob()
}
const DEMO_SILLON_NAME = "Rando d'exemple"
const DEMO_VOYAGE_KEY = 'running:sillon-demo-voyage-id'

export interface DemoTrip {
  voyageId: string
  track: VoyageTrack
  parsed: ParsedGpx
}

// Un seul chargement à la fois : l'effet de démarrage d'App peut s'exécuter deux fois (StrictMode en
// dev), ce qui créait deux sillons d'exemple.
let pending: Promise<DemoTrip> | null = null
export function openDemoTrip(): Promise<DemoTrip> {
  if (!pending) pending = loadDemoTrip().finally(() => { pending = null })
  return pending
}

async function loadDemoTrip(): Promise<DemoTrip> {
  let storedId: string | null = null
  try { storedId = localStorage.getItem(DEMO_VOYAGE_KEY) } catch { /* stockage indisponible */ }
  const existing = storedId ? await getVoyage(storedId) : undefined
  if (existing && existing.tracks[0]) {
    if ((existing.demoVersion ?? 1) < DEMO_VERSION) {
      // Photos d'une version antérieure : on remplace leur image en gardant leur id (album et films
      // intacts), puis on invalide le PDF en cache de l'étape, qui contenait les anciennes images.
      for (const { url } of DEMO_PHOTOS) {
        const photo = existing.photos.find(p => p.name === url.split('/').pop())
        if (!photo) continue
        try { await replacePhotoBlob(existing.id, photo.id, await fetchDemoPhoto(url)) }
        catch (e) { console.warn('[demo] photo non mise à jour :', url, e) }
      }
      for (const t of existing.tracks) await deleteTrackPdfCache(t.id)
      const fresh = await getVoyage(existing.id)
      if (fresh) await saveVoyage({ ...fresh, demo: true, demoVersion: DEMO_VERSION })
    } else if (!existing.demo) {
      await saveVoyage({ ...existing, demo: true }) // sillon d'exemple créé avant l'indicateur
    }
    return { voyageId: existing.id, track: existing.tracks[0], parsed: parseGpx(existing.tracks[0].gpxData) }
  }

  const gpxData = await fetch(DEMO_GPX).then(r => {
    if (!r.ok) throw new Error(`Trace d'exemple introuvable (${r.status})`)
    return r.text()
  })
  const parsed = parseGpx(gpxData)
  const t = parsed.tracks[0]
  const voyage = { ...createVoyage(DEMO_SILLON_NAME), demo: true, demoVersion: DEMO_VERSION }
  await saveVoyage(voyage)
  try { localStorage.setItem(DEMO_VOYAGE_KEY, voyage.id) } catch { /* stockage indisponible */ }
  const track = await addTrackToVoyage(voyage.id, {
    name: parsed.name ?? t?.name ?? DEMO_SILLON_NAME,
    gpxData,
    distanceM: t?.distance,
    elevGainM: t?.elevGain,
    elevLossM: t?.elevLoss,
    durationSec: t?.duration,
    date: t?.startTime?.toISOString().slice(0, 10),
  })

  // Photos : une photo qui ne se télécharge pas est simplement omise, la démo reste utilisable.
  // Ajout dans l'ordre chronologique (séquentiel), comme un import manuel.
  for (const { url, takenAt } of DEMO_PHOTOS) {
    try {
      const blob = await fetchDemoPhoto(url)
      await addPhotoToVoyage(voyage.id, {
        name: url.split('/').pop()!,
        trackId: track.id,
        sizeBytes: blob.size,
        takenAt: new Date(takenAt).toISOString(),
      }, blob)
    } catch (e) {
      console.warn('[demo] photo ignorée :', url, e)
    }
  }

  return { voyageId: voyage.id, track, parsed }
}
