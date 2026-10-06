import { useId } from 'react'
import type { CoverDecorPiece, CoverDecorKind } from '../lib/coverTemplates'

/** Motifs décoratifs de la page couverture — dessinés en SVG inline (recolorables via `color`,
 * rendus fidèlement par html2canvas pour l'export PDF, aucun asset externe à charger).
 * Chaque motif a un ratio intrinsèque ; la largeur vient du gabarit (% de .albcov-inner), la
 * hauteur suit. Positionnés en absolu dans `.albcov-decor-layer`. */

/** Ratio hauteur/largeur de chaque motif (pour réserver la bonne hauteur). */
const RATIO: Record<CoverDecorKind, number> = {
  washi: 0.32, clip: 2.1, binderclip: 1.3, stamp: 1, sprig: 1.6, dots: 0.7,
  grid: 1, waves: 0.4, ink: 0.8, swash: 0.28, brushline: 0.16, blob: 0.9, hatch: 0.8,
  compass: 1, arrowN: 1.5, tag: 0.24, heart: 0.9, hr: 0.06, dashframe: 1, gridpaper: 1,
  framerect: 1, circle: 1, topolines: 0.62, ridge: 0.36,
}

/** Ratio hauteur/largeur intrinsèque d'un motif (réutilisé par les cases-décor). */
export { RATIO as DECOR_RATIO }

/** Un motif décoratif seul (SVG), sans positionnement — pour les cases libres `kind:'decor'`.
 * `filled` : cadre / cercle en aplat plein plutôt qu'au trait. */
export function DecorShape({ kind, text, id, filled }: { kind: CoverDecorKind; text?: string; id: string; filled?: boolean }) {
  return <Shape kind={kind} text={text} stampId={id} filled={filled} />
}

function Shape({ kind, text, stampId, filled }: { kind: CoverDecorKind; text?: string; stampId: string; filled?: boolean }) {
  switch (kind) {
    case 'washi':
      return (
        <svg viewBox="0 0 100 32" width="100%" height="100%" preserveAspectRatio="none">
          <rect x="0" y="2" width="100" height="28" fill="currentColor" opacity="0.42" />
          <rect x="0" y="2" width="100" height="28" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
        </svg>
      )
    case 'clip':
      return (
        <svg viewBox="0 0 40 84" width="100%" height="100%">
          <path d="M12 78 V20 a8 8 0 0 1 16 0 V64 a4 4 0 0 1-8 0 V26"
            fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" opacity="0.9" />
        </svg>
      )
    case 'binderclip':
      return (
        <svg viewBox="0 0 60 46" width="100%" height="100%">
          <rect x="10" y="16" width="40" height="26" rx="2" fill="currentColor" opacity="0.85" />
          <path d="M6 16 L30 4 L54 16" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.7" />
          <path d="M14 16 L30 9 L46 16" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.5" />
        </svg>
      )
    case 'stamp': {
      const r = 44
      const pathId = `${stampId}-c`
      // Texte multi-lignes (\n) → lignes centrées ; sinon → texte courbé le long du cercle.
      const lines = text ? text.split('\n') : []
      const multi = lines.length > 1
      return (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <defs>
            <path id={pathId} d={`M50,50 m-${r},0 a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 -${r * 2},0`} />
          </defs>
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.8" />
          {!multi && <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />}
          {text && (multi ? (
            <text textAnchor="middle" fill="currentColor" opacity="0.9" fontSize="14"
              fontFamily="'Trebuchet MS','Segoe UI',sans-serif" letterSpacing="1.5">
              {lines.map((l, i) => (
                <tspan key={i} x="50" y={50 + (i - (lines.length - 1) / 2) * 16 + 5}>{l}</tspan>
              ))}
            </text>
          ) : (
            <text fill="currentColor" opacity="0.85" fontSize="9.5" fontFamily="Georgia, serif" letterSpacing="1.4">
              <textPath href={`#${pathId}`} startOffset="6%">{text}</textPath>
            </text>
          ))}
        </svg>
      )
    }
    case 'hr':
      return (
        <svg viewBox="0 0 100 8" width="100%" height="100%" preserveAspectRatio="none">
          <rect x="0" y="0" width="100" height="8" fill="currentColor" />
        </svg>
      )
    case 'dashframe':
      return (
        <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
          <rect x="1.2" y="1.2" width="97.6" height="97.6" fill="none"
            stroke="currentColor" strokeWidth="0.9" strokeDasharray="2.4 2.4" opacity="0.85" />
        </svg>
      )
    case 'framerect':
      // Cadre rectangulaire : bordure CSS (trait) ou aplat plein. Épaisseur régulière quelle que
      // soit la proportion.
      return <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        ...(filled ? { background: 'currentColor' } : { border: '2px solid currentColor' }),
      }} />
    case 'circle':
      // Cercle au trait ou disque plein — reste rond (pas d'étirement), centré dans la case.
      return (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <circle cx="50" cy="50" r={filled ? 49 : 47}
            fill={filled ? 'currentColor' : 'none'}
            stroke={filled ? 'none' : 'currentColor'} strokeWidth={filled ? 0 : 2} />
        </svg>
      )
    case 'gridpaper': {
      const g = []
      for (let i = 1; i < 12; i++) {
        g.push(<line key={`h${i}`} x1="0" y1={i * 8.33} x2="100" y2={i * 8.33} />)
        g.push(<line key={`v${i}`} x1={i * 8.33} y1="0" x2={i * 8.33} y2="100" />)
      }
      return (
        <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
          <rect x="0" y="0" width="100" height="100" fill="#ffffff" />
          <g stroke="currentColor" strokeWidth="0.4" opacity="0.7">{g}</g>
        </svg>
      )
    }
    case 'sprig':
      return (
        <svg viewBox="0 0 60 96" width="100%" height="100%">
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.9">
            <path d="M30 94 C30 70 30 40 30 6" />
            {[16, 30, 44, 58, 72].map((y, i) => (
              <g key={i}>
                <path d={`M30 ${y} C20 ${y - 6} 12 ${y - 4} 8 ${y - 12}`} />
                <path d={`M30 ${y + 4} C40 ${y - 2} 48 ${y} 52 ${y - 8}`} />
                <path d={`M9 ${y - 11} q -3 -4 0 -7`} strokeWidth="3" opacity="0.55" />
                <path d={`M51 ${y - 7} q 3 -4 0 -7`} strokeWidth="3" opacity="0.55" />
              </g>
            ))}
            <circle cx="30" cy="6" r="3" fill="currentColor" />
          </g>
        </svg>
      )
    case 'dots': {
      const cells = []
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) cells.push(<circle key={`${r}-${c}`} cx={6 + c * 13} cy={6 + r * 13} r="2" />)
      return (
        <svg viewBox="0 0 92 66" width="100%" height="100%">
          <g fill="currentColor" opacity="0.65">{cells}</g>
        </svg>
      )
    }
    case 'grid': {
      const lines = []
      for (let i = 0; i <= 8; i++) {
        lines.push(<line key={`h${i}`} x1="0" y1={i * 12} x2="96" y2={i * 12} />)
        lines.push(<line key={`v${i}`} x1={i * 12} y1="0" x2={i * 12} y2="96" />)
      }
      return (
        <svg viewBox="0 0 96 96" width="100%" height="100%">
          <rect x="0" y="0" width="96" height="96" fill="currentColor" opacity="0.06" />
          <g stroke="currentColor" strokeWidth="0.9" opacity="0.5">{lines}</g>
        </svg>
      )
    }
    case 'waves':
      return (
        <svg viewBox="0 0 100 40" width="100%" height="100%">
          <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.85">
            {[8, 20, 32].map((y, i) => (
              <path key={i} d={`M2 ${y} q 12 -8 24 0 t 24 0 t 24 0 t 24 0`} />
            ))}
          </g>
        </svg>
      )
    case 'ink': {
      const blobs = [
        'M20 24 q-8 -10 2 -16 q12 -6 16 6 q4 12 -8 16 q-8 2 -10 -6 Z',
        'M60 12 q6 -4 10 2 q3 6 -3 9 q-8 3 -9 -4 Z',
        'M46 44 q-4 -6 3 -9 q7 -2 8 4 q1 7 -6 8 Z',
      ]
      return (
        <svg viewBox="0 0 80 64" width="100%" height="100%">
          <g fill="currentColor" opacity="0.7">
            {blobs.map((d, i) => <path key={i} d={d} />)}
            <circle cx="70" cy="40" r="2.5" /><circle cx="14" cy="50" r="1.8" /><circle cx="52" cy="10" r="1.6" />
          </g>
        </svg>
      )
    }
    case 'swash':
      return (
        <svg viewBox="0 0 100 28" width="100%" height="100%" preserveAspectRatio="none">
          <path d="M2 18 C 20 6, 40 22, 60 12 S 92 6, 98 14 L 98 22 C 80 16, 50 28, 24 22 S 6 26, 2 24 Z"
            fill="currentColor" opacity="0.9" />
        </svg>
      )
    case 'brushline':
      // Trait de pinceau : effilé aux deux bouts, légèrement ondulé, bord bas irrégulier,
      // plus un petit éclat détaché à droite (brosse sèche).
      return (
        <svg viewBox="0 0 120 20" width="100%" height="100%" preserveAspectRatio="none">
          <g fill="currentColor">
            <path d="M3 13 C 26 7, 50 9, 68 8 C 88 7, 104 10, 116 5 C 112 12, 96 14, 68 14 C 44 14, 22 15, 3 13 Z"
              opacity="0.95" />
            <path d="M110 6 C 114 5, 118 6, 119 8 C 116 9, 112 9, 110 8 Z" opacity="0.8" />
          </g>
        </svg>
      )
    case 'blob':
      return (
        <svg viewBox="0 0 100 90" width="100%" height="100%">
          <path d="M52 4 C78 2 98 22 94 46 C90 70 72 88 46 86 C22 84 4 66 6 42 C8 20 26 6 52 4 Z"
            fill="currentColor" opacity="0.9" />
        </svg>
      )
    case 'hatch': {
      const lines = []
      for (let i = -4; i < 12; i++) lines.push(<line key={i} x1={i * 10} y1="80" x2={i * 10 + 40} y2="0" />)
      return (
        <svg viewBox="0 0 80 64" width="100%" height="100%">
          <clipPath id={`${stampId}-clip`}><rect x="0" y="0" width="80" height="64" /></clipPath>
          <g stroke="currentColor" strokeWidth="2.4" opacity="0.7" clipPath={`url(#${stampId}-clip)`}>{lines}</g>
        </svg>
      )
    }
    case 'compass':
      return (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <g stroke="currentColor" fill="none" strokeWidth="1.6" opacity="0.85">
            <circle cx="50" cy="50" r="34" />
            <circle cx="50" cy="50" r="26" strokeDasharray="2 3" />
          </g>
          <path d="M50 12 L58 50 L50 46 L42 50 Z" fill="currentColor" opacity="0.9" />
          <path d="M50 88 L42 50 L50 54 L58 50 Z" fill="currentColor" opacity="0.5" />
          <text x="50" y="9" textAnchor="middle" fontSize="12" fontFamily="Georgia, serif" fill="currentColor" opacity="0.9">N</text>
        </svg>
      )
    case 'arrowN':
      return (
        <svg viewBox="0 0 40 60" width="100%" height="100%">
          <g stroke="currentColor" strokeWidth="2" fill="none" opacity="0.75">
            <line x1="20" y1="56" x2="20" y2="14" />
            <path d="M10 24 L20 6 L30 24" fill="currentColor" />
          </g>
          <text x="20" y="54" textAnchor="middle" fontSize="12" fontFamily="Georgia, serif" fill="currentColor" opacity="0.8">N</text>
        </svg>
      )
    case 'tag':
      return (
        <svg viewBox="0 0 100 24" width="100%" height="100%">
          <rect x="0" y="0" width="100" height="24" rx="2.5" fill="currentColor" opacity="0.92" />
          <text x="50" y="16" textAnchor="middle" fontSize="10"
            textLength="88" lengthAdjust="spacingAndGlyphs"
            fontFamily="'Courier New', Courier, monospace"
            fill="#fdfbf5" opacity="0.96">{text}</text>
        </svg>
      )
    case 'heart':
      return (
        <svg viewBox="0 0 50 45" width="100%" height="100%">
          <path d="M25 42 C 8 28, 2 18, 10 9 C 16 3, 24 6, 25 14 C 26 6, 34 3, 40 9 C 48 18, 42 28, 25 42 Z"
            fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" opacity="0.85" />
        </svg>
      )
    case 'topolines':
      // Courbes de niveau : lignes horizontales douces sur toute la largeur (texture de fond).
      // L'atténuation vient de l'`opacity` de la case décor (gabarit : ~0.14).
      return (
        <svg viewBox="0 0 1123 794" width="100%" height="100%" preserveAspectRatio="none">
          <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M -50 96 C 150 46, 300 136, 500 76 C 700 26, 900 116, 1173 66" />
            <path d="M -50 216 C 200 166, 350 256, 550 196 C 750 146, 950 236, 1173 186" />
            <path d="M -50 336 C 180 286, 330 376, 540 316 C 760 256, 960 346, 1173 296" />
            <path d="M -50 566 C 190 516, 340 606, 560 546 C 770 486, 970 576, 1173 526" />
            <path d="M -50 656 C 210 606, 360 696, 570 636 C 780 576, 980 666, 1173 616" />
            <path d="M -50 736 C 220 686, 370 776, 590 716 C 800 656, 990 746, 1173 696" />
          </g>
        </svg>
      )
    case 'ridge':
      // Ligne de crête stylisée (petit pictogramme montagne au trait).
      return (
        <svg viewBox="0 0 96 34" width="100%" height="100%">
          <path d="M2 30 L22 10 L34 22 L50 4 L66 24 L78 14 L94 30"
            fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

function DecorLayer({ pieces, color, front, uid }: {
  pieces: { p: CoverDecorPiece; i: number }[]; color: string; front: boolean; uid: string
}) {
  if (pieces.length === 0) return null
  return (
    <div className={`albcov-decor-layer${front ? ' albcov-decor-layer--front' : ''}`} aria-hidden="true">
      {pieces.map(({ p, i }) => (
        <div
          key={i}
          className="albcov-decor-piece"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.w}%`,
            height: `${p.h ?? p.w * RATIO[p.kind]}%`,
            color: p.color || color,
            opacity: p.opacity ?? 1,
            transform: p.rotate ? `rotate(${p.rotate}deg)` : undefined,
          }}
        >
          <Shape kind={p.kind} text={p.text} stampId={`${uid}-${i}`} />
        </div>
      ))}
    </div>
  )
}

export function CoverDecor({ pieces, color }: { pieces: CoverDecorPiece[]; color: string }) {
  const uid = useId()
  const indexed = pieces.map((p, i) => ({ p, i }))
  return (
    <>
      <DecorLayer pieces={indexed.filter(x => !x.p.front)} color={color} front={false} uid={uid} />
      <DecorLayer pieces={indexed.filter(x => x.p.front)} color={color} front uid={uid} />
    </>
  )
}
