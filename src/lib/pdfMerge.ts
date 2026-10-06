/** Fusionne plusieurs PDF déjà générés (voir trackPdfCache/coverPdfCache dans voyageDB.ts) en un
 * seul, par simple copie de pages — pas de nouveau rendu carte/météo/html2canvas, donc quasi
 * instantané même pour un album de nombreuses étapes. pdf-lib est chargé dynamiquement (comme
 * jsPDF/html2canvas dans clientPdfExport.ts) puisque seul l'export d'album en a besoin. */
export async function mergePdfBlobs(blobs: Blob[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  for (const blob of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    pages.forEach(page => merged.addPage(page))
  }
  const bytes = await merged.save()
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' })
}
