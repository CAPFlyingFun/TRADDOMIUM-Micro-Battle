// Keep only a garment's largest connected piece (a cut can leave islands of cloth on the arms).
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [src, out, name] = process.argv.slice(2); const doc = await io.read(src);
const prim = doc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial()?.getName() === name);
const P = prim.getAttribute('POSITION'), n = P.getCount(), v = [], key = new Map(), rep = new Int32Array(n);
for (let i = 0; i < n; i += 1) { P.getElement(i, v); const k = v.map((x) => Math.round(x * 1e5)).join(','); if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
const par = Int32Array.from({ length: n }, (_, i) => i), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
const I = Array.from(prim.getIndices().getArray());
for (let t = 0; t < I.length; t += 3) { const a = find(rep[I[t]]); for (const j of [I[t + 1], I[t + 2]]) { const b = find(rep[j]); if (a !== b) par[b] = a; } }
const cnt = new Map(); for (let t = 0; t < I.length; t += 3) { const r = find(rep[I[t]]); cnt.set(r, (cnt.get(r) || 0) + 1); }
const best = [...cnt].sort((a, b) => b[1] - a[1])[0][0]; const keep = [];
for (let t = 0; t < I.length; t += 3) if (find(rep[I[t]]) === best) keep.push(I[t], I[t + 1], I[t + 2]);
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? Uint32Array.from(keep) : Uint16Array.from(keep)).setBuffer(doc.getRoot().listBuffers()[0]));
console.log(`${name}: ${cnt.size} pieces, kept the largest (${keep.length / 3} of ${I.length / 3} triangles)`);
await io.write(out, doc);
