/**
 * THE MASTER LOD CORE — the sphere, the dial's feather, the ladder
 * and its memory.
 *
 * The first test here is the whole reason the module exists: distance
 * is TRUE 3D EUCLIDEAN from the queen, never X/Z ground distance. A
 * queen 166 m above the beach is 166 m from that beach's detail. The
 * planar mistake shipped once (an early detail fade measured X/Z only
 * and altitude quietly widened it); this file is why it cannot ship
 * again.
 *
 * Units: world units, one per centimetre — 166 m is 16,600.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  anchorSpeed, DETAIL_FEATHER, detailFraction, detailRadius,
  distanceSqTo, distanceTo, forcedState, forceMicro, forceTier,
  HYSTERESIS_FLOOR, leadDistance,
  type LodProfile, profileFor, profilesSnapshot, registerProfile,
  resetLod, setAnchor, setDetailDial, tierAt,
} from '../src/world/lod';
import { setOrigin } from '../src/world/origin';

const M = 100; // world units to a metre

beforeEach(() => {
  resetLod();
  setOrigin(0, 0);
});

describe('true 3D spherical distance', () => {
  it('counts altitude: 166 m straight up is 166 m away, not zero', () => {
    setAnchor(0, 166 * M, 0);
    expect(distanceTo(0, 0, 0)).toBeCloseTo(166 * M, 6);
  });

  it('uses all three axes', () => {
    // Joshua's example: player (0, 10, 0), object (6, 2, 8) —
    // sqrt(6² + 8² + 8²) = sqrt(164) metres.
    setAnchor(0, 10 * M, 0);
    expect(distanceTo(6 * M, 2 * M, 8 * M))
      .toBeCloseTo(Math.sqrt(164) * M, 6);
  });

  it('squares agree with roots', () => {
    setAnchor(300, 400, 0);
    expect(Math.sqrt(distanceSqTo(0, 0, 0))).toBeCloseTo(distanceTo(0, 0, 0), 9);
  });

  it('does not care where the floating origin sits', () => {
    // The master lives in WORLD coordinates; a rebase moves only the
    // render frame. Same two world points, any origin, same answer.
    setAnchor(2_000_000, 5_000, 2_000_000);
    const before = distanceTo(2_000_600, 5_800, 2_000_800);
    setOrigin(2_000_000, 2_000_000);
    expect(distanceTo(2_000_600, 5_800, 2_000_800)).toBe(before);
  });
});

describe('the micro detail sphere', () => {
  it('at 200% is full to 14 m, feathering, and gone by 20 m', () => {
    setDetailDial(2);
    expect(detailRadius()).toBe(20 * M);
    expect(detailFraction(0)).toBe(1);
    expect(detailFraction(20 * M * DETAIL_FEATHER)).toBe(1); // 14 m
    expect(detailFraction(17 * M)).toBeGreaterThan(0);
    expect(detailFraction(17 * M)).toBeLessThan(1);
    expect(detailFraction(20 * M)).toBe(0);
    expect(detailFraction(166 * M)).toBe(0); // the flight altitude case
  });

  it('feathers monotonically — more distance never earns more detail', () => {
    setDetailDial(1);
    let last = 1;
    for (let d = 0; d <= 1200; d += 25) {
      const f = detailFraction(d);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });
});

const LADDER: LodProfile = {
  name: 'test-tree',
  cls: 'macro',
  tiers: [
    { name: 'full', upTo: 10 * M },
    { name: 'simple', upTo: 40 * M },
    { name: 'billboard', upTo: 200 * M },
    { name: 'hidden', upTo: Infinity },
  ],
};

describe('the tier ladder', () => {
  it('reads the raw rung with no memory', () => {
    expect(tierAt(LADDER, 5 * M).tier.name).toBe('full');
    expect(tierAt(LADDER, 25 * M).tier.name).toBe('simple');
    expect(tierAt(LADDER, 199 * M).tier.name).toBe('billboard');
    expect(tierAt(LADDER, 5_000 * M).tier.name).toBe('hidden');
  });

  it('steps coarser the moment a boundary is crossed', () => {
    const from = tierAt(LADDER, 9 * M).index;      // full
    expect(tierAt(LADDER, 10 * M + 1, from).tier.name).toBe('simple');
  });

  it('latches: stepping finer again asks for the margin back', () => {
    const coarse = tierAt(LADDER, 11 * M).index;    // simple
    // Just back inside the boundary is NOT enough…
    expect(tierAt(LADDER, 10 * M - 10, coarse).tier.name).toBe('simple');
    // …well inside the margin is.
    expect(tierAt(LADDER, 8 * M, coarse).tier.name).toBe('full');
  });

  it('never lets a tight boundary flicker: the margin has a floor', () => {
    expect(HYSTERESIS_FLOOR).toBeGreaterThanOrEqual(50); // half a metre
  });

  it('crosses several boundaries at once for something moving fast', () => {
    const near = tierAt(LADDER, 2 * M).index;
    expect(tierAt(LADDER, 500 * M, near).tier.name).toBe('hidden');
    const far = tierAt(LADDER, 500 * M).index;
    expect(tierAt(LADDER, 2 * M, far).tier.name).toBe('full');
  });

  it('fades toward the next tier only near the boundary', () => {
    expect(tierAt(LADDER, 1 * M).fade).toBe(0);
    expect(tierAt(LADDER, 9.9 * M).fade).toBeGreaterThan(0);
    const nearEdge = tierAt(LADDER, 9.99 * M).fade;
    expect(nearEdge).toBeGreaterThan(0.9);
    // The last rung has no further tier to fade toward.
    expect(tierAt(LADDER, 10_000 * M).fade).toBe(0);
  });
});

describe('the registry', () => {
  it('replaces a re-registered name instead of stacking ghosts', () => {
    registerProfile(LADDER);
    registerProfile({ ...LADDER, hysteresis: 0.2 });
    expect(profilesSnapshot().filter((p) => p.name === 'test-tree')).toHaveLength(1);
    expect(profileFor('test-tree')?.hysteresis).toBe(0.2);
  });
});

describe('the dev forces', () => {
  it('pins the micro fraction anywhere, and releases clean', () => {
    setDetailDial(2);
    forceMicro(0.5);
    expect(detailFraction(0)).toBe(0.5);
    expect(detailFraction(166 * M)).toBe(0.5);
    expect(forcedState().micro).toBe(0.5);
    forceMicro(null);
    expect(detailFraction(0)).toBe(1);
    expect(forcedState().micro).toBeNull();
  });

  it('pins a profile to a tier whatever the distance', () => {
    forceTier('test-tree', 2);
    const read = tierAt(LADDER, 1 * M);
    expect(read.tier.name).toBe('billboard');
    expect(read.fade).toBe(0);
    // An index past the ladder clamps to the last rung.
    forceTier('test-tree', 99);
    expect(tierAt(LADDER, 1 * M).tier.name).toBe('hidden');
    forceTier('test-tree', null);
    expect(tierAt(LADDER, 1 * M).tier.name).toBe('full');
  });

  it('a reset lifts every hand from the scale', () => {
    forceMicro(0.2);
    forceTier('test-tree', 1);
    resetLod();
    expect(forcedState().micro).toBeNull();
    expect(Object.keys(forcedState().tiers)).toHaveLength(0);
    expect(tierAt(LADDER, 1 * M).tier.name).toBe('full');
  });
});

describe('the moving anchor', () => {
  it('measures speed for the streaming lead', () => {
    setAnchor(0, 0, 0);
    // 700 units/s — Auto-Ant ×10 — held long enough to smooth in.
    for (let i = 1; i <= 60; i++) setAnchor(i * 70, 0, 0, 0.1);
    expect(anchorSpeed()).toBeGreaterThan(600);
    expect(anchorSpeed()).toBeLessThanOrEqual(700.01);
    // A one-second load should be led by about that much travel.
    expect(leadDistance(1)).toBeCloseTo(anchorSpeed(), 6);
    expect(leadDistance(-5)).toBe(0);
  });

  it('a standing queen leads by nothing', () => {
    for (let i = 0; i < 10; i++) setAnchor(500, 300, 500, 0.1);
    expect(anchorSpeed()).toBe(0);
    expect(leadDistance(2)).toBe(0);
  });
});
