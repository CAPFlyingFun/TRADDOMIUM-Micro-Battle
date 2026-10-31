/**
 * HER MIDDLE KEPT WITH HER PELVIS IN A BIRTH POSITION (Joshua, 2026-10-30: "isolate the hips from the torso (set masks,
 * and regions) so that the belly/pubic, etc are not modified by the legs and hips... the belly and pubic area shouldn't
 * be pinching and the hips shouldn't either"). Her skin round her crotch is weighted partly to each thigh bone, so a
 * birth position's deep hip bend (RECLINE's thighs come 92 degrees forward) dragged her pubic area, her vulva and the
 * skin behind it in between her mound and her buttocks and squashed them shut.
 *
 * A MASK per side: how much of a point belongs to her torso rather than to that thigh, by where it lies from the hip
 * joint -- inside a cone round the thigh (the thigh itself) none, outside it (her belly, pubic area, crotch, buttocks)
 * all, a band between -- and her middle (her vulva and the skin behind it) all of it whatever the cone says. In a birth
 * position that share of each thigh bone's weight is handed to her pelvis; standing, she has exactly her own weights.
 * Her body file is untouched: only the weights she is drawn with change, and back again.
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

/** GAME TUNING. */
export const BIRTH_WEIGHTS = Object.freeze({
  /** the thigh's cone, round the line from hip joint to knee: inside `inner` degrees all thigh, outside `outer` all torso */
  inner: 38, outer: 62,
  /** her middle (metres across, either side): within `middle` all torso, out to `middleFade` fading to the cone's say --
   * near her crotch only (within `middleNear`, fading out by `middleFar`; her thighs touch her middle all the way down) */
  middle: 0.03, middleFade: 0.14, middleNear: 0.1, middleFar: 0.24,
  /** whether the thigh cone is used at all (off: only her middle -- the skin round and behind her vulva -- is kept) */
  useCone: false,
  /** and the cone only near the hip joint (metres): out to `coneNear` all of it, gone by `coneFar` */
  coneNear: 0.14, coneFar: 0.22,
  /** and only below her navel (metres above the hip joints): her chest and arms are no thigh's */
  above: 0.2,
});

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface BirthWeights {
  /** hand `share` (0 none .. 1 all) of each thigh's weight in the mask to her pelvis; true when anything changed */
  apply(share: number): boolean;
  /** how many of her points the mask touches at all */
  readonly touched: number;
}

/**
 * The mask for `mesh` (her body), from its bind: `pelvis`, `thighL`/`thighR` and `kneeL`/`kneeR` are bone indices in its
 * skeleton; `toRest` takes her geometry to her rest frame (metres, +x her left). Null when it has no skin weights.
 */
export function createBirthWeights(mesh: THREE.SkinnedMesh, toRest: THREE.Matrix4, pelvis: number, thighL: number, thighR: number, kneeL: number, kneeR: number): BirthWeights | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined, pa = g.getAttribute('position');
  if (!si || !sw || !pa || (si as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || (sw as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return null;
  const n = pa.count, B = BIRTH_WEIGHTS;
  // a bone's bind place in her geometry's frame: bindMatrixInverse * inverse(boneInverse) * origin
  const at = (b: number) => new THREE.Vector3().applyMatrix4(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[b]).invert()).applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(toRest);
  const hip = [at(thighL), at(thighR)], knee = [at(kneeL), at(kneeR)], thighs = [thighL, thighR];
  const down = [knee[0].clone().sub(hip[0]).normalize(), knee[1].clone().sub(hip[1]).normalize()];
  const hipY = (hip[0].y + hip[1].y) / 2;
  // the middle of her birth area (as birthThighs.ts finds it)
  const restAll = new Float32Array(pa.count * 3), q = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) q.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest).toArray(restAll, i * 3);
  const cc = birthAreaCentre(restAll), mAng = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180;
  const crotch = cc ? new THREE.Vector3(0, cc.y - 0.047 * Math.cos(mAng), cc.z + 0.047 * Math.sin(mAng)) : new THREE.Vector3(0, hipY - 0.08, 0);
  // her own weights, as plain numbers (a quantized file stores them as normalized integers), kept to come back to
  const ownI = new Uint16Array(n * 4), ownW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) { ownI[i * 4 + c] = si.getComponent(i, c); ownW[i * 4 + c] = sw.getComponent(i, c); }
  // the mask, per side, for points weighted to that thigh at all
  const mask = new Float32Array(n * 2), v = new THREE.Vector3(), d = new THREE.Vector3();
  let touched = 0;
  for (let i = 0; i < n; i++) {
    v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest);
    if (v.y > hipY + B.above) continue;
    let any = false;
    for (let s = 0; s < 2; s++) {
      let has = false;
      for (let c = 0; c < 4; c++) if (ownI[i * 4 + c] === thighs[s] && ownW[i * 4 + c] > 0) has = true;
      if (!has) continue;
      d.copy(v).sub(hip[s]);
      const ang = (Math.acos(Math.max(-1, Math.min(1, d.dot(down[s]) / (d.length() || 1)))) * 180) / Math.PI;
      const cone = smooth(B.inner, B.outer, ang) * smooth(B.coneFar, B.coneNear, d.length()), middle = smooth(B.middleFade, B.middle, Math.abs(v.x)) * smooth(B.middleFar, B.middleNear, v.distanceTo(crotch));
      const m = Math.max(B.useCone ? cone : 0, middle);
      mask[i * 2 + s] = m;
      if (m > 0) any = true;
    }
    if (any) touched++;
  }
  let shareNow = 0;
  const I = si.array as ArrayLike<number> & { [k: number]: number }, W = sw.array as ArrayLike<number> & { [k: number]: number };
  const normalized = sw.normalized, scale = normalized ? (W instanceof Uint8Array ? 255 : W instanceof Uint16Array ? 65535 : 1) : 1;
  return {
    touched,
    apply(share: number): boolean {
      share = Math.max(0, Math.min(1, share));
      if (share === shareNow) return false;
      shareNow = share;
      const w = [0, 0, 0, 0], ix = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const mL = mask[i * 2], mR = mask[i * 2 + 1];
        if (mL <= 0 && mR <= 0) continue;
        let moved = 0, pel = -1, low = 0;
        for (let c = 0; c < 4; c++) {
          ix[c] = ownI[i * 4 + c]; w[c] = ownW[i * 4 + c];
          const m = ix[c] === thighL ? mL : ix[c] === thighR ? mR : 0;
          if (m > 0) { const take = w[c] * m * share; w[c] -= take; moved += take; }
          if (ix[c] === pelvis && ownW[i * 4 + c] > 0) pel = c;
        }
        if (pel < 0) { for (let c = 1; c < 4; c++) if (w[c] < w[low]) low = c; pel = low; moved += w[pel]; w[pel] = 0; ix[pel] = pelvis; }
        w[pel] += moved;
        const sum = w[0] + w[1] + w[2] + w[3] || 1;
        for (let c = 0; c < 4; c++) { I[i * 4 + c] = ix[c]; W[i * 4 + c] = normalized && scale > 1 ? Math.round((w[c] / sum) * scale) : w[c] / sum; }
      }
      si.needsUpdate = true; sw.needsUpdate = true;
      return true;
    },
  };
}
