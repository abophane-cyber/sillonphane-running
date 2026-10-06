// Glisser-déposer d'un panneau ajouté depuis la liste de l'assistant (PanelWizard) vers la carte
// (TrackMap). Le nom du panneau voyage dans le dataTransfer
// sous ce type MIME : la carte n'accepte le dépôt que pour lui (pas pour un fichier, un texte…).
//
// NB : le glisser-déposer HTML5 n'existe pas au doigt (mobiles) — là, on fait glisser le panneau lui-même
// sur la carte (marqueur en vue simple, poignée en vue 2D+).

export const PANEL_DRAG_MIME = 'application/x-sillon-panel'

export function isPanelDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer?.types.includes(PANEL_DRAG_MIME)
}

/** Point du tracé le plus proche de (lon, lat) : un panneau déposé s'aimante au tracé. */
export function snapToTrack<P extends { lon: number; lat: number }>(points: P[], lon: number, lat: number): P {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = points[0], bestD = Infinity
  for (const p of points) {
    const dx = (p.lon - lon) * k, dy = p.lat - lat
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}
