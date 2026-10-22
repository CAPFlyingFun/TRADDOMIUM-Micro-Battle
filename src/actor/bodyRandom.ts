/**
 * RANDOMIZE, WITHIN RANGES, WITH LOCKS (Joshua, 2026-10-22: "every slider and slider group to support adjustable
 * randomization ranges... Each slider should have a lock option. Locked values remain exactly as set; unlocked values
 * are randomized only within their permitted ranges... group locks, such as BELLY and BREAST, but individual locks
 * should be able to provide finer control... future controls for height, hips, waist, arms, face... can use the same
 * randomization rules").
 *
 * Generic over any numbered control: a control is a key, a group, its slider's range and step, and the range a press
 * of RANDOMIZE may pick from until someone changes it (`defaultMin` / `defaultMax`). A RULE is that control's chosen
 * range and whether it is locked. A group lock locks every control in the group without touching their own locks, so
 * unlocking the group gives back exactly the fine locks that were set inside it.
 *
 * Core: no three, no DOM, no storage. The random source is passed in, so a test (or a seeded character) is
 * reproducible.
 */

export interface RandomSpec {
  readonly key: string;
  readonly group: string;
  /** The slider's own range and step: no rule may go past them. */
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The range RANDOMIZE uses until it is changed. */
  readonly defaultMin: number;
  readonly defaultMax: number;
}

export interface RandomRule {
  readonly min: number;
  readonly max: number;
  readonly locked: boolean;
}

export interface RandomRules {
  /** Per control key. A key with no rule uses its spec's defaults, unlocked. */
  readonly rules: Readonly<Record<string, RandomRule>>;
  /** Locked groups. */
  readonly groups: readonly string[];
}

export const NO_RULES: RandomRules = Object.freeze({ rules: Object.freeze({}), groups: Object.freeze([]) as readonly string[] });

/** A control's rule: its own, or its defaults. Always within the slider, min never above max. */
export function ruleFor(rules: RandomRules, spec: RandomSpec): RandomRule {
  const r = rules.rules[spec.key];
  const lo = Math.min(spec.max, Math.max(spec.min, r?.min ?? spec.defaultMin)), hi = Math.min(spec.max, Math.max(spec.min, r?.max ?? spec.defaultMax));
  return { min: Math.min(lo, hi), max: Math.max(lo, hi), locked: r?.locked === true };
}

/** Whether a control is held: by its own lock or its group's. */
export function isLocked(rules: RandomRules, spec: RandomSpec): boolean {
  return ruleFor(rules, spec).locked || rules.groups.includes(spec.group);
}

/** Rules with one control's rule changed (`min`, `max` or `locked`). */
export function withRule(rules: RandomRules, spec: RandomSpec, change: Partial<RandomRule>): RandomRules {
  const was = ruleFor(rules, spec);
  return { ...rules, rules: { ...rules.rules, [spec.key]: { ...was, ...change } } };
}

/** Rules with a group locked or unlocked. */
export function withGroupLock(rules: RandomRules, group: string, locked: boolean): RandomRules {
  const groups = rules.groups.filter((g) => g !== group);
  return { ...rules, groups: locked ? [...groups, group] : groups };
}

/**
 * New values: every control that is not locked (by itself or its group) picked evenly from its rule's range, on its
 * slider's step; every locked one exactly as it was. Values for keys with no spec pass through untouched.
 */
export function randomize(values: Readonly<Record<string, number>>, specs: readonly RandomSpec[], rules: RandomRules, random: () => number = Math.random): Record<string, number> {
  const out: Record<string, number> = { ...values };
  for (const spec of specs) {
    if (isLocked(rules, spec)) continue;
    const r = ruleFor(rules, spec);
    const raw = r.min + random() * (r.max - r.min);
    const stepped = Math.round((raw - spec.min) / spec.step) * spec.step + spec.min;
    // on the slider's step, and never outside the range (a range whose ends are off the step keeps its ends)
    out[spec.key] = Number(Math.min(r.max, Math.max(r.min, stepped)).toFixed(6));
  }
  return out;
}

/** Rules from untrusted data (a save, a file): known controls and groups only, every number finite and in range. */
export function sanitizeRules(raw: unknown, specs: readonly RandomSpec[]): RandomRules {
  if (typeof raw !== 'object' || raw === null) return NO_RULES;
  const r = raw as { rules?: unknown; groups?: unknown };
  const rules: Record<string, RandomRule> = {};
  if (typeof r.rules === 'object' && r.rules !== null) {
    for (const spec of specs) {
      const v = (r.rules as Record<string, unknown>)[spec.key];
      if (typeof v !== 'object' || v === null) continue;
      const o = v as { min?: unknown; max?: unknown; locked?: unknown };
      const fin = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
      rules[spec.key] = ruleFor({ rules: { [spec.key]: { min: fin(o.min, spec.defaultMin), max: fin(o.max, spec.defaultMax), locked: o.locked === true } }, groups: [] }, spec);
    }
  }
  const known = new Set(specs.map((s) => s.group));
  const groups = Array.isArray(r.groups) ? [...new Set(r.groups.filter((g): g is string => typeof g === 'string' && known.has(g)))] : [];
  return { rules, groups };
}
