import { describe, expect, it } from 'vitest';
import { WANDER, WANDER_RATE, Wander } from '../src/ant/wander';
import { Flight, setFlightScale } from '../src/ant/flight';

const NEUTRAL = { push: 0, side: 0, climb: false, descend: false };
const HOLD = { push: 1, side: 0, climb: false, descend: false };

describe('the air she is in', () => {
  it('never carries her outside the band, however long she flies', () => {
    // THE WHOLE POINT. A random walk on her RATE integrates into an
    // unbounded altitude error — fly for a minute and she is somewhere
    // else vertically. This returns the exact derivative of a bounded
    // function, so the bound is arithmetic and not luck.
    const air = new Wander();
    for (let t = 0; t < 600; t += 1 / 60) {
      air.advance(1 / 60);
      expect(Math.abs(air.offset)).toBeLessThanOrEqual(WANDER + 1e-9);
      expect(Math.abs(air.rate)).toBeLessThanOrEqual(WANDER_RATE + 1e-9);
    }
  });

  it('agrees with its own integral, which is what makes the bound real', () => {
    // Accumulate the rate by hand and it must track the closed-form
    // offset. If these ever part company the bound above is decorative.
    const air = new Wander();
    const dt = 1 / 240;
    let summed = air.offset;
    for (let t = 0; t < 40; t += dt) {
      summed += air.rate * dt;
      air.advance(dt);
    }
    expect(summed).toBeCloseTo(air.offset, 3);
  });

  it('does not repeat inside any span a player watches', () => {
    // Three incommensurate periods. If it were periodic at, say, thirty
    // seconds, a held cruise would visibly loop.
    const air = new Wander();
    const first: number[] = [];
    for (let i = 0; i < 60; i++) { first.push(air.offset); air.advance(0.5); }
    const later: number[] = [];
    for (let i = 0; i < 60; i++) { later.push(air.offset); air.advance(0.5); }
    const apart = first.reduce((m, v, i) => Math.max(m, Math.abs(v - later[i])), 0);
    expect(apart).toBeGreaterThan(WANDER * 0.3);
  });

  it('starts fresh, so two flights are not mid-gust', () => {
    const air = new Wander();
    const opening = air.offset;
    air.advance(7.3);
    expect(air.offset).not.toBeCloseTo(opening, 3);
    air.reset();
    expect(air.offset).toBeCloseTo(opening, 12);
  });
});

describe('the queen holding a cruise', () => {
  it('breathes rather than freezing at a dead-level zero', () => {
    setFlightScale(1);
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    const dt = 1 / 60;
    for (let t = 0; t < 4; t += dt) flight.update(HOLD, 1, false, dt);

    const rates: number[] = [];
    for (let t = 0; t < 12; t += dt) {
      flight.update(HOLD, 1, false, dt);
      rates.push(flight.climbing);
    }
    const moved = Math.max(...rates) - Math.min(...rates);
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThanOrEqual(2 * WANDER_RATE + 1e-6);
  });

  it('holds its altitude anyway — the air is a disturbance, not a drift', () => {
    // Powered level flight for two minutes. If the wander leaked into
    // her real vertical rate she would end the run metres away.
    setFlightScale(1);
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    const dt = 1 / 60;
    for (let t = 0; t < 4; t += dt) flight.update(HOLD, 1, false, dt);
    const settled = flight.height;
    for (let t = 0; t < 120; t += dt) flight.update(HOLD, 1, false, dt);
    expect(Math.abs(flight.height - settled)).toBeLessThanOrEqual(2 * WANDER + 1e-6);
  });

  it('leaves a glide coming down at the rate the glide says', () => {
    // The disturbance must not swamp the model it is riding on.
    setFlightScale(1);
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    const dt = 1 / 60;
    for (let t = 0; t < 6; t += dt) flight.update(NEUTRAL, 1, false, dt);
    expect(flight.climbing).toBeLessThan(-WANDER_RATE * 4);
  });
});
