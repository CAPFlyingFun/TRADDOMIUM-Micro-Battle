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
 * and seats each bone its own length behind the last, by arc length,
 * the way TCS's `WormBody` does and for the reason it gives: a rigid
 * body along its heading would have most of a 150 mm animal outside
 * the hole it dug. Two things are done differently here. The ROOT bone
 * is given a full frame — forward along the path, belly down — rather
 * than the shortest arc from its rest direction, so the skin does not
 * roll about the body as the animal turns; the bones below it are
 * still shortest-arc in their parent's frame, where the bends are
 * small and roll-free. And PERISTALSIS is a wave of segment LENGTHS:
 * each child's rest offset is scaled along its own axis, so the wave
 * passes tail-ward as the worm advances (retrograde — Quillin 1999,
 * J. Exp. Biol.: the contraction wave travels backward relative to the
 * body while the body goes forward; the amplitude and wavelength are
 * GAME TUNING). Lengths, not bone scales: a non-uniform scale on a
 * rotated hierarchy shears the children, and a chain of sixteen
 * compounding scales drifts.
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

/**
 * Peristalsis: segment stretch amplitude, wavelengths along the body,
 * waves passed per body length travelled. GAME TUNING. A WHOLE number
 * of wavelengths, on purpose: the sixteen segment factors then sum to
 * exactly one, so the body's length is conserved whatever the wave's
 * phase — a fractional count would breathe the whole animal longer and
 * shorter as it crawled.
 */
export const PERISTALSIS_AMPLITUDE = 0.12;
export const PERISTALSIS_WAVES = 2;
export const PERISTALSIS_PER_LENGTH = 2;
/** A resting worm's faint pulse, as a fraction of the walking amplitude, and its rate. GAME TUNING. */
export const PERISTALSIS_IDLE = 0.25;
export const PERISTALSIS_IDLE_RATE = 0.4;

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
  /** World units travelled while lent — what drives the gait and the peristalsis. */
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
 * Lay a chain along a path (render space, newest point first, `points`
 * triples in `path`). The rig root is placed so the head bone lands on
 * `path[0]`; each bone is aimed at the next station and each child's
 * offset is stretched by the peristaltic wave. `rootScale` is the rig
 * root's uniform scale, `headOffset` the head bone's rest position in
 * the root's frame and `headFrame` the head bone's parent orientation in
 * that frame (both measured once per clone).
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
  m: RigMotion,
  bodyLength: number,
  phase: number,
): void {
  const n = bones.length;
  if (n < 2 || points < 1) return;
  // THE WAVE: a length factor per segment, travelling tail-ward with
  // distance while moving and pulsing faintly on a clock while still.
  const travel = (m.gone / Math.max(1e-6, bodyLength)) * PERISTALSIS_PER_LENGTH;
  const idle = m.alive * PERISTALSIS_IDLE_RATE;
  const amplitude = PERISTALSIS_AMPLITUDE * (m.moving + PERISTALSIS_IDLE * (1 - m.moving));
  // Stations by arc length, stretched segment by segment.
  _cursor.i = 0;
  _cursor.left = 0;
  let station = 0;
  walkPath(path, points, 0, _cursor, _at);
  // The root carries the head to path[0]: identity rotation, the head's
  // rest offset subtracted (scaled), so the OBJECT sits wherever it must
  // for the BONE to be on the path.
  root.quaternion.identity();
  root.position.copy(_at).addScaledVector(headOffset, -rootScale);
  // The accumulated world rotation of the frame each bone's quaternion is applied in.
  _q.copy(headFrame);
  for (let i = 0; i + 1 < n; i += 1) {
    const along = (i / Math.max(1, n - 1)) * PERISTALSIS_WAVES;
    // `along − travel`: the crest sits at a larger index as travel grows,
    // so the wave runs head-to-tail while the body goes forward.
    const factor = 1 + amplitude * Math.sin((along - travel - idle + phase) * Math.PI * 2);
    const length = spec.lengths[i] * factor;
    station += length * rootScale;
    walkPath(path, points, station, _cursor, _next);
    const bone = bones[i];
    const child = bones[i + 1];
    // The child's offset, stretched along its own rest direction.
    child.position.copy(spec.dirs[i]).multiplyScalar(length);
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
