import { describe, expect, it } from 'vitest';
import { JOINT_RANGE, JOINT_RANGE_SOURCES, JOINT_RANGE_WIRED, rangeDeg } from '../src/data/jointRange';
import { FINGER_LIMITS_DEG } from '../src/sarahlab/sarahLabTool';

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

describe('jointRange: the two levels (active, and passive -- placed or loaded)', () => {
  it('reads active unless asked for passive', () => {
    expect(rangeDeg('hip', 'abduction', 'female')).toBe(40);
    expect(rangeDeg('hip', 'abduction', 'female', 'active')).toBe(40);
  });
  it('a passive wall is the study\'s mean plus two standard deviations (Yoon 2025, Howe 2020)', () => {
    expect(rangeDeg('hip', 'abduction', 'female', 'passive')).toBe(66.2);
    expect(rangeDeg('hip', 'abduction', 'male', 'passive')).toBe(56.6);
    expect(rangeDeg('hip', 'flexion', 'female', 'passive')).toBe(142.2);
    expect(rangeDeg('hip', 'externalRotation', 'female', 'passive')).toBe(54.6);
    expect(rangeDeg('ankle', 'dorsiflexion', 'female', 'passive')).toBe(45.5);
  });
  it('a joint never gives less placed than it moves by itself (two studies of different people can disagree)', () => {
    for (const motions of Object.values(JOINT_RANGE)) for (const r of Object.values(motions) as { female: number; male: number; passive?: { female: number; male: number; source: string; label: string } }[]) {
      if (!r.passive) continue;
      expect(r.passive.female).toBeGreaterThanOrEqual(r.female);
      expect(r.passive.male).toBeGreaterThanOrEqual(r.male);
      expect(Object.keys(JOINT_RANGE_SOURCES)).toContain(r.passive.source);
      expect(r.passive.label).toBe('MEASURED');
    }
    // (the men's passive hip adduction in Yoon's group, 18.6, sits under Luttgens' active 20: the active wall stands)
    expect(rangeDeg('hip', 'adduction', 'male', 'passive')).toBe(rangeDeg('hip', 'adduction', 'male'));
  });
  it('where nothing measured the passive range, passive is the active range', () => {
    expect(rangeDeg('neck', 'rotation', 'female', 'passive')).toBe(60);
    expect(rangeDeg('knee', 'flexion', 'male', 'passive')).toBe(137.7);
  });
});

describe('the lab\'s finger curl keeps inside the table', () => {
  it('each finger joint\'s fist bend is within its range, and the thumb\'s', () => {
    const [mcp, pip, dip] = FINGER_LIMITS_DEG.finger, [cmc, tmcp, ip] = FINGER_LIMITS_DEG.thumb;
    expect(mcp).toBeLessThanOrEqual(rangeDeg('finger', 'mcpFlexion', 'female'));
    expect(pip).toBeLessThanOrEqual(rangeDeg('finger', 'pipFlexion', 'female'));
    expect(dip).toBeLessThanOrEqual(rangeDeg('finger', 'dipFlexion', 'female'));
    // (the thumb's base swings across the palm rather than bending: its abduction is the range it uses)
    expect(cmc).toBeLessThanOrEqual(rangeDeg('thumb', 'cmcAbduction', 'female'));
    expect(tmcp).toBeLessThanOrEqual(rangeDeg('thumb', 'mcpFlexion', 'female'));
    expect(ip).toBeLessThanOrEqual(rangeDeg('thumb', 'ipFlexion', 'female'));
  });
});
