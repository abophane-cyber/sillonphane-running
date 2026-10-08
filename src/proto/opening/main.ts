// Banc d'essai de l'ouverture, sans rendre de film : image fixe (t = 4 s), ou animation du début de l'ouverture (le
// tracé se dessine sur fond blanc pendant que la carte, puis le titre apparaissent), en boucle.
// Tracé : le GPX choisi, sinon public/demo/_essai-semi-lille.gpx ; lieux préremplis pour ce tracé (données d'essai).
import { buildOpeningEvent, drawOpeningScene, loadOpeningFont, OPENING, type OpeningEvent } from '../../lib/filmOpening'
import { captureOpeningView, cumulativeDistances, type OpeningShot } from '../../lib/openingMap'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('out')
const ctx = canvas.getContext('2d')!
const msg = $<HTMLElement>('msg')
let current: { shot: OpeningShot; ev: OpeningEvent } | null = null
let anim = 0

/** Image de l'ouverture à l'instant t. */
function frame(t: number) {
  if (!current) return
  const { shot, ev } = current
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(shot.image, 0, 0)
  drawOpeningScene(ctx, canvas.width, canvas.height, t, ev, { ribbon: shot.ribbon, pois: shot.pois, waters: shot.waters })
}

async function render() {
  cancelAnimationFrame(anim)
  msg.textContent = 'Rendu…'
  const t0 = performance.now()
  const file = $<HTMLInputElement>('gpx').files?.[0]
  const xml = file ? await file.text() : await (await fetch(`${import.meta.env.BASE_URL}demo/_essai-semi-lille.gpx`)).text()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const route = Array.from(doc.getElementsByTagName('trkpt'))
    .map(p => ({ lon: parseFloat(p.getAttribute('lon')!), lat: parseFloat(p.getAttribute('lat')!) }))
  const dist = cumulativeDistances(route)
  const pois = $<HTMLTextAreaElement>('pois').value.split('\n').map(l => l.split(';')).filter(p => p.length >= 3)
    .map(([name, lat, lon, type, icon]) => ({ name: name.trim(), lat: parseFloat(lat), lon: parseFloat(lon), type: type?.trim() || 'poi', icon: icon?.trim() }))
  await loadOpeningFont()
  const shot = await captureOpeningView({ route, dist, pois, width: canvas.width, height: canvas.height })
  const ev = buildOpeningEvent({
    title: $<HTMLInputElement>('title').value, city: $<HTMLInputElement>('city').value, date: $<HTMLInputElement>('date').value,
    distanceM: dist[dist.length - 1], elevGainM: Number($<HTMLInputElement>('gain').value) || 0,
  })
  current = { shot, ev }
  frame(4)
  msg.textContent = `Rendu en ${((performance.now() - t0) / 1000).toFixed(1)} s`
}

/** Joue le début de l'ouverture (jusqu'au début du passage à la première scène), en boucle. */
async function animate() {
  if (!current) await render()
  cancelAnimationFrame(anim)
  const start = performance.now()
  const loop = () => {
    const t = ((performance.now() - start) / 1000) % (OPENING.diveFromS + 0.8)
    frame(t)
    msg.textContent = `t = ${t.toFixed(1)} s`
    anim = requestAnimationFrame(loop)
  }
  loop()
}

$<HTMLButtonElement>('go').addEventListener('click', () => { render().catch(e => { msg.textContent = `Échec : ${e}` }) })
$<HTMLButtonElement>('play').addEventListener('click', () => { animate().catch(e => { msg.textContent = `Échec : ${e}` }) })
$<HTMLButtonElement>('png').addEventListener('click', () => {
  const a = document.createElement('a')
  a.download = 'ouverture.png'
  a.href = canvas.toDataURL('image/png')
  a.click()
})
