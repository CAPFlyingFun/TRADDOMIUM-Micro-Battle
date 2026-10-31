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
  /** folds ironed out after it (2026-10-31): two triangles sharing an edge whose facings' dot is below `foldAt` are a
   * fold; the points round it are smoothed `ironLambda` hard, four passes a round, at most `ironRounds` rounds */
  foldAt: -0.2, ironLambda: 0.8, ironRounds: 40,
  /**
   * her posed skin kept from passing through itself there (the saw-tooth seams under her buttocks and down her groin,
   * where her thigh's underside and her buttock press into each other): two points from far apart on her (`apart`
   * metres at rest) that have come within `touch` metres and one is behind the other's skin are pushed apart to `gap`,
   * `rounds` times before the smoothing and after it
   */
  apart: 0.05, touch: 0.012, gap: 0.0015, rounds: 0, step: 0.003, layer: 0.1,
  /**
   * THE GROIN CREASE AS A PLANE (Joshua, 2026-10-31: the belly should run smoothly into the mound; "each hip and leg are
   * separate, and the torso/belly/pubic/vagina are all together"). A hip bent past ~40 degrees drove the front of each
   * thigh up into the underside of her belly, and where the two skins crossed her triangles showed as a saw-tooth. For
   * each side, the plane through her hip joint halfway between her torso (pelvis to spine) and that thigh (hip to knee)
   * is where the two meet: thigh skin is kept on the thigh's side of it, torso skin on the torso's -- a point across it
   * is laid back onto it -- within `creaseReach` metres of the joint, in front of it, fading out by `creaseFade`
   */
  creaseReach: 0.16, creaseFade: 0.24, creaseGap: 0.002,
});

export interface BirthNormals {
  /** the field for her as posed now (her bones' world matrices current); `pos`/`nrm` her shape as drawn */
  compute(pos: ArrayLike<number>, nrm: ArrayLike<number>): { index: Uint32Array; pos: Float32Array; nrm: Float32Array };
  readonly watched: number;
  /** vertex pairs of the band's open edges (each an edge only one of her triangles has) */
  readonly openEdges: readonly number[];
  /** how many points the last compute had to push out of her own skin */
  readonly pierced: number;
  /** how much the turn back into her rest shape magnified a move (worst, and how many points past 3x) */
  readonly blow: { worst: number; over3: number };
  /** how many folds the last compute could not iron out */
  readonly folded: number;
  /** (debug) where the last compute meant each point to be drawn, posed: vertex, x, y, z */
  readonly expected: readonly number[];
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createBirthNormals(mesh: THREE.SkinnedMesh, toRest: THREE.Matrix4, indices: ArrayLike<number>, thighBones: readonly number[] = [], layerOf?: (i: number) => number, crease?: { hips: readonly [number, number]; knees: readonly [number, number]; pelvis: number; spine: number }): BirthNormals | null {
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
  // each edge of the band (by point), and the triangles (offsets into `tris`) that have it
  const edgeTris = new Map<string, number[]>();
  for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) { const a0 = key[tris[t + q]], b0 = key[tris[t + (q + 1) % 3]]; const e2 = a0 < b0 ? `${a0},${b0}` : `${b0},${a0}`; (edgeTris.get(e2) ?? edgeTris.set(e2, []).get(e2)!).push(t); }
  // (a check: edges inside the band only one triangle has -- open edges, which smoothing pulls apart)
  const openEdges: number[] = [];
  { const ec = new Map<string, number>();
    for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) { const a0 = key[tris[t + q]], b0 = key[tris[t + (q + 1) % 3]]; const e2 = a0 < b0 ? `${a0},${b0}` : `${b0},${a0}`; ec.set(e2, (ec.get(e2) ?? 0) + 1); }
    const shareK = new Float32Array(K), anyI = new Int32Array(K);
    for (const i of used) { shareK[key[i]] = Math.max(shareK[key[i]], share[i]); anyI[key[i]] = i; }
    for (const [e2, c2] of ec) if (c2 === 1) { const [a0, b0] = e2.split(',').map(Number); if (shareK[a0] > 0.05 && shareK[b0] > 0.05) openEdges.push(anyI[a0], anyI[b0]); } }
  // each point where it stands at rest (metres, her rest frame)
  const restK = new Float64Array(K * 3);
  for (const i of used) { const k = key[i]; restK[k * 3] = rest[i * 3]; restK[k * 3 + 1] = rest[i * 3 + 1]; restK[k * 3 + 2] = rest[i * 3 + 2]; }
  let pierced = 0, blowWorst = 0, blowCount = 0, folded = 0;
  const expected: number[] = [];
  const perMetre = 1 / new THREE.Vector3(1, 0, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(toRest)).length();
  const touchG = B.touch * perMetre, gapG = B.gap * perMetre;
  const S = mesh.skeleton.bones.map(() => new THREE.Matrix4()), tmp = new THREE.Matrix4(), Sv = new THREE.Matrix4(), Li = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
  /** her own normal at a point, as her skinning turns it (one component) */
  const nrmPosed = (i: number, c: number, nrm: ArrayLike<number>) => { v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(new THREE.Matrix3().setFromMatrix4(blend(i))); return v.getComponent(c); };
  const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
  return {
    watched: watched.length,
    openEdges,
    get pierced() { return pierced; },
    get blow() { return { worst: +blowWorst.toFixed(2), over3: blowCount }; },
    get folded() { return folded; },
    expected,
    compute(pos, nrm) {
      const sk = mesh.skeleton;
      for (let q = 0; q < sk.bones.length; q++) S[q].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[q].matrixWorld, sk.boneInverses[q])).multiply(mesh.bindMatrix);
      // her shape as DRAWN: her morph targets on it too (2026-10-31: her model carries the full belly and the belly
      // slider takes it off with a morph; smoothed without them, the smoothing was for a shape she is not drawn in,
      // and put on the one she is, it folded strips of her groin inside out -- cracks, worst at 0%)
      const mInf = mesh.morphTargetInfluences, mPos = g.morphAttributes.position, rel = g.morphTargetsRelative;
      for (const i of used) {
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        if (mInf && mPos) {
          for (let m = 0; m < mPos.length; m++) {
            const w = mInf[m] ?? 0; if (!w) continue;
            const ma = mPos[m];
            if (rel) v.set(v.x + w * ma.getX(i), v.y + w * ma.getY(i), v.z + w * ma.getZ(i));
            else { v.set(v.x + w * (ma.getX(i) - pos[i * 3]), v.y + w * (ma.getY(i) - pos[i * 3 + 1]), v.z + w * (ma.getZ(i) - pos[i * 3 + 2])); }
          }
        }
        v.applyMatrix4(blend(i)); posed[i * 3] = v.x; posed[i * 3 + 1] = v.y; posed[i * 3 + 2] = v.z;
      }
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
      // KEPT FROM PASSING THROUGH ITSELF, one side giving way: her thigh's skin (mostly carried by a thigh bone) that has
      // gone in behind her buttock's or her mound's (mostly not) is laid back on that skin's surface -- the nearest of
      // its triangles, by the triangle's own face (not a point's normal, which a fold makes unreliable)
      const thighOf = new Float64Array(K);
      { const cnt = new Float64Array(K);
        for (const i of used) { let t = 0; if (layerOf) t = layerOf(i); else for (let c = 0; c < 4; c++) if (thighBones.includes(si.getComponent(i, c))) t += sw.getComponent(i, c); thighOf[key[i]] += t; cnt[key[i]]++; }
        for (let k = 0; k < K; k++) if (cnt[k]) thighOf[k] /= cnt[k]; }
      const cell = touchG, grid = new Map<number, number[]>(), mv = new Float64Array(K * 3), mc = new Float64Array(K);
      const hash = (x: number, y: number, z: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);
      const A3 = new THREE.Vector3(), B3 = new THREE.Vector3(), C3 = new THREE.Vector3(), P3 = new THREE.Vector3(), Q3 = new THREE.Vector3(), N3 = new THREE.Vector3(), tri3 = new THREE.Triangle();
      const unPierce = () => {
        for (let round = 0; round < B.rounds; round++) {
          keyNormals(out0);
          // her other skin's triangles, by where they are now
          grid.clear();
          for (let t = 0; t < tris.length; t += 3) {
            const k0 = key[tris[t]], k1 = key[tris[t + 1]], k2 = key[tris[t + 2]];
            const x = (kp[k0 * 3] + kp[k1 * 3] + kp[k2 * 3]) / 3, y = (kp[k0 * 3 + 1] + kp[k1 * 3 + 1] + kp[k2 * 3 + 1]) / 3, z = (kp[k0 * 3 + 2] + kp[k1 * 3 + 2] + kp[k2 * 3 + 2]) / 3;
            const h = hash(x, y, z), l = grid.get(h); if (l) l.push(t); else grid.set(h, [t]);
          }
          mv.fill(0); mc.fill(0);
          let moved = 0;
          for (let k = 0; k < K; k++) {
            if (ks[k] <= 0) continue;
            P3.set(kp[k * 3], kp[k * 3 + 1], kp[k * 3 + 2]);
            let best = Infinity, bx = 0, by = 0, bz = 0, bnx = 0, bny = 0, bnz = 0;
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
              const l = grid.get(hash(P3.x + dx * cell, P3.y + dy * cell, P3.z + dz * cell));
              if (!l) continue;
              for (const t of l) {
                const k0 = key[tris[t]], k1 = key[tris[t + 1]], k2 = key[tris[t + 2]];
                if (k0 === k || k1 === k || k2 === k) continue;
                // only skin carried less by a thigh than k is: the thigh's goes under, the other stays
                if (thighOf[k] < (thighOf[k0] + thighOf[k1] + thighOf[k2]) / 3 + B.layer) continue;
                if (Math.hypot(restK[k * 3] - restK[k0 * 3], restK[k * 3 + 1] - restK[k0 * 3 + 1], restK[k * 3 + 2] - restK[k0 * 3 + 2]) < B.apart) continue;
                A3.set(kp[k0 * 3], kp[k0 * 3 + 1], kp[k0 * 3 + 2]); B3.set(kp[k1 * 3], kp[k1 * 3 + 1], kp[k1 * 3 + 2]); C3.set(kp[k2 * 3], kp[k2 * 3 + 1], kp[k2 * 3 + 2]);
                tri3.set(A3, B3, C3); tri3.closestPointToPoint(P3, Q3);
                const d = P3.distanceTo(Q3);
                if (d >= best || d > touchG) continue;
                tri3.getNormal(N3); N3.multiplyScalar(out0);
                best = d; bx = Q3.x; by = Q3.y; bz = Q3.z; bnx = N3.x; bny = N3.y; bnz = N3.z;
              }
            }
            if (best === Infinity) continue;
            const signed = (P3.x - bx) * bnx + (P3.y - by) * bny + (P3.z - bz) * bnz;
            if (signed >= gapG) continue;
            // in under that skin, along its OWN normal, never more than the reach (small and steady: no shards)
            const go = Math.min(touchG, gapG - signed);
            mv[k * 3] = -kn[k * 3] * go; mv[k * 3 + 1] = -kn[k * 3 + 1] * go; mv[k * 3 + 2] = -kn[k * 3 + 2] * go; mc[k] = 1;
          }
          // each move small, and eased into its neighbours (so a crease is laid flat, never torn into shards)
          sumN.fill(0); cntN.fill(0);
          for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
            const k = key[tris[t + q]];
            for (let r = 0; r < 3; r++) { const o = key[tris[t + ((q + r) % 3)]]; if (!mc[o]) continue; sumN[k * 3] += mv[o * 3]; sumN[k * 3 + 1] += mv[o * 3 + 1]; sumN[k * 3 + 2] += mv[o * 3 + 2]; cntN[k]++; }
          }
          const stepG = B.step * perMetre;
          for (let k = 0; k < K; k++) {
            if (ks[k] <= 0) continue;
            const own = mc[k] ? 1 : 0, c = cntN[k] + own;
            if (!c) continue;
            let x = (sumN[k * 3] + mv[k * 3] * own) / c, y = (sumN[k * 3 + 1] + mv[k * 3 + 1] * own) / c, z = (sumN[k * 3 + 2] + mv[k * 3 + 2] * own) / c;
            const l = Math.hypot(x, y, z);
            if (l < 1e-9) continue;
            if (l > stepG) { x *= stepG / l; y *= stepG / l; z *= stepG / l; }
            kp[k * 3] += x * ks[k]; kp[k * 3 + 1] += y * ks[k]; kp[k * 3 + 2] += z * ks[k]; moved++;
          }
          pierced = Math.max(pierced, moved);
          if (!moved) break;
        }
      };
      // the groin crease, per side, as a plane (see BIRTH_NORMALS.creaseReach)
      const sideOfK = new Int8Array(K), thighW = new Float64Array(K);
      if (crease) {
        const tally = new Float64Array(K * 3), cn = new Float64Array(K);
        for (const i of used) {
          const k = key[i];
          for (let c = 0; c < 4; c++) { const b = si.getComponent(i, c), w = sw.getComponent(i, c); if (b === crease.hips[0]) tally[k * 3] += w; else if (b === crease.hips[1]) tally[k * 3 + 1] += w; else tally[k * 3 + 2] += w; }
          cn[k]++;
        }
        for (let k = 0; k < K; k++) { if (!cn[k]) continue; const l = tally[k * 3] / cn[k], r = tally[k * 3 + 1] / cn[k]; sideOfK[k] = l >= r ? 0 : 1; thighW[k] = Math.max(l, r); }
      }
      const boneAt = (b: number) => new THREE.Vector3().setFromMatrixPosition(sk.bones[b].matrixWorld).applyMatrix4(mesh.bindMatrixInverse);
      const layCrease = () => {
        if (!crease) return;
        const pel = boneAt(crease.pelvis), up = boneAt(crease.spine).sub(pel).normalize();
        const reach = B.creaseReach * perMetre, fade = B.creaseFade * perMetre, gap = B.creaseGap * perMetre;
        for (let side = 0; side < 2; side++) {
          const H = boneAt(crease.hips[side]), D = boneAt(crease.knees[side]).sub(H).normalize();
          const nrmP = D.clone().sub(up); if (nrmP.lengthSq() < 1e-9) continue; nrmP.normalize();
          // only in front of the joint: the way her torso and thigh both lean (their sum)
          const front = D.clone().add(up).normalize();
          for (let k = 0; k < K; k++) {
            if (ks[k] <= 0 || sideOfK[k] !== side) continue;
            const dx = kp[k * 3] - H.x, dy = kp[k * 3 + 1] - H.y, dz = kp[k * 3 + 2] - H.z, dist = Math.hypot(dx, dy, dz);
            if (dist > fade) continue;
            if (dx * front.x + dy * front.y + dz * front.z <= 0) continue;
            const along = dx * nrmP.x + dy * nrmP.y + dz * nrmP.z, thigh = thighW[k] >= 0.5;
            // thigh skin belongs on the + side, torso skin on the - side
            const over = thigh ? gap - along : along + gap;
            if (over <= 0) continue;
            const f = ks[k] * smooth(fade, reach, dist), mv2 = (thigh ? over : -over) * f;
            kp[k * 3] += nrmP.x * mv2; kp[k * 3 + 1] += nrmP.y * mv2; kp[k * 3 + 2] += nrmP.z * mv2;
            pierced++;
          }
        }
      };
      // FOLDS IRONED OUT (2026-10-31: on her posed groin, squeezed where her thigh meets her belly, plain smoothing
      // turned a thin strip of her skin inside out -- a crack up each groin crease and under her buttocks, wider the
      // more it smoothed). After the smoothing, wherever two of her triangles that share an edge face more than
      // `foldAt` apart, the points round them are smoothed again, harder, and only there, until none do.
      const ironFolds = () => {
        const fnK = new Float64Array(tris.length), mark = new Uint8Array(K);
        let lastFolds = 0;
        for (let round = 0; round < B.ironRounds; round++) {
          for (let t = 0; t < tris.length; t += 3) {
            const p0 = key[tris[t]] * 3, p1 = key[tris[t + 1]] * 3, p2 = key[tris[t + 2]] * 3;
            const ux = kp[p1] - kp[p0], uy = kp[p1 + 1] - kp[p0 + 1], uz = kp[p1 + 2] - kp[p0 + 2], vx = kp[p2] - kp[p0], vy = kp[p2 + 1] - kp[p0 + 1], vz = kp[p2 + 2] - kp[p0 + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l; ny /= l; nz /= l; fnK[t] = nx; fnK[t + 1] = ny; fnK[t + 2] = nz;
          }
          mark.fill(0);
          let folds = 0;
          for (const [, ts] of edgeTris) {
            if (ts.length !== 2) continue;
            const a0 = ts[0], b0 = ts[1];
            if (fnK[a0] * fnK[b0] + fnK[a0 + 1] * fnK[b0 + 1] + fnK[a0 + 2] * fnK[b0 + 2] >= B.foldAt) continue;
            folds++;
            for (const t of ts) for (let q = 0; q < 3; q++) mark[key[tris[t + q]]] = 1;
          }
          lastFolds = folds;
          if (!folds) break;
          // the points round each fold, and their neighbours, so the ironing blends into the skin round it
          for (let grow = 0; grow < 2; grow++) {
            const add: number[] = [];
            for (let t = 0; t < tris.length; t += 3) { const k0 = key[tris[t]], k1 = key[tris[t + 1]], k2 = key[tris[t + 2]]; if (mark[k0] | mark[k1] | mark[k2]) add.push(k0, k1, k2); }
            for (const k of add) mark[k] = 1;
          }
          for (let pass = 0; pass < 4; pass++) {
            sumN.fill(0); cntN.fill(0);
            for (let t = 0; t < tris.length; t += 3) for (let q = 0; q < 3; q++) {
              const k = key[tris[t + q]];
              if (!mark[k]) continue;
              for (let r = 1; r < 3; r++) { const o = key[tris[t + ((q + r) % 3)]]; sumN[k * 3] += kp[o * 3]; sumN[k * 3 + 1] += kp[o * 3 + 1]; sumN[k * 3 + 2] += kp[o * 3 + 2]; cntN[k]++; }
            }
            for (let k = 0; k < K; k++) {
              if (!mark[k] || !cntN[k] || ks[k] <= 0) continue;
              const l = B.ironLambda * ks[k];
              for (let c = 0; c < 3; c++) kp[k * 3 + c] += l * (sumN[k * 3 + c] / cntN[k] - kp[k * 3 + c]);
            }
          }
        }
        folded = lastFolds;
      };
      pierced = 0;
      unPierce();
      layCrease();
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
      ironFolds();
      unPierce();
      layCrease();
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
      blowWorst = 0; blowCount = 0; expected.length = 0;
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
        b.set(kp[k * 3] - before[k * 3], kp[k * 3 + 1] - before[k * 3 + 1], kp[k * 3 + 2] - before[k * 3 + 2]);
        const posedLen = b.length();
        b.applyMatrix3(Li);
        if (posedLen > 1e-6) { const ratio = b.length() / posedLen; if (ratio > blowWorst) blowWorst = ratio; if (ratio > 3) blowCount++; }
        dp.push(b.x, b.y, b.z);
        expected.push(i, kp[k * 3], kp[k * 3 + 1], kp[k * 3 + 2]);
      });
      return { index: Uint32Array.from(idx), pos: Float32Array.from(dp), nrm: Float32Array.from(dn) };
    },
  };
}
