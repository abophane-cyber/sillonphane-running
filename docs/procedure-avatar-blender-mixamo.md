# Avatar coureur : PNG → Meshy → Blender → Mixamo → GLB

Un PNG est une image plate : Mixamo n'accepte qu'un modèle 3D (FBX/OBJ).
Chemin complet : **PNG → Meshy (image → 3D) → Blender (nettoyage) → Mixamo (squelette + course) → Blender → GLB**

## 1. PNG → modèle 3D (Meshy)
1. Meshy → **Image to 3D** → importer le PNG (pose en T, fond blanc).
2. Activer la texture → générer.
3. Télécharger en **GLB** (pas de rigging dans Meshy : Mixamo s'en charge).

## 2. Préparer le modèle dans Blender
1. Ouvrir Blender → **A** puis **X → Delete** (supprime le cube de départ).
2. **File → Import → glTF 2.0 (.glb)** → fichier Meshy.
3. Orientation : debout, regard vers **−Y**. Touche **1** du pavé numérique = vue de face → on doit voir le visage.
   - Couché ou de dos : **R X 90** ou **R Z 180**, puis Entrée.
4. Taille : **N** → *Dimensions Z* ≈ **1,75 m** (sinon **S** pour ajuster).
5. Pieds sur la grille (Z = 0), centré : *Object → Set Origin → Origin to Geometry*, puis **G Z** pour descendre.
6. **Ctrl+A → All Transforms** (indispensable pour Mixamo).
7. Plusieurs morceaux ? **A** puis **Ctrl+J** (fusionner en un seul objet).
8. Supprimer armature, caméra, lampe éventuelles : il ne doit rester que le maillage.
9. *(Optionnel)* Plus de ~50 000 triangles : modificateur **Decimate** (clé à molette → *Add Modifier → Generate → Decimate*), *Ratio* 0,3–0,5, puis l'appliquer (**Ctrl+A** sur le modificateur).

## 3. Exporter en FBX pour Mixamo
**File → Export → FBX (.fbx)** :
- *Limit to* : **Selected Objects** (personnage sélectionné)
- *Object Types* : **Mesh** uniquement
- *Path Mode* : **Copy** + cliquer l'icône **boîte** à côté (*Embed Textures*)
- *Apply Scalings* : **FBX All**
- *Forward* : **−Z Forward**, *Up* : **Y Up**

→ `coureur1.fbx`

## 4. Mixamo
1. **mixamo.com** (compte Adobe gratuit) → **Upload Character** → le FBX.
2. Personnage de dos ou couché : corriger avec les flèches de rotation → **Next**.
3. Placer les repères : **menton, poignets, coudes, genoux, aine** ; *Skeleton LOD* : **Standard (65)** → **Next**.
4. Chercher **Running** (ou *Jogging*, *Fast Run*) → cocher **In Place** (l'appli déplace le personnage le long de la trace).
5. Ajuster *Overdrive* (vitesse) si besoin.
6. **Download** : **FBX Binary**, **With Skin**, **30 fps**, Keyframe Reduction **none**.
7. Refaire avec une animation **Idle** (départ et arrivée).

## 5. Retour dans Blender → GLB pour l'appli
**Raccourci** : `scripts/mixamo-to-glb.py` fait toute cette étape sans ouvrir Blender (matériau mat, texture
1024 px, ~30 000 faces, Draco) :
`"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python scripts/mixamo-to-glb.py -- "Running.fbx" public/perso/models/coureur1.glb`

À la main :
1. *File → New → General*, supprimer le cube.
2. **File → Import → FBX** → le FBX de course Mixamo.
3. **Barre d'espace** : vérifier que la boucle est propre.
4. **Enlever l'aspect « plastique »** (Meshy sort trop brillant ; Mixamo perd souvent le matériau, d'où ce
   réglage ici et pas avant — ou le recopier depuis le modèle d'origine : sélectionner l'animé, puis le texturé
   en dernier, **Ctrl+L → Link Materials**) :
   - onglet **Shading**, personnage sélectionné (vue en *Material Preview*, sinon **Z → Material Preview**) ;
   - si une 2e image (*metallic-roughness* de Meshy) est branchée sur **Roughness** ou **Metallic**, couper ces
     liens (**Ctrl+clic droit** en glissant à travers), sinon les curseurs restent grisés ;
   - nœud **Principled BSDF** : **Roughness** 0,8–1 · **Metallic** 0 · **Specular → IOR Level** 0,2–0,3 ·
     **Coat → Weight** 0.
   Seuls Roughness, Metallic et Specular passent dans le GLB. *Shade Smooth* ne joue pas : il lisse les facettes.
5. **File → Export → glTF 2.0** :
   - *Format* : **glTF Binary (.glb)**
   - *Include* : **Selected Objects** (armature + maillage sélectionnés)
   - *Animation* : coché, *Sampling Rate* 1
   - *Compression* (Draco) : coché
5. Enregistrer dans `public/perso/models/coureur1.glb`, idem pour `coureur1_idle.glb`.

Ensuite : déclarer le personnage dans `src/lib/characters3d.ts`.

## Problèmes fréquents
| Problème | Solution |
|---|---|
| Mixamo : « unable to map your existing skeleton » | Une armature restait : la supprimer avant l'export FBX |
| Personnage blanc dans Mixamo | *Path Mode* ≠ **Copy** ou *Embed Textures* non coché |
| Personnage minuscule ou géant | **Ctrl+A → All Transforms** avant l'export |
| Bras qui se déforment | Repère poignet/coude mal placé : refaire l'étape 4.3 |
