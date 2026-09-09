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
import type { Vec3 } from '../creatures/surface';
import type { InputSnapshot } from '../input/Input';
import { clampAxis, type Intent } from '../input/Intent';
import type { StickReading } from '../input/MoveStick';
import { headingOfYaw, yawForHeading } from '../perf/FreeFlyCamera';

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
 * On the ground, with a horizontal look, this is `demandFrom` to the
 * bit — the flat case is the general one with `up = +y` — and a test
 * holds the two together. CREATURE LAB D'S LEAF: until it lands, the
 * horizontal reading below stands (the look's bearing, `demandFrom`).
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
  void creatureUp;
  const flat = Math.hypot(look.x, look.z);
  const yaw = flat > 0 && Number.isFinite(flat) ? yawForHeading(Math.atan2(look.x, look.z)) : NaN;
  return demandFrom(snapshot, stick, yaw, creatureHeading, medium, buttons, winged, out);
}
