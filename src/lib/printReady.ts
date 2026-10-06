/** Attend que toutes les <img> sous `root` aient fini de charger (succès ou échec). */
export function waitForImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  return Promise.all(
    images.map(img => {
      if ((img as HTMLImageElement).complete) return Promise.resolve()
      return new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      })
    })
  ).then(() => undefined)
}
