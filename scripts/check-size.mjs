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
let rapierGzip = 0;
for (const f of walk(dist).filter((f) => f.endsWith('.js'))) {
  const gz = gzipSync(readFileSync(f)).length;
  const isRapier = /[\\/]rapier-[^\\/]*\.js$/.test(f);
  if (isRapier) rapierGzip += gz;
  else appGzip += gz;
  console.log(`  ${isRapier ? 'rapier' : 'app   '} ${relative(root, f).padEnd(46)} ${kb(gz)} gz`);
}
const content = walk(join(root, 'public', 'game')).reduce((sum, f) => sum + statSync(f).size, 0);

console.log(`\napp JS (gzip): ${kb(appGzip)} / ${kb(APP_JS_GZIP_BUDGET)}`);
console.log(`rapier (gzip): ${kb(rapierGzip)} / ${kb(RAPIER_GZIP_BUDGET)}`);
console.log(`public/game:   ${kb(content)} / ${kb(CONTENT_BUDGET)}`);
let ok = true;
if (appGzip > APP_JS_GZIP_BUDGET) {
  console.error('✗ app JS over budget');
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
