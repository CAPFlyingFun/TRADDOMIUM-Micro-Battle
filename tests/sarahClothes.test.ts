import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
// Bake modules are JavaScript, also used by the command-line rebuild.
// @ts-ignore
import { recoverSarahBody } from '../scripts/rebakeSarah.mjs';
// @ts-ignore
import { growClothes, GARMENTS } from '../scripts/growClothes.mjs';

async function load() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read('public/models/sarah-base.glb');
}

describe('Sarah clothing rebuild', () => {
  it('recovers metre measurements without moving skin or changing repaired weights', async () => {
    const doc = await load(), skin = doc.getRoot().listSkins()[0];
    const body = doc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0')!;
    const oldP = body.getAttribute('POSITION')!, oldW = body.getAttribute('WEIGHTS_0')!, oldJ = body.getAttribute('JOINTS_0')!;
    const v: number[] = [], w: number[] = [], j: number[] = [], ibm: number[] = [];
    const sample = Array.from({ length: 40 }, (_, i) => Math.floor(i * oldP.getCount() / 40));
    const before = sample.map((i) => {
      oldP.getElement(i, v); oldW.getElement(i, w); oldJ.getElement(i, j);
      const p = new Vector3(), q = new Vector3();
      for (let k = 0; k < 4; k += 1) {
        skin.getInverseBindMatrices()!.getElement(j[k], ibm);
        const m = new Matrix4().fromArray(skin.listJoints()[j[k]].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm));
        q.fromArray(v).applyMatrix4(m).multiplyScalar(w[k]); p.add(q);
      }
      return { p, w: [...w], j: [...j] };
    });
    await recoverSarahBody(doc);
    const P = body.getAttribute('POSITION')!, W = body.getAttribute('WEIGHTS_0')!, J = body.getAttribute('JOINTS_0')!;
    sample.forEach((i, at) => {
      P.getElement(i, v); W.getElement(i, w); J.getElement(i, j);
      expect(new Vector3().fromArray(v).distanceTo(before[at].p)).toBeLessThan(0.0002);
      w.forEach((value, k) => expect(value).toBeCloseTo(before[at].w[k], 7));
      expect(j).toEqual(before[at].j);
    });
    expect(body.listTargets()).toHaveLength(0);
    expect(doc.getRoot().listMeshes()[0].listPrimitives()).toHaveLength(1);
  });

  it('the bralette spans the hollow between the cups rather than following skin into it', async () => {
    const doc = await load();
    await recoverSarahBody(doc);
    const plain = cloneDocument(doc);
    const saved = GARMENTS.bikini.bridge;
    try {
      GARMENTS.bikini.bridge = 0;
      await growClothes(plain, { which: ['bikini'], paint: false });
    } finally { GARMENTS.bikini.bridge = saved; }
    await growClothes(doc, { which: ['bikini'], paint: false });
    const garment = (d: typeof doc) => d.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial()?.getName() === 'bikini')!.getAttribute('POSITION')!;
    const P = garment(doc), Q = garment(plain), v: number[] = [], q: number[] = [];
    expect(P.getCount()).toBe(Q.getCount());
    let forward = 0;
    for (let i = 0; i < P.getCount(); i += 1) {
      P.getElement(i, v); Q.getElement(i, q);
      if (Math.abs(v[0]) < 0.04 && v[1] > 1.15) forward = Math.max(forward, v[2] - q[2]);
    }
    expect(forward).toBeGreaterThan(0.002);
  }, 60000);
});
