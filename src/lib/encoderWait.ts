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
  while (encoder.encodeQueueSize > maxQueue) {
    if (hasError() || encoder.state === 'closed') return false
    if (encoder.encodeQueueSize < lastQueue || document.hidden) waitStart = performance.now()
    lastQueue = encoder.encodeQueueSize
    if (performance.now() - waitStart > ENCODER_STALL_MS) return false
    if (signal?.aborted) return true
    await waitEncoderDequeue(encoder)
  }
  return !hasError() && encoder.state !== 'closed'
}
