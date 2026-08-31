/**
 * STAGE G — one name for what she is doing.
 *
 * The ladder in `motionOf` is the design, so most of this file is that
 * ladder read back as assertions: which state outranks which, and at
 * what boundary. The rest guards the two things that made the state
 * worth having — that it is DERIVED (so it cannot disagree with the
 * physics) and that the scene actually reads it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  afloatIn, inWater, instrumented, motionOf, STILL,
  type Motion, type Posture,
} from '../src/ant/motion';

const DRY: Posture = {
  aloft: false, afloat: false, under: false, depth: 0, speed: 0,
};
const at = (p: Partial<Posture>): Motion => motionOf({ ...DRY, ...p });

const scene = () => readFileSync('src/scenes/IslandScene.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('on dry ground', () => {
  it('is idle when she is not going anywhere', () => {
    expect(at({})).toBe('idle');
    expect(at({ speed: STILL })).toBe('idle');
  });

  it('and walking the moment she is', () => {
    expect(at({ speed: STILL + 0.01 })).toBe('walking');
    expect(at({ speed: 12 })).toBe('walking');
  });

  /**
   * The same threshold the stamina ladder uses for `resting`. If these
   * ever drift apart she can be "idle" while being charged for moving.
   */
  it('using the threshold the stamina ladder already used', () => {
    expect(STILL).toBe(0.05);
  });
});

describe('in water', () => {
  it('wades with her feet down, whatever her speed', () => {
    expect(at({ depth: 0.2 })).toBe('wading');
    expect(at({ depth: 0.2, speed: 7 })).toBe('wading');
  });

  it('swims once the bottom lets go', () => {
    expect(at({ depth: 4, afloat: true })).toBe('swimming');
  });

  it('and dives when her body goes under', () => {
    expect(at({ depth: 40, afloat: true, under: true })).toBe('diving');
  });

  /**
   * UNDER BEATS AFLOAT. She is still held up by buoyancy while she
   * swims down — she is a cork with legs — so `afloat` stays true, and
   * a ladder that tested it first would lose the one fact that matters
   * down there: she cannot breathe.
   */
  it('reading under before afloat, because both are true at once', () => {
    expect(at({ afloat: true, under: true, depth: 40 })).toBe('diving');
  });
});

describe('in the air', () => {
  it('beats everything below her', () => {
    expect(at({ aloft: true })).toBe('flying');
    expect(at({ aloft: true, depth: 900, afloat: true, under: true }))
      .toBe('flying');
  });

  /**
   * The case that matters: the frame she launches off the water, the
   * wade numbers are still last frame's and still say afloat. Flying
   * first is what stops her reading as swimming while she climbs.
   */
  it('including the frame she leaves the water', () => {
    expect(at({ aloft: true, afloat: true, depth: 200 })).toBe('flying');
  });
});

describe('the vocabulary the scene reads', () => {
  it('afloatIn is the old `!aloft && afloat`, diving included', () => {
    expect(afloatIn('swimming')).toBe(true);
    // The swim instruments stay lit under the surface — Joshua asked
    // for the same HUD in the water as in the air.
    expect(afloatIn('diving')).toBe(true);
    expect(afloatIn('wading')).toBe(false);
    expect(afloatIn('flying')).toBe(false);
    expect(afloatIn('idle')).toBe(false);
  });

  it('inWater also counts her standing in it', () => {
    expect(inWater('wading')).toBe(true);
    expect(inWater('swimming')).toBe(true);
    expect(inWater('diving')).toBe(true);
    expect(inWater('walking')).toBe(false);
  });

  it('instrumented is flying or afloat, and nothing else', () => {
    expect(instrumented('flying')).toBe(true);
    expect(instrumented('swimming')).toBe(true);
    expect(instrumented('diving')).toBe(true);
    expect(instrumented('wading')).toBe(false);
    expect(instrumented('walking')).toBe(false);
  });
});

describe('it is DERIVED, and that is the safety of it', () => {
  /**
   * There is no setMotion and there must never be one. A machine with
   * hand-written transitions can disagree with the water; one with no
   * memory cannot. The scene assigns `this.motion` in exactly one
   * place — the derivation — and nowhere else.
   */
  it('so the scene computes it in one place and never assigns it', () => {
    const body = scene();
    // `=` not followed by `=`, or every `=== 'flying'` counts as one.
    const assignments = body.match(/this\.motion\s*=(?!=)/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(body).toContain('this.motion = motionOf({');
  });

  it('and the same posture always gives the same answer', () => {
    const p: Posture = {
      aloft: false, afloat: true, under: false, depth: 12, speed: 3,
    };
    expect(motionOf(p)).toBe(motionOf(p));
    expect(motionOf(p)).toBe('swimming');
  });

  /**
   * THE ORDERING RULE, and Stage G's own sweep broke it before this
   * test existed. The takeoff runs a hundred lines above the
   * derivation and can set `aloft` mid-frame, so the branch after it
   * must ask the LIVE flight model. A state derived at the end of the
   * previous frame still said 'swimming' on the frame she launched,
   * and sent her down the water branch while she was climbing out of
   * it. Producers read physics; consumers read the state.
   */
  it('and the frame\'s own producers read live physics, not it', () => {
    const body = scene();
    const takeoff = body.indexOf('const wantsUp = this.liftSlider.takeTakeoff();');
    const derived = body.indexOf('this.motion = motionOf({');
    expect(takeoff).toBeGreaterThan(-1);
    expect(derived).toBeGreaterThan(takeoff);
    // The stretch between the takeoff and the derivation is where a
    // stale state does damage. Nothing in it may read one. (A textual
    // check over the whole file would be wrong — the probe hooks are
    // closures, declared early and called much later.)
    const between = body.slice(takeoff, derived);
    expect(between).not.toContain('this.motion');
    // The two the sweep wrongly converted, back on live physics.
    expect(between).toContain('if (!this.flight.aloft && wantsUp');
    expect(between).toContain('if (this.flight.aloft) {');
  });

  it('the act is separate, because an act can be interrupted', () => {
    // Drinking while standing in the shallows is both at once, which
    // one enum could not have said.
    const body = scene();
    // `errand` is the autopilot finishing a water detour it flew her
    // on — a queen being flown by a machine should not need a thumb
    // to complete the one thing the flight was for. The BUTTON is
    // unchanged, which is what this test is really about.
    expect(body).toContain("this.act = reachable && (this.drinkButton.held || errand)");
    expect(body).toContain("this.act = 'none';");
  });
});

describe('the flags it replaced are gone', () => {
  /**
   * The point of Stage G was not to add a tenth flag beside the nine.
   * `inWater` and `drinking` were both derivable from the state, so
   * both were deleted rather than left to be kept in step by hand.
   */
  it('inWater and drinking are no longer fields on the scene', () => {
    const body = scene();
    expect(body).not.toContain('private inWater');
    expect(body).not.toContain('private drinking');
    expect(body).not.toContain('this.drinking');
    expect(body).not.toContain('this.inWater');
  });

  it('and the wings read the state instead', () => {
    // `plan.budget` rather than `dt` since v0.0.137: her wings dry over
    // HER flight, not over the player's wait. What this test is about
    // is the second argument — the motion, not a flag.
    expect(scene()).toContain('afloatIn(this.motion), this.motion === \'diving\',');
  });
});

/**
 * TWO QUESTIONS THAT AGREE MOST OF THE TIME, kept apart on purpose.
 *
 * `diving` is MEASURED — her body is under, the signal breath.ts is
 * fed. The underwater tint wants INTENT instead, and its comment says
 * why: "a crest washing over a floating queen must not read as a dive,
 * and a real dive must not wait." Collapsing them into the state would
 * silently undo that fix, so this test exists to make the next sweep
 * stop and read before it tidies.
 */
describe('the underwater tint keeps its own question', () => {
  it('reading the dive LEVER, not the motion', () => {
    const body = scene();
    expect(body).toContain("this.motion !== 'flying' && this.dive > 0.15,");
    expect(body).not.toContain("this.motion === 'diving',\n    );");
  });
});

/**
 * NOT BUILT, and said out loud rather than left for a reader to
 * discover. Joshua asked for the names now so the mechanics slot in;
 * nothing in src can produce either yet, and when that changes this
 * test is what will fail and ask to be rewritten.
 */
describe('digging and fighting are named but unreachable', () => {
  it('with no producer anywhere in the scene', () => {
    const body = scene();
    expect(body).not.toContain("'digging'");
    expect(body).not.toContain("'fighting'");
  });
});
