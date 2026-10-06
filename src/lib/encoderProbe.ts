// Diagnostic anticipé de l'encodeur vidéo, lancé à l'ouverture de l'animation (AnimationControls.tsx) :
// prévient AVANT le clic sur « Film » si ce navigateur ne pourra pas créer le film, au lieu de le
// découvrir au milieu du rendu (garde-fou de encoderWait.ts).
//
//  - 'ok'       : WebCodecs H.264 accepté ET un essai éclair (quelques images 1080p) sort bien des images ;
//  - 'fallback' : pas de WebCodecs H.264, mais l'enregistrement de secours (MediaRecorder) existe —
//                 les films se font quand même (plus lentement, parfois en WebM) : rien à signaler ;
//  - 'broken'   : ni l'un ni l'autre, ou l'encodeur accepte la configuration puis échoue / ne rend
//                 rien à l'essai (pilote, carte graphique) — les films ne pourront pas être créés.
//
// Ne prédit pas un blocage en cours de route : seulement un encodeur déjà hors service.

export type EncoderProbe = 'ok' | 'fallback' | 'broken'

// Mêmes codecs, dans le même ordre, que filmExport.ts / filmExport3d.ts.
const CODECS = ['avc1.4d0029', 'avc1.4d0028', 'avc1.42001e']
const W = 1920, H = 1080 // taille du film 3D (le 2D est en 1080p sur ordinateur, 720p sur mobile)
const TEST_FRAMES = 5
// Large : sur un appareil modeste occupé par la carte de l'aperçu, quelques images 1080p peuvent
// prendre plusieurs secondes. Un faux « hors service » serait pire qu'un diagnostic manqué.
const TEST_TIMEOUT_MS = 15_000

let cached: Promise<EncoderProbe> | null = null

/** Résultat mis en cache pour la session : l'essai ne tourne qu'une fois. */
export function probeVideoEncoder(): Promise<EncoderProbe> {
  cached ??= runProbe().catch(() => 'ok' as const) // erreur inattendue du diagnostic : ne rien signaler
  return cached
}

async function runProbe(): Promise<EncoderProbe> {
  const canFallback = typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return canFallback ? 'fallback' : 'broken'

  let config: VideoEncoderConfig | null = null
  for (const codec of CODECS) {
    const cfg: VideoEncoderConfig = { codec, width: W, height: H, framerate: 30, bitrate: 8_000_000, latencyMode: 'quality' }
    const ok = await VideoEncoder.isConfigSupported(cfg).then(s => !!s.supported, () => false)
    if (ok) { config = cfg; break }
  }
  if (!config) return canFallback ? 'fallback' : 'broken'

  let outputs = 0
  let failed = false
  const encoder = new VideoEncoder({ output: () => { outputs++ }, error: () => { failed = true } })
  try {
    encoder.configure(config)
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')!
    for (let i = 0; i < TEST_FRAMES; i++) {
      ctx.fillStyle = `hsl(${i * 60}, 50%, 50%)`
      ctx.fillRect(0, 0, W, H)
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1_000_000 / 30) })
      try { encoder.encode(vf, { keyFrame: i === 0 }) } finally { vf.close() }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = await Promise.race([
      encoder.flush().then(() => false, () => { failed = true; return false }),
      new Promise<boolean>(r => { timer = setTimeout(() => r(true), TEST_TIMEOUT_MS) }),
    ])
    clearTimeout(timer)
    if (failed || timedOut || outputs === 0) return 'broken'
    return 'ok'
  } catch {
    return 'broken'
  } finally {
    try { if (encoder.state !== 'closed') encoder.close() } catch { /* déjà fermé */ }
  }
}
