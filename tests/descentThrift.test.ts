/**
 * COMING DOWN IS A TOP-UP, NOT A REFUEL.
 *
 * Joshua, v0.0.154 device pass: "lower the stamina regeneration while
 * flying... it was generating which was nice, but too much stamina
 * time."
 *
 * The reserve is spent in fractions per second and a full bar at
 * autopilot cruise is FAST_DRAIN's 900 seconds. What matters to a
 * player is not the fraction, it is the EXCHANGE RATE: how many
 * seconds of flight one second of descending buys. That is what these
 * check, in the units the complaint was made in.
 *
 * AND THE ORDER, which is the part a rate alone will not protect. Every
 * recovery in the air is a descent of some kind, and they have to stay
 * ranked by how much height each one is throwing away — otherwise
 * letting go of the stick becomes strictly better than flying the
 * aircraft, which is an exploit rather than a tuning choice.
 */
import { describe, expect, it } from 'vitest';
import {
  CRUISE_SECONDS, DESCENT_THRIFT, FAST_DRAIN, GLIDE_RECOVERY,
  RECOVERY_DESCENT_RECOVERY,
} from '../src/ant/flight';

/** Seconds of cruising a full reserve buys at the speed she actually flies. */
const BAR_SECONDS = 1 / FAST_DRAIN;

/** Seconds of flight bought by one second at this recovery rate. */
function boughtPerSecond(rate: number): number {
  return -rate * BAR_SECONDS;
}

describe('descending buys flight, but not much', () => {
  it('a full bar at autopilot cruise is fifteen minutes', () => {
    // The number on his HUD was 14:07, and every exchange rate below is
    // quoted against this — so if the drain is ever re-anchored, the
    // rates stop meaning what this file says they mean.
    expect(BAR_SECONDS).toBe(900);
    expect(CRUISE_SECONDS).toBe(1800);
  });

  it('one second of deliberate descent buys under two seconds of flight', () => {
    // It bought 7.25 before v0.0.155.
    const dive = GLIDE_RECOVERY * 1.6;
    expect(boughtPerSecond(dive)).toBeCloseTo(1.8, 2);
  });

  it('a descent cannot refill a bar she could ever sustain', () => {
    // The whole point of the change: eight minutes of continuous
    // descending would be needed, and she has nowhere near that much
    // height to spend. Coming down tops her up; the ground refills her.
    const dive = GLIDE_RECOVERY * 1.6;
    expect(1 / -dive).toBeGreaterThan(400);
  });

  it('ranks the descents by how much height each one throws away', () => {
    // THE EXPLOIT GUARD. A passive glide must never recover faster than
    // a deliberate dive, or the best thing a player can do is take
    // their thumb off. Rates are negative, so "recovers more" is "less
    // than" — compared as magnitudes here to keep that readable.
    const passive = -GLIDE_RECOVERY;
    const dive = -(GLIDE_RECOVERY * 1.6);
    const emergency = -RECOVERY_DESCENT_RECOVERY;
    const exhausted = -(GLIDE_RECOVERY * 0.4);
    expect(exhausted).toBeLessThan(passive);
    expect(passive).toBeLessThan(dive);
    expect(dive).toBeLessThan(emergency);
  });

  it('keeps the ratios the dial was applied to', () => {
    // One dial, applied to the family — so a future retune moves them
    // together instead of drifting apart one constant at a time.
    expect(RECOVERY_DESCENT_RECOVERY / (GLIDE_RECOVERY * 1.6)).toBeCloseTo(2.25, 6);
    expect(GLIDE_RECOVERY * DESCENT_THRIFT).toBeCloseTo(-0.005, 6);
    expect(RECOVERY_DESCENT_RECOVERY * DESCENT_THRIFT).toBeCloseTo(-0.018, 6);
  });

  it('level flight still costs, and has never been a way to recover', () => {
    // His answer was "leave level flight unchanged", and this is why
    // that needed nothing done: powered flight is a DRAIN. The branch
    // that recovers with no stick held is a glide — she is going down.
    expect(FAST_DRAIN).toBeGreaterThan(0);
  });
});
