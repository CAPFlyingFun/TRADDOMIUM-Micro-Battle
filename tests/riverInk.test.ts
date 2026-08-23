import { describe, expect, it } from 'vitest';
import { MAP_SIZE, riverInk } from '../src/ui/islandMap';
import { ISLAND_SPAN } from '../src/world/heightfield';
import { UNITS_PER_METRE } from '../src/world/kauai';

/** A median Kauaʻi stream: 5.5 real metres across. */
const MEDIAN = 5.5 * UNITS_PER_METRE;
/** The widest reach in the dataset — the Moloaʻa, 36.2 m. */
const WIDEST = 36.2 * UNITS_PER_METRE;

/** World units to a pixel, for a square window `across` units wide. */
const zoom = (across: number) => across / MAP_SIZE;

describe('drawing a river the width it actually is', () => {
  const island = zoom(ISLAND_SPAN);

  it('cannot, on the whole island — and that is a measurement', () => {
    // One pixel is 74 metres here. Faithfully drawn, the entire drainage
    // of Kauaʻi is a grey haze; this is the number that justifies the
    // floor existing at all.
    expect(MEDIAN / island).toBeLessThan(0.1);
    expect(WIDEST / island).toBeLessThan(0.6);
  });

  it('falls back to stream order there, thickest for the trunk', () => {
    const byOrder = [1, 2, 3, 4, 5].map((o) => riverInk(MEDIAN, o, island));
    expect(byOrder).toEqual([...byOrder].sort((a, b) => a - b));
    expect(byOrder[0]).toBeGreaterThan(0.4);
    expect(byOrder[4]).toBeLessThan(3);
  });

  it('is TO SCALE once a pixel is smaller than a river', () => {
    // Four kilometres across: the median stream reaches a pixel and the
    // real width takes over from the floor on its own.
    const near = zoom(400_000);
    expect(riverInk(MEDIAN, 1, near)).toBeCloseTo(MEDIAN / near, 6);
    // Four hundred metres: unmistakably the real river.
    const close = zoom(40_000);
    expect(riverInk(MEDIAN, 1, close)).toBeCloseTo(MEDIAN / close, 6);
    expect(riverInk(MEDIAN, 1, close)).toBeGreaterThan(9);
  });

  it('never draws a river narrower than it is', () => {
    // The floor is a MINIMUM. If it ever became a substitute, a zoomed
    // map would draw the Moloaʻa thinner than a headwater trickle simply
    // because of its order, which is the bug this test exists to stop.
    for (const across of [ISLAND_SPAN, 2_000_000, 400_000, 40_000, 4_000]) {
      const per = zoom(across);
      for (const order of [1, 3, 5]) {
        expect(riverInk(MEDIAN, order, per)).toBeGreaterThanOrEqual(MEDIAN / per);
        expect(riverInk(WIDEST, order, per)).toBeGreaterThanOrEqual(WIDEST / per);
      }
    }
  });

  it('lets a wide low-order reach outdraw a narrow high-order one', () => {
    // Zoomed in, width is the truth and order is irrelevant.
    const close = zoom(40_000);
    expect(riverInk(WIDEST, 1, close)).toBeGreaterThan(riverInk(MEDIAN, 5, close));
    // Zoomed out, order is all that can be seen and it wins.
    const island2 = zoom(ISLAND_SPAN);
    expect(riverInk(WIDEST, 1, island2)).toBeLessThan(riverInk(MEDIAN, 5, island2));
  });

  it('survives an order outside 1..5 rather than reading past the table', () => {
    expect(Number.isFinite(riverInk(MEDIAN, 0, island))).toBe(true);
    expect(Number.isFinite(riverInk(MEDIAN, 9, island))).toBe(true);
  });
});
