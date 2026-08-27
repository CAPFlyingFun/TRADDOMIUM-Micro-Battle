/**
 * HER AIR — the meter that replaced a timer.
 *
 * NOT HER LUNGS, and this file said lungs until the biology reference
 * caught it. An ant has no lungs: air enters through spiracles along
 * her body and reaches the tissue through tracheae, and a submerged
 * one closes those spiracles and lives off the film held against her
 * cuticle. The HUD can keep saying O2 because that is readable
 * shorthand; the code should not keep saying something false.
 *
 * The dive used to last UNDER_FOR seconds, four of them, chosen
 * because a dive had to end somehow. A number with no meaning behind
 * it and nothing on screen to read: the player could not tell whether
 * they had three seconds left or none, so the surfacing always felt
 * like the game deciding rather than the ant running out.
 *
 * Her air reserve is a RESOURCE, and it satisfies the survival
 * invariant properly
 * — it only falls where it can be refilled, and the refill is the
 * surface, which is never more than a swim away. That is the whole
 * reason it can exist as a bar at all when health and food still
 * cannot.
 *
 * THE BIOLOGY IS GENEROUS AND THE GAME IS NOT, and the gap is stated
 * rather than hidden. A submerged fire ant closes its spiracles and
 * holds a film of air against its hydrophobic cuticle — a plastron —
 * and survives for HOURS; Mlot, Tovey & Hu (PNAS 2011) measured whole
 * rafts living off the same trick for weeks. Forty-five seconds is a
 * difficulty curve. It is here because a dive with no cost is not a
 * decision, and an ant that can sit on the bottom indefinitely makes
 * the river a road.
 *
 * What IS faithful is the shape: she does not drown when it runs out.
 * She floats, because she is a cork with legs, and she gets her breath
 * back at the top.
 *
 * RESURRECTED with the ocean-swimming pass, unchanged, the same way
 * wading.ts came back: it was removed with the water system it read,
 * not because it was wrong. It reads the new submersion signal now —
 * the scene decides "is her body under the surface" from wadeAt and
 * feeds the answer in, fresh water and sea alike.
 */

/**
 * How long she can stay under on one breath, in seconds.
 *
 * GAME TUNING, and by a wide margin — see the header. Long enough to
 * cross under something and look around; short enough that going down
 * is a choice with a clock on it.
 */
export const HOLD = 45;
/** GAME TUNING. See docs/FIRE_ANT_BIOLOGY.md §13 and §38. */

/**
 * How long a full breath takes to come back at the surface.
 *
 * Faster than it drains, on purpose. Waiting is not gameplay, and the
 * interesting decision is whether to go down, not how long to bob.
 */
export const REFILL = 12;
/** GAME TUNING. */

/**
 * Below this the gauge is warning her.
 *
 * A quarter — about eleven seconds left, which is enough to get back
 * up from anywhere she can reach on one breath.
 */
export const SHORT = 0.25;

/**
 * WHERE THE WORLD STARTS GOING DARK — thirty percent of a breath.
 *
 * Joshua: "if your O2 gets below 30%, the screen starts fading black
 * like a lot of games do." Hypoxia as a picture rather than a number:
 * the gauge warns the head, the darkness warns the gut.
 */
export const FADE_FROM = 0.3;
/**
 * How much of the world is gone at zero air. NOT all of it — "at 0%
 * you can still barely see" — because a screen gone fully black is a
 * screen the player cannot steer up out of, and up is the whole answer.
 */
export const FADE_TO = 0.86;
/**
 * What running dry costs, in health a second, ON TOP of anything the
 * salt is doing. She still cannot simply drown at the surface — an
 * empty film takes the dive lever away and buoyancy carries her up —
 * so this only bites while something keeps her genuinely under.
 */
export const DROWN_HP_PER_SECOND = 1;

/**
 * How dark the world should be for this much air, 0 (clear) to
 * FADE_TO (nearly gone). Quadratic in the shortfall so the first few
 * percent under FADE_FROM are a hint rather than a curtain, and the
 * last few are most of the effect — the shape of actually fainting.
 */
export function blackout(fraction: number): number {
  const short = 1 - Math.min(1, Math.max(0, fraction) / FADE_FROM);
  return short * short * FADE_TO;
}

export class Breath {
  private held = 1;

  /** How much air is left, 0 to 1. */
  get fraction(): number {
    return this.held;
  }

  /** Whether the gauge should be shouting. */
  get short(): boolean {
    return this.held < SHORT;
  }

  /** Whether she is out and has to go up. */
  get spent(): boolean {
    return this.held <= 0;
  }

  /**
   * @param submerged whether her head is under the surface
   * @returns what is left, for the caller that is about to draw it
   */
  update(submerged: boolean, dt: number): number {
    const per = submerged ? -1 / HOLD : 1 / REFILL;
    this.held = Math.min(1, Math.max(0, this.held + per * dt));
    return this.held;
  }

  /** A fresh queen, and scene resets. */
  fill(): void {
    this.held = 1;
  }

  /** Put a saved breath back. Clamped, like everything off a disk. */
  restore(to: number): void {
    this.held = Number.isFinite(to) ? Math.min(1, Math.max(0, to)) : 1;
  }
}
