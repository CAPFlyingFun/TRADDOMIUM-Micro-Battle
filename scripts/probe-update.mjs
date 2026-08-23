/**
 * DOES THE UPDATE CHECK ACTUALLY FIND AN UPDATE?
 *
 * A check that always answers "up to date" is indistinguishable from a
 * working one right up until the day it matters — which is the day
 * Joshua is looking at a stale build wondering whether the push landed.
 * So this drives the real button in the real page, twice: once against
 * the build that is genuinely deployed (must say up to date) and once
 * against a version.json rewritten in flight to a different commit
 * (must offer the update, and must actually take it).
 *
 * The second half is the whole point. It is the only way to exercise
 * the path that only ever runs when something has changed.
 *
 *   npm run probe:update
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

const fail = (why) => { console.log(`probe:update FAILED — ${why}`); process.exitCode = 1; };

/** What the server really says it is. */
let pretend = null;
await page.route('**/version.json*', async (route) => {
  const real = await route.fetch();
  const body = JSON.parse(await real.text());
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(pretend ? { ...body, ...pretend } : body),
  });
});

async function openSettings() {
  await page.waitForSelector('[data-ui="main-menu"]', { timeout: 180000 });
  // The gear is the settings panel's own button, alongside the menu.
  await page.click('[data-ui="menu-settings"]', { timeout: 20000 });
  return page.waitForSelector('[data-ui="check-updates"]', { timeout: 20000 });
}

await page.goto(url, { waitUntil: 'domcontentloaded' });
let button = await openSettings();
console.log(`the build says: ${await page.evaluate(
  () => document.querySelector('[data-ui="build"]')?.textContent)}`);

// ── 1. Against the build that is really deployed ─────────────────────
await button.click();
await page.waitForFunction(
  () => !/Checking/.test(document.querySelector('[data-ui="check-updates"]').textContent),
  null, { timeout: 30000 },
);
const settled = await button.textContent();
console.log(`  against the real version.json: "${settled}"`);
if (!/Up to date/.test(settled)) fail(`expected "up to date", got "${settled}"`);

// ── 2. Against a version.json claiming a different build ─────────────
pretend = { version: '99.0.0', commit: 'deadbee' };
await page.reload({ waitUntil: 'domcontentloaded' });
button = await openSettings();
await button.click();
await page.waitForFunction(
  () => /tap to update/i.test(document.querySelector('[data-ui="check-updates"]').textContent),
  null, { timeout: 30000 },
).catch(() => {});
const offered = await button.textContent();
console.log(`  against a newer version.json: "${offered}"`);
if (!/v99\.0\.0 available/.test(offered)) fail(`the update was not offered: "${offered}"`);

// ── 3. And taking it goes somewhere new ──────────────────────────────
await button.click();
await page.waitForFunction(
  () => new URL(location.href).searchParams.get('build') === 'deadbee',
  null, { timeout: 30000 },
).catch(() => {});
const landed = page.url();
console.log(`  after tapping update: ${landed}`);
if (!landed.includes('build=deadbee')) {
  fail('tapping update did not reload to a fresh URL');
}

/**
 * 4. AND IT MUST NOT LOOP. The reload lands on a page that will find
 * the same "newer" build again — the guard is the only thing between
 * that and a game that never starts.
 */
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 180000 });
const before = page.url();
await page.waitForTimeout(2500);
if (page.url() !== before) fail('it reloaded a second time — the loop guard is not holding');
else console.log('  and it did not reload again — the loop guard holds');

if (!process.exitCode) console.log('\nprobe:update passed');
await browser.close();
