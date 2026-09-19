/**
 * PRINT A TOMBS ID CARD ON THE BADGE ROUND SOMEONE'S NECK.
 *
 * Both masters were scanned wearing a real lanyard with a real card on it,
 * and in the body's 2048 atlas that card's UV island is about SEVENTY BY
 * THIRTY-EIGHT TEXELS. At 38 texels tall a logo is twenty texels wide, so
 * the printing reads as mush in every shot and BETTER ART PLACED THERE
 * CHANGES NOTHING. That is the whole reason this file exists: the card's
 * triangles are lifted onto a primitive of their own with a dedicated
 * texture, and their UVs are rebuilt from the card's own plane — which
 * also lands the artwork upright and square without anyone having to work
 * out how the old island was rotated.
 *
 * THE CARD IS FOUND BY A DEPTH SLAB AND THEN BY ITS OWN PLANE. A badge
 * hangs OFF a chest, so the slab gets close; but the two scans are
 * genuinely different, and only one of them is separated by depth alone:
 *
 *   Jack   the histogram has a clean gap — chest at z 0.082..0.100,
 *          NOTHING at 0.102..0.108, badge front at 0.110..0.113.
 *   Sarah  no gap at all. Her scan fused card, vinyl sleeve and clip into
 *          one lump 32 mm deep and WELDED IT TO THE CLOTH, so a fill
 *          through the slab alone takes 75 x 91 mm of shirt with it.
 *
 * What separates hers is that a badge is a FLAT SHEET and a chest is not:
 * the fill grows only through neighbours within a card's thickness of the
 * seed's plane. See `findCard` for the two colour gates that came before
 * it and the two opposite ways they failed.
 *
 * THE ART FILLS THE HOLDER'S WHOLE FRONT, and that is Joshua's call
 * against my first answer. I fitted it by height on a sleeve-grey field,
 * reasoning that the printing should keep its proportions and the spare
 * width should read as vinyl. On the model that came out as a badge
 * holder printed INSIDE the badge holder geometry — a small card floating
 * in a grey surround, with a dead band above it. He drew the two boxes
 * over a render: "It's fine as is, it just needs to be made bigger...
 * Don't trim it as it aligns with the badge holder."
 *
 * So the art is stretched to the face rather than letterboxed into it,
 * and — the part that took three passes — THE FACE HAS TO BE THE WHOLE
 * PRINTED FACE. Jack's slab was cut off at y 1.160, which is two thirds of
 * the way up his badge, so the art filled 60.7 x 66.0 mm of a 60.5 x 95.6 mm
 * face and the top third stayed the scan's grey vinyl. That is exactly the
 * red box he drew inside the blue one.
 *
 * Opened to the real face and squared against the CARD rather than the
 * world, the two measure 0.633 (Jack) and 0.644 (Sarah) wide-over-tall.
 * A CR80 identity card is 53.98 x 85.60 mm, which is 0.630 — so the badges
 * the scanner captured are real cards to within half a percent, and it is
 * the ARTWORK, at 0.678, that is the wide one. Filling squeezes it by 5
 * to 7%, and squeezing a too-wide picture onto a correctly-shaped card is
 * the right direction to be wrong in. The frames the clipped, world-aligned
 * boxes gave wanted 36% and 5% the other way.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { rasterize } from './humanSurface.mjs';

const TEX_W = 640;
/** How square-on a triangle must face to count as the card's printed sheet. */
const FLAT_FACING = 0.7;
/** How far out of the card's OWN plane a lifted triangle may sit. A badge in
 * a vinyl sleeve is a few millimetres thick; nothing further out is card. */
const CARD_HALF_THICK = 0.003;

const TYPE = {
  POSITION: 'VEC3', NORMAL: 'VEC3', TANGENT: 'VEC4', TEXCOORD_0: 'VEC2', TEXCOORD_1: 'VEC2',
  COLOR_0: 'VEC4', JOINTS_0: 'VEC4', JOINTS_1: 'VEC4', JOINTS_2: 'VEC4',
  WEIGHTS_0: 'VEC4', WEIGHTS_1: 'VEC4', WEIGHTS_2: 'VEC4',
};

/** Weld by position so a UV seam does not split one card into two. */
function weldMap(P) {
  const key = new Map(), rep = new Int32Array(P.length / 3);
  for (let v = 0; v < P.length / 3; v++) {
    const k = `${Math.round(P[v * 3] * 20000)},${Math.round(P[v * 3 + 1] * 20000)},${Math.round(P[v * 3 + 2] * 20000)}`;
    if (!key.has(k)) key.set(k, v);
    rep[v] = key.get(k);
  }
  return rep;
}

/**
 * The smallest rectangle containing a set of 2D points, by rotating calipers
 * on its convex hull.
 *
 * Every minimum-area rectangle has a side flush with a hull edge (Freeman &
 * Shapira 1975), so trying each hull edge as an axis and keeping the best is
 * exact rather than a search. The hull is Andrew's monotone chain.
 */
function minAreaRect(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  const h = lower.concat(upper);
  if (h.length < 2) throw new Error('the printed face has no outline to square the art against');
  let best = null;
  for (let i = 0; i < h.length; i += 1) {
    const a = h[i], b = h[(i + 1) % h.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const ex = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const ey = [-ex[1], ex[0]];
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (const q of pts) {
      const x = q[0] * ex[0] + q[1] * ex[1], y = q[0] * ey[0] + q[1] * ey[1];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) best = { area, ex, ey, w: x1 - x0, h: y1 - y0 };
  }
  if (!best) throw new Error('the printed face is degenerate — no rectangle fits it');
  return best;
}

/**
 * Which triangles are the card.
 *
 * The seed is the palest, flattest, most forward-facing patch inside the
 * slab — the PRINTING itself. A plane is fitted to it, and the card is then
 * grown from the seed through welded neighbours that stay within a card's
 * thickness of that plane. A badge is a flat sheet; nothing else about it
 * is needed to say where it stops.
 */
function findCard(prim, S, img, slab) {
  const P = prim.getAttribute('POSITION').getArray();
  const IDX = prim.getIndices().getArray();
  const nt = IDX.length / 3;
  const { pos, nrm, tri } = rasterize(prim, S, 2);

  // The seed: the pale, flat, forward-facing patch. This is the PRINTED
  // face, which is what the artwork has to be squared against.
  const mask = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y < slab.yMin - 0.03 || y > slab.yMax + 0.03) continue;
    if (Math.abs(x - slab.xMid) > slab.xHalf + 0.02 || z < slab.zMin - 0.02) continue;
    const L = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    if (nrm[i * 3 + 2] / L < 0.6) continue;
    const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 150 || (mx ? (mx - mn) / mx : 0) > 0.26) continue;
    mask[i] = 1;
  }
  const seen = new Uint8Array(S * S);
  let biggest = [];
  for (let i = 0; i < S * S; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i], part = []; seen[i] = 1;
    while (stack.length) {
      const c = stack.pop(); part.push(c);
      const x = c % S, y = (c / S) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const j = ny * S + nx;
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (part.length > biggest.length) biggest = part;
  }
  if (!biggest.length) throw new Error('no printed face found in the badge slab — the slab is wrong');

  const inSlab = (v) => {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    return z > slab.zMin && y > slab.yMin && y < slab.yMax && Math.abs(x - slab.xMid) < slab.xHalf;
  };
  const allowed = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    if (inSlab(IDX[t * 3]) && inSlab(IDX[t * 3 + 1]) && inSlab(IDX[t * 3 + 2])) allowed[t] = 1;
  }
  const rep = weldMap(P);
  const byVert = new Map();
  for (let t = 0; t < nt; t++) {
    if (!allowed[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = rep[IDX[t * 3 + k]];
      let a = byVert.get(v); if (!a) { a = []; byVert.set(v, a); } a.push(t);
    }
  }
  const seeded = [];
  for (const i of biggest) { const t = tri[i]; if (t >= 0 && allowed[t] && !seeded.includes(t)) seeded.push(t); }
  if (!seeded.length) throw new Error('the printed face is not inside the badge slab — the slab is wrong');

  const nrmOf = (t) => {
    const a = IDX[t * 3] * 3, b = IDX[t * 3 + 1] * 3, c = IDX[t * 3 + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / L, n[1] / L, n[2] / L, L / 2];
  };

  // THE CARD IS A FLAT SHEET, SO THE CARD IS WHAT LIES IN ITS PLANE — and
  // the plane comes from the seed, area-weighted so a sliver in it cannot
  // tilt the fit.
  //
  // This replaces a colour gate, and the colour gate is worth recording
  // because both of its failures were mine. Sarah's scan fused card, vinyl
  // sleeve and clip into one lump and welded it to her shirt, so a flood
  // fill through the slab alone took 75 x 91 mm of cloth with it. I gated
  // it on burgundy, read from each triangle's mean over the texels the
  // rasteriser landed on it. Ninety-one of her 251 triangles are too thin
  // in the atlas for a single texel centre to fall inside, so they were
  // never tested at all, came across as card, and drew as the RED STREAKS
  // Joshua saw: "Sarah's had a red streak and looks messed up… what's the
  // red from?" I then sampled those triangles at their UV centroid instead
  // — and her card's island is SEVENTY BY THIRTY-EIGHT TEXELS, so a
  // centroid near its edge rounds onto the shirt next door. That rejected
  // 17 triangles of the printed face itself and PUNCHED A WEDGE THROUGH THE
  // CARD, which drew the burgundy shirt behind it: the same streak, from
  // the opposite mistake.
  //
  // Geometry has neither failure mode. Measured on Sarah, growing only
  // within 3 mm of the seed's plane never leaves the badge at all — 125
  // triangles reached, 125 kept, the front sheet complete, and the face
  // 53.3 x 79.1 mm against art that is 0.675 to her 0.680. No colour is
  // read, so no atlas resolution can mislead it.
  const c = [0, 0, 0], pn = [0, 0, 0];
  let area = 0;
  for (const t of seeded) {
    const n = nrmOf(t);
    for (let k = 0; k < 3; k++) {
      const v = IDX[t * 3 + k];
      for (let j = 0; j < 3; j++) c[j] += P[v * 3 + j] * n[3] / 3;
    }
    area += n[3];
    for (let j = 0; j < 3; j++) pn[j] += n[j] * n[3];
  }
  for (let j = 0; j < 3; j++) c[j] /= area;
  {
    const L = Math.hypot(pn[0], pn[1], pn[2]) || 1;
    for (let j = 0; j < 3; j++) pn[j] /= L;
  }
  const inPlane = (t) => {
    for (let k = 0; k < 3; k++) {
      const v = IDX[t * 3 + k];
      const d = (P[v * 3] - c[0]) * pn[0] + (P[v * 3 + 1] - c[1]) * pn[1] + (P[v * 3 + 2] - c[2]) * pn[2];
      if (Math.abs(d) > CARD_HALF_THICK) return false;
    }
    return true;
  };

  // The gate is applied AS THE FILL GROWS, not after it. Trimming a finished
  // fill leaves whatever the fill reached THROUGH an out-of-plane bridge and
  // happened to land back in the plane beyond it; refusing the bridge is
  // what makes the reached set and the kept set the same set.
  const tris = new Set(), stack = [];
  let refused = 0;
  for (const t of seeded) { tris.add(t); stack.push(t); }
  while (stack.length) {
    const t = stack.pop();
    for (let k = 0; k < 3; k++) for (const n of byVert.get(rep[IDX[t * 3 + k]]) ?? []) {
      if (tris.has(n)) continue;
      if (!inPlane(n)) { refused += 1; continue; }
      tris.add(n); stack.push(n);
    }
  }

  // WHAT IS LIFTED IS THE PRINTED FACE, AND THE RIM STAYS ON THE BODY.
  //
  // Joshua, comparing the two badges: "The bottom also wraps underneath just
  // a little bit. Needs to look like Sarah's now." Measured, that is one
  // number: Jack's rolled bottom edge reaches 0.81 mm BELOW his printed face
  // and Sarah's reaches nothing at all. Both rims used to be carried on the
  // card's material with UVs outside 0..1, and the sampler clamps — so
  // Sarah's rim took the art's white margin at her top and right and looked
  // like card stock, and Jack's took the burgundy TOMBS STAFF band at his
  // bottom and looked like a sticker folded round the edge.
  //
  // A printed card's edge is not printed. So the rim is left where it
  // already is, on the body, wearing the scan's own picture of a plastic
  // edge — which is exactly what makes Sarah's bottom read right. It costs a
  // sub-millimetre seam around the printing on a 96 mm card, and that seam
  // is a badge holder's lip.
  const flat = [...tris].filter((t) => nrmOf(t)[2] >= FLAT_FACING);
  const face = new Set(flat.length ? flat : [...tris]);

  // THE ARTWORK IS SQUARED AGAINST THE CARD, NOT AGAINST THE WORLD.
  //
  // "It appears Jack's badge needs to maybe rotate like 1-2° clockwise as it
  // isn't level with the badge holder." His eye was half a degree out: the
  // card hangs at 1.43°. u used to run with world x and v with world y, so
  // the printing came out level with the ROOM and crooked on the badge, and
  // no amount of fitting could fix that because the frame had no idea the
  // card was turned.
  //
  // The frame is now the printed face's own MINIMUM-AREA RECTANGLE, found in
  // the card's plane by rotating calipers on its outline. That is stronger
  // than fitting an axis to the vertices: a scan's vertices are not evenly
  // spread, so a principal axis leans toward wherever the mesh happens to be
  // dense, while the smallest rectangle that contains a rectangle is that
  // rectangle whatever the sampling. It also measures the card tighter —
  // the world-aligned box was 3.6% larger than Jack's card and 1.3% larger
  // than Sarah's, and every one of those percent went into stretching the
  // art to fill space the card did not have.
  const up = [0, 1, 0];
  {
    const d = pn[1];
    for (let j = 0; j < 3; j++) up[j] = (j === 1 ? 1 : 0) - pn[j] * d;
    const L = Math.hypot(up[0], up[1], up[2]) || 1;
    for (let j = 0; j < 3; j++) up[j] /= L;
  }
  // right = up x normal, so (right, up, normal) is right-handed with the
  // normal pointing at the viewer — the same handedness as the screen.
  const right = [
    up[1] * pn[2] - up[2] * pn[1],
    up[2] * pn[0] - up[0] * pn[2],
    up[0] * pn[1] - up[1] * pn[0],
  ];
  {
    const L = Math.hypot(right[0], right[1], right[2]) || 1;
    for (let j = 0; j < 3; j++) right[j] /= L;
  }
  const flatten = (v) => {
    const q = [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]];
    return [
      q[0] * right[0] + q[1] * right[1] + q[2] * right[2],
      q[0] * up[0] + q[1] * up[1] + q[2] * up[2],
    ];
  };
  const pts = [];
  for (const t of face) for (let k = 0; k < 3; k++) pts.push(flatten(IDX[t * 3 + k]));
  const rect = minAreaRect(pts);

  // The rect's axes come out in an arbitrary order and sign. The card is
  // taller than it is wide, so the LONGER side is its up; point it up, and
  // the right follows from it by a quarter turn.
  const tall = rect.h >= rect.w;
  let ey = tall ? rect.ey : rect.ex;
  if (ey[1] < 0) ey = [-ey[0], -ey[1]];
  const ex = [ey[1], -ey[0]];
  const roll = Math.atan2(ey[0], ey[1]) * 180 / Math.PI;
  const UX = [0, 0, 0], UY = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    UX[j] = right[j] * ex[0] + up[j] * ex[1];
    UY[j] = right[j] * ey[0] + up[j] * ey[1];
  }
  let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
  for (const q of pts) {
    const u = q[0] * ex[0] + q[1] * ex[1], v = q[0] * ey[0] + q[1] * ey[1];
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return {
    tris: face,
    rim: tris.size - face.size,
    dropped: refused,
    roll,
    frame: { c, ux: UX, uy: UY, u0, v1, w: u1 - u0, h: v1 - v0 },
  };
}

/**
 * Lift the card onto its own primitive and print `spec.art` on it.
 *
 * `spec` is `{ art, slab: { zMin, yMin, yMax, xMid, xHalf } }`.
 * Mutates `doc`; returns what it found, so a caller can print a report
 * rather than trust a silent success.
 */
export async function printBadge(doc, spec, { root = '.', log = () => {} } = {}) {
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const tex = prim.getMaterial().getBaseColorTexture();
  const S = tex.getSize()[0];
  const { data: img } = await sharp(Buffer.from(tex.getImage()))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const { tris, rim, dropped, roll, frame } = findCard(prim, S, img, spec.slab);
  const P = prim.getAttribute('POSITION').getArray();
  const IDX = prim.getIndices().getArray();
  const W = frame.w, H = frame.h;
  log(`badge ${tris.size} printed-face triangles (${rim} rim left on the body, ${dropped} neighbours refused as out of its plane), printed face ${(W * 1000).toFixed(1)} x ${(H * 1000).toFixed(1)} mm, aspect ${(W / H).toFixed(3)}, hanging at ${roll >= 0 ? '' : '-'}${Math.abs(roll).toFixed(2)}° ${roll >= 0 ? 'clockwise' : 'anticlockwise'}`);

  const semantics = prim.listSemantics();
  const remap = new Map(), order = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = IDX[t * 3 + k];
    if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const attrs = {};
  for (const s of semantics) {
    const from = prim.getAttribute(s);
    const a = from.getArray(), w = from.getElementSize();
    const buf = new a.constructor(order.length * w);
    order.forEach((v, i) => { for (let k = 0; k < w; k++) buf[i * w + k] = a[v * w + k]; });
    attrs[s] = buf;
  }
  // The UVs are the card's own frame: how far along its right, how far down
  // from its top. v counts DOWN because glTF puts (0,0) at the image's
  // top-left. Nothing here refers to the world, which is the whole point —
  // a badge that hangs crooked prints straight.
  const { c, ux, uy, u0, v1 } = frame;
  const uv = new Float32Array(order.length * 2);
  order.forEach((v, i) => {
    const q = [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]];
    uv[i * 2] = ((q[0] * ux[0] + q[1] * ux[1] + q[2] * ux[2]) - u0) / W;
    uv[i * 2 + 1] = (v1 - (q[0] * uy[0] + q[1] * uy[1] + q[2] * uy[2])) / H;
  });
  attrs.TEXCOORD_0 = uv;

  const cardIdx = new Uint32Array(tris.size * 3);
  { let n = 0; for (const t of tris) for (let k = 0; k < 3; k++) cardIdx[n++] = remap.get(IDX[t * 3 + k]); }
  const keep = new Uint32Array((IDX.length / 3 - tris.size) * 3);
  { let n = 0; for (let t = 0; t < IDX.length / 3; t++) { if (tris.has(t)) continue; for (let k = 0; k < 3; k++) keep[n++] = IDX[t * 3 + k]; } }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(keep).setBuffer(buffer));

  const TW = TEX_W, TH = Math.round(TW * H / W);
  const artFile = `${root}/${spec.art}`;
  const meta = await sharp(readFileSync(artFile)).metadata();
  // `fit: 'fill'` — the whole art onto the whole face, no letterbox and no
  // crop. See the header: this is a decision, not a default.
  const png = await sharp(readFileSync(artFile))
    .resize(TW, TH, { fit: 'fill', kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' })
    .png().toBuffer();
  const stretch = (TW / TH) / (meta.width / meta.height);
  log(`badge texture ${TW}x${TH}, art filled edge to edge (widened ${((stretch - 1) * 100).toFixed(0)}%)`);

  const badgeTex = doc.createTexture('badge').setMimeType('image/png').setImage(new Uint8Array(png));
  const mat = doc.createMaterial('TombsBadge')
    .setBaseColorTexture(badgeTex).setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.35).setMetallicFactor(0);   // a card in a vinyl sleeve is a little glossy
  // CLAMP, NOT REPEAT — and now it should never be asked to do anything. The
  // frame is the smallest rectangle CONTAINING the printed face, so every
  // lifted vertex lands inside 0..1 by construction. It stays because the
  // day it is asked, repeating would wrap the TOMBS footer band back onto
  // the top of the card, and a bilinear tap half a texel over the edge of a
  // 640-wide image should take the edge rather than the far side.
  const CLAMP_TO_EDGE = 33071;
  mat.getBaseColorTextureInfo()?.setWrapS(CLAMP_TO_EDGE).setWrapT(CLAMP_TO_EDGE);
  const cardPrim = doc.createPrimitive().setMaterial(mat)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(cardIdx).setBuffer(buffer));
  for (const [s, arr] of Object.entries(attrs)) {
    const acc = doc.createAccessor().setType(TYPE[s] ?? 'VEC3').setArray(arr).setBuffer(buffer);
    if (prim.getAttribute(s)?.getNormalized?.()) acc.setNormalized(true);
    cardPrim.setAttribute(s, acc);
  }
  mesh.addPrimitive(cardPrim);
  return { triangles: tris.size, widthMm: W * 1000, heightMm: H * 1000 };
}
