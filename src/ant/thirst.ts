/**
 * WHAT SHE HAS DRUNK, and what it costs her not to.
 *
 * THE BAR WAS A PLACEHOLDER FOR THREE VERSIONS and the comment in
 * Vitals said exactly why: "it was live for a while, fed by a thirst
 * that drinking refilled; the water it drank from is gone, and a bar
 * may only move if there is a way to move it back." That is CLAUDE.md's
 * survival invariant, and it was the right call — a meter that only
 * falls is a countdown to a state she cannot avoid.
 *
 * There is water again, in a bed, that she can reach and stand in. So
 * the bar comes back, and it comes back with its refill in the same
 * change rather than a build later. Joshua: "still not recognizing it
 * as water to drink."
 *
 * The drain is the caste table's `thirstRate` over its `maxThirst`,
 * both of which have sat in castes.ts unread since they were written.
 * At her live growth stage that is a little over half an hour from full
 * to empty, walking or not — she is a small animal in the tropics and
 * the number is game tuning rather than measured biology.
 */
import { liveStat } from './castes';

/**
 * How long a drink takes to fill her from empty — eight seconds.
 *
 * Fast, deliberately. Drinking is an ACT: she stops, she is held in
 * place while she does it, and anything that interrupts her ends it.
 * A slow fill would mean standing still in the open for a minute at a
 * time, which is not a decision, it is a wait.
 */
const FILL_SECONDS = 8;
/**
 * She has to get back to a fifth before the parched latch clears.
 *
 * The same shape as stamina's: a latch that cleared the instant the
 * bar left zero would flicker in and out of the empty state on every
 * sip, and the state is meant to say "she is in trouble" rather than
 * "she is at zero this frame".
 */
const REARM_AT = 0.2;

export class Thirst {
  /** Full is 1, empty is 0. */
  private level = 1;
  private dry = false;

  get fraction(): number {
    return this.level;
  }

  /** True while she is properly thirsty, not merely below full. */
  get parched(): boolean {
    return this.dry;
  }

  /** Fractions a second she loses when she is not drinking. */
  get drain(): number {
    const most = liveStat('maxThirst');
    return most > 0 ? liveStat('thirstRate') / most : 0;
  }

  /** Put the reserve back where a save left it. */
  restore(fraction: number): void {
    this.level = Math.min(1, Math.max(0, fraction));
    this.dry = this.level < REARM_AT;
  }

  /**
   * Advance a frame. Returns true on the frame she runs dry, once, so
   * a caller can say something about it without watching for an edge
   * itself.
   */
  update(dt: number, drinking: boolean): boolean {
    const was = this.level;
    this.level = drinking
      ? Math.min(1, this.level + dt / FILL_SECONDS)
      : Math.max(0, this.level - this.drain * dt);
    if (this.level >= REARM_AT) this.dry = false;
    else if (this.level <= 0) this.dry = true;
    return was > 0 && this.level <= 0;
  }
}
