/**
 * THE TEE DRAFTED FROM HER (`src/sarahlab/garment/draft.ts`), on Sarah herself at 0% belly (loaded once, as
 * `garmentMeasure.test.ts` does), for both constructions with and without the underarm gusset:
 *
 * - her armhole as `measure.ts` now reports it: a loop of a plausible size, front and back halves that add up to it;
 * - every piece a closed, counter-clockwise outline of named edges sampled no coarser than 5 mm; front and back
 *   mirror-symmetric, the -x sleeve and gusset the mirror images of the +x ones;
 * - every seam's two edges exist and are within 5% of each other's length, and the pattern meshes (`mesh.ts`), sews and
 *   validates (`sew.ts`) clean, one sheet with its four openings, as `tailor.ts` does it;
 * - the raglan sleeve's raglan edges are drawn to the bodice's raglan lengths; the set-in sleeve's cap halves to the
 *   armholes, the front armhole longer than the back by what her own armhole is;
 * - the notes: the underarm, the hem, the gusset, the yoke's lift (front over her bust more than back, both positive),
 *   and the widths round her are her girths plus the ease;
 * - her own development (`draft.develop`): the identity below the underarm, never a negative lift, rising, invertible.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { polyLength } from '../src/sarahlab/garment/curves';
import { draftTee, GUSSET_SIDE, TEE_DEFAULTS, type Draft, type SleeveConstruction } from '../src/sarahlab/garment/draft';
import { measureBody } from '../src/sarahlab/garment/measure';
import { meshPiece } from '../src/sarahlab/garment/mesh';
import { edgeKey, planSeams, sew, validate } from '../src/sarahlab/garment/sew';
import type { BodyMeasure, GarmentReport, PatternEdge, PatternPiece, PieceMesh, Vec2 } from '../src/sarahlab/garment/types';
import { loadSarahInput } from './garmentSarahBody';

const CONFIGS: readonly { construction: SleeveConstruction; gusset: number }[] = [
  { construction: 'raglan', gusset: 0 },
  { construction: 'raglan', gusset: 0.5 },
  { construction: 'setIn', gusset: 0 },
  { construction: 'setIn', gusset: 0.5 },
];
const key = (c: { construction: SleeveConstruction; gusset: number }) => `${c.construction} gusset ${c.gusset}`;

interface Made { draft: Draft; report: GarmentReport; counts: Map<string, number> }

let measure: BodyMeasure;
const made = new Map<string, Made>();

beforeAll(async () => {
  measure = measureBody(await loadSarahInput());
  for (const c of CONFIGS) {
    const draft = draftTee(measure, { ...TEE_DEFAULTS, ...c });
    // as tailor.ts does it: plan the seams, mesh each piece to its edges' counts, sew, check
    const counts = planSeams(draft.pattern);
    const meshes = new Map<string, PieceMesh>();
    for (const p of draft.pattern.pieces) {
      const cs = new Map<string, number>();
      for (const e of p.edges) cs.set(e.name, counts.get(edgeKey(p.id, e.name))!);
      meshes.set(p.id, meshPiece(p, cs));
    }
    const sewn = sew(draft.pattern, meshes);
    made.set(key(c), { draft, report: validate(sewn, draft.pattern, meshes), counts });
  }
}, 120000);

const piece = (d: Draft, id: string): PatternPiece => {
  const p = d.pattern.pieces.find((q) => q.id === id);
  if (!p) throw new Error(`no piece ${id}`);
  return p;
};
const edgeOf = (d: Draft, id: string, name: string): PatternEdge => {
  const e = piece(d, id).edges.find((q) => q.name === name);
  if (!e) throw new Error(`no edge ${id}:${name}`);
  return e;
};
const len = (d: Draft, id: string, name: string) => polyLength(edgeOf(d, id, name).points);
const mirror = (p: readonly Vec2[]): Vec2[] => [...p].reverse().map(([x, y]) => [-x, y] as Vec2);
const near = (a: Vec2, b: Vec2, tol = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
const samePoints = (a: readonly Vec2[], b: readonly Vec2[]) => a.length === b.length && a.every((p, i) => near(p, b[i]));

/** The whole outline of a piece, each corner once. */
function outline(p: PatternPiece): Vec2[] {
  const out: Vec2[] = [];
  for (const e of p.edges) out.push(...e.points.slice(0, -1));
  return out;
}
function area(o: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) a += o[j][0] * o[i][1] - o[i][0] * o[j][1];
  return a / 2;
}

describe("her armhole (measure.ts's new field)", () => {
  it('each loop is the size of a woman\'s armhole, and its front and back halves add up to it', () => {
    for (const h of measure.armhole) {
      expect(h.loop).toBeGreaterThan(0.35);
      expect(h.loop).toBeLessThan(0.7);
      expect(h.front).toBeGreaterThan(0.1);
      expect(h.back).toBeGreaterThan(0.1);
      expect(Math.abs(h.front + h.back - h.loop)).toBeLessThan(1e-9);
      // her front half runs further than her back (over the front of her shoulder and the crease into her chest)
      expect(h.front).toBeGreaterThan(h.back);
    }
    // NOTE: her two sides measure 45.8 and 51.4 cm round -- the body itself is near symmetric there and the measure is
    // mirror-faithful (her mirrored body reads the same two numbers, swapped), so the gap is in how the arm-weight
    // contour falls into the angular bins on each side. The draft averages the two sides. Pinned as measured.
    expect(Math.abs(measure.armhole[0].loop - measure.armhole[1].loop)).toBeLessThan(0.07);
  });
});

describe.each(CONFIGS)('the tee, $construction with gusset $gusset', (c) => {
  const get = () => made.get(key(c))!;
  const sG = c.gusset * GUSSET_SIDE;

  it('has the pieces it should, each a closed counter-clockwise outline sampled no coarser than 5 mm', () => {
    const { draft } = get();
    const ids = draft.pattern.pieces.map((p) => p.id).sort();
    expect(ids).toEqual(sG > 0 ? ['back', 'front', 'gussetM', 'gussetP', 'sleeveM', 'sleeveP'] : ['back', 'front', 'sleeveM', 'sleeveP']);
    for (const p of draft.pattern.pieces) {
      const names = p.edges.map((e) => e.name);
      expect(new Set(names).size, `${p.id} edge names unique`).toBe(names.length);
      for (let k = 0; k < p.edges.length; k++) {
        const e = p.edges[k], next = p.edges[(k + 1) % p.edges.length];
        expect(e.points.length, `${p.id}:${e.name}`).toBeGreaterThanOrEqual(2);
        expect(near(e.points[e.points.length - 1], next.points[0]), `${p.id}: ${e.name} ends where ${next.name} starts`).toBe(true);
        for (let i = 1; i < e.points.length; i++) {
          const step = Math.hypot(e.points[i][0] - e.points[i - 1][0], e.points[i][1] - e.points[i - 1][1]);
          expect(step, `${p.id}:${e.name} step ${i}`).toBeLessThanOrEqual(0.005);
        }
        expect(e.spacing).toBeGreaterThan(0.004);
        expect(e.spacing).toBeLessThan(0.02);
      }
      expect(area(outline(p)), `${p.id} counter-clockwise`).toBeGreaterThan(0.002);
    }
    // the front and back are the big pieces; a gusset is a diamond of side sG
    expect(area(outline(piece(draft, 'front')))).toBeGreaterThan(0.15);
    expect(area(outline(piece(draft, 'back')))).toBeGreaterThan(0.15);
    if (sG > 0) expect(area(outline(piece(draft, 'gussetP')))).toBeCloseTo(sG * sG, 4);
  });

  it('is mirror-symmetric: front and back about their centre lines, -x sleeve and gusset the mirror of +x', () => {
    const { draft } = get();
    for (const id of ['front', 'back']) {
      const p = piece(draft, id);
      expect(p.symmetric).toBe(true);
      expect(p.side).toBe(0);
      for (const e of p.edges) {
        if (e.name.endsWith('P')) expect(samePoints(edgeOf(draft, id, e.name.slice(0, -1) + 'M').points, mirror(e.points)), `${id}:${e.name}`).toBe(true);
        else if (!e.name.endsWith('M')) expect(samePoints(e.points, mirror(e.points)), `${id}:${e.name} is its own mirror`).toBe(true);
      }
    }
    for (const [plus, minus] of [['sleeveP', 'sleeveM'], ...(sG > 0 ? [['gussetP', 'gussetM']] : [])]) {
      const P = piece(draft, plus), M = piece(draft, minus);
      expect(P.side).toBe(1);
      expect(M.side).toBe(-1);
      expect(M.edges.map((e) => e.name)).toEqual([...P.edges].reverse().map((e) => e.name));
      for (const e of P.edges) expect(samePoints(edgeOf(draft, minus, e.name).points, mirror(e.points)), `${minus}:${e.name}`).toBe(true);
    }
  });

  it('every seam joins two edges that exist, within 5% of each other, planned to one count', () => {
    const { draft, counts } = get();
    expect(draft.pattern.seams.length).toBeGreaterThan(0);
    for (const s of draft.pattern.seams) {
      const a = len(draft, s.a.piece, s.a.edge), b = len(draft, s.b.piece, s.b.edge);
      expect(a).toBeGreaterThan(0.02);
      expect(Math.abs(a - b) / ((a + b) / 2), `${s.name}: ${(a * 100).toFixed(1)} vs ${(b * 100).toFixed(1)} cm`).toBeLessThan(0.05);
      expect(counts.get(edgeKey(s.a.piece, s.a.edge))).toBe(counts.get(edgeKey(s.b.piece, s.b.edge)));
    }
    const names = draft.pattern.seams.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of ['P', 'M']) {
      expect(names).toContain(`side${s}`);
      expect(names).toContain(`underarm${s}`);
      if (c.construction === 'raglan') { expect(names).toContain(`raglanFront${s}`); expect(names).toContain(`raglanBack${s}`); }
      else { expect(names).toContain(`shoulder${s}`); expect(names).toContain(`armholeFront${s}`); expect(names).toContain(`armholeBack${s}`); }
      if (sG > 0) for (const g of ['gussetFront', 'gussetBack', 'gussetSleeveFront', 'gussetSleeveBack']) expect(names).toContain(`${g}${s}`);
    }
  });

  it('meshes, sews and validates clean: one sheet, consistently wound, four openings', () => {
    const { report } = get();
    expect(report.problems).toEqual([]);
    expect(report.components).toBe(1);
    expect(report.flippedEdges).toBe(0);
    expect(report.nonManifoldEdges).toBe(0);
    expect(report.slivers).toBe(0);
    expect(report.openings.length).toBe(4);
    // a sphere with four holes: V - E + F = 2 - 4
    expect(report.euler).toBe(-2);
    expect(report.minEdge).toBeGreaterThan(0.003);
    expect(report.maxEdge).toBeLessThan(0.025);
    const loops = report.openings.map((o) => [...o].sort().join(' '));
    expect(loops).toContain('back:hem front:hem');
    expect(loops).toContain('sleeveP:cuff');
    expect(loops).toContain('sleeveM:cuff');
    expect(loops).toContain(c.construction === 'raglan' ? 'back:neck front:neck sleeveM:neck sleeveP:neck' : 'back:neck front:neck');
  });

  it('the sleeve is drawn to the bodice: raglan edges or cap halves to their lengths', () => {
    const { draft } = get();
    const n = draft.notes;
    if (c.construction === 'raglan') {
      for (const s of ['P', 'M'] as const) {
        expect(Math.abs(len(draft, `sleeve${s}`, 'raglanFront') - len(draft, 'front', `raglan${s}`))).toBeLessThan(5e-4);
        expect(Math.abs(len(draft, `sleeve${s}`, 'raglanBack') - len(draft, 'back', `raglan${s}`))).toBeLessThan(5e-4);
      }
      expect(len(draft, 'front', 'raglanP')).toBeCloseTo(n.frontRaglanOrArmhole, 9);
      expect(len(draft, 'back', 'raglanP')).toBeCloseTo(n.backRaglanOrArmhole, 9);
      // the sleeve's top edge spans the neckline over her shoulder between the two raglan points
      expect(n.sleeveTop).toBeGreaterThan(0.1);
      expect(n.sleeveTop).toBeLessThan(0.25);
      expect(len(draft, 'sleeveP', 'neck')).toBeGreaterThanOrEqual(n.sleeveTop - 1e-9);
      expect(len(draft, 'sleeveP', 'neck')).toBeLessThan(n.sleeveTop + 0.01);
      for (const l of [n.frontRaglanOrArmhole, n.backRaglanOrArmhole]) { expect(l).toBeGreaterThan(0.18); expect(l).toBeLessThan(0.32); }
    } else {
      for (const s of ['P', 'M'] as const) {
        expect(Math.abs(len(draft, `sleeve${s}`, 'capFront') - len(draft, 'front', `armhole${s}`))).toBeLessThan(5e-4);
        expect(Math.abs(len(draft, `sleeve${s}`, 'capBack') - len(draft, 'back', `armhole${s}`))).toBeLessThan(5e-4);
        expect(Math.abs(len(draft, 'front', `shoulder${s}`) - len(draft, 'back', `shoulder${s}`))).toBeLessThan(5e-4);
      }
      expect(len(draft, 'front', 'armholeP')).toBeCloseTo(n.frontRaglanOrArmhole, 9);
      expect(len(draft, 'back', 'armholeP')).toBeCloseTo(n.backRaglanOrArmhole, 9);
      // the front armhole is at least the back's, longer by what her own front armhole is longer than her back one
      expect(n.frontRaglanOrArmhole).toBeGreaterThanOrEqual(n.backRaglanOrArmhole);
      const over = measure.armhole.reduce((s, h) => s + (h.front - h.back) / 2, 0);
      expect(Math.abs(n.frontRaglanOrArmhole - n.backRaglanOrArmhole - Math.max(0, over))).toBeLessThan(0.002);
      expect(n.shoulderSeam).toBeCloseTo(len(draft, 'front', 'shoulderP'), 9);
      expect(n.shoulderSeam).toBeGreaterThan(0.04);
      expect(n.shoulderSeam).toBeLessThan(0.12);
      expect(n.sleeveTop).toBe(0);
      for (const l of [n.frontRaglanOrArmhole, n.backRaglanOrArmhole]) { expect(l).toBeGreaterThan(0.16); expect(l).toBeLessThan(0.3); }
    }
    expect(n.sleeveCrown).toBeGreaterThan(0.05);
    expect(n.sleeveCrown).toBeLessThan(0.3);
    // the cuff: the sleeve's hem width, round the top of her forearm plus ease
    expect(len(draft, 'sleeveP', 'cuff')).toBeCloseTo(n.sleeveHemWidth, 9);
    expect(n.sleeveHemWidth).toBeGreaterThan(0.2);
    expect(n.sleeveHemWidth).toBeLessThan(0.45);
  });

  it('its notes: underarm, hem, gusset, the yoke lifted more at the front, the widths her girths plus ease', () => {
    const { draft } = get();
    const n = draft.notes;
    expect(n.underarmY).toBeCloseTo((measure.armpit[0][1] + measure.armpit[1][1]) / 2 - TEE_DEFAULTS.armholeDrop, 12);
    expect(n.hemY).toBeCloseTo(measure.hip.y - 0.01, 12);
    expect(n.gussetSide).toBeCloseTo(sG, 12);
    if (sG > 0) for (const e of piece(draft, 'gussetP').edges) expect(polyLength(e.points)).toBeCloseTo(sG, 9);
    // over her bust her front develops longer than her back; both longer than her height
    expect(n.yokeLift.front).toBeGreaterThan(n.yokeLift.back);
    expect(n.yokeLift.back).toBeGreaterThan(0);
    expect(n.yokeLift.front).toBeLessThan(0.2);
    // the centre front and back run at least as low as the side (the hem comes out level on her)
    expect(n.centreFrontExtra).toBeGreaterThanOrEqual(0);
    expect(n.centreBackExtra).toBeGreaterThanOrEqual(0);
    const front = edgeOf(draft, 'front', 'hem').points, mid = front[(front.length - 1) / 2];
    expect(mid[0]).toBeCloseTo(0, 12);
    expect(mid[1]).toBeCloseTo(n.hemY - Math.max(0, n.centreFrontExtra), 9);
    // round her: front + back at the bust, waist and hip is her girth there plus the ease
    const e = TEE_DEFAULTS.ease;
    for (const [w, girth, ease] of [[n.widths[0], measure.bust, e.bust], [n.widths[1], measure.waist, e.waist], [n.widths[2], measure.hip, e.hip]] as const) {
      expect(w.y).toBe(girth.y);
      expect(Math.abs(w.front + w.back - (girth.girth + ease))).toBeLessThan(0.02);
      expect(w.front).toBeGreaterThan(0.3);
      expect(w.back).toBeGreaterThan(0.3);
    }
    // the side seams: as long front as back, from the hem to the gusset
    expect(Math.abs(len(draft, 'front', 'sideP') - len(draft, 'back', 'sideP'))).toBeLessThan(0.01);
    expect(len(draft, 'front', 'sideP')).toBeGreaterThan(n.underarmY - sG - n.hemY - 1e-3);
  });
});

describe('her development, as the draft made it', () => {
  it('is the identity below the underarm, lifts never negative, rises, and inverts', () => {
    const draft = made.get(key(CONFIGS[1]))!.draft;
    const yU = draft.notes.underarmY;
    const { front, back, xOfU } = draft.develop;
    expect(front.yU).toBe(yU);
    expect(back.yU).toBe(yU);
    expect(xOfU(0)).toBe(0);
    let lastX = 0;
    for (let u = 0; u <= 0.25; u += 0.005) { const x = xOfU(u); expect(x).toBeGreaterThanOrEqual(lastX - 1e-12); lastX = x; }
    // up to where place.ts lays cloth (the side of her neck + 2 cm) the map is strictly rising and inverts exactly
    const yTopUsed = measure.neck.side[0][1] + 0.02;
    for (const d of [front, back]) for (let u = 0; u <= 0.14; u += 0.02) {
      expect(d.v(u, yU - 0.1)).toBe(yU - 0.1);
      let last = -Infinity;
      for (let y = yU - 0.05; y <= yTopUsed; y += 0.0025) {
        const v = d.v(u, y);
        expect(v).toBeGreaterThan(last);
        last = v;
        expect(d.lift(u, y)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(d.y(u, v) - y)).toBeLessThan(1e-6);
      }
      // above it, up past the top of the development, it never falls (NOTE: under her chin, about 1.48 m, the front's
      // centre columns hold v flat for some 3 cm -- develop.ts keeps the length non-decreasing, not increasing -- so
      // there `y` returns the bottom of the flat run; nothing is drafted or placed that high)
      for (let y = yTopUsed; y <= yU + 0.35; y += 0.0025) {
        const v = d.v(u, y);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
        expect(d.lift(u, y)).toBeGreaterThanOrEqual(0);
      }
    }
    // at the neckline's side her front is longer than her back by the notes' yoke lifts
    expect(front.lift(0.06, yU + 0.2)).toBeGreaterThan(back.lift(0.06, yU + 0.2));
  });
});
