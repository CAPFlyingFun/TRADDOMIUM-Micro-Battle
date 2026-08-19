import * as THREE from 'three';
import { groundHeight } from '../world/heightfield';

/**
 * Third-person chase camera. Hangs behind and above the ant along her
 * facing, smoothed so turns feel steered rather than snapped, and never
 * dips below the terrain.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(
    aspect: number,
    private readonly back = 7,
    private readonly up = 3.4,
  ) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.1, 400);
  }

  snapTo(target: THREE.Object3D): void {
    this.place(target, this.desired);
    this.camera.position.copy(this.desired);
    this.aim(target);
  }

  update(target: THREE.Object3D, dt: number): void {
    this.place(target, this.desired);
    // Exponential smoothing that is stable across frame rates.
    const blend = 1 - Math.exp(-6 * dt);
    this.camera.position.lerp(this.desired, blend);
    this.aim(target);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private place(target: THREE.Object3D, out: THREE.Vector3): void {
    const behind = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(target.quaternion)
      .multiplyScalar(this.back);
    out.copy(target.position).add(behind);
    out.y = target.position.y + this.up;
    const floor = groundHeight(out.x, out.z) + 0.8;
    if (out.y < floor) out.y = floor;
  }

  private aim(target: THREE.Object3D): void {
    this.lookTarget.copy(target.position);
    this.lookTarget.y += 0.6;
    this.camera.lookAt(this.lookTarget);
  }
}
