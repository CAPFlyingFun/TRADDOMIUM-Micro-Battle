// A mesh fix for a body whose positions are QUANTIZED (Sarah v2: KHR_mesh_quantization, int16), as a list of the
// vertices it changes, ready for the build to apply (`scripts/sarahV2Recovery/body-slim.mjs`).
//
//   node scripts/baseTouchup/mesh_fix.mjs <body.glb> <new-pos.bin> <new-nor.bin> <out.json>
//
// Only the vertices `pleat.py` changed are considered: those whose world position or normal differs from the
// dump beside <new-pos.bin> (`p0-pos.bin`, `p0-nor.bin`, written by `dump.mjs`).
//
// <new-pos.bin>/<new-nor.bin> are `pleat.py`'s output: every vertex of the body's skin primitive (`Material_0`) in its
// rest pose, in world space. Each is carried back through that vertex's own skin matrix into the mesh's local space
// (the inverse of what `dump.mjs` did), then rounded onto the accessor's own grid, so the file stores exactly what the
// build will write. A vertex whose rounded position and normal both come out as they were is not listed.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [glb, posBin, norBin, out] = process.argv.slice(2);
const doc = await io.read(glb);
const mm = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
const inv3 = (m) => { const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10]; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det]; };
/** The integer an accessor stores for a float, by its component type (normalized). */
function quantize(array, x) {
  if (array instanceof Int16Array) return Math.max(-32767, Math.min(32767, Math.round(x * 32767)));
  if (array instanceof Int8Array) return Math.max(-127, Math.min(127, Math.round(x * 127)));
  if (array instanceof Float32Array) return Math.fround(x);
  throw new Error(`unsupported accessor type ${array.constructor.name}`);
}
let result = null;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  for (const p of mesh.listPrimitives()) {
    if (p.getMaterial()?.getName() !== 'Material_0') continue;
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), JA = p.getAttribute('JOINTS_0'), WA = p.getAttribute('WEIGHTS_0');
    if (!P.getNormalized() && !(P.getArray() instanceof Float32Array)) throw new Error('positions are integers but not normalized');
    const skin = node.getSkin(); const jm = skin.listJoints().map((j, i) => mm(j.getWorldMatrix(), skin.getInverseBindMatrices().getElement(i, [])));
    const np = new Float32Array(readFileSync(posBin).buffer.slice(0)), nn = new Float32Array(readFileSync(norBin).buffer.slice(0));
    const dir = path.dirname(posBin);
    const op = new Float32Array(readFileSync(path.join(dir, 'p0-pos.bin')).buffer.slice(0)), on = new Float32Array(readFileSync(path.join(dir, 'p0-nor.bin')).buffer.slice(0));
    const cnt = P.getCount();
    if (np.length !== cnt * 3 || nn.length !== cnt * 3) throw new Error(`expected ${cnt} vertices`);
    const pa = P.getArray(), na = N.getArray();
    const indices = [], position = [], normal = [];
    let maxMm = 0;
    for (let v = 0; v < cnt; v++) {
      let moved = false;
      for (let k = 0; k < 3; k++) if (Math.abs(np[v * 3 + k] - op[v * 3 + k]) > 1e-7 || Math.abs(nn[v * 3 + k] - on[v * 3 + k]) > 1e-4) moved = true;
      if (!moved) continue;
      const ji = JA.getElement(v, []), wi = WA.getElement(v, []); const M = new Array(16).fill(0);
      for (let k = 0; k < 4; k++) if (wi[k]) for (let q = 0; q < 16; q++) M[q] += wi[k] * jm[ji[k]][q];
      const o = P.getElement(v, []);
      const w0 = [M[0] * o[0] + M[4] * o[1] + M[8] * o[2] + M[12], M[1] * o[0] + M[5] * o[1] + M[9] * o[2] + M[13], M[2] * o[0] + M[6] * o[1] + M[10] * o[2] + M[14]];
      const dw = [np[v * 3] - w0[0], np[v * 3 + 1] - w0[1], np[v * 3 + 2] - w0[2]];
      const I = inv3(M);
      const lp = [o[0] + I[0] * dw[0] + I[3] * dw[1] + I[6] * dw[2], o[1] + I[1] * dw[0] + I[4] * dw[1] + I[7] * dw[2], o[2] + I[2] * dw[0] + I[5] * dw[1] + I[8] * dw[2]];
      const wn = [nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]];
      const q = [M[0] * wn[0] + M[1] * wn[1] + M[2] * wn[2], M[4] * wn[0] + M[5] * wn[1] + M[6] * wn[2], M[8] * wn[0] + M[9] * wn[1] + M[10] * wn[2]]; const l = Math.hypot(...q);
      const qp = lp.map((x) => quantize(pa, x)), qn = q.map((x) => quantize(na, x / l));
      const same = qp.every((x, k) => x === pa[v * 3 + k]) && qn.every((x, k) => x === na[v * 3 + k]);
      if (same) continue;
      indices.push(v); position.push(...qp); normal.push(...qn);
      maxMm = Math.max(maxMm, Math.hypot(...dw) * 1000);
    }
    result = { material: 'Material_0', vertices: cnt, position_type: pa.constructor.name, normal_type: na.constructor.name, changed: indices.length, max_move_mm: +maxMm.toFixed(3), indices, position, normal };
  }
}
if (!result) throw new Error('no Material_0 primitive');
writeFileSync(out, JSON.stringify(result));
console.log(`${result.changed} of ${result.vertices} vertices changed (largest move ${result.max_move_mm} mm) -> ${out}`);
