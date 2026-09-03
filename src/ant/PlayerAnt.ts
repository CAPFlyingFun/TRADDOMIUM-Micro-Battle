import * as THREE from 'three';
import { groundHeight } from '../world/heightfield';
import { world, type WorldPoint } from '../world/coords';
import { toLocal } from '../world/origin';
import { DIRECTION_EASE, SPEED_EASE } from './pace';

/**
 * How briskly her body takes up a new slope. Higher is quicker; this
 * only has to outrun the eye, not the terrain.
 */
const SLOPE_EASE = 9;

/**
 * HOW WIDE SHE IS, for the one question anything solid asks of her.
 *
 * She is 140 units long and a good deal narrower; eighteen is about her
 * thorax. A body is not a point and using one would let her nose sit
 * inside a trunk while her centre was clear.
 */
export const BODY_RADIUS = 18;

/** What something solid answers when she is inside it. */
export interface Blocked {
  /** How far in, world units. */
  readonly depth: number;
  /** The horizontal unit vector out. */
  readonly outX: number;
  readonly outZ: number;
}
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

  /**
   * WHERE SHE IS IN THE WORLD, in float64.
   *
   * Not `root.position`, which is where she is DRAWN. At true scale the
   * island runs to 5.6 million units and float32 cannot hold that
   * usefully — a quarter of her body length between representable
   * values at the far corner. So the logical position lives here as an
   * ordinary JavaScript number, which is float64 and has a billionth of
   * a unit to spare, and `settle` rebases it for the renderer.
   */
  private at = { x: 0, z: 0 };

  private heading = 0;
  private gaitPhase = 0;
  /** Radians per second she turned last frame — the gait reads it. */
  private turned = 0;
  /** The six legs, with their rest pose and tripod phase. */
  private readonly legs: Array<{
    mesh: THREE.Mesh; yaw: number; roll: number; phase: number;
  }> = [];
  /**
   * Her airborne attitude — roll and pitch. Null on the ground, where
   * the terrain decides how she sits instead.
   */
  private attitude: { bank: number; pitch: number } | null = null;

  /** Where she is trying to go, camera frame, eased. */
  private wish = { x: 0, y: 0 };
  /** What she is actually doing, camera frame, world units per second. */
  private velocity = { x: 0, y: 0 };
  private readonly body = new THREE.Group();
  /**
   * The placeholder parts, kept together so they can be taken off.
   *
   * EVERY stick-legged part belongs in here and nothing belongs on
   * `body` directly. Her eyes were added to `body` by mistake, so
   * `wear` took the placeholder away and left two black orbs hanging
   * in the air where the old, larger head used to be.
   */
  private readonly placeholder = new THREE.Group();
  /** How high the body rides above her feet. Zero once she is real. */
  private lift = 0.34;
  private readonly slopeAhead = new THREE.Vector3();

  /**
   * WHAT SHE CANNOT BE INSIDE OF, or null while nothing is solid.
   *
   * A question the scene answers, not a world this file reaches into —
   * the same shape `terrainAt` has in the autopilot, and for the same
   * reason: her body knows it has a width and knows nothing at all
   * about trees.
   */
  blocked: ((x: number, y: number, z: number, radius: number) => Blocked | null) | null = null;

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
    this.at = { x, z };
    // A SPAWN IS NOT A JOURNEY. Without this the next frame differences
    // her new position against wherever she was last standing — half an
    // island away — and reports it as speed.
    this.wasAt = null;
    this.travelled = { x: 0, z: 0 };
    this.above = 0;
    const seat = toLocal(world(x, z));
    this.root.position.set(seat.lx, groundHeight(x, z), seat.lz);
    this.root.rotation.set(0, heading, 0);
    this.body.rotation.x = 0;
    this.lean = 0;
  }

  /**
   * Put her back on the ground where she stands.
   *
   * The relief dial moves the whole island under her feet, and a
   * rebase moves the whole scene. Without this she keeps the position
   * she had until the next frame settles her, which at a big change is
   * a visible drop, a moment inside a hill, or a lurch across the map.
   */
  reground(): void {
    // Not a frame of movement — the island moved, not her. And not a
    // landing either: she keeps the height she was at.
    this.settle(this.above, 1, false);
  }

  /**
   * Where she is in the WORLD — the authoritative answer.
   *
   * A WorldPoint rather than a bare pair, so it cannot be handed to
   * something expecting a rendered position. Her saved location, her
   * position on a network and her distance to anything are all this,
   * never `root.position`.
   */
  get where(): WorldPoint {
    return world(this.at.x, this.at.z);
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
  /**
   * @param carry world units a second that something ELSE is moving her
   *   at — surf, a current, anything that does not ask her legs.
   *   Added to her travel exactly as the wind is added in `fly`, and at
   *   the same point, so it lands in `overGround` for free and the HUD
   *   reports what actually happened rather than what she asked for.
   */
  update(
    drive: Drive, view: number, dt: number, above = 0,
    carry?: { readonly x: number; readonly z: number } | null,
  ): void {
    this.attitude = null;
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
      this.at.x
        += (Math.sin(view) * this.velocity.y + Math.sin(right) * this.velocity.x) * step;
      this.at.z
        += (Math.cos(view) * this.velocity.y + Math.cos(right) * this.velocity.x) * step;
    }
    // CARRIED. Separate from her drive because the two are different
    // things and the difference is the point: a queen sprinting up a
    // beach into a breaking wave is running at full effort and going
    // backwards, and her legs, her gait and her heading are all
    // unaffected by that. Only her position over the island changes.
    if (carry) {
      this.at.x += carry.x * dt;
      this.at.z += carry.z * dt;
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

  /**
   * Fly one frame: the velocity is GIVEN, not eased into.
   *
   * The walk eases a wish onto a velocity because a thumb can flick
   * across a stick faster than an ant can change her mind. Flight has
   * its own momentum already — that is most of what the model is — so
   * running it through the same easing would smear one model over the
   * other and make both feel wrong.
   *
   * SHE FLIES WHERE SHE IS POINTED, not where the camera looks. On the
   * ground steering is looking; in the air her heading is her own and
   * the stick turns her, which is what lets the player look sideways at
   * something while she carries on flying straight.
   *
   * Her legs still do not cycle. There is nothing under them.
   *
   * @param facing her nose direction, world radians
   * @param bank her roll — right wing down is positive
   * @param pitch her nose attitude, from climbing or diving
   */
  fly(
    drive: Drive, facing: number, bank: number, pitch: number,
    dt: number, above: number,
    /** World units per second the AIR is moving. Flight only. */
    wind?: { readonly x: number; readonly z: number } | null,
    /** The floor's height above the terrain — the water column when
     *  she is flying over water. See settle(). */
    base = 0,
  ): void {
    const wasFacing = this.heading;
    this.wish = { x: drive.across, y: drive.ahead };
    this.velocity = { x: drive.across, y: drive.ahead };
    this.heading = facing;
    this.turned = Math.atan2(
      Math.sin(this.heading - wasFacing),
      Math.cos(this.heading - wasFacing),
    ) / Math.max(dt, 1e-6);

    // Travel in HER frame: along the nose, plus the slip across it.
    // THIS IS HER AIR VELOCITY — what the wings are doing against the
    // air around her, and nothing to do with where that air is going.
    const right = facing - Math.PI / 2;
    this.at.x
      += (Math.sin(facing) * this.velocity.y + Math.sin(right) * this.velocity.x) * dt;
    this.at.z
      += (Math.cos(facing) * this.velocity.y + Math.cos(right) * this.velocity.x) * dt;

    // AND THEN THE AIR ITSELF MOVES. Ground velocity is the vector sum
    // of what she flies and what the sky is doing:
    //
    //   ground = air + wind
    //
    // Added here rather than folded into her drive, because the two are
    // different things and the difference is the whole point: she is
    // still flying north at full power in a southerly that is carrying
    // her backwards over the island. Her heading, her airspeed and her
    // wings are unaffected; only her track over Kauaʻi changes.
    //
    // This is the FLIGHT path only. Walking is untouched — a queen on
    // the ground has six legs on it and does not get blown sideways.
    if (wind) {
      this.at.x += wind.x * dt;
      this.at.z += wind.z * dt;
    }

    this.attitude = { bank, pitch };
    this.settle(above, dt, true, base);
  }

  /**
   * HER ACTUAL VELOCITY OVER THE ISLAND, measured where she moves.
   *
   * Not `pace`, which is the magnitude of her DRIVE — what the wings
   * are doing against the air — and therefore identical to her airspeed
   * in flight however hard the wind is blowing her sideways. The HUD
   * asked `pace` for ground speed and got airspeed back, printing the
   * same number twice under two labels.
   *
   * Differenced from her global position at the one point every path
   * through this class ends at, so it is right by construction: walk,
   * fly, wind, anything added later. World units per second.
   */
  get overGround(): { readonly x: number; readonly z: number } {
    return this.travelled;
  }

  private travelled = { x: 0, z: 0 };
  private wasAt: { x: number; z: number } | null = null;

  /**
   * HOW FAR OFF THE GROUND SHE WAS LAST SETTLED, so that re-seating her
   * is a re-seating and not a landing.
   *
   * THE FLASH EVERY SEVEN SECONDS. A rebase calls `reground()`, which
   * used to settle her at zero — on the floor. Airborne, that dropped
   * her the whole way to the ground for the remainder of the frame,
   * and because the chase camera is placed AFTER the rebase and from
   * her position, the camera went with her: one rendered frame taken
   * from ankle height instead of twenty metres up. The detail fade
   * hands over within a metre of the eye, so ground that had been flat
   * average colour from altitude burst into full texture for that
   * frame — Joshua's "all the terrain clear with no LOD". It arrived
   * on a timer because rebases do: the origin moves when she has
   * strayed 4096 units, which at a flown 5.6 m/s is every seven to
   * eight seconds, and at walking pace is every few minutes. Same bug,
   * both reports.
   *
   * Kept here rather than passed in because `reground()`'s callers —
   * the rebase, the relief dial — know that the ISLAND moved. They do
   * not know, and should not have to know, how high she was over it.
   */
  private above = 0;

  /**
   * How far off the ground she is riding, world units.
   *
   * A jump, or — the case this exists for — the water holding her up.
   * `settle` has always placed her at groundHeight + above; nothing
   * could ASK how high that was, so the altimeter reported the bed
   * she was floating over. See IslandScene.mslNow.
   */
  get riding(): number { return this.above; }

  /** Put her on the ground — or `above` it — facing her heading. */
  /**
   * @param base how far the FLOOR she is measured from stands above
   *   the terrain — the water column where she is flying over water,
   *   zero everywhere else. Her clearance is measured against the
   *   surface she would land on (IslandScene hands the flight model
   *   the same floor), so placing her at terrain + clearance flew her
   *   a whole water column UNDER the sea: "I ended up going
   *   underwater which I shouldn't have". Walking passes zero because
   *   wadeAt's `above` already rides from the bed.
   */
  private settle(above: number, dt: number, moved = true, base = 0): void {
    // ── THE WOOD IS SOLID ────────────────────────────────────────
    // BEFORE the travel is measured, so `overGround` reports what
    // actually happened rather than what she asked for: pressed against
    // a trunk she is going nowhere and the readout should say so.
    //
    // One push a frame, out along the trunk's own radius at her height.
    // Two overlapping trunks answer with the deeper of them and the
    // other is resolved on the next frame, which at her speed is a
    // fraction of a body length.
    //
    // It runs for the flight too, and that is the point: this is the
    // first thing in the game she cannot pass through, on foot or on
    // the wing. It is not a STUN and not a bounce — those need a
    // surface to hit and are parked in the roadmap until there is one
    // — she is simply not allowed to be inside the wood.
    if (this.blocked) {
      const under = groundHeight(this.at.x, this.at.z);
      const bump = this.blocked(
        this.at.x, under + base + above, this.at.z, BODY_RADIUS,
      );
      if (bump) {
        this.at.x += bump.outX * bump.depth;
        this.at.z += bump.outZ * bump.depth;
      }
    }
    const { x, z } = this.at;
    this.above = above;
    if (moved && this.wasAt && dt > 1e-6) {
      this.travelled = {
        x: (x - this.wasAt.x) / dt,
        z: (z - this.wasAt.z) / dt,
      };
    }
    this.wasAt = { x, z };
    // WORLD in, LOCAL out, and the conversion named at the one place
    // it happens: everything the GPU sees is measured from the floating
    // origin rather than from the island's corner.
    const seat = toLocal(world(x, z));
    this.root.position.set(seat.lx, groundHeight(x, z) + base + above, seat.lz);
    this.root.rotation.y = this.heading;
    if (this.attitude) {
      // Airborne: her own attitude, not the hill she is over.
      this.nose(this.attitude.pitch);
      this.body.rotation.z = this.attitude.bank;
      this.body.position.y = this.lift;
      this.tuck();
      return;
    }
    this.body.rotation.z = 0;
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
    this.lean += (wants - this.lean) * closes(SLOPE_EASE, dt);
    this.nose(this.lean);
  }

  /** How far she is tipped by the ground, radians, positive nose up. */
  private lean = 0;

  /**
   * POINT HER NOSE, radians, POSITIVE IS UP — and the one place in the
   * game that knows this costs a minus sign.
   *
   * She faces +Z (queenModel.ts says so), and a positive rotation
   * about +X carries +Z toward −Y. So a positive rotation.x puts her
   * nose in the DIRT, and every caller that thought it was writing
   * "nose up" was writing the opposite.
   *
   * Both callers were wrong and only one was noticed: pushing the
   * stick forward reared her up instead of tipping her into the
   * acceleration, which Joshua flew and reported. The other is the
   * walking lean, which has been tipping her nose down every time she
   * climbed a hill — at eight tenths of a gentle slope, quietly enough
   * that nobody caught it.
   *
   * Fixed HERE rather than at each caller, because a convention that
   * lives in two places is a convention that disagrees with itself.
   * `pitch` and `lean` both mean nose-up everywhere else, including in
   * the flight model, the telemetry and the tests.
   */
  private nose(up: number): void {
    this.body.rotation.x = -up;
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
      this.placeholder.add(orb);

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
