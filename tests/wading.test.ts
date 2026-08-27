import { afterEach, describe, expect, it } from 'vitest';
import { wadeAt, canDrink, FOOTING, DRAUGHT } from '../src/ant/wading';
import { useWaterQuery, type WaterSpot } from '../src/world/waterQuery';

/** Water everywhere, this deep, flowing +x at 10 u/s. */
function flood(depth: number, flowX = 10): void {
  useWaterQuery((): WaterSpot => ({ depth, flowX, flowZ: 0 }));
}
afterEach(() => useWaterQuery(null));

describe('what the water does to her', () => {
  it('is dry where there is no water — or no water system yet', () => {
    expect(wadeAt(0, 0).depth).toBe(0);
    expect(wadeAt(0, 0).pace).toBe(1);
    expect(wadeAt(0, 0).carry).toBeNull();
  });

  it('wades below FOOTING — feet down, slowed, some current', () => {
    flood(FOOTING * 0.5);
    const w = wadeAt(0, 0);
    expect(w.afloat).toBe(false);
    expect(w.above).toBe(0);                     // never hovers while walking
    expect(w.pace).toBeLessThan(1);
    expect(w.pace).toBeGreaterThan(0.4);
    expect(w.carry!.x).toBeGreaterThan(0);
  });

  it('floats past FOOTING — rides the film at her draught', () => {
    flood(100);                                   // a metre of water
    const w = wadeAt(0, 0);
    expect(w.afloat).toBe(true);
    expect(w.above).toBeCloseTo(100 - DRAUGHT, 3);
    expect(w.pace).toBeLessThan(0.3);             // paddling, not walking
    expect(w.carry!.x).toBeCloseTo(8.5, 3);       // 85% of the current
  });

  it('dive pulls her down the column to the bed and no further', () => {
    flood(100);
    expect(wadeAt(0, 0, 0).above).toBeCloseTo(100 - DRAUGHT, 3);
    const half = wadeAt(0, 0, 0.5).above;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(100 - DRAUGHT);
    expect(wadeAt(0, 0, 1).above).toBe(0);        // standing on the bottom
    expect(wadeAt(0, 0, 2).above).toBe(0);        // over-asking clamps
  });

  it('can drink from the bank — the reach ring finds nearby water', () => {
    // Water only to the east of x = 10.
    useWaterQuery((wx) => (wx >= 10 ? { depth: 50, flowX: 0, flowZ: 0 } : null));
    expect(canDrink(0, 0)).toBe(true);            // 16 cm reach crosses x=10
    expect(canDrink(-100, 0)).toBe(false);        // far inland
    expect(canDrink(50, 0)).toBe(true);           // standing in it
  });
});
