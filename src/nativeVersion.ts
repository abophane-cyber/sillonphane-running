// Version de l'APK embarqué dans CE build — à bumper à la main EN MÊME TEMPS que
// `versionCode` / `versionName` dans android/app/build.gradle et public/downloads/version.json,
// à chaque nouvelle release de l'APK.
// NATIVE_VERSION_CODE sert à détecter une mise à jour disponible (voir useAppUpdateCheck) ;
// NATIVE_VERSION_NAME est affiché en bas de l'écran d'accueil (SplashScreen).
export const NATIVE_VERSION_CODE = 7
export const NATIVE_VERSION_NAME = '1.6'
