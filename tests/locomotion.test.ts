import { describe, expect, it } from 'vitest';
import { resolve, type Demand } from '../src/ant/locomotion';
import { PACE_SPEED, REVERSE_CAP, SPRINT_SPEED, type Pace } from '../src/ant/pace';

function ask(over: Partial<Demand> = {}) {
  return resolve({
    stick: { x: 0, y: 0 },
    pace: 'walk',
    sprinting: false,
    auto: 0,
    ...over,
  });
}

const push = (y: number, x = 0) => ({ stick: { x, y } });

describe('the pace is a ceiling, not propulsion', () => {
  it('does not move her when the stick is centred', () => {
    // The whole reason the telegraph was scrapped: selecting WALK must
    // not make her walk.
    for (const pace of ['crawl', 'walk', 'run'] as Pace[]) {
      expect(ask({ pace }).speed).toBe(0);
    }
  });

  it('gives full speed only at a full push', () => {
    expect(ask({ ...push(1), pace: 'walk' }).ahead).toBeCloseTo(PACE_SPEED.walk, 6);
  });

  it('is slower at half a push than at a full one', () => {
    const half = ask({ ...push(0.5), pace: 'walk' }).ahead;
    const full = ask({ ...push(1), pace: 'walk' }).ahead;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it('spends the whole stick inside whichever pace is chosen', () => {
    // Same push, three ceilings — this is the point of the redesign.
    const at = (pace: Pace) => ask({ ...push(0.5), pace }).ahead;
    expect(at('crawl')).toBeCloseTo(PACE_SPEED.crawl / 2, 6);
    expect(at('walk')).toBeCloseTo(PACE_SPEED.walk / 2, 6);
    expect(at('run')).toBeCloseTo(PACE_SPEED.run / 2, 6);
  });
});

describe('reverse', () => {
  it('backs her up', () => {
    expect(ask(push(-1)).ahead).toBeLessThan(0);
  });

  it('is slower than going forward at the same pace', () => {
    const ahead = ask({ ...push(1), pace: 'run' }).ahead;
    const astern = Math.abs(ask({ ...push(-1), pace: 'run' }).ahead);
    expect(astern).toBeLessThan(ahead);
  });

  it('never exceeds a reverse walk, however high the pace', () => {
    for (const pace of ['crawl', 'walk', 'run'] as Pace[]) {
      expect(Math.abs(ask({ ...push(-1), pace }).ahead)).toBeLessThanOrEqual(REVERSE_CAP);
    }
  });

  it('cannot be sprinted', () => {
    const astern = Math.abs(ask({ ...push(-1), pace: 'run', sprinting: true }).ahead);
    expect(astern).toBeLessThanOrEqual(REVERSE_CAP);
  });
});

describe('sideways', () => {
  it('comes out across the view, not as a turn', () => {
    const travel = ask(push(0, 1));
    expect(travel.across).toBeGreaterThan(0);
    expect(travel.ahead).toBe(0);
  });

  it('goes the other way on a left push', () => {
    expect(ask(push(0, -1)).across).toBeLessThan(0);
  });

  it('is slower than striding forward', () => {
    expect(Math.abs(ask(push(0, 1)).across)).toBeLessThan(ask(push(1)).ahead);
  });
});

describe('sprint', () => {
  it('raises the ceiling rather than adding a gear', () => {
    expect(ask({ ...push(1), pace: 'run', sprinting: true }).ahead)
      .toBeCloseTo(SPRINT_SPEED, 6);
  });

  it('still does nothing with the stick centred', () => {
    expect(ask({ sprinting: true }).speed).toBe(0);
  });
});

describe('auto', () => {
  it('supplies the forward push itself', () => {
    expect(ask({ auto: 1, pace: 'run' }).ahead).toBeCloseTo(PACE_SPEED.run, 6);
  });

  it('can still be pushed sideways under the player', () => {
    expect(ask({ auto: 1, ...push(0, 1) }).across).toBeGreaterThan(0);
  });

  it('hauls her backwards when it is turned round', () => {
    // Dragging something is walked backwards, and it goes through the
    // same reverse cap — a locked haul is never a reverse sprint.
    const back = ask({ auto: -1, pace: 'run', sprinting: true });
    expect(back.ahead).toBeLessThan(0);
    expect(Math.abs(back.ahead)).toBeLessThanOrEqual(REVERSE_CAP);
  });

  it('falls back to the sustainable pace when a sprint is spent', () => {
    // The exhausted case: sprinting goes false, she keeps travelling.
    const spent = ask({ auto: 1, pace: 'run', sprinting: false });
    expect(spent.ahead).toBeCloseTo(PACE_SPEED.run, 6);
    expect(spent.speed).toBeGreaterThan(0);
  });
});

describe('going two ways at once', () => {
  it('never outruns the ceiling on a diagonal', () => {
    const travel = ask({ ...push(1, 1), pace: 'walk' });
    expect(travel.speed).toBeLessThanOrEqual(PACE_SPEED.walk + 1e-9);
  });
});
