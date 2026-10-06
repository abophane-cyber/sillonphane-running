/**
 * demo-photos.mjs — Régénère les photos de la rando d'exemple (public/demo/vanoise/) à partir des
 * originaux : réduction à 2000 px de large, EXIF retiré, bande semi-transparente en bas avec
 * l'adresse du site centrée.
 *
 * Usage : node scripts/demo-photos.mjs ["dossier des originaux"]
 * Défaut : P:\Mes photos\1 RANDO\GTA 2025\GTA Archives\4 Vanoise
 *
 * Après régénération, incrémenter DEMO_VERSION dans src/lib/demoTrip.ts : les rando d'exemple déjà
 * ouvertes récupèrent alors les nouvelles images (et l'URL versionnée contourne le cache).
 * L'heure de prise de vue n'est pas lue dans l'EXIF : elle est reportée dans DEMO_PHOTOS (demoTrip.ts).
 */
import { execFileSync } from 'child_process'
import { existsSync, writeFileSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import ffmpeg from 'ffmpeg-static'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2] || 'P:\\Mes photos\\1 RANDO\\GTA 2025\\GTA Archives\\4 Vanoise'
const OUT = join(ROOT, 'public/demo/vanoise')
const ADRESSE = 'sillonphane.fr/rando'
const NAMES = ['073836', '092219', '095935', '105202', '113421', '115907', '124814'].map(t => `20250801_${t}.jpg`)

// Même rendu que la version précédente : bande noire à 25 %, haute de 12 % de l'image, texte gras
// blanc à 80 %, centré dans la bande.
const textFile = join(tmpdir(), 'sillonphane-filigrane.txt')
writeFileSync(textFile, ADRESSE)
const fpath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:')
const vf = [
  'scale=2000:-2',
  'drawbox=x=0:y=ih*0.88:w=iw:h=ih*0.12:color=black@0.25:t=fill',
  `drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':textfile='${fpath(textFile)}':fontsize=h*0.068:fontcolor=white@0.8:x=(w-text_w)/2:y=h*0.94-text_h/2-h*0.008`,
].join(',')

for (const name of NAMES) {
  const src = join(SRC, name)
  if (!existsSync(src)) { console.error(`Original introuvable : ${src}`); process.exitCode = 1; continue }
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf,
    '-map_metadata', '-1', '-q:v', '5', join(OUT, name)], { stdio: 'inherit' })
  console.log(`✓ ${name}`)
}
rmSync(textFile, { force: true })
