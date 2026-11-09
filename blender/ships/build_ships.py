"""
Build the 6 MachZero 2.0 chassis as GLBs (one per ship, two LOD nodes each) plus sockets.

  Blender -b --factory-startup -P blender/ships/build_ships.py -- --out <dir> [--only comet]

Ships are modelled at Balanced size (v1 dimensions); the runtime scales the whole assembly by the class
scale in content/ships.ts (Light 0.9, Heavy 1.12), which also sizes the physics collider.
Design parameters mirror the procedural stand-ins in src/graphics/ShipModel.ts (converted to Blender
axes: three -Z forward = Blender +Y, three +Y up = Blender +Z).

§V (IMPLEMENTATION §V): chassis in GROUNDED are modelled from their concept (assets/reference/ships/<id>/chosen.jpg)
with trim-sheet UVs (TEXCOORD_0) and per-vertex AO baked into COLOR_0.a. V1 is COMET; the rest follow in V3.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402

# (hull half-width, hull top, pod x, pod radius, pod nose y, pod tail y, wing sweep, wing root (nose, tail) y offsets,
#  fin height, fin length, centre fin height, canards, canopy (w, h, l, y), nozzle style)
DESIGNS = {
    "comet": dict(hullPower=2.6, spike=0.0, armor=False, finCant=0.12, hullHW=0.6, hullTop=0.12, podX=0.98, podR=0.3, podZ0=-0.9, podZ1=2.2, wingSweep=0.9, wingRoot=(-0.35, 1.2), finH=0.5, finLen=1.1, centerFin=0.0, canards=False, canopy=(0.34, 0.3, 0.95, -0.4)),
    "dart": dict(hullPower=2.4, spike=0.55, armor=False, finCant=0.12, hullHW=0.55, hullTop=0.1, podX=1.02, podR=0.27, podZ0=-1.55, podZ1=2.25, wingSweep=1.35, wingRoot=(-0.2, 1.3), finH=0.68, finLen=1.3, centerFin=0.0, canards=True, canopy=(0.3, 0.25, 1.0, -0.2)),
    "arrow": dict(hullPower=2.2, spike=0.8, armor=False, finCant=0.05, hullHW=0.47, hullTop=0.12, podX=0.86, podR=0.22, podZ0=-0.4, podZ1=2.15, wingSweep=0.55, wingRoot=(0.0, 1.0), finH=0.3, finLen=0.8, centerFin=0.72, canards=False, canopy=(0.27, 0.28, 1.25, -0.55)),
    "wisp": dict(hullPower=2.3, spike=0.0, armor=False, finCant=0.55, hullHW=0.66, hullTop=0.14, podX=1.0, podR=0.34, podZ0=-0.6, podZ1=2.1, wingSweep=0.45, wingRoot=(-0.5, 1.5), finH=0.85, finLen=1.0, centerFin=0.0, canards=False, canopy=(0.4, 0.36, 0.9, -0.3)),
    "titan": dict(hullPower=3.4, spike=0.0, armor=True, finCant=0.08, hullHW=0.74, hullTop=0.16, podX=1.1, podR=0.4, podZ0=-1.2, podZ1=2.25, wingSweep=0.7, wingRoot=(-0.3, 1.4), finH=0.45, finLen=1.2, centerFin=0.4, canards=True, canopy=(0.42, 0.28, 0.8, -0.1)),
    "bastion": dict(hullPower=4.5, spike=0.0, armor=True, finCant=0.0, hullHW=0.78, hullTop=0.2, podX=1.04, podR=0.38, podZ0=-0.3, podZ1=2.2, wingSweep=0.35, wingRoot=(-0.45, 1.6), finH=0.35, finLen=1.4, centerFin=0.0, canards=False, canopy=(0.44, 0.34, 0.85, -0.5)),
}

POD_Z = -0.16  # pod centre height (three POD_Y)
HULL_NOSE_Z = -2.25  # three z of the hull nose
HULL_TAIL_Z = 2.15
LODS = {0: dict(ring=32, pod=20, sections=1.0, detail=True), 1: dict(ring=12, pod=10, sections=0.5, detail=False)}


def y_of(three_z):
    """three z (forward -Z) -> Blender y (forward +Y)."""
    return -three_z


def hull_sections(d, lod):
    top = d["hullTop"]
    hw = d["hullHW"]
    # v1 profile, nose (s=0) to tail (s=1): (s, width fraction, bottom, top)
    prof = [
        (0.0, 0.0, -0.14, -0.14),
        (0.02, 0.08, -0.22, -0.08),
        (0.05, 0.16, -0.3, -0.02),
        (0.1, 0.28, -0.34, 0.02),
        (0.18, 0.42, -0.38, 0.05),
        (0.28, 0.58, -0.4, 0.09),
        (0.38, 0.72, -0.42, top),
        (0.48, 0.83, -0.42, top + 0.012),
        (0.58, 0.9, -0.42, top + 0.02),
        (0.68, 0.94, -0.41, top + 0.012),
        (0.78, 0.96, -0.4, top),
        (0.86, 0.93, -0.37, top - 0.025),
        (0.92, 0.86, -0.34, top - 0.05),
        (1.0, 0.72, -0.3, top - 0.1),
    ]
    if lod["sections"] < 1:
        prof = [p for i, p in enumerate(prof) if i % 2 == 0 or i == len(prof) - 1]
    out = []
    for (s, w, z0, z1) in reversed(prof):  # tail -> nose
        tz = HULL_NOSE_Z + s * (HULL_TAIL_Z - HULL_NOSE_Z)
        out.append((y_of(tz), 0.0, (z0 + z1) / 2, max(w * hw, 0.002), max((z1 - z0) / 2, 0.002)))
    return out


def build_ship(cid, d, lod_level, bounds):
    lod = LODS[lod_level]
    mb = C.MeshBuilder(f"{cid}_LOD{lod_level}")
    detail = lod["detail"]

    # ---- hull (primary) + dark belly plate ----
    C.loft(mb, hull_sections(d, lod), lod["ring"], d["hullPower"], "livery_primary")
    # engine bay at the hull tail: dark recess ring + glow core
    tail_y = y_of(HULL_TAIL_Z)
    bay_r = d["hullHW"] * 0.42
    C.torus_ring(mb, 0.0, tail_y - 0.02, -0.14, bay_r, 0.05, lod["pod"], 5 if detail else 4, "dark")
    C.disc(mb, 0.0, tail_y - 0.03, -0.14, bay_r * 0.9, lod["pod"], "glow")
    # nose spike (light / needle ships)
    if d["spike"] > 0:
        ny = y_of(HULL_NOSE_Z)
        m = 8 if detail else 5
        spike = [(ny - 0.25 + (d["spike"] + 0.25) * i / m, 0.0, -0.14, 0.05 * (1 - i / m) + 0.004, 0.035 * (1 - i / m) + 0.003) for i in range(m + 1)]
        C.loft(mb, spike, 8 if detail else 6, 2.0, "metal")
    # armour plates along the flanks (heavy ships)
    if d["armor"]:
        for sign in (-1, 1):
            ax = sign * d["hullHW"] * 0.93
            for k, (a, b) in enumerate(((1.25, 0.45), (0.3, -0.5))):
                plate = [(ax - 0.05, y_of(b)), (ax + 0.05, y_of(b)), (ax + 0.05, y_of(a)), (ax - 0.05, y_of(a))]
                C.slab(mb, plate, -0.3, d["hullTop"] - 0.05, "livery_secondary" if k == 0 else "dark")
    belly_w = d["hullHW"] * 0.62
    C.slab(mb, [(-belly_w, y_of(1.9)), (belly_w, y_of(1.9)), (belly_w * 0.7, y_of(-1.2)), (-belly_w * 0.7, y_of(-1.2))], -0.445, -0.41, "dark")

    # ---- canopy (glass) ----
    cw, ch, cl, cz = d["canopy"]
    cy = y_of(cz)
    n = 10 if detail else 5
    secs = []
    for i in range(n + 1):
        t = i / n  # tail -> nose
        f = math.sin(math.pi * t) ** 0.7
        secs.append((cy - cl / 2 + cl * t, 0.0, d["hullTop"] + 0.02 + ch * 0.45 * f, max(cw / 2 * f, 0.004), max(ch * 0.5 * f, 0.004)))
    C.loft(mb, secs, 16 if detail else 8, 2.2, "glass", cap_start=False, cap_end=False)

    # ---- pods, wings, fins, nozzles ----
    pod_len = d["podZ1"] - d["podZ0"]
    pod_prof = [(0.0, 0.05), (0.04, 0.35), (0.08, 0.55), (0.16, 0.76), (0.28, 0.92), (0.5, 0.99), (0.75, 1.0), (0.9, 0.95), (1.0, 0.86)]
    if not detail:
        pod_prof = [(0.0, 0.05), (0.08, 0.55), (0.28, 0.92), (0.75, 1.0), (1.0, 0.86)]
    for sign in (-1, 1):
        px = sign * d["podX"]
        r = d["podR"]
        secs = []
        for (s, k) in reversed(pod_prof):  # tail -> nose
            tz = d["podZ0"] + s * pod_len
            secs.append((y_of(tz), px, POD_Z, r * k, r * k))
        C.loft(mb, secs, lod["pod"], 2.0, "livery_primary")
        tail_y = y_of(d["podZ1"])
        # nozzle: metal collar + glow core
        C.torus_ring(mb, px, tail_y - 0.04, POD_Z, r * 0.78, r * 0.12, lod["pod"], 6 if detail else 4, "metal")
        C.disc(mb, px, tail_y - 0.05, POD_Z, r * 0.7, lod["pod"], "glow")
        # intake ring at the pod nose
        if detail:
            C.torus_ring(mb, px, y_of(d["podZ0"] + 0.12 * pod_len), POD_Z, r * 0.5, r * 0.06, 16, 4, "dark")
        # wing joining hull and pod (secondary), slightly below the hull top
        x0 = sign * d["hullHW"] * 0.75
        xt = sign * d["podX"]
        r0, r1 = d["wingRoot"]
        sw = d["wingSweep"]
        outline = [(x0, y_of(r0)), (xt, y_of(r0 + sw)), (xt, y_of(r1 + sw * 0.3)), (x0, y_of(r1))]
        if sign < 0:
            outline = list(reversed(outline))
        C.slab(mb, outline, -0.16, -0.06, "livery_secondary")
        # glow strip along the pod's outer flank
        gx = px + sign * r * 0.93
        g0, g1 = y_of(d["podZ0"] + 0.3 * pod_len), y_of(d["podZ0"] + 0.85 * pod_len)
        strip = [(gx - 0.012, g1), (gx + 0.012, g1), (gx + 0.012, g0), (gx - 0.012, g0)]
        C.slab(mb, strip, POD_Z + 0.02, POD_Z + 0.07, "glow")
        # pod fin (secondary)
        C.fin(mb, POD_Z + r * 0.8, d["finH"], d["finLen"], d["finLen"] * 0.45, d["finLen"] * 0.35, 0.05, "livery_secondary", x=px, cant=sign * d["finCant"])
        # canards
        if d["canards"]:
            cx0 = sign * d["hullHW"] * 0.3
            cxt = sign * (d["hullHW"] * 0.3 + 0.55)
            can = [(cx0, y_of(-1.45)), (cxt, y_of(-1.1)), (cxt, y_of(-0.95)), (cx0, y_of(-1.05))]
            if sign < 0:
                can = list(reversed(can))
            C.slab(mb, can, -0.1, -0.06, "livery_secondary")
    if d["centerFin"] > 0:
        C.fin(mb, d["hullTop"] - 0.02, d["centerFin"], 1.1, 0.45, 0.45, 0.05, "livery_secondary", x=0.0)
    # hull glow spine
    if detail:
        spine = [(-0.02, y_of(1.6)), (0.02, y_of(1.6)), (0.02, y_of(0.6)), (-0.02, y_of(0.6))]
        C.slab(mb, spine, d["hullTop"] - 0.03, d["hullTop"] + 0.025, "glow")

    return mb.finish(bounds)


# --------------------------------------------------------------------------------------------- §V COMET
# assets/reference/ships/comet/chosen.jpg: a blue tube fuselage with a white spine stripe and white lower chine, a
# dark belly, a dark ram-intake mouth for a nose, a bubble canopy, dark side scoops, short engine pods on carbon
# outrigger pylons (white intake collars, cyan turbine faces and nozzles), small swept white wings outboard of the
# pods with carbon trailing edges, and twin canted tail fins. Hull, pods and fins stay inside the v1 bounding box
# (±10%, checked by scripts/check-assets.mjs).
COMET = dict(hullHW=0.6, hullTop=0.12, podX=0.86, podR=0.27, podZ0=0.0, podZ1=1.75)
COMET_PROFILE = [
    # s (0 nose .. 1 tail), width fraction, bottom, top
    (0.0, 0.5, -0.34, -0.04),
    (0.025, 0.6, -0.38, 0.0),
    (0.07, 0.7, -0.41, 0.04),
    (0.16, 0.79, -0.43, 0.075),
    (0.28, 0.85, -0.44, 0.11),
    (0.42, 0.9, -0.44, 0.13),
    (0.56, 0.94, -0.43, 0.135),
    (0.7, 0.95, -0.41, 0.125),
    (0.82, 0.92, -0.38, 0.105),
    (0.92, 0.84, -0.34, 0.07),
    (1.0, 0.72, -0.3, 0.03),
]


def comet_hull_role(s, t):
    """Paint scheme by position: s along (0 nose), t around (0 = +X, 0.25 = top, 0.75 = bottom)."""
    if s < 0.025:
        return "dark", "brushed"  # the intake lip
    up = abs(t - 0.25)
    if up < 0.075 and s < 0.62:
        return "livery_secondary", "plate"  # white spine stripe, nose to canopy
    if abs(t - 0.75) < 0.13:
        return "dark", "grip"  # belly
    if 0.86 < t < 0.97 or 0.53 < t < 0.64:
        return "livery_secondary", "plate"  # white lower chine band
    return "livery_primary", "panel"


def comet_loft(mb, rows, segments, power, role_fn, panels):
    """Hull loft with a paint scheme: rows = (s, y, cz, hw, hh) tail -> nose; role_fn(s, t) -> (role, strip)."""
    verts = []
    for (_s, y, cz, hw, hh) in rows:
        verts.extend(C.superellipse_ring(0.0, cz, hw, hh, y, segments, power))
    per = max(1, segments // panels)
    groups = {}
    for i in range(len(rows) - 1):
        s_mid = (rows[i][0] + rows[i + 1][0]) / 2
        for j in range(segments):
            t = (j + 0.5) / segments
            key = role_fn(s_mid, t)
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            c = (i + 1) * segments + (j + 1) % segments
            d = (i + 1) * segments + j
            u0, u1 = rows[i][1] * C.U_PER_M, rows[i + 1][1] * C.U_PER_M
            f0 = (j % per) / per
            f1 = f0 + 1.0 / per
            groups.setdefault(key, ([], []))
            groups[key][0].append((a, b, c, d))
            groups[key][1].append([(u0, f0), (u0, f1), (u1, f1), (u1, f0)])
    for (role, strip), (faces, uvs) in groups.items():
        mb.add_faces(verts, faces, role, strip, uvs)
    return verts


def build_comet(lod_level, bounds):
    d = COMET
    detail = lod_level == 0
    ring = 40 if detail else 16
    pod_seg = 24 if detail else 10
    mb = C.MeshBuilder(f"comet_LOD{lod_level}")
    hw, top = d["hullHW"], d["hullTop"]
    prof = COMET_PROFILE if detail else [p for i, p in enumerate(COMET_PROFILE) if i % 2 == 0 or i == len(COMET_PROFILE) - 1]
    rows = []
    for (s, w, z0, z1) in reversed(prof):  # tail -> nose
        tz = HULL_NOSE_Z + s * (HULL_TAIL_Z - HULL_NOSE_Z)
        rows.append((s, y_of(tz), (z0 + z1) / 2, w * hw, (z1 - z0) / 2))
    comet_loft(mb, rows, ring, 2.7, comet_hull_role, 4)
    # tail cap (engine bay) and the ram-intake mouth: a dark tunnel into the nose with a vent at its end
    s_t, y_t, cz_t, hw_t, hh_t = rows[0]
    C.loft(mb, [(y_t - 0.05, 0.0, cz_t, hw_t * 0.82, hh_t * 0.82), (y_t, 0.0, cz_t, hw_t, hh_t)], ring, 2.7, "dark", cap_start=True, cap_end=False, strip="ribbed")
    C.torus_ring(mb, 0.0, y_t - 0.06, -0.14, hw * 0.4, 0.05, pod_seg, 6 if detail else 4, "metal", strip="ribbed")
    C.disc(mb, 0.0, y_t - 0.07, -0.14, hw * 0.37, pod_seg, "glow", strip="flat")
    s_n, y_n, cz_n, hw_n, hh_n = rows[-1]
    mouth = [(y_n - 0.42, 0.0, cz_n - 0.01, hw_n * 0.62, hh_n * 0.55), (y_n - 0.08, 0.0, cz_n, hw_n * 0.8, hh_n * 0.76), (y_n + 0.005, 0.0, cz_n, hw_n * 0.86, hh_n * 0.84)]
    C.loft(mb, mouth, ring, 2.7, "dark", cap_start=True, cap_end=False, strip="vent")
    C.torus_ring(mb, 0.0, y_n - 0.005, cz_n, (hw_n + hh_n) * 0.46, 0.035, ring, 6 if detail else 4, "dark", strip="brushed") if detail else None

    # canopy: glass bubble in a white surround
    cw, ch, cl, cz = 0.34, 0.27, 1.05, -0.35
    cy = y_of(cz)
    n = 12 if detail else 6
    frame, glass = [], []
    for i in range(n + 1):
        t = i / n  # tail -> nose
        f = math.sin(math.pi * t) ** 0.6
        y = cy - cl / 2 + cl * t
        frame.append((y, 0.0, top + 0.02 + ch * 0.2 * f, max(cw / 2 * f + 0.05, 0.02), max(ch * 0.25 * f, 0.01)))
        glass.append((y, 0.0, top + 0.03 + ch * 0.45 * f, max(cw / 2 * f, 0.004), max(ch * 0.5 * f, 0.004)))
    C.loft(mb, frame, 16 if detail else 8, 2.4, "livery_secondary", strip="plate")
    C.loft(mb, glass, 20 if detail else 8, 2.2, "glass", cap_start=False, cap_end=False, strip="flat")

    # side scoops (dark, louvred) behind the canopy, with a cyan strip above each
    for sign in (-1, 1):
        x_in = sign * hw * 0.86
        x_out = sign * hw * 1.02
        y0, y1 = y_of(0.55), y_of(-0.15)
        scoop = [(x_in, y0), (x_out, y0 + 0.08), (x_out, y1), (x_in, y1)] if sign > 0 else [(x_in, y1), (x_out, y1), (x_out, y0 + 0.08), (x_in, y0)]
        C.slab(mb, scoop, -0.26, -0.03, "dark", strip="vent", edge_strip="carbon")
        gx = sign * hw * 0.95
        strip = [(gx - 0.012, y_of(0.9)), (gx + 0.012, y_of(0.9)), (gx + 0.012, y_of(-0.75)), (gx - 0.012, y_of(-0.75))]
        C.slab(mb, strip, 0.02, 0.05, "glow", strip="flat")

    # engine pods on outrigger pylons
    pod_len = d["podZ1"] - d["podZ0"]
    pod_prof = [(0.0, 0.62), (0.05, 0.9), (0.14, 1.0), (0.24, 1.0), (0.26, 0.97), (0.5, 0.97), (0.8, 0.96), (0.92, 0.9), (1.0, 0.78)]
    if not detail:
        pod_prof = [(0.0, 0.62), (0.14, 1.0), (0.5, 0.97), (1.0, 0.78)]
    for sign in (-1, 1):
        px = sign * d["podX"]
        r = d["podR"]
        secs_white, secs_blue = [], []
        for (sp, k) in reversed(pod_prof):  # tail -> nose
            tz = d["podZ0"] + sp * pod_len
            sec = (y_of(tz), px, POD_Z, r * k, r * k)
            (secs_white if sp <= 0.26 else secs_blue).append(sec)
        secs_blue.append(secs_white[0])  # overlap the collar seam
        C.loft(mb, secs_blue, pod_seg, 2.0, "livery_primary", cap_start=False, cap_end=False, strip="panel", panels=3)
        C.loft(mb, secs_white, pod_seg, 2.0, "livery_secondary", cap_start=False, cap_end=False, strip="plate", panels=3)
        # intake face: dark ring and a glowing turbine
        y_in = y_of(d["podZ0"])
        C.torus_ring(mb, px, y_in - 0.01, POD_Z, r * 0.56, r * 0.07, pod_seg, 6 if detail else 4, "dark", strip="ribbed")
        C.loft(mb, [(y_in - 0.12, px, POD_Z, r * 0.5, r * 0.5), (y_in, px, POD_Z, r * 0.62, r * 0.62)], pod_seg, 2.0, "dark", cap_start=False, cap_end=False, strip="ribbed")
        C.disc(mb, px, y_in - 0.12, POD_Z, r * 0.5, pod_seg, "glow", facing=1, strip="flat")
        # nozzle: dark collar, ribbed metal ring, glowing core
        y_tail = y_of(d["podZ1"])
        C.loft(mb, [(y_tail - 0.14, px, POD_Z, r * 0.68, r * 0.68), (y_tail + 0.02, px, POD_Z, r * 0.8, r * 0.8)], pod_seg, 2.0, "dark", cap_start=False, cap_end=False, strip="ribbed")
        C.torus_ring(mb, px, y_tail - 0.14, POD_Z, r * 0.64, r * 0.08, pod_seg, 6 if detail else 4, "metal", strip="ribbed")
        C.disc(mb, px, y_tail - 0.13, POD_Z, r * 0.6, pod_seg, "glow", strip="flat")
        # cyan band at the collar and a rear accent ring
        if detail:
            C.torus_ring(mb, px, y_of(d["podZ0"] + 0.27 * pod_len), POD_Z, r * 0.97, 0.012, pod_seg, 4, "glow", strip="flat")
        # outrigger pylon (carbon) from hull to pod, white cap on top
        x0 = sign * hw * 0.78
        x1 = sign * (d["podX"] - r * 0.4)
        ya, yb = y_of(d["podZ0"] + 0.3 * pod_len), y_of(d["podZ0"] + 0.95 * pod_len)
        pylon = [(x0, yb), (x1, yb + 0.1), (x1, ya), (x0, ya + 0.25)]
        if sign < 0:
            pylon = list(reversed(pylon))
        C.slab(mb, pylon, POD_Z - 0.07, POD_Z + 0.03, "dark", strip="carbon")
        cap = [(x0, ya + 0.12), (x1, ya - 0.02), (x1, ya - 0.2), (x0, ya - 0.05)]
        if sign < 0:
            cap = list(reversed(cap))
        C.slab(mb, cap, POD_Z + 0.03, POD_Z + 0.06, "livery_secondary", strip="plate")
        # swept wing outboard of the pod: white with a carbon trailing edge
        xw0 = sign * (d["podX"] + r * 0.5)
        xw1 = sign * (d["podX"] + r + 0.24)
        yr0, yr1 = y_of(d["podZ0"] + 0.4 * pod_len), y_of(d["podZ0"] + 0.88 * pod_len)
        wing = [(xw0, yr0), (xw1, yr0 - 0.45), (xw1, yr1 - 0.15), (xw0, yr1)]
        trail = [(xw0, yr1), (xw1, yr1 - 0.15), (xw1, yr1 - 0.27), (xw0, yr1 - 0.14)]
        if sign < 0:
            wing, trail = list(reversed(wing)), list(reversed(trail))
        C.slab(mb, wing, POD_Z - 0.02, POD_Z + 0.02, "livery_secondary", strip="plate")
        C.slab(mb, trail, POD_Z - 0.02, POD_Z + 0.015, "dark", strip="carbon")
        if detail:
            tip = [(xw1 - sign * 0.02, yr1 - 0.2), (xw1 + sign * 0.0, yr1 - 0.2), (xw1, yr1 - 0.26), (xw1 - sign * 0.02, yr1 - 0.26)]
            if sign < 0:
                tip = list(reversed(tip))
            C.slab(mb, tip, POD_Z - 0.025, POD_Z + 0.025, "glow", strip="flat")
        # twin canted tail fins on the hull
        C.fin(mb, top - 0.03, 0.48, 0.8, 0.34, 0.45, 0.05, "livery_secondary", x=sign * hw * 0.55, cant=sign * 0.42, strip="plate", y=y_of(1.55))
        if detail:  # blue fin tip
            C.fin(mb, top - 0.03 + 0.42, 0.08, 0.5, 0.38, 0.06, 0.056, "livery_primary", x=sign * (hw * 0.55 + math.sin(0.42) * 0.42), cant=sign * 0.42, strip="panel", y=y_of(1.55) - 0.43)
    # glow spine behind the canopy
    if detail:
        spine = [(-0.02, y_of(1.5)), (0.02, y_of(1.5)), (0.02, y_of(0.35)), (-0.02, y_of(0.35))]
        C.slab(mb, spine, top - 0.01, top + 0.03, "glow", strip="flat")
    return mb.finish(bounds)



# --------------------------------------------------------------------------------------------- §V V3 helpers
# Shared building blocks for the V3 chassis (DART, WISP, ARROW, TITAN, BASTION). Coordinates: Blender (+Y nose, +Z
# up); `y_of` converts the three z used by the v1 tables. COMET keeps its own builder above (approved as built).


def hull_rows(profile, hw, nose_z, tail_z, detail):
    """Painted-loft rows (s, y, cz, hw, hh) tail -> nose from a profile of (s 0 nose..1 tail, width frac, bottom, top).
    LOD1 keeps every other row (and both ends)."""
    prof = profile if detail else [p for i, p in enumerate(profile) if i % 2 == 0 or i == len(profile) - 1]
    rows = []
    for (s, w, z0, z1) in reversed(prof):
        tz = nose_z + s * (tail_z - nose_z)
        rows.append((s, y_of(tz), (z0 + z1) / 2, max(w * hw, 0.004), max((z1 - z0) / 2, 0.004)))
    return rows


def canopy(mb, detail, top, cw, ch, cl, cz, frame_role="livery_secondary", frame_strip="plate", rise=0.45, pw=0.6, frame_w=0.05):
    """A glass bubble in a painted surround, centred at three z `cz` (comet's canopy, parametrised)."""
    cy = y_of(cz)
    n = 12 if detail else 6
    frame, glass = [], []
    for i in range(n + 1):
        t = i / n
        f = math.sin(math.pi * t) ** pw
        y = cy - cl / 2 + cl * t
        frame.append((y, 0.0, top + 0.02 + ch * 0.2 * f, max(cw / 2 * f + frame_w, 0.02), max(ch * 0.25 * f, 0.01)))
        glass.append((y, 0.0, top + 0.03 + ch * rise * f, max(cw / 2 * f, 0.004), max(ch * 0.5 * f, 0.004)))
    C.loft(mb, frame, 16 if detail else 8, 2.4, frame_role, strip=frame_strip)
    C.loft(mb, glass, 20 if detail else 8, 2.2, "glass", cap_start=False, cap_end=False, strip="flat")


def beam(mb, a, b, w, h, role, strip):
    """A box beam from point a to b (truss struts, grab rails), w across and h up."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    up = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    side = d.cross(up).normalized()
    upv = side.cross(d).normalized()
    pts = []
    for p in (a, b):
        for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            q = p + side * (sx * w / 2) + upv * (sz * h / 2)
            pts.append((q.x, q.y, q.z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mb.add_faces(pts, faces, role, strip)


def mirror_outline(outline, sign):
    """Keep a slab outline counter-clockwise from above on either side."""
    return list(reversed(outline)) if sign < 0 else outline


def pod(mb, detail, sign, px, r, z0, z1, *, main=("livery_primary", "panel"), collar=("livery_secondary", "plate"), collar_s=0.26,
        power=2.0, prof=None, intake="turbine", nozzle_glow=True, pz=POD_Z, band=True):
    """An engine pod along the ship (three z0 front .. z1 tail): a collar section at the front, main paint behind,
    an intake face (glowing turbine or dark grille), a ribbed nozzle with a glowing core and an optional glow band
    at the collar seam. `power` 2 = round, 4 = square-edged."""
    seg = 24 if detail else 10
    pod_len = z1 - z0
    prof = prof or [(0.0, 0.62), (0.05, 0.9), (0.14, 1.0), (0.24, 1.0), (collar_s, 0.97), (0.5, 0.97), (0.8, 0.96), (0.92, 0.9), (1.0, 0.78)]
    if not detail:
        prof = [prof[0], prof[2], prof[5], prof[-1]] if len(prof) > 6 else prof
    front, back = [], []
    for (sp, k) in reversed(prof):
        sec = (y_of(z0 + sp * pod_len), px, pz, r * k, r * k)
        (front if sp <= collar_s else back).append(sec)
    if not back:
        back = front[:1]
    back.append(front[0])
    C.loft(mb, back, seg, power, main[0], cap_start=False, cap_end=False, strip=main[1], panels=3)
    if len(front) > 1:
        C.loft(mb, front, seg, power, collar[0], cap_start=False, cap_end=False, strip=collar[1], panels=3)
    y_in = y_of(z0)
    k0 = prof[0][1]
    if intake == "turbine":
        C.torus_ring(mb, px, y_in - 0.01, pz, r * k0 * 0.9, r * 0.07, seg, 6 if detail else 4, "dark", strip="ribbed")
        C.loft(mb, [(y_in - 0.12, px, pz, r * k0 * 0.8, r * k0 * 0.8), (y_in, px, pz, r * k0, r * k0)], seg, power, "dark", cap_start=False, cap_end=False, strip="ribbed")
        C.disc(mb, px, y_in - 0.12, pz, r * k0 * 0.8, seg, "glow", facing=1, strip="flat")
    else:  # grille: a dark louvred plug
        C.loft(mb, [(y_in - 0.1, px, pz, r * k0 * 0.85, r * k0 * 0.85), (y_in, px, pz, r * k0, r * k0)], seg, power, "dark", cap_start=True, cap_end=False, strip="vent")
    y_tail = y_of(z1)
    C.loft(mb, [(y_tail - 0.14, px, pz, r * 0.68, r * 0.68), (y_tail + 0.02, px, pz, r * 0.8, r * 0.8)], seg, power, "dark", cap_start=False, cap_end=False, strip="ribbed")
    C.torus_ring(mb, px, y_tail - 0.14, pz, r * 0.64, r * 0.08, seg, 6 if detail else 4, "glow" if nozzle_glow else "metal", strip="flat" if nozzle_glow else "ribbed")
    C.disc(mb, px, y_tail - 0.13, pz, r * 0.6, seg, "glow", strip="flat")
    if detail and band:
        C.torus_ring(mb, px, y_of(z0 + (collar_s + 0.01) * pod_len), pz, r * 0.97, 0.012, seg, 4, "glow", strip="flat")


def grounded_sockets(cfg):
    return {k: cfg[k] for k in ("podX", "podR", "podZ0", "podZ1", "hullTop")}



def profile_width(profile, s):
    """Width fraction of a hull profile at s (linear between rows)."""
    for (s0, w0, *_), (s1, w1, *_) in zip(profile, profile[1:]):
        if s0 <= s <= s1:
            return w0 + (w1 - w0) * (s - s0) / max(s1 - s0, 1e-6)
    return profile[-1][1]


def tail_bay(mb, detail, rows, hw, power):
    """Engine bay at the hull tail: a dark ribbed cap, a metal ring and a glowing core (as on COMET)."""
    _s, y_t, cz_t, hw_t, hh_t = rows[0]
    seg = 24 if detail else 10
    C.loft(mb, [(y_t - 0.05, 0.0, cz_t, hw_t * 0.82, hh_t * 0.82), (y_t, 0.0, cz_t, hw_t, hh_t)], len_ring(detail), power, "dark", cap_start=True, cap_end=False, strip="ribbed")
    C.torus_ring(mb, 0.0, y_t - 0.06, cz_t, min(hw_t, hh_t) * 0.62, 0.04, seg, 6 if detail else 4, "metal", strip="ribbed")
    C.disc(mb, 0.0, y_t - 0.07, cz_t, min(hw_t, hh_t) * 0.58, seg, "glow", strip="flat")


def len_ring(detail):
    return 40 if detail else 16


# ---------------------------------------------------------------------------------------------------- DART
# assets/reference/ships/dart/chosen.jpg: an orange tube fuselage behind a long thin needle spike, dark carbon
# panels (the livery secondary: dark on the factory livery), an exposed dark lattice truss along the lower
# mid-fuselage, small orange canards near the nose, long slim pods on carbon pylons with dark intakes and amber
# nozzle rings, dark swept wings outboard of the pods and tall swept twin fins with orange tips. The spike counts
# toward length, so the body is shorter than v1's.
DART = dict(hullHW=0.44, hullTop=0.08, podX=0.92, podR=0.195, podZ0=-0.55, podZ1=2.2, noseZ=-1.9, tailZ=2.1, tipZ=-2.85, halfW=1.3)
DART_PROFILE = [
    (0.0, 0.32, -0.24, -0.1),
    (0.04, 0.45, -0.28, -0.06),
    (0.12, 0.6, -0.33, -0.01),
    (0.25, 0.75, -0.37, 0.03),
    (0.4, 0.86, -0.39, 0.07),
    (0.55, 0.94, -0.4, 0.09),
    (0.68, 0.97, -0.39, 0.085),
    (0.8, 0.95, -0.37, 0.07),
    (0.9, 0.85, -0.33, 0.04),
    (1.0, 0.7, -0.28, 0.0),
]


def dart_paint(s, t):
    if s < 0.035:
        return "dark", "brushed"  # spike collar
    if abs(t - 0.75) < 0.12:
        return "livery_secondary", "carbon"  # belly
    if 0.2 < s < 0.62 and (0.52 < t < 0.63 or 0.87 < t < 0.98):
        return "livery_secondary", "carbon"  # truss bay band
    if s > 0.6 and abs(t - 0.25) < 0.11:
        return "livery_secondary", "panel"  # dark rear deck between the fins
    return "livery_primary", "panel"


def build_dart(lod_level, bounds):
    d = DART
    detail = lod_level == 0
    mb = C.MeshBuilder(f"dart_LOD{lod_level}")
    hw, top = d["hullHW"], d["hullTop"]
    rows = hull_rows(DART_PROFILE, hw, d["noseZ"], d["tailZ"], detail)
    comet_loft(mb, rows, len_ring(detail), 2.5, dart_paint, 4)
    tail_bay(mb, detail, rows, hw, 2.5)
    # the needle spike (metal), from a dark collar; LOD1 is a 4-sided cone
    _s, y_n, cz_n, hw_n, hh_n = rows[-1]
    C.loft(mb, [(y_n - 0.02, 0.0, cz_n, hw_n, hh_n), (y_n + 0.1, 0.0, cz_n, hw_n * 0.45, hh_n * 0.5)], len_ring(detail), 2.5, "dark", cap_start=False, cap_end=True, strip="brushed")
    m = 6 if detail else 1
    tip = y_of(d["tipZ"])
    spike = [(y_n + 0.05 + (tip - y_n - 0.05) * i / m, 0.0, cz_n, 0.045 * (1 - i / m) + 0.003, 0.045 * (1 - i / m) + 0.003) for i in range(m + 1)]
    C.loft(mb, spike, 10 if detail else 4, 2.0, "metal", cap_start=True, cap_end=False, strip="brushed", panels=2)
    canopy(mb, detail, top, 0.3, 0.24, 1.05, -0.12, frame_role="livery_secondary", frame_strip="panel")

    def body_x(tz):
        s = (tz - d["noseZ"]) / (d["tailZ"] - d["noseZ"])
        return profile_width(DART_PROFILE, s) * hw

    for sign in (-1, 1):
        # exposed lattice truss along the lower mid-fuselage (LOD1: a flat dark slab)
        za, zb = -0.33, -0.15
        z_from, z_to = -1.05, 0.45
        if detail:
            n = 6
            prev = None
            for i in range(n + 1):
                tz = z_from + (z_to - z_from) * i / n
                x = sign * (body_x(tz) + 0.012)
                y = y_of(tz)
                if prev is not None:
                    px_, py_ = prev
                    beam(mb, (px_, py_, za), (x, y, za), 0.03, 0.03, "dark", "brushed")
                    beam(mb, (px_, py_, zb), (x, y, zb), 0.03, 0.03, "dark", "brushed")
                    z0, z1 = (za, zb) if i % 2 else (zb, za)
                    beam(mb, (px_, py_, z0), (x, y, z1), 0.025, 0.025, "dark", "brushed")
                prev = (x, y)
        else:
            x0 = sign * (body_x(z_from) + 0.012)
            x1 = sign * (body_x(z_to) + 0.012)
            slab = [(x0 - 0.01, y_of(z_from)), (x0 + 0.01, y_of(z_from)), (x1 + 0.01, y_of(z_to)), (x1 - 0.01, y_of(z_to))]
            C.slab(mb, slab if sign > 0 else list(reversed(slab)), za, zb, "dark", strip="vent")
        # amber pinline along the side, above the truss
        gx0 = sign * (body_x(-1.35) + 0.004)
        gx1 = sign * (body_x(0.55) + 0.004)
        pin = [(gx0 - 0.01, y_of(-1.35)), (gx0 + 0.01, y_of(-1.35)), (gx1 + 0.01, y_of(0.55)), (gx1 - 0.01, y_of(0.55))]
        C.slab(mb, pin if sign > 0 else list(reversed(pin)), -0.06, -0.03, "glow", strip="flat")
        # canards near the nose (orange, swept)
        cx0, cxt = sign * 0.2, sign * 0.62
        can = [(cx0, y_of(-1.62)), (cxt, y_of(-1.35)), (cxt, y_of(-1.22)), (cx0, y_of(-1.25))]
        C.slab(mb, mirror_outline(can, sign), -0.17, -0.13, "livery_primary", strip="panel", edge_strip="grip")
        # pod on a carbon pylon / inner wing
        px, r = sign * d["podX"], d["podR"]
        pod(mb, detail, sign, px, r, d["podZ0"], d["podZ1"], collar=("livery_secondary", "carbon"), collar_s=0.16, power=2.3, intake="grille")
        x_in, x_out = sign * hw * 0.8, sign * (d["podX"] - r * 0.5)
        inner = [(x_in, y_of(1.75)), (x_out, y_of(1.95)), (x_out, y_of(0.05)), (x_in, y_of(-0.35))]
        C.slab(mb, mirror_outline(inner, sign), POD_Z - 0.05, POD_Z + 0.02, "livery_secondary", strip="carbon", edge_strip="grip")
        # dark swept outer wing with an amber tip light
        xw0, xw1 = sign * (d["podX"] + r * 0.6), sign * 1.3
        wing = [(xw0, y_of(0.45)), (xw1, y_of(1.45)), (xw1, y_of(1.85)), (xw0, y_of(1.75))]
        C.slab(mb, mirror_outline(wing, sign), POD_Z - 0.03, POD_Z + 0.01, "livery_secondary", strip="carbon", edge_strip="grip")
        if detail:
            tipl = [(xw1 - sign * 0.03, y_of(1.6)), (xw1, y_of(1.6)), (xw1, y_of(1.8)), (xw1 - sign * 0.03, y_of(1.8))]
            C.slab(mb, mirror_outline(tipl, sign), POD_Z - 0.035, POD_Z + 0.015, "glow", strip="flat")
        # tall swept twin fins (dark) with orange tips
        fx = sign * hw * 0.62
        C.fin(mb, top - 0.04, 0.68, 0.95, 0.32, 0.66, 0.05, "livery_secondary", x=fx, cant=sign * 0.3, strip="panel", y=y_of(1.55))
        if detail:
            C.fin(mb, top - 0.04 + 0.6, 0.1, 0.4, 0.3, 0.1, 0.056, "livery_primary", x=fx + sign * math.sin(0.3) * 0.6, cant=sign * 0.3, strip="panel", y=y_of(1.55) - 0.6)
    # amber band behind the canopy
    if detail:
        C.slab(mb, [(-0.13, y_of(0.5)), (0.13, y_of(0.5)), (0.13, y_of(0.44)), (-0.13, y_of(0.44))], top - 0.005, top + 0.012, "glow", strip="flat")
    return mb.finish(bounds)



# ---------------------------------------------------------------------------------------------------- WISP
# assets/reference/ships/wisp/chosen.jpg: a short, wide, rounded fuselage that is almost all canopy (a very large
# bubble), white swoosh panels edged with a magenta pinline, a small dark ram nose with side scoops, short fat
# pods on white stub pylons (brushed intake lips, magenta rings), small swept white wings and very tall, strongly
# canted purple fins with white tips. More loft rings on LOD0 for the curves.
WISP = dict(hullHW=0.7, hullTop=0.16, podX=1.08, podR=0.3, podZ0=0.2, podZ1=1.62, noseZ=-2.0, tailZ=2.05, halfW=1.5,
            hullSock=(-1.5, 0.1), stabSock=(1.2, 0.12))
WISP_PROFILE = [
    (0.0, 0.62, -0.32, -0.02),
    (0.03, 0.72, -0.37, 0.03),
    (0.1, 0.84, -0.42, 0.09),
    (0.22, 0.94, -0.45, 0.14),
    (0.36, 0.98, -0.46, 0.17),
    (0.5, 0.95, -0.45, 0.17),
    (0.62, 0.82, -0.42, 0.14),
    (0.74, 0.6, -0.37, 0.1),
    (0.86, 0.42, -0.32, 0.07),
    (1.0, 0.32, -0.28, 0.04),
]


def wisp_paint(s, t):
    if s < 0.03:
        return "dark", "brushed"
    up = abs(t - 0.25)
    w = 0.075 if s < 0.3 else (0.0 if s < 0.62 else max(0.0, 0.07 * (0.78 - s) / 0.16))
    side = min(abs(t - 0.07), abs(t - 0.43))  # upper flanks: the swoosh toward the pylons
    sw = 0.03 if 0.45 < s < 0.72 else 0.0
    if up < w or side < sw:
        return "livery_secondary", "plate"
    if (w > 0 and up < w + 0.025) or (sw > 0 and side < sw + 0.025):
        return "glow", "flat"  # magenta pinline around the white
    if abs(t - 0.75) < 0.1:
        return "dark", "grip"
    return "livery_primary", "panel"


def build_wisp(lod_level, bounds):
    d = WISP
    detail = lod_level == 0
    mb = C.MeshBuilder(f"wisp_LOD{lod_level}")
    hw, top = d["hullHW"], d["hullTop"]
    ring = 48 if detail else 16
    rows = hull_rows(WISP_PROFILE, hw, d["noseZ"], d["tailZ"], detail)
    comet_loft(mb, rows, ring, 2.2, wisp_paint, 4)
    tail_bay(mb, detail, rows, hw, 2.2)
    # small dark ram nose
    _s, y_n, cz_n, hw_n, hh_n = rows[-1]
    mouth = [(y_n - 0.3, 0.0, cz_n - 0.01, hw_n * 0.6, hh_n * 0.5), (y_n - 0.06, 0.0, cz_n, hw_n * 0.78, hh_n * 0.72), (y_n + 0.005, 0.0, cz_n, hw_n * 0.84, hh_n * 0.8)]
    C.loft(mb, mouth, ring, 2.6, "dark", cap_start=True, cap_end=False, strip="vent")
    # the big bubble canopy in a white surround
    canopy(mb, detail, top, 0.66, 0.44, 1.75, -0.5, frame_role="livery_secondary", frame_strip="plate", pw=0.5, frame_w=0.06)
    for sign in (-1, 1):
        # dark louvred side scoops under the canopy
        x_in, x_out = sign * hw * 0.9, sign * hw * 1.0
        y0, y1 = y_of(-0.6), y_of(-1.1)
        scoop = [(x_in, y0), (x_out, y0), (x_out, y1 + 0.06), (x_in, y1)]
        C.slab(mb, mirror_outline(scoop, sign), -0.3, -0.12, "dark", strip="vent", edge_strip="carbon")
        # dark vents ahead of the pylons
        if detail:
            v = [(sign * hw * 0.55, y_of(0.35)), (sign * hw * 0.82, y_of(0.25)), (sign * hw * 0.82, y_of(0.05)), (sign * hw * 0.55, y_of(0.1))]
            C.slab(mb, mirror_outline(v, sign), 0.06, 0.1, "dark", strip="vent")
        # short fat pod on a white stub pylon
        px, r = sign * d["podX"], d["podR"]
        pod(mb, detail, sign, px, r, d["podZ0"], d["podZ1"], collar=("metal", "brushed"), collar_s=0.12, power=2.0)
        x0, x1 = sign * hw * 0.7, sign * (d["podX"] - r * 0.6)
        pyl = [(x0, y_of(1.45)), (x1, y_of(1.3)), (x1, y_of(0.55)), (x0, y_of(0.3))]
        C.slab(mb, mirror_outline(pyl, sign), POD_Z - 0.04, POD_Z + 0.05, "livery_secondary", strip="plate", edge_strip="grip")
        # small swept wing outboard of the pod, white with a glowing tip light
        xw0, xw1 = sign * (d["podX"] + r * 0.6), sign * 1.5
        wing = [(xw0, y_of(0.75)), (xw1, y_of(1.15)), (xw1, y_of(1.38)), (xw0, y_of(1.45))]
        C.slab(mb, mirror_outline(wing, sign), POD_Z - 0.02, POD_Z + 0.02, "livery_secondary", strip="plate", edge_strip="grip")
        if detail:
            tipl = [(xw1 - sign * 0.03, y_of(1.2)), (xw1, y_of(1.2)), (xw1, y_of(1.34)), (xw1 - sign * 0.03, y_of(1.34))]
            C.slab(mb, mirror_outline(tipl, sign), POD_Z - 0.025, POD_Z + 0.025, "glow", strip="flat")
        # very tall, strongly canted fins with white tips
        fx = sign * hw * 0.28
        C.fin(mb, top - 0.06, 0.82, 1.15, 0.42, 0.75, 0.05, "livery_primary", x=fx, cant=sign * 0.5, strip="panel", y=y_of(1.55))
        if detail:
            C.fin(mb, top - 0.06 + 0.74, 0.12, 0.5, 0.42, 0.11, 0.056, "livery_secondary", x=fx + sign * math.sin(0.5) * 0.74, cant=sign * 0.5, strip="plate", y=y_of(1.55) - 0.68)
    return mb.finish(bounds)


# chassis -> (builder, socket/bounds parameters); the rest still use build_ship + DESIGNS until V3 replaces them
COMET_SOCKETS = dict(podX=0.86, podR=0.27, podZ0=0.0, podZ1=1.75, hullTop=0.12, noseZ=HULL_NOSE_Z, halfW=1.28)
GROUNDED = {"comet": (build_comet, COMET_SOCKETS), "dart": (build_dart, DART), "wisp": (build_wisp, WISP)}


def ship_bounds(d):
    half_w = d["podX"] + d["podR"]
    return (Vector((-half_w, y_of(HULL_TAIL_Z) - 0.1, -0.45)), Vector((half_w, y_of(HULL_NOSE_Z), d["hullTop"] + 0.5)))


def grounded_bounds(g):
    """COLOR_0 body box of a §V chassis: tip of the nose (or spike) to the tail, out to its widest point."""
    tail = y_of(g.get("tailZ", HULL_TAIL_Z)) - 0.1
    return (Vector((-g["halfW"], tail, -0.45)), Vector((g["halfW"], y_of(g.get("tipZ", g["noseZ"])), g["hullTop"] + 0.5)))


def build(cid, out_dir):
    C.reset_scene()
    grounded = cid in GROUNDED
    if grounded:
        builder, d = GROUNDED[cid]
        bounds = grounded_bounds(d)
    else:
        d = DESIGNS[cid]
        bounds = ship_bounds(d)
    root = bpy.data.objects.new(cid, None)
    bpy.context.scene.collection.objects.link(root)
    objs = [root]
    lods = []
    for level in (0, 1):
        o = builder(level, bounds) if grounded else build_ship(cid, d, level, bounds)
        o.parent = root
        objs.append(o)
        lods.append(o)
    if grounded:
        C.bake_vertex_ao(lods)
    tail = y_of(d.get("tailZ", HULL_TAIL_Z))
    pod_tail = y_of(d["podZ1"])
    pod_mid = y_of(d["podZ0"] + 0.62 * (d["podZ1"] - d["podZ0"]))
    edge = d["podX"] + d["podR"]
    # part sockets on the deck; a §V chassis may move them (a big canopy, a low tail)
    stab = d.get("stabSock", (1.35, d["hullTop"] - 0.01))
    hull_s = d.get("hullSock", (-0.95, d["hullTop"] - 0.04))
    sockets = [
        ("socket_engine", (0.0, tail + 0.05, -0.12)),
        ("socket_booster_L", (-edge + 0.02, pod_mid, POD_Z)),
        ("socket_booster_R", (edge - 0.02, pod_mid, POD_Z)),
        ("socket_stabilizer", (0.0, y_of(stab[0]), stab[1])),
        ("socket_hull", (0.0, y_of(hull_s[0]), hull_s[1])),
        ("socket_exhaust_L", (-d["podX"], pod_tail - 0.08, POD_Z)),
        ("socket_exhaust_R", (d["podX"], pod_tail - 0.08, POD_Z)),
        ("socket_camera", (0.0, tail - 7.0, 2.4)),
    ]
    for name, loc in sockets:
        objs.append(C.socket(name, loc, parent=root))
    tris = {o.name: C.triangle_count(o) for o in objs if o.type == "MESH"}
    path = os.path.join(out_dir, f"{cid}.glb")
    C.export_glb(path, objs, texcoords=grounded)
    print(f"[ships] {cid}: {tris} -> {path}")


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/ships"))
    only = C.arg_value("--only")
    for cid in DESIGNS:
        if only and cid != only:
            continue
        build(cid, out_dir)


main()
