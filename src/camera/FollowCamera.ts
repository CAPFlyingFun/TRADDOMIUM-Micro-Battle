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
/**
 * How fast the camera's height chases hers, per second. Afloat, a
 * 1.5 s swell is attenuated to about a seventh of its amplitude;
 * flying, the camera answers a climb almost at once, because a climb
 * is her decision and lag there reads as broken controls.
 */
const CALM_RISE = 0.6;
const BRISK_RISE = 8;

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
  /** The camera's own, damped height. Null until the first frame. */
  private easedY: number | null = null;

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

  /**
   * @param pitch where the camera should LOOK, radians, positive up —
   *   not a look-drag offset. Omitted, it rests where it rests.
   *   Restoring a position fix needs it: without the look angle a
   *   reproduced frame is the right place seen from the wrong attitude,
   *   which is a different picture.
   */
  /**
   * The look-drag offset that would point the camera at `pitch`.
   *
   * Exposed because the offset is measured from a resting elevation
   * this class owns, and the thing that has to REMEMBER the aim is the
   * look input rather than the camera — see LookDrag.aim.
   */
  offsetFor(pitch: number): number {
    return -pitch - this.restElevation;
  }

  snapTo(target: THREE.Object3D, yaw = 0, pitch?: number): void {
    // The camera sits ABOVE what it looks at, so a view pitched down
    // by p is an elevation of p above the target — and `look.pitch` is
    // measured from the resting elevation rather than from level.
    const rest: LookInput = {
      yaw,
      pitch: pitch === undefined ? 0 : this.offsetFor(pitch),
      active: false,
    };
    this.place(target, rest, this.desired);
    this.offset.copy(this.desired).sub(target.position);
    this.camera.position.copy(this.desired);
    this.keepAboveGround(this.camera.position, target.position.y);
    // A snap is a teleport: the filter starts fresh, or it would
    // glide in from wherever the camera used to be.
    this.easedY = this.camera.position.y;
    this.aim(target);
  }

  /**
   * @param calm true when her vertical motion is the SEA moving her
   *   rather than her flying — see the vertical ease below.
   */
  update(target: THREE.Object3D, look: LookInput, dt: number, calm = false): void {
    this.place(target, look, this.desired);
    // Snappier while the player is steering the view, softer when it is
    // just following, so a drag feels connected but walking feels calm.
    // The smoothing applies to the OFFSET only — see its declaration —
    // so her translation reaches the camera the same frame it happens.
    const rate = look.active ? 14 : 6;
    this.wantOffset.copy(this.desired).sub(target.position);
    this.offset.lerp(this.wantOffset, 1 - Math.exp(-rate * dt));
    this.camera.position.copy(target.position).add(this.offset);
    // HER BOB IS NOT THE CAMERA'S BOB.
    //
    // Measured while she floated: her height swung 34.5 units over a
    // few wave cycles and the camera swung 35.4 — it was copying 103%
    // of it, so the whole world pumped up and down with the swell and
    // the horizon never sat still. The waves are supposed to move
    // under her, not under the player.
    //
    // A first-order filter on the camera's height only. Horizontal
    // follow is untouched, because lag THERE reads as the camera
    // trailing her, which is the one thing the offset smoothing was
    // built to avoid. Afloat it is slow enough to pass barely a fifth
    // of a 1.5 s swell; flying it is quick, because a climb is her
    // decision and must feel connected.
    const rise = calm ? CALM_RISE : BRISK_RISE;
    this.easedY = this.easedY === null ? this.camera.position.y
      : this.easedY + (this.camera.position.y - this.easedY) * (1 - Math.exp(-rise * dt));
    this.camera.position.y = this.easedY;
    // The floor still has the last word: a smoothed camera may lag,
    // it may not lag INTO the ground.
    this.keepAboveGround(this.camera.position, target.position.y);
    this.easedY = this.camera.position.y;
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
   * Never let the camera sink into a hillside — and only under the sea
   * when SHE is under the sea.
   *
   * Applied to the FINAL position, after the offset smoothing, because
   * a clamp folded into the desired position gets averaged away by the
   * lerp on its way through. The floor is the higher of the ground and
   * a waterline that FOLLOWS HER DOWN: pinned at sea level while she is
   * on or above the surface (the camera must not slip under the waves
   * while she floats), and riding two units over her head once she
   * dives, so the lens goes under with her instead of being left
   * staring at the sheet from above — which is exactly what Joshua
   * watched it do. The tracking floor is continuous in her height, so
   * surfacing lifts the camera smoothly rather than teleporting it.
   *
   * ASKED IN WORLD COORDINATES, through the named conversion. The
   * camera lives in render space, measured from the floating origin,
   * and the heightfield only answers about the world — a rendered
   * position once put the camera two kilometres up a summit while she
   * stood on a beach. Her height needs no conversion: the origin
   * shifts x and z only.
   */
  private keepAboveGround(out: THREE.Vector3, herY: number): void {
    const above = toWorld(local(out.x, out.z));
    const waterline = Math.min(0, herY - 2);
    const floor = Math.max(groundHeight(above.wx, above.wz), waterline) + 1.6;
    if (out.y < floor) out.y = floor;
  }

  private aim(target: THREE.Object3D): void {
    this.lookTarget.copy(target.position);
    this.lookTarget.y += 0.6;
    this.camera.lookAt(this.lookTarget);
  }
}
