import { useState } from 'react'

export function normalizeTime(val: string): string {
  const digits = val.replace(/\D/g, '')
  if (digits.length === 0) return ''
  const h = digits.slice(0, 2).padStart(2, '0')
  const m = digits.length > 2 ? digits.slice(2, 4).padEnd(2, '0') : '00'
  return `${h}:${m}`
}

/** Formulaire de date/heures de l'écran d'import, avec sa validation avant de continuer. */
export function useUploadForm() {
  const [manualDate, setManualDate] = useState('')
  const [departureTime, setDepartureTime] = useState('')
  const [arrivalTime, setArrivalTime] = useState('')
  const [triedContinue, setTriedContinue] = useState(false)

  /** Retourne true si le formulaire est valide (ou si `force`) et qu'on peut continuer. */
  function handleUploadContinue(force = false): boolean {
    if (!force && (!manualDate || (manualDate && (!departureTime || !arrivalTime)))) {
      setTriedContinue(true)
      return false
    }
    setTriedContinue(false)
    return true
  }

  return {
    manualDate, setManualDate,
    departureTime, setDepartureTime,
    arrivalTime, setArrivalTime,
    triedContinue, setTriedContinue,
    handleUploadContinue,
  }
}
