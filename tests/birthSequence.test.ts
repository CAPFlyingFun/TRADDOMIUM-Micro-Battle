import { describe, expect, it } from 'vitest';
import { BIRTH_TIMING, birthAt, birthLength, birthLine, birthPlan, cervixLine, REALISTIC_STRETCH, TURN_DEG } from '../src/sarahlab/birthSequence';

describe('birth timeline', () => {
  const P = birthPlan();
  it('runs labour, pushing, crowning, birth, after in order', () => {
    expect(birthAt(1).stage).toBe('labour');
    expect(birthAt(P.pushing + 1).stage).toBe('pushing');
    expect(birthAt(P.crowning + 1).stage).toBe('crowning');
    expect(birthAt(P.birth + 0.5).stage).toBe('birth');
    expect(birthAt(P.after + 1).stage).toBe('after');
    expect(birthAt(P.placenta + 0.1).stage).toBe('afterbirth');
    expect(birthAt(P.total + 1).stage).toBe('afterbirth');
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
  it('cuts its cord on its own a while after it is settled on her, and the placenta follows a while after the cut', () => {
    const onHer = P.after + 0.5 + BIRTH_TIMING.toHer;
    expect(P.cut).toBeCloseTo(onHer + BIRTH_TIMING.cutAfter, 6);
    expect(birthAt(P.cut - 0.01).cut).toBe(false);
    expect(birthAt(P.cut + 0.01).cut).toBe(true);
    expect(birthAt(P.cut + 0.01).cutAt).toBeCloseTo(P.cut, 6);
    expect(P.placenta).toBeCloseTo(P.cut + BIRTH_TIMING.placentaAfterCut, 6);
    expect(birthAt(P.placenta - 0.01).placentaFor).toBeLessThan(0);
    expect(birthAt(P.placenta - 0.01).separate).toBe(0);
    // the whole timeline reaches past the placenta into its bowl and her womb settled after it
    expect(P.total).toBeGreaterThan(P.placentaOut + BIRTH_TIMING.placentaBowl);
    expect(birthAt(P.total).bowl).toBe(1);
    expect(birthAt(P.total).afterbirth).toBeCloseTo(1, 6);
  });
  it('CUT CORD and DELIVER PLACENTA are moments on the clock: sooner, never before they can be', () => {
    const navel = P.navelOut;
    // (a cut asked for before its navel is out waits for it; one asked for later than its own time is its own time)
    expect(birthPlan({ cutAt: navel - 5 }).cut).toBeCloseTo(navel, 6);
    expect(birthPlan({ cutAt: P.cut + 30 }).cut).toBeCloseTo(P.cut, 6);
    const at = navel + 2, Q = birthPlan({ cutAt: at });
    expect(Q.cut).toBeCloseTo(at, 6);
    expect(birthAt(at - 0.01, 'fast', { cutAt: at }).cut).toBe(false);
    expect(birthAt(at + 0.01, 'fast', { cutAt: at }).cut).toBe(true);
    // (the placenta follows its own time after the sooner cut; asked for sooner still, it starts then -- never before the cut)
    expect(Q.placenta).toBeCloseTo(at + BIRTH_TIMING.placentaAfterCut, 6);
    expect(birthPlan({ cutAt: at, placentaAt: at + 1 }).placenta).toBeCloseTo(at + 1, 6);
    expect(birthPlan({ cutAt: at, placentaAt: at - 3 }).placenta).toBeCloseTo(at, 6);
    // (REALISTIC: the same moments, five times the seconds)
    expect(birthAt((at + 0.01) * REALISTIC_STRETCH, 'realistic', { cutAt: at }).cut).toBe(true);
  });
  it('the placenta peels off, comes down her canal and out, into the bowl -- each only forward -- with mild contractions', () => {
    let was = { separate: 0, down: 0, bowl: 0, after: 0 }, squeezed = 0;
    for (let t = P.placenta; t <= P.total; t += 0.05) {
      const m = birthAt(t);
      expect(m.separate).toBeGreaterThanOrEqual(was.separate - 1e-9);
      expect(m.placentaDown).toBeGreaterThanOrEqual(was.down - 1e-9);
      expect(m.bowl).toBeGreaterThanOrEqual(was.bowl - 1e-9);
      expect(m.afterbirth).toBeGreaterThanOrEqual(was.after - 1e-9);
      // (it starts down her canal only once it has peeled off, and into the bowl only once it is out of her)
      if (m.placentaDown > 0) expect(m.separate).toBeCloseTo(1, 6);
      if (m.bowl > 0) expect(m.placentaDown).toBeCloseTo(2, 6);
      squeezed = Math.max(squeezed, m.contraction);
      was = { separate: m.separate, down: m.placentaDown, bowl: m.bowl, after: m.afterbirth };
    }
    expect(squeezed).toBeGreaterThan(0.3);
    expect(squeezed).toBeLessThanOrEqual(BIRTH_TIMING.placentaSqueeze + 1e-9);
    expect(was.down).toBe(2);
  });
  it('says where she is', () => {
    expect(birthLine(null)).toBe('BIRTH · not started');
    expect(birthLine(birthAt(0))).toBe('BIRTH · labour · Cervix 1.0 cm · not yet');
    expect(birthLine(birthAt(birthPlan().pushing + 0.01), 2.7)).toBe('BIRTH · pushing · Cervix 10.0 cm · ready to push · Opening 2.7 cm');
    expect(cervixLine(0.27)).toBe('Cervix 2.7 cm · not yet');
  });
});
