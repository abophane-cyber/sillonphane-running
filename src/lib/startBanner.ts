// Banderole de départ (arche 3D, public/perso/decor/banderole-depart.glb) : rendue UNE fois avec la caméra des
// personnages (HIKER3D_CAMERA), en travers du tracé, un peu après le point de départ : la coureuse part devant
// elle et passe dessous. Le résultat est une image fixe, ancrée au point de départ, à l'échelle des personnages
// (aperçu : marqueur DOM ; film 2D : drawImage). Elle passe devant la coureuse quand celle-ci est derrière l'arche
// vue de la caméra (bannerInFront).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { HIKER3D_CAMERA, HIKER3D_SIZE } from './hiker3dSprite'

/** Hauteur de l'arche (× taille du personnage) et distance au point de départ le long du tracé (même unité). */
const BANNER_HEIGHT = 2.3
const BANNER_AHEAD = 1.0
/** Fenêtre de rendu (px à l'échelle 1, centrée sur l'axe de la caméra), recadrée ensuite sur l'arche. */
const RW = 900, RH = 900

export interface StartBannerImage {
  /** Rendu à HIKER3D_SIZE.maxScale × (w, h) pour rester net dans les plans serrés. */
  canvas: HTMLCanvasElement
  /** Taille à l'échelle 1 (px CSS). */
  w: number
  h: number
  /** Position, dans l'image à l'échelle 1, du point de départ (pieds du personnage). */
  anchorX: number
  anchorY: number
  /** Pied de l'arche (milieu, au sol) relatif au point de départ (px à l'échelle 1). */
  footX: number
  footY: number
  /** Direction du tracé au départ (vecteur écran unitaire). */
  dirX: number
  dirY: number
}

/** Inscription de la bâche : nom de l'épreuve, puis date et distance. */
export interface BannerText {
  title: string
  date?: string
  distance?: string
}

/** Bâche blanche du modèle (mesurée de face, modèle ramené à une hauteur de 1, centré en x) et épaisseur de l'arche. */
const BACHE = { x0: -0.69, x1: 0.69, yBot: 0.63, yTop: 0.98, depth: 0.2 }

const cache = new Map<string, Promise<StartBannerImage | null>>()

/** `dir` : direction du tracé au départ, à l'écran (x vers la droite, y vers le bas). */
export function loadStartBanner(text: BannerText, dir: { x: number; y: number }): Promise<StartBannerImage | null> {
  const n = Math.hypot(dir.x, dir.y) || 1
  const d = { x: Math.round((dir.x / n) * 100) / 100, y: Math.round((dir.y / n) * 100) / 100 }
  const key = `${text.title}|${text.date ?? ''}|${text.distance ?? ''}|${d.x}|${d.y}`
  let p = cache.get(key)
  if (!p) {
    p = render(text, d).catch(e => { console.error('[banderole]', e); return null })
    cache.set(key, p)
  }
  return p
}

/** L'arche est-elle devant la coureuse (plus près de la caméra) ? `rx, ry` : position de la coureuse relative au
 * point de départ, en px à l'échelle 1. Elle est « passée » une fois au-delà du pied de l'arche le long du tracé ;
 * si le tracé s'éloigne de la caméra (vers le haut), l'arche la masque alors ; s'il vient vers elle, c'est avant. */
export function bannerInFront(b: StartBannerImage, rx: number, ry: number): boolean {
  const passed = rx * b.dirX + ry * b.dirY > b.footX * b.dirX + b.footY * b.dirY
  return passed !== (b.dirY > 0)
}

/** Texture de la bâche : fond blanc, nom de l'épreuve en grand, date · distance dessous (texte ajusté à la largeur). */
function bacheTexture(text: BannerText, aspect: number): THREE.CanvasTexture {
  const W = 1024, H = Math.round(W / aspect)
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#f7f7f5'
  g.fillRect(0, 0, W, H)
  g.textAlign = 'center'; g.textBaseline = 'middle'
  const fit = (s: string, weight: number, size: number, maxW: number) => {
    let px = size
    do { g.font = `${weight} ${px}px 'Arial Narrow', Arial, sans-serif`; px -= 2 } while (g.measureText(s).width > maxW && px > 10)
  }
  const sub = [text.date, text.distance].filter(Boolean).join('  ·  ').toUpperCase()
  const title = text.title.toUpperCase()
  fit(title, 800, Math.round(H * (sub ? 0.46 : 0.6)), W * 0.92)
  g.fillStyle = '#14213d'
  g.fillText(title, W / 2, sub ? H * 0.4 : H / 2)
  if (sub) {
    fit(sub, 700, Math.round(H * 0.22), W * 0.9)
    g.fillStyle = '#c0000c'
    g.fillText(sub, W / 2, H * 0.78)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

async function render(text: BannerText, dir: { x: number; y: number }): Promise<StartBannerImage | null> {
  const res = HIKER3D_SIZE.maxScale
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(Math.round(RW * res), Math.round(RH * res), false)

  // Même focale (px par radian) que la fenêtre des personnages : les deux images se superposent.
  const focal = (HIKER3D_SIZE.h / 2) / Math.tan((HIKER3D_CAMERA.fov * Math.PI) / 360)
  const fov = (2 * Math.atan((RH / 2) / focal) * 180) / Math.PI
  const camera = new THREE.PerspectiveCamera(fov, RW / RH, 0.05, 100)
  camera.position.set(...HIKER3D_CAMERA.position)
  camera.lookAt(...HIKER3D_CAMERA.target)

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a3a, 2.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(0.5, 1, 0.8)
  scene.add(sun)

  const draco = new DRACOLoader()
  draco.setDecoderPath(`${import.meta.env.BASE_URL}perso/draco/`)
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}perso/decor/banderole-depart.glb`)
  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model, true)
  const s = BANNER_HEIGHT / (box.getSize(new THREE.Vector3()).y || 1)
  model.scale.setScalar(s)
  const c = box.getCenter(new THREE.Vector3())
  model.position.set(-c.x * s, -box.min.y * s, -c.z * s)

  // Arche en travers du tracé : sa normale (+Z du modèle) suit la direction de départ, comme le cap des personnages
  // (écran : x à droite = +X, y vers le bas = +Z, vers la caméra). Posée BANNER_AHEAD plus loin sur le tracé.
  const arch = new THREE.Group()
  arch.add(model)
  arch.rotation.y = Math.atan2(dir.x, dir.y)
  arch.position.set(dir.x * BANNER_AHEAD, 0, dir.y * BANNER_AHEAD)
  scene.add(arch)

  // Inscription : panneau plaqué sur la face de la bâche tournée vers la caméra (même perspective que l'arche).
  if (text.title) {
    const k = BANNER_HEIGHT // modèle de hauteur 1 -> hauteur de l'arche
    const w = (BACHE.x1 - BACHE.x0) * k, h = (BACHE.yTop - BACHE.yBot) * k
    const face = dir.y >= 0 ? 1 : -1 // +Z local vers la caméra quand le tracé vient vers elle
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: bacheTexture(text, w / h) }))
    plane.position.set(((BACHE.x0 + BACHE.x1) / 2) * k * face, ((BACHE.yBot + BACHE.yTop) / 2) * k, face * ((BACHE.depth / 2) * k + 0.01))
    if (face < 0) plane.rotation.y = Math.PI
    arch.add(plane)
  }

  renderer.render(scene, camera)
  camera.updateMatrixWorld()
  const toPx = (v: THREE.Vector3) => { const p = v.clone().project(camera); return { x: ((p.x + 1) / 2) * RW, y: ((1 - p.y) / 2) * RH } }
  const origin = toPx(new THREE.Vector3(0, 0, 0))
  const foot = toPx(new THREE.Vector3(dir.x * BANNER_AHEAD, 0, dir.y * BANNER_AHEAD))

  // Recadrage sur les pixels non transparents (la fenêtre de rendu est très large pour toutes les orientations).
  const full = document.createElement('canvas')
  full.width = canvas.width; full.height = canvas.height
  const fg = full.getContext('2d', { willReadFrequently: true })!
  fg.drawImage(canvas, 0, 0)
  renderer.dispose()
  draco.dispose()
  const data = fg.getImageData(0, 0, full.width, full.height).data
  let x0 = full.width, y0 = full.height, x1 = -1, y1 = -1
  for (let y = 0; y < full.height; y += 2) {
    for (let x = 0; x < full.width; x += 2) {
      if (data[(y * full.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2)
  x1 = Math.min(full.width, x1 + 3); y1 = Math.min(full.height, y1 + 3)
  const out = document.createElement('canvas')
  out.width = x1 - x0; out.height = y1 - y0
  out.getContext('2d')!.drawImage(full, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return {
    canvas: out, w: out.width / res, h: out.height / res,
    anchorX: origin.x - x0 / res, anchorY: origin.y - y0 / res,
    footX: foot.x - origin.x, footY: foot.y - origin.y,
    dirX: dir.x, dirY: dir.y,
  }
}
