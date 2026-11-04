import { describe, expect, it } from 'vitest';
import { JOINT_RANGE, JOINT_RANGE_SOURCES, JOINT_RANGE_WIRED, rangeDeg } from '../src/data/jointRange';

describe('jointRange: the master table of how far a human joint goes', () => {
  it('every motion has a woman\'s and a man\'s range, in degrees, a source and a label', () => {
    for (const [joint, motions] of Object.entries(JOINT_RANGE)) for (const [motion, r] of Object.entries(motions)) {
      for (const v of [r.female, r.male]) { expect(Number.isFinite(v), `${joint}.${motion}`).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(180); }
      expect(Object.keys(JOINT_RANGE_SOURCES)).toContain(r.source);
      expect(['MEASURED', 'BIOLOGICAL SHAPE']).toContain(r.label);
    }
  });
  it('keeps the CDC study\'s adult numbers (Soucie 2011, ages 20-44)', () => {
    expect(rangeDeg('elbow', 'flexion', 'female')).toBe(150.0);
    expect(rangeDeg('elbow', 'flexion', 'male')).toBe(144.6);
    expect(rangeDeg('elbow', 'hyperextension', 'female')).toBe(4.7);
    expect(rangeDeg('forearm', 'pronation', 'male')).toBe(76.9);
    expect(rangeDeg('forearm', 'supination', 'female')).toBe(90.6);
    expect(rangeDeg('knee', 'flexion', 'female')).toBe(141.9);
  });
  it('women reach further than men wherever the CDC study measured both', () => {
    for (const motions of Object.values(JOINT_RANGE)) for (const r of Object.values(motions)) if (r.source === 'CDC_2011') expect(r.female).toBeGreaterThanOrEqual(r.male);
  });
  it('every motion a live system reads exists (WIRED)', () => {
    for (const [joint, motion] of JOINT_RANGE_WIRED) for (const sex of ['female', 'male'] as const) expect(rangeDeg(joint, motion as never, sex)).toBeGreaterThan(0);
  });
  it('refuses a motion that is not there, rather than reading a zero', () => {
    expect(() => rangeDeg('wrist', 'pronation' as never, 'female')).toThrow(/no motion/);
  });
});
