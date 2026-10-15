import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  BODY_CONTROLS, clampShape, controlLine, defaultBodyShape, isDefaultShape, lerpShape, parseShape, resetControl, serializeShape, setControl, variedShape,
} from '../src/actor/bodyShape';
import {
  BELLY_LOWER_SCALE, BREAST_MANUAL_MAX_VOLUME, bustVolume, breastVolumeRatio, breastWeightsForShape, BREAST_GROW_TARGET, BELLY_SHAPE_SCALE, BELLY_HEIGHT_END_CM, bellyHeightWeights, bellyMotionWeights, bodyShapeFieldWeights, effectiveTiltDeg, restingBellySpring,
  SEATED_TILT_DOWN_SECONDS, SEATED_TILT_MAX_DEG, SEATED_TILT_UP_SECONDS, SIZE_TILT_PRESETS_DEG, sizeTiltDeg, stepSeated, SARAH_LAB_MODELS,
} from '../src/sarahlab/sarahLabTool';

describe('a body shape, as numbers', () => {
  it('defaults to the approved body, every control in range', () => {
    const d = defaultBodyShape();
    expect(isDefaultShape(d)).toBe(true);
    for (const c of BODY_CONTROLS) {
      expect(d[c.key]).toBe(c.fallback);
      expect(c.min).toBeLessThanOrEqual(c.fallback);
      expect(c.max).toBeGreaterThanOrEqual(c.fallback);
    }
    expect(d.bellyTilt).toBe(20);
  });

  it('clamps, sets and resets one control at a time', () => {
    const s = setControl(defaultBodyShape(), 'bellyHeight', 9);
    expect(s.bellyHeight).toBe(2);
    expect(setControl(s, 'bellyWidth', -99).bellyWidth).toBe(-15);
    expect(resetControl(s, 'bellyHeight').bellyHeight).toBe(0);
    expect(clampShape({ bellyDepth: Number.NaN, breastDroop: 'x' as unknown as number }).bellyDepth).toBe(0);
    expect(isDefaultShape(resetControl(s, 'bellyHeight'))).toBe(true);
  });

  it('interpolates between two bodies', () => {
    const a = defaultBodyShape(), b = setControl(setControl(a, 'bellyDepth', 10), 'bellyTilt', 0);
    const m = lerpShape(a, b, 0.5);
    expect(m.bellyDepth).toBe(5);
    expect(m.bellyTilt).toBe(10);
    expect(lerpShape(a, b, 7)).toEqual(b);
  });

  it('saves only what differs and reads back what it saved, tolerating anything else', () => {
    const s = setControl(setControl(defaultBodyShape(), 'breastSize', 12), 'bellyTilt', 10);
    const text = serializeShape(s);
    expect(JSON.parse(text)).toEqual({ version: 1, shape: { bellyTilt: 10, breastSize: 12 } });
    expect(parseShape(text)).toEqual(s);
    expect(parseShape('not json')).toEqual(defaultBodyShape());
    expect(parseShape('{"version":99,"shape":{"bellyTilt":3}}')).toEqual(defaultBodyShape());
    expect(parseShape('{"version":1,"shape":{"bellyTilt":300}}').bellyTilt).toBe(20);
  });

  it('varies a body reproducibly from a seed, within each control\'s spread', () => {
    const one = variedShape(130), again = variedShape(130), other = variedShape(131);
    expect(again).toEqual(one);
    expect(other).not.toEqual(one);
    for (const c of BODY_CONTROLS) expect(Math.abs(one[c.key] - c.fallback)).toBeLessThanOrEqual(c.spread + 1e-9);
    expect(variedShape(5, defaultBodyShape(), 0)).toEqual(defaultBodyShape());
  });

  it('prints a control the way the HUD shows it', () => {
    expect(controlLine('bellyHeight', 1.5)).toBe('HEIGHT · +1.5 cm');
    expect(controlLine('bellyTilt', 20)).toBe('TILT · 20.0° (approved)');
  });
});

describe('the tilt', () => {
  it('keeps 20° as the approved shape exactly, with the 0/10/20 presets', () => {
    expect(SIZE_TILT_PRESETS_DEG).toEqual([0, 10, 20]);
    for (const p of [90, 100, 125, 150, 200]) expect(sizeTiltDeg(p, 20)).toBe(sizeTiltDeg(p));
    expect(sizeTiltDeg(200, 10)).toBe(sizeTiltDeg(200) / 2);
    expect(sizeTiltDeg(100, 0)).toBe(0);
    const s = restingBellySpring();
    expect(bellyMotionWeights(200, 0, s, 20)).toEqual(bellyMotionWeights(200, 0, s));
  });

  it('seated, uses a quarter of the chosen tilt (0-5°) without changing the choice', () => {
    expect(effectiveTiltDeg(20, 0)).toBe(20);
    expect(effectiveTiltDeg(20, 1)).toBe(SEATED_TILT_MAX_DEG);
    expect(effectiveTiltDeg(10, 1)).toBe(2.5);
    expect(effectiveTiltDeg(0, 1)).toBe(0);
    expect(effectiveTiltDeg(20, 0.5)).toBe(12.5);
    // eased: no jump at either end
    expect(20 - effectiveTiltDeg(20, 0.01)).toBeLessThan(0.01);
    expect(effectiveTiltDeg(20, 0.99) - 5).toBeLessThan(0.01);
  });

  it('eases into a sit quickly and out of it more slowly', () => {
    let s = 0, t = 0;
    while (s < 1) { s = stepSeated(s, 1, 1 / 60); t += 1 / 60; }
    expect(t).toBeCloseTo(SEATED_TILT_DOWN_SECONDS, 1);
    t = 0;
    while (s > 0) { s = stepSeated(s, 0, 1 / 60); t += 1 / 60; }
    expect(t).toBeCloseTo(SEATED_TILT_UP_SECONDS, 1);
    expect(stepSeated(0.4, 1, 0)).toBe(0.4);
  });
});

describe('the bust\'s manual size', () => {
  it('leaves the slider\'s bust alone at 0, reaches 2.0x at +100% at every belly size, and takes 30% off at -30%', () => {
    expect(BREAST_MANUAL_MAX_VOLUME).toBe(2);
    for (const p of [0, 30, 100, 150, 200]) {
      expect(bustVolume(p, 0)).toBe(breastVolumeRatio(p));
      expect(bustVolume(p, 100)).toBeCloseTo(2, 12);
      expect(bustVolume(p, 500)).toBeCloseTo(2, 12);
      expect(bustVolume(p, -30)).toBeCloseTo(breastVolumeRatio(p) * 0.7, 12);
    }
    expect(breastVolumeRatio(200)).toBeCloseTo(1.55, 12);
    expect(bustVolume(200, 50)).toBeCloseTo(1.775, 12);
  });

  it('grows past 1.55x with the midline-guarded field, breastGrow itself holding at its own end', () => {
    const shaped = (size: number) => ({ ...defaultBodyShape(), breastSize: size });
    expect(breastWeightsForShape(200, true, 100)[BREAST_GROW_TARGET]).toBe(1);
    expect(bodyShapeFieldWeights(shaped(100), 200)['shape:breastGrowMore']).toBeCloseTo((Math.cbrt(2) - 1) / (Math.cbrt(1.55) - 1) - 1, 10);
    expect(bodyShapeFieldWeights(shaped(0), 200)['shape:breastGrowMore']).toBe(0);
    expect(bodyShapeFieldWeights(shaped(20), 30)['shape:breastGrowMore']).toBe(0);
  });
});

describe('the shape fields\' weights', () => {
  it('are all zero for the approved body, at every size', () => {
    for (const p of [0, 50, 90, 100, 125, 150, 175, 200]) {
      const w = bodyShapeFieldWeights(defaultBodyShape(), p);
      for (const [k, v] of Object.entries(w)) expect(Math.abs(v), `${k} at ${p}%`).toBe(0);
    }
  });

  it('crossfade the exact height shifts between the size keys', () => {
    expect(bellyHeightWeights(BELLY_HEIGHT_END_CM, 100)['shape:bellyHeightUp']).toBe(1);
    expect(bellyHeightWeights(-BELLY_HEIGHT_END_CM, 200)['shape:bellyHeightDown200']).toBe(1);
    const mid = bellyHeightWeights(1, 125);
    expect(mid['shape:bellyHeightUp']).toBeCloseTo(0.25);
    expect(mid['shape:bellyHeightUp150']).toBeCloseTo(0.25);
    expect(mid['shape:bellyHeightDown150']).toBe(0);
    expect(bellyHeightWeights(2, 50)['shape:bellyHeightUp']).toBeCloseTo(0.27);
    expect(bellyHeightWeights(9, 150)['shape:bellyHeightUp150']).toBe(1);
  });

  it('match the size tables stamped into the body file', async () => {
    await MeshoptDecoder.ready;
    const v2body = SARAH_LAB_MODELS.find((m) => m.id === 'v2-body');
    expect(v2body).toBeDefined();
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(`public/${v2body!.path}`);
    const extras = doc.getRoot().listMeshes()[0].getExtras() as { bellyShapeScale: number[][]; bellyLowerScale: number[][]; targetNames: string[] };
    expect(extras.bellyShapeScale).toEqual(BELLY_SHAPE_SCALE.map((r) => [...r]));
    expect(extras.bellyLowerScale).toEqual(BELLY_LOWER_SCALE.map((r) => [...r]));
    // every field the weights name is in the file
    const named = Object.keys(bodyShapeFieldWeights(defaultBodyShape(), 150)).concat(Object.keys(bellyHeightWeights(1, 175)), Object.keys(bellyHeightWeights(-1, 90)));
    for (const k of named) expect(extras.targetNames, k).toContain(k);
  }, 60000);
});
