/**
 * Procedural track textures, generated as THREE.DataTexture from computed Uint8Array pixels so
 * the generator runs headless (Node/Vitest) without any canvas or DOM.
 *
 * Texture axes follow the sweep UVs: x (S) runs ALONG the track, y (T) runs ACROSS it
 * (left edge = 0, right edge = 1). All patterns are periodic in x so tiles repeat seamlessly.
 * Albedo values are kept dark (linear luminance < 0.5) so only the HDR neon blooms.
 */
import * as THREE from 'three';

/** Metres of track per repeat of the asphalt texture (texture spans 28 m across, 56 m along). */
export const ASPHALT_TILE_METRES = 56;

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Deterministic integer hash -> [0,1). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function finish(
  data: Uint8Array,
  width: number,
  height: number,
  opts: { srgb: boolean; wrapS: THREE.Wrapping; wrapT: THREE.Wrapping; mipmaps?: boolean },
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = opts.wrapS;
  tex.wrapT = opts.wrapT;
  tex.magFilter = THREE.LinearFilter;
  const mip = opts.mipmaps !== false;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mip;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function smooth01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Dark asphalt-metal deck: panel seams, speckle, wheel-worn lanes, dashed lane markings and
 * cyan/magenta edge stripes. 512 (along, 56 m) x 256 (across, 28 m) => ~9.1 px/m both ways.
 */
export function createAsphaltTexture(): THREE.DataTexture {
  const W = 512;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  const pxPerM = W / ASPHALT_TILE_METRES; // 9.14
  for (let y = 0; y < H; y++) {
    const across = y / pxPerM; // 0..28 m from the left edge
    for (let x = 0; x < W; x++) {
      const along = x / pxPerM;
      const i = (y * W + x) * 4;

      // Base metal/asphalt with fine speckle and low-frequency, tile-periodic blotches.
      const speckle = hash2(x, y) - 0.5;
      const blotch =
        Math.sin((x / W) * Math.PI * 2 * 3 + y * 0.05) * 0.5 +
        Math.sin((x / W) * Math.PI * 2 * 7 - y * 0.11 + 1.3) * 0.5;
      let r = 27 + speckle * 9 + blotch * 2.5;
      let g = 30 + speckle * 9 + blotch * 2.5;
      let b = 42 + speckle * 10 + blotch * 3;

      // Wheel-worn bands (slightly lighter and smoother) around 1/4 and 3/4 of the width.
      const wear = Math.exp(-Math.pow((across - 7) / 2.2, 2)) + Math.exp(-Math.pow((across - 21) / 2.2, 2));
      r += wear * 5;
      g += wear * 5;
      b += wear * 7;

      // Panel seams: every 7 m across and every 7 m along.
      const seamAcross = across % 7;
      const seamAlong = along % 7;
      const nearSeam = Math.min(seamAcross, 7 - seamAcross) < 0.11 || Math.min(seamAlong, 7 - seamAlong) < 0.11;
      const nearSeamHi =
        (seamAcross >= 0.11 && seamAcross < 0.24) || (seamAlong >= 0.11 && seamAlong < 0.24);
      if (nearSeam) {
        r -= 12;
        g -= 12;
        b -= 15;
      } else if (nearSeamHi) {
        r += 6;
        g += 7;
        b += 10;
      }

      // Centre dashed line: 7 m on / 7 m off, ~0.36 m wide (period 14 m divides the 56 m tile).
      const dashPhase = along % 14;
      const centreDist = Math.abs(across - 14);
      if (centreDist < 0.2 && dashPhase < 7) {
        const a = 1 - smooth01(0.12, 0.2, centreDist);
        r += (130 - r) * a;
        g += (138 - g) * a;
        b += (156 - b) * a;
      }
      // Lane dashes at 1/4 and 3/4: short (3.5 m on, 3.5 m off), tinted cyan / magenta, dim.
      const lanePhase = along % 7;
      const laneL = Math.abs(across - 7);
      const laneR = Math.abs(across - 21);
      if (lanePhase < 3.5 && laneL < 0.16) {
        const a = 1 - smooth01(0.08, 0.16, laneL);
        r += (34 - r) * a * 0.85;
        g += (112 - g) * a * 0.85;
        b += (128 - b) * a * 0.85;
      }
      if (lanePhase < 3.5 && laneR < 0.16) {
        const a = 1 - smooth01(0.08, 0.16, laneR);
        r += (124 - r) * a * 0.85;
        g += (42 - g) * a * 0.85;
        b += (110 - b) * a * 0.85;
      }

      // Edge stripes: 0.5 m solid neon-tinted band with a dark inner gutter.
      const edgeL = across;
      const edgeR = 28 - across;
      if (edgeL < 0.55) {
        const a = 1 - smooth01(0.45, 0.55, edgeL);
        r += (30 - r) * a;
        g += (150 - g) * a;
        b += (170 - b) * a;
      } else if (edgeL < 1.0) {
        r *= 0.7;
        g *= 0.7;
        b *= 0.72;
      }
      if (edgeR < 0.55) {
        const a = 1 - smooth01(0.45, 0.55, edgeR);
        r += (170 - r) * a;
        g += (40 - g) * a;
        b += (140 - b) * a;
      } else if (edgeR < 1.0) {
        r *= 0.7;
        g *= 0.7;
        b *= 0.72;
      }

      data[i] = clamp255(r);
      data[i + 1] = clamp255(g);
      data[i + 2] = clamp255(b);
      data[i + 3] = 255;
    }
  }
  return finish(data, W, H, { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/** Brushed dark metal for the rails: streaks along the run, seams every tile, a groove line. */
export function createRailTexture(): THREE.DataTexture {
  const W = 128;
  const H = 128;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const streak = hash2(0, y * 3 + 11) - 0.5; // constant along x => brushed streaks
      const grain = hash2(x, y) - 0.5;
      let v = 70 + streak * 16 + grain * 6;
      if (x < 2) v -= 26; // panel seam at the tile edge (periodic in x)
      else if (x < 4) v += 8;
      const gy = y % 32;
      if (gy < 2) v -= 20; // horizontal groove every quarter tile in v
      else if (gy < 3) v += 8;
      data[i] = clamp255(v * 0.96);
      data[i + 1] = clamp255(v * 1.0);
      data[i + 2] = clamp255(v * 1.14);
      data[i + 3] = 255;
    }
  }
  return finish(data, W, H, { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
}

/** Start-line checkerboard: 28 x 4 cells of 8 px (1 m squares) across a 28 m x 4 m decal. */
export function createCheckerTexture(): THREE.DataTexture {
  const cell = 8;
  const W = 4 * cell; // along: 4 m
  const H = 28 * cell; // across: 28 m
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const white = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = white ? 168 : 22;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v + (white ? 4 : 8);
      data[i + 3] = 255;
    }
  }
  return finish(data, W, H, { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/**
 * Chevron arrows for dash plates (additive, black background). One tile = 5 m along x, plate
 * width across y; chevrons point along +x (direction of travel). Scrolling `offset.x` negatively
 * makes them run forward.
 */
export function createChevronTexture(): THREE.DataTexture {
  const W = 128;
  const H = 128;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const cy = (y + 0.5) / H; // 0..1 across
    const dy = Math.abs(cy - 0.5);
    for (let x = 0; x < W; x++) {
      const cx = (x + 0.5) / W;
      const i = (y * W + x) * 4;
      // Chevron ">" whose tip is at cy = 0.5: x0 shifts back with |dy|.
      const tipX = 0.72 - dy * 0.9;
      const band = Math.abs(cx - tipX);
      let v = 1 - smooth01(0.055, 0.13, band);
      // The 5-m tile is periodic: wrap-around band for the tail part crossing the tile edge.
      const bandWrap = Math.min(Math.abs(cx - tipX + 1), Math.abs(cx - tipX - 1));
      v = Math.max(v, 1 - smooth01(0.055, 0.13, bandWrap));
      v *= 1 - smooth01(0.44, 0.5, dy); // fade toward plate edges
      // Side edge lines.
      const edge = 1 - smooth01(0.02, 0.05, 0.5 - dy);
      v = Math.max(v, edge * 0.9);
      // Subtle base glow so the plate reads as a lit pad.
      v = Math.max(v, 0.1 * (1 - smooth01(0.3, 0.5, dy)));
      const c = clamp255(v * 255);
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  return finish(data, W, H, { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/**
 * Pit-lane strip overlay (additive): solid dim glow, bright edge lines and slim chevrons.
 * One tile = 8 m along x, the 6 m pit width across y.
 */
export function createPitTexture(): THREE.DataTexture {
  const W = 128;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const cy = (y + 0.5) / H;
    const dy = Math.abs(cy - 0.5);
    for (let x = 0; x < W; x++) {
      const cx = (x + 0.5) / W;
      const i = (y * W + x) * 4;
      let v = 0.2;
      // Slim chevrons pointing along +x; two per tile.
      const phase = (cx * 2) % 1;
      const tipX = 0.7 - dy * 0.7;
      const band = Math.min(Math.abs(phase - tipX), Math.abs(phase - tipX + 1), Math.abs(phase - tipX - 1));
      v = Math.max(v, (1 - smooth01(0.035, 0.085, band)) * 0.85);
      // Bright edge lines.
      const edge = 1 - smooth01(0.03, 0.07, 0.5 - dy);
      v = Math.max(v, edge);
      const c = clamp255(v * 255);
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  return finish(data, W, H, { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

/** Metres of track per repeat of the frosted-glass pipe texture. */
export const FROST_TILE_METRES = 28;

/**
 * Frosted ice-glass panels for the inside of a pipe: a pale blue-grey speckled base with bright panel seams
 * (8 across, 8 along a 28 m tile) so speed reads clearly on every wall. 256 × 256, sRGB.
 */
export function createFrostTexture(): THREE.DataTexture {
  const W = 256;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = (x / W) * 8;
      const fy = (y / H) * 8;
      const sx = Math.min(fx - Math.floor(fx), Math.ceil(fx) - fx);
      const sy = Math.min(fy - Math.floor(fy), Math.ceil(fy) - fy);
      const seam = 1 - smooth01(0.02, 0.06, Math.min(sx, sy));
      const frost = hash2(x, y) * 0.5 + hash2(x >> 2, y >> 2) * 0.5;
      const i = (y * W + x) * 4;
      data[i] = clamp255(70 + frost * 28 + seam * 120);
      data[i + 1] = clamp255(104 + frost * 30 + seam * 130);
      data[i + 2] = clamp255(128 + frost * 30 + seam * 127);
      data[i + 3] = 255;
    }
  }
  return finish(data, W, H, { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
}
