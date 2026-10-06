export interface PreparedPdf { blob: Blob; filename: string }

/** Détection WebKit/Safari (desktop + iOS, y compris le WebView des apps) — hors Chrome/Chromium,
 * qui embarque « Safari » dans son UA. Sert à contourner le premier rendu blanc de html-to-image. */
function isWebKit(): boolean {
  const ua = navigator.userAgent
  return /\b(safari)\b/i.test(ua) && !/\b(chrome|crios|chromium|android)\b/i.test(ua)
}

/** Rasterise la page couverture via html-to-image (rendu par `<foreignObject>` : les ombres CSS
 * floues, les filtres et les transparences sont peints fidèlement, contrairement à html2canvas).
 * On force la taille réelle de la feuille (l'aperçu mobile la réduit par `transform: scale()`).
 * Réservé à la couverture : les pages intérieures gardent html2canvas car leur carte IGN est un
 * canvas WebGL MapLibre que `<foreignObject>` rend mal (surtout sur Safari). */
async function renderCoverCanvas(
  htmlToImage: typeof import('html-to-image'),
  el: HTMLElement,
  pixelRatio: number,
): Promise<HTMLCanvasElement> {
  // `backgroundColor` de html-to-image ÉCRASE le fond du nœud cloné : on lui redonne donc la
  // couleur de fond réelle de la couverture (beige du gabarit, palette ou surcharge), sinon blanc.
  const ownBg = (el.ownerDocument.defaultView ?? window).getComputedStyle(el).backgroundColor
  const bg = ownBg && ownBg !== 'transparent' && ownBg !== 'rgba(0, 0, 0, 0)' ? ownBg : '#ffffff'
  // Taille de MISE EN PAGE réelle du nœud (offset* ignore le `transform: scale()` de l'aperçu
  // mobile). html-to-image fige les styles calculés des enfants en px ; il faut donc capturer à
  // cette même taille, sans la forcer via `style` (sinon la racine et les enfants figés se
  // désynchronisent et les textes se décalent verticalement). On neutralise seulement le transform.
  const w = el.offsetWidth
  const h = el.offsetHeight
  const opts: Parameters<typeof htmlToImage.toCanvas>[1] = {
    width: w,
    height: h,
    pixelRatio,
    backgroundColor: bg,
    style: { transform: 'none', transformOrigin: 'top left', margin: '0' },
    // Poignées d'édition éventuelles (l'aperçu d'impression est pourtant en lecture seule).
    filter: (node: HTMLElement) => {
      const cl = node.classList
      return !cl || !(
        cl.contains('albcov-el__handle') || cl.contains('albcov-el__resize')
        || cl.contains('albcov-map__resize')
      )
    },
  }
  // Étiquettes de texte avec fond (dates façon papier déchiré…) : html-to-image ET html2canvas
  // rasterisent le contenu d'un bloc pivoté+rembourré ~1 padding trop bas. On compense en
  // remontant l'élément de son padding-top pendant la capture, puis on restaure.
  const win = el.ownerDocument.defaultView ?? window
  const boxed = Array.from(el.querySelectorAll<HTMLElement>('.albcov-el, .albcov-freebox')).filter(e => {
    const cs = win.getComputedStyle(e)
    return cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'
  })
  const restore = boxed.map(e => {
    const prev = e.style.marginTop
    // ~0,75 × padding-top compense le décalage observé (mesuré : le contenu d'un bloc pivoté +
    // rembourré est rasterisé ~10 px trop bas pour un padding-top de 13,6 px).
    const padT = parseFloat(win.getComputedStyle(e).paddingTop) || 0
    e.style.marginTop = `${-(padT * 0.75).toFixed(2)}px`
    return () => { e.style.marginTop = prev }
  })

  // Safari/WebKit : le tout premier rendu rasterise souvent le SVG avant que les images embarquées
  // soient décodées → on rend deux fois et on garde le second.
  try {
    if (isWebKit()) await htmlToImage.toCanvas(el, opts)
    return await htmlToImage.toCanvas(el, opts)
  } finally {
    restore.forEach(fn => fn())
  }
}

/** Format de page par défaut si `pageCm` n'est pas fourni : Flexilivre A4 paysage (cm). */
export const DEFAULT_ALBUM_PAGE_CM = { w: 29.7, h: 21 }

/** Génère un PDF côté client à partir de pages déjà rendues dans le DOM (les `.asp2-a4` de
 * l'aperçu d'impression), à la taille exacte `pageCm` (cm, l × h — telle que demandée par
 * l'imprimeur), sans l'enregistrer — sans passer par window.print() ni la boîte de dialogue
 * système, qui sur mobile ignore souvent l'orientation paysage et peut capturer les images/la
 * carte avant qu'elles aient fini de charger. Chaque page est rasterisée séparément une fois son
 * contenu prêt (voir printReady.ts pour l'attente en amont), donc le rendu reflète l'état réel de
 * l'écran au moment de l'export. Séparé de l'enregistrement (voir saveFile.ts) pour que le choix
 * d'emplacement (showSaveFilePicker/navigator.share) parte d'un clic frais — voir saveFileWithPicker.
 * jsPDF, html2canvas et html-to-image sont chargés dynamiquement pour ne pas alourdir le bundle
 * initial de l'appli — seuls les exports PDF mobiles en ont besoin. */
export async function preparePdf(
  pageEls: HTMLElement[],
  filename: string,
  onProgress?: (done: number, total: number) => void,
  pageCm: { w: number; h: number } = DEFAULT_ALBUM_PAGE_CM,
): Promise<PreparedPdf> {
  // Aucune page à rasteriser = appel périmé (composant démonté avant la fin, DOM déjà retiré) :
  // sans ça, jsPDF renvoyait son unique page vierge par défaut — un PDF « d'une page blanche »
  // qui finissait mis en cache tel quel.
  if (pageEls.length === 0) throw new Error('preparePdf : aucune page à exporter')
  const [{ default: jsPDF }, { default: html2canvas }, htmlToImage] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
    import('html-to-image'),
  ])
  // Taille de la feuille (cm) + clone hors-écran (px à 96 dpi = cm ÷ 2.54 × 96) — mêmes valeurs
  // que --alb-page-w/h posées par AlbumPage sur <html> pendant l'aperçu.
  const { w: pageCmW, h: pageCmH } = pageCm
  const SCALE = 1.7
  const cssPxW = pageCmW / 2.54 * 96
  const cssPxH = pageCmH / 2.54 * 96
  const cloneW = `${cssPxW.toFixed(2)}px`
  const cloneH = `${cssPxH.toFixed(2)}px`
  const doc = new jsPDF({ orientation: pageCmW >= pageCmH ? 'landscape' : 'portrait', unit: 'cm', format: [pageCmW, pageCmH], compress: true })
  onProgress?.(0, pageEls.length)
  for (let i = 0; i < pageEls.length; i++) {
    const isCover = pageEls[i].classList.contains('asp2-a4--cover')
    const canvas = isCover
      ? await renderCoverCanvas(htmlToImage, pageEls[i], SCALE)
      : await html2canvas(pageEls[i], {
        // 1.7 plutôt que 2 : ~28 % de pixels en moins à rastériser (donc plus rapide, notable sur
        // un album de nombreuses pages), pour une qualité d'impression encore largement suffisante.
        scale: SCALE, useCORS: true, backgroundColor: '#ffffff',
        onclone: (_clonedDoc, cloned) => {
          // L'aperçu mobile réduit .asp2-a4 via transform: scale(calc(100cqw / var(--alb-page-w)))
          // (voir App.css, @media max-width:860px) pour tenir dans l'écran — sans neutraliser ce
          // transform ici, html2canvas capture la page encore réduite à cette échelle (cqw mal
          // résolu hors écran) puis jsPDF étire ce rendu déjà déformé sur toute la feuille. On force
          // donc la taille et l'échelle réelles sur le clone hors-écran que html2canvas rend, sans
          // toucher à l'affichage.
          cloned.style.setProperty('width', cloneW, 'important')
          cloned.style.setProperty('height', cloneH, 'important')
          cloned.style.setProperty('aspect-ratio', 'unset', 'important')
          cloned.style.setProperty('transform', 'none', 'important')
        },
      })
    // toBlob (async, encodage déchargé du thread principal par le navigateur) + Uint8Array plutôt
    // que toDataURL : évite l'encodage base64 (~33 % de données en plus à produire et parser),
    // notable sur des canvas de cette résolution — même qualité JPEG, export plus rapide.
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
    })
    const imgData = new Uint8Array(await blob.arrayBuffer())
    if (i > 0) doc.addPage()
    doc.addImage(imgData, 'JPEG', 0, 0, pageCmW, pageCmH)
    onProgress?.(i + 1, pageEls.length)
  }
  return { blob: doc.output('blob'), filename }
}

/** Récupère les feuilles déjà montées dans l'aperçu d'impression (.albprint-pages), dans l'ordre
 * d'affichage. `> .asp2-a4` (enfant direct) et pas `.asp2-a4` : la feuille de couverture wrap
 * imbrique elle-même deux `.asp2-a4` (4e de couv + 1re de couv) qu'il ne faut pas rasteriser à
 * part. */
export function collectPrintPageEls(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.albprint-page > .asp2-a4'))
}
