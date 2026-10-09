// Miniatures des affiches pour Mes sillons : dessinées une à une (le dessin charge des tuiles de carte), gardées en
// mémoire le temps de la session et redessinées seulement si l'affiche ou la trace change.
import type { VoyageTrack } from '../types'
import { buildPosterData, drawPoster } from './poster'
import { getPhotoBlob } from './voyageDB'

const THUMB_W = 240
const cache = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

async function render(track: VoyageTrack): Promise<string | null> {
  const settings = track.poster ?? {}
  const urls: string[] = []
  try {
    const data = buildPosterData(track)
    const photos: HTMLImageElement[] = []
    for (const id of settings.photoIds ?? []) {
      const blob = await getPhotoBlob(id)
      if (!blob) continue
      const url = URL.createObjectURL(blob)
      urls.push(url)
      const img = await loadImage(url).catch(() => null)
      if (img) photos.push(img)
    }
    const canvas = document.createElement('canvas')
    await drawPoster(canvas, THUMB_W, data, settings, photos)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch (e) {
    console.error('[miniature affiche]', e)
    return null
  } finally {
    urls.forEach(u => URL.revokeObjectURL(u))
  }
}

/** Miniature (data URL JPEG) de l'affiche d'une course ; null si elle n'a pas d'affiche ou si le dessin échoue. */
export function posterThumb(track: VoyageTrack): Promise<string | null> {
  if (!track.poster) return Promise.resolve(null)
  const key = `${track.id}:${track.gpxData.length}:${JSON.stringify(track.poster)}`
  let hit = cache.get(key)
  if (!hit) {
    hit = queue.then(() => render(track))
    queue = hit.catch(() => null)
    cache.set(key, hit)
  }
  return hit
}
