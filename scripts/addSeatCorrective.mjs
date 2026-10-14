/**
 * A SEATED CORRECTIVE FOR THE LOWER BELLY (Joshua, 2026-10-14: "Belly at 100%: if the
 * lower belly still has a slight point while sitting, try a subtle pose-specific
 * corrective morph. Do not modify the approved standing geometry.").
 *
 * WHY THERE IS A POINT. Seated, each thigh rises to 80° and its top passes in front of
 * the lower flank of the bump. Seen from the front the two thighs cover the bump's
 * lower sides and leave only a V between them; measured on the posed, skinned body,
 * about 280 vertices of lower-belly skin at 100% end up behind the thighs' front
 * surface. The pose cannot clear it: spreading the knees 5° more and turning the
 * thighs out changed that count by under 10%.
 *
 * WHAT THIS ADDS. One shape, `bellySeat`, which the Lab turns on only while she sits
 * (`seatCorrectiveWeight` in `src/sarahlab/sarahLabTool.ts`). It carries the lower
 * flanks of the bump a little forward and up, so they ride over the tops of the
 * thighs rather than behind them and the bottom of the bump reads round again. At
 * weight 0 (standing, walking, every belly size) it is nothing, so the approved
 * standing geometry is untouched by construction.
 *
 * WHAT IT IS NOT. It is not soft tissue: nothing here compresses, bulges or answers to
 * contact. That is a separate, later layer (Joshua: "keep the pelvis-weight correction
 * separate from future pose-dependent soft-tissue deformation… don't add that physics
 * yet"), and so is the pelvis weighting (`protectGrownBump.mjs`), which decides which
 * BONE carries the bump and stays independent of both.
 *
 * Every primitive gets the target (glTF needs one count per mesh): the body its shape,
 * each garment the shape of the skin under it, so a shirt or leggings move with the
 * flank they cover. Run `fitMeshyBikini.mjs` afterwards; it copies every body shape.
 *
 *   node scripts/addSeatCorrective.mjs <sarah.glb>     (writes it in place)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const SEAT_TARGET = 'bellySeat';
/**
 * GAME TUNING against seated renders, metres on her bind (100%) body. The lower flank:
 * `LOW` heights (full between the middle two), `FLANK` distances from the midline (the
 * same), ahead of the hip joints by at least `FRONT`; `FORWARD` and `UP` are the move
 * at the middle of that region, smoothly less toward its edges.
 */
export const SEAT_SHAPE = Object.freeze({
  LOW: [0.78, 0.85, 0.91, 1.03],
  FLANK: [0.0, 0.06, 0.11, 0.21],
  FRONT: [0.02, 0.06],
  FORWARD: 0.04,
  UP: 0.008,
  OUT: 0.006,
});

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const band = ([a, b, c, d], x) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const read = (A) => { const n = A.getCount(), s = A.getElementSize(), out = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) out[i * s + c] = v[c]; } return out; };

/** The corrective's move, metres, for skin at `p` (metres, bind) whose thigh share is `leg`. */
export function seatMove(p, leg, hipZ) {
  const S = SEAT_SHAPE, ax = Math.abs(p[0]);
  const k = band(S.LOW, p[1]) * band(S.FLANK, ax) * smoothstep(S.FRONT[0], S.FRONT[1], p[2] - hipZ) * (1 - smoothstep(0.2, 0.5, leg));
  return [Math.sign(p[0] || 1) * S.OUT * k, S.UP * k, S.FORWARD * k];
}

export async function addSeatCorrective(file, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file);
  const skin = doc.getRoot().listSkins()[0], joints = skin.listJoints();
  const T = mul(joints[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T);
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  const pelvis = kids.findIndex((c) => c.length >= 3), at = joints.map((j) => j.getWorldTranslation());
  const hips = kids[pelvis].filter((c) => at[c][1] < at[pelvis][1] + 1e-6 && kids[c].length > 0).sort((a, b) => at[a][1] - at[b][1]).slice(0, 2);
  const hipZ = (at[hips[0]][2] + at[hips[1]][2]) / 2;
  const legSet = new Set(); const down = (k) => { legSet.add(k); kids[k].forEach(down); }; hips.forEach(down);
  const mesh = doc.getRoot().listMeshes()[0], names = [...mesh.getExtras().targetNames];
  const buffer = doc.getRoot().listBuffers()[0], acc = (array) => doc.createAccessor().setType('VEC3').setArray(array).setBuffer(buffer);
  // the body's move, in metres, and a grid of its moved vertices for the garments
  const body = mesh.listPrimitives()[0], bRaw = read(body.getAttribute('POSITION')), bn = bRaw.length / 3;
  const bJ = read(body.getAttribute('JOINTS_0')), bW = read(body.getAttribute('WEIGHTS_0'));
  const bPos = new Float32Array(bRaw.length), bMove = new Float32Array(bRaw.length);
  const CELL = 0.01, grid = new Map(), key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  let moved = 0, most = 0;
  for (let i = 0; i < bn; i += 1) {
    const p = apply(T, [bRaw[i * 3], bRaw[i * 3 + 1], bRaw[i * 3 + 2]], 1); bPos.set(p, i * 3);
    let leg = 0; for (let c = 0; c < 4; c += 1) if (legSet.has(bJ[i * 4 + c])) leg += bW[i * 4 + c];
    const d = seatMove(p, leg, hipZ); bMove.set(d, i * 3);
    const l = Math.hypot(...d); if (l > 1e-6) { moved += 1; most = Math.max(most, l); const k = key(...p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  }
  const prims = mesh.listPrimitives();
  for (const prim of prims) {
    const old = prim.listTargets().find((t) => t.getName() === SEAT_TARGET);
    if (old) { prim.removeTarget(old); old.dispose(); }
    const raw = read(prim.getAttribute('POSITION')), n = raw.length / 3, delta = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      let d;
      if (prim === body) d = [bMove[i * 3], bMove[i * 3 + 1], bMove[i * 3 + 2]];
      else { // a garment takes the move of the nearest moved skin, within a centimetre and a half
        const p = apply(T, [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]], 1); let best = -1, bd = 0.015 ** 2;
        const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
        for (let a = -2; a <= 2; a += 1) for (let b = -2; b <= 2; b += 1) for (let c = -2; c <= 2; c += 1) { const l = grid.get(`${cx + a},${cy + b},${cz + c}`); if (l) for (const j of l) { const e = (bPos[j * 3] - p[0]) ** 2 + (bPos[j * 3 + 1] - p[1]) ** 2 + (bPos[j * 3 + 2] - p[2]) ** 2; if (e < bd) { bd = e; best = j; } } }
        d = best < 0 ? [0, 0, 0] : [bMove[best * 3], bMove[best * 3 + 1], bMove[best * 3 + 2]];
      }
      delta.set(apply(Ti, d, 0), i * 3);
    }
    const t = doc.createPrimitiveTarget(SEAT_TARGET).setAttribute('POSITION', acc(delta));
    if (prim.listTargets()[0]?.getAttribute('NORMAL')) t.setAttribute('NORMAL', acc(new Float32Array(n * 3)));
    prim.addTarget(t);
  }
  if (!names.includes(SEAT_TARGET)) names.push(SEAT_TARGET);
  mesh.setExtras({ ...mesh.getExtras(), targetNames: names });
  const w = mesh.getWeights(); if (w.length && w.length < names.length) mesh.setWeights([...w, 0]);
  await io.write(file, doc);
  log(`seat corrective: ${SEAT_TARGET} on ${moved.toLocaleString('en-US')} body vertices, at most ${(most * 1000).toFixed(1)} mm; every primitive carries it`);
}

if (process.argv[1]?.endsWith('addSeatCorrective.mjs')) await addSeatCorrective(process.argv[2]);
