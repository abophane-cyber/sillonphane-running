/**
 * seed-album-demo.mjs — Injecte un sillon de demo (trace + photos placeholder + album auto-compose)
 * directement dans IndexedDB, sans passer par tout le parcours utilisateur (wizard, apercu complet,
 * upload de vraies photos EXIF), puis capture l'ecran d'album resultant pour la landing.
 *
 * Usage : npm run dev (autre terminal, port 4325) puis node scripts/seed-album-demo.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'album-out')
mkdirSync(OUT_DIR, { recursive: true })

const GPX_TEXT = readFileSync(join(__dirname, '..', 'public', 'demo', 'demo-track.gpx'), 'utf8')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()) })
page.on('pageerror', err => console.log('[page error]', err.message))

await page.goto('http://localhost:4325/app.html')
await page.waitForTimeout(2500)
await page.evaluate(() => document.querySelector('.splash__next')?.click())
await page.waitForTimeout(300)
await page.evaluate(() => document.querySelector('.how__start')?.click())
await page.waitForTimeout(500)

// ── Injection des donnees via les vrais modules de l'appli ──────────────────────
const result = await page.evaluate(async (gpxText) => {
  const voyageDB = await import('/src/lib/voyageDB.ts')
  const albumPagesLib = await import('/src/lib/albumPages.ts')

  // Points approximatifs le long du parcours (region du Beaufortain) pour placer les photos
  const photoSpots = [
    { label: 'Depart', color1: '#2F5C45', color2: '#0f1a12', lat: 45.85, lon: 6.55, t: '2026-07-14T06:35:00Z' },
    { label: 'Foret',  color1: '#3f6b3a', color2: '#1a2b1a', lat: 45.87, lon: 6.575, t: '2026-07-14T07:40:00Z' },
    { label: 'Crete',  color1: '#8a6a4a', color2: '#2a2018', lat: 45.895, lon: 6.585, t: '2026-07-14T08:50:00Z' },
    { label: 'Sommet', color1: '#D97A3D', color2: '#2A2723', lat: 45.915, lon: 6.592, t: '2026-07-14T09:45:00Z' },
    { label: 'Vue',    color1: '#4a7a8a', color2: '#152025', lat: 45.92, lon: 6.595, t: '2026-07-14T10:10:00Z' },
  ]

  function drawPlaceholder(label, color1, color2) {
    const canvas = document.createElement('canvas')
    canvas.width = 800; canvas.height = 600
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, 600)
    grad.addColorStop(0, color1)
    grad.addColorStop(1, color2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 800, 600)
    // silhouette de montagne
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.moveTo(0, 420)
    ctx.lineTo(160, 260)
    ctx.lineTo(300, 360)
    ctx.lineTo(460, 200)
    ctx.lineTo(620, 340)
    ctx.lineTo(800, 260)
    ctx.lineTo(800, 600)
    ctx.lineTo(0, 600)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = 'bold 40px Georgia, serif'
    ctx.fillText(label, 36, 550)
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  }

  let voyage = await voyageDB.getDefaultSillon()
  const track = await voyageDB.addTrackToVoyage(voyage.id, {
    name: 'Sortie du Beaufortain',
    gpxData: gpxText,
    date: '2026-07-14',
  })

  const photoEntries = []
  for (const spot of photoSpots) {
    const blob = await drawPlaceholder(spot.label, spot.color1, spot.color2)
    const entry = await voyageDB.addPhotoToVoyage(voyage.id, {
      name: `${spot.label}.png`,
      trackId: track.id,
      takenAt: spot.t,
      lat: spot.lat,
      lon: spot.lon,
    }, blob)
    photoEntries.push(entry)
  }

  const pages = albumPagesLib.autoFillPages(photoEntries)
  await voyageDB.saveTrackAlbumPages(voyage.id, track.id, pages)

  return { voyageId: voyage.id, trackId: track.id, pages: pages.length, photos: photoEntries.length }
}, GPX_TEXT)

console.log('seeded:', JSON.stringify(result))

// ── Navigation vers l'album pre-compose ──────────────────────────────────────────
await page.evaluate(() => document.querySelector('.gpx-uploader--sillons')?.click())
await page.waitForTimeout(1000)
await page.evaluate(() => document.querySelector('.vp-card')?.click())
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT_DIR}/sillon-detail.png` })

const clickedAlbum = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes("Voir l'album"))
  if (btn) { btn.click(); return true }
  return false
})
console.log('clicked album view:', clickedAlbum)
await page.waitForTimeout(1200)
await page.locator('.asp2-a4').first().screenshot({ path: `${OUT_DIR}/album-view.png` })
await page.locator('.asp2-pp-box').nth(3).screenshot({ path: `${OUT_DIR}/album-box-sommet.png` })

await browser.close()
console.log('done, screenshots in', OUT_DIR)
