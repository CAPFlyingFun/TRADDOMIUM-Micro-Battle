/**
 * The fabric editor's data (src/sarahlab/fabricLibrary.ts) and body paint (src/sarahlab/bodyPaint.ts): Joshua's pack
 * is served whole, each swatch is cut from inside its cell or strip, hosiery starts half see-through, a fill lands on
 * exactly the footprint `coverMask` uses for that garment, the brush and eraser change only what is within reach, and
 * an outfit's paint round-trips through its JSON form.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import {
  DEFAULT_CHOICE, FABRIC_COLOURS, FABRIC_FAMILIES, PAINT_FILLS, base64ToBytes, bytesToBase64, colourName, opacityOf, swatchRect, tileUnits, trimPick,
} from '../src/sarahlab/fabricLibrary';
import { PAINT_LAYER_COUNT, clearLayer, dab, fillLayer, packLayer, unpackLayer, vertexNeighbours } from '../src/sarahlab/bodyPaint';
import { coverMask } from '../src/sarahlab/sarahLabTool';

describe('the fabric pack', () => {
  it('serves all ten atlases at full resolution, a plain and a trim for each of five families', () => {
    expect(FABRIC_FAMILIES.map((f) => f.id)).toEqual(['jersey', 'athletic', 'sweater', 'ribbed', 'pantyhose']);
    for (const f of FABRIC_FAMILIES) for (const path of [f.plain, f.trim]) {
      expect(existsSync(`public/${path}`), path).toBe(true);
      expect(statSync(`public/${path}`).size, `${path} is the pack's full-size file`).toBeGreaterThan(900_000);
    }
    expect(FABRIC_COLOURS).toHaveLength(16);
    expect(colourName('pantyhose', 12)).toBe('Mint');
    expect(colourName('jersey', 11)).toBe('Olive');
  });

  it('cuts a swatch from inside its cell, or the knit band from the middle of its strip', () => {
    for (let i = 0; i < 16; i++) {
      const g = swatchRect('grid', i, 1536), col = i % 4, row = Math.floor(i / 4);
      expect(g.x).toBeGreaterThan(col * 384); expect(g.x + g.w).toBeLessThan((col + 1) * 384);
      expect(g.y).toBeGreaterThan(row * 384); expect(g.y + g.h).toBeLessThan((row + 1) * 384);
      expect(g.w).toBe(g.h); // a square swatch: the stitch keeps its proportions
      const s = swatchRect('strips', i, 1536);
      expect(s.y).toBeGreaterThan(i * 96); expect(s.y + s.h).toBeLessThan((i + 1) * 96);
      expect(s.w).toBe(1536);
    }
  });

  it('starts hosiery at half opacity and everything else opaque, and trim follows the fabric while matched', () => {
    expect(opacityOf({ ...DEFAULT_CHOICE, fabric: { family: 'pantyhose', colour: 4 } })).toBe(0.5);
    expect(opacityOf({ ...DEFAULT_CHOICE, fabric: { family: 'jersey', colour: 4 } })).toBe(1);
    expect(opacityOf({ ...DEFAULT_CHOICE, fabric: { family: 'pantyhose', colour: 4 }, opacity: 0.8 })).toBe(0.8);
    const fabric = { family: 'ribbed' as const, colour: 8 }, own = { family: 'jersey' as const, colour: 0 };
    expect(trimPick({ ...DEFAULT_CHOICE, fabric, trim: own, match: true })).toEqual(fabric);
    expect(trimPick({ ...DEFAULT_CHOICE, fabric, trim: own, match: false })).toEqual(own);
    expect(tileUnits(FABRIC_FAMILIES[1], 2, 1)).toBe(10);
  });

  it('fills on the same footprint the room uses for each garment', () => {
    const bits = Object.fromEntries(PAINT_FILLS.map((f) => [f.id, f.bits]));
    expect(bits.top).toBe(coverMask(['shirt']));
    expect(bits.leggings).toBe(coverMask(['leggings']));
    expect(bits.leggingsLow).toBe(coverMask(['leggingsLow']));
  });
});

describe('body paint', () => {
  // a strip of 6 vertices along x, two triangles per square
  const rest = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0]);
  const index = [0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5];
  const n = 6;

  it('fills a footprint, softening its edge, without touching other layers', () => {
    const w = new Float32Array(n * PAINT_LAYER_COUNT);
    w[0 * PAINT_LAYER_COUNT + 2] = 0.7;
    fillLayer(w, 0, [1, 1, 1, 0, 0, 0], 1, vertexNeighbours(index, n), 1);
    const l0 = Array.from({ length: n }, (_, v) => w[v * PAINT_LAYER_COUNT]);
    expect(l0[0]).toBe(1); // inside stays painted
    expect(l0[3]).toBeGreaterThan(0); // the edge is soft...
    expect(l0[3]).toBeLessThan(1);
    expect(l0[5]).toBe(0); // ...and far outside is bare
    expect(w[2]).toBeCloseTo(0.7); // layer 2 untouched
    clearLayer(w, 0);
    expect(Array.from({ length: n }, (_, v) => w[v * PAINT_LAYER_COUNT]).every((x) => x === 0)).toBe(true);
    expect(w[2]).toBeCloseTo(0.7);
  });

  it('paints and erases only within the brush, measured on the rest surface', () => {
    const w = new Float32Array(n * PAINT_LAYER_COUNT);
    for (let k = 0; k < 10; k++) dab(w, 1, rest, { x: 0, y: 0, z: 0 }, 1.5, 0.5, false);
    expect(w[0 * PAINT_LAYER_COUNT + 1]).toBe(1);
    expect(w[1 * PAINT_LAYER_COUNT + 1]).toBeGreaterThan(0);
    expect(w[2 * PAINT_LAYER_COUNT + 1]).toBe(0); // 2 units away: outside a 1.5 brush
    for (let k = 0; k < 10; k++) dab(w, 1, rest, { x: 0, y: 0, z: 0 }, 0.5, 0.5, true);
    expect(w[0 * PAINT_LAYER_COUNT + 1]).toBe(0);
    expect(w[1 * PAINT_LAYER_COUNT + 1]).toBeGreaterThan(0); // the eraser was smaller
  });

  it('round-trips a layer through bytes and base64, the form an outfit file keeps', () => {
    const w = new Float32Array(n * PAINT_LAYER_COUNT);
    fillLayer(w, 2, [0, 1, 1, 0, 1, 0], 1, null);
    const text = bytesToBase64(packLayer(w, 2));
    const back = new Float32Array(n * PAINT_LAYER_COUNT);
    unpackLayer(back, 2, base64ToBytes(text));
    for (let v = 0; v < n; v++) expect(back[v * PAINT_LAYER_COUNT + 2]).toBeCloseTo(w[v * PAINT_LAYER_COUNT + 2], 2);
  });
});

import { BODY_REGIONS, REGION_GROUPS, groupRegions, mapBody, mirrorIndex, regionNumber } from '../src/sarahlab/bodyRegions';
import { COVERAGE_TEMPLATES, coverage, withDial } from '../src/sarahlab/paintTemplates';

describe('the body map', () => {
  // a toy skeleton facing +z, her left toward +x: 0 pelvis, 1 spine, 2 chest, 3 neck, 4 head, 5 shoulderL, 6 elbowL,
  // 7 wristL, 8 fingerL (unnamed), 9 shoulderR, 10 elbowR, 11 wristR, 12 hipL, 13 kneeL, 14 ankleL, 15 hipR, 16 kneeR,
  // 17 ankleR, 18 clavicleL (unnamed)
  const parents = [-1, 0, 1, 2, 3, 18, 5, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2];
  const joints = { pelvis: 0, spine: 1, chest: 2, neck: 3, head: 4, shoulderL: 5, elbowL: 6, wristL: 7, shoulderR: 9, elbowR: 10, wristR: 11, hipL: 12, kneeL: 13, ankleL: 14, hipR: 15, kneeR: 16, ankleR: 17 };
  const J = { pelvis: [0, 0.5, 0], spine: [0, 3, 0], chest: [0, 6, 0], neck: [0, 10, 0], head: [0, 12, 0], shoulderL: [2, 9, 0], elbowL: [5, 9, 0], wristL: [8, 9, 0],
    shoulderR: [-2, 9, 0], elbowR: [-5, 9, 0], wristR: [-8, 9, 0], hipL: [1, 0, 0], kneeL: [1, -5, 0], ankleL: [1, -10, 0], hipR: [-1, 0, 0], kneeR: [-1, -5, 0], ankleR: [-1, -10, 0] } as const;
  /** One vertex per case: its main bone, normal z, position, and the region it belongs to. */
  const cases: [number, number, [number, number, number], string][] = [
    [4, 1, [0, 14, 0.2], 'scalp'], [4, 1, [0, 12.5, 1.2], 'face'], [4, 1, [0, 11.5, 1.0], 'face'], [4, -1, [0, 12.5, -1.2], 'scalp'], [3, 1, [0, 10.6, 0.5], 'neck'], [3, -1, [0, 11.2, -0.5], 'neck'],
    [2, 1, [0, 7, 2], 'chest'], [1, 1, [0, 5, 4], 'belly'], [0, 1, [0, 1, 4], 'belly'], [0, 1, [0, -1, 1], 'crotch'], [0, 1, [1.8, -1, 1], 'hips'],
    [2, -1, [0, 7, -2], 'upperBack'], [1, -1, [0, 3, -2], 'lowerBack'], [0, -1, [0, -0.5, -2], 'seat'], [2, 1, [1.5, 10.2, 0], 'chest'],
    [12, 1, [1.5, -3, 0.5], 'thighL'], [13, 1, [1, -5, 0.5], 'kneeL'], [13, 1, [1, -8, 0.5], 'calfL'], [14, 1, [1, -10.5, 1], 'footL'], [15, -1, [-1.2, -0.5, -1], 'seat'],
    [5, 1, [3, 9, 0.3], 'upperArmL'], [6, 1, [6, 9, 0.3], 'forearmL'], [8, 1, [8.5, 9, 0.3], 'handL'], [9, 1, [-3, 9, 0.3], 'upperArmR'],
  ];
  const input = (flip: number) => ({
    skinIndex: cases.flatMap(([b]) => [b, 0, 0, 0]),
    skinWeight: cases.flatMap(() => [0.7, 0.3, 0, 0]),
    parents, joints,
    jointAt: Object.fromEntries(Object.entries(J).map(([k, [x, y, z]]) => [k, [x, y, z * flip]])) as unknown as Record<keyof typeof J, [number, number, number]>,
    restNormal: cases.flatMap(([, nz]) => [0, 0, nz * flip]),
    restPosition: cases.flatMap(([, , [x, y, z]]) => [x, y, z * flip]),
  });

  it('maps every vertex: limbs by the bone that carries them and their place along it, the torso by trunk height, the head by the neck axis', () => {
    const map = mapBody(input(1));
    cases.forEach(([, , , want], v) => expect(BODY_REGIONS[map.region[v] - 1].id, `vertex ${v}`).toBe(want));
    const of = (id: string) => cases.findIndex(([, , , want]) => want === id);
    expect(map.leg[of('thighL')]).toBeCloseTo(0.3); expect(map.arm[of('upperArmL')]).toBeCloseTo(1 / 6); expect(map.trunk[of('chest')]).toBeCloseTo(0.7);
  });

  it('finds which way she faces from her belly, so a model turned round maps the same', () => {
    const map = mapBody(input(-1));
    cases.forEach(([, , , want], v) => expect(BODY_REGIONS[map.region[v] - 1].id, `vertex ${v}`).toBe(want));
  });

  it('treats back skin her arm carries on one side as torso when its mirror image is torso (straps sit evenly)', () => {
    // the same spot on her back either side of the spine: the spine carries one, the left shoulder the other
    const m = mapBody({
      skinIndex: [2, 0, 0, 0, 5, 0, 0, 0], skinWeight: [0.7, 0.3, 0, 0, 0.7, 0.3, 0, 0], parents, joints,
      jointAt: J as unknown as Record<keyof typeof J, [number, number, number]>,
      restNormal: [0, 0, -1, 0, 0, -1], restPosition: [-1.5, 7.5, -2, 1.5, 7.5, -2],
    });
    expect(Array.from(m.region).map((r) => BODY_REGIONS[r - 1].id)).toEqual(['upperBack', 'upperBack']);
    expect(Number.isFinite(m.arm[1])).toBe(false);
  });

  it('pairs each vertex with its mirror image, for MIRROR', () => {
    expect(Array.from(mirrorIndex([1, 0, 0, -1, 0, 0, 0, 2, 0], 0))).toEqual([1, 0, 2]);
  });

  it('offers both sides of a limb or one, and every region in some group', () => {
    const arms = REGION_GROUPS.find((g) => g.id === 'upperArms')!;
    expect(groupRegions(arms, 'both')).toEqual([regionNumber('upperArmL'), regionNumber('upperArmR')]);
    expect(groupRegions(arms, 'L')).toEqual([regionNumber('upperArmL')]);
    expect(groupRegions(REGION_GROUPS.find((g) => g.id === 'belly')!, 'R')).toEqual([regionNumber('belly')]);
    expect(new Set(REGION_GROUPS.flatMap((g) => g.regions))).toEqual(new Set(BODY_REGIONS.map((r) => r.id)));
  });

  it('turns a clothing template into coverage that ends where its dials say', () => {
    const map = mapBody(input(1)), at = (id: string) => cases.findIndex(([, , , want]) => want === id);
    const t = (id: string) => COVERAGE_TEMPLATES.find((x) => x.id === id)!.params;
    const full = coverage(map, t('leggingsFull'));
    expect(full[at('thighL')]).toBe(1); expect(full[at('calfL')]).toBe(1); expect(full[at('footL')]).toBe(0); expect(full[at('chest')]).toBe(0); expect(full[at('upperArmL')]).toBe(0);
    const knee = coverage(map, withDial(t('leggingsFull'), 'legEnd', 0.4));
    expect(knee[at('thighL')]).toBe(1); expect(knee[at('calfL')]).toBe(0);
    const tee = coverage(map, t('maternity'));
    expect(tee[at('belly')]).toBe(1); expect(tee[at('upperArmL')]).toBe(1); expect(tee[at('forearmL')]).toBe(0); expect(tee[at('face')]).toBe(0);
    expect(coverage(map, t('crop'))[at('belly')]).toBe(0);
    // a leotard's or a swimsuit's legs end at its leg openings, whatever its top would reach
    for (const id of ['bodysuit', 'swimsuit']) { const c = coverage(map, t(id)); expect(c[at('calfL')], id).toBe(0); expect(c[at('kneeL')], id).toBe(0); expect(c[at('belly')], id).toBe(1); }
    expect(coverage(map, t('bodysuitFull'))[at('calfL')]).toBe(1);
    const socks = coverage(map, t('socks'));
    expect(socks[at('footL')]).toBe(1); expect(socks[at('thighL')]).toBe(0);
  });
});

describe('templates wrap round her (Joshua, 2026-10-20: no gaps at the hips, smooth front-to-back)', () => {
  /** A hand-made map: vertices at her front, side and back of the waist, and on her hip and thigh. */
  const ids = ['belly', 'hips', 'lowerBack', 'thighL', 'seat'];
  const map = (trunk: number[], around: number[], leg: number[]) => ({
    region: Uint8Array.from(ids.map(regionNumber)), trunk: Float32Array.from(trunk), leg: Float32Array.from(leg),
    arm: new Float32Array(5).fill(NaN), side: new Int8Array(5), front: Int8Array.from([1, 1, -1, 1, -1]), across: new Float32Array(5),
    collar: new Float32Array(5).fill(9), lateral: new Float32Array(5).fill(9), around: Float32Array.from(around), mirror: new Int32Array(5).fill(-1), trunkLength: 1, neckRadius: 0.14, hipSpan: 0.3, sideFacing: new Float32Array(16), upFacing: new Float32Array(16), legAround: new Float32Array(16).fill(NaN), facing: 1,
  });
  const t = (id: string) => COVERAGE_TEMPLATES.find((x) => x.id === id)!.params;

  it('carries an under-belly waistband in a U under the bump, over the hips and level across the back', () => {
    // waist skin at the same height (trunk 0.12) in front, at the side, behind, and part way round the front
    const m = map([0.12, 0.12, 0.12, 0.12, 0], [1, 0.5, 0, 0.65, 0], [NaN, NaN, NaN, NaN, 0.05]);
    const c = coverage(m, t('leggingsUnder'));
    expect(c[0]).toBe(0); // under the bump: bare above the low front waistband
    expect(c[1]).toBe(1); // over the hips: covered
    expect(c[2]).toBe(1); // behind: covered
    expect(c[3]).toBeGreaterThan(0); expect(c[3]).toBeLessThan(1); // the U's side, between: a curve, not a step
  });

  it('never cuts across her seat: every short and legging covers the back up past its fullest point (Joshua, 2026-10-20)', () => {
    // back skin at trunk 0.06 (the fullest point of her seat) to 0.25 (above it, over the sacrum)
    const back = [0.06, 0.12, 0.18, 0.22, 0.25];
    const m = map(back, [0, 0, 0, 0, 0], [NaN, NaN, NaN, NaN, NaN]);
    m.region.fill(regionNumber('lowerBack'));
    for (const id of ['leggingsUnder', 'leggingsFull', 'shortsMid', 'shortsAthletic', 'shortsKnee']) {
      expect(Array.from(coverage(m, t(id))).every((x) => x === 1), id).toBe(true);
    }
    // and the hips-and-back dial still moves it
    expect(coverage(m, withDial(t('shortsMid'), 'riseBack', 0.1))[4]).toBe(0);
  });

  it('covers the side of the hip and the top of the thigh whatever region the skin falls in', () => {
    const m = map([-0.1, -0.02, -0.05, -0.1, -0.06], [1, 0.5, 0, 0.5, 0], [NaN, NaN, NaN, 0.05, 0.02]);
    for (const id of ['leggingsUnder', 'leggingsFull', 'shortsMid', 'shortsAthletic']) {
      const c = coverage(m, t(id));
      expect(Array.from(c).every((x) => x === 1), `${id}: ${Array.from(c).join(',')}`).toBe(true);
    }
    // and a regular-length shirt reaches the hip's side too
    expect(coverage(m, t('teeShort'))[1]).toBe(1);
  });
});

describe('straps and band tops (Joshua, 2026-10-20: the tank "proper two straps")', () => {
  // shoulder-top skin: by the neck (at its base), on the strap line, at the outer shoulder; and chest skin at 0.7
  const lateral = [0.5, 1.27, 2.0, 2.0], trunk = [1.0, 0.95, 0.95, 0.7];
  const m = {
    region: Uint8Array.from([regionNumber('upperBack'), regionNumber('upperBack'), regionNumber('upperBack'), regionNumber('chest')]),
    trunk: Float32Array.from(trunk), leg: new Float32Array(4).fill(NaN), arm: new Float32Array(4).fill(NaN), side: new Int8Array(4),
    front: Int8Array.from([-1, -1, -1, 1]), across: new Float32Array(4), collar: Float32Array.from(lateral), lateral: Float32Array.from(lateral),
    around: Float32Array.from([0.3, 0.3, 0.3, 0.9]), mirror: new Int32Array(4).fill(-1), trunkLength: 1, neckRadius: 0.14, hipSpan: 0.3, sideFacing: new Float32Array(16), upFacing: new Float32Array(16), legAround: new Float32Array(16).fill(NaN), facing: 1,
  };
  const t = (id: string) => COVERAGE_TEMPLATES.find((x) => x.id === id)!.params;
  it('runs a tank\'s straps over the middle of her shoulders, bare by the neck and past the strap', () => {
    expect(Array.from(coverage(m, t('tank')))).toEqual([0, 1, 0, 1]);
  });
  it("gives a one-piece swimsuit the same straps: its body below doesn't fill her shoulders", () => {
    expect(Array.from(coverage(m, t('swimsuit')))).toEqual([0, 1, 0, 1]);
  });
  it("cuts a leotard's legs high: along the creases in front, up over the hips, a strip behind (Joshua, 2026-10-21)", () => {
    const pts: [string, number, number, number, number?][] = [ // region, trunk, across, around, facing sideways
      ['crotch', -0.12, 0.05, 1], ['hips', 0.18, 1.2, 0.6], ['hips', 0.34, 1.2, 0.6], ['seat', 0, 0.6, 0.05], ['belly', 0, 0.3, 1], ['seat', -0.1, 0, 0.02],
      ['crotch', -0.3, 0.1, 0.9], // inner thigh, where her legs meet below the crotch: bare
      ['thighL', -0.08, 0.4, 0.9], // the top of her thigh beside the crotch (her leg's skin): bare
      ['thighL', -0.14, 0.35, 0.9], // further out at the crotch's height, in front (her leg's skin): bare
      ['seat', -0.1, 0.3, 0.1], // ...and behind
      ['seat', 0.1, 0.6, 0.05], // the outer part of her seat: bare (still high-cut)
      ['seat', 0, 0.15, 0.05], // her seat beside the strip: bare, as he drew it
      ['thighL', -0.12, 0.05, 0.9, 0.9], // the inside of her thigh where the legs meet, facing sideways: bare
      ['crotch', -0.08, 0.15, 1], // over the front of the crotch, beside the middle: covered
      ['thighL', -0.08, 0.15, 0.9], // the top of her thigh there, facing forward: by height alone, covered (on Sarah her traced line decides)
    ];
    const k = pts.length, lm = {
      region: Uint8Array.from(pts.map(([r]) => regionNumber(r))), trunk: Float32Array.from(pts.map((x) => x[1])), across: Float32Array.from(pts.map((x) => x[2])),
      around: Float32Array.from(pts.map((x) => x[3])), leg: new Float32Array(k).fill(NaN), arm: new Float32Array(k).fill(NaN), side: new Int8Array(k),
      front: Int8Array.from(pts.map((x) => (x[3] < 0.5 ? -1 : 1))), collar: new Float32Array(k).fill(9), lateral: new Float32Array(k).fill(1), mirror: new Int32Array(k).fill(-1),
      trunkLength: 1, neckRadius: 0.14, hipSpan: 0.3, sideFacing: Float32Array.from(pts.map((x) => x[4] ?? 0)), upFacing: new Float32Array(16), legAround: Float32Array.from(pts.map(([r, , , ar]) => (r.startsWith('thigh') ? ar : NaN))), facing: 1,
    };
    expect(Array.from(coverage(lm, t('bodysuit'))).map((x) => Math.round(x))).toEqual([1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });
  it('gives a bandeau a straight top edge and no straps', () => {
    expect(Array.from(coverage(m, t('bandeau')))).toEqual([0, 0, 0, 1]);
  });
});

import { bodyDetail, DEFAULT_KEEP, KEEP_PRESETS } from '../src/sarahlab/bodyDetail';

describe('detail through paint (Joshua, 2026-10-20: nipples to about 45%, the navel to about 80%)', () => {
  // a flat front of a "chest", 31 x 31 vertices a unit apart facing +z, with a small bump on each side and a dimple
  // in the middle below them
  const W = 31, n = W * W, P = new Float32Array(n * 3), N = new Float32Array(n * 3), index: number[] = [];
  const bump = (x: number, y: number, cx: number, cy: number, h: number) => h * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 2);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const v = j * W + i, x = i - 15, y = j - 15;
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = bump(x, y, -6, 5, 1) + bump(x, y, 6, 5, 1) - bump(x, y, 0, -8, 0.8);
    N[v * 3 + 2] = 1;
    if (i < W - 1 && j < W - 1) index.push(v, v + 1, v + W, v + 1, v + W + 1, v + W);
  }
  const region = Uint8Array.from({ length: n }, (_, v) => regionNumber(Math.floor(v / W) - 15 > -3 ? 'chest' : 'belly'));
  const map = {
    region, trunk: new Float32Array(n).fill(0.7), leg: new Float32Array(n).fill(NaN), arm: new Float32Array(n).fill(NaN),
    side: new Int8Array(n), front: new Int8Array(n).fill(1), across: Float32Array.from({ length: n }, (_, v) => Math.abs((v % W) - 15) / 20),
    collar: new Float32Array(n).fill(9), lateral: new Float32Array(n).fill(9), around: new Float32Array(n).fill(1), mirror: new Int32Array(n).fill(-1), trunkLength: 60, neckRadius: 8, hipSpan: 20, sideFacing: new Float32Array(n), upFacing: new Float32Array(n), legAround: new Float32Array(n).fill(NaN), facing: 1,
  };

  it('finds both nipples and the navel on her own surface, and stores only their detail, softly', () => {
    const d = bodyDetail({ map, restPosition: P, restNormal: N, neighbours: vertexNeighbours(index, n), trunkLength: 60 });
    const at = (x: number, y: number) => (y + 15) * W + (x + 15);
    expect(new Set(d.nipples)).toEqual(new Set([at(-6, 5), at(6, 5)]));
    expect(d.navel).toBe(at(0, -8));
    // at a nipple's tip most of its height is detail, and the weight there is full
    expect(d.offset[at(6, 5) * 4 + 2]).toBeGreaterThan(0.5);
    expect(d.offset[at(6, 5) * 4 + 3]).toBeCloseTo(1);
    expect(d.normal[at(0, -8) * 4 + 3]).toBeCloseTo(1);
    // far from all three nothing is stored, so nothing there can ever move
    expect(d.offset[at(15, -15) * 4 + 3]).toBe(0);
    expect(d.offset[at(15, -15) * 4 + 2]).toBe(0);
  });

  it('defaults to his numbers, and thin shows more than thick', () => {
    expect(DEFAULT_KEEP).toEqual({ nipple: 0.45, navel: 0.8 });
    expect(KEEP_PRESETS.thin.nipple).toBeGreaterThan(KEEP_PRESETS.thick.nipple);
    expect(KEEP_PRESETS.thin.navel).toBeGreaterThan(KEEP_PRESETS.thick.navel);
    for (const k of Object.values(KEEP_PRESETS)) expect(k.navel).toBeGreaterThan(k.nipple); // the navel stays more visible
  });
});

import { DETAIL_MATERIALS, FAMILY_MATERIAL, autoKeep, detailMaterial, resolveDetail } from '../src/sarahlab/detailMaterials';

describe('detail through paint by material (Joshua, 2026-10-20: thickness and structure decide, sliders override)', () => {
  it("gives his tracker's AUTO percentages for every row of its formula sheet", () => {
    const want: Record<string, [number, number]> = {
      fineJersey: [48, 81], athleticKnit: [50, 85], chunkySweater: [9, 41], ribbedKnit: [34, 71], sheerNylon: [95, 100], swimsuit: [92, 99],
      sportsBra: [41, 90], structuredBra: [0, 89], paintMedium: [45, 80], paintThin: [79, 100], paintThick: [9, 44],
    };
    expect(DETAIL_MATERIALS.map((m) => m.id).sort()).toEqual(Object.keys(want).sort());
    for (const m of DETAIL_MATERIALS) {
      const k = autoKeep(m);
      expect([Math.round(k.nipple * 100), Math.round(k.navel * 100)], m.id).toEqual(want[m.id]);
    }
  });

  it('takes AUTO from the garment construction first, then the fabric family; OVERRIDE and OFF are what they say', () => {
    const auto = { mode: 'auto' as const, material: null, override: { nipple: 0.3, navel: 0.6 } };
    expect(resolveDetail(auto, 'jersey', 'sportsBra').material?.id).toBe('sportsBra');
    expect(resolveDetail(auto, 'sweater', undefined).material?.id).toBe('chunkySweater');
    expect(resolveDetail({ ...auto, material: 'structuredBra' }, 'jersey', 'swimsuit').keep.nipple).toBe(0);
    expect(resolveDetail({ ...auto, mode: 'override' }, 'jersey', undefined).keep).toEqual({ nipple: 0.3, navel: 0.6 });
    expect(resolveDetail({ ...auto, mode: 'off' }, 'jersey', undefined).keep).toEqual({ nipple: 1, navel: 1 });
    for (const id of Object.values(FAMILY_MATERIAL)) expect(detailMaterial(id), id).toBeDefined();
  });
});

import { despeckle } from '../src/sarahlab/bodyPaint';

describe('template edges are cleaned of lone stray vertices (Joshua, 2026-10-21: clean strap and armhole lines)', () => {
  it('fills a lone bare vertex and clears a lone painted one, but leaves a clean edge exactly as it is', () => {
    // a row of 9 vertices, each joined to the two beside it: an edge between 4 and 5, a lone hole at 1, a lone speck at 7
    const nb = Array.from({ length: 9 }, (_, i) => Uint32Array.from([i - 1, i + 1].filter((j) => j >= 0 && j < 9)));
    const v = Float32Array.from([1, 0, 1, 1, 1, 0, 0, 1, 0]);
    despeckle(v, nb);
    expect(Array.from(v)).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });
});

import { LEOTARD_FRONT_STENCIL, leotardFrontStencil } from '../src/sarahlab/leotardStencil';

describe("the leotard's front, traced from Joshua's lines (2026-10-21)", () => {
  it('decodes to the body it was traced on, and to nothing else', () => {
    expect(leotardFrontStencil(LEOTARD_FRONT_STENCIL.vertices - 1)).toBeNull();
    const s = leotardFrontStencil(LEOTARD_FRONT_STENCIL.vertices)!;
    let marked = 0, covered = 0, bad = 0;
    for (let v = 0; v < s.weight.length; v++) {
      if (s.weight[v] > 0) { marked++; if (s.cover[v] > 0.5) covered++; }
      if (!(s.cover[v] >= 0 && s.cover[v] <= 1 && s.weight[v] >= 0 && s.weight[v] <= 1)) bad++;
    }
    expect(bad).toBe(0);
    expect(marked).toBe(LEOTARD_FRONT_STENCIL.entries);
    // most of what it marks is the groin above his line; the rest the tops of her thighs below it
    expect(covered / marked).toBeGreaterThan(0.6);
    expect(covered / marked).toBeLessThan(0.85);
  });
});
