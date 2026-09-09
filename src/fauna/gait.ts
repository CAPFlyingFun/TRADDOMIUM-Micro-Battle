/**
 * THE SIX-LEG TRIPOD, AS ARITHMETIC — no bone, no three, no clock.
 *
 * A walking insect keeps three feet on the ground while the other three
 * swing forward: the front and hind legs of one side with the middle
 * leg of the other (L1/R2/L3 against R1/L2/R3), the two triangles
 * alternating so the body is always standing on a tripod. That is the
 * alternating tripod gait (BIOLOGICAL SHAPE: the gait every fast-walking
 * hexapod uses — Hughes 1952 on the cockroach; Wilson 1966, "Insect
 * walking", for the general rule; Zollikofer 1994 for ants, where it
 * holds across a fivefold range of speed), and it is the ONE fact this
 * file is built on: at any moment exactly one tripod is in swing.
 *
 * Everything is a function of one number, the fraction of a stride the
 * body has completed, so a leg's state can be asked at any instant and
 * never remembered between frames — the renderer's own rule
 * (ARCHITECTURE §2.3): derived from a measured fact each frame, not
 * transitioned by hand. The measured fact is DISTANCE walked, in body
 * lengths, not time: an animal that slows does not moonwalk and one that
 * stops has still feet, because a stride that does not advance is a
 * stride that does not happen. The frequency a stride would have at a
 * given speed is derived from that (`strideFrequency`) for anything
 * that wants a rate rather than a phase.
 *
 * ─── the numbers ────────────────────────────────────────────────────
 *
 * `STRIDE_LENGTHS` is how far the body travels in one full cycle (both
 * tripods), in body lengths. GAME TUNING at the brief's ~0.4 (§27). It
 * is of the right order — Zollikofer 1994 measured Cataglyphis stride
 * lengths of about a body length at full speed and shorter at a walk —
 * and it is tuning because the two ants in the Lab have not been
 * filmed and the number that reads as walking at ant scale on a phone
 * is what it will be set by. `SWING_DUTY` is the fraction of the cycle
 * a leg spends in the air; at 0.5 the two tripods hand over exactly,
 * which is the tripod at speed (the duty falls toward 0.5 as an insect
 * walks faster; slow walks plant more feet). Held at 0.5 so the
 * legality below — opposite tripods never both in swing — is
 * structural rather than tuned.
 *
 * ─── where a foot is in its stride ──────────────────────────────────
 *
 * `protraction` is the foot's station along the body, −1 (as far back
 * as it reaches) to +1 (as far forward), and it has two different
 * shapes on purpose. In STANCE the foot is planted and the BODY moves
 * over it at a steady pace, so the station falls linearly from +1 to
 * −1. In SWING the foot is lifted and carried forward, and a raised
 * cosine takes it from −1 to +1 with no velocity at either end — a
 * foot that lands is a foot that has stopped. The two meet at both
 * boundaries with the same value, so a leg never jumps; the slope
 * breaks there, which is a foot being put down. `lift` is the arc the
 * foot rises through in swing, a half sine, zero throughout stance.
 *
 * Pure: no three, no DOM.
 */

/** Body lengths the body travels in one full stride cycle. GAME TUNING (the brief's ~0.4). */
export const STRIDE_LENGTHS = 0.4;

/** Full strides per body length travelled — the same number the other way up, for the posers that count strides. */
export const STRIDES_PER_LENGTH = 1 / STRIDE_LENGTHS;

/** Fraction of the cycle a leg spends in the air. BIOLOGICAL SHAPE: the tripod at speed hands over exactly. */
export const SWING_DUTY = 0.5;

/**
 * The two tripods, for a reader and for the tests: which side (+1 the
 * animal's left at +X, −1 its right) and rank (0 front, 1 mid, 2 hind)
 * belong to which half. `LegSpec.phase` in `rig.ts` is computed as
 * `(sideBit + rank) % 2`, and this table is that rule written out.
 */
export const TRIPODS: readonly (readonly { readonly side: number; readonly rank: number }[])[] = Object.freeze([
  // Tripod 0: R1, L2, R3 (−X front, +X mid, −X hind).
  Object.freeze([{ side: -1, rank: 0 }, { side: 1, rank: 1 }, { side: -1, rank: 2 }]),
  // Tripod 1: L1, R2, L3 (+X front, −X mid, +X hind).
  Object.freeze([{ side: 1, rank: 0 }, { side: -1, rank: 1 }, { side: 1, rank: 2 }]),
]);

/** Which tripod a leg is in, from its side and rank — the rule `rig.ts` uses, in one place. */
export function tripodOf(side: number, rank: number): number {
  return ((side >= 0 ? 1 : 0) + rank) % 2;
}

/** Fraction into [0, 1). */
function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * How far into a stride cycle the body is, 0..1, from the distance it
 * has walked in body lengths and the creature's own phase (so a crowd
 * does not march in step).
 */
export function strideCycle(goneLengths: number, phase: number): number {
  return fract(goneLengths * STRIDES_PER_LENGTH + phase);
}

/** A leg's own place in the cycle: tripod 1 runs half a cycle behind tripod 0. */
export function legCycle(cycle: number, tripod: number): number {
  return fract(cycle + (tripod === 0 ? 0 : 0.5));
}

/** Whether a leg at this point in its own cycle is in the air. */
export function inSwing(leg: number): boolean {
  return fract(leg) < SWING_DUTY;
}

/**
 * The foot's station along the body at this point in its own cycle:
 * +1 fully forward, −1 fully back. Swing carries it forward on a raised
 * cosine; stance drags it back linearly under a body moving at a steady
 * pace. Continuous everywhere.
 */
export function protraction(leg: number): number {
  const t = fract(leg);
  if (t < SWING_DUTY) {
    const s = t / SWING_DUTY;
    return -Math.cos(Math.PI * s);
  }
  const s = (t - SWING_DUTY) / (1 - SWING_DUTY);
  return 1 - 2 * s;
}

/** How high the foot is through its swing, 0..1 — a half sine, zero throughout stance. */
export function lift(leg: number): number {
  const t = fract(leg);
  if (t >= SWING_DUTY) return 0;
  return Math.sin(Math.PI * (t / SWING_DUTY));
}

/**
 * Strides a second at a speed given in body lengths a second. Derived,
 * never used to drive a leg — the legs run on distance — but it is the
 * number a HUD or a sound would want.
 */
export function strideFrequency(speedLengthsPerS: number): number {
  return Math.max(0, speedLengthsPerS) * STRIDES_PER_LENGTH;
}
