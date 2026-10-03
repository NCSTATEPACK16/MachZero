"""
Build the scenery props of each world as one GLB per world (public/game/worlds/<world>/props.glb).

  Blender -b --factory-startup -P blender/props/build_props.py -- --out <dir> [--only sunset-mesa]

Each prop is one mesh object at the origin, base on z = 0 (Blender Z up; glTF Y up after export), named
<kind>_<n>. Colours are baked into COLOR_0 (linear RGB, flat-shaded low-poly facets); materials are named by
role and replaced at runtime by the world theme (graphics/themes): sandstone, chrome, dark, neon, foliage.
Billboards carry an empty named `screen` at the centre of the panel face; the runtime puts its neon sign there.
Deterministic: every random draw comes from random.Random(seed).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bmesh  # noqa: E402
import bpy  # noqa: E402

import common as C  # noqa: E402

PROP_ROLES = {
    "sandstone": ((0.6, 0.3, 0.15, 1.0), 0.0, 0.9, 0.0),
    "chrome": ((0.9, 0.9, 0.95, 1.0), 1.0, 0.12, 0.0),
    "dark": ((0.05, 0.05, 0.08, 1.0), 0.6, 0.5, 0.0),
    "neon": ((1.0, 0.2, 0.8, 1.0), 0.0, 0.5, 4.0),
    "foliage": ((0.1, 0.4, 0.15, 1.0), 0.0, 0.8, 0.0),
}
C.ROLES.update(PROP_ROLES)


class PropBuilder(C.MeshBuilder):
    """MeshBuilder whose vertices carry a baked colour; flat-shaded."""

    def __init__(self, name):
        super().__init__(name)
        self.colors = {}

    def add(self, verts, faces, role, color):
        """color: (r, g, b) or a function (x, y, z) -> (r, g, b)."""
        bm = self.bm
        vs = []
        for v in verts:
            bv = bm.verts.new(v)
            self.colors[bv] = color(*v) if callable(color) else color
            vs.append(bv)
        idx = self.slot(role)
        for f in faces:
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            face.material_index = idx
            face.smooth = False

    def done(self, collection=None):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.verts.index_update()
        colors = [self.colors.get(v, (1, 1, 1)) for v in bm.verts]
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for role in self.roles:
            mesh.materials.append(C.material(role))
        attr = mesh.color_attributes.new(name="COLOR_0", type="FLOAT_COLOR", domain="POINT")
        for i, c in enumerate(colors):
            attr.data[i].color = (c[0], c[1], c[2], 1.0)
        obj = bpy.data.objects.new(self.name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


def frustum(pb, lower, upper, z0, z1, role, color, cap_bottom=False, cap_top=True, rows=1, rng=None, wobble=0.0):
    """
    Side wall between two outlines (same point count, counter-clockwise from above) at z0 and z1, split into
    `rows` bands (so baked colours can vary with height). `wobble` jitters each inner row in or out (erosion).
    """
    n = len(lower)
    verts = []
    for r in range(rows + 1):
        t = r / rows
        k = 1.0 + (rng.uniform(-wobble, wobble) if (rng and 0 < r < rows) else 0.0)
        cx = sum(p[0] for p in lower) / n * (1 - t) + sum(p[0] for p in upper) / n * t
        cy = sum(p[1] for p in lower) / n * (1 - t) + sum(p[1] for p in upper) / n * t
        for i in range(n):
            x = lower[i][0] + (upper[i][0] - lower[i][0]) * t
            y = lower[i][1] + (upper[i][1] - lower[i][1]) * t
            verts.append((cx + (x - cx) * k, cy + (y - cy) * k, z0 + (z1 - z0) * t))
    faces = []
    for r in range(rows):
        for i in range(n):
            j = (i + 1) % n
            a, b = r * n + i, r * n + j
            faces.append((a, b, n + b, n + a))
    if cap_top:
        faces.append(tuple(range(rows * n, (rows + 1) * n)))
    if cap_bottom:
        faces.append(tuple(range(n - 1, -1, -1)))
    pb.add(verts, faces, role, color)


def ring(cx, cy, r, n, rng=None, jitter=0.0, phase=0.0):
    pts = []
    for i in range(n):
        a = phase + i / n * math.tau
        rr = r * (1.0 + (rng.uniform(-jitter, jitter) if rng else 0.0))
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return pts


def scale_outline(pts, s, cx=0.0, cy=0.0):
    return [(cx + (x - cx) * s, cy + (y - cy) * s) for (x, y) in pts]


def box(pb, x0, x1, y0, y1, z0, z1, role, color):
    frustum(pb, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, role, color, cap_bottom=True)


def lerp3(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


# ---------------------------------------------------------------------------
# Sunset Mesa
# ---------------------------------------------------------------------------

def sandstone(seed):
    """Strata colour by height: rust bands with pale layers, darker at the foot."""
    rng = random.Random(seed)
    bands = [rng.uniform(0, 1) for _ in range(64)]
    rust = (0.42, 0.13, 0.05)
    clay = (0.62, 0.27, 0.11)
    pale = (0.78, 0.48, 0.26)

    def f(x, y, z):
        b = bands[int(z / 5.5) % 64]
        c = lerp3(rust, clay, b) if b < 0.75 else lerp3(clay, pale, (b - 0.75) * 4)
        foot = min(1.0, z / 25.0)
        return lerp3((0.22, 0.08, 0.04), c, 0.45 + 0.55 * foot)

    return f


def build_mesa(name, seed, radius, height, tiers):
    rng = random.Random(seed)
    pb = PropBuilder(name)
    n = rng.randint(13, 18)
    base = ring(0, 0, radius, n, rng, 0.18, rng.uniform(0, math.tau))
    col = sandstone(seed)
    z = 0.0
    cur = base
    for t in range(tiers):
        h = height * (0.55 if t == 0 else 0.45 / (tiers - 1)) if tiers > 1 else height
        top = scale_outline(cur, rng.uniform(0.86, 0.94))
        frustum(pb, cur, top, z, z + h, "sandstone", col, cap_bottom=(t == 0), cap_top=True, rows=max(1, round(h / 5.5)), rng=rng, wobble=0.035)
        z += h
        if t < tiers - 1:
            # Ledge: next tier starts inset on the cap.
            cur = scale_outline(top, rng.uniform(0.62, 0.78))
            cx = rng.uniform(-0.12, 0.12) * radius
            cy = rng.uniform(-0.12, 0.12) * radius
            cur = [(x + cx, y + cy) for (x, y) in cur]
            # A short vertical rise from the ledge so the tiers read as steps.
            frustum(pb, cur, cur, z, z + 0.01, "sandstone", col, cap_top=False)
    return pb.done()


def build_spire(name, seed, height):
    rng = random.Random(seed)
    pb = PropBuilder(name)
    col = sandstone(seed + 7)
    z = 0.0
    r = height * 0.16
    segs = 5
    cur = ring(0, 0, r, 8, rng, 0.15)
    for i in range(segs):
        h = height / segs
        s = rng.uniform(0.7, 0.95) if i < segs - 1 else 0.45
        nxt = scale_outline(cur, s)
        off = (rng.uniform(-0.1, 0.1) * r, rng.uniform(-0.1, 0.1) * r)
        nxt = [(x + off[0], y + off[1]) for (x, y) in nxt]
        frustum(pb, cur, nxt, z, z + h, "sandstone", col, cap_bottom=(i == 0), cap_top=(i == segs - 1), rows=max(1, round(h / 5.5)), rng=rng, wobble=0.05)
        cur, z = nxt, z + h
    # Balanced cap rock (hoodoo).
    cx = sum(p[0] for p in cur) / len(cur)
    cy = sum(p[1] for p in cur) / len(cur)
    capr = ring(cx, cy, r * 0.7, 8, rng, 0.1)
    frustum(pb, scale_outline(capr, 0.8, cx, cy), capr, z, z + height * 0.06, "sandstone", col, cap_bottom=True)
    return pb.done()


def build_pylon(name):
    """Chrome obelisk with a neon pyramidion and band."""
    pb = PropBuilder(name)
    sq = lambda s: [(-s, -s), (s, -s), (s, s), (-s, s)]  # noqa: E731
    frustum(pb, sq(2.2), sq(2.4), 0, 1.2, "dark", (1, 1, 1), cap_bottom=True)
    frustum(pb, sq(1.6), sq(0.9), 1.2, 34.0, "chrome", (1, 1, 1), cap_top=False)
    frustum(pb, sq(0.98), sq(0.98), 27.0, 28.0, "neon", (1, 1, 1), cap_top=False)
    pb.add([(0.9, 0.9, 34.0), (-0.9, 0.9, 34.0), (-0.9, -0.9, 34.0), (0.9, -0.9, 34.0), (0, 0, 37.0)], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], "neon", (1, 1, 1))
    return pb.done()


def build_billboard(name):
    """Retro roadside billboard: two chrome legs, a dark frame; the sign panel (runtime) faces Blender -Y."""
    pb = PropBuilder(name)
    w, h, z0 = 26.0, 11.0, 9.0
    for x in (-w * 0.3, w * 0.3):
        box(pb, x - 0.5, x + 0.5, -0.5, 0.5, 0, z0, "chrome", (1, 1, 1))
    box(pb, -w / 2 - 0.8, w / 2 + 0.8, 0.0, 1.2, z0 - 0.8, z0 + h + 0.8, "dark", (1, 1, 1))
    # Neon trim along the top edge.
    box(pb, -w / 2 - 0.8, w / 2 + 0.8, -0.25, 0.05, z0 + h + 0.5, z0 + h + 0.8, "neon", (1, 1, 1))
    obj = pb.done()
    C.socket("screen", (0.0, -0.06, z0 + h / 2), parent=obj)
    return obj


def build_cactus(name, seed):
    rng = random.Random(seed)
    pb = PropBuilder(name)
    green = (0.05, 0.16, 0.06)
    hi = (0.12, 0.3, 0.1)

    def col(x, y, z):
        return lerp3(green, hi, 0.5 + 0.5 * math.sin(math.atan2(y, x) * 4))

    h = rng.uniform(7, 10)
    frustum(pb, ring(0, 0, 0.55, 8), ring(0, 0, 0.45, 8), 0, h, "foliage", col)
    for side in (-1, 1):
        if rng.random() < 0.85:
            a0 = rng.uniform(2.5, 4.5)
            ax = side * 1.6
            frustum(pb, ring(ax, 0, 0.35, 6), ring(ax, 0, 0.3, 6), a0, a0 + rng.uniform(2.5, 4), "foliage", col)
            # elbow: a short horizontal stub from the trunk to the arm
            box(pb, min(0, ax), max(0, ax), -0.3, 0.3, a0 - 0.3, a0 + 0.3, "foliage", green)
    return pb.done()


def build_sunset_mesa(out_dir):
    C.reset_scene()
    objs = []
    objs.append(build_mesa("mesa_0", 11, 70, 95, 2))
    objs.append(build_mesa("mesa_1", 23, 95, 70, 1))
    objs.append(build_mesa("mesa_2", 37, 55, 130, 3))
    objs.append(build_spire("spire_0", 41, 75))
    objs.append(build_spire("spire_1", 53, 48))
    objs.append(build_pylon("pylon_0"))
    objs.append(build_billboard("billboard_0"))
    objs.append(build_cactus("cactus_0", 61))
    objs.append(build_cactus("cactus_1", 67))
    export(out_dir, "sunset-mesa", objs)


# ---------------------------------------------------------------------------
# Neon Bay
# ---------------------------------------------------------------------------

def build_tower(name, seed, height, width):
    """Stepped synthwave skyscraper: setbacks with neon bands at each step and an antenna."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    steps = rng.randint(3, 4)
    w = width
    d = width * rng.uniform(0.7, 1.0)
    z = 0.0
    shade_lo = (0.025, 0.012, 0.05)
    shade_hi = (0.07, 0.03, 0.12)
    for i in range(steps):
        h = height * (0.5 if i == 0 else 0.5 / (steps - 1))
        col = lambda x, y, zz, z0=z, hh=h: lerp3(shade_lo, shade_hi, (zz - z0) / max(hh, 1))  # noqa: E731
        box(pb, -w / 2, w / 2, -d / 2, d / 2, z, z + h, "dark", col)
        # neon band hugging the setback edge
        frustum(
            pb,
            [(-w / 2 - 0.3, -d / 2 - 0.3), (w / 2 + 0.3, -d / 2 - 0.3), (w / 2 + 0.3, d / 2 + 0.3), (-w / 2 - 0.3, d / 2 + 0.3)],
            [(-w / 2 - 0.3, -d / 2 - 0.3), (w / 2 + 0.3, -d / 2 - 0.3), (w / 2 + 0.3, d / 2 + 0.3), (-w / 2 - 0.3, d / 2 + 0.3)],
            z + h - 1.6,
            z + h - 0.4,
            "neon",
            (1, 1, 1),
            cap_top=False,
        )
        z += h
        w *= rng.uniform(0.62, 0.78)
        d *= rng.uniform(0.62, 0.78)
    box(pb, -0.6, 0.6, -0.6, 0.6, z, z + height * 0.12, "chrome", (1, 1, 1))
    box(pb, -1.0, 1.0, -1.0, 1.0, z + height * 0.12, z + height * 0.12 + 2.0, "neon", (1, 1, 1))
    return pb.done()


def build_pyramid(name, base, height):
    pb = PropBuilder(name)
    b = base / 2
    dark = (0.03, 0.015, 0.06)
    pb.add([(-b, -b, 0), (b, -b, 0), (b, b, 0), (-b, b, 0), (0, 0, height)], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], "dark", dark)
    # Neon edges: thin rails up the four corners.
    t = 0.9
    for (cx, cy) in ((-b, -b), (b, -b), (b, b), (-b, b)):
        pb.add(
            [(cx - t, cy, 0), (cx + t, cy, 0), (t * 0.3, 0, height), (-t * 0.3, 0, height)],
            [(0, 1, 2, 3), (3, 2, 1, 0)],
            "neon",
            (1, 1, 1),
        )
    return pb.done()


def build_palm(name, seed):
    """Synthwave palm: a leaning, curving trunk and drooping fronds (silhouettes against the sun)."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    h = rng.uniform(13, 18)
    lean = rng.uniform(1.5, 3.5)
    segs = 7
    trunk = (0.05, 0.025, 0.04)
    pts = []
    for i in range(segs + 1):
        t = i / segs
        pts.append((lean * t * t, 0.0, h * t, 0.42 - 0.18 * t))
    for i in range(segs):
        x0, y0, z0, r0 = pts[i]
        x1, y1, z1, r1 = pts[i + 1]
        frustum(pb, ring(x0, y0, r0, 6), ring(x1, y1, r1, 6), z0, z1, "dark", trunk, cap_top=(i == segs - 1))
    tx, ty, tz, _ = pts[-1]
    leaf = (0.03, 0.06, 0.05)
    fronds = rng.randint(7, 9)
    for k in range(fronds):
        a = k / fronds * math.tau + rng.uniform(-0.2, 0.2)
        L = rng.uniform(6, 8.5)
        ca, sa = math.cos(a), math.sin(a)
        # perpendicular for the leaf width
        px, py = -sa, ca
        verts = []
        faces = []
        n = 5
        for j in range(n + 1):
            t = j / n
            r = L * t
            drop = 3.2 * t * t
            wdt = 1.1 * math.sin(math.pi * min(1.0, t * 1.1)) + 0.05
            cx, cy, cz = tx + ca * r, ty + sa * r, tz + 0.6 - drop
            verts.append((cx - px * wdt, cy - py * wdt, cz))
            verts.append((cx + px * wdt, cy + py * wdt, cz))
        for j in range(n):
            a0 = 2 * j
            faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
            faces.append((a0 + 2, a0 + 3, a0 + 1, a0))
        pb.add(verts, faces, "foliage", leaf)
    return pb.done()


def build_neon_bay(out_dir):
    C.reset_scene()
    objs = [
        build_tower("tower_0", 101, 210, 46),
        build_tower("tower_1", 113, 160, 38),
        build_tower("tower_2", 127, 260, 52),
        build_pyramid("pyramid_0", 90, 70),
        build_palm("palm_0", 131),
        build_palm("palm_1", 137),
        build_palm("palm_2", 149),
    ]
    export(out_dir, "neon-bay", objs)


# ---------------------------------------------------------------------------


def export(out_dir, world, objs):
    path = os.path.join(out_dir, world, "props.glb")
    tris = {o.name: C.triangle_count(o) for o in objs}
    export_objs = list(objs)
    for o in objs:
        export_objs.extend(o.children)
    C.export_glb(path, export_objs)
    print(f"[props] {world}: {sum(tris.values())} tris {tris} -> {path}")


WORLDS = {"sunset-mesa": build_sunset_mesa, "neon-bay": build_neon_bay}


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/worlds"))
    only = C.arg_value("--only")
    for world, fn in WORLDS.items():
        if only and world != only:
            continue
        fn(out_dir)


main()
