/**
 * The fitted light tee's own navel, against the files (Joshua, 2026-10-24: the regular tee "still ignores the two detail
 * sliders"). `detailSpots.ts` names points of the tee (`SARAH_V2_LITE_TEE_NAVEL`) and fits its smooth surface round her
 * navel through them each frame; NAVEL DETAIL settles the tee's own navel onto that surface (`clothDetail.ts`). Here,
 * at the tee's own 100% reference (other sizes add the room's fitting shapes, written onto the tee on the CPU, so they
 * are measured in the room: `?probe=cloth`'s `fitted()`): the points are the tee's outer layer where they should be,
 * the tee's navel reads as modelled (a dome over her outie), and the settled tee stays off her with her own navel
 * settled under it -- the settle never lets her skin through. And the settle stands down when the tee is not over her
 * navel (it rides up off a 200% belly).
 */
import { NodeIO, type Mesh, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { DetailSpots, SARAH_V2_DETAIL_POINTS, SARAH_V2_LITE_TEE_NAVEL, SETTLE_LOOK, TeeNavel, type Poser } from '../src/sarahlab/detailSpots';
import { clothDetailAt } from '../src/sarahlab/clothDetail';
import { navelFlatWeight } from '../src/sarahlab/sarahLabTool';

const floats = (a: { getArray(): unknown; getNormalized(): boolean }): Float64Array => {
  const raw = a.getArray() as ArrayLike<number>;
  if (!a.getNormalized()) return Float64Array.from(raw);
  const s = raw instanceof Int16Array ? 32767 : raw instanceof Int8Array ? 127 : raw instanceof Uint16Array ? 65535 : 255;
  return Float64Array.from(raw, (x) => Math.max(-1, x / s));
};
const targets = (mesh: Mesh, prim: Primitive) => new Map((mesh.getExtras() as { targetNames: string[] }).targetNames.map((n, k) => [n, floats(prim.listTargets()[k].getAttribute('POSITION')!)]));
const compose = (base: Float64Array, offsets: Map<string, Float64Array>, weights: Record<string, number>) => {
  const out = Float64Array.from(base);
  for (const [name, w] of Object.entries(weights)) { const d = offsets.get(name); if (d && w) for (let i = 0; i < out.length; i++) out[i] += w * d[i]; }
  return out;
};

let bodyBase: Float64Array, bodyOffsets: Map<string, Float64Array>, teeBase: Float64Array, teeNormal: Float64Array, teeOffsets: Map<string, Float64Array>;
let byBump: Record<string, Record<string, number>>, T: number[];
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const body = await io.read('public/models/sarah-v2-body-slim.glb'), tee = await io.read('public/models/sarah-v2-spandex-lite.glb');
  const bm = body.getRoot().listMeshes()[0], bp = bm.listPrimitives()[0], tm = tee.getRoot().listMeshes()[0], tp = tm.listPrimitives()[0];
  bodyBase = floats(bp.getAttribute('POSITION')!); bodyOffsets = targets(bm, bp);
  teeBase = floats(tp.getAttribute('POSITION')!); teeNormal = floats(tp.getAttribute('NORMAL')!); teeOffsets = targets(tm, tp);
  byBump = (tm.getExtras() as { recoveredShirt: { baselineWeightsByBump: Record<string, Record<string, number>> } }).recoveredShirt.baselineWeightsByBump;
  // her rest world: the skin's root joint times its inverse bind matrix, local units to metres
  const skin = body.getRoot().listSkins()[0], a = skin.listJoints()[0].getWorldMatrix(), b = Array.from(skin.getInverseBindMatrices()!.getArray()!.slice(0, 16));
  T = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) T[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
}, 60000);

/** A body or the tee at rest as a Poser, in the room's world units (100 to the metre). */
const poser = (P: Float64Array): Poser => ({
  posedVertex(v, out, o = 0) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    out[o] = 100 * (T[0] * x + T[4] * y + T[8] * z + T[12]);
    out[o + 1] = 100 * (T[1] * x + T[5] * y + T[9] * z + T[13]);
    out[o + 2] = 100 * (T[2] * x + T[6] * y + T[10] * z + T[14]);
  },
});
const at = (p: Poser, v: number): [number, number, number] => { const o: [number, number, number] = [0, 0, 0]; p.posedVertex(v, o); return o; };
/**
 * Her body and the tee at a belly size as the room wears them (`applyRecoveredBaseline`): her body is her file plus the
 * size's weights; the tee's file IS its 100% reference, so it takes the size's weights less the reference's. Her navel
 * settled as NAVEL DETAIL 0 settles it; the tee's own navel never is by its shapes (the room settles it in the shader).
 */
function worn(bump: number, navelSettled = 0) {
  const own = Math.max(navelFlatWeight(bump), byBump[bump].navelFlat ?? 0);
  const w = { ...byBump[bump], navelFlat: Math.max(own, navelSettled) };
  const teeW: Record<string, number> = {};
  for (const name of new Set([...Object.keys(byBump[bump]), ...Object.keys(byBump[100]), 'navelFlat'])) teeW[name] = (name === 'navelFlat' ? own : byBump[bump][name] ?? 0) - (byBump[100][name] ?? 0);
  const tee = compose(teeBase, teeOffsets, teeW);
  const spots = new DetailSpots(SARAH_V2_DETAIL_POINTS), navel = new TeeNavel(SARAH_V2_LITE_TEE_NAVEL);
  const body = compose(bodyBase, bodyOffsets, w), bodyPose = poser(body), teePose = poser(tee);
  spots.measure(bodyPose);
  const fitted = navel.measure(teePose, spots.navel);
  return { body, bodyPose, teePose, spots, navel, fitted };
}
describe('the fitted light tee\'s own navel', () => {
  it('is named by points of the tee\'s outer layer: on her navel\'s axis, and 30 to 50 mm round it', () => {
    expect(Object.keys(byBump)).toContain('100');
    const { teePose, spots } = worn(100), n = spots.navel.n, base = spots.navel.base;
    const off = (p: [number, number, number]) => { const d = [p[0] - base[0], p[1] - base[1], p[2] - base[2]], along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; return Math.hypot(d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]); };
    const facing = (v: number) => teeNormal[v * 3] * n[0] + teeNormal[v * 3 + 1] * n[1] + teeNormal[v * 3 + 2] * n[2];
    const all = [...SARAH_V2_LITE_TEE_NAVEL.centre, ...SARAH_V2_LITE_TEE_NAVEL.fit];
    expect(new Set(all).size).toBe(all.length);
    for (const v of all) { expect(v).toBeLessThan(teeBase.length / 3); expect(facing(v), `point ${v} faces her`).toBeGreaterThan(0.5); }
    // found within 2.5 mm and 30-50 mm (0.9 m a local unit leaves slack)
    for (const v of SARAH_V2_LITE_TEE_NAVEL.centre) expect(off(at(teePose, v))).toBeLessThan(0.3);
    expect(SARAH_V2_LITE_TEE_NAVEL.centre.length).toBeGreaterThanOrEqual(4);
    for (const v of SARAH_V2_LITE_TEE_NAVEL.fit) { const r = off(at(teePose, v)); expect(r).toBeGreaterThan(2.9); expect(r).toBeLessThan(5.1); }
    expect(SARAH_V2_LITE_TEE_NAVEL.fit.length).toBeGreaterThanOrEqual(24);
  });

  it('reads the tee\'s navel as it is modelled: a dome over her outie, a little under her own height', () => {
    const { fitted, navel, spots } = worn(100);
    expect(fitted).toBe(true);
    expect(navel.relief * 10).toBeGreaterThan(6); // mm: about 8.5 over her 10.3
    expect(navel.relief).toBeLessThan(spots.navel.h);
  });

  it('settled, keeps off her with her own navel settled under it (NAVEL DETAIL 0 never lets her through)', () => {
    const { body, bodyPose, navel } = worn(100, 1), s = navel.settle(1)!;
    expect(s.amount).toBe(1);
    const n = s.normal, c = s.center, q = s.curvature;
    let nearest = Infinity, seen = 0;
    for (let v = 0; v < body.length / 3; v++) {
      const p = at(bodyPose, v), d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      const t = [d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]];
      if (Math.hypot(t[0], t[1], t[2]) > s.outer || Math.abs(along) > 3) continue;
      const qt = [0, 1, 2].map((i) => q[i * 3] * t[0] + q[i * 3 + 1] * t[1] + q[i * 3 + 2] * t[2]);
      const surface = s.height + s.slope[0] * t[0] + s.slope[1] * t[1] + s.slope[2] * t[2] - (t[0] * qt[0] + t[1] * qt[1] + t[2] * qt[2]);
      nearest = Math.min(nearest, surface - along); seen++;
    }
    expect(seen).toBeGreaterThan(100);
    // the outer layer settles onto the surface, the inner one its thickness inside it: both stay off her
    expect(nearest - SETTLE_LOOK.thickness).toBeGreaterThan(0);
  });

  it('settles the tee\'s own navel flat at NAVEL DETAIL 0 and leaves it as modelled at 100%', () => {
    const { teePose, spots, navel } = worn(100);
    const keep = (navelKeep: number) => spots.fitted({ nipple: 1, navel: navelKeep }, navel);
    const centre = SARAH_V2_LITE_TEE_NAVEL.centre.map((v) => at(teePose, v)), n = spots.navel.n;
    const height = (state: ReturnType<typeof keep>) => centre.reduce((sum, p) => { const d = clothDetailAt(p, state, n).displacement; return sum + d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; }, 0) / centre.length;
    expect(height(keep(0))).toBeCloseTo(-navel.relief, 1); // the whole of its navel taken back
    expect(height(keep(1))).toBeCloseTo(0, 6); // none of it
    expect(keep(0.5).navel).toBeNull(); // no navel shaded onto it: its own is the navel
    expect(keep(0.5).nipples).toHaveLength(2); // hers drawn through it
  });
});

describe('the fitted tee\'s settle stands down when the tee is not over her navel', () => {
  // a flat skin facing +z, her navel's axis at the origin; the tee a sheet 3 mm off it with a 6 mm dome round the axis
  const axis = { c: [0, 0, 0.6] as [number, number, number], n: [0, 0, 1] as [number, number, number], base: [0, 0, 0] as [number, number, number], rho: 2.3, curve: 0, reach2: 16, h: 0.6 };
  const sheet = (shift: number): Poser => ({ posedVertex(v, out, o = 0) {
    // vertex v: the centre points first (on the axis), then the fit points round it at 3.5-4.5 cm
    const fit = v >= 100, k = fit ? v - 100 : v, a = (k / 16) * 2 * Math.PI, r = fit ? 3.5 + (k % 2) : 0.05 * k;
    const x = r * Math.cos(a) + shift, y = r * Math.sin(a), rr = Math.hypot(x, y);
    out[o] = x; out[o + 1] = y; out[o + 2] = 0.3 + 0.6 * Math.exp(-(rr * rr) / 1);
  } });
  const points = { centre: [0, 1, 2, 3], fit: Array.from({ length: 16 }, (_, i) => 100 + i) };
  it('reads a dome on the axis, and settles it', () => {
    const navel = new TeeNavel(points);
    expect(navel.measure(sheet(0), axis)).toBe(true);
    expect(navel.relief).toBeGreaterThan(0.5);
    expect(navel.settle(1)).not.toBeNull();
  });
  it('stands down, settling nothing, with the tee\'s navel 3 cm off hers', () => {
    const navel = new TeeNavel(points);
    expect(navel.measure(sheet(3), axis)).toBe(false);
    expect(navel.settle(1)).toBeNull();
    expect(navel.relief).toBe(0);
  });
});
