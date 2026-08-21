import * as THREE from 'three';
import { groundHeight } from '../world/heightfield';
import { DIRECTION_EASE, SPEED_EASE } from './pace';

/**
 * How briskly her body takes up a new slope. Higher is quicker; this
 * only has to outrun the eye, not the terrain.
 */
const SLOPE_EASE = 9;
import { settings } from '../ui/settings';

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
  /** Radians per second she turned last frame — the gait reads it. */
  private turned = 0;
  /** The six legs, with their rest pose and tripod phase. */
  private readonly legs: Array<{
    mesh: THREE.Mesh; yaw: number; roll: number; phase: number;
  }> = [];
  /** Where she is trying to go, camera frame, eased. */
  private wish = { x: 0, y: 0 };
  /** What she is actually doing, camera frame, world units per second. */
  private velocity = { x: 0, y: 0 };
  private readonly body = new THREE.Group();
  /** The placeholder parts, kept together so they can be taken off. */
  private readonly placeholder = new THREE.Group();
  /** How high the body rides above her feet. Zero once she is real. */
  private lift = 0.34;
  private readonly slopeAhead = new THREE.Vector3();

  constructor() {
    this.buildBody();
    this.root.add(this.body);
  }

  /**
   * Put the real mesh on and take the placeholder off.
   *
   * Done as a swap rather than as a constructor argument because the
   * model arrives over the network: she is playable in stick-legs from
   * the first frame and quietly becomes herself when the file lands,
   * instead of the island waiting on a download.
   *
   * The legs go with the placeholder. The real model has a rig but no
   * animations yet, so there is nothing to swing — and a stride cycle
   * driving bones that are not there would be a silent no-op pretending
   * to be a gait.
   */
  wear(model: THREE.Object3D): void {
    this.body.remove(this.placeholder);
    this.legs.length = 0;
    // Her feet are already on her own zero; the bob is what is left of
    // the placeholder's stilts.
    this.lift = 0;
    this.body.position.y = 0;
    this.body.add(model);
  }

  placeAt(x: number, z: number, heading = 0): void {
    this.heading = heading;
    this.wish = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.root.position.set(x, groundHeight(x, z), z);
    this.root.rotation.set(0, heading, 0);
    this.body.rotation.x = 0;
  }

  /**
   * Put her back on the ground where she stands.
   *
   * The relief dial moves the whole island under her feet. Without
   * this she keeps the height she had until the next frame settles
   * her, which at a big change is a visible drop or a moment inside
   * a hill.
   */
  reground(): void {
    this.settle(0, 1);
  }

  /** Which way she is facing, in world radians. */
  get bearing(): number {
    return this.heading;
  }

  /** How fast she is actually travelling, after the easing. */
  get pace(): number {
    return Math.hypot(this.velocity.x, this.velocity.y);
  }

  /** How far through her stride cycle she is — the legs run off this. */
  get stridePhase(): number {
    return this.gaitPhase;
  }

  /**
   * @param drive what the controls are asking of her this frame
   * @param view the heading the player is LOOKING along, world radians
   * @param above how far off the terrain she is — a jump, later a
   *   flight. She does not own it: the arc is a mechanic of its own and
   *   this only has to put her body where the arc says.
   *
   * Deliberately the look input rather than a bearing measured off the
   * camera's actual position. The camera eases toward where it is
   * wanted, so a measured bearing moves as SHE moves — which closes a
   * loop: she turns onto it, that shifts it again, and a straight run
   * curls into a circle. Ask the input what it wants; do not ask the
   * follow where it got to.
   */
  update(drive: Drive, view: number, dt: number, above = 0): void {
    const asked = Math.hypot(drive.ahead, drive.across);
    const wasFacing = this.heading;

    // Swing the wish round rather than letting it jump. Flicking the
    // stick from one side to the other used to reverse her travel
    // inside a frame, and the legs are still mid-stride the old way.
    const bend = closes(DIRECTION_EASE, dt);
    this.wish.x += (drive.across - this.wish.x) * bend;
    this.wish.y += (drive.ahead - this.wish.y) * bend;

    const gather = closes(SPEED_EASE, dt);
    this.velocity.x += (this.wish.x - this.velocity.x) * gather;
    this.velocity.y += (this.wish.y - this.velocity.y) * gather;

    // Read every frame: these are the dials the settings panel moves,
    // and a value cached at construction would ignore it.
    const dial = settings();
    if (asked > 0.01) {
      // Driven: she points where the camera points.
      this.heading += shortest(this.heading, view) * closes(dial.turnRate, dt);
    } else {
      // At rest: only once looking is not enough on its own, and only
      // back to the edge of the deadzone.
      const off = shortest(this.heading, view);
      const excess = Math.abs(off) - dial.turnStart;
      if (excess > 0) this.heading += Math.sign(off) * excess * closes(dial.turnEase, dt);
    }

    this.turned = Math.atan2(
      Math.sin(this.heading - wasFacing),
      Math.cos(this.heading - wasFacing),
    ) / Math.max(dt, 1e-6);

    // Travel is in the CAMERA's frame, not hers: the stick means what
    // the player sees, and her body follows it rather than steering it.
    const step = dt;
    if (this.velocity.x !== 0 || this.velocity.y !== 0) {
      const right = view - Math.PI / 2;
      this.root.position.x
        += (Math.sin(view) * this.velocity.y + Math.sin(right) * this.velocity.x) * step;
      this.root.position.z
        += (Math.cos(view) * this.velocity.y + Math.cos(right) * this.velocity.x) * step;
    }
    // Stride on the ground she covers AND on the ground she turns
    // through. Driving the gait off travel alone left her turning on
    // the spot with six legs frozen underneath her, which is most of
    // why a rotation read as a slide rather than as an ant.
    // No stride in mid-air: legs cycling with nothing under them is
    // the running-in-the-air cartoon, and it reads as a bug.
    if (above <= 0) this.gaitPhase += (this.pace * 2.2 + Math.abs(this.turned) * 5) * dt;

    this.settle(above, dt);
  }

  /** Put her on the ground — or `above` it — facing her heading. */
  private settle(above: number, dt: number): void {
    const { x, z } = this.root.position;
    this.root.position.y = groundHeight(x, z) + above;
    this.root.rotation.y = this.heading;
    // Still lean with the ground she is over: an ant tips with the
    // hill she launched off, and losing that mid-jump reads as a snap.
    this.alignToSlope(x, z, dt);

    // Gait bob: subtle, and only while striding.
    this.body.position.y = this.lift + Math.abs(Math.sin(this.gaitPhase)) * 0.05;
    if (above > 0) this.tuck(); else this.stride();
  }

  /**
   * Legs drawn in, the way an ant's are the instant it leaves a
   * surface. Not an animation — one pose, held — but it is the
   * difference between a jump and a model being moved upward.
   */
  private tuck(): void {
    for (const leg of this.legs) {
      leg.mesh.rotation.y = leg.yaw + 0.34;
      leg.mesh.rotation.z = leg.roll - 0.42 * Math.sign(leg.roll);
    }
  }

  /**
   * Swing the placeholder legs in an alternating tripod — front and
   * back one side with the middle of the other, which is how an ant
   * actually walks, and what makes a turn read as legs rather than as
   * a model sliding round.
   *
   * This is NOT the six-leg IK milestone: nothing here reaches for
   * the ground or knows where it is. It is the placeholder body
   * moving, so the movement can be judged on the movement.
   */
  private stride(): void {
    for (const leg of this.legs) {
      const swing = Math.sin(this.gaitPhase + leg.phase);
      // Fore and aft along her body, lifted at the top of the swing.
      leg.mesh.rotation.y = leg.yaw + swing * 0.5;
      leg.mesh.rotation.z = leg.roll - Math.max(0, swing) * 0.28 * Math.sign(leg.roll);
    }
  }

  /**
   * Pitch the body to the terrain sampled a body-length ahead/behind.
   *
   * EASED, because the ground is flat triangles. She reads the surface
   * that is drawn (see heightfield.ts), and a drawn triangle is 10.94
   * units across against her 1 — so both samples usually land on the
   * same plane and the pitch is constant right up until she crosses an
   * edge, where it would step. The ease turns the step into a lean.
   */
  private alignToSlope(x: number, z: number, dt: number): void {
    const look = 0.9;
    this.slopeAhead.set(Math.sin(this.heading) * look, 0, Math.cos(this.heading) * look);
    const ahead = groundHeight(x + this.slopeAhead.x, z + this.slopeAhead.z);
    const behind = groundHeight(x - this.slopeAhead.x, z - this.slopeAhead.z);
    const wants = Math.atan2(ahead - behind, look * 2) * 0.8;
    this.body.rotation.x += (wants - this.body.rotation.x) * closes(SLOPE_EASE, dt);
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
        const roll = side * 1.05;
        const yaw = side * (i - 1) * 0.35;
        leg.rotation.z = roll;
        leg.rotation.y = yaw;
        this.placeholder.add(leg);
        // Alternating tripod: front and back on one side share a
        // phase with the middle leg of the other.
        const tripod = (side < 0) === (i === 1);
        this.legs.push({ mesh: leg, yaw, roll, phase: tripod ? 0 : Math.PI });
      }

      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.45, 5), chitin);
      antenna.position.set(0.1 * side, 0.24, 0.62);
      antenna.rotation.x = -0.9;
      antenna.rotation.z = side * 0.5;
      this.placeholder.add(antenna);
    }

    this.placeholder.add(thorax, head, gaster);
    this.body.add(this.placeholder);
    this.body.position.y = this.lift;
  }
}
