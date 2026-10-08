import { useEffect, useRef, useState } from 'react'
import type { VoyagePhoto, ComposedAlbumPage, AlbumBox, CoverElKey, CoverElOverride, CoverTemplateId } from '../types'
import {
  createCoverPage, createBackCoverPage, decorSeedsToBoxes, boxZIndex,
  resolveCoverMapUrl, DEFAULT_COVER_PHOTO_ID, DEFAULT_COVER_PHOTO_URL,
} from '../lib/albumPages'
import {
  COVER_TEMPLATE_PICKER, BACK_COVER_TEMPLATE_PICKER, COVER_PALETTES,
  coverTemplate, coverTheme, themeColor, DEFAULT_COVER_TEMPLATE, DEFAULT_BACK_COVER_TEMPLATE,
} from '../lib/coverTemplates'
import {
  loadUserCoverTemplates, createUserCoverTemplate, createImportedCoverTemplate,
  deleteUserCoverTemplate, applyUserCoverTemplate, isUserTemplateId,
  snapshotCompositionBeforeImport, type UserCoverTemplate,
} from '../lib/coverUserTemplates'
import {
  loadUserBackCoverTemplates, createUserBackCoverTemplate, createImportedBackCoverTemplate,
  deleteUserBackCoverTemplate, applyUserBackCoverTemplate, snapshotBackCompositionBeforeImport,
} from '../lib/backCoverUserTemplates'
import { DECOR_RATIO } from './CoverDecor'
import { addPhotoToVoyage } from '../lib/voyageDB'
import { TEXT_FONTS, TEXT_ALIGNS } from '../lib/textStyles'
import { AlbumCoverContent } from './AlbumCover'
import { wrapCoverBoxCm } from '../lib/wrapCover'
import { uuid } from '../lib/uuid'
import { useBlockPageZoom } from '../hooks/useBlockPageZoom'

interface Props {
  voyageId: string
  voyageName: string
  photos: VoyagePhoto[]
  photoUrls: Record<string, string>
  initialCoverPage?: ComposedAlbumPage
  initialBackCoverPage?: ComposedAlbumPage
  /** Côté ouvert d'emblée — la couverture et le dos se composent séparément depuis deux boutons
   * distincts. Si ce côté n'existe pas encore, il est créé automatiquement. */
  initialSide?: 'cover' | 'backcover'
  /** Profil « feuille de couverture d'un seul tenant » (WhiteWall) : couverture et dos se composent
   * sur un unique plan `sheetCm` — 4e de couverture à gauche, tranche `spineCm` au centre, 1re de
   * couverture à droite, fond perdu `bleedCm` sur les 4 bords. Absent = édition en deux plans. */
  wrapSpread?: { sheetCm: { w: number; h: number }; spineCm: number; bleedCm: number }
  /** Format de la page composée (cm), pour que chaque moitié de la feuille wrap garde cette
   * proportion. Utile seulement avec `wrapSpread`. */
  pageCm?: { w: number; h: number }
  onSave: (coverPage: ComposedAlbumPage | undefined, backCoverPage: ComposedAlbumPage | undefined) => void
  onPhotosAdded: (photos: VoyagePhoto[], urls: Record<string, string>) => void
  /** Photos chargées ici (bouton dédié) mais jamais placées sur la couverture ou le dos —
   * proposées à la suppression en quittant, pour ne pas alourdir les sauvegardes. */
  onDeleteUnusedPhotos?: (photoIds: string[]) => void | Promise<void>
  onBack: () => void
}

const MIN_BOX_SIZE = 8 // % — taille minimale d'une box en largeur/hauteur

/** Décors ajoutables sur la couverture — liste générique, extensible (tout motif de CoverDecor). */
const ADDABLE_DECOR: { type: string; label: string }[] = [
  { type: 'gridpaper', label: 'Scotch' },
  { type: 'washi', label: 'Ruban' },
  { type: 'stamp', label: 'Tampon' },
  { type: 'tag', label: 'Étiquette' },
  { type: 'arrowN', label: 'Flèche' },
  { type: 'framerect', label: 'Cadre' },
  { type: 'circle', label: 'Cercle' },
  { type: 'heart', label: 'Cœur' },
  { type: 'dots', label: 'Points' },
  { type: 'compass', label: 'Boussole' },
  { type: 'ridge', label: 'Crête' },
  { type: 'topolines', label: 'Courbes' },
]


function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** Position du pointeur, qu'il s'agisse d'un événement souris ou tactile. */
function getPoint(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e) {
    const t = e.touches[0] ?? e.changedTouches[0]
    return { x: t.clientX, y: t.clientY }
  }
  return { x: e.clientX, y: e.clientY }
}

interface DragState {
  mode: 'move' | 'resize' | 'rotate'
  boxId: string
  startClientX: number
  startClientY: number
  startBox: AlbumBox
  canvasW: number
  canvasH: number
}

/** Instantané couverture + dos empilé dans l'historique d'annulation. */
type CoverSnapshot = { cover: ComposedAlbumPage | null; back: ComposedAlbumPage | null }
const UNDO_LIMIT = 50

/** Éditeur de la couverture et du dos du livre — communs à tout le voyage (dossier), pas à un
 * tracé en particulier : un livre imprimé n'a qu'une seule couverture pour toutes ses étapes. */
export function VoyageCoverEditor({
  voyageId, voyageName, photos, photoUrls, initialCoverPage, initialBackCoverPage, initialSide, wrapSpread, pageCm, onSave, onPhotosAdded, onDeleteUnusedPhotos, onBack,
}: Props) {
  useBlockPageZoom()
  const [coverPage, setCoverPage] = useState<ComposedAlbumPage | null>(initialCoverPage ?? null)
  const [backCoverPage, setBackCoverPage] = useState<ComposedAlbumPage | null>(initialBackCoverPage ?? null)
  const [activeSide, setActiveSide] = useState<'cover' | 'backcover'>(
    initialSide ?? (initialCoverPage ? 'cover' : initialBackCoverPage ? 'backcover' : 'cover')
  )
  // Ouverture directe sur un côté : s'il n'est pas encore composé, on le crée pour éviter à
  // l'utilisateur un détour par « + Couverture » / « + Dos ». En mode feuille d'un seul tenant
  // (WhiteWall), les deux côtés sont obligatoires — on les crée d'un coup s'ils manquent.
  useEffect(() => {
    if (wrapSpread) {
      const c = coverPage ?? createCoverPage()
      const b = backCoverPage ?? createBackCoverPage()
      if (c !== coverPage || b !== backCoverPage) commit(c, b)
      return
    }
    if (initialSide === 'cover' && !initialCoverPage) handleAddCover()
    else if (initialSide === 'backcover' && !initialBackCoverPage) handleAddBackCover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [pickedPhotoId, setPickedPhotoId] = useState<string | null>(null)
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)
  // Panneau de gauche « compartimenté » (couverture) : une seule section ouverte à la fois.
  // Cliquer un élément de l'aperçu ouvre la section correspondante (voir onElSelect / beginCoverElDrag).
  const [openSection, setOpenSection] = useState<string | null>('title')
  // Gabarits enregistrés par l'utilisateur (localStorage, communs à tous les voyages).
  const [userTemplates, setUserTemplates] = useState<UserCoverTemplate[]>(() => loadUserCoverTemplates())
  const [savingTplName, setSavingTplName] = useState<string | null>(null)  // null = pas en cours d'enregistrement
  // Idem pour le DOS — bibliothèque distincte (voir lib/backCoverUserTemplates.ts).
  const [userBackTemplates, setUserBackTemplates] = useState<UserCoverTemplate[]>(() => loadUserBackCoverTemplates())
  const [savingBackTplName, setSavingBackTplName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // Photos chargées via le bouton dédié à la couverture/dos — le panneau de gauche démarre VIDE :
  // on ne charge que ce qu'on veut placer. Les photos déjà placées dans une composition existante
  // restent affichées sur le canevas (résolues depuis `photos`), elles n'ont pas besoin d'être
  // dans cette liste.
  const [coverUploadPhotos, setCoverUploadPhotos] = useState<VoyagePhoto[]>([])
  const coverInnerRef = useRef<HTMLDivElement>(null)
  const coverBoxLayerRef = useRef<HTMLDivElement>(null)  // couche des cases-texte libres de la couverture
  const backInnerRef = useRef<HTMLDivElement>(null)
  const backBoxLayerRef = useRef<HTMLDivElement>(null)   // idem, côté dos (rendu via AlbumCoverContent)
  const dragRef = useRef<DragState | null>(null)
  const boxTextTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const photoInputRef = useRef<HTMLInputElement>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)
  const backBgInputRef = useRef<HTMLInputElement>(null)
  const mainPhotoInputRef = useRef<HTMLInputElement>(null)
  const imageDecorInputRef = useRef<HTMLInputElement>(null)
  const backImageDecorInputRef = useRef<HTMLInputElement>(null)
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave })

  // Historique d'annulation : chaque `commit` empile l'état précédent (couverture + dos). Les
  // saisies de texte (différées) ne créent pas d'entrée — l'annulation restaure la dernière
  // structure connue. Purement en mémoire : perdu en quittant l'éditeur.
  const coverRef = useRef(coverPage)
  const backRef = useRef(backCoverPage)
  useEffect(() => { coverRef.current = coverPage; backRef.current = backCoverPage })
  const undoStack = useRef<CoverSnapshot[]>([])
  const [canUndo, setCanUndo] = useState(false)

  function handleUndo() {
    const prev = undoStack.current.pop()
    if (!prev) return
    setCanUndo(undoStack.current.length > 0)
    Object.values(boxTextTimers.current).forEach(clearTimeout)
    boxTextTimers.current = {}
    setSelectedBoxId(null)
    setCoverPage(prev.cover)
    setBackCoverPage(prev.back)
    onSaveRef.current(prev.cover ?? undefined, prev.back ?? undefined)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (undoStack.current.length === 0) return
      e.preventDefault()
      handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)

  }, [])

  /** Sélectionner une case libre (photo / texte / décor) et ouvrir sa boîte à outils dans le
   * panneau compartimenté de la couverture. */
  function selectBox(id: string | null) {
    setSelectedBoxId(id)
    if (id) setOpenSection('selection')
  }

  const activePage = activeSide === 'cover' ? coverPage : backCoverPage
  // Case-texte sélectionnée (couverture OU dos), pour en régler police/taille/fond/alignement/couleur.
  const selectedBox = selectedBoxId
    ? (coverPage?.boxes.find(b => b.id === selectedBoxId)
      ?? backCoverPage?.boxes.find(b => b.id === selectedBoxId)
      ?? null)
    : null

  /** De quel plan (couverture / dos) provient une case libre, par son id. */
  function sideOfBox(boxId: string): 'cover' | 'backcover' | null {
    if (coverPage?.boxes.some(b => b.id === boxId)) return 'cover'
    if (backCoverPage?.boxes.some(b => b.id === boxId)) return 'backcover'
    return null
  }

  function handleBoxStyleChange(boxId: string, patch: Partial<AlbumBox>) {
    const side = sideOfBox(boxId)
    if (side === 'cover' && coverPage) {
      commit({ ...coverPage, boxes: coverPage.boxes.map(b => b.id === boxId ? { ...b, ...patch } : b) }, backCoverPage)
    } else if (side === 'backcover' && backCoverPage) {
      commit(coverPage, { ...backCoverPage, boxes: backCoverPage.boxes.map(b => b.id === boxId ? { ...b, ...patch } : b) })
    }
  }

  function commit(cover: ComposedAlbumPage | null, back: ComposedAlbumPage | null) {
    // On empile l'état précédent pour l'annulation — sauf l'état initial vide (montage).
    if (coverRef.current || backRef.current) {
      undoStack.current.push({ cover: coverRef.current, back: backRef.current })
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
      setCanUndo(true)
    }
    setCoverPage(cover)
    setBackCoverPage(back)
    onSave(cover ?? undefined, back ?? undefined)
  }

  function handleAddCover() {
    const page = createCoverPage()
    commit(page, backCoverPage)
    setActiveSide('cover')
  }

  function handleAddBackCover() {
    const page = createBackCoverPage()
    commit(coverPage, page)
    setActiveSide('backcover')
  }

  function handleRemoveActive() {
    if (activeSide === 'cover') commit(null, backCoverPage)
    else commit(coverPage, null)
  }

  function handlePickBox(boxId: string) {
    if (!pickedPhotoId || !activePage) return
    const next = { ...activePage, boxes: activePage.boxes.map(b => b.id === boxId ? { ...b, photoId: pickedPhotoId } : b) }
    commit(activeSide === 'cover' ? next : coverPage, activeSide === 'backcover' ? next : backCoverPage)
    setPickedPhotoId(null)
  }

  function handleClearBox(boxId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const side = sideOfBox(boxId)
    if (side === 'cover' && coverPage) commit({ ...coverPage, boxes: coverPage.boxes.filter(b => b.id !== boxId) }, backCoverPage)
    else if (side === 'backcover' && backCoverPage) commit(coverPage, { ...backCoverPage, boxes: backCoverPage.boxes.filter(b => b.id !== boxId) })
    if (selectedBoxId === boxId) setSelectedBoxId(null)
  }

  function handleBoxTextChange(boxId: string, value: string) {
    // Cible le plan (couverture ou dos) qui contient la case, indépendamment de `activeSide`.
    const patch = (p: ComposedAlbumPage | null) =>
      p && p.boxes.some(b => b.id === boxId) ? { ...p, boxes: p.boxes.map(b => b.id === boxId ? { ...b, text: value } : b) } : p
    setCoverPage(patch)
    setBackCoverPage(patch)
    clearTimeout(boxTextTimers.current[boxId])
    boxTextTimers.current[boxId] = setTimeout(() => {
      setCoverPage(cover => { setBackCoverPage(back => { onSaveRef.current(cover ?? undefined, back ?? undefined); return back }); return cover })
    }, 600)
  }

  /** Photos chargées spécifiquement pour la couverture/dos — pas de proposition automatique,
   * l'utilisateur choisit lui-même ce qu'il veut y mettre. */
  async function handlePhotoFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    try {
      const added: VoyagePhoto[] = []
      const urls: Record<string, string> = {}
      for (const file of files) {
        const photo = await addPhotoToVoyage(voyageId, { name: file.name }, file)
        added.push(photo)
        urls[photo.id] = URL.createObjectURL(file)
      }
      setCoverUploadPhotos(prev => [...prev, ...added])
      onPhotosAdded(added, urls)
    } finally {
      setUploading(false)
    }
  }

  /** Réduit une image pour l'embarquer en data URL dans un gabarit (localStorage). */
  async function fileToDownscaledDataUrl(file: File, max = 1400, quality = 0.8): Promise<string> {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('image illisible'))
      i.src = URL.createObjectURL(file)
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(img.src)
    return c.toDataURL('image/jpeg', quality)
  }

  /** Ajoute / remplace la photo principale (carte du tracé) par une image importée. */
  async function handleMainPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = Array.from(e.target.files ?? []).find(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file || !coverPage) return
    setUploading(true)
    try {
      const photo = await addPhotoToVoyage(voyageId, { name: file.name }, file)
      onPhotosAdded([photo], { [photo.id]: URL.createObjectURL(file) })
      setCoverUploadPhotos(prev => [...prev, photo])
      commit(patchCoverEl('map', { photoId: photo.id }) ?? coverPage, backCoverPage)
    } finally {
      setUploading(false)
    }
  }

  /** « Importer un gabarit » : une image devient un gabarit de plus dans le sélecteur (data URL
   * en localStorage). Elle occupe toute la couverture ; on l'applique aussitôt. Le gabarit
   * précédent reste proposé et re-sélectionnable. */
  async function handleImportGabarit(e: React.ChangeEvent<HTMLInputElement>) {
    const file = Array.from(e.target.files ?? []).find(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file || !coverPage) return
    setUploading(true)
    try {
      const image = await fileToDownscaledDataUrl(file)
      const base = isUserTemplateId(coverPage.coverTemplate)
        ? (userTemplates.find(u => u.id === coverPage.coverTemplate)?.base ?? DEFAULT_COVER_TEMPLATE)
        : ((coverPage.coverTemplate as CoverTemplateId | undefined) ?? DEFAULT_COVER_TEMPLATE)
      // Filet de sécurité : on fige la mise en page courante comme gabarit « auto » avant de
      // l'écraser — re-sélectionnable dans le sélecteur même après avoir quitté l'éditeur.
      snapshotCompositionBeforeImport(base, coverPage.cover, coverPage.boxes)
      const tpl = createImportedCoverTemplate('Gabarit importé', base, image)
      setUserTemplates(loadUserCoverTemplates())
      commit(applyUserCoverTemplate(coverPage, tpl), backCoverPage)
    } finally {
      setUploading(false)
    }
  }

  // Photos chargées ici mais jamais placées (couverture ou dos) : proposées à la suppression en
  // quittant, pour ne pas alourdir les sauvegardes (même comportement que l'éditeur de pages).
  async function handleBack() {
    const usedIds = new Set(
      [
        ...(coverPage?.boxes ?? []).map(b => b.photoId),
        ...(backCoverPage?.boxes ?? []).map(b => b.photoId),
        coverPage?.cover?.bgImage, coverPage?.cover?.el?.map?.photoId,
      ].filter((id): id is string => !!id)
    )
    const unused = coverUploadPhotos.filter(p => !usedIds.has(p.id))
    if (unused.length > 0 && onDeleteUnusedPhotos) {
      const label = unused.length > 1 ? `${unused.length} photos chargées non utilisées` : '1 photo chargée non utilisée'
      if (confirm(`${label} sur la couverture / le dos. Les supprimer du voyage ?`)) {
        await onDeleteUnusedPhotos(unused.map(p => p.id))
      }
    }
    onBack()
  }

  /** Retire une photo de la liste « à placer ». Si elle n'est utilisée nulle part (aucune case,
   * ni fond, ni photo principale), on la supprime aussi du voyage. */
  function handleRemoveUploadPhoto(id: string) {
    setCoverUploadPhotos(prev => prev.filter(p => p.id !== id))
    if (pickedPhotoId === id) setPickedPhotoId(null)
    const used = [...(coverPage?.boxes ?? []), ...(backCoverPage?.boxes ?? [])].some(b => b.photoId === id)
      || coverPage?.cover?.bgImage === id
      || coverPage?.cover?.el?.map?.photoId === id
    if (!used && onDeleteUnusedPhotos) void onDeleteUnusedPhotos([id])
  }

  /** Ajoute une case-photo libre — sur le dos, ou sur la couverture (aux emplacements suggérés
   * par le gabarit choisi, en rotation). */
  function handleAddPhotoBox() {
    if (activeSide === 'cover') {
      if (!coverPage) return
      const slots = coverTemplate(coverPage.coverTemplate).photoSlots
      const nPlaced = coverPage.boxes.filter(b => b.kind === 'photo').length
      const s = slots[nPlaced % Math.max(slots.length, 1)] ?? { x: 30, y: 55, w: 32, h: 30, rotate: 0 }
      const id = uuid()
      // Si une photo est déjà choisie dans la liste, la nouvelle case la reçoit directement.
      const photoId = pickedPhotoId && pickedPhotoId !== DEFAULT_COVER_PHOTO_ID ? pickedPhotoId : undefined
      const box: AlbumBox = { id, kind: 'photo', x: s.x, y: s.y, w: s.w, h: s.h ?? 30, rotation: s.rotate, photoId }
      commit({ ...coverPage, boxes: [...coverPage.boxes, box] }, backCoverPage)
      if (photoId) setPickedPhotoId(null)
      selectBox(id)
      return
    }
    if (!backCoverPage) return
    const slots = coverTemplate(backCoverPage.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE).photoSlots
    const nPlaced = backCoverPage.boxes.filter(b => b.kind === 'photo').length
    const s = slots[nPlaced % Math.max(slots.length, 1)] ?? { x: 30, y: 33, w: 40, h: 40, rotate: 0 }
    const id = uuid()
    const photoId = pickedPhotoId && pickedPhotoId !== DEFAULT_COVER_PHOTO_ID ? pickedPhotoId : undefined
    const box: AlbumBox = { id, kind: 'photo', x: s.x, y: s.y, w: s.w, h: s.h ?? 40, rotation: s.rotate, photoId }
    commit(coverPage, { ...backCoverPage, boxes: [...backCoverPage.boxes, box] })
    if (photoId) setPickedPhotoId(null)
    selectBox(id)
  }

  /** Ajoute une case-texte libre sur le plan actif (couverture ou dos) — indépendante du bloc
   * « Texte » du gabarit, pour une annotation supplémentaire. */
  function handleAddTextBox() {
    const id = uuid()
    const newBox = { id, kind: 'text' as const, x: 20, y: 40, w: 55, h: 18, text: '' }
    if (activeSide === 'cover') {
      if (!coverPage) return
      commit({ ...coverPage, boxes: [...coverPage.boxes, newBox] }, backCoverPage)
    } else {
      if (!backCoverPage) return
      commit(coverPage, { ...backCoverPage, boxes: [...backCoverPage.boxes, newBox] })
    }
    selectBox(id)
  }

  // ── Cases libres : calques, duplication, visibilité, ajout de décors ──────

  /** Applique une transformation à la liste `boxes` du plan qui contient `boxId`. */
  function mutateBoxes(boxId: string, fn: (boxes: AlbumBox[]) => AlbumBox[]) {
    const side = sideOfBox(boxId)
    if (side === 'cover' && coverPage) commit({ ...coverPage, boxes: fn(coverPage.boxes) }, backCoverPage)
    else if (side === 'backcover' && backCoverPage) commit(coverPage, { ...backCoverPage, boxes: fn(backCoverPage.boxes) })
  }

  /** Ordre de calque : devant / derrière / avancer / reculer d'un cran. */
  function handleBoxLayer(boxId: string, op: 'front' | 'back' | 'forward' | 'backward') {
    mutateBoxes(boxId, boxes => {
      const zs = boxes.map(boxZIndex)
      const maxZ = zs.length ? Math.max(...zs) : 0
      const minZ = zs.length ? Math.min(...zs) : 0
      const cur = boxes.find(b => b.id === boxId)
      if (!cur) return boxes
      const curZ = boxZIndex(cur)
      let next = curZ
      if (op === 'front') next = maxZ + 1
      else if (op === 'back') next = minZ - 1
      else {
        // Voisin le plus proche au-dessus / en-dessous, puis on se place juste à côté.
        const others = boxes.filter(b => b.id !== boxId).map(boxZIndex)
        if (op === 'forward') {
          const above = others.filter(z => z > curZ).sort((a, b) => a - b)[0]
          next = above == null ? maxZ + 1 : above + 1
        } else {
          const below = others.filter(z => z < curZ).sort((a, b) => b - a)[0]
          next = below == null ? minZ - 1 : below - 1
        }
      }
      return boxes.map(b => b.id === boxId ? { ...b, zIndex: next } : b)
    })
  }

  function handleDuplicateBox(boxId: string) {
    const nid = uuid()
    mutateBoxes(boxId, boxes => {
      const src = boxes.find(b => b.id === boxId)
      if (!src) return boxes
      return [...boxes, { ...src, id: nid, x: src.x + 3, y: src.y + 3, zIndex: (src.zIndex ?? boxZIndex(src)) + 1 }]
    })
    selectBox(nid)
  }

  function handleToggleBoxVisible(boxId: string) {
    mutateBoxes(boxId, boxes => boxes.map(b => b.id === boxId ? { ...b, visible: b.visible === false ? true : false } : b))
  }

  /** Ajoute un décor manipulable (générique — n'importe quel motif de ADDABLE_DECOR). */
  function handleAddDecor(decorType: string) {
    if (activeSide !== 'cover' || !coverPage) return
    const id = uuid()
    const w = 14
    const maxZ = Math.max(...coverPage.boxes.map(boxZIndex), 40)
    const box: AlbumBox = {
      id, kind: 'decor', decorType, x: 43, y: 40, w, h: Math.max(w * (DECOR_RATIO[decorType as keyof typeof DECOR_RATIO] ?? 0.6), 4),
      zIndex: maxZ + 1, visible: true, movable: true, resizable: true, rotatable: true, deletable: true, duplicable: true,
    }
    commit({ ...coverPage, boxes: [...coverPage.boxes, box] }, backCoverPage)
    selectBox(id)
  }

  /** Ajoute un décor à partir d'une image importée (autocollant / illustration au format libre). */
  async function handleAddImageDecor(e: React.ChangeEvent<HTMLInputElement>) {
    const file = Array.from(e.target.files ?? []).find(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file || activeSide !== 'cover' || !coverPage) return
    setUploading(true)
    try {
      const photo = await addPhotoToVoyage(voyageId, { name: file.name }, file)
      onPhotosAdded([photo], { [photo.id]: URL.createObjectURL(file) })
      setCoverUploadPhotos(prev => [...prev, photo])
      const id = uuid()
      const maxZ = Math.max(...coverPage.boxes.map(boxZIndex), 40)
      const box: AlbumBox = {
        id, kind: 'decor', photoId: photo.id, x: 40, y: 38, w: 22, h: 22,
        zIndex: maxZ + 1, visible: true, movable: true, resizable: true, rotatable: true, deletable: true, duplicable: true,
      }
      commit({ ...coverPage, boxes: [...coverPage.boxes, box] }, backCoverPage)
      selectBox(id)
    } finally {
      setUploading(false)
    }
  }

  // ── Couverture : gabarit + surcharges par élément ─────────────────────────

  /** Renvoie la page couverture avec la mise en page du gabarit `id` : on GARDE le contenu
   * (textes, masquages, photo de carte choisie, photos ajoutées) mais on efface tous les
   * repositionnements / retailles manuels, et on replace les photos sur les emplacements
   * suggérés par le gabarit. Le fond, la couleur et l'affichage du décor sont conservés. */
  function withTemplateLayout(page: ComposedAlbumPage, id: CoverTemplateId): ComposedAlbumPage {
    const tplDef = coverTemplate(id)
    const el = page.cover?.el ?? {}
    const keepEl: Partial<Record<CoverElKey, CoverElOverride>> = {}
    ;(['eyebrow', 'title', 'dates', 'body', 'map'] as CoverElKey[]).forEach(k => {
      const o = el[k]
      if (!o) return
      const kept: CoverElOverride = {}
      if (o.text != null) kept.text = o.text
      if (o.hidden != null) kept.hidden = o.hidden
      if (k === 'map' && o.photoId) kept.photoId = o.photoId
      if (k === 'map' && o.fit != null) kept.fit = o.fit
      if (Object.keys(kept).length) keepEl[k] = kept
    })
    const slots = tplDef.photoSlots
    let si = 0
    // On garde photos + cases-texte libres, on replace les photos sur les emplacements du gabarit,
    // et on régénère les décors « de départ » (les décors ajoutés/déplacés par l'utilisateur sont
    // remis à ceux du modèle — c'est le but de « Replacer comme le modèle » / changer de gabarit).
    const kept = page.boxes
      .filter(b => b.kind !== 'decor')
      .map(b => {
        if (b.kind !== 'photo') return b
        const s = slots[si++ % Math.max(slots.length, 1)] ?? { x: 30, y: 55, w: 32, h: 30, rotate: 0 }
        return { ...b, x: s.x, y: s.y, w: s.w, h: s.h ?? 30, rotation: s.rotate }
      })
    // On revient à un gabarit intégré : plus d'image importée ni de référence à un gabarit
    // utilisateur (le décor et la carte du gabarit réapparaissent).
    const nextCover = { ...(page.cover ?? {}), el: keepEl }
    delete nextCover.bgImage
    delete nextCover.tplRef
    return {
      ...page,
      coverTemplate: id,
      cover: nextCover,
      boxes: [...kept, ...decorSeedsToBoxes(tplDef.decorSeeds)],
    }
  }

  /** Choix d'un gabarit : on applique directement sa mise en page (le contenu suit).
   * Un id « u:… » désigne un gabarit enregistré par l'utilisateur. */
  function handleChooseCoverTemplate(id: string) {
    if (!coverPage) return
    if (isUserTemplateId(id)) {
      const t = userTemplates.find(u => u.id === id)
      if (t) commit(applyUserCoverTemplate(coverPage, t), backCoverPage)
      return
    }
    commit(withTemplateLayout(coverPage, id as CoverTemplateId), backCoverPage)
  }

  /** Bouton « Revenir au modèle initial » : remet la couverture dans l'état d'origine du modèle
   * intégré — comme avant toute personnalisation (positions, tailles, polices, couleurs, palette,
   * fond, gabarit importé, décors ajoutés, photos placées sont effacés ; le décor « de départ » du
   * modèle est régénéré). Seuls les TEXTES saisis (sur-titre / titre / dates / texte) sont gardés. */
  function handleResetToBaseTemplate() {
    if (!coverPage) return
    const base = isUserTemplateId(coverPage.coverTemplate)
      ? (userTemplates.find(u => u.id === coverPage.coverTemplate)?.base ?? DEFAULT_COVER_TEMPLATE)
      : ((coverPage.coverTemplate as CoverTemplateId | undefined) ?? DEFAULT_COVER_TEMPLATE)
    const keepText: Partial<Record<CoverElKey, CoverElOverride>> = {}
    ;(['eyebrow', 'title', 'dates', 'body'] as CoverElKey[]).forEach(k => {
      const t = coverPage.cover?.el?.[k]?.text
      if (t != null) keepText[k] = { text: t }
    })
    commit({
      ...coverPage,
      coverTemplate: base,
      cover: { el: keepText },
      boxes: decorSeedsToBoxes(coverTemplate(base).decorSeeds),
    }, backCoverPage)
  }

  /** Enregistre l'état courant de la couverture comme gabarit réutilisable (sans les photos ni
   * les textes de contenu). Il apparaît ensuite dans le sélecteur, à côté des gabarits intégrés. */
  function handleSaveAsTemplate(label: string) {
    if (!coverPage) return
    const cur = coverPage.coverTemplate
    const base: CoverTemplateId = isUserTemplateId(cur)
      ? (userTemplates.find(u => u.id === cur)?.base ?? DEFAULT_COVER_TEMPLATE)
      : ((cur as CoverTemplateId | undefined) ?? DEFAULT_COVER_TEMPLATE)
    const tpl = createUserCoverTemplate(label, base, coverPage.cover, coverPage.boxes)
    setUserTemplates(loadUserCoverTemplates())
    setSavingTplName(null)
    // Marque la couverture comme issue de ce gabarit (surbrillance + « Replacer comme le modèle »).
    commit({ ...coverPage, cover: { ...(coverPage.cover ?? {}), tplRef: tpl.id } }, backCoverPage)
  }

  function handleDeleteUserTemplate(id: string) {
    setUserTemplates(deleteUserCoverTemplate(id))
    // Si on supprime le gabarit actuellement appliqué, on revient à son gabarit intégré de base
    // (image importée retirée, décor et carte du gabarit rétablis).
    if (coverPage?.cover?.tplRef === id) {
      commit(withTemplateLayout(coverPage, coverPage.coverTemplate ?? DEFAULT_COVER_TEMPLATE), backCoverPage)
    }
  }

  /** Applique une surcharge à un élément de couverture (titre / dates / texte / carte). */
  function patchCoverEl(el: CoverElKey, patch: Partial<CoverElOverride>) {
    if (!coverPage) return coverPage
    const cover = coverPage.cover ?? {}
    const nextEl = { ...(cover.el ?? {}), [el]: { ...(cover.el?.[el] ?? {}), ...patch } }
    return { ...coverPage, cover: { ...cover, el: nextEl } }
  }

  function handleCoverElChange(el: CoverElKey, patch: Partial<CoverElOverride>) {
    const next = patchCoverEl(el, patch)
    if (next) commit(next, backCoverPage)
  }

  /** Texte d'un élément de couverture — écriture immédiate dans le state, sauvegarde différée. */
  function handleCoverElText(el: CoverElKey, value: string) {
    setCoverPage(prev => {
      if (!prev) return prev
      const cover = prev.cover ?? {}
      const nextEl = { ...(cover.el ?? {}), [el]: { ...(cover.el?.[el] ?? {}), text: value } }
      return { ...prev, cover: { ...cover, el: nextEl } }
    })
    clearTimeout(boxTextTimers.current[`cover-${el}`])
    boxTextTimers.current[`cover-${el}`] = setTimeout(() => {
      setCoverPage(cover => { setBackCoverPage(back => { onSaveRef.current(cover ?? undefined, back ?? undefined); return back }); return cover })
    }, 600)
  }

  function handleCoverBgChange(value: string | undefined) {
    if (!coverPage) return
    const cover = { ...(coverPage.cover ?? {}) }
    if (value) cover.bg = value; else delete cover.bg
    commit({ ...coverPage, cover }, backCoverPage)
  }

  /** Choix d'une palette de couleurs (COVER_PALETTES) — remplace le thème du gabarit sans
   * toucher à sa structure. `undefined` = revenir à la palette du gabarit. */
  function handleCoverPaletteChange(id: string | undefined) {
    if (!coverPage) return
    const cover = { ...(coverPage.cover ?? {}) }
    if (id) cover.palette = id; else delete cover.palette
    commit({ ...coverPage, cover }, backCoverPage)
  }

  function handleCoverDecorColorChange(value: string) {
    if (!coverPage) return
    commit({ ...coverPage, cover: { ...(coverPage.cover ?? {}), decorColor: value } }, backCoverPage)
  }

  function handleCoverDecorToggle() {
    if (!coverPage) return
    const cover = coverPage.cover ?? {}
    commit({ ...coverPage, cover: { ...cover, decorHidden: !cover.decorHidden } }, backCoverPage)
  }

  // ── Dos : mêmes outils que la couverture, gabarits dédiés + bibliothèque perso séparée ────
  // (les éléments-texte structurés du gabarit sont masqués — le dos = fond + palette + décor +
  // cases libres.)

  const backBaseTemplateId = (): CoverTemplateId => {
    const cur = backCoverPage?.coverTemplate
    return isUserTemplateId(cur)
      ? (userBackTemplates.find(u => u.id === cur)?.base ?? DEFAULT_BACK_COVER_TEMPLATE)
      : ((cur as CoverTemplateId | undefined) ?? DEFAULT_BACK_COVER_TEMPLATE)
  }

  /** Applique la mise en page d'un gabarit de dos intégré : garde photos + cases-texte, replace
   * les photos sur les emplacements du gabarit, régénère ses décors « de départ », efface fond
   * importé / référence de gabarit perso. */
  function withBackTemplateLayout(page: ComposedAlbumPage, id: CoverTemplateId): ComposedAlbumPage {
    const tplDef = coverTemplate(id)
    const slots = tplDef.photoSlots
    let si = 0
    const kept = page.boxes
      .filter(b => b.kind !== 'decor')
      .map(b => {
        if (b.kind !== 'photo') return b
        const s = slots[si++ % Math.max(slots.length, 1)] ?? { x: 30, y: 33, w: 40, h: 40, rotate: 0 }
        return { ...b, x: s.x, y: s.y, w: s.w, h: s.h ?? 40, rotation: s.rotate }
      })
    // On garde les TEXTES saisis (titre / sur-titre / accroche / pied) et leur masquage ;
    // on efface les repositionnements manuels, le fond importé et la référence de gabarit perso.
    const el = page.cover?.el ?? {}
    const keepEl: Partial<Record<CoverElKey, CoverElOverride>> = {}
    ;(['eyebrow', 'title', 'dates', 'body'] as CoverElKey[]).forEach(k => {
      const o = el[k]
      if (!o) return
      const kp: CoverElOverride = {}
      if (o.text != null) kp.text = o.text
      if (o.hidden != null) kp.hidden = o.hidden
      if (Object.keys(kp).length) keepEl[k] = kp
    })
    const nextCover = { ...(page.cover ?? {}), el: keepEl }
    delete nextCover.bgImage
    delete nextCover.tplRef
    return { ...page, coverTemplate: id, cover: nextCover, boxes: [...kept, ...decorSeedsToBoxes(tplDef.decorSeeds)] }
  }

  function handleChooseBackTemplate(id: string) {
    if (!backCoverPage) return
    if (isUserTemplateId(id)) {
      const t = userBackTemplates.find(u => u.id === id)
      if (t) commit(coverPage, applyUserBackCoverTemplate(backCoverPage, t))
      return
    }
    commit(coverPage, withBackTemplateLayout(backCoverPage, id as CoverTemplateId))
  }

  function handleResetBackToBaseTemplate() {
    if (!backCoverPage) return
    const base = backBaseTemplateId()
    const keepText: Partial<Record<CoverElKey, CoverElOverride>> = {}
    ;(['eyebrow', 'title', 'dates', 'body'] as CoverElKey[]).forEach(k => {
      const t = backCoverPage.cover?.el?.[k]?.text
      if (t != null) keepText[k] = { text: t }
    })
    commit(coverPage, {
      ...backCoverPage,
      coverTemplate: base,
      cover: { el: keepText },
      boxes: decorSeedsToBoxes(coverTemplate(base).decorSeeds),
    })
  }

  function handleSaveBackAsTemplate(label: string) {
    if (!backCoverPage) return
    const base = backBaseTemplateId()
    const tpl = createUserBackCoverTemplate(label, base, backCoverPage.cover, backCoverPage.boxes)
    setUserBackTemplates(loadUserBackCoverTemplates())
    setSavingBackTplName(null)
    commit(coverPage, { ...backCoverPage, cover: { ...(backCoverPage.cover ?? {}), tplRef: tpl.id } })
  }

  function handleDeleteUserBackTemplate(id: string) {
    setUserBackTemplates(deleteUserBackCoverTemplate(id))
    if (backCoverPage?.cover?.tplRef === id) {
      commit(coverPage, withBackTemplateLayout(backCoverPage, backCoverPage.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE))
    }
  }

  async function handleImportBackGabarit(e: React.ChangeEvent<HTMLInputElement>) {
    const file = Array.from(e.target.files ?? []).find(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file || !backCoverPage) return
    setUploading(true)
    try {
      const image = await fileToDownscaledDataUrl(file)
      const base = backBaseTemplateId()
      snapshotBackCompositionBeforeImport(base, backCoverPage.cover, backCoverPage.boxes)
      const tpl = createImportedBackCoverTemplate('Gabarit importé', base, image)
      setUserBackTemplates(loadUserBackCoverTemplates())
      commit(coverPage, applyUserBackCoverTemplate(backCoverPage, tpl))
    } finally {
      setUploading(false)
    }
  }

  function handleBackBgChange(value: string | undefined) {
    if (!backCoverPage) return
    const cover = { ...(backCoverPage.cover ?? {}) }
    if (value) cover.bg = value; else delete cover.bg
    commit(coverPage, { ...backCoverPage, cover })
  }

  function handleBackPaletteChange(id: string | undefined) {
    if (!backCoverPage) return
    const cover = { ...(backCoverPage.cover ?? {}) }
    if (id) cover.palette = id; else delete cover.palette
    commit(coverPage, { ...backCoverPage, cover })
  }

  function handleBackDecorColorChange(value: string) {
    if (!backCoverPage) return
    commit(coverPage, { ...backCoverPage, cover: { ...(backCoverPage.cover ?? {}), decorColor: value } })
  }

  function handleBackDecorToggle() {
    if (!backCoverPage) return
    const cover = backCoverPage.cover ?? {}
    commit(coverPage, { ...backCoverPage, cover: { ...cover, decorHidden: !cover.decorHidden } })
  }

  function handleAddBackDecor(decorType: string) {
    if (!backCoverPage) return
    const id = uuid()
    const w = 14
    const maxZ = Math.max(...backCoverPage.boxes.map(boxZIndex), 40)
    const box: AlbumBox = {
      id, kind: 'decor', decorType, x: 43, y: 40, w, h: Math.max(w * (DECOR_RATIO[decorType as keyof typeof DECOR_RATIO] ?? 0.6), 4),
      zIndex: maxZ + 1, visible: true, movable: true, resizable: true, rotatable: true, deletable: true, duplicable: true,
    }
    commit(coverPage, { ...backCoverPage, boxes: [...backCoverPage.boxes, box] })
    selectBox(id)
  }

  async function handleAddBackImageDecor(e: React.ChangeEvent<HTMLInputElement>) {
    const file = Array.from(e.target.files ?? []).find(f => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file || !backCoverPage) return
    setUploading(true)
    try {
      const photo = await addPhotoToVoyage(voyageId, { name: file.name }, file)
      onPhotosAdded([photo], { [photo.id]: URL.createObjectURL(file) })
      setCoverUploadPhotos(prev => [...prev, photo])
      const id = uuid()
      const maxZ = Math.max(...backCoverPage.boxes.map(boxZIndex), 40)
      const box: AlbumBox = {
        id, kind: 'decor', photoId: photo.id, x: 40, y: 38, w: 22, h: 22,
        zIndex: maxZ + 1, visible: true, movable: true, resizable: true, rotatable: true, deletable: true, duplicable: true,
      }
      commit(coverPage, { ...backCoverPage, boxes: [...backCoverPage.boxes, box] })
      selectBox(id)
    } finally {
      setUploading(false)
    }
  }

  // Éléments-texte du gabarit de dos (titre / sur-titre / accroche / pied de page) — mêmes
  // surcharges que la couverture, ciblées sur `backCoverPage`.
  function patchBackEl(el: CoverElKey, patch: Partial<CoverElOverride>): ComposedAlbumPage | null {
    if (!backCoverPage) return null
    const cover = backCoverPage.cover ?? {}
    const nextEl = { ...(cover.el ?? {}), [el]: { ...(cover.el?.[el] ?? {}), ...patch } }
    return { ...backCoverPage, cover: { ...cover, el: nextEl } }
  }

  function handleBackElChange(el: CoverElKey, patch: Partial<CoverElOverride>) {
    const next = patchBackEl(el, patch)
    if (next) commit(coverPage, next)
  }

  function handleBackElText(el: CoverElKey, value: string) {
    setBackCoverPage(prev => {
      if (!prev) return prev
      const cover = prev.cover ?? {}
      const nextEl = { ...(cover.el ?? {}), [el]: { ...(cover.el?.[el] ?? {}), text: value } }
      return { ...prev, cover: { ...cover, el: nextEl } }
    })
    clearTimeout(boxTextTimers.current[`back-${el}`])
    boxTextTimers.current[`back-${el}`] = setTimeout(() => {
      setCoverPage(cover => { setBackCoverPage(back => { onSaveRef.current(cover ?? undefined, back ?? undefined); return back }); return cover })
    }, 600)
  }

  /** Glisser-déposer d'un élément-texte du dos — miroir de beginCoverElDrag sur `backCoverPage`. */
  function beginBackElDrag(e: React.MouseEvent | React.TouchEvent, el: CoverElKey, mode: 'move' | 'resize' = 'move') {
    if (e.cancelable && e.nativeEvent.type !== 'touchstart') e.preventDefault()
    e.stopPropagation()
    const inner = backInnerRef.current
    const target = (e.currentTarget as HTMLElement).parentElement
    if (!inner || !target || !backCoverPage) return
    setSelectedBoxId(null)
    setOpenSection(el)
    const innerRect = inner.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const cur = backCoverPage.cover?.el?.[el]
    const startX = cur?.x ?? ((targetRect.left - innerRect.left) / innerRect.width * 100)
    const startY = cur?.y ?? ((targetRect.top - innerRect.top) / innerRect.height * 100)
    const startW = targetRect.width / innerRect.width * 100
    const startH = targetRect.height / innerRect.height * 100
    const start = getPoint(e.nativeEvent)

    function onMove(ev: MouseEvent | TouchEvent) {
      ev.preventDefault()
      const p = getPoint(ev)
      const patch = mode === 'resize'
        ? {
            w: clamp(startW + (p.x - start.x) / innerRect.width * 100, 8, 100),
            h: clamp(startH + (p.y - start.y) / innerRect.height * 100, 8, 100),
          }
        : {
            x: clamp(startX + (p.x - start.x) / innerRect.width * 100, -5, 98),
            y: clamp(startY + (p.y - start.y) / innerRect.height * 100, -5, 98),
          }
      setBackCoverPage(prev => {
        if (!prev) return prev
        const cover = prev.cover ?? {}
        const nextEl = { ...(cover.el ?? {}), [el]: { ...(cover.el?.[el] ?? {}), ...patch } }
        return { ...prev, cover: { ...cover, el: nextEl } }
      })
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
      setCoverPage(cover => { setBackCoverPage(back => { onSaveRef.current(cover ?? undefined, back ?? undefined); return back }); return cover })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
  }

  /** Remplace la carte du tracé par la photo actuellement choisie dans la liste (ou la remet
   * sur la carte par défaut si on reclique la carte suggérée). */
  function handleCoverMapPick() {
    if (!coverPage || !pickedPhotoId) return
    const photoId = pickedPhotoId === DEFAULT_COVER_PHOTO_ID ? undefined : pickedPhotoId
    commit(patchCoverEl('map', { photoId }) ?? coverPage, backCoverPage)
    setPickedPhotoId(null)
  }

  /** Glisser-déposer d'un élément de couverture (titre, dates, texte, carte). La position par
   * défaut vient du gabarit ; au premier déplacement on part de la position réelle à l'écran
   * pour éviter un saut brusque. */
  function beginCoverElDrag(e: React.MouseEvent | React.TouchEvent, el: CoverElKey, mode: 'move' | 'resize' = 'move') {
    if (e.cancelable && e.nativeEvent.type !== 'touchstart') e.preventDefault()
    e.stopPropagation()
    const inner = coverInnerRef.current
    const target = (e.currentTarget as HTMLElement).parentElement
    if (!inner || !target || !coverPage) return
    setSelectedBoxId(null)
    setOpenSection(el)
    const innerRect = inner.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const cur = coverPage.cover?.el?.[el]
    const startX = cur?.x ?? ((targetRect.left - innerRect.left) / innerRect.width * 100)
    const startY = cur?.y ?? ((targetRect.top - innerRect.top) / innerRect.height * 100)
    const startW = targetRect.width / innerRect.width * 100
    const startH = targetRect.height / innerRect.height * 100
    const start = getPoint(e.nativeEvent)

    function onMove(ev: MouseEvent | TouchEvent) {
      ev.preventDefault()
      const p = getPoint(ev)
      const patch = mode === 'resize'
        ? {
            w: clamp(startW + (p.x - start.x) / innerRect.width * 100, 8, 100),
            h: clamp(startH + (p.y - start.y) / innerRect.height * 100, 8, 100),
          }
        : {
            x: clamp(startX + (p.x - start.x) / innerRect.width * 100, -5, 98),
            y: clamp(startY + (p.y - start.y) / innerRect.height * 100, -5, 98),
          }
      setCoverPage(prev => {
        if (!prev) return prev
        const cover = prev.cover ?? {}
        const nextEl = { ...(cover.el ?? {}), [el]: { ...(cover.el?.[el] ?? {}), ...patch } }
        return { ...prev, cover: { ...cover, el: nextEl } }
      })
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
      setCoverPage(cover => { setBackCoverPage(back => { onSaveRef.current(cover ?? undefined, back ?? undefined); return back }); return cover })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
  }

  // Les écouteurs sont créés dans beginDrag pour que add/removeEventListener partagent la même
  // identité de fonction — un handler défini au niveau du composant change à chaque render et
  // ne serait jamais retiré, laissant s'empiler les écouteurs d'un glisser à l'autre.
  function beginDrag(e: React.MouseEvent | React.TouchEvent, boxId: string, mode: 'move' | 'resize' | 'rotate') {
    if (e.cancelable && e.nativeEvent.type !== 'touchstart') e.preventDefault()
    e.stopPropagation()
    // Une case libre peut vivre sur le dos OU sur la couverture (cases-texte ajoutées par-dessus).
    const side = sideOfBox(boxId)
    if (!side) return
    if (activeSide !== side) setActiveSide(side)
    const setSidePage = side === 'cover' ? setCoverPage : setBackCoverPage
    const canvas = (side === 'cover' ? coverBoxLayerRef.current : backBoxLayerRef.current)
    const box = (side === 'cover' ? coverPage : backCoverPage)?.boxes.find(b => b.id === boxId)
    if (!canvas || !box) return
    const rect = canvas.getBoundingClientRect()
    const start = getPoint(e.nativeEvent)
    // Rotation : angle initial entre le centre de la case (en px écran) et le pointeur.
    const centerX = rect.left + (box.x + box.w / 2) / 100 * rect.width
    const centerY = rect.top + (box.y + box.h / 2) / 100 * rect.height
    const startAngle = Math.atan2(start.y - centerY, start.x - centerX) * 180 / Math.PI
    const startRotation = box.rotation ?? 0
    const drag: DragState = {
      mode, boxId, startClientX: start.x, startClientY: start.y, startBox: box,
      canvasW: rect.width, canvasH: rect.height,
    }
    dragRef.current = drag

    function onMove(ev: MouseEvent | TouchEvent) {
      ev.preventDefault()
      const p = getPoint(ev)
      const dxPct = (p.x - drag.startClientX) / drag.canvasW * 100
      const dyPct = (p.y - drag.startClientY) / drag.canvasH * 100
      const { startBox } = drag
      if (drag.mode === 'rotate') {
        const a = Math.atan2(p.y - centerY, p.x - centerX) * 180 / Math.PI
        let rot = Math.round(startRotation + (a - startAngle))
        if ('shiftKey' in ev && ev.shiftKey) rot = Math.round(rot / 15) * 15
        setSidePage(page => page ? { ...page, boxes: page.boxes.map(b => b.id === drag.boxId ? { ...b, rotation: rot } : b) } : page)
      } else if (drag.mode === 'move') {
        const x = clamp(startBox.x + dxPct, -10, 100 - startBox.w * 0.2)
        const y = clamp(startBox.y + dyPct, -10, 100 - startBox.h * 0.2)
        setSidePage(page => page ? { ...page, boxes: page.boxes.map(b => b.id === drag.boxId ? { ...b, x, y } : b) } : page)
      } else {
        const w = clamp(startBox.w + dxPct, MIN_BOX_SIZE, 100 - startBox.x)
        const h = clamp(startBox.h + dyPct, MIN_BOX_SIZE, 100 - startBox.y)
        setSidePage(page => page ? { ...page, boxes: page.boxes.map(b => b.id === drag.boxId ? { ...b, w, h } : b) } : page)
      }
    }

    function onUp() {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
      setCoverPage(cover => { setBackCoverPage(back => { onSaveRef.current(cover ?? undefined, back ?? undefined); return back }); return cover })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
  }

  /** « Menu contextuel » de la case libre sélectionnée (photo / décor / texte) — actions filtrées
   * selon les capacités de la case. Affiché dans le panneau ; rien si aucune case sélectionnée. */
  function renderSelectedElementPanel() {
    const b = selectedBox
    if (!b) return null
    const can = (f: 'movable' | 'resizable' | 'rotatable' | 'deletable' | 'duplicable') => b[f] !== false
    return (
      <>
        <div className="albed-box-settings__row">
          <button type="button" title="Mettre devant" onClick={() => handleBoxLayer(b.id, 'front')}>⤒</button>
          <button type="button" title="Avancer d’un cran" onClick={() => handleBoxLayer(b.id, 'forward')}>↑</button>
          <button type="button" title="Reculer d’un cran" onClick={() => handleBoxLayer(b.id, 'backward')}>↓</button>
          <button type="button" title="Mettre derrière" onClick={() => handleBoxLayer(b.id, 'back')}>⤓</button>
        </div>
        <div className="albed-box-settings__row">
          {b.kind === 'photo' && (
            <button type="button" title="Remplacer" onClick={() => { setSelectedBoxId(b.id); photoInputRef.current?.click() }}>Remplacer</button>
          )}
          {can('duplicable') && b.kind !== 'text' && (
            <button type="button" title="Dupliquer" onClick={() => handleDuplicateBox(b.id)}>Dupliquer</button>
          )}
          <button type="button" title={b.visible === false ? 'Afficher' : 'Masquer'}
            className={b.visible === false ? 'active' : ''}
            onClick={() => handleToggleBoxVisible(b.id)}>{b.visible === false ? '🙈 Afficher' : '👁 Masquer'}</button>
          {can('deletable') && (
            <button type="button" title="Supprimer" onClick={e => handleClearBox(b.id, e)}>🗑</button>
          )}
        </div>
        {b.kind === 'photo' && (
          <>
            <div className="albcov-field-label">Photo dans le cadre</div>
            <div className="albed-box-settings__row">
              <button type="button" className={(b.photoFit ?? 'cover') === 'cover' ? 'active' : ''}
                onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, photoFit: 'cover' } : x))}>Remplir le cadre</button>
              <button type="button" className={b.photoFit === 'contain' ? 'active' : ''}
                onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, photoFit: 'contain' } : x))}>Photo entière</button>
            </div>
            {b.photoId && b.photoFit !== 'contain' && (
              <>
                <div className="albcov-field-label">Cadrage — position horizontale</div>
                <div className="albcov-title-scale">
                  <input type="range" min={0} max={100} step={1} value={b.photoOffsetX ?? 50}
                    onChange={e => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, photoOffsetX: Number(e.target.value) } : x))} />
                  <span>{b.photoOffsetX ?? 50}%</span>
                </div>
                <div className="albcov-field-label">Cadrage — position verticale</div>
                <div className="albcov-title-scale">
                  <input type="range" min={0} max={100} step={1} value={b.photoOffsetY ?? 50}
                    onChange={e => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, photoOffsetY: Number(e.target.value) } : x))} />
                  <span>{b.photoOffsetY ?? 50}%</span>
                </div>
                <div className="albcov-field-label">Cadrage — zoom</div>
                <div className="albcov-title-scale">
                  <input type="range" min={0.4} max={2} step={0.05} value={b.photoScale ?? 1}
                    onChange={e => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, photoScale: Number(e.target.value) } : x))} />
                  <span>{Math.round((b.photoScale ?? 1) * 100)}%</span>
                </div>
              </>
            )}
          </>
        )}
        {b.kind === 'decor' && (
          <>
            <div className="albcov-field-label">{b.photoId ? 'Teinte' : 'Couleur'}</div>
            <div className="albed-box-settings__row">
              <input type="color" value={b.color || themeColor(tpl.colors.decor, tplTheme) || '#888888'}
                onChange={e => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, color: e.target.value } : x))} />
              <button type="button" className={!b.color ? 'active' : ''}
                onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, color: undefined } : x))}>
                {b.photoId ? 'Couleurs d’origine' : 'Défaut'}
              </button>
            </div>
            {(b.decorType === 'framerect' || b.decorType === 'circle') && (
              <>
                <div className="albcov-field-label">Remplissage</div>
                <div className="albed-box-settings__row">
                  <button type="button" className={!b.decorFilled ? 'active' : ''}
                    onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, decorFilled: false } : x))}>Contour</button>
                  <button type="button" className={b.decorFilled ? 'active' : ''}
                    onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, decorFilled: true } : x))}>Plein</button>
                </div>
              </>
            )}
          </>
        )}
        {(b.kind === 'photo' || b.kind === 'decor') && (
          <>
            <div className="albcov-field-label">Taille</div>
            <div className="albcov-title-scale">
              <input type="range" min={6} max={92} step={1} disabled={!can('resizable')}
                value={Math.round(b.w)}
                onChange={e => {
                  const nw = Number(e.target.value)
                  const ratio = b.w > 0 ? b.h / b.w : 1
                  mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id
                    ? { ...x, w: nw, h: Math.round(nw * ratio * 10) / 10 } : x))
                }} />
              <span>{Math.round(b.w)}%</span>
            </div>
            <div className="albcov-field-label">Ombre du cadre</div>
            <div className="albed-box-settings__row">
              <button type="button"
                className={(b.shadow ?? b.kind === 'photo') ? 'active' : ''}
                onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, shadow: true } : x))}>Avec</button>
              <button type="button"
                className={!(b.shadow ?? b.kind === 'photo') ? 'active' : ''}
                onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, shadow: false } : x))}>Sans</button>
            </div>
            {(b.shadow ?? b.kind === 'photo') && (
              <>
                <div className="albcov-title-scale">
                  <input type="range" min={1} max={4} step={1}
                    value={b.shadowLevel ?? 2}
                    onChange={e => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, shadowLevel: Number(e.target.value) } : x))} />
                  <span>Intensité {b.shadowLevel ?? 2}</span>
                </div>
                <div className="albed-box-settings__row">
                  {(['tl', 'tr', 'bl', 'br'] as const).map(d => (
                    <button key={d} type="button" title="Orientation de l’ombre"
                      className={b.shadowDir === d ? 'active' : ''}
                      onClick={() => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id
                        ? { ...x, shadowDir: b.shadowDir === d ? undefined : d } : x))}>
                      {d === 'tl' ? '↖' : d === 'tr' ? '↗' : d === 'bl' ? '↙' : '↘'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <div className="albcov-field-label">Inclinaison</div>
        <div className="albcov-title-scale">
          <input type="range" min={-45} max={45} step={1} disabled={!can('rotatable')}
            value={b.rotation ?? 0}
            onChange={e => mutateBoxes(b.id, boxes => boxes.map(x => x.id === b.id ? { ...x, rotation: Number(e.target.value) } : x))} />
          <span>{b.rotation ?? 0}°</span>
        </div>
        <p className="albed-empty-hint">
          Sur l’aperçu : ⠿ déplacer · ⟳ pivoter · coin bas-droite redimensionner.
        </p>
      </>
    )
  }

  // Réglages d'une case-texte libre (couverture OU dos) — mêmes contrôles des deux côtés.
  function renderTextStylePanel() {
    const b = selectedBox
    if (!b || b.kind !== 'text') {
      return <p className="albed-empty-hint">Ajoutez une case-texte (« + Texte »), puis cliquez-la pour régler police, alignement, couleur, taille, fond, cadre et inclinaison.</p>
    }
    return (
      <>
        <div className="albed-panel-label">Case de texte</div>
        <div className="albcov-field-label">Police</div>
        <select
          value={b.fontFamily ?? ''}
          onChange={e => handleBoxStyleChange(b.id, { fontFamily: e.target.value || undefined })}
        >
          {[
            TEXT_FONTS[0],
            { value: tpl.fonts.title, label: 'Titre du gabarit' },
            { value: tpl.fonts.dates, label: 'Dates du gabarit' },
            ...TEXT_FONTS.slice(1),
          ].map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <div className="albcov-field-label">Style</div>
        <div className="albed-box-settings__row">
          <button type="button" className={b.bold ? 'active' : ''} style={{ fontWeight: 'bold' }}
            onClick={() => handleBoxStyleChange(b.id, { bold: !b.bold })} title="Gras">G</button>
          <button type="button" className={b.italic ? 'active' : ''} style={{ fontStyle: 'italic' }}
            onClick={() => handleBoxStyleChange(b.id, { italic: !b.italic })} title="Italique">I</button>
        </div>
        <div className="albcov-field-label">Alignement</div>
        <div className="albed-box-settings__row">
          {TEXT_ALIGNS.map(a => (
            <button key={a.value} type="button"
              className={(b.textAlign ?? 'left') === a.value ? 'active' : ''}
              onClick={() => handleBoxStyleChange(b.id, { textAlign: a.value === 'left' ? undefined : a.value })}
              title={a.title}>{a.label}</button>
          ))}
        </div>
        <div className="albcov-field-label">Couleur du texte</div>
        <div className="albed-box-settings__row">
          <input type="color" value={b.textColor ?? '#1c1b18'}
            onChange={e => handleBoxStyleChange(b.id, { textColor: e.target.value })} />
          <button type="button" className={!b.textColor ? 'active' : ''}
            onClick={() => handleBoxStyleChange(b.id, { textColor: undefined })}>Défaut</button>
        </div>
        <div className="albcov-field-label">Taille</div>
        <div className="albcov-title-scale">
          <input type="range" min={8} max={140} step={1}
            value={b.fontSize ?? 14}
            onChange={e => handleBoxStyleChange(b.id, { fontSize: Number(e.target.value) })} />
          <span>{b.fontSize ?? 14}px</span>
        </div>
        <div className="albcov-field-label">Fond</div>
        <div className="albed-box-settings__row">
          <input type="color"
            value={b.bgColor && b.bgColor !== 'transparent' ? b.bgColor : '#ffffff'}
            disabled={b.bgColor === 'transparent'}
            onChange={e => handleBoxStyleChange(b.id, { bgColor: e.target.value })} />
          <button type="button" className={b.bgColor === 'transparent' ? 'active' : ''}
            onClick={() => handleBoxStyleChange(b.id, { bgColor: b.bgColor === 'transparent' ? undefined : 'transparent' })}>Transparent</button>
        </div>
        <div className="albcov-field-label">Cadre</div>
        <div className="albed-box-settings__row">
          <input type="color" value={b.borderColor ?? '#94A3B8'} disabled={!b.borderColor}
            onChange={e => handleBoxStyleChange(b.id, { borderColor: e.target.value })} />
          <button type="button" className={b.borderColor ? 'active' : ''}
            onClick={() => handleBoxStyleChange(b.id, { borderColor: b.borderColor ? undefined : '#94A3B8' })}>{b.borderColor ? 'Retirer' : 'Ajouter'}</button>
        </div>
        <div className="albcov-field-label">Inclinaison</div>
        <div className="albcov-title-scale">
          <input type="range" min={-20} max={20} step={1}
            value={b.rotation ?? 0}
            onChange={e => handleBoxStyleChange(b.id, { rotation: Number(e.target.value) })} />
          <span>{b.rotation ?? 0}°</span>
        </div>
      </>
    )
  }

  const tpl = coverTemplate(coverPage?.coverTemplate)
  const tplTheme = coverTheme(tpl, coverPage?.cover ?? undefined)
  const backTpl = coverTemplate(backCoverPage?.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE)
  const backTplTheme = coverTheme(backTpl, backCoverPage?.cover ?? undefined)

  /** Une section repliable du panneau de gauche (couverture). Une seule ouverte à la fois ;
   * `openSection` est piloté aussi par les clics sur l'aperçu. */
  function coverSection(id: string, title: string, body: React.ReactNode, available = true) {
    if (!available) return null
    const open = openSection === id
    return (
      <div className={`albcov-sec${open ? ' albcov-sec--open' : ''}`}>
        <button type="button" className="albcov-sec__head" aria-expanded={open}
          onClick={() => setOpenSection(open ? null : id)}>
          <span className="albcov-sec__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          {title}
        </button>
        {open && <div className="albcov-sec__body">{body}</div>}
      </div>
    )
  }

  /** Réglages d'un élément de texte de la couverture (titre / dates / texte). Le texte lui-même
   * s'édite directement sur l'aperçu ; ici : police, couleur, taille, alignement, inclinaison,
   * visibilité. */
  function renderCoverElControls(el: Exclude<CoverElKey, 'map'>, side: 'cover' | 'back' = 'cover') {
    const page = side === 'cover' ? coverPage : backCoverPage
    const tplDef = side === 'cover' ? tpl : backTpl
    const theme = side === 'cover' ? tplTheme : backTplTheme
    const onChange = side === 'cover' ? handleCoverElChange : handleBackElChange
    if (!page) return null
    const base = tplDef.elements[el]
    if (!base) return null
    const o = page.cover?.el?.[el] ?? {}
    const hidden = o.hidden ?? base.hidden ?? false
    return (
      <>
        <label className="albcov-toggle">
          <input type="checkbox" checked={!hidden}
            onChange={() => onChange(el, { hidden: !hidden })} />
          <span>Afficher</span>
        </label>
        {!hidden && (
          <>
            <div className="albcov-field-label">Police</div>
            <select value={o.font ?? ''} onChange={e => onChange(el, { font: e.target.value || undefined })}>
              {TEXT_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <div className="albcov-field-label">Alignement</div>
            <div className="albed-box-settings__row">
              {TEXT_ALIGNS.map(a => (
                <button key={a.value} type="button"
                  className={(o.align ?? base.align) === a.value ? 'active' : ''}
                  onClick={() => onChange(el, { align: a.value })}
                  title={a.title}>{a.label}</button>
              ))}
            </div>
            <div className="albcov-field-label">Couleur</div>
            <div className="albed-box-settings__row">
              <input type="color" value={o.color ?? themeColor(tplDef.colors[el] ?? tplDef.colors.dates, theme)}
                onChange={e => onChange(el, { color: e.target.value })} />
              <button type="button" className={!o.color ? 'active' : ''}
                onClick={() => onChange(el, { color: undefined })}>Défaut</button>
            </div>
            <div className="albcov-field-label">Taille</div>
            <div className="albcov-title-scale">
              <input type="range" min={0.5} max={2} step={0.05}
                value={o.scale ?? 1}
                onChange={e => onChange(el, { scale: Number(e.target.value) })} />
              <span>{Math.round((o.scale ?? 1) * 100)}%</span>
            </div>
            <div className="albcov-field-label">Inclinaison</div>
            <div className="albcov-title-scale">
              <input type="range" min={-20} max={20} step={1}
                value={o.rotate ?? 0}
                onChange={e => onChange(el, { rotate: Number(e.target.value) })} />
              <span>{o.rotate ?? 0}°</span>
            </div>
          </>
        )}
      </>
    )
  }

  // Contenu éditable de chaque côté, réutilisé tel quel en mode deux plans (onglets) ET en mode
  // feuille d'un seul tenant (WhiteWall), où les deux sont montés côte à côte.
  const coverNode = coverPage ? (
    <AlbumCoverContent
      template={coverPage.coverTemplate ?? DEFAULT_COVER_TEMPLATE}
      cover={coverPage.cover}
      boxes={coverPage.boxes}
      mapUrl={resolveCoverMapUrl(coverPage, photoUrls)}
      innerRef={coverInnerRef}
      edit={{
        photos,
        photoUrls,
        pickedPhotoId,
        selectedBoxId,
        onElTextChange: handleCoverElText,
        onElSelect: (el: CoverElKey) => { setSelectedBoxId(null); setOpenSection(el) },
        onElDragStart: beginCoverElDrag,
        onElResizeStart: (e, el) => beginCoverElDrag(e, el, 'resize'),
        onPhotoPick: handlePickBox,
        onPhotoClear: handleClearBox,
        onPhotoSelect: selectBox,
        onTextBoxChange: handleBoxTextChange,
        onPhotoDragStart: (e, id) => beginDrag(e, id, 'move'),
        onPhotoResizeStart: (e, id) => beginDrag(e, id, 'resize'),
        onPhotoRotateStart: (e, id) => beginDrag(e, id, 'rotate'),
        onLayerClick: () => { setSelectedBoxId(null); setOpenSection(s => s === 'selection' ? 'title' : s) },
        layerRef: coverBoxLayerRef,
        mapPickable: !!pickedPhotoId,
        onMapPick: handleCoverMapPick,
      }}
    />
  ) : null

  // Le dos se compose désormais comme la couverture (même rendu AlbumCoverContent) : fond +
  // palette + décor + cases libres. Les éléments-texte structurés (titre / dates / carte) du
  // gabarit de dos sont masqués — leurs handlers sont donc des no-ops ici.
  const backCanvasNode = backCoverPage ? (
    <AlbumCoverContent
      template={backCoverPage.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE}
      cover={backCoverPage.cover}
      boxes={backCoverPage.boxes}
      mapUrl={resolveCoverMapUrl(backCoverPage, photoUrls)}
      innerRef={backInnerRef}
      edit={{
        photos,
        photoUrls,
        pickedPhotoId,
        selectedBoxId,
        onElTextChange: handleBackElText,
        onElSelect: (el: CoverElKey) => { setSelectedBoxId(null); setOpenSection(el) },
        onElDragStart: beginBackElDrag,
        onElResizeStart: (e, el) => beginBackElDrag(e, el, 'resize'),
        onPhotoPick: handlePickBox,
        onPhotoClear: handleClearBox,
        onPhotoSelect: selectBox,
        onTextBoxChange: handleBoxTextChange,
        onPhotoDragStart: (e, id) => beginDrag(e, id, 'move'),
        onPhotoResizeStart: (e, id) => beginDrag(e, id, 'resize'),
        onPhotoRotateStart: (e, id) => beginDrag(e, id, 'rotate'),
        onLayerClick: () => { setSelectedBoxId(null); setOpenSection(s => s === 'selection' ? 'bg' : s) },
        layerRef: backBoxLayerRef,
        mapPickable: false,
      }}
    />
  ) : null

  return (
    <div className="albed-shell">
      <input
        ref={photoInputRef} type="file" multiple accept="image/*"
        style={{ display: 'none' }} onChange={handlePhotoFilesChosen}
      />
      <input
        ref={bgInputRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleImportGabarit}
      />
      <input
        ref={mainPhotoInputRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleMainPhotoChosen}
      />
      <input
        ref={imageDecorInputRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleAddImageDecor}
      />
      <input
        ref={backBgInputRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleImportBackGabarit}
      />
      <input
        ref={backImageDecorInputRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={handleAddBackImageDecor}
      />
      <div className="albed-topbar">
        <button className="asp2-back-btn" onClick={handleBack}>← Retour</button>
        <div className="albed-topbar__title">
          {wrapSpread
            ? `${voyageName} · Couverture — feuille ${wrapSpread.sheetCm.w} × ${wrapSpread.sheetCm.h} cm`
            : `${voyageName} · Couverture & dos`}
        </div>
        <div className="albed-pages-nav">
          <button
            className={`albed-page-dot${activeSide === 'cover' ? ' albed-page-dot--active' : ''}`}
            onClick={() => coverPage && setActiveSide('cover')}
            disabled={!coverPage}
            title={wrapSpread ? '1re de couverture (moitié droite)' : 'Couverture'}
          >📖</button>
          <button
            className={`albed-page-dot${activeSide === 'backcover' ? ' albed-page-dot--active' : ''}`}
            onClick={() => backCoverPage && setActiveSide('backcover')}
            disabled={!backCoverPage}
            title={wrapSpread ? '4e de couverture (moitié gauche)' : 'Dos du livre'}
          >📄</button>
          {!wrapSpread && !coverPage && <button className="albed-add-page" onClick={handleAddCover}>+ Couverture</button>}
          {!wrapSpread && !backCoverPage && <button className="albed-add-page" onClick={handleAddBackCover}>+ Dos</button>}
          {!wrapSpread && activePage && <button className="albed-del-page" onClick={handleRemoveActive}>🗑 Supprimer</button>}
        </div>
      </div>

      {!activePage && !wrapSpread ? (
        <p className="albed-empty-hint">
          Créez une couverture et/ou un dos pour ce voyage — communs à toutes ses étapes,
          utilisables tels quels ou compilés avec les tracés dans l'export multi-tracés.
        </p>
      ) : (
        <div className="albed-body">
          <div className="albed-left">
            {activeSide === 'cover' ? (
              <>
                <p className="albed-empty-hint">
                  Cliquez un élément de l'aperçu (titre, dates, texte, carte, photo, décor)
                  pour ouvrir ses réglages ci-dessous ; glissez-le par sa poignée (⠿) pour le
                  déplacer. Le choix du gabarit est dans le panneau de droite.
                </p>

                {coverSection(
                  'selection',
                  `Élément sélectionné${selectedBox ? ' — ' + (selectedBox.kind === 'photo' ? 'Photo' : selectedBox.kind === 'decor' ? 'Décor' : 'Texte') : ''}`,
                  <>
                    {renderSelectedElementPanel()}
                    {selectedBox?.kind === 'text' && renderTextStylePanel()}
                  </>,
                  !!selectedBox,
                )}

                {coverPage?.cover?.bgImage && (
                  <p className="albed-empty-hint">
                    Gabarit importé : le titre et les dates du gabarit ne s'affichent pas.
                    Ajoutez vos textes avec « + Texte » (section « Photos - Texte à ajouter »).
                  </p>
                )}

                {coverSection('bg', 'Fond', (
                  <div className="albcov-frame-color">
                    <input type="color"
                      value={themeColor(coverPage?.cover?.bg ?? tpl.background, tplTheme)}
                      onChange={e => handleCoverBgChange(e.target.value)} />
                    <button type="button" className={!coverPage?.cover?.bg ? 'active' : ''}
                      onClick={() => handleCoverBgChange(undefined)}>Défaut</button>
                  </div>
                ))}

                {coverSection('title', 'Titre', renderCoverElControls('title'), !coverPage?.cover?.bgImage)}
                {coverSection('eyebrow', 'Sur-titre', renderCoverElControls('eyebrow'), !!tpl.elements.eyebrow && !coverPage?.cover?.bgImage)}

                {coverSection('map', 'Photo principale', (
                  <>
                    <div className="albed-add-box-row">
                      <button className="albed-add-box-btn"
                        onClick={() => mainPhotoInputRef.current?.click()} disabled={uploading}>
                        {uploading
                          ? 'Import…'
                          : coverPage?.cover?.el?.map?.photoId ? '🖼️ Remplacer la photo' : '🖼️ Ajouter une photo'}
                      </button>
                    </div>
                    <div className="albcov-field-label">Cadre</div>
                    <div className="albed-box-settings__row">
                      {(['card', 'strip', 'plain'] as const).map(f => (
                        <button key={f} type="button"
                          className={(coverPage?.cover?.el?.map?.frame ?? tpl.elements.map.frame) === f ? 'active' : ''}
                          onClick={() => handleCoverElChange('map', { frame: f })}>
                          {f === 'card' ? 'Encadré' : f === 'strip' ? 'Bande' : 'Sans'}
                        </button>
                      ))}
                    </div>
                    <div className="albcov-field-label">Taille</div>
                    <div className="albcov-title-scale">
                      <input type="range" min={0.5} max={1.6} step={0.05}
                        value={coverPage?.cover?.el?.map?.scale ?? 1}
                        onChange={e => handleCoverElChange('map', { scale: Number(e.target.value) })} />
                      <span>{Math.round((coverPage?.cover?.el?.map?.scale ?? 1) * 100)}%</span>
                    </div>
                    <div className="albcov-field-label">Inclinaison</div>
                    <div className="albcov-title-scale">
                      <input type="range" min={-20} max={20} step={1}
                        value={coverPage?.cover?.el?.map?.rotate ?? tpl.elements.map.rotate}
                        onChange={e => handleCoverElChange('map', { rotate: Number(e.target.value) })} />
                      <span>{coverPage?.cover?.el?.map?.rotate ?? tpl.elements.map.rotate}°</span>
                    </div>
                    <div className="albcov-field-label">Ombre du cadre</div>
                    <div className="albed-box-settings__row">
                      <button type="button"
                        className={(coverPage?.cover?.el?.map?.shadow ?? true) ? 'active' : ''}
                        onClick={() => handleCoverElChange('map', { shadow: true })}>Avec</button>
                      <button type="button"
                        className={coverPage?.cover?.el?.map?.shadow === false ? 'active' : ''}
                        onClick={() => handleCoverElChange('map', { shadow: false })}>Sans</button>
                    </div>
                    {(coverPage?.cover?.el?.map?.shadow ?? true) && (
                      <>
                        <div className="albcov-title-scale">
                          <input type="range" min={1} max={4} step={1}
                            value={coverPage?.cover?.el?.map?.shadowLevel ?? 2}
                            onChange={e => handleCoverElChange('map', { shadowLevel: Number(e.target.value) })} />
                          <span>Intensité {coverPage?.cover?.el?.map?.shadowLevel ?? 2}</span>
                        </div>
                        <div className="albed-box-settings__row">
                          {(['tl', 'tr', 'bl', 'br'] as const).map(d => (
                            <button key={d} type="button" title="Orientation de l’ombre"
                              className={coverPage?.cover?.el?.map?.shadowDir === d ? 'active' : ''}
                              onClick={() => handleCoverElChange('map', {
                                shadowDir: coverPage?.cover?.el?.map?.shadowDir === d ? undefined : d,
                              })}>
                              {d === 'tl' ? '↖' : d === 'tr' ? '↗' : d === 'bl' ? '↙' : '↘'}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {coverPage?.cover?.el?.map?.photoId && (
                      <>
                        <div className="albcov-field-label">Photo dans le cadre</div>
                        <div className="albed-box-settings__row">
                          <button type="button"
                            className={(coverPage?.cover?.el?.map?.fit ?? 'cover') === 'cover' ? 'active' : ''}
                            onClick={() => handleCoverElChange('map', { fit: 'cover' })}>Remplir le cadre</button>
                          <button type="button"
                            className={coverPage?.cover?.el?.map?.fit === 'contain' ? 'active' : ''}
                            onClick={() => handleCoverElChange('map', { fit: 'contain' })}>Photo entière</button>
                        </div>
                        <button className="albed-add-box-btn" onClick={() => handleCoverElChange('map', { photoId: undefined })}>
                          {coverPage?.cover?.bgImage ? '✕ Retirer la photo' : '↩︎ Remettre la carte du tracé'}
                        </button>
                      </>
                    )}
                    <p className="albed-empty-hint">
                      {coverPage?.cover?.bgImage
                        ? 'Une photo mise en avant sur le gabarit importé. Glissez-la et redimensionnez-la sur l’aperçu.'
                        : 'Par défaut : la carte du tracé. « Ajouter une photo » la remplace par votre image ; glissez-la et redimensionnez-la sur l’aperçu.'}
                    </p>
                  </>
                ))}

                {coverSection('photos', 'Photos - Texte à ajouter', (
                  <>
                    <div className="albed-add-box-row">
                      <button className="albed-add-box-btn" onClick={handleAddPhotoBox}>+ Photo</button>
                      <button className="albed-add-box-btn" onClick={handleAddTextBox}>+ Texte</button>
                    </div>
                    <p className="albed-empty-hint">
                      « + Photo » ajoute une photo supplémentaire (choisissez d'abord une image
                      ci-dessous pour la placer directement). Réglez ensuite taille, inclinaison
                      et ordre des calques (devant / derrière) dans « Élément sélectionné ».
                    </p>
                    {pickedPhotoId && (
                      <div className="albed-panel-label">Cliquez une case-photo pour la placer</div>
                    )}
                    <button className="albed-add-box-btn" onClick={() => photoInputRef.current?.click()} disabled={uploading}>
                      {uploading ? 'Chargement…' : '📷 Charger des photos'}
                    </button>
                    <div className="albed-photo-list">
                      <div
                        className={`albed-photo-item${pickedPhotoId === DEFAULT_COVER_PHOTO_ID ? ' albed-photo-item--picked' : ''}`}
                        onClick={() => setPickedPhotoId(id => id === DEFAULT_COVER_PHOTO_ID ? null : DEFAULT_COVER_PHOTO_ID)}
                        title="Carte suggérée"
                      >
                        <img src={DEFAULT_COVER_PHOTO_URL} alt="" />
                      </div>
                      {coverUploadPhotos.map(p => (
                        <div
                          key={p.id}
                          className={`albed-photo-item${pickedPhotoId === p.id ? ' albed-photo-item--picked' : ''}`}
                          onClick={() => setPickedPhotoId(id => id === p.id ? null : p.id)}
                        >
                          {photoUrls[p.id] && <img src={photoUrls[p.id]} alt="" />}
                          <button type="button" className="albed-photo-item__del"
                            onClick={e => { e.stopPropagation(); handleRemoveUploadPhoto(p.id) }}
                            title="Retirer cette photo">✕</button>
                        </div>
                      ))}
                    </div>
                  </>
                ))}

                {coverSection('palette', 'Palette de couleurs', (
                  <div className="albcov-palette-row">
                    {COVER_PALETTES.map(p => (
                      <button
                        key={p.id} type="button" title={p.label}
                        className={`albcov-palette-sw${coverPage?.cover?.palette === p.id ? ' albcov-palette-sw--active' : ''}`}
                        style={{ background: p.theme.background }}
                        onClick={() => handleCoverPaletteChange(p.id)}
                      >
                        <span style={{ background: p.theme.primary }} />
                        <span style={{ background: p.theme.labelLiberty }} />
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`albcov-palette-sw albcov-palette-sw--reset${!coverPage?.cover?.palette ? ' albcov-palette-sw--active' : ''}`}
                      title="Palette d’origine du gabarit"
                      onClick={() => handleCoverPaletteChange(undefined)}
                    >↺</button>
                  </div>
                ), !!tpl.theme)}

                {coverSection('decor', 'Décor', (
                  <>
                    <label className="albcov-toggle">
                      <input type="checkbox" checked={!coverPage?.cover?.decorHidden}
                        onChange={handleCoverDecorToggle} />
                      <span>Afficher le décor du gabarit</span>
                    </label>
                    <div className="albcov-frame-color">
                      <input type="color"
                        value={themeColor(coverPage?.cover?.decorColor ?? tpl.colors.decor, tplTheme)}
                        onChange={e => handleCoverDecorColorChange(e.target.value)} />
                      <span>Couleur du décor</span>
                    </div>
                    <div className="albcov-field-label">Ajouter un décor</div>
                    <div className="albed-add-box-row albed-add-box-row--wrap">
                      {ADDABLE_DECOR.map(d => (
                        <button key={d.type} className="albed-add-box-btn" onClick={() => handleAddDecor(d.type)}>+ {d.label}</button>
                      ))}
                      <button className="albed-add-box-btn"
                        onClick={() => imageDecorInputRef.current?.click()} disabled={uploading}>
                        {uploading ? 'Import…' : '＋ 🖼️ Image'}
                      </button>
                    </div>
                    <p className="albed-empty-hint">
                      « 🖼️ Image » ajoute une illustration importée comme décor (autocollant,
                      tampon perso…), à placer, redimensionner et incliner librement.
                    </p>
                  </>
                ))}
              </>
            ) : (
              <>
                <p className="albed-empty-hint">
                  Le dos se compose comme la couverture : fond, palette, décor et cases libres.
                  Cliquez une case de l'aperçu pour ses réglages ; le choix du gabarit de dos est
                  dans le panneau de droite.
                </p>

                {coverSection(
                  'selection',
                  `Élément sélectionné${selectedBox ? ' — ' + (selectedBox.kind === 'photo' ? 'Photo' : selectedBox.kind === 'decor' ? 'Décor' : 'Texte') : ''}`,
                  <>
                    {renderSelectedElementPanel()}
                    {selectedBox?.kind === 'text' && renderTextStylePanel()}
                  </>,
                  !!selectedBox,
                )}

                {backCoverPage?.cover?.bgImage && (
                  <p className="albed-empty-hint">
                    Gabarit importé : l'image occupe tout le dos. Ajoutez vos textes avec « + Texte ».
                  </p>
                )}

                {coverSection('bg', 'Fond', (
                  <div className="albcov-frame-color">
                    <input type="color"
                      value={themeColor(backCoverPage?.cover?.bg ?? backTpl.background, backTplTheme)}
                      onChange={e => handleBackBgChange(e.target.value)} />
                    <button type="button" className={!backCoverPage?.cover?.bg ? 'active' : ''}
                      onClick={() => handleBackBgChange(undefined)}>Défaut</button>
                  </div>
                ))}

                {!backCoverPage?.cover?.bgImage && (
                  <p className="albed-empty-hint">
                    Les textes se saisissent directement sur l'aperçu (cliquez le titre, l'accroche…) ;
                    les réglages de police / couleur / taille sont ci-dessous.
                  </p>
                )}
                {coverSection('title', 'Titre', renderCoverElControls('title', 'back'), !backCoverPage?.cover?.bgImage)}
                {coverSection('eyebrow', 'Sur-titre', renderCoverElControls('eyebrow', 'back'), !!backTpl.elements.eyebrow && !backCoverPage?.cover?.bgImage)}
                {coverSection('body', 'Texte / accroche', renderCoverElControls('body', 'back'), !!backTpl.elements.body && !backCoverPage?.cover?.bgImage)}
                {coverSection('dates', 'Pied de page', renderCoverElControls('dates', 'back'), !backCoverPage?.cover?.bgImage)}

                {coverSection('palette', 'Palette de couleurs', (
                  <div className="albcov-palette-row">
                    {COVER_PALETTES.map(p => (
                      <button
                        key={p.id} type="button" title={p.label}
                        className={`albcov-palette-sw${backCoverPage?.cover?.palette === p.id ? ' albcov-palette-sw--active' : ''}`}
                        style={{ background: p.theme.background }}
                        onClick={() => handleBackPaletteChange(p.id)}
                      >
                        <span style={{ background: p.theme.primary }} />
                        <span style={{ background: p.theme.labelLiberty }} />
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`albcov-palette-sw albcov-palette-sw--reset${!backCoverPage?.cover?.palette ? ' albcov-palette-sw--active' : ''}`}
                      title="Palette d’origine du gabarit"
                      onClick={() => handleBackPaletteChange(undefined)}
                    >↺</button>
                  </div>
                ), !!backTpl.theme)}

                {coverSection('decor', 'Décor', (
                  <>
                    <label className="albcov-toggle">
                      <input type="checkbox" checked={!backCoverPage?.cover?.decorHidden}
                        onChange={handleBackDecorToggle} />
                      <span>Afficher le décor du gabarit</span>
                    </label>
                    <div className="albcov-frame-color">
                      <input type="color"
                        value={themeColor(backCoverPage?.cover?.decorColor ?? backTpl.colors.decor, backTplTheme)}
                        onChange={e => handleBackDecorColorChange(e.target.value)} />
                      <span>Couleur du décor</span>
                    </div>
                    <div className="albcov-field-label">Ajouter un décor</div>
                    <div className="albed-add-box-row albed-add-box-row--wrap">
                      {ADDABLE_DECOR.map(d => (
                        <button key={d.type} className="albed-add-box-btn" onClick={() => handleAddBackDecor(d.type)}>+ {d.label}</button>
                      ))}
                      <button className="albed-add-box-btn"
                        onClick={() => backImageDecorInputRef.current?.click()} disabled={uploading}>
                        {uploading ? 'Import…' : '＋ 🖼️ Image'}
                      </button>
                    </div>
                  </>
                ))}

                {coverSection('photos', 'Photos - Texte à ajouter', (
                  <>
                    <div className="albed-add-box-row">
                      <button className="albed-add-box-btn" onClick={handleAddPhotoBox}>+ Photo</button>
                      <button className="albed-add-box-btn" onClick={handleAddTextBox}>+ Texte</button>
                    </div>
                    {pickedPhotoId && (
                      <div className="albed-panel-label">Cliquez une case-photo pour la placer</div>
                    )}
                    <button className="albed-add-box-btn" onClick={() => photoInputRef.current?.click()} disabled={uploading}>
                      {uploading ? 'Chargement…' : '📷 Charger des photos'}
                    </button>
                    <div className="albed-photo-list">
                      {coverUploadPhotos.map(p => (
                        <div
                          key={p.id}
                          className={`albed-photo-item${pickedPhotoId === p.id ? ' albed-photo-item--picked' : ''}`}
                          onClick={() => setPickedPhotoId(id => id === p.id ? null : p.id)}
                        >
                          {photoUrls[p.id] && <img src={photoUrls[p.id]} alt="" />}
                          <button type="button" className="albed-photo-item__del"
                            onClick={e => { e.stopPropagation(); handleRemoveUploadPhoto(p.id) }}
                            title="Retirer cette photo">✕</button>
                        </div>
                      ))}
                      {coverUploadPhotos.length === 0 && <p className="albed-empty-hint">Chargez des photos avec le bouton ci-dessus pour les placer sur le dos.</p>}
                    </div>
                  </>
                ))}
              </>
            )}
          </div>

          <div className="albed-center">
            {wrapSpread ? (
              <div
                className="albed-preview--wrap"
                style={{
                  aspectRatio: `${wrapSpread.sheetCm.w} / ${wrapSpread.sheetCm.h}`,
                  '--albwrap-sheet-w-px': `${wrapSpread.sheetCm.w / 2.54 * 96}px`,
                } as React.CSSProperties}
              >
                <div
                  className="asp2-a4 asp2-a4--wrap asp2-a4--wrap-edit"
                  style={{
                    width: `${wrapSpread.sheetCm.w}cm`,
                    height: `${wrapSpread.sheetCm.h}cm`,
                    '--albwrap-spine': `${wrapSpread.spineCm}cm`,
                    '--albwrap-bleed': `${wrapSpread.bleedCm}cm`,
                    '--albwrap-cover-bg': themeColor(coverPage?.cover?.bg ?? tpl.background, tplTheme),
                    ...(pageCm
                      ? (b => ({ '--albwrap-cover-w': `${b.w}cm`, '--albwrap-cover-h': `${b.h}cm` }))(
                          wrapCoverBoxCm(wrapSpread.sheetCm, wrapSpread.spineCm, wrapSpread.bleedCm, pageCm),
                        )
                      : {}),
                  } as React.CSSProperties}
                >
                  <div
                    className={`albwrap-half albwrap-half--back${activeSide === 'backcover' ? ' albwrap-half--active' : ''}`}
                    onClick={() => setActiveSide('backcover')}
                  >
                    {backCanvasNode}
                  </div>
                  <div className="albwrap-spine" aria-hidden="true" />
                  <div
                    className={`albwrap-half albwrap-half--front${activeSide === 'cover' ? ' albwrap-half--active' : ''}`}
                    onClick={() => setActiveSide('cover')}
                  >
                    {coverNode}
                  </div>
                  <div className="albwrap-editguide" aria-hidden="true" />
                </div>
                <div className="albwrap-ovl albwrap-ovl--back" aria-hidden="true">4e de couverture</div>
                <div className="albwrap-ovl albwrap-ovl--spine" aria-hidden="true">
                  Dos {Math.round(wrapSpread.spineCm * 100) / 10} mm
                </div>
                <div className="albwrap-ovl albwrap-ovl--front" aria-hidden="true">1re de couverture</div>
              </div>
            ) : activeSide === 'cover' && coverPage ? (
              <div className="albed-preview">{coverNode}</div>
            ) : backCoverPage ? (
              <div className="albed-preview">{backCanvasNode}</div>
            ) : null}
          </div>

          <div className="albed-right">
            <button
              type="button"
              className="albed-add-box-btn albcov-undo-btn"
              onClick={handleUndo}
              disabled={!canUndo}
              title="Annule la dernière modification (import de gabarit, changement de modèle, suppression de case…). Raccourci : Ctrl+Z."
            >
              ↶ Annuler la dernière modification
            </button>
            {activeSide === 'backcover' ? (
              backCoverPage ? (
              <>
                <div className="albed-panel-label">Gabarit de dos</div>
                <button
                  type="button"
                  className="albed-add-box-btn albcov-reset-layout"
                  onClick={handleResetBackToBaseTemplate}
                  title="Abandonne les personnalisations et l'éventuel gabarit importé pour retrouver la maquette d'origine du gabarit de dos."
                >
                  ↩︎ Revenir au modèle initial
                </button>

                <div className="albed-layout-grid albed-layout-grid--cover">
                  {BACK_COVER_TEMPLATE_PICKER.map(t => {
                    const preview = withBackTemplateLayout(backCoverPage, t.id)
                    const active = !backCoverPage.cover?.tplRef
                      && (backCoverPage.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE) === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`albcov-tpl-btn${active ? ' albcov-tpl-btn--active' : ''}`}
                        onClick={() => handleChooseBackTemplate(t.id)}
                        title={t.label}
                      >
                        <div className="albcov-tpl-btn__thumb">
                          <AlbumCoverContent
                            template={t.id}
                            cover={preview.cover}
                            boxes={preview.boxes}
                            photoUrls={photoUrls}
                          />
                        </div>
                        <span className="albcov-tpl-btn__label">{t.label}</span>
                      </button>
                    )
                  })}
                  {userBackTemplates.map(t => {
                    const preview = applyUserBackCoverTemplate(backCoverPage, t)
                    return (
                      <div
                        key={t.id}
                        className={`albcov-tpl-btn albcov-tpl-btn--user${t.auto ? ' albcov-tpl-btn--auto' : ''}${backCoverPage.cover?.tplRef === t.id ? ' albcov-tpl-btn--active' : ''}`}
                      >
                        <button
                          type="button" className="albcov-tpl-btn__pick"
                          onClick={() => handleChooseBackTemplate(t.id)}
                          title={t.auto ? `${t.label} — mise en page sauvegardée automatiquement avant un import de gabarit` : t.label}
                        >
                          <div className="albcov-tpl-btn__thumb">
                            <AlbumCoverContent
                              template={preview.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE}
                              cover={preview.cover}
                              boxes={preview.boxes}
                              photoUrls={photoUrls}
                            />
                          </div>
                          <span className="albcov-tpl-btn__label">{t.auto ? `⤺ ${t.label}` : t.label}</span>
                        </button>
                        <button
                          type="button" className="albcov-tpl-btn__del"
                          onClick={() => handleDeleteUserBackTemplate(t.id)}
                          title={t.auto ? 'Oublier ce snapshot' : 'Supprimer ce gabarit'}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
                {savingBackTplName === null ? (
                  <>
                    <button
                      type="button" className="albed-add-box-btn"
                      onClick={() => backBgInputRef.current?.click()} disabled={uploading}
                      title="Ajoute une image (dos dessiné ailleurs, fond, texture…) comme gabarit de dos : elle occupe tout le dos. Le gabarit précédent reste proposé."
                    >
                      {uploading ? 'Import…' : '📥 Importer un gabarit'}
                    </button>
                    <button
                      type="button" className="albed-add-box-btn"
                      onClick={() => setSavingBackTplName('')}
                      title="Enregistre la mise en page courante du dos comme nouveau gabarit réutilisable (bibliothèque distincte de celle de la couverture)."
                    >
                      ＋ Enregistrer comme gabarit
                    </button>
                  </>
                ) : (
                  <div className="albcov-save-tpl">
                    <input
                      type="text" autoFocus placeholder="Nom du gabarit de dos"
                      value={savingBackTplName}
                      onChange={e => setSavingBackTplName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && savingBackTplName.trim()) handleSaveBackAsTemplate(savingBackTplName)
                        if (e.key === 'Escape') setSavingBackTplName(null)
                      }}
                    />
                    <button
                      type="button" disabled={!savingBackTplName.trim()}
                      onClick={() => handleSaveBackAsTemplate(savingBackTplName)}
                    >OK</button>
                    <button type="button" onClick={() => setSavingBackTplName(null)}>Annuler</button>
                  </div>
                )}
                <p className="albed-empty-hint">
                  Bibliothèque de gabarits de dos, distincte de celle de la couverture : un gabarit
                  enregistré ici n'apparaît pas côté couverture, et inversement. Gardée sur cet appareil.
                </p>
              </>
              ) : null
            ) : coverPage ? (
              <>
                <div className="albed-panel-label">Gabarit de couverture</div>
                <button
                  type="button"
                  className="albed-add-box-btn albcov-reset-layout"
                  onClick={handleResetToBaseTemplate}
                  title="Abandonne les personnalisations et l'éventuel gabarit importé pour retrouver la maquette d'origine du modèle intégré (textes et photos conservés)."
                >
                  ↩︎ Revenir au modèle initial
                </button>

                <div className="albed-layout-grid albed-layout-grid--cover">
                  {COVER_TEMPLATE_PICKER.map(t => {
                    // Vignette = exactement ce qu'on obtient en choisissant ce gabarit : le
                    // contenu actuel rangé selon sa maquette (mêmes textes, mêmes photos, carte).
                    const preview = withTemplateLayout(coverPage, t.id)
                    const active = !coverPage.cover?.tplRef
                      && (coverPage.coverTemplate ?? DEFAULT_COVER_TEMPLATE) === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`albcov-tpl-btn${active ? ' albcov-tpl-btn--active' : ''}`}
                        onClick={() => handleChooseCoverTemplate(t.id)}
                        title={t.label}
                      >
                        <div className="albcov-tpl-btn__thumb">
                          <AlbumCoverContent
                            template={t.id}
                            cover={preview.cover}
                            boxes={preview.boxes}
                            photoUrls={photoUrls}
                            mapUrl={resolveCoverMapUrl(preview, photoUrls)}
                          />
                        </div>
                        <span className="albcov-tpl-btn__label">{t.label}</span>
                      </button>
                    )
                  })}
                  {userTemplates.map(t => {
                    const preview = applyUserCoverTemplate(coverPage, t)
                    return (
                      <div
                        key={t.id}
                        className={`albcov-tpl-btn albcov-tpl-btn--user${t.auto ? ' albcov-tpl-btn--auto' : ''}${coverPage.cover?.tplRef === t.id ? ' albcov-tpl-btn--active' : ''}`}
                      >
                        <button
                          type="button" className="albcov-tpl-btn__pick"
                          onClick={() => handleChooseCoverTemplate(t.id)}
                          title={t.auto ? `${t.label} — mise en page sauvegardée automatiquement avant un import de gabarit` : t.label}
                        >
                          <div className="albcov-tpl-btn__thumb">
                            <AlbumCoverContent
                              template={preview.coverTemplate ?? DEFAULT_COVER_TEMPLATE}
                              cover={preview.cover}
                              boxes={preview.boxes}
                              photoUrls={photoUrls}
                              mapUrl={resolveCoverMapUrl(preview, photoUrls)}
                            />
                          </div>
                          <span className="albcov-tpl-btn__label">{t.auto ? `⤺ ${t.label}` : t.label}</span>
                        </button>
                        <button
                          type="button" className="albcov-tpl-btn__del"
                          onClick={() => handleDeleteUserTemplate(t.id)}
                          title={t.auto ? 'Oublier ce snapshot' : 'Supprimer ce gabarit'}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
                {savingTplName === null ? (
                  <>
                    <button
                      type="button" className="albed-add-box-btn"
                      onClick={() => bgInputRef.current?.click()} disabled={uploading}
                      title="Ajoute une image (couverture dessinée ailleurs, fond, texture…) comme gabarit de plus : elle occupe toute la couverture. Le gabarit précédent reste proposé."
                    >
                      {uploading ? 'Import…' : '📥 Importer un gabarit'}
                    </button>
                    <button
                      type="button" className="albed-add-box-btn"
                      onClick={() => setSavingTplName('')}
                      title="Enregistre la mise en page courante (positions, tailles, décors, couleurs) comme nouveau gabarit réutilisable."
                    >
                      ＋ Enregistrer comme gabarit
                    </button>
                  </>
                ) : (
                  <div className="albcov-save-tpl">
                    <input
                      type="text" autoFocus placeholder="Nom du gabarit"
                      value={savingTplName}
                      onChange={e => setSavingTplName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && savingTplName.trim()) handleSaveAsTemplate(savingTplName)
                        if (e.key === 'Escape') setSavingTplName(null)
                      }}
                    />
                    <button
                      type="button" disabled={!savingTplName.trim()}
                      onClick={() => handleSaveAsTemplate(savingTplName)}
                    >OK</button>
                    <button type="button" onClick={() => setSavingTplName(null)}>Annuler</button>
                  </div>
                )}
                <p className="albed-empty-hint">
                  Les gabarits (importés ou enregistrés) sont gardés sur cet appareil et proposés
                  côte à côte : passez de l'un à l'autre en cliquant leur vignette, retirez-en un
                  avec sa croix. Les entrées « ⤺ Compo avant import » sont des sauvegardes
                  automatiques de votre mise en page, posées juste avant chaque import de gabarit.
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
