import { describe, expect, it } from 'vitest';
import {
  CASTES, QUEEN, sample, WIRED, type Curve,
} from '../src/ant/castes';
import { RECOVER_SECONDS, RESTING_BONUS, SPRINT_SECONDS } from '../src/ant/stamina';

const tables = () => [QUEEN.attributes, QUEEN.multipliers, QUEEN.combat];
const every = (): Array<[string, Curve]> =>
  tables().flatMap((table) => Object.entries(table));

describe('the curve format', () => {
  it('gives every stat five points, like the file it copies', () => {
    for (const [name, curve] of every()) {
      expect(curve, name).toHaveLength(5);
    }
  });

  it('holds only real numbers — a NaN here poisons a whole system', () => {
    for (const [name, curve] of every()) {
      for (const value of curve) expect(Number.isFinite(value), name).toBe(true);
    }
  });

  it('names all five stages, so a curve point means something', () => {
    expect(QUEEN.stages).toHaveLength(5);
    for (const stage of QUEEN.stages) expect(stage.length).toBeGreaterThan(0);
  });
});

describe('sampling a curve', () => {
  it('lands on the points themselves at the ends', () => {
    expect(sample([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(sample([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it('walks straight between them', () => {
    expect(sample([0, 10, 20, 30, 40], 0.5)).toBeCloseTo(20, 6);
    expect(sample([0, 10, 20, 30, 40], 0.125)).toBeCloseTo(5, 6);
  });

  it('never overshoots the points either side', () => {
    // The reason for straight lines rather than a spline: a stat that
    // dips below both its neighbours is a bug nobody looks for.
    const curve: Curve = [10, 0, 10, 0, 10];
    for (let g = 0; g <= 1; g += 0.01) {
      const at = sample(curve, g);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(10);
    }
  });

  it('clamps rather than extrapolating off the ends', () => {
    expect(sample([1, 2, 3, 4, 5], -3)).toBe(1);
    expect(sample([1, 2, 3, 4, 5], 99)).toBe(5);
  });
});

describe('the queen is not just a smaller adult', () => {
  it('gets SLOWER as she grows, which no size curve could say', () => {
    expect(sample(QUEEN.attributes.speed, 0))
      .toBeGreaterThan(sample(QUEEN.attributes.speed, 1));
  });

  it('loses mass founding, then gains it laying', () => {
    // The flight muscles are the larder: there is no other food in a
    // sealed chamber.
    const [alate, , sealed, , mature] = QUEEN.attributes.mass;
    expect(sealed).toBeLessThan(alate);
    expect(mature).toBeGreaterThan(alate);
  });

  it('starves nothing while she is sealed in', () => {
    // A hunger clock there would be a countdown with no way to answer
    // it, which is the one thing the project rule forbids.
    const founding = 2;
    expect(QUEEN.attributes.hungerRate[founding]).toBe(0);
    expect(QUEEN.attributes.thirstRate[founding]).toBe(0);
  });

  it('lays nothing before the chamber and a great deal after', () => {
    expect(QUEEN.attributes.eggsPerDay[0]).toBe(0);
    expect(QUEEN.attributes.eggsPerDay[4]).toBeGreaterThan(1000);
  });

  it('stops being able to haul', () => {
    expect(QUEEN.attributes.carry[4]).toBe(0);
  });

  it('gets easier to kill at rest the more she is worth', () => {
    const risk = QUEEN.multipliers['incomingDamage.resting'];
    expect(risk[4]).toBeGreaterThan(risk[0]);
  });

  it('stings harder than she bites — she is a fire ant', () => {
    for (let i = 0; i < 5; i++) {
      expect(QUEEN.combat.stingDamage[i]).toBeGreaterThan(QUEEN.combat.biteDamage[i]);
    }
  });
});

describe('what is wired', () => {
  it('names only stats that actually exist in the tables', () => {
    for (const name of WIRED) expect(QUEEN.attributes[name], name).toBeDefined();
  });

  it('agrees with the live stamina constants at full growth', () => {
    // If these drift apart, the data file is quietly lying about the
    // game rather than describing it.
    expect(QUEEN.multipliers['staminaRecovery.resting'][4]).toBeCloseTo(RESTING_BONUS, 6);
    expect(QUEEN.multipliers['staminaRecovery.sprinting'][4]).toBe(0);
    expect(QUEEN.attributes.staminaRecovery[4]).toBeCloseTo(1 / RECOVER_SECONDS, 2);
    expect(QUEEN.combat.sprintCostPerSecond[0]).toBeCloseTo(1 / SPRINT_SECONDS, 2);
  });
});

describe('the other two castes', () => {
  it('are declared but empty, rather than quietly missing', () => {
    // A missing key reads as an oversight; an explicit null reads as
    // "next", which is what it is.
    expect(Object.keys(CASTES).sort()).toEqual(['major', 'queen', 'worker']);
    expect(CASTES.worker).toBeNull();
    expect(CASTES.major).toBeNull();
  });
});
