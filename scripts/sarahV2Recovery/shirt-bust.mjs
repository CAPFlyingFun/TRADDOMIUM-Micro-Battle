/**
 * THE MODELLED TEE OVER EVERY BREAST SHAPE (Joshua, 2026-10-23, of ChatGPT's preview: its breast slider "spoiled the
 * shirt"). The spandex tee was fitted at five belly sizes, before the breast sliders existed; each of its breast shapes
 * is the body's own offset at the one skin triangle a shirt point was bound to. Where the cloth bridges a hollow (the
 * cleavage, the fold under each breast) it is bound to the skin deep in the hollow, so when the breasts grow the hollow
 * deepens and the cloth follows it in: a crease across the bust.
 *
 * Cloth does not follow skin into a hollow; it rests on what stands out. So each breast shape is laid again:
 *
 * 1. SMOOTHED over the cloth (each point toward the mean of its neighbours, welded across UV seams), so no point moves
 *    differently from the cloth around it.
 * 2. HELD OUT. For each point, how far it stands off her skin at rest is measured; at the shape, it is kept at least
 *    that far off the grown skin, pushed out along the skin's normal where it would come closer (a point already a
 *    little inside her at rest is only kept from going deeper).
 * 3. Smoothed lightly and held out once more, then its light normals recomputed from the cloth itself.
 *
 * A shape is laid in its CONTEXT: `shape:breastGrowMore` only ever runs on top of `breastGrow` at its full weight, so it
 * is laid with the cloth and the skin already grown.
 */

/** One id per distinct position, so cloth split at a UV seam moves as one. */
export function weld(P, grid = 1e6) {
  const ids = new Int32Array(P.length / 3), map = new Map();
  for (let v = 0; v < ids.length; v++) {
    const key = `${Math.round(P[v * 3] * grid)},${Math.round(P[v * 3 + 1] * grid)},${Math.round(P[v * 3 + 2] * grid)}`;
    let id = map.get(key);
    if (id === undefined) map.set(key, (id = map.size));
    ids[v] = id;
  }
  return { ids, count: map.size };
}

/** Neighbours of every welded point, from the triangles' edges (compressed rows). */
export function neighbours(index, ids, count) {
  const sets = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = ids[index[t + e]], b = ids[index[t + (e + 1) % 3]];
    if (a !== b) { sets[a].add(b); sets[b].add(a); }
  }
  const start = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) start[i + 1] = start[i] + sets[i].size;
  const list = new Int32Array(start[count]);
  sets.forEach((s, i) => { let o = start[i]; for (const j of s) list[o++] = j; });
  return { start, list };
}

/** Area-weighted normals of welded points. */
export function weldedNormals(X, index, ids, count) {
  const n = new Float64Array(count * 3);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [index[t], index[t + 1], index[t + 2]]) { const w = ids[v] * 3; n[w] += nx; n[w + 1] += ny; n[w + 2] += nz; }
  }
  for (let i = 0; i < count; i++) { const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1; n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l; }
  return n;
}

/** Closest point on a triangle (Ericson), as barycentric weights into `out`; returns the squared distance. */
function closest(px, py, pz, X, a, b, c, out) {
  const ax = X[a], ay = X[a + 1], az = X[a + 2];
  const abx = X[b] - ax, aby = X[b + 1] - ay, abz = X[b + 2] - az, acx = X[c] - ax, acy = X[c + 1] - ay, acz = X[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let v = 0, w = 0;
  if (!(d1 <= 0 && d2 <= 0)) {
    const bpx = px - X[b], bpy = py - X[b + 1], bpz = pz - X[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - X[c], cpy = py - X[c + 1], cpz = pz - X[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { v = 1; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); }
    else if (d6 >= 0 && d5 <= d6) { w = 1; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; }
    else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; }
  }
  out[0] = 1 - v - w; out[1] = v; out[2] = w;
  const qx = ax + abx * v + acx * w - px, qy = ay + aby * v + acy * w - py, qz = az + abz * v + acz * w - pz;
  return qx * qx + qy * qy + qz * qz;
}

/**
 * A skin surface to stand off: `standOff(p)` is how far p lies outside it along the skin's own normal at the nearest
 * point (negative inside), and that normal. Only the triangles `keep(t)` admits are searched.
 */
export function skinSurface(B, index, keep = () => true, cell = 0.01) {
  const cells = new Map(), key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  const normals = new Float64Array(index.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = B[b] - B[a], uy = B[b + 1] - B[a + 1], uz = B[b + 2] - B[a + 2], vx = B[c] - B[a], vy = B[c + 1] - B[a + 1], vz = B[c + 2] - B[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    normals[t] = nx / l; normals[t + 1] = ny / l; normals[t + 2] = nz / l;
    if (!keep(t)) continue;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(B[a + k], B[b + k], B[c + k]) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(B[a + k], B[b + k], B[c + k]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = key(x, y, z); let list = cells.get(k); if (!list) cells.set(k, (list = [])); list.push(t);
    }
  }
  const bc = [0, 0, 0];
  return function standOff(px, py, pz, reach = 6) {
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
    let best = Infinity, bt = -1, bu = 0, bv = 0, bw = 0;
    for (let r = 0; r <= reach && (bt < 0 || best > ((r - 1) * cell) ** 2); r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
      for (const t of cells.get(key(cx + x, cy + y, cz + z)) ?? []) {
        const d2 = closest(px, py, pz, B, index[t] * 3, index[t + 1] * 3, index[t + 2] * 3, bc);
        if (d2 < best) { best = d2; bt = t; bu = bc[0]; bv = bc[1]; bw = bc[2]; }
      }
    }
    if (bt < 0) return null;
    const a = index[bt] * 3, b = index[bt + 1] * 3, c = index[bt + 2] * 3;
    const qx = B[a] * bu + B[b] * bv + B[c] * bw, qy = B[a + 1] * bu + B[b + 1] * bv + B[c + 1] * bw, qz = B[a + 2] * bu + B[b + 2] * bv + B[c + 2] * bw;
    const nx = normals[bt], ny = normals[bt + 1], nz = normals[bt + 2];
    return { off: (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz, nx, ny, nz, distance: Math.sqrt(best) };
  };
}

/** Add Σ weight × offset to a copy of `base`. */
export function compose(base, offsets, weights) {
  const out = Float64Array.from(base);
  for (const [name, w] of weights) { const d = offsets.get(name); if (!d || !w) continue; for (let i = 0; i < out.length; i++) out[i] += w * d[i]; }
  return out;
}

/**
 * Lay the cloth's breast shapes again. `cloth`: { P (rest positions), index, offsets: Map name → Float32Array }.
 * `skin`: { P (rest positions at the cloth's reference), index, offsets: Map name → Float32Array, keep(t) }.
 * `plan`: [{ name, weight, context: Map name → weight }] in order: each shape is laid at the weight it is used at most,
 * on top of its context, which may name shapes laid before it.
 * Returns Map name → { offsets: Float32Array, normals: Float32Array, report }.
 */
export function layBust(cloth, skin, plan, { smooth = 20, settle = 4, rings = 4, maximumStandOff = 0.03 } = {}) {
  const { ids, count } = weld(cloth.P);
  const { start, list } = neighbours(cloth.index, ids, count);
  const first = new Int32Array(count).fill(-1);
  for (let v = 0; v < ids.length; v++) if (first[ids[v]] < 0) first[ids[v]] = v;
  const laid = new Map(cloth.offsets);
  const results = new Map();
  const restNormals = weldedNormals(cloth.P, cloth.index, ids, count);
  for (const { name, context, weight = 1 } of plan) {
    const stored = cloth.offsets.get(name), skinOffset = skin.offsets.get(name);
    if (!stored || !skinOffset) continue;
    // welded offsets; the points the shape moves, and a few rings round them, are free; everything else stays put
    const d = new Float64Array(count * 3), free = new Uint8Array(count);
    for (let i = 0; i < count; i++) { const v = first[i] * 3; for (let k = 0; k < 3; k++) d[i * 3 + k] = weight * stored[v + k]; if (Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]) > 1e-6) free[i] = 1; }
    for (let r = 0; r < rings; r++) { const grow = []; for (let i = 0; i < count; i++) if (!free[i]) for (let k = start[i]; k < start[i + 1]; k++) if (free[list[k]]) { grow.push(i); break; } for (const i of grow) free[i] = 1; }
    const freeList = []; for (let i = 0; i < count; i++) if (free[i]) freeList.push(i);
    // the cloth and the skin as this shape runs on them, and how far the cloth stands off the skin there
    const clothAt = compose(cloth.P, laid, context), skinAt = compose(skin.P, skin.offsets, context);
    const grown = compose(skinAt, new Map([[name, skinOffset]]), new Map([[name, weight]]));
    const before = skinSurface(skinAt, skin.index, skin.keep), after = skinSurface(grown, skin.index, skin.keep);
    const need = new Float64Array(count);
    for (const i of freeList) { const v = first[i] * 3, s = before(clothAt[v], clothAt[v + 1], clothAt[v + 2]); need[i] = Math.min(maximumStandOff, s ? s.off : 0); }
    const relax = (times) => {
      const next = new Float64Array(d);
      for (let it = 0; it < times; it++) {
        for (const i of freeList) {
          const n = start[i + 1] - start[i]; if (!n) continue;
          let x = 0, y = 0, z = 0; for (let k = start[i]; k < start[i + 1]; k++) { const j = list[k] * 3; x += d[j]; y += d[j + 1]; z += d[j + 2]; }
          next[i * 3] = 0.5 * d[i * 3] + 0.5 * x / n; next[i * 3 + 1] = 0.5 * d[i * 3 + 1] + 0.5 * y / n; next[i * 3 + 2] = 0.5 * d[i * 3 + 2] + 0.5 * z / n;
        }
        d.set(next);
      }
    };
    const holdOut = () => {
      let pushed = 0, most = 0;
      for (const i of freeList) {
        const v = first[i] * 3, px = clothAt[v] + d[i * 3], py = clothAt[v + 1] + d[i * 3 + 1], pz = clothAt[v + 2] + d[i * 3 + 2];
        const s = after(px, py, pz);
        if (!s || s.off >= need[i] || s.distance > maximumStandOff * 2) continue;
        const short = need[i] - s.off;
        d[i * 3] += short * s.nx; d[i * 3 + 1] += short * s.ny; d[i * 3 + 2] += short * s.nz;
        pushed++; most = Math.max(most, short);
      }
      return { pushed, most };
    };
    // how far the stored shape lets the cloth into the grown skin, before and after
    const into = () => { let n = 0, most = 0; for (const i of freeList) { const v = first[i] * 3, s = after(clothAt[v] + d[i * 3], clothAt[v + 1] + d[i * 3 + 1], clothAt[v + 2] + d[i * 3 + 2]); if (s && s.off < need[i] - 1e-5 && s.distance < maximumStandOff * 2) { n++; most = Math.max(most, need[i] - s.off); } } return { n, most }; };
    const was = into();
    relax(smooth); const first1 = holdOut(); relax(settle); holdOut(); relax(1); const last = holdOut();
    const now = into();
    // per vertex again, and the light normals from the cloth itself
    const offsets = new Float32Array(stored.length);
    for (let v = 0; v < ids.length; v++) for (let k = 0; k < 3; k++) offsets[v * 3 + k] = d[ids[v] * 3 + k] / weight;
    const moved = Float64Array.from(cloth.P, (x, i) => x + offsets[i]);
    const movedNormals = weldedNormals(moved, cloth.index, ids, count);
    const normals = new Float32Array(stored.length);
    for (let v = 0; v < ids.length; v++) for (let k = 0; k < 3; k++) normals[v * 3 + k] = movedNormals[ids[v] * 3 + k] - restNormals[ids[v] * 3 + k];
    laid.set(name, offsets);
    results.set(name, { offsets, normals, report: { free: freeList.length, intoBefore: was, intoAfter: now, pushed: first1.pushed, pushedMost: first1.most, lastPush: last } });
  }
  return results;
}
