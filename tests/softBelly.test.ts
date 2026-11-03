import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BELLY_SOFT, createJiggleUniforms, navelPressure, NAVEL_PRESS, navelAfterBirth, NAVEL_AFTER, PUBIC_PRESS, pubicPressWant, restingSoftBelly, softAt, softBellyGive, softBellyWant, stepSoftBelly, UNITS_PER_METRE } from '../src/sarahlab/softBody';

// the way down in her frame (x her left, y up, z out of her front), `lean` degrees forward and `side` to her left
const down = (lean: number, side = 0) => { const p = (lean * Math.PI) / 180, r = (side * Math.PI) / 180; return { x: Math.sin(r), y: -Math.cos(r) * Math.cos(p), z: Math.cos(r) * Math.sin(p) }; };
const upright = down(0);

describe('her soft belly (Joshua, 2026-11-03: four rules)', () => {
  it('rule 1: fully forward 15% deeper, fully back 50% shallower, in proportion between, at full term', () => {
    expect(softBellyWant(down(90), upright, null, 1).depth).toBeCloseTo(0.15, 6);
    expect(softBellyWant(down(-90), upright, null, 1).depth).toBeCloseTo(-0.5, 6);
    expect(softBellyWant(down(45), upright, null, 1).depth).toBeCloseTo(0.075, 6);
    expect(softBellyWant(down(-45), upright, null, 1).depth).toBeCloseTo(-0.25, 6);
    expect(softBellyWant(down(0), upright, null, 1).depth).toBeCloseTo(0, 6);
  });
  it('reads her lean from how she stands, not from straight up', () => {
    const stands = down(12);
    expect(softBellyWant(down(12), stands, null, 1).leanDeg).toBeCloseTo(0, 6);
    expect(softBellyWant(down(-78), stands, null, 1).depth).toBeCloseTo(-0.5, 6);
  });
  it('rule 1a: on her side it hangs that way', () => {
    const left = softBellyWant(down(0, 90), upright, null, 1), right = softBellyWant(down(0, -90), upright, null, 1);
    expect(left.side).toBeCloseTo(BELLY_SOFT.side, 6);
    expect(right.side).toBeCloseTo(-BELLY_SOFT.side, 6);
    // (and on her side 15% shallower; rolled from her back to her side it fills back out from 50%)
    expect(left.depth).toBeCloseTo(-BELLY_SOFT.sideDepth, 6);
    const rolled = (r: number) => { const a = (r * Math.PI) / 180; return softBellyWant({ x: Math.sin(a), y: 0, z: -Math.cos(a) }, upright, null, 1).depth; };
    expect(rolled(0)).toBeCloseTo(-0.5, 6);
    expect(rolled(90)).toBeCloseTo(-0.15, 6);
    let was = rolled(0); for (let r = 5; r <= 90; r += 5) { const d = rolled(r); expect(d).toBeGreaterThanOrEqual(was - 1e-9); was = d; }
  });
  it('hangs by its weight: lighter less, heavier more', () => {
    const at = (F: number) => softBellyWant(down(0, 90), upright, null, F).side;
    expect(at(1)).toBeCloseTo(BELLY_SOFT.side, 6);
    expect(at(0.3)).toBeLessThan(at(1));
  });
  it('fed, it is a little firmer', () => {
    expect(softBellyGive(1, 50, 1)).toBeLessThan(softBellyGive(1, 50, 0));
    expect(softBellyGive(1, 50, 0)).toBeCloseTo(1, 6);
  });
  it('rule 2: a baby lower sags it, further forward deepens it', () => {
    const w = softBellyWant(down(0), upright, { low: 1, forward: 1 }, 1);
    expect(w.sag).toBeCloseTo(-BELLY_SOFT.sagBaby, 6);
    expect(w.depth).toBeCloseTo(BELLY_SOFT.depthBaby, 6);
  });
  it('rule 3: fuller holds its shape, less full gives more; firmer gives less', () => {
    expect(softBellyGive(1, 50)).toBeCloseTo(1, 6);
    expect(softBellyGive(1.5, 50)).toBeLessThan(1);
    expect(softBellyGive(0.5, 50)).toBeGreaterThan(1);
    expect(softBellyGive(1, 90)).toBeLessThan(softBellyGive(1, 10));
    expect(Math.abs(softBellyWant(down(-90), upright, null, 1.5).depth)).toBeLessThan(Math.abs(softBellyWant(down(-90), upright, null, 1).depth));
  });
  it('eases there as a heavy spring, without passing it', () => {
    const s = restingSoftBelly(); let most = 0;
    for (let t = 0; t < 8; t += 1 / 60) { stepSoftBelly(s, 1 / 60, { side: 0, sag: 0, depth: -0.5 }, 1); most = Math.min(most, s.depth); }
    expect(s.depth).toBeCloseTo(-0.5, 2);
    expect(most).toBeGreaterThan(-0.52);
  });
  it('moves a point by how far it stands out of her, its edges held', () => {
    const u = createJiggleUniforms(), out = new THREE.Vector3();
    u.bellySoft.value.set(0.2, -0.1, -0.5, 0.1);
    softAt(u, UNITS_PER_METRE, { x: 0, y: 1, z: 0.3 }, out);
    expect(out.x).toBeCloseTo(0.04, 6); expect(out.y).toBeCloseTo(-0.02, 6); expect(out.z).toBeCloseTo(-0.1, 6);
    softAt(u, UNITS_PER_METRE, { x: 0, y: 1, z: 0.05 }, out);
    expect(out.length()).toBe(0);
    softAt(u, 0, { x: 0, y: 1, z: 0.3 }, out);
    expect(out.length()).toBe(0);
  });
  it('her navel: pressure from her pregnancy, not her belly size -- none, in; full term, all the way out; half, half', () => {
    expect(navelPressure(0, 1, null)).toBe(0);
    expect(navelPressure(NAVEL_PRESS.fromWeeks, 1, null)).toBe(0);
    expect(navelPressure(NAVEL_PRESS.fullWeeks, 1, null)).toBeCloseTo(1, 6);
    expect(navelPressure((NAVEL_PRESS.fromWeeks + NAVEL_PRESS.fullWeeks) / 2, 1, null)).toBeCloseTo(0.5, 6);
    expect(navelPressure(40, 2, null)).toBeGreaterThan(navelPressure(40, 1, null));
    expect(navelPressure(40, 3, null)).toBeLessThanOrEqual(NAVEL_PRESS.most);
    // her baby forward pushes it more; dropped low in labour less; a contraction a little more
    expect(navelPressure(30, 1, { low: 0, forward: 1 })).toBeGreaterThan(navelPressure(30, 1, null));
    expect(navelPressure(40, 1, { low: 1, forward: 0 })).toBeLessThan(navelPressure(40, 1, null));
    expect(navelPressure(30, 1, null, 1)).toBeGreaterThan(navelPressure(30, 1, null, 0));
  });
  it('her navel after the birth: back in, out a while, or out for good at half', () => {
    expect(navelAfterBirth(0, 1, 0)).toBeCloseTo(1, 6);
    expect(navelAfterBirth(0, 1, 60)).toBeLessThan(0.05);
    expect(navelAfterBirth(1, 1, NAVEL_AFTER.aWhile.hold)).toBeCloseTo(1, 6);
    expect(navelAfterBirth(1, 1, 600)).toBeLessThan(0.05);
    expect(navelAfterBirth(2, 1, 6000)).toBeCloseTo(NAVEL_AFTER.stays, 3);
    expect(navelAfterBirth(1, 1, 30)).toBeGreaterThan(navelAfterBirth(0, 1, 30));
  });
  it('her pubic area is pressed as the head comes under her pubic arch, a little more in a contraction, gone once out', () => {
    expect(pubicPressWant(0.2, 0)).toBe(0);
    expect(pubicPressWant(PUBIC_PRESS.full, 1)).toBeCloseTo(PUBIC_PRESS.most, 6);
    expect(pubicPressWant(PUBIC_PRESS.full, 0)).toBeLessThan(pubicPressWant(PUBIC_PRESS.full, 1));
    expect(pubicPressWant(2, 1)).toBe(0);
    for (let d = 0; d <= 2; d += 0.05) expect(pubicPressWant(d, 1)).toBeLessThanOrEqual(PUBIC_PRESS.most + 1e-9);
  });
});
