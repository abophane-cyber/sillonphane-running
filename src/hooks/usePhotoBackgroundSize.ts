import { useEffect, useState, type RefObject } from 'react'

const naturalSizeCache = new Map<string, { w: number; h: number }>()

function loadNaturalSize(url: string): Promise<{ w: number; h: number }> {
  const cached = naturalSizeCache.get(url)
  if (cached) return Promise.resolve(cached)
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 }
      naturalSizeCache.set(url, natural)
      resolve(natural)
    }
    img.onerror = () => resolve({ w: 1, h: 1 })
    img.src = url
  })
}

/** `background-size` d'une photo recadrée en 'cover' + zoom utilisateur (photoScale), calculé pour
 * que le zoom libère toujours du recadrage sur les DEUX axes. Avec un simple `cover` + `scale()`
 * CSS, l'axe déjà pile ajusté à la case (celui où `object-position`/`background-position` n'a
 * aucune marge) reste à zéro marge quel que soit le zoom — puisque `scale()` agrandit les deux
 * axes dans la même proportion après coup, ça ne débloque rien. On ne dimensionne donc qu'un seul
 * axe (celui qui pilote le recadrage 'cover', × l'échelle) et on laisse l'autre en 'auto' — le
 * navigateur le calcule depuis le vrai ratio de la photo, ce qui donne une marge réelle des deux
 * côtés dès que l'échelle dépasse 1. */
export function usePhotoBackgroundSize(
  boxRef: RefObject<HTMLElement | null>,
  url: string | undefined,
  scale: number,
  fit: 'cover' | 'contain' = 'cover',
): string {
  const [computedSize, setComputedSize] = useState<string | null>(null)

  useEffect(() => {
    if (fit === 'contain' || !url) return
    let cancelled = false
    let observer: ResizeObserver | undefined

    loadNaturalSize(url).then(natural => {
      if (cancelled) return
      const apply = () => {
        const el = boxRef.current
        if (!el || !el.clientWidth || !el.clientHeight) return
        const boxAspect = el.clientWidth / el.clientHeight
        const imgAspect = natural.w / natural.h
        setComputedSize(boxAspect > imgAspect ? `${scale * 100}% auto` : `auto ${scale * 100}%`)
      }
      apply()
      const el = boxRef.current
      if (el && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(apply)
        observer.observe(el)
      }
    })

    return () => { cancelled = true; observer?.disconnect() }
  }, [boxRef, url, scale, fit])

  if (fit === 'contain') return 'contain'
  if (!url) return 'cover'
  return computedSize ?? 'cover'
}
