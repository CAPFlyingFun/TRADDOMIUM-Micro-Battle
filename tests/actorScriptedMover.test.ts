/**
 * The bot's thumbs. Every intent it hands out is inside the contract,
 * and — driven through the real Transform.step — its circle closes and
 * its figure-eight crosses itself at the start.
 */
import { describe, expect, it } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { DEBUG_CAPSULE_TUNING, type CapsuleTuning } from '../src/actor/CapsuleTuning';
import { playerId } from '../src/actor/PlayerId';
import { ScriptedMover, pauseLeg, type Leg } from '../src/actor/ScriptedMover';
import { step } from '../src/actor/Transform';
import { circleRoute, figureEightRoute } from '../src/actor/routes';
import { NEUTRAL_INTENT, clampIntent, type Intent } from '../src/input/Intent';
import { world } from '../src/world/coords';

const SIXTY = 1 / 60;

const capsule = (): ActorState => ({
  id: actorId('bot'),
  kind: 'capsule',
  owner: playerId('bot-owner'),
  at: world(0, 0),
  height: 0,
  heading: 0,
  color: '#3ddc84',
  name: 'Bot',
});

/** Drive the real transform with the mover for `seconds`, returning every state visited. */
function drive(mover: ScriptedMover, seconds: number, tuning: CapsuleTuning, dt = SIXTY): ActorState[] {
  const states: ActorState[] = [];
  let state = capsule();
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    state = step(state, mover.next(dt), dt, tuning);
    states.push(state);
  }
  return states;
}

const last = <T>(list: readonly T[]): T => list[list.length - 1];

describe('ScriptedMover', () => {
  it('hands out only bounded intents, whatever the route said', () => {
    const wild: Leg[] = [
      { seconds: 0.5, intent: { forward: 7, strafe: -3, turn: Number.NaN, sprint: true } },
      { seconds: 0.25, intent: { forward: -0.5, strafe: 0.25, turn: 1.5, sprint: false } },
      pauseLeg(0.25),
    ];
    const mover = new ScriptedMover(wild);
    for (let i = 0; i < 600; i += 1) {
      const intent = mover.next(SIXTY);
      expect(intent).toEqual(clampIntent(intent));
      expect(Math.abs(intent.forward)).toBeLessThanOrEqual(1);
      expect(Math.abs(intent.strafe)).toBeLessThanOrEqual(1);
      expect(Math.abs(intent.turn)).toBeLessThanOrEqual(1);
      expect(typeof intent.sprint).toBe('boolean');
    }
    mover.reset();
    expect(mover.next(0)).toEqual({ forward: 1, strafe: -1, turn: 0, sprint: true });
  });

  it('returns the leg that owns the MIDDLE of a step, then advances, and loops', () => {
    const a: Intent = { ...NEUTRAL_INTENT, forward: 1 };
    const b: Intent = { ...NEUTRAL_INTENT, turn: 1 };
    const mover = new ScriptedMover([{ seconds: 1, intent: a }, { seconds: 1, intent: b }]);
    expect(mover.period).toBe(2);
    expect(mover.next(1)).toEqual(a);
    expect(mover.next(1)).toEqual(b);
    expect(mover.next(1)).toEqual(a);
    expect(mover.elapsed()).toBe(1);
    mover.next(0.5);
    expect(mover.elapsed()).toBe(1.5);
    // A step straddling a boundary goes to whichever leg owns more of it.
    expect(mover.next(0.8)).toEqual(b); // 1.5 → 2.3, middle 1.9: still b
    expect(mover.elapsed()).toBeCloseTo(0.3, 12);
    expect(mover.next(1.6)).toEqual(b); // 0.3 → 1.9, middle 1.1: b
    mover.reset();
    expect(mover.elapsed()).toBe(0);
    expect(mover.next(0)).toEqual(a);
    // Adding 240 sixtieths lands a hair off 4.0; the midpoint reading does not care.
    const four = new ScriptedMover([{ seconds: 4, intent: a }, { seconds: 1, intent: b }]);
    const seen: Intent[] = [];
    for (let i = 0; i < 300; i += 1) seen.push(four.next(SIXTY));
    expect(seen.slice(0, 240).every((x) => x === seen[0])).toBe(true);
    expect(seen.slice(240).every((x) => x === seen[299])).toBe(true);
    expect(seen[0]).toEqual(a);
    expect(seen[299]).toEqual(b);
  });

  it('holds still on a zero, negative or non-finite dt — a paused world does not move the script', () => {
    const mover = new ScriptedMover([{ seconds: 1, intent: { ...NEUTRAL_INTENT, forward: 1 } }, pauseLeg(1)]);
    mover.next(0.75);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      mover.next(dt);
      expect(mover.elapsed(), `dt ${dt}`).toBe(0.75);
    }
  });

  it('refuses an empty route or a leg that lasts no time', () => {
    expect(() => new ScriptedMover([])).toThrow(/at least one leg/);
    expect(() => new ScriptedMover([pauseLeg(0)])).toThrow(/positive/);
    expect(() => new ScriptedMover([pauseLeg(-1)])).toThrow(/positive/);
    expect(() => new ScriptedMover([pauseLeg(Number.NaN)])).toThrow(/positive/);
  });
});

describe('routes through the real transform', () => {
  it('a circle at half turn takes 2π / (turn × turnRate) seconds and closes on the start', () => {
    const route = circleRoute(DEBUG_CAPSULE_TUNING, { turn: 0.5, pauseSeconds: 0 });
    expect(route).toHaveLength(1);
    expect(route[0].seconds).toBeCloseTo(4, 12);
    const mover = new ScriptedMover(route);
    const path = drive(mover, 4, DEBUG_CAPSULE_TUNING);
    const end = last(path);
    expect(Math.hypot(end.at.wx, end.at.wz)).toBeLessThan(1e-6);
    expect(Math.abs(end.heading)).toBeLessThan(1e-9);
    // And it went somewhere in between: a clockwise circle from heading 0 bulges to +wx.
    const reach = Math.max(...path.map((s) => s.at.wx));
    const radius = DEBUG_CAPSULE_TUNING.walkSpeed / (0.5 * DEBUG_CAPSULE_TUNING.turnRate);
    expect(reach).toBeCloseTo(2 * radius, 0);
    expect(Math.min(...path.map((s) => s.at.wx))).toBeGreaterThan(-1e-6);
  });

  it('a figure-eight puts one lobe to each side, pauses between, and returns to the start', () => {
    const route = figureEightRoute(DEBUG_CAPSULE_TUNING, { turn: 0.5, pauseSeconds: 1 });
    expect(route.map((leg) => leg.seconds)).toEqual([4, 1, 4, 1]);
    expect(route[1].intent).toEqual(NEUTRAL_INTENT);
    expect(route[3].intent).toEqual(NEUTRAL_INTENT);
    expect(route[0].intent.turn).toBeGreaterThan(0);
    expect(route[2].intent.turn).toBeLessThan(0);

    const mover = new ScriptedMover(route);
    const path = drive(mover, 10, DEBUG_CAPSULE_TUNING);
    const at = (seconds: number): ActorState => path[Math.round(seconds * 60) - 1];

    const firstLobe = path.slice(0, 240);
    const secondLobe = path.slice(300, 540);
    expect(Math.min(...firstLobe.map((s) => s.at.wx))).toBeGreaterThan(-1e-6);
    expect(Math.max(...secondLobe.map((s) => s.at.wx))).toBeLessThan(1e-6);

    // Standing still during the pause: the truth two screens can compare.
    expect(at(4.5).at).toEqual(at(5).at);
    expect(Math.hypot(at(5).at.wx, at(5).at.wz)).toBeLessThan(1e-6);
    // Home again after the whole loop, facing the way it started.
    const end = last(path);
    expect(Math.hypot(end.at.wx, end.at.wz)).toBeLessThan(1e-6);
    expect(Math.abs(end.heading)).toBeLessThan(1e-9);
  });

  it('leaves the pauses out when asked for none, and sprint draws the same loop larger', () => {
    expect(figureEightRoute(DEBUG_CAPSULE_TUNING, { pauseSeconds: 0 })).toHaveLength(2);
    const walk = drive(new ScriptedMover(circleRoute(DEBUG_CAPSULE_TUNING, { pauseSeconds: 0 })), 4, DEBUG_CAPSULE_TUNING);
    const sprint = drive(
      new ScriptedMover(circleRoute(DEBUG_CAPSULE_TUNING, { pauseSeconds: 0, sprint: true })), 4, DEBUG_CAPSULE_TUNING,
    );
    const reach = (path: readonly ActorState[]): number => Math.max(...path.map((s) => s.at.wx));
    expect(reach(sprint)).toBeCloseTo(DEBUG_CAPSULE_TUNING.sprintFactor * reach(walk), 6);
  });

  it('refuses a turn outside (0, 1], a negative pause, or a tuning that cannot turn', () => {
    expect(() => circleRoute(DEBUG_CAPSULE_TUNING, { turn: 0 })).toThrow(/turn/);
    expect(() => circleRoute(DEBUG_CAPSULE_TUNING, { turn: 1.5 })).toThrow(/turn/);
    expect(() => circleRoute(DEBUG_CAPSULE_TUNING, { pauseSeconds: -1 })).toThrow(/pauseSeconds/);
    expect(() => circleRoute({ ...DEBUG_CAPSULE_TUNING, turnRate: 0 })).toThrow(/turnRate/);
  });
});
