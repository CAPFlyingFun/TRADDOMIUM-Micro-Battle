import { describe, expect, it } from 'vitest';
import {
  GRAVITY, Jump, JUMP_COST, JUMP_HOLD, JUMP_SPEED, JUMPS_FROM_FULL,
} from '../src/ant/jump';
import { RECOVER_SECONDS, Stamina } from '../src/ant/stamina';

/** Run an arc to the ground at a fixed step, returning its airtime. */
const arc = (step = 1 / 60): number => {
  const jump = new Jump();
  jump.ask(1);
  let t = 0;
  for (let i = 0; i < 10_000; i++) {
    t += step;
    if (jump.update(step)) return t;
  }
  throw new Error('she never came down');
};

describe('asking for a jump', () => {
  it('costs what it says and leaves the ground', () => {
    const jump = new Jump();
    expect(jump.ask(1)).toBe(JUMP_COST);
    expect(jump.aloft).toBe(true);
    expect(jump.rising).toBe(JUMP_SPEED);
  });

  it('refuses when there is not enough left, and charges nothing', () => {
    const jump = new Jump();
    expect(jump.canJump(JUMP_COST - 0.001)).toBe(false);
    expect(jump.ask(JUMP_COST - 0.001)).toBe(0);
    expect(jump.aloft).toBe(false);
  });

  it('takes exactly the last jump it can afford', () => {
    const jump = new Jump();
    expect(jump.ask(JUMP_COST)).toBe(JUMP_COST);
  });

  it('will not stack into a double jump', () => {
    // Two asks in one frame used to be two push-offs; the second has
    // to see her already airborne.
    const jump = new Jump();
    jump.ask(1);
    expect(jump.ask(1)).toBe(0);
    expect(jump.rising).toBe(JUMP_SPEED);
  });

  it('refuses while she is still falling', () => {
    const jump = new Jump();
    jump.ask(1);
    for (let i = 0; i < 20; i++) jump.update(1 / 60);
    expect(jump.rising).toBeLessThan(0);
    expect(jump.canJump(1)).toBe(false);
  });
});

describe('the arc', () => {
  it('comes back down, and says so on the frame it lands', () => {
    const jump = new Jump();
    jump.ask(1);
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) landed = jump.update(1 / 60);
    expect(landed).toBe(true);
    expect(jump.aloft).toBe(false);
    expect(jump.height).toBe(0);
  });

  it('reports the landing once, not every frame after', () => {
    const jump = new Jump();
    jump.ask(1);
    let thumps = 0;
    for (let i = 0; i < 600; i++) if (jump.update(1 / 60)) thumps += 1;
    expect(thumps).toBe(1);
  });

  it('stays in the air long enough to watch', () => {
    // Under half a second is a twitch on a phone; over a second and a
    // half and she is floating.
    expect(arc()).toBeGreaterThan(0.45);
    expect(arc()).toBeLessThan(1.5);
  });

  it('lands at the same time however coarse the frames are', () => {
    // A jump that is higher on a bad phone than a good one is a bug in
    // any game and a cheat in this one.
    expect(arc(1 / 30)).toBeCloseTo(arc(1 / 120), 1);
  });

  it('peaks near the height the numbers predict', () => {
    const jump = new Jump();
    jump.ask(1);
    let top = 0;
    for (let i = 0; i < 600; i++) {
      jump.update(1 / 240);
      top = Math.max(top, jump.height);
    }
    expect(top).toBeCloseTo((JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY), 1);
  });

  it('does nothing at all while she is on the ground', () => {
    const jump = new Jump();
    expect(jump.update(1 / 60)).toBe(false);
    expect(jump.height).toBe(0);
  });
});

describe('eight in a row', () => {
  /**
   * The design target, run against the REAL stamina class rather than
   * arithmetic: hammer the button and count what she gives before one
   * is refused. That refusal is what "in a row" means — after it she is
   * standing still getting her breath back, which is the point.
   *
   * @param step the frame step, because the answer must not depend on it
   * @param hold whether a jump blocks recovery for a moment afterwards
   */
  const inARow = (step: number, hold = JUMP_HOLD): number => {
    const stamina = new Stamina();
    const jump = new Jump();
    let given = 0;
    for (let frame = 0; frame < Math.ceil(60 / step); frame++) {
      if (!jump.aloft) {
        if (!jump.canJump(stamina.fraction)) break;
        stamina.spend(jump.ask(stamina.fraction));
        stamina.hold(hold);
        given += 1;
      }
      jump.update(step);
      stamina.update(false, true, step);
    }
    return given;
  };

  it('gives exactly eight from full', () => {
    // 12% x 8 = 96%, and the ninth is refused. The cost and the hold
    // are chosen to land on this; if either moves, this is the test
    // that says the design target moved with it.
    expect(JUMPS_FROM_FULL).toBe(8);
    expect(inARow(1 / 60)).toBe(8);
  });

  it('gives eight however coarse the frames are', () => {
    // The bug this test exists for: the hold used to be "while she is
    // off the ground", so a device rendering at 10fps spent more of
    // each cycle standing still recovering and got NINE. The headless
    // probe runs near 1fps and caught it; nothing here did, because
    // every step in this file was a fast one.
    for (const step of [1 / 120, 1 / 60, 1 / 30, 1 / 10, 1 / 4]) {
      expect(inARow(step), `at ${(1 / step).toFixed(0)}fps`).toBe(8);
    }
  });

  it('holds recovery longer than the jump it pays for', () => {
    // If the hold were shorter than the arc, a frame of recovery would
    // fit between landing and the next push-off, and the count would
    // start drifting with the frame rate again.
    const jump = new Jump();
    jump.ask(1);
    let airtime = 0;
    for (let i = 0; i < 600; i++) {
      airtime += 1 / 240;
      if (jump.update(1 / 240)) break;
    }
    expect(JUMP_HOLD).toBeGreaterThan(airtime);
  });

  it('would give more without the hold, which is why there is one', () => {
    // Proves the hold is load-bearing rather than decorative — and at
    // the coarse step, which is where it actually mattered.
    expect(inARow(1 / 10, 0)).toBeGreaterThan(8);
  });

  it('winds her when a jump empties the reserve, same as running dry', () => {
    const stamina = new Stamina();
    stamina.spend(1);
    expect(stamina.spent).toBe(true);
  });

  it('lets her jump again once the reserve has refilled', () => {
    // A bar may only move if there is a way to move it back.
    const stamina = new Stamina();
    const jump = new Jump();
    stamina.spend(1);
    stamina.hold(JUMP_HOLD);
    expect(jump.canJump(stamina.fraction)).toBe(false);
    for (let i = 0; i < (RECOVER_SECONDS + JUMP_HOLD) * 60; i++) {
      stamina.update(false, true, 1 / 60);
    }
    expect(jump.canJump(stamina.fraction)).toBe(true);
  });
});
