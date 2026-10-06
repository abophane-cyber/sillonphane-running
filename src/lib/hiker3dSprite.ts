// Randonneurs 3D affichés sur la carte 2D (aperçu et film), à la place des GIF d'origine.
// La carte reste vue du dessus ; le personnage a sa propre petite fenêtre WebGL et sa caméra à hauteur d'homme,
// comme le GIF est vu de profil. Au changement de direction, le modèle PIVOTE (cap borné en vitesse) au lieu de
// se retourner en miroir. Clips de départ et d'arrivée (attente / se lève, salut / s'assoit / se couche),
// définis dans characters3d.ts.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { CHARACTERS } from './characters3d'
import { HIKER3D_MAX_SCALE } from './hiker3dStaging'
import type { CharacterId } from './characters'

const W = 155, H = 185
/** Agrandissement maximal (plans serrés, présentation au départ) : fixe la taille du rendu. */
const MAX_SCALE = HIKER3D_MAX_SCALE
/** Pivot borné : bien au-dessus de la vitesse de virage du ralenti (trackPacing.ts) pour que les personnages suivent
 * les lacets sans retard, tout en amortissant un à-coup ponctuel. */
const MAX_TURN_DEG_PER_S = 250
const CROSSFADE_S = 0.4
/** Fondu plus long entre deux allures de course : les cycles n'ont pas la même durée. */
const GAIT_FADE_S = 0.8
/** Cadence de marche : bornes du facteur de vitesse du clip (au-delà, jambes illisibles ou quasi figées), lissage, et
 * vitesse « naturelle » de repli si le clip n'a pas pu être mesuré (≈ 1,3 m/s pour 1,75 m). */
const WALK_RATE_MIN = 0.3
const WALK_RATE_MAX = 3
const WALK_RATE_TAU_S = 0.3
const FALLBACK_CLIP_SPEED = 0.75
/** Correction de la cadence calculée (perçue un peu trop rapide par rapport à l'avancement du tracé). */
const CADENCE_SCALE = 0.8

export interface Hiker3dSprite {
  readonly element: HTMLCanvasElement
  /** Direction de marche à l'écran (px) : dx > 0 vers la droite, dy > 0 vers le bas. */
  setDirection(dx: number, dy: number): void
  /** Comme setDirection, mais aussi pendant la séquence d'arrivée (départ : face au chemin ; mise en file). */
  turnTo(dx: number, dy: number): void
  setPlaying(playing: boolean): void
  /** Vitesse d'avancement au sol, en hauteurs de corps par seconde (vitesse à l'écran ÷ taille du personnage à
   * l'écran) : la cadence des pas s'y cale pour que les pieds ne patinent pas (cf. clipGroundSpeed). */
  setGroundSpeed(bodyHeightsPerS: number): void
  /** Part du parcours déjà faite (0 à 1) : choisit l'allure (def.gaits), par fondu si elle change en course. */
  setProgress(fraction: number): void
  /** Avant la lecture : en attente (boucle) ou assis, prêt à se lever. */
  resetToStart(): void
  /** Décompte de départ : le personnage assis se lève (l'attente, elle, enchaîne sur la marche à la lecture). */
  startIntro(): void
  /** Lecture reprise en cours de parcours (curseur déplacé) : marche directe. */
  skipToWalk(): void
  /** Arrivée : salut, s'assoit / se couche, face à nous. */
  startOutro(): void
  outroDurationS(): number
  /** Appelé une fois le modèle chargé (position des pieds connue) : la mise en page peut être refaite. */
  onFeet(cb: (pxAboveBottom: number) => void): void
  /** Taille à l'écran (1 = taille de marche) : grandit avec le zoom des plans serrés de départ et d'arrivée. */
  setScale(f: number): void
  /** Numéro inscrit sur le dossard (personnages qui en portent un, cf. CharacterDef.bib) ; vide = dossard du modèle. */
  setBibNumber(n: string): void
  /** Taille actuelle de la fenêtre (px CSS), hauteur des pieds au-dessus de son bas et taille du personnage (des
   * pieds au sommet de la tête). */
  layout(): { w: number; h: number; feet: number; body: number }
  /** Mode film (manual) : avance l'animation de dt secondes et dessine l'image dans `element`. */
  renderFrame(dt: number): void
  /** Résolu quand le modèle et ses clips sont chargés (le film attend avant sa première image). */
  whenReady(): Promise<void>
  dispose(): void
}

export interface Hiker3dSpriteOptions {
  /** Film : pas de boucle d'affichage, chaque image est produite par renderFrame (horloge du film, pas l'horloge
   * réelle — le rendu d'une image de film peut prendre bien plus d'1/30 s). */
  manual?: boolean
  /** Numéro de dossard initial (cf. setBibNumber). */
  bibNumber?: string
}

/** Taille de rendu de base (px CSS, taille de marche) et agrandissement maximal : pour dessiner le personnage
 * ailleurs (film), à la même échelle que l'aperçu. */
export const HIKER3D_SIZE = { w: W, h: H, maxScale: MAX_SCALE }
/** Caméra des personnages (personnage de hauteur 1, pieds à l'origine) : un décor 3D rendu avec la même caméra se
 * superpose exactement, en perspective. */
export const HIKER3D_CAMERA = {
  fov: 30,
  position: [0, 0.95, 3.4] as [number, number, number],
  target: [0, 0.45, 0] as [number, number, number],
}

export function supportsHiker3d(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
}

function trimClosedLoop(clip: THREE.AnimationClip, fps: number, exact = false) {
  const frames = Math.round(clip.duration * fps)
  const trimmed = THREE.AnimationUtils.subclip(clip, clip.name, 0, frames, fps)
  trimmed.duration = exact ? (trimmed.tracks[0]?.times.length ?? frames) / fps : frames / fps
  return trimmed
}

/** Vitesse « au sol » du clip de marche joué à 1×, en hauteurs de corps par seconde (modèle ramené à une hauteur
 * de 1) : vitesse à laquelle le pied d'appui recule sous le corps. Les clips sont « sur place » ; caler la cadence
 * pour que cette vitesse égale l'avancement réel à l'écran supprime le patinage des pieds. */
function clipGroundSpeed(model: THREE.Object3D, mixer: THREE.AnimationMixer, action: THREE.AnimationAction): number {
  const bones: THREE.Object3D[] = []
  model.traverse(o => { if (/(Left|Right)(Foot|ToeBase)$/i.test(o.name)) bones.push(o) })
  const toes = bones.filter(o => /ToeBase$/i.test(o.name))
  const feet = toes.length >= 2 ? toes : bones
  if (feet.length < 2) return FALLBACK_CLIP_SPEED
  const dur = action.getClip().duration
  const N = 120, dt = dur / N
  const v = new THREE.Vector3()
  const ys: number[][] = feet.map(() => []), zs: number[][] = feet.map(() => [])
  action.reset().play()
  for (let i = 0; i <= N; i++) {
    mixer.setTime(i * dt)
    model.updateMatrixWorld(true)
    feet.forEach((b, k) => { b.getWorldPosition(v); ys[k].push(v.y); zs[k].push(v.z) })
  }
  action.stop()
  // Appui = pied au plus bas (à 2 % de hauteur de corps près) : sa vitesse horizontale y est celle du sol.
  const speeds: number[] = []
  feet.forEach((_, k) => {
    const yMin = Math.min(...ys[k])
    for (let i = 1; i <= N; i++) {
      if (ys[k][i] < yMin + 0.02 && ys[k][i - 1] < yMin + 0.02) speeds.push(Math.abs(zs[k][i] - zs[k][i - 1]) / dt)
    }
  })
  if (speeds.length < 4) return FALLBACK_CLIP_SPEED
  speeds.sort((a, b) => a - b)
  const median = speeds[Math.floor(speeds.length / 2)]
  return median > 0.05 && median < 5 ? median : FALLBACK_CLIP_SPEED
}

export function createHiker3dSprite(id: CharacterId, opts: Hiker3dSpriteOptions = {}): Hiker3dSprite {
  const def = CHARACTERS.find(c => c.id === id) ?? CHARACTERS[0]
  const canvas = document.createElement('canvas')
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block;position:absolute;`
  // Film : l'image est recopiée dans le canevas du film juste après le rendu -> tampon conservé.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: !!opts.manual })
  // Rendu à taille FIXE (la plus grande affichée) : seule la taille CSS suit le zoom. Redimensionner le rendu à
  // chaque palier du dézoom vidait la fenêtre une image sur deux (scintillement des personnages).
  renderer.setPixelRatio(1)
  renderer.setSize(Math.round(W * MAX_SCALE), Math.round(H * MAX_SCALE), false)

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a3a, 2.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(0.5, 1, 0.8)
  scene.add(sun)
  // Caméra un peu au-dessus de la tête, légèrement plongeante : on voit le marcheur de trois quarts haut.
  const camera = new THREE.PerspectiveCamera(HIKER3D_CAMERA.fov, W / H, 0.1, 100)
  camera.position.set(...HIKER3D_CAMERA.position)
  camera.lookAt(...HIKER3D_CAMERA.target)
  const group = new THREE.Group()
  scene.add(group)

  let mixer: THREE.AnimationMixer | null = null
  let walk: THREE.AnimationAction | null = null
  let idle: THREE.AnimationAction | null = null
  let stand: THREE.AnimationAction | null = null
  let greet: THREE.AnimationAction | null = null
  let sit: THREE.AnimationAction | null = null
  let sitPose: THREE.AnimationAction | null = null
  let lie: THREE.AnimationAction | null = null
  type Mode = 'start' | 'standing' | 'walk' | 'outro'
  let mode: Mode = 'start'
  let sitStarted = false, sitPoseStarted = false
  let playing = false
  // Cadence de marche : facteur de vitesse du clip, calé sur l'avancement au sol (setGroundSpeed), lissé.
  let clipSpeed = FALLBACK_CLIP_SPEED
  let walkRate = 1, walkRateTarget = 1
  let groundSpeed = -1 // dernière vitesse reçue (setGroundSpeed), pour recaler la cadence au changement d'allure
  // Allures enchaînées (def.gaits) : action et vitesse au sol de chaque clip (null tant qu'il n'est pas chargé) ;
  // -1 = pas encore choisie, `walk` désigne toujours l'allure en cours.
  let gaitActions: (THREE.AnimationAction | null)[] = []
  let gaitSpeeds: number[] = []
  let gaitIdx = -1
  let bodyPx = H * 0.53 // taille du personnage à l'écran (scale 1), mesurée au chargement
  let targetYaw = 0 // face à nous (attente au départ)
  let yaw = targetYaw
  let disposed = false
  let feetPx: number | null = null
  let scale = 1
  const feetCbs: ((px: number) => void)[] = []

  const stopAll = () => { mixer?.stopAllAction(); sitStarted = false; sitPoseStarted = false }
  const once = (a: THREE.AnimationAction) => { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; return a }

  function enterStart() {
    if (!walk) return
    stopAll()
    mode = 'start'
    if (stand) { stand.reset().play(); stand.paused = true }
    else if (idle) idle.reset().play()
    else walk.reset().play()
    mixer?.update(0)
  }

  function enterWalk(fadeFrom?: THREE.AnimationAction | null) {
    if (!walk) return
    walk.reset().play()
    if (fadeFrom) fadeFrom.crossFadeTo(walk, CROSSFADE_S, false)
    else { stopAll(); walk.play() }
    mode = 'walk'
  }

  // Dossard : numéro plaqué sur le dossard blanc du modèle (pose de repos, juste après le cadrage), accroché au buste
  // pour suivre la course. Masqué tant qu'aucun numéro n'est saisi (le dossard blanc du modèle reste visible).
  let bibNumber = (opts.bibNumber ?? '').trim()
  let bibMesh: THREE.Mesh | null = null
  const bibCanvas = document.createElement('canvas')
  bibCanvas.width = 256; bibCanvas.height = 150
  const bibTex = new THREE.CanvasTexture(bibCanvas)
  bibTex.colorSpace = THREE.SRGBColorSpace
  function drawBib() {
    if (!bibMesh) return
    bibMesh.visible = !!bibNumber
    const g = bibCanvas.getContext('2d')!
    const W = bibCanvas.width, H = bibCanvas.height
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#c0000c'; g.fillRect(0, 0, W, H * 0.16)
    g.fillStyle = '#c0000c'; g.fillRect(0, H * 0.88, W, H * 0.12)
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'
    let px = H * 0.62
    do { g.font = `800 ${px}px 'Arial Narrow', Arial, sans-serif`; px -= 4 } while (g.measureText(bibNumber).width > W * 0.9 && px > 20)
    g.fillText(bibNumber, W / 2, H * 0.53)
    bibTex.needsUpdate = true
  }
  function setupBib(model: THREE.Object3D, bib: NonNullable<typeof def.bib>) {
    const bone = model.getObjectByName(bib.bone)
    if (!bone) return
    const yaw0 = group.rotation.y
    group.rotation.y = 0
    group.updateMatrixWorld(true)
    model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.update() })
    // Surface de la poitrine : premier point touché en venant de face.
    const hit = new THREE.Raycaster(new THREE.Vector3(bib.x, bib.y, 5), new THREE.Vector3(0, 0, -1)).intersectObject(model, true)[0]
    if (!hit) { group.rotation.y = yaw0; return }
    bibMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(bib.w, bib.h),
      new THREE.MeshLambertMaterial({ map: bibTex, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    bibMesh.position.set(bib.x, bib.y, hit.point.z + 0.003)
    scene.add(bibMesh)
    bibMesh.updateMatrixWorld(true)
    bone.attach(bibMesh)
    group.rotation.y = yaw0
    drawBib()
  }

  const draco = new DRACOLoader()
  draco.setDecoderPath(`${import.meta.env.BASE_URL}perso/draco/`)
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  // Chargements en cours (modèle + clips) : whenReady() se résout quand il n'en reste plus.
  let pending = 1
  let readyResolve: () => void = () => {}
  const readyPromise = new Promise<void>(r => { readyResolve = r })
  const loaded = () => { if (--pending <= 0) readyResolve() }
  const loadClip = (url: string | undefined, use: (clip: THREE.AnimationClip) => void) => {
    if (!url) return
    pending++
    loader.load(url, g => { if (!disposed && mixer && g.animations[0]) use(g.animations[0]); loaded() }, undefined, () => loaded())
  }
  loader.load(def.modelUrl, gltf => {
    if (disposed) return
    try { onModel(gltf) } finally { loaded() }
  }, undefined, () => loaded())
  function onModel(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
    const model = gltf.scene
    // Cadrage : hauteur ramenée à 1, pieds à l'origine, personnage centré.
    // Mesure précise (sommets réels) : la boîte par défaut englobe aussi le squelette, plus grand que le corps
    // sur certains modèles — la randonneuse 2 paraissait plus petite et les pieds en l'air.
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model, true)
    const size = box.getSize(new THREE.Vector3())
    const s = 1 / (size.y || 1)
    model.scale.setScalar(s)
    const center = box.getCenter(new THREE.Vector3())
    model.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    group.add(model)
    // Où tombent les pieds dans la fenêtre : sert à poser exactement le personnage sur le tracé.
    camera.updateMatrixWorld()
    const feet = new THREE.Vector3(0, 0, 0).project(camera)
    feetPx = H - (1 - feet.y) / 2 * H
    const head = new THREE.Vector3(0, 1, 0).project(camera)
    bodyPx = Math.max(1, (H - (1 - head.y) / 2 * H) - feetPx)
    feetCbs.splice(0).forEach(cb => cb(feetPx!))
    if (def.bib) setupBib(model, def.bib)

    const walkClip = gltf.animations.find(c => c.duration > 0.1) ?? gltf.animations[0]
    if (!walkClip) return
    mixer = new THREE.AnimationMixer(model)
    walk = mixer.clipAction(def.trimDuplicateLastFrame ? trimClosedLoop(walkClip, def.clipFps ?? 24, def.exactLoop) : walkClip)
    // Pieds au sol mesurés dans la pose de MARCHE (sommets déformés par le squelette) : la pose de repos
    // mesurée plus haut ne tombe pas au même niveau selon les modèles (pieds en l'air pour la randonneuse 2).
    walk.play()
    mixer.update(0)
    model.updateMatrixWorld(true)
    const walkBox = new THREE.Box3().setFromObject(model, true)
    if (Number.isFinite(walkBox.min.y)) model.position.y -= walkBox.min.y
    walk.stop()
    clipSpeed = clipGroundSpeed(model, mixer, walk)
    if (def.gaits) {
      const base = walk
      gaitActions = def.gaits.map(g => (g.url ? null : base))
      gaitSpeeds = def.gaits.map(() => clipSpeed)
      def.gaits.forEach((g, i) => loadClip(g.url, c => {
        const a = mixer!.clipAction(def.trimDuplicateLastFrame ? trimClosedLoop(c, def.clipFps ?? 24, def.exactLoop) : c)
        gaitSpeeds[i] = clipGroundSpeed(model, mixer!, a)
        gaitActions[i] = a
        if (mode === 'start') enterStart()
      }))
    }
    enterStart()
    loadClip(def.greetUrl, c => { greet = once(mixer!.clipAction(c)) })
    loadClip(def.sitDownUrl, c => { sit = once(mixer!.clipAction(c)) })
    loadClip(def.sitPoseUrl, c => { sitPose = once(mixer!.clipAction(c)) })
    loadClip(def.lieDownUrl, c => { lie = once(mixer!.clipAction(c)) })
    if (def.standUpUrl) loadClip(def.standUpUrl, c => { stand = once(mixer!.clipAction(c)); if (mode === 'start') enterStart() })
    else loadClip(def.idleUrl, c => {
      if (def.trimDuplicateLastFrame && !def.idlePingPong) idle = mixer!.clipAction(trimClosedLoop(c, def.clipFps ?? 24, def.exactLoop))
      else { idle = mixer!.clipAction(c); idle.setLoop(THREE.LoopPingPong, Infinity) }
      if (mode === 'start') enterStart()
    })
  }

  // Une image : horloge, pivot, animation, rendu.
  function step(dt: number) {
    // Pivot borné en vitesse, par le plus court chemin.
    let d = targetYaw - yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    const maxStep = (MAX_TURN_DEG_PER_S * Math.PI / 180) * dt
    yaw += Math.max(-maxStep, Math.min(maxStep, d))
    group.rotation.y = yaw
    if (mixer) {
      if (mode === 'start') mixer.update(stand ? 0 : idle ? dt : 0)
      else if (mode === 'standing' && stand) {
        mixer.update(dt)
        if (stand.getClip().duration - stand.time <= CROSSFADE_S) enterWalk(stand)
      } else if (mode === 'walk') {
        // Cadence calée sur l'avancement réel (anti-patinage), lissée pour ne pas à-couper les pas.
        walkRate += (walkRateTarget - walkRate) * (1 - Math.exp(-dt / WALK_RATE_TAU_S))
        mixer.update(playing ? dt * walkRate : 0)
      }
      else if (mode === 'outro') {
        mixer.update(dt)
        if (greet && sit && !sitStarted && greet.getClip().duration - greet.time <= CROSSFADE_S) {
          sitStarted = true
          sit.reset().play()
          greet.crossFadeTo(sit, CROSSFADE_S, false)
        }
        if (sit && sitPose && sitStarted && !sitPoseStarted && sit.getClip().duration - sit.time <= CROSSFADE_S) {
          sitPoseStarted = true
          sitPose.reset().play()
          sit.crossFadeTo(sitPose, CROSSFADE_S, false)
        }
      }
    }
    renderer.render(scene, camera)
  }

  let last = performance.now()
  let raf = 0
  const tick = (now: number) => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    step(dt)
  }
  if (!opts.manual) raf = requestAnimationFrame(tick)

  return {
    element: canvas,
    setDirection(dx, dy) {
      // Modèle glTF tourné vers +Z (face caméra) à yaw 0 : vers le bas de l'écran = face à nous,
      // vers la droite = profil droit (+X), vers le haut = de dos.
      if (mode === 'outro' || Math.hypot(dx, dy) < 1e-6) return
      // Cap du chemin suivi directement (virages et lacets) : la douceur vient du ralenti dans les virages
      // (trackPacing.ts) et du pivot borné ci-dessus.
      targetYaw = Math.atan2(dx, dy)
    },
    turnTo(dx, dy) {
      if (Math.hypot(dx, dy) < 1e-6) return
      targetYaw = Math.atan2(dx, dy)
    },
    setPlaying(p) {
      playing = p
      if (!p || mode !== 'start') return
      if (stand) { mode = 'standing'; stand.paused = false } // lecture sans décompte : il se lève quand même
      else enterWalk(idle)
    },
    setGroundSpeed(bodyHeightsPerS) {
      if (!(bodyHeightsPerS >= 0)) return
      groundSpeed = bodyHeightsPerS
      walkRateTarget = Math.max(WALK_RATE_MIN, Math.min(WALK_RATE_MAX, (bodyHeightsPerS / clipSpeed) * CADENCE_SCALE * (def.cadence ?? 1)))
    },
    setProgress(fraction) {
      const gaits = def.gaits
      if (!gaits || !walk) return
      let i = 0
      while (i + 1 < gaits.length && fraction >= gaits[i + 1].from) i++
      const next = gaitActions[i]
      if (i === gaitIdx || !next) return // allure inchangée, ou clip pas encore chargé (réessayé à l'image suivante)
      gaitIdx = i
      const prev = walk
      walk = next
      clipSpeed = gaitSpeeds[i]
      if (groundSpeed >= 0) this.setGroundSpeed(groundSpeed)
      if (mode !== 'walk' || prev === next) return // départ ou arrivée : la nouvelle allure servira à la reprise
      // Même phase du cycle (pied d'appui) dans la nouvelle allure, puis fondu.
      const phase = prev.time / (prev.getClip().duration || 1)
      next.reset().play()
      next.time = phase * next.getClip().duration
      prev.crossFadeTo(next, GAIT_FADE_S, false)
    },
    resetToStart() {
      // Au départ il nous fait face ; il pivotera vers le chemin en se mettant en marche.
      targetYaw = 0
      yaw = 0
      enterStart()
    },
    startIntro() {
      if (mode === 'start' && stand) { mode = 'standing'; stand.paused = false }
    },
    skipToWalk() { if (mode !== 'walk') { stopAll(); enterWalk() } },
    startOutro() {
      if (!walk || mode === 'outro') return
      mode = 'outro'
      targetYaw = 0 // face à nous pour saluer
      const from = walk
      if (greet) { greet.reset().play(); from.crossFadeTo(greet, CROSSFADE_S, false) }
      else if (sit) { sitStarted = true; sit.reset().play(); from.crossFadeTo(sit, CROSSFADE_S, false) }
      else if (lie) {
        // Clip fourni « allongé → debout » : joué à l'envers.
        lie.reset(); lie.timeScale = -1; lie.time = lie.getClip().duration; lie.play()
        from.crossFadeTo(lie, CROSSFADE_S, false)
      } else walk.paused = true
    },
    outroDurationS() {
      const g = greet ? greet.getClip().duration : 0
      const st = sit ? sit.getClip().duration : 0
      const l = !greet && !sit && lie ? lie.getClip().duration : 0
      return g + st + l
    },
    onFeet(cb) { if (feetPx !== null) cb(feetPx); else feetCbs.push(cb) },
    setScale(f) {
      const q = Math.max(0.1, Math.min(MAX_SCALE, f))
      if (q === scale) return
      scale = q
      canvas.style.width = `${W * q}px`
      canvas.style.height = `${H * q}px`
    },
    layout() { return { w: W * scale, h: H * scale, feet: (feetPx ?? H * 0.26) * scale, body: bodyPx * scale } },
    renderFrame(dt) { if (!disposed) step(dt) },
    whenReady() { return readyPromise },
    setBibNumber(n) { bibNumber = n.trim(); drawBib() },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      mixer?.stopAllAction()
      renderer.dispose()
      bibTex.dispose()
      draco.dispose()
    },
  }
}
