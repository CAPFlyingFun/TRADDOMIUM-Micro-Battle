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
import { paintFromBodySheet, paintGarment, paintTrim, readBodySheet } from './paintGarment.mjs';

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
/** How many passes a drawn garment's coverage is eased along the skin before its edge is cut. */
export const COVER_EASE = 4;
/** Where a garment's edge runs (its field within `REFINE_BAND` of zero), the mesh is refined until no edge is longer than `REFINE_EDGE`, over at most `REFINE_ROUNDS` rounds. */
export const REFINE_EDGE = 0.005;
export const REFINE_BAND = 0.012;
export const REFINE_ROUNDS = 6;
/**
 * SWIMWEAR MEASURES, metres on a 1.70 m body, from the breasts' tips (`tipY`), the
 * neck joint and the hip joints. GAME TUNING against renders, after the bikini sheet.
 */
export const SWIM = {
  bandBelowTip: 0.095, bandTopBelowTip: 0.062, scoopCentre: 0.03, scoopCup: 0.065,
  cupStrapX: 0.085, strapX: 0.105, strapTop: 0.03, strap: 0.024, crossTo: 0.075,
  waistFront: -0.05, waistSide: 0.005, waistBack: 0.025,
  crotch: 0.1, legCutFront: 0.085, legCutBack: 0.045, backScoop: 0.06,
  trim: 0.0045, overShoulder: 0.025, armFrom: 0.15, archBelowTip: 0.011, archSlope: 0.6,
};
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
  // drawn on the body: where it covers and how it looks both come from its sheet
  // swimwear, cut from clean shapes (`SWIM`), the fabric trimmed in black at every
  // edge. A garment may instead take its coverage from a sheet drawn on the body
  // (`coverFrom`, `isCloth`; scripts/paintGarment.mjs `readBodySheet`): tried on the
  // bikini sheet, the drawings disagreed too much for a small garment's edges.
  bikini: { colour: [0.5, 0.02, 0.035], trim: [0.012, 0.012, 0.014], thickness: 0.0025, roughness: 0.62, bridge: 'cleavage' },
  swimsuit: { colour: [0.02, 0.06, 0.2], trim: [0.012, 0.012, 0.014], thickness: 0.0025, roughness: 0.62, bridge: 'cleavage' },
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

export async function growClothes(doc, { log = () => {}, which = ['shirt', 'leggings', 'bikini', 'swimsuit'], paint = true } = {}) {
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
  // one slot past the body's vertices (index n): a SCRATCH point, where a garment's
  // field is read at a point made by refining the mesh (see `refine` below)
  const pos = new Float32Array((n + 1) * 3);
  const v = [0, 0, 0], j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  const share = Array.from({ length: n + 1 }, () => ({ torso: 0, legs: 0, upperArm: 0, arms: 0, head: 0 }));
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
  let scratchN = [0, 0, 1];
  const normal = (i) => {
    if (i === n) return scratchN;
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
  // ---- swimwear: shared measures
  const front = (z) => smoothstep(-0.03, 0.05, z);
  const outer = (x) => smoothstep(0.03, 0.15, Math.abs(x));
  // the torso's skin: not the forearms or hands, and not the upper arm past the
  // shoulder (the top of the shoulder is carried by the upper arm's bone too, and a
  // share test alone cut holes in a strap there)
  const skinOnly = (i) => share[i].arms <= 0.3 && share[i].head <= 0.3 && !(share[i].upperArm > 0.4 && Math.abs(pos[i * 3]) > SWIM.armFrom);
  // the distance of (x, y) from the segment (ax, ay)-(bx, by), metres
  const segDist = (x, y, ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    return Math.hypot(x - ax - ex * t, y - ay - ey * t);
  };
  const shoulderY = neckY - SWIM.strapTop, shoulderX = SWIM.strapX;
  const bandLo = tipY - SWIM.bandBelowTip, bandHi = tipY - SWIM.bandTopBelowTip;
  // A STRAP IS A PATH ON THE SKIN: from its front end up over the top of the shoulder
  // and down the back to its back end, sampled every centimetre and each sample set
  // on the body's own surface (the nearest skin point on that side); the strap is the
  // skin within half its width of that path. Smooth everywhere, so its edges cut
  // clean (a strap drawn as a flat line on the front and another on the back switched
  // on and off where they met, and came out ragged).
  // the skin the path may lie on: not the arms, not above the neck joint (the top of
  // the shoulder is carried by the neck bone, so a share test would drop it)
  const skinPts = [];
  for (let i = 0; i < n; i += 1) if (rep[i] === i && share[i].upperArm + share[i].arms <= 0.4 && pos[i * 3 + 1] > hipY && pos[i * 3 + 1] < neckY + 0.02) skinPts.push(i);
  // the OUTERMOST skin seen from one side: looking along axis `ax` (0 x, 1 y, 2 z)
  // from its `sign` end, at the point (u, v) in the other two axes. At the top of the
  // back two layers share a height (the top of the shoulder, the back itself), and
  // the nearest point jumped between them; the outermost never does.
  const outermost = (ax, sign, u, v) => {
    const [ia, ib] = [0, 1, 2].filter((k) => k !== ax);
    for (const r of [0.006, 0.012, 0.025]) {
      let best = -1;
      for (const i of skinPts) {
        if (Math.abs(pos[i * 3 + ia] - u) > r || Math.abs(pos[i * 3 + ib] - v) > r) continue;
        // only skin on the side it is seen from (a body seen from behind has no front)
        if (ax === 2 && sign * pos[i * 3 + 2] < 0) continue;
        if (best < 0 || sign * pos[i * 3 + ax] > sign * pos[best * 3 + ax]) best = i;
      }
      if (best >= 0) return [pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]];
    }
    return null;
  };
  const strapPath = (fx, fy, bx, by, sx) => {
    const X = sx * shoulderX;
    // the top of the shoulder at the strap's x, seen from above, front to back
    const ridge = [];
    for (let z = 0.12; z >= -0.16; z -= 0.01) { const q = outermost(1, 1, X, z); if (q) ridge.push(q); }
    const crest = ridge.reduce((m, q) => (q[1] > m[1] ? q : m), ridge[0]);
    const drop = SWIM.overShoulder;
    const pts = [];
    const add = (q) => { if (q) pts.push(q); };
    // up the front, seen from the front, to just under the crest
    const frontTo = crest[1] - drop;
    for (let k = 0, steps = Math.ceil(Math.hypot(X - fx, frontTo - fy) / 0.01); k <= steps; k += 1) add(outermost(2, 1, fx + ((X - fx) * k) / steps, fy + ((frontTo - fy) * k) / steps));
    // over the top, seen from above, along the ridge where it is above that line
    for (const q of ridge) if (q[1] > crest[1] - drop) add(q);
    // down the back, seen from behind
    for (let k = 0, steps = Math.ceil(Math.hypot(bx - X, by - frontTo) / 0.01); k <= steps; k += 1) add(outermost(2, -1, X + ((bx - X) * k) / steps, frontTo + ((by - frontTo) * k) / steps));
    // in order along the strap: front leg, then the ridge front to back, then the back;
    // smoothed (each sample snaps to a vertex, and the back's are 2 cm apart)
    let path = pts;
    for (let it = 0; it < 6; it += 1) path = path.map((q, k) => (k === 0 || k === path.length - 1 ? q : [0, 1, 2].map((c) => 0.25 * path[k - 1][c] + 0.5 * q[c] + 0.25 * path[k + 1][c])));
    // ...and set back onto the skin: smoothing pulled the path inside the curve of the
    // shoulder, where the skin round it was further than half a strap away. Each point
    // goes onto the tangent plane of the skin nearest it.
    return path.map((q) => {
      let best = -1, bd = Infinity;
      for (const i of skinPts) { const d = (pos[i * 3] - q[0]) ** 2 + (pos[i * 3 + 1] - q[1]) ** 2 + (pos[i * 3 + 2] - q[2]) ** 2; if (d < bd) { bd = d; best = i; } }
      const nn = normal(best), off = (q[0] - pos[best * 3]) * nn[0] + (q[1] - pos[best * 3 + 1]) * nn[1] + (q[2] - pos[best * 3 + 2]) * nn[2];
      return [q[0] - off * nn[0], q[1] - off * nn[1], q[2] - off * nn[2]];
    });
  };
  const pathDist = (p3, pts) => {
    let d = Infinity;
    for (let k = 1; k < pts.length; k += 1) {
      const a = pts[k - 1], b = pts[k];
      const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], l2 = ex * ex + ey * ey + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((p3[0] - a[0]) * ex + (p3[1] - a[1]) * ey + (p3[2] - a[2]) * ez) / l2));
      d = Math.min(d, Math.hypot(p3[0] - a[0] - ex * t, p3[1] - a[1] - ey * t, p3[2] - a[2] - ez * t));
    }
    return d;
  };
  const strapSets = new Map();
  const straps = (x, y, z, toward) => {
    const key = JSON.stringify(toward);
    if (!strapSets.has(key)) strapSets.set(key, [1, -1].map((sx) => strapPath(sx * SWIM.cupStrapX, toward.frontY, toward.cross ? -sx * SWIM.crossTo : sx * toward.backX, toward.backY, sx)));
    let d = Infinity;
    for (const path of strapSets.get(key)) d = Math.min(d, pathDist([x, y, z], path));
    return SWIM.strap / 2 - d;
  };
  // the bralette: a band round the ribs under the bust, a front panel up to a scoop
  // neckline across both cups, and straps that run up over the shoulders and cross
  // at the back to the far side of the band
  const swimTop = (i, kind) => {
    if (!skinOnly(i)) return -1;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], ax = Math.abs(x), fr = front(z);
    const neckline = tipY + SWIM.scoopCentre + (SWIM.scoopCup - SWIM.scoopCentre) * smoothstep(0, 0.09, ax);
    // the panel's top: the neckline at the front, dropping to the band round the sides and back
    const sideDrop = smoothstep(0.11, 0.17, ax);
    const topEdge = fr * (neckline * (1 - sideDrop) + (bandHi + 0.03) * sideDrop) + (1 - fr) * bandHi;
    // THE FRONT RIDES ON SKIN THE BUMP LEAVES ALONE. Measured on the baked body, the
    // line above which belly200 moves the skin less than a centimetre runs from 1.1 cm
    // under the tips at the centre down at about 0.6 m per metre out to the band at the
    // sides: an arch, like an underwire's. Below it the bump grows into the panel and
    // stretches it, so at the front the top stops there; round the sides and back,
    // which the bump never reaches, the band keeps its height.
    const arch = tipY - SWIM.archBelowTip - SWIM.archSlope * Math.hypot(x, 0.015);
    const frontLo = arch + Math.log1p(Math.exp((bandLo - arch) / 0.008)) * 0.008; // a soft max(arch, bandLo)
    const lo = fr * frontLo + (1 - fr) * bandLo;
    const f = Math.min(y - lo, topEdge - y);
    // front straps from the top of each cup up over the shoulder; at the back they
    // cross to the band's far side
    return Math.max(f, straps(x, y, z, { frontY: tipY + SWIM.scoopCup - 0.005, cross: kind === 'bralette', backX: shoulderX, backY: bandHi - 0.005 }));
  };
  // the brief: a waist under the bump at the front, over the hips at the sides and
  // back; high-cut leg openings from the crotch up to the hip at the front, fuller
  // over the seat at the back
  const swimBottom = (i) => {
    if (!skinOnly(i)) return -1;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], fr = front(z), o = outer(x);
    const waist = hipY + fr * (SWIM.waistFront * (1 - o) + SWIM.waistSide * o) + (1 - fr) * SWIM.waistBack;
    const legLine = hipY - SWIM.crotch + o * (fr * SWIM.legCutFront + (1 - fr) * SWIM.legCutBack);
    return Math.min(waist - y, y - legLine);
  };
  // the one-piece: everything from the leg openings up to a scoop neckline, open at
  // the arms, straps straight over the shoulders, a low scoop at the back
  const swimOnePiece = (i) => {
    if (!skinOnly(i)) return -1;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], ax = Math.abs(x), fr = front(z), o = outer(x);
    const legLine = hipY - SWIM.crotch + o * (fr * SWIM.legCutFront + (1 - fr) * SWIM.legCutBack);
    const neckline = tipY + SWIM.scoopCentre + (SWIM.scoopCup - SWIM.scoopCentre) * smoothstep(0, 0.09, ax);
    const sideDrop = smoothstep(0.11, 0.17, ax);
    const topEdge = fr * (neckline * (1 - sideDrop) + (bandHi + 0.05) * sideDrop) + (1 - fr) * (bandHi + SWIM.backScoop);
    const f = Math.min(y - legLine, topEdge - y);
    return Math.max(f, straps(x, y, z, { frontY: tipY + SWIM.scoopCup - 0.005, cross: false, backX: SWIM.cupStrapX, backY: bandHi + SWIM.backScoop - 0.005 }));
  };
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
    // SWIMWEAR, cut from clean shapes on her body (the bikini sheet supplies the design:
    // a scoop bralette, crossed straps at the back, a high-cut brief, black trim). Every
    // piece is a field in metres, its zero line the edge; pieces join by taking the
    // larger field (a union).
    bikini: (i) => Math.max(swimTop(i, 'bralette'), swimBottom(i)),
    swimsuit: (i) => swimOnePiece(i),
  };

  const buffer = root.listBuffers()[0];
  for (const name of which) {
    const spec = GARMENTS[name];
    const fv = new Float32Array(n);
    let bodySheet = null;
    if (spec.coverFrom) {
      // A GARMENT DRAWN ON THE BODY (Joshua, 2026-10-08: "something simple like a
      // bikini... as they could be painted on"): where it covers is read from its
      // sheet. Each point of the skin is looked for in the eight drawings that face
      // it (fitted by the body's own outline, `readBodySheet`), and covered where they
      // see cloth; that coverage is eased along the skin, and its half-way line is the
      // garment's edge, cut clean like any other.
      const nrmAll = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) nrmAll.set(normal(i), i * 3);
      const isArm = (i) => share[i].upperArm + share[i].arms > 0.4 || share[i].head > 0.5;
      bodySheet = await readBodySheet(spec.coverFrom, { isCloth: spec.isCloth, bodyPos: pos, isArm, n: nrmAll });
      bodySheet.file = spec.coverFrom.split('/').pop();
      let cov = new Float32Array(n);
      for (let i = 0; i < n; i += 1) if (rep[i] === i && !isArm(i)) cov[i] = bodySheet.coverage(i);
      const nbB = new Map();
      for (let f = 0; f < idx.length; f += 3) {
        const a = rep[idx[f]], b = rep[idx[f + 1]], c = rep[idx[f + 2]];
        for (const [u, w] of [[a, b], [a, c], [b, a], [b, c], [c, a], [c, b]]) { if (!nbB.has(u)) nbB.set(u, []); nbB.get(u).push(w); }
      }
      for (let it = 0; it < COVER_EASE; it += 1) {
        const next = Float32Array.from(cov);
        for (const [u, ns] of nbB) { let t = cov[u]; for (const w of ns) t += cov[w]; next[u] = t / (ns.length + 1); }
        cov = next;
      }
      for (let i = 0; i < n; i += 1) fv[i] = cov[rep[i]] - 0.5;
    } else for (let i = 0; i < n; i += 1) fv[i] = field[name](i, spec);
    // THE MESH REFINED WHERE AN EDGE RUNS (the base mannequin's back has a vertex every
    // 2 cm, its front every 3 mm; a 24 mm strap cut from 2 cm triangles came out
    // ragged): every triangle the garment's edge passes near has its longest edge
    // halved, round after round, until none there is longer than `REFINE_EDGE`, and the
    // field is read afresh at each new point, so the cut follows the shape, not the
    // triangles. A point is a mix of the body's vertices (`combo`), so every attribute
    // of a new point (its place, UVs, bone weights, belly shapes) is read through it.
    const combos = [], vpos = [], vfv = [], vgid = [];
    const comboOf = (v) => (v < n ? [[v, 1]] : combos[v - n]);
    const P = (v) => (v < n ? [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]] : vpos[v - n]);
    const F = (v) => (v < n ? fv[v] : vfv[v - n]);
    const gid = (v) => (v < n ? rep[v] : vgid[v - n]);
    const geoMid = new Map(), mids = new Map();
    let geoNext = n;
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (mids.has(key)) return mids.get(key);
      const ga = gid(a), gb2 = gid(b), gkey = ga < gb2 ? `${ga}:${gb2}` : `${gb2}:${ga}`;
      if (!geoMid.has(gkey)) geoMid.set(gkey, geoNext++);
      const mix = new Map();
      for (const [i, w] of comboOf(a)) mix.set(i, (mix.get(i) ?? 0) + w / 2);
      for (const [i, w] of comboOf(b)) mix.set(i, (mix.get(i) ?? 0) + w / 2);
      const combo = [...mix];
      const pa = P(a), pb = P(b), p = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      // the field read afresh at the new point, through the scratch slot
      let f;
      if (spec.coverFrom) f = (F(a) + F(b)) / 2;
      else {
        pos[n * 3] = p[0]; pos[n * 3 + 1] = p[1]; pos[n * 3 + 2] = p[2];
        const sh = share[n];
        for (const k of Object.keys(sh)) sh[k] = 0;
        const nn = [0, 0, 0];
        for (const [i, w] of combo) { for (const k of Object.keys(sh)) sh[k] += share[i][k] * w; const q = normal(i); nn[0] += q[0] * w; nn[1] += q[1] * w; nn[2] += q[2] * w; }
        const l = Math.hypot(...nn) || 1;
        scratchN = [nn[0] / l, nn[1] / l, nn[2] / l];
        f = field[name](n, spec);
      }
      const v = n + combos.length;
      combos.push(combo); vpos.push(p); vfv.push(f); vgid.push(geoMid.get(gkey));
      mids.set(key, v);
      return v;
    };
    let tris = [];
    for (let f = 0; f < idx.length; f += 3) {
      const t3 = [idx[f], idx[f + 1], idx[f + 2]];
      if (Math.max(fv[t3[0]], fv[t3[1]], fv[t3[2]]) > -REFINE_BAND) tris.push(t3);
    }
    const len2 = (a, b) => { const pa = P(a), pb = P(b); return (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2; };
    for (let round = 0; round < REFINE_ROUNDS; round += 1) {
      const marked = new Set();
      const ekey = (a, b) => { const ga = gid(a), gb2 = gid(b); return ga < gb2 ? `${ga}:${gb2}` : `${gb2}:${ga}`; };
      for (const t3 of tris) {
        const fs = t3.map(F);
        if (Math.min(...fs) > REFINE_BAND || Math.max(...fs) < -REFINE_BAND) continue;
        let best = -1, bl = REFINE_EDGE * REFINE_EDGE;
        for (let e = 0; e < 3; e += 1) { const l = len2(t3[e], t3[(e + 1) % 3]); if (l > bl) { bl = l; best = e; } }
        if (best >= 0) marked.add(ekey(t3[best], t3[(best + 1) % 3]));
      }
      if (!marked.size) break;
      const next = [];
      for (const t3 of tris) {
        const m3 = [0, 1, 2].map((e) => marked.has(ekey(t3[e], t3[(e + 1) % 3])));
        const cnt = m3.filter(Boolean).length;
        if (!cnt) { next.push(t3); continue; }
        const [A, B, C] = t3;
        if (cnt === 3) {
          const ab = midpoint(A, B), bc = midpoint(B, C), ca = midpoint(C, A);
          next.push([A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]);
        } else if (cnt === 1) {
          const e = m3.indexOf(true), X = t3[e], Y = t3[(e + 1) % 3], Z = t3[(e + 2) % 3], mm = midpoint(X, Y);
          next.push([X, mm, Z], [mm, Y, Z]);
        } else {
          // two edges: the unmarked one is e; split the other two
          const e = m3.indexOf(false), X = t3[e], Y = t3[(e + 1) % 3], Z = t3[(e + 2) % 3];
          const yz = midpoint(Y, Z), zx = midpoint(Z, X);
          next.push([X, Y, yz], [X, yz, zx], [zx, yz, Z]);
        }
      }
      tris = next;
    }
    // vertices of the garment: [a, b, t] = the points a and b, t of the way across
    const verts = [], vkey = new Map();
    const vertex = (a, b, t) => {
      if (t <= 1e-6) { b = a; t = 0; } else if (t >= 1 - 1e-6) { a = b; t = 0; }
      const k = a === b ? `${a}` : a < b ? `${a}:${b}` : `${b}:${a}`;
      let at0 = vkey.get(k);
      if (at0 === undefined) { at0 = verts.length; verts.push(a === b || a < b ? [a, b, t] : [b, a, 1 - t]); vkey.set(k, at0); }
      return at0;
    };
    const cut = (a, b) => vertex(a, b, F(a) / (F(a) - F(b)));
    const faces = [];
    for (const tri of tris) {
      const ins = tri.map((i) => F(i) >= 0);
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
    // each garment vertex as a mix of body vertices
    const vmix = verts.map(([a, b, t]) => {
      const mix = new Map();
      for (const [i, w] of comboOf(a)) mix.set(i, (mix.get(i) ?? 0) + w * (1 - t));
      if (t > 0) for (const [i, w] of comboOf(b)) mix.set(i, (mix.get(i) ?? 0) + w * t);
      return [...mix];
    });
    const guv = new Float32Array(m * 2);
    const gj = new (J.getArray().constructor)(m * 4), gw = new Float32Array(m * 4);
    const uvA = [0, 0], ja = [0, 0, 0, 0], wa = [0, 0, 0, 0];
    const base = new Float32Array(m * 3), baseN = new Float32Array(m * 3);
    vmix.forEach((mixv, k) => {
      const nn = [0, 0, 0], skinMix = new Map();
      for (const [i, w] of mixv) {
        for (let c = 0; c < 3; c += 1) base[k * 3 + c] += pos[i * 3 + c] * w;
        const q = normal(i); nn[0] += q[0] * w; nn[1] += q[1] * w; nn[2] += q[2] * w;
        if (UV) { UV.getElement(i, uvA); guv[k * 2] += uvA[0] * w; guv[k * 2 + 1] += uvA[1] * w; }
        J.getElement(i, ja); W.getElement(i, wa);
        for (let q2 = 0; q2 < 4; q2 += 1) if (wa[q2] > 0) skinMix.set(ja[q2], (skinMix.get(ja[q2]) ?? 0) + wa[q2] * w);
      }
      const l = Math.hypot(...nn) || 1; baseN[k * 3] = nn[0] / l; baseN[k * 3 + 1] = nn[1] / l; baseN[k * 3 + 2] = nn[2] / l;
      const top = [...skinMix].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((x, e) => x + e[1], 0) || 1;
      for (let q2 = 0; q2 < 4; q2 += 1) { gj[k * 4 + q2] = top[q2] ? top[q2][0] : 0; gw[k * 4 + q2] = top[q2] ? top[q2][1] / sum : 0; }
    });
    const fG = Float32Array.from(verts, ([a, b, t]) => F(a) * (1 - t) + F(b) * t);
    const armShare = Float32Array.from(vmix, (mixv) => mixv.reduce((acc0, [i, w]) => acc0 + (share[i].upperArm + share[i].arms) * w, 0));
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
      vmix.forEach((mixv, k) => {
        const dp = [0, 0, 0], dn = [0, 0, 0];
        for (const [i, w] of mixv) {
          if (TP) { TP.getElement(i, da); for (let c = 0; c < 3; c += 1) dp[c] += da[c] * w; }
          if (TN) { TN.getElement(i, db); for (let c = 0; c < 3; c += 1) dn[c] += db[c] * w; }
        }
        for (let c = 0; c < 3; c += 1) bp[k * 3 + c] = base[k * 3 + c] + dp[c];
        const nx = baseN[k * 3] + dn[0], ny = baseN[k * 3 + 1] + dn[1], nz = baseN[k * 3 + 2] + dn[2];
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
    if (paint && spec.trim) {
      await paintTrim({ doc, material, colour: spec.colour, trim: spec.trim, width: SWIM.trim, f: fG, uv: guv, faces, log: (line) => log(`clothes: ${name}: ${line}`) });
    }
    if (paint && bodySheet) {
      await paintFromBodySheet({ doc, material, sheet: bodySheet, x: gb.x, n: gb.n, uv: guv, faces, log: (line) => log(`clothes: ${name}: ${line}`) });
    }
    if (paint && spec.sheet) {
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
