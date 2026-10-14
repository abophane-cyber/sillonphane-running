/**
 * youtube-miniature.mjs — Miniature YouTube de la vidéo de présentation de Sillonphane-Running (1280×720, JPEG).
 *
 * Usage : node scripts/youtube-miniature.mjs
 * Résultat : scripts/videos/sillonphane-running-miniature.jpg (dossier non versionné).
 *
 * Fond : videos-brutes/miniature-photo.webp (coureuse au bord de l'eau, titre « Sillonphane Running » déjà peint
 * dessus ; non versionné). Par-dessus, à droite : une image du film 3D (ruban de la course « Demo Running ») et
 * l'affiche (Modèle 1) ; en bas à gauche : « Votre course en film » et les principes. Message (voir CLAUDE.md du
 * dossier parent) : la trace GPS donne le film et l'affiche ; aucun nom d'épreuve. Coin bas droit laissé libre
 * (durée affichée par YouTube).
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

const PHOTO = join(RAW, 'miniature-photo.webp')
if (!existsSync(PHOTO)) throw new Error(`Photo de fond introuvable : ${PHOTO}`)
// Plan du film 3D où tout le ruban est visible, après le titre d'ouverture.
const FILM_3D = existsSync(join(RAW, 'Demo_Running_3d 13-10.mp4'))
  ? { file: join(RAW, 'Demo_Running_3d 13-10.mp4'), at: 6.2 }
  : { file: join(SITE, 'demo/film-3d.mp4'), at: 1 }
const POSTER = [join(RAW, 'Demo Running - affiche A4 réseaux.jpg'), join(SITE, 'demo/affiche-demo.jpg')].find(existsSync)

const W = 1280, H = 720
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/')

mkdirSync(OUT_DIR, { recursive: true })
const FILM = join(OUT_DIR, 'miniature-film.jpg')
execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-ss', String(FILM_3D.at), '-i', FILM_3D.file,
  '-frames:v', '1', '-vf', 'crop=1440:810:360:150', '-q:v', '2', FILM])

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Playfair Display'; font-weight: 400 900; src: url('${fileUrl(join(SITE, 'fonts/playfair-display-latin.woff2'))}'); }
  @font-face { font-family: 'Plus Jakarta Sans'; font-weight: 400 700; src: url('${fileUrl(join(SITE, 'fonts/plus-jakarta-sans-latin.woff2'))}'); }
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: #0d1410;
    font-family: 'Plus Jakarta Sans', sans-serif; color: #F5F3EF; }
  .fond { position: absolute; inset: 0; background: url('${fileUrl(PHOTO)}') 50% 0 / auto 100% no-repeat; }
  .voile { position: absolute; left: 0; right: 0; bottom: 0; height: 250px;
    background: linear-gradient(0deg, rgba(8,14,10,.92) 0%, rgba(8,14,10,.7) 45%, rgba(8,14,10,0) 100%); }
  .carte { position: absolute; border: 6px solid #FAF9F6; border-radius: 4px;
    box-shadow: 0 22px 50px rgba(0,0,0,.6), 0 4px 12px rgba(0,0,0,.4); background: #FAF9F6; }
  .carte img { display: block; width: 100%; }
  .film { left: 1002px; top: 404px; width: 250px; transform: rotate(-4deg); z-index: 2; }
  .film .lecture { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px;
    border-radius: 50%; background: rgba(193,92,61,.92); box-shadow: 0 4px 16px rgba(0,0,0,.5); }
  .film .lecture::after { content: ''; position: absolute; left: 21px; top: 15px;
    border-left: 19px solid #fff; border-top: 12px solid transparent; border-bottom: 12px solid transparent; }
  .affiche { left: 1088px; top: 150px; width: 165px; transform: rotate(6deg); z-index: 1; }
  .etiquette { position: absolute; padding: 6px 13px; border-radius: 6px; background: #F5F3EF; color: #2F4839;
    font-weight: 700; font-size: 18px; box-shadow: 0 8px 20px rgba(0,0,0,.45); z-index: 3; }
  .etiquette em { font-style: normal; color: #C15C3D; }
  .e-film { left: 1012px; top: 566px; transform: rotate(-4deg); }
  .e-affiche { left: 1130px; top: 128px; transform: rotate(6deg); }
  .texte { position: absolute; left: 48px; bottom: 34px; }
  h2 { font-family: 'Playfair Display', serif; font-weight: 900; font-size: 64px; line-height: 1;
    text-shadow: 0 4px 22px rgba(0,0,0,.6); }
  h2 span { color: #F7A25C; }
  .pastilles { display: flex; gap: 10px; margin-top: 16px; }
  .pastilles span { padding: 7px 15px; border-radius: 999px; font-size: 19px; font-weight: 700;
    background: rgba(245,243,239,.14); border: 2px solid rgba(245,243,239,.5); }
  .pastilles span:first-child { background: #F5F3EF; color: #2F4839; border-color: #F5F3EF; }
</style></head><body>
  <div class="fond"></div><div class="voile"></div>
  <div class="carte film"><img src="${fileUrl(FILM)}"><div class="lecture"></div></div>
  <div class="etiquette e-film">Le <em>film</em> 2D / 3D</div>
  ${POSTER ? `<div class="carte affiche"><img src="${fileUrl(POSTER)}"></div>
  <div class="etiquette e-affiche">+ l'<em>affiche</em></div>` : ''}
  <div class="texte">
    <h2>Votre course <span>en film</span></h2>
    <div class="pastilles"><span>Du 5 km au marathon</span><span>Gratuit</span><span>Sans compte</span><span>Sans pub</span></div>
  </div>
</body></html>`

const pageHtml = join(OUT_DIR, 'miniature.html')
writeFileSync(pageHtml, html)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(fileUrl(pageHtml))
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: OUT, type: 'jpeg', quality: 92 })
await browser.close()
console.log(OUT)
