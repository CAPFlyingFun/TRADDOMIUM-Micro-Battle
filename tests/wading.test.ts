import { afterEach, describe, expect, it } from 'vitest';
import {
  wadeAt, canDrink, swimEffort, FOOTING, DRAUGHT, SWIM_DRAIN, DIVE_DRAIN,
} from '../src/ant/wading';
import { OCEAN_STAMINA_MULTIPLIER } from '../src/ant/brine';
import { MOVING_RECOVERY } from '../src/ant/stamina';
import { useWaterQuery, type WaterSpot } from '../src/world/waterQuery';

/** Water everywhere, this deep, flowing +x at 10 u/s. */
function flood(depth: number, flowX = 10, salt = false): void {
  useWaterQuery((): WaterSpot => ({ depth, flowX, flowZ: 0, salt }));
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

  it('says which water is the SEA, and dry land is never salt', () => {
    flood(100, 0, true);
    expect(wadeAt(0, 0).salt).toBe(true);
    expect(wadeAt(0, 0).drinkable).toBe(false);
    flood(100, 0, false);
    expect(wadeAt(0, 0).salt).toBe(false);
    useWaterQuery(null);
    expect(wadeAt(0, 0).salt).toBe(false);
  });

  it('will not drink the sea — salt water refills nothing', () => {
    useWaterQuery((): WaterSpot => ({ depth: 200, flowX: 0, flowZ: 0, salt: true }));
    expect(canDrink(0, 0)).toBe(false);
  });

  it('keeps floating through shoreline noise — the threshold is sticky', () => {
    // A hair under FOOTING: entering on foot she still walks…
    flood(FOOTING * 0.95);
    expect(wadeAt(0, 0, 0, false).afloat).toBe(false);
    // …but already afloat she STAYS afloat through the same depth,
    // so millimetre noise at the line cannot flick her state.
    expect(wadeAt(0, 0, 0, true).afloat).toBe(true);
    // Well below the sticky band she is properly aground either way.
    flood(FOOTING * 0.5);
    expect(wadeAt(0, 0, 0, true).afloat).toBe(false);
  });

  it('can drink from the bank — the reach ring finds nearby water', () => {
    // Water only to the east of x = 10.
    useWaterQuery((wx) => (wx >= 10 ? { depth: 50, flowX: 0, flowZ: 0 } : null));
    expect(canDrink(0, 0)).toBe(true);            // 16 cm reach crosses x=10
    expect(canDrink(-100, 0)).toBe(false);        // far inland
    expect(canDrink(50, 0)).toBe(true);           // standing in it
  });
});

describe('what swimming costs the one reserve', () => {
  it('prices nothing on land — walking is the ground ladder’s job', () => {
    expect(swimEffort(false, false, true, 0)).toBeNull();
    expect(swimEffort(false, true, true, 1)).toBeNull();
  });

  it('rests her while she floats still, in both waters', () => {
    // The film carries her weight; a multiplier on recovery would make
    // the ocean restful, so the sea flag must not touch this.
    expect(swimEffort(true, false, false, 0)).toBe(MOVING_RECOVERY);
    expect(swimEffort(true, true, false, 0)).toBe(MOVING_RECOVERY);
  });

  it('charges fresh paddling at SWIM_DRAIN and the sea half again more', () => {
    expect(swimEffort(true, false, true, 0)).toBeCloseTo(SWIM_DRAIN, 9);
    expect(swimEffort(true, true, true, 0)).toBeCloseTo(
      SWIM_DRAIN * OCEAN_STAMINA_MULTIPLIER, 9,
    );
    expect(OCEAN_STAMINA_MULTIPLIER).toBe(1.5);
  });

  it('adds sprint-grade effort for pushing down, scaled by the push', () => {
    const surface = swimEffort(true, false, true, 0)!;
    expect(swimEffort(true, false, true, 1)!).toBeCloseTo(surface + DIVE_DRAIN, 9);
    expect(swimEffort(true, false, true, 0.5)!).toBeCloseTo(surface + DIVE_DRAIN * 0.5, 9);
    // Over-asking clamps, same as the dive itself does.
    expect(swimEffort(true, false, true, 5)!).toBeCloseTo(surface + DIVE_DRAIN, 9);
    // Diving costs more than surface swimming — the whole point.
    expect(swimEffort(true, true, true, 1)!).toBeGreaterThan(
      swimEffort(true, true, true, 0)!,
    );
  });
});
