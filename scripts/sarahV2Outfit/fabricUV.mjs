// FABRIC UVs FOR A GROWN GARMENT, at true size: a pattern piece per side of her body, cut the way
// leggings are cut (two legs, joined at the inseam and up the centre front and back). Each vertex's
// u is its arc round that side's axis (the slice's centroid at its height) and v its height, both in
// TILES (one tile = `tile` metres of fabric), so a texture that is one square of knit lands at its
// real size. Triangles that cross the inseam get their own copies of the seam's vertices.
export function fabricUV(prim, doc, { tile = 0.0254, slice = 0.01, axisSmooth = 6 } = {}) {
  const P = prim.getAttribute('POSITION'), n = P.getCount(), v = [];
  const pos = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) { P.getElement(i, v); pos.set(v, i * 3); }
  const side = (i) => (pos[i * 3] >= 0 ? 1 : -1);
  let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < n; i += 1) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
  const nb = Math.ceil((y1 - y0) / slice) + 1, bin = (y) => Math.min(nb - 1, Math.max(0, Math.round((y - y0) / slice)));
  const axis = {};
  for (const sg of [1, -1]) {
    const sx = new Float64Array(nb), sz = new Float64Array(nb), c = new Float64Array(nb);
    for (let i = 0; i < n; i += 1) if (side(i) === sg) { const b = bin(pos[i * 3 + 1]); sx[b] += pos[i * 3]; sz[b] += pos[i * 3 + 2]; c[b] += 1; }
    let cx = Array.from(sx, (s, b) => (c[b] ? s / c[b] : NaN)), cz = Array.from(sz, (s, b) => (c[b] ? s / c[b] : NaN));
    const fill = (a) => { let last = a.find((x) => !Number.isNaN(x)); return a.map((x) => (Number.isNaN(x) ? last : (last = x))); };
    cx = fill(cx); cz = fill(cz);
    for (let r = 0; r < axisSmooth; r += 1) { cx = cx.map((x, b) => (cx[Math.max(0, b - 1)] + 2 * x + cx[Math.min(nb - 1, b + 1)]) / 4); cz = cz.map((x, b) => (cz[Math.max(0, b - 1)] + 2 * x + cz[Math.min(nb - 1, b + 1)]) / 4); }
    // the slice's radius, smoothed, so u is true arc length at every height
    const rs = new Float64Array(nb), rc = new Float64Array(nb);
    for (let i = 0; i < n; i += 1) if (side(i) === sg) { const b = bin(pos[i * 3 + 1]); rs[b] += Math.hypot(pos[i * 3] - cx[b], pos[i * 3 + 2] - cz[b]); rc[b] += 1; }
    let R = fill(Array.from(rs, (s, b) => (rc[b] ? s / rc[b] : NaN)));
    for (let r = 0; r < axisSmooth * 2; r += 1) R = R.map((x, b) => (R[Math.max(0, b - 1)] + 2 * x + R[Math.min(nb - 1, b + 1)]) / 4);
    axis[sg] = { cx, cz, R };
  }
  // θ from the side's outward direction; the discontinuity (±π) faces her midline: the inseam
  const theta = new Float64Array(n), rad = new Float64Array(n);
  for (let i = 0; i < n; i += 1) { const sg = side(i), b = bin(pos[i * 3 + 1]), A = axis[sg]; theta[i] = Math.atan2(pos[i * 3 + 2] - A.cz[b], sg * (pos[i * 3] - A.cx[b])); rad[i] = A.R[b]; }
  const uvOf = (i, wrap) => [((theta[i] + (wrap ? 2 * Math.PI : 0)) * rad[i]) / tile, -pos[i * 3 + 1] / tile];
  // split the vertices of triangles that cross the inseam
  const idx = Array.from(prim.getIndices().getArray()), dup = new Map(), extra = [];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]]; const th = tri.map((i) => theta[i]);
    if (Math.max(...th) - Math.min(...th) < Math.PI || new Set(tri.map(side)).size > 1) continue;
    for (let k = 0; k < 3; k += 1) if (th[k] < 0) { const i = tri[k]; if (!dup.has(i)) { dup.set(i, n + extra.length); extra.push(i); } idx[t + k] = dup.get(i); }
  }
  const total = n + extra.length, uv = new Float32Array(total * 2);
  for (let i = 0; i < n; i += 1) uv.set(uvOf(i, false), i * 2);
  extra.forEach((i, k) => uv.set(uvOf(i, true), (n + k) * 2));
  // grow every attribute (and every shape's) by the copies
  const grow = (acc) => { if (!acc) return; const a = acc.getArray(), sz = acc.getElementSize(); const out = new a.constructor(total * sz); out.set(a); extra.forEach((i, k) => { for (let c = 0; c < sz; c += 1) out[(n + k) * sz + c] = a[i * sz + c]; }); acc.setArray(out); };
  for (const s of prim.listSemantics()) if (s !== 'TEXCOORD_0') grow(prim.getAttribute(s));
  for (const tg of prim.listTargets()) for (const s of tg.listSemantics()) grow(tg.getAttribute(s));
  const buf = doc.getRoot().listBuffers()[0];
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(total > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx)).setBuffer(buf));
  return { seamCopies: extra.length, maxR: Math.max(...axis[1].R) };
}
