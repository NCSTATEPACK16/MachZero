"""
Shared helpers for MachZero's headless Blender asset scripts (Blender 5.2 LTS).

Conventions (IMPLEMENTATION §M2.1):
- Deterministic: no unseeded randomness. Metric, 1 BU = 1 m.
- Nose along Blender +Y, up +Z. The glTF exporter turns that into Y-up with the nose at -Z (v1's ship frame).
- No textures. Materials are named by role and replaced at runtime by graphics/ShipAssembly:
  livery_primary, livery_secondary, glow, metal, glass, dark.
- COLOR_0 carries body coordinates for the runtime decal shader: R = along the ship (0 tail .. 1 nose),
  G = across (0 left .. 1 right), B = up (0 bottom .. 1 top), A = 1.
- Sockets are empties named socket_*.
- §V: ships also carry TEXCOORD_0 into the shared trim sheet (blender/textures/build_trim.py; strips in
  TRIM_BANDS) and large-scale ambient occlusion baked per vertex into COLOR_0.a (bake_vertex_ao). Helpers take an
  optional `strip`; without one a mesh gets no UVs (parts and props until V2/V3).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROLES = {
    # role: (base colour, metallic, roughness, emission strength)
    "livery_primary": ((0.1, 0.35, 1.0, 1.0), 0.6, 0.3, 0.0),
    "livery_secondary": ((0.9, 0.92, 1.0, 1.0), 0.5, 0.35, 0.0),
    "glow": ((0.1, 0.95, 1.0, 1.0), 0.0, 0.5, 4.0),
    "metal": ((0.55, 0.58, 0.65, 1.0), 1.0, 0.25, 0.0),
    "glass": ((0.05, 0.08, 0.12, 1.0), 0.2, 0.05, 0.0),
    "dark": ((0.03, 0.035, 0.05, 1.0), 0.4, 0.6, 0.0),
}


# Trim sheet strips, bottom (v = 0) to top; keep in sync with blender/textures/build_trim.py BANDS.
# "flat" sits at the top of the image, where glTF/three UV (0, 0) lands, so a mesh without UVs samples neutral detail.
TRIM_BANDS = ["panel", "plate", "carbon", "brushed", "vent", "ribbed", "grip", "flat"]
TRIM_INSET = 0.04  # keep a strip's UVs off its edges so mipmaps don't bleed into the next strip


def trim_v(strip, f):
    """Atlas v (Blender UV space) for position f in 0..1 across `strip`."""
    b = TRIM_BANDS.index(strip)
    f = min(1.0, max(0.0, f))
    return (b + TRIM_INSET + (1 - 2 * TRIM_INSET) * f) / len(TRIM_BANDS)


def args_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def arg_value(name, default=None):
    a = args_after_dashes()
    if name in a:
        i = a.index(name)
        if i + 1 < len(a):
            return a[i + 1]
    return default


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def material(role):
    """One shared material per role (looked up by name, created on first use)."""
    mat = bpy.data.materials.get(role)
    if mat is not None:
        return mat
    base, metallic, rough, emit = ROLES[role]
    mat = bpy.data.materials.new(role)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit > 0:
        bsdf.inputs["Emission Color"].default_value = base
        bsdf.inputs["Emission Strength"].default_value = emit
    return mat


class MeshBuilder:
    """Accumulates bmesh geometry with per-face material roles, then becomes one object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.roles = []  # material slot order
        self.uv = None  # created on the first face with a strip

    def slot(self, role):
        if role not in self.roles:
            self.roles.append(role)
        return self.roles.index(role)

    def add_faces(self, verts, faces, role, strip=None, uvs=None):
        """verts: list of (x, y, z); faces: list of index tuples into verts.
        strip: trim-sheet strip; uvs: per face, per corner (u, f) with u tiling freely and f in 0..1 across the strip.
        A strip without uvs gets a box projection (u along the face's longest in-plane axis, f = 0.5)."""
        bm = self.bm
        vs = [bm.verts.new(v) for v in verts]
        idx = self.slot(role)
        if strip is not None and self.uv is None:
            self.uv = bm.loops.layers.uv.verify()
        for k, f in enumerate(faces):
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue  # degenerate/duplicate face
            face.material_index = idx
            face.smooth = True
            if strip is None:
                continue
            corners = uvs[k] if uvs is not None else box_uvs([verts[i] for i in f])
            for loop, (u, fv) in zip(face.loops, corners):
                loop[self.uv].uv = (u, trim_v(strip, fv))

    def finish(self, bounds, collection=None):
        """Create the object. `bounds` = (min Vector, max Vector) of the ship body for COLOR_0."""
        bm = self.bm
        if self.uv is not None:  # faces without a strip sample the neutral strip
            flat = trim_v("flat", 0.5)
            for face in bm.faces:
                for loop in face.loops:
                    if loop[self.uv].uv[1] == 0.0 and loop[self.uv].uv[0] == 0.0:
                        loop[self.uv].uv = (0.0, flat)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for role in self.roles:
            mesh.materials.append(material(role))
        lo, hi = bounds
        size = hi - lo
        attr = mesh.color_attributes.new(name="COLOR_0", type="FLOAT_COLOR", domain="POINT")
        for i, v in enumerate(mesh.vertices):
            p = v.co
            attr.data[i].color = (
                min(1.0, max(0.0, (p.y - lo.y) / size.y)),
                min(1.0, max(0.0, (p.x - lo.x) / size.x)),
                min(1.0, max(0.0, (p.z - lo.z) / size.z)),
                1.0,
            )
        # Smooth shading with a crisp edge limit (Blender 5 replaces auto-smooth with this operator).
        obj = bpy.data.objects.new(self.name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
        return obj


U_PER_M = 0.5  # trim tiles per metre along u (a 1024 px tile spans 2 m)


def box_uvs(pts):
    """Fallback UVs for one face: u along the dominant in-plane axis (metres x U_PER_M), f = 0.5."""
    a = Vector(pts[0])
    n = Vector((0.0, 0.0, 0.0))
    for i in range(1, len(pts) - 1):
        n += (Vector(pts[i]) - a).cross(Vector(pts[i + 1]) - a)
    ax = max(range(3), key=lambda i: abs(n[i]))
    k = 1 if ax != 1 else 0  # prefer y (along the ship) unless the face looks along y
    return [(p[k] * U_PER_M, 0.5) for p in pts]


def superellipse_ring(cx, cz, hw, hh, y, segments, power):
    """Ring of points in the XZ plane at depth y (Blender: +Y = nose)."""
    e = 2.0 / power
    pts = []
    for j in range(segments):
        a = (j / segments) * math.tau
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + hw * math.copysign(abs(c) ** e, c), y, cz + hh * math.copysign(abs(s) ** e, s)))
    return pts


def loft(mb, sections, segments, power, role, cap_start=True, cap_end=True, strip=None, panels=4):
    """sections: list of (y, cx, cz, hw, hh) from tail to nose. Adds a closed lofted tube.
    With a strip, u runs along the tube (metres) and the circumference is split into `panels` panels, each
    spanning the strip once (so a panel strip's edge seams become panel lines running along the tube)."""
    verts = []
    faces = []
    uvs = []
    per = max(1, segments // max(1, panels))
    for (y, cx, cz, hw, hh) in sections:
        verts.extend(superellipse_ring(cx, cz, max(hw, 1e-4), max(hh, 1e-4), y, segments, power))
    n = len(sections)
    for i in range(n - 1):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            c = (i + 1) * segments + (j + 1) % segments
            d = (i + 1) * segments + j
            faces.append((a, b, c, d))
            u0 = sections[i][0] * U_PER_M
            u1 = sections[i + 1][0] * U_PER_M
            f0 = (j % per) / per
            f1 = f0 + 1.0 / per
            uvs.append([(u0, f0), (u0, f1), (u1, f1), (u1, f0)])
    if cap_start:
        verts.append((sections[0][1], sections[0][0], sections[0][2]))
        ci = len(verts) - 1
        for j in range(segments):
            faces.append((ci, (j + 1) % segments, j))
            u = sections[0][0] * U_PER_M
            uvs.append([(u, 0.5), (u + 0.02, 0.5), (u - 0.02, 0.5)])
    if cap_end:
        base = (n - 1) * segments
        verts.append((sections[-1][1], sections[-1][0], sections[-1][2]))
        ci = len(verts) - 1
        for j in range(segments):
            faces.append((ci, base + j, base + (j + 1) % segments))
            u = sections[-1][0] * U_PER_M
            uvs.append([(u, 0.5), (u - 0.02, 0.5), (u + 0.02, 0.5)])
    mb.add_faces(verts, faces, role, strip, uvs if strip else None)


def slab(mb, outline, z0, z1, role, strip=None, edge_strip=None):
    """Extrude a convex-ish XY outline (list of (x, y), counter-clockwise from above) between heights z0..z1.
    With a strip: top and bottom run u along y, f across x; the sides (edge_strip, default the same) run u along
    the edge and f up the thickness."""
    n = len(outline)
    verts = [(x, y, z0) for (x, y) in outline] + [(x, y, z1) for (x, y) in outline]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    if strip is None:
        mb.add_faces(verts, faces, role)
        return
    xs = [p[0] for p in outline]
    x0, x1 = min(xs), max(xs)
    fx = lambda x: (x - x0) / max(x1 - x0, 1e-6)  # noqa: E731
    caps = [[(outline[i][1] * U_PER_M, fx(outline[i][0])) for i in f if True] for f in ([i for i in range(n - 1, -1, -1)], list(range(n)))]
    mb.add_faces(verts, faces[:2], role, strip, caps)
    side_uvs = []
    run = 0.0
    for i in range(n):
        j = (i + 1) % n
        seg = math.dist(outline[i], outline[j])
        a, b = run * U_PER_M, (run + seg) * U_PER_M
        side_uvs.append([(a, 0.0), (b, 0.0), (b, 1.0), (a, 1.0)])
        run += seg
    side_verts_faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    mb.add_faces(verts, side_verts_faces, role, edge_strip or strip, side_uvs)


def fin(mb, root, tip_up, chord_root, chord_tip, sweep, thickness, role, x=0.0, cant=0.0, strip=None, y=0.0):
    """A vertical fin: root chord along Y at height `root`, tip `tip_up` higher, swept back by `sweep`.
    `y` moves the fin along the ship. With a strip: u along y, f up the span."""
    t = thickness / 2
    # profile in the (y, z) plane, then offset in x (with cant = lean outwards in radians)
    prof = [(chord_root / 2, root), (-chord_root / 2, root), (-chord_tip / 2 - sweep, root + tip_up), (chord_tip / 2 - sweep, root + tip_up)]
    verts = []
    for side in (-t, t):
        for (py, z) in prof:
            h = z - root
            verts.append((x + side + math.sin(cant) * h, py + y, z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    uvs = None
    if strip is not None:
        uvs = [[(verts[i][1] * U_PER_M, (verts[i][2] - root) / max(tip_up, 1e-6)) for i in f] for f in faces]
    mb.add_faces(verts, faces, role, strip, uvs)


def torus_ring(mb, cx, cy, cz, radius, tube, segments, sides, role, axis="Y", strip=None):
    """A ring (nozzle glow / collar) around an axis through (cx, cy, cz). With a strip: u around the ring
    (metres), f around the tube."""
    verts = []
    faces = []
    uvs = []
    circ = math.tau * radius * U_PER_M
    for i in range(segments):
        a = i / segments * math.tau
        for j in range(sides):
            b = j / sides * math.tau
            r = radius + tube * math.cos(b)
            u, w = r * math.cos(a), r * math.sin(a)
            d = tube * math.sin(b)
            if axis == "Y":
                verts.append((cx + u, cy + d, cz + w))
            else:
                verts.append((cx + d, cy + u, cz + w))
    for i in range(segments):
        for j in range(sides):
            a = i * sides + j
            b = ((i + 1) % segments) * sides + j
            c = ((i + 1) % segments) * sides + (j + 1) % sides
            d = i * sides + (j + 1) % sides
            faces.append((a, b, c, d))
            u0, u1 = circ * i / segments, circ * (i + 1) / segments
            f0, f1 = j / sides, (j + 1) / sides
            uvs.append([(u0, f0), (u1, f0), (u1, f1), (u0, f1)])
    mb.add_faces(verts, faces, role, strip, uvs if strip else None)


def disc(mb, cx, cy, cz, radius, segments, role, facing=-1, strip=None):
    """A flat disc in the XZ plane at depth cy, facing -Y (tail) by default. With a strip it samples the
    middle of the strip (glow cores use "flat")."""
    verts = [(cx, cy, cz)] + [(cx + radius * math.cos(a), cy, cz + radius * math.sin(a)) for a in (i / segments * math.tau for i in range(segments))]
    faces = []
    for i in range(segments):
        a, b = 1 + i, 1 + (i + 1) % segments
        faces.append((0, b, a) if facing < 0 else (0, a, b))
    uvs = [[(0.0, 0.5), (0.01, 0.5), (0.02, 0.5)] for _ in faces] if strip else None
    mb.add_faces(verts, faces, role, strip, uvs)


def bake_vertex_ao(objects, samples=96, distance=0.6):
    """Bake Cycles ambient occlusion per vertex into COLOR_0.a of each object (each LOD on its own: the other
    objects are hidden from the bake). distance: metres an occluder still counts."""
    scene = bpy.context.scene
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:  # pragma: no cover - engine names come from the error
        raise RuntimeError(f"Cycles is needed for the AO bake: {e}")
    scene.cycles.samples = samples
    scene.cycles.device = "CPU"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake")
    scene.world.light_settings.distance = distance
    for obj in objects:
        for o in objects:
            o.hide_render = o is not obj
        mesh = obj.data
        ao = mesh.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
        mesh.color_attributes.active_color = ao
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        col = mesh.color_attributes["COLOR_0"]
        for i in range(len(mesh.vertices)):
            r, g, b, _ = col.data[i].color
            col.data[i].color = (r, g, b, ao.data[i].color[0])
        mesh.color_attributes.remove(mesh.color_attributes["AO"])
        mesh.color_attributes.active_color = mesh.color_attributes["COLOR_0"]
        mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
    for o in objects:
        o.hide_render = False


def socket(name, location, parent=None, collection=None, rotation=(0.0, 0.0, 0.0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.2
    e.location = location
    e.rotation_euler = rotation
    (collection or bpy.context.scene.collection).objects.link(e)
    if parent is not None:
        e.parent = parent
    return e


def triangle_count(obj):
    mesh = obj.data
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def export_glb(path, objects, texcoords=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_normals=True,
        export_texcoords=texcoords,
        export_extras=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
