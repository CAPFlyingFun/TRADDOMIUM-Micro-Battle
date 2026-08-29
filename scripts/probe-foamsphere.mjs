/**
 * STAGE 2 ACCEPTANCE, MEASURED — is the foam actually inside the
 * master LOD sphere, and does the water survive it?
 *
 * The master gate hands us a control foam tuning never had:
 * `lodForce(0)` pins the MICRO fraction to zero everywhere, which by
 * the Stage 2 rule means "no foam of any kind"; `lodForce(1)` pins it
 * to one, which means "the sphere takes nothing away". So the shipped
 * frame can be held against both ends.
 *
 * THE SEA IS ANIMATED, WHICH IS WHY THERE IS A NOISE FLOOR. Two
 * screenshots of the SAME state seconds apart already differ — the
 * swell has moved, the ripples have scrolled. A raw per-pixel diff
 * therefore says "5% of pixels changed" whether or not anything was
 * gated, and an earlier cut of this probe believed it. So every
 * comparison is calibrated against a same-state pair, and the metric
 * that carries the verdict is the MEAN LUMINANCE of the water, which
 * is what "how much white is on the sea" means and which the
 * animation leaves alone.
 *
 * WHAT EACH VIEW PROVES.
 *
 *   ALTITUDE   at 166 m every water pixel is far outside a 20 m
 *              sphere, so the shipped frame must match lodForce(0) —
 *              no foam of any kind — and must be visibly darker than
 *              lodForce(1), which is the foam that used to be drawn
 *              there and is the work now skipped.
 *
 *   NEAR       ten metres up, looking down, the frame is full of
 *              water INSIDE the sphere, so the shipped frame must sit
 *              clearly brighter than lodForce(0): the gate must not
 *              have taken the surf she is standing in. It is not
 *              expected to match lodForce(1), because water further
 *              out in the same frame is legitimately outside the
 *              sphere and only lodForce(1) puts foam back on it.
 *
 * WHAT NEITHER VIEW HAS TO PROVE is that foam INSIDE the sphere is
 * unchanged from the approved look, and that is not a gap: the gate's
 * only effect on the foam value is a multiply by the MICRO fraction,
 * and that fraction is exactly 1.0 out to 0.7 of the radius by the
 * core's own unit tests. Inside fourteen metres the arithmetic is
 * therefore identical to v0.0.96's, which is a stronger statement
 * than any screenshot could make.
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(9000);

/** Water pixels only: bluer than they are red. Sand and sky are not. */
const isWater = (d, i) => d[i + 2] > d[i] + 12;
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/**
 * Mean luminance over a FIXED set of pixels — and the fixed part is
 * the point. Classifying water per frame let the metric lie: foam
 * pushes a pixel toward white, white is no longer "bluer than it is
 * red", so adding foam quietly DROPPED the whitest pixels out of the
 * sample and the mean fell when it should have risen. One mask, taken
 * once, compared across every state.
 */
function maskOf({ data }) {
  const mask = new Uint8Array(data.length / 4);
  for (let i = 0; i < data.length; i += 4) mask[i / 4] = isWater(data, i) ? 1 : 0;
  return mask;
}

function whiteness({ data }, mask) {
  let sum = 0; let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!mask[i / 4]) continue;
    sum += lum(data, i);
    n++;
  }
  return { lum: n ? sum / n : 0, px: n };
}

/** Share of water pixels that differ at all, for context. */
function changedPct(a, b) {
  let changed = 0; let water = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (!isWater(a.data, i) && !isWater(b.data, i)) continue;
    water++;
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > 2) changed++;
  }
  return water ? (changed / water) * 100 : 0;
}

const LAT = 22.20069511;
const LON = -159.50342929;

async function shoot(name) {
  await page.waitForTimeout(1400);
  const path = `/tmp/foamsphere-${name}.png`;
  await page.screenshot({ path, timeout: 120000 });
  return readPng(path);
}

async function force(v) {
  await page.evaluate((x) => window.__island.lodForce(x), v);
}

/**
 * WHERE TO STAND, and the near one is chosen rather than obvious.
 *
 * An eye-level shot at the waterline looks like the right near-field
 * test and is a bad instrument: the surf band is a couple of thousand
 * pixels of the most violently animated water in the game, and its
 * mean luminance swings by twenty between frames — far more than the
 * effect being measured. Ten metres up on a steep look-down fills the
 * frame with water that is INSIDE a 20 m sphere, which is both a big
 * sample and a calm one.
 */
const VIEWS = [
  // IN THE SURF, and the depth is the whole of the choice. Foam is a
  // function of the water column: `surf` runs from 3.2 m of depth
  // down to 30 cm and the bright wash crowds the last 1.7 m, so a
  // spot in three metres of water carries almost no foam in ANY state
  // and proves nothing — the first cut of this view sat there and
  // measured the gate against an empty sea. This fix is 1.3 m deep,
  // eight metres below her, which is inside the sphere and inside the
  // wash.
  { name: 'near', lon: -159.506429, msl: 8, pitch: -75.0, expect: 'foam' },
  // Joshua's own fix, and the altitude the whole thing is about.
  { name: 'altitude', lon: LON, msl: 170, pitch: -33.1, expect: 'none' },
];

for (const view of VIEWS) {
  const { pitch } = view;
  const msl = view.msl.toFixed(2);
  const agl = view.name;
  await page.evaluate((f) => window.__island.goTo(f),
    `${LAT.toFixed(8)} ${view.lon.toFixed(8)} ${msl}m 268.0° ${pitch.toFixed(1)}° ×1.00`);
  await page.waitForTimeout(14000);
  const report = await page.evaluate(() => window.__island.lod());

  // THE SEA NEVER HOLDS STILL, so one shot per state is one sample of
  // a moving thing. Each state is sampled SHOTS times and compared as
  // a mean against the spread WITHIN the states — a difference has to
  // be large against the frame-to-frame wobble to count, which is a
  // measurement rather than a threshold somebody chose.
  // AND THE STATES ARE INTERLEAVED, which an earlier cut of this
  // probe was not. Sampling all of one state and then all of the next
  // confounds the state with the clock: whichever went first wore the
  // scene's remaining settling — tiles landing, the swell finding its
  // stride — and came back with a mean five times more variable than
  // the states that followed it. Round-robin gives every state the
  // same share of whatever is still moving.
  const SHOTS = 3;
  await force(null);
  const mask = maskOf(await shoot(`agl${agl}-mask`));
  const states = {
    shipped: { force: null, runs: [] },
    none: { force: 0, runs: [] },
    full: { force: 1, runs: [] },
  };
  for (let round = 0; round < SHOTS; round++) {
    for (const [label, state] of Object.entries(states)) {
      await force(state.force);
      state.runs.push(whiteness(await shoot(`agl${agl}-${label}${round}`), mask).lum);
    }
  }
  await force(null);
  const summarise = ({ runs }) => ({
    mean: runs.reduce((a, b) => a + b, 0) / runs.length,
    spread: Math.max(...runs) - Math.min(...runs),
    runs,
  });
  const sShip = summarise(states.shipped);
  const sNone = summarise(states.none);
  const sFull = summarise(states.full);

  // The wobble a difference has to clear: the worst within-state
  // spread seen, floored so a lucky run of near-identical frames
  // cannot make a nothing look like a something.
  const noise = Math.max(sShip.spread, sNone.spread, sFull.spread, 0.05);
  const dNone = Math.abs(sShip.mean - sNone.mean);
  const dFull = Math.abs(sShip.mean - sFull.mean);

  console.log(`\n${view.name.toUpperCase()} — MSL ${msl} m   dial ${report.dialPercent}%  radius ${report.radiusM} m`
    + `   ground below ${report.below.distanceM} m` + (report.below.seaM !== undefined ? `   SEA below ${report.below.seaM} m` : "") + `  micro ${report.below.microFraction.toFixed(2)}`
    + `   water px ${whiteness(await shoot(`agl${agl}-final`), mask).px}`);
  console.log(`  mean water luminance   shipped ${sShip.mean.toFixed(2)}`
    + `   lodForce(0) ${sNone.mean.toFixed(2)}   lodForce(1) ${sFull.mean.toFixed(2)}`);
  console.log(`  within-state spread    shipped ${sShip.spread.toFixed(3)}`
    + `   none ${sNone.spread.toFixed(3)}   full ${sFull.spread.toFixed(3)}`
    + `   -> noise ${noise.toFixed(3)}`);
  console.log(`  shipped vs no-foam     ${dNone.toFixed(3)}`
    + `   vs sphere-off ${dFull.toFixed(3)}`);

  if (view.expect === 'none') {
    // Outside the sphere the shipped frame must be INDISTINGUISHABLE
    // from having no foam at all, and clearly apart from the foam
    // that used to be drawn there.
    const matchesNone = dNone <= noise;
    const beatsFull = dFull > noise * 3;
    console.log(matchesNone && beatsFull
      ? `  PASS  at ${report.below.distanceM} m the sea carries no foam:`
      + ` shipped sits within the frame-to-frame wobble of the no-foam`
      + ` control, while the sphere removed ${dFull.toFixed(2)} of`
      + ' luminance that used to be drawn there'
      : `  FAIL  altitude foam wrong (vs none ${dNone.toFixed(3)},`
      + ` vs full ${dFull.toFixed(3)}, noise ${noise.toFixed(3)})`);
  } else {
    // Inside the sphere the surf must survive — and it must be the
    // foam ADDING brightness, not merely a difference.
    const drawn = dNone > noise * 3 && sShip.mean > sNone.mean;
    console.log(drawn
      ? `  PASS  the surf she stands in is still drawn:`
      + ` ${dNone.toFixed(2)} of luminance above the no-foam control,`
      + ` against a ${noise.toFixed(2)} wobble`
      : `  FAIL  near-field foam missing (vs none ${dNone.toFixed(3)},`
      + ` noise ${noise.toFixed(3)})`);
  }
}

/**
 * AND DOES IT ACTUALLY SAVE ANYTHING? — the half of Stage 2 that a
 * picture cannot answer.
 *
 * The point of gating rather than multiplying by zero is that the
 * fragment SKIPS four texture samples, their derivatives and the
 * swell sum. So: sit at altitude, where every water fragment is
 * outside the sphere and the whole frame takes the same branch, and
 * compare the frame rate with the branch shut (lodForce(0), which is
 * what ships there) against it forced open (lodForce(1), which is the
 * work the old build did).
 *
 * The frame rate is read off the HUD's own counter rather than a new
 * hook — it is already a rolling mean of 120 frames, which is exactly
 * the instrument wanted, and reading the DOM adds nothing to the
 * game. This runs under SwiftShader, a software rasteriser, so treat
 * the RATIO as the signal and never the absolute numbers.
 */
await page.evaluate((f) => window.__island.goTo(f),
  `${LAT.toFixed(8)} ${LON.toFixed(8)} 170.00m 268.0° -33.1° ×1.00`);
await page.waitForTimeout(14000);

/** Median frame time over a window, timed in the page itself. The
 *  HUD's own counter is rounded to whole frames a second, which at
 *  these rates cannot resolve anything smaller than five per cent. */
async function frameMs(seconds) {
  return page.evaluate((s) => new Promise((done) => {
    const gaps = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now - start < s * 1000) requestAnimationFrame(tick);
      else {
        gaps.sort((a, b) => a - b);
        done({ median: gaps[gaps.length >> 1], frames: gaps.length });
      }
    };
    requestAnimationFrame(tick);
  }), seconds);
}

async function costAfter(forceTo) {
  await force(forceTo);
  await page.waitForTimeout(3000);
  return frameMs(12);
}

// Alternated rather than run back to back, for the same reason the
// luminance sampling is: whichever went first would otherwise wear
// any drift in the machine underneath.
const shutRuns = []; const openRuns = [];
for (let i = 0; i < 2; i++) {
  shutRuns.push((await costAfter(0)).median);
  openRuns.push((await costAfter(1)).median);
}
await force(null);
const shut = Math.min(...shutRuns);
const open = Math.min(...openRuns);
console.log('\nGPU saving at altitude — every water fragment outside the sphere');
console.log(`  foam work SKIPPED (lodForce 0): ${shut.toFixed(1)} ms/frame`
  + `   [${shutRuns.map((v) => v.toFixed(1)).join(', ')}]`);
console.log(`  foam work FORCED  (lodForce 1): ${open.toFixed(1)} ms/frame`
  + `   [${openRuns.map((v) => v.toFixed(1)).join(', ')}]`);
const saved = ((open - shut) / open) * 100;
console.log(`  ${saved >= 0 ? '' : '+'}${Math.abs(saved).toFixed(1)}%`
  + ` ${saved >= 0 ? 'less' : 'MORE'} frame time with the foam path skipped`
  + '   (SwiftShader: read the ratio, never the rate)');
console.log(saved > 3
  ? '  PASS  the branch buys real work, not only a look'
  : '  NOTE  no clear frame-time gain measured here — see the commit notes');

// THE WATER MUST STILL BE WATER. With every foam ingredient forced
// off, the sea still has to be drawn — colour, alpha, ripple — so a
// frame with the sheets HIDDEN must differ from it substantially.
await force(0);
const foamless = await shoot('water-present-foamless');
await page.evaluate(() => window.__island.hideAllWater());
const hidden = await shoot('water-hidden');
await force(null);
const seaDiff = changedPct(foamless, hidden);
console.log(`\nwater still drawn without foam: ${seaDiff.toFixed(1)}%`
  + ' of px differ from a frame with the sheets hidden');
console.log(seaDiff > 20
  ? '  PASS  the sea survives losing its foam'
  : '  FAIL  removing foam appears to have removed the water');

console.log('\npageerrors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
