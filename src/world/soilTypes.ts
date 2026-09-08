/** Portable local soil deltas. World units are cm; no rendering or storage APIs. */
import { ISLAND_SPAN, world, type WorldPoint } from './coords';

export interface SoilPoint { readonly at: WorldPoint; readonly height: number }
/** Capsule endpoints x/y/z, then radius, all in world centimetres. */
export type SoilStroke = readonly [number, number, number, number, number, number, number];
export interface SoilEditsSave { readonly version: 1; readonly strokes: readonly SoilStroke[] }
export const SOIL_CELL = 0.1;
export const SOIL_TILE = 3.2;
export const MAX_SOIL_STROKES = 8192;
export const MAX_SOIL_RADIUS = 2;
export const MAX_SOIL_SWEEP = 8;

export function validSoilStroke(raw: unknown): raw is SoilStroke {
  if (!Array.isArray(raw) || raw.length !== 7 || !raw.every(n => typeof n === 'number' && Number.isFinite(n))) return false;
  const [x, y, z, ex, ey, ez, r] = raw as number[];
  return Math.abs(x) <= ISLAND_SPAN / 2 && Math.abs(z) <= ISLAND_SPAN / 2
    && Math.abs(ex) <= ISLAND_SPAN / 2 && Math.abs(ez) <= ISLAND_SPAN / 2
    && Math.abs(y) <= ISLAND_SPAN && Math.abs(ey) <= ISLAND_SPAN
    && r >= SOIL_CELL && r <= MAX_SOIL_RADIUS
    && Math.hypot(ex - x, ey - y, ez - z) <= MAX_SOIL_SWEEP;
}

/** Reject an invalid document as a whole; never load only half a tunnel. */
export function readSoilEdits(raw: unknown): SoilEditsSave | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.strokes) || r.strokes.length > MAX_SOIL_STROKES
    || !r.strokes.every(validSoilStroke)) return undefined;
  return { version: 1, strokes: r.strokes.map(s => [...s] as unknown as SoilStroke) };
}

/** World-addressed soil columns; renderers use these instead of unpacking world coordinates. */
export function soilTileAt(at: WorldPoint): { tx: number; tz: number } {
  return { tx: Math.floor(at.wx / SOIL_TILE), tz: Math.floor(at.wz / SOIL_TILE) };
}
export function soilTileCentre(tile: { tx: number; tz: number }): WorldPoint {
  return world((tile.tx + .5) * SOIL_TILE, (tile.tz + .5) * SOIL_TILE);
}
