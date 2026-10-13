/**
 * SARAH v2'S BELLY, HER OWN (Joshua, 2026-10-13: "Preserve its original 100% model...
 * V2 needs its own deformation system... V1 and V2 must use separate morph-generation
 * data. Fixing V2 must not change V1").
 *
 *  - 100% IS THE MASTER. Nothing here writes the body's own positions: the slider at
 *    100% shows exactly the mesh she was modelled with (her belly, bust, skin and
 *    navel), every belly target zero there. `bakeBellyV2` checks this and throws.
 *  - 0-100% shrink FROM that body: `bellyMorph`'s smaller sizes, then faired over the
 *    belly's own mapped area (the under-bust crease above, the pubis below, the
 *    flanks) so the bump's edge fades into her, with the navel held and the pubis
 *    drawn in toward the legs.
 *  - 100-200% are her own 100% bump carried further, forward and 20° down
 *    (`V2_GROWTH`): the same shape, longer and lower. The line from the pubis to the
 *    under-bust crease never moves, so the groin, the crease and the ribs stay where
 *    100% has them, and the bump's weight (tilt, bob, sway) never reaches the thighs.
 *  - The Lab's CURVE button shows a refined 100% (`bellyRefine`): the upper belly as
 *    one quintic Hermite curve, drawn toward v1's approved profile. Never the master.
 *  - The breasts are their own targets (`breast0`, `breast100`, `breastBob`); no belly
 *    size reaches above the under-bust crease.
 *  - 30% and 60% are added as v1's clothing pass adds them, so the Lab's stops are
 *    the same for both bodies.
 *
 * Shares `bellyMorph` and `roundProfile` with v1 READ-ONLY: v1's bake
 * (`roundBelly.mjs` `bakeRoundBelly`) is not called and not changed by anything here.
 */
import { roundProfile, blendNormals, NAVEL_HOLD_M } from './roundBelly.mjs';

const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/** The sizes below 100%, and how far along each is. */
export const V2_SMALL_SIZES = Object.freeze({ belly: 0, belly25: 0.25, belly50: 0.5, belly75: 0.75 });
/** The pubis drawn back toward the legs at 0%, less as the belly grows, metres
 * (Joshua: "the bottom of the belly near the pubic area is a little forward, you can
 * move it in closer between the legs"). GAME TUNING. */
export const V2_PUBIS_IN_M = 0.008;
/** Fairing passes (Taubin pairs) over each small size's skin: they fade the bump's
 * edge into the body ("between belly edge and body, add more smoothing"). GAME TUNING. */
export const V2_EDGE_PASSES = 30;
/** Over how much height a smaller size's move fades in on the thighs, metres. */
export const V2_THIGH_EASE = 0.1;
/** Passes smoothing a smaller size's move over the thighs and hips. */
export const V2_THIGH_PASSES = 60;
/** How far over the under-bust crease the small sizes' fairing reaches, fading to
 * nothing there, so the top of the belly meets the breasts without a step
 * (Joshua, 2026-10-13: "smooth more at the top of the belly area just under the
 * breasts"). GAME TUNING. */
export const V2_UNDERBUST_REACH = 0.012;

/**
 * V1'S APPROVED SIDE PROFILES, the reference v2's curve is drawn toward: the centre
 * line's height over the chord from the pubis (0.775 m) to the under-bust crease
 * (1.245 m), over its own peak, every twentieth of the way. MEASURED from alpha.91's
 * sarah-base.glb at 100, 150 and 200%, 2026-10-13. v1 is read, never written.
 */
export const V1_PROFILES = Object.freeze({
  belly100: Object.freeze([0, 0.25, 0.47, 0.64, 0.77, 0.87, 0.94, 0.98, 1, 1, 0.97, 0.93, 0.87, 0.78, 0.67, 0.55, 0.41, 0.27, 0.16, 0.07, 0]),
  belly150: Object.freeze([0, 0.26, 0.48, 0.64, 0.76, 0.86, 0.93, 0.98, 1, 1, 0.98, 0.94, 0.88, 0.8, 0.69, 0.56, 0.42, 0.28, 0.16, 0.07, 0]),
  belly200: Object.freeze([0, 0.26, 0.49, 0.65, 0.77, 0.86, 0.93, 0.98, 1, 1, 0.98, 0.95, 0.89, 0.82, 0.72, 0.59, 0.44, 0.29, 0.17, 0.07, 0]),
});
/** How far the refined 100% profile moves from her own toward v1's. GAME TUNING. */
export const V2_SHAPE_MIX = 0.85;
/** Fairing passes (Taubin pairs) after the curve is set. */
export const V2_CURVE_FAIR = 30;
/** How far out from the centre line the drawn curves reach, fading all the way, metres. */
export const V2_CURVE_WIDTH = 0.22;
/** The small sizes' lower outline: how many relaxing passes, and the size by which
 * they have faded out (0.75 of the way to 100%). GAME TUNING. */
export const V2_SOFTEN_PASSES = 40;
export const V2_SOFTEN_UNTIL = 0.75;
/** The U-ridge: how sharp skin must be to count (offset from its neighbours' middle
 * over their spacing), how many rings round it are relaxed with it, and how many
 * passes. GAME TUNING. */
export const V2_RIDGE_SHARP = 0.12;
export const V2_RIDGE_RINGS = 4;
export const V2_RIDGE_PASSES = 60;
/** THE GROWN SIZES (Joshua, 2026-10-13): each one's bump, as a multiple of her 100%
 * bump's reach in front of the pubis-to-crease line, carried along forward turned
 * down by the bump's own 20° sag (`BELLY_MOTION.tiltRad`), with this share of the
 * growth as breadth: 1/7 of 70% more makes her 10% wider at 200% (Joshua, 2026-10-13:
 * "the belly diameter can increase a max of 10% past 100%... 1% per 10%"). GAME
 * TUNING, the reach matched to the projection of the sizes it replaces. */
export const V2_GROWTH = Object.freeze({ belly150: 1.35, belly200: 1.7 });
export const V2_TILT_RAD = (20 * Math.PI) / 180;
export const V2_BREADTH = 1 / 7;
/** Skin less than this far in front of the line (the tops of the thighs, the flanks)
 * is not bump and does not grow; the growth eases in over the next 4 cm. GAME TUNING. */
export const V2_REACH_FROM = 0.03;
/** Fairing passes (Taubin pairs) over a grown bump. */
export const V2_GROWN_FAIR = 10;
/** The separate, switchable curve for her 100% body. */
export const V2_REFINE_TARGET = 'bellyRefine';

/** A new morph target on every primitive (zero on all but the body). */
function addTarget(doc, mesh, body, name, dPos, dNrm) {
  const names = [...(mesh.getExtras().targetNames || [])];
  if (names.includes(name)) throw new Error(`target ${name} exists`);
  const buffer = doc.getRoot().listBuffers()[0];
  for (const p of mesh.listPrimitives()) {
    const k = p.getAttribute('POSITION').getCount(), t = doc.createPrimitiveTarget(name);
    t.setAttribute('POSITION', doc.createAccessor(`${name}-POSITION`).setType('VEC3').setBuffer(buffer).setArray(p === body ? Float32Array.from(dPos) : new Float32Array(k * 3)));
    if (p.getAttribute('NORMAL') && p.listTargets()[0]?.getAttribute('NORMAL')) t.setAttribute('NORMAL', doc.createAccessor(`${name}-NORMAL`).setType('VEC3').setBuffer(buffer).setArray(p === body ? Float32Array.from(dNrm) : new Float32Array(k * 3)));
    p.addTarget(t);
  }
  names.push(name); mesh.setExtras({ ...mesh.getExtras(), targetNames: names }); mesh.setWeights([...mesh.getWeights(), 0]);
  for (const node of doc.getRoot().listNodes()) if (node.getMesh() === mesh && node.getWeights().length) node.setWeights([...node.getWeights(), 0]);
}

/** The welded skin: one representative per position, and its neighbours. */
function weld(base, idx) {
  const n = base.length / 3, key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i += 1) { const k = `${Math.round(base[i * 3] * 1e5)},${Math.round(base[i * 3 + 1] * 1e5)},${Math.round(base[i * 3 + 2] * 1e5)}`; if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
  const nb = new Map();
  const link = (a, b) => { if (a === b) return; let q = nb.get(a); if (!q) nb.set(a, (q = new Set())); q.add(b); };
  for (let f = 0; f < idx.length; f += 3) { const a = rep[idx[f]], b = rep[idx[f + 1]], c = rep[idx[f + 2]]; link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b); }
  return { rep, nb };
}

/** Each centimetre column's under-bust crease: the lowest front between the bump
 * and the breast, searched below `yTop`. */
function underBust(base, yTop) {
  const n = base.length / 3;
  const COLS = 48, X0 = -0.24, colOf = (x) => Math.floor((x - X0) / 0.01);
  const R = 40, Y0 = yTop - 0.08, DY = 0.12 / R;
  const best = Array.from({ length: COLS }, () => new Float32Array(R).fill(-Infinity));
  for (let i = 0; i < n; i += 1) {
    const c = colOf(base[i * 3]), r = Math.floor((base[i * 3 + 1] - Y0) / DY);
    if (c >= 0 && c < COLS && r >= 0 && r < R) best[c][r] = Math.max(best[c][r], base[i * 3 + 2]);
  }
  const crease = new Float32Array(COLS).fill(yTop);
  for (let c = 0; c < COLS; c += 1) {
    let lo = Infinity; for (let r = 0; r < R; r += 1) { const z = best[c][r]; if (Number.isFinite(z) && z < lo) { lo = z; crease[c] = Math.min(yTop, Y0 + (r + 0.5) * DY); } }
  }
  for (let p = 0; p < 4; p += 1) { const o = crease.slice(); for (let c = 1; c < COLS - 1; c += 1) crease[c] = Math.min(o[c], (o[c - 1] + o[c] + o[c + 1]) / 3); }
  const at = (x) => { const f = (x - X0) / 0.01 - 0.5, c = Math.max(0, Math.min(COLS - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - c)); return crease[c] * (1 - t) + crease[c + 1] * t; };
  return { at, lo: Math.min(...crease), hi: Math.max(...crease) };
}

function targetOf(mesh, body, name) { const i = (mesh.getExtras().targetNames || []).indexOf(name); return i < 0 ? null : body.listTargets()[i]; }

/** A size's normals as a delta over the base's: the change in the welded faces'
 * normals from `base` to `pos`, added to the base's own (authored) normal. */
function deltaNormals(pos, base, idx, rep, baseN) {
  const n = pos.length / 3;
  const faceN = (P) => {
    const fn = new Float32Array(n * 3);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], c = idx[f + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const qx = uy * vz - uz * vy, qy = uz * vx - ux * vz, qz = ux * vy - uy * vx;
      for (const x of [rep[a], rep[b], rep[c]]) { fn[x * 3] += qx; fn[x * 3 + 1] += qy; fn[x * 3 + 2] += qz; }
    }
    for (let i = 0; i < n; i += 1) { const l = Math.hypot(fn[i * 3], fn[i * 3 + 1], fn[i * 3 + 2]) || 1; fn[i * 3] /= l; fn[i * 3 + 1] /= l; fn[i * 3 + 2] /= l; }
    return fn;
  };
  const f0 = faceN(base), f1 = faceN(pos), out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const r = rep[i];
    const sign = f0[r * 3] * baseN[i * 3] + f0[r * 3 + 1] * baseN[i * 3 + 1] + f0[r * 3 + 2] * baseN[i * 3 + 2] < 0 ? -1 : 1;
    let x = baseN[i * 3] + sign * (f1[r * 3] - f0[r * 3]), y = baseN[i * 3 + 1] + sign * (f1[r * 3 + 1] - f0[r * 3 + 1]), z = baseN[i * 3 + 2] + sign * (f1[r * 3 + 2] - f0[r * 3 + 2]);
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    out[i * 3] = x - baseN[i * 3]; out[i * 3 + 1] = y - baseN[i * 3 + 1]; out[i * 3 + 2] = z - baseN[i * 3 + 2];
  }
  return out;
}

/** Normals of `pos` (a size of the body), as a delta over the base's. */
function normalDelta(pos, base, idx, rep, baseN, oldDelta) {
  const old = new Float32Array(baseN.length); for (let i = 0; i < old.length; i += 1) old[i] = baseN[i] + (oldDelta ? oldDelta[i] : 0);
  const nn = blendNormals(pos, base, idx, rep, old);
  return nn.map((v, i) => v - baseN[i]);
}

/**
 * The 30% and 60% keys, as v1's clothing pass makes them (`refineEarlyShirt`,
 * `refineEarlyWaist`): 30% is four fifths 25% and one fifth 50%, 60% three fifths 50%
 * and two fifths 75%. Without them the Lab showed 100% at those two stops, which is
 * what made v2's 0-100% read as random.
 */
export function addBetweenSizes(doc, { log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const added = [];
  for (const [name, a, b, f] of [['belly30', 'belly25', 'belly50', 0.2], ['belly60', 'belly50', 'belly75', 0.4]]) {
    const names = [...(mesh.getExtras().targetNames || [])];
    if (names.includes(name)) continue;
    const ia = names.indexOf(a), ib = names.indexOf(b); if (ia < 0 || ib < 0) continue;
    for (const p of mesh.listPrimitives()) {
      const t = doc.createPrimitiveTarget(name);
      for (const sem of p.listTargets()[ia].listSemantics()) {
        const A = p.listTargets()[ia].getAttribute(sem), bb = p.listTargets()[ib].getAttribute(sem).getArray();
        t.setAttribute(sem, doc.createAccessor(`${name}-${sem}`).setBuffer(A.getBuffer()).setType(A.getType()).setArray(Float32Array.from(A.getArray(), (v, i) => (1 - f) * v + f * bb[i])));
      }
      p.addTarget(t);
    }
    names.push(name); mesh.setExtras({ ...mesh.getExtras(), targetNames: names }); mesh.setWeights([...mesh.getWeights(), 0]);
    for (const node of doc.getRoot().listNodes()) if (node.getMesh() === mesh && node.getWeights().length) node.setWeights([...node.getWeights(), 0]);
    added.push(name);
  }
  if (added.length) log(`belly: ${added.join(' and ')} added between the sizes, as v1's`);
}

/** Quintic Hermite: value, slope and curvature at both ends, `u` in [0, 1]. */
export function quinticHermite(u, p0, v0, a0, p1, v1, a1, L) {
  const u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
  return p0 * (1 - 10 * u3 + 15 * u4 - 6 * u5) + v0 * L * (u - 6 * u3 + 8 * u4 - 3 * u5) + a0 * L * L * (u2 - 3 * u3 + 3 * u4 - u5) / 2
    + a1 * L * L * (u3 - 2 * u4 + u5) / 2 + v1 * L * (-4 * u3 + 7 * u4 - 3 * u5) + p1 * (10 * u3 - 15 * u4 + 6 * u5);
}

/**
 * THE UPPER BELLY AS ONE CURVE (Joshua, 2026-10-13: "Replace the nearly straight,
 * conical-looking slope beneath the bust with a gradually changing convex curve...
 * continuous tangent and curvature... Consider cubic Hermite or quintic
 * interpolation"). Column by column (1 cm), the front from the bump's widest row up
 * to that column's under-bust crease is replaced by a quintic Hermite curve that
 * starts at the widest point with the bump's own slope (none) and curvature, and
 * ends at the crease with the chest's own height, slope and no curvature: so it
 * leaves the bump and enters the ribs with no corner and no straight run. The
 * change is blurred across columns, faded toward the flanks, carried by the front
 * skin only, and faired. Positions are mutated.
 */
function upperCurve(pos, { n, nb, rep, zFront, crease, yBot, fairW: fairRegion }) {
  const COL = 0.01, ROWH = 0.005, X0 = -0.22, cols = 44, Y0 = yBot, rows = Math.ceil(0.55 / ROWH);
  const front = Array.from({ length: cols }, () => new Float32Array(rows).fill(-Infinity));
  const cOf = (x) => Math.floor((x - X0) / COL), rOf = (y) => Math.floor((y - Y0) / ROWH), yOf = (r) => Y0 + (r + 0.5) * ROWH;
  for (let i = 0; i < n; i += 1) { if (pos[i * 3 + 2] < zFront) continue; const c = cOf(pos[i * 3]), r = rOf(pos[i * 3 + 1]); if (c >= 0 && c < cols && r >= 0 && r < rows) front[c][r] = Math.max(front[c][r], pos[i * 3 + 2]); }
  const dz = Array.from({ length: cols }, () => new Float32Array(rows));
  for (let c = 0; c < cols; c += 1) {
    const f = front[c], x = X0 + (c + 0.5) * COL;
    // rows the front skips (a stretched bump's vertices lie further apart than a row)
    // read across from the rows either side
    for (let r = 1, last = Number.isFinite(f[0]) ? 0 : -1; r < rows; r += 1) {
      if (!Number.isFinite(f[r])) continue;
      if (last >= 0 && r - last > 1 && r - last < 12) for (let q = last + 1; q < r; q += 1) f[q] = f[last] + (f[r] - f[last]) * (q - last) / (r - last);
      last = r;
    }
    const g = f.slice(); for (let p = 0; p < 4; p += 1) { const o = g.slice(); for (let r = 1; r < rows - 1; r += 1) if (Number.isFinite(o[r - 1]) && Number.isFinite(o[r]) && Number.isFinite(o[r + 1])) g[r] = (o[r - 1] + 2 * o[r] + o[r + 1]) / 4; }
    // the widest row, below the crease
    const cap = Math.min(rows - 3, rOf(crease.at(x) + 0.05));
    let pk = -1; for (let r = 2; r < rOf(crease.at(x)) - 6; r += 1) if (Number.isFinite(g[r]) && (pk < 0 || g[r] > g[pk])) pk = r;
    if (pk < 0) continue;
    // THE CREASE IN THIS SIZE: the front's lowest point between the bump and the
    // breast. The curve arrives there level (it is a valley), bending up into the chest
    let top = -1; for (let r = pk + 6; r <= cap; r += 1) if (Number.isFinite(g[r]) && (top < 0 || g[r] < g[top])) top = r;
    if (top < 0 || top >= rows - 2 || g[pk] - g[top] < 0.02) continue;
    const L = yOf(top) - yOf(pk);
    const k = 6; if (pk - k < 0 || !Number.isFinite(g[pk - k]) || !Number.isFinite(g[pk + k])) continue;
    const a0 = Math.min(-0.5, (g[pk - k] - 2 * g[pk] + g[pk + k]) / (k * ROWH) ** 2);
    const v1 = 0, a1 = Number.isFinite(g[top - 2]) && Number.isFinite(g[top + 2]) ? Math.max(0, Math.min(40, (g[top - 2] - 2 * g[top] + g[top + 2]) / (2 * ROWH) ** 2)) : 0;
    for (let r = pk; r <= top; r += 1) {
      if (!Number.isFinite(g[r])) continue;
      const u = (yOf(r) - yOf(pk)) / L;
      const want = quinticHermite(u, g[pk], 0, a0, g[top], v1, a1, L);
      dz[c][r] = (want - g[r]) * smooth(V2_CURVE_WIDTH, 0.02, Math.abs(x));
    }
  }
  for (let p = 0; p < 3; p += 1) { const o = dz.map((a) => a.slice()); for (let c = 1; c < cols - 1; c += 1) for (let r = 0; r < rows; r += 1) dz[c][r] = (o[c - 1][r] + 2 * o[c][r] + o[c + 1][r]) / 4; }
  const at = (x, y) => {
    const fx = (x - X0) / COL - 0.5, fy = (y - Y0) / ROWH - 0.5;
    const c = Math.max(0, Math.min(cols - 2, Math.floor(fx))), r = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - c)), ty = Math.max(0, Math.min(1, fy - r));
    return (dz[c][r] * (1 - tx) + dz[c + 1][r] * tx) * (1 - ty) + (dz[c][r + 1] * (1 - tx) + dz[c + 1][r + 1] * tx) * ty;
  };
  let most = 0;
  for (const r of nb.keys()) {
    const x = pos[r * 3], y = pos[r * 3 + 1], z = pos[r * 3 + 2];
    if (z < zFront || Math.abs(x) > 0.22) continue;
    const c = cOf(x), row = rOf(y); if (c < 0 || c >= cols || row < 0 || row >= rows) continue;
    // the front skin carries the change; the inside of a fold does not
    const fz = front[c][row]; const w = Number.isFinite(fz) ? smooth(fz - 0.03, fz - 0.005, z) : 0;
    const d = at(x, y) * w; pos[r * 3 + 2] += d; most = Math.min(most, d);
  }
  const step = (lambda) => { const o = pos.slice(); for (const r of fairRegion) { const q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + lambda * (a / q.size - o[r * 3 + c]); } } };
  for (let p = 0; p < 30; p += 1) { step(0.5); step(-0.53); }
  for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
  return most;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {(doc: any, opts: any) => void} bellyMorph
 * @param {{ hipY: number, navel?: [number, number] | null, armParts?: string[] | null, log?: (s: string) => void }} opts
 */
export function bakeBellyV2(doc, bellyMorph, { hipY, navel = null, armParts = null, log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  const P0 = body.getAttribute('POSITION'), N0 = body.getAttribute('NORMAL');
  const master = new Float32Array(P0.getArray()), masterN = new Float32Array(N0.getArray());
  const n = master.length / 3, idx = body.getIndices().getArray();

  // ARMS DOWN: her hands hang beside the hips, inside every reading the belly takes,
  // so they are lifted out of the way for the bake, put back, and no target moves them
  const arm = new Uint8Array(n);
  if (armParts) {
    const J = body.getAttribute('JOINTS_0'), W = body.getAttribute('WEIGHTS_0'), j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let i = 0; i < n; i += 1) {
      J.getElement(i, j); W.getElement(i, w);
      let a = 0; for (let k = 0; k < 4; k += 1) if (armParts[j[k]] === 'arms' || armParts[j[k]] === 'upperArm') a += w[k];
      arm[i] = a > 0.5 ? 1 : 0;
    }
    const lifted = master.slice(); for (let i = 0; i < n; i += 1) if (arm[i]) lifted[i * 3 + 1] += 100;
    P0.setArray(lifted);
  }
  const base = new Float32Array(P0.getArray()), baseN = masterN;

  // 1. every size and the breasts, from her own body as it is
  bellyMorph(doc, { log });
  const { rep, nb } = weld(base, idx);
  // the arms are lifted out of the way for the bake: no smoothing may reach them, or
  // the skin of her side next to them is pulled a hundred metres up after them (the
  // sliver from the shoulder and the shadow under the arm, Joshua 2026-10-13)
  for (const [r, q] of nb) { if (arm[r]) { nb.delete(r); continue; } for (const u of [...q]) if (arm[u]) q.delete(u); if (!q.size) nb.delete(r); }

  // 2. the bump's own measure, read and NOT applied: where the under-bust crease is
  const probe = new Float32Array(base);
  const shape = roundProfile(probe, idx, { hipY, navel });
  if (!shape) throw new Error('Sarah v2 belly: no bump found on the master');
  const crease = underBust(base, shape.yTop);
  const yBot = hipY - 0.075;

  // 3. the smaller sizes, faired into the body over the belly's own area
  const free = [];
  for (const r of nb.keys()) {
    const x = base[r * 3], y = base[r * 3 + 1];
    if (Math.abs(x) < 0.22 && y > yBot - 0.07 && y < crease.at(x) + V2_UNDERBUST_REACH && baseN[r * 3 + 2] > -0.2) free.push(r);
  }
  const fairW = new Float32Array(n);
  for (const r of free) {
    const x = base[r * 3], y = base[r * 3 + 1], c = crease.at(x);
    let w = smooth(yBot - 0.07, yBot - 0.03, y) * smooth(c + V2_UNDERBUST_REACH, c - 0.03, y) * smooth(0.22, 0.17, Math.abs(x)) * smooth(-0.2, 0.15, baseN[r * 3 + 2]);
    if (navel) w *= smooth(NAVEL_HOLD_M, 2 * NAVEL_HOLD_M, Math.hypot(x - navel[0], y - navel[1]));
    fairW[r] = w;
  }
  // the band the lower outline runs through: the front of her from the tops of the
  // thighs to a hand above the pubis line, the navel well clear of it
  let zF = -Infinity;
  for (let i = 0; i < n; i += 1) { const x = base[i * 3], y = base[i * 3 + 1]; if (Math.abs(x) < 0.15 && y > yBot - 0.05 && y < yBot - 0.02) zF = Math.max(zF, base[i * 3 + 2]); }
  const lowW = new Float32Array(n);
  const lowBand = [...nb.keys()].filter((r) => {
    const x = base[r * 3], y = base[r * 3 + 1], z = base[r * 3 + 2];
    if (arm[r] || Math.abs(x) > 0.2 || y < yBot - 0.08 || y > yBot + 0.12 || z < zF - 0.05) return false;
    lowW[r] = smooth(yBot - 0.05, yBot - 0.01, y) * smooth(yBot + 0.12, yBot + 0.07, y) * smooth(0.2, 0.15, Math.abs(x)) * smooth(zF - 0.05, zF - 0.02, z);
    return lowW[r] > 0;
  });
  // where the U-ridge can run: the front of her from the tops of the thighs up past
  // the hips to the navel's height, the navel itself kept well clear
  const inZone = new Uint8Array(n), zoneW = new Float32Array(n), ridgeAt0 = new Set();
  const ridgeZone = [...nb.keys()].filter((r) => {
    const x = base[r * 3], y = base[r * 3 + 1];
    if (arm[r] || Math.abs(x) > 0.22 || y < yBot - 0.08 || y > yBot + 0.24 || baseN[r * 3 + 2] < -0.3) return false;
    if (navel && Math.hypot(x - navel[0], y - navel[1]) < 0.035) return false;
    inZone[r] = 1;
    // feathered at every edge of the zone, so the relaxing never leaves a step where it
    // stops (it had cut a ledge across both thighs at 0%, Joshua 2026-10-13)
    zoneW[r] = smooth(yBot - 0.045, yBot - 0.005, y) * smooth(yBot + 0.24, yBot + 0.18, y) * smooth(0.22, 0.17, Math.abs(x)) * smooth(-0.3, 0, baseN[r * 3 + 2]);
    return true;
  });
  for (const [name, s] of Object.entries(V2_SMALL_SIZES)) {
    const t = targetOf(mesh, body, name); if (!t) continue;
    const D = t.getAttribute('POSITION'), d = D.getArray().slice();
    // THE SIZE'S LOWER EDGE, EASED (Joshua, 2026-10-13: a line across both thighs "at
    // the fingertip point"): the shared bake ends each smaller size at a fixed height on
    // her thighs, a few millimetres of move to none between one row and the next. Below
    // the pubis line the move is now faded in over `V2_THIGH_EASE` from where it stops
    let yc = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (arm[i] || base[i * 3 + 1] > yBot || base[i * 3 + 2] < zF - 0.08) continue;
      if (Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]) > 0.0005) yc = Math.min(yc, base[i * 3 + 1]);
    }
    if (Number.isFinite(yc)) for (let i = 0; i < n; i += 1) {
      const y = base[i * 3 + 1]; if (y > yc + V2_THIGH_EASE) continue;
      const f = smooth(yc, yc + V2_THIGH_EASE, y); for (let c = 0; c < 3; c += 1) d[i * 3 + c] *= f;
    }
    // and the MOVE itself (not the skin) smoothed over the thighs and hips, so no row
    // can step: the shape of her legs is untouched, only how the size changes them
    {
      const band = [...nb.keys()].filter((r) => base[r * 3 + 1] < yBot + 0.06 && base[r * 3 + 1] > yc - 0.06);
      for (let p = 0; p < V2_THIGH_PASSES; p += 1) {
        const o = d.slice();
        for (const r of band) { const q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; d[r * 3 + c] = 0.5 * o[r * 3 + c] + 0.5 * a / q.size; } }
      }
      for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) d[i * 3 + c] = d[rep[i] * 3 + c];
    }
    const pos = new Float32Array(n * 3); for (let i = 0; i < pos.length; i += 1) pos[i] = base[i] + d[i];
    for (const r of free) {
      const x = base[r * 3], y = base[r * 3 + 1];
      const w = smooth(yBot - 0.05, yBot, y) * smooth(yBot + 0.08, yBot + 0.02, y) * smooth(0.11, 0.05, Math.abs(x)) * smooth(0.2, 0.6, baseN[r * 3 + 2]);
      pos[r * 3 + 2] -= V2_PUBIS_IN_M * (1 - s) * w;
    }
    const step = (lambda) => {
      const o = pos.slice();
      for (const r of free) {
        const w = fairW[r]; if (!w) continue;
        const q = nb.get(r);
        for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + lambda * w * (a / q.size - o[r * 3 + c]); }
      }
    };
    for (let p = 0; p < V2_EDGE_PASSES; p += 1) { step(0.5); step(-0.53); }
    // THE LOWER OUTLINE, SOFTENED (Joshua, 2026-10-13: "from 0 to like 40% the bottom
    // half belly outline is really hard - smooth the vertices like v1"): the master's
    // fold under its bump stays in the skin as a hard V once the bump is gone. At the
    // small sizes the skin over that fold, from the hips round under the belly, is
    // relaxed, most at 0%
    // and not at all by 75%
    const soften = (1 - Math.min(1, s / V2_SOFTEN_UNTIL)) ** 1.5;
    if (soften > 0) {
      // Taubin pairs (shrink, then swell back), so the thighs round it keep their
      // volume and no step is left where the softening fades out
      const relax = (set, wOf, passes) => {
        const step = (lambda) => { const o = pos.slice(); for (const r of set) { const w = lambda * wOf(r), q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + w * (a / q.size - o[r * 3 + c]); } } };
        for (let p = 0; p < passes; p += 1) { step(0.5); step(-0.53); }
      };
      relax(lowBand, (r) => soften * lowW[r], V2_SOFTEN_PASSES);
      // THE U-SHAPED RIDGE, FOUND IN THE SKIN ITSELF (Joshua: "that underbelly U-shaped
      // ridge... join the edges together or something to make it disappear"): where the
      // master's bump met her hips, this size's skin still folds sharply, a U from each
      // hip down under the belly. Each vertex's sharpness (how far it stands off the
      // middle of its neighbours, over their spacing) finds it wherever it runs; the
      // sharp skin and a few rings round it are relaxed until the fold is gone
      const sharp = new Float32Array(n);
      for (const r of ridgeZone) {
        const q = nb.get(r); let ax = 0, ay = 0, az = 0, len = 0;
        for (const u of q) { ax += pos[u * 3]; ay += pos[u * 3 + 1]; az += pos[u * 3 + 2]; len += Math.hypot(pos[u * 3] - pos[r * 3], pos[u * 3 + 1] - pos[r * 3 + 1], pos[u * 3 + 2] - pos[r * 3 + 2]); }
        const k = q.size; sharp[r] = Math.hypot(ax / k - pos[r * 3], ay / k - pos[r * 3 + 1], az / k - pos[r * 3 + 2]) / Math.max(1e-6, len / k);
      }
      let ring = new Set(ridgeZone.filter((r) => sharp[r] > V2_RIDGE_SHARP));
      const found = ring.size;
      for (let g = 0; g < V2_RIDGE_RINGS + (name === 'belly' ? 3 : 0); g += 1) { const next = new Set(ring); for (const r of ring) for (const u of nb.get(r)) if (inZone[u]) next.add(u); ring = next; }
      const ridge = [...ring];
      // the fold itself relaxed plainly (Taubin leaves a sharp fold standing), the
      // thighs below it kept out by the zone's feather
      for (let p = 0; p < V2_RIDGE_PASSES; p += 1) {
        const o = pos.slice();
        for (const r of ridge) { const w = 0.5 * soften * zoneW[r], q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + w * (a / q.size - o[r * 3 + c]); } }
      }
      log(`belly: ${name} U-ridge: ${found} sharp vertices, ${ridge.length} relaxed`);
      if (name === 'belly') for (const r of ridge) ridgeAt0.add(r);
    }
    for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
    D.setArray(pos.map((v, i) => v - base[i]));
    const TN = t.getAttribute('NORMAL'); if (TN) TN.setArray(normalDelta(pos, base, idx, rep, baseN, TN.getArray()));
  }

  // the bump's weight (tilt, bob, sway) never reaches the thighs, as v1's
  for (const name of ['bellyTilt', 'bellyBob', 'bellySway']) {
    const t = targetOf(mesh, body, name); if (!t) continue;
    for (const sem of ['POSITION', 'NORMAL']) {
      const A = t.getAttribute(sem); if (!A) continue;
      const d = A.getArray().slice();
      for (let i = 0; i < n; i += 1) { const f = smooth(hipY - 0.17, hipY - 0.11, base[i * 3 + 1]); for (let c = 0; c < 3; c += 1) d[i * 3 + c] *= f; }
      A.setArray(d);
    }
  }

  // 4. THE GROWN SIZES ARE HER 100% BUMP, CARRIED FURTHER (Joshua, 2026-10-13: "keep the
  // same overall shape from 100% (normal), but just extend downwards (apply the same
  // 20° tilt)"; "the groin area falls below the starting 100% height"). Every point of
  // the bump is measured by how far it stands in front of the straight line from the
  // pubis to the under-bust crease, and a grown size carries it that much further
  // again (`V2_GROWTH`), along forward turned down by `V2_TILT_RAD` (the bump's own
  // sag), with a little breadth. So 150% and 200% are the 100% belly's own curve, only
  // longer and lower: the line itself (pubis, groin, crease, ribs, the waist behind it)
  // never moves, the breasts are never reached, and nothing has to be cut, solved or
  // stitched where the bump meets the body.
  let zFront = -Infinity;
  for (let i = 0; i < n; i += 1) { const x = base[i * 3], y = base[i * 3 + 1]; if (Math.abs(x) < 0.15 && y > yBot - 0.05 && y < yBot - 0.02) zFront = Math.max(zFront, base[i * 3 + 2]); }
  {
    let zb = -Infinity, zt = -Infinity;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(base[i * 3]) > 0.02) continue;
      const y = base[i * 3 + 1];
      if (Math.abs(y - yBot) < 0.004) zb = Math.max(zb, base[i * 3 + 2]);
      if (Math.abs(y - shape.yTop) < 0.004) zt = Math.max(zt, base[i * 3 + 2]);
    }
    const chord = (y) => zb + (zt - zb) * (y - yBot) / (shape.yTop - yBot);
    const fwd = Math.cos(V2_TILT_RAD), down = Math.sin(V2_TILT_RAD);
    const reach = new Float32Array(n), breadth = new Float32Array(n);
    for (const r of nb.keys()) {
      if (arm[r]) continue;
      const x = base[r * 3], y = base[r * 3 + 1], h = base[r * 3 + 2] - chord(y);
      if (h <= 0) continue;
      const c = crease.at(x);
      const w = smooth(yBot, yBot + 0.03, y) * smooth(c + 0.005, c - 0.03, y);
      reach[r] = h * smooth(V2_REACH_FROM, V2_REACH_FROM + 0.04, h) * w;
      breadth[r] = x * smooth(V2_REACH_FROM, V2_REACH_FROM + 0.04, h) * w;
    }
    const fairW = new Float32Array(n);
    const region = [...nb.keys()].filter((r) => reach[r] > 0);
    for (const r of region) fairW[r] = navel ? smooth(NAVEL_HOLD_M, 2 * NAVEL_HOLD_M, Math.hypot(base[r * 3] - navel[0], base[r * 3 + 1] - navel[1])) : 1;
    for (const [name, k] of Object.entries(V2_GROWTH)) {
      const t = targetOf(mesh, body, name); if (!t) continue;
      const pos = new Float32Array(base);
      for (const r of region) {
        const e = (k - 1) * reach[r];
        pos[r * 3] += (k - 1) * V2_BREADTH * breadth[r];
        pos[r * 3 + 1] -= e * down;
        pos[r * 3 + 2] += e * fwd;
      }
      const step = (lambda) => { const o = pos.slice(); for (const r of region) { const w = lambda * fairW[r], q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + w * (a / q.size - o[r * 3 + c]); } } };
      for (let p = 0; p < V2_GROWN_FAIR; p += 1) { step(0.5); step(-0.53); }
      for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
      t.getAttribute('POSITION').setArray(pos.map((v, i) => v - base[i]));
      const TN = t.getAttribute('NORMAL'); if (TN) TN.setArray(normalDelta(pos, base, idx, rep, baseN, null));
      let most = 0; for (const r of region) most = Math.max(most, (k - 1) * reach[r]);
      log(`belly: ${name} is her 100% bump carried ${Math.round((k - 1) * 100)}% further, ${Math.round(V2_TILT_RAD * 180 / Math.PI)}° down (up to ${(most * 100).toFixed(1)} cm); the pubis, groin and crease stay where 100% has them`);
    }
  }

  // 5. her 100% curve, for comparison only (the Lab's CURVE): the upper belly drawn as
  // one quintic Hermite curve into the under-bust crease
  const upperFair = [...nb.keys()].filter((r) => { const x = base[r * 3], y = base[r * 3 + 1]; return Math.abs(x) < 0.18 && y > yBot + 0.15 && y < crease.at(x) - 0.004 + (Math.abs(x) < 0.06 ? 0.045 : 0) && base[r * 3 + 2] > zFront && (!navel || Math.hypot(x - navel[0], y - navel[1]) > 2 * NAVEL_HOLD_M); });
  const upperOpts = { n, nb, rep, zFront, crease, yBot, fairW: upperFair };
  // and the same curve for her 100%, NOT applied to the master: a separate target,
  // `bellyRefine`, that the Lab can switch on to compare (the master stays 100%)
  {
    const pos = new Float32Array(base);
    const info = roundProfile(pos, idx, { hipY, navel, shape: V1_PROFILES.belly100, mix: V2_SHAPE_MIX, yTopHint: shape.yTop, passes: V2_CURVE_FAIR });
    if (info) {
      upperCurve(pos, upperOpts);
      const dPos = pos.map((v, i) => v - base[i]);
      const dNrm = normalDelta(pos, base, idx, info.rep, baseN, null);
      addTarget(doc, mesh, body, V2_REFINE_TARGET, dPos, dNrm);
    }
  }
  addBetweenSizes(doc, { log });

  // 6. the arms back, still, and the master checked untouched
  P0.setArray(master); N0.setArray(masterN);
  for (const t of body.listTargets()) for (const sem of ['POSITION', 'NORMAL']) {
    const A = t.getAttribute(sem); if (!A) continue;
    const d = A.getArray().slice(); for (let i = 0; i < n; i += 1) if (arm[i]) d[i * 3] = d[i * 3 + 1] = d[i * 3 + 2] = 0;
    A.setArray(d);
  }
  // THE NORMALS, AGAIN, WITH HER ARMS WHERE THEY ARE (Joshua, 2026-10-13: a shadow
  // under each arm from 0 to 100% that went away past 100%). Every size's normals were
  // first read from faces built while the arms were lifted out of the way, and the
  // faces that join the arm to her side then pointed anywhere: the side under the arm,
  // which the smaller sizes move, took that as a dark patch. So each size's normals
  // are read once more from the finished body, arms down. And as a CHANGE: the turn
  // of each face between 100% and this size is added to her own authored normal, so
  // where the skin barely moves the shading is exactly hers (a hard switch to the
  // faces' own normals drew a jagged line across her thighs at 0%)
  const names = mesh.getExtras().targetNames || [];
  const sizeNames = new Set([...Object.keys(V2_SMALL_SIZES), 'belly30', 'belly60', ...Object.keys(V2_GROWTH), V2_REFINE_TARGET]);
  for (const name of sizeNames) {
    const t = body.listTargets()[names.indexOf(name)]; if (!t) continue;
    const TN = t.getAttribute('NORMAL'); if (!TN) continue;
    const d = t.getAttribute('POSITION').getArray();
    const pos = new Float32Array(n * 3); for (let i = 0; i < pos.length; i += 1) pos[i] = master[i] + d[i];
    TN.setArray(deltaNormals(pos, master, idx, rep, masterN));
  }
  const now = P0.getArray(); for (let i = 0; i < now.length; i += 1) if (now[i] !== master[i]) throw new Error('Sarah v2 belly: the 100% body moved');
  log(`belly: v2's own: 100% is the master untouched; 0-75% faired into her over ${free.length.toLocaleString('en-US')} vertices (under-bust ${crease.lo.toFixed(3)}-${crease.hi.toFixed(3)} m), pubis in ${(V2_PUBIS_IN_M * 1000).toFixed(0)} mm at 0%; 150-200% her 100% bump carried further; the switchable 100% refine drawn toward v1's profile`);
  return { fold: ridgeAt0, rep };
}

/**
 * THE FOLD'S PAINTED SHADOW (Joshua, 2026-10-13: the U-shaped line under the belly at
 * the small sizes "still looks like... no changes"). Rendered without its texture the
 * skin there is smooth: the line is PAINTED into her skin texture, the master's own
 * shadow in the fold under her 100% bump. That fold is tucked under the bump at 100%,
 * so the paint is lifted only there: over the fold's texels (found from the U-ridge
 * the small sizes relax), a texel darker than the skin round it is brought up to it,
 * feathered at the edge. Lighter detail is never touched, and nothing outside the fold.
 * Mutates the body's base colour texture.
 */
export async function paintOutFoldShadow(doc, { fold, rep }, { sharp, log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  const tex = body.getMaterial().getBaseColorTexture(); if (!tex || !fold.size) return;
  const UV = body.getAttribute('TEXCOORD_0'), idx = body.getIndices().getArray();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, mask = new Float32Array(W * H);
  const uv = [0, 0];
  const at = (i) => { UV.getElement(i, uv); return [uv[0] * W, uv[1] * H]; };
  // the fold's triangles, drawn into a mask
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    if (!fold.has(rep[a]) || !fold.has(rep[b]) || !fold.has(rep[c])) continue;
    const A = at(a), B = at(b), C = at(c);
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    if (x1 - x0 > W / 4 || y1 - y0 > H / 4) continue; // a triangle across a seam
    const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (Math.abs(d) < 1e-9) continue;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / d, l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / d;
      if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) mask[y * W + x] = 1;
    }
  }
  // feathered: a box blur of the mask, twice
  const blur1 = (src, r) => {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y += 1) { let s = 0; for (let x = -r; x <= r; x += 1) s += src[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x += 1) { tmp[y * W + x] = s / (2 * r + 1); s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x += 1) { let s = 0; for (let y = -r; y <= r; y += 1) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y += 1) { out[y * W + x] = s / (2 * r + 1); s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
    return out;
  };
  const R = Math.max(4, Math.round(W / 256));
  const soft = blur1(blur1(mask, R), R);
  let painted = 0; for (const v of mask) painted += v;
  // the skin round each texel: a wide blur of the texture itself, each channel
  const skin = [0, 1, 2].map((c) => { const ch = new Float32Array(W * H); for (let i = 0; i < W * H; i += 1) ch[i] = data[i * 3 + c]; return blur1(blur1(ch, 3 * R), 3 * R); });
  const out = Buffer.from(data);
  for (let i = 0; i < W * H; i += 1) {
    const m = Math.min(1, soft[i] * 1.5); if (m <= 0) continue;
    for (let c = 0; c < 3; c += 1) { const v = data[i * 3 + c], s = skin[c][i] * 1.02; if (s > v) out[i * 3 + c] = Math.round(v + (s - v) * m); }
  }
  tex.setImage(await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()).setMimeType('image/png');
  // the fold's relief is in the normal map too: there it is flattened to the skin's
  // own surface (the wide blur of the map), feathered the same way
  const ntex = body.getMaterial().getNormalTexture();
  if (ntex) {
    const n = await sharp(Buffer.from(ntex.getImage())).removeAlpha().resize(W, H).raw().toBuffer();
    const flat = [0, 1, 2].map((c) => { const ch = new Float32Array(W * H); for (let i = 0; i < W * H; i += 1) ch[i] = n[i * 3 + c]; return blur1(blur1(ch, 3 * R), 3 * R); });
    const nout = Buffer.from(n);
    for (let i = 0; i < W * H; i += 1) { const m = Math.min(1, soft[i] * 1.5); if (m > 0) for (let c = 0; c < 3; c += 1) nout[i * 3 + c] = Math.round(n[i * 3 + c] + (flat[c][i] - n[i * 3 + c]) * m); }
    ntex.setImage(await sharp(nout, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()).setMimeType('image/png');
  }
  log(`belly: the fold's painted shadow lifted over ${Math.round(painted).toLocaleString('en-US')} texels of the ${W}x${H} skin`);
}
