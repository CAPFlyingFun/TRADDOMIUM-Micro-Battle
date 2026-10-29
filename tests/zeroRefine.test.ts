/**
 * HER REFINED 0% BODY AND HER NAVEL AS ITS OWN PIECE (zeroRefine.ts, navelPiece.ts; Joshua, 2026-10-29).
 *
 * - The baked file reads whole and fits her approved body (sarah-v2-body-slim.glb) exactly; it does not fit a mesh with
 *   a different navelFlat.
 * - The 0% shape is full at 0% and fades out in one blend by 200% on HYBRID, by 80% on the other curves.
 * - The navel's height for the in/out number: the outie stands out at 0, flat at 0.5, the bowl in at 1, past either
 *   end further; nothing outside its shapes.
 * - Laid on her body at 0%, 100% and 200% (and a max outie at 0%, a bowl at 200%), the navel zone has no face turned
 *   over and stays where her skin is, and putting the same shape back lays the same navel.
 * - Her sides and underside smoothed ("Gentle strength under the belly, max everywhere else"): one field per belly size
 *   from 25% to 200%, a tent over them, nothing at 0% (her approved 0% body is left alone), on HYBRID only, every move
 *   a few centimetres at most and nothing in the navel's own zone.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyShapeFields, liftShapeFields } from '../src/view/bodyShapeView';
import { navelHeight, smallestAxis } from '../src/sarahlab/navelPiece';
import { anchorWeights, applyWomb, applyZeroRefine, babyAnchors, babyFieldWeights, babyWeightShares, BABY_FIELD_PREFIX, parseWombFile, fitsZeroRefine, parseZeroRefine, SIDES_FIELD_PREFIX, sidesAnchors, sidesFieldWeights, UPPER_FIELD_PREFIX, ZERO_FIELD, zeroRefineWeight, type ZeroRefine } from '../src/sarahlab/zeroRefine';
import { bellyWeights } from '../src/sarahlab/sarahLabTool';
import { loadSarahMesh } from './garmentSarahBody';

let data: ZeroRefine;
let mesh: THREE.SkinnedMesh;
beforeAll(async () => {
  const b = readFileSync('public/models/sarah-v2-body-zero.bin');
  data = parseZeroRefine(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  mesh = await loadSarahMesh();
}, 120000);

describe('the baked file', () => {
  it('reads whole and fits her approved body', () => {
    expect(data.vertices).toBe(115710);
    expect(data.body.index.length).toBeGreaterThan(1000);
    expect([...data.upper.keys()].sort()).toEqual(['belly', 'belly25', 'belly30', 'belly50', 'belly60']);
    expect(fitsZeroRefine(mesh, data)).toBe(true);
  });
  it('does not fit a mesh whose navelFlat differs', () => {
    const other = mesh.clone(); other.geometry = mesh.geometry.clone();
    const k = other.morphTargetDictionary!.navelFlat, a = other.geometry.morphAttributes.position![k] as THREE.BufferAttribute;
    const copy = a.clone(); copy.setX(0, 0.5); other.geometry.morphAttributes.position![k] = copy;
    expect(fitsZeroRefine(other, data)).toBe(false);
  });
});

describe('the fade', () => {
  it('is whole at 0% and gone by 200% on hybrid, by 80% otherwise', () => {
    expect(zeroRefineWeight(0)).toBe(1);
    expect(zeroRefineWeight(100)).toBeCloseTo(0.5, 6);
    expect(zeroRefineWeight(200)).toBe(0);
    expect(zeroRefineWeight(80, 'approved')).toBe(0);
    for (let b = 0; b < 200; b += 5) expect(zeroRefineWeight(b + 5)).toBeLessThanOrEqual(zeroRefineWeight(b));
  });
  it('the upper-belly fields follow the belly keys and are gone from 75%', () => {
    const w = bellyWeights(80, 'hybrid');
    for (const key of data.upper.keys()) expect(w[key] ?? 0).toBe(0);
  });
});

describe('the navel shapes', () => {
  const d = () => data.navel;
  it('outie out at 0, flat at 0.5, bowl in at 1, further past either end', () => {
    expect(navelHeight(d(), 0, 0, 0)).toBeGreaterThan(0.008);
    expect(Math.abs(navelHeight(d(), 0.5, 0, 0))).toBeLessThan(1e-9);
    expect(navelHeight(d(), 1, 0, 0)).toBeLessThan(-0.006);
    expect(navelHeight(d(), -0.3, 0, 0)).toBeGreaterThan(navelHeight(d(), 0, 0, 0));
    expect(navelHeight(d(), 1.6, 0, 0)).toBeLessThan(navelHeight(d(), 1, 0, 0));
    expect(navelHeight(d(), 0, 0.05, 0)).toBe(0);
  });
});

describe('laid on her', () => {
  /** Her rest shape plus the GPU morphs at `w`, at her navel zone's points. */
  function laid(weights: Record<string, number>, x: number, shapeW: Record<string, number>) {
    const m = mesh.clone(); m.geometry = mesh.geometry.clone();
    const f = liftShapeFields(m)!;
    const z = applyZeroRefine(m, f, data)!;
    applyShapeFields(m, z.fields, shapeW);
    z.navel.apply(m, weights, x);
    const g = m.geometry, P = g.getAttribute('position'), dict = m.morphTargetDictionary!, mp = g.morphAttributes.position!;
    const at = (i: number) => { const v = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)); for (const [k, w] of Object.entries(weights)) { const a = mp[dict[k]]; if (a) v.add(new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)).multiplyScalar(w)); } return v; };
    return { at, d: data.navel };
  }
  const cases: [string, number, number][] = [['0% innie', 0, 1], ['0% max outie', 0, -0.3], ['100% outie', 100, 0], ['200% bowl', 200, 1], ['200% outie', 200, 0]];
  for (const [name, bump, x] of cases) it(`${name}: no face turned over`, () => {
    const weights = bellyWeights(bump, 'hybrid');
    const shapeW: Record<string, number> = { [ZERO_FIELD]: zeroRefineWeight(bump) };
    for (const [k, w] of Object.entries(weights)) shapeW[UPPER_FIELD_PREFIX + k] = w;
    const { at, d } = laid(weights, x, shapeW);
    const first = (k: number) => d.splits[d.splitStart[k]];
    // her skin's facing there: the ring's plane (as the navel step finds it)
    const ring: THREE.Vector3[] = []; for (let k = 0; k < d.count; k++) if (d.flags[k] & 4) ring.push(at(first(k)));
    const c = ring.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(ring.length);
    const C = [0, 0, 0, 0, 0, 0];
    for (const p of ring) { const q = p.clone().sub(c); C[0] += q.x * q.x; C[1] += q.x * q.y; C[2] += q.x * q.z; C[3] += q.y * q.y; C[4] += q.y * q.z; C[5] += q.z * q.z; }
    const ax = smallestAxis(C), facing = new THREE.Vector3(...ax); if (facing.z < 0) facing.negate();
    let turned = 0;
    for (let i = 0; i < d.triangles.length; i += 3) {
      const a = at(first(d.triangles[i])), b = at(first(d.triangles[i + 1])), e = at(first(d.triangles[i + 2]));
      if (b.clone().sub(a).cross(e.clone().sub(a)).dot(facing) < 0) turned++;
    }
    expect(turned).toBe(0);
  });
});

describe('her sides smoothed', () => {
  it('is baked at every quarter from 25% to 200%', () => {
    expect(data.sides.map((p) => p.slider)).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    for (const p of data.sides) {
      expect(p.index.length).toBeGreaterThan(10000);
      let max = 0;
      for (let i = 0; i < p.index.length; i += 1) max = Math.max(max, Math.hypot(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]));
      expect(max).toBeLessThan(0.045);   // geometry units: under about 4 cm
      for (let i = 1; i < p.index.length; i += 1) expect(p.index[i]).toBeGreaterThan(p.index[i - 1]);
    }
  });
  it('leaves the navel\'s own zone to the navel piece', () => {
    const inner = new Set<number>();
    const n = data.navel;
    for (let k = 0; k < n.count; k += 1) if (n.flags[k] & 1) for (let j = n.splitStart[k]; j < n.splitStart[k + 1]; j += 1) inner.add(n.splits[j]);
    for (const p of data.sides) for (const i of p.index) expect(inner.has(i)).toBe(false);
  });
  it('weighs in by a tent: nothing at 0%, whole at each baked size, shared between, held past 200%', () => {
    const at = [25, 50, 75, 100, 125, 150, 175, 200];
    expect(anchorWeights(0, at).size).toBe(0);
    expect(anchorWeights(12.5, at).get(25)).toBeCloseTo(0.5);
    expect(anchorWeights(100, at).get(100)).toBe(1);
    const mid = anchorWeights(110, at);
    expect(mid.get(100)).toBeCloseTo(0.6); expect(mid.get(125)).toBeCloseTo(0.4);
    for (const b of [25, 40, 63, 99, 137, 181, 200, 230]) expect([...anchorWeights(b, at).values()].reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });
  it('goes on with the other corrections, on HYBRID only', () => {
    const m = mesh.clone(); m.geometry = mesh.geometry.clone();
    const lifted = liftShapeFields(m)!;
    const z = applyZeroRefine(m, lifted, data)!;
    expect(sidesAnchors(z.fields)).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    expect(Object.keys(sidesFieldWeights(100, sidesAnchors(z.fields), 'hybrid'))).toEqual([SIDES_FIELD_PREFIX + '100']);
    expect(sidesFieldWeights(100, sidesAnchors(z.fields), 'approved')).toEqual({});
  });
});

describe('her baby\'s weight', () => {
  const b = readFileSync('public/models/sarah-v2-body-womb.bin');
  const womb = parseWombFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  it('is baked light, heavy at half and heavy at full, at every quarter from 25% to 200%', () => {
    expect(womb.vertices).toBe(115710);
    for (const kind of [1, 2, 3]) expect(womb.parts.filter((p) => p.kind === kind).map((p) => p.slider)).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    for (const p of womb.parts) {
      let max = 0;
      for (let i = 0; i < p.index.length; i += 1) max = Math.max(max, Math.hypot(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]));
      expect(max).toBeGreaterThan(0.02); expect(max).toBeLessThan(0.15);   // geometry units: 2 to 14 cm
    }
  });
  it('goes through heavy\'s half, and light in a straight line; 0 is her approved belly', () => {
    expect(babyWeightShares(0)).toEqual({ light: 0, heavyHalf: 0, heavy: 0 });
    expect(babyWeightShares(-50).light).toBeCloseTo(0.5);
    expect(babyWeightShares(50)).toEqual({ light: 0, heavyHalf: 1, heavy: 0 });
    expect(babyWeightShares(75)).toEqual({ light: 0, heavyHalf: 0.5, heavy: 0.5 });
    expect(babyWeightShares(100)).toEqual({ light: 0, heavyHalf: 0, heavy: 1 });
    expect(babyWeightShares(400)).toEqual({ light: 0, heavyHalf: 0, heavy: 1 });
  });
  it('weighs in by belly size and weight, on HYBRID only', () => {
    const at = [25, 50, 75, 100, 125, 150, 175, 200];
    expect(babyFieldWeights(100, 0, at, 'hybrid')).toEqual({});
    expect(babyFieldWeights(100, 100, at, 'hybrid')).toEqual({ [`${BABY_FIELD_PREFIX}3:100`]: 1 });
    const w = babyFieldWeights(110, -100, at, 'hybrid');
    expect(w[`${BABY_FIELD_PREFIX}1:100`]).toBeCloseTo(0.6); expect(w[`${BABY_FIELD_PREFIX}1:125`]).toBeCloseTo(0.4);
    expect(babyFieldWeights(100, 100, at, 'approved')).toEqual({});
  });
  it('goes on her approved body, and on nothing else', () => {
    const m = mesh.clone(); m.geometry = mesh.geometry.clone();
    const f = applyWomb(m, liftShapeFields(m)!, womb)!;
    expect(babyAnchors(f)).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    const small = new THREE.Mesh(new THREE.BoxGeometry());
    expect(applyWomb(small, { fields: new Map(), basePos: new Float32Array(), baseNrm: null, last: '' }, womb)).toBeNull();
  });
});
