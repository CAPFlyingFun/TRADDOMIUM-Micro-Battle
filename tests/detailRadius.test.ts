/**
 * THE DETAIL SLIDER MEANS METRES, and this is the test that would
 * have caught it lying.
 *
 * v0.0.86 shipped `Math.max(1, dial)` as a divide-by-zero guard and
 * silently pinned the bottom three settings to ten metres. It passed
 * its own visual check because the same slider ALSO scaled the texel
 * safeguard, so the ground did change at 25% — for the wrong reason.
 * A number is the only honest witness here.
 *
 * The dial lives in the MASTER LOD CORE now (lod.ts); the terrain
 * material keeps a shader-side copy synced from it. So this file
 * guards two promises rather than one: the master's arithmetic, and
 * that the bridge hands the shader the very same number.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DETAIL_RADIUS_UNIFORM, syncDetailRadius,
} from '../src/world/terrainMaterial';
import {
  detailRadius, METRES_PER_DIAL, resetLod, setDetailDial,
} from '../src/world/lod';
import { UNITS_PER_METRE } from '../src/world/kauai';

/** The radius the shader is using, in metres — through the bridge. */
function metres(dial: number): number {
  setDetailDial(dial);
  syncDetailRadius();
  return DETAIL_RADIUS_UNIFORM.value / UNITS_PER_METRE;
}

beforeEach(resetLod);

describe('the detail dial', () => {
  it('is ten metres of radius per unit of dial', () => {
    expect(METRES_PER_DIAL).toBe(10);
  });

  it('maps every setting the slider offers, including the low half', () => {
    // Joshua's table, exactly: 25% = 2.5 m ... 200% = 20 m.
    expect(metres(0.25)).toBeCloseTo(2.5, 6);
    expect(metres(0.5)).toBeCloseTo(5, 6);
    expect(metres(0.75)).toBeCloseTo(7.5, 6);
    expect(metres(1)).toBeCloseTo(10, 6);
    expect(metres(1.25)).toBeCloseTo(12.5, 6);
    expect(metres(1.5)).toBeCloseTo(15, 6);
    expect(metres(1.75)).toBeCloseTo(17.5, 6);
    expect(metres(2)).toBeCloseTo(20, 6);
  });

  it('is strictly increasing — no setting may share another one', () => {
    const seen = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(metres);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
  });

  it('still refuses a zero radius', () => {
    expect(metres(0)).toBeGreaterThan(0);
  });

  it('hands the shader exactly what the master answers', () => {
    setDetailDial(1.5);
    syncDetailRadius();
    expect(DETAIL_RADIUS_UNIFORM.value).toBe(detailRadius());
  });
});
