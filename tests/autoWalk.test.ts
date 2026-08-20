import { describe, expect, it } from 'vitest';
import {
  ARM_DEFLECTION, DOUBLE_TAP_MS, HOLD_SECONDS, LockArmer, REARM_BLOCK_MS, TapWatcher,
  angleBetween,
} from '../src/input/autoWalk';

const DT = 1 / 60;

/** Push the stick steadily and report how long it took to lock, or null. */
function hold(deflection: number, bearingAt: (t: number) => number, seconds = 4) {
  const armer = new LockArmer();
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    if (armer.sample(deflection, bearingAt(t), DT)) return t;
  }
  return null;
}

describe('holding a bearing to lock', () => {
  it('locks after the hold, not before', () => {
    const at = hold(1, () => 0.4);
    expect(at).not.toBeNull();
    // Two seconds, give or take a frame.
    expect(at).toBeGreaterThan(HOLD_SECONDS - 0.05);
    expect(at).toBeLessThan(HOLD_SECONDS + 0.05);
  });

  it('tolerates the wobble a real thumb makes', () => {
    // Drifting a few degrees back and forth must not cancel the gesture.
    const at = hold(1, (t) => Math.sin(t * 6) * 0.15);
    expect(at).not.toBeNull();
  });

  it('starts over when the player swings to a new bearing', () => {
    // A hard turn a second in should push the lock a second later.
    const at = hold(1, (t) => (t < 1 ? 0 : Math.PI / 2));
    expect(at).not.toBeNull();
    expect(at).toBeGreaterThan(HOLD_SECONDS + 0.9);
  });

  it('ignores a stick that is not really pushed', () => {
    expect(hold(ARM_DEFLECTION - 0.05, () => 0)).toBeNull();
  });

  it('reports progress so the ring can show the lock coming', () => {
    const armer = new LockArmer();
    expect(armer.progress).toBe(0);
    for (let i = 0; i < Math.round(1 / DT); i++) armer.sample(1, 0, DT);
    expect(armer.progress).toBeGreaterThan(0.4);
    expect(armer.progress).toBeLessThan(0.6);
    armer.reset();
    expect(armer.progress).toBe(0);
  });

  it('measures the short way round the circle', () => {
    expect(angleBetween(3.1, -3.1)).toBeCloseTo(Math.PI * 2 - 6.2, 6);
    expect(Math.abs(angleBetween(3.1, -3.1))).toBeLessThan(0.1);
  });
});

describe('double-tapping to lock', () => {
  it('locks on the second tap, not the first', () => {
    const taps = new TapWatcher();
    expect(taps.tap(1000)).toBe(false);
    expect(taps.tap(1000 + DOUBLE_TAP_MS - 20)).toBe(true);
  });

  it('ignores taps too far apart to be a double', () => {
    const taps = new TapWatcher();
    expect(taps.tap(1000)).toBe(false);
    expect(taps.tap(1000 + DOUBLE_TAP_MS + 50)).toBe(false);
  });

  it('does not treat three taps as two doubles', () => {
    const taps = new TapWatcher();
    expect(taps.tap(0)).toBe(false);
    expect(taps.tap(100)).toBe(true);
    // The double consumed both taps; the next one starts fresh.
    expect(taps.tap(200)).toBe(false);
  });

  it('will not re-lock on the tap that just cancelled a lock', () => {
    const taps = new TapWatcher();
    taps.blockRearm(1000);
    expect(taps.tap(1050)).toBe(false);
    expect(taps.tap(1100)).toBe(false);
    // Once the block lapses, double-tap works again.
    expect(taps.tap(1000 + REARM_BLOCK_MS + 10)).toBe(false);
    expect(taps.tap(1000 + REARM_BLOCK_MS + 100)).toBe(true);
  });
});
