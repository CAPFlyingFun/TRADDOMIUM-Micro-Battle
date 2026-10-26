/**
 * HER BUILD: HEIGHT, LENGTHS, WIDTHS AND SIZES, AS NUMBERS (Joshua, 2026-10-26: "add a height adjuster so you can raise
 * or shorten the length of the legs, hips, arms, hands and more basic body controls as well as maybe you can create
 * some common female shape profiles. I would say maybe the max/min per section is +/-30cm from the default positions").
 * His choices on the questions that followed: lengths in cm, the small parts (head, hands, feet) as a size %, HEIGHT
 * spread over her legs, torso and neck in their own proportions, her arms following by the same factor (head, hands
 * and feet keep their size), and the classic five profiles: hourglass, pear, apple, rectangle, inverted triangle.
 *
 * The controls themselves are ordinary body-shape controls (`bodyShape.ts`, group `build`), so saving, loading,
 * RANDOMIZE, its locks and undo carry them with no other change. This file turns them into what a renderer applies
 * (`BuildAmounts`) from what her skeleton measures (`BuildMeasure`, filled in by `view/bodyBuild.ts`), and holds the
 * profiles. Every default is the approved body: approved controls give approved amounts, and approved amounts change
 * nothing anywhere.
 *
 * Core: no three, no DOM, no storage.
 */
import { BODY_CONTROLS, clampShape, type BodyControl, type BodyShape } from './bodyShape';

/** The lengths a renderer stretches. Limbs are both sides at once. */
export type BuildSegment = 'upperLeg' | 'lowerLeg' | 'torso' | 'neck' | 'upperArm' | 'forearm';

export const BUILD_SEGMENTS: readonly BuildSegment[] = Object.freeze(['upperLeg', 'lowerLeg', 'torso', 'neck', 'upperArm', 'forearm'] as BuildSegment[]);

/** The segments her standing height is made of, bottom to top (HEIGHT is spread over these; the arms follow it). */
export const HEIGHT_SEGMENTS: readonly BuildSegment[] = Object.freeze(['upperLeg', 'lowerLeg', 'torso', 'neck'] as BuildSegment[]);

export interface BuildSegmentMeasure {
  /** Its length as the approved body stands, metres (a limb: the mean of her two). */
  readonly length: number;
  /** Metres of standing height gained per metre added to it: the vertical share of its direction, 0..1. */
  readonly rise: number;
}

/** What her skeleton measures, metres. `view/bodyBuild.ts` measures it from the loaded body. */
export interface BuildMeasure {
  readonly segments: Readonly<Record<BuildSegment, BuildSegmentMeasure>>;
  /** Collarbone to shoulder joint, both sides together: what SHOULDERS widens. */
  readonly shoulderSpan: number;
  /** Soles to crown, as she stands approved. */
  readonly height: number;
  /** From her head joint up to her crown: what a bigger head adds to her height, per unit of scale. */
  readonly crownAboveHead: number;
  /** From her ankle joint down to her soles: what bigger feet lift her by, per unit of scale. */
  readonly soleBelowAnkle: number;
}

/** What a renderer applies. Approved: every `add` 0, `shoulders` 0, `waist` 0, `hips` 0, `head`/`hands`/`feet` 1. */
export interface BuildAmounts {
  /** Metres added to each segment's length (each limb, both sides). Never shorter than 40% of the segment. */
  readonly add: Readonly<Record<BuildSegment, number>>;
  /** Metres added across her shoulders, collarbone to shoulder, split half to each side. */
  readonly shoulders: number;
  /** Girth at her waist, as a fraction: 0.2 is 20% wider. */
  readonly waist: number;
  /** Width at her hips and upper thighs, as a fraction. */
  readonly hips: number;
  /** Scale factors, 1 = approved. */
  readonly head: number;
  readonly hands: number;
  readonly feet: number;
}

export type BuildProfileId = 'hourglass' | 'pear' | 'apple' | 'rectangle' | 'invertedTriangle';

export interface BuildProfile {
  readonly id: BuildProfileId;
  /** As its button reads. */
  readonly label: string;
  readonly help: string;
  /** The controls it sets, to these exact values; every other control is left as it is. */
  readonly values: Readonly<Partial<Record<keyof BodyShape, number>>>;
}

/**
 * MEASURED on public/models/sarah-v2-body-slim.glb (joints from its inverse bind matrices, 0.89974678 m per geometry
 * unit). view/bodyBuild.ts measures the loaded body at run time; these are for tests and for the documented slider
 * ranges.
 */
export const SARAH_V2_BUILD: BuildMeasure = Object.freeze({
  segments: Object.freeze({
    upperLeg: Object.freeze({ length: 0.3658, rise: 0.9985 }),
    lowerLeg: Object.freeze({ length: 0.4148, rise: 0.9935 }),
    torso: Object.freeze({ length: 0.2722, rise: 1 }),
    neck: Object.freeze({ length: 0.1215, rise: 0.9857 }),
    upperArm: Object.freeze({ length: 0.2605, rise: 0.9706 }),
    forearm: Object.freeze({ length: 0.2246, rise: 0.9175 }),
  }),
  shoulderSpan: 0.2249,
  height: 1.7,
  crownAboveHead: 0.169,
  soleBelowAnkle: 0.1093,
});

/** A segment may lose at most this share of its own length (it never goes below 40% of itself)... */
const SHRINK_LIMIT = 0.6;
/**
 * ...except her TORSO, which may lose at most 30% of itself: RENDERED (2026-10-26), its band shortened by 13 cm (half)
 * folded her belly across at 0%, 100% and 200%, where 8 cm stayed clean with her full bump. Its slider stops at -8 cm,
 * and this holds HEIGHT -30 with it there (7.0 + 8 = 15 cm asked for, 8.2 given).
 */
const SHRINK: Partial<Record<BuildSegment, number>> = { torso: 0.3 };
const shrinkOf = (s: BuildSegment): number => SHRINK[s] ?? SHRINK_LIMIT;
/** ...and gain at most this share: room for its own control at full stretch plus its part of HEIGHT. */
const GROW_LIMIT = 1.3;

/** Anything not a finite number is 0, and -0 is 0, so an approved body reads as exactly approved. */
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : 0);

/** A segment's measured length, metres; a broken measurement is no length at all. */
const lengthOf = (s: BuildSegment, measure: BuildMeasure): number => Math.max(0, num(measure.segments[s]?.length));

/**
 * Each segment's metres asked for (its HEIGHT share plus its own control) and what it gets (that, held between its
 * floor and ceiling). The one rule `buildAmounts` applies and `heldSegments` reports on, so the two cannot disagree.
 */
function segmentAdds(shape: BodyShape, measure: BuildMeasure): [BuildSegment, { want: number; got: number }][] {
  const H = num(shape.height) / 100;
  let denom = 0;
  for (const s of HEIGHT_SEGMENTS) denom += lengthOf(s, measure) * num(measure.segments[s]?.rise);
  const k = denom > 0 ? H / denom : 0;
  return BUILD_SEGMENTS.map((s) => {
    const length = lengthOf(s, measure);
    const want = k * length + num(shape[s]) / 100;
    return [s, { want, got: num(Math.min(GROW_LIMIT * length, Math.max(-shrinkOf(s) * length, want))) }];
  });
}

/**
 * The segments held at their floor or ceiling, in BUILD_SEGMENTS order: there, moving HEIGHT or the segment's own
 * slider further the same way changes nothing, and the HUD has to say so rather than let the slider look as if it
 * works.
 */
export function heldSegments(shape: BodyShape, measure: BuildMeasure): readonly BuildSegment[] {
  return Object.freeze(segmentAdds(shape, measure).filter(([, a]) => Math.abs(a.want - a.got) > 1e-9).map(([s]) => s));
}

/** The add a segment is held at, centimetres: its floor (-60% of its length) or its ceiling (+130%). */
export function segmentLimitCm(segment: BuildSegment, measure: BuildMeasure, which: 'min' | 'max'): number {
  return num((which === 'min' ? -shrinkOf(segment) : GROW_LIMIT) * lengthOf(segment, measure) * 100);
}

/**
 * What a renderer applies for a shape on a body that measures `measure`.
 *
 * HEIGHT is metres of standing height, shared over the HEIGHT segments by one factor on their lengths, so each grows in
 * its own proportion and together they rise by exactly HEIGHT (their `rise` is how much of a metre along each one is a
 * metre up). The arms take the same factor, so a taller body's arms are as long for her as the approved body's are.
 * Each segment's own control adds its centimetres on top, and no segment goes below 40% of itself. Head, hands and
 * feet are sizes, untouched by HEIGHT: what a bigger head or bigger feet do to her height is `standingHeight`'s
 * business, not a reason to shorten anything else.
 */
export function buildAmounts(shape: BodyShape, measure: BuildMeasure): BuildAmounts {
  const add = {} as Record<BuildSegment, number>;
  for (const [s, { got }] of segmentAdds(shape, measure)) add[s] = got;
  return Object.freeze({
    add: Object.freeze(add),
    shoulders: num(shape.shoulders) / 100,
    waist: num(shape.waist) / 100,
    hips: num(shape.hips) / 100,
    head: 1 + num(shape.head) / 100,
    hands: 1 + num(shape.hands) / 100,
    feet: 1 + num(shape.feet) / 100,
  });
}

/** True when the amounts change nothing: a renderer can leave the body as it loaded. */
export function isApprovedBuild(a: BuildAmounts): boolean {
  return BUILD_SEGMENTS.every((s) => a.add[s] === 0) && a.shoulders === 0 && a.waist === 0 && a.hips === 0 && a.head === 1 && a.hands === 1 && a.feet === 1;
}

const fixed = (v: number): string => {
  const s = v.toFixed(5);
  return s === '-0.00000' ? '0.00000' : s;
};

/**
 * One string per build, for a renderer to tell whether it already applied this one: `''` for the approved body, and the
 * same numbers always give the same key.
 */
export function buildKey(a: BuildAmounts): string {
  if (isApprovedBuild(a)) return '';
  const { add } = a;
  return [
    `ul:${fixed(add.upperLeg)}`, `ll:${fixed(add.lowerLeg)}`, `to:${fixed(add.torso)}`, `nk:${fixed(add.neck)}`,
    `ua:${fixed(add.upperArm)}`, `fa:${fixed(add.forearm)}`,
    `sh:${fixed(a.shoulders)}`, `wa:${fixed(a.waist)}`, `hp:${fixed(a.hips)}`,
    `hd:${fixed(a.head)}`, `hn:${fixed(a.hands)}`, `ft:${fixed(a.feet)}`,
  ].join('|');
}

/**
 * Soles to crown, metres: the approved height, what the HEIGHT segments rise by, and what a bigger head adds above and
 * bigger feet add below. Arms, shoulders, waist and hips do not change it.
 */
export function standingHeight(a: BuildAmounts, measure: BuildMeasure): number {
  let h = num(measure.height);
  for (const s of HEIGHT_SEGMENTS) h += num(a.add[s]) * num(measure.segments[s]?.rise);
  return h + (num(a.head) - 1) * num(measure.crownAboveHead) + (num(a.feet) - 1) * num(measure.soleBelowAnkle);
}

/** Her height as the HUD prints it, metric and imperial: `1.80 m · 5 ft 11 in`. */
export function heightLine(a: BuildAmounts, measure: BuildMeasure): string {
  const m = standingHeight(a, measure);
  // whole inches first, so 6 ft 11.6 in reads 7 ft 0 in rather than 6 ft 12 in
  const inches = Math.max(0, Math.round(m / 0.0254));
  return `${m.toFixed(2)} m · ${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

/**
 * THE FIVE CLASSIC SHAPES (Joshua's choice, 2026-10-26: hourglass, pear, apple, rectangle, inverted triangle). Each is
 * a set of exact values for a few controls -- shoulders, waist, hips and the bust -- and leaves every other control, her
 * height and lengths and belly included, as it was. GAME TUNING: first numbers, to be tuned by eye on renders.
 */
export const BUILD_PROFILES: readonly BuildProfile[] = Object.freeze(([
  { id: 'hourglass', label: 'HOURGLASS', help: 'bust and hips about even, a narrow waist', values: { shoulders: 1, waist: -12, hips: 10, breastSize: 20 } },
  { id: 'pear', label: 'PEAR', help: 'hips wider than the bust and shoulders', values: { shoulders: -3, waist: -4, hips: 18, breastSize: -15 } },
  { id: 'apple', label: 'APPLE', help: 'fuller through the middle, a wider waist', values: { shoulders: 1, waist: 22, hips: -4, breastSize: 15 } },
  { id: 'rectangle', label: 'RECTANGLE', help: 'shoulders, waist and hips close to even', values: { shoulders: 0, waist: 12, hips: -6, breastSize: -10 } },
  { id: 'invertedTriangle', label: 'INV. TRIANGLE', help: 'shoulders and bust wider than the hips', values: { shoulders: 7, waist: 2, hips: -10, breastSize: 15 } },
] as BuildProfile[]).map((p) => Object.freeze({ ...p, values: Object.freeze({ ...p.values }) })));

const profileEntries = (p: BuildProfile): [BodyControl, number][] => Object.entries(p.values) as [BodyControl, number][];

/** Every control any profile sets, in the order the Lab shows them. */
export const PROFILE_CONTROLS: readonly BodyControl[] = Object.freeze(
  BODY_CONTROLS.map((c) => c.key).filter((key) => BUILD_PROFILES.some((p) => p.values[key] !== undefined)),
);

/** The shape with one profile's controls set to its values; every other control exactly as it was. */
export function withProfile(shape: BodyShape, id: BuildProfileId): BodyShape {
  const p = BUILD_PROFILES.find((q) => q.id === id);
  if (!p) return shape;
  return clampShape({ ...shape, ...p.values });
}

/** The profile this shape is wearing unchanged, or null once any of its controls has moved (or for none at all). */
export function profileOf(shape: BodyShape): BuildProfileId | null {
  for (const p of BUILD_PROFILES) {
    if (profileEntries(p).every(([key, v]) => Math.abs(shape[key] - v) < 1e-9)) return p.id;
  }
  return null;
}
