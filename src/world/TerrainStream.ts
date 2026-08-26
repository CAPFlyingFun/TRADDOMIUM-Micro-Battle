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
  farHeight, ISLAND_SPAN, terrainHeight,
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
/** Exported for the water: the crossfade to far-water paint must
 * finish INSIDE this reach, because past it the ground is 31-metre
 * triangles that clip a flat sheet into shards. */
export const TRANSITION_REACH = 20_000;
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
 * The small amount a real LOD seam may overlap vertically.
 *
 * A fine cell has a vertex every 8 units and a coarse one every 32,
 * over the same 512-unit span. Along the edge they share, the coarse
 * side draws a straight line between vertices four times further apart
 * than the fine side's, so the two surfaces do not meet: there is a
 * sliver of nothing between them and you see sky or sea through it.
 * That is why the holes closed up as she approached — the cell flipped
 * to fine and the mismatch went away.
 *
 * A SKIRT ON EVERY CELL EDGE WAS NOT THE RIGHT FIX: equal-resolution
 * neighbours share the exact same edge, so those skirts were just
 * 2.5-metre cardboard curtains printed across otherwise continuous
 * ground. Only an edge where the adjacent cell changes resolution
 * needs protection. Its depth is measured from that edge's local
 * disagreement and capped below; this is a seam overlap, not a wall.
 *
 * THE CURTAINS WERE INVISIBLE FOR AS LONG AS NOTHING CUT THROUGH THEM,
 * which is why a 250-unit drop survived so long: it hangs under the
 * ground and the ground hides it. Then flat water arrived at a level
 * ABOVE the bottom of the skirt, and every cell boundary crossing the
 * waterline stood up out of the surface as a row of dark teeth —
 * Joshua, on the far shore of the Mana pond: "I think I found the
 * cardboard." This file had already said so, in the commit that
 * merged the dry tree, and the seam implementation below is ported
 * from the branch that note pointed at (f3e3641). Terrain only: no
 * water code moved with it.
 */
export const MAX_SEAM_DROP = 8;

export type CellEdge = 'north' | 'south' | 'west' | 'east';

/**
 * How far the OUTERMOST cells reach down to meet the tier behind them.
 *
 * This is the one skirt left on the island, and it is worth saying why
 * it survived when the cardboard did not.
 *
 * It used to bridge a disagreement of RULE: the cells cut carve.ts's
 * trench and the transition tier aimed at the waterline instead, two
 * different islands meeting at the window's edge, a full metre apart.
 * That is gone — the channel lives in `baseLand` now, so both read one
 * surface and the rule disagreement is zero by construction.
 *
 * What is left is a disagreement of RESOLUTION, which is real and
 * cannot be bridged exactly. The cells' lattice is 8 to 32 units; the
 * tier's is 312.5, and between its vertices it draws a straight line
 * across ground that curves. Measured along the rim on the shipped
 * island: median 2 cm, p99 33 cm, worst 62 cm.
 *
 * A cell cannot compute that gap, because the tier's lattice is
 * anchored on HER — it slides as she walks — so at build time a cell
 * does not know where the tier's vertices will fall. So the rim drops a
 * flat, bounded, downward-only metre: enough to cover the measured
 * worst case with margin, and a quarter of the 2.5 m curtain that used
 * to hang off all four edges of every cell in the window. Downward
 * only, because where the tier draws ABOVE the cell edge the tier's own
 * geometry already covers the gap.
 */
export const MAX_RIM_DROP = 100;

/**
 * The vertex spacing on the cell across this one actual LOD seam.
 *
 * `tier` marks the other kind of seam: not a finer cell meeting a
 * coarser one, but the streamed window meeting the transition tier
 * that continues past it.
 */
export interface CellSeam {
  readonly edge: CellEdge;
  readonly neighbourStep: number;
  readonly tier?: boolean;
}

interface Cell {
  /** The GLOBAL address. Never a rendered position. */
  readonly id: ChunkId;
  readonly mesh: THREE.Mesh;
  fine: boolean;
  /** Which edges were seams when this geometry was cut. */
  seamKey: string;
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
  seams: readonly CellSeam[] = [],
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
  // Only actual LOD seams have a bridge ring. Same-LOD neighbours have
  // identical edge vertices, so adding one there can only make a wall.
  const skirts = verts * seams.length;
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
      // THE RIPARIAN CORRIDOR WENT WITH THE RIVERS. A damp band of
      // darker ground used to follow every channel — tens of metres
      // wide where the channel was five — because a ribbon lying on
      // bare sand reads as tape rather than as a stream. There is no
      // channel to follow now. Whatever replaces the water will want
      // this back: the corridor did more for how a river read than the
      // ribbon itself did.
      tint.multiplyScalar(1 + groundDetail(worldX + ix * step, worldZ + iz * step) * 0.11);
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
  }

  const perimeter = (edge: CellEdge): number[] => {
    switch (edge) {
      case 'north': return Array.from({ length: verts }, (_, i) => i);
      case 'south': return Array.from({ length: verts }, (_, i) => (verts - 1) * verts + i);
      case 'west': return Array.from({ length: verts }, (_, i) => i * verts);
      case 'east': return Array.from({ length: verts }, (_, i) => i * verts + (verts - 1));
    }
  };

  // Measure the fine edge against the straight line its coarser
  // neighbour draws. The fine side owns this bridge: it spans the
  // actual disagreement in either direction, so a second coarse skirt
  // would only duplicate triangles.
  const seamHeight = (seam: CellSeam, along: number, sourceHeight: number): number => {
    const edgePoint = (distance: number): [number, number] => {
      switch (seam.edge) {
        case 'north': return [worldX + distance, worldZ];
        case 'south': return [worldX + distance, worldZ + span];
        case 'west': return [worldX, worldZ + distance];
        case 'east': return [worldX + span, worldZ + distance];
      }
    };
    // THE WINDOW'S OWN RIM — a flat bounded drop, for the reason set
    // out at MAX_RIM_DROP: the tier's lattice slides with her, so there
    // is no line here to measure against.
    if (seam.tier) return sourceHeight - MAX_RIM_DROP;
    const coarseStep = Math.max(step, seam.neighbourStep);
    const lo = Math.floor(along / coarseStep) * coarseStep;
    const hi = Math.min(span, lo + coarseStep);
    const t = hi === lo ? 0 : (along - lo) / (hi - lo);
    const point = (distance: number) => {
      const [px, pz] = edgePoint(distance);
      return terrainHeight(px, pz);
    };
    const straight = point(lo) + (point(hi) - point(lo)) * t;
    return sourceHeight + Math.max(-MAX_SEAM_DROP, Math.min(MAX_SEAM_DROP, straight - sourceHeight));
  };

  const edges = seams.map((seam) => ({ edge: perimeter(seam.edge), seam }));
  edges.forEach(({ edge, seam }, e) => {
    edge.forEach((source, i) => {
      const to = count + e * verts + i;
      positions[to * 3] = positions[source * 3];
      positions[to * 3 + 1] = seamHeight(seam, i * step, positions[source * 3 + 1]);
      positions[to * 3 + 2] = positions[source * 3 + 2];
      normals[to * 3] = normals[source * 3];
      normals[to * 3 + 1] = normals[source * 3 + 1];
      normals[to * 3 + 2] = normals[source * 3 + 2];
      colors[to * 3] = colors[source * 3];
      colors[to * 3 + 1] = colors[source * 3 + 1];
      colors[to * 3 + 2] = colors[source * 3 + 2];
    });
  });

  const skirtTris = seams.length * (verts - 1) * 2 * 2;
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
  edges.forEach(({ edge }, e) => {
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
/**
 * How much of a coarse tier's vertex spacing one vertex answers for,
 * when it is asked how low the ground gets.
 *
 * HALF, so a vertex speaks for its own square and not for its
 * neighbours'. It was a whole spacing, which asked each vertex about
 * ground the vertex beside it was already answering for and doubled
 * the width of every carve out here. See CARVE_CAP.
 */
const FOOTPRINT = 0.5;

/**
 * AND THE MOST ANY TIER MAY ASK FOR, in world units.
 *
 * The footprint exists so a tier's triangles hold the water drawn over
 * them. The middle tier's vertices are 3,125 apart, so it was asking
 * about 3,125 — and the carve answered by flattening a shelf twice
 * that wide, 62 metres, at the waterline along every river on the
 * island. Joshua's screenshots are the result: grass plateaus the size
 * of car parks ending in vertical walls.
 *
 * It was never needed then. Water stopped at the transition tier, so no
 * tier coarser than that had any water over it to contain, and capping
 * at the transition step put the widest carve on the island at six
 * metres.
 *
 * THAT ARGUMENT DIED WHEN THE WATER'S DRAW DISTANCE MOVED. FlowWater's
 * REACH was two hundred metres and is now two kilometres, which is the
 * MIDDLE tier's reach — so the middle tier does have water over it, and
 * the cap left it asking about three metres of ground either side of a
 * vertex standing thirty-one metres apart from its neighbours. It found
 * no channel, kept its uncut ground, and the water lay on top of it.
 * That is the second half of Joshua's floating rivers; `flowNear` was
 * the first.
 *
 * Half the vertex spacing is the honest footprint: a vertex answers for
 * its own half-cell in each direction and no more, so every square with
 * a channel in it takes that channel's depth and no square takes a
 * neighbour's. Capped at the middle tier's half-step because nothing
 * coarser has water over it — the same reasoning as before, moved to
 * where the water actually stops now.
 *
 * The old cap existed to stop a wide carve flattening plateaus. That
 * carve was unbounded; this one cannot lower any point by more than a
 * metre and tapers to nothing at its edge, so a wide footprint out here
 * is a gentle metre-deep dip across sixty metres, seen from at least
 * two hundred. It is what puts the water IN the ground rather than on
 * it.
 */
const CARVE_CAP = MIDDLE_STEP / 2;

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
  // THE COASTLINE QUESTION ONLY, NOW. This used to carry a second job:
  // `farHeight` took the footprint and brought the coarse tiers down to
  // the waterline, because the cells cut a trench the tiers did not.
  // With the channel in `baseLand` there is one surface and no second
  // reading to reconcile, so `farHeight` is `baseLand` and the reach
  // below serves the MAX question that is left — a vertex standing in
  // the sea whose neighbourhood is land.
  const reach = Math.min(step * FOOTPRINT, CARVE_CAP);
  const here = farHeight(x, z, reach);
  if (here > 0) return here;
  const around = Math.max(
    farHeight(x + reach, z, reach), farHeight(x - reach, z, reach),
    farHeight(x, z + reach, reach), farHeight(x, z - reach, reach),
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
        // A cell must also be re-cut when its NEIGHBOURS change tier:
        // its seam bridges belong to edges, not to itself, so a cell
        // that keeps its own resolution can still need a bridge added
        // or dropped. Missing this leaves the old crack open.
        const seamKey = this.seamsFor(id, detailed)
          .map((seam) => `${seam.edge}${seam.tier ? '!' : ''}`).join(',');
        if (had && had.fine === detailed && had.seamKey === seamKey) continue;
        if (had) {
          // Same ground, different cut: swap the geometry rather than
          // the whole mesh so nothing flickers out and back.
          had.mesh.geometry.dispose();
          had.mesh.geometry = this.cut(id, detailed);
          had.fine = detailed;
          had.seamKey = seamKey;
          continue;
        }
        const mesh = new THREE.Mesh(this.cut(id, detailed), this.material);
        mesh.scale.y = this.relief;
        this.scene.add(mesh);
        this.cells.set(key, { id, mesh, fine: detailed, seamKey });
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
    return buildCell(
      chunkOrigin(id), CHUNK_SPAN, fine ? CELL_VERTS : COARSE_VERTS,
      false, this.seamsFor(id, fine),
    );
  }

  /** Which of this cell's four edges are genuine resolution changes. */
  private seamsFor(id: ChunkId, fine: boolean): CellSeam[] {
    if (!this.at) return [];
    const reach = (FINE_CELLS - 1) / 2;
    const detailAt = (cx: number, cz: number) =>
      Math.abs(cx - this.at!.cx) <= reach && Math.abs(cz - this.at!.cz) <= reach;
    const step = (detailed: boolean) =>
      CHUNK_SPAN / ((detailed ? CELL_VERTS : COARSE_VERTS) - 1);
    const here = fine;
    // The outer rim of the streamed window: past this there is no cell
    // at all, only the transition tier.
    const window = (CELLS - 1) / 2;
    const inside = (cx: number, cz: number) =>
      Math.abs(cx - this.at!.cx) <= window && Math.abs(cz - this.at!.cz) <= window;
    const neighbours: ReadonlyArray<readonly [CellEdge, number, number]> = [
      ['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0],
    ];
    const seams: CellSeam[] = [];
    for (const [edge, dx, dz] of neighbours) {
      const nx = id.cx + dx, nz = id.cz + dz;
      if (!inside(nx, nz)) {
        // The window's rim, whatever this cell's own resolution — a
        // coarse edge cell needs this bridge just as much as a fine
        // one, and requiring `fine` here is what left the wall.
        seams.push({ edge, neighbourStep: step(false), tier: true });
        continue;
      }
      // The fine side owns a cell-to-cell bridge. It joins its detailed
      // edge to the coarse line above or below it, so emitting the same
      // bridge from the coarse cell would spend twice the triangles.
      if (here && !detailAt(nx, nz)) {
        seams.push({ edge, neighbourStep: step(detailAt(nx, nz)) });
      }
    }
    return seams;
  }
}
