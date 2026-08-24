/**
 * THE ISLAND, DRAWN FROM THE ISLAND.
 *
 * A top-down Kauaʻi painted straight out of the same heightfield the
 * world is built from, rather than a shipped image. That is not
 * tidiness: a picture would be a second source of truth about where the
 * coastline is, and the first time the bake changed it would start
 * lying about where a spawn region sits.
 *
 * Baked once into an offscreen canvas and reused, because it is
 * hundreds of thousands of samples and nothing about it changes.
 */
import { bandFor, terrainHeight } from '../world/heightfield';
import { world } from '../world/coords';
import { ISLAND_SPAN } from '../world/heightfield';

/** Pixels a side. Enough to read the coastline, cheap enough to bake. */
export const MAP_SIZE = 768;

/**
 * Sea, then land by elevation. Deliberately close to the terrain bands
 * so the map and the ground agree about what a place looks like.
 */
const WATER_DEEP = [12, 38, 66] as const;
const WATER_SHALLOW = [38, 96, 130] as const;
const SHADES: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [214, 199, 158]],       // sand
  [120, [126, 156, 86]],      // lowland green
  [400, [74, 120, 62]],       // jungle
  [800, [116, 106, 78]],      // cliff
  [1150, [150, 142, 128]],    // mountain
  [1400, [232, 234, 238]],    // summit
];

function shade(metres: number): readonly [number, number, number] {
  let low = SHADES[0];
  for (const step of SHADES) {
    if (metres >= step[0]) low = step;
  }
  const next = SHADES[SHADES.indexOf(low) + 1] ?? low;
  const span = next[0] - low[0];
  const t = span > 0 ? Math.min(1, (metres - low[0]) / span) : 0;
  return [
    low[1][0] + (next[1][0] - low[1][0]) * t,
    low[1][1] + (next[1][1] - low[1][1]) * t,
    low[1][2] + (next[1][2] - low[1][2]) * t,
  ];
}

let baked: HTMLCanvasElement | null = null;

/**
 * World position to map pixel.
 *
 * The map's ONLY job in the coordinate story: it turns an authoritative
 * world position into somewhere to draw a dot. Nothing here is ever a
 * location — see coords.ts. Marker pixels are presentation; the
 * candidate's WorldPoint is the truth.
 */
export function worldToMap(wx: number, wz: number, size = MAP_SIZE): { x: number; y: number } {
  return {
    x: ((wx + ISLAND_SPAN / 2) / ISLAND_SPAN) * size,
    y: ((wz + ISLAND_SPAN / 2) / ISLAND_SPAN) * size,
  };
}

/** And back, for a tap on the map. */
export function mapToWorld(x: number, y: number, size = MAP_SIZE) {
  return world(
    (x / size) * ISLAND_SPAN - ISLAND_SPAN / 2,
    (y / size) * ISLAND_SPAN - ISLAND_SPAN / 2,
  );
}

/**
 * Paint the island once.
 *
 * Sun from the northwest, which is how every relief map since the
 * nineteenth century has been lit — get it wrong and the eye reads the
 * valleys as ridges.
 */
export function bakeIsland(): HTMLCanvasElement {
  if (baked) return baked;
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const ink = canvas.getContext('2d')!;
  const pixels = ink.createImageData(MAP_SIZE, MAP_SIZE);
  const step = ISLAND_SPAN / MAP_SIZE;

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const wx = x * step - ISLAND_SPAN / 2;
      const wz = y * step - ISLAND_SPAN / 2;
      const here = terrainHeight(wx, wz);
      const at = (y * MAP_SIZE + x) * 4;

      if (here <= 0) {
        // Shallow water reads as reef, which is most of what makes a
        // tropical island recognisable from above.
        const deep = Math.min(1, -here / 30_000);
        pixels.data[at] = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * deep;
        pixels.data[at + 1] = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * deep;
        pixels.data[at + 2] = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * deep;
        pixels.data[at + 3] = 255;
        continue;
      }

      const metres = here / 100;
      const [r, g, b] = shade(metres);
      // Hillshade from the northwest.
      const west = terrainHeight(wx - step, wz);
      const north = terrainHeight(wx, wz - step);
      const lit = 1 + Math.max(-0.55, Math.min(0.55, ((here - west) + (here - north)) / 40_000));
      pixels.data[at] = Math.max(0, Math.min(255, r * lit));
      pixels.data[at + 1] = Math.max(0, Math.min(255, g * lit));
      pixels.data[at + 2] = Math.max(0, Math.min(255, b * lit));
      pixels.data[at + 3] = 255;
    }
  }

  ink.putImageData(pixels, 0, 0);
  baked = canvas;
  return canvas;
}

/**
 * THE MAP DREW THE RIVERS AND THE LAKES, and it cannot now.
 *
 * `riverInk` lived here with a table of Strahler-order minimum widths,
 * so a headwater stream stayed visible when one pixel covered more
 * ground than the whole channel — the course exact, the WIDTH allowed
 * to lie. That rule is worth keeping when the water comes back; it is
 * the only honest way to draw a 5.5 m stream on a 56 km island.
 */


/** Throw the bake away — for tests, and for a re-baked heightfield. */
export function forgetIsland(): void {
  baked = null;
}

/** What the ground is called at a map point, for the legend. */
export function bandAtMap(wx: number, wz: number): string {
  return bandFor(terrainHeight(wx, wz));
}
