/**
 * THE BADGE'S PENDULUM, DRIVEN BY NUMBERS (`actor/humanBadge`).
 *
 * Every case is in the chest frame the module documents: gravity
 * (0, −9.81, 0) when the wearer is upright, pitch positive out from the
 * chest, roll positive toward +x.
 */
import { describe, expect, it } from 'vitest';
import {
  BADGE_GRAVITY, BADGE_TUNING, badgeLength, createBadge, stepBadge, swingBadge,
  type BadgeInput, type BadgeSensor, type BadgeState,
} from '../src/actor/humanBadge';

const UPRIGHT: BadgeInput = {
  gx: 0, gy: -1, gz: 0, ax: 0, ay: 0, az: 0,
  restPitch: -0.3, maxPitch: 1.2, maxRoll: 0.6,
};

function run(state: BadgeState, seconds: number, dt: number, input: BadgeInput = UPRIGHT): BadgeState {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i += 1) stepBadge(state, dt, input);
  return state;
}

describe('humanBadge', () => {
  it('derives its length from the tuned period', () => {
    // L = g (T / 2π)²; at 0.6 s that is about nine centimetres.
    expect(badgeLength()).toBeCloseTo(BADGE_GRAVITY * (BADGE_TUNING.periodS / (2 * Math.PI)) ** 2, 9);
    expect(badgeLength()).toBeGreaterThan(0.08);
    expect(badgeLength()).toBeLessThan(0.1);
  });

  it('settles to hanging straight under gravity, within about 1.5 s', () => {
    const s = createBadge();
    s.pitch = 0.5;
    s.roll = -0.4;
    run(s, 1.5, 1 / 60);
    expect(Math.abs(s.pitch)).toBeLessThan(0.02);
    expect(Math.abs(s.roll)).toBeLessThan(0.02);
    run(s, 3, 1 / 60);
    expect(Math.abs(s.pitch)).toBeLessThan(1e-3);
    expect(Math.abs(s.roll)).toBeLessThan(1e-3);
    expect(Math.abs(s.pitchRate) + Math.abs(s.rollRate)).toBeLessThan(1e-2);
  });

  it('swings with roughly the tuned period', () => {
    const s = createBadge();
    s.roll = 0.05;
    const dt = 1 / 1000;
    let last = s.roll;
    const crossings: number[] = [];
    for (let i = 1; i < 2000; i += 1) {
      stepBadge(s, dt, UPRIGHT);
      if (last > 0 && s.roll <= 0) crossings.push(i * dt);
      last = s.roll;
    }
    expect(crossings.length).toBeGreaterThanOrEqual(2);
    const period = crossings[1] - crossings[0];
    // Damping lengthens it a touch; within 10% is the brief.
    expect(period).toBeGreaterThan(BADGE_TUNING.periodS * 0.95);
    expect(period).toBeLessThan(BADGE_TUNING.periodS * 1.1);
  });

  it('rests against the chest when the chest leans out over it', () => {
    // A rest limit above zero (a belly in front of where the card would
    // hang) holds the card there, still.
    const s = createBadge();
    run(s, 3, 1 / 60, { ...UPRIGHT, restPitch: 0.35 });
    expect(s.pitch).toBeCloseTo(0.35, 6);
    expect(Math.abs(s.pitchRate)).toBeLessThan(1e-6);
  });

  it('a sideways lurch produces a bounded roll that decays', () => {
    const s = createBadge();
    // The pivot accelerates toward +x for a tenth of a second: the card
    // lags, swinging toward −x.
    run(s, 0.1, 1 / 60, { ...UPRIGHT, ax: 12 });
    let peak = 0;
    for (let i = 0; i < 120; i += 1) {
      stepBadge(s, 1 / 60, UPRIGHT);
      peak = Math.max(peak, Math.abs(s.roll));
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(UPRIGHT.maxRoll + 1e-12);
    }
    expect(peak).toBeGreaterThan(0.05);
    run(s, 1, 1 / 60);
    expect(Math.abs(s.roll)).toBeLessThan(0.01);
    console.log(`[humanBadge] lurch 12 m/s² × 0.1 s → peak roll ${peak.toFixed(3)} rad`);
  });

  it('the first swing after a lurch goes the way inertia says', () => {
    const s = createBadge();
    run(s, 0.05, 1 / 120, { ...UPRIGHT, ax: 10 });
    expect(s.roll).toBeLessThan(0);
    const f = createBadge(0);
    run(f, 0.05, 1 / 120, { ...UPRIGHT, az: -10 }); // the body stops: the card is thrown out
    expect(f.pitch).toBeGreaterThan(0);
  });

  it('never passes restPitch, however hard it is driven back', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 15, 0.25]) {
      const s = createBadge(0.2);
      for (let i = 0; i < 400; i += 1) {
        const lurch = i % 20 < 10 ? 40 : -40;
        stepBadge(s, dt, { ...UPRIGHT, restPitch: 0.2, az: lurch, turnX: 0.3 * Math.sin(i) });
        expect(s.pitch).toBeGreaterThanOrEqual(0.2);
        expect(s.pitch).toBeLessThanOrEqual(UPRIGHT.maxPitch);
      }
    }
  });

  it('is stable for frame times from 1/240 s to 0.25 s', () => {
    for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1, 0.25]) {
      const s = createBadge();
      s.pitch = 0.6;
      s.roll = 0.5;
      run(s, 4, dt);
      expect(Number.isFinite(s.pitch) && Number.isFinite(s.roll)).toBe(true);
      expect(Math.abs(s.pitch)).toBeLessThan(0.01);
      expect(Math.abs(s.roll)).toBeLessThan(0.01);
    }
    // And one frame of a minute is integrated as maxDtS, not as a minute.
    const s = createBadge();
    s.roll = 0.3;
    stepBadge(s, 60, UPRIGHT);
    expect(Number.isFinite(s.roll)).toBe(true);
    expect(Math.abs(s.roll)).toBeLessThanOrEqual(UPRIGHT.maxRoll);
  });

  it('settles the same way whatever the frame rate', () => {
    const fast = createBadge();
    const slow = createBadge();
    fast.pitch = slow.pitch = 0.4;
    run(fast, 0.5, 1 / 240);
    run(slow, 0.5, 1 / 30);
    // The substep cap makes both integrate in steps of at most 1/120 s.
    expect(Math.abs(fast.pitch - slow.pitch)).toBeLessThan(0.02);
  });

  it('a chest that turns leaves the card behind for a moment', () => {
    // A bow of 0.2 rad in one step: the card was hanging straight, and
    // relative to the bowed chest it now hangs 0.2 rad out.
    const s = createBadge();
    stepBadge(s, 1 / 240, { ...UPRIGHT, turnX: 0.2 });
    expect(s.pitch).toBeGreaterThan(0.19);
    const r = createBadge();
    stepBadge(r, 1 / 240, { ...UPRIGHT, turnZ: 0.2 });
    expect(r.roll).toBeLessThan(-0.19);
  });

  it('is deterministic', () => {
    const drive = (): BadgeState => {
      const s = createBadge();
      for (let i = 0; i < 300; i += 1) {
        stepBadge(s, 1 / 60 + (i % 7) * 0.001, {
          ...UPRIGHT, ax: Math.sin(i * 0.3) * 6, az: Math.cos(i * 0.2) * 4, turnZ: 0.01 * Math.sin(i),
        });
      }
      return s;
    };
    expect(drive()).toEqual(drive());
  });

  it('ignores a non-finite frame and recovers from a poisoned state', () => {
    const s = createBadge();
    s.roll = 0.2;
    stepBadge(s, Number.NaN, UPRIGHT);
    expect(s.roll).toBe(0.2);
    s.pitch = Number.NaN;
    stepBadge(s, 1 / 60, UPRIGHT);
    expect(Number.isFinite(s.pitch)).toBe(true);
    expect(s.pitch).toBeGreaterThanOrEqual(UPRIGHT.restPitch);
  });

  it('follows gravity when the chest leans: a bowed wearer lets the card hang out', () => {
    // Bowing turns the chest frame about +x, so world-down appears tipped
    // toward +z in it, and the card hangs out from the chest by the bow.
    const lean = 0.5;
    const s = createBadge();
    run(s, 3, 1 / 60, { ...UPRIGHT, gy: -Math.cos(lean), gz: Math.sin(lean) });
    expect(s.pitch).toBeCloseTo(lean, 3);
  });

  it('swingBadge senses, steps and shows, and passes over a missing badge', () => {
    const calls: string[] = [];
    const sensor: BadgeSensor = {
      state: createBadge(),
      sense: (dt) => { calls.push(`sense ${dt}`); return { ...UPRIGHT, ax: 5 }; },
      show: () => { calls.push('show'); },
    };
    swingBadge(sensor, 1 / 60);
    expect(calls).toEqual([`sense ${1 / 60}`, 'show']);
    expect(sensor.state.rollRate).toBeLessThan(0);
    swingBadge(null, 1 / 60);
    const idle: BadgeSensor = { state: createBadge(0.1), sense: () => null, show: () => { calls.push('idle show'); } };
    swingBadge(idle, 1 / 60);
    expect(idle.state.pitch).toBe(0.1);
    expect(calls[calls.length - 1]).toBe('idle show');
  });
});
