/**
 * THE ISLAND, DRAWN FROM THE ISLAND.
 *
 * A top-down Kauaʻi painted straight out of the same `Heightfield` the
 * world is built from, rather than a shipped image. That is not
 * tidiness: a picture would be a SECOND SOURCE OF TRUTH about where the
 * coastline is, and the first time the survey, the smoothing dial or the
 * repair changed it, the map would start lying about where a spawn
 * region sits. Here the picture cannot disagree with the ground, because
 * it is made of the ground.
 *
 * WHAT CHANGED FROM v0, and why each change is the point:
 *
 *  1. THE FIELD IS INJECTED. v0 read module-level `terrainHeight` and
 *     `bandFor` singletons, so the map was welded to whichever heightfield
 *     the process happened to have. v1 has no such singleton — the
 *     `Heightfield` is an object, it is passed in, and a test can hand
 *     this module the real shipped survey without a browser or a loader.
 *  2. THE HEIGHT DOOR TAKES A `WorldPoint`. Every sample here goes
 *     through `world()`, so a rendered position cannot be fed to the map
 *     by accident (coords.ts, and the four bugs that seam cost v0).
 *  3. IT DEGRADES INSTEAD OF THROWING. v0 wrote `getContext('2d')!` and
 *     would have died on any host without a 2D backend — which is
 *     exactly what this repo's jsdom is. A screen that cannot paint a
 *     map must still open; the picture is the part that is missing, not
 *     the screen. So the bake returns `null` and the callers draw their
 *     legend, their list and their buttons without it.
 *
 * THE SPLIT THIS FILE IS ORGANISED AROUND: the arithmetic — the ramp and
 * the projection — is pure and DOM-free, and the canvas work is one thin
 * function at the bottom. That is what lets the parts a spawn picker's
 * correctness rests on (which coast a pixel is on, what a colour means)
 * be tested exactly, in a place where no canvas exists.
 *
 * Baked once into a detached canvas and reused, because it is hundreds
 * of thousands of samples and nothing about it changes.
 *
 * `src/ui/` may touch the DOM. It may not import three, and does not.
 */
import { ISLAND_SPAN, world, type WorldPoint } from '../world/coords';
import { UNITS_PER_METRE } from '../world/dem';
import { SEA_LEVEL, type Heightfield } from '../world/heightfield';

/**
 * Pixels a side. Enough to read the coastline, cheap enough to bake:
 * 768 px across 5,600,000 units puts 7,292 units — 73 m — in a pixel,
 * which is already coarser than the 54.7 m coarse survey behind it.
 */
export const MAP_SIZE = 768;

/** Half the island, in world units. The map's origin is the island's centre. */
const HALF_SPAN = ISLAND_SPAN / 2;

// ---------------------------------------------------------------------------
// The ramp: an elevation, a colour, and the name of what is there
// ---------------------------------------------------------------------------

/**
 * What the ground is called at a height. Ordered, and the order is
 * meaningful — `BAND_ORDER.indexOf` is a monotone function of elevation,
 * which is what lets a legend and a spawn rule sort by it.
 */
export type MapBand = 'sea' | 'sand' | 'lowland' | 'jungle' | 'cliff' | 'mountain' | 'summit';

/** Sea first, summit last. The legend's order and the ramp's order are the same list. */
export const BAND_ORDER: readonly MapBand[] = ['sea', 'sand', 'lowland', 'jungle', 'cliff', 'mountain', 'summit'];

/** One point on the ramp: a colour, and the name of the thing it is the colour of. */
export interface MapShade {
  readonly band: MapBand;
  /** 0..255, not rounded — the caller writes it into an 8-bit buffer. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Sea colour by depth. Shallow water reads as reef, which is most of
 * what makes a tropical island recognisable from above.
 */
const WATER_SHALLOW = [38, 96, 130] as const;
const WATER_DEEP = [12, 38, 66] as const;

/** Depth, in world units, at which the water is as dark as it gets. 300 m. */
const FULL_DEPTH = 30_000;

interface LandStop {
  readonly band: MapBand;
  /** Metres above mean sea level at which this band begins. */
  readonly metres: number;
  readonly rgb: readonly [number, number, number];
}

/**
 * Land by elevation. Deliberately close to the terrain's own bands so
 * the map and the ground agree about what a place looks like.
 */
const LAND: readonly LandStop[] = [
  { band: 'sand', metres: 0, rgb: [214, 199, 158] },
  { band: 'lowland', metres: 120, rgb: [126, 156, 86] },
  { band: 'jungle', metres: 400, rgb: [74, 120, 62] },
  { band: 'cliff', metres: 800, rgb: [116, 106, 78] },
  { band: 'mountain', metres: 1150, rgb: [150, 142, 128] },
  { band: 'summit', metres: 1400, rgb: [232, 234, 238] },
];

/**
 * A height in WORLD UNITS to the colour and the name of what is there.
 *
 * The colour and the name come out of one call on purpose. Two functions
 * reading the same thresholds would be two places to edit, and the
 * failure mode is a legend that says "jungle" next to a pixel painted
 * cliff-grey — silent, and only visible to someone comparing them.
 *
 * The waterline itself is drawn as water: at exactly `SEA_LEVEL` there is
 * no beach yet, and a map that painted sand at zero would draw a sand
 * ring around every atoll-shaped contour in the bathymetry.
 */
export function rampFor(height: number): MapShade {
  // A NaN would fail `<=` and then fail every `>=` in the loop below,
  // falling through as `sand` — an invented beach in the middle of the
  // ocean, which is the quietest possible place for the loudest possible
  // wrong answer. The honest reading of "no height here" is water.
  const units = Number.isFinite(height) ? height : SEA_LEVEL;

  if (units <= SEA_LEVEL) {
    const deep = Math.min(1, (SEA_LEVEL - units) / FULL_DEPTH);
    return {
      band: 'sea',
      r: WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * deep,
      g: WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * deep,
      b: WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * deep,
    };
  }

  const metres = units / UNITS_PER_METRE;
  let low = 0;
  for (let i = 1; i < LAND.length; i += 1) {
    if (metres >= LAND[i].metres) low = i;
  }
  const from = LAND[low];
  const to = LAND[Math.min(low + 1, LAND.length - 1)];
  const span = to.metres - from.metres;
  // The top band has nowhere to go, so it holds its colour.
  const t = span > 0 ? Math.min(1, (metres - from.metres) / span) : 0;
  return {
    band: from.band,
    r: from.rgb[0] + (to.rgb[0] - from.rgb[0]) * t,
    g: from.rgb[1] + (to.rgb[1] - from.rgb[1]) * t,
    b: from.rgb[2] + (to.rgb[2] - from.rgb[2]) * t,
  };
}

/** What the ground is called at a world position. For the legend, and for a spawn rule. */
export function bandAt(field: Heightfield, at: WorldPoint): MapBand {
  return rampFor(field.heightAt(at)).band;
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/**
 * Somewhere to draw a dot. NOT a location — see coords.ts. A pixel pair
 * is presentation and lives for one frame; the WorldPoint it came from
 * is the thing that gets stored, sent and reloaded.
 */
export interface MapPixel {
  readonly x: number;
  readonly y: number;
}

/**
 * World position to map pixel, north up and east right.
 *
 * THE SIGNS ARE THE WHOLE OF THIS FUNCTION. The survey is row-major with
 * ROW 0 NORTH and COLUMN 0 WEST (`world/dem.ts`), so in world terms +wx
 * is east and +wz is SOUTH — north is -wz. A canvas's +y also runs down.
 * The two agree, which is why this reads as a plain rescale with no
 * flip in it; get it backwards and nothing crashes, the island simply
 * comes out mirrored and every spawn region lands on the wrong coast.
 *
 * Points off the island map off the picture rather than being clamped: a
 * caller that wants a marker pinned to the edge should say so, and one
 * that has drifted offshore should be able to see that it has.
 */
export function worldToMap(at: WorldPoint, size: number = MAP_SIZE): MapPixel {
  return {
    x: ((at.wx + HALF_SPAN) / ISLAND_SPAN) * size,
    y: ((at.wz + HALF_SPAN) / ISLAND_SPAN) * size,
  };
}

/**
 * And back, for a tap on the map.
 *
 * The return type is written down rather than inferred because what
 * comes out of here is about to be KEPT: a tap becomes a spawn choice,
 * and a spawn choice outlives the frame, the scene and the save file.
 * Saying `WorldPoint` out loud is what stops the day someone returns a
 * pixel pair from here and it gets stored.
 */
export function mapToWorld(px: number, py: number, size: number = MAP_SIZE): WorldPoint {
  return world(
    (px / size) * ISLAND_SPAN - HALF_SPAN,
    (py / size) * ISLAND_SPAN - HALF_SPAN,
  );
}

// ---------------------------------------------------------------------------
// The bake
// ---------------------------------------------------------------------------

interface Baked {
  readonly canvas: HTMLCanvasElement;
  readonly field: Heightfield;
  readonly size: number;
}

let baked: Baked | null = null;

/**
 * Paint the island once.
 *
 * Sun from the north-west, which is how every relief map since the
 * nineteenth century has been lit — get it wrong and the eye reads the
 * valleys as ridges. Water takes no hillshade: the sea floor's slopes
 * are real but nobody is looking at them, and shading them turns the
 * bathymetry into a second, competing terrain.
 *
 * Returns `null` rather than throwing when there is no 2D context. That
 * is not a hypothetical: this repo's jsdom has no canvas backend, and a
 * host without one must still be able to open the screen this map
 * decorates.
 *
 * THE CACHE IS KEYED ON THE FIELD AND THE SIZE, AND DELIBERATELY NOT ON
 * `field.revision()`. The revision moves whenever a high-detail tile
 * streams in or out — but a map pixel is 7,292 world units across and an
 * HD sample is 1,367, so a tile can only ever add detail four times
 * finer than this picture can hold. Following the revision would spend
 * 590,000 height reads redrawing an identical image every time the
 * player crossed a tile edge. A genuinely new survey is a new
 * `Heightfield`, and that does re-bake; `forgetIsland()` covers the rest.
 */
export function bakeIsland(field: Heightfield, size: number = MAP_SIZE): HTMLCanvasElement | null {
  if (baked && baked.field === field && baked.size === size) return baked.canvas;
  // A canvas of half a pixel is not a map, and a NaN size would paint
  // nothing while dividing the whole projection by zero.
  if (!Number.isInteger(size) || size < 1) return null;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ink = canvas.getContext('2d');
  if (!ink) return null;

  const pixels = ink.createImageData(size, size);
  const step = ISLAND_SPAN / size;

  for (let y = 0; y < size; y += 1) {
    // The pixel is sampled at the world position `worldToMap` maps it
    // FROM, so a marker placed with that function lands on the pixel
    // painted from the same ground rather than half a cell away.
    const wz = y * step - HALF_SPAN;
    for (let x = 0; x < size; x += 1) {
      const wx = x * step - HALF_SPAN;
      const here = field.heightAt(world(wx, wz));
      const shade = rampFor(here);
      const at = (y * size + x) * 4;
      pixels.data[at + 3] = 255;

      if (shade.band === 'sea') {
        pixels.data[at] = shade.r;
        pixels.data[at + 1] = shade.g;
        pixels.data[at + 2] = shade.b;
        continue;
      }

      const west = field.heightAt(world(wx - step, wz));
      const north = field.heightAt(world(wx, wz - step));
      const lit = 1 + Math.max(-0.55, Math.min(0.55, ((here - west) + (here - north)) / 40_000));
      pixels.data[at] = Math.max(0, Math.min(255, shade.r * lit));
      pixels.data[at + 1] = Math.max(0, Math.min(255, shade.g * lit));
      pixels.data[at + 2] = Math.max(0, Math.min(255, shade.b * lit));
    }
  }

  ink.putImageData(pixels, 0, 0);
  baked = { canvas, field, size };
  return canvas;
}

/**
 * THE MAP DREW THE RIVERS AND THE LAKES IN v0, and it cannot now.
 *
 * v0's `riverInk` lived here with a table of Strahler-order minimum
 * widths, so a headwater stream stayed visible when one pixel covered
 * more ground than the whole channel — the COURSE exact, the WIDTH
 * allowed to lie. That rule is worth keeping when inland water comes
 * back; it is the only honest way to draw a 5.5 m stream on a 56 km
 * island. It is not carried across now because v1 has no river network
 * to draw, and a map that invented one would be exactly the second
 * source of truth this file exists to avoid.
 */

/** Throw the bake away — for tests, and for a re-baked heightfield. */
export function forgetIsland(): void {
  baked = null;
}
