import { describe, expect, it } from 'vitest';
import { world } from '../src/world/coords';
import { CELL_SPAN, cellAt, cellKey } from '../src/world/objects/cells';
import {
  ISLAND_STRESS_RADIUS_UNITS,
  islandStressDistance,
  islandStressPoint,
  projectIslandStressPoint,
  validIslandStressGround,
} from '../src/perf/islandStressTest';

function habitat(kind: 'grassland' | 'sea' | 'rocky', slopeDegrees = 0) {
  return {
    kind, slopeDegrees, lake: kind === 'sea' ? 1 : 0,
  } as never;
}

describe('island stress placement', () => {
  it('uses the real ground query and never projects beyond the 0.5 m radius', () => {
    const centre = world(1000, 2000);
    const ground = {
      groundAt: () => 12,
      habitatAt: () => habitat('grassland'),
    };
    const point = projectIslandStressPoint(centre, world(1000 + 1000, 2000), ground);
    expect(point).not.toBeNull();
    expect(islandStressDistance(centre, point!)).toBe(ISLAND_STRESS_RADIUS_UNITS);
  });

  it('rejects water and cliffs, then finds a valid local island point', () => {
    const centre = world(0, 0);
    const ground = {
      groundAt: () => 4,
      habitatAt: (at: { wx: number; wz: number }) =>
        at.wx === 0 && at.wz === 0 ? habitat('sea') : habitat('grassland'),
    };
    const point = islandStressPoint(centre, 1, ground);
    expect(point).not.toBeNull();
    expect(validIslandStressGround(point!, ground)).toBe(true);
    expect(islandStressDistance(centre, point!)).toBeLessThanOrEqual(ISLAND_STRESS_RADIUS_UNITS);

    const cliff = {
      groundAt: () => 4,
      habitatAt: () => habitat('rocky', 60),
    };
    expect(projectIslandStressPoint(centre, centre, cliff)).toBeNull();
  });

  it('is seeded: the same body index lands at the same point', () => {
    const centre = world(42, -19);
    const ground = { groundAt: () => 0, habitatAt: () => habitat('grassland') };
    const a = islandStressPoint(centre, 17, ground);
    const b = islandStressPoint(centre, 17, ground);
    expect(a).toEqual(b);
  });

  it('addresses stress bodies with the shared 16 m object cell, not a 1.6 m approximation', () => {
    const at = world(CELL_SPAN + 1, -CELL_SPAN - 1);
    expect(cellKey(cellAt(at))).toBe('1,-2');
  });
});