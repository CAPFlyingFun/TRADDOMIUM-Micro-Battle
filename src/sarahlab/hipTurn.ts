/**
 * HER HIPS TURNED, NOT AVERAGED (Joshua, 2026-11-03, of RECLINE as a bed birth: "the same issue I see near the top of
 * the thighs and belly... it looks like the thighs are twisted"; with her texture off the ridge is still there -- her
 * shape, not her skin's picture).
 *
 * The skin across the front of her hip -- from her groin up to her hip bone -- is carried by her thigh and by her body
 * TOGETHER: two or three of her torso's bones at once (Bone_000, Bone_001 and Bone_004, about a third each, measured)
 * and her thigh a fifth to a third. Her skinning moves each point to the AVERAGE of where those bones put it; with her
 * thigh drawn up 90 degrees and let fall open, the average falls short of both and twists between them -- a diagonal
 * ridge down the top of each thigh. The hips' half-turn (birthNormals.ts) cures that only where one torso bone and her
 * thigh share a point, near her groin: most of this skin is never reached.
 *
 * So, as her knees (kneeTurn.ts): each such point is carried by her torso's bones as ONE turn (their own blend, as her
 * skinning has them) and then turned round her hip joint by its thigh's share of the hip's turn -- where her body
 * carries it, then that much of the way round to where her thigh would -- and the move from where her skinning puts it,
 * taken back to her rest shape through its own bones, laid as a shape field with its normal turned the same. Faded in
 * with the hip's bend, so a gentle bend is as it was.
 */
import * as THREE from 'three';

export const HIP_TURN_FIELD = 'shape:hipTurn';

/** GAME TUNING: a point is turned when her thigh and her body carry at least `carried` of it and her thigh `least` to
 * `1 - least` of that; faded in from `from` to `full` degrees of the hip's bend */
export const HIP_TURN = Object.freeze({ carried: 0.6, least: 0.02, from: 40, full: 75,
  /** the front of her hip only: none of it `behind` her hip joint, all of it `front` in front of it (metres, her rest
   * frame -- her buttocks behind it keep their own fixes: turned too, they hung under her fuller and rounder) */
  behind: 0.0, front: 0.04 });

export interface HipTurn {
  compute(pos: ArrayLike<number>, nrm: ArrayLike<number>): { index: Uint32Array; pos: Float32Array; nrm: Float32Array };
  /** what the last compute did: points turned each leg, the hip's bend each leg (degrees), and the furthest any moved (mm) */
  readonly stats: { turned: number[]; bendDeg: number[]; mostMm: number };
}

/** `hips`: each leg's thigh bone; `legBones`: every bone of her legs (none of them her body's) */
/** `toRest`: her geometry to her rest frame (metres, +z her front) */
export function createHipTurn(mesh: THREE.SkinnedMesh, hips: readonly number[], legBones: readonly number[], toRest: THREE.Matrix4): HipTurn {
  const g = mesh.geometry, pa = g.getAttribute('position'), n = pa.count;
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const bindInv = new THREE.Matrix4().copy(mesh.bindMatrix).invert();
  // (each joint's place in her geometry, through her BIND matrix: see birthContact.ts)
  const jointAt = (b: number) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(bindInv, new THREE.Matrix4().copy(mesh.skeleton.boneInverses[b]).invert()));
  const isLeg = new Set(legBones);
  // each hip's points: its thigh carries some, her body some (read again each time: her birth poses reskin her hips)
  const pointsOf = (thigh: number): Int32Array => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      let wt = 0, wb = 0;
      for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (w <= 0) continue; if (b === thigh) wt += w; else if (!isLeg.has(b)) wb += w; }
      if (wt > 0 && wb > 0) pts.push(i);
    }
    return Int32Array.from(pts);
  };
  const S: THREE.Matrix4[] = mesh.skeleton.bones.map(() => new THREE.Matrix4());
  const Sv = new THREE.Matrix4(), Sb = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
  /** her body's own bones' blend for a point (normalised to them), into `Sb` */
  const bodyBlend = (i: number) => { const el = Sb.elements; el.fill(0); let sum = 0; for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (w <= 0 || isLeg.has(b)) continue; sum += w; const se = S[b].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } if (sum > 0) for (let e = 0; e < 16; e++) el[e] /= sum; return Sb; };
  const stats = { turned: [] as number[], bendDeg: [] as number[], mostMm: 0 };
  return {
    stats,
    compute(pos, nrm) {
      const sk = mesh.skeleton;
      for (let q = 0; q < sk.bones.length; q++) S[q].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[q].matrixWorld, sk.boneInverses[q])).multiply(mesh.bindMatrix);
      const mInf = mesh.morphTargetInfluences, mPos = g.morphAttributes.position, rel = g.morphTargetsRelative;
      const idx: number[] = [], dp: number[] = [], dn: number[] = [];
      const v = new THREE.Vector3(), pt = new THREE.Vector3(), pl = new THREE.Vector3(), nv = new THREE.Vector3(), q0 = new THREE.Quaternion(), qb = new THREE.Quaternion(), qt = new THREE.Quaternion(), qrel = new THREE.Quaternion();
      const Li = new THREE.Matrix3(), Ni = new THREE.Matrix3(), sc = new THREE.Vector3(), tr = new THREE.Vector3();
      stats.turned = []; stats.bendDeg = []; let most = 0;
      for (const thigh of hips) {
        const T = S[thigh], pts = pointsOf(thigh), joint = jointAt(thigh), jointP = joint.clone().applyMatrix4(T), jointZ = joint.clone().applyMatrix4(toRest).z, vr = new THREE.Vector3();
        T.decompose(tr, qt, sc);
        let turned = 0, bendSum = 0, bendN = 0;
        for (let q = 0; q < pts.length; q++) {
          const i = pts[q];
          let wt = 0, wb = 0; for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (b === thigh) wt += w; else if (!isLeg.has(b)) wb += w; }
          const c = wt + wb; if (c < HIP_TURN.carried) continue;
          const s = wt / c; if (s < HIP_TURN.least || s > 1 - HIP_TURN.least) continue;
          const Bd = bodyBlend(i);
          Bd.decompose(tr, qb, sc); qb.normalize();
          // the hip's own turn as this point's body sees it: from where her body carries it to where her thigh would
          qrel.copy(qt).multiply(qb.clone().invert());
          const bend = (2 * Math.acos(Math.min(1, Math.abs(qrel.w))) * 180) / Math.PI; bendSum += bend; bendN++;
          const fade = smoothstep(HIP_TURN.from, HIP_TURN.full, bend) * smoothstep(jointZ + HIP_TURN.behind, jointZ + HIP_TURN.front, vr.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(toRest).z);
          if (fade <= 0) continue;
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          if (mInf && mPos) for (let m = 0; m < mPos.length; m++) { const w = mInf[m] ?? 0; if (!w) continue; const ma = mPos[m]; if (rel) v.set(v.x + w * ma.getX(i), v.y + w * ma.getY(i), v.z + w * ma.getZ(i)); else v.set(v.x + w * (ma.getX(i) - pos[i * 3]), v.y + w * (ma.getY(i) - pos[i * 3 + 1]), v.z + w * (ma.getZ(i) - pos[i * 3 + 2])); }
          // (where her skinning puts the part her thigh and body carry: their own average)
          pl.copy(v).applyMatrix4(Bd).multiplyScalar(wb / c).add(nv.copy(v).applyMatrix4(T).multiplyScalar(wt / c));
          // turned: where her body carries it, then its share of the hip's turn round her hip joint
          q0.identity().slerp(qrel, s);
          pt.copy(v).applyMatrix4(Bd).sub(jointP).applyQuaternion(q0).add(jointP);
          // (only the share they carry is theirs to turn; faded in with the bend)
          pt.sub(pl).multiplyScalar(c * fade);
          const d = pt.length();
          if (d < 1e-6) continue;
          const B = blend(i);
          Li.setFromMatrix4(B).invert();
          pt.applyMatrix3(Li);
          nv.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).normalize();
          const own = nv.clone();
          nv.applyQuaternion(qb).applyQuaternion(q0);
          Ni.getNormalMatrix(B).invert(); nv.applyMatrix3(Ni).normalize();
          nv.sub(own).multiplyScalar(c * fade);
          idx.push(i); dp.push(pt.x, pt.y, pt.z); dn.push(nv.x, nv.y, nv.z); turned++;
          if (d > most) most = d;
        }
        stats.turned.push(turned); stats.bendDeg.push(bendN ? +(bendSum / bendN).toFixed(1) : 0);
      }
      // (mm: her geometry's units are 1/0.89974678 to the metre)
      stats.mostMm = +(most * 0.89974678 * 1000).toFixed(1);
      return { index: Uint32Array.from(idx), pos: Float32Array.from(dp), nrm: Float32Array.from(dn) };
    },
  };
}

function smoothstep(a: number, b: number, v: number): number { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
