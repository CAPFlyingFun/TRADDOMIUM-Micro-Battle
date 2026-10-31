/**
 * ROOM BETWEEN HER THIGHS, AS SHE IS POSED (Joshua, 2026-10-30: "try like at 20 degree intervals and find which ones
 * start to look weird or cut through into others and then try and fix the seams and creases between the hips and
 * body"). His sweep of RECLINE's hip bend: fine to 20 degrees; from 40 her inner thighs bulge toward her middle; by 80-92
 * the two pass through each other right over her vulva. Her skin weights blend her inner thighs between pelvis and thigh
 * bones, and a deep bend swings that skin in across her middle.
 *
 * So the fix is worked out on her AS POSED, for whatever the angles are: every point of her inner thighs near her
 * crotch, carried there by a thigh bone, is read where her bones put it, in her PELVIS's frame (where her middle is the
 * plane x = 0); one that has come nearer her middle than `keep` of its standing distance is pushed back out to it. The
 * push is turned back into her rest shape (through the inverse of the point's own bones' turn, then her pelvis's) and
 * smoothed over its neighbours, and laid on her as a shape field (bodyShapeView.ts) for as long as she holds the pose.
 * Standing nothing has moved in, so nothing is pushed. Her body file is untouched.
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

export const BIRTH_ROOM_FIELD = 'shape:birthRoom';

/** GAME TUNING. */
export const BIRTH_ROOM = Object.freeze({
  /** how near her middle a point may come, as a share of its standing distance from it */
  keep: 1,
  /** and, near her crotch, no nearer than this (metres across) -- her inner thighs held back from her vulva, as in his
   * references of women in labour -- all of it within `openNear` of her crotch, none past `openFar`; her vulva itself
   * (standing within `own` of her middle) is not held */
  open: 0.04, openNear: 0.06, openFar: 0.12, own: 0.022,
  /** which points: across from her middle (metres, between), within this of her crotch (metres), and carried at least
   * this much by a thigh bone */
  nearest: 0.003, farthest: 0.16, reach: 0.2, thigh: 0.02,
  /** how many times the push is smoothed over her mesh */
  smoothPasses: 8,
});

export interface BirthRoomField { readonly index: Uint32Array; readonly pos: Float32Array; readonly nrm: Float32Array }

export interface BirthRoom {
  /** the push for her as she is posed now (her bones' world matrices current); `pos` is her shape as drawn (with the
   * last push in it, which is taken back out first) */
  compute(pos: ArrayLike<number>): BirthRoomField;
  /** how many of her points it watches */
  readonly watched: number;
  /** the largest push of the last compute (metres) */
  readonly largest: number;
}

export function createBirthRoom(mesh: THREE.SkinnedMesh, toRest: THREE.Matrix4, indices: ArrayLike<number>, pelvis: number, thighL: number, thighR: number): BirthRoom | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined, pa = g.getAttribute('position');
  if (!si || !sw || !pa) return null;
  const n = pa.count, B = BIRTH_ROOM, rest = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest).toArray(rest, i * 3);
  const c = birthAreaCentre(rest);
  if (!c) return null;
  const m = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180;
  const crotch = new THREE.Vector3(0, c.y - 0.047 * Math.cos(m), c.z + 0.047 * Math.sin(m));
  const lin = new THREE.Matrix3().setFromMatrix4(toRest), toGeom = lin.clone().invert();
  const perMetre = new THREE.Vector3(1, 0, 0).applyMatrix3(toGeom).length(), across = new THREE.Vector3(1, 0, 0).applyMatrix3(toGeom).normalize();
  // the points watched: her inner thighs near her crotch, carried by a thigh bone
  const watched: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], ax = Math.abs(x);
    if (ax < B.nearest || ax > B.farthest) continue;
    if (v.fromArray(rest, i * 3).distanceTo(crotch) > B.reach) continue;
    let t = 0;
    for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k); if (b === thighL || b === thighR) t += sw.getComponent(i, k); }
    if (t >= B.thigh) watched.push(i);
  }
  const W = watched.length, slot = new Int32Array(n).fill(-1);
  watched.forEach((i, k) => { slot[i] = k; });
  // neighbours among them (her triangles; a seam's vertices at one place welded by place)
  const key = new Map<string, number>(), keyOf = new Int32Array(W);
  watched.forEach((i, k) => { const s = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`; let id = key.get(s); if (id === undefined) { id = key.size; key.set(s, id); } keyOf[k] = id; });
  const P = key.size, nb: Set<number>[] = Array.from({ length: P }, () => new Set<number>()), edge = new Uint8Array(P);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = slot[indices[t]], b = slot[indices[t + 1]], cc = slot[indices[t + 2]];
    const ins = [a, b, cc].filter((q) => q >= 0);
    if (ins.length < 3) { for (const q of ins) edge[keyOf[q]] = 1; continue; }
    const [ka, kb, kc] = [keyOf[a], keyOf[b], keyOf[cc]];
    nb[ka].add(kb); nb[ka].add(kc); nb[kb].add(ka); nb[kb].add(kc); nb[kc].add(ka); nb[kc].add(kb);
  }
  const standing = new Float32Array(W), floor = new Float32Array(W);
  const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  watched.forEach((i, k) => {
    const ax = Math.abs(rest[i * 3]);
    standing[k] = ax;
    floor[k] = B.open * sm(B.openFar, B.openNear, v.fromArray(rest, i * 3).distanceTo(crotch)) * sm(B.own, B.own + 0.015, ax);
  });
  const last = new Float32Array(W * 3);
  const S = mesh.skeleton.bones.map(() => new THREE.Matrix4()), tmp = new THREE.Matrix4(), Sv = new THREE.Matrix4(), Spi = new THREE.Matrix4();
  const Lv = new THREE.Matrix3(), Lp = new THREE.Matrix3(), q = new THREE.Vector3(), d = new THREE.Vector3();
  const pushP = new Float32Array(P);
  let largest = 0;
  return {
    watched: W,
    get largest() { return largest; },
    compute(posNow: ArrayLike<number>): BirthRoomField {
      const sk = mesh.skeleton;
      for (let b = 0; b < sk.bones.length; b++) S[b].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b])).multiply(mesh.bindMatrix);
      Spi.copy(S[pelvis]).invert(); Lp.setFromMatrix4(S[pelvis]);
      pushP.fill(0); largest = 0;
      const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
      // the push each needs, in her pelvis's frame (along her across), welded by place
      const pushQ = new Float32Array(W);
      for (let k = 0; k < W; k++) {
        const i = watched[k];
        q.set(posNow[i * 3] - last[k * 3], posNow[i * 3 + 1] - last[k * 3 + 1], posNow[i * 3 + 2] - last[k * 3 + 2]).applyMatrix4(blend(i)).applyMatrix4(Spi);
        const side = Math.sign(rest[i * 3]), now = side * q.dot(across) / perMetre, allowed = Math.max(B.keep * standing[k], floor[k]);
        pushQ[k] = Math.max(0, allowed - now);
        if (pushQ[k] > Math.abs(pushP[keyOf[k]])) pushP[keyOf[k]] = pushQ[k] * side;
      }
      // smoothed over her mesh, held at nothing on the watched area's edge
      const a = new Float32Array(P), bb = new Float32Array(P);
      a.set(pushP);
      for (let pass = 0; pass < B.smoothPasses; pass++) {
        for (let p = 0; p < P; p++) {
          if (edge[p]) { bb[p] = 0; continue; }
          let s = a[p], k = 1;
          for (const o of nb[p]) { s += a[o]; k++; }
          bb[p] = Math.max(Math.abs(a[p]), Math.abs(s / k)) * Math.sign(a[p] || s);
        }
        a.set(bb);
      }
      // into her rest shape: through the inverse of the point's own bones' turn, then her pelvis's
      const idx: number[] = [], out: number[] = [];
      for (let k = 0; k < W; k++) {
        const i = watched[k], amount = a[keyOf[k]];
        if (Math.abs(amount) < 1e-6) { last[k * 3] = last[k * 3 + 1] = last[k * 3 + 2] = 0; continue; }
        largest = Math.max(largest, Math.abs(amount));
        Lv.setFromMatrix4(blend(i)).invert().multiply(Lp);
        d.copy(across).multiplyScalar(amount * perMetre).applyMatrix3(Lv);
        last[k * 3] = d.x; last[k * 3 + 1] = d.y; last[k * 3 + 2] = d.z;
        idx.push(i); out.push(d.x, d.y, d.z);
      }
      return { index: Uint32Array.from(idx), pos: Float32Array.from(out), nrm: new Float32Array(out.length) };
    },
  };
}
