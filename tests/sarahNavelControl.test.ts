import { describe, expect, it } from 'vitest';
import { NAVEL_INNIE_EXTRA, NAVEL_OUTIE_EXTRA, navelFlatFor, navelFlatWeight, navelState, navelWeights } from '../src/sarahlab/sarahLabTool';
import { controlSpec, defaultBodyShape, parseShape, serializeShape, setControl } from '../src/actor/bodyShape';

describe('the NAVEL body control (Joshua, 2026-10-24: "how much of an innie or outie... independent of the automatic bellybutton size per belly %")', () => {
  it('is a belly control of the body, approved at 0, saved and read back with her shape', () => {
    const spec = controlSpec('navel');
    expect(spec.group).toBe('belly');
    expect([spec.min, spec.max, spec.fallback]).toEqual([-100, 100, 0]);
    expect(defaultBodyShape().navel).toBe(0);
    const shape = setControl(defaultBodyShape(), 'navel', -40);
    expect(parseShape(serializeShape(shape)).navel).toBe(-40);
    // a save from before the control is the automatic navel
    expect(parseShape(JSON.stringify({ version: 1, shape: { bellyWidth: 5 } })).navel).toBe(0);
  });

  it('at 0 is exactly the automatic navel at every belly size', () => {
    for (let p = 0; p <= 200; p += 5) expect(navelFlatFor(p, 0)).toBeCloseTo(navelFlatWeight(p), 12);
  });

  it('-100 is the deepest innie and +100 the fullest outie, the same at every size', () => {
    for (const p of [0, 30, 72, 100, 150, 200]) {
      expect(navelFlatFor(p, -100)).toBeCloseTo(1 + NAVEL_INNIE_EXTRA, 12);
      expect(navelFlatFor(p, 100)).toBeCloseTo(-NAVEL_OUTIE_EXTRA, 12);
    }
  });

  it('has no stretch that moves nothing: strictly in or out across the whole slider, at a small belly and a big one', () => {
    for (const p of [30, 72, 120, 200]) {
      let last = Infinity;
      for (let n = -100; n <= 100; n += 5) { const f = navelFlatFor(p, n); expect(f).toBeLessThan(last); last = f; }
    }
    // at 72% (automatic: an innie) +50 is part way to the fullest outie; at 120% (automatic: an outie) -50 half way to the deepest innie
    expect(1 - navelFlatFor(72, 50)).toBeCloseTo(0.5 * (1 + NAVEL_OUTIE_EXTRA), 12);
    expect(1 - navelFlatFor(120, -50)).toBeCloseTo(1 - 0.5 * (1 + NAVEL_INNIE_EXTRA), 12);
  });

  it('says where her navel stands', () => {
    expect(navelState(50, 0)).toBe('innie');
    expect(navelState(150, 0)).toBe('outie 100%');
    expect(navelState(72, 40)).toBe('outie 52%');
    expect(navelState(30, -100)).toMatch(/^deeper innie/);
    expect(navelState(150, 100)).toMatch(/^fuller outie/);
  });

  it("drives v1's own navel shapes the same way, in and out", () => {
    expect(navelWeights(70)).toEqual({ navelIn: 0, navelOut: 0.5 });
    expect(navelWeights(70, 30).navelOut).toBeCloseTo(0.8, 12);
    expect(navelWeights(0, -60)).toEqual({ navelIn: 0.6, navelOut: 0 });
  });
});
