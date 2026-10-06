# Schéma d'un gabarit de page couverture

Un gabarit est un objet de données pur (sérialisable JSON) qui décrit **un plan de
composition** et ses valeurs par défaut. Les 12 gabarits vivent dans
[`coverTemplates.ts`](./coverTemplates.ts) (`COVER_TEMPLATES`), typés par `CoverTemplateDef`.

L'utilisateur repersonnalise ensuite chaque élément via `ComposedAlbumPage.cover`
(surcharges par élément) ; le gabarit ne fournit que le point de départ.

---

## Repère et unités

- **Plan de composition** : le rectangle dans lequel tout est positionné.
  - `board` = sa proportion **Largeur / Hauteur**. Le plan est rendu centré à cette
    proportion et ajusté dans la couverture réelle ; le fond de la couverture comble
    autour (même couleur ⇒ raccord invisible).
  - `board` **absent** ⇒ le plan remplit toute la couverture (proportions de l'album).
  - Exemple : `1.6` (maquette 1600×1000, paysage) ; `0.82` (portrait) ; `1` (carré).
- **Toutes** les positions et tailles sont en **% du plan** :
  - `x`, `y` = coin haut‑gauche ; `w` = largeur ; `h` = hauteur (optionnelle).
  - Les valeurs peuvent déborder (`x` négatif, `x + w > 100`) : c'est volontaire pour un
    élément qui « sort » du cadre (blob, onglet…).
- **`rotate`** : degrés (horaire).
- **Couleurs** : n'importe quelle valeur CSS (`#rrggbb` de préférence).
- **Polices** : une pile de familles CSS. Utiliser de préférence les 5 constantes du
  fichier (`F_SANS`, `F_SERIF`, `F_SERIF_PLAIN`, `F_SCRIPT` = Caveat auto‑hébergée).

---

## Structure

```jsonc
{
  "id": "epure",                 // identifiant (CoverTemplateId) — l'un des 12
  "label": "Épuré contemporain", // nom affiché dans le sélecteur

  "board": 1.6,                  // optionnel — proportion L/H du plan

  "background": "#f4f1e9",       // couleur de fond du plan

  "fonts": {                     // piles de polices par élément
    "title": "…", "dates": "…", "body": "…",
    "eyebrow": "…"               // optionnel
  },

  "colors": {                    // couleurs par élément
    "title": "#20251f", "dates": "#20251f", "body": "#20251f",
    "eyebrow": "#7a8665",        // optionnel
    "decor": "#506b91"           // couleur par défaut de TOUTES les décorations
  },

  "elements": {                  // les 4 (ou 5) éléments fixes du plan
    "eyebrow": { … },            // optionnel — sur‑titre au‑dessus du titre
    "title":   { … },
    "dates":   { … },
    "body":    { … },
    "map":     { … }             // la carte du tracé (ou une photo qui la remplace)
  },

  "photoSlots": [ … ],           // emplacements suggérés pour les photos ajoutées

  "decor": [ … ]                 // décorations dessinées (SVG)
}
```

---

## `elements.{eyebrow|title|dates|body}` — élément de texte (`CoverTextEl`)

| champ        | type                                   | requis | rôle |
|--------------|----------------------------------------|:-----:|------|
| `x` `y` `w`  | number (%)                             |  ✅   | position et largeur du bloc |
| `align`      | `left \| center \| right \| justify`   |  ✅   | alignement du texte |
| `size`       | number                                 |  ✅   | **taille = % de la largeur du plan** (rendu ≈ `size × 1.5cqw`). Ex. `3.4` ≈ gros titre, `0.9` ≈ petite ligne |
| `uppercase`  | boolean                                |       | forcer les capitales |
| `italic`     | boolean                                |       | italique |
| `weight`     | number                                 |       | graisse CSS (`400`, `700`…) ; défaut `400` |
| `lineHeight` | number                                 |       | interligne ; défaut `1.2` |
| `tracking`   | number                                 |       | inter‑lettrage en `em` (ex. `0.14`) |
| `rotate`     | number                                 |       | inclinaison par défaut |
| `rule`       | boolean                                |       | filet fin **sous** le texte |
| `box`        | string (couleur CSS)                   |       | pastille de fond derrière le texte (ex. bloc kraft) |
| `hidden`     | boolean                                |       | masqué par défaut (l'utilisateur peut le réafficher) |

> `eyebrow` n'est présent que si le gabarit le déclare (dans `elements` **et**
> éventuellement `fonts.eyebrow` / `colors.eyebrow`). Un gabarit sans `eyebrow` n'affiche
> pas de section « Sur‑titre » dans l'éditeur.

---

## `elements.map` — la carte (`CoverMapEl`)

| champ        | type                          | requis | rôle |
|--------------|-------------------------------|:-----:|------|
| `x` `y` `w`  | number (%)                    |  ✅   | position et largeur |
| `rotate`     | number                        |  ✅   | inclinaison |
| `frame`      | `card \| strip \| plain`      |  ✅   | `card` = marge blanche « photo » + ombre ; `strip` = bande blanche fine ; `plain` = aucun cadre |
| `ar`         | number                        |       | ratio **L/H figé** de la carte (via CSS `aspect-ratio`) — elle garde cette proportion quel que soit le format de la couverture |
| `h`          | number (%)                    |       | hauteur explicite — **repli** si `ar` est absent |

> Fournir **soit `ar`** (recommandé, stable), **soit `h`**.

---

## `photoSlots[]` — emplacements photo (`CoverPhotoSlot`)

Positions suggérées quand l'utilisateur ajoute des photos (bouton « + Photo »). Chaque
entrée : `{ "x", "y", "w", "h", "rotate" }` (tous en %, `rotate` en degrés). Elles sont
utilisées dans l'ordre ; au‑delà, on boucle sur la liste.

---

## `decor[]` — décorations (`CoverDecorPiece`)

Motifs dessinés en SVG inline (aucun asset). Chaque entrée :

| champ     | type                | requis | rôle |
|-----------|---------------------|:-----:|------|
| `kind`    | voir la liste       |  ✅   | type de motif |
| `x` `y` `w` | number (%)        |  ✅   | position et largeur ; la **hauteur suit le ratio propre du motif** |
| `h`       | number (%)          |       | **force** la hauteur (utile pour `hr` = filet fin ou grand panneau, et `tag`) |
| `rotate`  | number              |       | inclinaison |
| `color`   | string              |       | surcharge locale ; sinon `colors.decor` |
| `text`    | string              |       | pour `stamp` / `tag` ; le jeton `{dates}` est remplacé par la ligne de dates |
| `opacity` | number (0–1)        |       | opacité |
| `front`   | boolean             |       | dessine le motif **au‑dessus** de la carte et des photos (tampon posé sur la photo) |

### Valeurs de `kind`

| `kind`       | motif |
|--------------|-------|
| `washi`      | ruban adhésif |
| `clip`       | trombone |
| `binderclip` | pince double |
| `stamp`      | cachet circulaire — `text` courbé, ou **centré** si `text` contient un `\n` |
| `sprig`      | branche botanique au trait |
| `dots`       | trame de points |
| `grid`       | patch quadrillé |
| `waves`      | vaguelettes (mettre `rotate: 90` pour un filet vertical) |
| `ink`        | taches / éclaboussures d'encre |
| `swash`      | coup de pinceau (souligné épais) |
| `blob`       | forme organique pleine |
| `hatch`      | hachures diagonales |
| `compass`    | rose des vents |
| `arrowN`     | flèche Nord |
| `tag`        | étiquette pleine avec `text` (ruban / onglet ; `rotate: 90` = onglet latéral) |
| `heart`      | petit cœur au trait |
| `hr`         | rectangle plein — filet fin de séparation, ou (avec un grand `h`) panneau de fond coloré |
| `dashframe`  | cadre au trait pointillé (liseré autour d'un panneau / d'une carte) — donner `h` |
| `gridpaper`  | feuille quadrillée (fond blanc + grille) — donner `h` |

---

## Exemple complet — « Épuré contemporain »

```jsonc
{
  "id": "epure",
  "label": "Épuré contemporain",
  "board": 1.6,
  "background": "#f4f1e9",
  "fonts":  { "title": "…sans", "dates": "…sans", "body": "…sans", "eyebrow": "…sans" },
  "colors": { "title": "#20251f", "dates": "#20251f", "body": "#20251f",
              "eyebrow": "#7a8665", "decor": "#506b91" },
  "elements": {
    "eyebrow": { "x": 6.3, "y": 11, "w": 40, "align": "left", "size": 0.92, "uppercase": true, "tracking": 0.23 },
    "title":   { "x": 6.3, "y": 15, "w": 50, "align": "left", "size": 3.4, "weight": 700, "lineHeight": 0.95 },
    "dates":   { "x": 6.3, "y": 39, "w": 34, "align": "left", "size": 0.92, "uppercase": true, "tracking": 0.14 },
    "body":    { "x": 6.3, "y": 47, "w": 30, "align": "left", "size": 1.05, "lineHeight": 1.6 },
    "map":     { "x": 45, "y": 9, "w": 47.5, "ar": 0.95, "rotate": 1, "frame": "card" }
  },
  "photoSlots": [
    { "x": 29, "y": 62, "w": 21, "h": 25, "rotate": -5 },
    { "x": 41, "y": 70, "w": 21, "h": 25, "rotate": 4 }
  ],
  "decor": [
    { "kind": "hr",    "x": 6.3, "y": 35, "w": 11.5, "color": "#506b91" },
    { "kind": "stamp", "x": 88, "y": 80, "w": 7, "front": true, "text": "LOIRE\n2026", "color": "#68745c" }
  ]
}
```

---

## Convertir un HTML/CSS de maquette

1. Repérer le plan (`.tX { width; height }`) → `board = width / height`.
2. Chaque `left/top/width` en px → `x = left / width_plan * 100`, etc.
   (`right` / `bottom` : convertir en `left` / `top`.)
3. `font-size` en px → `size = fontSize_px / width_plan * 100 / 1.5`.
4. `letter-spacing` px → `tracking = ls_px / fontSize_px`.
5. Une `<img class="photo">` avec `border: Npx solid white` → entrée `photoSlots` (le cadre
   blanc est ajouté automatiquement par `frame: "card"` côté carte, et par le rendu
   polaroïd côté photos).
6. Un badge / cercle / ruban → une entrée `decor` (`stamp`, `tag`, `hr`, `washi`…).
