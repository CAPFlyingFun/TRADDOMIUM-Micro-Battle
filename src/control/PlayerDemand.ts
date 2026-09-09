/**
 * THE THUMBS' HALF OF THE SENTENCE — what a possessing player wants,
 * said in the ONE movement shape.
 *
 * Joshua's Creature Lab brief, §3 and §42: "AI says what it wants.
 * Player says what they want. The creature's locomotion decides how the
 * body achieves it." `creatures/demand.ts` is the AI's half (`demandOf`)
 * and the body (`applyDemand`); this file is the player's half. It reads
 * one frame of raw input — the snapshot `input/Input.ts` gathers, the
 * stick's reading, the Lab's buttons — and writes an `Intent`
 * (`input/Intent.ts`) in the CREATURE'S OWN HEADING FRAME, which is the
 * only frame the integrator reads. The species then interprets the
 * toggles (`demand.ts`, `playerDemand` and `wordFor`) and the ONE
 * integrator moves the body. Nothing here moves anything, and nothing
 * here knows which animal it is driving beyond its medium and whether it
 * has wings: that is what lets a worm, a fly and a queen be driven by
 * the same thumbs (the brief's §19-§22) without a controller each.
 *
 * MOVEMENT IS SETTLED (CLAUDE.md): "camera-relative stick, pace as a
 * CEILING, steering is looking." Each clause is a line below.
 *
 *   CAMERA-RELATIVE. A push up on the stick means AWAY FROM THE CAMERA,
 *   whichever way the creature happens to face — the stick means what
 *   the player sees, exactly as W and D do for the free-fly camera. The
 *   push is a vector in the camera's horizontal frame, turned into the
 *   creature's frame by the angle between the two headings, so a push
 *   toward the screen's top with the camera looking across the
 *   creature's side is a STRAFE for the body and reads as "that way" on
 *   the screen. Keys and stick add as vectors, as they do in
 *   `perf/FreeFlyCamera.ts`.
 *
 *   PACE AS A CEILING. The planar request is bounded to the unit disc,
 *   never the unit square: a full push with W held is one pace, not
 *   1.41 of them (the capsule's rule, `actor/Transform.ts`), and how far
 *   the stick is pushed is how much of the species' pace is asked for.
 *
 *   STEERING IS LOOKING. There is no turn control. While the player is
 *   driving, the body comes onto the camera's heading: `turn` is the
 *   shortest signed error between where the player looks and where the
 *   creature points, as a fraction of `STEER_SATURATION`, saturating at
 *   ±1 — the body turns at its species' full rate until it is within a
 *   quarter turn of the view, and eases onto it inside that. A
 *   proportional turn, not the AI's exact one (`demandOf` closes the gap
 *   in one frame when it can), because the AI knows `turnRadS × dt` and
 *   a pure mapping of a snapshot does not — and a first-order ease onto
 *   the view is the feel v0's ant shipped with and Joshua kept ("This
 *   one matches the Godot build, which is the reference",
 *   `legacy/v0-main:src/ant/PlayerAnt.ts`). A quarter turn keeps it
 *   stable for any species whose full-rate step in one frame is under
 *   90°, which at 30 fps is a turn rate of 47 rad/s — above the fly's
 *   own 30 in the air.
 *
 *   AT REST THE BODY IS LEFT ALONE. With nothing pushed the turn is
 *   zero whatever the camera does, so the player can orbit right round
 *   an animal and look at its face — a body that chased the camera onto
 *   its nose could never be looked at from the front (v0's REST_DEADZONE
 *   was the same lesson with a softer edge), and the follow camera's own
 *   drift-back (`FollowCamera.ts`) is what returns the pair to
 *   "behind" once the player lets go. It also makes "nothing pressed"
 *   exactly `NEUTRAL_INTENT`, which a test pins.
 *
 * THE STICK ON A WALL, AND UNDER A CEILING (Creature Lab D; Joshua,
 * 2026-09-09: "All the insects besides the worm need to be able to
 * climb vertical and upside down while sticking to the surface"). The
 * four clauses above were written for a body whose feet are on the
 * ground, where "the camera's horizontal frame" and "the creature's
 * frame" share a plane. On a wall they do not, and `demandFromLook` is
 * the same sentence said in the body's own frame (`creatures/surface.ts`):
 * the stick's AHEAD is the player's look projected onto the face the
 * body stands on, its RIGHT is the SCREEN'S right — the look × the
 * lens's up, which is the world's — projected onto the face, and the
 * push is a vector in THAT frame resolved onto the body's ahead and
 * right. So with the camera looking up the wall a push up walks up the
 * wall; with the camera looking along it a push up walks along it; and
 * on the CEILING the stick still means what the player sees: the way
 * the look runs across the ceiling is "up" on the stick, and "right" is
 * the right of the PICTURE — which is the upside-down body's LEFT hand.
 * That last clause is the whole reason the right is the screen's and
 * not the body's: a level picture of an ant on the ceiling has its
 * right hand at the screen's left, and a stick that moved it by its own
 * right would walk it to the screen's left — item 1's complaint on
 * another face. On the ground the two rights are one vector; on a
 * vertical wall the screen's right runs INTO the wall and has no
 * projection, so the body's own right stands there — the one frame the
 * player can read on a wall — and a push right walks a climbing ant to
 * ITS right, which for a look up the wall is also the picture's.
 * Steering is still looking, as the signed angle ABOUT THE FACE'S UP
 * from the body's ahead to the look's projection. A look with no projection —
 * the free camera staring straight at the wall, or a look that is not a
 * number — is read as no difference, exactly as `demandFrom` reads a
 * NaN yaw. With `up = +y` and a horizontal look every line of this is
 * `demandFrom`'s arithmetic to 1e-12, and a test holds the two together
 * over the whole grid: the flat case is the general one, and the old
 * function stands beside the new so the island's reading is the old
 * arithmetic in the old order.
 *
 * THE CAMERA'S YAW IS NOT A HEADING, and the half turn between them is
 * `perf/FreeFlyCamera.headingOfYaw` — used here rather than restated,
 * so this file never has to remember which of the two it is holding.
 * `cameraYaw` is the LOOK'S yaw — what the player is asking to see —
 * and not a bearing measured off the lens: the lens eases toward where
 * it is wanted, so a measured bearing moves as the body moves, which
 * closes a loop and curls a straight run into a circle (v0's own note,
 * `PlayerAnt.update`). `FollowCamera.yaw` is that number.
 *
 * WHAT THE MEDIUM DOES WITH THE VERTICAL (the brief, §19-§22). UP and
 * DOWN are the Lab's two buttons and, on a desktop, E/Space and Q/C —
 * the free-fly camera's own keys, and for its reason: the brief lists
 * Shift as both "down" and "sprint", sprint won there and it wins here,
 * so a Shift is a sprint and never a descent.
 *
 *   ground  ignores it — a walker's height is the ground's — UNLESS the
 *           species has wings: then UP on the ground is a takeoff
 *           request and the demand carries it (`wordFor` reads a
 *           vertical up on a grounded winged body as `takeoff`).
 *   soil    DOWN is burrow, UP is surface: the worm's two controls.
 *   air     DOWN is descend, UP is climb: the fly's direct 3-D flight.
 *   plant   ignores it. The aphid's way down is DROP / EVADE, which is
 *           `secondary`, carried through for `playerDemand` to turn into
 *           the fall.
 *
 * `primary` and `secondary` are toggles whose MEANING the species
 * decides (`input/Intent.ts`); this file only says whether they are
 * held — the Lab's two action buttons, or F and R on a keyboard.
 *
 * PURE AND ALLOCATION-FREE. A function of its arguments and nothing
 * else — no DOM, no camera object, no creature — so it runs in node
 * under vitest against synthetic snapshots. It writes into the
 * `MutableIntent` the caller keeps and returns it; a caller that hands
 * none in (a test) gets a fresh one. Every axis is bounded by
 * `clampAxis` before it is written, which is the bound `clampIntent`
 * applies, without building the second object — so what comes out is
 * `clampIntent` of itself, and a test holds it to that.
 */
import { newMutableIntent, type MutableIntent } from '../creatures/demand';
import { wrapHeading } from '../creatures/heading';
import type { Medium } from '../creatures/species';
import { WORLD_UP, aheadOn, cross, rightOn, signedAngleAbout, tangentOf, type MutableVec3, type Vec3 } from '../creatures/surface';
import type { InputSnapshot } from '../input/Input';
import { clampAxis, type Intent } from '../input/Intent';
import type { StickReading } from '../input/MoveStick';
import { headingOfYaw } from '../perf/FreeFlyCamera';

/**
 * The Lab's on-screen controls, as booleans the Lab's UI fills each
 * frame: UP and DOWN (the vertical), two action buttons, and SPRINT.
 * Defined here because this file is what reads them; the buttons
 * themselves are the Lab scene's to draw, and it draws only the ones
 * the possessed species can use ("an unavailable action must never look
 * functional", CLAUDE.md) — a worker gets no UP.
 */
export interface LabButtons {
  readonly up: boolean;
  readonly down: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly sprint: boolean;
}

/** Nothing pressed: what a scene with no buttons on screen hands in. */
export const NO_BUTTONS: LabButtons = Object.freeze({
  up: false, down: false, primary: false, secondary: false, sprint: false,
});

/**
 * The heading error at which the turn request saturates, radians. GAME
 * TUNING (the header): a quarter turn or more of error asks for the
 * species' full turn rate; inside it the request is proportional, which
 * is the ease onto the view.
 */
export const STEER_SATURATION = Math.PI / 2;

/**
 * The desktop keys, by what they mean. The movement and lift keys are
 * the free-fly camera's, unchanged, so a desktop hand that has flown the
 * perf world drives an ant the same way; F and R are the two action
 * buttons because E and Q are taken by the lift.
 */
export const KEYS = Object.freeze({
  ahead: Object.freeze(['KeyW', 'ArrowUp']),
  back: Object.freeze(['KeyS', 'ArrowDown']),
  left: Object.freeze(['KeyA', 'ArrowLeft']),
  right: Object.freeze(['KeyD', 'ArrowRight']),
  up: Object.freeze(['KeyE', 'Space']),
  down: Object.freeze(['KeyQ', 'KeyC']),
  sprint: Object.freeze(['ShiftLeft', 'ShiftRight']),
  primary: Object.freeze(['KeyF']),
  secondary: Object.freeze(['KeyR']),
});

/** Is any of these key codes down? An index loop, so a frame allocates no iterator. */
function anyHeld(keys: ReadonlySet<string>, codes: readonly string[]): boolean {
  for (let i = 0; i < codes.length; i += 1) if (keys.has(codes[i])) return true;
  return false;
}

/** −1, 0 or 1 from a pair of opposing holds; both held is neither. */
function axis(negative: boolean, positive: boolean): number {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

/** −1..1 of a ratio, with NaN as nothing: how much of the saturation angle an error is. */
function saturate(value: number): number {
  if (!(value === value)) return 0;
  return value > 1 ? 1 : value < -1 ? -1 : value;
}

/**
 * What the medium makes of a lift request: the vertical the demand
 * carries for a body of this medium, given whether it has wings (the
 * header's table). A pure rule, exported so the Lab's UI can ask the
 * same question when deciding which buttons to draw.
 */
export function verticalFor(medium: Medium, winged: boolean, lift: number): number {
  switch (medium) {
    case 'ground':
      return winged ? lift : 0;
    case 'soil':
    case 'air':
      return lift;
    case 'plant':
      return 0;
    default:
      return 0;
  }
}

/**
 * ONE FRAME OF THE PLAYER'S WANT, in the creature's heading frame.
 *
 * @param snapshot   the frame's raw input (`Input.snapshot()`): keys are
 *                   read; the pointer and touches are NOT — a drag is the
 *                   camera's to turn into a look, and a tap is a pick.
 * @param stick      the move stick's reading, or null where there is no
 *                   stick (a desktop rig, a test).
 * @param cameraYaw  the LOOK's yaw (`FollowCamera.yaw`), in the free-fly
 *                   camera's convention — a yaw, not a heading.
 * @param creatureHeading  the possessed body's heading, actor convention.
 * @param medium     the species' medium, which decides the vertical.
 * @param buttons    the Lab's on-screen controls this frame.
 * @param winged     whether the species carries a flight spec: a ground
 *                   body that can take off. Default false. Added beyond
 *                   the six the brief named because "ground ignores
 *                   vertical unless the species has flight" is a fact a
 *                   medium alone does not hold.
 * @param out        the intent to write into; the caller keeps one so a
 *                   frame allocates nothing. Omitted: a fresh one.
 */
export function demandFrom(
  snapshot: InputSnapshot,
  stick: StickReading | null,
  cameraYaw: number,
  creatureHeading: number,
  medium: Medium,
  buttons: LabButtons,
  winged = false,
  out: MutableIntent = newMutableIntent(),
): Intent {
  const keys = snapshot.keys;

  // THE PLANE REQUEST IN THE CAMERA'S FRAME: x across (right positive),
  // y along (away from the camera positive). Keys as unit steps, the
  // stick as read, added as vectors; a stick that is not a number is no
  // push, not a full one.
  let x = axis(anyHeld(keys, KEYS.left), anyHeld(keys, KEYS.right));
  let y = axis(anyHeld(keys, KEYS.back), anyHeld(keys, KEYS.ahead));
  if (stick !== null && Number.isFinite(stick.x) && Number.isFinite(stick.y)) {
    x += stick.x;
    y += stick.y;
  }
  // Pace as a ceiling: the unit disc, not the unit square.
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }
  const moving = magnitude > 0;

  // THE ANGLE BETWEEN THE TWO FRAMES. Ahead in a heading h is
  // (sin h, cos h) and RIGHT is ahead × up = (−cos h, sin h) — the
  // capsule's and `planeStep`'s rule, and the free-fly camera's own
  // right, so the stick's x here is the same x the camera walks on.
  // Resolving the camera-frame vector onto the creature's two axes is
  // the rotation by the difference of the headings: with the camera
  // ahead of the body by e, a push right lands part on the body's
  // forward (x sin e) and part on its right (x cos e). A yaw or a
  // heading that is not a number reads as no difference: the push is
  // taken in the creature's own frame and nothing turns.
  const view = headingOfYaw(cameraYaw);
  const error = Number.isFinite(view) && Number.isFinite(creatureHeading) ? wrapHeading(view - creatureHeading) : 0;
  const sin = Math.sin(error);
  const cos = Math.cos(error);
  const forward = y * cos + x * sin;
  const strafe = x * cos - y * sin;

  // Steering is looking, while driving; at rest the body is left alone.
  const turn = moving ? saturate(error / STEER_SATURATION) : 0;

  // The vertical, as the medium reads it.
  const up = buttons.up || anyHeld(keys, KEYS.up);
  const down = buttons.down || anyHeld(keys, KEYS.down);
  const vertical = verticalFor(medium, winged, axis(down, up));

  // `|| 0` turns a −0 out of the rotation into +0: a sign a test can
  // see and a body cannot, and "nothing pressed" must equal NEUTRAL.
  out.forward = clampAxis(forward) || 0;
  out.strafe = clampAxis(strafe) || 0;
  out.turn = clampAxis(turn) || 0;
  out.vertical = clampAxis(vertical) || 0;
  out.sprint = buttons.sprint || anyHeld(keys, KEYS.sprint);
  out.primary = buttons.primary || anyHeld(keys, KEYS.primary);
  out.secondary = buttons.secondary || anyHeld(keys, KEYS.secondary);
  return out;
}

/**
 * A tangent shorter than this has no direction: the look is along the
 * normal, or not a number. Well under any push a thumb can make, well
 * over the rounding a unit vector carries.
 */
const NO_PROJECTION = 1e-9;

/** Scratch the surface reading writes into, so a frame allocates nothing. */
const _aheadBody: MutableVec3 = { x: 0, y: 0, z: 0 };
const _rightBody: MutableVec3 = { x: 0, y: 0, z: 0 };
const _aheadLook: MutableVec3 = { x: 0, y: 0, z: 0 };
const _rightLook: MutableVec3 = { x: 0, y: 0, z: 0 };

/** A unit direction, or nearly: what `aheadOn` gives a finite heading on a finite up, and not what it gives a NaN (`|| 0` reads that as zero). */
function isDirection(v: Vec3): boolean {
  const len = Math.hypot(v.x, v.y, v.z);
  return Number.isFinite(len) && len > NO_PROJECTION;
}

/**
 * ONE FRAME OF THE PLAYER'S WANT, ON WHATEVER THE BODY STANDS ON. The
 * same sentence as `demandFrom` — camera-relative stick, pace as a
 * ceiling, steering is looking — said for a body whose feet may be on
 * a wall or a ceiling (Creature Lab D; Joshua's brief, §14). The
 * `look` is the direction the player is asking to see along, a unit
 * vector in world space (`FollowCamera.wantedLook`, or the free
 * camera's lens direction); the body's frame is its `heading` and its
 * `up` (`creatures/surface.ts`). The stick's "ahead" is the look
 * projected onto the body's surface, its "right" is that ahead × up,
 * and the turn is the signed angle about `up` from the body's ahead to
 * the look's projection, as a fraction of `STEER_SATURATION`. A look
 * straight along the normal (the free camera staring at the wall) has
 * no projection: the push is then taken in the body's own frame and
 * nothing turns, exactly as a NaN yaw is read by `demandFrom`.
 *
 * On the ground, with a horizontal look, this is `demandFrom` to
 * 1e-12 on every axis — the flat case is the general one with
 * `up = +y` — and a test holds the two together over the whole grid.
 * `demandFrom` keeps its own two-dimensional arithmetic rather than
 * delegating here, so the island's reading is the old sentence in the
 * old order and the agreement is a fact a test measures, not a tautology.
 */
export function demandFromLook(
  snapshot: InputSnapshot,
  stick: StickReading | null,
  look: Vec3,
  creatureHeading: number,
  creatureUp: Vec3,
  medium: Medium,
  buttons: LabButtons,
  winged = false,
  out: MutableIntent = newMutableIntent(),
): Intent {
  const keys = snapshot.keys;

  // THE PLANE REQUEST IN THE LOOK'S FRAME, exactly as `demandFrom` reads
  // it: x across (right positive), y along (away from the camera
  // positive), keys and stick as vectors, the unit disc as the ceiling.
  let x = axis(anyHeld(keys, KEYS.left), anyHeld(keys, KEYS.right));
  let y = axis(anyHeld(keys, KEYS.back), anyHeld(keys, KEYS.ahead));
  if (stick !== null && Number.isFinite(stick.x) && Number.isFinite(stick.y)) {
    x += stick.x;
    y += stick.y;
  }
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }
  const moving = magnitude > 0;

  // THE TWO FRAMES ON THE FACE. The body's ahead and right are the
  // heading carried onto its up (`aheadOn`, `rightOn`: on the ground
  // (sin h, 0, cos h) and (−cos h, 0, sin h), the capsule's rule). The
  // look's ahead is its projection onto the face, unit length; its
  // right is that ahead × up — the same construction, so on every face
  // the stick's x is the right hand of a body facing the way the player
  // looks. A look with no projection reads as the body's own ahead: no
  // difference, nothing turns, the push in the body's frame. A body
  // with no frame (a heading or an up that is not a number) reads the
  // look's frame as its own, which is what `demandFrom` does with a NaN
  // heading; neither frame is a push that goes nowhere.
  aheadOn(creatureUp, creatureHeading, _aheadBody);
  const bodyOk = isDirection(_aheadBody);
  tangentOf(creatureUp, look, _aheadLook);
  const projected = Math.hypot(_aheadLook.x, _aheadLook.y, _aheadLook.z);
  let lookOk = projected > NO_PROJECTION && Number.isFinite(projected);
  if (lookOk) {
    _aheadLook.x /= projected;
    _aheadLook.y /= projected;
    _aheadLook.z /= projected;
  } else if (bodyOk) {
    _aheadLook.x = _aheadBody.x;
    _aheadLook.y = _aheadBody.y;
    _aheadLook.z = _aheadBody.z;
  }
  if (!bodyOk && lookOk) {
    _aheadBody.x = _aheadLook.x;
    _aheadBody.y = _aheadLook.y;
    _aheadBody.z = _aheadLook.z;
  }
  const framed = bodyOk || lookOk;
  rightOn(creatureUp, _aheadBody, _rightBody);
  // THE STICK'S RIGHT IS THE SCREEN'S RIGHT where the face has one (the
  // header): the look × the lens's up — both lenses are world-up
  // (`FollowCamera`, `FreeFlyCamera`) — projected onto the face. On the
  // ground that is the look's ahead × up, the old arithmetic to the
  // bit; on the ceiling it is the OPPOSITE of the body's right; on a
  // vertical wall it runs along the normal and has no projection, and
  // the body's own right stands. (A look up a wall on a slant reads the
  // body's right too, since its screen-right is still along the normal;
  // that tilts the strafe with the climb, noted and not fixed.)
  cross(_aheadLook, WORLD_UP, _rightLook);
  tangentOf(creatureUp, _rightLook, _rightLook);
  const across = Math.hypot(_rightLook.x, _rightLook.y, _rightLook.z);
  if (across > NO_PROJECTION && Number.isFinite(across)) {
    _rightLook.x /= across;
    _rightLook.y /= across;
    _rightLook.z /= across;
  } else {
    rightOn(creatureUp, _aheadLook, _rightLook);
  }

  // THE PUSH AS A WORLD VECTOR, resolved onto the body's two axes: the
  // rotation by the angle between the two frames, written as dot
  // products because on a face the angle is about `up` and not +y.
  const wx = y * _aheadLook.x + x * _rightLook.x;
  const wy = y * _aheadLook.y + x * _rightLook.y;
  const wz = y * _aheadLook.z + x * _rightLook.z;
  const forward = framed ? wx * _aheadBody.x + wy * _aheadBody.y + wz * _aheadBody.z : 0;
  const strafe = framed ? wx * _rightBody.x + wy * _rightBody.y + wz * _rightBody.z : 0;

  // Steering is looking, while driving; at rest the body is left alone.
  // The error is the signed angle about the FACE'S up, so a positive
  // turn is a left turn on the floor, on a wall and on the ceiling
  // alike (`creatures/surface.ts`, the header).
  const turn = moving && lookOk && bodyOk ? saturate(signedAngleAbout(creatureUp, _aheadBody, _aheadLook) / STEER_SATURATION) : 0;

  // The vertical, as the medium reads it.
  const up = buttons.up || anyHeld(keys, KEYS.up);
  const down = buttons.down || anyHeld(keys, KEYS.down);
  const vertical = verticalFor(medium, winged, axis(down, up));

  // `|| 0` turns a −0 out of the dot products into +0, as `demandFrom`
  // does: "nothing pressed" must equal NEUTRAL on every face.
  out.forward = clampAxis(forward) || 0;
  out.strafe = clampAxis(strafe) || 0;
  out.turn = clampAxis(turn) || 0;
  out.vertical = clampAxis(vertical) || 0;
  out.sprint = buttons.sprint || anyHeld(keys, KEYS.sprint);
  out.primary = buttons.primary || anyHeld(keys, KEYS.primary);
  out.secondary = buttons.secondary || anyHeld(keys, KEYS.secondary);
  return out;
}
