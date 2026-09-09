/**
 * THE FOLLOW CAMERA — behind and above whichever creature the player
 * holds, at distances measured in THAT creature's body lengths.
 *
 * Joshua's Creature Lab brief, §7: a normal follow camera on the
 * controlled creature, beside the free camera that stays a developer
 * tool; and §4: a switch "camera hands off cleanly … nothing teleports".
 * The shape is `perf/FreeFlyCamera.ts`'s — it owns a
 * `THREE.PerspectiveCamera`, is moved by its owner once a frame with
 * whatever clock the owner chooses, knows nothing about pausing, and
 * answers `pose()` in WORLD coordinates — and the framing is the
 * finder's (`creatures/finder.ts`, `VIEW_LENGTHS`): the pose a camera
 * must take to SEE a 15 cm animal, or a 1.4 mm one, is a distance in
 * bodies, never in centimetres. Four lengths back and one and a half up
 * put the animal across about a fifth of the screen at 60°; the finder's
 * three lengths give a quarter, and the extra length here is room to see
 * where the animal is going.
 *
 * IT ORBITS ON A WORLD BEARING AND FOLLOWS THE POSITION, so it never
 * turns because the creature turned. v0's `FollowCamera` learnt this
 * and says so in its header: "her body is what comes onto the view, not
 * the other way round, and a camera that also chased her heading would
 * make the pair spin." It matters twice here. `PlayerDemand.ts` turns a
 * driven body TOWARD this camera's yaw; a camera whose yaw were the
 * body's heading plus an offset would move its own target as the body
 * turned toward it, and the body would chase it round for ever. And the
 * translation is RIGID — the eye is placed off the creature's live
 * position every frame, not eased toward it — because a fly at a metre
 * a second with an eye 3 cm behind it would leave an eased eye a body's
 * width behind in a frame.
 *
 * What IS eased are the two angles. The look-drag writes a WANTED
 * bearing and elevation; the lens follows them with the time constant
 * `EASE_TAU_S`, which takes the jitter out of a thumb. And when the
 * player is not looking — `LOOK_HOLD_S` after the last drag — the wanted
 * bearing DRIFTS back onto the creature's heading and the elevation to
 * rest with the time constant `DRIFT_TAU_S`, so letting go returns the
 * camera to behind the animal without a snap, and orbiting round to
 * look at its face holds for as long as the thumb is on the glass plus
 * the hold. Both are GAME TUNING. `yaw` is the WANTED bearing, not the
 * lens's: `PlayerDemand` steers toward what the player asked to see,
 * because a bearing measured off an easing lens moves as the body moves
 * and closes a loop (v0's `PlayerAnt.update`: "do not ask the follow
 * where it got to").
 *
 * THE ORBIT IS OFF THE BODY'S UP (Creature Lab D; Joshua, 2026-09-09:
 * "I tried crawling up the wall in the Queen and I got teleported to
 * the top of it"). The target carries the unit normal of what it stands
 * on (`FollowTarget.up`, `CreatureState.up`), and the orbit is measured
 * off it: behind along the face, out along its normal, so the camera on
 * an ant climbing a wall stands out from the wall and not inside it,
 * and under an ant on the ceiling it hangs below. The bearing is one
 * number measured in the up's own plane (`creatures/surface.ts`,
 * `aheadOn`), so when the body wraps an edge and its up changes, the
 * WANTED and the VIEW bearings are both re-expressed in the new frame
 * by the same rotation the body's ahead was carried by (`rotateBetween`):
 * behind the body before the edge is behind it after. But an edge is a
 * quarter turn of the frame in one frame of the sim, and a quarter turn
 * of the eye in one frame is the cut the brief forbids; so the lens
 * carries a RESIDUAL rotation, the inverse of the edge's, that leaves
 * the eye exactly where it was on the frame the body crosses and then
 * eases to nothing with the time constant `UP_EASE_S`. It is a rotation
 * and not an eased up-vector on purpose: the frame `aheadOn` builds on
 * an up is the minimal rotation from +y, which is not the composition
 * of two edges (a wall to the ceiling under it, one wall to the next),
 * so a look re-expressed in the new frame and read through a half-eased
 * up jumps by up to a right angle on the crossing frame. A residual
 * rotation applied to the WHOLE new frame is continuous by construction,
 * whatever the two faces. On the ground the residual is the identity,
 * the view's up is `WORLD_UP` exactly and every line of the old
 * arithmetic runs unchanged, which the old tests pin.
 *
 * THE LOOK-AT IS STILL ABOUT THE WORLD'S UP, normally: a fly banking, a
 * worm nosing down, an ant on a wall — none of them rolls the picture,
 * and an ant on the ceiling appears upside down, which is what it is.
 * Only when the view runs within `VERTICAL_LOOK_DEGREES` of straight up
 * or straight down is the world's up no longer an answer for `lookAt`,
 * and the tangent the view runs along is used instead, so the picture
 * is defined rather than left to a degenerate cross product. With
 * `ELEVATION_MAX` where it is the orbit never reaches the vertical on
 * any face — the eye under a ceiling at full elevation looks up some
 * twenty degrees off the normal — so this is a guard on the arithmetic,
 * not a look a player will see.
 *
 * THE HANDOFF (§4). `retarget` starts a `HANDOFF_S` blend from the pose
 * the lens is in NOW to the new creature's pose: a smoothstep, whose
 * derivative is zero at both ends, so the first frame after a switch
 * moves the eye by nothing and there is never a cut. The blend's start
 * is remembered as a WorldPoint and a height, not as the lens's
 * rendered position — it outlives a frame, and anything that outlives a
 * frame is addressed in world coordinates (`world/coords.ts`, THE RULE),
 * even in a lab too small to rebase.
 *
 * THE NEAR PLANE RIDES THE TARGET'S SIZE. An aphid's eye is 5 mm behind
 * it, and a near plane fit for a queen would cut the aphid in half; so
 * the glass sits a fixed fraction of the orbit radius ahead of the eye
 * (`NEAR_OF_ORBIT`), never under `MIN_NEAR` — the perf world's floor,
 * 0.1 units — and the far plane is a fixed ratio beyond it,
 * `DEPTH_RATIO`, exactly as `PerformanceWorldScene`'s `adaptDepth` keeps
 * it: 60,000 near-planes of depth in whatever precision the buffer has,
 * which for the Lab's 0.1 is 60 m, and the Lab is one. The projection is
 * rebuilt only when the near plane really moves — it is a matrix, not a
 * number.
 *
 * Renderer-side: imports three, and the one conversion between a yaw
 * and a heading from the file that owns it (`perf/FreeFlyCamera.ts`).
 */
import * as THREE from 'three';
import { wrapHeading } from '../creatures/heading';
import { FACE_NORMALS, WORLD_UP as SURFACE_UP, aheadOn, headingOn, rotateBetween, type MutableVec3, type Vec3 } from '../creatures/surface';
import type { InputSnapshot } from '../input/Input';
import { headingOfYaw, yawForHeading, type LookTuning } from '../perf/FreeFlyCamera';
import type { CameraPose } from '../session/GameSession';
import { local, type WorldPoint } from '../world/coords';
import { toLocal, toWorld } from '../world/origin';

/** What the camera follows: a body's reference point, its heading, its up and its size, read fresh every frame. */
export interface FollowTarget {
  readonly at: WorldPoint;
  /** Above mean sea level, world units. */
  readonly height: number;
  /** Actor convention: ahead is (sin heading, cos heading) on the surface the body stands on (`creatures/surface.ts`, `aheadOn`). */
  readonly heading: number;
  /**
   * The unit normal of what the body stands on (`CreatureState.up`):
   * `WORLD_UP` on the ground and in the air, a wall's or a ceiling's on
   * one. The orbit is measured off it — behind along the face, up along
   * its normal — so a camera on a climbing ant is out from the wall
   * and not inside it (Creature Lab D).
   */
  readonly up: Vec3;
  /** THIS individual's body length, world units — what every distance here is measured in. */
  readonly lengthUnits: number;
}

/** One frame of look-drag, pixels. */
export interface LookDelta {
  readonly dx: number;
  readonly dy: number;
}

/** A look a caller may write into, so `lookDeltaOf` allocates nothing. */
export interface MutableLook {
  dx: number;
  dy: number;
}

export const NO_LOOK: LookDelta = Object.freeze({ dx: 0, dy: 0 });

/**
 * The frame's look-drag out of the raw snapshot: the pointer's travel
 * while its button is down, plus every touch's — the same sum the
 * free-fly camera takes. The stick's ring swallows its own pointer
 * events (`input/MoveStick.ts`), so no push reaches here as a drag; and
 * a tap has no travel, so a pick is never a look.
 */
export function lookDeltaOf(input: InputSnapshot, out: MutableLook): LookDelta {
  let dx = 0;
  let dy = 0;
  if (input.pointer.down) {
    dx += input.pointer.dx;
    dy += input.pointer.dy;
  }
  const touches = input.touches;
  for (let i = 0; i < touches.length; i += 1) {
    dx += touches[i].dx;
    dy += touches[i].dy;
  }
  out.dx = dx;
  out.dy = dy;
  return out;
}

// ---------------------------------------------------------------------------
// The framing, in body lengths. GAME TUNING (the header).
// ---------------------------------------------------------------------------

/** How far behind the creature the eye rests, body lengths. */
export const BACK_LENGTHS = 4;
/** How far above it, body lengths. */
export const UP_LENGTHS = 1.5;
/** How far ahead of the creature the lens is aimed, body lengths: room to see where it is going. */
export const AHEAD_LENGTHS = 1;
/** The orbit's radius, body lengths — the rest offset's length, held at every elevation so a drag up or down keeps the animal the same size. */
export const ORBIT_LENGTHS = Math.hypot(BACK_LENGTHS, UP_LENGTHS);
/** The rest elevation above the horizon, radians: what four back and one and a half up make. About 20.6°. */
export const REST_ELEVATION = Math.atan2(UP_LENGTHS, BACK_LENGTHS);
/**
 * The elevation's range, radians. The floor is just above the creature's
 * own plane — a walker's plane is the ground, and a lens under it sees
 * the underside of the world; the ceiling stops short of straight down,
 * where a look-at about world-up has no answer.
 */
export const ELEVATION_MIN = 0.03;
export const ELEVATION_MAX = 1.45;

/** The perf world's near-plane floor, world units (1 mm), and its cap — `PerformanceWorldScene`'s own. */
export const MIN_NEAR = 0.1;
export const MAX_NEAR = 120;
/** Far over near, `adaptDepth`'s ratio: the depth the buffer is asked to resolve, in near-planes. */
export const DEPTH_RATIO = 60_000;
/** The glass sits this fraction of the orbit radius ahead of the eye. GAME TUNING: a twentieth is well inside the aim and well outside the eye. */
export const NEAR_OF_ORBIT = 1 / 20;
/** The orbit never closes under this, world units: four near-planes, so the near plane can never eat the animal. */
export const MIN_ORBIT = MIN_NEAR * 4;

/** Radians of orbit per pixel of drag: the free-fly camera's own feel, restated because that file keeps it private. */
export const LOOK_RADIANS_PER_PIXEL = 0.0035;
/** The lens follows the wanted angles with this time constant, seconds: brisk, and enough to take a thumb's jitter out. */
export const EASE_TAU_S = 0.08;
/** How long after the last drag the orbit is held before it drifts back, seconds. */
export const LOOK_HOLD_S = 1.5;
/** The drift back onto the creature's heading, as a time constant, seconds. */
export const DRIFT_TAU_S = 1.2;
/** How long a switch between creatures takes to blend, seconds (the brief, §4: "camera hands off cleanly"). */
export const HANDOFF_S = 0.4;
/**
 * The residual rotation an edge leaves on the lens eases to nothing
 * with this time constant, seconds. GAME TUNING: an edge is a quarter
 * turn, and a quarter turn of the eye in one frame is a cut; a quarter
 * of a second is four time constants inside a second — under two
 * degrees of a right angle left — so the eye is round the corner
 * before the ant has taken two strides on the next face.
 */
export const UP_EASE_S = 0.25;
/**
 * Within this of straight up or down, degrees, the world's up is no
 * longer an answer for `lookAt` and the view's own tangent is used
 * (the header). GAME TUNING: `ELEVATION_MAX` keeps the eye seven degrees
 * off the vertical and the view — aimed a length ahead of the body —
 * some twenty, on every face, so nothing a player does reaches it.
 */
export const VERTICAL_LOOK_DEGREES = 5;
/** The cosine of that angle: what the view's component along world up is compared with. */
const VERTICAL_LOOK_COS = Math.cos((VERTICAL_LOOK_DEGREES * Math.PI) / 180);
/** A residual whose half-angle's cosine is within this of one is the identity: under three microradians, snapped so an ease has an end. */
const RESIDUAL_SETTLED = 1e-12;

const IDENTITY = new THREE.Quaternion();

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Zero slope at both ends: the shape that makes a handoff start and finish without a cut. */
function smoothstep(t: number): number {
  const s = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return s * s * (3 - 2 * s);
}

/** The fraction of a gap an exponential ease closes in `dt` at time constant `tau`. */
function closes(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/** The near plane a target of this orbit radius gets. */
function nearFor(orbit: number): number {
  return Math.min(MAX_NEAR, Math.max(MIN_NEAR, orbit * NEAR_OF_ORBIT));
}

/** The pose a handoff blends FROM: where the lens and its aim were, in world coordinates, and the glass it had. */
interface BlendStart {
  readonly at: WorldPoint;
  readonly height: number;
  readonly aimAt: WorldPoint;
  readonly aimHeight: number;
  readonly near: number;
}

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** The bearing the player is asking to look along (actor convention) and the elevation above the horizon. */
  private wantHeading = 0;
  private wantElevation = REST_ELEVATION;
  /** Where the lens actually is on its orbit, easing toward the two above. */
  private viewHeading = 0;
  private elevation = REST_ELEVATION;
  /** Seconds since the last drag; the drift starts at `LOOK_HOLD_S`. */
  private sinceLook = LOOK_HOLD_S;
  /** The target's up as last seen, so a change of face — and the re-expression of both bearings — is detected by value. The frame the bearings are measured in. */
  private readonly lastUp: MutableVec3 = { x: SURFACE_UP.x, y: SURFACE_UP.y, z: SURFACE_UP.z };
  /** The residual rotation an edge left on the lens (the header): the identity on the ground and once an edge has eased away. */
  private readonly residual = new THREE.Quaternion();
  /** The view's up and ahead this frame: the target's frame turned by the residual. `WORLD_UP` and (sin h, 0, cos h) exactly on the ground. */
  private readonly viewUp: MutableVec3 = { x: SURFACE_UP.x, y: SURFACE_UP.y, z: SURFACE_UP.z };
  private readonly aheadView: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** Scratch for an edge: a direction carried across it, the new frame's three axes, and the rotation between the two frames. */
  private readonly carried: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly e1: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly e2: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly e3: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly basis = new THREE.Matrix4();
  private readonly edge = new THREE.Quaternion();
  private readonly turned = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3();
  private readonly axisZ = new THREE.Vector3();
  private look: LookTuning = { sensitivity: 1, invertY: false };

  /** Whether the lens has ever been placed: the first target is snapped to, not blended from the origin. */
  private hasPose = false;
  private blend: BlendStart | null = null;
  private blendT = 0;

  /** The near plane in force, and the one the projection was last built with. */
  private near = MIN_NEAR;
  private builtNear = 0;

  /** Reused every frame: the eye and the aim in render coordinates, and a scratch direction. */
  private readonly eye = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(fov = 60) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, MIN_NEAR, MIN_NEAR * DEPTH_RATIO);
    this.camera.up.copy(WORLD_UP);
    this.builtNear = MIN_NEAR;
  }

  /**
   * The yaw `PlayerDemand` steers toward: the WANTED bearing, in the
   * free-fly camera's yaw convention — not the lens's measured one (the
   * header).
   */
  get yaw(): number {
    return yawForHeading(this.wantHeading);
  }

  /**
   * THE WANTED LOOK AS A DIRECTION: the unit vector of the bearing the
   * player is asking to look along, tangent to the lens's own up — what
   * `PlayerDemand.demandFromLook` projects onto the body's face. The
   * wanted bearing and not the lens's measured one, for the header's
   * reason (`yaw`). On the ground it is `(sin wantHeading, 0, cos
   * wantHeading)` exactly, the direction `headingOfYaw(yaw)` names; on a
   * wall or a ceiling it is the same bearing carried onto that face
   * (`creatures/surface.ts`, `aheadOn`) and turned by the residual an
   * edge left, so across an edge it turns with the eye and never jumps.
   */
  wantedLook(into: MutableVec3): Vec3 {
    aheadOn(this.lastUp, this.wantHeading, into);
    return this.turnByResidual(into);
  }

  /** Whether a handoff blend is still running: a HUD may say so, a test does. */
  get blending(): boolean {
    return this.blend !== null;
  }

  /** A non-finite or non-positive sensitivity is ignored; the flag is always taken. */
  setLook(tuning: LookTuning): void {
    const sane = Number.isFinite(tuning.sensitivity) && tuning.sensitivity > 0;
    this.look = { sensitivity: sane ? tuning.sensitivity : this.look.sensitivity, invertY: tuning.invertY };
  }

  /** Vertical field of view in degrees. Out-of-range values are ignored; an unchanged value costs nothing. */
  setFov(degrees: number): void {
    if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) return;
    if (this.camera.fov === degrees) return;
    this.camera.fov = degrees;
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * SWITCH CREATURES. Starts the handoff blend from wherever the lens is
   * now to the new creature's rest pose, and resets the orbit to rest
   * behind it. On a lens that has never been placed there is nothing to
   * blend from, and the first `update` snaps. A target with a number
   * missing is ignored outright, as a bad pose is by the free-fly
   * camera's `restore`.
   */
  retarget(target: FollowTarget): void {
    if (!this.finiteTarget(target)) return;
    if (this.hasPose) {
      const p = this.camera.position;
      const a = this.aim;
      this.blend = {
        at: toWorld(local(p.x, p.z)),
        height: p.y,
        aimAt: toWorld(local(a.x, a.z)),
        aimHeight: a.y,
        near: this.near,
      };
      this.blendT = 0;
    }
    this.wantHeading = this.viewHeading = wrapHeading(target.heading);
    this.wantElevation = this.elevation = REST_ELEVATION;
    this.sinceLook = LOOK_HOLD_S;
    // The frame snaps to the new creature's: the handoff blend covers the eye.
    this.setUp(target.up);
  }

  /**
   * One frame. `dt` is whatever clock the owner chooses; a dt that is
   * not a positive finite number moves no angle and advances no blend,
   * but the lens is still placed off the target — a paused world still
   * has its camera on its creature.
   */
  update(dt: number, target: FollowTarget, look: LookDelta = NO_LOOK): void {
    if (!this.finiteTarget(target)) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

    // 0. THE EDGE. A target whose up is not the one last seen has wrapped
    // an edge (or is the first target this lens has ever had). A bearing
    // is a number in its up's own plane, so both bearings are carried
    // into the new frame by the rotation that carried the body's ahead
    // — `h' = headingOn(new, R(old → new) · aheadOn(old, h))` — and the
    // residual takes on the INVERSE of the rotation between the two
    // frames, so the eye and the look are exactly where they were on
    // this frame and ease round over `UP_EASE_S` (the header). Compared
    // by value: the integrator hands out the shared frozen normals, but
    // a copy must read the same.
    const up = target.up;
    const last = this.lastUp;
    if (!this.hasPose) {
      this.setUp(up);
    } else if (up.x !== last.x || up.y !== last.y || up.z !== last.z) {
      this.wantHeading = this.reexpress(last, up, this.wantHeading);
      this.viewHeading = this.reexpress(last, up, this.viewHeading);
      this.frameChange(last, up, this.edge);
      this.residual.multiply(this.edge);
      last.x = up.x;
      last.y = up.y;
      last.z = up.z;
    }

    // 1. THE LOOK: the drag writes the wanted angles. Dragging right
    // turns the view clockwise, as it does on the free-fly camera
    // (`yaw -= dx`); dragging down looks further down, which on an orbit
    // means the eye RISES — `invertY` flips that, a follow camera reading
    // the same flag the other way round is what `LookTuning` allows for.
    const dx = Number.isFinite(look.dx) ? look.dx : 0;
    const dy = Number.isFinite(look.dy) ? look.dy : 0;
    if (dx !== 0 || dy !== 0) {
      const turn = LOOK_RADIANS_PER_PIXEL * this.look.sensitivity;
      const sign = this.look.invertY ? -1 : 1;
      this.wantHeading = wrapHeading(this.wantHeading - dx * turn);
      this.wantElevation = Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, this.wantElevation + dy * turn * sign));
      this.sinceLook = 0;
    } else {
      this.sinceLook += step;
    }

    // 2. THE DRIFT, once the player has let go for the hold: back onto
    // the creature's heading and the rest elevation.
    if (step > 0 && this.sinceLook >= LOOK_HOLD_S) {
      const k = closes(step, DRIFT_TAU_S);
      this.wantHeading = wrapHeading(this.wantHeading + wrapHeading(target.heading - this.wantHeading) * k);
      this.wantElevation += (REST_ELEVATION - this.wantElevation) * k;
    }

    // 3. THE EASE of the lens onto the wanted angles; a first placement snaps.
    if (this.hasPose && step > 0) {
      const k = closes(step, EASE_TAU_S);
      this.viewHeading = wrapHeading(this.viewHeading + wrapHeading(this.wantHeading - this.viewHeading) * k);
      this.elevation += (this.wantElevation - this.elevation) * k;
    } else if (!this.hasPose) {
      this.viewHeading = this.wantHeading;
      this.elevation = this.wantElevation;
    }

    // 3b. THE EASE OF THE RESIDUAL toward the identity: a slerp, which
    // scales the angle an edge left by e^(−dt/τ) about the same axis.
    // On the ground the residual IS the identity and nothing here runs.
    const residual = this.residual;
    if (step > 0 && residual.w !== 1) {
      residual.slerp(IDENTITY, closes(step, UP_EASE_S));
      if (1 - Math.abs(residual.w) < RESIDUAL_SETTLED) residual.identity();
    }

    // 4. THE POSE, off the creature's live position: the eye on its
    // orbit behind the view bearing along the face and out along the
    // face's up, both turned by the residual; the aim a length ahead
    // along the face at the body's own height. On the ground `aheadView`
    // is (sin h, 0, cos h) and the up (0, 1, 0), and these are the old
    // sums to the bit. `toLocal` is the one door from a world position
    // to a rendered one.
    const length = target.lengthUnits;
    const orbit = Math.max(MIN_ORBIT, ORBIT_LENGTHS * length);
    const here = toLocal(target.at);
    const ahead = this.turnByResidual(aheadOn(up, this.viewHeading, this.aheadView));
    const vu = this.viewUp;
    vu.x = up.x;
    vu.y = up.y;
    vu.z = up.z;
    this.turnByResidual(vu);
    const flat = Math.cos(this.elevation) * orbit;
    const rise = Math.sin(this.elevation) * orbit;
    const reach = AHEAD_LENGTHS * length;
    this.aim.set(here.lx + ahead.x * reach, target.height + ahead.y * reach, here.lz + ahead.z * reach);
    this.eye.set(
      here.lx - ahead.x * flat + vu.x * rise,
      target.height - ahead.y * flat + vu.y * rise,
      here.lz - ahead.z * flat + vu.z * rise,
    );
    let near = nearFor(orbit);

    // 5. THE HANDOFF: a smoothstep from the remembered pose to this one.
    // The glass blends in log space, since a near plane is a ratio.
    const blend = this.blend;
    if (blend !== null) {
      const s = smoothstep(this.blendT / HANDOFF_S);
      const from = toLocal(blend.at);
      const fromAim = toLocal(blend.aimAt);
      this.eye.set(
        from.lx + (this.eye.x - from.lx) * s,
        blend.height + (this.eye.y - blend.height) * s,
        from.lz + (this.eye.z - from.lz) * s,
      );
      this.aim.set(
        fromAim.lx + (this.aim.x - fromAim.lx) * s,
        blend.aimHeight + (this.aim.y - blend.aimHeight) * s,
        fromAim.lz + (this.aim.z - fromAim.lz) * s,
      );
      near = Math.exp(Math.log(blend.near) + (Math.log(near) - Math.log(blend.near)) * s);
      this.blendT += step;
      if (this.blendT >= HANDOFF_S) this.blend = null;
    }

    // 6. COMMIT. The look-at is about the world's up — an ant on the
    // ceiling appears upside down, which is what it is — unless the view
    // runs within `VERTICAL_LOOK_DEGREES` of the vertical, where world up
    // and the view are parallel and `lookAt` would have to invent a
    // roll; then the tangent the view runs along is the up, and the
    // picture is defined (the header).
    this.dir.subVectors(this.aim, this.eye);
    const along = this.dir.length();
    if (along > 0 && Math.abs(this.dir.y) > VERTICAL_LOOK_COS * along) {
      this.camera.up.set(ahead.x, ahead.y, ahead.z);
    } else {
      this.camera.up.copy(WORLD_UP);
    }
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.aim);
    this.setNear(near);
    this.hasPose = true;
  }

  /**
   * Lift the eye to a height if it is below it, re-aimed at what it was
   * looking at, and otherwise leave it exactly where it is — a floor,
   * not a placement, as `FreeFlyCamera.holdAbove` is: the scene knows
   * the ground and this camera does not. A non-finite floor is ignored.
   */
  holdAbove(height: number): void {
    if (!Number.isFinite(height) || !this.hasPose) return;
    if (this.camera.position.y >= height) return;
    this.camera.position.y = height;
    this.camera.lookAt(this.aim);
  }

  /**
   * Where the lens is and which way it looks, as a save or a HUD wants
   * it: a WorldPoint and a height, because a pose outlives the frame,
   * and the yaw and pitch in the free-fly camera's convention — read off
   * the lens's actual direction, so a HUD prints what is on the screen
   * and not what was asked for.
   */
  pose(): CameraPose {
    const p = this.camera.position;
    this.camera.getWorldDirection(this.dir);
    const d = this.dir;
    return {
      at: toWorld(local(p.x, p.z)),
      height: p.y,
      yaw: Math.atan2(-d.x, -d.z),
      pitch: Math.asin(Math.min(1, Math.max(-1, d.y))),
    };
  }

  /** The heading the lens actually looks along, actor convention — the HUD's facing line. */
  facing(): number {
    return headingOfYaw(this.pose().yaw);
  }

  private setNear(near: number): void {
    this.near = near;
    if (near === this.builtNear) return;
    this.builtNear = near;
    this.camera.near = near;
    this.camera.far = near * DEPTH_RATIO;
    this.camera.updateProjectionMatrix();
  }

  /** Snap the frame to a target's with no residual: a retarget, a first placement. */
  private setUp(up: Vec3): void {
    this.lastUp.x = up.x;
    this.lastUp.y = up.y;
    this.lastUp.z = up.z;
    this.residual.identity();
  }

  /** A bearing measured in `from`'s plane, re-expressed in `to`'s: the same direction carried across the edge by the body's own rotation. */
  private reexpress(from: Vec3, to: Vec3, heading: number): number {
    aheadOn(from, heading, this.carried);
    rotateBetween(from, to, this.carried, this.carried);
    return headingOn(to, this.carried);
  }

  /**
   * THE INVERSE OF THE EDGE, as a quaternion: the rotation that takes
   * the new frame's axes back onto the old one's, so that applied to
   * anything measured in the new frame it reads as it did in the old.
   * Built from `rotateBetween` on the three axes and read off as a
   * matrix, rather than from an axis and an angle restated here, so the
   * one antiparallel choice `creatures/surface.ts` fixes is the one
   * this lens makes too.
   */
  private frameChange(from: Vec3, to: Vec3, out: THREE.Quaternion): void {
    const e1 = rotateBetween(from, to, FACE_NORMALS[0], this.e1);
    const e2 = rotateBetween(from, to, FACE_NORMALS[2], this.e2);
    const e3 = rotateBetween(from, to, FACE_NORMALS[4], this.e3);
    this.basis.makeBasis(
      this.turned.set(e1.x, e1.y, e1.z),
      this.axisY.set(e2.x, e2.y, e2.z),
      this.axisZ.set(e3.x, e3.y, e3.z),
    );
    out.setFromRotationMatrix(this.basis).conjugate();
  }

  /** `v` turned by the residual, in place. The identity leaves it untouched to the bit — the ground's case. */
  private turnByResidual(v: MutableVec3): MutableVec3 {
    if (this.residual.w === 1) return v;
    this.turned.set(v.x, v.y, v.z).applyQuaternion(this.residual);
    v.x = this.turned.x;
    v.y = this.turned.y;
    v.z = this.turned.z;
    return v;
  }

  private finiteTarget(target: FollowTarget): boolean {
    return Number.isFinite(target.at.wx) && Number.isFinite(target.at.wz)
      && Number.isFinite(target.height) && Number.isFinite(target.heading)
      && Number.isFinite(target.lengthUnits) && target.lengthUnits > 0
      && Number.isFinite(target.up.x) && Number.isFinite(target.up.y) && Number.isFinite(target.up.z);
  }
}
