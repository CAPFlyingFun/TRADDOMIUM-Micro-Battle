/**
 * An Intent PRODUCER that follows a script: the bot peer's thumbs.
 *
 * The two-browser milestone (ARCHITECTURE §5) needs a second capsule
 * that moves on its own so one browser can watch replication work. It
 * is fed exactly what the player's capsule is fed — an Intent per frame
 * into `Transform.step` — so the authority, the replica and the view
 * cannot tell a bot from a person. That is the whole point of one
 * movement shape (input/Intent.ts): the mover is a sibling of the
 * thumbs, and the autonomy of Phase 9 will stand in the same place.
 *
 * The script is a loop of LEGS, each an intent held for so many seconds
 * (`routes.ts` builds the circle and figure-eight). Open-loop on
 * purpose: it never reads the actor's state, so it owns only its own
 * clock and stays pure. Where the actor ends up is the transform's
 * business — and a test can prove a circle closes by driving the real
 * `step` with these intents.
 *
 * Time is SIM dt, handed in per frame (the clock clamps; this does
 * not), so a paused world (`dt` 0) holds the script where it is.
 */
import { NEUTRAL_INTENT, clampIntent, type Intent } from '../input/Intent';

export interface Leg {
  /** How long this intent is held. Must be positive: a zero-length leg would never be in force. */
  readonly seconds: number;
  readonly intent: Intent;
}

/** A pause is a leg of standing still. */
export function pauseLeg(seconds: number): Leg {
  return { seconds, intent: NEUTRAL_INTENT };
}

export class ScriptedMover {
  private readonly legs: readonly Leg[];
  private readonly ends: readonly number[];
  /** Seconds of one full loop. */
  readonly period: number;
  private time = 0;

  constructor(route: readonly Leg[]) {
    if (route.length === 0) throw new Error('ScriptedMover: a route needs at least one leg');
    const ends: number[] = [];
    let total = 0;
    // Clamped once here, so every intent handed out is inside the contract
    // by construction and `next` never allocates.
    this.legs = route.map((leg, i) => {
      if (!(Number.isFinite(leg.seconds) && leg.seconds > 0)) {
        throw new Error(`ScriptedMover: leg ${i} must last a positive number of seconds, got ${leg.seconds}`);
      }
      total += leg.seconds;
      ends.push(total);
      return { seconds: leg.seconds, intent: Object.freeze(clampIntent(leg.intent)) };
    });
    this.ends = ends;
    this.period = total;
  }

  /** Seconds into the current loop, 0 ≤ elapsed < period. */
  elapsed(): number {
    return this.time;
  }

  /**
   * The intent in force at the MIDDLE of a step of `dt` seconds, then the
   * clock advances. `Transform.step` holds one intent for the whole
   * step, so the fair reading of a step that straddles a leg boundary
   * is whichever leg owns more of it — and sampling the midpoint is also
   * immune to the float drift of adding sixtieths: 240 of them land a
   * hair under 4.0 s, which read at the step's start would hand a
   * four-second leg a 241st step and leave a circle open by one pace.
   * A non-finite or negative dt does not advance — a bot that stalls on
   * a bad clock is visible; a bot that leaps is a bug report about the
   * wrong module.
   */
  next(dt: number): Intent {
    const advance = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const intent = this.at((this.time + advance / 2) % this.period);
    this.time = (this.time + advance) % this.period;
    return intent;
  }

  /** Back to the first leg's first second. */
  reset(): void {
    this.time = 0;
  }

  /** The leg that owns second `t` of the loop. */
  private at(t: number): Intent {
    for (let i = 0; i < this.ends.length; i += 1) {
      if (t < this.ends[i]) return this.legs[i].intent;
    }
    // Float drift can leave `t` a hair under `period` yet past the last end; that is still the last leg.
    return this.legs[this.legs.length - 1].intent;
  }
}
