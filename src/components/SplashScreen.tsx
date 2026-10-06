import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { NATIVE_VERSION_NAME, NATIVE_VERSION_CODE } from '../nativeVersion'

interface Props {
  onNext: () => void
}

// Mêmes photos que le diaporama de la landing (public/hero, embarquées dans l'APK).
const PHOTOS = [1, 2, 3, 4, 5, 6, 7].map((n) => `${import.meta.env.BASE_URL}hero/rando-${n}.jpg`)
const SLIDE_MS = 3200

export default function SplashScreen({ onNext }: Props) {
  const [cur, setCur] = useState(0)
  // Photos chargées au fil de l'eau : la 1re tout de suite, chaque suivante pendant l'affichage de la précédente.
  const [loaded, setLoaded] = useState(1)
  const [rise, setRise] = useState(false)
  const curRef = useRef(0)
  const loadedRef = useRef(1)
  loadedRef.current = loaded

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      const next = (curRef.current + 1) % PHOTOS.length
      if (next >= loadedRef.current) return // pas encore chargée : on attend le tour suivant
      curRef.current = next
      setRise((r) => !r && Math.random() < 0.12) // rare (≈ 1 photo sur 8) et jamais deux fois de suite
      setCur(next)
    }, SLIDE_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="splash">
      {PHOTOS.slice(0, Math.min(loaded + 1, PHOTOS.length)).map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          className={`splash__photo splash__photo--${i + 1}${i === cur ? ' is-on' : ''}${i === cur && rise ? ' is-rise' : ''}`}
          onLoad={() => setLoaded((l) => Math.max(l, i + 1))}
        />
      ))}
      <div className="splash__scrim" />

      <div className="splash__in">
        <svg className="splash__sigle" viewBox="96 34 154 218" aria-hidden="true">
          <defs>
            <linearGradient id="splashMk" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#2F4839" />
              <stop offset="50%" stopColor="#C15C3D" />
              <stop offset="100%" stopColor="#F5F3EF" />
            </linearGradient>
          </defs>
          <path
            pathLength="1"
            d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
            fill="none" stroke="url(#splashMk)" strokeWidth="29" strokeLinecap="round"
            className="splash__draw" style={{ animationDelay: '0.4s' }}
          />
          <circle cx="220" cy="60" r="11" fill="#2F4839" stroke="#F5F3EF" strokeWidth="4"
            className="splash__dot" style={{ animationDelay: '1.95s' }} />
          <circle cx="138" cy="225" r="11" fill="#F5F3EF"
            className="splash__dot" style={{ animationDelay: '0.45s' }} />
        </svg>

        <p className="splash__brand">Sillonphane-<i>Rando</i></p>

        <h1 className="splash__title">
          Transformez vos <i className="t-terra">randonnées</i> en&nbsp;<i className="t-forest">souvenirs</i>
        </h1>

        <button className="splash__next" onClick={onNext}>Commencer →</button>
      </div>

      {/* legal.html est embarquée dans l'APK (copiée depuis public/) : lisible hors ligne, et son
          lien « ← Accueil » (vers /) ramène à l'appli. */}
      <p className="splash__version">
        {Capacitor.isNativePlatform() && <>version {NATIVE_VERSION_NAME} ({NATIVE_VERSION_CODE}) · </>}
        <a href={`${import.meta.env.BASE_URL}legal.html`}>Infos légales</a>
      </p>
    </div>
  )
}
