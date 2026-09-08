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
 * Six coxae turn about the body's vertical, three a half-cycle behind
 * the other three, by how far the animal has WALKED — not by time, so a
 * creature that slows does not moonwalk. Standing, the legs stir on a
 * slow clock so the animal reads as alive rather than as a model. The
 * numbers are TCS's, measured there in the creature's own frame at
 * 0.22 rad (a fifth of a body length a stride on the aphid, two fifths
 * on the fly, which reads as walking; 0.42 flailed).
 *
 * ─── wings: a blur, honestly ────────────────────────────────────────
 *
 * A housefly beats its wings at roughly 200 Hz (BIOLOGICAL SHAPE: the
 * commonly reported range for Musca domestica is 150–250 Hz). At sixty
 * frames a second that aliases, and the brief accepts it: it reads as
 * the blur a real fly's wings are. The wings spread from their folded
 * rest as the air lever rises and beat only while it is up, so a
 * landed fly folds them again without anything being told to.
 *
 * Reads no world coordinate: paths arrive in render space, and every
 * rotation is a bone's local quaternion.
 */
import * as THREE from 'three';
import type { AntennaSpec, ChainSpec, LegSpec, WingSpec } from './rig';

/** How far a leg swings, radians. GAME TUNING (TCS, measured in the creature's frame). */
export const LEG_SWING = 0.22;
/** Full strides per body length travelled. GAME TUNING (TCS). */
export const STRIDES_PER_LENGTH = 1.8;
/** The standing stir: how far the legs move, and how fast (cycles a second). GAME TUNING (TCS). */
export const IDLE_STIR = 0.02;
export const IDLE_RATE = 0.55;
/** The walking bob, as a fraction of the body length. GAME TUNING (TCS's 0.06 of height). */
export const WALK_BOB = 0.03;

/** The wingbeat, cycles a second. BIOLOGICAL SHAPE — see the header; aliasing accepted. */
export const WINGBEAT_HZ = 200;
/** Flap amplitude about the hinge, radians. GAME TUNING (the brief's ~0.6). */
export const WING_FLAP = 0.6;
/** How far the wings are yawed out from folded-back to held-out in flight, radians. GAME TUNING. */
export const WING_SPREAD = 1.15;
/** Seconds for the air lever to rise or fall: wings spread and fold over this. GAME TUNING. */
export const AIR_EASE_S = 0.12;

/** The antennae's sway at rest: radians and cycles a second. GAME TUNING. */
export const ANTENNA_SWAY = 0.15;
export const ANTENNA_RATE = 0.7;

/** Body attitude in flight: pitch per unit of climb-over-speed, bank per radian a second of turn, and the limits. GAME TUNING. */
export const PITCH_GAIN = 0.8;
export const PITCH_MAX = 0.6;
export const BANK_PER_RAD_S = 0.15;
export const BANK_MAX = 0.8;
/** Seconds the attitude takes to follow its target — a smoothing, so a sim step does not snap the body. GAME TUNING. */
export const ATTITUDE_EASE_S = 0.15;
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
 * deltas the view measures; never written by the simulation.
 */
export interface RigMotion {
  /** World units travelled while lent — what drives the gait. */
  gone: number;
  /** Seconds lent — what drives the idle clocks and the wingbeat. */
  alive: number;
  /** 0..1 levers, eased: moving, and in the air. */
  moving: number;
  air: number;
  /** Radians, eased: nose up positive; bank positive rolls the −X side down. */
  pitch: number;
  bank: number;
}

export function newMotion(): RigMotion {
  return { gone: 0, alive: 0, moving: 0, air: 0, pitch: 0, bank: 0 };
}

/** One frame's measured facts about the creature a rig is drawing. */
export interface MotionSignals {
  /** Seconds this frame. */
  readonly dt: number;
  /** World units moved on the plane this frame, and in height. */
  readonly moved: number;
  readonly climbed: number;
  /** Radians the heading changed this frame, wrapped. */
  readonly turned: number;
  /** In the air (from the state's airborne set — a boolean, not a mode). */
  readonly airborne: boolean;
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
  const movingNow = speed > MOVING_AT * s.bodyLength ? 1 : 0;
  m.moving = ease(m.moving, movingNow, MOVING_EASE_S, dt);
  m.air = ease(m.air, s.airborne ? 1 : 0, AIR_EASE_S, dt);
  // Attitude follows the measured climb and turn, and only counts in the air.
  const climbRate = dt > 0 ? s.climbed / dt : 0;
  const turnRate = dt > 0 ? s.turned / dt : 0;
  const pitchTarget = clamp(Math.atan2(climbRate, Math.max(speed, 1e-6)) * PITCH_GAIN, -PITCH_MAX, PITCH_MAX) * m.air;
  // A heading grows anticlockwise (a left turn, facing +Z); banking into
  // it drops the +X side, which is a negative roll about the body's +Z.
  const bankTarget = clamp(-turnRate * BANK_PER_RAD_S, -BANK_MAX, BANK_MAX) * m.air;
  m.pitch = ease(m.pitch, pitchTarget, ATTITUDE_EASE_S, dt);
  m.bank = ease(m.bank, bankTarget, ATTITUDE_EASE_S, dt);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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

/** A bone with the spec it was found by, resolved on one clone. */
export interface BoundLeg { readonly bone: THREE.Bone; readonly spec: LegSpec }
export interface BoundWing { readonly bone: THREE.Bone; readonly spec: WingSpec }
export interface BoundAntenna { readonly bone: THREE.Bone; readonly spec: AntennaSpec }

/**
 * Pose the legs: the tripod when walking, the stir when standing,
 * tucked toward rest in the air. Every frame from the REST quaternion,
 * premultiplied by a turn about the body's vertical in the parent's
 * frame — composing onto last frame's answer winds a leg up in seconds.
 */
export function poseLegs(legs: readonly BoundLeg[], m: RigMotion, bodyLength: number, phase: number): void {
  const strides = (m.gone / Math.max(1e-6, bodyLength)) * STRIDES_PER_LENGTH + phase;
  const walk = strides * Math.PI * 2;
  const stir = (m.alive * IDLE_RATE + phase) * Math.PI * 2;
  const ground = 1 - m.air;
  for (const { bone, spec } of legs) {
    const half = spec.phase * Math.PI;
    const angle = (Math.sin(walk + half) * LEG_SWING * m.moving + Math.sin(stir + half) * IDLE_STIR * (1 - m.moving)) * ground;
    _turn.setFromAxisAngle(spec.axis, angle);
    bone.quaternion.copy(_turn).multiply(spec.rest);
  }
}

/**
 * Pose the wings: spread out by the air lever, beating while it is up.
 * The spread is a yaw about the body's up (from folded back along the
 * abdomen to held out to the side); the flap is a roll about the
 * body's forward axis, mirrored per side so both wings rise together.
 */
export function poseWings(wings: readonly BoundWing[], m: RigMotion, phase: number): void {
  const beat = Math.sin((m.alive * WINGBEAT_HZ + phase) * Math.PI * 2) * WING_FLAP * m.air;
  const spread = WING_SPREAD * m.air;
  for (const { bone, spec } of wings) {
    _turn.setFromAxisAngle(spec.up, -spec.side * spread);
    _turn2.setFromAxisAngle(spec.forward, spec.side * beat);
    bone.quaternion.copy(_turn2).multiply(_turn).multiply(spec.rest);
  }
}

/** Sway the antennae side to side on a slow clock, mostly while standing. */
export function poseAntennae(antennae: readonly BoundAntenna[], m: RigMotion, phase: number): void {
  const t = (m.alive * ANTENNA_RATE + phase) * Math.PI * 2;
  const amount = ANTENNA_SWAY * (1 - 0.5 * m.moving);
  for (const { bone, spec } of antennae) {
    _turn.setFromAxisAngle(spec.up, spec.side * Math.sin(t + spec.side) * amount);
    bone.quaternion.copy(_turn).multiply(spec.rest);
  }
}

/** The walking bob, world units above the ground: highest mid-stride, twice a stride cycle. */
export function walkBob(m: RigMotion, bodyLength: number, phase: number): number {
  const strides = (m.gone / Math.max(1e-6, bodyLength)) * STRIDES_PER_LENGTH + phase;
  return Math.abs(Math.sin(strides * Math.PI)) * bodyLength * WALK_BOB * m.moving * (1 - m.air);
}

/** A resting bob for an animal that sits and breathes, world units. `amplitude` is a fraction of the body length. */
export function restBob(m: RigMotion, bodyLength: number, phase: number, amplitude: number, rate: number): number {
  return Math.sin((m.alive * rate + phase) * Math.PI * 2) * bodyLength * amplitude * (1 - m.moving) * (1 - m.air);
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
