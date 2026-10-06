// Végétation des vues aériennes poussée vers le vert sapin #006A4E (teinte ≈ 164°) : seuls les pixels verts (arbres,
// pelouses, champs) changent de teinte et gagnent un peu de saturation ; toits, routes et eau gardent leurs couleurs.
// Appliqué à chaque tuile au chargement — aperçu et film (MapLibre, protocole VEG_PROTOCOL) et mosaïque du film 2D
// (filmMapMosaic.ts) — avant l'assombrissement général (BASEMAP_ADJUST).
import type maplibregl from 'maplibre-gl'

/** Teinte visée (°) et bornes des teintes considérées comme végétation. */
const TARGET_HUE = 164
const HUE_MIN = 50, HUE_MAX = 175
/** Saturation minimale pour être considéré comme végétation (en dessous : gris, routes, toits ternes). */
const SAT_MIN = 0.1
/** Force du recoloriage (0 à 1) et saturation visée pour la végétation. */
const STRENGTH = 0.85
const SAT_TARGET = 0.5

/** Recolorie la végétation d'une image RGBA, en place. */
export function recolorVegetation(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const v = max, c = max - min
    if (c < 1e-3 || max !== g && !(max === r && g > b && g >= 0.85 * r)) continue // pas vert (ni jaune-vert)
    const s = c / max
    if (s < SAT_MIN || v < 0.06) continue
    let h: number
    if (max === r) h = 60 * (((g - b) / c) % 6)
    else if (max === g) h = 60 * ((b - r) / c + 2)
    else h = 60 * ((r - g) / c + 4)
    if (h < 0) h += 360
    if (h < HUE_MIN || h > HUE_MAX) continue
    // Poids : plein au cœur des verts, s'éteint en approchant des bornes (pas de cassure sur les jaunes ou les bleus).
    const edge = Math.min(h - HUE_MIN, HUE_MAX - h) / 20
    const w = STRENGTH * Math.min(1, edge) * Math.min(1, (s - SAT_MIN) / 0.1)
    const nh = h + (TARGET_HUE - h) * w
    const ns = s + (Math.max(s, SAT_TARGET) - s) * w
    // HSV -> RGB
    const cc = v * ns, x = cc * (1 - Math.abs(((nh / 60) % 2) - 1)), m = v - cc
    let rr = 0, gg = 0, bb = 0
    if (nh < 60) { rr = cc; gg = x } else if (nh < 120) { rr = x; gg = cc } else if (nh < 180) { gg = cc; bb = x }
    else if (nh < 240) { gg = x; bb = cc } else if (nh < 300) { rr = x; bb = cc } else { rr = cc; bb = x }
    d[i] = Math.round((rr + m) * 255)
    d[i + 1] = Math.round((gg + m) * 255)
    d[i + 2] = Math.round((bb + m) * 255)
  }
}

/** Protocole MapLibre : « sillonveg://… » = la tuile https://… avec la végétation recoloriée. */
export const VEG_PROTOCOL = 'sillonveg'
let registered = false

export function ensureVegetationProtocol(ml: typeof maplibregl): void {
  if (registered) return
  registered = true
  ml.addProtocol(VEG_PROTOCOL, async (params, abortController) => {
    const url = params.url.replace(`${VEG_PROTOCOL}://`, 'https://')
    const res = await fetch(url, { signal: abortController.signal })
    if (!res.ok) throw new Error(`tuile ${res.status}`)
    const bmp = await createImageBitmap(await res.blob())
    const canvas = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    recolorVegetation(img.data)
    ctx.putImageData(img, 0, 0)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    return { data: await out.arrayBuffer() }
  })
}
