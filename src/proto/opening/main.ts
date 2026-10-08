// Banc d'essai de l'ouverture : une image fixe (t = 4 s) avec les données saisies, sans rendre de film.
// Tracé : le GPX choisi, sinon public/demo/_essai-semi-lille.gpx ; lieux préremplis pour ce tracé (données d'essai).
import { buildOpeningEvent, drawOpeningScene, loadOpeningFont } from '../../lib/filmOpening'
import { captureOpeningView, cumulativeDistances } from '../../lib/openingMap'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('out')
const msg = $<HTMLElement>('msg')

async function render() {
  msg.textContent = 'Rendu…'
  const t0 = performance.now()
  const file = $<HTMLInputElement>('gpx').files?.[0]
  const xml = file ? await file.text() : await (await fetch(`${import.meta.env.BASE_URL}demo/_essai-semi-lille.gpx`)).text()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const route = Array.from(doc.getElementsByTagName('trkpt'))
    .map(p => ({ lon: parseFloat(p.getAttribute('lon')!), lat: parseFloat(p.getAttribute('lat')!) }))
  const dist = cumulativeDistances(route)
  const pois = $<HTMLTextAreaElement>('pois').value.split('\n').map(l => l.split(';')).filter(p => p.length >= 3)
    .map(([name, lat, lon, type]) => ({ name: name.trim(), lat: parseFloat(lat), lon: parseFloat(lon), type: type?.trim() || 'poi' }))
  await loadOpeningFont()
  const shot = await captureOpeningView({ route, dist, pois, width: canvas.width, height: canvas.height })
  const ev = buildOpeningEvent({
    title: $<HTMLInputElement>('title').value, city: $<HTMLInputElement>('city').value, date: $<HTMLInputElement>('date').value,
    distanceM: dist[dist.length - 1], elevGainM: Number($<HTMLInputElement>('gain').value) || 0,
  })
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(shot.image, 0, 0)
  drawOpeningScene(ctx, canvas.width, canvas.height, 4, ev, { ribbon: shot.ribbon, pois: shot.pois })
  msg.textContent = `Rendu en ${((performance.now() - t0) / 1000).toFixed(1)} s`
}

$<HTMLButtonElement>('go').addEventListener('click', () => { render().catch(e => { msg.textContent = `Échec : ${e}` }) })
$<HTMLButtonElement>('png').addEventListener('click', () => {
  const a = document.createElement('a')
  a.download = 'ouverture.png'
  a.href = canvas.toDataURL('image/png')
  a.click()
})
