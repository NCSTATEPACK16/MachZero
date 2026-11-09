"""
Build the 16 bolt-on parts (4 slots x 4 tiers) into one parts.glb.

  Blender -b --factory-startup -P blender/parts/build_parts.py -- --out <dir>

Each part is a root node named <slot>_t<tier> whose origin is the matching socket on the ship:
  engine     -> socket_engine      (hull tail; the part extends backwards, -Y)
  booster    -> socket_booster_R   (right pod flank; +X is outwards; the runtime mirrors it for the left)
  stabilizer -> socket_stabilizer  (hull top, rear)
  hull       -> socket_hull        (hull top, front)

§V V2: the parts follow the approved COMET look (white painted plates, carbon and ribbed dark trim, cyan glow
strips) and the tier ladder in docs/v2/VEHICLE_CONCEPTS.md (there are no part concepts):
  Stock (t0)      plain painted steel, panel/plate strips
  Mk II (t1)      adds cooling fins (vent and ribbed strips) and a first glow line
  Mk III (t2)     carbon and brushed metal, machined collars, more glow
  Prototype (t3)  an exposed glowing core, the most glow, still believable
Rules (IMPLEMENTATION §V.7): trim-sheet UVs on every face, AO baked into COLOR_0.a, ≤ 1.5k triangles and at most
3 material roles (= primitives = draw calls) per part. Sizes stay close to the M2 parts so they sit on every
chassis's sockets; higher tiers are bigger and glow more, so upgrades read at a glance.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common as C  # noqa: E402

SEG = 16


def bounds_of(half):
    return (Vector((-half, -half, -half)), Vector((half, half, half)))


def box(mb, center, size, role, strip, rot_y=0.0, about=(0.0, 0.0)):
    """An axis-aligned box (size = x, y, z) at `center`, then turned by rot_y radians about the Y axis through
    `about` = (x, z): radial fins around a part's axis. UVs by box projection onto the strip."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    m = Matrix.Rotation(rot_y, 3, "Y")
    pts = []
    for dz in (-sz, sz):
        for (dx, dy) in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            v = Vector((cx + dx - about[0], cy + dy, cz + dz - about[1]))
            v = m @ v
            pts.append((v.x + about[0], v.y, v.z + about[1]))
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mb.add_faces(pts, faces, role, strip)


def tube(mb, y0, y1, x, z, r0, r1, seg, role, strip, panels=4, power=2.0, cap0=False, cap1=False):
    """A straight tube along Y from y0 (tail) to y1 (front), radius r0 -> r1."""
    C.loft(mb, [(y0, x, z, r0, r0), (y1, x, z, r1, r1)], seg, power, role, cap_start=cap0, cap_end=cap1, strip=strip, panels=panels)


# ------------------------------------------------------------------------------------------------ engine
def engine(t):
    """A turbine housing behind the hull tail: intake flange at y = 0, nozzle at y = -length."""
    mb = C.MeshBuilder(f"engine_t{t}_mesh")
    r = 0.2 + 0.035 * t
    length = 0.3 + 0.12 * t
    body = "livery_secondary" if t < 2 else "metal"
    body_strip = "plate" if t < 2 else "brushed"
    # housing: flange -> barrel -> taper into the nozzle collar
    secs = [
        (-length + 0.1, 0.0, 0.0, r * 0.9, r * 0.9),
        (-length * 0.55, 0.0, 0.0, r, r),
        (-0.07, 0.0, 0.0, r * 1.02, r * 1.02),
        (-0.03, 0.0, 0.0, r * 1.06, r * 1.06),
        (0.0, 0.0, 0.0, r * 0.78, r * 0.78),
    ]
    if t == 3:  # Prototype: the barrel is cut open over the core
        secs = [s for s in secs if s[0] > -length * 0.45]
    C.loft(mb, secs, SEG, 2.0, body, cap_start=False, cap_end=True, strip=body_strip, panels=4)
    # ribbed nozzle collar and the glowing core
    y_n = -length + 0.1
    tube(mb, y_n - 0.12, y_n + 0.005, 0.0, 0.0, r * 0.82, r * 0.92, SEG, "dark", "ribbed", panels=2)
    C.torus_ring(mb, 0.0, y_n - 0.12, 0.0, r * 0.78, 0.025 + 0.006 * t, SEG, 5, "dark", strip="ribbed")
    C.disc(mb, 0.0, y_n - 0.09, 0.0, r * 0.74, SEG, "glow", strip="flat")
    if t >= 1:  # cooling fins: dark louvred blades around the barrel, a glow band in front of them
        n = 4 if t == 1 else 6
        for k in range(n):
            a = k / n * math.tau + math.pi / n
            box(mb, (r * 1.04, -length * 0.42, 0.0), (0.07, length * 0.5, 0.025), "dark", "vent", rot_y=a)
        C.torus_ring(mb, 0.0, -0.1, 0.0, r * 1.05, 0.014, SEG, 4, "glow", strip="flat")
    if t == 2:  # Mk III: a carbon shroud sleeve and a machined collar
        tube(mb, -length * 0.3, -0.08, 0.0, 0.0, r * 1.08, r * 1.08, SEG, "dark", "carbon", panels=4)
        C.torus_ring(mb, 0.0, -length * 0.3, 0.0, r * 1.06, 0.022, SEG, 5, "metal", strip="brushed")
        C.torus_ring(mb, 0.0, y_n + 0.02, 0.0, r * 0.95, 0.02, SEG, 5, "metal", strip="brushed")
    if t == 3:  # Prototype: exposed glowing core in a cage of ribbed struts, twin afterburner rings
        tube(mb, y_n, -length * 0.45 + 0.01, 0.0, 0.0, r * 0.66, r * 0.66, SEG, "glow", "flat", panels=1)
        for k in range(6):
            a = k / 6 * math.tau
            box(mb, (r * 0.92, (y_n - length * 0.45) / 2, 0.0), (0.05, -length * 0.45 - y_n + 0.04, 0.05), "dark", "ribbed", rot_y=a)
        C.torus_ring(mb, 0.0, y_n + 0.01, 0.0, r * 0.92, 0.03, SEG, 5, "metal", strip="brushed")
        for sx in (-1, 1):
            C.torus_ring(mb, sx * r * 0.6, y_n - 0.2, -r * 0.4, r * 0.26, 0.022, 12, 4, "glow", strip="flat")
            box(mb, (sx * r * 0.6, y_n - 0.1, -r * 0.4 + r * 0.26), (0.03, 0.22, 0.03), "metal", "brushed")
    return mb.finish(bounds_of(r + length))


# ----------------------------------------------------------------------------------------------- booster
def booster(t):
    """A booster canister against the right pod flank (+X outwards), centred on the socket in y."""
    mb = C.MeshBuilder(f"booster_t{t}_mesh")
    r = 0.085 + 0.02 * t
    length = 0.55 + 0.17 * t
    x = r * 0.9
    shell = "livery_secondary" if t < 2 else "dark"
    shell_strip = "plate" if t < 2 else "carbon"
    trim = "dark" if t < 2 else "metal"
    trim_strip = "ribbed" if t < 2 else "brushed"

    def canister(cx, cz, rr, ln, glow_core):
        y0, y1 = -ln / 2, ln / 2
        secs = [(y0 + 0.04, cx, cz, rr * 0.86, rr * 0.86), (y0 + 0.08, cx, cz, rr, rr), (y1 - 0.14, cx, cz, rr, rr), (y1 - 0.04, cx, cz, rr * 0.7, rr * 0.7), (y1, cx, cz, rr * 0.25, rr * 0.25)]
        if glow_core:  # Prototype: the shell stops short and a glowing core band shows through
            mid = (y0 + y1) / 2
            C.loft(mb, [s for s in secs if s[0] > mid + 0.06], 12, 2.0, shell, cap_start=False, cap_end=True, strip=shell_strip, panels=3)
            C.loft(mb, [s for s in secs if s[0] < mid - 0.06], 12, 2.0, shell, cap_start=False, cap_end=False, strip=shell_strip, panels=3)
            tube(mb, mid - 0.08, mid + 0.08, cx, cz, rr * 0.8, rr * 0.8, 12, "glow", "flat", panels=1)
            for yy in (mid - 0.06, mid + 0.06):
                C.torus_ring(mb, cx, yy, cz, rr * 0.98, 0.012, 12, 4, trim, strip=trim_strip)
        else:
            C.loft(mb, secs, 12, 2.0, shell, cap_start=False, cap_end=True, strip=shell_strip, panels=3)
        # nozzle: ribbed collar, glowing core
        tube(mb, y0 - 0.03, y0 + 0.045, cx, cz, rr * 0.7, rr * 0.86, 12, trim, trim_strip, panels=2)
        C.disc(mb, cx, y0 - 0.02, cz, rr * 0.62, 12, "glow", strip="flat")

    canister(x, 0.0, r, length, glow_core=t == 3)
    # mounting saddle against the pod
    box(mb, (r * 0.15, 0.0, 0.0), (r * 0.5, length * 0.45, r * 0.9), trim, trim_strip)
    if t >= 1:  # cooling: ribbed collars and a glow stripe down the outer side
        for yy in (-length / 2 + 0.12, length / 2 - 0.2):
            C.torus_ring(mb, x, yy, 0.0, r * 1.0, 0.014, 12, 4, trim, strip=trim_strip)
        box(mb, (x + r * 0.98, -0.03, 0.0), (0.02, length * 0.55, 0.03), "glow", "flat")
    if t >= 2:  # Mk III: a canted carbon fin on top
        C.fin(mb, r * 0.8, 0.07 + 0.03 * t, 0.26, 0.11, 0.08, 0.02, shell, x=x, cant=0.25, strip=shell_strip)
    if t == 3:  # Prototype: a second, smaller canister underneath
        canister(x * 0.95, -r * 1.75, r * 0.62, length * 0.85, glow_core=False)
        box(mb, (x * 0.97, 0.0, -r * 0.95), (0.03, length * 0.3, r * 0.6), trim, trim_strip)
    return mb.finish(bounds_of(length))


# -------------------------------------------------------------------------------------------- stabilizer
def stabilizer(t):
    """A rear wing on pylons above the hull's rear deck."""
    mb = C.MeshBuilder(f"stabilizer_t{t}_mesh")
    span = 0.45 + 0.22 * t
    chord = 0.28 + 0.06 * t
    h = 0.14 + 0.06 * t
    wing_role = "livery_secondary" if t != 2 else "dark"
    wing_strip = "plate" if t != 2 else "carbon"
    # pylons (carbon); wider apart from Mk III
    for sx in ((-0.12, 0.12) if t < 2 else (-span * 0.7, span * 0.7)):
        C.slab(mb, [(sx - 0.022, -chord * 0.5), (sx + 0.022, -chord * 0.5), (sx + 0.022, -0.02), (sx - 0.022, -0.02)], 0.0, h, "dark", strip="carbon")
    # wing, with a slight leading-edge chamfer: a thin slab on a thicker one
    wing = [(-span, -chord * 0.7), (span, -chord * 0.7), (span * 0.9, 0.0), (-span * 0.9, 0.0)]
    C.slab(mb, wing, h, h + 0.03, wing_role, strip=wing_strip, edge_strip="grip")
    inner = [(-span * 0.95, -chord * 0.64), (span * 0.95, -chord * 0.64), (span * 0.86, -0.04), (-span * 0.86, -0.04)]
    C.slab(mb, inner, h + 0.03, h + 0.042, wing_role, strip=wing_strip, edge_strip="grip")
    if t >= 1:  # glow trailing edge and a dark louvre
        C.slab(mb, [(-span, -chord * 0.73), (span, -chord * 0.73), (span, -chord * 0.69), (-span, -chord * 0.69)], h + 0.004, h + 0.028, "glow", strip="flat")
        C.slab(mb, [(-span * 0.4, -chord * 0.5), (span * 0.4, -chord * 0.5), (span * 0.4, -chord * 0.2), (-span * 0.4, -chord * 0.2)], h + 0.042, h + 0.05, "dark", strip="vent")
    if t >= 2:  # end plates
        ep = "livery_secondary" if t == 2 else "dark"
        for sx in (-1, 1):
            C.fin(mb, h - 0.06, 0.16 + 0.04 * t, chord, chord * 0.6, 0.06, 0.025, ep, x=sx * span, strip="plate" if t == 2 else "carbon")
    if t == 3:  # Prototype: a second carbon element with its own glow edge
        up = [(-span * 0.8, -chord * 0.78), (span * 0.8, -chord * 0.78), (span * 0.72, -chord * 0.3), (-span * 0.72, -chord * 0.3)]
        C.slab(mb, up, h + 0.15, h + 0.175, "dark", strip="carbon", edge_strip="grip")
        C.slab(mb, [(-span * 0.8, -chord * 0.8), (span * 0.8, -chord * 0.8), (span * 0.8, -chord * 0.76), (-span * 0.8, -chord * 0.76)], h + 0.152, h + 0.172, "glow", strip="flat")
    return mb.finish(bounds_of(span))


# -------------------------------------------------------------------------------------------------- hull
def hull(t):
    """An armour plate on the hull's front deck (tapers to the nose, +Y)."""
    mb = C.MeshBuilder(f"hull_t{t}_mesh")
    w = 0.16 + 0.07 * t
    length = 0.45 + 0.2 * t
    th = 0.03 + 0.015 * t
    # a dark under-plate a little bigger than the painted plate: reads as a bolted seam
    C.slab(mb, [(-w - 0.015, -length / 2 - 0.015), (w + 0.015, -length / 2 - 0.015), (w * 0.6 + 0.012, length / 2 + 0.015), (-w * 0.6 - 0.012, length / 2 + 0.015)], -0.005, th * 0.5, "dark", strip="grip")
    plate = [(-w, -length / 2), (w, -length / 2), (w * 0.6, length / 2), (-w * 0.6, length / 2)]
    C.slab(mb, plate, th * 0.5, th, "livery_secondary", strip="plate", edge_strip="grip")
    if t >= 1:  # glow seam and twin NACA-style vents
        C.slab(mb, [(-0.012, -length / 2 + 0.05), (0.012, -length / 2 + 0.05), (0.012, length / 2 - 0.05), (-0.012, length / 2 - 0.05)], th, th + 0.01, "glow", strip="flat")
        for sx in (-1, 1):
            v = [(sx * w * 0.25, -length * 0.3), (sx * w * 0.62, -length * 0.3), (sx * w * 0.5, length * 0.12), (sx * w * 0.32, length * 0.12)]
            if sx < 0:
                v = [v[1], v[0], v[3], v[2]]
            C.slab(mb, v, th - 0.004, th + 0.006, "dark", strip="vent")
    if t >= 2:  # Mk III: carbon side plates
        for sx in (-1, 1):
            x0 = sx * (w + 0.02)
            x1 = sx * (w + 0.16 + 0.04 * t)
            side = [(x0, -length / 2), (x1, -length / 2 + 0.08), (x1, length / 2 - 0.12), (x0, length / 2)]
            if sx < 0:
                side = list(reversed(side))
            C.slab(mb, side, -0.06, th - 0.01, "dark", strip="carbon", edge_strip="ribbed")
            gl = [(x1 - sx * 0.012, -length / 2 + 0.12), (x1, -length / 2 + 0.12), (x1, length / 2 - 0.16), (x1 - sx * 0.012, length / 2 - 0.16)]
            if sx < 0:
                gl = list(reversed(gl))
            C.slab(mb, gl, th - 0.035, th - 0.012, "glow", strip="flat")
    if t == 3:  # Prototype: an armoured crest over a glowing core window
        C.fin(mb, th, 0.12, length * 0.8, length * 0.4, 0.1, 0.05, "livery_secondary", strip="plate")
        C.slab(mb, [(-w * 0.35, -length * 0.42), (w * 0.35, -length * 0.42), (w * 0.3, -length * 0.2), (-w * 0.3, -length * 0.2)], th, th + 0.014, "glow", strip="flat")
    return mb.finish(bounds_of(length))


BUILDERS = {"engine": engine, "booster": booster, "stabilizer": stabilizer, "hull": hull}
MAX_ROLES = 3


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/parts"))
    C.reset_scene()
    objs = []
    meshes = []
    report = {}
    for slot, fn in BUILDERS.items():
        for t in range(4):
            root = bpy.data.objects.new(f"{slot}_t{t}", None)
            bpy.context.scene.collection.objects.link(root)
            mesh = fn(t)
            mesh.parent = root
            objs += [root, mesh]
            meshes.append(mesh)
            roles = [m.name for m in mesh.data.materials]
            if len(roles) > MAX_ROLES:
                raise RuntimeError(f"{root.name} uses {len(roles)} roles {roles} > {MAX_ROLES}")
            report[root.name] = (C.triangle_count(mesh), len(roles))
    C.bake_vertex_ao(meshes, samples=64, distance=0.25)
    path = os.path.join(out_dir, "parts.glb")
    C.export_glb(path, objs, texcoords=True)
    print(f"[parts] {report} -> {path}")


main()
