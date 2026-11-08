"""
Build the shared ship trim sheet (IMPLEMENTATION §V.1): one 1024² atlas of tiling surface-detail strips that every
ship and part maps onto with TEXCOORD_0. Detail only, no colour: the livery still tints the paint.

  Blender -b --factory-startup -P blender/textures/build_trim.py -- --out <dir>

Writes <dir>/trim_normal.png (tangent-space normal, OpenGL +Y, glTF UV convention) and <dir>/trim_orm.png
(lossless; npm run assets ships them as WebP) (glTF ORM packing: R = detail AO, G = roughness multiplier, B = metalness multiplier).

Eight horizontal strips (BANDS below; strip b covers v in [b/8, (b+1)/8], v measured from the bottom of the
image as Blender does). Each strip tiles along u, so a surface can run any length of it; across v a strip is one
self-contained profile (seams at its edges). blender/lib/common.py `trim_v` maps a 0..1 position across a strip
into the atlas.

The strips are built as height fields in numpy (seams, rivets, louvres, twill weave, brushed streaks, ribs),
then the normal map comes from the height gradient and the AO from a multi-radius cavity term. That is the
same result a Cycles bake of modelled strips onto a plane would give for these shallow features, but it is
exact, deterministic and takes seconds (the plan allowed a Cycles bake; recorded in the §V as-built notes).
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import bpy  # noqa: E402

import common as C  # noqa: E402

SIZE = 1024
BAND_PX = SIZE // 8
# Keep in sync with blender/lib/common.py TRIM_BANDS.
BANDS = ["panel", "plate", "carbon", "brushed", "vent", "ribbed", "grip", "flat"]

rng = np.random.default_rng(1977)  # deterministic


def tile_noise(h, w, cells_y, cells_x, octaves=3):
    """Tileable value noise in [0, 1] (wraps in x; y is a single band so it only needs to be smooth)."""
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cy, cx = cells_y * 2**o, cells_x * 2**o
        grid = rng.random((cy + 1, cx))
        ys = np.linspace(0, cy, h, endpoint=False)
        xs = np.linspace(0, cx, w, endpoint=False)
        y0 = np.floor(ys).astype(int)
        x0 = np.floor(xs).astype(int)
        fy = ys - y0
        fx = xs - x0
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        x1 = (x0 + 1) % cx
        a = grid[y0][:, x0]
        b = grid[y0][:, x1]
        c = grid[y0 + 1][:, x0]
        d = grid[y0 + 1][:, x1]
        top = a + (b - a) * fx[None, :]
        bot = c + (d - c) * fx[None, :]
        out += amp * (top + (bot - top) * fy[:, None])
        total += amp
        amp *= 0.5
    return out / total


def groove(dist, width):
    """A V-groove profile: 0 at the bottom of the groove, 1 on the flat."""
    return np.clip(dist / width, 0.0, 1.0) ** 0.7


def rivets(h, w, spacing, row_y, radius):
    """Domed rivets along a row (row_y in pixels), spacing in pixels (must divide w)."""
    yy, xx = np.mgrid[0:h, 0:w]
    dx = (xx % spacing) - spacing / 2
    dy = yy - row_y
    r = np.sqrt(dx * dx + dy * dy) / radius
    return np.clip(1 - r * r, 0, 1) ** 0.5


def band_panel(h, w):
    """Painted body panels: seams at the strip edges and every 512 px across, rivet rows beside the seams."""
    yy, xx = np.mgrid[0:h, 0:w]
    d_edge = np.minimum(yy, h - 1 - yy).astype(float)
    d_cross = np.minimum(xx % 512, 512 - (xx % 512)).astype(float)
    height = 0.6 * np.minimum(groove(d_edge - 1, 3), groove(d_cross - 1, 3))
    height += 0.35 * np.maximum(rivets(h, w, 32, 9, 2.6), rivets(h, w, 32, h - 10, 2.6))
    # a small access hatch every tile
    hx = (xx % 512) - 300
    hy = yy - h * 0.55
    hatch = np.maximum(np.abs(hx) - 46, np.abs(hy) - 18)
    height -= 0.25 * (1 - groove(np.abs(hatch), 1.6))
    height += 0.03 * tile_noise(h, w, 8, 64)  # orange peel
    rough = 0.92 + 0.08 * tile_noise(h, w, 4, 32)
    metal = np.ones((h, w))
    return height, rough, metal


def band_plate(h, w):
    """Secondary plating: wider plates, double rivet rows and worn (rougher, more metallic) plate edges."""
    yy, xx = np.mgrid[0:h, 0:w]
    d_edge = np.minimum(yy, h - 1 - yy).astype(float)
    d_cross = np.minimum(xx % 256, 256 - (xx % 256)).astype(float)
    d = np.minimum(d_edge, d_cross)
    height = 0.7 * groove(d - 1, 2.5)
    height += 0.3 * (rivets(h, w, 16, 7, 2.0) + rivets(h, w, 16, h - 8, 2.0))
    height += 0.02 * tile_noise(h, w, 8, 64)
    wear = np.clip(1 - (d - 2) / 7, 0, 1) * (tile_noise(h, w, 16, 128) > 0.5)
    rough = 0.9 + 0.1 * tile_noise(h, w, 4, 32) + 0.25 * wear
    metal = 0.9 + 0.1 * wear
    return height, rough, np.clip(metal, 0, 1)


def band_carbon(h, w):
    """2x2 twill carbon weave: tows alternate over/under in a diagonal."""
    yy, xx = np.mgrid[0:h, 0:w]
    cell = 16
    cx = xx // cell
    cy = yy // cell
    fx = (xx % cell) / cell
    fy = (yy % cell) / cell
    warp = ((cx + cy) // 2) % 2 == 0  # twill: shifts by one each row
    across = np.sin(np.pi * fy) ** 0.6
    along = np.sin(np.pi * fx) ** 0.6
    height = np.where(warp, across, along) * 0.8 + 0.2
    rough = np.where(warp, 0.75, 0.95) + 0.05 * tile_noise(h, w, 4, 32)
    metal = np.full((h, w), 0.35)
    return height * 0.6, rough, metal


def band_brushed(h, w):
    """Brushed metal: fine streaks along u, a little roughness variation."""
    streak = tile_noise(h, w, 96, 2, octaves=4)
    height = 0.15 * streak
    rough = 0.8 + 0.25 * tile_noise(h, w, 128, 4, octaves=2)
    metal = np.ones((h, w))
    return height, rough, metal


def band_vent(h, w):
    """Louvred vent / grille: slats across the strip with a frame at its edges."""
    yy, xx = np.mgrid[0:h, 0:w]
    period = 14
    f = (yy % period) / period
    slat = np.clip(1.4 * (1 - f) - 0.2, 0, 1)  # sloped louvre faces
    frame = np.minimum(yy, h - 1 - yy) < 8
    height = np.where(frame, 1.0, 0.15 + 0.6 * slat)
    # vertical frame bars every 128 px
    bar = np.minimum(xx % 128, 128 - (xx % 128)) < 4
    height = np.where(bar & ~frame, 0.95, height)
    rough = np.where(frame | bar, 0.85, 1.0)
    metal = np.where(frame | bar, 1.0, 0.6)
    return height, rough, metal


def band_ribbed(h, w):
    """Nozzle / intake ribs: rounded ridges along u, a seam ring every 256 px."""
    yy, xx = np.mgrid[0:h, 0:w]
    rib = 0.5 + 0.5 * np.cos((yy / h) * 2 * np.pi * 6)
    d_cross = np.minimum(xx % 256, 256 - (xx % 256)).astype(float)
    height = 0.55 * rib * groove(d_cross - 1, 3)
    rough = 0.85 + 0.15 * rib
    metal = np.ones((h, w))
    return height, rough, metal


def band_flat(h, w):
    """Neutral strip for glass and glow: flat, no occlusion, multipliers of 1."""
    return np.zeros((h, w)), np.ones((h, w)), np.ones((h, w))


def band_grip(h, w):
    """Utility / underside: a raised diamond tread."""
    yy, xx = np.mgrid[0:h, 0:w]
    a = (xx + yy) % 24
    b = (xx - yy) % 24
    d = np.minimum(np.minimum(a, 24 - a), np.minimum(b, 24 - b))
    height = 0.5 * np.clip(d / 5, 0, 1)
    rough = 0.95 + 0.05 * tile_noise(h, w, 4, 32)
    metal = np.full((h, w), 0.7)
    return height, rough, metal


BUILDERS = {
    "panel": band_panel,
    "plate": band_plate,
    "carbon": band_carbon,
    "brushed": band_brushed,
    "vent": band_vent,
    "ribbed": band_ribbed,
    "flat": band_flat,
    "grip": band_grip,
}
NORMAL_STRENGTH = {"panel": 5.0, "plate": 5.0, "carbon": 3.0, "brushed": 2.0, "vent": 6.0, "ribbed": 5.0, "flat": 0.0, "grip": 4.0}


def blur_x_wrap(a, r):
    out = np.zeros_like(a)
    for k in range(-r, r + 1):
        out += np.roll(a, k, axis=1)
    return out / (2 * r + 1)


def blur_y_clamp(a, r):
    p = np.pad(a, ((r, r), (0, 0)), mode="edge")
    out = np.zeros_like(a)
    for k in range(0, 2 * r + 1):
        out += p[k : k + a.shape[0]]
    return out / (2 * r + 1)


def cavity_ao(height):
    """Occlusion from how far a texel sits below its neighbourhood at a few radii."""
    ao = np.ones_like(height)
    for r, wgt in ((2, 1.6), (5, 1.0), (10, 0.6)):
        avg = blur_y_clamp(blur_x_wrap(height, r), r)
        ao -= wgt * np.clip(avg - height, 0, None)
    return np.clip(ao, 0.25, 1.0)


def normals(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    p = np.pad(height, ((1, 1), (0, 0)), mode="edge")
    dy = (p[2:] - p[:-2]) * 0.5
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return nx / ln, ny / ln, nz / ln


def save(name, rgb, out_dir):
    """Lossless PNG; scripts/build-assets.mjs turns it into the shipped WebP."""
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(out_dir, f"{name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    print(f"[trim] {name}: {os.path.getsize(path) / 1024:.1f} KB -> {path}")


def main():
    out_dir = os.path.abspath(C.arg_value("--out", "public/game/ships"))
    os.makedirs(out_dir, exist_ok=True)
    C.reset_scene()
    normal = np.zeros((SIZE, SIZE, 3))
    orm = np.zeros((SIZE, SIZE, 3))
    for b, name in enumerate(BANDS):
        h, rough, metal = BUILDERS[name](BAND_PX, SIZE)
        nx, ny, nz = normals(h, NORMAL_STRENGTH[name])
        rows = slice(b * BAND_PX, (b + 1) * BAND_PX)  # Blender pixel rows start at the bottom
        normal[rows, :, 0] = nx * 0.5 + 0.5
        normal[rows, :, 1] = ny * 0.5 + 0.5
        normal[rows, :, 2] = nz * 0.5 + 0.5
        orm[rows, :, 0] = cavity_ao(h) if name != "flat" else 1.0
        orm[rows, :, 1] = np.clip(rough, 0, 1)
        orm[rows, :, 2] = np.clip(metal, 0, 1)
    save("trim_normal", normal, out_dir)
    save("trim_orm", orm, out_dir)


main()
