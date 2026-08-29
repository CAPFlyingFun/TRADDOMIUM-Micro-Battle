import { afterEach, describe, expect, it } from 'vitest';
import {
  wadeAt, canDrink, swimEffort, FOOTING, DRAUGHT, FLOAT_EXIT, SWIM_DRAIN,
  DIVE_DRAIN,
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

  it('enters the water at FOOTING and leaves it at her DRAUGHT', () => {
    // Two different questions. She starts floating when her legs stop
    // reaching the bed; she stops when there is no longer enough water
    // to hold her up, and that is her draught.
    flood(FOOTING * 0.95);
    expect(wadeAt(0, 0, 0, false).afloat).toBe(false);
    expect(wadeAt(0, 0, 0, true).afloat).toBe(true);
    // Halfway down the band — a millimetre and a half is not deep
    // enough to WALK into as a swim, and is still enough to ride.
    flood(FOOTING * 0.5);
    expect(wadeAt(0, 0, 0, false).afloat).toBe(false);
    expect(wadeAt(0, 0, 0, true).afloat).toBe(true);
    // And under the draught the film is gone; she is aground either way.
    flood(FLOAT_EXIT * 0.9);
    expect(wadeAt(0, 0, 0, true).afloat).toBe(false);
  });

  it('rides a draining pool down instead of being dropped in it', () => {
    // THE BUG, WITH ITS CLOCK. The exit used to be 0.85 × FOOTING =
    // 3.4 mm, and the inland hydrology is live: soak takes 0.3 units a
    // second off a cell nothing is feeding, so a pool sheds about
    // three millimetres a second once a shower stops. Traced on a real
    // order-5 trunk, cells she was floating on crossed 3.4 mm within
    // 0.06 – 0.8 s of the rain ending and put her on the bed with 3.3
    // mm still standing over her — and one settled at 1.7 mm and
    // stayed, leaving her seated under water that was not going away.
    let afloat = true;
    for (const depth of [1.09, 0.8, 0.5, 0.35, 0.25, 0.171]) {
      flood(depth);
      afloat = wadeAt(0, 0, 0, afloat).afloat;
      expect(afloat).toBe(true);
    }
    // Still floating on the 1.7 mm the pool actually settled at.
    expect(wadeAt(0, 0, 0, true).above).toBeCloseTo(0.171 - DRAUGHT, 9);
  });

  it('and settles onto the bed continuously — no drop', () => {
    // The smoothness is not a filter, it is the threshold: `above` is
    // `depth - DRAUGHT`, so exiting AT the draught means her float
    // height has already reached zero when the state changes. The
    // water leaves her on the bed rather than dropping her onto it.
    const above = (d: number) => { flood(d); return wadeAt(0, 0, 0, true).above; };
    expect(above(FLOAT_EXIT)).toBe(0);
    // Walk the whole descent and watch for a step. Nothing may fall
    // faster than the water itself does.
    let last = above(FOOTING);
    for (let d = FOOTING; d >= FLOAT_EXIT; d -= 0.001) {
      const now = above(d);
      expect(last - now).toBeLessThanOrEqual(0.001 + 1e-9);
      last = now;
    }
    // The loop lands a step short of the exit; what matters is that it
    // arrives there with a step's worth of height left, not a leap.
    expect(last).toBeLessThanOrEqual(0.001 + 1e-9);
    // …and the last frame afloat and the first frame aground agree.
    flood(FLOAT_EXIT * 0.999);
    const aground = wadeAt(0, 0, 0, true);
    expect(aground.afloat).toBe(false);
    expect(aground.above).toBe(0);
  });

  it('keeps the water over her continuous across the same line', () => {
    // Breath reads `depth - above`. Afloat that is her draught; aground
    // it is the whole depth — and at the exit they are the same number,
    // so nothing about her head being under can flick there either.
    flood(FLOAT_EXIT);
    const on = wadeAt(0, 0, 0, true);
    flood(FLOAT_EXIT * 0.999);
    const off = wadeAt(0, 0, 0, true);
    expect(on.depth - on.above).toBeCloseTo(off.depth - off.above, 3);
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
