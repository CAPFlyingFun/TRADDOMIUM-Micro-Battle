// width and height of her navel bump through each layer, front centreline, at 100% (navelOut 1/1.4) and 200%
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [src] = process.argv.slice(2); await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }); const doc = await io.read(src);
for (const [label, W] of [['100%', { navelOut: 1 / 1.4 }], ['200%', { belly200: 1, navelOut: 1 }]]) for (const m of doc.getRoot().listMeshes()) { const tn = m.getExtras()?.targetNames ?? [];
  for (const p of m.listPrimitives()) { const nm = p.getMaterial()?.getName(); if (!['Material_0', 'leggings', 'shirt'].includes(nm)) continue;
    const rd = (A) => { const o = new Float32Array(A.getCount() * 3), e = []; for (let i = 0; i < A.getCount(); i += 1) { A.getElement(i, e); o[i*3] = e[0]; o[i*3+1] = e[1]; o[i*3+2] = e[2]; } return o; };
    const Q = rd(p.getAttribute('POSITION')); p.listTargets().forEach((t, k) => { const w = W[tn[k]]; if (w) { const D = rd(t.getAttribute('POSITION')); for (let i = 0; i < Q.length; i += 1) Q[i] += w * D[i]; } });
    const pts = []; for (let i = 0; i < Q.length / 3; i += 1) if (Math.abs(Q[i*3]) < 0.004 && Q[i*3+2] > 0) pts.push([Q[i*3+1], Q[i*3+2]]);
    const bin = new Map(); for (const [y, z] of pts) { const k = Math.round(y / 0.002); bin.set(k, Math.max(bin.get(k) ?? -9, z)); }
    const ks = [...bin.keys()].sort((a, b) => a - b); const prof = ks.map((k) => [k * 0.002, bin.get(k)]);
    // the navel: highest local bump against a line through the profile 4 cm either side, between y 0.15 and 0.4
    let best = null; for (let i = 0; i < prof.length; i += 1) { const [y, z] = prof[i]; if (y < 0.15 || y > 0.42) continue; const a = prof.find((q) => q[0] >= y - 0.04), b = [...prof].reverse().find((q) => q[0] <= y + 0.04); if (!a || !b) continue; const base = a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0] || 1); const h = z - base; if (!best || h > best.h) best = { y, h, a, b }; }
    if (!best) continue; const base = (y) => best.a[1] + (best.b[1] - best.a[1]) * (y - best.a[0]) / (best.b[0] - best.a[0]);
    const over = prof.filter(([y, z]) => y > best.y - 0.04 && y < best.y + 0.04 && z - base(y) > best.h * 0.25); const wd = over.length ? over[over.length - 1][0] - over[0][0] : 0;
    console.log(`${label} ${nm.padEnd(10)} navel bump ${(best.h * 1000).toFixed(1)} mm high, ${(wd * 1000).toFixed(0)} mm tall (at quarter height), at y ${best.y.toFixed(3)}`); } }
