/**
 * STREAMED TERRAIN — a window of ground that follows her.
 *
 * The island is 5,600,000 units across now, which is not a mesh. It is
 * not eight sections either: eight sections of that would be 700,000
 * units each, and a single vertex would be further from its neighbour
 * than the ant can see in a day.
 *
 * So the ground is CELLS, built around her and thrown away behind her.
 * A small grid, fine in the middle and coarse at the edges, plus one
 * whole-island backdrop far away so the mountains still exist.
 *
 * CELL GEOMETRY IS LOCAL. Vertices run from 0 to CELL_SPAN inside the
 * cell and the mesh is POSITIONED at the cell's corner. That is not a
 * tidiness choice: it means a rebase moves meshes rather than rebuilding
 * them, and it keeps every number the GPU sees small — see origin.ts for
 * why a coordinate of five million cannot be drawn.
 *
 * The cell lattice is a multiple of NEAR_STEP everywhere, so every
 * cell's vertex grid is in phase with every other and with the global
 * lattice `groundHeight` reads. That is what lets her stand on the
 * triangle that is drawn without knowing which cell she is over.
 *
 * CELLS ARE ADDRESSED GLOBALLY. A chunk's identity comes from world
 * coordinates alone (coords.ts), so moving the floating origin cannot
 * change which ground belongs where. The same chunk id generates the
 * same terrain on any device, after any reload, at any origin — which
 * is the property that lets a nest built here still be here tomorrow.
 */
import * as THREE from 'three';
import {
  CELL_VERTS, CELLS, COARSE_VERTS, FINE_CELLS, groundDetail,
  ISLAND_SPAN, terrainHeight,
} from './heightfield';
import {
  chunkAt, chunkKey, chunkOrigin, CHUNK_SPAN, sameChunk, world,
  type ChunkId, type WorldPoint,
} from './coords';
import { toLocal } from './origin';

const SOIL_TINT = new THREE.Color(1.22, 0.98, 0.72);

/**
 * THREE DISTANCE TIERS, and each draws only where it is the best one.
 *
 * The island is the same island at every tier; they differ only in how
 * finely it is cut. Drawn together they overlap and the coarse surface
 * pokes through the fine one — which is exactly what "there are two
 * terrains, I flew through one and landed on the other" is. So each
 * tier discards fragments nearer than the tier inside it (see
 * terrainMaterial's nearCut).
 *
 *   CELLS     out to  2,304 units    8 or 32 units a vertex
 *   MIDDLE    out to  200,000        3,125 units a vertex
 *   BACKDROP  the whole island       43,750 units a vertex
 *
 * The middle tier exists because the step from the streamed window to
 * the whole island was a factor of nineteen in resolution, and a join
 * that violent reads as a wall however much fog is thrown at it.
 */
const CELL_REACH = ((CELLS - 1) / 2) * CHUNK_SPAN;

/** Half-width of the middle tier — two kilometres of ground. */
const MIDDLE_REACH = 200_000;
const MIDDLE_VERTS = 129;
/** It follows her, snapped, so its vertices never crawl as she moves. */
const MIDDLE_STEP = (MIDDLE_REACH * 2) / (MIDDLE_VERTS - 1);

/** Vertices a side for the distant whole-island backdrop. */
const BACKDROP_VERTS = 129;

interface Cell {
  /** The GLOBAL address. Never a rendered position. */
  readonly id: ChunkId;
  readonly mesh: THREE.Mesh;
  fine: boolean;
}

/**
 * One patch of ground, in CELL-LOCAL coordinates.
 *
 * Heights are sampled on a grid one ring wider than the patch so every
 * vertex has neighbours on all sides, which is what lets the normals be
 * exact at the cell's edges and the seams disappear.
 */
export function buildCell(
  at: WorldPoint, span: number, verts: number,
): THREE.BufferGeometry {
  const worldX = at.wx;
  const worldZ = at.wz;
  const quads = verts - 1;
  const step = span / quads;
  const wide = verts + 2;

  const heights = new Float32Array(wide * wide);
  for (let r = 0; r < wide; r++) {
    for (let c = 0; c < wide; c++) {
      heights[r * wide + c] = terrainHeight(
        worldX + (c - 1) * step, worldZ + (r - 1) * step,
      );
    }
  }

  const count = verts * verts;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tint = new THREE.Color();

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const i = iz * verts + ix;
      const at = (c: number, r: number) => heights[r * wide + c];
      const h = at(ix + 1, iz + 1);

      // LOCAL, deliberately. The mesh carries the world offset.
      positions[i * 3] = ix * step;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = iz * step;

      const dhdx = (at(ix + 2, iz + 1) - at(ix, iz + 1)) / (2 * step);
      const dhdz = (at(ix + 1, iz + 2) - at(ix + 1, iz)) / (2 * step);
      const len = Math.hypot(dhdx, 1, dhdz);
      normals[i * 3] = -dhdx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = -dhdz / len;

      // Shading only — what the ground IS comes from the band textures
      // in terrainMaterial.ts, which this multiplies.
      const slope = Math.hypot(dhdx, dhdz);
      tint.setRGB(1, 1, 1);
      if (h > 0) tint.lerp(SOIL_TINT, Math.min(0.6, slope * 0.55));
      tint.multiplyScalar(1 + groundDetail(worldX + ix * step, worldZ + iz * step) * 0.11);
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
  }

  const indices = new Uint32Array(quads * quads * 6);
  let n = 0;
  for (let iz = 0; iz < quads; iz++) {
    for (let ix = 0; ix < quads; ix++) {
      const tl = iz * verts + ix;
      const tr = tl + 1;
      const bl = tl + verts;
      const br = bl + 1;
      indices[n++] = tl; indices[n++] = bl; indices[n++] = tr;
      indices[n++] = tr; indices[n++] = bl; indices[n++] = br;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** How far each tier reaches, for the tier outside it to cut against. */
/**
 * Just inside the tier it replaces, so the seam is a thin overlap
 * rather than a gap. A gap shows sky through the ground; an overlap of
 * a couple of percent, at two thousand units, shows nothing.
 */
export const TIER_CUTS = {
  middle: CELL_REACH * 0.97,
  backdrop: MIDDLE_REACH * 0.97,
};

export class TerrainStream {
  private readonly cells = new Map<string, Cell>();
  private readonly backdrop: THREE.Mesh;
  private readonly middle: THREE.Mesh;
  /** Where the middle tier is currently cut, in world units. */
  private middleAt: WorldPoint | null = null;
  /** The chunk she was in last time, so the window only moves when she does. */
  private at: ChunkId | null = null;
  private relief = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly material: THREE.Material,
    middleMaterial: THREE.Material,
    backdropMaterial: THREE.Material,
  ) {
    this.middle = new THREE.Mesh(
      buildCell(world(-MIDDLE_REACH, -MIDDLE_REACH), MIDDLE_REACH * 2, MIDDLE_VERTS),
      middleMaterial,
    );
    this.middle.frustumCulled = false;
    scene.add(this.middle);
    // The whole island, once, coarsely, far away. At true scale she can
    // physically see a few metres of ground — but a game where the
    // island exists only as fog is a worse game than one where the
    // mountains are visible and merely very small.
    this.backdrop = new THREE.Mesh(
      buildCell(world(-ISLAND_SPAN / 2, -ISLAND_SPAN / 2), ISLAND_SPAN, BACKDROP_VERTS),
      backdropMaterial,
    );
    this.backdrop.frustumCulled = false;
    scene.add(this.backdrop);
  }

  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Bring the window to her, building what has come into view and
   * dropping what has left it.
   */
  follow(at: WorldPoint): void {
    const here = chunkAt(at);
    if (this.at && sameChunk(here, this.at)) {
      this.place();
      return;
    }
    this.at = here;
    this.recutMiddle(at);

    const reach = (CELLS - 1) / 2;
    const fine = (FINE_CELLS - 1) / 2;
    const wanted = new Set<string>();
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const id: ChunkId = { cx: here.cx + dx, cz: here.cz + dz };
        const key = chunkKey(id);
        wanted.add(key);
        const detailed = Math.abs(dx) <= fine && Math.abs(dz) <= fine;
        const had = this.cells.get(key);
        if (had && had.fine === detailed) continue;
        if (had) {
          // Same ground, different cut: swap the geometry rather than
          // the whole mesh so nothing flickers out and back.
          had.mesh.geometry.dispose();
          had.mesh.geometry = this.cut(id, detailed);
          had.fine = detailed;
          continue;
        }
        const mesh = new THREE.Mesh(this.cut(id, detailed), this.material);
        mesh.scale.y = this.relief;
        this.scene.add(mesh);
        this.cells.set(key, { id, mesh, fine: detailed });
      }
    }

    for (const [key, cell] of this.cells) {
      if (wanted.has(key)) continue;
      this.scene.remove(cell.mesh);
      cell.mesh.geometry.dispose();
      this.cells.delete(key);
    }
    this.place();
  }

  /**
   * Re-seat every mesh against the current origin.
   *
   * The only place a cell's rendered position is computed, and it is
   * computed FROM its global address every time rather than stored.
   * There is no local position to go stale.
   */
  place(): void {
    for (const cell of this.cells.values()) {
      const seat = toLocal(chunkOrigin(cell.id));
      cell.mesh.position.set(seat.lx, 0, seat.lz);
    }
    const far = toLocal(world(-ISLAND_SPAN / 2, -ISLAND_SPAN / 2));
    this.backdrop.position.set(far.lx, 0, far.lz);
    if (this.middleAt) {
      const mid = toLocal(this.middleAt);
      this.middle.position.set(mid.lx, 0, mid.lz);
    }
  }

  /**
   * Re-cut the middle tier around her, SNAPPED to its own step.
   *
   * Snapped because its vertices are three thousand units apart: let it
   * follow her continuously and every vertex re-rounds every frame,
   * which is the whole distant landscape crawling as she walks. It only
   * needs re-cutting when she has left the step it was built for.
   */
  private recutMiddle(at: WorldPoint): void {
    const corner = world(
      Math.round((at.wx - MIDDLE_REACH) / MIDDLE_STEP) * MIDDLE_STEP,
      Math.round((at.wz - MIDDLE_REACH) / MIDDLE_STEP) * MIDDLE_STEP,
    );
    if (this.middleAt && this.middleAt.wx === corner.wx && this.middleAt.wz === corner.wz) {
      return;
    }
    this.middleAt = corner;
    this.middle.geometry.dispose();
    this.middle.geometry = buildCell(corner, MIDDLE_REACH * 2, MIDDLE_VERTS);
  }

  /** Vertical exaggeration, as a transform — see the terrain dials. */
  setRelief(times: number): void {
    this.relief = times;
    for (const cell of this.cells.values()) cell.mesh.scale.y = times;
    this.middle.scale.y = times;
    this.backdrop.scale.y = times;
  }

  /** Cut everything again — the smoothing dial moves the vertices. */
  rebuild(): void {
    for (const cell of this.cells.values()) {
      cell.mesh.geometry.dispose();
      cell.mesh.geometry = this.cut(cell.id, cell.fine);
    }
    this.backdrop.geometry.dispose();
    this.backdrop.geometry = buildCell(
      world(-ISLAND_SPAN / 2, -ISLAND_SPAN / 2), ISLAND_SPAN, BACKDROP_VERTS,
    );
    const held = this.middleAt;
    this.middleAt = null;
    if (held) this.recutMiddle(world(held.wx + MIDDLE_REACH, held.wz + MIDDLE_REACH));
  }

  dispose(): void {
    for (const cell of this.cells.values()) {
      this.scene.remove(cell.mesh);
      cell.mesh.geometry.dispose();
    }
    this.cells.clear();
    this.scene.remove(this.backdrop);
    this.backdrop.geometry.dispose();
    this.scene.remove(this.middle);
    this.middle.geometry.dispose();
  }

  private cut(id: ChunkId, fine: boolean): THREE.BufferGeometry {
    // Sampled at the chunk's WORLD corner, so the geometry is a pure
    // function of the global address and nothing else.
    return buildCell(chunkOrigin(id), CHUNK_SPAN, fine ? CELL_VERTS : COARSE_VERTS);
  }
}
