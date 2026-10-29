/**
 * THE TEE'S PATTERN, DRAFTED FROM HER (Stage 2 of the procedural garment, Joshua 2026-10-26: "Start by testing a
 * raglan-style construction with an optional underarm gusset... If set-in sleeves produce cleaner geometry, better fit,
 * or more stable simulation, show me the comparison before committing").
 *
 * A pattern maker's draft, taken off her dress form (`measure.ts`, read through `form.ts`) instead of a tape:
 *
 * - FRONT and BACK, each cut on the fold. Below the underarm every height of the pattern is a height of her: the piece's
 *   half-width there is half her front (back) from side to side plus a quarter of the ease, so the side seam follows her
 *   shape exactly. The centre front is longer than the side wherever she is deeper than her sides -- over her bust and
 *   belly a tape laid down her front bridges further than the side drops -- so the centre front runs lower by the
 *   difference and the hem comes out level on her, as a maternity tee's longer front does. Above the underarm the
 *   piece rises along her surface to the neckline (a tape up her front at that width), so the neckline is not pulled
 *   down by the slope of her upper chest.
 * - RAGLAN: the sleeve runs up to the neckline; the bodice is cut on a slightly concave line from the underarm to a
 *   point on the neckline 70% of the way out. The sleeve's two raglan edges are drawn to exactly the bodice's lengths,
 *   which sets how tall the sleeve's crown is.
 * - SET-IN: a shoulder seam on her shoulder's slope from the neckline to her shoulder point, and an armhole from there
 *   to the underarm; the sleeve's cap is drawn to exactly the armhole's length (front and back separately).
 * - GUSSET: a diamond let into the underarm, where the side seam, the sleeve seam and the bodice meet. Its four edges
 *   are sewn to the last stretch of the side seam (front and back) and of the sleeve seam (front and back), so the
 *   four-way corner where a tee usually tears becomes four corners a gusset's width apart, with fabric between them.
 * - The SLEEVE is a tube from her arm's own girths plus ease, from the underarm to its hem; its length is measured, as
 *   a sleeve is, from her shoulder point.
 * - THE FULL EXTENT (Stage 3, `TeeParams.extend`): extension pieces sewn on under the plain tee -- FRONTEXT and BACKEXT
 *   from the drafted hem down to her knee (falling straight from where her hips are widest, as a skirt does),
 *   SLEEVEEXTP and SLEEVEEXTM from each cuff down to her wrist -- so the instant
 *   controls can CUT a longer tee instead of drafting one (`cuts.ts`). They come after every plain piece, which are
 *   drafted exactly as without them, so every plain particle keeps its number (`sew.ts` numbers them in piece order).
 *
 * Every edge is named, every seam pairs two edges (types.ts), and the whole pattern is mirror-symmetric: the front and
 * back are drafted for x >= 0 and mirrored, the sleeve and gusset of her -x side are the mirror images of her +x
 * side's. Edge names end in P (her +x side) or M (her -x side). Plain TypeScript, metres.
 *
 * Plane frames (each piece is seen from its outside, counter-clockwise):
 *   front   x = her x,  y = her height (more or less);
 *   back    x = -her x, y = her height;
 *   sleeve  P: x toward her back, y up the arm toward the neck; M: x toward her front;
 *   gusset  P: x toward her back, y up (into the sleeve); M: x toward her front.
 */
import { acrossBack, acrossFront, halves, midZ, profile, surfaceZ } from './form';
import { development, type Development } from './develop';
import { bezier, bowed, bowedToLength, densify, dist, line, mirrorReverse, polyLength, smooth } from './curves';
import type { BodyMeasure, DressForm, Pattern, PatternEdge, PatternPiece, Seam, Vec2 } from './types';

export type SleeveConstruction = 'raglan' | 'setIn';

export interface TeeParams {
  readonly construction: SleeveConstruction;
  /** 0 none, 1 the largest: the gusset's side is GUSSET_SIDE x this. */
  readonly gusset: number;
  /** Where the drafted hem is, metres above the floor; null: just under her hip. */
  readonly hemY: number | null;
  /** The sleeve's length from her shoulder point, along the top of her arm, metres. */
  readonly sleeveLength: number;
  /** The neckline's width at her shoulders, metres. */
  readonly neckWidth: number;
  /** How far under her front neck point the drafted (highest) front neckline sits, metres (negative: above). */
  readonly neckDrop: number;
  /** Total ease round her (garment girth minus hers), metres: at the bust, waist and hip, and round her upper arm. */
  readonly ease: { readonly bust: number; readonly waist: number; readonly hip: number; readonly sleeve: number };
  /** The underarm sits this far under her armpit, metres. */
  readonly armholeDrop: number;
  /**
   * How a set-in front takes her bust (raglan takes it in its raglan seams): 'none', the knit stretches over it; 'ease',
   * the front's side seam is cut longer than the back's and gathered onto it; 'dart', a dart from the side seam toward
   * her bust takes the extra length. Absent: 'none'.
   */
  readonly bustShaping?: 'none' | 'ease' | 'dart';
  /**
   * A set-in's body pieces within this far of their armholes (metres, flat) go with the sleeve: bound to her arm or her
   * trunk, whichever is nearer, as the seam itself is (`place.ts`). Absent: 0, none.
   */
  readonly armholeBand?: number;
  /**
   * The neckline's own edge rests at this share of its cut length: a neck band sewn on shorter than the opening, as a
   * tee's rib is, holds the neckline in when her arms pull at it (`garmentCloth.ts`). Absent: 1, no band.
   */
  readonly neckBand?: number;
  /**
   * THE FULL EXTENT (Stage 3): true drafts the tee as far as its instant controls can reach -- extra pieces sewn on under
   * the hem down to her knee and under each cuff down to her wrist -- with every piece of the plain tee exactly as it is
   * drafted without them. `cuts.ts` says which of it is worn (`settings.ts`). Absent or false: the plain tee.
   */
  readonly extend?: boolean;
  /**
   * The FRONT neckline's shape (Stage 3, NECK SHAPE): 0 the round neckline as drafted (U) to 1 a V, straight from its
   * side to the centre front, both ends where the U has them. Absent or 0: the U, exactly as before.
   */
  readonly neckCurve?: number;
}

export const TEE_DEFAULTS: TeeParams = Object.freeze({
  construction: 'raglan',
  gusset: 0.5,
  hemY: null,
  sleeveLength: 0.215,
  // R2, the raglan neckline Joshua approved as the default (2026-10-27): 18 cm across with a band at 90%. R0, the
  // Stage 2 neckline, is neckWidth 0.20 with neckBand 1
  neckWidth: 0.18,
  neckBand: 0.9,
  neckDrop: 0.04,
  // a set-in's armhole band (5 cm): measured on her, arms raised, its worst edge 6.7x -> 1.7x and nothing sunk into her
  armholeBand: 0.05,
  ease: Object.freeze({ bust: 0.0, waist: 0.04, hip: 0.04, sleeve: 0.07 }),
  armholeDrop: 0.02,
});

/** A set-in's own neckline defaults: Stage 2's, which was already the rounder and steadier of the two. */
export const SET_IN_NECK: Pick<TeeParams, 'neckWidth' | 'neckBand'> = Object.freeze({ neckWidth: 0.20, neckBand: 1 });

/** The whole parameter set for `params`: the defaults, a set-in's own neckline, then what `params` says. */
export function teeParams(params: Partial<TeeParams> = {}): TeeParams {
  const construction = params.construction ?? TEE_DEFAULTS.construction;
  return { ...TEE_DEFAULTS, ...(construction === 'setIn' ? SET_IN_NECK : {}), ...params };
}

/** The gusset's side at gusset = 1, metres (a diamond this wide on each side). */
export const GUSSET_SIDE = 0.12;
/** Particle spacing wanted, metres. */
export const SPACING = Object.freeze({ body: 0.012, sleeve: 0.011, gusset: 0.008, neck: 0.008, seam: 0.009, gus: 0.008, side: 0.012, hem: 0.010, under: 0.010 });
/** How far a raglan line bows in from the straight, metres. */
const RAGLAN_CURVE = 0.012;
/** The least a back neckline dips under the shoulder line at its side, metres. */
const BACK_NECK_DIP = 0.018;
/** The raglan meets the neckline this share of the way from the centre to the neckline's side. */
const RAGLAN_AT = 0.7;
/** A set-in front's bust shaping takes this share of the length her bust needs above what the plain front gives it. */
const BUST_LIFT_SHARE = 0.6;
/** ...at most this much, metres. */
const BUST_LIFT_MAX = 0.06;
/** A bust dart's mouth sits this far under the side seam's top, and stops this short of her bust's point, metres. */
const BUST_DART_BELOW = 0.05, BUST_DART_SHORT = 0.025;
/** The full extent's pieces stop at least this far past the drafted hem and cuff, metres (a hem drafted below her knee, a sleeve to her wrist). */
const EXTENT_MIN = 0.02;
/**
 * An extension's side seam (its sleeve's underarm seam) bends from the plain piece's direction at its corner into its own
 * course over between JOIN_MIN and JOIN_MAX of its length, searched every JOIN_STEP; where no even bend meets it there, it
 * turns over JOIN_SIDE (JOIN_SLEEVE) instead, metres (`joinAlong`).
 */
export const JOIN_MIN = 0.01, JOIN_MAX = 0.16, JOIN_STEP = 0.0025, JOIN_SIDE = 0.16, JOIN_SLEEVE = 0.05;
/**
 * The extension's side seams are smoothed this many passes over their centimetre samples (about 3 cm), where the plain
 * sides take 6: her dress form's outline kinks where her hips part into her thighs and again above her knees, and a
 * dress's side seam runs past both (at 6 passes each kink folded the sheet 8 to 10 degrees at a single particle).
 */
const EXT_SIDE_SMOOTH = 20;
/**
 * The level-hem rule's centre extra is tabled every this many metres of her height (`centreExtras`): her dress form is
 * only known every centimetre, and on Sarah a table every 2 mm and one every 1 cm agree to a hundredth of a millimetre.
 */
const EXTRA_STEP = 0.01;

/** The pieces the full extent adds (`TeeParams.extend`), each with the plain piece it is sewn on under and continues. */
export const EXTENSION_PARENT: ReadonlyMap<string, string> = new Map([['frontExt', 'front'], ['backExt', 'back'], ['sleeveExtP', 'sleeveP'], ['sleeveExtM', 'sleeveM']]);

/** The numbers the draft was made from and came out at, for the review sheet. */
export interface DraftNotes {
  readonly underarmY: number;
  readonly hemY: number;
  readonly widths: { readonly y: number; readonly front: number; readonly back: number }[];
  readonly centreFrontExtra: number;
  readonly centreBackExtra: number;
  readonly frontRaglanOrArmhole: number;
  readonly backRaglanOrArmhole: number;
  readonly sleeveTop: number;
  readonly sleeveCrown: number;
  readonly sleeveHemWidth: number;
  readonly gussetSide: number;
  readonly shoulderSeam: number;
  /** How much longer than her height her front (back) is developed from the underarm line to the neckline's side, metres. */
  readonly yokeLift: { readonly front: number; readonly back: number };
  /** How much a set-in front's bust shaping raised its upper front, metres (0 without shaping). */
  readonly bustLift: number;
}

/**
 * What the instant cuts (`cuts.ts`) read off the draft, so they cut by the draft's own rules instead of a copy of them.
 * Pattern-plane metres: a body piece's (x across, y her height at its side seam), a sleeve's (y up the arm, 0 at the
 * underarm corners).
 */
export interface DraftGuide {
  readonly construction: SleeveConstruction;
  /** The underarm line, and the side seam's top (where the gusset begins; the underarm line without one). */
  readonly underarmY: number;
  readonly sideTopY: number;
  /** The full extent's hem at the side seams: her knee (held EXTENT_MIN under the drafted hem), drafted or not. */
  readonly kneeY: number;
  /**
   * Each body piece's side seam, its +x half, by the side-seam rule (before a set-in's bust shaping splits or stretches
   * it): from the extension's hem (the drafted hem without `extend`) up to the side seam's top.
   */
  readonly side: { readonly front: readonly Vec2[]; readonly back: readonly Vec2[] };
  /**
   * The level hem's centre extra (`hemOf`) for a hem standing at side height `y`, front or back, metres: exactly the
   * draft's at the drafted hem and at the extension's hem, the same rule between (`centreExtras`). Tabled on first use.
   */
  extra(side: 'front' | 'back', y: number): number;
  /** The front neckline as drafted (NECK SHAPE included), its +x half: from its side end (u > 0) in to the centre front (u = 0). */
  readonly frontNeck: readonly Vec2[];
  /** The sleeve's frame (both sleeves'): her shoulder point's level, the drafted cuff, her wrist (the extension's cuff, drafted or not), its top edge's front and back ends (a set-in's crown, both). */
  readonly sleeve: { readonly shoulderV: number; readonly cuffV: number; readonly wristV: number; readonly topFront: number; readonly topBack: number };
}

export interface Draft {
  readonly pattern: Pattern;
  readonly notes: DraftNotes;
  /** Her upper front and back developed flat (`develop.ts`): the bodices above the underarm are in these pattern heights. */
  readonly develop: { readonly front: Development; readonly back: Development; /** The pattern's across-arc -> her lateral |x|. */ readonly xOfU: (u: number) => number };
  /** What the cuts read (Stage 3). */
  readonly guide: DraftGuide;
}

/**
 * The level-hem rule's centre extra (`hemOf`: how much further a tape down her centre front (back) from the underarm line
 * `yU` bridges than her side drops) for every hem height from `y0` up to `yU`, in one walk up her centre: the tape to a
 * hem at y is the upper convex envelope of her centre from y up (`profile`), and that of every such stretch comes out of
 * one pass of Andrew's monotone chain run DOWN her (after the point at y is added, the stack is the envelope from y up),
 * every EXTRA_STEP. Linear between samples, held at the ends.
 */
function centreExtras(form: DressForm, side: 'front' | 'back', y0: number, yU: number): (y: number) => number {
  const n = Math.max(1, Math.ceil((yU - y0) / EXTRA_STEP)), out = side === 'front' ? 1 : -1;
  const ys = new Float64Array(n + 1), zs = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { ys[i] = i === n ? yU : y0 + (yU - y0) * (i / n); zs[i] = out * surfaceZ(form, side, ys[i], 0); }
  // where her outline misses her midline (it never should), the nearest height that does not
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k <= n; k++) {
    const i = pass === 0 ? k : n - k, j = pass === 0 ? i - 1 : i + 1;
    if (Number.isNaN(zs[i]) && j >= 0 && j <= n && !Number.isNaN(zs[j])) zs[i] = zs[j];
  }
  const extra = new Float64Array(n + 1), hull: number[] = [];
  const seg = (a: number, b: number) => Math.hypot(ys[b] - ys[a], zs[b] - zs[a]);
  let total = 0;
  for (let i = n; i >= 0; i--) {
    // `profile`'s rule in (-y, z), where this walk runs upward: drop the last point while the turn is not clockwise
    while (hull.length >= 2) {
      const a = hull[hull.length - 2], b = hull[hull.length - 1];
      if ((ys[a] - ys[b]) * (zs[i] - zs[a]) - (zs[b] - zs[a]) * (ys[a] - ys[i]) >= 0) { total -= seg(a, b); hull.pop(); } else break;
    }
    if (hull.length) total += seg(hull[hull.length - 1], i);
    hull.push(i);
    extra[i] = total - (yU - ys[i]);
  }
  return (y: number): number => {
    const f = Math.min(n, Math.max(0, (y - y0) / (yU - y0) * n)), i = Math.min(n - 1, Math.floor(f));
    return extra[i] + (extra[i + 1] - extra[i]) * (f - i);
  };
}

const edge = (name: string, points: readonly Vec2[], spacing: number): PatternEdge => ({ name, points, spacing });

/** Mirror a right-half edge list into a symmetric piece's whole outline (see `draftTee`). */
function mirrored(id: string, role: PatternPiece['role'], right: { hem: PatternEdge; sides: PatternEdge[]; top: PatternEdge }, swap: (n: string) => string): PatternPiece {
  // right.hem runs from the centre out to the side; right.sides go up the right; right.top runs from the side's top in
  // to the centre. Whole outline, counter-clockwise: hem (left to right), right sides up, top (right to left), left
  // sides down.
  const hem = edge(right.hem.name, [...mirrorReverse(right.hem.points), ...right.hem.points.slice(1)], right.hem.spacing);
  const top = edge(right.top.name, [...right.top.points, ...mirrorReverse(right.top.points).slice(1)], right.top.spacing);
  const left = [...right.sides].reverse().map((e) => edge(swap(e.name), mirrorReverse(e.points), e.spacing));
  return { id, role, side: 0, symmetric: true, spacing: SPACING.body, edges: [hem, ...right.sides, top, ...left] };
}

/**
 * An extension's edge brought into the plain piece's corner along the plain edge's own direction: `pts` the extension's
 * edge as smoothed (rising, ending under the corner), `corner` the plain edge's end and `next` the plain edge's next
 * point (its direction leaving the corner). From the corner down, the edge bends at one even rate from that direction
 * until it runs along the smoothed edge (a parabola, tangent to both: the least turning there can be, spread evenly);
 * below, as smoothed. Where no such bend meets the smoothed edge within JOIN_MAX, a curve with no bend at either end
 * runs from the smoothed edge `blend` down to the corner instead.
 *
 * Sewn, the four pieces at a hem's side corner (two at a cuff's) then lie flat round it. Smoothed on its own, each edge
 * ran into the corner at its own slope -- her dress form narrowing under her hip, the plain side as its own smoothing
 * left it -- and the corner closed 15 degrees short of flat: the cloth stood out from her hips in a cone at the drafted
 * hem's side corners, whatever the length (Stage 3). What turning her hip asks for is now spread down the extension.
 */
export function joinAlong(pts: readonly Vec2[], corner: Vec2, next: Vec2, blend: number): Vec2[] {
  const [xc, yc] = corner, dy = next[1] - yc, m1 = Math.abs(dy) > 1e-9 ? (next[0] - xc) / dy : 0;
  // the smoothed edge at height y: its place and its slope there (the segment under y)
  const at = (y: number): { x: number; m: number; i: number } => {
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1][1] <= y) i++;
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], span = b[1] - a[1];
    const t = span > 1e-12 ? Math.max(0, Math.min(1, (y - a[1]) / span)) : 0;
    return { x: a[0] + (b[0] - a[0]) * t, m: span > 1e-12 ? (b[0] - a[0]) / span : 0, i };
  };
  // the bend: from the corner along m1, x = xc + m1 d + c d^2 (d = y - yc), meeting the edge B down with the edge's own
  // slope when the edge there stands where the bend arrives, xc - B (m1 + m) / 2
  const miss = (B: number) => { const e = at(yc - B); return e.x - (xc - (B * (m1 + e.m)) / 2); };
  const top = yc - pts[0][1];
  let B = -1;
  for (let b = JOIN_MIN, was = miss(Math.min(JOIN_MIN, top)); b + JOIN_STEP <= Math.min(JOIN_MAX, top) + 1e-12; b += JOIN_STEP) {
    const now = miss(b + JOIN_STEP);
    if (Math.sign(now) !== Math.sign(was)) {
      let lo = b, hi = b + JOIN_STEP;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (Math.sign(miss(mid)) === Math.sign(was)) lo = mid; else hi = mid; }
      B = (lo + hi) / 2;
      break;
    }
    was = now;
  }
  const bent = B > 0;
  if (!bent) B = Math.min(blend, top);
  const y0 = yc - B, e = at(y0), x0 = e.x, m0 = e.m;
  const out: Vec2[] = pts.slice(0, e.i + 1).map((q) => [q[0], q[1]] as Vec2);
  if (y0 - pts[e.i][1] > 1e-9) out.push([x0, y0]);
  // drawn every millimetre: its last stretch leaves the corner along the plain edge to within a fraction of a degree
  const k = Math.max(2, Math.ceil(B / 0.001));
  for (let j = 1; j <= k; j++) {
    const t = j / k, d = B * (t - 1);
    let x: number;
    if (bent) x = xc + m1 * d + ((m1 - m0) / (2 * B)) * d * d;
    else {
      // the quintic with no bend at either end: its turning in its middle, none gathered at either end
      const t3 = t * t * t, t4 = t3 * t, t5 = t4 * t;
      x = (1 - 10 * t3 + 15 * t4 - 6 * t5) * x0 + (t - 6 * t3 + 8 * t4 - 3 * t5) * B * m0 + (10 * t3 - 15 * t4 + 6 * t5) * xc + (-4 * t3 + 7 * t4 - 3 * t5) * B * m1;
    }
    out.push(j === k ? [xc, yc] : [x, y0 + B * t]);
  }
  return out;
}

/** The mirror image of a piece about x = 0 (its edges reflected, the outline kept counter-clockwise), renamed. */
function mirrorPiece(p: PatternPiece, id: string, swap: (n: string) => string): PatternPiece {
  const edges = [...p.edges].reverse().map((e) => edge(swap(e.name), mirrorReverse(e.points), e.spacing));
  return { ...p, id, side: (-p.side) as -1 | 0 | 1, edges };
}

/**
 * Draft the tee for her. `measure` is her body as designed at 0% belly; `frontForm`, when given, is the dress form the
 * FRONT is cut over (her body at the belly the garment is made to fit, BELLY ROOM); otherwise her own.
 */
export function draftTee(measure: BodyMeasure, params: TeeParams = TEE_DEFAULTS, frontForm: DressForm = measure.form): Draft {
  const form = measure.form;
  const p = params;
  const yU = (measure.armpit[0][1] + measure.armpit[1][1]) / 2 - p.armholeDrop;
  const yHem = p.hemY ?? measure.hip.y - 0.01;
  const sG = Math.max(0, Math.min(1, p.gusset)) * GUSSET_SIDE;
  const yS = yU - sG; // where the side seam stops and the gusset begins

  // ease round her at a height: the bust's above the underbust, the waist's at the waist, the hip's at the hip and below
  const ease = (y: number): number => {
    const { bust, underbust, waist, hip } = measure;
    if (y >= underbust.y) return p.ease.bust;
    if (y >= waist.y) return p.ease.waist + (p.ease.bust - p.ease.waist) * (y - waist.y) / (underbust.y - waist.y);
    if (y >= hip.y) return p.ease.hip + (p.ease.waist - p.ease.hip) * (y - hip.y) / (waist.y - hip.y);
    void bust; return p.ease.hip;
  };
  // her side seams hang in the plane halfway between her front and back (at 0% belly, smoothed over 10 cm of height), so
  // a fuller bust or belly widens the front and never moves the seam
  const zSide = (y: number): number => { let s = 0, k = 0; for (let d = -0.05; d <= 0.05 + 1e-9; d += 0.01) { s += midZ(form, y + d); k++; } return s / k; };
  const halfFront = (y: number) => halves(frontForm, y, zSide(y)).front / 2 + ease(y) / 4;
  const halfBack = (y: number) => halves(form, y, zSide(y)).back / 2 + ease(y) / 4;

  // --- the bodies below the underarm: side seams and hems ------------------------------------------------------------
  const sideOf = (half: (y: number) => number): Vec2[] => {
    const pts: Vec2[] = [];
    const n = Math.max(2, Math.ceil((yS - yHem) / 0.01));
    for (let i = 0; i <= n; i++) { const y = yHem + (yS - yHem) * (i / n); pts.push([half(y), y]); }
    return densify(smooth(pts, 6));
  };
  const frontSide = sideOf(halfFront), backSide = sideOf(halfBack);
  // the centre is longer than the side by how much further a tape down her centre bridges than the side drops
  const extraF = profile(frontForm, 'front', 0, yHem, yU).length - (yU - yHem);
  const extraB = profile(form, 'back', 0, yHem, yU).length - (yU - yHem);
  const hemOf = (side: Vec2[], extra: number, y = yHem): Vec2[] => {
    const w = side[0][0], pts: Vec2[] = [];
    for (let i = 0; i <= 24; i++) { const f = i / 24; pts.push([f * w, y - Math.max(0, extra) * (1 - f * f)]); }
    return densify(pts);
  };
  const frontHem = hemOf(frontSide, extraF), backHem = hemOf(backSide, extraB);
  const gusEdge = (side: Vec2[]): Vec2[] => line(side[side.length - 1], [side[side.length - 1][0], yU]);
  const frontUnder: Vec2 = [frontSide[frontSide.length - 1][0], yU], backUnder: Vec2 = [backSide[backSide.length - 1][0], yU];

  // --- above the underarm: the neckline and the shoulder line ------------------------------------------------------
  // Her shoulder line (the side neck point down to her shoulder point) is drafted at her own heights, front and back
  // alike, so the armholes are as deep as she is from shoulder to underarm. Her centre front and back are deeper than
  // her sides -- a tape up her centre front bridges her bust and climbs her upper chest's slope -- and half of that extra
  // length is cut into the centre (the rest the knit's stretch takes, as a dartless knit block does), so the neckline
  // is not dragged down at the front.
  const neckHalf = p.neckWidth / 2;
  const sp = measure.shoulderPoint, ns = measure.neck.side;
  const spX = (Math.abs(sp[0][0]) + Math.abs(sp[1][0])) / 2, spY = (sp[0][1] + sp[1][1]) / 2;
  const nsX = (Math.abs(ns[0][0]) + Math.abs(ns[1][0])) / 2, nsY = (ns[0][1] + ns[1][1]) / 2;
  // across her upper chest just under her shoulders, where it is flat (the shoulders' and neckline's widths); the
  // armhole's across-front is taken lower, through the crease between chest and arm
  const yAcross = spY - 0.04, yCrease = yU + 0.06;
  const slopeY = (x: number) => nsY + (spY - nsY) * (x - nsX) / (spX - nsX);
  const frontNeckY = measure.neck.front[1] - p.neckDrop, backNeckY = measure.neck.back[1] - Math.max(0, p.neckDrop) * 0.3;
  // the neckline and the shoulder line are placed in HER heights; `devF` / `devB` carry them to the pattern's (develop.ts)
  const vFrontCentre = frontNeckY;
  // a back neckline dips at least BACK_NECK_DIP under the shoulder line at its side (her back neck point sits higher than
  // the shoulder line once the neckline is wider than her neck)
  const vBackCentre = Math.min(backNeckY, slopeY(neckHalf) - BACK_NECK_DIP);
  // across her upper chest and back, front and back averaged so the shoulder seams match
  const acrossAt = (x: number) => (acrossFront(frontForm, yAcross, x) + acrossBack(form, yAcross, x)) / 2;
  // its inverse, tabled (the development asks it for every point it carries)
  const acrossTable = Array.from({ length: 121 }, (_, i) => acrossAt(i * 0.0025));
  const xOfU = (u: number): number => {
    if (u <= acrossTable[0]) return 0;
    for (let i = 1; i < acrossTable.length; i++) if (acrossTable[i] >= u) { const a = acrossTable[i - 1], b = acrossTable[i]; return (i - 1 + (u - a) / Math.max(1e-12, b - a)) * 0.0025; }
    return 0.3;
  };
  const yTop = Math.max(measure.neck.back[1], nsY) + 0.06;
  const devF = development(frontForm, 'front', yU, yTop, xOfU), devB = development(form, 'back', yU, yTop, xOfU);
  const developed = (pts: readonly Vec2[], d: Development): Vec2[] => densify(pts.map(([u, y]) => [u, d.v(u, y)] as Vec2));
  // how long a curve drawn in her heights (u across, y her height) is laid on her front (back) surface
  const onHer = (pts: readonly Vec2[], f: DressForm, side: 'front' | 'back'): number => {
    const xs = pts.map(([u]) => xOfU(Math.abs(u))), zs = pts.map(([, y], i) => surfaceZ(f, side, y, xs[i]));
    // where her outline does not reach (past the side of her neck), the nearest z that does
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < zs.length; k++) {
      const i = pass === 0 ? k : zs.length - 1 - k, j = pass === 0 ? i - 1 : i + 1;
      if (Number.isNaN(zs[i]) && j >= 0 && j < zs.length && !Number.isNaN(zs[j])) zs[i] = zs[j];
    }
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(xs[i] - xs[i - 1], pts[i][1] - pts[i - 1][1], (zs[i] || 0) - (zs[i - 1] || 0));
    return L;
  };
  const uNeckF = acrossAt(neckHalf), uNeckB = uNeckF;
  const vNeckSideF = slopeY(neckHalf), vNeckSideB = vNeckSideF;
  const necklineOf = (uSide: number, vSide: number, vCentre: number, to: number): Vec2[] => {
    // a quarter ellipse from the shoulder line (uSide, vSide), level-tangent at the centre (0, vCentre), cut at u = to
    const pts: Vec2[] = [];
    const depth = Math.max(0.01, vSide - vCentre);
    for (let i = 0; i <= 64; i++) {
      const th = (Math.PI / 2) * (1 - i / 64), u = uSide * Math.sin(th);
      if (u > to + 1e-12) continue;
      pts.push([u, vCentre + depth * (1 - Math.cos(th))]);
    }
    if (pts.length === 0 || pts[0][0] < to - 1e-9) {
      const th = Math.asin(Math.min(1, to / uSide));
      pts.unshift([to, vCentre + depth * (1 - Math.cos(th))]);
    }
    return densify(pts);
  };
  // NECK SHAPE (the front's only): each point of the drafted neckline moved `neckCurve` of the way to the straight line
  // from its side end to its centre, at the same across; both ends kept, so no seam that meets them moves
  const neckCurve = Math.max(0, Math.min(1, p.neckCurve ?? 0));
  const shaped = (pts: Vec2[]): Vec2[] => {
    if (!(neckCurve > 0)) return pts;
    const a = pts[0], b = pts[pts.length - 1], last = pts.length - 1;
    const straight = (u: number) => b[1] + (a[1] - b[1]) * (u - b[0]) / (a[0] - b[0]);
    return densify(pts.map((q, i): Vec2 => (i === 0 || i === last ? q : [q[0], q[1] + neckCurve * (straight(q[0]) - q[1])])));
  };
  // the sleeve's frame as drafted (her shoulder point's level, the cuff, the top edge's two ends), its tube's under edge
  // and the front neckline, for the full extent and the cuts
  let shoulderV = 0, cuffV = 0, topFrontV = 0, topBackV = 0;
  let under: Vec2[] = [], frontNeck: Vec2[] = [];

  const pieces: PatternPiece[] = [];
  const seams: Seam[] = [];
  const swapPM = (n: string) => n.endsWith('P') ? n.slice(0, -1) + 'M' : n.endsWith('M') ? n.slice(0, -1) + 'P' : n;
  const notesW: { y: number; front: number; back: number }[] = [];
  for (const y of [measure.bust.y, measure.waist.y, measure.hip.y, yHem]) notesW.push({ y, front: 2 * halfFront(y), back: 2 * halfBack(y) });
  let frontLen = 0, backLen = 0, sleeveTop = 0, crown = 0, hemWidth = 0, shoulderSeam = 0, bustLift = 0, sideEase = 0;
  let sideSeams: string[] = ['side'];

  // the sleeve tube: half-width at a distance below the underarm, from her arm's girths plus ease
  const arm = measure.arms[0], arm2 = measure.arms[1];
  const girthAt = (t: number) => {
    const g = (a: typeof arm) => { const k = Math.max(0, Math.min(1, t)) * (a.girths.length - 1), i = Math.min(a.girths.length - 2, Math.floor(k)); return a.girths[i] + (a.girths[i + 1] - a.girths[i]) * (k - i); };
    return (g(arm) + g(arm2)) / 2;
  };
  const inside = (arm.insideLength + arm2.insideLength) / 2;
  const upperArm = Math.max(...arm.girths.slice(0, 4), ...arm2.girths.slice(0, 4));
  const W = upperArm + p.ease.sleeve;
  const tubeHalf = (v: number) => (Math.max(girthAt(-v / inside), 0) + p.ease.sleeve) / 2;

  // the slope of her shoulder from the neckline to her shoulder point (set-in's seam, and where a sleeve's length starts)
  const shoulderLen = Math.hypot(spX - neckHalf, spY - slopeY(neckHalf)) * 1.05; // over the curve of her shoulder

  if (p.construction === 'raglan') {
    // bodice: neckline from the centre out to the raglan point, then the raglan down to the underarm
    const rF = RAGLAN_AT * uNeckF, rB = RAGLAN_AT * uNeckB;
    // the neckline is placed on her (in her heights) and its two ends -- centre and raglan point -- developed onto the
    // pattern; the curve between them, and the raglan line from the underarm, are drawn on the pattern. (Developing
    // every point of a curve that crosses her columns would stretch it: her front's development shears hard between
    // her bust's columns and her neck's, and a neckline developed point by point came out 4 cm longer than on her.)
    const neckFh = necklineOf(uNeckF, vNeckSideF, vFrontCentre, rF), neckBh = necklineOf(uNeckB, vNeckSideB, vBackCentre, rB);
    const throughRaglan = (h: readonly Vec2[], d: Development, uSide: number, to: number): Vec2[] => {
      const r: Vec2 = [h[0][0], d.v(h[0][0], h[0][1])], vC = d.v(0, h[h.length - 1][1]);
      const s = Math.min(0.999, r[0] / uSide), depth = Math.max(0.005, (r[1] - vC) / (1 - Math.sqrt(1 - s * s)));
      return necklineOf(uSide, vC + depth, vC, to);
    };
    const neckF = shaped(throughRaglan(neckFh, devF, uNeckF, rF)), neckB = throughRaglan(neckBh, devB, uNeckB, rB);
    const ragF = bowed(frontUnder, neckF[0], RAGLAN_CURVE), ragB = bowed(backUnder, neckB[0], RAGLAN_CURVE);
    frontLen = polyLength(ragF); backLen = polyLength(ragB);
    const sidesF = [edge('sideP', frontSide, SPACING.side), ...(sG > 0 ? [edge('gusP', gusEdge(frontSide), SPACING.gus)] : []), edge('raglanP', ragF, SPACING.seam)];
    const sidesB = [edge('sideM', backSide, SPACING.side), ...(sG > 0 ? [edge('gusM', gusEdge(backSide), SPACING.gus)] : []), edge('raglanM', ragB, SPACING.seam)];
    pieces.push(mirrored('front', 'torso', { hem: edge('hem', frontHem, SPACING.hem), sides: sidesF, top: edge('neck', neckF, SPACING.neck) }, swapPM));
    pieces.push(mirrored('back', 'torso', { hem: edge('hem', backHem, SPACING.hem), sides: sidesB, top: edge('neck', neckB, SPACING.neck) }, swapPM));
    // sleeve (her +x side; x toward her back): top edge = the neckline between the two raglan points, over her shoulder
    // ...as long as the neckline runs on her from each raglan point to the side of her neck
    const nf = onHer(necklineOf(uNeckF, vNeckSideF, vFrontCentre, uNeckF), frontForm, 'front') - onHer(neckFh, frontForm, 'front');
    const nb = onHer(necklineOf(uNeckB, vNeckSideB, vBackCentre, uNeckB), form, 'back') - onHer(neckBh, form, 'back');
    sleeveTop = nf + nb;
    // the crown's height, front and back each: a little under what its raglan reaches straight, so the edge bows out
    // to its length (her front is longer developed than her back, so the sleeve's top runs higher at the front)
    const HF = 0.97 * Math.sqrt(Math.max(1e-4, frontLen ** 2 - (W / 2 - nf) ** 2)), HB = 0.97 * Math.sqrt(Math.max(1e-4, backLen ** 2 - (W / 2 - nb) ** 2));
    const cornerF: Vec2 = [-W / 2, 0], cornerB: Vec2 = [W / 2, 0];
    const sRagB = bowedToLength(cornerB, [nb, HB], backLen, -1), sRagF = bowedToLength([-nf, HF], cornerF, frontLen, -1);
    const H = (HF + HB) / 2;
    crown = H;
    const topF: Vec2 = sRagF[0], topB: Vec2 = sRagB[sRagB.length - 1];
    // the hem: her shoulder point is on the sleeve's centre line, shoulderLen down from the top edge
    let vHem = H - shoulderLen - p.sleeveLength;
    vHem = Math.min(vHem, -sG - 0.03);
    const underB: Vec2[] = [], underF: Vec2[] = [];
    const n = Math.max(2, Math.ceil((-sG - vHem) / 0.01));
    for (let i = 0; i <= n; i++) { const v = vHem + (-sG - vHem) * (i / n); underB.push([Math.max(tubeHalf(v), 0), v]); }
    // the tube meets the crown's corners at W/2: blend the girth-driven half-width into it over the top 4 cm
    for (let i = 0; i < underB.length; i++) { const v = underB[i][1], k = Math.max(0, Math.min(1, (v + sG + 0.04) / 0.04)); underB[i] = [underB[i][0] + (W / 2 - underB[i][0]) * k, v]; }
    const ub = densify(smooth(underB, 4));
    for (const q of [...ub].reverse()) underF.push([-q[0], q[1]]);
    hemWidth = 2 * ub[0][0];
    shoulderV = H - shoulderLen; cuffV = vHem; topFrontV = topF[1]; topBackV = topB[1]; under = ub; frontNeck = neckF;
    const gusB = sG > 0 ? line([W / 2, -sG], cornerB) : null, gusF = sG > 0 ? line(cornerF, [-W / 2, -sG]) : null;
    const sleeve: PatternPiece = {
      id: 'sleeveP', role: 'sleeve', side: 1, symmetric: false, spacing: SPACING.sleeve,
      edges: [
        edge('cuff', line([-ub[0][0], vHem], [ub[0][0], vHem]), SPACING.hem),
        edge('underBack', ub, SPACING.under),
        ...(gusB ? [edge('gusBack', gusB, SPACING.gus)] : []),
        edge('raglanBack', sRagB, SPACING.seam),
        edge('neck', line(topB, topF), SPACING.neck),
        edge('raglanFront', sRagF, SPACING.seam),
        ...(gusF ? [edge('gusFront', gusF, SPACING.gus)] : []),
        edge('underFront', densify(underF), SPACING.under),
      ],
    };
    pieces.push(sleeve, mirrorPiece(sleeve, 'sleeveM', (x) => x));
    for (const s of ['P', 'M'] as const) {
      seams.push({ name: `raglanFront${s}`, a: { piece: 'front', edge: `raglan${s}` }, b: { piece: `sleeve${s}`, edge: 'raglanFront' } });
      seams.push({ name: `raglanBack${s}`, a: { piece: 'back', edge: `raglan${s}` }, b: { piece: `sleeve${s}`, edge: 'raglanBack' } });
    }
  } else {
    // set-in: neckline to the shoulder line, a shoulder seam down her shoulder's slope, an armhole to the underarm
    // The back is developed whole: its neckline, its shoulder point, its armhole. The front cannot be: developed, her front
    // is 11 cm longer than her back at the neckline's side (her bust), and a set-in front has nowhere dartless to put
    // that -- its shoulder seam must match the back's and its armhole the sleeve's cap. So the front's armhole is drawn
    // as much longer than the back's as her own front armhole is than her back one (measure.ts armhole), its shoulder
    // seam as long as the back's, and only its centre front neck is developed; the rest is the knit's stretch over her
    // bust, as on a dartless set-in tee.
    const armholeOf = (spt: Vec2, under: Vec2, acrossU: number): Vec2[] => {
      const depth = spt[1] - under[1];
      return bezier(under, [acrossU + 0.35 * (under[0] - acrossU), under[1]], [acrossU, under[1] + 0.45 * depth], spt);
    };
    const xCrease = 0.125, creaseF = acrossFront(frontForm, yCrease, xCrease), creaseB = acrossBack(form, yCrease, xCrease) + 0.01;
    const neckB = developed(necklineOf(uNeckB, vNeckSideB, vBackCentre, uNeckB), devB);
    const uSp = acrossAt(spX), spB: Vec2 = [uSp, devB.v(uSp, spY)];
    const ahB = armholeOf(spB, backUnder, creaseB);
    const hole = measure.armhole, frontOver = ((hole[0].front - hole[0].back) + (hole[1].front - hole[1].back)) / 2;
    const targetF = polyLength(ahB) + Math.max(0, frontOver);
    let vlo = spY - 0.05, vhi = spY + 0.25;
    for (let i = 0; i < 50; i++) { const m = (vlo + vhi) / 2; if (polyLength(armholeOf([uSp, m], frontUnder, creaseF)) < targetF) vlo = m; else vhi = m; }
    const spF: Vec2 = [uSp, (vlo + vhi) / 2];
    const seamLen = dist(neckB[0], spB);
    const vNeckSidePlain = spF[1] + Math.sqrt(Math.max(0, seamLen ** 2 - (uSp - uNeckF) ** 2));
    // BUST SHAPING: the front above the side seam is raised by `lift` -- armhole, shoulder seam and neckline's side as
    // they are, only higher -- so her front is that much longer over her bust, and the side seam takes the difference:
    // gathered onto the back's ('ease') or folded into a dart toward her bust ('dart')
    const shaping = p.bustShaping ?? 'none';
    const lift = shaping === 'none' ? 0 : Math.max(0, Math.min(BUST_LIFT_MAX, BUST_LIFT_SHARE * (devF.v(uNeckF, vNeckSideF) - vNeckSidePlain)));
    bustLift = lift;
    const up = (q: Vec2): Vec2 => [q[0], q[1] + lift];
    const spFl = up(spF), underFl = up(frontUnder);
    const neckF = shaped(necklineOf(uNeckF, vNeckSidePlain + lift, devF.v(0, vFrontCentre) + lift, uNeckF));
    shoulderSeam = dist(neckF[0], spFl);
    const ahF = armholeOf(spFl, underFl, creaseF);
    frontLen = polyLength(ahF); backLen = polyLength(ahB);
    let frontSides: PatternEdge[], backSides: PatternEdge[];
    if (shaping === 'dart' && lift > 0) {
      // the dart's mouth on the side seam BUST_DART_BELOW under its top; its point BUST_DART_SHORT short of her bust's
      const yB = yS - BUST_DART_BELOW;
      const split = (side: Vec2[], at: number): [Vec2[], Vec2[]] => {
        const lo = side.filter((q) => q[1] < at), hi = side.filter((q) => q[1] > at);
        const k = side.findIndex((q) => q[1] >= at), a = side[Math.max(0, k - 1)], b = side[Math.max(0, k)];
        const t = b[1] === a[1] ? 0 : (at - a[1]) / (b[1] - a[1]), m: Vec2 = [a[0] + (b[0] - a[0]) * t, at];
        return [densify([...lo, m]), densify([m, ...hi])];
      };
      const [fLo, fHiRaw] = split(frontSide, yB);
      // the back's side split where its top part is as long as the front's (their sides slant differently, and the
      // short top seam would carry all of that difference): the whole side's few millimetres go to the long lower seam
      let lo = backSide[0][1], hi = yS - 1e-4;
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (polyLength(split(backSide, mid)[1]) > polyLength(fHiRaw)) lo = mid; else hi = mid; }
      const [bLo, bHi] = split(backSide, (lo + hi) / 2);
      const fHi = fHiRaw.map(up);
      const mouthLo = fLo[fLo.length - 1], mouthHi = fHi[0];
      // her bust's point: the lateral place her front stands furthest forward at her bust's height
      let apexX = 0, best = -Infinity;
      for (let x = 0.03; x <= 0.15; x += 0.0025) { const z = surfaceZ(frontForm, 'front', measure.bust.y, x); if (z > best) { best = z; apexX = x; } }
      const apex: Vec2 = [acrossFront(frontForm, measure.bust.y, apexX), measure.bust.y];
      // the point on the mouth's perpendicular through its middle, so the two legs are cut the same length and sew
      // together; it runs in toward her bust's point and stops BUST_DART_SHORT short of it
      const mid: Vec2 = [(mouthLo[0] + mouthHi[0]) / 2, (mouthLo[1] + mouthHi[1]) / 2];
      const ax = mouthHi[0] - mouthLo[0], ay = mouthHi[1] - mouthLo[1], al = Math.hypot(ax, ay) || 1;
      let nx = ay / al, ny = -ax / al;
      if (nx * (apex[0] - mid[0]) + ny * (apex[1] - mid[1]) < 0) { nx = -nx; ny = -ny; }
      const reach = Math.max(0.02, Math.abs(nx * (apex[0] - mid[0]) + ny * (apex[1] - mid[1])) - BUST_DART_SHORT);
      const point: Vec2 = [mid[0] + nx * reach, mid[1] + ny * reach];
      frontSides = [edge('sideLowP', fLo, SPACING.side), edge('dartLowP', line(mouthLo, point), SPACING.gus), edge('dartHighP', line(point, mouthHi), SPACING.gus), edge('sideHighP', fHi, SPACING.side)];
      backSides = [edge('sideLowM', bLo, SPACING.side), edge('sideHighM', bHi, SPACING.side)];
    } else if (shaping === 'ease' && lift > 0) {
      // the whole front side stretched over its length to rise by `lift`: gathered onto the back's side seam
      const span = frontSide[frontSide.length - 1][1] - yHem;
      frontSides = [edge('sideP', frontSide.map(([u, v]) => [u, v + lift * (v - yHem) / Math.max(1e-6, span)] as Vec2), SPACING.side)];
      backSides = [edge('sideM', backSide, SPACING.side)];
    } else {
      frontSides = [edge('sideP', frontSide, SPACING.side)];
      backSides = [edge('sideM', backSide, SPACING.side)];
    }
    const sidesF = [...frontSides, ...(sG > 0 ? [edge('gusP', line(underFl, [underFl[0], underFl[1] - sG]).reverse(), SPACING.gus)] : []), edge('armholeP', ahF, SPACING.seam), edge('shoulderP', line(spFl, neckF[0]), SPACING.seam)];
    const sidesB = [...backSides, ...(sG > 0 ? [edge('gusM', gusEdge(backSide), SPACING.gus)] : []), edge('armholeM', ahB, SPACING.seam), edge('shoulderM', line(spB, neckB[0]), SPACING.seam)];
    sideSeams = shaping === 'dart' && lift > 0 ? ['sideLow', 'sideHigh'] : ['side'];
    if (shaping === 'dart' && lift > 0) for (const s of ['P', 'M'] as const) seams.push({ name: `bustDart${s}`, a: { piece: 'front', edge: `dartLow${s}` }, b: { piece: 'front', edge: `dartHigh${s}` } });
    sideEase = shaping === 'ease' ? lift / Math.max(1e-6, polyLength(backSide)) : 0;
    pieces.push(mirrored('front', 'torso', { hem: edge('hem', frontHem, SPACING.hem), sides: sidesF, top: edge('neck', neckF, SPACING.neck) }, swapPM));
    pieces.push(mirrored('back', 'torso', { hem: edge('hem', backHem, SPACING.hem), sides: sidesB, top: edge('neck', neckB, SPACING.neck) }, swapPM));
    // the cap: each half from its underarm corner to the crown (0, h), drawn to its armhole's length
    const capHalf = (corner: Vec2, h: number, full: number): Vec2[] => bezier(corner, [corner[0] * 0.85, 0.35 * h], [corner[0] * 0.45 * full, h], [0, h]);
    const lenAt = (corner: Vec2, h: number, full: number) => polyLength(capHalf(corner, h, full));
    // the crown's height from the shorter half drawn plain; the longer half fuller to its own length
    const shorter = Math.min(frontLen, backLen);
    let lo = 0.02, hi = 0.30;
    for (let i = 0; i < 50; i++) { const h = (lo + hi) / 2; if (lenAt([-W / 2, 0], h, 1) < shorter) lo = h; else hi = h; }
    const h = (lo + hi) / 2;
    crown = h;
    const fuller = (corner: Vec2, target: number) => { let flo = 0.2, fhi = 3; for (let i = 0; i < 50; i++) { const f = (flo + fhi) / 2; if (lenAt(corner, h, f) < target) flo = f; else fhi = f; } return (flo + fhi) / 2; };
    const capF = capHalf([-W / 2, 0], h, fuller([-W / 2, 0], frontLen)), capB = capHalf([W / 2, 0], h, fuller([W / 2, 0], backLen));
    let vHem = h - p.sleeveLength;
    vHem = Math.min(vHem, -sG - 0.03);
    const underB: Vec2[] = [];
    const n = Math.max(2, Math.ceil((-sG - vHem) / 0.01));
    for (let i = 0; i <= n; i++) { const v = vHem + (-sG - vHem) * (i / n); underB.push([tubeHalf(v), v]); }
    for (let i = 0; i < underB.length; i++) { const v = underB[i][1], k = Math.max(0, Math.min(1, (v + sG + 0.04) / 0.04)); underB[i] = [underB[i][0] + (W / 2 - underB[i][0]) * k, v]; }
    const ub = densify(smooth(underB, 4)), underF = [...ub].reverse().map((q) => [-q[0], q[1]] as Vec2);
    hemWidth = 2 * ub[0][0];
    shoulderV = h; cuffV = vHem; topFrontV = h; topBackV = h; under = ub; frontNeck = neckF;
    const gusB = sG > 0 ? line([W / 2, -sG], [W / 2, 0]) : null, gusF = sG > 0 ? line([-W / 2, 0], [-W / 2, -sG]) : null;
    const sleeve: PatternPiece = {
      id: 'sleeveP', role: 'sleeve', side: 1, symmetric: false, spacing: SPACING.sleeve,
      edges: [
        edge('cuff', line([-ub[0][0], vHem], [ub[0][0], vHem]), SPACING.hem),
        edge('underBack', ub, SPACING.under),
        ...(gusB ? [edge('gusBack', gusB, SPACING.gus)] : []),
        edge('capBack', densify(capB), SPACING.seam),
        edge('capFront', densify([...capF].reverse()), SPACING.seam),
        ...(gusF ? [edge('gusFront', gusF, SPACING.gus)] : []),
        edge('underFront', densify(underF), SPACING.under),
      ],
    };
    pieces.push(sleeve, mirrorPiece(sleeve, 'sleeveM', (x) => x));
    for (const s of ['P', 'M'] as const) {
      seams.push({ name: `shoulder${s}`, a: { piece: 'front', edge: `shoulder${s}` }, b: { piece: 'back', edge: `shoulder${s}` } });
      seams.push({ name: `armholeFront${s}`, a: { piece: 'front', edge: `armhole${s}` }, b: { piece: `sleeve${s}`, edge: 'capFront' } });
      seams.push({ name: `armholeBack${s}`, a: { piece: 'back', edge: `armhole${s}` }, b: { piece: `sleeve${s}`, edge: 'capBack' } });
    }
  }

  // the gusset: a square diamond, side sG (P: x toward her back; M its mirror)
  if (sG > 0) {
    const d = sG / Math.SQRT2;
    const bot: Vec2 = [0, -d], back: Vec2 = [d, 0], top: Vec2 = [0, d], front: Vec2 = [-d, 0];
    const g: PatternPiece = {
      id: 'gussetP', role: 'gusset', side: 1, symmetric: false, spacing: SPACING.gusset,
      edges: [edge('back', line(bot, back), SPACING.gus), edge('sleeveBack', line(back, top), SPACING.gus), edge('sleeveFront', line(top, front), SPACING.gus), edge('front', line(front, bot), SPACING.gus)],
    };
    pieces.push(g, mirrorPiece(g, 'gussetM', (x) => x));
    for (const s of ['P', 'M'] as const) {
      seams.push({ name: `gussetFront${s}`, a: { piece: 'front', edge: `gus${s}` }, b: { piece: `gusset${s}`, edge: 'front' } });
      seams.push({ name: `gussetBack${s}`, a: { piece: 'back', edge: `gus${s}` }, b: { piece: `gusset${s}`, edge: 'back' } });
      seams.push({ name: `gussetSleeveFront${s}`, a: { piece: `sleeve${s}`, edge: 'gusFront' }, b: { piece: `gusset${s}`, edge: 'sleeveFront' } });
      seams.push({ name: `gussetSleeveBack${s}`, a: { piece: `sleeve${s}`, edge: 'gusBack' }, b: { piece: `gusset${s}`, edge: 'sleeveBack' } });
    }
  }
  for (const s of ['P', 'M'] as const) {
    for (const side of sideSeams) seams.push({ name: `${side}${s}`, a: { piece: 'front', edge: `${side}${s}` }, b: { piece: 'back', edge: `${side}${s}` }, ...(side === 'side' && sideEase > 0 ? { ease: sideEase } : {}) });
    seams.push({ name: `underarm${s}`, a: { piece: `sleeve${s}`, edge: 'underBack' }, b: { piece: `sleeve${s}`, edge: 'underFront' } });
  }

  // --- the full extent (Stage 3): her knee and her wrists, held at least EXTENT_MIN past the drafted hem and cuff --------
  const yK = Math.min(measure.kneeY, yHem - EXTENT_MIN);
  const outside = (arm.outsideLength + arm2.outsideLength) / 2;
  const wristV = Math.min(shoulderV - outside, cuffV - EXTENT_MIN);
  // the level-hem rule's centre extra at any height from her knee to the underarm, tabled on first use
  let rawFront: ((y: number) => number) | null = null, rawBack: ((y: number) => number) | null = null;
  const rawExtra = (s: 'front' | 'back') => (s === 'front' ? (rawFront ??= centreExtras(frontForm, 'front', yK, yU)) : (rawBack ??= centreExtras(form, 'back', yK, yU)));
  let sideFront: readonly Vec2[] = frontSide, sideBack: readonly Vec2[] = backSide;
  if (p.extend) {
    // FRONTEXT and BACKEXT: the side seams continued down to her knee by the same rule (below her hip the ease is the
    // hip's) until her hips are widest, and straight down from there, as a skirt falls (Joshua, 2026-10-28: "a knee high
    // dress shouldn't rise up more than mid-thigh" seated -- cut close down her thighs, 80 cm round above her knee, it
    // was a pencil skirt, and her thighs apart on the stool slid it up to her lap), each ending exactly on its drafted
    // hem's corner; a level hem at her knee by the drafted hem's rule with its
    // own centre extra; the top the plain piece's hem, walked the other way, sewn to it.
    // The side is read a centimetre apart down from the hem, so neighbouring heights' side planes (`zSide`, eleven
    // outlines each) share ten of their eleven, and the front and back share all of them: remembered, they cost an
    // eighth of what reading them afresh does (the plain sides are read as they always were)
    const planeAt = new Map<number, number>();
    const zSideOnce = (y: number): number => {
      let s = 0, k = 0;
      for (let d = -0.05; d <= 0.05 + 1e-9; d += 0.01) {
        const key = Math.round((y + d) * 1e6);
        let z = planeAt.get(key);
        if (z === undefined) { z = midZ(form, y + d); planeAt.set(key, z); }
        s += z; k++;
      }
      return s / k;
    };
    // ...and turned into the plain side seam's own direction over JOIN_SIDE under the drafted hem (`joinAlong`)
    const extSide = (half: (y: number, z: number) => number, plain: readonly Vec2[]): Vec2[] => {
      const ys = [yK];
      for (let k = Math.ceil((yHem - yK) / 0.01) - 1; k >= 1; k--) if (yHem - 0.01 * k > yK + 0.005) ys.push(yHem - 0.01 * k);
      const pts: Vec2[] = ys.map((y) => [half(y, zSideOnce(y)), y]);
      // a skirt falls straight from her hips: below the widest of her the side holds that width (`ys` runs up from her knee)
      for (let i = pts.length - 2; i >= 0; i--) pts[i] = [Math.max(pts[i][0], pts[i + 1][0]), pts[i][1]];
      return densify(joinAlong(pts.length > 2 ? smooth(pts, EXT_SIDE_SMOOTH) : pts, plain[0], plain[1], JOIN_SIDE));
    };
    const fSide = extSide((y, z) => halves(frontForm, y, z).front / 2 + ease(y) / 4, frontSide);
    const bSide = extSide((y, z) => halves(form, y, z).back / 2 + ease(y) / 4, backSide);
    sideFront = [...fSide, ...frontSide.slice(1)]; sideBack = [...bSide, ...backSide.slice(1)];
    pieces.push(mirrored('frontExt', 'torso', { hem: edge('hem', hemOf(fSide, rawExtra('front')(yK), yK), SPACING.hem), sides: [edge('sideP', fSide, SPACING.side)], top: edge('top', [...frontHem].reverse(), SPACING.hem) }, swapPM));
    pieces.push(mirrored('backExt', 'torso', { hem: edge('hem', hemOf(bSide, rawExtra('back')(yK), yK), SPACING.hem), sides: [edge('sideM', bSide, SPACING.side)], top: edge('top', [...backHem].reverse(), SPACING.hem) }, swapPM));
    // SLEEVEEXTP (and its mirror): the tube's under edge continued down to her wrist by the same rule, turned into the
    // drafted under edge's direction over JOIN_SLEEVE under the cuff and ending exactly on its corner (`joinAlong`); a
    // cuff at her wrist; the top the sleeve's cuff walked the other way, sewn to it
    const cuff = pieces.find((q) => q.id === 'sleeveP')!.edges.find((e) => e.name === 'cuff')!.points;
    const pts: Vec2[] = [], n = Math.max(2, Math.ceil((cuffV - wristV) / 0.01));
    for (let i = 0; i < n; i++) {
      const v = wristV + (cuffV - wristV) * (i / n), x = Math.max(tubeHalf(v), 0), k = Math.max(0, Math.min(1, (v + sG + 0.04) / 0.04));
      pts.push([x + (W / 2 - x) * k, v]);
    }
    const ub = densify(joinAlong(pts.length > 2 ? smooth(pts, 4) : pts, under[0], under[1], JOIN_SLEEVE)), uf = densify([...ub].reverse().map((q) => [-q[0], q[1]] as Vec2));
    const ext: PatternPiece = {
      id: 'sleeveExtP', role: 'sleeve', side: 1, symmetric: false, spacing: SPACING.sleeve,
      edges: [edge('cuff', line([-ub[0][0], wristV], [ub[0][0], wristV]), SPACING.hem), edge('underBack', ub, SPACING.under), edge('top', [...cuff].reverse(), SPACING.hem), edge('underFront', uf, SPACING.under)],
    };
    pieces.push(ext, mirrorPiece(ext, 'sleeveExtM', (x) => x));
    seams.push({ name: 'hemFront', a: { piece: 'front', edge: 'hem' }, b: { piece: 'frontExt', edge: 'top' } });
    seams.push({ name: 'hemBack', a: { piece: 'back', edge: 'hem' }, b: { piece: 'backExt', edge: 'top' } });
    for (const s of ['P', 'M'] as const) {
      seams.push({ name: `sideExt${s}`, a: { piece: 'frontExt', edge: `side${s}` }, b: { piece: 'backExt', edge: `side${s}` } });
      seams.push({ name: `cuff${s}`, a: { piece: `sleeve${s}`, edge: 'cuff' }, b: { piece: `sleeveExt${s}`, edge: 'top' } });
      seams.push({ name: `underarmExt${s}`, a: { piece: `sleeveExt${s}`, edge: 'underBack' }, b: { piece: `sleeveExt${s}`, edge: 'underFront' } });
    }
  }
  // the extra at the drafted hem is the plain draft's own: `profile` stops its tape at its last 2 mm step under the
  // underarm line, so it reads up to that much less than the table, which runs to the line itself. The difference is
  // taken out in full at the drafted hem and none of it at her knee (the table drew that hem) or at the underarm line
  // (where every extra is 0), straight between
  const extraAt = (s: 'front' | 'back', y: number): number => {
    const raw = rawExtra(s), atHem = s === 'front' ? extraF : extraB;
    if (y === yHem) return atHem;
    const share = y > yHem ? (yU - y) / (yU - yHem) : (y - yK) / (yHem - yK);
    return raw(y) + (atHem - raw(yHem)) * Math.max(0, Math.min(1, share));
  };

  return {
    pattern: { pieces, seams },
    notes: {
      underarmY: yU, hemY: yHem, widths: notesW, centreFrontExtra: extraF, centreBackExtra: extraB,
      frontRaglanOrArmhole: frontLen, backRaglanOrArmhole: backLen, sleeveTop, sleeveCrown: crown, sleeveHemWidth: hemWidth,
      gussetSide: sG, shoulderSeam: shoulderSeam || shoulderLen,
      yokeLift: { front: devF.lift(uNeckF, vNeckSideF), back: devB.lift(uNeckB, vNeckSideB) },
      bustLift,
    },
    develop: { front: devF, back: devB, xOfU },
    guide: {
      construction: p.construction, underarmY: yU, sideTopY: yS, kneeY: yK, side: { front: sideFront, back: sideBack }, extra: extraAt, frontNeck,
      sleeve: { shoulderV, cuffV, wristV, topFront: topFrontV, topBack: topBackV },
    },
  };
}

/** For a sanity check: the distance between two points (re-exported for the review script). */
export { dist };
