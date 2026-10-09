// Publie l'APK sur le site : copie le build debug dans public/downloads/ et réécrit version.json
// avec la version (lue dans android/app/build.gradle), la taille et la date du fichier.
// La landing lit ce version.json pour afficher « Version · taille · date » à côté du bouton.
//   npm run apk:publish             → copie le build puis met à jour version.json
//   npm run apk:publish -- --no-copy → ne fait que recalculer version.json sur l'APK déjà publié
//
// L'empreinte SHA-256 est enregistrée mais pas affichée (affichée, elle inquiétait plus qu'elle ne
// rassurait) : elle permet de vérifier à la main quel fichier est en ligne, ou de retrouver son
// analyse VirusTotal (https://www.virustotal.com/gui/file/<sha256>).
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const SRC = 'android/app/build/outputs/apk/debug/app-debug.apk'
const DEST = 'public/downloads/sillonphane-running.apk'
const JSON_PATH = 'public/downloads/version.json'

if (!process.argv.includes('--no-copy')) copyFileSync(SRC, DEST)

const gradle = readFileSync('android/app/build.gradle', 'utf8')
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)[1])
const versionName = gradle.match(/versionName\s+"([^"]+)"/)[1]

const info = {
  versionCode,
  versionName,
  sizeBytes: statSync(DEST).size,
  date: statSync(DEST).mtime.toISOString().slice(0, 10),
  sha256: createHash('sha256').update(readFileSync(DEST)).digest('hex'),
}
writeFileSync(JSON_PATH, JSON.stringify(info, null, 2) + '\n')
console.log(info)
