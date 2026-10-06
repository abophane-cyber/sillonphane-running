import { useEffect } from 'react'

/** Bloque le zoom de la page tant que le composant est affiché (éditeurs plein écran).
 * Un pincement (pavé tactile ou écran tactile) agrandissait la page sans la réorganiser : la
 * barre du haut et les panneaux latéraux sortaient alors de la fenêtre, hors d'atteinte.
 * - pavé tactile / Ctrl + molette : événements `wheel` avec ctrlKey ;
 * - écran tactile : `touchmove` à deux doigts (complété par `touch-action` sur .albed-shell) ;
 * - Safari : événements `gesture*`.
 * Les gestes à un doigt (glisser, redimensionner) ne sont pas touchés. */
export function useBlockPageZoom() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault() }
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault() }
    const onGesture = (e: Event) => e.preventDefault()
    const opts = { passive: false } as const
    window.addEventListener('wheel', onWheel, opts)
    window.addEventListener('touchmove', onTouchMove, opts)
    window.addEventListener('gesturestart', onGesture, opts)
    window.addEventListener('gesturechange', onGesture, opts)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('gesturestart', onGesture)
      window.removeEventListener('gesturechange', onGesture)
    }
  }, [])
}
