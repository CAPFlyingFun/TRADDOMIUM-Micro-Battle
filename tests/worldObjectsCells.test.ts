/**
 * The cell, the families and the budget: the three small contracts the
 * populator and the renderer meet on.
 */
import { describe, expect, it } from 'vitest';
import { DETAIL_TIERS, DETAIL_QUALITY } from '../src/assets/detailQuality';
import { world } from '../src/world/coords';
import {
  CELL_SPAN, cellAt, cellCentre, cellKey, cellOrigin, cellsWithin, distanceToCell, sameCell,
} from '../src/world/objects/cells';
import { FAMILY_SPECS, OBJECT_FAMILIES, familyReach, keepFraction } from '../src/world/objects/families';
import { OBJECT_BUDGETS, OBJECT_RUNGS, isObjectRung, objectBudgetFor } from '../src/world/objects/budget';
import { NO_DELTAS, WORLD_SEED } from '../src/world/objects/seed';

describe('object cells', () => {
  it('are 16 m, addressed from world position alone, and floor toward negative infinity', () => {
    expect(CELL_SPAN).toBe(1600);
    expect(cellAt(world(0, 0))).toEqual({ cx: 0, cz: 0 });
    expect(cellAt(world(1599, 1599))).toEqual({ cx: 0, cz: 0 });
    expect(cellAt(world(1600, -1))).toEqual({ cx: 1, cz: -1 });
    expect(cellAt(world(-1, -1600))).toEqual({ cx: -1, cz: -1 });
    expect(cellOrigin({ cx: 3, cz: -2 })).toEqual(world(4800, -3200));
    expect(cellCentre({ cx: 3, cz: -2 })).toEqual(world(5600, -2400));
    expect(cellKey({ cx: -7, cz: 12 })).toBe('-7,12');
    expect(sameCell({ cx: 1, cz: 2 }, { cx: 1, cz: 2 })).toBe(true);
    expect(sameCell({ cx: 1, cz: 2 }, { cx: 2, cz: 1 })).toBe(false);
  });

  it('lists the cells under a circle nearest first, and no cell that is outside it', () => {
    const at = world(800, 800);
    const one = cellsWithin(at, 100);
    expect(one).toEqual([{ cx: 0, cz: 0 }]);
    const near = cellsWithin(at, 900);
    expect(near[0]).toEqual({ cx: 0, cz: 0 });
    // Radius 900 from the centre of cell 0,0 reaches its four edge
    // neighbours (800 away) but not its corners' neighbours (1,131 away).
    expect(near).toHaveLength(5);
    for (const id of near) expect(distanceToCell(at, id)).toBeLessThanOrEqual(900);
    // A 100 m radius at `high` is 13x13 cells, give or take the corners.
    const high = cellsWithin(at, 10_000);
    expect(high.length).toBeGreaterThan(120);
    expect(high.length).toBeLessThan(170);
    let prev = -1;
    for (const id of high) {
      const d = distanceToCell(at, id);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it('gives nothing for a non-finite point or a negative radius — a NaN cannot poison the streamer', () => {
    expect(cellsWithin(world(Number.NaN, 0), 1000)).toEqual([]);
    expect(cellsWithin(world(0, Number.POSITIVE_INFINITY), 1000)).toEqual([]);
    expect(cellsWithin(world(0, 0), -1)).toEqual([]);
    expect(cellsWithin(world(0, 0), Number.NaN)).toEqual([]);
  });
});

describe('object families', () => {
  it('names twelve — the first five, then the ecology pass\'s seven — and marks trees, rocks and shrubs as the ones that carry an identity', () => {
    expect(OBJECT_FAMILIES).toEqual([
      'grass', 'twig', 'stone', 'rock', 'tree',
      'fern', 'reed', 'flower', 'leaf', 'shrub', 'broadleaf', 'coastal',
    ]);
    expect(FAMILY_SPECS.tree.major).toBe(true);
    expect(FAMILY_SPECS.rock.major).toBe(true);
    // A shrub is somebody: an aphid colony will sit on one, and a save will name it.
    expect(FAMILY_SPECS.shrub.major).toBe(true);
    for (const cosmetic of ['grass', 'twig', 'stone', 'fern', 'reed', 'flower', 'leaf', 'broadleaf', 'coastal'] as const) {
      expect(FAMILY_SPECS[cosmetic].major, cosmetic).toBe(false);
    }
  });

  it('reaches by band: clutter is very near, grass near, trees and rocks to the rung\'s radius', () => {
    const high = DETAIL_QUALITY.high.waveRadius;
    expect(familyReach('grass', high)).toBe(3000);
    expect(familyReach('twig', high)).toBe(2000);
    expect(familyReach('stone', high)).toBe(1200);
    expect(familyReach('rock', high)).toBe(high);
    expect(familyReach('tree', high)).toBe(high);
    // At ultra-low (15 m) every family still has a floor to stand on.
    const ultraLow = DETAIL_QUALITY['ultra-low'].waveRadius;
    for (const family of OBJECT_FAMILIES) {
      expect(familyReach(family, ultraLow)).toBeGreaterThanOrEqual(800);
      expect(familyReach(family, ultraLow)).toBeLessThanOrEqual(ultraLow);
    }
    // And the desktop rung is capped: a twig at 200 m is not a thing.
    expect(familyReach('twig', DETAIL_QUALITY['ultra-high'].waveRadius)).toBe(2000);
  });

  it('keeps everything inside the full band, thins smoothly to the edge, and nothing beyond it', () => {
    for (const family of OBJECT_FAMILIES) {
      const reach = familyReach(family, 10_000);
      expect(keepFraction(family, 0, reach)).toBe(1);
      expect(keepFraction(family, reach * FAMILY_SPECS[family].fullUntil, reach)).toBe(1);
      expect(keepFraction(family, reach, reach)).toBe(0);
      expect(keepFraction(family, reach * 1.5, reach)).toBe(0);
      expect(keepFraction(family, Number.NaN, reach)).toBe(0);
      let prev = 1;
      for (let d = 0; d < reach; d += reach / 200) {
        const k = keepFraction(family, d, reach);
        expect(k).toBeLessThanOrEqual(prev + 1e-12);
        expect(k).toBeGreaterThanOrEqual(FAMILY_SPECS[family].farKeep - 1e-12);
        prev = k;
      }
    }
  });
});

describe('object budgets', () => {
  it('are keyed by the detail ladder\'s rungs — the same five names, so the two cannot drift', () => {
    expect([...OBJECT_RUNGS]).toEqual([...DETAIL_TIERS]);
    for (const tier of DETAIL_TIERS) expect(isObjectRung(tier)).toBe(true);
    expect(isObjectRung('ultra')).toBe(false);
    expect(objectBudgetFor('nonsense')).toBe(OBJECT_BUDGETS.medium);
  });

  it('carry Joshua\'s numbers at high and climb the ladder monotonically', () => {
    expect(OBJECT_BUDGETS.high.caps).toMatchObject({ grass: 25_000, twig: 2_000, stone: 500, rock: 50, tree: 100 });
    // The ecology pass's seven, summing to the 6,000 mobile budget (tests/worldObjectsPlants.test.ts holds the sum).
    expect(OBJECT_BUDGETS.high.caps).toMatchObject({ fern: 500, reed: 700, flower: 1_100, leaf: 2_300, shrub: 300, broadleaf: 700, coastal: 400 });
    for (const family of OBJECT_FAMILIES) {
      let prev = 0;
      for (const rung of OBJECT_RUNGS) {
        const cap = OBJECT_BUDGETS[rung].caps[family];
        expect(cap).toBeGreaterThan(prev);
        expect(Number.isInteger(cap)).toBe(true);
        prev = cap;
        const draw = OBJECT_BUDGETS[rung].draw[family];
        expect(draw).toBeGreaterThan(0);
        expect(draw).toBeLessThanOrEqual(1);
      }
      // Major objects are never thinned by the draw fraction: the rung
      // caps how many, not which.
      if (FAMILY_SPECS[family].major) {
        for (const rung of OBJECT_RUNGS) expect(OBJECT_BUDGETS[rung].draw[family]).toBe(1);
      }
    }
  });

  it('the world seed is one constant and the empty delta removes nothing', () => {
    expect(WORLD_SEED).toBe(0x4b415541);
    expect(NO_DELTAS.isRemoved('tree:0,0:0')).toBe(false);
  });
});
