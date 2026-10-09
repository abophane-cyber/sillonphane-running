// Écritures cartographiques communes à l'aperçu (TrackMap), au film 2D (filmExport) et au film 3D (filmExport3d).
// Quatre familles, quatre traitements distincts :
// - VILLE (localité, lieu-dit) = label territorial : vert de la signature du ruban, gras, petit point de position ;
// - POI = label flottant, style de l'ouverture « image 2D clair » : étiquette à fond sombre très transparent et contour
//   clair, pictogramme au trait, nom blanc ; tige fine jusqu'au repère posé sur le lieu ; toujours horizontal à l'écran ;
// - RUE = label cartographique : petit, sans icône ni bulle, imprimé le long de la rue et fixe sur la carte ; blanc
//   sur fond sombre, noir sur fond clair ;
// - PARCOURS = ruban signature (ribbon.ts), au-dessus de tout.

export type GroundLabelStyle = 'standard' | 'lieudit' | 'poi'

export const LABEL_FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'

/** Vert des villes : le vert de la signature du ruban (ribbon.ts, #2f5c45), éclairci pour rester lisible sur le fond
 * satellite sombre. */
export const CITY_GREEN = '#7fcf9c'
/** Vert du ruban lui-même : point de position des villes. */
const RIBBON_GREEN = '#2f5c45'

const GROUND: Record<GroundLabelStyle, { weight: string; italic: boolean; size: number; fill: string; caps: boolean; spacing: number }> = {
  standard: { weight: '800', italic: false, size: 19, fill: CITY_GREEN, caps: true,  spacing: 0.08 },
  lieudit:  { weight: '700', italic: true,  size: 16, fill: CITY_GREEN, caps: false, spacing: 0.02 },
  poi:      { weight: '700', italic: false, size: 16, fill: '#ffffff',  caps: false, spacing: 0 }, // cf. renderPoiLabel
}
/** Point de position des villes, à gauche du nom. */
const CITY_DOT = 7, CITY_DOT_GAP = 7

/** Texte des noms de lieux selon le style (villes en capitales). */
export function groundLabelText(name: string, style: GroundLabelStyle): string {
  return GROUND[style].caps ? name.toLocaleUpperCase('fr-FR') : name
}

/** Nom de lieu, dans un canvas à la résolution `res` (px de canvas par px logique). Taille logique `w` × `h` ;
 * ancre (`ax`, `ay`, px logiques) = le point du lieu : centre du nom (villes), repère sous l'étiquette (POI). */
export function renderGroundLabel(name: string, style: GroundLabelStyle, res: number): { canvas: HTMLCanvasElement; w: number; h: number; ax: number; ay: number } {
  if (style === 'poi') return renderPoiLabel(name, res)
  const g = GROUND[style]
  const text = groundLabelText(name, style)
  const font = `${g.italic ? 'italic ' : ''}${g.weight} ${g.size}px ${LABEL_FONT}`
  const spacing = g.spacing * g.size
  const HALO = 3, MARGIN = 7
  const isCity = style === 'standard'
  const m = document.createElement('canvas').getContext('2d')!
  m.font = font
  const chars = [...text]
  const textW = chars.reduce((a, ch) => a + m.measureText(ch).width + spacing, 0) - spacing
  const lead = isCity ? CITY_DOT + CITY_DOT_GAP : 0
  const w = Math.ceil(lead + textW + (HALO + MARGIN) * 2)
  const h = Math.ceil(g.size * 1.3 + (HALO + MARGIN) * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * res); canvas.height = Math.ceil(h * res)
  const ctx = canvas.getContext('2d')!
  ctx.scale(res, res)
  const bx = HALO + MARGIN
  const cy = h / 2
  let tx = bx
  if (isCity) {
    // Point de position : vert du ruban cerclé de vert clair, léger halo.
    const dx = bx + CITY_DOT / 2
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4
    ctx.fillStyle = RIBBON_GREEN
    ctx.beginPath(); ctx.arc(dx, cy, CITY_DOT / 2, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    ctx.strokeStyle = CITY_GREEN; ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.arc(dx, cy, CITY_DOT / 2, 0, Math.PI * 2); ctx.stroke()
    tx = bx + CITY_DOT + CITY_DOT_GAP
  }
  ctx.font = font
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const each = (fn: (ch: string, x: number) => void) => {
    let x = tx
    for (const ch of chars) { fn(ch, x); x += ctx.measureText(ch).width + spacing }
  }
  // Halo sombre.
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = HALO
  each((ch, x) => ctx.strokeText(ch, x, cy))
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = g.fill
  each((ch, x) => ctx.fillText(ch, x, cy))
  return { canvas, w, h, ax: w / 2, ay: cy }
}

// ── Points d'intérêt : étiquette de l'ouverture « image 2D clair » ───────────────────────────────────────────────

/** Police du site (chargée par loadOpeningFont, filmOpening.ts ; @font-face d'index.html pour l'aperçu). */
export const POI_FONT = '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif'

export type PoiIcon = 'fort' | 'arena' | 'gate' | 'park' | 'monument'

/** Pictogramme d'un point d'intérêt d'après son nom : citadelle, fort (étoile) ; stade, arena (dôme) ; porte, arc ;
 * parc, jardin, bois (arbre) ; sinon monument (fronton à colonnes). */
export function poiIconFor(name: string): PoiIcon {
  const n = ` ${name.toLocaleLowerCase('fr-FR')} `
  if (/[\s'](citadelle|fort|bastion)\s/.test(n)) return 'fort'
  if (/[\s'](stade|arena|aréna|zénith|zenith|vélodrome|hippodrome)\s/.test(n)) return 'arena'
  if (/[\s'](porte|arc)\s/.test(n)) return 'gate'
  if (/[\s'](parc|jardin|jardins|bois|square|forêt)\s/.test(n)) return 'park'
  return 'monument'
}

/** Pictogramme blanc au trait, dans un carré de `s` px centré en (cx, cy) : `fort` (étoile de citadelle), `arena`
 * (dôme), `gate` (porte, arc), `park` (arbre), sinon `monument` (fronton à colonnes). */
export function drawPoiIcon(ctx: CanvasRenderingContext2D, icon: PoiIcon, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx - s / 2, cy - s / 2)
  ctx.scale(s / 24, s / 24)
  ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.beginPath()
  if (icon === 'fort') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.6 : 10.5
      if (i) ctx.lineTo(12 + Math.cos(a) * r, 12.5 + Math.sin(a) * r); else ctx.moveTo(12 + Math.cos(a) * r, 12.5 + Math.sin(a) * r)
    }
    ctx.closePath(); ctx.stroke()
  } else if (icon === 'arena') {
    ctx.moveTo(3, 19); ctx.lineTo(21, 19); ctx.moveTo(4.5, 19); ctx.lineTo(4.5, 15); ctx.lineTo(19.5, 15); ctx.lineTo(19.5, 19)
    ctx.moveTo(5, 15); ctx.arc(12, 15, 7, Math.PI, 0); ctx.moveTo(12, 8); ctx.lineTo(12, 5)
    for (const x of [8, 12, 16]) { ctx.moveTo(x, 15); ctx.lineTo(x, 19) }
    ctx.stroke()
  } else if (icon === 'gate') {
    ctx.moveTo(3, 20); ctx.lineTo(3, 7); ctx.lineTo(21, 7); ctx.lineTo(21, 20)
    ctx.moveTo(2, 4.5); ctx.lineTo(22, 4.5)
    ctx.moveTo(8.5, 20); ctx.lineTo(8.5, 14); ctx.arc(12, 14, 3.5, Math.PI, 0); ctx.lineTo(15.5, 20)
    ctx.stroke()
  } else if (icon === 'park') {
    ctx.arc(12, 9.5, 6.5, 0, Math.PI * 2); ctx.moveTo(12, 16); ctx.lineTo(12, 21); ctx.stroke()
  } else {
    ctx.moveTo(2.5, 8); ctx.lineTo(12, 3); ctx.lineTo(21.5, 8); ctx.closePath()
    ctx.moveTo(3, 20.5); ctx.lineTo(21, 20.5); ctx.moveTo(4, 18); ctx.lineTo(20, 18)
    for (const x of [5.5, 9.5, 14.5, 18.5]) { ctx.moveTo(x, 10); ctx.lineTo(x, 17) }
    ctx.stroke()
  }
  ctx.restore()
}

/** Coupe un nom en deux lignes équilibrées au-delà de 14 caractères (« Citadelle / de Lille »). */
export function poiLines(name: string): string[] {
  if (name.length <= 14 || !name.includes(' ')) return [name]
  const words = name.split(' ')
  let best = [name], bestD = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const d = Math.abs(a.length - b.length)
    if (d < bestD) { bestD = d; best = [a, b] }
  }
  return best
}

/** Étiquette de POI, comme l'ouverture « image 2D clair » : fond sombre très transparent (la carte transparaît),
 * contour clair arrondi, pictogramme au trait et nom blanc (deux lignes si long) ; tige fine à demi transparente
 * jusqu'au repère, rond blanc cerclé de noir posé sur le lieu. Ancre = centre du repère. */
function renderPoiLabel(name: string, res: number): { canvas: HTMLCanvasElement; w: number; h: number; ax: number; ay: number } {
  const size = 16, padX = 9, padY = 6, lineH = size * 1.1, iconS = 22, gap = 7, stem = 24, dotR = 6.5, M = 8
  const font = `700 ${size}px ${POI_FONT}`
  const lines = poiLines(name)
  const m = document.createElement('canvas').getContext('2d')!
  m.font = font
  const textW = Math.max(...lines.map(l => m.measureText(l).width))
  const bw = padX + iconS + gap + textW + padX, bh = Math.max(iconS, lines.length * lineH) + padY * 2
  const w = Math.ceil(bw + M * 2), h = Math.ceil(M + bh + stem + dotR + M)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * res); canvas.height = Math.ceil(h * res)
  const ctx = canvas.getContext('2d')!
  ctx.scale(res, res)
  const x0 = (w - bw) / 2, y0 = M, ax = w / 2, ay = y0 + bh + stem
  // Tige discrète.
  ctx.strokeStyle = 'rgba(29,38,44,0.5)'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.moveTo(ax, y0 + bh); ctx.lineTo(ax, ay); ctx.stroke()
  // Étiquette ; contour, pictogramme et nom portent une ombre sombre pour rester lisibles.
  ctx.fillStyle = 'rgba(29,38,44,0.38)'
  ctx.beginPath(); ctx.roundRect(x0, y0, bw, bh, 9); ctx.fill()
  ctx.shadowColor = 'rgba(10,16,20,0.75)'; ctx.shadowBlur = 5
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 1.8
  ctx.stroke()
  drawPoiIcon(ctx, poiIconFor(name), x0 + padX + iconS / 2, y0 + bh / 2, iconS)
  ctx.font = font
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  const ty = y0 + bh / 2 - ((lines.length - 1) * lineH) / 2 + size * 0.36
  lines.forEach((l, i) => ctx.fillText(l, x0 + padX + iconS + gap, ty + i * lineH))
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
  // Repère sur le lieu.
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(ax, ay, dotR, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#1d262c'; ctx.lineWidth = 2.5
  ctx.stroke()
  return { canvas, w, h, ax, ay }
}

// ── Noms de rue le long du parcours ──────────────────────────────────────────────────────────────────────────────

const ABBREV_FULL: Record<string, string> = {
  R: 'Rue', CHE: 'Chemin', ALL: 'Allée', IMP: 'Impasse', SQ: 'Square', PROM: 'Promenade', PAS: 'Passage',
  RLE: 'Ruelle', SEN: 'Sentier', CAR: 'Carrefour', CHS: 'Chaussée', ESP: 'Esplanade',
}
const PARTICLES = new Set(['DE', 'DES', 'DU', 'LA', 'LE', 'LES', 'ET', 'SUR', 'EN', 'AUX', 'AU', 'SOUS'])
/** Voies majeures, écrites en capitales : boulevards, avenues, routes, places, quais, cours. */
const MAJOR = /^(BD|AV|RTE|PL|QU|CRS|PONT)\s/

/** Nom affiché et rang d'une rue au format IGN (« BD VICTOR HUGO », « R DES POSTES ») : voies majeures (ou d'importance
 * IGN 1 à 3) en capitales ; rues en casse normale, type de voie écrit en entier (« Rue des Postes »). */
export function streetLabel(name: string, importance?: number): StreetLabel {
  const place = placeLines(name)
  if (place) return { text: name, major: true, place }
  const major = MAJOR.test(name) || (importance ?? 6) <= 3
  if (major) return { text: name, major }
  const words = name.split(' ')
  const out = words.map((w, i) => {
    if (i === 0 && ABBREV_FULL[w]) return ABBREV_FULL[w]
    if (i > 0 && PARTICLES.has(w)) return w.toLowerCase()
    if (/^[DL]'/.test(w)) return w[0].toLowerCase() + "'" + cap(w.slice(2))
    return w.split('-').map(cap).join('-')
  })
  return { text: out.join(' '), major }
}
const cap = (w: string) => (w ? w[0] + w.slice(1).toLowerCase() : w)

/** Accents des mots courants des noms de place, absents des noms IGN (« GENERAL » -> « GÉNÉRAL »). */
const ACCENTS: Record<string, string> = {
  GENERAL: 'GÉNÉRAL', REPUBLIQUE: 'RÉPUBLIQUE', EGLISE: 'ÉGLISE', HOTEL: 'HÔTEL', THEATRE: 'THÉÂTRE',
  MARECHAL: 'MARÉCHAL', LIBERATION: 'LIBÉRATION', MAIRIE: 'MAIRIE', ETOILE: 'ÉTOILE', OPERA: 'OPÉRA',
}
/** Nom d'une place IGN réparti sur deux arcs : « PL DE LA GARE » -> PLACE DE / LA GARE ; « PL DU GENERAL DE GAULLE »
 * -> PLACE / DU GÉNÉRAL DE GAULLE ; « PL RIHOUR » -> PLACE / RIHOUR. null si ce n'est pas une place. */
export function placeLines(name: string): { top: string; bottom: string } | null {
  const m = /^PL\s+(.+)$/.exec(name.trim())
  if (!m) return null
  const words = m[1].split(/\s+/).map(w => ACCENTS[w] ?? w)
  if (words[0] === 'DE' && words.length > 1) return { top: 'PLACE DE', bottom: words.slice(1).join(' ') }
  return { top: 'PLACE', bottom: words.join(' ') }
}

/** Opacité d'un nom de rue selon la distance parcourue `m` : apparaît à l'approche (LEAD_M), reste affiché la rue
 * durant puis au moins `holdM` après son début, s'efface sur `fadeM`. */
export function streetLabelAlpha(m: number, startM: number, endM: number, holdM: number, fadeM: number): number {
  const LEAD_M = 150
  const inA = Math.min(1, Math.max(0, (m - (startM - LEAD_M)) / LEAD_M))
  const until = Math.max(endM, startM + holdM)
  const outA = Math.min(1, Math.max(0, (until + fadeM - m) / Math.max(1, fadeM)))
  return Math.min(inA, outA)
}

/** Nom de rue à inscrire, avec sa place sur la rue une fois choisie (`fix`) : le même objet doit être repassé à chaque
 * image (cf. drawStreetAlongPath). */
export interface StreetLabel {
  text: string
  major: boolean
  /** Place (« PL ... ») : nom écrit en cercle, `top` en arc sur le haut, `bottom` en arc sur le bas. */
  place?: { top: string; bottom: string }
  /** Place figée à la première image où le nom tient : centre du nom (indice fractionnaire dans `pts`, donc un point
   *  fixe de la rue), taille des lettres, sens de lecture (vers les indices décroissants si `flip`), teinte (`dark` :
   *  lettres noires sur fond clair ; mesurée à la première image où le fond est lisible). */
  fix?: { at: number; size: number; flip: boolean; dark?: boolean }
}

type Pt = { x: number; y: number }
const STEP = 4

/** Écrit le nom le long de la rue `pts` (px écran ; `null` = point hors champ ou derrière la caméra), décalé de `offset`
 * px sur le côté gauche du sens de lecture, lettre par lettre en suivant la courbe. Le nom est FIXE sur la carte : à la
 * première image où il tient sur la partie visible de la rue (`view`, taille de l'image), son centre, sa taille et son
 * sens de lecture sont figés (`label.fix`) ; ensuite il suit ce point de la rue, sans glisser avec la caméra. `pts` doit
 * donc décrire la même rue, dans le même ordre, à chaque image. `k` : échelle. Blanc sur fond sombre, noir sur fond
 * clair : fond lu dans `bg` (défaut : le canvas de `ctx`, carte déjà dessinée ; `scale` = px du fond par px de dessin ;
 * null : fond pas encore prêt, mesure remise à une image suivante). */
export function drawStreetAlongPath(
  ctx: CanvasRenderingContext2D, label: StreetLabel, pts: (Pt | null)[],
  alpha: number, k = 1, offset = 16, view?: { w: number; h: number },
  bg?: { src: CanvasImageSource; scale: number } | null,
) {
  if (alpha <= 0 || pts.length < (label.place ? 1 : 2)) return
  if (label.place) { drawPlaceCircle(ctx, label, label.place, pts, alpha, k, view, bg); return }
  const chars = [...label.text]
  const fontAt = (size: number) => `${label.major ? 700 : 600} ${size}px ${LABEL_FONT}`
  const spacingAt = (size: number) => (label.major ? 0.1 : 0.03) * size
  const measure = (size: number) => {
    ctx.font = fontAt(size)
    const sp = spacingAt(size)
    const widths = chars.map(ch => ctx.measureText(ch).width + sp)
    return { widths, textW: widths.reduce((a, b) => a + b, 0) - sp, sp }
  }
  ctx.save()
  if (!label.fix) {
    // Placement : milieu de la plus longue partie de la rue visible à l'écran ; le nom doit y tenir (taille réduite
    // jusqu'à 70 %), sinon on réessaie à l'image suivante.
    const M = 30 * k
    const inView = (p: Pt | null): p is Pt => !!p && (!view || (p.x > M && p.x < view.w - M && p.y > M && p.y < view.h - M))
    let best: [number, number] = [0, -1], cur = -1
    for (let i = 0; i <= pts.length; i++) {
      if (i < pts.length && inView(pts[i])) { if (cur < 0) cur = i }
      else if (cur >= 0) { if (i - 1 - cur > best[1] - best[0]) best = [cur, i - 1]; cur = -1 }
    }
    const [i0, i1] = best
    if (i1 - i0 < 1) { ctx.restore(); return }
    const cum = [0]
    for (let i = i0 + 1; i <= i1; i++) cum.push(cum[cum.length - 1] + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y))
    const total = cum[cum.length - 1]
    const base = 13.5 * k
    let size = base
    for (; size >= base * 0.7; size -= 0.5 * k) if (measure(size).textW <= total * 0.85) break
    if (measure(size).textW > total * 0.85) { ctx.restore(); return }
    let j = 1
    while (j < cum.length - 1 && cum[j] < total / 2) j++
    const at = i0 + j - 1 + (total / 2 - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1])
    label.fix = { at, size, flip: pts[i1]!.x < pts[i0]!.x }
  }
  const { at, size } = label.fix
  // Partie continue (sans point manquant) de la rue autour du centre du nom.
  const ia = Math.floor(at), ib = Math.min(pts.length - 1, ia + 1)
  if (!pts[ia] || !pts[ib]) { ctx.restore(); return }
  let lo = ia, hi = ib
  while (lo > 0 && pts[lo - 1]) lo--
  while (hi < pts.length - 1 && pts[hi + 1]) hi++
  const P = (i: number) => pts[i]!
  const f = at - ia
  const c = { x: P(ia).x + (P(ib).x - P(ia).x) * f, y: P(ia).y + (P(ib).y - P(ia).y) * f }
  // Rééchantillonnage tous les STEP px à partir du centre, de part et d'autre (pas de calage qui varie d'une image à
  // l'autre), puis lissage : pas de lettres qui sautent sur les zigzags du GPS.
  const walk = (from: Pt, idx: number[]): Pt[] => {
    const out: Pt[] = []
    let a = from
    for (const i of idx) {
      const b = P(i)
      let d = Math.hypot(b.x - a.x, b.y - a.y)
      while (d >= STEP) {
        a = { x: a.x + (b.x - a.x) * (STEP / d), y: a.y + (b.y - a.y) * (STEP / d) }
        out.push(a)
        d -= STEP
      }
    }
    return out
  }
  const fwd = walk(c, Array.from({ length: hi - ib + 1 }, (_, n) => ib + n))
  const back = walk(c, Array.from({ length: ia - lo + 1 }, (_, n) => ia - n))
  const res = [...back.reverse(), c, ...fwd]
  if (res.length < 3) { ctx.restore(); return }
  const R = 6
  let sm = res.map((_, i) => {
    let x = 0, y = 0, n = 0
    for (let j = Math.max(0, i - R); j <= Math.min(res.length - 1, i + R); j++) { x += res[j].x; y += res[j].y; n++ }
    return { x: x / n, y: y / n }
  })
  let s0 = back.length * STEP // abscisse du centre du nom
  // Sens de lecture figé ; retourné seulement si le nom finit nettement à l'envers (caméra qui a beaucoup tourné).
  const ci = back.length, dA = sm[Math.max(0, ci - 3)], dB = sm[Math.min(sm.length - 1, ci + 3)]
  const readX = (dB.x - dA.x) * (label.fix.flip ? -1 : 1), len = Math.hypot(dB.x - dA.x, dB.y - dA.y)
  if (len > 0 && readX < -0.5 * len) label.fix.flip = !label.fix.flip
  const total = (sm.length - 1) * STEP
  if (label.fix.flip) { sm = sm.reverse(); s0 = total - s0 }
  /** Point à l'abscisse s ; au-delà des extrémités, prolongé en ligne droite (lettres jamais empilées). */
  const at2 = (s: number): Pt => {
    const i = Math.min(sm.length - 2, Math.max(0, Math.floor(s / STEP)))
    const u = s / STEP - i
    return { x: sm[i].x + (sm[i + 1].x - sm[i].x) * u, y: sm[i].y + (sm[i + 1].y - sm[i].y) * u }
  }
  const { widths, textW, sp } = measure(size)
  const glyphs: { ch: string; x: number; y: number; ang: number }[] = []
  let s = s0 - textW / 2
  for (let i = 0; i < chars.length; i++) {
    const mid = s + widths[i] / 2 - sp / 2
    const p0 = at2(mid - widths[i] / 2), p1 = at2(mid + widths[i] / 2), p = at2(mid)
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x)
    const nx = Math.sin(ang), ny = -Math.cos(ang) // normale à gauche du sens de lecture (vers le haut)
    glyphs.push({ ch: chars[i], x: p.x + nx * offset * k, y: p.y + ny * offset * k, ang })
    s += widths[i]
  }
  // Teinte selon le fond sous le nom, mesurée une fois (le nom est fixe sur la carte, son fond ne change pas) : blanc
  // sur fond sombre, noir sur fond clair.
  if (label.fix.dark === undefined && bg !== null) {
    const l = backgroundLuma(bg ?? { src: ctx.canvas, scale: 1 }, glyphs, size)
    if (l != null) label.fix.dark = l > LIGHT_BG_LUMA
  }
  const dark = label.fix.dark === true
  ctx.globalAlpha = alpha * (label.major ? 0.97 : 0.9)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'
  for (const g of glyphs) {
    ctx.save()
    ctx.translate(g.x, g.y)
    ctx.rotate(g.ang)
    ctx.shadowColor = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 3 * k
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2.6 * k
    ctx.strokeText(g.ch, 0, 0)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = dark ? '#111111' : '#ffffff'
    ctx.fillText(g.ch, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}

/** Au-delà de cette luminance moyenne (0 noir, 1 blanc), le fond est clair : nom de rue écrit en noir. */
const LIGHT_BG_LUMA = 0.55
let lumaCanvas: HTMLCanvasElement | null = null

/** Luminance moyenne du fond autour des lettres (carré d'une hauteur de lettre centré sur chacune) ; null si le fond
 * n'est pas lisible (canvas vide ou protégé). `bg.scale` : px du fond par px de dessin. */
function backgroundLuma(bg: { src: CanvasImageSource; scale: number }, glyphs: { x: number; y: number }[], size: number): number | null {
  const N = 6
  const step = Math.max(1, Math.floor(glyphs.length / 8))
  const pick = glyphs.filter((_, i) => i % step === 0)
  lumaCanvas ??= document.createElement('canvas')
  lumaCanvas.width = N * pick.length; lumaCanvas.height = N
  const c = lumaCanvas.getContext('2d', { willReadFrequently: true })
  if (!c) return null
  c.clearRect(0, 0, lumaCanvas.width, N)
  const r = size * bg.scale
  try {
    pick.forEach((g, i) => c.drawImage(bg.src, g.x * bg.scale - r, g.y * bg.scale - r, 2 * r, 2 * r, i * N, 0, N, N))
    const d = c.getImageData(0, 0, lumaCanvas.width, N).data
    let sum = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++
    }
    return n > d.length / 8 ? sum / n : null
  } catch {
    return null
  }
}

/** Nom de place en cercle, centré sur la place (point du parcours, fixe sur la carte comme les noms de rue) :
 * « PLACE » en haut, « DU GÉNÉRAL DE GAULLE » en bas dans le sens de la lecture, tirets entre les deux, à l'intérieur d'un fin anneau.
 * Même teinte adaptative que les rues (blanc sur fond sombre, noir sur fond clair). */
function drawPlaceCircle(
  ctx: CanvasRenderingContext2D, label: StreetLabel, place: { top: string; bottom: string }, pts: (Pt | null)[],
  alpha: number, k: number, view: { w: number; h: number } | undefined, bg: { src: CanvasImageSource; scale: number } | null | undefined,
) {
  if (!label.fix) {
    // Centre : milieu de la plus longue partie de la place visible à l'écran (assez loin des bords pour le cercle).
    const M = 90 * k
    const inView = (p: Pt | null): p is Pt => !!p && (!view || (p.x > M && p.x < view.w - M && p.y > M && p.y < view.h - M))
    let best: [number, number] = [0, -1], cur = -1
    for (let i = 0; i <= pts.length; i++) {
      if (i < pts.length && inView(pts[i])) { if (cur < 0) cur = i }
      else if (cur >= 0) { if (i - 1 - cur > best[1] - best[0]) best = [cur, i - 1]; cur = -1 }
    }
    if (best[1] < best[0]) return
    label.fix = { at: (best[0] + best[1]) / 2, size: 11.5 * k, flip: false }
  }
  const { at, size } = label.fix
  const ia = Math.floor(at), ib = Math.min(pts.length - 1, ia + 1)
  const a = pts[ia], b = pts[ib] ?? a
  if (!a || !b) return
  const f = at - ia
  const cx = a.x + (b.x - a.x) * f, cy = a.y + (b.y - a.y) * f
  ctx.save()
  ctx.font = `700 ${size}px ${LABEL_FONT}`
  const sp = 0.07 * size
  // Tout le tour du cercle : `top` en haut (sens horaire), `bottom` en bas dans le sens de la lecture (sens
  // antihoraire, lettres droites), un tiret dans chacun des deux intervalles. Cercle le plus serré possible.
  const widthsOf = (t: string) => [...t].map(ch => ctx.measureText(ch).width + sp)
  const topW = widthsOf(place.top), botW = widthsOf(place.bottom)
  const sum = (w: number[]) => w.reduce((x, y) => x + y, 0) - sp
  const dashW = ctx.measureText('-').width + 4 * sp + size
  const r = Math.max(2.2 * size, (sum(topW) + sum(botW) + 2 * dashW) / (2 * Math.PI))
  const glyphs: { ch: string; x: number; y: number; ang: number }[] = []
  // Haut : de gauche à droite dans le sens horaire, centré sur -90° ; lettres tournées vers l'extérieur.
  {
    let s = -sum(topW) / 2
    ;[...place.top].forEach((ch, i) => {
      const th = -Math.PI / 2 + (s + (topW[i] - sp) / 2) / r
      glyphs.push({ ch, x: cx + r * Math.cos(th), y: cy + r * Math.sin(th), ang: th + Math.PI / 2 })
      s += topW[i]
    })
  }
  // Bas : de gauche à droite dans le sens antihoraire, centré sur +90° ; lettres droites (pied vers l'extérieur).
  {
    let s = -sum(botW) / 2
    ;[...place.bottom].forEach((ch, i) => {
      const th = Math.PI / 2 - (s + (botW[i] - sp) / 2) / r
      glyphs.push({ ch, x: cx + r * Math.cos(th), y: cy + r * Math.sin(th), ang: th - Math.PI / 2 })
      s += botW[i]
    })
  }
  // Tirets : au milieu des intervalles gauche et droit.
  {
    const t1 = -Math.PI / 2 + sum(topW) / 2 / r, t2 = Math.PI / 2 - sum(botW) / 2 / r
    const tR = (t1 + t2) / 2, tL = Math.PI - tR
    for (const th of [tR, tL]) {
      glyphs.push({ ch: '-', x: cx + r * Math.cos(th), y: cy + r * Math.sin(th), ang: th + Math.PI / 2 })
    }
  }
  if (label.fix.dark === undefined && bg !== null) {
    const l = backgroundLuma(bg ?? { src: ctx.canvas, scale: 1 }, glyphs, size)
    if (l != null) label.fix.dark = l > LIGHT_BG_LUMA
  }
  const dark = label.fix.dark === true
  const ink = dark ? '#111111' : '#ffffff', halo = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
  ctx.globalAlpha = alpha * 0.97
  // Fin anneau extérieur, discret : le nom est écrit à l'intérieur, comme un tampon posé sur la place.
  const rr = r + size * 0.8
  ctx.lineWidth = 3.2 * k; ctx.strokeStyle = halo
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 1.3 * k; ctx.strokeStyle = ink
  ctx.globalAlpha = alpha * 0.7
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke()
  ctx.globalAlpha = alpha * 0.97
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'
  for (const g of glyphs) {
    ctx.save()
    ctx.translate(g.x, g.y)
    ctx.rotate(g.ang)
    ctx.shadowColor = halo; ctx.shadowBlur = 3 * k
    ctx.strokeStyle = halo; ctx.lineWidth = 2.6 * k
    ctx.strokeText(g.ch, 0, 0)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = ink
    ctx.fillText(g.ch, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}
