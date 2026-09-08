/**
 * THE ISLAND'S ANIMALS, DRAWN — one loaded rig per species, a small
 * pool of clones lent to the nearest creatures and posed procedurally,
 * an instanced impostor for everything else in reach, and nothing at
 * all for the far tier.
 *
 * Joshua, 2026-09-07 (the ecology brief): "Three creatures from the
 * rigged-but-unanimated GLBs. Size by spine, not bounding box.
 * Procedural rig motion. Don't modify GLBs. Instancing. Protect the
 * mobile baseline. Far/near/very-near tiers. Performance toggles per
 * category." What `flora/` is to `world/objects`, this is to
 * `creatures/` (ARCHITECTURE §3): it reads `CreatureState` every frame
 * and writes meshes, and it decides nothing about where an animal is or
 * what it is doing.
 *
 * ─── why a pool, and why it is small ────────────────────────────────
 *
 * A rig is expensive twice over: the aphid is 30,947 triangles and the
 * housefly 25,635 (the worm a modest 3,144), and a skinned mesh cannot
 * be instanced — every animal that shows its legs needs its own bones,
 * which is what `SkeletonUtils.clone` gives it. So the pool is a few
 * rigs per species (`POOL_SIZES`, by detail rung, GAME TUNING) and the
 * rigs go to the NEAREST creatures that are drawn at all. Everything
 * else in the near tiers is an impostor: a twenty-triangle ellipsoid in
 * the species' colour, its length, turned to its heading, one draw call
 * a species. The far tier is not drawn: at the distances the simulation
 * calls far, a 2.5 mm aphid is under a pixel.
 *
 * A rig KEEPS its creature while that creature stays within a margin of
 * the pool's cut (`HYSTERESIS`): two animals at the same distance would
 * otherwise trade a rig every frame, and a rig that changes hands is a
 * body that snaps from one pose to another.
 *
 * ─── the size is the table's, and the file is checked against it ───
 *
 * The TEMPLATE is scaled by `rigScale(species)` — the cited length over
 * the table's `spineUnits` — and then the loaded rig's own spine is
 * MEASURED (`rig.measureSpine`). If the two disagree by more than
 * `SPINE_TOLERANCE` a warning names the species, the measurement, and
 * the number the table would need. It is not corrected here: a renderer
 * that quietly resized a creature would hide exactly the drift the
 * table's docblock says the arithmetic exists to expose. That warning is
 * about the FILE and stays about the file: it compares the template with
 * the species' cited length and knows nothing about any one animal.
 *
 * ─── but the DRAWN size is the ANIMAL'S ─────────────────────────────
 *
 * Joshua, 2026-09-08, having read a source on how far an earthworm
 * travels: "about the Earthworm it should be based on size and dynamic".
 * Every worm in a forest was 150 mm and every worm was therefore drawn,
 * trailed and impostored identically. `CreatureState.lengthMm` now
 * carries the body a particular animal grew, and `sizeRatio(state,
 * species)` is the ONE place a length is compared with its species'
 * cited one (`creatures/species.ts`). Every length this file draws with
 * goes through it:
 *
 *   the lent rig's root scale, so a 300 mm worm is twice the rig;
 *   the crumb spacing and the break distance on a worm's trail, so a
 *     long body's polyline is no coarser against its own bones;
 *   the span the reveal samples over, since what a cutaway shows of a
 *     body is a fact about how far that body reaches;
 *   the depth at which a burrower stops being drawn (`BURROW_HIDE`);
 *   the stations `layChain` lands along the path and the belly lift,
 *     which must match the skin the root scale just resized;
 *   the stride the legs and the bobs are measured in;
 *   and the impostor's own length and girth.
 *
 * ─── the pool is the species', the SCALE is the holder's ────────────
 *
 * One template and one set of clones per species: a rig is expensive and
 * the pool exists to be lent around, so it cannot be built at any one
 * animal's size. It takes its holder's size in `lend`, on the frame it
 * changes hands, and `pose` writes the same scale again every frame — a
 * drawn size is derived from the animal in front of it, never latched
 * from whoever held the rig last.
 *
 * ─── the crossing ───────────────────────────────────────────────────
 *
 * `toLocal(state.at)` is the ONLY place a world position becomes a
 * rendered one; every distance is a world-minus-world through
 * `coords.distanceSquared`, and heights are absolute — the origin
 * carries no y. The worm's trail is kept in WORLD points and converted
 * every frame, so a rebase under a crawling worm moves the drawn body
 * with the world and never leaves a tail behind.
 *
 * ─── what is read, and how ──────────────────────────────────────────
 *
 * Position, height, heading and phase — and, as booleans rather than
 * modes, whether the body is in the air (`AIRBORNE`, the set the state
 * module publishes for renderers) and, for a burrower, whether it is
 * under the ground: by height against the ground when the owner hands
 * in `groundAt`, by the burrow behaviour when it does not. Motion comes
 * from deltas each rig keeps for itself (`motion.ts`): the simulation
 * never says "walk"; the body walks because it moved.
 *
 * That last answer is a LATCH, one per animal, and `BODY_SAMPLES` below
 * says why: what the soil cutaway is showing of a 15 cm body is a fact
 * about the body, not about the 3.2 cm tile under its nose, and it is
 * measured once a frame over the whole animal so that neither the drawn
 * body nor its visibility can chatter with the tiles.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../assets/assets';
import { AIRBORNE, CREATURE_IDS, rigScale, sizeRatio, unitsOfMm } from '../creatures';
import type { CreatureId, CreatureSpecies, CreatureState } from '../creatures';
import { distance, distanceSquared, translate, type LocalPoint, type WorldPoint } from '../world/coords';
import { toLocal as originToLocal } from '../world/origin';
import {
  layChain, newMotion, poseAntennae, poseLegs, poseWings, restBob, stepMotion, walkBob,
  type BoundAntenna, type BoundLeg, type BoundWing, type RigMotion,
} from './motion';
import { disposeRig, dressRig, measureRig, placeholderFor, type RigAnatomy } from './rig';

/**
 * Rigs per species at each detail rung. GAME TUNING: `high` is the
 * brief's (worm 6, aphid 24, fly 12); the lower rungs are about a half,
 * a quarter and an eighth of that, rounded so nothing is zero. The
 * triangle cost of a full pool is the number to weigh on the phone:
 * at `high`, 6·3,144 + 24·30,947 + 12·25,635 ≈ 1.07 M triangles of
 * skinned geometry when every rig is lent.
 */
export const POOL_SIZES: Readonly<Record<string, Readonly<Record<CreatureId, number>>>> = Object.freeze({
  // THE RIGS ARE THE COST, and the aphid's is the heaviest: 30,947
  // triangles a rig against the worm's 3,144 and the fly's 25,635, all
  // skinned. At `high` this table is about 414 k triangles if every rig
  // is lent (4 worms, 8 aphids, 6 flies) — of the order of the 25,000
  // grass blades already on screen — and Joshua's rule for the phone is
  // that graphics give way before frame rate does. Everything past the
  // pool is a twenty-triangle impostor, which at ant scale a few metres
  // off is what the eye sees anyway. GAME TUNING until his phone says.
  'ultra-low': Object.freeze({ earthworm: 1, aphid: 2, housefly: 1 }),
  low: Object.freeze({ earthworm: 1, aphid: 3, housefly: 2 }),
  medium: Object.freeze({ earthworm: 2, aphid: 5, housefly: 4 }),
  high: Object.freeze({ earthworm: 4, aphid: 8, housefly: 6 }),
  'ultra-high': Object.freeze({ earthworm: 6, aphid: 16, housefly: 10 }),
});

/** The pool for a rung named by the detail ladder; an unknown name is `medium`. */
export function poolSizeFor(rung: string, id: CreatureId): number {
  return (POOL_SIZES[rung] ?? POOL_SIZES.medium)[id];
}

/** The impostor cap for a rung: the species' own population cap, since the simulation never holds more than that. */
export function impostorCapFor(species: CreatureSpecies, rung: string): number {
  const caps = species.population.caps as Readonly<Record<string, number>>;
  return caps[rung] ?? caps.medium;
}

/**
 * A rig keeps its creature while the creature is within this factor of
 * the pool's cut distance. GAME TUNING: 15% is wider than any one sim
 * step moves a creature relative to the others, so a boundary only
 * changes hands when something has genuinely walked past.
 */
export const HYSTERESIS = 1.15;

/** The spine may be off the cited length by this fraction before the load warns. From the brief. */
export const SPINE_TOLERANCE = 0.35;

/**
 * A burrower more than this far under the ground it stands on is not
 * drawn — world units AT THE SPECIES' CITED LENGTH, an individual's line
 * being this through its own `sizeRatio`. From the brief.
 *
 * It scales with the animal because what it measures is when a body has
 * gone out of sight, and a body goes out of sight at its own GIRTH: the
 * impostor's is `LOOK.girth` of its length and the rig's skin is drawn
 * around a spine the root scale has just resized, so a worm twice as
 * long is twice as thick and still shows above the soil twice as far
 * down. One absolute for every size would hide a 250 mm worm with a
 * centimetre of it lying in the open.
 */
export const BURROW_HIDE = 0.3;

/**
 * A BODY'S REVEAL IS A PROPERTY OF THE ANIMAL, NOT OF WHICHEVER 3.2 cm
 * TILE ITS NOSE IS OVER — and it may not change faster than the animal
 * does.
 *
 * Joshua, 2026-09-08, from the phone, on the soil cutaway: it "still
 * randomly throws the worm above and below ground", and "for a moment
 * saw the worm rotate around like a straight log". That is one defect,
 * and the arithmetic says so. The cutaway is meshed a TILE at a time —
 * `SOIL_TILE` is 3.2 units, 3.2 cm — and the owner's `ceilingAt` can
 * only answer "the roof is off here" where a tile has finished. A worm
 * is 15 cm long, so it lies across about five of those tiles. Asking the
 * single point under its HEAD and applying that answer to every crumb of
 * the body ties the whole animal to a fact that changes as tiles finish
 * (two a frame) and as the head crosses a 3.2 cm boundary. Each flip
 * moved the drawn body by the belly lift (3.4 mm) and the depth clamp,
 * and flipped `drawn()` with it — and a rig released and lent again is a
 * trail laid STRAIGHT along the current heading, which is the log the
 * eye saw rotating.
 *
 * So the reveal is decided ONCE per creature per frame, from the whole
 * body, with hysteresis in both axes:
 *
 *   `BODY_SAMPLES` points, head to tail along the heading and one of
 *   THAT ANIMAL'S body lengths end to end — five points 3.75 units apart
 *   on the cited 150 mm worm is a sample every 1.2 soil tiles, so no
 *   single tile can carry the answer. A longer worm spaces them further
 *   apart, which is the right direction: it is the body that lies across
 *   more tiles, so it is the body that must be asked about more widely.
 *
 *   The cutaway is taken as OPEN at `REVEAL_OPEN` of those samples and
 *   SHUT at `REVEAL_SHUT`; between the two nothing changes. Crossing
 *   that band takes two fifths of a body length of crawling — 60 mm on
 *   the cited worm — and the same number of SECONDS whatever the animal's
 *   size, because a pace scales with the body it belongs to just as this
 *   span does.
 *
 *   And a SHUT reading must hold for `REVEAL_HOLD` frames before it is
 *   believed, while an OPEN one is believed at once. Showing what the
 *   player has just cut open must never wait; hiding is never urgent;
 *   and holding one direction is enough to make a flip-flop impossible,
 *   because an alternating fact never accumulates a run.
 *
 * GAME TUNING, all four. The hold is counted in FRAMES rather than
 * seconds deliberately: the chattering fact is per-frame by construction
 * — tiles mesh at a frame rate, not at a clock rate — so a phone drawing
 * twenty frames a second, where tiles arrive further apart in time, gets
 * a proportionally longer hold, which is the direction that helps.
 */
export const BODY_SAMPLES = 5;
export const REVEAL_OPEN = 0.6;
export const REVEAL_SHUT = 0.2;
export const REVEAL_HOLD = 12;

/**
 * A burrower already drawn stays drawn until it is this factor deeper
 * than `BURROW_HIDE`; one met for the first time is judged at the line
 * itself.
 *
 * GAME TUNING — `HYSTERESIS` in the other axis, and for the same reason:
 * the band is 3 to 4.5 mm under the surface for the cited 150 mm worm
 * and scales with the animal, as `BURROW_HIDE` does. A worm nosing up at
 * its own pace takes the same fraction of a second to cross it at any
 * size — band and pace scale together — and cannot jitter across it
 * between two frames, and it sits well clear of the band the animal
 * travels in (`species.burrow.underMm`), so one working near the surface
 * settles on one side of the line instead of blinking on it.
 */
export const BURROW_KEEP = 1.5;

/**
 * Crumbs per body length on a worm's trail, and the crumbs kept beyond
 * one body. GAME TUNING, TCS's lesson: its trail is 56 points 3 mm apart
 * for a 150 mm worm, and `WormBody` says why — "the body is laid on the
 * POLYLINE through these points, so a coarse trail cuts the" curve. At
 * eight a length the crumbs were 1.875 units apart and the seventeen
 * bones 0.94, so two bones shared a straight segment and the animal read
 * as a chain of sticks. Sixteen puts a crumb between every pair of
 * bones. The trail still remembers about a body and a half.
 *
 * PER LENGTH, and the length is the individual's: sixteen crumbs to
 * whatever body the animal grew. The cited worm drops one every 0.9375
 * units and a 300 mm one every 1.875, which keeps the same crumb between
 * the same pair of bones on both — the ratio the constant is named for,
 * rather than an absolute spacing that would leave a long body a chain
 * of sticks and a short one over-sampled.
 */
export const CRUMBS_PER_LENGTH = 16;
const TRAIL_MARGIN = 8;
const TRAIL_CAPACITY = CRUMBS_PER_LENGTH + TRAIL_MARGIN;

/**
 * A head this far from its newest crumb has not crawled there — the
 * creature has been moved. Body lengths of the animal itself, so it
 * means the same thing at every size: a pace scales with the body
 * (`species.pace` through `sizeRatio`), so half a body length is the
 * same stretch of seconds of full flight for a 30 mm worm as for a
 * 250 mm one, and nothing a crawl reaches between two frames.
 * GAME TUNING.
 */
const TRAIL_BREAK_LENGTHS = 0.5;

/** How the impostor and the placeholder look, per species. GAME TUNING, from the rigs' own proportions. */
export interface SpeciesLook {
  /** Body girth over body length. */
  readonly girth: number;
  /** sRGB. */
  readonly colour: number;
  /** A resting bob: amplitude as a fraction of the body length, and cycles a second. Zero for an animal that sits still. */
  readonly restBob: number;
  readonly restBobRate: number;
}

export const LOOK: Readonly<Record<CreatureId, SpeciesLook>> = Object.freeze({
  earthworm: Object.freeze({ girth: 0.045, colour: 0x9a6e62, restBob: 0, restBobRate: 0 }),
  // An aphid on a stem breathes: a slow, small bob so a colony is not a row of beads.
  aphid: Object.freeze({ girth: 0.42, colour: 0x86b04a, restBob: 0.012, restBobRate: 0.4 }),
  housefly: Object.freeze({ girth: 0.34, colour: 0x3a3a40, restBob: 0, restBobRate: 0 }),
});

/** Where a world position is drawn. `world/origin.toLocal` is the default; a test may hand in its own. */
export interface FaunaOrigin {
  toLocal(at: WorldPoint): LocalPoint;
}

export interface FaunaViewOptions {
  /** The species to draw, in the table's order. */
  readonly species: readonly CreatureSpecies[];
  /** `assets.loadModel`, injected so a test can hand in a synthetic rig. The only loader. */
  readonly loadModel: Assets['loadModel'];
  /** The detail rung's name: pool sizes and impostor caps. */
  readonly rung: string;
  readonly origin?: FaunaOrigin;
  /** The ground's height at a point, world units — lets a burrower be hidden by DEPTH. Without it, by the burrow behaviour. */
  readonly groundAt?: (at: WorldPoint) => number;
  /** Visible soil ceiling, including a prepared observer section; does not move the animal. */
  readonly ceilingAt?: (at: WorldPoint) => number;
}

/** What the HUD is told. Plain numbers. */
export interface FaunaCost {
  readonly meanMs: number;
  readonly peakMs: number;
  /** Rigs lent this frame, per species. */
  readonly rigsLent: Readonly<Record<CreatureId, number>>;
  /** Impostors drawn this frame, per species. */
  readonly impostors: Readonly<Record<CreatureId, number>>;
}

/**
 * A worm's recent positions, newest at `head`, as a ring of WORLD points.
 *
 * A crumb remembers its DEPTH under the ground, not its height above the
 * sea — see `crumbHeight`. `heights` is the absolute it was dropped at,
 * kept only for a view with no ground to ask.
 */
interface Trail {
  readonly points: WorldPoint[];
  readonly heights: Float64Array;
  /** Ground minus the body, world units, positive downward. */
  readonly depths: Float64Array;
  /** The holder's body length over `CRUMBS_PER_LENGTH`. Rewritten when the rig changes hands, since the new animal is a new size. */
  spacing: number;
  head: number;
  count: number;
  /** The creature whose crawl this is a record of. A record of somebody else's crawl is worthless. */
  owner: string;
}

/**
 * WHAT ONE ANIMAL'S BODY IS SHOWING, AND HOW LONG THAT STANDS.
 *
 * The latch the constants above describe: one named object per creature
 * rather than loose fields (ARCHITECTURE §2.3), measured once a frame in
 * `reveal` and read — never written — by `pose`. Both facts it holds are
 * about the WHOLE body, and the two derived answers come out of them
 * together, so the body cannot be drawn on the surface in the same frame
 * a cutaway is showing its burrow:
 *
 *   drawn at all   = it is not deep, or the cutaway is open over it
 *   burrow on show = it is deep AND the cutaway is open over it
 */
interface Reveal {
  /** The cutaway has the roof off most of this body. */
  cut: boolean;
  /** The body is further under the ground than the surface band. */
  deep: boolean;
  /** Consecutive frames the samples have read shut while `cut` still stands. */
  shutFor: number;
  /** The frame it was last measured on; one not measured this frame is forgotten. */
  frame: number;
}

/** One clone of a species' template, and what it remembers. */
interface Rig {
  readonly root: THREE.Object3D;
  readonly legs: BoundLeg[];
  readonly wings: BoundWing[];
  readonly antennae: BoundAntenna[];
  readonly chain: THREE.Bone[];
  /** The head bone's rest position in the root's (unscaled) frame, and its parent's orientation there. */
  readonly headOffset: THREE.Vector3;
  readonly headFrame: THREE.Quaternion;
  readonly motion: RigMotion;
  trail: Trail | null;
  /** The creature's id, or null when free. */
  holder: string | null;
  /** The holder's index in this frame's creature list. */
  creature: number;
  lastAt: WorldPoint | null;
  lastHeight: number;
  lastHeading: number;
}

/** One species: its template, its pool, its impostor. */
interface Slot {
  readonly species: CreatureSpecies;
  readonly group: THREE.Group;
  /** The species' CITED length, world units. One animal's is this through its own `sizeRatio`. */
  readonly bodyLength: number;
  readonly look: SpeciesLook;
  enabled: boolean;
  template: THREE.Object3D | null;
  placeholder: boolean;
  anatomy: RigAnatomy | null;
  /** The TEMPLATE's uniform scale: `rigScale(species)`, or 1 for a placeholder. A LENT rig wears this through its holder's ratio. */
  scale: number;
  rigs: Rig[];
  impostor: THREE.InstancedMesh | null;
  cap: number;
  /** Indices into this frame's creature list, nearest first once sorted. Scratch. */
  readonly candidates: number[];
}

const now = (): number => performance.now();

function zeroCounts(): Record<CreatureId, number> {
  const out = {} as Record<CreatureId, number>;
  for (const id of CREATURE_IDS) out[id] = 0;
  return out;
}

function wrapAngle(a: number): number {
  let w = (a + Math.PI) % (Math.PI * 2);
  if (w < 0) w += Math.PI * 2;
  return w - Math.PI;
}

export class FaunaView {
  /** One group; a layer toggle is one `visible`. Each species is a child group, so a species toggle is one too. */
  readonly group = new THREE.Group();

  private readonly slots = new Map<CreatureId, Slot>();
  private readonly order: Slot[] = [];
  private readonly loadModel: Assets['loadModel'];
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  private readonly groundAt: ((at: WorldPoint) => number) | null;
  private readonly ceilingAt: ((at: WorldPoint) => number) | null;
  private rung: string;
  private readonly loads: Promise<void>[] = [];
  private disposed = false;

  /** The impostor body, shared by every species: an icosahedron, twenty triangles, scaled to an ellipsoid per instance. */
  private readonly impostorGeometry = new THREE.IcosahedronGeometry(1, 0);
  private readonly materials: THREE.Material[] = [];

  /** One latch per creature in reach, by creature id; an animal not measured this frame is dropped. */
  private readonly reveals = new Map<string, Reveal>();
  private frame = 0;

  // Scratch, allocated once and grown as the creature list grows.
  private d2 = new Float64Array(512);
  private rigged = new Uint8Array(512);
  private readonly byId = new Map<string, number>();
  private readonly path = new Float64Array((TRAIL_CAPACITY + 1) * 3);
  private readonly byDistance = (a: number, b: number): number => this.d2[a] - this.d2[b];

  private rigsLent = zeroCounts();
  private impostors = zeroCounts();
  private frames = 0;
  private totalMs = 0;
  private peakMs = 0;

  constructor(options: FaunaViewOptions) {
    this.loadModel = options.loadModel;
    this.toLocal = options.origin ? (at) => options.origin!.toLocal(at) : originToLocal;
    this.groundAt = options.groundAt ?? null;
    this.ceilingAt = options.ceilingAt ?? null;
    this.rung = options.rung;
    this.group.name = 'fauna';
    for (const species of options.species) {
      const group = new THREE.Group();
      group.name = `fauna:${species.id}`;
      this.group.add(group);
      const slot: Slot = {
        species,
        group,
        bodyLength: unitsOfMm(species.lengthMm),
        look: LOOK[species.id],
        enabled: true,
        template: null,
        placeholder: false,
        anatomy: null,
        scale: 1,
        rigs: [],
        impostor: null,
        cap: 0,
        candidates: [],
      };
      this.slots.set(species.id, slot);
      this.order.push(slot);
      this.buildImpostor(slot);
      this.loads.push(this.load(slot));
    }
  }

  /** Resolves when every species has a template — the file, or the placeholder standing in for it. */
  ready(): Promise<void> {
    return Promise.all(this.loads).then(() => undefined);
  }

  /** One species on or off: hidden, and not updated, until it is on again. */
  setEnabled(species: CreatureId, on: boolean): void {
    const slot = this.slots.get(species);
    if (slot === undefined) return;
    slot.enabled = on;
    slot.group.visible = on;
    if (!on) {
      for (const rig of slot.rigs) this.release(rig);
      if (slot.impostor !== null) slot.impostor.count = 0;
      this.rigsLent[species] = 0;
      this.impostors[species] = 0;
    }
  }

  isEnabled(species: CreatureId): boolean {
    return this.slots.get(species)?.enabled ?? false;
  }

  /** A new rung: the pools and the impostor caps are rebuilt; nothing about the creatures changes. */
  setRung(rung: string): void {
    if (rung === this.rung) return;
    this.rung = rung;
    for (const slot of this.order) {
      this.buildImpostor(slot);
      if (slot.template !== null) this.buildPool(slot);
    }
  }

  get detail(): string {
    return this.rung;
  }

  /**
   * One call a frame, after the simulation has stepped: lend the rigs,
   * pose them, fill the impostors. `eye` is the camera's world position
   * and `eyeHeight` its world y; with the height, distance is measured
   * in 3D, so a camera high over a lawn lends no rigs to what is under
   * it. `dt` is the clamped simulation step, never raw wall-clock.
   */
  update(creatures: readonly CreatureState[], eye: WorldPoint, dt: number, eyeHeight: number = Number.NaN): void {
    if (this.disposed) return;
    const began = now();
    const eyeLocal = this.toLocal(eye);
    if (Number.isFinite(eyeLocal.lx) && Number.isFinite(eyeLocal.lz)) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const eyeY = Number.isFinite(eyeHeight) ? eyeHeight : null;
      this.frame += 1;
      this.room(creatures.length);
      for (const slot of this.order) slot.candidates.length = 0;
      // PASS 1: who is drawn at all, and how far away, bucketed by species.
      for (let i = 0; i < creatures.length; i += 1) {
        const c = creatures[i];
        const slot = this.slots.get(c.species);
        if (slot === undefined || !slot.enabled || c.tier === 'far' || !this.drawn(slot, c)) continue;
        const dy = eyeY === null ? 0 : c.height - eyeY;
        this.d2[i] = distanceSquared(c.at, eye) + dy * dy;
        this.rigged[i] = 0;
        slot.candidates.push(i);
      }
      // Every burrower in reach was measured above, so anything older
      // than this frame has gone far, been switched off or streamed out.
      // Its latch is dropped rather than kept for an animal that will
      // come back somewhere else.
      for (const [id, reveal] of this.reveals) if (reveal.frame !== this.frame) this.reveals.delete(id);
      // PASS 2: each species lends, poses and fills.
      for (const slot of this.order) {
        if (!slot.enabled) continue;
        this.drawSpecies(slot, creatures, step);
      }
    }
    const spent = now() - began;
    this.frames += 1;
    this.totalMs += spent;
    if (spent > this.peakMs) this.peakMs = spent;
  }

  get cost(): FaunaCost {
    return Object.freeze({
      meanMs: this.frames === 0 ? 0 : this.totalMs / this.frames,
      peakMs: this.peakMs,
      rigsLent: { ...this.rigsLent },
      impostors: { ...this.impostors },
    });
  }

  resetCost(): void {
    this.frames = 0;
    this.totalMs = 0;
    this.peakMs = 0;
  }

  // ─── for tests and the HUD ─────────────────────────────────────────

  /** The creature id each rig of a species holds, or null when free. */
  holders(species: CreatureId): readonly (string | null)[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.holder);
  }

  /** The rig roots of a species, in pool order. */
  rigs(species: CreatureId): readonly THREE.Object3D[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.root);
  }

  /** What was measured on a species' template; null before it loads or for a placeholder. */
  anatomy(species: CreatureId): RigAnatomy | null {
    return this.slots.get(species)?.anatomy ?? null;
  }

  template(species: CreatureId): THREE.Object3D | null {
    return this.slots.get(species)?.template ?? null;
  }

  isPlaceholder(species: CreatureId): boolean {
    return this.slots.get(species)?.placeholder ?? false;
  }

  impostor(species: CreatureId): THREE.InstancedMesh | null {
    return this.slots.get(species)?.impostor ?? null;
  }

  /**
   * The TEMPLATE's uniform scale for a species: `rigScale`, or 1 for a
   * placeholder. A rig lent to an animal wears this times that animal's
   * `sizeRatio`, so read `rigs(species)[k].scale` for what is drawn.
   */
  scaleOf(species: CreatureId): number {
    return this.slots.get(species)?.scale ?? 1;
  }

  /** The crumb spacing of each rig of a species, world units — its holder's body over `CRUMBS_PER_LENGTH`; 0 for a rig with no trail. */
  trailSpacings(species: CreatureId): readonly number[] {
    return (this.slots.get(species)?.rigs ?? []).map((r) => r.trail?.spacing ?? 0);
  }

  // ─── loading ───────────────────────────────────────────────────────

  private load(slot: Slot): Promise<void> {
    const { species, look, bodyLength } = slot;
    return this.loadModel(species.model.path, () => placeholderFor(bodyLength, look.girth, look.colour)).then(
      (model) => {
        // The race is real: a view disposed while the file was in flight
        // must not be handed a rig nothing will ever release.
        if (this.disposed) { disposeRig(model); return; }
        this.adopt(slot, model);
      },
      (error: unknown) => {
        console.error(`[fauna] ${species.id}: the loader rejected outright; nothing will be drawn for it`, error);
      },
    );
  }

  /** Take a loaded template: dress it, scale it, measure it, warn if the table disagrees, and build the pool from it. */
  private adopt(slot: Slot, model: THREE.Object3D): void {
    const { species, bodyLength } = slot;
    slot.template = model;
    slot.placeholder = model.userData.isPlaceholder === true;
    if (slot.placeholder) {
      // Already in world units, already the species' size: not a rig, not scaled like one.
      slot.anatomy = null;
      slot.scale = 1;
    } else {
      dressRig(model);
      // Measured at the identity, BEFORE the scale, in the GLB's own units.
      const anatomy = measureRig(model, species.model.chain);
      slot.anatomy = anatomy;
      slot.scale = rigScale(species);
      model.scale.setScalar(slot.scale);
      const drawnLength = anatomy.spine * slot.scale;
      if (!(anatomy.spine > 0) || Math.abs(drawnLength - bodyLength) > bodyLength * SPINE_TOLERANCE) {
        const pct = bodyLength > 0 ? Math.round((drawnLength / bodyLength) * 100) : 0;
        console.warn(
          `[fauna] ${species.id}: the rig's spine measures ${anatomy.spine.toFixed(4)} GLB units; × rigScale ${slot.scale.toFixed(5)} `
          + `= ${drawnLength.toFixed(3)} world units, but the table cites ${species.lengthMm} mm = ${bodyLength} units. `
          + `It is drawn at ${pct}% of its length. Either ${species.model.path} changed or species.model.spineUnits `
          + `(${species.model.spineUnits}) is wrong — at this file it should be ${anatomy.spine.toFixed(4)}. Not corrected here; fix the table.`,
        );
      }
    }
    this.buildPool(slot);
  }

  // ─── the pool and the impostor ─────────────────────────────────────

  private buildPool(slot: Slot): void {
    for (const rig of slot.rigs) slot.group.remove(rig.root);
    slot.rigs = [];
    const template = slot.template;
    if (template === null) return;
    const count = poolSizeFor(this.rung, slot.species.id);
    const anatomy = slot.anatomy;
    for (let k = 0; k < count; k += 1) {
      const root = cloneSkinned(template);
      root.visible = false;
      root.name = `${slot.species.id}:rig:${k}`;
      // Heading about Y, then pitch about the body's X, then bank about its Z.
      root.rotation.order = 'YXZ';
      const bones = new Map<string, THREE.Bone>();
      root.traverse((n) => { if ((n as THREE.Bone).isBone) bones.set(n.name, n as THREE.Bone); });
      const legs: BoundLeg[] = [];
      const wings: BoundWing[] = [];
      const antennae: BoundAntenna[] = [];
      const chain: THREE.Bone[] = [];
      const headOffset = new THREE.Vector3();
      const headFrame = new THREE.Quaternion();
      if (anatomy !== null) {
        for (const spec of anatomy.legs) { const bone = bones.get(spec.coxa); if (bone) legs.push({ bone, spec }); }
        for (const spec of anatomy.wings) { const bone = bones.get(spec.bone); if (bone) wings.push({ bone, spec }); }
        for (const spec of anatomy.antennae) { const bone = bones.get(spec.bone); if (bone) antennae.push({ bone, spec }); }
        if (anatomy.chain !== null) {
          for (const name of anatomy.chain.bones) { const bone = bones.get(name); if (bone) chain.push(bone); }
          if (chain.length >= 2) {
            // The head's parent frame in the root's UNSCALED frame: the
            // root's own matrix divided out of the parent's, so a rig
            // whose armature carries a transform is still seated right.
            root.updateMatrixWorld(true);
            const parent = chain[0].parent ?? root;
            const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(parent.matrixWorld);
            const origin = new THREE.Vector3();
            const scale = new THREE.Vector3();
            m.decompose(origin, headFrame, scale);
            headOffset.copy(chain[0].position).multiply(scale).applyQuaternion(headFrame).add(origin);
          }
        }
      }
      slot.rigs.push({
        root, legs, wings, antennae, chain, headOffset, headFrame,
        motion: newMotion(), trail: null, holder: null, creature: -1, lastAt: null, lastHeight: 0, lastHeading: 0,
      });
      slot.group.add(root);
    }
  }

  private buildImpostor(slot: Slot): void {
    if (slot.impostor !== null) {
      slot.group.remove(slot.impostor);
      slot.impostor.dispose();
      slot.impostor = null;
    }
    const cap = impostorCapFor(slot.species, this.rung);
    slot.cap = cap;
    const material = new THREE.MeshLambertMaterial({ color: slot.look.colour, fog: true });
    this.materials.push(material);
    const mesh = new THREE.InstancedMesh(this.impostorGeometry, material, Math.max(1, cap));
    mesh.count = 0;
    // It rides the camera: its bounds always contain the eye, so a frustum test could only ever be wrong.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `${slot.species.id}:impostor`;
    slot.group.add(mesh);
    slot.impostor = mesh;
  }

  // ─── the frame ─────────────────────────────────────────────────────

  /** Grow the per-creature scratch. Allocation only when the list outgrows what it had. */
  private room(n: number): void {
    if (this.d2.length >= n) return;
    let size = this.d2.length;
    while (size < n) size *= 2;
    this.d2 = new Float64Array(size);
    this.rigged = new Uint8Array(size);
  }

  /**
   * THIS ANIMAL'S LENGTH, world units — not its species'.
   *
   * `sizeRatio` is the one place a body is measured against its species'
   * cited one, and every length this renderer draws with comes through
   * here, so the whole of "based on size" is one multiplication in two
   * methods rather than a constant repeated at nine call sites.
   */
  private lengthOf(slot: Slot, c: CreatureState): number {
    return slot.bodyLength * sizeRatio(c, slot.species);
  }

  /** The uniform scale a rig lent to this animal wears: the template's, through the animal's own ratio. */
  private rigScaleOf(slot: Slot, c: CreatureState): number {
    return slot.scale * sizeRatio(c, slot.species);
  }

  /**
   * Whether a creature in the near tiers is drawn at all: a burrower
   * under the ground is not, unless the cutaway is showing its burrow.
   *
   * Called exactly once per creature per frame, from pass 1 — it is what
   * advances that creature's latch, and `pose` reads the answer back
   * rather than measuring it again.
   */
  private drawn(slot: Slot, c: CreatureState): boolean {
    if (slot.species.burrow === null) return true;
    if (this.groundAt === null) return c.behaviour !== 'burrow';
    const reveal = this.reveal(slot, c);
    return !reveal.deep || reveal.cut;
  }

  /**
   * This creature's latch, advanced by one frame of measurement.
   *
   * The two thresholds are asymmetric on purpose and the constants say
   * why: `cut` opens the moment most of the body is under an open roof
   * and shuts only after `REVEAL_HOLD` frames of shut readings, and
   * `deep` is judged at `BURROW_HIDE` for an animal met for the first
   * time and at `BURROW_HIDE * BURROW_KEEP` once the animal is being
   * drawn. Nothing here reads the head alone, and nothing here moves a
   * creature: the simulation owns where the animal is, and this decides
   * only what is shown of it.
   */
  private reveal(slot: Slot, c: CreatureState): Reveal {
    const ground = this.groundAt === null ? Number.NaN : this.groundAt(c.at);
    const depth = Number.isFinite(ground) ? ground - c.height : 0;
    const open = this.cutawayOver(slot, c);
    // The line a body goes out of sight at is that body's — see BURROW_HIDE.
    const hide = BURROW_HIDE * sizeRatio(c, slot.species);
    let reveal = this.reveals.get(c.id);
    if (reveal === undefined) {
      reveal = { cut: open >= REVEAL_OPEN, deep: depth > hide, shutFor: 0, frame: this.frame };
      this.reveals.set(c.id, reveal);
      return reveal;
    }
    reveal.frame = this.frame;
    if (open >= REVEAL_OPEN) {
      reveal.cut = true;
      reveal.shutFor = 0;
    } else if (open > REVEAL_SHUT) {
      // In the band: whatever it was reading, it goes on reading.
      reveal.shutFor = 0;
    } else if (reveal.cut) {
      reveal.shutFor += 1;
      if (reveal.shutFor >= REVEAL_HOLD) { reveal.cut = false; reveal.shutFor = 0; }
    }
    reveal.deep = depth > hide * (reveal.deep ? 1 : BURROW_KEEP);
    return reveal;
  }

  /**
   * How much of a body the cutaway has the roof off, 0..1.
   *
   * THE WHOLE ANIMAL IS ASKED ABOUT, not its nose: `BODY_SAMPLES` points
   * from the head backwards along the heading, spanning one body length,
   * which is how `seedTrail` lays a body it has no history for. The head
   * is the only point that is certainly on the animal — the rest is
   * where the body would be if it had crawled in a straight line — and
   * that is enough, because the question is which SOIL TILES the animal
   * lies across, and a 15 cm body lies across about five of them
   * whichever way it is bent.
   */
  private cutawayOver(slot: Slot, c: CreatureState): number {
    const ceiling = this.ceilingAt;
    const ground = this.groundAt;
    if (ceiling === null || ground === null) return 0;
    const step = this.lengthOf(slot, c) / (BODY_SAMPLES - 1);
    const ax = Math.sin(c.heading);
    const az = Math.cos(c.heading);
    let open = 0;
    for (let k = 0; k < BODY_SAMPLES; k += 1) {
      const at = k === 0 ? c.at : translate(c.at, -k * step * ax, -k * step * az);
      if (ceiling(at) < ground(at) - 1e-6) open += 1;
    }
    return open / BODY_SAMPLES;
  }

  private drawSpecies(slot: Slot, creatures: readonly CreatureState[], dt: number): void {
    const id = slot.species.id;
    const cand = slot.candidates;
    cand.sort(this.byDistance);
    const rigs = slot.rigs;
    const n = rigs.length;
    let lent = 0;
    if (n > 0) {
      const byId = this.byId;
      byId.clear();
      for (let k = 0; k < cand.length; k += 1) byId.set(creatures[cand[k]].id, cand[k]);
      // THE CUT: the distance of the last creature that would get a rig
      // by rank alone; a holder stays within a margin of it.
      const cut = cand.length > n ? this.d2[cand[n - 1]] : Infinity;
      const keepWithin = cut * HYSTERESIS * HYSTERESIS;
      for (const rig of rigs) {
        if (rig.holder === null) continue;
        const idx = byId.get(rig.holder);
        if (idx === undefined || this.d2[idx] > keepWithin) {
          this.release(rig);
        } else {
          this.rigged[idx] = 1;
          rig.creature = idx;
        }
      }
      // The free rigs go to the nearest creatures without one, by rank.
      let free = 0;
      for (let k = 0; k < cand.length && k < n; k += 1) {
        const idx = cand[k];
        if (this.rigged[idx] === 1) continue;
        while (free < n && rigs[free].holder !== null) free += 1;
        if (free >= n) break;
        this.lend(slot, rigs[free], creatures[idx]);
        rigs[free].creature = idx;
        this.rigged[idx] = 1;
      }
      for (const rig of rigs) {
        if (rig.holder === null) { rig.root.visible = false; continue; }
        this.pose(slot, rig, creatures[rig.creature], dt);
        rig.root.visible = true;
        lent += 1;
      }
    }
    this.rigsLent[id] = lent;
    // THE IMPOSTORS: everyone else drawn, nearest first, never past the cap.
    const mesh = slot.impostor;
    let count = 0;
    if (mesh !== null) {
      const into = mesh.instanceMatrix.array as Float32Array;
      for (let k = 0; k < cand.length && count < slot.cap; k += 1) {
        const idx = cand[k];
        if (this.rigged[idx] === 1) continue;
        const c = creatures[idx];
        // THE ELLIPSOID IS THIS ANIMAL'S. Past the pool the whole
        // population is impostors, so it is here that a range of sizes
        // is mostly seen; a constant here would make the sizes the few
        // lent rigs show read as an accident rather than as the world.
        const len = this.lengthOf(slot, c);
        const r = (len * slot.look.girth) / 2;
        const half = len / 2;
        const here = this.toLocal(c.at);
        const cs = Math.cos(c.heading);
        const sn = Math.sin(c.heading);
        // A rotation about +Y by the heading — ahead is (sin h, cos h),
        // the actor convention — with the ellipsoid's long axis on +Z.
        const o = count * 16;
        into[o] = cs * r; into[o + 1] = 0; into[o + 2] = -sn * r; into[o + 3] = 0;
        into[o + 4] = 0; into[o + 5] = r; into[o + 6] = 0; into[o + 7] = 0;
        into[o + 8] = sn * half; into[o + 9] = 0; into[o + 10] = cs * half; into[o + 11] = 0;
        into[o + 12] = here.lx; into[o + 13] = c.height + r; into[o + 14] = here.lz; into[o + 15] = 1;
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.impostors[id] = count;
  }

  private release(rig: Rig): void {
    rig.holder = null;
    rig.creature = -1;
    rig.lastAt = null;
    rig.root.visible = false;
  }

  /**
   * Hand a rig to a creature: TAKE ITS SIZE, forget the last holder's
   * motion, seed the worm's trail straight behind it.
   *
   * THE SCALE IS WRITTEN HERE AND NOT IN `buildPool`. A rig is built
   * before it has a holder, so there is no animal to take a size from;
   * it takes one the moment it changes hands, on that frame. Building
   * the pool at one size would draw a 250 mm worm at a 100 mm worm's
   * length for as long as it held a rig the small one had.
   */
  private lend(slot: Slot, rig: Rig, c: CreatureState): void {
    rig.holder = c.id;
    const bodyLength = this.lengthOf(slot, c);
    rig.root.scale.setScalar(this.rigScaleOf(slot, c));
    const m = rig.motion;
    m.gone = 0; m.alive = 0; m.moving = 0; m.air = AIRBORNE.includes(c.behaviour) ? 1 : 0; m.pitch = 0; m.bank = 0;
    rig.lastAt = c.at;
    rig.lastHeight = c.height;
    rig.lastHeading = c.heading;
    if (rig.chain.length >= 2) {
      let trail = rig.trail;
      if (trail === null) {
        trail = {
          points: new Array<WorldPoint>(TRAIL_CAPACITY).fill(c.at),
          heights: new Float64Array(TRAIL_CAPACITY),
          depths: new Float64Array(TRAIL_CAPACITY),
          spacing: bodyLength / CRUMBS_PER_LENGTH,
          head: 0,
          count: 0,
          owner: c.id,
        };
        rig.trail = trail;
      }
      // A TRAIL IS SPACED BY THE BODY THAT LAYS IT: `CRUMBS_PER_LENGTH`
      // crumbs to THIS animal's length. The same animal handed its rig
      // back gets the same number, so the crawl kept below is untouched;
      // a different one gets its own, and is re-seeded anyway.
      trail.spacing = bodyLength / CRUMBS_PER_LENGTH;
      // A RIG HANDED BACK TO THE SAME ANIMAL KEEPS THE PATH IT CRAWLED.
      // A trail is a record of a crawl, and this animal's crawl did not
      // stop happening because a rig changed hands for a frame — laying
      // it straight again is what draws a body as a rotating log. It is
      // laid again only when the record is not this creature's, or when
      // the head is further from its newest crumb than a crawl reaches
      // (the same test `pose` makes every frame).
      if (trail.owner !== c.id || trail.count === 0
        || distance(c.at, trail.points[trail.head]) > bodyLength * TRAIL_BREAK_LENGTHS) {
        trail.owner = c.id;
        this.seedTrail(trail, c);
      }
    }
  }

  /**
   * Lay a straight trail behind a creature at the depth it is at: what a
   * body that has just been handed a rig, or has just been moved, is
   * drawn along until it has crawled far enough to have a real one.
   */
  private seedTrail(trail: Trail, c: CreatureState): void {
    trail.head = TRAIL_CAPACITY - 1;
    trail.count = 0;
    const ahead = { x: Math.sin(c.heading), z: Math.cos(c.heading) };
    for (let k = TRAIL_CAPACITY - 1; k >= 0; k -= 1) {
      const at = translate(c.at, -k * trail.spacing * ahead.x, -k * trail.spacing * ahead.z);
      this.pushCrumb(trail, at, c.height, this.depthAt(c.at, c.height));
    }
  }

  /** How far under the ground a body is at a point. Zero with no ground to ask. */
  private depthAt(at: WorldPoint, height: number): number {
    if (this.groundAt === null) return 0;
    const ground = this.groundAt(at);
    return Number.isFinite(ground) ? ground - height : 0;
  }

  /**
   * A DRAWN BODY LIES IN THE GROUND IT IS OVER — never through it, and
   * never hanging over it either.
   *
   * A CRUMB REMEMBERS A DEPTH, NOT A HEIGHT. That is the whole rule, and
   * it is what alpha.26 got half right: it kept the absolute height the
   * worm had when the crumb was dropped and raised it to the ground at
   * draw time, which fixed a body half buried on a slope and left the
   * opposite failure standing. The ground here MOVES — an HD tile lands
   * under the camera and `Heightfield.heightAt` stops answering from the
   * coarse lattice — and when it moves DOWN, a one-sided raise pins
   * every crumb at the height the old lattice had. The creature follows
   * the new ground (`locomotion.burrow` re-clamps it into the band the
   * same tick), the trail does not, and the seventeen bones are laid up
   * the gap between them: measured at a two-metre drop, the whole 15 cm
   * body stood vertical, and at a ten-centimetre drop it drew the L
   * Joshua photographed — ten of vertical, five of horizontal. A worm
   * wanders 3 mm a second, so it drops a crumb every six seconds and the
   * shape stands for over a minute; a `surface` worm's pace is zero and
   * it never drops another at all.
   *
   * A depth is immune to that: whatever the ground does, the body goes
   * with it. Nothing here is a clamp against the ground, so nothing can
   * be stranded above it.
   *
   * The one clamp left is `Math.max(0, depth)` for a body NOT in a
   * prepared cutaway: it draws a surfacing worm lying on the ground
   * rather than half through it, which is what alpha.26 was for. In a
   * cutaway the true depth is what there is to see, so it is used raw.
   * With no ground to ask, the absolute the crumb was dropped at stands.
   */
  private crumbHeight(at: WorldPoint, height: number, depth: number, exposedBurrow: boolean): number {
    if (this.groundAt === null) return height;
    const ground = this.groundAt(at);
    if (!Number.isFinite(ground)) return height;
    return ground - (exposedBurrow ? depth : Math.max(0, depth));
  }

  private pushCrumb(trail: Trail, at: WorldPoint, height: number, depth: number): void {
    trail.head = (trail.head + 1) % TRAIL_CAPACITY;
    trail.points[trail.head] = at;
    trail.heights[trail.head] = height;
    trail.depths[trail.head] = depth;
    if (trail.count < TRAIL_CAPACITY) trail.count += 1;
  }

  /** Pose one lent rig from what its creature did since last frame. */
  private pose(slot: Slot, rig: Rig, c: CreatureState, dt: number): void {
    const moved = rig.lastAt === null ? 0 : distance(c.at, rig.lastAt);
    const climbed = c.height - rig.lastHeight;
    const turned = wrapAngle(c.heading - rig.lastHeading);
    rig.lastAt = c.at;
    rig.lastHeight = c.height;
    rig.lastHeading = c.heading;
    const m = rig.motion;
    // EVERY LENGTH IN THIS FRAME IS THIS ANIMAL'S, and the scale is
    // written again rather than trusted: a drawn size is derived from
    // the creature in front of the rig each frame (ARCHITECTURE §2.3),
    // never latched from whoever held it last.
    const bodyLength = this.lengthOf(slot, c);
    const scale = this.rigScaleOf(slot, c);
    rig.root.scale.setScalar(scale);
    stepMotion(m, {
      dt, moved, climbed, turned, airborne: AIRBORNE.includes(c.behaviour), bodyLength, phase: c.phase,
    });
    // THE ONE WORLD → LOCAL CROSSING, through the origin like every renderer.
    const here = this.toLocal(c.at);
    const anatomy = slot.anatomy;
    const chain = anatomy?.chain ?? null;
    if (chain !== null && rig.chain.length >= 2 && rig.trail !== null) {
      // THE REVEAL IS THE ANIMAL'S, and it was decided for the whole
      // body in pass 1. Reading it back here rather than asking the
      // ceiling again under the head is the fix itself: one fact, one
      // frame, every crumb of the body drawn by the same answer.
      const reveal = this.reveals.get(c.id);
      const exposedBurrow = reveal !== undefined && reveal.cut && reveal.deep;
      const trail = rig.trail;
      const behind = distance(c.at, trail.points[trail.head]);
      if (behind > bodyLength * TRAIL_BREAK_LENGTHS) {
        // IT DID NOT CRAWL THERE. A creature is streamed out and back at
        // the spot its cell generates it at, and a rig held across that
        // would draw the body reaching from where the animal is to where
        // it was. A trail is a record of a crawl; when the crawl is
        // broken the record is worthless, so it is laid again.
        this.seedTrail(trail, c);
      } else if (behind >= trail.spacing) {
        this.pushCrumb(trail, c.at, c.height, this.depthAt(c.at, c.height));
      }
      // The path: the body right now, then the crumbs, newest first,
      // each at its own depth in the ground under it (see `crumbHeight`)
      // and lifted so the belly rests on it.
      const lift = exposedBurrow ? 0 : chain.lift * scale;
      const path = this.path;
      const headDepth = this.depthAt(c.at, c.height);
      path[0] = here.lx; path[1] = this.crumbHeight(c.at, c.height, headDepth, exposedBurrow) + lift; path[2] = here.lz;
      let points = 1;
      for (let k = 0; k < trail.count; k += 1) {
        const i = (trail.head - k + TRAIL_CAPACITY) % TRAIL_CAPACITY;
        const l = this.toLocal(trail.points[i]);
        path[points * 3] = l.lx;
        path[points * 3 + 1] = this.crumbHeight(trail.points[i], trail.heights[i], trail.depths[i], exposedBurrow) + lift;
        path[points * 3 + 2] = l.lz;
        points += 1;
      }
      layChain(rig.root, rig.chain, chain, scale, rig.headOffset, rig.headFrame, path, points, m, bodyLength, c.phase);
      return;
    }
    const bob = walkBob(m, bodyLength, c.phase) + restBob(m, bodyLength, c.phase, slot.look.restBob, slot.look.restBobRate);
    rig.root.position.set(here.lx, c.height + bob, here.lz);
    // Nose up is a negative turn about +X; heading about +Y; bank about the body's +Z.
    rig.root.rotation.set(-m.pitch, c.heading, m.bank);
    poseLegs(rig.legs, m, bodyLength, c.phase);
    poseWings(rig.wings, m, c.phase);
    poseAntennae(rig.antennae, m, c.phase);
  }

  // ─── the end ───────────────────────────────────────────────────────

  /** Everything this made and everything it loaded. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.order) {
      for (const rig of slot.rigs) slot.group.remove(rig.root);
      slot.rigs = [];
      if (slot.impostor !== null) { slot.group.remove(slot.impostor); slot.impostor.dispose(); slot.impostor = null; }
      if (slot.template !== null) { disposeRig(slot.template); slot.template = null; }
      this.group.remove(slot.group);
    }
    this.impostorGeometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.reveals.clear();
    this.slots.clear();
    this.order.length = 0;
  }
}
