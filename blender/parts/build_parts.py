"""
Build the 16 bolt-on parts (4 slots x 4 tiers) into one parts.glb.

  Blender -b --factory-startup -P blender/parts/build_parts.py -- --out <dir>

Each part is a root node named <slot>_t<tier> whose origin is the matching socket on the ship:
  engine     -> socket_engine      (hull tail; the part extends backwards, -Y)
  booster    -> socket_booster_R   (right pod flank; +X is outwards; the runtime mirrors it for the left)
  stabilizer -> socket_stabilizer  (hull top, rear)
  hull       -> socket_hull        (hull top, front)
Higher tiers are bigger and glow more, so upgrades read at a glance. Stock (t0) parts are small.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402

SEG = 16


def bounds_of(half):
    return (Vector((-half, -half, -half)), Vector((half, half, half)))


def engine(t):
    mb = C.MeshBuilder(f"engine_t{t}_mesh")
    r = 0.2 + 0.035 * t
    length = 0.28 + 0.12 * t
    # housing: tail -> front (y from -length to 0)
    secs = [(-length, 0.0, 0.0, r * 0.82, r * 0.82), (-length + 0.06, 0.0, 0.0, r, r), (-0.05, 0.0, 0.0, r * 1.02, r * 1.02), (0.0, 0.0, 0.0, r * 0.7, r * 0.7)]
    C.loft(mb, secs, SEG, 2.0 if t < 2 else 3.0, "metal")
    C.torus_ring(mb, 0.0, -length - 0.01, 0.0, r * 0.72, 0.03 + 0.01 * t, SEG, 5, "dark")
    C.disc(mb, 0.0, -length - 0.02, 0.0, r * 0.66, SEG, "glow")
    if t >= 1:  # glow band
        C.torus_ring(mb, 0.0, -length * 0.55, 0.0, r * 1.02, 0.018, SEG, 4, "glow")
    if t >= 2:  # cooling fins
        for k in range(4 if t == 2 else 6):
            a = k / (4 if t == 2 else 6) * math.tau + math.pi / 4
            x, z = math.cos(a) * r, math.sin(a) * r
            fin = [(x - 0.012, -length * 0.85), (x + 0.012, -length * 0.85), (x + 0.012, -0.08), (x - 0.012, -0.08)]
            C.slab(mb, fin, z - 0.035, z + 0.035, "livery_secondary")
    if t == 3:  # twin afterburner rings
        for sx in (-1, 1):
            C.torus_ring(mb, sx * r * 0.55, -length - 0.08, -r * 0.35, r * 0.28, 0.02, 12, 4, "glow")
    return mb.finish(bounds_of(r + length))


def booster(t):
    mb = C.MeshBuilder(f"booster_t{t}_mesh")
    r = 0.08 + 0.022 * t
    length = 0.55 + 0.18 * t
    x = r * 0.9  # sits against the pod flank, outwards (+X)
    secs = [(-length / 2, x, 0.0, r * 0.75, r * 0.75), (-length / 2 + 0.05, x, 0.0, r, r), (length / 2 - 0.12, x, 0.0, r, r), (length / 2, x, 0.0, r * 0.2, r * 0.2)]
    C.loft(mb, secs, 12, 2.0, "livery_secondary")
    C.torus_ring(mb, x, -length / 2 - 0.005, 0.0, r * 0.7, 0.015, 12, 4, "metal")
    C.disc(mb, x, -length / 2 - 0.01, 0.0, r * 0.62, 12, "glow")
    if t >= 1:  # glow stripe
        C.slab(mb, [(x + r * 0.9, -length / 2 + 0.08), (x + r * 1.02, -length / 2 + 0.08), (x + r * 1.02, length / 2 - 0.15), (x + r * 0.9, length / 2 - 0.15)], -0.012, 0.012, "glow")
    if t >= 2:  # mounting strut + fin
        C.slab(mb, [(0.0, -0.1), (x, -0.1), (x, 0.1), (0.0, 0.1)], -0.02, 0.02, "metal")
        C.fin(mb, r * 0.8, 0.08 + 0.03 * t, 0.25, 0.1, 0.08, 0.02, "livery_primary", x=x)
    if t == 3:  # second canister below
        secs2 = [(y, x2, z2 - r * 1.7, w * 0.6, h * 0.6) for (y, x2, z2, w, h) in secs]
        C.loft(mb, secs2, 10, 2.0, "livery_secondary")
        C.disc(mb, x, -length / 2 - 0.01, -r * 1.7, r * 0.38, 10, "glow")
    return mb.finish(bounds_of(length))


def stabilizer(t):
    mb = C.MeshBuilder(f"stabilizer_t{t}_mesh")
    span = 0.45 + 0.22 * t
    chord = 0.28 + 0.06 * t
    h = 0.14 + 0.06 * t
    # pylons
    for sx in ((-0.12, 0.12) if t < 2 else (-span * 0.7, span * 0.7)):
        C.slab(mb, [(sx - 0.02, -chord * 0.4), (sx + 0.02, -chord * 0.4), (sx + 0.02, 0.0), (sx - 0.02, 0.0)], 0.0, h, "metal")
    # wing
    wing = [(-span, -chord * 0.7), (span, -chord * 0.7), (span * 0.9, 0.0), (-span * 0.9, 0.0)]
    C.slab(mb, wing, h, h + 0.035, "livery_secondary")
    if t >= 1:  # glow trailing edge
        C.slab(mb, [(-span, -chord * 0.72), (span, -chord * 0.72), (span, -chord * 0.66), (-span, -chord * 0.66)], h + 0.005, h + 0.03, "glow")
    if t >= 2:  # end plates
        for sx in (-1, 1):
            C.fin(mb, h - 0.06, 0.16 + 0.04 * t, chord, chord * 0.6, 0.06, 0.025, "livery_primary", x=sx * span)
    if t == 3:  # second, higher element
        C.slab(mb, [(-span * 0.8, -chord * 0.75), (span * 0.8, -chord * 0.75), (span * 0.72, -chord * 0.3), (-span * 0.72, -chord * 0.3)], h + 0.14, h + 0.17, "livery_secondary")
    return mb.finish(bounds_of(span))


def hull(t):
    mb = C.MeshBuilder(f"hull_t{t}_mesh")
    w = 0.16 + 0.07 * t
    length = 0.45 + 0.2 * t
    th = 0.03 + 0.015 * t
    # centre armour plate (tapered towards the nose)
    C.slab(mb, [(-w, -length / 2), (w, -length / 2), (w * 0.6, length / 2), (-w * 0.6, length / 2)], 0.0, th, "livery_secondary")
    if t >= 1:  # glow seam
        C.slab(mb, [(-0.012, -length / 2 + 0.05), (0.012, -length / 2 + 0.05), (0.012, length / 2 - 0.05), (-0.012, length / 2 - 0.05)], th, th + 0.012, "glow")
    if t >= 2:  # side plates
        for sx in (-1, 1):
            x0 = sx * (w + 0.02)
            x1 = sx * (w + 0.16 + 0.04 * t)
            plate = [(x0, -length / 2), (x1, -length / 2 + 0.08), (x1, length / 2 - 0.12), (x0, length / 2)]
            if sx < 0:
                plate = list(reversed(plate))
            C.slab(mb, plate, -0.06, th - 0.01, "dark")
    if t == 3:  # armoured crest
        C.fin(mb, th, 0.12, length * 0.8, length * 0.4, 0.1, 0.05, "livery_primary")
    return mb.finish(bounds_of(length))


BUILDERS = {"engine": engine, "booster": booster, "stabilizer": stabilizer, "hull": hull}


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/parts"))
    C.reset_scene()
    objs = []
    report = {}
    for slot, fn in BUILDERS.items():
        for t in range(4):
            root = bpy.data.objects.new(f"{slot}_t{t}", None)
            bpy.context.scene.collection.objects.link(root)
            mesh = fn(t)
            mesh.parent = root
            objs += [root, mesh]
            report[root.name] = C.triangle_count(mesh)
    path = os.path.join(out_dir, "parts.glb")
    C.export_glb(path, objs)
    print(f"[parts] {report} -> {path}")


main()
