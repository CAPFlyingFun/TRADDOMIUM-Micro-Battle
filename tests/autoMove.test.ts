import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS, HOLD_SECONDS, HoldArmer, TapWatcher, angleBetween,
} from '../src/input/autoMove';

const DT = 1 / 60;

/** Push a bearing for a while and report whether a release would commit. */
function hold(bearingAt: (t: number) => number, seconds: number): boolean {
  const armer = new HoldArmer();
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    armer.sample(true, bearingAt(t), DT);
  }
  return armer.ready;
}

describe('holding a bearing to arm', () => {
  it('is not ready before the hold is up', () => {
    expect(hold(() => 0.4, HOLD_SECONDS - 0.2)).toBe(false);
  });

  it('is ready once it is', () => {
    expect(hold(() => 0.4, HOLD_SECONDS + 0.1)).toBe(true);
  });

  it('tolerates the wobble a real thumb makes', () => {
    expect(hold((t) => Math.sin(t * 6) * 0.15, HOLD_SECONDS + 0.1)).toBe(true);
  });

  it('starts over when the player swings to a new bearing', () => {
    // Turning hard a second in should push readiness a second later.
    expect(hold((t) => (t < 1 ? 0 : Math.PI / 2), HOLD_SECONDS + 0.1)).toBe(false);
    expect(hold((t) => (t < 1 ? 0 : Math.PI / 2), HOLD_SECONDS + 1.1)).toBe(true);
  });

  it('forgets everything the moment she stops', () => {
    const armer = new HoldArmer();
    for (let i = 0; i < 200; i++) armer.sample(true, 0, DT);
    expect(armer.ready).toBe(true);
    armer.sample(false, 0, DT);
    expect(armer.ready).toBe(false);
    expect(armer.progress).toBe(0);
  });

  it('reports progress so the ring can show it coming', () => {
    const armer = new HoldArmer();
    for (let i = 0; i < Math.round(1 / DT); i++) armer.sample(true, 0, DT);
    expect(armer.progress).toBeGreaterThan(0.4);
    expect(armer.progress).toBeLessThan(0.6);
  });

  it('never runs past full', () => {
    const armer = new HoldArmer();
    for (let i = 0; i < 600; i++) armer.sample(true, 0, DT);
    expect(armer.progress).toBe(1);
  });

  it('measures the short way round the circle', () => {
    expect(Math.abs(angleBetween(3.1, -3.1))).toBeLessThan(0.1);
  });
});

describe('double-tapping', () => {
  it('fires on the second tap, not the first', () => {
    const taps = new TapWatcher();
    expect(taps.tap(1000)).toBe(false);
    expect(taps.tap(1000 + DOUBLE_TAP_MS - 20)).toBe(true);
  });

  it('ignores taps too far apart to be a double', () => {
    const taps = new TapWatcher();
    expect(taps.tap(1000)).toBe(false);
    expect(taps.tap(1000 + DOUBLE_TAP_MS + 50)).toBe(false);
  });

  it('does not read three taps as two doubles', () => {
    const taps = new TapWatcher();
    expect(taps.tap(0)).toBe(false);
    expect(taps.tap(100)).toBe(true);
    expect(taps.tap(200)).toBe(false);
  });
});
