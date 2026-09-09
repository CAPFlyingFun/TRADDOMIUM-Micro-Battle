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
 * ─── the stride is the speed's ──────────────────────────────────────
 *
 * Joshua, 2026-09-09, from the phone, on the Creature Lab: "All the
 * animations looked great except for the aphid. The legs didn't walk
 * like the queen and worker, but kind of was in slow motion."
 *
 * MEASURED CAUSE. The gait ran on distance at ONE stride length,
 * `STRIDE_LENGTHS` = 0.4 of a body a cycle, whatever the speed. The
 * aphid walks 0.8 mm/s on a 1.4 mm body — 0.57 body lengths a second
 * (MEASURED, Alford, Blackburn & Bale 2012 via aphid.md) — so its legs
 * cycled 0.57 / 0.4 = 1.4 times a second, against the queen's 20 mm/s
 * on 8 mm = 2.5 BL/s = 6.25 strides/s and the worker's 8.55 mm/s on
 * 3 mm = 2.85 BL/s = 7.1 strides/s. A leg cycling once in seven tenths
 * of a second IS slow motion, and the pace is the biology's and stays;
 * what was wrong is the stride. A walking insect takes SHORTER strides
 * at lower speeds (BIOLOGICAL SHAPE: Mendes et al. 2013, eLife,
 * "Quantification of gait parameters in freely walking wild type and
 * sensory deprived Drosophila melanogaster" — stride length and stride
 * frequency both rise with speed; Zollikofer 1994 for ants, where
 * stride length grows with speed), so a slow walker steps MORE often
 * per body length than a fast one, not fewer.
 *
 * `strideLengthsAt(speed)` is that law: the full stride scaled by the
 * speed over `STRIDE_FULL_SPEED`, clamped between `STRIDE_MIN_FRACTION`
 * and one.
 *
 *   `STRIDE_FULL_SPEED` = 2.5 body lengths a second. GAME TUNING, set
 *   AT the ants' walking pace — the queen wanders at exactly 2.5, the
 *   worker at 2.85, both at or over it — so the two ants Joshua approved
 *   take the full 0.4 stride they took before and look exactly as they
 *   did. `STRIDE_MIN_FRACTION` = 0.35: BIOLOGICAL SHAPE at the order
 *   Mendes measured between the slowest and the fastest walks; GAME
 *   TUNING at the number.
 *
 *   The aphid at 0.57 BL/s: 0.57 / 2.5 = 0.23, clamped to 0.35, is a
 *   0.14-body stride and 0.57 / 0.14 = 4.1 strides a second. Fleeing at
 *   2.5 mm/s = 1.8 BL/s: 0.71 of the full stride, 0.29 of a body, 6.3
 *   strides a second — a walk and a scurry, at the biology's pace.
 *
 * `STRIDES_PER_LENGTH` and `strideCycle` stay for the readers that pin
 * them; the posers now count STRIDES walked (`motion.ts`, `RigMotion.
 * strides`), which the view advances by distance over the stride length
 * at the measured speed, and `strideCycle` takes that count.
 *
 * ─── the numbers ────────────────────────────────────────────────────
 *
 * `STRIDE_LENGTHS` is how far the body travels in one FULL cycle (both
 * tripods), in body lengths, at the full speed and above. GAME TUNING
 * at the brief's ~0.4 (§27). It is of the right order — Zollikofer 1994
 * measured Cataglyphis stride lengths of about a body length at full
 * speed and shorter at a walk — and it is tuning because the two ants
 * in the Lab have not been filmed and the number that reads as walking
 * at ant scale on a phone is what it will be set by. `SWING_DUTY` is
 * the fraction of the cycle a leg spends in the air; at 0.5 the two
 * tripods hand over exactly, which is the tripod at speed (the duty
 * falls toward 0.5 as an insect walks faster; slow walks plant more
 * feet). Held at 0.5 so the legality below — opposite tripods never
 * both in swing — is structural rather than tuned.
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

/** Body lengths the body travels in one full stride cycle, at the full speed and above. GAME TUNING (the brief's ~0.4). */
export const STRIDE_LENGTHS = 0.4;

/** Full strides per body length travelled at the full stride — the same number the other way up, for the readers that pin it. */
export const STRIDES_PER_LENGTH = 1 / STRIDE_LENGTHS;

/**
 * The speed, body lengths a second, at and above which the stride is
 * the full `STRIDE_LENGTHS`. GAME TUNING set AT the ants' walking pace
 * (queen 2.5, worker 2.85 — `species.ts`), so the two ants Joshua
 * approved stride exactly as they did (the header).
 */
export const STRIDE_FULL_SPEED = 2.5;

/**
 * The shortest stride, as a fraction of the full one: what the slowest
 * walker takes. BIOLOGICAL SHAPE — the order Mendes et al. 2013 measured
 * between the slowest and the fastest walks; GAME TUNING at the number.
 * The aphid's wander lands on this clamp: 0.14 of a body a stride.
 */
export const STRIDE_MIN_FRACTION = 0.35;

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
 * THE STRIDE AT A SPEED, in body lengths: the full stride scaled by the
 * speed over `STRIDE_FULL_SPEED`, never under `STRIDE_MIN_FRACTION` of
 * it and never over it (the header). A speed that is not a number, or
 * is negative, takes the shortest stride: a stride is never zero, so a
 * count divided by it is never NaN.
 */
export function strideLengthsAt(speedLengthsPerS: number): number {
  const fraction = speedLengthsPerS / STRIDE_FULL_SPEED;
  const clamped = fraction >= 1 ? 1 : fraction > STRIDE_MIN_FRACTION ? fraction : STRIDE_MIN_FRACTION;
  return STRIDE_LENGTHS * clamped;
}

/**
 * How far into a stride cycle the body is, 0..1, from the STRIDES it
 * has walked so far (a count the view accumulates by distance over the
 * stride at the measured speed — `motion.ts`) and the creature's own
 * phase (so a crowd does not march in step).
 */
export function strideCycle(strides: number, phase: number): number {
  return fract(strides + phase);
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
 * Strides a second at a speed given in body lengths a second: the speed
 * over the stride that speed takes. Derived, never used to drive a leg
 * — the legs run on distance — but it is the number a HUD or a sound
 * would want, and the number the header argues: 6.25 for the queen's
 * walk, 4.1 for the aphid's, 6.3 for its flee.
 */
export function strideFrequency(speedLengthsPerS: number): number {
  const speed = Math.max(0, speedLengthsPerS);
  return speed / strideLengthsAt(speed);
}
