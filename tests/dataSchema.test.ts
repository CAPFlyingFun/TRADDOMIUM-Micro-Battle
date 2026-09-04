/**
 * The curve × life-state pattern, held to its promises: straight lines,
 * clamped ends, one resolution rule, and a throw for every typo. The
 * fixture is a made-up body with three stats and three states — the
 * SHAPE of a queen, not the species data, which is Phase 7's.
 */
import { describe, expect, it } from 'vitest';
import {
  checkWired, createRegistry, CURVE_POINTS, curveOf, defineWired, sampleCurve, statOf,
  type Curve, type Entry, type ReferencePoint, type Registry, type StatTable,
} from '../src/data/schema';

const STATS = ['speed', 'maxStamina', 'mass'] as const;
type Stat = (typeof STATS)[number];

interface Body extends Entry<Stat> {
  readonly lifeStates: readonly string[];
}

const QUEEN: Body = {
  id: 'queen',
  name: 'Queen',
  lifeStates: ['alate', 'founding', 'laying'],
  stats: {
    speed: { curve: [0.7, 0.8, 0.9, 0.95, 1], scale: { founding: 0.8, laying: 0.4 } },
    maxStamina: { curve: [17.5, 21, 24.5, 27.5, 30] },
    mass: { curve: [3.5, 6, 9, 12, 14], scale: { founding: 0.68, laying: 1.3 } },
  },
};

const WORKER: Body = {
  id: 'worker',
  name: 'Worker',
  lifeStates: ['adult'],
  stats: {
    speed: { curve: [0.5, 0.7, 0.85, 0.95, 1] },
    maxStamina: { curve: [10, 12, 14, 16, 18] },
    mass: { curve: [0.5, 0.8, 1.2, 1.6, 2] },
  },
};

function bodies(): Registry<Stat, Body> {
  const registry = createRegistry<Stat, Body>('bodies', STATS);
  registry.register(QUEEN);
  registry.register(WORKER);
  return registry;
}

/** A well-formed entry with one field changed, for the validation tests. */
function variant(patch: Partial<Body>): Body {
  return { ...QUEEN, id: 'variant', ...patch };
}

describe('sampleCurve', () => {
  const curve: Curve = [1, 2, 3, 4, 5];

  it('has five points, like the format it copies', () => {
    expect(CURVE_POINTS).toBe(5);
    expect(curve).toHaveLength(CURVE_POINTS);
  });

  it('lands exactly on each sample point', () => {
    expect(sampleCurve(curve, 0)).toBe(1);
    expect(sampleCurve(curve, 0.25)).toBe(2);
    expect(sampleCurve(curve, 0.5)).toBe(3);
    expect(sampleCurve(curve, 0.75)).toBe(4);
    expect(sampleCurve(curve, 1)).toBe(5);
  });

  it('walks a straight line between points', () => {
    expect(sampleCurve([0, 10, 20, 30, 40], 0.125)).toBeCloseTo(5, 9);
    expect(sampleCurve([0, 10, 20, 30, 40], 0.6)).toBeCloseTo(24, 9);
    expect(sampleCurve([0, 100, 0, 0, 0], 0.1)).toBeCloseTo(40, 9);
  });

  it('clamps rather than extrapolating off either end', () => {
    expect(sampleCurve(curve, -3)).toBe(1);
    expect(sampleCurve(curve, 99)).toBe(5);
  });

  it('never overshoots the points either side — the reason for lines, not a spline', () => {
    const zigzag: Curve = [10, 0, 10, 0, 10];
    for (let g = 0; g <= 1; g += 0.01) {
      const at = sampleCurve(zigzag, g);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(10);
    }
  });

  it('throws on a non-finite growth instead of clamping NaN to NaN', () => {
    expect(() => sampleCurve(curve, Number.NaN)).toThrow(/growth is NaN/);
    expect(() => sampleCurve(curve, Number.POSITIVE_INFINITY)).toThrow(/growth/);
  });
});

describe('curveOf', () => {
  it('returns the curve of a stat that exists', () => {
    expect(curveOf(QUEEN, 'mass')).toBe(QUEEN.stats.mass.curve);
  });

  it('throws on a name it does not have, naming it and what it has', () => {
    // A typo would otherwise hand back undefined, become NaN in the next
    // multiply, and surface as a speed of zero somewhere far away.
    expect(() => curveOf(QUEEN, 'wingspan')).toThrow(/no such stat "wingspan" on "queen" \(has: mass, maxStamina, speed\)/);
  });
});

describe('a registry', () => {
  it('registers, looks up, and lists sorted by id regardless of registration order', () => {
    const registry = createRegistry<Stat, Body>('bodies', STATS);
    registry.register(WORKER);
    registry.register(QUEEN);
    expect(registry.get('queen')).toBe(QUEEN);
    expect(registry.has('queen')).toBe(true);
    expect(registry.has('major')).toBe(false);
    expect(registry.list().map((e) => e.id)).toEqual(['queen', 'worker']);
  });

  it('keeps its declared stat vocabulary, sorted', () => {
    expect(bodies().stats).toEqual(['mass', 'maxStamina', 'speed']);
  });

  it('throws on an unknown id, naming what IS registered', () => {
    expect(() => bodies().get('major')).toThrow(/bodies: no entry "major" \(registered: queen, worker\)/);
    expect(() => createRegistry<Stat, Body>('bodies', STATS).get('queen')).toThrow(/registered: none/);
  });

  it('throws on a duplicate id — two data files claiming one thing is never a re-evaluation', () => {
    const registry = bodies();
    expect(() => registry.register({ ...QUEEN })).toThrow(/bodies: duplicate id "queen"/);
  });

  it('throws on an empty id', () => {
    expect(() => bodies().register(variant({ id: '' }))).toThrow(/non-empty id/);
  });

  it('throws when a declared stat is missing or an undeclared one is present', () => {
    const { mass: _dropped, ...withoutMass } = QUEEN.stats;
    expect(() => bodies().register(variant({ stats: withoutMass as unknown as StatTable<Stat> })))
      .toThrow(/"variant": missing stats mass/);
    const withExtra = { ...QUEEN.stats, wingspan: { curve: [1, 1, 1, 1, 1] as const } };
    expect(() => bodies().register(variant({ stats: withExtra })))
      .toThrow(/"variant": stats not in the bodies vocabulary: wingspan/);
  });

  it('refuses any curve stat on a kind that declares none — an item does not grow', () => {
    interface Thing extends Entry<never> {
      readonly massMg: number;
    }
    const things = createRegistry<never, Thing>('things', []);
    expect(() => things.register({ id: 'seed', name: 'Seed', massMg: 2, stats: {} })).not.toThrow();
    // The compiler cannot reject this ({} accepts anything), so the door must.
    expect(() => things.register({ id: 'bug', name: 'Beetle', massMg: 40, stats: { speed: { curve: [1, 1, 1, 1, 1] } } }))
      .toThrow(/"bug": stats not in the things vocabulary: speed/);
  });

  it('throws on a curve that is not five finite numbers', () => {
    const short = { ...QUEEN.stats, speed: { curve: [1, 2, 3] as unknown as Curve } };
    expect(() => bodies().register(variant({ stats: short }))).toThrow(/"speed" needs a curve of 5 points/);
    const nan = { ...QUEEN.stats, speed: { curve: [1, 2, Number.NaN, 4, 5] as const } };
    expect(() => bodies().register(variant({ stats: nan }))).toThrow(/"speed" has a non-finite curve point/);
    const divided = { ...QUEEN.stats, mass: { curve: [1, 2, 3, 4, 30 / 0] as const } };
    expect(() => bodies().register(variant({ stats: divided }))).toThrow(/"mass" has a non-finite curve point/);
  });

  it('throws on a negative or non-finite scale — no stat means anything negated', () => {
    const negative = { ...QUEEN.stats, speed: { curve: QUEEN.stats.speed.curve, scale: { founding: -1 } } };
    expect(() => bodies().register(variant({ stats: negative }))).toThrow(/scale for "founding" must be finite and >= 0/);
    const infinite = { ...QUEEN.stats, speed: { curve: QUEEN.stats.speed.curve, scale: { laying: Number.POSITIVE_INFINITY } } };
    expect(() => bodies().register(variant({ stats: infinite }))).toThrow(/scale for "laying"/);
  });

  it('throws on a scale keyed by a life state the entry did not declare', () => {
    // v0 needed a test per data file for this typo; here the door catches it once.
    const typo = { ...QUEEN.stats, speed: { curve: QUEEN.stats.speed.curve, scale: { foundng: 0.8 } } };
    expect(() => bodies().register(variant({ stats: typo }))).toThrow(/scales an undeclared life state "foundng"/);
  });
});

describe('statOf — the one resolution rule', () => {
  it('multiplies the body by what she is doing with it', () => {
    const body = sampleCurve(QUEEN.stats.speed.curve, 0.5);
    expect(statOf(bodies(), 'queen', 'speed', 0.5, 'laying')).toBeCloseTo(body * 0.4, 12);
    expect(statOf(bodies(), 'queen', 'mass', 1, 'founding')).toBeCloseTo(14 * 0.68, 12);
  });

  it('leaves a stat the state says nothing about alone — silence means 1', () => {
    expect(statOf(bodies(), 'queen', 'maxStamina', 1, 'founding')).toBe(30);
    expect(statOf(bodies(), 'queen', 'speed', 1, 'alate')).toBe(1);
  });

  it('reads the body alone when no state is given', () => {
    expect(statOf(bodies(), 'queen', 'mass', 1)).toBe(14);
    expect(statOf(bodies(), 'worker', 'mass', 0)).toBe(0.5);
  });

  it('clamps growth like the curve does', () => {
    expect(statOf(bodies(), 'queen', 'mass', 7)).toBe(14);
  });

  it('throws on an unknown stat, an unknown id, and an undeclared life state', () => {
    expect(() => statOf(bodies(), 'queen', 'wingspan', 1)).toThrow(/no such stat "wingspan"/);
    expect(() => statOf(bodies(), 'major', 'speed', 1)).toThrow(/no entry "major"/);
    expect(() => statOf(bodies(), 'queen', 'speed', 1, 'foundng'))
      .toThrow(/bodies "queen": no such life state "foundng" \(has: alate, founding, laying\)/);
  });

  it('accepts any state name on a kind that declares no axis', () => {
    // An entry without `lifeStates` has not said what its states are, so
    // there is nothing to check a name against; the scale still applies.
    const open = createRegistry<Stat, Entry<Stat>>('open', STATS);
    open.register({ id: 'q', name: 'Q', stats: QUEEN.stats });
    expect(statOf(open, 'q', 'speed', 1, 'laying')).toBeCloseTo(0.4, 12);
    expect(statOf(open, 'q', 'speed', 1, 'resting')).toBe(1);
  });
});

describe('WIRED', () => {
  /** The adult, unscaled — the point where the data and the game meet. */
  const point: ReferencePoint = {
    name: 'adult alate',
    id: 'queen',
    growth: 1,
    lifeState: 'alate',
    expected: { speed: 1, maxStamina: 30 },
  };

  function wired(): Registry<Stat, Body> {
    const registry = bodies();
    defineWired(registry, ['speed', 'maxStamina']);
    return registry;
  }

  it('is empty until defined, then holds what was defined', () => {
    const registry = bodies();
    expect(registry.wired).toEqual([]);
    defineWired(registry, ['speed', 'maxStamina']);
    expect(registry.wired).toEqual(['speed', 'maxStamina']);
  });

  it('is written in one place — a second definition throws', () => {
    const registry = wired();
    expect(() => defineWired(registry, ['mass'])).toThrow(/WIRED is already defined/);
  });

  it('cannot wire a stat outside the vocabulary — a misspelt list would check nothing', () => {
    expect(() => defineWired(bodies(), ['sped' as Stat])).toThrow(/cannot wire unknown stat "sped"/);
  });

  it('passes at the reference point when the data agrees with the game', () => {
    expect(checkWired(wired(), point)).toEqual([]);
  });

  it('passes through a scaled state when the constants account for it', () => {
    const scaled: ReferencePoint = { ...point, name: 'adult laying', lifeState: 'laying', expected: { speed: 0.4, maxStamina: 30 } };
    expect(checkWired(wired(), scaled)).toEqual([]);
  });

  it('fails when a wired stat has no live constant to hold it to', () => {
    // The stat is consumed but the point gives no number for it: the
    // check would otherwise pass without having checked anything.
    const missing: ReferencePoint = { ...point, expected: { speed: 1 } };
    expect(checkWired(wired(), missing)).toEqual([
      'bodies at "adult alate": wired stat "maxStamina" has no live constant in the reference point',
    ]);
  });

  it('fails when the data has drifted from the game, and reports every drift at once', () => {
    const drifted: ReferencePoint = { ...point, expected: { speed: 1.2, maxStamina: 6 } };
    const problems = checkWired(wired(), drifted);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/"speed" is 1 in the data but 1.2 in the game/);
    expect(problems[1]).toMatch(/"maxStamina" is 30 in the data but 6 in the game/);
  });

  it('fails when the game has a constant for a stat the list does not claim — the list is stale', () => {
    const stale: ReferencePoint = { ...point, expected: { ...point.expected, mass: 14 } };
    expect(checkWired(wired(), stale)).toEqual([
      'bodies at "adult alate": the game has a constant for "mass" but it is not in WIRED',
    ]);
  });

  it('fails when nothing is wired or the reference entry is missing', () => {
    expect(checkWired(bodies(), point)).toEqual([
      'bodies at "adult alate": nothing is wired, so there is nothing for the reference point to hold',
    ]);
    expect(checkWired(wired(), { ...point, id: 'major' })).toEqual([
      'bodies at "adult alate": no entry "major" to check against',
    ]);
  });

  it('reports an undeclared life state at the point as a problem rather than throwing', () => {
    const typo: ReferencePoint = { ...point, lifeState: 'foundng' };
    const problems = checkWired(wired(), typo);
    expect(problems).toHaveLength(2);
    for (const problem of problems) expect(problem).toMatch(/no such life state "foundng"/);
  });

  it('honours the tolerance', () => {
    const near: ReferencePoint = { ...point, expected: { speed: 1.0000001, maxStamina: 30 } };
    expect(checkWired(wired(), near)).toHaveLength(1);
    expect(checkWired(wired(), { ...near, tolerance: 1e-6 })).toEqual([]);
  });
});
