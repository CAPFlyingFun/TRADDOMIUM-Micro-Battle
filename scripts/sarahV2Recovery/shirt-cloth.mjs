/**
 * THE TEE AS CLOTH, FOR THE EXPERIMENT (Joshua, 2026-10-23: "create another copy of that same shirt, but make that one a
 * true soft body/cloth with simulation over the whole thing and I want to be able to see how much or little having a
 * full soft body cloth fabric would be"; and "let's also allow the shirt length to be adjustable… with where it's set as
 * 0% and make 100% at mid-thigh").
 *
 * Writes `public/models/sarah-v2-spandex-cloth.glb` from the light tee (`sarah-v2-spandex-lite.glb`): one sheet of
 * cloth, no fitted shapes at all, for `clothSim.ts` to move and `clothSkin.ts` to hold off her.
 *
 * - ONE LAYER. The modelled tee is a closed shell 0.8 mm thick; cloth is a sheet. Its OUTER layer is kept (each
 *   triangle facing away from her skin), welded across UV seams into particles, and simplified to about PARTICLES so
 *   the cost is a phone's. Its neckline, sleeves and hem stay where they are.
 * - LONGER BY ROWS. Below the hem, rows of cloth to MID-THIGH (her hip and knee joints' midpoint), each row ROW_STEP
 *   below the last, every column straight down from a point of the hem: as a band pulled round her at that height
 *   would lie (the convex outline of her trunk and both thighs, never her arms), and no closer to her than it was a row
 *   up less SLOPE a row, so it hangs from her belly and seat instead of following into every hollow. `_ROW` says which
 *   row a particle is (0 the tee, 1.. the extension); the room's SHIRT LENGTH shows rows up to its share of the last.
 * - BOUND TO HER. Each particle records the body triangle under it at rest (her approved body at 100%, as the tee was
 *   fitted), where on it, and how far off it along that triangle's own normal (`_BODY_TRI`, `_BODY_BARY`, `_OFFSET`):
 *   where `clothSkin.ts` starts it, and where a pinned one is held.
 * - HUNG FROM HER NECKLINE. `_PIN` is 1 within PIN_IN of the neckline, 0 past PIN_OUT: real cloth hangs from her
 *   shoulders by friction, and the collar keeps it from walking off her while the experiment is tuned.
 *
 *   node scripts/sarahV2Recovery/shirt-cloth.mjs [--particles 5000] [--out public/models/sarah-v2-spandex-cloth.glb]
 */
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { compose, neighbours, weld, weldedNormals } from './shirt-bust.mjs';

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SOURCE = option('source', 'public/models/sarah-v2-spandex-lite.glb');
const BODY = option('body', 'public/models/sarah-v2-body-slim.glb');
const TARGET = option('out', 'public/models/sarah-v2-spandex-cloth.glb');
/** About how many particles the tee itself is simplified to (the extension adds its rows on top). */
const PARTICLES = Number(option('particles', 5000));
/** Metres, in her rest world (feet at 0): rows below the hem and columns round it, how far the band may come in toward her
 * per row, its stand-off. */
const ROW_STEP = 0.012, COLUMN_STEP = 0.012, SLOPE = 0.45, BAND_OFF = 0.004;
/** Metres from the neckline: fully pinned inside PIN_IN, free past PIN_OUT. */
const PIN_IN = 0.012, PIN_OUT = 0.03;
/** Metres, and how strongly: the sleeves' edges, held softly to her arms. */
const SLEEVE_PIN_IN = 0.008, SLEEVE_PIN = 0.35;
/** Metres: a particle over her arm is SLEEVE (bound to her arm) only when her trunk is at least this far from it. */
const SLEEVE_CLEAR = 0.02;
/** Metres: a point's layer is told by her skin when her nearer skin is within SKIN_NEAR and nearer than the other by SKIN_MARGIN. */
const SKIN_NEAR = 0.03, SKIN_MARGIN = 0.012;
/** Two triangles across an edge facing more nearly opposite than this (cosine) are the two layers at a rim: cut there. */
const FOLD = -0.5;
/** Metres: how far a ray from the tee looks for her body. */
const RAY = 0.08, RAY_CLOSE = 0.025, RAY_RATIO = 3;
/** Body-local units (about 0.9 m each): how far the hem may stray from the modelled one as its points are thinned. */
const HEM_ERROR = 0.002;
/** Metres from her navel: the tee's own navel impression is smoothed away fully inside the first, not at all past the second. */
const NAVEL_ZONE = [0.025, 0.045];
/**
 * Metres: two rings of skin round her navel and each nipple, an inner and an outer, that say how her surface lies there
 * without the detail: its normal, and its curvature (the outer ring lies lower round a curved belly or breast than the
 * inner one does), so the room can tell how far the detail itself stands above her smooth surface.
 */
const DETAIL_RINGS = [[0.022, 0.03], [0.036, 0.044]];
/** Metres, in her rest world (her approved body at 100%): where a nipple is looked for (out from her middle, and up from
 * her feet: above the top of her bump, at 1.2 m, and below her collarbones), and how far behind her most forward point
 * a breast's apex reaches. */
const NIPPLE_WINDOW = { across: [0.06, 0.14], up: [1.22, 1.32] }, NIPPLE_APEX = 0.003;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const floats = (accessor) => {
  const a = accessor.getArray();
  if (!accessor.getNormalized()) return Float32Array.from(a);
  const scale = a instanceof Int16Array ? 32767 : a instanceof Int8Array ? 127 : a instanceof Uint16Array ? 65535 : 255;
  return Float32Array.from(a, (x) => Math.max(-1, x / scale));
};

// ---- her body at the tee's reference, in its local units, and the transform to her rest world (metres) ----------------
const bodyDoc = await io.read(BODY);
const bodyMesh = bodyDoc.getRoot().listMeshes()[0], skinPrim = bodyMesh.listPrimitives()[0];
const bodyNames = bodyMesh.getExtras().targetNames, bodyTargets = skinPrim.listTargets();
const skinOffsets = new Map(bodyNames.map((name, k) => [name, floats(bodyTargets[k].getAttribute('POSITION'))]));
const doc = await io.read(SOURCE);
const mesh = doc.getRoot().listMeshes()[0], prim = mesh.listPrimitives()[0], meta = mesh.getExtras().recoveredShirt;
const reference = new Map(Object.entries(meta.baselineWeightsByBump[100]).filter(([, w]) => Math.abs(w) > 1e-4));
const B = compose(floats(skinPrim.getAttribute('POSITION')), skinOffsets, reference);
const BI = Uint32Array.from(skinPrim.getIndices().getArray());
const skin = bodyDoc.getRoot().listSkins()[0], joints = skin.listJoints();
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const T = mul(Array.from(joints[0].getWorldMatrix()), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16)));
const toWorld = (x, y, z) => [T[0] * x + T[4] * y + T[8] * z + T[12], T[1] * x + T[5] * y + T[9] * z + T[13], T[2] * x + T[6] * y + T[10] * z + T[14]];
const invert = (m) => {
  // affine inverse: the 3x3 part inverted, then the translation
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, Bc = -(d * i - f * g), C = d * h - e * g, det = a * A + b * Bc + c * C;
  const r = [A, -(b * i - c * h), b * f - c * e, Bc, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  const tx = m[12], ty = m[13], tz = m[14];
  return { r, t: [-(r[0] * tx + r[1] * ty + r[2] * tz), -(r[3] * tx + r[4] * ty + r[5] * tz), -(r[6] * tx + r[7] * ty + r[8] * tz)] };
};
const Ti = invert(T);
const toLocal = (x, y, z) => [Ti.r[0] * x + Ti.r[1] * y + Ti.r[2] * z + Ti.t[0], Ti.r[3] * x + Ti.r[4] * y + Ti.r[5] * z + Ti.t[1], Ti.r[6] * x + Ti.r[7] * y + Ti.r[8] * z + Ti.t[2]];
const scale = Math.hypot(T[0], T[1], T[2]);
const BW = new Float64Array(B.length); for (let v = 0; v < B.length / 3; v++) BW.set(toWorld(B[v * 3], B[v * 3 + 1], B[v * 3 + 2]), v * 3);
// her arms (not part of a band pulled round her trunk): a vertex mostly weighted to a bone of either arm past the clavicle
const jointsAt = floats(skinPrim.getAttribute('JOINTS_0')), weightsAt = floats(skinPrim.getAttribute('WEIGHTS_0'));
// An arm bone is off her middle (|x| > 10 cm) and hangs from her chest: one of its own ancestors stands above CHEST_Y.
// (Height alone is not enough: her thighs start at 0.89 m, as high as her hands hang, and her left thigh's bone stands
// 10.3 cm off her middle -- the first rule here took it for an arm, and the rows below the hem wrapped one leg.)
const CHEST_Y = 1.2;
const parentOf = new Map(); for (const n of bodyDoc.getRoot().listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const fromChest = (j) => { for (let n = parentOf.get(j); n; n = parentOf.get(n)) if (n.getWorldTranslation()[1] > CHEST_Y) return true; return false; };
const armJoint = new Set(joints.map((j, k) => [k, j]).filter(([, j]) => Math.abs(j.getWorldTranslation()[0]) > 0.1 && fromChest(j)).map(([k]) => k));
const armVertex = new Uint8Array(B.length / 3);
for (let v = 0; v < armVertex.length; v++) { let w = 0; for (let k = 0; k < 4; k++) if (armJoint.has(jointsAt[v * 4 + k])) w += weightsAt[v * 4 + k]; armVertex[v] = w > 0.5 ? 1 : 0; }
const armTri = (t) => armVertex[BI[t]] + armVertex[BI[t + 1]] + armVertex[BI[t + 2]] >= 2;
const jointY = (name) => joints.find((j) => j.getName() === name).getWorldTranslation()[1];
// mid-thigh: half way between her hip and knee joints, both legs (Bone_009/Bone_008, Bone_014/Bone_013)
const MID_THIGH = (jointY('Bone_009') + jointY('Bone_008') + jointY('Bone_014') + jointY('Bone_013')) / 4;
console.log(`her rest world: ${scale.toFixed(4)} m a local unit; mid-thigh at ${MID_THIGH.toFixed(3)} m; ${armJoint.size} arm bones`);

/** Closest point on her (local) skin among triangles `keep` admits: the triangle, barycentrics, the face normal and the signed offset along it. */
function skinLookup(keep) {
  const CELL = 0.01, cells = new Map(), key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  const nrm = new Float64Array(BI.length);
  let vote = 0;
  for (let t = 0; t < BI.length; t += 3) {
    const a = BI[t] * 3, b = BI[t + 1] * 3, c = BI[t + 2] * 3;
    const ux = B[b] - B[a], uy = B[b + 1] - B[a + 1], uz = B[b + 2] - B[a + 2], vx = B[c] - B[a], vy = B[c + 1] - B[a + 1], vz = B[c + 2] - B[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nrm[t] = nx / l; nrm[t + 1] = ny / l; nrm[t + 2] = nz / l;
    vote += B[a] * nx + B[a + 1] * ny + B[a + 2] * nz;
    if (!keep(t)) continue;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(B[a + k], B[b + k], B[c + k]) / CELL)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(B[a + k], B[b + k], B[c + k]) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = key(x, y, z); let l2 = cells.get(k); if (!l2) cells.set(k, (l2 = [])); l2.push(t); }
  }
  // her triangles wind outward if they enclose a positive volume about her own middle
  const out = vote >= 0 ? 1 : -1;
  return (p) => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
    let best = null;
    for (let r = 0; r <= 12 && (!best || best.d2 > ((r - 1) * CELL) ** 2); r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
      for (const t of cells.get(key(cx + x, cy + y, cz + z)) ?? []) {
        const h = closestBary(p, BI[t] * 3, BI[t + 1] * 3, BI[t + 2] * 3);
        if (!best || h.d2 < best.d2) best = { ...h, t };
      }
    }
    if (!best) return { tri: [0, 0, 0], bary: [1, 0, 0], normal: [0, 1, 0], offset: 0, distance: Infinity };
    const n = [nrm[best.t] * out, nrm[best.t + 1] * out, nrm[best.t + 2] * out];
    // the binding is the point's foot on the triangle's PLANE (barycentrics past its edges where it falls outside): the
    // skin point plus the offset along that triangle's normal is then the point itself exactly, as clothSkin.ts rebuilds it
    const a = BI[best.t] * 3, b = BI[best.t + 1] * 3, c = BI[best.t + 2] * 3;
    const offset = (p[0] - B[a]) * n[0] + (p[1] - B[a + 1]) * n[1] + (p[2] - B[a + 2]) * n[2], foot = [0, 1, 2].map((k) => p[k] - offset * n[k]);
    const e0 = [0, 1, 2].map((k) => B[b + k] - B[a + k]), e1 = [0, 1, 2].map((k) => B[c + k] - B[a + k]), r = [0, 1, 2].map((k) => foot[k] - B[a + k]);
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], d00 = dot(e0, e0), d01 = dot(e0, e1), d11 = dot(e1, e1), d20 = dot(r, e0), d21 = dot(r, e1), den = d00 * d11 - d01 * d01 || 1e-30;
    const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
    return { tri: [BI[best.t], BI[best.t + 1], BI[best.t + 2]], bary: [1 - v - w, v, w], normal: n, offset, distance: Math.sqrt(best.d2) };
  };
}
function closestBary(p, a, b, c) {
  const ab = [B[b] - B[a], B[b + 1] - B[a + 1], B[b + 2] - B[a + 2]], ac = [B[c] - B[a], B[c + 1] - B[a + 1], B[c + 2] - B[a + 2]], ap = [p[0] - B[a], p[1] - B[a + 1], p[2] - B[a + 2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let bc;
  if (d1 <= 0 && d2 <= 0) bc = [1, 0, 0];
  else {
    const bp = [p[0] - B[b], p[1] - B[b + 1], p[2] - B[b + 2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = [p[0] - B[c], p[1] - B[c + 1], p[2] - B[c + 2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) bc = [0, 1, 0];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); bc = [1 - v, v, 0]; }
    else if (d6 >= 0 && d5 <= d6) bc = [0, 0, 1];
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); bc = [1 - w, 0, w]; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); bc = [0, 1 - w, w]; }
    else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; bc = [1 - v - w, v, w]; }
  }
  const q = [0, 1, 2].map((k) => B[a + k] * bc[0] + B[b + k] * bc[1] + B[c + k] * bc[2]);
  return { bc, q, d2: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 };
}
const anySkin = skinLookup(() => true), trunkSkin = skinLookup((t) => !armTri(t));

// ---- 1. the tee's outer layer --------------------------------------------------------------------------------------
const P = floats(prim.getAttribute('POSITION')), UV = floats(prim.getAttribute('TEXCOORD_0')), I = Uint32Array.from(prim.getIndices().getArray());
// A point of the tee is OUTER when her body is nearer BEHIND it than in front of it: a ray along its normal and a ray
// against it, each to the first of her triangles. The outer layer has her body behind it; the inner layer faces her
// body. Between her side and a hanging arm both rays meet her, and the nearer says which way the cloth wraps: the side
// of the tee lies on her side, its sleeve round her arm. (Telling the layers by the skin nearest a point instead swapped
// them there -- the arm's skin faces her side -- and cut her sides and sleeves out of the sheet.) A point with her body
// on neither side within RAY takes the side of its nearest neighbour that could be told; then every point votes with
// its neighbours a few times, and a triangle is outer when two of its three points are.
const { ids: nodeOf, count: nodes } = weld(P), { start: nbStart, list: nbList } = neighbours(I, nodeOf, nodes), nodeNormal = weldedNormals(P, I, nodeOf, nodes);
const nodeAt = new Int32Array(nodes).fill(-1); for (let v = 0; v < nodeOf.length; v++) if (nodeAt[nodeOf[v]] < 0) nodeAt[nodeOf[v]] = v;
const rayToBody = (() => {
  const C = 0.01, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (let t = 0; t < BI.length; t += 3) {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(B[BI[t] * 3 + k], B[BI[t + 1] * 3 + k], B[BI[t + 2] * 3 + k]) / C)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(B[BI[t] * 3 + k], B[BI[t + 1] * 3 + k], B[BI[t + 2] * 3 + k]) / C));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = key(x, y, z); (grid.get(k) ?? grid.set(k, []).get(k)).push(t); }
  }
  return (o, d, reach) => {
    let best = Infinity; const seen = new Set();
    for (let s = 0; s * C * 0.5 <= reach + C && best === Infinity; s++) {
      const q = [0, 1, 2].map((k) => o[k] + d[k] * s * C * 0.5);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const t of grid.get(key(Math.floor(q[0] / C) + dx, Math.floor(q[1] / C) + dy, Math.floor(q[2] / C) + dz)) ?? []) {
        if (seen.has(t)) continue; seen.add(t);
        const a = BI[t] * 3, b = BI[t + 1] * 3, c = BI[t + 2] * 3;
        const e1 = [B[b] - B[a], B[b + 1] - B[a + 1], B[b + 2] - B[a + 2]], e2 = [B[c] - B[a], B[c + 1] - B[a + 1], B[c + 2] - B[a + 2]];
        const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det, tv = [o[0] - B[a], o[1] - B[a + 1], o[2] - B[a + 2]], u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
        if (u < 0 || u > 1) continue;
        const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
        if (dist > 0 && dist < reach && dist < best) best = dist;
      }
    }
    return best;
  };
})();
const UNKNOWN = 2, outerNode = new Uint8Array(nodes);
let plain = 0;
for (let j = 0; j < nodes; j++) {
  const v = nodeAt[j], q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], n = [nodeNormal[j * 3], nodeNormal[j * 3 + 1], nodeNormal[j * 3 + 2]];
  const ahead = rayToBody(q, n, RAY / scale), behind = rayToBody(q, n.map((x) => -x), RAY / scale);
  // told only when it is plain: her body close on one side (within RAY_CLOSE) and at least RAY_RATIO times as far, or
  // not there at all, on the other. Anything less (cloth hanging between her side and an arm, cloth far from her) is
  // left to its neighbours.
  const near = Math.min(ahead, behind), far = Math.max(ahead, behind);
  if (near * scale > RAY_CLOSE || far < near * RAY_RATIO) { outerNode[j] = UNKNOWN; continue; }
  outerNode[j] = behind < ahead ? 1 : 0; plain++;
}
{
  let front = []; for (let j = 0; j < nodes; j++) if (outerNode[j] !== UNKNOWN) front.push(j);
  while (front.length) {
    const next = [];
    for (const j of front) for (let k = nbStart[j]; k < nbStart[j + 1]; k++) { const u = nbList[k]; if (outerNode[u] === UNKNOWN) { outerNode[u] = outerNode[j]; next.push(u); } }
    front = next;
  }
  for (let j = 0; j < nodes; j++) if (outerNode[j] === UNKNOWN) outerNode[j] = 0;
}
for (let round = 0; round < 12; round++) {
  let changed = 0;
  for (let j = 0; j < nodes; j++) { let o = 0; const deg = nbStart[j + 1] - nbStart[j]; for (let k = nbStart[j]; k < nbStart[j + 1]; k++) o += outerNode[nbList[k]]; const v = 2 * o > deg ? 1 : 2 * o < deg ? 0 : outerNode[j]; if (v !== outerNode[j]) { outerNode[j] = v; changed++; } }
  if (!changed) break;
}
let outerTris = [];
for (let t = 0; t < I.length; t += 3) if (outerNode[nodeOf[I[t]]] + outerNode[nodeOf[I[t + 1]]] + outerNode[nodeOf[I[t + 2]]] >= 2) outerTris.push(t);
{
  const parent = new Int32Array(nodes).map((_, i) => i), find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const t of outerTris) { const a = find(nodeOf[I[t]]), b = find(nodeOf[I[t + 1]]), c = find(nodeOf[I[t + 2]]); parent[b] = a; parent[find(c)] = a; }
  const size = new Map(); for (const t of outerTris) { const r = find(nodeOf[I[t]]); size.set(r, (size.get(r) ?? 0) + 1); }
  const ranked = [...size].sort((x, y) => y[1] - x[1]), main = ranked[0][0];
  console.log(`layers: ${plain} of ${nodes} points told by rays to her body; outer pieces ${ranked.slice(0, 5).map(([, n]) => n).join(', ')} triangles`);
  outerTris = outerTris.filter((t) => find(nodeOf[I[t]]) === main);
}
const outer = outerTris.flatMap((t) => [I[t], I[t + 1], I[t + 2]]);
console.log(`outer layer: ${outer.length / 3} of ${I.length / 3} triangles`);
// compact, then simplify the sheet. The neckline and sleeves are LOCKED (they stay exactly where they are); the hem is
// simplified with the rest. Locked too, it kept every point of the modelled tee's fold -- 327 of them, some 0.1 mm
// apart, where the cloth is 11 mm apart everywhere else -- and at 0% length those tiny edges crumpled into a ragged
// hem (Joshua, 2026-10-24: "the 0% shirt bottom hem/seams, was not straight but when I added more length, it did").
let used = [...new Set(outer)].sort((x, y) => x - y);
const remapOuter = new Map(used.map((v, i) => [v, i]));
let VP = Float32Array.from(used.flatMap((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])), VUV = Float32Array.from(used.flatMap((v) => [UV[v * 2], UV[v * 2 + 1]]));
let VI = Uint32Array.from(outer, (v) => remapOuter.get(v));
{
  const { ids: weldedOf, count: welded } = weld(VP);
  // the sheet's open edges, by welded point (a UV seam is not an edge), and which of them is the hem: the lowest
  const use = new Map(), next = new Map();
  for (let t = 0; t < VI.length; t += 3) for (let e = 0; e < 3; e++) { const a = weldedOf[VI[t + e]], b = weldedOf[VI[t + (e + 1) % 3]]; const k = a < b ? `${a},${b}` : `${b},${a}`; use.set(k, (use.get(k) ?? 0) + 1); }
  for (let t = 0; t < VI.length; t += 3) for (let e = 0; e < 3; e++) { const a = weldedOf[VI[t + e]], b = weldedOf[VI[t + (e + 1) % 3]]; if (use.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) next.set(a, b); }
  const at = new Float64Array(welded * 3); for (let v = 0; v < weldedOf.length; v++) for (let k = 0; k < 3; k++) at[weldedOf[v] * 3 + k] = VP[v * 3 + k];
  const edges = [], seenEdge = new Set();
  for (const s of next.keys()) { if (seenEdge.has(s)) continue; const l = []; let v = s; while (v !== undefined && !seenEdge.has(v)) { seenEdge.add(v); l.push(v); v = next.get(v); } edges.push(l); }
  const heightOf = (l) => l.reduce((s, p) => s + toWorld(at[p * 3], at[p * 3 + 1], at[p * 3 + 2])[1], 0) / l.length;
  const hemEdge = edges.filter((l) => l.length >= 12).reduce((a, b) => (heightOf(a) < heightOf(b) ? a : b));
  const hemPoint = new Uint8Array(welded); for (const p of hemEdge) hemPoint[p] = 1;
  // first the sheet, every edge locked; then the hem alone, along itself, within HEM_ERROR of its shape
  const ratio = Math.min(1, PARTICLES / welded);
  const [sheet] = MeshoptSimplifier.simplify(VI, VP, 3, Math.floor(VI.length * ratio / 3) * 3, 1, ['LockBorder']);
  const lock = Uint8Array.from(weldedOf, (p) => (hemPoint[p] ? 0 : 1));
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(sheet, VP, 3, VUV, 2, [0.01, 0.01], lock, 0, HEM_ERROR, ['ErrorAbsolute']);
  const keep = [...new Set(simple)].sort((x, y) => x - y), map = new Map(keep.map((v, i) => [v, i]));
  VP = Float32Array.from(keep.flatMap((v) => [VP[v * 3], VP[v * 3 + 1], VP[v * 3 + 2]])); VUV = Float32Array.from(keep.flatMap((v) => [VUV[v * 2], VUV[v * 2 + 1]]));
  VI = Uint32Array.from(simple, (v) => map.get(v));
  console.log(`sheet simplified from ${welded} points of cloth`);
}
// particles: one per point of cloth (UV seams welded)
const { ids: particleOf, count: teeParticles } = weld(VP);
const particleRest = new Float64Array(teeParticles * 3);
for (let v = 0; v < particleOf.length; v++) for (let k = 0; k < 3; k++) particleRest[particleOf[v] * 3 + k] = VP[v * 3 + k];
const tris = Uint32Array.from(VI, (v) => particleOf[v]);
console.log(`the tee: ${teeParticles} particles, ${tris.length / 3} triangles`);

// ---- 2. its open edges: the neckline, two sleeves, the hem ---------------------------------------------------------
const edgeUse = new Map();
for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + (e + 1) % 3]; const k = a < b ? `${a},${b}` : `${b},${a}`; edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1); }
const borderNext = new Map();
for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + (e + 1) % 3]; if (edgeUse.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) borderNext.set(a, b); }
const loops = [], seen = new Set();
for (const s of borderNext.keys()) {
  if (seen.has(s)) continue;
  const loop = []; let v = s;
  while (v !== undefined && !seen.has(v)) { seen.add(v); loop.push(v); v = borderNext.get(v); }
  loops.push(loop);
}
const restWorld = (p) => toWorld(particleRest[p * 3], particleRest[p * 3 + 1], particleRest[p * 3 + 2]);
const meanWorld = (loop) => { const m = [0, 0, 0]; for (const p of loop) restWorld(p).forEach((x, k) => (m[k] += x / loop.length)); return m; };
loops.sort((a, b) => b.length - a.length);
const big = loops.filter((l) => l.length >= 12);
if (big.length !== 4) console.warn(`expected 4 open edges (neck, two sleeves, hem), found ${big.length}: the outer layer has a hole`);
console.log(`open edges: ${loops.length} loops, ${big.map((l) => `${l.length}@y${meanWorld(l)[1].toFixed(2)},x${meanWorld(l)[0].toFixed(2)}`).join('  ')}`);
const hem = big.reduce((a, b) => (meanWorld(a)[1] < meanWorld(b)[1] ? a : b));
const neck = big.filter((l) => l !== hem).reduce((a, b) => (Math.abs(meanWorld(a)[0]) < Math.abs(meanWorld(b)[0]) ? a : b));
{
  // the hem as a line: smoothed along itself (Taubin, which does not shrink it), so what the simplifier left of the
  // modelled fold's steps is not a zigzag; then how evenly it is spaced
  const H = hem.length, at = (i) => hem[(i + H) % H];
  for (let pass = 0; pass < 8; pass++) for (const k of [0.5, -0.53]) {
    const was = Float64Array.from(hem.flatMap((p) => [particleRest[p * 3], particleRest[p * 3 + 1], particleRest[p * 3 + 2]]));
    for (let i = 0; i < H; i++) for (let c = 0; c < 3; c++) {
      const prev = was[((i - 1 + H) % H) * 3 + c], nextC = was[((i + 1) % H) * 3 + c];
      particleRest[at(i) * 3 + c] = was[i * 3 + c] + k * ((prev + nextC) / 2 - was[i * 3 + c]);
    }
  }
  const gaps = hem.map((p, i) => Math.hypot(...[0, 1, 2].map((c) => particleRest[p * 3 + c] - particleRest[at(i + 1) * 3 + c])) * scale * 1000).sort((x, y) => x - y);
  console.log(`hem: ${H} points ${gaps[0].toFixed(1)} to ${gaps.at(-1).toFixed(1)} mm apart (median ${gaps[H >> 1].toFixed(1)})`);
}

// ---- 3. rows below the hem, to mid-thigh ---------------------------------------------------------------------------
const axis = meanWorld(hem);
// the hem goes round her one way: make it counter-clockwise seen from above (+y), so rows wind like the cloth above them
const angleOf = (w) => Math.atan2(w[0] - axis[0], w[2] - axis[2]);
{ let turn = 0; for (let i = 0; i < hem.length; i++) { const a = angleOf(restWorld(hem[i])), b = angleOf(restWorld(hem[(i + 1) % hem.length])); turn += Math.atan2(Math.sin(b - a), Math.cos(b - a)); } if (turn < 0) hem.reverse(); }
const sideY = (() => { let s = 0, n = 0; for (const p of hem) { const w = restWorld(p), a = angleOf(w); if (Math.abs(Math.abs(a) - Math.PI / 2) < 0.35) { s += w[1]; n++; } } return s / n; })();
const ROWS = Math.max(1, Math.ceil((sideY - MID_THIGH) / ROW_STEP));
// her trunk and thighs in slabs: the convex outline of each, round the axis
const trunk = []; for (let v = 0; v < BW.length / 3; v++) if (!armVertex[v]) trunk.push(v);
// her trunk's vertices by height, in 5 mm slabs, and each slab's convex outline (built when first asked for)
const SLAB = 0.005, slabs = new Map(), hulls = new Map();
for (const v of trunk) { const k = Math.floor(BW[v * 3 + 1] / SLAB); let l = slabs.get(k); if (!l) slabs.set(k, (l = [])); l.push(v); }
function hullAt(y) {
  const key = Math.floor(y / SLAB);
  if (hulls.has(key)) return hulls.get(key);
  // the slab's points within ROW_STEP × 0.75 of y, flattened onto the floor round the axis
  const pts = [], reach = Math.ceil(ROW_STEP * 0.75 / SLAB);
  for (let k = key - reach; k <= key + reach; k++) for (const v of slabs.get(k) ?? []) pts.push([BW[v * 3] - axis[0], BW[v * 3 + 2] - axis[2]]);
  if (pts.length < 3) { hulls.set(key, null); return null; }
  // the convex hull (monotone chain)
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hulls.set(key, hull);
  return hull;
}
/** Where a ray from the axis along `angle` leaves her convex outline at height y (0 where she has none). */
function outlineRadius(y, angle) {
  const hull = hullAt(y);
  if (!hull) return 0;
  const dx = Math.sin(angle), dz = Math.cos(angle);
  let reach = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = (a[0] * ez - a[1] * ex) / den, u = (a[0] * dz - a[1] * dx) / den;
    if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) reach = Math.max(reach, s);
  }
  return reach;
}
// the extension's columns: evenly spaced round the hem by its length (the hem itself is denser, every point of its
// edge kept), each column's foot the hem at that fraction of the way round
const hemWorld = hem.map(restWorld), hemArc = [0];
for (let i = 1; i <= hem.length; i++) { const a = hemWorld[i - 1], b = hemWorld[i % hem.length]; hemArc.push(hemArc[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
const hemLength = hemArc[hem.length], columns = Math.max(12, Math.round(hemLength / COLUMN_STEP));
const hemFraction = hemArc.slice(0, hem.length).map((d) => d / hemLength);
const columnFoot = Array.from({ length: columns }, (_, j) => {
  const d = (j / columns) * hemLength; let i = 0; while (i < hem.length - 1 && hemArc[i + 1] < d) i++;
  const t = (d - hemArc[i]) / Math.max(1e-9, hemArc[i + 1] - hemArc[i]), a = hemWorld[i], b = hemWorld[(i + 1) % hem.length];
  return { w: [0, 1, 2].map((k) => a[k] + t * (b[k] - a[k])), near: t < 0.5 ? hem[i] : hem[(i + 1) % hem.length] };
});
const extension = [];
let prevRadius = columnFoot.map(({ w }) => Math.hypot(w[0] - axis[0], w[2] - axis[2]));
for (let k = 1; k <= ROWS; k++) {
  const row = [], radius = [];
  for (let j = 0; j < columns; j++) {
    const w = columnFoot[j].w, a = angleOf(w), y = w[1] - k * ROW_STEP;
    radius.push(Math.max(outlineRadius(y, a) + BAND_OFF, prevRadius[j] - SLOPE * ROW_STEP));
    row.push([0, y, 0]);
  }
  // smooth round the band a little, so one stray vertex of her does not dent a column
  for (let pass = 0; pass < 2; pass++) for (let j = 0; j < columns; j++) radius[j] = Math.max(radius[j], (radius[(j + columns - 1) % columns] + radius[(j + 1) % columns]) / 2 - 0.0005);
  for (let j = 0; j < columns; j++) { const a = angleOf(columnFoot[j].w); row[j] = [axis[0] + radius[j] * Math.sin(a), row[j][1], axis[2] + radius[j] * Math.cos(a)]; }
  extension.push(row); prevRadius = radius;
}
console.log(`below the hem: ${ROWS} rows of ${columns} to mid-thigh (${((sideY - MID_THIGH) * 100).toFixed(1)} cm at her sides)`);

// ---- 4. every particle: rest place, binding, pin, row ----------------------------------------------------------------
const nP = teeParticles + ROWS * columns;
const rest = new Float32Array(nP * 3); rest.set(Float32Array.from(particleRest));
const rowOf = new Float32Array(nP);
const ext = (k, j) => teeParticles + (k - 1) * columns + j;
for (let k = 1; k <= ROWS; k++) for (let j = 0; j < columns; j++) { rest.set(toLocal(...extension[k - 1][j]), ext(k, j) * 3); rowOf[ext(k, j)] = k; }
const extTris = [];
// the hem zipped to the first row: walk both loops by the fraction of the way round, always advancing the one behind
{
  let i = 0, j = 0;
  const hf = (x) => (x < hem.length ? hemFraction[x] : 1 + hemFraction[x - hem.length]), cf = (x) => x / columns;
  while (i < hem.length || j < columns) {
    const a = hem[i % hem.length], c = ext(1, j % columns);
    if (j >= columns || (i < hem.length && hf(i + 1) <= cf(j + 1))) { extTris.push(a, c, hem[(i + 1) % hem.length]); i++; }
    else { extTris.push(a, c, ext(1, (j + 1) % columns)); j++; }
  }
}
for (let k = 2; k <= ROWS; k++) for (let j = 0; j < columns; j++) {
  const a = ext(k - 1, j), b = ext(k - 1, (j + 1) % columns), c = ext(k, j), d = ext(k, (j + 1) % columns);
  extTris.push(a, c, b, b, c, d);
}
// wind the extension like the tee: its normals out from her
{
  const t = extTris.slice(0, 3), p = t.map((v) => toWorld(rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]));
  const u = [0, 1, 2].map((k) => p[1][k] - p[0][k]), v = [0, 1, 2].map((k) => p[2][k] - p[0][k]), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const outward = [p[0][0] - axis[0], 0, p[0][2] - axis[2]];
  if (n[0] * outward[0] + n[2] * outward[2] < 0) for (let i = 0; i < extTris.length; i += 3) [extTris[i + 1], extTris[i + 2]] = [extTris[i + 2], extTris[i + 1]];
}
// each particle below the hem hangs from the point of the hem its column starts at: where it is laid on her at first
// (clothShirt.ts), carried from that point as she is posed, rather than from a far-off skin triangle bound to it
const anchorOf = new Float32Array(nP).map((_, p) => p);
for (let k = 1; k <= ROWS; k++) for (let j = 0; j < columns; j++) anchorOf[ext(k, j)] = columnFoot[j].near;
const tri = new Uint32Array(nP * 3), bary = new Float32Array(nP * 3), offset = new Float32Array(nP), pin = new Float32Array(nP);
const neckWorld = neck.map(restWorld), sleeveWorld = big.filter((l) => l !== hem && l !== neck).slice(0, 2).flatMap((l) => l.map(restWorld));
let worstOff = 0, sleeves = 0;
for (let p = 0; p < nP; p++) {
  // bound to her trunk, unless it is sleeve: over her arm, and well clear of her trunk (her side under her arm is trunk)
  const q = [rest[p * 3], rest[p * 3 + 1], rest[p * 3 + 2]], trunk = trunkSkin(q), any = rowOf[p] > 0 ? trunk : anySkin(q);
  const s = any.tri.some((v) => armVertex[v]) && trunk.distance * scale > SLEEVE_CLEAR ? any : trunk;
  if (s !== trunk) sleeves++;
  tri.set(s.tri, p * 3); bary.set(s.bc ?? s.bary, p * 3); offset[p] = s.offset; worstOff = Math.max(worstOff, Math.abs(s.offset));
  if (rowOf[p] === 0) {
    const w = toWorld(...q);
    let d = Infinity; for (const n of neckWorld) d = Math.min(d, Math.hypot(w[0] - n[0], w[1] - n[1], w[2] - n[2]));
    pin[p] = d <= PIN_IN ? 1 : d >= PIN_OUT ? 0 : 1 - (d - PIN_IN) / (PIN_OUT - PIN_IN);
    // the sleeves' edges are held softly to her arms, so they ride with them and do not slide down them
    let e = Infinity; for (const n of sleeveWorld) e = Math.min(e, Math.hypot(w[0] - n[0], w[1] - n[1], w[2] - n[2]));
    if (e <= SLEEVE_PIN_IN) pin[p] = Math.max(pin[p], SLEEVE_PIN);
  }
}
console.log(`bound to her: the furthest particle ${(worstOff * scale * 100).toFixed(1)} cm off her skin; ${sleeves} on her arms (sleeves); ${[...pin].filter((x) => x > 0).length} particles held (her neckline, softly her sleeves' edges)`);

// ---- 4b. her navel and nipples, for the room to find on her each frame --------------------------------------------
// (Joshua, 2026-10-24: "there are two bellybuttons, the top is the real one, the bottom for some reason is fixed on the
// shirt and it shouldn't be"; and the BREAST and NAVEL DETAIL sliders should reach the cloth.) The modelled tee carries
// its own navel impression; `_NAVEL` says how much each particle is in its zone, where clothShirt.ts smooths the
// pattern flat, so the only navel is hers. And her navel and nipples, each with a ring of skin round it, are recorded
// by vertex: the room poses them each frame, to lift the cloth over her navel and show both through the fabric.
const at = (v) => [BW[v * 3], BW[v * 3 + 1], BW[v * 3 + 2]];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// her navel: the vertex her navel shapes move most (as the room's own navelHint finds it)
let navelVertex = -1;
{
  let most = 0;
  for (const name of ['navelOut', 'navelIn', 'navelFlat']) {
    const d = skinOffsets.get(name);
    if (!d) continue;
    for (let v = 0; v < d.length / 3; v++) { const m = d[v * 3] ** 2 + d[v * 3 + 1] ** 2 + d[v * 3 + 2] ** 2; if (m > most) { most = m; navelVertex = v; } }
  }
}
if (navelVertex < 0) throw new Error('her navel shapes are missing from the body file');
// her nipples: each breast's apex, the middle of its most forward few millimetres (her front is +z), in a window above
// her bump and out from her cleavage. (Her breasts' growth shape moves most at the cleavage, and "the most forward
// point" over a taller window found the top of her belly.)
const nipples = [-1, -1];
for (const s of [0, 1]) {
  const sign = s === 0 ? -1 : 1, inWindow = (v) => { const [x, y] = at(v); return x * sign >= NIPPLE_WINDOW.across[0] && x * sign <= NIPPLE_WINDOW.across[1] && y >= NIPPLE_WINDOW.up[0] && y <= NIPPLE_WINDOW.up[1]; };
  let front = -Infinity; for (const v of trunk) if (inWindow(v)) front = Math.max(front, at(v)[2]);
  const m = [0, 0, 0]; let n = 0;
  for (const v of trunk) if (inWindow(v) && at(v)[2] >= front - NIPPLE_APEX) { at(v).forEach((x, k) => (m[k] += x)); n++; }
  if (!n) continue;
  m.forEach((_, k) => (m[k] /= n));
  // the skin point nearest that middle, on the front
  let best = Infinity; for (const v of trunk) if (inWindow(v)) { const d = dist3(at(v), [m[0], m[1], front]); if (d < best) { best = d; nipples[s] = v; } }
}
if (nipples.includes(-1)) throw new Error('could not find both nipples in their window');
/** A ring of her skin round a point, `n` vertices evenly round it (counter-clockwise seen from the front), between the radii. */
function ringRound(c, inner, outer, n = 16) {
  const centre = at(c), bins = Array.from({ length: n }, () => ({ v: -1, off: Infinity })), mid = (inner + outer) / 2;
  for (const v of trunk) {
    const p = at(v), d = dist3(p, centre);
    if (d < inner || d > outer || p[2] < centre[2] - outer) continue;
    const a = Math.atan2(p[1] - centre[1], p[0] - centre[0]), k = Math.min(n - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * n));
    if (Math.abs(d - mid) < bins[k].off) bins[k] = { v, off: Math.abs(d - mid) };
  }
  const ring = bins.map((b) => b.v).filter((v) => v >= 0);
  if (ring.length < n * 0.75) throw new Error(`a ring round vertex ${c} found only ${ring.length} of ${n} points`);
  return ring;
}
const navelRings = DETAIL_RINGS.map(([a, b]) => ringRound(navelVertex, a, b));
const nippleRings = nipples.map((v) => DETAIL_RINGS.map(([a, b]) => ringRound(v, a, b)));
const navelZone = new Float32Array(nP);
for (let p = 0; p < teeParticles; p++) {
  const d = dist3(toWorld(rest[p * 3], rest[p * 3 + 1], rest[p * 3 + 2]), at(navelVertex));
  navelZone[p] = d <= NAVEL_ZONE[0] ? 1 : d >= NAVEL_ZONE[1] ? 0 : ((t) => t * t * (3 - 2 * t))((NAVEL_ZONE[1] - d) / (NAVEL_ZONE[1] - NAVEL_ZONE[0]));
}
console.log(`her navel: vertex ${navelVertex} at ${at(navelVertex).map((x) => x.toFixed(3))} m, ${[...navelZone].filter((w) => w > 0).length} particles in its zone; nipples ${nipples.join(', ')} at ${nipples.map((v) => at(v).map((x) => x.toFixed(3)).join(',')).join(' and ')}`);

// ---- 5. the file: render vertices (the tee's own, with their UVs; one per extension particle), per-particle data -----
const renderCount = particleOf.length + ROWS * columns;
const vertexParticle = new Uint32Array(renderCount), vertexUV = new Float32Array(renderCount * 2);
vertexParticle.set(particleOf); vertexUV.set(VUV);
const uvOfParticle = (p) => { const v = particleOf.indexOf(p); return [VUV[v * 2], VUV[v * 2 + 1]]; };
for (let k = 1; k <= ROWS; k++) for (let j = 0; j < columns; j++) { const v = particleOf.length + (k - 1) * columns + j; vertexParticle[v] = ext(k, j); vertexUV.set(uvOfParticle(columnFoot[j].near), v * 2); }
// render triangles: the tee's own vertex triangles, the extension's through its one vertex per particle
const extVertex = (p) => (p < teeParticles ? null : particleOf.length + (p - teeParticles));
const hemVertex = new Map(hem.map((p) => [p, particleOf.indexOf(p)]));
const renderIndex = Uint32Array.from([...VI, ...extTris.map((p) => (p < teeParticles ? hemVertex.get(p) : extVertex(p)))]);
const perVertex = (array, size) => { const out = new array.constructor(renderCount * size); for (let v = 0; v < renderCount; v++) for (let k = 0; k < size; k++) out[v * size + k] = array[vertexParticle[v] * size + k]; return out; };

const out = doc; // reuse its material, textures and nothing else
const material = prim.getMaterial();
for (const m of out.getRoot().listMeshes()) m.dispose();
for (const n of out.getRoot().listNodes()) n.dispose();
for (const s of out.getRoot().listSkins()) s.dispose();
const buffer = out.getRoot().listBuffers()[0];
const acc = (array, type, normalized = false) => out.createAccessor().setArray(array).setType(type).setBuffer(buffer).setNormalized(normalized);
const clothPrim = out.createPrimitive()
  .setAttribute('POSITION', acc(perVertex(rest, 3), 'VEC3'))
  .setAttribute('TEXCOORD_0', acc(vertexUV, 'VEC2'))
  .setAttribute('_PARTICLE', acc(Float32Array.from(vertexParticle), 'SCALAR'))
  .setAttribute('_BODY_TRI', acc(perVertex(tri, 3), 'VEC3'))
  .setAttribute('_BODY_BARY', acc(perVertex(bary, 3), 'VEC3'))
  .setAttribute('_OFFSET', acc(perVertex(offset, 1), 'SCALAR'))
  .setAttribute('_PIN', acc(perVertex(pin, 1), 'SCALAR'))
  .setAttribute('_ROW', acc(perVertex(rowOf, 1), 'SCALAR'))
  .setAttribute('_ANCHOR', acc(perVertex(anchorOf, 1), 'SCALAR'))
  .setAttribute('_NAVEL', acc(perVertex(navelZone, 1), 'SCALAR'))
  .setIndices(acc(renderIndex, 'SCALAR'))
  .setMaterial(material);
const clothMesh = out.createMesh('sarah-v2-shirt-spandex-cloth').addPrimitive(clothPrim).setExtras({
  cloth: {
    version: 2, source: SOURCE.split('/').pop(), particles: nP, teeParticles, rows: ROWS, columns, armBones: [...armJoint].sort((a, b) => a - b), rowStepM: ROW_STEP, midThighM: +MID_THIGH.toFixed(4), localToMetres: +scale.toFixed(6), pinIn: PIN_IN, pinOut: PIN_OUT,
    detail: { navel: navelVertex, navelRings, nipples, nippleRings, navelZoneM: NAVEL_ZONE, ringsM: DETAIL_RINGS },
  },
});
out.getRoot().listScenes()[0].addChild(out.createNode('sarah-v2-shirt-spandex-cloth').setMesh(clothMesh));
await out.transform(prune({ keepAttributes: true, keepLeaves: false }));
out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(TARGET, out);
console.log(`${TARGET}: ${(statSync(TARGET).size / 1048576).toFixed(2)} MB (${nP} particles: ${teeParticles} the tee, ${ROWS} × ${columns} below it; ${renderIndex.length / 3} triangles)`);
