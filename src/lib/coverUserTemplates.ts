import type { AlbumBox, ComposedAlbumPage, CoverElKey, CoverElOverride, CoverOverrides, CoverTemplateId } from '../types'
import { uuid } from './uuid'

/** Gabarit de couverture enregistré par l'utilisateur : un instantané de mise en page
 * (surcharges `cover` + cases `boxes`) posé sur un gabarit intégré de base. Stocké dans
 * localStorage, commun à tous les voyages, listé à côté des gabarits intégrés dans le sélecteur.
 * Ne contient AUCUNE photo ni texte de contenu — uniquement positions, tailles, rotations,
 * couleurs, polices, décors. */
export interface UserCoverTemplate {
  id: string                 // USER_TEMPLATE_PREFIX + uuid — jamais en collision avec un id intégré
  label: string
  base: CoverTemplateId      // gabarit intégré : polices / couleurs / thème / décor fixe / board
  cover: CoverOverrides      // surcharges de mise en page (sans texte de contenu)
  boxes: AlbumBox[]          // cases décor / photo (vidées) / texte
  createdAt: string          // ISO
  image?: string             // « gabarit importé » : data URL d'une image occupant toute la
                             // couverture (le décor et la carte du gabarit ne sont pas rendus)
  auto?: boolean             // snapshot posé automatiquement AVANT un import de gabarit (filet de
                             // sécurité) — le sélecteur les distingue et n'en garde qu'une poignée
}

const KEY = 'sillon-cover-templates'
export const USER_TEMPLATE_PREFIX = 'u:'
export const isUserTemplateId = (id: string | undefined): boolean =>
  !!id && id.startsWith(USER_TEMPLATE_PREFIX)

export function loadUserCoverTemplates(): UserCoverTemplate[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((t): t is UserCoverTemplate =>
      !!t && typeof t.id === 'string' && typeof t.base === 'string' && typeof t.label === 'string')
  } catch {
    return []
  }
}

function persist(list: UserCoverTemplate[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* quota dépassé / navigation privée : on n'échoue pas l'édition pour autant */
  }
}

const EL_KEYS: CoverElKey[] = ['eyebrow', 'title', 'dates', 'body', 'map']

/** Retire d'une couverture les éléments « de contenu » (textes saisis, photos) pour n'en garder
 * que la mise en page — c'est ça qu'on enregistre comme gabarit. */
function stripContent(cover: CoverOverrides | undefined, boxes: AlbumBox[]): { cover: CoverOverrides; boxes: AlbumBox[] } {
  const el: NonNullable<CoverOverrides['el']> = {}
  const src = cover?.el ?? {}
  for (const k of Object.keys(src) as CoverElKey[]) {
    const rest: CoverElOverride = { ...(src[k] ?? {}) }
    delete rest.text
    delete rest.photoId
    if (Object.keys(rest).length) el[k] = rest
  }
  const cleanCover: CoverOverrides = { ...(cover ?? {}), el }
  delete cleanCover.tplRef
  delete cleanCover.bgImage   // image de fond propre à un voyage — pas figée dans un gabarit
  const cleanBoxes = boxes
    // Décor-image : porte une photo du voyage → non transposable dans un gabarit.
    .filter(b => !(b.kind === 'decor' && b.photoId))
    .map(b => {
      const c: AlbumBox = { ...b }
      if (c.kind === 'photo') {
        // photoId + cadrage propres à une photo donnée : on ne les fige pas dans un gabarit.
        delete c.photoId
        delete c.photoOffsetX
        delete c.photoOffsetY
        delete c.photoScale
      }
      return c
    })
  return { cover: cleanCover, boxes: cleanBoxes }
}

/** Crée un gabarit utilisateur à partir de l'état courant d'une couverture et le persiste. */
export function createUserCoverTemplate(
  label: string, base: CoverTemplateId, cover: CoverOverrides | undefined, boxes: AlbumBox[],
): UserCoverTemplate {
  const clean = stripContent(cover, boxes)
  const tpl: UserCoverTemplate = {
    id: USER_TEMPLATE_PREFIX + uuid(),
    label: label.trim() || 'Mon gabarit',
    base,
    cover: clean.cover,
    boxes: clean.boxes,
    createdAt: new Date().toISOString(),
  }
  persist([...loadUserCoverTemplates(), tpl])
  return tpl
}

/** Crée un « gabarit importé » : une image (data URL) qui occupera toute la couverture.
 * `base` fournit les polices / couleurs pour le titre et les dates qu'on pose par-dessus. */
export function createImportedCoverTemplate(label: string, base: CoverTemplateId, image: string): UserCoverTemplate {
  const tpl: UserCoverTemplate = {
    id: USER_TEMPLATE_PREFIX + uuid(),
    label: label.trim() || 'Gabarit importé',
    base,
    cover: { el: {} },
    boxes: [],
    image,
    createdAt: new Date().toISOString(),
  }
  persist([...loadUserCoverTemplates(), tpl])
  return tpl
}

/** Nombre de snapshots « auto » (avant import) conservés — au-delà, on jette les plus vieux. */
const AUTO_SNAPSHOT_KEEP = 3

/** Vrai si la mise en page nettoyée mérite d'être sauvegardée (sinon un snapshot serait vide). */
function worthSnapshotting(clean: { cover: CoverOverrides; boxes: AlbumBox[] }): boolean {
  if (clean.boxes.length > 0) return true
  const c = clean.cover
  return Object.keys(c.el ?? {}).length > 0
    || !!c.palette || !!c.bg || !!c.decorColor || !!c.decorHidden || !!c.bgImage
}

/** Pose un snapshot « auto » de la couverture courante AVANT un import de gabarit (qui, sinon,
 * écraserait la composition sans retour possible après fermeture de l'éditeur). Comme
 * `createUserCoverTemplate`, ne fige que la mise en page (ni photos ni textes de contenu). Ne
 * garde que les `AUTO_SNAPSHOT_KEEP` snapshots auto les plus récents. Renvoie la liste à jour ;
 * `null` en 2ᵉ position si rien ne valait la peine d'être gardé. */
export function snapshotCompositionBeforeImport(
  base: CoverTemplateId, cover: CoverOverrides | undefined, boxes: AlbumBox[],
): { list: UserCoverTemplate[]; snapshot: UserCoverTemplate | null } {
  const clean = stripContent(cover, boxes)
  const existing = loadUserCoverTemplates()
  if (!worthSnapshotting(clean)) return { list: existing, snapshot: null }
  const now = new Date()
  const stamp = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    + ' ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const tpl: UserCoverTemplate = {
    id: USER_TEMPLATE_PREFIX + uuid(),
    label: `Compo avant import — ${stamp}`,
    base,
    cover: clean.cover,
    boxes: clean.boxes,
    createdAt: now.toISOString(),
    auto: true,
  }
  const manual = existing.filter(t => !t.auto)
  const keptAutos = existing
    .filter(t => t.auto)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, AUTO_SNAPSHOT_KEEP - 1)
  const list = [...manual, tpl, ...keptAutos]
  persist(list)
  return { list, snapshot: tpl }
}

export function deleteUserCoverTemplate(id: string): UserCoverTemplate[] {
  const list = loadUserCoverTemplates().filter(t => t.id !== id)
  persist(list)
  return list
}

/** Applique un gabarit utilisateur à une couverture : reprend sa mise en page (surcharges + cases)
 * en conservant le contenu déjà saisi — textes du titre / dates / texte, photo de la carte, et les
 * photos déjà placées (réaffectées dans l'ordre aux cases-photo du gabarit). */
export function applyUserCoverTemplate(page: ComposedAlbumPage, tpl: UserCoverTemplate): ComposedAlbumPage {
  const curEl = page.cover?.el ?? {}
  const el: NonNullable<CoverOverrides['el']> = {}
  for (const k of EL_KEYS) {
    const merged: CoverElOverride = { ...(tpl.cover.el?.[k] ?? {}) }
    const cur = curEl[k]
    if (cur?.text != null) merged.text = cur.text
    if (k === 'map' && cur?.photoId) merged.photoId = cur.photoId
    if (k === 'map' && cur?.fit != null && merged.fit == null) merged.fit = cur.fit
    if (Object.keys(merged).length) el[k] = merged
  }
  // Photos déjà placées → réaffectées dans l'ordre aux cases-photo du gabarit.
  const placed = page.boxes.filter(b => b.kind === 'photo' && b.photoId).map(b => b.photoId as string)
  let pi = 0
  const boxes = tpl.boxes.map(b => {
    const c: AlbumBox = { ...b, id: uuid() }
    if (c.kind === 'photo' && pi < placed.length) c.photoId = placed[pi++]
    return c
  })
  const cover: CoverOverrides = { ...tpl.cover, el, tplRef: tpl.id }
  if (tpl.image) cover.bgImage = tpl.image              // gabarit importé : l'image occupe la couverture
  // Un snapshot « auto » sert à revenir AVANT un import : on ne rembarque pas l'image importée.
  else if (!tpl.auto && page.cover?.bgImage) cover.bgImage = page.cover.bgImage
  return { ...page, coverTemplate: tpl.base, cover, boxes }
}
