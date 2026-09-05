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
import { ISLAND_HALF_SPAN, COARSE_STEP, HD_STEP, HD_TILES_ACROSS, HD_TILE_SAMPLES, hdTileName, heightOf, type DemGrid, type HdTileId } from './dem';
import { countHoles } from './demRepair';
import type { WorldPoint } from './coords';

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
  /**
   * The 64 tile slots, flat and indexed by `row * 8 + col`.
   *
   * A Map keyed by name was the obvious thing and it cost a two-character
   * STRING BUILD on every height read — and a ring refill is 21,000 of
   * them. The grid is 8 x 8 and fixed by the survey, so an array indexed
   * by arithmetic answers the same question with no allocation at all.
   */
  private readonly tiles: (DemGrid | null)[] = new Array(HD_TILES_ACROSS * HD_TILES_ACROSS).fill(null);

  /**
   * Bumped whenever the ground itself changes — a tile arriving or being
   * evicted.
   *
   * WHY IT EXISTS: a renderer caches what it read. `TerrainView` fills a
   * ring once and then only refills it when the ring MOVES, which is
   * correct while the field is immutable and silently wrong the moment a
   * streamed tile lands: the mesh keeps drawing coarse heights under a
   * camera that is standing still, and the streaming does nothing at all
   * until the player happens to travel far enough. One counter, compared
   * per frame, is what lets a cache know it is stale without this class
   * knowing anything about who is caching.
   */
  private rev = 0;

  /** Throws unless the coarse grid has been through `demRepair`. */
  constructor(coarse: DemGrid) {
    assertRepaired(coarse, 'the coarse grid');
    this.coarse = coarse;
  }

  /** The ground's revision. Changes only when a tile arrives or leaves. */
  revision(): number {
    return this.rev;
  }

  /** Make a high-detail tile resident. Throws unless it has been through `demRepair`. */
  addTile(id: HdTileId, grid: DemGrid): void {
    if (grid.side !== HD_TILE_SAMPLES) {
      throw new Error(`heightfield: tile ${hdTileName(id)} must be ${HD_TILE_SAMPLES} samples a side, got ${grid.side}`);
    }
    assertRepaired(grid, `tile ${hdTileName(id)}`);
    const slot = slotOf(id.col, id.row);
    if (slot < 0) throw new Error(`heightfield: ${hdTileName(id)} is not a tile of this survey`);
    this.tiles[slot] = grid;
    this.rev += 1;
  }

  hasTile(id: HdTileId): boolean {
    const slot = slotOf(id.col, id.row);
    return slot >= 0 && this.tiles[slot] !== null;
  }

  /** Evict a tile. The ground does not vanish — reads there fall back to the coarse lattice. */
  dropTile(id: HdTileId): boolean {
    const slot = slotOf(id.col, id.row);
    if (slot < 0 || this.tiles[slot] === null) return false;
    this.tiles[slot] = null;
    this.rev += 1;
    return true;
  }

  residentTiles(): string[] {
    const names: string[] = [];
    for (let row = 0; row < HD_TILES_ACROSS; row += 1) {
      for (let col = 0; col < HD_TILES_ACROSS; col += 1) {
        if (this.tiles[slotOf(col, row)] !== null) names.push(hdTileName({ col, row }));
      }
    }
    return names.sort();
  }

  /** How high the ground is, in world units. THE HOT PATH: no allocation, no string. */
  heightAt(at: WorldPoint): number {
    return this.read(at.wx, at.wz);
  }

  /**
   * The same read from bare numbers.
   *
   * Deliberately NOT exported. The public door takes a `WorldPoint` and
   * that is the seam this project exists to keep — but inside the class,
   * where both numbers demonstrably came from one, building a fresh
   * branded object per sample is 21,000 allocations a ring refill for no
   * safety at all.
   */
  private read(wx: number, wz: number): number {
    const hd = gridX(wx, HD_STEP);
    const hz = gridX(wz, HD_STEP);
    const span = HD_TILE_SAMPLES - 1;
    const col = clamp(Math.floor(hd / span), 0, HD_TILES_ACROSS - 1);
    const row = clamp(Math.floor(hz / span), 0, HD_TILES_ACROSS - 1);
    const grid = this.tiles[row * HD_TILES_ACROSS + col];
    if (grid) return bilinear(grid, clamp(hd - col * span, 0, span), clamp(hz - row * span, 0, span));
    return bilinear(this.coarse, gridX(wx, COARSE_STEP), gridX(wz, COARSE_STEP));
  }

  /** The same read, saying which lattice answered it. */
  sample(at: WorldPoint): HeightSample {
    return { height: this.read(at.wx, at.wz), detail: this.detailAt(at) };
  }

  /** Which lattice would answer a read here. */
  detailAt(at: WorldPoint): Detail {
    const span = HD_TILE_SAMPLES - 1;
    const col = clamp(Math.floor(gridX(at.wx, HD_STEP) / span), 0, HD_TILES_ACROSS - 1);
    const row = clamp(Math.floor(gridX(at.wz, HD_STEP) / span), 0, HD_TILES_ACROSS - 1);
    return this.tiles[row * HD_TILES_ACROSS + col] ? 'hd' : 'coarse';
  }

  /**
   * The surface normal, from the slope across one step of whatever
   * lattice answers there. Computed from the SAME data the mesh is built
   * from, so lighting and footing cannot disagree.
   */
  normalAt(at: WorldPoint): Normal {
    const step = this.detailAt(at) === 'hd' ? HD_STEP : COARSE_STEP;
    const east = this.read(at.wx + step, at.wz);
    const west = this.read(at.wx - step, at.wz);
    const south = this.read(at.wx, at.wz + step);
    const north = this.read(at.wx, at.wz - step);
    return normalOfGradient((west - east) / (2 * step), (north - south) / (2 * step));
  }

  /** Steepness in degrees from horizontal, 0 flat and 90 a wall. */
  slopeDegrees(at: WorldPoint): number {
    return slopeOfUp(this.normalAt(at).ny);
  }
}

/**
 * A normal from a gradient, and the slope from a normal's up component.
 *
 * Shared with the terrain renderer, which derives its vertex normals from
 * the heights it has ALREADY read rather than paying for four more reads
 * per vertex — the two must agree, so the arithmetic lives in one place.
 */
export function normalOfGradient(gx: number, gz: number): Normal {
  const length = Math.hypot(gx, 1, gz);
  return { nx: gx / length, ny: 1 / length, nz: gz / length };
}

export function slopeOfUp(ny: number): number {
  return Math.acos(Math.min(1, Math.max(-1, ny))) * (180 / Math.PI);
}

/** A tile's slot in the flat array, or -1 when it is not a tile of this survey. */
function slotOf(col: number, row: number): number {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return -1;
  if (col < 0 || row < 0 || col >= HD_TILES_ACROSS || row >= HD_TILES_ACROSS) return -1;
  return row * HD_TILES_ACROSS + col;
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
