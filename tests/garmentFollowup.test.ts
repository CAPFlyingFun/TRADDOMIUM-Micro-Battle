/**
 * THE STAGE 2b FOLLOW-UP to the procedural tee, pinned where each change lives:
 *
 * - `draft.ts` BUST SHAPING (`TeeParams.bustShaping`, set-in only): absent or 'none' drafts exactly what it did before
 *   (bustLift 0, side seams sideP/sideM with no ease); 'ease' raises the upper front by bustLift (0 < it <= 6 cm), cuts
 *   the front's side that much longer than the back's and says so on the side seams (`ease`); 'dart' splits each side
 *   seam into sideLow/sideHigh, matched front to back, and folds the extra length into a dart of two equal legs whose
 *   point stands inside the front, toward her centre front. Raglan ignores it.
 * - Tailored on her with each set-in shaping, the sheet is as sound as the plain one (garmentTailor.test.ts's check),
 *   which is `sew.ts`'s validate allowing a seam its own `ease` on top of EASE_LIMIT -- and the same sewn sheet checked
 *   against the pattern with that `ease` stripped is refused, so the allowance is what lets it through.
 * - `draft.ts` `teeParams`: R2 by default (neckWidth 0.18, neckBand 0.9, armholeBand 0.05), a set-in's own neckline
 *   (SET_IN_NECK: 0.20, no band), what is asked for over both, every other field the defaults'; R0 one call away.
 * - `place.ts` armholeBand (passed by tailor from TeeParams): on her, a set-in placed at 0 keeps every body particle
 *   not shared with a sleeve or gusset trunk-only; at 5 cm exactly the body particles within 5 cm (flat) of their
 *   piece's armhole go with the sleeve, a real band, nothing else changes; a raglan has no armhole and is unchanged.
 * - `clothSkin.ts` contact rescue (`rescueOver`, `neighbours`), on a hairpin of skin whose bottom is a local minimum of
 *   the walk for a particle above its top: absent, never runs; set, one slot in 32 is looked at per update (phase 1
 *   first) and a stuck contact is moved to the skin under it, starting fresh; a fold beyond the search's 250 triangles
 *   is reached only through a cloth neighbour's contact; and a particle with nothing nearer is looked at again only
 *   once 1.5 times as far off (`rescueChecked`). GarmentCloth hands its skin RESCUE_OVER and the sewn sheet's
 *   neighbours.
 * - `clothSim.ts` `selfDistance`: absent or 0, a falling sheet passes through a pinned one and no pair is counted; at d,
 *   after every step no particle of one sheet is within d of the other's and pairs are counted exactly when they touch;
 *   a pinned particle is never moved by the push. GarmentCloth's sim runs at SELF_DISTANCE (overridable, 0 turns it
 *   off) and BEND_COMPLIANCE (always).
 * - `garmentDetail.ts` tips: on a synthetic flat detail whose centre stands 0.2 proud with a TIP vertex 0.5 proud beside
 *   it (and a taller vertex beyond the inner ring), the vertices round each centre at rest are those inside the inner
 *   ring (the tip in, the far one out), round her navel those inside its OUTER ring; `follow` measures the tallest as
 *   the tip each frame; the dome stands over it, at the tip's height and DOME_MARGIN more within domeIn of its axis;
 *   without a tip, or without a rest body, it stands over the centre as before; with domes off, the tips are measured
 *   and the contacts left alone.
 * - `garmentDetail.ts` BREAST and NAVEL DETAIL (`keep`): a nipple's dome is as high (amount) and as wide (hide) as
 *   BREAST DETAIL hides it, the navel's always whole and only widened; the tent from the tip stands at every amount, so
 *   the cloth over the tip never sinks under it; keep is clamped (NaN as 0); `shading` is the cloth tee's own.
 * - `garmentDetail.ts` `spacing`/`flat`: each detail's spacing is SPACING_SLACK times the farthest corner (off its axis)
 *   of the one cloth triangle its axis crosses nearest its tip (a diagnostic now); that triangle's corners (`cover`) are
 *   held at the tip's height and DOME_MARGIN (`domeOver`'s `lift`) wherever they are -- unless one reaches past
 *   COVER_REACH·rho, when nothing is held. `domeOver`'s `flat` still widens
 *   the flat top and moves its fall out with it; 0, NaN, Infinity change nothing.
 *   `GarmentCloth.detailGap`: the sheet over a tip along its axis, positive above it, negative when the tip is through.
 * - `GarmentDetail.shading(keep, gaps, touch)`: the tee's own spots, each softened by how far the cloth stands off its tip
 *   past `touch` -- radius hypot(r, gap - touch), height kept in volume (h r²) -- and left as the tee's for no gap, a
 *   non-finite one or one within touch; then no steeper than `shade.slope` (0.86 h / r), a steep spot's height capped;
 *   the navel's alone first grown by `shade.grow` (SHADE_NAVEL_GROW), its height kept.
 * - `GarmentDetail.apex`: the cloth point nearest her navel's axis (within APEX_REACH·rho, and a band along it) laid on
 *   the axis and held at the tip's height and DOME_MARGIN; none for the nipples, none with domes off. Its height
 *   (`apexAlong`) is what clears her navel's relief under the triangles round it -- for a vertex at weights (wa, wb, wc),
 *   (relief + margin - wb·hB - wc·hC) / wa, wa over 0.05, the whole at most APEX_MAX of the tip's -- and `domeOver`'s
 *   `liftTo` holds it there.
 * - `garmentCloth.ts` `refit`: no change of her shape leaves every edge as drafted and the cloth where it lies; her
 *   body scaled (her BUILD's rest shift, as the room drives it) cuts each edge by how far her skin under it stretched,
 *   clamped to FIT_MIN..FIT_MAX; `settle` carries the scale over; `setRestShift(null, true)` resets it.
 *   With `tailoredShape` the cut is ABSOLUTE: measured from the shape it was tailored from on her skin points
 *   (`restShape`'s offsetShare 0), smoothed (FIT_SMOOTHING), and not down skin that faces down (HANG_FROM..HANG_TO):
 *   the same for the same shape whatever path led there, a settle included; still clamped; `fitMap`/`strainMap` read it.
 * - `garmentCloth.ts` `neckBand`: the edges along the neckline opening rest at band x their pattern length, every other
 *   edge at its own; and the cloth hands ClothSkin looseOverArm = LOOSE_OVER_ARM unless `armpitRule` is false.
 * - `clothSkin.ts` `looseOverArm`: absent, no arm share, loose map or last contact is kept and every particle has its
 *   floor and is carried by her skin. Set, `triArm` is each triangle's mean arm share and `triLoose` marks the
 *   triangles whose rest normal is less than half upward; a TRUNK particle on a triangle her arm carries more than that
 *   share of has no floor (standOff -1e9) where it is loose -- under her arm -- and elsewhere -- her shoulder's top --
 *   keeps its floor but is not carried: across an update in which her arm bone turns, its `carried` is its last
 *   contact point (never on a fresh contact). Sleeve particles (trunkOnly 0) there, a trunk particle on skin her arm
 *   barely carries, and everything under a higher threshold are floored and carried with her skin.
 *
 * Sarah's body is loaded and measured once; set-in is tailored three times (plain, 'ease', 'dart') and raglan once,
 * each on first use; the armhole band re-places those sheets with placeGarment rather than tailoring again. The cloth checks run
 * on small skinned shapes, as garmentCloth.test.ts and clothSkinGarment.test.ts do.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ClothSkin } from '../src/sarahlab/clothSkin';
import { createContacts, type ClothBinding, type SkinContacts } from '../src/sarahlab/clothTypes';
import type { ClothTopology } from '../src/sarahlab/clothSim';
import { FACE_REST_OFFSET, FACE_REST_SCALE } from '../src/sarahlab/faceRig';
import { polyLength } from '../src/sarahlab/garment/curves';
import { BIND_ANY, BIND_TRUNK } from '../src/sarahlab/garment/bind';
import { draftTee, SET_IN_NECK, TEE_DEFAULTS, teeParams, type Draft, type TeeParams } from '../src/sarahlab/garment/draft';
import { ClothSim, type ClothSettings } from '../src/sarahlab/clothSim';
import { BEND_COMPLIANCE, FIT_MAX, FIT_MIN, FIT_SMOOTHING, GarmentCloth, HANG_FROM, HANG_TO, LOOSE_OVER_ARM, RESCUE_OVER, SELF_DISTANCE } from '../src/sarahlab/garment/garmentCloth';
import { APEX_MAX, APEX_REACH, COVER_REACH, DOME_MARGIN, domeOver, GarmentDetail, SHADE_NAVEL_GROW, SHADE_SLOPE, SHADE_SPREAD, SPACING_SLACK, TENT_SLOPE, type RestBody } from '../src/sarahlab/garment/garmentDetail';
import { DETAIL_LOOK, DetailSpots, type DetailPoints, type Poser } from '../src/sarahlab/detailSpots';
import { measureBody } from '../src/sarahlab/garment/measure';
import { placeGarment, type Placed } from '../src/sarahlab/garment/place';
import { validate } from '../src/sarahlab/garment/sew';
import { tailor, type Tailored } from '../src/sarahlab/garment/tailor';
import type { BodyInput, BodyMeasure, Pattern, PatternPiece, SewnGarment, Vec2 } from '../src/sarahlab/garment/types';
import { loadSarahInput } from './garmentSarahBody';

type Shaping = 'plain' | 'ease' | 'dart';
const SET_IN: TeeParams = { ...TEE_DEFAULTS, construction: 'setIn' };
const paramsOf = (s: Shaping): TeeParams => (s === 'plain' ? SET_IN : { ...SET_IN, bustShaping: s });

let input: BodyInput;
let measure: BodyMeasure;
const tailored = new Map<Shaping, Tailored>();
/** Tailored once per shaping, on first use: a variant that cannot be made fails its own tests and no other's. */
function tailoredOf(s: Shaping): Tailored {
  if (!tailored.has(s)) tailored.set(s, tailor(input, paramsOf(s), { scale: FACE_REST_SCALE, offset: FACE_REST_OFFSET, measure }));
  return tailored.get(s)!;
}
const TAILOR_MS = 60000;
let raglan: Tailored | null = null;
/** The default (raglan) tee tailored, on first use. */
const raglanTee = (): Tailored => (raglan ??= tailor(input, TEE_DEFAULTS, { scale: FACE_REST_SCALE, offset: FACE_REST_OFFSET, measure }));

beforeAll(async () => {
  input = await loadSarahInput();
  measure = measureBody(input);
}, 120000);

const pieceOf = (d: Draft, id: string): PatternPiece => d.pattern.pieces.find((p) => p.id === id)!;
const edgeOf = (d: Draft, piece: string, name: string) => pieceOf(d, piece).edges.find((e) => e.name === name);
const edgeLength = (d: Draft, piece: string, name: string): number => polyLength(edgeOf(d, piece, name)!.points);
const seamNames = (d: Draft): string[] => d.pattern.seams.map((s) => s.name).sort();
const edgeNames = (d: Draft, piece: string): string[] => pieceOf(d, piece).edges.map((e) => e.name);

/** Even-odd point-in-polygon. */
function inside(p: Vec2, poly: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('bust shaping in the draft (set-in only)', () => {
  it("absent and 'none' draft the same tee: no lift, plain side seams with no ease", () => {
    const absent = draftTee(measure, SET_IN), none = draftTee(measure, { ...SET_IN, bustShaping: 'none' });
    expect(absent.notes.bustLift).toBe(0);
    expect(none.notes.bustLift).toBe(0);
    expect(none.pattern).toEqual(absent.pattern);
    for (const d of [absent, none]) {
      const names = seamNames(d);
      expect(names).toContain('sideP');
      expect(names).toContain('sideM');
      expect(names.some((n) => n.startsWith('sideLow') || n.startsWith('sideHigh') || n.startsWith('bustDart'))).toBe(false);
      for (const s of d.pattern.seams) expect(s.ease).toBeUndefined();
    }
  });

  it("'ease' lifts the upper front by 0 to 6 cm and cuts the front's side seam that much longer, gathered onto the back's", () => {
    const plain = draftTee(measure, SET_IN), d = draftTee(measure, { ...SET_IN, bustShaping: 'ease' }), lift = d.notes.bustLift;
    expect(lift).toBeGreaterThan(0);
    expect(lift).toBeLessThanOrEqual(0.06);
    expect(seamNames(d)).toEqual(seamNames(plain));
    for (const s of ['P', 'M'] as const) {
      const seam = d.pattern.seams.find((x) => x.name === `side${s}`)!;
      expect(seam.ease).toBeGreaterThan(0);
      const front = edgeLength(d, 'front', `side${s}`), back = edgeLength(d, 'back', `side${s}`);
      // the front's side is stretched up by `lift` along its slant: longer than the plain front's by about that
      expect(Math.abs(front - edgeLength(plain, 'front', `side${s}`) - lift)).toBeLessThan(0.003);
      // the back's is the plain back's; the plain front and back sides already differ by a few millimetres (within
      // EASE_LIMIT), so the front exceeds the back by the lift give or take those
      expect(back).toBeCloseTo(edgeLength(plain, 'back', `side${s}`), 9);
      expect(Math.abs(front - back - lift)).toBeLessThan(0.008);
      // the ease the seam is cut with covers the mismatch it has, beyond the 5% any seam may have
      expect(seam.ease! + 0.05).toBeGreaterThan(Math.abs(front - back) / ((front + back) / 2));
    }
    // only the side seams are eased
    for (const seam of d.pattern.seams) if (!/^side[PM]$/.test(seam.name)) expect(seam.ease).toBeUndefined();
  });

  /** A set-in 'dart' draft's dart on side s: its point (where the legs meet) and its mouth's two ends on the side seam. */
  const dartOf = (d: Draft, s: 'P' | 'M') => {
    const low = edgeOf(d, 'front', `dartLow${s}`)!.points, high = edgeOf(d, 'front', `dartHigh${s}`)!.points;
    const same = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
    // the outline is walked one way on P and the other on M: the point is the end the two legs share
    const ends = [low[0], low[low.length - 1]], hends = [high[0], high[high.length - 1]];
    const point = ends.find((e) => hends.some((h) => same(e, h)))!;
    const mouthLo = ends.find((e) => e !== point)!, mouthHi = hends.find((h) => !same(h, point))!;
    return { point, mouthLo, mouthHi };
  };

  it("'dart' splits each side seam into sideLow/sideHigh, matched front to back, and sews the dart's legs to each other", () => {
    const d = draftTee(measure, { ...SET_IN, bustShaping: 'dart' });
    expect(d.notes.bustLift).toBeGreaterThan(0);
    expect(d.notes.bustLift).toBeLessThanOrEqual(0.06);
    const front = edgeNames(d, 'front'), back = edgeNames(d, 'back'), names = seamNames(d);
    for (const s of ['P', 'M'] as const) {
      for (const n of [`sideLow${s}`, `dartLow${s}`, `dartHigh${s}`, `sideHigh${s}`]) expect(front).toContain(n);
      for (const n of [`sideLow${s}`, `sideHigh${s}`]) expect(back).toContain(n);
      for (const n of [`side${s}`, `dartLow${s}`, `dartHigh${s}`]) expect(back).not.toContain(n);
      expect(front).not.toContain(`side${s}`);
      for (const n of [`sideLow${s}`, `sideHigh${s}`, `bustDart${s}`]) expect(names).toContain(n);
      expect(names).not.toContain(`side${s}`);
      const dart = d.pattern.seams.find((x) => x.name === `bustDart${s}`)!;
      expect(dart.a).toEqual({ piece: 'front', edge: `dartLow${s}` });
      expect(dart.b).toEqual({ piece: 'front', edge: `dartHigh${s}` });
      // each stretch of the side seam against its other half on the back: within the 5% any seam may differ by, and a
      // few millimetres (the plain front and back sides already differ by about 4 mm)
      for (const part of ['sideLow', 'sideHigh']) {
        const f = edgeLength(d, 'front', `${part}${s}`), b = edgeLength(d, 'back', `${part}${s}`);
        expect(Math.abs(f - b)).toBeLessThan(0.006);
        expect(Math.abs(f - b) / ((f + b) / 2)).toBeLessThan(0.05);
      }
    }
    for (const seam of d.pattern.seams) expect(seam.ease).toBeUndefined();
  });

  it("'dart' puts the dart's point inside the front, toward her centre front from its mouth, its mouth the lift wide", () => {
    const d = draftTee(measure, { ...SET_IN, bustShaping: 'dart' });
    const closed: Vec2[] = [];
    for (const e of pieceOf(d, 'front').edges) if (!e.name.startsWith('dart')) closed.push(...e.points);
    for (const s of ['P', 'M'] as const) {
      const { point, mouthLo, mouthHi } = dartOf(d, s);
      expect(Math.sign(point[0])).toBe(Math.sign(mouthLo[0]));
      expect(Math.abs(point[0])).toBeLessThan(Math.abs(mouthLo[0]) - 0.02);
      expect(Math.abs(point[0])).toBeLessThan(Math.abs(mouthHi[0]) - 0.02);
      // the mouth opens by the lift, straight up the side seam
      expect(Math.hypot(mouthHi[0] - mouthLo[0], mouthHi[1] - mouthLo[1])).toBeCloseTo(d.notes.bustLift, 6);
      // inside the front as it would be with the dart closed (the outline with its two legs replaced by the mouth)
      expect(inside(point, closed)).toBe(true);
    }
  });

  it("'dart' cuts its two legs the same length, as a dart sewn leg to leg must be", () => {
    const d = draftTee(measure, { ...SET_IN, bustShaping: 'dart' });
    for (const s of ['P', 'M'] as const) {
      expect(Math.abs(edgeLength(d, 'front', `dartLow${s}`) - edgeLength(d, 'front', `dartHigh${s}`))).toBeLessThan(0.001);
    }
  });

  it('raglan ignores it: no lift, the same seams and the same pattern', () => {
    const raglan = draftTee(measure, TEE_DEFAULTS);
    for (const s of ['ease', 'dart'] as const) {
      const d = draftTee(measure, { ...TEE_DEFAULTS, bustShaping: s });
      expect(d.notes.bustLift).toBe(0);
      expect(seamNames(d)).toEqual(seamNames(raglan));
      expect(d.pattern).toEqual(raglan.pattern);
    }
  }, TAILOR_MS); // three drafts: about 3 s alone, over 5 s on a loaded machine
});

describe.each(['plain', 'ease', 'dart'] as const)('tailoring her a set-in tee, bust shaping %s', (shaping) => {
  it('sews one sound sheet with four openings', () => {
    const { report, sewn, draft } = tailoredOf(shaping);
    expect(report.problems).toEqual([]);
    expect(report.components).toBe(1);
    expect(report.flippedEdges).toBe(0);
    expect(report.nonManifoldEdges).toBe(0);
    expect(report.openings.length).toBe(4);
    expect(sewn.openings.length).toBe(4);
    expect(draft.notes.bustLift > 0).toBe(shaping !== 'plain');
  }, TAILOR_MS);
});

describe("a seam's own ease in validate", () => {
  it("the 'ease' draft passes because its side seams carry their ease; the same sheet without it is refused", () => {
    const t = tailoredOf('ease');
    expect(t.report.problems).toEqual([]);
    const stripped: Pattern = { pieces: t.draft.pattern.pieces, seams: t.draft.pattern.seams.map(({ ease: _ease, ...rest }) => rest) };
    const again = validate(t.sewn, stripped, t.meshes);
    const sides = again.problems.filter((p) => /^seam 'side[PM]'/.test(p));
    expect(sides.length).toBe(2);
    // nothing else changed: only the two eased seams are named
    expect(again.problems.length).toBe(2);
  }, TAILOR_MS);
});

describe('teeParams: R2 by default, a set-in its own neckline, what is asked for over both', () => {
  const others = (p: TeeParams) => { const { neckWidth: _w, neckBand: _b, construction: _c, ...rest } = p; return rest; };

  it('the defaults are R2: an 18 cm neckline with its band at 90%, and a 5 cm armhole band', () => {
    expect(TEE_DEFAULTS.neckWidth).toBe(0.18);
    expect(TEE_DEFAULTS.neckBand).toBe(0.9);
    expect(TEE_DEFAULTS.armholeBand).toBe(0.05);
    expect(SET_IN_NECK).toEqual({ neckWidth: 0.20, neckBand: 1 });
  });

  it('with nothing, or a raglan, is the defaults: neckWidth 0.18, neckBand 0.9', () => {
    for (const p of [teeParams(), teeParams({}), teeParams({ construction: 'raglan' })]) {
      expect(p).toEqual(TEE_DEFAULTS);
      expect(p.neckWidth).toBe(0.18);
      expect(p.neckBand).toBe(0.9);
    }
    // a fresh object, never the frozen defaults themselves
    expect(teeParams()).not.toBe(TEE_DEFAULTS);
  });

  it("a set-in takes the Stage 2 neckline (0.20, no band) and every other field from the defaults", () => {
    const p = teeParams({ construction: 'setIn' });
    expect(p.construction).toBe('setIn');
    expect(p.neckWidth).toBe(0.20);
    expect(p.neckBand).toBe(1);
    expect(others(p)).toEqual(others(TEE_DEFAULTS));
    expect(p.armholeBand).toBe(TEE_DEFAULTS.armholeBand);
  });

  it('what is asked for wins over both, field by field', () => {
    const r = teeParams({ construction: 'raglan', neckWidth: 0.22, neckBand: 0.8, gusset: 0 });
    expect([r.neckWidth, r.neckBand, r.gusset]).toEqual([0.22, 0.8, 0]);
    const s = teeParams({ construction: 'setIn', neckWidth: 0.17, neckBand: 0.85, armholeBand: 0, bustShaping: 'dart' });
    expect([s.neckWidth, s.neckBand, s.armholeBand, s.bustShaping]).toEqual([0.17, 0.85, 0, 'dart']);
    expect(others({ ...s, armholeBand: TEE_DEFAULTS.armholeBand, bustShaping: undefined })).toEqual(others({ ...TEE_DEFAULTS, bustShaping: undefined }));
    // one of the two asked for: the other is still the construction's own
    expect(teeParams({ construction: 'setIn', neckBand: 0.9 }).neckWidth).toBe(0.20);
    expect(teeParams({ neckWidth: 0.2 }).neckBand).toBe(0.9);
  });

  it('R0, the Stage 2 raglan neckline, is still one call away', () => {
    const r0 = teeParams({ neckWidth: 0.20, neckBand: 1 });
    expect(r0.construction).toBe('raglan');
    expect(r0).toEqual({ ...TEE_DEFAULTS, neckWidth: 0.20, neckBand: 1 });
  });
});

/** Per particle, the least flat distance (metres) from any of its BODY-piece vertices to its own piece's armhole edges. */
function armholeDistance(t: Tailored): Float64Array {
  const out = new Float64Array(t.sewn.count).fill(Infinity), pieces = t.draft.pattern.pieces;
  const holes = pieces.map((p) => (p.role === 'torso' ? p.edges.filter((e) => e.name.startsWith('armhole')).map((e) => e.points) : []));
  for (let v = 0; v < t.sewn.vertexParticle.length; v++) {
    const lines = holes[t.sewn.vertexPiece[v]], i = t.sewn.vertexParticle[v], u = t.sewn.uv[v * 2], w = t.sewn.uv[v * 2 + 1];
    for (const pts of lines) for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], dx = pts[k][0] - ax, dy = pts[k][1] - ay, l2 = dx * dx + dy * dy;
      const q = l2 > 0 ? Math.max(0, Math.min(1, ((u - ax) * dx + (w - ay) * dy) / l2)) : 0;
      out[i] = Math.min(out[i], Math.hypot(u - ax - q * dx, w - ay - q * dy));
    }
  }
  return out;
}

/** Per particle: 1 where it has a vertex in a body piece; and 1 where it also has one in a sleeve or gusset. */
function torsoRoles(t: Tailored): { torso: Uint8Array; shared: Uint8Array } {
  const n = t.sewn.count, torso = new Uint8Array(n), other = new Uint8Array(n), shared = new Uint8Array(n);
  for (let v = 0; v < t.sewn.vertexParticle.length; v++) {
    const i = t.sewn.vertexParticle[v];
    if (t.draft.pattern.pieces[t.sewn.vertexPiece[v]].role === 'torso') torso[i] = 1; else other[i] = 1;
  }
  for (let i = 0; i < n; i++) shared[i] = torso[i] & other[i];
  return { torso, shared };
}

const placeAt = (t: Tailored, band: number): Placed => placeGarment(t.sewn, t.draft.pattern, t.draft, measure, measure.form, band);

describe("a set-in's armhole band (placeGarment's armholeBand, from TeeParams through tailor)", () => {
  const BAND = TEE_DEFAULTS.armholeBand!;

  it('at 0, every body particle not shared with a sleeve or gusset is trunk-only and binds to her trunk', () => {
    const t = tailoredOf('plain'), off = placeAt(t, 0), { torso, shared } = torsoRoles(t);
    let body = 0;
    for (let i = 0; i < t.sewn.count; i++) {
      if (!torso[i]) continue;
      if (shared[i]) { expect(off.trunkOnly[i]).toBe(0); expect(off.region[i]).toBe(BIND_ANY); continue; }
      expect(off.trunkOnly[i]).toBe(1);
      expect(off.region[i]).toBe(BIND_TRUNK);
      body++;
    }
    expect(body).toBeGreaterThan(2000);
  }, TAILOR_MS);

  it('at 5 cm, exactly the body particles within 5 cm of an armhole go with the sleeve, and only that changes', () => {
    const t = tailoredOf('plain'), off = placeAt(t, 0), on = placeAt(t, BAND), d = armholeDistance(t);
    let banded = 0, body = 0;
    for (let i = 0; i < t.sewn.count; i++) {
      const wasTrunk = off.trunkOnly[i] === 1, inBand = wasTrunk && d[i] < BAND;
      if (wasTrunk) body++;
      if (inBand) {
        banded++;
        expect(on.trunkOnly[i]).toBe(0);
        expect(on.region[i]).toBe(BIND_ANY);
      } else {
        expect(on.trunkOnly[i]).toBe(off.trunkOnly[i]);
        expect(on.region[i]).toBe(off.region[i]);
      }
    }
    // where each particle is laid does not depend on how it is bound
    expect(Array.from(on.positions)).toEqual(Array.from(off.positions));
    // a real band round each of the two armholes, and nowhere near the whole body
    expect(banded).toBeGreaterThan(150);
    expect(banded / body).toBeLessThan(0.25);
    // and it is what tailor gives a set-in with the defaults' armholeBand
    expect(SET_IN.armholeBand).toBe(BAND);
    expect(Array.from(t.placed.trunkOnly)).toEqual(Array.from(on.trunkOnly));
    expect(Array.from(t.placed.region)).toEqual(Array.from(on.region));
  }, TAILOR_MS);

  it('a raglan has no armhole: the same placing with or without the band', () => {
    const t = raglanTee();
    for (const p of t.draft.pattern.pieces) for (const e of p.edges) expect(e.name.startsWith('armhole')).toBe(false);
    const off = placeAt(t, 0), on = placeAt(t, BAND);
    expect(Array.from(on.trunkOnly)).toEqual(Array.from(off.trunkOnly));
    expect(Array.from(on.region)).toEqual(Array.from(off.region));
    expect(Array.from(t.placed.trunkOnly)).toEqual(Array.from(off.trunkOnly));
    expect(Array.from(t.placed.region)).toEqual(Array.from(off.region));
  }, TAILOR_MS);
});

// ---------------------------------------------------------------------------------------------------------------------
// the cloth: a sewn tube on a skinned cylinder (garmentCloth.test.ts's rig, shortened)

const AROUND = 16, R_BODY = 0.15, R_CLOTH = 0.17, ROWS = [0.25, 0.22, 0.17, 0.1, 0, -0.1];

function cylinderBody(): THREE.SkinnedMesh {
  const g = new THREE.CylinderGeometry(R_BODY, R_BODY, 0.8, 24, 12, true);
  const pos = g.getAttribute('position'), n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const t = THREE.MathUtils.clamp((pos.getY(v) + 0.1) / 0.2, 0, 1);
    si[v * 4] = 0; si[v * 4 + 1] = 1; sw[v * 4] = 1 - t; sw[v * 4 + 1] = t;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.scale.setScalar(100);
  const lower = new THREE.Bone(), upper = new THREE.Bone();
  lower.add(upper);
  root.add(lower, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([lower, upper]));
  return mesh;
}

/** The tube: rows of AROUND particles, welded round, its top row the neck opening and its bottom the hem. */
/** The tube: rows of AROUND particles at `rows` heights, `radiusAt(y)` round (R_CLOTH by default). */
function tube(radiusAt: (y: number) => number = () => R_CLOTH, rows: readonly number[] = ROWS): { sewn: SewnGarment; points: Float32Array } {
  const ROWS = rows;
  const count = ROWS.length * AROUND, id = (r: number, m: number) => r * AROUND + (m % AROUND);
  const points = new Float32Array(count * 3);
  ROWS.forEach((y, r) => {
    for (let m = 0; m < AROUND; m++) {
      const th = (2 * Math.PI * m) / AROUND + 0.05, rad = radiusAt(y);
      points.set([rad * Math.sin(th), y, rad * Math.cos(th)], (r * AROUND + m) * 3);
    }
  });
  const tri: number[] = [];
  for (let r = 0; r < ROWS.length - 1; r++) for (let m = 0; m < AROUND; m++) {
    const a = id(r, m), b = id(r, m + 1), c = id(r + 1, m), d = id(r + 1, m + 1);
    tri.push(a, c, b, b, c, d);
  }
  const P = (i: number) => new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  const keys = new Set<number>(), edges: number[] = [];
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tri[t + k], b = tri[t + (k + 1) % 3], lo = Math.min(a, b), hi = Math.max(a, b);
    if (!keys.has(lo * count + hi)) { keys.add(lo * count + hi); edges.push(lo, hi); }
  }
  const edgeRest = new Float32Array(edges.length / 2);
  for (let e = 0; e < edgeRest.length; e++) edgeRest[e] = P(edges[e * 2]).distanceTo(P(edges[e * 2 + 1]));
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { uv[i * 2] = (i % AROUND) / AROUND; uv[i * 2 + 1] = points[i * 3 + 1]; }
  const row = (r: number) => Uint32Array.from({ length: AROUND }, (_, m) => id(r, m));
  const triangles = Uint32Array.from(tri);
  const sewn: SewnGarment = {
    pieces: ['body'], count, particlePiece: new Uint16Array(count), onSeam: new Uint8Array(count),
    triangles, trianglePiece: new Uint16Array(triangles.length / 3), edges: Uint32Array.from(edges), edgeRest,
    vertexParticle: Uint32Array.from({ length: count }, (_, i) => i), vertexPiece: new Uint16Array(count), uv,
    renderTriangles: triangles.slice(),
    openings: [{ particles: row(0), edges: ['body:neck'] }, { particles: row(ROWS.length - 1), edges: ['body:hem'] }],
  };
  return { sewn, points };
}

/** Every particle bound to the body's first triangle at its middle: the rest lengths are what is under test, not the fit. */
function anyBinding(mesh: THREE.SkinnedMesh, n: number): ClothBinding {
  const T = Array.from(mesh.geometry.index!.array).slice(0, 3), tri = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) tri.set(T, i * 3);
  return { count: n, tri, bary: new Float32Array(n * 3).fill(1 / 3), offset: new Float32Array(n).fill(0.02) };
}

describe('GarmentCloth.neckBand', () => {
  const build = (neckBand?: number, armBones: number[] = [], armpitRule?: boolean) => {
    const body = cylinderBody(), { sewn } = tube();
    const gc = new GarmentCloth({
      body, sewn, binding: anyBinding(body, sewn.count), trunkOnly: new Uint8Array(sewn.count).fill(1), armBones,
      settings: { substeps: 2 }, standOff: 0.15, material: new THREE.MeshBasicMaterial(), unitsPerMetre: 100,
      ...(neckBand === undefined ? {} : { neckBand }), ...(armpitRule === undefined ? {} : { armpitRule }),
    });
    return { gc, sewn };
  };
  const restOf = (gc: GarmentCloth) => gc['restLengths'] as Map<number, number>;

  it('rests the edges along the neckline at band x their pattern length, and every other edge at its own', () => {
    const plain = build(), banded = build(0.9), n = plain.sewn.count, E = plain.sewn.edges;
    const onNeck = (i: number) => i < AROUND;
    let neckEdges = 0, others = 0;
    for (let e = 0; e < plain.sewn.edgeRest.length; e++) {
      const a = E[e * 2], b = E[e * 2 + 1], key = a * n + b, pattern = plain.sewn.edgeRest[e] * 100;
      expect(restOf(plain.gc).get(key)).toBeCloseTo(pattern, 4);
      if (onNeck(a) && onNeck(b)) { neckEdges++; expect(restOf(banded.gc).get(key)).toBeCloseTo(0.9 * pattern, 4); }
      else { others++; expect(restOf(banded.gc).get(key)).toBeCloseTo(pattern, 4); }
    }
    // the neckline is a ring: one edge per particle on it; an edge from the neck row down is not the band's
    expect(neckEdges).toBe(AROUND);
    expect(others).toBeGreaterThan(AROUND * 4);
    // and 1 is the same as none
    const one = build(1);
    for (const [k, v] of restOf(plain.gc)) expect(restOf(one.gc).get(k)).toBe(v);
  });

  it('hands its skin the armpit rule at LOOSE_OVER_ARM by default (with arm bones), and none with armpitRule false', () => {
    expect(LOOSE_OVER_ARM).toBe(0.3);
    const on = build(undefined, [1]).gc['skin'], asked = build(undefined, [1], true).gc['skin'];
    for (const skin of [on, asked]) {
      expect(skin['looseOverArm']).toBe(LOOSE_OVER_ARM);
      expect(skin['triArm']).toBeInstanceOf(Float32Array);
      expect(skin['triLoose']).toBeInstanceOf(Uint8Array);
      expect(skin['prevPoint']).toBeInstanceOf(Float32Array);
    }
    const off = build(undefined, [1], false).gc['skin'];
    expect(off['looseOverArm']).toBe(Infinity);
    expect(off['triArm']).toBeNull();
    expect(off['triLoose']).toBeNull();
    expect(off['prevPoint']).toBeNull();
    // and with no arm bones there is no arm to share skin with
    expect(build(undefined, []).gc['skin']['triArm']).toBeNull();
  });
  it('hands its skin the contact rescue at RESCUE_OVER (world units) and the sewn sheet\'s own neighbours', () => {
    expect(RESCUE_OVER).toBe(0.02);
    const { gc, sewn } = build(), skin = gc['skin'], n = sewn.count;
    expect(skin['rescue2']).toBeCloseTo((RESCUE_OVER * 100) ** 2, 9);
    expect(skin['rescueSeen']).toBeInstanceOf(Uint32Array);
    const nb = skin['neighbours'] as { start: Uint32Array; list: Uint32Array };
    expect(nb.start.length).toBe(n + 1);
    expect(nb.start[0]).toBe(0);
    expect(nb.start[n]).toBe(nb.list.length);
    // particle by particle, its neighbours are the other ends of its own sewn edges, each once
    const want: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let e = 0; e < sewn.edges.length / 2; e++) { const a = sewn.edges[e * 2], b = sewn.edges[e * 2 + 1]; want[a].add(b); want[b].add(a); }
    for (let f = 0; f < n; f++) {
      const got = Array.from(nb.list.subarray(nb.start[f], nb.start[f + 1])).sort((x, y) => x - y);
      expect(got).toEqual([...want[f]].sort((x, y) => x - y));
    }
  });
  it('runs its sim with self-collision at SELF_DISTANCE and bends at BEND_COMPLIANCE; self-collision can be turned off, the bend cannot', () => {
    expect(SELF_DISTANCE).toBe(0.005);
    expect(BEND_COMPLIANCE).toBe(1e-5);
    const plain = build().gc.simSettings;
    expect(plain.selfDistance).toBeCloseTo(SELF_DISTANCE * 100, 12);
    expect(plain.bendCompliance).toBe(BEND_COMPLIANCE);
    const make = (settings: Partial<ClothSettings>) => {
      const body = cylinderBody(), { sewn } = tube();
      return new GarmentCloth({
        body, sewn, binding: anyBinding(body, sewn.count), trunkOnly: new Uint8Array(sewn.count).fill(1), armBones: [],
        settings, standOff: 0.15, material: new THREE.MeshBasicMaterial(), unitsPerMetre: 100,
      }).simSettings;
    };
    const off = make({ substeps: 2, selfDistance: 0 });
    expect(off.selfDistance).toBe(0);
    expect(off.substeps).toBe(2);
    expect(make({ selfDistance: 1.2 }).selfDistance).toBe(1.2);
    // the bend is the garment's: a softer one asked for is not taken
    const bend = make({ bendCompliance: 1e-4 });
    expect(bend.bendCompliance).toBe(BEND_COMPLIANCE);
    expect(bend.selfDistance).toBeCloseTo(SELF_DISTANCE * 100, 12);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ClothSkin.looseOverArm: a skinned sphere whose upper bone is "her arm" on her +x side, blended across x = 0, so skin her
// arm half carries faces every way round the sphere's middle meridian: up at its top, sideways at its equator

const ARM = [1];
/** Weight of the upper bone ("her arm"): 0 at x <= -0.6, 1 at x >= 0.6, linear between. */
const armShare = (x: number) => THREE.MathUtils.clamp((x + 0.6) / 1.2, 0, 1);
/** clothSkin.ts's LOOSE_MAX_UP (not exported): no floor over arm-shared skin whose rest normal's upward share is under it. */
const LOOSE_MAX_UP = 0.5;
const NO_FLOOR = -1e9;

function sphereBody(): { mesh: THREE.SkinnedMesh; g: THREE.BufferGeometry; root: THREE.Group; upper: THREE.Bone } {
  const g = new THREE.SphereGeometry(1, 24, 16), pos = g.getAttribute('position'), n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) { const t = armShare(pos.getX(v)); si[v * 4] = 0; si[v * 4 + 1] = 1; sw[v * 4] = 1 - t; sw[v * 4 + 1] = t; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.position.set(12, -7, 3); root.scale.setScalar(100);
  const lower = new THREE.Bone(), upper = new THREE.Bone();
  lower.add(upper);
  root.add(lower, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([lower, upper]));
  return { mesh, g, root, upper };
}

interface TriInfo { t: number; share: number; up: number; trunk: boolean }
/** Each triangle: its corners' mean arm share, its rest normal's upward share ((b - a) x (c - a), as clothSkin.ts takes it), and whether it is TRUNK by ClothSkin's rule (fewer than two corners over half arm). */
function triangles(g: THREE.BufferGeometry): TriInfo[] {
  const pos = g.getAttribute('position'), T = g.index!.array, out: TriInfo[] = [];
  const V = (v: number) => new THREE.Vector3().fromBufferAttribute(pos, v);
  for (let t = 0; t < T.length / 3; t++) {
    const a = V(T[t * 3]), b = V(T[t * 3 + 1]), c = V(T[t * 3 + 2]);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a)), shares = [a, b, c].map((p) => armShare(p.x));
    out.push({ t, share: (shares[0] + shares[1] + shares[2]) / 3, up: nrm.length() > 0 ? nrm.y / nrm.length() : 0, trunk: shares.filter((w) => w > 0.5).length < 2 });
  }
  return out;
}
/** The triangle passing `ok` whose rest centroid is nearest c. */
function pickTriangle(g: THREE.BufferGeometry, ok: (i: TriInfo) => boolean, c: THREE.Vector3): TriInfo {
  const pos = g.getAttribute('position'), T = g.index!.array, m = new THREE.Vector3(), v = new THREE.Vector3();
  let best: TriInfo | null = null, bestD = Infinity;
  for (const info of triangles(g)) {
    if (!ok(info)) continue;
    m.set(0, 0, 0);
    for (let k = 0; k < 3; k++) m.add(v.fromBufferAttribute(pos, T[info.t * 3 + k]));
    const d = m.divideScalar(3).distanceToSquared(c);
    if (d < bestD) { bestD = d; best = info; }
  }
  return best!;
}

/** Particles bound at the middle of each of `ts`, 1 cm (body-local) off it. */
function bindAll(g: THREE.BufferGeometry, ts: number[]): ClothBinding {
  const T = Array.from(g.index!.array), n = ts.length, tri = new Uint32Array(n * 3);
  ts.forEach((t, i) => tri.set(T.slice(t * 3, t * 3 + 3), i * 3));
  return { count: n, tri, bary: new Float32Array(n * 3).fill(1 / 3), offset: new Float32Array(n).fill(0.01) };
}

/** Triangle t's corners as three poses them now, world. */
function posedTriangle(mesh: THREE.SkinnedMesh, t: number): THREE.Triangle {
  const T = mesh.geometry.index!.array, P = [0, 1, 2].map((k) => mesh.getVertexPosition(T[t * 3 + k], new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  return new THREE.Triangle(P[0], P[1], P[2]);
}
const at3 = (a: Float32Array, i: number) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

interface TwoUpdates { first: SkinContacts; second: SkinContacts; skinMoved: THREE.Vector3[]; carriedSpot: THREE.Vector3[] }

/**
 * Two updates with every particle held still where it is first laid (its pin target), her arm bone turned between them.
 * For each particle, also the spot of her skin its first contact was (on its bound triangle, at the same barycentric
 * place) as it is posed after the turn, and how far that spot moved. The rule reads the triangle of the CURRENT contact,
 * so each test also checks the contact stayed on its bound triangle (`last`).
 */
function twoUpdates(body: ReturnType<typeof sphereBody>, skin: ClothSkin, ts: number[]): TwoUpdates {
  const n = ts.length, held = skin.initial(new Float32Array(n * 3));
  const first = createContacts(n), second = createContacts(n);
  skin.update(held, first);
  const bary = ts.map((t, i) => posedTriangle(body.mesh, t).getBarycoord(at3(first.point, i), new THREE.Vector3())!);
  // a small turn: her skin moves a few centimetres, so each held particle's contact stays on the triangle it is bound to
  body.upper.rotation.set(0.08, 0.05, 0.06);
  body.root.updateMatrixWorld(true);
  skin.update(held, second);
  const carriedSpot = ts.map((t, i) => { const tri = posedTriangle(body.mesh, t), b = bary[i]; return tri.a.clone().multiplyScalar(b.x).addScaledVector(tri.b, b.y).addScaledVector(tri.c, b.z); });
  return { first, second, carriedSpot, skinMoved: carriedSpot.map((q, i) => q.clone().sub(at3(first.point, i))) };
}

describe('ClothSkin.looseOverArm', () => {
  // trunk triangles her arm carries over 0.3 of: one facing up (the top of her shoulder), one facing sideways (under her
  // arm); and one her arm barely carries
  const pick = (g: THREE.BufferGeometry) => ({
    // (off the pole, whose fan of triangles meets at one welded point a contact walks across)
    up: pickTriangle(g, (i) => i.trunk && i.share > 0.35 && i.up > 0.6, new THREE.Vector3(-0.12, 0.8, 0.58)),
    side: pickTriangle(g, (i) => i.trunk && i.share > 0.35 && Math.abs(i.up) < 0.2, new THREE.Vector3(-0.1, 0, 1)),
    light: pickTriangle(g, (i) => i.trunk && i.share > 0.05 && i.share < 0.2, new THREE.Vector3(-0.4, 0, 0.9)),
  });
  /** Whether each particle's contact is still on its bound triangle. */
  const stayed = (skin: ClothSkin, ts: number[]) => ts.every((t, i) => (skin['last'] as Uint32Array)[i] === t);
  /** Trunk on side, trunk on up, sleeve on up, sleeve on side, trunk on light. */
  const cast = (p: ReturnType<typeof pick>) => ({ ts: [p.side.t, p.up.t, p.up.t, p.side.t, p.light.t], trunkOnly: Uint8Array.from([1, 1, 0, 0, 1]) });

  it('absent: no arm share, loose map or last points are kept; every particle has its floor and is carried by her skin', () => {
    const body = sphereBody(), { ts, trunkOnly } = cast(pick(body.g));
    const skin = new ClothSkin(body.mesh, bindAll(body.g, ts), { armBones: ARM, trunkOnly });
    expect(skin['triArm']).toBeNull();
    expect(skin['triLoose']).toBeNull();
    expect(skin['prevPoint']).toBeNull();
    const r = twoUpdates(body, skin, ts);
    expect(stayed(skin, ts)).toBe(true);
    for (let i = 0; i < ts.length; i++) {
      expect(r.first.standOff[i]).toBeGreaterThan(0);
      expect(r.second.standOff[i]).toBeGreaterThan(0);
      // a fresh contact carries nothing of her: its own point; the next carries that spot as she moved
      expect(at3(r.first.carried, i).distanceTo(at3(r.first.point, i))).toBeLessThan(1e-4);
      expect(at3(r.second.carried, i).distanceTo(r.carriedSpot[i])).toBeLessThan(0.01);
    }
    // and with no arm bones there is nothing to share, whatever is asked
    const none = new ClothSkin(body.mesh, bindAll(body.g, ts), { looseOverArm: 0.3 });
    expect(none['triArm']).toBeNull();
    expect(none['triLoose']).toBeNull();
    expect(none['prevPoint']).toBeNull();
  });

  it("set: keeps each triangle's mean arm share, and marks loose every triangle whose rest normal is under half upward", () => {
    const body = sphereBody(), info = triangles(body.g), p = pick(body.g);
    const skin = new ClothSkin(body.mesh, bindAll(body.g, [p.side.t]), { armBones: ARM, trunkOnly: Uint8Array.from([1]), looseOverArm: 0.3 });
    const triArm = skin['triArm'] as Float32Array, triLoose = skin['triLoose'] as Uint8Array;
    expect(triArm).toBeInstanceOf(Float32Array);
    expect(triLoose).toBeInstanceOf(Uint8Array);
    expect(triArm.length).toBe(info.length);
    expect(triLoose.length).toBe(info.length);
    let loose = 0;
    for (const i of info) {
      expect(triArm[i.t]).toBeCloseTo(i.share, 5);
      expect(triLoose[i.t]).toBe(i.up < LOOSE_MAX_UP ? 1 : 0);
      loose += triLoose[i.t];
    }
    // the sphere faces every way: both kinds are there, and the two picked for the next test are one of each
    expect(loose).toBeGreaterThan(0);
    expect(loose).toBeLessThan(info.length);
    expect(triLoose[p.side.t]).toBe(1);
    expect(triLoose[p.up.t]).toBe(0);
    expect(p.up.share).toBeGreaterThan(0.35);
    expect(p.side.share).toBeGreaterThan(0.35);
    expect(p.light.share).toBeLessThan(0.2);
    expect(p.light.share).toBeGreaterThan(0.05);
  });

  it('set: under her arm a trunk particle has no floor; on her shoulder it keeps its floor and is not carried; others are as before', () => {
    const body = sphereBody(), { ts, trunkOnly } = cast(pick(body.g));
    const skin = new ClothSkin(body.mesh, bindAll(body.g, ts), { armBones: ARM, trunkOnly, looseOverArm: 0.3 });
    for (let i = 0; i < ts.length; i++) expect(skin.boundToArm(i)).toBe(false);
    const r = twoUpdates(body, skin, ts);
    // her skin under each of them moved between the updates
    for (let i = 0; i < 4; i++) expect(r.skinMoved[i].length()).toBeGreaterThan(1);
    expect(r.skinMoved[4].length()).toBeGreaterThan(0.2);
    expect(stayed(skin, ts)).toBe(true);
    // 0, trunk under her arm (loose skin): no floor, both updates; what is carried is untouched (her skin, as before)
    expect(r.first.standOff[0]).toBe(NO_FLOOR);
    expect(r.second.standOff[0]).toBe(NO_FLOOR);
    expect(at3(r.second.carried, 0).distanceTo(r.carriedSpot[0])).toBeLessThan(0.01);
    // 1, trunk on her shoulder (skin facing up): its floor, and her skin is not carried under it -- on the second update
    // its carried is its first update's point; on the first (a fresh contact) its own point, as every particle's
    expect(r.first.standOff[1]).toBeGreaterThan(0);
    expect(r.second.standOff[1]).toBeGreaterThan(0);
    expect(at3(r.first.carried, 1).distanceTo(at3(r.first.point, 1))).toBeLessThan(1e-4);
    expect(Array.from(r.second.carried.subarray(3, 6))).toEqual(Array.from(r.first.point.subarray(3, 6)));
    // 2 and 3, sleeve particles on the same two triangles, and 4, trunk on skin her arm barely carries: floored and carried
    for (const i of [2, 3, 4]) {
      expect(r.first.standOff[i]).toBeGreaterThan(0);
      expect(r.second.standOff[i]).toBeGreaterThan(0);
      expect(at3(r.second.carried, i).distanceTo(r.carriedSpot[i])).toBeLessThan(0.01);
      expect(at3(r.second.carried, i).distanceTo(at3(r.first.point, i))).toBeGreaterThan(0.9 * r.skinMoved[i].length());
    }
    // the last contact kept is each particle's own point from this update
    expect(Array.from(skin['prevPoint'] as Float32Array)).toEqual(Array.from(r.second.point));
  });

  it("a threshold above both arm-heavy triangles' shares leaves every particle floored and carried", () => {
    const body = sphereBody(), p = pick(body.g), { ts, trunkOnly } = cast(p);
    const skin = new ClothSkin(body.mesh, bindAll(body.g, ts), { armBones: ARM, trunkOnly, looseOverArm: Math.max(p.up.share, p.side.share) + 0.02 });
    const r = twoUpdates(body, skin, ts);
    for (let i = 0; i < ts.length; i++) {
      expect(r.second.standOff[i]).toBeGreaterThan(0);
      expect(at3(r.second.carried, i).distanceTo(r.carriedSpot[i])).toBeLessThan(0.01);
    }
    expect(r.skinMoved[0].length()).toBeGreaterThan(1);
    expect(r.skinMoved[1].length()).toBeGreaterThan(1);
    expect(stayed(skin, ts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ClothSkin's contact rescue (`rescueOver`, `neighbours`): a HAIRPIN of skin -- a strip, flat along x on top (y = +R),
// bent round a half circle at x = L and back along the bottom (y = -R) -- so a particle just above the top whose contact
// is on the bottom, under it, is at a local minimum of the walk: every step on the bottom is further off, and the top
// is reached only round the bend. One bone, unscaled: world units are the strip's own.

const FRAME = 1 / 60;
const R = 0.1, OFF = 0.01, RESCUE = 0.05, EVERY = 32, REACH = 250;

/** The hairpin, `cols` columns per layer over length `len`, `bend` columns round the bend, three rows across (z -0.1..0.1). */
function hairpin(len: number, cols: number, bend = 4): THREE.SkinnedMesh {
  const path: [number, number][] = [];
  for (let k = 0; k <= cols; k++) path.push([(k * len) / cols, R]);
  for (let j = 1; j <= bend; j++) { const th = Math.PI / 2 - (j * Math.PI) / bend; path.push([len + R * Math.cos(th), R * Math.sin(th)]); }
  for (let m = 1; m <= cols; m++) path.push([len - (m * len) / cols, -R]);
  const zs = [-0.1, -0.033, 0.033, 0.1], pos: number[] = [], idx: number[] = [];
  for (const [x, y] of path) for (const z of zs) pos.push(x, y, z);
  const id = (c: number, r: number) => c * zs.length + r;
  for (let c = 0; c + 1 < path.length; c++) for (let r = 0; r + 1 < zs.length; r++) {
    const a = id(c, r), b = id(c + 1, r), d = id(c, r + 1), e = id(c + 1, r + 1);
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nV = pos.length / 3, si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
  for (let v = 0; v < nV; v++) sw[v * 4] = 1;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial()), root = new THREE.Group(), bone = new THREE.Bone();
  root.add(bone, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

/** The triangle whose centroid is nearest (x, y, z). */
function triangleAt(mesh: THREE.SkinnedMesh, x: number, y: number, z: number): number {
  const g = mesh.geometry, P = g.getAttribute('position'), T = g.index!.array, c = new THREE.Vector3(x, y, z), m = new THREE.Vector3(), v = new THREE.Vector3();
  let best = -1, bestD = Infinity;
  for (let t = 0; t < T.length / 3; t++) {
    m.set(0, 0, 0);
    for (let k = 0; k < 3; k++) m.add(v.fromBufferAttribute(P, T[t * 3 + k]));
    const d = m.divideScalar(3).distanceToSquared(c);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** A binding of one particle per triangle, at its middle. */
function bindTris(mesh: THREE.SkinnedMesh, ts: number[]): ClothBinding {
  const T = Array.from(mesh.geometry.index!.array), tri = new Uint32Array(ts.length * 3);
  ts.forEach((t, i) => tri.set(T.slice(t * 3, t * 3 + 3), i * 3));
  return { count: ts.length, tri, bary: new Float32Array(ts.length * 3).fill(1 / 3), offset: new Float32Array(ts.length).fill(OFF) };
}

/**
 * The stuck case at x: a particle OFF above the top, bound (so its walk starts) on the bottom under it; its contact's
 * distance is 2R + OFF. Slot `i` of `count`, the rest bound and held just above the top at x, contact where they are.
 */
function stuck(mesh: THREE.SkinnedMesh, x: number, stuckSlots: number[], count: number): { binding: ClothBinding; cloth: Float32Array } {
  const top = triangleAt(mesh, x, R, 0), bottom = triangleAt(mesh, x, -R, 0);
  const T = mesh.geometry.index!.array, P = mesh.geometry.getAttribute('position'), c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(P, T[top * 3 + k]));
  c.divideScalar(3);
  const ts: number[] = [], cloth = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { ts.push(stuckSlots.includes(i) ? bottom : top); cloth.set([c.x, R + OFF, c.z], i * 3); }
  return { binding: bindTris(mesh, ts), cloth };
}

const gap = (cloth: Float32Array, out: SkinContacts, i: number) => at3(cloth, i).distanceTo(at3(out.point, i));

describe('ClothSkin contact rescue (rescueOver, neighbours)', () => {
  it('absent: never runs -- nothing kept, nothing rescued, and a contact stuck across the fold stays there', () => {
    const mesh = hairpin(0.6, 6), { binding, cloth } = stuck(mesh, 0.15, [0, 1], 2);
    const skin = new ClothSkin(mesh, binding);
    expect(skin['rescue2']).toBe(Infinity);
    expect(skin['rescueSeen']).toBeNull();
    expect(skin['rescueChecked']).toBeNull();
    const out = createContacts(2);
    for (let k = 0; k < EVERY + 8; k++) {
      skin.update(cloth, out);
      expect(skin.rescued).toBe(0);
    }
    // still on the bottom: 2R + OFF off, the walk's local minimum
    for (const i of [0, 1]) expect(gap(cloth, out, i)).toBeGreaterThan(2 * R);
  });

  it('set: each slot is looked at in its turn (phase 1 first), and a stuck contact is moved to the skin under it', () => {
    const mesh = hairpin(0.6, 6);
    expect(mesh.geometry.index!.count / 3).toBeLessThan(REACH); // the whole strip is within reach of the search
    // slots 0 and 1 stuck; 2 lies on the top where it is, and is never looked at past its contact
    const { binding, cloth } = stuck(mesh, 0.15, [0, 1], 3);
    const skin = new ClothSkin(mesh, binding, { rescueOver: RESCUE });
    expect(skin['rescue2']).toBeCloseTo(RESCUE * RESCUE, 12);
    expect(skin['rescueSeen']).toBeInstanceOf(Uint32Array);
    const out = createContacts(3), when: number[][] = [[], [], []];
    const lastGap = [0, 0, 0];
    for (let k = 1; k <= EVERY + 4; k++) {
      const before = [0, 1, 2].map((i) => gap(cloth, out, i));
      skin.update(cloth, out);
      // a rescue is seen by the NEXT update's contact: the slot that was far off is now close
      for (const i of [0, 1, 2]) if (k > 1 && before[i] > 2 * R && gap(cloth, out, i) < 2 * OFF) when[i].push(k - 1);
      if (k === 1) {
        // the first update looks at phase 1: slot 1 (stuck) is rescued, slot 0 waits for its turn
        expect(skin.rescued).toBe(1);
        // its contact is now the top triangle under it, and the look is cleared
        expect((skin['last'] as Uint32Array)[1]).toBe(triangleAt(mesh, at3(cloth, 1).x, R, at3(cloth, 1).z));
        expect((skin['rescueChecked'] as Float32Array)[1]).toBe(0);
      } else if (k === EVERY) expect(skin.rescued).toBe(1); // phase 0 comes round at update 32: slot 0
      else expect(skin.rescued).toBe(0);
      for (const i of [0, 1, 2]) lastGap[i] = gap(cloth, out, i);
    }
    // each stuck contact was moved once, in its own turn; and lies OFF under its particle since
    expect(when[1]).toEqual([1]);
    expect(when[0]).toEqual([EVERY]);
    expect(when[2]).toEqual([]);
    for (const i of [0, 1, 2]) expect(lastGap[i]).toBeLessThan(OFF + 1e-4);
    // the moved contact starts fresh: the update after it carries nothing of her (carried is its own point)
    const again = createContacts(3);
    skin.update(cloth, again);
    for (const i of [0, 1]) expect(at3(again.carried, i).distanceTo(at3(again.point, i))).toBeLessThan(1e-6);
  });

  it('looks no further than its reach round the contact: a fold too far round is found only through a cloth neighbour', () => {
    // a long hairpin: from x = 0.3 on the bottom the bend at x = 2 is far more than REACH triangles away
    const mesh = hairpin(2, 60);
    // slot 1 stuck; slot 0, its neighbour in the cloth, lies on the top above it
    const make = (neighbours?: { start: Uint32Array; list: Uint32Array }) => {
      const { binding, cloth } = stuck(mesh, 0.3, [1], 2);
      return { skin: new ClothSkin(mesh, binding, { rescueOver: RESCUE, ...(neighbours ? { neighbours } : {}) }), cloth };
    };
    const alone = make(), out = createContacts(2);
    alone.skin.update(alone.cloth, out);
    expect(alone.skin.rescued).toBe(0);
    // it looked and found nothing nearer: noted at the distance it looked from
    expect((alone.skin['rescueChecked'] as Float32Array)[1]).toBeCloseTo(gap(alone.cloth, out, 1), 5);
    expect(gap(alone.cloth, out, 1)).toBeGreaterThan(2 * R);

    // the same, with each particle the other's neighbour: the search starts from slot 0's contact too
    const linked = make({ start: Uint32Array.from([0, 1, 2]), list: Uint32Array.from([1, 0]) }), out2 = createContacts(2);
    linked.skin.update(linked.cloth, out2);
    expect(linked.skin.rescued).toBe(1);
    linked.skin.update(linked.cloth, out2);
    expect(gap(linked.cloth, out2, 1)).toBeLessThan(OFF + 1e-4);
  });

  it('a particle with nothing nearer round it is not searched again until it is 1.5 times as far off', () => {
    const mesh = hairpin(2, 60), { binding, cloth } = stuck(mesh, 0.3, [1], 2);
    const skin = new ClothSkin(mesh, binding, { rescueOver: RESCUE }), out = createContacts(2), checked = () => (skin['rescueChecked'] as Float32Array)[1];
    const run = (updates: number) => { for (let k = 0; k < updates; k++) skin.update(cloth, out); };
    run(1); // update 1: slot 1's turn
    const d1 = gap(cloth, out, 1);
    expect(d1).toBeCloseTo(2 * R + OFF, 3);
    expect(checked()).toBeCloseTo(d1, 5);
    // lifted to 1.3 times as far off: its next turn (update 33) passes it by -- what it was checked at is unchanged
    cloth[4] += 0.3 * d1;
    run(EVERY);
    expect(gap(cloth, out, 1)).toBeCloseTo(1.3 * d1, 3);
    expect(checked()).toBeCloseTo(d1, 5);
    // lifted past 1.5 times: its next turn (update 65) searches again, and notes the new distance
    cloth[4] += 0.3 * d1;
    run(EVERY);
    expect(gap(cloth, out, 1)).toBeCloseTo(1.6 * d1, 3);
    expect(checked()).toBeCloseTo(1.6 * d1, 4);
    expect(skin.rescued).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ClothSim's self-collision (`selfDistance`): two separate 6 x 6 sheets, 2 units between particles, in one sim with no
// skin (contacts with no normal: nothing of her is pushed against). The lower is fully pinned where it lies (y = 0);
// the upper starts 1.6 above it, each particle straight over one of the lower's, and falls. With d = 1 under the
// spacing, no particle is within d of another of its own sheet: the only pairs are a falling particle and the one under it.
// The push moves a particle's previous position with it, so it changes where the particle is without giving it speed:
// before that, a whole step's approach undone in the last substep became velocity at the substep's rate, and the sheet
// was thrown 23 units up off the one it landed on.

const SHEET = 6, SPACING = 2, DROP = 1.6, SELF = 1;

function twoSheets(start = DROP): { topology: ClothTopology; contacts: SkinContacts; lower: number } {
  const per = SHEET * SHEET, count = 2 * per, rest = new Float32Array(count * 3), pin = new Float32Array(count), tri: number[] = [];
  for (let s = 0; s < 2; s++) {
    for (let j = 0; j < SHEET; j++) for (let i = 0; i < SHEET; i++) {
      const k = s * per + j * SHEET + i;
      rest.set([i * SPACING, s === 0 ? 0 : start, j * SPACING], k * 3);
      if (s === 0) pin[k] = 1;
    }
    for (let j = 0; j + 1 < SHEET; j++) for (let i = 0; i + 1 < SHEET; i++) {
      const a = s * per + j * SHEET + i, b = a + 1, c = a + SHEET, d = c + 1;
      tri.push(a, c, b, b, c, d);
    }
  }
  const contacts = createContacts(count);
  contacts.pinTarget.set(rest.subarray(0, per * 3)); // the lower sheet held where it lies
  return { topology: { count, triangles: Uint32Array.from(tri), rest, pin }, contacts, lower: per };
}

/** The least distance between a particle of the lower sheet and one of the upper. */
function across(x: Float32Array, lower: number): number {
  let best = Infinity;
  for (let a = 0; a < lower; a++) for (let b = lower; b < 2 * lower; b++) best = Math.min(best, Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]));
  return best;
}
const upperMeanY = (x: Float32Array, lower: number) => { let s = 0; for (let b = lower; b < 2 * lower; b++) s += x[b * 3 + 1]; return s / lower; };

describe('ClothSim self-collision (selfDistance)', () => {
  const STEPS = 90;
  /** Runs the drop; per step, the self contacts and the least distance across the sheets. */
  function drop(settings: Partial<ClothSettings>, start = DROP) {
    // restScale 1: the free sheet keeps its spacing, so each of its particles stays straight over its partner (at the
    // default 0.98 it draws in, its particles slide off their partners into the gaps, and particle-only collision leaks)
    const { topology, contacts, lower } = twoSheets(start), sim = new ClothSim(topology, { restScale: 1, ...settings });
    const self: number[] = [], gaps: number[] = [], top: number[] = [], speed: number[] = [];
    let pinsHeld = true, finite = true;
    const v = sim['velocities'] as Float32Array;
    for (let k = 0; k < STEPS; k++) {
      self.push(sim.step(FRAME, contacts, contacts).selfContacts);
      gaps.push(across(sim.positions, lower));
      // the upper sheet's highest particle, and its fastest
      let hi = -Infinity, fast = 0;
      for (let b = lower; b < 2 * lower; b++) { hi = Math.max(hi, sim.positions[b * 3 + 1]); fast = Math.max(fast, Math.hypot(v[b * 3], v[b * 3 + 1], v[b * 3 + 2])); }
      top.push(hi); speed.push(fast);
      for (let i = 0; i < lower * 3; i++) if (sim.positions[i] !== topology.rest[i]) pinsHeld = false;
      for (let i = 0; i < sim.positions.length; i++) if (!Number.isFinite(sim.positions[i])) finite = false;
    }
    return { sim, self, gaps, lower, pinsHeld, top, speed, finite };
  }

  it('absent or 0: none -- the falling sheet passes through the other, closer than d on the way, and no pair is counted', () => {
    for (const settings of [{}, { selfDistance: 0 }]) {
      const r = drop(settings);
      expect(r.sim.settings.selfDistance ?? 0).toBe(0);
      expect(r.self.every((c) => c === 0)).toBe(true);
      expect(Math.min(...r.gaps)).toBeLessThan(SELF / 2);
      // through it, and on down
      expect(upperMeanY(r.sim.positions, r.lower)).toBeLessThan(-SELF);
    }
  });

  it('on: after every step no particle of one sheet is within d of the other\'s, and the pairs are counted exactly when they touch', () => {
    const r = drop({ selfDistance: SELF });
    expect(r.self[0]).toBe(0);
    // the whole sheet lands at once: every one of its particles on its partner
    expect(r.self).toContain(SHEET * SHEET);
    for (let k = 0; k < STEPS; k++) {
      // the push is the step's last word here (no skin, no capsules): pushed pairs end at d (3D, along their line), so
      // at the end of a step the sheets are never closer than d (whether they pass through BETWEEN steps is the next tests')
      expect(r.gaps[k]).toBeGreaterThan(SELF * (1 - 1e-4));
      // a step counts pairs exactly when it ends with the sheets touching at d
      expect(r.self[k] > 0).toBe(r.gaps[k] < SELF * (1 + 1e-3));
    }
    for (let i = 0; i < r.sim.positions.length; i++) expect(Number.isFinite(r.sim.positions[i])).toBe(true);
  });

  it('a sheet laid at d on the other stays there: the push gives it no speed, so it never hops', () => {
    const r = drop({ selfDistance: SELF }, SELF);
    expect(r.finite).toBe(true);
    expect(Math.max(...r.top)).toBeLessThan(SELF + 0.5);
    // and never through it: the sheet (its highest particle) stays up at about d, every step
    expect(Math.min(...r.top)).toBeGreaterThan(SELF - 0.5);
    for (const g of r.gaps) expect(g).toBeGreaterThan(SELF * (1 - 1e-4));
    // pressed on the other by its weight every step, all of it
    expect(r.self.slice(-10)).toEqual(new Array(10).fill(SHEET * SHEET));
  });

  it('a falling sheet lands on the other and comes to rest near d, never thrown back up above where it fell from', () => {
    const r = drop({ selfDistance: SELF });
    const first = r.self.findIndex((c) => c > 0);
    expect(r.finite).toBe(true);
    expect(first).toBeGreaterThan(0);
    expect(Math.max(...r.top.slice(first))).toBeLessThan(DROP + 0.1);
    expect(Math.min(...r.top)).toBeGreaterThan(SELF - 0.5);
    // settled: its last steps lie on the other at d, pressed on it, and still
    for (const y of r.top.slice(-10)) { expect(y).toBeGreaterThan(SELF * 0.9); expect(y).toBeLessThan(SELF + 0.1); }
    expect(r.self.slice(-10)).toEqual(new Array(10).fill(SHEET * SHEET));
  });

  it('a pinned particle is never moved by the push: the falling sheet gives all of it', () => {
    const r = drop({ selfDistance: SELF });
    expect(r.pinsHeld).toBe(true);
    // and with the push on, the free sheet is what moved (it rests above the pinned one, not pushed into it)
    expect(r.self.some((c) => c > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentDetail's tips (`rest`, `aroundOf`, `tipOf`, `domeOver`'s `tipNow`): a synthetic body of two flat details, each a
// centre with an inner ring (radius 1) and an outer ring (radius 2) in the plane z = 0 of its own spot, wound counter-
// clockwise from +z, so her smooth surface there is flat (curve 0), faces +z, and its base is the spot itself. The navel
// stands 0.1 proud far off at x = 100; the nipple's centre 0.2 proud at the origin, with a TIP vertex 0.5 proud 0.3 to
// its side (inside the inner ring) and a taller vertex 0.9 proud 1.5 out (beyond it). Posed, everything moves by POSE.

const POSE: [number, number, number] = [5, -3, 2];
const NAVEL_AT = 100, NAVEL_H = 0.1, CENTRE_H = 0.2, TIP: [number, number, number] = [0.3, 0, 0.5], FAR: [number, number, number] = [1.5, 0, 0.9];

function detailBody(innerRise = 0): { points: DetailPoints; rest: number[][]; tip: number; far: number; centre: number; navel: number } {
  const rest: number[][] = [];
  const ring = (cx: number, r: number, z = 0) => Array.from({ length: 16 }, (_, j) => { const a = (2 * Math.PI * j) / 16; rest.push([cx + r * Math.cos(a), r * Math.sin(a), z]); return rest.length - 1; });
  // `innerRise` lifts the NIPPLE's inner ring: her smooth surface there then curves (a breast), rising to the centre
  const spot = (cx: number, h: number, rise = 0) => { rest.push([cx, 0, h]); const c = rest.length - 1; return { c, rings: [ring(cx, 1, rise), ring(cx, 2)] }; };
  const navel = spot(NAVEL_AT, NAVEL_H), nipple = spot(0, CENTRE_H, innerRise);
  rest.push([...TIP]); const tip = rest.length - 1;
  rest.push([...FAR]); const far = rest.length - 1;
  return { points: { navel: navel.c, navelRings: navel.rings, nipples: [nipple.c], nippleRings: [nipple.rings] }, rest, tip, far, centre: nipple.c, navel: navel.c };
}
const restOf = (rest: number[][]): RestBody => ({ count: rest.length, at: (v, o) => { o[0] = rest[v][0]; o[1] = rest[v][1]; o[2] = rest[v][2]; } });
const poserOf = (rest: number[][]): Poser => ({ posedVertex: (v, out, o = 0) => { for (let k = 0; k < 3; k++) out[o + k] = rest[v][k] + POSE[k]; } });
const posedAt = (q: readonly number[]): [number, number, number] => [q[0] + POSE[0], q[1] + POSE[1], q[2] + POSE[2]];

/** Particles at `ps` (posed world), each with its skin contact straight under it on the flat surface, normal +z. */
function particlesOver(ps: [number, number, number][]): { positions: Float32Array; after: SkinContacts; before: SkinContacts } {
  const n = ps.length, positions = new Float32Array(n * 3), after = createContacts(n), before = createContacts(n);
  ps.forEach((p, i) => {
    positions.set(p, i * 3);
    for (const c of [after, before]) { c.point.set([p[0], p[1], POSE[2]], i * 3); c.carried.set([p[0], p[1], POSE[2]], i * 3); c.normal.set([0, 0, 1], i * 3); }
  });
  return { positions, after, before };
}
/** A contact's height along the (+z) axis over the detail's base. */
const heightOf = (c: SkinContacts, i: number) => c.point[i * 3 + 2] - POSE[2];

describe('GarmentDetail: the dome stands over the tallest vertex round a detail (its tip), not its centre', () => {
  it('rest: round a nipple the vertices within its inner ring, round her navel those within its OUTER ring, at rest', () => {
    const b = detailBody(), gd = new GarmentDetail(b.points, 1, true, restOf(b.rest));
    const around = gd['around'] as (Int32Array | null)[];
    expect(around.length).toBe(2);
    // the nipple: within its inner ring (radius 1) -- the tip in, the far one (1.5 out) out
    const nipple = Array.from(around[1]!);
    expect(nipple).toContain(b.tip);
    expect(nipple).not.toContain(b.far);
    expect(nipple).not.toContain(b.centre);
    // (a ring's own vertices lie on its mean radius, and fall either side of it by rounding)
    for (const v of nipple) expect(Math.hypot(b.rest[v][0], b.rest[v][1])).toBeLessThan(1 + 1e-6);
    // the navel: within its outer ring (radius 2) -- so all of its inner ring (radius 1), and nothing of the nipple
    const navel = Array.from(around[0]!);
    for (const v of navel) expect(Math.hypot(b.rest[v][0] - NAVEL_AT, b.rest[v][1])).toBeLessThan(2 + 1e-6);
    for (const v of b.points.navelRings[0]) expect(navel).toContain(v);
    expect(navel).not.toContain(b.navel);
    expect(navel).not.toContain(b.tip);
  });

  it('a navel vertex between its inner and outer rings is round it now, and the tip when it stands tallest', () => {
    const b = detailBody();
    // 1.5 off the navel's axis (past its inner ring, inside its outer) and 0.3 proud, above its centre's 0.1; and one
    // taller still (0.5) but 2.5 off it, past the outer ring
    b.rest.push([NAVEL_AT + 1.5, 0, 0.3]); const between = b.rest.length - 1;
    b.rest.push([NAVEL_AT - 2.5, 0, 0.5]); const beyond = b.rest.length - 1;
    const gd = new GarmentDetail(b.points, 1, true, restOf(b.rest)), around = gd['around'] as (Int32Array | null)[];
    expect(Array.from(around[0]!)).toContain(between);
    expect(Array.from(around[0]!)).not.toContain(beyond);
    // round a nipple the same vertex would not be: past its inner ring
    expect(Array.from(around[1]!)).not.toContain(between);
    const { positions, after, before } = particlesOver([[50, 50, 50]]);
    gd.follow(poserOf(b.rest), positions, after, before, 1, true);
    expect(gd.tips[0].along).toBeCloseTo(0.3, 6);
    for (let k = 0; k < 3; k++) expect(gd.tips[0].at[k]).toBeCloseTo(posedAt([NAVEL_AT + 1.5, 0, 0.3])[k], 6);
    expect(gd.tips[0].k[0]).toBeCloseTo(1.5, 6);
  });

  it('follow measures the tip each frame: the tallest along the axis, posed -- the tip vertex, never the far one', () => {
    const b = detailBody(), gd = new GarmentDetail(b.points, 1, true, restOf(b.rest)), { positions, after, before } = particlesOver([[50, 50, 50]]);
    gd.follow(poserOf(b.rest), positions, after, before, 1, true);
    const t = gd.tips[1];
    expect(t.along).toBeCloseTo(TIP[2], 6);
    expect(t.along).not.toBeCloseTo(CENTRE_H, 3);
    for (let k = 0; k < 3; k++) expect(t.at[k]).toBeCloseTo(posedAt(TIP)[k], 6);
    expect(t.k[0]).toBeCloseTo(TIP[0], 6); expect(t.k[1]).toBeCloseTo(0, 6); expect(t.k[2]).toBeCloseTo(0, 6);
    expect(t.top).toBeCloseTo(TIP[2], 6); // flat surface: the tip stands its full height above it
    // the navel has no taller vertex round it: its tip is its centre
    expect(gd.tips[0].along).toBeCloseTo(NAVEL_H, 6);
    for (let k = 0; k < 3; k++) expect(gd.tips[0].at[k]).toBeCloseTo(posedAt([NAVEL_AT, 0, NAVEL_H])[k], 6);
  });

  it('with a tip, the dome is at least the tip\'s height and DOME_MARGIN more everywhere within domeIn of the tip\'s axis', () => {
    const b = detailBody(), rin = DETAIL_LOOK.domeIn * 1;
    // particles on a ring of radii round the tip's axis, at heights from her skin up to just under the dome's top
    const ps: [number, number, number][] = [];
    for (const r of [0, 0.1, 0.25, 0.4, rin - 0.02]) for (let a = 0; a < 8; a++) for (const z of [0.05, 0.3, TIP[2] - 0.01, TIP[2] + DOME_MARGIN / 2]) {
      ps.push(posedAt([TIP[0] + r * Math.cos((a * Math.PI) / 4), r * Math.sin((a * Math.PI) / 4), z]));
    }
    const { positions, after, before } = particlesOver(ps), gd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest));
    gd.follow(poserOf(b.rest), positions, after, before, ps.length, true);
    for (let i = 0; i < ps.length; i++) {
      expect(heightOf(after, i)).toBeGreaterThanOrEqual(TIP[2] + DOME_MARGIN - 1e-5);
      // raised straight along the axis, under the particle; facing up the axis
      expect(after.point[i * 3]).toBeCloseTo(ps[i][0], 5);
      expect(after.point[i * 3 + 1]).toBeCloseTo(ps[i][1], 5);
      expect(Array.from(after.normal.subarray(i * 3, i * 3 + 3))).toEqual([0, 0, 1]);
    }
    // a particle just under the tip: its contact is the dome's top over it, tip height and margin
    const one = particlesOver([posedAt([TIP[0], 0, TIP[2] - 0.1])]);
    new GarmentDetail(b.points, 1, true, restOf(b.rest)).follow(poserOf(b.rest), one.positions, one.after, one.before, 1, true);
    expect(heightOf(one.after, 0)).toBeCloseTo(TIP[2] + DOME_MARGIN, 5);
    expect(one.after.point[0]).toBeCloseTo(posedAt(TIP)[0], 5);
  });

  it('domeOver with and without the tip: without it, the dome stands at the centre\'s height and DOME_MARGIN more, as before', () => {
    const b = detailBody(), gd = new GarmentDetail(b.points, 1, true, restOf(b.rest)), poser = poserOf(b.rest);
    gd.follow(poser, new Float32Array(3), createContacts(1), createContacts(1), 1, true);
    const d = gd.posed.nipples[0];
    expect(d.h).toBeCloseTo(CENTRE_H, 6);
    expect(d.curve).toBeCloseTo(0, 9);
    // a particle over the centre, a little above the centre's dome
    const over = posedAt([0, 0, CENTRE_H]);
    const plain = particlesOver([over]);
    domeOver(d, plain.positions, plain.after, 1);
    expect(heightOf(plain.after, 0)).toBeCloseTo(CENTRE_H + DOME_MARGIN, 5);
    // the same particle with the tip: within domeIn of the tip's axis (0.3 off it), the tip's dome
    const tipped = particlesOver([over]);
    domeOver(d, tipped.positions, tipped.after, 1, gd.tips[1]);
    expect(heightOf(tipped.after, 0)).toBeCloseTo(TIP[2] + DOME_MARGIN, 5);
  });

  it('domes off: follow still measures the tips and leaves every contact as her skin gave it', () => {
    const b = detailBody(), gd = new GarmentDetail(b.points, 2, false, restOf(b.rest));
    const { positions, after, before } = particlesOver([posedAt([TIP[0], 0, 0.3]), posedAt([0, 0, 0.1])]);
    const point = Array.from(after.point), normal = Array.from(after.normal);
    gd.follow(poserOf(b.rest), positions, after, before, 2, true);
    expect(gd.tips[1].along).toBeCloseTo(TIP[2], 6);
    expect(Array.from(after.point)).toEqual(point);
    expect(Array.from(after.normal)).toEqual(normal);
  });

  it('without a rest body: no vertices round any centre, no throw, each tip is its centre and the dome stands over it', () => {
    const b = detailBody(), gd = new GarmentDetail(b.points, 1);
    expect((gd['around'] as (Int32Array | null)[]).every((a) => a === null)).toBe(true);
    const { positions, after, before } = particlesOver([posedAt([0, 0, 0.1])]);
    expect(() => gd.follow(poserOf(b.rest), positions, after, before, 1, true)).not.toThrow();
    for (let k = 0; k < 3; k++) expect(gd.tips[1].at[k]).toBeCloseTo(posedAt([0, 0, CENTRE_H])[k], 6);
    expect(gd.tips[1].along).toBeCloseTo(CENTRE_H, 6);
    expect(heightOf(after, 0)).toBeCloseTo(CENTRE_H + DOME_MARGIN, 5);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentDetail's BREAST and NAVEL DETAIL (`keep`), on the same synthetic details: the nipple's tip 0.5 proud at 0.3 off
// its centre, rho 1 (so rin = domeIn, rout from domeOut to wideOut), the navel 0.1 proud with no taller vertex round it.

describe('GarmentDetail.keep: BREAST and NAVEL DETAIL decide how high and how wide the domes are', () => {
  const L = DETAIL_LOOK, RIN = L.domeIn, TIP_X = TIP[0];
  /** Contacts' heights after one follow at `keep`, for particles at `ps` (posed world), skin flat under each. */
  function heights(keep: { nipple: number; navel: number }, ps: [number, number, number][], innerRise = 0): number[] {
    const b = detailBody(innerRise), gd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest));
    gd.keep = keep;
    const { positions, after, before } = particlesOver(ps);
    gd.follow(poserOf(b.rest), positions, after, before, ps.length, true);
    return ps.map((_, i) => heightOf(after, i));
  }
  /** A particle `r` out from the nipple tip's axis (along +x), low over her skin. */
  const besideTip = (r: number, z = 0.01): [number, number, number] => posedAt([TIP_X + r, 0, z]);
  /** ...and from the navel's axis. */
  const besideNavel = (r: number, z = 0.01): [number, number, number] => posedAt([NAVEL_AT + r, 0, z]);

  it('defaults to the room\'s sliders: nipple 0.45, navel 0.8', () => {
    expect(new GarmentDetail(detailBody().points, 1).keep).toEqual({ nipple: 0.45, navel: 0.8 });
  });

  it('BREAST DETAIL 1 (no dome): the tent still holds the cloth over the tip at its height and DOME_MARGIN, flat or curved', () => {
    for (const rise of [0, 0.1]) {
      const [over, under] = heights({ nipple: 1, navel: 1 }, [besideTip(0, 0.05), besideTip(0.2, 0.3)], rise);
      expect(over).toBeGreaterThanOrEqual(TIP[2] + DOME_MARGIN - 1e-5);
      expect(under).toBeGreaterThanOrEqual(TIP[2] + DOME_MARGIN - 1e-5);
    }
    // past where the tent from the tip has fallen to her skin (rin + (tip + margin) / TENT_SLOPE), flat: nothing
    const past = RIN + (TIP[2] + DOME_MARGIN) / TENT_SLOPE + 0.05;
    expect(heights({ nipple: 1, navel: 1 }, [besideTip(past)])[0]).toBeCloseTo(0, 9);
    // and between rin and the dome's edge the floor there is the tent, nothing more (the dome's height is 0)
    const r = RIN + 0.2;
    expect(heights({ nipple: 1, navel: 1 }, [besideTip(r)])[0]).toBeCloseTo(TIP[2] + DOME_MARGIN - TENT_SLOPE * 0.2, 5);
  });

  it('BREAST DETAIL 0 (whole dome, hidden): it reaches out toward wideOut, lifting cloth past domeOut that keep 1 leaves alone', () => {
    const r = (L.domeOut + L.wideOut) / 2; // between domeOut·rho and wideOut·rho
    const [hidden] = heights({ nipple: 0, navel: 1 }, [besideTip(r)]);
    const [shown] = heights({ nipple: 1, navel: 1 }, [besideTip(r)]);
    expect(hidden).toBeGreaterThan(0.05);
    expect(shown).toBeCloseTo(0, 9);
  });

  it('is monotonic: as BREAST DETAIL goes 0, 0.5, 1 the dome over cloth beside the tip never rises', () => {
    const r = RIN + 0.5 * (L.domeOut - RIN);
    const h = [0, 0.25, 0.5, 0.75, 1].map((k) => heights({ nipple: k, navel: 1 }, [besideTip(r)])[0]);
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeLessThanOrEqual(h[i - 1] + 1e-9);
    expect(h[0]).toBeGreaterThan(h[h.length - 1]);
  });

  it('NAVEL DETAIL only widens the navel\'s dome: the same height over it at 0 and 1, wider at 0', () => {
    const [on0] = heights({ nipple: 1, navel: 0 }, [besideNavel(0)]), [on1] = heights({ nipple: 1, navel: 1 }, [besideNavel(0)]);
    expect(on0).toBeCloseTo(NAVEL_H + DOME_MARGIN, 6);
    expect(on1).toBeCloseTo(on0, 9);
    const r = (L.domeOut + L.wideOut) / 2;
    expect(heights({ nipple: 1, navel: 0 }, [besideNavel(r)])[0]).toBeGreaterThan(0.005);
    expect(heights({ nipple: 1, navel: 1 }, [besideNavel(r)])[0]).toBeCloseTo(0, 9);
  });

  it('clamps keep: { nipple: NaN, navel: 2 } lays the domes { nipple: 0, navel: 1 } does', () => {
    const ps = [besideTip(0), besideTip(0.4), besideTip(1.2), besideNavel(0), besideNavel(0.8), besideNavel(1.2)];
    expect(heights({ nipple: NaN, navel: 2 }, ps)).toEqual(heights({ nipple: 0, navel: 1 }, ps));
    expect(heights({ nipple: -3, navel: Infinity }, ps)).toEqual(heights({ nipple: 0, navel: 0 }, ps));
  });

  it('shading(keep) is the cloth tee\'s own (DetailSpots.cloth), from the same measure: nipples 0 at keep 0, nippleRelief at 1', () => {
    const b = detailBody(0.1), gd = new GarmentDetail(b.points, 1, true, restOf(b.rest)), poser = poserOf(b.rest);
    gd.follow(poser, new Float32Array(3), createContacts(1), createContacts(1), 1, true);
    const spots = new DetailSpots(b.points);
    spots.measure(poser);
    for (const keep of [{ nipple: 0, navel: 0 }, { nipple: 0.45, navel: 0.8 }, { nipple: 1, navel: 1 }]) expect(gd.shading(keep)).toEqual(spots.cloth(keep));
    expect(gd.shading({ nipple: 0, navel: 1 }).nipples.map((n) => n.height)).toEqual([0]);
    expect(gd.shading({ nipple: 1, navel: 1 }).nipples.map((n) => n.height)).toEqual([L.nippleRelief]);
    expect(gd.shading({ nipple: 1, navel: 1 }).navel!.height).toBeCloseTo(NAVEL_H, 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentCloth.refit: the tube on the skinned cylinder again, each particle bound to the triangle nearest it (brute
// force), and her SHAPE changed the way the room changes it -- her build's rest shift (`setRestShift`), which only the
// pattern reads -- by `s - 1` times every vertex's rest position: her body scaled `s` times about its own origin.

/** Each particle bound to the nearest body triangle, at its barycentric place and its height off it (garmentCloth.test.ts's). */
function nearestBinding(mesh: THREE.SkinnedMesh, points: Float32Array): ClothBinding {
  const g = mesh.geometry, pos = g.getAttribute('position'), T = Array.from(g.index!.array), n = points.length / 3;
  const tri = new Uint32Array(n * 3), bary = new Float32Array(n * 3), offset = new Float32Array(n);
  const V = (v: number) => new THREE.Vector3().fromBufferAttribute(pos, v), t3 = new THREE.Triangle(), q = new THREE.Vector3(), bc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    let best = -1, bestD = Infinity;
    for (let t = 0; t < T.length; t += 3) {
      t3.set(V(T[t]), V(T[t + 1]), V(T[t + 2]));
      if (t3.getArea() < 1e-12) continue;
      t3.closestPointToPoint(p, q);
      const d = q.distanceToSquared(p);
      if (d < bestD) { bestD = d; best = t; }
    }
    t3.set(V(T[best]), V(T[best + 1]), V(T[best + 2]));
    t3.closestPointToPoint(p, q);
    t3.getBarycoord(q, bc);
    tri.set([T[best], T[best + 1], T[best + 2]], i * 3);
    bary.set([bc.x, bc.y, bc.z], i * 3);
    offset[i] = p.distanceTo(q);
  }
  return { count: n, tri, bary, offset };
}

describe('GarmentCloth.refit: the garment cut again for her shape now', () => {
  function fitted() {
    const body = cylinderBody(), { sewn, points } = tube();
    const gc = new GarmentCloth({
      body, sewn, binding: nearestBinding(body, points), trunkOnly: new Uint8Array(sewn.count).fill(1), armBones: [],
      settings: { substeps: 2 }, standOff: 0.15, material: new THREE.MeshBasicMaterial(), unitsPerMetre: 100,
    });
    return { gc, sewn, body, n: sewn.count };
  }
  /** Her body scaled `s` times, as a rest shift: (s - 1) x every vertex's rest position. */
  const scaled = (body: THREE.SkinnedMesh, s: number) => {
    const pos = body.geometry.getAttribute('position'), out = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) { out[v * 3] = (s - 1) * pos.getX(v); out[v * 3 + 1] = (s - 1) * pos.getY(v); out[v * 3 + 2] = (s - 1) * pos.getZ(v); }
    return out;
  };
  const drafted = (gc: GarmentCloth) => gc['restLengths'] as Map<number, number>;
  const rest = (gc: GarmentCloth, a: number, b: number) => gc['restOf'](a, b) as number;
  /** The sim's own rest per edge against what restOf says. */
  const simAgrees = (gc: GarmentCloth) => {
    const sim = gc['sim'] as ClothSim, E = sim.edges, R = sim['edgeRest'] as Float32Array;
    for (let e = 0; e < R.length; e++) expect(R[e]).toBeCloseTo(rest(gc, E[e * 2], E[e * 2 + 1]), 4);
  };
  /** Each edge's scale now (rest over drafted), split into the tube's vertical edges (same column) and the rest. */
  const scales = (gc: GarmentCloth, n: number) => {
    const vertical: number[] = [], other: number[] = [];
    for (const [k, L] of drafted(gc)) { const a = Math.floor(k / n), b = k % n, f = rest(gc, a, b) / L; ((a % AROUND) === (b % AROUND) ? vertical : other).push(f); }
    return { vertical, other };
  };

  it('with her shape unchanged, refit leaves every edge as drafted and the cloth where it lies', () => {
    const { gc, n } = fitted();
    for (let f = 0; f < 5; f++) gc.frame(1 / 60);
    const x0 = Array.from((gc['sim'] as ClothSim).positions), s0 = gc.strain();
    gc.refit();
    for (const [k, L] of drafted(gc)) expect(rest(gc, Math.floor(k / n), k % n)).toBe(L);
    expect(Array.from((gc['sim'] as ClothSim).positions)).toEqual(x0);
    expect(gc.strain()).toEqual(s0);
    simAgrees(gc);
  });

  it('with her body 1.2 times: every edge cut by how far her skin under it stretched -- the tube\'s length 1.2 times', () => {
    const { gc, body, n } = fitted(), skin = gc['skin'] as ClothSkin;
    const base = skin.restShape(new Float32Array(n * 3));
    gc.setRestShift(scaled(body, 1.2));
    const now = skin.restShape(new Float32Array(n * 3));
    gc.refit();
    // exactly the rule: drafted x clamp(|now| / |base|)
    const len = (P: Float32Array, a: number, b: number) => Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    for (const [k, L] of drafted(gc)) {
      const a = Math.floor(k / n), b = k % n;
      expect(rest(gc, a, b)).toBeCloseTo(L * Math.min(FIT_MAX, Math.max(FIT_MIN, len(now, a, b) / len(base, a, b))), 4);
    }
    // what that comes to: up and down the tube her skin is 1.2 times as long; round it, the cloth stands its own 2 cm off
    // a skin 1.2 times as far round, so a little less (0.18 + 0.02 against 0.15 + 0.02: 1.18)
    const { vertical, other } = scales(gc, n);
    expect(vertical.length).toBeGreaterThan(AROUND * 4);
    for (const f of vertical) expect(f).toBeCloseTo(1.2, 3);
    for (const f of other) { expect(f).toBeGreaterThan(1.15); expect(f).toBeLessThan(1.2 + 1e-3); }
    simAgrees(gc);
  });

  it('clamps a broken reading: ten times her size cuts at most FIT_MAX, a tenth at least FIT_MIN', () => {
    expect([FIT_MIN, FIT_MAX]).toEqual([0.5, 3]);
    for (const [s, bound] of [[10, FIT_MAX], [0.1, FIT_MIN]] as const) {
      const { gc, body, n } = fitted();
      gc.setRestShift(scaled(body, s));
      gc.refit();
      const { vertical, other } = scales(gc, n);
      for (const f of [...vertical, ...other]) { expect(f).toBeLessThanOrEqual(FIT_MAX + 1e-6); expect(f).toBeGreaterThanOrEqual(FIT_MIN - 1e-6); }
      for (const f of vertical) expect(f).toBeCloseTo(bound, 4);
    }
  });

  it('settle carries the cut over: refit again with her shape unchanged keeps it 1.2 times, not back to 1', () => {
    const { gc, body, n } = fitted();
    gc.setRestShift(scaled(body, 1.2));
    gc.refit();
    const cut = new Map([...drafted(gc).keys()].map((k) => [k, rest(gc, Math.floor(k / n), k % n)]));
    for (let f = 0; f < 5; f++) gc.frame(1 / 60);
    gc.settle();
    // the new skin reads her shape with the same rest shift, through the new binding
    expect((gc['skin'] as ClothSkin).restShift).not.toBeNull();
    for (const [k, r] of cut) expect(rest(gc, Math.floor(k / n), k % n)).toBeCloseTo(r, 4);
    gc.refit();
    for (const [k, r] of cut) expect(rest(gc, Math.floor(k / n), k % n)).toBeCloseTo(r, 4);
    for (const f of scales(gc, n).vertical) expect(f).toBeCloseTo(1.2, 3);
    simAgrees(gc);
  });

  it('setRestShift(null, true) after a refit: her shape taken afresh, every edge as drafted again', () => {
    const { gc, body, n } = fitted();
    gc.setRestShift(scaled(body, 1.2));
    gc.refit();
    expect(scales(gc, n).vertical[0]).toBeCloseTo(1.2, 3);
    gc.setRestShift(null, true);
    for (const [k, L] of drafted(gc)) expect(rest(gc, Math.floor(k / n), k % n)).toBe(L);
    expect((gc['skin'] as ClothSkin).restShift).toBeNull();
    // and a refit from there, with nothing changed, leaves it so
    gc.refit();
    for (const [k, L] of drafted(gc)) expect(rest(gc, Math.floor(k / n), k % n)).toBe(L);
    simAgrees(gc);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The dome's flat top as wide as the cloth's spacing (`GarmentDetail` edges -> `spacing` -> `domeOver`'s `flat`), on the
// flat synthetic details (rho 1: domeIn·rho 0.5, domeOut·rho 0.9, wideOut·rho 1.6; the nipple's tip 0.5 proud).

describe('GarmentDetail.spacing and domeOver(flat): the flat top at least as wide as the cloth over it', () => {
  const L = DETAIL_LOOK, TIP_X = TIP[0];
  /** One follow over particles `ps` with the cloth's `triangles`; the detail, posed. */
  function followed(ps: [number, number, number][], triangles?: number[]) {
    const b = detailBody(), gd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest), triangles ? Uint32Array.from(triangles) : undefined);
    const { positions, after, before } = particlesOver(ps);
    gd.follow(poserOf(b.rest), positions, after, before, ps.length, true);
    return { gd, d: gd.posed.nipples[0], tip: gd.tips[1] };
  }
  /** A particle `r` out from the tip's axis (along +x, or across it along +y), low over her skin. */
  const beside = (r: number, z = 0.01, across = false): [number, number, number] => posedAt(across ? [TIP_X, r, z] : [TIP_X + r, 0, z]);
  /** Contact heights from domeOver on the nipple alone, at amount 1, hide 0, with `flat`. */
  function dome(flat: number | undefined, ps: [number, number, number][]): number[] {
    const { d, tip } = followed([[50, 50, 50]]);
    const { positions, after } = particlesOver(ps);
    if (flat === undefined) domeOver(d, positions, after, ps.length, tip, 1, 0);
    else domeOver(d, positions, after, ps.length, tip, 1, 0, flat);
    return ps.map((_, i) => heightOf(after, i));
  }

  /** A particle at (x, y) off the tip's axis, `z` up it (posed). */
  const at = (x: number, y: number, z: number): [number, number, number] => posedAt([TIP_X + x, y, z]);
  /** The triangle over the tip, 1 up: a corner 1.5 out along +x and two 0.78 out behind the axis (it encloses it). */
  const OVER = [at(1.5, 0, 1), at(-0.5, 0.6, 1), at(-0.5, -0.6, 1)];
  /** The same, its far corner 1.0 out: every corner within COVER_REACH·rho, so it is the cloth over the tip (`cover`). */
  const NEAR = [at(1.0, 0, 1), at(-0.5, 0.6, 1), at(-0.5, -0.6, 1)];

  it('spacing is SPACING_SLACK times the farthest corner, off the axis, of the one triangle the axis crosses nearest the tip', () => {
    expect(SPACING_SLACK).toBe(1.15);
    const { gd } = followed(OVER, [0, 1, 2]);
    expect(gd.spacing[1]).toBeCloseTo(SPACING_SLACK * 1.5, 6);
    expect(gd.widened[1]).toBeCloseTo(SPACING_SLACK * 1.5 - L.domeIn, 6);
    // nothing of it near the navel
    expect(gd.spacing[0]).toBe(0);
    expect(gd.widened[0]).toBe(0);
    // a long edge nearby on a triangle the axis does not cross (4 long, starting 0.8 off the axis) does not count
    const beside3 = [at(0.8, 0, 1), at(4.5, 0.5, 1), at(0.8, 1, 1)];
    expect(followed([...OVER, ...beside3], [0, 1, 2, 3, 4, 5]).gd.spacing[1]).toBeCloseTo(SPACING_SLACK * 1.5, 6);
    // nor does a wider triangle the axis crosses further from the tip (3 up, a corner 2.5 out)
    const higher = [at(2.5, 0, 3), at(-0.5, 0.6, 3), at(-0.5, -0.6, 3)];
    expect(followed([...higher, ...OVER], [0, 1, 2, 3, 4, 5]).gd.spacing[1]).toBeCloseTo(SPACING_SLACK * 1.5, 6);
    // the only triangle crossed being the higher one: it is the one
    expect(followed(higher, [0, 1, 2]).gd.spacing[1]).toBeCloseTo(SPACING_SLACK * 2.5, 6);
    // none crossed, no triangles, or a crossing triangle whose first corner is past 3·wideOut·rho of the tip: 0
    expect(followed(beside3, [0, 1, 2]).gd.spacing[1]).toBe(0);
    expect(followed(OVER).gd.spacing).toEqual([0, 0, 0]);
    const far = 3 * L.wideOut + 0.5;
    expect(followed([at(far, 0, 1), at(-far, 3, 1), at(-far, -3, 1)], [0, 1, 2]).gd.spacing[1]).toBe(0);
  });

  it('follow holds the corners of the triangle over the tip at tip + DOME_MARGIN, however far out; others get the plain dome', () => {
    // the three corners (1.0 out, past the dome's edge at BREAST DETAIL 1, and 0.78), and a particle 1.4 out that is no corner
    const ps = [...NEAR.map(([x, y, z]) => [x, y, z - 0.99] as [number, number, number]), at(0, 1.4, 0.01)];
    const b = detailBody(), gd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest), Uint32Array.from([0, 1, 2]));
    for (const keep of [{ nipple: 0, navel: 1 }, { nipple: 1, navel: 1 }]) {
      gd.keep = keep;
      const { positions, after, before } = particlesOver(ps);
      gd.follow(poserOf(b.rest), positions, after, before, ps.length, true);
      for (const c of [0, 1, 2]) expect(heightOf(after, c)).toBeCloseTo(TIP[2] + DOME_MARGIN, 5);
      expect(heightOf(after, 3)).toBeLessThan(TIP[2] + DOME_MARGIN - 0.1);
    }
    // the flat top is no longer widened: spacing is measured (a diagnostic) and the 1.4 particle gets what it gets without triangles
    expect(gd.spacing[1]).toBeCloseTo(SPACING_SLACK * 1.0, 6);
    gd.keep = { nipple: 0, navel: 1 };
    const withT = particlesOver(ps), plainGd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest)), without = particlesOver(ps);
    plainGd.keep = { nipple: 0, navel: 1 };
    gd.follow(poserOf(b.rest), withT.positions, withT.after, withT.before, ps.length, true);
    plainGd.follow(poserOf(b.rest), without.positions, without.after, without.before, ps.length, true);
    expect(heightOf(withT.after, 3)).toBeCloseTo(heightOf(without.after, 3), 9);
  });

  it('cover holds the three particles of the triangle over each tip, -1 for none', () => {
    const { gd } = followed(NEAR, [0, 1, 2]);
    expect(Array.from(gd.cover)).toEqual([-1, -1, -1, 0, 1, 2, -1, -1, -1]);
    // of two crossed, the nearer the tip
    const higher = [at(1.1, 0, 3), at(-0.5, 0.6, 3), at(-0.5, -0.6, 3)];
    expect(Array.from(followed([...higher, ...NEAR], [0, 1, 2, 5, 3, 4]).gd.cover.subarray(3, 6))).toEqual([5, 3, 4]);
    expect(Array.from(followed([...NEAR, ...higher], [0, 1, 2, 5, 3, 4]).gd.cover.subarray(3, 6))).toEqual([0, 1, 2]);
    // no triangles, or none crossed: all -1
    expect(Array.from(followed(NEAR).gd.cover)).toEqual(new Array(9).fill(-1));
    expect(Array.from(followed([at(0.8, 0, 1), at(4.5, 0.5, 1), at(0.8, 1, 1)], [0, 1, 2]).gd.cover)).toEqual(new Array(9).fill(-1));
  });

  it('a triangle over the tip reaching past COVER_REACH·rho is not the cloth over it: no cover, nothing held, the dome alone', () => {
    expect(COVER_REACH).toBe(1.2);
    // OVER: a corner 1.5 out (past 1.2), the triangle still the one the axis crosses nearest the tip
    const ps = OVER.map(([x, y, z]) => [x, y, z - 0.99] as [number, number, number]);
    const b = detailBody(), gd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest), Uint32Array.from([0, 1, 2]));
    const plainGd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest));
    for (const keep of [{ nipple: 0, navel: 1 }, { nipple: 1, navel: 1 }]) {
      gd.keep = keep; plainGd.keep = keep;
      const withT = particlesOver(ps), without = particlesOver(ps);
      gd.follow(poserOf(b.rest), withT.positions, withT.after, withT.before, ps.length, true);
      plainGd.follow(poserOf(b.rest), without.positions, without.after, without.before, ps.length, true);
      expect(Array.from(gd.cover)).toEqual(new Array(9).fill(-1));
      // its contacts are the dome's, exactly as with no triangles at all
      expect(Array.from(withT.after.point)).toEqual(Array.from(without.after.point));
      // the far corner, past the dome, on her skin
      expect(heightOf(withT.after, 0)).toBeLessThan(TIP[2] + DOME_MARGIN - 0.1);
    }
    // spacing is still measured from it
    expect(gd.spacing[1]).toBeCloseTo(SPACING_SLACK * 1.5, 6);
    // just inside the reach it is held
    const inside = followed([at(1.19, 0, 1), at(-0.5, 0.6, 1), at(-0.5, -0.6, 1)], [0, 1, 2]).gd;
    expect(Array.from(inside.cover.subarray(3, 6))).toEqual([0, 1, 2]);
  });

  it('domeOver(lift): a held particle gets tip + DOME_MARGIN wherever it is; a contact already above, -1s and no lift change nothing', () => {
    const { d, tip } = followed([[50, 50, 50]]), H = tip.along + DOME_MARGIN;
    const run = (ps: [number, number, number][], lift?: number[], skinZ?: number[]) => {
      const { positions, after } = particlesOver(ps);
      if (skinZ) skinZ.forEach((z, i) => { after.point[i * 3 + 2] = POSE[2] + z; });
      domeOver(d, positions, after, ps.length, tip, 1, 0, 0, lift);
      return ps.map((_, i) => heightOf(after, i));
    };
    const ps = [at(5, 0, 0.01), at(0, 5, 2), at(-5, 0, 0.01), at(0.3, 0, 0.01)];
    // far outside the dome (5 rho), on the skin or well above it: held at the tip's height and margin
    const held = run(ps, [0, 1, 2]);
    for (const i of [0, 1, 2]) expect(held[i]).toBeCloseTo(H, 6);
    // ...and a held particle whose contact already stands above that is left alone
    expect(run(ps, [0, -1, -1], [H + 0.3, 0, 0, 0])[0]).toBeCloseTo(H + 0.3, 6);
    // -1 entries hold nothing; no lift at all: as before (far ones untouched, the one inside the dome domed)
    const plain = run(ps);
    expect(run(ps, [-1, -1, -1])).toEqual(plain);
    for (const i of [0, 1, 2]) expect(plain[i]).toBeCloseTo(0, 9);
    expect(plain[3]).toBeCloseTo(H, 6);
    // holding one that is inside the dome changes nothing for it: it was already at the tip's height
    expect(run(ps, [3, -1, -1])[3]).toBeCloseTo(plain[3], 9);
  });

  it('flat 1.5 widens the flat top: at r 1.4 the full tip height and DOME_MARGIN, where flat 0 gives less', () => {
    expect(L.domeIn * 1).toBeLessThan(1.5);
    const [wide] = dome(1.5, [beside(1.4)]), [plain] = dome(0, [beside(1.4)]);
    expect(wide).toBeCloseTo(TIP[2] + DOME_MARGIN, 6);
    expect(plain).toBeLessThan(wide - 0.1);
  });

  it('the fall keeps its width: it ends at the old edge plus the widening, no sooner and no later', () => {
    const shift = 1.5 - L.domeIn, edge = L.domeOut + shift, eps = 0.01;
    // (the dome and the tent both fade to her skin at the edge, so just inside it the lift is small, but there)
    const [inside, outside] = dome(1.5, [beside(edge - eps), beside(edge + eps)]);
    expect(inside).toBeGreaterThan(1e-4);
    expect(inside).toBeLessThan(0.05);
    expect(outside).toBeCloseTo(0, 9);
    // and without the widening the old edge is where it ends
    const [i0, o0] = dome(0, [beside(L.domeOut - eps), beside(L.domeOut + eps)]);
    expect(i0).toBeGreaterThan(1e-4);
    expect(o0).toBeCloseTo(0, 9);
    // the fall is the same shape, moved out by the widening: the same lift at the same distance inside each edge
    for (const back of [0.05, 0.15, 0.3]) expect(dome(1.5, [beside(edge - back)])[0]).toBeCloseTo(dome(0, [beside(L.domeOut - back)])[0], 5);
  });

  it('flat 0, NaN, Infinity or below the plain flat top changes nothing -- in particular Infinity is not an infinite dome', () => {
    const ps = [0, 0.3, 0.6, 0.85, 0.95, 1.4, 3, 50].map((r) => beside(r));
    const plain = dome(undefined, ps);
    for (const flat of [0, NaN, Infinity, -Infinity, -2, 0.3]) expect(dome(flat, ps)).toEqual(plain);
    // far out stays untouched under Infinity
    expect(dome(Infinity, [beside(50)])[0]).toBeCloseTo(0, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentCloth.detailGap: a navel laid on the tube rig's cylinder -- a front vertex at mid-height, its rings the vertices
// round it one and two steps away in its grid, ordered counter-clockwise seen from outside -- under the tube 2 cm off.

describe('GarmentCloth.detailGap: the sheet over each tip, along its axis', () => {
  function navelOnCylinder(body: THREE.SkinnedMesh): DetailPoints {
    // CylinderGeometry(…, 24, 12, open): 13 rows of 25 (the last column repeats the first); row 6 is y = 0, column 0 faces +z
    const cols = 25, id = (row: number, col: number) => row * cols + ((col + 24) % 24), centre = id(6, 0);
    const pos = body.geometry.getAttribute('position'), cx = pos.getX(centre), cy = pos.getY(centre);
    const ringOf = (k: number) => {
      const vs: number[] = [];
      for (let r = -k; r <= k; r++) for (let c = -k; c <= k; c++) if (Math.max(Math.abs(r), Math.abs(c)) === k) vs.push(id(6 + r, c));
      return vs.sort((a, b) => Math.atan2(pos.getY(a) - cy, pos.getX(a) - cx) - Math.atan2(pos.getY(b) - cy, pos.getX(b) - cx));
    };
    return { navel: centre, navelRings: [ringOf(1), ringOf(2)], nipples: [], nippleRings: [] };
  }

  it('is positive with the sheet over the tip, negative with the tip through it, Infinity with no sheet on the line', () => {
    const body = cylinderBody(), { sewn, points } = tube();
    const gc = new GarmentCloth({
      body, sewn, binding: nearestBinding(body, points), trunkOnly: new Uint8Array(sewn.count).fill(1), armBones: [],
      settings: { substeps: 2 }, standOff: 0.15, material: new THREE.MeshBasicMaterial(), unitsPerMetre: 100, detail: navelOnCylinder(body),
    });
    gc.weightless = true;
    gc.frame(1 / 60);
    // the navel faces out of the cylinder (+z), and its tip is on her skin there, 15 units out
    const posed = (gc['detail'] as GarmentDetail).posed.navel;
    expect(posed.n[2]).toBeGreaterThan(0.99);
    const tipAt = (gc['detail'] as GarmentDetail).tips[0].at;
    expect(Math.hypot(tipAt[0], tipAt[2])).toBeCloseTo(R_BODY * 100, 1);
    const over = gc.detailGap()!;
    expect(over.nipples).toEqual([]);
    // the tube is 2 cm off her: the sheet stands about 2 units over the tip (its chord a little nearer)
    expect(over.navel).toBeGreaterThan(1.5);
    expect(over.navel).toBeLessThan(2.1);
    // the sheet drawn in to 13 cm round, inside her: the tip is through it, by about 2
    const x = (gc['sim'] as ClothSim).positions;
    for (let i = 0; i < sewn.count; i++) { x[i * 3] *= 13 / 17; x[i * 3 + 2] *= 13 / 17; }
    const through = gc.detailGap()!.navel;
    expect(through).toBeLessThan(-1.5);
    expect(through).toBeGreaterThan(-2.6);
    // lifted clear of the axis altogether: no crossing
    for (let i = 0; i < sewn.count; i++) x[i * 3 + 1] += 1000;
    expect(gc.detailGap()!.navel).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentDetail.shading with the cloth's gaps: the synthetic details with a SECOND nipple (at x = -50, the same shape as
// the first), so one can be softened and the other not. Spot radii: the navel's navelRadius·rho, a nipple's
// nippleRadius·rho (rho 1).

describe('GarmentDetail.shading(keep, gaps, touch): a spot spreads and fades as the cloth stands further off it', () => {
  const KEEP = { nipple: 1, navel: 1 }, TOUCH = 0.2;
  function twoNipples() {
    const b = detailBody(), rest = b.rest;
    const ring = (cx: number, r: number) => Array.from({ length: 16 }, (_, j) => { const a = (2 * Math.PI * j) / 16; rest.push([cx + r * Math.cos(a), r * Math.sin(a), 0]); return rest.length - 1; });
    rest.push([-50, 0, CENTRE_H]);
    const c2 = rest.length - 1, rings2 = [ring(-50, 1), ring(-50, 2)];
    const points: DetailPoints = { ...b.points, nipples: [...b.points.nipples, c2], nippleRings: [...b.points.nippleRings, rings2] };
    const gd = new GarmentDetail(points, 1, true, restOf(rest)), poser = poserOf(rest);
    gd.follow(poser, new Float32Array(3), createContacts(1), createContacts(1), 1, true);
    const spots = new DetailSpots(points);
    spots.measure(poser);
    return { gd, base: spots.cloth(KEEP) };
  }

  it('SHADE_SPREAD is 1; without gaps it is the tee\'s own spots', () => {
    expect(SHADE_SPREAD).toBe(1);
    const { gd, base } = twoNipples();
    expect(base.nipples.length).toBe(2);
    expect(base.navel).not.toBeNull();
    expect(gd.shading(KEEP)).toEqual(base);
    expect(gd.shading(KEEP, undefined, TOUCH)).toEqual(base);
  });

  it('a gap within touch, or none to be had (Infinity, NaN, missing), leaves a spot as the tee\'s', () => {
    const { gd, base } = twoNipples();
    gd.shade = { spread: 1, widen: 0, slope: Infinity };
    expect(gd.shading(KEEP, { navel: TOUCH, nipples: [TOUCH - 0.1, -3] }, TOUCH)).toEqual(base);
    expect(gd.shading(KEEP, { navel: Infinity, nipples: [NaN, -Infinity] }, TOUCH)).toEqual(base);
    expect(gd.shading(KEEP, { navel: NaN, nipples: [] }, TOUCH)).toEqual(base);
  });

  it('a gap 0.5 past touch: radius hypot(r, 0.5), height times r² / (r² + 0.25) -- each spot on its own gap', () => {
    const { gd, base } = twoNipples(), e = 0.5;
    gd.shade = { spread: 1, widen: 0, slope: Infinity };
    const soft = (spot: { radius: number; height: number }) => ({ radius: Math.hypot(spot.radius, e), height: spot.height * spot.radius ** 2 / (spot.radius ** 2 + e * e) });
    // the navel softened, the nipples not
    const navelOnly = gd.shading(KEEP, { navel: TOUCH + e, nipples: [TOUCH, Infinity] }, TOUCH);
    expect(navelOnly.navel!.radius).toBeCloseTo(soft(base.navel!).radius, 9);
    expect(navelOnly.navel!.height).toBeCloseTo(soft(base.navel!).height, 9);
    expect(navelOnly.navel!.center).toEqual(base.navel!.center);
    expect(navelOnly.navel!.normal).toEqual(base.navel!.normal);
    expect(navelOnly.nipples).toEqual(base.nipples);
    // one nipple softened, the other not
    const one = gd.shading(KEEP, { navel: Infinity, nipples: [TOUCH + e, TOUCH] }, TOUCH);
    expect(one.navel).toEqual(base.navel);
    expect(one.nipples[0].radius).toBeCloseTo(soft(base.nipples[0]).radius, 9);
    expect(one.nipples[0].height).toBeCloseTo(soft(base.nipples[0]).height, 9);
    expect(one.nipples[0].center).toEqual(base.nipples[0].center);
    expect(one.nipples[0].normal).toEqual(base.nipples[0].normal);
    expect(one.nipples[1]).toEqual(base.nipples[1]);
    // the brief's own numbers, on a spot 0.6 across: radius hypot(0.6, 0.5), height x 0.36 / 0.61
    expect(soft({ radius: 0.6, height: 1 })).toEqual({ radius: Math.hypot(0.6, 0.5), height: 0.36 / 0.61 });
  });

  it('is monotonic: as the gap grows the spot widens and fades, its relief\'s volume (h r²) kept', () => {
    const { gd, base } = twoNipples(), v0 = base.nipples[0].height * base.nipples[0].radius ** 2;
    gd.shade = { spread: 1, widen: 0, slope: Infinity };
    let last = { radius: base.nipples[0].radius, height: base.nipples[0].height };
    for (const g of [0.25, 0.4, 0.7, 1, 2, 5]) {
      const s0 = gd.shading(KEEP, { navel: Infinity, nipples: [g, Infinity] }, TOUCH).nipples[0];
      expect(s0.radius).toBeGreaterThan(last.radius);
      expect(s0.height).toBeLessThan(last.height);
      expect(s0.height * s0.radius ** 2).toBeCloseTo(v0, 9);
      last = s0;
    }
  });

  it('defaults to the cloth tee\'s own spots (spread 1, widen 0, no cap, grow 1); the cap, set, holds a steep spot to slope·r/0.86', () => {
    const { gd, base } = twoNipples();
    expect(SHADE_SLOPE).toBe(0.5);
    expect(SHADE_NAVEL_GROW).toBe(1.5);
    expect(gd.shade).toEqual({ spread: SHADE_SPREAD, widen: 0, slope: Infinity, grow: 1 });
    // by default, with no gap to spread by, exactly the tee's spots: the navel's definite shape, as the red tee draws it
    expect(gd.shading(KEEP, { navel: Infinity, nipples: [Infinity, Infinity] }, TOUCH)).toEqual(base);
    expect(gd.shading(KEEP, { navel: NaN, nipples: [] }, TOUCH)).toEqual(base);
    // the cap and the navel's growth, asked for as a probe asks for them
    gd.shade = { spread: SHADE_SPREAD, widen: 0, slope: SHADE_SLOPE, grow: SHADE_NAVEL_GROW };
    const nip = base.nipples[0], nav = base.navel!;
    // the fixture's nipple is steep (0.86 h / r = 0.86), its navel shallow (0.86 x 0.1 / 0.35, about 0.25)
    expect(0.86 * nip.height / nip.radius).toBeGreaterThan(SHADE_SLOPE);
    expect(0.86 * nav.height / nav.radius).toBeLessThan(SHADE_SLOPE);
    const none = { navel: Infinity, nipples: [Infinity, Infinity] };
    const capped = gd.shading(KEEP, none, TOUCH);
    // no spread: the nipples keep their radius, their height drops to the cap; the navel grown half as wide again, its
    // height kept unless the cap (at the grown radius) bites
    for (let i = 0; i < 2; i++) {
      expect(capped.nipples[i].radius).toBe(base.nipples[i].radius);
      expect(capped.nipples[i].height).toBeCloseTo(SHADE_SLOPE * base.nipples[i].radius / 0.86, 9);
      expect(capped.nipples[i].center).toEqual(base.nipples[i].center);
    }
    expect(capped.navel!.radius).toBeCloseTo(SHADE_NAVEL_GROW * nav.radius, 9);
    expect(capped.navel!.height).toBeCloseTo(Math.min(nav.height, (SHADE_SLOPE * SHADE_NAVEL_GROW * nav.radius) / 0.86), 9);
    expect(capped.navel!.height).toBe(nav.height); // this one shallow enough that it is
    expect(capped.navel!.center).toEqual(nav.center);
    expect(capped.navel!.normal).toEqual(nav.normal);
    // spread past where the cap bites (0.5 past touch): the spread alone decides
    const spread = gd.shading(KEEP, { navel: Infinity, nipples: [TOUCH + 0.5, Infinity] }, TOUCH).nipples[0];
    const r2 = Math.hypot(nip.radius, 0.5);
    expect(spread.radius).toBeCloseTo(r2, 9);
    expect(spread.height).toBeCloseTo(nip.height * (nip.radius / r2) ** 2, 9);
    // a slope of 0, below 0 or not finite: no cap
    for (const slope of [0, -1, NaN, Infinity]) {
      gd.shade = { spread: 1, widen: 1, slope };
      expect(gd.shading(KEEP, none, TOUCH)).toEqual(base);
    }
  });

  it('grow is the navel\'s alone: the nipples come out the same at grow 3 as at 1; the navel grows, then spreads and is capped', () => {
    const { gd, base } = twoNipples(), nav = base.navel!;
    const gaps = { navel: TOUCH + 0.5, nipples: [TOUCH + 0.5, Infinity] };
    gd.shade = { spread: 1, widen: 0, slope: SHADE_SLOPE, grow: 1 };
    const one = gd.shading(KEEP, gaps, TOUCH);
    gd.shade = { spread: 1, widen: 0, slope: SHADE_SLOPE, grow: 3 };
    const three = gd.shading(KEEP, gaps, TOUCH);
    expect(three.nipples).toEqual(one.nipples);
    // the navel: grown to 3r, spread by the gap from there (its height falls by the spread, not by the growth), then capped
    const r = 3 * nav.radius, r2 = Math.hypot(r, 0.5), h = nav.height * (r / r2) ** 2;
    expect(three.navel!.radius).toBeCloseTo(r2, 9);
    expect(three.navel!.height).toBeCloseTo(Math.min(h, (SHADE_SLOPE * r2) / 0.86), 9);
    // a steep navel is capped at its grown radius: 1.5r carries 1.5 times the height 1r would
    const steep = { ...base, navel: { ...nav, height: 1 } };
    gd['spots'].cloth = () => steep;
    gd.shade = { spread: 1, widen: 0, slope: SHADE_SLOPE, grow: 1.5 };
    expect(gd.shading(KEEP, { navel: Infinity, nipples: [] }, TOUCH).navel!.height).toBeCloseTo((SHADE_SLOPE * 1.5 * nav.radius) / 0.86, 9);
  });

  it('grow missing, 0, below 0 or not finite counts as 1', () => {
    const { gd } = twoNipples(), gaps = { navel: TOUCH + 0.3, nipples: [TOUCH + 0.3, Infinity] };
    gd.shade = { spread: 1, widen: 0, slope: SHADE_SLOPE, grow: 1 };
    const one = gd.shading(KEEP, gaps, TOUCH);
    for (const grow of [undefined, 0, -2, NaN, Infinity]) {
      gd.shade = grow === undefined ? { spread: 1, widen: 0, slope: SHADE_SLOPE } : { spread: 1, widen: 0, slope: SHADE_SLOPE, grow };
      expect(gd.shading(KEEP, gaps, TOUCH)).toEqual(one);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentDetail.apex: on the flat details, the navel's tip is its centre (x = 100, 0.1 proud, rho 1, axis +z).

describe('GarmentDetail.apex: the cloth point nearest her navel\'s axis is laid on it, the top of a tent', () => {
  const nav = (x: number, y: number, z: number): [number, number, number] => posedAt([NAVEL_AT + x, y, z]);
  /** One follow over `ps` (the navel's keep at its default); the detail, the moved positions and the contacts. */
  function run(ps: [number, number, number][], domes = true, triangles?: number[]) {
    const b = detailBody(), gd = new GarmentDetail(b.points, ps.length, domes, restOf(b.rest), triangles ? Uint32Array.from(triangles) : undefined);
    const { positions, after, before } = particlesOver(ps), was = Float32Array.from(positions);
    gd.follow(poserOf(b.rest), positions, after, before, ps.length, true);
    return { gd, positions, after, was };
  }
  const moved = (a: Float32Array, b: Float32Array) => { const out: number[] = []; for (let i = 0; i < a.length / 3; i++) if (a[i * 3] !== b[i * 3] || a[i * 3 + 1] !== b[i * 3 + 1] || a[i * 3 + 2] !== b[i * 3 + 2]) out.push(i); return out; };

  it('picks the nearest the axis within APEX_REACH·rho and moves it onto the axis, its height along it kept', () => {
    expect(APEX_REACH).toBe(0.8);
    const ps = [nav(0.5, 0, 0.4), nav(0.3, 0.1, 0.6), nav(1.5, 0, 0.5), nav(-0.6, 0.2, 0.3)];
    const { gd, positions, was, after } = run(ps);
    expect(gd.apex).toBe(1);
    expect(moved(positions, was)).toEqual([1]);
    const on = posedAt([NAVEL_AT, 0, 0.6]);
    for (let k = 0; k < 3; k++) expect(positions[3 + k]).toBeCloseTo(on[k], 5);
    // held at least at the tip's height and DOME_MARGIN, its contact on the axis under it
    expect(heightOf(after, 1)).toBeGreaterThanOrEqual(gd.tips[0].along + DOME_MARGIN - 1e-6);
    expect(after.point[3]).toBeCloseTo(on[0], 5);
    expect(after.point[4]).toBeCloseTo(on[1], 5);
  });

  it('none within APEX_REACH·rho: no apex, nothing moved', () => {
    const ps = [nav(0.85, 0, 0.4), nav(0, 0.9, 0.3), nav(-1.2, 0.3, 0.5)];
    const { gd, positions, was } = run(ps);
    expect(gd.apex).toBe(-1);
    expect(moved(positions, was)).toEqual([]);
  });

  it('only within a band along the axis, -0.5·rho to 3·rho of the tip: nearer points behind it or far above are passed over', () => {
    const tipZ = NAVEL_H;
    // on the axis but 0.6 under the tip, and 3.2 above it; then one 0.4 off the axis at a plain height
    const ps = [nav(0, 0.01, tipZ - 0.6), nav(0.01, 0, tipZ + 3.2), nav(0.4, 0, tipZ + 0.3)];
    const { gd, positions, was } = run(ps);
    expect(gd.apex).toBe(2);
    expect(moved(positions, was)).toEqual([2]);
    // just inside the band at both ends: taken
    expect(run([nav(0.02, 0, tipZ - 0.49), nav(0.4, 0, tipZ + 0.3)]).gd.apex).toBe(0);
    expect(run([nav(0.02, 0, tipZ + 2.99), nav(0.4, 0, tipZ + 0.3)]).gd.apex).toBe(0);
  });

  it('the nipples get no apex: a point near a nipple\'s axis is not moved', () => {
    const ps = [posedAt([TIP[0] + 0.1, 0.05, 0.7]), posedAt([TIP[0] - 0.2, 0, 0.6])];
    const { gd, positions, was } = run(ps);
    expect(gd.apex).toBe(-1);
    expect(moved(positions, was)).toEqual([]);
  });

  it('domes off: no apex chosen and nothing moved', () => {
    const { gd, positions, was } = run([nav(0.3, 0.1, 0.6), nav(0.5, 0, 0.4)], false);
    expect(gd.apex).toBe(-1);
    expect(moved(positions, was)).toEqual([]);
  });

  it('with no apex the navel falls back to the corners of the triangle over its tip, held wherever they are', () => {
    // a triangle round the navel's axis, its corners 1.0 out (past APEX_REACH, within COVER_REACH)
    const ps = [nav(1.0, 0, 0.05), nav(-0.5, 0.87, 0.05), nav(-0.5, -0.87, 0.05)];
    const { gd, positions, was, after } = run(ps, true, [0, 1, 2]);
    expect(gd.apex).toBe(-1);
    expect(Array.from(gd.cover.subarray(0, 3))).toEqual([0, 1, 2]);
    expect(moved(positions, was)).toEqual([]);
    for (let i = 0; i < 3; i++) expect(heightOf(after, i)).toBeCloseTo(gd.tips[0].along + DOME_MARGIN, 5);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The apex's height (`apexHeight`, `domeOver`'s `liftTo`): the flat navel (tip 0.1 proud, curve 0) with relief vertices
// of its own added round the tip, and the apex in one triangle whose nearer other corner is R = 0.6 off the axis.

describe('GarmentDetail.apexAlong: the apex held high enough that its triangles clear her navel\'s relief', () => {
  const R = 0.6, AT_Z = 0.5, TIP_TOP = NAVEL_H;
  const nav = (x: number, y: number, z: number): [number, number, number] => posedAt([NAVEL_AT + x, y, z]);
  /** The apex (0.05 off the axis, laid on it) and its triangle's other corners B and C, R and 0.8 off it, `zb`/`zc` proud. */
  const fanOf = (zb = 0, zc = 0) => [nav(0.05, 0, AT_Z), nav(R, 0, zb), nav(0, 0.8, zc)];
  const PS = fanOf(), TRI = [0, 1, 2];
  /** The point of the apex's triangle at weights (wa on the apex, at the axis; wb on B; wc on C), across the axis. */
  const wPoint = (wa: number, wb: number, wc: number): [number, number] => { void wa; return [wb * R, wc * 0.8]; };
  /** One follow with `relief` vertices (x, y off the navel's axis, z their height) added to her body round the navel. */
  function run(relief: [number, number, number][], ps: [number, number, number][] = PS, triangles: number[] = TRI) {
    const b = detailBody();
    for (const [x, y, z] of relief) b.rest.push([NAVEL_AT + x, y, z]);
    const gd = new GarmentDetail(b.points, ps.length, true, restOf(b.rest), Uint32Array.from(triangles));
    const { positions, after, before } = particlesOver(ps);
    gd.follow(poserOf(b.rest), positions, after, before, ps.length, true);
    return { gd, after };
  }

  it('with no relief nearer than R but the tip\'s own: the tip\'s relief and DOME_MARGIN', () => {
    expect(APEX_MAX).toBe(3);
    // a vertex just past R, however high it stands short of the tip, adds nothing
    for (const relief of [[], [[R + 0.02, 0, 0.09]]] as [number, number, number][][]) {
      const { gd, after } = run(relief);
      expect(gd.apex).toBe(0);
      expect(gd.tips[0].top).toBeCloseTo(TIP_TOP, 6);
      expect(gd.apexAlong).toBeCloseTo(TIP_TOP + DOME_MARGIN, 6);
      expect(heightOf(after, 0)).toBeCloseTo(TIP_TOP + DOME_MARGIN, 5);
    }
  });

  it('a vertex at weights (0.5, 0.25, 0.25) standing e proud, B and C on her skin: the apex at (e + margin) / 0.5', () => {
    const e = 0.08, [x, y] = wPoint(0.5, 0.25, 0.25), want = (e + DOME_MARGIN) / 0.5;
    expect(want).toBeGreaterThan(TIP_TOP + DOME_MARGIN);
    const { gd, after } = run([[x, y, e]]);
    expect(gd.apex).toBe(0);
    expect(gd.apexAlong).toBeCloseTo(want, 6);
    expect(heightOf(after, 0)).toBeCloseTo(want, 5);
    // when that is below the tip's own and margin: the tip's
    expect((0.01 + DOME_MARGIN) / 0.5).toBeLessThan(TIP_TOP + DOME_MARGIN);
    expect(run([[x, y, 0.01]]).gd.apexAlong).toBeCloseTo(TIP_TOP + DOME_MARGIN, 6);
  });

  it('corners standing proud take part of it: (e + margin - wb·hB - wc·hC) / wa', () => {
    const e = 0.08, [x, y] = wPoint(0.5, 0.25, 0.25), hB = 0.04, hC = 0.04;
    const want = (e + DOME_MARGIN - 0.25 * hB - 0.25 * hC) / 0.5;
    expect(want).toBeGreaterThan(TIP_TOP + DOME_MARGIN);
    const { gd } = run([[x, y, e]], fanOf(hB, hC));
    expect(gd.apexAlong).toBeCloseTo(want, 6);
    expect(gd.apexAlong).toBeLessThan((e + DOME_MARGIN) / 0.5);
    // corners high enough need nothing of the apex past the tip's own
    expect(run([[x, y, e]], fanOf(0.2, 0.2)).gd.apexAlong).toBeCloseTo(TIP_TOP + DOME_MARGIN, 6);
  });

  it('never past APEX_MAX of the tip\'s relief and margin, however steep the vertex asks', () => {
    // near the far edge (wa 0.1), almost as proud as the tip: (0.09 + margin) / 0.1 = 1.4 asked
    const [x, y] = wPoint(0.1, 0.45, 0.45), { gd, after } = run([[x, y, 0.09]]);
    expect((0.09 + DOME_MARGIN) / 0.1).toBeGreaterThan(APEX_MAX * TIP_TOP + DOME_MARGIN);
    expect(gd.apexAlong).toBeCloseTo(APEX_MAX * TIP_TOP + DOME_MARGIN, 6);
    expect(heightOf(after, 0)).toBeCloseTo(APEX_MAX * TIP_TOP + DOME_MARGIN, 5);
  });

  it('a vertex under no triangle of the apex, or by its far edge (wa 0.05 or less), does not count', () => {
    for (const [x, y] of [[-0.2, -0.2], [0.3, -0.1], [R + 0.1, 0.05], wPoint(0.04, 0.48, 0.48)]) {
      expect(run([[x, y, 0.09]]).gd.apexAlong).toBeCloseTo(TIP_TOP + DOME_MARGIN, 6);
    }
  });

  it('domeOver(liftTo): a held particle at max(tip + DOME_MARGIN, liftTo); NaN, Infinity or lower leave it at the tip', () => {
    const { gd } = run([]), d = gd.posed.navel, tip = gd.tips[0], ca = tip.along + DOME_MARGIN;
    const held = (liftTo: number | undefined) => {
      const { positions, after } = particlesOver([nav(5, 0, 0.01)]);
      domeOver(d, positions, after, 1, tip, 1, 0, 0, [0], liftTo);
      return heightOf(after, 0);
    };
    expect(held(undefined)).toBeCloseTo(ca, 6);
    for (const liftTo of [NaN, Infinity, -Infinity, ca - 0.05, 0]) expect(held(liftTo)).toBeCloseTo(ca, 6);
    expect(held(ca + 0.2)).toBeCloseTo(ca + 0.2, 6);
    // and on a particle not held, liftTo is nothing
    const { positions, after } = particlesOver([nav(5, 0, 0.01)]);
    domeOver(d, positions, after, 1, tip, 1, 0, 0, [-1], ca + 0.2);
    expect(heightOf(after, 0)).toBeCloseTo(0, 9);
  });

  it('the nipples are unaffected: her navel\'s relief changes nothing over a nipple, and no apex is laid there', () => {
    const ps = [...[[1.0, 0], [-0.5, 0.6], [-0.5, -0.6]].map(([x, y]) => posedAt([TIP[0] + x, y, 0.05])), posedAt([TIP[0] + 0.2, 0.1, 0.3])];
    const plain = run([], ps, [0, 1, 2]), raised = run([[R / 2, 0, 0.08]], ps, [0, 1, 2]);
    expect(plain.gd.apex).toBe(-1);
    expect(raised.gd.apex).toBe(-1);
    expect(raised.gd.apexAlong).toBe(0);
    expect(Array.from(raised.after.point)).toEqual(Array.from(plain.after.point));
    // the nipple's corners still held at its tip and DOME_MARGIN
    for (let i = 0; i < 3; i++) expect(heightOf(raised.after, i)).toBeCloseTo(TIP[2] + DOME_MARGIN, 5);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GarmentCloth's ABSOLUTE refit (`tailoredShape`): the same tube rig, her shape again changed by the build's rest shift,
// and her tailored shape her body with no shift at all (GarmentCloth clears it while it measures). And a CONE -- wide at
// the top, narrow below, so its skin faces down -- for the hang.

describe('GarmentCloth.refit with tailoredShape: the cut a function of her shape now alone', () => {
  /** The tube on `body`, bound to the triangle nearest each particle, measured from her unshifted shape. */
  function absolute(body = cylinderBody(), made = tube()) {
    const { sewn, points } = made;
    const gc = new GarmentCloth({
      body, sewn, binding: nearestBinding(body, points), trunkOnly: new Uint8Array(sewn.count).fill(1), armBones: [],
      settings: { substeps: 2 }, standOff: 0.15, material: new THREE.MeshBasicMaterial(), unitsPerMetre: 100,
      tailoredShape: (measure) => measure(),
    });
    return { gc, sewn, body, n: sewn.count };
  }
  /** Her body changed as a rest shift: scaled `s` times about its origin, or (`girth`) only across, more higher up. */
  const shift = (body: THREE.SkinnedMesh, s: number, girth = false) => {
    const pos = body.geometry.getAttribute('position'), out = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const k = girth ? (s - 1) * (1 + pos.getY(v)) : s - 1;
      out[v * 3] = k * pos.getX(v); out[v * 3 + 1] = girth ? 0 : k * pos.getY(v); out[v * 3 + 2] = k * pos.getZ(v);
    }
    return out;
  };
  const fits = (gc: GarmentCloth) => gc['fit'] as Map<number, number>;
  const walk = (gc: GarmentCloth, body: THREE.SkinnedMesh, steps: number[], girth = false) => { for (const s of steps) { gc.setRestShift(shift(body, s, girth)); gc.refit(); } };

  it('ClothSkin.restShape: offsetShare 0 her bound skin points, 1 the default, and her unit normals under them', () => {
    const body = cylinderBody(), { points } = tube(), binding = nearestBinding(body, points), skin = new ClothSkin(body, binding), n = binding.count;
    const plain = skin.restShape(new Float32Array(n * 3)), one = skin.restShape(new Float32Array(n * 3), 1), N = new Float32Array(n * 3);
    const zero = skin.restShape(new Float32Array(n * 3), 0, N);
    expect(Array.from(one)).toEqual(Array.from(plain));
    const pos = body.geometry.getAttribute('position'), V = (v: number) => new THREE.Vector3().fromBufferAttribute(pos, v);
    for (let i = 0; i < n; i++) {
      // the barycentric place on the bound triangle, in the room's units (100 to the metre)
      const q = new THREE.Vector3();
      for (let c = 0; c < 3; c++) q.addScaledVector(V(binding.tri[i * 3 + c]), binding.bary[i * 3 + c]);
      q.multiplyScalar(100);
      for (let k = 0; k < 3; k++) expect(zero[i * 3 + k]).toBeCloseTo(q.getComponent(k), 3);
      const nrm = new THREE.Vector3(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      expect(nrm.length()).toBeCloseTo(1, 5);
      // out of the cylinder, and the offset is along it: plain = zero + offset x normal (room units)
      expect(nrm.x * q.x + nrm.z * q.z).toBeGreaterThan(0);
      for (let k = 0; k < 3; k++) expect(plain[i * 3 + k]).toBeCloseTo(zero[i * 3 + k] + nrm.getComponent(k) * binding.offset[i] * 100, 3);
    }
  });

  it('her shape unchanged: every cut 1', () => {
    const { gc, n } = absolute();
    expect(gc['tailoredBase']).toBeInstanceOf(Float32Array);
    gc.refit();
    const map = gc.fitMap();
    expect(map.length).toBe(n);
    for (const f of map) expect(f).toBeCloseTo(1, 6);
    for (const f of fits(gc).values()) expect(f).toBeCloseTo(1, 6);
  });

  it('is independent of the path: 1 -> 1.3 -> 0.8 -> 1.2 cuts it as 1 -> 1.2 does, uniform or not, and across a settle', () => {
    for (const girth of [false, true]) {
      const straight = absolute(), long = absolute();
      walk(straight.gc, straight.body, [1.2], girth);
      walk(long.gc, long.body, [1.3, 0.8, 1.2], girth);
      const a = straight.gc.fitMap(), b = long.gc.fitMap();
      for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 6);
      // a uniform 1.2 is 1.2 on every edge
      if (!girth) for (const f of fits(long.gc).values()) expect(f).toBeCloseTo(1.2, 4);
      // with a settle in the middle of the path (rebound where the cloth lies, her tailored shape read again through it)
      const settled = absolute();
      walk(settled.gc, settled.body, [1.3], girth);
      for (let f = 0; f < 5; f++) settled.gc.frame(1 / 60);
      settled.gc.settle();
      walk(settled.gc, settled.body, [0.8, 1.2], girth);
      const c = settled.gc.fitMap();
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(c[i] - a[i]));
      expect(worst).toBeLessThan(girth ? 0.02 : 1e-4);
    }
  });

  it('still clamps: ten times her size cuts at FIT_MAX, a tenth at FIT_MIN', () => {
    for (const [s, bound] of [[10, FIT_MAX], [0.1, FIT_MIN]] as const) {
      const { gc, body } = absolute();
      walk(gc, body, [s]);
      for (const f of fits(gc).values()) expect(f).toBeCloseTo(bound, 6);
    }
  });

  it('smoothing (FIT_SMOOTHING passes, Taubin) leaves a uniform scale\'s cut alone; with none it reads the same', () => {
    expect(FIT_SMOOTHING).toBe(60);
    for (const smoothing of [FIT_SMOOTHING, 0]) {
      const { gc, body } = absolute();
      // a probe sets it and settles, so her tailored shape is read again with it
      gc.fitSmoothing = smoothing;
      gc.settle();
      walk(gc, body, [1.2]);
      for (const f of fits(gc).values()) expect(f).toBeCloseTo(1.2, 4);
      walk(gc, body, [1]);
      for (const f of fits(gc).values()) expect(f).toBeCloseTo(1, 6);
    }
  });

  it('hang: where her skin faces down an edge grows across her but not down her; off ([0, 0]), every edge grows s', () => {
    expect([HANG_FROM, HANG_TO]).toEqual([0, -0.35]);
    // a cone 30 cm across at the top, 5 below, 40 cm tall: its skin faces about 32 degrees down; the tube 2 cm off it
    const g = new THREE.CylinderGeometry(0.3, 0.05, 0.4, 24, 8, true), pos = g.getAttribute('position'), nv = pos.count;
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    for (let v = 0; v < nv; v++) sw[v * 4] = 1;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const cone = (): THREE.SkinnedMesh => {
      const mesh = new THREE.SkinnedMesh(g.clone(), new THREE.MeshBasicMaterial()), root = new THREE.Group(), bone = new THREE.Bone();
      root.scale.setScalar(100); root.add(bone, mesh); root.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([bone]));
      return mesh;
    };
    const rows = [0.15, 0.1, 0.05, 0, -0.05, -0.1, -0.15], radius = (y: number) => 0.05 + 0.25 * (y + 0.2) / 0.4 + 0.02;
    /** The cone's tube cut for her 1.2 times, with `hang` (default when null) and `smoothing` (default when undefined). */
    const run = (hang: [number, number] | null, smoothing?: number) => {
      const r = absolute(cone(), tube(radius, rows));
      // her normals under the cloth face down: the hang has something to do
      const N = new Float32Array(r.n * 3);
      (r.gc['skin'] as ClothSkin).restShape(new Float32Array(r.n * 3), 0, N);
      for (let i = 0; i < r.n; i++) expect(N[i * 3 + 1]).toBeLessThan(-0.4);
      if (hang) r.gc.hang = hang;
      if (smoothing !== undefined) { r.gc.fitSmoothing = smoothing; r.gc.settle(); }
      walk(r.gc, r.body, [1.2]);
      const ring: number[] = [], down: number[] = [];
      for (const k of (r.gc['restLengths'] as Map<number, number>).keys()) {
        const p = Math.floor(k / r.n), q = k % r.n, f = fits(r.gc).get(k)!;
        if (Math.floor(p / AROUND) === Math.floor(q / AROUND)) ring.push(f); else if (p % AROUND === q % AROUND) down.push(f);
      }
      return { ring, down };
    };
    // off: every edge 1.2
    const off = run([0, 0]);
    for (const f of [...off.ring, ...off.down]) expect(f).toBeCloseTo(1.2, 4);
    // on, her shape unsmoothed: round the cone the full 1.2; down it -- an edge 85% vertical (0.05 down, 0.031 out),
    // wholly hung -- grows by only the 15% of it that runs across her: 1 + 0.2 (1 - 0.848)
    // (a ring edge's ends are bound at heights a hair apart on the facets, so it is all but level: 1.2 within 0.002)
    const plain = run(null, 0), share = 0.05 / Math.hypot(0.05, 0.25 * 0.05 / 0.4);
    for (const f of plain.ring) expect(Math.abs(f - 1.2)).toBeLessThan(0.002);
    for (const f of plain.down) expect(f).toBeCloseTo(1 + 0.2 * (1 - share), 2);
    // on, smoothed (the default): still round it 1.2 and down it far less; near the openings, where the smoothing bends
    // the tube's open ends, the edges read a little less vertical and grow a little more
    const smoothed = run(null);
    for (const f of smoothed.ring) expect(Math.abs(f - 1.2)).toBeLessThan(0.002);
    for (const f of smoothed.down) { expect(f).toBeGreaterThan(1); expect(f).toBeLessThan(1.12); }
  });

  it('strainMap: per particle the least and most strain of its edges and its sharpest fold, all finite', () => {
    const { gc, body, n } = absolute();
    walk(gc, body, [1.2]);
    for (let f = 0; f < 10; f++) gc.frame(1 / 60);
    const m = gc.strainMap();
    expect(m.length).toBe(n * 3);
    for (let i = 0; i < n; i++) {
      const lo = m[i * 3], hi = m[i * 3 + 1], fold = m[i * 3 + 2];
      for (const v of [lo, hi, fold]) expect(Number.isFinite(v)).toBe(true);
      expect(lo).toBeGreaterThan(0);
      expect(lo).toBeLessThanOrEqual(hi);
      expect(fold).toBeGreaterThanOrEqual(0);
      expect(fold).toBeLessThanOrEqual(180);
    }
  });
});
