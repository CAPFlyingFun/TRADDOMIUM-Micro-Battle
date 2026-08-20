import * as THREE from 'three';
import { groundHeight } from '../world/heightfield';
import type { MoveInput } from '../input/MoveStick';
import { GAIT_SPEED, GAIT_TURN, type Gait } from './gait';

/** Everything the controls ask of her in one frame. */
export interface Drive {
  /** Stick vector, camera-relative (x right, y forward). */
  move: MoveInput;
  /** How hard she is pushing herself. */
  gait: Gait;
  /** Locked world bearing while auto-walking, or null when hand-steered. */
  bearing: number | null;
}

/**
 * The player's ant — rebuild step 01: movement.
 *
 * A placeholder body (head / thorax / gaster and six stick legs) that
 * walks the island heightfield with steered turning, slope alignment
 * and a simple gait bob. Real six-leg IK is its own rebuild step later;
 * this stage only has to make direct control feel right.
 */
export class PlayerAnt {
  readonly root = new THREE.Group();

  private heading = 0;
  private gaitPhase = 0;
  private readonly body = new THREE.Group();
  private readonly slopeAhead = new THREE.Vector3();

  constructor() {
    this.buildBody();
    this.root.add(this.body);
  }

  placeAt(x: number, z: number, heading = 0): void {
    this.heading = heading;
    this.root.position.set(x, groundHeight(x, z), z);
    this.root.rotation.set(0, heading, 0);
  }

  /** Which way she is facing, in world radians. */
  get bearing(): number {
    return this.heading;
  }

  /**
   * @param drive what the controls are asking of her this frame
   * @param cameraYaw yaw of the camera, so "stick up" means "away from
   *   the camera" no matter where the ant is facing
   */
  update(drive: Drive, cameraYaw: number, dt: number): void {
    const { move, gait } = drive;
    const speed = GAIT_SPEED[gait];

    // Auto-walk: she holds a WORLD bearing, so swinging the camera to
    // look at the scenery cannot steer her into the sea.
    if (drive.bearing !== null) {
      this.heading = drive.bearing;
      const step = speed * dt;
      this.root.position.x += Math.sin(this.heading) * step;
      this.root.position.z += Math.cos(this.heading) * step;
      this.gaitPhase += step * 2.2;
      this.settle();
      return;
    }

    const strength = Math.min(1, Math.hypot(move.x, move.y));
    if (strength > 0.05) {
      // move.x is negated because headings here run clockwise when read
      // as atan2(sin, cos) over (x, z), while the viewer's right in a
      // camera looking along +Z is world -X. See tests/playerAnt.test.ts.
      const targetHeading = cameraYaw + Math.atan2(-move.x, move.y) + Math.PI;
      let diff = targetHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = GAIT_TURN[gait] * dt;
      this.heading += THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);

      // She walks where her body points, so a hard stick reversal turns
      // her around rather than strafing her backwards.
      const forwardness = Math.max(0, Math.cos(diff));
      const step = speed * strength * forwardness * dt;
      this.root.position.x += Math.sin(this.heading) * step;
      this.root.position.z += Math.cos(this.heading) * step;
      this.gaitPhase += step * 2.2;
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
