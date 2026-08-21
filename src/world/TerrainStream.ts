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
 * FOUR DISTANCE TIERS, and each draws only where it is the best one.
 *
 * The island is the same island at every tier; they differ only in how
 * finely it is cut. Drawn together they overlap and the coarse surface
 * pokes through the fine one — which is exactly what "there are two
 * terrains, I flew through one and landed on the other" is. So each
 * tier discards fragments nearer than the tier inside it (see
 * terrainMaterial's nearCut).
 *
 *   CELLS       out to      2,304 units    8 or 32 units a vertex
 *   TRANSITION  out to     20,000            312.5 units a vertex
 *   MIDDLE      out to    200,000          3,125 units a vertex
 *   BACKDROP    the whole island          43,750 units a vertex
 *
 * A CUT IS NOT A COVER. This is the lesson the transition tier was
 * bought with. Discarding the coarse tier where a finer one exists
 * assumes the finer one is standing in the same place — and vertically
 * it is not. Measured on the Līhuʻe Plain, out along one bearing:
 *
 *   900 units out   cells 6354   middle 6392   middle is 38 HIGHER
 *  1700 units out   cells 6163   middle 6220   57 higher
 *  2100 units out   cells 6088   middle 6132   44 higher
 *
 * The middle tier is discarded inside 1,986, so that 40-to-60-unit
 * bulge is invisible — and a sight line grazing the cells passes UNDER
 * the bulge, over the cells, and out the far side into open sea. The
 * probe caught rays doing exactly that: no cell hit at all, one
 * discarded middle hit around 900, and then the water plane at 28,000.
 * That is the slit of blue, and it is why walking at it "closed" it —
 * the geometry that hid it moved with her.
 *
 * The cure is not a bigger cut or more fog. It is that the two
 * surfaces meeting at a seam should be near enough the same surface.
 * The old ladder went 32 units a vertex to 3,125 in one step — ninety
 * eight times coarser across a single seam, which is where 40-to-60
 * units of disagreement comes from. Adding one tier makes each step
 * about ten times rather than one step of a hundred:
 *
 *   8 → 32 → 312.5 → 3,125 → 43,750
 *
 * and a tenfold step leaves a fraction of a unit between neighbours
 * rather than half a metre.
 */
const CELL_REACH = ((CELLS - 1) / 2) * CHUNK_SPAN;

/**
 * Half-width of the transition tier — two hundred metres of ground.
 *
 * Cheap for what it fixes: 129 squared is under seventeen thousand
 * vertices for the whole ring, against the hundreds of streamed cells
 * it would take to cover the same ground finely. The detail goes where
 * the seam is, not everywhere.
 */
const TRANSITION_REACH = 20_000;
const TRANSITION_VERTS = 129;
const TRANSITION_STEP = (TRANSITION_REACH * 2) / (TRANSITION_VERTS - 1);

/** Half-width of the middle tier — two kilometres of ground. */
const MIDDLE_REACH = 200_000;
const MIDDLE_VERTS = 129;
/** It follows her, snapped, so its vertices never crawl as she moves. */
const MIDDLE_STEP = (MIDDLE_REACH * 2) / (MIDDLE_VERTS - 1);

/** Vertices a side for the distant whole-island backdrop. */
const BACKDROP_VERTS = 129;

/**
 * How far each cell's edge hangs down below the ground — the fix for
 * the holes.
 *
 * A fine cell has a vertex every 8 units and a coarse one every 32,
 * over the same 512-unit span. Along the edge they share, the coarse
 * side draws a straight line between vertices four times further apart
 * than the fine side's, so the two surfaces do not meet: there is a
 * sliver of nothing between them and you see sky or sea through it.
 * That is why the holes closed up as she approached — the cell flipped
 * to fine and the mismatch went away.
 *
 * The classic fix, and still the right one: hang a skirt off every
 * cell edge so a crack shows ground-coloured wall instead of sky.
 * Invisible otherwise, because it is under the terrain.
 */
const SKIRT_DROP = 250;

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
/**
 * @param coarse true for the distance tiers, which need the coastline
 *   held above water — see `dryLand`.
 */
export function buildCell(
  at: WorldPoint, span: number, verts: number, coarse = false,
): THREE.BufferGeometry {
  const worldX = at.wx;
  const worldZ = at.wz;
  const quads = verts - 1;
  const step = span / quads;
  const wide = verts + 2;

  const heights = new Float32Array(wide * wide);
  for (let r = 0; r < wide; r++) {
    for (let c = 0; c < wide; c++) {
      const x = worldX + (c - 1) * step;
      const z = worldZ + (r - 1) * step;
      heights[r * wide + c] = coarse ? dryLand(x, z, step) : terrainHeight(x, z);
    }
  }

  const count = verts * verts;
  // Plus a skirt vertex for every vertex on the perimeter. The corners
  // get counted twice, which costs four vertices and saves a special
  // case in every loop below.
  const skirts = verts * 4;
  const positions = new Float32Array((count + skirts) * 3);
  const normals = new Float32Array((count + skirts) * 3);
  const colors = new Float32Array((count + skirts) * 3);
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

  // The skirt: each perimeter vertex copied straight down.
  const edges: number[][] = [
    Array.from({ length: verts }, (_, i) => i),                       // north
    Array.from({ length: verts }, (_, i) => (verts - 1) * verts + i), // south
    Array.from({ length: verts }, (_, i) => i * verts),               // west
    Array.from({ length: verts }, (_, i) => i * verts + (verts - 1)), // east
  ];
  edges.forEach((edge, e) => {
    edge.forEach((source, i) => {
      const to = count + e * verts + i;
      positions[to * 3] = positions[source * 3];
      positions[to * 3 + 1] = positions[source * 3 + 1] - SKIRT_DROP;
      positions[to * 3 + 2] = positions[source * 3 + 2];
      normals[to * 3] = normals[source * 3];
      normals[to * 3 + 1] = normals[source * 3 + 1];
      normals[to * 3 + 2] = normals[source * 3 + 2];
      colors[to * 3] = colors[source * 3];
      colors[to * 3 + 1] = colors[source * 3 + 1];
      colors[to * 3 + 2] = colors[source * 3 + 2];
    });
  });

  const skirtTris = 4 * (verts - 1) * 2 * 2;
  const indices = new Uint32Array(quads * quads * 6 + skirtTris * 3);
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

  // BOTH WINDINGS for the skirt, deliberately. Which face of a crack
  // you are looking through depends on which side of it you stand, and
  // four edges in four orientations is four chances to get a winding
  // backwards and leave the hole exactly where it was. Doubling a few
  // hundred triangles buys certainty; the cell itself stays one-sided.
  edges.forEach((edge, e) => {
    for (let i = 0; i < verts - 1; i++) {
      const a = edge[i];
      const b = edge[i + 1];
      const c = count + e * verts + i;
      const d = count + e * verts + i + 1;
      indices[n++] = a; indices[n++] = b; indices[n++] = c;
      indices[n++] = b; indices[n++] = d; indices[n++] = c;
      indices[n++] = c; indices[n++] = b; indices[n++] = a;
      indices[n++] = c; indices[n++] = d; indices[n++] = b;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * HOW FAR INSIDE THE INNER TIER THE OUTER ONE STARTS DRAWING.
 *
 * It was three percent, and three percent is not enough. A ray leaving
 * the camera at a shallow angle runs nearly parallel to the ground, so
 * where two tiers disagree vertically it can slip BETWEEN them and
 * travel an enormous horizontal distance in the gap. Traced through
 * the pixels of an actual hole, every escaping ray crossed the middle
 * tier between 19,177 and 19,337 units — just inside a cut at 19,400 —
 * while every neighbouring ray that crossed it at 19,417 or beyond saw
 * ground. Six hundred units of overlap sounds generous and is nothing
 * at a grazing angle.
 *
 * So the overlap is now a fifth of the inner tier's reach, which buys
 * the ray thousands of units in which the two surfaces converge. What
 * it costs is the coarse tier drawing a little nearer, where it can sit
 * a few tens of units above the fine one — and at the distance this
 * happens that is a fifth of a degree. Invisible, which is the whole
 * argument: a seam you cannot see beats a hole you can.
 */
const OVERLAP = 0.8;

/** How far each tier reaches, for the tier outside it to cut against. */
export const TIER_CUTS = {
  transition: CELL_REACH * OVERLAP,
  middle: TRANSITION_REACH * OVERLAP,
  backdrop: MIDDLE_REACH * OVERLAP,
};

/**
 * A coarse vertex height that will not drown a coastline.
 *
 * THE BLUE PATCHES. Kauaʻi's beaches are tens of metres wide and the
 * middle tier has a vertex every 3,125 units — thirty metres — so a
 * vertex lands in the sea while every fine cell around it is dry sand.
 * The triangle between them crosses sea level, the water plane covers
 * the part underneath, and a lagoon appears in the middle of a beach.
 * It closed up as she walked toward it because the fine cells, which
 * know the beach is there, took over.
 *
 * So a coarse vertex that falls in the water while its NEIGHBOURHOOD is
 * land gets lifted to the shoreline. Only that case: open ocean stays
 * ocean, and a vertex already on land is left exactly as it is, so
 * nothing about the island's shape or height changes. It is the honest
 * reading of "this sample cannot see the beach it is standing on".
 */
function dryLand(x: number, z: number, step: number): number {
  const here = terrainHeight(x, z);
  if (here > 0) return here;
  const reach = step * 0.5;
  const around = Math.max(
    terrainHeight(x + reach, z), terrainHeight(x - reach, z),
    terrainHeight(x, z + reach), terrainHeight(x, z - reach),
  );
  // Just above the waterline, not up to the neighbour's height: the
  // point is to stop the sea showing through, not to invent a cliff.
  return around > 0 ? Math.min(around, 1) : here;
}

export class TerrainStream {
  private readonly cells = new Map<string, Cell>();
  private readonly backdrop: THREE.Mesh;
  private readonly middle: THREE.Mesh;
  private readonly transition: THREE.Mesh;
  /** Where the middle tier is currently cut, in world units. */
  private middleAt: WorldPoint | null = null;
  private transitionAt: WorldPoint | null = null;
  /** The chunk she was in last time, so the window only moves when she does. */
  private at: ChunkId | null = null;
  private relief = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly material: THREE.Material,
    transitionMaterial: THREE.Material,
    middleMaterial: THREE.Material,
    backdropMaterial: THREE.Material,
  ) {
    // The one that closes the hole: fine enough to agree with the
    // streamed cells at the seam, coarse enough to be nearly free.
    this.transition = new THREE.Mesh(
      buildCell(
        world(-TRANSITION_REACH, -TRANSITION_REACH),
        TRANSITION_REACH * 2, TRANSITION_VERTS, true,
      ),
      transitionMaterial,
    );
    this.transition.frustumCulled = false;
    scene.add(this.transition);
    this.middle = new THREE.Mesh(
      buildCell(world(-MIDDLE_REACH, -MIDDLE_REACH), MIDDLE_REACH * 2, MIDDLE_VERTS, true),
      middleMaterial,
    );
    this.middle.frustumCulled = false;
    scene.add(this.middle);
    // The whole island, once, coarsely, far away. At true scale she can
    // physically see a few metres of ground — but a game where the
    // island exists only as fog is a worse game than one where the
    // mountains are visible and merely very small.
    this.backdrop = new THREE.Mesh(
      buildCell(world(-ISLAND_SPAN / 2, -ISLAND_SPAN / 2), ISLAND_SPAN, BACKDROP_VERTS, true),
      backdropMaterial,
    );
    this.backdrop.frustumCulled = false;
    scene.add(this.backdrop);
  }

  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * What the terrain COSTS, independent of where the camera is looking.
   *
   * `renderer.info` counts what survived frustum culling, which moves
   * with the view and cannot compare one build against another. This
   * counts the geometry that exists.
   */
  get cost(): { triangles: number; meshes: number; vertices: number } {
    let triangles = 0;
    let vertices = 0;
    let meshes = 0;
    const add = (mesh: THREE.Mesh) => {
      const index = mesh.geometry.getIndex();
      const position = mesh.geometry.getAttribute('position');
      triangles += index ? index.count / 3 : 0;
      vertices += position ? position.count : 0;
      meshes += 1;
    };
    for (const cell of this.cells.values()) add(cell.mesh);
    add(this.transition);
    add(this.middle);
    add(this.backdrop);
    return { triangles, meshes, vertices };
  }

  /**
   * The three tiers, for a probe to shoot rays at.
   *
   * Raycasting hits GEOMETRY, and a tier's geometry covers ground the
   * tier does not draw — the near cut is a fragment discard, so it
   * exists only at render time. A hole is therefore a direction where
   * every tier that has geometry there is being discarded, which is
   * something a caller can only work out with both the meshes and the
   * cuts in hand. Hence both.
   */
  get tiers(): {
    cells: THREE.Mesh[];
    transition: THREE.Mesh;
    middle: THREE.Mesh;
    backdrop: THREE.Mesh;
  } {
    return {
      cells: [...this.cells.values()].map((c) => c.mesh),
      transition: this.transition,
      middle: this.middle,
      backdrop: this.backdrop,
    };
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
    this.recutTransition(at);
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
    if (this.transitionAt) {
      const near = toLocal(this.transitionAt);
      this.transition.position.set(near.lx, 0, near.lz);
    }
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
  /** The same snapping as the middle tier, at its own step. */
  private recutTransition(at: WorldPoint): void {
    const corner = world(
      Math.round((at.wx - TRANSITION_REACH) / TRANSITION_STEP) * TRANSITION_STEP,
      Math.round((at.wz - TRANSITION_REACH) / TRANSITION_STEP) * TRANSITION_STEP,
    );
    if (this.transitionAt
      && this.transitionAt.wx === corner.wx && this.transitionAt.wz === corner.wz) {
      return;
    }
    this.transitionAt = corner;
    this.transition.geometry.dispose();
    this.transition.geometry = buildCell(
      corner, TRANSITION_REACH * 2, TRANSITION_VERTS, true,
    );
  }

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
    this.middle.geometry = buildCell(corner, MIDDLE_REACH * 2, MIDDLE_VERTS, true);
  }

  /** Vertical exaggeration, as a transform — see the terrain dials. */
  setRelief(times: number): void {
    this.relief = times;
    for (const cell of this.cells.values()) cell.mesh.scale.y = times;
    this.transition.scale.y = times;
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
      world(-ISLAND_SPAN / 2, -ISLAND_SPAN / 2), ISLAND_SPAN, BACKDROP_VERTS, true,
    );
    const near = this.transitionAt;
    this.transitionAt = null;
    if (near) {
      this.recutTransition(
        world(near.wx + TRANSITION_REACH, near.wz + TRANSITION_REACH),
      );
    }
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
    this.scene.remove(this.transition);
    this.transition.geometry.dispose();
    this.scene.remove(this.middle);
    this.middle.geometry.dispose();
  }

  private cut(id: ChunkId, fine: boolean): THREE.BufferGeometry {
    // Sampled at the chunk's WORLD corner, so the geometry is a pure
    // function of the global address and nothing else.
    return buildCell(chunkOrigin(id), CHUNK_SPAN, fine ? CELL_VERTS : COARSE_VERTS);
  }
}
