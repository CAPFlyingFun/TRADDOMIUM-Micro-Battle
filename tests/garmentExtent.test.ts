/**
 * THE NEW TEE'S FULL EXTENT AND ITS INSTANT CUTS (Stage 3), on Sarah at 0% belly, measured once and tailored four times
 * -- each construction as GARMENT_DEFAULTS has it (a raglan with a gusset, a set-in without), plain and at its full
 * extent -- and drafted, not tailored, in the other gussets and with a set-in's dart:
 *
 * - `draft.ts` extend: absent or false drafts exactly the plain tee. True appends frontExt, backExt, sleeveExtP and
 *   sleeveExtM after every plain piece and sews them on (hemFront, hemBack, sideExt, cuff, underarmExt); the plain pieces
 *   are drafted, planned, meshed and sewn exactly as without them, so every plain particle keeps its number, its place,
 *   its binding and its edges' rest lengths, and the first triangles are the plain tee's; the sheet is sound; the
 *   extension reaches her knee and her wrists.
 * - `draft.ts` joinAlong: the extension's side seams (and its sleeves' underarm seams) leave the drafted hem's (cuff's)
 *   corner along the plain seam's own direction, so the sheet closes flat round the hem's corners (the cone the dress
 *   stood out in at her hips, 15 degrees short), and no particle of the side seams from there to her knee gathers more
 *   than 9 degrees.
 * - `draft.ts` neckCurve: 0 drafts exactly the U; 1 a front neckline straight from its side end to its centre, both ends
 *   where the U has them and every other edge as it was.
 * - `cuts.ts`: GARMENT_DEFAULTS keeps exactly the plain tee. Her stops are in order, Standard and Short exactly as
 *   drafted, Knee and Wrist the extension's. LENGTH cuts the side seams at each stop's height, at Standard (nudged) runs
 *   through the drafted hem, FRONT HEM moves only the front pair and BACK HEM only the back, HEM CURVE raises the sides
 *   by HEM_CURVE_RISE and not the centre. SLEEVE nudged off Short runs along the drafted cuff, Wrist keeps all of the
 *   extensions, a raglan Tank leaves only a strap at the sleeve's top (a set-in's none), a gusset is cut along its
 *   diagonal once the cut is above it (its half sewn to the body worn). NECKLINE cuts nothing until it is deeper than
 *   drafted; then it is 0 at the drafted neckline's side end,
 *   reaches the depth asked at her centre front, is clamped to neckDeepest and touches no piece but the front. And it is
 *   fast enough for a slider.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FACE_REST_OFFSET, FACE_REST_SCALE } from '../src/sarahlab/faceRig';
import { garmentCuts, garmentStops, HEM_CURVE_RISE, type GarmentCuts } from '../src/sarahlab/garment/cuts';
import { draftTee, EXTENSION_PARENT, JOIN_MAX, teeParams, type Draft, type SleeveConstruction, type TeeParams } from '../src/sarahlab/garment/draft';
import { measureBody } from '../src/sarahlab/garment/measure';
import { meshPiece } from '../src/sarahlab/garment/mesh';
import { GARMENT_DEFAULTS, LENGTH_STOPS, SLEEVE_STOPS, tailorParams, withConstruction, type GarmentSettings } from '../src/sarahlab/garment/settings';
import { edgeKey, planSeams, sew, validate } from '../src/sarahlab/garment/sew';
import { tailor, type Tailored } from '../src/sarahlab/garment/tailor';
import type { BodyInput, BodyMeasure, PatternPiece, PieceMesh, Vec2 } from '../src/sarahlab/garment/types';
import { loadSarahInput } from './garmentSarahBody';

const CONSTRUCTIONS: readonly SleeveConstruction[] = ['raglan', 'setIn'];
const EXTENSIONS = ['frontExt', 'backExt', 'sleeveExtP', 'sleeveExtM'];

let input: BodyInput;
let measure: BodyMeasure;
beforeAll(async () => {
  input = await loadSarahInput();
  measure = measureBody(input);
}, 120000);

/** GARMENT_DEFAULTS in a construction: its own gusset and neckline. */
const settingsOf = (c: SleeveConstruction): GarmentSettings => withConstruction(GARMENT_DEFAULTS, c);
/** The draft's parameters for those settings, at the full extent (as the room tailors) or plain. */
const paramsOf = (c: SleeveConstruction, extend: boolean): TeeParams => teeParams({ ...tailorParams(settingsOf(c)), extend });

const tailored = new Map<string, Tailored>();
/** Tailored once per construction and extent, on first use. */
function tee(c: SleeveConstruction, extend: boolean): Tailored {
  const key = `${c}:${extend}`;
  if (!tailored.has(key)) tailored.set(key, tailor(input, paramsOf(c, extend), { scale: FACE_REST_SCALE, offset: FACE_REST_OFFSET, measure }));
  return tailored.get(key)!;
}
const TAILOR_MS = 60000;

const pieceOf = (d: Draft, id: string): PatternPiece => d.pattern.pieces.find((p) => p.id === id)!;
const edgeOf = (d: Draft, piece: string, name: string): readonly Vec2[] => pieceOf(d, piece).edges.find((e) => e.name === name)!.points;

/** Piece `id`'s run of render vertices, [start, end). */
function runOf(t: Tailored, id: string): [number, number] {
  const p = t.draft.pattern.pieces.findIndex((q) => q.id === id), vp = t.sewn.vertexPiece;
  let s = -1, e = -1;
  for (let v = 0; v < vp.length; v++) if (vp[v] === p) { if (s < 0) s = v; e = v + 1; }
  return [s, e];
}

/** Distance from (x, y) to a polyline. */
function toPolyline(pts: readonly Vec2[], x: number, y: number): number {
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], dx = pts[k][0] - ax, dy = pts[k][1] - ay, l2 = dx * dx + dy * dy;
    const q = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - q * dx, y - ay - q * dy));
  }
  return best;
}

/** The render vertices of `pieces` that lie on (within a micron of) one of their edges whose name passes `test`. */
function onEdges(t: Tailored, pieces: readonly string[], test: (name: string) => boolean): number[] {
  const out: number[] = [];
  for (const id of pieces) {
    const [s, e] = runOf(t, id), edges = pieceOf(t.draft, id).edges.filter((x) => test(x.name));
    for (let v = s; v < e; v++) if (edges.some((x) => toPolyline(x.points, t.sewn.uv[2 * v], t.sewn.uv[2 * v + 1]) < 1e-6)) out.push(v);
  }
  return out;
}
const sideSeams = new Map<string, number[]>();
/** A body pair's side-seam vertices, plain piece and extension. */
function sideSeam(t: Tailored, pair: 'front' | 'back'): number[] {
  const key = `${t.draft.guide.construction}:${pair}`;
  if (!sideSeams.has(key)) sideSeams.set(key, onEdges(t, [pair, `${pair}Ext`], (n) => n.startsWith('side')));
  return sideSeams.get(key)!;
}

/** The keep a piece's vertices read, as a list. */
const keepOf = (t: Tailored, c: GarmentCuts, id: string): number[] => { const [s, e] = runOf(t, id); return Array.from(c.keep.subarray(s, e)); };

describe('the full extent (draft.ts extend)', () => {
  it('absent or false drafts exactly the plain tee', () => {
    for (const c of CONSTRUCTIONS) {
      const base = teeParams(tailorParams(settingsOf(c)));
      const { extend: _, ...absent } = base;
      void _;
      const a = draftTee(measure, absent), b = draftTee(measure, { ...base, extend: false });
      expect(b.pattern).toEqual(a.pattern);
      expect(b.notes).toEqual(a.notes);
      expect(a.pattern.pieces.map((p) => p.id).some((id) => EXTENSION_PARENT.has(id))).toBe(false);
    }
  }, TAILOR_MS);

  for (const c of CONSTRUCTIONS) {
    it(`${c}: appends the four extension pieces after the plain ones and sews them on; the plain pieces are drafted, meshed and sewn exactly as without them`, () => {
      const plain = tee(c, false), ext = tee(c, true), k = plain.draft.pattern.pieces.length;
      expect(ext.draft.pattern.pieces.slice(0, k)).toEqual(plain.draft.pattern.pieces);
      expect(ext.draft.pattern.pieces.slice(k).map((p) => p.id)).toEqual(EXTENSIONS);
      expect(ext.draft.notes).toEqual(plain.draft.notes);
      // the plain seams first, then the extension's
      expect(ext.draft.pattern.seams.slice(0, plain.draft.pattern.seams.length)).toEqual(plain.draft.pattern.seams);
      expect(ext.draft.pattern.seams.slice(plain.draft.pattern.seams.length).map((s) => s.name).sort()).toEqual(
        ['cuffM', 'cuffP', 'hemBack', 'hemFront', 'sideExtM', 'sideExtP', 'underarmExtM', 'underarmExtP'].sort());
      // every plain edge cut into as many segments (the hem's and cuffs' groups now hold the extensions' tops), so every
      // plain piece meshes exactly as it did
      const pp = planSeams(plain.draft.pattern), pe = planSeams(ext.draft.pattern);
      for (const p of plain.draft.pattern.pieces) for (const e of p.edges) expect(pe.get(edgeKey(p.id, e.name)), edgeKey(p.id, e.name)).toBe(pp.get(edgeKey(p.id, e.name)));
      for (const p of plain.draft.pattern.pieces) expect(ext.meshes.get(p.id), p.id).toEqual(plain.meshes.get(p.id));
      // sound: no problems, one piece of cloth, the hem and cuffs now the extension's
      expect(ext.report.problems).toEqual([]);
      expect(ext.report.components).toBe(1);
      expect(ext.report.openings.length).toBe(4);
      for (const opening of [['frontExt:hem', 'backExt:hem'], ['sleeveExtP:cuff'], ['sleeveExtM:cuff']]) {
        expect(ext.report.openings.some((o) => [...o].sort().join() === [...opening].sort().join()), opening.join()).toBe(true);
      }
      expect(ext.report.openings.some((o) => o.some((e) => e.endsWith(':neck')))).toBe(true);
      // the plain draft (validated as it always was) is sound too
      expect(plain.report.problems).toEqual([]);
    }, TAILOR_MS);

    it(`${c}: every plain particle keeps its number, its place, its binding and its edges' rest lengths; the first triangles are the plain tee's`, () => {
      const plain = tee(c, false), ext = tee(c, true), P = plain.sewn.count, V = plain.sewn.vertexParticle.length, T = plain.sewn.triangles.length;
      expect(ext.sewn.count).toBeGreaterThan(P);
      // render vertices and their particles, pieces and plane coordinates
      expect(ext.sewn.vertexParticle.subarray(0, V)).toEqual(plain.sewn.vertexParticle);
      expect(ext.sewn.vertexPiece.subarray(0, V)).toEqual(plain.sewn.vertexPiece);
      expect(ext.sewn.uv.subarray(0, 2 * V)).toEqual(plain.sewn.uv);
      expect(ext.sewn.particlePiece.subarray(0, P)).toEqual(plain.sewn.particlePiece);
      // every particle past the plain tee's is the extension's alone
      const firstExt = plain.draft.pattern.pieces.length;
      for (let i = P; i < ext.sewn.count; i++) expect(ext.sewn.particlePiece[i]).toBeGreaterThanOrEqual(firstExt);
      // the triangles: the plain tee's first, triangle for triangle
      expect(ext.sewn.triangles.subarray(0, T)).toEqual(plain.sewn.triangles);
      expect(ext.sewn.renderTriangles.subarray(0, T)).toEqual(plain.sewn.renderTriangles);
      expect(ext.sewn.trianglePiece.subarray(0, T / 3)).toEqual(plain.sewn.trianglePiece);
      // placed exactly where the plain tee places them, with the same regions
      expect(ext.placed.positions.subarray(0, 3 * P)).toEqual(plain.placed.positions);
      expect(ext.placed.region.subarray(0, P)).toEqual(plain.placed.region);
      expect(ext.placed.trunkOnly.subarray(0, P)).toEqual(plain.placed.trunkOnly);
      // bound to the same triangles of her, at the same weights and offsets
      expect(ext.binding.tri.subarray(0, 3 * P)).toEqual(plain.binding.tri);
      let bary = 0, offset = 0;
      for (let i = 0; i < 3 * P; i++) bary = Math.max(bary, Math.abs(ext.binding.bary[i] - plain.binding.bary[i]));
      for (let i = 0; i < P; i++) offset = Math.max(offset, Math.abs(ext.binding.offset[i] - plain.binding.offset[i]));
      expect(bary).toBeLessThanOrEqual(1e-9);
      expect(offset).toBeLessThanOrEqual(1e-9);
      // every edge of the plain tee is there, at its rest length
      const rest = new Map<number, number>(), N = ext.sewn.count;
      for (let e = 0; e < ext.sewn.edgeRest.length; e++) rest.set(ext.sewn.edges[2 * e] * N + ext.sewn.edges[2 * e + 1], ext.sewn.edgeRest[e]);
      let worst = 0, missing = 0;
      for (let e = 0; e < plain.sewn.edgeRest.length; e++) {
        const r = rest.get(plain.sewn.edges[2 * e] * N + plain.sewn.edges[2 * e + 1]);
        if (r === undefined) missing++;
        else worst = Math.max(worst, Math.abs(r - plain.sewn.edgeRest[e]));
      }
      expect(missing).toBe(0);
      expect(worst).toBeLessThanOrEqual(1e-9);
      // the extension's particles: trunk-only on her trunk below the hem, on her arm below the cuffs
      const pieces = ext.draft.pattern.pieces;
      for (let v = V; v < ext.sewn.vertexParticle.length; v++) {
        const i = ext.sewn.vertexParticle[v];
        if (i < P) continue;
        const torso = pieces[ext.sewn.vertexPiece[v]].role === 'torso';
        expect(ext.placed.region[i]).toBe(torso ? 0 : 1);
        expect(ext.placed.trunkOnly[i]).toBe(torso ? 1 : 0);
      }
    }, TAILOR_MS);

    it(`${c}: the extension leaves the drafted hem's and cuff's corners along the plain seams; the sheet closes flat round the hem's`, () => {
      const t = tee(c, true), d = t.draft, deg = (r: number) => (r * 180) / Math.PI;
      // each extension seam's stretch at the corner runs on along the plain seam's, to within half a degree: up the
      // sides and the sleeve's back under edge (the extension's last stretch, the plain's first), down its front under
      // edge (the plain's last, the extension's first); the other sleeve is this one's mirror
      const dir = (a: Vec2, b: Vec2) => Math.atan2(b[0] - a[0], b[1] - a[1]);
      const apart = (a: number, b: number) => deg(Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))));
      for (const [plain, ext, name] of [['front', 'frontExt', 'sideP'], ['back', 'backExt', 'sideM'], ['sleeveP', 'sleeveExtP', 'underBack']] as const) {
        const p = edgeOf(d, plain, name), e = edgeOf(d, ext, name), n = e.length;
        expect(e[n - 1]).toEqual(p[0]);
        expect(apart(dir(p[0], p[1]), dir(e[n - 2], e[n - 1])), `${ext} ${name}`).toBeLessThan(0.5);
      }
      {
        const p = edgeOf(d, 'sleeveP', 'underFront'), e = edgeOf(d, 'sleeveExtP', 'underFront'), n = p.length;
        expect(e[0]).toEqual(p[n - 1]);
        expect(apart(dir(p[n - 2], p[n - 1]), dir(e[0], e[1])), 'sleeveExtP underFront').toBeLessThan(0.5);
      }
      // what each particle of the side seams gathers (360 degrees less its triangles' corners, flat as drafted): at the
      // hem's corner and all the way down the extension's side to her knee, under 9 degrees (the cone it stood out in: 15)
      const S = t.sewn, R = S.renderTriangles, uv = S.uv, sum = new Float64Array(S.count);
      for (let k = 0; k < R.length; k += 3) for (let j = 0; j < 3; j++) {
        const a = R[k + j], b = R[k + ((j + 1) % 3)], cc = R[k + ((j + 2) % 3)];
        const ux = uv[2 * b] - uv[2 * a], uy = uv[2 * b + 1] - uv[2 * a + 1], vx = uv[2 * cc] - uv[2 * a], vy = uv[2 * cc + 1] - uv[2 * a + 1];
        sum[S.vertexParticle[a]] += Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
      }
      const yH = d.notes.hemY, near = new Map<number, number>();
      for (const v of [...sideSeam(t, 'front'), ...sideSeam(t, 'back')]) { const y = uv[2 * v + 1]; if (y <= yH + 1e-6 && y > d.guide.kneeY + 0.005) near.set(S.vertexParticle[v], y); }
      expect(near.size).toBeGreaterThan(20);
      expect(Math.min(...near.values())).toBeLessThan(yH - JOIN_MAX);
      let worst = 0;
      for (const p of near.keys()) worst = Math.max(worst, Math.abs(360 - deg(sum[p])));
      expect(worst).toBeLessThan(9);
    }, TAILOR_MS);

    it(`${c}: the extension reaches her knee and her wrists`, () => {
      const ext = tee(c, true), d = ext.draft, g = d.guide;
      expect(g.kneeY).toBe(measure.kneeY);
      // the extension's hem stands at her knee at the side seams, its centre lower by the hem rule's extra
      for (const id of ['frontExt', 'backExt']) {
        const hem = edgeOf(d, id, 'hem');
        expect(hem[0][1]).toBe(measure.kneeY);
        expect(hem[hem.length - 1][1]).toBe(measure.kneeY);
        expect(Math.min(...hem.map((q) => q[1]))).toBeLessThan(measure.kneeY);
        expect(Math.min(...hem.map((q) => q[1]))).toBeGreaterThan(measure.kneeY - 0.05);
      }
      // and is placed there: from the drafted hem down to her knee, on her trunk
      const [s, e] = runOf(ext, 'frontExt');
      let lo = Infinity, hi = -Infinity;
      for (let v = s; v < e; v++) { const y = ext.placed.positions[3 * ext.sewn.vertexParticle[v] + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
      expect(lo).toBeLessThan(measure.kneeY);
      expect(lo).toBeGreaterThan(measure.kneeY - 0.05);
      expect(hi).toBeCloseTo(d.notes.hemY, 2);
      // the sleeves' extensions end at her wrist: her shoulder point's level less her arm's outside length
      const outside = (measure.arms[0].outsideLength + measure.arms[1].outsideLength) / 2;
      expect(g.sleeve.wristV).toBeCloseTo(g.sleeve.shoulderV - outside, 12);
      for (const id of ['sleeveExtP', 'sleeveExtM']) {
        const cuff = edgeOf(d, id, 'cuff');
        for (const q of cuff) expect(q[1]).toBe(g.sleeve.wristV);
        expect(edgeOf(d, id, 'top').every((q) => q[1] === g.sleeve.cuffV)).toBe(true);
      }
      // placed down her arm toward her wrist: the cuff's particles nearer her wrist than her elbow, round her arm as wide
      // as the tube a centimetre or two above it (its outline read at its own cuff: place.ts)
      for (const [k, id] of [[0, 'sleeveExtP'], [1, 'sleeveExtM']] as const) {
        const arm = measure.arms[k], [s, e] = runOf(ext, id);
        const ring = (lo: number, hi: number): { at: number[]; r: number } => {
          const ids = new Set<number>();
          for (let v = s; v < e; v++) if (ext.sewn.uv[2 * v + 1] >= lo && ext.sewn.uv[2 * v + 1] <= hi) ids.add(ext.sewn.vertexParticle[v]);
          const at = [0, 0, 0];
          for (const i of ids) for (let a = 0; a < 3; a++) at[a] += ext.placed.positions[3 * i + a] / ids.size;
          let r = 0;
          for (const i of ids) r += Math.hypot(ext.placed.positions[3 * i] - at[0], ext.placed.positions[3 * i + 1] - at[1], ext.placed.positions[3 * i + 2] - at[2]) / ids.size;
          return { at, r };
        };
        const cuff = ring(g.sleeve.wristV - 1e-4, g.sleeve.wristV + 1e-4), above = ring(g.sleeve.wristV + 0.01, g.sleeve.wristV + 0.02), at = cuff.at;
        const toWrist = Math.hypot(at[0] - arm.wrist[0], at[1] - arm.wrist[1], at[2] - arm.wrist[2]), toElbow = Math.hypot(at[0] - arm.elbow[0], at[1] - arm.elbow[1], at[2] - arm.elbow[2]);
        expect(toWrist).toBeLessThan(toElbow);
        expect(toWrist).toBeLessThan(0.1);
        expect(Math.abs(cuff.r - above.r) / above.r).toBeLessThan(0.2);
      }
    }, TAILOR_MS);
  }

  it('any gusset, and a set-in with a dart: the plain pieces are drafted and cut into exactly as without the extension, and the sheet is sound', () => {
    const variants: Partial<TeeParams>[] = [
      { construction: 'raglan', gusset: 0 }, { construction: 'raglan', gusset: 1 },
      { construction: 'setIn', gusset: 0.5 }, { construction: 'setIn', gusset: 1 }, { construction: 'setIn', gusset: 0, bustShaping: 'dart' },
    ];
    for (const v of variants) {
      const name = JSON.stringify(v), base = teeParams(v);
      const plain = draftTee(measure, base), ext = draftTee(measure, { ...base, extend: true });
      const k = plain.pattern.pieces.length;
      expect(ext.pattern.pieces.slice(0, k), name).toEqual(plain.pattern.pieces);
      expect(ext.pattern.pieces.slice(k).map((p) => p.id), name).toEqual(EXTENSIONS);
      const pp = planSeams(plain.pattern), pe = planSeams(ext.pattern);
      for (const p of plain.pattern.pieces) for (const e of p.edges) expect(pe.get(edgeKey(p.id, e.name)), `${name} ${edgeKey(p.id, e.name)}`).toBe(pp.get(edgeKey(p.id, e.name)));
      const meshes = new Map<string, PieceMesh>();
      for (const p of ext.pattern.pieces) meshes.set(p.id, meshPiece(p, new Map(p.edges.map((e) => [e.name, pe.get(edgeKey(p.id, e.name))!]))));
      const report = validate(sew(ext.pattern, meshes), ext.pattern, meshes);
      expect(report.problems, name).toEqual([]);
      expect(report.components, name).toBe(1);
    }
  }, 120000);
});

describe('NECK SHAPE (draft.ts neckCurve)', () => {
  for (const c of CONSTRUCTIONS) {
    it(`${c}: 0 drafts exactly the U; 1 a front neckline straight from its side end to its centre, both ends kept and nothing else changed`, () => {
      const base = teeParams({ construction: c, ...(c === 'setIn' ? { gusset: 0 } : {}) });
      const u = draftTee(measure, base), zero = draftTee(measure, { ...base, neckCurve: 0 }), v = draftTee(measure, { ...base, neckCurve: 1 });
      expect(zero.pattern).toEqual(u.pattern);
      const neckU = edgeOf(u, 'front', 'neck'), neckV = edgeOf(v, 'front', 'neck');
      // both ends, and the centre, where the U has them
      expect(neckV[0]).toEqual(neckU[0]);
      expect(neckV[neckV.length - 1]).toEqual(neckU[neckU.length - 1]);
      const centreU = neckU.find((q) => q[0] === 0)!, centreV = neckV.find((q) => q[0] === 0)!;
      expect(centreV).toEqual(centreU);
      // straight within a millimetre, each half from its side end to the centre
      for (const end of [neckU[0], neckU[neckU.length - 1]]) {
        const half = neckV.filter((q) => q[0] * end[0] >= 0), dx = centreU[0] - end[0], dy = centreU[1] - end[1], l = Math.hypot(dx, dy);
        const off = Math.max(...half.map((q) => Math.abs((q[0] - end[0]) * dy - (q[1] - end[1]) * dx) / l));
        expect(off).toBeLessThan(0.001);
      }
      // the U is not straight (so the test above is not trivially true), and every other edge is as it was
      const dx = centreU[0] - neckU[0][0], dy = centreU[1] - neckU[0][1], l = Math.hypot(dx, dy);
      expect(Math.max(...neckU.filter((q) => q[0] >= 0).map((q) => Math.abs((q[0] - neckU[0][0]) * dy - (q[1] - neckU[0][1]) * dx) / l))).toBeGreaterThan(0.003);
      for (const p of u.pattern.pieces) for (const e of p.edges) {
        if (p.id === 'front' && e.name === 'neck') continue;
        expect(edgeOf(v, p.id, e.name), edgeKey(p.id, e.name)).toEqual(e.points);
      }
      expect(v.pattern.seams).toEqual(u.pattern.seams);
      expect(v.guide.frontNeck[0]).toEqual(neckU[0]);
    }, TAILOR_MS);
  }
});

describe('the cuts (cuts.ts)', () => {
  for (const c of CONSTRUCTIONS) {
    it(`${c}: GARMENT_DEFAULTS keeps exactly the plain tee: +1 on every plain vertex, -1 on every extension vertex, no neckline cut`, () => {
      const t = tee(c, true), cuts = garmentCuts(t, settingsOf(c)), pieces = t.draft.pattern.pieces;
      let wrong = 0;
      for (let v = 0; v < cuts.keep.length; v++) if (cuts.keep[v] !== (EXTENSION_PARENT.has(pieces[t.sewn.vertexPiece[v]].id) ? -1 : 1)) wrong++;
      expect(wrong).toBe(0);
      expect(cuts.neck.every((x) => x === Infinity)).toBe(true);
      // the same for GARMENT_DEFAULTS itself (a raglan) and for the argument left out
      if (c === 'raglan') {
        expect(garmentCuts(t, GARMENT_DEFAULTS)).toEqual(cuts);
        expect(garmentCuts(t)).toEqual(cuts);
      }
    }, TAILOR_MS);

    it(`${c}: her stops are in order down her, Standard and Short exactly as drafted, Knee and Wrist the extension's`, () => {
      const t = tee(c, true), st = garmentStops(t), d = t.draft, g = d.guide, at = (ids: readonly { id: string }[], id: string) => ids.findIndex((x) => x.id === id);
      expect(st.lengthY.length).toBe(LENGTH_STOPS.length);
      for (let i = 1; i < st.lengthY.length; i++) expect(st.lengthY[i]).toBeLessThan(st.lengthY[i - 1]);
      expect(st.lengthY[at(LENGTH_STOPS, 'standard')]).toBe(d.notes.hemY);
      expect(st.lengthY[at(LENGTH_STOPS, 'knee')]).toBe(g.kneeY);
      // Crop 4 cm under her underbust, never within a centimetre of the gusset's lower corner; Tunic and Mini by her hip
      const crop = st.lengthY[at(LENGTH_STOPS, 'crop')];
      expect(crop).toBeCloseTo(Math.min(measure.underbust.y - 0.04, g.sideTopY - 0.01), 12);
      expect(crop).toBeLessThanOrEqual(g.sideTopY - 0.01 + 1e-12);
      expect(st.lengthY[at(LENGTH_STOPS, 'tunic')]).toBeCloseTo(measure.hip.y - 0.09, 12);
      expect(st.lengthY[at(LENGTH_STOPS, 'mini')]).toBeCloseTo((measure.hip.y + measure.kneeY) / 2, 12);
      // the sleeve, from her shoulder point down her arm
      expect(st.sleeveLength.length).toBe(SLEEVE_STOPS.length);
      for (let i = 1; i < st.sleeveLength.length; i++) expect(st.sleeveLength[i]).toBeGreaterThan(st.sleeveLength[i - 1]);
      expect(st.sleeveLength[at(SLEEVE_STOPS, 'short')]).toBe(g.sleeve.shoulderV - g.sleeve.cuffV);
      expect(st.sleeveLength[at(SLEEVE_STOPS, 'wrist')]).toBe(g.sleeve.shoulderV - g.sleeve.wristV);
      expect(st.sleeveLength[at(SLEEVE_STOPS, 'tank')]).toBeLessThan(0.0);
      const sp = measure.shoulderPoint, el = [measure.arms[0].elbow, measure.arms[1].elbow];
      const toElbow = (Math.hypot(sp[0][0] - el[0][0], sp[0][1] - el[0][1], sp[0][2] - el[0][2]) + Math.hypot(sp[1][0] - el[1][0], sp[1][1] - el[1][1], sp[1][2] - el[1][2])) / 2;
      expect(st.sleeveLength[at(SLEEVE_STOPS, 'elbow')]).toBeCloseTo(toElbow + 0.02, 12);
      expect(st.hipY).toBe(measure.hip.y);
      expect(st.kneeY).toBe(measure.kneeY);
      expect(st.neckDeepest).toBeCloseTo(measure.neck.front[1] - measure.underbust.y, 12);
    }, TAILOR_MS);

    it(`${c}: each LENGTH stop cuts both pairs' side seams at its height (within 2 mm)`, () => {
      const t = tee(c, true), st = garmentStops(t);
      LENGTH_STOPS.forEach((stop, i) => {
        const cuts = garmentCuts(t, { ...settingsOf(c), length: stop.at }), h = st.lengthY[i];
        for (const pair of ['front', 'back'] as const) {
          let above = 0, below = 0, wrong = 0;
          for (const v of sideSeam(t, pair)) {
            const y = t.sewn.uv[2 * v + 1];
            if (y > h + 0.002) { above++; if (!(cuts.keep[v] > 0)) wrong++; }
            if (y < h - 0.002) { below++; if (!(cuts.keep[v] < 0)) wrong++; }
          }
          expect(wrong, `${stop.id} ${pair}`).toBe(0);
          expect(above, `${stop.id} ${pair}`).toBeGreaterThan(0);
          if (stop.id !== 'knee') expect(below, `${stop.id} ${pair}`).toBeGreaterThan(0);
        }
      });
      // at the Knee all of the extension is worn; at Crop none of it, and no gusset is touched
      const knee = garmentCuts(t, { ...settingsOf(c), length: 100 }), crop = garmentCuts(t, { ...settingsOf(c), length: 0 });
      for (const id of ['frontExt', 'backExt']) { expect(keepOf(t, knee, id).every((k) => k === 1)).toBe(true); expect(keepOf(t, crop, id).every((k) => k === -1)).toBe(true); }
      for (const id of ['gussetP', 'gussetM']) if (t.draft.pattern.pieces.some((p) => p.id === id)) expect(keepOf(t, crop, id).every((k) => k === 1)).toBe(true);
    }, TAILOR_MS);

    it(`${c}: at Standard, nudged off the drafted hem by a micron at the front's centre, the LENGTH line runs through the drafted hem (within 0.5 mm)`, () => {
      const t = tee(c, true), cuts = garmentCuts(t, { ...settingsOf(c), frontHem: 1e-6 });
      const hem = onEdges(t, ['frontExt'], (n) => n === 'top');
      expect(hem.length).toBeGreaterThan(40);
      for (const v of hem) expect(Math.abs(cuts.keep[v])).toBeLessThanOrEqual(0.0005);
      // the front is kept whole and the rest of its extension cut away; the back is exactly as drafted
      expect(keepOf(t, cuts, 'front').every((k) => k === 1)).toBe(true);
      expect(keepOf(t, cuts, 'frontExt').filter((k) => k > 0.0005).length).toBe(0);
      expect(keepOf(t, cuts, 'back').every((k) => k === 1)).toBe(true);
      expect(keepOf(t, cuts, 'backExt').every((k) => k === -1)).toBe(true);
    }, TAILOR_MS);

    it(`${c}: FRONT HEM moves only the front pair, BACK HEM only the back`, () => {
      const t = tee(c, true), defaults = garmentCuts(t, settingsOf(c));
      const down = garmentCuts(t, { ...settingsOf(c), frontHem: 0.03 }), up = garmentCuts(t, { ...settingsOf(c), backHem: -0.03 });
      for (const id of ['back', 'backExt', 'sleeveP', 'sleeveM']) expect(keepOf(t, down, id), id).toEqual(keepOf(t, defaults, id));
      for (const id of ['front', 'frontExt', 'sleeveP', 'sleeveM']) expect(keepOf(t, up, id), id).toEqual(keepOf(t, defaults, id));
      // let down 3 cm at the centre, tapering to nothing at the side seams: the extension's top (the drafted hem) stands 3
      // cm over the line at the centre and on it at the side; taken up, the back is cut at its centre
      const top = onEdges(t, ['frontExt'], (n) => n === 'top');
      const centre = Math.max(...top.filter((v) => Math.abs(t.sewn.uv[2 * v]) < 0.005).map((v) => down.keep[v]));
      expect(centre).toBeGreaterThan(0.029);
      expect(centre).toBeLessThan(0.031);
      const w = Math.max(...top.map((v) => Math.abs(t.sewn.uv[2 * v])));
      for (const v of top) if (Math.abs(t.sewn.uv[2 * v]) > w - 1e-6) expect(Math.abs(down.keep[v])).toBeLessThan(0.0005);
      expect(keepOf(t, up, 'back').some((k) => k < 0)).toBe(true);
    }, TAILOR_MS);

    it(`${c}: HEM CURVE at 1 raises the hem at the side seams by HEM_CURVE_RISE (within 2 mm), and not at the centre`, () => {
      const t = tee(c, true), h = t.draft.notes.hemY, cuts = garmentCuts(t, { ...settingsOf(c), hemCurve: 1 });
      for (const pair of ['front', 'back'] as const) {
        let wrong = 0, above = 0, below = 0;
        for (const v of sideSeam(t, pair)) {
          const y = t.sewn.uv[2 * v + 1];
          if (y > h + HEM_CURVE_RISE + 0.002) { above++; if (!(cuts.keep[v] > 0)) wrong++; }
          if (y < h + HEM_CURVE_RISE - 0.002) { below++; if (!(cuts.keep[v] < 0)) wrong++; }
        }
        expect(wrong, pair).toBe(0);
        expect(above * below, pair).toBeGreaterThan(0);
        // at the centre it stays the drafted hem: the plain piece's hem point on the fold is on the line
        const [s, e] = runOf(t, pair), centre = edgeOf(t.draft, pair, 'hem').find((q) => q[0] === 0)!;
        let at = -1;
        for (let v = s; v < e; v++) if (t.sewn.uv[2 * v] === 0 && Math.abs(t.sewn.uv[2 * v + 1] - centre[1]) < 1e-6) at = v;
        expect(at).toBeGreaterThanOrEqual(0);
        expect(Math.abs(cuts.keep[at])).toBeLessThan(0.0005);
      }
    }, TAILOR_MS);

    it(`${c}: SLEEVE nudged off Short runs along the drafted cuff (within 0.5 mm); Wrist keeps all of each extension; the gussets go once the cut is above them`, () => {
      const t = tee(c, true), g = t.draft.guide;
      const nudged = garmentCuts(t, { ...settingsOf(c), sleeve: 40.01 });
      for (const id of ['sleeveExtP', 'sleeveExtM']) {
        const top = onEdges(t, [id], (n) => n === 'top');
        expect(top.length).toBeGreaterThan(20);
        for (const v of top) expect(Math.abs(nudged.keep[v])).toBeLessThanOrEqual(0.0005);
      }
      for (const id of ['sleeveP', 'sleeveM']) expect(keepOf(t, nudged, id).every((k) => k === 1)).toBe(true);
      const wrist = garmentCuts(t, { ...settingsOf(c), sleeve: 100 });
      for (const id of ['sleeveP', 'sleeveM', 'sleeveExtP', 'sleeveExtM']) expect(keepOf(t, wrist, id).every((k) => k === 1), id).toBe(true);
      // the body is never cut by a sleeve
      for (const s of [0, 20, 60, 100]) {
        const cuts = garmentCuts(t, { ...settingsOf(c), sleeve: s });
        for (const id of ['front', 'back']) expect(keepOf(t, cuts, id).every((k) => k === 1), `${s} ${id}`).toBe(true);
      }
      // a raglan's gusset: worn whole from Short down; at Cap and Tank (the cut above it) its lower half, cut along its
      // diagonal -- keep is the depth under the diagonal, so its seams to the body are worn and the sleeve's corner is not
      const sG = t.draft.notes.gussetSide;
      if (sG > 0) {
        const st = garmentStops(t), capY = g.sleeve.shoulderV - st.sleeveLength[1];
        expect(capY).toBeGreaterThan(-sG - 0.01);
        for (const s of [40, 40.01, 60, 100]) {
          const cuts = garmentCuts(t, { ...settingsOf(c), sleeve: s });
          for (const id of ['gussetP', 'gussetM']) expect(keepOf(t, cuts, id).every((x) => x === 1), `${s} ${id}`).toBe(true);
        }
        for (const s of [0, 20]) {
          const cuts = garmentCuts(t, { ...settingsOf(c), sleeve: s });
          for (const id of ['gussetP', 'gussetM']) {
            const [a, b] = runOf(t, id);
            for (let v = a; v < b; v++) expect(cuts.keep[v]).toBeCloseTo(-t.sewn.uv[2 * v + 1], 6);
            const body = onEdges(t, [id], (n) => n === 'front' || n === 'back'), sleeve = onEdges(t, [id], (n) => n.startsWith('sleeve'));
            expect(body.length).toBeGreaterThan(4);
            for (const v of body) expect(cuts.keep[v], `${s} ${id} body seam`).toBeGreaterThan(-1e-6);
            expect(Math.min(...sleeve.map((v) => cuts.keep[v])), `${s} ${id} the sleeve's corner`).toBeLessThan(-sG / 2);
          }
        }
      }
    }, TAILOR_MS);

    it(`${c}: Tank leaves ${c === 'raglan' ? 'only a strap at the top of the sleeve' : 'none of the sleeve'}`, () => {
      const t = tee(c, true), g = t.draft.guide.sleeve, cuts = garmentCuts(t, { ...settingsOf(c), sleeve: 0 });
      const yTank = g.shoulderV - garmentStops(t).sleeveLength[SLEEVE_STOPS.findIndex((x) => x.id === 'tank')];
      for (const id of ['sleeveExtP', 'sleeveExtM']) expect(keepOf(t, cuts, id).every((k) => k === -1)).toBe(true);
      for (const id of ['sleeveP', 'sleeveM']) {
        const [s, e] = runOf(t, id);
        let kept = 0, wrong = 0;
        for (let v = s; v < e; v++) {
          const y = t.sewn.uv[2 * v + 1];
          if (cuts.keep[v] > 0) kept++;
          if ((y > yTank + 1e-6 && !(cuts.keep[v] > 0)) || (y < yTank - 1e-6 && !(cuts.keep[v] < 0))) wrong++;
        }
        expect(wrong).toBe(0);
        if (c === 'setIn') { expect(kept).toBe(0); expect(yTank).toBeGreaterThan(g.topFront); continue; }
        // a strap 4 to 5 cm deep under the middle of the sleeve's top edge (over her shoulder), its top edge worn, and
        // the rest of the sleeve not
        const mid = (g.topFront + g.topBack) / 2;
        expect(mid - yTank).toBeGreaterThanOrEqual(0.04);
        expect(mid - yTank).toBeLessThanOrEqual(0.05);
        for (const v of onEdges(t, [id], (n) => n === 'neck')) expect(cuts.keep[v]).toBeGreaterThan(0.02);
        expect(kept).toBeGreaterThan(20);
        expect(kept).toBeLessThan((e - s) / 4);
      }
    }, TAILOR_MS);

    it(`${c}: the NECKLINE cuts nothing until it is deeper than drafted`, () => {
      const t = tee(c, true), defaults = garmentCuts(t, settingsOf(c));
      for (const depth of [0.01, 0.02, 0.04]) {
        const cuts = garmentCuts(t, { ...settingsOf(c), neckDepth: depth });
        expect(cuts.neck.every((x) => x === Infinity), String(depth)).toBe(true);
        expect(cuts.keep).toEqual(defaults.keep);
      }
    }, TAILOR_MS);

    it(`${c}: deeper, the NECKLINE is 0 at the drafted neckline's side end (within 1 mm), reaches the depth asked at her centre front (within 2 mm), and touches no other piece`, () => {
      const t = tee(c, true), d = t.draft, g = d.guide, defaults = garmentCuts(t, settingsOf(c));
      const [s, e] = runOf(t, 'front'), neckEdge = edgeOf(d, 'front', 'neck'), ends = [neckEdge[0], neckEdge[neckEdge.length - 1]];
      const near = (q: Vec2) => { let best = -1, bd = Infinity; for (let v = s; v < e; v++) { const dd = Math.hypot(t.sewn.uv[2 * v] - q[0], t.sewn.uv[2 * v + 1] - q[1]); if (dd < bd) { bd = dd; best = v; } } expect(bd).toBeLessThan(1e-5); return best; };
      const sideEnds = ends.map(near);
      // her height at a pattern height of her centre front: developed above the underarm line, down the hem rule's tape below it
      const herY = (v: number): number => {
        if (v >= g.underarmY) return d.develop.front.y(0, v - d.notes.bustLift);
        let lo = v, hi = v + 0.1;
        for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (m - Math.max(0, g.extra('front', m)) < v) lo = m; else hi = m; }
        return (lo + hi) / 2;
      };
      const fold: number[] = [];
      for (let v = s; v < e; v++) if (t.sewn.uv[2 * v] === 0) fold.push(v);
      for (const depth of [0.10, 0.175]) for (const curve of [0, 0.5, 1]) {
        const name = `${depth} ${curve}`, cuts = garmentCuts(t, { ...settingsOf(c), neckDepth: depth, neckCurve: curve });
        // the front alone: every other vertex as at the defaults, with no neckline distance
        for (let v = 0; v < cuts.keep.length; v++) if (v < s || v >= e) { if (cuts.neck[v] !== Infinity || cuts.keep[v] !== defaults.keep[v]) throw new Error(`${name}: vertex ${v} off the front is cut`); }
        // keep on the front is the neckline's (its length cut is the whole of it); past the side ends (along the raglan
        // or the shoulder seam) nothing is cut
        let notMin = 0, pastSide = 0;
        for (let v = s; v < e; v++) {
          if (cuts.keep[v] !== Math.min(1, cuts.neck[v])) notMin++;
          if (Math.abs(t.sewn.uv[2 * v]) > neckEdge[0][0] + 1e-6 && cuts.neck[v] < 0) pastSide++;
        }
        expect(notMin, name).toBe(0);
        expect(pastSide, name).toBe(0);
        // 0 at the side end, so a sleeve's or the back's neckline is never cut; some of the front is cut away
        for (const v of sideEnds) expect(Math.abs(cuts.neck[v]), name).toBeLessThan(0.001);
        expect(Array.from(cuts.neck.subarray(s, e)).some((x) => x < -0.01), name).toBe(true);
        // the centre front: the fold's highest kept vertex stands under the line by its own distance
        let best = -1;
        for (const v of fold) if (cuts.neck[v] > 0 && (best < 0 || cuts.neck[v] < cuts.neck[best])) best = v;
        const line = t.sewn.uv[2 * best + 1] + cuts.neck[best];
        expect(Math.abs(herY(line) - (measure.neck.front[1] - depth)), name).toBeLessThan(0.002);
        // and everything on the fold above it is cut away
        for (const v of fold) if (t.sewn.uv[2 * v + 1] > line + 0.001) expect(cuts.neck[v]).toBeLessThan(0);
      }
    }, TAILOR_MS);

    it(`${c}: the NECKLINE is clamped to her breasts' lower crease (neckDeepest)`, () => {
      const t = tee(c, true), deepest = garmentStops(t).neckDeepest;
      const at = garmentCuts(t, { ...settingsOf(c), neckDepth: deepest }), past = garmentCuts(t, { ...settingsOf(c), neckDepth: 0.3 });
      expect(past.neck).toEqual(at.neck);
      expect(past.keep).toEqual(at.keep);
      const shallower = garmentCuts(t, { ...settingsOf(c), neckDepth: deepest - 0.02 });
      expect(shallower.neck).not.toEqual(at.neck);
    }, TAILOR_MS);
  }

  it('cuts fast enough for a slider: well under 10 ms a call, warm, on the full-extent tee', () => {
    const t = tee('raglan', true), base = settingsOf('raglan');
    const settings: GarmentSettings[] = [];
    for (let k = 0; k < 24; k++) settings.push({ ...base, length: (k * 37) % 101, frontHem: ((k % 5) - 2) * 0.02, backHem: ((k % 3) - 1) * 0.03, hemCurve: (k % 4) / 3, sleeve: (k * 53) % 101, neckDepth: 0.04 + (k % 6) * 0.025, neckCurve: (k % 3) / 2 });
    for (const s of settings.slice(0, 4)) garmentCuts(t, s);
    const ms: number[] = [];
    for (const s of settings) { const t0 = performance.now(); garmentCuts(t, s); ms.push(performance.now() - t0); }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length / 2)]).toBeLessThan(10);
  }, TAILOR_MS);
});
