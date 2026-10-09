export interface GpxPoint {
  lat: number
  lon: number
  ele: number
  time?: Date
}

export interface GpxTrack {
  name: string
  points: GpxPoint[]
  distance: number      // mètres
  elevGain: number      // dénivelé positif en mètres
  elevLoss: number      // dénivelé négatif
  startTime?: Date
  endTime?: Date
  duration?: number     // secondes
}

export interface ParsedGpx {
  tracks: GpxTrack[]
  waypoints: GpxPoint[]
  name?: string
}

export interface AnimationState {
  playing: boolean
  speed: number         // multiplicateur : 1, 2, 4, 8
  progress: number      // 0..1 le long du tracé
  currentPoint: GpxPoint | null
  distanceCovered: number
  elevCovered: number
  currentEle: number
}

// ── Dossiers Voyage ──────────────────────────────────────────────────────────

export type PhotoLayout =
  | 'hero' | 'duo' | 'magazine3' | 'gallery4' | 'notebook3' | 'mosaic5' | 'triptych' | 'soloText'
  | 'triptychPortrait' | 'mixedOrientation' | 'grid' | 'triangle3' | 'stack2'

export interface ComposedPhotoSlot {
  photoId?: string        // photo affectée à cet emplacement (absent = emplacement vide)
  caption?: boolean        // afficher la légende IA de cette photo ; absent = affichée si elle existe
  text?: string            // texte libre à la place d'une photo dans cet emplacement (ignoré si photoId présent)
}

/** Ancien format de page composée (gabarit figé) — conservé uniquement pour migrer les albums déjà enregistrés. */
export interface LegacyComposedAlbumPage {
  id: string
  layout: PhotoLayout
  slots: ComposedPhotoSlot[]
  text?: string
  header?: boolean
}

export type AlbumBoxKind = 'photo' | 'text' | 'decor'

/** Emplacement libre sur une page d'album : position et taille en % de la zone de contenu (sous le bandeau). */
export interface AlbumBox {
  id: string
  kind: AlbumBoxKind
  x: number                // % depuis la gauche
  y: number                // % depuis le haut
  w: number                // % largeur
  h: number                // % hauteur

  // ── kind === 'decor' — motif décoratif manipulable (scotch, tampon, étiquette, flèche…) ──
  decorType?: string        // identifiant du motif SVG (voir CoverDecorKind) — générique
  decorFilled?: boolean     // décor 'framerect' / 'circle' : true = aplat plein ; absent = au trait
  color?: string            // teinte du motif (hex) ; absent = couleur de décor du gabarit
  visible?: boolean         // false = masqué (sans être supprimé) ; absent = visible
  shadow?: boolean          // ombre portée du cadre : true = ombrée, false = sans ombre ; absent = défaut selon `kind` (photo ombrée, décor non)
  shadowLevel?: number      // intensité de l'ombre quand `shadow` est actif : 1 (légère) à 4 (marquée) ; absent = 2
  shadowDir?: 'tl' | 'tr' | 'bl' | 'br'  // orientation de l'ombre ; absent = tombe droit vers le bas

  // ── Ordre de calques + capacités (tous types) ; absents = valeurs par défaut selon `kind` ──
  zIndex?: number           // ordre de calque numérique (bg 0 · paper 10 · map 20 · photo 30 · decor 40 · text 60)
  movable?: boolean
  resizable?: boolean
  rotatable?: boolean
  deletable?: boolean
  duplicable?: boolean
  photoId?: string          // kind === 'photo'
  photoOffsetX?: number      // kind === 'photo' — position horizontale du recadrage, % ; absent = 50 (centré)
  photoOffsetY?: number      // kind === 'photo' — position verticale du recadrage, % ; absent = 50 (centré)
  photoScale?: number        // kind === 'photo' — échelle de la photo dans son cadre ; absent = 1 (remplit le cadre, recadrée)
  photoFit?: 'cover' | 'contain' // kind === 'photo' — 'contain' affiche la photo entière sans la recadrer ; absent = 'cover' (remplit le cadre)
  caption?: boolean          // afficher la légende IA de cette photo ; absent = affichée si elle existe
  text?: string              // kind === 'text'
  rotation?: number          // inclinaison en degrés, tout type de box
  fontSize?: number          // taille du texte en px ; kind === 'text'
  fontFamily?: string        // famille de police ; kind === 'text'
  bold?: boolean             // texte en gras ; kind === 'text'
  italic?: boolean           // texte en italique ; kind === 'text'
  textAlign?: 'left' | 'center' | 'right' | 'justify'  // alignement du texte ; absent = gauche ; kind === 'text'
  textColor?: string         // couleur du texte (hex) ; absent = couleur par défaut ; kind === 'text'
  bgColor?: string           // couleur de fond ('transparent' ou hex) ; absent = blanc ; kind === 'text'
  borderColor?: string       // couleur du cadre ; absent = pas de cadre ; kind === 'text'
}

export interface ComposedAlbumPage {
  id: string
  boxes: AlbumBox[]
  header?: boolean              // bandeau voyage/date/titre au-dessus de la page ; absent = affiché
  headerSubtitle?: string         // texte du bandeau (petite ligne) ; absent = nom du voyage
  headerTitle?: string            // texte du bandeau (grand titre) ; absent = nom de la piste
  kind?: 'summary' | 'cover' | 'backcover'  // résumé auto (carte/dénivelé/météo), couverture ou dos du livre ; absent = page libre normale
  summaryText?: string            // kind === 'summary' — texte éditorial (manuel ou généré par IA) ; absent = texte par défaut

  // ── kind === 'cover' — modèle « template » ─────────────────────────────────
  coverTemplate?: CoverTemplateId // gabarit visuel de la couverture ; absent = migré depuis l'ancien format
  cover?: CoverOverrides          // surcharges de l'utilisateur par-dessus les valeurs du template

  /** @deprecated ancien format de couverture (mise en page figée) — lu uniquement par
   * migrateLegacyCover() puis converti vers coverTemplate + cover. Ne plus écrire. */
  coverTitle?: string
  /** @deprecated → cover.el.dates.text */
  coverSubtitle?: string
  /** @deprecated */ coverTitleScale?: number
  /** @deprecated */ coverTitleX?: number
  /** @deprecated */ coverTitleY?: number
  /** @deprecated */ coverTitleRotate?: number
  /** @deprecated */ coverTagBoxScale?: number
  /** @deprecated */ coverTagFontScale?: number
  /** @deprecated */ coverTagX?: number
  /** @deprecated */ coverTagY?: number
  /** @deprecated */ coverTagRotate?: number
  /** @deprecated */ coverSub1X?: number
  /** @deprecated */ coverSub1Y?: number
  /** @deprecated */ coverSub1Rotate?: number
  /** @deprecated */ coverSub2X?: number
  /** @deprecated */ coverSub2Y?: number
  /** @deprecated */ coverSub2Rotate?: number
  /** @deprecated → cover.bg */ coverFrameColor?: string
}

/** Identifiant d'un gabarit de page couverture (voir src/lib/coverTemplates.ts). */
export type CoverTemplateId =
  | 'epure' | 'carnet' | 'nature' | 'moderne' | 'minimal' | 'libre'
  | 'scandinave' | 'souvenirs' | 'atelier' | 'horizon' | 'carnetmin' | 'formes'
  | 'scrapbook'
  // Gabarits de dos (4e de couverture) — voir lib/coverTemplates.ts (BACK_COVER_TEMPLATES).
  | 'dos-uni' | 'dos-photo' | 'dos-carnet' | 'dos-topo'

/** Élément de couverture surchargeable : sur-titre, titre, ligne de dates, bloc texte, ou carte.
 * `eyebrow` n'existe que sur les gabarits qui le prévoient. */
export type CoverElKey = 'eyebrow' | 'title' | 'dates' | 'body' | 'map'

/** Surcharges d'un élément de couverture — toutes optionnelles ; ce qui est absent vient du template.
 * Positions/tailles en % de la zone de contenu (.albcov-inner), comme AlbumBox. */
export interface CoverElOverride {
  text?: string
  x?: number
  y?: number
  w?: number
  h?: number                      // carte uniquement — hauteur % (remplace `ar` / la hauteur du gabarit)
  rotate?: number                 // degrés
  scale?: number                  // multiplicateur de taille (texte ou carte)
  font?: string                   // pile de familles CSS (valeurs de TEXT_FONTS) ; texte uniquement
  color?: string                  // couleur du texte (hex)
  align?: 'left' | 'center' | 'right' | 'justify'
  hidden?: boolean
  photoId?: string                // map uniquement — remplace la carte par une photo du voyage
  frame?: 'card' | 'strip' | 'plain'  // map uniquement — type de cadre
  fit?: 'cover' | 'contain'       // map uniquement — 'contain' = photo entière dans le cadre ; absent = 'cover'
  shadow?: boolean               // map uniquement — ombre du cadre : true/false ; absent = ombre du CSS selon `frame`
  shadowLevel?: number           // map uniquement — intensité de l'ombre 1..4 quand `shadow` actif ; absent = 2
  shadowDir?: 'tl' | 'tr' | 'bl' | 'br'  // map uniquement — orientation de l'ombre ; absent = droit vers le bas
}

/** Palette de couleurs d'une couverture — jetons référencés par `@nom` dans un gabarit
 * (background, paper, primary, text, labelAdventure…). Voir COVER_PALETTES. */
export interface CoverTheme {
  background: string
  paper: string
  primary: string
  text: string
  labelAdventure: string
  labelNature: string
  labelLiberty: string
}

export interface CoverOverrides {
  bg?: string                     // couleur de fond (surcharge template.background)
  bgImage?: string                // id d'une photo du voyage utilisée en image de fond (remplit la couverture) ; passe DEVANT la couleur `bg`
  decorColor?: string             // couleur du décor (surcharge template.colors.decor)
  decorHidden?: boolean           // masque tout le décor du template
  palette?: string                // id d'une palette de COVER_PALETTES ; absent = thème du gabarit
  el?: Partial<Record<CoverElKey, CoverElOverride>>
  tplRef?: string                 // id du gabarit utilisateur d'origine (surbrillance du sélecteur
                                  // + « Replacer comme le modèle ») — ignoré au rendu
}

/** Copie sérialisable de LocalityInfo (hooks/useLocality.ts) — dupliquée ici plutôt qu'importée
 * pour éviter un cycle d'imports (ce hook importe déjà des types depuis ce fichier). */
export interface PanelLocality {
  type: 'locality' | 'col'
  name: string
  ele?: number
  lon: number
  lat: number
  placeType?: string
  score?: number
}

export interface VoyageTrack {
  id: string
  name: string
  gpxData: string        // contenu GPX brut
  date?: string          // YYYY-MM-DD
  departureTime?: string // HH:MM
  arrivalTime?: string   // HH:MM
  distanceM?: number     // mètres
  elevGainM?: number     // dénivelé positif
  elevLossM?: number     // dénivelé négatif
  durationSec?: number
  addedAt: string        // ISO
  // 'recorded' = tracé enregistré en direct par le smartphone (GPS de l'appli). Absent = importé
  // depuis un fichier .gpx externe. Sert à ne proposer le téléchargement .gpx que pour les traces
  // maison (celles importées existent déjà comme fichier ailleurs).
  source?: 'recorded'
  albumPages?: ComposedAlbumPage[]  // pages d'album composées manuellement pour ce tracé
  albumUpdatedAt?: string  // ISO — dernière modification de la composition, pour retrouver les albums en cours
  albumContentVersion?: string  // identifiant renouvelé à chaque sauvegarde de la composition, pour invalider le PDF mis en cache (voir trackPdfCache dans voyageDB.ts) — distinct de albumUpdatedAt, qui peut être effacé sans que la composition change
  photoTone?: PhotoTone   // tonalité des légendes générées par l'IA ; absent = neutre
  // Personnalisation des panneaux (wizard), mémorisée pour ne pas la refaire à chaque réouverture
  panelStartName?: string
  panelEndName?: string
  panelStartKind?: 'localite' | 'lieudit'  // style choisi du panneau de départ (absent = automatique)
  panelEndKind?: 'localite' | 'lieudit'
  panelSuppressed?: string[]           // noms des panneaux décochés/masqués
  panelCustomLocalities?: PanelLocality[]  // panneaux ajoutés manuellement
  panelWizardDone?: boolean            // le wizard a déjà été validé une fois pour ce tracé
  // Bornes kilométriques et temps de passage (cf. raceSplits.ts)
  panelBornesOff?: boolean             // bornes masquées (affichées par défaut)
  panelPlannedTimes?: boolean          // temps prévus plutôt que les temps réels du GPX
  panelRaceSpeeds?: number[]           // vitesse attendue (km/h) par tranche de 10 km
  panelEventName?: string              // inscription de l'épreuve : nom,
  panelBannerDate?: string             //   date et distance (vides = valeurs par défaut)
  panelBannerDistance?: string
  panelRavitos?: string               // kilomètres des ravitaillements, tels que saisis
  panelStreets?: { name: string; startM: number; endM: number }[]  // rues empruntées affichées (cf. routeStreets.ts)
  panelBibNumber?: string              // numéro inscrit sur le dossard du personnage
  poster?: PosterSettings              // affiche de course (cf. lib/poster.ts)
}

/** Fond de l'affiche : vues aériennes IGN assombries, Plan IGN de nuit, Plan IGN clair, uni. */
export type PosterBackground = 'sat' | 'plan-nuit' | 'clair' | 'uni'
/** Ruban de l'affiche : dégradé vertical du logo, vert · orange · crème le long du parcours (un tiers chacun), ou
 * couleur unie « #RRGGBB ». */
export type PosterRibbon = 'logo' | 'trois-couleurs' | string
/** Style de l'affiche : éditorial (photo fondue dans le papier), origine (première affiche, sombre), souvenir
 * (grande photo noir et blanc). */
export type PosterStyle = 'editorial' | 'origine' | 'souvenir'
/** Fond (papier) de l'affiche. */
export type PosterFond = 'blanc-casse' | 'creme' | 'papier' | 'lin' | 'gris-clair' | 'nuit' | 'noir'
/** Format : A3, A4 ou carré (30 × 30 cm), chacun téléchargeable pour l'impression ou pour les réseaux. */
export type PosterFormat = 'a3' | 'a4' | 'carre'
/** Éléments de l'affiche que l'utilisateur peut masquer. */
export type PosterInfo = 'map' | 'bornes' | 'profile' | 'bib' | 'photos' | 'rank' | 'splits' | 'notes'

/** Réglages de l'affiche d'une course, saisis par l'utilisateur (vides = valeurs tirées du tracé). */
export interface PosterSettings {
  /** Nom de la course : « Mon semi-marathon à Lille ». */
  title?: string
  /** Nom ou pseudo du coureur, en tête de l'affiche (facultatif). */
  name?: string
  /** « 21,1 km ». */
  distance?: string
  /** Date de la course « AAAA-MM-JJ ». */
  date?: string
  city?: string
  /** Temps officiel « 1:43:10 », saisi (jamais récupéré automatiquement). */
  chrono?: string
  bib?: string
  rank?: string
  /** Allure moyenne « 4'53" / km » ; absente = calculée d'après le temps. */
  pace?: string
  style?: PosterStyle
  fond?: PosterFond
  format?: PosterFormat
  /** Fond de carte ; absent = selon le style. */
  background?: PosterBackground
  ribbon?: PosterRibbon
  hidden?: PosterInfo[]
  /** 0 à 2 photos (arrivée, médaille), prises parmi les photos du sillon. */
  photoIds?: string[]
  /** Anciens réglages (première version de l'affiche), encore lus : couleur de papier libre. */
  paper?: string
  subtitle?: string
}

export type PhotoTone = 'neutre' | 'culturel' | 'amusant' | 'poetique'

export interface VoyageFilm {
  id: string
  name: string
  trackId?: string       // lié à un tracé du même voyage
  createdAt: string      // ISO
  durationSec?: number
  sizeBytes?: number
  unseen?: boolean       // créé mais pas encore lu ni téléchargé → surligné dans la liste des films
}

export interface VoyagePhoto {
  id: string
  name: string
  trackId?: string       // lié à un tracé du même voyage
  createdAt: string      // ISO (ajout dans l'app)
  takenAt?: string       // ISO, depuis l'EXIF de la photo si disponible
  sizeBytes?: number
  hash?: string          // SHA-256 du fichier, pour détecter les doublons exacts
  aiCaption?: string     // légende générée par l'IA, mise en cache pour ne pas ré-analyser
  aiKeep?: boolean       // suggestion de l'IA (ou override manuel "Garder") ; absent = jamais analysée
}

export interface Voyage {
  id: string
  name: string
  createdAt: string      // ISO
  tracks: VoyageTrack[]
  films: VoyageFilm[]
  photos: VoyagePhoto[]
  demo?: boolean         // sillon « Rando d'exemple » (voir demoTrip.ts) : pas de code de réduction imprimeur
  demoVersion?: number   // version des photos de la rando d'exemple (absent = 1) — voir DEMO_VERSION
  coverPage?: ComposedAlbumPage      // couverture de l'album — commune à tous les tracés du voyage
  backCoverPage?: ComposedAlbumPage  // dos du livre — idem
  coverContentVersion?: string       // identifiant renouvelé à chaque sauvegarde couverture/dos, pour invalider le PDF mis en cache (voir coverPdfCache dans voyageDB.ts)
  albumPageCm?: { w: number; h: number }  // format de page de l'album en cm (largeur × hauteur), tel que demandé par l'imprimeur (Flexilivre, WhiteWall…) ; absent = 29.7 × 21 cm (Flexilivre A4 paysage). w < h ⇒ mise en page de la page résumé en portrait.
  printProfileId?: string  // profil d'imprimeur choisi (voir lib/printProfiles.ts) — pilote le mode de couverture et les contraintes de pagination ; absent = Flexilivre A4
  wrapPageCount?: number  // profil wrap-spread : nombre de pages intérieures de l'album (celui demandé par WhiteWall) ; on en déduit la largeur du dos par interpolation (voir spineMmForPages / wrapSpreadForPages dans lib/printProfiles.ts), qui recalcule la largeur de la feuille de couverture. Absent = minimum du profil (pageRange.min).
}
