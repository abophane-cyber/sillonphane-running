# mixamo-to-glb.py — Convertit un FBX animé de Mixamo (With Skin, In Place) en GLB pour l'appli :
# matériau mat (réglage anti-plastique), texture réduite, maillage allégé, compression Draco.
# Procédure complète : docs/procedure-avatar-blender-mixamo.md
#
# Usage : "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background
#           --python scripts/mixamo-to-glb.py -- <entrée.fbx> <sortie.glb> [faces] [texture_px] [--clip]
# faces : nombre de faces visé (Decimate), défaut 30 000 ; texture_px : côté max de la texture, défaut 1024.
# --clip : squelette et animation seuls (attente, salut… : l'appli ne lit que l'animation de ces fichiers).
# Le personnage n'occupe que quelques centaines de pixels à l'écran : au-delà, le fichier grossit pour rien.
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
clip_only = "--clip" in argv
argv = [a for a in argv if a != "--clip"]
in_path, out_path = argv[0], argv[1]
target_faces = int(argv[2]) if len(argv) > 2 else 30000
tex_px = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=in_path)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Maillage allégé : Decimate appliqué avant l'export (les poids du squelette suivent).
for m in meshes:
    faces = len(m.data.polygons)
    if faces > target_faces:
        bpy.context.view_layer.objects.active = m
        mod = m.modifiers.new("Decimate", 'DECIMATE')
        mod.ratio = target_faces / faces
        # Le modificateur Armature doit rester après Decimate : on remonte Decimate en tête.
        while m.modifiers[0] != mod:
            bpy.ops.object.modifier_move_up(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)

# Réglage anti-plastique : Meshy sort trop brillant (cf. procédure, étape 5.4).
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    for n in nt.nodes:
        if n.type != 'BSDF_PRINCIPLED':
            continue
        for name in ('Roughness', 'Metallic'):
            for link in list(n.inputs[name].links):
                nt.links.remove(link)
        n.inputs['Roughness'].default_value = 0.9
        n.inputs['Metallic'].default_value = 0.0
        n.inputs['Specular IOR Level'].default_value = 0.25
        n.inputs['Coat Weight'].default_value = 0.0

# Texture réduite.
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > tex_px:
        k = tex_px / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))

for o in bpy.data.objects:
    o.select_set(o.type == 'ARMATURE' if clip_only else o.type in ('MESH', 'ARMATURE'))

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_frame_step=1,
    export_image_format='JPEG',
    export_jpeg_quality=85,
    export_draco_mesh_compression_enable=True,
)
print("OK", out_path)
