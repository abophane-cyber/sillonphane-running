import type { ReactNode } from 'react'

interface Props {
  icon?: string
  children: ReactNode
  onClose: () => void
  className?: string
}

export function OnboardingBubble({ icon = '💡', children, onClose, className = '' }: Props) {
  return (
    <div className={`onboarding-bubble ${className}`}>
      <button className="onboarding-bubble__close" onClick={onClose} aria-label="Fermer">✕</button>
      <div className="onboarding-bubble__content">
        <span className="onboarding-bubble__icon">{icon}</span>
        <p className="onboarding-bubble__text">{children}</p>
      </div>
    </div>
  )
}
