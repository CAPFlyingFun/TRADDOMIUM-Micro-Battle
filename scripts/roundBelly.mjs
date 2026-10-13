/**
 * THE BUMP, ROUNDER AND SMOOTHER (Joshua, 2026-10-13: "adjust and make the belly
 * more like a watermelon-shaped belly, and smoother", then, with his week-by-week
 * side photographs: "take each image and get the top and bottom and measure the
 * curve of the belly to match"). A first pass that replaced the curve outright
 * read as less round and more jagged to him; the balance he chose keeps each
 * size's own curve and moves it HALFWAY (`REF_MIX`) toward the photographs'.
 *
 *  1. The centre-line profile is read from the skin and smoothed hard along the
 *     body, as height above the chord from the pubis to the under-bust crease.
 *  2. Each row's change toward the traced curve (`REF_MID`, `REF_LATE`, same
 *     peak depth) is shared across the row by a blurred grid of each column's
 *     height over the centre's, so a lump is moved, never scaled up. Breasts
 *     are not belly: each column stops at its own under-bust crease.
 *  3. The region is faired over the welded mesh (Taubin, so it does not
 *     shrink), with the navel and the edges held. That takes out the wobble.
 *
 * `bakeRoundBelly` does this to the 100% body once (marker `bellyRounded`), rebuilds
 * every size from it with `bellyMorph`, rounds 50/75/150/200%, and puts the
 * approved 0/25/50% sizes back exactly where they were. Positions are metres, as
 * `recoverSarahBody` leaves them; any upright body whose front is +z.
 */

/**
 * THE MEASURED CURVES. Joshua's week-by-week side photographs (10 to 40 weeks),
 * traced: the front edge of the belly from where it meets the shorts (t = 0) to
 * the under-bust crease (t = 1), as height above the straight line between the
 * two, over its own peak, every twentieth of the way, smoothed. MID is the mean of
 * 22 and 27 weeks; LATE of 31, 38 and 40 (35 weeks' crease read badly and is left
 * out). MEASURED, from his reference image, 2026-10-13.
 */
export const REF_MID = Object.freeze([0, 0.21, 0.41, 0.57, 0.7, 0.81, 0.89, 0.95, 0.97, 1, 0.97, 0.94, 0.89, 0.82, 0.72, 0.62, 0.52, 0.4, 0.29, 0.18, 0]);
export const REF_LATE = Object.freeze([0, 0.2, 0.37, 0.52, 0.65, 0.78, 0.9, 0.95, 0.99, 0.99, 0.96, 0.92, 0.84, 0.77, 0.68, 0.57, 0.42, 0.3, 0.17, 0.08, 0]);
/** How far each belly moves from its own curve toward the photographs' (Joshua:
 * "a good balance between [plain] and the updated shape"). GAME TUNING. */
export const REF_MIX = 0.5;
/** Fairing passes over the bump (Taubin pairs). */
export const FAIR_PASSES = 30;
/** Navel held still within this radius, released by twice it. */
export const NAVEL_HOLD_M = 0.016;

const ROW = 0.005;

const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/**
 * @param {import('@gltf-transform/core').Primitive} body the skin primitive, positions in metres
 * @param {{ hipY: number, navel?: [number, number] | null, log?: (s: string) => void, force?: boolean }} opts
 */
export function roundBelly(body, { hipY, navel = null, log = () => {}, force = false } = {}) {
  if (!force && body.getExtras().bellyRounded === 1) { log('belly: already rounded'); return null; }
  const P = body.getAttribute('POSITION');
  const pos = new Float32Array(P.getArray());
  const before = new Float32Array(pos);
  const idx = body.getIndices().getArray();
  const info = roundProfile(pos, idx, { hipY, navel });
  if (!info) { log('belly: no bump to round'); return null; }
  const { rep } = info, n = P.getCount();

  // --- normals over the moved region, recomputed from faces, blended by how far it moved
  const N = body.getAttribute('NORMAL');
  if (N) N.setArray(blendNormals(pos, before, idx, rep, N.getArray()));
  P.setArray(pos);
  body.setExtras({ ...body.getExtras(), bellyRounded: 1 });
  let most = 0; for (let i = 0; i < n; i += 1) most = Math.max(most, Math.hypot(pos[i * 3] - before[i * 3], pos[i * 3 + 1] - before[i * 3 + 1], pos[i * 3 + 2] - before[i * 3 + 2]));
  log(`belly: rounded between ${info.yBot.toFixed(3)} and ${info.yTop.toFixed(3)} m, peak ${(info.depth * 100).toFixed(1)} cm deep at ${info.yPeak.toFixed(3)} m; moved up to ${(most * 1000).toFixed(0)} mm`);
  return info;
}

/** The same rounding on positions only (metres, mutated in place). Returns the
 * anchors and the welded-vertex map, or null when there is no bump. */
export function roundProfile(pos, idx, { hipY, navel = null, shape = REF_LATE, mix = REF_MIX, passes = FAIR_PASSES, yTopHint = null, bottomY = null } = {}) {
  const n = pos.length / 3;
  const before = new Float32Array(pos);

  // --- the centre-line profile, 5 mm rows, from below the pubis to the chest
  // `bottomY` (Sarah v2's grown sizes, whose bump hangs below the pubis line) moves the
  // curve's lower end; left out, everything is as v1 was baked
  const y0 = bottomY == null ? hipY - 0.15 : Math.min(hipY - 0.15, bottomY - 0.03), rows = Math.ceil((0.45 + hipY - y0) / ROW);
  const rowOf = (y) => Math.floor((y - y0) / ROW);
  const rowY = (r) => y0 + (r + 0.5) * ROW;
  const centre = new Float32Array(rows).fill(-Infinity);
  for (let i = 0; i < n; i += 1) {
    const r = rowOf(pos[i * 3 + 1]);
    if (r >= 0 && r < rows && Math.abs(pos[i * 3]) < 0.03) centre[r] = Math.max(centre[r], pos[i * 3 + 2]);
  }
  for (let r = 1; r < rows - 1; r += 1) if (!Number.isFinite(centre[r]) || centre[r] < Math.min(centre[r - 1], centre[r + 1]) - 0.02) centre[r] = (centre[r - 1] + centre[r + 1]) / 2;
  const prof = new Float32Array(rows);
  for (let r = 0; r < rows; r += 1) {
    const w = []; for (let k = -3; k <= 3; k += 1) { const v = centre[Math.max(0, Math.min(rows - 1, r + k))]; if (Number.isFinite(v)) w.push(v); }
    w.sort((a, b) => a - b); prof[r] = w[w.length >> 1];
  }
  const lerpRows = (arr, y) => { const f = (y - y0) / ROW - 0.5, r = Math.max(0, Math.min(rows - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - r)); return arr[r] * (1 - t) + arr[r + 1] * t; };

  // --- anchors: the peak; the under-bust crease above it; the pubis
  let peak = -1;
  for (let r = 0; r < rows; r += 1) { const y = rowY(r); if (y > hipY - 0.02 && y < hipY + 0.4 && (peak < 0 || prof[r] > prof[peak])) peak = r; }
  let top = -1, steep = false;
  for (let r = peak + 2; r < rows; r += 2) { const fall = (prof[r - 2] - prof[r]) / (2 * ROW); if (fall > 1) steep = true; if (steep && fall < 0.5) { top = r; break; } }
  if (yTopHint != null) top = rowOf(yTopHint);
  if (peak < 0 || top < 0) return null;
  const yTop = rowY(top), yBot = bottomY ?? hipY - 0.075, zTop = lerpRows(prof, yTop), zBot = lerpRows(prof, yBot);
  const chord = (y) => zBot + (zTop - zBot) * (y - yBot) / (yTop - yBot);

  // --- the bump's height above the chord, smoothed hard along the body: its
  // overall curve, without the few-millimetre wobble the master carries
  const hs = new Float32Array(rows);
  for (let r = 0; r < rows; r += 1) { const y = rowY(r); hs[r] = y > yBot && y < yTop ? Math.max(0, prof[r] - chord(y)) : 0; }
  for (let pass = 0; pass < 12; pass += 1) { const o = hs.slice(); for (let r = 1; r < rows - 1; r += 1) hs[r] = (o[r - 1] + 2 * o[r] + o[r + 1]) / 4; }
  let depth = 0; for (let r = 0; r < rows; r += 1) depth = Math.max(depth, hs[r]);
  if (depth < 0.02) return null;
  // the target: part this body's own curve, part the measured photographs' curve
  const refAt = (t) => { const f = Math.max(0, Math.min(1, t)) * (shape.length - 1), i = Math.min(shape.length - 2, Math.floor(f)); return shape[i] + (shape[i + 1] - shape[i]) * (f - i); };
  const delta = new Float32Array(rows);
  for (let r = 0; r < rows; r += 1) {
    const y = rowY(r); if (y <= yBot || y >= yTop) continue;
    const t = (y - yBot) / (yTop - yBot);
    const target = (1 - mix) * hs[r] + mix * depth * refAt(t);
    delta[r] = (target - hs[r]) * smooth(yBot, yBot + 0.03, y) * smooth(yTop, yTop - 0.03, y);
  }
  let yPeak = yBot, best = -1; for (let r = 0; r < rows; r += 1) if (hs[r] + delta[r] > best) { best = hs[r] + delta[r]; yPeak = rowY(r); }

  // --- how much of a row's change each column takes: its own height there
  // over the centre's, from a blurred 1 cm grid, so a lump is never scaled up
  const COL = 0.01, HALF = 0.2, cols = Math.round(2 * HALF / COL);
  const colRaw = Array.from({ length: cols }, () => new Float32Array(rows).fill(-Infinity));
  for (let i = 0; i < n; i += 1) {
    const c = Math.floor((pos[i * 3] + HALF) / COL), r = rowOf(pos[i * 3 + 1]);
    if (c >= 0 && c < cols && r >= 0 && r < rows) colRaw[c][r] = Math.max(colRaw[c][r], pos[i * 3 + 2]);
  }
  // each column stops at its own under-bust crease (breasts are not belly)
  const crease = new Float32Array(cols);
  for (let c = 0; c < cols; c += 1) {
    let bestY = yTop, bestZ = Infinity;
    for (let r = rowOf(yTop - 0.06); r <= rowOf(yTop + 0.04); r += 1) {
      const z = Math.max(colRaw[c][r], colRaw[Math.max(0, c - 1)][r], colRaw[Math.min(cols - 1, c + 1)][r]);
      if (Number.isFinite(z) && z < bestZ) { bestZ = z; bestY = rowY(r); }
    }
    crease[c] = Math.min(yTop, bestY);
  }
  for (let pass = 0; pass < 3; pass += 1) { const o = crease.slice(); for (let c = 1; c < cols - 1; c += 1) crease[c] = Math.min(o[c], (o[c - 1] + o[c] + o[c + 1]) / 3); }
  const share = Array.from({ length: cols }, () => new Float32Array(rows));
  const mid = Math.floor(cols / 2);
  for (let c = 0; c < cols; c += 1) for (let r = 0; r < rows; r += 1) {
    const y = rowY(r), h0 = Math.max(colRaw[mid][r], colRaw[mid - 1][r]) - chord(y), h = colRaw[c][r] - chord(y);
    share[c][r] = Number.isFinite(h) && h0 > 0.005 ? Math.max(0, Math.min(1, h / h0)) : 0;
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const o = share.map((a) => a.slice());
    for (let c = 1; c < cols - 1; c += 1) for (let r = 1; r < rows - 1; r += 1) share[c][r] = (4 * o[c][r] + o[c - 1][r] + o[c + 1][r] + o[c][r - 1] + o[c][r + 1]) / 8;
  }
  const grid = (arr2, x, y) => {
    const fx = (x + HALF) / COL - 0.5, fy = (y - y0) / ROW - 0.5;
    const c = Math.max(0, Math.min(cols - 2, Math.floor(fx))), r = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - c)), ty = Math.max(0, Math.min(1, fy - r));
    return (arr2[c][r] * (1 - tx) + arr2[c + 1][r] * tx) * (1 - ty) + (arr2[c][r + 1] * (1 - tx) + arr2[c + 1][r + 1] * tx) * ty;
  };
  const creaseAt = (x) => { const f = (x + HALF) / COL - 0.5, c = Math.max(0, Math.min(cols - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - c)); return crease[c] * (1 - t) + crease[c + 1] * t; };

  const weight = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y <= yBot - 0.02 || y >= yTop || Math.abs(x) > HALF) continue;
    const h = z - chord(y);
    if (h <= 0) continue;
    const below = smooth(creaseAt(x), creaseAt(x) - 0.02, y);
    const side = smooth(HALF, HALF - 0.05, Math.abs(x));
    const c = Math.floor((x + HALF) / COL), r = rowOf(y);
    const hcol = c >= 0 && c < cols && r >= 0 && r < rows ? colRaw[c][r] - chord(y) : h;
    const front = Math.max(0, Math.min(1, h / Math.max(0.005, hcol)));     // the outer skin, not the inside of a fold
    const w = below * side * front;
    if (w <= 0) continue;
    weight[i] = w * smooth(0, 0.01, h);
    pos[i * 3 + 2] += lerpRows(delta, y) * grid(share, x, y) * w;
  }

  // --- fair the region over the welded mesh (Taubin), the navel and the edge held
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i += 1) { const k = `${Math.round(before[i * 3] * 1e5)},${Math.round(before[i * 3 + 1] * 1e5)},${Math.round(before[i * 3 + 2] * 1e5)}`; if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
  const nb = new Map();
  const link = (a, b) => { if (a === b) return; let s = nb.get(a); if (!s) nb.set(a, (s = new Set())); s.add(b); };
  for (let f = 0; f < idx.length; f += 3) { const a = rep[idx[f]], b = rep[idx[f + 1]], c = rep[idx[f + 2]]; link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b); }
  const fairW = new Float32Array(n);
  for (const r of key.values()) {
    if (weight[r] <= 0) continue;
    let w = weight[r];
    if (navel) { const d = Math.hypot(before[r * 3] - navel[0], before[r * 3 + 1] - navel[1]); w *= smooth(NAVEL_HOLD_M, 2 * NAVEL_HOLD_M, d); }
    fairW[r] = w;
  }
  const step = (lambda) => {
    const out = pos.slice();
    for (const [r, s] of nb) {
      const w = fairW[r]; if (!w) continue;
      for (let c = 0; c < 3; c += 1) { let a = 0; for (const u of s) a += pos[u * 3 + c]; out[r * 3 + c] = pos[r * 3 + c] + lambda * w * (a / s.size - pos[r * 3 + c]); }
    }
    pos.set(out);
  };
  for (let p = 0; p < passes; p += 1) { step(0.5); step(-0.53); }
  for (let i = 0; i < n; i += 1) if (rep[i] !== i) for (let c = 0; c < 3; c += 1) pos[i * 3 + c] = pos[rep[i] * 3 + c];
  return { yBot, yTop, yPeak, depth, rep };
}

/** Face normals over the welded mesh, blended in by how far each vertex moved. */
export function blendNormals(pos, before, idx, rep, old) {
  const n = pos.length / 3, fn = new Float32Array(n * 3);
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    const u = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]), v = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const q = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const x of [rep[a], rep[b], rep[c]]) for (let k = 0; k < 3; k += 1) fn[x * 3 + k] += q[k];
  }
  const nn = new Float32Array(old);
  for (let i = 0; i < n; i += 1) {
    const moved = Math.hypot(pos[i * 3] - before[i * 3], pos[i * 3 + 1] - before[i * 3 + 1], pos[i * 3 + 2] - before[i * 3 + 2]);
    const w = smooth(0, 0.003, moved); if (!w) continue;
    const r = rep[i], l = Math.hypot(fn[r * 3], fn[r * 3 + 1], fn[r * 3 + 2]) || 1;
    const sign = fn[r * 3] * old[i * 3] + fn[r * 3 + 1] * old[i * 3 + 1] + fn[r * 3 + 2] * old[i * 3 + 2] < 0 ? -1 : 1;
    for (let k = 0; k < 3; k += 1) nn[i * 3 + k] = old[i * 3 + k] * (1 - w) + sign * (fn[r * 3 + k] / l) * w;
    const len = Math.hypot(nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]) || 1; for (let k = 0; k < 3; k += 1) nn[i * 3 + k] /= len;
  }
  return nn;
}

/** The grown sizes, rounded the same way after `bellyMorph` has built them: a
 * bigger belly is fuller low down and its peak sits lower (the weight), so each
 * size gets its own peak height and a rounder bottom. */
export const SIZE_SHAPES = Object.freeze({
  belly50: { shape: REF_MID }, belly75: { shape: REF_MID },
  belly150: { shape: REF_LATE }, belly200: { shape: REF_LATE },
});

export function roundSizes(doc, { hipY, navel = null, yTop = null, log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const names = mesh.getExtras().targetNames || [];
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  const base = body.getAttribute('POSITION').getArray(), baseN = body.getAttribute('NORMAL')?.getArray();
  const idx = body.getIndices().getArray();
  for (const [name, shape] of Object.entries(SIZE_SHAPES)) {
    const t = names.indexOf(name); if (t < 0) continue;
    const target = body.listTargets()[t];
    const D = target.getAttribute('POSITION'), d = D.getArray();
    const pos = new Float32Array(base.length); for (let i = 0; i < pos.length; i += 1) pos[i] = base[i] + d[i];
    const before = new Float32Array(pos);
    const info = roundProfile(pos, idx, { hipY, navel, passes: 20, yTopHint: yTop, ...shape });
    if (!info) { log(`belly: ${name} has no bump to round`); continue; }
    const nd = new Float32Array(d.length); for (let i = 0; i < nd.length; i += 1) nd[i] = pos[i] - base[i];
    D.setArray(nd);
    const TN = target.getAttribute('NORMAL');
    if (TN && baseN) {
      const old = new Float32Array(baseN.length), tn = TN.getArray(); for (let i = 0; i < old.length; i += 1) old[i] = baseN[i] + tn[i];
      const nn = blendNormals(pos, before, idx, info.rep, old);
      const out = new Float32Array(nn.length); for (let i = 0; i < out.length; i += 1) out[i] = nn[i] - baseN[i];
      TN.setArray(out);
    }
    log(`belly: ${name} rounded, peak at ${info.yPeak.toFixed(3)} m, ${(info.depth * 100).toFixed(1)} cm deep`);
  }
}

/** Sizes whose shape is already approved and must come out exactly as before
 * (Joshua accepted the early sizes, 2026-10-12): they keep their absolute shape
 * even though the 100% body under them changes. */
export const KEEP_SIZES = Object.freeze(['belly', 'belly25', 'belly50']);

/**
 * The whole belly bake, rounded: build every size from the master as before,
 * remember the approved small sizes, round the 100% body and rebuild from it,
 * round the other sizes, then put the small sizes back where they were.
 * `bellyMorph` is passed in so this file does not import the bake.
 */
export function bakeRoundBelly(doc, bellyMorph, { hipY, navel = null, armParts = null, log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  // ARMS DOWN (Sarah v2): the hands hang beside the hips, inside every reading
  // the belly takes (the waist, the flat front, the columns), and a size would
  // carve them. So the arms are lifted out of the way for the bake, put back,
  // and none of the belly's targets moves them.
  let arm = null, armPos = null;
  if (armParts) {
    const J = body.getAttribute('JOINTS_0'), W = body.getAttribute('WEIGHTS_0'), P0 = body.getAttribute('POSITION');
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    arm = new Uint8Array(P0.getCount());
    for (let i = 0; i < arm.length; i += 1) {
      J.getElement(i, j); W.getElement(i, w);
      let a = 0; for (let k = 0; k < 4; k += 1) if (armParts[j[k]] === 'arms' || armParts[j[k]] === 'upperArm') a += w[k];
      arm[i] = a > 0.5 ? 1 : 0;
    }
    armPos = new Float32Array(P0.getArray());
    const lifted = armPos.slice(); for (let i = 0; i < arm.length; i += 1) if (arm[i]) lifted[i * 3 + 1] += 100;
    P0.setArray(lifted);
    log(`belly: ${arm.reduce((a, b) => a + b, 0).toLocaleString('en-US')} arm vertices kept out of the belly`);
  }
  const restoreArms = () => {
    if (!arm) return;
    const P0 = body.getAttribute('POSITION'), cur = P0.getArray().slice();
    for (let i = 0; i < arm.length; i += 1) if (arm[i]) for (let c = 0; c < 3; c += 1) cur[i * 3 + c] = armPos[i * 3 + c];
    P0.setArray(cur);
    for (const t of body.listTargets()) for (const sem of ['POSITION', 'NORMAL']) {
      const A = t.getAttribute(sem); if (!A) continue;
      const d = A.getArray().slice(); for (let i = 0; i < arm.length; i += 1) if (arm[i]) d[i * 3] = d[i * 3 + 1] = d[i * 3 + 2] = 0;
      A.setArray(d);
    }
  };
  if (body.getExtras().bellyRounded === 1) { log('belly: already rounded; building as is'); bellyMorph(doc, { log }); restoreArms(); return; }
  const clear = () => {
    for (const p of mesh.listPrimitives()) for (const t of [...p.listTargets()]) t.dispose();
    mesh.setWeights([]).setExtras({ ...mesh.getExtras(), targetNames: [] });
    for (const node of doc.getRoot().listNodes()) if (node.getMesh() === mesh) node.setWeights([]);
  };
  bellyMorph(doc, { log: () => {} });
  const names0 = mesh.getExtras().targetNames;
  const base0 = new Float32Array(body.getAttribute('POSITION').getArray());
  const baseN0 = new Float32Array(body.getAttribute('NORMAL').getArray());
  const keep = {};
  for (const name of KEEP_SIZES) {
    const t = body.listTargets()[names0.indexOf(name)]; if (!t) continue;
    const d = t.getAttribute('POSITION').getArray(), dn = t.getAttribute('NORMAL')?.getArray();
    keep[name] = { pos: base0.map((v, i) => v + d[i]), nrm: dn ? baseN0.map((v, i) => v + dn[i]) : null };
  }
  clear();
  const shape = roundBelly(body, { hipY, navel, log });
  bellyMorph(doc, { log });
  roundSizes(doc, { hipY, navel, yTop: shape?.yTop ?? null, log });
  // The bump's weight (tilt, bob, sway) never reaches the thighs: its relaxed tail
  // spread a millimetre past the leg crease once the rounded bump sat a little lower.
  {
    const names1 = mesh.getExtras().targetNames, P1 = body.getAttribute('POSITION').getArray();
    for (const name of ['bellyTilt', 'bellyBob', 'bellySway']) {
      const t = body.listTargets()[names1.indexOf(name)]; if (!t) continue;
      for (const sem of ['POSITION', 'NORMAL']) {
        const A = t.getAttribute(sem); if (!A) continue;
        const d = A.getArray().slice();
        for (let i = 0; i < d.length / 3; i += 1) { const f = smooth(hipY - 0.17, hipY - 0.11, P1[i * 3 + 1]); for (let c = 0; c < 3; c += 1) d[i * 3 + c] *= f; }
        A.setArray(d);
      }
    }
  }
  const names = mesh.getExtras().targetNames;
  const base = body.getAttribute('POSITION').getArray(), baseN = body.getAttribute('NORMAL').getArray();
  for (const [name, k] of Object.entries(keep)) {
    const t = body.listTargets()[names.indexOf(name)]; if (!t) continue;
    t.getAttribute('POSITION').setArray(k.pos.map((v, i) => v - base[i]));
    if (k.nrm && t.getAttribute('NORMAL')) t.getAttribute('NORMAL').setArray(k.nrm.map((v, i) => v - baseN[i]));
  }
  restoreArms();
  log(`belly: ${KEEP_SIZES.join(', ')} kept exactly as approved`);
}
