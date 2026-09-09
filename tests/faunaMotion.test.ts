/**
 * THE SNAKE RULE, PINNED — `layChain` against a known path and a known
 * rig, with no view, no origin and no simulation in the way.
 *
 * Joshua, 2026-09-08, from the device: "It needs to be like TCS and act
 * like the snake game where the head is the first bone and as it moves,
 * the next bone follows the same exact path." That is one arithmetic
 * claim and these tests are it:
 *
 *   every bone sits its own REST total behind the head, measured along
 *     the path, however unevenly the crumbs are spaced
 *   and it sits there STILL while the motion state runs on and the path
 *     does not — the regression, because the peristaltic wave used to
 *     seat the bones at stretched lengths, which slid every one of them
 *     back and forth along the path as the wave passed
 *   a bone the path is too short for stops at its last point rather
 *     than being extrapolated into ground the animal never crawled,
 *     exactly as TCS's `walkPath` does
 *
 * The rig is the synthetic worm the other fauna tests use, set up the
 * way `FaunaView` sets a lent rig up: measured at the identity, then
 * scaled by the table, with the head bone's rest offset and its
 * parent's frame taken once.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { APHID, EARTHWORM, QUEEN, rigScale, unitsOfMm } from '../src/creatures';
import { STRIDES_PER_LENGTH, strideFrequency } from '../src/fauna/gait';
import { PITCH_GAIN, layChain, newMotion, resetMotion, stepMotion, type RigMotion } from '../src/fauna/motion';
import { chainOf, measureRig, type ChainSpec } from '../src/fauna/rig';
import { wormRig } from './faunaFixtures';

/** The worm's body length in world units, and one bone's worth of it. */
const BODY = unitsOfMm(EARTHWORM.lengthMm);

interface Worm {
  readonly root: THREE.Object3D;
  readonly bones: readonly THREE.Bone[];
  readonly spec: ChainSpec;
  readonly scale: number;
  readonly headOffset: THREE.Vector3;
  readonly headFrame: THREE.Quaternion;
  /** How far behind the head each bone belongs, world units — the running totals the solve must reproduce. */
  readonly reach: readonly number[];
}

function worm(): Worm {
  const names = EARTHWORM.model.chain ?? [];
  const root = wormRig(EARTHWORM.model.spineUnits);
  // Measured at the identity, scaled after, as the renderer does it.
  const spec = measureRig(root, names).chain!;
  const scale = rigScale(EARTHWORM);
  root.scale.setScalar(scale);
  const bones = chainOf(root, spec.bones);
  root.updateMatrixWorld(true);
  const parent = bones[0].parent ?? root;
  const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(parent.matrixWorld);
  const origin = new THREE.Vector3();
  const headFrame = new THREE.Quaternion();
  const unscale = new THREE.Vector3();
  m.decompose(origin, headFrame, unscale);
  const headOffset = bones[0].position.clone().multiply(unscale).applyQuaternion(headFrame).add(origin);
  const reach = [0];
  for (const length of spec.lengths) reach.push(reach[reach.length - 1] + length * scale);
  return { root, bones, spec, scale, headOffset, headFrame, reach };
}

function lay(w: Worm, path: Float64Array, points: number, m: RigMotion): THREE.Vector3[] {
  layChain(w.root, w.bones, w.spec, w.scale, w.headOffset, w.headFrame, path, points, m, BODY, 0.3);
  w.root.updateMatrixWorld(true);
  return w.bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
}

/**
 * A path running back along −X from the head at the origin, crumb
 * spacings alternating short and long: the seating has to be by ARC
 * LENGTH, and a solve that counted crumbs instead would fail here.
 */
function straightPath(steps: number, span: number): { path: Float64Array; points: number; length: number } {
  const path = new Float64Array(steps * 3);
  let at = 0;
  for (let i = 1; i < steps; i += 1) {
    at += (i % 2 === 1 ? 0.4 : 1.6) * (span / (steps - 1));
    path[i * 3] = -at;
  }
  return { path, points: steps, length: at };
}

/**
 * A point `dist` along a path, walked from the head — the test's OWN
 * reading of the arc length, deliberately the plainest possible loop, so
 * the solve is checked against something rather than against itself.
 * Past the end it stops at the last point, which is the behaviour being
 * pinned.
 */
function pointAt(path: Float64Array, points: number, dist: number): THREE.Vector3 {
  let left = dist;
  for (let i = 0; i + 1 < points; i += 1) {
    const a = new THREE.Vector3(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]);
    const b = new THREE.Vector3(path[i * 3 + 3], path[i * 3 + 4], path[i * 3 + 5]);
    const seg = a.distanceTo(b);
    if (seg <= 1e-9) continue;
    if (left <= seg) return a.lerp(b, left / seg);
    left -= seg;
  }
  const end = (points - 1) * 3;
  return new THREE.Vector3(path[end], path[end + 1], path[end + 2]);
}

/** A quarter circle of radius `r` running back from the head at the origin — a path with a bend in it. */
function curvedPath(steps: number, r: number): { path: Float64Array; points: number } {
  const path = new Float64Array(steps * 3);
  for (let i = 0; i < steps; i += 1) {
    const a = (i / (steps - 1)) * (Math.PI / 2);
    path[i * 3] = -r * Math.sin(a);
    path[i * 3 + 1] = 0;
    path[i * 3 + 2] = r * (1 - Math.cos(a));
  }
  return { path, points: steps };
}

/**
 * A path that runs back along −X and then turns a right angle to +Z. The
 * corner is the point: the chord to the oldest crumb and the tangent of
 * the last leg are then plainly different directions, so a test can tell
 * a chain that STOPPED at the end of its memory from one that carried
 * the path on past it.
 */
function cornerPath(along: number, up: number): { path: Float64Array; points: number; length: number } {
  const path = new Float64Array(9);
  path[3] = -along;
  path[6] = -along;
  path[8] = up;
  return { path, points: 3, length: along + up };
}

describe('the worm chain: the head is the first bone and the rest follow its path', () => {
  it('seats every bone its own rest total behind the head, by arc length, whatever the crumbs are spaced at', () => {
    const w = worm();
    const { path, points, length } = straightPath(48, BODY * 3);
    expect(length).toBeGreaterThan(w.reach[w.reach.length - 1]);
    const at = lay(w, path, points, newMotion());
    // The head is on the head of the path.
    expect(at[0].x).toBeCloseTo(0, 9);
    expect(at[0].y).toBeCloseTo(0, 9);
    expect(at[0].z).toBeCloseTo(0, 9);
    // The path is straight along −X, so arc length from the head is −x.
    for (let i = 1; i < at.length; i += 1) {
      expect(-at[i].x, `bone ${i} is its rest total behind the head`).toBeCloseTo(w.reach[i], 9);
      expect(at[i].y, `bone ${i} stays on the path`).toBeCloseTo(0, 9);
      expect(at[i].z, `bone ${i} stays on the path`).toBeCloseTo(0, 9);
    }
  });

  it('HOLDS those stations while the motion state runs on and the path does not move', () => {
    const w = worm();
    const { path, points } = curvedPath(64, BODY);
    const m = newMotion();
    const before = lay(w, path, points, m);
    // A minute of crawling: the levers settle, the clock runs, the
    // distance travelled passes several body lengths — everything the
    // old peristaltic wave read.
    for (let f = 0; f < 3600; f += 1) {
      stepMotion(m, { dt: 1 / 60, moved: BODY / 600, climbed: 0, turned: 0, airborne: false, bodyLength: BODY, phase: 0.3 });
    }
    expect(m.gone).toBeGreaterThan(BODY * 5);
    expect(m.alive).toBeCloseTo(60, 6);
    expect(m.moving).toBeGreaterThan(0.99);
    const after = lay(w, path, points, m);
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i].x, `bone ${i} has not slid along the path`).toBeCloseTo(before[i].x, 12);
      expect(after[i].y, `bone ${i} has not slid along the path`).toBeCloseTo(before[i].y, 12);
      expect(after[i].z, `bone ${i} has not slid along the path`).toBeCloseTo(before[i].z, 12);
    }
    // And it is a bend, not a straight line drawn twice.
    const head = before[1].clone().sub(before[0]).normalize();
    const tail = before[before.length - 1].clone().sub(before[before.length - 2]).normalize();
    expect(head.dot(tail)).toBeLessThan(0.99);
  });

  it('STOPS AT THE END of a path too short for it: the tail runs straight on instead of inventing a path', () => {
    const w = worm();
    // A path holding a quarter of a body: the rest of the chain has
    // nothing to sit on.
    // The corner falls seven tenths of the way through the fourth bone,
    // and the leg after it is a tenth of one: bone 3's station is the
    // last one on the path, and the crumb it must stop at is mostly
    // BEHIND it rather than ahead down the last leg.
    const gap = w.reach[4] - w.reach[3];
    const { path, points, length } = cornerPath(w.reach[3] + gap * 0.7, gap * 0.1);
    const at = lay(w, path, points, newMotion());
    const last = pointAt(path, points, length);
    // Nothing collapsed onto the last crumb and nothing was stretched to
    // reach it: every segment is still its own rest length.
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i].distanceTo(at[i - 1]), `segment ${i} is its rest length`).toBeCloseTo(w.reach[i] - w.reach[i - 1], 9);
    }
    // The first bone whose station is past the end aims at the OLDEST
    // CRUMB — the point `walkPath` stops at — and every bone behind it
    // simply carries that direction on.
    const k = w.reach.findIndex((r) => r > length);
    expect(k).toBe(4);
    const run = at[k].clone().sub(at[k - 1]).normalize();
    const stop = last.clone().sub(pointAt(path, points, w.reach[k - 1])).normalize();
    expect(run.dot(stop), 'the clamped bone aims at the last crumb').toBeCloseTo(1, 9);
    for (let i = k + 1; i < at.length; i += 1) {
      const d = at[i].clone().sub(at[i - 1]).normalize();
      expect(d.dot(run), `bone ${i} runs straight on`).toBeCloseTo(1, 9);
    }
    // And that direction is NOT the path's tangent at its end, so the
    // test can tell a stop from an extrapolation.
    const tail = (points - 1) * 3;
    const tangent = new THREE.Vector3(path[tail] - path[tail - 3], path[tail + 1] - path[tail - 2], path[tail + 2] - path[tail - 1]).normalize();
    expect(run.dot(tangent)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// The stride count
// ---------------------------------------------------------------------------

const DT = 1 / 60;

/** Walk a motion for `seconds` at `mmS` on a body of `lengthMm`, and return the strides it counted. */
function walk(m: RigMotion, mmS: number, lengthMm: number, seconds: number, climbShare = 0): number {
  const body = unitsOfMm(lengthMm);
  const step = unitsOfMm(mmS) * DT;
  const before = m.strides;
  for (let k = 0; k < Math.round(seconds / DT); k += 1) {
    stepMotion(m, { dt: DT, moved: step, climbed: step * climbShare, turned: 0, airborne: false, bodyLength: body, phase: 0.3 });
  }
  return m.strides - before;
}

describe('the stride count (Joshua, 2026-09-09: the aphid\'s legs "kind of was in slow motion")', () => {
  it('counts the queen\'s strides at the old rate — 6.25 a second at her wander — and the aphid\'s at 4.1, not 1.4', () => {
    const queen = newMotion();
    expect(walk(queen, QUEEN.pace.wanderMmS, QUEEN.lengthMm, 1)).toBeCloseTo(6.25, 6);
    // Which is what one fixed stride gave: the two ants are unchanged.
    expect(walk(newMotion(), QUEEN.pace.wanderMmS, QUEEN.lengthMm, 1)).toBeCloseTo((QUEEN.pace.wanderMmS / QUEEN.lengthMm) * STRIDES_PER_LENGTH, 6);
    const aphid = newMotion();
    const strides = walk(aphid, APHID.pace.wanderMmS, APHID.lengthMm, 1);
    expect(strides).toBeCloseTo(strideFrequency(APHID.pace.wanderMmS / APHID.lengthMm), 6);
    expect(strides).toBeGreaterThan(4);
    expect(strides).toBeLessThan(4.2);
    // The old law would have counted 1.4.
    expect((APHID.pace.wanderMmS / APHID.lengthMm) * STRIDES_PER_LENGTH).toBeLessThan(1.5);
    // Fleeing: about 6.3.
    expect(walk(newMotion(), APHID.pace.fleeMmS, APHID.lengthMm, 1)).toBeCloseTo(strideFrequency(APHID.pace.fleeMmS / APHID.lengthMm), 6);
    expect(walk(newMotion(), APHID.pace.fleeMmS, APHID.lengthMm, 1)).toBeGreaterThan(6);
  });

  it('only advances with distance: a stopped animal has still feet, however long it stands, and a lent rig starts at zero', () => {
    const m = newMotion();
    walk(m, 10, 5, 0.5);
    const walked = m.strides;
    expect(walked).toBeGreaterThan(0);
    for (let k = 0; k < 600; k += 1) stepMotion(m, { dt: DT, moved: 0, climbed: 0, turned: 0, airborne: false, bodyLength: 1, phase: 0 });
    expect(m.strides).toBe(walked);
    expect(m.gone).toBeGreaterThan(0);
    // Slowing does not moonwalk: the count is monotone in the distance whatever the pace does.
    let last = m.strides;
    for (let k = 0; k < 300; k += 1) {
      const step = 0.05 * (1 + Math.sin(k / 20));
      stepMotion(m, { dt: DT, moved: step, climbed: 0, turned: 0, airborne: false, bodyLength: 1, phase: 0 });
      expect(m.strides).toBeGreaterThanOrEqual(last);
      last = m.strides;
    }
    resetMotion(m, false);
    expect(m.strides).toBe(0);
    expect(newMotion().strides).toBe(0);
  });

  it('strides on a climb: a body walking straight up, with the 3-D distance handed in, counts the same strides as one walking along', () => {
    const along = walk(newMotion(), 20, 8, 1, 0);
    const up = walk(newMotion(), 20, 8, 1, 1);
    expect(up).toBeCloseTo(along, 9);
  });

  it('reads the flight pitch off the PLANAR speed, derived from the 3-D distance and the climb, so a fly\'s pitch is the number it was', () => {
    // The old signal was planar distance and climb; the new is the 3-D
    // distance and the same climb. The pitch target must be identical.
    const planar = 1.5;
    const climb = 0.5;
    const now = newMotion();
    for (let k = 0; k < 120; k += 1) {
      stepMotion(now, { dt: DT, moved: planar, climbed: 0, turned: 0, airborne: true, bodyLength: 6.5, phase: 0 });
    }
    // One climbing frame with the 3-D distance: the pitch eases toward
    // the target the OLD signal (planar distance, climb) had — the climb
    // rate against the planar speed — and not toward one with the climb
    // in the denominator too.
    const before = { ...now };
    const expectedTarget = Math.atan2(climb / DT, planar / DT) * PITCH_GAIN;
    const wrongTarget = Math.atan2(climb / DT, Math.hypot(planar, climb) / DT) * PITCH_GAIN;
    stepMotion(now, { dt: DT, moved: Math.hypot(planar, climb), climbed: climb, turned: 0, airborne: true, bodyLength: 6.5, phase: 0 });
    expect(now.pitch).toBeGreaterThan(before.pitch);
    const k = 1 - Math.exp(-DT / 0.15);
    expect(now.pitch).toBeCloseTo(before.pitch + (expectedTarget * now.air - before.pitch) * k, 9);
    expect(Math.abs(now.pitch - (before.pitch + (wrongTarget * now.air - before.pitch) * k))).toBeGreaterThan(1e-4);
    // A climb with NO planar travel is a vertical pitch target, not a NaN.
    const vertical = newMotion();
    vertical.air = 1;
    stepMotion(vertical, { dt: DT, moved: climb, climbed: climb, turned: 0, airborne: true, bodyLength: 6.5, phase: 0 });
    expect(Number.isFinite(vertical.pitch)).toBe(true);
    expect(vertical.pitch).toBeGreaterThan(0);
  });
});
