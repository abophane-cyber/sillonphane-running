// Enregistrement GPS écran éteint : seule l'app Android empaquetée (Capacitor) le permet.
// iOS n'est pas pris en charge (pas de build iOS) : ces utilisateurs repartent directement sur l'import GPX classique.
export const canRecordGps = () =>
  typeof window !== 'undefined' &&
  window.innerWidth < 768 &&
  'geolocation' in navigator &&
  /Android/i.test(navigator.userAgent)

// Visiteur sur navigateur Android (PWA, pas l'appli empaquetée) : on lui propose de télécharger
// l'APK plutôt que d'installer la PWA, seule cette dernière ne permettant pas l'enregistrement
// GPS écran éteint/appli fermée (voir geoBackend.ts).
export const isAndroidBrowser = () =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
