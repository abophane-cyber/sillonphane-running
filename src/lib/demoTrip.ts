import { parseGpx } from './gpx'
import { getVoyage, saveVoyage, createVoyage, addTrackToVoyage, addPhotoToVoyage, replacePhotoBlob, deleteTrackPdfCache } from './voyageDB'
import type { ParsedGpx, VoyageTrack } from '../types'

// Course d'exemple ouverte par les boutons « Essayer avec une course d'exemple » de la landing
// (/app.html?start&demo) : la trace de « Demo Running » (23,8 km à Charnat, 1er octobre 2026, heures de passage
// comprises), rangée dans un sillon dédié pour pouvoir tester le film ET l'affiche sans rien importer. Le sillon est
// créé une seule fois puis réutilisé.
const DEMO_GPX = `${import.meta.env.BASE_URL}demo/course-exemple.gpx`
// Photos de la course d'exemple, réduites (l'encodage efface l'EXIF, l'heure de prise de vue est donc reportée
// ici). Aucune pour l'instant : l'affiche se compose sans photo ou avec celles de l'utilisateur.
const DEMO_PHOTOS: { url: string; takenAt: string }[] = []
// À incrémenter à chaque changement des fichiers photo : un sillon d'exemple d'une version antérieure voit ses
// photos remplacées à la réouverture, et l'URL versionnée contourne le cache HTTP du navigateur.
const DEMO_VERSION = 1
const demoPhotoUrl = (url: string) => `${url}?v=${DEMO_VERSION}`
async function fetchDemoPhoto(url: string): Promise<Blob> {
  const r = await fetch(demoPhotoUrl(url))
  if (!r.ok) throw new Error(String(r.status))
  return r.blob()
}
const DEMO_SILLON_NAME = "Course d'exemple"
// Clé changée au passage de la rando à la course d'exemple : un ancien sillon « Rando d'exemple » n'est pas repris.
const DEMO_VOYAGE_KEY = 'running:sillon-demo-course-id'

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
