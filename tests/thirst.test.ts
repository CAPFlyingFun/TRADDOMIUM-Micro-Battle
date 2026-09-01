/**
 * THE FIRST BAR ON THE CARD THAT MOVES BY ITSELF — held to the rule
 * that let it move at all.
 *
 * CLAUDE.md: a bar may only move if there is a way to move it back. The
 * water meter was a placeholder for three versions because there was
 * nothing to drink; these tests are what keep the drain and the refill
 * arriving together rather than one of them quietly outliving the
 * other.
 */
import { describe, expect, it } from 'vitest';
import { Thirst } from '../src/ant/thirst';

describe('a reserve that empties', () => {
  it('starts full and falls when she is not drinking', () => {
    const thirst = new Thirst();
    expect(thirst.fraction).toBe(1);
    expect(thirst.parched).toBe(false);
    thirst.update(60, false);
    expect(thirst.fraction).toBeLessThan(1);
    expect(thirst.fraction).toBeGreaterThan(0);
  });

  it('drains at the rate it reports, which is the caste table\'s', () => {
    // The drain is published so the HUD can turn it into the seconds
    // she actually reads. If the two ever parted company the card
    // would count down to a number the reserve does not reach.
    const thirst = new Thirst();
    const rate = thirst.drain;
    expect(rate).toBeGreaterThan(0);
    thirst.update(10, false);
    expect(thirst.fraction).toBeCloseTo(1 - rate * 10, 9);
  });

  /**
   * TEST A — A FULL TANK IS TWO HOURS.
   *
   * Joshua, 2026-09-01: "Change the Queen's full hydration duration to
   * 120 minutes. Do this through the existing thirst configuration."
   *
   * Asserted EXACTLY rather than loosely, which the earlier version of
   * this test was not — it allowed anything between ten and ninety
   * minutes, so it held 55.6 for three builds without anyone knowing
   * what the number was. The duration is now a decision, and a decision
   * belongs under a test that names it.
   *
   * There is one place it lives (castes.ts, `thirstRate` over
   * `maxThirst`) and this is the assertion that it is the number
   * Joshua asked for.
   */
  it('takes exactly two hours to empty, which is the number chosen', () => {
    const thirst = new Thirst();
    expect(1 / thirst.drain).toBeCloseTo(120 * 60, 6);
  });

  it('and no second hydration value exists to disagree with it', () => {
    // The autonomy is handed `thirstDrain` and reasons in seconds; the
    // HUD divides the same two numbers. Nothing keeps its own copy, so
    // moving the table moves everything — which is what "do this
    // through the existing thirst configuration" asked for.
    const thirst = new Thirst();
    thirst.restore(0.5);
    expect(0.5 / thirst.drain).toBeCloseTo(60 * 60, 6);
  });

  it('never falls below empty however long it is left', () => {
    const thirst = new Thirst();
    thirst.update(1e6, false);
    expect(thirst.fraction).toBe(0);
    expect(thirst.parched).toBe(true);
  });
});

describe('and a way to fill it again', () => {
  it('drinking puts it back, and faster than it drained', () => {
    const thirst = new Thirst();
    thirst.restore(0.5);
    thirst.update(1, true);
    expect(thirst.fraction).toBeGreaterThan(0.5);
    // A refill slower than the drain is not a refill, it is a slower
    // countdown, and it would fail the invariant while looking like it
    // passed.
    const gained = thirst.fraction - 0.5;
    expect(gained).toBeGreaterThan(thirst.drain);
  });

  it('never fills past full', () => {
    const thirst = new Thirst();
    thirst.update(1e6, true);
    expect(thirst.fraction).toBe(1);
  });

  it('reports running dry exactly once, on the frame it happens', () => {
    // So a caller can say something about it without watching for the
    // edge itself — and so it cannot say it every frame afterwards.
    const thirst = new Thirst();
    thirst.restore(0.0001);
    let cried = 0;
    for (let i = 0; i < 50; i++) if (thirst.update(1, false)) cried++;
    expect(cried).toBe(1);
  });
});

describe('the parched latch', () => {
  it('does not clear on the first sip, which would make it flicker', () => {
    // The same shape as stamina's. A latch that cleared the instant the
    // bar left zero would stutter in and out of the empty state on
    // every drop, and the state is meant to mean "she is in trouble"
    // rather than "she is at zero this frame".
    const thirst = new Thirst();
    thirst.update(1e6, false);
    expect(thirst.parched).toBe(true);
    thirst.update(0.5, true);
    expect(thirst.fraction).toBeGreaterThan(0);
    expect(thirst.parched).toBe(true);
    thirst.update(3, true);
    expect(thirst.fraction).toBeGreaterThan(0.2);
    expect(thirst.parched).toBe(false);
  });

  it('a save restored below the latch comes back parched', () => {
    const thirst = new Thirst();
    thirst.restore(0.05);
    expect(thirst.parched).toBe(true);
    thirst.restore(0.9);
    expect(thirst.parched).toBe(false);
  });
});
