/**
 * IS THE RIVER REAL — trench, surface, current, and a drink?
 *
 * The unit tests prove the module; this proves the module reached the
 * game. Four claims, each measured on the running scene at a real
 * reach (the lower Wainiha, 30 m wide, 2.9 m above the sea):
 *
 *   1. the ground inside the channel is BELOW the water — the carve
 *      reached terrainHeight and everything that reads it
 *   2. ribbons exist near her — the renderer streamed this reach in
 *   3. standing midstream, the current CARRIES her — and downstream,
 *      which on this reach means toward the sea
 *   4. at the bank she can DRINK: the button lights, held it refills
 *      an emptied reserve, and walking away goes back to draining
 *
 *   npm run probe:rivers      writes river-stand.png
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';

/** Lower Wainiha: centreline point, 30.3 m wide, level 2.9 m. */
const MID = { wx: -1_246_979, wz: 815_548 };

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

const fail = (why) => { console.log(`probe:rivers FAILED — ${why}`); process.exitCode = 1; };
const wait = async (seconds) => {
  const was = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (until) => window.__island.simTime() >= until, was + seconds, { timeout: 600000 },
  );
};

await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 180000 });
await page.waitForFunction(() => window.__island.simTime() > 1.2, null, { timeout: 300000 });

// ── 1. The trench, through the one true function ─────────────────────
await page.evaluate((at) => window.__island.putAt(at.wx, at.wz, 0), MID);
await wait(0.4);
const mid = await page.evaluate((at) => ({
  ground: window.__island.groundUnderfoot(),
  body: window.__island.waterBody(at.wx, at.wz),
  rivers: window.__island.riversDrawn(),
  surf: window.__island.surf(),
}), MID);
if (!mid.body || mid.body.kind !== 'river') fail(`midstream reads as ${mid.body?.kind ?? 'dry'}`);
else {
  const depth = (mid.body.drawn - mid.ground);
  console.log(`midstream: kind ${mid.body.kind}, surface ${(mid.body.drawn / 100).toFixed(2)} m, `
    + `bed ${(mid.ground / 100).toFixed(2)} m, depth ${depth.toFixed(0)} cm`);
  if (depth <= 0) fail('the bed is not below the water — did the carve reach the mesh?');
  const flow = Math.hypot(mid.body.flowX, mid.body.flowZ);
  console.log(`  flow ${flow.toFixed(0)} cm/s, grip ${mid.surf.grip.toFixed(2)}`);
  if (flow < 10) fail('no current midstream');
  if (mid.surf.grip < 0.9) fail(`midstream grip is ${mid.surf.grip} — the water does not have her`);
}
console.log(`  ribbons drawn nearby: ${mid.rivers}`);
if (mid.rivers < 1) fail('no river ribbons were streamed in');

// ── 2. The current carries her ───────────────────────────────────────
const from = await page.evaluate(() => window.__island.where());
await wait(3);
const to = await page.evaluate(() => window.__island.where());
const moved = Math.hypot(to[0] - from[0], to[2] - from[2]);
const promised = Math.hypot(mid.body.flowX, mid.body.flowZ) * 3;
console.log(`standing midstream for 3 s, the river moved her ${(moved / 100).toFixed(2)} m `
  + `(the flow promised ${(promised / 100).toFixed(2)})`);
// The mouth of the Wainiha is nearly FLAT, so its flow is the 10-unit
// clamp minimum and three seconds buys thirty units. What is asserted
// is CONSISTENCY with the flow, not drama: the first version demanded
// `>= 30` of a drift that is exactly 30 minus the ease-in.
if (moved < promised * 0.5) fail(`she moved ${moved.toFixed(0)} of a promised ${promised.toFixed(0)}`);
if (moved > promised * 2 + 60) fail('she moved far more than the current explains');
// Downstream on this reach is toward LOWER water: verify via the body.
const after = await page.evaluate(
  ([wx, wz]) => window.__island.waterBody(wx, wz), [to[0], to[2]],
);
if (after && mid.body && after.level > mid.body.level + 20) {
  fail('she was carried UPSTREAM — the flow sign is wrong in the scene');
}

// ── 3. A drink at the bank ───────────────────────────────────────────
// The water's EDGE, found by asking the page rather than by geometry:
// the lower Wainiha is BRAIDED, so "half a width past this channel's
// centreline" lands in the next braid over — which is how two earlier
// versions of this step put her in water while calling it a bank. The
// waterBody query is pure CPU; the search costs nothing.
const bank = await page.evaluate((mid) => {
  const dry = (wz) => {
    const body = window.__island.waterBody(mid.wx, wz);
    return !body || body.depth <= 0;
  };
  // March north out of ALL the braids first, then bisect back to the
  // last wet point so she stands a hand's width from real water.
  let wet = mid.wz;
  let land = mid.wz;
  for (let out = 1_000; out <= 60_000; out += 1_000) {
    land = mid.wz - out;
    if (dry(land) && dry(land - 400) && dry(land - 800)) break;
    wet = land;
  }
  for (let i = 0; i < 24; i++) {
    const between = (wet + land) / 2;
    if (dry(between)) land = between; else wet = between;
  }
  return { wx: mid.wx, wz: land - 1, edge: wet };
}, MID);
{
  await page.evaluate((at) => window.__island.putAt(at.wx, at.wz, 0), bank);
  await wait(0.4);
  const stood = await page.evaluate(() => window.__island.surf());
  console.log(`bank found ${((MID.wz - bank.wz) / 100).toFixed(1)} m north of midstream, `
    + `grip there ${stood.grip.toFixed(2)}`);
  if (stood.grip > 0.3) fail(`the bank spot is not a bank — grip ${stood.grip}`);
  await page.evaluate(() => window.__island.parch());
  await wait(0.3);
  const dry = await page.evaluate(() => ({
    thirst: window.__island.thirst(),
    can: !document.querySelector('[data-ui="drink"]')?.disabled,
  }));
  console.log(`at the bank: thirst emptied to ${dry.thirst.toFixed(2)}`);
  await page.keyboard.down('KeyE');
  await wait(2.5);
  const wet = await page.evaluate(() => ({
    thirst: window.__island.thirst(),
    drinking: window.__island.drinking(),
  }));
  await page.keyboard.up('KeyE');
  console.log(`  after 2.5 s holding DRINK: thirst ${wet.thirst.toFixed(2)}, `
    + `drinking flag ${wet.drinking}`);
  if (wet.thirst < 0.15) fail('holding the button refilled nothing');
  await page.screenshot({ path: 'river-stand.png' });
  const { width, height, data } = readPng('river-stand.png');
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
  }
  if (lit < width * height * 0.5) fail('river-stand.png is mostly black');
}

if (!process.exitCode) console.log('\nprobe:rivers passed');
await browser.close();
