import type { PhotoLayout } from '../types'

// Mises en page des pages photos de l'album : nombre de photos et libellés (AlbumPhotoPage, AlbumPageEditor).

export const PHOTOS_PER_LAYOUT: Record<PhotoLayout, number> = {
  hero: 1,
  duo: 2,
  magazine3: 3,
  notebook3: 3,
  gallery4: 4,
  mosaic5: 5,
  triptych: 3,
  soloText: 1,
  triptychPortrait: 3,
  mixedOrientation: 3,
  grid: 4,
  triangle3: 3,
  stack2: 2,
}

export const LAYOUT_LABELS: Record<PhotoLayout, string> = {
  hero: 'Focus grand angle',
  duo: 'Duo + récit',
  magazine3: 'Magazine 3 photos',
  gallery4: 'Galerie 4 photos',
  notebook3: 'Carnet de bord',
  mosaic5: 'Mosaïque 5 photos',
  triptych: 'Trio bandeau',
  soloText: 'Photo + récit long',
  triptychPortrait: 'Trio portrait',
  mixedOrientation: '1 portrait + 2 paysage',
  grid: 'Grille libre',
  triangle3: 'Triangle (bas centré)',
  stack2: '2 photos horizontales empilées',
}
