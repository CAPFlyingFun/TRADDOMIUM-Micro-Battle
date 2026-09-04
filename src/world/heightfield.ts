/**
 * THE GROUND TRUTH: how high the island is at a place, asked with a
 * `WorldPoint` and answered in world units.
 *
 * This is the seam v0 left unchecked. Its height API took two bare
 * numbers, so a RENDERED position went in where a world one belonged and
 * nothing stopped it — a camera clamped itself against its own local
 * position and sat two kilometres up a mountain, and three sibling bugs
 * arrived the same afternoon. Here the only door takes a `WorldPoint`,
 * which a `LocalPoint` cannot be passed as, so the mistake is a
 * compile error rather than an afternoon.
 *
 * ONE SURFACE, READ AT TWO RATES. The coarse grid covers the whole
 * island at 54.7 m a sample and is always resident; the high-detail
 * tiles cover it at 13.67 m and stream. A read uses the finest data
 * PRESENT at that place and says which it used, so the caller can tell
 * "the ground is flat here" from "the detail has not arrived yet".
 * Decimating the fine grid by four reproduces the coarse one exactly
 * (pinned in `tests/worldDem.test.ts`), so the two agree at every coarse
 * sample point and a tile arriving mid-flight cannot move ground the
 * player is standing on by more than the detail it adds.
 *
 * NOTHING HERE WRITES A HEIGHT, and it will not accept a grid that still
 * needs one written. `demRepair` runs first and this constructor REFUSES
 * an unrepaired grid, because a single NODATA corner does not read as an
 * error — it reads as a 3.2 km hole in the sea floor with the terrain
 * bilinearly funnelled into it. That refusal is what makes the transform
 * chain an order the code enforces rather than an order a comment asks
 * for.
 *
 * READS OFF THE ISLAND ARE CLAMPED TO ITS EDGE, not refused and not
 * invented. The survey covers 5,600,000 units and the world is that
 * survey; asking outside it is a normal thing for a camera frustum or a
 * mesh skirt to do, and the nearest real sample is the only honest
 * answer available.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core, so the
 * authority can stand an actor on the ground without a renderer.
 */
import { ISLAND_HALF_SPAN, COARSE_STEP, HD_STEP, HD_TILE_SAMPLES, hdTileKey, hdTileName, heightOf, type DemGrid, type HdTileId } from './dem';
import { countHoles } from './demRepair';
import { world, type WorldPoint } from './coords';

/** Mean sea level, in world units. The datum every stored sample is measured from. */
export const SEA_LEVEL = 0;

/** Which lattice answered a read. */
export type Detail = 'hd' | 'coarse';

export interface HeightSample {
  /** World units above mean sea level. */
  readonly height: number;
  readonly detail: Detail;
}

/** A unit up-vector, as three plain numbers. No three in core. */
export interface Normal {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
}

export class Heightfield {
  private readonly coarse: DemGrid;
  private readonly tiles = new Map<string, DemGrid>();

  /** Throws unless the coarse grid has been through `demRepair`. */
  constructor(coarse: DemGrid) {
    assertRepaired(coarse, 'the coarse grid');
    this.coarse = coarse;
  }

  /** Make a high-detail tile resident. Throws unless it has been through `demRepair`. */
  addTile(id: HdTileId, grid: DemGrid): void {
    if (grid.side !== HD_TILE_SAMPLES) {
      throw new Error(`heightfield: tile ${hdTileName(id)} must be ${HD_TILE_SAMPLES} samples a side, got ${grid.side}`);
    }
    assertRepaired(grid, `tile ${hdTileName(id)}`);
    this.tiles.set(hdTileKey(id), grid);
  }

  hasTile(id: HdTileId): boolean {
    return this.tiles.has(hdTileKey(id));
  }

  /** Evict a tile. The ground does not vanish — reads there fall back to the coarse lattice. */
  dropTile(id: HdTileId): boolean {
    return this.tiles.delete(hdTileKey(id));
  }

  residentTiles(): string[] {
    return [...this.tiles.keys()].sort();
  }

  /** How high the ground is, in world units. The hot path: no allocation. */
  heightAt(at: WorldPoint): number {
    const tile = this.tileFor(at);
    if (tile) return this.readTile(tile.grid, at);
    return bilinear(this.coarse, gridX(at.wx, COARSE_STEP), gridX(at.wz, COARSE_STEP));
  }

  /** The same read, saying which lattice answered it. */
  sample(at: WorldPoint): HeightSample {
    const tile = this.tileFor(at);
    if (tile) return { height: this.readTile(tile.grid, at), detail: 'hd' };
    return {
      height: bilinear(this.coarse, gridX(at.wx, COARSE_STEP), gridX(at.wz, COARSE_STEP)),
      detail: 'coarse',
    };
  }

  /**
   * The surface normal, from the slope across one step of whatever
   * lattice answers there. Computed from the SAME data the mesh is built
   * from, so lighting and footing cannot disagree.
   */
  normalAt(at: WorldPoint): Normal {
    const step = this.hasTile(hdTileOf(at)) ? HD_STEP : COARSE_STEP;
    const east = this.heightAt(world(at.wx + step, at.wz));
    const west = this.heightAt(world(at.wx - step, at.wz));
    const south = this.heightAt(world(at.wx, at.wz + step));
    const north = this.heightAt(world(at.wx, at.wz - step));
    // The gradient over a central difference; the normal is its negation, up.
    const nx = (west - east) / (2 * step);
    const nz = (north - south) / (2 * step);
    const length = Math.hypot(nx, 1, nz);
    return { nx: nx / length, ny: 1 / length, nz: nz / length };
  }

  /** Steepness in degrees from horizontal, 0 flat and 90 a wall. */
  slopeDegrees(at: WorldPoint): number {
    const { ny } = this.normalAt(at);
    return Math.acos(Math.min(1, Math.max(-1, ny))) * (180 / Math.PI);
  }

  private tileFor(at: WorldPoint): { id: HdTileId; grid: DemGrid } | null {
    const id = hdTileOf(at);
    const grid = this.tiles.get(hdTileKey(id));
    return grid ? { id, grid } : null;
  }

  /** A read inside one tile, in that tile's own sample coordinates. */
  private readTile(grid: DemGrid, at: WorldPoint): number {
    const id = hdTileOf(at);
    const span = HD_TILE_SAMPLES - 1;
    const col = clamp(gridX(at.wx, HD_STEP) - id.col * span, 0, span);
    const row = clamp(gridX(at.wz, HD_STEP) - id.row * span, 0, span);
    return bilinear(grid, col, row);
  }
}

/** Which tile a point falls in, clamped — the same rule `dem.hdTileAt` uses, on clamped input. */
function hdTileOf(at: WorldPoint): HdTileId {
  const span = HD_TILE_SAMPLES - 1;
  const col = Math.floor(gridX(at.wx, HD_STEP) / span);
  const row = Math.floor(gridX(at.wz, HD_STEP) / span);
  return { col: clamp(col, 0, 7), row: clamp(row, 0, 7) };
}

/**
 * A world axis as a fractional sample index, clamped to the survey.
 * The clamp is why a read off the island returns its edge rather than
 * NODATA: see the header.
 */
function gridX(w: number, step: number): number {
  const clamped = clamp(w, -ISLAND_HALF_SPAN, ISLAND_HALF_SPAN);
  return (clamped + ISLAND_HALF_SPAN) / step;
}

/**
 * Bilinear interpolation at a fractional grid position, in world units.
 * The four corners are clamped into the grid, so the closing edge reads
 * itself rather than falling off.
 */
function bilinear(grid: DemGrid, col: number, row: number): number {
  const last = grid.side - 1;
  const c0 = clamp(Math.floor(col), 0, last);
  const r0 = clamp(Math.floor(row), 0, last);
  const c1 = Math.min(c0 + 1, last);
  const r1 = Math.min(r0 + 1, last);
  const fc = clamp(col - c0, 0, 1);
  const fr = clamp(row - r0, 0, 1);
  const { samples, side } = grid;
  const nw = samples[r0 * side + c0];
  const ne = samples[r0 * side + c1];
  const sw = samples[r1 * side + c0];
  const se = samples[r1 * side + c1];
  const top = nw + (ne - nw) * fc;
  const bottom = sw + (se - sw) * fc;
  return heightOf(top + (bottom - top) * fr);
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function assertRepaired(grid: DemGrid, what: string): void {
  const holes = countHoles(grid);
  if (holes > 0) {
    throw new Error(
      `heightfield: ${what} still has ${holes} NODATA samples; run demRepair.repairGrid first `
      + '(an unrepaired sample reads as a 3.2 km hole, not as an error)',
    );
  }
}
