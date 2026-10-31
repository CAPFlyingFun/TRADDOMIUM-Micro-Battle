/**
 * HER GROIN LIT AS IT IS BENT (Joshua, 2026-10-30: "could use better leg smoothing"). In a birth position her skin
 * round her vulva is handed to her pelvis (birthWeights.ts) over a wide band of her inner thighs, and her skinning turns
 * each point's NORMAL by the same blend of bones that moves it -- across a 90-degree hip bend the blend turns a normal
 * far less than the skin round it actually turns, so the stretched band caught the light like a sheet of plastic.
 *
 * So, worked out on her as posed: the band's real surface normals (from her posed triangles), turned back into her rest
 * shape through the inverse of each point's own blended bones, laid on her as a shape field of NORMALS only (no point
 * moves). The skinning then turns them back to exactly the surface's own. Fading to nothing at the band's edge.
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

export const BIRTH_NORMALS_FIELD = 'shape:birthNormals';

/** GAME TUNING: the band (metres from the middle of her vulva): all of it within `near`, none past `far`. */
export const BIRTH_NORMALS = Object.freeze({
  near: 0.2, far: 0.3, above: 0.12,
  /** her posed skin there smoothed too (Joshua, 2026-10-30: "smooth under the hips and buttocks... Add more
   * smoothening"): how many passes, and how far each moves a point toward its neighbours' middle (0..1) */
  passes: 30, lambda: 0.6,
  /**
   * her posed skin kept from passing through itself there (the saw-tooth seams under her buttocks and down her groin,
   * where her thigh's underside and her buttock press into each other): two points from far apart on her (`apart`
   * metres at rest) that have come within `touch` metres and one is behind the other's skin are pushed apart to `gap`,
   * `rounds` times before the smoothing and after it
   */
  apart: 0.05, touch: 0.02, gap: 0.001, rounds: 0, step: 0.0015,
});

export interface BirthNormals {
  /** the field for her as posed now (her bones' world matrices current); `pos`/`nrm` her shape as drawn */
  compute(pos: ArrayLike<number>, nrm: ArrayLike<number>): { index: Uint32Array; pos: Float32Array; nrm: Float32Array };
  readonly watched: number;
  /** how many points the last compute had to push out of her own skin */
  readonly pierced: number;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createBirthNormals(mesh: THREE.SkinnedMesh, toRest: THREE.Matrix4, indices: ArrayLike<number>): BirthNormals | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined, pa = g.getAttribute('position');
  if (!si || !sw || !pa) return null;
  const n = pa.count, B = BIRTH_NORMALS, rest = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest).toArray(rest, i * 3);
  const c = birthAreaCentre(rest);
  if (!c) return null;
  const m = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180;
  const mid = new THREE.Vector3(0, c.y - 0.047 * Math.cos(m), c.z + 0.047 * Math.sin(m));
  // the band, and how much of the fix each of its points takes
  const share = new Float32Array(n), inBand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    v.fromArray(rest, i * 3);
    if (v.y > mid.y + B.above + 0.06) continue;
    const s = smooth(B.far, B.near, v.distanceTo(mid)) * smooth(mid.y + B.above + 0.06, mid.y + B.above, v.y);
    if (s <= 0) continue;
    share[i] = s; inBand[i] = 1;
  }
  const watched: number[] = [];
  for (let i = 0; i < n; i++) if (inBand[i]) watched.push(i);
  // her triangles touching the band, and a point's key (a seam's vertices at one place are one point)
  const tris: number[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) if (inBand[indices[t]] || inBand[indices[t + 1]] || inBand[indices[t + 2]]) tris.push(indices[t], indices[t + 1], indices[t + 2]);
  const keyMap = new Map<string, number>(), key = new Int32Array(n).fill(-1);
  const used = new Set<number>(tris);
  for (const i of used) { const s = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`; let id = keyMap.get(s); if (id === undefined) { id = keyMap.size; keyMap.set(s, id); } key[i] = id; }
  const K = keyMap.size, posed = new Float32Array(n * 3), acc = new Float64Array(K * 3);
  // each point where it stands at rest (metres, her rest frame)
  const restK = new Float64Array(K * 3);
  for (const i of used) { const k = key[i]; restK[k * 3] = rest[i * 3]; restK[k * 3 + 1] = rest[i * 3 + 1]; restK[k * 3 + 2] = rest[i * 3 + 2]; }
  let pierced = 0;
  const perMetre = 1 / new THREE.Vector3(1, 0, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(toRest)).length();
  const touchG = B.touch * perMetre, gapG = B.gap * perMetre;
  const S = mesh.skeleton.bones.map(() => new THREE.Matrix4()), tmp = new THREE.Matrix4(), Sv = new THREE.Matrix4(), Li = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
  /** her own normal at a point, as her skinning turns it (one component) */
  const nrmPosed = (i: number, c: number, nrm: ArrayLike<number>) => { v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(new THREE.Matrix3().setFromMatrix4(blend(i))); return v.getComponent(c); };
  const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
  return {
    watched: watched.length,
    get pierced() { return pierced; },
    compute(pos, nrm) {
      const sk = mesh.skeleton;
      for (let q = 0; q < sk.bones.length; q++) S[q].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[q].matrixWorld, sk.boneInverses[q])).multiply(mesh.bindMatrix);
      for (const i of used) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(blend(i)); posed[i * 3] = v.x; posed[i * 3 + 1] = v.y; posed[i * 3 + 2] = v.z; }
      // smoothed where she is posed (by point, so a seam stays shut), each point as far as the band's share says
      const kp = new Float64Array(K * 3), kc = new Float64Array(K), ks = new Float64Array(K);
      for (const i of used) { const k = key[i]; kp[k * 3] += posed[i * 3]; kp[k * 3 + 1] += posed[i * 3 + 1]; kp[k * 3 + 2] += posed[i * 3 + 2]; kc[k]++; ks[k] = Math.max(ks[k], share[i]); }
      for (let k = 0; k < K; k++) { kp[k * 3] /= kc[k]; kp[k * 3 + 1] /= kc[k]; kp[k * 3 + 2] /= kc[k]; }
      const before = Float64Array.from(kp), sumN = new Float64Array(K * 3), cntN = new Float64Array(K);
      // which way her triangles face out, from her own normals as posed
      const kn = new Float64Array(K * 3);
      const keyNormals = (sign: number) => {
        kn.fill(0);
        for (let t = 0; t < tris.length; t += 3) {
          const p0 = key[tris[t]] * 3, p1 = key[tris[t + 1]] * 3, p2 = key[tris[t + 2]] * 3;
          const ux = kp[p1] - kp[p0], uy = kp[p1 + 1] - kp[p0 + 1], uz = kp[p1 + 2] - kp[p0 + 2], wx = kp[p2] - kp[p0], wy = kp[p2 + 1] - kp[p0 + 1], wz = kp[p2 + 2] - kp[p0 + 2];
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          for (const o of [p0, p1, p2]) { kn[o] += nx; kn[o + 1] += ny; kn[o + 2] += nz; }
        }
        for (let k = 0; k < K; k++) { const l = Math.hypot(kn[k * 3], kn[k * 3 + 1], kn[k * 3 + 2]) || 1; kn[k * 3] *= sign / l; kn[k * 3 + 1] *= sign / l; kn[k * 3 + 2] *= sign / l; }
      };
      keyNormals(1);
      let agree0 = 0;
      for (const i of watched) { const o = key[i] * 3; agree0 += Math.sign(kn[o] * nrmPosed(i, 0, nrm) + kn[o + 1] * nrmPosed(i, 1, nrm) + kn[o + 2] * nrmPosed(i, 2, nrm)); }
      const out0 = agree0 >= 0 ? 1 : -1;
      // kept from passing through itself
      const cell = touchG, grid = new Map<number, number[]>(), mv = new Float64Array(K * 3), mc = new Float64Array(K);
      const hash = (x: number, y: number, z: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);
      const unPierce = () => {
        for (let round = 0; round < B.rounds; round++) {
          keyNormals(out0);
          grid.clear();
          for (let k = 0; k < K; k++) { if (ks[k] <= 0) continue; const h = hash(kp[k * 3], kp[k * 3 + 1], kp[k * 3 + 2]); const l = grid.get(h); if (l) l.push(k); else grid.set(h, [k]); }
          mv.fill(0); mc.fill(0);
          let moved = 0;
          for (let k = 0; k < K; k++) {
            if (ks[k] <= 0) continue;
            const x = kp[k * 3], y = kp[k * 3 + 1], z = kp[k * 3 + 2];
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
              const l = grid.get(hash(x + dx * cell, y + dy * cell, z + dz * cell));
              if (!l) continue;
              for (const o of l) {
                if (o === k) continue;
                const ex = x - kp[o * 3], ey = y - kp[o * 3 + 1], ez = z - kp[o * 3 + 2];
                if (ex * ex + ey * ey + ez * ez > touchG * touchG) continue;
                if (Math.hypot(restK[k * 3] - restK[o * 3], restK[k * 3 + 1] - restK[o * 3 + 1], restK[k * 3 + 2] - restK[o * 3 + 2]) < B.apart) continue;
                // one side gives way, always the same one: the skin that stands lower at rest (her thigh, under her
                // buttock's fold or her mound's crease) goes to the other's surface; the other stays
                if (restK[k * 3 + 1] >= restK[o * 3 + 1]) continue;
                // k behind o's skin (or nearer it than the gap): out along o's normal, half the way (o does the other half)
                const depth = ex * kn[o * 3] + ey * kn[o * 3 + 1] + ez * kn[o * 3 + 2];
                if (depth >= gapG) continue;
                // only where the two skins have truly crossed: facing each other, each behind the other
                if (kn[k * 3] * kn[o * 3] + kn[k * 3 + 1] * kn[o * 3 + 1] + kn[k * 3 + 2] * kn[o * 3 + 2] > -0.3) continue;
                if (-(ex * kn[k * 3] + ey * kn[k * 3 + 1] + ez * kn[k * 3 + 2]) >= gapG) continue;
                const push = (gapG - depth) * ks[k];
                mv[k * 3] += kn[o * 3] * push; mv[k * 3 + 1] += kn[o * 3 + 1] * push; mv[k * 3 + 2] += kn[o * 3 + 2] * push; mc[k]++;
              }
            }
          }
          // each move small, and shared with its neighbours (so a crease is eased out, never torn into shards)
          for (let k = 0; k < K; k++) if (mc[k]) { mv[k * 3] /= mc[k]; mv[k * 3 + 1] /= mc[k]; mv[k * 3 + 2] /= mc[k]; }
          sumN.fill(0); cntN.fill(0);
          for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
            const k = key[tris[t + q]];
            for (let r = 0; r < 3; r++) { const o = key[tris[t + ((q + r) % 3)]]; sumN[k * 3] += mv[o * 3]; sumN[k * 3 + 1] += mv[o * 3 + 1]; sumN[k * 3 + 2] += mv[o * 3 + 2]; cntN[k]++; }
          }
          const stepG = B.step * perMetre;
          for (let k = 0; k < K; k++) {
            if (!cntN[k] || ks[k] <= 0) continue;
            let x = sumN[k * 3] / cntN[k], y = sumN[k * 3 + 1] / cntN[k], z = sumN[k * 3 + 2] / cntN[k];
            const l = Math.hypot(x, y, z);
            if (l < 1e-9) continue;
            if (l > stepG) { x *= stepG / l; y *= stepG / l; z *= stepG / l; }
            kp[k * 3] += x; kp[k * 3 + 1] += y; kp[k * 3 + 2] += z; moved++;
          }
          pierced = Math.max(pierced, moved);
          if (!moved) break;
        }
      };
      pierced = 0;
      unPierce();
      for (let pass = 0; pass < B.passes; pass++) {
        sumN.fill(0); cntN.fill(0);
        for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
          const k = key[tris[t + q]];
          for (let r = 1; r < 3; r++) { const o = key[tris[t + ((q + r) % 3)]]; sumN[k * 3] += kp[o * 3]; sumN[k * 3 + 1] += kp[o * 3 + 1]; sumN[k * 3 + 2] += kp[o * 3 + 2]; cntN[k]++; }
        }
        for (let k = 0; k < K; k++) {
          if (!cntN[k] || ks[k] <= 0) continue;
          const l = B.lambda * ks[k];
          for (let c = 0; c < 3; c++) kp[k * 3 + c] += l * (sumN[k * 3 + c] / cntN[k] - kp[k * 3 + c]);
        }
      }
      unPierce();
      for (const i of used) { const k = key[i]; posed[i * 3] = kp[k * 3]; posed[i * 3 + 1] = kp[k * 3 + 1]; posed[i * 3 + 2] = kp[k * 3 + 2]; }
      acc.fill(0);
      for (let t = 0; t < tris.length; t += 3) {
        a.fromArray(posed, tris[t] * 3); b.fromArray(posed, tris[t + 1] * 3); cc.fromArray(posed, tris[t + 2] * 3);
        b.sub(a); cc.sub(a); b.cross(cc);
        for (let q = 0; q < 3; q++) { const k = key[tris[t + q]] * 3; acc[k] += b.x; acc[k + 1] += b.y; acc[k + 2] += b.z; }
      }
      // her triangles' winding: which way round faces out (most of the band's face normals agree with her own normals)
      let agree = 0;
      for (const i of watched) { const o = key[i] * 3; agree += Math.sign(acc[o] * nrmPosed(i, 0, nrm) + acc[o + 1] * nrmPosed(i, 1, nrm) + acc[o + 2] * nrmPosed(i, 2, nrm)); }
      const wind = agree >= 0 ? 1 : -1;
      // and smoothed over her points a few times, so her coarse triangles do not show as facets
      const sm2 = new Float64Array(K * 3);
      for (let pass = 0; pass < 4; pass++) {
        sm2.set(acc);
        for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
          const k = key[tris[t + q]] * 3;
          for (let r = 1; r < 3; r++) { const o = key[tris[t + ((q + r) % 3)]] * 3; sm2[k] += 0.25 * acc[o]; sm2[k + 1] += 0.25 * acc[o + 1]; sm2[k + 2] += 0.25 * acc[o + 2]; }
        }
        acc.set(sm2);
      }
      const idx: number[] = [], dn: number[] = [], dp: number[] = [];
      watched.forEach((i) => {
        const o = key[i] * 3;
        a.set(acc[o], acc[o + 1], acc[o + 2]).multiplyScalar(wind);
        if (a.lengthSq() < 1e-20) return;
        a.normalize();
        // what it must be in her rest shape for her skinning to turn it to that
        Li.setFromMatrix4(blend(i)).invert();
        a.applyMatrix3(Li).normalize();
        // her own (as drawn without this field: the caller takes it off first), turned toward it by the band's share
        b.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
        a.sub(b).multiplyScalar(share[i]);
        idx.push(i); dn.push(a.x, a.y, a.z);
        // and its move, turned back into her rest shape
        const k = key[i];
        b.set(kp[k * 3] - before[k * 3], kp[k * 3 + 1] - before[k * 3 + 1], kp[k * 3 + 2] - before[k * 3 + 2]).applyMatrix3(Li);
        dp.push(b.x, b.y, b.z);
      });
      return { index: Uint32Array.from(idx), pos: Float32Array.from(dp), nrm: Float32Array.from(dn) };
    },
  };
}
