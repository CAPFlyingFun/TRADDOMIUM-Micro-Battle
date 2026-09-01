/**
 * THE LANDMARK TREES, DRAWN — an instanced stand that follows her.
 *
 * Two draw calls for the whole visible forest: one near mesh with the
 * boughs, one far mesh with the trunk and crown, each an InstancedMesh
 * of the SAME unit tree scaled and spun per instance. The ground cover
 * streams the same way and for the same reason — a phone pays per
 * draw, not per triangle at these counts.
 *
 * REFILLED ON THE LATTICE, NOT THE FRAME. The stand is rebuilt when
 * she crosses into a new 20 m cell, and never otherwise: a refill is a
 * few hundred pure placement queries and two matrix uploads, which is
 * nothing every twenty metres and everything every frame.
 *
 * DRAWN AS FAR AS THE GROUND IS HONEST. The far reach is the terrain's
 * transition tier (TRANSITION_REACH), whose drawn lattice is 3 m; past
 * it the middle tier draws the ground at 31 m steps, and a trunk seated
 * on the fine heightfield would float or bury by metres against it.
 * The forest past 200 m is Stage 3's — an impostor seated on that
 * tier's own sample.
 *
 * WORLD-ADDRESSED, LIKE EVERYTHING ELSE. Instances are placed relative
 * to the corner of her lattice cell, and the mesh is seated with
 * `toLocal` on every origin rebase — the TerrainStream rule, so there
 * is no local position to go stale.
 */
import * as THREE from 'three';
import type { WorldPoint } from './coords';
import { groundHeight } from './heightfield';
import { haveVeg } from './landcover';
import {
  GIRTH_OF_HEIGHT, PITCH, cellOf, landmarksNear, type Landmark,
} from './landmarks';
import { toLocal } from './origin';
import { TRANSITION_REACH } from './TerrainStream';
import { bakeUnitTree, treeMaterial, triangles } from './treeMesh';

/** Boughs and all within this, world units — fifty metres. */
export const NEAR_REACH = 5_000;
/** Trunk and crown out to the edge of the honest ground. */
export const FAR_REACH = TRANSITION_REACH;

/** The height the unit tree is grown at, for its proportions. */
const BAKE_HEIGHT = 2_400;
const BAKE_SEED = 0x7ee5;

/**
 * How far into the ground a foot is sunk, world units.
 *
 * The drawn ground and the queried ground disagree by a little on a
 * slope; a trunk seated exactly on the query stands in the air where
 * the mesh dips. Two per cent of the height, kept between 20 and 40.
 */
function burial(height: number): number {
  return Math.max(20, Math.min(40, height * 0.02));
}

export class LandmarkStand {
  private readonly material = treeMaterial();
  private readonly nearShape: THREE.BufferGeometry;
  private readonly farShape: THREE.BufferGeometry;
  private near: THREE.InstancedMesh;
  private far: THREE.InstancedMesh;
  /** The lattice cell she was in when the stand was last built. */
  private block: { cx: number; cz: number } | null = null;
  /** Where instances are measured from: the corner of that cell. */
  private anchor: WorldPoint = { wx: 0, wz: 0 };
  private lastAt: WorldPoint | null = null;
  private standing: Landmark[] = [];
  private nearCount = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.nearShape = bakeUnitTree(BAKE_HEIGHT, GIRTH_OF_HEIGHT, BAKE_SEED, 0);
    this.farShape = bakeUnitTree(BAKE_HEIGHT, GIRTH_OF_HEIGHT, BAKE_SEED, 1);
    this.near = this.stand(this.nearShape, 64);
    this.far = this.stand(this.farShape, 512);
  }

  private stand(shape: THREE.BufferGeometry, room: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(shape, this.material, room);
    mesh.count = 0;
    // The stand moves with the origin and reaches further than any
    // per-instance bound three.js keeps; culling it whole would blink
    // the forest out at the edge of the view.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** The raster has landed, or the ground changed: build again. */
  wake(): void {
    this.block = null;
    if (this.lastAt) this.follow(this.lastAt);
  }

  /** Grow the stand around her; nothing happens until she changes cell. */
  follow(at: WorldPoint): void {
    this.lastAt = at;
    if (!haveVeg()) return;
    const cell = cellOf(at);
    if (this.block && cell.cx === this.block.cx && cell.cz === this.block.cz) return;
    this.block = cell;
    this.anchor = { wx: cell.cx * PITCH, wz: cell.cz * PITCH };
    this.refill(at);
  }

  private refill(at: WorldPoint): void {
    const trees = landmarksNear(at, FAR_REACH);
    const nearOnes: Landmark[] = [];
    const farOnes: Landmark[] = [];
    for (const tree of trees) {
      const d = Math.hypot(tree.at.wx - at.wx, tree.at.wz - at.wz);
      (d <= NEAR_REACH ? nearOnes : farOnes).push(tree);
    }
    this.near = this.fill(this.near, this.nearShape, nearOnes);
    this.far = this.fill(this.far, this.farShape, farOnes);
    this.standing = trees;
    this.nearCount = nearOnes.length;
    this.place();
  }

  private fill(
    mesh: THREE.InstancedMesh, shape: THREE.BufferGeometry, trees: readonly Landmark[],
  ): THREE.InstancedMesh {
    let stand = mesh;
    if (trees.length > stand.instanceMatrix.count) {
      this.scene.remove(stand);
      stand.dispose();
      stand = this.stand(shape, Math.ceil(trees.length * 1.5));
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    trees.forEach((tree, i) => {
      // THE GROUND AS IT IS NOW, not as it was when the tree was placed:
      // an HD tile or the relief dial may have moved it since.
      const y = groundHeight(tree.at.wx, tree.at.wz) - burial(tree.height);
      p.set(tree.at.wx - this.anchor.wx, y, tree.at.wz - this.anchor.wz);
      q.setFromAxisAngle(up, tree.spin);
      s.setScalar(tree.height);
      m.compose(p, q, s);
      stand.setMatrixAt(i, m);
    });
    stand.count = trees.length;
    stand.instanceMatrix.needsUpdate = true;
    return stand;
  }

  /** Re-seat against the current origin. Called on every rebase. */
  place(): void {
    const seat = toLocal(this.anchor);
    this.near.position.set(seat.lx, 0, seat.lz);
    this.far.position.set(seat.lx, 0, seat.lz);
  }

  /** The ground moved under the stand — relief dial, HD tile. */
  reseat(): void {
    if (this.block && this.lastAt) this.refill(this.lastAt);
  }

  /** What is standing, for the probes and the developer line. */
  get trees(): readonly Landmark[] { return this.standing; }
  get nearby(): number { return this.nearCount; }

  /** Triangles on screen, for the budget. */
  get triangles(): number {
    return this.nearCount * triangles(this.nearShape)
      + (this.standing.length - this.nearCount) * triangles(this.farShape);
  }

  dispose(): void {
    for (const mesh of [this.near, this.far]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.nearShape.dispose();
    this.farShape.dispose();
    this.material.dispose();
  }
}
