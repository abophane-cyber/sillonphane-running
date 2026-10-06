import { useEffect, useRef, useState } from 'react'
import type { ComposedAlbumPage, VoyagePhoto, VoyageTrack } from '../types'
import { getPhotoBlob } from '../lib/voyageDB'
import { sanitizeTrackPages, resolvePageBoxes } from '../lib/albumPages'
import { AlbumComposedPageContent } from './AlbumComposedPage'
import { AlbumSpreadContent } from './AlbumSpread'
import { waitForImages } from '../lib/printReady'
import { collectPrintPageEls, preparePdf, type PreparedPdf } from '../lib/clientPdfExport'
import { saveFileWithPicker, sanitizeFilename } from '../lib/saveFile'
import { BackupOverlay, type BackupProgress } from './BackupOverlay'

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>(res => { resolve = res })
  return { promise, resolve }
}

interface Props {
  voyageName: string
  trackName: string
  date?: string
  track: VoyageTrack
  pages: ComposedAlbumPage[]
  photos: VoyagePhoto[]
  /** Taille de page du voyage (cm, l × h) ; absent = défaut Flexilivre A4. */
  pageCm?: { w: number; h: number }
  onBack: () => void
}

export function AlbumPrintView({ voyageName, trackName, date, track, pages, photos, pageCm, onBack }: Props) {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [pdfProgress, setPdfProgress] = useState<BackupProgress | null>(null)
  const [preparedPdf, setPreparedPdf] = useState<PreparedPdf | null>(null)
  const photosReady = useRef(createDeferred())
  const mapReadyResolver = useRef<(() => void) | null>(null)
  const weatherReadyResolver = useRef<(() => void) | null>(null)
  const sanitizedPages = sanitizeTrackPages(pages)
  const hasSummaryPage = sanitizedPages.some(p => p.kind === 'summary')

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    ;(async () => {
      const entries: [string, string][] = []
      for (const p of photos) {
        const blob = await getPhotoBlob(p.id)
        if (blob) {
          const url = URL.createObjectURL(blob)
          urls.push(url)
          entries.push([p.id, url])
        }
      }
      if (!cancelled) setPhotoUrls(Object.fromEntries(entries))
      photosReady.current.resolve()
    })()
    return () => {
      cancelled = true
      urls.forEach(u => URL.revokeObjectURL(u))
    }
  }, [photos])

  // On génère le PDF nous-mêmes côté client (voir clientPdfExport.ts) une fois le contenu prêt, et
  // on déclenche son téléchargement directement, sans dépendre de window.print() ni de la boîte de
  // dialogue système — celle-ci reste peu fiable sur mobile (testé sur le terrain) et, sur desktop,
  // sa génération d'aperçu natif est nettement plus lente que notre export pour un album de
  // nombreuses pages.
  function handleExport() {
    setGenerating(true)
    const steps: Promise<void>[] = [photosReady.current.promise]
    if (hasSummaryPage) {
      steps.push(new Promise<void>(resolve => { mapReadyResolver.current = resolve }))
      steps.push(new Promise<void>(resolve => { weatherReadyResolver.current = resolve }))
    }
    const printRoot = document.querySelector('.albprint-pages')
    if (printRoot) steps.push(waitForImages(printRoot))
    const total = steps.length
    let done = 0
    setPdfProgress({ done: 0, total })
    steps.forEach(p => p.then(() => setPdfProgress({ done: ++done, total })))

    const timeout = new Promise<void>(resolve => setTimeout(resolve, 6000))
    Promise.race([Promise.all(steps), timeout]).then(() => {
      setPdfProgress(null)
      runClientExport()
    })
  }

  async function runClientExport() {
    try {
      const prepared = await preparePdf(collectPrintPageEls(), `${sanitizeFilename(trackName)} — ${sanitizeFilename(voyageName)}.pdf`, (done, total) => setPdfProgress({ done, total }), pageCm)
      setPdfProgress(null)
      setPreparedPdf(prepared)
    } catch (e) {
      console.error('[export pdf]', e)
      alert("Échec de l'export PDF. Réessayez.")
      setGenerating(false)
      setPdfProgress(null)
    }
  }

  // Déclenché par un clic direct (pas après un await) : showSaveFilePicker/navigator.share
  // exigent un geste utilisateur récent, expiré si on l'appelait juste après preparePdf() — d'où
  // la séparation en deux étapes (préparer, puis un second clic pour enregistrer).
  async function handleSavePdfClick() {
    if (!preparedPdf) return
    try {
      const result = await saveFileWithPicker(preparedPdf.blob, preparedPdf.filename, {
        mimeType: 'application/pdf', extension: '.pdf', description: 'Album-photo PDF',
      })
      // On revient à l'écran précédent une fois le PDF enregistré (mais pas en cas d'annulation ou
      // d'échec, pour laisser l'utilisateur réessayer sans repartir de zéro).
      if (result === 'saved') onBack()
    } catch (e) {
      console.error('[save pdf]', e)
      alert("Échec de l'enregistrement du PDF. Réessayez.")
    } finally {
      setPreparedPdf(null)
      setGenerating(false)
    }
  }

  return (
    <div className="albprint-shell">
      <div className="albprint-toolbar">
        <button className="asp2-back-btn" onClick={onBack}>← Retour</button>
        <span className="albprint-toolbar__title">{voyageName} · {trackName}</span>
        <button className="albprint-toolbar__export" onClick={handleExport} disabled={generating}>
          {generating ? '⏳ Génération…' : '🖨 Exporter en PDF'}
        </button>
      </div>

      <div className="albprint-pages">
        {sanitizedPages.map(page => {
          return (
            <div key={page.id} className="albprint-page">
              {page.kind === 'summary' ? (
                <AlbumSpreadContent
                  track={track}
                  voyageName={voyageName}
                  photos={photos.map(p => ({ id: p.id, url: photoUrls[p.id] })).filter(p => p.url)}
                  text={page.summaryText}
                  onMapIdle={() => mapReadyResolver.current?.()}
                  onWeatherReady={() => weatherReadyResolver.current?.()}
                />
              ) : (
                <AlbumComposedPageContent
                  voyageName={page.headerSubtitle ?? voyageName}
                  trackName={page.headerTitle ?? trackName}
                  date={date}
                  boxes={resolvePageBoxes(page, photos, photoUrls)}
                  showHeader={page.header !== false}
                />
              )}
            </div>
          )
        })}
      </div>
      {generating && (
        <BackupOverlay
          label={preparedPdf ? undefined : 'Génération du PDF en cours…'}
          progress={pdfProgress}
          readyToSave={!!preparedPdf}
          onSaveClick={handleSavePdfClick}
        />
      )}
    </div>
  )
}
