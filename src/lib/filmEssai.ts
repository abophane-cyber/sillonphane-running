// Films d'essai : « ?essai » dans l'URL de l'appli -> films 2D et 3D de ESSAI_FILM_S au total, réduits au parcours
// (sans écran-titre ni plans de fin), pour vérifier vite un réglage. Rangés dans Mes sillons comme les autres.

export const ESSAI_FILM_S = 15

export function isEssaiFilm(): boolean {
  return new URLSearchParams(window.location.search).has('essai')
}
