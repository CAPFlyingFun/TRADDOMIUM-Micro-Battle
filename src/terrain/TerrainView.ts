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
 * SKIRTS, BECAUSE THE SEAMS ARE REAL. Where a fine ring meets a coarse
 * one, two fine edge segments meet one coarse segment, and the middle
 * fine vertex is not on the coarse line — the difference is a hairline
 * gap you can see sky through. Each ring hangs a skirt down from its
 * outer boundary, deep enough to cover the worst step at that level.
 * This is the standard fix and it costs one quad strip a ring.
 *
 * IT DRAWS THE HEIGHTFIELD, NOT THE DEM. Every vertex is a `heightAt`,
 * so a high-detail tile arriving sharpens the ground under the camera
 * with no change here, and the mesh agrees with what an ant walks on by
 * construction rather than by a second copy of the sampling rules.
 *
 * THE COLOUR IS HEIGHT, and it is honest about being a stand-in: there
 * are no textures baked yet (the ladder they will be baked to is in
 * `assets/textureQuality.ts`). Below sea level is drawn as sea floor
 * rather than as water — the ocean is Phase 3, and pretending otherwise
 * here would be a surface nobody owns.
 */
import * as THREE from 'three';
import { HD_STEP } from '../world/dem';
import type { Heightfield } from '../world/heightfield';
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

/** Height in world units at which the colour ramp changes hands. Tuned to Kauaʻi, not measured from it. */
const BANDS: readonly { readonly at: number; readonly colour: number }[] = [
  { at: -300_000, colour: 0x0a1a2e },
  { at: -40_000, colour: 0x14415f },
  { at: -2_000, colour: 0x2d7f96 },
  { at: 0, colour: 0xcfc09a },
  { at: 1_500, colour: 0x7d9b4e },
  { at: 25_000, colour: 0x3f6b32 },
  { at: 70_000, colour: 0x2f5a34 },
  { at: 110_000, colour: 0x6b6350 },
  { at: 150_000, colour: 0x8d8577 },
];

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
}

export class TerrainView {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly field: Heightfield;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly quads: number;
  /** How many rings had their heights rewritten by the last `update`. The cost, measurable. */
  lastRebuilt = 0;

  constructor(options: TerrainViewOptions) {
    this.field = options.field;
    const levels = options.levels ?? RING_LEVELS;
    const quads = options.ringQuads ?? RING_QUADS;
    this.quads = quads;
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
      this.rings.push({ level, quad, mesh, geometry, centre: null });
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
    for (const ring of this.rings) {
      // Snapped to TWICE the quad: snapping to one quad would flip the
      // grid's parity every step and make the surface crawl.
      const centre = snapTo(at, ring.quad * 2);
      if (ring.centre === null || !samePoint(ring.centre, centre)) {
        ring.centre = centre;
        this.fill(ring);
        rebuilt += 1;
      }
      // THE RENDER BOUNDARY: the only world → local conversion here, and
      // it goes through the floating origin rather than by hand.
      const drawAt = toLocal(centre);
      ring.mesh.position.set(drawAt.lx, 0, drawAt.lz);
    }
    this.lastRebuilt = rebuilt;
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

  /** Rewrite one ring's heights, colours and normals from the heightfield. */
  private fill(ring: Ring): void {
    const centre = ring.centre;
    if (!centre) return;
    const position = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = ring.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normal = ring.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const skirtDrop = ring.quad * SKIRT_QUADS;
    const isSkirt = ring.geometry.userData.skirtFrom as number;

    for (let i = 0; i < position.count; i += 1) {
      const at = translate(centre, position.getX(i), position.getZ(i));
      const height = this.field.heightAt(at);
      // A skirt vertex sits under its own edge, not on the surface: it is
      // there to be hidden, and shares the edge's colour so it never
      // catches the light as a band of its own.
      position.setY(i, i >= isSkirt ? height - skirtDrop : height);
      const n = this.field.normalAt(at);
      normal.setXYZ(i, n.nx, n.ny, n.nz);
      const c = colourAt(height);
      colour.setXYZ(i, c.r, c.g, c.b);
    }
    position.needsUpdate = true;
    colour.needsUpdate = true;
    normal.needsUpdate = true;
    ring.geometry.computeBoundingSphere();
  }
}

/** The colour ramp, as a three colour. Exported so a test can read the bands rather than guess them. */
export function colourAt(height: number): THREE.Color {
  const first = BANDS[0];
  if (height <= first.at) return new THREE.Color(first.colour);
  for (let i = 1; i < BANDS.length; i += 1) {
    const low = BANDS[i - 1];
    const high = BANDS[i];
    if (height <= high.at) {
      const t = (height - low.at) / (high.at - low.at);
      return new THREE.Color(low.colour).lerp(new THREE.Color(high.colour), t);
    }
  }
  return new THREE.Color(BANDS[BANDS.length - 1].colour);
}

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
  const indices: number[] = [];

  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      positions.push(col * quad - half, 0, row * quad - half);
    }
  }

  // The hole: the central quarter in each axis, which is exactly the span
  // of the next ring in. Quads whose four corners are all inside it are
  // dropped; the ones straddling the boundary stay, so there is no gap.
  const holeLow = quads / 4;
  const holeHigh = quads - quads / 4;
  const inHole = (col: number, row: number): boolean =>
    hollow && col >= holeLow && col < holeHigh && row >= holeLow && row < holeHigh;

  for (let row = 0; row < quads; row += 1) {
    for (let col = 0; col < quads; col += 1) {
      if (inHole(col, row)) continue;
      const a = row * side + col;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const skirtFrom = positions.length / 3;
  // The outer boundary, walked once: north edge, south edge, west, east.
  const edge: number[] = [];
  for (let col = 0; col < side; col += 1) edge.push(col, side * quads + col);
  for (let row = 1; row < quads; row += 1) edge.push(row * side, row * side + quads);
  for (const index of edge) {
    positions.push(positions[index * 3], 0, positions[index * 3 + 2]);
  }
  // Two triangles a segment, joining each boundary vertex to its dropped twin.
  const skirtOf = (i: number): number => skirtFrom + edge.indexOf(i);
  const addSkirt = (a: number, b: number): void => {
    const a2 = skirtOf(a);
    const b2 = skirtOf(b);
    if (a2 < skirtFrom || b2 < skirtFrom) return;
    indices.push(a, a2, b, b, a2, b2);
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
  geometry.setIndex(indices);
  geometry.userData.quads = quads;
  geometry.userData.skirtFrom = skirtFrom;
  return geometry;
}
