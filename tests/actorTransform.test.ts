/**
 * The pure step on a flat plane: intent in, a new state out. Sim dt
 * only — the clock clamps, this does not.
 */
import { describe, expect, it } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import { isActorState, type ActorState } from '../src/actor/ActorState';
import { DEBUG_CAPSULE_TUNING, type CapsuleTuning } from '../src/actor/CapsuleTuning';
import { playerId } from '../src/actor/PlayerId';
import { step, wrapHeading } from '../src/actor/Transform';
import { NEUTRAL_INTENT } from '../src/input/Intent';
import { world } from '../src/world/coords';

const TUNING: CapsuleTuning = { walkSpeed: 10, sprintFactor: 2, turnRate: Math.PI };

const capsule = (heading = 0): ActorState => ({
  id: actorId('a1'),
  kind: 'capsule',
  owner: playerId('device-1'),
  at: world(100, 200),
  height: 0,
  heading,
  color: '#ff8800',
  name: 'Ant',
});

describe('Transform.step', () => {
  it('stands still on a neutral intent and returns a fresh state', () => {
    const before = capsule();
    const after = step(before, NEUTRAL_INTENT, 0.5, TUNING);
    expect(after).not.toBe(before);
    expect(after.at).toEqual({ wx: 100, wz: 200 });
    expect(after.heading).toBe(0);
    expect(before.at).toEqual({ wx: 100, wz: 200 });
  });

  it('integrates forward along (sin h, cos h) at walkSpeed × dt', () => {
    // Heading 0 faces +wz.
    const ahead = step(capsule(0), { ...NEUTRAL_INTENT, forward: 1 }, 0.5, TUNING);
    expect(ahead.at.wx).toBeCloseTo(100, 9);
    expect(ahead.at.wz).toBeCloseTo(205, 9);
    // Heading π/2 faces +wx.
    const east = step(capsule(Math.PI / 2), { ...NEUTRAL_INTENT, forward: 1 }, 1, TUNING);
    expect(east.at.wx).toBeCloseTo(110, 9);
    expect(east.at.wz).toBeCloseTo(200, 9);
  });

  it('strafes to the right of the heading', () => {
    // Facing +wz, right is +wx.
    const right = step(capsule(0), { ...NEUTRAL_INTENT, strafe: 1 }, 1, TUNING);
    expect(right.at.wx).toBeCloseTo(110, 9);
    expect(right.at.wz).toBeCloseTo(200, 9);
  });

  it('sprint doubles the distance covered', () => {
    const walk = step(capsule(), { ...NEUTRAL_INTENT, forward: 1 }, 1, TUNING);
    const sprint = step(capsule(), { ...NEUTRAL_INTENT, forward: 1, sprint: true }, 1, TUNING);
    expect(sprint.at.wz - 200).toBeCloseTo(2 * (walk.at.wz - 200), 9);
    expect(DEBUG_CAPSULE_TUNING.sprintFactor).toBe(2);
  });

  it('caps a diagonal request at one pace, not 1.41 of them', () => {
    const diagonal = step(capsule(), { ...NEUTRAL_INTENT, forward: 1, strafe: 1 }, 1, TUNING);
    expect(Math.hypot(diagonal.at.wx - 100, diagonal.at.wz - 200)).toBeCloseTo(10, 9);
    const half = step(capsule(), { ...NEUTRAL_INTENT, forward: 0.5 }, 1, TUNING);
    expect(half.at.wz - 200).toBeCloseTo(5, 9);
  });

  it('turns by turn × turnRate × dt, clockwise for positive turn', () => {
    const turned = step(capsule(0), { ...NEUTRAL_INTENT, turn: 0.5 }, 0.5, TUNING);
    expect(turned.heading).toBeCloseTo(Math.PI / 4, 9);
    // Turning is applied before the move, so a turn-and-walk goes the new way.
    const both = step(capsule(0), { ...NEUTRAL_INTENT, turn: 1, forward: 1 }, 0.5, TUNING);
    expect(both.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(both.at.wx).toBeCloseTo(105, 9);
  });

  it('wraps the heading into (-π, π]', () => {
    const spun = step(capsule(Math.PI - 0.1), { ...NEUTRAL_INTENT, turn: 1 }, 0.2, TUNING);
    expect(spun.heading).toBeCloseTo(-Math.PI + 0.1 + 0.2 * Math.PI - 0.2, 6);
    expect(spun.heading).toBeLessThanOrEqual(Math.PI);
    expect(spun.heading).toBeGreaterThan(-Math.PI);
    expect(wrapHeading(Math.PI)).toBe(Math.PI);
    expect(wrapHeading(-Math.PI)).toBe(Math.PI);
    expect(wrapHeading(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapHeading(-2.5 * Math.PI)).toBeCloseTo(-Math.PI / 2, 9);
    // Still a valid ActorState after the wrap: the snapshot guard range-checks heading.
    expect(isActorState(spun)).toBe(true);
  });

  it('clamps an out-of-range intent before using it', () => {
    const over = step(capsule(), { forward: 5, strafe: 0, turn: 0, sprint: false }, 1, TUNING);
    expect(over.at.wz - 200).toBeCloseTo(10, 9);
  });
});
