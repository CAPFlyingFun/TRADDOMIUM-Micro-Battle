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
 * WORLD-UP ALWAYS. The lens is aimed with `lookAt` about the world's up,
 * so no roll creeps in whatever the creature's pitch — a fly banking, a
 * worm nosing down. Surface traversal (a wall, an underside; the
 * brief's §14, Creature Lab D) is the phase that will want a camera
 * whose up is the surface's, and it is not this one.
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
import type { MutableVec3, Vec3 } from '../creatures/surface';
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
   * player is asking to look along, in the followed body's own surface
   * frame — what `PlayerDemand.demandFromLook` projects the stick onto.
   * The wanted bearing and not the lens's measured one, for the header's
   * reason (`yaw`). On the ground it is `(sin wantHeading, 0, cos
   * wantHeading)`, the direction `headingOfYaw(yaw)` names; on a wall or
   * a ceiling it is the same heading carried onto that face
   * (`creatures/surface.ts`, `aheadOn`) — Creature Lab D's leaf; until
   * it lands the horizontal reading stands.
   */
  wantedLook(into: MutableVec3): Vec3 {
    into.x = Math.sin(this.wantHeading);
    into.y = 0;
    into.z = Math.cos(this.wantHeading);
    return into;
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

    // 4. THE POSE, off the creature's live position: the eye on its
    // orbit behind the view bearing, the aim a length ahead along it.
    // `toLocal` is the one door from a world position to a rendered one.
    const length = target.lengthUnits;
    const orbit = Math.max(MIN_ORBIT, ORBIT_LENGTHS * length);
    const here = toLocal(target.at);
    const sin = Math.sin(this.viewHeading);
    const cos = Math.cos(this.viewHeading);
    const flat = Math.cos(this.elevation) * orbit;
    const rise = Math.sin(this.elevation) * orbit;
    this.aim.set(here.lx + sin * AHEAD_LENGTHS * length, target.height, here.lz + cos * AHEAD_LENGTHS * length);
    this.eye.set(here.lx - sin * flat, target.height + rise, here.lz - cos * flat);
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

    // 6. COMMIT.
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

  private finiteTarget(target: FollowTarget): boolean {
    return Number.isFinite(target.at.wx) && Number.isFinite(target.at.wz)
      && Number.isFinite(target.height) && Number.isFinite(target.heading)
      && Number.isFinite(target.lengthUnits) && target.lengthUnits > 0;
  }
}
