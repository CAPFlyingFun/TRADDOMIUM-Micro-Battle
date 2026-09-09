/**
 * THE ONE MOVEMENT INPUT SHAPE.
 *
 * Everything that wants an actor to move says it in this vocabulary,
 * and nothing that moves an actor reads anything else. Three producers,
 * each paired with the consumer that honours it:
 *
 *   input/Input.ts (the thumbs: stick, keys, look-drag) → Intent → actor/Transform.step
 *   autonomy/       (mission brain, autopilot; Phase 9)  → Intent → the same step
 *   creatures/demand.ts (an animal's brain, `demandOf`)  → Intent → creatures/demand.ts `applyDemand`
 *
 * They are SIBLINGS (ARCHITECTURE §3, §11 phase 9). An autonomous ant
 * and a player-driven ant are the same actor fed by a different
 * producer, which is what lets a mission take over from the thumbs and
 * hand back without the actor noticing — and what lets the authority
 * treat a remote player's movement the same way. The third pair is the
 * Creature Lab's whole architecture (Joshua's brief, §3 and §42): "AI
 * says what it wants. Player says what they want. The creature's
 * locomotion decides how the body achieves it." A creature's AI
 * produces an Intent from its target and its behaviour, a possessing
 * player produces one from the thumbs, and ONE integrator moves the
 * body — so there can be no tug-of-war, because there is only ever one
 * request on the table. The shape is a request, not a command: the
 * actor's transform decides what it can honour (pace as a CEILING,
 * CLAUDE.md), and the intent only says which way and how hard.
 *
 * THREE FIELDS ARRIVED WITH THE CREATURES, and they are OPTIONAL in the
 * type on purpose. `vertical` is a worm's burrow-down and surface-up, a
 * flier's descend and ascend; a walker ignores it. `primary` and
 * `secondary` are toggles whose MEANING the species decides — feed or
 * interact, drop or evade, take off or land — and the intent does not.
 * The capsule's producers (the practice bot's routes, the Network Lab's
 * thumbs) predate all three and have nothing to say about a vertical; a
 * shape that forced every producer to spell out three zeros would be a
 * change to files that do not move an ant. So absence reads as no
 * request, exactly the way a non-finite axis already does, and
 * `clampIntent` bounds what is present without inventing what is not.
 * `NEUTRAL_INTENT` spells all seven out, so a producer that starts from
 * it is complete.
 *
 * Pure: no DOM. `Input.ts` beside this file is the DOM half; this file
 * is what actor/ and creatures/ are allowed to import.
 */

export interface Intent {
  /** −1 (back) .. 1 (ahead), in the actor's own heading frame. */
  readonly forward: number;
  /**
   * −1 (left) .. 1 (right), in the actor's own heading frame — the
   * body's OWN right, ahead × up, which with +y up and ahead at
   * (sin h, cos h) is (−cos h, sin h). Not local +X: on every rig +X is
   * the left side (`fauna/gait.ts`), and the one day the two were
   * confused a possessed ant sidestepped the wrong way.
   */
  readonly strafe: number;
  /**
   * −1 (a right turn) .. 1 (a left turn). A positive turn GROWS the
   * heading, and a heading is a rotation about +y, so a positive turn is
   * anticlockwise seen from above (`world/coords.ts`, the compass's
   * note on why a bearing runs the other way).
   */
  readonly turn: number;
  /** A toggle, not a magnitude: the transform's tuning says what it multiplies. */
  readonly sprint: boolean;
  /**
   * −1 (down) .. 1 (up). A worm burrows down and surfaces up, a flier
   * descends and climbs, an aphid goes down and up its stem; a walker on
   * the ground ignores it. Absent: no request.
   */
  readonly vertical?: number;
  /** A toggle. What it does is the species' to say (feed, interact, take off); the intent only says it is held. Absent: not held. */
  readonly primary?: boolean;
  /** A second toggle, the same way (drop, evade, land). Absent: not held. */
  readonly secondary?: boolean;
}

/** Standing still. The value every producer yields when it has nothing to say. */
export const NEUTRAL_INTENT: Intent = Object.freeze({
  forward: 0, strafe: 0, turn: 0, sprint: false, vertical: 0, primary: false, secondary: false,
});

/** Clamp one axis to −1..1; anything non-finite is "no request", not "full ahead". */
export function clampAxis(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * The bounds, enforced. A producer can hand over whatever arithmetic
 * gave it — a stick past its rim, a NaN from a divide — and the actor
 * still sees a request inside the contract. The three optional fields
 * are bounded when they are present and left absent when they are not:
 * the clamp is a bound, not a claim about what the producer meant.
 */
export function clampIntent(intent: Intent): Intent {
  const out: {
    forward: number; strafe: number; turn: number; sprint: boolean;
    vertical?: number; primary?: boolean; secondary?: boolean;
  } = {
    forward: clampAxis(intent.forward),
    strafe: clampAxis(intent.strafe),
    turn: clampAxis(intent.turn),
    sprint: intent.sprint === true,
  };
  if (intent.vertical !== undefined) out.vertical = clampAxis(intent.vertical);
  if (intent.primary !== undefined) out.primary = intent.primary === true;
  if (intent.secondary !== undefined) out.secondary = intent.secondary === true;
  return out;
}
