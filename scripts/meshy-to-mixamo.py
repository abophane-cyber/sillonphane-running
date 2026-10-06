# meshy-to-mixamo.py — Prépare un personnage Meshy en T-pose (OBJ ou GLB) pour l'auto-rig de Mixamo :
# maillage allégé, debout à l'origine, texture réduite à 2048 px et intégrée, export FBX (maillage seul).
# Procédure complète : docs/personnage-meshy-mixamo.md
#
# Usage : "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background
#           --python scripts/meshy-to-mixamo.py -- <entrée.obj|.glb> <sortie.fbx> [ratio]
# ratio : part des faces gardées (Decimate). Viser ~50 000 faces : 0,15 pour la randonneuse (GLB),
# 0,03 pour l'enfant (OBJ de 1,77 million de faces). Défaut : calculé pour ~50 000 faces.
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
in_path, out_path = argv[0], argv[1]
TARGET_FACES = 50000

bpy.ops.wm.read_factory_settings(use_empty=True)
if in_path.lower().endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=in_path)  # la texture est retrouvée via le .mtl voisin
else:
    bpy.ops.import_scene.gltf(filepath=in_path)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
# Le GLB importé peut avoir un parent vide : on l'en détache en gardant la position.
if mesh.parent:
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

faces = len(mesh.data.polygons)
ratio = float(argv[2]) if len(argv) > 2 else min(1.0, TARGET_FACES / faces)
print(f"Faces avant : {faces} (ratio {ratio:.3f})")
if ratio < 1:
    mod = mesh.modifiers.new(name="Decimate", type='DECIMATE')
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"Faces après : {len(mesh.data.polygons)}")

# Texture réduite à 2048 px (Meshy livre du 4096, inutile pour Mixamo et lourd à téléverser).
for img in bpy.data.images:
    if img.size[0] > 2048:
        img.scale(2048, 2048)
    img.pack()
    print("Texture", img.name, tuple(img.size))

# Pieds au sol (z = 0), centré en x/y : Mixamo attend le personnage debout à l'origine.
xs = [v.co.x for v in mesh.data.vertices]; ys = [v.co.y for v in mesh.data.vertices]; zs = [v.co.z for v in mesh.data.vertices]
mesh.location = (-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
print(f"Hauteur : {max(zs) - min(zs):.3f} ; envergure (bras) : {max(xs) - min(xs):.3f}")

bpy.ops.export_scene.fbx(
    filepath=out_path, use_selection=False, apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL',
    axis_forward='-Z', axis_up='Y', global_scale=1.0, bake_space_transform=True,
    object_types={'MESH'}, mesh_smooth_type='FACE', add_leaf_bones=False,
    path_mode='COPY', embed_textures=True,
)
print("=== EXPORTÉ ===", out_path, os.path.getsize(out_path) // 1024, "Ko")
