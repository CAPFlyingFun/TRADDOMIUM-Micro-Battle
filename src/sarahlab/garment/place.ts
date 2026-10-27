/**
 * LAYING THE SEWN SHEET ROUND HER (Stage 2b): a first place in her REST space for every particle, good enough that each
 * one binds (`bind.ts`) to the right part of her -- the front to her front, a sleeve round its arm, a gusset under it.
 * The cloth simulation then does the fitting: the place is a start, the PATTERN's lengths are the garment.
 *
 * - FRONT and BACK: a pattern point (u across from the centre, v up) goes to her outline at the height v stands for
 *   (v itself below the underarm, her developed length above it: develop.ts), u along it from her midline (front or
 *   back), stood a little off her.
 * - SLEEVE: the tube below the underarm is wrapped round her arm's bones, its centre line along the top of her arm and
 *   its seam under it; the crown above blends from the top of the tube up to where it is sewn (the neckline over her
 *   shoulder for a raglan, her shoulder point for a set-in sleeve), bowed out over her shoulder.
 * - GUSSET: filled between its four corners, which are particles the front, back and sleeve have placed.
 * A seam particle takes the mean of its places in each piece it belongs to.
 *
 * Also the REGION each particle may bind to: body pieces her trunk only (so the cloth at her side never takes her arm as
 * its skin), sleeve tubes her arm, crowns and gussets either. Plain TypeScript; rest metres.
 */
import { BIND_ANY, BIND_ARM, BIND_TRUNK } from './bind';
import { surfaceZ } from './form';
import { hullAt } from './measure';
import type { Draft } from './draft';
import type { BodyMeasure, DressForm, Pattern, SewnGarment, Vec3 } from './types';

/** How far off her the body pieces start, and the sleeves past her arm's own radius, metres. */
const BODY_OFF = 0.006, SLEEVE_OFF = 0.008, CROWN_BOW = 0.03;
/** Over this much height above the underarm the yoke's placing blends from round-her-outline to the draft's across. */
const YOKE_BLEND = 0.04;

export interface Placed {
  /** Rest metres, 3 per particle. */
  readonly positions: Float32Array;
  /** Per particle, BIND_TRUNK, BIND_ARM or BIND_ANY. */
  readonly region: Uint8Array;
  /** Per particle, 1 for cloth of the body pieces (it never takes her arm as its floor). */
  readonly trunkOnly: Uint8Array;
}

/** The point at arc `s` along the front (+1) or back (-1) path of her outline at y, from her midline toward +x (s > 0 on the front path) or -x, stood `off` out. */
/** Her outline at y, read to the nearest HULL_STEP and remembered: thousands of particles share a few hundred heights. */
const HULL_STEP = 0.0005;
const hulls = new WeakMap<DressForm, Map<number, Float64Array>>();
function outlineAt(form: DressForm, y: number): Float64Array {
  let m = hulls.get(form);
  if (!m) { m = new Map(); hulls.set(form, m); }
  const k = Math.round(y / HULL_STEP);
  let h = m.get(k);
  if (!h) { h = hullAt(form, k * HULL_STEP); m.set(k, h); }
  return h;
}

function aroundHer(form: DressForm, y: number, side: 1 | -1, bodyX: number, off: number): [number, number] {
  const h = outlineAt(form, y);
  const n = h.length / 2;
  if (n < 3) return [bodyX, side * 0.1];
  let cx = 0, cz = 0;
  for (let k = 0; k < n; k++) { cx += h[2 * k]; cz += h[2 * k + 1]; }
  cx /= n; cz /= n;
  // walk the path from her midline (where that side of her outline crosses x = 0: not its z extreme, which near her
  // collarbones can be either side of her) toward sign(bodyX) by |arc|
  let cross = -1, crossT = 0, crossZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n, xa = h[2 * k], xb = h[2 * l];
    if ((xa < 0) === (xb < 0) || xa === xb) continue;
    const t = xa / (xa - xb), z = h[2 * k + 1] + t * (h[2 * l + 1] - h[2 * k + 1]);
    if (side * z > crossZ) { crossZ = side * z; cross = k; crossT = t; }
  }
  // on a CCW outline, from the front's middle toward +x is backwards in index; on the back, toward +x is forwards
  const dir = (side > 0) === (bodyX >= 0) ? -1 : 1;
  let start = 0;
  for (let k = 1; k < n; k++) if (side * h[2 * k + 1] > side * h[2 * start + 1]) start = k;
  // ...never past her side (the plane halfway between her front and back, where the side seams hang): a piece wider
  // than her half there (by her armpit, where her outline is only her trunk) stands the rest of its width off her side
  // instead of wrapping onto her other half
  let zLo = Infinity, zHi = -Infinity;
  for (let q = 0; q < n; q++) { zLo = Math.min(zLo, h[2 * q + 1]); zHi = Math.max(zHi, h[2 * q + 1]); }
  const zSide = (zLo + zHi) / 2;
  let left = Math.abs(bodyX), k = start, px = h[2 * k], pz = h[2 * k + 1];
  if (cross >= 0) {
    const l = (cross + 1) % n;
    px = h[2 * cross] + crossT * (h[2 * l] - h[2 * cross]); pz = h[2 * cross + 1] + crossT * (h[2 * l + 1] - h[2 * cross + 1]);
    k = dir < 0 ? l : cross; // the next vertex the walk takes is the crossing segment's end in that direction
  }
  for (let step = 0; step < n && left > 0; step++) {
    const q = (k + dir + n) % n, qx = h[2 * q], qz = h[2 * q + 1], l = Math.hypot(qx - px, qz - pz);
    if (side * (qz - zSide) < 0) { // the next stretch crosses her side: stop on it
      const t = Math.max(0, Math.min(1, side * (pz - zSide) / Math.max(1e-12, side * (pz - qz)))), m = Math.min(left, t * l);
      px += (qx - px) * m / l; pz += (qz - pz) * m / l; left -= m; break;
    }
    if (l >= left) { px += (qx - px) * left / l; pz += (qz - pz) * left / l; left = 0; break; }
    left -= l; k = q; px = qx; pz = qz;
  }
  const ox = px - cx, oz = pz - cz, ol = Math.hypot(ox, oz) || 1;
  return [px + (ox / ol) * (off + left), pz + (oz / ol) * (off + left)];
}

const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: readonly number[]): [number, number, number] => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Where a point of the front (back) at pattern (u, w) is laid on her (rest metres): at the height w stands for (w itself
 * below the underarm, her developed length above it: develop.ts), u round her outline from her midline below the
 * underarm and at the draft's across above it (blending over YOKE_BLEND), stood BODY_OFF off her.
 */
export function torsoPoint(draft: Draft, measure: BodyMeasure, frontForm: DressForm, front: boolean, u: number, w: number): [number, number, number] {
  const yU = draft.notes.underarmY;
  const bodyX = front ? u : -u;
  // above the underarm the pattern's heights are her developed lengths (develop.ts): back to her heights
  const y = Math.min((front ? draft.develop.front : draft.develop.back).y(u, w), measure.neck.side[0][1] + 0.02);
  const f = front ? frontForm : measure.form, sd = front ? 1 : -1;
  let [x, z] = aroundHer(f, y, sd, bodyX, BODY_OFF);
  // above the underarm the draft measured across her at one height (draft.ts yAcross) and developed up: lay the
  // yoke the same way -- at her lateral x for that across, on her surface there -- blending in over YOKE_BLEND
  if (y > yU) {
    const xs = Math.sign(bodyX) * draft.develop.xOfU(Math.abs(u)), zs = surfaceZ(f, sd > 0 ? 'front' : 'back', y, xs);
    if (!Number.isNaN(zs)) {
      const k = Math.min(1, (y - yU) / YOKE_BLEND);
      x += (xs - x) * k; z += (zs + sd * BODY_OFF - z) * k;
    }
  }
  return [x, y, z];
}

export function placeGarment(sewn: SewnGarment, pattern: Pattern, draft: Draft, measure: BodyMeasure, frontForm: DressForm = measure.form): Placed {
  const n = sewn.count, sum = new Float64Array(n * 3), hits = new Uint16Array(n);
  const region = new Uint8Array(n).fill(BIND_ANY), trunkOnly = new Uint8Array(n);
  const yU = draft.notes.underarmY, sG = draft.notes.gussetSide, H = draft.notes.sleeveCrown;
  const pieceOf = new Map(pattern.pieces.map((p, i) => [p.id, i] as const));
  const add = (particle: number, p: readonly number[]) => { sum[particle * 3] += p[0]; sum[particle * 3 + 1] += p[1]; sum[particle * 3 + 2] += p[2]; hits[particle]++; };

  // the sleeve tube's frame per side: along her arm from the point level with her underarm, through the elbow
  const armFrame = (s: 0 | 1) => {
    const a = measure.arms[s], sign = s === 0 ? 1 : -1;
    const se = sub(a.elbow, a.shoulder), t0 = Math.max(0, Math.min(1, (a.shoulder[1] - yU) / Math.max(1e-6, a.shoulder[1] - a.elbow[1])));
    const top: Vec3 = [a.shoulder[0] + se[0] * t0, a.shoulder[1] + se[1] * t0, a.shoulder[2] + se[2] * t0];
    const along = (dist: number): { p: Vec3; d: [number, number, number] } => {
      const upper = Math.hypot(...sub(a.elbow, top));
      if (dist <= upper) { const d = norm(sub(a.elbow, top)); return { p: [top[0] + d[0] * dist, top[1] + d[1] * dist, top[2] + d[2] * dist], d }; }
      const d = norm(sub(a.wrist, a.elbow)); const r = dist - upper; return { p: [a.elbow[0] + d[0] * r, a.elbow[1] + d[1] * r, a.elbow[2] + d[2] * r], d };
    };
    // outward: away from her side and up, square to the bone
    const outward = (d: readonly number[]) => { const o = [sign, 0.4, 0]; const k = dot(o, d); return norm([o[0] - k * d[0], o[1] - k * d[1], o[2] - k * d[2]]); };
    return { a, sign, top, along, outward };
  };
  const ringAt = (s: 0 | 1, v: number, x: number, half: number, r: number): [number, number, number] => {
    const F = armFrame(s), { p, d } = F.along(Math.max(0, -v)), o = F.outward(d);
    // plane x runs toward her back on her +x sleeve and toward her front on her -x one
    let q = cross(d, o);
    const toward = s === 0 ? -1 : 1;
    if (q[2] * toward < 0) q = [-q[0], -q[1], -q[2]];
    const phi = Math.max(-1, Math.min(1, x / Math.max(1e-6, half))) * Math.PI;
    return [p[0] + r * (Math.cos(phi) * o[0] + Math.sin(phi) * q[0]), p[1] + r * (Math.cos(phi) * o[1] + Math.sin(phi) * q[1]), p[2] + r * (Math.cos(phi) * o[2] + Math.sin(phi) * q[2])];
  };

  const torsoAt = (front: boolean, u: number, w: number) => torsoPoint(draft, measure, frontForm, front, u, w);
  // a raglan sleeve's top edge lies along the neckline over her shoulder: from the front's raglan point (where the front
  // laid it) by the side of her neck to the back's raglan point
  const neckOf = (id: string) => pattern.pieces.find((p) => p.id === id)?.edges.find((e) => e.name === 'neck')?.points;
  const frontNeck = neckOf('front'), backNeck = neckOf('back');
  const raglanEnds: ({ F: Vec3; B: Vec3 } | undefined)[] = [];
  const raglanTop = (s: 0 | 1, u: number, nf: number, nb: number): Vec3 => {
    // front neck edge runs from her +x to her -x; the back's (back plane x = -her x) from her -x to her +x
    const { F, B } = (raglanEnds[s] ??= (() => {
      const fp = frontNeck![s === 0 ? 0 : frontNeck!.length - 1], bp = backNeck![s === 0 ? backNeck!.length - 1 : 0];
      return { F: torsoAt(true, fp[0], fp[1]), B: torsoAt(false, bp[0], bp[1]) };
    })());
    const ns = measure.neck.side[s];
    const N: Vec3 = [ns[0] + (s === 0 ? 1 : -1) * BODY_OFF, ns[1] + BODY_OFF, ns[2]];
    // plane u runs toward her back on her +x sleeve (front raglan at u = -nf) and toward her front on her -x one
    const toBack = s === 0 ? u : -u;
    const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    return toBack <= 0 ? lerp(N, F, Math.min(1, -toBack / Math.max(1e-6, nf))) : lerp(N, B, Math.min(1, toBack / Math.max(1e-6, nb)));
  };

  for (let v = 0; v < sewn.vertexParticle.length; v++) {
    const piece = pattern.pieces[sewn.vertexPiece[v]], particle = sewn.vertexParticle[v];
    const u = sewn.uv[v * 2], w = sewn.uv[v * 2 + 1];
    if (piece.role === 'torso') {
      const front = piece.id === 'front';
      add(particle, torsoAt(front, u, w));
      region[particle] = BIND_TRUNK; trunkOnly[particle] = 1;
    } else if (piece.role === 'sleeve') {
      const s: 0 | 1 = piece.id.endsWith('P') ? 0 : 1;
      const tube = (vv: number, xx: number) => {
        const half = Math.max(0.05, halfWidthAt(piece, vv));
        return ringAt(s, Math.min(0, vv), xx, half, (2 * half) / (2 * Math.PI) + SLEEVE_OFF);
      };
      if (w <= 0) { add(particle, tube(w, u)); if (region[particle] !== BIND_TRUNK) region[particle] = BIND_ARM; }
      else {
        // the crown: from the top of the tube to where it is sewn, bowed out over her shoulder
        const t = Math.min(1, w / Math.max(1e-6, H)), base = tube(0, u * (halfWidthAt(piece, 0) / Math.max(1e-6, halfWidthAt(piece, w))));
        const sp = measure.shoulderPoint[s], toward = s === 0 ? -1 : 1;
        const raglan = pattern.pieces.some((p) => p.edges.some((e) => e.name.startsWith('raglan')));
        const topEdge = raglan ? piece.edges.find((e) => e.name === 'neck')!.points : null;
        const nfU = topEdge ? Math.abs(Math.min(...topEdge.map((q) => (s === 0 ? q[0] : -q[0])))) : 0, nbU = topEdge ? Math.max(...topEdge.map((q) => (s === 0 ? q[0] : -q[0]))) : 0;
        const topPt: Vec3 = raglan ? raglanTop(s, u, nfU, nbU) : [sp[0], sp[1], sp[2] + toward * u * 0.5];
        const F = armFrame(s), o = F.outward(norm(sub(F.a.elbow, F.a.shoulder))), bow = Math.sin(Math.PI * t) * CROWN_BOW;
        add(particle, [base[0] + (topPt[0] - base[0]) * t + o[0] * bow, base[1] + (topPt[1] - base[1]) * t + o[1] * bow, base[2] + (topPt[2] - base[2]) * t + o[2] * bow]);
      }
    }
  }
  // gussets: filled between the corners the other pieces placed (a gusset's seam points are theirs already)
  const placed = (particle: number): [number, number, number] => [sum[particle * 3] / hits[particle], sum[particle * 3 + 1] / hits[particle], sum[particle * 3 + 2] / hits[particle]];
  for (const piece of pattern.pieces) {
    if (piece.role !== 'gusset') continue;
    const pi = pieceOf.get(piece.id)!;
    // its corners: the first point of each edge, as particles
    const corners = piece.edges.map((e) => e.points[0]);
    const cornerParticle = corners.map((c) => {
      let best = -1, bd = Infinity;
      for (let v = 0; v < sewn.vertexParticle.length; v++) {
        if (sewn.vertexPiece[v] !== pi) continue;
        const d = Math.hypot(sewn.uv[v * 2] - c[0], sewn.uv[v * 2 + 1] - c[1]);
        if (d < bd) { bd = d; best = sewn.vertexParticle[v]; }
      }
      return best;
    });
    const P3 = cornerParticle.map((p) => (hits[p] > 0 ? placed(p) : null));
    for (let v = 0; v < sewn.vertexParticle.length; v++) {
      if (sewn.vertexPiece[v] !== pi) continue;
      const particle = sewn.vertexParticle[v];
      if (hits[particle] > 0) continue;
      // bilinear-ish: weight each placed corner by inverse distance in the plane
      const px = sewn.uv[v * 2], py = sewn.uv[v * 2 + 1];
      let wsum = 0; const acc = [0, 0, 0];
      corners.forEach((c, k) => { const q = P3[k]; if (!q) return; const d = Math.hypot(px - c[0], py - c[1]); const wk = 1 / Math.max(1e-4, d * d); wsum += wk; acc[0] += wk * q[0]; acc[1] += wk * q[1]; acc[2] += wk * q[2]; });
      if (wsum > 0 && hits[particle] === 0) add(particle, [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum]);
    }
  }
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { if (!hits[i]) continue; const q = placed(i); positions[i * 3] = q[0]; positions[i * 3 + 1] = q[1]; positions[i * 3 + 2] = q[2]; }
  void sG;
  return { positions, region, trunkOnly };
}

/** A sleeve piece's half-width at plane height v (its outline's extent there). */
function halfWidthAt(piece: { edges: readonly { points: readonly (readonly [number, number])[] }[] }, v: number): number {
  let best = 0;
  for (const e of piece.edges) for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i];
    if ((a[1] - v) * (b[1] - v) > 0 || a[1] === b[1]) continue;
    const t = (v - a[1]) / (b[1] - a[1]), x = Math.abs(a[0] + t * (b[0] - a[0]));
    if (x > best) best = x;
  }
  return best;
}
