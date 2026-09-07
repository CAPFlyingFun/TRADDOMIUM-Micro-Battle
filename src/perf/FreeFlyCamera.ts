/**
 * A free-fly camera for the benchmark world, driven from the raw input
 * snapshot and, on a phone, from the move stick's reading. Imports three
 * and the input TYPES only.
 *
 * Keys: W/S or ↑/↓ forward and back along the view, A/D or ←/→ strafe,
 * E or Space up, Q or C down, Shift doubles the speed. Mouse: drag looks,
 * wheel changes the speed.
 *
 * Touch: a drag LOOKS, whichever half of the screen it starts on. Moving
 * by thumb is the fixed, visible stick at the bottom-left
 * (`input/MoveStick.ts`), whose reading the owner passes to `update` each
 * frame: the push's direction is taken camera-relative, exactly as W and
 * D are, and how far it is pushed sets the speed between `STICK_MIN_SPEED`
 * and this camera's own `speed` (the curve is on `stickSpeed`). The
 * stick's ring lives in the UI layer, a sibling of the canvas the input
 * listens on, and swallows its own pointer events besides, so no drag
 * that reaches this camera through the snapshot is ever a move.
 *
 * That replaced the twin-zone scheme (an INVISIBLE stick anchored
 * wherever a finger landed on the left half, a look on the right) on
 * 2026-09-07. Joshua, from his phone: "allow the max if moving the
 * invisible joystick at 30 m/s, but allow it to be able to adjust speed
 * from 1-30 depending on how much you push the stick forward and it
 * should draw on the screen while moving, but also would like it fixed
 * and visible. You can copy the one from v0." Lift (Q/E/C/Space) stays
 * keyboard-only.
 *
 * The brief listed Shift as both "down" and "boost"; boost won, because Q
 * and C already cover descent and holding a boost while crossing a world
 * is what a benchmark camera spends most of its time doing.
 *
 * This is deliberately not a Scene and knows nothing about pausing: it is
 * a measuring instrument, moved by wall-clock dt by its owner, and it has
 * to keep working while the simulation is frozen.
 */
import * as THREE from 'three';
import { wrapHeading } from '../actor/Transform';
import type { InputSnapshot } from '../input/Input';
import type { StickReading } from '../input/MoveStick';
import type { CameraPose } from '../session/GameSession';
import { local } from '../world/coords';
import { toLocal, toWorld } from '../world/origin';

/** World units per second. A Phase 0 number for a grid 2000 units across; true-scale terrain will want more. */
export const DEFAULT_SPEED = 40;
const MIN_SPEED = 0.5;
const MAX_SPEED = 20000;
const BOOST = 2;

/** Radians of turn per pixel of drag: about a quarter turn across a phone's width. */
const LOOK_RADIANS_PER_PIXEL = 0.0035;
/** One wheel notch (about 100 px of deltaY) scales the speed by this factor. */
const WHEEL_SPEED_STEP = 1.25;
/**
 * The slowest a live stick push flies, in world units per second: 1 m/s.
 * GAME TUNING, from Joshua's "adjust speed from 1-30" — the slow end a
 * thumb can hold for lining up a shot, not a measured anything.
 */
export const STICK_MIN_SPEED = 100;
/** Straight up is excluded: at exactly ±90° pitch, yaw and roll become the same axis. */
const MAX_PITCH = Math.PI / 2 - 0.01;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * THE CAMERA'S YAW IS NOT AN ACTOR'S HEADING, and the difference is half
 * a turn.
 *
 * `applyRotation` sets `camera.rotation.set(pitch, yaw, 0)`, and a three
 * camera looks down its own −Z, so the direction this one faces is
 * (−sin yaw, −cos yaw) in (x, z). An actor's heading means the opposite
 * convention — ahead is (sin h, cos h) (`actor/Transform.ts`) — so a yaw
 * used as a heading points a capsule exactly backwards.
 *
 * One conversion, here, so nothing else has to remember which of the two
 * it is holding. It is used twice: the pose this camera CLAIMS as a
 * capsule, and the facing the perf HUD prints.
 */
export function headingOfYaw(yaw: number): number {
  return wrapHeading(yaw + Math.PI);
}

/**
 * The yaw that makes this camera LOOK along an actor heading. The same
 * half turn, which makes it its own inverse — two names because the two
 * call sites mean opposite things and a reader should not have to work
 * out which.
 */
export function yawForHeading(heading: number): number {
  return wrapHeading(heading + Math.PI);
}

export interface CameraReadout {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Which way it is LOOKING, as an actor heading in radians — not the
   * yaw. A benchmark camera that says where it is but not which way it
   * points cannot be checked against anything in the world it is looking
   * at, which is how a bot that was correctly placed and off the edge of
   * the screen got as far as a screenshot (`scripts/probe-bot.mjs`).
   */
  readonly facing: number;
  /**
   * How far it is tilted, in radians, up positive.
   *
   * Here for the same reason `facing` is, and learned the same way: a
   * shot Joshua sends can only be recreated from the HUD if the HUD
   * prints the whole pose. `npm run probe:shot` had to be given a
   * GUESSED pitch, so the recreated frame looked at roughly what his did
   * — which is fine for a washboard covering the screen and useless for
   * anything at the edge of one.
   */
  readonly pitch: number;
  /** World units per second, before any boost. */
  readonly speed: number;
}

/**
 * How fast a stick push flies, in world units per second, from how far it
 * is pushed (0..1) and the camera's own speed — the ceiling a full push
 * reaches.
 *
 * GAME TUNING: `STICK_MIN_SPEED + (top − STICK_MIN_SPEED) · deflection²`,
 * capped at `top`. The square gives the slow end room: at the perf
 * world's 30 m/s a half push is about 8 m/s and a quarter push under 3,
 * where a linear curve would spend the whole bottom half of the stick's
 * travel above 15. The cap is for a camera slower than the floor (the
 * empty world's 0.4 m/s, or a wheel spun down), where the floor would
 * otherwise be a speed-up: there, every push is the camera's own speed.
 */
export function stickSpeed(deflection: number, top: number): number {
  const d = Math.min(1, Math.max(0, deflection));
  return Math.min(top, STICK_MIN_SPEED + (top - STICK_MIN_SPEED) * d * d);
}

/**
 * How a drag turns the view. `sensitivity` scales the turn rate (1 is the
 * tuned feel); `invertY` flips the vertical axis relative to THIS camera's
 * own default, which is first-person: dragging down looks down. Which
 * direction counts as "normal" is a property of a camera, not of the
 * setting, so a follow camera may read the same flag the other way round.
 */
export interface LookTuning {
  readonly sensitivity: number;
  readonly invertY: boolean;
}

export class FreeFlyCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private pitch = 0;
  private speedValue = DEFAULT_SPEED;
  private look: LookTuning = { sensitivity: 1, invertY: false };
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();

  constructor(fov = 60, near = 0.1, far = 5000) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, near, far);
    // Yaw about world Y, then pitch about the camera's X: no roll can creep in.
    this.camera.rotation.order = 'YXZ';
    this.applyRotation();
  }

  get speed(): number {
    return this.speedValue;
  }

  /** World units per second, clamped to a sane range; a non-finite value is ignored. */
  set speed(value: number) {
    if (!Number.isFinite(value)) return;
    this.speedValue = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
  }

  readout(): CameraReadout {
    const p = this.camera.position;
    return { x: p.x, y: p.y, z: p.z, facing: headingOfYaw(this.yaw), pitch: this.pitch, speed: this.speedValue };
  }

  /** A non-finite or non-positive sensitivity is ignored; the flag is always taken. */
  setLook(tuning: LookTuning): void {
    const sane = Number.isFinite(tuning.sensitivity) && tuning.sensitivity > 0;
    this.look = { sensitivity: sane ? tuning.sensitivity : this.look.sensitivity, invertY: tuning.invertY };
  }

  /** Vertical field of view in degrees. Out-of-range values are ignored; an unchanged value costs nothing. */
  setFov(degrees: number): void {
    if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) return;
    if (this.camera.fov === degrees) return;
    this.camera.fov = degrees;
    this.camera.updateProjectionMatrix();
  }

  /** Put the camera somewhere, looking along a yaw (radians about +Y) and pitch (radians, up positive). */
  place(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
    this.applyRotation();
  }

  /**
   * Where the camera is, as a save wants it: a WorldPoint and a height,
   * because a saved pose outlives the frame (coords.ts, THE RULE). The
   * rendered position is measured from the floating origin, so the
   * conversion back to world happens here, at the render boundary, and
   * nowhere else — a save written from `camera.position` would be a
   * LocalPoint in disguise and mean somewhere else after the next rebase.
   */
  pose(): CameraPose {
    const p = this.camera.position;
    return { at: toWorld(local(p.x, p.z)), height: p.y, yaw: this.yaw, pitch: this.pitch };
  }

  /**
   * Put the camera back at a saved pose. A pose with a non-finite number
   * in it is ignored outright: the store sanitizes on the way in, and
   * this is the last line before a NaN reaches the projection matrix.
   */
  restore(pose: CameraPose): void {
    const numbers = [pose.at.wx, pose.at.wz, pose.height, pose.yaw, pose.pitch];
    if (!numbers.every((n) => Number.isFinite(n))) return;
    const at = toLocal(pose.at);
    this.place(at.lx, pose.height, at.lz, pose.yaw, pose.pitch);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Read one frame of input and move. `dt` is whatever clock the owner
   * chooses — the perf world passes wall-clock, so the camera still flies
   * while the world is paused. `stick` is the move stick's reading for
   * the frame, or null where there is no stick (a test, a desktop rig).
   *
   * Keys and the stick ADD AS VECTORS, and the planar sum — along the
   * view and across it — is clamped so it never exceeds `speed × boost`:
   * a full push with W held is still one top speed, and a push against S
   * subtracts. The stick alone never boosts; Shift is a key. Lift is
   * added on top, as it always was.
   */
  update(input: InputSnapshot, dt: number, stick: StickReading | null = null): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

    let lookDx = 0;
    let lookDy = 0;
    if (input.pointer.down) {
      lookDx += input.pointer.dx;
      lookDy += input.pointer.dy;
    }
    for (const t of input.touches) {
      lookDx += t.dx;
      lookDy += t.dy;
    }

    const turn = LOOK_RADIANS_PER_PIXEL * this.look.sensitivity;
    const pitchSign = this.look.invertY ? -1 : 1;
    this.yaw -= lookDx * turn;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch - lookDy * turn * pitchSign));
    this.applyRotation();

    if (input.wheel !== 0) {
      // Scrolling down (positive deltaY) slows; exponential so every notch feels the same.
      this.speed = this.speedValue * WHEEL_SPEED_STEP ** (-input.wheel / 100);
    }

    const keys = input.keys;
    const held = (...codes: string[]): boolean => codes.some((c) => keys.has(c));
    const axis = (negative: boolean, positive: boolean): number => (positive ? 1 : 0) - (negative ? 1 : 0);
    const ahead = axis(held('KeyS', 'ArrowDown'), held('KeyW', 'ArrowUp'));
    const side = axis(held('KeyA', 'ArrowLeft'), held('KeyD', 'ArrowRight'));
    const lift = axis(held('KeyQ', 'KeyC'), held('KeyE', 'Space'));

    // A push is live when it is pushed at all and points somewhere: a
    // reading's (x, y) is its direction, its deflection how far.
    const push = stick !== null && Number.isFinite(stick.deflection) && stick.deflection > 0
      ? Math.hypot(stick.x, stick.y)
      : 0;
    const pushing = Number.isFinite(push) && push > 0;
    if (ahead === 0 && side === 0 && lift === 0 && !pushing) return;

    const boost = held('ShiftLeft', 'ShiftRight') ? BOOST : 1;
    const full = this.speedValue * boost;
    this.camera.getWorldDirection(this.forward);
    // Pitch never reaches vertical, so forward × up is never degenerate.
    this.right.crossVectors(this.forward, WORLD_UP).normalize();
    this.move.set(0, 0, 0).addScaledVector(this.forward, ahead).addScaledVector(this.right, side);
    // Two keys held diagonally would otherwise fly √2 faster than one.
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.move.multiplyScalar(full);
    if (pushing && stick !== null) {
      const pace = stickSpeed(stick.deflection, this.speedValue) / push;
      this.move.addScaledVector(this.forward, stick.y * pace).addScaledVector(this.right, stick.x * pace);
      // Keys and stick together are still one camera at one top speed.
      if (this.move.lengthSq() > full * full) this.move.setLength(full);
    }
    this.move.y += lift * full;
    this.camera.position.addScaledVector(this.move, step);
  }

  private applyRotation(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
