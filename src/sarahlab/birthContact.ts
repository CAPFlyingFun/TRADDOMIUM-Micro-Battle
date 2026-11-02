/**
 * HER CALF PRESSED TO HER THIGH IN A SQUAT, NOT THROUGH IT (Joshua, 2026-11-02: "it's the squat that looks off with the
 * legs and thighs blending into one/merging").
 *
 * In SQUAT her knee folds about 150 degrees: the back of her calf comes down onto the back of her thigh. Her skinning
 * blends each point between its bones, so the two run into each other -- the calf's skin passes inside the thigh's and
 * the two read as one shape, with no line where they meet. Real soft tissue does not pass through itself: it presses
 * flat where it touches, and a crease runs round the edge of the contact.
 *
 * So, worked out on her as she is posed: the skin each side of each knee -- her thigh's (above the knee along her leg)
 * and her calf's (below it) -- and, for each point of one, how deep it sits inside the other (from the other's nearest
 * point and that point's posed normal). Each point inside is moved back out along the other's normal by half its depth
 * and `gap` more, so the two meet at a shared surface between them; the move is spread a little round its neighbours so
 * the flattening has no edge, then turned back into her rest shape through each point's own blended bones (as the
 * smoothing fields are, birthNormals.ts), with her normals turned to the moved surface's. A shape field, weighted 1 in
 * SQUAT and 0 else: her standing shape is untouched and her body file is never changed.
 */
import * as THREE from 'three';

export const BIRTH_CONTACT_FIELD = 'shape:birthContact';

/** GAME TUNING (metres, her rest frame). */
export const BIRTH_CONTACT = Object.freeze({
  /** how far from each knee's joint the two sides are looked at */
  reach: 0.3,
  /** skin within `bandAround` of the knee joint along her leg is the knee itself: neither side */
  bandAround: 0.035,
  /** how far apart the two meet: each side stops `gap` / 2 short of the shared surface */
  gap: 0.001,
  /** how many times the move is spread over its neighbours, and how much each time (0..1) */
  spread: 12, spreadRate: 0.5,
  /** a point further than this from the other side's nearest point is not touching it */
  near: 0.05,
  /** THE VALVE (Joshua, 2026-11-02: "like a balloon with release valves... once they start to separate, it fills back"):
   * the volume pressed out of the contact goes into a soft bulge round it, on the same side, out to `bulgeReach` from
   * the contact's edge (most of it just outside the edge), never more than `bulgeMost` out, `bulgeShare` of the volume */
  bulgeReach: 0.06, bulgeMost: 0.015, bulgeShare: 1,
});

export interface BirthContact {
  /** the field for her as posed now: `pos` her rest shape as summed without it (shape fields; morphs read off her mesh) */
  compute(pos: ArrayLike<number>, nrm: ArrayLike<number>): { index: Uint32Array; pos: Float32Array; nrm: Float32Array };
  /** what the last compute found: points inside the other side (each leg), the deepest (cm), points moved */
  readonly stats: { inside: number[]; deepestCm: number[]; moved: number; pressedCm3: number[]; bulgeMm: number[] };
}

/**
 * `legs`: each leg's thigh bone and shin bone (the knee is where the shin bone's joint is). `tris`: her triangles.
 */
export function createBirthContact(mesh: THREE.SkinnedMesh, toRest: THREE.Matrix4, tris: ArrayLike<number>, legs: readonly (readonly [number, number])[]): BirthContact {
  const C = BIRTH_CONTACT, g = mesh.geometry, pa = g.getAttribute('position') as THREE.BufferAttribute, n = pa.count;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const perMetre = new THREE.Vector3(1, 0, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(toRest).invert()).length();
  // each joint's place in her geometry (its bone's bind, inverted)
  const jointAt = (b: number) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(mesh.bindMatrixInverse, new THREE.Matrix4().copy(mesh.skeleton.boneInverses[b]).invert()));
  // the points of each leg round its knee, and which side of it each is on (+1 calf, -1 thigh, 0 the knee itself)
  const sides: { pts: Int32Array; side: Int8Array; tris: number[] }[] = [];
  const inLeg = new Int8Array(n).fill(-1);
  legs.forEach(([thigh, shin], L) => {
    const hip = jointAt(thigh), knee = jointAt(shin), axis = knee.clone().sub(hip).normalize(), v = new THREE.Vector3();
    const reach = C.reach * perMetre, band = C.bandAround * perMetre, pts: number[] = [], side: number[] = [];
    for (let i = 0; i < n; i++) {
      let w = 0; for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k); if (b === thigh || b === shin) w += sw.getComponent(i, k); }
      if (w < 0.5) continue;
      v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).sub(knee);
      if (v.length() > reach) continue;
      const along = v.dot(axis);
      pts.push(i); side.push(along > band ? 1 : along < -band ? -1 : 0); inLeg[i] = L;
    }
    const legTris: number[] = [];
    for (let t = 0; t + 2 < tris.length; t += 3) if (inLeg[tris[t]] === L && inLeg[tris[t + 1]] === L && inLeg[tris[t + 2]] === L) legTris.push(tris[t], tris[t + 1], tris[t + 2]);
    sides.push({ pts: Int32Array.from(pts), side: Int8Array.from(side), tris: legTris });
  });
  // her points welded by place (a seam's two copies move as one)
  const key = new Int32Array(n).fill(-1), keyMap = new Map<string, number>();
  for (let i = 0; i < n; i++) if (inLeg[i] >= 0) { const s = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`; let id = keyMap.get(s); if (id === undefined) { id = keyMap.size; keyMap.set(s, id); } key[i] = id; }
  const K = keyMap.size;
  // neighbours by welded point
  const nbr: Set<number>[] = Array.from({ length: K }, () => new Set<number>());
  for (const s of sides) for (let t = 0; t < s.tris.length; t += 3) for (let q = 0; q < 3; q++) { const a = key[s.tris[t + q]], b = key[s.tris[t + (q + 1) % 3]]; nbr[a].add(b); nbr[b].add(a); }
  const S: THREE.Matrix4[] = mesh.skeleton.bones.map(() => new THREE.Matrix4());
  const Sv = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const blend = (i: number) => { const el = Sv.elements; el.fill(0); for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const se = S[si.getComponent(i, k)].elements; for (let e = 0; e < 16; e++) el[e] += w * se[e]; } return Sv; };
  const stats = { inside: [] as number[], deepestCm: [] as number[], moved: 0, pressedCm3: [] as number[], bulgeMm: [] as number[] };
  return {
    stats,
    compute(pos, nrm) {
      const sk = mesh.skeleton;
      for (let q = 0; q < sk.bones.length; q++) S[q].multiplyMatrices(mesh.bindMatrixInverse, tmp.multiplyMatrices(sk.bones[q].matrixWorld, sk.boneInverses[q])).multiply(mesh.bindMatrix);
      const mInf = mesh.morphTargetInfluences, mPos = g.morphAttributes.position, rel = g.morphTargetsRelative;
      const posed = new Float64Array(K * 3), v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const anyOf = new Int32Array(K).fill(-1);
      for (const s of sides) for (const i of s.pts) {
        const k = key[i]; if (anyOf[k] >= 0) continue; anyOf[k] = i;
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        if (mInf && mPos) for (let m = 0; m < mPos.length; m++) { const w = mInf[m] ?? 0; if (!w) continue; const ma = mPos[m]; if (rel) v.set(v.x + w * ma.getX(i), v.y + w * ma.getY(i), v.z + w * ma.getZ(i)); else v.set(v.x + w * (ma.getX(i) - pos[i * 3]), v.y + w * (ma.getY(i) - pos[i * 3 + 1]), v.z + w * (ma.getZ(i) - pos[i * 3 + 2])); }
        v.applyMatrix4(blend(i)); posed[k * 3] = v.x; posed[k * 3 + 1] = v.y; posed[k * 3 + 2] = v.z;
      }
      // posed normals, from her posed triangles (which way faces out: most agree with her own normals turned)
      const nrmOf = (tri: number[]) => {
        const acc = new Float64Array(K * 3);
        for (let t = 0; t < tri.length; t += 3) {
          const ka = key[tri[t]], kb = key[tri[t + 1]], kc = key[tri[t + 2]];
          a.set(posed[ka * 3], posed[ka * 3 + 1], posed[ka * 3 + 2]); b.set(posed[kb * 3], posed[kb * 3 + 1], posed[kb * 3 + 2]).sub(a); c.set(posed[kc * 3], posed[kc * 3 + 1], posed[kc * 3 + 2]).sub(a); b.cross(c);
          for (const k of [ka, kb, kc]) { acc[k * 3] += b.x; acc[k * 3 + 1] += b.y; acc[k * 3 + 2] += b.z; }
        }
        return acc;
      };
      const move = new Float64Array(K * 3), touched = new Uint8Array(K);
      stats.inside = []; stats.deepestCm = [];
      for (const s of sides) {
        const N = nrmOf(s.tris);
        // which way round her triangles wind (most posed normals agree with her own, turned by her bones)
        let agree = 0; const m3 = new THREE.Matrix3();
        for (let q = 0; q < s.pts.length; q += 7) { const i = s.pts[q], k = key[i]; m3.getNormalMatrix(blend(i)); a.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(m3); agree += Math.sign(a.x * N[k * 3] + a.y * N[k * 3 + 1] + a.z * N[k * 3 + 2]); }
        const wind = agree >= 0 ? 1 : -1;
        for (let k = 0; k < K; k++) { const l = Math.hypot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]) || 1; N[k * 3] *= wind / l; N[k * 3 + 1] *= wind / l; N[k * 3 + 2] *= wind / l; }
        // each side's welded points, in a grid of `near` cells
        const cell = C.near * perMetre, grids = [new Map<string, number[]>(), new Map<string, number[]>()], gk = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
        const seen = new Uint8Array(K), sideK = new Int8Array(K);
        s.pts.forEach((i, q) => { const k = key[i]; if (seen[k]) return; seen[k] = 1; sideK[k] = s.side[q]; if (!s.side[q]) return; const G = grids[s.side[q] > 0 ? 0 : 1], kk = gk(posed[k * 3], posed[k * 3 + 1], posed[k * 3 + 2]); (G.get(kk) ?? G.set(kk, []).get(kk)!).push(k); });
        let inside = 0, deepest = 0;
        const half = (C.gap / 2) * perMetre, near2 = (C.near * perMetre) ** 2;
        for (let k = 0; k < K; k++) {
          if (!seen[k] || !sideK[k]) continue;
          // the other side's nearest point
          const G = grids[sideK[k] > 0 ? 1 : 0], x = posed[k * 3], y = posed[k * 3 + 1], z = posed[k * 3 + 2], cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
          let best = -1, bd = near2;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const l = G.get(`${cx + dx},${cy + dy},${cz + dz}`); if (l) for (const o of l) { const d = (posed[o * 3] - x) ** 2 + (posed[o * 3 + 1] - y) ** 2 + (posed[o * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = o; } } }
          if (best < 0) continue;
          // how far out of the other's skin it stands (negative: inside it)
          const h = (x - posed[best * 3]) * N[best * 3] + (y - posed[best * 3 + 1]) * N[best * 3 + 1] + (z - posed[best * 3 + 2]) * N[best * 3 + 2];
          if (h >= 2 * half) continue;
          // (and only facing it: the other's skin there and its own face each other)
          if (N[k * 3] * N[best * 3] + N[k * 3 + 1] * N[best * 3 + 1] + N[k * 3 + 2] * N[best * 3 + 2] > 0) continue;
          if (h < 0) { inside++; deepest = Math.max(deepest, -h); }
          const d = (2 * half - h) / 2;
          move[k * 3] += N[best * 3] * d; move[k * 3 + 1] += N[best * 3 + 1] * d; move[k * 3 + 2] += N[best * 3 + 2] * d; touched[k] = 1;
        }
        stats.inside.push(inside); stats.deepestCm.push(+((deepest / perMetre) * 100).toFixed(2));
      }
      // THE VALVE: each side's pressed-in volume (each point's move into it, times its share of her skin's area) pushed
      // out round the contact along that side's own normal -- most just outside the contact's edge, none `bulgeReach` on
      stats.pressedCm3 = []; stats.bulgeMm = [];
      { const area = new Float64Array(K);
        for (const s of sides) for (let t = 0; t < s.tris.length; t += 3) {
          const ka = key[s.tris[t]], kb = key[s.tris[t + 1]], kc = key[s.tris[t + 2]];
          a.set(posed[ka * 3], posed[ka * 3 + 1], posed[ka * 3 + 2]); b.set(posed[kb * 3], posed[kb * 3 + 1], posed[kb * 3 + 2]).sub(a); c.set(posed[kc * 3], posed[kc * 3 + 1], posed[kc * 3 + 2]).sub(a);
          const ar = b.cross(c).length() / 6; area[ka] += ar; area[kb] += ar; area[kc] += ar;
        }
        const reach = C.bulgeReach * perMetre, most = C.bulgeMost * perMetre;
        for (const s of sides) {
          const N = nrmOf(s.tris);
          for (let k = 0; k < K; k++) { const l = Math.hypot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]) || 1; N[k * 3] /= l; N[k * 3 + 1] /= l; N[k * 3 + 2] /= l; }
          for (const sd of [1, -1]) {
            const seen = new Uint8Array(K), mine: number[] = [], contact: number[] = [];
            s.pts.forEach((i, q) => { const k = key[i]; if (seen[k] || s.side[q] !== sd) return; seen[k] = 1; mine.push(k); if (touched[k]) contact.push(k); });
            if (!contact.length) { stats.pressedCm3.push(0); stats.bulgeMm.push(0); continue; }
            let vol = 0; for (const k of contact) vol += Math.hypot(move[k * 3], move[k * 3 + 1], move[k * 3 + 2]) * area[k];
            // each of this side's points: how far from the contact (posed), and its share of the bulge
            const wts = new Float64Array(mine.length); let wsum = 0;
            mine.forEach((k, q) => {
              if (touched[k]) return;
              let bd = Infinity; for (const o of contact) { const d = (posed[o * 3] - posed[k * 3]) ** 2 + (posed[o * 3 + 1] - posed[k * 3 + 1]) ** 2 + (posed[o * 3 + 2] - posed[k * 3 + 2]) ** 2; if (d < bd) bd = d; }
              const t = Math.sqrt(bd) / reach; if (t >= 1) return;
              // (rising over the first fifth, then easing away: a soft roll, not a ridge)
              const w = Math.min(1, t / 0.2) * (1 - t) * (1 - t); wts[q] = w; wsum += w * area[k];
            });
            const h0 = wsum > 0 ? Math.min(most, (C.bulgeShare * vol) / wsum) : 0;
            mine.forEach((k, q) => { if (!wts[q]) return; const h = h0 * wts[q]; move[k * 3] += N[k * 3] * h; move[k * 3 + 1] += N[k * 3 + 1] * h; move[k * 3 + 2] += N[k * 3 + 2] * h; });
            stats.pressedCm3.push(+(vol / perMetre ** 3 * 1e6).toFixed(1)); stats.bulgeMm.push(+(h0 / perMetre * 1000).toFixed(1));
          }
        } }
      // spread round its neighbours (never less than it was where it was asked for)
      const sp = new Float64Array(K * 3);
      for (let pass = 0; pass < C.spread; pass++) {
        sp.set(move);
        for (let k = 0; k < K; k++) {
          const nb = nbr[k]; if (!nb.size) continue;
          let mx = 0, my = 0, mz = 0; for (const o of nb) { mx += move[o * 3]; my += move[o * 3 + 1]; mz += move[o * 3 + 2]; }
          mx /= nb.size; my /= nb.size; mz /= nb.size;
          const r = C.spreadRate;
          let nx = move[k * 3] + (mx - move[k * 3]) * r, ny = move[k * 3 + 1] + (my - move[k * 3 + 1]) * r, nz = move[k * 3 + 2] + (mz - move[k * 3 + 2]) * r;
          if (touched[k]) { const was = Math.hypot(move[k * 3], move[k * 3 + 1], move[k * 3 + 2]), now = Math.hypot(nx, ny, nz); if (now < was && now > 1e-12) { nx *= was / now; ny *= was / now; nz *= was / now; } }
          sp[k * 3] = nx; sp[k * 3 + 1] = ny; sp[k * 3 + 2] = nz;
        }
        move.set(sp);
      }
      // the moved surface's normals, for her normals
      const after = Float64Array.from(posed); for (let k = 0; k < K * 3; k++) after[k] += move[k];
      const keep = posed; const N2acc = new Float64Array(K * 3);
      posed.set(after);
      for (const s of sides) { const N = nrmOf(s.tris); for (let k = 0; k < K * 3; k++) N2acc[k] += N[k]; }
      posed.set(keep.map((x, q) => x - move[q]));
      const idx: number[] = [], dp: number[] = [], dn: number[] = [], Li = new THREE.Matrix3(), m3 = new THREE.Matrix3();
      let moved = 0;
      for (const s of sides) for (const i of s.pts) {
        const k = key[i], len = Math.hypot(move[k * 3], move[k * 3 + 1], move[k * 3 + 2]);
        if (len < 1e-5 * perMetre) continue;
        const B = blend(i); Li.setFromMatrix4(B).invert();
        a.set(move[k * 3], move[k * 3 + 1], move[k * 3 + 2]).applyMatrix3(Li);
        // her normal: the moved surface's, turned back to rest; as a change to her own
        m3.getNormalMatrix(B); const own = b.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(m3).normalize();
        c.set(N2acc[k * 3], N2acc[k * 3 + 1], N2acc[k * 3 + 2]);
        if (c.lengthSq() < 1e-20 || c.dot(own) < 0) c.copy(own);
        c.normalize();
        const back = new THREE.Matrix3().copy(m3).invert(); c.applyMatrix3(back).normalize();
        const ownRest = v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).normalize();
        idx.push(i); dp.push(a.x, a.y, a.z); dn.push(c.x - ownRest.x, c.y - ownRest.y, c.z - ownRest.z); moved++;
      }
      stats.moved = moved;
      return { index: Uint32Array.from(idx), pos: Float32Array.from(dp), nrm: Float32Array.from(dn) };
    },
  };
}
