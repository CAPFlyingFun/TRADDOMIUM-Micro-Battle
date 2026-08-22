import * as THREE from 'three';
import type { LookInput } from '../input/LookDrag';
import { groundHeight } from '../world/heightfield';
import { local } from '../world/coords';
import { toWorld } from '../world/origin';
import { settings } from '../ui/settings';

/**
 * Third-person chase camera.
 *
 * It orbits the ant on a WORLD bearing and follows her position, so it
 * never turns because she turned. That is deliberate: her body is what
 * comes onto the view, not the other way round, and a camera that also
 * chased her heading would make the pair spin.
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
  /**
   * Where the camera sits RELATIVE TO HER, which is the thing that is
   * smoothed. It used to lerp the camera's WORLD position instead, and
   * an exponential follower trails a moving target by speed over rate
   * — at the follow rate of six, a queen drifting on a 4 mph wind (179
   * units a second at this scale) left the camera thirty units behind
   * its station, upwind of her, aimed at her, and therefore facing
   * wherever the wind was going no matter which way she flew. Joshua
   * flew a full circle with the camera staring downwind the whole way.
   * Smoothing the OFFSET keeps every soft quality the lerp was there
   * for — eased drags, calm elevation changes — while her own motion
   * carries the camera rigidly, however fast the air is moving her.
   */
  private readonly offset = new THREE.Vector3();
  private readonly wantOffset = new THREE.Vector3();

  private distance: number;

  constructor(aspect: number) {
    const dial = settings();
    this.distance = dial.cameraDistance;
    // FAR reaches the whole island now — 5.6 million units — because
    // the backdrop mesh is the real Kauai sitting at true distance. A
    // range that wide would destroy an ordinary depth buffer, which is
    // why the renderer runs a logarithmic one.
    //
    // Near kept off the floor so
    // the wide range does not cost depth precision on the terrain.
    this.camera = new THREE.PerspectiveCamera(dial.fov, aspect, 0.5, 6_000_000);
  }

  /** Take the shape the settings ask for. */
  reshape(): void {
    const dial = settings();
    this.distance = dial.cameraDistance;
    if (this.camera.fov !== dial.fov) {
      this.camera.fov = dial.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  snapTo(target: THREE.Object3D, yaw = 0): void {
    const rest: LookInput = { yaw, pitch: 0, active: false };
    this.place(target, rest, this.desired);
    this.offset.copy(this.desired).sub(target.position);
    this.camera.position.copy(this.desired);
    this.keepAboveGround(this.camera.position);
    this.aim(target);
  }

  update(target: THREE.Object3D, look: LookInput, dt: number): void {
    this.place(target, look, this.desired);
    // Snappier while the player is steering the view, softer when it is
    // just following, so a drag feels connected but walking feels calm.
    // The smoothing applies to the OFFSET only — see its declaration —
    // so her translation reaches the camera the same frame it happens.
    const rate = look.active ? 14 : 6;
    this.wantOffset.copy(this.desired).sub(target.position);
    this.offset.lerp(this.wantOffset, 1 - Math.exp(-rate * dt));
    this.camera.position.copy(target.position).add(this.offset);
    this.keepAboveGround(this.camera.position);
    this.aim(target);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private place(target: THREE.Object3D, look: LookInput, out: THREE.Vector3): void {
    // A WORLD bearing, not one measured off her nose.
    //
    // It used to be her heading plus half a turn, which bolted the
    // camera to her facing. That cannot work now that looking is how
    // she is steered: her body follows the view, and if the view also
    // followed her body the two would chase each other round forever.
    // She comes to the camera; the camera holds still.
    //
    // The look yaw is SUBTRACTED. A drag reports positive yaw when it
    // travels right across the screen, and swinging the camera the same
    // way round the ant read as backwards on the device, so a rightward
    // drag walks the camera the other way. See tests/followCamera.test.ts.
    const yaw = Math.PI - look.yaw;
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
  }

  /**
   * Never let the camera sink into a hillside — or under the sea.
   *
   * Applied to the FINAL position, after the offset smoothing, because
   * a clamp folded into the desired position gets averaged away by the
   * lerp on its way through. The floor is the higher of the ground and
   * the waterline: over the sea the ground is the seabed, far down,
   * and clamping to it alone let the camera slip under the waves near
   * the shore.
   *
   * ASKED IN WORLD COORDINATES, through the named conversion. The
   * camera lives in render space, measured from the floating origin,
   * and the heightfield only answers about the world — a rendered
   * position once put the camera two kilometres up a summit while she
   * stood on a beach.
   */
  private keepAboveGround(out: THREE.Vector3): void {
    const above = toWorld(local(out.x, out.z));
    const floor = Math.max(groundHeight(above.wx, above.wz), 0) + 1.6;
    if (out.y < floor) out.y = floor;
  }

  private aim(target: THREE.Object3D): void {
    this.lookTarget.copy(target.position);
    this.lookTarget.y += 0.6;
    this.camera.lookAt(this.lookTarget);
  }
}
