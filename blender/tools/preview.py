"""
Render a quick Workbench preview of GLBs (3/4 view) for review. Not part of the asset build.

  Blender -b --factory-startup -P blender/tools/preview.py -- --out sheet.png a.glb b.glb ...
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402

COLORS = {
    "livery_primary": (0.12, 0.42, 1.0, 1),
    "livery_secondary": (0.92, 0.94, 1.0, 1),
    "glow": (0.1, 1.0, 1.0, 1),
    "metal": (0.6, 0.62, 0.7, 1),
    "glass": (0.05, 0.08, 0.14, 1),
    "dark": (0.05, 0.05, 0.07, 1),
}


def main():
    args = C.args_after_dashes()
    out = C.arg_value("--out", "preview.png")
    files = [a for a in args if a.endswith(".glb")]
    only_lod0 = "--lod0" in args
    C.reset_scene()
    cols = min(3, len(files))
    rows = math.ceil(len(files) / cols)
    spacing = 6.0
    for i, f in enumerate(files):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f)
        new = [o for o in bpy.data.objects if o not in before]
        roots = [o for o in new if o.parent is None]
        for o in new:
            if only_lod0 and o.type == "MESH" and "_LOD1" in o.name:
                o.hide_render = True
        for r in roots:
            r.location = Vector(((i % cols) * spacing, -(i // cols) * spacing, 0))
    for m in bpy.data.materials:
        m.diffuse_color = COLORS.get(m.name.split(".")[0], (0.8, 0.2, 0.8, 1))
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 520 * cols
    scene.render.resolution_y = 420 * rows
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cx = (cols - 1) * spacing / 2
    cy = -(rows - 1) * spacing / 2
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(cols * spacing, rows * spacing * 1.25) * 1.02
    cam.location = Vector((cx + 14, cy - 14, 11))
    direction = Vector((cx, cy, 0)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.abspath(out)
    bpy.ops.render.render(write_still=True)
    print(f"[preview] {out}")


main()
