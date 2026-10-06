/**
 * youtube-video.mjs — Monte la vidéo de présentation YouTube (1920×1080, 30 i/s, sans son).
 *
 * Usage : node scripts/youtube-video.mjs
 * Résultat : scripts/videos/sillonphane-rando-presentation.mp4 (dossier non versionné).
 *
 * Extraits de film à déposer dans scripts/videos/ (exportés depuis l'appli, rando d'exemple :
 * https://sillonphane.fr/rando/app.html?demo) :
 *   film-2d.mp4  film 2D  → plan 3 (repli : public/demo/2D.mp4, extrait de la landing)
 *   film-3d.mp4  film 3D  → plan 4
 *   album/page-N.png  pages de l'album PDF de la rando, rendues en 3000 px de large (par ex. avec le
 *                     paquet npm mupdf) ; repli : photos de la rando. Pages retenues : ALBUM_PAGES.
 * Tant qu'un film manque, son plan est remplacé par un écran « à insérer ».
 * Début et durée de chaque extrait : FILM_3D / FILM_2D ci-dessous.
 *
 * Message (voir CLAUDE.md du dossier parent) : la trace GPX/KML donne le film, les photos donnent
 * l'album. Musique : MUSIC ci-dessous (vidéo muette si le fichier manque).
 * Commentaire : scripts/videos/commentaire/1.wav … 8.wav (texte dans Texte.txt), placés par VOICE ;
 * la musique baisse d'elle-même sous la voix. Sans ces fichiers, musique seule.
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
const OUT = join(OUT_DIR, 'sillonphane-rando-presentation.mp4')

const W = 1920, H = 1080, FPS = 30
const FILM_3D = { file: join(OUT_DIR, 'film-3d.mp4'), start: 25, duration: 9 } // panneau « Col de la Vanoise » vers 29-31 s
const FILM_2D = { file: join(OUT_DIR, 'film-2d.mp4'), start: 6, duration: 7.5 }
const FILM_2D_FALLBACK = join(ROOT, 'public/demo/2D.mp4')
// Album « Vanoise flexilivre 15x21.pdf » (5 pages, paysage 21×15).
const ALBUM_PAGES = [1, 2, 3, 4, 5].map(n => join(OUT_DIR, `album/page-${n}.png`))

// Musique de l'utilisateur (MP3 tiré du WAV d'origine), à partir de « start » s, fondu de sortie sur
// l'image fixe de fin. Autre essai : { file: 'P:/Ma musique/projet midi 2b-0.mp3', start: 1.5 } (1,6 s de silence au début).
const MUSIC = { file: 'P:/Ma musique/Projet 3.mp3', start: 0 }

// Commentaire enregistré, une phrase par fichier : plan sur lequel elle démarre et décalage (s) dans ce plan.
const VOICE_DIR = join(OUT_DIR, 'commentaire')
const VOICE = [
  { n: 1, shot: 'ouverture', at: 1.5 }, // Sillonphane est un site gratuit…
  { n: 2, shot: 'trace', at: 0.1 },     // À partir d'un fichier GPX ou KML…
  { n: 3, shot: 'film-2d', at: 0.3 },   // …un film, avec les panneaux de localités, en 2D… ou en 3D
  { n: 4, shot: 'photos', at: 0.3 },    // Sur sillonphane.fr, vous pourrez aussi réaliser… vos albums photos
  { n: 5, shot: 'album-pdf', at: 9.5 }, // Vous pourrez les imprimer chez nos partenaires…
  { n: 6, shot: 'principes', at: 0.2 }, // Sans compte, sans publicité, sans IA, et gratuit
  { n: 7, shot: 'fin', at: 0.5 },       // Pour tester, une rando d'exemple vous attend sur sillonphane.fr/rando
  { n: 8, shot: 'fin', at: 6.5 },       // À bientôt !
]

// Charte de la landing : pierre claire, vert forêt, terracotta.
const STONE = '0xFAF9F6', FOREST = '0x2F4839', INK = '0x191817', TERRA = '0xC15C3D'
const SERIF = 'C\\:/Windows/Fonts/georgia.ttf'
const SERIF_I = 'C\\:/Windows/Fonts/georgiai.ttf'
const SANS = 'C\\:/Windows/Fonts/segoeui.ttf'
const SANS_B = 'C\\:/Windows/Fonts/seguisb.ttf'

// Photos de la rando sans incrustation (celles de public/demo/vanoise/ portent l'adresse du site en bas).
const DEMO = name => join(ROOT, 'public/demo', name)

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

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

// Photo plein cadre avec lent zoom (Ken Burns), assombrie en bas pour lire le texte.
function photoKenBurns(name, img, dur, texts, zoomTo = 1.08) {
  const frames = Math.round(dur * FPS)
  const vf = [
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2}`,
    `zoompan=z='1+(${zoomTo - 1})*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    // Bande sombre seulement sous un texte.
    ...(texts.length ? [`drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.35:t=fill`] : []),
    ...texts,
  ].join(',')
  segment(name, ['-loop', '1', '-i', img, '-t', String(dur), '-vf', vf])
}

// Écran uni avec textes.
function card(name, dur, bg, texts) {
  segment(name, ['-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${FPS}:d=${dur}`, '-vf', texts.join(',')])
}

// Extrait de film, mis à 1920×1080, avec un bandeau de légende en bas.
function film(name, { file, start, duration }, caption, fallback) {
  const src = existsSync(file) ? file : fallback
  if (!src) {
    card(name, duration, FOREST, [
      text('FILM À INSÉRER', { font: SANS_B, size: 40, color: TERRA, y: 380 }),
      text(caption, { font: SERIF, size: 72, color: STONE, y: 460 }),
      text(`Déposer ${file.split(/[\\/]/).pop()} dans scripts/videos/`, { size: 34, color: STONE, y: 600 }),
    ])
    console.log(`⚠ ${file} absent : écran provisoire`)
    return
  }
  const useStart = src === file ? start : 0
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${INK}`,
    `fps=${FPS}`, 'setsar=1',
    `drawbox=x=0:y=ih-150:w=iw:h=150:color=black@0.45:t=fill`,
    text(caption, { font: SERIF, size: 60, color: STONE, y: 'h-112', from: 0.3, to: duration }),
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
  h1 { font-family: 'Playfair Display', Georgia, serif; margin: 0; }
  h1 i { font-style: italic; font-weight: 500; }`
// Fonctions communes injectées dans la page.
const HELPERS = `
  const clamp = x => Math.min(1, Math.max(0, x))
  const ease = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
  // Opacité d'un élément visible de « from » à « to », avec fondus d'entrée et de sortie.
  const vis = (t, from, to, fade = 0.6) => Math.min(clamp((t - from) / fade), clamp((to - t) / fade))
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

// ─── Montage ──────────────────────────────────────────────────────────────────

// 1. Ouverture sur le modèle du hero de sillonphane.fr/rando (index.html, section .hero) : fondu depuis
// le noir sur le Lac des Vaches, logo centré qui se dessine, puis deux titres en fondu enchaîné.
await htmlShot('ouverture', {
  dur: 9.5,
  css: `
    #photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: saturate(1.05) contrast(1.04); }
    .scrim { position: absolute; inset: 0; background:
      radial-gradient(ellipse 70% 55% at 50% 48%, rgba(10,12,10,0.34) 0%, rgba(10,12,10,0) 100%),
      linear-gradient(to bottom, rgba(10,12,10,0.28) 0%, rgba(10,12,10,0.10) 35%, rgba(10,12,10,0.10) 65%, rgba(10,12,10,0.42) 100%); }
    .in { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(calc(-50% - 30px)); text-align: center; color: #fff; }
    .sigle { display: block; width: 92px; height: auto; margin: 0 auto 18px; filter: drop-shadow(0 2px 10px rgba(0,0,0,0.45)); }
    .titles { display: grid; }
    .titles > div { grid-area: 1 / 1; opacity: 0; }
    .eyebrow { display: block; font-size: 0.95rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;
      color: #F0CFA8; margin-bottom: 14px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
    h1 { font-size: 5.25rem; line-height: 1.04; letter-spacing: -0.02em; font-weight: 700; color: #fff;
      text-shadow: 0 2px 4px rgba(0,0,0,0.35), 0 6px 30px rgba(0,0,0,0.45); }
    h1 .t-terra { color: #F08A62; }
    h1 .t-forest { color: #9CCBA9; }`,
  body: `<img id="photo" src="${fileUrl(join(ROOT, 'public/hero/rando-1.jpg'))}"><div class="scrim"></div>
    <div class="in">
      <svg class="sigle" viewBox="96 34 154 218">
        <defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#2F4839"/><stop offset="50%" stop-color="#C15C3D"/><stop offset="100%" stop-color="#F5F3EF"/>
        </linearGradient></defs>
        <path id="s" pathLength="1" d="M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60"
              fill="none" stroke="url(#g)" stroke-width="29" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="1"/>
        <circle id="e" cx="220" cy="60" r="11" fill="#2F4839" stroke="#F5F3EF" stroke-width="4" opacity="0"/>
        <circle id="d" cx="138" cy="225" r="11" fill="#F5F3EF" opacity="0"/>
      </svg>
      <div class="titles">
        <div id="t1"><span class="eyebrow">Sillonphane</span><h1>Gardez la trace<br>de vos <i class="t-terra">sorties</i></h1></div>
        <div id="t2"><span class="eyebrow">Sillonphane-Rando</span><h1>Transformez vos<br><i class="t-terra">randonnées</i> en&nbsp;<i class="t-forest">souvenirs</i></h1></div>
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

card('trace', 7, STONE, [
  text('Une trace GPS', { font: SERIF, size: 110, color: FOREST, y: 380, from: 0.2, to: 7 }),
  text('fichier GPX ou KML, ou enregistrée avec l’appli Android Sillonphane', { size: 48, color: INK, y: 540, from: 0.7, to: 7 }),
  text('Randonnées en France uniquement : cartes et vues aériennes IGN', { font: SERIF_I, size: 42, color: FOREST, y: 650, from: 1.7, to: 7 }),
])

film('film-2d', FILM_2D, 'devient un film en 2D, avec vos personnages et vos panneaux', FILM_2D_FALLBACK)
film('film-3d', FILM_3D, '…ou en 3D, en survol du relief')

card('photos', 3.5, STONE, [
  text('Vos albums-photos', { font: SERIF, size: 100, color: FOREST, y: 380, from: 0.2, to: 3.5 }),
  text('composés automatiquement ou selon vos choix', { size: 48, color: INK, y: 530, from: 0.7, to: 3.5 }),
])

// 2. Album : pages du PDF posées sur un fond sombre, en fondu enchaîné et lent zoom.
const albumPages = ALBUM_PAGES.filter(existsSync)
if (albumPages.length) {
  const per = 3, fade = 0.6
  await htmlShot('album-pdf', {
    dur: per * albumPages.length,
    css: `
      #all { background: radial-gradient(ellipse at 50% 40%, #3A3835 0%, #191817 75%); }
      .pg { position: absolute; left: 50%; top: 44%; height: 540px; opacity: 0; border-radius: 3px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.35); }
      .cap { position: absolute; left: 0; right: 0; bottom: 34px; text-align: center; color: #FAF9F6; opacity: 0;
        font-family: 'Playfair Display', Georgia, serif; font-size: 2.1rem; }
      .cap i { color: #F0CFA8; }`,
    body: albumPages.map((p, i) => `<img class="pg" id="p${i}" src="${fileUrl(p)}">`).join('') +
      `<div class="cap" id="cap">Tout se modifie à la main, <i>puis s’exporte en PDF</i></div>` +
      // Codes eux-mêmes jamais montrés : ils ne s'affichent qu'en fin d'export (docs/codes-promo.md).
      `<div class="cap" id="cap2">Impression chez nos partenaires Flexilivre, WhiteWall… <i>code de réduction inclus</i></div>`,
    frame: `(t, dur) => {
      const per = ${per}, fade = ${fade}, n = ${albumPages.length}
      for (let i = 0; i < n; i++) {
        const el = document.getElementById('p' + i), t0 = i * per
        el.style.opacity = i === 0 ? clamp((t - t0 + 0.01) / 0.5) : clamp((t - t0 + fade / 2) / fade)
        const k = clamp((t - t0 + fade / 2) / (per + fade))
        el.style.transform = 'translate(-50%, -50%) scale(' + (1 + 0.06 * k) + ')'
        el.style.zIndex = i
      }
      const mid = Math.round(n / 2) * per
      document.getElementById('cap').style.opacity = vis(t, 0.8, mid, 0.5)
      document.getElementById('cap2').style.opacity = vis(t, mid + 0.3, 99, 0.5)
    }`,
  })
} else {
  photoKenBurns('album-photo-1', DEMO('20250801_073836b.jpg'), 3, [], 1.05)
  photoKenBurns('album-photo-2', DEMO('20250801_110000.jpg'), 3, [], 1.05)
  photoKenBurns('album-photo-3', DEMO('20250801_112754.jpg'), 4, [
    text('Tout se modifie à la main', { font: SERIF, size: 76, color: STONE, y: 'h*0.66', from: 0.2, to: 4 }),
    text('puis s’exporte en PDF ou s’imprime', { font: SERIF_I, size: 50, color: STONE, y: 'h*0.66+110', from: 0.6, to: 4 }),
  ], 1.05)
}

card('principes', 6, FOREST, [
  text('Sans compte, sans pub, sans IA et gratuit', { font: SERIF, size: 76, color: STONE, y: 'h/2-text_h/2', from: 0.2, to: 6 }),
])

// Image fixe jusqu'au bout : les textes apparaissent puis ne s'effacent plus.
card('fin', 8, STONE, [
  text('Navigateur et Android', { size: 50, color: FOREST, y: 360, from: 0.2, to: 99, fade: 0.6 }),
  text('sillonphane.fr/rando', { font: SERIF, size: 120, color: TERRA, y: 460, from: 0.5, to: 99, fade: 0.6 }),
  text('Une rando d’exemple vous attend pour tester', { font: SERIF_I, size: 44, color: INK, y: 640, from: 1, to: 99, fade: 0.6 }),
  text('À bientôt !', { font: SERIF, size: 64, color: FOREST, y: 800, from: 6.3, to: 99, fade: 0.6 }),
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
  }
  ff(['-i', silent, '-ss', String(MUSIC.start), '-i', MUSIC.file, ...voices.flatMap(v => ['-i', v.file]),
    '-filter_complex', af, '-t', String(dur), '-map', '0:v', '-map', '[a]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT])
} else {
  console.log(`⚠ ${MUSIC.file} absent : vidéo muette`)
  ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', OUT])
}
rmSync(TMP, { recursive: true, force: true })
console.log(`\nVidéo prête : ${OUT}`)
