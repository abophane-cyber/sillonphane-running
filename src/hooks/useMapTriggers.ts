import { useState } from 'react'

/**
 * Compteurs incrémentés pour déclencher des actions ponctuelles sur la carte
 * (recadrage, saut de progression, retour au départ) via un changement de prop.
 */
export function useMapTriggers() {
  const [fitBoundsCount, setFitBoundsCount] = useState(0)
  const [seekCount, setSeekCount] = useState(0)
  const [zoomToStartCount, setZoomToStartCount] = useState(0)

  return {
    fitBoundsCount,
    seekCount,
    zoomToStartCount,
    bumpFitBounds: () => setFitBoundsCount(c => c + 1),
    bumpSeek: () => setSeekCount(c => c + 1),
    bumpZoomToStart: () => setZoomToStartCount(c => c + 1),
  }
}
