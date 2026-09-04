/**
 * A free-fly camera for the benchmark world, driven from the raw input
 * snapshot. Imports three and the Input types only.
 *
 * Keys: W/S or ↑/↓ forward and back along the view, A/D or ←/→ strafe,
 * E or Space up, Q or C down, Shift doubles the speed. Mouse: drag looks,
 * wheel changes the speed. Touch is twin-zone: a drag that STARTS on the
 * left half of the screen is a virtual stick that moves (up = forward,
 * sideways = strafe); one that starts on the right half looks. The zone is
 * decided where the finger lands, so a stick can be pulled across the
 * middle without turning into a look.
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
/** Touch offset for full deflection of the move stick. */
const STICK_RADIUS_PX = 80;
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
  /** World units per second, before any boost. */
  readonly speed: number;
}

interface TouchStart {
  readonly x: number;
  readonly y: number;
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
  private viewportWidth = 1;
  /** Where each live touch began: decides its zone and anchors the move stick. */
  private readonly touchStarts = new Map<number, TouchStart>();
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
    return { x: p.x, y: p.y, z: p.z, facing: headingOfYaw(this.yaw), speed: this.speedValue };
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
    this.viewportWidth = Math.max(1, width);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Read one frame of input and move. `dt` is whatever clock the owner
   * chooses — the perf world passes wall-clock, so the camera still flies
   * while the world is paused.
   */
  update(input: InputSnapshot, dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

    let lookDx = 0;
    let lookDy = 0;
    if (input.pointer.down) {
      lookDx += input.pointer.dx;
      lookDy += input.pointer.dy;
    }

    let stickX = 0;
    let stickY = 0;
    const live = new Set<number>();
    for (const t of input.touches) {
      live.add(t.id);
      let start = this.touchStarts.get(t.id);
      if (!start) {
        // First sight of this touch: it may already carry this frame's
        // movement, so the landing point is the current point minus it.
        start = { x: t.x - t.dx, y: t.y - t.dy };
        this.touchStarts.set(t.id, start);
      }
      if (start.x < this.viewportWidth / 2) {
        stickX += (t.x - start.x) / STICK_RADIUS_PX;
        stickY += (t.y - start.y) / STICK_RADIUS_PX;
      } else {
        lookDx += t.dx;
        lookDy += t.dy;
      }
    }
    for (const id of this.touchStarts.keys()) {
      if (!live.has(id)) this.touchStarts.delete(id);
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
    // Screen y grows downward, so a stick pulled UP is forward.
    const ahead = clampUnit(axis(held('KeyS', 'ArrowDown'), held('KeyW', 'ArrowUp')) - stickY);
    const side = clampUnit(axis(held('KeyA', 'ArrowLeft'), held('KeyD', 'ArrowRight')) + stickX);
    const lift = axis(held('KeyQ', 'KeyC'), held('KeyE', 'Space'));
    if (ahead === 0 && side === 0 && lift === 0) return;

    const boost = held('ShiftLeft', 'ShiftRight') ? BOOST : 1;
    this.camera.getWorldDirection(this.forward);
    // Pitch never reaches vertical, so forward × up is never degenerate.
    this.right.crossVectors(this.forward, WORLD_UP).normalize();
    this.move.set(0, 0, 0).addScaledVector(this.forward, ahead).addScaledVector(this.right, side);
    // Two keys held diagonally would otherwise fly √2 faster than one.
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.move.y += lift;
    this.camera.position.addScaledVector(this.move, this.speedValue * boost * step);
  }

  private applyRotation(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
