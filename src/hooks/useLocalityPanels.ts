import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { computeAllLocalities, fetchColLatLonByName, type LocalityInfo } from './useLocality'
import type { ActivityMode } from './useAnimationSettings'
import type { AddPanelInfo } from '../components/AnimationControls'
import type { GpxPoint, GpxTrack } from '../types'

export interface PendingPanelRestore {
  suppressed?: string[]
  wizardDone?: boolean
}

/**
 * Localités précalculées, panneaux personnalisés, panneaux masqués et assistant de
 * validation — tout ce qui alimente les panneaux affichés sur la carte pendant l'animation.
 */
export function useLocalityPanels(
  activeTrack: GpxTrack | null,
  points: GpxPoint[],
  distances: number[],
  activityMode: ActivityMode,
  lookahead: number,
  isAnimateView: boolean,
  currentPoint: GpxPoint | null,
  pendingRestoreRef?: MutableRefObject<PendingPanelRestore | null>,
) {
  const [previewLocalities, setPreviewLocalities] = useState<LocalityInfo[]>([])
  const [localitiesLoading, setLocalitiesLoading] = useState(false)
  const [customLocalities, setCustomLocalities] = useState<LocalityInfo[]>([])
  const [suppressedLocalities, setSuppressedLocalities] = useState<Set<string>>(new Set())
  const suppressedLocalitiesRef = useRef<Set<string>>(new Set())
  // Par défaut, aucune localité intermédiaire n'est cochée (l'utilisateur choisit celles qu'il veut) : elles sont
  // « masquées » d'office au chargement d'un tracé neuf. Départ, arrivée et cols restent affichés. Les noms ainsi
  // masqués automatiquement (et pas encore touchés par l'utilisateur) sont suivis ici.
  const autoSuppressedRef = useRef<Set<string>>(new Set())
  const applyDefaultDeselectRef = useRef(false)
  const colDefaultDeselectRef = useRef(false)
  const colsHandledRef = useRef<Set<string>>(new Set())
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2 | 3>(0)
  const [wizardDone, setWizardDone] = useState(false)
  // Empêche l'ouverture automatique du wizard juste après la restauration d'un tracé déjà validé
  // (les deux effets tournent sur le même commit : celui du wizard verrait encore wizardDone=false).
  const skipWizardAutoOpenRef = useRef(false)

  // Pré-calcul des localités pour l'affichage avant lecture
  useEffect(() => {
    // Restauration d'un tracé déjà configuré (ouvert depuis "Mes sillons") : reprend les
    // panneaux masqués et l'état du wizard tels que sauvegardés, au lieu de tout réinitialiser.
    const restore = pendingRestoreRef?.current ?? null
    if (pendingRestoreRef) pendingRestoreRef.current = null
    const initialSuppressed = new Set(restore?.suppressed ?? [])
    autoSuppressedRef.current = new Set()
    applyDefaultDeselectRef.current = restore === null
    colDefaultDeselectRef.current = restore === null
    colsHandledRef.current = new Set()
    suppressedLocalitiesRef.current = initialSuppressed
    setSuppressedLocalities(initialSuppressed)
    setWizardDone(restore?.wizardDone ?? false)
    setWizardStep(0)
    skipWizardAutoOpenRef.current = !!restore?.wizardDone
    // Vider TOUT DE SUITE les localités du tracé précédent : sinon elles restaient affichées (et partaient
    // dans les films) jusqu'à la fin du nouveau calcul — pour toujours s'il échoue. Vu 2026-09-28 : les
    // localités du GR34 (Bretagne), toutes démasquées par la remise à zéro ci-dessus, empilées sur un
    // tracé en Corse. La liste vide relance aussi l'effet « retry » plus bas.
    setPreviewLocalities([])
    if (!activeTrack || points.length < 2) return
    let cancelled = false
    setLocalitiesLoading(true)
    computeAllLocalities(points, distances, activityMode, lookahead).then(locs => {
      if (!cancelled) { setPreviewLocalities(locs); setLocalitiesLoading(false); deselectByDefault(locs) }
    }).catch(() => { if (!cancelled) setLocalitiesLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, activityMode])

  // Déclenche le wizard dès que les localités + noms dep/arr sont prêts
  useEffect(() => {
    if (wizardDone || wizardStep > 0) return
    if (!isAnimateView) return
    if (!activeTrack) return
    // Tracé restauré avec le wizard déjà validé : on laisse les badges (wizardStep=0) au lieu
    // de rouvrir l'assistant sur un état wizardDone encore périmé dans cette closure.
    if (skipWizardAutoOpenRef.current) { skipWizardAutoOpenRef.current = false; return }
    // Attendre que les noms soient disponibles (geocodage async)
    setWizardStep(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnimateView, activeTrack, wizardDone])

  // Retry si on arrive sur animate avec des localités vides (Overpass lent au premier appel)
  useEffect(() => {
    if (!isAnimateView || previewLocalities.length > 0 || !activeTrack || points.length < 2) return
    let cancelled = false
    computeAllLocalities(points, distances, activityMode, lookahead).then(locs => {
      if (!cancelled && locs.length > 0) { setPreviewLocalities(locs); deselectByDefault(locs) }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnimateView, previewLocalities.length])

  /** Tracé neuf : décoche toutes les localités intermédiaires, départ et arrivée compris (hors
   * cols). Une seule fois par tracé ; jamais pour un tracé restauré depuis « Mes sillons ». Le
   * départ/l'arrivée réel(le) — dont le nom peut différer de celui de ces deux entrées si le
   * géocodage indépendant du panneau endpoint a trouvé un nom différent (ex. un hameau proche
   * plutôt que la commune) — est remis coché juste après par `releaseAutoSuppressed`, qui ne
   * matche que par nom : si les noms diffèrent, cette entrée reste décochée comme les autres et
   * l'utilisateur peut la cocher lui-même. */
  function deselectByDefault(locs: LocalityInfo[]) {
    if (!applyDefaultDeselectRef.current || locs.length === 0) return
    applyDefaultDeselectRef.current = false
    const auto = locs.filter(l => l.type !== 'col').map(l => l.name)
    autoSuppressedRef.current = new Set(auto)
    const next = new Set([...suppressedLocalitiesRef.current, ...auto])
    suppressedLocalitiesRef.current = next
    setSuppressedLocalities(next)
  }

  /** Tracé neuf : décoche aussi les cols détectés, dont les noms arrivent au fil du géocodage inverse. Chaque nom n'est
   * traité qu'une fois, pour ne pas recocher-décocher à l'encontre de l'utilisateur. */
  function deselectColsByDefault(names: string[]) {
    if (!colDefaultDeselectRef.current) return
    const fresh = names.filter(n => !colsHandledRef.current.has(n))
    if (!fresh.length) return
    for (const n of fresh) colsHandledRef.current.add(n)
    for (const n of fresh) autoSuppressedRef.current.add(n)
    const next = new Set([...suppressedLocalitiesRef.current, ...fresh])
    suppressedLocalitiesRef.current = next
    setSuppressedLocalities(next)
  }

  /** Le départ / l'arrivée dont le nom vient d'être déterminé ne doivent pas rester décochés d'office. */
  function releaseAutoSuppressed(names: (string | undefined)[]) {
    const toRelease = names.filter((n): n is string => !!n && autoSuppressedRef.current.has(n))
    if (!toRelease.length) return
    const next = new Set(suppressedLocalitiesRef.current)
    for (const n of toRelease) { next.delete(n); autoSuppressedRef.current.delete(n) }
    suppressedLocalitiesRef.current = next
    setSuppressedLocalities(next)
  }

  /** Masque une localité (clic sur un marqueur de la carte) — ajout seulement, pas de bascule. */
  function suppressLocality(name: string) {
    autoSuppressedRef.current.delete(name)
    const next = new Set([...suppressedLocalitiesRef.current, name])
    suppressedLocalitiesRef.current = next
    setSuppressedLocalities(next)
  }

  /** Réaffiche une localité masquée (re-clic sur son panneau d'aperçu sur la carte). */
  function restoreLocality(name: string) {
    autoSuppressedRef.current.delete(name)
    const next = new Set(suppressedLocalitiesRef.current)
    next.delete(name)
    suppressedLocalitiesRef.current = next
    setSuppressedLocalities(next)
  }

  /** Coche/décoche une localité dans l'assistant de validation des panneaux. */
  function toggleSuppressLocality(name: string) {
    autoSuppressedRef.current.delete(name)
    const next = new Set(suppressedLocalitiesRef.current)
    if (next.has(name)) next.delete(name); else next.add(name)
    suppressedLocalitiesRef.current = next
    setSuppressedLocalities(next)
  }

  function handleAddPanel(info: AddPanelInfo) {
    // Position de repli : le curseur s'il est posé sur le tracé, sinon le milieu du tracé. L'utilisateur
    // le place ensuite en glissant son nom de la liste vers la carte (panelDrag.ts) ou le panneau lui-même.
    const fallback = currentPoint
      ?? activeTrack?.points[Math.floor((activeTrack.points.length - 1) / 2)] ?? null
    const at = info.lon != null && info.lat != null ? { lon: info.lon, lat: info.lat } : fallback
    if (!at) return
    setCustomLocalities(prev => [...prev, {
      type: info.type,
      name: info.name,
      placeType: info.placeType,
      ele: info.ele,
      lon: at.lon,
      lat: at.lat,
      score: 0,
    }])
    // Col nommé : on géocode le nom pour le rattacher à son emplacement réel sur le tracé —
    // indispensable dès qu'il y a plusieurs cols (le repli les empilerait au même endroit)
    // et pour que le film 2D/3D déclenche le panneau au bon kilomètre.
    if (info.type === 'col') void geocodeColInto(info.name)
  }

  /** Repositionne le dernier panneau de col portant ce nom sur son emplacement géocodé. */
  async function geocodeColInto(name: string) {
    const geo = await fetchColLatLonByName(name, points).catch(() => null)
    if (!geo) return
    setCustomLocalities(prev => {
      const idx = prev.findLastIndex(l => l.type === 'col' && l.name === name)
      if (idx === -1 || prev[idx].userPlaced) return prev // posé à la main : on n'y touche pas
      const next = [...prev]
      next[idx] = { ...next[idx], lon: geo.lon, lat: geo.lat }
      return next
    })
  }

  /**
   * Validation du wizard ("Terminer") : fige les panneaux avant la lecture. On relance le
   * géocodage de chaque col (le fetch à l'ajout a pu échouer ou arriver trop tard) pour que
   * leur position soit cohérente entre l'aperçu, le film 2D et le survol 3D.
   */
  function finalizePanels() {
    for (const loc of customLocalities) {
      if (loc.type === 'col') void geocodeColInto(loc.name)
    }
    setWizardDone(true)
    setWizardStep(0)
  }

  /** Panneau ajouté déplacé sur la carte : on répercute la nouvelle position dans le state
   *  (le film 2D/3D lit `lon`/`lat` de `customLocalities`). */
  function handleMoveCustomLocality(name: string, lon: number, lat: number) {
    setCustomLocalities(prev => {
      const idx = prev.findLastIndex(l => l.name === name)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], lon, lat, userPlaced: true } // déplacé à la main : garder
      return next
    })
  }

  function handleRemoveCustomLocality(name: string) {
    setCustomLocalities(prev => {
      const idx = prev.findLastIndex(l => l.name === name)
      if (idx === -1) return prev
      return prev.filter((_, i) => i !== idx)
    })
  }

  return {
    previewLocalities, localitiesLoading, customLocalities, setCustomLocalities,
    suppressedLocalities, suppressedLocalitiesRef,
    wizardStep, setWizardStep, wizardDone, setWizardDone,
    suppressLocality, restoreLocality, toggleSuppressLocality, releaseAutoSuppressed, deselectColsByDefault,
    handleAddPanel, handleRemoveCustomLocality, handleMoveCustomLocality, finalizePanels,
  }
}
