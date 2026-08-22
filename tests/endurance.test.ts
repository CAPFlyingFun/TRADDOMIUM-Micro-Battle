import { describe, expect, it } from 'vitest';
import { enduranceWords } from '../src/ui/Vitals';
import {
  MOVING_RECOVERY, RESTING_RECOVERY, SPRINT_DRAIN, Stamina,
} from '../src/ant/stamina';
import { CLIMB_DRAIN, CRUISE_DRAIN } from '../src/ant/flight';

/** Seconds the readout is claiming, parsed back out of what it says. */
function secondsIn(words: string): number {
  const clock = words.match(/(\d+):(\d\d)/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const plain = words.match(/([\d.]+)s/);
  return plain ? Number(plain[1]) : NaN;
}

describe('the endurance readout', () => {
  /**
   * IT IS TIME, NOT A SCORE. It used to be the reserve times thirty —
   * "how much GROUND SPRINTING this bar is worth" — so a cruising queen
   * watched it fall by two tenths in a real second and rightly called
   * it broken.
   */
  it('reads thirty seconds of sprinting from a full bar', () => {
    expect(secondsIn(enduranceWords(1, SPRINT_DRAIN))).toBeCloseTo(30, 0);
  });

  it('reads five minutes of hard climbing from a full bar', () => {
    expect(secondsIn(enduranceWords(1, CLIMB_DRAIN))).toBeCloseTo(300, -1);
  });

  /**
   * THIRTY MINUTES, because that is how long a real one stays up.
   * Markin et al. tracked mating flights and had the females down
   * again inside half an hour; the five and a half minutes this used
   * to say was invented.
   */
  it('reads thirty minutes of cruising from a full bar', () => {
    expect(secondsIn(enduranceWords(1, CRUISE_DRAIN))).toBeCloseTo(1800, -1);
  });

  it('costs more to climb than to cruise, and more still to sprint', () => {
    expect(CLIMB_DRAIN).toBeGreaterThan(CRUISE_DRAIN);
    expect(SPRINT_DRAIN).toBeGreaterThan(CLIMB_DRAIN);
  });

  it('halves when the reserve halves', () => {
    expect(secondsIn(enduranceWords(0.5, SPRINT_DRAIN))).toBeCloseTo(15, 0);
  });

  it('changes the moment the activity does', () => {
    const sprint = secondsIn(enduranceWords(1, SPRINT_DRAIN));
    const cruise = secondsIn(enduranceWords(1, CRUISE_DRAIN));
    expect(cruise).toBeGreaterThan(sprint * 5);
  });

  it('never shows a countdown while she is getting her breath back', () => {
    for (const rate of [MOVING_RECOVERY, RESTING_RECOVERY]) {
      const words = enduranceWords(0.4, rate);
      expect(words).toMatch(/FULL IN/);
      // Not a depletion timer wearing a different hat.
      expect(words).not.toMatch(/^[\d.]+s$/);
    }
  });

  it('counts up to full at the rate she is actually recovering', () => {
    // Half empty, resting at 1/30 per second: fifteen seconds to go.
    expect(secondsIn(enduranceWords(0.5, RESTING_RECOVERY))).toBeCloseTo(15, 0);
  });

  it('says FULL when it is full, and READY when nothing is happening', () => {
    expect(enduranceWords(1, RESTING_RECOVERY)).toBe('FULL');
    expect(enduranceWords(1, 0)).toBe('FULL');
    expect(enduranceWords(0.6, 0)).toBe('READY');
  });

  it('is the same number at every frame rate', () => {
    // Drive the real reserve for ten simulated seconds of sprinting at
    // several frame rates, and read the ETA off each.
    const read = [120, 60, 30, 10, 4].map((fps) => {
      const stamina = new Stamina();
      const dt = 1 / fps;
      for (let t = 0; t < 10 - 1e-9; t += dt) stamina.update(SPRINT_DRAIN, dt);
      return secondsIn(enduranceWords(stamina.fraction, SPRINT_DRAIN));
    });
    for (const value of read) expect(value).toBeCloseTo(20, 0);
    expect(Math.max(...read) - Math.min(...read)).toBeLessThan(0.5);
  });

  it('drops at once when a takeoff takes its lump', () => {
    const stamina = new Stamina();
    const before = secondsIn(enduranceWords(stamina.fraction, CRUISE_DRAIN));
    stamina.spend(0.03);
    const after = secondsIn(enduranceWords(stamina.fraction, CRUISE_DRAIN));
    expect(after).toBeLessThan(before);
    // And the new figure is the new reserve at the new workload, not a
    // leftover of the old one.
    expect(after).toBeCloseTo(0.97 / CRUISE_DRAIN, -1);
  });

  it('holds no stale text between two different activities', () => {
    const climbing = enduranceWords(0.5, CLIMB_DRAIN);
    const cruising = enduranceWords(0.5, CRUISE_DRAIN);
    expect(climbing).not.toBe(cruising);
  });
});
