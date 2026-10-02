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

    def slot(self, role):
        if role not in self.roles:
            self.roles.append(role)
        return self.roles.index(role)

    def add_faces(self, verts, faces, role):
        """verts: list of (x, y, z); faces: list of index tuples into verts."""
        bm = self.bm
        vs = [bm.verts.new(v) for v in verts]
        idx = self.slot(role)
        for f in faces:
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue  # degenerate/duplicate face
            face.material_index = idx
            face.smooth = True

    def finish(self, bounds, collection=None):
        """Create the object. `bounds` = (min Vector, max Vector) of the ship body for COLOR_0."""
        bm = self.bm
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


def superellipse_ring(cx, cz, hw, hh, y, segments, power):
    """Ring of points in the XZ plane at depth y (Blender: +Y = nose)."""
    e = 2.0 / power
    pts = []
    for j in range(segments):
        a = (j / segments) * math.tau
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + hw * math.copysign(abs(c) ** e, c), y, cz + hh * math.copysign(abs(s) ** e, s)))
    return pts


def loft(mb, sections, segments, power, role, cap_start=True, cap_end=True):
    """sections: list of (y, cx, cz, hw, hh) from tail to nose. Adds a closed lofted tube."""
    verts = []
    faces = []
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
    if cap_start:
        verts.append((sections[0][1], sections[0][0], sections[0][2]))
        ci = len(verts) - 1
        for j in range(segments):
            faces.append((ci, (j + 1) % segments, j))
    if cap_end:
        base = (n - 1) * segments
        verts.append((sections[-1][1], sections[-1][0], sections[-1][2]))
        ci = len(verts) - 1
        for j in range(segments):
            faces.append((ci, base + j, base + (j + 1) % segments))
    mb.add_faces(verts, faces, role)


def slab(mb, outline, z0, z1, role):
    """Extrude a convex-ish XY outline (list of (x, y), counter-clockwise from above) between heights z0..z1."""
    n = len(outline)
    verts = [(x, y, z0) for (x, y) in outline] + [(x, y, z1) for (x, y) in outline]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    mb.add_faces(verts, faces, role)


def fin(mb, root, tip_up, chord_root, chord_tip, sweep, thickness, role, x=0.0, cant=0.0):
    """A vertical fin: root chord along Y at height `root`, tip `tip_up` higher, swept back by `sweep`."""
    t = thickness / 2
    # profile in the (y, z) plane, then offset in x (with cant = lean outwards in radians)
    prof = [(chord_root / 2, root), (-chord_root / 2, root), (-chord_tip / 2 - sweep, root + tip_up), (chord_tip / 2 - sweep, root + tip_up)]
    verts = []
    for side in (-t, t):
        for (y, z) in prof:
            h = z - root
            verts.append((x + side + math.sin(cant) * h, y, z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mb.add_faces(verts, faces, role)


def torus_ring(mb, cx, cy, cz, radius, tube, segments, sides, role, axis="Y"):
    """A ring (nozzle glow / collar) around an axis through (cx, cy, cz)."""
    verts = []
    faces = []
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
    mb.add_faces(verts, faces, role)


def disc(mb, cx, cy, cz, radius, segments, role, facing=-1):
    """A flat disc in the XZ plane at depth cy, facing -Y (tail) by default."""
    verts = [(cx, cy, cz)] + [(cx + radius * math.cos(a), cy, cz + radius * math.sin(a)) for a in (i / segments * math.tau for i in range(segments))]
    faces = []
    for i in range(segments):
        a, b = 1 + i, 1 + (i + 1) % segments
        faces.append((0, b, a) if facing < 0 else (0, a, b))
    mb.add_faces(verts, faces, role)


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


def export_glb(path, objects):
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
        export_texcoords=False,
        export_extras=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
