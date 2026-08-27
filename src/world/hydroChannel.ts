/**
 * WORLD-SPACE CHANNEL MAP — the surveyed rivers, baked to a fixed grid.
 *
 * WHY THIS EXISTS. IslandWater ran D8 flow accumulation (drainage.ts,
 * `channels()`) on its 256 m window every time the window moved. D8 on a
 * finite MOVING window depends on where the window's edges fall — the
 * upstream area is truncated at the rim and the border is drained every
 * step — so the set of "watercourse" cells changed as the player flew
 * toward a river, and the channel network visibly shifted and rebuilt.
 * That is the "morphing water" bug.
 *
 * The cure is to stop deriving the channels per camera position and read
 * them from the survey ONCE. `bakeChannelMap()` rasterises the 1,121
 * surveyed river centrelines (hydro.ts / kauai-hydro.bin) into a fixed
 * world-space grid at load time. From then on IslandWater only LOOKS UP
 * membership at a world position — the answer is the same wherever the
 * window happens to be, so the channels are locked to the real Kauaʻi
 * hydrology instead of being re-invented each move.
 *
 * The terrain is not touched (CLAUDE.md, "the terrain is not ours to
 * move"): the trench depth returned here is applied only to the water
 * SIM BED — the solver's internal Float32Array — never to the heightmap,
 * the mesh, `terrainHeight` or `groundHeight`.
 */

import type { Hydro } from './hydro';

export interface ChannelCell {
  /** True if this cell is inside a surveyed river band. */
  isChannel: boolean;
  /** Half-width of the channel here, world units (cm). Used as the Gaussian sigma. */
  halfWidth: number;
  /** How deep to carve the sim bed at the centreline, world units (cm). */
  trenchDepth: number;
  /** Distance from this cell to the nearest centreline, world units (cm). */
  dist: number;
  /** Unit vector downstream — x component. */
  flowDx: number;
  /** Unit vector downstream — z component. */
  flowDz: number;
}

/** 1 m per cell — the same metre IslandWater's CELL uses. */
const GRID_STEP = 100;

/** Singleton baked channel map. Keys are "cx,cz" in channel-grid coords. */
let channelMap: Map<string, ChannelCell> | null = null;

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bake the surveyed river centrelines into the fixed world-space grid.
 * Call ONCE at startup with the decoded Hydro data. Safe to call again;
 * it rebuilds the map from scratch.
 */
export function bakeChannelMap(hydro: Hydro): void {
  channelMap = new Map();
  const map = channelMap;
  const { rivers, x, z, width } = hydro;

  for (const river of rivers) {
    const order = river.order; // Strahler 1..5
    // Scale width and trench depth by Strahler order. The user asked for
    // channels 20..300 cm wide (10..150 cm half-width) and 10..200 cm deep.
    const baseHalfWidth = clamp(10 + order * 28, 10, 150);
    const trenchDepth = clamp(10 + order * 38, 10, 200);

    const last = river.first + river.count - 1;
    for (let pi = river.first; pi < last; pi++) {
      const x0 = x[pi], z0 = z[pi];
      const x1 = x[pi + 1], z1 = z[pi + 1];
      // Surveyed width is a full width; halve it, and fall back to the
      // order-derived half-width when the survey has none.
      const w0 = clamp((width[pi] ? width[pi] * 0.5 : baseHalfWidth), 10, 150);
      const w1 = clamp((width[pi + 1] ? width[pi + 1] * 0.5 : baseHalfWidth), 10, 150);

      const segDx = x1 - x0, segDz = z1 - z0;
      const segLen = Math.sqrt(segDx * segDx + segDz * segDz);
      if (segLen < 1) continue;
      const ux = segDx / segLen, uz = segDz / segLen; // downstream unit vector
      const px = -uz, pz = ux;                        // perpendicular

      // Walk the segment finely enough that no grid cell is skipped.
      const steps = Math.ceil(segLen / (GRID_STEP * 0.5));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = x0 + segDx * t, cz = z0 + segDz * t;
        const hw = w0 + (w1 - w0) * t;
        // Mark a slab wide enough to hold the channel plus one cell of
        // shoulder either side, centred on the centreline.
        const slab = Math.ceil((hw + GRID_STEP) / GRID_STEP);
        for (let si = -slab; si <= slab; si++) {
          const wx = cx + px * si * GRID_STEP;
          const wz = cz + pz * si * GRID_STEP;
          const sx = Math.round(wx / GRID_STEP);
          const sz = Math.round(wz / GRID_STEP);
          const key = `${sx},${sz}`;
          const dist = Math.abs(si * GRID_STEP);
          const prev = map.get(key);
          // Keep the reading from the NEAREST centreline: where two
          // reaches overlap the closer one owns the cell.
          if (!prev || dist < prev.dist) {
            map.set(key, {
              isChannel: dist <= hw,
              halfWidth: hw,
              trenchDepth,
              dist,
              flowDx: ux,
              flowDz: uz,
            });
          }
        }
      }
    }
  }
}

/** Whether the channel map has been baked yet. */
export function channelMapReady(): boolean {
  return channelMap !== null;
}

/** Query the baked map for a world position. Null if outside every band. */
export function channelAt(wx: number, wz: number): ChannelCell | null {
  if (!channelMap) return null;
  const key = `${Math.round(wx / GRID_STEP)},${Math.round(wz / GRID_STEP)}`;
  return channelMap.get(key) ?? null;
}

/** True if this world position is inside a surveyed river band. */
export function isChannelCell(wx: number, wz: number): boolean {
  return channelAt(wx, wz)?.isChannel ?? false;
}

/**
 * The Gaussian trough depth (world units) to remove from the SIM BED at
 * wx,wz. Deepest on the centreline, tapering to nothing at the band edge,
 * with a slight shoulder just outside so the bank is a slope and not a
 * cardboard wall — which is what the earlier vertical-walled beds were.
 */
export function bedCarveDepth(wx: number, wz: number): number {
  const cell = channelAt(wx, wz);
  if (!cell) return 0;
  const sigma = Math.max(GRID_STEP, cell.halfWidth);
  // Gaussian cross-section: full depth at the centre, easing outward.
  const g = Math.exp(-(cell.dist * cell.dist) / (2 * sigma * sigma));
  if (!cell.isChannel) {
    // Outer shoulder cell: a gentle lip, not a wall.
    return cell.trenchDepth * g * 0.35;
  }
  return cell.trenchDepth * g;
}

/** Downstream unit vector at a world position, or null outside a channel. */
export function flowDirAt(wx: number, wz: number): { dx: number; dz: number } | null {
  const cell = channelAt(wx, wz);
  if (!cell) return null;
  return { dx: cell.flowDx, dz: cell.flowDz };
}

/** Forget the baked map — for tests and for leaving the island. */
export function forgetChannelMap(): void {
  channelMap = null;
}
