// Validate every authored track and draw its review SVG into docs/v2/tracks/<id>.svg.
//   npm run tracks:preview      # write the SVGs (and print the reports)
//   npm run tracks:check        # print the reports; exit 1 on any issue (no files written)
// Loads the TypeScript track code through Vite's module runner, so it is exactly what the game builds.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const checkOnly = process.argv.includes('--check');
const load = async (p) => (await runnerImport(join(root, p), { configFile: false, logLevel: 'error' })).module;
const { TRACK_DEFS } = await load('src/content/tracks/index.ts');
const { trackFromSource } = await load('src/track/TrackSource.ts');
const { validateTrack } = await load('src/track/TrackValidate.ts');
const { renderTrackSvg } = await load('src/track/TrackPreview.ts');

let failed = 0;
const out = join(root, 'docs/v2/tracks');
if (!checkOnly) mkdirSync(out, { recursive: true });
for (const def of Object.values(TRACK_DEFS)) {
  const track = trackFromSource({ kind: 'authored', def });
  const r = validateTrack(track, def.elevation);
  console.log(
    `${def.id}: ${r.length.toFixed(0)} m, ~${r.lapEstimate.toFixed(1)} s/lap, min radius ${r.minRadius.toFixed(0)} m, ` +
      `elevation ${r.elevation.map((e) => e.toFixed(1)).join('..')} m, ${r.issues.length ? `${r.issues.length} issue(s)` : 'valid'}`,
  );
  for (const i of r.issues) console.log(`  - [${i.code}] ${i.message}`);
  if (r.issues.length) failed++;
  if (!checkOnly) writeFileSync(join(out, `${def.id}.svg`), renderTrackSvg(track, r));
}
process.exit(failed ? 1 : 0);
