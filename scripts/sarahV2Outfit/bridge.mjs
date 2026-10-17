// CLOTH BRIDGES A CREVICE; SKIN FOLDS INTO IT. At the small belly sizes her lower abdomen overhangs the
// groin crease and her navel is an innie; cloth bound to that skin dives into both and shows its back as
// a dark slit. For each listed body shape, the cloth's shape at that size is lifted OUT of concavities
// only (each point may move along its own outward normal toward its neighbours, never inward), to at
// most `max` mm, and the result written back as that shape's offsets. Convex cloth is never touched.
//   node bridge.mjs src out name:passes:maxMM[:alpha] ...      (shapes: BRIDGE_SHAPES, default belly..belly75)
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [src, out, ...specs] = process.argv.slice(2); await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src); const buf = doc.getRoot().listBuffers()[0];
const HULL = process.env.BRIDGE_HULL ? process.env.BRIDGE_HULL.split(':').map(Number) : null;
const SHAPES = (process.env.BRIDGE_SHAPES ?? 'belly,belly25,belly30,belly50,belly60,belly75').split(',');
for (const sp of specs) { const [name, ps, mx, al] = sp.split(':'); const PASSES = Number(ps), MAX = Number(mx) / 1000, ALPHA = Number(al ?? 0.5);
  for (const m of doc.getRoot().listMeshes()) { const tn = m.getExtras()?.targetNames ?? []; for (const p of m.listPrimitives()) { if (p.getMaterial()?.getName() !== name) continue;
    const P = p.getAttribute('POSITION').getArray(), I = p.getIndices().getArray(), n = P.length / 3, nF = I.length / 3;
    const key = new Map(), rep = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = `${Math.round(P[i*3]*1e5)},${Math.round(P[i*3+1]*1e5)},${Math.round(P[i*3+2]*1e5)}`; if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
    const reps = [...new Set(rep)]; const nb = new Map(); const add = (a, b) => { if (a === b) return; if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
    const boundary = new Set(); { const ec = new Map(); for (let f = 0; f < nF; f += 1) for (let e = 0; e < 3; e += 1) { const a = rep[I[f*3+e]], b = rep[I[f*3+(e+1)%3]]; add(a, b); add(b, a); const k = a < b ? `${a},${b}` : `${b},${a}`; ec.set(k, (ec.get(k) || 0) + 1); } for (const [k, c] of ec) if (c === 1) for (const v of k.split(',')) boundary.add(Number(v)); }
    const nbl = new Map([...nb].map(([a, s]) => [a, [...s]]));
    const flatK = tn.indexOf('navelFlat'), FLAT = flatK >= 0 ? p.listTargets()[flatK].getAttribute('POSITION').getArray() : null;
    const normals = (X) => { const N = new Float64Array(n * 3); for (let f = 0; f < nF; f += 1) { const a = I[f*3], b = I[f*3+1], c = I[f*3+2]; const u = [0,1,2].map((e) => X[b*3+e] - X[a*3+e]), v = [0,1,2].map((e) => X[c*3+e] - X[a*3+e]); const cr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; for (const i of [a, b, c]) for (let e = 0; e < 3; e += 1) N[rep[i]*3+e] += cr[e]; } for (const a of reps) { const l = Math.hypot(N[a*3], N[a*3+1], N[a*3+2]) || 1; for (let e = 0; e < 3; e += 1) N[a*3+e] /= l; } return N; };
    // which way is out: the cloth's winding, checked against the body's middle
    let sgn; { const N = normals(P); let s = 0; const c = [0, 1, 2].map((e) => { let t = 0; for (let i = 0; i < n; i += 1) t += P[i*3+e]; return t / n; }); for (const a of reps) s += (P[a*3] - c[0]) * N[a*3] + (P[a*3+2] - c[2]) * N[a*3+2]; sgn = s >= 0 ? 1 : -1; }
    p.listTargets().forEach((tg, k) => { if (!SHAPES.includes(tn[k])) return; const T = tg.getAttribute('POSITION').getArray();
      const base = (/^belly(\d*)$/.test(tn[k]) && FLAT) ? FLAT : null;
      const X = new Float64Array(n * 3); for (let i = 0; i < n * 3; i += 1) X[i] = P[i] + T[i] + (base ? base[i] : 0); const X0 = Float64Array.from(X);
      let N = normals(X);
      for (let pass = 0; pass < PASSES; pass += 1) { if (pass % 5 === 0) N = normals(X);
        const nx = new Float64Array(reps.length); reps.forEach((a, r) => { if (boundary.has(a)) return; const ns = nbl.get(a); if (!ns) return; let s = 0; for (const b of ns) for (let e = 0; e < 3; e += 1) s += (X[b*3+e] - X[a*3+e]) * N[a*3+e] * sgn; s /= ns.length; if (s > 0) nx[r] = ALPHA * s; });
        reps.forEach((a, r) => { if (!nx[r]) return; for (let e = 0; e < 3; e += 1) X[a*3+e] += nx[r] * N[a*3+e] * sgn; const d = [0,1,2].map((e) => X[a*3+e] - X0[a*3+e]); const l = Math.hypot(...d); if (l > MAX) for (let e = 0; e < 3; e += 1) X[a*3+e] = X0[a*3+e] + d[e] * MAX / l; }); }
      // A TANK HANGS: down her front (BRIDGE_HULL=ymin:ymax:maxMM) the cloth is lifted forward to the upper
      // hull of its own profile, slice by slice, so it spans a dip (her navel, the crease between the lower
      // and upper abdomen) instead of following it; the lift is smoothed over the cloth so slices leave no stripe
      if (HULL) { const [y0, y1, hm] = HULL; N = normals(X); const lift = new Float64Array(n); const bins = new Map();
        for (const a of reps) { const y = X[a*3+1]; if (y < y0 || y > y1 || N[a*3+2] * sgn < -0.3) continue; const k = Math.round(X[a*3] / 0.006); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(a); }
        for (const vs of bins.values()) { const pts = vs.filter((a) => N[a*3+2] * sgn >= 0.3).map((a) => [X[a*3+1], X[a*3+2]]).sort((u, v) => u[0] - v[0]); const H = [];
          for (const q of pts) { while (H.length >= 2) { const [o, a2] = [H[H.length - 2], H[H.length - 1]]; if ((a2[0] - o[0]) * (q[1] - o[1]) - (a2[1] - o[1]) * (q[0] - o[0]) >= 0) H.pop(); else break; } H.push(q); }
          if (!H.length) continue; for (const a of vs) { const y = X[a*3+1]; let j = 0; while (j < H.length - 1 && H[j + 1][0] < y) j += 1; const A2 = H[j], B2 = H[Math.min(j + 1, H.length - 1)]; const t = B2[0] > A2[0] ? (y - A2[0]) / (B2[0] - A2[0]) : 0; const hz = A2[1] + (B2[1] - A2[1]) * Math.min(1, Math.max(0, t)); lift[a] = Math.min(hm / 1000, Math.max(0, hz - X[a*3+2])); } }
        let L = lift; for (let r = 0; r < 30; r += 1) { const G = Float64Array.from(L); for (const a of reps) { const ns = nbl.get(a); if (!ns) continue; let m = 0; for (const b of ns) m += L[b]; G[a] = 0.5 * L[a] + 0.5 * m / ns.length; } L = G; }
        let R = lift; for (let r = 0; r < 8; r += 1) { const G = Float64Array.from(R); for (const a of reps) { const ns = nbl.get(a); if (!ns) continue; let m = 0; for (const b of ns) m += R[b]; G[a] = 0.5 * R[a] + 0.5 * m / ns.length; } R = G; }
        for (const a of reps) { const l = Math.max(L[a], R[a]); if (l > 0) X[a*3+2] += l; } }
      const O = new Float32Array(n * 3); let moved = 0, most = 0; for (let i = 0; i < n; i += 1) { const a = rep[i]; for (let e = 0; e < 3; e += 1) O[i*3+e] = X[a*3+e] - P[i*3+e] - (base ? base[i*3+e] : 0); if (i === a) { const l = Math.hypot(X[a*3]-X0[a*3], X[a*3+1]-X0[a*3+1], X[a*3+2]-X0[a*3+2]); if (l > 5e-4) moved += 1; most = Math.max(most, l); } }
      tg.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(O).setBuffer(buf));
      console.log(`${name} ${tn[k]}: ${moved} points lifted out of a crevice by >0.5 mm, most ${(most * 1000).toFixed(1)} mm`); }); } } }
await io.write(out, doc); console.log('written', out);
