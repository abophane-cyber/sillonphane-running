/**
 * og-shot.mjs — Génère public/demo/og-image.png depuis public/og-builder.html
 * Rendu Chromium headless en 2x puis réduction à 1200x630 (texte bien lissé).
 * Prérequis : serveur dev lancé (http://localhost:5174).
 */
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import ffmpeg from 'ffmpeg-static'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = resolve(ROOT, 'public/demo/.og-2x.png')
const out = resolve(ROOT, 'public/demo/og-image.jpg')
const url = process.argv[2] || 'http://localhost:5174/og-builder.html' // fichier à la racine, servi par vite dev, non déployé

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await (await page.$('#og')).screenshot({ path: tmp })
await browser.close()

execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', tmp, '-vf', 'scale=1200:630:flags=lanczos,format=yuvj420p', '-q:v', '3', out])
execFileSync(process.execPath, ['-e', `require('fs').rmSync(${JSON.stringify(tmp)})`])
console.log('écrit :', out)
