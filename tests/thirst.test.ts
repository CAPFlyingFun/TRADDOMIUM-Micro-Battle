import { describe, expect, it } from 'vitest';
import { DRINK_RATE, Thirst } from '../src/ant/thirst';
import { QUEEN, liveStat, statOf } from '../src/ant/castes';

describe('the thirst that finally moves', () => {
  it('drains the LIVE queen at exactly the table rate', () => {
    // The live state is alateMated, whose thirstRate scale is silent —
    // scale one. The founding state will zero it when the life cycle
    // arrives; today's queen is the flying one, and she gets thirsty.
    const thirst = new Thirst();
    expect(thirst.fraction).toBe(1);
    const perSecond = liveStat('thirstRate') / liveStat('maxThirst');
    expect(perSecond).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) thirst.update(false, 0.1);
    expect(thirst.fraction).toBeCloseTo(1 - perSecond * 60, 4);
  });

  it('will not drain a FOUNDING queen, when that state goes live', () => {
    // Sealed in her chamber, living off her own body: the table zeroes
    // her thirstRate, so the drain the Thirst class computes is zero.
    // Asserted against the TABLE, because the live-state constant is
    // one edit and this must survive it.
    const founding = statOf(QUEEN, 'thirstRate', 1, QUEEN.states!.founding);
    expect(founding).toBe(0);
  });

  it('takes about half an hour to run dry, which is a game, not a timer', () => {
    const perSecond = liveStat('thirstRate') / liveStat('maxThirst');
    const minutes = 1 / perSecond / 60;
    expect(minutes).toBeGreaterThan(20);
    expect(minutes).toBeLessThan(60);
  });

  it('refills empty-to-full in five held seconds', () => {
    const thirst = new Thirst();
    for (let i = 0; i < 20_000; i++) thirst.update(false, 10);
    expect(thirst.parched).toBe(true);
    let held = 0;
    while (thirst.fraction < 1 && held < 20) {
      thirst.update(true, 1 / 60);
      held += 1 / 60;
    }
    expect(held).toBeCloseTo(1 / DRINK_RATE, 0);
  });

  it('is frame-rate independent both ways', () => {
    const at30 = new Thirst();
    const at120 = new Thirst();
    for (let i = 0; i < 30 * 40; i++) at30.update(false, 1 / 30);
    for (let i = 0; i < 120 * 40; i++) at120.update(false, 1 / 120);
    expect(at30.fraction).toBeCloseTo(at120.fraction, 4);
    const drink30 = new Thirst();
    const drink120 = new Thirst();
    for (let i = 0; i < 20_000; i++) { drink30.update(false, 10); drink120.update(false, 10); }
    for (let i = 0; i < 30 * 2; i++) drink30.update(true, 1 / 30);
    for (let i = 0; i < 120 * 2; i++) drink120.update(true, 1 / 120);
    expect(drink30.fraction).toBeCloseTo(drink120.fraction, 4);
  });

  it('never leaves the bar', () => {
    const thirst = new Thirst();
    for (let i = 0; i < 100; i++) thirst.update(true, 10);
    expect(thirst.fraction).toBe(1);
    for (let i = 0; i < 100_000; i++) thirst.update(false, 10);
    expect(thirst.fraction).toBe(0);
    thirst.refill();
    expect(thirst.fraction).toBe(1);
  });
});
