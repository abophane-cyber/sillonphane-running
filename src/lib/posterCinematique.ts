// Modèle 2 — Cinématique : affiche éditoriale « de collection » sur papier crème chaud (#F5F0E6), titres à
// empattements, accents terracotta (#F15A35). La photo principale occupe le coin supérieur droit et se fond dans le
// papier vers la gauche et vers le bas ; carte sombre du parcours à gauche (≈ 60 % de la largeur), une ou deux photos
// empilées à droite ; temps officiel en très grand, dossard, classement et allure à côté ; profil d'altitude ; pied
// d'affiche. Dessiné sur le canvas de l'affiche (lib/poster.ts) : texte, tracé et profil sont tracés à la résolution
// d'export (A3/A4 à 300 dpi), donc nets à l'impression.
import type { PosterData, Resolved, Theme, MapOptions } from './poster'
import {
  POSTER_W, SANS, SERIF, drawMap, drawPhoto, drawProfile, fitFont, setSpacing, wrapFit,
} from './poster'
import { formatElapsed } from './raceSplits'

const ACCENT = '#F15A35'

/** Photo principale fondue dans le papier, comme en CSS :
 *   mask-image: linear-gradient(to left, black 45%, transparent 100%),
 *               linear-gradient(to bottom, black 35%, transparent 100%);  mask-composite: intersect;
 * cadrée en « object-fit: cover ; object-position: center 35% ». Les deux masques sont appliqués l'un après l'autre
 * (destination-in) : leurs opacités se multiplient, comme l'intersection CSS. */
function drawHero(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, k: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')!
  const W = c.width, H = c.height
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const sw = W / s, sh = H / s
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) * 0.35, sw, sh, 0, 0, W, H)
  g.globalCompositeOperation = 'destination-in'
  const toLeft = g.createLinearGradient(W, 0, 0, 0)
  toLeft.addColorStop(0, '#000'); toLeft.addColorStop(0.45, '#000'); toLeft.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = toLeft; g.fillRect(0, 0, W, H)
  const toBottom = g.createLinearGradient(0, 0, 0, H)
  toBottom.addColorStop(0, '#000'); toBottom.addColorStop(0.35, '#000'); toBottom.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = toBottom; g.fillRect(0, 0, W, H)
  ctx.drawImage(c, x, y, w, h)
}

/** Logo Sillonphane (le sillon du site sur son carré sombre), `size` unités de côté. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const s = size / 320
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.beginPath(); ctx.moveTo(64, 0); ctx.arcTo(320, 0, 320, 320, 64); ctx.arcTo(320, 320, 0, 320, 64)
  ctx.arcTo(0, 320, 0, 0, 64); ctx.arcTo(0, 0, 320, 0, 64); ctx.closePath()
  ctx.fillStyle = '#191817'; ctx.fill()
  const grad = ctx.createLinearGradient(0, 320, 0, 0)
  grad.addColorStop(0, '#2F4839'); grad.addColorStop(0.5, '#C15C3D'); grad.addColorStop(1, '#F5F3EF')
  ctx.strokeStyle = grad; ctx.lineWidth = 29; ctx.lineCap = 'round'
  ctx.stroke(new Path2D('M 138,225 C 168,232 212,230 224,206 C 234,188 226,166 188,160 C 160,156 122,146 122,114 C 122,82 156,60 220,60'))
  ctx.beginPath(); ctx.arc(220, 60, 10, 0, Math.PI * 2); ctx.fillStyle = '#2F4839'; ctx.fill()
  ctx.lineWidth = 3; ctx.strokeStyle = '#F5F3EF'; ctx.stroke()
  ctx.beginPath(); ctx.arc(138, 225, 10, 0, Math.PI * 2); ctx.fillStyle = '#F5F3EF'; ctx.fill()
  ctx.restore()
}

export async function drawCinematique(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, baseTheme: Theme,
  photos: HTMLImageElement[], k: number, isLive: () => boolean, signature: boolean): Promise<boolean> {
  const theme: Theme = { ...baseTheme, accent: ACCENT }
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const H = r.H, L = 40, R = POSTER_W - 40, CW = R - L
  const finishS = r.chronoS
  const shown = r.show('photos') ? photos : []
  const hero = shown[0], side = shown.slice(1, 3)

  // ── Photo principale, coin supérieur droit, fondue dans le papier ──
  if (hero) {
    drawHero(ctx, hero, POSTER_W * 0.25, 0, POSTER_W * 0.75, H * 0.4, k)
    // Zone claire derrière le titre : léger voile couleur papier, sans bord visible.
    const veil = ctx.createRadialGradient(L + 150, 120, 20, L + 150, 120, 330)
    const rgb = theme.bg.startsWith('#') ? [1, 3, 5].map(i => parseInt(theme.bg.slice(i, i + 2), 16)).join(',') : '245,240,230'
    veil.addColorStop(0, `rgba(${rgb},0.72)`); veil.addColorStop(0.6, `rgba(${rgb},0.45)`); veil.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = veil
    ctx.fillRect(0, 0, POSTER_W, H * 0.4)
  }

  // ── En-tête : FINISHER / VILLE / ANNÉE, nom, titre, distance · date · ville ──
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  let y = 48
  const kicker = [finishS ? 'FINISHER' : 'PARCOURS', r.city.toUpperCase(), r.dateISO.slice(0, 4)].filter(Boolean).join('  /  ')
  ctx.fillStyle = ACCENT; ctx.font = `600 11px ${SANS}`; setSpacing(ctx, 3.6)
  ctx.fillText(kicker, L, y)
  setSpacing(ctx, 0)
  y += 12
  const textW = (hero ? POSTER_W * 0.6 : R) - L
  ctx.fillStyle = fg(1)
  if (r.name) {
    const ns = fitFont(ctx, r.name, 700, SERIF, 70, 28, textW)
    y += ns * 0.9
    ctx.fillText(r.name, L, y)
    y += 18
    ctx.fillStyle = ACCENT; ctx.fillRect(L, y, 50, 2.2)
    y += 10
    const t = wrapFit(ctx, r.title, 700, SERIF, 46, 20, textW, 2)
    ctx.fillStyle = fg(1)
    t.lines.forEach((line, i) => { y += i ? t.size * 1.02 : t.size * 0.92; ctx.fillText(line, L, y) })
  } else {
    const t = wrapFit(ctx, r.title, 700, SERIF, 60, 24, textW, 2)
    t.lines.forEach((line, i) => { y += i ? t.size * 1.02 : t.size * 0.9; ctx.fillText(line, L, y) })
    y += 16; ctx.fillStyle = ACCENT; ctx.fillRect(L, y, 50, 2.2); y += 2
  }
  const subtitle = [r.distance, r.dateText, r.city].filter(Boolean).join(' · ')
  if (subtitle) {
    y += 28
    ctx.font = `400 16px ${SANS}`; ctx.fillStyle = fg(0.82)
    ctx.fillText(subtitle, L, y)
  }
  const headerBottom = y

  // ── Bas de l'affiche, de bas en haut : pied, profil, performances → la zone centrale prend le reste ──
  const footerY = H - 26
  const facts: [string, string][] = []
  if (r.show('bib') && r.bib) facts.push(['Dossard', r.bib])
  if (r.show('rank') && r.rank) facts.push(['Classement', r.rank])
  if (r.pace) facts.push(['Allure moyenne', r.pace])
  const showMap = r.show('map')
  const hasMid = showMap || side.length > 0
  const midTop = Math.max(headerBottom + 30, H * 0.28)
  const layout = (extraProfile: number) => {
    let b = H - 56
    let profileY: number | undefined, profileH = 0
    if (r.show('profile')) { profileH = 92 + extraProfile; profileY = b - profileH; b = profileY - 34 }
    const perfTop = b - 112
    return { profileY, profileH, perfTop, midBottom: perfTop - 30 }
  }
  let p = layout(0)
  // Rien au centre (ni carte ni photo secondaire) : le profil récupère la place, sans trou dans la composition.
  if (!hasMid && r.show('profile')) p = layout(Math.max(0, p.midBottom - midTop))
  const midH = p.midBottom - midTop

  // ── Zone centrale : carte sombre à gauche, photos empilées à droite ──
  if (hasMid && midH > 60) {
    const gap = 18
    const mapW = side.length && showMap ? Math.round(CW * 0.6) : CW
    if (showMap) {
      const mapOpts: MapOptions = { bg: r.background, ribbon: r.ribbon, theme, bornes: r.show('bornes'), radius: 5 }
      if (!await drawMap(ctx, data, mapOpts, L, midTop, mapW, midH, k, isLive)) return false
    }
    if (side.length) {
      const colX = showMap ? L + mapW + gap : L
      const colW = R - colX
      // La 1re photo commence un peu plus bas que la carte quand la photo principale est au-dessus (elle s'y fond).
      const top = showMap && hero ? midTop + Math.min(36, midH * 0.08) : midTop
      const avail = p.midBottom - top
      if (showMap) {
        const heights = side.length === 2 ? [avail * 0.6 - gap / 2, avail * 0.4 - gap / 2] : [avail]
        let py = top
        side.forEach((img, i) => { drawPhoto(ctx, img, colX, py, colW, heights[i], k, 6); py += heights[i] + gap })
      } else {
        const pw = (colW - gap * (side.length - 1)) / side.length
        side.forEach((img, i) => drawPhoto(ctx, img, colX + i * (pw + gap), top, pw, avail, k, 6))
      }
    }
  }

  // ── Performances : temps officiel très grand, dossard, classement, allure à côté ──
  const tt = p.perfTop
  ctx.textAlign = 'left'
  ctx.fillStyle = ACCENT; ctx.font = `600 11px ${SANS}`; setSpacing(ctx, 3.6)
  ctx.fillText((finishS ? r.chronoLabel : 'Distance').toUpperCase(), L, tt + 12)
  setSpacing(ctx, 0)
  const big = finishS ? formatElapsed(finishS) : r.distance
  const dividerX = L + CW * 0.56
  const bigMaxW = facts.length ? dividerX - L - 26 : CW
  const bs = fitFont(ctx, big, 700, SERIF, 92, 40, bigMaxW)
  ctx.fillStyle = fg(1)
  ctx.fillText(big, L, tt + 22 + bs * 0.8)
  if (facts.length) {
    ctx.strokeStyle = fg(0.22); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(dividerX, tt + 8); ctx.lineTo(dividerX, tt + 108); ctx.stroke()
    const fx = dividerX + 28, vx = fx + 130
    const rowsTop = tt + 58 - (facts.length - 1) * 15
    facts.forEach(([label, value], i) => {
      const fy = rowsTop + i * 30
      ctx.font = `400 15px ${SANS}`; ctx.fillStyle = fg(0.6); ctx.fillText(label, fx, fy)
      ctx.font = `700 16px ${SANS}`; ctx.fillStyle = fg(1)
      fitFont(ctx, value, 700, SANS, 16, 11, R - vx)
      ctx.fillText(value, vx, fy)
    })
  }

  // ── Profil d'altitude : ligne terracotta, surface légèrement teintée ──
  if (p.profileY != null) {
    ctx.strokeStyle = fg(0.16); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(L, p.profileY - 18); ctx.lineTo(R, p.profileY - 18); ctx.stroke()
    drawProfile(ctx, data, r, { ...theme, accent: fg(0.85) }, L, p.profileY, CW, p.profileH)
  }

  // ── Pied d'affiche : phrase, filet ; logo Sillonphane à droite (image pour les réseaux seulement) ──
  ctx.textAlign = 'left'; ctx.font = `italic 400 14px ${SERIF}`; ctx.fillStyle = fg(0.62)
  const tag = 'Une course. Des souvenirs. Toujours plus loin.'
  ctx.fillText(tag, L, footerY)
  const tagW = ctx.measureText(tag).width
  let lineEnd = R
  if (signature) {
    ctx.textAlign = 'right'; ctx.font = `700 17px ${SERIF}`; ctx.fillStyle = fg(0.92)
    ctx.fillText('Sillonphane', R, footerY)
    const ww = ctx.measureText('Sillonphane').width
    drawLogo(ctx, R - ww - 28, footerY - 17, 21)
    lineEnd = R - ww - 42
  }
  ctx.strokeStyle = fg(0.2); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(L + tagW + 22, footerY - 5); ctx.lineTo(lineEnd, footerY - 5); ctx.stroke()
  return true
}
