function ignWmts(layer: string, format = 'image/png') {
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${format}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
}

// Fond de carte unique de l'appli (carte, films 2D, album) : Plan IGN v2 (Géoplateforme, licence
// Etalab 2.0 — mention « © IGN » obligatoire là où la carte apparaît). Les fonds OpenStreetMap et
// OpenTopoMap ont été retirés : leurs politiques d'usage interdisent le préchargement massif que
// fait l'export vidéo.
export const IGN_TILE_URL = ignWmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')

// Running : fond de l'animation et du film 2D = vues aériennes IGN (BD ORTHO, même licence, « © IGN »), assombries
// (style « épreuve » : le ruban, les noms écrits sur la carte et la coureuse ressortent). Sans noms imprimés dans
// l'image : pas de « Lille » en double avec ceux de l'appli. L'album garde le Plan IGN (IGN_TILE_URL).
export const BASEMAP_TILE_URL = ignWmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')
export const BASEMAP_BACKGROUND = '#1d2320'
/** Réglages de couleur du fond, appliqués par MapLibre (raster-*) dans l'aperçu et reproduits à l'identique sur la
 * mosaïque du film (filmMapMosaic.ts) : contraste, saturation, luminosité max (assombrissement), teinte. */
export const BASEMAP_ADJUST = { contrast: 0.12, saturation: -0.1, brightnessMax: 0.62, hueRotate: 0 }
