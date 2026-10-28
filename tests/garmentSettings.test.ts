/**
 * THE NEW TEE'S SETTINGS (`garment/settings.ts`, Stage 3), the contract the cuts, the cloth, the saves and the panel are
 * built against:
 * - GARMENT_DEFAULTS drafts exactly the approved tee: `tailorParams` through `teeParams` gives TEE_DEFAULTS in every
 *   field the plain tee has (the full extent and the U neckline on top).
 * - `clampGarmentSettings` reads anything: unknown fields dropped, numbers clamped to GARMENT_RANGES, unreadable ones
 *   from the base, a null neckline width kept (the construction's own), a bad construction the base's; never throws.
 * - `withConstruction` takes the construction's own gusset and neckline width; `draftedNeckDrop` drafts NECKLINE DEPTH
 *   only while it is higher than the scoop; `tailorKey` moves with every re-tailor setting and never with an instant one.
 * - `stopValue` is straight between stops and held at the ends; `nearestStop` names the nearest.
 */
import { describe, expect, it } from 'vitest';
import { TEE_DEFAULTS, teeParams } from '../src/sarahlab/garment/draft';
import {
  CONSTRUCTION_DEFAULTS, GARMENT_DEFAULTS, GARMENT_RANGES, LENGTH_STOPS, NECK_DEPTH_CREW, RETAILOR_KEYS, SLEEVE_STOPS,
  clampGarmentSettings, draftedNeckDrop, nearestStop, sameGarment, stopValue, tailorKey, tailorParams, withConstruction,
  type GarmentSettings,
} from '../src/sarahlab/garment/settings';

describe('the defaults', () => {
  it('draft exactly the approved tee, at its full extent', () => {
    const p = teeParams(tailorParams(GARMENT_DEFAULTS));
    for (const k of Object.keys(TEE_DEFAULTS) as (keyof typeof TEE_DEFAULTS)[]) expect(p[k], k).toEqual(TEE_DEFAULTS[k]);
    expect(p.extend).toBe(true);
    expect(p.neckCurve).toBe(0);
  });
  it('a set-in drafts its own neckline and no gusset', () => {
    const p = teeParams(tailorParams(withConstruction(GARMENT_DEFAULTS, 'setIn')));
    expect(p.construction).toBe('setIn');
    expect(p.gusset).toBe(0);
    expect(p.neckWidth).toBe(CONSTRUCTION_DEFAULTS.setIn.neckWidth);
    expect(p.neckBand).toBe(1);
  });
  it('stand on the drafted stops: Standard length, Short sleeves', () => {
    expect(nearestStop(GARMENT_DEFAULTS.length, LENGTH_STOPS).id).toBe('standard');
    expect(LENGTH_STOPS.find((s) => s.id === 'standard')!.at).toBe(GARMENT_DEFAULTS.length);
    expect(SLEEVE_STOPS.find((s) => s.id === 'short')!.at).toBe(GARMENT_DEFAULTS.sleeve);
  });
  it('lie inside every range', () => {
    expect(clampGarmentSettings(GARMENT_DEFAULTS)).toEqual(GARMENT_DEFAULTS);
  });
});

describe('clampGarmentSettings', () => {
  it('reads garbage as the base, and never throws', () => {
    for (const raw of [null, undefined, 3, 'x', [], { construction: 'cape' }, { length: 'long' }]) expect(clampGarmentSettings(raw)).toEqual(GARMENT_DEFAULTS);
  });
  it('clamps every number to its range', () => {
    const s = clampGarmentSettings({ gusset: 9, neckWidth: 0.01, neckCurve: -1, ease: { bust: 1, waist: -1, hip: 0.05 }, length: 400, frontHem: -1, backHem: 1, hemCurve: 7, sleeve: -5, neckDepth: 5, bellyRoom: 2 });
    const R = GARMENT_RANGES;
    expect(s).toMatchObject({ gusset: R.gusset[1], neckWidth: R.neckWidth[0], neckCurve: 0, length: 100, frontHem: R.frontHem[0], backHem: R.backHem[1], hemCurve: 1, sleeve: 0, neckDepth: R.neckDepth[1], bellyRoom: 1 });
    expect(s.ease).toEqual({ bust: R.ease[1], waist: R.ease[0], hip: 0.05 });
  });
  it('takes what it cannot read from the base, and keeps a null width', () => {
    const base: GarmentSettings = { ...GARMENT_DEFAULTS, length: 60, neckWidth: 0.22 };
    expect(clampGarmentSettings({ length: NaN, neckWidth: 'wide' }, base)).toMatchObject({ length: 60, neckWidth: 0.22 });
    expect(clampGarmentSettings({ neckWidth: null }, base).neckWidth).toBeNull();
    expect(clampGarmentSettings({}, GARMENT_DEFAULTS).neckWidth).toBeNull();
    expect(clampGarmentSettings({ construction: 'setIn' }).construction).toBe('setIn');
  });
  it('drops fields it does not know', () => {
    expect(Object.keys(clampGarmentSettings({ ...GARMENT_DEFAULTS, flare: 1 } as unknown))).not.toContain('flare');
  });
});

describe('re-tailor and instant', () => {
  const key = (patch: Partial<GarmentSettings>) => tailorKey({ ...GARMENT_DEFAULTS, ...patch });
  const base = tailorKey(GARMENT_DEFAULTS);
  it('an instant setting never re-tailors', () => {
    for (const patch of [{ length: 90 }, { frontHem: 0.05 }, { backHem: -0.03 }, { hemCurve: 1 }, { sleeve: 100 }, { neckDepth: 0.2 }, { bellyRoom: 0.6 }]) expect(key(patch), JSON.stringify(patch)).toBe(base);
  });
  it('every re-tailor setting does', () => {
    for (const patch of [{ construction: 'setIn' as const }, { gusset: 0.2 }, { neckWidth: 0.24 }, { neckCurve: 1 }, { ease: { ...GARMENT_DEFAULTS.ease, bust: 0.05 } }, { neckDepth: NECK_DEPTH_CREW }]) expect(key(patch), JSON.stringify(patch)).not.toBe(base);
    expect(RETAILOR_KEYS).toEqual(['construction', 'gusset', 'neckWidth', 'neckCurve', 'ease']);
  });
  it('the neckline is drafted only while it is higher than the scoop', () => {
    expect(draftedNeckDrop({ ...GARMENT_DEFAULTS, neckDepth: 0.2 })).toBe(TEE_DEFAULTS.neckDrop);
    expect(draftedNeckDrop({ ...GARMENT_DEFAULTS, neckDepth: 0.02 })).toBe(0.02);
  });
  it('a null width and the construction\'s own width draft the same', () => {
    expect(key({ neckWidth: CONSTRUCTION_DEFAULTS.raglan.neckWidth })).toBe(base);
  });
  it('withConstruction takes the construction\'s own gusset and width', () => {
    const s = withConstruction({ ...GARMENT_DEFAULTS, gusset: 0.8, neckWidth: 0.25 }, 'setIn');
    expect(s).toMatchObject({ construction: 'setIn', gusset: 0, neckWidth: null });
    expect(withConstruction(GARMENT_DEFAULTS, 'raglan')).toBe(GARMENT_DEFAULTS);
  });
  it('sameGarment compares every control', () => {
    expect(sameGarment(GARMENT_DEFAULTS, { ...GARMENT_DEFAULTS })).toBe(true);
    expect(sameGarment(GARMENT_DEFAULTS, { ...GARMENT_DEFAULTS, sleeve: 41 })).toBe(false);
  });
});

describe('stops', () => {
  const values = [10, 20, 40, 80, 160];
  it('are straight between stops and held at the ends', () => {
    expect(stopValue(0, LENGTH_STOPS, values)).toBe(10);
    expect(stopValue(25, LENGTH_STOPS, values)).toBe(20);
    expect(stopValue(37.5, LENGTH_STOPS, values)).toBe(30);
    expect(stopValue(100, LENGTH_STOPS, values)).toBe(160);
    expect(stopValue(-50, LENGTH_STOPS, values)).toBe(10);
    expect(stopValue(500, LENGTH_STOPS, values)).toBe(160);
    expect(stopValue(NaN, LENGTH_STOPS, values)).toBe(10);
  });
  it('name the nearest', () => {
    expect(nearestStop(11, SLEEVE_STOPS).id).toBe('cap');
    expect(nearestStop(88, SLEEVE_STOPS).id).toBe('threeQuarter');
    expect(nearestStop(10, SLEEVE_STOPS).id).toBe('tank');
  });
  it('run in order', () => {
    for (const stops of [LENGTH_STOPS, SLEEVE_STOPS]) {
      expect(stops[0].at).toBe(0);
      expect(stops[stops.length - 1].at).toBe(100);
      for (let i = 1; i < stops.length; i++) expect(stops[i].at).toBeGreaterThan(stops[i - 1].at);
    }
  });
});
