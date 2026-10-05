import { chromium } from '@playwright/test';
const [,, ...files] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 920, height: 920 } });
for (const f of files) { await p.goto('file://' + f); await p.screenshot({ path: f.replace(/\.svg$/, '.png'), fullPage: true }); }
await b.close();
