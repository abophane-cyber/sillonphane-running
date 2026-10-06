// Maintient l'onglet « actif » pendant un export vidéo long : Wake Lock écran, pour empêcher la
// mise en veille de l'écran (surtout portable / mobile) qui gèlerait la boucle de capture.
//
// NB : on a essayé d'ajouter un nœud audio quasi-muet (Chrome n'applique pas le throttling
// agressif des timers d'arrière-plan à un onglet qui émet du son). Mais un AudioContext actif
// introduit assez de gigue sur le thread principal pour désynchroniser la capture `getCanvas()`
// de la reprojection du tracé dans filmExport.ts → le tracé « flotte » / glisse sur quelques
// frames. Abandonné. Garder l'onglet au premier plan reste la parade au throttling.
//
// `beginExportKeepAlive()` renvoie une fonction de libération (idempotente), à appeler dans le
// `finally` de l'export.

interface WakeLockSentinelLike { release(): Promise<void> }
interface WakeLockLike { request(type: 'screen'): Promise<WakeLockSentinelLike> }

export function beginExportKeepAlive(): () => void {
  let released = false

  const wakeLockApi = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock
  let sentinel: WakeLockSentinelLike | null = null
  const acquire = () => {
    if (released || !wakeLockApi || document.visibilityState !== 'visible') return
    wakeLockApi.request('screen')
      .then(s => { if (released) s.release().catch(() => {}); else sentinel = s })
      .catch(() => {}) // refus / onglet non visible : sans gravité
  }
  // Le sentinel est libéré automatiquement dès que l'onglet passe caché : on le redemande au retour.
  const onVisibility = () => { if (document.visibilityState === 'visible') acquire() }
  document.addEventListener('visibilitychange', onVisibility)
  acquire()

  return () => {
    if (released) return
    released = true
    document.removeEventListener('visibilitychange', onVisibility)
    sentinel?.release().catch(() => {})
    sentinel = null
  }
}
