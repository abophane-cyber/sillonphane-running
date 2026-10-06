import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComposedAlbumPage } from '../types'
import { sanitizeTrackPages, createSummaryPage, resolvePageBoxes, resolveCoverMapUrl } from '../lib/albumPages'
import { DEFAULT_COVER_TEMPLATE, DEFAULT_BACK_COVER_TEMPLATE } from '../lib/coverTemplates'
import { AlbumSpreadContent } from './AlbumSpread'
import { AlbumComposedPageContent } from './AlbumComposedPage'
import { AlbumCoverContent } from './AlbumCover'
import type { SelectedTrack } from './AlbumPage'
import { waitForImages } from '../lib/printReady'
import { collectPrintPageEls, preparePdf, DEFAULT_ALBUM_PAGE_CM, type PreparedPdf } from '../lib/clientPdfExport'
import { saveFileWithPicker, sanitizeFilename } from '../lib/saveFile'
import { AlbumWrapCoverContent } from './AlbumWrapCover'
import { BackupOverlay, type BackupProgress } from './BackupOverlay'
import { PrintOfferOverlay } from './PrintOfferOverlay'
import { pagesToPad, type CoverMode } from '../lib/printProfiles'

interface Props {
  entries: SelectedTrack[]
  photoUrls: Record<string, string>
  coverPage?: ComposedAlbumPage
  backCoverPage?: ComposedAlbumPage
  /** Taille de page du voyage exporté (cm, l × h) ; absent = défaut Flexilivre A4. */
  pageCm?: { w: number; h: number }
  /** Comment placer couverture + dos ; absent = 2 pages au début (comportement historique). */
  coverMode?: CoverMode
  /** Contraintes de pagination du profil d'imprimeur (album complet seulement). */
  pageCount?: { min?: number; multipleOf?: number }
  /** wrap-spread : dimensions de la feuille de couverture (cm) + largeur de dos, du profil. */
  coverSpread?: { sheetCm: { w: number; h: number }; spineCm: number; bleedCm: number }
  /** Libellé de la barre de titre ; absent = « Album — N étapes » / « Couverture & dos ».
   * Sert au traitement par lot (« Regénération 2/5 — … »). */
  title?: string
  /** Imprimeur du profil (voir PrintProfile.partnerId) — transmis à PrintOfferOverlay pour ne
   * proposer que ce service après l'export. */
  printPartnerId?: string
  /** Album de la rando d'exemple : PrintOfferOverlay n'affiche pas de code de réduction. */
  demo?: boolean
  onBack: () => void
  /** Mode cache : au lieu de proposer l'enregistrement à l'utilisateur, transmet directement le
   * blob généré (destiné à trackPdfCache/coverPdfCache dans voyageDB.ts) puis revient en arrière —
   * utilisé pour générer le PDF d'une seule étape ou de la couverture depuis la liste des étapes. */
  onCacheReady?: (blob: Blob) => void | Promise<void>
  /** Après enregistrement réussi du PDF, à la place de l'offre d'impression : enchaîne sur le
   * fichier suivant (WhiteWall : couverture, puis pages intérieures). */
  onSaved?: () => void
}

/** Pages d'un tracé, avec page résumé garantie (comme dans l'éditeur de composition). */
function pagesForTrack(track: SelectedTrack['track']): ComposedAlbumPage[] {
  const migrated = sanitizeTrackPages(track.albumPages ?? [])
  if (migrated.length === 0) return [createSummaryPage()]
  if (!migrated.some(p => p.kind === 'summary')) return [createSummaryPage(), ...migrated]
  return migrated
}

/** Assemble et exporte en PDF l'album de plusieurs tracés — ordre et sélection déjà faits sur
 * l'écran précédent (Créer mon album-photo), donc on part directement sur la génération plutôt
 * que de demander une seconde fois d'ordonner/exclure des étapes. */
export function MultiAlbumExport({ entries, photoUrls, coverPage, backCoverPage, pageCm, coverMode = 'separate-pages', pageCount, coverSpread, title, printPartnerId, demo = false, onBack, onCacheReady, onSaved }: Props) {
  // Feuille de couverture « wrap » d'un tenant : uniquement quand on exporte la couverture seule
  // (aucune étape) avec un profil wrap-spread qui fournit les dimensions.
  const renderWrapCover = coverMode === 'wrap-spread' && entries.length === 0 && !!coverSpread && (!!coverPage || !!backCoverPage)
  const includeCover = !!coverPage || !!backCoverPage
  // Pages figées une fois pour toutes : pagesForTrack() appelle createSummaryPage() (id aléatoire)
  // quand un tracé n'a pas de page résumé enregistrée. Sans mémoïsation, chaque re-rendu (le
  // premier `setPdfProgress` suffit) régénérait ces ids → nouvelle `key` → React remontait les
  // `.albprint-page`, détachant les nœuds que html2canvas s'apprêtait à rasteriser (« Unable to
  // find element in cloned iframe », puis PDF d'une page blanche mis en cache).
  const trackPages = useMemo(
    () => entries.map(e => ({ ...e, pages: pagesForTrack(e.track) })),
    [entries],
  )
  const [generating, setGenerating] = useState(false)
  const [pdfProgress, setPdfProgress] = useState<BackupProgress | null>(null)
  const [preparedPdf, setPreparedPdf] = useState<PreparedPdf | null>(null)
  const [showPrintOffer, setShowPrintOffer] = useState(false)

  // Résolveurs des promesses "carte prête" / "météo prête" par tracé — remplis juste avant le
  // montage des pages d'impression, résolus par AlbumSpreadContent une fois les tuiles/le tracé
  // peints (onMapIdle) et la requête météo terminée (onWeatherReady).
  const mapReadyResolvers = useRef<Map<string, () => void>>(new Map())
  const weatherReadyResolvers = useRef<Map<string, () => void>>(new Map())
  function resolveMapReady(trackId: string) {
    mapReadyResolvers.current.get(trackId)?.()
  }
  function resolveWeatherReady(trackId: string) {
    weatherReadyResolvers.current.get(trackId)?.()
  }

  // `isCancelled` : fourni par l'effet de montage. En StrictMode (dev) l'effet est joué deux fois
  // (montage → démontage → remontage) ; sans ce garde-fou, le premier passage continuait sa chaîne
  // de promesses après le démontage et rasterisait des `.albprint-page` déjà détachées (html2canvas
  // « Unable to find element in cloned iframe ») ou une liste vide (PDF d'une seule page blanche,
  // mis en cache tel quel). On ignore alors silencieusement ce passage périmé.
  async function runClientExport(isCancelled: () => boolean) {
    try {
      const prepared = await preparePdf(
        collectPrintPageEls(),
        entries.length === 0
          ? 'Couverture.pdf'
          : `${coverMode === 'wrap-spread' ? 'Pages intérieures' : 'Album'} — ${sanitizeFilename(entries.map(e => e.track.name).join(' + ')) || 'Album'}.pdf`,
        (done: number, total: number) => { if (!isCancelled()) setPdfProgress({ done, total }) },
        renderWrapCover ? coverSpread!.sheetCm : pageCm,
      )
      if (isCancelled()) return
      setPdfProgress(null)
      if (onCacheReady) {
        // La navigation est laissée à onCacheReady (cible suivante d'un lot, ou retour à la liste),
        // pas d'appel à onBack() ici — sinon un lot s'arrêterait après le premier PDF.
        await onCacheReady(prepared.blob)
        return
      }
      setPreparedPdf(prepared)
    } catch (e) {
      if (isCancelled()) return
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
      // Une fois le PDF enregistré (mais pas en cas d'annulation ou d'échec, pour laisser
      // l'utilisateur réessayer sans repartir de zéro), on propose l'impression avant de revenir à
      // l'écran précédent.
      if (result === 'saved') {
        if (onSaved) onSaved()
        else setShowPrintOffer(true)
      }
    } catch (e) {
      console.error('[save pdf]', e)
      alert("Échec de l'enregistrement du PDF. Réessayez.")
    } finally {
      setPreparedPdf(null)
      setGenerating(false)
    }
  }

  // On génère le PDF nous-mêmes côté client (voir clientPdfExport.ts) une fois le contenu prêt, et
  // on déclenche son téléchargement directement, sans dépendre de window.print() ni de la boîte de
  // dialogue système — celle-ci reste peu fiable sur mobile (testé sur le terrain) et, sur desktop,
  // sa génération d'aperçu natif est nettement plus lente que notre export pour un album de
  // nombreuses pages.
  // Déclenché dès le montage : l'écran d'ordre/sélection précédent a disparu, cette vue attend le
  // contenu puis exporte directement.
  useEffect(() => {
    let cancelled = false
    setGenerating(true)
    mapReadyResolvers.current = new Map()
    weatherReadyResolvers.current = new Map()
    const steps: Promise<void>[] = entries.flatMap(({ track }) => [
      new Promise<void>(resolve => { mapReadyResolvers.current.set(track.id, resolve) }),
      new Promise<void>(resolve => { weatherReadyResolvers.current.set(track.id, resolve) }),
    ])
    const printRoot = document.querySelector('.albprint-pages')
    if (printRoot) steps.push(waitForImages(printRoot))
    const total = steps.length
    let done = 0
    setPdfProgress({ done: 0, total })
    steps.forEach(p => p.then(() => { if (!cancelled) setPdfProgress({ done: ++done, total }) }))

    const timeout = new Promise<void>(resolve => setTimeout(resolve, 6000))
    Promise.race([Promise.all(steps), timeout]).then(() => {
      if (cancelled) return
      setPdfProgress(null)
      runClientExport(() => cancelled)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pageEls = (() => {
        if (renderWrapCover) return [
          <div className="albprint-page" key="wrap">
            <AlbumWrapCoverContent
              coverPage={coverPage}
              backCoverPage={backCoverPage}
              photoUrls={photoUrls}
              sheetCm={coverSpread!.sheetCm}
              spineCm={coverSpread!.spineCm}
              bleedCm={coverSpread!.bleedCm}
              pageCm={pageCm ?? DEFAULT_ALBUM_PAGE_CM}
            />
          </div>,
        ]
        const coverEl = includeCover && coverPage ? (
          <div className="albprint-page" key="cover">
            <AlbumCoverContent
              template={coverPage.coverTemplate ?? DEFAULT_COVER_TEMPLATE}
              cover={coverPage.cover}
              boxes={coverPage.boxes}
              photoUrls={photoUrls}
              mapUrl={resolveCoverMapUrl(coverPage, photoUrls)}
            />
          </div>
        ) : null
        const backEl = includeCover && backCoverPage ? (
          <div className="albprint-page" key="back">
            <AlbumCoverContent
              template={backCoverPage.coverTemplate ?? DEFAULT_BACK_COVER_TEMPLATE}
              cover={backCoverPage.cover}
              boxes={backCoverPage.boxes}
              photoUrls={photoUrls}
              mapUrl={resolveCoverMapUrl(backCoverPage, photoUrls)}
            />
          </div>
        ) : null
        const trackEls = trackPages.flatMap(({ voyageName, track, photos, pages }) =>
          pages.map(page => (
            <div key={`${track.id}-${page.id}`} className="albprint-page">
              {page.kind === 'summary' ? (
                <AlbumSpreadContent
                  track={track}
                  voyageName={voyageName}
                  photos={photos.map(p => ({ id: p.id, url: photoUrls[p.id] })).filter(p => p.url)}
                  text={page.summaryText}
                  onMapIdle={() => resolveMapReady(track.id)}
                  onWeatherReady={() => resolveWeatherReady(track.id)}
                />
              ) : (
                <AlbumComposedPageContent
                  voyageName={page.headerSubtitle ?? voyageName}
                  trackName={page.headerTitle ?? track.name}
                  date={track.date}
                  boxes={resolvePageBoxes(page, photos, photoUrls)}
                  showHeader={page.header !== false}
                />
              )}
            </div>
          )),
        )
        // Pages blanches pour atteindre le minimum / multiple du profil — album complet seulement
        // (pas en génération d'un seul PDF étape/couverture mis en cache).
        const padCount = onCacheReady ? 0 : pagesToPad(trackEls.length, pageCount)
        const padEls = Array.from({ length: padCount }, (_, i) => (
          <div className="albprint-page" key={`pad-${i}`}><div className="asp2-a4 asp2-a4--blank" /></div>
        ))
        // wrap-spread : la couverture est livrée dans un fichier séparé → on la retire de l'album…
        // sauf s'il n'y a QUE la couverture à exporter (c'est alors ce fichier séparé).
        if (coverMode === 'wrap-spread') {
          return trackEls.length === 0 ? [coverEl, backEl] : [...trackEls, ...padEls]
        }
        // inline : couverture en 1re page, dos en dernière (après les pages intérieures).
        if (coverMode === 'inline-first-last' && trackEls.length > 0) return [coverEl, ...trackEls, ...padEls, backEl]
        // separate-pages (défaut) : couverture puis dos au début.
        return [coverEl, backEl, ...trackEls, ...padEls]
  })()

  // Nombre de pages du PDF généré — à saisir dans l'éditeur WhiteWall AVANT de pouvoir téléverser
  // le fichier intérieur. (wrap-spread + étapes = fichier intérieur ; sinon fichier complet.)
  const pageCountNum = pageEls.filter(Boolean).length // couverture / dos absents = null
  const isWrapInterior = coverMode === 'wrap-spread' && entries.length > 0 && !onCacheReady
  const isWrapCoverFile = coverMode === 'wrap-spread' && entries.length === 0

  return (
    <div className="albprint-shell">
      <div className="albprint-toolbar">
        <button className="asp2-back-btn" onClick={onBack}>← Retour</button>
        <span className="albprint-toolbar__title">
          {title ?? (entries.length > 0 ? `Album — ${entries.length} étape${entries.length > 1 ? 's' : ''}` : 'Couverture & dos')}
        </span>
        {!isWrapCoverFile && (
          <span className="albprint-toolbar__pages">
            {isWrapInterior ? 'PDF intérieur : ' : ''}{pageCountNum} page{pageCountNum > 1 ? 's' : ''}
          </span>
        )}
        {generating && <span className="albprint-toolbar__status">⏳ Génération du PDF…</span>}
      </div>
      {isWrapInterior && (
        <p className="albprint-pagehint">
          WhiteWall demande le nombre de pages <strong>avant</strong> le téléversement :
          saisissez <strong>{pageCountNum}</strong> dans l'éditeur, puis téléversez ce PDF intérieur
          (la couverture est un fichier séparé).
        </p>
      )}
      <div className="albprint-pages">{pageEls}</div>
      {showPrintOffer && <PrintOfferOverlay onClose={onBack} partnerId={printPartnerId} demo={demo} pageNote={isWrapInterior ? `PDF intérieur : ${pageCountNum} pages — à indiquer dans l'éditeur WhiteWall avant le téléversement.` : undefined} />}
      {generating && !showPrintOffer && (
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
