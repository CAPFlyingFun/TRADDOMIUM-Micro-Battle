// Dump the skin primitive (Material_0) of a GLB in world space: positions, normals, uvs, indices.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { writeFileSync, mkdirSync } from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [file, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const doc = await io.read(file);
const mul = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
// a normal is carried by the INVERSE TRANSPOSE of the skin matrix: Sarah's mesh is quantized into a box scaled
// differently on each axis, and carrying her normals by the matrix itself tilts them by up to ten degrees
const rot = (m, v) => { const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  // cofactor matrix = det * inverse transpose; its sign does not matter once normalized, but keep it facing out
  const det = a * A + b * B + c * C, s = det < 0 ? -1 : 1;
  return [s * (A * v[0] + B * v[1] + C * v[2]), s * (D * v[0] + E * v[1] + F * v[2]), s * (G * v[0] + H * v[1] + I * v[2])]; };
let n = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const W = node.getWorldMatrix();
  mesh.listPrimitives().forEach((p, pi) => {
    if (p.getMaterial()?.getName() !== 'Material_0') return;
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), U = p.getAttribute('TEXCOORD_0'), I = p.getIndices();
    const cnt = P.getCount(), pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
    // A skinned mesh is drawn by its joints, not by its node: rest position = sum(w * jointWorld * inverseBind) * v
    const skin = node.getSkin(), JA = p.getAttribute('JOINTS_0'), WA = p.getAttribute('WEIGHTS_0');
    let jm = null;
    if (skin && JA) {
      const ibm = skin.getInverseBindMatrices(), joints = skin.listJoints();
      const mm = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
      jm = joints.map((j, i) => mm(j.getWorldMatrix(), ibm.getElement(i, [])));
    }
    for (let i = 0; i < cnt; i++) {
      let M = W;
      if (jm) { const ji = JA.getElement(i, []), wi = WA.getElement(i, []); M = new Array(16).fill(0); for (let k = 0; k < 4; k++) if (wi[k]) for (let q = 0; q < 16; q++) M[q] += wi[k] * jm[ji[k]][q]; }
      const w = mul(M, P.getElement(i, [])); pos.set(w, i * 3);
      const r = rot(M, N.getElement(i, [])); const l = Math.hypot(...r) || 1; nor.set(r.map((x) => x / l), i * 3);
      uv.set(U.getElement(i, []), i * 2);
    }
    const idx = Uint32Array.from(I.getArray());
    const tag = `${out}/p${n}`;
    writeFileSync(tag + '-pos.bin', Buffer.from(pos.buffer)); writeFileSync(tag + '-nor.bin', Buffer.from(nor.buffer));
    writeFileSync(tag + '-uv.bin', Buffer.from(uv.buffer)); writeFileSync(tag + '-idx.bin', Buffer.from(idx.buffer));
    writeFileSync(tag + '.json', JSON.stringify({ node: node.getName(), prim: pi, verts: cnt, tris: idx.length / 3, normalized: U.getNormalized(), uvType: U.getComponentType() }));
    console.log(tag, node.getName(), pi, cnt, idx.length / 3); n++;
  });
}
