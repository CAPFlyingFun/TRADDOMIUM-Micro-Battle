/**
 * The v0 FPS-floor regression, as a test: raw and sim dt must NEVER be the
 * same number under a stall, or the FPS readout is lying again.
 */
import { describe, expect, it } from 'vitest';
import { FrameClock, SIM_DT_CAP } from '../src/app/FrameClock';

describe('FrameClock', () => {
  it('reads 0 for both on the first tick', () => {
    const clock = new FrameClock();
    expect(clock.tick(1000)).toEqual({ rawDt: 0, simDt: 0 });
  });

  it('after a 2.0 s stall, rawDt is 2.0 and simDt is the cap', () => {
    const clock = new FrameClock();
    clock.tick(1000);
    const { rawDt, simDt } = clock.tick(3000);
    expect(rawDt).toBe(2.0);
    expect(simDt).toBe(SIM_DT_CAP);
    expect(simDt).toBe(0.1);
    expect(rawDt).not.toBe(simDt);
  });

  it('while paused simDt is 0 but rawDt still advances', () => {
    const clock = new FrameClock();
    clock.tick(0);
    clock.pause();
    expect(clock.tick(16)).toEqual({ rawDt: 0.016, simDt: 0 });
    expect(clock.isPaused).toBe(true);
    clock.resume();
    const { rawDt, simDt } = clock.tick(32);
    expect(rawDt).toBeCloseTo(0.016, 9);
    expect(simDt).toBeCloseTo(0.016, 9);
  });

  it('accumulates only simulated time into elapsed', () => {
    const clock = new FrameClock();
    clock.tick(0);
    clock.tick(50); // 0.05
    clock.tick(5050); // stalled 5 s → 0.1
    clock.pause();
    clock.tick(6050); // paused → 0
    expect(clock.elapsed).toBeCloseTo(0.15, 9);
  });

  it('never reports a negative delta if the clock goes backwards', () => {
    const clock = new FrameClock();
    clock.tick(1000);
    expect(clock.tick(900)).toEqual({ rawDt: 0, simDt: 0 });
  });
});
