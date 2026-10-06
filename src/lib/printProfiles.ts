/** Profil d'imprimeur : préréglages de format d'album pour un service print-on-demand donné.
 * L'utilisateur choisit un profil dans « Créer mon album-photo » ; ça préremplit la taille de
 * page (ajustable ensuite) et fixe le mode de couverture et les contraintes de pagination.
 *
 * Le modèle « génère un PDF → l'utilisateur l'uploade à la main » (pas d'API). Specs relevées sur
 * les sites des imprimeurs pour un format paysage. */

export type CoverMode =
  /** Couverture = fichier séparé, une seule feuille : [4e de couv | dos | 1re de couv] d'un tenant. */
  | 'wrap-spread'
  /** Un seul fichier : couverture en 1re page, dos en dernière page (après les pages intérieures). */
  | 'inline-first-last'
  /** Historique : couverture puis dos en 2 pages, au début du fichier de l'album. */
  | 'separate-pages'

export interface PrintProfile {
  id: string
  label: string
  /** Taille de page de contenu du PDF, en cm (largeur × hauteur). Préremplie à la sélection. */
  pageCm: { w: number; h: number }
  coverMode: CoverMode
  /** wrap-spread : dimensions de la feuille de couverture (cm), largeur de dos et fond perdu par défaut. */
  coverSpread?: {
    sheetCm: { w: number; h: number }
    spineCm: number
    bleedCm: number
    /** Largeur de dos (mm) selon le nombre de pages intérieures — points relevés chez l'imprimeur,
     * interpolation linéaire entre points, bornée aux extrêmes. Absent ⇒ dos fixe = `spineCm`. */
    spineAnchors?: Array<[pages: number, mm: number]>
    /** Bornes et pas du champ « nombre de pages » (WhiteWall : 28 à 200, de 4 en 4). */
    pageRange?: { min: number; max: number; step: number }
  }
  /** Contraintes sur le nombre de pages intérieures (hors couverture). */
  pageCount?: { min?: number; multipleOf?: number }
  /** Imprimeur associé (voir lib/printPartners.ts) — le PDF est mis à SES dimensions, donc c'est le
   * seul service proposé après l'export. Absent (Personnalisé) ⇒ aucun imprimeur imposé. */
  partnerId?: string
  /** Étiquette de positionnement affichée dans le sélecteur, à côté du libellé (ex. « prix serré »,
   * « finition premium ») — aide l'utilisateur à choisir en connaissance de cause. */
  tag?: string
  /** Aide affichée en infobulle du sélecteur. */
  note: string
}

// « Personnalisé » en tête : c'est le profil des nouveaux sillons (voir createVoyage).
export const PRINT_PROFILES: PrintProfile[] = [
  {
    id: 'custom',
    label: 'Personnalisé',
    pageCm: { w: 29.7, h: 21 },
    coverMode: 'separate-pages',
    note: 'Format libre. Couverture et dos en pages séparées, au début du fichier de l\'album.',
  },
  {
    id: 'flexilivre-a4',
    label: 'Flexilivre — A4 paysage',
    pageCm: { w: 29.7, h: 21 },
    coverMode: 'inline-first-last',
    pageCount: { multipleOf: 4 },
    partnerId: 'flexilivre',
    tag: 'prix serré',
    note: 'PDF au format fini 29,7 × 21 cm (pas de fond perdu). Un seul fichier : couverture en 1re page, dos en dernière. Garder les photos à ≥ 5 mm du bord. Pages intérieures reliées par cahiers de 4 : on complète à un multiple de 4 avec des pages blanches si besoin. Le plus abordable — idéal pour un premier album ou un cadeau simple.',
  },
  {
    id: 'flexilivre-a5',
    label: 'Flexilivre — A5 paysage',
    pageCm: { w: 21, h: 15 },
    coverMode: 'inline-first-last',
    pageCount: { multipleOf: 4 },
    partnerId: 'flexilivre',
    tag: 'prix serré',
    note: 'PDF au format fini 21 × 15 cm (pas de fond perdu). Un seul fichier : couverture en 1re page, dos en dernière. Garder les photos à ≥ 5 mm du bord. Pages intérieures reliées par cahiers de 4 : on complète à un multiple de 4 avec des pages blanches si besoin. Format compact, le moins cher — pour offrir ou tester.',
  },
  {
    id: 'whitewall',
    label: 'WhiteWall — paysage',
    pageCm: { w: 27.3, h: 21.1 },
    coverMode: 'wrap-spread',
    coverSpread: {
      sheetCm: { w: 57.82, h: 23.0 }, spineCm: 0.82, bleedCm: 1.0,
      // Points WhiteWall (pages intérieures → dos mm), relevés sur l'éditeur.
      spineAnchors: [[28, 8.2], [60, 10.4], [100, 12.6], [200, 19.2]],
      pageRange: { min: 28, max: 200, step: 4 },
    },
    // Aligné sur pageRange (28 à 200, de 4 en 4) : le PDF intérieur généré est complété avec des
    // pages blanches jusqu'au multiple de 4 exigé par l'éditeur WhiteWall, pas seulement un nombre
    // pair — sinon le fichier livré ne correspond pas au nombre de pages qu'on y déclare.
    pageCount: { min: 28, multipleOf: 4 },
    partnerId: 'whitewall',
    tag: 'impression premium',
    note: 'Pages 27,3 × 21,1 cm (fond perdu 3 mm inclus). Couverture = fichier séparé (feuille dos + tranche + couverture). Finition haut de gamme, papier photo.',
  },
]

/** Nombre de pages ramené aux bornes et au pas du profil (WhiteWall : 28–200, de 4 en 4). */
export function snapWrapPageCount(profile: PrintProfile, pages: number): number {
  const r = profile.coverSpread?.pageRange
  if (!r || !Number.isFinite(pages)) return r?.min ?? Math.round(pages)
  const clamped = Math.min(r.max, Math.max(r.min, pages))
  const snapped = r.min + Math.round((clamped - r.min) / r.step) * r.step
  return Math.min(r.max, Math.max(r.min, snapped))
}

/** Largeur de dos (mm) pour un nombre de pages intérieures : interpolation linéaire dans
 * `coverSpread.spineAnchors`, bornée aux extrêmes de la table. Sans table ou sans nombre de pages
 * ⇒ valeur fixe du profil (`coverSpread.spineCm`). */
export function spineMmForPages(profile: PrintProfile, wrapPageCount?: number): number {
  const cs = profile.coverSpread
  const fallback = (cs?.spineCm ?? 0) * 10
  const a = cs?.spineAnchors
  if (!a?.length || wrapPageCount == null || !Number.isFinite(wrapPageCount)) return fallback
  const p = Math.min(a[a.length - 1][0], Math.max(a[0][0], wrapPageCount))
  for (let i = 1; i < a.length; i++) {
    const [p0, m0] = a[i - 1]
    const [p1, m1] = a[i]
    if (p <= p1) return m0 + (m1 - m0) * (p - p0) / (p1 - p0)
  }
  return a[a.length - 1][1]
}

/** `coverSpread` du profil avec le dos calculé d'après `wrapPageCount` (voir spineMmForPages) :
 * seule la largeur du dos change, la largeur de feuille suit (les deux demi-panneaux + fonds perdus
 * extérieurs sont constants), hauteur et fond perdu inchangés. `undefined` si pas de `coverSpread`. */
export function wrapSpreadForPages(
  profile: PrintProfile, wrapPageCount?: number,
): PrintProfile['coverSpread'] {
  const base = profile.coverSpread
  if (!base) return undefined
  const spineCm = spineMmForPages(profile, wrapPageCount) / 10
  const nonSpineW = base.sheetCm.w - base.spineCm // 2 demi-panneaux + 2 fonds perdus, constants
  return { ...base, sheetCm: { w: nonSpineW + spineCm, h: base.sheetCm.h }, spineCm }
}

export const DEFAULT_PRINT_PROFILE_ID = 'flexilivre-a4'

export function getPrintProfile(id: string | undefined): PrintProfile {
  return PRINT_PROFILES.find(p => p.id === id)
    ?? PRINT_PROFILES.find(p => p.id === DEFAULT_PRINT_PROFILE_ID)!
}

/** Nombre de pages blanches à ajouter pour respecter min / multiple. */
export function pagesToPad(current: number, c?: { min?: number; multipleOf?: number }): number {
  if (!c) return 0
  let target = Math.max(current, c.min ?? 0)
  if (c.multipleOf && target % c.multipleOf !== 0) {
    target += c.multipleOf - (target % c.multipleOf)
  }
  return Math.max(0, target - current)
}
