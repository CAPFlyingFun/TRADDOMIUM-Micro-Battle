/**
 * CLOTHING COVERAGE TEMPLATES for body paint (Joshua, 2026-10-20: "select familiar clothing styles and have the
 * corresponding body regions filled automatically... coverage masks for the body-paint system, not automatically
 * generated 3D garments", with boundaries that can move -- "shorts ending at different thigh heights... shirt sleeves
 * ending at different arm lengths... adjustable neckline and shirt hem... belly coverage that can go above or below
 * the bump").
 *
 * A template is a handful of numbers on the body map's own coordinates (`bodyRegions.ts`): where on her trunk a
 * waistband, hem or neckline sits (0 hip joints, 1 base of the neck), where on her leg a hem ends (0 hip, 1 ankle),
 * where on her arm a sleeve ends (0 shoulder, 1 wrist). The mask is those ranges with a soft edge, so a boundary is a
 * smooth line around her at any setting, it is attached to her anatomy through every morph, and it fits another body
 * on the same base model by being fractions of her own bones.
 *
 * Pure arithmetic.
 */
import { BODY_REGIONS, type BodyMap } from './bodyRegions';
import { leotardFrontStencil } from './leotardStencil';

export interface CoverageParams {
  /**
   * Lower body: the waistband at the middle of her front, at her sides (over the tops of her hips) and at the middle of
   * her back, on the trunk (null: no lower part; a null side is halfway between front and back).
   */
  readonly riseFront: number | null;
  readonly riseSide: number | null;
  readonly riseBack: number | null;
  /**
   * How far round her the front height holds before the band starts rising to the side height, on `around` (1 the
   * middle of her front, 0.5 her side). 1: it starts rising at once. An under-belly band holds low across the width of
   * the bump, then rises over the hips, so it does not climb the bump's flanks.
   */
  readonly riseFrontWidth: number;
  /** Lower body: where the legs begin (0 from the hips; higher for stockings and socks) and end (1 at the ankle). */
  readonly legStart: number;
  readonly legEnd: number;
  /** Lower body: carry on over the feet. */
  readonly feet: boolean;
  /** Upper body: hem at front and back, neckline at front and back, on the trunk (null: no upper part). */
  readonly hemFront: number | null;
  readonly hemBack: number | null;
  readonly neckFront: number | null;
  readonly neckBack: number | null;
  /** Upper body: where a sleeve ends on the arm; below 0, no sleeve. */
  readonly sleeve: number;
  /**
   * Upper body: a straight top edge at her front and back instead of a neckline (a bandeau, a band), on the trunk.
   * Null: the neckline above decides.
   */
  readonly topFront: number | null;
  readonly topBack: number | null;
  /** ...and at her sides, under the arms, so the edge rounds off the cups into the side instead of running straight. */
  readonly topSide: number | null;
  /**
   * Upper body: shoulder straps, `strap` wide, their inner edge `strapIn` out from her neck's axis sideways, both in
   * neck radii (her shoulder top runs from about 0 at the neck to about 2 where her arm begins). Inside the straps the
   * neckline is open down to its depth; outside them, above the armhole, she is bare. 0: no straps.
   */
  readonly strap: number;
  readonly strapIn: number;
  /** Upper body: an armhole -- skin beyond the straps above this trunk height is bare (a tank, a bra). Null: none. */
  readonly armhole: number | null;
  /**
   * The front neckline's shape (Joshua, 2026-10-22: "depending on the type of shirt... U-neck and V-neck"): `crew`, the
   * plain opening round her neck; `u`, a round dip down to `neckFront`; `v`, a point down to `neckFront`. Behind, every
   * style is the crew's. The cleavage bridge (`cleavageBridge.ts`) is cut to the same line.
   */
  readonly neckStyle: 'crew' | 'u' | 'v';
  /**
   * A one-piece's leg openings, cut high (a leotard; see `legCutLine`). Heights are on the trunk: `crotch` where the
   * strip between her legs ends; `side` / `sideBack` the top of the cut over her hips in front and behind. Widths are
   * hip-joint spacings from her midline: `gusset` / `gussetFront` the half-width at the crotch behind and in front;
   * `backSpan` how wide the back strip's rounded corners are. `traced`: in front, along the creases, Joshua's own
   * line traced onto her skin decides (`leotardStencil.ts`), where her body is the one it was traced on.
   * Null: the openings are where `legEnd` says.
   */
  readonly legCut: { readonly crotch: number; readonly side: number; readonly sideBack: number; readonly gusset: number; readonly gussetFront: number; readonly traced?: boolean; readonly backSpan: number } | null;
  /**
   * A shirt's LENGTH (Joshua, 2026-10-22: "make the shirt length adjustable from knee-length up to just above the
   * crotch"): 0 just above her crotch, 1 just above her knee, measured on her own body (`shirtHem`). The hem is level all round,
   * as a real one hangs, and the shirt's drape (`tunicDrape.ts`) spans her thighs and falls from her belly and seat down
   * to it. Null: the hem is `hemFront` / `hemBack`.
   */
  readonly length: number | null;
}

const NONE: CoverageParams = Object.freeze({ riseFront: null, riseSide: null, riseBack: null, riseFrontWidth: 1, legStart: 0, legEnd: 0, feet: false, hemFront: null, hemBack: null, neckFront: null, neckBack: null, sleeve: -1, topFront: null, topBack: null, topSide: null, strap: 0, strapIn: 0, armhole: null, neckStyle: 'crew', legCut: null, length: null });

export const TEMPLATE_GROUPS = ['Leggings', 'Shorts', 'Shirts', 'Bras & bands', 'Other'] as const;
export interface CoverageTemplate {
  readonly id: string; readonly name: string; readonly group: (typeof TEMPLATE_GROUPS)[number]; readonly params: CoverageParams;
  /** How the garment is BUILT, for detail through paint (`detailMaterials.ts`): a bra's padding, a swimsuit's lining. */
  readonly construction?: 'swimsuit' | 'sportsBra';
}

const lower = (rise: { readonly front: number; readonly side: number; readonly back: number; readonly frontWidth?: number }, legEnd: number, extra: Partial<CoverageParams> = {}): CoverageParams => ({ ...NONE, riseFront: rise.front, riseSide: rise.side, riseBack: rise.back, riseFrontWidth: rise.frontWidth ?? 1, legEnd, ...extra });
const upper = (hemFront: number, hemBack: number, neckFront: number, sleeve: number, extra: Partial<CoverageParams> = {}): CoverageParams => ({ ...NONE, hemFront, hemBack, neckFront, neckBack: 0.97, sleeve, ...extra });

/**
 * Rises, hems and necklines used below, on the trunk (0 her hip joints, 1 the base of her neck).
 *
 * The rises were measured on her rest surface (Joshua, 2026-10-20, after the second pass: shorts and leggings "still
 * appear to sit too low around the upper hips and rear... complete seat and pelvis coverage, smooth waistlines"): the
 * fullest point of her seat is at about 0.06, the small of her back at about 0.41, and her hips are widest at about
 * -0.08. So a waistband at the back sits ABOVE the seat, over the sacrum toward the small of the back, never across
 * the buttocks; at the sides it rides over the tops of her hips; and only at the front does an under-belly band dip,
 * in a U under the bump.
 */
export const RISES = Object.freeze({
  /** maternity leggings with a panel over the bump */
  overBelly: Object.freeze({ front: 0.48, side: 0.4, back: 0.4 }),
  /** under the bump at the front, over the hips and up the back */
  underBelly: Object.freeze({ front: -0.02, side: 0.26, back: 0.33, frontWidth: 0.8 }),
});
export const LINES = Object.freeze({
  hemHip: -0.1, hemMaternity: -0.04, hemCrop: 0.62, neckCrew: 0.94, neckScoop: 0.86, neckTank: 0.8,
  /** the dips of a U- and a V-neck, down into her cleavage */
  neckU: 0.76, neckV: 0.72,
  /** under her bust (her map's underbust is 0.6), and the band of a bra or bandeau behind */
  underbust: 0.56, bandBack: 0.56, bandTopBack: 0.7, bandeauTop: 0.82,
  /** where an armhole's bottom sits, a little above her underarm */
  armhole: 0.8,
  /** a bandeau's top edge under her arms, below its height over the cups */
  bandeauSide: 0.72,
});
/**
 * How round the corners are, in trunk heights (0.1 is about 6 cm on her): where a strap meets the armhole, so the
 * armhole sweeps from the strap down to the underarm and the side of the cup reads as a curve, not a box (Joshua,
 * 2026-10-21: "the side silhouette looks too squared / boxy... a softer, more anatomical curve... like the bikini top");
 * and at the bottom corners of a neckline inside the straps, a scoop.
 */
export const ROUND = Object.freeze({ armhole: 0.13, neckline: 0.1 });
/**
 * A high-cut one-piece's leg openings, drawn to Joshua's own outline on her bare body (2026-10-21: front, back and 45
 * degrees). `across` is in hip-joint spacings out from her midline.
 *
 * - FRONT: along the creases at the tops of her thighs, as Joshua marked them on the close-ups (2026-10-21). On
 *   Sarah his line itself is traced onto her skin (`traced`, `leotardStencil.ts`); elsewhere, and out over her hips
 *   past the ends of it, `legCutFront` draws it as a height: a crotch as wide as the gap between the tops of her
 *   thighs (`gussetFront` either side of the midline), then an edge rising up the creases, gently at first and more
 *   steeply as it rounds her hip, to `side`, where it meets the back's.
 * - BACK (`legCutBack`, a coverage): as he drew it -- a narrow strip `gusset` either side of the midline up between
 *   her buttocks, curving out over their upper part in a long rounded corner (`backSpan` across, BACK_FILLET of the
 *   cut's height behind) into the top edge that runs over her hips at `sideBack`; her seat is bare. He tried a wider back panel the
 *   same day and asked for this back again (2026-10-21, "revert the back part"). A shape with a vertical wall and a
 *   corner is not a height-of-across line, so the back is measured as a distance to that shape instead.
 * - Between, round her sides, the front's edge over her hips blends into the back's as one line (`legCutLine`), and
 *   the back's shape gives way to it, by how far round her the skin stands -- round her own THIGH for her legs' skin
 *   (`legAround`), since the openings go round her legs: measured round her spine, the front of her thigh, well out to
 *   the side of it, read as her side, and took the back's higher edge.
 */
/**
 * How the front edge climbs the creases, out from the crotch: `crotch + FRONT_SLOPE * d + FRONT_CURVE * d^2`, d hip
 * spacings out past `gussetFront`. Fitted to his marks on the close-ups (2026-10-21): gently near the crotch, steeper
 * as it rounds her hip, up to `side`.
 */
const FRONT_SLOPE = 0.15, FRONT_CURVE = 0.49;
export function legCutFront(g: NonNullable<CoverageParams['legCut']>, across: number): number {
  const d = Math.max(0, across - g.gussetFront);
  return Math.min(g.side, g.crotch + FRONT_SLOPE * d + FRONT_CURVE * d * d);
}
/**
 * The cut as one height round her sides: the front's edge blended into the back's top edge, which rises out of the
 * strip over `backSpan`, by `front` (1 the front's, 0 the back's). At her back's middle `legCutBack`'s shape is used
 * instead.
 */
export function legCutLine(g: NonNullable<CoverageParams['legCut']>, across: number, front: number): number {
  const u = Math.max(0, Math.min(1, (across - g.gusset) / Math.max(1e-3, g.backSpan)));
  const back = g.crotch + (g.sideBack - g.crotch) * (1 - (1 - u) ** 2);
  return back + (legCutFront(g, across) - back) * front;
}
/**
 * A U or V neckline's half-width, in neck radii sideways from her neck's axis, at trunk height `t`: nothing below its
 * dip (`neckFront`), widening to NECK_WIDTH at the base of her neck -- straight for a V, round for a U.
 */
export function necklineHalfWidth(p: Pick<CoverageParams, 'neckFront' | 'neckStyle'>, t: number): number {
  if (p.neckFront === null || p.neckStyle === 'crew') return 0;
  const u = Math.max(0, Math.min(1, (t - p.neckFront) / Math.max(1e-3, NECK_TOP - p.neckFront)));
  return NECK_WIDTH * (p.neckStyle === 'v' ? u : Math.sqrt(Math.max(0, 1 - (1 - u) ** 2)));
}
/**
 * The highest trunk height a U or V neckline leaves covered at `lateral` neck radii from her neck's axis (the inverse of
 * `necklineHalfWidth`); Infinity where it cuts nothing (a crew, or out past the opening).
 */
export function necklineCut(p: Pick<CoverageParams, 'neckFront' | 'neckStyle'>, lateral: number): number {
  if (p.neckFront === null || p.neckStyle === 'crew' || lateral >= NECK_WIDTH) return Infinity;
  const w = Math.max(0, lateral) / NECK_WIDTH;
  const u = p.neckStyle === 'v' ? w : 1 - Math.sqrt(Math.max(0, 1 - w * w));
  return p.neckFront + u * (NECK_TOP - p.neckFront);
}
/** Where a U or V neckline reaches its full width (just under the base of her neck) and how wide that is, in neck radii. */
const NECK_TOP = 0.97, NECK_WIDTH = 1.7;
/**
 * Where on her trunk (her own height, 0 her hip joints) her crotch and her knees are: the lowest skin of her crotch,
 * and the tops of her knees (Joshua, 2026-10-22, marked on her front: 0% just above the crotch, 100% just above the
 * knee). Measured once a map. A map without those regions (a test's) gets her proportions.
 */
const landmarks = new WeakMap<BodyMap, { readonly crotch: number; readonly knee: number }>();
export function legLandmarks(map: BodyMap): { readonly crotch: number; readonly knee: number } {
  const known = landmarks.get(map);
  if (known) return known;
  const crotchId = BODY_REGIONS.findIndex((r) => r.id === 'crotch') + 1;
  const knees = new Set(['kneeL', 'kneeR'].map((id) => BODY_REGIONS.findIndex((r) => r.id === id) + 1));
  let crotch = Infinity;
  const kneeTs: number[] = [];
  for (let v = 0; v < map.region.length; v++) {
    if (map.region[v] === crotchId) crotch = Math.min(crotch, map.trunk[v]);
    else if (knees.has(map.region[v])) kneeTs.push(map.trunk[v]);
  }
  // the top of her knees: high in the knee band, clear of a stray vertex behind it
  kneeTs.sort((a, b) => a - b);
  const out = Object.freeze({ crotch: Number.isFinite(crotch) ? crotch : -0.15, knee: kneeTs.length ? kneeTs[Math.floor(kneeTs.length * 0.95)] : -0.7 });
  landmarks.set(map, out);
  return out;
}
/** How far above her crotch the shortest shirt ends, in trunk heights (about 5 cm on her): at the groin creases, on the
 * line Joshua drew for 0% (2026-10-22: the first 0% was "a little" below it). */
const ABOVE_CROTCH = 0.09;
/** A shirt's level hem on her trunk for a LENGTH (0 just above her crotch, 1 just above her knee). */
export function shirtHem(map: BodyMap, length: number): number {
  const { crotch, knee } = legLandmarks(map), top = crotch + ABOVE_CROTCH;
  return top + (knee - top) * Math.max(0, Math.min(1, length));
}
/** The shirts' length until it is moved: 0%, his marked line just above her crotch (Joshua, 2026-10-22). */
export const DEFAULT_SHIRT_LENGTH = 0;
/** The crew opening's width round her neck, in neck radii (what `open` is for a crew at LINES.neckCrew). */
const CREW_OPEN = 1.5 + (0.97 - LINES.neckCrew) * 4;
/** How far down the back strip, as a share of the cut's height behind, its rounded corner into the top edge begins. */
const BACK_FILLET = 0.38;
/**
 * The back of the cut as a coverage, 0..1: bare inside each cheek's opening (outside the strip, below the top edge,
 * with the inner top corner rounded), covered elsewhere above the crotch. `across` and `t` as for the line; `scale`
 * turns hip spacings into trunk lengths; `flat` shrinks heights where her skin faces up (the tops of her buttocks).
 */
export function legCutBack(g: NonNullable<CoverageParams['legCut']>, across: number, t: number, scale: number, flat: number): number {
  const X = (across - g.gusset) * scale; // into the cheek from the strip, in trunk lengths
  const Y = (g.sideBack - t) / flat; // down into the cheek from the top edge
  const rx = g.backSpan * scale, ry = BACK_FILLET * (g.sideBack - g.crotch);
  let inside: number; // signed distance into the bare opening
  if (X < rx && Y < ry && X > -rx && Y > -ry) {
    const e = Math.hypot((rx - X) / rx, (ry - Y) / ry);
    inside = X > 0 && Y > 0 ? (1 - e) * Math.min(rx, ry) : Math.min(X, Y, (1 - e) * Math.min(rx, ry));
  } else inside = Math.min(X, Y);
  return Math.min(soft(-inside), soft(t - g.crotch));
}
/** A shirt: its hem is its LENGTH, level all round (the tank, the tees, the sleeveless shirt). */
const SHIRT: Partial<CoverageParams> = Object.freeze({ length: DEFAULT_SHIRT_LENGTH });
const NO_RISE = Object.freeze({ front: -9, side: -9, back: -9 });
const FULL = Object.freeze({ riseFront: 1, riseSide: 1, riseBack: 1 });

export const COVERAGE_TEMPLATES: readonly CoverageTemplate[] = Object.freeze(([
  ['leggingsFull', 'Over-belly leggings', 'Leggings', lower(RISES.overBelly, 1.0)],
  ['leggingsUnder', 'Under-belly leggings', 'Leggings', lower(RISES.underBelly, 1.0)],
  ['leggingsCapri', 'Capri leggings', 'Leggings', lower(RISES.overBelly, 0.78)],
  ['leggingsKnee', 'Knee-length leggings', 'Leggings', lower(RISES.overBelly, 0.5)],
  ['shortsAthletic', 'Short shorts', 'Shorts', lower(RISES.underBelly, 0.12)],
  ['shortsMid', 'Mid-thigh shorts', 'Shorts', lower(RISES.underBelly, 0.26)],
  ['shortsBike', 'Bike shorts', 'Shorts', lower(RISES.underBelly, 0.36)],
  ['shortsKnee', 'Knee-length shorts', 'Shorts', lower(RISES.overBelly, 0.44)],
  ['tank', 'Tank top', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckTank, -1, { strapIn: 1.0, strap: 0.55, neckBack: 0.9, armhole: LINES.armhole, length: DEFAULT_SHIRT_LENGTH })],
  ['sleeveless', 'Sleeveless shirt', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckCrew, 0.07, SHIRT)],
  ['teeShort', 'Short-sleeve T-shirt', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckCrew, 0.32, SHIRT)],
  // U- and V-neck tees (Joshua, 2026-10-22): the dip goes down between her breasts, and the cleavage bridge follows it
  ['teeU', 'U-neck T-shirt', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckU, 0.32, { ...SHIRT, neckStyle: 'u' })],
  ['teeV', 'V-neck T-shirt', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckV, 0.32, { ...SHIRT, neckStyle: 'v' })],
  ['teeThreeQuarter', '3/4-sleeve T-shirt', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckCrew, 0.72, SHIRT)],
  ['teeLong', 'Long-sleeve shirt', 'Shirts', upper(LINES.hemHip, LINES.hemHip, LINES.neckCrew, 1.0, SHIRT)],
  ['crop', 'Crop top', 'Shirts', upper(LINES.hemCrop, LINES.hemCrop - 0.04, LINES.neckScoop, 0.25)],
  ['maternity', 'Maternity T-shirt', 'Shirts', upper(LINES.hemMaternity, LINES.hemHip + 0.06, LINES.neckCrew, 0.32)],
  ['sportsBra', 'Sports bra', 'Bras & bands', upper(LINES.underbust, LINES.bandBack, LINES.neckScoop - 0.02, -1, { strapIn: 0.85, strap: 0.65, neckBack: 0.86, armhole: LINES.armhole - 0.02 }), 'sportsBra'],
  ['bandeau', 'Bandeau', 'Bras & bands', upper(LINES.underbust, LINES.bandBack, LINES.neckCrew, -1, { topFront: LINES.bandeauTop, topSide: LINES.bandeauSide, topBack: LINES.bandTopBack })],
  ['bodysuitFull', 'Full bodysuit', 'Other', { ...upper(-1, -1, LINES.neckCrew, 1.0), ...FULL, legEnd: 1.0 }],
  // a leotard cut high (Joshua, 2026-10-21, marked on the render: "rise higher along the hips, with a cleaner upward
  // curve from the crotch toward the upper hip"), front and back, distinct from the swimsuit's straight openings
  ['bodysuit', 'Long-sleeve leotard', 'Other', { ...upper(-1, -1, LINES.neckCrew, 1.0), ...FULL, legEnd: 0.4, legCut: { crotch: -0.15, side: 0.28, sideBack: 0.3, gusset: 0.035, gussetFront: 0.07, backSpan: 0.5, traced: true } }],
  ['swimsuit', 'One-piece swimsuit', 'Other', { ...upper(-1, -1, LINES.neckScoop, -1, { strapIn: 0.98, strap: 0.47, neckBack: 0.86, armhole: LINES.armhole }), ...FULL, legEnd: 0.02 }, 'swimsuit'],
  ['stockings', 'Thigh-high stockings', 'Other', lower(NO_RISE, 1.0, { legStart: 0.22, feet: true })],
  ['socksKnee', 'Knee-high socks', 'Other', lower(NO_RISE, 1.0, { legStart: 0.58, feet: true })],
  ['socks', 'Crew socks', 'Other', lower(NO_RISE, 1.0, { legStart: 0.86, feet: true })],
] as const).map(([id, name, group, params, construction]: readonly [string, string, CoverageTemplate['group'], CoverageParams, CoverageTemplate['construction']?]) =>
  Object.freeze({ id, name, group, params: Object.freeze(params), ...(construction ? { construction } : {}) })));

/** The sliders a template offers, and the parameter each moves. */
export interface CoverageDial { readonly id: 'rise' | 'riseBack' | 'legCut' | 'legEnd' | 'legStart' | 'hem' | 'length' | 'neck' | 'sleeve'; readonly name: string; readonly min: number; readonly max: number }
export const COVERAGE_DIALS: readonly CoverageDial[] = Object.freeze([
  { id: 'rise', name: 'WAISTBAND (FRONT)', min: -0.2, max: 0.7 },
  { id: 'riseBack', name: 'HIPS & BACK RISE', min: 0, max: 0.6 },
  { id: 'legStart', name: 'LEG TOP', min: 0, max: 0.95 },
  { id: 'legEnd', name: 'LEG LENGTH', min: 0, max: 1 },
  { id: 'legCut', name: 'LEG CUT HEIGHT', min: -0.2, max: 0.35 },
  { id: 'hem', name: 'HEM / BELLY', min: -0.3, max: 0.75 },
  { id: 'length', name: 'SHIRT LENGTH', min: 0, max: 1 },
  { id: 'neck', name: 'NECKLINE / TOP EDGE', min: 0.7, max: 1 },
  { id: 'sleeve', name: 'SLEEVE', min: -0.05, max: 1 },
].map((d) => Object.freeze(d)) as CoverageDial[]);

/** Which dials a set of parameters uses. */
export function dialsFor(p: CoverageParams): CoverageDial['id'][] {
  const out: CoverageDial['id'][] = [];
  if (p.riseFront !== null && p.riseFront > -5 && p.riseFront < 1) out.push('rise', 'riseBack');
  if (p.riseFront !== null && p.legStart > 0) out.push('legStart');
  if (p.legCut) out.push('legCut'); else if (p.riseFront !== null) out.push('legEnd');
  if (p.length !== null) out.push('length');
  else if (p.hemFront !== null && p.hemFront > -1) out.push('hem');
  if (p.neckFront !== null) out.push('neck');
  if (p.hemFront !== null) out.push('sleeve');
  return out;
}

/** One dial's value in a set of parameters, and the parameters with it moved (front and back keep their offset). */
export function dialValue(p: CoverageParams, dial: CoverageDial['id']): number {
  switch (dial) {
    case 'rise': return p.riseFront ?? 0;
    case 'riseBack': return p.riseBack ?? 0;
    case 'legStart': return p.legStart;
    case 'legEnd': return p.legEnd;
    case 'legCut': return p.legCut?.side ?? 0;
    case 'hem': return p.hemFront ?? 0;
    case 'length': return p.length ?? 0;
    case 'neck': return p.topFront ?? p.neckFront ?? 1;
    case 'sleeve': return p.sleeve;
  }
}
export function withDial(p: CoverageParams, dial: CoverageDial['id'], value: number): CoverageParams {
  switch (dial) {
    // the front waistband moves on its own (above or below the bump); the hips and back move together
    case 'rise': return { ...p, riseFront: value };
    case 'riseBack': return { ...p, riseBack: value, riseSide: sideOf(p) + value - (p.riseBack ?? value) };
    case 'legStart': return { ...p, legStart: Math.min(value, p.legEnd) };
    case 'legEnd': return { ...p, legEnd: Math.max(value, p.legStart) };
    case 'legCut': return p.legCut ? { ...p, legCut: { ...p.legCut, side: value } } : p;
    case 'hem': return { ...p, hemFront: value, hemBack: (p.hemBack ?? value) + value - (p.hemFront ?? value) };
    case 'length': return { ...p, length: Math.max(0, Math.min(1, value)) };
    // a bandeau's top edge, front and back together; otherwise the neckline's depth
    case 'neck': return p.topFront !== null ? { ...p, topFront: value, topBack: (p.topBack ?? value) + value - p.topFront } : { ...p, neckFront: value };
    case 'sleeve': return { ...p, sleeve: value };
  }
}

/**
 * How soft a template's edge is, in trunk or limb fractions (about two centimetres on her). Wider than her triangles,
 * so the edge is a smooth line across them rather than a staircase along them (Joshua, 2026-10-20: "a few spots where
 * its jagged and not smooth").
 */
export const EDGE = 0.035;
const soft = (x: number) => (x <= -EDGE ? 0 : x >= EDGE ? 1 : ((t) => t * t * (3 - 2 * t))((x + EDGE) / (2 * EDGE)));
/** The same edge across her shoulders, in neck radii (one is about 8 cm on her, so this edge is about 1.4 cm either side). */
const softSideways = (x: number) => soft(x * 0.2);

/** Never under a body garment: her head, hands and (unless the garment has feet) feet. Everything else on her trunk
 * and legs can be -- a hip's side is covered whichever region its skin falls in. */
const NEVER = new Set(['face', 'scalp', 'handL', 'handR']);
/** A line that is one height at her front and another at her back, carried smoothly round her sides. */
const blend = (front: number, back: number, around: number) => back + (front - back) * around;
const ease = (u: number) => u * u * (3 - 2 * u);
const smooth01 = (u: number) => ease(Math.max(0, Math.min(1, u)));
/** The waistband's height at her sides (halfway between front and back when a template does not say). */
const sideOf = (p: CoverageParams): number => p.riseSide ?? ((p.riseFront ?? 0) + (p.riseBack ?? p.riseFront ?? 0)) / 2;
/**
 * A line round her with a height at the middle of her front, one at her sides and one at the middle of her back,
 * eased between so it is level where it crosses each and has no corner anywhere. `frontReach` and `backReach` say
 * where (on `around`: 1 the front's middle, 0.5 the sides, 0 the back's middle) the line has finished turning from
 * the side height to the front or back height: 1 and 0.5 turn gradually across the whole way, as a plain waistband
 * does; 0.8 holds an under-belly band low across the bump; a small `backReach` keeps a leotard's back high until it
 * plunges at the middle.
 */
export function aroundLine(front: number, side: number, back: number, frontReach: number, backReach: number, around: number): number {
  const fr = Math.max(0.55, Math.min(1, frontReach)), br = Math.max(0.05, Math.min(0.5, backReach));
  return around >= 0.5
    ? side + (front - side) * ease(Math.min(1, (around - 0.5) / (fr - 0.5)))
    : back + (side - back) * ease(Math.min(1, around / br));
}
/** A waistband round her: under an under-belly band, a U under the bump that rises over the hips and runs level across the back. */
export function waistline(p: CoverageParams, around: number): number {
  const front = p.riseFront ?? 0;
  return aroundLine(front, sideOf(p), p.riseBack ?? front, p.riseFrontWidth ?? 1, 0.5, around);
}
/**
 * How far INSIDE a rounded corner a point is, in trunk heights: the corner is the quarter-plane u > 0, v > 0 with its
 * point rounded off at radius r. Positive inside, negative outside.
 */
export function insideCorner(u: number, v: number, r: number): number {
  if (u >= r && v >= r) return Math.min(u, v);
  return r - Math.hypot(Math.max(r - u, 0), Math.max(r - v, 0));
}

/** The coverage of `p` at every vertex of the map, 0 to 1. */
export function coverage(map: BodyMap, p: CoverageParams): Float32Array {
  const n = map.region.length, out = new Float32Array(n);
  const stencil = p.legCut?.traced ? leotardFrontStencil(n) : null;
  for (let v = 0; v < n; v++) {
    const id = BODY_REGIONS[map.region[v] - 1]?.id ?? '';
    const t = map.trunk[v], s = map.leg[v], a = map.arm[v];
    let c = 0;
    // lower part: the waistband down, then the legs from legStart to legEnd (and the feet, for socks and stockings)
    if (p.riseFront !== null) {
      const rise = waistline(p, map.around[v]);
      if (Number.isFinite(s)) {
        const isFoot = id === 'footL' || id === 'footR';
        // a garment with feet (socks, stockings) runs on past the ankle with no hem there
        const onLeg = isFoot ? (p.feet ? 1 : 0) : Math.min(p.feet ? 1 : soft(p.legEnd - s), p.legStart > 0 ? soft(s - p.legStart) : 1);
        // the top of the thigh, the hips and the seat are also under the waistband
        c = Math.max(c, Math.min(onLeg, p.legStart > 0 ? 1 : soft(rise - t)));
      } else if (!Number.isFinite(a) && !NEVER.has(id) && id !== 'neck' && p.legStart <= 0) {
        // a one-piece (a swimsuit, a leotard) has a top as well: above its hem the top's neckline and straps decide
        const upTo = p.hemFront !== null ? Math.min(rise, blend(p.hemFront, p.hemBack ?? p.hemFront, map.around[v])) : rise;
        c = Math.max(c, soft(upTo - t));
      }
    }
    // upper part: from the hem up to the neckline, and the arms out to the sleeve. The neckline is an OPENING round
    // her neck -- skin near the neck above the neckline's depth is bare; her shoulders, further out, are covered to the
    // top -- so a lower neckline is both deeper and wider, the way a crew and a scoop differ. A bandeau has a straight
    // top edge instead. A tank, a sports bra or a swimsuit has straps: a band over each shoulder, the neckline open
    // inside them, an armhole outside them
    if (p.hemFront !== null) {
      // a shirt's hem is level, and its paint has faded out by the hem itself: the drape's hem band (`tunicDrape.ts`)
      // is the crisp edge there, over the paint's soft one
      const hem = p.length !== null ? shirtHem(map, p.length) + EDGE : blend(p.hemFront, p.hemBack ?? p.hemFront, map.around[v]);
      const neck = blend(p.neckFront ?? 1, p.neckBack ?? p.neckFront ?? 1, map.around[v]);
      const lat = map.lateral[v];
      // the neckline: a straight top edge (a bandeau); inside a strapped garment's straps, open down to its depth; or
      // an opening round her neck, wider the deeper it is
      const open = p.strap > 0 ? 0 : 1.5 + Math.max(0, 0.97 - (p.neckFront ?? 0.97)) * 4;
      // sideways distances (neck radii) as trunk heights, so a corner can be round in both directions at once
      const k = map.neckRadius / map.trunkLength, outer = p.strapIn + p.strap;
      const top = p.topFront !== null
        ? soft(aroundLine(p.topFront, p.topSide ?? (p.topFront + (p.topBack ?? p.topFront)) / 2, p.topBack ?? p.topFront, p.topSide !== null ? 0.82 : 1, 0.5, map.around[v]) - t)
        // inside the straps, a scoop: the neckline's bottom corners are rounded
        : p.strap > 0 ? 1 - soft(insideCorner((p.strapIn - lat) * k, t - neck, ROUND.neckline))
        : p.neckStyle !== 'crew' && p.neckFront !== null
          // a U or V in front: the crew's opening round her neck, cut down the front to the dip
          ? Math.min(Math.max(soft(blend(LINES.neckCrew, p.neckBack ?? LINES.neckCrew, map.around[v]) - t), soft(map.collar[v] - CREW_OPEN)),
            1 - smooth01((map.around[v] - 0.55) / 0.2) * Math.min(soft(t - p.neckFront), softSideways(necklineHalfWidth(p, t) - lat)))
          : Math.max(soft(neck - t), soft(map.collar[v] - open));
      // straps over her shoulders; beyond them, above the armhole, bare -- the armhole sweeps round from the strap's
      // outer edge down to the underarm instead of turning a square corner
      const strap = p.strap > 0 ? Math.min(softSideways(lat - p.strapIn), softSideways(outer - lat)) : 0;
      const armhole = p.armhole !== null ? soft(insideCorner((lat - outer) * k, t - p.armhole, ROUND.armhole)) : 0;
      if (Number.isFinite(a)) {
        if (id !== 'handL' && id !== 'handR') {
          const sleeve = p.sleeve >= -0.04 ? Math.min(soft(p.sleeve - a), top) : 0;
          // where her arm's skin meets her back and side (her skin weights mix the two there), a sleeveless garment
          // treats it as the torso it sits on, so the armhole's curve is one clean line rather than a fringe
          // -- skin near the shoulder joint, or no further out from her neck than just past the strap (the back of the
          // armpit); never the arm itself, which stands further out
          const near = Math.max(soft(0.08 - a), softSideways(outer + 0.4 - lat));
          const join = p.armhole !== null ? Math.min(near, soft(t - hem), top, 1 - armhole) : 0;
          c = Math.max(c, sleeve, join, Math.min(strap, soft(0.2 - a)));
        }
      } else if (!NEVER.has(id) && id !== 'footL' && id !== 'footR' && !(Number.isFinite(s) && p.riseFront !== null)) {
        // (a garment with its own lower part -- a leotard, a swimsuit -- leaves her legs to that part, so its leg
        // openings are where IT says, not wherever the top's hem would reach.) The neck region too: the neckline's own
        // opening decides where her neck is bare, so the skin at the base of her neck that the neck bone carries out
        // toward the shoulders is covered like the shoulders it joins
        const body = Math.min(soft(t - hem), top, 1 - armhole);
        c = Math.max(c, body, Math.min(strap, soft(t - hem)));
      }
    }
    // a high-cut one-piece: below the leg line, bare. The line is measured out from her midline rather than round her
    // trunk, because the openings go round her LEGS, which stand either side of it; its edge is measured square to the
    // line, not straight up, so the steep parts are as soft as the rest
    if (p.legCut && !Number.isFinite(a)) {
      // how far the front's edge decides rather than the back's: past a sixth of the way round her trunk from the
      // back's middle, and on the FRONT of her thigh (round the thigh itself: round her spine, the front of her thigh,
      // well out to the side of it, reads as her side). The side of her thigh is left to her trunk's measure, so the
      // two edges hand over round her hip the same way above and below the crease
      const g = p.legCut, x = map.across[v], dx = 0.01;
      const thighFront = Number.isFinite(map.legAround[v]) ? smooth01((map.legAround[v] - 0.55) / 0.25) : 0;
      const w = Math.max(smooth01((map.around[v] - 0.15) / 0.2), thighFront);
      const round = Math.max(map.around[v], 0.35 * thighFront);
      const line = (at: number) => legCutLine(g, at, w);
      const slope = (line(x + dx) - line(x - dx)) / (2 * dx) / (map.hipSpan / map.trunkLength);
      // where her skin faces up or down (the tops of her buttocks), height changes slowly across it, so a height edge
      // would spread wide and blur: measure it across the skin instead
      const flat = Math.sqrt(Math.max(0.12, 1 - map.upFacing[v] ** 2));
      const sides = soft((t - line(x)) / flat / Math.sqrt(1 + slope * slope));
      // the back's strip and its rounded corners are a shape, not a line: across the middle of her back it decides,
      // and by her sides (where the two agree, the opening's top running over her hips) the blended line takes over
      const back = legCutBack(g, x, t, map.hipSpan / map.trunkLength, flat);
      // in front, along the creases, Joshua's own traced line decides where the template has one
      // (`leotardStencil.ts`): her thigh's skin just below a crease stands as high up her trunk as her groin's just
      // above it -- a crease is a fold -- so no line worked out from heights could follow it without spilling onto
      // the tops of her thighs or leaving the crease walls bare
      // (it marks only skin that can be seen from the front, so where it has a mark, the mark decides outright)
      const traced = stencil && stencil.weight[v] > 0 ? stencil.weight[v] : 0;
      const front = sides + ((stencil ? stencil.cover[v] : 1) - sides) * traced;
      c = Math.min(c, back + (front - back) * Math.max(smooth01(round / 0.35), traced));
      // and the insides of her THIGHS, where they meet below the crotch, stay bare wherever no traced line decides:
      // thigh skin there that faces sideways is never covered, so the colour ends at the crotch (Joshua, 2026-10-21,
      // circled front and back)
      if (id === 'thighL' || id === 'thighR') c = Math.min(c, 1 - (1 - traced) * smooth01((map.sideFacing[v] - 0.35) / 0.25) * soft(g.crotch + 0.12 - t));
    }
    out[v] = c;
  }
  return out;
}
