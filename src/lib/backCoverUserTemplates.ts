import type { AlbumBox, CoverElKey, CoverElOverride, CoverOverrides, CoverTemplateId } from '../types'
// CoverElKey : utilisé pour typer les clés de `cover.el` dans stripContent.
import { uuid } from './uuid'
import {
  USER_TEMPLATE_PREFIX, isUserTemplateId, applyUserCoverTemplate, type UserCoverTemplate,
} from './coverUserTemplates'

/** Bibliothèque de gabarits de DOS enregistrés par l'utilisateur — même forme et même logique que
 * `coverUserTemplates`, mais rangée SÉPARÉMENT (autre clé localStorage) : un gabarit enregistré
 * depuis la couverture n'apparaît pas côté dos, et inversement. Le préfixe d'id `u:` est commun
 * (les deux jeux ne se croisent jamais, chacun a sa propre liste). */
export type { UserCoverTemplate }
export { USER_TEMPLATE_PREFIX, isUserTemplateId }
/** Applique un gabarit de dos à la page — logique identique à la couverture. */
export const applyUserBackCoverTemplate = applyUserCoverTemplate

const KEY = 'sillon-backcover-templates'

export function loadUserBackCoverTemplates(): UserCoverTemplate[] {
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

/** Retire d'un dos les éléments « de contenu » (photos, textes des cases) pour n'en garder que la
 * mise en page — c'est ça qu'on enregistre comme gabarit. */
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
  delete cleanCover.bgImage
  const cleanBoxes = boxes
    .filter(b => !(b.kind === 'decor' && b.photoId))
    .map(b => {
      const c: AlbumBox = { ...b }
      if (c.kind === 'photo') {
        delete c.photoId
        delete c.photoOffsetX
        delete c.photoOffsetY
        delete c.photoScale
      }
      return c
    })
  return { cover: cleanCover, boxes: cleanBoxes }
}

/** Crée un gabarit de dos utilisateur à partir de l'état courant et le persiste. */
export function createUserBackCoverTemplate(
  label: string, base: CoverTemplateId, cover: CoverOverrides | undefined, boxes: AlbumBox[],
): UserCoverTemplate {
  const clean = stripContent(cover, boxes)
  const tpl: UserCoverTemplate = {
    id: USER_TEMPLATE_PREFIX + uuid(),
    label: label.trim() || 'Mon gabarit de dos',
    base,
    cover: clean.cover,
    boxes: clean.boxes,
    createdAt: new Date().toISOString(),
  }
  persist([...loadUserBackCoverTemplates(), tpl])
  return tpl
}

/** Crée un « gabarit de dos importé » : une image (data URL) qui occupera tout le dos. */
export function createImportedBackCoverTemplate(label: string, base: CoverTemplateId, image: string): UserCoverTemplate {
  const tpl: UserCoverTemplate = {
    id: USER_TEMPLATE_PREFIX + uuid(),
    label: label.trim() || 'Gabarit importé',
    base,
    cover: { el: {} },
    boxes: [],
    image,
    createdAt: new Date().toISOString(),
  }
  persist([...loadUserBackCoverTemplates(), tpl])
  return tpl
}

const AUTO_SNAPSHOT_KEEP = 3

function worthSnapshotting(clean: { cover: CoverOverrides; boxes: AlbumBox[] }): boolean {
  if (clean.boxes.length > 0) return true
  const c = clean.cover
  return Object.keys(c.el ?? {}).length > 0
    || !!c.palette || !!c.bg || !!c.decorColor || !!c.decorHidden || !!c.bgImage
}

/** Pose un snapshot « auto » du dos courant AVANT un import de gabarit. */
export function snapshotBackCompositionBeforeImport(
  base: CoverTemplateId, cover: CoverOverrides | undefined, boxes: AlbumBox[],
): { list: UserCoverTemplate[]; snapshot: UserCoverTemplate | null } {
  const clean = stripContent(cover, boxes)
  const existing = loadUserBackCoverTemplates()
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

export function deleteUserBackCoverTemplate(id: string): UserCoverTemplate[] {
  const list = loadUserBackCoverTemplates().filter(t => t.id !== id)
  persist(list)
  return list
}
