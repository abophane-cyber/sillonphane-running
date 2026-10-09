/**
 * qr.mjs — Génère public/downloads/qr-sillonphane-running.svg
 * QR code vers l'URL publique, affiché sur ordinateur pour rouvrir la page sur un téléphone.
 * Régénérer après un changement d'URL : `node scripts/qr.mjs [url]`
 */
import QRCode from 'qrcode'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(ROOT, 'public/downloads/qr-sillonphane-running.svg')
const url = process.argv[2] || 'https://sillonphane.fr/rando'

const svg = await QRCode.toString(url, {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 1,
  color: { dark: '#191817', light: '#0000' },
})

writeFileSync(out, svg)
console.log('écrit :', out, '→', url)
