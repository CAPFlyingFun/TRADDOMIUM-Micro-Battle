import { describe, expect, it } from 'vitest';
import {
  BODY_CONTROLS, clampShape, controlSpec, defaultBodyShape, parseShape, serializeShape, setControl, variedShape, type BodyControl, type BodyShape,
} from '../src/actor/bodyShape';
import {
  BUILD_PROFILES, BUILD_SEGMENTS, HEIGHT_SEGMENTS, PROFILE_CONTROLS, SARAH_V2_BUILD, buildAmounts, buildKey, heightLine, heldSegments, isApprovedBuild,
  profileOf, segmentLimitCm, standingHeight, withProfile, type BuildAmounts, type BuildSegment,
} from '../src/actor/bodyBuild';

const BUILD_KEYS: readonly BodyControl[] = ['height', 'upperLeg', 'lowerLeg', 'torso', 'neck', 'upperArm', 'forearm', 'shoulders', 'waist', 'hips', 'head', 'hands', 'feet'];
const shaped = (values: Partial<Record<BodyControl, number>>): BodyShape => clampShape({ ...defaultBodyShape(), ...values });
const amounts = (values: Partial<Record<BodyControl, number>>): BuildAmounts => buildAmounts(shaped(values), SARAH_V2_BUILD);
const len = (s: BuildSegment) => SARAH_V2_BUILD.segments[s].length;
const rise = (s: BuildSegment) => SARAH_V2_BUILD.segments[s].rise;
const risen = (a: BuildAmounts) => HEIGHT_SEGMENTS.reduce((sum, s) => sum + a.add[s] * rise(s), 0);

describe('the build controls', () => {
  it('follow the breast controls, in order, all approved at 0', () => {
    const build = BODY_CONTROLS.filter((c) => c.group === 'build');
    expect(build.map((c) => c.key)).toEqual(BUILD_KEYS);
    expect(BODY_CONTROLS.slice(-BUILD_KEYS.length).map((c) => c.key)).toEqual(BUILD_KEYS);
    const d = defaultBodyShape();
    for (const c of build) {
      expect(c.fallback).toBe(0);
      expect(c.min).toBeLessThan(0);
      expect(c.max).toBeGreaterThan(0);
      expect(d[c.key]).toBe(0);
    }
    for (const k of ['height', 'upperLeg', 'lowerLeg', 'torso', 'neck', 'upperArm', 'forearm', 'shoulders'] as const) expect(controlSpec(k).unit).toBe('cm');
    for (const k of ['waist', 'hips', 'head', 'hands', 'feet'] as const) expect(controlSpec(k).unit).toBe('%');
    expect(controlSpec('height')).toMatchObject({ min: -30, max: 30 });
  });

  it('give each length the measured rule: down to half itself, up by the smaller of 30 cm and itself, within a centimetre', () => {
    for (const s of BUILD_SEGMENTS) {
      const c = controlSpec(s), cm = len(s) * 100;
      // never shorter than half (the torso: 30%, where her belly stayed clean when rendered)
      const shrink = s === 'torso' ? 0.3 : 0.5;
      expect(-c.min, s).toBeLessThanOrEqual(cm * shrink + 1e-9);
      expect(-c.min, s).toBeGreaterThanOrEqual(cm * shrink - 1);
      // never more than 30 cm, nor more than its own length
      const grow = Math.min(30, cm);
      expect(c.max, s).toBeLessThanOrEqual(grow + 1e-9);
      expect(c.max, s).toBeGreaterThanOrEqual(grow - 1);
    }
  });
});

describe('the approved build', () => {
  it('is exactly approved amounts, with no key and the measured height', () => {
    const a = buildAmounts(defaultBodyShape(), SARAH_V2_BUILD);
    for (const s of BUILD_SEGMENTS) expect(Object.is(a.add[s], 0), s).toBe(true);
    expect([a.shoulders, a.waist, a.hips]).toEqual([0, 0, 0]);
    expect([a.head, a.hands, a.feet]).toEqual([1, 1, 1]);
    expect(isApprovedBuild(a)).toBe(true);
    expect(buildKey(a)).toBe('');
    expect(standingHeight(a, SARAH_V2_BUILD)).toBe(1.7);
    expect(heightLine(a, SARAH_V2_BUILD)).toBe('1.70 m · 5 ft 7 in');
  });

  it('reads -0 and broken numbers as approved, never NaN', () => {
    const negZero = { ...defaultBodyShape(), height: -0, upperLeg: -0, waist: -0 };
    const a = buildAmounts(negZero, SARAH_V2_BUILD);
    for (const s of BUILD_SEGMENTS) expect(Object.is(a.add[s], 0), s).toBe(true);
    expect(Object.is(a.waist, 0)).toBe(true);
    expect(isApprovedBuild(a)).toBe(true);
    const broken = { ...defaultBodyShape(), height: Number.NaN, torso: Number.POSITIVE_INFINITY, head: Number.NaN };
    const b = buildAmounts(broken, SARAH_V2_BUILD);
    expect(isApprovedBuild(b)).toBe(true);
    // a body that measured nothing changes nothing rather than dividing by zero
    const empty = { ...SARAH_V2_BUILD, segments: Object.fromEntries(BUILD_SEGMENTS.map((s) => [s, { length: 0, rise: 0 }])) as typeof SARAH_V2_BUILD.segments };
    const c = buildAmounts(shaped({ height: 30, upperLeg: 10 }), empty);
    for (const s of BUILD_SEGMENTS) expect(c.add[s], s).toBe(0);
  });
});

describe('HEIGHT', () => {
  it('+30 cm rises by exactly 30 cm, each segment in its own proportion, the arms following', () => {
    const a = amounts({ height: 30 });
    expect(risen(a)).toBeCloseTo(0.3, 9);
    const factor = a.add.upperLeg / len('upperLeg');
    expect(factor).toBeGreaterThan(0);
    for (const s of BUILD_SEGMENTS) expect(a.add[s] / len(s), s).toBeCloseTo(factor, 12);
    expect([a.head, a.hands, a.feet]).toEqual([1, 1, 1]);
    expect([a.shoulders, a.waist, a.hips]).toEqual([0, 0, 0]);
    expect(standingHeight(a, SARAH_V2_BUILD)).toBeCloseTo(2.0, 9);
    expect(heightLine(a, SARAH_V2_BUILD)).toBe('2.00 m · 6 ft 7 in');
    expect(isApprovedBuild(a)).toBe(false);
  });

  it('-30 cm stands her at 1.40 m', () => {
    const a = amounts({ height: -30 });
    expect(risen(a)).toBeCloseTo(-0.3, 9);
    expect(standingHeight(a, SARAH_V2_BUILD)).toBeCloseTo(1.4, 9);
    expect(heightLine(a, SARAH_V2_BUILD)).toBe('1.40 m · 4 ft 7 in');
  });

  it('adds a segment\'s own centimetres on top of its share, and stops at 40% of the segment', () => {
    const share = amounts({ height: 10 }).add.lowerLeg;
    const both = amounts({ height: 10, lowerLeg: 5 });
    expect(both.add.lowerLeg).toBeCloseTo(share + 0.05, 12);
    // the rest keep only their share
    expect(both.add.upperLeg).toBeCloseTo(amounts({ height: 10 }).add.upperLeg, 12);
    expect(amounts({ upperArm: 12 }).add.upperArm).toBeCloseTo(0.12, 12);
    expect(amounts({ upperArm: 12 }).add.upperLeg).toBe(0);
    // -30 of height and -18 of thigh would leave less than 40% of the thigh: held there
    const short = amounts({ height: -30, upperLeg: -18 });
    expect(short.add.upperLeg).toBeCloseTo(-0.6 * len('upperLeg'), 12);
    expect(len('upperLeg') + short.add.upperLeg).toBeCloseTo(0.4 * len('upperLeg'), 12);
  });

  it('leaves the head, hands and feet to their own sizes, which lift her by their measured share', () => {
    expect(standingHeight(amounts({ feet: 30 }), SARAH_V2_BUILD)).toBeCloseTo(1.7 + 0.3 * 0.1093, 12);
    expect(standingHeight(amounts({ head: 30 }), SARAH_V2_BUILD)).toBeCloseTo(1.7 + 0.3 * 0.169, 12);
    expect(standingHeight(amounts({ hands: 30, shoulders: 10, waist: 20, hips: 20, upperArm: 10 }), SARAH_V2_BUILD)).toBe(1.7);
    const a = amounts({ head: -30, hands: 20, feet: 10, shoulders: 4, waist: -10, hips: 15 });
    expect([a.head, a.hands, a.feet]).toEqual([0.7, 1.2, 1.1]);
    expect(a.shoulders).toBeCloseTo(0.04, 12);
    expect(a.waist).toBeCloseTo(-0.1, 12);
    expect(a.hips).toBeCloseTo(0.15, 12);
  });

  it('prints whole inches, carrying a rounded twelve into the next foot', () => {
    // 1.8 m is 70.87 in: 5 ft 11 in
    expect(heightLine(amounts({ height: 10 }), SARAH_V2_BUILD)).toBe('1.80 m · 5 ft 11 in');
    // 1.82 m is 71.65 in, which rounds to 72: 6 ft 0 in, never 5 ft 12 in
    expect(heightLine(amounts({ height: 12 }), SARAH_V2_BUILD)).toBe('1.82 m · 6 ft 0 in');
  });
});

describe('a segment held at its limit', () => {
  it('is named, in order, so the HUD can say a slider has stopped doing anything', () => {
    expect(heldSegments(defaultBodyShape(), SARAH_V2_BUILD)).toEqual([]);
    expect(heldSegments(shaped({ height: 30, upperLeg: 30, lowerLeg: 30, torso: 27, neck: 12, upperArm: 26, forearm: 22 }), SARAH_V2_BUILD)).toEqual([]);
    // -30 of height and -18 of thigh: the thigh is held, nothing else
    const s = shaped({ height: -30, upperLeg: -18 });
    expect(heldSegments(s, SARAH_V2_BUILD)).toEqual(['upperLeg']);
    expect(buildAmounts(s, SARAH_V2_BUILD).add.upperLeg * 100).toBeCloseTo(segmentLimitCm('upperLeg', SARAH_V2_BUILD, 'min'), 9);
    // a little less of the thigh's own shrink still reaches it
    expect(heldSegments(shaped({ height: -30, upperLeg: -12 }), SARAH_V2_BUILD)).toEqual([]);
    // every length at its floor with HEIGHT -30 holds all six, in BUILD_SEGMENTS order
    const floor = shaped({ height: -30, ...Object.fromEntries(BUILD_SEGMENTS.map((g) => [g, controlSpec(g).min])) });
    expect(heldSegments(floor, SARAH_V2_BUILD)).toEqual([...BUILD_SEGMENTS]);
    expect(Object.isFrozen(heldSegments(floor, SARAH_V2_BUILD))).toBe(true);
  });

  it('at the ceiling too, on a body short enough to reach it', () => {
    const stubby = { ...SARAH_V2_BUILD, segments: { ...SARAH_V2_BUILD.segments, neck: { length: 0.05, rise: 1 } } };
    const s = shaped({ neck: 12 });
    expect(heldSegments(s, stubby)).toEqual(['neck']);
    expect(buildAmounts(s, stubby).add.neck * 100).toBeCloseTo(segmentLimitCm('neck', stubby, 'max'), 9);
    expect(segmentLimitCm('neck', stubby, 'max')).toBeCloseTo(6.5, 9);
  });

  it('prints its limit in centimetres: -60% (the torso -30%) and +130% of the segment', () => {
    expect(segmentLimitCm('upperLeg', SARAH_V2_BUILD, 'min')).toBeCloseTo(-21.948, 9);
    expect(segmentLimitCm('upperLeg', SARAH_V2_BUILD, 'min').toFixed(1)).toBe('-21.9');
    expect(segmentLimitCm('upperLeg', SARAH_V2_BUILD, 'max')).toBeCloseTo(47.554, 9);
    for (const g of BUILD_SEGMENTS) {
      expect(segmentLimitCm(g, SARAH_V2_BUILD, 'min'), g).toBeCloseTo((g === 'torso' ? -30 : -60) * len(g), 9);
      expect(segmentLimitCm(g, SARAH_V2_BUILD, 'max'), g).toBeCloseTo(130 * len(g), 9);
    }
  });
});

describe('the build key', () => {
  it('is stable for the same numbers and changes with any of them', () => {
    const base = amounts({ height: 5, waist: 3 });
    expect(buildKey(base)).toBe(buildKey(amounts({ height: 5, waist: 3 })));
    expect(buildKey(base)).toMatch(/^ul:-?\d+\.\d{5}\|ll:.*\|to:.*\|nk:.*\|ua:.*\|fa:.*\|sh:.*\|wa:0\.03000\|hp:0\.00000\|hd:1\.00000\|hn:1\.00000\|ft:1\.00000$/);
    const keys = new Set([buildKey(base)]);
    for (const k of BUILD_KEYS) {
      const spec = controlSpec(k);
      const moved = buildKey(buildAmounts(setControl(shaped({ height: 5, waist: 3 }), k, (k === 'height' ? 5 : k === 'waist' ? 3 : 0) + spec.step), SARAH_V2_BUILD));
      expect(keys.has(moved), k).toBe(false);
      keys.add(moved);
    }
  });
});

describe('the five profiles', () => {
  it('are the classic five, frozen, and name the controls they set', () => {
    expect(BUILD_PROFILES.map((p) => p.id)).toEqual(['hourglass', 'pear', 'apple', 'rectangle', 'invertedTriangle']);
    expect(Object.isFrozen(BUILD_PROFILES)).toBe(true);
    for (const p of BUILD_PROFILES) { expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(p.values)).toBe(true); }
    expect(PROFILE_CONTROLS).toEqual(['breastSize', 'shoulders', 'waist', 'hips']);
    expect(Object.isFrozen(PROFILE_CONTROLS)).toBe(true);
    // every value a profile sets is inside its slider
    for (const p of BUILD_PROFILES) for (const [k, v] of Object.entries(p.values)) {
      const c = controlSpec(k as BodyControl);
      expect(v, `${p.id}.${k}`).toBeGreaterThanOrEqual(c.min);
      expect(v, `${p.id}.${k}`).toBeLessThanOrEqual(c.max);
    }
  });

  it('set exactly their own controls and leave the rest as they were', () => {
    const start = shaped({ height: 12, bellyTilt: 8, navel: -20, upperArm: 3, waist: 30, breastWidth: 5 });
    for (const p of BUILD_PROFILES) {
      const next = withProfile(start, p.id);
      for (const c of BODY_CONTROLS) {
        const want = p.values[c.key] ?? start[c.key];
        expect(next[c.key], `${p.id}: ${c.key}`).toBe(want);
      }
      expect(profileOf(next)).toBe(p.id);
    }
    expect(withProfile(start, 'nope' as never)).toBe(start);
  });

  it('are recognised until one of their controls moves, and never for the approved body', () => {
    expect(profileOf(defaultBodyShape())).toBeNull();
    for (const p of BUILD_PROFILES) {
      const on = withProfile(defaultBodyShape(), p.id);
      expect(profileOf(on)).toBe(p.id);
      // a control the profile does not set changes nothing about which profile it is
      expect(profileOf(setControl(on, 'height', 20))).toBe(p.id);
      for (const k of Object.keys(p.values) as BodyControl[]) {
        expect(profileOf(setControl(on, k, on[k] + controlSpec(k).step)), `${p.id} after ${k}`).toBeNull();
      }
    }
  });
});

describe('a build, saved', () => {
  it('round-trips with the rest of the body, and an older save loads as the approved build', () => {
    const s = withProfile(shaped({ height: 7.5, upperLeg: -4, neck: 2, head: -5, feet: 6, bellyTilt: 12 }), 'pear');
    const text = serializeShape(s);
    expect(JSON.parse(text).version).toBe(1);
    expect(parseShape(text)).toEqual(s);
    const old = parseShape('{"version":1,"shape":{"bellyTilt":10,"breastSize":12}}');
    for (const k of BUILD_KEYS) expect(old[k], k).toBe(0);
    expect(old.bellyTilt).toBe(10);
    expect(isApprovedBuild(buildAmounts(old, SARAH_V2_BUILD))).toBe(true);
  });

  it('varies within each build control\'s spread', () => {
    for (const seed of [1, 130, 2026]) {
      const v = variedShape(seed);
      for (const k of BUILD_KEYS) expect(Math.abs(v[k] - controlSpec(k).fallback), `${seed}: ${k}`).toBeLessThanOrEqual(controlSpec(k).spread + 1e-9);
    }
  });
});
