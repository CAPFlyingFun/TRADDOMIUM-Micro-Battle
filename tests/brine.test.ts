/**
 * THE SEA'S CLOCK ON HER — sixty free seconds, then one percent of her
 * MAXIMUM every thirty, stopping the instant she is out and forgiven
 * only after thirty continuous seconds ashore.
 *
 * The clock answers in TICKS and the scene multiplies each by
 * maxHealth * SALT_DAMAGE_FRACTION — always the maximum, never what
 * is left, which is what makes the toll fixed and the death reachable.
 */
import { describe, expect, it } from 'vitest';
import {
  SaltExposure,
  SALT_DAMAGE_FRACTION,
  SALT_DAMAGE_INTERVAL_SECONDS,
  SALT_GRACE_SECONDS,
  SALT_RECOVERY_SECONDS,
} from '../src/ant/brine';

const TICK = 1 / 60;

/** Run `seconds` of exposure at 60 fps, returning total ticks owed. */
function soak(salt: SaltExposure, seconds: number, inSalt = true): number {
  let ticks = 0;
  for (let t = 0; t < seconds - 1e-9; t += TICK) ticks += salt.update(inSalt, TICK);
  return ticks;
}

describe('the grace period', () => {
  it('charges nothing for 59 seconds in the sea', () => {
    const salt = new SaltExposure();
    expect(soak(salt, 59)).toBe(0);
    expect(salt.burning).toBe(false);
  });

  it('is in the damaging phase past 60, but the first tick waits for 90', () => {
    const salt = new SaltExposure();
    expect(soak(salt, 61)).toBe(0);       // phase begun, nothing owed yet
    expect(salt.burning).toBe(true);
    expect(soak(salt, 30)).toBe(1);       // …and the first tick lands at 90
  });
});

describe('the toll', () => {
  it('is one tick per interval, however many intervals pass', () => {
    const salt = new SaltExposure();
    const ticks = soak(salt, SALT_GRACE_SECONDS + 10 * SALT_DAMAGE_INTERVAL_SECONDS + 1);
    expect(ticks).toBe(10);
  });

  it('is a fixed fraction of MAXIMUM health, so a full queen can actually die', () => {
    // 1% of max per tick — 100 ticks from full whatever "current" is.
    // At 120 max that is 1.2 a tick; fifty minutes of damaging
    // exposure, exactly as the design says.
    expect(SALT_DAMAGE_FRACTION).toBe(0.01);
    const ticksToDie = Math.ceil(1 / SALT_DAMAGE_FRACTION);
    expect(ticksToDie * SALT_DAMAGE_INTERVAL_SECONDS).toBe(3000); // 50 min
  });

  it('never loses a tick to a huge frame', () => {
    // One giant dt spanning the grace and 118 whole intervals must
    // yield every one of them, not just the last.
    const salt = new SaltExposure();
    expect(salt.update(true, 3600)).toBe(
      Math.floor((3600 - SALT_GRACE_SECONDS) / SALT_DAMAGE_INTERVAL_SECONDS),
    );
  });

  it('owes the same total at 30, 60 and 120 fps', () => {
    const seconds = SALT_GRACE_SECONDS + 4 * SALT_DAMAGE_INTERVAL_SECONDS + 1;
    for (const fps of [30, 60, 120]) {
      const salt = new SaltExposure();
      let ticks = 0;
      for (let t = 0; t < seconds; t += 1 / fps) ticks += salt.update(true, 1 / fps);
      expect(ticks).toBe(4);
    }
  });
});

describe('leaving the sea', () => {
  it('stops the toll immediately', () => {
    const salt = new SaltExposure();
    soak(salt, SALT_GRACE_SECONDS + SALT_DAMAGE_INTERVAL_SECONDS + 1); // one tick paid
    expect(salt.burning).toBe(true);
    expect(salt.update(false, TICK)).toBe(0);
    expect(salt.burning).toBe(false);
    expect(soak(salt, 300, false)).toBe(0);       // however long she stays out
  });

  it('does not forgive exposure for a one-frame touch of the beach', () => {
    const salt = new SaltExposure();
    soak(salt, SALT_GRACE_SECONDS + SALT_DAMAGE_INTERVAL_SECONDS + 1); // paid 1, at 91 s
    soak(salt, SALT_RECOVERY_SECONDS - 1, false); // 29 s ashore — not enough
    // Re-entering resumes the old clock: the next tick is one interval
    // past the last one, not a fresh grace period away.
    expect(soak(salt, SALT_DAMAGE_INTERVAL_SECONDS)).toBe(1);
  });

  it('forgives everything after thirty continuous seconds ashore', () => {
    const salt = new SaltExposure();
    soak(salt, SALT_GRACE_SECONDS + SALT_DAMAGE_INTERVAL_SECONDS + 1);
    soak(salt, SALT_RECOVERY_SECONDS + 1, false); // fully recovered
    expect(salt.exposureSeconds).toBe(0);
    expect(soak(salt, 59)).toBe(0);               // the whole grace again
    expect(salt.burning).toBe(false);
  });

  it('a fresh queen starts clean', () => {
    const salt = new SaltExposure();
    soak(salt, 200);
    salt.clear();
    expect(salt.exposureSeconds).toBe(0);
    expect(salt.burning).toBe(false);
    expect(soak(salt, 59)).toBe(0);
  });
});
