/**
 * CLOTHES GROWN FROM THE BODY — a fitted shirt and leggings made from the base
 * mannequin's own surface, so they fit her exactly and move with her exactly.
 *
 * Joshua, 2026-10-07, on the base mannequin: can you make "soft body clothing"?
 * Two kinds of clothing were agreed. Clothes that FIT (a maternity top,
 * leggings) are grown here: a region of the body's skin, copied and pushed out
 * along its normals by the cloth's thickness, keeping every vertex's bone
 * weights. Skinned exactly like the skin under it, a garment cannot pass
 * through her in any pose. It also carries the body's `belly` morph target
 * (`bellyMorph.mjs`), so the shirt shrinks with the bump. Loose parts that
 * swing (a lab coat's tails, a ponytail) are the other kind, and come later.
 *
 * WHERE A GARMENT IS, measured from the skeleton, never from bone names. Each
 * vertex is classed by which part of the skeleton carries most of its weight:
 * the TORSO (root, pelvis, the spine to the chest, the collarbones), the LEGS
 * (everything under the hips), the UPPER ARMS (the shoulder joints), the rest
 * of the ARMS, and the HEAD (the neck up).
 *
 *   shirt     a fitted tee, from the hem (`HEM_FRONT` under the bump, `HEM_BACK`
 *             over the seat) up to the neck, a scoop at the front, short sleeves to
 *             `SLEEVE` of the way to the elbow; or (`cut: 'crop'`) a crop top from
 *             just under the bust (`CROP_UNDER_TIP`);
 *   leggings  the legs up to a waistband under the bump (`WAIST_FRONT`, `WAIST_BACK`);
 *             or (`rise: 'panel'`) maternity leggings with a panel over the whole
 *             bump, under a crop top's hem (`PANEL_OVERLAP`); down to `CUFF`.
 *
 * Each garment is its own primitive with its own material (named `shirt`,
 * `leggings`), so a renderer can show or hide it. Each edge is a smooth line
 * over the skin, the faces it crosses cut along it; and the cloth bridges the
 * skin's hollows rather than following them in.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for bodies with
 * `clothes`. Run after every weight pass (so the clothes copy the final
 * weights) and after `bellyMorph` (so they copy the morph).
 */
import * as THREE from 'three';
import { paintGarment } from './paintGarment.mjs';

/** The crop top's hem, this far under the breasts' tips: just under the bust, on the top of the bump. */
export const CROP_UNDER_TIP = 0.075;
/** A tee's hem under the hip joints: at the front (under the bump) and the back (over the top of the seat). */
export const HEM_FRONT = 0.075;
export const HEM_BACK = 0.05;
/** Leggings' waistband over the hip joints, front (under the bump) and back. */
export const WAIST_FRONT = 0.03;
export const WAIST_BACK = 0.1;
/** The leggings' panel runs up under the top's hem by this much. */
export const PANEL_OVERLAP = 0.03;
/** The neckline under the neck joint: a scoop at the front, high at the back. */
export const SCOOP_FRONT = 0.1;
export const SCOOP_BACK = 0.03;
/** Short sleeves: this far from the shoulder to the elbow. */
export const SLEEVE = 0.42;
/** The leggings' cuff over the ankle, and the waistband over the hip joints, front and back. */
export const CUFF = 0.05;
/** The most the cloth is brought forward to span a hollow, metres (the crease under the bust is about 4 cm). */
export const HULL_MAX_M = 0.045;
/** How many passes the span is eased over the cloth. */
export const HULL_EASE = 40;
/**
 * The red tee and black leggings of Joshua's reference sheet (2026-10-08: "I would
 * probably start with the red shirt and black leggings so it matches what we had
 * before"): a fitted tee over the bump, black leggings under it. `cut` 'crop' and
 * `rise` 'panel' make the two-tone crop top over maternity leggings instead
 * (Joshua tried it the same night and went back to the tee). `bridge`: the hollows the
 * cloth spans on the front: 'cleavage' across the breasts only (a crop top's hem
 * sits at the crease under them), true for every hollow down the front as well (a
 * long tee falling from the bust onto the bump), 0 for none (leggings stay on the skin).
 */
export const GARMENTS = {
  shirt: {
    // the sheet's own red (its median, sRGB 189 45 60), a touch deeper for the scene's lights
    colour: [0.48, 0.024, 0.04], thickness: 0.008, roughness: 0.82, cut: 'tee', bridge: true,
    // the eight-view sheet it is dressed from, and which of its pixels are the tee
    sheet: 'art/humans/outfits/red-tee-sheet.png',
    isCloth: (r, g, b) => r > 70 && r > g * 1.7 && r > b * 1.6,
  },
  leggings: { colour: [0.018, 0.018, 0.022], thickness: 0.004, roughness: 0.6, rise: 'waist', bridge: 0 },
};

function jointPositions(skin) {
  const m = skin.getInverseBindMatrices().getArray();
  const out = [];
  for (let o = 0; o < m.length; o += 16) {
    out.push(new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(Array.from(m.slice(o, o + 16))).invert()));
  }
  return out;
}

/** Every joint's part of the body, from the skeleton's shape. */
function partsOf(skin, at) {
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().filter((c) => joints.includes(c)).map((c) => joints.indexOf(c)));
  const part = new Array(joints.length).fill('torso');
  const mark = (j, name) => { part[j] = name; for (const k of kids[j]) mark(k, name); };
  const pelvis = kids.findIndex((k) => k.length >= 3);
  if (pelvis < 0) return null;
  // the legs hang off the pelvis below it; the spine goes up
  let spine = -1;
  for (const k of kids[pelvis]) {
    if (at[k].y < at[pelvis].y - 1e-6) mark(k, 'legs');
    else spine = k;
  }
  // up the spine to the chest, the next joint that branches three ways
  let chest = spine;
  while (chest >= 0 && kids[chest].length < 3) chest = kids[chest].length ? kids[chest][0] : -1;
  if (chest < 0) return null;
  // off the chest: the neck (the highest child) and the two collarbones
  const children = [...kids[chest]].sort((a, b) => at[b].y - at[a].y);
  mark(children[0], 'head');
  const shoulders = [];
  for (const clav of children.slice(1)) {
    mark(clav, 'arms');
    part[clav] = 'torso';
    const shoulder = kids[clav][0];
    if (shoulder === undefined) continue;
    part[shoulder] = 'upperArm';
    const elbow = kids[shoulder][0];
    shoulders.push({ shoulder: at[shoulder], elbow: elbow !== undefined ? at[elbow] : at[shoulder] });
  }
  const hipY = Math.min(...kids[pelvis].filter((k) => part[k] === 'legs').map((k) => at[k].y));
  // the ankle: down each leg, the joint before the foot runs forward
  let ankleY = Infinity;
  for (const k of kids[pelvis]) {
    if (part[k] !== 'legs') continue;
    let j = k, prev = k;
    while (kids[j].length && at[kids[j][0]].y < at[j].y - 0.02) { prev = j; j = kids[j][0]; }
    ankleY = Math.min(ankleY, at[j].y);
    void prev;
  }
  return { part, hipY, ankleY, chestY: at[chest].y, neckY: at[children[0]].y, shoulders };
}

export async function growClothes(doc, { log = () => {}, which = ['shirt', 'leggings'], paint = true } = {}) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const mesh = root.listMeshes()[0];
  if (!skin || !mesh) return;
  const body = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION').getCount() > a.getAttribute('POSITION').getCount() ? p : a));
  const at = jointPositions(skin);
  const parts = partsOf(skin, at);
  if (!parts) { log('clothes: no pelvis and chest found; no clothes'); return; }
  const { part, hipY, ankleY, chestY, neckY, shoulders } = parts;

  const P = body.getAttribute('POSITION'), J = body.getAttribute('JOINTS_0'), W = body.getAttribute('WEIGHTS_0');
  const UV = body.getAttribute('TEXCOORD_0');
  const targets = body.listTargets();
  const n = P.getCount();
  const pos = new Float32Array(n * 3);
  const v = [0, 0, 0], j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  const share = Array.from({ length: n }, () => ({ torso: 0, legs: 0, upperArm: 0, arms: 0, head: 0 }));
  for (let i = 0; i < n; i += 1) {
    P.getElement(i, v); pos.set(v, i * 3);
    J.getElement(i, j4); W.getElement(i, w4);
    for (let k = 0; k < 4; k += 1) if (w4[k] > 0) share[i][part[j4[k]] ?? 'torso'] += w4[k];
  }
  // welded normals, so a garment does not split along the body's UV seams
  const idx = body.getIndices().getArray();
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    if (!key.has(k)) key.set(k, i);
    rep[i] = key.get(k);
  }
  const acc = new Float32Array(n * 3);
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f], idx[f + 1], idx[f + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const r of [rep[a], rep[b], rep[c]]) { acc[r * 3] += nx; acc[r * 3 + 1] += ny; acc[r * 3 + 2] += nz; }
  }
  const normal = (i) => {
    const r = rep[i], l = Math.hypot(acc[r * 3], acc[r * 3 + 1], acc[r * 3 + 2]) || 1;
    return [acc[r * 3] / l, acc[r * 3 + 1] / l, acc[r * 3 + 2] / l];
  };

  // WHERE EACH GARMENT ENDS, as a smooth field over the skin: positive inside, its
  // zero line the garment's edge (Joshua, 2026-10-08, matching a reference sheet of
  // a red tee and black leggings). A face used to go in when all three corners did,
  // so every hem, cuff, sleeve and neckline zigzagged along the triangles; now the
  // faces the edge crosses are CUT along it, and the edge is a clean line.
  const smoothstep = (a0, b0, x) => { const t = Math.min(1, Math.max(0, (x - a0) / (b0 - a0))); return t * t * (3 - 2 * t); };
  const sleeveT = (i) => {
    let best = -Infinity, lenOf = 0;
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    for (const sh of shoulders) {
      const ax = sh.elbow.x - sh.shoulder.x, ay = sh.elbow.y - sh.shoulder.y, az = sh.elbow.z - sh.shoulder.z;
      const len2 = ax * ax + ay * ay + az * az;
      if (len2 <= 0 || Math.sign(px) !== Math.sign(sh.shoulder.x)) continue;
      const t = ((px - sh.shoulder.x) * ax + (py - sh.shoulder.y) * ay + (pz - sh.shoulder.z) * az) / len2;
      if (t > best) { best = t; lenOf = Math.sqrt(len2); }
    }
    return { t: best, len: lenOf };
  };
  // THE TWO-TONE OUTFIT (Joshua, 2026-10-08: "making the leggings over the belly and
  // the shirt could be just over the belly/under the breasts"): a crop top whose hem
  // sits just under the bust, on the top of the bump, and maternity leggings whose
  // panel runs up over the whole bump and under the top's hem. The hem's height is
  // read from the breasts themselves: the most forward point either side of the
  // centre, above the hips.
  // A breast stands forward of the body's centre line at its own height (the
  // cleavage is behind it); the bump does not (its middle is its front), and taking
  // the most forward point alone found the top of the bump, so the hem fell mid-bump.
  const centre = new Map();
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(pos[i * 3]) > 0.015) continue;
    const r = Math.round(pos[i * 3 + 1] / 0.01);
    centre.set(r, Math.max(centre.get(r) ?? -Infinity, pos[i * 3 + 2]));
  }
  let tipY = -Infinity, tipZ = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const ax = Math.abs(pos[i * 3]), y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (ax < 0.04 || ax > 0.16 || y < hipY + 0.2 || y > neckY - 0.08) continue;
    if (z < (centre.get(Math.round(y / 0.01)) ?? Infinity) + 0.01) continue;
    if (z > tipZ) { tipZ = z; tipY = y; }
  }
  const cropY = tipY - CROP_UNDER_TIP;
  const field = {
    shirt: (i, spec) => {
      const s = share[i], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (s.head > 0.5) return -1;
      // the neckline: a scoop at the front, high at the back
      const scoop = SCOOP_BACK + (SCOOP_FRONT - SCOOP_BACK) * smoothstep(-0.03, 0.06, z);
      let f = neckY - scoop - y;
      // the hem: a crop top's straight round under the bust; a tee's under the bump at
      // the front and over the top of the seat at the back
      const hemY = spec.cut === 'crop' ? cropY : hipY - HEM_BACK - (HEM_FRONT - HEM_BACK) * smoothstep(-0.02, 0.08, z);
      f = Math.min(f, y - hemY);
      // a tee's inner thighs: it hangs across, never wraps between the legs
      if (spec.cut !== 'crop' && s.legs > 0.6 && y < hipY && z > -0.03) {
        const nrm = normal(i);
        if (nrm[0] * Math.sign(pos[i * 3]) < -0.35) f = Math.min(f, -0.005);
      }
      // short sleeves, cut square across the arm
      if (s.upperArm + s.arms > 0.5) {
        const { t, len } = sleeveT(i);
        if (Number.isFinite(t) && len > 0) f = Math.min(f, (SLEEVE - t) * len);
      }
      return f;
    },
    leggings: (i, spec) => {
      const s = share[i], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (s.arms + s.upperArm > 0.2 || s.head > 0.1) return -1;
      let f = y - (ankleY + CUFF);
      // maternity leggings: a panel up over the whole bump, under a crop top's hem by
      // `PANEL_OVERLAP`. Otherwise a waistband under the bump at the front and up at
      // the back, always over the tee's hem so no skin shows between them.
      if (spec.rise === 'panel') return Math.min(f, cropY + PANEL_OVERLAP - y);
      const waist = hipY + WAIST_FRONT + (WAIST_BACK - WAIST_FRONT) * (1 - smoothstep(-0.04, 0.06, z));
      return Math.min(f, waist - y);
    },
  };

  const buffer = root.listBuffers()[0];
  for (const name of which) {
    const spec = GARMENTS[name];
    const fv = new Float32Array(n);
    for (let i = 0; i < n; i += 1) fv[i] = field[name](i, spec);
    // vertices of the garment: [a, b, t] = the body's a and b, t of the way across
    const verts = [], vkey = new Map();
    const vertex = (a, b, t) => {
      if (t <= 1e-6) { b = a; t = 0; } else if (t >= 1 - 1e-6) { a = b; t = 0; }
      const k = a === b ? `${a}` : a < b ? `${a}:${b}` : `${b}:${a}`;
      let at0 = vkey.get(k);
      if (at0 === undefined) { at0 = verts.length; verts.push(a === b || a < b ? [a, b, t] : [b, a, 1 - t]); vkey.set(k, at0); }
      return at0;
    };
    const cut = (a, b) => vertex(a, b, fv[a] / (fv[a] - fv[b]));
    const faces = [];
    for (let f = 0; f < idx.length; f += 3) {
      const tri = [idx[f], idx[f + 1], idx[f + 2]];
      const ins = tri.map((i) => fv[i] >= 0);
      const nIn = ins.filter(Boolean).length;
      if (nIn === 0) continue;
      if (nIn === 3) { faces.push(vertex(tri[0], tri[0], 0), vertex(tri[1], tri[1], 0), vertex(tri[2], tri[2], 0)); continue; }
      // rotate so the odd corner is first, keeping the winding
      let r = 0;
      while ((nIn === 1 ? !ins[r] : ins[r])) r += 1;
      const A = tri[r], B = tri[(r + 1) % 3], C = tri[(r + 2) % 3];
      if (nIn === 1) {
        faces.push(vertex(A, A, 0), cut(A, B), cut(A, C));
      } else {
        // A is the one outside: the quad B, C, C|A, A|B
        const ab = cut(B, A), ac = cut(C, A);
        faces.push(vertex(B, B, 0), vertex(C, C, 0), ac, vertex(B, B, 0), ac, ab);
      }
    }
    if (!faces.length) { log(`clothes: ${name}: no faces; skipped`); continue; }
    const m = verts.length;
    const lerp3 = (get, a, b, t, out) => { const pa = get(a), pb = get(b); for (let k = 0; k < 3; k += 1) out[k] = pa[k] * (1 - t) + pb[k] * t; return out; };
    const bodyPos = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const guv = new Float32Array(m * 2);
    const gj = new (J.getArray().constructor)(m * 4), gw = new Float32Array(m * 4);
    const uvA = [0, 0], uvB = [0, 0], ja = [0, 0, 0, 0], wa = [0, 0, 0, 0], jb = [0, 0, 0, 0], wb = [0, 0, 0, 0];
    const base = new Float32Array(m * 3), baseN = new Float32Array(m * 3);
    const tmp = [0, 0, 0];
    verts.forEach(([a, b, t], k) => {
      lerp3(bodyPos, a, b, t, tmp); base.set(tmp, k * 3);
      lerp3(normal, a, b, t, tmp); const l = Math.hypot(...tmp) || 1; baseN.set([tmp[0] / l, tmp[1] / l, tmp[2] / l], k * 3);
      if (UV) { UV.getElement(a, uvA); UV.getElement(b, uvB); guv[k * 2] = uvA[0] * (1 - t) + uvB[0] * t; guv[k * 2 + 1] = uvA[1] * (1 - t) + uvB[1] * t; }
      J.getElement(a, ja); W.getElement(a, wa); J.getElement(b, jb); W.getElement(b, wb);
      const mix = new Map();
      for (let q = 0; q < 4; q += 1) { if (wa[q] > 0) mix.set(ja[q], (mix.get(ja[q]) ?? 0) + wa[q] * (1 - t)); if (wb[q] > 0) mix.set(jb[q], (mix.get(jb[q]) ?? 0) + wb[q] * t); }
      const top = [...mix].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((x, e) => x + e[1], 0) || 1;
      for (let q = 0; q < 4; q += 1) { gj[k * 4 + q] = top[q] ? top[q][0] : 0; gw[k * 4 + q] = top[q] ? top[q][1] / sum : 0; }
    });
    // the garment's own welded neighbours, for bridging and for its normals
    const gkey = new Map(), grep = new Int32Array(m);
    for (let k = 0; k < m; k += 1) {
      const kk = `${Math.round(base[k * 3] * 1e5)},${Math.round(base[k * 3 + 1] * 1e5)},${Math.round(base[k * 3 + 2] * 1e5)}`;
      if (!gkey.has(kk)) gkey.set(kk, k);
      grep[k] = gkey.get(kk);
    }
    const nbs = new Map();
    const link = (x, y) => { if (x === y) return; if (!nbs.has(x)) nbs.set(x, new Set()); nbs.get(x).add(y); };
    for (let f = 0; f < faces.length; f += 3) {
      const a = grep[faces[f]], b = grep[faces[f + 1]], c = grep[faces[f + 2]];
      link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
    }
    const reps = [...new Set(grep)];
    const nbList = new Map(reps.map((r) => [r, [...(nbs.get(r) || [])]]));
    // THE CLOTH BRIDGES HOLLOWS (the reference's tee falls straight from the bust onto
    // the bump; grown flat onto the skin it showed every curve and the crease under
    // the breasts): each vertex moves toward its neighbours' average only when that is
    // OUTWARD along its normal, so hollows fill and nothing convex shrinks.
    // THE CLOTH SPANS HOLLOWS (the reference's tee falls straight from the bust onto the
    // bump; grown on the skin it showed every curve and the crease under the breasts).
    // On the front, down each 1 cm slice of the body and across each 1 cm row, the
    // cloth is brought forward to the outer envelope of its own outline (the upper
    // convex hull of the slice, as a stretched sheet would lie), so the crease under
    // the bust, the cleavage and the fall from the bump to the hem are spanned, and
    // nothing that already stands out moves. The forward move fades to nothing round
    // the sides, then is eased over the cloth so no hull corner shows.
    const upperHull = (pts) => {
      pts.sort((p0, p1) => p0[0] - p1[0]);
      const h = [];
      for (const q of pts) {
        while (h.length >= 2) {
          const [ax, az] = h[h.length - 2], [bx, bz] = h[h.length - 1];
          if ((bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax) >= 0) h.pop(); else break;
        }
        h.push(q);
      }
      return h;
    };
    const atHull = (h, u) => {
      if (!h.length || u < h[0][0] || u > h[h.length - 1][0]) return -Infinity;
      for (let q = 1; q < h.length; q += 1) if (u <= h[q][0]) { const t = (u - h[q - 1][0]) / ((h[q][0] - h[q - 1][0]) || 1); return h[q - 1][1] + (h[q][1] - h[q - 1][1]) * t; }
      return h[h.length - 1][1];
    };
    const hullFill = (x, nn) => {
      const BIN = 0.01;
      // the front: anything not facing back, the undersides of the breasts included
      // (facing down, they stayed tucked in while the cloth below came forward, and
      // left a lip), faded out round the sides by how far out it is
      const front = (k) => smoothstep(-0.2, 0.2, nn[k * 3 + 2]) * smoothstep(0.19, 0.13, Math.abs(x[k * 3]));
      const cols = new Map(), rows = new Map();
      for (const r of reps) {
        if (front(r) <= 0) continue;
        const cx = Math.round(x[r * 3] / BIN), ry = Math.round(x[r * 3 + 1] / BIN);
        if (!cols.has(cx)) cols.set(cx, []); cols.get(cx).push([x[r * 3 + 1], x[r * 3 + 2]]);
        if (!rows.has(ry)) rows.set(ry, []); rows.get(ry).push([x[r * 3], x[r * 3 + 2]]);
      }
      const colH = new Map([...cols].map(([k, v]) => [k, upperHull(v)]));
      const rowH = new Map([...rows].map(([k, v]) => [k, upperHull(v)]));
      // Each point goes to the NEAREST point of its slice's envelope, not straight
      // forward: pushed straight forward, the skin under a breast landed in front of
      // the skin above it and the cloth folded over itself in a lip along the bottom
      // of each breast. The nearest point spreads it down the slope instead.
      const nearest = (h, u, w) => {
        let best = null, bd = Infinity;
        for (let q = 1; q < h.length; q += 1) {
          const [ax, az] = h[q - 1], [bx, bz] = h[q];
          const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((u - ax) * ex + (w - az) * ez) / l2));
          const px = ax + ex * t, pz = az + ez * t, d = (px - u) ** 2 + (pz - w) ** 2;
          if (d < bd) { bd = d; best = [px, pz]; }
        }
        return best;
      };
      const below = (h, u, w) => w < atHull(h, u);
      const disp = new Float32Array(m * 3);
      for (const r of reps) {
        const f = front(r);
        if (f <= 0) continue;
        let px = x[r * 3], py = x[r * 3 + 1], pz = x[r * 3 + 2];
        const ch = spec.bridge === 'cleavage' ? null : colH.get(Math.round(px / BIN));
        if (ch && ch.length > 1 && below(ch, py, pz)) { const q = nearest(ch, py, pz); if (q) { py = q[0]; pz = q[1]; } }
        const rh = Math.abs(px) < 0.12 ? rowH.get(Math.round(py / BIN)) : null;
        if (rh && rh.length > 1 && below(rh, px, pz)) { const q = nearest(rh, px, pz); if (q) { px = q[0]; pz = q[1]; } }
        let dx = px - x[r * 3], dy = py - x[r * 3 + 1], dz = pz - x[r * 3 + 2];
        const l = Math.hypot(dx, dy, dz);
        if (l > HULL_MAX_M) { const k = HULL_MAX_M / l; dx *= k; dy *= k; dz *= k; }
        disp[r * 3] = dx * f; disp[r * 3 + 1] = dy * f; disp[r * 3 + 2] = dz * f;
      }
      // eased over the cloth so no envelope corner shows
      for (let it = 0; it < HULL_EASE; it += 1) {
        const next = new Float32Array(disp);
        for (const r of reps) {
          const ns = nbList.get(r);
          if (!ns.length) continue;
          for (let c = 0; c < 3; c += 1) {
            let sum = disp[r * 3 + c];
            for (const u of ns) sum += disp[u * 3 + c];
            next[r * 3 + c] = sum / (ns.length + 1);
          }
        }
        disp.set(next);
      }
      for (const r of reps) for (let c = 0; c < 3; c += 1) x[r * 3 + c] += disp[r * 3 + c];
    };
    const shape = (bodyAt, normalAt) => {
      const x = new Float32Array(m * 3), nn = new Float32Array(m * 3);
      for (let k = 0; k < m; k += 1) {
        const p = bodyAt(k), q = normalAt(k);
        for (let c = 0; c < 3; c += 1) { x[k * 3 + c] = p[c] + q[c] * spec.thickness; nn[k * 3 + c] = q[c]; }
      }
      if (spec.bridge > 0) hullFill(x, nn);
      for (let k = 0; k < m; k += 1) { const r = grep[k]; if (r !== k) for (let c = 0; c < 3; c += 1) x[k * 3 + c] = x[r * 3 + c]; }
      // the cloth's own normals, from its own faces
      const acc2 = new Float32Array(m * 3);
      for (let f = 0; f < faces.length; f += 3) {
        const [a, b, c] = [faces[f], faces[f + 1], faces[f + 2]];
        const ux = x[b * 3] - x[a * 3], uy = x[b * 3 + 1] - x[a * 3 + 1], uz = x[b * 3 + 2] - x[a * 3 + 2];
        const vx = x[c * 3] - x[a * 3], vy = x[c * 3 + 1] - x[a * 3 + 1], vz = x[c * 3 + 2] - x[a * 3 + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        for (const g of [grep[a], grep[b], grep[c]]) { acc2[g * 3] += fx; acc2[g * 3 + 1] += fy; acc2[g * 3 + 2] += fz; }
      }
      const outN = new Float32Array(m * 3);
      for (let k = 0; k < m; k += 1) {
        const g = grep[k], l = Math.hypot(acc2[g * 3], acc2[g * 3 + 1], acc2[g * 3 + 2]) || 1;
        // faces wound as the skin's: keep the side the skin's normal points to
        let sgn = acc2[g * 3] * baseN[k * 3] + acc2[g * 3 + 1] * baseN[k * 3 + 1] + acc2[g * 3 + 2] * baseN[k * 3 + 2] < 0 ? -1 : 1;
        for (let c = 0; c < 3; c += 1) outN[k * 3 + c] = (sgn * acc2[g * 3 + c]) / l;
      }
      return { x, n: outN };
    };
    const gb = shape((k) => base.subarray(k * 3, k * 3 + 3), (k) => baseN.subarray(k * 3, k * 3 + 3));
    // Each belly shape: the body's same shape, the cloth grown and bridged on it, and
    // the difference from the base cloth stored.
    const da = [0, 0, 0], db = [0, 0, 0];
    const tdata = targets.map((tg) => {
      const TP = tg.getAttribute('POSITION'), TN = tg.getAttribute('NORMAL');
      const bp = new Float32Array(m * 3), bn = new Float32Array(m * 3);
      verts.forEach(([a, b, t], k) => {
        for (let c = 0; c < 3; c += 1) { da[c] = 0; db[c] = 0; }
        if (TP) { TP.getElement(a, da); TP.getElement(b, db); }
        for (let c = 0; c < 3; c += 1) bp[k * 3 + c] = base[k * 3 + c] + da[c] * (1 - t) + db[c] * t;
        if (TN) { TN.getElement(a, da); TN.getElement(b, db); } else { da.fill(0); db.fill(0); }
        let nx = baseN[k * 3] + da[0] * (1 - t) + db[0] * t, ny = baseN[k * 3 + 1] + da[1] * (1 - t) + db[1] * t, nz = baseN[k * 3 + 2] + da[2] * (1 - t) + db[2] * t;
        const l = Math.hypot(nx, ny, nz) || 1; bn[k * 3] = nx / l; bn[k * 3 + 1] = ny / l; bn[k * 3 + 2] = nz / l;
      });
      const moved = (TP ? TP.getArray() : []).some((v) => v !== 0);
      if (!moved) return { p: new Float32Array(m * 3), n: new Float32Array(m * 3) };
      const g = shape((k) => bp.subarray(k * 3, k * 3 + 3), (k) => bn.subarray(k * 3, k * 3 + 3));
      const p = new Float32Array(m * 3), nd = new Float32Array(m * 3);
      for (let q = 0; q < m * 3; q += 1) { p[q] = g.x[q] - gb.x[q]; nd[q] = g.n[q] - gb.n[q]; }
      return { p, n: nd };
    });
    const indices = m > 65535 ? new Uint32Array(faces) : new Uint16Array(faces);
    const acc3 = (arr, type) => doc.createAccessor().setType(type).setBuffer(buffer).setArray(arr);
    const material = doc.createMaterial(name)
      .setBaseColorFactor([...spec.colour, 1])
      .setRoughnessFactor(spec.roughness)
      .setMetallicFactor(0)
      .setDoubleSided(true);
    const prim = doc.createPrimitive()
      .setIndices(acc3(indices, 'SCALAR'))
      .setAttribute('POSITION', acc3(gb.x, 'VEC3'))
      .setAttribute('NORMAL', acc3(gb.n, 'VEC3'))
      .setAttribute('JOINTS_0', acc3(gj, 'VEC4'))
      .setAttribute('WEIGHTS_0', acc3(gw, 'VEC4'))
      .setMaterial(material);
    if (UV) prim.setAttribute('TEXCOORD_0', acc3(guv, 'VEC2'));
    // every primitive of a mesh carries the same targets
    targets.forEach((tg, ti) => {
      const gt = doc.createPrimitiveTarget(tg.getName());
      gt.setAttribute('POSITION', acc3(tdata[ti].p, 'VEC3'));
      gt.setAttribute('NORMAL', acc3(tdata[ti].n, 'VEC3'));
      prim.addTarget(gt);
    });
    mesh.addPrimitive(prim);
    // dressed from a reference sheet: the fabric's folds, ruching and seams baked onto
    // this cloth (never the skin), the sleeves left plain
    if (paint && spec.sheet) {
      const armShare = Float32Array.from(verts, ([a, b, t]) => share[a].upperArm * (1 - t) + share[b].upperArm * t + (share[a].arms * (1 - t) + share[b].arms * t));
      await paintGarment({
        doc, material, file: spec.sheet, colour: spec.colour, isCloth: spec.isCloth,
        x: gb.x, n: gb.n, uv: guv, faces, plain: (k) => armShare[k] > 0.4,
        log: (line) => log(`clothes: ${name}: ${line}`),
      });
    }
    if (name === 'shirt') log(`clothes: the bust's tips at ${tipY.toFixed(3)} m, the crop top's hem at ${cropY.toFixed(3)} m`);
    log(`clothes: ${name}: ${m.toLocaleString()} vertices, ${(faces.length / 3).toLocaleString()} triangles, edges cut clean, ${(spec.thickness * 1000).toFixed(0)} mm off the skin, ${spec.bridge ? 'hollows spanned' : 'on the skin'}, with ${targets.length} shapes`);
  }
  void chestY;
}
