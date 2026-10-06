import { createContext, useContext, useEffect, useRef } from 'react'

export interface HeaderBackState {
  label: string
  onClick: () => void
}

export const HeaderBackContext = createContext<((back: HeaderBackState | null) => void) | null>(null)

/** Enregistre le bouton retour de la page courante dans le header global de l'app. */
export function useHeaderBack(label: string, onClick: () => void, active = true) {
  const setBack = useContext(HeaderBackContext)
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  useEffect(() => {
    if (!setBack || !active) return
    setBack({ label, onClick: () => onClickRef.current() })
    return () => setBack(null)
  }, [setBack, label, active])
}
