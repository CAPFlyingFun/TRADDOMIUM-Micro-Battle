/** STAGE H PHASE 1 — does the brain decide correctly in the real world? */
import { chromium } from 'playwright';
const url = 'http://localhost:4220/';
const FIX = '21.97470778 -159.72064395 40.00m 225.0° -10.0° x1.00';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.evaluate((f) => window.__island.goTo(f), FIX);
await page.waitForTimeout(4000);

const show = async (tag) => {
  const a = await page.evaluate(() => ({
    ...window.__island.autonomy(),
    line: document.querySelector('[data-ui="compass-ai"]')?.textContent ?? null,
    notice: document.querySelector('[data-ui="notice"]')?.textContent ?? null,
    noticeShown: document.querySelector('[data-ui="notice"]')?.style.display ?? null,
  }));
  console.log(`[${tag}] goal=${a.goal} primary=${a.primary} detour=${a.detour}`
    + ` thirst=${(a.thirst * 100).toFixed(0)}% drain=${a.drain.toFixed(6)}/s`);
  console.log(`[${tag}]   channel=${a.channel ? (a.channel.range / 100).toFixed(0) + 'm' : 'none'}`);
  console.log(`[${tag}]   intent=${JSON.stringify(a.intent)}`);
  console.log(`[${tag}]   line: ${a.line}`);
  if (a.noticeShown === 'block') console.log(`[${tag}]   NOTICE: "${a.notice}"`);
};

await show('idle');

// A destination the far side of the island — a trip she cannot make dry.
const far = await page.evaluate(() => {
  const w = window.__island.where();
  return { wx: w[0] + 3_000_000, wz: w[2] };
});
await page.evaluate((p) => window.__island.orderTo(p.wx, p.wz), far);
await page.waitForTimeout(3000);
await show('ordered far');

// Now drain her and watch the detour commit.
await page.evaluate(() => window.__island.setThirst(0.25));
await page.waitForTimeout(3000);
await show('thirsty, far target');

// A destination a few metres away — comfortably within her water.
const near = await page.evaluate(() => {
  const w = window.__island.where();
  return { wx: w[0] + 400, wz: w[2] };
});
await page.evaluate(() => window.__island.setThirst(1));
await page.evaluate((p) => window.__island.orderTo(p.wx, p.wz), near);
await page.waitForTimeout(3000);
await show('ordered near');

await page.evaluate(() => window.__island.cancelOrder());
await page.waitForTimeout(1500);
await show('cancelled');
await page.screenshot({ path: '/tmp/autonomy.png' });
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
