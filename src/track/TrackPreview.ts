/**
 * Review drawings of a built track (docs/v2/tracks/<id>.svg): a top-down plan with the deck edges shaded by
 * elevation and the features marked, plus an elevation profile along the lap. Pure string output (Node-safe).
 */
import type { TrackData } from '../core/contracts';
import type { TrackReport } from './TrackValidate';

const W = 1000;
const PLAN_H = 760;
const PROFILE_H = 200;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function renderTrackSvg(track: TrackData, report: TrackReport): string {
  const n = track.samples.length;
  const step = 4;
  const xs = track.samples.map((s) => s.position.x);
  const zs = track.samples.map((s) => s.position.z);
  const pad = 70;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const scale = Math.min(W / (maxX - minX), PLAN_H / (maxZ - minZ));
  const ox = (W - (maxX - minX) * scale) / 2;
  const oz = (PLAN_H - (maxZ - minZ) * scale) / 2;
  const px = (x: number) => (ox + (x - minX) * scale).toFixed(1);
  const pz = (z: number) => (oz + (z - minZ) * scale).toFixed(1);
  const [yLo, yHi] = report.elevation;
  const colour = (y: number) => {
    const t = (y - yLo) / Math.max(1e-6, yHi - yLo);
    return `hsl(${(250 - 210 * t).toFixed(0)},90%,${(45 + 15 * t).toFixed(0)}%)`;
  };
  const L = track.length;
  const air = (i: number) => track.surfaceKindAt(i / n, 0) === 'air';

  // Deck as short coloured segments (drawn low to high so overpasses sit on top).
  const segs: { y: number; svg: string }[] = [];
  for (let i = 0; i < n; i += step) {
    const a = track.samples[i];
    const b = track.samples[(i + step) % n];
    const y = (a.position.y + b.position.y) / 2;
    const width = (2 * track.halfWidth * scale).toFixed(1);
    const dash = air(i) ? ' stroke-dasharray="2 5" stroke-opacity="0.6"' : '';
    segs.push({
      y,
      svg: `<line x1="${px(a.position.x)}" y1="${pz(a.position.z)}" x2="${px(b.position.x)}" y2="${pz(b.position.z)}" stroke="${air(i) ? '#ffffff' : colour(y)}" stroke-width="${width}" stroke-linecap="butt"${dash}/>`,
    });
  }
  segs.sort((p, q) => p.y - q.y);

  const marks: string[] = [];
  const at = (d: number) => track.sampleAt((((d % L) + L) % L) / L);
  const label = (d: number, text: string, colourHex: string) => {
    const s = at(d);
    const lx = s.position.x + s.right.x * 60;
    const lz = s.position.z + s.right.z * 60;
    marks.push(
      `<circle cx="${px(s.position.x)}" cy="${pz(s.position.z)}" r="5" fill="${colourHex}"/>` +
        `<text x="${px(lx)}" y="${pz(lz)}" fill="${colourHex}" font-size="15" font-family="monospace" text-anchor="middle">${esc(text)}</text>`,
    );
  };
  for (const f of track.features) {
    if (f.type === 'corkscrew') label((f.dStart + f.dEnd) / 2, `CORKSCREW ×${f.turns ?? 1}`, '#ffb319');
    else if (f.type === 'jump') label(f.dTakeoff, `JUMP ${(f.dLanding - f.dTakeoff).toFixed(0)} m`, '#ff4f6e');
    else if (f.type === 'pit') label((f.dStart + f.dEnd) / 2, 'PIT', '#7dff3a');
    else if (f.type === 'dash') label((f.dStart + f.dEnd) / 2, 'DASH', '#ffe066');
    else if (f.type === 'pipe') label((f.dStart + f.dEnd) / 2, `PIPE ${(f.dEnd - f.dStart).toFixed(0)} m`, '#7fe8ff');
    else if (f.type === 'ice') label((f.dStart + f.dEnd) / 2, 'ICE', '#cff4ff');
  }
  // Pipes: a translucent cyan sleeve over the deck; ice patches: pale strips on their lateral band.
  for (const f of track.features) {
    if (f.type !== 'pipe' && f.type !== 'ice') continue;
    for (let d = f.dStart; d < f.dEnd; d += 6) {
      const a = at(d);
      const b = at(Math.min(d + 6, f.dEnd));
      if (f.type === 'pipe') {
        marks.push(`<line x1="${px(a.position.x)}" y1="${pz(a.position.z)}" x2="${px(b.position.x)}" y2="${pz(b.position.z)}" stroke="#7fe8ff" stroke-opacity="0.45" stroke-width="${(2.6 * track.halfWidth * scale).toFixed(1)}"/>`);
      } else {
        const mid = (f.lateralMin + f.lateralMax) / 2;
        const w = ((f.lateralMax - f.lateralMin) * scale).toFixed(1);
        marks.push(
          `<line x1="${px(a.position.x + a.right.x * mid)}" y1="${pz(a.position.z + a.right.z * mid)}" x2="${px(b.position.x + b.right.x * mid)}" y2="${pz(b.position.z + b.right.z * mid)}" stroke="#eaffff" stroke-opacity="0.85" stroke-width="${w}"/>`,
        );
      }
    }
  }
  // Start line and direction arrow.
  const s0 = track.samples[0];
  const s1 = at(80);
  marks.push(
    `<line x1="${px(s0.position.x + s0.right.x * 20)}" y1="${pz(s0.position.z + s0.right.z * 20)}" x2="${px(s0.position.x - s0.right.x * 20)}" y2="${pz(s0.position.z - s0.right.z * 20)}" stroke="#fff" stroke-width="4"/>` +
      `<line x1="${px(s0.position.x)}" y1="${pz(s0.position.z)}" x2="${px(s1.position.x)}" y2="${pz(s1.position.z)}" stroke="#fff" stroke-width="2" marker-end="url(#arrow)"/>`,
  );

  // Elevation profile.
  const top = PLAN_H + 30;
  const prof: string[] = [];
  const pyOf = (y: number) => (top + PROFILE_H - ((y - yLo) / Math.max(1e-6, yHi - yLo)) * (PROFILE_H - 30) - 10).toFixed(1);
  let path = '';
  for (let i = 0; i <= n; i += 2) {
    const s = track.samples[i % n];
    path += `${i === 0 ? 'M' : 'L'}${((i / n) * W).toFixed(1)},${pyOf(s.position.y)}`;
  }
  prof.push(`<path d="${path}" fill="none" stroke="#19f0ff" stroke-width="2"/>`);
  for (const f of track.features) {
    if (f.type !== 'jump' && f.type !== 'corkscrew' && f.type !== 'pipe') continue;
    const a = f.type === 'jump' ? f.dTakeoff : f.dStart;
    const b = f.type === 'jump' ? f.dLanding : f.dEnd;
    const c = f.type === 'jump' ? '#ff4f6e' : f.type === 'pipe' ? '#7fe8ff' : '#ffb319';
    prof.push(`<rect x="${((a / L) * W).toFixed(1)}" y="${top}" width="${(((b - a) / L) * W).toFixed(1)}" height="${PROFILE_H}" fill="${c}" fill-opacity="0.25"/>`);
  }
  prof.push(
    `<text x="8" y="${top + 16}" fill="#aaa" font-size="13" font-family="monospace">elevation ${yLo.toFixed(0)}–${yHi.toFixed(0)} m over ${L.toFixed(0)} m</text>`,
  );

  const title =
    `${track.name} · ${L.toFixed(0)} m · ~${report.lapEstimate.toFixed(1)} s/lap at Pilot pace · min radius ${report.minRadius.toFixed(0)} m` +
    (report.issues.length ? ` · ${report.issues.length} ISSUE(S)` : ' · valid');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${top + PROFILE_H + 10}" width="${W}" height="${top + PROFILE_H + 10}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fff"/></marker></defs>
<rect width="100%" height="100%" fill="#0b0716"/>
<text x="12" y="24" fill="#fff" font-size="17" font-family="monospace">${esc(title)}</text>
${segs.map((s) => s.svg).join('\n')}
${marks.join('\n')}
${prof.join('\n')}
</svg>
`;
}
