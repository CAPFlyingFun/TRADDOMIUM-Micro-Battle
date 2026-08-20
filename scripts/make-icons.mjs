/**
 * Renders the home-screen icons from one SVG, so the set stays in step
 * with itself and nobody has to hand-export anything. Uses the Chromium
 * that already ships for the probes.
 *
 *   node scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(OUT, { recursive: true });

/** A worker seen from above, in the black-and-gold the HUD already uses. */
const ANT = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#241C0C"/>
      <stop offset="1" stop-color="#0E0B05"/>
    </linearGradient>
    <linearGradient id="chitin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFD98A"/>
      <stop offset="1" stop-color="#D79A2B"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#ground)"/>
  <g stroke="url(#chitin)" stroke-width="13" stroke-linecap="round" fill="none">
    <path d="M256 214 L150 150 M256 244 L128 244 M256 274 L150 338"/>
    <path d="M256 214 L362 150 M256 244 L384 244 M256 274 L362 338"/>
    <path d="M243 150 L214 96 M269 150 L298 96"/>
  </g>
  <g fill="url(#chitin)">
    <ellipse cx="256" cy="158" rx="46" ry="42"/>
    <ellipse cx="256" cy="246" rx="40" ry="52"/>
    <ellipse cx="256" cy="356" rx="56" ry="68"/>
  </g>
  <g fill="#160F05">
    <circle cx="232" cy="146" r="11"/>
    <circle cx="280" cy="146" r="11"/>
  </g>
</svg>`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
});
try {
  const page = await browser.newPage();
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0">${ANT.replace('<svg', `<svg width="${size}" height="${size}"`)}</body>`,
    );
    await page.locator('svg').screenshot({ path: OUT + name, omitBackground: true });
    console.log(`wrote public/${name}`);
  }
} finally {
  await browser.close();
}
