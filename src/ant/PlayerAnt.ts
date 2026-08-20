import * as THREE from 'three';
import { groundHeight } from '../world/heightfield';
import {
  BODY_CATCHUP_DELAY, BODY_CATCHUP_RATE, CATCHUP_MAX_SPEED, FREE_LOOK_ANGLE,
} from './pace';

/** Everything the controls ask of her in one frame, in HER OWN frame. */
export interface Drive {
  /** Along her heading, world units per second. Negative is astern. */
  forward: number;
  /** Her right, world units per second — sidestep, not a turn. */
  strafe: number;
  /** Ground speed, whatever the direction. */
  speed: number;
}

/**
 * The player's ant — rebuild step 01: movement.
 *
 * A placeholder body (head / thorax / gaster and six stick legs) that
 * walks the island heightfield with slope alignment and a simple gait
 * bob. Real six-leg IK is its own rebuild step later; this stage only
 * has to make direct control feel right.
 *
 * SHE IS DRIVEN IN HER OWN FRAME. Forward is where she is facing and
 * strafe is her right, which is what makes a sidestep a sidestep: a
 * six-legged animal crabs sideways without turning, and a
 * camera-relative stick cannot say that.
 *
 * TURNING IS THE CAMERA'S JOB, AND ONLY AT LOW SPEED. At or below a
 * crawl the camera may lead and her body comes round to it after a
 * beat. Above that she holds her heading wherever the view points, so
 * looking around mid-run never yanks her off course — which does mean
 * she has to slow down to change direction. That is deliberate, and
 * CATCHUP_MAX_SPEED in pace.ts is the single number that reverses it.
 */
export class PlayerAnt {
  readonly root = new THREE.Group();

  private heading = 0;
  private gaitPhase = 0;
  /** How long the camera has been outside the free-look cone. */
  private lookHeld = 0;
  /** True once she has committed to coming round to it. */
  private chasing = false;
  private readonly body = new THREE.Group();
  private readonly slopeAhead = new THREE.Vector3();

  constructor() {
    this.buildBody();
    this.root.add(this.body);
  }

  placeAt(x: number, z: number, heading = 0): void {
    this.heading = heading;
    this.lookHeld = 0;
    this.chasing = false;
    this.root.position.set(x, groundHeight(x, z), z);
    this.root.rotation.set(0, heading, 0);
  }

  /** Which way she is facing, in world radians. */
  get bearing(): number {
    return this.heading;
  }

  /**
   * @param drive what the controls are asking of her this frame
   * @param cameraYaw direction from her to the camera, in world radians
   * @returns radians her body turned. The caller MUST hand this back to
   *   the look control: the camera rides round with her, so without it
   *   the offset she is chasing never closes and she spins forever.
   */
  update(drive: Drive, cameraYaw: number, dt: number): number {
    const turned = this.catchUp(drive.speed, cameraYaw, dt);

    // Her own frame. Facing +Z her right is -X, since right = forward
    // cross up = (0,0,1) x (0,1,0) = (-1,0,0).
    const ahead = drive.forward * dt;
    const across = drive.strafe * dt;
    if (ahead !== 0 || across !== 0) {
      const sin = Math.sin(this.heading);
      const cos = Math.cos(this.heading);
      this.root.position.x += sin * ahead - cos * across;
      this.root.position.z += cos * ahead + sin * across;
      this.gaitPhase += Math.hypot(ahead, across) * 2.2;
    }

    this.settle();
    return turned;
  }

  /**
   * Let the camera lead her, softly, and only when she is slow enough
   * for a pan to mean "look at that" rather than "go there".
   *
   * Inside the cone nothing happens at all — a few degrees of thumb
   * must never make her wiggle. A sustained offset commits her after a
   * delay, and from then she turns until she is actually lined up, so
   * she settles once rather than hunting across the cone edge.
   */
  private catchUp(speed: number, cameraYaw: number, dt: number): number {
    if (speed > CATCHUP_MAX_SPEED) {
      this.lookHeld = 0;
      this.chasing = false;
      return 0;
    }

    // The camera looks from where it sits back at her, so the heading
    // it looks along is half a turn from its bearing.
    const target = cameraYaw + Math.PI;
    const off = Math.atan2(
      Math.sin(target - this.heading),
      Math.cos(target - this.heading),
    );

    // Committing is what the cone and the delay gate. Once she has
    // committed she finishes the turn: stopping the moment the cone is
    // re-entered would leave her permanently 30 degrees off whatever
    // the player was looking at, which is the opposite of the point.
    if (!this.chasing) {
      if (Math.abs(off) <= FREE_LOOK_ANGLE) {
        this.lookHeld = 0;
        return 0;
      }
      this.lookHeld += dt;
      if (this.lookHeld < BODY_CATCHUP_DELAY) return 0;
      this.chasing = true;
    }

    if (Math.abs(off) < 0.02) {
      this.chasing = false;
      this.lookHeld = 0;
      return 0;
    }

    const most = BODY_CATCHUP_RATE * dt;
    const turned = THREE.MathUtils.clamp(off, -most, most);
    this.heading += turned;
    return turned;
  }

  /** Put her on the ground, facing her heading, leaning with the slope. */
  private settle(): void {
    const { x, z } = this.root.position;
    this.root.position.y = groundHeight(x, z);
    this.root.rotation.y = this.heading;
    this.alignToSlope(x, z);

    // Gait bob: subtle, and only while striding.
    this.body.position.y = 0.34 + Math.abs(Math.sin(this.gaitPhase)) * 0.05;
  }

  /** Pitch the body to the terrain sampled a body-length ahead/behind. */
  private alignToSlope(x: number, z: number): void {
    const look = 0.9;
    this.slopeAhead.set(Math.sin(this.heading) * look, 0, Math.cos(this.heading) * look);
    const ahead = groundHeight(x + this.slopeAhead.x, z + this.slopeAhead.z);
    const behind = groundHeight(x - this.slopeAhead.x, z - this.slopeAhead.z);
    this.body.rotation.x = Math.atan2(ahead - behind, look * 2) * 0.8;
  }

  private buildBody(): void {
    const chitin = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.55 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });

    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), chitin);
    thorax.scale.set(1, 0.85, 1.4);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), chitin);
    head.scale.set(1, 0.9, 1.05);
    head.position.set(0, 0.05, 0.45);

    const gaster = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), chitin);
    gaster.scale.set(1, 0.95, 1.5);
    gaster.position.set(0, 0.02, -0.55);

    for (const side of [-1, 1]) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eye);
      orb.position.set(0.12 * side, 0.12, 0.58);
      this.body.add(orb);

      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.62, 5), chitin);
        leg.position.set(0.3 * side, -0.16, 0.26 - i * 0.26);
        leg.rotation.z = side * 1.05;
        leg.rotation.y = side * (i - 1) * 0.35;
        this.body.add(leg);
      }

      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.45, 5), chitin);
      antenna.position.set(0.1 * side, 0.24, 0.62);
      antenna.rotation.x = -0.9;
      antenna.rotation.z = side * 0.5;
      this.body.add(antenna);
    }

    this.body.add(thorax, head, gaster);
    this.body.position.y = 0.34;
  }
}
