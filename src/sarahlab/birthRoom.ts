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
  /**
   * THE THIGH ROOTS (Joshua, 2026-10-30: "Reshape thigh roots"): the way her vulva faces (degrees from straight down
   * toward her front, as vulvaMesh.ts's tube), and a clear cone in front of it -- `clear` metres wide at her skin, opening
   * out at `cone` degrees -- that no thigh may stand in; a thigh root standing in it goes back into her thigh, along the
   * way her vulva faces, as far as it must
   */
  tilt: 40, clear: 0.045, cone: 40,
  /** at most this far back (metres), and only this near her crotch (metres: all within `backNear`, none past `backFar`) */
  backMost: 0.03, backNear: 0.07, backFar: 0.12,
  /** her vulva itself, which the cone keeps clear for: within this of its middle (metres) nothing is pushed back */
  ownRound: 0.03,
  /** which points: across from her middle (metres, between), within this of her crotch (metres), and carried at least
   * this much by a thigh bone */
  nearest: 0.0, farthest: 0.3, reach: 0.36, thigh: 0.001,
  /**
   * BENT ROUND THE JOINT, NOT ACROSS IT (Joshua, 2026-10-30: "could use better leg smoothing"): where her skin is shared
   * between her pelvis and a thigh, her skinning blends the two bones' MATRICES, and across a 90-degree bend that blend
   * caves in (the stretched, shiny wedges at her groin). Here those points are put where blending the bones' TURNS would
   * put them (dual quaternions: the skin swings round the joint and keeps its volume), as far as `bend` of the way
   */
  bend: 0,
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
  /** the largest push of the last compute (metres), and of each kind */
  readonly largest: number;
  readonly parts: { side: number; back: number; bend: number };
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
  const standing = new Float32Array(W), floor = new Float32Array(W), near = new Float32Array(W);
  const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  watched.forEach((i, k) => {
    const ax = Math.abs(rest[i * 3]);
    standing[k] = ax;
    floor[k] = B.open * sm(B.openFar, B.openNear, v.fromArray(rest, i * 3).distanceTo(crotch)) * sm(B.own, B.own + 0.015, ax);
    near[k] = sm(B.openFar, B.openNear, v.fromArray(rest, i * 3).distanceTo(crotch));
  });
  const last = new Float32Array(W * 3);
  /** how much of the bend fix each point takes: all of it well inside the watched area, none at its edges */
  const bendShare = new Float32Array(W);
  watched.forEach((i, k) => { v.fromArray(rest, i * 3); bendShare[k] = B.bend * sm(B.reach, B.reach * 0.85, v.distanceTo(crotch)) * sm(B.farthest, B.farthest * 0.85, Math.abs(rest[i * 3])); });
  // her vulva's middle and the way it faces, in her geometry (her pelvis's bind frame)
  const tilt = (B.tilt * Math.PI) / 180, faces = new THREE.Vector3(0, -Math.cos(tilt), Math.sin(tilt)).applyMatrix3(toGeom).normalize();
  const middle = crotch.clone().applyMatrix4(new THREE.Matrix4().copy(toRest).invert());
  const tanCone = Math.tan((B.cone * Math.PI) / 180);
  const notOwn = new Float32Array(W);
  // (her vulva itself -- its lips round the split -- is not pushed: everything else in front of it is, her middle included)
  watched.forEach((i, k) => { const dd = v.fromArray(rest, i * 3).distanceTo(crotch); notOwn[k] = sm(B.ownRound, B.ownRound + 0.015, dd) * sm(B.backFar, B.backNear, dd); });
  const S = mesh.skeleton.bones.map(() => new THREE.Matrix4()), tmp = new THREE.Matrix4(), Sv = new THREE.Matrix4(), Spi = new THREE.Matrix4();
  const Lv = new THREE.Matrix3(), Lp = new THREE.Matrix3(), q = new THREE.Vector3(), d = new THREE.Vector3();
  const pushP = new Float32Array(P), backP = new Float32Array(P), rel = new THREE.Vector3();
  const boneT = new Float64Array(mesh.skeleton.bones.length * 3), dq = new Float64Array(mesh.skeleton.bones.length * 8), dqT = new THREE.Vector3(), dqQ = new THREE.Quaternion(), dqS = new THREE.Vector3();
  const bendFix = new Float32Array(W * 3), lbs = new THREE.Vector3(), dqp = new THREE.Vector3();
  /** a point put where her bones' blended turns take it (dual-quaternion skinning), into `out` */
  const dualSkin = (i: number, p: THREE.Vector3, out: THREE.Vector3) => {
    const b = [0, 0, 0, 0, 0, 0, 0, 0];
    let r0 = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k); if (w <= 0) continue;
      const o = si.getComponent(i, k) * 8;
      if (r0 < 0) r0 = o;
      const sign = dq[r0] * dq[o] + dq[r0 + 1] * dq[o + 1] + dq[r0 + 2] * dq[o + 2] + dq[r0 + 3] * dq[o + 3] < 0 ? -w : w;
      for (let e = 0; e < 8; e++) b[e] += sign * dq[o + e];
    }
    const len = Math.hypot(b[0], b[1], b[2], b[3]) || 1;
    for (let e = 0; e < 8; e++) b[e] /= len;
    const [x, y, z, w] = b, [dx, dy, dz, dw] = [b[4], b[5], b[6], b[7]];
    // turn the point by the real part, then move it by 2 * dual * conj(real)
    dqQ.set(x, y, z, w); out.copy(p).applyQuaternion(dqQ);
    const tx = 2 * (-dw * x + dx * w - dy * z + dz * y), ty = 2 * (-dw * y + dx * z + dy * w - dz * x), tz = 2 * (-dw * z - dx * y + dy * x + dz * w);
    return out.set(out.x + tx, out.y + ty, out.z + tz);
  };
  let largest = 0;
  const parts = { side: 0, back: 0, bend: 0 };
  return {
    watched: W,
    get largest() { return largest; },
    get parts() { return parts; },
    compute(posNow: ArrayLike<number>): BirthRoomField {
      const sk = mesh.skeleton;
      for (let b = 0; b < sk.bones.length; b++) S[b].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b])).multiply(mesh.bindMatrix);
      Spi.copy(S[pelvis]).invert(); Lp.setFromMatrix4(S[pelvis]);
      // each bone's turn and move as a dual quaternion (real: its turn; dual: half its move times its turn)
      for (let b = 0; b < sk.bones.length; b++) {
        S[b].decompose(dqT, dqQ, dqS);
        const o = b * 8, [qx, qy, qz, qw] = [dqQ.x, dqQ.y, dqQ.z, dqQ.w], [tx, ty, tz] = [dqT.x, dqT.y, dqT.z];
        dq[o] = qx; dq[o + 1] = qy; dq[o + 2] = qz; dq[o + 3] = qw;
        dq[o + 4] = 0.5 * (tx * qw + ty * qz - tz * qy); dq[o + 5] = 0.5 * (-tx * qz + ty * qw + tz * qx);
        dq[o + 6] = 0.5 * (tx * qy - ty * qx + tz * qw); dq[o + 7] = 0.5 * (-tx * qx - ty * qy - tz * qz);
        boneT[b * 3] = tx; boneT[b * 3 + 1] = ty; boneT[b * 3 + 2] = tz;
      }
      pushP.fill(0); backP.fill(0); largest = 0; parts.side = parts.back = parts.bend = 0;
      const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
      // the push each needs, in her pelvis's frame (along her across), welded by place
      const pushQ = new Float32Array(W);
      for (let k = 0; k < W; k++) {
        const i = watched[k];
        q.set(posNow[i * 3] - last[k * 3], posNow[i * 3 + 1] - last[k * 3 + 1], posNow[i * 3 + 2] - last[k * 3 + 2]);
        // where blending her bones' turns would put it, against blending their matrices (both without the bones' own
        // scale, so only the blending differs: a point carried by one bone is not moved); the difference is the bend fix
        lbs.set(0, 0, 0);
        for (let c = 0; c < 4; c++) {
          const w = sw.getComponent(i, c); if (w <= 0) continue;
          const bi = si.getComponent(i, c), o = bi * 8;
          dqQ.set(dq[o], dq[o + 1], dq[o + 2], dq[o + 3]);
          rel.copy(q).applyQuaternion(dqQ); rel.x += boneT[bi * 3]; rel.y += boneT[bi * 3 + 1]; rel.z += boneT[bi * 3 + 2];
          lbs.addScaledVector(rel, w);
        }
        dualSkin(i, q, dqp);
        const bs = bendShare[k];
        bendFix[k * 3] = bs * (dqp.x - lbs.x); bendFix[k * 3 + 1] = bs * (dqp.y - lbs.y); bendFix[k * 3 + 2] = bs * (dqp.z - lbs.z);
        lbs.copy(q).applyMatrix4(blend(i));
        q.copy(lbs).add(rel.set(bendFix[k * 3], bendFix[k * 3 + 1], bendFix[k * 3 + 2])).applyMatrix4(Spi);
        const side = Math.sign(rest[i * 3]) || 1, now = side * q.dot(across) / perMetre, allowed = Math.max(B.keep * standing[k] * near[k], floor[k]);
        pushQ[k] = Math.max(0, allowed - now);
        if (pushQ[k] > Math.abs(pushP[keyOf[k]])) pushP[keyOf[k]] = pushQ[k] * side;
        // and back out of the clear cone in front of her vulva
        rel.copy(q).sub(middle).divideScalar(perMetre);
        const h = rel.dot(faces), rho = Math.hypot(rel.x - h * faces.x, rel.y - h * faces.y, rel.z - h * faces.z);
        const hMax = Math.max(0, (rho - B.clear) / tanCone), back = Math.min(B.backMost, Math.max(0, h - hMax)) * notOwn[k];
        if (back > backP[keyOf[k]]) backP[keyOf[k]] = back;
      }
      // smoothed over her mesh, held at nothing on the watched area's edge
      const smoothOver = (src: Float32Array) => {
        const a = Float32Array.from(src), bb = new Float32Array(P);
        for (let pass = 0; pass < B.smoothPasses; pass++) {
          for (let p = 0; p < P; p++) {
            if (edge[p]) { bb[p] = 0; continue; }
            let s2 = a[p], k = 1;
            for (const o of nb[p]) { s2 += a[o]; k++; }
            bb[p] = Math.max(Math.abs(a[p]), Math.abs(s2 / k)) * Math.sign(a[p] || s2);
          }
          a.set(bb);
        }
        return a;
      };
      const a = smoothOver(pushP), bk = smoothOver(backP);
      // into her rest shape: through the inverse of the point's own bones' turn, then her pelvis's
      const idx: number[] = [], out: number[] = [];
      for (let k = 0; k < W; k++) {
        const i = watched[k], amount = a[keyOf[k]], back = bk[keyOf[k]], bf = Math.hypot(bendFix[k * 3], bendFix[k * 3 + 1], bendFix[k * 3 + 2]);
        if (Math.abs(amount) < 1e-6 && back < 1e-6 && bf < 1e-7) { last[k * 3] = last[k * 3 + 1] = last[k * 3 + 2] = 0; continue; }
        largest = Math.max(largest, Math.abs(amount), back);
        parts.side = Math.max(parts.side, Math.abs(amount)); parts.back = Math.max(parts.back, back); parts.bend = Math.max(parts.bend, bf / perMetre);
        // the pushes (her pelvis's frame) turned out into the posed frame, the bend fix added there, all back into her rest
        Lv.setFromMatrix4(blend(i)).invert();
        d.copy(across).multiplyScalar(amount * perMetre).addScaledVector(faces, -back * perMetre).applyMatrix3(Lp);
        d.x += bendFix[k * 3]; d.y += bendFix[k * 3 + 1]; d.z += bendFix[k * 3 + 2];
        d.applyMatrix3(Lv);
        last[k * 3] = d.x; last[k * 3 + 1] = d.y; last[k * 3 + 2] = d.z;
        idx.push(i); out.push(d.x, d.y, d.z);
      }
      return { index: Uint32Array.from(idx), pos: Float32Array.from(out), nrm: new Float32Array(out.length) };
    },
  };
}
