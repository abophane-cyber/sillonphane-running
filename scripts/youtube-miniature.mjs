/**
 * youtube-miniature.mjs — Miniature YouTube de la vidéo de présentation de Sillonphane-Running (1280×720, JPEG).
 *
 * Usage : node scripts/youtube-miniature.mjs
 * Résultat : scripts/videos/sillonphane-running-miniature.jpg (dossier non versionné).
 *
 * Fond : vue d'ensemble du ruban dans le film 3D de la course « Demo Running » (videos-brutes/, non versionné ;
 * sinon l'extrait de l'accueil). À droite, l'affiche (Modèle 1). Message (voir CLAUDE.md du dossier parent) : la
 * trace GPX donne le film et l'affiche ; aucun nom d'épreuve. Coin bas droit laissé libre (durée affichée par YouTube).
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpeg from 'ffmpeg-static'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'scripts/videos')
const OUT = join(OUT_DIR, 'sillonphane-running-miniature.jpg')
const RAW = join(ROOT, 'videos-brutes')
const SITE = join(ROOT, 'public')

// Plan du film 3D où tout le ruban est visible, après le titre d'ouverture.
const FILM_3D = existsSync(join(RAW, 'Demo_Running_3d 13-10.mp4'))
  ? { file: join(RAW, 'Demo_Running_3d 13-10.mp4'), at: 6.2 }
  : { file: join(SITE, 'demo/film-3d.mp4'), at: 1 }
const POSTER = [join(RAW, 'Demo Running - affiche A4 réseaux.jpg'), join(SITE, 'demo/affiche-demo.jpg')].find(existsSync)

const W = 1280, H = 720
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/')

mkdirSync(OUT_DIR, { recursive: true })
const FOND = join(OUT_DIR, 'miniature-fond.jpg')
execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-ss', String(FILM_3D.at), '-i', FILM_3D.file,
  '-frames:v', '1', '-q:v', '2', FOND])

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Playfair Display'; font-weight: 400 900; src: url('${fileUrl(join(SITE, 'fonts/playfair-display-latin.woff2'))}'); }
  @font-face { font-family: 'Playfair Display'; font-style: italic; font-weight: 400; src: url('${fileUrl(join(SITE, 'fonts/playfair-display-italic-latin.woff2'))}'); }
  @font-face { font-family: 'Plus Jakarta Sans'; font-weight: 400 700; src: url('${fileUrl(join(SITE, 'fonts/plus-jakarta-sans-latin.woff2'))}'); }
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0d1410; font-family: 'Plus Jakarta Sans', sans-serif; }
  .fond { position: absolute; inset: 0; background: url('${fileUrl(FOND)}') 62% 40% / 118% auto no-repeat;
    filter: saturate(1.15) contrast(1.05); }
  .voile { position: absolute; inset: 0;
    background: linear-gradient(90deg, rgba(8,14,10,.94) 0%, rgba(8,14,10,.82) 30%, rgba(8,14,10,.25) 58%, rgba(8,14,10,0) 72%),
                linear-gradient(0deg, rgba(8,14,10,.55) 0%, rgba(8,14,10,0) 30%); }
  .texte { position: absolute; left: 64px; top: 60px; width: 640px; color: #F5F3EF; }
  .marque { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 25px; letter-spacing: .02em; }
  .marque svg { width: 34px; height: 48px; }
  .marque b { color: #E9874F; }
  .nouveau { display: inline-block; margin-left: 6px; padding: 5px 12px; border-radius: 999px; background: #C15C3D;
    font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #fff; }
  h1 { margin-top: 34px; font-family: 'Playfair Display', serif; font-weight: 900; line-height: .98;
    font-size: 108px; letter-spacing: -.01em; text-shadow: 0 6px 30px rgba(0,0,0,.55); }
  h1 .film { display: block; font-size: 122px;
    background: linear-gradient(90deg, #FFD9A0 0%, #F7A25C 40%, #F07C3E 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; text-shadow: none; filter: drop-shadow(0 6px 22px rgba(0,0,0,.5)); }
  .sous { margin-top: 26px; font-size: 31px; font-weight: 600; line-height: 1.3; }
  .sous i { font-family: 'Playfair Display', serif; font-style: italic; font-weight: 400; color: #F0CFA8; }
  .pastilles { display: flex; gap: 12px; margin-top: 28px; }
  .pastilles span { padding: 9px 18px; border-radius: 999px; font-size: 21px; font-weight: 700;
    background: rgba(245,243,239,.12); border: 2px solid rgba(245,243,239,.45); }
  .pastilles span:first-child { background: #F5F3EF; color: #2F4839; border-color: #F5F3EF; }
  .affiche { position: absolute; right: 58px; top: 52px; width: 300px; transform: rotate(5deg);
    border: 7px solid #FAF9F6; border-radius: 4px; box-shadow: 0 24px 60px rgba(0,0,0,.65), 0 4px 12px rgba(0,0,0,.4); }
  .affiche img { display: block; width: 100%; }
  .etiquette { position: absolute; right: 250px; top: 420px; transform: rotate(-4deg); padding: 10px 18px;
    background: #F5F3EF; color: #2F4839; font-weight: 700; font-size: 22px; border-radius: 6px;
    box-shadow: 0 10px 26px rgba(0,0,0,.5); }
  .etiquette em { font-style: normal; color: #C15C3D; }
</style></head><body>
  <div class="fond"></div><div class="voile"></div>
  <div class="texte">
    <div class="marque">
      <svg viewBox="96 34 154 218"><defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#2F4839"/><stop offset="50%" stop-color="#C15C3D"/><stop offset="100%" stop-color="#F5F3EF"/>
      </linearGradient></defs>
      <path d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
        fill="none" stroke="url(#g)" stroke-width="29" stroke-linecap="round"/>
      <circle cx="220" cy="60" r="11" fill="#2F4839" stroke="#F5F3EF" stroke-width="4"/>
      <circle cx="138" cy="225" r="11" fill="#F5F3EF"/></svg>
      <span>Sillonphane-<b>Running</b></span><span class="nouveau">Nouveau</span>
    </div>
    <h1>Votre course<span class="film">en film</span></h1>
    <div class="sous">Du 5 km au marathon, <i>votre trace GPS</i><br>devient un film et une affiche.</div>
    <div class="pastilles"><span>Gratuit</span><span>Sans compte</span><span>Sans pub</span></div>
  </div>
  ${POSTER ? `<div class="affiche"><img src="${fileUrl(POSTER)}"></div>
  <div class="etiquette">+ votre <em>affiche</em></div>` : ''}
</body></html>`

const page_html = join(OUT_DIR, 'miniature.html')
writeFileSync(page_html, html)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(fileUrl(page_html))
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: OUT, type: 'jpeg', quality: 92 })
await browser.close()
console.log(OUT)
