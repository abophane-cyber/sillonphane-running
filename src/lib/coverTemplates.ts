import type { CoverTemplateId, CoverTheme, CoverOverrides } from '../types'

/**
 * Définition des 12 gabarits de page couverture — données pures (aucun état, aucun JSX),
 * sérialisables en JSON. Un gabarit décrit UN plan de composition et ses valeurs par défaut ;
 * l'utilisateur repersonnalise ensuite chaque élément via `ComposedAlbumPage.cover`.
 *
 * Le schéma complet (champs, unités, vocabulaire) est documenté dans
 * `src/lib/coverTemplates.schema.md`. En résumé :
 *   - toutes les positions/tailles sont en % du PLAN DE COMPOSITION ;
 *   - `size` d'un texte = % de la largeur du plan (rendu ≈ `size * 1.5cqw`) ;
 *   - `board` fixe la proportion L/H du plan (absent = plein cadre de la couverture).
 */

export type CoverAlign = 'left' | 'center' | 'right' | 'justify'

/** Rectangle de base : position (coin haut-gauche) et largeur en %. `h` optionnel. */
export interface Rect {
  x: number
  y: number
  w: number
  h?: number
}

/** Motifs décoratifs dessinés en SVG inline (voir src/components/CoverDecor.tsx). */
export type CoverDecorKind =
  | 'washi'      // ruban adhésif
  | 'clip'       // trombone
  | 'binderclip' // pince double
  | 'stamp'      // cachet circulaire ; `text` courbé, ou centré si multi-lignes
  | 'sprig'      // branche botanique au trait
  | 'dots'       // trame de points
  | 'grid'       // patch quadrillé
  | 'waves'      // vaguelettes
  | 'ink'        // taches / éclaboussures d'encre
  | 'swash'      // coup de pinceau (souligné épais)
  | 'brushline'  // trait de pinceau effilé aux deux bouts (souligné de titre)
  | 'blob'       // forme organique pleine
  | 'hatch'      // hachures diagonales
  | 'compass'    // rose des vents
  | 'arrowN'     // flèche Nord
  | 'tag'        // étiquette pleine avec texte (ruban / onglet latéral)
  | 'heart'      // petit cœur dessiné à la main
  | 'hr'         // trait / rectangle plein (filet de séparation, panneau de fond…)
  | 'dashframe'  // cadre au trait pointillé (liseré autour d'une carte / d'un panneau)
  | 'gridpaper'  // feuille quadrillée (papier millimétré) — fond blanc + grille
  | 'framerect'  // cadre rectangulaire au trait plein
  | 'circle'     // cercle au trait plein
  | 'topolines'  // courbes de niveau topographiques (texture de fond pleine largeur)
  | 'ridge'      // ligne de crête / montagne stylisée (petit pictogramme)

export interface CoverDecorPiece {
  kind: CoverDecorKind
  x: number
  y: number
  w: number            // largeur en % ; la hauteur suit le ratio du motif (sauf si `h` est donné)
  h?: number           // hauteur en % — force la hauteur (utile pour `hr` / `tag`)
  rotate?: number      // degrés
  color?: string       // surcharge locale ; sinon `colors.decor` du gabarit
  text?: string        // kind 'stamp' / 'tag' ; jeton `{dates}` = reprend la ligne de dates
  opacity?: number
  /** Rend le motif AU-DESSUS de la carte et des photos (ex. tampon posé sur la photo). */
  front?: boolean
}

/** Élément de texte (eyebrow / title / dates / body). */
export interface CoverTextEl extends Rect {
  align: CoverAlign
  size: number          // taille = % de la largeur du plan (rendu ≈ size * 1.5cqw)
  uppercase?: boolean
  italic?: boolean
  weight?: number       // graisse CSS (400, 700…)
  lineHeight?: number
  tracking?: number     // letter-spacing en em
  rotate?: number       // inclinaison par défaut en degrés
  rule?: boolean        // filet fin sous le texte
  box?: string          // pastille de fond derrière le texte (ex. bloc kraft) — couleur CSS
  hidden?: boolean      // masqué par défaut (l'utilisateur peut le réafficher)
}

/** Emplacement de la carte du tracé (ou d'une photo qui la remplace). */
export interface CoverMapEl extends Rect {
  rotate: number
  frame: 'card' | 'strip' | 'plain'   // marge blanche « photo », bande fine, ou aucun cadre
  /** Ratio largeur/hauteur figé (via CSS `aspect-ratio`) — la carte garde cette proportion
   * quel que soit le format de la couverture ; `h` sert de repli si `ar` est absent. */
  ar?: number
  /** Carte masquée par défaut (gabarits de dos : pas de carte du tracé) — réaffichable via
   * la surcharge `cover.el.map.hidden`. */
  hidden?: boolean
}

/** Emplacement suggéré pour une photo ajoutée par l'utilisateur (case libre `kind:'photo'`). */
export interface CoverPhotoSlot extends Rect {
  rotate: number
}

/** Décoration « de départ » d'un gabarit : matérialisée en case libre `kind:'decor'` dans
 * `page.boxes` quand on applique le gabarit — donc immédiatement déplaçable / redimensionnable /
 * pivotable / supprimable par l'utilisateur (contrairement à `decor[]` qui est du mobilier fixe). */
export interface CoverDecorSeed {
  decorType: CoverDecorKind
  x: number
  y: number
  w: number
  h?: number
  rotate?: number
  color?: string          // hex ou jeton `@nom`
  text?: string
  zIndex: number
}

export interface CoverTemplateDef {
  id: CoverTemplateId
  label: string
  /** Proportion Largeur/Hauteur du plan de composition d'origine de la maquette. Le plan est
   * rendu centré à cette proportion et ajusté dans la couverture ; le fond comble autour (même
   * couleur = raccord invisible). Absent = le plan remplit toute la couverture. */
  board?: number
  background: string
  fonts: { title: string; dates: string; body: string; eyebrow?: string }
  colors: { title: string; dates: string; body: string; decor: string; eyebrow?: string }
  elements: {
    /** Sur-titre (petit label au-dessus du titre) — présent seulement si le gabarit le prévoit. */
    eyebrow?: CoverTextEl
    title: CoverTextEl
    dates: CoverTextEl
    /** Bloc de texte libre — absent de certains gabarits (ex. « Carnet scrapbook »). */
    body?: CoverTextEl
    map: CoverMapEl
  }
  /** Palette de couleurs par défaut du gabarit. Les valeurs de `background`, `colors.*`,
   * `elements.*.color` et `decor.*.color` peuvent être un hex OU un jeton `@nom` résolu ici
   * (ou par la palette choisie par l'utilisateur, `cover.palette`). Absent = pas de jetons. */
  theme?: CoverTheme
  /** Textes de démonstration propres à ce gabarit (sinon COVER_PLACEHOLDER générique). */
  placeholders?: Partial<Record<'eyebrow' | 'title' | 'dates' | 'body', string>>
  photoSlots: CoverPhotoSlot[]
  /** Mobilier FIXE du gabarit (fond, panneaux, filets, labels d'ambiance) — non manipulable. */
  decor: CoverDecorPiece[]
  /** Décors MANIPULABLES fournis avec le gabarit (scotch, tampon…) — deviennent des cases libres. */
  decorSeeds?: CoverDecorSeed[]
}

// Rétro-compat : anciens noms de types (utilisés ailleurs dans le code).
export type CoverTextLayout = CoverTextEl
export type CoverMapLayout = CoverMapEl

/** Palettes prêtes à l'emploi — l'utilisateur en choisit une via `cover.palette` ; elle
 * remplace le `theme` du gabarit sans toucher à sa structure. */
export const COVER_PALETTES: { id: string; label: string; theme: CoverTheme }[] = [
  {
    id: 'beige', label: 'Beige',
    theme: { background: '#ede7d8', paper: '#f8f6ef', primary: '#58789b', text: '#20231f',
      labelAdventure: '#40566c', labelNature: '#7e8d70', labelLiberty: '#b27b5e' },
  },
  {
    id: 'sauge', label: 'Sauge',
    theme: { background: '#e7ebe0', paper: '#f6f8f1', primary: '#6f8f6a', text: '#2e352a',
      labelAdventure: '#4b5f43', labelNature: '#7f8f6e', labelLiberty: '#a9835c' },
  },
  {
    id: 'bleu', label: 'Bleu gris',
    theme: { background: '#e6e9ee', paper: '#f7f8fa', primary: '#4b6788', text: '#1f2733',
      labelAdventure: '#3a5573', labelNature: '#6b8f8a', labelLiberty: '#a9744f' },
  },
  {
    id: 'terracotta', label: 'Terracotta',
    theme: { background: '#efe4dc', paper: '#faf3ee', primary: '#b5623f', text: '#3a2a22',
      labelAdventure: '#8a4b33', labelNature: '#7f8f6e', labelLiberty: '#c07a3c' },
  },
  {
    id: 'neutre', label: 'Neutre',
    theme: { background: '#f0efec', paper: '#fbfbf9', primary: '#6a6a63', text: '#2a2a26',
      labelAdventure: '#4a4a44', labelNature: '#6a6a63', labelLiberty: '#8a8a80' },
  },
]

const PALETTE_BY_ID = new Map(COVER_PALETTES.map(p => [p.id, p.theme]))

/** Thème effectif d'une couverture : palette choisie par l'utilisateur, sinon thème du gabarit,
 * sinon une palette de repli (pour que tout jeton `@nom` résolve toujours). */
export function coverTheme(tpl: CoverTemplateDef, cover: CoverOverrides | undefined): CoverTheme {
  return (cover?.palette && PALETTE_BY_ID.get(cover.palette)) || tpl.theme || COVER_PALETTES[0].theme
}

/** Résout une valeur de couleur : `@nom` → jeton du thème ; sinon renvoie la valeur telle quelle. */
export function themeColor(value: string | undefined, theme: CoverTheme): string | undefined {
  if (!value) return value
  return value.startsWith('@') ? (theme[value.slice(1) as keyof CoverTheme] ?? value) : value
}

// Piles de polices — valeurs alignées sur src/lib/textStyles.ts (TEXT_FONTS).
const F_MARKER = "'Permanent Marker', 'Comic Sans MS', cursive"
const F_SCRIPT = "'Caveat', 'Segoe Script', cursive"
const F_SERIF = "'Playfair Display', Georgia, serif"
const F_SERIF_PLAIN = "Georgia, 'Times New Roman', serif"
const F_SANS = "'Trebuchet MS', 'Segoe UI', sans-serif"
// Newsreader (italique) — self-hosted, cf. src/App.css @font-face. Repli serif si indisponible.
const F_NEWSREADER = "'Newsreader', 'Playfair Display', Georgia, serif"

/** Textes de démonstration affichés tant que l'utilisateur n'a rien saisi. */
export const COVER_PLACEHOLDER = {
  eyebrow: 'CARNET DE VOYAGE',
  title: 'Titre',
  dates: 'du 5 au 29 juillet 2026',
  body: "De source sûre,\nune belle aventure\nau fil de l'eau,\ndes paysages\net des rencontres.",
}

export const DEFAULT_COVER_TEMPLATE: CoverTemplateId = 'scrapbook'

export const COVER_TEMPLATES: CoverTemplateDef[] = [
  {
    id: 'epure',
    label: 'Épuré contemporain',
    board: 1.6,
    background: '#f4f1e9',
    fonts: { title: F_SANS, dates: F_SANS, body: F_SANS, eyebrow: F_SANS },
    colors: { title: '#20251f', dates: '#20251f', body: '#20251f', decor: '#506b91', eyebrow: '#7a8665' },
    elements: {
      eyebrow: { x: 6.3, y: 11, w: 40, align: 'left', size: 0.92, uppercase: true, tracking: 0.23 },
      title: { x: 6.3, y: 15, w: 50, align: 'left', size: 3.4, weight: 700, lineHeight: 0.95 },
      dates: { x: 6.3, y: 39, w: 34, align: 'left', size: 0.92, uppercase: true, tracking: 0.14 },
      body: { x: 6.3, y: 47, w: 30, align: 'left', size: 1.05, lineHeight: 1.6 },
      map: { x: 45, y: 9, w: 47.5, ar: 0.95, rotate: 1, frame: 'card' },
    },
    photoSlots: [
      { x: 29, y: 62, w: 21, h: 25, rotate: -5 },
      { x: 41, y: 70, w: 21, h: 25, rotate: 4 },
    ],
    decor: [
      { kind: 'hr', x: 6.3, y: 35, w: 11.5, color: '#506b91' },
      { kind: 'stamp', x: 88, y: 80, w: 7, front: true, text: 'LOIRE\n2026', color: '#68745c' },
    ],
  },
  {
    id: 'carnet',
    label: 'Carnet de route',
    background: '#efe9dc',
    fonts: { title: F_SCRIPT, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#23201b', dates: '#5c5a4f', body: '#3a382f', decor: '#7d8a9a' },
    elements: {
      title: { x: 5, y: 6, w: 45, align: 'left', size: 3.6, lineHeight: 0.95 },
      dates: { x: 60, y: 6, w: 32, align: 'left', size: 1.0 },
      body: { x: 5, y: 34, w: 32, align: 'left', size: 1.0, lineHeight: 1.5 },
      map: { x: 44, y: 16, w: 52, h: 64, rotate: 1, frame: 'card' },
    },
    photoSlots: [
      { x: 6, y: 62, w: 30, h: 30, rotate: -3 },
      { x: 28, y: 66, w: 30, h: 28, rotate: 4 },
    ],
    decor: [
      { kind: 'clip', x: 56, y: 1, w: 8, rotate: 8 },
      { kind: 'stamp', x: 60, y: 74, w: 16, text: 'AVENTURE NATURE LIBERTÉ' },
      { kind: 'waves', x: 4, y: 64, w: 14 },
    ],
  },
  {
    id: 'nature',
    label: 'Nature & illustration',
    background: '#e7ebe0',
    fonts: { title: F_SANS, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#3c4a38', dates: '#5b6455', body: '#44503f', decor: '#7f8f6e' },
    elements: {
      title: { x: 6, y: 8, w: 44, align: 'left', size: 2.6, uppercase: true, weight: 700, lineHeight: 1.05, tracking: 0.02 },
      dates: { x: 6, y: 26, w: 40, align: 'left', size: 0.95 },
      body: { x: 6, y: 38, w: 30, align: 'left', size: 1.0, lineHeight: 1.5, hidden: true },
      map: { x: 44, y: 10, w: 52, h: 58, rotate: 2, frame: 'card' },
    },
    photoSlots: [{ x: 8, y: 60, w: 30, h: 30, rotate: -2 }],
    decor: [
      { kind: 'sprig', x: 1, y: 42, w: 40, rotate: 0 },
      { kind: 'ink', x: 78, y: 4, w: 10 },
      { kind: 'stamp', x: 82, y: 6, w: 15, text: "IL EST DE L'EAU" },
      { kind: 'waves', x: 4, y: 82, w: 16 },
    ],
  },
  {
    id: 'moderne',
    label: 'Moderne graphique',
    background: '#f4f2ee',
    fonts: { title: F_SERIF, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#1f2430', dates: '#5c5f66', body: '#3c3f45', decor: '#5b6f9c' },
    elements: {
      title: { x: 8, y: 30, w: 40, align: 'left', size: 2.7, weight: 700, lineHeight: 1.05 },
      dates: { x: 8, y: 47, w: 32, align: 'left', size: 0.9 },
      body: { x: 8, y: 56, w: 30, align: 'left', size: 0.95, lineHeight: 1.5 },
      map: { x: 46, y: 12, w: 50, h: 72, rotate: 2, frame: 'card' },
    },
    photoSlots: [{ x: 10, y: 66, w: 28, h: 26, rotate: 0 }],
    decor: [
      { kind: 'blob', x: -4, y: -6, w: 24, color: '#5b6f9c' },
      { kind: 'blob', x: -3, y: 70, w: 26, color: '#d8c3a5' },
      { kind: 'ink', x: 82, y: 2, w: 12, color: '#1f2430' },
      { kind: 'swash', x: 8, y: 44, w: 18, color: '#5b6f9c' },
      { kind: 'dots', x: 40, y: 56, w: 12 },
      { kind: 'arrowN', x: 40, y: 82, w: 7 },
    ],
  },
  {
    id: 'minimal',
    label: 'Minimaliste élégant',
    background: '#efece4',
    fonts: { title: F_SERIF, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#2a2a26', dates: '#6a685f', body: '#413f38', decor: '#9aa48c' },
    elements: {
      title: { x: 8, y: 12, w: 44, align: 'left', size: 2.2, uppercase: true, weight: 400, lineHeight: 1.15, tracking: 0.08 },
      dates: { x: 8, y: 34, w: 34, align: 'left', size: 0.9 },
      body: { x: 8, y: 58, w: 30, align: 'left', size: 1.0, lineHeight: 1.55 },
      map: { x: 46, y: 14, w: 48, h: 66, rotate: 1, frame: 'card' },
    },
    photoSlots: [{ x: 10, y: 74, w: 26, h: 22, rotate: -2 }],
    decor: [
      { kind: 'sprig', x: 8, y: 42, w: 14, rotate: 0 },
      { kind: 'stamp', x: 58, y: 74, w: 18, text: 'CARNET DE VOYAGE' },
    ],
  },
  {
    // Composition A4 paysage (ratio 1.4142857). Coordonnées en % de la page — validées avec
    // l'utilisateur : composition éditoriale asymétrique, fort espace négatif, carte comme
    // élément visuel majeur, photo en chevauchement, scotch + tampon indépendants.
    id: 'libre',
    label: 'Libre & créatif',
    board: 1.4142857,
    // Couleurs via jetons de thème → l'utilisateur peut changer de palette sans toucher au reste.
    theme: {
      background: '#ede7d8', paper: '#f8f6ef', primary: '#58789b', text: '#20231f',
      labelAdventure: '#40566c', labelNature: '#7e8d70', labelLiberty: '#b27b5e',
    },
    background: '@background',
    // Titre au pinceau (Permanent Marker si dispo localement, sinon repli brush/cursive).
    fonts: { title: F_MARKER, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '@text', dates: '@text', body: '@text', decor: '@primary' },
    placeholders: { title: 'Titre' },
    elements: {
      title: { x: 7, y: 14, w: 36, align: 'left', size: 2.4, lineHeight: 1.0 },
      dates: { x: 7.5, y: 37.5, w: 26, align: 'left', size: 0.62, uppercase: true, tracking: 0.17 },
      body: { x: 7.5, y: 66, w: 21, align: 'left', size: 0.66, lineHeight: 1.45 },
      // Carte avec son propre cadre blanc « photo » (marge + ombre). Une photo qui la remplace
      // hérite de ce cadre. Redimensionnable à la souris dans l'éditeur.
      map: { x: 43, y: 16, w: 42, h: 45, rotate: -1, frame: 'card' },
    },
    photoSlots: [
      // Petite photo souvenir posée sur la page (hauteur réduite ~−18 %).
      { x: 38, y: 53, w: 15.5, h: 18, rotate: -5 },
    ],
    // Mobilier fixe (calque du fond, non manipulable) : taches de peinture terracotta
    // (blob + éclaboussures d'encre). Le souligné du titre n'est plus fourni d'office —
    // l'utilisateur l'ajoute avec la brosse « Souligné pinceau » (ADDABLE_DECOR).
    decor: [
      { kind: 'blob', x: -4, y: 33, w: 46, h: 50, rotate: -4, color: '@labelLiberty', opacity: 0.85 },
      { kind: 'blob', x: 80, y: 1, w: 16, h: 16, rotate: 18, color: '@labelLiberty', opacity: 0.8 },
      { kind: 'ink', x: 86, y: 7, w: 10, h: 8, color: '@text', opacity: 0.6 },
    ],
    // Décors MANIPULABLES fournis (deviennent des cases libres — couleur / taille / position
    // éditables, calque sous les textes pour ce gabarit) :
    //  · panneau : le « cadre » crème sur la tache, derrière les dates + le texte ;
    //  · scotch quadrillé marron, tampon rond terracotta, 3 étiquettes, petit cœur.
    decorSeeds: [
      { decorType: 'hr', x: 4.5, y: 34, w: 30, h: 48, rotate: -1, color: '@paper', zIndex: 18 },
      { decorType: 'gridpaper', x: 60, y: 10, w: 8, h: 7, rotate: 8, color: '#8a6a52', zIndex: 46 },
      { decorType: 'stamp', x: 76, y: 50, w: 11, h: 18, rotate: 12, text: 'AVENTURE\nNATURE\nLIBERTÉ', color: '@labelLiberty', zIndex: 55 },
      { decorType: 'tag', x: 84, y: 64, w: 9, h: 3, text: 'AVENTURE', color: '@labelAdventure', zIndex: 48 },
      { decorType: 'tag', x: 84, y: 68.5, w: 9, h: 3, text: 'NATURE', color: '@labelNature', zIndex: 48 },
      { decorType: 'tag', x: 84, y: 73, w: 9, h: 3, text: 'LIBERTÉ', color: '@labelLiberty', zIndex: 48 },
      { decorType: 'heart', x: 29, y: 80, w: 5, h: 4.5, rotate: -6, color: '@labelLiberty', zIndex: 50 },
    ],
  },
  {
    id: 'scandinave',
    label: 'Scandinave épuré',
    background: '#f4f1ea',
    fonts: { title: F_SANS, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#22252b', dates: '#5c5f66', body: '#3c3f45', decor: '#8a9a7b' },
    elements: {
      title: { x: 6, y: 7, w: 44, align: 'left', size: 2.5, uppercase: true, weight: 700, lineHeight: 1.05, tracking: 0.02 },
      dates: { x: 6, y: 26, w: 34, align: 'left', size: 0.9 },
      body: { x: 6, y: 39, w: 28, align: 'left', size: 0.95, lineHeight: 1.55 },
      map: { x: 48, y: 6, w: 46, h: 52, rotate: 2, frame: 'card' },
    },
    photoSlots: [
      { x: 18, y: 58, w: 34, h: 30, rotate: -4 },
      { x: 42, y: 62, w: 34, h: 30, rotate: 4 },
    ],
    decor: [
      { kind: 'swash', x: 6, y: 21, w: 16, color: '#8a9a7b' },
      { kind: 'washi', x: 44, y: 3, w: 13, rotate: -20 },
      { kind: 'sprig', x: 4, y: 70, w: 12, rotate: 0 },
      { kind: 'dots', x: 32, y: 44, w: 9 },
    ],
  },
  {
    id: 'souvenirs',
    label: 'Souvenirs de voyage',
    background: '#efe7d6',
    fonts: { title: F_SCRIPT, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#211c14', dates: '#4a4032', body: '#3a3428', decor: '#a08c6a' },
    elements: {
      title: { x: 10, y: 10, w: 34, align: 'left', size: 3.0, lineHeight: 0.95 },
      dates: { x: 10, y: 30, w: 24, align: 'left', size: 0.9 },
      body: { x: 6, y: 46, w: 30, align: 'left', size: 0.95, lineHeight: 1.5 },
      map: { x: 44, y: 6, w: 52, h: 50, rotate: 2, frame: 'card' },
    },
    photoSlots: [
      { x: 24, y: 58, w: 32, h: 32, rotate: -4 },
      { x: 46, y: 62, w: 32, h: 32, rotate: 5 },
    ],
    decor: [
      { kind: 'clip', x: 16, y: 2, w: 8, rotate: -6 },
      { kind: 'washi', x: 6, y: 6, w: 12, rotate: 12 },
      { kind: 'ink', x: 12, y: 42, w: 6 },
      { kind: 'stamp', x: 84, y: 64, w: 15, text: 'CARNET DE VOYAGE' },
      { kind: 'sprig', x: 86, y: 16, w: 12, rotate: 20 },
    ],
  },
  {
    id: 'atelier',
    label: 'Atelier graphique',
    background: '#f1efe9',
    fonts: { title: F_SANS, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#23262c', dates: '#5c5f66', body: '#3c3f45', decor: '#6f8f6a' },
    elements: {
      title: { x: 14, y: 8, w: 40, align: 'left', size: 2.7, uppercase: true, weight: 700, lineHeight: 1.05 },
      dates: { x: 8, y: 34, w: 24, align: 'left', size: 0.9 },
      body: { x: 8, y: 46, w: 28, align: 'left', size: 0.95, lineHeight: 1.5 },
      map: { x: 46, y: 6, w: 50, h: 52, rotate: 3, frame: 'card' },
    },
    photoSlots: [{ x: 30, y: 58, w: 28, h: 32, rotate: 0 }],
    decor: [
      { kind: 'blob', x: 68, y: 28, w: 36, color: '#6f8f6a' },
      { kind: 'blob', x: -2, y: 46, w: 16, color: '#9bb08c' },
      { kind: 'swash', x: 14, y: 24, w: 18, color: '#6f8f6a' },
      { kind: 'ink', x: 3, y: 3, w: 12, color: '#23262c' },
      { kind: 'hatch', x: 82, y: 70, w: 16 },
      { kind: 'grid', x: 86, y: 1, w: 13 },
    ],
  },
  {
    id: 'horizon',
    label: "Ligne d'horizon",
    background: '#f4f1ea',
    fonts: { title: F_SCRIPT, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#b0552f', dates: '#b0552f', body: '#3c3f45', decor: '#c07a3c' },
    elements: {
      title: { x: 56, y: 6, w: 40, align: 'left', size: 3.0, lineHeight: 0.95 },
      dates: { x: 60, y: 24, w: 28, align: 'left', size: 0.9 },
      body: { x: 58, y: 36, w: 36, align: 'left', size: 0.9, lineHeight: 1.5 },
      map: { x: 2, y: 70, w: 96, h: 26, rotate: 0, frame: 'strip' },
    },
    photoSlots: [
      { x: 2, y: 2, w: 52, h: 42, rotate: 0 },
      { x: 8, y: 34, w: 24, h: 26, rotate: -3 },
      { x: 28, y: 38, w: 24, h: 26, rotate: 3 },
    ],
    decor: [
      { kind: 'compass', x: 84, y: 2, w: 13 },
      { kind: 'waves', x: 2, y: 62, w: 14 },
      { kind: 'sprig', x: 50, y: 40, w: 10, rotate: 30 },
    ],
  },
  {
    id: 'carnetmin',
    label: 'Carnet minimal',
    background: '#f3f0e8',
    fonts: { title: F_SERIF, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#26251f', dates: '#6a685f', body: '#413f38', decor: '#8a8574' },
    elements: {
      title: { x: 6, y: 16, w: 30, align: 'left', size: 1.9, uppercase: true, weight: 400, lineHeight: 1.2, tracking: 0.06 },
      dates: { x: 6, y: 36, w: 24, align: 'left', size: 0.85 },
      body: { x: 6, y: 52, w: 26, align: 'left', size: 0.95, lineHeight: 1.55 },
      map: { x: 34, y: 6, w: 46, h: 74, rotate: 1, frame: 'card' },
    },
    photoSlots: [
      { x: 76, y: 16, w: 22, h: 26, rotate: 3 },
      { x: 78, y: 46, w: 22, h: 26, rotate: -3 },
    ],
    decor: [
      { kind: 'binderclip', x: 50, y: 1, w: 9 },
      { kind: 'sprig', x: 6, y: 74, w: 12, rotate: 0 },
      { kind: 'grid', x: 60, y: 82, w: 16 },
    ],
  },
  {
    id: 'formes',
    label: 'Couleurs & formes',
    background: '#f2efe8',
    fonts: { title: F_SCRIPT, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '#1e2a44', dates: '#5c5f66', body: '#3c3f45', decor: '#c65a3c' },
    elements: {
      title: { x: 8, y: 8, w: 40, align: 'left', size: 3.2, lineHeight: 0.95 },
      dates: { x: 8, y: 32, w: 22, align: 'left', size: 0.9 },
      body: { x: 8, y: 46, w: 26, align: 'left', size: 0.95, lineHeight: 1.5 },
      map: { x: 44, y: 8, w: 50, h: 60, rotate: 3, frame: 'card' },
    },
    photoSlots: [
      { x: 24, y: 58, w: 32, h: 32, rotate: -4 },
      { x: 48, y: 64, w: 32, h: 32, rotate: 5 },
    ],
    decor: [
      { kind: 'blob', x: -4, y: 56, w: 24, color: '#c65a3c' },
      { kind: 'blob', x: 28, y: 70, w: 26, color: '#1e2a44' },
      { kind: 'blob', x: 78, y: 50, w: 24, color: '#5b7fb0' },
      { kind: 'dots', x: 84, y: 16, w: 14, color: '#c8a06a' },
      { kind: 'washi', x: 58, y: 1, w: 14, rotate: -16 },
      { kind: 'swash', x: 8, y: 30, w: 18, color: '#5b7fb0' },
      { kind: 'stamp', x: 84, y: 6, w: 15, text: 'AVENTURE NATURE LIBERTÉ' },
    ],
  },
  {
    // Le tout premier modèle de couverture (carnet de scrapbooking) — porté à l'identique depuis
    // la mise en page FIGÉE d'origine de GitHub (commit 285f59c : ancien AlbumCover.tsx +
    // App.css « .albcov-* »). Toutes les valeurs ci-dessous reprennent 1:1 les règles CSS
    // d'alors, exprimées en % de « .albcov-inner ». Ce plan (= l'ancien .albcov-inner, 92 × 88 %
    // de la feuille, centré) est reconstitué par la règle « .albcov--tpl-scrapbook .albcov-inner ».
    id: 'scrapbook',
    label: 'Carnet scrapbook',
    background: '#d8cebe',                                                 // .asp2-a4--cover
    fonts: { title: F_MARKER, dates: F_SCRIPT, body: F_SERIF_PLAIN },      // Permanent Marker / Caveat
    colors: { title: '#111111', dates: '#333333', body: '#40403a', decor: '#e08b8b' },
    elements: {
      // .albcov-title { top 6%; left 12%; width 75%; text-align center; rotate -2; line-height .88;
      //   letter-spacing 2px; text-shadow 2px 2px 0 #fff (ajouté en CSS) }
      title: { x: 19, y: 6, w: 62, align: 'center', size: 4.7, uppercase: true, weight: 900, lineHeight: 0.88, tracking: 0.025, rotate: -2 },
      // Dates et Texte retirés de ce modèle (plus d'items « Dates » / « Texte » dans l'éditeur non plus).
      dates: { x: 60, y: 85, w: 30, align: 'center', size: 1.6, box: '#fcf8e3', rotate: -1.5, hidden: true },
      // .albcov-photo--main { top 14%; right 6% (→ left 32%); width 62%; height 68%; rotate 2 }
      map: { x: 32, y: 14, w: 62, h: 68, rotate: 2, frame: 'card' },
    },
    photoSlots: [
      { x: 7, y: 40, w: 26, h: 32, rotate: -6 },   // .albcov-photo--sub1 { bottom 28%; left 7%; 26×32% }
      { x: 9, y: 58, w: 28, h: 34, rotate: 3 },    // .albcov-photo--sub2 { bottom 8%;  left 9%; 28×34% }
    ],
    decor: [
      { kind: 'hr', x: 0, y: 0, w: 100, h: 100, color: '#fdfbf7' },                       // fond crème (.albcov-inner background)
      { kind: 'dashframe', x: 0, y: 0, w: 100, h: 100, color: '#e08b8b' },                // liseré pointillé rose (.albcov-inner border)
      { kind: 'gridpaper', x: 2, y: 2, w: 42, h: 88, rotate: -1, color: '#e1e1e1' },      // feuille quadrillée (.albcov-grid-paper)
      { kind: 'washi', x: 85, y: 9, w: 11, rotate: 35, color: '#ffffff', opacity: 0.65 },  // ruban au coin de la carte (.albcov-tape)
    ],
  },
]

// ── Gabarits de DOS (4e de couverture) ────────────────────────────────────
// Même forme que les gabarits de couverture, mais SANS éléments de texte structurés : titre,
// dates et carte du tracé sont `hidden` d'office. Le dos se compose au fond + palette + décor +
// cases libres, et se gabarise exactement comme la couverture (voir BACK_COVER_TEMPLATE_PICKER
// et lib/backCoverUserTemplates.ts pour la bibliothèque perso, distincte de celle de la couv').
const BACK_HIDDEN_TEXT: CoverTextEl = { x: 0, y: 0, w: 0, align: 'left', size: 1, hidden: true }
const BACK_HIDDEN_MAP: CoverMapEl = { x: 0, y: 0, w: 0, rotate: 0, frame: 'plain', hidden: true }
const BACK_THEME: CoverTheme = COVER_PALETTES[0].theme

export const BACK_COVER_TEMPLATES: CoverTemplateDef[] = [
  {
    id: 'dos-uni',
    label: 'Dos — uni',
    theme: BACK_THEME,
    background: '@background',
    fonts: { title: F_SANS, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '@text', dates: '@text', body: '@text', decor: '@primary' },
    elements: { title: BACK_HIDDEN_TEXT, dates: BACK_HIDDEN_TEXT, map: BACK_HIDDEN_MAP },
    photoSlots: [{ x: 30, y: 33, w: 40, h: 40, rotate: 0 }],
    decor: [],
  },
  {
    id: 'dos-photo',
    label: 'Dos — grande photo',
    theme: BACK_THEME,
    background: '@background',
    fonts: { title: F_SANS, dates: F_SANS, body: F_SERIF_PLAIN },
    colors: { title: '@text', dates: '@text', body: '@text', decor: '@primary' },
    elements: { title: BACK_HIDDEN_TEXT, dates: BACK_HIDDEN_TEXT, map: BACK_HIDDEN_MAP },
    photoSlots: [
      { x: 12, y: 12, w: 76, h: 62, rotate: 0 },
      { x: 20, y: 40, w: 30, h: 34, rotate: -4 },
    ],
    decor: [],
    decorSeeds: [
      { decorType: 'stamp', x: 77, y: 76, w: 13, h: 20, rotate: -8, text: 'AVENTURE\nNATURE\nLIBERTÉ', color: '@primary', zIndex: 50 },
    ],
  },
  {
    // Porté du gabarit HTML « dos-album-template » : fond crème, courbes de niveau très pâles
    // pleine page, colonne centrée (crête stylisée · mot-repère · filet · titre · accroche) et
    // pied de page centré. Newsreader italique → rendu ici en Playfair Display italique (déjà
    // embarquée). Accent « vert mousse » ; variantes terre / ardoise / ocre via la palette.
    id: 'dos-topo',
    label: 'Dos — topographie',
    theme: {
      background: '#f6f1e9', paper: '#fbf8f2', primary: '#52695b', text: '#2b2723',
      labelAdventure: '#3e5c76', labelNature: '#52695b', labelLiberty: '#8a6d3d',
    },
    background: '@background',
    fonts: { title: F_NEWSREADER, dates: F_SANS, body: F_NEWSREADER, eyebrow: F_SANS },
    colors: { title: '@text', dates: '@text', body: '@text', decor: '@primary', eyebrow: '@primary' },
    placeholders: {
      eyebrow: 'Sillonphane · Rando',
      title: 'En remontant\nla Loire',
      body: "Cinq jours à pied au fil de l'eau, des paysages et des rencontres.",
      dates: 'sillonphane.fr/rando · Loire, juillet 2026',
    },
    elements: {
      eyebrow: { x: 15, y: 29.5, w: 70, align: 'center', size: 0.86, uppercase: true, tracking: 0.28 },
      title: { x: 12, y: 36, w: 76, align: 'center', size: 3.3, italic: true, weight: 500, lineHeight: 1.15 },
      body: { x: 27, y: 59, w: 46, align: 'center', size: 1.05, italic: true, lineHeight: 1.6 },
      dates: { x: 12, y: 90, w: 76, align: 'center', size: 0.62, tracking: 0.06 },
      map: BACK_HIDDEN_MAP,
    },
    photoSlots: [],
    decor: [
      { kind: 'topolines', x: 0, y: 0, w: 100, h: 100, color: '@primary', opacity: 0.14 },
      { kind: 'hr', x: 46, y: 34, w: 8, h: 0.35, color: '@primary', opacity: 0.5 },
    ],
    decorSeeds: [
      { decorType: 'ridge', x: 45.5, y: 22, w: 9, h: 3.2, color: '@primary', zIndex: 40 },
    ],
  },
  {
    id: 'dos-carnet',
    label: 'Dos — carnet',
    background: '#d8cebe',
    fonts: { title: F_MARKER, dates: F_SCRIPT, body: F_SERIF_PLAIN },
    colors: { title: '#111111', dates: '#333333', body: '#40403a', decor: '#e08b8b' },
    elements: { title: BACK_HIDDEN_TEXT, dates: BACK_HIDDEN_TEXT, map: BACK_HIDDEN_MAP },
    photoSlots: [
      { x: 13, y: 15, w: 40, h: 44, rotate: -4 },
      { x: 46, y: 40, w: 40, h: 44, rotate: 5 },
    ],
    decor: [
      { kind: 'hr', x: 0, y: 0, w: 100, h: 100, color: '#fdfbf7' },
      { kind: 'dashframe', x: 0, y: 0, w: 100, h: 100, color: '#e08b8b' },
      { kind: 'gridpaper', x: 56, y: 8, w: 42, h: 88, rotate: 1, color: '#e1e1e1' },
    ],
    decorSeeds: [
      { decorType: 'washi', x: 8, y: 6, w: 12, h: 5, rotate: 12, color: '#ffffff', zIndex: 60 },
    ],
  },
]

export const DEFAULT_BACK_COVER_TEMPLATE: CoverTemplateId = 'dos-uni'

/** Gabarits de dos proposés dans le sélecteur de l'éditeur (panneau de droite, côté « dos »). */
export const BACK_COVER_TEMPLATE_PICKER: CoverTemplateDef[] = BACK_COVER_TEMPLATES

const BY_ID = new Map([...COVER_TEMPLATES, ...BACK_COVER_TEMPLATES].map(t => [t.id, t]))

/** Gabarits proposés dans le sélecteur de l'éditeur. Pour l'instant on n'en montre qu'un
 * (« Carnet scrapbook ») ; les autres définitions restent dans COVER_TEMPLATES pour que les
 * couvertures déjà enregistrées avec un autre gabarit continuent de s'afficher. Pour tout
 * réafficher : `export const COVER_TEMPLATE_PICKER = COVER_TEMPLATES`. */
export const COVER_TEMPLATE_PICKER: CoverTemplateDef[] = COVER_TEMPLATES.filter(t => t.id === 'scrapbook')

/** Retourne la définition d'un gabarit, avec repli sur le gabarit par défaut. */
export function coverTemplate(id: CoverTemplateId | undefined): CoverTemplateDef {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_COVER_TEMPLATE)!
}
