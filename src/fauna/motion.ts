/**
 * HOW THE RIGS MOVE — all of it procedural, because the GLBs ship no
 * clips (measured: zero animations in all three), and driven only by
 * continuous signals a renderer is allowed to read (ARCHITECTURE §2.2):
 * how far the body has travelled, how fast it is climbing, how hard it
 * is turning, a 0..1 lever for "in the air", and the creature's own
 * phase. Never a behaviour by name.
 *
 * ─── the worm: a train on a path ────────────────────────────────────
 *
 * A worm is a tube laid along where it has been. `layChain` takes the
 * trail the view keeps (newest point first, ALREADY in render space)
 * and seats each bone its own REST length behind the last, by arc
 * length, the way TCS's `WormBody` does and for the reason it gives: a
 * rigid body along its heading would have most of a 150 mm animal
 * outside the hole it dug. Two things are done differently here. The
 * ROOT bone is given a full frame — forward along the path, belly down
 * — rather than the shortest arc from its rest direction, so the skin
 * does not roll about the body as the animal turns; the bones below it
 * are still shortest-arc in their parent's frame, where the bends are
 * small and roll-free.
 *
 * ─── the stations are the rest lengths, and nothing else ────────────
 *
 * Joshua, 2026-09-08, from the device: "It needs to be like TCS and act
 * like the snake game where the head is the first bone and as it moves,
 * the next bone follows the same exact path." So bone i is seated
 * exactly `sum(lengths[0..i−1]) × rootScale` behind the head, measured
 * along the path, every frame, for ever. The running totals are built
 * ONCE per chain (`reachOf`, TCS's `WormBody.measureChain` and its
 * reason verbatim: a skeleton's bone lengths do not change, only its
 * angles do), so the only thing that can move a bone is the path moving
 * under it — the head advances, and every bone behind it arrives at the
 * station the one in front has just left.
 *
 * PERISTALSIS IS GONE, and that is worth a paragraph rather than a
 * hole. It used to scale each segment by a retrograde wave (Quillin
 * 1999, J. Exp. Biol.) and then seat the bones at the STRETCHED
 * lengths, which made the wave's amplitude part of the station: every
 * bone slid a few millimetres back and forth ALONG the path as the wave
 * passed. A whole number of wavelengths kept the total exact, so the
 * animal never grew — but no bone held station, and a body whose bones
 * shuffle along the path is not a body following the head. The wave's
 * two jobs cannot be separated in a chain: a segment's drawn length IS
 * the distance from one joint to the next, so a wave in it moves a
 * joint along the path whether it is applied to the station or to the
 * child's offset, and the third way — scaling the bone — was rejected
 * long before this, because a non-uniform scale on a rotated hierarchy
 * shears the children and sixteen compounding scales drift. Asked for
 * the snake, the squirm is what the snake costs. Do not put it back in
 * any of those three forms.
 *
 * ─── legs: a tripod driven by distance ──────────────────────────────
 *
 * Six coxae turn about the body's vertical by how far the animal has
 * WALKED — not by time, so a creature that slows does not moonwalk —
 * in the alternating tripod `gait.ts` describes: L1/R2/L3 swing while
 * R1/L2/R3 stand, the foot carried forward on a raised cosine and
 * dragged back linearly under the body, and the second bone of each
 * chain — the femur — pitched about the leg's own sideways so a
 * swinging foot LIFTS instead of sliding along the ground (rigs.md
 * §6.1 named the joint; the Lab's camera sits close enough to see a
 * slide). Standing, the legs stir on a slow clock so the animal reads
 * as alive rather than as a model; the stride contributes nothing at
 * rest, because a stride that does not advance did not happen.
 *
 * THE TURN IS SIGNED BY SIDE, and this is a fix rather than a choice.
 * The old poser applied one signed angle to every coxa and relied on
 * the tripod's half-cycle offset to alternate the legs, but a turn about
 * the body's up carries a +X leg's foot BACK and a −X leg's foot FORWARD
 * by the same angle — the mirror cancelled the offset, and a mirrored
 * pair moved forward together. At ant scale on the island nobody saw
 * it; in a one-metre box with the animal possessed, a pronk is not a
 * walk. `−side × protraction` puts both feet of a pair forward on +1.
 *
 * ─── the stride is counted, not divided out of the distance ─────────
 *
 * `RigMotion.strides` is how many stride cycles the body has walked,
 * advanced each frame by the distance walked over the stride the
 * measured SPEED takes (`gait.strideLengthsAt` — the header there has
 * Joshua's aphid and the biology). Every poser that beats with the
 * stride — the legs, the walk bob, the gaster's bounce, the antennae's
 * tap — reads that count; `gone`, the raw distance, stays for whatever
 * wants a distance. A count only advances with distance, so a stopped
 * animal still has still feet.
 *
 * ─── the root's frame is an up and a heading, not a yaw ─────────────
 *
 * Joshua, 2026-09-09: "All the insects besides the worm need to be able
 * to climb vertical and upside down while sticking to the surface."
 * A body on a wall has `CreatureState.up` = the wall's normal and its
 * heading measured in the wall's plane (`creatures/surface.ts`,
 * `aheadOn`). The root quaternion is built from that basis — local +Z
 * the ahead, local +Y the up, local +X = up × ahead, the animal's LEFT,
 * which is the rigs' +X side (`gait.ts`) — and the flight attitude is
 * applied AFTER it as local turns in the sense the old Euler had: nose
 * up a negative turn about the body's X, then the bank about the body's
 * Z. For `up = WORLD_UP` the basis is the yaw about +y and the
 * composition is the old `Euler(−pitch, heading, bank, 'YXZ')` to 1e-12
 * (`tests/faunaPose.test.ts` pins it), so nothing on the island turns
 * differently.
 *
 * THE UP IS EASED, THE HEADING IS NOT. The simulation's up changes by a
 * quarter turn in one frame at an edge and by a half at a takeoff from
 * a ceiling, and a body that snapped with it would be the "world-up
 * recovery" the brief forbids. So each rig keeps a `drawnUp` turned
 * toward the state's up with the time constant `UP_EASE_S` (`easeUp`),
 * and the basis is built from THAT, with the heading CARRIED into it:
 * `drawnAhead` is `aheadOn(up, heading)` rotated by the one rotation
 * from the state's up to the drawn one (`rotateBetween`), which is the
 * rotation the body's own ahead was carried round the edge by. The
 * heading itself is never eased — a possessed ant's turn must not trail
 * the simulation — and when the drawn up IS the state's up, which is
 * every frame on the ground and the steady state on a face, the carry
 * is the identity and the basis is exact with no lag. The ease turns
 * about the two ups' common perpendicular rather than lerping between
 * them, because a lerp from the ceiling's up to the ground's passes
 * through zero and a normalised zero is a snap; opposite ups turn about
 * the axis `rotateBetween` fixes for that case, so a takeoff from the
 * ceiling rolls the same way every time. Within `UP_SETTLED` of the
 * target the drawn up is SET to it, so the exact basis is reached and
 * not merely approached.
 *
 * ─── wings ──────────────────────────────────────────────────────────
 *
 * The wings are `wings.ts`: the yaw rule that folds a rig baked spread
 * and spreads one baked folded, the per-species beat, the coupled
 * fore/hind pair. That file imports this one's levers, so this one
 * does not import it back.
 *
 * ─── jaws: two joints, never one mirrored value ─────────────────────
 *
 * Joshua, 2026-09-09: "Don't forget to add the mandibles/jaws in the
 * rigging… each jaw is independent." Each mandible is posed from its
 * own angle, eased toward its own target on its own clock: a bite
 * opens both wide and snaps them shut with one jaw a few frames ahead
 * of the other, so a bite reads as a bite and not as a hinge; feeding
 * works them alternately in small strokes; at rest each has its own
 * tiny twitch on its own rate; walking closes them. The asymmetry is
 * DETERMINISTIC — a hash of the creature's phase and the bite's count,
 * never `Math.random` (the source test forbids dice in this directory)
 * — so a replay poses the same bite twice.
 *
 * THIS IS THE FIRST LINK OF THE FEELING BAR (the standing rule: approach →
 * head aims → jaws open → reach → grab → carry, never press → object
 * teleports). The state has no jaw lever yet, so the view turns the
 * behaviour word into two booleans before the poser sees anything —
 * `biting` for the attack and the defend stand, `feeding` for a feed —
 * exactly as the wings read `AIRBORNE` rather than a mode, and the
 * openness is derived here from those and a time envelope. When the
 * grab mechanic lands, a per-jaw 0..1 lever on `CreatureState` is where
 * it goes: `JawSignals` would carry the two levers in place of the
 * booleans, `poseJaws` would ease toward them, and nothing else here
 * would change.
 *
 * ─── head and gaster ────────────────────────────────────────────────
 *
 * The head leads a turn (it yaws into the measured heading rate), dips
 * on a bite, and scans slowly at rest; the gaster curls under on a bite
 * — the sting posture — bobs slowly at rest, and bounces a little with
 * the stride. Both are single joints off the thorax (`rig.findTrunk`),
 * both premultiplied onto the rest quaternion every frame, both small:
 * the rigs' skins were bound with the trunk straight and a large angle
 * at the neck or the petiole folds the mesh.
 *
 * Reads no world coordinate: paths arrive in render space, and every
 * rotation is a bone's local quaternion.
 */
import * as THREE from 'three';
import { aheadOn, rotateBetween, type MutableVec3, type Vec3 } from '../creatures';
import { STRIDES_PER_LENGTH as GAIT_STRIDES_PER_LENGTH, legCycle, lift as gaitLift, protraction, strideCycle, strideLengthsAt } from './gait';
import type { AntennaSpec, ChainSpec, JawSpec, JointSpec, LegSpec } from './rig';

/** How far a leg swings, radians. GAME TUNING (TCS, measured in the creature's frame). */
export const LEG_SWING = 0.22;
/** Full strides per body length at the full stride — `gait.ts`'s number, re-exported for the readers that pin it; the posers count strides now. */
export const STRIDES_PER_LENGTH = GAIT_STRIDES_PER_LENGTH;
/** How far the femur pitches to lift a swinging foot, radians. GAME TUNING: enough to clear the ground, not a high step. */
export const LEG_LIFT = 0.18;
/** The standing stir: how far the legs move, and how fast (cycles a second). GAME TUNING (TCS). */
export const IDLE_STIR = 0.02;
export const IDLE_RATE = 0.55;
/** The walking bob, as a fraction of the body length. GAME TUNING (TCS's 0.06 of height). */
export const WALK_BOB = 0.03;

/** Seconds for the air lever to rise or fall: wings spread and fold over this, the attitude follows it. GAME TUNING. */
export const AIR_EASE_S = 0.12;

/** The antennae's wander at rest: radians, and two cycles a second that never coincide, one per side. GAME TUNING. */
export const ANTENNA_SWAY = 0.15;
export const ANTENNA_RATE = 0.7;
export const ANTENNA_RATE_OTHER = 0.53;
/** The antennae's tap while walking, radians, at the stride rate — feelers that beat the ground ahead. GAME TUNING. */
export const ANTENNA_WALK = 0.1;

/** The open limit of a jaw from its rest, radians. GAME TUNING inside the skin's range: about 30°, a wide gape the mesh survives. */
export const JAW_OPEN = 0.55;
/** A feeding stroke, radians, and the seconds one alternating cycle of the two jaws takes. GAME TUNING. */
export const JAW_FEED = 0.18;
export const JAW_FEED_S = 0.9;
/** The idle twitch, radians, and the two rates, cycles a second, one per jaw. GAME TUNING. */
export const JAW_TWITCH = 0.03;
export const JAW_TWITCH_RATE = 0.31;
export const JAW_TWITCH_RATE_OTHER = 0.43;
/** One bite: the cycle's length, the fraction of it spent opening, and the most the lagging jaw is behind, seconds. GAME TUNING. */
export const JAW_BITE_S = 0.55;
export const JAW_OPEN_FRACTION = 0.65;
export const JAW_LEAD_S = 0.06;
/** Seconds a jaw takes to open toward its target, and to snap shut — the snap is three times quicker. GAME TUNING. */
export const JAW_OPEN_TAU = 0.06;
export const JAW_SNAP_TAU = 0.02;

/** The head: yaw into the turn per radian a second of heading rate, its limit, the bite dip, and the idle scan (radians, Hz). GAME TUNING. */
export const HEAD_TURN_GAIN = 0.05;
export const HEAD_TURN_MAX = 0.3;
export const HEAD_BITE_DIP = 0.12;
export const HEAD_SCAN = 0.06;
export const HEAD_SCAN_RATE = 0.23;
/** The gaster: the curl under on a bite (negative pitches the tip down), the resting bob and its rate, the stride bounce. GAME TUNING. */
export const GASTER_BITE_CURL = -0.25;
export const GASTER_BOB = 0.035;
export const GASTER_BOB_RATE = 0.45;
export const GASTER_STRIDE_BOUNCE = 0.03;
/** Seconds the bite and feed levers take to rise or fall, and the head's turn rate to follow. GAME TUNING. */
export const JAW_LEVER_EASE_S = 0.08;
export const HEAD_EASE_S = 0.12;

/** Body attitude in flight: pitch per unit of climb-over-speed, bank per radian a second of turn, and the limits. GAME TUNING. */
export const PITCH_GAIN = 0.8;
export const PITCH_MAX = 0.6;
export const BANK_PER_RAD_S = 0.15;
export const BANK_MAX = 0.8;
/** Seconds the attitude takes to follow its target — a smoothing, so a sim step does not snap the body. GAME TUNING. */
export const ATTITUDE_EASE_S = 0.15;
/**
 * Seconds the drawn up takes to turn onto the state's up after an edge
 * or a takeoff from a ceiling. GAME TUNING at the attitude ease's order:
 * an edge is a quarter turn, a takeoff from the ceiling a half, and a
 * snap is the thing the brief forbids (the header).
 */
export const UP_EASE_S = 0.15;
/**
 * The chord within which the drawn up is set exactly to the state's up:
 * two thousandths — about a tenth of a degree, invisible — reached from
 * a quarter turn in about a second at `UP_EASE_S`. GAME TUNING of a
 * tolerance, so the exact basis arrives rather than being approached.
 */
export const UP_SETTLED = 2e-3;
/**
 * Speed, in body lengths a second, above which the animal counts as
 * moving; the lever eases over this many seconds. GAME TUNING, set
 * under the slowest walker: a worm's 3 mm/s wander is 0.02 of its
 * 150 mm a second, and it must read as crawling, not resting.
 */
export const MOVING_AT = 0.01;
export const MOVING_EASE_S = 0.1;

/**
 * What a lent rig remembers between frames. Derived from position
 * deltas and booleans the view measures; never written by the
 * simulation.
 */
export interface RigMotion {
  /** World units travelled while lent — the raw distance, for whatever wants one. */
  gone: number;
  /** Stride cycles walked while lent — what drives the gait, the bobs and the antennae's tap (the header). */
  strides: number;
  /** Seconds lent — what drives the idle clocks and the wingbeat. */
  alive: number;
  /** 0..1 levers, eased: moving, and in the air. */
  moving: number;
  air: number;
  /** Radians, eased: nose up positive; bank positive rolls the −X side down. */
  pitch: number;
  bank: number;
  /** 0..1 levers, eased: the jaws are asked to bite, to feed. */
  bite: number;
  feed: number;
  /** Seconds the bite has been asked for — the bite cycle's clock — or −1 while it is not. */
  biteS: number;
  /** Bites begun since the rig was lent: the deterministic seed of which jaw leads each one. */
  bites: number;
  /** The heading rate, radians a second, eased — what the head leads by. */
  turnRate: number;
}

export function newMotion(): RigMotion {
  return { gone: 0, strides: 0, alive: 0, moving: 0, air: 0, pitch: 0, bank: 0, bite: 0, feed: 0, biteS: -1, bites: 0, turnRate: 0 };
}

/** Put a motion back to the moment of lending, in one place, so a rig handed on forgets its last holder entirely. */
export function resetMotion(m: RigMotion, airborne: boolean): void {
  m.gone = 0; m.strides = 0; m.alive = 0; m.moving = 0; m.air = airborne ? 1 : 0; m.pitch = 0; m.bank = 0;
  m.bite = 0; m.feed = 0; m.biteS = -1; m.bites = 0; m.turnRate = 0;
}

/** One frame's measured facts about the creature a rig is drawing. */
export interface MotionSignals {
  /** Seconds this frame. */
  readonly dt: number;
  /**
   * World units moved this frame: ALONG THE SURFACE, in three
   * dimensions, for a legged rig — a wall-climber walks straight up
   * with no planar travel and its legs must not stop — and on the
   * plane for the worm's chain, whose trail is planar. `climbed` is the
   * change in height, signed; the planar part the flight pitch reads
   * is derived from the two (`stepMotion`).
   */
  readonly moved: number;
  readonly climbed: number;
  /** Radians the heading changed this frame, wrapped. */
  readonly turned: number;
  /** In the air (from the state's airborne set — a boolean, not a mode). */
  readonly airborne: boolean;
  /** Asked to bite — an attack, or the defend stand — and asked to feed. Booleans the view derives; absent is false. */
  readonly biting?: boolean;
  readonly feeding?: boolean;
  /** The species' body length, world units. */
  readonly bodyLength: number;
  /** The creature's own phase, 0..1. */
  readonly phase: number;
}

/** Ease `value` toward `target` with time constant `tau` over `dt`. */
function ease(value: number, target: number, tau: number, dt: number): number {
  if (dt <= 0) return value;
  const k = 1 - Math.exp(-dt / tau);
  return value + (target - value) * k;
}

/** Advance the levers and the clocks from this frame's facts. */
export function stepMotion(m: RigMotion, s: MotionSignals): void {
  const dt = s.dt;
  m.gone += s.moved;
  m.alive += dt;
  const speed = dt > 0 ? s.moved / dt : 0;
  // THE STRIDE COUNT: the distance in bodies over the stride the speed
  // takes (`gait.strideLengthsAt`, never zero). No distance, no stride.
  const bodyLength = Math.max(1e-6, s.bodyLength);
  const lengths = s.moved / bodyLength;
  m.strides += lengths / strideLengthsAt(speed / bodyLength);
  const movingNow = speed > MOVING_AT * s.bodyLength ? 1 : 0;
  m.moving = ease(m.moving, movingNow, MOVING_EASE_S, dt);
  m.air = ease(m.air, s.airborne ? 1 : 0, AIR_EASE_S, dt);
  // Attitude follows the measured climb and turn, and only counts in the
  // air. The pitch is the climb against the PLANAR speed, derived from
  // the 3-D distance and the climb so a fly's pitch is the number it was
  // when `moved` was planar.
  const climbRate = dt > 0 ? s.climbed / dt : 0;
  const planar = Math.sqrt(Math.max(0, s.moved * s.moved - s.climbed * s.climbed));
  const planarSpeed = dt > 0 ? planar / dt : 0;
  const turnRate = dt > 0 ? s.turned / dt : 0;
  const pitchTarget = clamp(Math.atan2(climbRate, Math.max(planarSpeed, 1e-6)) * PITCH_GAIN, -PITCH_MAX, PITCH_MAX) * m.air;
  // A heading grows anticlockwise (a left turn, facing +Z); banking into
  // it drops the +X side, which is a negative roll about the body's +Z.
  const bankTarget = clamp(-turnRate * BANK_PER_RAD_S, -BANK_MAX, BANK_MAX) * m.air;
  m.pitch = ease(m.pitch, pitchTarget, ATTITUDE_EASE_S, dt);
  m.bank = ease(m.bank, bankTarget, ATTITUDE_EASE_S, dt);
  m.turnRate = ease(m.turnRate, turnRate, HEAD_EASE_S, dt);
  // The jaws' asks: levers for the poses, and a clock for the bite that
  // starts when the ask does and counts the bites so each is its own.
  const biting = s.biting === true;
  m.bite = ease(m.bite, biting ? 1 : 0, JAW_LEVER_EASE_S, dt);
  m.feed = ease(m.feed, s.feeding === true ? 1 : 0, JAW_LEVER_EASE_S, dt);
  if (biting) {
    if (m.biteS < 0) { m.biteS = 0; m.bites += 1; } else m.biteS += dt;
  } else {
    m.biteS = -1;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * A deterministic 0..1 from two numbers — the one die this file rolls,
 * and it always lands the same way for the same throw. The classic
 * sine hash; nothing here needs better than "not obviously periodic".
 */
export function hash01(a: number, b: number): number {
  return fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
}

const _turn = new THREE.Quaternion();
const _turn2 = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _want = new THREE.Vector3();
const _have = new THREE.Vector3();
const _at = new THREE.Vector3();
const _next = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** A bone with the spec it was found by, resolved on one clone. */
export interface BoundLeg { readonly bone: THREE.Bone; readonly spec: LegSpec; readonly femur: THREE.Bone | null }
export interface BoundAntenna { readonly bone: THREE.Bone; readonly spec: AntennaSpec }
/** A jaw carries its own angle: the one piece of pose state that is eased rather than derived, because a snap is a rate. */
export interface BoundJaw { readonly bone: THREE.Bone; readonly spec: JawSpec; angle: number }
export interface BoundJoint { readonly bone: THREE.Bone; readonly spec: JointSpec }

/**
 * Pose the legs: the tripod when walking, the stir when standing,
 * tucked toward rest in the air. Every frame from the REST quaternion,
 * premultiplied by a turn about the body's vertical in the parent's
 * frame — composing onto last frame's answer winds a leg up in seconds.
 * The femur, where the chain has one, pitches about the leg's own
 * sideways by the swing's lift, so a foot in the air clears the ground.
 */
export function poseLegs(legs: readonly BoundLeg[], m: RigMotion, _bodyLength: number, phase: number): void {
  // The strides walked, counted by the view at the speed's own stride length (the header); the body length is in the count.
  const cycle = strideCycle(m.strides, phase);
  const stir = (m.alive * IDLE_RATE + phase) * Math.PI * 2;
  const ground = 1 - m.air;
  for (const { bone, spec, femur } of legs) {
    const leg = legCycle(cycle, spec.phase);
    const half = spec.phase * Math.PI;
    // −side: a turn about the body's up carries a +X foot back and a −X
    // foot forward by the same angle, so the sign puts both forward on
    // a positive protraction — see the header.
    const walk = -spec.side * protraction(leg) * LEG_SWING * m.moving;
    const rest = Math.sin(stir + half) * IDLE_STIR * (1 - m.moving);
    _turn.setFromAxisAngle(spec.axis, (walk + rest) * ground);
    bone.quaternion.copy(_turn).multiply(spec.rest);
    if (femur !== null) {
      _turn.setFromAxisAngle(spec.liftAxis, gaitLift(leg) * LEG_LIFT * m.moving * ground);
      femur.quaternion.copy(_turn).multiply(spec.femurRest);
    }
  }
}

/**
 * Sway the antennae: a slow wander at rest on two rates that never
 * coincide, so the two feelers are never a mirror of each other, and a
 * tap at the stride rate while walking — feelers that beat the ground
 * ahead — mixed by the moving lever.
 */
export function poseAntennae(antennae: readonly BoundAntenna[], m: RigMotion, phase: number, _bodyLength: number = 1): void {
  const strides = m.strides + phase;
  for (const { bone, spec } of antennae) {
    const rate = spec.side > 0 ? ANTENNA_RATE : ANTENNA_RATE_OTHER;
    const wander = Math.sin((m.alive * rate + phase) * Math.PI * 2 + spec.side) * ANTENNA_SWAY * (1 - m.moving);
    const tap = Math.sin((strides + 0.25 * spec.side) * Math.PI * 2) * ANTENNA_WALK * m.moving;
    _turn.setFromAxisAngle(spec.up, spec.side * (wander + tap));
    bone.quaternion.copy(_turn).multiply(spec.rest);
  }
}

/**
 * Where one jaw's bite cycle stands, given its own clock: its target
 * angle, 0..JAW_OPEN. The first `JAW_OPEN_FRACTION` of the cycle opens
 * on a raised cosine to this bite's own gape; the rest is shut. A clock
 * that has not started (the lagging jaw's, for its lead) is shut.
 */
function biteTarget(clock: number, gape: number): number {
  if (clock < 0) return 0;
  const t = fract(clock / JAW_BITE_S) * JAW_BITE_S;
  const opening = JAW_OPEN_FRACTION * JAW_BITE_S;
  if (t >= opening) return 0;
  return gape * 0.5 * (1 - Math.cos((t / opening) * Math.PI));
}

/**
 * Pose the jaws, each from its own angle, envelope and clock — see the
 * header. Index 0 is the −X jaw, 1 the +X, the order `findMandibles`
 * returns them in; the lag and the gape of each bite come from a hash
 * of the creature's phase and the bite's count, so two bites differ
 * and the same bite replays. The bite is not gated by walking — an
 * attacking ant runs with its jaws open — but the feed strokes and the
 * twitch are.
 */
export function poseJaws(jaws: readonly BoundJaw[], m: RigMotion, phase: number, dt: number): void {
  // Which jaw leads this bite, and by how much of a lead; and each jaw's own gape.
  const lagging = hash01(phase, m.bites) < 0.5 ? 0 : 1;
  const lead = JAW_LEAD_S * (0.5 + 0.5 * hash01(m.bites, phase));
  for (let i = 0; i < jaws.length; i += 1) {
    const jaw = jaws[i];
    const gape = JAW_OPEN * (0.85 + 0.15 * hash01(phase + i, m.bites));
    const clock = m.biteS < 0 ? -1 : m.biteS - (i === lagging ? lead : 0);
    const bite = biteTarget(clock, gape) * m.bite;
    // Feeding: alternate strokes, one jaw on each half of the cycle.
    const f = fract(m.alive / JAW_FEED_S + phase + 0.5 * i);
    const feed = (f < 0.5 ? Math.sin(f * 2 * Math.PI) : 0) * JAW_FEED * m.feed * (1 - m.moving);
    // Idle: a twitch on this jaw's own rate, above zero so it never crosses rest.
    const rate = i === 0 ? JAW_TWITCH_RATE : JAW_TWITCH_RATE_OTHER;
    const twitch = (0.5 + 0.5 * Math.sin((m.alive * rate + phase + 0.37 * i) * Math.PI * 2)) * JAW_TWITCH * (1 - m.moving) * (1 - m.bite);
    const target = clamp(Math.max(bite, feed, twitch), 0, JAW_OPEN);
    // Opening is eased; shutting is a snap.
    jaw.angle = clamp(ease(jaw.angle, target, target > jaw.angle ? JAW_OPEN_TAU : JAW_SNAP_TAU, dt), 0, JAW_OPEN);
    _turn.setFromAxisAngle(jaw.spec.hinge, jaw.spec.side * jaw.angle);
    jaw.bone.quaternion.copy(_turn).multiply(jaw.spec.rest);
  }
}

/**
 * Pose the head: yawed into the turn by the eased heading rate (the
 * head leads, the body follows), dipped by the bite lever, scanning
 * slowly at rest. A positive turn about the body's X dips the nose.
 */
export function poseHead(head: BoundJoint | null, m: RigMotion, phase: number): void {
  if (head === null) return;
  const yaw = clamp(m.turnRate * HEAD_TURN_GAIN, -HEAD_TURN_MAX, HEAD_TURN_MAX)
    + Math.sin((m.alive * HEAD_SCAN_RATE + phase) * Math.PI * 2) * HEAD_SCAN * (1 - m.moving);
  const nod = m.bite * HEAD_BITE_DIP;
  _turn.setFromAxisAngle(head.spec.up, yaw);
  _turn2.setFromAxisAngle(head.spec.x, nod);
  head.bone.quaternion.copy(_turn).multiply(_turn2).multiply(head.spec.rest);
}

/**
 * Pose the gaster: curled under by the bite lever (a negative turn
 * about the body's X pitches the tip down — the sting posture), a slow
 * bob at rest, a small bounce at the stride rate walking.
 */
export function poseGaster(gaster: BoundJoint | null, m: RigMotion, _bodyLength: number, phase: number): void {
  if (gaster === null) return;
  const strides = m.strides + phase;
  const pitch = m.bite * GASTER_BITE_CURL
    + Math.sin((m.alive * GASTER_BOB_RATE + phase) * Math.PI * 2) * GASTER_BOB * (1 - m.moving)
    + Math.sin(strides * Math.PI * 4) * GASTER_STRIDE_BOUNCE * m.moving * (1 - m.air);
  _turn.setFromAxisAngle(gaster.spec.x, pitch);
  gaster.bone.quaternion.copy(_turn).multiply(gaster.spec.rest);
}

/** The walking bob, world units above the ground: highest mid-stride, twice a stride cycle. */
export function walkBob(m: RigMotion, bodyLength: number, phase: number): number {
  const strides = m.strides + phase;
  return Math.abs(Math.sin(strides * Math.PI)) * bodyLength * WALK_BOB * m.moving * (1 - m.air);
}

/** A resting bob for an animal that sits and breathes, world units. `amplitude` is a fraction of the body length. */
export function restBob(m: RigMotion, bodyLength: number, phase: number, amplitude: number, rate: number): number {
  return Math.sin((m.alive * rate + phase) * Math.PI * 2) * bodyLength * amplitude * (1 - m.moving) * (1 - m.air);
}

// ---------------------------------------------------------------------------
// The root's frame: an eased up, a carried heading, a basis (the header)
// ---------------------------------------------------------------------------

/** Scratch for the frame: the turning axis, the carried ahead, the basis' left, the local attitude turns. Never escape. */
const _axis = new THREE.Vector3();
const _left = new THREE.Vector3();
const _aheadV = new THREE.Vector3();
const _upV = new THREE.Vector3();
const _carried: MutableVec3 = { x: 0, y: 0, z: 0 };

/** Two ups within `UP_SETTLED` of each other, by chord. */
function settled(drawn: THREE.Vector3, up: Vec3): boolean {
  const dx = drawn.x - up.x;
  const dy = drawn.y - up.y;
  const dz = drawn.z - up.z;
  return dx * dx + dy * dy + dz * dz < UP_SETTLED * UP_SETTLED;
}

/**
 * Turn the drawn up toward the state's up by the fraction of the angle
 * between them an exponential ease of `UP_EASE_S` takes in `dt`, about
 * their common perpendicular — or, when they are opposite, about the
 * axis `rotateBetween` fixes for that case (the header says why not a
 * lerp). Within `UP_SETTLED` of the target it is SET to it, so on the
 * ground, where the two never differ, the drawn up is `WORLD_UP` to the
 * bit every frame. A target or a dt that is not a number moves nothing.
 */
export function easeUp(drawn: THREE.Vector3, up: Vec3, dt: number): void {
  if (!Number.isFinite(up.x) || !Number.isFinite(up.y) || !Number.isFinite(up.z)) return;
  if (settled(drawn, up)) {
    drawn.set(up.x, up.y, up.z);
    return;
  }
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const k = 1 - Math.exp(-dt / UP_EASE_S);
  const c = drawn.x * up.x + drawn.y * up.y + drawn.z * up.z;
  _axis.set(drawn.y * up.z - drawn.z * up.y, drawn.z * up.x - drawn.x * up.z, drawn.x * up.y - drawn.y * up.x);
  const s = _axis.length();
  let angle: number;
  if (s < 1e-9) {
    // Opposite (not settled, so not the same): a half turn, about the
    // axis the surface frame fixes — +x projected off the drawn up, or
    // +z when the drawn up is nearly ±x — so every reader rolls the same way.
    if (Math.abs(drawn.x) < 0.9) _axis.set(1 - drawn.x * drawn.x, -drawn.x * drawn.y, -drawn.x * drawn.z);
    else _axis.set(-drawn.z * drawn.x, -drawn.z * drawn.y, 1 - drawn.z * drawn.z);
    angle = Math.PI;
  } else {
    angle = Math.atan2(s, c);
  }
  _axis.normalize();
  drawn.applyAxisAngle(_axis, angle * k).normalize();
  if (settled(drawn, up)) drawn.set(up.x, up.y, up.z);
}

/**
 * THE AHEAD THE ROOT IS BUILT ON: `aheadOn(up, heading)` carried from
 * the state's up onto the drawn one by the one rotation between them,
 * into `out`. When the two are the same object or the same numbers the
 * carry is skipped and the answer is `aheadOn`'s exactly — on the
 * ground, `(sin h, 0, cos h)` to the bit.
 */
export function drawnAhead(up: Vec3, heading: number, drawnUp: Vec3, out: MutableVec3): MutableVec3 {
  aheadOn(up, heading, out);
  if (drawnUp === up || (drawnUp.x === up.x && drawnUp.y === up.y && drawnUp.z === up.z)) return out;
  _carried.x = out.x;
  _carried.y = out.y;
  _carried.z = out.z;
  return rotateBetween(up, drawnUp, _carried, out);
}

/**
 * THE ROOT QUATERNION from a unit up and a unit ahead tangent to it —
 * local +Z the ahead, +Y the up, +X = up × ahead (the animal's left) —
 * then the flight attitude as LOCAL turns: nose up a negative turn
 * about the body's X, then the bank about the body's Z. For
 * `up = WORLD_UP` and `ahead = (sin h, 0, cos h)` this is the old
 * `Euler(−pitch, heading, bank, 'YXZ')` to 1e-12 (the header); an
 * ahead or an up that is not a number leaves `out` as it was.
 */
export function rootQuaternion(up: Vec3, ahead: Vec3, pitch: number, bank: number, out: THREE.Quaternion): THREE.Quaternion {
  if (!Number.isFinite(up.x + up.y + up.z + ahead.x + ahead.y + ahead.z + pitch + bank)) return out;
  _upV.set(up.x, up.y, up.z);
  _aheadV.set(ahead.x, ahead.y, ahead.z);
  _left.crossVectors(_upV, _aheadV);
  _m.makeBasis(_left, _upV, _aheadV);
  out.setFromRotationMatrix(_m);
  if (pitch !== 0) out.multiply(_turn.setFromAxisAngle(X_AXIS, -pitch));
  if (bank !== 0) out.multiply(_turn.setFromAxisAngle(FORWARD, bank));
  return out;
}

/**
 * A point `dist` along a path from its head, walking from `cursor`
 * (a segment index the caller advances as `dist` grows, so the whole
 * chain is one pass over the path). Past the end the tail stops at the
 * last point rather than being invented.
 */
function walkPath(path: Float64Array, points: number, dist: number, cursor: { i: number; left: number }, into: THREE.Vector3): void {
  while (cursor.i + 1 < points) {
    const a = cursor.i * 3;
    const b = a + 3;
    const seg = Math.hypot(path[b] - path[a], path[b + 1] - path[a + 1], path[b + 2] - path[a + 2]);
    if (seg <= 1e-9) { cursor.i += 1; continue; }
    if (dist - cursor.left <= seg) {
      const t = (dist - cursor.left) / seg;
      into.set(path[a] + (path[b] - path[a]) * t, path[a + 1] + (path[b + 1] - path[a + 1]) * t, path[a + 2] + (path[b + 2] - path[a + 2]) * t);
      return;
    }
    cursor.left += seg;
    cursor.i += 1;
  }
  const last = (points - 1) * 3;
  into.set(path[last], path[last + 1], path[last + 2]);
}

/** Where a chain's bones were seated last, so a test can read the solve without walking matrices. Scratch, reused. */
const _cursor = { i: 0, left: 0 };
const _walk = { i: 0, left: 0 };

/**
 * The point `dist` along a path from its head, into `into` — the view's
 * way of asking where a body's middle is on the trail it has laid.
 * Same arithmetic as the chain's seating, its own cursor.
 */
export function pointAlongPath(path: Float64Array, points: number, dist: number, into: THREE.Vector3): THREE.Vector3 {
  _walk.i = 0;
  _walk.left = 0;
  walkPath(path, points, Math.max(0, dist), _walk, into);
  return into;
}

/**
 * HOW FAR EACH BONE SITS BEHIND THE HEAD, ALONG THE BODY, in rig units:
 * `reach[i]` is the running total of the rest lengths in front of bone
 * i, and `reach[0]` is zero because the head is on `path[0]`.
 *
 * Built once per chain and kept for as long as the spec is, TCS's
 * reason unchanged: a skeleton's bone lengths do not change, only its
 * angles do, so re-summing sixteen of them for every worm on every
 * frame is arithmetic nobody reads twice. Kept on the side in a
 * `WeakMap` rather than added to `ChainSpec`: the spec is `rig.ts`'s
 * description of what a rig IS, and this is this module's own working.
 * Rig units, not world — `layChain` scales at the point of use, so two
 * slots sharing a spec at different scales cannot read each other's.
 */
const REACH = new WeakMap<ChainSpec, Float64Array>();

function reachOf(spec: ChainSpec): Float64Array {
  let reach = REACH.get(spec);
  if (reach === undefined) {
    reach = new Float64Array(spec.lengths.length + 1);
    for (let i = 0; i < spec.lengths.length; i += 1) reach[i + 1] = reach[i] + spec.lengths[i];
    REACH.set(spec, reach);
  }
  return reach;
}

/**
 * Lay a chain along a path (render space, newest point first, `points`
 * triples in `path`). The rig root is placed so the head bone lands on
 * `path[0]`; every bone after it is seated at its own REST distance
 * behind the head — `reachOf`, scaled — and aimed at the station after
 * it, which is the snake rule in one line. Past the end of the path the
 * remaining stations fall on its last point, so a worm with a short
 * memory gathers at the oldest crumb rather than being extrapolated
 * into ground it never crawled.
 *
 * Nothing here writes a bone's OFFSET. The rest pose already is the
 * length the spec measured, so leaving the offsets alone is what makes
 * "the stations are the rest lengths" structural rather than a promise:
 * there is no longer a line in this function that could change how long
 * a segment is drawn.
 *
 * `rootScale` is the rig root's uniform scale, `headOffset` the head
 * bone's rest position in the root's frame and `headFrame` the head
 * bone's parent orientation in that frame (both measured once per
 * clone). The motion state, the body length and the creature's phase
 * are handed in and deliberately NOT read: they are what every other
 * poser here runs on, and a chain that consulted a clock could not
 * follow the path exactly. They stay in the signature so the view poses
 * every rig through one shape.
 */
export function layChain(
  root: THREE.Object3D,
  bones: readonly THREE.Bone[],
  spec: ChainSpec,
  rootScale: number,
  headOffset: THREE.Vector3,
  headFrame: THREE.Quaternion,
  path: Float64Array,
  points: number,
  _motion: RigMotion,
  _bodyLength: number,
  _phase: number,
): void {
  const n = bones.length;
  if (n < 2 || points < 1) return;
  const reach = reachOf(spec);
  _cursor.i = 0;
  _cursor.left = 0;
  walkPath(path, points, 0, _cursor, _at);
  // The root carries the head to path[0]: identity rotation, the head's
  // rest offset subtracted (scaled), so the OBJECT sits wherever it must
  // for the BONE to be on the path.
  root.quaternion.identity();
  root.position.copy(_at).addScaledVector(headOffset, -rootScale);
  // The accumulated world rotation of the frame each bone's quaternion is applied in.
  _q.copy(headFrame);
  for (let i = 0; i + 1 < n; i += 1) {
    // The station bone i+1 holds: its rest total behind the head, by arc
    // length. `_cursor` walks forward with it, so the whole chain is one
    // pass over the path.
    walkPath(path, points, reach[i + 1] * rootScale, _cursor, _next);
    const bone = bones[i];
    _want.copy(_next).sub(_at);
    if (_want.lengthSq() < 1e-12) {
      // A station on top of the last one: keep the parent's direction.
      bone.quaternion.identity();
    } else {
      _want.normalize();
      if (i === 0) {
        // THE HEAD'S FULL FRAME: forward along the path, belly down —
        // never the shortest arc, which would roll the skin as it turns.
        _x.crossVectors(UP, _want);
        if (_x.lengthSq() < 1e-6) _x.crossVectors(FORWARD, _want);
        _x.normalize();
        _z.crossVectors(_x, _want);
        _m.makeBasis(_x, _want, _z);
        _turn.setFromRotationMatrix(_m);
        // The basis maps local +Y to forward; the rest offset may not be +Y.
        _turn2.setFromUnitVectors(spec.dirs[0], UP);
        _turn.multiply(_turn2);
        // Into the parent's frame.
        bone.quaternion.copy(_q).invert().multiply(_turn);
      } else {
        // Shortest arc from the rest direction, in the parent's frame.
        _have.copy(spec.dirs[i]);
        _want.applyQuaternion(_turn.copy(_q).invert());
        bone.quaternion.setFromUnitVectors(_have, _want);
      }
    }
    _q.multiply(bone.quaternion);
    _at.copy(_next);
  }
  // The tip continues its parent's direction.
  bones[n - 1].quaternion.identity();
}
