/**
 * HOW HIGH THE CRESTS ARE STANDING, AND HOW HIGH SHE HAS TO BE.
 *
 * Joshua, 2026-08-31: "when flying over the ocean, it should get the max
 * wave height + 1m for a safe margin between the waves and ant. So if
 * it's +1.2m / -1.2m / 0 = sea level, it should be at +2.2m AWL with a
 * 3s sampling so it doesn't dip into a wave."
 *
 * WHY 55 CM WAS NEVER GOING TO BE ENOUGH. The autopilot's floor is
 * measured against the DRAWN floor, and over the sea the drawn floor is
 * the water's own surface — but a DAMPED one, deliberately, because
 * flying against the instantaneous sea made her chase every 1.5 s crest
 * ("like turbulence or drunken bobbing"). So she holds 55 cm over a
 * surface that is roughly mean water, and a crest that stands a metre
 * over mean water goes straight through her.
 *
 * IT MEASURES RATHER THAN MODELS. Nothing here knows about swell
 * periods, wave tables or shoaling: it is fed the gap between the TRUE
 * surface under her and the damped reference she flies against, every
 * frame, and remembers the biggest one it has seen lately. That number
 * is the crest height by construction, it already includes shoaling
 * near the beach where the waves grow, and it cannot drift out of step
 * with the ocean because it IS the ocean.
 *
 * AND IT REMEMBERS ON THE WORLD'S CLOCK, not hers. The sea is not
 * boosted — the travel scale is one ant travelling quickly through a
 * world going about its business — so three seconds means three of the
 * world's, which is about two full swell periods. Feeding it her
 * boosted time would shrink the window to a third of a period and it
 * would routinely miss the crest it exists to find.
 */

/**
 * Air kept between the highest crest and her, world units.
 *
 * Joshua's metre. Game tuning rather than measured biology, and a
 * generous one on purpose: the cost of being a metre too high over open
 * water is nothing, and the cost of being ten centimetres too low is a
 * soaked queen waiting thirty seconds for her wings.
 */
export const SEA_MARGIN = 100;

/**
 * How long a crest is remembered, seconds of WORLD time.
 *
 * Joshua's number, and it lands well: the swell's components run at
 * about a second and a half, so three seconds is a couple of full
 * periods — long enough that the window has seen a peak, short enough
 * that it forgets one she has flown well past.
 */
export const SAMPLE_SECONDS = 3;

/**
 * Buckets the window is cut into.
 *
 * A ROLLING MAX NEEDS BUCKETS, not a single number that decays. A decay
 * makes the remembered crest depend on how long ago it was rather than
 * on whether it was inside the window, so a big wave three seconds ago
 * still lifts the answer a little for ever. Six half-second buckets
 * expire honestly: a crest is either in the last three seconds or it is
 * gone.
 */
const BUCKETS = 6;

/**
 * THE CRESTS SHE HAS SEEN LATELY.
 *
 * Fed the height of the true water surface above the reference she
 * flies against. Answers the largest of those over the window, and the
 * altitude that clears it.
 */
export class WaveWatch {
  private readonly seen = new Array<number>(BUCKETS).fill(0);
  private at = 0;
  private held = 0;

  /**
   * One frame of world time, and the crest standing over the reference
   * right now.
   *
   * Over land — or anywhere there is no water — the crest is simply
   * zero, and three seconds later the window says so. Nothing has to
   * tell it she has crossed a coast.
   */
  see(crest: number, worldDt: number): void {
    this.seen[this.at] = Math.max(this.seen[this.at], Math.max(0, crest));
    this.held += Math.max(0, worldDt);
    const each = SAMPLE_SECONDS / BUCKETS;
    while (this.held >= each) {
      this.held -= each;
      this.at = (this.at + 1) % BUCKETS;
      // The bucket rolling into view is the one that just fell out of
      // the window. Cleared rather than decayed — see BUCKETS.
      this.seen[this.at] = 0;
    }
  }

  /** The tallest crest in the window, world units above the reference. */
  get crest(): number {
    let top = 0;
    for (const seen of this.seen) top = Math.max(top, seen);
    return top;
  }

  /**
   * The least she should be flying at over this water, world units
   * above the reference — the crest plus the margin.
   *
   * Zero over dry land, where there is no crest and nothing to clear,
   * so a caller can take the max of this and its own floor without
   * asking whether she is over the sea.
   */
  get clearance(): number {
    const top = this.crest;
    return top > 0 ? top + SEA_MARGIN : 0;
  }

  /** Forget everything — a new queen, a new place. */
  reset(): void {
    this.seen.fill(0);
    this.at = 0;
    this.held = 0;
  }
}
