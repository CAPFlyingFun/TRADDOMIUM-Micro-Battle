// Every primitive of a GLB posed at one belly state, through the skin, in world space: what
// `garment_clearance.py` measures a mesh fix against (scripts/baseTouchup; docs/reviews/base-touchups/README.md).
//
//   node scripts/baseTouchup/posed.mjs <glb> <outdir> <state> [morph=w,...] [--fix mesh-fix.json]
//
// Morph targets are weighted by name (Sarah v2's belly states: s0 `belly=1`, s50 `belly50=1`, s100 none,
// s150 `belly150=1`, s200 `belly200=1`). `--fix` applies a quantized mesh fix (`mesh_fix.mjs`) to its primitive first.
// Writes <outdir>/<state>-p<n>-pos.bin (float32 xyz per vertex), -idx.bin (uint32 triangles) and <state>.json.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [file, out, state, weightsArg = ''] = process.argv.slice(2);
const fixAt = process.argv.indexOf('--fix'); const fix = fixAt > 0 ? JSON.parse(readFileSync(process.argv[fixAt + 1], 'utf8')) : null;
const weights = Object.fromEntries(weightsArg.split(',').filter((x) => x.includes('=')).map((kv) => { const [k, v] = kv.split('='); return [k, +v]; }));
mkdirSync(out, { recursive: true });
const doc = await io.read(file);
const mm = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
const manifest = [];
let n = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const names = mesh.getExtras()?.targetNames ?? [];
  const skin = node.getSkin(); const jm = skin ? skin.listJoints().map((j, i) => mm(j.getWorldMatrix(), skin.getInverseBindMatrices().getElement(i, []))) : null;
  for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()?.getName() ?? '';
    const P = p.getAttribute('POSITION'), JA = p.getAttribute('JOINTS_0'), WA = p.getAttribute('WEIGHTS_0');
    const cnt = P.getCount(), pos = new Float32Array(cnt * 3);
    const targets = p.listTargets().map((t, k) => [weights[names[k]] ?? 0, t.getAttribute('POSITION')]).filter(([w, a]) => w && a);
    const fixed = (fix && name === fix.material) ? new Map(fix.indices.map((v, i) => [v, i])) : null;
    const scale = P.getNormalized() ? (P.getArray() instanceof Int16Array ? 1 / 32767 : 1) : 1;
    for (let v = 0; v < cnt; v++) {
      const o = P.getElement(v, []);
      if (fixed && fixed.has(v)) { const i = fixed.get(v); for (let k = 0; k < 3; k++) o[k] = fix.position[i * 3 + k] * scale; }
      for (const [w, a] of targets) { const d = a.getElement(v, []); for (let k = 0; k < 3; k++) o[k] += w * d[k]; }
      let M = node.getWorldMatrix();
      if (jm && JA) { const ji = JA.getElement(v, []), wi = WA.getElement(v, []); M = new Array(16).fill(0); for (let k = 0; k < 4; k++) if (wi[k]) for (let q = 0; q < 16; q++) M[q] += wi[k] * jm[ji[k]][q]; }
      pos[v * 3] = M[0] * o[0] + M[4] * o[1] + M[8] * o[2] + M[12]; pos[v * 3 + 1] = M[1] * o[0] + M[5] * o[1] + M[9] * o[2] + M[13]; pos[v * 3 + 2] = M[2] * o[0] + M[6] * o[1] + M[10] * o[2] + M[14];
    }
    const idx = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : new Uint32Array(0);
    writeFileSync(`${out}/${state}-p${n}-pos.bin`, Buffer.from(pos.buffer)); writeFileSync(`${out}/${state}-p${n}-idx.bin`, Buffer.from(idx.buffer));
    manifest.push({ prim: n, name, verts: cnt, tris: idx.length / 3, targets: targets.length }); n++;
  }
}
writeFileSync(`${out}/${state}.json`, JSON.stringify(manifest));
console.log(file.split('/').pop(), state, manifest.map((m) => `${m.name}:${m.verts}${m.targets ? '*' : ''}`).join(' '));
