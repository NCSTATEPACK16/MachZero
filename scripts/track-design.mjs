// Authoring tool for MachZero's hand-designed tracks: each world's circuit is written below as a sequence of
// turtle segments (straights and constant-radius arcs, each with an end elevation), which this script turns
// into the closed Catmull-Rom control points of src/content/tracks/<id>.json, plus the features placed on
// those segments (corkscrew, jumps, dash plates, pit) in metres along the lap.
//
//   node scripts/track-design.mjs            # write every track
//   node scripts/track-design.mjs neon-bay   # one track
//
// Then `npm run tracks:check` validates them and `npm run tracks:preview` draws docs/v2/tracks/<id>.svg.
//
// Conventions: heading 0 = +X; a positive arc angle turns right (toward +Z when heading +X, i.e. clockwise
// seen from above, matching the game's right = forward × up). Elevations ease (smoothstep) along a segment.
// Two straights per track are marked `adjust`: their lengths are solved so the loop closes exactly. The
// start line is the first point: segment 0 must start on the main straight.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const OUT = join(root, 'src/content/tracks');
const STEP = 18; // max metres between emitted control points
const ARC_STEP_DEG = 8;

/** @typedef {{ s?: number, r?: number, a?: number, y?: number, adjust?: boolean, f?: object[] }} Segment */

const TRACKS = {
  // World 1. Synthwave harbour at night: a wide clockwise lap around the bay with a fast esplanade, the
  // corkscrew on the long sea-wall straight, a tight hairpin at the lighthouse and a climbing S into the city.
  'neon-bay': {
    worldId: 'neon-bay',
    name: 'NEON BAY',
    elevation: [28, 62],
    segments: [
      { s: 330, y: 40, f: [{ type: 'pit', from: 30, to: 250, lateralMin: -13, lateralMax: -7 }] },
      { r: 280, a: 90, y: 44 },
      { s: 250, y: 50, adjust: true, f: [{ type: 'dash', at: 130, lateral: 0 }] },
      { r: 200, a: 70, y: 54 },
      { s: 520, y: 54, f: [{ type: 'corkscrew', from: 120, to: 400 }] },
      { r: 300, a: 20, y: 46 },
      { r: 240, a: -40, y: 40 },
      { r: 240, a: 40, y: 36 },
      { s: 260, y: 34, adjust: true, f: [{ type: 'dash', at: 150, lateral: 4 }] },
      { r: 110, a: 150, y: 32 },
      { s: 560, y: 38 },
      { r: 260, a: -60, y: 40 },
      { r: 200, a: 90, y: 40 },
      { s: 160, y: 40 },
    ],
  },
  // World 2. Chrome-and-sandstone canyon at sunset: a long counter-clockwise lap along the mesa rims with
  // two jumps over canyon gaps (the second is the big one), fast sweepers between them and a tight hairpin.
  'sunset-mesa': {
    worldId: 'sunset-mesa',
    name: 'SUNSET MESA',
    elevation: [26, 64],
    segments: [
      { s: 340, y: 44, f: [{ type: 'pit', from: 30, to: 250, lateralMin: -13, lateralMax: -7 }] },
      { r: 330, a: -90, y: 46 },
      { s: 500, y: 50, f: [{ type: 'jump', lip: 150, gap: 55, kick: 3 }] },
      { r: 300, a: -90, y: 54 },
      { r: 200, a: 45, y: 58 },
      { r: 220, a: -45, y: 56 },
      { s: 400, y: 50, adjust: true, f: [{ type: 'dash', at: 150, lateral: -3 }] },
      { r: 140, a: -120, y: 44 },
      { r: 220, a: 30, y: 42 },
      { s: 560, y: 40, adjust: true, f: [{ type: 'jump', lip: 190, gap: 80, kick: 4 }] },
      { r: 340, a: -90, y: 42 },
      { s: 170, y: 44 },
    ],
  },
};

const smooth = (t) => t * t * (3 - 2 * t);

/** Walk the segments; returns the path end (for closure) and, with `emit`, the sampled points and features. */
function walk(segments, lengths, emit) {
  let x = 0;
  let z = 0;
  let h = 0;
  let y = segments.length ? segments[segments.length - 1].y : 0;
  let d = 0;
  const pts = [];
  const feats = [];
  const push = (px, py, pz) => pts.push([+px.toFixed(3), +py.toFixed(3), +pz.toFixed(3)]);
  segments.forEach((seg, i) => {
    const y0 = y;
    const y1 = seg.y ?? y;
    const d0 = d;
    if (seg.s !== undefined) {
      const L = lengths[i];
      const n = Math.max(1, Math.ceil(L / STEP));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        if (emit) push(x + Math.cos(h) * L * t, y0 + (y1 - y0) * smooth(t), z + Math.sin(h) * L * t);
      }
      x += Math.cos(h) * L;
      z += Math.sin(h) * L;
      d += L;
    } else {
      const R = seg.r;
      const ang = (seg.a * Math.PI) / 180;
      const sgn = Math.sign(ang);
      const L = R * Math.abs(ang);
      // centre to the right (+) or left (-) of the heading
      const cx = x + Math.cos(h + sgn * Math.PI / 2) * R;
      const cz = z + Math.sin(h + sgn * Math.PI / 2) * R;
      const phi0 = Math.atan2(z - cz, x - cx);
      const n = Math.max(2, Math.ceil(Math.max(L / STEP, Math.abs(seg.a) / ARC_STEP_DEG)));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const phi = phi0 + ang * t;
        if (emit) push(cx + Math.cos(phi) * R, y0 + (y1 - y0) * smooth(t), cz + Math.sin(phi) * R);
      }
      const phi1 = phi0 + ang;
      x = cx + Math.cos(phi1) * R;
      z = cz + Math.sin(phi1) * R;
      h += ang;
      d += L;
    }
    y = y1;
    if (emit) {
      for (const f of seg.f ?? []) {
        if (f.type === 'pit' || f.type === 'corkscrew') {
          const base = { type: f.type, dStart: +(d0 + f.from).toFixed(2), dEnd: +(d0 + f.to).toFixed(2) };
          feats.push(f.type === 'pit' ? { ...base, lateralMin: f.lateralMin, lateralMax: f.lateralMax } : base);
        } else if (f.type === 'dash') {
          feats.push({ type: 'dash', dStart: +(d0 + f.at - 6).toFixed(2), dEnd: +(d0 + f.at + 6).toFixed(2), lateralMin: f.lateral - 4, lateralMax: f.lateral + 4 });
        } else if (f.type === 'jump') {
          const j = { type: 'jump', dTakeoff: +(d0 + f.lip).toFixed(2), dLanding: +(d0 + f.lip + f.gap).toFixed(2), kick: f.kick };
          if (f.designSpeed) j.designSpeed = f.designSpeed;
          feats.push(j);
        }
      }
    }
  });
  return { x, z, h, d, pts, feats };
}

function design(id) {
  const t = TRACKS[id];
  const segs = t.segments;
  const turn = segs.reduce((a, s) => a + (s.a ?? 0), 0);
  if (Math.abs(Math.abs(turn) - 360) > 1e-6) throw new Error(`${id}: arcs turn ${turn}°, need ±360°`);
  const adj = segs.map((s, i) => (s.adjust ? i : -1)).filter((i) => i >= 0);
  if (adj.length !== 2) throw new Error(`${id}: mark exactly two straights with adjust`);
  const lengths = segs.map((s) => s.s ?? 0);
  // Closure is linear in the two adjustable lengths: solve the 2×2 system from three walks.
  const end = (L) => walk(segs, L, false);
  const e0 = end(lengths);
  const L1 = [...lengths];
  L1[adj[0]] += 1;
  const L2 = [...lengths];
  L2[adj[1]] += 1;
  const a = end(L1);
  const b = end(L2);
  const ax = a.x - e0.x;
  const az = a.z - e0.z;
  const bx = b.x - e0.x;
  const bz = b.z - e0.z;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-6) throw new Error(`${id}: the two adjust straights are parallel`);
  const k1 = (-e0.x * bz + e0.z * bx) / det;
  const k2 = (-ax * e0.z + az * e0.x) / det;
  lengths[adj[0]] += k1;
  lengths[adj[1]] += k2;
  if (process.env.TRACK_SKETCH) sketch(id, segs, segs.map((s) => s.s ?? 0), lengths);
  for (const i of adj) if (lengths[i] < 60) throw new Error(`${id}: adjust straight ${i} solved to ${lengths[i].toFixed(1)} m`);
  const out = walk(segs, lengths, true);
  if (Math.hypot(out.x, out.z) > 1e-3) throw new Error(`${id}: loop does not close`);
  console.log(
    `${id}: ${out.d.toFixed(0)} m, ${out.pts.length} points, adjusted straights ${adj.map((i) => `#${i}=${lengths[i].toFixed(1)} m`).join(', ')}`,
  );
  const def = {
    id,
    worldId: t.worldId,
    name: t.name,
    laps: 3,
    elevation: t.elevation,
    ...(t.airGravityScale ? { airGravityScale: t.airGravityScale } : {}),
    features: out.feats,
    points: out.pts,
  };
  mkdirSync(OUT, { recursive: true });
  // One point per line keeps diffs readable.
  const json = JSON.stringify({ ...def, points: '@@' }, null, 2).replace(
    '"@@"',
    '[\n' + out.pts.map((p) => `    [${p.join(', ')}]`).join(',\n') + '\n  ]',
  );
  writeFileSync(join(OUT, `${id}.json`), json + '\n');
}

/** Debug: plan view before (grey) and after (white) closure, numbered segment starts, to TRACK_SKETCH dir. */
function sketch(id, segs, before, after) {
  const a = walkPath(segs, before);
  const b = walkPath(segs, after);
  const all = [...a.pts, ...b.pts];
  const xs = all.map((p) => p[0]);
  const zs = all.map((p) => p[2]);
  const minX = Math.min(...xs) - 80;
  const minZ = Math.min(...zs) - 80;
  const w = Math.max(...xs) + 80 - minX;
  const hgt = Math.max(...zs) + 80 - minZ;
  const poly = (pts, col) => `<polyline fill="none" stroke="${col}" stroke-width="6" points="${pts.map((p) => `${(p[0] - minX).toFixed(0)},${(p[2] - minZ).toFixed(0)}`).join(' ')}"/>`;
  const labels = b.starts
    .map(([x, z], i) => `<text x="${(x - minX).toFixed(0)}" y="${(z - minZ).toFixed(0)}" fill="#ff0" font-size="48">${i}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${hgt.toFixed(0)}" width="900" height="900" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="#111"/>${poly(a.pts, '#555')}${poly(b.pts, '#fff')}<circle cx="${-minX}" cy="${-minZ}" r="20" fill="#0f0"/>${labels}</svg>`;
  writeFileSync(join(process.env.TRACK_SKETCH, `${id}.svg`), svg);
}

function walkPath(segs, lengths) {
  const starts = [];
  let i = 0;
  const wrapped = segs.map((s) => ({ ...s, f: [] }));
  // Record each segment's start by walking prefixes.
  for (i = 0; i < segs.length; i++) {
    const r = walk(wrapped.slice(0, i), lengths.slice(0, i), false);
    starts.push([r.x, r.z]);
  }
  return { pts: walk(wrapped, lengths, true).pts, starts };
}

const only = process.argv[2];
for (const id of Object.keys(TRACKS)) if (!only || only === id) design(id);
