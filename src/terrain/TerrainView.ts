/**
 * KAUAʻI, DRAWN — a geometry clipmap over the heightfield.
 *
 * THE PROBLEM THIS SHAPE SOLVES. The island is 5,600,000 units across and
 * the finest survey is a sample every 1,367. One mesh at that rate is
 * 16.8 million vertices, which is not a phone. One mesh coarse enough to
 * fit is 54.7 m a sample, which is not terrain you can stand on. Detail
 * has to fall away with distance, and it has to do it without seams and
 * without rebuilding geometry as the camera moves.
 *
 * A CLIPMAP: concentric square rings, each one twice the quad size and
 * twice the span of the one inside it, all with the SAME vertex count.
 * The innermost is a full grid at the survey's own step; every ring
 * outside it is an annulus with its middle quarter left out, because the
 * finer ring is already drawn there. Eight levels reach 112 km — twice
 * the island — for about 26,000 vertices, which is roughly what one
 * detailed character model costs. That is the whole reason to build it
 * this way rather than as tiles: the cost does not grow with the world.
 *
 * NOTHING IS REBUILT WHEN THE CAMERA MOVES. Each ring is one static
 * geometry whose vertices are offsets from its own centre; a ring moves
 * by having its centre reassigned, snapped to TWICE its own quad so the
 * parity of its grid never changes. Only the heights are rewritten, and
 * only for rings that actually moved. A ring that has not moved is not
 * touched at all.
 *
 * THE HOLES MUST LINE UP WITH WHERE THE FINER RING ACTUALLY IS, and this
 * is the part that is easy to get wrong — the first build did. Each ring
 * snaps to its OWN lattice, so ring N and ring N+1 do not share a centre:
 * ring N sits at a multiple of its own two-quad step, which is exactly
 * ONE quad of ring N+1, so the finer ring lands offset from the middle of
 * the coarser ring's hole by 0 or ±1 coarse quad in each axis. Left
 * unhandled that is a gap you can see sky through on one side and an
 * overlap that z-fights on the other, which is precisely what the first
 * screenshot showed. So the hole is cut where the finer ring IS: the
 * offset is recomputed when a ring moves and the index buffer is rewritten
 * for it — nine possible positions, and the geometry is otherwise
 * untouched.
 *
 * THE SEAM IS STITCHED, NOT HIDDEN. Where a fine ring meets a coarse one,
 * two fine edge segments meet one coarse segment and the fine vertex in
 * between is not on the coarse line. That is a T-junction, and it is a
 * hairline you can see the sky through — the second screenshot had 83 such
 * pixels, every one of them exactly the horizon colour.
 *
 * A skirt hanging down from the fine edge covers only HALF of it: the half
 * where the coarse line is lower. Where the coarse line is higher the gap
 * is above the fine edge and a downward skirt points away from it. So
 * instead of hiding the seam, the boundary is made not to have one — each
 * ring's outer edge has its in-between vertices pinned to the mean of
 * their neighbours, which IS the coarse ring's straight line. The two
 * polylines then coincide exactly and no gap exists to cover.
 *
 * The cost is named rather than hidden: those boundary vertices are the
 * only ones in the mesh that are not `heightAt`'s own answer, they are off
 * by at most what the coarse ring is off by anyway, and the test says so.
 * The OUTERMOST ring keeps its true heights, because nothing coarser is
 * out there to agree with.
 *
 * SKIRTS STAY, for the world's outer edge and as insurance: a strip
 * hanging from each ring's boundary costs one quad row and covers
 * anything the stitch does not.
 *
 * IT DRAWS THE HEIGHTFIELD, NOT THE DEM. Every vertex is a `heightAt`,
 * so the mesh agrees with what an ant walks on by construction rather
 * than by a second copy of the sampling rules.
 *
 * AND IT HAS TO BE TOLD WHEN THE GROUND CHANGES. An earlier version of
 * this comment claimed a streamed tile "sharpens the ground under the
 * camera with no change here", which was false: a ring is refilled only
 * when it MOVES, so a tile landing under a camera that is standing still
 * reached nobody, and once the camera did move the rings caught up at
 * eight different rates — ring 0 every 27 m, ring 4 every 437 m — leaving
 * adjacent rings drawing two different versions of the ground and pulling
 * the stitched seam apart. `Heightfield.revision()` closes it: one
 * counter, bumped when a tile arrives or leaves, compared per frame, and
 * a change refills every ring at once.
 *
 * THE REFILL IS THE FRAME BUDGET, so it is written like it. Measured at
 * 14 ms and ~89,000 short-lived objects a ring before this was addressed,
 * landing on about a third of frames at the scene's own flying speed —
 * on a phone that is the whole frame. Three things were paying for it:
 * `normalAt` per vertex (four more heightfield reads each, when the
 * neighbouring vertices this loop has ALREADY computed are the same
 * samples), a `THREE.Color` allocated three deep per vertex, and a
 * two-character string built per read inside the heightfield's tile
 * lookup. All three are gone; what is left is one small point per vertex.
 *
 * THE COLOUR IS HEIGHT, and it is honest about being a stand-in: there
 * are no textures baked yet (the ladder they will be baked to is in
 * `assets/textureQuality.ts`). Below sea level is drawn as sea floor
 * rather than as water — the ocean is Phase 3, and pretending otherwise
 * here would be a surface nobody owns.
 */
import * as THREE from 'three';
import { COARSE_STEP, HD_STEP } from '../world/dem';
import { normalOfGradient, slopeOfUp, type Heightfield } from '../world/heightfield';
import { samePoint, snapTo, translate, type WorldPoint } from '../world/coords';
import { toLocal } from '../world/origin';

/** Quads across one ring, each way. 64 keeps a ring at 4,225 vertices. */
export const RING_QUADS = 64;

/** Rings, finest first. Eight doublings from 13.67 m reach 112 km, twice the island. */
export const RING_LEVELS = 8;

/** The finest quad is the survey's own high-detail step, so level 0 draws every sample it has. */
export const FINEST_QUAD = HD_STEP;

/** How deep a ring's skirt hangs, as a multiple of its own quad size. */
const SKIRT_QUADS = 1.5;

/**
 * Height in world units at which the colour ramp changes hands. Tuned to
 * Kauaʻi, not measured from it.
 *
 * IT STAYS GREEN ALL THE WAY UP, which is the thing a generic height ramp
 * gets wrong here. Kauaʻi has no treeline: Waiʻaleʻale's 1,548 m summit is
 * a rainforest bog, the wettest place on Earth, and painting it grey
 * because it is high would be a mountain from somewhere else. The island's
 * bare rock is its CLIFFS — Waimea's walls, the Napali face — and that is
 * a matter of slope, which is what `ROCK` is for.
 */
const BANDS: readonly { readonly at: number; readonly colour: number }[] = [
  { at: -300_000, colour: 0x16324e },
  { at: -40_000, colour: 0x1b5378 },
  { at: -2_000, colour: 0x2d7f96 },
  { at: 0, colour: 0xcfc09a },
  { at: 1_500, colour: 0x7d9b4e },
  { at: 25_000, colour: 0x4a7a3a },
  { at: 90_000, colour: 0x3f6b32 },
  { at: 160_000, colour: 0x35583a },
];

/** The red-brown of Waimea's walls: what steep ground is, at any height. */
const ROCK = 0x8a6a52;
/** Below this slope nothing is bare; above the second, everything is. Degrees. */
const ROCK_FROM = 32;
const ROCK_FULL = 58;

export interface TerrainViewOptions {
  readonly field: Heightfield;
  /** Rings to build. Fewer is a smaller world drawn, not a coarser one. */
  readonly levels?: number;
  readonly ringQuads?: number;
}

interface Ring {
  readonly level: number;
  readonly quad: number;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  /** Where its centre is now, in world units, snapped to twice its quad. Null until the first fill. */
  centre: WorldPoint | null;
  /** The heightfield revision this ring's heights were read at. -1 until the first fill. */
  filledAt: number;
  /** Where the hole is cut, in this ring's own quads, relative to the middle. Each is -1, 0 or 1. */
  holeX: number;
  holeZ: number;
}

export class TerrainView {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly field: Heightfield;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly quads: number;
  private readonly levels: number;
  /** How many rings had their heights rewritten by the last `update`. The cost, measurable. */
  lastRebuilt = 0;

  constructor(options: TerrainViewOptions) {
    this.field = options.field;
    const levels = options.levels ?? RING_LEVELS;
    const quads = options.ringQuads ?? RING_QUADS;
    this.quads = quads;
    this.levels = levels;
    this.group.name = 'terrain';
    // Double-sided so the skirts need only one winding and so a camera
    // that dips below the surface sees ground rather than through it.
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

    for (let level = 0; level < levels; level += 1) {
      const quad = FINEST_QUAD * 2 ** level;
      const geometry = ringGeometry(quads, quad, level > 0);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `terrain-ring-${level}`;
      // Drawn finest first so the depth buffer rejects the coarse rings
      // behind them rather than shading twice.
      mesh.renderOrder = level;
      // The ring is a moving window on a fixed world; its bounds are
      // rewritten with its heights, and three must not cull it on stale ones.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ level, quad, mesh, geometry, centre: null, holeX: 0, holeZ: 0, filledAt: -1 });
    }
  }

  /**
   * Point the clipmap at a world position and place it against the
   * current floating origin.
   *
   * Cheap enough for every frame: a ring whose snapped centre has not
   * moved is repositioned but never refilled, and repositioning eight
   * rings is eight subtractions. Because the placement is redone every
   * call, an origin rebase needs no separate notification — the next
   * update draws in the new frame of reference on its own.
   */
  update(at: WorldPoint): void {
    let rebuilt = 0;
    // Snapped to TWICE the quad: snapping to one quad would flip the
    // grid's parity every step and make the surface crawl.
    const centres = this.rings.map((ring) => snapTo(at, ring.quad * 2));
    // The ground's own version. A tile arriving or leaving changes it,
    // and every ring is then stale wherever it looks — including the ones
    // that have not moved. Refilling all eight on that frame is the same
    // work the first frame already does, and it happens once per tile
    // rather than per frame.
    const revision = this.field.revision();

    for (let i = 0; i < this.rings.length; i += 1) {
      const ring = this.rings[i];
      const centre = centres[i];
      // A ring whose quad is the coarse lattice's own step (or a multiple
      // of it) samples ONLY at coarse sample points — and decimating the
      // high-detail grid by four reproduces the coarse one exactly there,
      // which `tests/worldDem.test.ts` pins. So a tile arriving cannot
      // change one pixel of what those rings draw, and refilling all eight
      // on every tile would be six rings of wasted work per download.
      const stale = ring.filledAt !== revision && ring.quad < COARSE_STEP;
      if (ring.centre === null || stale || !samePoint(ring.centre, centre)) {
        ring.centre = centre;
        this.fill(ring);
        rebuilt += 1;
      } else if (ring.filledAt !== revision) {
        // Up to date by the argument above; say so, or it would be
        // re-examined against every future revision for ever.
        ring.filledAt = revision;
      }
      // Cut the hole where the finer ring landed, not where the middle
      // of this one happens to be — see the header.
      if (i > 0) {
        const inner = toLocal(centres[i - 1]);
        const here = toLocal(centre);
        const holeX = Math.round((inner.lx - here.lx) / ring.quad);
        const holeZ = Math.round((inner.lz - here.lz) / ring.quad);
        if (holeX !== ring.holeX || holeZ !== ring.holeZ || !ring.geometry.getIndex()) {
          ring.holeX = holeX;
          ring.holeZ = holeZ;
          cutHole(ring.geometry, holeX, holeZ);
        }
      }
      // THE RENDER BOUNDARY: the only world → local conversion here, and
      // it goes through the floating origin rather than by hand.
      const drawAt = toLocal(centre);
      ring.mesh.position.set(drawAt.lx, 0, drawAt.lz);
    }
    this.lastRebuilt = rebuilt;
  }

  /** Where each ring cuts its hole, in its own quads. Exposed so a test can see the alignment. */
  holeOffsets(): { x: number; z: number }[] {
    return this.rings.map((r) => ({ x: r.holeX, z: r.holeZ }));
  }

  /** Total vertices across every ring — the number that has to stay small. */
  vertexCount(): number {
    return this.rings.reduce((total, r) => total + r.geometry.getAttribute('position').count, 0);
  }

  ringCount(): number {
    return this.rings.length;
  }

  /** The world span of the outermost ring: how far the drawn island reaches. */
  reach(): number {
    const outer = this.rings[this.rings.length - 1];
    return outer ? outer.quad * this.quads : 0;
  }

  dispose(): void {
    for (const ring of this.rings) ring.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.rings.length = 0;
  }

  /**
   * Rewrite one ring's heights, colours and normals from the heightfield.
   *
   * Four passes rather than one, because each needs the one before it
   * finished across the WHOLE ring: normals read neighbouring heights,
   * and the stitch moves heights that the normals must then reflect.
   */
  private fill(ring: Ring): void {
    const centre = ring.centre;
    if (!centre) return;
    const position = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = ring.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normal = ring.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const skirtFrom = ring.geometry.userData.skirtFrom as number;
    const quads = ring.geometry.userData.quads as number;
    const side = quads + 1;

    // 1. The surface, straight from the heightfield. ONE read a vertex.
    for (let i = 0; i < skirtFrom; i += 1) {
      position.setY(i, this.field.heightAt(translate(centre, position.getX(i), position.getZ(i))));
    }

    // 2. The seam. Every other vertex along the outer boundary is pinned
    // to the mean of its neighbours, which is exactly the line the coarse
    // ring outside draws between the same two points — see the header.
    // The outermost ring is skipped: nothing is out there to agree with.
    if (ring.level < this.levels - 1) {
      const runs = ring.geometry.userData.edgeRuns as number[][];
      for (const edgeRun of runs) {
        for (let i = 1; i < edgeRun.length - 1; i += 2) {
          position.setY(edgeRun[i], (position.getY(edgeRun[i - 1]) + position.getY(edgeRun[i + 1])) / 2);
        }
      }
    }

    // 3. Normals and colour, from the heights now standing in the buffer.
    //
    // The normal is a central difference across the ring's OWN
    // neighbours — the same samples this loop just read, so it costs
    // nothing instead of four more heightfield reads a vertex, and it
    // describes the surface actually being drawn rather than a second
    // opinion about it. Only the ring's outer boundary, which has no
    // neighbour on one side, falls back to asking the field.
    const twoQuads = 2 * ring.quad;
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < side; col += 1) {
        const i = row * side + col;
        const height = position.getY(i);
        let n;
        if (col > 0 && col < quads && row > 0 && row < quads) {
          const west = position.getY(i - 1);
          const east = position.getY(i + 1);
          const north = position.getY(i - side);
          const south = position.getY(i + side);
          n = normalOfGradient((west - east) / twoQuads, (north - south) / twoQuads);
        } else {
          n = this.field.normalAt(translate(centre, position.getX(i), position.getZ(i)));
        }
        normal.setXYZ(i, n.nx, n.ny, n.nz);
        const c = colourAt(height, slopeOfUp(n.ny), SCRATCH_COLOUR);
        colour.setXYZ(i, c.r, c.g, c.b);
      }
    }

    // 4. The skirts, hung from whatever height their edge vertex ended up
    // at, wearing its colour so they never catch the light as a band.
    const drop = ring.quad * SKIRT_QUADS;
    const edge = ring.geometry.userData.edge as number[];
    for (let i = 0; i < edge.length; i += 1) {
      const from = edge[i];
      const to = skirtFrom + i;
      position.setY(to, position.getY(from) - drop);
      normal.setXYZ(to, normal.getX(from), normal.getY(from), normal.getZ(from));
      colour.setXYZ(to, colour.getX(from), colour.getY(from), colour.getZ(from));
    }

    position.needsUpdate = true;
    colour.needsUpdate = true;
    normal.needsUpdate = true;
    ring.geometry.computeBoundingSphere();
    ring.filledAt = this.field.revision();
  }
}

/** One colour, reused for every vertex of every ring. See the header on what allocating one cost. */
const SCRATCH_COLOUR = new THREE.Color();

/**
 * The stand-in surface colour: the height ramp, then as much bare rock as
 * the slope earns. Exported so a test can read it rather than guess it.
 */
export function colourAt(height: number, slopeDegrees = 0, into?: THREE.Color): THREE.Color {
  const base = bandColour(height, into ?? new THREE.Color());
  // Underwater the sea floor is sea floor however steep it is; a rock face
  // painted onto the bathymetry would be visible through nothing.
  if (height < 0 || slopeDegrees <= ROCK_FROM) return base;
  const t = Math.min(1, (slopeDegrees - ROCK_FROM) / (ROCK_FULL - ROCK_FROM));
  return base.lerp(ROCK_COLOUR, t);
}

/** The rock, as one colour rather than one per vertex. `lerp` only reads it. */
const ROCK_COLOUR = new THREE.Color(ROCK);

function bandColour(height: number, into: THREE.Color): THREE.Color {
  const first = BANDS[0];
  if (height <= first.at) return into.copy(BAND_COLOURS[0]);
  for (let i = 1; i < BANDS.length; i += 1) {
    const low = BANDS[i - 1];
    const high = BANDS[i];
    if (height <= high.at) {
      const t = (height - low.at) / (high.at - low.at);
      return into.copy(BAND_COLOURS[i - 1]).lerp(BAND_COLOURS[i], t);
    }
  }
  return into.copy(BAND_COLOURS[BAND_COLOURS.length - 1]);
}

/**
 * Each band's colour, converted once.
 *
 * `setHex` is not a field assignment — three converts sRGB to linear on
 * the way in, which is a `Math.pow` per channel. Doing that per vertex
 * cost more than reading the heightfield did. These are built at module
 * load and only ever copied from.
 */
const BAND_COLOURS = BANDS.map((b) => new THREE.Color(b.colour));

/**
 * One ring, centred on its own origin, in the XZ plane with Y left at
 * zero for `fill` to write.
 *
 * `hollow` leaves out the middle quarter, which the finer ring covers.
 * The skirt is a strip hanging from the outer boundary; its vertices are
 * appended after the grid's, and `userData.skirtFrom` is where they start
 * so `fill` knows which ones to drop.
 */
function ringGeometry(quads: number, quad: number, hollow: boolean): THREE.BufferGeometry {
  const side = quads + 1;
  const half = (quads * quad) / 2;
  const positions: number[] = [];

  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      positions.push(col * quad - half, 0, row * quad - half);
    }
  }

  const skirtFrom = positions.length / 3;
  // The outer boundary, walked once: north edge, south edge, then the two
  // sides. Every one of these gets a twin hanging below it.
  const edge: number[] = [];
  for (let col = 0; col < side; col += 1) edge.push(col, side * quads + col);
  for (let row = 1; row < quads; row += 1) edge.push(row * side, row * side + quads);
  const skirtOf = new Map<number, number>();
  edge.forEach((index, i) => {
    skirtOf.set(index, skirtFrom + i);
    positions.push(positions[index * 3], 0, positions[index * 3 + 2]);
  });

  // Two triangles a boundary segment, joining each edge vertex to its
  // dropped twin. Fixed for the life of the ring: only the SURFACE indices
  // change when the hole moves.
  const skirt: number[] = [];
  const addSkirt = (a: number, b: number): void => {
    const a2 = skirtOf.get(a);
    const b2 = skirtOf.get(b);
    if (a2 === undefined || b2 === undefined) return;
    skirt.push(a, a2, b, b, a2, b2);
  };
  for (let col = 0; col < quads; col += 1) {
    addSkirt(col, col + 1);
    addSkirt(side * quads + col, side * quads + col + 1);
  }
  for (let row = 0; row < quads; row += 1) {
    addSkirt(row * side, (row + 1) * side);
    addSkirt(row * side + quads, (row + 1) * side + quads);
  }

  const geometry = new THREE.BufferGeometry();
  const count = positions.length / 3;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.userData.quads = quads;
  geometry.userData.skirtFrom = skirtFrom;
  geometry.userData.hollow = hollow;
  geometry.userData.skirt = skirt;
  // The boundary walk, in the order the skirt twins were appended, so the
  // fill can stitch an edge and hang its skirt from the stitched height.
  geometry.userData.edge = edge;
  // The four edges as ordered runs, for the stitch: north, south, west, east.
  const run = (from: number, step: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i <= quads; i += 1) out.push(from + i * step);
    return out;
  };
  geometry.userData.edgeRuns = [
    run(0, 1),
    run(side * quads, 1),
    run(0, side),
    run(quads, side),
  ];
  cutHole(geometry, 0, 0);
  return geometry;
}

/**
 * Rewrite a ring's SURFACE indices with its hole shifted by `offsetX` and
 * `offsetZ` of its own quads, then append the skirt unchanged.
 *
 * The hole is exactly the span of the next ring in — a quarter of this
 * ring's width on each side, so half of it — and it is cut where that
 * ring actually IS rather than in the middle of this one. A solid ring
 * (level 0) cuts no hole and this simply lays down every quad.
 */
export function cutHole(geometry: THREE.BufferGeometry, offsetX: number, offsetZ: number): void {
  const quads = geometry.userData.quads as number;
  const hollow = geometry.userData.hollow as boolean;
  const skirt = geometry.userData.skirt as number[];
  const side = quads + 1;
  const lowX = quads / 4 + offsetX;
  const lowZ = quads / 4 + offsetZ;
  const highX = lowX + quads / 2;
  const highZ = lowZ + quads / 2;

  const indices: number[] = [];
  for (let row = 0; row < quads; row += 1) {
    for (let col = 0; col < quads; col += 1) {
      if (hollow && col >= lowX && col < highX && row >= lowZ && row < highZ) continue;
      const a = row * side + col;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setIndex([...indices, ...skirt]);
}
