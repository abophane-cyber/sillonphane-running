// Estimation du temps restant de l'export vidéo 2D. Le film 3D a la sienne,
// plus fine (tuiles et images comptées d'avance) : voir filmExport3d.ts.
//
// La barre de progression enchaîne deux phases aux vitesses sans rapport :
//   - préparation (0 → prepShare) : chargement des tuiles de carte, rapide ou lent selon le réseau
//     et le cache — sa vitesse ne dit rien du rendu ;
//   - rendu (prepShare → 1) : production des images, bien plus lente par pourcentage.
// Extrapoler la vitesse de la préparation sur toute la barre annonçait « 1 min » puis remontait à
// « 4 min » au début du rendu. Les deux phases sont donc estimées séparément :
//   temps restant = préparation restante (sa propre vitesse) + rendu restant,
// le rendu restant venant d'abord du temps de rendu MESURÉ au dernier export de ce type sur
// l'appareil (localStorage, par seconde de film), puis de la vitesse réelle du rendu (fenêtre
// glissante de 15 s, échantillons de la phase de rendu uniquement).
// Sans historique (premier export sur l'appareil), aucune estimation n'est donnée (null) tant que
// le rendu n'a pas assez avancé pour être mesuré : pas de chiffre plutôt qu'un chiffre faux.
// En fin d'export, le temps de rendu mesuré (hors préparation) est mémorisé pour le suivant.

export type EtaKind = '2d'

const DEFAULT_PREP_S = 15
const PREP_MAX_S = 120 // le préchargement des tuiles est plafonné à 120 s (filmExport.ts)
const WINDOW_S = 15
const SMOOTH_TAU_S = 2

export function makeExportEta(kind: EtaKind, filmS: number, prepShare: number) {
  // v2 : temps de rendu seul par seconde de film (v1 mélangeait préparation et rendu).
  const key = `running:sillon.eta2.${kind}`
  let renderSecPerFilmS: number | null = null
  try {
    const v = Number(localStorage.getItem(key))
    if (v > 0 && Number.isFinite(v)) renderSecPerFilmS = v
  } catch { /* stockage indisponible */ }

  const t0 = performance.now()
  let prepSamples: [number, number][] = [] // [temps écoulé (s), progression de la préparation 0..1]
  const renderSamples: [number, number][] = [] // [temps écoulé (s), progression du rendu 0..1]
  let tRenderStart: number | null = null
  let smooth: number | null = null
  let lastT = 0

  const pushWindowed = (arr: [number, number][], el: number, v: number) => {
    arr.push([el, v])
    while (arr.length > 2 && el - arr[0][0] > WINDOW_S) arr.shift()
  }
  /** Temps restant extrapolé de la vitesse mesurée dans la fenêtre, ou null si trop peu de données. */
  const byRate = (arr: [number, number][], el: number, v: number): number | null => {
    const [ta, va] = arr[0]
    if (el - ta < 3 || v - va < 0.002) return null
    return (1 - v) / ((v - va) / (el - ta))
  }

  return {
    /** Temps restant estimé (s) pour une progression `ratio` (0..1), ou null si pas encore fiable. */
    update(ratio: number): number | null {
      const el = (performance.now() - t0) / 1000
      const p = Math.max(0, Math.min(1, Math.abs(ratio)))
      let est: number | null

      if (p < prepShare) {
        const q = p / prepShare
        pushWindowed(prepSamples, el, q)
        const prepLeft = Math.min(PREP_MAX_S, byRate(prepSamples, el, q) ?? Math.max(DEFAULT_PREP_S - el, 5))
        est = renderSecPerFilmS == null ? null : prepLeft + filmS * renderSecPerFilmS
      } else {
        if (tRenderStart == null) { tRenderStart = el; prepSamples = [] }
        const q = (p - prepShare) / (1 - prepShare)
        pushWindowed(renderSamples, el, q)
        const measured = q > 0.01 ? byRate(renderSamples, el, q) : null
        const fromHistory = renderSecPerFilmS == null ? null : filmS * renderSecPerFilmS * (1 - q)
        if (measured == null) est = fromHistory
        else if (fromHistory == null) est = q >= 0.05 ? measured : null
        else {
          const w = Math.min(1, q / 0.15) // confiance croissante dans la vitesse mesurée
          est = fromHistory * (1 - w) + measured * w
        }
      }

      if (est == null) return null
      // Lissage en temps (et non par appel : la cadence des rappels varie d'un film à l'autre).
      const a = smooth == null ? 1 : 1 - Math.exp(-(el - lastT) / SMOOTH_TAU_S)
      smooth = smooth == null ? est : smooth + (est - smooth) * a
      lastT = el
      return smooth
    },
    /** Export terminé : mémorise le temps de rendu (hors préparation) par seconde de film. */
    finish(): void {
      if (tRenderStart == null || !(filmS > 0)) return
      const renderS = (performance.now() - t0) / 1000 - tRenderStart
      if (renderS < 2) return
      const measured = renderS / filmS
      const next = renderSecPerFilmS == null ? measured : (renderSecPerFilmS + measured) / 2
      try { localStorage.setItem(key, String(next)) }
      catch { /* stockage indisponible */ }
    },
  }
}

/** Temps restant, arrondi à la minute (une estimation plus fine serait fausse). */
export function formatEta(s: number): string {
  if (s < 45) return "moins d'une minute"
  if (s < 90) return 'encore environ 1 min'
  return `encore environ ${Math.round(s / 60)} min`
}
