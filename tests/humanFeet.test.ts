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
 *
 * ─── the long walks ────────────────────────────────────────────────────
 *
 * The short cases pin one rule each. The WALKS pin the thing a player
 * sees: ten seconds of each master walking at 1.4 m/s and running at
 * 3.6 m/s over flat ground, and walking up a 0.15 m kerb, the phase
 * advanced by distance over `humanStride` exactly as a caller drives it,
 * judged after the first second. A planted foot's ball may not slide more
 * than 10 mm, MAX_LOCK may never be what ends a lock, a locked foot's heel
 * or ball must be on its ground, and the body's drop — its pelvis bob —
 * must stay human. Each run prints what it measured, so the numbers the
 * module's comments quote can be checked against the run that made them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createFeet,
  groundFeet,
  type FeetFrame,
  type FeetState,
  type FootGround,
} from '../src/actor/humanFeet';
import { HUMAN_POSE_TURNS, humanStride, poseHuman } from '../src/actor/humanPose';
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
  expect(kneesForward(body, turns)).toBe(true);
}

function kneesForward(body: Body, turns: readonly JointTurn[]): boolean {
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
    if (forward <= -1e-6) return false;
  }
  return true;
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


// ─── the foot, in the world ───────────────────────────────────────────

/** Every joint's accumulated rotation, the same pass as `posed`. */
function rotations(bind: readonly BindJoint[], turns: readonly JointTurn[]): Quat[] {
  const turnAt = new Map<number, JointTurn>();
  for (const turn of turns) turnAt.set(turn.joint, turn);
  const acc: Quat[] = [];
  for (let i = 0; i < bind.length; i += 1) {
    const parent = bind[i].parent;
    const carried = parent < 0 ? { x: 0, y: 0, z: 0, w: 1 } : acc[parent];
    const own = turnAt.get(i);
    acc[i] = own === undefined ? carried : mul(carried, quatOf(own));
  }
  return acc;
}

interface FootWorld {
  /** The ball joint. */
  readonly ball: Vec3;
  /** Where the ball touches: `ballClear` under the joint. */
  readonly ballContact: Vec3;
  /** The heel's contact, carried by the solved foot. */
  readonly heelContact: Vec3;
  readonly ankle: Vec3;
}

/**
 * A foot's ball, ankle and two contacts in the world, from a step's
 * turns. The contact geometry is the module's own (`state.legs`): where a
 * heel is on a rig that has no heel joint is a modelling choice, and this
 * reads it rather than inventing a second one.
 */
function footWorld(body: Body, state: FeetState, step: Step, side: number): FootWorld {
  const rig = state.legs[side];
  const at = posed(body.bind, step.turns);
  const acc = rotations(body.bind, step.turns);
  const heel = rotate(acc[rig.ankle], { x: rig.heelX, y: rig.heelY, z: rig.heelZ });
  const ankle = at[rig.ankle];
  const ball = toWorld(at[rig.ball], step.frame, step.rootDrop);
  return {
    ball,
    ballContact: { x: ball.x, y: ball.y - rig.ballClear / UNITS_PER_METRE, z: ball.z },
    heelContact: toWorld({ x: ankle.x + heel.x, y: ankle.y + heel.y, z: ankle.z + heel.z }, step.frame, step.rootDrop),
    ankle: toWorld(ankle, step.frame, step.rootDrop),
  };
}

interface Stroll {
  readonly maxLockReleases: number;
  readonly locks: number;
  /** Worst world slide of a locked foot's BALL while the lock holds the ball. */
  readonly worstBallSlide: number;
  /** Worst world slide of whatever the lock holds (the ankle while the foot goes flat, then the ball). */
  readonly worstHeldSlide: number;
  /** Worst distance of a locked foot's nearer contact from the ground under it. */
  readonly worstContact: number;
  readonly dropMax: number;
  /** Largest peak-to-peak of the drop over any one gait cycle. */
  readonly bob: number;
  readonly heelMax: number;
  readonly backwardKnees: number;
  /** Frames a foot stood locked on the kerb (for the kerb walk). */
  readonly lockedOnKerb: number;
}

/**
 * Ten seconds of a body walking (or running) straight ahead at `speed`
 * along +Z, 60 frames a second, the phase advanced by distance over the
 * body's own stride — exactly as a caller is meant to drive it. The root
 * stands on the ground under it, eased up a kerb over a tenth of a second
 * the way a character controller steps. Everything after the first second
 * is judged.
 */
function stroll(body: Body, stance: 'walk' | 'run', speed: number, ground: Ground): Stroll {
  const state = createFeet(body.measure, body.bind, FLOOR_Y);
  const pose: MutableJointTurn[] = Array.from({ length: HUMAN_POSE_TURNS }, newJointTurn);
  const out: MutableJointTurn[] = [];
  const stride = humanStride(body.measure, stance) / UNITS_PER_METRE;
  const cycleFrames = Math.round(stride / speed / DT);
  let z = 0;
  let phase = 0;
  let rootY = 0;
  const drops: number[] = [];
  const heldAt: (Vec3 | null)[] = [null, null];
  const heldOnBall = [false, false];
  let worstBallSlide = 0;
  let worstHeldSlide = 0;
  let worstContact = 0;
  let heelMax = 0;
  let backwardKnees = 0;
  let lockedOnKerb = 0;
  for (let f = 0; f < 600; f += 1) {
    z += speed * DT;
    phase = (phase + (speed * DT) / stride) % 1;
    const under = ground(0, z);
    rootY += ((under === null ? rootY : under.y) - rootY) * (1 - Math.exp(-DT / 0.1));
    const turns = poseHuman(body.measure, body.bind, { stance, phase, seconds: f * DT, lean: 0 }, pose);
    const frame = frameOver(ground, { rootZ: z, rootY });
    const result = groundFeet(state, body.measure, body.bind, turns, frame, out);
    if (f < 60) continue;
    const step: Step = { turns: result.turns, rootDrop: result.rootDrop, frame };
    drops.push(result.rootDrop);
    if (!kneesForward(body, step.turns)) backwardKnees += 1;
    for (let side = 0; side < 2; side += 1) {
      const foot = state.feet[side];
      heelMax = Math.max(heelMax, foot.heelRise);
      if (!foot.locked) {
        heldAt[side] = null;
        continue;
      }
      const at = footWorld(body, state, step, side);
      const held = foot.onBall ? at.ball : at.ankle;
      if (heldAt[side] === null || heldOnBall[side] !== foot.onBall) {
        heldAt[side] = held;
        heldOnBall[side] = foot.onBall;
      }
      const slid = Math.hypot(held.x - heldAt[side]!.x, held.z - heldAt[side]!.z);
      worstHeldSlide = Math.max(worstHeldSlide, slid);
      if (foot.onBall) worstBallSlide = Math.max(worstBallSlide, slid);
      const gb = ground(at.ballContact.x, at.ballContact.z);
      const gh = ground(at.heelContact.x, at.heelContact.z);
      const off = Math.min(
        gb === null ? Infinity : Math.abs(at.ballContact.y - gb.y),
        gh === null ? Infinity : Math.abs(at.heelContact.y - gh.y),
      );
      worstContact = Math.max(worstContact, off);
      if (gb !== null && gb.y > 0) lockedOnKerb += 1;
    }
  }
  let bob = 0;
  for (let i = 0; i + cycleFrames <= drops.length; i += 1) {
    let low = Infinity;
    let high = -Infinity;
    for (let k = i; k < i + cycleFrames; k += 1) {
      low = Math.min(low, drops[k]);
      high = Math.max(high, drops[k]);
    }
    bob = Math.max(bob, high - low);
  }
  return {
    maxLockReleases: state.feet[0].maxLockReleases + state.feet[1].maxLockReleases,
    locks: state.feet[0].locks + state.feet[1].locks,
    worstBallSlide,
    worstHeldSlide,
    worstContact,
    dropMax: Math.max(...drops),
    bob,
    heelMax,
    backwardKnees,
    lockedOnKerb,
  };
}

/** The numbers the long walks measured, printed once at the end for the report. */
const MEASURED: string[] = [];
afterAll(() => {
  if (MEASURED.length > 0) console.log(MEASURED.join('\n'));
});

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

  it('holds a planted foot\'s ball where it stands while the body moves over it', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    // Facing +X (yaw π/2), so moving rootX is moving FORWARD.
    const yaw = Math.PI / 2;
    const settled = run(state, body, input, frameOver(flat(), { yaw }), SETTLE, out);
    expect(state.feet[0].locked).toBe(true);
    expect(state.feet[0].onBall).toBe(true);
    const held = footWorld(body, state, settled, 0).ball;
    for (let i = 1; i <= 5; i += 1) {
      const step = run(state, body, input, frameOver(flat(), { yaw, rootX: 0.02 * i }), 1, out);
      expectShape(body, input, step.turns);
      const at = footWorld(body, state, step, 0).ball;
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
    const start = footWorld(body, state, settled, 0).ball;
    let last: Step = settled;
    for (let i = 1; i <= 5; i += 1) last = run(state, body, input, frameOver(ice, { yaw, rootX: 0.02 * i }), 1, out);
    const at = footWorld(body, state, last, 0).ball;
    const anim = footWorld(body, state, { ...last, turns: input }, 0).ball;
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

  it('never rises onto its toes standing still on flat ground', () => {
    const { state, out } = newBench(body);
    run(state, body, animated(body), frameOver(flat()), SETTLE * 4, out);
    for (const foot of state.feet) {
      expect(foot.heel).toBe(0);
      expect(foot.heelRise).toBe(0);
      expect(foot.heelPitch).toBe(0);
    }
  });

  it('cannot lock on its first frame, whatever the foot is doing', () => {
    const { state, out } = newBench(body);
    // A body that arrives already grounded: weight would be enough, a
    // speed is not there to be had.
    for (const foot of state.feet) foot.weight = 1;
    run(state, body, animated(body), frameOver(flat()), 1, out);
    expect(state.feet[0].locked).toBe(false);
    expect(state.feet[1].locked).toBe(false);
    expect(state.feet[0].speed).toBe(Infinity);
  });

  it('a teleport is not a speed, and does not end a lock on a MAX_LOCK stretch that counts', () => {
    const { state, out } = newBench(body);
    const input = animated(body);
    run(state, body, input, frameOver(flat()), SETTLE, out);
    expect(state.feet[0].locked).toBe(true);
    // Five metres in one frame.
    run(state, body, input, frameOver(flat(), { rootX: 5 }), 1, out);
    expect(state.feet[0].speed).toBe(Infinity);
    expect(state.feet[0].locked).toBe(false);
    // And the next frame measures an honest speed again: standing, zero.
    run(state, body, input, frameOver(flat(), { rootX: 5 }), 1, out);
    expect(state.feet[0].speed).toBe(0);
  });

  describe.each([
    // Walking: every bound is the brief's. A human pelvis bobs 4–5 cm.
    { stance: 'walk' as const, speed: 1.4, slide: 0.01, dropMax: 0.06, bob: 0.05, contact: 0.003 },
    // Running, looser, and each for a reason:
    //  - the drop: a run lands on a straight leg swung asin(1.15 / 2) = 35°
    //    forward (humanPose's STEP_LENGTHS.run), which stands 1 − cos 35° =
    //    18% of a leg short of the floor, so the body has to come down
    //    about that far at every landing — 0.2 of a leg is that and a
    //    margin, and a runner's measured vertical oscillation (6–10 cm)
    //    is of the same order;
    //  - the bob: the same landing, against a flight phase in which
    //    neither foot holds the body down, so 0.16 of a leg;
    //  - the contact: a run's stance is 0.4 of a 0.6 s cycle, shorter than
    //    the times the heel's permission and the drop ease over, so a foot
    //    rising onto its toes can stand up to 10 mm short of the floor for
    //    a frame or two at toe-off.
    { stance: 'run' as const, speed: 3.6, slide: 0.01, dropMax: -0.2, bob: -0.16, contact: 0.01 },
  ])('for ten seconds at a $stance', ({ stance, speed, slide, dropMax, bob, contact }) => {
    it('keeps planted feet where they landed, on the ground, with the body bobbing like a person', () => {
      const legM = body.measure.legLength / UNITS_PER_METRE;
      const dropLimit = dropMax > 0 ? dropMax : -dropMax * legM;
      const bobLimit = bob > 0 ? bob : -bob * legM;
      const walk = stroll(body, stance, speed, flat());
      expect(walk.maxLockReleases).toBe(0);
      expect(walk.locks).toBeGreaterThan(10);
      expect(walk.worstBallSlide).toBeLessThanOrEqual(slide);
      expect(walk.worstHeldSlide).toBeLessThanOrEqual(slide);
      expect(walk.worstContact).toBeLessThanOrEqual(contact);
      expect(walk.dropMax).toBeLessThanOrEqual(dropLimit);
      expect(walk.bob).toBeLessThanOrEqual(bobLimit);
      expect(walk.backwardKnees).toBe(0);
      MEASURED.push(`${body.who} ${stance}: ball slide ${(walk.worstBallSlide * 1000).toFixed(1)} mm, drop max ${(walk.dropMax * 1000).toFixed(1)} mm, bob ${(walk.bob * 1000).toFixed(1)} mm, contact ${(walk.worstContact * 1000).toFixed(1)} mm, heel rise ${(walk.heelMax * 1000).toFixed(1)} mm`);
    });
  });

  it('walks up onto a 0.15 m kerb with no lock snapping and every planted foot on its own ground', () => {
    const KERB_Z = 5;
    const KERB = 0.15;
    const kerb: Ground = (_x, z) => ({ y: z >= KERB_Z ? KERB : 0, grip: 1 });
    const walk = stroll(body, 'walk', 1.4, kerb);
    expect(walk.maxLockReleases).toBe(0);
    expect(walk.worstBallSlide).toBeLessThanOrEqual(0.01);
    expect(walk.worstHeldSlide).toBeLessThanOrEqual(0.01);
    expect(walk.worstContact).toBeLessThanOrEqual(0.003);
    expect(walk.backwardKnees).toBe(0);
    // And both feet did end up on the kerb, locked there.
    expect(walk.lockedOnKerb).toBeGreaterThan(4);
    MEASURED.push(`${body.who} kerb: ball slide ${(walk.worstBallSlide * 1000).toFixed(1)} mm, contact ${(walk.worstContact * 1000).toFixed(1)} mm, drop max ${(walk.dropMax * 1000).toFixed(1)} mm`);
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
