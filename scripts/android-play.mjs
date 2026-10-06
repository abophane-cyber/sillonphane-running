// Construit le bundle Android (.aab) signé pour le Play Store.
//   npm run android:play
// - VITE_DISTRIBUTION=play : le bundle web embarqué ne cherche pas de mise à jour sur le site
//   (Google Play gère les mises à jour ; voir useAppUpdateCheck).
// - build release : signé avec la clé d'upload décrite dans android/keystore.properties
//   (absente de git) et sans la permission REQUEST_INSTALL_PACKAGES (src/release/AndroidManifest.xml).
// Résultat : android/app/build/outputs/bundle/release/app-release.aab, à déposer dans la Play Console.
// Voir docs/play-store.md.
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('android/keystore.properties')) {
  console.error('android/keystore.properties introuvable : créer la clé d\'upload d\'abord (docs/play-store.md).')
  process.exit(1)
}

const env = { ...process.env, VITE_DISTRIBUTION: 'play' }
execSync('npm run android:sync', { stdio: 'inherit', env })
const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew'
execSync(`${gradlew} bundleRelease`, { stdio: 'inherit', env, cwd: 'android' })
console.log('\nBundle prêt : android/app/build/outputs/bundle/release/app-release.aab')
