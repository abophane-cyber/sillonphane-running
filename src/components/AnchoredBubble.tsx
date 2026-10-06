import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { OnboardingBubble } from './OnboardingBubble'

interface Props {
  icon?: string
  children: ReactNode
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

export function AnchoredBubble({ icon, children, onClose, anchorRef }: Props) {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  useLayoutEffect(() => {
    function update() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 12 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const ro = new ResizeObserver(update)
    if (anchorRef.current) ro.observe(anchorRef.current)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      ro.disconnect()
    }
  }, [anchorRef])

  if (!pos) return null

  return createPortal(
    <div style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, zIndex: 9999 }}>
      <OnboardingBubble icon={icon} onClose={onClose} className="onboarding-bubble--target">
        {children}
      </OnboardingBubble>
    </div>,
    document.body,
  )
}
