// Mise en scène des randonneurs 3D (cf. hiker3dSprite.ts), partagée par l'aperçu (TrackMap.tsx) et le film 2D
// (filmExport.ts) : mêmes plans serrés, mêmes durées, même écart du duo, même filtre de cap.
import { elevOverlayRect } from './drawElevOverlay'

/** Randonneurs 3D dès que l'appareil a WebGL2 ; sinon, le ruban seul (aperçu et film). */
export const HIKER3D_ENABLED = (() => {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
})()

/** Niveaux de zoom ajoutés au zoom de marche pour les plans serrés de départ et d'arrivée. */
export const HIKER3D_CLOSE_ZOOM = 3.5
/** Zoom d'arrivée, dézoom de départ et vue d'ensemble finale. */
export const HIKER3D_END_ZOOM_MS = 3000
export const HIKER3D_START_DEZOOM_MS = 2000
export const HIKER3D_OVERVIEW_MS = 5000
/** Maintien sur le plan serré d'arrivée, entre la fin du zoom et le dézoom vers la vue d'ensemble (le geste de
 * victoire continue pendant le dézoom). Running : aucun, la vue d'ensemble arrive dès la fin du zoom. */
export const HIKER3D_END_HOLD_MS = 0
/** Début du geste d'arrivée (victoire), en part du zoom d'arrivée. Running : 0 — dès la ligne franchie, sinon le
 * coureur courait sur place pendant le zoom. */
export const HIKER3D_OUTRO_AT = 0
/** Duo : écart côte à côte (départ, arrivée) de chaque marcheur au point, et distance en file pendant la marche
 * (px à l'écran, taille de marche). */
export const HIKER3D_PAIR_PX = 42
export const HIKER3D_FOLLOW_PX = 55
/** Mise en file au départ (côte à côte -> l'un derrière l'autre) : durée caractéristique ; le second y rejoint le
 * chemin en marchant (orienté selon son déplacement), assez lentement pour que ce soit lisible. */
export const HIKER3D_MERGE_TAU_S = 1.5
// Cap des personnages : celui du chemin à leur position, avec ralenti dans les virages (cf. trackPacing.ts).
/** Taille des personnages selon le zoom : ×(1 + 0,45 par niveau au-dessus du zoom de marche), bornée. */
export const HIKER3D_SCALE_PER_ZOOM = 0.45
export const HIKER3D_MIN_SCALE = 0.6
export const HIKER3D_MAX_SCALE = 4.5
/** Running : taille du coureur sur la carte (× la taille de marche d'origine), plus petit avec la caméra rapprochée.
 * Ne touche que les personnages (pas les noms de lieux ni les bornes, cf. --ground-scale). */
export const HIKER3D_BODY_SCALE = 0.75
/** Hauteur du cartouche d'épreuve (bas gauche) avec sa marge basse, en px d'une image de 1080 px de haut (cf.
 * drawEventCartouche) : sert à placer la coureuse présentée au départ entre les incrustations. */
export const CARTOUCHE_TOP_1080 = 64 + 118

/** Running : coureur présenté en grand au départ, même place dans l'aperçu (par-dessus la carte, avant la lecture et
 * pendant le décompte) et dans les films (plan serré du départ) : corps = `body` de la hauteur de l'image, pieds en
 * (`feetX`, `feetY`), en part de l'image. À gauche, à mi-distance entre l'encart du haut et le cartouche d'épreuve,
 * pour une image de `w` × `h` px. Il rejoint ensuite sa taille et sa place de course. */
export function startPresentAt(w: number, h: number): { body: number; feetX: number; feetY: number } {
  const r = elevOverlayRect(1920, 1080)
  const top = (r.y + r.h) * (w / 1920)
  const bottom = h - CARTOUCHE_TOP_1080 * Math.min(w / 1920, h / 1080)
  const bodyPx = Math.min(0.5 * h, 0.82 * (bottom - top))
  return { body: bodyPx / h, feetX: 0.09, feetY: ((top + bottom) / 2 + bodyPx / 2) / h }
}

/** Taille des personnages (1 = taille de marche) au zoom `zoom`, la marche se faisant au zoom `walkZoom`. */
export function hiker3dScaleForZoom(zoom: number, walkZoom: number): number {
  return Math.max(HIKER3D_MIN_SCALE, Math.min(HIKER3D_MAX_SCALE, 1 + (zoom - walkZoom) * HIKER3D_SCALE_PER_ZOOM))
}

/** Scène de départ (course) : panneau de la commune au premier plan, décalé vers le bas de l'écran de ce nombre de
 * px (taille de marche) par rapport au point de départ ; la coureuse au point.
 * Même valeur dans l'aperçu (App.css, .loc-sign-anchor--depart) et le film 2D. */
export const START_SIGN_OFFSET_PX = 40

/** Accélère puis ralentit en douceur (pas d'à-coup au début ni à la fin du mouvement de caméra). */
export const smoothEase = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** Mètres par pixel (tuiles MapLibre de 512 px) à la latitude et au zoom donnés. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom))
}
