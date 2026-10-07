/**
 * SARAH'S BUMP STAYS ROUND WHEN SHE SITS — pinned on the shipped model.
 *
 * Joshua, 2026-10-07, reviewing PR #10: the 32-week belly must not collapse,
 * flatten, stretch toward the thighs, move with the leg bones or change size
 * between poses, and the fix must be the WEIGHTS, not a pose or a camera.
 *
 * Meshy's master skinned a quarter to a third of the lower bump to the thigh
 * bones, so seating her swung it 9.8 cm into her lap. `protectBumpWeights.mjs`
 * moves that share onto the pelvis at bake time. These tests read the BAKED
 * `public/models/sarah.glb`, skin it on the CPU through the game's own seated
 * poses, and fail if the thighs get their hold on the bump back — whether by
 * a re-bake without the step, a new master, or a "skirt" fix that drags the
 * front of the torso with the legs (the old `prepareSeatedSarah`/`smoothSkirt`
 * correction was written for the scan Sarah and did exactly that).
 */
import { describe, expect, it } from 'vitest';
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { measureHuman } from '../src/actor/humanSkeleton';
import { poseSeated, type SeatedPose } from '../src/actor/humanSeated';
import type { BindJoint } from '../src/actor/humanRig';

type Q = [number, number, number, number];
const qAxis = (x: number, y: number, z: number, a: number): Q => {
  const s = Math.sin(a / 2);
  return [x * s, y * s, z * s, Math.cos(a / 2)];
};
const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const rot = (q: Q, v: readonly number[]): number[] => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

async function load() {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read('public/models/sarah.glb');
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const index = new Map<Node, number>(joints.map((j, i) => [j, i]));
  const m = skin.getInverseBindMatrices()!.getArray()!;
  const bind: BindJoint[] = joints.map((j, i) => {
    const o = i * 16;
    const t = [m[o + 12], m[o + 13], m[o + 14]];
    const s2 = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
    const parent = j.getParentNode();
    return {
      name: j.getName(),
      parent: parent && index.has(parent) ? index.get(parent)! : -1,
      x: -(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]) / s2,
      y: -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]) / s2,
      z: -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2]) / s2,
    };
  });
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  return { bind, measure: measureHuman(bind), prim };
}

/** The front of the torso between the hips and the chest, ahead of the hip line: the bump. */
function bumpVertices(bind: BindJoint[], measure: ReturnType<typeof measureHuman>, prim: Awaited<ReturnType<typeof load>>['prim']) {
  const P = prim.getAttribute('POSITION')!;
  const j = measure.joints;
  const hipY = (bind[j.hipL].y + bind[j.hipR].y) / 2;
  const hipZ = (bind[j.hipL].z + bind[j.hipR].z) / 2;
  const chestY = bind[j.chest].y;
  const v = [0, 0, 0];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < P.getCount(); i += 1) { P.getElement(i, v); lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  const metres = 1.7 / (hi - lo);
  const out: Array<{ i: number; band: number }> = [];
  for (let i = 0; i < P.getCount(); i += 1) {
    P.getElement(i, v);
    if (v[1] < hipY || v[1] > chestY) continue;
    if ((v[2] - hipZ) * metres < 0.08) continue;
    if (Math.abs(v[0]) * metres > 0.18) continue;
    // Band 0 is the groin crease, which folds with the thigh in a real lap.
    out.push({ i, band: Math.min(9, Math.floor(((v[1] - hipY) / (chestY - hipY)) * 10)) });
  }
  return { out, metres, hipL: j.hipL, hipR: j.hipR };
}

describe("Sarah's bump (public/models/sarah.glb)", () => {
  it('is not skinned to the thighs above the groin crease', async () => {
    const { bind, measure, prim } = await load();
    const { out } = bumpVertices(bind, measure, prim);
    const J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
    const legs = new Set([measure.joints.hipL, measure.joints.hipR, measure.joints.kneeL, measure.joints.kneeR]);
    const a = [0, 0, 0, 0], w = [0, 0, 0, 0];
    let leg = 0, total = 0;
    for (const { i, band } of out) {
      if (band < 2) continue;
      J.getElement(i, a); W.getElement(i, w);
      for (let k = 0; k < 4; k += 1) { total += w[k]; if (legs.has(a[k])) leg += w[k]; }
    }
    expect(out.length).toBeGreaterThan(1000);
    // The master had 25-37% here.
    expect(leg / total).toBeLessThan(0.02);
  }, 60000);

  for (const pose of [
    { style: 'sit', seconds: 0 },
    { style: 'sit', seconds: 0, posture: 'pregnant' },
  ] as SeatedPose[]) {
    it(`keeps its shape seated (${pose.posture ?? 'plain'} sit)`, async () => {
      const { bind, measure, prim } = await load();
      const turns = poseSeated(measure, bind, pose, []);
      const own: Q[] = bind.map(() => [0, 0, 0, 1]);
      for (const t of turns) own[t.joint] = qAxis(t.ax, t.ay, t.az, t.radians);
      const acc: Q[] = [], pos: number[][] = [];
      const visit = (i: number): void => {
        if (acc[i]) return;
        const p = bind[i].parent;
        if (p < 0) { acc[i] = own[i]; pos[i] = [bind[i].x, bind[i].y, bind[i].z]; return; }
        visit(p);
        acc[i] = qMul(acc[p], own[i]);
        const o = rot(acc[p], [bind[i].x - bind[p].x, bind[i].y - bind[p].y, bind[i].z - bind[p].z]);
        pos[i] = [pos[p][0] + o[0], pos[p][1] + o[1], pos[p][2] + o[2]];
      };
      bind.forEach((_, i) => visit(i));
      // The torso's own rotation (spine lean) is allowed to carry the bump;
      // what is measured is how far each vertex moves RELATIVE to the pelvis.
      const pelvis = bind[measure.joints.hipL].parent;
      const { out, metres } = bumpVertices(bind, measure, prim);
      const P = prim.getAttribute('POSITION')!, J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
      const v = [0, 0, 0], a = [0, 0, 0, 0], w = [0, 0, 0, 0];
      const pelvisOnly = (p: number[]) => {
        const q = bind[pelvis];
        const o = rot(acc[pelvis], [p[0] - q.x, p[1] - q.y, p[2] - q.z]);
        return [pos[pelvis][0] + o[0], pos[pelvis][1] + o[1], pos[pelvis][2] + o[2]];
      };
      let moved = 0, n = 0, worst = 0;
      for (const { i, band } of out) {
        if (band < 2 || band > 5) continue; // the lower bump, below where the spine lean takes over
        P.getElement(i, v); J.getElement(i, a); W.getElement(i, w);
        const s = [0, 0, 0];
        for (let k = 0; k < 4; k += 1) {
          if (!(w[k] > 0)) continue;
          const q = bind[a[k]];
          const o = rot(acc[a[k]], [v[0] - q.x, v[1] - q.y, v[2] - q.z]);
          s[0] += w[k] * (pos[a[k]][0] + o[0]); s[1] += w[k] * (pos[a[k]][1] + o[1]); s[2] += w[k] * (pos[a[k]][2] + o[2]);
        }
        const r = pelvisOnly(v);
        const d = Math.hypot(s[0] - r[0], s[1] - r[1], s[2] - r[2]) * metres;
        moved += d; n += 1; worst = Math.max(worst, d);
      }
      // Before the fix: mean 7-10 cm across these bands.
      expect(moved / n).toBeLessThan(0.015);
      expect(worst).toBeLessThan(0.05);
    }, 60000);
  }
});
