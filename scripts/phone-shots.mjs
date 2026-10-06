/**
 * phone-shots.mjs — Captures d'écran « façon smartphone » de l'appli (app.html) pour
 * montrer à quoi ressemblent les pages sur Android après reconstruction de l'APK.
 * Prérequis : serveur dev lancé (port en argv[2], défaut 5174).
 * Sortie : scripts/phone-shots/*.png
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'phone-shots')
mkdirSync(OUT, { recursive: true })
const PORT = process.argv[2] || '5174'
const BASE = `http://localhost:${PORT}`
const GPX = join(__dirname, '..', 'public', 'demo', 'demo-track.gpx')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

async function shot(name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, name + '.png'), fullPage: true })
  console.log('écrit :', name + '.png')
}
async function clickText(re, label) {
  const ok = await page.evaluate((src) => {
    const rx = new RegExp(src, 'i')
    const b = Array.from(document.querySelectorAll('button, a, [role=button]')).find(
      (n) => rx.test((n.textContent || '').trim()) && !n.disabled,
    )
    if (b) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true }
    return false
  }, re.source)
  console.log(`  ${label || re} :`, ok ? 'cliqué' : 'absent')
  return ok
}

// ?start → écran d'import (view='upload' en navigateur desktop)
await page.goto(`${BASE}/app.html?start`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
// si l'écran "Que voulez-vous faire ?" s'affiche, choisir l'import
await clickText(/déj[àa] mon GPX|importer un fichier/i, 'carte import')
await page.waitForTimeout(800)

await page.setInputFiles('input[type=file]', GPX)
await page.waitForTimeout(2500)
await shot('01-import')

await clickText(/continuer|suivant|valider/i, 'continuer')
await page.waitForTimeout(2500)
await shot('02-titre')

await clickText(/c'est parti|commencer|lancer|démarrer|aperçu|créer le film|suivant/i, 'démarrer aperçu')
await page.waitForTimeout(9000) // laisser l'aperçu se dérouler
await shot('03-apercu')

await clickText(/terminer|passer|continuer/i, 'terminer aperçu')
await page.waitForTimeout(2000)
await clickText(/album/i, 'créer album')
await page.waitForTimeout(5000)
await shot('04-album')

await browser.close()
