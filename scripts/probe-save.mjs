/**
 * PHASE 2's ACCEPTANCE LIST, run against a real browser.
 *
 * SESSION_ARCHITECTURE.md asks for exactly these and they are exactly
 * the ones unit tests cannot answer: does the MENU stop the world, does
 * a save survive a REFRESH, does Continue put her back. The save
 * format has its own tests; this is about whether the format ever
 * reaches the disk and comes back into a running scene.
 *
 *   npm run probe:save
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

let bad = 0;
const check = (ok, what, saw = '') => {
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${what}${saw ? `  — ${saw}` : ''}`);
};

/** Wait on SIMULATED time; under SwiftShader wall time means nothing. */
const settle = async (seconds) => {
  const from = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (mark) => window.__island.simTime() > mark,
    from + seconds, { timeout: 300000, polling: 250 },
  );
};
const inWorld = () => page.waitForFunction(
  () => Boolean(window.__island), null, { timeout: 240000 },
);

// ── A fresh browser has nothing to continue ────────────────────────
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="continue"]', { timeout: 60000 });
check(
  await page.isDisabled('[data-ui="continue"]'),
  'a first launch offers nothing to continue',
);

// ── Start a run ────────────────────────────────────────────────────
await page.evaluate(() => window.__flow.play());
await inWorld();
await settle(2);
const started = await page.evaluate(() => window.__island.where());

// ── The menu stops the world ───────────────────────────────────────
await page.click('[data-ui="settings"]');
await page.waitForSelector('[data-ui="pause"]', { state: 'visible', timeout: 20000 });
check(await page.evaluate(() => window.__island.paused()), 'the cog pauses the world');

const held = await page.evaluate(() => window.__island.simTime());
await page.waitForTimeout(2500);
const stillHeld = await page.evaluate(() => window.__island.simTime());
check(held === stillHeld, 'the simulated clock does not advance while paused',
  `${held.toFixed(3)} → ${stillHeld.toFixed(3)}`);

// ── Save, and resume ───────────────────────────────────────────────
await page.click('[data-ui="pause-save"]');
const stored = await page.evaluate(
  () => JSON.parse(localStorage.getItem('traddomium.saves.v1') ?? '[]'),
);
check(stored.length === 1, 'saving writes exactly one slot', `${stored.length}`);
check(stored[0]?.saveVersion === 1, 'and stamps it with the format version');

await page.click('[data-ui="pause-resume"]');
check(!(await page.evaluate(() => window.__island.paused())), 'resume unpauses');
await settle(1.5);
check(
  (await page.evaluate(() => window.__island.simTime())) > stillHeld,
  'and the clock runs again',
);

// Move her somewhere unmistakable, then autosave-by-hand and reload.
await page.evaluate(() => window.__island.putAt(-402_000, 231_000, 1.1));
await settle(0.5);
const parked = await page.evaluate(() => window.__island.where());
await page.click('[data-ui="settings"]');
await page.waitForSelector('[data-ui="pause"]', { state: 'visible' });
await page.click('[data-ui="pause-save"]');

// ── The refresh, which is the whole point ──────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="continue"]', { timeout: 60000 });
check(
  !(await page.isDisabled('[data-ui="continue"]')),
  'a save survives a browser refresh',
);
const label = (await page.textContent('[data-ui="continue"]')) ?? '';
check(label.includes('CONTINUE'), 'and Continue is offered by name', label.trim());

await page.click('[data-ui="continue"]');
await inWorld();
await settle(1);
const back = await page.evaluate(() => window.__island.where());
const off = Math.hypot(back[0] - parked[0], back[2] - parked[2]);
// One body length is 1 unit; she is walking, so allow a short stroll.
check(off < 300, 'Continue puts her back where she was',
  `${off.toFixed(1)} units from ${parked[0].toFixed(0)},${parked[2].toFixed(0)}`);
check(
  Math.hypot(back[0] - started[0], back[2] - started[2]) > 1_000,
  'and NOT back at the spawn point',
);

// ── A corrupt save must fail gracefully ────────────────────────────
await page.evaluate(() => localStorage.setItem('traddomium.saves.v1', '{{{ not json'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="continue"]', { timeout: 60000 });
check(
  await page.isDisabled('[data-ui="continue"]'),
  'a corrupt store degrades to "no colony yet" rather than throwing',
);

console.log(bad === 0 ? '\nprobe:save PASSED' : `\nprobe:save FAILED — ${bad}`);
process.exitCode = bad === 0 ? 0 : 1;
await browser.close();
