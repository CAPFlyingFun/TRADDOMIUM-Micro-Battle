/**
 * THE ONE MOVEMENT INPUT SHAPE.
 *
 * Everything that wants an actor to move says it in this vocabulary,
 * and nothing that moves an actor reads anything else. Two producers:
 *
 *   input/Input.ts (the thumbs: stick, keys, look-drag) → Intent
 *   autonomy/       (mission brain, autopilot; Phase 9)  → Intent
 *
 * They are SIBLINGS (ARCHITECTURE §3, §11 phase 9). An autonomous ant
 * and a player-driven ant are the same actor fed by a different
 * producer, which is what lets a mission take over from the thumbs and
 * hand back without the actor noticing — and what lets the authority
 * treat a remote player's movement the same way. The shape is a
 * request, not a command: the actor's transform decides what it can
 * honour (pace as a CEILING, CLAUDE.md), and the intent only says which
 * way and how hard.
 *
 * Pure: no DOM. `Input.ts` beside this file is the DOM half; this file
 * is what actor/ is allowed to import.
 */

export interface Intent {
  /** −1 (back) .. 1 (ahead), in the actor's own heading frame. */
  readonly forward: number;
  /** −1 (left) .. 1 (right), in the actor's own heading frame. */
  readonly strafe: number;
  /** −1 (anticlockwise, seen from above) .. 1 (clockwise). */
  readonly turn: number;
  /** A toggle, not a magnitude: the transform's tuning says what it multiplies. */
  readonly sprint: boolean;
}

/** Standing still. The value every producer yields when it has nothing to say. */
export const NEUTRAL_INTENT: Intent = Object.freeze({ forward: 0, strafe: 0, turn: 0, sprint: false });

/** Clamp one axis to −1..1; anything non-finite is "no request", not "full ahead". */
function axis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * The bounds, enforced. A producer can hand over whatever arithmetic
 * gave it — a stick past its rim, a NaN from a divide — and the actor
 * still sees a request inside the contract.
 */
export function clampIntent(intent: Intent): Intent {
  return {
    forward: axis(intent.forward),
    strafe: axis(intent.strafe),
    turn: axis(intent.turn),
    sprint: intent.sprint === true,
  };
}
