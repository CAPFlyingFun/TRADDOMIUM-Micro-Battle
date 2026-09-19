/**
 * THE WALKING BODY, ON A FLAT FLOOR WITH ONE WALL.
 *
 * `src/actor/Walker.ts` is core, so its whole world is three questions
 * (`WalkWorld`) and the fixture below answers them in forty lines with no
 * renderer, no building and no three. That is the point of the inversion:
 * the properties worth pinning — the short way round the circle, the pace
 * ceiling, a gait phase that counts metres rather than seconds — are
 * arithmetic, and arithmetic is cheap to assert and expensive to
 * eyeball in a screenshot.
 *
 * THE FIXTURE IS DELIBERATELY NAIVE. It resolves a move by testing only
 * the DESTINATION: no sweep, no swept interval, no first-blocking-face
 * search. `world/tombs/collide.ts` is cleverer than that and would stop a
 * body however long the move, so a walker tested only against it could
 * tunnel through a thin wall the first day a simpler world was handed to
 * it. Testing against the dumbest world that could be correct is what
 * makes the substepping test measure the WALKER.
 */
import { describe, expect, it } from 'vitest';
import {
  BODY_HEIGHT_M, BODY_RADIUS_M, EYE_HEIGHT_M, RUN_SPEED_M_S, STRIDE_M, WALK_SPEED_M_S,
  newWalkerState, step,
  type WalkMove, type WalkVec3, type WalkWorld, type WalkerState,
} from '../src/actor/Walker';
import { NEUTRAL_INTENT, type Intent } from '../src/input/Intent';
import { EYE_HEIGHT_M as TOOL_EYE_HEIGHT_M } from '../src/tombs/tombsTool';

// ---------------------------------------------------------------------------
// The fixture: an endless floor, and whatever boxes a test puts on it
// ---------------------------------------------------------------------------

interface SolidBox {
  readonly x0: number; readonly x1: number;
  readonly y0: number; readonly y1: number;
  readonly z0: number; readonly z1: number;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): SolidBox =>
  ({ x0, x1, y0, y1, z0, z1 });

/** Does the body's circle reach into the box's footprint? */
function underfoot(b: SolidBox, x: number, z: number, radius: number): boolean {
  const cx = Math.min(Math.max(x, b.x0), b.x1);
  const cz = Math.min(Math.max(z, b.z0), b.z1);
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < radius * radius;
}

/** Does the whole capsule share volume with the box? Touching faces do not. */
function hits(b: SolidBox, x: number, y: number, z: number, radius: number, height: number): boolean {
  if (y + height <= b.y0 || y >= b.y1) return false;
  return underfoot(b, x, z, radius);
}

function flatWorld(boxes: readonly SolidBox[] = [], floorY = 0): WalkWorld {
  /**
   * Is the destination clear? A solid the body was ALREADY inside when
   * the move began is ignored — the one rule this fixture takes from
   * `world/tombs/collide.ts` rather than leaving out, because that file
   * argues it is not an optimisation: "a body pushed into geometry would
   * otherwise be held there by the very solid it is inside, since every
   * direction is into it." A resolver that traps a body is broken, not
   * naive, and nothing would be measured against one.
   */
  const clear = (
    from: WalkVec3, x: number, y: number, z: number, radius: number, height: number,
  ): boolean => {
    for (const b of boxes) {
      if (hits(b, from.x, from.y, from.z, radius, height)) continue;
      if (hits(b, x, y, z, radius, height)) return false;
    }
    return true;
  };
  const world: WalkWorld = {
    moveBody(from: WalkVec3, radius: number, height: number, delta: WalkVec3, out: WalkMove): WalkMove {
      let x = from.x;
      let z = from.z;
      out.hitX = null;
      out.hitY = null;
      out.hitZ = null;
      out.stepped = 0;
      // One axis at a time, destination only — see the header.
      if (clear(from, x + delta.x, from.y, z, radius, height)) x += delta.x; else out.hitX = 'x';
      if (clear(from, x, from.y, z + delta.z, radius, height)) z += delta.z; else out.hitZ = 'z';

      let y = from.y + delta.y;
      if (delta.y < 0) {
        let limit = floorY;
        for (const b of boxes) {
          if (b.y1 <= from.y + 1e-9 && b.y1 > limit && underfoot(b, x, z, radius)) limit = b.y1;
        }
        if (y <= limit) { y = limit; out.hitY = 'down'; }
      } else if (delta.y > 0) {
        let limit = Infinity;
        for (const b of boxes) {
          if (b.y0 >= from.y + height - 1e-9 && b.y0 < limit && underfoot(b, x, z, radius)) limit = b.y0;
        }
        if (y + height >= limit) { y = limit - height; out.hitY = 'up'; }
      }

      out.x = x;
      out.y = y;
      out.z = z;
      out.grounded = y - world.groundUnder(x, z, y + 1e-6) <= 1e-3;
      return out;
    },
    groundUnder(x: number, z: number, fromY: number): number {
      let best = floorY <= fromY ? floorY : -Infinity;
      for (const b of boxes) {
        if (b.y1 <= fromY && b.y1 > best && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) best = b.y1;
      }
      return best;
    },
    ceilingOver(x: number, z: number, fromY: number): number {
      let best = Infinity;
      for (const b of boxes) {
        if (b.y0 >= fromY && b.y0 < best && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) best = b.y0;
      }
      return best;
    },
  };
  return world;
}

const intent = (over: Partial<Intent> = {}): Intent => ({ ...NEUTRAL_INTENT, ...over });

/** Run the same intent and look for a while, at a fixed frame time. */
function run(
  state: WalkerState, world: WalkWorld, want: Intent, look: number, dt: number, frames: number,
): WalkerState {
  for (let i = 0; i < frames; i += 1) step(state, world, want, look, dt);
  return state;
}

// ---------------------------------------------------------------------------
// At rest
// ---------------------------------------------------------------------------

describe('a body at rest', () => {
  it('does not move, does not turn and reports stand however the look swings', () => {
    const world = flatWorld();
    const state = newWalkerState(3, 0, -2, 0.5);
    // A camera orbiting right round the body, a full turn in a second.
    for (let i = 0; i < 60; i += 1) step(state, world, NEUTRAL_INTENT, (i / 60) * Math.PI * 2 - Math.PI, 1 / 60);
    expect(state.heading).toBe(0.5);
    expect(state.x).toBe(3);
    expect(state.z).toBe(-2);
    expect(state.speed).toBe(0);
    expect(state.stance).toBe('stand');
    expect(state.phase).toBe(0);
    expect(state.lean).toBeCloseTo(0, 12);
  });

  it('settles onto the floor and stays there', () => {
    const state = newWalkerState(0, 0, 0, 0);
    run(state, flatWorld(), NEUTRAL_INTENT, 0, 1 / 60, 30);
    expect(state.y).toBe(0);
    expect(state.grounded).toBe(true);
    expect(state.vy).toBe(0);
    expect(state.groundY).toBe(0);
    expect(state.headroom).toBe(Infinity);
  });

  it('is mutated in place rather than replaced', () => {
    const state = newWalkerState();
    expect(step(state, flatWorld(), NEUTRAL_INTENT, 0, 1 / 60)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Steering is looking
// ---------------------------------------------------------------------------

describe('steering is looking', () => {
  it('eases a moving body onto the look and stops there', () => {
    const state = newWalkerState(0, 0, 0, 0);
    const world = flatWorld();
    const look = 1.2;
    step(state, world, intent({ forward: 1 }), look, 1 / 60);
    const first = state.heading;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(look);
    run(state, world, intent({ forward: 1 }), look, 1 / 60, 120);
    expect(state.heading).toBeCloseTo(look, 6);
  });

  it('takes the SHORT way round: 3.0 rad to -3.0 rad crosses pi, it does not unwind through zero', () => {
    const state = newWalkerState(0, 0, 0, 3.0);
    const world = flatWorld();
    const look = -3.0;
    // The short way is +0.283 rad across the seam. Every heading on the
    // way therefore stays out past |3.0|; the long way would walk the
    // heading down through 2, 1, 0 and the body would spin 344 degrees.
    let worst = Math.PI;
    for (let i = 0; i < 120; i += 1) {
      step(state, world, intent({ forward: 1 }), look, 1 / 60);
      worst = Math.min(worst, Math.abs(state.heading));
    }
    expect(worst).toBeGreaterThanOrEqual(3.0 - 1e-9);
    expect(state.heading).toBeCloseTo(-3.0, 6);
  });

  it('turns on the first step toward the seam, not away from it', () => {
    const state = newWalkerState(0, 0, 0, 3.0);
    step(state, flatWorld(), intent({ forward: 1 }), -3.0, 1 / 60);
    // Growing past pi is the short way; shrinking toward zero is the bug.
    expect(state.heading).toBeGreaterThan(3.0);
  });

  it('reads Intent.turn only where there is no look to read', () => {
    const world = flatWorld();
    const withLook = newWalkerState(0, 0, 0, 0);
    // A look straight ahead and a turn request: the look wins, so nothing
    // turns. Steering the body twice is what this refusal prevents.
    run(withLook, world, intent({ forward: 1, turn: 1 }), 0, 1 / 60, 30);
    expect(withLook.heading).toBeCloseTo(0, 9);

    // No look at all: the autonomy channel steers, standing or moving.
    const noLook = newWalkerState(0, 0, 0, 0);
    run(noLook, world, intent({ turn: 1 }), Number.NaN, 1 / 60, 30);
    expect(noLook.heading).toBeGreaterThan(0.3);
  });

  it('leans into the turn, with the sign Intent.turn uses', () => {
    const world = flatWorld();
    const left = newWalkerState(0, 0, 0, 0);
    run(left, world, intent({ forward: 1 }), 1.5, 1 / 60, 8);
    expect(left.lean).toBeGreaterThan(0);
    const right = newWalkerState(0, 0, 0, 0);
    run(right, world, intent({ forward: 1 }), -1.5, 1 / 60, 8);
    expect(right.lean).toBeLessThan(0);
    expect(Math.abs(right.lean)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Pace is a ceiling
// ---------------------------------------------------------------------------

describe('pace is a ceiling', () => {
  it('reaches the walking ceiling and never passes it', () => {
    const state = newWalkerState(0, 0, 0, 0);
    const world = flatWorld();
    let peak = 0;
    for (let i = 0; i < 300; i += 1) {
      step(state, world, intent({ forward: 1 }), 0, 1 / 60);
      peak = Math.max(peak, state.speed);
    }
    expect(peak).toBeLessThanOrEqual(WALK_SPEED_M_S + 1e-9);
    expect(state.speed).toBeCloseTo(WALK_SPEED_M_S, 6);
    expect(state.stance).toBe('walk');
  });

  it('only reaches the running ceiling with sprint held', () => {
    const world = flatWorld();
    const jog = newWalkerState(0, 0, 0, 0);
    let peak = 0;
    for (let i = 0; i < 300; i += 1) {
      step(jog, world, intent({ forward: 1, sprint: true }), 0, 1 / 60);
      peak = Math.max(peak, jog.speed);
    }
    expect(peak).toBeLessThanOrEqual(RUN_SPEED_M_S + 1e-9);
    expect(jog.speed).toBeCloseTo(RUN_SPEED_M_S, 6);
    expect(jog.stance).toBe('run');
  });

  it('scales the ceiling by how far the stick is pushed', () => {
    const state = newWalkerState(0, 0, 0, 0);
    run(state, flatWorld(), intent({ forward: 0.5 }), 0, 1 / 60, 300);
    expect(state.speed).toBeCloseTo(WALK_SPEED_M_S * 0.5, 6);
    expect(state.stance).toBe('walk');
  });

  it('keeps a diagonal push on the unit disc, not the unit square', () => {
    const state = newWalkerState(0, 0, 0, 0);
    run(state, flatWorld(), intent({ forward: 1, strafe: 1 }), 0, 1 / 60, 300);
    expect(state.speed).toBeCloseTo(WALK_SPEED_M_S, 6);
  });

  it('brakes back to a standstill when the stick is let go', () => {
    const state = newWalkerState(0, 0, 0, 0);
    const world = flatWorld();
    run(state, world, intent({ forward: 1 }), 0, 1 / 60, 120);
    run(state, world, NEUTRAL_INTENT, 0, 1 / 60, 120);
    expect(state.speed).toBeCloseTo(0, 6);
    expect(state.stance).toBe('stand');
  });
});

// ---------------------------------------------------------------------------
// The gait phase counts metres
// ---------------------------------------------------------------------------

describe('the gait phase is advanced by distance', () => {
  it('advances by the distance covered over the stride length', () => {
    const state = newWalkerState(0, 0, 0, 0);
    const world = flatWorld();
    const before = { x: state.x, z: state.z, phase: state.phase };
    run(state, world, intent({ forward: 1 }), 0, 1 / 60, 60);
    const covered = Math.hypot(state.x - before.x, state.z - before.z);
    expect(covered).toBeGreaterThan(0.5);
    // Under 1.5 m of travel the phase has not wrapped, so it can be
    // compared to the raw ratio.
    expect(covered).toBeLessThan(STRIDE_M);
    expect(state.phase).toBeCloseTo(before.phase + covered / STRIDE_M, 9);
  });

  it('is identical for one step at twice the speed and two steps at half it', () => {
    const world = flatWorld();
    const dt = 0.1;

    // Both bodies start at the pace their stick asks for, so neither
    // accelerates during the measurement and the only difference is how
    // the same 0.14 m of floor is divided into steps.
    const fast = newWalkerState(0, 0, 0, 0);
    fast.vz = WALK_SPEED_M_S;
    fast.grounded = true;
    step(fast, world, intent({ forward: 1 }), 0, dt);

    const slow = newWalkerState(0, 0, 0, 0);
    slow.vz = WALK_SPEED_M_S / 2;
    slow.grounded = true;
    step(slow, world, intent({ forward: 0.5 }), 0, dt);
    step(slow, world, intent({ forward: 0.5 }), 0, dt);

    expect(slow.z).toBeCloseTo(fast.z, 9);
    expect(slow.phase).toBeCloseTo(fast.phase, 9);
    expect(fast.phase).toBeCloseTo((WALK_SPEED_M_S * dt) / STRIDE_M, 9);
  });

  it('does not advance while the body is held against a wall', () => {
    // A wall 1 m ahead, in +x. Heading pi/2 faces +x (ahead is sin, cos).
    const world = flatWorld([box(1, 1.2, 0, 3, -5, 5)]);
    const state = newWalkerState(0, 0, 0, Math.PI / 2);
    run(state, world, intent({ forward: 1 }), Math.PI / 2, 1 / 60, 120);
    const held = state.phase;
    run(state, world, intent({ forward: 1 }), Math.PI / 2, 1 / 60, 60);
    expect(state.speed).toBeCloseTo(0, 9);
    expect(state.phase).toBeCloseTo(held, 12);
    expect(state.stance).toBe('stand');
  });
});

// ---------------------------------------------------------------------------
// The world stops the body
// ---------------------------------------------------------------------------

describe('the world stops the body', () => {
  it('stops at the wall without tunnelling, at a frame time nobody should ever see', () => {
    const world = flatWorld([box(1, 1.2, 0, 3, -5, 5)]);
    const state = newWalkerState(0, 0, 0, Math.PI / 2);
    // 2 s in one step: 2.8 m of walking, against a wall 1 m away and only
    // 200 mm thick. A walker that handed the whole move to this fixture
    // in one piece would be resolved on the far side of it.
    step(state, world, intent({ forward: 1 }), Math.PI / 2, 2);
    expect(state.x).toBeLessThanOrEqual(1 - BODY_RADIUS_M + 1e-9);
    expect(state.x).toBeGreaterThan(1 - BODY_RADIUS_M - 0.12);
    step(state, world, intent({ forward: 1 }), Math.PI / 2, 2);
    expect(state.x).toBeLessThanOrEqual(1 - BODY_RADIUS_M + 1e-9);
  });

  it('slides along the wall instead of stopping dead against it', () => {
    const world = flatWorld([box(1, 1.2, 0, 3, -5, 5)]);
    const state = newWalkerState(0, 0, 0, Math.PI / 4);
    // Pushed at 45 degrees into the wall: the x half is refused, the z
    // half runs.
    run(state, world, intent({ forward: 1 }), Math.PI / 4, 1 / 60, 180);
    expect(state.x).toBeLessThanOrEqual(1 - BODY_RADIUS_M + 1e-9);
    expect(state.z).toBeGreaterThan(1);
  });

  it('stores no speed while pressed into the wall', () => {
    const world = flatWorld([box(1, 1.2, 0, 3, -5, 5)]);
    const state = newWalkerState(0, 0, 0, Math.PI / 2);
    run(state, world, intent({ forward: 1 }), Math.PI / 2, 1 / 60, 180);
    expect(Math.abs(state.vx)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

describe('the ground', () => {
  it('walks a body off a step, and it falls and lands on the floor', () => {
    // A 0.5 m platform from x -2 to x 0; the floor is at 0 beyond it.
    const world = flatWorld([box(-2, 0, 0, 0.5, -2, 2)]);
    const state = newWalkerState(-1, 0.5, 0, Math.PI / 2);
    run(state, world, intent({ forward: 1 }), Math.PI / 2, 1 / 60, 30);
    expect(state.y).toBe(0.5);
    expect(state.grounded).toBe(true);

    run(state, world, intent({ forward: 1 }), Math.PI / 2, 1 / 60, 120);
    expect(state.x).toBeGreaterThan(BODY_RADIUS_M);
    expect(state.y).toBe(0);
    expect(state.grounded).toBe(true);
    expect(state.vy).toBe(0);
  });

  it('walks off a 2 cm lip without reading it as a fall', () => {
    // A 20 mm sill across the floor, and a body standing on it walking
    // over its far edge: the exact case SNAP_DOWN_M exists for. Without
    // the snap the body leaves the ground for the two frames it takes to
    // fall 20 mm, and a walk across a threshold stutters.
    const world = flatWorld([box(0.5, 1.5, 0, 0.02, -5, 5)]);
    const state = newWalkerState(0.8, 0.02, 0, Math.PI / 2);
    let airborne = 0;
    for (let i = 0; i < 180; i += 1) {
      step(state, world, intent({ forward: 1 }), Math.PI / 2, 1 / 60);
      if (!state.grounded) airborne += 1;
    }
    expect(state.x).toBeGreaterThan(2);
    expect(state.y).toBe(0);
    expect(airborne).toBe(0);
  });

  it('reports the head room over the body', () => {
    // A slab whose underside is 2.5 m up.
    const world = flatWorld([box(-5, 5, 2.5, 2.75, -5, 5)]);
    const state = newWalkerState(0, 0, 0, 0);
    step(state, world, NEUTRAL_INTENT, 0, 1 / 60);
    expect(state.headroom).toBeCloseTo(2.5 - BODY_HEIGHT_M, 9);
  });
});

// ---------------------------------------------------------------------------
// The body, and the numbers that have to agree with somebody else's
// ---------------------------------------------------------------------------

describe('the body', () => {
  it('stands as tall as the eye the building is photographed from', () => {
    // `Walker.EYE_HEIGHT_M` is deliberately not imported from the tool
    // (core may not depend on a renderer directory), so the agreement is
    // pinned here rather than assumed.
    expect(EYE_HEIGHT_M).toBe(TOOL_EYE_HEIGHT_M);
    expect(EYE_HEIGHT_M).toBeLessThan(BODY_HEIGHT_M);
  });

  it('refuses a step of no time rather than dividing by it', () => {
    const state = newWalkerState(1, 0, 2, 0.25);
    const world = flatWorld();
    for (const dt of [0, -1 / 60, Number.NaN, Number.POSITIVE_INFINITY]) {
      step(state, world, intent({ forward: 1 }), 1.5, dt);
    }
    expect(state.x).toBe(1);
    expect(state.z).toBe(2);
    expect(state.heading).toBe(0.25);
    expect(state.speed).toBe(0);
  });
});
