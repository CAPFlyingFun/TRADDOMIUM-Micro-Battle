// World-space positions/normals for a body's skin -> the mesh's own (dequantized) local space, for a
// render-time preview of a mesh change on a file whose positions are quantized (Sarah's approved body).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [glb, posBin, norBin, out] = process.argv.slice(2);
const doc = await io.read(glb);
const mm = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
const inv3 = (m) => { const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10]; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det]; };
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  for (const p of mesh.listPrimitives()) {
    if (p.getMaterial()?.getName() !== 'Material_0') continue;
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), JA = p.getAttribute('JOINTS_0'), WA = p.getAttribute('WEIGHTS_0');
    const skin = node.getSkin(); const jm = skin.listJoints().map((j, i) => mm(j.getWorldMatrix(), skin.getInverseBindMatrices().getElement(i, [])));
    const np = new Float32Array(readFileSync(posBin).buffer.slice(0)), nn = new Float32Array(readFileSync(norBin).buffer.slice(0));
    const cnt = P.getCount(), lp = new Float32Array(cnt * 3), ln = new Float32Array(cnt * 3);
    for (let v = 0; v < cnt; v++) {
      const ji = JA.getElement(v, []), wi = WA.getElement(v, []); const M = new Array(16).fill(0);
      for (let k = 0; k < 4; k++) if (wi[k]) for (let q = 0; q < 16; q++) M[q] += wi[k] * jm[ji[k]][q];
      const o = P.getElement(v, []);
      const w0 = [M[0] * o[0] + M[4] * o[1] + M[8] * o[2] + M[12], M[1] * o[0] + M[5] * o[1] + M[9] * o[2] + M[13], M[2] * o[0] + M[6] * o[1] + M[10] * o[2] + M[14]];
      const dw = [np[v * 3] - w0[0], np[v * 3 + 1] - w0[1], np[v * 3 + 2] - w0[2]];
      const I = inv3(M);
      lp.set([o[0] + I[0] * dw[0] + I[3] * dw[1] + I[6] * dw[2], o[1] + I[1] * dw[0] + I[4] * dw[1] + I[7] * dw[2], o[2] + I[2] * dw[0] + I[5] * dw[1] + I[8] * dw[2]], v * 3);
      const wn = [nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]];
      const q = [M[0] * wn[0] + M[1] * wn[1] + M[2] * wn[2], M[4] * wn[0] + M[5] * wn[1] + M[6] * wn[2], M[8] * wn[0] + M[9] * wn[1] + M[10] * wn[2]]; const l = Math.hypot(...q);
      ln.set(q.map((x) => x / l), v * 3);
    }
    writeFileSync(out + '-lpos.bin', Buffer.from(lp.buffer)); writeFileSync(out + '-lnor.bin', Buffer.from(ln.buffer));
    console.log('wrote', cnt, 'vertices');
  }
}
