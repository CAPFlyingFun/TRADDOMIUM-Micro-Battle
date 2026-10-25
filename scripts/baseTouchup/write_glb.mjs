// Write a touched-up copy of a base GLB: new skin positions/normals (world space, converted back
// through the skin) and/or replacement textures by slot. Everything else is copied as it was.
//   node write_glb.mjs in.glb out.glb [pos=..bin] [nor=..bin] [base=img] [normal=img] [mr=img]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync } from 'node:fs';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [inp, out, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.split('=')));
const doc = await io.read(inp);
const inv3 = (m) => { // inverse of the upper 3x3 of a column-major 4x4
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
};
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial(); if (mat?.getName() !== 'Material_0') continue;
    if (opt.pos) {
      const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL');
      if (P.getNormalized() || P.getComponentType() !== 5126) throw new Error('quantized positions: not written by this tool');
      const skin = node.getSkin(), JA = p.getAttribute('JOINTS_0'), WA = p.getAttribute('WEIGHTS_0');
      const mm = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
      const jm = skin.listJoints().map((j, i) => mm(j.getWorldMatrix(), skin.getInverseBindMatrices().getElement(i, [])));
      const np = new Float32Array(readFileSync(opt.pos).buffer.slice(0)), nn = new Float32Array(readFileSync(opt.nor).buffer.slice(0));
      let maxdev = 0;
      for (let v = 0; v < P.getCount(); v++) {
        const ji = JA.getElement(v, []), wi = WA.getElement(v, []); const M = new Array(16).fill(0);
        for (let k = 0; k < 4; k++) if (wi[k]) for (let q = 0; q < 16; q++) M[q] += wi[k] * jm[ji[k]][q];
        const old = P.getElement(v, []);
        const w0 = [M[0] * old[0] + M[4] * old[1] + M[8] * old[2] + M[12], M[1] * old[0] + M[5] * old[1] + M[9] * old[2] + M[13], M[2] * old[0] + M[6] * old[1] + M[10] * old[2] + M[14]];
        const dw = [np[v * 3] - w0[0], np[v * 3 + 1] - w0[1], np[v * 3 + 2] - w0[2]];
        if (Math.hypot(...dw) < 1e-9) continue;
        const I = inv3(M), dl = [I[0] * dw[0] + I[3] * dw[1] + I[6] * dw[2], I[1] * dw[0] + I[4] * dw[1] + I[7] * dw[2], I[2] * dw[0] + I[5] * dw[1] + I[8] * dw[2]];
        P.setElement(v, [old[0] + dl[0], old[1] + dl[1], old[2] + dl[2]]);
        const wn = [nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]];
        // normal back to bind space: transpose of the inverse's inverse = M^T for the linear part
        const ln = [M[0] * wn[0] + M[1] * wn[1] + M[2] * wn[2], M[4] * wn[0] + M[5] * wn[1] + M[6] * wn[2], M[8] * wn[0] + M[9] * wn[1] + M[10] * wn[2]];
        const l = Math.hypot(...ln); N.setElement(v, ln.map((x) => x / l));
        maxdev = Math.max(maxdev, Math.hypot(...dl));
      }
      console.log('positions written; largest move (bind units)', maxdev.toFixed(5));
    }
    for (const [slot, get] of [['base', () => mat.getBaseColorTexture()], ['normal', () => mat.getNormalTexture()], ['mr', () => mat.getMetallicRoughnessTexture()]]) {
      if (!opt[slot]) continue;
      const tex = get(); const bytes = readFileSync(opt[slot]);
      tex.setImage(new Uint8Array(bytes)).setMimeType(opt[slot].endsWith('.png') ? 'image/png' : 'image/jpeg');
      console.log('texture', slot, '<-', opt[slot], bytes.length);
    }
  }
}
await io.write(out, doc);
console.log('wrote', out);
