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
 *  - 100-200% grow past it: `bellyMorph`'s grown sizes, rounded toward the late
 *    photographs (`REF_LATE`), as v1's were, but over her own unrounded body.
 *  - The groin, the pelvis and the tops of the thighs are anchored in every size
 *    (`anchor`), and the bump's weight (tilt, bob, sway) never reaches the thighs.
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
/** The grown sizes, rounded toward the late photographs. */
export const V2_GROWN_SIZES = Object.freeze(['belly150', 'belly200']);
/** The pubis drawn back toward the legs at 0%, less as the belly grows, metres
 * (Joshua: "the bottom of the belly near the pubic area is a little forward, you can
 * move it in closer between the legs"). GAME TUNING. */
export const V2_PUBIS_IN_M = 0.008;
/** Fairing passes (Taubin pairs) over each small size's skin: they fade the bump's
 * edge into the body ("between belly edge and body, add more smoothing"). GAME TUNING. */
export const V2_EDGE_PASSES = 30;
/** Where the anchor holds, metres below the pubis line (`hipY - 0.075`): the tops of
 * the thighs are still below `ANCHOR_FROM`; the pubic mound above it may move a
 * little with the bump (holding it too tore the skin where the bump meets the groin,
 * 2026-10-13). GAME TUNING. */
export const V2_ANCHOR_FROM = -0.07;
export const V2_ANCHOR_TO = -0.07;
/** The fold between the bump and the anchored groin: skin within this distance,
 * along the skin, of the anchored skin, metres. GAME TUNING. */
export const V2_FOLD_REACH = 0.05;
/** Relaxation sweeps solving the fold's move. */
export const V2_FOLD_ITERATIONS = 400;
/** Fairing passes (Taubin pairs) over the fold in every size. */
export const V2_FOLD_FAIR = 60;
/** How far past the fold, along the skin, that fairing reaches (fading). */
export const V2_FOLD_FAIR_BEYOND = 0.1;

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
/** How far each profile moves from its own toward v1's. GAME TUNING. */
export const V2_SHAPE_MIX = 0.85;
/** Fairing passes (Taubin pairs) after the curve is set. */
export const V2_CURVE_FAIR = 30;
/** How far out from the centre line the drawn curves reach, fading all the way, metres. */
export const V2_CURVE_WIDTH = 0.22;
/** Plain relaxing passes over the fold of a grown size, which take in a flap. */
export const V2_FOLD_RELAX = 80;
/** The small sizes' lower outline: how many relaxing passes, and the size by which
 * they have faded out (0.75 of the way to 100%). GAME TUNING. */
export const V2_SOFTEN_PASSES = 40;
export const V2_SOFTEN_UNTIL = 0.75;
/** How far along the skin from the fold the still groin joins its smoothing, metres. */
export const V2_GROIN_MERGE = 0.03;
/** The groin under a hanging bump settles this far behind its underside, at most
 * this far from where her 100% body has it, metres. */
export const V2_REST_GAP = 0.004;
export const V2_REST_MAX = 0.03;
/** Sweeps settling the fold of a grown size into a membrane. */
export const V2_WEB_ITERATIONS = 400;
/** The top of a grown belly held at her 100% body: how much, and from how far up
 * between the widest row (0) and the crease (1) it starts. GAME TUNING. */
export const V2_TOP_HOLD = 0.6;
export const V2_TOP_HOLD_FROM = 0.5;
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
    if (Math.abs(x) < 0.22 && y > yBot - 0.07 && y < crease.at(x) - 0.005 && baseN[r * 3 + 2] > -0.2) free.push(r);
  }
  const fairW = new Float32Array(n);
  for (const r of free) {
    const x = base[r * 3], y = base[r * 3 + 1], c = crease.at(x);
    let w = smooth(yBot - 0.07, yBot - 0.03, y) * smooth(c - 0.005, c - 0.03, y) * smooth(0.22, 0.17, Math.abs(x)) * smooth(-0.2, 0.15, baseN[r * 3 + 2]);
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
    lowW[r] = smooth(yBot - 0.08, yBot - 0.04, y) * smooth(yBot + 0.12, yBot + 0.07, y) * smooth(0.2, 0.15, Math.abs(x)) * smooth(zF - 0.05, zF - 0.02, z);
    return lowW[r] > 0;
  });
  for (const [name, s] of Object.entries(V2_SMALL_SIZES)) {
    const t = targetOf(mesh, body, name); if (!t) continue;
    const D = t.getAttribute('POSITION'), d = D.getArray();
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
    // relaxed plainly (it may settle in a little, which is the point), most at 0%
    // and not at all by 75%
    const soften = (1 - Math.min(1, s / V2_SOFTEN_UNTIL)) ** 1.5;
    if (soften > 0) {
      for (let p = 0; p < V2_SOFTEN_PASSES; p += 1) {
        const o = pos.slice();
        for (const r of lowBand) { const w = 0.5 * soften * lowW[r], q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + w * (a / q.size - o[r * 3 + c]); } }
      }
    }
    for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
    D.setArray(pos.map((v, i) => v - base[i]));
    const TN = t.getAttribute('NORMAL'); if (TN) TN.setArray(normalDelta(pos, base, idx, rep, baseN, TN.getArray()));
  }

  // 4. the anchor: the groin, the pelvis and the tops of the thighs hold still in
  // every size and under the bump's weight. Still means BEHIND the bump: below the
  // pubis line, skin no further forward than the pubis and thighs there. The bump
  // itself (well in front of them, or above the line) moves as built. The skin of the
  // fold between the two takes neither: its move is SOLVED from theirs, the smoothest
  // move that meets both (harmonic, over the welded skin), so the fold stretches
  // evenly instead of tearing or crumpling at a cut
  let zFront = -Infinity;
  for (let i = 0; i < n; i += 1) { const x = base[i * 3], y = base[i * 3 + 1]; if (Math.abs(x) < 0.15 && y > yBot - 0.05 && y < yBot - 0.02) zFront = Math.max(zFront, base[i * 3 + 2]); }
  const STILL = 0, MOVES = 1, FOLD = 2;
  const kind = new Uint8Array(n).fill(MOVES);
  for (const r of nb.keys()) {
    const y = base[r * 3 + 1], z = base[r * 3 + 2];
    if (arm[r] || y < yBot + V2_ANCHOR_FROM || (y < yBot + V2_ANCHOR_TO && z < zFront + 0.01)) kind[r] = STILL;
  }
  // the fold: skin within `V2_FOLD_REACH` of the still skin, measured ALONG the skin,
  // so the bump's round underside a hand's width away is untouched
  const dist = new Float32Array(n).fill(Infinity);
  const near = [...nb.keys()].filter((r) => base[r * 3 + 1] < yBot + 0.15);
  for (const r of near) if (kind[r] === STILL) dist[r] = 0;
  for (let sweep = 0; sweep < 80; sweep += 1) {
    let changed = false;
    for (const r of near) {
      if (kind[r] === STILL) continue;
      let best = dist[r];
      for (const u of nb.get(r)) { const l = dist[u] + Math.hypot(base[u * 3] - base[r * 3], base[u * 3 + 1] - base[r * 3 + 1], base[u * 3 + 2] - base[r * 3 + 2]); if (l < best) best = l; }
      if (best < dist[r]) { dist[r] = best; changed = true; }
    }
    if (!changed) break;
  }
  for (const r of near) if (kind[r] !== STILL && dist[r] < V2_FOLD_REACH) kind[r] = FOLD;
  // and the other way: how far, along the skin, each still vertex is from skin that moves
  const fromMoving = new Float32Array(n).fill(Infinity);
  for (const r of near) if (kind[r] !== STILL) fromMoving[r] = 0;
  for (let sweep = 0; sweep < 40; sweep += 1) {
    let changed = false;
    for (const r of near) {
      if (kind[r] !== STILL) continue;
      let best = fromMoving[r];
      for (const u of nb.get(r)) { const l = fromMoving[u] + Math.hypot(base[u * 3] - base[r * 3], base[u * 3 + 1] - base[r * 3 + 1], base[u * 3 + 2] - base[r * 3 + 2]); if (l < best) best = l; }
      if (best < fromMoving[r]) { fromMoving[r] = best; changed = true; }
    }
    if (!changed) break;
  }
  const fold = [...nb.keys()].filter((r) => kind[r] === FOLD);
  const solve = (d) => {
    const D = new Float32Array(n * 3);
    for (const r of nb.keys()) if (kind[r] === MOVES) for (let c = 0; c < 3; c += 1) D[r * 3 + c] = d[r * 3 + c];
    for (let it = 0; it < V2_FOLD_ITERATIONS; it += 1) {
      for (const r of fold) { const q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += D[u * 3 + c]; D[r * 3 + c] = a / q.size; } }
    }
    const out = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) for (let c = 0; c < 3; c += 1) out[i * 3 + c] = D[rep[i] * 3 + c];
    return out;
  };
  // the fairing reaches past the fold onto the bump's underside, fading out, so the
  // edge where the solved fold meets the grown bump is rounded too
  const fairBand = near.filter((r) => kind[r] !== STILL && dist[r] < V2_FOLD_REACH + V2_FOLD_FAIR_BEYOND);
  const fairBandW = new Float32Array(n); for (const r of fairBand) fairBandW[r] = smooth(V2_FOLD_REACH + V2_FOLD_FAIR_BEYOND, V2_FOLD_REACH, dist[r]) * smooth(0, 0.01, dist[r]);
  for (const name of V2_GROWN_SIZES) {
    const t = targetOf(mesh, body, name); if (!t) continue;
    const A = t.getAttribute('POSITION'), d = solve(A.getArray());
    // a stretched fold carries the master's small creases with it: fair it
    const pos = new Float32Array(n * 3); for (let i = 0; i < pos.length; i += 1) pos[i] = base[i] + d[i];
    const step = (lambda) => {
      const o = pos.slice();
      for (const r of fairBand) { const w = lambda * fairBandW[r], q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + w * (a / q.size - o[r * 3 + c]); } }
    };
    for (let p = 0; p < V2_FOLD_FAIR; p += 1) { step(0.5); step(-0.53); }
    for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
    A.setArray(pos.map((v, i) => v - base[i]));
    const TN = t.getAttribute('NORMAL'); if (TN) TN.setArray(normalDelta(pos, base, idx, rep, baseN, solve(TN.getArray())));
  }
  // the smaller sizes draw the belly IN, toward the body, and are left as faired
  // above; the bump's weight (tilt, bob, sway) never reaches the thighs, as v1's
  for (const name of ['bellyTilt', 'bellyBob', 'bellySway']) {
    const t = targetOf(mesh, body, name); if (!t) continue;
    for (const sem of ['POSITION', 'NORMAL']) {
      const A = t.getAttribute(sem); if (!A) continue;
      const d = A.getArray().slice();
      for (let i = 0; i < n; i += 1) { const f = smooth(hipY - 0.17, hipY - 0.11, base[i * 3 + 1]); for (let c = 0; c < 3; c += 1) d[i * 3 + c] *= f; }
      A.setArray(d);
    }
  }
  // 5. THE CURVE (Joshua, 2026-10-13: "G2-continuous abdominal curvature... compare
  // normalized side-profile curves rather than matching vertex indices"). Each grown
  // size's centre-line profile, as height over the chord from the pubis to the
  // under-bust crease over its own peak, is moved `V2_SHAPE_MIX` of the way to v1's
  // approved profile at the same size (`V1_PROFILES`): a convex shoulder under the
  // bust instead of a straight cone, a round underside instead of a shelf. The peak's
  // depth is kept (same projection); below the pubis line nothing moves; the navel is
  // held; the change is shared across the belly and faired.
  // the upper belly's fairing: below each column's crease (and over it between the
  // breasts, where the curve ends), above the bump's middle, never the navel
  const upperFair = [...nb.keys()].filter((r) => { const x = base[r * 3], y = base[r * 3 + 1]; return Math.abs(x) < 0.18 && y > yBot + 0.15 && y < crease.at(x) - 0.004 + (Math.abs(x) < 0.06 ? 0.045 : 0) && base[r * 3 + 2] > zFront && (!navel || Math.hypot(x - navel[0], y - navel[1]) > 2 * NAVEL_HOLD_M); });
  const upperOpts = { n, nb, rep, zFront, crease, yBot, fairW: upperFair };
  for (const name of V2_GROWN_SIZES) {
    const t = targetOf(mesh, body, name); if (!t) continue;
    const D = t.getAttribute('POSITION'), d = D.getArray();
    const pos = new Float32Array(n * 3); for (let i = 0; i < pos.length; i += 1) pos[i] = base[i] + d[i];
    // a grown bump hangs below the pubis line: its curve runs from its own lowest
    // front (the first row up where it stands 3 cm proud of the pubis)
    let low = yBot;
    for (let y = yBot - 0.1; y < yBot; y += 0.0025) {
      let z = -Infinity; for (let i = 0; i < n; i += 1) if (Math.abs(pos[i * 3]) < 0.12 && Math.abs(pos[i * 3 + 1] - y) < 0.00125) z = Math.max(z, pos[i * 3 + 2]);
      if (z > zFront + 0.03) { low = y - 0.005; break; }
    }
    const info = roundProfile(pos, idx, { hipY, navel, shape: V1_PROFILES[name], mix: V2_SHAPE_MIX, yTopHint: shape.yTop, passes: V2_CURVE_FAIR, bottomY: Math.min(yBot, low) });
    if (!info) continue;
    // the low skin of the bump faired, so its rounding carries no edge
    {
      const band = [...nb.keys()].filter((r) => { const y = base[r * 3 + 1]; return y > yBot - 0.12 && y < yBot + 0.1 && base[r * 3 + 2] > zFront - 0.02 && kind[r] !== STILL; });
      const step = (lambda) => { const o = pos.slice(); for (const r of band) { const q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + lambda * (a / q.size - o[r * 3 + c]); } } };
      for (let p = 0; p < 20; p += 1) { step(0.5); step(-0.53); }
      for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
      log(`belly: ${name} curve from ${Math.min(yBot, low).toFixed(3)} to ${shape.yTop.toFixed(3)} m`);
    }
    const pulled = upperCurve(pos, upperOpts);
    // where the grown bump meets the groin, the skin is relaxed (plain, shrinking
    // smoothing) so a flap pulls back into the curve it hangs from
    {
      // ... and the groin round it (Joshua: "150% or greater the groin area starts
      // breaking and needs to merge/smooth... between the legs, groin, and bottom
      // belly"): the still skin within a few centimetres joins the relaxing, held
      // more the further it is from the fold, so the join between them merges
      const fold = near.filter((r) => (kind[r] !== STILL || fromMoving[r] < V2_GROIN_MERGE) && base[r * 3 + 1] < yBot + 0.05 && base[r * 3 + 1] > yBot - 0.09);
      const fw = new Float32Array(n); for (const r of fold) fw[r] = kind[r] === STILL ? 0.5 * smooth(V2_GROIN_MERGE, 0, fromMoving[r]) : 0.5;
      for (let p = 0; p < V2_FOLD_RELAX; p += 1) {
        const o = pos.slice();
        for (const r of fold) { const w = fw[r], q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += o[u * 3 + c]; pos[r * 3 + c] = o[r * 3 + c] + w * (a / q.size - o[r * 3 + c]); } }
      }
      // then the fold itself drawn as a MEMBRANE between the bump and the groin: its
      // skin settles to the smoothest surface its edges allow (harmonic, in place),
      // so the master's small creases there cannot crumple or cross through
      const web = near.filter((r) => (kind[r] === FOLD || (kind[r] === STILL && fromMoving[r] < V2_GROIN_MERGE)) && base[r * 3 + 1] < yBot + 0.08 && base[r * 3 + 1] > yBot - 0.08 && base[r * 3 + 2] > zFront - 0.06);
      log(`belly: ${name} fold membrane over ${web.length} vertices`);
      for (let it = 0; it < V2_WEB_ITERATIONS; it += 1) {
        for (const r of web) { const q = nb.get(r); for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of q) a += pos[u * 3 + c]; pos[r * 3 + c] = a / q.size; } }
      }
      for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
    }
    // THE TOP HELD (Joshua, 2026-10-13: "keep the top part of the belly fixed beyond
    // 100%, but also leave the shape now, so do a combination/hybrid"): under the bust
    // a grown size stays where her 100% body is, letting go down the curve, so the new
    // shape carries the growth below and the top of the belly does not climb the ribs
    for (const r of nb.keys()) {
      const x = base[r * 3], y = base[r * 3 + 1];
      if (Math.abs(x) > 0.2 || base[r * 3 + 2] < zFront) continue;
      const c = crease.at(x), from = info.yPeak + V2_TOP_HOLD_FROM * (c - info.yPeak);
      const w = V2_TOP_HOLD * smooth(from, c - 0.01, y) * smooth(c + 0.04, c + 0.01, y) * smooth(V2_CURVE_WIDTH, 0.04, Math.abs(x));
      if (w > 0) for (let k = 0; k < 3; k += 1) pos[r * 3 + k] += (base[r * 3 + k] - pos[r * 3 + k]) * w;
    }
    {
      const step = (lambda) => { const o = pos.slice(); for (const r of upperFair) { const q = nb.get(r); for (let k = 0; k < 3; k += 1) { let a = 0; for (const u of q) a += o[u * 3 + k]; pos[r * 3 + k] = o[r * 3 + k] + lambda * (a / q.size - o[r * 3 + k]); } } };
      for (let p = 0; p < 20; p += 1) { step(0.5); step(-0.53); }
      for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let k = 0; k < 3; k += 1) pos[i * 3 + k] = pos[rep[i] * 3 + k];
    }
    // THE BUMP RESTS ON THE GROIN, NEVER THROUGH IT: a grown bump hangs over the still
    // pubis. Wherever the bump's underside comes down over it, the groin's skin under
    // it settles a few millimetres behind, so the two never cross; then that skin is
    // relaxed so it settles smoothly
    let settled = 0;
    {
      const H = 0.004, cellOf = (x, y) => `${Math.floor(x / H)},${Math.floor(y / H)}`;
      const under = new Map();
      for (const r of nb.keys()) {
        if (kind[r] === STILL) continue;
        const dz = pos[r * 3 + 2] - base[r * 3 + 2], dy = pos[r * 3 + 1] - base[r * 3 + 1];
        if (Math.hypot(dz, dy) < 0.01 || base[r * 3 + 1] < yBot - 0.03) continue;
        const k = cellOf(pos[r * 3], pos[r * 3 + 1]); const z = pos[r * 3 + 2];
        if (!under.has(k) || z < under.get(k)) under.set(k, z);
      }
      const moved = [];
      for (const r of nb.keys()) {
        if (kind[r] !== STILL && kind[r] !== FOLD) continue;
        const x = pos[r * 3], y = pos[r * 3 + 1];
        if (Math.abs(x) > 0.16 || y < yBot - 0.1 || y > yBot + 0.05) continue;
        let zb = Infinity; const cx = Math.floor(x / H), cy = Math.floor(y / H);
        for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) { const z = under.get(`${cx + a},${cy + b}`); if (z !== undefined && z < zb) zb = z; }
        if (!Number.isFinite(zb)) continue;
        const lim = zb - V2_REST_GAP;
        if (pos[r * 3 + 2] > lim && pos[r * 3 + 2] < zb + 0.03) { pos[r * 3 + 2] = Math.max(lim, base[r * 3 + 2] - V2_REST_MAX); moved.push(r); settled += 1; }
      }
      const set = new Set(moved); for (const r of moved) for (const u of nb.get(r)) if (kind[u] === STILL) set.add(u);
      const zone = [...set];
      for (let p = 0; p < 20; p += 1) { const o = pos.slice(); for (const r of zone) { const q = nb.get(r); for (let k = 0; k < 3; k += 1) { let a = 0; for (const u of q) a += o[u * 3 + k]; pos[r * 3 + k] = 0.5 * o[r * 3 + k] + 0.5 * a / q.size; } } }
      for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let k = 0; k < 3; k += 1) pos[i * 3 + k] = pos[rep[i] * 3 + k];
    }
    log(`belly: ${name} upper belly one curve to the crease (moved up to ${(-pulled * 100).toFixed(1)} cm), its top held at 100%; ${settled} groin vertices settled under the bump`);
    D.setArray(pos.map((v, i) => v - base[i]));
    const TN = t.getAttribute('NORMAL'); if (TN) TN.setArray(normalDelta(pos, base, idx, info.rep, baseN, TN.getArray()));
  }
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
  const now = P0.getArray(); for (let i = 0; i < now.length; i += 1) if (now[i] !== master[i]) throw new Error('Sarah v2 belly: the 100% body moved');
  log(`belly: v2's own: 100% is the master untouched; 0-75% faired into her over ${free.length.toLocaleString('en-US')} vertices (under-bust ${crease.lo.toFixed(3)}-${crease.hi.toFixed(3)} m), pubis in ${(V2_PUBIS_IN_M * 1000).toFixed(0)} mm at 0%; 150-200% and the switchable 100% refine drawn toward v1's profiles; groin anchored below ${(yBot + V2_ANCHOR_TO).toFixed(3)} m, ${fold.length.toLocaleString('en-US')} fold vertices solved`);
}
