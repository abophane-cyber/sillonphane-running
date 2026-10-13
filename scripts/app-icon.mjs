/**
 * app-icon.mjs — Dessine l'icône Android de l'appli : le « S » Sillonphane, le nom de l'appli en jaune
 * à la verticale (lu de bas en haut, centré) et une pastille jaune avec le pictogramme du sport.
 * Écrit les PNG de android/app/src/main/res/mipmap-* (icône adaptative + anciennes icônes carrée et ronde).
 *
 * Usage : node scripts/app-icon.mjs <rando|running|cyclo|ultra-trail>
 * Rendu Chromium headless (Playwright), sans serveur.
 *
 * Pictogrammes : Tabler Icons (https://tabler.io/icons), licence MIT —
 * Copyright (c) 2020-2024 Paweł Kuna. Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software, to deal in the Software without restriction (texte complet : https://github.com/tabler/tabler-icons/blob/main/LICENSE).
 * Police : Plus Jakarta Sans (SIL Open Font License), seulement rastérisée dans l'image.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RES = resolve(ROOT, 'android/app/src/main/res')

const APPS = {
  rando: { label: 'Rando', picto: ['M12 4m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M7 21l2 -4', 'M13 21v-4l-3 -3l1 -6l3 4l3 2', 'M10 14l-1.827 -1.218a2 2 0 0 1 -.831 -2.15l.28 -1.117a2 2 0 0 1 1.939 -1.515h1.439l4 1l3 -2', 'M17 12v9', 'M16 20h2'] },
  running: { label: 'Running', picto: ['M13 4m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M4 17l5 1l.75 -1.5', 'M15 21l0 -4l-4 -3l1 -6', 'M7 12l0 -3l5 -1l3 3l3 1'] },
  cyclo: { label: 'Cyclo', picto: ['M5 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M19 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M12 19l0 -4l-3 -3l5 -4l2 3l3 0', 'M17 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'] },
  'ultra-trail': { label: 'Ultra-trail', picto: ['M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612z', 'M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2'] },
}
const app = APPS[process.argv[2]]
if (!app) { console.error('Usage : node scripts/app-icon.mjs <' + Object.keys(APPS).join('|') + '>'); process.exit(1) }

const BG = '#1D1A15'
const YELLOW = '#F5C518'
const font = readFileSync(resolve(ROOT, 'public/fonts/plus-jakarta-sans-latin.woff2')).toString('base64')

// Dessin dans le repère de l'icône adaptative (108 × 108 ; zone sûre = cercle de rayon 33 au centre).
const textSize = app.label.length > 8 ? 7 : 8.5
const content = `
  <defs><linearGradient id="sg" x1="330" y1="140" x2="180" y2="375" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#f0cfa8"/><stop offset="40%" stop-color="#d07840"/>
    <stop offset="75%" stop-color="#5a8a60"/><stop offset="100%" stop-color="#1e4a2a"/></linearGradient></defs>
  <g transform="translate(31 23.5) scale(0.105)">
    <path d="M 330 140 C 175 80, 50 215, 256 258 C 462 300, 340 450, 182 390" fill="none" stroke="url(#sg)" stroke-width="62" stroke-linecap="round"/>
    <circle cx="330" cy="140" r="18" fill="#f0e0c8"/><circle cx="182" cy="390" r="18" fill="#f0f0f0"/>
  </g>
  <text transform="translate(33 54) rotate(-90)" text-anchor="middle" dominant-baseline="central"
    font-family="Jakarta" font-weight="700" font-size="${textSize}" letter-spacing="0.3" fill="${YELLOW}">${app.label}</text>
  <circle cx="73" cy="73" r="8.6" fill="${YELLOW}" stroke="${BG}" stroke-width="1.2"/>
  <g transform="translate(66.4 66.4) scale(0.55)" fill="none" stroke="${BG}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    ${app.picto.map(d => `<path d="${d}"/>`).join('')}
  </g>`

// kind : 'fg' = avant-plan adaptatif (transparent, 108), 'square' / 'round' = anciennes icônes (zone visible 72 au centre)
function svg(kind) {
  const vb = kind === 'fg' ? '0 0 108 108' : '18 18 72 72'
  const bg = kind === 'square' ? `<rect x="18" y="18" width="72" height="72" rx="14" fill="${BG}"/>`
    : kind === 'round' ? `<circle cx="54" cy="54" r="36" fill="${BG}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%">${bg}${content}</svg>`
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [dens, k] of Object.entries(DENSITIES)) {
  for (const [file, kind, dp] of [['ic_launcher_foreground', 'fg', 108], ['ic_launcher', 'square', 48], ['ic_launcher_round', 'round', 48]]) {
    const px = Math.round(dp * k)
    await page.setViewportSize({ width: px, height: px })
    await page.setContent(`<style>@font-face{font-family:Jakarta;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}
      html,body{margin:0;background:transparent}</style><div style="width:${px}px;height:${px}px">${svg(kind)}</div>`)
    await page.evaluate(() => document.fonts.ready)
    writeFileSync(resolve(RES, `mipmap-${dens}/${file}.png`), await page.screenshot({ omitBackground: true }))
  }
}
await browser.close()
console.log(`Icônes « ${app.label} » écrites dans ${RES}`)
