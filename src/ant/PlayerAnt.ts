import * as THREE from 'three';
import { groundHeight } from '../world/heightfield';
import {
  DIRECTION_EASE, REST_DEADZONE, REST_EASE, SPEED_EASE, TURN_RATE,
} from './pace';

/** Everything the controls ask of her in one frame, in the CAMERA's frame. */
export interface Drive {
  /** Away from the camera, world units per second. Negative backs up. */
  ahead: number;
  /** The camera's right, world units per second. */
  across: number;
  /** Ground speed, whatever the direction. */
  speed: number;
}

/** Shortest way round from a to b. */
function shortest(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Frame-rate-independent exponential ease, 0 to 1. */
function closes(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * The player's ant — rebuild step 01: movement.
 *
 * A placeholder body (head / thorax / gaster and six stick legs) that
 * walks the island heightfield with slope alignment and a simple gait
 * bob. Real six-leg IK is its own rebuild step later; this stage only
 * has to make direct control feel right.
 *
 * STEERING IS LOOKING. There is no turn control: the stick is
 * camera-relative, and while she is being driven her body comes onto
 * the camera's heading. Travelling somewhere is already a statement
 * about which way she means to face. Because her body ends up aligned
 * with the view, a sideways push still reads as a proper sidestep on
 * screen — she crabs, she does not pivot.
 *
 * Two earlier schemes were tried here and both felt wrong on the
 * device: slow-to-turn, where nothing steered her above a crawl, and
 * lean-into-the-turn, where a diagonal push arced her round like a car.
 * This one matches the Godot build, which is the reference.
 *
 * AT REST she is left alone. You can walk the camera most of the way
 * round her and she just watches you over her shoulder; past
 * REST_DEADZONE she turns, and only back to the EDGE of it, because
 * chasing the camera onto her nose would mean she could never be
 * looked at from the side at all.
 *
 * NOTHING HERE SNAPS. The direction she is trying to go eases, and her
 * speed eases onto it separately — a standing start, a change of mind
 * and letting go are all the same exponential, so she carries a little
 * of her own weight instead of switching between velocities.
 */
export class PlayerAnt {
  readonly root = new THREE.Group();

  private heading = 0;
  private gaitPhase = 0;
  /** Where she is trying to go, camera frame, eased. */
  private wish = { x: 0, y: 0 };
  /** What she is actually doing, camera frame, world units per second. */
  private velocity = { x: 0, y: 0 };
  private readonly body = new THREE.Group();
  private readonly slopeAhead = new THREE.Vector3();

  constructor() {
    this.buildBody();
    this.root.add(this.body);
  }

  placeAt(x: number, z: number, heading = 0): void {
    this.heading = heading;
    this.wish = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.root.position.set(x, groundHeight(x, z), z);
    this.root.rotation.set(0, heading, 0);
  }

  /** Which way she is facing, in world radians. */
  get bearing(): number {
    return this.heading;
  }

  /** How fast she is actually travelling, after the easing. */
  get pace(): number {
    return Math.hypot(this.velocity.x, this.velocity.y);
  }

  /**
   * @param drive what the controls are asking of her this frame
   * @param view the heading the player is LOOKING along, world radians
   *
   * Deliberately the look input rather than a bearing measured off the
   * camera's actual position. The camera eases toward where it is
   * wanted, so a measured bearing moves as SHE moves — which closes a
   * loop: she turns onto it, that shifts it again, and a straight run
   * curls into a circle. Ask the input what it wants; do not ask the
   * follow where it got to.
   */
  update(drive: Drive, view: number, dt: number): void {
    const asked = Math.hypot(drive.ahead, drive.across);

    // Swing the wish round rather than letting it jump. Flicking the
    // stick from one side to the other used to reverse her travel
    // inside a frame, and the legs are still mid-stride the old way.
    const bend = closes(DIRECTION_EASE, dt);
    this.wish.x += (drive.across - this.wish.x) * bend;
    this.wish.y += (drive.ahead - this.wish.y) * bend;

    const gather = closes(SPEED_EASE, dt);
    this.velocity.x += (this.wish.x - this.velocity.x) * gather;
    this.velocity.y += (this.wish.y - this.velocity.y) * gather;

    if (asked > 0.01) {
      // Driven: she points where the camera points.
      this.heading += shortest(this.heading, view) * closes(TURN_RATE, dt);
    } else {
      // At rest: only once looking is not enough on its own, and only
      // back to the edge of the deadzone.
      const off = shortest(this.heading, view);
      const excess = Math.abs(off) - REST_DEADZONE;
      if (excess > 0) this.heading += Math.sign(off) * excess * closes(REST_EASE, dt);
    }

    // Travel is in the CAMERA's frame, not hers: the stick means what
    // the player sees, and her body follows it rather than steering it.
    const step = dt;
    if (this.velocity.x !== 0 || this.velocity.y !== 0) {
      const right = view - Math.PI / 2;
      this.root.position.x
        += (Math.sin(view) * this.velocity.y + Math.sin(right) * this.velocity.x) * step;
      this.root.position.z
        += (Math.cos(view) * this.velocity.y + Math.cos(right) * this.velocity.x) * step;
      this.gaitPhase += this.pace * step * 2.2;
    }

    this.settle();
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
