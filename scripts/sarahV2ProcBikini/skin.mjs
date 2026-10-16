// Her skin, as a surface the trim can be laid on: metres, bind pose, with landmarks found on it.
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { closestBary, vertexNormals } from '../fitMeshyBikini.mjs';
import { V } from './ribbon.mjs';
const { sub, add, scl, dot, len, nrm, cross } = V;
const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
export const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const invert = (m) => { const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e); const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1]; r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]); return r; };
export const read = (A) => { const n = A.getCount(), s = A.getElementSize(), o = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) o[i * s + c] = v[c]; } return o; };
export async function loadSkin(file) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file), skin = doc.getRoot().listSkins()[0], J = skin.listJoints();
  const T = mul(Array.from(J[0].getWorldMatrix()), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T), tS = Math.hypot(T[0], T[1], T[2]);
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras().targetNames, body = mesh.listPrimitives()[0];
  const raw = read(body.getAttribute('POSITION')), n = raw.length / 3, P = new Float32Array(raw.length); for (let i = 0; i < n; i += 1) P.set(apply(T, [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]], 1), i * 3);
  const I = body.getIndices().getArray(), N = vertexNormals(P, I);
  const BJ = read(body.getAttribute('JOINTS_0')), BW = read(body.getAttribute('WEIGHTS_0'));
  const tgtLocal = body.listTargets().map((t) => read(t.getAttribute('POSITION'))), nrmLocal = body.listTargets().map((t) => (t.getAttribute('NORMAL') ? read(t.getAttribute('NORMAL')) : null));
  const deltaM = (k) => { const d = tgtLocal[k], o = new Float32Array(d.length); for (let i = 0; i < n; i += 1) o.set(apply(T, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0), i * 3); return o; };
  const VP = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  // spatial grid of triangles
  const CELL = 0.01, cells = new Map();
  for (let t = 0; t < I.length; t += 3) { const lo = [0, 1, 2].map((k) => Math.min(P[I[t] * 3 + k], P[I[t + 1] * 3 + k], P[I[t + 2] * 3 + k])), hi = [0, 1, 2].map((k) => Math.max(P[I[t] * 3 + k], P[I[t + 1] * 3 + k], P[I[t + 2] * 3 + k])); for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x += 1) for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y += 1) for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z += 1) { const k = `${x},${y},${z}`; (cells.get(k) ?? cells.set(k, []).get(k)).push(t); } }
  // arms are not under any garment (a hanging arm passes close to the breast's side)
  const jw = J.map((j) => j.getWorldTranslation()); const armJ = new Set(J.map((_, k) => k).filter((k) => Math.abs(jw[k][0]) > 0.13 && jw[k][1] > 0.6));
  const arm = (i) => { let a = 0; for (let c = 0; c < 4; c += 1) if (armJ.has(BJ[i * 4 + c])) a += BW[i * 4 + c]; return a; };
  const armTri = new Uint8Array(I.length / 3); for (let t = 0; t < I.length; t += 3) armTri[t / 3] = arm(I[t]) + arm(I[t + 1]) + arm(I[t + 2]) > 1.5 ? 1 : 0;
  const nearest = (p, R = 3) => { let best = null; const c = p.map((v) => Math.floor(v / CELL));
    for (let r = 0; r <= R; r += 1) { if (best && Math.sqrt(best.d2) < r * CELL) break; for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) for (let k = -r; k <= r; k += 1) { if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue; for (const t of cells.get(`${c[0] + i},${c[1] + j},${c[2] + k}`) ?? []) { if (armTri[t / 3]) continue; const a = I[t], b = I[t + 1], cc = I[t + 2], bc = closestBary(p, VP(a), VP(b), VP(cc)), q = [0, 1, 2].map((d) => bc[0] * P[a * 3 + d] + bc[1] * P[b * 3 + d] + bc[2] * P[cc * 3 + d]), d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (!best || d2 < best.d2) best = { d2, q, tri: [a, b, cc], bc }; } } }
    if (!best) return null; const nn = nrm([0, 1, 2].map((d) => best.bc[0] * N[best.tri[0] * 3 + d] + best.bc[1] * N[best.tri[1] * 3 + d] + best.bc[2] * N[best.tri[2] * 3 + d]));
    return { ...best, n: nn, dist: Math.sign(dot(sub(p, best.q), nn) || 1) * Math.sqrt(best.d2) }; };
  // the body cut by the vertical plane x = xs, as chained polylines (the profile of her front there)
  const slice = (xs, y0 = 0.9, y1 = 1.5) => {
    const segs = [];
    for (let t = 0; t < I.length; t += 3) { if (armTri[t / 3]) continue; const v = [I[t], I[t + 1], I[t + 2]], s = v.map((i) => P[i * 3] - xs); if ((s[0] > 0 && s[1] > 0 && s[2] > 0) || (s[0] < 0 && s[1] < 0 && s[2] < 0)) continue;
      const pts = []; for (let e = 0; e < 3; e += 1) { const a = v[e], b = v[(e + 1) % 3], sa = s[e], sb = s[(e + 1) % 3]; if ((sa > 0) !== (sb > 0)) { const u = sa / (sa - sb); pts.push({ key: a < b ? `${a},${b}` : `${b},${a}`, p: add(VP(a), scl(sub(VP(b), VP(a)), u)) }); } }
      if (pts.length === 2 && pts[0].p[1] > y0 && pts[0].p[1] < y1) segs.push(pts); }
    const adj = new Map(), pt = new Map(); for (const [a, b] of segs) { pt.set(a.key, a.p); pt.set(b.key, b.p); (adj.get(a.key) ?? adj.set(a.key, []).get(a.key)).push(b.key); (adj.get(b.key) ?? adj.set(b.key, []).get(b.key)).push(a.key); }
    const seen = new Set(), chains = [];
    for (const k of adj.keys()) { if (seen.has(k)) continue; // walk both ways
      const walk = (start, from) => { const out = []; let prev = from, cur = start; while (cur && !seen.has(cur)) { seen.add(cur); out.push(pt.get(cur)); const nx = (adj.get(cur) ?? []).find((x) => x !== prev && !seen.has(x)); prev = cur; cur = nx; } return out; };
      seen.add(k); const ns = adj.get(k) ?? []; const a = ns[0] ? walk(ns[0], k) : [], b = ns[1] ? walk(ns[1], k) : []; chains.push([...a.reverse(), pt.get(k), ...b]); }
    return chains.filter((c) => c.length > 20);
  };
  return { io, doc, T, Ti, tS, names, mesh, body, P, I, N, n, BJ, BW, tgtLocal, nrmLocal, deltaM, nearest, slice, VP, armTri };
}

/**
 * Her breast's landmarks on one side (sg = +1 her left, -1 her right): the TIP (forward-most point),
 * and the GROOVE under it, found on vertical slices: each slice's front profile is walked down from
 * the breast, and the groove is where that profile turns most sharply concave, from the breast's
 * underside onto her chest. Returns the tip and a groove point per slice x.
 */
export function landmarks(skin, sg, { tipBox = [0.06, 0.15, 1.21, 1.36], xs = null } = {}) {
  const { P, n } = skin; let tip = null;
  for (let i = 0; i < n; i += 1) { const x = sg * P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (x > tipBox[0] && x < tipBox[1] && y > tipBox[2] && y < tipBox[3] && (!tip || z > tip[2])) tip = [P[i * 3], y, z]; }
  const groove = [];
  for (const ax of xs ?? [0.03, 0.045, 0.06, 0.075, 0.09, 0.105, 0.12, 0.135]) {
    const x = sg * ax, chains = skin.slice(x);
    // the chain of her front: the one reaching furthest forward near the breast's height
    let best = null, bz = -Infinity; for (const c of chains) for (const p of c) if (p[1] > tip[1] - 0.06 && p[1] < tip[1] + 0.03 && p[2] > bz) { bz = p[2]; best = c; }
    if (!best) continue;
    // start at its forward-most point near the tip's height, walk the way y goes down
    let s = 0; for (let k = 0; k < best.length; k += 1) if (best[k][1] > tip[1] - 0.06 && best[k][1] < tip[1] + 0.03 && best[k][2] > best[s][2] - 1e-9 && (best[s][1] < tip[1] - 0.06 || best[k][2] >= best[s][2])) s = k;
    const dir = (best[Math.min(best.length - 1, s + 3)][1] < best[s][1]) ? 1 : -1, walk = []; let acc = 0;
    for (let k = s; k >= 0 && k < best.length; k += dir) { if (walk.length) acc += len(sub(best[k], walk[walk.length - 1])); if (acc > 0.16) break; walk.push(best[k]); }
    // even arc-length samples, then the turning of the profile (in the y-z plane)
    const step = 0.0015, ev = [walk[0]]; let carry = 0; for (let k = 1; k < walk.length; k += 1) { const a = walk[k - 1], b = walk[k], d = len(sub(b, a)); let t = step - carry; while (t <= d) { ev.push(add(a, scl(sub(b, a), t / d))); t += step; } carry = d - (t - step); }
    const ang = []; for (let k = 1; k < ev.length - 1; k += 1) ang.push(Math.atan2(ev[k + 1][1] - ev[k - 1][1], ev[k + 1][2] - ev[k - 1][2]));
    // unwrap and smooth
    for (let k = 1; k < ang.length; k += 1) { while (ang[k] - ang[k - 1] > Math.PI) ang[k] -= 2 * Math.PI; while (ang[k] - ang[k - 1] < -Math.PI) ang[k] += 2 * Math.PI; }
    const sm = ang.map((_, k) => { let a = 0, w = 0; for (let j = -4; j <= 4; j += 1) { const q = ang[k + j]; if (q === undefined) continue; const g = Math.exp(-(j * j) / 8); a += q * g; w += g; } return a / w; });
    // concave turning = the profile swinging back toward the front (+z) as it leaves the underside
    let bk = -1, bv = 0; for (let k = 4; k < sm.length - 4; k += 1) { if (ev[k + 1][1] > tip[1] - 0.02) continue; const kap = (sm[k + 3] - sm[k - 3]); const conc = -dir * 0 + kap; if (Math.abs(kap) > Math.abs(bv) && Math.sign(kap) === Math.sign(groove.sign ?? kap)) { bv = kap; bk = k; } }
    groove.push({ x, p: bk >= 0 ? ev[bk + 1] : null, turn: bv, walk: ev });
  }
  return { tip, groove };
}

/**
 * THE GROOVE (inframammary fold), found on the skin itself: for each column across the breast, the
 * skin point below the tip that is most CONCAVE (her surface curving in hardest, where the breast's
 * underside turns onto the chest), searched only where the breast's own shapes are fading out (the
 * edge of the breast). Returns one point per column, smoothed across the columns.
 */
export function grooveCurve(skin, sg, tip, { cols = 15, x0 = 0.035, x1 = 0.14, growName = 'breastGrow' } = {}) {
  const { P, N, I, n } = skin;
  if (!skin.conc) { // concavity per vertex: (neighbour mean - vertex) . normal, smoothed twice
    const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e += 1) { const a = I[t + e], b = I[t + (e + 1) % 3]; nb[a].add(b); nb[b].add(a); }
    let c = new Float32Array(n); for (let i = 0; i < n; i += 1) { const m = [0, 0, 0]; for (const j of nb[i]) for (let d = 0; d < 3; d += 1) m[d] += P[j * 3 + d] / nb[i].size; c[i] = (m[0] - P[i * 3]) * N[i * 3] + (m[1] - P[i * 3 + 1]) * N[i * 3 + 1] + (m[2] - P[i * 3 + 2]) * N[i * 3 + 2]; }
    for (let r = 0; r < 6; r += 1) { const c2 = new Float32Array(n); for (let i = 0; i < n; i += 1) { let s = c[i], k = 1; for (const j of nb[i]) { s += c[j]; k += 1; } c2[i] = s / k; } c = c2; }
    skin.conc = c; skin.nb = nb;
    const g = skin.deltaM(skin.names.indexOf(growName)); let gm = 0; const gv = new Float32Array(n); for (let i = 0; i < n; i += 1) { gv[i] = Math.hypot(g[i * 3], g[i * 3 + 1], g[i * 3 + 2]); gm = Math.max(gm, gv[i]); } for (let i = 0; i < n; i += 1) gv[i] /= gm; skin.grow = gv;
  }
  const pts = [];
  for (let k = 0; k < cols; k += 1) {
    const ax = x0 + (x1 - x0) * (k / (cols - 1)), x = sg * ax;
    let best = -1, bv = -Infinity;
    for (let i = 0; i < n; i += 1) { if (Math.abs(P[i * 3] - x) > 0.004) continue; const y = P[i * 3 + 1]; if (y > tip[1] - 0.03 || y < tip[1] - 0.11) continue; if (P[i * 3 + 2] < tip[2] - 0.09) continue; if (N[i * 3 + 2] < -0.4) continue; const v = skin.conc[i]; if (v > bv) { bv = v; best = i; } }
    if (best >= 0) pts.push({ x, p: [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]], conc: bv, grow: skin.grow[best] });
  }
  return pts;
}
