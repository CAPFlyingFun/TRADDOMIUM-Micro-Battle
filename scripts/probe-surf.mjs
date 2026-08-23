/**
 * DOES A WAVE ACTUALLY MOVE HER?
 *
 * The unit tests prove the flow field. They cannot prove it reaches her
 * — the carry is threaded from the scene through `PlayerAnt.update`,
 * and a null lost anywhere along the way leaves a queen standing
 * serenely in breaking surf with every number correct.
 *
 * So this stands her in the swash zone, holds her still, and watches
 * where she ends up. Twice: once with her legs doing nothing, and once
 * sprinting seaward into it, because "she cannot outrun it" is the
 * claim worth checking at eleven millimetres long.
 *
 *   npm run probe:surf      writes surf-before.png and surf-after.png
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';

/** The south-coast beach the ocean probe uses: 3.5 m up, one cell from the sea. */
const BEACH = { wx: 1_017_188, wz: 2_078_125 };
/** An adult queen: 10 mm, and a world unit is a centimetre. */
const QUEEN = 1.0;
/**
 * Long enough to be several wave periods.
 *
 * The longest component has a period of 2π/0.82 ≈ 7.7 s, and the first
 * version of this probe watched for FOUR — half of one wave — then
 * reported the sea carrying her out to sea because that is what the
 * back half of a wave does. Net transport is a question you can only
 * ask over whole cycles.
 */
const WATCH = 24;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

const fail = (why) => { console.log(`probe:surf FAILED — ${why}`); process.exitCode = 1; };
const wait = async (seconds) => {
  const was = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (until) => window.__island.simTime() >= until, was + seconds, { timeout: 600000 },
  );
};

await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 180000 });
await page.waitForFunction(() => window.__island.simTime() > 1.2, null, { timeout: 300000 });

/**
 * WALK HER DOWN TO THE WATER. The beach point is dry at rest, so the
 * probe steps seaward until the sea is actually over her — otherwise it
 * measures a queen standing on sand and calls the surf broken.
 */
let stood = null;
for (let out = 0; out <= 30_000 && !stood; out += 1_500) {
  await page.evaluate(
    ({ wx, wz }) => window.__island.putAt(wx, wz, 0), { wx: BEACH.wx, wz: BEACH.wz + out },
  );
  await wait(0.35);
  const seen = await page.evaluate(() => window.__island.surf());
  if (seen.depth > 2) stood = { out, seen };
}
if (!stood) fail('never found water to stand her in');
else {
  console.log(`in the water ${stood.out / 100} m out from the beach mark`);
  // A world unit IS a centimetre; a body length is a tenth of one.
  console.log(`  depth ${stood.seen.depth.toFixed(1)} cm `
    + `(${(stood.seen.depth / QUEEN).toFixed(0)} body lengths), `
    + `grip ${stood.seen.grip.toFixed(2)}, `
    + `flow ${Math.hypot(stood.seen.x, stood.seen.z).toFixed(0)} cm/s`);
}

await page.screenshot({ path: 'surf-before.png' });

/** 1. HANDS OFF. She asks for nothing; the sea decides. */
const from = await page.evaluate(() => window.__island.where());
let farthest = 0;
const step = 2;
let seen = from;
for (let t = 0; t < WATCH; t += step) {
  await wait(step);
  seen = await page.evaluate(() => window.__island.where());
  farthest = Math.max(farthest, Math.hypot(seen[0] - from[0], seen[2] - from[2]));
}
const to = seen;
const moved = Math.hypot(to[0] - from[0], to[2] - from[2]);
console.log(`over ${WATCH} s the sea threw her ${(farthest / 100).toFixed(2)} m about, `
  + `and left her ${(moved / 100).toFixed(2)} m from where she started`);
if (farthest < 20) fail(`the sea moved her ${farthest.toFixed(0)} units — is the carry wired up?`);

/**
 * 2. AND IT PUT HER UP THE BEACH, not out to sea. There is no swimming
 * yet, so a sea that could tow her out is a way to lose a queen.
 */
const up = from[2] - to[2];
console.log(`  net ${up > 0 ? 'UP THE BEACH' : 'OUT TO SEA'} by ${Math.abs(up / 100).toFixed(2)} m`);
if (up <= 0) fail('over whole wave periods the sea carried her seaward — she can be lost');

/** 3. SPRINTING INTO IT. Eleven millimetres long; she should not win. */
await page.evaluate(() => { window.__island.setPace('run'); window.__island.setSprint(true); });
const dug = await page.evaluate(() => window.__island.where());
await page.keyboard.down('KeyS');
await wait(WATCH);
await page.keyboard.up('KeyS');
const fought = await page.evaluate(() => window.__island.where());
console.log(`sprinting seaward for ${WATCH} s, she made `
  + `${((fought[2] - dug[2]) / 100).toFixed(2)} m toward the sea`);

await page.screenshot({ path: 'surf-after.png' });
if (!process.exitCode) console.log('\nprobe:surf passed');
await browser.close();
