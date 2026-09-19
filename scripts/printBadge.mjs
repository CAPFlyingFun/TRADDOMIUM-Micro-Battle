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
 * THE CARD IS FOUND BY A DEPTH SLAB, because a badge hangs OFF a chest and
 * the chest behind it never reaches that depth. The slab is per-person and
 * measured, not guessed, and the two of them are genuinely different:
 *
 *   Jack   the histogram has a clean gap — chest at z 0.082..0.100,
 *          NOTHING at 0.102..0.108, card at 0.110..0.114. The slab alone
 *          isolates it: 35 triangles, 62.2 x 73.7 x 4.8 mm.
 *   Sarah  no gap at all. Her scan fused card, vinyl sleeve and clip into
 *          one lump 32 mm deep and welded it to the cloth, so the slab
 *          alone takes 75 x 91 mm of shirt with it. She needs the colour
 *          gate below as well, which cuts it to 57.9 x 81.9 mm.
 *
 * So `rejectShirt` is not a knob someone might like — it is the difference
 * between a scan that separated the card and one that did not.
 *
 * THE GEOMETRY IS NOT CARD-SHAPED AND THE ART IS. Jack's lump measures
 * 0.843 wide-over-tall and Sarah's 0.707, where their printed cards crop
 * to 0.621 and 0.602. So the art is fitted by HEIGHT and centred on a
 * sleeve-grey field: the printing keeps its proportions and the spare
 * width reads as the vinyl sleeve it actually is. Stretching the art to
 * the lump's aspect would widen every letter by a fifth to a third.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { rasterize } from './humanSurface.mjs';

const TEX_W = 640;
/** How much of the lump is sleeve, top and bottom. */
const INSET = 0.06;
const SLEEVE = '#c9ccd0';

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
 * Everything whose three vertices sit in the slab, and — when the scan
 * welded the card to the cloth — nothing whose own colour says it is the
 * shirt. The result is the connected piece containing the palest, flattest,
 * most forward-facing patch on the chest, so a stray slab-shaped thing
 * elsewhere cannot be mistaken for a badge.
 */
function findCard(prim, S, img, slab, rejectShirt) {
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

  // Every triangle's own colour, for the shirt gate.
  const shirt = new Uint8Array(nt);
  if (rejectShirt) {
    const sum = new Float64Array(nt * 3), cnt = new Int32Array(nt);
    for (let i = 0; i < S * S; i++) {
      const t = tri[i];
      if (t < 0) continue;
      sum[t * 3] += img[i * 3]; sum[t * 3 + 1] += img[i * 3 + 1]; sum[t * 3 + 2] += img[i * 3 + 2];
      cnt[t] += 1;
    }
    for (let t = 0; t < nt; t++) {
      if (!cnt[t]) continue;
      const r = sum[t * 3] / cnt[t], g = sum[t * 3 + 1] / cnt[t], b = sum[t * 3 + 2] / cnt[t];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if ((mx ? (mx - mn) / mx : 0) > 0.30 && r > g * 1.6 && r > b * 1.3) shirt[t] = 1;
    }
  }

  const inSlab = (v) => {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    return z > slab.zMin && y > slab.yMin && y < slab.yMax && Math.abs(x - slab.xMid) < slab.xHalf;
  };
  const allowed = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    if (shirt[t]) continue;
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
  const tris = new Set();
  const stack = [];
  for (const i of biggest) { const t = tri[i]; if (t >= 0 && allowed[t] && !tris.has(t)) { tris.add(t); stack.push(t); } }
  while (stack.length) {
    const t = stack.pop();
    for (let k = 0; k < 3; k++) for (const n of byVert.get(rep[IDX[t * 3 + k]]) ?? []) {
      if (!tris.has(n)) { tris.add(n); stack.push(n); }
    }
  }
  if (!tris.size) throw new Error('the printed face is not inside the badge slab — the slab is wrong');
  const m = [9, 9, 9], M = [-9, -9, -9];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = IDX[t * 3 + k];
    for (let j = 0; j < 3; j++) { m[j] = Math.min(m[j], P[v * 3 + j]); M[j] = Math.max(M[j], P[v * 3 + j]); }
  }
  return { tris, m, M };
}

/**
 * Lift the card onto its own primitive and print `spec.art` on it.
 *
 * `spec` is `{ art, slab: { zMin, yMin, yMax, xMid, xHalf }, rejectShirt }`.
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

  const { tris, m, M } = findCard(prim, S, img, spec.slab, spec.rejectShirt === true);
  const P = prim.getAttribute('POSITION').getArray();
  const IDX = prim.getIndices().getArray();
  const W = M[0] - m[0], H = M[1] - m[1];
  log(`badge ${tris.size} triangles, ${(W * 1000).toFixed(1)} x ${(H * 1000).toFixed(1)} mm, aspect ${(W / H).toFixed(3)}`);

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
  const artH = Math.round(TH * (1 - 2 * INSET));
  const artW = Math.round(artH * meta.width / meta.height);
  const art = await sharp(readFileSync(artFile)).resize(artW, artH, { kernel: 'lanczos3' }).toBuffer();
  const png = await sharp({ create: { width: TW, height: TH, channels: 3, background: SLEEVE } })
    .composite([{ input: art, left: Math.round((TW - artW) / 2), top: Math.round((TH - artH) / 2) }])
    .png().toBuffer();
  log(`badge texture ${TW}x${TH}, art ${artW}x${artH} inset ${(INSET * 100).toFixed(0)}%`);

  const badgeTex = doc.createTexture('badge').setMimeType('image/png').setImage(new Uint8Array(png));
  const mat = doc.createMaterial('TombsBadge')
    .setBaseColorTexture(badgeTex).setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.35).setMetallicFactor(0);   // a card in a vinyl sleeve is a little glossy
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
