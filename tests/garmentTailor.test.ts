/**
 * TAILORING END TO END ON HER (`src/sarahlab/garment/tailor.ts`, which lays the sheet round her through `place.ts`), on
 * Sarah at 0% belly, measured once and tailored raglan and set-in with the default gusset:
 *
 * - the sewn sheet is sound: one component, no flipped or non-manifold edge, four openings, no problems;
 * - every particle is placed, at finite rest metres; the body pieces stay on her trunk (|x| under 35 cm, between her hem
 *   and her neck), the front piece in front of her side plane and the back behind it, each sleeve on its own side and
 *   near its own arm -- the gross failures of a first placing (cloth thrown to the wrong side of her) -- and few edges
 *   start stretched past three times their pattern length (the placing is a rough start; the cloth does the fitting);
 * - body-piece particles are trunk-only and bind to her trunk; sleeve particles do not.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FACE_REST_OFFSET, FACE_REST_SCALE } from '../src/sarahlab/faceRig';
import { BIND_ANY, BIND_ARM, BIND_TRUNK } from '../src/sarahlab/garment/bind';
import { TEE_DEFAULTS, type SleeveConstruction } from '../src/sarahlab/garment/draft';
import { midZ } from '../src/sarahlab/garment/form';
import { measureBody } from '../src/sarahlab/garment/measure';
import { tailor, type Tailored } from '../src/sarahlab/garment/tailor';
import type { BodyInput, BodyMeasure, Vec3 } from '../src/sarahlab/garment/types';
import { loadSarahInput } from './garmentSarahBody';

let input: BodyInput;
let measure: BodyMeasure;
const tailored = new Map<SleeveConstruction, Tailored>();

beforeAll(async () => {
  input = await loadSarahInput();
  measure = measureBody(input);
  for (const construction of ['raglan', 'setIn'] as const) {
    tailored.set(construction, tailor(input, { ...TEE_DEFAULTS, construction }, { scale: FACE_REST_SCALE, offset: FACE_REST_OFFSET, measure }));
  }
}, 120000);

/** Which pieces' roles each particle has a vertex in. */
function rolesOf(t: Tailored): { torso: Uint8Array; front: Uint8Array; back: Uint8Array; sleeve: Int8Array; gusset: Uint8Array } {
  const n = t.sewn.count, pieces = t.draft.pattern.pieces;
  const torso = new Uint8Array(n), front = new Uint8Array(n), back = new Uint8Array(n), gusset = new Uint8Array(n);
  const sleeve = new Int8Array(n); // +1 sleeveP, -1 sleeveM, 2 both (never)
  for (let v = 0; v < t.sewn.vertexParticle.length; v++) {
    const p = pieces[t.sewn.vertexPiece[v]], i = t.sewn.vertexParticle[v];
    if (p.role === 'torso') { torso[i] = 1; if (p.id === 'front') front[i] = 1; else back[i] = 1; }
    else if (p.role === 'sleeve') sleeve[i] = sleeve[i] && sleeve[i] !== p.side ? 2 : p.side;
    else gusset[i] = 1;
  }
  return { torso, front, back, sleeve, gusset };
}

/** Distance from p to the segment a-b. */
function toSegment(p: readonly number[], a: Vec3, b: Vec3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2)));
  return Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
}

describe.each(['raglan', 'setIn'] as const)('tailoring her a %s tee', (construction) => {
  const get = () => tailored.get(construction)!;

  it('sews one sound sheet with four openings', () => {
    const { report, sewn } = get();
    expect(report.problems).toEqual([]);
    expect(report.components).toBe(1);
    expect(report.flippedEdges).toBe(0);
    expect(report.nonManifoldEdges).toBe(0);
    expect(report.openings.length).toBe(4);
    expect(sewn.openings.length).toBe(4);
    expect(report.particles).toBe(sewn.count);
    expect(sewn.count).toBeGreaterThan(3000);
    expect(sewn.count).toBeLessThan(10000);
  });

  it('places every particle at finite rest metres, on her', () => {
    const { placed, sewn } = get();
    const P = placed.positions;
    expect(P.length).toBe(sewn.count * 3);
    expect(placed.region.length).toBe(sewn.count);
    expect(placed.trunkOnly.length).toBe(sewn.count);
    let unplaced = 0;
    for (let i = 0; i < sewn.count; i++) {
      for (let k = 0; k < 3; k++) expect(Number.isFinite(P[3 * i + k])).toBe(true);
      if (P[3 * i] === 0 && P[3 * i + 1] === 0 && P[3 * i + 2] === 0) unplaced++;
      // within her bounding box, give or take a hand
      expect(Math.abs(P[3 * i])).toBeLessThan(0.6);
      expect(P[3 * i + 1]).toBeGreaterThan(0.7);
      expect(P[3 * i + 1]).toBeLessThan(measure.height);
    }
    expect(unplaced).toBe(0);
  });

  it('keeps the body pieces on her trunk, the front in front of her side plane and the back behind it', () => {
    const t = get(), P = t.placed.positions, roles = rolesOf(t);
    const yLow = t.draft.notes.hemY - Math.max(t.draft.notes.centreFrontExtra, t.draft.notes.centreBackExtra) - 0.03;
    const yHigh = measure.neck.side[0][1] + 0.03;
    let frontWrong = 0, backWrong = 0, frontOnly = 0, backOnly = 0, maxX = 0;
    for (let i = 0; i < t.sewn.count; i++) {
      if (!roles.torso[i]) continue;
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      maxX = Math.max(maxX, Math.abs(x));
      expect(Math.abs(x)).toBeLessThan(0.35);
      expect(y).toBeGreaterThan(yLow);
      expect(y).toBeLessThan(yHigh);
      // a particle of the front alone (not on the side seam) stands in front of the plane halfway through her
      const zs = midZ(measure.form, y);
      if (roles.front[i] && !roles.back[i]) { frontOnly++; if (z < zs - 0.01) frontWrong++; }
      if (roles.back[i] && !roles.front[i]) { backOnly++; if (z > zs + 0.01) backWrong++; }
    }
    expect(frontOnly).toBeGreaterThan(1000);
    expect(backOnly).toBeGreaterThan(1000);
    expect(frontWrong / frontOnly).toBeLessThan(0.01);
    expect(backWrong / backOnly).toBeLessThan(0.01);
    // her trunk is about 36 cm across at its widest; a torso particle further out than 25 cm is off her
    expect(maxX).toBeLessThan(0.25);
    // and the centre of the front is in front of the centre of the back
    let fz = 0, bz = 0;
    for (let i = 0; i < t.sewn.count; i++) { if (roles.front[i] && !roles.back[i]) fz += P[3 * i + 2]; if (roles.back[i] && !roles.front[i]) bz += P[3 * i + 2]; }
    expect(fz / frontOnly - bz / backOnly).toBeGreaterThan(0.12);
  });

  it('puts each sleeve on its own side, round its own arm', () => {
    const t = get(), P = t.placed.positions, roles = rolesOf(t);
    let wrongSide = 0, far = 0, n = 0;
    for (let i = 0; i < t.sewn.count; i++) {
      const s = roles.sleeve[i];
      if (s !== 1 && s !== -1) { expect(s).toBe(0); continue; }
      n++;
      const p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
      if (Math.sign(p[0]) !== s) wrongSide++;
      const a = measure.arms[s > 0 ? 0 : 1];
      const d = Math.min(toSegment(p, a.shoulder, a.elbow), toSegment(p, a.elbow, a.wrist));
      if (roles.torso[i] === 0 && d > 0.15) far++;
    }
    expect(n).toBeGreaterThan(500);
    expect(wrongSide).toBe(0);
    expect(far).toBe(0);
  });

  it('starts few edges stretched past three times their pattern length', () => {
    const { placed, sewn } = get();
    const P = placed.positions, E = sewn.edges, R = sewn.edgeRest, m = R.length;
    let over = 0, under = 0;
    for (let e = 0; e < m; e++) {
      const a = E[2 * e], b = E[2 * e + 1];
      const l = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
      expect(R[e]).toBeGreaterThan(0);
      if (l > 3 * R[e]) over++;
      if (l < R[e] / 3) under++;
    }
    expect(over / m).toBeLessThan(0.15);
    expect(under / m).toBeLessThan(0.15);
  });

  it('binds the body pieces to her trunk only; the sleeves to her arm or either', () => {
    const t = get(), roles = rolesOf(t), { region, trunkOnly } = t.placed;
    let arm = 0;
    for (let i = 0; i < t.sewn.count; i++) {
      if (roles.torso[i]) {
        expect(trunkOnly[i]).toBe(1);
        expect(region[i]).toBe(BIND_TRUNK);
      } else {
        expect(trunkOnly[i]).toBe(0);
        expect([BIND_ARM, BIND_ANY]).toContain(region[i]);
        if (region[i] === BIND_ARM) arm++;
      }
      if (roles.gusset[i] && !roles.torso[i] && !roles.sleeve[i]) expect(region[i]).toBe(BIND_ANY);
    }
    // the sleeve tubes below the underarm are most of each sleeve
    expect(arm).toBeGreaterThan(300);
  });

  it('keeps the measure it was given and times every step', () => {
    const t = get();
    expect(t.measure).toBe(measure);
    for (const ms of Object.values(t.ms)) { expect(Number.isFinite(ms)).toBe(true); expect(ms).toBeGreaterThanOrEqual(0); }
    expect(t.meshes.size).toBe(t.draft.pattern.pieces.length);
  });
});
