import { describe, expect, it } from 'vitest';
import {
  AUTO_AIRSPEED, CRUISE_SPEED, Flight, MAX_POWERED_SPEED, STALL_SPEED,
  TERMINAL_FALL, setFlightScale,
} from '../src/ant/flight';
import { WANDER_RATE } from '../src/ant/wander';
import { cancelsAuto } from '../src/input/autoRun';

const NEUTRAL = { push: 0, side: 0, lift: 0 };

/** Get her airborne and settled, then hand back the model. */
function aloft(hold: number | null = null, seconds = 3, fps = 60) {
  setFlightScale(1);
  const flight = new Flight();
  flight.takeOff(7, 1, 0);
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) {
    flight.update({ ...NEUTRAL, push: 1, hold }, 1, false, dt);
  }
  return flight;
}

function run(
  flight: Flight, demand: Partial<typeof NEUTRAL> & { hold?: number | null },
  seconds: number, fps = 60, reserve = 1,
) {
  const dt = 1 / fps;
  let last = { effort: 0, ahead: 0, across: 0, rise: 0 };
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    last = flight.update({ ...NEUTRAL, ...demand }, reserve, false, dt);
  }
  return last;
}

describe('Auto in the air', () => {
  it('has flight targets of its own, not the ground pace speeds', () => {
    // A crawl on the ground is 2.2 units/s. An ant moving that slowly
    // is not flying, and Auto must never ask her to.
    expect(AUTO_AIRSPEED.crawl).toBeGreaterThan(STALL_SPEED);
    expect(AUTO_AIRSPEED.walk).toBe(CRUISE_SPEED);
    expect(AUTO_AIRSPEED.run).toBe(MAX_POWERED_SPEED);
  });

  it('keeps her flying with the stick released', () => {
    const flight = aloft(AUTO_AIRSPEED.run);
    const step = run(flight, { hold: AUTO_AIRSPEED.run }, 8);
    expect(step.ahead).toBeGreaterThan(AUTO_AIRSPEED.run * 0.9);
    expect(flight.where).toBe('powered');
  });

  it('holds the pace it was given rather than everything it has', () => {
    const cruise = aloft(AUTO_AIRSPEED.walk);
    run(cruise, { hold: AUTO_AIRSPEED.walk }, 10);
    expect(cruise.airspeed).toBeCloseTo(AUTO_AIRSPEED.walk, 0);
    expect(cruise.airspeed).toBeLessThan(AUTO_AIRSPEED.run * 0.8);
  });

  it('settles onto its target from above as well as below', () => {
    const fast = aloft(null, 10);
    run(fast, { push: 1 }, 6);
    expect(fast.airspeed).toBeGreaterThan(AUTO_AIRSPEED.walk);
    run(fast, { hold: AUTO_AIRSPEED.crawl }, 25);
    expect(fast.airspeed).toBeCloseTo(AUTO_AIRSPEED.crawl, 0);
  });

  it('reaches the same speed at every frame rate', () => {
    const reached = [120, 60, 30, 10, 4].map((fps) => {
      const flight = aloft(AUTO_AIRSPEED.walk, 3, fps);
      run(flight, { hold: AUTO_AIRSPEED.walk }, 12, fps);
      return flight.airspeed;
    });
    expect(Math.max(...reached) - Math.min(...reached)).toBeLessThan(0.5);
  });

  it('still steers, and steering does not give Auto up', () => {
    const flight = aloft(AUTO_AIRSPEED.run);
    const before = flight.heading;
    run(flight, { hold: AUTO_AIRSPEED.run, side: 1 }, 1);
    expect(flight.heading).not.toBeCloseTo(before, 3);
    expect(Math.abs(flight.roll)).toBeGreaterThan(0.1);
    // A lateral stick is not a fore/aft intent, so Auto survives it.
    expect(cancelsAuto({ x: 1, y: 0 })).toBe(false);
  });

  it('climbs and descends without giving Auto up', () => {
    const climb = aloft(AUTO_AIRSPEED.walk);
    const up = run(climb, { hold: AUTO_AIRSPEED.walk, lift: 1 }, 1);
    expect(up.rise).toBeGreaterThan(0);

    const dive = aloft(AUTO_AIRSPEED.walk);
    const down = run(dive, { hold: AUTO_AIRSPEED.walk, lift: -1 }, 1);
    expect(down.rise).toBeLessThan(0);
    // Neither button is a fore/aft stick push.
    expect(cancelsAuto({ x: 0, y: 0 })).toBe(false);
  });

  it('is given up by a deliberate fore or aft push, as on the ground', () => {
    expect(cancelsAuto({ x: 0, y: 1 })).toBe(true);
    expect(cancelsAuto({ x: 0, y: -1 })).toBe(true);
    expect(cancelsAuto({ x: 0.9, y: 0.08 })).toBe(false);
  });

  it('never flies her backwards', () => {
    const flight = aloft(AUTO_AIRSPEED.run);
    for (const hold of [AUTO_AIRSPEED.crawl, AUTO_AIRSPEED.walk, AUTO_AIRSPEED.run]) {
      const step = run(flight, { hold }, 5);
      expect(step.ahead).toBeGreaterThanOrEqual(0);
    }
    expect(flight.airspeed).toBeGreaterThanOrEqual(0);
  });

  it('costs her breath, because the wings are working', () => {
    const flight = aloft(AUTO_AIRSPEED.run);
    const step = run(flight, { hold: AUTO_AIRSPEED.run }, 2);
    // Powered flight SPENDS. Reading Auto as neutral would have had
    // her gliding and recovering while holding full airspeed.
    expect(step.effort).toBeGreaterThan(0);
  });
});

describe('nothing hangs in the sky', () => {
  it('glides while there is airspeed to glide on', () => {
    const flight = aloft(null, 6);
    const step = run(flight, {}, 0.5);
    expect(flight.airspeed).toBeGreaterThan(STALL_SPEED);
    // A glide goes further forward than it goes down.
    expect(step.ahead).toBeGreaterThan(Math.abs(step.rise));
    expect(flight.where).toBe('glide');
  });

  /**
   * THE BUG. Sink used to be airspeed / glideRatio, so as airspeed
   * decayed the descent decayed with it and she ended up hovering for
   * free. Descent must GROW as she runs out of speed, not shrink.
   */
  it('sinks faster as its airspeed runs out, not slower', () => {
    const flight = aloft(null, 6);
    const early = run(flight, {}, 1);
    const earlySpeed = flight.airspeed;
    const late = run(flight, {}, 40);
    expect(flight.airspeed).toBeLessThan(earlySpeed);
    expect(Math.abs(late.rise)).toBeGreaterThan(Math.abs(early.rise));
  });

  it('approaches a terminal fall rather than a hover', () => {
    const flight = aloft(null, 6);
    const step = run(flight, {}, 120);
    expect(flight.airspeed).toBeLessThan(STALL_SPEED * 0.5);
    expect(-step.rise).toBeGreaterThan(TERMINAL_FALL * 0.7);
  });

  it('never falls faster than terminal under its own weight', () => {
    // TERMINAL IS RELATIVE TO THE AIR, not to the island. Her own
    // weight against her own drag settles at TERMINAL_FALL; air that is
    // itself sinking carries her that much faster over the ground, and
    // pretending otherwise would be the model lying about which frame
    // the number is measured in. The wander is bounded, so the ceiling
    // is still a ceiling — just a named one.
    const flight = aloft(null, 6);
    const dt = 1 / 60;
    for (let t = 0; t < 200; t += dt) {
      const step = flight.update(NEUTRAL, 1, false, dt);
      expect(-step.rise).toBeLessThanOrEqual(TERMINAL_FALL + WANDER_RATE + 1e-6);
    }
  });

  it('comes down even on a full reserve, if nothing is asked of her', () => {
    const flight = aloft(null, 6);
    const was = flight.height;
    run(flight, {}, 30, 60, 1);
    expect(flight.height).toBeLessThan(was);
  });

  it('falls the same way at every frame rate', () => {
    const sank = [120, 60, 30, 10].map((fps) => {
      const flight = aloft(null, 6, fps);
      run(flight, {}, 30, fps);
      return flight.airspeed;
    });
    const spread = Math.max(...sank) - Math.min(...sank);
    expect(spread).toBeLessThan(1.5);
  });

  it('still answers a climb after it has stalled', () => {
    // IT ANSWERS BY ARRESTING THE SINK FIRST, which is a change: the
    // climb used to be assigned straight to her vertical rate, so a
    // metre-a-second descent became a climb between two frames. The
    // lever ramps its authority and the model eases toward it — you
    // cannot reverse a queen's descent instantly and should not look
    // as though you can — so half a second buys a large improvement
    // and a few seconds buys the climb.
    const flight = aloft(null, 6);
    const sinking = run(flight, {}, 60);
    const pulled = run(flight, { lift: 1 }, 0.5);
    expect(pulled.rise).toBeGreaterThan(sinking.rise + 30);
    expect(run(flight, { lift: 1 }, 4).rise).toBeGreaterThan(0);
  });
});
