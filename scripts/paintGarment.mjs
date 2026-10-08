/**
 * A GROWN GARMENT DRESSED FROM A REFERENCE SHEET — the fabric's look taken from an
 * eight-view turnaround drawing and baked onto the cloth layer `growClothes.mjs`
 * grows from the body.
 *
 * Joshua, 2026-10-08, with ChatGPT's eight-angle sheet of the red maternity tee:
 * "can you basically crop out each of the angles of the outfit and paste it on? The
 * problem is like the shirt needs to be a second layer and not painted as it looks
 * weird and obvious it's painted". So the drawing never touches the skin: it goes on
 * the garment, a separate mesh standing off the body, and what it gives the cloth is
 * its FABRIC — the folds, the side ruching, the seams, the knit — not its lighting:
 *
 *   1. THE VIEWS. The sheet's garment pixels (by colour) are split into eight
 *      figures, left to right, each a camera round the body (`VIEWS`: front,
 *      front-right, right, back-right, back, back-left, left, front-left; the body
 *      faces +z and her left is +x).
 *   2. THE FIT. A drawn figure is never the model's exact shape, so each view is
 *      fitted to the cloth row by row: the cloth's height range seen from that side
 *      maps to the figure's rows, and at each height the cloth's width across the
 *      view maps to the figure's width in that row.
 *   3. NO PAINTED LIGHT. The drawing's own shading (darker sides, a highlight on the
 *      bump) would sit on the cloth and fight the scene's lights. Each view keeps
 *      only its DETAIL: its brightness divided by a wide blur of itself, so a fold
 *      reads as a fold and the broad light is gone.
 *   4. THE BAKE. Every texel of the garment's UV layout is found on the cloth, seen
 *      from each view weighted by how squarely that view faces it, and gets the
 *      garment's colour times the blended detail (the base colour texture) and the
 *      detail as relief (a normal map), so the folds catch the real light.
 *
 * Skin hidden by an arm in a drawing, and the sleeves (the drawing's arms hang; the
 * model's are in a T), take no detail from it: plain cloth.
 *
 * A module, not a command; called by `growClothes.mjs` for a garment whose spec
 * names a sheet.
 */
import sharp from 'sharp';

/** The eight figures on a sheet, left to right, as directions from the body toward the camera. */
const S = Math.SQRT1_2;
export const VIEWS = [
  { name: 'front', d: [0, 0, 1] },
  { name: 'front-right', d: [-S, 0, S] },
  { name: 'right', d: [-1, 0, 0] },
  { name: 'left', d: [1, 0, 0] },
  { name: 'back', d: [0, 0, -1] },
  { name: 'back-left', d: [S, 0, -S] },
  { name: 'back-right', d: [-S, 0, -S] },
  { name: 'front-left', d: [S, 0, S] },
];
/** Texture size of the baked base colour and normal maps. */
export const TEXTURE = 1024;
/** The blur that takes the drawing's broad light away, in sheet pixels. */
export const DELIGHT_PX = 9;
/** How far detail may lighten or darken the cloth, and how deep it reads as relief. */
export const DETAIL_RANGE = [0.84, 1.12];
export const RELIEF = 0.7;
/** How sharply the best-facing view wins (blending two drawn views that disagree left rings). */
export const VIEW_SHARPNESS = 10;
/** A light blur of the baked detail, texels, so the sheet's pixel noise does not read as crinkles. */
export const DETAIL_SOFTEN = 2;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The sheet's figures: garment pixels by colour, split into eight at the narrowest columns. */
async function readSheet(file, isCloth) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) if (data[i * 4 + 3] > 200 && isCloth(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) mask[i] = 1;
  // the figures' band: the rows holding most of the cloth (stray specks elsewhere drop out)
  const rowSum = new Float32Array(H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) rowSum[y] += mask[y * W + x];
  const peak = Math.max(...rowSum);
  let top = 0, bot = H - 1;
  while (top < H && rowSum[top] < peak * 0.08) top += 1;
  while (bot > 0 && rowSum[bot] < peak * 0.08) bot -= 1;
  for (let y = 0; y < H; y += 1) if (y < top - 4 || y > bot + 4) for (let x = 0; x < W; x += 1) mask[y * W + x] = 0;
  // eight figures: cut at the seven emptiest columns, one in each eighth's boundary zone
  const colSum = new Float32Array(W);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) colSum[x] += mask[y * W + x];
  const cuts = [0];
  for (let k = 1; k < VIEWS.length; k += 1) {
    const c = Math.round((k * W) / VIEWS.length), r = Math.round(W / VIEWS.length / 3);
    let best = c;
    for (let x = c - r; x <= c + r; x += 1) if (colSum[x] < colSum[best]) best = x;
    cuts.push(best);
  }
  cuts.push(W);
  // luminance, and its wide blur (box blur, three passes), for the detail
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) lum[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
  const blurMasked = (src) => {
    let a = Float32Array.from(src, (v, i) => (mask[i] ? v : 0)), wgt = Float32Array.from(mask);
    const pass = (arr, horizontal) => {
      const out = new Float32Array(W * H), r = DELIGHT_PX;
      for (let o = 0; o < (horizontal ? H : W); o += 1) {
        let sum = 0;
        const len = horizontal ? W : H, at = (t) => (horizontal ? o * W + t : t * W + o);
        for (let t = -r; t <= r; t += 1) if (t >= 0 && t < len) sum += arr[at(t)];
        for (let t = 0; t < len; t += 1) {
          out[at(t)] = sum;
          const add = t + r + 1, drop = t - r;
          if (add < len) sum += arr[at(add)];
          if (drop >= 0) sum -= arr[at(drop)];
        }
      }
      return out;
    };
    for (let p = 0; p < 3; p += 1) { a = pass(pass(a, true), false); wgt = pass(pass(wgt, true), false); }
    return Float32Array.from(a, (v, i) => (wgt[i] > 1e-3 ? v / wgt[i] : 0));
  };
  const broad = blurMasked(lum);
  const detail = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) detail[i] = mask[i] && broad[i] > 1 ? Math.min(DETAIL_RANGE[1], Math.max(DETAIL_RANGE[0], lum[i] / broad[i])) : 1;
  // each figure's rows and, per row, its extent: the run through the figure's middle
  // where that run is whole (an arm can split a side view; then the full extent)
  const figures = [];
  for (let k = 0; k < VIEWS.length; k += 1) {
    const x0 = cuts[k], x1 = cuts[k + 1];
    let rTop = H, rBot = -1, cx = 0, cnt = 0;
    for (let y = 0; y < H; y += 1) for (let x = x0; x < x1; x += 1) if (mask[y * W + x]) { rTop = Math.min(rTop, y); rBot = Math.max(rBot, y); cx += x; cnt += 1; }
    if (!cnt) { figures.push(null); continue; }
    cx = Math.round(cx / cnt);
    const L = new Float32Array(H).fill(NaN), R = new Float32Array(H).fill(NaN);
    for (let y = rTop; y <= rBot; y += 1) {
      let lo = -1, hi = -1;
      for (let x = x0; x < x1; x += 1) if (mask[y * W + x]) { if (lo < 0) lo = x; hi = x; }
      if (lo < 0) continue;
      L[y] = lo; R[y] = hi;
    }
    // smoothed down the figure so one ragged row cannot jolt the fit
    const sm = (arr) => Float32Array.from(arr, (_, y) => { let s = 0, c = 0; for (let d = -6; d <= 6; d += 1) { const v = arr[y + d]; if (Number.isFinite(v)) { s += v; c += 1; } } return c ? s / c : NaN; });
    figures.push({ x0, x1, top: rTop, bot: rBot, L: sm(L), R: sm(R) });
  }
  return { W, H, mask, detail, figures };
}

/**
 * Bakes the garment's look from `file` onto its material: a base colour texture (the
 * garment colour times the sheet's detail) and a normal map (the detail as relief).
 * `x`, `n`: the cloth's positions and normals; `uv`, `faces`: its layout; `plain(k)`:
 * true for a vertex the sheet must not dress (the sleeves).
 */
export async function paintGarment({ doc, material, file, colour, isCloth, x, n, uv, faces, plain, log = () => {} }) {
  const sheet = await readSheet(file, isCloth);
  const m = x.length / 3;
  // per view: the right vector, and the cloth's extent seen from it, height by height
  const BIN = 0.005;
  const views = VIEWS.map((v, k) => {
    const fig = sheet.figures[k];
    if (!fig) return null;
    const [dx, , dz] = v.d;
    // the camera's right: (-d) x up. Front: +x (her left on the right of the picture)
    const R = [dz, 0, -dx];
    let yMin = Infinity, yMax = -Infinity;
    const ext = new Map();
    for (let i = 0; i < m; i += 1) {
      if (plain(i)) continue;
      const facing = n[i * 3] * dx + n[i * 3 + 2] * dz;
      if (facing < 0.05) continue;
      const y = x[i * 3 + 1], u = x[i * 3] * R[0] + x[i * 3 + 2] * R[2];
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      const b = Math.round(y / BIN), e = ext.get(b);
      if (!e) ext.set(b, [u, u]); else { e[0] = Math.min(e[0], u); e[1] = Math.max(e[1], u); }
    }
    const extentAt = (y) => {
      const b = Math.round(y / BIN);
      let lo = 0, hi = 0, c = 0;
      for (let d = -3; d <= 3; d += 1) { const e = ext.get(b + d); if (e) { lo += e[0]; hi += e[1]; c += 1; } }
      return c ? [lo / c, hi / c] : null;
    };
    return { d: v.d, R, yMin, yMax, fig, extentAt };
  });
  const sample = (vi, p) => {
    const v = views[vi];
    if (!v) return null;
    const y = p[1], u = p[0] * v.R[0] + p[2] * v.R[2];
    if (y < v.yMin || y > v.yMax) return null;
    const row = v.fig.top + ((v.yMax - y) / (v.yMax - v.yMin)) * (v.fig.bot - v.fig.top);
    const r0 = Math.round(row);
    const L = v.fig.L[r0], Rr = v.fig.R[r0], e = v.extentAt(y);
    if (!e || !Number.isFinite(L) || e[1] - e[0] < 1e-4) return null;
    const col = L + ((u - e[0]) / (e[1] - e[0])) * (Rr - L);
    const ix = Math.round(col), iy = r0;
    if (ix < v.fig.x0 || ix >= v.fig.x1 || iy < 0 || iy >= sheet.H) return null;
    const at = iy * sheet.W + ix;
    return sheet.mask[at] ? sheet.detail[at] : null;
  };
  // the bake: every texel of the layout, found on the cloth by its triangle
  const T = TEXTURE;
  const det = new Float32Array(T * T).fill(NaN);
  const p = [0, 0, 0], q = [0, 0, 0];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    const ua = uv[a * 2] * T, va = uv[a * 2 + 1] * T, ub = uv[b * 2] * T, vb = uv[b * 2 + 1] * T, uc = uv[c * 2] * T, vc = uv[c * 2 + 1] * T;
    const area = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (Math.abs(area) < 1e-9) continue;
    const isPlain = plain(a) && plain(b) && plain(c);
    const minU = Math.max(0, Math.floor(Math.min(ua, ub, uc))), maxU = Math.min(T - 1, Math.ceil(Math.max(ua, ub, uc)));
    const minV = Math.max(0, Math.floor(Math.min(va, vb, vc))), maxV = Math.min(T - 1, Math.ceil(Math.max(va, vb, vc)));
    for (let ty = minV; ty <= maxV; ty += 1) for (let tx = minU; tx <= maxU; tx += 1) {
      const px = tx + 0.5, py = ty + 0.5;
      const w1 = ((ub - px) * (vc - py) - (uc - px) * (vb - py)) / area;
      const w2 = ((uc - px) * (va - py) - (ua - px) * (vc - py)) / area;
      const w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      if (isPlain) { det[ty * T + tx] = 1; continue; }
      for (let k = 0; k < 3; k += 1) { p[k] = x[a * 3 + k] * w1 + x[b * 3 + k] * w2 + x[c * 3 + k] * w3; q[k] = n[a * 3 + k] * w1 + n[b * 3 + k] * w2 + n[c * 3 + k] * w3; }
      let sum = 0, wsum = 0;
      for (let vi = 0; vi < views.length; vi += 1) {
        const v = views[vi];
        if (!v) continue;
        const facing = q[0] * v.d[0] + q[1] * v.d[1] + q[2] * v.d[2];
        if (facing <= 0.1) continue;
        const s = sample(vi, p);
        if (s === null) continue;
        const w = facing ** VIEW_SHARPNESS;
        sum += s * w; wsum += w;
      }
      // fades to plain cloth toward the sleeves, so no hard edge marks where the sheet stops
      const plainShare = (plain(a) ? w1 : 0) + (plain(b) ? w2 : 0) + (plain(c) ? w3 : 0);
      const d = wsum > 0 ? sum / wsum : 1;
      det[ty * T + tx] = 1 + (d - 1) * (1 - plainShare);
    }
  }
  // bleed the texels out past each island's edge, so filtering never reads the empty gaps
  let filled = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = Float32Array.from(det);
    for (let ty = 0; ty < T; ty += 1) for (let tx = 0; tx < T; tx += 1) {
      if (!Number.isNaN(det[ty * T + tx])) continue;
      let s = 0, c = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = tx + ox, Y = ty + oy;
        if (X < 0 || Y < 0 || X >= T || Y >= T) continue;
        const v = det[Y * T + X];
        if (!Number.isNaN(v)) { s += v; c += 1; }
      }
      if (c) { next[ty * T + tx] = s / c; filled += 1; }
    }
    det.set(next);
  }
  for (let i = 0; i < T * T; i += 1) if (Number.isNaN(det[i])) det[i] = 1;
  // softened (box blur, twice) so pixel noise does not read as crinkles
  for (let pass = 0; pass < 2; pass += 1) {
    const r = DETAIL_SOFTEN, tmp2 = new Float32Array(T * T);
    for (let ty = 0; ty < T; ty += 1) for (let tx = 0; tx < T; tx += 1) { let s2 = 0, c = 0; for (let d = -r; d <= r; d += 1) { const X = tx + d; if (X >= 0 && X < T) { s2 += det[ty * T + X]; c += 1; } } tmp2[ty * T + tx] = s2 / c; }
    for (let ty = 0; ty < T; ty += 1) for (let tx = 0; tx < T; tx += 1) { let s2 = 0, c = 0; for (let d = -r; d <= r; d += 1) { const Y = ty + d; if (Y >= 0 && Y < T) { s2 += tmp2[Y * T + tx]; c += 1; } } det[ty * T + tx] = s2 / c; }
  }
  // base colour: the garment's colour (linear) times the detail, written as sRGB
  const toS = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));
  const rgb = Buffer.alloc(T * T * 3);
  for (let i = 0; i < T * T; i += 1) for (let k = 0; k < 3; k += 1) rgb[i * 3 + k] = toS(colour[k] * det[i]);
  // normal map: the detail as height, its slope by central differences in the layout
  const nrm = Buffer.alloc(T * T * 3);
  for (let ty = 0; ty < T; ty += 1) for (let tx = 0; tx < T; tx += 1) {
    const h = (X, Y) => det[Math.min(T - 1, Math.max(0, Y)) * T + Math.min(T - 1, Math.max(0, X))];
    const sx = (h(tx + 1, ty) - h(tx - 1, ty)) * RELIEF, sy = (h(tx, ty + 1) - h(tx, ty - 1)) * RELIEF;
    const l = Math.hypot(sx, sy, 1);
    const i = (ty * T + tx) * 3;
    nrm[i] = Math.round(((-sx / l) * 0.5 + 0.5) * 255);
    nrm[i + 1] = Math.round(((sy / l) * 0.5 + 0.5) * 255);
    nrm[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
  }
  const png = (buf) => sharp(buf, { raw: { width: T, height: T, channels: 3 } }).png().toBuffer();
  const [colourPng, normalPng] = await Promise.all([png(rgb), png(nrm)]);
  const colourTex = doc.createTexture(`${material.getName()}-colour`).setImage(colourPng).setMimeType('image/png');
  const normalTex = doc.createTexture(`${material.getName()}-normal`).setImage(normalPng).setMimeType('image/png');
  material.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(colourTex).setNormalTexture(normalTex);
  const seen = views.filter(Boolean).length;
  log(`painted from ${file.split('/').pop()}: ${seen} of ${VIEWS.length} views, ${T}px colour and relief`);
  void smooth; void filled;
  return { colourPng, normalPng };
}

// --------------------------------------------------------- a sheet of the whole body

/**
 * A SHEET DRAWN ON A WHOLE BODY (a bikini, a swimsuit: anything worn on the skin).
 * Its figures are fitted by the BODY's outline rather than the garment's: the
 * drawing's silhouette (its alpha) against the model's, row by row from head to
 * foot, which holds whatever the garment covers. The drawing's arms hang and the
 * model's stand out in a T, so arm pixels are dropped: per row, the figure's runs
 * are kept only where they fall where the model's body (fitted overall) says the
 * body is, and where a row cannot be read the overall fit stands in.
 *
 * Returns, per view, `at(p)`: the sheet pixel a point of the model lies on, or null.
 */
export async function readBodySheet(file, { isCloth, bodyPos, isArm, n }) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const body = new Uint8Array(W * H), cloth = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    if (data[i * 4 + 3] < 200) continue;
    body[i] = 1;
    if (isCloth(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) cloth[i] = 1;
  }
  // the figures: split at the emptiest columns, one in each eighth's boundary zone
  const colSum = new Float32Array(W);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) colSum[x] += body[y * W + x];
  const cuts = [0];
  for (let k = 1; k < VIEWS.length; k += 1) {
    const c = Math.round((k * W) / VIEWS.length), r = Math.round(W / VIEWS.length / 3);
    let best = c;
    for (let x = c - r; x <= c + r; x += 1) if (colSum[x] < colSum[best]) best = x;
    cuts.push(best);
  }
  cuts.push(W);
  const m = bodyPos.length / 3;
  let yLo = Infinity, yHi = -Infinity;
  for (let i = 0; i < m; i += 1) { yLo = Math.min(yLo, bodyPos[i * 3 + 1]); yHi = Math.max(yHi, bodyPos[i * 3 + 1]); }
  const views = VIEWS.map((v, k) => {
    const [dx, , dz] = v.d, R = [dz, 0, -dx];
    const x0 = cuts[k], x1 = cuts[k + 1];
    let top = H, bot = -1;
    for (let y = 0; y < H; y += 1) for (let x = x0; x < x1; x += 1) if (body[y * W + x]) { top = Math.min(top, y); bot = Math.max(bot, y); }
    if (bot < 0) return null;
    const rowOf = (y) => top + ((yHi - y) / (yHi - yLo)) * (bot - top);
    // the model's outline across this view, by height (arms left out)
    const BIN = 0.01, ext = new Map();
    for (let i = 0; i < m; i += 1) {
      if (isArm(i)) continue;
      const y = bodyPos[i * 3 + 1], u = bodyPos[i * 3] * R[0] + bodyPos[i * 3 + 2] * R[2], b = Math.round(y / BIN);
      const e = ext.get(b);
      if (!e) ext.set(b, [u, u]); else { e[0] = Math.min(e[0], u); e[1] = Math.max(e[1], u); }
    }
    // the figure's outline by row, all runs
    const runsAt = (row) => {
      const out = [];
      let s = -1;
      for (let x = x0; x <= x1; x += 1) {
        const on = x < x1 && body[row * W + x];
        if (on && s < 0) s = x;
        if (!on && s >= 0) { out.push([s, x - 1]); s = -1; }
      }
      return out;
    };
    // the overall fit: a scale and a centre, from rows whose outline is one plain run
    const pairs = [];
    for (const [b, e] of ext) {
      const y = b * BIN, row = Math.round(rowOf(y));
      if (row < top || row > bot) continue;
      const runs = runsAt(row);
      if (runs.length !== 1 || e[1] - e[0] < 0.05) continue;
      pairs.push([(runs[0][1] - runs[0][0]) / (e[1] - e[0]), (runs[0][0] + runs[0][1]) / 2, (e[0] + e[1]) / 2]);
    }
    if (pairs.length < 10) return null;
    const med = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const scale = med(pairs.map((q) => q[0]));
    const offset = med(pairs.map((q) => q[1] - q[2] * scale));
    // per row: the runs that overlap where the fit puts the body, their span; where
    // that span is close to the fit's, it is used, otherwise the fit
    const rowFit = new Map();
    for (const [b, e] of ext) {
      const y = b * BIN, row = Math.round(rowOf(y));
      if (row < top || row > bot) continue;
      const pl = offset + e[0] * scale, pr = offset + e[1] * scale, w = pr - pl;
      const keep = runsAt(row).filter(([a, c]) => c >= pl - 0.1 * w && a <= pr + 0.1 * w && (c - a) > 0.25 * w * 0.5);
      let L = pl, Rr = pr;
      if (keep.length) {
        const ml = Math.min(...keep.map((q) => q[0])), mr = Math.max(...keep.map((q) => q[1]));
        if (Math.abs(ml - pl) < 0.15 * w) L = ml;
        if (Math.abs(mr - pr) < 0.15 * w) Rr = mr;
      }
      rowFit.set(b, [e[0], e[1], L, Rr]);
    }
    const fitAt = (y) => {
      const b = Math.round(y / BIN);
      let s = [0, 0, 0, 0], c = 0;
      for (let d = -2; d <= 2; d += 1) { const f = rowFit.get(b + d); if (f) { for (let q = 0; q < 4; q += 1) s[q] += f[q]; c += 1; } }
      return c ? s.map((v) => v / c) : null;
    };
    const at = (p) => {
      const f = fitAt(p[1]);
      if (!f || f[1] - f[0] < 1e-4) return null;
      const u = p[0] * R[0] + p[2] * R[2];
      const col = Math.round(f[2] + ((u - f[0]) / (f[1] - f[0])) * (f[3] - f[2])), row = Math.round(rowOf(p[1]));
      if (col < x0 || col >= x1 || row < 0 || row >= H || !body[row * W + col]) return null;
      return row * W + col;
    };
    // the head is the drawing's (eyes, lips) and never cloth
    const neckRow = top + 0.17 * (bot - top);
    return { d: v.d, at, neckRow };
  });
  // the drawing's colours with its broad light divided out: each fabric pixel's colour
  // over the blurred brightness of the fabric round it, at the fabric's median brightness
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) lum[i] = cloth[i] ? 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2] : 0;
  const box = (src, r) => {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y += 1) { let s = 0; for (let x = -r; x <= r; x += 1) if (x >= 0 && x < W) s += src[y * W + x]; for (let x = 0; x < W; x += 1) { tmp[y * W + x] = s; if (x + r + 1 < W) s += src[y * W + x + r + 1]; if (x - r >= 0) s -= src[y * W + x - r]; } }
    for (let x = 0; x < W; x += 1) { let s = 0; for (let y = -r; y <= r; y += 1) if (y >= 0 && y < H) s += tmp[y * W + x]; for (let y = 0; y < H; y += 1) { out[y * W + x] = s; if (y + r + 1 < H) s += tmp[(y + r + 1) * W + x]; if (y - r >= 0) s -= tmp[(y - r) * W + x]; } }
    return out;
  };
  const num = box(lum, DELIGHT_PX), den = box(Float32Array.from(cloth), DELIGHT_PX);
  const lums = [];
  for (let i = 0; i < W * H; i += 7) if (cloth[i]) lums.push(lum[i]);
  lums.sort((a, b) => a - b);
  const L0 = lums[Math.floor(lums.length / 2)] || 128;
  const colourAt = (i) => {
    const broad = den[i] > 0 ? num[i] / den[i] : L0, k = Math.min(1.6, Math.max(0.6, L0 / Math.max(1, broad)));
    return [data[i * 4] * k, data[i * 4 + 1] * k, data[i * 4 + 2] * k];
  };
  // coverage of a body point: how many of the views that face it see cloth there
  const coverage = (i) => {
    let s = 0, w = 0;
    const p = [bodyPos[i * 3], bodyPos[i * 3 + 1], bodyPos[i * 3 + 2]];
    for (const v of views) {
      if (!v) continue;
      const f = n[i * 3] * v.d[0] + n[i * 3 + 2] * v.d[2];
      if (f <= 0.15) continue;
      const px = v.at(p);
      if (px === null || Math.floor(px / W) < v.neckRow) continue;
      const wt = f ** 4;
      s += wt * cloth[px]; w += wt;
    }
    return w > 0 ? s / w : 0;
  };
  return { W, H, views, cloth, colourAt, coverage, data };
}

/**
 * Bakes a body-sheet garment's colour (the drawing's own, light taken out) onto its
 * cloth: every texel found on the cloth and coloured by the views that face it.
 */
export async function paintFromBodySheet({ doc, material, sheet, x, n, uv, faces, log = () => {} }) {
  const T = TEXTURE;
  const col = new Float32Array(T * T * 3).fill(NaN);
  const p = [0, 0, 0], q = [0, 0, 0];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    const ua = uv[a * 2] * T, va = uv[a * 2 + 1] * T, ub = uv[b * 2] * T, vb = uv[b * 2 + 1] * T, uc = uv[c * 2] * T, vc = uv[c * 2 + 1] * T;
    const area = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (Math.abs(area) < 1e-9) continue;
    const minU = Math.max(0, Math.floor(Math.min(ua, ub, uc))), maxU = Math.min(T - 1, Math.ceil(Math.max(ua, ub, uc)));
    const minV = Math.max(0, Math.floor(Math.min(va, vb, vc))), maxV = Math.min(T - 1, Math.ceil(Math.max(va, vb, vc)));
    for (let ty = minV; ty <= maxV; ty += 1) for (let tx = minU; tx <= maxU; tx += 1) {
      const px = tx + 0.5, py = ty + 0.5;
      const w1 = ((ub - px) * (vc - py) - (uc - px) * (vb - py)) / area, w2 = ((uc - px) * (va - py) - (ua - px) * (vc - py)) / area, w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      for (let k = 0; k < 3; k += 1) { p[k] = x[a * 3 + k] * w1 + x[b * 3 + k] * w2 + x[c * 3 + k] * w3; q[k] = n[a * 3 + k] * w1 + n[b * 3 + k] * w2 + n[c * 3 + k] * w3; }
      const acc = [0, 0, 0];
      let ws = 0;
      for (const v of sheet.views) {
        if (!v) continue;
        const fc = q[0] * v.d[0] + q[2] * v.d[2];
        if (fc <= 0.1) continue;
        const pix = v.at(p);
        if (pix === null || !sheet.cloth[pix]) continue;
        const c3 = sheet.colourAt(pix), w = fc ** VIEW_SHARPNESS;
        for (let k = 0; k < 3; k += 1) acc[k] += c3[k] * w;
        ws += w;
      }
      if (ws > 0) for (let k = 0; k < 3; k += 1) col[(ty * T + tx) * 3 + k] = acc[k] / ws;
    }
  }
  // texels no view saw take their neighbours' colour; then the islands are bled out
  for (let pass = 0; pass < 24; pass += 1) {
    const next = Float32Array.from(col);
    let open = 0;
    for (let i = 0; i < T * T; i += 1) {
      if (!Number.isNaN(col[i * 3])) continue;
      const tx = i % T, ty = (i / T) | 0;
      const s = [0, 0, 0];
      let c = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = tx + ox, Y = ty + oy;
        if (X < 0 || Y < 0 || X >= T || Y >= T) continue;
        const j = Y * T + X;
        if (!Number.isNaN(col[j * 3])) { for (let k = 0; k < 3; k += 1) s[k] += col[j * 3 + k]; c += 1; }
      }
      if (c) for (let k = 0; k < 3; k += 1) next[i * 3 + k] = s[k] / c; else open += 1;
    }
    col.set(next);
    if (!open) break;
  }
  const rgb = Buffer.alloc(T * T * 3);
  for (let i = 0; i < T * T * 3; i += 1) rgb[i] = Number.isNaN(col[i]) ? 128 : Math.round(Math.min(255, Math.max(0, col[i])));
  const png = await sharp(rgb, { raw: { width: T, height: T, channels: 3 } }).png().toBuffer();
  const tex = doc.createTexture(`${material.getName()}-colour`).setImage(png).setMimeType('image/png');
  material.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(tex);
  log(`painted from ${sheet.file ?? 'a body sheet'}: ${sheet.views.filter(Boolean).length} of ${VIEWS.length} views fitted by the body's outline`);
}

/**
 * A plain garment with a trim: the fabric colour, and `trim` along every edge,
 * `width` metres in from it. `f` is the garment's own edge field at each vertex
 * (zero on the edge, metres inside), read between vertices texel by texel, so the
 * trim's inner line is as smooth as the cut.
 */
export async function paintTrim({ doc, material, colour, trim, width, f, uv, faces, log = () => {} }) {
  const T = TEXTURE;
  const val = new Float32Array(T * T).fill(NaN);
  for (let k = 0; k < faces.length; k += 3) {
    const a = faces[k], b = faces[k + 1], c = faces[k + 2];
    const ua = uv[a * 2] * T, va = uv[a * 2 + 1] * T, ub = uv[b * 2] * T, vb = uv[b * 2 + 1] * T, uc = uv[c * 2] * T, vc = uv[c * 2 + 1] * T;
    const area = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (Math.abs(area) < 1e-9) continue;
    const minU = Math.max(0, Math.floor(Math.min(ua, ub, uc))), maxU = Math.min(T - 1, Math.ceil(Math.max(ua, ub, uc)));
    const minV = Math.max(0, Math.floor(Math.min(va, vb, vc))), maxV = Math.min(T - 1, Math.ceil(Math.max(va, vb, vc)));
    for (let ty = minV; ty <= maxV; ty += 1) for (let tx = minU; tx <= maxU; tx += 1) {
      const px = tx + 0.5, py = ty + 0.5;
      const w1 = ((ub - px) * (vc - py) - (uc - px) * (vb - py)) / area, w2 = ((uc - px) * (va - py) - (ua - px) * (vc - py)) / area, w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      val[ty * T + tx] = f[a] * w1 + f[b] * w2 + f[c] * w3;
    }
  }
  for (let pass = 0; pass < 8; pass += 1) {
    const next = Float32Array.from(val);
    for (let i = 0; i < T * T; i += 1) {
      if (!Number.isNaN(val[i])) continue;
      const tx = i % T, ty = (i / T) | 0;
      let s = 0, c = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = tx + ox, Y = ty + oy; if (X >= 0 && Y >= 0 && X < T && Y < T && !Number.isNaN(val[Y * T + X])) { s += val[Y * T + X]; c += 1; } }
      if (c) next[i] = s / c;
    }
    val.set(next);
  }
  const toS = (cl) => Math.round(255 * Math.min(1, Math.max(0, cl <= 0.0031308 ? cl * 12.92 : 1.055 * cl ** (1 / 2.4) - 0.055)));
  const rgb = Buffer.alloc(T * T * 3);
  for (let i = 0; i < T * T; i += 1) {
    const v = Number.isNaN(val[i]) ? 1 : val[i];
    // a soft step a millimetre wide, so the trim's edge is clean, not stair-stepped
    const t = Math.min(1, Math.max(0, (v - width + 0.0008) / 0.0016));
    for (let k = 0; k < 3; k += 1) rgb[i * 3 + k] = toS(trim[k] * (1 - t) + colour[k] * t);
  }
  const png = await sharp(rgb, { raw: { width: T, height: T, channels: 3 } }).png().toBuffer();
  material.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(doc.createTexture(`${material.getName()}-colour`).setImage(png).setMimeType('image/png'));
  log(`trimmed ${(width * 1000).toFixed(0)} mm at every edge`);
}
