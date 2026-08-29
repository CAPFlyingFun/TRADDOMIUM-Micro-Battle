/**
 * THE DEBUG SURFACE, held to Joshua's own acceptance case:
 *
 *   Queen altitude ~166 m, Detail radius 20 m, point directly below —
 *   3D distance ~166 m, MICRO fraction 0.00.
 *
 * With no island grid loaded the ground is honestly flat at 0
 * (heightfield's stated fallback), which makes the flying case exact.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  describeKnownSystems, lodAt, lodLine, lodReport,
} from '../src/world/lodProbe';
import {
  forceMicro, forceTier, profilesSnapshot, resetLod, setAnchor,
  setDetailDial,
} from '../src/world/lod';

const M = 100;

beforeEach(() => {
  resetLod();
  describeKnownSystems();
});

describe('the flying case', () => {
  it('166 m up: the ground below is 166 m away and earns nothing', () => {
    setDetailDial(2);
    setAnchor(0, 166 * M, 0);
    const r = lodReport();
    expect(r.dialPercent).toBe(200);
    expect(r.radiusM).toBe(20);
    expect(r.below.groundY).toBe(0);
    expect(r.below.distanceM).toBeCloseTo(166, 2);
    expect(r.below.microFraction).toBe(0);
    // Over ground at sea level, not water: no sea line.
    expect(r.below.seaM).toBeUndefined();
  });

  it('on the ground the same report gives the detail back', () => {
    setDetailDial(2);
    setAnchor(0, 1.2 * M, 0); // her eye height, roughly
    const r = lodReport();
    expect(r.below.distanceM).toBeCloseTo(1.2, 2);
    expect(r.below.microFraction).toBe(1);
  });
});

describe('lodAt', () => {
  it('reads one world point in metres, all three axes', () => {
    setAnchor(0, 10 * M, 0);
    const read = lodAt(6 * M, 2 * M, 8 * M);
    expect(read.distanceM).toBeCloseTo(Math.sqrt(164), 2);
    expect(read.profiles.length).toBeGreaterThan(0);
  });

  it('places a distance on every registered ladder', () => {
    setAnchor(0, 166 * M, 0);
    const read = lodAt(0, 0, 0); // 166 m — inside the transition tier
    const tiers = Object.fromEntries(read.profiles.map((p) => [p.name, p.tier]));
    expect(tiers['terrain-tiers']).toBe('transition');
    expect(tiers['hd-tiles']).toBe('fine');
    expect(tiers['ground-cover']).toBe('bare');
  });
});

describe('the registry description', () => {
  it('is idempotent — a rebuilt scene stacks nothing', () => {
    describeKnownSystems();
    describeKnownSystems();
    const names = profilesSnapshot().map((p) => p.name);
    expect(names.sort()).toEqual(['ground-cover', 'hd-tiles', 'terrain-tiers']);
  });

  it('describes coverage as coverage — planar systems are not asked to be spheres', () => {
    for (const p of profilesSnapshot()) expect(p.cls).toBe('coverage');
  });
});

describe('the overlay line', () => {
  it('carries the dial, the radius, and the flying case', () => {
    setDetailDial(2);
    setAnchor(0, 166 * M, 0);
    expect(lodLine()).toBe('LOD 200% r20m ↓166.00m µ0.00');
  });

  it('confesses a forced frame', () => {
    setDetailDial(2);
    setAnchor(0, 166 * M, 0);
    forceMicro(1);
    expect(lodLine()).toContain('FORCED');
    forceMicro(null);
    forceTier('terrain-tiers', 0);
    expect(lodLine()).toContain('FORCED');
    forceTier('terrain-tiers', null);
    expect(lodLine()).not.toContain('FORCED');
  });
});
