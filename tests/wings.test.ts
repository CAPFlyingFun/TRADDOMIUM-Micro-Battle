import { describe, expect, it } from 'vitest';
import { DRY_SECONDS, RAIN_STRETCH, Wings, dryingRate } from '../src/ant/wings';

/** Run the clock for `seconds` in steps a phone would actually produce. */
function run(
  w: Wings, seconds: number,
  { water = true, under = false, rain = 0 } = {},
): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) w.update(step, water, under, rain);
}

/** The frame she touches the water, which is what arms the clock. */
function land(w: Wings): void {
  w.update(1 / 60, true, false, 0);
}

describe('a dry queen', () => {
  it('can fly, and has nothing to show', () => {
    const w = new Wings();
    expect(w.wet).toBe(false);
    expect(w.seconds).toBeNull();
    expect(w.held).toBe(false);
  });

  it('stays dry however long she is ticked out of the water', () => {
    const w = new Wings();
    run(w, 120, { water: false });
    expect(w.wet).toBe(false);
  });
});

describe('she lands in the water', () => {
  it('grounds her for thirty seconds', () => {
    const w = new Wings();
    land(w);
    expect(w.wet).toBe(true);
    expect(w.seconds).toBeGreaterThan(DRY_SECONDS - 0.1);
  });

  it('and dries in that time, afloat, out of the rain', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS - 1);
    expect(w.wet).toBe(true);
    run(w, 2);
    expect(w.wet).toBe(false);
    expect(w.seconds).toBeNull();
  });

  it('reports the finishing frame exactly once', () => {
    const w = new Wings();
    let done = 0;
    for (let t = 0; t < DRY_SECONDS + 5; t += 1 / 60) {
      if (w.update(1 / 60, true, false, 0)) done++;
    }
    expect(done).toBe(1);
  });

  it('and a takeoff then a second landing wets her again', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS + 1);
    expect(w.wet).toBe(false);
    // Airborne: the scene stops calling her in the water at all.
    run(w, 5, { water: false });
    expect(w.wet).toBe(false);
    land(w);
    expect(w.wet).toBe(true);
  });
});

describe('floating dries her', () => {
  it('and she can fly off the water she landed on', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS + 1);
    expect(w.wet).toBe(false);
  });

  /**
   * THE BUG THIS FILE CAUGHT, kept as a test. The first version armed
   * the clock on CONTACT rather than on the water's EDGE, so the frame
   * she dried wetted her again and a floating queen was grounded for
   * ever - the exact trap the whole feature exists to open.
   */
  it('however long she stays out there afterwards', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS * 4);
    expect(w.wet).toBe(false);
    expect(w.seconds).toBeNull();
  });

  it('and reaching dry land finishes a count it did not start', () => {
    const w = new Wings();
    land(w);
    run(w, 20);
    const left = w.seconds!;
    run(w, left + 1, { water: false });
    expect(w.wet).toBe(false);
  });
});

describe('she dives while drying', () => {
  it('stops the clock and hides it', () => {
    const w = new Wings();
    land(w);
    run(w, 20);
    const left = w.seconds!;
    expect(left).toBeGreaterThan(9);
    expect(left).toBeLessThan(11);

    run(w, 5, { under: true });
    expect(w.wet).toBe(true);
    expect(w.held).toBe(true);
    // Stopped AND hidden — Joshua's wording, and both halves matter:
    // a number frozen on screen reads as a bug.
    expect(w.seconds).toBeNull();
  });

  it('and resurfacing starts over at a full thirty, not at what was left', () => {
    const w = new Wings();
    land(w);
    run(w, 20);
    run(w, 5, { under: true });
    // One frame back at the surface is enough to rearm it.
    w.update(1 / 60, true, false, 0);
    expect(w.seconds).toBeGreaterThan(DRY_SECONDS - 0.1);
    expect(w.held).toBe(false);
  });

  it('so a queen who keeps diving never gets airborne', () => {
    const w = new Wings();
    land(w);
    for (let i = 0; i < 6; i++) {
      run(w, 25);
      run(w, 1, { under: true });
    }
    expect(w.wet).toBe(true);
  });

  it('and a dive after she has dried costs her the thirty again', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS + 1);
    expect(w.wet).toBe(false);
    run(w, 1, { under: true });
    w.update(1 / 60, true, false, 0);
    expect(w.wet).toBe(true);
    expect(w.seconds).toBeGreaterThan(DRY_SECONDS - 0.1);
  });
});

describe('rain stretches the clock rather than stopping it', () => {
  it('halves the rate in the heaviest rain', () => {
    expect(dryingRate(0)).toBe(1);
    expect(dryingRate(1)).toBeCloseTo(1 / RAIN_STRETCH, 12);
  });

  it('and clamps a dial that arrives out of range', () => {
    expect(dryingRate(-1)).toBe(1);
    expect(dryingRate(4)).toBeCloseTo(1 / RAIN_STRETCH, 12);
  });

  it('so a squall costs her the whole thirty seconds again', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS + 1, { rain: 1 });
    expect(w.wet).toBe(true);
    run(w, DRY_SECONDS, { rain: 1 });
    expect(w.wet).toBe(false);
  });

  /**
   * The survival invariant, stated as a test: rain may only SLOW the
   * clock. A rain that stopped it would leave her with no move of her
   * own that reaches dry wings, which is the shape CLAUDE.md forbids.
   */
  it('and never stops it, however hard it falls', () => {
    const w = new Wings();
    land(w);
    run(w, DRY_SECONDS * RAIN_STRETCH + 2, { rain: 99 });
    expect(w.wet).toBe(false);
  });
});
