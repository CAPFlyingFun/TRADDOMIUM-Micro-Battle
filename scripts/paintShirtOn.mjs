/**
 * THE TEE PAINTED ON OVER THE BELLY (Joshua, 2026-10-13: of the dark crease along the
 * top of the belly in the red tee, "without the shirt it looks fine, so try painting it
 * over the belly, but leave that rounded neckline between the breasts"). Grown from her
 * skin and then bridged, the tee folded on itself in the crease under each breast, and
 * the fold's lip read as a dark line; laying its points back on the skin only crossed
 * the fold's layers into shards. So the tee there is REPLACED by her skin itself: from
 * above the bump's widest to just under the breasts, round the front and sides, the
 * body's own triangles are copied into the tee, a few millimetres out along the skin's
 * normal, with the body's own bone weights and every one of its shapes, and the tee's
 * own triangles there are taken out. Smooth wherever the skin is smooth, at every size,
 * by construction. Between the breasts the tee is left as it was, spanning them in its
 * rounded neckline. The copy takes the tee's fabric coordinates from the nearest point
 * of the tee. Only the shirt is written. Run on the shipped file.
 *
 *   node scripts/paintShirtOn.mjs public/models/sarah-base.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Where the tee is painted on, metres in her bind pose: from `Y0` to `Y1`; between the
 * breasts (|x| under `GAP_X`) above `GAP_Y` it is left alone; front and sides only
 * (z over `Z0`); `CLEAR` off the skin; the copy and the tee overlapping by `OVERLAP`
 * at every edge and by `OVER_GAP` more under the neckline. GAME TUNING. */
export const PAINT = Object.freeze({ Y0: 1.0, Y1: 1.235, GAP_X: 0.075, GAP_Y: 1.175, Z0: -0.06, CLEAR: 0.004, OVERLAP: 0.012, OVER_GAP: 0.012 });

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };

export async function paintShirtOn(file, { log = () => {} } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file);
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras().targetNames, skin = doc.getRoot().listSkins()[0];
  const T = mul(skin.listJoints()[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16)));
  const S = Math.hypot(T[0], T[1], T[2]);
  const toM = (a, i) => [T[0] * a[i] + T[4] * a[i + 1] + T[8] * a[i + 2] + T[12], T[1] * a[i] + T[5] * a[i + 1] + T[9] * a[i + 2] + T[13], T[2] * a[i] + T[6] * a[i + 1] + T[10] * a[i + 2] + T[14]];
  const shirt = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'shirt');
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  if (shirt.getExtras().paintedOn) { log('shirt: already painted on'); return; }
  const read = (A) => { const n = A.getCount(), k = A.getElementSize(), a = new Float64Array(n * k), v = new Array(k).fill(0); for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < k; c += 1) a[i * k + c] = v[c]; } return a; };
  // the copy reaches a little past where the tee is taken out, so the two overlap at
  // every edge and no gap opens between them; between the breasts the kept neckline
  // hangs over the copy, which runs on beneath it
  const window = (grow) => (m) => {
    const [x, y, z] = m; if (z < PAINT.Z0 - grow || y < PAINT.Y0 - grow || y > PAINT.Y1 + grow) return false;
    // the copy runs on under the neckline (seen through it from the side, only red);
    // the tee is kept there
    if (grow > 0) return true;
    return !(Math.abs(x) < PAINT.GAP_X - grow && y > PAINT.GAP_Y - 2 * PAINT.OVER_GAP);
  };
  const inside = window(PAINT.OVERLAP), core = window(-PAINT.OVERLAP);
  // the body's triangles inside, and the vertices they use
  const bP = read(body.getAttribute('POSITION')), bN = read(body.getAttribute('NORMAL')), bIdx = body.getIndices().getArray();
  const bIn = new Uint8Array(bP.length / 3); for (let i = 0; i < bIn.length; i += 1) bIn[i] = inside(toM(bP, i * 3)) ? 1 : 0;
  const tris = []; for (let f = 0; f < bIdx.length; f += 3) if (bIn[bIdx[f]] && bIn[bIdx[f + 1]] && bIn[bIdx[f + 2]]) tris.push(bIdx[f], bIdx[f + 1], bIdx[f + 2]);
  const used = [...new Set(tris)], at = new Map(used.map((v, k) => [v, k]));
  // the tee's triangles inside are taken out
  const sP = read(shirt.getAttribute('POSITION')), sIdx = shirt.getIndices().getArray(), sn = sP.length / 3;
  const sIn = new Uint8Array(sn); for (let i = 0; i < sn; i += 1) sIn[i] = core(toM(sP, i * 3)) ? 1 : 0;
  const keepTris = []; let dropped = 0;
  for (let f = 0; f < sIdx.length; f += 3) { if (sIn[sIdx[f]] && sIn[sIdx[f + 1]] && sIn[sIdx[f + 2]]) { dropped += 1; continue; } keepTris.push(sIdx[f], sIdx[f + 1], sIdx[f + 2]); }
  // nearest tee point for each copied vertex (its fabric coordinates and colour)
  const cell = 0.01 / S, grid = new Map();
  for (let i = 0; i < sn; i += 1) { const k = `${Math.floor(sP[i * 3] / cell)},${Math.floor(sP[i * 3 + 1] / cell)},${Math.floor(sP[i * 3 + 2] / cell)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const nearest = used.map((v) => {
    const x = bP[v * 3], y = bP[v * 3 + 1], z = bP[v * 3 + 2]; let best = -1, bd = Infinity;
    for (let r = 1; r <= 4 && best < 0; r += 1) for (let a = -r; a <= r; a += 1) for (let c = -r; c <= r; c += 1) for (let e = -r; e <= r; e += 1) for (const j of grid.get(`${Math.floor(x / cell) + a},${Math.floor(y / cell) + c},${Math.floor(z / cell) + e}`) || []) { if (sIn[j] && !keepTris.length) continue; const d = (sP[j * 3] - x) ** 2 + (sP[j * 3 + 1] - y) ** 2 + (sP[j * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = j; } }
    return best < 0 ? 0 : best;
  });
  const m = used.length, buffer = doc.getRoot().listBuffers()[0], clear = PAINT.CLEAR / S;
  const grow = (A, extra) => { const k = A.getElementSize(), old = read(A), out = new Float32Array((sn + m) * k); out.set(old); for (let i = 0; i < m; i += 1) for (let c = 0; c < k; c += 1) out[(sn + i) * k + c] = extra(i, c, k); return out; };
  const bAttr = (sem) => read(body.getAttribute(sem));
  for (const sem of shirt.listSemantics()) {
    const A = shirt.getAttribute(sem), type = A.getType();
    let arr;
    if (sem === 'POSITION') arr = grow(A, (i, c) => bP[used[i] * 3 + c] + clear * bN[used[i] * 3 + c] / (Math.hypot(bN[used[i] * 3], bN[used[i] * 3 + 1], bN[used[i] * 3 + 2]) || 1));
    else if (sem === 'NORMAL') arr = grow(A, (i, c) => bN[used[i] * 3 + c]);
    else if (sem === 'JOINTS_0' || sem === 'WEIGHTS_0') { const src = bAttr(sem); arr = grow(A, (i, c, k) => src[used[i] * k + c]); if (sem === 'JOINTS_0') arr = Uint16Array.from(arr); }
    else { const own = read(A); arr = grow(A, (i, c, k) => own[nearest[i] * k + c]); }
    shirt.setAttribute(sem, doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer));
  }
  const idx = new Uint32Array(keepTris.length + tris.length); idx.set(keepTris); for (let k = 0; k < tris.length; k += 1) idx[keepTris.length + k] = sn + at.get(tris[k]);
  shirt.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  // every shape, by name: the body's own move for the copied vertices
  shirt.listTargets().forEach((t, k) => {
    const bt = body.listTargets()[k];
    if (names[k] === undefined) throw new Error('target names out of step');
    for (const sem of ['POSITION', 'NORMAL']) {
      const A = t.getAttribute(sem); if (!A) continue;
      const src = bt?.getAttribute(sem) ? read(bt.getAttribute(sem)) : null;
      t.setAttribute(sem, doc.createAccessor().setType('VEC3').setArray(grow(A, (i, c) => (src ? src[used[i] * 3 + c] : 0))).setBuffer(buffer));
    }
  });
  shirt.setExtras({ ...shirt.getExtras(), paintedOn: true });
  await io.write(file, doc);
  log(`shirt: ${dropped.toLocaleString('en-US')} of its triangles under the bust and over the belly replaced by ${(tris.length / 3).toLocaleString('en-US')} of her skin's, ${PAINT.CLEAR * 1000} mm out; the neckline between the breasts untouched`);
}

if (process.argv[1]?.endsWith('paintShirtOn.mjs')) await paintShirtOn(process.argv[2], { log: console.log });
