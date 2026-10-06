/** Enregistrement de fichier généré côté client (sauvegarde JSON, export PDF, GPX…), avec choix
 * de l'emplacement quand le navigateur le permet — mutualisé pour éviter les implémentations
 * copiées-collées (voir historique de voyageDB.ts). */

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}
interface FileSystemWritableStreamLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableStreamLike>
}

export interface SaveFileKind {
  mimeType: string
  extension: string
  description: string
  /** Nom/type utilisés pour le partage si différents (Chrome restreint canShare() à une liste
   * fixe d'extensions "sûres" qui exclut .json — voir shareSaveLocation ci-dessous). */
  shareMimeType?: string
  shareExtension?: string
}

// Propose à l'utilisateur de choisir où enregistrer le fichier (ex. son dossier pCloud/Drive/
// OneDrive synchronisé) ; retombe sur le téléchargement classique si l'API n'est pas supportée
// (Firefox, Safari, WebView Android/Capacitor).
async function pickSaveLocation(blob: Blob, suggestedName: string, kind: SaveFileKind): Promise<'saved' | 'cancelled' | 'unsupported'> {
  const showSaveFilePicker = (window as unknown as {
    showSaveFilePicker?: (opts: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>
  }).showSaveFilePicker
  if (!showSaveFilePicker) return 'unsupported'
  try {
    const handle = await showSaveFilePicker({
      suggestedName,
      types: [{ description: kind.description, accept: { [kind.mimeType]: [kind.extension] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return 'saved'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

// showSaveFilePicker n'existe pas sur Android (Chrome mobile, PWA installée comprise) : sans
// alternative, le fichier atterrit toujours directement dans Téléchargements sans choix possible.
// Le partage natif (menu "Enregistrer dans…"/"Partager avec…" d'Android), lui, y est disponible et
// permet de choisir n'importe quelle appli cible — dont les applis de stockage cloud (pCloud, Drive…).
async function shareSaveLocation(blob: Blob, suggestedName: string, kind: SaveFileKind): Promise<'saved' | 'cancelled' | 'unsupported'> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
    share?: (data: { files: File[] }) => Promise<void>
  }
  if (!nav.share || !nav.canShare) return 'unsupported'
  const shareExt = kind.shareExtension ?? kind.extension
  const shareMime = kind.shareMimeType ?? kind.mimeType
  const shareName = suggestedName.replace(new RegExp(`\\${kind.extension}$`), shareExt)
  const file = new File([blob], shareName, { type: shareMime })
  if (!nav.canShare({ files: [file] })) return 'unsupported'
  try {
    await nav.share({ files: [file] })
    return 'saved'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

// Les noms de tracé/voyage sont du texte libre saisi par l'utilisateur : `/` casserait
// l'écriture en cache Android (Filesystem.writeFile l'interprète comme un sous-dossier), et les
// autres caractères listés sont interdits ou problématiques sur Windows/macOS.
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim()
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// APK Capacitor (Android) : showSaveFilePicker n'existe pas et le WebView ne partage pas les
// fichiers via navigator.share (canShave({files}) est faux) — un <a download> y est de toute
// façon inerte. On écrit donc le fichier dans le cache de l'appli puis on ouvre la feuille de
// partage native (« Enregistrer dans Fichiers », pCloud, Drive, envoyer vers OsmAnd…).
// Le FileProvider de l'appli (AndroidManifest, @xml/file_paths avec cache-path) rend le cache
// partageable ; @capacitor/share convertit le file:// en content:// avec les droits.
export async function saveViaCapacitor(blob: Blob, filename: string): Promise<'saved' | 'cancelled' | 'unsupported'> {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const data = await blobToBase64(blob)
    const written = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
    try {
      await Share.share({ url: written.uri, title: filename, dialogTitle: 'Enregistrer / partager' })
      return 'saved'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // L'utilisateur a fermé la feuille de partage sans choisir de cible.
      if (/cancel|abort|dismiss/i.test(msg)) return 'cancelled'
      console.error('[saveFile] partage natif échoué :', msg)
      return 'unsupported'
    }
  } catch (e) {
    console.error('[saveFile] écriture cache échouée :', e instanceof Error ? e.message : String(e))
    return 'unsupported'
  }
}

function downloadDirectly(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** À appeler depuis un gestionnaire de clic direct (pas après un await) : showSaveFilePicker et
 * navigator.share exigent tous deux un geste utilisateur récent ("transient activation", ~quelques
 * secondes sous Chrome/Android) — si le fichier a été préparé par un traitement long, ce geste a
 * expiré et l'appel échoue silencieusement, d'où la séparation habituelle en deux étapes côté
 * appelant (préparer, puis un second clic pour enregistrer). */
export async function saveFileWithPicker(blob: Blob, suggestedName: string, kind: SaveFileKind): Promise<'saved' | 'cancelled'> {
  // APK Android d'abord : c'est le seul chemin qui marche dans le WebView natif.
  let result = await saveViaCapacitor(blob, suggestedName)
  if (result === 'unsupported') result = await pickSaveLocation(blob, suggestedName, kind)
  if (result === 'unsupported') result = await shareSaveLocation(blob, suggestedName, kind)
  if (result === 'cancelled') return 'cancelled'
  if (result === 'unsupported') downloadDirectly(blob, suggestedName)
  return 'saved'
}
