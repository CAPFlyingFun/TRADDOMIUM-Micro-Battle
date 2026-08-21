/**
 * SPAWN GRACE — five minutes where nothing can kill her, and she can
 * kill nothing.
 *
 * BOTH HALVES, ALWAYS. A shield on its own is five minutes of being
 * immortal in a fight you started, which is worse than no shield at
 * all. The price of not being killable is not being able to kill: she
 * can walk, fly, forage, dig and run, and that is it. That symmetry is
 * the whole rule, so `shielded` and `disarmed` are the same clock read
 * two ways rather than two flags that could drift apart.
 *
 * IT STARTS WHEN SHE ARRIVES, not when the last queen died. A timer
 * that ran while the player browsed the spawn map would be spent
 * before they got there, which protects nobody — and the point of it
 * is to survive the first minutes in a place you have never seen.
 *
 * Nothing can hurt her yet and she can hurt nothing, so today this is a
 * clock and a HUD chip. It exists now because a rule about combat is
 * far easier to honour when combat is written against it than when it
 * is bolted on afterwards.
 */

/** How long she is left alone for. */
export const GRACE_SECONDS = 300;

export class Grace {
  private left = 0;

  /** Fresh queen, fresh five minutes. */
  begin(): void {
    this.left = GRACE_SECONDS;
  }

  /** Counted in simulated seconds, like every other clock in the game. */
  update(dt: number): void {
    if (this.left > 0) this.left = Math.max(0, this.left - dt);
  }

  get active(): boolean {
    return this.left > 0;
  }

  get seconds(): number {
    return this.left;
  }

  /** Nothing may harm her. */
  get shielded(): boolean {
    return this.active;
  }

  /**
   * And she may harm nothing. The same clock, deliberately: read as one
   * value so no future change can protect her without also disarming
   * her.
   */
  get disarmed(): boolean {
    return this.active;
  }

  /** Give it up early — walking into a fight is a choice she can make. */
  end(): void {
    this.left = 0;
  }
}
