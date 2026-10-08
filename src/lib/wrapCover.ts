// Géométrie de la couverture à plat (AlbumWrapCover, VoyageCoverEditor).

/** Géométrie d'après le gabarit WhiteWall (IDML) : feuille brute `sheetCm` (fond perdu inclus),
 * fond perdu `bleedCm` sur chaque bord extérieur, tranche `spineCm` centrée. Chaque demi-feuille
 * fait (sheetW − spine) / 2 ; le panneau NET (rogné) d'une moitié = cette largeur − bleed (côté
 * extérieur), et sheetH − 2·bleed en hauteur. La page composée est ajustée (sans déformation) dans
 * ce panneau net ; les bandes de fond perdu sont remplies par la couleur de fond de la moitié. */
export function wrapCoverBoxCm(
  sheetCm: { w: number; h: number }, spineCm: number, bleedCm: number, pageCm: { w: number; h: number },
): { w: number; h: number } {
  const netW = (sheetCm.w - spineCm) / 2 - bleedCm
  const netH = sheetCm.h - 2 * bleedCm
  const ar = pageCm.w / pageCm.h
  // Ajustement « contain » : on remplit le net sans déborder ni déformer.
  const w = Math.min(netW, netH * ar)
  const h = Math.min(netH, netW / ar)
  return { w, h }
}
