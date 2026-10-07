/**
 * SARAH'S FINGERS ARE RIGGED — pinned on the shipped model.
 *
 * Meshy rigged her hands as mittens (Joshua, 2026-10-07: "still not doing each
 * finger although it looks exactly the same like Jack"). `scripts/rigFingers.mjs`
 * gives each hand five four-jointed fingers at bake time, measured from her own
 * fingers. This reads the BAKED `public/models/sarah.glb` and fails if a re-bake
 * loses them, misplaces them, or lets them reach outside the hand.
 */
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

async function load() {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read('public/models/sarah.glb');
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const m = skin.getInverseBindMatrices()!.getArray()!;
  const at = joints.map((_, i) => {
    const o = i * 16, t = [m[o + 12], m[o + 13], m[o + 14]];
    const s2 = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
    return [
      -(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]) / s2,
      -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]) / s2,
      -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2]) / s2,
    ];
  });
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  return { joints, at, prim };
}

describe("Sarah's fingers (public/models/sarah.glb)", () => {
  it('has five four-jointed fingers on each hand, each a chain off the hand bone', async () => {
    const { joints, at } = await load();
    const byName = new Map(joints.map((j, i) => [j.getName(), i]));
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1; // she faces +z: her left hand is on +x
      const roots = new Set<number>();
      for (const f of FINGERS) {
        const chain = [1, 2, 3, 4].map((k) => byName.get(`${f}${k}_${side}`));
        for (const i of chain) expect(i, `${f}_${side}`).toBeTypeOf('number');
        const ids = chain as number[];
        for (let k = 1; k < 4; k += 1) expect(joints[ids[k]].getParentNode()).toBe(joints[ids[k - 1]]);
        roots.add(joints.indexOf(joints[ids[0]].getParentNode()!));
        // out past the wrist, on her own side, and running away from the body
        for (const i of ids) expect(sign * at[i][0]).toBeGreaterThan(0.6);
        expect(sign * at[ids[3]][0]).toBeGreaterThan(sign * at[ids[0]][0]);
        // knuckle to tip, in the baked file's bind units (quantization rescales them a little)
        let len = 0;
        for (let k = 1; k < 4; k += 1) len += Math.hypot(...[0, 1, 2].map((a) => at[ids[k]][a] - at[ids[k - 1]][a]));
        expect(len, `${f}_${side} length`).toBeGreaterThan(0.05);
        expect(len, `${f}_${side} length`).toBeLessThan(0.14);
      }
      expect(roots.size, 'all five fingers hang off one hand bone').toBe(1);
    }
    // appended: the master's own 29 joints keep their places
    expect(joints.length).toBe(69);
    for (let i = 0; i < 29; i += 1) expect(joints[i].getName()).toMatch(/^Bone_\d{3}$/);
  }, 60000);

  it('every finger bone moves its finger, and nothing outside the hands', async () => {
    const { joints, prim } = await load();
    const P = prim.getAttribute('POSITION')!, J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
    const finger = new Map<number, string>();
    joints.forEach((j, i) => { if (/^(thumb|index|middle|ring|pinky)[123]_/.test(j.getName())) finger.set(i, j.getName()); });
    const carried = new Map<string, number>();
    const v = [0, 0, 0], a = [0, 0, 0, 0], w = [0, 0, 0, 0];
    let stray = 0;
    for (let i = 0; i < P.getCount(); i += 1) {
      J.getElement(i, a); W.getElement(i, w);
      for (let k = 0; k < 4; k += 1) {
        const name = finger.get(a[k]);
        if (!name || !(w[k] > 0.05)) continue;
        carried.set(name, (carried.get(name) ?? 0) + 1);
        P.getElement(i, v);
        if (Math.abs(v[0]) < 0.55) stray += 1;
      }
    }
    for (const name of finger.values()) expect(carried.get(name) ?? 0, name).toBeGreaterThan(40);
    expect(stray).toBe(0);
  }, 60000);
});
