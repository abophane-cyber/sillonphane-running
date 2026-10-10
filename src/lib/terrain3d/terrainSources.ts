import * as THREE from 'three'

// Sources terrain (tuiles ortho IGN + relief RGE ALTI + hydrographie BD TOPO) et
// géoréférencement, extraits sous forme paramétrée pour être partagés entre le prototype
// interactif (main.ts) et l'export vidéo hors-écran (filmExport3d.ts).
//
// NOTE (dette) : main.ts contient encore sa PROPRE copie de ces helpers (calculée au chargement
// du module à partir du TRAIL codé en dur). Ce fichier en est la version réutilisable. La
// déduplication de main.ts contre ce module est le point P5 #20 de la todolist — on ne la fait
// pas maintenant pour ne pas déstabiliser le proto interactif.

export const TILE = 256

// ─── Web Mercator / grille géographique ──────────────────────────────────────

export function lon2tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}
export function lat2tileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}
export function tileX2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}
export function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

// ─── Ordonnancement des requêtes ─────────────────────────────────────────────

// Exécute des tâches asynchrones par lots de `limit` : évite d'ouvrir 1000+ requêtes tuiles d'un
// coup (IGN throttle -> rafale de 404 -> mosaïque trouée) sur un grand tracé.
export async function runPooled(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let idx = 0
  const worker = async () => {
    while (idx < tasks.length) {
      const my = idx++
      await tasks[my]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

// Délai maximal d'une requête de tuile. Sans lui, une connexion laissée pendante par le serveur
// (IGN qui limite le débit sous forte charge) bloquait tout l'export indéfiniment en fin de
// téléchargement. Passé ce délai : échec -> réessai, puis tuile comblée comme une tuile absente.
const TILE_TIMEOUT_MS = 20_000

export function loadImage(url: string, timeoutMs = TILE_TIMEOUT_MS): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    const timer = setTimeout(() => { img.src = ''; rej(new Error('délai dépassé')) }, timeoutMs)
    img.crossOrigin = 'anonymous'
    img.onload = () => { clearTimeout(timer); res(img) }
    img.onerror = e => { clearTimeout(timer); rej(e) }
    img.src = url
  })
}

/** fetch + lecture du corps (`read`) sous délai maximal, qui respecte aussi le signal d'annulation.
 *  Le délai couvre la lecture du corps : une réponse qui s'interrompt en plein flux bloquait aussi. */
async function fetchWithTimeout<T>(
  url: string, signal: AbortSignal | undefined, read: (r: Response) => Promise<T>, timeoutMs = TILE_TIMEOUT_MS,
): Promise<T> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try { return await read(await fetch(url, { signal: ctrl.signal })) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Retry borné pour une tuile ortho (<img> : pas de code HTTP exploitable -> on réessaie sur toute
// erreur). tries = 2 -> 1 réessai : une tuile réellement hors couverture (mer, étranger) ne coûte
// qu'une requête de plus, un blip réseau est rattrapé.
async function loadImageWithRetry(url: string, signal: AbortSignal | undefined, tries = 2): Promise<HTMLImageElement> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (signal?.aborted) throw new Error('aborted')
    try {
      return await loadImage(url)
    } catch (e) {
      lastErr = e
      if (attempt < tries) await sleep(150 * attempt)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('chargement image échoué')
}

// Retry borné pour une tuile relief BIL. On réessaie sur erreur réseau, 5xx, 429 et réponse
// tronquée ; un 4xx (hors 429) = tuile hors couverture -> définitif, pas de réessai.
async function fetchElevTileBuffer(url: string, signal: AbortSignal | undefined, tries = 3): Promise<Float32Array> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (signal?.aborted) throw new Error('aborted')
    try {
      const r = await fetchWithTimeout(url, signal, async res => ({
        ok: res.ok, status: res.status, buf: res.ok ? await res.arrayBuffer() : null,
      }))
      if (!r.ok || !r.buf) {
        lastErr = new Error(`HTTP ${r.status}`)
        if (r.status < 500 && r.status !== 429) throw lastErr
      } else {
        const buf = r.buf
        if (buf.byteLength >= TILE * TILE * 4) return new Float32Array(buf, 0, TILE * TILE)
        lastErr = new Error('tuile relief tronquée')
      }
    } catch (e) {
      if (signal?.aborted) throw e
      lastErr = e
      const msg = e instanceof Error ? e.message : ''
      if (msg.startsWith('HTTP 4') && msg !== 'HTTP 429') throw e
    }
    if (attempt < tries) await sleep(200 * attempt)
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

// ─── Orthophotos IGN ─────────────────────────────────────────────────────────

export interface OrthoResult { canvas: HTMLCanvasElement; ok: boolean[]; cols: number; rows: number }

// Pas de repli sur une imagerie mondiale : Esri World Imagery retiré le 2026-10-09 (ses conditions d'utilisation ne
// couvrent pas un service public ou commercial sans compte ArcGIS). Hors couverture IGN : comblement de voisinage,
// puis teinte de repli.

// Teinte de repli peinte sous toute la mosaïque : là où le comblement de proximité ne couvre pas (très loin du tracé), on obtient un vert-gris terne qui se fond dans
// le brouillard plutôt qu'un canevas noir/transparent.
const ORTHO_VOID_TINT = '#8d978a'

// Seuil « blanc hors couverture » IGN (JPEG uniforme ~255, franges de compression un peu en dessous).
const ORTHO_BLANK_MIN = 248

/** Copie la tuile IGN dans un canevas en rendant transparents les pixels blancs hors couverture.
 *  Renvoie la part de pixels masqués (0 = tuile entièrement couverte). */
function maskBlankOrtho(img: HTMLImageElement): { tile: HTMLCanvasElement; blankFrac: number } {
  const tile = document.createElement('canvas')
  tile.width = TILE
  tile.height = TILE
  const tctx = tile.getContext('2d', { willReadFrequently: true })!
  tctx.drawImage(img, 0, 0, TILE, TILE)
  const im = tctx.getImageData(0, 0, TILE, TILE)
  const d = im.data
  let blank = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= ORTHO_BLANK_MIN && d[i + 1] >= ORTHO_BLANK_MIN && d[i + 2] >= ORTHO_BLANK_MIN) {
      d[i + 3] = 0
      blank++
    }
  }
  // Quelques pixels blancs épars (toits, névés) : tuile couverte, on la garde telle quelle.
  if (blank < TILE * TILE * 0.01) {
    tctx.drawImage(img, 0, 0, TILE, TILE)
    return { tile, blankFrac: 0 }
  }
  tctx.putImageData(im, 0, 0)
  return { tile, blankFrac: blank / (TILE * TILE) }
}

export async function fetchOrthoTiles(
  txMinP: number, tyMinP: number, nxP: number, nyP: number, zoom: number,
  signal?: AbortSignal, concurrency = 6, onTileDone?: () => void,
): Promise<OrthoResult> {
  const canvas = document.createElement('canvas')
  canvas.width = nxP * TILE
  canvas.height = nyP * TILE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = ORTHO_VOID_TINT
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const ok = new Array<boolean>(nxP * nyP).fill(false)
  /** Tuiles en échec de chargement (réseau, serveur saturé), à la différence des tuiles hors couverture. */
  const failed: [number, number][] = []
  const load = (jx: number, jy: number, tries: number, onFail: () => void) => {
    const x = txMinP + jx
    const y = tyMinP + jy
    const url = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${zoom}&TILEROW=${y}&TILECOL=${x}`
    // Tuile IGN absente (404, hors couverture) : marquée, le voisinage la comble (voir inpaintOrthoHoles).
    // Hors France (Suisse, Italie…) l'IGN ne renvoie PAS de 404 mais une tuile 200 toute blanche, et les tuiles
    // frontalières sont blanches au-delà de la frontière : ces pixels blancs sont rendus transparents (teinte de
    // repli dessous) ; une tuile plus qu'à moitié vide est laissée au comblement.
    if (signal?.aborted) return Promise.resolve()
    return loadImageWithRetry(url, signal, tries)
      .then(img => {
        const { tile, blankFrac } = maskBlankOrtho(img)
        // Tuile quasi vide (hors couverture IGN) : laissée au comblement de voisinage.
        if (blankFrac > 0.5) { console.warn(`Tuile ortho manquante (comblée) : z${zoom} ${x},${y}`); return }
        ctx.drawImage(tile, jx * TILE, jy * TILE)
        ok[jy * nxP + jx] = true
      })
      .catch(onFail)
  }
  const jobs: (() => Promise<void>)[] = []
  for (let jy = 0; jy < nyP; jy++)
    for (let jx = 0; jx < nxP; jx++)
      jobs.push(() => load(jx, jy, 2, () => failed.push([jx, jy])).finally(() => onTileDone?.()))
  await runPooled(jobs, concurrency)
  // Seconde passe sur les tuiles en échec, après une pause et à faible concurrence : le serveur IGN, sollicité par
  // le terrain détaillé et le terrain de fond en même temps, en refusait quelques-unes (aplat de teinte de repli
  // sur la vue d'ensemble, Mont Ventoux).
  if (failed.length && !signal?.aborted) {
    await sleep(800)
    await runPooled(failed.map(([jx, jy]) => () => load(jx, jy, 3, () =>
      console.warn(`Tuile ortho manquante (comblée) : z${zoom} ${txMinP + jx},${tyMinP + jy}`))), 2)
  }
  return { canvas, ok, cols: nxP, rows: nyP }
}

// (2) Comble les tuiles ortho manquantes par propagation de la couleur depuis le bord des zones
// valides (flood BFS) PUIS floute fortement la zone comblée : sans le flou, la propagation BFS
// laisse des bandes/mosaïques bien visibles (« passages très pixellisés » sur le film). Après
// flou c'est une tache douce qui se fond dans le brouillard ; l'imagerie réelle (IGN) n'est
// jamais touchée, elle reste nette.
export function inpaintOrthoHoles(canvas: HTMLCanvasElement, ok: boolean[], cols: number, rows: number): void {
  if (ok.every(Boolean)) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const W = canvas.width, H = canvas.height
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const bad = new Uint8Array(W * H)
  let nBad = 0
  for (let y = 0; y < H; y++) {
    const ty = Math.min(rows - 1, (y / TILE) | 0)
    for (let x = 0; x < W; x++) {
      const tx = Math.min(cols - 1, (x / TILE) | 0)
      if (!ok[ty * cols + tx]) { bad[y * W + x] = 1; nBad++ }
    }
  }
  if (!nBad || nBad === W * H) return
  floodFillRGB(d, W, H, bad)
  ctx.putImageData(img, 0, 0)

  // Flou de la zone comblée : down-scale ×1/6 (moyennage natif du navigateur) puis ré-échantillonnage
  // bilinéaire sur les seuls pixels `bad`. On évite de matérialiser un canvas plein W×H (mémoire).
  const sw = Math.max(1, Math.round(W / 6)), sh = Math.max(1, Math.round(H / 6))
  const small = document.createElement('canvas')
  small.width = sw; small.height = sh
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(canvas, 0, 0, sw, sh)
  const sd = sctx.getImageData(0, 0, sw, sh).data
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1.001, (y / H) * sh), y0 = fy | 0, ty2 = fy - y0
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!bad[i]) continue
      const fx = Math.min(sw - 1.001, (x / W) * sw), x0 = fx | 0, tx2 = fx - x0
      const a = (y0 * sw + x0) * 4, b = a + 4, c = a + sw * 4, e = c + 4
      const k = i * 4
      for (let ch = 0; ch < 3; ch++) {
        d[k + ch] =
          (sd[a + ch] * (1 - tx2) + sd[b + ch] * tx2) * (1 - ty2) +
          (sd[c + ch] * (1 - tx2) + sd[e + ch] * tx2) * ty2
      }
      d[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

// BFS borné (MAX_RINGS anneaux) avec file Int32Array fixe : propage la couleur depuis le bord
// des zones valides sans exploser en mémoire même quand la moitié de l'image est hors couverture.
function floodFillRGB(d: Uint8ClampedArray, W: number, H: number, bad: Uint8Array): void {
  const MAX_RINGS = 4000 // comble tout ce qui est atteignable : le maillage n'est plus découpé
  // (voir filmExport3d.ts), donc le lointain hors couverture doit recevoir une couleur plausible
  // sur toute sa surface, pas seulement une bande de 300 m près du bord valide.
  const known = Uint8Array.from(bad, v => (v ? 0 : 1))
  const queued = new Uint8Array(W * H)
  const q = new Int32Array(W * H)
  let head = 0, tail = 0
  for (let i = 0; i < W * H; i++) {
    if (!bad[i]) continue
    const x = i % W, y = (i / W) | 0
    if ((x > 0 && known[i - 1]) || (x < W - 1 && known[i + 1]) ||
        (y > 0 && known[i - W]) || (y < H - 1 && known[i + W])) { q[tail++] = i; queued[i] = 1 }
  }
  let ring = 0, ringEnd = tail
  while (head < tail && ring < MAX_RINGS) {
    const i = q[head++]
    const x = i % W, y = (i / W) | 0
    let r = 0, g = 0, b = 0, n = 0
    if (x > 0 && known[i - 1]) { r += d[(i - 1) * 4]; g += d[(i - 1) * 4 + 1]; b += d[(i - 1) * 4 + 2]; n++ }
    if (x < W - 1 && known[i + 1]) { r += d[(i + 1) * 4]; g += d[(i + 1) * 4 + 1]; b += d[(i + 1) * 4 + 2]; n++ }
    if (y > 0 && known[i - W]) { r += d[(i - W) * 4]; g += d[(i - W) * 4 + 1]; b += d[(i - W) * 4 + 2]; n++ }
    if (y < H - 1 && known[i + W]) { r += d[(i + W) * 4]; g += d[(i + W) * 4 + 1]; b += d[(i + W) * 4 + 2]; n++ }
    if (n) { d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; d[i * 4 + 3] = 255; known[i] = 1 }
    if (x > 0 && bad[i - 1] && !known[i - 1] && !queued[i - 1]) { q[tail++] = i - 1; queued[i - 1] = 1 }
    if (x < W - 1 && bad[i + 1] && !known[i + 1] && !queued[i + 1]) { q[tail++] = i + 1; queued[i + 1] = 1 }
    if (y > 0 && bad[i - W] && !known[i - W] && !queued[i - W]) { q[tail++] = i - W; queued[i - W] = 1 }
    if (y < H - 1 && bad[i + W] && !known[i + W] && !queued[i + W]) { q[tail++] = i + W; queued[i + W] = 1 }
    if (head === ringEnd) { ring++; ringEnd = tail }
  }
}

// ─── Relief RGE ALTI ─────────────────────────────────────────────────────────

export interface ElevResult {
  data: Float32Array; width: number; height: number
  /** Pixels sans relief valide APRÈS repli DEM mondial (= trous que même Terrain Tiles ne couvre
   *  pas ; comblés ensuite par inpaintElevation). Sert au brouillard « emprise trouée ». */
  origBad: Uint8Array
  /** Pixels sans relief RGE ALTI AVANT tout repli (masque brut). Sert à la détection littoral et
   *  à l'enfoncement de la mer (le repli terrarium remplit la mer par ~0, il ne faut pas la
   *  prendre pour de la terre). */
  rawBad: Uint8Array
}

// Repli DEM mondial (AWS Terrain Tiles, encodage « terrarium ») pour les pixels de relief hors
// couverture RGE ALTI (étranger, large). Grille Web Mercator z/x/y, PNG ; hauteur en mètres =
// R*256 + G + B/256 − 32768. Donne un relief réel de l'autre côté de la frontière au lieu d'une
// pente lissée extrapolée du bord français. Tout échec est toléré (repli sur inpaintElevation).
const TERRARIUM_TILE = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

export async function fetchTerrariumElevation(
  minLon: number, maxLon: number, minLat: number, maxLat: number,
  zoomElev: number, signal?: AbortSignal,
): Promise<((lon: number, lat: number) => number) | null> {
  const zt = Math.min(13, Math.max(9, zoomElev - 1)) // ~19 m/px à 46°N : assez pour du lointain
  const x0 = Math.floor(lon2tileX(minLon, zt)), x1 = Math.floor(lon2tileX(maxLon, zt))
  const y0 = Math.floor(lat2tileY(maxLat, zt)), y1 = Math.floor(lat2tileY(minLat, zt))
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1
  if (nx <= 0 || ny <= 0 || nx * ny > 256) return null
  const W = nx * TILE, H = ny * TILE
  const cvs = document.createElement('canvas')
  cvs.width = W; cvs.height = H
  const cx = cvs.getContext('2d', { willReadFrequently: true })!
  let anyOk = false
  await runPooled(
    Array.from({ length: nx * ny }, (_, k) => async () => {
      if (signal?.aborted) return
      const jx = k % nx, jy = (k / nx) | 0
      try {
        const img = await loadImageWithRetry(TERRARIUM_TILE(zt, x0 + jx, y0 + jy), signal, 2)
        cx.drawImage(img, jx * TILE, jy * TILE)
        anyOk = true
      } catch { /* tuile absente -> trou toléré */ }
    }),
    6,
  )
  if (!anyOk) return null
  let px: Uint8ClampedArray
  try { px = cx.getImageData(0, 0, W, H).data } // canvas taint (CORS) -> on renonce, inpaint prend le relais
  catch { return null }
  const elev = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3]
    elev[i] = a === 0 ? NaN : px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768
  }
  const originX = x0 * TILE, originY = y0 * TILE
  return (lon: number, lat: number): number => {
    const fx = lon2tileX(lon, zt) * TILE - originX
    const fy = lat2tileY(lat, zt) * TILE - originY
    if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return NaN
    const ix = fx | 0, iy = fy | 0, tx = fx - (fx | 0), ty = fy - (fy | 0)
    const i00 = iy * W + ix
    const a = elev[i00], b = elev[i00 + 1], c = elev[i00 + W], e = elev[i00 + W + 1]
    if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(e))) return NaN
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty
  }
}

export async function fetchElevationTiles(
  ecolMin: number, erowMin: number, enx: number, eny: number, zoomElev: number,
  signal?: AbortSignal, concurrency = 5, onTileDone?: () => void,
): Promise<ElevResult> {
  const width = enx * TILE
  const height = eny * TILE
  const data = new Float32Array(width * height)
  // État de chaque tuile : 1 = chargée ; 2 = ABSENTE (4xx : l'IGN n'a pas de relief ici -> mer ou
  // étranger) ; 0 = en ÉCHEC réseau (délai dépassé, 5xx…). À ne pas confondre : une tuile en échec
  // comptée comme « sans donnée » devenait de la MER (terrain transparent, plan d'eau gris posé sur
  // la ville — vu à Concarneau un jour où l'IGN saturait).
  const tileState = new Uint8Array(enx * eny)
  const tileOk = new Array<boolean>(enx * eny).fill(false) // rempli après chargement (état 1)
  const loadTile = (jx: number, jy: number): Promise<void> => {
    const col = ecolMin + jx
    const row = erowMin + jy
    const slot = jy * enx + jx
    const url = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLE=normal&FORMAT=image/x-bil;bits=32&TILEMATRIXSET=WGS84G_6_14&TILEMATRIX=${zoomElev}&TILEROW=${row}&TILECOL=${col}`
    if (signal?.aborted) return Promise.resolve()
    return fetchElevTileBuffer(url, signal)
      .then(tile => {
        for (let ty = 0; ty < TILE; ty++) {
          const destOffset = (jy * TILE + ty) * width + jx * TILE
          data.set(tile.subarray(ty * TILE, (ty + 1) * TILE), destOffset)
        }
        tileState[slot] = 1
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : ''
        tileState[slot] = msg.startsWith('HTTP 4') && msg !== 'HTTP 429' ? 2 : 0
        if (tileState[slot] === 0) console.warn(`Tuile relief en échec : z${zoomElev} ${col},${row}`)
      })
  }
  const jobs: (() => Promise<void>)[] = []
  for (let jy = 0; jy < eny; jy++)
    for (let jx = 0; jx < enx; jx++)
      jobs.push(() => loadTile(jx, jy).finally(() => onTileDone?.()))
  await runPooled(jobs, concurrency)
  // Seconde chance pour les tuiles en échec, à faible concurrence (le serveur saturait peut-être).
  const retry: (() => Promise<void>)[] = []
  for (let jy = 0; jy < eny; jy++)
    for (let jx = 0; jx < enx; jx++)
      if (tileState[jy * enx + jx] === 0) retry.push(() => loadTile(jx, jy))
  if (retry.length) await runPooled(retry, 2)
  for (let s = 0; s < enx * eny; s++) tileOk[s] = tileState[s] === 1

  // (2) Masque des pixels sans donnée = tuiles absentes + nodata résiduel (altitude <= 0 ou non
  // finie, impossible sur du relief RGE ALTI utile).
  const origBad = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const ty = Math.min(eny - 1, (y / TILE) | 0)
    for (let x = 0; x < width; x++) {
      const tx = Math.min(enx - 1, (x / TILE) | 0)
      const i = y * width + x
      if (!tileOk[ty * enx + tx] || !Number.isFinite(data[i]) || data[i] <= 0) origBad[i] = 1
    }
  }
  let nBad = 0
  for (let i = 0; i < origBad.length; i++) nBad += origBad[i]
  // Masque brut « pas de relief IGN » (détection littoral en aval) — SAUF les tuiles en échec réseau :
  // pour elles, terre ou mer est décidé plus bas d'après le relief mondial.
  const rawBad = origBad.slice()
  const failedAt = (x: number, y: number) =>
    tileState[Math.min(eny - 1, (y / TILE) | 0) * enx + Math.min(enx - 1, (x / TILE) | 0)] === 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (failedAt(x, y)) rawBad[y * width + x] = 0

  // Repli DEM mondial AVANT le comblement de proximité : on remplace les pixels hors couverture
  // par du relief réel (Terrain Tiles) quand c'est disponible ; inpaintElevation ne traite plus
  // que le résidu. `origBad` est mis à 0 pour ces pixels -> ils comptent comme du relief valide.
  if (nBad > 0 && nBad < origBad.length) {
    const elevTileDeg = 180 / 2 ** zoomElev
    const lonMin = ecolMin * elevTileDeg - 180
    const lonMax = (ecolMin + enx) * elevTileDeg - 180
    const latMax = 90 - erowMin * elevTileDeg
    const latMin = 90 - (erowMin + eny) * elevTileDeg
    const sampler = await fetchTerrariumElevation(lonMin, lonMax, latMin, latMax, zoomElev, signal).catch(() => null)
    if (sampler) {
      for (let y = 0; y < height; y++) {
        const lat = latMax - ((y + 0.5) / height) * (latMax - latMin)
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (!origBad[i]) continue
          const lon = lonMin + ((x + 0.5) / width) * (lonMax - lonMin)
          const e = sampler(lon, lat)
          if (Number.isFinite(e) && e > -420 && e < 9000) {
            data[i] = e; origBad[i] = 0; nBad--
            if (e <= 0.5 && failedAt(x, y)) rawBad[i] = 1 // tuile en échec, mais c'est bien la mer
          }
        }
      }
    }
  }

  if (nBad > 0 && nBad < origBad.length) inpaintElevation(data, width, height, origBad)
  return { data, width, height, origBad, rawBad }
}

// (2) BFS borné : comble depuis les bords valides sur MAX_RINGS anneaux, file en Int32Array de
// taille fixe (pas de blowup mémoire quand une moitié de la zone est hors couverture).
function inpaintElevation(data: Float32Array, W: number, H: number, bad: Uint8Array): void {
  const DRIFT = 0.15 // m de descente par anneau (léger : le comblement porte maintenant loin)
  const MAX_RINGS = 4000 // comble tout ce qui est atteignable (le maillage n'est plus découpé)
  const known = Uint8Array.from(bad, v => (v ? 0 : 1))
  const queued = new Uint8Array(W * H)
  const q = new Int32Array(W * H)
  let head = 0, tail = 0
  for (let i = 0; i < W * H; i++) {
    if (!bad[i]) continue
    const x = i % W, y = (i / W) | 0
    if ((x > 0 && known[i - 1]) || (x < W - 1 && known[i + 1]) ||
        (y > 0 && known[i - W]) || (y < H - 1 && known[i + W])) { q[tail++] = i; queued[i] = 1 }
  }
  let ring = 0, ringEnd = tail
  while (head < tail && ring < MAX_RINGS) {
    const i = q[head++]
    const x = i % W, y = (i / W) | 0
    let s = 0, n = 0
    if (x > 0 && known[i - 1]) { s += data[i - 1]; n++ }
    if (x < W - 1 && known[i + 1]) { s += data[i + 1]; n++ }
    if (y > 0 && known[i - W]) { s += data[i - W]; n++ }
    if (y < H - 1 && known[i + W]) { s += data[i + W]; n++ }
    if (n) { data[i] = s / n - DRIFT; known[i] = 1 }
    if (x > 0 && bad[i - 1] && !known[i - 1] && !queued[i - 1]) { q[tail++] = i - 1; queued[i - 1] = 1 }
    if (x < W - 1 && bad[i + 1] && !known[i + 1] && !queued[i + 1]) { q[tail++] = i + 1; queued[i + 1] = 1 }
    if (y > 0 && bad[i - W] && !known[i - W] && !queued[i - W]) { q[tail++] = i - W; queued[i - W] = 1 }
    if (y < H - 1 && bad[i + W] && !known[i + W] && !queued[i + W]) { q[tail++] = i + W; queued[i + W] = 1 }
    if (head === ringEnd) { ring++; ringEnd = tail }
  }
}

// ─── Étalonnage colorimétrique de l'ortho ────────────────────────────────────

export function gradeTerrainColors(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const mx = Math.max(r, g, b)
    if (mx < 30 || mx > 236) continue // ombres profondes / blancs : on ne touche pas

    if (g >= r && g > b && g > 40) {
      // Végétation : on renforce la dominante verte.
      d[i] = r * 0.92
      d[i + 1] = Math.min(255, g * 1.09)
      d[i + 2] = b * 0.90
    } else if (r >= g && r > b) {
      // Champs (jaunes, orangés, terres nues) : on creuse la saturation.
      d[i] = Math.min(255, r * 1.06)
      d[i + 1] = Math.min(255, g * 1.01)
      d[i + 2] = b * 0.86
    }
  }
  ctx.putImageData(img, 0, 0)
}

// ─── Hydrographie vectorielle IGN (BD TOPO / WFS Géoplateforme) ──────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface HydroFeatures { surfaces: any[]; lines: any[] }

export async function fetchHydroFeatures(
  lonMin: number, lonMax: number, latMin: number, latMax: number,
  signal?: AbortSignal,
): Promise<HydroFeatures> {
  if (lonMax <= lonMin || latMax <= latMin) return { surfaces: [], lines: [] }
  const base = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&SRSNAME=CRS:84&OUTPUTFORMAT=application/json&COUNT=12000' +
    `&BBOX=${lonMin},${latMin},${lonMax},${latMax},CRS:84`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (typename: string): Promise<any[]> =>
    // Délai plus long que pour une tuile : réponse JSON volumineuse (jusqu'à 12 000 objets).
    fetchWithTimeout(`${base}&TYPENAMES=${typename}`, signal,
      r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))), 60_000)
      .then(j => (j && Array.isArray(j.features) ? j.features : []))
      .catch(() => {
        console.warn(`Hydrographie ${typename} indisponible -> non peinte`)
        return []
      })
  const [surfaces, lines] = await Promise.all([
    get('BDTOPO_V3:surface_hydrographique'),
    get('BDTOPO_V3:cours_d_eau'),
  ])
  return { surfaces, lines }
}

// Peint les features hydro sur un canvas dont on connaît l'emprise lon/lat.
export function paintHydroOnCanvas(
  canvas: HTMLCanvasElement, feats: HydroFeatures,
  lonMin: number, lonMax: number, latMin: number, latMax: number,
): void {
  const { surfaces, lines } = feats
  if (!surfaces.length && !lines.length) return

  const W = canvas.width, H = canvas.height
  const ctx = canvas.getContext('2d')!
  const X = (lon: number) => ((lon - lonMin) / (lonMax - lonMin)) * W
  const Y = (lat: number) => ((latMax - lat) / (latMax - latMin)) * H
  const WATER = '#3f6f7e' // bleu-gris naturel (le bleu franc faisait "piscine")

  const traceRing = (ring: number[][]) => {
    if (!ring || ring.length < 2) return
    ctx.moveTo(X(ring[0][0]), Y(ring[0][1]))
    for (let i = 1; i < ring.length; i++) ctx.lineTo(X(ring[i][0]), Y(ring[i][1]))
    ctx.closePath()
  }
  const tracePolygon = (poly: number[][][]) => { for (const ring of poly) traceRing(ring) }

  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.fillStyle = WATER
  ctx.beginPath()
  for (const f of surfaces) {
    const g = f && f.geometry
    if (!g) continue
    if (g.type === 'Polygon') tracePolygon(g.coordinates)
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) tracePolygon(poly)
  }
  ctx.fill('evenodd')

  ctx.globalAlpha = 0.48
  ctx.strokeStyle = WATER
  ctx.lineWidth = Math.max(1.5, W / 2600)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const drawLine = (l: number[][]) => {
    if (!l || l.length < 2) return
    ctx.moveTo(X(l[0][0]), Y(l[0][1]))
    for (let i = 1; i < l.length; i++) ctx.lineTo(X(l[i][0]), Y(l[i][1]))
  }
  for (const f of lines) {
    const g = f && f.geometry
    if (!g) continue
    if (g.type === 'LineString') drawLine(g.coordinates)
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) drawLine(l)
  }
  ctx.stroke()
  ctx.restore()
}

// ─── Normal map dérivée du DEM ───────────────────────────────────────────────

export function generateNormalMapFromDEM(
  elevGrid: { data: Float32Array; width: number; height: number },
  strength = 1.6,
): THREE.DataTexture {
  const { data, width, height } = elevGrid
  const normals = new Uint8Array(width * height * 4)
  const g = (i: number) => { const v = data[i]; return (Number.isFinite(v) && v > -500 && v < 9000) ? v : 0 }

  for (let y = 0; y < height; y++) {
    const yPrev = Math.max(0, y - 1) * width
    const yNext = Math.min(height - 1, y + 1) * width
    const yCurr = y * width

    for (let x = 0; x < width; x++) {
      const xPrev = Math.max(0, x - 1)
      const xNext = Math.min(width - 1, x + 1)

      const dzdx = (g(yCurr + xNext) - g(yCurr + xPrev)) * strength
      const dzdy = (g(yNext + x) - g(yPrev + x)) * strength

      const nx = -dzdx
      const ny = -dzdy
      const nz = 1.0

      const len = Math.hypot(nx, ny, nz)
      const idx = (y * width + x) * 4
      normals[idx] = (((nx / len) * 0.5 + 0.5) * 255) | 0
      normals[idx + 1] = (((ny / len) * 0.5 + 0.5) * 255) | 0
      normals[idx + 2] = (((nz / len) * 0.5 + 0.5) * 255) | 0
      normals[idx + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(normals, width, height, THREE.RGBAFormat)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

// ─── Jupe de terrain ─────────────────────────────────────────────────────────

export function addTerrainSkirt(geom: THREE.PlaneGeometry, depth = 400): THREE.Mesh {
  const pos = geom.attributes.position
  const res = Math.round(Math.sqrt(pos.count))
  const skirtPositions: number[] = []
  const skirtIndices: number[] = []

  function pushQuad(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const base = skirtPositions.length / 3
    skirtPositions.push(ax, ay, az, bx, by, bz, bx, -depth, bz, ax, -depth, az)
    skirtIndices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  function edgeQuad(i0: number, i1: number) {
    pushQuad(
      pos.getX(i0), pos.getY(i0), pos.getZ(i0),
      pos.getX(i1), pos.getY(i1), pos.getZ(i1),
    )
  }

  for (let ix = 0; ix < res - 1; ix++) edgeQuad(ix, ix + 1)
  for (let iz = 0; iz < res - 1; iz++) edgeQuad(iz * res + (res - 1), (iz + 1) * res + (res - 1))
  for (let ix = res - 1; ix > 0; ix--) edgeQuad((res - 1) * res + ix, (res - 1) * res + (ix - 1))
  for (let iz = res - 1; iz > 0; iz--) edgeQuad(iz * res, (iz - 1) * res)

  const skirtGeom = new THREE.BufferGeometry()
  skirtGeom.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3))
  skirtGeom.setIndex(skirtIndices)
  skirtGeom.computeVertexNormals()

  const skirtMat = new THREE.MeshStandardMaterial({ color: '#4a3c30', roughness: 1, metalness: 0, side: THREE.DoubleSide })
  const skirt = new THREE.Mesh(skirtGeom, skirtMat)
  skirt.receiveShadow = true
  return skirt
}

// ─── Géoréférencement : emprise + zoom adaptatif + projections ───────────────

export interface Coverage {
  BBOX: { minLon: number; maxLon: number; minLat: number; maxLat: number }
  ZOOM_ORTHO: number
  ZOOM_ELEV: number
  // Ortho (grille Web Mercator)
  txMin: number; tyMin: number; nx: number; ny: number
  covLonMin: number; covLonMax: number; covLatMin: number; covLatMax: number
  // Relief (grille géographique globale)
  ecolMin: number; erowMin: number; enx: number; eny: number
  // Repère local (mètres)
  lat0: number; lon0: number
  project: (lon: number, lat: number) => [number, number]
  unproject: (x: number, z: number) => [number, number]
  elevPixelForLonLat: (lon: number, lat: number) => [number, number]
}

// France métropolitaine Corse comprise (cap Corse ~9,56° E, Bonifacio ~41,37° N).
const FR_BOUNDS = { minLon: -5.3, maxLon: 9.7, minLat: 41.3, maxLat: 51.15 }
// Budget mémoire de la mosaïque ortho assemblée (mégapixels RGBA). Relevé 60 -> 84 : un tracé de
// ~12 km ne « rentrait » plus qu'en z15 (~4,8 m/px, versants flous) ; à 84 il tient en z16
// (~2,4 m/px). Transitoire ~340 Mo pendant getImageData — export desktop uniquement (OUT_W fixe).
const MAX_ORTHO_MP = 84
const MAX_ELEV_MP = 44
const MAX_TILES_SIDE = 62 // 62 * 256 < 16384 (limite de texture GPU)

// Réplique exacte du bloc de tête de main.ts (lignes ~168-378), packagé pour un tracé quelconque.
export function computeCoverage(trail: [number, number][]): Coverage {
  const lons = trail.map(p => p[0])
  const lats = trail.map(p => p[1])
  const span = Math.max(
    Math.max(...lons) - Math.min(...lons),
    Math.max(...lats) - Math.min(...lats),
  )
  const PAD = Math.min(0.045, Math.max(0.014, span * 0.18))
  // Le cadre France ne rogne que la marge, jamais le tracé lui-même : un tracé hors cadre (étranger,
  // frontière) garde son emprise (comblée hors couverture IGN) au lieu d'une emprise inversée -> nx/ny négatifs.
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons)
  const latMin = Math.min(...lats), latMax = Math.max(...lats)
  const BBOX = {
    minLon: Math.min(lonMin, Math.max(FR_BOUNDS.minLon, lonMin - PAD)),
    maxLon: Math.max(lonMax, Math.min(FR_BOUNDS.maxLon, lonMax + PAD)),
    minLat: Math.min(latMin, Math.max(FR_BOUNDS.minLat, latMin - PAD)),
    maxLat: Math.max(latMax, Math.min(FR_BOUNDS.maxLat, latMax + PAD)),
  }

  const tileGrid = (z: number, isElev: boolean): { nx: number; ny: number } => {
    if (isElev) {
      const deg = 180 / 2 ** z
      const c0 = Math.floor((BBOX.minLon + 180) / deg)
      const c1 = Math.floor((BBOX.maxLon + 180) / deg)
      const r0 = Math.floor((90 - BBOX.maxLat) / deg)
      const r1 = Math.floor((90 - BBOX.minLat) / deg)
      return { nx: c1 - c0 + 1, ny: r1 - r0 + 1 }
    }
    const x0 = Math.floor(lon2tileX(BBOX.minLon, z))
    const x1 = Math.floor(lon2tileX(BBOX.maxLon, z))
    const y0 = Math.floor(lat2tileY(BBOX.maxLat, z))
    const y1 = Math.floor(lat2tileY(BBOX.minLat, z))
    return { nx: x1 - x0 + 1, ny: y1 - y0 + 1 }
  }
  const fits = (z: number, isElev: boolean, maxMP: number): boolean => {
    const { nx, ny } = tileGrid(z, isElev)
    return nx <= MAX_TILES_SIDE && ny <= MAX_TILES_SIDE && nx * ny * 65536 <= maxMP * 1e6
  }

  // Plafond 17 (~1,2 m/px) : les tracés courts en profitent (gros plans + parois nets) ; les longs
  // retombent à 16/15 via `fits`. IGN ORTHOIMAGERY sert jusqu'à z19.
  let ZOOM_ORTHO = 17
  let ZOOM_ELEV = 14
  while (ZOOM_ORTHO > 12 && !fits(ZOOM_ORTHO, false, MAX_ORTHO_MP)) ZOOM_ORTHO--
  while (ZOOM_ELEV > 11 && !fits(ZOOM_ELEV, true, MAX_ELEV_MP)) ZOOM_ELEV--

  const txMin = Math.floor(lon2tileX(BBOX.minLon, ZOOM_ORTHO))
  const txMax = Math.floor(lon2tileX(BBOX.maxLon, ZOOM_ORTHO))
  const tyMin = Math.floor(lat2tileY(BBOX.maxLat, ZOOM_ORTHO))
  const tyMax = Math.floor(lat2tileY(BBOX.minLat, ZOOM_ORTHO))
  const nx = txMax - txMin + 1
  const ny = tyMax - tyMin + 1

  const covLonMin = tileX2lon(txMin, ZOOM_ORTHO)
  const covLonMax = tileX2lon(txMax + 1, ZOOM_ORTHO)
  const covLatMax = tileY2lat(tyMin, ZOOM_ORTHO)
  const covLatMin = tileY2lat(tyMax + 1, ZOOM_ORTHO)

  const lat0 = (covLatMin + covLatMax) / 2
  const lon0 = (covLonMin + covLonMax) / 2
  const M_PER_DEG_LAT = 110540
  const M_PER_DEG_LON = 111320 * Math.cos((lat0 * Math.PI) / 180)

  const project = (lon: number, lat: number): [number, number] =>
    [(lon - lon0) * M_PER_DEG_LON, -(lat - lat0) * M_PER_DEG_LAT]
  const unproject = (x: number, z: number): [number, number] =>
    [x / M_PER_DEG_LON + lon0, -z / M_PER_DEG_LAT + lat0]

  const elevTileDeg = 180 / 2 ** ZOOM_ELEV
  const lon2elevPxGlobal = (lon: number) => ((lon + 180) / elevTileDeg) * TILE
  const lat2elevPxGlobal = (lat: number) => ((90 - lat) / elevTileDeg) * TILE

  const ecolMin = Math.floor(lon2elevPxGlobal(covLonMin) / TILE)
  const ecolMax = Math.floor(lon2elevPxGlobal(covLonMax) / TILE)
  const erowMin = Math.floor(lat2elevPxGlobal(covLatMax) / TILE)
  const erowMax = Math.floor(lat2elevPxGlobal(covLatMin) / TILE)
  const enx = ecolMax - ecolMin + 1
  const eny = erowMax - erowMin + 1

  const elevPixelForLonLat = (lon: number, lat: number): [number, number] =>
    [lon2elevPxGlobal(lon) - ecolMin * TILE, lat2elevPxGlobal(lat) - erowMin * TILE]

  return {
    BBOX, ZOOM_ORTHO, ZOOM_ELEV,
    txMin, tyMin, nx, ny,
    covLonMin, covLonMax, covLatMin, covLatMax,
    ecolMin, erowMin, enx, eny,
    lat0, lon0, project, unproject, elevPixelForLonLat,
  }
}

// ─── Terrain de fond (lointain) ──────────────────────────────────────────────

export interface FarTerrain {
  /** Ortho basse résolution (étalonnée) de toute l'emprise lointaine, grille Web Mercator. */
  canvas: HTMLCanvasElement
  zoom: number; txMin: number; tyMin: number; nx: number; ny: number
  /** Altitude (m) au point, NaN si inconnue ; null si le DEM mondial est indisponible. */
  elevAt: ((lon: number, lat: number) => number) | null
  /** La photo aérienne montre-t-elle de l'eau (ou rien : tuile absente, typiquement en mer) ? Le
   *  DEM mondial, flou sur les côtes, donne +2 à +10 m jusqu'à ~500 m au large : sans ce
   *  recoupement, une bande de mer ressortait en plateau vert au-dessus du plan d'eau. */
  isWaterAt: (lon: number, lat: number) => boolean
  /** Pas de relief IGN à ce point (mer, ou étranger) : seules zones où la mer peut « grignoter »
   *  le relief mondial. Là où l'IGN a une donnée, c'est de la terre, au trait de côte exact. */
  ignNoDataAt: (lon: number, lat: number) => boolean
}

/** Ortho + relief BASSE résolution d'un carré de `sideM` mètres centré sur l'emprise du tracé.
 *  Sert de terrain de fond au-delà de l'emprise détaillée : vue de très haut (vue d'ensemble de
 *  fin de film), le maillage détaillé ne couvre qu'une partie de l'image. Zoom choisi pour tenir
 *  en ≤ 12×12 tuiles. Échec toléré (null). */
export async function fetchFarTerrain(cov: Coverage, sideM: number, signal?: AbortSignal): Promise<FarTerrain | null> {
  const half = sideM / 2
  const dLon = half / (111320 * Math.cos((cov.lat0 * Math.PI) / 180))
  const dLat = half / 110540
  const minLon = cov.lon0 - dLon, maxLon = cov.lon0 + dLon
  const minLat = cov.lat0 - dLat, maxLat = cov.lat0 + dLat
  let zoom = Math.min(13, cov.ZOOM_ORTHO - 1)
  const grid = (z: number) => {
    const x0 = Math.floor(lon2tileX(minLon, z)), x1 = Math.floor(lon2tileX(maxLon, z))
    const y0 = Math.floor(lat2tileY(maxLat, z)), y1 = Math.floor(lat2tileY(minLat, z))
    return { x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1 }
  }
  while (zoom > 6 && (grid(zoom).nx > 12 || grid(zoom).ny > 12)) zoom--
  const g = grid(zoom)
  // Relief : le plus fin possible en ≤ 14×14 tuiles (~60 m/px sur 200 km). Plus grossier, les
  // bandes de terre étroites (presqu'îles) tombaient sous le niveau de la mer à l'interpolation.
  let zElev = Math.min(12, zoom + 1)
  while (zElev > 9 && (grid(zElev).nx > 14 || grid(zElev).ny > 14)) zElev--
  // Relief IGN basse résolution (grille WGS84G, niveaux 6 à 14, ≤ 64 tuiles) : trait de côte exact
  // (pas de donnée IGN en mer), là où le relief mondial le décale jusqu'à ~500 m au large — haut
  // de falaise compris. fetchElevationTiles comble lui-même les trous par le relief mondial.
  const eGrid = (z: number) => {
    const deg = 180 / 2 ** z
    const c0 = Math.floor((minLon + 180) / deg), c1 = Math.floor((maxLon + 180) / deg)
    const r0 = Math.floor((90 - maxLat) / deg), r1 = Math.floor((90 - minLat) / deg)
    return { deg, c0, r0, nx: c1 - c0 + 1, ny: r1 - r0 + 1 }
  }
  let zIgn = 12
  while (zIgn > 6 && eGrid(zIgn).nx * eGrid(zIgn).ny > 64) zIgn--
  const eg = eGrid(zIgn)
  const [ortho, terrAt, ign] = await Promise.all([
    // Concurrence réduite (3 et 2) : ces requêtes s'ajoutent à celles du terrain détaillé, vers le
    // même serveur IGN ; le fond n'est attendu qu'après, inutile qu'il le ralentisse.
    fetchOrthoTiles(g.x0, g.y0, g.nx, g.ny, zoom, signal, 3),
    // fetchTerrariumElevation prend le zoom relief IGN et descend d'un cran : +1 pour viser zElev.
    fetchTerrariumElevation(minLon, maxLon, minLat, maxLat, zElev + 1, signal).catch(() => null),
    fetchElevationTiles(eg.c0, eg.r0, eg.nx, eg.ny, zIgn, signal, 2).catch(() => null),
  ])
  if (!ortho.ok.some(Boolean)) return null

  // Relief final : IGN là où il a une donnée, relief mondial ailleurs (mer, étranger).
  const ignPx = (lon: number, lat: number): [number, number] =>
    [((lon + 180) / eg.deg - eg.c0) * TILE, ((90 - lat) / eg.deg - eg.r0) * TILE]
  const ignNoDataAt = (lon: number, lat: number): boolean => {
    if (!ign) return true
    const [fx, fy] = ignPx(lon, lat)
    const x = Math.round(fx), y = Math.round(fy)
    if (x < 0 || y < 0 || x >= ign.width || y >= ign.height) return true
    return ign.rawBad[y * ign.width + x] === 1
  }
  const elevAt = (terrAt || ign) ? (lon: number, lat: number): number => {
    if (ign && !ignNoDataAt(lon, lat)) {
      const [fx, fy] = ignPx(lon, lat)
      const x0 = Math.max(0, Math.min(ign.width - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(ign.height - 2, Math.floor(fy)))
      const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0))
      const d = ign.data, W2 = ign.width, i = y0 * W2 + x0
      return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + W2] * (1 - tx) + d[i + W2 + 1] * tx) * ty
    }
    return terrAt ? terrAt(lon, lat) : NaN
  } : null

  // Masque « eau » (1 pixel sur 4), lu AVANT l'étalonnage des couleurs : bleu dominant et
  // plutôt sombre (mer, lacs, y compris eaux turquoise peu profondes), ou teinte de repli exacte
  // (tuile absente partout = presque toujours de la mer).
  const MS = 4
  const W = ortho.canvas.width, H = ortho.canvas.height
  const mw = Math.ceil(W / MS), mh = Math.ceil(H / MS)
  const water = new Uint8Array(mw * mh)
  try {
    const px = ortho.canvas.getContext('2d')!.getImageData(0, 0, W, H).data
    const [vr, vg, vb] = [0x8d, 0x97, 0x8a] // ORTHO_VOID_TINT
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = ((Math.min(H - 1, y * MS + 2)) * W + Math.min(W - 1, x * MS + 2)) * 4
        const r = px[i], gg = px[i + 1], b = px[i + 2]
        const blue = b > r + 10 && b + 10 >= gg && (r + gg + b) / 3 < 120
        const vide = Math.abs(r - vr) < 3 && Math.abs(gg - vg) < 3 && Math.abs(b - vb) < 3
        water[y * mw + x] = blue || vide ? 1 : 0
      }
    }
  } catch { /* canvas inaccessible (CORS) : masque vide, on s'en remet au seul relief */ }
  // Tuiles restées absentes : comblées par le voisinage (comme le terrain détaillé), APRÈS le masque d'eau qui lit la
  // teinte de repli. Sinon, sur terre, une tuile manquante restait un aplat uni bien visible sur la vue d'ensemble.
  inpaintOrthoHoles(ortho.canvas, ortho.ok, ortho.cols, ortho.rows)
  const isWaterAt = (lon: number, lat: number): boolean => {
    const x = Math.floor(((lon2tileX(lon, zoom) - g.x0) * TILE) / MS)
    const y = Math.floor(((lat2tileY(lat, zoom) - g.y0) * TILE) / MS)
    return x >= 0 && y >= 0 && x < mw && y < mh && water[y * mw + x] === 1
  }

  gradeTerrainColors(ortho.canvas)
  return { canvas: ortho.canvas, zoom, txMin: g.x0, tyMin: g.y0, nx: g.nx, ny: g.ny, elevAt, isWaterAt, ignNoDataAt }
}
