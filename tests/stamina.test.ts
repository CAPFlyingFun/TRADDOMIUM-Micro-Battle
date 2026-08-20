import { describe, expect, it } from 'vitest';
import {
  REARM_AT, RECOVER_SECONDS, SPRINT_SECONDS, Stamina,
} from '../src/ant/stamina';

const DT = 1 / 60;

/** Run the bar for a while and report where it ends up. */
function run(stamina: Stamina, sprinting: boolean, resting: boolean, seconds: number) {
  let ranOut = false;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (stamina.update(sprinting, resting, DT)) ranOut = true;
  }
  return ranOut;
}

describe('the cost of a sprint', () => {
  it('starts full', () => {
    expect(new Stamina().fraction).toBe(1);
  });

  it('buys about the sprint it promises', () => {
    const stamina = new Stamina();
    expect(run(stamina, true, false, SPRINT_SECONDS - 0.5)).toBe(false);
    expect(stamina.fraction).toBeGreaterThan(0);
    expect(run(stamina, true, false, 1)).toBe(true);
    expect(stamina.fraction).toBe(0);
  });

  it('says when it runs out, once, so she eases off', () => {
    const stamina = new Stamina();
    run(stamina, true, false, SPRINT_SECONDS + 1);
    expect(stamina.spent).toBe(true);
  });

  it('comes back on its own — the bar has a way up as well as down', () => {
    // The project rule: a bar may only move if there is a way to move
    // it back. Nothing here needs an item or a mechanic that does not
    // exist yet.
    const stamina = new Stamina();
    run(stamina, true, false, SPRINT_SECONDS + 1);
    run(stamina, false, false, RECOVER_SECONDS + 1);
    expect(stamina.fraction).toBe(1);
    expect(stamina.spent).toBe(false);
  });

  it('catches her breath faster standing still', () => {
    const moving = new Stamina();
    const resting = new Stamina();
    run(moving, true, false, SPRINT_SECONDS + 1);
    run(resting, true, false, SPRINT_SECONDS + 1);
    run(moving, false, false, 3);
    run(resting, false, true, 3);
    expect(resting.fraction).toBeGreaterThan(moving.fraction);
  });

  it('will not let her sprint again on fumes', () => {
    // Otherwise an empty bar stutters in and out of a sprint.
    const stamina = new Stamina();
    run(stamina, true, false, SPRINT_SECONDS + 1);
    run(stamina, false, false, RECOVER_SECONDS * REARM_AT * 0.5);
    expect(stamina.spent).toBe(true);
    run(stamina, false, false, RECOVER_SECONDS * REARM_AT);
    expect(stamina.spent).toBe(false);
  });

  it('never overfills or goes negative', () => {
    const stamina = new Stamina();
    run(stamina, false, true, 60);
    expect(stamina.fraction).toBe(1);
    run(stamina, true, false, 60);
    expect(stamina.fraction).toBe(0);
  });
});
