/**
 * STAND BESIDE THE WATER AND LOOK AT IT.
 *
 * Frames at spots the bake picked out — a stream at eye level and from
 * above, the Mana pond field, the deepest pond — plus THE FRAME FROM
 * JOSHUA'S OWN SCREENSHOT, restored from the fix line he sent, so a
 * change can be judged against the exact view that prompted it.
 *
 * Each frame renders twice, water layer on and off, and the pixel diff
 * says which pixels the water painted. That toggle is what proved the
 * pale wedges in an earlier pass were TERRAIN and not ribbon, after a
 * one-sided reading of the diff had suggested the opposite.
 *
 *   npm run probe:flow
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const OUT = process.env.PROBE_OUT
  ?? '/tmp/claude-0/-home-user/032a90d7-d065-5368-92aa-ede9a9abc594/scratchpad';
const URL = process.env.PROBE_URL ?? 'http://localhost:4173/';

const b = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM
    ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 932, height: 430 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.route('**://api.open-meteo.com/**', (r) => r.abort());
await p.goto(`${URL}?scene=island`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
const settle = async (sec) => {
  const from = await p.evaluate(() => window.__island.simTime());
  await p.waitForFunction((m) => window.__island.simTime() > m, from + sec,
    { timeout: 300000, polling: 250 });
};
await settle(1);

async function diff(tag) {
  const on = `${OUT}/${tag}.png`;
  const off = `${OUT}/${tag}-off.png`;
  await p.screenshot({ path: on });
  await p.evaluate(() => window.__island.showWater(false)); await settle(1);
  await p.screenshot({ path: off });
  await p.evaluate(() => window.__island.showWater(true)); await settle(1);
  const A = readPng(on); const B = readPng(off);
  let d = 0;
  for (let i = 0; i < A.width * A.height; i++) {
    if (Math.abs(A.data[i * 4] - B.data[i * 4]) > 6
      || Math.abs(A.data[i * 4 + 1] - B.data[i * 4 + 1]) > 6
      || Math.abs(A.data[i * 4 + 2] - B.data[i * 4 + 2]) > 6) d++;
  }
  const info = await p.evaluate(() => ({
    fix: window.__island.fix(), r: window.__island.riversDrawn(),
  }));
  console.log(`${tag}: drawn ${info.r}  water ${(100 * d / (A.width * A.height)).toFixed(2)}%`);
  console.log(`   ${info.fix}`);
}

/** Stand at a world point, lift the camera, aim it. */
async function look(wx, wz, upM, pitch, tag) {
  await p.evaluate(([x, z]) => window.__island.putAt(x, z, 0), [wx, wz]);
  await settle(2);
  const f = (await p.evaluate(() => window.__island.fix())).trim().split(/\s+/);
  await p.evaluate((t) => window.__island.goTo(t),
    `${f[0]} ${f[1]} ${(parseFloat(f[2]) + upM).toFixed(2)}m 0.0° ${pitch}° ×1.00`);
  await settle(3);
  await diff(tag);
}

/** Reproduce an exact fix line, as photographed. */
async function revisit(fix, tag) {
  await p.evaluate((t) => window.__island.goTo(t), fix);
  await settle(3);
  await diff(tag);
}

// The frame from Joshua's device screenshot of v0.0.40, the one he sent
// saying the water was still not wide enough.
await revisit('22.06941483 -159.34310113 23.59m 310.7° -6.3° ×1.00', 'joshua-frame');
// A mid-sized stream, beside it and from above.
await look(1039062, 371875, 8, -18, 'stream-eye');
await look(1039062, 371875, 60, -55, 'stream-above');
// AND FROM HER OWN EYE HEIGHT, which is the only view that really
// answers "is that a body of water". Eight metres up is a map. She is
// a centimetre long, so even thirty centimetres of lift is thirty body
// lengths — a bird's view of a stream — and whatever the water fails to
// be at this height it fails to be in the game.
await look(1039062, 371875, 0.3, -6, 'stream-ant');
// A TYPICAL station now that width is measured — 58 m across, which is
// the median of the whole island and so the one frame that says what
// the change actually did.
await look(1252344, -426562, 0.3, -6, 'wide-median');
// AND THE WORST CASE FOR THE GEOMETRY: 600 m across at a 45-degree
// turn, one of 1,517 stations over 120 m that also turn past 40. The
// strip folds on the inside of a bend once a half-width beats the
// polyline's own 27.5 m radius, and at 300 m of half-width it folds
// hard. Two laps of a transparent sheet blend twice where the later
// one happens to be nearer, which is the same fault as the pond
// lattice by another route, so this is the frame that would show it.
await look(142188, -1815625, 0.3, -6, 'fold-eye');
await look(142188, -1815625, 120, -50, 'fold-above');
// The Mana pond field (388 flooded cells at one 3 m level) and the deepest pond.
await look(-2364571, 384207, 40, -45, 'ponds-mana');
await look(-481250, -1826562, 35, -40, 'pond-deep');

console.log(errs.length ? 'ERRORS:\n  ' + errs.slice(0, 5).join('\n  ') : 'no page errors');
await b.close();
