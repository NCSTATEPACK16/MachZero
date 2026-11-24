// Size budget gate (CI). Three budgets:
//  - app JS (our code + three.js), gzipped
//  - the Rapier physics chunk, gzipped (rapier3d-compat embeds its WASM as base64, ~1.6 MB gz on its own)
//  - game content in public/game/ (GLB models, audio, ghosts), raw bytes
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const APP_JS_GZIP_BUDGET = 600 * 1024;
const RAPIER_GZIP_BUDGET = 1.7 * 1024 * 1024;
const CONTENT_BUDGET = 15 * 1024 * 1024;
// M6 (IMPLEMENTATION §M6.5): app JS may grow by at most 45 KB gzip (raised from 25 KB by the owner on M6b, once the synthesiser and the first songs were measured) over the build before M6, the render Worker
// included. Chunks loaded only on demand are reported but not counted against it (the owner's size call on M6b):
// SOUND TEST (a jukebox screen) and the render fallback (loaded only when the Worker fails). They still count
// toward the 600 KB app budget.
const PRE_M6_APP_GZIP = 375.0 * 1024;
const M6_BUDGET = 45 * 1024;
const ON_DEMAND = /[\\/](SoundTest|fallback|presets)-[^\\/]*\.js$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const dist = join(root, 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

let appGzip = 0;
let onDemandGzip = 0;
let rapierGzip = 0;
for (const f of walk(dist).filter((f) => f.endsWith('.js'))) {
  const gz = gzipSync(readFileSync(f)).length;
  const isRapier = /[\\/]rapier-[^\\/]*\.js$/.test(f);
  const onDemand = !isRapier && ON_DEMAND.test(f);
  if (isRapier) rapierGzip += gz;
  else appGzip += gz;
  if (onDemand) onDemandGzip += gz;
  console.log(`  ${isRapier ? 'rapier' : onDemand ? 'lazy  ' : 'app   '} ${relative(root, f).padEnd(46)} ${kb(gz)} gz`);
}
const content = walk(join(root, 'public', 'game')).reduce((sum, f) => sum + statSync(f).size, 0);

console.log(`\napp JS (gzip): ${kb(appGzip)} / ${kb(APP_JS_GZIP_BUDGET)}`);
const inPlay = appGzip - onDemandGzip;
const m6 = inPlay - PRE_M6_APP_GZIP;
console.log(`  in play:     ${kb(inPlay)} (on demand: ${kb(onDemandGzip)})`);
console.log(`  M6 so far:   ${m6 >= 0 ? '+' : ''}${kb(m6)} / +${kb(M6_BUDGET)} (left: ${kb(M6_BUDGET - m6)})`);
console.log(`rapier (gzip): ${kb(rapierGzip)} / ${kb(RAPIER_GZIP_BUDGET)}`);
console.log(`public/game:   ${kb(content)} / ${kb(CONTENT_BUDGET)}`);
let ok = true;
if (appGzip > APP_JS_GZIP_BUDGET) {
  console.error('✗ app JS over budget');
  ok = false;
}
if (m6 > M6_BUDGET) {
  console.error('✗ M6 over its 45 KB app JS budget');
  ok = false;
}
if (rapierGzip === 0) {
  console.error('✗ no rapier chunk found — check build.rolldownOptions.output.codeSplitting in vite.config.ts');
  ok = false;
}
if (rapierGzip > RAPIER_GZIP_BUDGET) {
  console.error('✗ rapier chunk over budget');
  ok = false;
}
if (content > CONTENT_BUDGET) {
  console.error('✗ game content over budget');
  ok = false;
}
if (!ok) process.exit(1);
console.log('✓ size budgets OK');
