// Modèle 2 — la toute première affiche (sombre) : papier vert nuit, carte en vues aériennes assombries, titre et
// « distance · date · ville », carte avec jusqu'à deux photos dans une colonne à droite, grand temps avec dossard,
// classement et allure alignés à droite, temps de passage, meilleur et moins bon km, moitiés, profil. Mise en page
// reprise de la première version de lib/poster.ts (avant les modèles), sur le canvas de l'affiche actuel.
import type { PosterData, Resolved, Theme, MapOptions } from './poster'
import {
  POSTER_W, SANS, SERIF, drawMap, drawPhoto, drawProfile, drawSocialFooter, fitFont, posterSplits, setSpacing,
} from './poster'
import { formatElapsed } from './raceSplits'

export async function drawOrigine(ctx: CanvasRenderingContext2D, data: PosterData, r: Resolved, theme: Theme,
  photos: HTMLImageElement[], k: number, isLive: () => boolean, signature: boolean): Promise<boolean> {
  const fg = (a: number) => `rgba(${theme.fg},${a})`
  const H = r.H, L = 34, R = POSTER_W - 34, CW = R - L
  const finishS = r.chronoS
  const hasTimes = !!data.analysis
  const shown = r.show('photos') ? photos.slice(0, 3) : []
  const showMap = r.show('map')

  // En-tête : FINISHER (et le nom, s'il est saisi), titre, distance · date · ville
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  ctx.fillStyle = theme.accent; ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3.5)
  ctx.fillText([finishS ? 'FINISHER' : 'PARCOURS', r.name.toUpperCase()].filter(Boolean).join('  ·  '), L, 46)
  setSpacing(ctx, 0)
  const titleSize = fitFont(ctx, r.title, 700, SERIF, 46, 26, CW)
  ctx.fillStyle = fg(1)
  ctx.fillText(r.title, L, 64 + titleSize * 0.82)
  ctx.font = `15px ${SANS}`; setSpacing(ctx, 0.6); ctx.fillStyle = fg(0.75)
  ctx.fillText([r.distance, r.dateText, r.city].filter(Boolean).join(' · '), L, 136)
  setSpacing(ctx, 0)
  const mapTop = 156

  // Bas de l'affiche, de bas en haut : pied, profil, notes, temps de passage, ligne du temps → la carte prend le reste.
  const plan = (useSplits: boolean, useNotes: boolean, profileH: number) => {
    let bottom = H - 44
    let profileY: number | undefined
    if (r.show('profile')) { profileY = bottom - profileH; bottom = profileY - 24 }
    let notesY: number | undefined
    if (useNotes) { notesY = bottom; bottom -= 26 }
    let splitsY: number | undefined
    if (useSplits) { splitsY = bottom - 64; bottom = splitsY - 18 }
    const timeY = bottom // ligne de base du grand chiffre
    return { profileY, profileH, notesY, splitsY, timeY, mapBottom: timeY - 112 }
  }
  let useSplits = r.show('splits') && hasTimes, useNotes = r.show('notes') && hasTimes
  let p = plan(useSplits, useNotes, 92)
  if (p.mapBottom - mapTop < 200 && useSplits) { useSplits = false; p = plan(useSplits, useNotes, 92) }
  if (p.mapBottom - mapTop < 200 && useNotes) { useNotes = false; p = plan(useSplits, useNotes, 92) }
  // Ni carte ni photo : le profil récupère la place, sans trou dans la composition.
  if (!showMap && !shown.length && r.show('profile')) p = plan(useSplits, useNotes, 92 + Math.max(0, p.mapBottom - mapTop))

  // Carte et photos (colonne de 200 à droite)
  const midH = p.mapBottom - mapTop, gap = 12
  if (showMap) {
    const photoW = shown.length ? 200 : 0
    const mapW = CW - (photoW ? photoW + gap : 0)
    const mapOpts: MapOptions = { bg: r.background, ribbon: r.ribbon, theme, bornes: r.show('bornes'), radius: 6 }
    if (!await drawMap(ctx, data, mapOpts, L, mapTop, mapW, midH, k, isLive)) return false
    if (shown.length) {
      const ph = (midH - gap * (shown.length - 1)) / shown.length
      shown.forEach((img, i) => drawPhoto(ctx, img, R - photoW, mapTop + i * (ph + gap), photoW, ph, k, 6))
    }
  } else if (shown.length) {
    const pw = (CW - gap * (shown.length - 1)) / shown.length
    shown.forEach((img, i) => drawPhoto(ctx, img, L + i * (pw + gap), mapTop, pw, midH, k, 6))
  }

  // Temps (ou distance si aucun temps), dossard, classement, allure alignés à droite
  const timeY = p.timeY
  ctx.textAlign = 'left'
  ctx.font = `700 11px ${SANS}`; setSpacing(ctx, 3); ctx.fillStyle = fg(0.6)
  ctx.fillText((finishS ? r.chronoLabel : 'Distance').toUpperCase(), L, timeY - 70)
  setSpacing(ctx, 0)
  ctx.font = `700 78px ${SERIF}`; ctx.fillStyle = fg(1)
  ctx.fillText(finishS ? formatElapsed(finishS) : r.distance, L, timeY)
  const facts: [string, string][] = []
  if (r.show('bib') && r.bib) facts.push(['Dossard', r.bib])
  if (r.show('rank') && r.rank) facts.push(['Classement', r.rank])
  if (r.pace) facts.push(['Allure moyenne', r.pace])
  ctx.textAlign = 'right'
  facts.forEach(([label, value], i) => {
    const fy = timeY - 6 - (facts.length - 1 - i) * 21
    ctx.font = `700 13px ${SANS}`; ctx.fillStyle = fg(1)
    ctx.fillText(value, R, fy)
    const vw = ctx.measureText(value).width
    ctx.font = `13px ${SANS}`; ctx.fillStyle = fg(0.55)
    ctx.fillText(label, R - vw - 16, fy)
  })

  // Temps de passage
  if (useSplits && p.splitsY != null) {
    const splits = posterSplits(data, finishS, r.distanceKm)
    const sy = p.splitsY
    ctx.strokeStyle = fg(0.18); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(L, sy); ctx.lineTo(R, sy); ctx.moveTo(L, sy + 64); ctx.lineTo(R, sy + 64); ctx.stroke()
    const cw = CW / Math.max(1, splits.length)
    ctx.textAlign = 'center'
    splits.forEach((c, i) => {
      const cx = L + cw * (i + 0.5)
      if (i) { ctx.strokeStyle = fg(0.12); ctx.beginPath(); ctx.moveTo(L + cw * i, sy + 8); ctx.lineTo(L + cw * i, sy + 56); ctx.stroke() }
      ctx.fillStyle = theme.accent; ctx.font = `700 10px ${SANS}`; setSpacing(ctx, 2)
      ctx.fillText(c.label.toUpperCase(), cx, sy + 19)
      setSpacing(ctx, 0)
      ctx.fillStyle = fg(1); ctx.font = `700 ${splits.length > 4 ? 18 : 20}px ${SANS}`
      ctx.fillText(c.time, cx, sy + 41)
      ctx.fillStyle = fg(0.6); ctx.font = `11px ${SANS}`
      ctx.fillText(c.pace, cx, sy + 56)
    })
  }

  // Meilleur et moins bon km, moitiés
  if (useNotes && p.notesY != null && data.analysis) {
    const a = data.analysis
    const parts: [string, string][] = [
      ['Meilleur km : ', `${a.best.km}e · ${formatElapsed(a.best.s)}`],
      ['Moins bon : ', `${a.worst.km}e · ${formatElapsed(a.worst.s)}`],
      ['Moitiés : ', `${formatElapsed(a.halvesS[0])} / ${formatElapsed(a.halvesS[1])}`],
    ]
    const xs = [L, L + CW / 2, R]
    parts.forEach(([label, value], i) => {
      ctx.font = `12px ${SANS}`
      const lw = ctx.measureText(label).width
      ctx.font = `700 12px ${SANS}`
      const vw = ctx.measureText(value).width
      const start = i === 0 ? xs[i] : i === 1 ? xs[i] - (lw + vw) / 2 : xs[i] - lw - vw
      ctx.textAlign = 'left'
      ctx.font = `12px ${SANS}`; ctx.fillStyle = fg(0.75); ctx.fillText(label, start, p.notesY!)
      ctx.font = `700 12px ${SANS}`; ctx.fillStyle = fg(1); ctx.fillText(value, start + lw, p.notesY!)
    })
  }

  if (p.profileY != null) drawProfile(ctx, data, r, theme, L, p.profileY, CW, p.profileH)

  // Pied : logo, « Sillonphane » et adresse du site (tous formats).
  if (signature) drawSocialFooter(ctx, theme, L, R, H)
  return true
}
