import * as THREE from 'three';
import type { LookInput } from '../input/LookDrag';
import { groundHeight } from '../world/heightfield';
import { local } from '../world/coords';
import { toWorld } from '../world/origin';
import { waterSpotAt } from '../world/waterQuery';
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
 * How fast the camera's height chases hers while THE SEA is moving her.
 * A 1.5 s swell is attenuated to about a seventh of its amplitude.
 *
 * There is no longer a second rate for flying. There was — BRISK_RISE,
 * 8 a second, on the reasoning that a climb "must feel connected" — and
 * it was quietly catastrophic, because a first-order filter lags a RAMP
 * by its speed over its rate and a climb is a ramp. At the top of the
 * lift lever, 300 units a second through a rate of 8 is 37 units of lag
 * against a follow distance of 7.8: the camera sat five times its own
 * distance below her and aimed almost vertically up at a queen who then
 * looked like she was leaving on a rocket.
 *
 * Joshua: "why the camera is pitching up so much... never did it like
 * on version 0.80" — and v0.0.80 is exactly the right place to point
 * at, because this filter did not exist before v0.0.88. Her flight
 * model is untouched since then; only the camera changed.
 */
const CALM_RISE = 0.6;

/** How far the lens is held off the ground it may not sink into. */
const CLEARANCE = 1.6;

/**
 * THE SURFACE IS AN ENVELOPE, NOT A FLOOR — and the number that used
 * to be here is why.
 *
 * v0.0.100 held the lens a hard 4 units over the live surface. The
 * camera sits 3.42 units above her at the default boom (7.8 units at
 * 26 degrees) and she floats a draught under the surface, so the lens
 * rides about 3.27 units over the water — LESS than the clearance the
 * clamp demanded. The clamp was therefore active on every frame of
 * every float, not on crests: it pinned the lens rigidly to the
 * surface, so the camera copied 100% of a swell that swings 48 units,
 * and because the clamp re-seeds the damping filter (easedY, below)
 * the smoothing could never touch it. Joshua: "like a washing
 * machine".
 *
 * So the lens is allowed under the water now. A crest passing over it
 * is what being an ant in a swell looks like, and correcting it is
 * what made the horizon pump. What is corrected is submersion that
 * LASTS — measured in seconds, not centimetres, because a deep crest
 * and a shallow one both pass in well under a second while genuinely
 * sinking does not.
 */
/** Barely a nudge, applied the whole time the lens is under. */
const SEA_NUDGE = 10;
/** And what a sustained submersion gets: enough to clear a crest fast. */
const SEA_LIFT = 200;
/**
 * How long the lens may sit under before anything but the nudge
 * happens, and how long before the full lift does.
 *
 * SIZED AGAINST THE SEA IT IS IN, by sweeping them. The swell's
 * period is about 1.5 s, so the longest a passing crest can hold the
 * lens under is roughly 0.7 s, and the choice is a trade: a softer
 * nudge pumps less and leaves the lens wetter.
 *
 *   nudge  3   camera follows 15.5% of her swing, wet 47% of the time
 *   nudge 10   19.0%, wet 41%, never more than 35 units under
 *   nudge 25   22.7%, wet 37%
 *
 * Ten, because it buys a meaningfully drier lens for three points of
 * follow, and because the damping alone is already 14.4% — the floor
 * this can approach but not beat.
 *
 * A SLOWER SEA WOULD WANT THESE LONGER. They are seconds of wave, so
 * if the swell's period ever changes (the live-buoy experiment) they
 * have to be re-swept against it rather than inherited.
 */
const BRIEF = 0.35;
const PATIENCE = 1.6;
/**
 * The one hard line left. Past this the lens is not being washed over,
 * it is underwater, and no amount of patience should leave it there.
 */
const DROWNED = 70;

/**
 * The dive lever, from where the surface clamp starts letting go to
 * where it has entirely let go.
 *
 * A DEADBAND FIRST, and it is the reason this is a band rather than a
 * boolean. Floating is not perfectly still — she rides the swell, the
 * lever gets brushed — and any release that began at the first
 * non-zero touch would drop the camera through the surface for a
 * frame, which is the exact fault this is here to fix. Nothing happens
 * until she has genuinely committed to going down, and then the clamp
 * lifts smoothly rather than at an instant, so surfacing and diving
 * are both continuous and neither is a teleport.
 */
const DIVE_RELEASE_LO = 0.15;
const DIVE_RELEASE_HI = 0.55;

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

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
  /** Seconds the lens has been continuously under the water. */
  private sunkFor = 0;

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
    this.sunkFor = 0;
    this.keepAboveGround(this.camera.position);
    // A snap is a teleport: the filter starts fresh, or it would
    // glide in from wherever the camera used to be.
    this.easedY = this.camera.position.y;
    this.aim(target);
  }

  /**
   * @param calm true when her vertical motion is the SEA moving her
   *   rather than her flying — see the vertical ease below.
   */
  update(
    target: THREE.Object3D, look: LookInput, dt: number,
    calm = false, dive = 0,
  ): void {
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
    // ONLY FOR THE ONE CASE IT WAS BUILT FOR. Damping her bob is right
    // when the SWELL is doing the moving and she is a passenger; it is
    // wrong when the height is her own decision, where any lag at all
    // is the camera failing to follow. Flying and walking now track her
    // exactly, as they did before this filter existed.
    if (calm) {
      this.easedY = this.easedY === null ? this.camera.position.y
        : this.easedY + (this.camera.position.y - this.easedY) * (1 - Math.exp(-CALM_RISE * dt));
      this.camera.position.y = this.easedY;
    } else {
      this.easedY = this.camera.position.y;
    }
    // The floor still has the last word: a smoothed camera may lag,
    // it may not lag INTO the ground — nor under a wave.
    this.keepAboveGround(this.camera.position, dive, dt);
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
   * lerp on its way through.
   *
   * THE WATERLINE IS THE LIVE SURFACE NOW, and the difference is a bug
   * Joshua photographed. This clamped against `Math.min(0, herY - 2)`
   * — sea level, a flat zero — while the queen and the drawn ocean
   * both ride the animated swell. So the floor believed the water was
   * at nought while the actual surface stood up to half a metre above
   * it, and a crest simply rose THROUGH the camera: the lens crossed
   * above and below the water again and again as she floated, which
   * the camera's deliberate vertical damping (CALM_RISE) makes worse,
   * because a damped camera is still down in the last trough when the
   * next crest arrives.
   *
   * So the floor asks the same authoritative water everything else
   * asks — `waterSpotAt`, the registered query, whose sea depth is the
   * swell the ocean sheet is drawn from — and it asks at the CAMERA'S
   * OWN x/z, not hers. A wave is a moving surface: the crest under the
   * lens is not the crest under the queen seven units away, and
   * clamping to hers is how the lens dips into a wave she is not in.
   *
   * DIVING RELEASES IT. Holding the lens out of the water is right
   * while she swims ON it and wrong the moment she goes under, so the
   * dive lever fades the whole envelope out — over a band
   * (DIVE_RELEASE_LO..HI) so the handover is continuous in both
   * directions rather than a teleport, and behind a deadband so
   * bobbing at the surface cannot trip it. Fully released there is no
   * water term at all and only the seabed is a floor.
   *
   * ASKED IN WORLD COORDINATES, through the named conversion. The
   * camera lives in render space, measured from the floating origin,
   * and the heightfield only answers about the world — a rendered
   * position once put the camera two kilometres up a summit while she
   * stood on a beach. Her height needs no conversion: the origin
   * shifts x and z only.
   *
   * @param dive the eased dive lever, nought at the surface and one on
   *   the bottom — INTENT rather than measurement, so a crest washing
   *   over a floating queen does not read as a decision to submerge.
   * @param dt seconds this frame, because the correction is a RATE and
   *   the patience it ramps over is a clock.
   */
  private keepAboveGround(out: THREE.Vector3, dive = 0, dt = 0): void {
    const above = toWorld(local(out.x, out.z));
    const ground = groundHeight(above.wx, above.wz);
    // THE GROUND IS STILL A HARD FLOOR. A hillside is not negotiable
    // and does not move; only the water gets an envelope.
    const floor = ground + CLEARANCE;
    const spot = waterSpotAt(above.wx, above.wz);
    const released = smoothstep(DIVE_RELEASE_LO, DIVE_RELEASE_HI, dive);
    if (spot && spot.depth > 0 && released < 1) {
      // The surface standing over the bed right here, right now.
      const surface = ground + spot.depth;
      const under = surface - out.y;
      if (under <= 0) {
        this.sunkFor = 0;
      } else {
        this.sunkFor += dt;
        // URGENCY IS A CLOCK, NOT A DEPTH. A crest forty units deep
        // and one four units deep both pass in a fraction of a second,
        // and kicking the camera for either is the pumping this
        // replaced. What a passing wave cannot do is LAST.
        const urgency = smoothstep(BRIEF, PATIENCE, this.sunkFor);
        const rise = (SEA_NUDGE + (SEA_LIFT - SEA_NUDGE) * urgency)
          * (1 - released);
        // Never overshoot into the air: the most this may do is put
        // the lens exactly on the surface.
        out.y += Math.min(rise * dt, under);
        // …and the one hard line. Past DROWNED the lens is not being
        // washed over, it is under, whatever the clock says.
        const deepest = surface - DROWNED * (1 - released);
        if (out.y < deepest) out.y = deepest;
      }
    } else {
      this.sunkFor = 0;
    }
    if (out.y < floor) out.y = floor;
  }

  private aim(target: THREE.Object3D): void {
    this.lookTarget.copy(target.position);
    this.lookTarget.y += 0.6;
    this.camera.lookAt(this.lookTarget);
  }
}
