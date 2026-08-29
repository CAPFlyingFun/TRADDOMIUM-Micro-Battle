import * as THREE from 'three';
import type { LookInput } from '../input/LookDrag';
import { groundHeight } from '../world/heightfield';
import { local } from '../world/coords';
import { toWorld } from '../world/origin';
import { waterSpotAt } from '../world/waterQuery';
import { swellPeriod, swellReach } from '../world/seaSwell';
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
 * THE SEA IS FILTERED IN FREQUENCY NOW, NOT IN TIME — v0.0.106.
 *
 * There used to be a first-order filter on the camera's height here
 * (CALM_RISE, 0.6 a second) which passed about a seventh of a 1.5 s
 * swell. It worked on the sea it was written for and could not survive
 * a slower one: a first-order filter lags by up to a quarter period,
 * and against the generated sea's 6 s macro swell that is a second and
 * a half of camera still sitting in the last trough while the next
 * crest arrives — the same "damped camera is late" mechanism that put
 * the lens under the water in v0.0.99, one scale up.
 *
 * It is also the mechanism behind the older BRISK_RISE disaster: a
 * first-order filter lags a RAMP by speed over rate, so at the top of
 * the lift lever the camera sat five times its own boom below her,
 * aimed almost vertically up. Joshua: "why the camera is pitching up
 * so much... never did it like on version 0.80."
 *
 * So the filtering moved to where the sea is actually made. seaSwell
 * splits its own table into a SLOW half and a FAST half by component
 * (seaSwell.heaveGain), keeps a small share of the slow half for the
 * camera to go along with (seaSwell.CAMERA_FOLLOW) and calls the whole
 * of the rest what the view must HOLD STILL AGAINST; the water query
 * carries that along with the column it belongs to, and the camera
 * simply subtracts it. Same shape of low pass, no memory, and —
 * because every component is evaluated at one instant off one clock —
 * no phase lag at all.
 *
 * THE SHARE IS THE POINT, and v0.0.106 shipped it wrong. That first
 * cut kept ALL of the slow half, which is a camera that keeps perfect
 * station on the water: the lens tracked 96% of her swing and the
 * whole view rose and fell a metre and a half with every wave. Joshua
 * on the phone: still a washing machine. The rule was never about the
 * water — "the waves are supposed to move under her, not under the
 * player" — so the camera now goes along with about a seventh of the
 * heave and none of the chop, and the horizon holds.
 *
 * Flying and walking are untouched: there is no chop out of the water,
 * so the term is zero and her height reaches the camera the same frame,
 * which is what v0.0.88 broke and this must not.
 */

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
 * and because the clamp re-seeded the height filter of the day, the
 * smoothing could never touch it. Joshua: "like a washing
 * machine".
 *
 * So the lens is allowed under the water now. A crest passing over it
 * is what being an ant in a swell looks like, and correcting it is
 * what made the horizon pump. What is corrected is submersion that
 * LASTS — measured in seconds, not centimetres, because a deep crest
 * and a shallow one both pass in well under a second while genuinely
 * sinking does not.
 */
/**
 * How fast the envelope lifts, as a fraction of the sea's own reach
 * per beat of it — barely a nudge while a wash might still be a
 * passing crest, and enough to clear a crest fast once it is plainly a
 * submersion.
 *
 * RATES, NOT A PULL TOWARD THE SURFACE, and the distinction is the
 * design note above BRIEF: "URGENCY IS A CLOCK, NOT A DEPTH. A crest
 * forty units deep and one four units deep both pass in a fraction of
 * a second, and kicking the camera for either is the pumping this
 * replaced." A correction proportional to depth kicks hardest at
 * exactly the moment a crest is deepest, which is the fault.
 *
 * MEASURED IN THE SEA'S OWN TERMS so they follow it. The shipped
 * table's reach over its beat is 48.4 / 1.474 = 32.8 units a second,
 * and these fractions of it come to 9.9 and 200 — the v0.0.101 numbers
 * they replace, to within a percent. The generated sea works out at
 * 10.7 and 218, because a sea four times slower is also four times
 * taller and the two very nearly cancel.
 */
const WASH_RATE = 0.30;
const SUNK_RATE = 6.1;
/**
 * How quickly the lift's own SPEED may change, per beat.
 *
 * The reason there is a speed at all. A rate that switches on at the
 * waterline steps the camera's vertical velocity by the whole of it,
 * and a step in velocity is unbounded acceleration: measured on the
 * shipped sea, the lens peaked at 1.06 g of vertical acceleration
 * against her 0.46, essentially all of it in that one switch. Fading
 * the rate in with DEPTH cannot fix it, because at wave rate the
 * surface crosses the lens in a frame. Limiting how fast the
 * correction's speed may change does, and it costs a little of the
 * envelope's promptness on very short washes — which are the ones it
 * is supposed to ignore anyway.
 */
const LIFT_SLEW = 5;
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
/**
 * BEATS OF THE SEA, not seconds — and this is the same note the old
 * constants carried, now acted on. They said: "A SLOWER SEA WOULD WANT
 * THESE LONGER. They are seconds of wave, so if the swell's period ever
 * changes they have to be re-swept against it rather than inherited."
 * The generated sea's period is 5.9 s against the shipped 1.47 s, so
 * inherited seconds would have declared every macro crest a genuine
 * submersion and fired the full lift at it — the pumping, restored.
 *
 * The ratios are the swept values divided by the sea they were swept
 * in: 0.35 s and 1.6 s over a 1.47 s table. On the shipped sea they
 * reproduce 0.35 and 1.60 to within a percent; on the generated one
 * they become 1.4 s and 6.4 s, which is the same wave shape measured
 * against a wave six times as long.
 */
const BRIEF_BEATS = 0.24;
const PATIENCE_BEATS = 1.09;
/**
 * The one hard line left, as a multiple of how tall the sea can stand.
 * Past this the lens is not being washed over, it is underwater, and
 * no amount of patience should leave it there. Seventy units over the
 * shipped sea's 48.4 of reach, which is what it has always been.
 */
const DROWNED_REACH = 1.45;

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
  /** Seconds the lens has been continuously under the water. */
  private sunkFor = 0;
  /** What was held off the view last frame — reported, for probes. */
  private hold = 0;
  /**
   * How far the water envelope is currently holding the lens ABOVE
   * where the rig alone would put it.
   *
   * ITS OWN STATE NOW, and it has to be. The nudge is a rate, so it
   * only ever adds up across frames if something remembers the total;
   * until v0.0.106 the height filter happened to be that memory, and
   * removing the filter without this left the envelope re-applying a
   * few units to the same fresh position every frame and never lifting
   * the lens out of a sea it was genuinely under. Held explicitly, it
   * is also readable: this IS the correction, in units, and it decays
   * over a beat of the sea once the water lets go.
   */
  private lift = 0;
  /** …and how fast that correction is currently moving. @see LIFT_SLEW */
  private liftVel = 0;

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
    // NOTHING TO RE-SEED. A snap used to have to restart the height
    // filter or the camera would glide in from wherever it had been;
    // the spectral filter has no memory to carry across a teleport.
    this.hold = 0;
    this.lift = 0;
    this.liftVel = 0;
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
    // HOLD STILL AGAINST THE SEA, rather than damping the camera over
    // time. The water she is floating in reports how much of its
    // surface the view should not go along with (waterQuery.hold, from
    // seaSwell's own table: all of the chop and all but a small share
    // of the slow heave). She sits exactly on that surface, so
    // subtracting it leaves the horizon where it was — and leaves
    // everything she does DELIBERATELY untouched, because a decision
    // is not a wave and has none of the sea in it. Vertical only: lag
    // in the horizontal reads as the camera trailing her, which the
    // offset smoothing exists to avoid.
    //
    // ONLY WHILE THE SEA IS MOVING HER. Out of the water there is no
    // chop and the term is zero anyway; the flag makes that explicit
    // and keeps a diving queen — whose height is her own decision —
    // from having a wave subtracted from her intent.
    this.hold = calm ? this.holdUnder(target) : 0;
    this.camera.position.y -= this.hold;
    // The floor still has the last word: a smoothed camera may lag,
    // it may not lag INTO the ground — nor under a wave.
    this.keepAboveGround(this.camera.position, dive, dt);
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
   * the vertical damping of the day made worse, because a filter with
   * memory is still down in the last trough when the next crest
   * arrives. (That filter is gone as of v0.0.106 — see the header —
   * but this floor is still the live surface and still asked at the
   * camera's own x/z.)
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
    // and does not move; only the water gets an envelope — and only
    // the water's correction is remembered between frames, because the
    // floor is recomputed from the camera's own position every time
    // and carrying it forward would double it.
    const floor = ground + CLEARANCE;
    const spot = waterSpotAt(above.wx, above.wz);
    const released = smoothstep(DIVE_RELEASE_LO, DIVE_RELEASE_HI, dive);
    const beat = Math.max(swellPeriod(), 1e-3);
    const scale = swellReach() / beat;      // units a second, this sea
    const base = out.y;
    // What the envelope was holding last frame, before this frame's
    // water has had its say.
    const under = (spot && spot.depth > 0 && released < 1)
      ? (ground + spot.depth) - (base + this.lift) : -1;
    // How fast the correction may turn over, this sea. Both ends of it
    // are TAPERED by this rather than stopped: a lift that runs into
    // zero, or into the surface, and has its speed snapped to nought
    // is a velocity step in the camera's own height — the same
    // unbounded acceleration the switch at the waterline was, arriving
    // at the other end of the same journey. Measured, the floor alone
    // was worth 0.6 g of it.
    const turn = LIFT_SLEW / beat;
    let wantVel = -this.lift * turn;        // let go, when nothing is wet
    let drowned = -Infinity;
    if (under > 0) {
      this.sunkFor += dt;
      // URGENCY IS A CLOCK, NOT A DEPTH. A crest forty units deep and
      // one four units deep both pass in a fraction of a second, and
      // kicking the camera for either is the pumping this replaced.
      // What a passing wave cannot do is LAST.
      const urgency = smoothstep(
        BRIEF_BEATS * beat, PATIENCE_BEATS * beat, this.sunkFor,
      );
      // Never overshoot into the air: the rise is also capped by what
      // would put the lens exactly ON the surface over one turn, so it
      // eases onto the waterline instead of arriving at it. A limit on
      // the CORRECTION, never a clamp on the position — clamping the
      // position against the surface is the v0.0.100 washing machine,
      // which pinned the lens to the water and copied the whole swell.
      // It binds only in the last centimetres; anything deeper than
      // that is still a flat rate, which is the point.
      wantVel = Math.min(
        (WASH_RATE + (SUNK_RATE - WASH_RATE) * urgency) * scale,
        under * turn,
      ) * (1 - released);
      const surface = ground + spot!.depth;
      drowned = surface - DROWNED_REACH * swellReach() * (1 - released);
    } else {
      this.sunkFor = 0;
    }
    // THE LIFT HAS A SPEED, and that is what makes it smooth. See
    // LIFT_SLEW: switching a rate on at the waterline steps the
    // camera's vertical velocity and a step in velocity is unbounded
    // acceleration.
    this.liftVel += (wantVel - this.liftVel) * (1 - Math.exp(-turn * dt));
    // The max is a guard, not a mechanism: the taper above brings the
    // correction to a stop before it gets here.
    this.lift = Math.max(0, this.lift + this.liftVel * dt);
    out.y = base + this.lift;
    // …and the one hard line, which is not negotiable and so is still
    // a clamp. Past DROWNED the lens is not being washed over, it is
    // under, whatever the clock says.
    if (out.y < drowned) {
      out.y = drowned;
      this.lift = out.y - base;
    }
    if (out.y < floor) out.y = floor;
  }

  /** What the water envelope is holding the lens up by, for probes. */
  liftHeld(): number {
    return this.lift;
  }

  /**
   * The part of the sea standing over HER that the view should not go
   * along with, drawn units.
   *
   * Asked at her position rather than the camera's, deliberately: it
   * is HER motion the term is cancelling, and a wave is a moving
   * surface, so the water seven units away is a different number and
   * would leave a residue instead of cancelling.
   *
   * Read from the same authoritative query as everything else, so
   * there is no path by which the camera can be framing against one
   * sea while she floats on another — and zero wherever the water has
   * no swell to speak of, which is every pond on the island.
   */
  private holdUnder(target: THREE.Object3D): number {
    const at = toWorld(local(target.position.x, target.position.z));
    const spot = waterSpotAt(at.wx, at.wz);
    if (!spot || spot.depth <= 0 || !spot.hold) return 0;
    return spot.hold;
  }

  /** What the last frame held off the view, for probes and tests. */
  holdTaken(): number {
    return this.hold;
  }

  private aim(target: THREE.Object3D): void {
    this.lookTarget.copy(target.position);
    this.lookTarget.y += 0.6;
    this.camera.lookAt(this.lookTarget);
  }
}
