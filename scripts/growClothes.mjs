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
 *   shirt     torso and upper arms, from `SHIRT_HEM` under the hip joints up to
 *             the neck, a scoop at the front, short sleeves to `SLEEVE` of the
 *             way to the elbow;
 *   leggings  legs and the torso under a waistband that rides under the bump at
 *             the front and up at the back, down to `CUFF` over the ankles.
 *
 * Each garment is its own primitive with its own material (named `shirt`,
 * `leggings`), so a renderer can show or hide it. A face goes into a garment
 * when all three of its corners do, so its edge follows the mesh's own
 * triangles: a test garment, not a tailored one.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for bodies with
 * `clothes`. Run after every weight pass (so the clothes copy the final
 * weights) and after `bellyMorph` (so they copy the morph).
 */
import * as THREE from 'three';

export const SHIRT_HEM = 0.07;
export const SLEEVE = 0.42;
export const CUFF = 0.05;
export const GARMENTS = {
  shirt: { colour: [0.62, 0.05, 0.07], thickness: 0.008, roughness: 0.82 },
  leggings: { colour: [0.06, 0.08, 0.14], thickness: 0.004, roughness: 0.7 },
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

export function growClothes(doc, { log = () => {}, which = ['shirt', 'leggings'] } = {}) {
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
  const target = body.listTargets()[0] || null;
  const TP = target?.getAttribute('POSITION') || null, TN = target?.getAttribute('NORMAL') || null;
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

  const sleeveOf = (p) => {
    for (const s of shoulders) {
      const axis = s.elbow.clone().sub(s.shoulder), len = axis.length();
      if (len <= 0) continue;
      const t = p.clone().sub(s.shoulder).dot(axis) / (len * len);
      if (t > -0.3 && t < SLEEVE) return true;
    }
    return false;
  };
  const inside = {
    shirt: (i) => {
      const s = share[i], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (s.head > 0.25 || s.arms > 0.3) return false;
      if (y < hipY - SHIRT_HEM) return false;
      // thighs below the hip joints are the leggings'; above them the shirt takes
      // whatever bone carries the skin (the seat pass gives the lower back and the
      // underside of the bump some thigh weight, and skipping it left a bare band)
      if (s.legs > 0.6 && y < hipY) return false;
      // the neckline: a scoop at the front, higher at the back
      if (y > neckY - (z > 0 ? 0.09 : 0.03)) return false;
      if (s.upperArm > 0.4) return sleeveOf(new THREE.Vector3(pos[i * 3], y, z));
      // anything else between the hem and the neck that is not head or arm: skin
      // split between the hips and the thighs counts too
      return s.torso + s.upperArm + s.legs >= 0.5;
    },
    leggings: (i) => {
      const s = share[i], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (s.arms > 0.2 || s.head > 0.1 || s.upperArm > 0.2) return false;
      if (y < ankleY + CUFF) return false;
      // the waistband: across the bottom of the bump at the front, up at the back,
      // and always above the shirt's hem, so no skin shows between them (the skin
      // under the bump is skinned to the thighs and the shirt does not take it)
      const waist = hipY + (z > 0 ? 0.03 : 0.1);
      if (y > waist) return false;
      return s.legs + s.torso >= 0.5;
    },
  };

  const buffer = root.listBuffers()[0];
  for (const name of which) {
    const spec = GARMENTS[name];
    const keep = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) keep[i] = inside[name](i) ? 1 : 0;
    const faces = [];
    for (let f = 0; f < idx.length; f += 3) if (keep[idx[f]] && keep[idx[f + 1]] && keep[idx[f + 2]]) faces.push(idx[f], idx[f + 1], idx[f + 2]);
    if (!faces.length) { log(`clothes: ${name}: no faces; skipped`); continue; }
    const used = [...new Set(faces)];
    const remap = new Map(used.map((old, k) => [old, k]));
    const m = used.length;
    const gp = new Float32Array(m * 3), gn = new Float32Array(m * 3), guv = new Float32Array(m * 2);
    const gj = new (J.getArray().constructor)(m * 4), gw = new Float32Array(m * 4);
    const tp = new Float32Array(m * 3), tn = new Float32Array(m * 3);
    const uv = [0, 0], d = [0, 0, 0];
    used.forEach((old, k) => {
      const nrm = normal(old);
      for (let a = 0; a < 3; a += 1) gp[k * 3 + a] = pos[old * 3 + a] + nrm[a] * spec.thickness;
      gn.set(nrm, k * 3);
      if (UV) { UV.getElement(old, uv); guv.set(uv, k * 2); }
      J.getElement(old, j4); W.getElement(old, w4);
      gj.set(j4, k * 4); gw.set(w4, k * 4);
      // The garment's flat shape stands off the body's FLAT shape: the body's move,
      // plus the turn of its normal times the cloth's thickness. Copying only the
      // move left the cloth 6 mm off the skin along the old normal, which on the
      // flattened bump points sideways, and the skin showed through in streaks.
      if (TN) { TN.getElement(old, d); tn.set(d, k * 3); }
      if (TP) {
        TP.getElement(old, d);
        for (let a = 0; a < 3; a += 1) tp[k * 3 + a] = d[a] + (TN ? tn[k * 3 + a] : 0) * spec.thickness;
      }
    });
    const indices = m > 65535 ? new Uint32Array(faces.length) : new Uint16Array(faces.length);
    faces.forEach((old, k) => { indices[k] = remap.get(old); });
    const acc3 = (arr, type) => doc.createAccessor().setType(type).setBuffer(buffer).setArray(arr);
    const material = doc.createMaterial(name)
      .setBaseColorFactor([...spec.colour, 1])
      .setRoughnessFactor(spec.roughness)
      .setMetallicFactor(0)
      .setDoubleSided(true);
    const prim = doc.createPrimitive()
      .setIndices(acc3(indices, 'SCALAR'))
      .setAttribute('POSITION', acc3(gp, 'VEC3'))
      .setAttribute('NORMAL', acc3(gn, 'VEC3'))
      .setAttribute('JOINTS_0', acc3(gj, 'VEC4'))
      .setAttribute('WEIGHTS_0', acc3(gw, 'VEC4'))
      .setMaterial(material);
    if (UV) prim.setAttribute('TEXCOORD_0', acc3(guv, 'VEC2'));
    // every primitive of a mesh carries the same targets
    for (const t of body.listTargets()) {
      const gt = doc.createPrimitiveTarget(t.getName());
      gt.setAttribute('POSITION', acc3(t === target ? tp : new Float32Array(m * 3), 'VEC3'));
      gt.setAttribute('NORMAL', acc3(t === target ? tn : new Float32Array(m * 3), 'VEC3'));
      prim.addTarget(gt);
    }
    mesh.addPrimitive(prim);
    log(`clothes: ${name}: ${m.toLocaleString()} vertices, ${(faces.length / 3).toLocaleString()} triangles, ${(spec.thickness * 1000).toFixed(0)} mm off the skin${target ? ', with the belly morph' : ''}`);
  }
  void chestY;
}
