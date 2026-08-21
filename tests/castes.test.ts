import { describe, expect, it } from 'vitest';
import {
  CASTES, curveOf, GROWTH_STAGES, LIVE_GROWTH, LIVE_STATE, MALE, QUEEN,
  QUEEN_STATES, sample, statOf, WIRED, type Curve, type LifeState,
} from '../src/ant/castes';
import { RECOVER_SECONDS, RESTING_BONUS, SPRINT_SECONDS } from '../src/ant/stamina';

const tables = () => [QUEEN.attributes, QUEEN.multipliers, QUEEN.combat, QUEEN.flight];
const every = (): Array<[string, Curve]> =>
  tables().flatMap((table) => Object.entries(table));
const states = (): Array<[string, LifeState]> => Object.entries(QUEEN.states!);
const state = (name: string): LifeState => QUEEN.states![name];

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

  it('names all five growth stages, so a curve point means something', () => {
    expect(GROWTH_STAGES).toHaveLength(5);
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

describe('finding a stat', () => {
  it('reaches into every table, not just attributes', () => {
    expect(curveOf(QUEEN, 'bodyLength')).toBe(QUEEN.attributes.bodyLength);
    expect(curveOf(QUEEN, 'stingDamage')).toBe(QUEEN.combat.stingDamage);
    expect(curveOf(QUEEN, 'flightSpeed')).toBe(QUEEN.flight.flightSpeed);
    expect(curveOf(QUEEN, 'incomingDamage.resting'))
      .toBe(QUEEN.multipliers['incomingDamage.resting']);
  });

  it('throws on a name it does not have, rather than handing back NaN', () => {
    // A typo would otherwise surface as a speed of zero somewhere far
    // from the line that caused it.
    expect(() => curveOf(QUEEN, 'wingspan')).toThrow(/wingspan/);
  });
});

describe('the two axes', () => {
  it('multiplies the body by what she is doing with it', () => {
    const body = sample(QUEEN.attributes.speed, 0.5);
    const scale = state('matureColony').scale.speed!;
    expect(statOf(QUEEN, 'speed', 0.5, state('matureColony')))
      .toBeCloseTo(body * scale, 9);
  });

  it('leaves a stat the state says nothing about alone', () => {
    // The scale tables list what a state CHANGES; silence means 1.
    expect(state('alateMated').scale.bodyLength).toBeUndefined();
    expect(statOf(QUEEN, 'bodyLength', 0.4, state('alateMated')))
      .toBeCloseTo(sample(QUEEN.attributes.bodyLength, 0.4), 9);
  });

  it('reads the body alone when no state is given', () => {
    expect(statOf(QUEEN, 'mass', 1)).toBe(QUEEN.attributes.mass[4]);
  });

  it('scales by finite, non-negative numbers only', () => {
    for (const [name, life] of states()) {
      for (const [stat, value] of Object.entries(life.scale)) {
        expect(Number.isFinite(value), `${name}.${stat}`).toBe(true);
        expect(value, `${name}.${stat}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('scales only stats that exist — a typo here would be silent', () => {
    for (const [name, life] of states()) {
      for (const stat of Object.keys(life.scale)) {
        expect(() => curveOf(QUEEN, stat), `${name}.${stat}`).not.toThrow();
      }
    }
  });
});

describe('growth is a body getting bigger', () => {
  it('starts small enough to read as a different animal', () => {
    const [young, , , , adult] = QUEEN.attributes.bodyLength;
    expect(young).toBe(5.5);
    expect(adult).toBe(10);
  });

  it('grows fastest early, where the player is looking hardest', () => {
    const mm = QUEEN.attributes.bodyLength;
    for (let i = 1; i < 4; i++) {
      expect(mm[i] - mm[i - 1], `step ${i}`).toBeGreaterThan(mm[i + 1] - mm[i]);
    }
  });

  it('never shrinks with growth — that is what the states are for', () => {
    for (const stat of ['bodyLength', 'mass', 'maxHealth'] as const) {
      const curve = QUEEN.attributes[stat];
      for (let i = 1; i < 5; i++) {
        expect(curve[i], `${stat} at ${i}`).toBeGreaterThanOrEqual(curve[i - 1]);
      }
    }
  });

  it('stops growing once she is adult', () => {
    expect(QUEEN.attributes.growthPerSecond[4]).toBe(0);
  });
});

describe('the life states are where her story is', () => {
  it('names every state in QUEEN_STATES, and no others', () => {
    expect(Object.keys(QUEEN.states!).sort())
      .toEqual([...QUEEN_STATES].sort());
  });

  it('sheds her wings at founding and never gets them back', () => {
    expect(state('alateUnmated').winged).toBe(true);
    expect(state('alateMated').winged).toBe(true);
    for (const name of ['founding', 'firstBrood', 'established', 'matureColony']) {
      expect(state(name).winged, name).toBe(false);
    }
  });

  it('grounds her flight stats the moment the wings go', () => {
    // Not merely "she has no wings" in prose: the numbers have to say
    // it too, or flight arrives able to launch a laying queen.
    for (const name of ['founding', 'firstBrood', 'established', 'matureColony']) {
      for (const stat of Object.keys(QUEEN.flight)) {
        expect(statOf(QUEEN, stat, 1, state(name)), `${name}.${stat}`).toBe(0);
      }
    }
  });

  it('loses her a third of her mass founding, then feeds her back up', () => {
    // The flight muscles are the larder: there is no other food in a
    // sealed chamber.
    const alate = statOf(QUEEN, 'mass', 1, state('alateMated'));
    const sealed = statOf(QUEEN, 'mass', 1, state('founding'));
    const mature = statOf(QUEEN, 'mass', 1, state('matureColony'));
    expect(sealed).toBeLessThan(alate * 0.75);
    expect(mature).toBeGreaterThan(alate);
  });

  it('starves nothing while she is sealed in — and only then', () => {
    // The old file wrote this zero at a curve index and landed it on
    // the wrong stage. It belongs to the STATE, where it cannot drift.
    expect(statOf(QUEEN, 'hungerRate', 1, state('founding'))).toBe(0);
    expect(statOf(QUEEN, 'thirstRate', 1, state('founding'))).toBe(0);
    for (const name of ['alateMated', 'firstBrood', 'established', 'matureColony']) {
      expect(statOf(QUEEN, 'hungerRate', 1, state(name)), name).toBeGreaterThan(0);
    }
  });

  it('gets slower with every state after the flight', () => {
    const walk = ['alateUnmated', 'alateMated', 'founding', 'established', 'matureColony']
      .map((name) => statOf(QUEEN, 'speed', 1, state(name)));
    // firstBrood is left out on purpose: she picks up a little once the
    // workers are feeding her, so the fall is not strictly monotonic.
    for (let i = 1; i < walk.length; i++) {
      expect(walk[i], QUEEN_STATES[i]).toBeLessThan(walk[i - 1]);
    }
  });

  it('lays nothing before the chamber, and a colony`s worth after', () => {
    expect(statOf(QUEEN, 'eggsPerDay', 1, state('alateUnmated'))).toBe(0);
    expect(statOf(QUEEN, 'eggsPerDay', 1, state('alateMated'))).toBe(0);
    // She does lay in the sealed chamber — that is the point of it —
    // but a handful, on borrowed tissue.
    const founding = statOf(QUEEN, 'eggsPerDay', 1, state('founding'));
    expect(founding).toBeGreaterThan(0);
    expect(founding).toBeLessThan(50);
    expect(statOf(QUEEN, 'eggsPerDay', 1, state('matureColony')))
      .toBeGreaterThan(1000);
  });

  it('stops being able to haul or dig once the colony carries her', () => {
    expect(statOf(QUEEN, 'carry', 1, state('matureColony'))).toBe(0);
    expect(statOf(QUEEN, 'dig', 1, state('matureColony'))).toBe(0);
  });

  it('gets easier to kill at rest the more she is worth', () => {
    const risk = (name: string) => statOf(QUEEN, 'incomingDamage.resting', 1, state(name));
    expect(risk('matureColony')).toBeGreaterThan(risk('alateMated'));
  });
});

describe('she is a fire ant', () => {
  it('stings harder than she bites, at every size', () => {
    for (let i = 0; i < 5; i++) {
      expect(QUEEN.combat.stingDamage[i]).toBeGreaterThan(QUEEN.combat.biteDamage[i]);
    }
  });

  it('and in every state, since both scale together or not at all', () => {
    for (const [name] of states()) {
      expect(statOf(QUEEN, 'stingDamage', 1, state(name)), name)
        .toBeGreaterThan(statOf(QUEEN, 'biteDamage', 1, state(name)));
    }
  });
});

describe('what is wired', () => {
  it('names only stats that actually exist in the tables', () => {
    for (const name of WIRED) expect(() => curveOf(QUEEN, name), name).not.toThrow();
  });

  it('meets the live constants exactly at the reference point', () => {
    // If these drift apart, the data file is quietly lying about the
    // game rather than describing it. The point is NAMED rather than
    // indexed on purpose — an index means whatever the array drifted to.
    const live = state(LIVE_STATE);
    expect(statOf(QUEEN, 'maxStamina', LIVE_GROWTH, live)).toBeCloseTo(SPRINT_SECONDS, 6);
    expect(statOf(QUEEN, 'staminaRecovery', LIVE_GROWTH, live))
      .toBeCloseTo(1 / RECOVER_SECONDS, 3);
    expect(statOf(QUEEN, 'speed', LIVE_GROWTH, live)).toBe(1);
    expect(statOf(QUEEN, 'sprintSpeed', LIVE_GROWTH, live)).toBe(1);
    expect(statOf(QUEEN, 'staminaRecovery.resting', LIVE_GROWTH, live))
      .toBeCloseTo(RESTING_BONUS, 6);
    expect(statOf(QUEEN, 'staminaRecovery.sprinting', LIVE_GROWTH, live)).toBe(0);
  });

  it('leaves the reference state scaling nothing it is wired to', () => {
    // The whole value of a reference point is that it is unscaled.
    for (const name of WIRED) {
      expect(state(LIVE_STATE).scale[name], name).toBeUndefined();
    }
  });
});

describe('the rest of the colony', () => {
  it('declares the other two castes empty, rather than quietly missing', () => {
    // A missing key reads as an oversight; an explicit null reads as
    // "next", which is what it is.
    expect(Object.keys(CASTES).sort()).toEqual(['major', 'queen', 'worker']);
    expect(CASTES.worker).toBeNull();
    expect(CASTES.major).toBeNull();
  });

  it('keeps the male out of the caste list — he is a sex, not a job', () => {
    expect(Object.keys(CASTES)).not.toContain('male');
    expect(MALE.sex).toBe('male');
    expect(MALE.stats).toBeNull();
  });
});
