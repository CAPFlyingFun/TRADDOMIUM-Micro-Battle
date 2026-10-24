/**
 * THE LIGHT SPANDEX TEE (Joshua, 2026-10-23: "use that shirt ChatGPT used, but then basically compress it/make it a lot
 * less vertices and try and optimize it for speed, size, and quality"). `scripts/sarahV2Recovery/shirt-lite.mjs` writes
 * it from the archived modelled tee; this holds what it promises: a small file, every shape the room drives by the same
 * name, the fits' own record, how far it strays from the original, and a bust that the breast sliders cannot push into
 * her (`shirt-bust.mjs`), tried here on a toy.
 */
import { readFileSync, statSync } from 'node:fs';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { layBust, skinSurface, weld, neighbours } from '../scripts/sarahV2Recovery/shirt-bust.mjs';

const LITE = 'public/models/sarah-v2-spandex-lite.glb', SOURCE = 'assets-archive/models/sarah-v2-spandex-high.gltf';
let lite: Document;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  lite = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(LITE);
}, 60000);

describe('the light spandex tee', () => {
  const source = JSON.parse(readFileSync(SOURCE, 'utf8')).meshes[0].extras as { targetNames: string[]; recoveredShirt: Record<string, unknown> };

  it('is one small file, a fraction of the tee it was made from', () => {
    expect(statSync(LITE).size).toBeLessThan(5 * 1024 * 1024);
    const prim = lite.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(prim.getAttribute('POSITION')!.getCount()).toBeLessThan(25000);
    expect(prim.getIndices()!.getCount() / 3).toBeLessThanOrEqual(32000);
    // the binding to her skin was for building it, and stays behind
    expect(prim.getAttribute('_BODY_TRI')).toBeNull();
    for (const s of ['NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) expect(prim.getAttribute(s), s).not.toBeNull();
    expect(lite.getRoot().listSkins()).toHaveLength(1);
  });

  it('carries every shape the room drives, by the same name, and the fits\' own record', () => {
    const extras = lite.getRoot().listMeshes()[0].getExtras() as { targetNames: string[]; recoveredShirt: Record<string, unknown> & { lite: { errorMm: Record<string, { max: number }> } } };
    expect(extras.targetNames).toEqual(source.targetNames);
    expect(lite.getRoot().listMeshes()[0].listPrimitives()[0].listTargets()).toHaveLength(source.targetNames.length);
    for (const key of ['baselineMode', 'baselineWeightsByBump', 'fitBumps', 'fineFitKeys', 'nativeTargetNames']) expect(extras.recoveredShirt[key], key).toEqual(source.recoveredShirt[key]);
    // within 1.5 mm of the original surface at 0%, 100% and 200%
    for (const b of ['0', '100', '200']) expect(extras.recoveredShirt.lite.errorMm[b].max, `${b}%`).toBeLessThanOrEqual(1.5);
  });
});

describe('laying a bust again (shirt-bust.mjs)', () => {
  /** A square grid of points in x, y over [-1, 1], lifted by `z`, as triangles. */
  function grid(n: number, z: (x: number, y: number) => number) {
    const P = new Float64Array(n * n * 3), index: number[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = -1 + 2 * j / (n - 1), y = -1 + 2 * i / (n - 1), v = i * n + j; P.set([x, y, z(x, y)], v * 3); }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j; index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
    return { P, index: Uint32Array.from(index) };
  }
  const bump = (x: number, y: number, cx: number, r: number, h: number) => h * Math.exp(-((x - cx) ** 2 + y * y) / (r * r));
  // her skin: two breasts with a hollow between; growing, they grow wider and taller, into the hollow
  const skinZ = (x: number, y: number) => bump(x, y, -0.35, 0.22, 0.25) + bump(x, y, 0.35, 0.22, 0.25);
  const growZ = (x: number, y: number) => bump(x, y, -0.3, 0.3, 0.15) + bump(x, y, 0.3, 0.3, 0.15);
  const skin = grid(61, skinZ);
  const skinGrow = new Float32Array(skin.P.length);
  for (let v = 0; v < skinGrow.length / 3; v++) skinGrow[v * 3 + 2] = growZ(skin.P[v * 3], skin.P[v * 3 + 1]);
  // the cloth: a sheet over her, bridging the hollow (it rests on the breasts, not in between them) ...
  const restZ = (x: number, y: number) => Math.max(skinZ(x, y), Math.abs(x) < 0.35 ? skinZ(0.35, y) * 0.8 : 0) + 0.01;
  const cloth = grid(41, restZ);
  // ... whose stored shape follows the skin under each point, as a shirt bound to her skin does: into the hollow
  const stored = new Float32Array(cloth.P.length);
  for (let v = 0; v < stored.length / 3; v++) stored[v * 3 + 2] = growZ(cloth.P[v * 3], cloth.P[v * 3 + 1]) * (Math.abs(cloth.P[v * 3]) < 0.3 ? 0.2 : 1);

  it('keeps the cloth off the grown skin where the stored shape lets it in', () => {
    const laid = layBust({ P: cloth.P, index: cloth.index, offsets: new Map([['grow', stored]]) },
      { P: skin.P, index: skin.index, offsets: new Map([['grow', skinGrow]]), keep: () => true }, [{ name: 'grow', weight: 1, context: new Map() }], { maximumStandOff: 0.5 });
    const r = laid.get('grow')!;
    expect(r.report.intoBefore.n).toBeGreaterThan(20);
    expect(r.report.intoAfter.most).toBeLessThan(0.002);
    // and moves nothing it should not: a point nowhere near the shape stays where it is
    const grown = Float64Array.from(skin.P, (x, i) => x + skinGrow[i]), surface = skinSurface(grown, skin.index);
    let worst = 0;
    for (let v = 0; v < cloth.P.length / 3; v++) {
      const s = surface(cloth.P[v * 3] + r.offsets[v * 3], cloth.P[v * 3 + 1] + r.offsets[v * 3 + 1], cloth.P[v * 3 + 2] + r.offsets[v * 3 + 2]);
      if (s && s.distance < 0.2) worst = Math.min(worst, s.off);
    }
    expect(worst).toBeGreaterThan(-0.002);
  });

  it('smooths a crease out of the stored shape, and moves cloth split at a seam as one', () => {
    // a crease: one row of the stored shape pulled in, as a shirt bound into her underbust fold is
    const creased = Float32Array.from(stored);
    for (let v = 0; v < creased.length / 3; v++) if (Math.abs(cloth.P[v * 3 + 1] + 0.2) < 0.03) creased[v * 3 + 2] -= 0.05;
    const laid = layBust({ P: cloth.P, index: cloth.index, offsets: new Map([['grow', creased]]) },
      { P: skin.P, index: skin.index, offsets: new Map([['grow', skinGrow]]), keep: () => true }, [{ name: 'grow', weight: 1, context: new Map() }], { maximumStandOff: 0.5 }).get('grow')!;
    const { ids, count } = weld(cloth.P), { start, list } = neighbours(cloth.index, ids, count);
    const roughness = (d: ArrayLike<number>) => { let sum = 0; for (let i = 0; i < count; i++) { let m = 0; for (let k = start[i]; k < start[i + 1]; k++) m += d[list[k] * 3 + 2]; sum += Math.abs(d[i * 3 + 2] - m / (start[i + 1] - start[i])); } return sum / count; };
    expect(roughness(laid.offsets)).toBeLessThan(roughness(creased) / 3);
    // a seam: two points at one place get one offset
    const P2 = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0]), index2 = Uint32Array.from([0, 1, 2, 3, 4, 2]);
    const off = new Float32Array([0, 0, 0.01, 0, 0, 0.02, 0, 0, 0.01, 0, 0, 0.04, 0, 0, 0.01]);
    const flat = { P: new Float64Array([-5, -5, -1, 5, -5, -1, -5, 5, -1]), index: Uint32Array.from([0, 1, 2]), offsets: new Map([['s', new Float32Array(9)]]), keep: () => true };
    const seam = layBust({ P: P2, index: index2, offsets: new Map([['s', off]]) }, flat, [{ name: 's', weight: 1, context: new Map() }], { smooth: 3 }).get('s')!.offsets;
    expect(seam[1 * 3 + 2]).toBeCloseTo(seam[3 * 3 + 2], 6);
  });
});
