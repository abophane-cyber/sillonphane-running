// Qualité des films : 1080p par défaut, ou « Qualité YouTube » en 1440p (ordinateur seulement).
// YouTube réserve son meilleur encodage (VP9/AV1) aux vidéos envoyées en 1440p ou plus : le film y paraît plus net,
// même regardé en 1080p. Le film garde sa mise en page de 1920×1080 (mêmes cadrages, mêmes tailles de texte) ; il est
// seulement dessiné FILM_HD_SCALE fois plus grand (textes, ruban, relief 3D plus fins ; tuiles de la carte 2D agrandies).
import { STORAGE_PREFIX } from './appIdentity'

const KEY = `${STORAGE_PREFIX}film-hd`

/** 1920×1080 -> 2560×1440. */
export const FILM_HD_SCALE = 4 / 3

/** Pas sur mobile : mémoire du canvas et de l'encodeur trop juste (le film 2D y est déjà en 720p). */
export const FILM_HD_AVAILABLE = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export function getFilmHd(): boolean {
  if (!FILM_HD_AVAILABLE) return false
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setFilmHd(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /**/ }
}

/** Codecs H.264 essayés dans l'ordre. 1440p : niveau 5.0 au moins (le 4.1 plafonne à 2048×1088). */
export function filmCodecs(hd: boolean): string[] {
  return hd ? ['avc1.4d0032', 'avc1.4d0033', 'avc1.640032'] : ['avc1.4d0029', 'avc1.4d0028', 'avc1.42001e']
}
