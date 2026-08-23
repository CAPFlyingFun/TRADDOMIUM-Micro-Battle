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
import { hydro } from '../world/water';
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
  drawWater(ink, step);
  baked = canvas;
  return canvas;
}

/**
 * HOW WIDE TO DRAW A RIVER: its real width, or the thinnest line that can
 * still be seen, whichever is larger.
 *
 * TO SCALE WHEREVER SCALE IS LEGIBLE, and that is the whole design. On
 * the island map one pixel is 74 metres, so a median Kauaʻi stream of
 * 5.5 m is SEVEN HUNDREDTHS of a pixel and the widest river on the
 * island — the Moloaʻa at 36 m — is half of one. Drawn faithfully the
 * entire drainage is a barely-perceptible grey haze; measured, not
 * guessed — `npm run rivers:scale` renders it beside this one.
 *
 * So there is a floor, and the floor is Strahler stream order — how much
 * of the island drains through a reach — which is what a printed map
 * does and what a player choosing a spawn actually wants to know.
 *
 * But the floor is a MAXIMUM, not a substitute. Zoom in past about five
 * hundred units to the pixel and the true width overtakes it on its own:
 * a four-kilometre window draws the median stream at one pixel, a
 * four-hundred-metre window at ten, and by then it is the real river.
 * Nothing has to switch modes and no second code path exists to rot —
 * the same line is a symbol when it must be and a measurement when it
 * can be.
 *
 * The COURSE is always exact.
 */
const ORDER_FLOOR = [0, 0.6, 0.9, 1.3, 1.9, 2.6] as const;

export function riverInk(
  /** Full channel width there, world units. */
  width: number,
  /** Strahler order, 1 to 5. */
  order: number,
  /** How many world units one pixel covers. */
  perPixel: number,
): number {
  const real = width / perPixel;
  const floor = ORDER_FLOOR[Math.max(1, Math.min(5, Math.round(order)))];
  return Math.max(real, floor);
}

/**
 * The real rivers and lakes, over the real island.
 *
 * Silently absent before the hydrography lands — the island lab boots
 * without waiting for it.
 */
function drawWater(ink: CanvasRenderingContext2D, perPixel: number): void {
  const water = hydro();
  if (!water) return;

  ink.lineCap = 'round';
  ink.lineJoin = 'round';
  ink.strokeStyle = 'rgba(96, 168, 206, 0.92)';

  // ONE PATH PER WIDTH, not one per reach. A canvas line width applies
  // to a whole stroke, so 1,121 separately-sized reaches would be 1,121
  // state changes and strokes; bucketing to a tenth of a pixel collapses
  // that to a handful at island scale and still resolves every real
  // width when zoomed. A reach's own widths vary little — 711 of the
  // 1,121 carry a single value end to end — so its widest point stands
  // for it.
  const runs = new Map<number, (typeof water.rivers)[number][]>();
  for (const river of water.rivers) {
    let widest = 0;
    for (let i = 0; i < river.count; i++) {
      const w = water.width[river.first + i];
      if (w > widest) widest = w;
    }
    const key = Math.round(riverInk(widest, river.order, perPixel) * 10) / 10;
    const run = runs.get(key);
    if (run) run.push(river); else runs.set(key, [river]);
  }

  // Thin first, so a tributary never paints over the trunk it feeds.
  for (const key of [...runs.keys()].sort((a, b) => a - b)) {
    ink.beginPath();
    for (const river of runs.get(key)!) {
      for (let i = 0; i < river.count; i++) {
        const at = river.first + i;
        const { x, y } = worldToMap(water.x[at], water.z[at]);
        if (i === 0) ink.moveTo(x, y); else ink.lineTo(x, y);
      }
    }
    ink.lineWidth = key;
    ink.stroke();
  }

  // Lakes and reservoirs. These ARE to scale — a ring is a real polygon
  // and gets filled as one — but most of the hundred and eleven are
  // plantation reservoirs a pixel or two across, so they take a stroke
  // as well or they vanish into a single pale dot.
  ink.fillStyle = 'rgba(74, 148, 190, 0.95)';
  ink.lineWidth = 1.1;
  ink.beginPath();
  for (const lake of water.lakes) {
    for (const ring of lake.rings) {
      for (let i = 0; i < ring.count; i++) {
        const at = ring.first + i;
        const { x, y } = worldToMap(water.ringX[at], water.ringZ[at]);
        if (i === 0) ink.moveTo(x, y); else ink.lineTo(x, y);
      }
      ink.closePath();
    }
  }
  ink.fill('evenodd');
  ink.stroke();
}

/** Throw the bake away — for tests, and for a re-baked heightfield. */
export function forgetIsland(): void {
  baked = null;
}

/** What the ground is called at a map point, for the legend. */
export function bandAtMap(wx: number, wz: number): string {
  return bandFor(terrainHeight(wx, wz));
}
