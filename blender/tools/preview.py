"""
Render a quick Workbench preview of GLBs (3/4 view) for review. Not part of the asset build.

  Blender -b --factory-startup -P blender/tools/preview.py -- --out sheet.png a.glb b.glb ...
  Blender -b --factory-startup -P blender/tools/preview.py -- --out parts.png --parts public/game/parts/parts.glb

--parts lays out every root node of the GLB(s) in a grid, one row per slot and one column per tier (the
parts sheet for a PR body); parts are shown 2.5x larger than ships.
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
    if "--parts" in args:
        for f in files:
            bpy.ops.import_scene.gltf(filepath=f)
        roots = sorted((o for o in bpy.data.objects if o.parent is None), key=lambda o: o.name)
        slots = sorted({r.name.split("_t")[0] for r in roots}, key=lambda s: ["engine", "booster", "stabilizer", "hull"].index(s) if s in ("engine", "booster", "stabilizer", "hull") else 9)
        cols, rows, spacing = 4, len(slots), 2.6
        for r in roots:
            slot, tier = r.name.split("_t")[0], int(r.name.split("_t")[1][0])
            r.location = Vector((tier * spacing, -slots.index(slot) * spacing, 0))
            r.rotation_euler = (0, 0, math.radians(180))
        files = []
    else:
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
    scene.render.resolution_x = 520 * cols if spacing > 3 else 300 * cols
    scene.render.resolution_y = 420 * rows if spacing > 3 else 230 * rows
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cx = (cols - 1) * spacing / 2
    cy = -(rows - 1) * spacing / 2
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(cols * spacing, rows * spacing * 1.25) * 1.02
    if spacing > 3:
        cam.location = Vector((cx + 14, cy - 14, 11))
    else:  # parts sheet: from behind-right and above, rows level across the image
        cam.data.ortho_scale = cols * spacing * 1.08
        cam.location = Vector((cx + 3, cy - 12, 8))
    direction = Vector((cx, cy, 0)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.abspath(out)
    bpy.ops.render.render(write_still=True)
    print(f"[preview] {out}")


main()
