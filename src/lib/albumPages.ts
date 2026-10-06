import type {
  AlbumBox, ComposedAlbumPage, CoverElOverride, CoverOverrides, LegacyComposedAlbumPage,
  PhotoLayout, VoyagePhoto,
} from '../types'
import { DEFAULT_COVER_TEMPLATE, DEFAULT_BACK_COVER_TEMPLATE, coverTemplate } from './coverTemplates'
import type { CoverDecorSeed } from './coverTemplates'
import { uuid } from './uuid'

/** Calque par défaut d'une case selon son type (bg 0 · paper 10 · map 20 · photo 30 · decor 40 · text 60). */
export const BOX_Z_DEFAULT: Record<AlbumBox['kind'], number> = { photo: 30, decor: 40, text: 60 }

/** Ordre de calque effectif d'une case (numérique). */
export function boxZIndex(box: AlbumBox): number {
  return box.zIndex ?? BOX_Z_DEFAULT[box.kind]
}

/** Signe des décalages X/Y de l'ombre selon l'orientation choisie. Absent → l'ombre tombe droit
 * vers le bas (X = 0), comme avant. */
export function shadowSign(dir?: string): { sx: number; sy: number } {
  switch (dir) {
    case 'tl': return { sx: -1, sy: -1 }
    case 'tr': return { sx: 1, sy: -1 }
    case 'bl': return { sx: -1, sy: 1 }
    case 'br': return { sx: 1, sy: 1 }
    default: return { sx: 0, sy: 1 }
  }
}

/** Ombre portée du cadre d'une case, uniquement quand l'utilisateur l'a explicitement réglée
 * (`box.shadow` / `shadowLevel` / `shadowDir` défini). Décor : `filter: drop-shadow` (épouse la
 * forme du motif). Photo : `box-shadow`. L'intensité suit `box.shadowLevel` (1 à 4, défaut 2),
 * l'orientation `box.shadowDir`. `box.shadow` absent et non réglée → rien (apparence CSS). */
export function coverBoxShadow(box: AlbumBox): { boxShadow?: string; filter?: string } {
  if (box.shadow === undefined && box.shadowLevel === undefined && box.shadowDir === undefined) return {}
  const on = box.shadow ?? (box.kind === 'photo')
  if (!on) return box.kind === 'decor' ? {} : { boxShadow: 'none' }
  const lvl = Math.max(1, Math.min(4, Math.round(box.shadowLevel ?? 2)))
  const k = lvl / 2   // 0.5 · 1 · 1.5 · 2
  const { sx, sy } = shadowSign(box.shadowDir)
  if (box.kind === 'decor') {
    const a = (0.16 + 0.06 * lvl).toFixed(2)
    return { filter: `drop-shadow(${sx * Math.round(4 * k)}px ${sy * Math.round(4 * k)}px ${Math.round(7 * k)}px rgba(0,0,0,${a}))` }
  }
  const a1 = (0.10 + 0.06 * lvl).toFixed(2)
  const a2 = (0.04 + 0.03 * lvl).toFixed(2)
  return {
    boxShadow: `${sx * Math.round(6 * k)}px ${sy * Math.round(8 * k)}px ${Math.round(16 * k)}px rgba(0,0,0,${a1}), `
      + `${sx * Math.round(1.5 * k)}px ${sy * Math.round(2 * k)}px ${Math.round(5 * k)}px rgba(0,0,0,${a2})`,
  }
}

/** Matérialise les décors « de départ » d'un gabarit en cases libres `kind:'decor'`
 * (déplaçables / redimensionnables / pivotables / supprimables dès le départ). */
export function decorSeedsToBoxes(seeds: CoverDecorSeed[] | undefined): AlbumBox[] {
  return (seeds ?? []).map(s => ({
    id: uuid(), kind: 'decor' as const, decorType: s.decorType,
    x: s.x, y: s.y, w: s.w, h: s.h ?? s.w * 0.6,
    rotation: s.rotate, color: s.color, text: s.text, zIndex: s.zIndex, visible: true,
    movable: true, resizable: true, rotatable: true, deletable: true, duplicable: true,
  }))
}

type BoxRect = { kind: AlbumBox['kind']; x: number; y: number; w: number; h: number }

/** Position/taille de départ (en % de la zone de contenu) pour chaque gabarit — sert à
 * amorcer une nouvelle page composée et à migrer les anciennes pages figées vers des boxes. */
export const PRESET_BOXES: Record<PhotoLayout, BoxRect[]> = {
  hero: [
    { kind: 'photo', x: 0, y: 0, w: 100, h: 100 },
  ],
  duo: [
    { kind: 'photo', x: 0, y: 0, w: 49, h: 68 },
    { kind: 'photo', x: 51, y: 0, w: 49, h: 68 },
    { kind: 'text', x: 0, y: 70, w: 100, h: 30 },
  ],
  magazine3: [
    { kind: 'photo', x: 0, y: 0, w: 64, h: 100 },
    { kind: 'photo', x: 66, y: 0, w: 34, h: 49 },
    { kind: 'photo', x: 66, y: 51, w: 34, h: 49 },
  ],
  gallery4: [
    { kind: 'photo', x: 0, y: 0, w: 49, h: 49 },
    { kind: 'photo', x: 51, y: 0, w: 49, h: 49 },
    { kind: 'photo', x: 0, y: 51, w: 49, h: 49 },
    { kind: 'photo', x: 51, y: 51, w: 49, h: 49 },
  ],
  notebook3: [
    { kind: 'photo', x: 40, y: 0, w: 60, h: 32 },
    { kind: 'photo', x: 40, y: 34, w: 60, h: 32 },
    { kind: 'photo', x: 40, y: 68, w: 60, h: 32 },
    { kind: 'text', x: 0, y: 0, w: 38, h: 100 },
  ],
  mosaic5: [
    { kind: 'photo', x: 0, y: 0, w: 32, h: 45 },
    { kind: 'photo', x: 34, y: 0, w: 32, h: 45 },
    { kind: 'photo', x: 66, y: 0, w: 32, h: 45 },
    { kind: 'photo', x: 0, y: 47, w: 55, h: 53 },
    { kind: 'photo', x: 57, y: 47, w: 43, h: 53 },
  ],
  triptych: [
    { kind: 'photo', x: 0, y: 0, w: 32, h: 100 },
    { kind: 'photo', x: 34, y: 0, w: 32, h: 100 },
    { kind: 'photo', x: 66, y: 0, w: 32, h: 100 },
  ],
  soloText: [
    { kind: 'photo', x: 0, y: 0, w: 54, h: 100 },
    { kind: 'text', x: 56, y: 0, w: 44, h: 100 },
  ],
  triptychPortrait: [
    { kind: 'photo', x: 14, y: 5, w: 22, h: 90 },
    { kind: 'photo', x: 39, y: 5, w: 22, h: 90 },
    { kind: 'photo', x: 64, y: 5, w: 22, h: 90 },
  ],
  mixedOrientation: [
    { kind: 'photo', x: 0, y: 0, w: 36, h: 100 },
    { kind: 'photo', x: 38, y: 0, w: 62, h: 49 },
    { kind: 'photo', x: 38, y: 51, w: 62, h: 49 },
  ],
  grid: [
    { kind: 'photo', x: 0, y: 0, w: 32, h: 32 },
    { kind: 'photo', x: 34, y: 0, w: 32, h: 32 },
    { kind: 'photo', x: 66, y: 0, w: 32, h: 32 },
    { kind: 'photo', x: 0, y: 34, w: 32, h: 32 },
    { kind: 'photo', x: 34, y: 34, w: 32, h: 32 },
    { kind: 'photo', x: 66, y: 34, w: 32, h: 32 },
  ],
  triangle3: [
    { kind: 'photo', x: 0, y: 0, w: 49, h: 64 },
    { kind: 'photo', x: 51, y: 0, w: 49, h: 64 },
    { kind: 'photo', x: 25, y: 68, w: 50, h: 32 },
  ],
  // Deux photos au format paysage, centrées et empilées verticalement
  stack2: [
    { kind: 'photo', x: 27, y: 1, w: 46, h: 48 },
    { kind: 'photo', x: 27, y: 51, w: 46, h: 48 },
  ],
}

/** Crée une nouvelle page composée à partir d'un gabarit de départ (positions libres ensuite). */
export function createPageFromPreset(layout: PhotoLayout): ComposedAlbumPage {
  return {
    id: uuid(),
    boxes: PRESET_BOXES[layout].map(rect => ({ id: uuid(), ...rect })),
    header: layout === 'hero' ? false : undefined,
  }
}

/** Crée la page résumé (carte, dénivelé, météo) — auto-générée depuis les données du tracé,
 * sans cases libres à composer. */
export function createSummaryPage(): ComposedAlbumPage {
  return { id: uuid(), boxes: [], kind: 'summary' }
}

// Rotation de gabarits variés pour un remplissage automatique qui ne soit pas trop répétitif
const AUTO_FILL_LAYOUTS: PhotoLayout[] = ['gallery4', 'magazine3', 'triptych', 'mosaic5', 'duo']

/** Génère des pages composées en plaçant automatiquement les photos (dans l'ordre chronologique,
 * en excluant celles rejetées par l'IA) sur une rotation de gabarits variés — un premier jet
 * rapide, à affiner ensuite manuellement (position, taille, recadrage). */
export function autoFillPages(photos: VoyagePhoto[]): ComposedAlbumPage[] {
  const ordered = [...photos]
    .filter(p => p.aiKeep !== false)
    .sort((a, b) => (a.takenAt || a.createdAt).localeCompare(b.takenAt || b.createdAt))
  if (ordered.length === 0) return []

  const pages: ComposedAlbumPage[] = []
  let cursor = 0
  let layoutIndex = 0
  while (cursor < ordered.length) {
    const layout = AUTO_FILL_LAYOUTS[layoutIndex % AUTO_FILL_LAYOUTS.length]
    layoutIndex++
    const page = createPageFromPreset(layout)
    for (const box of page.boxes) {
      if (box.kind !== 'photo' || cursor >= ordered.length) continue
      box.photoId = ordered[cursor++].id
    }
    pages.push(page)
  }
  return pages
}

/** Case-photo spéciale : identifiant réservé pour la carte proposée dans la liste des photos de
 * couverture — un asset du site (visible depuis n'importe quel appareil), pas une photo importée
 * dans le voyage. Simple suggestion parmi d'autres : jamais placée d'office dans une case. */
export const DEFAULT_COVER_PHOTO_ID = '__default-cover-map__'
export const DEFAULT_COVER_PHOTO_URL = `${import.meta.env.BASE_URL}cover-defaults/map-default.jpg`

/** Résout l'URL d'une case-photo de couverture, y compris la carte proposée par défaut (qui
 * n'existe pas dans les photos du voyage, contrairement aux autres cases). */
export function resolveCoverPhotoUrl(photoId: string | undefined, photoUrls: Record<string, string>): string | undefined {
  if (!photoId) return undefined
  if (photoId === DEFAULT_COVER_PHOTO_ID) return DEFAULT_COVER_PHOTO_URL
  return photoUrls[photoId]
}

/** Crée la page couverture — gabarit visuel par défaut (12 au choix, voir coverTemplates.ts),
 * repersonnalisable ensuite via `page.cover` (surcharges par élément). La carte du tracé sert de
 * visuel par défaut ; les photos éventuelles sont des cases libres `kind:'photo'` dans `boxes`. */
export function createCoverPage(): ComposedAlbumPage {
  return {
    id: uuid(),
    kind: 'cover',
    coverTemplate: DEFAULT_COVER_TEMPLATE,
    cover: { el: {} },
    boxes: decorSeedsToBoxes(coverTemplate(DEFAULT_COVER_TEMPLATE).decorSeeds),
  }
}

/** Luminance perçue (0 = noir, 1 = blanc) d'une couleur hex #rgb / #rrggbb. */
function hexLuma(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 1
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Convertit une couverture à l'ancien format (mise en page figée : grande photo + 2 petites,
 * champs plats `coverTitle`/`coverSubtitle`/`coverTag*`…) vers le nouveau modèle
 * `coverTemplate` + `cover`. Les pages déjà au nouveau format (ou d'un autre `kind`) sont
 * renvoyées telles quelles. Idempotente. */
export function migrateLegacyCover(page: ComposedAlbumPage): ComposedAlbumPage {
  if (page.kind !== 'cover') return page

  // Déjà au nouveau format : on répare seulement un fond hérité qui écrase l'apparence du
  // gabarit (les 12 gabarits ont un fond clair ; l'ancien `coverFrameColor` — un simple liseré
  // autour d'une carte blanche — n'a rien à faire en fond plein et rendait le texte illisible).
  if (page.coverTemplate) {
    if (page.cover?.bg && hexLuma(page.cover.bg) < 0.7) {
      const rest = { ...page.cover }
      delete rest.bg
      return { ...page, cover: rest }
    }
    return page
  }

  const title: CoverElOverride = {}
  if (page.coverTitle != null) title.text = page.coverTitle
  if (page.coverTitleScale != null) title.scale = page.coverTitleScale
  if (page.coverTitleX != null) title.x = page.coverTitleX
  if (page.coverTitleY != null) title.y = page.coverTitleY
  if (page.coverTitleRotate != null) title.rotate = page.coverTitleRotate

  const dates: CoverElOverride = {}
  if (page.coverSubtitle) dates.text = page.coverSubtitle
  if (page.coverTagX != null) dates.x = page.coverTagX
  if (page.coverTagY != null) dates.y = page.coverTagY
  if (page.coverTagRotate != null) dates.rotate = page.coverTagRotate
  if (page.coverTagFontScale != null) dates.scale = page.coverTagFontScale

  const el: NonNullable<CoverOverrides['el']> = {}
  if (Object.keys(title).length) el.title = title
  if (Object.keys(dates).length) el.dates = dates

  // Anciennes cases-photo fixes boxes[0..2] → cases-photo libres si renseignées.
  const legacyBoxes = page.boxes ?? []
  const photos: AlbumBox[] = []
  const main = legacyBoxes[0]
  if (main?.photoId) {
    photos.push({
      id: uuid(), kind: 'photo', x: 44, y: 10, w: 50, h: 66, rotation: 2, photoId: main.photoId,
      photoOffsetX: main.photoOffsetX, photoOffsetY: main.photoOffsetY, photoScale: main.photoScale,
    })
  }
  ;[legacyBoxes[1], legacyBoxes[2]].forEach((b, i) => {
    if (b?.photoId) photos.push({ id: uuid(), kind: 'photo', x: 6 + i * 22, y: 62, w: 28, h: 28, rotation: i ? 3 : -6, photoId: b.photoId })
  })
  // Cases-texte libres ajoutées par-dessus (boxes[3..]) : conservées telles quelles.
  const freeBoxes = legacyBoxes.slice(3).filter(b => b.kind === 'text')

  return {
    id: page.id,
    kind: 'cover',
    coverTemplate: 'scrapbook',
    // `coverFrameColor` (liseré autour d'une carte blanche) n'est PAS repris : le gabarit fournit
    // son propre fond clair. L'utilisateur peut le reteinter via « Fond ».
    cover: { el },
    boxes: [...photos, ...freeBoxes],
    header: page.header,
  }
}

/** URL du visuel principal de la couverture : la photo qui remplace la carte si l'utilisateur en
 * a choisi une (`cover.el.map.photoId`), sinon la carte proposée par défaut. */
export function resolveCoverMapUrl(page: ComposedAlbumPage, photoUrls: Record<string, string>): string | undefined {
  return resolveCoverPhotoUrl(page.cover?.el?.map?.photoId, photoUrls) ?? DEFAULT_COVER_PHOTO_URL
}

/** Crée la page de dos du livre — sur un gabarit de dos (fond + palette + décor + cases libres),
 * repersonnalisable comme la couverture via `page.cover` (voir BACK_COVER_TEMPLATES). Les dos
 * enregistrés avant l'introduction des gabarits n'ont pas de `coverTemplate` : les rendus les
 * traitent comme `DEFAULT_BACK_COVER_TEMPLATE` (dos uni), donc à l'identique. */
export function createBackCoverPage(): ComposedAlbumPage {
  return {
    id: uuid(),
    kind: 'backcover',
    coverTemplate: DEFAULT_BACK_COVER_TEMPLATE,
    cover: { el: {} },
    boxes: decorSeedsToBoxes(coverTemplate(DEFAULT_BACK_COVER_TEMPLATE).decorSeeds),
    header: false,
  }
}

/** Convertit une page à l'ancien format (gabarit figé + slots) en boxes libres. Les pages déjà
 * migrées sont retournées telles quelles. Les emplacements vides de l'ancien format sont ignorés
 * (l'utilisateur peut ajouter une nouvelle box libre s'il en veut une). */
export function migrateLegacyPage(page: ComposedAlbumPage | LegacyComposedAlbumPage): ComposedAlbumPage {
  if ('boxes' in page && Array.isArray(page.boxes)) return page as ComposedAlbumPage

  const legacy = page as LegacyComposedAlbumPage
  const preset = PRESET_BOXES[legacy.layout] ?? PRESET_BOXES.gallery4
  const photoRects = preset.filter(r => r.kind === 'photo')
  const textRect = preset.find(r => r.kind === 'text')
  const boxes: AlbumBox[] = []

  legacy.slots.forEach((slot, i) => {
    const rect = photoRects[i] ?? photoRects[photoRects.length - 1]
    if (!rect) return
    if (slot.text !== undefined) {
      boxes.push({ id: uuid(), kind: 'text', x: rect.x, y: rect.y, w: rect.w, h: rect.h, text: slot.text })
    } else if (slot.photoId) {
      boxes.push({ id: uuid(), kind: 'photo', x: rect.x, y: rect.y, w: rect.w, h: rect.h, photoId: slot.photoId, caption: slot.caption })
    }
  })

  if (textRect && legacy.text) {
    boxes.push({ id: uuid(), kind: 'text', x: textRect.x, y: textRect.y, w: textRect.w, h: textRect.h, text: legacy.text })
  }

  return { id: legacy.id, boxes, header: legacy.header }
}

/** Nettoie les pages d'un tracé : migre l'ancien format, et neutralise les pages de type "cover"/
 * "backcover" qui n'ont rien à faire dans les pages d'un tracé — ce sont des pages de voyage
 * (couverture/dos du livre, gérées à part par VoyageCoverEditor) qui ont pu s'y retrouver via
 * d'anciennes versions de l'appli. Une page ainsi égarée sans aucun contenu est retirée (elle ne
 * s'affichait de toute façon que comme une page blanche, en perturbant l'ordre) ; si elle contient
 * malgré tout des boxes, on la garde comme page libre normale plutôt que de perdre son contenu. */
export function sanitizeTrackPages(pages: (ComposedAlbumPage | LegacyComposedAlbumPage)[]): ComposedAlbumPage[] {
  return pages
    .map(migrateLegacyPage)
    .filter(p => !((p.kind === 'cover' || p.kind === 'backcover') && p.boxes.length === 0))
    .map(p => (p.kind === 'cover' || p.kind === 'backcover') ? { ...p, kind: undefined } : p)
}

export interface ResolvedBox extends AlbumBox {
  url?: string             // kind === 'photo' : URL résolue depuis photoId
  photoCaption?: string     // légende IA de la photo, si affichée
}

/** Résout les boxes d'une page composée en éléments affichables (URL de photo, légende). */
export function resolvePageBoxes(
  page: ComposedAlbumPage,
  photos: VoyagePhoto[],
  photoUrls: Record<string, string>,
): ResolvedBox[] {
  return page.boxes.map(box => {
    if (box.kind === 'photo' && box.photoId) {
      const photo = photos.find(p => p.id === box.photoId)
      const url = photo ? photoUrls[photo.id] : undefined
      return { ...box, url, photoCaption: photo && box.caption !== false ? photo.aiCaption : undefined }
    }
    return { ...box }
  })
}
