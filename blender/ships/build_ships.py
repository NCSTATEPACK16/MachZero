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


GROUNDED = {"comet": build_comet}


def ship_bounds(d):
    half_w = d["podX"] + d["podR"]
    return (Vector((-half_w, y_of(HULL_TAIL_Z) - 0.1, -0.45)), Vector((half_w, y_of(HULL_NOSE_Z), d["hullTop"] + 0.5)))


def build(cid, out_dir):
    C.reset_scene()
    d = DESIGNS[cid]
    bounds = ship_bounds(d)
    root = bpy.data.objects.new(cid, None)
    bpy.context.scene.collection.objects.link(root)
    objs = [root]
    lods = []
    for level in (0, 1):
        o = GROUNDED[cid](level, bounds) if cid in GROUNDED else build_ship(cid, d, level, bounds)
        o.parent = root
        objs.append(o)
        lods.append(o)
    if cid in GROUNDED:
        C.bake_vertex_ao(lods)
        d = {**d, **COMET} if cid == "comet" else d
    tail = y_of(HULL_TAIL_Z)
    pod_tail = y_of(d["podZ1"])
    pod_mid = y_of(d["podZ0"] + 0.62 * (d["podZ1"] - d["podZ0"]))
    edge = d["podX"] + d["podR"]
    sockets = [
        ("socket_engine", (0.0, tail + 0.05, -0.12)),
        ("socket_booster_L", (-edge + 0.02, pod_mid, POD_Z)),
        ("socket_booster_R", (edge - 0.02, pod_mid, POD_Z)),
        ("socket_stabilizer", (0.0, y_of(1.35), d["hullTop"] - 0.01)),
        ("socket_hull", (0.0, y_of(-0.95), d["hullTop"] - 0.04)),
        ("socket_exhaust_L", (-d["podX"], pod_tail - 0.08, POD_Z)),
        ("socket_exhaust_R", (d["podX"], pod_tail - 0.08, POD_Z)),
        ("socket_camera", (0.0, tail - 7.0, 2.4)),
    ]
    for name, loc in sockets:
        objs.append(C.socket(name, loc, parent=root))
    tris = {o.name: C.triangle_count(o) for o in objs if o.type == "MESH"}
    path = os.path.join(out_dir, f"{cid}.glb")
    C.export_glb(path, objs, texcoords=cid in GROUNDED)
    print(f"[ships] {cid}: {tris} -> {path}")


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/ships"))
    only = C.arg_value("--only")
    for cid in DESIGNS:
        if only and cid != only:
            continue
        build(cid, out_dir)


main()
