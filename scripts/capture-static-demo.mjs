/**
 * capture-static-demo.mjs — Capture UNE image fixe pleine page (bandeau + carte + randonneur +
 * profil altimetrique + stats) pour le mockup telephone du hero, quand l'animation video pose
 * trop de compromis de cadrage. Reutilise le meme parcours de demo que capture-demo.mjs.
 *
 * Usage : npm run dev (autre terminal, port 4325) puis node scripts/capture-static-demo.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'videos')
mkdirSync(OUT_DIR, { recursive: true })

const URL = 'http://localhost:4325/app.html'
const WIDTH = 480
const HEIGHT = 800

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
page.on('pageerror', err => console.log('[page error]', err.message))

await page.goto(URL)
await page.waitForTimeout(3000)
await page.evaluate(() => document.querySelector('.splash__next')?.click())
await page.waitForTimeout(300)
await page.evaluate(() => document.querySelector('.how__start')?.click())
await page.waitForTimeout(300)
await page.evaluate(async () => {
  const res = await fetch('/demo/demo-track.gpx')
  const text = await res.text()
  const file = new File([text], 'demo-track.gpx', { type: 'application/gpx+xml' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(500)
await page.evaluate(() => document.querySelector('button')?.click())
await page.waitForTimeout(500)
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('animation'))
  btn?.click()
})
await page.waitForTimeout(2500)
await page.waitForTimeout(2000)
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Terminer'))
  btn?.click()
})
await page.waitForTimeout(500)
await page.evaluate(() => document.querySelector('.controls__mode-icon')?.click())
await page.waitForTimeout(500)
await page.evaluate(() => document.querySelector('.ctrl-btn--play')?.click())

// Plusieurs captures a differents instants : la camera suiveuse met du temps a se stabiliser,
// et la position du randonneur dans le cadre varie selon le moment (teste plusieurs points pour
// choisir celui ou il est le mieux centre sur la carte).
// ~13s après le lancement de la lecture : la caméra suiveuse s'est stabilisée et le randonneur
// est bien visible/centré (testé à plusieurs instants — plus tôt il est encore trop près du
// bandeau du haut, plus tard il dérive vers le bord).
await page.waitForTimeout(13000 - 4000)
await page.screenshot({ path: join(OUT_DIR, 'hero-static.jpg'), type: 'jpeg', quality: 90 })

await browser.close()
console.log('done:', join(OUT_DIR, 'hero-static.jpg'))
