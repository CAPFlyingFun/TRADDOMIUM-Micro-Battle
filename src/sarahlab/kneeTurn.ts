/**
 * HER KNEES TURNED, NOT AVERAGED (Joshua, 2026-11-02: "fix the leg issue... like how we did the hips": one leg raised,
 * the knee bent through its angles, her weights against Meshy's).
 *
 * Her skinning moves a point her thigh and shin share to the AVERAGE of where each bone would put it: bent far, those two
 * places are on opposite sides of the knee and their average falls inside it -- the front of her knee drawn into a sharp
 * corner (a slice through it, bent 140 degrees: its lowest point 1.5 cm under the joint where a round knee keeps 3). Her
 * weights are not the trouble (Meshy's, laid on the same bend, fold the same way, and blends drawn wider or narrower
 * changed nothing but to tear the back of the knee); the averaging is.
 *
 * So, as her hips' half-turn does (birthNormals.ts): a point her thigh and shin share is turned round her knee by its
 * share of the knee's own turn -- where her thigh carries it, then that much of the way round to where her shin would --
 * and the move from where her skinning puts it, taken back to her rest shape through its own bones, laid as a shape field
 * with its normal turned the same. Worked out on her as posed; weighted 1 in the birth poses.
 */
import * as THREE from 'three';

export const KNEE_TURN_FIELD = 'shape:kneeTurn';

/** GAME TUNING: a point is turned when her thigh and shin carry at least `carried` of it, and both some of it. */
export const KNEE_TURN = Object.freeze({ carried: 0.6, least: 0.02 });

export interface KneeTurn {
  compute(pos: ArrayLike<number>, nrm: ArrayLike<number>): { index: Uint32Array; pos: Float32Array; nrm: Float32Array };
  /** what the last compute did: points turned each leg, and the furthest any moved (mm) */
  readonly stats: { turned: number[]; mostMm: number };
}

/** `legs`: each leg's thigh bone and shin bone. */
export function createKneeTurn(mesh: THREE.SkinnedMesh, legs: readonly (readonly [number, number])[]): KneeTurn {
  const g = mesh.geometry, pa = g.getAttribute('position'), n = pa.count;
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const bindInv = new THREE.Matrix4().copy(mesh.bindMatrix).invert();
  // (each joint's place in her geometry, through her BIND matrix: see birthContact.ts)
  const jointAt = (b: number) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(bindInv, new THREE.Matrix4().copy(mesh.skeleton.boneInverses[b]).invert()));
  // each leg's points either bone carries any of (her weights are read again each time: her birth poses reskin her hips)
  const sets = legs.map(([thigh, shin]) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k); if ((b === thigh || b === shin) && sw.getComponent(i, k) > 0) { pts.push(i); break; } } }
    return { thigh, shin, knee: jointAt(shin), pts: Int32Array.from(pts) };
  });
  const S: THREE.Matrix4[] = mesh.skeleton.bones.map(() => new THREE.Matrix4());
  const Sv = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
  const stats = { turned: [] as number[], mostMm: 0 };
  return {
    stats,
    compute(pos, nrm) {
      const sk = mesh.skeleton;
      for (let q = 0; q < sk.bones.length; q++) S[q].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[q].matrixWorld, sk.boneInverses[q])).multiply(mesh.bindMatrix);
      const mInf = mesh.morphTargetInfluences, mPos = g.morphAttributes.position, rel = g.morphTargetsRelative;
      const idx: number[] = [], dp: number[] = [], dn: number[] = [];
      const v = new THREE.Vector3(), pt = new THREE.Vector3(), pl = new THREE.Vector3(), nv = new THREE.Vector3(), q0 = new THREE.Quaternion(), qs = new THREE.Quaternion(), qt = new THREE.Quaternion(), qrel = new THREE.Quaternion();
      const Li = new THREE.Matrix3(), Ni = new THREE.Matrix3(), sc = new THREE.Vector3(), tr = new THREE.Vector3();
      stats.turned = []; let most = 0;
      for (const set of sets) {
        const T = S[set.thigh], K = S[set.shin];
        // the knee's own turn: from where her thigh carries a point to where her shin would (her shin about her knee)
        T.decompose(tr, qt, sc); K.decompose(tr, qs, sc);
        qrel.copy(qs).multiply(qt.clone().invert());
        const kneeP = set.knee.clone().applyMatrix4(K);
        let turned = 0;
        for (let q = 0; q < set.pts.length; q++) {
          const i = set.pts[q];
          let wt = 0, ws = 0; for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (b === set.thigh) wt += w; else if (b === set.shin) ws += w; }
          const c = wt + ws; if (c < KNEE_TURN.carried) continue;
          const s = ws / c; if (s < KNEE_TURN.least || s > 1 - KNEE_TURN.least) continue;
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          if (mInf && mPos) for (let m = 0; m < mPos.length; m++) { const w = mInf[m] ?? 0; if (!w) continue; const ma = mPos[m]; if (rel) v.set(v.x + w * ma.getX(i), v.y + w * ma.getY(i), v.z + w * ma.getZ(i)); else v.set(v.x + w * (ma.getX(i) - pos[i * 3]), v.y + w * (ma.getY(i) - pos[i * 3 + 1]), v.z + w * (ma.getZ(i) - pos[i * 3 + 2])); }
          const B = blend(i);
          // (where her skinning puts the part her thigh and shin carry: their own average)
          pl.copy(v).applyMatrix4(T).multiplyScalar(wt / c).add(nv.copy(v).applyMatrix4(K).multiplyScalar(ws / c));
          // turned: where her thigh carries it, then its share of the knee's turn round her knee
          q0.identity().slerp(qrel, s);
          pt.copy(v).applyMatrix4(T).sub(kneeP).applyQuaternion(q0).add(kneeP);
          // (only the share her thigh and shin carry is theirs to turn)
          pt.sub(pl).multiplyScalar(c);
          const d = pt.length();
          if (d < 1e-6) continue;
          Li.setFromMatrix4(B).invert();
          pt.applyMatrix3(Li);
          // its normal: her own as her thigh turns it, then the same share of the knee's turn; back to rest through her
          // skinning's own turn of normals, as a change to hers
          nv.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).normalize();
          const own = nv.clone();
          nv.applyQuaternion(qt).applyQuaternion(q0);
          Ni.getNormalMatrix(B).invert(); nv.applyMatrix3(Ni).normalize();
          nv.sub(own).multiplyScalar(c);
          idx.push(i); dp.push(pt.x, pt.y, pt.z); dn.push(nv.x, nv.y, nv.z); turned++;
          if (d > most) most = d;
        }
        stats.turned.push(turned);
      }
      // (mm: her geometry's units are 1/0.89974678 to the metre)
      stats.mostMm = +(most * 0.89974678 * 1000).toFixed(1);
      return { index: Uint32Array.from(idx), pos: Float32Array.from(dp), nrm: Float32Array.from(dn) };
    },
  };
}
