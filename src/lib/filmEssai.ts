// Films d'essai : « ?essai » dans l'URL de l'appli -> films 2D et 3D réduits aux ESSAI_FILM_S premières secondes
// du parcours (sans l'ouverture), à vitesse normale, sans plans de fin. Rangés dans Mes sillons comme les autres.
// Mémorisé pour l'onglet (le lien « Commencer » de la page d'accueil ne garde pas ?essai) ; « ?essai=0 » l'arrête.

export const ESSAI_FILM_S = 15
const KEY = 'sillonphane.essai'

export function isEssaiFilm(): boolean {
  const v = new URLSearchParams(window.location.search).get('essai')
  try {
    if (v === '0') sessionStorage.removeItem(KEY)
    else if (v != null) sessionStorage.setItem(KEY, '1')
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return v != null && v !== '0'
  }
}

// Fin seule : « ?fin » dans l'URL -> films 2D et 3D réduits à leurs FIN_FILM_S dernières secondes (arrivée et vue
// d'ensemble). Ce qui précède est calculé (caméra, positions) mais ni dessiné ni encodé. Même mémorisation que ?essai ;
// « ?fin=0 » l'arrête.
export const FIN_FILM_S = 15
const FIN_KEY = 'sillonphane.fin'

export function isFinFilm(): boolean {
  const v = new URLSearchParams(window.location.search).get('fin')
  try {
    if (v === '0') sessionStorage.removeItem(FIN_KEY)
    else if (v != null) sessionStorage.setItem(FIN_KEY, '1')
    return sessionStorage.getItem(FIN_KEY) === '1'
  } catch {
    return v != null && v !== '0'
  }
}

// Film promotionnel (concepteur) : « ?promo » dans l'URL -> pas de mention « Film personnel non officiel » sur la
// barre de fin. Réservé à nos vidéos de promotion, avec le nom d'une épreuve seulement sur accord écrit de son
// organisateur (cf. CLAUDE.md). Même mémorisation que ?essai ; « ?promo=0 » l'arrête.
const PROMO_KEY = 'sillonphane.promo'

export function isPromoFilm(): boolean {
  const v = new URLSearchParams(window.location.search).get('promo')
  try {
    if (v === '0') sessionStorage.removeItem(PROMO_KEY)
    else if (v != null) sessionStorage.setItem(PROMO_KEY, '1')
    return sessionStorage.getItem(PROMO_KEY) === '1'
  } catch {
    return v != null && v !== '0'
  }
}
