/**
 * story-video.mjs — Décline la vidéo YouTube en story Instagram verticale (1080×1920, 30 i/s, < 60 s pour
 * qu'Instagram ne la découpe pas : voir CUT).
 *
 * Usage : node scripts/youtube-video.mjs (d'abord), puis node scripts/story-video.mjs
 * Résultat : scripts/videos/sillonphane-running-story.mp4 (dossier non versionné).
 *
 * La vidéo 16:9 occupe toute la largeur au centre ; au-dessus et au-dessous, la même image agrandie,
 * floutée et assombrie. Entre l'ouverture et l'écran de fin (qui portent déjà logo et adresse), un
 * bandeau en haut (logo + « Sillonphane-Running ») et l'adresse en bas, hors des zones couvertes par
 * l'interface d'Instagram (~250 px en haut, ~340 px en bas). Le son est repris tel quel.
 */
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpeg from 'ffmpeg-static'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'scripts/videos')
const SRC = join(OUT_DIR, 'sillonphane-running-presentation.mp4')
const OUT = join(OUT_DIR, 'sillonphane-running-story.mp4')
const TMP = join(OUT_DIR, 'tmp-story')
const SITE = join(ROOT, '../Sillonphane-site/landing')

// Mêmes repères que youtube-video.mjs : ouverture de 9,2 s, écran de fin de 6,2 s.
const OPENING = 9.2, END_CARD = 6.2
// La vidéo YouTube de Running dure 60 s au plus : reprise entière, sans coupe (CUT = null).
// Si elle s'allonge, retirer un passage sans voix : CUT = { from, to }, raccordé en fondu de XFADE s.
const CUT = null, XFADE = 0.5

const fileUrl = p => 'file:///' + p.replace(/\\/g, '/')
const ff = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', SRC], { encoding: 'utf8' }).stderr
const [, h, m, s] = probe.match(/Duration: (\d+):(\d+):([\d.]+)/)
const srcDur = h * 3600 + m * 60 + Number(s)
const dur = CUT ? srcDur - (CUT.to - CUT.from) - XFADE : srcDur
const endStart = dur - END_CARD

// Bandeaux transparents (1080×1920), dessinés dans Chromium avec les polices de la landing.
const html = join(TMP, 'bandeaux.html')
writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: 'Playfair Display'; font-weight: 400 900; src: url('${fileUrl(join(SITE, 'fonts/playfair-display-latin.woff2'))}'); }
  @font-face { font-family: 'Plus Jakarta Sans'; font-weight: 400 700; src: url('${fileUrl(join(SITE, 'fonts/plus-jakarta-sans-latin.woff2'))}'); }
  html, body { margin: 0; width: 1080px; height: 1920px; background: transparent; }
  .top { position: absolute; top: 300px; left: 0; right: 0; text-align: center; }
  .top svg { width: 96px; height: auto; filter: drop-shadow(0 2px 10px rgba(0,0,0,0.5)); }
  .top span { display: block; margin-top: 18px; font: 600 34px 'Plus Jakarta Sans', sans-serif; letter-spacing: 0.18em;
    text-transform: uppercase; color: #F0CFA8; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
  .bottom { position: absolute; top: 1440px; left: 0; right: 0; text-align: center;
    font: 600 66px 'Playfair Display', Georgia, serif; color: #FAF9F6; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
</style>
<div class="top">
  <svg viewBox="96 34 154 218">
    <defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#2F4839"/><stop offset="50%" stop-color="#C15C3D"/><stop offset="100%" stop-color="#F5F3EF"/>
    </linearGradient></defs>
    <path d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
          fill="none" stroke="url(#g)" stroke-width="29" stroke-linecap="round"/>
    <circle cx="220" cy="60" r="11" fill="#2F4839" stroke="#F5F3EF" stroke-width="4"/>
    <circle cx="138" cy="225" r="11" fill="#F5F3EF"/>
  </svg>
  <span>Sillonphane-Running</span>
</div>
<div class="bottom">sillonphane.fr/running</div>`)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
await page.goto(fileUrl(html))
await page.evaluate(() => document.fonts.ready)
const overlay = join(TMP, 'bandeaux.png')
await page.screenshot({ path: overlay, omitBackground: true })
await browser.close()

const fc = [
  // Coupe éventuelle : deux morceaux de la source, raccordés en fondu enchaîné (image et son).
  ...(CUT ? [
    '[0:v]split[v1][v2]', '[0:a]asplit[a1][a2]',
    `[v1]trim=0:${CUT.from},setpts=PTS-STARTPTS[va]`, `[v2]trim=${CUT.to},setpts=PTS-STARTPTS[vb]`,
    `[a1]atrim=0:${CUT.from},asetpts=PTS-STARTPTS[aa]`, `[a2]atrim=${CUT.to},asetpts=PTS-STARTPTS[ab]`,
    `[va][vb]xfade=transition=fade:duration=${XFADE}:offset=${CUT.from - XFADE}[src]`,
    `[aa][ab]acrossfade=d=${XFADE}[aout]`,
  ] : ['[0:v]null[src]', '[0:a]anull[aout]']),
  '[src]split[a][b]',
  // Fond : image agrandie à 1920 de haut, recadrée, floutée et assombrie.
  '[a]scale=-2:1920,crop=1080:1920,boxblur=40:2,eq=brightness=-0.18:saturation=0.85[bg]',
  '[b]scale=1080:-2[fg]',
  '[bg][fg]overlay=0:(H-h)/2[v]',
  `[1:v]format=rgba,fade=t=in:st=${OPENING}:d=0.6:alpha=1,fade=t=out:st=${endStart - 0.5}:d=0.5:alpha=1[ov]`,
  '[v][ov]overlay=0:0:shortest=1,setsar=1[out]',
].join(';')
ff(['-i', SRC, '-loop', '1', '-framerate', '30', '-i', overlay, '-filter_complex', fc,
  '-map', '[out]', '-map', '[aout]', '-t', String(dur),
  '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT])
rmSync(TMP, { recursive: true, force: true })
console.log(`\nStory prête : ${OUT}`)
