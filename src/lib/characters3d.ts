// coureuse1 (course), randonneur1 (modèle par défaut, Walking.fbx converti), randonneuse1 et randonneur2 ont chacun leur
// propre modèle.

export interface CharacterDef {
  id: string
  label: string
  tint: number
  modelUrl: string
  /** Clip optionnel « se lève » (glb armature seule, même squelette que modelUrl), joué au début du
   * parcours : le perso est assis avant la lecture, puis se lève et enchaîne sur la marche. */
  standUpUrl?: string
  /** Clip optionnel « se couche » (même format que standUpUrl), joué à l'arrêt final du parcours. */
  lieDownUrl?: string
  /** Clip optionnel joué EN BOUCLE tant que la lecture n'a pas démarré (même format que standUpUrl) ;
   * au lancement, fondu enchaîné vers la marche. Ignoré si standUpUrl est défini. */
  idleUrl?: string
  /** Clip « s'assoit » (une fois) puis pose assise tenue, à l'arrêt final du parcours. */
  sitDownUrl?: string
  sitPoseUrl?: string
  /** Clip « salut » joué avant sitDownUrl à l'arrêt final. */
  greetUrl?: string
  /** Attente non cyclique : boucle aller-retour malgré trimDuplicateLastFrame. */
  idlePingPong?: boolean
  clipFps?: number
  /** Période exacte des cycles fermés (cf. trimClosedLoop dans hiker3dSprite.ts). */
  exactLoop?: boolean
  /** Retire la dernière image en double des clips de marche/attente (cycle fermé). */
  trimDuplicateLastFrame?: boolean
  /** Allures enchaînées selon la distance parcourue (part du parcours, 0 à 1, croissante) : chaque clip de course
   * (glb armature seule, même squelette) prend le relais à `from`, par fondu ; sans `url`, le clip de modelUrl. */
  gaits?: { from: number; url?: string }[]
  /** Dossard blanc du modèle, mesuré de face en pose de repos (modèle ramené à une hauteur de 1, centré) : le numéro
   * y est plaqué (cf. setBibNumber dans hiker3dSprite.ts), accroché au buste (`bone`). */
  bib?: { x: number; y: number; w: number; h: number; bone: string }
  /** Cadence des pas (× la cadence calée sur l'avancement, défaut 1) : foulée plus rapide (> 1) ou plus lente. */
  cadence?: number
}

export const CHARACTERS: CharacterDef[] = [
  // Course (jogging) ; attente au départ, victoire à l'arrivée ; numéro plaqué sur le dossard blanc.
  { id: 'coureuse1', label: 'Coureuse', tint: 0xffffff, modelUrl: `${import.meta.env.BASE_URL}perso/models/coureuse1.glb`, idleUrl: `${import.meta.env.BASE_URL}perso/models/coureuse1_idle.glb`, greetUrl: `${import.meta.env.BASE_URL}perso/models/coureuse1_victoire.glb`, clipFps: 30, trimDuplicateLastFrame: true,
    bib: { x: 0, y: 0.706, w: 0.085, h: 0.05, bone: 'mixamorigSpine2' }, cadence: 1.25 },
  // Idem pour le coureur (dossard plus bas et plus grand) ; victoire reprise de la coureuse, déplacement des hanches
  // ramené à son échelle (armature en mètres, celle de la coureuse en centimètres).
  { id: 'coureur1', label: 'Coureur', tint: 0xffffff, modelUrl: `${import.meta.env.BASE_URL}perso/models/coureur1.glb`, idleUrl: `${import.meta.env.BASE_URL}perso/models/coureur1_idle.glb`, greetUrl: `${import.meta.env.BASE_URL}perso/models/coureur1_victoire.glb`, clipFps: 30, trimDuplicateLastFrame: true,
    bib: { x: 0, y: 0.637, w: 0.095, h: 0.078, bone: 'mixamorigSpine1' }, cadence: 1.25 },
  // Départ : attente (respiration) ; marche ; fin : révérence (clip « s'assoit », sans pose finale).
  { id: 'randonneur1', label: 'Randonneur', tint: 0xffffff, modelUrl: `${import.meta.env.BASE_URL}perso/models/randonneur1.glb`, idleUrl: `${import.meta.env.BASE_URL}perso/models/randonneur1_idle.glb`, sitDownUrl: `${import.meta.env.BASE_URL}perso/models/randonneur1_salut.glb`, exactLoop: true, clipFps: 30, trimDuplicateLastFrame: true },
  { id: 'randonneuse1', label: 'Randonneuse', tint: 0xffffff, modelUrl: `${import.meta.env.BASE_URL}perso/models/randonneuse1c.glb`, idleUrl: `${import.meta.env.BASE_URL}perso/models/randonneuse1c_idle.glb`, lieDownUrl: `${import.meta.env.BASE_URL}perso/models/randonneuse1c_debout.glb`, trimDuplicateLastFrame: true },
  { id: 'randonneur2', label: 'Randonneur 2', tint: 0xffffff, modelUrl: `${import.meta.env.BASE_URL}perso/models/randonneur2.glb`, standUpUrl: `${import.meta.env.BASE_URL}perso/models/randonneur2_debout.glb`, lieDownUrl: `${import.meta.env.BASE_URL}perso/models/randonneur2_couche.glb` },
  { id: 'randonneuse2', label: 'Randonneuse 2', tint: 0xffffff, modelUrl: `${import.meta.env.BASE_URL}perso/models/randonneuse2.glb`, idleUrl: `${import.meta.env.BASE_URL}perso/models/randonneuse2_idle.glb`, idlePingPong: true, clipFps: 30, greetUrl: `${import.meta.env.BASE_URL}perso/models/randonneuse2_salut.glb`, trimDuplicateLastFrame: true },
]
