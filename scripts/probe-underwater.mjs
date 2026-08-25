/**
 * PUT THE EYE UNDER THE WATER AND SEE WHETHER IT LOOKS LIKE IT.
 *
 * Joshua: "underwater looks like above ground." The reason that is easy
 * to miss here is scale. A world unit is a centimetre and the queen is
 * about one unit long, so her eye rides a few units off the ground,
 * while the water she can reach runs a median of 0.30 m deep and often
 * over a metre. At that ratio standing BESIDE a stream is almost always
 * standing INSIDE it, and the frames that show it were taken by
 * accident: three shots meant to show a newly widened stream from her
 * own eye height came back looking like dry sand. Ground 305.84 m under
 * a surface at 307.10 m with the camera 9 cm up is 1.17 m under; the
 * other two were 49 cm and 1.19 m under. Toggling the water layer off
 * changed 83-85% of those pixels, so the water was drawn and covering
 * nearly the whole view the entire time. It simply looked like air.
 *
 * ONE FRAME CANNOT ANSWER THIS, which is the whole design of this
 * probe. A single underwater frame is judged against a memory of what
 * the same place looked like dry, and memory is exactly what failed
 * before — the three frames above were read as dry sand by everyone who
 * looked at them. So every spot is shot as a PAIR a few centimetres
 * either side of its own waterline: same place, same bearing, same
 * pitch, same weather, one eye-height apart. Whatever differs between
 * those two pictures is the water and nothing else.
 *
 * AND EVERY FRAME PRINTS __island.submerged(). A frame that claims to
 * be underwater and is not is the failure this probe exists to catch,
 * and since the whole complaint is that the two states look alike, the
 * number is the only thing that can tell them apart. The fog density
 * and the sun intensity are printed beside it because submersion is a
 * read of where the camera is, not proof that the LOOK was applied —
 * applyWeather() rewrites both of those every frame, so an underwater
 * override that runs in the wrong order leaves the depth right and the
 * picture unchanged, which is the current bug wearing a disguise.
 *
 *   npm run probe:underwater
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const OUT = process.env.PROBE_OUT
  ?? '/tmp/claude-0/-home-user/032a90d7-d065-5368-92aa-ede9a9abc594/scratchpad';
const URL = process.env.PROBE_URL ?? 'http://localhost:4173/';

/**
 * How far either side of the measured waterline each half of a pair is
 * taken, in metres. Five centimetres is five body lengths, so the two
 * frames are a real step apart rather than the same frame twice, and it
 * clears the residual width of the search below by a comfortable margin
 * — see the bisection.
 */
const STEP = 0.05;

/**
 * Where the camera looks. The same −6° the eye-height flow frames used,
 * so a picture from here can be laid straight beside the ones that
 * started this instead of being compared across a change of attitude.
 */
const PITCH = -6;

/**
 * What every move is given to take effect, in SIMULATED seconds.
 *
 * THE SAME FIGURE EVERYWHERE ON PURPOSE. Restoring an airborne fix puts
 * her in powered flight at cruise, which is 40 units a second, so she
 * drifts about 60 cm downstream while a move settles. That is nothing
 * against reaches tens of metres across, but it is only harmless while
 * it is CONSTANT: a search that settles for half a second and a
 * screenshot that settles for three are measuring two different places,
 * and the waterline found by one would not be the waterline in the
 * other. So the search and the shot get the identical wait.
 */
const HOLD = 1.5;

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

/** Wait on SIMULATED time. Under SwiftShader wall time means nothing. */
const settle = async (sec) => {
  const from = await p.evaluate(() => window.__island.simTime());
  await p.waitForFunction((m) => window.__island.simTime() > m, from + sec,
    { timeout: 300000, polling: 250 });
};
await settle(1);

// Without this read there is no probe at all — every frame below would
// be an unlabelled picture of water that may or may not be water, which
// is the situation that produced the bug. Fail at the door and say why.
if (!(await p.evaluate(() => typeof window.__island.submerged === 'function'))) {
  console.log('__island.submerged() is missing: nothing here can tell an '
    + 'underwater frame from a dry one. Wire the scene up first.');
  await b.close();
  process.exit(1);
}

/** What the scene says about the frame it is drawing right now. */
const state = () => p.evaluate(() => ({
  under: window.__island.submerged(),
  fog: window.__island.fogDensity(),
  sun: window.__island.sunlight(),
}));

/**
 * A fix line at a given altitude, keeping the latitude and longitude the
 * spot's own putAt produced.
 *
 * THE RELIEF DIAL IS PINNED AT ×1.00, and it has to be: an altitude is
 * not a property of the island alone, so the same metres-above-sea-level
 * lands somewhere else entirely on a different dial, and the depths this
 * probe is chasing were all measured at 1.00.
 */
const line = (f, altM) =>
  `${f[0]} ${f[1]} ${altM.toFixed(2)}m 0.0° ${PITCH}° ×1.00`;

/**
 * Stand her at an altitude and report how deep the eye ended up.
 *
 * Rounds to the centimetre the fix line can actually carry, and returns
 * the ROUNDED figure, so the search below narrows on altitudes that were
 * really visited rather than on ones it merely asked for.
 */
async function moveTo(f, altM) {
  const asked = Math.round(altM * 100) / 100;
  await p.evaluate((t) => window.__island.goTo(t), line(f, asked));
  await settle(HOLD);
  return { asked, ...(await state()) };
}

/** Take the picture, then say where it was taken from. */
async function shoot(tag, altM) {
  const path = `${OUT}/${tag}.png`;
  await p.screenshot({ path });
  // Read AFTER the shutter: she is flying for these, so the closer the
  // reading sits to the frame the more honestly it describes it.
  const at = await state();
  const png = readPng(path);
  console.log(`   ${tag.padEnd(22)} ${altM.toFixed(2)}m  `
    + `under ${(at.under / 100).toFixed(2)} m (${at.under.toFixed(1)}u)  `
    + `fog ${at.fog.toExponential(2)}  sun ${at.sun.toFixed(2)}`);
  return { png, ...at };
}

/** The frame's average colour, which is where a tint shows up as a number. */
function mean(png) {
  const n = png.width * png.height;
  let r = 0, g = 0, bl = 0;
  for (let i = 0; i < n; i++) {
    r += png.data[i * 4]; g += png.data[i * 4 + 1]; bl += png.data[i * 4 + 2];
  }
  return [r / n, g / n, bl / n];
}

/**
 * What crossing the waterline did to the picture.
 *
 * The same six-level threshold the flow probe counts water pixels with,
 * so the two numbers can be read against each other. The HUD is in both
 * frames and identical in both, so it can only ever drag this figure
 * DOWN — a high number is not something it can manufacture.
 */
function compare(above, below) {
  const A = above.png, B = below.png;
  let changed = 0;
  for (let i = 0; i < A.width * A.height; i++) {
    if (Math.abs(A.data[i * 4] - B.data[i * 4]) > 6
      || Math.abs(A.data[i * 4 + 1] - B.data[i * 4 + 1]) > 6
      || Math.abs(A.data[i * 4 + 2] - B.data[i * 4 + 2]) > 6) changed++;
  }
  const [ar, ag, ab] = mean(A);
  const [br, bg, bb] = mean(B);
  const rgb = (r, g, bx) => `${r.toFixed(0)},${g.toFixed(0)},${bx.toFixed(0)}`;
  console.log(`   crossing changed ${(100 * changed / (A.width * A.height)).toFixed(2)}% `
    + `of the frame   mean ${rgb(ar, ag, ab)} -> ${rgb(br, bg, bb)}`);
}

/**
 * ONE SPOT, THREE FRAMES: where she really stands, and the pair either
 * side of the surface above her.
 *
 * The waterline is found by MOVING THE EYE UNTIL IT CROSSES rather than
 * by working out where the surface is in node. Computing it here would
 * mean a second answer to "where is the water", kept in step with
 * waterLevelAt() by hand, and would still not account for the camera
 * boom, which rides above and behind her and is what actually gets wet.
 * Bisecting on the scene's own reading has neither problem: whatever
 * submerged() says the surface is, is the surface this probe uses.
 */
async function dunk(wx, wz, tag, note) {
  console.log(`\n${tag}  ${note}`);
  await p.evaluate(([x, z]) => window.__island.putAt(x, z, 0), [wx, wz]);
  await settle(2);
  const f = (await p.evaluate(() => window.__island.fix())).trim().split(/\s+/);
  const ground = parseFloat(f[2]);

  // HER OWN VIEW FIRST, standing on the bed with nothing adjusted. This
  // is the frame the complaint is about — the other two exist to prove
  // what it should have looked like.
  const rest = await shoot(`${tag}-rest`, ground);
  if (rest.under <= 0) {
    console.log('   NOT IN WATER at rest. This spot was 0.71-1.37 m deep when it '
      + 'was measured, so either the bake moved the water or the flow index is '
      + 'not being read. Nothing below would mean anything.');
    return;
  }

  // BRACKET THE SURFACE. She is standing in it, so her own altitude is
  // known wet; lift her by the depth just measured plus a margin and the
  // eye should break out. Doubling rather than guessing again covers the
  // case where the boom is clamped low against the bed and the first
  // estimate is short.
  let wet = ground;
  let dry = null;
  let lift = rest.under / 100 + 0.3;
  let highest = lift;
  for (let tries = 0; tries < 5 && dry === null; tries++) {
    const tried = await moveTo(f, ground + lift);
    highest = lift;
    if (tried.under <= 0) dry = tried.asked; else { wet = tried.asked; lift *= 2; }
  }
  if (dry === null) {
    console.log(`   could not lift the eye clear of the surface, and the last `
      + `attempt put her ${highest.toFixed(1)} m above the bed. Either she cannot `
      + `hold that altitude or submerged() never falls to zero, and both are findings.`);
    return;
  }

  // NARROW IT. Seven halvings take a bracket of a few metres under the
  // centimetre the fix line can express, and the loop stops at two
  // centimetres because below that the rounding, not the search, is
  // deciding. STEP is larger than what is left, so the pair is on the
  // sides it claims to be on however the last halving lands.
  for (let step = 0; step < 7 && dry - wet > 0.02; step++) {
    const mid = await moveTo(f, (wet + dry) / 2);
    if (mid.under > 0) wet = mid.asked; else dry = mid.asked;
  }
  const edge = (wet + dry) / 2;
  // Her altitude when the EYE breaks the surface, which is not the depth
  // of the water: the camera rides above her, so it surfaces while she
  // is still under. Printed as what it is so nobody reads it as a depth.
  console.log(`   eye surfaces with her at ${edge.toFixed(2)}m, `
    + `${(edge - ground).toFixed(2)} m above the bed`);

  const up = await moveTo(f, edge + STEP);
  const above = await shoot(`${tag}-above`, up.asked);
  const down = await moveTo(f, edge - STEP);
  const below = await shoot(`${tag}-below`, down.asked);

  if (above.under > 0) {
    console.log('   the ABOVE frame is under the surface. The pair is not a pair.');
  }
  if (below.under <= 0) {
    console.log('   the BELOW frame is dry. The pair is not a pair.');
  }
  compare(above, below);
}

// The three spots the depths were measured at, under the names the flow
// probe already gives them, so these frames file next to those ones.
await dunk(1039062, 371875, 'stream-eye',
  'a mid-sized stream, 0.71 m deep');
await dunk(1252344, -426562, 'wide-median',
  'a wide valley floor, ground 305.84 m under a surface at 307.10 m, 1.26 m deep');
await dunk(142188, -1815625, 'fold-eye',
  'a broad lowland reach, 1.37 m deep');

console.log(errs.length ? '\nERRORS:\n  ' + errs.slice(0, 5).join('\n  ') : '\nno page errors');
await b.close();
