/**
 * THE BIKINI BOTTOM KEEPS ITS SIZE (Joshua, 2026-10-13: "the bottom bikini shouldn't be
 * stretching with the belly, and stays fixed below the belly"; "not change size"). Grown
 * from her skin, the brief carried every belly shape the skin under it has, so a bigger
 * belly pulled its front out and down with it. Here, below the top of her hips, each
 * size past 100% (and the bump's weight) keeps only the part of its move on the brief
 * that goes IN toward her and drops the part that goes out: the bump grows over the
 * brief and hangs in front of it, as it does, and the brief stays the shape it is cut.
 * Faded out above the hip line, so the top's shapes are untouched. In metres, each
 * file's own skin space. Run on the shipped file after the bikini is swapped in.
 *
 *   node scripts/fixBikiniBottom.mjs public/models/sarah-base.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { jointPositions, partsOf } from './growClothes.mjs';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The grown sizes and the bump's weight. The smaller sizes draw the skin in, and the
 * brief follows them as it was grown to (holding it out left it crumpled at 0%). */
const BELLY = /^belly(1\d\d|2\d\d)$|^belly(Tilt|Bob|Sway)$/;
/** Up to this far over the hip joints the brief keeps its size, fading over the next 4 cm. */
export const KEEP_TO = 0.06;

export async function fixBikiniBottom(file, { log = () => {} } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file);
  const skin = doc.getRoot().listSkins()[0], mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras().targetNames;
  const { hipY } = partsOf(skin, jointPositions(skin));
  const p = mesh.listPrimitives().find((q) => q.getMaterial()?.getName() === 'bikini');
  if (!p) throw new Error('no bikini');
  if (p.getExtras().bottomFixed) { log('bikini: bottom already fixed'); return; }
  const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), n = P.getCount(), v = [0, 0, 0], nn = [0, 0, 0], d = [0, 0, 0];
  const keep = new Float32Array(n), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    P.getElement(i, v); N.getElement(i, nn);
    keep[i] = smooth(hipY + KEEP_TO + 0.04, hipY + KEEP_TO, v[1]);
    const l = Math.hypot(...nn) || 1; nrm.set([nn[0] / l, nn[1] / l, nn[2] / l], i * 3);
  }
  let changed = 0;
  p.listTargets().forEach((t, k) => {
    if (!BELLY.test(names[k])) return;
    const A = t.getAttribute('POSITION'), out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      A.getElement(i, d);
      const w = keep[i], o = d[0] * nrm[i * 3] + d[1] * nrm[i * 3 + 1] + d[2] * nrm[i * 3 + 2];
      let x = d[0], y = d[1], z = d[2];
      if (w > 0) {
        // the outward part dropped; the move along the skin scaled down with it
        const along = [x - o * nrm[i * 3], y - o * nrm[i * 3 + 1], z - o * nrm[i * 3 + 2]];
        const keepOut = o < 0 ? o : 0;
        x = (1 - w) * x + w * (keepOut * nrm[i * 3] + 0.25 * along[0]);
        y = (1 - w) * y + w * (keepOut * nrm[i * 3 + 1] + 0.25 * along[1]);
        z = (1 - w) * z + w * (keepOut * nrm[i * 3 + 2] + 0.25 * along[2]);
        if (Math.abs(x - d[0]) + Math.abs(y - d[1]) + Math.abs(z - d[2]) > 1e-6) changed += 1;
      }
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    }
    t.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
    const TN = t.getAttribute('NORMAL');
    if (TN) { const o = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) { TN.getElement(i, d); for (let c = 0; c < 3; c += 1) o[i * 3 + c] = d[c] * (1 - keep[i]); } t.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(o).setBuffer(doc.getRoot().listBuffers()[0])); }
  });
  p.setExtras({ ...p.getExtras(), bottomFixed: true });
  await io.write(file, doc);
  log(`bikini: the bottom keeps its size below ${(hipY + KEEP_TO).toFixed(3)} m (${changed.toLocaleString('en-US')} vertex moves changed)`);
}

if (process.argv[1]?.endsWith('fixBikiniBottom.mjs')) await fixBikiniBottom(process.argv[2], { log: console.log });
