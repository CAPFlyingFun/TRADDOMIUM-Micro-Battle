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
import {
  bakeUnitTree, leafMaterial, triangles, wearBark, woodMaterial,
  type BakedTree,
} from './treeMesh';
import {
  NO_TRUNKS, TrunkField, profileFor, type Standing, type TrunkProfile,
} from './trunkSolid';

/** Boughs and all within this, world units — fifty metres. */
export const NEAR_REACH = 5_000;
/**
 * HOW FAR OUT THE WOOD IS ACTUALLY SOLID, world units.
 *
 * Deliberately small, and much smaller than what is drawn: a trunk she
 * cannot reach before the field is rebuilt does not need to be solid,
 * and every query is linear in what the field holds. Twenty metres is
 * a hundred and forty of her body lengths.
 */
export const SOLID_REACH = 2_000;
/**
 * HOW FAR SHE MAY WALK BEFORE THE SOLID IS RE-CENTRED, world units.
 *
 * The drawn stand rebuilds on the lattice cell, which is fine for it:
 * a 2,048-unit cell of slop against a 20 km reach is nothing. THE
 * SOLID CANNOT RIDE THAT CADENCE — it reaches 2,000 units, which is
 * SMALLER THAN THE CELL, so a field built where she entered the cell
 * runs out behind her long before she leaves it. She would cross a
 * cell and walk through every trunk in the far half of it, which is
 * exactly the "it did clip a tree here and there" from the device.
 *
 * So the solid re-centres on her own position instead, four metres at
 * a time. That leaves 1,600 units of guaranteed cover in front of her
 * — eighty seconds of sprinting — and costs a filter over a list the
 * cell rebuild already produced.
 */
export const SOLID_STEP = 400;
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

/**
 * The two trunk profiles, grown once.
 *
 * Every tree in the stand is the same unit tree at a different scale
 * and spin, so there are exactly two profiles in the whole forest —
 * one per detail level. Building one walks the tree's whole skeleton,
 * and the solid re-centres every few metres over a few hundred trees.
 */
const SHAPES = new Map<string, TrunkProfile>();
function shapeOf(level: number, ring = true): TrunkProfile {
  const key = `${level}:${ring}`;
  const had = SHAPES.get(key);
  if (had) return had;
  const made = profileFor(
    { height: BAKE_HEIGHT, girth: BAKE_HEIGHT * GIRTH_OF_HEIGHT, seed: BAKE_SEED },
    level, ring,
  );
  SHAPES.set(key, made);
  return made;
}

export class LandmarkStand {
  private readonly bark = woodMaterial();
  private readonly leaf = leafMaterial();
  private readonly nearShape: BakedTree;
  private readonly farShape: BakedTree;
  /** Wood and leaves, near and far — four draws for the whole forest. */
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  /** The wood she cannot walk through, near her only. */
  private solid: TrunkField = NO_TRUNKS;
  /** Where the solid was last centred — HER position, not the cell's. */
  private solidAt: WorldPoint | null = null;
  /** The lattice cell she was in when the stand was last built. */
  private block: { cx: number; cz: number } | null = null;
  /** Where instances are measured from: the corner of that cell. */
  private anchor: WorldPoint = { wx: 0, wz: 0 };
  private lastAt: WorldPoint | null = null;
  private standing: Landmark[] = [];
  private nearCount = 0;

  constructor(private readonly scene: THREE.Scene, base = '') {
    this.nearShape = bakeUnitTree(BAKE_HEIGHT, GIRTH_OF_HEIGHT, BAKE_SEED, 0);
    this.farShape = bakeUnitTree(BAKE_HEIGHT, GIRTH_OF_HEIGHT, BAKE_SEED, 1);
    this.near = this.pair(this.nearShape, 64);
    this.far = this.pair(this.farShape, 512);
    // THE BARK, OFF THE LOADING PLAN. 644 KB is not worth holding the
    // world up for, and a tree with no bark yet is a brown tree rather
    // than an absent one. See public/tree-tex/README.md.
    if (base) void this.dressBark(base);
  }

  /** Fetch the bark and hang it on the wood. Absent is survivable. */
  private async dressBark(base: string): Promise<void> {
    const loader = new THREE.TextureLoader();
    const grab = (name: string): Promise<THREE.Texture | null> => loader
      .loadAsync(`${base}tree-tex/${name}.jpg`)
      .catch(() => null);
    const [colour, depth] = await Promise.all([
      grab('bark-mossy'), grab('bark-mossy_normal'),
    ]);
    if (colour) wearBark(this.bark, colour, depth);
  }

  /** One instanced mesh for the wood and one for the leaves. */
  private pair(shape: BakedTree, room: number): THREE.InstancedMesh[] {
    const out = [this.stand(shape.wood, this.bark, room)];
    if (shape.leaves) out.push(this.stand(shape.leaves, this.leaf, room));
    return out;
  }

  private stand(
    shape: THREE.BufferGeometry, paint: THREE.Material, room: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(shape, paint, room);
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

  /**
   * Grow the stand around her.
   *
   * TWO CADENCES, because the two things this holds have reaches two
   * orders of magnitude apart. What is DRAWN rebuilds on the lattice
   * cell and is otherwise left alone — twenty kilometres of trees do
   * not care where in a twenty-metre cell she stands. What is SOLID
   * re-centres on her every few metres, because it only reaches
   * further than she can walk in a few seconds. See SOLID_STEP.
   */
  follow(at: WorldPoint): void {
    this.lastAt = at;
    if (!haveVeg()) return;
    const cell = cellOf(at);
    if (!this.block || cell.cx !== this.block.cx || cell.cz !== this.block.cz) {
      this.block = cell;
      this.anchor = { wx: cell.cx * PITCH, wz: cell.cz * PITCH };
      this.refill(at);
      return;
    }
    const moved = this.solidAt === null ? Infinity
      : Math.hypot(at.wx - this.solidAt.wx, at.wz - this.solidAt.wz);
    if (moved > SOLID_STEP) this.resolid(at);
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
    this.resolid(at);
    this.place();
  }

  /**
   * RE-CENTRE THE WOOD SHE CAN WALK INTO on where she is now.
   *
   * A filter over the list the cell rebuild already produced, so it is
   * cheap enough to run every few metres — which is what it has to be,
   * SOLID_REACH being smaller than the cell.
   */
  private resolid(at: WorldPoint): void {
    this.solidAt = at;
    this.solid = new TrunkField(this.standing
      .filter((t) => Math.hypot(t.at.wx - at.wx, t.at.wz - at.wz) <= SOLID_REACH)
      .map((t) => this.standingOf(t, at)));
  }

  /**
   * One tree as something solid, at the SAME tessellation its mesh is
   * drawn at — a six-sided far trunk stands 15% proud of the circle it
   * was grown from, and she meets the corners.
   */
  private standingOf(tree: Landmark, at: WorldPoint): Standing {
    // AGAINST HER, exactly as `refill` splits what is drawn. Measuring
    // this from the cell corner instead let a tree be drawn at one
    // tessellation and made solid at another, and the two differ by
    // 15% of the trunk's width.
    const near = Math.hypot(
      tree.at.wx - at.wx, tree.at.wz - at.wz,
    ) <= NEAR_REACH;
    const level = near ? 0 : 1;
    // The corners for what she cannot pass through, the flats for what
    // she stands on — see profileFor. Seated on the corners she floats
    // a third of her own height off the bark.
    const profile = shapeOf(level, true);
    const seat = shapeOf(level, false);
    const foot = groundHeight(tree.at.wx, tree.at.wz) - burial(tree.height);
    return {
      id: tree.id,
      at: tree.at,
      foot,
      scale: tree.height,
      // THE TREE'S OWN SPIN, NOT ITS NEGATIVE. `bump` un-turns — it
      // applies the inverse rotation to the offset before reading the
      // profile — so handing it the cosine and sine of MINUS the spin
      // negates a negation and leaves the solid tree turned by TWICE
      // the spin away from the drawn one. A trunk wanders off its own
      // centre line by more than its radius, so a wrong turn moves the
      // wood sideways. Thronemound shipped exactly that and it was
      // reported as hovering.
      cos: Math.cos(tree.spin),
      sin: Math.sin(tree.spin),
      profile,
      seat,
      reach: (profile.widest + 0.02) * tree.height,
      top: foot + tree.height,
    };
  }

  /** What she cannot walk through, right now. */
  get trunks(): TrunkField { return this.solid; }

  private fill(
    meshes: THREE.InstancedMesh[], shape: BakedTree, trees: readonly Landmark[],
  ): THREE.InstancedMesh[] {
    let stand = meshes;
    if (trees.length > stand[0].instanceMatrix.count) {
      for (const mesh of stand) { this.scene.remove(mesh); mesh.dispose(); }
      stand = this.pair(shape, Math.ceil(trees.length * 1.5));
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
      for (const mesh of stand) mesh.setMatrixAt(i, m);
    });
    for (const mesh of stand) {
      mesh.count = trees.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    return stand;
  }

  /** Re-seat against the current origin. Called on every rebase. */
  place(): void {
    const seat = toLocal(this.anchor);
    for (const mesh of [...this.near, ...this.far]) {
      mesh.position.set(seat.lx, 0, seat.lz);
    }
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
    const cost = (shape: BakedTree): number => triangles(shape.wood)
      + (shape.leaves ? triangles(shape.leaves) : 0);
    return this.nearCount * cost(this.nearShape)
      + (this.standing.length - this.nearCount) * cost(this.farShape);
  }

  dispose(): void {
    for (const mesh of [...this.near, ...this.far]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    for (const shape of [this.nearShape, this.farShape]) {
      shape.wood.dispose();
      shape.leaves?.dispose();
    }
    this.bark.map?.dispose();
    this.bark.normalMap?.dispose();
    this.bark.dispose();
    this.leaf.dispose();
  }
}
