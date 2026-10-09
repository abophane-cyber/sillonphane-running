// Identité de l'appli. Toutes les déclinaisons de Sillonphane sont servies depuis le même domaine (sillonphane.fr/rando,
// /running, /cyclo…) : sans noms propres, elles partageraient le stockage du navigateur (même base IndexedDB, mêmes
// clés localStorage) et leurs sillons se mélangeraient. Running a donc sa base (STORAGE_DB), ses clés préfixées
// (STORAGE_PREFIX), son identifiant Android (capacitor.config.ts) et marque ses sauvegardes (APP_ID) pour refuser
// celles d'une autre appli.

export const APP_ID = 'running'
export const APP_NAME = 'Sillonphane-Running'

/** Base IndexedDB propre à Running. */
export const STORAGE_DB = 'sillon-running'

/** Préfixe des clés localStorage / sessionStorage de Running. */
export const STORAGE_PREFIX = 'running:'

/** Nom des déclinaisons, pour expliquer d'où vient une sauvegarde refusée. */
export const APP_NAMES: Record<string, string> = {
  rando: 'Sillonphane-Rando',
  running: 'Sillonphane-Running',
  cyclo: 'Sillonphane-Cyclo',
  'ultra-trail': 'Sillonphane-Ultra-trail',
}
