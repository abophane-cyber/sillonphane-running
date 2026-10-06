// Banderole de départ (arche 3D, public/perso/decor/banderole-depart.glb) : rendue UNE fois avec la caméra des
// personnages (HIKER3D_CAMERA), posée derrière la coureuse. Le résultat est une image fixe, dessinée derrière elle
// au point de départ, à la même échelle (aperçu : marqueur DOM ; film 2D : drawImage).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { HIKER3D_CAMERA, HIKER3D_SIZE } from './hiker3dSprite'

/** Hauteur de l'arche (× taille du personnage) et recul derrière lui (même unité). */
const BANNER_HEIGHT = 2.3
const BANNER_DEPTH = 1.6
/** Taille de l'image à l'échelle 1 (px CSS), centrée sur l'axe de la caméra : assez grande pour l'arche entière
 * (son sommet monte à ~150 px au-dessus du centre, ses piliers à ~140 px de part et d'autre). */
const BW = 320, BH = 360

export interface StartBannerImage {
  /** Rendu à HIKER3D_SIZE.maxScale × (BW, BH) pour rester net dans les plans serrés. */
  canvas: HTMLCanvasElement
  /** Taille à l'échelle 1 (px CSS). */
  w: number
  h: number
  /** Position, dans l'image à l'échelle 1, du point de départ (pieds du personnage). */
  anchorX: number
  anchorY: number
}

let pending: Promise<StartBannerImage | null> | null = null

export function loadStartBanner(): Promise<StartBannerImage | null> {
  return pending ??= render().catch(e => { console.error('[banderole]', e); return null })
}

async function render(): Promise<StartBannerImage | null> {
  const res = HIKER3D_SIZE.maxScale
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(Math.round(BW * res), Math.round(BH * res), false)

  // Même focale (px par radian) que la fenêtre des personnages : les deux images se superposent.
  const focal = (HIKER3D_SIZE.h / 2) / Math.tan((HIKER3D_CAMERA.fov * Math.PI) / 360)
  const fov = (2 * Math.atan((BH / 2) / focal) * 180) / Math.PI
  const camera = new THREE.PerspectiveCamera(fov, BW / BH, 0.1, 100)
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
  model.position.set(-c.x * s, -box.min.y * s, -c.z * s - BANNER_DEPTH)
  scene.add(model)

  renderer.render(scene, camera)
  // Point de départ (origine, pieds du personnage) dans l'image, à l'échelle 1.
  camera.updateMatrixWorld()
  const o = new THREE.Vector3(0, 0, 0).project(camera)
  const anchorX = ((o.x + 1) / 2) * BW
  const anchorY = ((1 - o.y) / 2) * BH

  // Copie en 2D : l'image reste disponible une fois le contexte WebGL libéré.
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  out.getContext('2d')!.drawImage(canvas, 0, 0)
  renderer.dispose()
  draco.dispose()
  return { canvas: out, w: BW, h: BH, anchorX, anchorY }
}
