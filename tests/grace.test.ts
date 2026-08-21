import { describe, expect, it } from 'vitest';
import { Grace, GRACE_SECONDS } from '../src/ant/grace';

/** A clock the test drives, standing in for the device's or a server's. */
function clock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    pass: (seconds: number) => { now += seconds * 1000; },
    set: (at: number) => { now = at; },
  };
}

describe('spawn grace', () => {
  it('does not protect a queen who has not arrived', () => {
    const grace = new Grace(clock().now);
    expect(grace.active).toBe(false);
    expect(grace.shielded).toBe(false);
    expect(grace.disarmed).toBe(false);
    expect(grace.seconds).toBe(0);
    expect(grace.issued).toBeNull();
  });

  it('lasts five minutes from arrival', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    expect(grace.seconds).toBeCloseTo(GRACE_SECONDS, 6);

    time.pass(GRACE_SECONDS - 1);
    expect(grace.active).toBe(true);
    time.pass(1);
    expect(grace.active).toBe(false);
    expect(grace.seconds).toBe(0);
  });

  /**
   * THE RULE, not a countdown. Nothing calls into this object between
   * the spawn and the check — no update, no frames, no ticks — and the
   * answer is still right, because the answer is `now < endsAt`.
   */
  it('is a deadline that needs nobody watching it', () => {
    const time = clock();
    const grace = new Grace(time.now);
    const issued = grace.begin();
    expect(issued.endsAt - issued.spawnedAt).toBe(GRACE_SECONDS * 1000);

    time.pass(120);
    expect(grace.seconds).toBeCloseTo(180, 6);
    time.pass(200);
    expect(grace.active).toBe(false);
  });

  /**
   * The exploit the old subtracted timer had. It advanced only by the
   * frame deltas the game had seen, and those were clamped to 0.1 s so
   * a backgrounded tab could not teleport the ant. Four minutes on the
   * home screen therefore cost almost no protection at all.
   */
  it('cannot be paused by backgrounding the game', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();

    // Away for four minutes. Not one frame is rendered.
    time.pass(240);
    expect(grace.seconds).toBeCloseTo(60, 6);
    time.pass(61);
    expect(grace.active).toBe(false);
  });

  it('protects and disarms as one value, at every point', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    for (let step = 0; step <= GRACE_SECONDS + 30; step += 7) {
      expect(grace.shielded).toBe(grace.disarmed);
      expect(grace.damageReceivedMultiplier)
        .toBe(grace.damageDealtMultiplier);
      time.pass(7);
    }
  });

  it('is ignored by hostiles for exactly as long as it protects', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    // Being unkillable is no use if a spider can stand over you and
    // wait, so the targeting rule runs on the same deadline.
    expect(grace.ignoredByHostiles).toBe(true);
    time.pass(GRACE_SECONDS + 1);
    expect(grace.ignoredByHostiles).toBe(false);
  });

  it('zeroes damage both ways while it runs, and neither after', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    expect(grace.damageReceivedMultiplier).toBe(0);
    expect(grace.damageDealtMultiplier).toBe(0);
    time.pass(GRACE_SECONDS + 1);
    expect(grace.damageReceivedMultiplier).toBe(1);
    expect(grace.damageDealtMultiplier).toBe(1);
  });

  it('announces the lapse exactly once', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    expect(grace.takeExpiry()).toBe(false);

    time.pass(GRACE_SECONDS + 1);
    expect(grace.takeExpiry()).toBe(true);
    // Every frame after must not re-announce it.
    for (let i = 0; i < 50; i += 1) {
      time.pass(0.1);
      expect(grace.takeExpiry()).toBe(false);
    }
  });

  it('announces a lapse that happened while the game was away', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    time.pass(GRACE_SECONDS * 3);
    expect(grace.takeExpiry()).toBe(true);
  });

  it('restarts on a new queen rather than topping up', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    time.pass(200);
    expect(grace.seconds).toBeCloseTo(100, 6);

    grace.begin();
    expect(grace.seconds).toBeCloseTo(GRACE_SECONDS, 6);
    expect(grace.takeExpiry()).toBe(false);
  });

  it('can be given up early', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    grace.end();
    expect(grace.active).toBe(false);
    expect(grace.seconds).toBe(0);
    expect(grace.takeExpiry()).toBe(true);
  });

  it('never counts below zero', () => {
    const time = clock();
    const grace = new Grace(time.now);
    grace.begin();
    time.pass(GRACE_SECONDS * 10);
    expect(grace.seconds).toBe(0);
  });

  describe('taking up a deadline decided elsewhere', () => {
    it('resumes a record it is handed', () => {
      const time = clock();
      const grace = new Grace(time.now);
      const resumed = grace.resume({
        spawnedAt: time.now() - 100_000,
        endsAt: time.now() + 200_000,
      });
      expect(resumed).toBe(true);
      expect(grace.active).toBe(true);
      expect(grace.seconds).toBeCloseTo(200, 6);
    });

    it('accepts one that has already lapsed, and says so', () => {
      const time = clock();
      const grace = new Grace(time.now);
      expect(grace.resume({
        spawnedAt: time.now() - 900_000,
        endsAt: time.now() - 600_000,
      })).toBe(true);
      expect(grace.active).toBe(false);
      // Already over before it was resumed: there is no moment to announce.
      expect(grace.takeExpiry()).toBe(false);
    });

    /**
     * A stored record is not trustworthy input. It can come from an
     * older build, a wrong clock, or a text editor — and the one thing
     * it must never be able to do is mint more protection than the rule
     * allows.
     */
    it('refuses a record that would grant more than five minutes', () => {
      const time = clock();
      const grace = new Grace(time.now);
      expect(grace.resume({
        spawnedAt: time.now(),
        endsAt: time.now() + GRACE_SECONDS * 1000 * 6,
      })).toBe(false);
      expect(grace.active).toBe(false);
    });

    it('refuses a record with a deadline far in the future', () => {
      const time = clock();
      const grace = new Grace(time.now);
      // A plausible five-minute span, but issued in the year 2200.
      const then = time.now() + 5_000_000_000;
      expect(grace.resume({ spawnedAt: then, endsAt: then + 300_000 }))
        .toBe(false);
      expect(grace.active).toBe(false);
    });

    it('refuses rubbish', () => {
      const grace = new Grace(clock().now);
      expect(grace.resume(null)).toBe(false);
      expect(grace.resume({ spawnedAt: NaN, endsAt: 1 })).toBe(false);
      expect(grace.resume({ spawnedAt: 1, endsAt: Infinity })).toBe(false);
      expect(grace.active).toBe(false);
    });

    it('hands out a record that survives being stored and read back', () => {
      const time = clock();
      const grace = new Grace(time.now);
      grace.begin();
      const stored = JSON.parse(JSON.stringify(grace.issued));

      // Another session, on another object, two minutes later.
      time.pass(120);
      const later = new Grace(time.now);
      expect(later.resume(stored)).toBe(true);
      expect(later.seconds).toBeCloseTo(GRACE_SECONDS - 120, 6);
    });

    it('forgets it when asked', () => {
      const time = clock();
      const grace = new Grace(time.now);
      grace.begin();
      grace.clear();
      expect(grace.issued).toBeNull();
      expect(grace.active).toBe(false);
    });
  });
});
