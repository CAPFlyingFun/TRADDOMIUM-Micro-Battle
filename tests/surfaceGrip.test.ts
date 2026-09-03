/**
 * A BODY CANNOT SNAP.
 *
 * The field's normal steps through the right angle at the foot of a
 * trunk in one sample. Her attitude must not — Thronemound's phone
 * reported exactly that as "jumps around the corner". These measure
 * the fold as a motion.
 */
import { describe, expect, it } from 'vitest';
import {
  GRIP_EASE, MOST_TILT, angleBetween, gripUp, squareTo, transport, turnToward,
} from '../src/ant/surfaceGrip';

const UP = { x: 0, y: 1, z: 0 };
const SIDE = { x: 1, y: 0, z: 0 };

describe('her up has a speed limit', () => {
  it('turns all the way when the step is small enough', () => {
    // Exactly unit, by construction: an eyeballed triple is not, and
    // a non-unit 'direction' quietly reads as a degree of rotation.
    const near = { x: Math.sin(0.05), y: Math.cos(0.05), z: 0 };
    expect(angleBetween(turnToward(UP, near, 1), near)).toBeLessThan(1e-9);
  });

  it('turns only as far as it is allowed', () => {
    const got = turnToward(UP, SIDE, 0.2);
    expect(angleBetween(UP, got)).toBeCloseTo(0.2, 6);
    // …and in the right direction: toward the goal, not away.
    expect(angleBetween(got, SIDE)).toBeLessThan(angleBetween(UP, SIDE));
  });

  it('stays a unit vector through a long fold', () => {
    let up = UP;
    for (let i = 0; i < 200; i++) up = gripUp(up, SIDE, 1 / 60);
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1, 9);
    expect(angleBetween(up, SIDE)).toBeLessThan(1e-6);
  });

  it('takes about three quarters of a second to roll onto bark', () => {
    // The right angle at the foot of a trunk, at the cap. Long enough
    // to read as a movement, short enough not to be lying down halfway
    // up the tree.
    let up = UP;
    let took = 0;
    for (let i = 0; i < 600 && angleBetween(up, SIDE) > 0.02; i++) {
      up = gripUp(up, SIDE, 1 / 120);
      took += 1 / 120;
    }
    expect(took).toBeGreaterThan(0.4);
    expect(took).toBeLessThan(1.4);
  });

  it('never rolls faster than the cap, however big the step', () => {
    // The goal is straight down — a fold no surface should ever ask
    // for — and the rate still holds.
    const dt = 1 / 30;
    const was = UP;
    const now = gripUp(was, { x: 0, y: -1, z: 0 }, dt);
    expect(angleBetween(was, now)).toBeLessThanOrEqual(MOST_TILT * dt + 1e-9);
  });

  it('follows ordinary ground almost exactly, so a slope is not laggy', () => {
    // A couple of degrees is what walking over Kauai actually asks
    // for, and the cap must be invisible there.
    const gentle = { x: Math.sin(0.035), y: Math.cos(0.035), z: 0 };
    const one = gripUp(UP, gentle, 1 / 30);
    const reachable = 1 - Math.exp(-GRIP_EASE / 30);
    expect(angleBetween(UP, one)).toBeCloseTo(angleBetween(UP, gentle) * reachable, 3);
  });

  it('a frozen frame changes nothing', () => {
    expect(gripUp(UP, SIDE, 0)).toEqual(UP);
  });
});

describe('her nose stays on the surface', () => {
  it('squares a heading to a new up', () => {
    const nose = squareTo({ x: 0, y: 0, z: 1 }, SIDE);
    expect(Math.abs(nose.x)).toBeLessThan(1e-9);
    expect(Math.hypot(nose.x, nose.y, nose.z)).toBeCloseTo(1, 9);
  });

  it('carries her facing UP the trunk when the surface rolls under her', () => {
    // Walking north at a trunk whose bark faces +x: once her up is +x,
    // "forward" is still north — she is walking up the trunk, which is
    // what an ant does and what makes this need no climb button.
    const nose = squareTo({ x: Math.sin(0.2), y: 0, z: Math.cos(0.2) }, SIDE);
    expect(nose.z).toBeGreaterThan(0.99);
  });

  it('leaves a heading already square to her up alone', () => {
    const nose = squareTo({ x: 0, y: 0, z: 1 }, UP);
    expect(nose).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('a step is carried onto the surface, not flattened onto it', () => {
  it('changes nothing at all on the ground', () => {
    // In the movement path of every step she takes. Identity, exactly,
    // or walking about the island is not what it was.
    const step = { x: 3, y: 0, z: -7 };
    expect(transport(step, UP, UP)).toEqual(step);
  });

  it('turns a push INTO a trunk into a climb UP it', () => {
    // She walked west at a tree, so her up rolls onto the bark's
    // normal, which faces east. The push that was carrying her into
    // the trunk is then carrying her up it — at the same speed, which
    // is the half that projection gets wrong.
    const bark = { x: 1, y: 0, z: 0 };
    const push = { x: -10, y: 0, z: 0 };
    const climb = transport(push, UP, bark);
    expect(climb.y).toBeCloseTo(10, 6);
    expect(Math.hypot(climb.x, climb.y, climb.z)).toBeCloseTo(10, 6);
  });

  it('keeps the length of whatever it carries', () => {
    const bark = { x: Math.sin(0.7), y: Math.cos(0.7), z: 0 };
    for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, { x: 2, y: 0, z: -3 }]) {
      const got = transport(v, UP, bark);
      expect(Math.hypot(got.x, got.y, got.z))
        .toBeCloseTo(Math.hypot(v.x, v.y, v.z), 9);
    }
  });

  it('leaves a direction square to the fold where it was', () => {
    // Walking ALONG the foot of a trunk rather than at it: the roll
    // happens about her own heading, so her heading does not move.
    const bark = { x: 1, y: 0, z: 0 };
    const across = { x: 0, y: 0, z: 6 };
    const got = transport(across, UP, bark);
    expect(got.x).toBeCloseTo(0, 9);
    expect(got.y).toBeCloseTo(0, 9);
    expect(got.z).toBeCloseTo(6, 9);
  });

  it('stays finite when the surface is exactly upside down', () => {
    const got = transport({ x: 1, y: 0, z: 0 }, UP, { x: 0, y: -1, z: 0 });
    expect(Number.isFinite(got.x) && Number.isFinite(got.y) && Number.isFinite(got.z))
      .toBe(true);
  });
});
