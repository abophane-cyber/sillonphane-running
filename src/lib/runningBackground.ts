/** Photo de fond des écrans clairs (accueil, Mes sillons, écran d'un sillon, choix de l'affiche, livre) :
 *  tirée au hasard à chaque ouverture de l'appli, puis gardée pendant toute la visite.
 *  Les feuilles de style lisent `--running-bg` et `--running-bg-pos` (repli : la photo de montagne). */
const BACKGROUNDS: { file: string; pos: string }[] = [
  { file: 'fond-montagne.webp', pos: '70% center' },
  { file: 'fond-nice.webp', pos: '60% center' },
  { file: 'fond-paris.webp', pos: '55% center' },
  { file: 'fond-lyon.webp', pos: '55% 60%' },
]

export function pickRunningBackground(): void {
  const bg = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]
  const root = document.documentElement.style
  root.setProperty('--running-bg', `url('${import.meta.env.BASE_URL}demo/${bg.file}')`)
  root.setProperty('--running-bg-pos', bg.pos)
}
