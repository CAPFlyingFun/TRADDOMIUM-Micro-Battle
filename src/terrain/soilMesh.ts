/** A global 1 mm lattice, meshed in complete 3.2 cm columns into small GPU coordinates. */
import { world, type WorldPoint } from '../world/coords';
import type { SparseSoil } from '../world/SparseSoil';
import { SOIL_CELL, SOIL_TILE, type SoilPoint } from '../world/soilTypes';

export interface SoilMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly origin: SoilPoint;
}
/** Tile bounds of the inspection window; maxima are exclusive. */
export interface SoilCutWindow {
  readonly minTx: number;
  readonly maxTx: number;
  readonly minTz: number;
  readonly maxTz: number;
}
/** West/east/north/south edge bits: 1/2/4/8. Never affects saved density. */
export interface SoilMeshSeam {
  readonly edges: number;
  readonly drawnHeightAt: (at: WorldPoint) => number | null;
}
const CELLS = Math.round(SOIL_TILE / SOIL_CELL);
const SIDE = CELLS + 1;
const PLANE = SIDE * SIDE;
const MAX_VERTICAL_CELLS = 256;
// Freudenthal split: the same body diagonal and face diagonals in EVERY
// global cube. Adjacent columns consequently agree even at negative addresses.
const TETS = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7],
  [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];

/**
 * Null means the complete column would exceed the work bound: its base
 * terrain MUST remain visible. Cut depth is a read-only rendering lens.
 */
export function meshSoilTile(soil: SparseSoil, tx: number, tz: number, cutDepth = 0, window?: SoilCutWindow, seam?: SoilMeshSeam): SoilMeshData | null {
  const depth = Number.isFinite(cutDepth) ? Math.max(0, cutDepth) : 0;
  const gx0 = tx * CELLS, gz0 = tz * CELLS;
  const heights = new Float64Array(PLANE);
  const ceilings = new Float64Array(PLANE);
  const sealed = new Uint8Array(PLANE);
  let minCeiling = Infinity, maxCeiling = -Infinity;
  for (let z = 0; z <= CELLS; z++) for (let x = 0; x <= CELLS; x++) {
    const ground = soil.survey.heightAt(world((gx0 + x) * SOIL_CELL, (gz0 + z) * SOIL_CELL));
    if (!Number.isFinite(ground)) return null;
    heights[z * SIDE + x] = ground;
    // Preserve the surveyed outer edge; one lattice cell inward reaches
    // full cut depth. Both neighbors derive this rim from global indexes.
    const rim = window !== undefined && (gx0 + x === window.minTx * CELLS || gx0 + x === window.maxTx * CELLS
      || gz0 + z === window.minTz * CELLS || gz0 + z === window.maxTz * CELLS);
    const ceiling = ground - (rim ? 0 : depth);
    ceilings[z * SIDE + x] = ceiling;
    sealed[z * SIDE + x] = rim ? 1 : 0;
    minCeiling = Math.min(minCeiling, ceiling);
    maxCeiling = Math.max(maxCeiling, ceiling);
  }
  // Include both the deepest edit and the entire surface. Starting near
  // the tunnel alone would remove a sound roof when the base sheet clips.
  const bottom = Math.min(soil.tile(tx, tz).minHeight, minCeiling - SOIL_CELL * 2);
  const gy0 = Math.floor(bottom / SOIL_CELL) - 1;
  const gy1 = Math.ceil(maxCeiling / SOIL_CELL) + 1;
  const rows = gy1 - gy0;
  if (rows > MAX_VERTICAL_CELLS || rows < 1) return null;
  const origin = { at: world(gx0 * SOIL_CELL, gz0 * SOIL_CELL), height: gy0 * SOIL_CELL };
  // Two density planes suffice; no growing 3D voxel allocation per column.
  let low = new Float64Array(PLANE), high = new Float64Array(PLANE);
  const fill = (into: Float64Array, gy: number): void => {
    for (let z = 0; z <= CELLS; z++) for (let x = 0; x <= CELLS; x++) {
      const i = z * SIDE + x, ground = heights[i];
      // THE RIM IS SEALED. A lattice point on the window's rim line takes
      // the SURVEY's density only — ground minus height, no sparse edits —
      // so a tunnel that reaches the window's edge meets a wall of soil
      // there, at most one lattice cell thick, instead of a round mouth
      // opening onto the void under the coarse sheet (the far end of
      // shots/cutaway-along-tunnel.png). This is the CUTAWAY ending, not
      // the tunnel ending: the soil still holds the whole burrow, and
      // the scene keeps the window sized so the selected worm and its
      // recent burrow are inside it and the wall stands beyond them.
      // The rim's ceiling is already the ground, so this and the cut
      // agree there, and the sealed plane is one the neighbour tile
      // outside the window never meshes at all.
      into[i] = sealed[i] ? ceilings[i] - gy * SOIL_CELL
        : Math.min(soil.sample(gx0 + x, gy, gz0 + z, ground), ceilings[i] - gy * SOIL_CELL);
    }
  };
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const density = new Float64Array(8);
  const cube = CORNERS.map(() => new Float64Array(3));
  const points = Array.from({ length: 4 }, () => new Float64Array(3));
  const solid = new Int8Array(4), air = new Int8Array(4);
  let cellX = 0, cellZ = 0;
  const vertex = (p: Float64Array): void => {
    positions.push(p[0], p[1], p[2]);
    const fx = Math.max(0, Math.min(1, p[0] / SOIL_CELL - cellX));
    const fz = Math.max(0, Math.min(1, p[2] / SOIL_CELL - cellZ));
    const i = cellZ * SIDE + cellX;
    const front = heights[i] * (1 - fx) + heights[i + 1] * fx;
    const back = heights[i + SIDE] * (1 - fx) + heights[i + SIDE + 1] * fx;
    const ground = front * (1 - fz) + back * fz;
    const shade = Math.max(0, Math.min(1, (ground - origin.height - p[1]) / 4));
    // Linear albedo, never emissive: the scene lights determine visibility.
    colors.push(.32 - .225 * shade, .17 - .127 * shade, .078 - .06 * shade);
  };
  const triangle = (a: Float64Array, b: Float64Array, c: Float64Array, dx: number, dy: number, dz: number): void => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-14) return; // Isosurface through an exact lattice vertex.
    const flip = nx * dx + ny * dy + nz * dz < 0;
    const scale = (flip ? -1 : 1) / length;
    nx *= scale; ny *= scale; nz *= scale;
    vertex(a); vertex(flip ? c : b); vertex(flip ? b : c);
    for (let i = 0; i < 3; i++) normals.push(nx, ny, nz);
  };
  const crossing = (a: number, b: number, into: Float64Array): void => {
    const t = density[a] / (density[a] - density[b]);
    for (let axis = 0; axis < 3; axis++) into[axis] = cube[a][axis] + t * (cube[b][axis] - cube[a][axis]);
  };
  fill(low, gy0);
  for (let y = 0; y < rows; y++) {
    fill(high, gy0 + y + 1);
    for (cellZ = 0; cellZ < CELLS; cellZ++) for (cellX = 0; cellX < CELLS; cellX++) {
      let positives = 0;
      for (let i = 0; i < 8; i++) {
        const [cx, cy, cz] = CORNERS[i];
        density[i] = (cy ? high : low)[(cellZ + cz) * SIDE + cellX + cx];
        if (density[i] > 0) positives++;
      }
      if (positives === 0 || positives === 8) continue;
      for (let i = 0; i < 8; i++) {
        cube[i][0] = (cellX + CORNERS[i][0]) * SOIL_CELL;
        cube[i][1] = (y + CORNERS[i][1]) * SOIL_CELL;
        cube[i][2] = (cellZ + CORNERS[i][2]) * SOIL_CELL;
      }
      for (const tet of TETS) {
        let ns = 0, na = 0;
        for (const i of tet) { if (density[i] > 0) solid[ns++] = i; else air[na++] = i; }
        if (ns === 0 || na === 0) continue;
        // From a solid vertex to an air vertex crosses the plane in the
        // outward direction; use it to orient the geometric face normal.
        const dx = cube[air[0]][0] - cube[solid[0]][0];
        const dy = cube[air[0]][1] - cube[solid[0]][1];
        const dz = cube[air[0]][2] - cube[solid[0]][2];
        if (ns === 1 || na === 1) {
          const one = ns === 1 ? solid[0] : air[0];
          const many = ns === 1 ? air : solid;
          for (let i = 0; i < 3; i++) crossing(one, many[i], points[i]);
          triangle(points[0], points[1], points[2], dx, dy, dz);
        } else {
          crossing(solid[0], air[0], points[0]); crossing(solid[0], air[1], points[1]);
          crossing(solid[1], air[0], points[2]); crossing(solid[1], air[1], points[3]);
          triangle(points[0], points[1], points[2], dx, dy, dz);
          triangle(points[1], points[3], points[2], dx, dy, dz);
        }
      }
    }
    const reuse = low; low = high; high = reuse;
  }
  if (seam?.edges) {
    // Append only: every original density triangle remains untouched. The
    // upper envelope of actual boundary edges also handles a surface opening
    // without connecting a buried cavity roof or floor up through solid soil.
    const originalLength = positions.length;
    interface EdgeSegment { lo: number; hi: number; a: number; b: number }
    const heightOn = (s: EdgeSegment, t: number): number => s.a + (s.b - s.a) * (t - s.lo) / (s.hi - s.lo);
    for (let side = 0; side < 4; side++) {
      if (!(seam.edges & (1 << side))) continue;
      const axis = side < 2 ? 0 : 2, along = side < 2 ? 2 : 0;
      const boundary = side % 2 ? SOIL_TILE : 0;
      const outward = side % 2 ? 1 : -1;
      const events: { at: number; segment: EdgeSegment; start: boolean }[] = [];
      for (let i = 0; i < originalLength; i += 9) for (let e = 0; e < 3; e++) {
        let a = i + e * 3, b = i + ((e + 1) % 3) * 3;
        if (Math.abs(positions[a + axis] - boundary) > 1e-9 || Math.abs(positions[b + axis] - boundary) > 1e-9) continue;
        if (positions[a + along] > positions[b + along]) { const swap = a; a = b; b = swap; }
        const lo = positions[a + along], hi = positions[b + along];
        if (hi - lo < 1e-9) continue;
        const segment = { lo, hi, a: positions[a + 1], b: positions[b + 1] };
        events.push({ at: lo, segment, start: true }, { at: hi, segment, start: false });
      }
      events.sort((a, b) => a.at - b.at);
      const active = new Set<EdgeSegment>();
      const coarse = new Map<number, number>();
      const point = (t: number, y: number): Float64Array => {
        const p = new Float64Array(3); p[axis] = boundary; p[along] = t; p[1] = y; return p;
      };
      const coarseAt = (t: number): number => {
        const cached = coarse.get(t);
        if (cached !== undefined) return cached;
        const p = point(t, 0);
        const read = seam.drawnHeightAt(world(gx0 * SOIL_CELL + p[0], gz0 * SOIL_CELL + p[2]));
        // Before a coarse ring is ready, preserve a surveyed seam. Its
        // unknown height is never replaced by an invented constant.
        const u = Math.max(0, Math.min(CELLS, t / SOIL_CELL));
        const index = Math.min(CELLS - 1, Math.floor(u)), f = u - index;
        const indexAt = (n: number): number => axis === 0 ? n * SIDE + (side % 2 ? CELLS : 0) : (side % 2 ? CELLS : 0) * SIDE + n;
        const survey = heights[indexAt(index)] * (1 - f) + heights[indexAt(index + 1)] * f;
        const height = (read !== null && Number.isFinite(read) ? read : survey) - origin.height;
        coarse.set(t, height); return height;
      };
      for (let event = 0; event < events.length;) {
        const lo = events[event].at;
        do {
          const e = events[event++];
          if (e.start) active.add(e.segment); else active.delete(e.segment);
        } while (event < events.length && events[event].at - lo < 1e-9);
        if (event === events.length || active.size === 0) continue;
        const hi = events[event].at, middle = (lo + hi) / 2;
        if (hi - lo < 1e-9) continue;
        let upper: EdgeSegment | undefined, highest = -Infinity;
        for (const candidate of active) {
          const height = heightOn(candidate, middle);
          if (height > highest) { highest = height; upper = candidate; }
        }
        if (!upper) continue;
        const a = point(lo, heightOn(upper, lo)), b = point(hi, heightOn(upper, hi));
        const c = point(lo, coarseAt(lo)), d = point(hi, coarseAt(hi));
        const da = c[1] - a[1], db = d[1] - b[1];
        // Use the adjacent survey cell for the bridge's natural depth albedo.
        cellX = Math.max(0, Math.min(CELLS - 1, Math.floor((a[0] + b[0]) / (2 * SOIL_CELL))));
        cellZ = Math.max(0, Math.min(CELLS - 1, Math.floor((a[2] + b[2]) / (2 * SOIL_CELL))));
        const dx = axis === 0 ? outward : 0, dz = axis === 2 ? outward : 0;
        if (da * db < 0) {
          // Coarse and soil lines can cross. Split there to avoid a folded
          // strip drawing beyond either surface on opposite residual signs.
          const t = da / (da - db), crossing = point(lo + (hi - lo) * t, a[1] + (b[1] - a[1]) * t);
          triangle(a, crossing, c, dx, 0, dz); triangle(crossing, b, d, dx, 0, dz);
        } else {
          triangle(a, b, c, dx, 0, dz); triangle(b, d, c, dx, 0, dz);
        }
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), origin };
}
