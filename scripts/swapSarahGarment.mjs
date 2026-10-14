/**
 * ONE GARMENT INTO THE SHIPPED SARAH, NOTHING ELSE (Joshua, 2026-10-13: "V1: belly
 * geometry is APPROVED from 0-200%... do NOT modify V1's belly"). A full rebake of
 * `sarah-base.glb` regrows every garment from her body and re-derives the body's own
 * shapes, which drift by millimetres each time. This copies the named garments from a
 * freshly rebaked file into the shipped one and leaves every other primitive exactly
 * as it was: positions, normals and shapes are carried through metres (each file's
 * own skin space), so the two files' quantization never has to agree. Its painted
 * textures, drawn for its own cut, come with it; no other texture is touched.
 *
 *   node scripts/swapSarahGarment.mjs <rebaked.glb> <shipped.glb> bikini [shirt ...]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => { // affine 4x4, column-major
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const toMetres = (doc) => { const skin = doc.getRoot().listSkins()[0]; return mul(skin.listJoints()[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))); };
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];

export async function swapSarahGarment(fromFile, intoFile, garments, { log = () => {} } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const src = await io.read(fromFile), dst = await io.read(intoFile);
  const Ts = toMetres(src), Td = invert(toMetres(dst)), M = mul(Td, Ts); // source local -> destination local
  const sMesh = src.getRoot().listMeshes()[0], dMesh = dst.getRoot().listMeshes()[0];
  const sNames = sMesh.getExtras().targetNames, dNames = dMesh.getExtras().targetNames;
  const sJoints = src.getRoot().listSkins()[0].listJoints().map((j) => j.getName()), dJoints = dst.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
  const buffer = dst.getRoot().listBuffers()[0];
  for (const name of garments) {
    const sp = sMesh.listPrimitives().find((p) => p.getMaterial()?.getName() === name);
    const dp = dMesh.listPrimitives().find((p) => p.getMaterial()?.getName() === name);
    if (!sp || !dp) throw new Error(`no ${name} in both files`);
    const n = sp.getAttribute('POSITION').getCount(), v = [0, 0, 0, 0];
    const read = (A, size) => { const out = new Float32Array(n * size); for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < size; c += 1) out[i * size + c] = v[c]; } return out; };
    const xform = (arr, w, normalize) => { for (let i = 0; i < n; i += 1) { let q = apply(M, [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]], w); if (normalize) { const l = Math.hypot(...q) || 1; q = q.map((x) => x / l); } arr.set(q, i * 3); } return arr; };
    const acc = (type, array) => dst.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    for (const sem of sp.listSemantics()) {
      if (sem.startsWith('_SKIN_')) continue; // a bake-time record for the fitters, not shipped
      const A = sp.getAttribute(sem), size = A.getElementSize();
      let arr = read(A, size);
      if (sem === 'POSITION') arr = xform(arr, 1, false);
      else if (sem === 'NORMAL') arr = xform(arr, 0, true);
      else if (sem.startsWith('JOINTS')) { for (let i = 0; i < arr.length; i += 1) { const k = dJoints.indexOf(sJoints[arr[i]]); if (k < 0) throw new Error('joint missing'); arr[i] = k; } arr = Uint16Array.from(arr); }
      dp.setAttribute(sem, acc(A.getType(), arr));
    }
    for (const sem of dp.listSemantics()) if (!sp.getAttribute(sem) || sem.startsWith('_SKIN_')) dp.setAttribute(sem, null);
    dp.setIndices(acc('SCALAR', Uint32Array.from(sp.getIndices().getArray())));
    // shapes, by name: the destination keeps its own order of targets
    for (const t of [...dp.listTargets()]) { dp.removeTarget(t); t.dispose(); }
    for (const tname of dNames) {
      const st = sp.listTargets()[sNames.indexOf(tname)], t = dst.createPrimitiveTarget(tname);
      for (const sem of ['POSITION', 'NORMAL']) {
        if (!dp.getAttribute(sem)) continue;
        let arr = st?.getAttribute(sem) ? read(st.getAttribute(sem), 3) : new Float32Array(n * 3);
        arr = xform(arr, 0, false);
        t.setAttribute(sem, acc('VEC3', arr));
      }
      dp.addTarget(t);
    }
    dp.setExtras({ ...sp.getExtras() });
    // its painted texture was drawn for its own cut: the images come with it
    const sm = sp.getMaterial(), dm = dp.getMaterial();
    for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive']) {
      const st = sm[`get${slot}Texture`](), dt = dm[`get${slot}Texture`]();
      if (st && dt) dt.setImage(st.getImage()).setMimeType(st.getMimeType());
      else if (st || dt) throw new Error(`${name}: the two files' ${slot} textures do not line up`);
    }
    log(`swap: ${name} copied (${n.toLocaleString('en-US')} vertices, ${dNames.length} shapes); every other primitive untouched`);
  }
  await io.write(intoFile, dst);
}

if (process.argv[1]?.endsWith('swapSarahGarment.mjs')) {
  const [from, into, ...garments] = process.argv.slice(2);
  await swapSarahGarment(from, into, garments, { log: console.log });
}
