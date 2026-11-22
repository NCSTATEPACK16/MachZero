#!/usr/bin/env node
/**
 * Desktop perf baseline (IMPLEMENTATION §V.7 step 0) and draw-call audit (step 1).
 *
 *   npm run build && node scripts/perf-desktop.mjs [--quality high,med,low] [--world neon-bay] [--seconds 25] [--port 4183] [--audit]
 *
 * Serves dist/ with `vite preview`, opens an 8-ship autopilot race on the world (Neon Bay by default) in headed-off Chrome on the real GPU
 * (ANGLE Metal on macOS), lets it run, then prints fps, p95, draw calls and triangles per preset (the race's
 * FrameStats summary and renderer.info of one frame). With --audit (adds ?debug=1, which only exposes the scene) it
 * also counts the draw calls of one frame by category: each ship's chassis, parts and effects, the track,
 * the theme/scenery and the rest, by hiding one group at a time and re-rendering.
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
};
const presets = arg('--quality', 'high,med').split(',');
const seconds = Number(arg('--seconds', '25'));
const port = Number(arg('--port', '4183'));
const audit = process.argv.includes('--audit');
// The world to race (a world id from src/content/worlds.ts). `?world=` works whatever the feature flags say.
const world = arg('--world', 'neon-bay');

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start')), 30_000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(t);
      resolve();
    }
  });
  server.on('exit', (c) => reject(new Error(`vite preview exited ${c}`)));
});

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const rows = [];
try {
  for (const q of presets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    const url = `http://127.0.0.1:${port}/?autopilot=1&perf=1&dynres=0&quality=${q}&world=${world}${audit ? '&debug=1' : ''}`;
    await page.goto(url);
    // The grid (all 8 ships in front of the camera) is the worst case for ship draw calls.
    await page.waitForFunction(() => window.__machzero?.app?.session && window.__machzero.app.graphics.renderStats.calls > 0, null, { timeout: 60_000 });
    const grid = audit ? await page.evaluate(auditFrame) : null;
    await page.waitForFunction(() => window.__machzero?.app?.session?.state === 'racing', null, { timeout: 60_000 }).catch(() => {});
    const samples = [];
    for (let t = 0; t < seconds * 4; t++) {
      await page.waitForTimeout(250);
      samples.push(await page.evaluate(() => window.__machzero.app.graphics.renderStats.calls));
    }
    samples.sort((a, b) => a - b);
    const callRange = { min: samples[0], median: samples[samples.length >> 1], max: samples[samples.length - 1] };
    const r = await page.evaluate(() => {
      const mz = window.__machzero;
      const s = mz.perf();
      const st = mz.app.graphics.renderStats;
      return { fps: s.fps, p50: s.p50, p95: s.p95, p99: s.p99, missed: s.missed ?? s.missedPct, calls: st.calls, triangles: st.triangles, ships: mz.ships?.length };
    });
    let breakdown = null;
    if (audit) breakdown = await page.evaluate(auditFrame);
    rows.push({ q, ...r, callRange, grid, breakdown });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(`world ${world}`);
for (const r of rows) {
  console.log(
    `${r.q.padEnd(5)} fps ${r.fps?.toFixed?.(1) ?? r.fps}  p50 ${r.p50?.toFixed(1)}  p95 ${r.p95?.toFixed(1)}  p99 ${r.p99?.toFixed(1)} ms  draw calls ${r.calls}  triangles ${(r.triangles / 1000).toFixed(0)}k  ships ${r.ships}`,
  );
  console.log(`      race draw calls min ${r.callRange.min} / median ${r.callRange.median} / max ${r.callRange.max}`);
  const brief = (b) => Object.entries(b).map(([k, v]) => `${k} ${v.calls ?? JSON.stringify(v)}`).join(' | ');
  if (r.grid) console.log(`      grid frame: ${brief(r.grid)}`);
  if (r.breakdown) console.log(`      race frame: ${brief(r.breakdown)}`);
}

/** In the page: draw calls of one frame by category (hide a group, render, diff). */
function auditFrame() {
  const gfx = window.__machzeroGfx;
  const app = window.__machzero.app;
  const g = app.graphics;
  const info = gfx.renderer.info;
  const frame = () => {
    info.reset();
    g.render();
    return { calls: info.render.calls, tris: info.render.triangles };
  };
  const total = frame();
  const out = { total };
  const without = (objs) => {
    const vis = objs.map((o) => o.visible);
    objs.forEach((o) => (o.visible = false));
    const f = frame();
    objs.forEach((o, i) => (o.visible = vis[i]));
    return { calls: total.calls - f.calls, tris: total.tris - f.tris };
  };
  const models = gfx.models;
  out.ships = without(models.map((m) => m.root));
  // per ship: chassis vs parts vs the rest (effects) by mesh name
  const chassis = [];
  const parts = [];
  const fx = [];
  for (const m of models) {
    m.root.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isSprite && !o.isLine) return;
      let p = o;
      let kind = 'fx';
      while (p && p !== m.root) {
        if (/_LOD[01]$|_merged_/.test(p.name) || /_merged_/.test(o.name)) kind = 'chassis';
        else if (/^(engine|booster|stabilizer|hull|aero)_t\d/.test(p.name)) kind = 'parts';
        p = p.parent;
      }
      (kind === 'chassis' ? chassis : kind === 'parts' ? parts : fx).push(o);
    });
  }
  out.shipChassis = without(chassis);
  out.shipParts = without(parts);
  out.shipFx = without(fx);
  out.shipMeshes = { chassis: chassis.length, parts: parts.length, fx: fx.length, ships: models.length };
  const scene = gfx.scene;
  for (const child of scene.children) {
    if (models.some((m) => m.root === child)) continue;
    const key = `${child.type}:${child.name || '(unnamed)'}`;
    const d = without([child]);
    if (d.calls > 0) out[key] = (out[key] ? { calls: out[key].calls + d.calls, tris: out[key].tris + d.tris } : d);
  }
  // shadow pass share: render with shadows off
  const sh = gfx.renderer.shadowMap.enabled;
  gfx.renderer.shadowMap.enabled = false;
  gfx.renderer.shadowMap.needsUpdate = true;
  const ns = frame();
  gfx.renderer.shadowMap.enabled = sh;
  out.shadowPass = { calls: total.calls - ns.calls };
  return out;
}
