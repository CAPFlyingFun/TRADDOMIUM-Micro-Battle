/**
 * UNDERWATER IS A LOOK, AND THIS FILE HOLDS THE ARITHMETIC UNDER IT.
 *
 * The complaint was that underwater looked like above ground, and at
 * this scale that is not a small miss. One world unit is a centimetre
 * and the queen is about one unit long; the water she can reach runs a
 * median of 0.30 m deep and often over a metre, so standing NEXT TO a
 * stream is almost always standing INSIDE it. Three probe frames shot
 * from her own eye height came back looking like dry sand:
 *
 *   wide-median   1.26 m of water, camera 9 cm off the bed   1.17 m under
 *   stream-eye    0.71 m,          camera 22 cm off          0.49 m under
 *   fold-eye      1.37 m,          camera 18 cm off          1.19 m under
 *
 * Toggling the water layer off moved 83-85% of the pixels in those
 * frames, so the water was drawn the whole time and covered nearly the
 * whole view. It simply looked like air: a surface was drawn and
 * nothing else, no attenuation, no tint, no loss of sight, so from
 * underneath the sunlit bed showed through in full.
 *
 * WHAT IS TESTED HERE is the part that can be tested without a
 * renderer: where the water surface stands, how far under it the camera
 * is, and what the frame should look like at that depth. Those are pure
 * functions and the whole feature hangs off them. `Underwater` itself
 * is a three.js object, but it turns out to need no GL — a bare Scene,
 * a PerspectiveCamera and two lights are enough to drive `update()` —
 * and the last block does exactly that, because THE FLOATING ORIGIN
 * BUG lives in the class and nowhere else. Nothing here touches
 * swimming, wading, buoyancy or breath; this pass owns the look only,
 * and a later one owes it the same `waterLevelAt()`.
 *
 * TWO PLACES ON THE ISLAND DO THE WORK, both found by walking the
 * shipped bake rather than written down, so a re-bake moves them
 * instead of breaking the file. A HIGH station, a kilometre up, where
 * only the stream can answer; and a COASTAL station, measured today at
 * 30 raw units of surface over a bed of 0, where the stream and the sea
 * are both in play within a third of a metre of each other. The lowest
 * water surface anywhere in the shipped bake is that 30 — fresh water
 * drains into the sea, so on this island the sea never out-stands a
 * stream, and the other side of that `max` is exercised on a hand-built
 * flow further down because a rule with one side tested is half a rule.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeFlow, forgetFlow, useFlow, waterLevelAt, type Flow,
} from '../src/world/flow';
import { reliefScale, setRelief } from '../src/world/heightfield';
import { originAt, setOrigin } from '../src/world/origin';
import { FOG_TAIL } from '../src/weather/sky';
import {
  submersion, surfaceAt, Underwater, underwaterLook, type Look,
} from '../src/world/Underwater';

const ASSET = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));

/**
 * The scene's air, copied from IslandScene rather than imported — that
 * module builds a renderer on the way in and cannot be loaded here.
 * SKY_COLOR and the nominal FogExp2 density; the sun and skylight
 * intensities are weather/sky.ts's clear-day pair, which is what
 * applyWeather() will have stamped on the frame immediately before the
 * override runs.
 */
const SKY = 0x9cc8e8;
const AIR = 0.0000075;
const SUN_CLEAR = 2.3;
const AMBIENT_CLEAR = 0.85;

/**
 * The three submersions the probe caught, in world units, which are
 * centimetres. These are not decoration: every bound on the ramp below
 * is asserted AT one of them, because a look that only arrives deeper
 * than this is a look that never arrives.
 */
const SHALLOW_FRAME = 49;
const DEEP_FRAME = 119;

/**
 * A kilometre off the south coast, the same point flow.test.ts uses to
 * check the level field does not claim the open ocean. waterLevelAt()
 * answers null here; the sea does not.
 */
const OCEAN_X = 0;
const OCEAN_Z = 2_700_000;

/** Rec. 709 luminance, for asking whether a colour got darker. */
function luma(look: Look): number {
  return 0.2126 * look.r + 0.7152 * look.g + 0.0722 * look.b;
}

/** Raw units at relief 1 to the units the camera actually lives in. */
function drawn(raw: number): number {
  return raw * reliefScale();
}

let flow: Flow;
/** High in the mountains: stream only, and a long way above the sea. */
let deep: { x: number; z: number; raw: number };
/** At the coast: stream and sea both within a third of a metre. */
let coast: { x: number; z: number; raw: number };

beforeAll(() => {
  const file = readFileSync(ASSET);
  flow = decodeFlow(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  useFlow(flow);

  // The first mid-reach station standing more than 500 m up. Asked of
  // waterLevelAt() rather than read out of flow.level, because at 7 of
  // 121 sampled centrelines a neighbouring reach claims the point and
  // stands higher — the index's answer is the one the game reads, so it
  // is the one the test must be built on.
  for (let r = 0; r < flow.reaches.length; r++) {
    const reach = flow.reaches[r];
    if (reach.count < 3) continue;
    const p = reach.first + (reach.count >> 1);
    const raw = waterLevelAt(flow.x[p], flow.z[p]);
    if (raw === null || raw < 50_000) continue;
    deep = { x: flow.x[p], z: flow.z[p], raw };
    break;
  }

  // And the other end of the island: a station whose water stands
  // within a metre of sea level. 35 of the 74,962 do. The bounds keep
  // it honestly coastal — above the sea, so the stream is the higher
  // surface, but close enough that an implementation which reached for
  // the sea instead would still be looking at plausible water.
  for (let p = 0; p < flow.level.length; p++) {
    if (flow.level[p] > 100) continue;
    const raw = waterLevelAt(flow.x[p], flow.z[p]);
    // STRICTLY under a metre, matching the guard below exactly. These
    // two read `> 100` and `< 100` for a long time, which let the
    // search accept a station the guard would reject; nothing failed
    // until a re-bake put one at exactly 100 and the fixture and its
    // own check disagreed about whether it counted.
    if (raw === null || raw <= 10 || raw >= 100) continue;
    coast = { x: flow.x[p], z: flow.z[p], raw };
    break;
  }
});

afterAll(() => {
  forgetFlow();
  setRelief(1);
  setOrigin(0, 0);
});

// The dial and the origin are module state in someone else's file. A
// test that fails partway through must not hand the next one a flattened
// island or an origin two million units away.
afterEach(() => {
  setRelief(1);
  setOrigin(0, 0);
});

describe('the island the tests stand on', () => {
  it('found both the places the rest of this file needs', () => {
    // Not a test of the source. It is the guard that stops a re-bake
    // turning every assertion below into a comparison against
    // undefined, which reads as a mystery rather than as "the bake
    // moved".
    expect(deep).toBeDefined();
    expect(deep.raw).toBeGreaterThan(50_000);
    expect(coast).toBeDefined();
    // Above the sea by more than a tenth of a metre and less than one
    // metre: both surfaces genuinely in play, and the stream the higher
    // of the two.
    expect(coast.raw).toBeGreaterThan(10);
    expect(coast.raw).toBeLessThan(100);
  });
});

describe('submersion, the one number the frame turns on', () => {
  it('is zero in air, positive under water, and grows exactly as she sinks', () => {
    // OWNS: the sign, the zero, and the slope. A depth that came back
    // scaled, squared, or measured from the BED rather than from the
    // surface passes none of the three, and the last of them is the one
    // that would otherwise look right in a screenshot: at 40 units under
    // it must read 40, not 40 times something.
    const top = drawn(deep.raw);
    expect(submersion(deep.x, top + 1_000, deep.z)).toBe(0);
    expect(submersion(deep.x, top + 1, deep.z)).toBe(0);
    // Exactly at the waterline is not under it. She is standing on a
    // stone with her eye level with the surface; the frame stays air.
    expect(submersion(deep.x, top, deep.z)).toBe(0);
    for (const under of [0.5, 1, 5, 20, 40, 100, 500]) {
      expect(submersion(deep.x, top - under, deep.z)).toBeCloseTo(under, 6);
    }
    // And the same statement as a difference, which is what catches a
    // depth that is right at one height and wrong at another: one
    // centimetre of descent is one centimetre of submersion, everywhere.
    const a = submersion(deep.x, top - 12, deep.z);
    const b = submersion(deep.x, top - 13, deep.z);
    expect(b - a).toBeCloseTo(1, 6);
  });

  it('counts the sea, which the level field never answers for', () => {
    // OWNS THE OCEAN. waterLevelAt() returns null out here — the flow
    // index carries rivers and ponds, and the sea belongs to the sea —
    // so an implementation that forwards the level field's null as "dry"
    // leaves her flying through the ocean floor with a blue sky on
    // screen. The sea surface is y = 0 by definition and land is above
    // it, so below zero is under water and that is the whole rule.
    expect(waterLevelAt(OCEAN_X, OCEAN_Z)).toBeNull();
    expect(submersion(OCEAN_X, -50, OCEAN_Z)).toBeCloseTo(50, 6);
    expect(submersion(OCEAN_X, -2_000, OCEAN_Z)).toBeCloseTo(2_000, 6);
    // And the other side of it, which is the flight case: half a metre
    // above the waves is air, and so is the waterline itself.
    expect(submersion(OCEAN_X, 0, OCEAN_Z)).toBe(0);
    expect(submersion(OCEAN_X, 50, OCEAN_Z)).toBe(0);
    expect(submersion(OCEAN_X, 100_000, OCEAN_Z)).toBe(0);
    // Dry land, a kilometre up, nowhere near either surface. If the sea
    // were handled as "there is always water at y = 0" without the
    // comparison, this would be the assertion that never fires; it fires
    // because the comparison is what the sea contributes.
    expect(submersion(deep.x, drawn(deep.raw) + 100_000, deep.z)).toBe(0);
  });

  it('takes the higher surface where the stream and the sea both reach', () => {
    // OWNS THE MAX, on the real island, at the only kind of place it can
    // be seen: a coastal station whose water stands `coast.raw` units
    // over a sea at zero — thirty of them, a third of a metre, where
    // this was measured. Put her ten centimetres under it and she is still
    // ABOVE sea level, so an implementation that answers with the sea,
    // or with the lower of the two, calls this dry and paints her the
    // sky. The stream is the higher surface and the higher surface wins.
    const top = drawn(coast.raw);
    expect(surfaceAt(coast.x, coast.z)).toBeCloseTo(top, 6);
    expect(top).toBeGreaterThan(10);
    expect(submersion(coast.x, top - 10, coast.z)).toBeCloseTo(10, 6);
    // Same point, above the stream but still only centimetres over the
    // sea: dry. The pair of these is the discrimination — one number
    // cannot be explained by "always wet near the coast" and the other
    // cannot be explained by "the sea is all there is".
    expect(submersion(coast.x, top + 1, coast.z)).toBe(0);
    // Out over the ocean the level field has nothing, and surfaceAt
    // says so. Null and zero are the same statement to a camera — the
    // sea stands at zero either way — so this is deliberately the loose
    // half of the pair, and the submersion test above is the half that
    // discriminates.
    expect(surfaceAt(OCEAN_X, OCEAN_Z) ?? 0).toBe(0);
  });

  it('moves the surface when the relief dial moves, because she does not', () => {
    // THE TEST THIS FILE EXISTS FOR. Levels are stored at relief 1 and
    // the camera lives in drawn units, so the comparison is
    // level * reliefScale() against y. Forget the dial and the code is
    // exactly right at the default and wrong at every other setting —
    // and the slider runs 0.1 to 1.5, so most of its travel is the
    // wrong part. That fault cannot be seen at relief 1 by any
    // assertion, so this one is made at 0.45 and 1.5, both real
    // settings, and neither is 1.
    //
    // The camera is parked at seven tenths of the raw level and never
    // moves. At relief 1 the water is over her head; flatten the island
    // to 0.45 and the same stream is now well below her, on ground that
    // came down with it; exaggerate to 1.5 and she is deeper than she
    // has ever been. The VERDICT flips, not merely the magnitude, which
    // is what stops a wrong answer passing for a rounding difference.
    const eye = 0.7 * deep.raw;

    setRelief(1);
    expect(surfaceAt(deep.x, deep.z)).toBeCloseTo(deep.raw, 6);
    expect(submersion(deep.x, eye, deep.z)).toBeCloseTo(0.3 * deep.raw, 3);

    setRelief(0.45);
    expect(reliefScale()).toBe(0.45);
    expect(surfaceAt(deep.x, deep.z)).toBeCloseTo(0.45 * deep.raw, 3);
    expect(submersion(deep.x, eye, deep.z)).toBe(0);

    setRelief(1.5);
    expect(surfaceAt(deep.x, deep.z)).toBeCloseTo(1.5 * deep.raw, 3);
    expect(submersion(deep.x, eye, deep.z)).toBeCloseTo(0.8 * deep.raw, 3);
  });
});

describe('the sea under a drowned channel', () => {
  /**
   * The shipped island cannot show this. Its lowest water surface is 30
   * raw units — a third of a metre above the sea — because fresh water
   * runs downhill into salt, so every real station out-stands the sea
   * and `Math.max` always resolves the same way. That makes the cheap
   * implementation, "if the level field answered, use its answer",
   * indistinguishable from the correct one on every square centimetre
   * of Kauai, and it is a metre wrong the first time a bake writes a
   * level below zero. So the other side of the max is exercised on a
   * flow built by hand: two stations of channel five metres under the
   * sea, which decodeFlow would never produce and which nothing here
   * pretends is hydrology. It is the second half of a rule.
   */
  const drowned: Flow = {
    reaches: [{ first: 0, count: 2 }],
    x: Int32Array.from([100_000, 104_000]),
    z: Int32Array.from([100_000, 100_000]),
    level: Int32Array.from([-500, -500]),
    bed: Int32Array.from([-900, -900]),
    width: Uint16Array.from([800, 800]),
    left: Uint16Array.from([2_000, 2_000]),
    right: Uint16Array.from([2_000, 2_000]),
    pondX: Int32Array.from([]),
    pondZ: Int32Array.from([]),
    pondLevel: Int32Array.from([]),
    pondDepth: Uint16Array.from([]),
    threshold: 0.005,
  };

  beforeAll(() => { useFlow(drowned); });
  afterAll(() => { useFlow(flow); });

  it('stands at the sea, not at the channel five metres beneath it', () => {
    expect(waterLevelAt(102_000, 100_000)).toBe(-500);
    // A metre under the sea is a metre under water. Reach for the level
    // field's answer instead and this comes out NEGATIVE, clamps to
    // zero, and the frame goes clear a metre below the surface of the
    // ocean — the failure the higher-of-the-two rule exists to prevent.
    expect(submersion(102_000, -100, 100_000)).toBeCloseTo(100, 6);
    // And above the sea is still dry, channel or no channel.
    expect(submersion(102_000, 100, 100_000)).toBe(0);

    // A FLAGGED DIVERGENCE, left visible rather than frozen. The pinned
    // API had surfaceAt answering for the sea and the flow both,
    // whichever stands higher. The source as written answers for the
    // flow alone, returns null over the ocean, and takes the higher of
    // the two DEPTHS inside submersion() instead, with its reasons
    // written next to it. Those are the same number for every camera —
    // both depths are a surface minus the same y — so the two readings
    // cannot be told apart by anything that reaches a pixel, and the
    // assertions above are the ones that matter. This last line is
    // deliberately the loose one, true under either reading, so that
    // reconciling the signature stays a decision somebody makes rather
    // than a failure they route around.
    expect(Math.max(0, surfaceAt(102_000, 100_000) ?? 0)).toBe(0);
  });
});

describe('underwaterLook, the frame at a given depth', () => {
  /**
   * Depths in centimetres, from the waterline to absurdity. The three
   * probe submersions are in the middle of it on purpose; the tail is
   * there because a ramp written as `under / RAMP` with no clamp is
   * finite, monotonic, plausible on every screenshot she will ever
   * take, and hands three.js a fog density of six figures the moment
   * something puts the camera somewhere unexpected.
   */
  const LADDER = [
    0, 0.5, 1, 5, 10, 30, SHALLOW_FRAME, 71, 117, DEEP_FRAME, 126, 300,
    1_000, 100_000, 1e9, Number.MAX_SAFE_INTEGER,
  ];

  it('stays inside every legal range, at the waterline and at absurd depth', () => {
    // OWNS THE CLAMPS. r, g and b are three.js channels — weather's own
    // Rgb is written the same way, CLEAR_SKY being 0.612, 0.784, 0.910
    // for 0x9cc8e8 — so a look that came back in 0-255 blows this range
    // rather than blowing out to white on the device. The multipliers
    // are fractions of what the weather already set, so above 1 means
    // brighter underwater than in the open, and tint is an alpha.
    for (const under of LADDER) {
      const look = underwaterLook(under);
      for (const channel of [look.r, look.g, look.b]) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(Number.isFinite(look.density)).toBe(true);
      // Never CLEARER than the air it replaces: a ramp that starts at
      // zero rather than at the scene's own density makes the horizon
      // sharpen at the instant she goes under, which is the opposite of
      // the effect and reads as a flicker.
      expect(look.density).toBeGreaterThanOrEqual(AIR);
      expect(look.sun).toBeGreaterThanOrEqual(0);
      expect(look.sun).toBeLessThanOrEqual(1);
      expect(look.ambient).toBeGreaterThanOrEqual(0);
      expect(look.ambient).toBeLessThanOrEqual(1);
      expect(look.tint).toBeGreaterThanOrEqual(0);
      expect(look.tint).toBeLessThanOrEqual(1);
    }
  });

  it('only ever deepens: fog and tint up, sun and skylight down, colour darker', () => {
    // OWNS THE DIRECTION OF EVERY FIELD AT ONCE. A sign flipped on any
    // one of them is a look that gets brighter and clearer the deeper
    // she goes, which on a still screenshot is merely odd and in motion
    // is unreadable.
    for (let i = 1; i < LADDER.length; i++) {
      const was = underwaterLook(LADDER[i - 1]);
      const now = underwaterLook(LADDER[i]);
      const where = `${LADDER[i - 1]} -> ${LADDER[i]} units under`;
      expect(now.density, where).toBeGreaterThanOrEqual(was.density);
      expect(now.tint, where).toBeGreaterThanOrEqual(was.tint);
      expect(now.sun, where).toBeLessThanOrEqual(was.sun);
      expect(now.ambient, where).toBeLessThanOrEqual(was.ambient);
      expect(luma(now), where).toBeLessThanOrEqual(luma(was) + 1e-9);
    }
  });

  it('is nearly clear at the waterline and nearly done three metres down', () => {
    // OWNS THE SHAPE OF THE RAMP, at both ends, without pinning its
    // length — the constant belongs to the source, and a test that
    // restated it would only agree with whatever the source says.
    //
    // At the surface the multipliers must be nearly untouched, or she
    // wades in and the world dims before any water is over her.
    const skin = underwaterLook(0);
    expect(skin.sun).toBeGreaterThan(0.9);
    expect(skin.ambient).toBeGreaterThan(0.9);

    // A TENTH OF A MILLIMETRE UNDER IS STILL AIR. That is what having a
    // crossing at all means, and asking it right at the waterline is
    // the form of the question with room to spare in it: measured
    // against the source the fog here is 8.0e-6 against the air's
    // 7.5e-6, while a look that simply snapped on would be at 6.9e-3.
    // Three orders of magnitude apart, so no retune of how long the
    // crossing takes can make this fire by accident, and a switch
    // cannot slip past it.
    //
    // Asked HERE rather than as a ratio a centimetre down, which is
    // where it was first written and where it does not work: this
    // water's shallow look is by design already about half the fog of
    // its deep one, so at 1 cm a switch and a crossing come out 0.47
    // and 0.24 of the deep frame and no threshold between them is worth
    // trusting. The pane's alpha does separate them there — 0.33
    // against 0.17 — so that half of the pair is still asked as a ratio.
    expect(underwaterLook(0.01).density).toBeLessThan(100 * AIR);
    const cm = underwaterLook(1);
    const frame = underwaterLook(DEEP_FRAME);
    expect(cm.tint).toBeLessThan(0.25 * frame.tint);

    // And by three metres it has stopped arriving. Anything still
    // gaining strength past here is a ramp scaled for a diver rather
    // than for an animal in a stream a metre deep, and it is also how
    // an unclamped `under / RAMP` shows up: at three metres such a
    // density is a rounding error beside its own value at absurd depth.
    const far = underwaterLook(300);
    const limit = underwaterLook(1e6);
    expect(far.density).toBeGreaterThanOrEqual(0.7 * limit.density);
    expect(far.tint).toBeGreaterThanOrEqual(0.7 * limit.tint);
  });

  it('has cut the sight and dimmed the sun by the depths the probe caught', () => {
    // OWNS THE COMPLAINT ITSELF, asserted at the submersions that
    // produced the frames Joshua was shown: 0.49 m and 1.19 m.
    //
    // FogExp2 leaves exp(-(d*rho)^2) of a surface showing, and this
    // project's own convention takes visibility at 5% contrast, so
    // rho = FOG_TAIL / sight. The air the scene ships with is
    // 0.0000075, which is 2.3 km of sight — as it should be, since a
    // five-millimetre animal navigates by a coastline it can see. Under
    // water that has to collapse. Thirty metres is the loosest number
    // that still means anything at her scale: three thousand body
    // lengths, and generous by any reading of a silty Kauai stream. A
    // hundred metres at the shallow frame, for the same reason one step
    // earlier.
    const shallow = underwaterLook(SHALLOW_FRAME);
    const frame = underwaterLook(DEEP_FRAME);
    expect(shallow.density).toBeGreaterThanOrEqual(FOG_TAIL / 10_000);
    expect(frame.density).toBeGreaterThanOrEqual(FOG_TAIL / 3_000);

    // The sunlight has to come off too. The bed showing in full sun
    // through no water at all was half of what made those frames read
    // as sand, and a fog that only recolours the distance leaves the
    // ground under her eye exactly as bright as it was.
    expect(frame.sun).toBeLessThanOrEqual(0.7);

    // The pane has to be carrying real alpha at this depth. Fog cannot
    // touch what is a centimetre from her eye, and at a metre down that
    // near ground is most of the frame — 83 to 85% of the pixels
    // changed when the water layer was toggled, and those are the
    // pixels the pane owns.
    expect(frame.tint).toBeGreaterThanOrEqual(0.15);
  });

  it('goes to water rather than to mud, and takes the colour down with the depth', () => {
    // OWNS THE COLOUR. Blue over red is what the shipped water surface
    // already is — FlowWater's slabs are 0x1d4a5c, so 0.114, 0.290,
    // 0.361 — and it is also the cheap catch for a look assembled by
    // pulling bytes out of a hex constant in the wrong order, which
    // produces a perfectly plausible brown that nothing else here would
    // notice.
    const frame = underwaterLook(DEEP_FRAME);
    expect(frame.b).toBeGreaterThan(frame.r);
    // Still a colour, never black — the same rule STORM_SKY keeps.
    expect(Math.max(frame.r, frame.g, frame.b)).toBeGreaterThan(0.02);

    // And the colour must carry depth, not just the alpha in front of
    // it. A fixed pane colour with a rising alpha makes ten centimetres
    // and a metre the same shade of the same blue; the monotonicity
    // test above is satisfied by that, and this is not.
    expect(luma(underwaterLook(300))).toBeLessThan(luma(underwaterLook(1)));
  });
});

describe('Underwater, driven with a bare scene and no renderer', () => {
  /**
   * No GL here, and none needed: Scene, PerspectiveCamera, FogExp2 and
   * the two lights are plain objects, and `update()` only reads a
   * position and writes numbers. What that buys is the one fault the
   * pure functions cannot be asked about — THE FLOATING ORIGIN. The
   * camera's x and z are rendered coordinates and its y is absolute, so
   * the world point under her is (position.x + originAt().x,
   * position.z + originAt().z) at position.y unchanged. Get it wrong
   * and the water gets sampled somewhere near the middle of the island,
   * which on any given frame looks entirely plausible.
   */
  function rig() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.FogExp2(SKY, AIR);
    // The camera is deliberately NOT added to the scene, because in the
    // game it never is — FollowCamera builds it and holds it. Anything
    // the look hangs in front of the lens has to reach the frame
    // without being a child of the camera, and a rig that quietly
    // parented one would hide exactly that.
    const camera = new THREE.PerspectiveCamera(60, 932 / 430, 0.05, 5_600_000);
    const sun = new THREE.DirectionalLight(0xffffff, SUN_CLEAR);
    const skyLight = new THREE.HemisphereLight(SKY, 0x5a4a38, AMBIENT_CLEAR);
    scene.add(sun, skyLight);
    return { scene, camera, sun, skyLight, under: new Underwater(scene, camera) };
  }

  /**
   * Every visible transparent surface the renderer would find by
   * walking the scene. `tint` is pinned as the alpha of a near pane, so
   * something has to be carrying it; asked this way rather than by
   * reaching for a named field, because which object it is and where it
   * hangs belongs to the source.
   */
  function panes(scene: THREE.Scene): THREE.Material[] {
    const found: THREE.Material[] = [];
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const material = mesh.material;
      if (!Array.isArray(material) && material.transparent) found.push(material);
    });
    return found;
  }

  /** Put the camera at a WORLD point, the way the follow camera does. */
  function place(camera: THREE.Camera, wx: number, y: number, wz: number): void {
    const origin = originAt();
    camera.position.set(wx - origin.x, y, wz - origin.z);
  }

  /** What applyWeather() leaves on the scene, restamped before a call. */
  function weatherFrame(
    scene: THREE.Scene, sun: THREE.DirectionalLight, skyLight: THREE.HemisphereLight,
  ): void {
    const fog = scene.fog as THREE.FogExp2;
    fog.color.setHex(SKY);
    fog.density = AIR;
    sun.intensity = SUN_CLEAR;
    skyLight.intensity = AMBIENT_CLEAR;
  }

  it('leaves the weather exactly as it found it when she is dry', () => {
    // OWNS THE OFF STATE, and the off state is the whole reason there
    // is no restore branch in the source: applyWeather() runs first on
    // every single frame, so surfacing is undone by the next frame's
    // weather rather than by anything here. That only holds if a dry
    // update writes NOTHING. One that stamps a clear-water look every
    // frame would leave the air very slightly wrong forever, and it
    // would look like a weather bug.
    const { scene, camera, sun, skyLight, under } = rig();
    const fog = scene.fog as THREE.FogExp2;
    setOrigin(OCEAN_X, OCEAN_Z);

    // Half a metre over the waves, which is where she flies.
    place(camera, OCEAN_X, 50, OCEAN_Z);
    expect(under.update(sun, skyLight)).toBe(0);
    expect(fog.density).toBe(AIR);
    expect(fog.color.getHex()).toBe(SKY);
    expect(sun.intensity).toBe(SUN_CLEAR);
    expect(skyLight.intensity).toBe(AMBIENT_CLEAR);

    // And one centimetre above the stream a kilometre up, which is the
    // knife edge the whole feature turns on: her own body height over
    // the surface is still air.
    setOrigin(deep.x, deep.z);
    place(camera, deep.x, drawn(deep.raw) + 1, deep.z);
    expect(under.update(sun, skyLight)).toBe(0);
    expect(fog.density).toBe(AIR);
    expect(sun.intensity).toBe(SUN_CLEAR);
    expect(panes(scene)).toHaveLength(0);

    // NOW THE CROSSING, which is the version of this that can actually
    // break. Go under, let the look land, restamp the weather the way
    // applyWeather() does at the top of the next frame, and surface.
    // The pane has to go away with her, and the weather it was drawn
    // over has to be left alone. A dry frame that quietly writes a
    // cleared-out look would leave the air very slightly wrong for as
    // long as she stayed out of the water, and it would read as a
    // weather bug rather than as a water one.
    place(camera, deep.x, drawn(deep.raw) - 40, deep.z);
    expect(under.update(sun, skyLight)).toBeCloseTo(40, 6);
    expect(panes(scene).length).toBeGreaterThan(0);

    weatherFrame(scene, sun, skyLight);
    place(camera, deep.x, drawn(deep.raw) + 1, deep.z);
    expect(under.update(sun, skyLight)).toBe(0);
    expect(panes(scene)).toHaveLength(0);
    expect(fog.density).toBe(AIR);
    expect(fog.color.getHex()).toBe(SKY);
    expect(sun.intensity).toBe(SUN_CLEAR);
    expect(skyLight.intensity).toBe(AMBIENT_CLEAR);

    under.dispose();
  });

  it('thickens the fog and dims the lights by the look, once she is under', () => {
    // OWNS THE WIRING between the pure look and the scene, and it is
    // run at relief 0.45 rather than at the default on purpose: the
    // class has to reach the water through submersion(), and a class
    // that quietly did its own comparison against the raw level would
    // agree with this file everywhere except here.
    //
    // The multipliers are MULTIPLIERS. The weather is still in charge of
    // how bright the day is — a storm underwater is darker than a clear
    // afternoon underwater — so the assertion is against the weather's
    // own 2.3 and 0.85 scaled, not against the look's numbers standing
    // alone. An override that assigned instead of multiplying would make
    // every sky identical below the surface.
    const { scene, camera, sun, skyLight, under } = rig();
    const fog = scene.fog as THREE.FogExp2;
    setRelief(0.45);
    setOrigin(deep.x, deep.z);
    place(camera, deep.x, drawn(deep.raw) - 40, deep.z);
    weatherFrame(scene, sun, skyLight);

    const look = underwaterLook(40);
    expect(under.update(sun, skyLight)).toBeCloseTo(40, 6);
    // At least the look's density: a source that takes the greater of
    // the weather's fog and the water's is doing the right thing, one
    // that ends up below it is not.
    expect(fog.density).toBeGreaterThanOrEqual(look.density);
    expect(fog.color.r).toBeCloseTo(look.r, 5);
    expect(fog.color.g).toBeCloseTo(look.g, 5);
    expect(fog.color.b).toBeCloseTo(look.b, 5);
    expect(sun.intensity).toBeCloseTo(SUN_CLEAR * look.sun, 6);
    expect(skyLight.intensity).toBeCloseTo(AMBIENT_CLEAR * look.ambient, 6);

    // And the alpha reaches something the renderer would draw. Fog is
    // an exponential in distance and she rides 7.8 units from the lens,
    // where even the densest water here leaves most of her showing — so
    // a tint that gets computed and never applied is a queen still lit
    // as though she were standing in air, which is most of what the
    // probe frames looked like in the first place.
    const drawnPanes = panes(scene);
    expect(drawnPanes.length).toBeGreaterThan(0);
    expect(drawnPanes[0].opacity).toBeCloseTo(look.tint, 6);

    under.dispose();
  });

  it('samples the water under HER, not under the floating origin', () => {
    // THE ONE THE BRIEF WARNS ABOUT, and the only test in this file
    // that can catch it. The camera is put 40 cm under a stream a
    // kilometre up, with the origin snapped alongside it — so
    // position.x and position.z are a few hundred units, exactly the
    // small numbers the floating origin exists to keep. Read those as
    // world coordinates and you are asking about a point near the
    // middle of Kauai at an altitude of a kilometre, which is dry.
    //
    // Then the SAME rendered position is asked again with the origin
    // moved out to sea. Nothing about the camera changed; everything
    // about where she is did. One answer must be 40 and the other 0,
    // and an implementation that ignores the origin cannot produce
    // both, because for it the two frames are identical.
    const { scene, camera, sun, skyLight, under } = rig();
    setOrigin(deep.x, deep.z);
    place(camera, deep.x, drawn(deep.raw) - 40, deep.z);
    weatherFrame(scene, sun, skyLight);
    expect(under.update(sun, skyLight)).toBeCloseTo(40, 6);
    // The origin snapped to its 1024-unit lattice, so this really is a
    // rebased position and not a coincidence of the station sitting at
    // zero.
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeGreaterThan(0);
    expect(Math.abs(camera.position.x)).toBeLessThan(1_024);
    expect(Math.abs(camera.position.z)).toBeLessThan(1_024);

    const rendered = camera.position.clone();
    setOrigin(OCEAN_X, OCEAN_Z);
    camera.position.copy(rendered);
    weatherFrame(scene, sun, skyLight);
    expect(under.update(sun, skyLight)).toBe(0);

    under.dispose();
  });
});
