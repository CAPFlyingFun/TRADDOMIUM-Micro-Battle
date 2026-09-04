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
import type { InputSnapshot } from '../input/Input';

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

export interface CameraReadout {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** World units per second, before any boost. */
  readonly speed: number;
}

interface TouchStart {
  readonly x: number;
  readonly y: number;
}

export class FreeFlyCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private pitch = 0;
  private speedValue = DEFAULT_SPEED;
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
    return { x: p.x, y: p.y, z: p.z, speed: this.speedValue };
  }

  /** Put the camera somewhere, looking along a yaw (radians about +Y) and pitch (radians, up positive). */
  place(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
    this.applyRotation();
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

    this.yaw -= lookDx * LOOK_RADIANS_PER_PIXEL;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch - lookDy * LOOK_RADIANS_PER_PIXEL));
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
