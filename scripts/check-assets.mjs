#!/usr/bin/env node
/**
 * Validate the committed game assets in public/game/ (IMPLEMENTATION §M2.1). Runs in `npm test` through
 * src/assets/__tests__/assets.test.ts, so CI enforces it without Blender.
 *
 *   node scripts/check-assets.mjs      # prints problems, exits 1 if any
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import validator from 'gltf-validator';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export const CHASSIS = ['dart', 'wisp', 'comet', 'arrow', 'titan', 'bastion'];
export const SOCKETS = ['socket_engine', 'socket_booster_L', 'socket_booster_R', 'socket_stabilizer', 'socket_hull', 'socket_exhaust_L', 'socket_exhaust_R'];
export const PART_SLOTS = ['engine', 'booster', 'stabilizer', 'hull'];
export const ROLES = ['livery_primary', 'livery_secondary', 'glow', 'metal', 'glass', 'dark'];
export const BUDGET = {
  lod0: 12000,
  lod1: 4000,
  part: 1500,
  partPrimitives: 3, // §V.7: at most 3 material roles (= draw calls) per part
  lodPrimitives: 6, // one per role
  shipBytes: 300 * 1024, // §V.4 (was 400)
  partsBytes: 600 * 1024,
  trimBytes: 400 * 1024, // the shared trim sheet, all its textures
  shipAssetsBytes: 2 * 1024 * 1024, // ships + parts + trim
  worldBytes: 2.5 * 1024 * 1024,
  prop: 6000,
};
/** The shared trim sheet (blender/textures/build_trim.py) next to the ship GLBs. */
export const TRIM_FILES = ['trim_normal.webp', 'trim_orm.webp'];
/**
 * LOD0 hull bounding-box size (x, y, z metres) before §V: a reworked hull must stay within ±10% per axis
 * (§V.1, identity is locked). Measured from the M2 GLBs.
 */
export const HULL_SIZE = {
  dart: [2.58, 1.181, 5.118],
  wisp: [2.939, 1.462, 4.468],
  comet: [2.56, 1.04, 4.521],
  arrow: [2.16, 1.265, 5.268],
  titan: [3.0, 1.17, 4.582],
  bastion: [2.84, 1.083, 4.529],
};
export const HULL_TOLERANCE = 0.1;
/** Chassis rebuilt in the §V look: they carry trim UVs (TEXCOORD_0) and baked AO. Since V3, all six. */
export const GROUNDED = [...CHASSIS];

/** Khronos glTF validation; returns error messages (warnings and infos are not problems). */
async function validationErrors(bytes, where) {
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 20, severityOverrides: {} });
  return report.issues.messages.filter((m) => m.severity === 0).map((m) => `${where}: glTF validation: ${m.code} ${m.message} (${m.pointer ?? ''})`);
}
/** World prop bundles (public/game/worlds/<world>/props.glb) and the props each theme instances. */
export const WORLD_PROPS = {
  'neon-bay': ['tower_0', 'tower_1', 'tower_2', 'pyramid_0', 'palm_0', 'palm_1', 'palm_2', 'airship_0'],
  'sunset-mesa': ['mesa_0', 'mesa_1', 'mesa_2', 'spire_0', 'spire_1', 'pylon_0', 'billboard_0', 'cactus_0', 'cactus_1'],
  'cryo-station': ['spire_0', 'spire_1', 'spire_2', 'glacier_0', 'glacier_1', 'tower_0', 'dome_0', 'mast_0'],
  'jade-ruins': ['temple_0', 'temple_1', 'column_0', 'column_1', 'column_2', 'statue_0', 'fern_0', 'fern_1'],
  'orbital-ring': ['rib_0', 'truss_0', 'solar_0', 'module_0', 'dish_0'],
};
export const PROP_ROLES = ['sandstone', 'chrome', 'dark', 'neon', 'foliage', 'ice'];

function triangles(mesh) {
  let n = 0;
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

/** World-space translation of a node (sockets are empties under the ship root). */
function worldPosition(node) {
  const m = node.getWorldMatrix();
  return [m[12], m[13], m[14]];
}

function materialProblems(doc, where, roles = ROLES) {
  const out = [];
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName().replace(/\.\d+$/, '');
    if (!roles.includes(name)) out.push(`${where}: material "${mat.getName()}" is not a role (${roles.join(', ')})`);
  }
  return out;
}

/** Total bytes of every file under `dir`. */
function dirBytes(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}

export async function checkAssets(root = resolve(import.meta.dirname, '..')) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const problems = [];
  const report = {};

  for (const id of CHASSIS) {
    const file = join(root, 'public/game/ships', `${id}.glb`);
    let doc;
    let raw;
    try {
      raw = readFileSync(file);
      doc = await io.readBinary(new Uint8Array(raw));
    } catch (e) {
      problems.push(`ships/${id}.glb: cannot read (${e.message})`);
      continue;
    }
    problems.push(...(await validationErrors(raw, `ships/${id}.glb`)));
    const bytes = statSync(file).size;
    if (bytes > BUDGET.shipBytes) problems.push(`ships/${id}.glb: ${(bytes / 1024).toFixed(0)} KB > ${BUDGET.shipBytes / 1024} KB`);
    const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
    if (!nodes.has(id)) problems.push(`ships/${id}.glb: missing root node "${id}"`);
    for (const lod of [0, 1]) {
      const n = nodes.get(`${id}_LOD${lod}`);
      const mesh = n?.getMesh();
      if (!mesh) {
        problems.push(`ships/${id}.glb: missing mesh node "${id}_LOD${lod}"`);
        continue;
      }
      const tris = triangles(mesh);
      report[`${id}_LOD${lod}`] = tris;
      const max = lod === 0 ? BUDGET.lod0 : BUDGET.lod1;
      if (tris > max) problems.push(`ships/${id}.glb: LOD${lod} has ${tris} triangles > ${max}`);
      if (!mesh.listPrimitives().every((p) => p.getAttribute('COLOR_0'))) problems.push(`ships/${id}.glb: LOD${lod} lacks COLOR_0 (decal coordinates)`);
      if (mesh.listPrimitives().length > BUDGET.lodPrimitives) problems.push(`ships/${id}.glb: LOD${lod} has ${mesh.listPrimitives().length} primitives > ${BUDGET.lodPrimitives}`);
      if (GROUNDED.includes(id) && !mesh.listPrimitives().every((p) => p.getAttribute('TEXCOORD_0'))) problems.push(`ships/${id}.glb: LOD${lod} lacks TEXCOORD_0 (trim sheet UVs)`);
      if (lod === 0) {
        const b = getBounds(n);
        const size = b.max.map((v, i) => v - b.min[i]);
        report[`${id}_size`] = size.map((v) => +v.toFixed(3));
        size.forEach((v, i) => {
          const ref = HULL_SIZE[id][i];
          if (Math.abs(v - ref) > ref * HULL_TOLERANCE) problems.push(`ships/${id}.glb: LOD0 size ${'xyz'[i]} ${v.toFixed(3)} m is more than ±${HULL_TOLERANCE * 100}% from ${ref} m`);
        });
      }
    }
    for (const s of SOCKETS) if (!nodes.has(s)) problems.push(`ships/${id}.glb: missing ${s}`);
    const engine = nodes.get('socket_engine');
    const hull = nodes.get('socket_hull');
    if (engine && hull && !(worldPosition(engine)[2] > 0 && worldPosition(hull)[2] < 0)) {
      problems.push(`ships/${id}.glb: nose must point to -Z (engine socket at +Z, hull socket at -Z)`);
    }
    problems.push(...materialProblems(doc, `ships/${id}.glb`));
  }

  let trimBytes = 0;
  for (const f of TRIM_FILES) {
    try {
      trimBytes += statSync(join(root, 'public/game/ships', f)).size;
    } catch {
      problems.push(`ships/${f}: missing (npm run assets -- trim)`);
    }
  }
  report.trimKB = Math.round(trimBytes / 1024);
  if (trimBytes > BUDGET.trimBytes) problems.push(`trim sheet: ${(trimBytes / 1024).toFixed(0)} KB > ${BUDGET.trimBytes / 1024} KB`);

  const partsFile = join(root, 'public/game/parts/parts.glb');
  try {
    const partsRaw = readFileSync(partsFile);
    const doc = await io.readBinary(new Uint8Array(partsRaw));
    problems.push(...(await validationErrors(partsRaw, 'parts.glb')));
    const bytes = statSync(partsFile).size;
    if (bytes > BUDGET.partsBytes) problems.push(`parts.glb: ${(bytes / 1024).toFixed(0)} KB > ${BUDGET.partsBytes / 1024} KB`);
    const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
    for (const slot of PART_SLOTS) {
      for (let t = 0; t < 4; t++) {
        const name = `${slot}_t${t}`;
        const node = nodes.get(name);
        if (!node) {
          problems.push(`parts.glb: missing part "${name}"`);
          continue;
        }
        let tris = 0;
        const prims = [];
        node.traverse((n) => {
          const m = n.getMesh();
          if (m) {
            tris += triangles(m);
            prims.push(...m.listPrimitives());
          }
        });
        report[name] = tris;
        if (tris === 0) problems.push(`parts.glb: "${name}" has no mesh`);
        if (tris > BUDGET.part) problems.push(`parts.glb: "${name}" has ${tris} triangles > ${BUDGET.part}`);
        if (prims.length > BUDGET.partPrimitives) problems.push(`parts.glb: "${name}" has ${prims.length} primitives > ${BUDGET.partPrimitives}`);
        if (!prims.every((p) => p.getAttribute('TEXCOORD_0'))) problems.push(`parts.glb: "${name}" lacks TEXCOORD_0 (trim sheet UVs, §V V2)`);
        if (!prims.every((p) => p.getAttribute('COLOR_0'))) problems.push(`parts.glb: "${name}" lacks COLOR_0 (baked AO)`);
      }
    }
    problems.push(...materialProblems(doc, 'parts.glb'));
  } catch (e) {
    problems.push(`parts.glb: cannot read (${e.message})`);
  }

  try {
    const shipBytes = CHASSIS.reduce((a, id) => a + statSync(join(root, 'public/game/ships', `${id}.glb`)).size, 0) + statSync(partsFile).size + trimBytes;
    report.shipAssetsKB = Math.round(shipBytes / 1024);
    if (shipBytes > BUDGET.shipAssetsBytes) problems.push(`ship assets (ships + parts + trim): ${(shipBytes / 1024).toFixed(0)} KB > ${BUDGET.shipAssetsBytes / 1024} KB`);
  } catch {
    // missing files are reported above
  }

  for (const [world, props] of Object.entries(WORLD_PROPS)) {
    const where = `worlds/${world}/props.glb`;
    const file = join(root, 'public/game', where);
    try {
      const worldRaw = readFileSync(file);
      const doc = await io.readBinary(new Uint8Array(worldRaw));
      problems.push(...(await validationErrors(worldRaw, where)));
      const bytes = dirBytes(join(root, 'public/game/worlds', world));
      if (bytes > BUDGET.worldBytes) problems.push(`worlds/${world}: ${(bytes / 1024).toFixed(0)} KB > ${BUDGET.worldBytes / 1024} KB`);
      const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
      for (const name of props) {
        // Quantisation may move a prop's mesh onto an unnamed child node: count the whole subtree.
        const meshes = [];
        nodes.get(name)?.traverse((n) => n.getMesh() && meshes.push(n.getMesh()));
        if (meshes.length === 0) {
          problems.push(`${where}: missing prop "${name}"`);
          continue;
        }
        const tris = meshes.reduce((a, m) => a + triangles(m), 0);
        report[`${world}/${name}`] = tris;
        if (tris > BUDGET.prop) problems.push(`${where}: "${name}" has ${tris} triangles > ${BUDGET.prop}`);
        if (!meshes.every((m) => m.listPrimitives().every((p) => p.getAttribute('COLOR_0')))) problems.push(`${where}: "${name}" lacks COLOR_0 (baked colours)`);
      }
      if (world === 'sunset-mesa' && !nodes.has('screen')) problems.push(`${where}: billboard lacks its "screen" empty`);
      problems.push(...materialProblems(doc, where, PROP_ROLES));
    } catch (e) {
      problems.push(`${where}: cannot read (${e.message})`);
    }
  }

  return { problems, report };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { problems, report } = await checkAssets();
  console.log(Object.entries(report).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' x ') + ' m' : k.endsWith('KB') ? v + ' KB' : v + ' tris'}`).join('\n'));
  if (problems.length) {
    console.error(`\n✗ ${problems.length} asset problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\n✓ assets OK');
}
