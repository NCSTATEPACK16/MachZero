/**
 * Renders the iOS app icon (1024², opaque) and launch splash (2732², logo centred so any crop works) from
 * HTML with the game's colours and font, into ios/App/App/Assets.xcassets. Run: node scripts/ios-art.mjs
 */
import { chromium } from '@playwright/test';

const ICON = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
const SPLASH = 'ios/App/App/Assets.xcassets/Splash.imageset';

const page = (size, mode) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: #05030f; }
  .wrap { position: relative; width: 100%; height: 100%; overflow: hidden;
    background: radial-gradient(ellipse at 50% 120%, #3a0b5c 0%, #160631 45%, #05030f 80%); }
  .sun { position: absolute; left: 50%; top: ${mode === 'icon' ? 50 : 50}%; width: ${mode === 'icon' ? 70 : 26}%; aspect-ratio: 1;
    transform: translate(-50%, -62%); border-radius: 50%;
    background: linear-gradient(180deg, #ffe066 0%, #ff8a3d 38%, #ff2bd6 72%, #8a2be2 100%);
    -webkit-mask: repeating-linear-gradient(180deg, #000 0 ${size * 0.028}px, transparent ${size * 0.028}px ${size * 0.036}px);
    mask-image: linear-gradient(180deg, #000 52%, transparent 52%), repeating-linear-gradient(180deg, #000 0 ${size * 0.026}px, transparent ${size * 0.026}px ${size * 0.036}px);
    mask-composite: add; filter: drop-shadow(0 0 ${size * 0.03}px rgba(255, 43, 214, 0.6)); }
  .grid { position: absolute; left: -50%; right: -50%; bottom: 0; height: ${mode === 'icon' ? 44 : 30}%;
    background:
      repeating-linear-gradient(90deg, rgba(25, 240, 255, 0.85) 0 ${size * 0.004}px, transparent ${size * 0.004}px ${size * 0.06}px),
      repeating-linear-gradient(180deg, rgba(25, 240, 255, 0.85) 0 ${size * 0.004}px, transparent ${size * 0.004}px ${size * 0.05}px);
    transform: perspective(${size * 0.6}px) rotateX(62deg); transform-origin: 50% 100%;
    -webkit-mask: linear-gradient(180deg, transparent, #000 60%); }
  .mz { position: absolute; left: 0; right: 0; top: ${mode === 'icon' ? 47 : 49}%; text-align: center; transform: translateY(-50%);
    font: italic 900 ${mode === 'icon' ? size * 0.42 : size * 0.13}px/1 'Avenir Next Condensed', 'Arial Narrow', sans-serif;
    letter-spacing: -0.02em; color: #f4f7ff;
    background: linear-gradient(180deg, #ffffff 0%, #c9d6ff 45%, #19f0ff 52%, #5b2bd6 100%); -webkit-background-clip: text; color: transparent;
    filter: drop-shadow(0 0 ${size * 0.012}px #19f0ff) drop-shadow(0 ${size * 0.01}px 0 #ff2bd6); }
  .word { position: absolute; left: 0; right: 0; top: 60%; text-align: center; font: italic 800 ${size * 0.045}px/1 'Avenir Next Condensed', sans-serif;
    letter-spacing: 0.35em; color: #19f0ff; text-shadow: 0 0 ${size * 0.01}px #19f0ff; }
</style></head><body><div class="wrap"><div class="sun"></div><div class="grid"></div>
  <div class="mz">${mode === 'icon' ? 'MZ' : 'MACHZERO'}</div>${mode === 'icon' ? '' : '<div class="word">ANTI-GRAVITY RACING</div>'}</div></body></html>`;

const browser = await chromium.launch();
for (const [size, mode, out] of [
  [1024, 'icon', [ICON]],
  [2732, 'splash', [`${SPLASH}/splash-2732x2732.png`]],
]) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(page(size, mode));
  await p.evaluate(() => document.fonts.ready);
  for (const path of out) await p.screenshot({ path, omitBackground: false });
  await p.close();
  console.log(`${mode}: ${out.join(', ')}`);
}
await browser.close();
