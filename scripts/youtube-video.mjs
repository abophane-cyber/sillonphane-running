/**
 * youtube-video.mjs — Monte la vidéo de présentation YouTube de Sillonphane-Running (1920×1080, 30 i/s),
 * 60 s au plus pour que la story Instagram (story-video.mjs) la reprenne sans coupe.
 *
 * Usage : node scripts/youtube-video.mjs
 * Résultat : scripts/videos/sillonphane-running-presentation.mp4 (dossier non versionné).
 *
 * Sources (non versionnées) :
 *   videos-brutes/Demo_Running_2D 13-10.mp4, Demo_Running_3d 13-10.mp4  films de la course « Demo Running »
 *   videos-brutes/Demo Running - affiche A4 réseaux.jpg                  affiche (Modèle 1)
 * Livre : images de l'accueil, public/demo/livre-*.jpg (couverture, double page, palmarès).
 * Tant qu'un film manque, son plan reprend l'extrait de l'accueil (public/demo/film-*.mp4).
 *
 * Message (voir CLAUDE.md du dossier parent) : la trace GPX/KML donne le film et l'affiche ; aucun nom
 * d'épreuve (« Demo Running » est notre course d'exemple). Musique : la même que la vidéo Rando (MUSIC).
 * Commentaire : scripts/videos/commentaire/1.wav … 8.wav (texte dans COMMENTAIRE ci-dessous, recopié dans
 * commentaire/Texte.txt), placés par VOICE ; la musique baisse d'elle-même sous la voix. Sans ces
 * fichiers, musique seule.
 */
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpeg from 'ffmpeg-static'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'scripts/videos')
const TMP = join(OUT_DIR, 'tmp')
const OUT = join(OUT_DIR, 'sillonphane-running-presentation.mp4')
const RAW = join(ROOT, 'videos-brutes')

const W = 1920, H = 1080, FPS = 30
// 2D : ouverture (titre, distance, D+ sur le tracé) vers 2-6 s, puis borne du 5 km vers 24-30 s ;
// 3D : arrivée à Dorat, borne du 10 km, vers 46-53 s.
const FILM_2D_TITLE = { file: join(RAW, 'Demo_Running_2D 13-10.mp4'), start: 2.2, duration: 3.6 }
const FILM_2D = { file: join(RAW, 'Demo_Running_2D 13-10.mp4'), start: 23, duration: 6 }
const FILM_3D = { file: join(RAW, 'Demo_Running_3d 13-10.mp4'), start: 46, duration: 7 }
const FILM_2D_FALLBACK = join(ROOT, 'public/demo/film-2d.mp4')
const FILM_3D_FALLBACK = join(ROOT, 'public/demo/film-3d.mp4')
const POSTER = [join(RAW, 'Demo Running - affiche A4 réseaux.jpg'), join(ROOT, 'public/demo/affiche-demo.jpg')].find(existsSync)
const BOOK_PAGES = ['livre-couverture', 'livre-double-page', 'livre-palmares']
  .map(n => join(ROOT, `public/demo/${n}.jpg`)).filter(existsSync)

// Même musique que la vidéo Rando (MP3 tiré du WAV d'origine), à partir de « start » s.
const MUSIC = { file: 'P:/Ma musique/Projet 3.mp3', start: 0 }

// Commentaire à enregistrer, une phrase par fichier : plan sur lequel elle démarre et décalage (s) dans ce plan.
const VOICE_DIR = join(OUT_DIR, 'commentaire')
const VOICE = [
  { n: 1, shot: 'ouverture', at: 1.5 }, // Après Sillonphane-Rando, voici Sillonphane-Running…
  { n: 2, shot: 'principe', at: 0.2 },  // Alors, comment ça marche ? Vous importez la trace…
  { n: 3, shot: 'film-titre', at: 0.6 }, // Vous obtenez le film de votre course, en 2D ou en 3D…
  { n: 4, shot: 'affiche', at: 0.3 },   // Composez aussi l'affiche de votre course…
  { n: 5, shot: 'livre', at: 0.3 },     // Et réunissez vos affiches, vos records et votre progression…
  { n: 6, shot: 'livre', at: 4.8 },     // Affiches et livres s'impriment chez nos partenaires…
  { n: 7, shot: 'principes', at: 0.2 }, // Sans compte, sans publicité, sans IA, et gratuit
  { n: 8, shot: 'fin', at: 0.5 },       // Rendez-vous sur sillonphane.fr/running. À bientôt !
]
const COMMENTAIRE = `1. Après Sillonphane-Rando, voici Sillonphane-Running : vos courses, du 5 kilomètres au marathon, deviennent des souvenirs.
2. Alors, comment ça marche ? Vous importez la trace GPX ou KML de votre course, ou vous l'enregistrez avec votre téléphone Android.
3. Vous obtenez le film de votre course, en 2D ou en 3D, avec le chrono et vos temps de passage.
4. Composez aussi l'affiche de votre course, à imprimer ou à partager.
5. Et réunissez vos affiches, vos records et votre progression dans un livre.
6. Affiches et livres s'impriment chez nos partenaires, avec un code de réduction.
7. Sans compte, sans publicité, sans IA, et gratuit.
8. Rendez-vous sur sillonphane.fr/running. À bientôt !
`

// Charte de la landing : pierre claire, vert forêt, terracotta.
const STONE = '0xFAF9F6', FOREST = '0x2F4839', INK = '0x191817', TERRA = '0xC15C3D'
const SERIF = 'C\\:/Windows/Fonts/georgia.ttf'
const SERIF_I = 'C\\:/Windows/Fonts/georgiai.ttf'
const SANS = 'C\\:/Windows/Fonts/segoeui.ttf'
const SANS_B = 'C\\:/Windows/Fonts/seguisb.ttf'

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
mkdirSync(VOICE_DIR, { recursive: true })
if (!existsSync(join(VOICE_DIR, 'Texte.txt'))) writeFileSync(join(VOICE_DIR, 'Texte.txt'), COMMENTAIRE)

const ff = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
// Chemins pour les filtres ffmpeg : « / » et « : » échappé.
const fpath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:')

let textN = 0
// drawtext lit le texte dans un fichier : évite d'échapper apostrophes, deux-points et virgules.
function text(str, { font = SANS, size = 56, color = INK, x = '(w-text_w)/2', y, from = 0, to = 99, fade = 0.5 }) {
  const file = join(TMP, `t${textN++}.txt`)
  writeFileSync(file, str)
  const alpha = `if(lt(t,${from}),0,if(lt(t,${from + fade}),(t-${from})/${fade},if(lt(t,${to - fade}),1,if(lt(t,${to}),(${to}-t)/${fade},0))))`
  return `drawtext=fontfile='${font}':textfile='${fpath(file)}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}:alpha='${alpha}'`
}

const ENC = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-an']
const segments = []
function segment(name, args) {
  const out = join(TMP, `${String(segments.length).padStart(2, '0')}-${name}.mp4`)
  ff([...args, ...ENC, out])
  segments.push({ name, file: out })
}

// Durée d'un fichier : lue dans la sortie de « ffmpeg -i », qui se termine en erreur faute de fichier de sortie.
function duration(file) {
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr
  const [, h, m, sec] = probe.match(/Duration: (\d+):(\d+):([\d.]+)/)
  return h * 3600 + m * 60 + Number(sec)
}

// Écran uni avec textes.
function card(name, dur, bg, texts) {
  segment(name, ['-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${FPS}:d=${dur}`, '-vf', texts.join(',')])
}

// Extrait de film, mis à 1920×1080, avec un bandeau de légende en bas, calée à droite (hors de l'échelle et du nord) pour laisser lisible
// le cartouche du film (ville et nom de la course) en bas à gauche.
function film(name, { file, start, duration }, caption, fallback) {
  const src = existsSync(file) ? file : existsSync(fallback) ? fallback : null
  if (!src) {
    card(name, duration, FOREST, [
      text('FILM À INSÉRER', { font: SANS_B, size: 40, color: TERRA, y: 380 }),
      text(caption, { font: SERIF, size: 72, color: STONE, y: 460 }),
      text(`Déposer ${file.split(/[\\/]/).pop()} dans videos-brutes/`, { size: 34, color: STONE, y: 600 }),
    ])
    console.log(`⚠ ${file} absent : écran provisoire`)
    return
  }
  const useStart = src === file ? start : 0
  if (src !== file) console.log(`⚠ ${file} absent : extrait de l'accueil à la place`)
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${INK}`,
    `fps=${FPS}`, 'setsar=1',
    `drawbox=x=0:y=ih-150:w=iw:h=150:color=black@0.45:t=fill`,
    text(caption, { font: SERIF, size: 58, color: STONE, x: 'w-text_w-170', y: 'h-110', from: 0.3, to: duration }),
  ].join(',')
  segment(name, ['-ss', String(useStart), '-t', String(duration), '-i', src, '-vf', vf])
}

// Plans HTML rendus image par image dans Chromium (page de 1280×720 agrandie ×1,5) : rythme exact,
// polices et teintes des pages d'accueil. `frame(t)` est évalué dans la page avant chaque capture.
const SITE = join(ROOT, '../Sillonphane-site/landing')
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/')
const BASE_CSS = `
  @font-face { font-family: 'Playfair Display'; font-weight: 400 900; src: url('${fileUrl(join(SITE, 'fonts/playfair-display-latin.woff2'))}'); }
  @font-face { font-family: 'Playfair Display'; font-style: italic; font-weight: 400; src: url('${fileUrl(join(SITE, 'fonts/playfair-display-italic-latin.woff2'))}'); }
  @font-face { font-family: 'Plus Jakarta Sans'; font-weight: 400 700; src: url('${fileUrl(join(SITE, 'fonts/plus-jakarta-sans-latin.woff2'))}'); }
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #000; }
  body { font-family: 'Plus Jakarta Sans', sans-serif; }
  #all { position: absolute; inset: 0; overflow: hidden; }
  h1, h2 { font-family: 'Playfair Display', Georgia, serif; margin: 0; }
  h1 i, h2 i { font-style: italic; font-weight: 500; }
  .eyebrow { display: block; font-size: 0.95rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; }`
// Fonctions communes injectées dans la page.
const HELPERS = `
  const clamp = x => Math.min(1, Math.max(0, x))
  const ease = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
  // Opacité d'un élément visible de « from » à « to », avec fondus d'entrée et de sortie.
  const vis = (t, from, to, fade = 0.6) => Math.min(clamp((t - from) / fade), clamp((to - t) / fade))
  // Entrée d'un élément : fondu et léger glissement vers le haut.
  const rise = (el, t, from, to = 99) => { const k = vis(t, from, to); el.style.opacity = k; el.style.transform = 'translateY(' + (1 - ease(clamp((t - from) / 0.6))) * 18 + 'px)' }
  const kenBurns = (el, k, [s0, x0, y0, s1, x1, y1]) => el.style.transform =
    'scale(' + (s0 + (s1 - s0) * k) + ') translate(' + (x0 + (x1 - x0) * k) + '%, ' + (y0 + (y1 - y0) * k) + '%)'`

async function htmlShot(name, { css, body, dur, frame }) {
  const dir = join(TMP, name)
  mkdirSync(dir, { recursive: true })
  const html = join(dir, 'page.html')
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}${css}</style>
    <div id="all">${body}</div><script>${HELPERS}; window.frame = ${frame}</script>`)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: W / 1280 })
  await page.goto(fileUrl(html))
  await page.evaluate(() => document.fonts.ready)
  const frames = Math.round(dur * FPS)
  for (let i = 0; i < frames; i++) {
    await page.evaluate(([t, dur]) => window.frame(t, dur), [i / FPS, dur])
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`) })
  }
  await browser.close()
  segment(name, ['-framerate', String(FPS), '-i', join(dir, '%04d.png')])
}

// Sigle Sillonphane (logo animé de la landing).
const SIGLE = `
  <svg class="sigle" viewBox="96 34 154 218">
    <defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#2F4839"/><stop offset="50%" stop-color="#C15C3D"/><stop offset="100%" stop-color="#F5F3EF"/>
    </linearGradient></defs>
    <path id="s" pathLength="1" d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
          fill="none" stroke="url(#g)" stroke-width="29" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="1"/>
    <circle id="e" cx="220" cy="60" r="11" fill="#2F4839" stroke="#F5F3EF" stroke-width="4" opacity="0"/>
    <circle id="d" cx="138" cy="225" r="11" fill="#F5F3EF" opacity="0"/>
  </svg>`

// ─── Montage ──────────────────────────────────────────────────────────────────

// 1. Ouverture sur le modèle du hero de sillonphane.fr/running : fondu depuis le noir sur la photo de course,
// logo qui se dessine, « Après Sillonphane-Rando… » puis le titre de Running en fondu enchaîné.
await htmlShot('ouverture', {
  dur: 9.2,
  css: `
    #photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 55%; filter: saturate(1.05) contrast(1.04); }
    .scrim { position: absolute; inset: 0; background:
      radial-gradient(ellipse 70% 55% at 50% 48%, rgba(10,12,10,0.40) 0%, rgba(10,12,10,0) 100%),
      linear-gradient(to bottom, rgba(10,12,10,0.30) 0%, rgba(10,12,10,0.12) 35%, rgba(10,12,10,0.12) 65%, rgba(10,12,10,0.45) 100%); }
    .in { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(calc(-50% - 30px)); text-align: center; color: #fff; }
    .sigle { display: block; width: 92px; height: auto; margin: 0 auto 18px; filter: drop-shadow(0 2px 10px rgba(0,0,0,0.45)); }
    .titles { display: grid; }
    .titles > div { grid-area: 1 / 1; opacity: 0; }
    .eyebrow { color: #F0CFA8; margin-bottom: 14px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
    h1 { font-size: 4.9rem; line-height: 1.06; letter-spacing: -0.02em; font-weight: 700; color: #fff;
      text-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 6px 30px rgba(0,0,0,0.45); }
    h1 .t-terra { color: #F08A62; }
    h1 .t-forest { color: #9CCBA9; }`,
  body: `<img id="photo" src="${fileUrl(join(ROOT, 'public/hero/running-1.jpg'))}"><div class="scrim"></div>
    <div class="in">${SIGLE}
      <div class="titles">
        <div id="t1"><span class="eyebrow">Après Sillonphane-Rando</span><h1>Sillonphane présente<br><i class="t-terra">Sillonphane-Running</i></h1></div>
        <div id="t2"><span class="eyebrow">Du 5 km au marathon</span><h1>Transformez vos<br><i class="t-terra">courses</i> en&nbsp;<i class="t-forest">souvenirs</i></h1></div>
      </div>
    </div>`,
  frame: `(t, dur) => {
    kenBurns(document.getElementById('photo'), ease(clamp(t / dur)), [1.03, 0, 0, 1.12, -1.6, -0.8])
    document.getElementById('all').style.opacity = clamp(t / 1)
    // Même rythme que la page d'accueil : tracé dès 0,4 s (en 1,76 s), points à 0,45 s et 1,95 s.
    document.getElementById('s').setAttribute('stroke-dashoffset', 1 - ease(clamp((t - 0.4) / 1.76)))
    document.getElementById('d').setAttribute('opacity', clamp((t - 0.45) / 0.09))
    document.getElementById('e').setAttribute('opacity', clamp((t - 1.95) / 0.09))
    document.getElementById('t1').style.opacity = vis(t, 0.8, 4.9, 0.8)
    document.getElementById('t2').style.opacity = vis(t, 4.1, 99, 0.8)
  }`,
})

// 2. Comment ça marche : les trois étapes de la landing, l'une après l'autre.
await htmlShot('principe', {
  dur: 8,
  css: `
    #all { background: #FAF9F6; color: #191817; }
    .head { position: absolute; top: 110px; left: 0; right: 0; text-align: center; }
    .head .eyebrow { color: #C15C3D; margin-bottom: 10px; }
    h2 { font-size: 4rem; color: #2F4839; font-weight: 700; }
    .steps { position: absolute; top: 320px; left: 70px; right: 70px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; }
    .st { opacity: 0; border-top: 3px solid #2F4839; padding-top: 18px; }
    .st b { display: block; font: 700 3rem 'Playfair Display', Georgia, serif; color: #C15C3D; }
    .st h3 { margin: 8px 0 12px; font-size: 1.9rem; color: #2F4839; }
    .st p { margin: 0; font-size: 1.4rem; line-height: 1.5; color: #3b3936; }`,
  body: `<div class="head"><span class="eyebrow">En toute simplicité</span><h2>Comment ça <i>marche</i> ?</h2></div>
    <div class="steps">
      <div class="st" id="s1"><b>01</b><h3>Importez votre trace</h3><p>Fichier GPX ou KML de votre montre ou de votre appli, ou trace enregistrée avec votre téléphone</p></div>
      <div class="st" id="s2"><b>02</b><h3>Le film et l’affiche</h3><p>Le tracé s’anime en 2D ou en 3D, avec le chrono et vos temps de passage ; l’affiche se compose</p></div>
      <div class="st" id="s3"><b>03</b><h3>Partagez ou imprimez</h3><p>Film et affiche à partager, ou à faire imprimer chez nos partenaires</p></div>
    </div>`,
  frame: `(t) => {
    document.getElementById('all').style.opacity = clamp(t / 0.4)
    ;['s1', 's2', 's3'].forEach((id, i) => rise(document.getElementById(id), t, 0.8 + i * 1.6))
  }`,
})

film('film-titre', FILM_2D_TITLE, 'Le film de votre course', FILM_2D_FALLBACK)
film('film-2d', FILM_2D, 'En 2D : chrono et temps de passage', FILM_2D_FALLBACK)
film('film-3d', FILM_3D, '…ou en 3D, sur les vues aériennes de l’IGN', FILM_3D_FALLBACK)

// 3. Affiche : l'affiche d'exemple à gauche, lent zoom ; texte à droite.
await htmlShot('affiche', {
  dur: 7,
  css: `
    #all { background: radial-gradient(ellipse at 35% 45%, #3A3835 0%, #191817 75%); color: #FAF9F6; }
    #pst { position: absolute; left: 150px; top: 50%; height: 600px; border-radius: 3px; transform-origin: 50% 50%;
      box-shadow: 0 18px 50px rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.35); }
    .txt { position: absolute; left: 640px; right: 70px; top: 50%; transform: translateY(-50%); }
    .txt .eyebrow { color: #F0CFA8; margin-bottom: 14px; }
    h2 { font-size: 3.4rem; line-height: 1.1; font-weight: 700; }
    h2 i { color: #F08A62; }
    ul { list-style: none; padding: 0; margin: 30px 0 0; font-size: 1.55rem; line-height: 1.5; }
    li { opacity: 0; margin-bottom: 10px; }
    li::before { content: '✓'; color: #9CCBA9; font-weight: 700; margin-right: 12px; }`,
  body: `<img id="pst" src="${fileUrl(POSTER)}">
    <div class="txt"><div id="h"><span class="eyebrow">Après la course</span><h2>L’affiche de<br><i>votre course</i></h2></div>
      <ul><li id="l1">Tracé, temps, allure et profil</li><li id="l2">4 modèles, vos photos, vos couleurs</li>
      <li id="l3">A3, A4 ou carré : à imprimer ou à partager</li></ul></div>`,
  frame: `(t, dur) => {
    document.getElementById('all').style.opacity = clamp(t / 0.5)
    const p = document.getElementById('pst')
    p.style.opacity = clamp((t - 0.1) / 0.6)
    p.style.transform = 'translateY(-50%) rotate(-2deg) scale(' + (1 + 0.05 * ease(clamp(t / dur))) + ')'
    rise(document.getElementById('h'), t, 0.5)
    ;['l1', 'l2', 'l3'].forEach((id, i) => rise(document.getElementById(id), t, 1.5 + i * 0.8))
  }`,
})

// 4. Livre : doubles pages du PDF posées sur un fond sombre, en fondu enchaîné et lent zoom ; puis l'impression.
if (BOOK_PAGES.length) {
  const per = 9 / BOOK_PAGES.length, fade = 0.6
  await htmlShot('livre', {
    dur: 9,
    css: `
      #all { background: radial-gradient(ellipse at 50% 40%, #3A3835 0%, #191817 75%); }
      .pg { position: absolute; left: 50%; top: 45%; max-width: 1120px; max-height: 540px; opacity: 0; border-radius: 3px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.35); }
      .cap { position: absolute; left: 0; right: 0; bottom: 34px; text-align: center; color: #FAF9F6; opacity: 0;
        font-family: 'Playfair Display', Georgia, serif; font-size: 2.1rem; }
      .cap i { color: #F0CFA8; }`,
    body: BOOK_PAGES.map((p, i) => `<img class="pg" id="p${i}" src="${fileUrl(p)}">`).join('') +
      `<div class="cap" id="cap">Le livre de vos sillons : <i>affiches, records et progression</i></div>` +
      // Codes eux-mêmes jamais montrés : ils ne s'affichent qu'après l'enregistrement (printPartners.ts).
      `<div class="cap" id="cap2">Impression chez WhiteWall et Flexilivre, <i>code de réduction inclus</i></div>`,
    frame: `(t, dur) => {
      const per = ${per}, fade = ${fade}, n = ${BOOK_PAGES.length}
      for (let i = 0; i < n; i++) {
        const el = document.getElementById('p' + i), t0 = i * per
        // Fondu enchaîné : la page s'efface pendant que la suivante apparaît (formats différents : sinon elle dépasse).
        const fadeIn = i === 0 ? clamp((t - t0 + 0.01) / 0.5) : clamp((t - t0 + fade / 2) / fade)
        el.style.opacity = i < n - 1 ? Math.min(fadeIn, clamp((t0 + per + fade / 2 - t) / fade)) : fadeIn
        const k = clamp((t - t0 + fade / 2) / (per + fade))
        el.style.transform = 'translate(-50%, -50%) scale(' + (1 + 0.06 * k) + ')'
        el.style.zIndex = i
      }
      document.getElementById('cap').style.opacity = vis(t, 0.5, 4.6, 0.5)
      document.getElementById('cap2').style.opacity = vis(t, 4.8, 99, 0.5)
    }`,
  })
} else {
  card('livre', 9, FOREST, [
    text('LIVRE À INSÉRER', { font: SANS_B, size: 40, color: TERRA, y: 330, to: 9 }),
    text('Le livre de vos sillons', { font: SERIF, size: 90, color: STONE, y: 400, to: 4.6 }),
    text('affiches, records et progression', { font: SERIF_I, size: 52, color: STONE, y: 540, from: 0.4, to: 4.6 }),
    text('Impression chez WhiteWall et Flexilivre', { font: SERIF, size: 76, color: STONE, y: 420, from: 4.8 }),
    text('code de réduction inclus', { font: SERIF_I, size: 52, color: STONE, y: 540, from: 5.2 }),
    text('Images public/demo/livre-*.jpg introuvables', { size: 30, color: STONE, y: 900, to: 9 }),
  ])
  console.log('⚠ public/demo/livre-*.jpg absents : écran provisoire pour le livre')
}

card('principes', 3.8, FOREST, [
  text('Sans compte, sans pub, sans IA et gratuit', { font: SERIF, size: 76, color: STONE, y: 'h/2-text_h/2', from: 0.2, to: 3.8 }),
])

// Image fixe jusqu'au bout : les textes apparaissent puis ne s'effacent plus.
card('fin', 6.2, STONE, [
  text('Sur ordinateur, téléphone et tablette', { size: 50, color: FOREST, y: 360, from: 0.2, fade: 0.6 }),
  text('sillonphane.fr/running', { font: SERIF, size: 120, color: TERRA, y: 460, from: 0.5, fade: 0.6 }),
  text('Essayez avec votre parcours', { font: SERIF_I, size: 44, color: INK, y: 640, from: 1, fade: 0.6 }),
  text('À bientôt !', { font: SERIF, size: 64, color: FOREST, y: 800, from: 3.6, fade: 0.6 }),
])

// ─── Assemblage ───────────────────────────────────────────────────────────────

const list = join(TMP, 'concat.txt')
writeFileSync(list, segments.map(s => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'))
const silent = join(TMP, 'muet.mp4')
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent])

// Début de chaque plan dans la vidéo montée.
const shotStart = {}
let clock = 0
for (const s of segments) { shotStart[s.name] ??= clock; clock += duration(s.file) }
console.log(segments.map(s => `${s.name} à ${shotStart[s.name].toFixed(1)} s`).join(' · '))
const voices = VOICE.map(v => ({ ...v, file: join(VOICE_DIR, `${v.n}.wav`) })).filter(v => existsSync(v.file))

if (existsSync(MUSIC.file)) {
  const dur = duration(silent)
  // Musique : fondu d'entrée bref, fondu de sortie de 4 s, ramenée à −16 LUFS (niveau visé par YouTube).
  const music = `[1:a]afade=t=in:d=0.5,afade=t=out:st=${dur - 4}:d=4,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000`
  let af
  if (voices.length) {
    // Voix posées à leur instant, mises au même niveau ; la musique baisse (sidechain) tant qu'on parle.
    const delays = voices.map((v, i) =>
      `[${i + 2}:a]aresample=48000,highpass=f=80,adelay=${Math.round((shotStart[v.shot] + v.at) * 1000)}:all=1[v${i}]`)
    af = [
      ...delays,
      `${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length}:normalize=0,apad,` +
        `loudnorm=I=-15:TP=-1.5:LRA=7,aresample=48000,asplit[voix][cle]`,
      // Signal de commande muet ajouté avant la 1re phrase : la musique démarre déjà au niveau bas.
      `aevalsrc=0.15*sin(2*PI*200*t):s=48000:d=${(shotStart[voices[0].shot] + voices[0].at + 0.3).toFixed(2)},apad[avance]`,
      `[cle][avance]amix=inputs=2:normalize=0:duration=first[commande]`,
      `${music},volume=-6dB[mus]`,
      `[mus][commande]sidechaincompress=threshold=0.015:ratio=6:attack=30:release=600[fond]`,
      `[fond][voix]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[a]`,
    ].join(';')
    voices.forEach(v => console.log(`Voix ${v.n} à ${(shotStart[v.shot] + v.at).toFixed(1)} s (${v.shot})`))
  } else {
    af = `${music}[a]`
    console.log(`Pas de commentaire dans ${VOICE_DIR} : musique seule`)
  }
  ff(['-i', silent, '-ss', String(MUSIC.start), '-i', MUSIC.file, ...voices.flatMap(v => ['-i', v.file]),
    '-filter_complex', af, '-t', String(dur), '-map', '0:v', '-map', '[a]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT])
} else {
  console.log(`⚠ ${MUSIC.file} absent : vidéo muette`)
  ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', OUT])
}
rmSync(TMP, { recursive: true, force: true })
console.log(`\nVidéo prête : ${OUT} (${clock.toFixed(1)} s)`)
