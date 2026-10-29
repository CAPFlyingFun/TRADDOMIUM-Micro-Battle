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
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyShapeFields, liftShapeFields } from '../src/view/bodyShapeView';
import { navelHeight, smallestAxis } from '../src/sarahlab/navelPiece';
import { applyZeroRefine, fitsZeroRefine, parseZeroRefine, UPPER_FIELD_PREFIX, ZERO_FIELD, zeroRefineWeight, type ZeroRefine } from '../src/sarahlab/zeroRefine';
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
