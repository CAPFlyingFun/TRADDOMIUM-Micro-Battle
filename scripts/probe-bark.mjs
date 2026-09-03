/**
 * IS THE WOOD SOLID, AND DOES IT LOOK LIKE BARK — landmark trees on
 * the bare URL, on foot, through the front door.
 *
 *   npm run probe:bark
 *
 * Two questions no unit test can answer:
 *
 *  1. THE PICTURE. `trunkSolid` builds its profile from the same
 *     skeleton `treeMesh` skins, so the wood she cannot pass through
 *     is the wood on screen — but only a rendered frame shows whether
 *     the bark tiles at a sane size and whether the normal map lights
 *     the ridges as ridges rather than as grooves.
 *  2. THE WALL. She is walked STRAIGHT AT a trunk with the real
 *     control, for real seconds, and her distance from the trunk's
 *     axis is read every step. Passing means she stops at the bark:
 *     the surface radius AT HER HEIGHT plus her own body, and no
 *     nearer, however long she keeps pushing.
 *
 * SHE IS NEVER SET INSIDE A TRUNK, and that is not squeamishness. The
 * obvious test — stand her on the axis, watch one frame eject her —
 * fills the viewport with a metre of bark half a centimetre from the
 * near plane, and a software renderer takes the better part of ten
 * seconds over that frame. The first version of this probe measured
 * the stall and reported the collision broken. Walk her in from
 * outside instead; the camera keeps its distance and the frames keep
 * coming.
 *
 * Nothing is placed. The tree is the island's own.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const SPOT = process.env.SPOT ?? 'wailua-forest';
/** PlayerAnt.BODY_RADIUS — what she asks the wood to keep clear. */
const BODY = 18;
/** An absurd body, used only to read the geometry back out. */
const PROBE_BODY = 400;
/** Camera elevation for the portrait, degrees. Up is positive. */
const PITCH = 22;
/** How far outside the bark she starts. */
const RUN_UP = 15;
/** Wall-clock ceiling for the walk. A frame here is most of a second. */
const PATIENCE = 600_000;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=${process.env.SPAWN_ROLL ?? '0.25'}`,
  { waitUntil: 'domcontentloaded' });

await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const pick = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const region = await page.evaluate((id) => window.__regions.find((r) => r.id === id), SPOT);
if (!region) throw new Error(`no spawn region ${SPOT}`);
await page.mouse.click(pick.left + region.mapX * pick.size, pick.top + region.mapY * pick.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.vegReady(), null, { timeout: 60000 });
await page.waitForTimeout(1200);

console.log(`STAND ${JSON.stringify(await page.evaluate(() => window.__island.landmarks()))}`);

const near = await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  return window.__island.trees(6_000)
    .map((t) => ({ ...t, d: Math.hypot(t.wx - wx, t.wz - wz) }))
    .sort((a, b) => a.d - b.d);
});
console.log(`TREES within 60 m: ${near.length}`);
if (near.length === 0) {
  console.log('NO TREES NEAR THE SPAWN — nothing to walk into here');
  await browser.close();
  process.exit(1);
}
const tree = near[0];
console.log(`TARGET ${tree.id} — ${(tree.height / 100).toFixed(1)} m tall,`
  + ` foot radius ${tree.trunk.toFixed(1)} cm, ${(tree.d / 100).toFixed(1)} m away`);

// STAND HER OFF ITS EAST SIDE, FACING IT, a run-up outside the bark.
// The solid is only kept for the trunks near her, and it is refilled
// as the stand follows — so the walk is what fills it, not the
// teleport, and the first frames are honestly empty.
//
// THE RUN-UP IS MEASURED, NOT ASSUMED. The foot radius is the widest
// the tree ever is; where she actually stands it has tapered and
// leaned away, and starting from the foot radius left her a third of
// a metre of walking to do at ant pace — minutes of wall clock per
// centimetre here. So: stand her roughly, ask the solid how wide the
// trunk is AT HER HEIGHT, then stand her properly.
const put = (off) => page.evaluate(([t, o]) => {
  // Heading 0 is +wz (south), so a bearing of atan2(dx, dz) with
  // dx = -o and dz = 0 turns her back along -wx, at the trunk.
  window.__island.putAt(t.wx + o, t.wz, Math.atan2(-o, 0));
  window.__island.setPace('run');
}, [tree, off]);

await put(tree.trunk + BODY + RUN_UP);
// The solid is only kept for the trunks near her and is re-centred by
// the stand as she moves, so the teleport does not fill it — a FRAME
// does, and a frame here is worth most of a second. Wait on the fact
// rather than on a clock: a fixed pause bought two frames on one run
// and none on the next, and reported the collision missing.
await page.waitForFunction(() => {
  const [wx, y, wz] = window.__island.where();
  return window.__island.trunkAt(wx, y, wz, 400) !== null;
}, null, { timeout: 120000 });
const reach = await page.evaluate(() => {
  const [wx, y, wz] = window.__island.where();
  return window.__island.trunkAt(wx, y, wz, 400);
});
const standoff = reach.surface + BODY + RUN_UP;
console.log(`SURFACE at her height ${reach.surface.toFixed(1)} cm`
  + ` (foot radius ${tree.trunk.toFixed(1)} — it tapers and leans)`);
await put(standoff);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'probe-bark-approach.png' });
console.log(`WROTE probe-bark-approach.png — stood ${standoff.toFixed(0)} cm out`);

// WALK INTO IT. W is the stick's own forward, read through the same
// MoveStick.read() a thumb goes through, and it is camera-relative —
// the camera was snapped behind her by putAt, so forward is at the tree.
await page.keyboard.down('KeyW');

const started = await page.evaluate(() => window.__island.simTime());
const clock = Date.now();
let closest = Infinity;
let deepest = 0;
const trail = [];
let last = null;
for (let i = 0; i < 400; i++) {
  await page.waitForTimeout(1000);
  const seen = await page.evaluate((fat) => {
    const [wx, y, wz] = window.__island.where();
    return {
      wx, y, wz, t: window.__island.simTime(),
      // Her own body's question, which should always come back null:
      // after settle she is out.
      bump: window.__island.trunkAt(wx, y, wz, 18),
      // And the same question asked with an absurd body, purely to
      // read back the geometry: `depth` is `surface + radius - len`,
      // so this recovers BOTH the trunk's radius at her height and her
      // distance from its AXIS at her height. Distance to the tree's
      // foot is the wrong measure — the trunk leans off its own centre
      // line by more than its own width over twenty-two metres, so the
      // bark is not a fixed distance from the foot at all.
      probe: window.__island.trunkAt(wx, y, wz, fat),
    };
  }, PROBE_BODY);
  const gap = seen.probe === null ? Infinity
    : seen.probe.surface + PROBE_BODY - seen.probe.depth;
  closest = Math.min(closest, gap);
  // After settle she should be OUT: any depth left here is a push that
  // did not clear, which is the failure that leaves her in the bark.
  if (seen.bump) deepest = Math.max(deepest, seen.bump.depth);
  // ONE ENTRY PER FRAME, not per poll. A frame here costs most of a
  // second, so several polls read the same unchanged frame — and a
  // "she has stopped" test counted over polls calls a slow renderer a
  // wall. Distinct sim times are the only samples that mean anything.
  const stamp = +seen.t.toFixed(3);
  if (trail.length === 0 || stamp !== trail[trail.length - 1].t) {
    trail.push({ t: stamp, gap: +gap.toFixed(2), r: +seen.probe.surface.toFixed(1) });
  }
  // Stopped: three FRAMES in a row inside a tenth of a millimetre with
  // the stick still held down. That is the wall.
  const stuck = trail.length > 3
    && trail.slice(-3).every((s) => Math.abs(s.gap - trail[trail.length - 1].gap) < 0.1)
    && seen.t > started + 1;
  last = seen;
  if (stuck || seen.t - started > 20 || Date.now() - clock > PATIENCE) break;
}
await page.keyboard.up('KeyW');

// THE SURFACE AT HER HEIGHT, read by asking with a body a little
// fatter than hers: the answer's `surface` is the trunk's own radius
// at the height she is standing, which is NOT the foot radius — the
// trunk tapers and leans, and that is the whole reason the solid is
// built from the skeleton rather than from a cone.
const skin = await page.evaluate((r) => {
  const [wx, y, wz] = window.__island.where();
  return window.__island.trunkAt(wx, y, wz, r);
}, PROBE_BODY);
const gap = skin === null ? Infinity : skin.surface + PROBE_BODY - skin.depth;
const wall = skin === null ? null : skin.surface + BODY;

console.log(`\nWALKED ${(last.t - started).toFixed(1)} s of game time`
  + ` in ${((Date.now() - clock) / 1000).toFixed(0)} s of wall clock`);
console.log(`distance from the AXIS AT HER HEIGHT:`
  + ` ${trail[0].gap} cm → ${gap.toFixed(2)} cm`);
console.log(`surface at her height ${skin === null ? 'not reached' : skin.surface.toFixed(1) + ' cm'}`
  + ` + body ${BODY} = ${wall === null ? '?' : wall.toFixed(1)} cm, where she should stand`);
// TWO CONVENTIONS, AND THE DIFFERENCE IS HER OWN BODY.
//
// The collision keeps a FLYING queen's centre BODY_RADIUS clear of the
// wood. A WALKER stands ON a surface, origin and all, exactly as she
// stands on the ground — so once she takes hold her centre is at the
// bark and this reads about -18, her own radius. That is her standing
// on the tree, not her inside it, and the same number would have been
// a real fault before climbing existed. Reported as the gap to the
// BARK rather than as an overshoot, so it cannot be misread.
const standing = wall === null ? null : gap - (wall - BODY);
console.log(`her centre is ${standing === null ? '?' : standing.toFixed(2)} cm`
  + ` from the bark — 0 is standing on it, ${BODY} is held off it by her body`);
console.log(`deepest push the collision still wanted: ${deepest.toFixed(3)} cm`
  + ` (expected to equal her body radius once she is holding on)`);
// SHE NO LONGER STOPS DEAD, AND THAT IS THE POINT.
//
// Before climbing existed this leg ended at a wall: she closed to the
// surface radius plus her body and went no further. She now TAKES HOLD
// at that same distance instead — the collision and the grip are one
// fact about a trunk, and on foot the grip wins. So the walk passes if
// she got to the bark and is holding it; the wall is still what a
// FLYING queen meets, which is where it was always doing the work.
const grabbed = await page.evaluate(() => window.__island.climbing());
const reached = wall !== null && gap < wall + 6;
console.log(`reached the bark: ${reached} · holding it: ${grabbed.on}`);
console.log(`SOLID: ${reached && grabbed.on ? 'yes — she reached the bark and took hold' : 'NO'}`);
const solid = reached && grabbed.on;
console.log(`TRAIL ${JSON.stringify(trail)}`);

await page.screenshot({ path: 'probe-bark-contact.png' });
console.log('WROTE probe-bark-contact.png');

// ── AND NOW SHE CLIMBS IT ────────────────────────────────────────
// She is against the bark with the stick still available. Keep
// pushing: the surface under her rolls her up onto the trunk, and the
// SAME forward push that walked her into it now walks her up it.
await page.keyboard.down('KeyW');
const climbStart = await page.evaluate(() => window.__island.simTime());
const climbClock = Date.now();
let best = null;
const rise = [];
for (let i = 0; i < 400; i++) {
  await page.waitForTimeout(1000);
  const now = await page.evaluate(() => ({
    t: window.__island.simTime(), ...window.__island.climbing(),
  }));
  const stamp = +now.t.toFixed(3);
  if (rise.length === 0 || stamp !== rise[rise.length - 1].t) {
    rise.push({
      t: stamp, up: +now.up[1].toFixed(3),
      agl: +(now.height - now.ground).toFixed(1), on: now.on,
    });
  }
  best = now;
  if (now.t - climbStart > 25 || Date.now() - climbClock > PATIENCE) break;
}
await page.keyboard.up('KeyW');

const climbed = best.height - best.ground;
console.log(`\nCLIMB: ${(best.t - climbStart).toFixed(1)} s of game time`);
console.log(`holding wood: ${best.on}`);
console.log(`her up: [${best.up.map((v) => v.toFixed(3)).join(', ')}]`
  + ` — y of 1 is flat ground, 0 is a vertical trunk`);
console.log(`height above the ground under her: ${climbed.toFixed(1)} cm`);
console.log(`CLIMBED: ${best.on && climbed > 20 ? 'yes' : 'NO'}`);
console.log(`RISE ${JSON.stringify(rise)}`);
await page.screenshot({ path: 'probe-bark-climb.png' });
console.log('WROTE probe-bark-climb.png');

// AND A PORTRAIT. Pressed against the bark she is inside the tree's
// own silhouette and the frame is one texel of it; the bark can only
// be judged — tiling size, whether the normal map lights the ridges
// as ridges — from far enough back to see a trunk.
await put(800);
await page.waitForTimeout(4000);
// AND LOOK UP. The resting camera sits twenty degrees down, which is
// the right place for an ant and puts a twenty-metre tree entirely
// above the frame. `goTo` is the door: a fix carries the camera's
// pitch, so re-issuing her own fix with the elevation raised aims the
// camera without moving her.
const aimed = (await page.evaluate(() => window.__island.fix()))
  .replace(/-?\d+(\.\d+)?°/, `${PITCH.toFixed(1)}°`);
await page.evaluate((f) => window.__island.goTo(f), aimed);
await page.waitForTimeout(4000);
await page.screenshot({ path: 'probe-bark-portrait.png' });
console.log(`WROTE probe-bark-portrait.png — camera aimed with ${aimed}`);
if (errors.length) console.log(`PAGE ERRORS ${JSON.stringify(errors)}`);
await browser.close();
process.exit(solid ? 0 : 1);
