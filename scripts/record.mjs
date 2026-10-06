/**
 * record.mjs — Capture vidéo automatique de Sillon
 *
 * Usage :  node scripts/record.mjs [url]
 * Défaut : http://localhost:5173
 *
 * - Ouvre un vrai Chromium (animations GIF, carte, panneaux = parfaits)
 * - Enregistre tout ce qui se passe dans la fenêtre
 * - La vidéo est sauvegardée dans recordings/ dès que vous fermez le navigateur
 * - Pas de boîte de dialogue, pas de sélection manuelle
 */

import { chromium } from 'playwright'
import { mkdirSync, existsSync, renameSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const RECORDINGS_DIR = join(ROOT, 'recordings')

if (!existsSync(RECORDINGS_DIR)) mkdirSync(RECORDINGS_DIR)

const url = process.argv[2] || 'http://localhost:5173'

// Résolution de capture (ajustez selon votre écran / qualité souhaitée)
const WIDTH  = 1280
const HEIGHT = 800

console.log(`\n🎬 Sillonphane-Rando — Enregistrement vidéo`)
console.log(`   URL    : ${url}`)
console.log(`   Taille : ${WIDTH}×${HEIGHT}`)
console.log(`   Sortie : ${RECORDINGS_DIR}\n`)
console.log('   Utilisez l\'application normalement.')
console.log('   Fermez la fenêtre du navigateur pour sauvegarder la vidéo.\n')

const browser = await chromium.launch({
  headless: false,
  args: [
    `--window-size=${WIDTH},${HEIGHT + 80}`,  // +80 pour la barre Chrome
    '--window-position=0,0',
    '--disable-infobars',
    '--no-default-browser-check',
  ],
})

const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  recordVideo: {
    dir: RECORDINGS_DIR,
    size: { width: WIDTH, height: HEIGHT },
  },
  // Même User-Agent que Chrome pour éviter les blocages CORS
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
})

const page = await context.newPage()

// Interception pour ne pas bloquer sur des erreurs réseau non critiques
page.on('pageerror', () => {})
page.on('requestfailed', () => {})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

// Attendre la fermeture de la fenêtre par l'utilisateur
let videoPath = null
await new Promise(resolve => {
  page.on('close', resolve)
  browser.on('disconnected', resolve)
})

// Récupérer le chemin de la vidéo et la renommer avec timestamp
try {
  const video = page.video()
  if (video) {
    const tmpPath = await video.path()
    if (tmpPath) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const ext = tmpPath.split('.').pop() || 'webm'
      const finalName = `sillon_${ts}.${ext}`
      const finalPath = join(RECORDINGS_DIR, finalName)
      await context.close()
      if (existsSync(tmpPath)) {
        renameSync(tmpPath, finalPath)
        videoPath = finalPath
      }
    }
  }
} catch { /* navigateur déjà fermé */ }

if (!browser.isConnected()) {
  try { await browser.close() } catch { /* déjà fermé */ }
}

if (videoPath) {
  console.log(`\n✅ Vidéo sauvegardée : ${videoPath}\n`)
} else {
  console.log('\n⚠️  Aucune vidéo enregistrée (fermeture trop rapide ?)\n')
}
