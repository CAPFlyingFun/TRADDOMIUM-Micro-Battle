/**
 * THE BUMP AT EVERY SIZE BELONGS TO HER PELVIS (Joshua, 2026-10-14, seated past full
 * term: "part of the belly is cut off at the bottom… figure that out by smoothing out
 * the bottom or something else").
 *
 * `protectBumpWeights.mjs` lifts the thigh share of the bump onto the pelvis, deciding
 * which skin is bump from where it lies on the BIND body. The bind body is 100%; the
 * bigger sizes are shapes added on top, and a shape moves skin without changing its
 * weights. So skin that is groin at 100% but is carried forward into the underside of
 * the bump at 150% and 200% kept its thigh weight, and seated, where the thighs swing
 * up 80°, that share swung with them: the bottom of the big bump folded into her lap,
 * flat across, exactly the fault the overhang rule fixed at 100%.
 *
 * This applies the same rule (`protectBumpWeights`' own numbers) to every belly size
 * at once: a vertex is lifted by the most it would be at ANY size. It changes skin
 * WEIGHTS only, on the shipped file: no position or shape moves, so the approved belly
 * is the same belly standing; only what carries it when she sits changes.
 *
 *   node scripts/protectGrownBump.mjs <sarah.glb>      (writes it in place)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { FRONT_FROM, FRONT_TO, CREASE_FROM, CREASE_TO, OVERHANG_FROM, OVERHANG_TO, OVERHANG_DEPTH } from './protectBumpWeights.mjs';

/** The sizes whose shapes are checked, besides the bind (100%) body. */
export const GROWN = ['belly150', 'belly200'];

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];

/** How much of a vertex's hip weight belongs to the pelvis, for skin at `p` (metres). */
export function lift(p, hipY, hipZ) {
  const ahead = p[2] - hipZ;
  const crease = CREASE_FROM - OVERHANG_DEPTH * smoothstep(OVERHANG_FROM, OVERHANG_TO, ahead);
  return smoothstep(FRONT_FROM, FRONT_TO, ahead) * smoothstep(crease, crease + (CREASE_TO - CREASE_FROM), p[1] - hipY);
}

export async function protectGrownBump(file, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file);
  const skin = doc.getRoot().listSkins()[0], joints = skin.listJoints();
  const T = mul(joints[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16)));
  // the pelvis is the first joint with three children; the hips its two lower ones
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  const pelvis = kids.findIndex((c) => c.length >= 3), at = joints.map((j) => j.getWorldTranslation());
  const hips = kids[pelvis].filter((c) => at[c][1] < at[pelvis][1] + 1e-6 && kids[c].length > 0).sort((a, b) => at[a][1] - at[b][1]).slice(0, 2);
  const hipY = (at[hips[0]][1] + at[hips[1]][1]) / 2, hipZ = (at[hips[0]][2] + at[hips[1]][2]) / 2, legRoot = new Set(hips);
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras().targetNames, body = mesh.listPrimitives()[0];
  const P = body.getAttribute('POSITION'), J = body.getAttribute('JOINTS_0'), W = body.getAttribute('WEIGHTS_0');
  const shapes = GROWN.map((name) => body.listTargets()[names.indexOf(name)].getAttribute('POSITION'));
  const p = [0, 0, 0], d = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  let touched = 0, moved = 0;
  for (let v = 0; v < P.getCount(); v += 1) {
    P.getElement(v, p);
    const base = apply(T, p, 1);
    let k = lift(base, hipY, hipZ);
    for (const S of shapes) { S.getElement(v, d); const m = apply(T, d, 0); k = Math.max(k, lift([base[0] + m[0], base[1] + m[1], base[2] + m[2]], hipY, hipZ)); }
    if (k <= 0) continue;
    J.getElement(v, j); W.getElement(v, w);
    const sum = new Map(); let up = 0;
    for (let i = 0; i < 4; i += 1) {
      if (!(w[i] > 0)) continue;
      let wi = w[i];
      if (legRoot.has(j[i])) { up += wi * k; wi *= 1 - k; }
      sum.set(j[i], (sum.get(j[i]) ?? 0) + wi);
    }
    if (up <= 1e-4) continue;
    sum.set(pelvis, (sum.get(pelvis) ?? 0) + up);
    const top = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4), s = top.reduce((acc, e) => acc + e[1], 0) || 1;
    J.setElement(v, [0, 1, 2, 3].map((i) => (top[i] ? top[i][0] : 0)));
    W.setElement(v, [0, 1, 2, 3].map((i) => (top[i] ? top[i][1] / s : 0)));
    touched += 1; moved += up;
  }
  await io.write(file, doc);
  log(`grown bump: thigh weight lifted onto ${joints[pelvis].getName()} on ${touched.toLocaleString('en-US')} vertices (${moved.toFixed(0)} vertex-weights); positions and shapes untouched`);
}

if (process.argv[1]?.endsWith('protectGrownBump.mjs')) await protectGrownBump(process.argv[2]);
