/**
 * THE BUMP AS A SLIDER — a morph target that takes a pregnant body's belly
 * from the master's full term down to nearly flat.
 *
 * Joshua, 2026-10-07, on the base mannequin: "reversing the belly size from
 * this max size to almost flat". Two separate generations (one pregnant, one
 * not) cannot be blended — they never share vertices in the same order — so
 * the flatter shape is made from THIS mesh: the same vertices, moved, stored
 * as the difference (glTF morph target `belly`, weight 0 = as authored, 1 =
 * flat). A renderer blends between them with one number; clothes grown from
 * the body (`growClothes.mjs`) copy the same difference and shrink with it.
 *
 * THE FLAT SHAPE, measured from the mesh and nothing else. Down the front of
 * the torso, in columns 1 cm wide, each column's front-most surface is read
 * as a profile over height: the bump is its peak between the hips and the
 * chest; above the peak the profile falls to the crease under the bust, and
 * below it to the pubis. Those two minima are the column's ANCHORS, and a
 * non-pregnant abdomen is the line between them with a gentle `BULGE_M`
 * forward at its middle, fading across the body as the bump does. Every
 * vertex in the column between its anchors that stands in front of that
 * surface is drawn back toward it, keeping `KEEP` of how far it stood out —
 * enough that the navel and the skin's own relief survive.
 *
 * Nothing behind the flat surface moves: not the back, not the sides, not the
 * breasts (above the upper anchor), not the hips (below the lower one). The
 * NORMALS move too (a NORMAL target), or the flat belly is lit as a dome.
 *
 * The body faces +z and is measured in the master's own units (metres).
 * A module, not a command; imported by `bakeHumans.mjs` for bodies with
 * `bellyMorph`.
 */
import * as THREE from 'three';

/** How far forward a flat (not pregnant) belly still stands of its anchor line, metres. */
export const BULGE_M = 0.022;
/** Of how far a vertex stood in front of the flat surface, how much it keeps. */
export const KEEP = 0.12;
/** Half the width of the belly's columns, metres either side of the centre. */
export const HALF_WIDTH_M = 0.2;
/** The morph target's name, in the mesh's `extras.targetNames`. */
export const TARGET = 'belly';

const COL = 0.01;

export function bellyMorph(doc, { log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION').getCount() > a.getAttribute('POSITION').getCount() ? p : a));
  const P = prim.getAttribute('POSITION');
  const n = P.getCount();
  const pos = new Float32Array(n * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < n; i += 1) { P.getElement(i, v); pos.set(v, i * 3); }

  // The skeleton tells where the hips and the chest are.
  const skin = doc.getRoot().listSkins()[0];
  const m = skin.getInverseBindMatrices().getArray();
  const ys = [];
  for (let o = 0; o < m.length; o += 16) ys.push(new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(Array.from(m.slice(o, o + 16))).invert()).y);
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().filter((c) => joints.includes(c)).length);
  const pelvis = kids.findIndex((k) => k >= 3);
  const hipY = Math.min(...joints[pelvis].listChildren().filter((c) => joints.includes(c)).map((c) => ys[joints.indexOf(c)]));
  // the chest: the next joint up the spine that branches three ways
  let chestY = Infinity;
  for (let i = 0; i < joints.length; i += 1) if (i !== pelvis && kids[i] >= 3 && ys[i] > ys[pelvis] && ys[i] < chestY) chestY = ys[i];
  if (!Number.isFinite(chestY)) { log('belly: no chest found; no morph'); return; }

  // Per centimetre of height, along the body's centre: the front (the bump's
  // profile), the back, and the waist's half width (arms are out at the T).
  const y0 = hipY - 0.15, rows = Math.ceil((chestY - y0) / COL);
  const frontC = new Float32Array(rows).fill(-Infinity), back = new Float32Array(rows).fill(Infinity), half = new Float32Array(rows);
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const r = Math.floor((y - y0) / COL);
    if (r < 0 || r >= rows || Math.abs(x) > 0.3) continue;
    if (Math.abs(x) < 0.03) { frontC[r] = Math.max(frontC[r], z); back[r] = Math.min(back[r], z); }
    half[r] = Math.max(half[r], Math.abs(x));
  }
  // fill rows a sparse front missed (they read the back of the body)
  for (let r = 1; r < rows - 1; r += 1) {
    const lo = Math.min(frontC[r - 1], frontC[r + 1]);
    if (Number.isFinite(lo) && !(frontC[r] >= lo - 0.02)) frontC[r] = (frontC[r - 1] + frontC[r + 1]) / 2;
  }
  const rowY = (r) => y0 + (r + 0.5) * COL;
  const at = (arr, y) => arr[Math.max(0, Math.min(rows - 1, Math.floor((y - y0) / COL)))];
  // The bump's peak, between the hips and the chest.
  let peak = -1;
  for (let r = 0; r < rows; r += 1) if (rowY(r) > hipY - 0.02 && rowY(r) < chestY - 0.05 && Number.isFinite(frontC[r]) && (peak < 0 || frontC[r] > frontC[peak])) peak = r;
  if (peak < 0) { log('belly: no bump found; no morph'); return; }
  // THE TOP ANCHOR: up from the peak, where the steep upper slope of the bump gives
  // way to the breastbone (the profile falls less than half a centimetre a centimetre).
  let top = peak;
  let steep = false;
  for (let r = peak + 1; r < rows; r += 1) {
    const fall = frontC[r - 1] - frontC[r];
    if (fall > 0.01) steep = true;
    if (steep && fall < 0.005) { top = r; break; }
  }
  // THE BOTTOM ANCHOR: the pubis, 7.5 cm under the hip joints (anatomy, not the
  // profile: the profile's minimum there is the gap between the legs).
  const yTop = rowY(top), yBot = hipY - 0.075;
  const zTop = frontC[top], zBot = at(frontC, yBot);
  const rise = frontC[peak] - Math.max(zTop, zBot);
  if (process.env.BELLY_DEBUG) console.log({ yTop, zTop, yBot, zBot, peakY: rowY(peak), peakZ: frontC[peak] });
  if (top === peak || rise < 0.04) { log(`belly: no bump to flatten (rise ${(rise * 100).toFixed(1)} cm); no morph`); return; }

  // THE FLAT FRONT: at the centre, the line from pubis to breastbone with a gentle
  // bulge; across the body, an oval as wide as the waist at that height.
  const flatAt = (x, y) => {
    const t = (y - yBot) / (yTop - yBot);
    const zc = zBot + (zTop - zBot) * t + BULGE_M * Math.sin(Math.PI * t);
    const zb = at(back, y), w = Math.max(0.08, at(half, y));
    const zm = (zc + zb) / 2;
    return { z: zm + (zc - zm) * Math.sqrt(Math.max(0, 1 - (x / w) ** 2)), w };
  };
  const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

  // THE BREASTS ARE NOT THE BELLY. Off the centre line, a breast's underside meets
  // the bump's upper slope below the breastbone; every column of the front gets its
  // own top, the crease there (the first low point of its profile above the bump),
  // so nothing above it moves. 1 cm columns, each widened to its neighbours and
  // with the bins that read the back of the body filled.
  const peakY = rowY(peak);
  const cols = Math.round((2 * HALF_WIDTH_M) / COL);
  const colOf = (x) => Math.floor((x + HALF_WIDTH_M) / COL);
  const raw = Array.from({ length: cols }, () => new Float32Array(rows).fill(-Infinity));
  for (let i = 0; i < n; i += 1) {
    const c = colOf(pos[i * 3]), r = Math.floor((pos[i * 3 + 1] - y0) / COL);
    if (c >= 0 && c < cols && r >= 0 && r < rows) raw[c][r] = Math.max(raw[c][r], pos[i * 3 + 2]);
  }
  const crease = new Float32Array(cols);
  for (let c = 0; c < cols; c += 1) {
    const f = new Float32Array(rows).fill(-Infinity);
    for (let d = -1; d <= 1; d += 1) if (raw[c + d]) for (let r = 0; r < rows; r += 1) f[r] = Math.max(f[r], raw[c + d][r]);
    for (let r = 1; r < rows - 1; r += 1) {
      const lo = Math.min(f[r - 1], f[r + 1]);
      if (Number.isFinite(lo) && !(f[r] >= lo - 0.02)) f[r] = (f[r - 1] + f[r + 1]) / 2;
    }
    // a crease only counts with a breast rising 1.5 cm over it, and only in the
    // upper part of the bump; a column with no breast keeps the breastbone's top
    const from = Math.max(peak, Math.floor((yTop - 0.12 - y0) / COL));
    let low = -1, breast = false;
    for (let r = from; r < rows; r += 1) {
      if (!Number.isFinite(f[r])) continue;
      if (low < 0 || f[r] < f[low]) low = r;
      if (f[r] > f[low] + 0.015 && r > low) { breast = true; break; }
    }
    crease[c] = breast ? Math.min(yTop, rowY(low)) : yTop;
  }
  // a moving median, so one column's stray reading cannot notch the boundary
  const tops = Float32Array.from(crease, (_, c) => {
    const w = [];
    for (let d = -3; d <= 3; d += 1) if (c + d >= 0 && c + d < cols) w.push(crease[c + d]);
    return w.sort((p, q) => p - q)[Math.floor(w.length / 2)];
  });

  // Every vertex sharing a position gets the same move, or a UV seam opens.
  const delta = new Float32Array(n * 3);
  let moved = 0, most = 0;
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const c = colOf(x);
    if (c < 0 || c >= cols) continue;
    const yt = tops[c];
    if (y <= yBot || y >= yt) continue;
    const { z: zFlat, w } = flatAt(x, y);
    if (z <= zFlat) continue;
    // fade toward the sides of the waist, and into the anchors
    // (the wide fade at the top only where a breast sits over a crease; down the
    // middle the flat line meets the breastbone itself and needs none)
    const topFade = yt < yTop - 0.005 ? 0.04 : 0.006;
    const k = smooth(w, 0.55 * w, Math.abs(x)) * smooth(yBot, yBot + 0.006, y) * smooth(yt, yt - topFade, y);
    const d = -(z - zFlat) * (1 - KEEP) * k;
    delta[i * 3 + 2] = d;
    if (d < 0) { moved += 1; most = Math.min(most, d); }
  }
  const centre = { rise, bot: yBot, top: yTop };

  // Normals: recompute both shapes the same way over welded positions, and store
  // the difference (so the authored normals stay as they were at weight 0).
  const idx = prim.getIndices().getArray();
  const normalsOf = (shift) => {
    const key = new Map(), rep = new Int32Array(n);
    for (let i = 0; i < n; i += 1) {
      const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
      if (!key.has(k)) key.set(k, i);
      rep[i] = key.get(k);
    }
    const acc = new Float32Array(n * 3);
    const p = (i, a) => pos[i * 3 + a] + (shift ? shift[i * 3 + a] : 0);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], cc = idx[f + 2];
      const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2);
      const vx = p(cc, 0) - p(a, 0), vy = p(cc, 1) - p(a, 1), vz = p(cc, 2) - p(a, 2);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const w of [rep[a], rep[b], rep[cc]]) { acc[w * 3] += nx; acc[w * 3 + 1] += ny; acc[w * 3 + 2] += nz; }
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const r = rep[i], l = Math.hypot(acc[r * 3], acc[r * 3 + 1], acc[r * 3 + 2]) || 1;
      out[i * 3] = acc[r * 3] / l; out[i * 3 + 1] = acc[r * 3 + 1] / l; out[i * 3 + 2] = acc[r * 3 + 2] / l;
    }
    return out;
  };
  const before = normalsOf(null), after = normalsOf(delta);
  // Squashing the bump pinches its widest ring, and a few faces there fold; their
  // recomputed normals spike and light as a dark seam. So the flat shape's normals
  // are SMOOTHED across the moved region (and a ring round it) over the welded
  // mesh before the difference is taken, and a normal that turned more than 75
  // degrees from where it was is not trusted at all.
  const weld = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    if (!weld.has(k)) weld.set(k, i);
    rep[i] = weld.get(k);
  }
  const nb = new Map();
  const link = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  for (let f = 0; f < idx.length; f += 3) {
    const a = rep[idx[f]], b = rep[idx[f + 1]], c = rep[idx[f + 2]];
    link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
  }
  const region = new Set();
  for (let i = 0; i < n; i += 1) if (delta[i * 3 + 2] < 0) region.add(rep[i]);
  for (let ring = 0; ring < 2; ring += 1) for (const r of [...region]) for (const u of nb.get(r) || []) region.add(u);
  let field = new Float32Array(after);
  for (let it = 0; it < 8; it += 1) {
    const next = new Float32Array(field);
    for (const r of region) {
      let x = field[r * 3], y = field[r * 3 + 1], z = field[r * 3 + 2];
      for (const u of nb.get(r) || []) { x += field[u * 3]; y += field[u * 3 + 1]; z += field[u * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      next[r * 3] = x / l; next[r * 3 + 1] = y / l; next[r * 3 + 2] = z / l;
    }
    field = next;
  }
  const ndelta = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const r = rep[i];
    if (!region.has(r)) continue;
    const dot = field[r * 3] * before[r * 3] + field[r * 3 + 1] * before[r * 3 + 1] + field[r * 3 + 2] * before[r * 3 + 2];
    if (dot < Math.cos((75 * Math.PI) / 180)) continue;
    for (let a = 0; a < 3; a += 1) ndelta[i * 3 + a] = field[r * 3 + a] - before[r * 3 + a];
  }

  // The other primitives (none on the masters) get an empty target, as glTF requires.
  const buffer = doc.getRoot().listBuffers()[0];
  for (const p of mesh.listPrimitives()) {
    const count = p.getAttribute('POSITION').getCount();
    const t = doc.createPrimitiveTarget(TARGET);
    t.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? delta : new Float32Array(count * 3)));
    t.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(p === prim ? ndelta : new Float32Array(count * 3)));
    p.addTarget(t);
  }
  const extras = mesh.getExtras() || {};
  mesh.setExtras({ ...extras, targetNames: [...(extras.targetNames || []), TARGET] });
  mesh.setWeights([...(mesh.getWeights() || []), 0]);
  log(`belly: morph target '${TARGET}' on ${moved.toLocaleString()} vertices; the centre's ${(centre.rise * 100).toFixed(1)} cm rise flattens by up to ${(-most * 100).toFixed(1)} cm (from ${centre.bot.toFixed(2)} to ${centre.top.toFixed(2)} m up)`);
}
