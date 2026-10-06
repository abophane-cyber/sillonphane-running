import type { ComposedAlbumPage } from '../types'
import { resolveCoverMapUrl } from '../lib/albumPages'
import { coverTemplate, coverTheme, themeColor, DEFAULT_COVER_TEMPLATE, DEFAULT_BACK_COVER_TEMPLATE } from '../lib/coverTemplates'
import { AlbumCoverContent } from './AlbumCover'

interface Props {
  coverPage?: ComposedAlbumPage
  backCoverPage?: ComposedAlbumPage
  photoUrls: Record<string, string>
  /** Dimensions de la feuille de couverture (cm), largeur de dos et fond perdu, du profil. */
  sheetCm: { w: number; h: number }
  spineCm: number
  bleedCm: number
  /** Format de la page composée (cm) — la couverture / le dos sont mis à cette proportion À
   * L'INTÉRIEUR du panneau rogné (net), le fond du panneau débordant dans le fond perdu. */
  pageCm: { w: number; h: number }
}

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

/** Feuille de couverture « wrap » d'un seul tenant, telle qu'exigée par WhiteWall :
 * [fond perdu | 4e de couverture | dos | 1re de couverture | fond perdu]. */
export function AlbumWrapCoverContent({ coverPage, backCoverPage, photoUrls, sheetCm, spineCm, bleedCm, pageCm }: Props) {
  const box = wrapCoverBoxCm(sheetCm, spineCm, bleedCm, pageCm)
  return (
    <div
      className="asp2-a4 asp2-a4--wrap"
      style={{
        width: `${sheetCm.w}cm`,
        height: `${sheetCm.h}cm`,
        '--albwrap-spine': `${spineCm}cm`,
        '--albwrap-bleed': `${bleedCm}cm`,
        '--albwrap-cover-w': `${box.w}cm`,
        '--albwrap-cover-h': `${box.h}cm`,
        '--albwrap-cover-bg': (() => {
          const t = coverTemplate(coverPage?.coverTemplate)
          return themeColor(coverPage?.cover?.bg ?? t.background, coverTheme(t, coverPage?.cover))
        })(),
      } as React.CSSProperties}
    >
      <div className="albwrap-half albwrap-half--back">
        {backCoverPage && (
          <AlbumCoverContent
            template={backCoverPage.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE}
            cover={backCoverPage.cover}
            boxes={backCoverPage.boxes}
            photoUrls={photoUrls}
            mapUrl={resolveCoverMapUrl(backCoverPage, photoUrls)}
          />
        )}
      </div>
      <div className="albwrap-spine" aria-hidden="true" />
      <div className="albwrap-half albwrap-half--front">
        {coverPage && (
          <AlbumCoverContent
            template={coverPage.coverTemplate ?? DEFAULT_COVER_TEMPLATE}
            cover={coverPage.cover}
            boxes={coverPage.boxes}
            photoUrls={photoUrls}
            mapUrl={resolveCoverMapUrl(coverPage, photoUrls)}
          />
        )}
      </div>
    </div>
  )
}
