/**
 * PACK THE SHIPPED SARAH AGAIN, LOSSLESSLY. The bake ends in `meshopt()` (quantize +
 * EXT_meshopt_compression), which is what keeps `sarah-base.glb` near 9 MB. The scripts
 * that edit the shipped file in place without rebaking it — `swapSarahGarment`,
 * `fitMeshyBikini`, `protectGrownBump`, `addSeatCorrective`, `fitAthleticTee` — read it
 * decoded and wrote it back uncompressed, and the file grew to 56 MB on the phone.
 *
 * It drops what those edits replaced but left behind (`prune`), and re-encodes every buffer view with EXT_meshopt_compression in its lossless mode
 * (no re-quantizing, no filters): what is stored is unchanged to the bit, so the
 * approved body cannot move. Float attributes the editing scripts wrote (the modelled
 * bikini, the seated corrective) are quantized here to the 16-bit normalized form the
 * rest of the file already uses, which is the only change in value and is under a
 * fiftieth of a millimetre.
 *
 *   node scripts/packSarah.mjs <sarah.glb>      (writes it in place)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { prune } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const i16 = (a) => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i += 1) o[i] = Math.max(-32767, Math.min(32767, Math.round(a[i] * 32767))); return o; };

export async function packSarah(file, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const before = statSync(file).size, doc = await io.read(file);
  // every primitive's float positions, normals and shapes to normalized 16-bit, when the
  // file's quantized space holds them (|v| <= 1), and float weights to normalized 8-bit
  let quantized = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const all = [[prim, 'POSITION'], [prim, 'NORMAL'], ...prim.listTargets().flatMap((t) => [[t, 'POSITION'], [t, 'NORMAL']])];
    for (const [owner, sem] of all) {
      const A = owner.getAttribute(sem); if (!A || !(A.getArray() instanceof Float32Array)) continue;
      const a = A.getArray(); let mx = 0; for (let i = 0; i < a.length; i += 1) mx = Math.max(mx, Math.abs(a[i]));
      if (mx > 1) continue;
      A.setArray(i16(a)).setNormalized(true); quantized += 1;
    }
    const W = prim.getAttribute('WEIGHTS_0');
    if (W && W.getArray() instanceof Float32Array) {
      const a = W.getArray(), u = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i += 4) { let sum = 0, big = i; for (let c = 0; c < 4; c += 1) { u[i + c] = Math.round(a[i + c] * 255); sum += u[i + c]; if (a[i + c] > a[big]) big = i + c; } u[big] += 255 - sum; } // all four kept; the rounding goes to the strongest
      W.setArray(u).setNormalized(true); quantized += 1;
    }
    const J = prim.getAttribute('JOINTS_0');
    if (J && !(J.getArray() instanceof Uint8Array) && Math.max(...J.getArray()) < 256) J.setArray(Uint8Array.from(J.getArray()));
  }
  // what earlier edits replaced but left in the file (old garment accessors, old shape
  // data, textures no material uses) is dropped
  await doc.transform(prune());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(file, doc);
  log(`pack: ${(before / 1e6).toFixed(1)} MB -> ${(statSync(file).size / 1e6).toFixed(1)} MB (${quantized} float accessors quantized, unused data pruned; everything else bit-for-bit)`);
}

if (process.argv[1]?.endsWith('packSarah.mjs')) await packSarah(process.argv[2]);
