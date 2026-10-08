// Écritures cartographiques communes à l'aperçu (TrackMap), au film 2D (filmExport) et au film 3D (filmExport3d) :
// noms de lieux écrits au sol (localité, lieu-dit, point d'intérêt avec pictogramme) et noms de rue inscrits le long
// du parcours. Style « cartographie sportive » : sans-serif, blanc cassé, léger halo sombre, pas de gros contour ;
// hiérarchie boulevards (capitales) > rues (casse normale, plus discrètes) ; le parcours reste au-dessus de tout.

export type GroundLabelStyle = 'standard' | 'lieudit' | 'poi'

export const LABEL_FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'

const GROUND: Record<GroundLabelStyle, { weight: string; italic: boolean; size: number; fill: string }> = {
  standard: { weight: '700', italic: false, size: 22, fill: '#ffffff' },
  lieudit:  { weight: '600', italic: true,  size: 18, fill: '#f1f1ec' },
  poi:      { weight: '600', italic: false, size: 21, fill: '#ffffff' },
}
const POI_ICON = 26
const POI_GAP = 7

/** Pictogramme des points d'intérêt : disque sombre cerclé de blanc, petit monument blanc (fronton, colonnes). */
export function drawPoiPictogram(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number) {
  const r = d / 2, u = d / 26
  ctx.save()
  ctx.fillStyle = 'rgba(18,22,20,0.82)'
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * u; ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.moveTo(cx - 7 * u, cy - 3 * u); ctx.lineTo(cx, cy - 8 * u); ctx.lineTo(cx + 7 * u, cy - 3 * u); ctx.closePath(); ctx.fill()
  for (const dx of [-5, -1.5, 2]) ctx.fillRect(cx + dx * u, cy - 2 * u, 3 * u, 7 * u)
  ctx.fillRect(cx - 7 * u, cy + 5.5 * u, 14 * u, 2 * u)
  ctx.restore()
}

/** Nom de lieu écrit au sol, dans un canvas à la résolution `res` (px de canvas par px logique). Taille logique `w` × `h` ;
 * ancre (`ax`, `ay`, px logiques) = centre du nom, ou le pictogramme d'un POI (posé sur le point, nom à sa droite). */
export function renderGroundLabel(name: string, style: GroundLabelStyle, res: number): { canvas: HTMLCanvasElement; w: number; h: number; ax: number; ay: number } {
  const g = GROUND[style]
  const font = (px: number) => `${g.italic ? 'italic ' : ''}${g.weight} ${px}px ${LABEL_FONT}`
  const HALO = 3, MARGIN = 7
  const icon = style === 'poi' ? POI_ICON + POI_GAP : 0
  const m = document.createElement('canvas').getContext('2d')!
  m.font = font(g.size)
  const textW = m.measureText(name).width
  const w = Math.ceil(icon + textW + (HALO + MARGIN) * 2)
  const h = Math.ceil(Math.max(g.size * 1.3, style === 'poi' ? POI_ICON : 0) + (HALO + MARGIN) * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * res); canvas.height = Math.ceil(h * res)
  const ctx = canvas.getContext('2d')!
  ctx.scale(res, res)
  const cy = h / 2
  if (style === 'poi') drawPoiPictogram(ctx, HALO + MARGIN + POI_ICON / 2, cy, POI_ICON)
  const tx = HALO + MARGIN + icon
  ctx.font = font(g.size)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 4
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = HALO
  ctx.strokeText(name, tx, cy)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = g.fill
  ctx.fillText(name, tx, cy)
  return { canvas, w, h, ax: style === 'poi' ? HALO + MARGIN + POI_ICON / 2 : w / 2, ay: cy }
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
export function streetLabel(name: string, importance?: number): { text: string; major: boolean } {
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

/** Opacité d'un nom de rue selon la distance parcourue `m` : apparaît à l'approche (LEAD_M), reste affiché la rue
 * durant puis au moins `holdM` après son début, s'efface sur `fadeM`. */
export function streetLabelAlpha(m: number, startM: number, endM: number, holdM: number, fadeM: number): number {
  const LEAD_M = 150
  const inA = Math.min(1, Math.max(0, (m - (startM - LEAD_M)) / LEAD_M))
  const until = Math.max(endM, startM + holdM)
  const outA = Math.min(1, Math.max(0, (until + fadeM - m) / Math.max(1, fadeM)))
  return Math.min(inA, outA)
}

/** Écrit `text` le long de la ligne `pts` (px écran), décalé de `offset` px sur le côté gauche du sens de lecture,
 * lettre par lettre en suivant la courbe ; lu de gauche à droite (la ligne est retournée si besoin). `k` : échelle ;
 * `view` : taille de l'image (seule la partie visible de la rue est utilisée). */
export function drawStreetAlongPath(
  ctx: CanvasRenderingContext2D, label: { text: string; major: boolean }, pts: { x: number; y: number }[],
  alpha: number, k = 1, offset = 16, view?: { w: number; h: number },
) {
  if (alpha <= 0 || pts.length < 2) return
  // Seule la partie de la rue visible à l'écran (`view`) compte : le nom y est centré, entier.
  let line = pts
  if (view) {
    const M = 30 * k
    const inView = (p: { x: number; y: number }) => p.x > M && p.x < view.w - M && p.y > M && p.y < view.h - M
    let best: { x: number; y: number }[] = [], cur: { x: number; y: number }[] = []
    for (const p of pts) {
      if (inView(p)) cur.push(p)
      else { if (cur.length > best.length) best = cur; cur = [] }
    }
    line = cur.length > best.length ? cur : best
    if (line.length < 2) return
  }
  if (line[line.length - 1].x < line[0].x) line = [...line].reverse()
  // Rééchantillonnage tous les 4 px puis lissage : pas de lettres qui sautent sur les zigzags du GPS.
  const res: { x: number; y: number }[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const a = res[res.length - 1], b = line[i]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.floor(d / 4)
    for (let j = 1; j <= n; j++) res.push({ x: a.x + (b.x - a.x) * (j * 4 / d), y: a.y + (b.y - a.y) * (j * 4 / d) })
  }
  if (res.length < 3) return
  const R = 6
  const sm = res.map((_, i) => {
    let x = 0, y = 0, c = 0
    for (let j = Math.max(0, i - R); j <= Math.min(res.length - 1, i + R); j++) { x += res[j].x; y += res[j].y; c++ }
    return { x: x / c, y: y / c }
  })
  const cum = [0]
  for (let i = 1; i < sm.length; i++) cum.push(cum[i - 1] + Math.hypot(sm[i].x - sm[i - 1].x, sm[i].y - sm[i - 1].y))
  const total = cum[cum.length - 1]
  const at = (s: number) => {
    const c = Math.max(0, Math.min(total, s))
    let i = 1
    while (i < cum.length - 1 && cum[i] < c) i++
    const f = (c - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
    return { x: sm[i - 1].x + (sm[i].x - sm[i - 1].x) * f, y: sm[i - 1].y + (sm[i].y - sm[i - 1].y) * f }
  }
  // Le nom doit tenir sur la portion de rue visible (sinon ses lettres s'empilaient aux extrémités) : taille réduite
  // jusqu'à 70 %, au-delà on ne l'écrit pas.
  const chars = [...label.text]
  const base = 15 * k
  let size = base, spacing = 0, widths: number[] = [], textW = 0
  ctx.save()
  for (; size >= base * 0.7; size -= 0.5 * k) {
    spacing = (label.major ? 0.06 : 0.02) * size
    ctx.font = `${label.major ? 700 : 600} ${size}px ${LABEL_FONT}`
    widths = chars.map(ch => ctx.measureText(ch).width + spacing)
    textW = widths.reduce((a, b) => a + b, 0) - spacing
    if (textW <= total * 0.92) break
  }
  if (textW > total * 0.92) { ctx.restore(); return }
  ctx.globalAlpha = alpha * (label.major ? 0.95 : 0.75)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'
  let s = (total - textW) / 2
  for (let i = 0; i < chars.length; i++) {
    const mid = s + widths[i] / 2 - spacing / 2
    const p0 = at(mid - widths[i] / 2), p1 = at(mid + widths[i] / 2), p = at(mid)
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x)
    const nx = Math.sin(ang), ny = -Math.cos(ang) // normale à gauche du sens de lecture (vers le haut)
    ctx.save()
    ctx.translate(p.x + nx * offset * k, p.y + ny * offset * k)
    ctx.rotate(ang)
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3 * k
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2.5 * k
    ctx.strokeText(chars[i], 0, 0)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#f4f1ea'
    ctx.fillText(chars[i], 0, 0)
    ctx.restore()
    s += widths[i]
  }
  ctx.restore()
}
