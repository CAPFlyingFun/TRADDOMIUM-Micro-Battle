/**
 * SARAH'S CLOTHING, AUTHORED RATHER THAN REPAIRED — AND HER BADGE PRINTED.
 *
 * Joshua, 2026-09-18, on the master scan: "around her neck where the
 * lanyard hangs, the textures are like messed up in a few spots and behind
 * her badge, is a white patch on her shirt", and later, naming them: "the
 * inside of the lanyard (both sides), a spot on her right neck/shoulder
 * area, and just under the badge there's a little white splotch".
 *
 * EVERY ONE OF THOSE IS IN THE CLOTHING. None is in her face, which the
 * scan renders beautifully — real irises, lashes and teeth that nothing
 * procedural is going to beat. So this pass replaces the cord and the top
 * with flat colour and does not touch one texel of her skin, her hair or
 * her face.
 *
 * WHY REPLACING IS SAFE WHERE REPAIRING WAS NOT. An earlier pass tried to
 * reconstruct plausible detail around the lanyard and Joshua's verdict was
 * "it looks worse not better" — the failure mode of every inpainting: it
 * invents detail and the invention shows. A flat colour invents nothing, so
 * there is nothing to look wrong. What is lost is the photographic shading
 * baked into the cloth, and that loss is covered twice: the master carries
 * a 2048 NORMAL MAP with every fold in it, and the occlusion bake puts the
 * contact shadow back under the collar and the strap.
 *
 * AND THE COLOUR IS HERS. The top is painted the MEDIAN of the scan's own
 * colour over the region it covers. The scan is a bad painter but an honest
 * colorimeter, so nothing is invented there either.
 *
 * THESE NUMBERS BELONG TO ONE MASTER. Every threshold below was measured on
 * `Sarah-Lab2.glb` and is quoted with what it separates. This is an
 * authoring pass for one body, not a general tool, and it says so rather
 * than pretending to generalise.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { surfaceOf } from './humanSurface.mjs';

// ---------------------------------------------------------------- the cord
//
// THE FOUR MEDIANS THE TESTS ARE BUILT ON, measured over this atlas:
//
//   the strap    rgb( 38, 41, 48)   r/g  0.93   NEUTRAL and dark
//   the top      rgb(111,  9, 43)   r/g 11.76   strongly red
//   its shadow   rgb( 67, 20, 36)   r/g  3.37   still strongly red
//   her hair     rgb(103, 60, 37)   r/g  1.72   warm
//
// So the cord is "dark AND NEUTRAL", which a shadow on a burgundy top never
// is — a first pass keyed on darkness alone flooded halfway across her
// chest. And the top is "red over green above 2.5", which her auburn hair
// never is — a first pass keyed on saturation filled the shirt to the top
// of her head.
const CORD_CORE_MAX = 78;
/** Painted, not measured: the strap's own median IS the fringe being removed. */
const CORD_COLOUR = [26, 28, 33];
/** How far the strap is grown along its own surface, and how far off it. */
const CORD_GROW = 0.005, CORD_SHEET = 0.002;
/** Clustering: link within 4 mm, keep a piece of 400+ texels spanning 50 mm+. */
const CORD_LINK = 0.004, CORD_MIN_TEXELS = 400, CORD_MIN_SPAN = 0.05;

const SHIRT_AO = 0.55, CORD_AO = 0.45;
const SHIRT_GRAIN = 0.035, CORD_GRAIN = 0.06;
const GUTTER_PASSES = 6;

// ---------------------------------------------------------------- the badge
//
// IN THE BODY'S 2048 ATLAS THE CARD'S ISLAND IS SEVENTY BY THIRTY-EIGHT
// TEXELS. That is why the printing on it reads as mush in every shot: at 38
// texels tall a logo is twenty texels wide, and no art survives that.
// Replacing those texels with better art changes nothing — so the card's
// triangles are lifted into a primitive of their own with a dedicated
// texture, and their UVs are rebuilt from the card's own plane, which also
// lands the artwork upright without anyone working out how the old island
// was rotated.
const BADGE_ART = 'art/humans/badge/sarah-tombs.webp';
/** The slab the card hangs in. Its back face sits at z ≈ 0.167 and the shirt
 * behind it never reaches 0.156, so DEPTH is what separates them. */
const CARD_SLAB = { zMin: 0.156, yMin: 1.050, yMax: 1.152, xMid: 0.005, xHalf: 0.040 };
const BADGE_TEX_W = 640;
/** How much of the lump is vinyl sleeve, top and bottom. */
const BADGE_INSET = 0.06;
const SLEEVE = '#c9ccd0';

const TYPE = {
  POSITION: 'VEC3', NORMAL: 'VEC3', TANGENT: 'VEC4', TEXCOORD_0: 'VEC2', TEXCOORD_1: 'VEC2',
  COLOR_0: 'VEC4', JOINTS_0: 'VEC4', JOINTS_1: 'VEC4', JOINTS_2: 'VEC4',
  WEIGHTS_0: 'VEC4', WEIGHTS_1: 'VEC4', WEIGHTS_2: 'VEC4',
};

/** Weld by position so a UV seam does not break a surface into two. */
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
 * Author the clothing and print the badge. Mutates `doc`; returns a report.
 *
 * `cacheDir` holds the occlusion bake between runs — see `humanSurface.mjs`.
 */
export async function authorSarah(doc, { cacheDir, stamp, root = '.', log = console.log }) {
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const tex = prim.getMaterial().getBaseColorTexture();
  const S = tex.getSize()[0];
  const { data: img, info } = await sharp(Buffer.from(tex.getImage()))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== S) throw new Error(`atlas is ${info.width} px but the texture reports ${S}`);

  const P = prim.getAttribute('POSITION').getArray();
  const IDX = prim.getIndices().getArray();
  const nt = IDX.length / 3;
  const { pos, nrm, ok, tri, ao, standoff } = surfaceOf(prim, S, cacheDir, stamp, log);

  // Every triangle's own colour, and who its neighbours are.
  const sum = new Float64Array(nt * 3), cnt = new Int32Array(nt);
  for (let i = 0; i < S * S; i++) {
    const t = tri[i];
    if (t < 0) continue;
    sum[t * 3] += img[i * 3]; sum[t * 3 + 1] += img[i * 3 + 1]; sum[t * 3 + 2] += img[i * 3 + 2];
    cnt[t] += 1;
  }
  const col = (t) => [sum[t * 3] / cnt[t], sum[t * 3 + 1] / cnt[t], sum[t * 3 + 2] / cnt[t]];
  const rep = weldMap(P);
  const byVert = new Map();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = rep[IDX[t * 3 + k]];
      let a = byVert.get(v); if (!a) { a = []; byVert.set(v, a); } a.push(t);
    }
  }
  const centre = (t) => {
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) c[j] += P[IDX[t * 3 + k] * 3 + j] / 3;
    return c;
  };
  const fill = (seeds, test) => {
    const seen = new Set(seeds), stack = [...seeds];
    while (stack.length) {
      const t = stack.pop();
      for (let k = 0; k < 3; k++) for (const n of byVert.get(rep[IDX[t * 3 + k]]) ?? []) {
        if (!seen.has(n) && cnt[n] && test(n)) { seen.add(n); stack.push(n); }
      }
    }
    return seen;
  };

  // ------------------------------------------------------------- THE CORD
  //
  // THE CONTAMINATION IS SUB-TRIANGLE, which is why every triangle-level
  // attempt failed: one triangle spans both the black webbing and the
  // burgundy margin the scan painted onto the strap's silhouette, so
  // labelling it either way is wrong. The atlas is no help either — this
  // master's is WELDED, a single island of 3.29 M texels, so there is no
  // island edge to stop at.
  //
  // So the strap is grown IN SPACE from the texels that are unmistakably
  // webbing, under a SURFACE-SHEET constraint: a neighbour is taken only if
  // it lies within 2 mm of the local tangent plane. That is what stops the
  // growth stepping off the strap onto the shirt eight millimetres behind
  // it — close in space, far along the normal, which is exactly the
  // distinction a plain radius cannot make.
  let core = [];
  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    const y = pos[i * 3 + 1];
    if (y < 1.10 || y > 1.47 || Math.abs(pos[i * 3]) > 0.14) continue;
    const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2];
    if (Math.max(r, g, b) < CORD_CORE_MAX && r < g * 1.30 && r < b * 1.50) core.push(i);
  }
  const beforeCluster = core.length;

  // A STRAP IS A CONNECTED CURVE; A BLEMISH IS A SPECK. The scan's shirt is
  // dotted with small dark marks that pass any test written for black
  // webbing, and growing from each of them put a black blob on her chest.
  {
    const cells = new Map();
    const key = (i) => `${Math.floor(pos[i * 3] / CORD_LINK)},${Math.floor(pos[i * 3 + 1] / CORD_LINK)},${Math.floor(pos[i * 3 + 2] / CORD_LINK)}`;
    for (const i of core) { const k = key(i); let a = cells.get(k); if (!a) { a = []; cells.set(k, a); } a.push(i); }
    const seen = new Set(), parts = [];
    for (const start of core) {
      if (seen.has(start)) continue;
      seen.add(start);
      const stack = [start], part = [];
      while (stack.length) {
        const c = stack.pop(); part.push(c);
        const ci = Math.floor(pos[c * 3] / CORD_LINK), cj = Math.floor(pos[c * 3 + 1] / CORD_LINK), ck = Math.floor(pos[c * 3 + 2] / CORD_LINK);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
          for (const j of cells.get(`${ci + a},${cj + b},${ck + d}`) ?? []) {
            if (seen.has(j)) continue;
            const dx = pos[c * 3] - pos[j * 3], dy = pos[c * 3 + 1] - pos[j * 3 + 1], dz = pos[c * 3 + 2] - pos[j * 3 + 2];
            if (dx * dx + dy * dy + dz * dz <= CORD_LINK * CORD_LINK) { seen.add(j); stack.push(j); }
          }
        }
      }
      parts.push(part);
    }
    const span = (part) => {
      const m = [9, 9, 9], M = [-9, -9, -9];
      for (const i of part) for (let j = 0; j < 3; j++) { m[j] = Math.min(m[j], pos[i * 3 + j]); M[j] = Math.max(M[j], pos[i * 3 + j]); }
      return Math.hypot(M[0] - m[0], M[1] - m[1], M[2] - m[2]);
    };
    const keep = parts.filter((p) => p.length >= CORD_MIN_TEXELS && span(p) > CORD_MIN_SPAN);
    core = keep.flat();
    log(`  cord core ${beforeCluster} texels in ${parts.length} clusters -> ${keep.length} kept, ${core.length} texels`);
  }

  const cordTex = new Set(core);
  {
    const cells = new Map();
    for (const i of core) {
      const k = `${Math.floor(pos[i * 3] / CORD_GROW)},${Math.floor(pos[i * 3 + 1] / CORD_GROW)},${Math.floor(pos[i * 3 + 2] / CORD_GROW)}`;
      let a = cells.get(k); if (!a) { a = []; cells.set(k, a); } a.push(i);
    }
    for (let i = 0; i < S * S; i++) {
      if (!ok[i] || cordTex.has(i)) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (y < 1.10 || y > 1.47 || Math.abs(x) > 0.14) continue;
      let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      const ci = Math.floor(x / CORD_GROW), cj = Math.floor(y / CORD_GROW), ck = Math.floor(z / CORD_GROW);
      let hit = false;
      for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1 && !hit; b++) for (let c = -1; c <= 1 && !hit; c++) {
        for (const j of cells.get(`${ci + a},${cj + b},${ck + c}`) ?? []) {
          const dx = x - pos[j * 3], dy = y - pos[j * 3 + 1], dz = z - pos[j * 3 + 2];
          if (dx * dx + dy * dy + dz * dz > CORD_GROW * CORD_GROW) continue;
          if (Math.abs(dx * nx + dy * ny + dz * nz) > CORD_SHEET) continue;
          hit = true; break;
        }
      }
      if (hit) cordTex.add(i);
    }
  }
  log(`  cord grown along its own surface to ${cordTex.size} texels`);

  // ------------------------------------------------------------ THE SHIRT
  const isShirt = (t) => {
    const [r, g, b] = col(t);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx > 44 && (mx ? (mx - mn) / mx : 0) > 0.40 && r > g * 2.5 && r > b * 1.2;
  };
  const isSkinLike = (t) => {
    const [r, g, b] = col(t);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx > 135 && (mx ? (mx - mn) / mx : 0) < 0.55 && r > g && g >= b * 0.85;
  };
  const shirtSeed = [];
  for (let t = 0; t < nt; t++) {
    if (!cnt[t] || !isShirt(t)) continue;
    const c = centre(t);
    if (c[1] > 1.05 && c[1] < 1.30 && Math.abs(c[0]) < 0.14) shirtSeed.push(t);
  }
  const shirt = fill(shirtSeed, isShirt);
  // THE COLLAR IS THE REASON FOR THIS STEP. Its band sits in its own shadow,
  // fails the red-over-green test and is left behind as a ragged ring —
  // which is one of the very spots being fixed. So the shirt is grown a few
  // rings into whatever is beside it that is not skin.
  for (let round = 0; round < 4; round++) {
    const add = [];
    for (const t of shirt) for (let k = 0; k < 3; k++) for (const n of byVert.get(rep[IDX[t * 3 + k]]) ?? []) {
      if (shirt.has(n) || !cnt[n] || isSkinLike(n)) continue;
      const c = centre(n);
      if (c[1] > 1.46 || c[1] < 0.80) continue;
      add.push(n);
    }
    for (const t of add) shirt.add(t);
  }
  log(`  shirt ${shirtSeed.length} seeds -> ${shirt.size} triangles`);

  // ------------------------------------------------------------- THE PAINT
  const onShirt = new Uint8Array(nt);
  for (const t of shirt) onShirt[t] = 1;
  const texels = [[], []];
  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    if (cordTex.has(i)) { texels[1].push(i); continue; }    // the cord wins where they overlap
    const t = tri[i];
    if (t >= 0 && onShirt[t]) texels[0].push(i);
  }
  const median = (ids) => {
    const ch = [[], [], []];
    for (const i of ids) for (let k = 0; k < 3; k++) ch[k].push(img[i * 3 + k]);
    ch.forEach((a) => a.sort((p, q) => p - q));
    return ch.map((a) => a[a.length >> 1]);
  };
  const base = [median(texels[0]), CORD_COLOUR];
  const out = Buffer.from(img);
  // A grain keyed on the 3D POSITION rather than the texel, so it does not
  // change pitch at every one of the atlas's UV seams.
  const hash = (x, y, z) => {
    let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const strength = [SHIRT_AO, CORD_AO], grain = [SHIRT_GRAIN, CORD_GRAIN];
  for (let g = 0; g < 2; g++) for (const i of texels[g]) {
    const n = hash(Math.round(pos[i * 3] * 2000), Math.round(pos[i * 3 + 1] * 2000), Math.round(pos[i * 3 + 2] * 2000));
    const k = 1 + (n - 0.5) * 2 * grain[g];
    const a = 1 - strength[g] * (1 - Math.min(1, Math.max(0, ao[i])));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(base[g][c] * k * a)));
  }
  log(`  shirt rgb(${base[0].join(',')}) over ${texels[0].length.toLocaleString()} texels; cord rgb(${base[1].join(',')}) over ${texels[1].length.toLocaleString()}`);

  // The gutter, so a mip or a bilinear tap at an island's edge never reaches
  // into the empty page and draws a fringe round everything.
  const filled = Uint8Array.from(ok, (v) => (v ? 1 : 0));
  for (let p = 0; p < GUTTER_PASSES; p++) {
    const add = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (filled[i]) continue;
      let r = 0, g2 = 0, b = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(S - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(S - 1, x + 1); xx++) {
          const j = yy * S + xx;
          if (!filled[j]) continue;
          r += out[j * 3]; g2 += out[j * 3 + 1]; b += out[j * 3 + 2]; n += 1;
        }
      }
      if (n) add.push([i, (r / n) | 0, (g2 / n) | 0, (b / n) | 0]);
    }
    if (!add.length) break;
    for (const [i, r, g2, b] of add) { out[i * 3] = r; out[i * 3 + 1] = g2; out[i * 3 + 2] = b; filled[i] = 1; }
  }
  tex.setImage(new Uint8Array(await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer()))
    .setMimeType('image/png');

  // ------------------------------------------------------------- THE BADGE
  const card = findCard(P, IDX, nt, S, img, tri, pos, nrm, cnt, col, rep, byVert);
  await printBadge(doc, mesh, prim, card, root, log);
  return { S, cordTexels: cordTex.size, shirtTexels: texels[0].length, shirtColour: base[0], cardTriangles: card.tris.size };
}

/** Find the ID card's triangles: the pale forward-facing patch on her front,
 * grown through the slab it hangs in and refused entry to the burgundy top. */
function findCard(P, IDX, nt, S, img, tri, pos, nrm, cnt, col, rep, byVert) {
  const mask = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y < 1.00 || y > 1.20 || Math.abs(x) > 0.07 || z < 0.10) continue;
    const L = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    if (nrm[i * 3 + 2] / L < 0.6) continue;
    const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 150 || (mx ? (mx - mn) / mx : 0) > 0.26) continue;
    mask[i] = 1;
  }
  // The biggest connected patch of that is the card's printed face.
  const seen = new Uint8Array(S * S); let best = [];
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
    if (part.length > best.length) best = part;
  }
  const seed = new Set();
  for (const i of best) { const t = tri[i]; if (t >= 0) seed.add(t); }

  const burgundy = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    if (!cnt[t]) continue;
    const [r, g, b] = col(t);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if ((mx ? (mx - mn) / mx : 0) > 0.30 && r > g * 1.6 && r > b * 1.3) burgundy[t] = 1;
  }
  const inSlab = (v) => {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    return z > CARD_SLAB.zMin && y > CARD_SLAB.yMin && y < CARD_SLAB.yMax
      && Math.abs(x - CARD_SLAB.xMid) < CARD_SLAB.xHalf;
  };
  const okTri = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    if (burgundy[t]) continue;                     // the card is fused to the cloth; colour is the only edge
    if (inSlab(IDX[t * 3]) && inSlab(IDX[t * 3 + 1]) && inSlab(IDX[t * 3 + 2])) okTri[t] = 1;
  }
  const tris = new Set([...seed].filter((t) => okTri[t]));
  const stack = [...tris];
  while (stack.length) {
    const t = stack.pop();
    for (let k = 0; k < 3; k++) for (const n of byVert.get(rep[IDX[t * 3 + k]]) ?? []) {
      if (!tris.has(n) && okTri[n]) { tris.add(n); stack.push(n); }
    }
  }
  const m = [9, 9, 9], M = [-9, -9, -9];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = IDX[t * 3 + k];
    for (let j = 0; j < 3; j++) { m[j] = Math.min(m[j], P[v * 3 + j]); M[j] = Math.max(M[j], P[v * 3 + j]); }
  }
  return { tris, m, M };
}

/** Lift the card onto its own primitive, rebuild its UVs from its own plane
 * and print the artwork on it. */
async function printBadge(doc, mesh, prim, card, root, log) {
  const { tris, m, M } = card;
  const P = prim.getAttribute('POSITION').getArray();
  const IDX = prim.getIndices().getArray();
  const W = M[0] - m[0], H = M[1] - m[1];
  log(`  badge ${tris.size} triangles, ${(W * 1000).toFixed(1)} x ${(H * 1000).toFixed(1)} mm, aspect ${(W / H).toFixed(3)}`);

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

  // THE GEOMETRY IS NOT CARD-SHAPED AND THE ART IS. The scan fused card,
  // vinyl sleeve and clip into one lump, so its aspect is not a printed
  // card's. The art is fitted by HEIGHT and centred on a sleeve-grey field:
  // the printing keeps its proportions and the spare width reads as the
  // sleeve it actually is. Stretching the art to the lump would widen every
  // letter by a third.
  const TW = BADGE_TEX_W, TH = Math.round(TW * H / W);
  const artFile = `${root}/${BADGE_ART}`;
  const src = sharp(readFileSync(artFile));
  const meta = await src.metadata();
  const artH = Math.round(TH * (1 - 2 * BADGE_INSET));
  const artW = Math.round(artH * meta.width / meta.height);
  const art = await sharp(readFileSync(artFile)).resize(artW, artH, { kernel: 'lanczos3' }).toBuffer();
  const png = await sharp({ create: { width: TW, height: TH, channels: 3, background: SLEEVE } })
    .composite([{ input: art, left: Math.round((TW - artW) / 2), top: Math.round((TH - artH) / 2) }])
    .png().toBuffer();
  log(`  badge texture ${TW}x${TH}, art ${artW}x${artH} inset ${(BADGE_INSET * 100).toFixed(0)}%`);

  const tex = doc.createTexture('sarah-badge').setMimeType('image/png').setImage(new Uint8Array(png));
  const mat = doc.createMaterial('SarahBadge')
    .setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.35).setMetallicFactor(0);   // a card in a vinyl sleeve is a little glossy
  const cardPrim = doc.createPrimitive().setMaterial(mat)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(cardIdx).setBuffer(buffer));
  for (const [s, arr] of Object.entries(attrs)) {
    const acc = doc.createAccessor().setType(TYPE[s] ?? 'VEC3').setArray(arr).setBuffer(buffer);
    if (prim.getAttribute(s)?.getNormalized?.()) acc.setNormalized(true);
    cardPrim.setAttribute(s, acc);
  }
  mesh.addPrimitive(cardPrim);
}
