/**
 * HER WATER, as a reserve that can finally move.
 *
 * `maxThirst` and `thirstRate` sat in the caste table from the start —
 * defined, growth-curved, state-scaled, and consumed by NOTHING. That
 * was the survival invariant holding the door: a bar may only move if
 * there is a way to move it back, and until drinking existed there was
 * not. Drinking exists now, so the drain switches on in the same commit
 * the refill does. They are one feature.
 *
 * THE FOUNDING STATE STILL DRINKS FOR FREE: its `thirstRate` scale is
 * zero in the table, which is the biology — a claustral queen seals
 * herself in and lives entirely off her own reserves. The drain arrives
 * with the first brood, exactly when the table says it does.
 *
 * Same shape as Stamina on purpose: a fraction, framerate-independent,
 * owned here and displayed elsewhere.
 */
import { liveStat } from './castes';

/**
 * Refill, in fractions of the bar a second.
 *
 * A real ant tanks up in tens of seconds; a player holding a button
 * wants single digits. Five seconds empty-to-full is long enough to be
 * an act — she is stopped, head down, drinking, exposed — and short
 * enough that nobody reads it as a loading bar.
 */
export const DRINK_RATE = 1 / 5;

/**
 * She cannot drink while the water is drinking HER. Past this much of
 * her own draft, the mouthparts are underwater and so is she.
 */
export const TOO_DEEP = 0.6;

export class Thirst {
  private level = 1;

  /**
   * One frame of living, and possibly drinking.
   *
   * @param drinking whether she is at water and holding the button
   * @returns the fraction, for whoever is drawing it
   */
  update(drinking: boolean, dt: number): number {
    if (drinking) {
      this.level = Math.min(1, this.level + DRINK_RATE * dt);
      return this.level;
    }
    // The table speaks in points a second at full size; the bar is a
    // fraction of maxThirst, so the rate is divided through by it. The
    // founding state zeroes the rate in the table itself.
    const drain = liveStat('thirstRate') / Math.max(1, liveStat('maxThirst'));
    this.level = Math.max(0, this.level - drain * dt);
    return this.level;
  }

  get fraction(): number {
    return this.level;
  }

  /** Full again — a respawn. */
  refill(): void {
    this.level = 1;
  }

  /**
   * Empty NOW — the debug kill's little sibling. The natural drain is
   * half an hour, which is right for the game and useless for a probe
   * that has to watch the bar move; reachable from __island only.
   */
  parch(): void {
    this.level = 0;
  }

  /**
   * Empty is a STATE, not yet a consequence. What an empty water bar
   * does to her — slowed, weakened, eventually dying — is its own
   * feature with its own card; shipping a death before the player has
   * learned where water IS would be the invariant broken the other way.
   */
  get parched(): boolean {
    return this.level <= 0;
  }
}
