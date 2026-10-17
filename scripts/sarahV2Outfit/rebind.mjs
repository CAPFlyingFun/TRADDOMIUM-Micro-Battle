// Garment cloth re-attached to her skin like the procedural bikini: pushed out to a minimum
// clearance at rest, then every vertex bound to the skin under it (bones and every body shape),
// so the cloth keeps that clearance at every size. Its growClothes NORMAL shapes are kept.
import { loadSkin, apply } from '../../scripts/sarahV2ProcBikini/skin.mjs';
import { binder } from '../../scripts/sarahV2ProcBikini/bind.mjs';
const [src, out, ...pairs] = process.argv.slice(2);   // pairs: name:clearM
const s = await loadSkin(src); const bind = binder(s); const doc = s.doc, buf = doc.getRoot().listBuffers()[0];
for (const pr of pairs) {
  const [name, cl, overName, extra] = pr.split(':'); const C0 = Number(cl);
  // over another garment (the tank over the leggings' panel), the cloth stands that much further off
  let overGrid = null;
  if (overName) { const op = s.mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === overName); const OP = op.getAttribute('POSITION'), ov = []; overGrid = new Map();
    for (let i = 0; i < OP.getCount(); i += 1) { OP.getElement(i, ov); const w = apply(s.T, ov, 1); const k = w.map((x) => Math.floor(x / 0.02)).join(','); if (!overGrid.has(k)) overGrid.set(k, []); overGrid.get(k).push(w); } }
  const over = (w) => { if (!overGrid) return false; const c = w.map((x) => Math.floor(x / 0.02)); for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) for (const q of overGrid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) if (Math.hypot(q[0] - w[0], q[1] - w[1], q[2] - w[2]) < 0.025) return true; return false; };
  let C = C0;
  const prim = s.mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === name);
  const P = prim.getAttribute('POSITION'), n = P.getCount(), v = []; const pts = [];
  let pushed = 0;
  // where it stands over another garment, smoothly (a yes/no test stepped the cloth by `extra`)
  const overW = (w) => { if (!overGrid) return 0; let d = Infinity; const c = w.map((x) => Math.floor(x / 0.02)); for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) for (const q of overGrid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) d = Math.min(d, Math.hypot(q[0] - w[0], q[1] - w[1], q[2] - w[2])); const t = Math.min(1, Math.max(0, (0.03 - d) / 0.02)); return t * t * (3 - 2 * t); };
  const raw = []; for (let i = 0; i < n; i += 1) { P.getElement(i, v); raw.push(apply(s.T, v, 1)); }
  // THE PUSH IS A FIELD, smoothed over the cloth before it is applied: each point's shortfall from
  // clearance along its skin's normal, averaged with its neighbours (welded across seams), so a crease
  // (where the two sides' normals face apart) and a hem cannot tear or wave
  const keyW = new Map(), repW = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = raw[i].map((x) => Math.round(x * 1e5)).join(','); if (!keyW.has(k)) keyW.set(k, i); repW[i] = keyW.get(k); }
  const IW = prim.getIndices().getArray(), nbW = new Map(); for (let t = 0; t < IW.length; t += 3) for (let e = 0; e < 3; e += 1) { const a = repW[IW[t + e]], b2 = repW[IW[t + (e + 1) % 3]]; if (a === b2) continue; if (!nbW.has(a)) nbW.set(a, new Set()); if (!nbW.has(b2)) nbW.set(b2, new Set()); nbW.get(a).add(b2); nbW.get(b2).add(a); }
  const repsW = [...new Set(repW)], cur = raw.map((w) => w.slice());
  const pushRound = (scale) => {
    let F = new Float64Array(n * 3);
    for (const a of repsW) { const w = cur[a], q = s.nearest(w); if (!q) continue; const Ci = C0 + overW(w) * Number(extra || 0); const sd = (w[0] - q.q[0]) * q.n[0] + (w[1] - q.q[1]) * q.n[1] + (w[2] - q.q[2]) * q.n[2]; if (sd < Ci) for (let e = 0; e < 3; e += 1) F[a * 3 + e] = q.n[e] * (Ci - sd); }
    for (let r = 0; r < 25; r += 1) { const G = Float64Array.from(F); for (const a of repsW) { const ns = nbW.get(a); if (!ns) continue; const m = [0, 0, 0]; for (const b2 of ns) for (let e = 0; e < 3; e += 1) m[e] += F[b2 * 3 + e]; for (let e = 0; e < 3; e += 1) G[a * 3 + e] = 0.5 * F[a * 3 + e] + 0.5 * m[e] / ns.size; } F = G; }
    let moved = 0; for (const a of repsW) { if (Math.hypot(F[a * 3], F[a * 3 + 1], F[a * 3 + 2]) > 1e-5) moved += 1; for (let e = 0; e < 3; e += 1) cur[a][e] += F[a * 3 + e] * scale; }
    return moved; };
  pushed = pushRound(1.6); pushRound(1.6); pushRound(1);
  // NO FOLDS AT REST: growing cloth off skin along its normals folds it wherever a crease is tighter than
  // the clearance (crotch, groin, under the seat): some 3,000 edges whose two triangles face apart. Those
  // regions are relaxed (positions, not offsets) and pushed back out to clearance until none remain.
  const nFw = IW.length / 3, efw = new Map();
  for (let f = 0; f < nFw; f += 1) for (let e = 0; e < 3; e += 1) { const a = repW[IW[f * 3 + e]], b2 = repW[IW[f * 3 + (e + 1) % 3]]; if (a === b2) continue; const k = a < b2 ? `${a},${b2}` : `${b2},${a}`; if (!efw.has(k)) efw.set(k, []); efw.get(k).push(f); }
  const fpairs = [...efw.values()].filter((x) => x.length === 2);
  const fnorm = (f) => { const g = (i) => cur[repW[IW[f * 3 + i]]]; const x = g(0), y = g(1), z = g(2); const u = [y[0] - x[0], y[1] - x[1], y[2] - x[2]], v2 = [z[0] - x[0], z[1] - x[1], z[2] - x[2]]; const c = [u[1] * v2[2] - u[2] * v2[1], u[2] * v2[0] - u[0] * v2[2], u[0] * v2[1] - u[1] * v2[0]]; const l = Math.hypot(...c); return l ? c.map((q) => q / l) : null; };
  const folds = () => { const N = Array.from({ length: nFw }, (_, f) => fnorm(f)); const vs = new Set(); let c = 0; for (const [f, g] of fpairs) { const a = N[f], b2 = N[g]; if (!a || !b2 || a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2] < 0) { c += 1; for (const h of [f, g]) for (let e = 0; e < 3; e += 1) vs.add(repW[IW[h * 3 + e]]); } } return { c, vs }; };
  let fd = folds(); const fold0 = fd.c; let fit = 0;
  for (; fd.c && fit < 40; fit += 1) { const wv = new Map(); for (const a of fd.vs) wv.set(a, 1); let ring = [...fd.vs];
    for (let r = 1; r <= 4; r += 1) { const nx = []; for (const a of ring) for (const b2 of nbW.get(a) ?? []) if (!wv.has(b2)) { wv.set(b2, 1 - r / 5); nx.push(b2); } ring = nx; }
    for (let pass = 0; pass < 10; pass += 1) { const upd = []; for (const [a, wa] of wv) { const ns = nbW.get(a); if (!ns || ns.size < 3) continue; const m = [0, 0, 0]; for (const b2 of ns) for (let e = 0; e < 3; e += 1) m[e] += cur[b2][e] / ns.size; upd.push([a, cur[a].map((x, e) => x + 0.5 * wa * (m[e] - x))]); } for (const [a, x] of upd) cur[a] = x; }
    pushRound(1); fd = folds(); }
  console.log(`${name}: ${fold0} folded edges at rest -> ${fd.c} (${fit} rounds)`);
  // SMALL BUMPS ARE NOT INFLATED. Cloth held a fixed clearance off her grows every small convex feature
  // by that clearance on every side: her navel under the tank (12-16 mm off her where it lies over the
  // leggings) read 2.5-3 cm wider than it is, her nipples about 1.5 cm. Real fabric softens them instead.
  // Where the cloth stands proud of its own smoothed surface it is drawn in toward it, never closer to her
  // than DEFLATE_MIN (and, over another garment, that garment's clearance more), so a bump keeps her size.
  // OFF by default: measured on 2026-10-17 it made the tank's navel bump LOWER but WIDER (42 -> 56 mm at a quarter of its
  // height), the opposite of the point. Kept for whoever tries the next idea (offset along a broadly smoothed normal).
  const DMIN = Object.fromEntries((process.env.DEFLATE_MIN ?? '').split(',').filter(Boolean).map((kv) => { const [k, v2] = kv.split('='); return [k, Number(v2)]; }));
  if (DMIN[name] !== undefined) { let moved = 0, most = 0;
    for (let it = 0; it < 3; it += 1) {
      let Sm = new Map(repsW.map((a) => [a, cur[a].slice()]));
      for (let r = 0; r < 40; r += 1) { const nx = new Map(); for (const a of repsW) { const ns = nbW.get(a); const x = Sm.get(a); if (!ns || ns.size < 3) { nx.set(a, x); continue; } const m = [0, 0, 0]; for (const b2 of ns) { const y = Sm.get(b2); for (let e = 0; e < 3; e += 1) m[e] += y[e] / ns.size; } nx.set(a, x.map((v2, e) => 0.5 * v2 + 0.5 * m[e])); } Sm = nx; }
      for (const a of repsW) { const ns = nbW.get(a); if (!ns || ns.size < 3) continue; const w = cur[a], q = s.nearest(w); if (!q) continue;
        const h = (w[0] - q.q[0]) * q.n[0] + (w[1] - q.q[1]) * q.n[1] + (w[2] - q.q[2]) * q.n[2]; const S2 = Sm.get(a);
        const bump = (w[0] - S2[0]) * q.n[0] + (w[1] - S2[1]) * q.n[1] + (w[2] - S2[2]) * q.n[2]; if (bump <= 0) continue;
        const floor = DMIN[name] + overW(w) * 0.0015; const mv = Math.min(bump * 0.8, h - floor); if (mv <= 0) continue;
        for (let e = 0; e < 3; e += 1) cur[a][e] -= q.n[e] * mv; if (it === 0) moved += 1; most = Math.max(most, mv); } }
    console.log(`${name}: ${moved} points over small bumps drawn in toward her (most ${(most * 1000).toFixed(1)} mm), never under ${(DMIN[name] * 1000).toFixed(1)} mm; ${folds().c} folded edges after`); }
  for (let i = 0; i < n; i += 1) pts.push(cur[repW[i]].slice());
  const b = bind(pts);
  // A SPAN MOVES WITH THE CLOTH AROUND IT: where the cloth stands off her (bridging under the bust,
  // across the cleavage), its shape offsets are eased toward its neighbours', weighted by how far it
  // stands off, so a growing breast carries the span over the fold instead of tucking it in.
  const gap = pts.map((w) => { const q = s.nearest(w); return q ? (w[0] - q.q[0]) * q.n[0] + (w[1] - q.q[1]) * q.n[1] + (w[2] - q.q[2]) * q.n[2] : 0; });
  const ss = (a, c, x) => { const t = Math.min(1, Math.max(0, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  const wt = gap.map((g) => ss(C + 0.006, C + 0.02, g));
  const I = prim.getIndices().getArray(), nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e += 1) { nb[I[t + e]].add(I[t + (e + 1) % 3]); nb[I[t + (e + 1) % 3]].add(I[t + e]); }
  { const h = new Map(); for (let i = 0; i < n; i += 1) { const k = pts[i].map((x) => Math.round(x * 1e5)).join(','); if (h.has(k)) { nb[i].add(h.get(k)); nb[h.get(k)].add(i); } else h.set(k, i); } }
  const NA = prim.getAttribute('NORMAL'), clothN = new Float32Array(n * 3), nv = []; for (let i = 0; i < n; i += 1) { NA.getElement(i, nv); clothN.set(nv, i * 3); }
  const nbl = nb.map((x) => [...x]); const spans = wt.filter((x) => x > 0).length;
  const ROUNDS = Number(process.env.SPAN_ROUNDS ?? 120);
  if (spans) for (const T of b.T) { if (!T.some((x) => x !== 0)) continue; let d = Float64Array.from(T);
    for (let r = 0; r < ROUNDS; r += 1) { const nx = Float64Array.from(d); for (let i = 0; i < n; i += 1) { if (!wt[i] || !nbl[i].length) continue; for (let e = 0; e < 3; e += 1) { let m = 0; for (const j of nbl[i]) m += d[j * 3 + e]; nx[i * 3 + e] = (1 - wt[i]) * T[i * 3 + e] + wt[i] * (m / nbl[i].length); } } d = nx; }
    // averaging may carry a span OUT over a fold, never IN toward her (or the cloth beneath)
    for (let i = 0; i < n; i += 1) { if (!wt[i]) continue; const nl = clothN.subarray(i * 3, i * 3 + 3); if (!nl[0] && !nl[1] && !nl[2]) continue; const l = Math.hypot(...nl) || 1;
      let dd = 0; for (let e = 0; e < 3; e += 1) dd += (d[i * 3 + e] - T[i * 3 + e]) * nl[e] / l; if (dd < 0) for (let e = 0; e < 3; e += 1) d[i * 3 + e] -= dd * nl[e] / l; }
    T.set(Float32Array.from(d)); }
  console.log(`${name}: ${spans} vertices stand off her and move with the cloth around them`);
  const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  prim.setAttribute('POSITION', acc('VEC3', b.pos)).setAttribute('JOINTS_0', acc('VEC4', b.J)).setAttribute('WEIGHTS_0', acc('VEC4', b.W));
  prim.listTargets().forEach((tg, k) => tg.setAttribute('POSITION', acc('VEC3', b.T[k])));
  console.log(`${name}: ${n} vertices, ${pushed} pushed out to ${C * 1000} mm, rebound to her skin with ${b.T.length} shapes`);
}
await s.io.write(out, doc); console.log('written', out);
