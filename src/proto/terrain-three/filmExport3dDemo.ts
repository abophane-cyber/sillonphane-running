// Banc de test de l'export vidéo 3D (export.html). Données de test copiées de main.ts — en P2
// elles viendront du vrai GPX / PanelWizard / meteo.ts de l'app.

import { exportFilm3d } from '../../lib/terrain3d/filmExport3d'
import { parseEventName } from '../../lib/raceSplits'

const TRAIL: [number, number][] = [ // Sotteville-Veules — 117 pts, 7.8 km, BOUCLE, côte normande
  [0.82973, 49.88728], [0.82754, 49.88673], [0.82567, 49.88601], [0.82393, 49.88525],
  [0.82538, 49.88291], [0.82689, 49.88193], [0.82794, 49.88180], [0.82800, 49.88154],
  [0.82802, 49.88127], [0.82814, 49.88006], [0.82812, 49.87961], [0.82810, 49.87919],
  [0.82713, 49.87924], [0.82570, 49.87917], [0.82389, 49.87899], [0.82375, 49.87900],
  [0.82377, 49.87883], [0.82360, 49.87862], [0.82336, 49.87830], [0.82302, 49.87793],
  [0.82261, 49.87747], [0.82235, 49.87718], [0.82213, 49.87692], [0.82180, 49.87645],
  [0.82157, 49.87613], [0.82126, 49.87584], [0.82046, 49.87529], [0.82020, 49.87509],
  [0.81982, 49.87481], [0.81942, 49.87451], [0.81886, 49.87411], [0.81857, 49.87391],
  [0.81823, 49.87365], [0.81795, 49.87342], [0.81761, 49.87313], [0.81732, 49.87288],
  [0.81678, 49.87243], [0.81641, 49.87211], [0.81600, 49.87177], [0.81578, 49.87160],
  [0.81552, 49.87142], [0.81519, 49.87119], [0.81458, 49.87082], [0.81382, 49.87037],
  [0.81305, 49.86998], [0.81232, 49.86966], [0.81174, 49.86942], [0.81142, 49.86929],
  [0.81129, 49.86957], [0.81116, 49.86982], [0.81090, 49.87009], [0.81052, 49.87044],
  [0.81030, 49.87064], [0.80992, 49.87095], [0.80947, 49.87129], [0.80909, 49.87157],
  [0.80873, 49.87182], [0.80838, 49.87204], [0.80805, 49.87229], [0.80760, 49.87257],
  [0.80713, 49.87286], [0.80608, 49.87245], [0.80553, 49.87226], [0.80487, 49.87201],
  [0.80396, 49.87159], [0.80229, 49.87117], [0.80258, 49.87091], [0.80256, 49.87066],
  [0.80244, 49.87045], [0.80217, 49.87025], [0.80193, 49.87003], [0.80159, 49.87022],
  [0.80128, 49.87042], [0.80088, 49.87064], [0.80068, 49.87083], [0.80093, 49.87108],
  [0.80114, 49.87149], [0.80120, 49.87171], [0.80122, 49.87198], [0.80120, 49.87226],
  [0.80116, 49.87252], [0.80110, 49.87277], [0.80087, 49.87303], [0.80047, 49.87336],
  [0.79996, 49.87377], [0.79966, 49.87404], [0.79934, 49.87422], [0.79900, 49.87449],
  [0.79899, 49.87475], [0.79888, 49.87497], [0.79889, 49.87530], [0.79896, 49.87568],
  [0.79908, 49.87601], [0.79944, 49.87630], [0.79932, 49.87640], [0.79884, 49.87650],
  [0.79877, 49.87670], [0.79889, 49.87692], [0.79903, 49.87712], [0.79870, 49.87713],
  [0.79909, 49.87718], [0.79929, 49.87736], [0.80031, 49.87774], [0.80093, 49.87797],
  [0.80348, 49.87900], [0.80570, 49.88000], [0.80782, 49.88077], [0.81001, 49.88132],
  [0.81476, 49.88260], [0.81796, 49.88386], [0.82113, 49.88499], [0.82262, 49.88561],
  [0.82563, 49.88714], [0.82893, 49.88844], [0.82951, 49.88833], [0.82975, 49.88766],
  [0.82973, 49.88728],
]

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const bar = $<HTMLElement>('bar').firstElementChild as HTMLElement
const label = $<HTMLElement>('label')
const errEl = $<HTMLElement>('err')
const goBtn = $<HTMLButtonElement>('go')
const cancelBtn = $<HTMLButtonElement>('cancel')
const dl = $<HTMLAnchorElement>('dl')
const preview = $<HTMLVideoElement>('preview')

const gpxInput = $<HTMLInputElement>('gpx')
const fpsInput = $<HTMLInputElement>('fps')
const mbpsInput = $<HTMLInputElement>('mbps')

let ctrl: AbortController | null = null

/** Points [lon, lat] des <trkpt> d'un GPX (les <wpt> sont ignorés). */
function parseGpxTrail(xml: string): [number, number][] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName('trkpt')).map(p =>
    [parseFloat(p.getAttribute('lon')!), parseFloat(p.getAttribute('lat')!)] as [number, number])
}

function trailKm(trail: [number, number][]): number {
  let d = 0
  for (let i = 1; i < trail.length; i++) {
    const [lo0, la0] = trail[i - 1], [lo1, la1] = trail[i]
    d += 6371 * Math.hypot((la1 - la0) * Math.PI / 180, (lo1 - lo0) * Math.PI / 180 * Math.cos(la0 * Math.PI / 180))
  }
  return d
}

goBtn.addEventListener('click', async () => {
  errEl.textContent = ''
  dl.style.display = 'none'
  preview.style.display = 'none'
  goBtn.disabled = true
  cancelBtn.disabled = false
  ctrl = new AbortController()
  const t0 = performance.now()

  try {
    const file = gpxInput.files?.[0]
    const xml = file ? await file.text() : ''
    const trail = file ? parseGpxTrail(xml) : TRAIL
    // Épreuve tirée du nom du GPX (localité : le mot qui précède l'année, à défaut du lieu de départ connu de l'appli).
    const trkName = xml.match(/<name>([^<]*)<\/name>/)?.[1]
    const ev = parseEventName(trkName, trkName?.match(/(\p{Lu}[\p{L}-]+)\s+\d{4}/u)?.[1])
    // Même durée demandée que l'app (useFilm3dExport : niveau 1, facteur 1,6).
    const durationS = Math.min(45, Math.max(10, trailKm(trail) * 2)) * 1.6
    const blob = await exportFilm3d({
      trail,
      trailDate: file ? '17 septembre 2026' : '10 août 2026',
      ...(ev.title && ev.place ? { eventCartouche: { title: ev.title, place: ev.place } } : {}),
      departureName: file ? 'Départ' : 'Sotteville-sur-Mer',
      arrivalName: file ? 'Arrivée' : 'Sotteville-sur-Mer',
      panels: file ? [] : [{ name: 'Veules-les-Roses', lon: 0.8006, lat: 49.8709, style: 'lieudit' }],
      weather: { hourOfDay: 16, cloudCover: 0.35 },
      durationS,
      fps: Math.max(5, Math.min(60, Number(fpsInput.value) || 30)),
      videoMaxMbps: Number(mbpsInput.value) || undefined,
      openingOnly,
      signal: ctrl.signal,
      onProgress: ({ phase, ratio, label: l, etaS }) => {
        const pct = phase === 'prepare' ? ratio * 15 : 15 + ratio * 85
        bar.style.width = `${pct.toFixed(1)}%`
        const eta = etaS != null ? ` — reste ~${Math.round(etaS)} s` : ''
        label.textContent = `${phase === 'prepare' ? 'Préparation' : 'Rendu'} — ${l} (${pct.toFixed(0)} %)${eta}`
      },
    })

    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    label.textContent = `Terminé en ${secs} s — ${(blob.size / 1e6).toFixed(1)} Mo`
    const url = URL.createObjectURL(blob)
    dl.href = url
    dl.style.display = 'inline-block'
    preview.src = url
    preview.style.display = 'block'
    if (openingOnly) { preview.muted = true; preview.loop = true; void preview.play() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errEl.textContent = msg === 'aborted' ? 'Export annulé.' : `Échec : ${msg}`
  } finally {
    goBtn.disabled = false
    cancelBtn.disabled = true
    ctrl = null
  }
})

cancelBtn.addEventListener('click', () => ctrl?.abort())

// « ?ouverture » : seules les premières secondes (l'ouverture) sont rendues, sur le semi-marathon de Lille de
// public/demo, lancé tout seul au chargement, et la vidéo se rejoue en boucle.
const openingOnly = new URLSearchParams(location.search).has('ouverture')
if (openingOnly) {
  void (async () => {
    const xml = await (await fetch(`${import.meta.env.BASE_URL}demo/_essai-semi-lille.gpx`)).text()
    const dt = new DataTransfer()
    dt.items.add(new File([xml], 'Parcours Semi-marathon Lille 2026.gpx', { type: 'application/gpx+xml' }))
    gpxInput.files = dt.files
    goBtn.click()
  })()
}
