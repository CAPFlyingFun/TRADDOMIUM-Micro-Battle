import { describe, expect, it } from 'vitest';
import { BIRTH_TIMING, birthAt, birthLength, birthLine, birthPlan, cervixLine, REALISTIC_STRETCH, TURN_DEG } from '../src/sarahlab/birthSequence';

describe('birth timeline', () => {
  const P = birthPlan();
  it('runs labour, pushing, crowning, birth, after in order', () => {
    expect(birthAt(1).stage).toBe('labour');
    expect(birthAt(P.pushing + 1).stage).toBe('pushing');
    expect(birthAt(P.crowning + 1).stage).toBe('crowning');
    expect(birthAt(P.birth + 0.5).stage).toBe('birth');
    expect(birthAt(P.total + 1).stage).toBe('after');
  });
  it('opens her cervix to ten centimetres through labour, and only then does the head come down', () => {
    expect(birthAt(0).cervix).toBeCloseTo(BIRTH_TIMING.cervixFrom, 5);
    expect(birthAt(P.pushing - 0.01).cervix).toBeGreaterThan(0.98);
    for (let t = 0; t < P.pushing; t += 0.5) expect(birthAt(t).down).toBe(0);
  });
  it('the head comes down with each push and slips back a little between, never past its last step', () => {
    let peak = 0, slipped = false;
    for (let t = P.pushing; t < P.crowning; t += 0.1) {
      const d = birthAt(t).down;
      if (d < peak - 1e-4) slipped = true;
      peak = Math.max(peak, d);
    }
    expect(slipped).toBe(true);
    expect(peak).toBeLessThanOrEqual(BIRTH_TIMING.pushReach + 1e-6);
    expect(birthAt(P.birth - 0.01).down).toBeGreaterThan(0.99);
  });
  it('turns the head round to her side coming down, all of it before her opening, and not at all once out', () => {
    expect(birthAt(P.pushing).turnDeg).toBeCloseTo(45, 3);
    for (let t = P.pushing; t <= P.total; t += 0.05) {
      const m = birthAt(t);
      // (inside her, still short of her opening -- its middle three quarters of the way -- the turn is done)
      if (m.down >= 0.75) expect(Math.abs(m.turnDeg - TURN_DEG.born)).toBeLessThan(1e-6);
    }
  });
  it('REALISTIC is the same birth, slower', () => {
    expect(birthLength('realistic')).toBeCloseTo(birthLength('fast') * REALISTIC_STRETCH, 6);
    expect(birthAt(P.crowning * REALISTIC_STRETCH + 1, 'realistic').stage).toBe('crowning');
  });
  it('says where she is', () => {
    expect(birthLine(null)).toBe('BIRTH · not started');
    expect(birthLine(birthAt(0))).toBe('BIRTH · labour · Cervix 1.0 cm · not yet');
    expect(birthLine(birthAt(birthPlan().pushing + 0.01), 2.7)).toBe('BIRTH · pushing · Cervix 10.0 cm · ready to push · Opening 2.7 cm');
    expect(cervixLine(0.27)).toBe('Cervix 2.7 cm · not yet');
  });
});
