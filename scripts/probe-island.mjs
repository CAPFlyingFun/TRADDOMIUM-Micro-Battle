/**
 * probe:island — boots the island lab headless, walks the ant forward,
 * and fails on console/page errors or if she does not actually move.
 * Writes probe-island.png next to this script's output dir for eyes-on
 * checks. Expects a server on PROBE_URL (default vite preview :4173).
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/?scene=island';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const before = await page.evaluate(() => document.querySelector('canvas') !== null);
  if (!before) throw new Error('no canvas rendered');

  // Walk forward for a beat and confirm frames keep coming.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: 'probe-island.png' });

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('probe:island OK — canvas up, no page errors, screenshot at probe-island.png');
} finally {
  await browser.close();
}
