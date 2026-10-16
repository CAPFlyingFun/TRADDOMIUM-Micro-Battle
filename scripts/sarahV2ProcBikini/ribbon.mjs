// RIBBON: a reusable path-and-ribbon generator (bikini trim now; seams, belts, cords later).
// Pure geometry, no glTF: a path is an array of [x,y,z]; a surface is { nearest(p) -> {q, n, dist} }.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), nrm = (a) => scl(a, 1 / (len(a) || 1));
export const V = { sub, add, scl, dot, cross, len, nrm };

/** Centripetal Catmull-Rom through control points (open or closed), sampled every `step` metres. */
export function spline(points, { closed = false, step = 0.002 } = {}) {
  const P = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i += 1) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const t01 = Math.sqrt(len(sub(p1, p0))) || 1e-4, t12 = Math.sqrt(len(sub(p2, p1))) || 1e-4, t23 = Math.sqrt(len(sub(p3, p2))) || 1e-4;
    const m1 = scl(add(sub(scl(sub(p1, p0), 1 / t01), scl(sub(p2, p0), 1 / (t01 + t12))), scl(sub(p2, p1), 1 / t12)), t12);
    const m2 = scl(add(sub(scl(sub(p2, p1), 1 / t12), scl(sub(p3, p1), 1 / (t12 + t23))), scl(sub(p3, p2), 1 / t23)), t12);
    const segLen = len(sub(p2, p1)), n = Math.max(2, Math.ceil(segLen / step));
    for (let k = 0; k < n; k += 1) { const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push(add(add(add(scl(p1, 2 * t3 - 3 * t2 + 1), scl(m1, t3 - 2 * t2 + t)), scl(p2, -2 * t3 + 3 * t2)), scl(m2, t3 - t2))); }
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/** Even resampling by arc length. */
export function resample(path, step, closed = false) {
  const pts = closed ? [...path, path[0]] : path, out = [pts[0]]; let carry = 0;
  for (let k = 1; k < pts.length; k += 1) { const a = pts[k - 1], b = pts[k], s = len(sub(b, a)); let t = step - carry; while (t <= s) { out.push(add(a, scl(sub(b, a), t / s))); t += step; } carry = s - (t - step); }
  if (!closed) out.push(pts[pts.length - 1]); else if (len(sub(out[out.length - 1], out[0])) < step * 0.5) out.pop();
  return out;
}

/**
 * Lay a path on a surface WITHOUT its small bumps: alternately smooth the path (Taubin, so it keeps
 * its length) and hold it `clear` off the surface along the surface normal. `pin(i)` -> 0..1 fixes
 * anchors (1 = never moves). Returns the path and the smoothed surface normal at each point.
 */
export function layOnSurface(path, surface, { clear = 0.001, rounds = 60, closed = false, pin = () => 0, hug = 1 } = {}) {
  let p = path.map((v) => v.slice()); const n = p.length;
  const nb = (i, d) => (closed ? p[(i + d + n) % n] : p[Math.min(n - 1, Math.max(0, i + d))]);
  for (let r = 0; r < rounds; r += 1) {
    for (const lam of [0.5, -0.53]) { const nx = p.map((v, i) => { const w = 1 - pin(i); if (!w || (!closed && (i === 0 || i === n - 1))) return v; const m = scl(add(nb(i, -1), nb(i, 1)), 0.5); return add(v, scl(sub(m, v), lam * w)); }); p = nx; }
    p = p.map((v, i) => { const q = surface.nearest(v); if (!q) return v; const c = typeof clear === 'function' ? clear(i) : clear; const want = add(q.q, scl(q.n, c)); const w = (1 - pin(i)) * (typeof hug === 'function' ? hug(i) : hug); const d = q.dist; return d < c ? want : add(v, scl(sub(want, v), w * 0.5)); });
  }
  // normals along the path, smoothed so the ribbon cannot flick
  let N = p.map((v) => (surface.nearest(v)?.n ?? [0, 0, 1]));
  for (let r = 0; r < 10; r += 1) N = N.map((v, i) => nrm(add(scl(v, 2), add(i > 0 || closed ? N[(i - 1 + n) % n] : v, i < n - 1 || closed ? N[(i + 1) % n] : v))));
  return { path: p, normals: N };
}

/**
 * Sweep a FLAT ribbon with rounded edges along a path. `width(i)` and `thickness` in metres; the flat
 * face lies on the surface normal `normals[i]`, made perpendicular to the tangent at every ring, so the
 * ribbon follows the surface and cannot twist about its own length. Returns { positions, indices, centres, ringSize }.
 */
export function sweepRibbon(path, normals, { width = 0.002, thickness = 0.0005, closed = false, seg = 12 } = {}) {
  const n = path.length, W = typeof width === 'function' ? width : () => width, pos = [], centres = [], idx = [];
  // cross-section: a stadium (flat faces, round ends) traced round its perimeter
  const prof = []; const r = thickness / 2, half = (k) => Math.max(0, W(k) / 2 - r);
  for (let i = 0; i < n; i += 1) {
    const prev = closed ? path[(i - 1 + n) % n] : path[Math.max(0, i - 1)], next = closed ? path[(i + 1) % n] : path[Math.min(n - 1, i + 1)];
    const t = nrm(sub(next, prev)); let up = normals[i]; up = nrm(sub(up, scl(t, dot(up, t)))); const side = nrm(cross(t, up));
    const h = half(i);
    for (let s = 0; s < seg; s += 1) {
      const a = (s / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      // stadium: round ends of radius r at +/-h along `side`
      const x = (c >= 0 ? h : -h) + r * c, y = r * sn;
      pos.push(add(path[i], add(scl(side, x), scl(up, y))));
      centres.push(path[i]);
    }
  }
  const rings = closed ? n : n - 1;
  for (let k = 0; k < rings; k += 1) { const k2 = (k + 1) % n; for (let s = 0; s < seg; s += 1) { const a = k * seg + s, b = k * seg + ((s + 1) % seg), c = k2 * seg + s, d = k2 * seg + ((s + 1) % seg); idx.push(a, c, b, b, c, d); } }
  if (!closed) { // end caps
    for (const [k, flip] of [[0, true], [n - 1, false]]) { const base = k * seg; for (let s = 1; s < seg - 1; s += 1) flip ? idx.push(base, base + s + 1, base + s) : idx.push(base, base + s, base + s + 1); }
  }
  return { positions: pos, indices: idx, centres, ringSize: seg };
}
