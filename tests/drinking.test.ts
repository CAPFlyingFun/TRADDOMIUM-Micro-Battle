/**
 * THE BAR AND ITS REFILL, WIRED TOGETHER.
 *
 * `Thirst` (tests/thirst.test.ts) and `canDrink` (tests/wading.test.ts)
 * were both written, both tested, and both connected to nothing for
 * several versions: the drink button went out with the water in
 * v0.0.42, the meter was pinned at full, and the save wrote a literal
 * 1. Every piece passed its own tests the whole time.
 *
 * So these are the tests the last three versions did not have — the
 * ones about the SEAM. They read the scene at the source, because it
 * wants a GL context and cannot be built here; what they are really
 * holding is CLAUDE.md's survival rule, that a bar may only move if
 * there is a way to move it back. If a future change takes the button
 * away again, the drain must go with it, and this is what says so.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Thirst } from '../src/ant/thirst';
import { canDrink } from '../src/ant/wading';
import { useWaterQuery } from '../src/world/waterQuery';

const scene = () => readFileSync('src/scenes/IslandScene.ts', 'utf8');
/** The scene with its prose stripped, so a comment cannot satisfy a test. */
const code = () => scene()
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the drink button is on the pad again', () => {
  it('exists, and starts off it', () => {
    expect(code()).toContain("this.drinkButton = this.actions.add('💧', 'drink', 'e');");
    expect(code()).toContain('this.drinkButton.show(false);');
  });

  it('appears only where there is water she could actually drink', () => {
    // CONTEXTUAL, per the HUD rule: not greyed on the pad everywhere on
    // an island that is mostly dry — off it entirely.
    expect(code()).toContain('const reachable = canDrink(this.ant.where.wx, this.ant.where.wz);');
    expect(code()).toContain('this.drinkButton.show(reachable);');
  });

  it('is HELD, not tapped, because drinking is an act', () => {
    // Stage G: the act IS the state now — there is no separate
    // `drinking` flag shadowing it, which is the point of motion.ts.
    expect(code()).toContain(
      "this.act = reachable && this.drinkButton.held ? 'drinking' : 'none';",
    );
    // takeTaps is the tap reader; drinking must not use it.
    expect(code()).not.toContain('this.drinkButton.takeTaps()');
  });

  it('and holds her still while she does it', () => {
    // An act she can do while walking is not a decision. The current
    // goes with her drive, or a stream would carry a drinking queen
    // downhill while she stood there.
    expect(code()).toContain("const hold = this.act === 'drinking' ? 0 : wade.pace;");
    expect(code()).toContain("this.act === 'drinking' ? null : wade.carry,");
  });

  it('goes away in the air, and the act with it', () => {
    // Cleared before either branch: an act that survived a takeoff
    // would drink its way across the island at flying speed.
    const body = code();
    const cleared = body.indexOf("this.act = 'none';");
    const branch = body.indexOf('if (this.flight.aloft) {');
    expect(cleared).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(cleared).toBeLessThan(branch);
    expect(body).toContain('this.drinkButton.show(false);');
  });
});

describe('the reserve moves, and can be moved back', () => {
  it('is advanced every frame by the act', () => {
    expect(code()).toContain("this.thirst.update(dt, this.act === 'drinking');");
  });

  it('and the card is told the truth about it', () => {
    // It read `false, 0` for three versions — a bar that could not
    // move, reporting that it was not moving.
    const body = code();
    expect(body).not.toContain('this.thirst.parched, false, 0');
    expect(body).toContain(
      "this.thirst.fraction, this.thirst.parched, this.act === 'drinking',",
    );
    expect(body).toContain('this.thirst.drain,');
  });

  it('survives a save and comes back where it was', () => {
    const body = code();
    expect(body).toContain('thirst: this.thirst.fraction');
    expect(body).toContain('this.thirst.restore(save.meters.thirst);');
    expect(body).not.toContain('thirst: 1 }');
  });

  it('THE INVARIANT: nothing drains without a way to fill it', () => {
    // CLAUDE.md's survival rule, as arithmetic rather than as prose.
    const thirst = new Thirst();
    expect(thirst.drain).toBeGreaterThan(0);       // it falls…
    thirst.update(120, false);
    const low = thirst.fraction;
    expect(low).toBeLessThan(1);
    thirst.update(120, true);                      // …and it comes back.
    expect(thirst.fraction).toBeGreaterThan(low);
    expect(thirst.fraction).toBe(1);
  });
});

describe('fresh water only, and the sea is not fresh', () => {
  it('refuses the ocean even in the middle of it', () => {
    useWaterQuery(() => ({ depth: 4_000, flowX: 0, flowZ: 0, salt: true }));
    expect(canDrink(0, 0)).toBe(false);
    useWaterQuery(null);
  });

  it('takes a stream she is standing beside without standing in it', () => {
    // The reach ring is what lets her drink from a bank — which
    // matters more than it looks, because fresh water is not DRAWN
    // until it is deeper than she can wade (the feather opens at 1.5
    // units against a FOOTING of 0.4), so "stand in the water you can
    // see" is not yet a thing the player can reliably do.
    useWaterQuery((wx) => (wx >= 10 ? { depth: 50, flowX: 0, flowZ: 0 } : null));
    expect(canDrink(0, 0)).toBe(true);
    useWaterQuery(null);
  });

  it('and is not fooled by salt sitting next to fresh', () => {
    // Every probe tests its own spot's flag, so a shoreline where the
    // sea is one side and a stream mouth the other answers on the
    // stream — she reaches the fresh water, she does not sip the surf.
    useWaterQuery((wx) => (wx > 0
      ? { depth: 900, flowX: 0, flowZ: 0, salt: true }
      : { depth: 30, flowX: 0, flowZ: 0 }));
    expect(canDrink(0, 0)).toBe(true);
    useWaterQuery(() => ({ depth: 900, flowX: 0, flowZ: 0, salt: true }));
    expect(canDrink(0, 0)).toBe(false);
    useWaterQuery(null);
  });
});
