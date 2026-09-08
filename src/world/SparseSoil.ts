/**
 * Sparse, world-addressed excavation over an immutable survey.
 *
 * The saved deltas are subtractive capsule strokes, not render meshes. They
 * regenerate a 1 mm density lattice on demand. Queries interpolate that SAME
 * lattice; meshing or leaving the streaming window never changes the world.
 * Soil is positive, air negative. No water or rendering writer exists here.
 */
import { world, type WorldPoint } from './coords';
import {
  MAX_SOIL_STROKES, SOIL_CELL, SOIL_TILE, readSoilEdits, validSoilStroke,
  type SoilEditsSave, type SoilPoint, type SoilStroke,
} from './soilTypes';

export interface SoilSurvey { heightAt(at: WorldPoint): number }
export interface SoilTile {
  readonly tx: number;
  readonly tz: number;
  readonly revision: number;
  /** Lowest edit, including meshing padding. Infinity for an unedited tile. */
  readonly minHeight: number;
}
interface Column { strokes: SoilStroke[]; revision: number; minHeight: number }
const DIGGERS = new Set(['burrower', 'player-ant', 'colony-ant', 'construction-tool']);
const CELLS = Math.round(SOIL_TILE / SOIL_CELL);
const key = (x: number, z: number): string => `${x},${z}`;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const band = (d: number): number => Math.max(-SOIL_CELL, Math.min(SOIL_CELL, d));

/** Signed distance to the air capsule: positive outside, negative inside. */
export function strokeDistance(s: SoilStroke, x: number, y: number, z: number): number {
  const dx = s[3] - s[0], dy = s[4] - s[1], dz = s[5] - s[2];
  const length2 = dx * dx + dy * dy + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - s[0]) * dx + (y - s[1]) * dy + (z - s[2]) * dz) / length2));
  return Math.hypot(x - s[0] - t * dx, y - s[1] - t * dy, z - s[2] - t * dz) - s[6];
}

export class SparseSoil {
  private readonly strokes: SoilStroke[] = [];
  private readonly columns = new Map<string, Column>();
  private serial = 0;

  constructor(readonly survey: SoilSurvey, saved?: unknown) {
    const valid = readSoilEdits(saved);
    if (valid) for (const stroke of valid.strokes) this.record(stroke);
  }

  get revision(): number { return this.serial; }
  get strokeCount(): number { return this.strokes.length; }
  get atLimit(): boolean { return this.strokeCount >= MAX_SOIL_STROKES; }

  snapshot(): SoilEditsSave {
    return { version: 1, strokes: this.strokes.map(s => [...s] as unknown as SoilStroke) };
  }

  /** Only explicitly granted actors can submit a cut; all consumers just read. */
  dig(actor: string, from: SoilPoint, to: SoilPoint, radius: number): boolean {
    if (!DIGGERS.has(actor) || this.atLimit) return false;
    // A micron in world space is ample for a millimetre lattice. Bounded
    // decimal precision also keeps three solo documents comfortably small.
    const q = (n: number): number => Math.round(n * 10_000) / 10_000;
    const stroke: SoilStroke = [q(from.at.wx), q(from.height), q(from.at.wz),
      q(to.at.wx), q(to.height), q(to.at.wz), q(radius)];
    if (!validSoilStroke(stroke) || !this.changesSamples(stroke)) return false;
    this.record(stroke);
    return true;
  }

  /** An integer global lattice address, used directly by meshers. */
  sample(gx: number, gy: number, gz: number, groundHeight?: number): number {
    const x = gx * SOIL_CELL, y = gy * SOIL_CELL, z = gz * SOIL_CELL;
    let density = (groundHeight ?? this.survey.heightAt(world(x, z))) - y;
    const column = this.columns.get(key(Math.floor(gx / CELLS), Math.floor(gz / CELLS)));
    if (column) for (const s of column.strokes) density = Math.min(density, strokeDistance(s, x, y, z));
    return density;
  }

  /** Interpolated density of the lattice used for the visible soil. */
  densityAt(at: WorldPoint, height: number): number {
    const x = at.wx / SOIL_CELL, y = height / SOIL_CELL, z = at.wz / SOIL_CELL;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const tx = x - ix, ty = y - iy, tz = z - iz;
    const a = lerp(this.sample(ix, iy, iz), this.sample(ix + 1, iy, iz), tx);
    const b = lerp(this.sample(ix, iy + 1, iz), this.sample(ix + 1, iy + 1, iz), tx);
    const c = lerp(this.sample(ix, iy, iz + 1), this.sample(ix + 1, iy, iz + 1), tx);
    const d = lerp(this.sample(ix, iy + 1, iz + 1), this.sample(ix + 1, iy + 1, iz + 1), tx);
    return lerp(lerp(a, b, ty), lerp(c, d, ty), tz);
  }

  solidAt(at: WorldPoint, height: number): boolean { return this.densityAt(at, height) > 0; }

  /**
   * First solid ground from above. Water can read a surface opening through
   * this function, but a sealed tunnel still has its roof. This is not a
   * three-dimensional cave-fluid solver and grants no editing capability.
   */
  surfaceAt(at: WorldPoint): number {
    const top = this.survey.heightAt(at);
    const column = this.columns.get(key(Math.floor(at.wx / SOIL_TILE), Math.floor(at.wz / SOIL_TILE)));
    if (!column || this.densityAt(at, top - SOIL_CELL * .001) >= 0) return top;
    let air = top;
    for (let y = top - SOIL_CELL; y >= column.minHeight - SOIL_CELL; y -= SOIL_CELL) {
      if (this.densityAt(at, y) > 0) {
        let solid = y;
        for (let i = 0; i < 12; i++) {
          const middle = (air + solid) / 2;
          if (this.densityAt(at, middle) > 0) solid = middle; else air = middle;
        }
        return (air + solid) / 2;
      }
      air = y;
    }
    return top;
  }

  tile(tx: number, tz: number): SoilTile {
    const c = this.columns.get(key(tx, tz));
    return { tx, tz, revision: c?.revision ?? 0, minHeight: c?.minHeight ?? Infinity };
  }

  /** Edited columns only, nearest first. A render budget never evicts saved soil. */
  tilesNear(at: WorldPoint, radius: number): SoilTile[] {
    const tiles: SoilTile[] = [];
    const x0 = Math.floor((at.wx - radius) / SOIL_TILE), x1 = Math.floor((at.wx + radius) / SOIL_TILE);
    const z0 = Math.floor((at.wz - radius) / SOIL_TILE), z1 = Math.floor((at.wz + radius) / SOIL_TILE);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const tile = this.tile(tx, tz);
      if (tile.revision > 0) tiles.push(tile);
    }
    const d = (t: SoilTile): number => ((t.tx + .5) * SOIL_TILE - at.wx) ** 2 + ((t.tz + .5) * SOIL_TILE - at.wz) ** 2;
    return tiles.sort((a, b) => d(a) - d(b));
  }

  private record(stroke: SoilStroke): void {
    this.strokes.push(stroke);
    this.serial++;
    const pad = stroke[6] + SOIL_CELL * 2;
    const x0 = Math.floor((Math.min(stroke[0], stroke[3]) - pad) / SOIL_TILE);
    const x1 = Math.floor((Math.max(stroke[0], stroke[3]) + pad) / SOIL_TILE);
    const z0 = Math.floor((Math.min(stroke[2], stroke[5]) - pad) / SOIL_TILE);
    const z1 = Math.floor((Math.max(stroke[2], stroke[5]) + pad) / SOIL_TILE);
    const bottom = Math.min(stroke[1], stroke[4]) - pad;
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      const k = key(tx, tz);
      let column = this.columns.get(k);
      if (!column) { column = { strokes: [], revision: 0, minHeight: bottom }; this.columns.set(k, column); }
      column.strokes.push(stroke);
      column.revision = this.serial;
      column.minHeight = Math.min(column.minHeight, bottom);
    }
  }

  /** Compare the surface band, so air-only and already removed volumes do not fill a save. */
  private changesSamples(s: SoilStroke): boolean {
    const pad = s[6] + SOIL_CELL;
    const x0 = Math.floor((Math.min(s[0], s[3]) - pad) / SOIL_CELL);
    const x1 = Math.ceil((Math.max(s[0], s[3]) + pad) / SOIL_CELL);
    const y0 = Math.floor((Math.min(s[1], s[4]) - pad) / SOIL_CELL);
    const y1 = Math.ceil((Math.max(s[1], s[4]) + pad) / SOIL_CELL);
    const z0 = Math.floor((Math.min(s[2], s[5]) - pad) / SOIL_CELL);
    const z1 = Math.ceil((Math.max(s[2], s[5]) + pad) / SOIL_CELL);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const cut = strokeDistance(s, gx * SOIL_CELL, gy * SOIL_CELL, gz * SOIL_CELL);
      if (cut >= SOIL_CELL) continue;
      const was = this.sample(gx, gy, gz);
      if (band(Math.min(was, cut)) < band(was) - 1e-7) return true;
    }
    return false;
  }
}
