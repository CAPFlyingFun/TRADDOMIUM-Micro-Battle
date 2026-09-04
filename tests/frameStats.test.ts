/**
 * FrameStats math, and the v0 FPS-floor regression as a test.
 *
 * v0 clamped dt to 0.1 s for anti-teleport reasons and fed that same value
 * to its FPS readout, so the display could not report below 10 fps by
 * construction. Here a window with one real 2.0 s stall must read 0.5 fps
 * at the 95th-percentile low — not 10, and not the ~60 that a count-based
 * percentile or an average of per-frame rates would give.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAME_WINDOW, FrameStats, LOW_FRACTION } from '../src/perf/FrameStats';

const SIXTY = 1 / 60;

function fed(rawTimes: readonly number[], simDt = SIXTY): ReturnType<FrameStats['summary']> {
  const stats = new FrameStats();
  for (const t of rawTimes) stats.record(t, simDt);
  return stats.summary();
}

function repeat(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value);
}

describe('FrameStats', () => {
  it('reads 0 fps and 0 frames before any frame has arrived', () => {
    expect(new FrameStats().summary()).toEqual({ meanFps: 0, lowFps: 0, simDt: 0, frames: 0 });
    expect(FRAME_WINDOW).toBe(120);
    expect(LOW_FRACTION).toBe(0.05);
  });

  it('reports 60 fps mean and 60 fps low for a steady 60 fps window', () => {
    const s = fed(repeat(SIXTY, 120));
    expect(s.frames).toBe(120);
    expect(s.meanFps).toBeCloseTo(60, 6);
    expect(s.lowFps).toBeCloseTo(60, 6);
  });

  it('the v0 regression: 119 frames at 60 fps and one 2.0 s stall read 0.5 fps low, NOT 10', () => {
    const s = fed([...repeat(SIXTY, 119), 2.0]);
    expect(s.lowFps).toBe(0.5);
    expect(s.lowFps).not.toBe(10);
    // 120 frames over the wall-clock they actually took (119/60 + 2 s ≈ 3.98 s).
    expect(s.meanFps).toBeCloseTo(120 / (119 / 60 + 2), 6);
    // Averaging per-frame rates would have said ≈ 59.5 and hidden the stall.
    expect(s.meanFps).toBeLessThan(31);
  });

  it('fed the clamped sim dt instead, as v0 did, the readout can never fall below 10 fps', () => {
    // A phone frozen solid: every frame 2 s. Clamped to the 0.1 s sim cap it
    // reads 10 fps; the raw values read the truth.
    expect(fed(repeat(0.1, 120)).lowFps).toBeCloseTo(10, 9);
    expect(fed(repeat(0.1, 120)).meanFps).toBeCloseTo(10, 9);
    expect(fed(repeat(2.0, 120)).lowFps).toBe(0.5);
    expect(fed(repeat(2.0, 120)).meanFps).toBe(0.5);
  });

  it('weights the low by time: a hitch under 5 % of the window is not the low, one over it is', () => {
    // 0.05 s is 2.5 % of a 2.03 s window: the low stays at the steady rate.
    expect(fed([...repeat(SIXTY, 119), 0.05]).lowFps).toBeCloseTo(60, 6);
    // 0.15 s is 7 % of a 2.13 s window: the low IS that frame.
    expect(fed([...repeat(SIXTY, 119), 0.15]).lowFps).toBeCloseTo(1 / 0.15, 6);
  });

  it('holds only the last FRAME_WINDOW frames', () => {
    const stats = new FrameStats();
    for (const t of repeat(2.0, 120)) stats.record(t, SIXTY);
    for (const t of repeat(SIXTY, 120)) stats.record(t, SIXTY);
    const recovered = stats.summary();
    expect(recovered.frames).toBe(120);
    expect(recovered.lowFps).toBeCloseTo(60, 6);

    const lingering = new FrameStats();
    for (const t of repeat(2.0, 120)) lingering.record(t, SIXTY);
    for (const t of repeat(SIXTY, 119)) lingering.record(t, SIXTY);
    // One stall frame is still inside the window.
    expect(lingering.summary().lowFps).toBe(0.5);
  });

  it('ignores 0 and non-finite raw dt (the clock reads 0 on its first tick) but keeps the latest sim dt', () => {
    const stats = new FrameStats();
    stats.record(0, 0);
    expect(stats.summary().frames).toBe(0);
    stats.record(Number.NaN, 0.016);
    stats.record(Number.POSITIVE_INFINITY, 0.016);
    stats.record(-0.016, 0.016);
    expect(stats.summary()).toEqual({ meanFps: 0, lowFps: 0, simDt: 0.016, frames: 0 });
    // Paused: raw keeps measuring, sim reads 0.
    stats.record(SIXTY, 0);
    expect(stats.summary().frames).toBe(1);
    expect(stats.summary().simDt).toBe(0);
    expect(stats.summary().meanFps).toBeCloseTo(60, 6);
  });

  it('reset empties the window', () => {
    const stats = new FrameStats();
    stats.record(SIXTY, SIXTY);
    stats.reset();
    expect(stats.summary()).toEqual({ meanFps: 0, lowFps: 0, simDt: 0, frames: 0 });
  });

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => new FrameStats(0)).toThrow();
    expect(() => new FrameStats(1.5)).toThrow();
    expect(new FrameStats(1).capacity).toBe(1);
  });

  it('is a core module: imports nothing and touches neither three nor the DOM', () => {
    const source = readFileSync(new URL('../src/perf/FrameStats.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
    // Uses of the globals — a member access, an index or a call — not the
    // words: "window" is also what the ring buffer is called in the comments.
    expect(source).not.toMatch(/\b(window|document|localStorage|navigator)(\.[A-Za-z_$]|\[|\()/);
    expect(source).not.toMatch(/from\s+['"]three['"]/);
  });
});
