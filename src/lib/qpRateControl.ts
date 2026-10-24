// Qualité constante + plafond de débit pour l'encodage H.264 WebCodecs (≈ x264 « CRF + maxrate »),
// utilisé par les films 2D (filmExport.ts) et 3D (filmExport3d.ts).
// QP fixe par image (bitrateMode 'quantizer') : même netteté partout, peu de bits sur les plans quasi
// fixes, beaucoup sur les passages chargés. Au-dessus du plafond, la qualité baisse ; elle remonte vers le QP de
// base (jamais au-delà) quand le débit redescend nettement.
//
// Débit estimé sur les seules images encodées AU QP EN COURS (les MEASURE_S dernières secondes au plus), images-clés
// exclues. Avant : moyenne des 2 dernières secondes, tous QP confondus. Le débit mesuré gardait les images d'avant le
// changement de QP pendant 2 s, si bien que le QP montait 2 s de trop (débit effondré), puis redescendait 2 s de trop :
// oscillation de ~5 s, de 5 à 80 Mb/s pour un plafond de 24 (film 3D en 1440p, contenu bien au-dessus du plafond au
// QP de base), et lecture saccadée. En 1080p le plafond n'était presque jamais atteint, d'où un défaut invisible.
// Hystérésis : baisse de qualité au-dessus de TARGET × plafond (marge pour les images-clés, exclues de la mesure),
// remontée seulement sous LOW × plafond et après UP_HOLD_S au même QP (de deux crans d'un coup si le débit est très bas).
// ATTENTION : l'appelant doit attendre l'encodeur (encodeQueueSize) à chaque image, sinon les tailles
// d'images mesurées ont plusieurs secondes de retard et le plafond n'est pas tenu.

const MEASURE_S = 0.5
const MIN_SAMPLES_S = 0.2
const TARGET = 0.85
const LOW = 0.55
const UP_HOLD_S = 0.5

export function createQpRateControl(opts: { fps: number; baseQp: number; maxQp: number; capBps: number }) {
  const { fps, baseQp, maxQp, capBps } = opts
  let curQP = baseQp
  let maxUsed = baseQp
  let lastStep = 0
  /** QP de chaque image envoyée à l'encodeur, par indice d'image (retrouvé depuis l'horodatage du morceau encodé). */
  const qpOfFrame = new Map<number, number>()
  /** Tailles des images P encodées au QP en cours (les plus récentes). */
  let samples: number[] = []
  const maxSamples = Math.max(4, Math.round(MEASURE_S * fps))
  const minSamples = Math.max(2, Math.round(MIN_SAMPLES_S * fps))
  return {
    /** À appeler pour chaque morceau encodé (callback output de l'encodeur). */
    onChunk(c: EncodedVideoChunk) {
      const f = Math.round((c.timestamp * fps) / 1_000_000)
      const qp = qpOfFrame.get(f)
      qpOfFrame.delete(f)
      if (c.type === 'key' || qp !== curQP) return
      samples.push(c.byteLength)
      if (samples.length > maxSamples) samples.shift()
    },
    /** QP à utiliser pour l'image `f` (indice d'image, celui de son horodatage). */
    next(f: number): number {
      if (samples.length >= minSamples) {
        let sum = 0
        for (const b of samples) sum += b
        const bps = (sum * 8 * fps) / samples.length
        let step = 0
        if (bps > capBps * TARGET && curQP < maxQp) step = bps > capBps * 2.5 ? 3 : bps > capBps * 1.4 ? 2 : 1
        else if (bps < capBps * LOW && curQP > baseQp && f - lastStep >= UP_HOLD_S * fps) step = bps < capBps * 0.3 ? -2 : -1
        if (step) {
          curQP = Math.max(baseQp, Math.min(maxQp, curQP + step))
          maxUsed = Math.max(maxUsed, curQP)
          lastStep = f
          samples = []
        }
      }
      qpOfFrame.set(f, curQP)
      return curQP
    },
    get maxUsed() { return maxUsed },
  }
}
