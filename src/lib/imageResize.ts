function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** Redimensionne une image côté client avant envoi à l'API (coût en tokens proportionnel à la taille). */
export async function resizeImageToBase64(
  blob: Blob,
  maxDim = 1024,
  quality = 0.8,
): Promise<{ data: string; mediaType: string }> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte canvas indisponible')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const resized = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Échec de compression image')), 'image/jpeg', quality)
  })

  return { data: arrayBufferToBase64(await resized.arrayBuffer()), mediaType: 'image/jpeg' }
}
