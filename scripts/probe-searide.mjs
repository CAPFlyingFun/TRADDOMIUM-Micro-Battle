/**
 * THE TWO SEA FAULTS JOSHUA PHOTOGRAPHED, measured on the real build.
 *
 * TASK 1 — THE LENS UNDER THE WAVE. The scene already measures exactly
 * the symptom: `column().camUnder` is how far the camera is below the
 * live water surface, and it is what drives the underwater look. So the
 * acceptance is not a screenshot argument — it is that camUnder stays
 * at zero for every frame of a long float, while the swell rolls
 * through and the camera's vertical damping is active. The old build
 * clamped the lens to a FLAT sea level, so a crest standing proud of
 * zero simply rose through it.
 *
 * TASK 2 — THE SEA THAT DID NOT CARRY HER. The salt query answered a
 * zero current, so a floating queen stayed exactly where she was put.
 * The acceptance is that she MOVES, that the movement is the water and
 * not her paddling (the stick is never touched here), and that over
 * whole wave cycles the net is toward the land — measured as the ground
 * under her getting shallower.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
// SMALL ON PURPOSE. SwiftShader renders this scene at about one and a
// half frames a second even at this size, and every sample costs a
// frame — the picture is not what is being measured here, the numbers
// are.
const page = await browser.newPage({ viewport: { width: 420, height: 220 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(9000);

const LAT = 22.20069511;
/** Offshore, in the surf — the same water the foam probe measured. */
const LON = -159.506429;

// Put her ON the sea, not above it. MSL 0.30 m leaves her AIRBORNE
// over the water — the first cut of this probe measured a queen who
// was still flying and reported that she never floated. Five
// centimetres is on the film.
await page.evaluate((f) => window.__island.goTo(f),
  `${LAT.toFixed(8)} ${LON.toFixed(8)} 0.05m 143.0° -21.8° ×1.00`);
await page.waitForTimeout(14000);

/** Sample the column every frame for a while, hands off the stick. */
async function ride(seconds) {
  return page.evaluate((s) => new Promise((done) => {
    const rows = [];
    const start = performance.now();
    const tick = () => {
      const c = window.__island.column();
      const at = window.__island.lod().anchor;
      rows.push({
        camUnder: c.camUnder, afloat: c.afloat, dive: c.dive,
        ground: c.ground, depth: c.depth,
        wx: at.wx, wz: at.wz,
      });
      if (performance.now() - start < s * 1000) requestAnimationFrame(tick);
      else done(rows);
    };
    requestAnimationFrame(tick);
  }), seconds);
}

const rows = await ride(90);
const afloat = rows.filter((r) => r.afloat);
const dived = afloat.filter((r) => r.dive > 0.15).length;
const wet = afloat.map((r) => r.camUnder);
const worstUnder = wet.length ? Math.max(...wet) : 0;
const framesUnder = wet.filter((v) => v > 0).length;

console.log(`\nfloating frames: ${afloat.length} of ${rows.length}`
  + `   (frames with the dive lever down: ${dived})`);
console.log('\nTASK 1 — the lens against the live surface');
console.log(`  worst camUnder while afloat: ${worstUnder.toFixed(3)} units`);
console.log(`  frames with the lens under water: ${framesUnder}`);
console.log(framesUnder === 0
  ? '  PASS  the camera never crossed the surface while she floated'
  : `  FAIL  the lens went under on ${framesUnder} frames, worst ${worstUnder.toFixed(2)}`);

console.log('\nTASK 2 — the sea carrying her');
if (afloat.length > 12) {
  const first = afloat[0];
  const last = afloat[afloat.length - 1];
  const moved = Math.hypot(last.wx - first.wx, last.wz - first.wz);
  const xs = afloat.map((r) => r.wx);
  const zs = afloat.map((r) => r.wz);
  const sway = Math.hypot(Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs));
  const shallower = last.ground - first.ground;
  console.log(`  she moved ${moved.toFixed(0)} units net`
    + ` (${(moved / 100).toFixed(2)} m), swaying over ${sway.toFixed(0)} units`);
  console.log(`  the bed under her rose ${shallower.toFixed(0)} units`
    + `  (${first.ground.toFixed(0)} -> ${last.ground.toFixed(0)})`);
  // WHAT THIS CAN AND CANNOT SETTLE. That she is carried at all is
  // the fault being fixed and is plainly measurable here. The
  // DIRECTION of the net is not: at a frame and a half a second the
  // swell advances 168 degrees a step, so the sampled flow is aliased
  // into noise and the sign of a net drift measured this way means
  // nothing. tests/surf.test.ts integrates the same water at 60, 30
  // and 16 Hz on the real island and asserts the shoreward net; the
  // phone runs at about sixteen.
  console.log(`  net direction here: ${shallower > 0 ? 'shoreward' : 'seaward'}`
    + '  (INFORMATIONAL — this frame rate cannot resolve it; see'
    + ' tests/surf.test.ts)');
  console.log(moved > 20
    ? '  PASS  the ocean moves her — the zero current is gone'
    : `  FAIL  she is still not being carried (${moved.toFixed(0)} units)`);
} else {
  console.log('  FAIL  she never floated — check the fix');
}

console.log('\nNOTE  this renderer runs at about 1.5 frames a second, so the'
  + ' simulation steps in half-wave lumps here. Directions and'
  + ' magnitudes are meaningful; anything timing-shaped belongs to'
  + ' tests/surf.test.ts and tests/cameraWater.test.ts, which run at 60 Hz.');
console.log('\npageerrors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
