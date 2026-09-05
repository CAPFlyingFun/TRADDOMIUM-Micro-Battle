// @vitest-environment jsdom
/**
 * THE MAP AGREES WITH THE ISLAND, OR THE SPAWN PICKER IS DECORATION.
 *
 * Three things can go wrong here and only one of them is visible without
 * a test:
 *
 *  1. THE AXES. Row 0 of the survey is NORTH and column 0 is WEST, so in
 *     world terms north is -wz and east is +wx. A sign flipped in either
 *     direction still produces a plausible-looking island — mirrored —
 *     and every spawn region then lands on the wrong coast. Nothing
 *     crashes, nothing looks broken, and the first person to notice is a
 *     player who walked north out of Hanalei into the sea. So the
 *     orientation is checked against the REAL SHIPPED SURVEY rather than
 *     against the projection's own arithmetic: `public/kauai-1025.bin`,
 *     decoded and repaired exactly as the game decodes it, is asked
 *     where the water is, and the map has to put that water at the top.
 *  2. THE ROUND TRIP. A tap on the map becomes a spawn point, and a spawn
 *     point is persisted. If `mapToWorld` is not the inverse of
 *     `worldToMap`, the dot the player pressed and the place the game
 *     starts them are different places — by a constant nobody measures,
 *     because both look reasonable.
 *  3. THE RAMP. The legend's words and the picture's colours come out of
 *     one call precisely so they cannot drift apart, and that is worth
 *     pinning: sea below sea level, land above it, and the band never
 *     going backwards as the ground goes up.
 *
 * WHY THE DOM IS BARELY IN THIS FILE. jsdom here has no canvas backend,
 * so `getContext('2d')` returns null — which is exactly the condition the
 * module promises to survive. The pure half (ramp + projection) is
 * therefore where the correctness lives and is tested directly; the bake
 * is tested twice, once for the degrade and once against a stand-in 2D
 * context that records what was painted.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ISLAND_SPAN, world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE, decodeCoarse, type DemGrid } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { Heightfield, SEA_LEVEL } from '../src/world/heightfield';
import {
  BAND_ORDER,
  MAP_SIZE,
  bakeIsland,
  bandAt,
  forgetIsland,
  mapToWorld,
  rampFor,
  worldToMap,
  type MapBand,
} from '../src/map/islandMap';

/**
 * The repo root. `fileURLToPath(import.meta.url)` and not
 * `fileURLToPath(new URL('..', import.meta.url))`, which is what the
 * node-environment fixtures use: under jsdom the global `URL` is
 * jsdom's, and handing node's `fileURLToPath` a foreign URL object gets
 * "the URL must be of scheme file" for a URL that plainly is one. A
 * string goes through node's own parser. `tests/splashBoot.test.ts` does
 * the same for the same reason.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HALF = ISLAND_SPAN / 2;

/** World units for a height in metres, so the fixtures read as elevations. */
const metres = (m: number): number => m * UNITS_PER_METRE;

let grid: DemGrid;
let field: Heightfield;
beforeAll(() => {
  const bytes = readFileSync(path.join(ROOT, 'public', 'kauai-1025.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  grid = repairGrid(decodeCoarse(buffer)).grid;
  field = new Heightfield(grid);
});

/**
 * Three places on the real island, and what the survey says about each.
 * Every claim these support is asserted from the field itself first, so a
 * changed survey fails saying "this is no longer ocean" rather than
 * failing as a mysterious pixel comparison.
 */
const NORTHERN_SEA: WorldPoint = world(0, -2_600_000); // 26 km north of centre: −313 m
const SOUTHERN_SEA: WorldPoint = world(0, 2_600_000); // the same distance south: −1,368 m
const HIGH_GROUND: WorldPoint = world(0, 0); // the middle of the island: +1,303 m
/** The highest sample in the coarse survey: 1,592.4 m, Kawaikini softened by a 54.7 m lattice. */
const SUMMIT: WorldPoint = world(437_500, -38_281.25);

/** The module caches its bake at module scope, so no test may inherit another's. */
beforeEach(() => {
  forgetIsland();
});

describe('the projection is its own inverse', () => {
  it('returns the world point it was given, at the centre, the corners and in between', () => {
    // A tap becomes a spawn point and a spawn point is saved. A round trip
    // that loses a pixel is a game that starts somewhere the player did
    // not press — and at true scale one pixel of a 768-wide map is 73 m,
    // which is the difference between a beach and the water off it.
    const places: readonly WorldPoint[] = [
      world(0, 0),
      world(-HALF, -HALF),
      world(HALF, -HALF),
      world(-HALF, HALF),
      world(HALF, HALF),
      world(-1_234_567, 890_123),
      world(2_345, -6_789),
      world(HALF - 1, 0),
    ];
    // One pixel, expressed in world units, at each of two sizes.
    for (const size of [MAP_SIZE, 240]) {
      const tolerance = ISLAND_SPAN / size;
      for (const at of places) {
        const pixel = worldToMap(at, size);
        const back = mapToWorld(pixel.x, pixel.y, size);
        expect(Math.abs(back.wx - at.wx), `${at.wx},${at.wz} at size ${size}`).toBeLessThan(tolerance);
        expect(Math.abs(back.wz - at.wz), `${at.wx},${at.wz} at size ${size}`).toBeLessThan(tolerance);
      }
    }
  });

  it('returns the pixel it was given, going the other way round', () => {
    // The reverse direction is the one a picker actually runs: the finger
    // lands on a pixel, and the marker it draws afterwards has to come
    // back to the same pixel or the dot walks away from the touch.
    for (const [px, py] of [[0, 0], [MAP_SIZE, MAP_SIZE], [MAP_SIZE / 2, MAP_SIZE / 2], [17, 511], [767.5, 0.25]]) {
      const there = worldToMap(mapToWorld(px, py), MAP_SIZE);
      expect(Math.abs(there.x - px)).toBeLessThan(1);
      expect(Math.abs(there.y - py)).toBeLessThan(1);
    }
  });

  it('puts the island’s corners on the picture’s corners', () => {
    // The survey covers exactly ISLAND_SPAN and the picture covers exactly
    // the survey. An off-by-one-cell projection would leave a sliver of
    // ocean unreachable and quietly compress everything else.
    expect(worldToMap(world(-HALF, -HALF))).toEqual({ x: 0, y: 0 });
    expect(worldToMap(world(HALF, HALF))).toEqual({ x: MAP_SIZE, y: MAP_SIZE });
    expect(worldToMap(world(0, 0))).toEqual({ x: MAP_SIZE / 2, y: MAP_SIZE / 2 });
    expect(mapToWorld(0, 0)).toEqual(world(-HALF, -HALF));
    expect(mapToWorld(MAP_SIZE, MAP_SIZE)).toEqual(world(HALF, HALF));
  });

  it('scales with the size it is asked for, and nothing else', () => {
    // A picker may draw a thumbnail and a full map from the same module;
    // both must address the same island.
    expect(worldToMap(world(0, 0), 256)).toEqual({ x: 128, y: 128 });
    expect(worldToMap(world(HALF, HALF), 1)).toEqual({ x: 1, y: 1 });
    expect(mapToWorld(64, 64, 128)).toEqual(world(0, 0));
  });
});

describe('north is −wz and east is +wx', () => {
  it('draws −wz above +wz and +wx right of −wx', () => {
    // The arithmetic half of the claim. `world/dem.ts`: row 0 is north,
    // column 0 is west, so +wz is SOUTH — and a canvas's +y also runs
    // down, which is why the projection has no flip in it and why a flip
    // added "to fix the orientation" would break exactly this.
    expect(worldToMap(world(0, -1_000_000)).y).toBeLessThan(worldToMap(world(0, 1_000_000)).y);
    expect(worldToMap(world(1_000_000, 0)).x).toBeGreaterThan(worldToMap(world(-1_000_000, 0)).x);
  });

  it('puts the ocean north of Kauaʻi above Kauaʻi, in the real survey', () => {
    // THE TEST THIS FILE EXISTS FOR. Checked against the shipped bytes
    // rather than against the projection's own signs, because a mirrored
    // map is self-consistent: only the ground can say which side the
    // water is on.
    expect(field.heightAt(NORTHERN_SEA), 'north of the island is no longer ocean').toBeLessThan(SEA_LEVEL);
    expect(field.heightAt(HIGH_GROUND), 'the middle of the island is no longer land').toBeGreaterThan(SEA_LEVEL);

    expect(worldToMap(NORTHERN_SEA).y).toBeLessThan(worldToMap(HIGH_GROUND).y);
    // And the sea on the far side is below it, so "above" is an
    // orientation rather than an accident of where the two points sit.
    expect(field.heightAt(SOUTHERN_SEA)).toBeLessThan(SEA_LEVEL);
    expect(worldToMap(SOUTHERN_SEA).y).toBeGreaterThan(worldToMap(HIGH_GROUND).y);
  });

  it('reads the top edge of the picture as open water', () => {
    // The complement of the check above, from the other end: whatever
    // pixel row zero is, the ground under it must be sea. It is — the
    // northernmost land at this scale is eight rows down.
    for (const px of [0, 200, 384, 600, 768]) {
      const at = mapToWorld(px, 0);
      expect(field.heightAt(at), `map (${px}, 0)`).toBeLessThan(SEA_LEVEL);
      expect(bandAt(field, at)).toBe('sea');
    }
  });
});

describe('the ramp names what it paints', () => {
  it('splits sea from land exactly at SEA_LEVEL', () => {
    // The waterline is drawn as water: a map that painted sand at zero
    // would ring every zero-crossing in the bathymetry with a beach.
    expect(rampFor(SEA_LEVEL).band).toBe('sea');
    expect(rampFor(SEA_LEVEL - 1).band).toBe('sea');
    expect(rampFor(SEA_LEVEL + 1).band).toBe('sand');
    expect(rampFor(metres(-3_000)).band).toBe('sea');
  });

  it('never goes back down a band as the ground goes up', () => {
    // The monotonicity that matters: BAND_ORDER's index is a
    // non-decreasing function of elevation, which is what lets a legend
    // and a spawn rule sort by it. The step is deliberately not a round
    // number, so the sweep lands between the thresholds as well as on
    // them.
    let last = -1;
    for (let h = metres(-3_400); h <= metres(1_700); h += 137) {
      const band = rampFor(h).band;
      const rank = BAND_ORDER.indexOf(band);
      expect(rank, `${band} is not in BAND_ORDER`).toBeGreaterThanOrEqual(0);
      expect(rank, `band went backwards at ${h / UNITS_PER_METRE} m`).toBeGreaterThanOrEqual(last);
      last = rank;
    }
    // And the sweep actually crossed the whole ramp, or the check above
    // would pass on a ramp stuck at one colour.
    expect(last).toBe(BAND_ORDER.length - 1);
    expect(BAND_ORDER[0]).toBe('sea');
    expect(BAND_ORDER[BAND_ORDER.length - 1]).toBe('summit');
  });

  it('darkens the water with depth and then stops, so the shelf stays readable', () => {
    // Shallow water reading as reef is most of what makes a tropical
    // island recognisable from above; past 300 m there is nothing left to
    // distinguish, and a ramp that kept going would take the whole abyss
    // to black and lose the shelf's edge with it.
    let previous = rampFor(SEA_LEVEL);
    for (const depth of [10, 50, 150, 299]) {
      const here = rampFor(metres(-depth));
      expect(here.r).toBeLessThan(previous.r);
      expect(here.g).toBeLessThan(previous.g);
      expect(here.b).toBeLessThan(previous.b);
      previous = here;
    }
    const deepest = rampFor(metres(-300));
    expect(rampFor(metres(-3_000))).toEqual(deepest);
    expect(rampFor(metres(-30_000))).toEqual(deepest);
  });

  it('paints water blue in a way snow cannot imitate', () => {
    // The sea/land colour claim, stated so it survives the summit. The
    // obvious version — "water is the colour whose blue channel is
    // largest" — is FALSE for this ramp: summit snow is (232, 234, 238)
    // and its blue channel is the largest too. What separates them is how
    // FAR: every water colour is at least twice as blue as it is red, and
    // no land colour comes near that.
    for (const depth of [0, 1, 25, 120, 400, 3_000]) {
      const wet = rampFor(metres(-depth));
      expect(wet.band).toBe('sea');
      expect(wet.b, `at ${depth} m down`).toBeGreaterThanOrEqual(2 * wet.r);
    }
    for (let h = SEA_LEVEL + 1; h <= metres(1_700); h += 311) {
      const dry = rampFor(h);
      expect(dry.band).not.toBe('sea');
      expect(dry.b, `at ${h / UNITS_PER_METRE} m up`).toBeLessThan(2 * dry.r);
    }
  });

  it('keeps every channel inside a byte', () => {
    for (let h = metres(-3_400); h <= metres(2_000); h += 613) {
      const shade = rampFor(h);
      for (const channel of [shade.r, shade.g, shade.b]) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('reads a NaN as sea rather than as an invented beach', () => {
    // Without the guard a NaN fails `<=` and then fails every threshold
    // comparison, landing on the first land band — a sand-coloured pixel
    // in the middle of the ocean, which is the quietest possible place
    // for the loudest possible wrong answer.
    expect(rampFor(Number.NaN).band).toBe('sea');
    expect(rampFor(Number.POSITIVE_INFINITY).band).toBe('sea');
  });

  it('calls the real ocean sea and the real summit summit', () => {
    // Against the shipped survey, so the thresholds are checked against
    // the island they were chosen for rather than against themselves.
    expect(bandAt(field, NORTHERN_SEA)).toBe('sea');
    expect(field.heightAt(SUMMIT) / UNITS_PER_METRE).toBeGreaterThan(1_400);
    expect(bandAt(field, SUMMIT)).toBe('summit');
    // The middle of Kauaʻi is high but not summit, which is what stops
    // the summit assertion above from passing on a ramp that called
    // everything above the waterline a summit.
    expect(bandAt(field, HIGH_GROUND)).toBe('mountain');
  });
});

describe('baking where there is no 2D context', () => {
  it('returns null and does not throw', () => {
    // jsdom has no canvas backend, which is the condition the module
    // promises to survive: the picture is what is missing, not the
    // screen. v0 wrote `getContext('2d')!` and would have died here.
    expect(document.createElement('canvas').getContext('2d')).toBeNull();
    expect(() => bakeIsland(field)).not.toThrow();
    expect(bakeIsland(field)).toBeNull();
    expect(bakeIsland(field, 32)).toBeNull();
    // And a failed bake caches nothing, so the screen that opens without
    // a map still gets one on a host that has a context.
    expect(() => forgetIsland()).not.toThrow();
  });
});

/**
 * A stand-in 2D context: enough of one to record what the bake painted.
 * Not a canvas implementation — it exists so that the picture's contents
 * can be asserted in a place where no real canvas exists.
 */
interface Ink {
  createImageData(width: number, height: number): ImageData;
  putImageData(image: ImageData, x: number, y: number): void;
}

let painted: ImageData | null = null;

function stubInk(): Ink {
  return {
    createImageData(width: number, height: number): ImageData {
      return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
        colorSpace: 'srgb',
      } as unknown as ImageData;
    },
    putImageData(image: ImageData): void {
      painted = image;
    },
  };
}

/** Count the field reads a bake makes, the way the ocean's tests do. */
function counting(target: Heightfield): { reads: () => number; restore: () => void } {
  const real = target.heightAt.bind(target);
  let reads = 0;
  (target as unknown as { heightAt: (at: WorldPoint) => number }).heightAt = (at) => {
    reads += 1;
    return real(at);
  };
  return {
    reads: () => reads,
    restore: () => {
      (target as unknown as { heightAt: (at: WorldPoint) => number }).heightAt = real;
    },
  };
}

describe('baking where there is one', () => {
  type WithContext = { getContext: (id: string) => unknown };
  let realGetContext: (id: string) => unknown;

  beforeAll(() => {
    const prototype = HTMLCanvasElement.prototype as unknown as WithContext;
    realGetContext = prototype.getContext;
    prototype.getContext = (id: string) => (id === '2d' ? stubInk() : null);
  });

  afterAll(() => {
    (HTMLCanvasElement.prototype as unknown as WithContext).getContext = realGetContext;
  });

  beforeEach(() => {
    painted = null;
  });

  it('paints the island once and then hands out the same canvas', () => {
    // Hundreds of thousands of samples, and nothing about them changes.
    // A picker that re-baked on every redraw would spend the frame it
    // needs for the marker it is dragging.
    const watch = counting(field);
    try {
      const first = bakeIsland(field, 32);
      expect(first).not.toBeNull();
      expect(watch.reads()).toBeGreaterThanOrEqual(32 * 32);
      const after = watch.reads();
      expect(bakeIsland(field, 32)).toBe(first);
      expect(bakeIsland(field, 32)).toBe(first);
      expect(watch.reads()).toBe(after);
    } finally {
      watch.restore();
    }
  });

  it('re-bakes for a new size, a new field, or after forgetIsland', () => {
    // The three things that genuinely change the picture. The one that
    // deliberately does NOT is `field.revision()`: a streamed tile is
    // four times finer than a map pixel, so following it would redraw an
    // identical image every time the player crossed a tile edge.
    const first = bakeIsland(field, 32);
    expect(bakeIsland(field, 16)).not.toBe(first);

    forgetIsland();
    const afterForget = bakeIsland(field, 32);
    expect(afterForget).not.toBe(first);

    const second = new Heightfield(grid);
    expect(bakeIsland(second, 32)).not.toBe(afterForget);
  });

  it('refuses a size that is not a whole number of pixels', () => {
    // Degrade, do not crash: a zero or fractional size would divide the
    // projection by nothing and paint a canvas nobody can address.
    expect(bakeIsland(field, 0)).toBeNull();
    expect(bakeIsland(field, -8)).toBeNull();
    expect(bakeIsland(field, 12.5)).toBeNull();
    expect(bakeIsland(field, Number.NaN)).toBeNull();
  });

  it('paints Kauaʻi where Kauaʻi is: sea along the north edge, land in the middle', () => {
    // The end-to-end version of the orientation check — projection, ramp
    // and survey together, read back out of the pixels. At 64 across,
    // every map pixel lands exactly on a coarse sample (5,600,000 / 64 is
    // sixteen coarse steps), so these are the survey's own values and not
    // an interpolation artefact.
    const size = 64;
    expect(bakeIsland(field, size)).not.toBeNull();
    const image = painted;
    expect(image, 'the bake never put its pixels on the canvas').not.toBeNull();
    const pixel = (x: number, y: number): [number, number, number] => {
      const at = (y * size + x) * 4;
      const data = (image as ImageData).data;
      return [data[at], data[at + 1], data[at + 2]];
    };

    // Every pixel of the northern and southern edges is open ocean, and
    // deep ocean is (12, 38, 66) exactly — the ramp's floor, reached by
    // anything past 300 m down.
    for (let x = 0; x < size; x += 1) {
      const north = pixel(x, 0);
      const south = pixel(x, size - 1);
      expect(north[2], `north edge pixel ${x} is not water`).toBeGreaterThanOrEqual(2 * north[0]);
      expect(south[2], `south edge pixel ${x} is not water`).toBeGreaterThanOrEqual(2 * south[0]);
      expect(north).toEqual([12, 38, 66]);
    }

    // The middle is Kauaʻi's high interior: a shaded mountain colour, and
    // emphatically not water. "Not water" is the same separator the ramp
    // test uses — twice as blue as red — and not "blue is the smallest
    // channel", because this pixel is a pale near-summit grey lit from
    // the north-west and it saturates.
    const centre = pixel(size / 2, size / 2);
    const shade = rampFor(field.heightAt(world(0, 0)));
    expect(shade.band).toBe('mountain');
    expect(centre[2]).toBeLessThan(2 * centre[0]);
    // Hillshade may lighten or darken a land pixel by up to 55% and
    // nothing beyond that, so a pixel outside this band was painted from
    // a different colour rather than merely lit differently. The upper
    // end is capped at a byte: at 1,303 m the ramp is already two-thirds
    // of the way to snow, and +55% of that is off the top of the scale.
    for (const [got, want] of [[centre[0], shade.r], [centre[1], shade.g], [centre[2], shade.b]]) {
      expect(got).toBeGreaterThanOrEqual(Math.floor(want * 0.45));
      expect(got).toBeLessThanOrEqual(Math.min(255, Math.ceil(want * 1.55)));
    }

    // The relief lighting is doing something rather than multiplying by
    // one: across the island some land is lit brighter than its flat ramp
    // colour and some darker. Without this a hillshade that had quietly
    // become a constant would still pass every check above.
    let brighter = 0;
    let darker = 0;
    for (let y = 10; y < size - 10; y += 3) {
      for (let x = 10; x < size - 10; x += 3) {
        const flat = rampFor(field.heightAt(mapToWorld(x, y, size)));
        if (flat.band === 'sea') continue;
        const lit = pixel(x, y)[1];
        if (lit > flat.g + 1) brighter += 1;
        if (lit < flat.g - 1) darker += 1;
      }
    }
    expect(brighter, 'nothing is lit from the north-west').toBeGreaterThan(5);
    expect(darker, 'nothing is in shadow').toBeGreaterThan(5);

    // Alpha is opaque everywhere, or the map draws as a hole.
    const data = (image as ImageData).data;
    for (let i = 3; i < data.length; i += 4 * 97) expect(data[i]).toBe(255);
  });

  it('paints the same bands the ramp names, pixel for pixel, on the water', () => {
    // Water takes no hillshade, so its pixels are the ramp's own output
    // and can be compared exactly. This is what ties the picture to
    // `bandAt` — the legend and the image reading one call is the whole
    // reason the ramp returns a colour and a name together.
    const size = 64;
    expect(bakeIsland(field, size)).not.toBeNull();
    const data = (painted as ImageData).data;
    let checked = 0;
    for (let y = 0; y < size; y += 7) {
      for (let x = 0; x < size; x += 5) {
        const at = mapToWorld(x, y, size);
        const shade = rampFor(field.heightAt(at));
        if (shade.band !== 'sea') continue;
        const i = (y * size + x) * 4;
        expect([data[i], data[i + 1], data[i + 2]], `map (${x}, ${y})`)
          .toEqual([Math.round(shade.r), Math.round(shade.g), Math.round(shade.b)]);
        checked += 1;
      }
    }
    // The loop must actually have found water, or it asserted nothing.
    expect(checked).toBeGreaterThan(20);
  });

  it('names a band for every place on the island', () => {
    // `bandAt` is what a legend and a spawn rule call, and it must answer
    // for anywhere the picture covers — including off the edge, where the
    // heightfield clamps to the coast rather than refusing.
    const seen = new Set<MapBand>();
    for (let y = 0; y <= MAP_SIZE; y += 37) {
      for (let x = 0; x <= MAP_SIZE; x += 37) {
        seen.add(bandAt(field, mapToWorld(x, y)));
      }
    }
    expect(seen.has('sea')).toBe(true);
    expect(seen.has('summit') || seen.has('mountain')).toBe(true);
    for (const band of seen) expect(BAND_ORDER).toContain(band);
    expect(bandAt(field, world(-HALF * 3, HALF * 3))).toBe('sea');
  });
});
