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
 */
import * as THREE from 'three';
import {
  CELL_SPAN, CELL_VERTS, CELLS, COARSE_VERTS, FINE_CELLS, groundDetail,
  ISLAND_SPAN, terrainHeight,
} from './heightfield';
import { localX, localZ } from './origin';

const SOIL_TINT = new THREE.Color(1.22, 0.98, 0.72);

/** Vertices a side for the distant whole-island backdrop. */
const BACKDROP_VERTS = 129;

interface Cell {
  readonly key: string;
  readonly cx: number;
  readonly cz: number;
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
  worldX: number, worldZ: number, span: number, verts: number,
): THREE.BufferGeometry {
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

export class TerrainStream {
  private readonly cells = new Map<string, Cell>();
  private readonly backdrop: THREE.Mesh;
  private atX = Number.NaN;
  private atZ = Number.NaN;
  private relief = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly material: THREE.Material,
  ) {
    // The whole island, once, coarsely, far away. At true scale she can
    // physically see a few metres of ground — but a game where the
    // island exists only as fog is a worse game than one where the
    // mountains are visible and merely very small.
    this.backdrop = new THREE.Mesh(
      buildCell(-ISLAND_SPAN / 2, -ISLAND_SPAN / 2, ISLAND_SPAN, BACKDROP_VERTS),
      material,
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
  follow(worldX: number, worldZ: number): void {
    const cx = Math.floor(worldX / CELL_SPAN);
    const cz = Math.floor(worldZ / CELL_SPAN);
    if (cx === this.atX && cz === this.atZ) {
      this.place();
      return;
    }
    this.atX = cx;
    this.atZ = cz;

    const reach = (CELLS - 1) / 2;
    const fine = (FINE_CELLS - 1) / 2;
    const wanted = new Set<string>();
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        wanted.add(key);
        const detailed = Math.abs(dx) <= fine && Math.abs(dz) <= fine;
        const had = this.cells.get(key);
        if (had && had.fine === detailed) continue;
        if (had) {
          // Same ground, different cut: swap the geometry rather than
          // the whole mesh so nothing flickers out and back.
          had.mesh.geometry.dispose();
          had.mesh.geometry = this.cut(cx + dx, cz + dz, detailed);
          had.fine = detailed;
          continue;
        }
        const mesh = new THREE.Mesh(this.cut(cx + dx, cz + dz, detailed), this.material);
        mesh.scale.y = this.relief;
        this.scene.add(mesh);
        this.cells.set(key, { key, cx: cx + dx, cz: cz + dz, mesh, fine: detailed });
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

  /** Re-seat every mesh against the current origin. */
  place(): void {
    for (const cell of this.cells.values()) {
      cell.mesh.position.set(
        localX(cell.cx * CELL_SPAN), 0, localZ(cell.cz * CELL_SPAN),
      );
    }
    this.backdrop.position.set(localX(-ISLAND_SPAN / 2), 0, localZ(-ISLAND_SPAN / 2));
  }

  /** Vertical exaggeration, as a transform — see the terrain dials. */
  setRelief(times: number): void {
    this.relief = times;
    for (const cell of this.cells.values()) cell.mesh.scale.y = times;
    this.backdrop.scale.y = times;
  }

  /** Cut everything again — the smoothing dial moves the vertices. */
  rebuild(): void {
    for (const cell of this.cells.values()) {
      cell.mesh.geometry.dispose();
      cell.mesh.geometry = this.cut(cell.cx, cell.cz, cell.fine);
    }
    this.backdrop.geometry.dispose();
    this.backdrop.geometry = buildCell(
      -ISLAND_SPAN / 2, -ISLAND_SPAN / 2, ISLAND_SPAN, BACKDROP_VERTS,
    );
  }

  dispose(): void {
    for (const cell of this.cells.values()) {
      this.scene.remove(cell.mesh);
      cell.mesh.geometry.dispose();
    }
    this.cells.clear();
    this.scene.remove(this.backdrop);
    this.backdrop.geometry.dispose();
  }

  private cut(cx: number, cz: number, fine: boolean): THREE.BufferGeometry {
    return buildCell(
      cx * CELL_SPAN, cz * CELL_SPAN, CELL_SPAN, fine ? CELL_VERTS : COARSE_VERTS,
    );
  }
}
