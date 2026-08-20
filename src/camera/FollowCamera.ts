import * as THREE from 'three';
import type { LookInput } from '../input/LookPad';
import { groundHeight } from '../world/heightfield';

/**
 * Third-person chase camera.
 *
 * It orbits the ant rather than hanging off her tail, so the look pad
 * can swing it around and lift it without fighting the follow. With no
 * look input it sits at rest: directly behind her, a little above.
 *
 * Elevation is measured ABOVE THE HORIZON here. The camera-angle
 * setting on the board counts from straight down instead, so a setting
 * of S means an elevation of 90° - S. Rest is ~26° up, which is ~64°
 * in that setting's terms.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Resting elevation above the horizon, in radians. */
  private readonly restElevation = THREE.MathUtils.degToRad(26);
  /** Elevation is clamped to this arc, matching the setting's 10°-80°. */
  private readonly minElevation = THREE.MathUtils.degToRad(10);
  private readonly maxElevation = THREE.MathUtils.degToRad(80);

  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(
    aspect: number,
    private readonly distance = 7.8,
  ) {
    // Far enough to reach the open water; near kept off the floor so
    // the wide range does not cost depth precision on the terrain.
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.5, 9000);
  }

  snapTo(target: THREE.Object3D): void {
    const rest: LookInput = { yaw: 0, pitch: 0, active: false };
    this.place(target, rest, this.desired);
    this.camera.position.copy(this.desired);
    this.aim(target);
  }

  update(target: THREE.Object3D, look: LookInput, dt: number): void {
    this.place(target, look, this.desired);
    // Snappier while the player is steering the view, softer when it is
    // just following, so a drag feels connected but walking feels calm.
    const rate = look.active ? 14 : 6;
    this.camera.position.lerp(this.desired, 1 - Math.exp(-rate * dt));
    this.aim(target);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private place(target: THREE.Object3D, look: LookInput, out: THREE.Vector3): void {
    // Rest is directly behind her: her heading plus half a turn.
    const yaw = target.rotation.y + Math.PI + look.yaw;
    const elevation = THREE.MathUtils.clamp(
      this.restElevation + look.pitch,
      this.minElevation,
      this.maxElevation,
    );
    const flat = Math.cos(elevation) * this.distance;
    out.set(
      target.position.x + Math.sin(yaw) * flat,
      target.position.y + Math.sin(elevation) * this.distance,
      target.position.z + Math.cos(yaw) * flat,
    );
    // Never let the camera sink into a hillside. The margin is a body
    // length or so, enough that a slope behind her crops the frame
    // rather than filling it with dirt.
    const floor = groundHeight(out.x, out.z) + 1.6;
    if (out.y < floor) out.y = floor;
  }

  private aim(target: THREE.Object3D): void {
    this.lookTarget.copy(target.position);
    this.lookTarget.y += 0.6;
    this.camera.lookAt(this.lookTarget);
  }
}
