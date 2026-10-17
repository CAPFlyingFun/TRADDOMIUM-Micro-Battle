// A SKIN-TIGHT GARMENT MUST NOT COPY A FOLD. Her approved body turns some 1,700 triangles over in the
// groin crease at 0% belly (hidden in the fold on skin, but cloth bound to that skin shows its back
// faces there as dark tears). Per body shape: where the cloth's triangles turn more than 60 degrees
// from rest, its shape offsets are relaxed toward their neighbours, region by region, until none do.
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [src, out, ...names] = process.argv.slice(2); await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src); const buf = doc.getRoot().listBuffers()[0];
// seam copies are welded within a tolerance (rebinding leaves them a float's width apart)
const WELD = Number(process.env.WELD ?? 2e-4);
const weld = (P, n) => { const g = new Map(), rep = new Int32Array(n); const c = (x) => Math.floor(x / WELD);
  for (let i = 0; i < n; i += 1) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; let r = -1;
    for (let dx = -1; dx <= 1 && r < 0; dx += 1) for (let dy = -1; dy <= 1 && r < 0; dy += 1) for (let dz = -1; dz <= 1 && r < 0; dz += 1) for (const j of g.get(`${c(x) + dx},${c(y) + dy},${c(z) + dz}`) ?? []) if (Math.hypot(P[j * 3] - x, P[j * 3 + 1] - y, P[j * 3 + 2] - z) < WELD) { r = j; break; }
    if (r < 0) { r = i; const k = `${c(x)},${c(y)},${c(z)}`; if (!g.has(k)) g.set(k, []); g.get(k).push(i); } rep[i] = r; } return rep; };
const MAXD = Number(process.env.UNTANGLE_MAX ?? 0.006);
const RINGS = Number(process.env.RINGS ?? 20);
const COS = Number(process.env.UNTANGLE_COS ?? 0.5);
for (const m of doc.getRoot().listMeshes()) { const tn = m.getExtras()?.targetNames ?? [];
  for (const p of m.listPrimitives()) { const name = p.getMaterial()?.getName(); if (!names.includes(name)) continue;
    const P = p.getAttribute('POSITION').getArray(), n = P.length / 3, I = p.getIndices().getArray();
    const rep = weld(P, n);
    const nb = new Map(); const add = (a, b) => { if (a === b) return; if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e += 1) { const a = rep[I[t + e]], b = rep[I[t + (e + 1) % 3]]; add(a, b); add(b, a); }
    const nbl = new Map([...nb].map(([a, s]) => [a, [...s]]));
    const nrm = (A, a, b, c) => { const u = [0, 1, 2].map((e) => A[b * 3 + e] - A[a * 3 + e]), v = [0, 1, 2].map((e) => A[c * 3 + e] - A[a * 3 + e]); return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
    // a FOLD is two neighbouring triangles facing apart (more than 90 degrees) that were nearly flat at
    // rest; a whole region turning (the belly's underside at 100% facing forward at 0%) is not one
    const ef = new Map(); for (let t = 0, f = 0; t < I.length; t += 3, f += 1) for (let e = 0; e < 3; e += 1) { const a = rep[I[t + e]], b = rep[I[t + (e + 1) % 3]]; if (a === b) continue; const k = a < b ? `${a},${b}` : `${b},${a}`; if (!ef.has(k)) ef.set(k, []); ef.get(k).push(f); }
    const pairs = []; for (const fs of ef.values()) if (fs.length === 2) pairs.push(fs);
    const fn = (A, f) => { const t = f * 3; const g = (i) => [0, 1, 2].map((e) => A(I[t + i], e)); const [x, y, z] = [g(0), g(1), g(2)]; const u = [y[0] - x[0], y[1] - x[1], y[2] - x[2]], v = [z[0] - x[0], z[1] - x[1], z[2] - x[2]]; const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...c); return l ? c.map((q) => q / l) : null; };
    const nF = I.length / 3; const restN = Array.from({ length: nF }, (_, f) => fn((i, e) => P[i * 3 + e], f));
    const live = pairs.filter(([f, g]) => restN[f] && restN[g] && restN[f][0] * restN[g][0] + restN[f][1] * restN[g][1] + restN[f][2] * restN[g][2] > 0.5);
    const FOLD = Number(process.env.FOLD_COS ?? 0);
    let BASE = null; const bad = (D) => { const N = Array.from({ length: nF }, (_, f) => fn((i, e) => P[i * 3 + e] + (BASE ? BASE[i * 3 + e] : 0) + D[rep[i] * 3 + e], f)); const v = new Set(); let c = 0; for (const [f, g] of live) { const a = N[f], b = N[g]; const cs = a && b ? a[0] * b[0] + a[1] * b[1] + a[2] * b[2] : -1; if (cs < FOLD) { c += 1; for (const h of [f, g]) for (let e = 0; e < 3; e += 1) v.add(rep[I[h * 3 + e]]); } } return { c, v }; };
    // the small belly sizes are always worn with navelFlat on (to 75%), so they are judged with it on
    const flatK = tn.indexOf('navelFlat'), FLAT = flatK >= 0 ? p.listTargets()[flatK].getAttribute('POSITION').getArray() : null;
    p.listTargets().forEach((tg, k) => { const A = tg.getAttribute('POSITION'); const T = A.getArray(); if (!T.some((x) => x !== 0)) return;
      const mm = /^belly(\d*)$/.exec(tn[k] ?? ''); BASE = mm && FLAT && (mm[1] === '' || Number(mm[1]) <= 75) ? FLAT : null;
      const D = new Float64Array(n * 3); for (let i = 0; i < n; i += 1) if (rep[i] === i) for (let e = 0; e < 3; e += 1) D[i * 3 + e] = T[i * 3 + e];
      let { c, v } = bad(D); const c0 = c; let it = 0;
      for (; c && it < Number(process.env.UNTANGLE_ROUNDS ?? 200); it += 1) { // grow the region three rings, feather its edge
        const w = new Map(); for (const a of v) w.set(a, 1); let ring = [...v];
        for (let r = 1; r <= RINGS; r += 1) { const nx = []; for (const a of ring) for (const b of nbl.get(a) ?? []) if (!w.has(b)) { w.set(b, 1 - r / (RINGS + 1)); nx.push(b); } ring = nx; }
        for (let pass = 0; pass < 8; pass += 1) { const G = Float64Array.from(D); for (const [a, wa] of w) { const ns = nbl.get(a); if (!ns) continue; for (let e = 0; e < 3; e += 1) { let s = 0; for (const b of ns) s += D[b * 3 + e]; G[a * 3 + e] = (1 - 0.6 * wa) * D[a * 3 + e] + 0.6 * wa * s / ns.length; } } D.set(G); }
        // never move the cloth further than UNTANGLE_MAX from where the skin put it (the folds are local)
        if (MAXD) for (let a = 0; a < n; a += 1) { if (rep[a] !== a) continue; const d = [0, 1, 2].map((e) => D[a * 3 + e] - T[a * 3 + e]); const l = Math.hypot(...d); if (l > MAXD) for (let e = 0; e < 3; e += 1) D[a * 3 + e] = T[a * 3 + e] + d[e] * MAXD / l; }
        ({ c, v } = bad(D)); }
      const O = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) for (let e = 0; e < 3; e += 1) O[i * 3 + e] = D[rep[i] * 3 + e];
      tg.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(O).setBuffer(buf));
      if (c0) console.log(`${name} ${tn[k] ?? k}: ${c0} -> ${c} folded edges (${it} rounds)`); }); } }
await io.write(out, doc); console.log('written', out);
