// Bind any generated geometry to her skin: each point rides the skin under it (bone weights and
// every body shape, the point's height off the skin carried along the skin normal's turn, bounded).
import { apply } from './skin.mjs';
import { V } from './ribbon.mjs';
const { sub, dot } = V;
const CARRY = 0.006, SHIFT = 0.004;
export function binder(skin) {
  const nt = skin.tgtLocal.length, D = [], DN = [];
  for (let t = 0; t < nt; t += 1) { D.push(skin.deltaM(t)); const nl = skin.nrmLocal[t]; if (!nl) { DN.push(null); continue; } const o = new Float32Array(nl.length); for (let i = 0; i < skin.n; i += 1) o.set(apply(skin.T, [nl[i * 3], nl[i * 3 + 1], nl[i * 3 + 2]], 0).map((v) => v / skin.tS), i * 3); DN.push(o); }
  return (points, { at = null } = {}) => {
    const n = points.length, pos = new Float32Array(n * 3), J = new Uint16Array(n * 4), W = new Float32Array(n * 4), T = Array.from({ length: nt }, () => new Float32Array(n * 3));
    points.forEach((p, i) => {
      const q = skin.nearest(at ? at[i] : p); pos.set(apply(skin.Ti, p, 1), i * 3); if (!q) return;
      const acc = new Map(); for (let k = 0; k < 3; k += 1) for (let c = 0; c < 4; c += 1) { const j = skin.BJ[q.tri[k] * 4 + c], w = skin.BW[q.tri[k] * 4 + c] * q.bc[k]; if (w > 0) acc.set(j, (acc.get(j) || 0) + w); }
      const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, w]) => a + w, 0); top.forEach(([j, w], c) => { J[i * 4 + c] = j; W[i * 4 + c] = w / sum; });
      const off = Math.max(0, dot(sub(p, q.q), q.n));
      for (let t = 0; t < nt; t += 1) { const o = [0, 0, 0], sh = [0, 0, 0]; for (let k = 0; k < 3; k += 1) for (let e = 0; e < 3; e += 1) { o[e] += q.bc[k] * D[t][q.tri[k] * 3 + e]; if (DN[t]) sh[e] += q.bc[k] * Math.min(off, CARRY) * DN[t][q.tri[k] * 3 + e]; } const l = Math.hypot(...sh); for (let e = 0; e < 3; e += 1) o[e] += l > SHIFT ? (sh[e] * SHIFT) / l : sh[e]; T[t].set(apply(skin.Ti, o, 0), i * 3); }
    });
    return { pos, J, W, T };
  };
}
/** Add a bound piece to her mesh as its own primitive (same morph targets as the body). */
export function addPiece(skin, bound, indices, material, normals = null) {
  const doc = skin.doc, buf = doc.getRoot().listBuffers()[0], acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  const prim = doc.createPrimitive().setMaterial(material).setIndices(acc('SCALAR', Uint32Array.from(indices)))
    .setAttribute('POSITION', acc('VEC3', bound.pos)).setAttribute('JOINTS_0', acc('VEC4', bound.J)).setAttribute('WEIGHTS_0', acc('VEC4', bound.W));
  if (normals) prim.setAttribute('NORMAL', acc('VEC3', normals));
  for (const t of bound.T) prim.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', acc('VEC3', t)));
  skin.mesh.addPrimitive(prim); return prim;
}

/**
 * A ribbon moves as ONE piece: each cross-section was bound to the skin under its own centre, and
 * where that skin changes hands (left breast, sternum, right breast; breast and chest across a fold)
 * neighbouring sections would be carried apart by a body shape or a bone. This blends each ring's
 * morph offsets and bone weights with its neighbours along the ribbon (`rounds` of 1-2-1 smoothing;
 * an open ribbon keeps its two end rings fixed, so it still meets what it is attached to), keeping
 * each vertex's small offset from its ring's mean.
 */
export function smoothAlong(bound, { ringSize, rings, closed = false, rounds = 20, centres = null, ends = null, start = null }) {
  const nV = bound.pos.length / 3, ringOf = new Int32Array(nV);
  for (let v = 0; v < nV; v += 1) { if (v < rings * ringSize) { ringOf[v] = Math.floor(v / ringSize); continue; }
    const c = centres[v], a = ends[0], b = ends[1]; const da = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), db = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]); ringOf[v] = da <= db ? 0 : rings - 1; }
  const cnt = new Float64Array(rings); for (let v = 0; v < nV; v += 1) cnt[ringOf[v]] += 1;
  // `start`: what ring 0 must do, taken from what it is attached to ({ T: [per target [x,y,z]], J, W }),
  // so the join moves as one; the smoothing then carries it into the ribbon's own motion
  const startMean = (mT, t) => { if (!start) return; for (let e = 0; e < 3; e += 1) mT[e] = start.T[t][e]; };
  const smooth = (arr, dim) => { let a = arr; for (let r = 0; r < rounds; r += 1) { const b = new Float64Array(a.length);
      for (let k = 0; k < rings; k += 1) { const fixed = !closed && (k === 0 || k === rings - 1); const p = closed ? (k - 1 + rings) % rings : Math.max(0, k - 1), q = closed ? (k + 1) % rings : Math.min(rings - 1, k + 1);
        for (let e = 0; e < dim; e += 1) b[k * dim + e] = fixed ? a[k * dim + e] : 0.25 * a[p * dim + e] + 0.5 * a[k * dim + e] + 0.25 * a[q * dim + e]; } a = b; } return a; };
  for (const T of bound.T) { const m = new Float64Array(rings * 3); for (let v = 0; v < nV; v += 1) for (let e = 0; e < 3; e += 1) m[ringOf[v] * 3 + e] += T[v * 3 + e] / cnt[ringOf[v]];
    const m0 = m.slice(); if (start) { const ti = bound.T.indexOf(T); for (let k = 0; k < Math.min(3, rings); k += 1) for (let e = 0; e < 3; e += 1) m[k * 3 + e] = start.T[ti][e]; }
    const s = smooth(m, 3); for (let v = 0; v < nV; v += 1) for (let e = 0; e < 3; e += 1) T[v * 3 + e] += s[ringOf[v] * 3 + e] - m0[ringOf[v] * 3 + e]; }
  // bone weights: a dense per-ring joint table, smoothed, then each vertex takes its ring's top four
  const joints = [...new Set(bound.J)]; const jx = new Map(joints.map((j, i) => [j, i])), nj = joints.length; const m = new Float64Array(rings * nj);
  for (let v = 0; v < nV; v += 1) for (let c = 0; c < 4; c += 1) { const w = bound.W[v * 4 + c]; if (w > 0) m[ringOf[v] * nj + jx.get(bound.J[v * 4 + c])] += w / cnt[ringOf[v]]; }
  if (start) for (let k = 0; k < Math.min(3, rings); k += 1) { for (let i = 0; i < nj; i += 1) m[k * nj + i] = 0; start.J.forEach((j, c) => { if (jx.has(j)) m[k * nj + jx.get(j)] += start.W[c]; }); }
  const s = smooth(m, nj);
  for (let v = 0; v < nV; v += 1) { const k = ringOf[v]; const top = joints.map((j, i) => [j, s[k * nj + i]]).sort((a, b) => b[1] - a[1]).slice(0, 4); const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
    top.forEach(([j, w], c) => { bound.J[v * 4 + c] = j; bound.W[v * 4 + c] = w / sum; }); }
  return bound;
}

/** What one ring of a bound ribbon does: its mean offset per body shape, and its four strongest bones. */
export function ringMotion(bound, ringSize, ring) {
  const T = bound.T.map((t) => { const o = [0, 0, 0]; for (let v = ring * ringSize; v < (ring + 1) * ringSize; v += 1) for (let e = 0; e < 3; e += 1) o[e] += t[v * 3 + e] / ringSize; return o; });
  const acc = new Map(); for (let v = ring * ringSize; v < (ring + 1) * ringSize; v += 1) for (let c = 0; c < 4; c += 1) { const j = bound.J[v * 4 + c], w = bound.W[v * 4 + c]; if (w > 0) acc.set(j, (acc.get(j) || 0) + w / ringSize); }
  const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, w]) => a + w, 0) || 1;
  return { T, J: top.map(([j]) => j), W: top.map(([, w]) => w / sum) };
}
