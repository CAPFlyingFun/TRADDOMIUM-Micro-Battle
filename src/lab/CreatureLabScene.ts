/**
 * THE CREATURE LAB: one cubic metre of bench, five animals living their
 * AI together, and the player driving ONE of them at a time — the
 * scene Joshua's brief asks for before any creature goes into Kauaʻi
 * (§6, §7, §8, §25, §26, §29, §30, §32, §40).
 *
 * WHAT IS HERE IS THE PRODUCTION STACK, NOT A LAB COPY OF IT (the
 * brief, §35: "No separate 'lab version' of the creature code"). The
 * bench is `creatures/labWorld.ts`, a `CreatureWorld` the brain reads
 * exactly as it reads the island; the five are placed by `labSpawns`
 * into the same `CreatureSim` the island streams (`populate: false`,
 * `spawn`); who drives whom is the session's `ControlLedger`
 * (`creatures/control.ts`); the thumbs become an `Intent` through
 * `control/PlayerDemand`, and the ONE integrator in
 * `creatures/demand.ts` moves the held body by it while the brain moves
 * the other four. The animals are drawn by `fauna/FaunaView` and the
 * held one is followed by `control/FollowCamera`. This file OWNS none of
 * those; it composes them, reads them for the HUD, and turns a tap into
 * a possession or a disturbance. Its own state is the lab's options
 * (which camera, whether the camera disturbs, whether the tool is
 * armed, the predation policy, the overlay switch) and the per-frame
 * scratch those need.
 *
 * CLOCKS (FrameClock's rule). The cameras and the HUD advance by RAW
 * dt — an instrument keeps easing while the world stands still — and
 * the bench, the simulation and the animals' motion by SIM dt, the
 * clamped step, so a stalled frame moves nobody a metre.
 *
 * THE FOCUS AND THE EYE. The simulation's focus and the renderer's eye
 * are the ACTIVE camera's position from the previous frame — the place
 * the animals were last drawn from — converted at the render boundary
 * (`origin.toWorld`), because a camera holds a rendered position and
 * the simulation wants a world one. In a 1 m box every species' full
 * tier reaches past every wall (`fullM` ≥ 4 m), so all five think and
 * move every frame wherever the eye is; the focus is passed so the
 * production tiering runs, not so it matters here.
 *
 * POSSESSION IS A LEDGER ENTRY AND A CAMERA HANDOFF, nothing else. A
 * tap on a drawn body (`control/pick.ts`, over `FaunaView.positionOf`)
 * or a press on the row writes the ledger; the simulation reads the
 * ledger on its next update and hands the previous body back to its
 * brain (`CreatureSim.syncControl`); the follow camera blends to the new
 * body (`FollowCamera.retarget`). Nothing here touches a creature's
 * state: not its place, not its needs, not its word (the brief, §4).
 *
 * SURFACES (Creature Lab D; Joshua, 2026-09-09: "All the insects
 * besides the worm need to be able to climb vertical and upside down
 * while sticking to the surface. I tried crawling up the wall in the
 * Queen and I got teleported to the top of it"). The bench offers its
 * block as two solids (`LabWorld.climbables`: the pillar and the slab)
 * and the simulation's world carries them through, so the one
 * integrator keeps a climber's feet on whatever face it stands on. The
 * held body's demand is therefore read in THREE dimensions: the
 * player's LOOK — the follow camera's wanted look while following, the
 * free camera's lens direction otherwise — is projected onto the held
 * body's own face by `control/PlayerDemand.demandFromLook`, so the
 * stick's "ahead" is where the player looks AS SEEN FROM THE WALL, and
 * steering is looking on every face. On the ground with a level look
 * that is the old `demandFrom` to 1e-12, which its tests pin. The
 * follow camera orbits off the body's `up` (`FollowTarget.up`): out
 * from a wall, under a ceiling, never inside the block. And the
 * overlay's surface word says which face the feet are on — `on top`,
 * `on wall`, `on ceiling` (`faceUnder`, `faceWord`) — before the old
 * ground/air/host words, whose AGL is height over the FLOOR now that
 * the block is not in the ground: a body on the slab's top reads
 * 200 mm, which is true.
 *
 * OBSERVE is an empty ledger and the free camera. RESET is the world's
 * reset, the ledger cleared, a fresh `CreatureSim` from the same
 * spawns, and the queen held again — the three lines `labWorld.ts`'s
 * header names — with no page reload (§26). The FaunaView is kept
 * across a reset: the ids are the same, so the rigs simply follow.
 *
 * THE DISTURB TOOL arms the next tap: the tapped body's own position if
 * a body was tapped, else where the tap's ray meets the floor plane,
 * emitted through `labWorld.disturb` with source `tool` and the 5 cm
 * radius in `labTool.ts`. CAMERA DISTURBS puts the active camera's eye
 * into the bench as a standing `camera` disturbance, off by default,
 * because "sometimes I need to inspect them without causing everyone to
 * panic" (§30). The disturbance object is ONE mutable record rewritten
 * in place each frame, so the bench relists nothing per frame.
 *
 * THE FREE CAMERA runs at the microscope pace: `FreeFlyCamera`'s slow
 * rung is 1–5 m/s, a bench-crossing every fifth of a second, and the
 * one pace scale the class exposes is the soil section's hundredth
 * (`setSoilInspection`), which makes it 1–5 cm/s on the stick and
 * 5 cm/s on the keys. It is used here for what it is — a pace, not a
 * soil fact — and the integration pass may prefer to name it.
 *
 * Everything the lab needs from the app comes through typed hooks
 * (§2.7): who the player is, what BACK means, and — for a test — the
 * model loader and the clock. It has no session: it is the session, for
 * five animals.
 */
import * as THREE from 'three';
import type { PlayerId } from '../actor/PlayerId';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { assets, type Assets } from '../assets/assets';
import {
  FollowCamera, TAP_PIXELS, demandFromLook, lookDeltaOf, pickCreature, type FollowTarget, type MutableLook, type Ndc, type Viewport,
} from '../control';
import {
  CREATURE_SPECIES, ControlLedger, CreatureSim, LAB_CREATURE_IDS, LAB_FLOOR, LAB_SEED, MM_PER_UNIT, WORLD_UP, createLabWorld,
  faceUnder, faceWord, labSpawns, newMutableIntent, unitsOfMm,
  type Climbable, type CreatureId, type CreatureSpecies, type CreatureState, type CreatureWorld, type Disturbance,
  type DisturbanceSource, type LabWorld, type MutableIntent, type MutableVec3, type PredationPolicy, type Vec3,
} from '../creatures';
import type { CreaturePolicy } from '../creatures/world';
import { FaunaView } from '../fauna/FaunaView';
import type { InputSnapshot, PointerState, TouchPoint } from '../input/Input';
import { NEUTRAL_INTENT, type Intent } from '../input/Intent';
import { MoveStick } from '../input/MoveStick';
import { FrameStats } from '../perf/FrameStats';
import { CAMERA_SPEEDS, FreeFlyCamera } from '../perf/FreeFlyCamera';
import type { CameraPose } from '../session/GameSession';
import { distance, local, world, type WorldPoint } from '../world/coords';
import { setOrigin, toLocal, toWorld } from '../world/origin';
import { LabUi, type CreatureLine, type LabReadout } from './LabUi';
import { HORIZON, buildLabMeshes, type LabMeshes } from './labMeshes';
import {
  CAMERA_PRESENCE, DISTURB_RADIUS, LAB_ACTION, LAB_SCENE_ID, POSSESS_ROW, TAP_SLOP_PX, nextPredation,
  type LabAction, type LabCameraMode,
} from './labTool';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Who the local player is. Built by integration from the device profile; the lab may not read the profile store itself. */
export interface LabIdentity {
  readonly playerId: PlayerId;
  readonly name: string;
}

export interface CreatureLabHooks {
  identity(): LabIdentity;
  /** BACK was pressed (or Escape). The owner decides where that goes — the hub, normally. */
  onBack(): void;
  /**
   * The one loader (`assets.loadModel`), injectable so a test hands in
   * a synthetic rig and reaches no network because a scene was
   * constructed. Absent: the real one.
   */
  loadModel?: Assets['loadModel'];
  /** A millisecond clock for the cost lines only. Absent: `performance.now`. */
  now?(): number;
}

export type CreatureLabWire = (ctx: SceneContext) => CreatureLabHooks;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The five, in the table's order: what the simulation runs and the renderer draws. */
export const LAB_SPECIES: readonly CreatureSpecies[] = Object.freeze(LAB_CREATURE_IDS.map((id) => CREATURE_SPECIES[id]));

/** The bench's centre: the rendered origin sits on it, so local and world coordinates agree in the box. */
const CENTRE: WorldPoint = world(0, 0);

/**
 * Where the free camera starts: over the south-east corner, looking down
 * at the block's top — the whole bench in frame, the block in the middle.
 * GAME TUNING. `yaw` is `FreeFlyCamera`'s: π/4 looks along (−1, −1)/√2.
 */
export const FREE_START: CameraPose = Object.freeze({
  at: world(62, 62), height: LAB_FLOOR + 48, yaw: Math.PI / 4, pitch: -0.31,
});

/** The free camera's glass: half a millimetre to four metres — the box and nothing beyond it. */
const FREE_NEAR = 0.05;
const FREE_FAR = 400;

/** The detail rung the lab draws at: one rig per ant either way, and rigs for the three (`fauna/FaunaView.POOL_SIZES`). */
const LAB_RUNG = 'medium';

/** How the overlay's speed reading is smoothed: a short time constant, so it reads and does not flicker. GAME TUNING. */
const SPEED_TAU_S = 0.15;

/** The floor's plane in render coordinates, for the tap the DISTURB tool lands on the bench. */
const FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LAB_FLOOR);

/** A body is off the ground, or under it, past this: half a millimetre. */
const SURFACE_EPSILON = 0.05;

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

/** No button held: what the demand reads before the HUD exists. */
const NO_HELD = Object.freeze({ up: false, down: false, primary: false, secondary: false, sprint: false });

const POLICIES: Readonly<Record<PredationPolicy, CreaturePolicy>> = Object.freeze({
  off: Object.freeze({ predation: 'off' as PredationPolicy }),
  normal: Object.freeze({ predation: 'normal' as PredationPolicy }),
  force: Object.freeze({ predation: 'force' as PredationPolicy }),
});

// ---------------------------------------------------------------------------
// The lab: the bench, the ledger, the simulation, the options
// ---------------------------------------------------------------------------

export interface CreatureLabOptions {
  /** A millisecond clock for the simulation's cost line. Default: a clock that never moves. */
  readonly now?: () => number;
  /** The seed the five body lengths are drawn under (`labSpawns`). Default `LAB_SEED`. */
  readonly seed?: number;
}

/**
 * The lab without a screen: what a test drives and the scene wraps. It
 * owns the bench, the ledger, the simulation it rebuilds on reset, the
 * predation option and the local player's current demand — and the one
 * `CreatureWorld` the simulation reads, which is the bench plus the
 * lab's options (`policy`, `creatures`), since `labWorld.ts` provides
 * the bench and nothing about what the lab is testing today.
 */
export class CreatureLab {
  readonly world: LabWorld;
  readonly ledger = new ControlLedger();
  readonly player: PlayerId;
  readonly species: readonly CreatureSpecies[] = LAB_SPECIES;
  /** What the simulation reads: the bench, the policy, and every simulated body for a brain that hunts. */
  readonly simWorld: CreatureWorld;
  sim: CreatureSim;
  private policy: CreaturePolicy = POLICIES.off;
  private intentNow: Intent = NEUTRAL_INTENT;
  private readonly ids = new Map<CreatureId, string>();
  private readonly now: () => number;
  private readonly seed: number | undefined;

  constructor(player: PlayerId, options: CreatureLabOptions = {}) {
    this.player = player;
    this.now = options.now ?? (() => 0);
    this.seed = options.seed;
    this.world = createLabWorld();
    const lab = this;
    const bench = this.world;
    this.simWorld = {
      get policy(): CreaturePolicy {
        return lab.policy;
      },
      creatures: () => lab.sim.creatures(),
      home: bench.home,
      inBounds: bench.inBounds,
      inwardTarget: bench.inwardTarget,
      groundAt: bench.groundAt,
      normalAt: bench.normalAt,
      habitatAt: bench.habitatAt,
      plantsOf: bench.plantsOf,
      resourcesOf: bench.resourcesOf,
      water: bench.water,
      weather: bench.weather,
      disturbances: bench.disturbances,
      // The block as solids (Creature Lab D): what a climber's feet stay on, and what the worm treats as ground it cannot enter.
      climbables: bench.climbables,
    };
    this.sim = this.build();
  }

  /** A fresh simulation holding the deterministic five, nobody possessed yet. */
  private build(): CreatureSim {
    const sim = new CreatureSim({
      world: this.simWorld,
      seed: LAB_SEED,
      populate: false,
      species: this.species,
      control: this.ledger,
      intentOf: (player) => (player === this.player ? this.intentNow : NEUTRAL_INTENT),
      now: this.now,
      rung: LAB_RUNG,
    });
    this.ids.clear();
    for (const spawn of labSpawns(this.seed === undefined ? {} : { seed: this.seed })) {
      const c = sim.spawn(spawn);
      this.ids.set(c.species, c.id);
    }
    return sim;
  }

  /** The creature id a species was spawned as, or null for a species the lab does not run. */
  idOf(species: CreatureId): string | null {
    return this.ids.get(species) ?? null;
  }

  creatureOf(species: CreatureId): CreatureState | null {
    const id = this.ids.get(species);
    return id === undefined ? null : this.sim.creature(id);
  }

  /** The body the local player holds, or null in observer mode. */
  held(): CreatureState | null {
    const id = this.ledger.creatureOf(this.player);
    return id === null ? null : this.sim.creature(id);
  }

  heldSpecies(): CreatureSpecies | null {
    const c = this.held();
    return c === null ? null : CREATURE_SPECIES[c.species];
  }

  /**
   * Take a body: by species (`'queen'`) or by creature id. Writes the
   * ledger and nothing else — the simulation reads the book on its next
   * update. Returns the body taken, or null for a name the lab has no
   * body for.
   */
  possess(target: CreatureId | string): CreatureState | null {
    const id = target in CREATURE_SPECIES ? this.ids.get(target as CreatureId) ?? null : target;
    if (id === null) return null;
    const c = this.sim.creature(id);
    if (c === null) return null;
    this.ledger.possess(id, this.player);
    return c;
  }

  /** CONTROL = NONE: everyone gets their brain back on the next update. */
  observe(): void {
    this.ledger.clear();
  }

  get predation(): PredationPolicy {
    return this.policy.predation;
  }

  setPredation(policy: PredationPolicy): void {
    this.policy = POLICIES[policy];
  }

  cyclePredation(): PredationPolicy {
    this.setPredation(nextPredation(this.policy.predation));
    return this.policy.predation;
  }

  /** What the local player wants this frame; read by the simulation for the body the ledger says they hold. */
  setIntent(intent: Intent): void {
    this.intentNow = intent;
  }

  /** One simulation step: the bench's clock, then the animals. `dt` is SIM dt. */
  advance(focus: WorldPoint, dt: number): void {
    this.world.advance(dt);
    this.sim.update(focus, dt);
  }

  /**
   * RESET LAB, the three lines in `labWorld.ts`'s order: the bench back
   * as constructed, everyone let go, a fresh simulation from the same
   * spawns — and the queen held again, the lab's default. Returns her.
   */
  reset(): CreatureState {
    this.world.reset();
    this.ledger.clear();
    this.sim = this.build();
    const queen = this.possess('queen');
    if (queen === null) throw new Error('CreatureLab: the spawns hold no queen');
    return queen;
  }
}

// ---------------------------------------------------------------------------
// The tap: a press that ends where it began
// ---------------------------------------------------------------------------

/**
 * Tells a tap from a drag on the canvas. `Input` reports a press as it
 * begins (`onPointerDown`) and its movement per frame in the snapshot;
 * a press whose accumulated travel stays inside `TAP_SLOP_PX` when it
 * ends is a tap, at the point it began. Mouse and touch are read from
 * the two places the snapshot keeps them.
 */
class TapTracker {
  private kind: 'mouse' | 'touch' | null = null;
  private id = 0;
  private moved = 0;
  /** Where the press began, CSS pixels. Valid after `observe` returns true. */
  x = 0;
  y = 0;

  begin(e: PointerEvent): void {
    if (this.kind !== null) return;
    if (e.pointerType === 'touch') {
      this.kind = 'touch';
      this.id = e.pointerId;
    } else {
      // The primary button only: a right-click is the free camera's context menu, suppressed.
      if (e.button !== 0) return;
      this.kind = 'mouse';
    }
    this.x = e.clientX;
    this.y = e.clientY;
    this.moved = 0;
  }

  observe(snapshot: InputSnapshot): boolean {
    if (this.kind === null) return false;
    if (this.kind === 'mouse') {
      const p: PointerState = snapshot.pointer;
      this.moved += Math.abs(p.dx) + Math.abs(p.dy);
      if (p.down) return false;
    } else {
      let live: TouchPoint | null = null;
      const touches = snapshot.touches;
      for (let i = 0; i < touches.length; i += 1) if (touches[i].id === this.id) live = touches[i];
      if (live !== null) {
        this.moved += Math.abs(live.dx) + Math.abs(live.dy);
        return false;
      }
    }
    const tap = this.moved <= TAP_SLOP_PX;
    this.kind = null;
    return tap;
  }

  cancel(): void {
    this.kind = null;
  }
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/** The scene, with the lab reachable for a test that wants the numbers behind the words. */
export interface CreatureLabScene extends AppScene {
  readonly lab: CreatureLab;
  readonly follow: FollowCamera;
  readonly free: FreeFlyCamera;
  readonly cameraMode: LabCameraMode;
  readonly cameraDisturbs: boolean;
  readonly disturbArmed: boolean;
  readonly debug: boolean;
  /** The renderer's view, once `enter()` has built it. */
  readonly fauna: FaunaView | null;
  /** A tap on the canvas at CSS pixels, as the pointer would deliver it: what a test drives instead of a pointer. */
  tap(x: number, y: number): void;
}

interface MutableTarget extends FollowTarget {
  at: WorldPoint;
  height: number;
  heading: number;
  up: Vec3;
  lengthUnits: number;
}

interface MutableDisturbance extends Disturbance {
  at: WorldPoint;
  height: number;
  radius: number;
  source: DisturbanceSource;
}

interface MutableSnapshot extends InputSnapshot {
  keys: ReadonlySet<string>;
  pointer: PointerState;
  touches: readonly TouchPoint[];
  wheel: number;
}

interface MutableViewport extends Viewport {
  width: number;
  height: number;
}

interface MutableNdc extends Ndc {
  x: number;
  y: number;
}

/** The overlay's speed reading per creature: last place, smoothed mm/s. */
interface Speed {
  wx: number;
  wz: number;
  height: number;
  mmS: number;
}

interface MutableReadout extends LabReadout {
  held: CreatureSpecies | null;
  camera: LabCameraMode;
  predation: PredationPolicy;
  disturbArmed: boolean;
  cameraDisturbs: boolean;
  debug: boolean;
  fps: number;
  frameMs: number;
  aiMs: number;
  animMs: number;
  lines: CreatureLine[];
}

function newLine(species: CreatureSpecies): CreatureLine {
  return {
    species: species.id, name: species.name, player: false, medium: species.medium, behaviour: 'idle', targetMm: null,
    hunger: 0, fatigue: 0, alarm: 0, speedMmS: 0, aglMm: 0, surface: '', sinceThink: 0, thinkS: species.thinkS, hostId: null,
    x: 0, z: 0, screenX: null, screenY: null, edits: null,
  };
}

/**
 * The ground/surface word for a body: the box face under its feet when
 * there is one (Creature Lab D: `on top`, `on wall`, `on ceiling` —
 * asked fresh, never remembered), else where it is relative to the
 * ground under it, read by its medium.
 */
function surfaceWord(c: CreatureState, species: CreatureSpecies, ground: number, climbables: readonly Climbable[]): string {
  const face = faceUnder(c.at, c.height, c.up, climbables);
  if (face !== null) return faceWord(face.normal);
  if (!Number.isFinite(ground)) return 'no ground';
  const above = c.height - ground;
  if (above < -SURFACE_EPSILON) return 'underground';
  if (above > SURFACE_EPSILON) return species.medium === 'plant' ? 'on host' : 'airborne';
  return species.medium === 'soil' ? 'on surface' : 'on ground';
}

export function buildCreatureLabScene(ctx: SceneContext, hooks: CreatureLabHooks): CreatureLabScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color(HORIZON);

  const now = hooks.now ?? ((): number => performance.now());
  const lab = new CreatureLab(hooks.identity().playerId, { now });
  const follow = new FollowCamera();
  const free = new FreeFlyCamera(60, FREE_NEAR, FREE_FAR);
  free.speed = CAMERA_SPEEDS.slow;
  free.setSoilInspection(true);
  const stats = new FrameStats();
  const taps = new TapTracker();

  let meshes: LabMeshes | null = null;
  let fauna: FaunaView | null = null;
  let ui: LabUi | null = null;
  let stick: MoveStick | null = null;
  let offKey: (() => void) | null = null;
  let offPointer: (() => void) | null = null;

  let cameraMode: LabCameraMode = 'follow';
  /** The follow camera has been placed by an update since its last retarget: its pose is worth handing to the free camera. */
  let followPlaced = false;
  let cameraDisturbs = false;
  let disturbArmed = false;
  let debug = true;
  let frameMs = 0;
  let animMs = 0;

  // Per-frame scratch, rewritten in place (the header: no allocation on the frame path that is this file's).
  const intent: MutableIntent = newMutableIntent();
  const target: MutableTarget = { at: CENTRE, height: LAB_FLOOR, heading: 0, up: WORLD_UP, lengthUnits: 1 };
  const look: MutableLook = { dx: 0, dy: 0 };
  /** The player's look as a world direction, for the demand: written by the active camera each frame (the header, SURFACES). */
  const lookDir: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** The free camera's lens direction, read through three and copied into `lookDir` — a direction, so the render frame's is the world's. */
  const lensDir = new THREE.Vector3();
  const flySnap: MutableSnapshot = {
    keys: EMPTY_KEYS, pointer: { down: false, buttons: 0, x: 0, y: 0, dx: 0, dy: 0 }, touches: [], wheel: 0,
  };
  const eyeDisturbance: MutableDisturbance = { at: CENTRE, height: LAB_FLOOR, radius: CAMERA_PRESENCE, source: 'camera' };
  const viewport: MutableViewport = { width: 932, height: 430 };
  const ndc: MutableNdc = { x: 0, y: 0 };
  const ndc2 = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const floorHit = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const speeds = new Map<string, Speed>();
  const readout: MutableReadout = {
    held: null, camera: 'follow', predation: lab.predation, disturbArmed: false, cameraDisturbs: false, debug: true,
    fps: 0, frameMs: 0, aiMs: 0, animMs: 0, lines: POSSESS_ROW.map((entry) => newLine(CREATURE_SPECIES[entry.species])),
  };

  const following = (): boolean => cameraMode === 'follow' && lab.ledger.size > 0;
  const activeCamera = (): THREE.PerspectiveCamera => (following() ? follow.camera : free.camera);

  const targetOf = (c: CreatureState): FollowTarget => {
    target.at = c.at;
    target.height = c.height;
    target.heading = c.heading;
    target.up = c.up;
    target.lengthUnits = unitsOfMm(c.lengthMm);
    return target;
  };

  /** The overlay's speed readings start again from where everyone is: after a build, and after a reset. */
  const seedSpeeds = (): void => {
    speeds.clear();
    for (const species of LAB_SPECIES) {
      const c = lab.creatureOf(species.id);
      if (c !== null) speeds.set(c.id, { wx: c.at.wx, wz: c.at.wz, height: c.height, mmS: 0 });
    }
  };
  seedSpeeds();

  const measureSpeeds = (dt: number): void => {
    if (!(dt > 0)) return;
    const k = 1 - Math.exp(-dt / SPEED_TAU_S);
    for (const species of LAB_SPECIES) {
      const c = lab.creatureOf(species.id);
      if (c === null) continue;
      const s = speeds.get(c.id);
      if (s === undefined) continue;
      const moved = Math.hypot(c.at.wx - s.wx, c.at.wz - s.wz, c.height - s.height);
      const instant = (moved / dt) * MM_PER_UNIT;
      s.mmS += (instant - s.mmS) * k;
      s.wx = c.at.wx;
      s.wz = c.at.wz;
      s.height = c.height;
    }
  };

  /** The camera's matrices as a projection needs them; the renderer refreshes them on a draw, a test never does. */
  const refreshCamera = (camera: THREE.Camera): void => {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  };

  const fillLines = (): void => {
    const camera = activeCamera();
    refreshCamera(camera);
    for (const line of readout.lines) {
      const species = CREATURE_SPECIES[line.species];
      const c = lab.creatureOf(line.species);
      if (c === null) continue;
      const ground = lab.world.groundAt(c.at);
      line.player = lab.ledger.isPossessed(c.id);
      line.behaviour = c.behaviour;
      line.targetMm = c.target === null ? null : distance(c.at, c.target) * MM_PER_UNIT;
      line.hunger = c.hunger;
      line.fatigue = c.fatigue;
      line.alarm = c.alarm;
      line.speedMmS = speeds.get(c.id)?.mmS ?? 0;
      line.aglMm = Number.isFinite(ground) ? (c.height - ground) * MM_PER_UNIT : 0;
      line.surface = surfaceWord(c, species, ground, lab.world.climbables);
      line.sinceThink = c.sinceThink;
      line.thinkS = species.thinkS;
      line.hostId = c.hostId;
      line.x = c.at.wx;
      line.z = c.at.wz;
      line.edits = species.medium === 'soil' ? (lab.sim.burrows.editor.built ? 'ON' : 'OFF') : null;
      // The drawn body's centre when there is one; the SIM's own position
      // when there is not (a buried worm, a rig not yet lent) — the px is
      // where a DISTURB tap or a possess tap should aim, and a worm that
      // is under the soil is still somewhere. The pick itself stays over
      // drawn bodies (control/pick.ts); an undrawn worm is disturbed
      // through the floor under the tap, which is within its reach.
      const drawn = fauna === null ? null : fauna.positionOf(c.id);
      if (drawn === null) {
        const l = toLocal(c.at);
        projected.set(l.lx, c.height, l.lz);
      } else {
        projected.copy(drawn);
      }
      projected.project(camera);
      const inFront = projected.z < 1 && Number.isFinite(projected.x) && Number.isFinite(projected.y);
      line.screenX = inFront ? ((projected.x + 1) / 2) * viewport.width : null;
      line.screenY = inFront ? ((1 - projected.y) / 2) * viewport.height : null;
    }
  };

  const readoutNow = (): LabReadout => {
    const cost = lab.sim.cost();
    readout.held = lab.heldSpecies();
    readout.camera = cameraMode;
    readout.predation = lab.predation;
    readout.disturbArmed = disturbArmed;
    readout.cameraDisturbs = cameraDisturbs;
    readout.debug = debug;
    readout.fps = stats.summary().meanFps;
    readout.frameMs = frameMs;
    readout.aiMs = cost.thinkMs + cost.moveMs + cost.demandMs;
    readout.animMs = animMs;
    fillLines();
    return readout;
  };

  /** Hand the free camera the follow camera's pose, so a switch is a cut to the same eye and not a jump across the bench. */
  const freeFromFollow = (): void => {
    if (followPlaced) free.restore(follow.pose());
  };

  /** Start the follow camera's handoff blend from where the free camera's eye is. */
  const followFromFree = (c: CreatureState): void => {
    follow.camera.position.copy(free.camera.position);
    follow.retarget(targetOf(c));
    followPlaced = false;
  };

  const possess = (which: CreatureId | string): void => {
    const before = lab.held();
    const c = lab.possess(which);
    if (c === null) return;
    if (before === null) {
      // Out of observer mode: the control camera comes with the control.
      if (cameraMode === 'free') followFromFree(c);
      else {
        follow.retarget(targetOf(c));
        followPlaced = false;
      }
      cameraMode = 'follow';
    } else {
      // A switch: the lens blends to the new body; a free camera stays free, and finds the new body on its next toggle.
      follow.retarget(targetOf(c));
      followPlaced = false;
    }
    ui?.refreshNow();
  };

  const observe = (): void => {
    if (cameraMode === 'follow') freeFromFollow();
    lab.observe();
    cameraMode = 'free';
    ui?.refreshNow();
  };

  const toggleCamera = (): void => {
    const c = lab.held();
    if (c === null) return;
    if (cameraMode === 'follow') {
      freeFromFollow();
      cameraMode = 'free';
    } else {
      followFromFree(c);
      cameraMode = 'follow';
    }
    ui?.refreshNow();
  };

  const reset = (): void => {
    const queen = lab.reset();
    seedSpeeds();
    disturbArmed = false;
    // The bench's reset dropped the camera's presence; the lab's own switch decides whether it is put back.
    if (cameraDisturbs) lab.world.setCameraDisturbance(eyeDisturbance);
    if (cameraMode === 'free') followFromFree(queen);
    else {
      follow.retarget(targetOf(queen));
      followPlaced = false;
    }
    cameraMode = 'follow';
    ui?.refreshNow();
  };

  const setCameraDisturbs = (on: boolean): void => {
    cameraDisturbs = on;
    lab.world.setCameraDisturbance(on ? eyeDisturbance : null);
  };

  const onAction = (action: LabAction): void => {
    switch (action) {
      case LAB_ACTION.observe:
        observe();
        return;
      case LAB_ACTION.camera:
        toggleCamera();
        return;
      case LAB_ACTION.predation:
        lab.cyclePredation();
        return;
      case LAB_ACTION.disturb:
        disturbArmed = !disturbArmed;
        return;
      case LAB_ACTION.cameraDisturbs:
        setCameraDisturbs(!cameraDisturbs);
        return;
      case LAB_ACTION.reset:
        reset();
        return;
      case LAB_ACTION.debug:
        debug = !debug;
        return;
    }
  };

  /** Where the tap's ray meets the floor plane, as a world point, or null when it looks at the sky. */
  const floorUnder = (camera: THREE.Camera): WorldPoint | null => {
    ndc2.set(ndc.x, ndc.y);
    raycaster.setFromCamera(ndc2, camera);
    const hit = raycaster.ray.intersectPlane(FLOOR_PLANE, floorHit);
    if (hit === null) return null;
    return toWorld(local(hit.x, hit.z));
  };

  const radiusOf = (id: string): number => {
    const c = lab.sim.creature(id);
    return c === null ? 0 : unitsOfMm(c.lengthMm) / 2;
  };

  /** A tap at CSS pixels: a possession, or — armed — a disturbance where it landed. */
  const tap = (x: number, y: number): void => {
    if (!(viewport.width > 0) || !(viewport.height > 0)) return;
    ndc.x = (x / viewport.width) * 2 - 1;
    ndc.y = 1 - (y / viewport.height) * 2;
    const camera = activeCamera();
    refreshCamera(camera);
    const picked = fauna === null
      ? null
      : pickCreature(ndc, camera, fauna.drawnIds(), (id) => fauna!.positionOf(id), radiusOf, TAP_PIXELS, viewport);
    if (disturbArmed) {
      disturbArmed = false;
      const body = picked === null ? null : lab.sim.creature(picked);
      const at = body !== null ? body.at : floorUnder(camera);
      if (at !== null) {
        const height = body !== null ? body.height : lab.world.groundAt(at);
        lab.world.disturb({ at, height, radius: DISTURB_RADIUS, source: 'tool' });
      }
      ui?.refreshNow();
      return;
    }
    if (picked !== null) possess(picked);
  };

  return {
    name: LAB_SCENE_ID,
    three,
    lab,
    follow,
    free,
    get camera(): THREE.Camera {
      return activeCamera();
    },
    get cameraMode(): LabCameraMode {
      return cameraMode;
    },
    get cameraDisturbs(): boolean {
      return cameraDisturbs;
    },
    get disturbArmed(): boolean {
      return disturbArmed;
    },
    get debug(): boolean {
      return debug;
    },
    get fauna(): FaunaView | null {
      return fauna;
    },
    tap,

    async enter() {
      // One rendered scene, one origin under it: on the bench's centre, as every scene resets the shared singleton.
      setOrigin(CENTRE);

      meshes = buildLabMeshes();
      three.add(meshes.group);

      // THE ANIMALS' RENDERER, over the bench's own ground so a worm is
      // hidden by depth and a fly stands off the floor it feels. No soil
      // view: the bench has no cutaway.
      const bench = lab.world;
      fauna = new FaunaView({
        species: LAB_SPECIES,
        loadModel: hooks.loadModel ?? assets.loadModel,
        rung: LAB_RUNG,
        groundAt: (at) => bench.groundAt(at),
      });
      // The rigs load in the background; the impostors carry the animals until they arrive.
      void fauna.ready();
      three.add(fauna.group);

      ui = new LabUi(ctx.uiLayer, {
        readout: readoutNow,
        onPossess: (species) => possess(species),
        onAction,
        onBack: () => hooks.onBack(),
      });
      // THE STICK — v0's, fixed and visible, bottom-left, the same one the
      // Performance World reads: into the held body while someone is held,
      // into the free camera while nobody is.
      stick = new MoveStick(ctx.uiLayer);

      free.restore(FREE_START);
      // DEFAULT CONTROL: the queen (the brief, §4).
      possess('queen');

      offKey = ctx.input.onKeyDown((code) => {
        if (code === 'Escape') hooks.onBack();
      });
      offPointer = ctx.input.onPointerDown((e) => taps.begin(e));
      ui.refreshNow();
    },

    update(frame: FrameInfo) {
      stats.record(frame.rawDt, frame.simDt);
      if (Number.isFinite(frame.rawDt) && frame.rawDt > 0) frameMs += (frame.rawDt * 1000 - frameMs) * 0.1;
      const snap = ctx.input.snapshot();
      const stickRead = stick === null ? null : stick.read();
      if (taps.observe(snap)) tap(taps.x, taps.y);

      const held = lab.held();
      const heldSpecies = held === null ? null : CREATURE_SPECIES[held.species];
      const isFollowing = held !== null && cameraMode === 'follow';
      const camera = isFollowing ? follow.camera : free.camera;

      // THE PLAYER'S HALF: the thumbs into the held body's frame ON ITS
      // FACE, steering toward where the player looks. The look is the
      // follow camera's WANTED bearing as a direction (not the lens's
      // measured one — `FollowCamera`'s header says why), or the free
      // camera's lens direction; `demandFromLook` projects it onto the
      // held body's `up` (the header, SURFACES).
      if (held !== null && heldSpecies !== null) {
        if (isFollowing) follow.wantedLook(lookDir);
        else {
          free.camera.getWorldDirection(lensDir);
          lookDir.x = lensDir.x;
          lookDir.y = lensDir.y;
          lookDir.z = lensDir.z;
        }
        lab.setIntent(demandFromLook(
          snap, stickRead, lookDir, held.heading, held.up, heldSpecies.medium, ui === null ? NO_HELD : ui.buttons, heldSpecies.flight !== null, intent,
        ));
      } else {
        lab.setIntent(NEUTRAL_INTENT);
      }

      // THE EYE, in world coordinates: where the animals were last drawn from.
      const eyeAt = toWorld(local(camera.position.x, camera.position.z));
      const eyeHeight = camera.position.y;
      if (cameraDisturbs) {
        eyeDisturbance.at = eyeAt;
        eyeDisturbance.height = eyeHeight;
      }

      // THE BENCH AND THE ANIMALS, by SIM dt.
      lab.advance(eyeAt, frame.simDt);
      measureSpeeds(frame.simDt);
      if (fauna !== null) {
        const began = now();
        fauna.update(lab.sim.creatures(), eyeAt, frame.simDt, eyeHeight);
        animMs = now() - began;
      }

      // THE CAMERAS, by RAW dt. The follow camera reads the held body
      // where it is THIS frame; the free camera reads the thumbs only
      // while nobody is held, and the look drag always.
      if (isFollowing) {
        follow.update(frame.rawDt, targetOf(held), lookDeltaOf(snap, look));
        followPlaced = true;
      } else {
        flySnap.keys = held === null ? snap.keys : EMPTY_KEYS;
        flySnap.pointer = snap.pointer;
        flySnap.touches = snap.touches;
        flySnap.wheel = snap.wheel;
        free.update(flySnap, frame.rawDt, held === null ? stickRead : null);
      }

      ui?.update(frame.rawDt);
    },

    resize(width, height) {
      viewport.width = width;
      viewport.height = height;
      follow.resize(width, height);
      free.resize(width, height);
    },

    dispose() {
      offKey?.();
      offKey = null;
      offPointer?.();
      offPointer = null;
      taps.cancel();
      ui?.dispose();
      ui = null;
      stick?.dispose();
      stick = null;
      if (fauna !== null) {
        three.remove(fauna.group);
        fauna.dispose();
        fauna = null;
      }
      if (meshes !== null) {
        three.remove(meshes.group);
        meshes.dispose();
        meshes = null;
      }
      lab.world.setCameraDisturbance(null);
    },
  };
}


export function createCreatureLabScene(wire: CreatureLabWire): SceneFactory {
  return (ctx) => buildCreatureLabScene(ctx, wire(ctx));
}
