// Attentes de l'encodeur vidéo pendant le rendu des films 2D et 3D (filmExport.ts, terrain3d/filmExport3d.ts).
//
// Garde-fou : un encodeur matériel peut se bloquer (pilote, carte graphique) sans jamais signaler
// d'erreur — sa file ne se vide plus et le rendu restait figé indéfiniment. Au-delà de
// ENCODER_STALL_MS sans progrès, onglet visible, le rendu s'arrête avec ENCODER_FAIL_MSG.
//
// Attentes SANS minuterie : dans un onglet en arrière-plan, le navigateur espace les setTimeout
// (1 s, puis jusqu'à 1 min) et le rendu n'avançait presque plus. Un message (MessageChannel) et
// l'événement « dequeue » de l'encodeur ne sont pas ralentis.

export const ENCODER_STALL_MS = 30_000
export const ENCODER_FAIL_MSG = "L'encodeur vidéo de ce navigateur ne répond plus. " +
  'Fermez les autres onglets et réessayez, ou essayez un autre navigateur (Chrome ou Edge à jour).'

const _yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
const _yieldQueue: (() => void)[] = []
if (_yieldChannel) _yieldChannel.port1.onmessage = () => _yieldQueue.shift()?.()

/** Rend la main au navigateur, sans être ralenti en arrière-plan comme setTimeout(0). */
export function yieldTask(): Promise<void> {
  if (!_yieldChannel) return new Promise(r => setTimeout(r, 0))
  return new Promise(r => { _yieldQueue.push(r); _yieldChannel.port2.postMessage(0) })
}

/** Attend qu'une image sorte de la file de l'encodeur (événement « dequeue », sinon sondage). */
function waitEncoderDequeue(encoder: VideoEncoder): Promise<void> {
  if (!('ondequeue' in encoder)) return new Promise(r => setTimeout(r, 6))
  return new Promise(r => {
    const done = () => { clearTimeout(t); encoder.removeEventListener('dequeue', done); r() }
    // filet si l'événement n'arrive pas : on revérifie l'état (erreur, délai) au tour suivant
    const t = setTimeout(done, 250)
    encoder.addEventListener('dequeue', done)
  })
}

/**
 * Attend que la file de l'encodeur redescende à `maxQueue` images. Renvoie false si l'encodeur
 * est en erreur (`hasError`), fermé, ou bloqué depuis ENCODER_STALL_MS : le rendu doit s'arrêter.
 * Le délai ne court que si la file ne bouge plus ET onglet visible (en arrière-plan, le navigateur
 * ralentit tout et ce n'est pas un blocage).
 */
export async function waitEncoderQueue(
  encoder: VideoEncoder, maxQueue: number, hasError: () => boolean, signal?: AbortSignal,
): Promise<boolean> {
  let waitStart = performance.now()
  let lastQueue = encoder.encodeQueueSize
  const fail = (cause: string) => {
    lastFailure = `${cause}, file ${encoder.encodeQueueSize}, état ${encoder.state}, onglet ${document.hidden ? 'caché' : 'visible'}`
    return false
  }
  while (encoder.encodeQueueSize > maxQueue) {
    if (hasError()) return fail('erreur encodeur')
    if (encoder.state === 'closed') return fail('encodeur fermé')
    if (encoder.encodeQueueSize < lastQueue || document.hidden) waitStart = performance.now()
    lastQueue = encoder.encodeQueueSize
    if (performance.now() - waitStart > ENCODER_STALL_MS) return fail('file bloquée')
    if (signal?.aborted) return true
    await waitEncoderDequeue(encoder)
  }
  if (hasError()) return fail('erreur encodeur')
  if (encoder.state === 'closed') return fail('encodeur fermé')
  return true
}

// ─── Détails techniques joints au message d'échec ─────────────────────────────────────────────
// Le message seul ne dit pas OÙ ça coince ; ces détails (navigateur, réglage de l'encodeur, image
// atteinte, cause) permettent un diagnostic à distance sur une simple capture d'écran.

let encoderSetup = ''
let encoderFrame = ''
let lastFailure = ''

/** Réglage retenu pour l'encodeur, à appeler après `configure` (ex. « film 3D, avc1.4d0029 QP 1920×1080 »). */
export function noteEncoderSetup(setup: string) { encoderSetup = setup; encoderFrame = ''; lastFailure = '' }
/** Image en cours d'encodage (ex. « image 120/2400 »). */
export function noteEncoderFrame(frame: number, total?: number) { encoderFrame = `image ${frame}${total ? `/${total}` : ''}` }

function browserLabel(): string {
  const ua = navigator.userAgent
  const m = ua.match(/Edg\/(\d+)/) ? `Edge ${ua.match(/Edg\/(\d+)/)![1]}`
    : ua.match(/Firefox\/(\d+)/) ? `Firefox ${ua.match(/Firefox\/(\d+)/)![1]}`
    : ua.match(/Chrome\/(\d+)/) ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}`
    : ua.match(/Version\/([\d.]+).*Safari/) ? `Safari ${ua.match(/Version\/([\d.]+)/)![1]}`
    : 'navigateur inconnu'
  const os = /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [m, os].filter(Boolean).join(', ')
}

/** Message d'échec complet : ENCODER_FAIL_MSG + une ligne de détails techniques. */
export function encoderFailMessage(): string {
  const details = [browserLabel(), encoderSetup, encoderFrame, lastFailure].filter(Boolean).join(' · ')
  return `${ENCODER_FAIL_MSG}\n\nDétails techniques : ${details}`
}
