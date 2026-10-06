// Journal de diagnostic : chaque étape est écrite dans la
// console avec le préfixe [diag] et gardée en mémoire. Dans la console du navigateur (F12),
// `copy(__sillonDiag())` copie tout le journal pour le transmettre.

const entries: string[] = []

export function diag(step: string, data?: unknown) {
  const t = new Date().toISOString().slice(11, 23)
  let extra = ''
  if (data !== undefined) {
    try { extra = ' ' + (data instanceof Error ? `${data.name}: ${data.message}\n${data.stack ?? ''}` : JSON.stringify(data)) }
    catch { extra = ' ' + String(data) }
  }
  const line = `${t} ${step}${extra}`
  entries.push(line)
  if (entries.length > 500) entries.shift()
  console.log('[diag]', line)
}

/** Erreurs non rattrapées + informations sur le navigateur, posées une fois au démarrage. */
export function installDiag() {
  const w = window as unknown as { __sillonDiag?: () => string }
  w.__sillonDiag = () => entries.join('\n')
  let webgl2 = false
  try { webgl2 = !!document.createElement('canvas').getContext('webgl2') } catch { /* pas de WebGL2 */ }
  diag('démarrage', { ua: navigator.userAgent, webgl2, url: location.href, dpr: window.devicePixelRatio })
  window.addEventListener('error', e => diag('erreur non rattrapée', e.error ?? e.message))
  window.addEventListener('unhandledrejection', e => diag('promesse rejetée', e.reason))
}
