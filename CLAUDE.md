# Sillonphane-Running — règles de travail

Complète `../CLAUDE.md` (règles communes à tous les projets).

## Le projet

Déclinaison de Sillonphane pour la **course sur route, du 5 km au marathon**. Publication prévue dans
`www/running/` (OVH). Pas encore de code : le moteur de film viendra de `../Sillonphane-Rando`.

Référence visuelle : la vidéo officielle « Parcours du marathon de Lille 2026 » (YouTube, chaîne LHDFA).
Ne jamais reprendre de logo d'épreuve, de commune ou de sponsor sans l'accord de son titulaire.

Noms d'épreuves (souvent des marques de leurs organisateurs) :
- **Nos textes de promotion** (site, démos, réseaux, publicité) : le nom d'une épreuve (« le semi-marathon de
  Lille ») seulement avec **l'accord écrit de son organisateur** ; sans accord, distance · date · ville
  (« 21,1 km · 25 octobre 2026 · Lille »).
- **Films des utilisateurs** : titre personnel tiré du GPX, « Mon semi-marathon à Lille » (modifiable) ; règles
  d'usage (personnel, partage non commercial, commercial) dans les conditions d'utilisation (`public/legal.html`).

## Séparation d'avec les autres déclinaisons

Rando, Running, Cyclo… sont servies depuis le même domaine (sillonphane.fr) : leurs sillons ne doivent jamais se
mélanger. Running a sa propre base IndexedDB (`sillon-running`), ses clés localStorage préfixées `running:`,
son identifiant Android (`app.sillonphane.running`), ses URLs (`/running/downloads/…`, `/running/promo.json`), et
marque ses sauvegardes (`app: 'running'` dans le manifeste) : une sauvegarde d'une autre appli, ou l'ancien format
.json de Rando, est refusée avec un message. Tout est centralisé dans `src/lib/appIdentity.ts`.

Reste à faire :
- **Rando** (`../Sillonphane-Rando`, en ligne) : y ajouter le même contrôle des sauvegardes (refuser celles dont
  `app` ≠ `rando`, donc celles de Running) et le marquage `app: 'rando'` ; mise en ligne au prochain push.
- **Mentions de Rando restées dans l'appli Running** : écran « Comment ça marche » de l'appli (`HowItWorks.tsx`),
  commentaires (`AppLogoIcon`, `RibbonIcon`), sillon d'exemple et photos filigranées `sillonphane.fr/rando`
  (`demoTrip.ts`, `scripts/demo-photos.mjs`), gabarit de couverture (`coverTemplates.ts`), `scripts/record.mjs`,
  prototype `src/proto/`.

## Plan

### Avant la course (parcours de l'épreuve)
- **Cartouche d'épreuve fixe** : nom de l'épreuve · km · commune traversée, à la place des panneaux de
  commune répétés (« LILLE » ×4 sur le semi de Lille).
- **Style « épreuve »** : fond satellite assombri.
- **Ruban** : garder le dégradé crème → orange → vert (`src/lib/ribbon.ts`), signature du site ; ne pas le remplacer
  par une couleur unique.
- **Caméra** : plongée plus forte, plus basse, visée plus courte ; repère coureur toujours visible en tête de ruban.
- **Vitesse** : 100 à 120 s pour un marathon, caméra à hauteur constante.
- **Repères** : bannière de départ, bornes tous les 5 km et au semi, ravitaillements, lieux connus (OpenStreetMap).
- **Fin** : vue d'ensemble avec le profil.

### Après la course (GPX enregistré, heures réelles)
- Détecter les heures fictives (tracé de planification) : masquer alors la date et la météo.
- **Temps de passage** à chaque km, aux bornes et aux points de contrôle : allure moyenne, meilleur et moins bon km,
  comparaison des deux moitiés.
- **Film** : chrono qui tourne, bornes « 10 KM · 52'31" », carton final (temps officiel, dossard, classement saisis
  par l'utilisateur, jamais récupérés automatiquement).
- **Fiche épreuve** : nom, date, heure de départ, points de contrôle, ravitaillements (saisie ou import du roadbook).
- **Affiche de course** (remplace l'album : pas de livre pour une seule course) : une page par course. Écran
  d'édition en 9 sections (01 la course, 02 votre nom, 03 vos performances, 04 vos photos (3 max), 05 éléments à
  afficher | 06 style, 07 fond, 08 couleur du parcours, 09 format & export), réglages de part et d'autre de l'aperçu.
  Quatre modèles : Modèle 1 = 1re photo collée en haut à droite qui se dissout dans le papier, carte presque carrée et
  2e photo ; Modèle 2 = la première affiche, sombre (`src/lib/posterOrigine.ts`) : papier vert nuit, vues aériennes
  assombries, carte et colonne de photos, grand temps, temps de passage, profil ; Modèle 3 = grande photo noir et blanc
  portant le tracé blanc, titre et date à gauche, dossard, temps, distance et nom à droite ; Modèle 4 = la carte
  (`src/lib/posterCarte.ts`) : titre en capitales, date, petite carte de France avec la ville de départ, grande carte
  sombre bordée de papier au tracé lumineux (jaune par défaut), kilomètres écrits le long du parcours, départ et
  arrivée nommés, grand temps, nom, dossard, allure et profil (distance, D+) posés sur le bas de la carte, sans photo.
  3 photos au plus (le Modèle 3 n'en prend qu'une, le Modèle 4 aucune). Fonds : blanc cassé, crème chaud, papier (grain), lin,
  gris clair, vert nuit, noir. Parcours : couleurs du logo, vert · orange · crème, couleur unie choisie à la roue de couleur, ou sans tracé. Chaque élément se
  masque (le classement peut ne pas être flatteur). Formats : A3, A4 et carré (30 × 30 cm), chacun téléchargeable
  pour l'impression (JPEG 300 dpi, sans logo ni marque ; seulement « sillonphane.fr/running » en tout petit dans la
  marge du bas) ou pour les réseaux (1080 px de large, avec le logo et « Sillonphane.fr » en bas, aussi visibles à
  l'aperçu ; encadré d'explication sous l'aperçu) ; phrase « Une course. Des souvenirs. Toujours plus loin. » sur le Modèle 1).
  Maquette : `maquettes/affiche-course.html` (non publiée). Dans l'appli : écran `src/components/AffichePage.tsx`
  (vue « album » de App.tsx), dessin sur canvas `src/lib/poster.ts`, réglages dans `VoyageTrack.poster`. Le code de
  l'album (AlbumPage…) reste dans le dépôt, sans être affiché.
- **Impression de l'affiche** : WhiteWall (tirage, acrylique, aluminium) et Flexilivre (poster), avec code de
  réduction affiché seulement après l'enregistrement (comme pour Rando, `src/lib/printPartners.ts`).

### Plus tard
- **Le livre de Mes sillons** (au lieu de « Mes dossards », abandonné : un seul nom, comme dans les autres applis) :
  livre réunissant les affiches d'une ou plusieurs saisons rangées dans « Mes sillons » de Running, avec les records
  (5 km, 10 km, semi, marathon) et la progression ; annoncé sur l'écran de l'affiche et sur la page d'accueil
  (« Bientôt »). Architecture reprise de Rando (sillon → tracés, couverture/dos, `MultiAlbumExport`,
  `printProfiles`) :
  1. *Fait* — Mes sillons : un sillon = une saison ou un objectif ; miniatures des affiches
     (`lib/posterThumbs.ts`), badge « Affiche faite / à faire », records de la saison et records personnels
     (`lib/records.ts` : temps saisi sur l'affiche, sinon durée du GPX marquée « GPS »).
  2. *Fait* — Écran de l'affiche : l'encadré « Bientôt » devient « Livre » (case « Inclure dans le livre »,
     `VoyageTrack.inBook` ; absent = oui dès que l'affiche existe) et lien vers « Créer le livre ».
  3. *Fait* — Écran « Créer le livre » (`components/LivrePage.tsx`, `lib/book.ts`, vue « livre » de App.tsx),
     bouton en haut de Mes sillons : courses choisies **dans tous les sillons** (filtre par période : années ou
     dates), car une saison ne suffit pas au minimum de pages des imprimeurs (WhiteWall : 28, Flexilivre : 24) ; titre du livre, nom,
     note par course (`VoyageTrack.bookNote`). Une double page par course (affiche | carnet : temps de passage, profil,
     photos, note), double page photos en option ; en tête page de titre, records | progression, palmarès | sommaire
     (5 pages). Compteur « 22 pages sur 28 minimum », export bloqué en dessous.
     Export (`lib/bookExport.ts`, pages dessinées sur canvas à 300 dpi) selon l'imprimeur choisi à l'écran : **WhiteWall**
     (paysage 27,3 × 21,1 cm, fond perdu) = deux PDF, intérieur et couverture à plat (4e | dos | 1re, dos selon le
     nombre de pages) ; **Flexilivre** (A4 paysage, sans fond perdu, photos à distance du bord) = un seul PDF,
     couverture en 1re page et 4e en dernière. Intérieur complété de pages blanches jusqu'au multiple de 4 ; couverture
     vert nuit, tracés des courses au ruban vert · orange · crème ; puis offre d'impression de cet imprimeur.
  4. Retirer le « Bientôt » de l'accueil.
- Comparaison avec un autre coureur ou l'édition précédente (deuxième ruban).
- Offre organisateurs : film officiel du parcours aux couleurs de l'épreuve (logo et sponsors fournis par eux).
