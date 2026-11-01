/**
 * Renders the iOS app icon (1024², opaque) and launch splash (2732²) into ios/App/App/Assets.xcassets, and the
 * website's icons (favicon.svg, apple-touch-icon and the web-app-manifest sizes) into public/icons. The mark is
 * "Mach 0": an italic neon zero broken by a speed streak with a bright dart at its tip. The splash is shown
 * aspect-fill, so a landscape iPhone sees only the middle ~1260 px band: the mark and wordmark stay inside it.
 * Run: npm run ios:art
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ICON = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
const SPLASH = 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png';
const WEB = 'public/icons';

const DEFS = `
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="glowS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
  <radialGradient id="bg" cx="50%" cy="42%" r="75%">
    <stop offset="0" stop-color="#2a0b52"/><stop offset="0.55" stop-color="#12052b"/><stop offset="1" stop-color="#05030f"/>
  </radialGradient>
  <linearGradient id="cm" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#19f0ff"/><stop offset="1" stop-color="#ff2bd6"/>
  </linearGradient>
  <linearGradient id="trail" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#19f0ff" stop-opacity="0"/><stop offset="0.7" stop-color="#19f0ff"/><stop offset="1" stop-color="#ffffff"/>
  </linearGradient>
  <mask id="cut"><rect width="1024" height="1024" fill="#fff"/><path d="M0 498 L1024 452 L1024 584 L0 600 Z" fill="#000"/></mask>`;

const RING = `<ellipse cx="512" cy="512" rx="250" ry="330" fill="none" stroke-width="112" transform="skewX(-12) translate(108 0)"/>`;
const DART = `M760 486 L964 522 L760 560 L800 522 Z`;

/** The mark on a 1024 canvas, without background. */
const MARK = `
  <g mask="url(#cut)">
    <g stroke="url(#cm)" filter="url(#glow)" opacity="0.8">${RING}</g>
    <g stroke="url(#cm)">${RING}</g>
    <ellipse cx="512" cy="512" rx="250" ry="330" fill="none" stroke="#ffffff" stroke-width="10" opacity="0.35"
      transform="skewX(-12) translate(108 0)"/>
  </g>
  <path d="M60 530 L800 506 L800 540 L60 544 Z" fill="url(#trail)" filter="url(#glowS)"/>
  <path d="M60 534 L800 514 L800 534 L60 540 Z" fill="url(#trail)"/>
  <path d="${DART}" fill="#ffffff" filter="url(#glowS)"/>
  <path d="${DART}" fill="#ffffff"/>`;

/** Faint speed lines behind the mark (icon only). */
const STREAKS = [180, 270, 760, 850]
  .map((y, i) => `<rect x="${i % 2 ? 90 : 40}" y="${y}" width="${i % 2 ? 260 : 340}" height="6" rx="3" fill="#19f0ff" opacity="0.25"/>`)
  .join('');

const svg = (body, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}"><defs>${DEFS}</defs>${body}</svg>`;

const ICON_BODY = `<rect width="1024" height="1024" fill="url(#bg)"/>${STREAKS}${MARK}`;
const iconPage = (size) => `<body style="margin:0">${svg(ICON_BODY, size)}</body>`;

const splashPage = (size) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; }
  body { background: radial-gradient(ellipse at 50% 45%, #2a0b52 0%, #12052b 30%, #05030f 60%);
    display: flex; flex-direction: column; align-items: center; justify-content: center; }
  svg { display: block; margin: -40px 0 -20px; }
  .word { font: italic 900 150px/1 'Avenir Next Condensed', 'Arial Narrow', sans-serif; letter-spacing: 0.06em;
    color: #f4f7ff; text-shadow: 0 0 24px rgba(25, 240, 255, 0.8), 0 6px 0 #ff2bd6; }
  .tag { margin-top: 36px; font: italic 700 46px/1 'Avenir Next Condensed', sans-serif; letter-spacing: 0.4em;
    color: #19f0ff; text-shadow: 0 0 12px #19f0ff; }
</style></head><body>${svg(MARK, 760)}<div class="word">MACHZERO</div><div class="tag">ANTI-GRAVITY RACING</div></body></html>`;

// Browser tab icon: the same artwork as vector, rounded like an app icon.
writeFileSync(
  `${WEB}/favicon.svg`,
  svg(`<clipPath id="r"><rect width="1024" height="1024" rx="228"/></clipPath><g clip-path="url(#r)">${ICON_BODY}</g>`, 1024).replace(/ width="1024" height="1024">/, '>') + '\n',
);
console.log(`${WEB}/favicon.svg`);

const browser = await chromium.launch();
for (const [size, html, path] of [
  [1024, iconPage(1024), ICON],
  [2732, splashPage(2732), SPLASH],
  [180, iconPage(180), `${WEB}/apple-touch-icon.png`],
  [192, iconPage(192), `${WEB}/icon-192.png`],
  [512, iconPage(512), `${WEB}/icon-512.png`],
]) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, omitBackground: false });
  await p.close();
  console.log(path);
}
await browser.close();
