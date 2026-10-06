// Mise en scène des randonneurs 3D (cf. hiker3dSprite.ts), partagée par l'aperçu (TrackMap.tsx) et le film 2D
// (filmExport.ts) : mêmes plans serrés, mêmes durées, même écart du duo, même filtre de cap.

/** Randonneurs 3D dès que l'appareil a WebGL2 ; sinon, le ruban seul (aperçu et film). */
export const HIKER3D_ENABLED = (() => {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
})()

/** Niveaux de zoom ajoutés au zoom de marche pour les plans serrés de départ et d'arrivée. */
export const HIKER3D_CLOSE_ZOOM = 3.5
/** Zoom d'arrivée, dézoom de départ et vue d'ensemble finale. */
export const HIKER3D_END_ZOOM_MS = 3000
export const HIKER3D_START_DEZOOM_MS = 4000
export const HIKER3D_OVERVIEW_MS = 5000
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
/** Running : coureur choisi avant la lecture, présenté en grand au départ (dossard lisible), pieds sur le bas du cadre :
 * il occupe cette part de la hauteur de la carte (borné par HIKER3D_MAX_SCALE). Au lancement de l'aperçu, la caméra
 * recule au plan serré du départ. */
export const HIKER3D_PRESENT_HEIGHT = 0.8
/** Pieds à cette part de la hauteur de la carte, depuis le bas. */
export const HIKER3D_PRESENT_FEET = 0.04
export const HIKER3D_PRESENT_MS = 1500

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
