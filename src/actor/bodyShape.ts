/**
 * A BODY'S OWN PROPORTIONS, AS NUMBERS (Joshua, 2026-10-15: "start adding independent
 * body-shape controls so we can customize Sarah now and eventually support multiple
 * characters with natural anatomical variations... five characters at 130% could have
 * slightly different belly heights, widths, depths, tilts, upper fullness, and breast
 * proportions").
 *
 * A `BodyShape` is a flat record of named controls, each a number with a range, a step and
 * a default. Every default is the approved body exactly: a shape of all defaults changes
 * nothing. The belly-size slider is NOT here: it stays the primary control, and every
 * number here is a modifier RELATIVE to whatever size is selected (a +10% width is 10% of
 * that size's own bump, at 30% and at 200% alike).
 *
 * What this file gives a future cast of characters, all pure and testable in node:
 *   - `defaultBodyShape`, `resetControl`: the approved values, whole or one at a time;
 *   - `clampShape`: any record brought into range (what a load or a UI writes goes through it);
 *   - `lerpShape`: smooth interpolation between two bodies;
 *   - `serializeShape` / `parseShape`: save and load, versioned, tolerant of missing keys;
 *   - `variedShape`: a reproducible variation from a seed (the same seed is the same body in
 *     every session), within a per-control spread.
 *
 * Core: no three, no DOM, no storage. Where a shape is stored is the owner's business.
 */

export type BodyControl =
  | 'bellyTilt' | 'bellyHeight' | 'bellyWidth' | 'bellyDepth' | 'bellyUpper' | 'bellyLower'
  | 'breastSize' | 'breastWidth' | 'breastHeight' | 'breastDepth' | 'breastSpacing' | 'breastPosition' | 'breastDroop' | 'breastUpper' | 'breastLower';

export interface BodyControlSpec {
  readonly key: BodyControl;
  readonly group: 'belly' | 'breasts';
  readonly label: string;
  readonly unit: '°' | 'cm' | '%';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The approved body's value. */
  readonly fallback: number;
  /** How far a seeded variation may wander from the default, either way. GAME TUNING. */
  readonly spread: number;
  readonly help: string;
}

/**
 * The controls, in the order the Lab shows them. Ranges are GAME TUNING: wide enough to see
 * a difference, narrow enough that the shapes stay clean (each was rendered at both ends).
 */
export const BODY_CONTROLS: readonly BodyControlSpec[] = Object.freeze([
  { key: 'bellyTilt', group: 'belly', label: 'Tilt', unit: '°', min: 0, max: 20, step: 0.5, fallback: 20, spread: 5, help: 'downward settling past 100%, as reached at 200% (20 = the approved shape)' },
  { key: 'bellyHeight', group: 'belly', label: 'Height', unit: 'cm', min: -2, max: 2, step: 0.1, fallback: 0, spread: 0.7, help: 'the bump sits higher or lower on her' },
  { key: 'bellyWidth', group: 'belly', label: 'Width', unit: '%', min: -15, max: 15, step: 1, fallback: 0, spread: 5, help: 'side-to-side fullness of the bump' },
  { key: 'bellyDepth', group: 'belly', label: 'Depth', unit: '%', min: -15, max: 15, step: 1, fallback: 0, spread: 5, help: 'forward projection of the bump' },
  { key: 'bellyUpper', group: 'belly', label: 'Upper fullness', unit: '%', min: -20, max: 20, step: 1, fallback: 0, spread: 6, help: 'the bump above the navel' },
  { key: 'bellyLower', group: 'belly', label: 'Lower fullness', unit: '%', min: -20, max: 20, step: 1, fallback: 0, spread: 6, help: 'the bump below the navel' },
  { key: 'breastSize', group: 'breasts', label: 'Size', unit: '%', min: -100, max: 100, step: 1, fallback: 0, spread: 10, help: 'volume from the bust the belly slider gives: +100% is 2.0x, -100% is 0.5x, at any belly size' },
  { key: 'breastWidth', group: 'breasts', label: 'Width', unit: '%', min: -25, max: 25, step: 1, fallback: 0, spread: 4, help: 'side to side' },
  { key: 'breastHeight', group: 'breasts', label: 'Height', unit: '%', min: -25, max: 25, step: 1, fallback: 0, spread: 4, help: 'top to bottom' },
  { key: 'breastDepth', group: 'breasts', label: 'Depth', unit: '%', min: -25, max: 25, step: 1, fallback: 0, spread: 4, help: 'forward projection' },
  { key: 'breastSpacing', group: 'breasts', label: 'Spacing', unit: 'cm', min: -1.5, max: 1.5, step: 0.1, fallback: 0, spread: 0.4, help: 'closer together or farther apart, round her chest' },
  { key: 'breastPosition', group: 'breasts', label: 'Position', unit: 'cm', min: -1.5, max: 1.5, step: 0.1, fallback: 0, spread: 0.5, help: 'higher or lower on the chest' },
  { key: 'breastDroop', group: 'breasts', label: 'Droop', unit: '°', min: -5, max: 15, step: 0.5, fallback: 0, spread: 3, help: 'natural downward tilt' },
  { key: 'breastUpper', group: 'breasts', label: 'Upper fullness', unit: '%', min: -20, max: 20, step: 1, fallback: 0, spread: 5, help: 'the upper pole' },
  { key: 'breastLower', group: 'breasts', label: 'Lower fullness', unit: '%', min: -20, max: 20, step: 1, fallback: 0, spread: 5, help: 'the lower pole' },
] as BodyControlSpec[]);

export type BodyShape = Readonly<Record<BodyControl, number>>;

export const BODY_SHAPE_VERSION = 1;

const SPEC = new Map(BODY_CONTROLS.map((c) => [c.key, c]));
export function controlSpec(key: BodyControl): BodyControlSpec {
  const s = SPEC.get(key);
  if (!s) throw new Error(`no body control ${key}`);
  return s;
}

export function defaultBodyShape(): BodyShape {
  return Object.fromEntries(BODY_CONTROLS.map((c) => [c.key, c.fallback])) as BodyShape;
}

const clampOne = (spec: BodyControlSpec, v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : spec.fallback;
  return Math.min(spec.max, Math.max(spec.min, n));
};

/** Any record brought into range; a missing or broken value is the approved one. */
export function clampShape(shape: Partial<Record<string, unknown>>): BodyShape {
  return Object.fromEntries(BODY_CONTROLS.map((c) => [c.key, clampOne(c, shape[c.key])])) as BodyShape;
}

export function setControl(shape: BodyShape, key: BodyControl, value: number): BodyShape {
  return { ...shape, [key]: clampOne(controlSpec(key), value) };
}

export function resetControl(shape: BodyShape, key: BodyControl): BodyShape {
  return { ...shape, [key]: controlSpec(key).fallback };
}

/** True when every control is the approved value: nothing to apply. */
export function isDefaultShape(shape: BodyShape): boolean {
  return BODY_CONTROLS.every((c) => shape[c.key] === c.fallback);
}

/** Between two bodies, every control at once (t clamped to 0..1). */
export function lerpShape(a: BodyShape, b: BodyShape, t: number): BodyShape {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return clampShape(Object.fromEntries(BODY_CONTROLS.map((c) => [c.key, a[c.key] + (b[c.key] - a[c.key]) * u])));
}

/** Saved as `{ version, shape: { only the controls that differ from the approved body } }`. */
export function serializeShape(shape: BodyShape): string {
  const diff: Record<string, number> = {};
  for (const c of BODY_CONTROLS) if (shape[c.key] !== c.fallback) diff[c.key] = shape[c.key];
  return JSON.stringify({ version: BODY_SHAPE_VERSION, shape: diff });
}

/** Read back what `serializeShape` wrote; anything unreadable is the approved body. */
export function parseShape(text: string): BodyShape {
  try {
    const raw = JSON.parse(text) as { version?: unknown; shape?: Record<string, unknown> };
    if (!raw || typeof raw !== 'object' || raw.version !== BODY_SHAPE_VERSION || typeof raw.shape !== 'object' || !raw.shape) return defaultBodyShape();
    return clampShape({ ...defaultBodyShape(), ...raw.shape });
  } catch {
    return defaultBodyShape();
  }
}

/** mulberry32: a small seeded generator, the same numbers for the same seed everywhere. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A character's own variation of a base body, from a seed: each control moves by up to its
 * `spread` (times `amount`, 1 by default), on a soft curve that favours small moves. The
 * same seed and base give the same body in every session; it is a function, not a roll.
 */
export function variedShape(seed: number, base: BodyShape = defaultBodyShape(), amount = 1): BodyShape {
  const rnd = seeded(Math.floor(Number.isFinite(seed) ? seed : 0));
  const out: Record<string, number> = {};
  for (const c of BODY_CONTROLS) {
    // the mean of two uniforms: a triangle, most characters near the base
    const r = rnd() + rnd() - 1;
    const v = base[c.key] + r * c.spread * amount;
    out[c.key] = Math.round(v / c.step) * c.step;
  }
  return clampShape(out);
}

/**
 * LINKED DIMENSIONS (Joshua, 2026-10-15: "add the ability to link or unlink dimensions,
 * similar to an aspect-ratio lock... Width and Height could be linked while Depth remains
 * independent, or all three could be linked together").
 *
 * Width, height and depth are each a factor on the bust (1 + value/100). Moving one LINKED
 * dimension multiplies every other linked dimension by the same ratio, so their proportions
 * to one another hold, whatever they were when they were linked: linking or unlinking is
 * only a flag and never changes a value. If the move would carry any linked dimension past
 * its range, the ratio is cut back so that none does, and the proportions still hold.
 */
export const BREAST_DIMENSIONS: readonly BodyControl[] = Object.freeze(['breastWidth', 'breastHeight', 'breastDepth'] as BodyControl[]);
export function setLinkedControl(shape: BodyShape, key: BodyControl, value: number, linked: ReadonlySet<BodyControl> | readonly BodyControl[]): BodyShape {
  const set = new Set(linked);
  const group = BREAST_DIMENSIONS.filter((k) => set.has(k));
  if (!group.includes(key) || group.length < 2) return setControl(shape, key, value);
  const spec = controlSpec(key), from = 1 + shape[key] / 100;
  const want = 1 + Math.min(spec.max, Math.max(spec.min, Number.isFinite(value) ? value : shape[key])) / 100;
  if (!(from > 0)) return setControl(shape, key, value);
  let r = want / from;
  // no linked dimension may leave its range: shorten the step until every one fits
  for (const k of group) {
    const c = controlSpec(k), f = 1 + shape[k] / 100;
    if (!(f > 0)) continue;
    const hi = (1 + c.max / 100) / f, lo = (1 + c.min / 100) / f;
    r = Math.min(hi, Math.max(lo, r));
  }
  const out: Record<string, number> = { ...shape };
  for (const k of group) out[k] = Math.round(((1 + shape[k] / 100) * r - 1) * 100 * 1e6) / 1e6;
  return clampShape(out);
}

export function controlLine(key: BodyControl, value: number): string {
  const s = controlSpec(key);
  // a linked move can leave a whole-number control between whole numbers: show the tenth then
  const shown = s.step < 1 || Math.abs(value - Math.round(value)) > 0.05 ? value.toFixed(1) : value.toFixed(0);
  const signed = s.unit !== '°' && value > 0 ? `+${shown}` : shown;
  return `${s.label.toUpperCase()} · ${signed}${s.unit === '%' ? '%' : s.unit === 'cm' ? ' cm' : '°'}${value === s.fallback ? ' (approved)' : ''}`;
}
