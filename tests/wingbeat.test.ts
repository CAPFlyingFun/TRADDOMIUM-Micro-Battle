import { describe, expect, it } from 'vitest';
import {
  FOREWING_MID, FOREWING_SWEEP, HINDWING_MID, HINDWING_SWEEP,
  SHOWN_HZ, STROKE_PLANE, WINGBEAT_HZ, Wingbeat, poseAt,
} from '../src/ant/wingbeat';

const DEG = 180 / Math.PI;

describe('the measured wingbeat', () => {
  /** Gui et al. 2010, female column. These are the paper, verbatim. */
  it('carries the female alate figures, not the male ones', () => {
    expect(WINGBEAT_HZ).toBe(96); // male is 108
    expect(FOREWING_SWEEP).toBeCloseTo(114.3, 4); // male 126.8
    expect(HINDWING_SWEEP).toBeCloseTo(135.3, 4); // male 148.1
    expect(STROKE_PLANE).toBeCloseTo(67.7, 4); // male 55.1
  });

  it('sweeps the hindwing about 15% further than the forewing', () => {
    // The paper's own observation, true of both sexes — and the thing
    // that keeps four wings from looking like two pairs of the same.
    const further = HINDWING_SWEEP / FOREWING_SWEEP;
    expect(further).toBeGreaterThan(1.1);
    expect(further).toBeLessThan(1.25);
  });

  it('swings each wing through exactly its measured amplitude', () => {
    let foreLow = Infinity;
    let foreHigh = -Infinity;
    let hindLow = Infinity;
    let hindHigh = -Infinity;
    for (let i = 0; i <= 720; i += 1) {
      const pose = poseAt(i / 720);
      foreLow = Math.min(foreLow, pose.fore * DEG);
      foreHigh = Math.max(foreHigh, pose.fore * DEG);
      hindLow = Math.min(hindLow, pose.hind * DEG);
      hindHigh = Math.max(hindHigh, pose.hind * DEG);
    }
    expect(foreHigh - foreLow).toBeCloseTo(FOREWING_SWEEP, 1);
    expect(hindHigh - hindLow).toBeCloseTo(HINDWING_SWEEP, 1);
    // And centred where the paper puts them: the forewing runs -29.9
    // to 84.4, the hindwing -45.0 to 90.3.
    expect(foreHigh).toBeCloseTo(84.4, 1);
    expect(foreLow).toBeCloseTo(-29.9, 1);
    expect(hindHigh).toBeCloseTo(90.3, 1);
    expect(hindLow).toBeCloseTo(-45.0, 1);
  });

  it('centres each wing between its own limits', () => {
    expect(FOREWING_MID).toBeCloseTo((84.4 - 29.9) / 2, 6);
    expect(HINDWING_MID).toBeCloseTo((90.3 - 45.0) / 2, 6);
  });

  it('repeats exactly once per beat', () => {
    const start = poseAt(0);
    const round = poseAt(1);
    expect(round.fore).toBeCloseTo(start.fore, 9);
    expect(round.hind).toBeCloseTo(start.hind, 9);
    // And is somewhere else halfway through, or it is not beating.
    expect(Math.abs(poseAt(0.5).fore - start.fore)).toBeGreaterThan(1);
  });

  /**
   * NOT A COMPROMISE, ARITHMETIC. At 96 Hz a beat and a half passes
   * between two frames of a 60 Hz display, so what gets sampled is
   * aliasing rather than motion. The measurement is kept intact and the
   * DRAWN rate is separate and slower — this pins them apart so nobody
   * later "fixes" the animation by setting it to the real frequency.
   */
  it('draws slower than it beats, on purpose', () => {
    expect(SHOWN_HZ).toBeLessThan(WINGBEAT_HZ / 2);
    expect(SHOWN_HZ).toBeGreaterThan(4);
  });
});

describe('running the beat', () => {
  it('starts still and spins up', () => {
    const beat = new Wingbeat();
    expect(beat.beating).toBe(false);
    for (let t = 0; t < 1; t += 1 / 60) beat.update(1 / 60, true);
    expect(beat.beating).toBe(true);
  });

  it('winds down rather than stopping dead', () => {
    const beat = new Wingbeat();
    for (let t = 0; t < 1; t += 1 / 60) beat.update(1 / 60, true);
    beat.update(1 / 60, false);
    // One frame after being told to stop, still moving.
    expect(beat.beating).toBe(true);
    for (let t = 0; t < 2; t += 1 / 60) beat.update(1 / 60, false);
    expect(beat.beating).toBe(false);
  });

  it('reaches the same place at every frame rate', () => {
    // EXACTLY three simulated seconds at each rate, counted in whole
    // frames rather than by accumulating a float — the first version of
    // this test ran one extra frame before the loop, so 10 fps covered
    // 90 ms more than 120 fps did, which at twelve beats a second is
    // most of a stroke. The test was wrong, not the wings.
    const reached = [120, 60, 30, 10].map((fps) => {
      const beat = new Wingbeat();
      let pose = { fore: 0, hind: 0 };
      for (let frame = 0; frame < fps * 3; frame += 1) {
        pose = beat.update(1 / fps, true);
      }
      return pose.fore;
    });
    expect(Math.max(...reached) - Math.min(...reached)).toBeLessThan(0.02);
  });

  it('does not let a long frame race the wings', () => {
    const beat = new Wingbeat();
    for (let i = 0; i < 200; i += 1) {
      const pose = beat.update(0.1, true);
      expect(Number.isFinite(pose.fore)).toBe(true);
      expect(Math.abs(pose.fore * DEG)).toBeLessThan(120);
    }
  });

  it('holds still when she is not flying', () => {
    const beat = new Wingbeat();
    const first = beat.update(1 / 60, false);
    for (let t = 0; t < 5; t += 1 / 60) beat.update(1 / 60, false);
    const later = beat.update(1 / 60, false);
    expect(later.fore).toBeCloseTo(first.fore, 6);
    expect(later.hind).toBeCloseTo(first.hind, 6);
  });
});
