/**
 * HER NAVEL STAYS UNDER THE FITTED SHIRT AT EVERY SIZE (Joshua, 2026-10-20: "bellybutton on one screenshot still poking
 * through"). Between the spandex shirt's own fits (0/50/100/150/200%) her navel came up to 9.5 mm through the cloth;
 * the fine fit (scripts/sarahV2Recovery/shirt-fine-fit.mjs) keeps the cloth over it as one small bump. Every 5% from
 * 100% to 200%, each point of her navel that the shirt covers lies at least 0.2 mm under its outer surface (her skin
 * whose nearest cloth is the hem's own edge is below the hem, not under it).
 */
import { NodeIO, type Accessor, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitWeights, SHIRT_FINE_FIT_KEYS } from '../src/sarahlab/recoveredClothes';
import { bellyMotionWeights, bellyUpperWeight, bellyWeights, breastWeightsFor, navelFlatWeight, navelWeights, restingBellySpring } from '../src/sarahlab/sarahLabTool';
import { SkinCollider } from '../scripts/sarahV2Recovery/bikini/collider.mjs';

const values = (accessor: Accessor): Float32Array => {
  const result = new Float32Array(accessor.getCount() * accessor.getElementSize()), value: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) { accessor.getElement(i, value); result.set(value, i * value.length); }
  return result;
};
/** A document's one mesh, ready to be posed at any morph weights, in world centimetres. */
function poser(doc: Document, primitive: Primitive) {
  const names = doc.getRoot().listMeshes()[0].getExtras().targetNames as string[], base = values(primitive.getAttribute('POSITION')!);
  const targets = primitive.listTargets().map(t => values(t.getAttribute('POSITION')!)), skin = doc.getRoot().listSkins()[0];
  const m = new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(Array.from(skin.getInverseBindMatrices()!.getArray()!.slice(0, 16))));
  return (weights: Record<string, number>) => {
    const out = Float32Array.from(base);
    targets.forEach((d, k) => { const w = weights[names[k]] ?? 0; if (w) for (let i = 0; i < out.length; i++) out[i] += w * d[i]; });
    const v = new Vector3(), world = new Float64Array(out.length);
    for (let i = 0; i < out.length; i += 3) { v.set(out[i], out[i + 1], out[i + 2]).applyMatrix4(m); world[i] = v.x * 100; world[i + 1] = v.y * 100; world[i + 2] = v.z * 100; }
    return world;
  };
}
const bodyWeights = (p: number): Record<string, number> => ({ ...bellyWeights(p), ...breastWeightsFor(p, true), bellyUpper: bellyUpperWeight(p), ...navelWeights(p), navelFlat: navelFlatWeight(p), ...bellyMotionWeights(p, 0, restingBellySpring(), 20) });

const LOOKS = ['spandex-low', 'spandex-high', 'spandex-lite'] as const;
let body: Document, bodyIdx: Uint32Array | Uint16Array, poseBody: ReturnType<typeof poser>;
const shirts = new Map<string, { doc: Document; idx: ArrayLike<number>; pose: ReturnType<typeof poser> }>();
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  body = await io.read('assets-archive/models/sarah-v2-body.glb');
  const skin = body.getRoot().listMeshes()[0].listPrimitives().find(p => p.getMaterial()!.getName() === 'Material_0')!;
  bodyIdx = skin.getIndices()!.getArray()! as Uint32Array; poseBody = poser(body, skin);
  for (const look of LOOKS) {
    // the light tee (Joshua, 2026-10-23) is shipped; the modelled tees it was made from are kept in the archive
    const doc = await io.read(look === 'spandex-lite' ? 'public/models/sarah-v2-spandex-lite.glb' : `assets-archive/models/sarah-v2-${look}.gltf`), prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    shirts.set(look, { doc, idx: prim.getIndices()!.getArray()!, pose: poser(doc, prim) });
  }
}, 120000);

describe('the fitted shirts over her navel', () => {
  for (const look of LOOKS) it(`keeps her navel under the ${look} shirt every 5% from 100% to 200%`, () => {
    const { doc, idx, pose } = shirts.get(look)!, meta = doc.getRoot().listMeshes()[0].getExtras().recoveredShirt as { baselineMode?: string; baselineWeightsByBump: Record<string, Record<string, number>> };
    expect(meta.baselineMode).toBe('reference100');
    const covered: number[] = [];
    for (let b = 100; b <= 200; b += 5) {
      const native = bodyWeights(b), shirtW: Record<string, number> = { ...native };
      for (const [name, w] of Object.entries(meta.baselineWeightsByBump['100'])) shirtW[name] = (shirtW[name] ?? 0) - w;
      Object.assign(shirtW, fitWeights(b, 'shape:fitBelly'), fitWeights(b, 'shape:fineFit', SHIRT_FINE_FIT_KEYS));
      const B = poseBody(native), S = pose(shirtW);
      // her navel: skin points on her belly's front at the navel, and their normals
      const N = new Float64Array(B.length);
      for (let t = 0; t < bodyIdx.length; t += 3) { const [a, c, d] = [bodyIdx[t] * 3, bodyIdx[t + 1] * 3, bodyIdx[t + 2] * 3], u = [B[c] - B[a], B[c + 1] - B[a + 1], B[c + 2] - B[a + 2]], v = [B[d] - B[a], B[d + 1] - B[a + 1], B[d + 2] - B[a + 2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const j of [a, c, d]) { N[j] += n[0]; N[j + 1] += n[1]; N[j + 2] += n[2]; } }
      const navel: number[] = []; let rx = 0, ry = 0, rz = 0;
      for (let i = 0; i < B.length; i += 3) if (Math.abs(B[i]) < 3 && B[i + 1] > 85 && B[i + 1] < 108 && B[i + 2] > 12) { navel.push(i); const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; rx += N[i] / l; ry += N[i + 1] / l; rz += N[i + 2] / l; }
      expect(navel.length, `${look} ${b}%: navel points`).toBeGreaterThan(50);
      const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
      // the shirt's OUTER layer round her navel (the shirt is a closed shell; its inner layer faces her)
      const outer: number[] = [];
      for (let t = 0; t < idx.length; t += 3) {
        const [a, c, d] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3]; if (![a, c, d].some(j => Math.abs(S[j]) < 8 && S[j + 1] > 80 && S[j + 1] < 112 && S[j + 2] > 8)) continue;
        const u = [S[c] - S[a], S[c + 1] - S[a + 1], S[c + 2] - S[a + 2]], v = [S[d] - S[a], S[d + 1] - S[a + 1], S[d + 2] - S[a + 2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
        if ((n[0] * rx + n[1] * ry + n[2] * rz) / l > 0.2) outer.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      // that cloth's own edges (points welded by position, so UV seams are not edges): her skin whose nearest cloth is an
      // edge is beside the cloth -- below its hem -- not under it
      const weld = new Map<string, number>(), wid = (j: number) => { const k = `${Math.round(S[j * 3] * 1e4)},${Math.round(S[j * 3 + 1] * 1e4)},${Math.round(S[j * 3 + 2] * 1e4)}`; let w = weld.get(k); if (w === undefined) weld.set(k, w = weld.size); return w; };
      const W = outer.map(wid), M = 1 << 22, uses = new Map<number, number>(), edge = new Set<number>();
      for (let t = 0; t < W.length; t += 3) for (let e = 0; e < 3; e++) { const a = W[t + e], c = W[t + (e + 1) % 3], k = a < c ? a * M + c : c * M + a; uses.set(k, (uses.get(k) ?? 0) + 1); }
      for (const [k, c] of uses) if (c === 1) { edge.add(Math.floor(k / M)); edge.add(k % M); }
      const cloth = new SkinCollider(S, outer); let count = 0, through = 0, worst = 0;
      for (const i of navel) {
        const p = [B[i], B[i + 1], B[i + 2]], hit = cloth.closest(p); if (!hit || hit.distance > 3) continue;
        const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1, n = [N[i] / l, N[i + 1] / l, N[i + 2] / l], d = [hit.point[0] - p[0], hit.point[1] - p[1], hit.point[2] - p[2]], up = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        if (Math.hypot(d[0] - up * n[0], d[1] - up * n[1], d[2] - up * n[2]) > 0.4) continue; // past the hem: not under the shirt
        { const t = hit.triangle * 3, v = [outer[t], outer[t + 1], outer[t + 2]], A = v.map(j => [S[j * 3], S[j * 3 + 1], S[j * 3 + 2]]);
          const e0 = [0, 1, 2].map(e => A[1][e] - A[0][e]), e1 = [0, 1, 2].map(e => A[2][e] - A[0][e]), r = [0, 1, 2].map(e => hit.point[e] - A[0][e]);
          const d00 = e0[0] * e0[0] + e0[1] * e0[1] + e0[2] * e0[2], d01 = e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2], d11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], d20 = r[0] * e0[0] + r[1] * e0[1] + r[2] * e0[2], d21 = r[0] * e1[0] + r[1] * e1[1] + r[2] * e1[2], den = d00 * d11 - d01 * d01 || 1;
          const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, on = [1 - bv - bw, bv, bw].flatMap((x, e) => x > 1e-5 ? [W[t + e]] : []);
          if (on.length < 3 && on.every(w => edge.has(w))) continue; }
        // how deep under the cloth's outer surface she is (its faces look out from her)
        const depth = -hit.signedDistance;
        count++; if (depth < 0.02) { through++; worst = Math.max(worst, 0.02 - depth); }
      }
      covered.push(count);
      expect(through, `${look} ${b}%: navel points within 0.2 mm of the cloth or through it (worst ${(worst * 10).toFixed(2)} mm short)`).toBe(0);
    }
    // her navel is under the shirt until it reaches the hem
    expect(covered.slice(0, 13).every(c => c > 20), `covered navel points by size: ${covered.join(' ')}`).toBe(true);
  }, 300000);
});
