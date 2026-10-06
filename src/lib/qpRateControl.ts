// Qualité constante + plafond de débit pour l'encodage H.264 WebCodecs (≈ x264 « CRF + maxrate »),
// utilisé par le film 2D (filmExport.ts) — même principe que filmExport3d.ts.
// QP fixe par image (bitrateMode 'quantizer') : même netteté partout, peu de bits sur les plans quasi
// fixes, beaucoup sur les passages chargés. Si le débit des WINDOW_S dernières secondes dépasse le
// plafond, la qualité baisse d'un cran ; elle remonte vers le QP de base (jamais au-delà) dès que le débit
// redescend. Pas plus d'un cran toutes les STEP_EVERY images : pas de saut de qualité visible.
// ATTENTION : l'appelant doit attendre l'encodeur (encodeQueueSize) à chaque image, sinon les tailles
// d'images mesurées ont plusieurs secondes de retard et le plafond n'est pas tenu.

const WINDOW_S = 2
const STEP_EVERY = 6

export function createQpRateControl(opts: { fps: number; baseQp: number; maxQp: number; capBps: number }) {
  const { fps, baseQp, maxQp, capBps } = opts
  let curQP = baseQp
  let maxUsed = baseQp
  let lastStep = 0
  const chunkBytes: number[] = []
  return {
    /** À appeler pour chaque morceau encodé (callback output de l'encodeur). */
    onChunk(c: EncodedVideoChunk) {
      chunkBytes.push(c.byteLength)
      if (chunkBytes.length > WINDOW_S * fps) chunkBytes.shift()
    },
    /** QP à utiliser pour l'image `f` (index global dans le film). */
    next(f: number): number {
      if (f - lastStep < STEP_EVERY || chunkBytes.length < fps / 2) return curQP
      let sum = 0
      for (const b of chunkBytes) sum += b
      const bps = (sum * 8 * fps) / chunkBytes.length
      if (bps > capBps && curQP < maxQp) { curQP++; lastStep = f; maxUsed = Math.max(maxUsed, curQP) }
      else if (bps < capBps * 0.75 && curQP > baseQp) { curQP--; lastStep = f }
      return curQP
    },
    get maxUsed() { return maxUsed },
  }
}
