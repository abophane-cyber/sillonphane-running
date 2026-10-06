/**
 * capture-demo.mjs — Génère la vidéo de démo du tracé animé pour la landing (index.html)
 *
 * Usage : npm run dev (dans un autre terminal, sur le port 4325) puis node scripts/capture-demo.mjs
 *
 * Pilote automatiquement l'appli avec public/demo/demo-track.gpx (parcours synthétique). Capture
 * des frames JPEG à intervalle fixe (plutôt que context.recordVideo, dont l'échantillonnage interne
 * est irrégulier en headless et donne une vidéo saccadée) dans scripts/frames/ (non versionné), puis
 * les assemble en vidéo avec le fps réel mesuré — pour un rendu fluide et fidèle au temps réel.
 * Il faut ensuite recadrer si besoin et copier le résultat vers public/demo/trace-demo.webm.
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRAMES_DIR = join(__dirname, 'frames')
const OUT_DIR = join(__dirname, 'videos')
rmSync(FRAMES_DIR, { recursive: true, force: true })
mkdirSync(FRAMES_DIR, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

const URL = 'http://localhost:4325/app.html'
const WIDTH = 480
const HEIGHT = 800
const CAPTURE_MS = 12000   // durée réelle de la capture (fenêtre d'animation)
const FRAME_INTERVAL_MS = 66  // ~15 fps visé

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
page.on('console', msg => { if (msg.type() === 'error') console.log('[console error]', msg.text()) })
page.on('pageerror', err => console.log('[page error]', err.message))

await page.goto(URL)
await page.waitForTimeout(3000)

// Splash -> passe
await page.evaluate(() => document.querySelector('.splash__next')?.click())
await page.waitForTimeout(300)

// "Comment ca marche" -> demarrer
await page.evaluate(() => document.querySelector('.how__start')?.click())
await page.waitForTimeout(300)

// Injecte le GPX de demo dans l'input file du GpxUploader
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

// Ecran d'upload : bouton "Continuer"
await page.evaluate(() => document.querySelector('button')?.click())
await page.waitForTimeout(500)

// Ecran titre : "Lancer l'animation"
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('animation'))
  btn?.click()
})
await page.waitForTimeout(2500)

// Attend que les tuiles se chargent un minimum
await page.waitForTimeout(2000)

// Wizard des panneaux : valide avec "Terminer"
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Terminer'))
  btn?.click()
})
await page.waitForTimeout(500)

// Choisit un randonneur (obligatoire avant lecture)
await page.evaluate(() => document.querySelector('.controls__mode-icon')?.click())
await page.waitForTimeout(500)

// Lance la lecture, laisse une frame s'ecouler avant de capturer (evite la frame figee du hint)
await page.evaluate(() => document.querySelector('.ctrl-btn--play')?.click())
await page.waitForTimeout(400)

// ── Capture des frames a intervalle fixe, avec horodatage reel ───────────────────
// Cadre uniquement la carte (pas le bandeau du haut ni les controles du bas) : le mockup
// telephone de la landing est en format portrait, cadrer toute la page (bandeau + carte +
// stats + controles) faisait sortir le randonneur du cadre une fois recadre par object-fit:cover.
const mapWrap = page.locator('.viewer__map-wrap')
const timestamps = []
const startedAt = Date.now()
let frameIndex = 0
while (Date.now() - startedAt < CAPTURE_MS) {
  const before = Date.now()
  frameIndex++
  const path = join(FRAMES_DIR, `frame_${String(frameIndex).padStart(5, '0')}.jpg`)
  await mapWrap.screenshot({ path, type: 'jpeg', quality: 85 })
  timestamps.push(Date.now())
  const elapsed = Date.now() - before
  if (elapsed < FRAME_INTERVAL_MS) await page.waitForTimeout(FRAME_INTERVAL_MS - elapsed)
}

await browser.close()

const totalFrames = readdirSync(FRAMES_DIR).length
const realDurationS = (timestamps[timestamps.length - 1] - startedAt) / 1000
const measuredFps = totalFrames / realDurationS
console.log(`captured ${totalFrames} frames over ${realDurationS.toFixed(2)}s (~${measuredFps.toFixed(2)} fps)`)

// ── Assemblage en webm (VP8) au fps mesure, pour respecter le rythme reel de l'animation ──
// Ce build minimal de ffmpeg (fourni par Playwright) n'a pas le demuxer "image2" (sequence de
// fichiers numerotes) — seulement "image2pipe" (flux d'images concatenees via stdin). On lui
// passe donc les frames JPEG concatenees en un seul buffer, via stdin plutot qu'un pipe shell
// (cat | ffmpeg corrompt les JPEG en mode texte sous Git Bash/Windows).
const FFMPEG = 'C:/Users/hypno/AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe'
const outPath = join(OUT_DIR, 'trace-demo.webm')
const frameFiles = readdirSync(FRAMES_DIR).sort()
const concatenated = Buffer.concat(frameFiles.map(f => readFileSync(join(FRAMES_DIR, f))))
const result = spawnSync(FFMPEG, [
  '-y',
  '-f', 'image2pipe',
  '-vcodec', 'mjpeg',
  '-framerate', measuredFps.toFixed(3),
  '-i', 'pipe:0',
  // Conserve le ratio naturel du cadrage (pas de scale fixe qui deformerait le personnage) :
  // le CSS (object-fit: cover) fait le recadrage final cote landing.
  '-vf', 'scale=480:-2',
  '-an', '-c:v', 'libvpx', '-b:v', '600k', '-crf', '28',
  outPath,
], { input: concatenated, stdio: ['pipe', 'inherit', 'inherit'] })
if (result.status !== 0) throw new Error('ffmpeg failed with status ' + result.status)

console.log('done, video saved to', outPath)
