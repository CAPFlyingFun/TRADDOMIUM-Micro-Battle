/**
 * THE ONE DATA PATTERN (ARCHITECTURE §7), generalised from v0's
 * `src/ant/castes.ts` — the single clean data-driven table the audit
 * found in v0. The shape is Path of Titans' curve-override format fitted
 * to ants: a creature is a data file rather than a branch in the movement
 * code, so adding a caste is adding numbers, never `if (caste === …)`.
 *
 * TWO AXES, NOT ONE. v0's first draft had a single curve doing both jobs
 * and it broke immediately: "alate → founding → first brood → mature" is
 * a QUEEN'S LIFE, not a size. She is full-grown before she ever flies,
 * and a small young queen and a huge laying one can both be starving or
 * both be sealed in. So:
 *
 *   GROWTH      0..1, young → adult. What the BODY can do at that size.
 *   LIFE STATE  a name. What she is DOING with it.
 *
 *   value = sampleCurve(stat.curve, growth) × (stat.scale[lifeState] ?? 1)
 *
 * One rule, applied everywhere, so there is never a second competing
 * tuning system to keep in step. See `statOf`.
 *
 * WHERE THE SCALE LIVES. v0 kept each life state's scale table on the
 * STATE ("reading the state tells you what it changes"). Here the scale
 * sits on the STAT, keyed by life state. The trade was deliberate: a
 * scale can then never name a stat that does not exist, because there is
 * nowhere to write one — v0 needed a test for that typo; v1 needs none.
 *
 * WHAT A TYPO DOES HERE: throws. `curveOf` throws on an unknown stat
 * name, `register` throws on a malformed entry, `statOf` throws on an
 * undeclared life state. A `NaN` or a silent 1 would surface as a speed
 * of zero somewhere far from the line that caused it.
 *
 * WIRED. Most numbers in a data file are recorded design — real once the
 * mechanic behind them exists, inert until then. The `wired` list names
 * the stats live systems actually consume, and `checkWired` holds the
 * data to the game's constants at ONE NAMED reference point, so the file
 * cannot quietly drift from the game it claims to describe.
 *
 * PURE: no three, no DOM, no storage. `tests/simulationCore.test.ts`
 * enforces the boundary for every core module once it lands;
 * `tests/dataRegistries.test.ts` enforces it for this directory now.
 */

/** Sample points per curve, youngest first. Five is PoT's shape; it is enough to bend once. */
export const CURVE_POINTS = 5;

/** A stat across growth: five points over the 0..1 axis, youngest first. */
export type Curve = readonly [number, number, number, number, number];

/**
 * Read a curve at a growth of 0 to 1.
 *
 * Straight lines between the five points rather than a spline: a spline
 * can overshoot between its knots, and a stat that dips below the value
 * either side of it is a bug nobody would think to look for. Growth is
 * clamped, not extrapolated — a body cannot be more than adult.
 *
 * Throws on a non-finite growth rather than clamping it: `NaN` would
 * clamp to `NaN`, and a `NaN` in a stat is the exact failure this module
 * exists to make loud.
 */
export function sampleCurve(curve: Curve, growth: number): number {
  if (!Number.isFinite(growth)) throw new Error(`sampleCurve: growth is ${growth}`);
  const at = Math.min(1, Math.max(0, growth)) * (CURVE_POINTS - 1);
  const low = Math.floor(at);
  const high = Math.min(CURVE_POINTS - 1, low + 1);
  return curve[low] + (curve[high] - curve[low]) * (at - low);
}

/**
 * Multipliers by life state. A state missing from here scales by 1: the
 * table lists what CHANGES, so silence is the common case and means
 * "her body's number, unaltered".
 */
export type StateScale = Readonly<Partial<Record<string, number>>>;

export interface StatDef {
  readonly curve: Curve;
  readonly scale?: StateScale;
}

/**
 * The stat table every entry carries. Keyed by the registry's declared
 * stat vocabulary, so the compiler holds an author to the full set: a
 * missing stat and a misspelt one are both errors at the data file.
 */
export type StatTable<TStats extends string> = Readonly<Record<TStats, StatDef>>;

export interface Entry<TStats extends string> {
  /**
   * Stable key. Saves and cross-references hold ids, so an id is never
   * renamed; `name` is what changes when the wording does.
   */
  readonly id: string;
  /** What the player reads. */
  readonly name: string;
  readonly stats: StatTable<TStats>;
  /**
   * The life-state axis, for kinds that have one. Declared so that a
   * scale keyed by a misspelt state is caught at `register` rather than
   * silently never applying, and so `statOf` can refuse a state the
   * entry has never heard of. A kind without the axis (an item does not
   * have a life) leaves this undefined and never passes a life state.
   */
  readonly lifeStates?: readonly string[];
}

export interface Registry<TStats extends string, TEntry extends Entry<TStats>> {
  /** For error messages: 'castes', 'items'. */
  readonly kind: string;
  /** The stat vocabulary every entry must define, exactly. Empty for kinds that do not grow. */
  readonly stats: readonly TStats[];
  /** What live systems consume. Empty until `defineWired`. */
  readonly wired: readonly TStats[];
  /** Throws on a duplicate id or a malformed entry — see `createRegistry`. */
  register(entry: TEntry): void;
  /** Throws on an unknown id, naming what IS registered. */
  get(id: string): TEntry;
  has(id: string): boolean;
  /** Sorted by id, so nothing downstream depends on which data file was imported first. */
  list(): readonly TEntry[];
}

/**
 * One registry per kind (ARCHITECTURE §7), populated from one place by
 * the integration pass — leaf data files EXPORT entries, they do not
 * register on import, same as scenes. That is why a duplicate id THROWS
 * where the scene registry replaces: the scene registry tolerates HMR
 * re-evaluating a self-registering module, and data files never
 * self-register, so a second `register` of an id is always two files
 * claiming the same thing and never a re-evaluation.
 *
 * `register` validates at the door, once, so nothing that reads the data
 * later has to: the stat set matches the declared vocabulary exactly,
 * every curve point is finite, every scale is finite and non-negative
 * (a negative multiplier flips a stat's sign, and no stat means anything
 * negated), and every scale key is a declared life state.
 */
export function createRegistry<TStats extends string, TEntry extends Entry<TStats>>(
  kind: string,
  stats: readonly TStats[],
): Registry<TStats, TEntry> {
  const entries = new Map<string, TEntry>();
  const declared = [...stats].sort();
  let wired: readonly TStats[] | null = null;

  const registry: Registry<TStats, TEntry> & Wirable<TStats> = {
    kind,
    stats: declared,
    get wired(): readonly TStats[] {
      return wired ?? [];
    },
    register(entry: TEntry): void {
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        throw new Error(`${kind}: an entry needs a non-empty id`);
      }
      if (entries.has(entry.id)) throw new Error(`${kind}: duplicate id "${entry.id}"`);
      validateStats(kind, entry, declared);
      entries.set(entry.id, entry);
    },
    get(id: string): TEntry {
      const entry = entries.get(id);
      if (!entry) {
        const known = [...entries.keys()].sort().join(', ') || 'none';
        throw new Error(`${kind}: no entry "${id}" (registered: ${known})`);
      }
      return entry;
    },
    has(id: string): boolean {
      return entries.has(id);
    },
    list(): readonly TEntry[] {
      return [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    setWired(names: readonly TStats[]): void {
      if (wired) throw new Error(`${kind}: WIRED is already defined — it is written in one place`);
      for (const name of names) {
        if (!declared.includes(name)) throw new Error(`${kind}: cannot wire unknown stat "${name}"`);
      }
      wired = [...names];
    },
  };
  return registry;
}

/**
 * The one write into `wired`, kept off the public interface so the list
 * has exactly one author, `defineWired`, and a reader grepping for it
 * finds the data file rather than a call site.
 */
interface Wirable<TStats extends string> {
  setWired(names: readonly TStats[]): void;
}

function validateStats<TStats extends string>(kind: string, entry: Entry<TStats>, declared: readonly string[]): void {
  const where = `${kind} "${entry.id}"`;
  const table = entry.stats as Readonly<Record<string, StatDef | undefined>>;
  const present = Object.keys(table).sort();
  const missing = declared.filter((s) => !present.includes(s));
  const extra = present.filter((s) => !declared.includes(s));
  if (missing.length > 0) throw new Error(`${where}: missing stats ${missing.join(', ')}`);
  if (extra.length > 0) {
    throw new Error(`${where}: stats not in the ${kind} vocabulary: ${extra.join(', ')}`);
  }
  for (const stat of present) {
    const def = table[stat];
    if (!def || !Array.isArray(def.curve) || def.curve.length !== CURVE_POINTS) {
      throw new Error(`${where}: stat "${stat}" needs a curve of ${CURVE_POINTS} points`);
    }
    for (const point of def.curve) {
      if (!Number.isFinite(point)) throw new Error(`${where}: stat "${stat}" has a non-finite curve point`);
    }
    for (const [state, factor] of Object.entries(def.scale ?? {})) {
      if (entry.lifeStates && !entry.lifeStates.includes(state)) {
        throw new Error(`${where}: stat "${stat}" scales an undeclared life state "${state}"`);
      }
      if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0) {
        throw new Error(`${where}: stat "${stat}" scale for "${state}" must be finite and >= 0`);
      }
    }
  }
}

/**
 * Find a stat's definition by name, loudly.
 *
 * Reads are by `string` on purpose: the read side is where names arrive
 * as DATA — a WIRED list, a HUD binding, a dev tool's column — and the
 * compiler cannot help there. So the guard is a throw: a typo would
 * otherwise hand back `undefined`, become `NaN` in the next multiply,
 * and surface as a speed of zero somewhere far from the line that
 * caused it. A typo can never propagate a zero.
 */
export function curveOf<TStats extends string>(entry: Entry<TStats>, stat: string): Curve {
  return statDefOf(entry, stat).curve;
}

function statDefOf<TStats extends string>(entry: Entry<TStats>, stat: string): StatDef {
  const def = (entry.stats as Readonly<Record<string, StatDef | undefined>>)[stat];
  if (!def) {
    const known = Object.keys(entry.stats).sort().join(', ') || 'none';
    throw new Error(`no such stat "${stat}" on "${entry.id}" (has: ${known})`);
  }
  return def;
}

/**
 * THE ONE RESOLUTION RULE: body size, then what she is doing with it.
 *
 * @param growth 0 (young) to 1 (adult); clamped by `sampleCurve`.
 * @param lifeState a state name, or undefined for "whatever her body says".
 *   Throws when the entry declares its states and this is not one of
 *   them — the same rule as an unknown stat, applied to the other axis.
 */
export function statOf<TStats extends string, TEntry extends Entry<TStats>>(
  registry: Registry<TStats, TEntry>,
  id: string,
  stat: string,
  growth: number,
  lifeState?: string,
): number {
  const entry = registry.get(id);
  const def = statDefOf(entry, stat);
  let factor = 1;
  if (lifeState !== undefined) {
    if (entry.lifeStates && !entry.lifeStates.includes(lifeState)) {
      throw new Error(`${registry.kind} "${id}": no such life state "${lifeState}" (has: ${entry.lifeStates.join(', ')})`);
    }
    factor = def.scale?.[lifeState] ?? 1;
  }
  return sampleCurve(def.curve, growth) * factor;
}

/**
 * Declare what the game actually consumes from this registry. Written
 * exactly once, in the module that owns the registry's content, next to
 * the data — so the list is read in the same place the numbers are
 * edited. Throws on a name outside the vocabulary: a misspelt WIRED
 * entry would otherwise be a check that quietly checks nothing.
 */
export function defineWired<TStats extends string, TEntry extends Entry<TStats>>(
  registry: Registry<TStats, TEntry>,
  stats: readonly TStats[],
): void {
  (registry as Registry<TStats, TEntry> & Wirable<TStats>).setWired(stats);
}

/**
 * Where a data file and the running game meet.
 *
 * NAMED rather than indexed on purpose — v0's lesson was that an index
 * silently means whatever the array has drifted to, while "the adult
 * mated alate" means one thing. `expected` holds the live constants the
 * consuming systems export (their `SPRINT_SECONDS`, their pace ceiling),
 * imported by the test that builds this point, so the data and the game
 * agree at exactly one place and a test can say so.
 */
export interface ReferencePoint {
  /** For the report: 'adult mated alate'. */
  readonly name: string;
  readonly id: string;
  readonly growth: number;
  readonly lifeState?: string;
  /** Wired stat → the value the live system uses. */
  readonly expected: Readonly<Record<string, number>>;
  /** Absolute. Default 1e-9: data and constants are computed the same way, so they should agree to rounding. */
  readonly tolerance?: number;
}

/**
 * Hold the registry to its WIRED list at the reference point. Returns
 * every problem found, in words, and an empty array when there are none —
 * rather than throwing at the first, so a test's `toEqual([])` prints
 * the whole drift at once and a dev tool can show it in place.
 *
 * A problem is any of: nothing wired (then the test calling this is the
 * stale thing); the reference entry missing; a wired stat the entry does
 * not define; a wired stat with no live constant given; a live constant
 * given for a stat that is NOT wired (the list is stale, not the
 * constant); a resolved value that is non-finite or off by more than
 * the tolerance.
 */
export function checkWired<TStats extends string, TEntry extends Entry<TStats>>(
  registry: Registry<TStats, TEntry>,
  point: ReferencePoint,
): readonly string[] {
  const problems: string[] = [];
  const at = `${registry.kind} at "${point.name}"`;
  if (registry.wired.length === 0) {
    problems.push(`${at}: nothing is wired, so there is nothing for the reference point to hold`);
    return problems;
  }
  if (!registry.has(point.id)) {
    problems.push(`${at}: no entry "${point.id}" to check against`);
    return problems;
  }
  const tolerance = point.tolerance ?? 1e-9;
  for (const stat of registry.wired) {
    const expected = point.expected[stat];
    if (expected === undefined) {
      problems.push(`${at}: wired stat "${stat}" has no live constant in the reference point`);
      continue;
    }
    let actual: number;
    try {
      actual = statOf(registry, point.id, stat, point.growth, point.lifeState);
    } catch (error) {
      problems.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!Number.isFinite(actual)) {
      problems.push(`${at}: wired stat "${stat}" resolves to ${actual}`);
    } else if (Math.abs(actual - expected) > tolerance) {
      problems.push(`${at}: wired stat "${stat}" is ${actual} in the data but ${expected} in the game`);
    }
  }
  for (const stat of Object.keys(point.expected)) {
    if (!(registry.wired as readonly string[]).includes(stat)) {
      problems.push(`${at}: the game has a constant for "${stat}" but it is not in WIRED`);
    }
  }
  return problems;
}
