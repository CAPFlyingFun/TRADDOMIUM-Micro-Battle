/**
 * THE FEET ARE JUDGED BY WHERE THEY END UP, IN THE WORLD.
 *
 * `humanFeet.groundFeet` returns turns; nothing about a turn says whether
 * a sole is on a floor. So every assertion here APPLIES the corrected
 * turns with a LOCAL forward-kinematics pass — the renderer's own
 * accumulation, `A_j = A_parent · R_j`, a bone offset carried by its
 * parent's accumulation, written out again below rather than borrowed
 * from the module under test — carries the bind-frame ankle into the
 * world through the same root the frame described, and asks where it is.
 *
 * Both masters, out of `tests/fixtures/humanBind.json`, because the
 * module's tuning is written as fractions of a measured leg precisely so
 * that one set of constants grounds two differently proportioned scans.
 *
 * ─── the fixture's units, and why the numbers below are what they are ─
 *
 * `view/HumanRig.ts` measured the checked-in fixture against the loaded
 * GLBs: the fixture's positions are the bind skeleton ÷ 1.384083, one bind
 * unit is 0.85 m, and the drawn body's soles are at bind y −1.0. So one
 * FIXTURE unit is 1.1765 m — `UNITS_PER_METRE` 0.85 below — and the soles
 * sit at fixture y −1.0 / 1.384083 = −0.7225, which is `FLOOR_Y`. That
 * puts Sarah's ankle 9.6 cm above her soles and her leg at 0.73 m, both
 * human. Nothing asserted here depends on those two being exact: every
 * height is ground + the module's own sole, and every tolerance is in
 * the frame's metres (the 2 mm the brief asks for).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createFeet,
  groundFeet,
  type FeetFrame,
  type FeetState,
  type FootGround,
} from '../src/actor/humanFeet';
import { HUMAN_POSE_TURNS, poseHuman } from '../src/actor/humanPose';
import {
  newJointTurn,
  STANDING,
  type BindJoint,
  type HumanGait,
  type HumanMeasure,
  type JointTurn,
  type MutableJointTurn,
} from '../src/actor/humanRig';
import { measureHuman } from '../src/actor/humanSkeleton';

const FIXTURE = fileURLToPath(new URL('./fixtures/humanBind.json', import.meta.url));

interface BindFixture {
  readonly jack: readonly BindJoint[];
  readonly sarah: readonly BindJoint[];
}

const MASTERS = JSON.parse(readFileSync(FIXTURE, 'utf8')) as BindFixture;

/** Fixture units per metre (see the header). */
const UNITS_PER_METRE = 0.85;
/** The soles, in the fixture's frame (see the header). */
const FLOOR_Y = -1.0 / 1.384083;

const DT = 1 / 60;
const SETTLE = 30;
/** 2 mm, in the frame's metres. */
const MM2 = 0.002;

// ─── local forward kinematics ─────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function quatOf(turn: JointTurn): Quat {
  const half = turn.radians * 0.5;
  const s = Math.sin(half);
  return { x: turn.ax * s, y: turn.ay * s, z: turn.az * s, w: Math.cos(half) };
}

function mul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

function posed(bind: readonly BindJoint[], turns: readonly JointTurn[]): Vec3[] {
  const turnAt = new Map<number, JointTurn>();
  for (const turn of turns) turnAt.set(turn.joint, turn);
  const acc: Quat[] = [];
  const at: Vec3[] = [];
  for (let i = 0; i < bind.length; i += 1) {
    const parent = bind[i].parent;
    expect(parent).toBeLessThan(i);
    const carried = parent < 0 ? { x: 0, y: 0, z: 0, w: 1 } : acc[parent];
    const own = turnAt.get(i);
    acc[i] = own === undefined ? carried : mul(carried, quatOf(own));
    if (parent < 0) {
      at[i] = { x: bind[i].x, y: bind[i].y, z: bind[i].z };
    } else {
      const o = rotate(carried, {
        x: bind[i].x - bind[parent].x,
        y: bind[i].y - bind[parent].y,
        z: bind[i].z - bind[parent].z,
      });
      at[i] = { x: at[parent].x + o.x, y: at[parent].y + o.y, z: at[parent].z + o.z };
    }
  }
  return at;
}

/** A bind-frame point in the world, through the frame's root, lowered by `drop`. */
function toWorld(p: Vec3, frame: FeetFrame, drop: number): Vec3 {
  const lx = p.x / frame.unitsPerMetre;
  const lz = p.z / frame.unitsPerMetre;
  const c = Math.cos(frame.rootYaw);
  const s = Math.sin(frame.rootYaw);
  return {
    x: frame.rootX + lx * c + lz * s,
    y: frame.rootY - drop + (p.y - FLOOR_Y) / frame.unitsPerMetre,
    z: frame.rootZ - lx * s + lz * c,
  };
}

// ─── the bench ────────────────────────────────────────────────────────

interface Body {
  readonly who: string;
  readonly bind: readonly BindJoint[];
  readonly measure: HumanMeasure;
}

const BODIES: readonly Body[] = (['sarah', 'jack'] as const).map((who) => ({
  who,
  bind: MASTERS[who],
  measure: measureHuman(MASTERS[who]),
}));

type Ground = (x: number, z: number) => FootGround | null;

const flat = (y = 0, grip = 1): Ground => () => ({ y, grip });

interface FrameOptions {
  readonly released?: boolean;
  readonly rootX?: number;
  readonly rootY?: number;
  readonly rootZ?: number;
  readonly yaw?: number;
}

function frameOver(ground: Ground, options: FrameOptions = {}): FeetFrame {
  return {
    dt: DT,
    released: options.released ?? false,
    rootX: options.rootX ?? 0,
    rootY: options.rootY ?? 0,
    rootZ: options.rootZ ?? 0,
    rootYaw: options.yaw ?? 0,
    unitsPerMetre: UNITS_PER_METRE,
    groundAt: (x, z) => ground(x, z),
  };
}

function animated(body: Body, gait: HumanGait = STANDING): readonly JointTurn[] {
  const out: MutableJointTurn[] = [];
  // A copy, so a later pose into the same buffer cannot move it.
  return poseHuman(body.measure, body.bind, gait, out).map((t) => ({ ...t }));
}

interface Step {
  readonly turns: readonly JointTurn[];
  readonly rootDrop: number;
  readonly frame: FeetFrame;
}

function run(state: FeetState, body: Body, turns: readonly JointTurn[], frame: FeetFrame, frames: number, out: MutableJointTurn[]): Step {
  let result = groundFeet(state, body.measure, body.bind, turns, frame, out);
  for (let i = 1; i < frames; i += 1) result = groundFeet(state, body.measure, body.bind, turns, frame, out);
  return { turns: result.turns.map((t) => ({ ...t })), rootDrop: result.rootDrop, frame };
}

function newBench(body: Body): { state: FeetState; out: MutableJointTurn[] } {
  return { state: createFeet(body.measure, body.bind, FLOOR_Y), out: [] };
}

interface Leg {
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
}

function legs(body: Body): readonly [Leg, Leg] {
  const j = body.measure.joints;
  return [
    { hip: j.hipL, knee: j.kneeL, ankle: j.ankleL },
    { hip: j.hipR, knee: j.kneeR, ankle: j.ankleR },
  ];
}

function isLegJoint(body: Body, joint: number): boolean {
  return legs(body).some((leg) => leg.hip === joint || leg.knee === joint || leg.ankle === joint);
}

function sole(body: Body, leg: Leg): number {
  return (body.bind[leg.ankle].y - FLOOR_Y) / UNITS_PER_METRE;
}

function ankleWorld(body: Body, step: Step, leg: Leg): Vec3 {
  return toWorld(posed(body.bind, step.turns)[leg.ankle], step.frame, step.rootDrop);
}

function animatedAnkleWorld(body: Body, turns: readonly JointTurn[], frame: FeetFrame, drop: number, leg: Leg): Vec3 {
  return toWorld(posed(body.bind, turns)[leg.ankle], frame, drop);
}

/** Output has the input's length and order, and every non-leg turn is the input's. */
function expectShape(body: Body, input: readonly JointTurn[], output: readonly JointTurn[]): void {
  expect(output.length).toBe(input.length);
  for (let i = 0; i < input.length; i += 1) {
    expect(output[i].joint).toBe(input[i].joint);
    if (!isLegJoint(body, input[i].joint)) {
      expect(output[i]).toEqual({ joint: input[i].joint, ax: input[i].ax, ay: input[i].ay, az: input[i].az, radians: input[i].radians });
    }
  }
}

/** The same rotation, compared by quaternion (an axis is arbitrary at zero angle). */
function expectSameTurn(a: JointTurn, b: JointTurn, tolerance: number): void {
  const qa = quatOf(a);
  const qb = quatOf(b);
  const dot = Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w);
  // 2·acos(|dot|) is the angle between them; acos is ill-conditioned near 1,
  // so the chord is compared instead: |q_a ∓ q_b| ≈ angle / 2.
  const chord = Math.sqrt(Math.max(0, 2 - 2 * dot));
  expect(chord).toBeLessThan(tolerance / 2 + 1e-12);
}

function expectLegsAnimated(body: Body, input: readonly JointTurn[], output: readonly JointTurn[], only?: Leg): void {
  for (let i = 0; i < input.length; i += 1) {
    const joint = input[i].joint;
    const inLeg = only
      ? only.hip === joint || only.knee === joint || only.ankle === joint
      : isLegJoint(body, joint);
    if (inLeg) expectSameTurn(output[i], input[i], 1e-6);
  }
}

/**
 * The knee is never behind the hip → ankle line: its offset from that line
 * has no part pointing backward, where forward is +Z made perpendicular to
 * the leg (both masters face +Z).
 */
function expectKneeForward(body: Body, turns: readonly JointTurn[]): void {
  const at = posed(body.bind, turns);
  for (const leg of legs(body)) {
    const h = at[leg.hip];
    const k = at[leg.knee];
    const a = at[leg.ankle];
    const d = { x: a.x - h.x, y: a.y - h.y, z: a.z - h.z };
    const len = Math.hypot(d.x, d.y, d.z);
    d.x /= len;
    d.y /= len;
    d.z /= len;
    const kv = { x: k.x - h.x, y: k.y - h.y, z: k.z - h.z };
    const along = kv.x * d.x + kv.y * d.y + kv.z * d.z;
    const perp = { x: kv.x - d.x * along, y: kv.y - d.y * along, z: kv.z - d.z * along };
    const f = { x: -d.x * d.z, y: -d.y * d.z, z: 1 - d.z * d.z };
    const fl = Math.hypot(f.x, f.y, f.z);
    const forward = (perp.x * f.x + perp.y * f.y + perp.z * f.z) / fl;
    expect(forward).toBeGreaterThan(-1e-6);
  }
}

/** Ground raised or lowered on one side of the body's centre line (world x, yaw 0). */
function sided(body: Body, leftY: number, rightY: number): Ground {
  const left = body.measure.leftSign;
  return (x) => {
    if (x * left > 0.02) return { y: leftY, grip: 1 };
    if (x * left < -0.02) return { y: rightY, grip: 1 };
    return { y: 0, grip: 1 };
  };
}

// ─── the tests ────────────────────────────────────────────────────────

describe.each(BODIES)('humanFeet on $who', (body) => {
  const [legL, legR] = legs(body);

  it('stands on a flat floor exactly as animated, with no drop (the dead zone)', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    const step = run(state, body, input, frameOver(flat()), SETTLE, out);
    expectShape(body, input, step.turns);
    for (let i = 0; i < input.length; i += 1) expect(step.turns[i]).toEqual(input[i]);
    expect(step.rootDrop).toBe(0);
    // And both feet are planted and holding the world.
    expect(state.feet[0].weight).toBe(1);
    expect(state.feet[1].weight).toBe(1);
    expect(state.feet[0].locked).toBe(true);
    expect(state.feet[1].locked).toBe(true);
    expectKneeForward(body, step.turns);
  });

  it('puts the left foot up a step and leaves the right alone', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    const frame = frameOver(sided(body, 0.08, 0));
    const step = run(state, body, input, frame, SETTLE, out);
    expectShape(body, input, step.turns);

    const left = ankleWorld(body, step, legL);
    expect(Math.abs(left.y - (0.08 + sole(body, legL)))).toBeLessThan(MM2);

    const right = ankleWorld(body, step, legR);
    const rightWas = animatedAnkleWorld(body, input, frame, 0, legR);
    expect(Math.hypot(right.x - rightWas.x, right.y - rightWas.y, right.z - rightWas.z)).toBeLessThan(MM2);
    expect(step.rootDrop).toBe(0);
    expectKneeForward(body, step.turns);
    // The step is taken by the knee, and the foot keeps its level.
    expectLegsAnimated(body, input, step.turns, legR);
  });

  it('lowers the body onto ground below both feet', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    const step = run(state, body, input, frameOver(flat(-0.05)), SETTLE, out);
    expectShape(body, input, step.turns);
    expect(step.rootDrop).toBeGreaterThan(0.04);
    expect(step.rootDrop).toBeLessThan(0.0501);
    for (const leg of [legL, legR]) {
      const at = ankleWorld(body, step, leg);
      expect(Math.abs(at.y - (-0.05 + sole(body, leg)))).toBeLessThan(MM2);
    }
    expectKneeForward(body, step.turns);
  });

  it('lets go while released: the legs are the animation again, and the body comes back up', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    // Grounded on a step and a dip first, so there is a correction to let go of.
    const ground: Ground = (x) => ({ y: x * body.measure.leftSign > 0 ? 0.04 : -0.05, grip: 1 });
    const grounded = run(state, body, input, frameOver(ground), SETTLE, out);
    expect(grounded.rootDrop).toBeGreaterThan(0.01);
    const step = run(state, body, input, frameOver(ground, { released: true }), SETTLE, out);
    expectShape(body, input, step.turns);
    expectLegsAnimated(body, input, step.turns);
    expect(state.feet[0].weight).toBe(0);
    expect(state.feet[1].weight).toBe(0);
    expect(state.feet[0].locked).toBe(false);
    expect(state.feet[1].locked).toBe(false);
    expect(step.rootDrop).toBeLessThan(0.001);
  });

  it('holds a planted foot where it stands while the body moves over it', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    // Facing +X (yaw π/2), so moving rootX is moving FORWARD.
    const yaw = Math.PI / 2;
    const settled = run(state, body, input, frameOver(flat(), { yaw }), SETTLE, out);
    expect(state.feet[0].locked).toBe(true);
    const held = ankleWorld(body, settled, legL);
    for (let i = 1; i <= 5; i += 1) {
      const step = run(state, body, input, frameOver(flat(), { yaw, rootX: 0.02 * i }), 1, out);
      expectShape(body, input, step.turns);
      const at = ankleWorld(body, step, legL);
      expect(Math.hypot(at.x - held.x, at.z - held.z)).toBeLessThan(MM2);
      expectKneeForward(body, step.turns);
    }
    expect(state.feet[0].locked).toBe(true);
  });

  it('slips with the animation on ground that has no grip', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    const yaw = Math.PI / 2;
    const ice = flat(0, 0);
    const settled = run(state, body, input, frameOver(ice, { yaw }), SETTLE, out);
    const start = ankleWorld(body, settled, legL);
    let last: Step = settled;
    for (let i = 1; i <= 5; i += 1) last = run(state, body, input, frameOver(ice, { yaw, rootX: 0.02 * i }), 1, out);
    const at = ankleWorld(body, last, legL);
    const anim = animatedAnkleWorld(body, input, last.frame, last.rootDrop, legL);
    expect(Math.hypot(at.x - anim.x, at.z - anim.z)).toBeLessThan(MM2);
    expect(at.x - start.x).toBeGreaterThan(0.09);
  });

  it('lets a foot over a ledge go, and leaves that leg as animated', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    run(state, body, input, frameOver(flat()), SETTLE, out);
    expect(state.feet[0].weight).toBe(1);
    const step = run(state, body, input, frameOver(sided(body, -1.0, 0)), SETTLE, out);
    expectShape(body, input, step.turns);
    expect(state.feet[0].weight).toBe(0);
    expect(state.feet[0].locked).toBe(false);
    expect(state.feet[1].weight).toBe(1);
    expectLegsAnimated(body, input, step.turns, legL);
    expect(step.rootDrop).toBe(0);
  });

  it.each([0.1, 0.25, 0.4, 0.6, 0.75, 0.9])('walks at phase %f with every foot on the floor or above it by its lift', (phase) => {
    const { state, out } = newBench(body);
    const gait: HumanGait = { stance: 'walk', phase, seconds: 0, lean: 0 };
    const input = animated(body, gait);
    const frame = frameOver(flat());
    const step = run(state, body, input, frame, SETTLE, out);
    expectShape(body, input, step.turns);
    expectKneeForward(body, step.turns);

    // The lift each foot is given, measured off the animation: the lower
    // sole is on the floor and the other stands above it by that much.
    const animatedAt = posed(body.bind, input);
    const soles = [legL, legR].map((leg) => (animatedAt[leg.ankle].y - body.bind[leg.ankle].y) / UNITS_PER_METRE);
    const low = Math.min(soles[0], soles[1]);
    [legL, legR].forEach((leg, i) => {
      const at = ankleWorld(body, step, leg);
      expect(Math.abs(at.y - (sole(body, leg) + soles[i] - low))).toBeLessThan(MM2);
    });
    // A walking stride spreads the legs, so the hips have to come down to
    // the floor: nothing in the pose bobs the pelvis, and this is what does.
    // How far is the body's own: Jack's bind legs slope back 5.6°, so a
    // small forward swing brings his leading leg nearer vertical and
    // raises its foot by millimetres (2.3 at phase 0.1), where Sarah's
    // dead-straight legs rise by centimetres.
    expect(step.rootDrop).toBeGreaterThan(0.001);
    if (phase === 0.25 || phase === 0.75) expect(step.rootDrop).toBeGreaterThan(0.02);
  });

  it('writes into a longer buffer and still returns exactly the input, every frame the same array', () => {
    const { state } = newBench(body);
    const out = Array.from({ length: HUMAN_POSE_TURNS + 5 }, newJointTurn);
    const input = animated(body);
    const frame = frameOver(sided(body, 0.08, 0));
    const first = groundFeet(state, body.measure, body.bind, input, frame, out);
    const second = groundFeet(state, body.measure, body.bind, input, frame, out);
    expect(first.turns.length).toBe(input.length);
    expect(second.turns).toBe(first.turns);
    expect(out.length).toBe(HUMAN_POSE_TURNS + 5);
    expectShape(body, input, second.turns);
  });

  it('is deterministic: two bodies fed the same frames agree to the bit', () => {
    const a = newBench(body);
    const b = newBench(body);
    const input = animated(body, { stance: 'walk', phase: 0.3, seconds: 1.2, lean: 0.2 });
    const frame = frameOver(sided(body, 0.03, -0.02), { yaw: 0.7, rootX: 3, rootZ: -2 });
    const ra = run(a.state, body, input, frame, 17, a.out);
    const rb = run(b.state, body, input, frame, 17, b.out);
    expect(ra.turns).toEqual(rb.turns);
    expect(ra.rootDrop).toBe(rb.rootDrop);
  });
});
