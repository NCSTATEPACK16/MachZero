#!/usr/bin/env node
/**
 * Build the 2.0 game assets: run the headless Blender scripts in blender/, then optimise every GLB with
 * glTF Transform (dedup, weld, meshopt: reorder + quantize + EXT_meshopt_compression) into public/game/.
 *
 *   npm run assets                 # everything
 *   npm run assets -- ships        # just one group (trim | ships | parts | props)
 *   npm run assets -- ships --only comet   # one chassis (the other ship GLBs stay as committed)
 *
 * `trim` builds the shared ship trim sheet (§V.1): Blender writes lossless PNGs, sharp ships them as WebP.
 *
 * The committed GLBs are the source of truth for the web build; CI never runs Blender but validates the
 * committed files (scripts/check-assets.mjs via vitest).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const GROUPS = {
  trim: { script: 'blender/textures/build_trim.py', out: 'public/game/ships', textures: true },
  ships: { script: 'blender/ships/build_ships.py', out: 'public/game/ships' },
  parts: { script: 'blender/parts/build_parts.py', out: 'public/game/parts' },
  // One props.glb per world, written to <out>/<world>/props.glb.
  props: { script: 'blender/props/build_props.py', out: 'public/game/worlds' },
};

/** Every .glb under `dir`, as paths relative to it. */
function glbFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? glbFiles(join(dir, e.name), join(prefix, e.name)) : e.name.endsWith('.glb') ? [join(prefix, e.name)] : [],
  );
}

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const onlyId = onlyAt >= 0 ? argv[onlyAt + 1] : null;
const only = argv.filter((a, i) => !a.startsWith('-') && !(onlyAt >= 0 && i === onlyAt + 1));
const groups = Object.entries(GROUPS).filter(([name]) => only.length === 0 || only.includes(name));
if (groups.length === 0) {
  console.error(`Unknown group(s): ${only.join(', ')}. Known: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(1);
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const work = mkdtempSync(join(tmpdir(), 'mz-assets-'));
try {
  for (const [name, g] of groups) {
    const raw = join(work, name);
    mkdirSync(raw, { recursive: true });
    console.log(`\n▶ ${name}: Blender ${g.script}`);
    const extra = onlyId ? ['--only', onlyId] : [];
    execFileSync(BLENDER, ['-b', '--factory-startup', '-P', join(ROOT, g.script), '--', '--out', raw, ...extra], { stdio: ['ignore', 'pipe', 'inherit'] })
      .toString()
      .split('\n')
      .filter((l) => l.startsWith('['))
      .forEach((l) => console.log(`  ${l.replace(/ -> .*/, '')}`));
    const outDir = join(ROOT, g.out);
    mkdirSync(outDir, { recursive: true });
    if (g.textures) {
      for (const file of readdirSync(raw).filter((f) => f.endsWith('.png')).sort()) {
        const dest = join(outDir, file.replace(/\.png$/, '.webp'));
        // Normal maps keep more quality (lossy blocks show as facets in the lighting).
        const quality = file.includes('normal') ? 90 : 85;
        const info = await sharp(join(raw, file)).webp({ quality, effort: 6, smartSubsample: true }).toFile(dest);
        console.log(`  ${g.out}/${file.replace(/\.png$/, '.webp')}: ${(info.size / 1024).toFixed(1)} KB`);
      }
      continue;
    }
    for (const file of glbFiles(raw).sort()) {
      const doc = await io.read(join(raw, file));
      await doc.transform(dedup(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const dest = join(outDir, file);
      mkdirSync(dirname(dest), { recursive: true });
      await io.write(dest, doc);
      const before = statSync(join(raw, file)).size;
      const after = statSync(dest).size;
      console.log(`  ${g.out}/${file}: ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
