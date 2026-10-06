function ignWmts(layer: string, format = 'image/png') {
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${format}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
}

// Fond de carte unique de l'appli (carte, films 2D, album) : Plan IGN v2 (Géoplateforme, licence
// Etalab 2.0 — mention « © IGN » obligatoire là où la carte apparaît). Les fonds OpenStreetMap et
// OpenTopoMap ont été retirés : leurs politiques d'usage interdisent le préchargement massif que
// fait l'export vidéo.
export const IGN_TILE_URL = ignWmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')
