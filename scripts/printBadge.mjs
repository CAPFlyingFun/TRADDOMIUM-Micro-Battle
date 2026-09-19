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
 * HOLDER. Jack's slab was cut off at y 1.160, which is two thirds of the
 * way up his badge, so the art filled 60.7 x 66.0 mm of a 61.9 x 95.5 mm
 * front and the top third stayed the scan's grey vinyl. That is exactly
 * the red box he drew inside the blue one. Opened to the real front the
 * two faces measure 0.648 (Jack) and 0.682 (Sarah) wide-over-tall against
 * art that is 0.678 and 0.680 — a 4% widen and none at all, where the
 * clipped faces wanted 36% and 5%. A frame that needs no stretching is
 * the check that it is the right frame.
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

  // THE ARTWORK IS SQUARED AGAINST THE PRINTED FACE, and on a card that
  // hangs at an angle the printed face is what FACES FORWARD within the
  // plane, not everything in it: the sleeve's rolled edges are in the plane
  // too and would widen the frame by their thickness. u runs with x, v with
  // y — the card's tilt is uniform, so a uniform map in world x/y is a
  // uniform map in the card's own plane, foreshortened exactly as the
  // geometry is.
  const flat = [...tris].filter((t) => nrmOf(t)[2] >= FLAT_FACING);
  const frame = flat.length ? flat : [...tris];
  const m = [9, 9, 9], M = [-9, -9, -9];
  for (const t of frame) for (let k = 0; k < 3; k++) {
    const v = IDX[t * 3 + k];
    for (let j = 0; j < 3; j++) { m[j] = Math.min(m[j], P[v * 3 + j]); M[j] = Math.max(M[j], P[v * 3 + j]); }
  }
  return { tris, dropped: refused, m, M, flat: flat.length };
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

  const { tris, dropped, m, M, flat } = findCard(prim, S, img, spec.slab);
  const P = prim.getAttribute('POSITION').getArray();
  const IDX = prim.getIndices().getArray();
  const W = M[0] - m[0], H = M[1] - m[1];
  log(`badge ${tris.size} triangles (${flat} flat, ${dropped} neighbours refused as out of its plane), printed face ${(W * 1000).toFixed(1)} x ${(H * 1000).toFixed(1)} mm, aspect ${(W / H).toFixed(3)}`);

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
  // The card's plane is the world x/y plane — it hangs facing the viewer —
  // so its width and height map straight to u and v. v counts DOWN, because
  // glTF puts (0,0) at the image's top-left.
  const uv = new Float32Array(order.length * 2);
  order.forEach((v, i) => { uv[i * 2] = (P[v * 3] - m[0]) / W; uv[i * 2 + 1] = (M[1] - P[v * 3 + 1]) / H; });
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
  // CLAMP, not repeat: the sleeve's flap sits outside 0..1 and must take the
  // card's edge colour. Repeating would wrap the TOMBS footer onto it.

  const mat = doc.createMaterial('TombsBadge')
    .setBaseColorTexture(badgeTex).setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.35).setMetallicFactor(0);   // a card in a vinyl sleeve is a little glossy
  // CLAMP, NOT REPEAT. The sleeve's flap is carried on this material but its
  // UVs fall outside 0..1, because the frame is the flat face's. Clamped, it
  // takes the card's own edge colour; repeated, it would wrap the TOMBS
  // footer band back onto the top of the holder.
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
