/**
 * HER VULVA, REBUILT TO OPEN (Joshua, 2026-10-30: "start over on the pushed model... starting with the vagina and
 * making sure it looks and opens properly... and work backwards"). Her model was not built to open there: the skin of
 * that area is an uneven patch of triangles (0.8 to 5.8 mm), split down the middle by a texture seam, and every way of
 * stretching, folding or simulating it came out jagged. So the area is cut out of her body's draw (its index list -- her
 * body file is untouched) and rebuilt from her own skin as a mesh made for it:
 *
 *   - laid out flat (`laidOut`: `u` across her, `s` round her split), the area's outline is her own skin's edge there,
 *     vertex for vertex, so it stitches to her body exactly;
 *   - inside it, RINGS: from the outline in to the split, finer toward the split; every ring has a point for each of the
 *     outline's, so they join square; the innermost ring IS the split -- its two halves are the two lips' edges, apart
 *     in the mesh, touching at rest;
 *   - each new point samples her skin where it lies (which of her triangles, and where in it): her texture, her bones,
 *     her motion shapes, her shape as it is now -- so at rest the area is her skin;
 *   - where her texture is cut into separate pieces (her atlas's seams cross the area), a point is two or more, one for
 *     each piece, the way her own seams are: the same place, its own texture coordinate.
 *
 * This file is the plain part (numbers in, numbers out); `vulvaMesh.ts` lays it on her. Everything in her REST frame
 * (metres, +y up, +z her front, +x her left), as birthArea.ts.
 */
import { BIRTH_AREA } from './birthArea';

/** GAME TUNING, measured on her (the crotch surface round her split; birthArea.ts). */
export const VULVA = Object.freeze({
  /** the area: how far over her skin from the split's middle it reaches (metres, measured along her skin) -- far
   * enough for the skin a crowning head domes out (Joshua's references, 2026-10-30: the dome's base is wide) */
  reach: 0.17,
  /** ...and how far from it seen straight on (metres) */
  round: 0.1,
  /** where the split's middle is: round the middle the cleft runs round, at this distance from it (metres) */
  shell: 0.047,
  /** half the split's length (metres, along her skin): her groove, front to back */
  splitHalf: 0.037,
  /** rings from the split out, and how much finer they are toward the split (a power) */
  rings: 32, fine: 1.5,
});

/** The middle of her split, round the middle the cleft runs round (radians). */
const MIDDLE = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180;

/** A point of her laid out flat: across her (`u`), round her split from its middle (`s`, at the skin's distance), how far from the middle (`r`). */
export function laidOut(x: number, y: number, z: number, centre: { y: number; z: number }): { u: number; s: number; r: number } {
  const dy = y - centre.y, dz = z - centre.z, ang = Math.atan2(dz, -dy);
  return { u: x, s: BIRTH_AREA.centreUp * (ang - MIDDLE), r: Math.hypot(dy, dz) };
}

export interface VulvaBake {
  /** her body's triangles without the area's */
  readonly keep: Uint32Array;
  /** the area's own triangles of her body (the ones it is drawn in place of) */
  readonly area: Uint32Array;
  /** how many vertices the rebuilt area has */
  readonly count: number;
  /** each vertex: where it is -- three of her vertices and how much of each (it lies in that triangle of hers) */
  readonly src: Uint32Array;
  readonly bary: Float32Array;
  /** each vertex: its texture coordinate -- three of her vertices and how much of each (may reach past the triangle) */
  readonly uvSrc: Uint32Array;
  readonly uvBary: Float32Array;
  /** each vertex: its ring (0 the split .. rings the outline), its column, its place laid out flat (u, s) */
  readonly ring: Uint16Array;
  readonly column: Uint16Array;
  readonly flat: Float32Array;
  /** each vertex: which lip's edge it is on the split (-1 her right, +1 her left, 0 a tip or not on the split) */
  readonly lip: Int8Array;
  /** the rebuilt area's triangles */
  readonly index: Uint32Array;
  /** for checking: the outline's length in points, and how many points sampled no triangle of hers */
  readonly outline: number;
  readonly missed: number;
  /** the split laid out flat: its middle and its two ends (flat units are close to metres over her skin) */
  readonly split: { readonly u: number; readonly mid: number; readonly back: number; readonly front: number };
  /** her skin at a place laid out flat: three of her vertices and how much of each (into `out`, 6 numbers) */
  sampleFlat(u: number, s: number, out: Float64Array): void;
}

/**
 * Cut and rebuild. `rest`: her points in her rest frame (metres, 3 each); `key`: a key per vertex that is the same for
 * every vertex at one point (her seams); `indices`: her triangles.
 */
export function bakeVulva(rest: ArrayLike<number>, key: ArrayLike<number>, indices: ArrayLike<number>, centre: { y: number; z: number }, leg?: ArrayLike<number>): VulvaBake {
  const V = VULVA, n = Math.floor(rest.length / 3);
  // her points (a seam's vertices welded into one), where each is, and the split's middle: the point on her middle
  // nearest where the cleft's middle meets her skin
  let nK = 0;
  for (let i = 0; i < n; i++) nK = Math.max(nK, key[i] + 1);
  const KP = new Float64Array(nK * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) KP[key[i] * 3 + c] = rest[i * 3 + c];
  const ty = centre.y - V.shell * Math.cos(MIDDLE), tz = centre.z + V.shell * Math.sin(MIDDLE);
  let mid = -1, md = Infinity;
  for (let i = 0; i < n; i++) {
    if (Math.abs(rest[i * 3]) > 1e-4) continue;
    const d = Math.hypot(rest[i * 3 + 1] - ty, rest[i * 3 + 2] - tz);
    if (d < md) { md = d; mid = key[i]; }
  }
  // how far each point is from it over her skin (along her triangles' edges), out to a little past the area
  const T = Math.floor(indices.length / 3), mx = KP[mid * 3], my = KP[mid * 3 + 1], mz = KP[mid * 3 + 2];
  const nearMid = (k: number) => Math.hypot(KP[k * 3] - mx, KP[k * 3 + 1] - my, KP[k * 3 + 2] - mz) < 2 * V.reach;
  const nbr = new Map<number, Map<number, number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const l = Math.hypot(KP[a * 3] - KP[b * 3], KP[a * 3 + 1] - KP[b * 3 + 1], KP[a * 3 + 2] - KP[b * 3 + 2]);
    (nbr.get(a) ?? nbr.set(a, new Map()).get(a)!).set(b, l); (nbr.get(b) ?? nbr.set(b, new Map()).get(b)!).set(a, l);
  };
  for (let t = 0; t < T; t++) {
    const a = key[indices[t * 3]], b = key[indices[t * 3 + 1]], c = key[indices[t * 3 + 2]];
    if (nearMid(a) && nearMid(b) && nearMid(c)) { link(a, b); link(b, c); link(c, a); }
  }
  const dist = new Float64Array(nK).fill(Infinity);
  { // Dijkstra, a small binary heap
    const heap: [number, number][] = [[0, mid]]; dist[mid] = 0;
    const push = (e: [number, number]) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, k] = pop();
      if (d > dist[k] || d > 1.4 * V.reach) continue;
      // (not on through her legs' skin: what lies beyond it is hers, not the area's -- so it is cut off, not ringed round)
      if (leg && leg[k] && k !== mid) continue;
      for (const [o, l] of nbr.get(k) ?? []) if (d + l < dist[o]) { dist[o] = d + l; push([d + l, o]); }
    }
  }
  // the area's triangles: all three points in it; then its edge evened out -- a triangle in a notch of it (two of its
  // edges on the area) is taken in, a spike (two of its edges on the outside) is left out -- so the outline is smooth
  // at the size of her triangles, not their zig-zag
  const sel = new Uint8Array(T);
  // ...and no further from the split's middle, seen straight on, than `round` (so it does not run up the creases at her
  // thighs, which an opening would pull along: Joshua's wireframe look, 2026-10-30)
  const ox = my - centre.y, oz = mz - centre.z, ol = Math.hypot(ox, oz) || 1, ny = ox / ol, nz = oz / ol;
  const across2 = (k: number) => { const dx = KP[k * 3] - mx, dy = KP[k * 3 + 1] - my, dz = KP[k * 3 + 2] - mz, h = dy * ny + dz * nz; return Math.hypot(dx, dy - h * ny, dz - h * nz); };
  // (and none of her legs' skin, when it is named: `leg` by point, 1 a leg's)
  const inK = (k: number) => dist[k] < V.reach && across2(k) < V.round && !(leg && leg[k]), nearK = (k: number) => dist[k] < 1.3 * V.reach && across2(k) < 1.3 * V.round;
  const edgeTris = new Map<string, number[]>();
  const pk = (a: number, b: number) => (key[a] < key[b] ? `${key[a]},${key[b]}` : `${key[b]},${key[a]}`);
  for (let t = 0; t < T; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (inK(key[a]) && inK(key[b]) && inK(key[c])) sel[t] = 1;
    if (!(nearK(key[a]) && nearK(key[b]) && nearK(key[c]))) continue;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = pk(x, y); const l = edgeTris.get(k) ?? []; l.push(t); edgeTris.set(k, l); }
  }
  for (let round = 0; round < 6; round++) {
    let changed = 0;
    for (let t = 0; t < T; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      if (!(nearK(key[a]) && nearK(key[b]) && nearK(key[c]))) continue;
      let inner = 0;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) if ((edgeTris.get(pk(x, y)) ?? []).some((o) => o !== t && sel[o])) inner++;
      if (!sel[t] && inner >= 2) { sel[t] = 1; changed++; } else if (sel[t] && inner <= 1) { sel[t] = 0; changed++; }
    }
    if (!changed) break;
  }
  const tris: number[] = [], keep: number[] = [];
  for (let t = 0; t < T; t++) (sel[t] ? tris : keep).push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);

  // its outline: edges (by point, seams welded) only one of its triangles has, chained into loops; the longest is it
  const count = new Map<string, number>(), dir = new Map<string, [number, number]>();
  const ek = (a: number, b: number) => (key[a] < key[b] ? `${key[a]},${key[b]}` : `${key[b]},${key[a]}`);
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k], b = tris[t + ((k + 1) % 3)], e = ek(a, b);
    count.set(e, (count.get(e) ?? 0) + 1); dir.set(e, [a, b]);
  }
  const next = new Map<number, number>(), vertexOf = new Map<number, number[]>();
  const note = (v: number) => { const l = vertexOf.get(key[v]) ?? []; if (!l.includes(v)) l.push(v); vertexOf.set(key[v], l); };
  for (const [e, c] of count) if (c === 1) { const [a, b] = dir.get(e)!; next.set(key[a], key[b]); note(a); note(b); }
  const seen = new Set<number>(), loops: number[][] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let p = start;
    for (let guard = 0; guard < 100000 && !seen.has(p); guard++) { seen.add(p); loop.push(p); const q = next.get(p); if (q === undefined) break; p = q; }
    loops.push(loop);
  }
  loops.sort((a, b) => b.length - a.length);
  const outlineKeys = loops[0] ?? [];

  // LAID OUT FLAT, the way a soap film would lie (a harmonic map): the outline round a circle by its length, her middle
  // where it crosses the outline at the circle's front and back, every other point where its neighbours pull it (mean
  // value weights, so nothing folds); the area keeps her proportions closely enough for the rings to be even
  const U = new Float64Array(n), S = new Float64Array(n);
  const FU = new Float64Array(nK), FS = new Float64Array(nK), fixed = new Uint8Array(nK), inArea = new Uint8Array(nK);
  for (const v of tris) inArea[key[v]] = 1;
  function laidOutS(k: number): number { return laidOut(KP[k * 3], KP[k * 3 + 1], KP[k * 3 + 2], centre).s; }
  const Mo = outlineKeys.length;
  const crossing = (behind: boolean) => { let best = 0, bx = Infinity; for (let j = 0; j < Mo; j++) { const k = outlineKeys[j]; if ((laidOutS(k) < 0) === behind && Math.abs(KP[k * 3]) < bx) { bx = Math.abs(KP[k * 3]); best = j; } } return best; };
  const cb = crossing(true), cf = crossing(false);
  const olen = [0];
  for (let j = 1; j <= Mo; j++) { const a = outlineKeys[(cb + j - 1) % Mo], b = outlineKeys[(cb + j) % Mo]; olen.push(olen[j - 1] + Math.hypot(KP[a * 3] - KP[b * 3], KP[a * 3 + 1] - KP[b * 3 + 1], KP[a * 3 + 2] - KP[b * 3 + 2])); }
  const jfo = (cf - cb + Mo) % Mo, Rf = olen[Mo] / (2 * Math.PI);
  const sideOf = (from: number, to: number) => { let sx = 0; for (let j = from; j < to; j++) sx += KP[outlineKeys[(cb + j) % Mo] * 3]; return Math.sign(sx) || 1; };
  const sd1 = sideOf(1, jfo), sd2 = sideOf(jfo + 1, Mo);
  for (let j = 0; j < Mo; j++) {
    const k = outlineKeys[(cb + j) % Mo];
    const th = j <= jfo ? Math.PI * (1 - olen[j] / olen[jfo]) : Math.PI * ((olen[j] - olen[jfo]) / (olen[Mo] - olen[jfo]));
    const sd = j <= jfo ? sd1 : sd2;
    FU[k] = sd * Rf * Math.sin(th); FS[k] = Rf * Math.cos(th); fixed[k] = 1;
  }
  // mean value weights, from her rest shape
  const W = new Map<number, Map<number, number>>();
  const addW = (a: number, b: number, w: number) => { const m = W.get(a) ?? W.set(a, new Map()).get(a)!; m.set(b, (m.get(b) ?? 0) + w); };
  for (let t = 0; t < tris.length; t += 3) {
    const k3 = [key[tris[t]], key[tris[t + 1]], key[tris[t + 2]]];
    for (let c = 0; c < 3; c++) {
      const i = k3[c], j = k3[(c + 1) % 3], k = k3[(c + 2) % 3];
      const ex = [KP[j * 3] - KP[i * 3], KP[j * 3 + 1] - KP[i * 3 + 1], KP[j * 3 + 2] - KP[i * 3 + 2]], fx = [KP[k * 3] - KP[i * 3], KP[k * 3 + 1] - KP[i * 3 + 1], KP[k * 3 + 2] - KP[i * 3 + 2]];
      const le = Math.hypot(ex[0], ex[1], ex[2]), lf = Math.hypot(fx[0], fx[1], fx[2]);
      if (le < 1e-9 || lf < 1e-9) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (ex[0] * fx[0] + ex[1] * fx[1] + ex[2] * fx[2]) / (le * lf)))), h = Math.tan(ang / 2);
      addW(i, j, h / le); addW(i, k, h / lf);
    }
  }
  const free: number[] = [];
  for (let k = 0; k < nK; k++) if (inArea[k] && !fixed[k]) {
    free.push(k);
    // a start: as it lies round the cleft, scaled to the circle
    const q = laidOut(KP[k * 3], KP[k * 3 + 1], KP[k * 3 + 2], centre); FU[k] = q.u; FS[k] = q.s;
  }
  for (let it = 0; it < 3000; it++) {
    let moved = 0;
    for (const k of free) {
      let su = 0, ss = 0, sw = 0;
      for (const [o, w] of W.get(k) ?? []) { su += w * FU[o]; ss += w * FS[o]; sw += w; }
      if (sw <= 0) continue;
      const nu = FU[k] + 1.6 * (su / sw - FU[k]), ns = FS[k] + 1.6 * (ss / sw - FS[k]);
      moved = Math.max(moved, Math.abs(nu - FU[k]), Math.abs(ns - FS[k]));
      FU[k] = nu; FS[k] = ns;
    }
    if (moved < 1e-9) break;
  }
  for (let i = 0; i < n; i++) if (inArea[key[i]]) { U[i] = FU[key[i]]; S[i] = FS[key[i]]; }
  const splitMid = { u: FU[mid], s: FS[mid] };

  // the pieces of her texture: triangles joined by a shared vertex (a seam's two sides are two vertices)
  const up = new Map<number, number>();
  const find = (x: number): number => { let r = x; while (up.has(r) && up.get(r) !== r) r = up.get(r)!; up.set(x, r); return r; };
  for (let t = 0; t < tris.length; t += 3) { const r = find(tris[t]); up.set(find(tris[t + 1]), r); up.set(find(tris[t + 2]), find(r)); }
  const chartOfVertex = (v: number) => find(v);
  const chartOfTri = (t: number) => find(tris[t]);

  // where a point lies among her triangles (a grid of buckets over them, laid out flat)
  const cell = 0.004, grid = new Map<string, number[]>();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const u0 = Math.min(U[a], U[b], U[c]), u1 = Math.max(U[a], U[b], U[c]), s0 = Math.min(S[a], S[b], S[c]), s1 = Math.max(S[a], S[b], S[c]);
    for (let gu = Math.floor(u0 / cell); gu <= Math.floor(u1 / cell); gu++) for (let gs = Math.floor(s0 / cell); gs <= Math.floor(s1 / cell); gs++) {
      const k = `${gu},${gs}`; const l = grid.get(k) ?? []; l.push(t); grid.set(k, l);
    }
  }
  let missed = 0;
  /** the triangle of hers (in `chart`, or any) holding (u, s), or the nearest; its weights clamped or not */
  const locate = (u: number, s: number, chart: number | null, clamp: boolean): { t: number; w: [number, number, number]; out: number } => {
    let bt = -1, bw: [number, number, number] = [1, 0, 0], bo = Infinity;
    for (let reach = 1; reach <= 3 && bt < 0; reach++) {
      for (let du = -reach; du <= reach; du++) for (let ds = -reach; ds <= reach; ds++) {
        for (const t of grid.get(`${Math.floor(u / cell) + du},${Math.floor(s / cell) + ds}`) ?? []) {
          if (chart !== null && chartOfTri(t) !== chart) continue;
          const a = tris[t], b = tris[t + 1], c = tris[t + 2];
          const d = (S[b] - S[c]) * (U[a] - U[c]) + (U[c] - U[b]) * (S[a] - S[c]);
          if (Math.abs(d) < 1e-14) continue;
          const wa = ((S[b] - S[c]) * (u - U[c]) + (U[c] - U[b]) * (s - S[c])) / d, wb = ((S[c] - S[a]) * (u - U[c]) + (U[a] - U[c]) * (s - S[c])) / d, wc = 1 - wa - wb;
          const out = Math.max(0, -wa, -wb, -wc);
          if (out < bo) { bo = out; bt = t; bw = [wa, wb, wc]; }
        }
      }
    }
    if (bt < 0) return { t: 0, w: [1, 0, 0], out: Infinity };
    if (clamp) { const c = bw.map((x) => Math.max(0, x)) as [number, number, number], sum = c[0] + c[1] + c[2] || 1; bw = [c[0] / sum, c[1] / sum, c[2] / sum]; }
    return { t: bt, w: bw, out: bo };
  };

  const pts = (loops[0] ?? []).map((k) => { const verts = vertexOf.get(k)!, v = verts[0]; return { u: U[v], s: S[v], verts }; });
  // round the way the angle grows (from her back, her right side first), starting at the column nearest her middle behind
  let area = 0;
  for (let j = 0; j < pts.length; j++) { const a = pts[j], b = pts[(j + 1) % pts.length]; area += a.s * b.u - b.s * a.u; }
  if (area < 0) pts.reverse();
  const M = pts.length;
  const nearestMiddle = (behind: boolean) => { let best = 0, bu = Infinity; for (let j = 0; j < M; j++) if ((pts[j].s < 0) === behind && Math.abs(pts[j].u) < bu) { bu = Math.abs(pts[j].u); best = j; } return best; };
  const jb0 = nearestMiddle(true);
  const ring0 = [...pts.slice(jb0), ...pts.slice(0, jb0)];
  const jf = nearestMiddle(false) >= jb0 ? nearestMiddle(false) - jb0 : nearestMiddle(false) - jb0 + M;
  // the split's two ends, laid out flat: along her middle from its middle, as far as half its length over her skin
  const u0m = splitMid.u;
  const skinAt = (u: number, s: number) => { const at = locate(u, s, null, true); let x = 0, y = 0, z = 0; for (let c = 0; c < 3; c++) { const v = tris[at.t + c], w = at.w[c]; x += w * rest[v * 3]; y += w * rest[v * 3 + 1]; z += w * rest[v * 3 + 2]; } return [x, y, z]; };
  const endAt = (dirn: number) => {
    let s = splitMid.s, gone = 0, was = skinAt(u0m, s);
    for (let guard = 0; guard < 4000 && gone < V.splitHalf; guard++) { s += dirn * 0.0002; const now = skinAt(u0m, s); gone += Math.hypot(now[0] - was[0], now[1] - was[1], now[2] - was[2]); was = now; }
    return s;
  };
  const sB = endAt(-1), sF = endAt(1);
  // each column's place along the split: by its outline point's angle round the circle, kept in order along each side;
  // the tips are the columns on her middle
  const splitS: number[] = new Array(M).fill(0), lipSide: number[] = new Array(M).fill(0);
  const sideA = Math.sign(ring0.slice(1, jf).reduce((m, p) => m + p.u, 0)) || -1;
  const along = (o: { u: number; s: number }) => { const q = Math.cos(Math.atan2(Math.abs(o.u - u0m), o.s)); return q >= 0 ? splitMid.s + (sF - splitMid.s) * q : splitMid.s + (splitMid.s - sB) * q; };
  let run = sB;
  for (let j = 0; j <= jf; j++) { run = Math.max(run, along(ring0[j])); splitS[j] = j === 0 ? sB : j === jf ? sF : run; }
  run = sF;
  for (let j = jf; j <= M; j++) { const jj = j % M; run = Math.min(run, along(ring0[jj])); splitS[jj] = jj === 0 ? sB : jj === jf ? sF : run; }
  for (let j = 0; j < M; j++) lipSide[j] = splitS[j] <= sB + 1e-9 || splitS[j] >= sF - 1e-9 ? 0 : j < jf ? sideA : -sideA;

  // the rings, laid out flat: straight from the split to the outline, finer toward the split, then smoothed round each
  // ring so a notch in her outline does not cross the rings inside it
  const R = V.rings, fu: number[][] = [], fs: number[][] = [];
  for (let k = 0; k <= R; k++) {
    const t = Math.pow(k / R, V.fine);
    fu.push(ring0.map((o) => u0m + (o.u - u0m) * t)); fs.push(ring0.map((o, j) => splitS[j] + (o.s - splitS[j]) * t));
  }
  for (let pass = 0; pass < 24; pass++) for (let k = 1; k < R; k++) {
    const a = 0.5 * Math.min(1, 2 * (1 - k / R)) * Math.max(0, (k - 2) / (R - 2)), u0 = fu[k].slice(), s0 = fs[k].slice();
    for (let j = 0; j < M; j++) {
      const jm = (j + M - 1) % M, jp = (j + 1) % M;
      fu[k][j] = (1 - a) * u0[j] + (a / 2) * (u0[jm] + u0[jp]); fs[k][j] = (1 - a) * s0[j] + (a / 2) * (s0[jm] + s0[jp]);
    }
  }

  // and the last few rings smoothed both ways, so they take up the outline's notches (her triangles' own zig-zag)
  for (let pass = 0; pass < 40; pass++) for (let k = R - 3; k < R; k++) for (let j = 0; j < M; j++) {
    const jm = (j + M - 1) % M, jp = (j + 1) % M;
    fu[k][j] = 0.5 * fu[k][j] + 0.125 * (fu[k][jm] + fu[k][jp] + fu[k - 1][j] + fu[k + 1][j]);
    fs[k][j] = 0.5 * fs[k][j] + 0.125 * (fs[k][jm] + fs[k][jp] + fs[k - 1][j] + fs[k + 1][j]);
  }

  // the points: one per ring and column, sampled where they lie; the outline's are her own vertices
  const src: number[] = [], bary: number[] = [], uvSrc: number[] = [], uvBary: number[] = [], ringOf: number[] = [], colOf: number[] = [], flat: number[] = [], lipOf: number[] = [], chartOf: number[] = [];
  const id: number[][] = [];
  const push = (s3: number[], b3: number[], us3: number[], ub3: number[], chart: number, k: number, j: number, u: number, s: number, lip: number) => {
    src.push(...s3); bary.push(...b3); uvSrc.push(...us3); uvBary.push(...ub3); chartOf.push(chart);
    ringOf.push(k); colOf.push(j); flat.push(u, s); lipOf.push(lip);
    return ringOf.length - 1;
  };
  for (let k = 0; k <= R; k++) {
    const row: number[] = [];
    for (let j = 0; j < M; j++) {
      const u = k === 0 ? u0m : fu[k][j], s = k === 0 ? splitS[j] : fs[k][j], lip = k === 0 ? lipSide[j] : 0;
      if (k === R) { const v = ring0[j].verts[0]; row.push(push([v, v, v], [1, 0, 0], [v, v, v], [1, 0, 0], chartOfVertex(v), k, j, u, s, 0)); continue; }
      const at = locate(u, s, null, true);
      if (at.out > 0.05) missed++;
      const t3 = [tris[at.t], tris[at.t + 1], tris[at.t + 2]];
      row.push(push(t3, at.w, t3, at.w, chartOfTri(at.t), k, j, u, s, lip));
    }
    id.push(row);
  }
  // a point in another piece of her texture: the same place, the texture coordinate that piece gives it
  const dup = new Map<string, number>();
  const inChart = (p: number, chart: number): number => {
    if (chartOf[p] === chart) return p;
    const k = `${p}:${chart}`;
    if (dup.has(k)) return dup.get(k)!;
    let q: number;
    const twin = ringOf[p] === R ? ring0[colOf[p]].verts.find((v) => chartOfVertex(v) === chart) : undefined;
    const s3 = src.slice(p * 3, p * 3 + 3), b3 = bary.slice(p * 3, p * 3 + 3);
    if (twin !== undefined) q = push(s3, b3, [twin, twin, twin], [1, 0, 0], chart, ringOf[p], colOf[p], flat[p * 2], flat[p * 2 + 1], lipOf[p]);
    else {
      const at = locate(flat[p * 2], flat[p * 2 + 1], chart, false), t3 = [tris[at.t], tris[at.t + 1], tris[at.t + 2]];
      q = push(s3, b3, t3, at.w, chart, ringOf[p], colOf[p], flat[p * 2], flat[p * 2 + 1], lipOf[p]);
    }
    dup.set(k, q);
    return q;
  };
  // the quads between rings, each triangle in the piece of her texture under its middle
  const index: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    const cu = (flat[a * 2] + flat[b * 2] + flat[c * 2]) / 3, cs = (flat[a * 2 + 1] + flat[b * 2 + 1] + flat[c * 2 + 1]) / 3;
    const chart = chartOfTri(locate(cu, cs, null, true).t);
    index.push(inChart(a, chart), inChart(b, chart), inChart(c, chart));
  };
  for (let k = 0; k < R; k++) for (let j = 0; j < M; j++) {
    const j2 = (j + 1) % M, a = id[k][j], b = id[k][j2], c = id[k + 1][j], d = id[k + 1][j2];
    tri(a, b, c); tri(b, d, c);
  }
  return {
    keep: Uint32Array.from(keep), area: Uint32Array.from(tris), count: ringOf.length, src: Uint32Array.from(src), bary: Float32Array.from(bary),
    uvSrc: Uint32Array.from(uvSrc), uvBary: Float32Array.from(uvBary),
    ring: Uint16Array.from(ringOf), column: Uint16Array.from(colOf), flat: Float32Array.from(flat), lip: Int8Array.from(lipOf),
    index: Uint32Array.from(index), outline: M, missed, split: { u: u0m, mid: splitMid.s, back: sB, front: sF },
    sampleFlat(u: number, s: number, out: Float64Array) { const at = locate(u, s, null, true); out[0] = tris[at.t]; out[1] = tris[at.t + 1]; out[2] = tris[at.t + 2]; out[3] = at.w[0]; out[4] = at.w[1]; out[5] = at.w[2]; },
  };
}
