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
 * ─── what this is not ────────────────────────────────────────────────
 *
 * Not physics, not climbing, not collision: visual instances only, by
 * the brief. The seam for the rest is the object's identity and its
 * batch index, which a later pass can attach a contact proxy to without
 * this file changing shape. Not wind: a per-blade CPU sway is exactly
 * the per-frame cost this file is built to avoid.
 *
 * Renderer directory: may import three. Crosses the render boundary
 * through `origin.toLocal` and reads no world coordinate by hand
 * (tests/viewBoundary.test.ts holds it to the `.wx` ban like the others).
 */
import * as THREE from 'three';
import { local, type WorldPoint } from '../world/coords';
import type { Heightfield } from '../world/heightfield';
import type { Habitat } from '../world/habitat';
import { toLocal } from '../world/origin';
import { CELL_SPAN, cellCentre, cellKey, cellsWithin, distanceToCell, type ObjectCellId } from '../world/objects/cells';
import { FAMILY_SPECS, OBJECT_FAMILIES, familyReach, type ObjectFamily } from '../world/objects/families';
import { objectBudgetFor, type ObjectBudget } from '../world/objects/budget';
import { populateCell, type CellPopulation, type FamilyBatch, TREE_BROAD, TREE_PALM, TREE_SCRUB } from '../world/objects/populate';
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

/** How far a rock sinks into the slope, as a fraction of its size, so it does not perch. */
const ROCK_SINK = 0.15;
/** A tree's foot is buried this fraction of its height (v0's 2%). */
const TREE_BURIAL = 0.02;

/** The blade's own width over its height, from the file; `girth` is scaled against it. */
const BLADE_WIDTH_OF_HEIGHT = 0.3256 / 4.9716;
/** A blade is never wider than a centimetre, whatever its height. */
const BLADE_MAX_WIDTH = 1.0 * M / 100;
/** The broad-leaf tree's baked girth over height, the ratio an instance's girth is taken against. */
const TREE_BAKED_GIRTH = 0.045;

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
  /** How far below the foot the object's origin sits (a rock sinks, a tree is buried). */
  readonly yOffset: Float32Array;
  /** Which stand draws it — for trees, the SHAPE; the level is chosen by distance. */
  readonly stand: Uint8Array;
  readonly rank: Float32Array;
  readonly wx: Float64Array;
  readonly wz: Float64Array;
  /** Foot heights, and the ground revision they were read at. */
  feet: Float32Array;
  feetRevision: number;
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

const DRAWN_ZERO: Record<ObjectFamily, number> = { grass: 0, twig: 0, stone: 0, rock: 0, tree: 0 };

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
      mesh.castShadow = false;
      mesh.receiveShadow = false;
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
    // GRASS: two silhouettes, one material. White so the instance colour is the colour.
    const grassMaterial = plain(0xffffff);
    this.grassStands = [stand('grass', bladeGeometry(), grassMaterial, caps.grass), stand('grass', broadBladeGeometry(), grassMaterial, caps.grass)];
    this.twigStand = stand('twig', twigGeometry(), plain(0xffffff), caps.twig);
    const stoneMaterial = plain(0xffffff);
    this.stoneStands = [stand('stone', stoneGeometry(0), stoneMaterial, caps.stone), stand('stone', stoneGeometry(1), stoneMaterial, caps.stone)];
    const rockMaterial = plain(0xffffff);
    this.rockStands = [];
    for (let v = 0; v < ROCK_VARIANTS; v += 1) this.rockStands.push(stand('rock', rockGeometry(v), rockMaterial, caps.rock));
    this.standsOf = { grass: this.grassStands, twig: [this.twigStand], stone: this.stoneStands, rock: this.rockStands };
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
      if (population.batches[family].count > 0) resident.composed[family] = this.compose(population.batches[family], family, population.habitat);
    }
    this.resident.set(key, resident);
    this.dirty = true;
  }

  /**
   * The composed buffers of one family in one cell — built on first use,
   * then only their feet patched when the ground's revision moves.
   */
  private composedOf(cell: Resident, family: ObjectFamily, revision: number): Composed {
    let c = cell.composed[family];
    if (c === undefined) {
      c = this.compose(cell.population.batches[family], family, cell.population.habitat);
      cell.composed[family] = c;
    }
    if (c.feetRevision !== revision) {
      // THE ONE PLACE THE STREAMED GROUND IS READ. A tile landing moves
      // the feet and nothing else: the translation's y is element 13 of
      // each matrix, and rotation and scale do not touch it.
      const point = { wx: 0, wz: 0 } as unknown as { wx: number; wz: number };
      for (let i = 0; i < c.count; i += 1) {
        point.wx = c.wx[i];
        point.wz = c.wz[i];
        const foot = this.field.heightAt(point as unknown as WorldPoint);
        c.feet[i] = foot;
        c.matrices[i * 16 + 13] = foot - c.yOffset[i];
      }
      c.feetRevision = revision;
    }
    return c;
  }

  /**
   * Compose one family of one cell: matrix, colour, vanish distance and
   * stand per object. Once per cell per family, at generation. The feet
   * are filled by `composedOf` and the y patched there.
   *
   * WRITTEN OUT BY HAND rather than through `Matrix4.compose` and an HSL
   * conversion per object, because six thousand blades a cell is where
   * a library call per object turns into a frame. The rotation is a spin
   * about +y followed by a tilt about a horizontal axis (Rodrigues, with
   * the axis in the ground plane so its middle row is just the cosine);
   * the trig comes from a table, because a blade's spin to a third of a
   * degree is not a thing anyone can see. The colour is the cell's
   * habitat colour scaled per object by its tint — one multiply a
   * channel, not a hue conversion.
   */
  private compose(batch: FamilyBatch, family: ObjectFamily, habitat: Habitat): Composed {
    const n = batch.count;
    const matrices = new Float32Array(n * 16);
    const colours = new Float32Array(n * 3);
    const vanish2 = new Float32Array(n);
    const yOffset = new Float32Array(n);
    const stand = new Uint8Array(n);
    const reach = this.reach[family];
    const draw = this.budget.draw[family];
    // The family's colour for this cell, and how far a tint swings it.
    let baseR = 1, baseG = 1, baseB = 1, swing = 0.3;
    switch (family) {
      case 'grass': this.grassColour(0.5, habitat); swing = 0.45; break;
      case 'twig': this.colour.setHSL(0.09, 0.35, 0.24); swing = 0.5; break;
      case 'stone': case 'rock': this.stoneColour(0.5, habitat); swing = 0.6; break;
      case 'tree': this.colour.setRGB(1, 1, 1); swing = 0.24; break;
    }
    baseR = this.colour.r; baseG = this.colour.g; baseB = this.colour.b;
    for (let i = 0; i < n; i += 1) {
      const size = batch.size[i];
      const girth = batch.girth[i];
      let sx: number, sy: number, sz: number;
      let offset = 0;
      switch (family) {
        case 'grass': {
          const width = Math.min(BLADE_MAX_WIDTH, size * girth) / BLADE_WIDTH_OF_HEIGHT;
          sx = width; sy = size; sz = width * 0.6;
          stand[i] = batch.variant[i] === 1 ? 1 : 0;
          break;
        }
        case 'twig':
          sx = size * girth; sy = size; sz = size * girth;
          stand[i] = 0;
          break;
        case 'stone':
          sx = size; sy = size; sz = size * girth;
          offset = size * ROCK_SINK * 0.5;
          stand[i] = batch.variant[i] & 1;
          break;
        case 'rock':
          sx = size; sy = size; sz = size * girth;
          offset = size * ROCK_SINK;
          stand[i] = batch.variant[i] % ROCK_VARIANTS;
          break;
        default: {
          const wide = batch.variant[i] === TREE_BROAD ? girth / TREE_BAKED_GIRTH : 1;
          sx = size * wide; sy = size; sz = size * wide;
          offset = size * TREE_BURIAL;
          stand[i] = batch.variant[i] === TREE_PALM ? 2 : batch.variant[i] === TREE_SCRUB ? 1 : 0;
          break;
        }
      }
      yOffset[i] = offset;
      // THE ONE WORLD → LOCAL CROSSING, through the origin like every renderer.
      const here = toLocal({ wx: batch.wx[i], wz: batch.wz[i] } as WorldPoint);
      // R = tilt(axis, lean) · spin(y). Column-major, columns scaled.
      const cs = cosOf(batch.spin[i]);
      const sn = sinOf(batch.spin[i]);
      const lean = batch.lean[i];
      const cl = cosOf(lean);
      const sl = sinOf(lean);
      const ax = cosOf(batch.leanDir[i]);
      const az = -sinOf(batch.leanDir[i]);
      const k = 1 - cl;
      // Tilt matrix rows (Rodrigues for a unit axis (ax, 0, az)):
      const t00 = cl + ax * ax * k, t01 = -az * sl, t02 = ax * az * k;
      const t10 = az * sl, t11 = cl, t12 = -ax * sl;
      const t20 = ax * az * k, t21 = ax * sl, t22 = cl + az * az * k;
      // Spin columns: (cs, 0, -sn), (0, 1, 0), (sn, 0, cs).
      const o = i * 16;
      matrices[o] = (t00 * cs - t02 * sn) * sx;
      matrices[o + 1] = (t10 * cs - t12 * sn) * sx;
      matrices[o + 2] = (t20 * cs - t22 * sn) * sx;
      matrices[o + 3] = 0;
      matrices[o + 4] = t01 * sy;
      matrices[o + 5] = t11 * sy;
      matrices[o + 6] = t21 * sy;
      matrices[o + 7] = 0;
      matrices[o + 8] = (t00 * sn + t02 * cs) * sz;
      matrices[o + 9] = (t10 * sn + t12 * cs) * sz;
      matrices[o + 10] = (t20 * sn + t22 * cs) * sz;
      matrices[o + 11] = 0;
      matrices[o + 12] = here.lx;
      matrices[o + 13] = 0;
      matrices[o + 14] = here.lz;
      matrices[o + 15] = 1;
      const shade = 1 - swing / 2 + swing * batch.tint[i];
      colours[i * 3] = baseR * shade;
      colours[i * 3 + 1] = baseG * shade;
      colours[i * 3 + 2] = baseB * shade;
      const v = vanishDistance(family, batch.rank[i], draw, reach);
      vanish2[i] = v * v;
    }
    return {
      count: n, matrices, colours, vanish2, yOffset, stand,
      rank: batch.rank, wx: batch.wx, wz: batch.wz,
      feet: new Float32Array(n), feetRevision: -1,
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
  }
}

/**
 * Sine and cosine to a third of a degree, from a table: the composer
 * takes six of each per object and a blade's spin to that precision is
 * invisible. 1,024 entries round the circle.
 */
const TRIG_STEPS = 1024;
const SIN_TABLE = new Float32Array(TRIG_STEPS);
for (let i = 0; i < TRIG_STEPS; i += 1) SIN_TABLE[i] = Math.sin((i / TRIG_STEPS) * Math.PI * 2);
const TRIG_SCALE = TRIG_STEPS / (Math.PI * 2);
function sinOf(angle: number): number {
  const i = Math.round(angle * TRIG_SCALE) % TRIG_STEPS;
  return SIN_TABLE[i < 0 ? i + TRIG_STEPS : i];
}
function cosOf(angle: number): number {
  return sinOf(angle + Math.PI / 2);
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

/** Where a cell's centre is, as a local point, for anything that wants to draw a debug marker. */
export function cellCentreLocal(id: ObjectCellId): { lx: number; lz: number } {
  const c = cellCentre(id);
  const l = toLocal(c);
  return local(l.lx, l.lz);
}
