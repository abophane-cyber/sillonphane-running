/**
 * youtube-4k.mjs — Version 4K pour YouTube d'un film exporté par l'appli (1920×1080).
 *
 * Usage : node scripts/youtube-4k.mjs "<film.mp4>" [<sortie.mp4>]
 * Résultat par défaut : à côté du film, « <nom>_YouTube_4K.mp4 ».
 *
 * Réglages recommandés par YouTube : MP4 H.264, 3840×2160, même cadence que le film (30 i/s), environ 50 Mbit/s
 * (plafond 60), SDR Rec.709 en plage vidéo (le film de l'appli sort en plage pleine, « yuvj420p »). Agrandissement
 * lanczos : YouTube réserve aux vidéos 4K un débit bien plus élevé, d'où une image plus nette même agrandie.
 * Le son éventuel est réencodé en AAC 192 kbit/s.
 */
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import ffmpeg from 'ffmpeg-static'

const [input, output] = process.argv.slice(2)
if (!input || !existsSync(input)) {
  console.error('Usage : node scripts/youtube-4k.mjs "<film.mp4>" [<sortie.mp4>]')
  process.exit(1)
}
const out = output ?? join(dirname(input), `${basename(input, extname(input))}_YouTube_4K.mp4`)

const args = [
  '-hide_banner', '-y', '-i', input,
  '-vf', 'scale=3840:2160:flags=lanczos:in_range=full:out_range=tv,fps=30,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '5.1',
  '-b:v', '50M', '-maxrate', '60M', '-bufsize', '100M',
  '-g', '15', '-bf', '2', // GOP d'une demi-seconde, 2 images B : recommandations YouTube
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-movflags', '+faststart',
  out,
]
console.log(`4K : ${input}\n  -> ${out}`)
const r = spawnSync(ffmpeg, args, { stdio: 'inherit' })
process.exit(r.status ?? 1)
