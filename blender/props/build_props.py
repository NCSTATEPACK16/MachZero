"""
Build the scenery props of each world as one GLB per world (public/game/worlds/<world>/props.glb).

  Blender -b --factory-startup -P blender/props/build_props.py -- --out <dir> [--only sunset-mesa]

Each prop is one mesh object at the origin, base on z = 0 (Blender Z up; glTF Y up after export), named
<kind>_<n>. Colours are baked into COLOR_0 (linear RGB, flat-shaded low-poly facets); materials are named by
role and replaced at runtime by the world theme (graphics/themes): sandstone, chrome, dark, neon, foliage, ice.
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
    "ice": ((0.75, 0.9, 1.0, 1.0), 0.0, 0.08, 0.0),
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
# Cryo Station
# ---------------------------------------------------------------------------

def glacial(seed):
    """Ice colour by height: deep blue at the foot, pale cyan bands, near-white snow on top."""
    rng = random.Random(seed)
    bands = [rng.uniform(0, 1) for _ in range(64)]
    deep = (0.05, 0.16, 0.32)
    mid = (0.32, 0.62, 0.86)
    snow = (0.86, 0.94, 1.0)

    def f(x, y, z):
        b = bands[int(z / 4.0) % 64]
        c = lerp3(deep, mid, 0.35 + 0.65 * b)
        return c

    def top(height):
        def g(x, y, z):
            return snow if z > height * 0.92 else f(x, y, z)
        return g

    return f, top


def build_ice_spire(name, seed, height, lean=0.12):
    """Jagged crystal: a few faceted shards from one base, the tallest in the middle."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    col, _ = glacial(seed)
    shards = rng.randint(3, 5)
    for k in range(shards):
        h = height * (1.0 if k == 0 else rng.uniform(0.35, 0.7))
        r = height * rng.uniform(0.07, 0.11) * (1.0 if k == 0 else 0.8)
        a = rng.uniform(0, math.tau)
        off = 0.0 if k == 0 else height * rng.uniform(0.08, 0.16)
        cx, cy = off * math.cos(a), off * math.sin(a)
        n = rng.choice((5, 6))
        base = ring(cx, cy, r, n, rng, 0.2, rng.uniform(0, math.tau))
        tilt = lean if k == 0 else rng.uniform(0.1, 0.35)
        tx, ty = cx + math.cos(a) * h * tilt, cy + math.sin(a) * h * tilt
        mid = scale_outline(base, 0.75, cx, cy)
        mid = [(x + (tx - cx) * 0.55, y + (ty - cy) * 0.55) for (x, y) in mid]
        frustum(pb, base, mid, 0, h * 0.55, "ice", col, cap_bottom=True, cap_top=False)
        top = [(tx + (x - cx) * 0.05, ty + (y - cy) * 0.05) for (x, y) in base]
        frustum(pb, mid, top, h * 0.55, h, "ice", lambda x, y, z: lerp3(col(x, y, z), (0.9, 0.97, 1.0), 0.6), cap_top=True)
    return pb.done()


def build_glacier(name, seed, radius, height):
    """Flat-topped ice shelf with a snow cap and crevassed sides."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    col, top = glacial(seed)
    n = rng.randint(14, 20)
    base = ring(0, 0, radius, n, rng, 0.2, rng.uniform(0, math.tau))
    upper = scale_outline(base, rng.uniform(0.8, 0.9))
    frustum(pb, base, upper, 0, height, "ice", top(height), cap_bottom=True, cap_top=True, rows=max(1, round(height / 4.0)), rng=rng, wobble=0.05)
    return pb.done()


def build_control_tower(name, seed, height):
    """CRT control tower: a chrome stalk, a dark cab with a band of glowing screens, a dish on the roof."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    frustum(pb, ring(0, 0, 3.2, 8), ring(0, 0, 2.2, 8), 0, height, "chrome", (1, 1, 1), cap_bottom=True, cap_top=False)
    cab_z = height
    frustum(pb, ring(0, 0, 4.0, 8, phase=math.pi / 8), ring(0, 0, 7.5, 8, phase=math.pi / 8), cab_z, cab_z + 3.0, "dark", (0.03, 0.04, 0.08), cap_bottom=True, cap_top=False)
    frustum(pb, ring(0, 0, 7.6, 8, phase=math.pi / 8), ring(0, 0, 7.6, 8, phase=math.pi / 8), cab_z + 3.0, cab_z + 5.5, "neon", (1, 1, 1), cap_top=False)
    frustum(pb, ring(0, 0, 7.5, 8, phase=math.pi / 8), ring(0, 0, 5.0, 8, phase=math.pi / 8), cab_z + 5.5, cab_z + 8.0, "dark", (0.03, 0.04, 0.08))
    # Roof mast and dish.
    box(pb, -0.3, 0.3, -0.3, 0.3, cab_z + 8.0, cab_z + 8.0 + rng.uniform(6, 10), "chrome", (1, 1, 1))
    frustum(pb, ring(0, 0, 0.4, 10), ring(0, 0, 3.0, 10), cab_z + 8.5, cab_z + 9.5, "chrome", (1, 1, 1), cap_top=False)
    return pb.done()


def build_dome(name, radius):
    """Research dome: stacked rings approximating a hemisphere, a neon ring at the foot and a skylight."""
    pb = PropBuilder(name)
    rows = 6
    prev = ring(0, 0, radius, 16)
    z = 0.0
    frustum(pb, ring(0, 0, radius + 0.6, 16), ring(0, 0, radius + 0.6, 16), 0, 1.0, "neon", (1, 1, 1), cap_top=False)
    for i in range(1, rows + 1):
        a = i / rows * math.pi / 2
        r = radius * math.cos(a) if i < rows else radius * 0.18
        nz = radius * 0.8 * math.sin(a)
        cur = ring(0, 0, r, 16)
        frustum(pb, prev, cur, z, nz, "chrome" if i % 2 else "dark", (1, 1, 1) if i % 2 else (0.05, 0.07, 0.12), cap_top=(i == rows))
        prev, z = cur, nz
    return pb.done()


def build_mast(name):
    """Lattice-ish radio mast (a tapered square stalk) with neon bands and a beacon."""
    pb = PropBuilder(name)
    sq = lambda s: [(-s, -s), (s, -s), (s, s), (-s, s)]  # noqa: E731
    frustum(pb, sq(1.8), sq(2.0), 0, 1.0, "dark", (0.04, 0.05, 0.08), cap_bottom=True)
    frustum(pb, sq(1.0), sq(0.35), 1.0, 36.0, "chrome", (1, 1, 1), cap_top=False)
    for z in (12.0, 24.0):
        w = 1.0 - (z / 36.0) * 0.65 + 0.06
        frustum(pb, sq(w), sq(w), z, z + 1.0, "neon", (1, 1, 1), cap_top=False)
    box(pb, -0.6, 0.6, -0.6, 0.6, 36.0, 37.4, "neon", (1, 1, 1))
    return pb.done()


def build_cryo_station(out_dir):
    C.reset_scene()
    objs = [
        build_ice_spire("spire_0", 201, 90),
        build_ice_spire("spire_1", 211, 55, lean=0.25),
        build_ice_spire("spire_2", 223, 130, lean=0.05),
        build_glacier("glacier_0", 229, 90, 40),
        build_glacier("glacier_1", 233, 140, 26),
        build_control_tower("tower_0", 241, 42),
        build_dome("dome_0", 26),
        build_mast("mast_0"),
    ]
    export(out_dir, "cryo-station", objs)


# ---------------------------------------------------------------------------
# Jade Ruins
# ---------------------------------------------------------------------------

def mossy(seed):
    """Weathered temple stone: grey-green blocks with moss creeping up from the foot, varying by course."""
    rng = random.Random(seed)
    courses = [rng.uniform(0, 1) for _ in range(64)]
    stone = (0.2, 0.24, 0.2)
    pale = (0.36, 0.4, 0.33)
    moss = (0.06, 0.2, 0.08)

    def f(x, y, z):
        c = lerp3(stone, pale, courses[int(z / 2.5) % 64])
        return lerp3(moss, c, min(1.0, 0.35 + z / 18.0))

    return f


def build_temple(name, seed, base, height, steps):
    """Stepped pyramid with a stairway up the front, a shrine on top and a neon glyph band round the shrine."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    col = mossy(seed)
    sh = height / (steps + 1)
    top = base * 0.28
    for k in range(steps):
        b0 = base / 2 - (base / 2 - top / 2) * k / steps
        b1 = base / 2 - (base / 2 - top / 2) * (k + 1) / steps
        z0, z1 = k * sh, (k + 1) * sh
        # Each terrace: a slightly battered wall, then a ledge.
        frustum(pb, [(-b0, -b0), (b0, -b0), (b0, b0), (-b0, b0)], [(-b0 * 0.97, -b0 * 0.97), (b0 * 0.97, -b0 * 0.97), (b0 * 0.97, b0 * 0.97), (-b0 * 0.97, b0 * 0.97)], z0, z1, "sandstone", col, cap_bottom=(k == 0), cap_top=False)
        frustum(pb, [(-b0 * 0.97, -b0 * 0.97), (b0 * 0.97, -b0 * 0.97), (b0 * 0.97, b0 * 0.97), (-b0 * 0.97, b0 * 0.97)], [(-b1, -b1), (b1, -b1), (b1, b1), (-b1, b1)], z1, z1, "sandstone", col, cap_top=(k == steps - 1))
    # Stairway up the -Y face: a ramp of steps.
    sw = base * 0.09
    n = steps * 4
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        y0 = -(base / 2 - (base / 2 - top / 2) * t0) - 1.5
        z0, z1 = t0 * steps * sh, t1 * steps * sh
        box(pb, -sw, sw, y0, y0 + (base / 2 - top / 2) / n + 1.5, z0, z1, "sandstone", lerp3(col(0, 0, z1), (0.5, 0.52, 0.45), 0.3))
    # Shrine: a block with a doorway band of neon glyphs, and a roof comb.
    zs = steps * sh
    hs = top * 0.36
    box(pb, -hs, hs, -hs, hs, zs, zs + sh * 0.9, "sandstone", col)
    frustum(pb, [(-hs - 0.3, -hs - 0.3), (hs + 0.3, -hs - 0.3), (hs + 0.3, hs + 0.3), (-hs - 0.3, hs + 0.3)], [(-hs - 0.3, -hs - 0.3), (hs + 0.3, -hs - 0.3), (hs + 0.3, hs + 0.3), (-hs - 0.3, hs + 0.3)], zs + sh * 0.45, zs + sh * 0.6, "neon", (1, 1, 1), cap_top=False)
    box(pb, -hs * 0.7, hs * 0.7, -0.8, 0.8, zs + sh * 0.9, zs + sh * 0.9 + rng.uniform(4, 7), "sandstone", col)
    return pb.done()


def build_column(name, seed, height, broken):
    """Ruined column: base plinth, a fluted shaft in drums (the top drums missing if broken), maybe a capital."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    col = mossy(seed)
    r = height * 0.075
    box(pb, -r * 1.6, r * 1.6, -r * 1.6, r * 1.6, 0, r * 0.9, "sandstone", col)
    drums = 6
    keep = rng.randint(2, 4) if broken else drums
    dz = (height - r * 2.2) / drums
    z = r * 0.9
    for i in range(keep):
        off = rng.uniform(-0.25, 0.25) * r if broken else 0.0
        frustum(pb, ring(off, 0, r, 10, phase=i * 0.3), ring(off, 0, r * 0.97, 10, phase=i * 0.3), z, z + dz * 0.97, "sandstone", col, cap_bottom=True, cap_top=True)
        z += dz
    if not broken:
        box(pb, -r * 1.5, r * 1.5, -r * 1.5, r * 1.5, z, z + r * 1.3, "sandstone", col)
        # A thin neon glyph ring under the capital.
        frustum(pb, ring(0, 0, r * 1.02, 10), ring(0, 0, r * 1.02, 10), z - dz * 0.25, z - dz * 0.15, "neon", (1, 1, 1), cap_top=False)
    else:
        # A fallen drum beside it.
        a = rng.uniform(0, math.tau)
        cx, cy = math.cos(a) * r * 3.2, math.sin(a) * r * 3.2
        box(pb, cx - r, cx + r, cy - dz / 2, cy + dz / 2, 0, r * 1.8, "sandstone", col)
    return pb.done()


def build_statue(name, seed, height):
    """Temple guardian: a squat idol of stacked blocks with a heavy head, slab ears and glowing eyes."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    col = mossy(seed)
    w = height * 0.22
    box(pb, -w * 1.3, w * 1.3, -w * 1.1, w * 1.1, 0, height * 0.12, "sandstone", col)
    box(pb, -w, w, -w * 0.8, w * 0.8, height * 0.12, height * 0.55, "sandstone", col)
    hw = w * rng.uniform(1.15, 1.35)
    hz0, hz1 = height * 0.55, height * 0.95
    box(pb, -hw, hw, -w * 0.95, w * 0.95, hz0, hz1, "sandstone", col)
    for side in (-1, 1):
        box(pb, side * hw, side * (hw + w * 0.35), -w * 0.3, w * 0.3, hz0 + (hz1 - hz0) * 0.2, hz1 - (hz1 - hz0) * 0.1, "sandstone", col)
        # Eyes on the -Y face.
        ex = side * hw * 0.42
        box(pb, ex - w * 0.16, ex + w * 0.16, -w * 0.95 - 0.25, -w * 0.95, hz0 + (hz1 - hz0) * 0.55, hz0 + (hz1 - hz0) * 0.68, "neon", (1, 1, 1))
    box(pb, -hw * 0.8, hw * 0.8, -w * 0.6, w * 0.6, hz1, height, "sandstone", col)
    return pb.done()


def build_fern(name, seed, size):
    """Giant fern: arching fronds from a short stump, each a tapered strip with leaflet zig-zags."""
    rng = random.Random(seed)
    pb = PropBuilder(name)
    frustum(pb, ring(0, 0, size * 0.06, 6), ring(0, 0, size * 0.04, 6), 0, size * 0.18, "dark", (0.06, 0.05, 0.03), cap_bottom=True)
    fronds = rng.randint(9, 13)
    for k in range(fronds):
        a = k / fronds * math.tau + rng.uniform(-0.15, 0.15)
        L = size * rng.uniform(0.75, 1.0)
        rise = size * rng.uniform(0.35, 0.55)
        ca, sa = math.cos(a), math.sin(a)
        px, py = -sa, ca
        green = lerp3((0.04, 0.22, 0.06), (0.16, 0.42, 0.1), rng.uniform(0, 1))
        verts = []
        faces = []
        n = 8
        for j in range(n + 1):
            t = j / n
            r = L * t
            z = size * 0.16 + rise * math.sin(math.pi * 0.8 * t) - size * 0.25 * t * t
            wdt = size * 0.13 * math.sin(math.pi * min(1.0, t * 1.05)) + 0.05
            zig = wdt * (0.25 if j % 2 else 0.0)
            cx, cy = ca * r, sa * r
            verts.append((cx - px * (wdt + zig), cy - py * (wdt + zig), z))
            verts.append((cx + px * (wdt + zig), cy + py * (wdt + zig), z))
        for j in range(n):
            a0 = 2 * j
            faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
            faces.append((a0 + 2, a0 + 3, a0 + 1, a0))
        pb.add(verts, faces, "foliage", green)
    return pb.done()


def build_jade_ruins(out_dir):
    C.reset_scene()
    objs = [
        build_temple("temple_0", 301, 120, 60, 6),
        build_temple("temple_1", 307, 80, 38, 4),
        build_column("column_0", 311, 22, broken=False),
        build_column("column_1", 313, 20, broken=True),
        build_column("column_2", 317, 24, broken=True),
        build_statue("statue_0", 331, 16),
        build_fern("fern_0", 337, 14),
        build_fern("fern_1", 347, 20),
    ]
    export(out_dir, "jade-ruins", objs)


# ---------------------------------------------------------------------------


def export(out_dir, world, objs):
    path = os.path.join(out_dir, world, "props.glb")
    tris = {o.name: C.triangle_count(o) for o in objs}
    export_objs = list(objs)
    for o in objs:
        export_objs.extend(o.children)
    C.export_glb(path, export_objs)
    print(f"[props] {world}: {sum(tris.values())} tris {tris} -> {path}")


WORLDS = {"sunset-mesa": build_sunset_mesa, "neon-bay": build_neon_bay, "cryo-station": build_cryo_station, "jade-ruins": build_jade_ruins}


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/worlds"))
    only = C.arg_value("--only")
    for world, fn in WORLDS.items():
        if only and world != only:
            continue
        fn(out_dir)


main()
