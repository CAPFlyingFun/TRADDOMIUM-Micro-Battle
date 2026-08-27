/**
 * DOES WATER FIND THE VALLEYS? Runs the lab, lets it rain, shoots it.
 *   npm run probe:waterlab
 */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4200/';
const TAG = process.env.TAG ?? 'lab';
const EXTRA = process.env.EXTRA ?? '';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${url}?scene=water${EXTRA}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
// Rain on, then OFF — a patch under continuous rain wears a film
// everywhere and the film hides the channels the water is cutting
// through it. What is left after it drains is the drainage.
for (const [name, wait, rain] of [['t20', 18000, true], ['drain', 14000, false]]) {
  if (!rain) await page.keyboard.press('r');
  await page.waitForTimeout(wait);
  const hud = await page.evaluate(() => document.querySelector('div[style*="ui-monospace"]')?.textContent ?? '(no hud)');
  console.log(`--- ${name} ---\n${hud}`);
  await page.screenshot({ path: `/tmp/lab-${TAG}-${name}.png` });
}
if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
await browser.close();
