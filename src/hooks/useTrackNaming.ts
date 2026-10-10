import { useEffect, useState } from 'react'
import { fetchLocalityInfo, isLieuditPlaceType } from './useLocality'
import type { GpxTrack } from '../types'

/** Style choisi pour le panneau de départ / d'arrivée ; absent = déduit du géocodage. */
export type EndpointKind = 'localite' | 'lieudit'

/** Titre personnalisé + noms de départ/arrivée, géocodés automatiquement au chargement du tracé.
 * Un col nommé au départ / à l'arrivée (`startCol` / `endCol`) remplace le nom de localité géocodé
 * (ou restauré tel quel depuis « Mes sillons »), tant que l'utilisateur n'a pas saisi le sien. */
export function useTrackNaming(activeTrack: GpxTrack | null, startCol?: string, endCol?: string) {
  const [customTitle, setCustomTitle] = useState('')
  const [startName, setStartNameRaw] = useState('')
  const [endName, setEndNameRaw] = useState('')
  // Noms géocodés automatiquement, et saisie de l'utilisateur (qui n'est jamais écrasée par un col).
  const [geoStart, setGeoStart] = useState('')
  const [geoEnd, setGeoEnd] = useState('')
  // Type OSM du lieu géocodé (hamlet, village…) : décide du panneau lieu-dit vs localité.
  const [geoStartType, setGeoStartType] = useState<string | undefined>()
  const [geoEndType, setGeoEndType] = useState<string | undefined>()
  const [startEdited, setStartEdited] = useState(false)
  const [endEdited, setEndEdited] = useState(false)
  // Style imposé par l'utilisateur (assistant panneaux) ; null = automatique.
  const [startKind, setStartKind] = useState<EndpointKind | null>(null)
  const [endKind, setEndKind] = useState<EndpointKind | null>(null)

  useEffect(() => {
    setGeoStart(''); setGeoEnd('')
    setGeoStartType(undefined); setGeoEndType(undefined)
    setStartEdited(false); setEndEdited(false)
    if (!activeTrack) return
    const first = activeTrack.points[0]
    const last  = activeTrack.points[activeTrack.points.length - 1]
    // Réponse arrivée après le changement de tracé ignorée (sinon « Dijon », arrivée du tracé précédent, devenait
    // celle du semi de Lille).
    let stale = false
    Promise.all([
      fetchLocalityInfo(first.lon, first.lat),
      fetchLocalityInfo(last.lon, last.lat),
    ]).then(([start, end]) => {
      if (stale) return
      if (start?.name) { setGeoStart(start.name); setGeoStartType(start.placeType); setStartNameRaw(n => n || start.name) }
      if (end?.name)   { setGeoEnd(end.name);     setGeoEndType(end.placeType);     setEndNameRaw(n => n || end.name) }
    })
    return () => { stale = true }
  }, [activeTrack])

  // Réévalué à chaque changement : le nom du col, le géocodage et la restauration arrivent dans n'importe quel ordre.
  useEffect(() => {
    if (!startCol || startEdited || startName === startCol) return
    if (!startName || startName === geoStart) setStartNameRaw(startCol)
  }, [startCol, startName, geoStart, startEdited])

  useEffect(() => {
    if (!endCol || endEdited || endName === endCol) return
    if (!endName || endName === geoEnd) setEndNameRaw(endCol)
  }, [endCol, endName, geoEnd, endEdited])

  /** Saisie de l'utilisateur (assistant panneaux, écran de résumé). */
  function setStartName(v: string) { setStartEdited(true); setStartNameRaw(v) }
  function setEndName(v: string) { setEndEdited(true); setEndNameRaw(v) }
  /** Noms restaurés depuis « Mes sillons » (ou remis à zéro) : pas une saisie, un col peut encore les remplacer. */
  function restoreNames(start: string, end: string, startK?: EndpointKind, endK?: EndpointKind) {
    setStartNameRaw(start); setEndNameRaw(end)
    setStartKind(startK ?? null); setEndKind(endK ?? null)
  }

  // Style choisi par l'utilisateur, sinon lieu-dit tant que le nom affiché est celui géocodé sur un
  // hameau / lieu-dit (un nom saisi reste une localité par défaut). Un col garde son style (voir App).
  const startLieudit = startKind ? startKind === 'lieudit'
    : !!startName && startName === geoStart && isLieuditPlaceType(geoStartType)
  const endLieudit = endKind ? endKind === 'lieudit'
    : !!endName && endName === geoEnd && isLieuditPlaceType(geoEndType)

  return {
    customTitle, setCustomTitle, startName, setStartName, endName, setEndName, restoreNames,
    startLieudit, endLieudit, startKind, endKind, setStartKind, setEndKind,
  }
}
