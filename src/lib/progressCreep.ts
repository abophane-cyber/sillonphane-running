// Progression continue des phases de préparation des films : les étapes réelles sont espacées de
// plusieurs secondes ; entre deux, la barre glisse lentement vers l'étape suivante (sans jamais
// l'atteindre) au lieu de rester figée puis de sauter. Penser à `stop()` en fin de phase.
export function makeProgressCreep(emit: (ratio: number) => void) {
  let cur = 0, target = 0, stopped = false
  const timer = setInterval(() => {
    if (stopped || target - cur < 0.002) return
    cur += (target - cur) * 0.03
    emit(cur)
  }, 200)
  return {
    // `next` = prochaine étape connue : cible du glissement (un cheveu en dessous).
    set(ratio: number, next?: number) {
      if (stopped) return
      cur = Math.max(cur, ratio)
      target = next !== undefined ? Math.max(cur, next - 0.01) : cur
      emit(cur)
    },
    stop() { stopped = true; clearInterval(timer) },
  }
}
