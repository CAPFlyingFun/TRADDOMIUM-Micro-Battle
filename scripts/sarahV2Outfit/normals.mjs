// A GARMENT'S NORMAL SHAPES COME FROM ITS OWN SURFACE AT EACH SIZE. growClothes' normal shapes were made
// for the cloth before it was pushed, relaxed and rebound, so at 0% the strip that is tucked under her
// belly at 100% kept a normal facing the floor and drew as a dark slit. Each shape's normal offsets are
// recomputed from the cloth's own faces at that shape (welded, area-weighted). The small belly sizes are
// measured on top of navelFlat, which is always on with them, so 0% = rest + navelFlat + belly is exact.
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [src, out, ...names] = process.argv.slice(2); await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src); const buf = doc.getRoot().listBuffers()[0];
for (const m of doc.getRoot().listMeshes()) { const tn = m.getExtras()?.targetNames ?? []; for (const p of m.listPrimitives()) { const name = p.getMaterial()?.getName(); if (!names.includes(name)) continue;
  const P = p.getAttribute('POSITION').getArray(), I = p.getIndices().getArray(), n = P.length / 3, NA = p.getAttribute('NORMAL').getArray();
  const key = new Map(), rep = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = `${Math.round(P[i*3]*1e5)},${Math.round(P[i*3+1]*1e5)},${Math.round(P[i*3+2]*1e5)}`; if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
  const vn = (X) => { const N = new Float64Array(n * 3); for (let f = 0; f < I.length; f += 3) { const a = I[f], b = I[f+1], c = I[f+2]; const u = [0,1,2].map((e) => X[b*3+e] - X[a*3+e]), v = [0,1,2].map((e) => X[c*3+e] - X[a*3+e]); const cr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; for (const i of [a, b, c]) for (let e = 0; e < 3; e += 1) N[rep[i]*3+e] += cr[e]; }
    const O = new Float64Array(n * 3); for (let i = 0; i < n; i += 1) { const r = rep[i]; const l = Math.hypot(N[r*3], N[r*3+1], N[r*3+2]) || 1; for (let e = 0; e < 3; e += 1) O[i*3+e] = N[r*3+e] / l; } return O; };
  // keep the cloth's own side: flip if its computed normals disagree with its stored rest normals
  const N0 = vn(P); let agree = 0; for (let i = 0; i < n * 3; i += 1) agree += N0[i] * NA[i]; const sg = agree >= 0 ? 1 : -1;
  const targets = p.listTargets(); const flatK = tn.indexOf('navelFlat'); const FLAT = flatK >= 0 ? targets[flatK].getAttribute('POSITION').getArray() : null;
  const withF = FLAT ? vn(P.map((x, i) => x + FLAT[i])) : null; let done = 0;
  targets.forEach((tg, k) => { const T = tg.getAttribute('POSITION').getArray(); if (!tg.getAttribute('NORMAL')) return;
    const onF = FLAT && /^belly(\d*)$/.test(tn[k] ?? '') && (RegExp.$1 === '' || Number(RegExp.$1) <= 75);
    const X = P.map((x, i) => x + T[i] + (onF ? FLAT[i] : 0)); const Nk = vn(X), Nb = onF ? withF : N0;
    const D = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) D[i] = sg * (Nk[i] - Nb[i]);
    tg.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(D).setBuffer(buf)); done += 1; });
  const R = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) R[i] = sg * N0[i]; p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(R).setBuffer(buf));
  console.log(`${name}: rest normals and ${done} normal shapes recomputed from its own faces (${sg > 0 ? 'as wound' : 'flipped'})`); } }
await io.write(out, doc); console.log('written', out);
