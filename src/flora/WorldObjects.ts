/**
 * THE WORLD'S OBJECTS, DRAWN — the bubble of grass, twigs, stones, rocks
 * and trees that follows the camera, streamed by cell and drawn as a
 * handful of instanced meshes.
 *
 * Joshua, 2026-09-06: "Kauaʻi determines what exists. The deterministic
 * world generator determines where it exists. Detail Quality determines
 * how much the device represents." The first two are core
 * (`world/habitat.ts`, `world/objects/populate.ts`) and this file never
 * argues with them: it asks the populator for a cell and draws what it
 * is handed. What this file DECIDES is the third question and the
 * mechanics under it — which cells are resident, which of a cell's
 * objects are drawn at this distance and this rung, and how twenty-five
 * thousand blades become a dozen draw calls.
 *
 * ─── the bubble ──────────────────────────────────────────────────────
 *
 * Cells within the rung's object radius are RESIDENT: generated once
 * (`populateCell`, nearest first, a few a frame so nothing stalls) and
 * kept until the camera has moved a hysteresis margin past the radius.
 * A cell far out is generated with only the families that reach that
 * far — trees and rocks — and regrown with the rest when the camera
 * comes near enough for grass to exist there; the families it already
 * had are regenerated identically (`populate.ts` promises so, and a
 * test holds it to it).
 *
 * ─── what is drawn ───────────────────────────────────────────────────
 *
 * Every object carries a RANK in 0..1 from its own hash. An object is
 * drawn when its rank is under the keep fraction for its family at its
 * distance (`families.keepFraction`) times the rung's draw fraction —
 * so the same blades vanish first every time, at the same distance, and
 * the far edge of the grass thins rather than ending at a wall. If the
 * survivors of a family still exceed the rung's CAP, the highest ranks
 * go until it fits: a cap is a maximum, never a quota (`budget.ts`).
 *
 * DISTANCE IS TRUE 3D DISTANCE FROM THE CAMERA — the master LOD rule v0
 * wrote down (docs/research/LOD_ARCHITECTURE.md): a camera a hundred
 * metres above a lawn is a hundred metres from every blade of it and
 * draws none, and the ground it will land on is still there because
 * the CELLS are planar and the DRAWING is spherical.
 *
 * THE INSTANCE BUFFERS ARE REWRITTEN ONLY WHEN SOMETHING CHANGED: the
 * camera moved `REFRESH_STEP`, a cell arrived or left, the ground's
 * revision moved. Between those a frame costs nothing here. The rewrite
 * is one pass over the resident cells composing matrices straight into
 * the instance arrays — no scene objects per blade, no per-object
 * listeners, no allocation past the first frame.
 *
 * ─── feet ────────────────────────────────────────────────────────────
 *
 * The populator places an object on the plane; where its foot sits in
 * height is read here from the LIVE heightfield and cached per cell
 * against `Heightfield.revision()`, so a tile landing re-seats the
 * objects on it and nothing else. That is the one place this file
 * reads the streamed ground, and it is why the plane position comes
 * from core and the height does not: the position must be the same on
 * every device, and the streamed ground is not.
 *
 * ─── ground contact ──────────────────────────────────────────────────
 *
 * Joshua, from the phone (2026-09-06): "some objects are underground
 * and twigs aren't lying flat on the ground… some objects need a basic
 * collision with ground and simple physics for now that can make it
 * roll, etc depending on the object." Nothing moves an object yet — no
 * ant, no wind — so the physics an object has for now is its REST: the
 * pose it would have come to after falling onto this ground. Each
 * family has its own, built from the ground's normal under the object:
 *
 *   grass   grows up, half persuaded by the slope, then leans its own way;
 *   tree    grows up; its foot is buried as deep as the slope needs so
 *           the downhill side of the trunk does not hang in the air;
 *   twig    lies ALONG the slope, resting on its radius, one end propped
 *           a few degrees at most;
 *   stone   sits on its base with the base on the slope, spun about the
 *   rock    normal, bedded a fraction of its size — rolled onto its
 *           flattest side, not turned any way up.
 *
 * Before this, rocks and stones took any rotation at all and a rock
 * turned past a right angle had its top where its foot was: seven in
 * ten rocks had more than half their body under the ground (measured
 * on the survey at four sites). Twigs took a uniform 0–90°.
 *
 * The normal is read from the live heightfield like the foot is, at a
 * quarter-metre step (the slope of the bilinear patch the object rests
 * on, not the lattice's 13.67 m average), and it is the SECOND and last
 * thing here that reads the streamed ground: where an object stands is
 * core's; how it touches the ground is the renderer's, because the
 * ground it touches is the drawn one.
 *
 * ─── the ecology pass's seven (2026-09-07) ───────────────────────────
 *
 * Fern, reed, flower, leaf litter, shrub, broadleaf and the coastal
 * spreader arrive as seven more stands — one InstancedMesh each, one
 * shared vertex-coloured material, every geometry a few dozen
 * triangles built here (`fernGeometry` and its siblings, at the foot of
 * the file) — and the grass gains a third stand for its seed head.
 * Each takes a rest like its nearest cousin above: ferns, reeds,
 * flowers, broad leaves and the coastal bush GROW UP as grass does,
 * half persuaded by the cell's slope; a LEAF lies along the slope as a
 * twig does, lifted a hair so it does not fight the ground for its
 * pixels; a SHRUB grows up and is buried as a tree is. Their colours
 * go through the same per-instance path as everything else; a
 * flower's head is white in the geometry and the instance colour is
 * the head's — white, yellow, red or violet by its variant — which its
 * dull green stem is multiplied by and survives.
 *
 * ─── what this is not ────────────────────────────────────────────────
 *
 * Not climbing, not collision for anything that moves, not a rock that
 * rolls when kicked: there is nothing to kick it yet. The seam for the
 * rest is the object's identity and its batch index, which a later pass
 * can attach a contact proxy to without this file changing shape. Not
 * wind: a per-blade CPU sway is exactly the per-frame cost this file is
 * built to avoid.
 */
import * as THREE from 'three';
import { local, type WorldPoint } from '../world/coords';
import type { Heightfield } from '../world/heightfield';
import type { Habitat } from '../world/habitat';
import { toLocal } from '../world/origin';
import { CELL_SPAN, cellCentre, cellKey, cellsWithin, distanceToCell, type ObjectCellId } from '../world/objects/cells';
import { FAMILY_SPECS, OBJECT_FAMILIES, familyReach, type ObjectFamily } from '../world/objects/families';
import { objectBudgetFor, type ObjectBudget } from '../world/objects/budget';
import {
  populateCell, type CellPopulation, type FamilyBatch, FLOWER_TINTS, GRASS_BROAD, GRASS_SEED_HEAD, TREE_PALM, TREE_SCRUB,
} from '../world/objects/populate';
import {
  BLADE_WIDTH_OF_HEIGHT, FLOWER_UNIT_HEAD, GROWS_LIKE_GRASS, plantTransformOf,
} from '../world/objects/plantTransform';
import { NO_DELTAS, type WorldDelta } from '../world/objects/seed';
import { bladeGeometry, broadBladeGeometry } from './bladeGeometry';
import { ROCK_VARIANTS, rockGeometry, stoneGeometry, twigGeometry } from './propGeometry';
import { bakeUnitTree, type TreeShape } from './treeGeometry';

/** 100 world units to the metre, as everywhere. */
const M = 100;

/**
 * How far the camera moves before the instance buffers are rewritten.
 * Three metres: at walking speed a rewrite every few seconds, at the
 * 30 m/s flying speed ten a second — measured on the HUD as `veg`.
 */
export const REFRESH_STEP = 3 * M;

/** How far past the radius a resident cell stays before it is let go. */
const KEEP_MARGIN = CELL_SPAN * 1.5;

/** Cells generated per frame at most, and the time they may take. */
const GENERATE_PER_FRAME = 3;
const GENERATE_BUDGET_MS = 2.5;
/** While cells are still arriving, how many frames may pass between refreshes. */
const REFRESH_EVERY_FRAMES = 6;

/** Trees are drawn with boughs inside this fraction of their reach, trunk-only beyond. */
const TREE_NEAR_OF_REACH = 0.4;

/** How far either side of an object's foot the ground is read for its normal: a quarter metre. */
const CONTACT_STEP = 0.25 * M;
/** A foot that moves more than this (half a centimetre) when a tile lands means the ground under the cell changed. */
const FOOT_MOVED = 0.5;
/**
 * The flower heads' colours by variant — white, yellow, red, violet —
 * PASTEL on purpose: the instance colour multiplies the whole
 * geometry, stem included, and a stem that is dull green in the
 * geometry stays a stem under any of these. GAME TUNING.
 */
const FLOWER_PALETTE: readonly (readonly [number, number, number])[] = Object.freeze([
  [1, 1, 0.92], [1, 0.9, 0.35], [1, 0.45, 0.5], [0.75, 0.55, 1],
]);
export interface WorldObjectsOptions {
  /** The live ground, for feet. Never the plane position. */
  readonly field: Heightfield;
  /** What belongs where. Deterministic; the populator reads it five times a cell. */
  readonly habitatAt: (at: WorldPoint) => Habitat;
  /** The world seed. */
  readonly seed: number;
  /** The detail rung's name, for the radius and the budget. */
  readonly detail: string;
  /** How far the bubble reaches at that rung, world units — `assets/detailQuality.objectRadius`. */
  readonly radius: number;
  readonly deltas?: WorldDelta;
}

/** What the HUD is told. Plain numbers; it never learns what a stand is. */
export interface ObjectsCost {
  readonly meanMs: number;
  readonly peakMs: number;
  /** Cells resident, and cells still waiting to be generated. */
  readonly cells: number;
  readonly pending: number;
  /** Instances drawn per family, after thinning and the cap. */
  readonly drawn: Readonly<Record<ObjectFamily, number>>;
  /** Instances generated per family across the resident cells, before thinning. */
  readonly generated: Readonly<Record<ObjectFamily, number>>;
  /** The bubble's radius, world units. */
  readonly radius: number;
  /** The habitat under the camera's cell, as a word. */
  readonly habitat: string;
}

/**
 * One family of one resident cell, COMPOSED ONCE: every object's matrix
 * and colour, the distance at which its rank makes it vanish, and which
 * stand it belongs to. A refresh compares and copies; it composes
 * nothing. Measured before this existed: 12–14 ms a refresh at 23,000
 * blades, most of it `Matrix4.compose` and an HSL conversion per blade,
 * every three metres and every frame the queue was draining.
 */
interface Composed {
  readonly count: number;
  /** 16 floats an object, translation in 12..14. `y` is patched when the feet move. */
  readonly matrices: Float32Array;
  readonly colours: Float32Array;
  /** The square of the 3D distance beyond which the object is not drawn, at this rung. */
  readonly vanish2: Float32Array;
  /**
   * How far below the foot the object's origin sits, in y: a rock's
   * bedding and a twig's lift along the normal, a tree's burial. The
   * normal's x/z share of that offset is already in the matrix.
   */
  readonly yOffset: Float32Array;
  /** Which stand draws it — for trees, the SHAPE; the level is chosen by distance. */
  readonly stand: Uint8Array;
  readonly rank: Float32Array;
  readonly wx: Float64Array;
  readonly wz: Float64Array;
  /** Foot heights, and the ground revision they were read at. */
  feet: Float32Array;
  feetRevision: number;
  /** The ground revision the POSES (normals) were composed at. Older than the ground's → recomposed, under budget. */
  readonly posedAt: number;
}

/** One resident cell: its population, and what the renderer has made of it so far. */
interface Resident {
  readonly id: ObjectCellId;
  population: CellPopulation;
  /** Which families were asked for when it was generated. */
  families: readonly ObjectFamily[];
  /** Composed lazily per family, on the first refresh that needs it. */
  composed: Partial<Record<ObjectFamily, Composed>>;
}

/** One instanced mesh: a family, a shape, a level. */
interface Stand {
  readonly family: ObjectFamily;
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  count: number;
}

const now = (): number => performance.now();

const DRAWN_ZERO: Readonly<Record<ObjectFamily, number>> = Object.freeze(
  Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0])) as Record<ObjectFamily, number>,
);

/** The families whose instances cast the sun's shadow: bodies, not blades. GAME TUNING; measured on the device. */
export const SHADOW_CASTERS: ReadonlySet<ObjectFamily> = new Set<ObjectFamily>(['tree', 'rock', 'shrub', 'broadleaf', 'fern', 'coastal']);
/** The families that take a shadow: the few whose fragments are worth the lookup. Grass takes the ground's, not its own. */
export const SHADOW_RECEIVERS: ReadonlySet<ObjectFamily> = new Set<ObjectFamily>(['tree', 'rock', 'shrub']);

export class WorldObjects {
  readonly group = new THREE.Group();
  readonly detail: string;
  readonly radius: number;

  private readonly field: Heightfield;
  private readonly habitatAt: (at: WorldPoint) => Habitat;
  private readonly seed: number;
  private readonly deltas: WorldDelta;
  private readonly budget: ObjectBudget;
  private readonly reach: Readonly<Record<ObjectFamily, number>>;

  private readonly resident = new Map<string, Resident>();
  private readonly queue: ObjectCellId[] = [];
  private queued = new Set<string>();
  /** Resident cells whose poses were composed against an older ground: a tile landed under them. */
  private readonly stale: string[] = [];
  private readonly staleSet = new Set<string>();
  private wantedAt: WorldPoint | null = null;
  private refreshedAt: { wx: number; wz: number; wy: number } | null = null;
  private refreshedRevision = -1;
  private dirty = true;
  private sinceRefresh = 0;

  private readonly stands: Stand[] = [];
  private readonly grassStands: Stand[];
  private readonly twigStand: Stand;
  private readonly stoneStands: Stand[];
  private readonly rockStands: Stand[];
  private readonly treeStands: Record<'near' | 'far', Stand[]>;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  private drawn: Record<ObjectFamily, number> = { ...DRAWN_ZERO };
  private generated: Record<ObjectFamily, number> = { ...DRAWN_ZERO };
  private cameraHabitat = 'sea';
  private frames = 0;
  private totalMs = 0;
  private peakMs = 0;

  // Scratch, allocated once.
  private readonly colour = new THREE.Color();
  private ranks = new Float32Array(4096);
  private keptCell = new Int32Array(4096);
  private keptIndex = new Int32Array(4096);
  /** The stands of each non-tree family, by the `stand` index the composer wrote. */
  private readonly standsOf: Readonly<Record<Exclude<ObjectFamily, 'tree'>, Stand[]>>;

  constructor(options: WorldObjectsOptions) {
    this.field = options.field;
    this.habitatAt = options.habitatAt;
    this.seed = options.seed;
    this.deltas = options.deltas ?? NO_DELTAS;
    this.detail = options.detail;
    this.radius = options.radius;
    this.budget = objectBudgetFor(options.detail);
    const reach: Partial<Record<ObjectFamily, number>> = {};
    for (const family of OBJECT_FAMILIES) reach[family] = familyReach(family, options.radius);
    this.reach = reach as Readonly<Record<ObjectFamily, number>>;
    this.group.name = 'vegetation';

    const plain = (colour: number): THREE.MeshLambertMaterial => {
      const material = new THREE.MeshLambertMaterial({ color: colour, fog: true });
      this.materials.push(material);
      return material;
    };
    const coloured = (): THREE.MeshLambertMaterial => {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
      this.materials.push(material);
      return material;
    };
    const stand = (family: ObjectFamily, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): Stand => {
      this.geometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.count = 0;
      // It rides the camera, so its bounds always contain the camera and
      // a frustum test could never reject it — the ocean's honest answer.
      mesh.frustumCulled = false;
      // THE SUN'S SHADOW (the lighting polish, 2026-09-07): the families
      // with a body cast it and take it; the blades never do either. A
      // grass blade is under any affordable texel and its 25,000
      // instances would pay the depth pass and the lookup in full for
      // pure acne; its shadow is the tree's, read on the ground beneath.
      mesh.castShadow = SHADOW_CASTERS.has(family);
      mesh.receiveShadow = SHADOW_RECEIVERS.has(family);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // A per-instance colour, so a lawn is not one green.
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `${family}`;
      this.group.add(mesh);
      const s: Stand = { family, mesh, capacity, count: 0 };
      this.stands.push(s);
      return s;
    };
    const caps = this.budget.caps;
    // GRASS: three silhouettes, one material. White so the instance colour is the colour.
    const grassMaterial = plain(0xffffff);
    this.grassStands = [
      stand('grass', bladeGeometry(), grassMaterial, caps.grass),
      stand('grass', broadBladeGeometry(), grassMaterial, caps.grass),
      stand('grass', seedHeadGeometry(), grassMaterial, caps.grass),
    ];
    this.twigStand = stand('twig', twigGeometry(), plain(0xffffff), caps.twig);
    const stoneMaterial = plain(0xffffff);
    this.stoneStands = [stand('stone', stoneGeometry(0), stoneMaterial, caps.stone), stand('stone', stoneGeometry(1), stoneMaterial, caps.stone)];
    const rockMaterial = plain(0xffffff);
    this.rockStands = [];
    for (let v = 0; v < ROCK_VARIANTS; v += 1) this.rockStands.push(stand('rock', rockGeometry(v), rockMaterial, caps.rock));
    // THE ECOLOGY PASS'S SEVEN: one stand each, one shared material.
    // Vertex-coloured so a flower's stem and a shrub's stem can be their
    // own colour under the instance's; double-sided because a frond, a
    // leaf and a bush are single planes seen from either side.
    const plantMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    this.materials.push(plantMaterial);
    this.standsOf = {
      grass: this.grassStands, twig: [this.twigStand], stone: this.stoneStands, rock: this.rockStands,
      fern: [stand('fern', fernGeometry(), plantMaterial, caps.fern)],
      reed: [stand('reed', reedGeometry(), plantMaterial, caps.reed)],
      flower: [stand('flower', flowerGeometry(), plantMaterial, caps.flower)],
      leaf: [stand('leaf', leafGeometry(), plantMaterial, caps.leaf)],
      shrub: [stand('shrub', shrubGeometry(), plantMaterial, caps.shrub)],
      broadleaf: [stand('broadleaf', broadleafGeometry(), plantMaterial, caps.broadleaf)],
      coastal: [stand('coastal', coastalGeometry(), plantMaterial, caps.coastal)],
    };
    // TREES: three shapes at two levels, wood and leaves in ONE geometry
    // per stand (both are vertex-coloured Lambert; the wood's UVs are
    // dropped because there is no bark map to read them). Six draw calls
    // for every tree in the bubble rather than twelve.
    const treeMaterial = coloured();
    const shapes: TreeShape[] = ['broad', 'scrub', 'palm'];
    this.treeStands = { near: [], far: [] };
    for (const shape of shapes) {
      this.treeStands.near.push(stand('tree', mergedTree(shape, 0), treeMaterial, caps.tree));
      this.treeStands.far.push(stand('tree', mergedTree(shape, 1), treeMaterial, caps.tree));
    }
  }

  /** The families a cell this far out is generated with: only those that reach it. */
  private familiesFor(distance: number): ObjectFamily[] {
    return OBJECT_FAMILIES.filter((family) => distance <= this.reach[family]);
  }

  /**
   * Generate everything within reach NOW — behind the loading screen,
   * the way the terrain's first fill and the sea's happen, so the world
   * is not bare for the first seconds of play.
   */
  prime(at: WorldPoint, height: number): void {
    this.want(at);
    while (this.queue.length > 0) this.generateOne();
    this.refresh(at, height);
    while (this.stale.length > 0) this.recomposeOne();
    this.resetCost();
  }

  /**
   * Walk the bubble after the camera: stream cells, and rewrite the
   * instances when the camera has moved enough for it to matter.
   * `height` is the camera's world y; distance is measured in 3D.
   */
  update(at: WorldPoint, height: number): void {
    const began = now();
    if (Number.isFinite(at.wx) && Number.isFinite(at.wz) && Number.isFinite(height)) {
      if (this.wantedAt === null
        || Math.abs(at.wx - this.wantedAt.wx) >= CELL_SPAN / 4
        || Math.abs(at.wz - this.wantedAt.wz) >= CELL_SPAN / 4) {
        this.want(at);
      }
      const until = began + GENERATE_BUDGET_MS;
      for (let n = 0; n < GENERATE_PER_FRAME && this.queue.length > 0 && now() < until; n += 1) this.generateOne();
      // What is left of the budget re-poses cells the ground moved under
      // — after the new cells, because a missing cell is a hole and a
      // stale one is a rock a few degrees off.
      for (let n = 0; n < GENERATE_PER_FRAME && this.stale.length > 0 && now() < until; n += 1) this.recomposeOne();
      const revision = this.field.revision();
      const moved = this.refreshedAt === null
        || Math.abs(at.wx - this.refreshedAt.wx) >= REFRESH_STEP
        || Math.abs(at.wz - this.refreshedAt.wz) >= REFRESH_STEP
        || Math.abs(height - this.refreshedAt.wy) >= REFRESH_STEP;
      // A cell arriving makes the picture stale, but not urgently: while
      // the queue drains a refresh every frame was the frame's biggest
      // cost, and cells landing in batches of a few is not something an
      // eye can tell from one at a time. So: on a move, on the ground
      // changing, when the queue has just emptied, or every few frames.
      this.sinceRefresh += 1;
      const settle = this.dirty && (this.queue.length === 0 || this.sinceRefresh >= REFRESH_EVERY_FRAMES);
      if (moved || revision !== this.refreshedRevision || settle) this.refresh(at, height);
    }
    const spent = now() - began;
    this.frames += 1;
    this.totalMs += spent;
    if (spent > this.peakMs) this.peakMs = spent;
  }

  /** Decide the resident set for a camera position: queue what is missing, drop what is far. */
  private want(at: WorldPoint): void {
    this.wantedAt = at;
    const wanted = cellsWithin(at, this.radius);
    const keep = new Set<string>();
    for (const id of wanted) {
      const key = cellKey(id);
      keep.add(key);
      const have = this.resident.get(key);
      const distance = distanceToCell(at, id);
      const families = this.familiesFor(distance);
      // Missing, or resident with fewer families than this distance needs.
      const needs = have === undefined || families.some((f) => !have.families.includes(f));
      if (needs && !this.queued.has(key)) {
        this.queue.push(id);
        this.queued.add(key);
      }
    }
    // Nearest first, so the ground under the camera fills before the rim.
    this.queue.sort((a, b) => distanceToCell(at, a) - distanceToCell(at, b));
    for (const [key, cell] of this.resident) {
      if (keep.has(key)) continue;
      if (distanceToCell(at, cell.id) > this.radius + KEEP_MARGIN) {
        this.resident.delete(key);
        this.dirty = true;
      }
    }
    // A queued cell that is no longer wanted is dropped from the queue.
    if (this.queue.length > 0) {
      const still = this.queue.filter((id) => keep.has(cellKey(id)));
      this.queue.length = 0;
      this.queue.push(...still);
      this.queued = new Set(still.map(cellKey));
    }
  }

  /** Generate the nearest queued cell. */
  private generateOne(): void {
    const id = this.queue.shift();
    if (id === undefined) return;
    const key = cellKey(id);
    this.queued.delete(key);
    const at = this.wantedAt ?? cellCentre(id);
    const families = this.familiesFor(distanceToCell(at, id));
    const have = this.resident.get(key);
    // Regrow with the union, so a cell never loses a family it had.
    const union = have === undefined ? families : Array.from(new Set([...have.families, ...families]));
    const population = populateCell(id, { seed: this.seed, habitatAt: this.habitatAt, deltas: this.deltas, families: union });
    const resident: Resident = { id, population, families: union, composed: {} };
    // COMPOSED HERE, under the generation budget, not inside a refresh:
    // a refresh that had to compose a six-thousand-blade cell it had
    // just walked into was the 36 ms frame the first measurement found.
    for (const family of union) {
      if (population.batches[family].count > 0) resident.composed[family] = this.compose(population.batches[family], family, population.habitat, id);
    }
    this.resident.set(key, resident);
    this.dirty = true;
  }

  /**
   * Re-pose the oldest stale cell against the ground as it is now —
   * every family but the grass. A blade follows the cell's normal at
   * half weight, so a tile that turns that normal ten degrees turns the
   * blade five, which no eye finds; and six thousand blades a cell is
   * what a re-pose costs. Measured with the grass included: a tile
   * landing under a primed bubble at `high` cost 1.4 ms a frame for
   * fifty frames and a 45 ms peak from the churn; without it, the
   * twigs, stones, rocks and trees of a cell re-pose in a fraction of
   * a millisecond and the feet (patched at once, in `composedOf`) were
   * never waiting on this anyway.
   */
  private recomposeOne(): void {
    const key = this.stale.shift();
    if (key === undefined) return;
    this.staleSet.delete(key);
    const cell = this.resident.get(key);
    if (cell === undefined) return;
    for (const family of cell.families) {
      if (family === 'grass') continue;
      const batch = cell.population.batches[family];
      if (batch.count > 0) cell.composed[family] = this.compose(batch, family, cell.population.habitat, cell.id);
    }
    this.dirty = true;
  }

  /**
   * The composed buffers of one family in one cell — built on first use,
   * then only their feet patched when the ground's revision moves.
   */
  private composedOf(cell: Resident, family: ObjectFamily, revision: number): Composed {
    let c = cell.composed[family];
    if (c === undefined) {
      c = this.compose(cell.population.batches[family], family, cell.population.habitat, cell.id);
      cell.composed[family] = c;
    }
    if (c.feetRevision !== revision) {
      // A tile landing moves the feet NOW: the translation's y is element
      // 13 of each matrix, and rotation and scale do not touch it. The
      // poses follow under budget (`recomposeOne`), because a foot a
      // metre off is a floating rock and a normal a few degrees off is
      // not something an eye can find.
      const point = { wx: 0, wz: 0 } as unknown as { wx: number; wz: number };
      let moved = false;
      for (let i = 0; i < c.count; i += 1) {
        point.wx = c.wx[i];
        point.wz = c.wz[i];
        const foot = this.field.heightAt(point as unknown as WorldPoint);
        if (Math.abs(foot - c.feet[i]) > FOOT_MOVED) moved = true;
        c.feet[i] = foot;
        c.matrices[i * 16 + 13] = foot - c.yOffset[i];
      }
      c.feetRevision = revision;
      // Re-pose only where the ground ACTUALLY moved. The revision is
      // the whole island's — a tile landing across the bay bumps it —
      // and a cell whose feet all stayed put has the same ground under
      // it, so its normals are the same too. Measured before this
      // guard: nine tiles landing after a fresh start re-posed every
      // resident cell nine times, and the bubble's mean cost while the
      // world settled tripled.
      if (moved && c.posedAt !== revision) {
        const key = cellKey(cell.id);
        if (!this.staleSet.has(key)) {
          this.staleSet.add(key);
          this.stale.push(key);
        }
      }
    }
    return c;
  }

  /**
   * Compose one family of one cell: matrix, colour, vanish distance and
   * stand per object. Once per cell per family, at generation, and again
   * when the ground under the cell changes. The feet are filled by
   * `composedOf` and the y patched there.
   *
   * THE POSE IS THE FAMILY'S REST ON THIS GROUND (see the header). Every
   * object gets a frame [X, U, Z]: U its up — straight up for a tree,
   * the ground's normal for a stone, a rock or a twig, a blend for grass
   * — X the tangent at the object's own spin, Z = X × U. A twig's frame
   * is the same one turned so its length lies along X. The family's
   * small departure from rest (`lean` about a tangent axis at `leanDir`)
   * is then a rotation in the FRAME'S coordinates, applied as a right
   * multiplication, and the columns are scaled.
   *
   * WRITTEN OUT BY HAND rather than through `Matrix4.compose` and an HSL
   * conversion per object, because six thousand blades a cell is where
   * a library call per object turns into a frame. The trig for the spin
   * and the lean comes from a table, because a blade's spin to a third
   * of a degree is not a thing anyone can see; the normal's arithmetic
   * is a handful of multiplies. The colour is the cell's habitat colour
   * scaled per object by its tint — one multiply a channel.
   *
   * THE NORMAL IS READ PER OBJECT for twigs, stones, rocks and trees —
   * four heights a quarter metre either side of the foot, a few hundred
   * objects a cell — and ONCE PER CELL for grass: a blade grows up more
   * than it follows the ground, and six thousand normals a cell would
   * double what the cell costs for a lean no eye could tell apart.
   */
  private compose(batch: FamilyBatch, family: ObjectFamily, habitat: Habitat, id: ObjectCellId): Composed {
    const n = batch.count;
    const matrices = new Float32Array(n * 16);
    const colours = new Float32Array(n * 3);
    const vanish2 = new Float32Array(n);
    const yOffset = new Float32Array(n);
    const stand = new Uint8Array(n);
    const reach = this.reach[family];
    const draw = this.budget.draw[family];
    const posedAt = this.field.revision();
    // The family's colour for this cell, and how far a tint swings it.
    let baseR = 1, baseG = 1, baseB = 1, swing = 0.3;
    switch (family) {
      case 'grass': this.grassColour(0.5, habitat); swing = 0.45; break;
      case 'twig': this.colour.setHSL(0.09, 0.35, 0.24); swing = 0.5; break;
      case 'stone': case 'rock': this.stoneColour(0.5, habitat); swing = 0.6; break;
      case 'tree': this.colour.setRGB(1, 1, 1); swing = 0.24; break;
      // The seven: greens varied by habitat like the grass, litter in browns,
      // a flower's head from its palette per instance below. GAME TUNING.
      case 'fern': this.colour.setHSL(0.30, 0.48, 0.20 + 0.06 * habitat.wet); swing = 0.35; break;
      case 'reed': this.colour.setHSL(0.20, 0.45, 0.32); swing = 0.4; break;
      case 'flower': this.colour.setRGB(1, 1, 1); swing = 0.2; break;
      case 'leaf': this.colour.setHSL(0.075, 0.45, 0.28); swing = 0.6; break;
      case 'shrub': this.grassColour(0.5, habitat); this.colour.offsetHSL(0.03, -0.05, -0.06); swing = 0.35; break;
      case 'broadleaf': this.colour.setHSL(0.31, 0.5, 0.25); swing = 0.35; break;
      case 'coastal': this.colour.setHSL(0.21, 0.5, 0.40); swing = 0.3; break;
    }
    baseR = this.colour.r; baseG = this.colour.g; baseB = this.colour.b;
    // The cell normal is part of the shared plant transform. Families that
    // grow like grass use its half-slope blend; shrubs and trees use their
    // foot normal before forcing their visual up to world-up.
    const cellNormal = this.field.normalAt(cellCentre(id));
    const point = { wx: 0, wz: 0 } as unknown as { wx: number; wz: number };
    for (let i = 0; i < n; i += 1) {
      const size = batch.size[i];
      const girth = batch.girth[i];
      // ── the ground under this object, for families not using the cell normal ──
      let groundNormal = cellNormal;
      if (!GROWS_LIKE_GRASS.has(family)) {
        point.wx = batch.wx[i];
        point.wz = batch.wz[i];
        groundNormal = this.field.normalAt(point as unknown as WorldPoint, CONTACT_STEP);
      }
      const transform = plantTransformOf({
        family, size, variant: batch.variant[i], girth, spin: batch.spin[i], lean: batch.lean[i], leanDir: batch.leanDir[i],
      }, {
        ground: { x: groundNormal.nx, y: groundNormal.ny, z: groundNormal.nz },
        cell: { x: cellNormal.nx, y: cellNormal.ny, z: cellNormal.nz },
      });
      if (family === 'grass') stand[i] = batch.variant[i] === GRASS_SEED_HEAD ? 2 : batch.variant[i] === GRASS_BROAD ? 1 : 0;
      else if (family === 'tree') stand[i] = batch.variant[i] === TREE_PALM ? 2 : batch.variant[i] === TREE_SCRUB ? 1 : 0;
      else if (family === 'stone') stand[i] = batch.variant[i] & 1;
      else if (family === 'rock') stand[i] = batch.variant[i] % ROCK_VARIANTS;
      else stand[i] = 0;
      yOffset[i] = -transform.origin.y;
      const o = i * 16;
      matrices[o] = transform.x.x * transform.scaleX;
      matrices[o + 1] = transform.x.y * transform.scaleX;
      matrices[o + 2] = transform.x.z * transform.scaleX;
      matrices[o + 3] = 0;
      matrices[o + 4] = transform.y.x * transform.scaleY;
      matrices[o + 5] = transform.y.y * transform.scaleY;
      matrices[o + 6] = transform.y.z * transform.scaleY;
      matrices[o + 7] = 0;
      matrices[o + 8] = transform.z.x * transform.scaleZ;
      matrices[o + 9] = transform.z.y * transform.scaleZ;
      matrices[o + 10] = transform.z.z * transform.scaleZ;
      matrices[o + 11] = 0;
      // THE ONE WORLD → LOCAL CROSSING, through the origin like every renderer.
      const here = toLocal({ wx: batch.wx[i], wz: batch.wz[i] } as WorldPoint);
      matrices[o + 12] = here.lx + transform.origin.x;
      matrices[o + 13] = 0;
      matrices[o + 14] = here.lz + transform.origin.z;
      matrices[o + 15] = 1;
      const shade = 1 - swing / 2 + swing * batch.tint[i];
      if (family === 'flower') {
        // The instance colour is the HEAD's: the geometry's head is white
        // and its stem dull green, and both are multiplied by this.
        const head = FLOWER_PALETTE[batch.variant[i] % FLOWER_TINTS];
        colours[i * 3] = head[0] * shade;
        colours[i * 3 + 1] = head[1] * shade;
        colours[i * 3 + 2] = head[2] * shade;
      } else {
        colours[i * 3] = baseR * shade;
        colours[i * 3 + 1] = baseG * shade;
        colours[i * 3 + 2] = baseB * shade;
      }
      const v = vanishDistance(family, batch.rank[i], draw, reach);
      vanish2[i] = v * v;
    }
    return {
      count: n, matrices, colours, vanish2, yOffset, stand,
      rank: batch.rank, wx: batch.wx, wz: batch.wz,
      feet: new Float32Array(n), feetRevision: -1, posedAt,
    };
  }

  /**
   * Rewrite every stand from the resident cells for this camera
   * position: keep what is nearer than its vanish distance, cap by rank,
   * copy the composed matrices across. The only per-frame work here that
   * grows with the count, and it is a compare and a copy per object.
   */
  private refresh(at: WorldPoint, height: number): void {
    this.refreshedAt = { wx: at.wx, wz: at.wz, wy: height };
    const revision = this.field.revision();
    this.refreshedRevision = revision;
    this.dirty = false;
    this.sinceRefresh = 0;
    for (const stand of this.stands) stand.count = 0;
    const drawn: Record<ObjectFamily, number> = { ...DRAWN_ZERO };
    const generated: Record<ObjectFamily, number> = { ...DRAWN_ZERO };
    const caps = this.budget.caps;

    // The camera's own cell names the habitat on the HUD.
    const under = this.resident.get(cellKey({ cx: Math.floor(at.wx / CELL_SPAN), cz: Math.floor(at.wz / CELL_SPAN) }));
    this.cameraHabitat = under === undefined ? this.habitatAt(at).kind : under.population.habitat.kind;

    const cells = Array.from(this.resident.values());
    for (const family of OBJECT_FAMILIES) {
      const reach = this.reach[family];
      const treeNear2 = (reach * TREE_NEAR_OF_REACH) ** 2;
      // PASS 1: survivors of the distance thinning, as (cell, index, rank).
      let kept = 0;
      let total = 0;
      for (let c = 0; c < cells.length; c += 1) total += cells[c].population.batches[family].count;
      generated[family] = total;
      if (total === 0) continue;
      this.room(total);
      const ranks = this.ranks;
      const keptCell = this.keptCell;
      const keptIndex = this.keptIndex;
      for (let c = 0; c < cells.length; c += 1) {
        const cell = cells[c];
        if (cell.population.batches[family].count === 0) continue;
        // Quick reject: the whole cell is past the family's reach.
        if (distanceToCell(at, cell.id) > reach) continue;
        const composed = this.composedOf(cell, family, revision);
        const feet = composed.feet;
        const vanish2 = composed.vanish2;
        for (let i = 0; i < composed.count; i += 1) {
          const dx = composed.wx[i] - at.wx;
          const dz = composed.wz[i] - at.wz;
          const dy = feet[i] - height;
          const d2 = dx * dx + dz * dz + dy * dy;
          if (d2 >= vanish2[i]) continue;
          ranks[kept] = composed.rank[i];
          keptCell[kept] = c;
          keptIndex[kept] = i;
          kept += 1;
        }
      }

      // THE CAP: a maximum, by rank. If more survived than the rung allows,
      // find the rank below which exactly `cap` fall and drop the rest.
      let cutoff = 2;
      const cap = caps[family];
      if (kept > cap) cutoff = rankCutoff(ranks, kept, cap);

      // PASS 2: copy the survivors into their stands.
      for (let k = 0; k < kept; k += 1) {
        if (ranks[k] >= cutoff) continue;
        const cell = cells[keptCell[k]];
        const i = keptIndex[k];
        const composed = cell.composed[family] as Composed;
        let stand: Stand;
        if (family === 'tree') {
          const dx = composed.wx[i] - at.wx;
          const dz = composed.wz[i] - at.wz;
          stand = this.treeStands[dx * dx + dz * dz <= treeNear2 ? 'near' : 'far'][composed.stand[i]];
        } else {
          stand = this.standsOf[family][composed.stand[i]];
        }
        if (stand.count >= stand.capacity) continue;
        const into = stand.mesh.instanceMatrix.array as Float32Array;
        const from = composed.matrices;
        const src = i * 16;
        const dst = stand.count * 16;
        for (let e = 0; e < 16; e += 1) into[dst + e] = from[src + e];
        const tint = (stand.mesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
        tint[stand.count * 3] = composed.colours[i * 3];
        tint[stand.count * 3 + 1] = composed.colours[i * 3 + 1];
        tint[stand.count * 3 + 2] = composed.colours[i * 3 + 2];
        stand.count += 1;
        drawn[family] += 1;
      }
    }
    for (const stand of this.stands) {
      stand.mesh.count = stand.count;
      stand.mesh.instanceMatrix.needsUpdate = true;
      if (stand.mesh.instanceColor) stand.mesh.instanceColor.needsUpdate = true;
    }
    this.drawn = drawn;
    this.generated = generated;
  }

  /** Grow the survivor scratch to hold `n`. Allocation only when the bubble outgrows what it had. */
  private room(n: number): void {
    if (this.ranks.length >= n) return;
    let size = this.ranks.length;
    while (size < n) size *= 2;
    this.ranks = new Float32Array(size);
    this.keptCell = new Int32Array(size);
    this.keptIndex = new Int32Array(size);
  }

  /**
   * Grass colour: green where the ground is wet and shaded, straw where
   * it is dry and open, and a per-blade shift so a lawn is not one green.
   * GAME TUNING.
   */
  private grassColour(tint: number, habitat: Habitat): void {
    const dry = Math.min(1, 0.6 * habitat.coast + 0.5 * habitat.bare + 0.4 * habitat.exposure - 0.5 * habitat.wet - 0.3 * habitat.forest);
    const hue = 0.24 + 0.04 * (tint - 0.5) - 0.08 * Math.max(0, dry);
    const sat = 0.55 - 0.2 * Math.max(0, dry);
    const light = 0.28 + 0.14 * tint + 0.08 * Math.max(0, dry);
    this.colour.setHSL(hue, sat, light);
  }

  /** Rock colour: Kauaʻi's basalt greys, warming toward Waimea's red where the ground is bare and high. */
  private stoneColour(tint: number, habitat: Habitat): void {
    const warm = 0.5 * habitat.bare + 0.3 * habitat.exposure;
    this.colour.setHSL(0.06, 0.08 + 0.25 * warm, 0.26 + 0.2 * tint);
  }

  /** How many cells are resident, for a test. */
  get residentCells(): number {
    return this.resident.size;
  }

  /** How many cells are waiting, for a test. */
  get pendingCells(): number {
    return this.queue.length;
  }

  /** A resident cell's population, for a test. */
  populationOf(id: ObjectCellId): CellPopulation | null {
    return this.resident.get(cellKey(id))?.population ?? null;
  }

  /** The stands' live instance counts, for a test. */
  standCounts(): { readonly family: ObjectFamily; readonly count: number; readonly capacity: number }[] {
    return this.stands.map((s) => ({ family: s.family, count: s.mesh.count, capacity: s.capacity }));
  }

  get cost(): ObjectsCost {
    return Object.freeze({
      meanMs: this.frames === 0 ? 0 : this.totalMs / this.frames,
      peakMs: this.peakMs,
      cells: this.resident.size,
      pending: this.queue.length,
      drawn: { ...this.drawn },
      generated: { ...this.generated },
      radius: this.radius,
      habitat: this.cameraHabitat,
    });
  }

  resetCost(): void {
    this.frames = 0;
    this.totalMs = 0;
    this.peakMs = 0;
  }

  dispose(): void {
    for (const stand of this.stands) {
      this.group.remove(stand.mesh);
      stand.mesh.dispose();
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.stands.length = 0;
    this.resident.clear();
    this.queue.length = 0;
    this.queued.clear();
    this.stale.length = 0;
    this.staleSet.clear();
  }
}

/**
 * The rank below which exactly `cap` of the first `n` ranks fall: a
 * histogram cut rather than a sort, so the cap costs one pass over the
 * survivors and not n log n every refresh. 1,024 bins over 0..1 puts the
 * cut within a thousandth, and a thousandth of a rank is nothing to see.
 */
export function rankCutoff(ranks: Float32Array, n: number, cap: number): number {
  const BINS = 1024;
  const hist = new Int32Array(BINS);
  for (let i = 0; i < n; i += 1) hist[Math.min(BINS - 1, Math.floor(ranks[i] * BINS))] += 1;
  let seen = 0;
  for (let b = 0; b < BINS; b += 1) {
    if (seen + hist[b] > cap) return b / BINS;
    seen += hist[b];
  }
  return 2;
}

/**
 * The distance beyond which an object of this rank is not drawn: the
 * inverse of `families.keepFraction` at `rank / draw`, so a refresh is
 * one squared compare per object instead of a smoothstep and a divide.
 *
 *   kept while  rank < keep(d) · draw   ⇔   keep(d) > rank / draw =: r
 *   r ≥ 1        never drawn at this rung (the draw fraction thins it)
 *   r ≤ farKeep  drawn to the reach
 *   otherwise    inside the band where keep falls from 1 to farKeep:
 *                keep(d) = 1 + (farKeep − 1)·s(t), s the smoothstep,
 *                solved for t by bisection (monotone, eight steps is a
 *                thousandth of the band)
 */
export function vanishDistance(family: ObjectFamily, rank: number, draw: number, reach: number): number {
  const spec = FAMILY_SPECS[family];
  const r = draw <= 0 ? Infinity : rank / draw;
  if (r >= 1) return 0;
  if (r <= spec.farKeep) return reach;
  const from = reach * spec.fullUntil;
  // Find t in [0, 1] with 1 + (farKeep − 1)·s(t) = r, i.e. s(t) = (1 − r)/(1 − farKeep).
  const target = (1 - r) / (1 - spec.farKeep);
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 12; step += 1) {
    const mid = (lo + hi) / 2;
    const smooth = mid * mid * (3 - 2 * mid);
    if (smooth < target) lo = mid;
    else hi = mid;
  }
  return from + ((lo + hi) / 2) * (reach - from);
}

/**
 * A tree's wood and leaves as ONE geometry with position, normal and
 * colour — the two share a vertex-coloured Lambert, so one draw call is
 * the honest count. The wood's UVs are left out: there is no bark map in
 * this milestone to read them, and a merge needs matching attributes.
 */
function mergedTree(shape: TreeShape, level: 0 | 1): THREE.BufferGeometry {
  const baked = bakeUnitTree(shape, 0x7e11 + level, level);
  const parts = [baked.wood, baked.leaves].filter((g): g is THREE.BufferGeometry => g !== null);
  let count = 0;
  for (const g of parts) count += g.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let offset = 0;
  for (const g of parts) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const nn = g.getAttribute('normal') as THREE.BufferAttribute;
    const cc = g.getAttribute('color') as THREE.BufferAttribute;
    const index = g.getIndex();
    const n = index ? index.count : p.count;
    for (let i = 0; i < n; i += 1) {
      const v = index ? index.getX(i) : i;
      pos[(offset + i) * 3] = p.getX(v); pos[(offset + i) * 3 + 1] = p.getY(v); pos[(offset + i) * 3 + 2] = p.getZ(v);
      nrm[(offset + i) * 3] = nn.getX(v); nrm[(offset + i) * 3 + 1] = nn.getY(v); nrm[(offset + i) * 3 + 2] = nn.getZ(v);
      col[(offset + i) * 3] = cc.getX(v); col[(offset + i) * 3 + 1] = cc.getY(v); col[(offset + i) * 3 + 2] = cc.getZ(v);
    }
    offset += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, offset * 3), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, offset * 3), 3));
  out.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, offset * 3), 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * ─── THE SEVEN'S GEOMETRY, AND THE SEED HEAD ─────────────────────────
 *
 * Built here rather than in a bake file of their own because each is a
 * dozen lines and a few dozen triangles: flat-shaded triangle soup with
 * a colour per triangle, in a UNIT space the instance scales — the foot
 * at y = 0, the top at y = 1, the spread about 1 across — so `compose`
 * above can name what `girth` scales per family and be right. Every
 * geometry here carries a `color` attribute because they share one
 * vertex-coloured material; white where the instance colour should be
 * the colour, and a stem's own green or brown where it should not.
 * All procedural, like the rocks and twigs (Joshua, 2026-09-06); art
 * can replace any of them behind the same stand.
 */
type P3 = readonly [number, number, number];
type RGB = readonly [number, number, number];
const WHITE: RGB = [1, 1, 1];
const STEM_GREEN: RGB = [0.35, 0.5, 0.25];
const STEM_BROWN: RGB = [0.35, 0.25, 0.15];

/** A flat-shaded triangle soup: positions, per-face normals, a colour per face. */
class Soup {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];
  private count = 0;

  tri(a: P3, b: P3, c: P3, colour: RGB): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c]) {
      this.positions.push(q[0], q[1], q[2]);
      this.normals.push(nx, ny, nz);
      this.colours.push(colour[0], colour[1], colour[2]);
    }
    this.count += 1;
  }

  quad(a: P3, b: P3, c: P3, d: P3, colour: RGB): void {
    this.tri(a, b, c, colour);
    this.tri(a, c, d, colour);
  }

  /** A fan about a centre through a closed ring of points. */
  fan(centre: P3, ring: readonly P3[], colour: RGB): void {
    for (let i = 0; i < ring.length; i += 1) this.tri(centre, ring[i], ring[(i + 1) % ring.length], colour);
  }

  /** A strip between two runs of points of equal length: a frond, a leaf, a tube's side. */
  strip(left: readonly P3[], right: readonly P3[], colour: RGB): void {
    for (let i = 0; i + 1 < left.length; i += 1) this.quad(left[i], right[i], right[i + 1], left[i + 1], colour);
  }

  get triangles(): number {
    return this.count;
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** A point turned about +y by `angle`. */
function turned(p: P3, angle: number): P3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
}

/**
 * A frond or a broad leaf: a strip along a curve of (radius, height)
 * points with a half-width at each, in the vertical plane at `angle`,
 * its width tangential. Rendered double-sided, so its facing is moot.
 */
function frond(soup: Soup, curve: readonly (readonly [number, number])[], halfWidths: readonly number[], angle: number, colour: RGB): void {
  const left: P3[] = [];
  const right: P3[] = [];
  for (let i = 0; i < curve.length; i += 1) {
    const [r, y] = curve[i];
    left.push(turned([r, y, -halfWidths[i]], angle));
    right.push(turned([r, y, halfWidths[i]], angle));
  }
  soup.strip(left, right, colour);
}

/** A closed tube along +y between two heights, `sides` faces, radii at the foot and the top. */
function tube(soup: Soup, sides: number, y0: number, y1: number, r0: number, r1: number, colour: RGB, x1 = 0): void {
  const foot: P3[] = [];
  const top: P3[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    foot.push([Math.cos(a) * r0, y0, Math.sin(a) * r0]);
    top.push([Math.cos(a) * r1 + x1, y1, Math.sin(a) * r1]);
  }
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    soup.quad(foot[i], foot[j], top[j], top[i], colour);
  }
}

/**
 * An eight-point blob ring in the plane at `angle`, about (0, cy), with
 * radii rx across and ry up, wobbled INWARD so it is not an ellipse and
 * never reaches past the radii: the unit stays the unit.
 */
function blob(cy: number, rx: number, ry: number, angle: number, wobble: number): P3[] {
  const ring: P3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const w = 1 - wobble * (0.5 + 0.5 * Math.sin(a * 3 + angle * 5));
    ring.push(turned([Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w, 0], angle));
  }
  return ring;
}

/** A horizontal eight-point ring at height `y`, radius `r`, wobbled inward. */
function cap(y: number, r: number, wobble: number): P3[] {
  const ring: P3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const w = 1 - wobble * (0.5 + 0.5 * Math.sin(a * 3 + 1));
    ring.push([Math.cos(a) * r * w, y, Math.sin(a) * r * w]);
  }
  return ring;
}

/**
 * The grass's seed head: Joshua's blade with a small diamond at the
 * tip. Shares the grass material (no vertex colours), so it is the
 * blade's own triangles plus eight more, position and normal only.
 * Twenty triangles.
 */
export function seedHeadGeometry(): THREE.BufferGeometry {
  const blade = bladeGeometry();
  const bp = blade.getAttribute('position') as THREE.BufferAttribute;
  const bn = blade.getAttribute('normal') as THREE.BufferAttribute;
  const positions = Array.from(bp.array as Float32Array);
  const normals = Array.from(bn.array as Float32Array);
  blade.dispose();
  // The head: an octahedron 0.14 tall and 0.1 across (the blade is 0.065 wide), its foot at 0.86.
  const w = 0.05;
  const bottom: P3 = [0, 0.86, 0];
  const top: P3 = [0, 1.0, 0];
  const mid: P3[] = [[w, 0.92, 0], [0, 0.92, w], [-w, 0.92, 0], [0, 0.92, -w]];
  const push = (a: P3, b: P3, c: P3): void => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c]) { positions.push(q[0], q[1], q[2]); normals.push(nx, ny, nz); }
  };
  for (let i = 0; i < 4; i += 1) {
    const a = mid[i], b = mid[(i + 1) % 4];
    push(bottom, b, a);
    push(top, a, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A fern: four fronds arching out and drooping from a centre, each a
 * three-segment strip. Unit: the arch's top at y = 1, the tips a unit
 * out. Twenty-four triangles.
 */
export function fernGeometry(): THREE.BufferGeometry {
  const soup = new Soup();
  const curve: (readonly [number, number])[] = [[0.02, 0.05], [0.35, 0.6], [0.7, 1.0], [1.0, 0.8]];
  const widths = [0.03, 0.12, 0.13, 0.04];
  for (let i = 0; i < 4; i += 1) frond(soup, curve, widths, i * (Math.PI / 2) + 0.3, WHITE);
  return soup.build();
}

/**
 * A reed: a cluster of three blades — Joshua's blade thrice, at three
 * heights, spread a blade-width or two apart and turned so they do
 * not stand in one plane. Thirty-six triangles.
 */
export function reedGeometry(): THREE.BufferGeometry {
  const blade = bladeGeometry();
  const bp = blade.getAttribute('position') as THREE.BufferAttribute;
  const bn = blade.getAttribute('normal') as THREE.BufferAttribute;
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const w = BLADE_WIDTH_OF_HEIGHT;
  const stems: { readonly dx: number; readonly dz: number; readonly h: number; readonly turn: number }[] = [
    { dx: 0, dz: 0, h: 1, turn: 0 },
    { dx: 1.5 * w, dz: 0.5 * w, h: 0.85, turn: 2.1 },
    { dx: -1.0 * w, dz: 1.3 * w, h: 0.72, turn: 4.2 },
  ];
  for (const stem of stems) {
    const c = Math.cos(stem.turn), s = Math.sin(stem.turn);
    for (let i = 0; i < bp.count; i += 1) {
      const x = bp.getX(i), y = bp.getY(i) * stem.h, z = bp.getZ(i);
      positions.push(x * c - z * s + stem.dx, y, x * s + z * c + stem.dz);
      const nx = bn.getX(i), ny = bn.getY(i), nz = bn.getZ(i);
      normals.push(nx * c - nz * s, ny, nx * s + nz * c);
      colours.push(1, 1, 1);
    }
  }
  blade.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A flower: a thin three-sided stem, dull green, and a shallow
 * six-sided cone of a head, white, so the instance colour is the
 * head's. Unit: the head at y ≈ 0.9, its radius `FLOWER_UNIT_HEAD`.
 * Twelve triangles.
 */
export function flowerGeometry(): THREE.BufferGeometry {
  const soup = new Soup();
  tube(soup, 3, 0, 0.88, 0.02, 0.015, STEM_GREEN, 0.03);
  const ring: P3[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ring.push([0.03 + Math.cos(a) * FLOWER_UNIT_HEAD, 0.9, Math.sin(a) * FLOWER_UNIT_HEAD]);
  }
  soup.fan([0.03, 0.96, 0], ring, WHITE);
  return soup.build();
}

/**
 * A fallen leaf: an outline with a raised midrib, so it is a tent and
 * not a sheet. Built in the x–y plane with its length along +y and the
 * rib toward +z, which the twig frame lays along the ground with the
 * rib UP. Unit: length 1, width 1. Ten triangles.
 */
export function leafGeometry(): THREE.BufferGeometry {
  const soup = new Soup();
  const base: P3 = [0, 0, 0];
  const tip: P3 = [0, 1, 0];
  const right: P3[] = [[0.35, 0.2, 0], [0.5, 0.45, 0], [0.32, 0.78, 0]];
  const left: P3[] = [[-0.35, 0.2, 0], [-0.5, 0.45, 0], [-0.32, 0.78, 0]];
  const rib: P3[] = [[0, 0.25, 0.15], [0, 0.6, 0.15]];
  for (const side of [right, left]) {
    soup.tri(base, side[0], rib[0], WHITE);
    soup.tri(side[0], side[1], rib[0], WHITE);
    soup.tri(side[1], rib[1], rib[0], WHITE);
    soup.tri(side[1], side[2], rib[1], WHITE);
    soup.tri(side[2], tip, rib[1], WHITE);
  }
  return soup.build();
}

/**
 * A shrub: a short brown stem under a canopy of three crossed vertical
 * blobs and a horizontal cap, white. Unit: height 1, width
 * `SHRUB_UNIT_WIDTH`. Forty triangles.
 */
export function shrubGeometry(): THREE.BufferGeometry {
  const soup = new Soup();
  tube(soup, 4, 0, 0.4, 0.035, 0.025, STEM_BROWN);
  for (let i = 0; i < 3; i += 1) {
    const angle = i * (Math.PI / 3) + 0.2;
    soup.fan(turned([0, 0.65, 0], angle), blob(0.65, 0.5, 0.35, angle, 0.12), WHITE);
  }
  soup.fan([0, 0.78, 0], cap(0.75, 0.42, 0.15), WHITE);
  return soup.build();
}

/**
 * A broad-leaved ground plant: three wide leaves reaching out and up
 * from the foot, then drooping. Unit: the leaves' top at y = 1, their
 * tips `BROADLEAF_UNIT_REACH` out. Eighteen triangles.
 */
export function broadleafGeometry(): THREE.BufferGeometry {
  const soup = new Soup();
  const curve: (readonly [number, number])[] = [[0.0, 0.05], [0.35, 0.5], [0.7, 1.0], [1.0, 0.8]];
  const widths = [0.04, 0.25, 0.32, 0.12];
  for (let i = 0; i < 3; i += 1) frond(soup, curve, widths, i * (2 * Math.PI / 3) + 0.5, WHITE);
  return soup.build();
}

/**
 * The coastal spreader: a low mound — two crossed vertical blobs, wide
 * and low, under a horizontal cap. Unit: height 1, spread
 * `COASTAL_UNIT_SPREAD` across. Twenty-four triangles.
 */
export function coastalGeometry(): THREE.BufferGeometry {
  const soup = new Soup();
  for (let i = 0; i < 2; i += 1) {
    const angle = i * (Math.PI / 2) + 0.4;
    soup.fan(turned([0, 0.5, 0], angle), blob(0.5, 1.0, 0.5, angle, 0.1), WHITE);
  }
  soup.fan([0, 0.7, 0], cap(0.62, 0.8, 0.12), WHITE);
  return soup.build();
}

/** Where a cell's centre is, as a local point, for anything that wants to draw a debug marker. */
export function cellCentreLocal(id: ObjectCellId): { lx: number; lz: number } {
  const c = cellCentre(id);
  const l = toLocal(c);
  return local(l.lx, l.lz);
}
