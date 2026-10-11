// Authoring tool for MachZero's hand-designed tracks: each world's circuit is written below as a sequence of
// turtle segments (straights and constant-radius arcs, each with an end elevation), which this script turns
// into the closed Catmull-Rom control points of src/content/tracks/<id>.json, plus the features placed on
// those segments (corkscrew, jumps, pipes, ice, stone gates, dash plates, pit) in metres along the lap. A pipe or
// ice patch may run on past its segment (`len` instead of `to`). A split path (`branches`) is its own segment
// list from a `fork` to a `merge` marker on flat main straights; see designBranch().
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
  // World 3. Ice planet research station under an aurora: a clockwise lap whose signature is a 500 m frosted
  // glass tube bending gently across the glacier (drive anywhere around its inside), with ice patches on the
  // fast back straight, the pipe's left wall and the hairpin exit.
  'cryo-station': {
    worldId: 'cryo-station',
    name: 'CRYO STATION',
    elevation: [24, 66],
    segments: [
      { s: 380, y: 40, f: [{ type: 'pit', from: 30, to: 250, lateralMin: -13, lateralMax: -7 }] },
      { r: 260, a: 90, y: 44 },
      { s: 380, y: 50, adjust: true, f: [{ type: 'dash', at: 110, lateral: -4 }, { type: 'ice', from: 220, to: 290, lateralMin: 0, lateralMax: 14, grip: 0.3 }] },
      { r: 180, a: 60, y: 52 },
      // The pipe: 80 m closing on the straight, the closed tube through the 50° bend, 80 m opening after it.
      { s: 180, y: 52, f: [{ type: 'pipe', from: 40, len: 560, transition: 80 }, { type: 'ice', from: 260, len: 70, lateralMin: -13, lateralMax: -6, grip: 0.3 }] },
      { r: 420, a: 50, y: 56 },
      { s: 180, y: 56 },
      { r: 220, a: -40, y: 50 },
      { r: 150, a: 120, y: 42 },
      { s: 560, y: 36, f: [{ type: 'ice', from: 120, to: 190, lateralMin: -14, lateralMax: -3, grip: 0.3 }, { type: 'dash', at: 300, lateral: 3 }] },
      { r: 240, a: 80, y: 38 },
      { s: 200, y: 40, adjust: true },
    ],
  },
  // World 4. Neon temple deep in the jungle at dusk: a clockwise lap whose main road swings out round the
  // temple through stone gates, while a narrow shortcut (half width, an open edge over the ravine) cuts inside.
  'jade-ruins': {
    worldId: 'jade-ruins',
    name: 'JADE RUINS',
    elevation: [26, 64],
    segments: [
      { s: 340, y: 40, f: [{ type: 'pit', from: 30, to: 250, lateralMin: -13, lateralMax: -7 }] },
      { r: 220, a: 90, y: 44 },
      { s: 200, y: 44, f: [{ type: 'fork', branch: 'shortcut', at: 40 }] },
      { r: 200, a: -55, y: 48 },
      { s: 120, y: 54, f: [{ type: 'gate', at: 60, period: 6, phase: 0, closedFraction: 0.45, span: 'left' }] },
      { r: 200, a: 110, y: 58 },
      { s: 120, y: 52, f: [{ type: 'gate', at: 60, period: 6, phase: 3, closedFraction: 0.45, span: 'right' }] },
      { r: 200, a: -55, y: 44 },
      { s: 200, y: 44, f: [{ type: 'merge', branch: 'shortcut', at: 160 }] },
      { r: 180, a: 90, y: 46 },
      { s: 300, y: 50, adjust: true, f: [{ type: 'dash', at: 150, lateral: -3 }] },
      { r: 140, a: 120, y: 46 },
      { r: 240, a: -30, y: 42 },
      { s: 300, y: 40, adjust: true, f: [{ type: 'gate', at: 200, period: 5, phase: 1.5, closedFraction: 0.45, span: 'left' }] },
      { r: 320, a: -25, y: 38 },
      { r: 320, a: 25, y: 38 },
      { s: 160, y: 40, f: [{ type: 'dash', at: 80, lateral: 3 }] },
      { r: 200, a: 90, y: 40 },
      { s: 130, y: 40 },
    ],
    branches: [
      {
        id: 'shortcut',
        side: 1,
        halfWidth: 7,
        segments: [
          // Level with the main deck until the roads have separated (the overlaps), at both ends.
          { s: 40, y: 44 },
          { r: 160, a: 18, y: 44 },
          { s: 200, y: 50, adjust: true, f: [{ type: 'gate', at: 170, period: 7, phase: 1, closedFraction: 0.3, span: 'full' }] },
          { r: 180, a: -36, y: 52 },
          { s: 200, y: 44, adjust: true, f: [{ type: 'open', from: 20, to: 180 }] },
          { r: 160, a: 18, y: 44 },
          { s: 60, y: 44 },
        ],
      },
    ],
  },
};

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Walk the segments from `start` (default: the origin heading +X at the last segment's elevation); returns the
 * path end (for closure), each segment's start pose and, with `emit`, the sampled points and features.
 */
function walk(segments, lengths, emit, start = null) {
  let x = start?.x ?? 0;
  let z = start?.z ?? 0;
  let h = start?.h ?? 0;
  let y = start?.y ?? (segments.length ? segments[segments.length - 1].y : 0);
  let d = 0;
  const pts = [];
  const feats = [];
  const poses = [];
  const push = (px, py, pz) => pts.push([+px.toFixed(3), +py.toFixed(3), +pz.toFixed(3)]);
  segments.forEach((seg, i) => {
    const y0 = y;
    const y1 = seg.y ?? y;
    const d0 = d;
    poses.push({ x, z, h, y0, y1, d0, L: seg.s !== undefined ? lengths[i] : seg.r * Math.abs((seg.a * Math.PI) / 180), straight: seg.s !== undefined });
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
        } else if (f.type === 'pipe') {
          feats.push({ type: 'pipe', dStart: +(d0 + f.from).toFixed(2), dEnd: +(d0 + f.from + f.len).toFixed(2), transition: f.transition });
        } else if (f.type === 'ice') {
          const to = f.to ?? f.from + f.len;
          feats.push({ type: 'ice', dStart: +(d0 + f.from).toFixed(2), dEnd: +(d0 + to).toFixed(2), lateralMin: f.lateralMin, lateralMax: f.lateralMax, grip: f.grip });
        } else if (f.type === 'jump') {
          const j = { type: 'jump', dTakeoff: +(d0 + f.lip).toFixed(2), dLanding: +(d0 + f.lip + f.gap).toFixed(2), kick: f.kick };
          if (f.designSpeed) j.designSpeed = f.designSpeed;
          feats.push(j);
        } else if (f.type === 'gate') {
          feats.push({ type: 'gate', d: +(d0 + f.at).toFixed(2), period: f.period, phase: f.phase, closedFraction: f.closedFraction, span: f.span });
        } else if (f.type === 'fork' || f.type === 'merge' || f.type === 'open') {
          feats.push({ ...f, d: d0 + (f.at ?? f.from), dTo: f.to !== undefined ? d0 + f.to : undefined, seg: i });
        }
      }
    }
  });
  return { x, z, h, d, pts, feats, poses };
}

/** Pose `at` metres into straight segment `seg` of a walk; the straight must be flat (fork and merge decks). */
function poseOnStraight(out, seg, at, what) {
  const p = out.poses[seg];
  if (!p.straight) throw new Error(`${what} must be on a straight (segment ${seg} is an arc)`);
  if (p.y0 !== p.y1) throw new Error(`${what} must be on a flat straight (segment ${seg} climbs ${p.y0}→${p.y1})`);
  if (at < 0 || at > p.L) throw new Error(`${what} at ${at} m is outside segment ${seg} (${p.L.toFixed(0)} m)`);
  return { x: p.x + Math.cos(p.h) * at, z: p.z + Math.sin(p.h) * at, h: p.h, y: p.y0, d: p.d0 + at };
}

/** Solve two `adjust` straights so a walk from `start` ends at (ex, ez): linear in the two lengths. */
function solveAdjust(what, segs, lengths, start, ex, ez) {
  const adj = segs.map((s, i) => (s.adjust ? i : -1)).filter((i) => i >= 0);
  if (adj.length !== 2) throw new Error(`${what}: mark exactly two straights with adjust`);
  const end = (L) => walk(segs, L, false, start);
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
  if (Math.abs(det) < 1e-6) throw new Error(`${what}: the two adjust straights are parallel`);
  const rx = ex - e0.x;
  const rz = ez - e0.z;
  lengths[adj[0]] += (rx * bz - rz * bx) / det;
  lengths[adj[1]] += (ax * rz - az * rx) / det;
  for (const i of adj) if (lengths[i] < 40) throw new Error(`${what}: adjust straight ${i} solved to ${lengths[i].toFixed(1)} m`);
  return adj;
}

const W_MAIN = 14;

/**
 * A split path: its own turtle segments from beside the main road at the fork (offset to `side` by the
 * difference in half-widths, main heading and elevation) to beside it at the merge. Two `adjust` straights
 * close its position; its arcs must sum to the main road's heading change between fork and merge.
 */
function designBranch(id, br, main, mainLength) {
  const fork = main.feats.find((f) => f.type === 'fork' && f.branch === br.id);
  const merge = main.feats.find((f) => f.type === 'merge' && f.branch === br.id);
  if (!fork || !merge) throw new Error(`${id}: branch ${br.id} needs a fork and a merge on the main road`);
  const a = poseOnStraight(main, fork.seg, fork.at, `${br.id} fork`);
  const b = poseOnStraight(main, merge.seg, merge.at, `${br.id} merge`);
  const off = br.side * (W_MAIN - br.halfWidth);
  // right = forward × up = (−sin h, 0, cos h)
  const start = { x: a.x - Math.sin(a.h) * off, z: a.z + Math.cos(a.h) * off, h: a.h, y: a.y };
  const ex = b.x - Math.sin(b.h) * off;
  const ez = b.z + Math.cos(b.h) * off;
  const turn = br.segments.reduce((s, g) => s + (g.a ?? 0), 0);
  const dh = (((b.h - a.h) * 180) / Math.PI + 540) % 360 - 180;
  if (Math.abs(turn - dh) > 1e-6) throw new Error(`${id}: branch ${br.id} arcs turn ${turn}°, need ${dh.toFixed(1)}°`);
  const lengths = br.segments.map((s) => s.s ?? 0);
  const adj = solveAdjust(`${id} branch ${br.id}`, br.segments, lengths, start, ex, ez);
  const out = walk(br.segments, lengths, true, start);
  if (Math.hypot(out.x - ex, out.z - ez) > 1e-3) throw new Error(`${id}: branch ${br.id} does not reach the merge`);
  const last = br.segments[br.segments.length - 1];
  if ((last.y ?? a.y) !== b.y) throw new Error(`${id}: branch ${br.id} ends at y ${last.y}, the merge is at ${b.y}`);
  out.pts.push([+out.x.toFixed(3), +b.y.toFixed(3), +out.z.toFixed(3)]);
  const open = out.feats.find((f) => f.type === 'open');
  const dMerge = b.d % mainLength;
  const skipped = (dMerge - a.d + mainLength) % mainLength;
  console.log(
    `  ${br.id}: ${out.d.toFixed(0)} m vs ${skipped.toFixed(0)} m of main (${(100 * (1 - out.d / skipped)).toFixed(1)}% shorter), adjusted ${adj.map((i) => `#${i}=${lengths[i].toFixed(1)} m`).join(', ')}`,
  );
  const branch = {
    type: 'branch',
    id: br.id,
    dFork: +a.d.toFixed(2),
    dMerge: +dMerge.toFixed(2),
    halfWidth: br.halfWidth,
    side: br.side,
    ...(open ? { openFrom: +open.d.toFixed(2), openTo: +open.dTo.toFixed(2) } : {}),
    points: out.pts,
  };
  const gates = out.feats.filter((f) => f.type === 'gate').map((g) => ({ ...g, branch: br.id }));
  return [branch, ...gates];
}

function design(id) {
  const t = TRACKS[id];
  const segs = t.segments;
  const turn = segs.reduce((a, s) => a + (s.a ?? 0), 0);
  if (Math.abs(Math.abs(turn) - 360) > 1e-6) throw new Error(`${id}: arcs turn ${turn}°, need ±360°`);
  const lengths = segs.map((s) => s.s ?? 0);
  // Closure is linear in the two adjustable lengths: solve the 2×2 system from three walks.
  const adj = solveAdjust(id, segs, lengths, null, 0, 0);
  if (process.env.TRACK_SKETCH) sketch(id, segs, segs.map((s) => s.s ?? 0), lengths);
  for (const i of adj) if (lengths[i] < 60) throw new Error(`${id}: adjust straight ${i} solved to ${lengths[i].toFixed(1)} m`);
  const out = walk(segs, lengths, true);
  if (Math.hypot(out.x, out.z) > 1e-3) throw new Error(`${id}: loop does not close`);
  console.log(
    `${id}: ${out.d.toFixed(0)} m, ${out.pts.length} points, adjusted straights ${adj.map((i) => `#${i}=${lengths[i].toFixed(1)} m`).join(', ')}`,
  );
  const branchFeats = (t.branches ?? []).flatMap((br) => designBranch(id, br, out, out.d));
  const features = [...out.feats.filter((f) => f.type !== 'fork' && f.type !== 'merge' && f.type !== 'open'), ...branchFeats];
  const def = {
    id,
    worldId: t.worldId,
    name: t.name,
    laps: 3,
    elevation: t.elevation,
    ...(t.airGravityScale ? { airGravityScale: t.airGravityScale } : {}),
    features,
    points: out.pts,
  };
  mkdirSync(OUT, { recursive: true });
  // One point per line keeps diffs readable.
  const json = JSON.stringify({ ...def, points: '@@' }, (k, v) => (k === 'points' && v !== '@@' ? v.map((p) => `@P${p.join(', ')}@P`) : v), 2)
    .replace(/"@P(.*?)@P"/g, '[$1]')
    .replace('"@@"', '[\n' + out.pts.map((p) => `    [${p.join(', ')}]`).join(',\n') + '\n  ]');
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
