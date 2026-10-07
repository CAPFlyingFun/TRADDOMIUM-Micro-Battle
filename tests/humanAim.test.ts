/**
 * A LOOK IS JUDGED BY WHERE IT POINTS, IN THE WORLD.
 *
 * `humanAim.aimBody` returns turns and a body yaw; nothing about a turn
 * says whether Sarah is looking at Jack. So every assertion here APPLIES
 * the returned turns with a LOCAL forward-kinematics pass — the
 * renderer's own accumulation, `A_j = A_parent · R_j`, written out again
 * below rather than borrowed from the module under test — carries the
 * skull's forward and the eye into the world through the root the frame
 * described, turned by `rootYaw + bodyYaw`, and asks the angle between
 * that ray and the target.
 *
 * Both masters, out of `tests/fixtures/humanBind.json`, in its own units:
 * UNITS_PER_METRE 0.85 and FLOOR_Y −1/1.384083 (see `humanFeet.test.ts`'s
 * header for where those come from). Each case prints what it measured.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  aimBody,
  createAim,
  CHEST,
  EYE_FORWARD_FRAC,
  EYE_UP_FRAC,
  NECK,
  SKULL,
  SPINE,
  YAW_LIMITS,
  type AimFrame,
  type AimPoint,
  type AimResult,
  type AimState,
} from '../src/actor/humanAim';
import { HUMAN_POSE_TURNS, poseHuman } from '../src/actor/humanPose';
import {
  newJointTurn,
  STANDING,
  type BindJoint,
  type HumanMeasure,
  type JointTurn,
  type MutableJointTurn,
} from '../src/actor/humanRig';
import { poseSeated, SEATED_TURNS } from '../src/actor/humanSeated';
import { measureHuman } from '../src/actor/humanSkeleton';

const FIXTURE = fileURLToPath(new URL('./fixtures/humanBind.json', import.meta.url));

interface BindFixture {
  readonly jack: readonly BindJoint[];
  readonly sarah: readonly BindJoint[];
}

const MASTERS = JSON.parse(readFileSync(FIXTURE, 'utf8')) as BindFixture;

const UNITS_PER_METRE = 0.85;
const FLOOR_Y = -1.0 / 1.384083;
const DT = 1 / 60;
const DEG = Math.PI / 180;
/** Three seconds at 60 fps: every stage is many time constants settled. */
const SETTLE_FRAMES = 180;

// A root that is not the origin and a yaw that is not zero, so the
// world-to-bind seam is exercised in every case.
const ROOT = { x: 2.5, y: 0.3, z: -4.0 };
const ROOT_YAW = 0.7;

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

/** Every joint's accumulated rotation and position, bind frame. The renderer applies turns in order, last wins. */
function posed(bind: readonly BindJoint[], turns: readonly JointTurn[]): { acc: Quat[]; at: Vec3[] } {
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
  return { acc, at };
}

/** A bind-frame point in the world through the root, turned by `yaw`. */
function toWorld(p: Vec3, yaw: number): Vec3 {
  const lx = p.x / UNITS_PER_METRE;
  const lz = p.z / UNITS_PER_METRE;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: ROOT.x + lx * c + lz * s, y: ROOT.y + (p.y - FLOOR_Y) / UNITS_PER_METRE, z: ROOT.z - lx * s + lz * c };
}

/** A bind-frame DIRECTION in the world, turned by `yaw`. */
function dirToWorld(d: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
}

// ─── the bench ────────────────────────────────────────────────────────

interface Body {
  readonly who: string;
  readonly bind: readonly BindJoint[];
  readonly measure: HumanMeasure;
  /** The skull joint, by the rule the brief gives (TMB-Story's). */
  readonly skull: number;
}

const BODIES: readonly Body[] = (['sarah', 'jack'] as const).map((who) => {
  const bind = MASTERS[who];
  const measure = measureHuman(bind);
  const crownParent = bind[measure.joints.head].parent;
  const skull = crownParent >= 0 && crownParent !== measure.joints.neck ? crownParent : measure.joints.head;
  return { who, bind, measure, skull };
});

/** The eye, bind frame, from the documented definition — not from the module. */
function eyeOf(body: Body, turns: readonly JointTurn[]): { eye: Vec3; look: Vec3 } {
  const { acc, at } = posed(body.bind, turns);
  const s = body.bind[body.skull];
  const c = body.bind[body.measure.joints.head];
  const span = Math.hypot(c.x - s.x, c.y - s.y, c.z - s.z);
  const off = rotate(acc[body.skull], {
    x: EYE_UP_FRAC * (c.x - s.x),
    y: EYE_UP_FRAC * (c.y - s.y),
    z: EYE_UP_FRAC * (c.z - s.z) + EYE_FORWARD_FRAC * span,
  });
  const p = at[body.skull];
  return { eye: { x: p.x + off.x, y: p.y + off.y, z: p.z + off.z }, look: rotate(acc[body.skull], { x: 0, y: 0, z: 1 }) };
}

/** Where the skull's forward points in the world, and the angle to `target` from the eye. */
function worldLook(body: Body, result: AimResult, target: AimPoint): { error: number; eye: Vec3; look: Vec3; yawTo: number; pitchTo: number; lookPitch: number } {
  const { eye, look } = eyeOf(body, result.turns);
  const yaw = ROOT_YAW + result.bodyYaw;
  const e = toWorld(eye, yaw);
  const l = dirToWorld(look, yaw);
  const d = { x: target.x - e.x, y: target.y - e.y, z: target.z - e.z };
  const dl = Math.hypot(d.x, d.y, d.z);
  const cos = (d.x * l.x + d.y * l.y + d.z * l.z) / dl;
  return {
    error: Math.acos(Math.min(1, Math.max(-1, cos))),
    eye: e,
    look: l,
    yawTo: Math.atan2(d.x, d.z),
    pitchTo: Math.atan2(d.y, Math.hypot(d.x, d.z)),
    lookPitch: Math.atan2(l.y, Math.hypot(l.x, l.z)),
  };
}

function standing(body: Body): readonly JointTurn[] {
  const out: MutableJointTurn[] = [];
  return poseHuman(body.measure, body.bind, STANDING, out).map((t) => ({ ...t }));
}

function seated(body: Body): readonly JointTurn[] {
  const out: MutableJointTurn[] = [];
  return poseSeated(body.measure, body.bind, { style: 'sit', seconds: 0 }, out).map((t) => ({ ...t }));
}

/**
 * A world point `metres` from the ANIMATED eye, `right` radians to the
 * body's right (through `leftSign`: the right lies toward −leftSign·X in
 * the bind) and `up` radians above the horizontal.
 */
function targetAt(body: Body, turns: readonly JointTurn[], right: number, up: number, metres: number): AimPoint {
  const { eye } = eyeOf(body, turns);
  const e = toWorld(eye, ROOT_YAW);
  const L = body.measure.leftSign < 0 ? -1 : 1;
  const bindDir = { x: -L * Math.sin(right) * Math.cos(up), y: Math.sin(up), z: Math.cos(right) * Math.cos(up) };
  const w = dirToWorld(bindDir, ROOT_YAW);
  return { x: e.x + w.x * metres, y: e.y + w.y * metres, z: e.z + w.z * metres };
}

function frameFor(target: AimPoint | null, bodyFree: boolean, weight?: number, dt = DT): AimFrame {
  return {
    dt,
    rootX: ROOT.x,
    rootY: ROOT.y,
    rootZ: ROOT.z,
    rootYaw: ROOT_YAW,
    unitsPerMetre: UNITS_PER_METRE,
    target,
    bodyFree,
    weight,
  };
}

interface Run {
  readonly state: AimState;
  readonly out: MutableJointTurn[];
  result: AimResult;
}

function run(body: Body, turns: readonly JointTurn[], frame: AimFrame, frames: number, into?: Run): Run {
  const r: Run = into ?? { state: createAim(body.measure, body.bind, FLOOR_Y), out: [], result: undefined as unknown as AimResult };
  for (let i = 0; i < frames; i += 1) r.result = aimBody(r.state, body.measure, body.bind, turns, frame, r.out);
  return r;
}

/** Two turns name the same rotation (q or −q), to `tol` in quaternion components. */
function sameRotation(a: JointTurn, b: JointTurn, tol: number): boolean {
  const qa = quatOf(a);
  const qb = quatOf(b);
  const d = Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w);
  // |<qa,qb>| = cos(θ/2) of the rotation between them.
  return 2 * Math.acos(Math.min(1, d)) <= tol;
}

const fmt = (r: number) => (r / DEG).toFixed(3);

/**
 * How far a target on the left may come out from the mirror of the same
 * target on the right, ON THE BODY ITSELF — the bind's own asymmetry. Re-
 * measured on the toon masters 2026-10-07; see the mirror test for why
 * Sarah's is wider.
 */
const MIRROR_TOLERANCE: Readonly<Record<string, number>> = { jack: 0.5 * DEG, sarah: 2 * DEG };

// ─── the cases ────────────────────────────────────────────────────────

describe.each(BODIES)('humanAim — $who', (body) => {
  const turns = standing(body);

  it('finds the skull by the crown-parent rule and appends it after the animation', () => {
    const state = createAim(body.measure, body.bind, FLOOR_Y);
    expect(state.skull).toBe(body.skull);
    expect(state.skull).not.toBe(body.measure.joints.head);
    expect(state.stageJoint[SKULL]).toBe(body.skull);
    expect(state.stageJoint[NECK]).toBe(body.measure.joints.neck);
    expect(state.stageJoint[CHEST]).toBe(body.measure.joints.chest);
    expect(state.stageJoint[SPINE]).toBe(body.measure.joints.spine);

    const out: MutableJointTurn[] = [];
    const r = aimBody(state, body.measure, body.bind, turns, frameFor(null, true), out);
    // poseHuman names spine, chest and neck; the skull is appended.
    expect(turns.length).toBe(HUMAN_POSE_TURNS);
    expect(r.turns.length).toBe(HUMAN_POSE_TURNS + 1);
    for (let i = 0; i < turns.length; i += 1) expect(r.turns[i].joint).toBe(turns[i].joint);
    expect(r.turns[HUMAN_POSE_TURNS].joint).toBe(body.skull);

    // poseSeated names the CROWN, not the skull: sixteen in, seventeen out.
    const sit = seated(body);
    const out2: MutableJointTurn[] = [];
    const r2 = aimBody(createAim(body.measure, body.bind, FLOOR_Y), body.measure, body.bind, sit, frameFor(null, true), out2);
    expect(sit.length).toBe(SEATED_TURNS);
    expect(r2.turns.length).toBe(SEATED_TURNS + 1);
    for (let i = 0; i < sit.length; i += 1) expect(r2.turns[i].joint).toBe(sit[i].joint);
    expect(r2.turns[SEATED_TURNS].joint).toBe(body.skull);

    // A list that already names the skull comes back the same length, turned in place.
    const withSkull = [...turns, { joint: body.skull, ax: 0, ay: 1, az: 0, radians: 0 }];
    const r3 = run(body, withSkull, frameFor(targetAt(body, turns, 20 * DEG, 0, 2), true), 60);
    expect(r3.result.turns.length).toBe(withSkull.length);
    expect(r3.result.turns[withSkull.length - 1].joint).toBe(body.skull);
    expect(r3.result.turns[withSkull.length - 1].radians).toBeGreaterThan(10 * DEG);
  });

  it('a target straight ahead at eye height leaves the animation exactly as it was', () => {
    const target = targetAt(body, turns, 0, 0, 2);
    const r = run(body, turns, frameFor(target, true), SETTLE_FRAMES);
    for (let i = 0; i < turns.length; i += 1) {
      expect(r.result.turns[i].joint).toBe(turns[i].joint);
      expect(sameRotation(r.result.turns[i], turns[i], 1e-6)).toBe(true);
    }
    expect(Math.abs(r.result.turns[turns.length].radians)).toBeLessThan(1e-6);
    expect(Math.abs(r.result.bodyYaw)).toBeLessThan(1e-9);
    expect(r.result.onTarget).toBe(true);
    const seen = worldLook(body, r.result, target);
    console.log(`[aim ${body.who}] ahead: error ${fmt(seen.error)}°`);
    expect(seen.error).toBeLessThan(1e-6);
  });

  it('30° to the right settles on target with the head, the torso barely moving and the body still', () => {
    const target = targetAt(body, turns, 30 * DEG, 0, 1.5);
    const r = run(body, turns, frameFor(target, true), SETTLE_FRAMES);
    const seen = worldLook(body, r.result, target);
    const s = r.state;
    console.log(
      `[aim ${body.who}] 30° right: error ${fmt(seen.error)}°, module ${fmt(r.result.error)}°, skull ${fmt(s.yaw[SKULL])} neck ${fmt(s.yaw[NECK])} chest ${fmt(s.yaw[CHEST])} spine ${fmt(s.yaw[SPINE])} body ${fmt(r.result.bodyYaw)}`,
    );
    expect(seen.error).toBeLessThan(2 * DEG);
    expect(Math.abs(seen.error - r.result.error)).toBeLessThan(1e-6);
    expect(r.result.onTarget).toBe(true);
    expect(Math.abs(r.result.bodyYaw)).toBeLessThan(1e-9);
    expect(Math.abs(s.yaw[CHEST])).toBeLessThan(2 * DEG);
    expect(Math.abs(s.yaw[SPINE])).toBeLessThan(2 * DEG);
    // Mostly skull: a glance this size is not shared equally.
    expect(Math.abs(s.yaw[SKULL])).toBeGreaterThan(5 * Math.abs(s.yaw[NECK]));
    // To the body's RIGHT: toward −leftSign·X, which is negative rotation.y when leftSign is +1.
    expect(Math.sign(r.result.headYaw)).toBe(-Math.sign(body.measure.leftSign));
    // The ray the module publishes is the ray the test measured.
    expect(Math.hypot(s.eye.x - seen.eye.x, s.eye.y - seen.eye.y, s.eye.z - seen.eye.z)).toBeLessThan(1e-9);
    expect(Math.hypot(s.look.x - seen.look.x, s.look.y - seen.look.y, s.look.z - seen.look.z)).toBeLessThan(1e-9);
  });

  it('100° to the right: the body takes what the head and torso cannot, or the look falls short', () => {
    const target = targetAt(body, turns, 100 * DEG, 0, 2);
    const free = run(body, turns, frameFor(target, true), SETTLE_FRAMES);
    const seenFree = worldLook(body, free.result, target);
    const s = free.state;
    const headNeck = Math.abs(s.yaw[SKULL] + s.yaw[NECK]);
    const total = Math.abs(free.result.headYaw + free.result.bodyYaw);
    console.log(
      `[aim ${body.who}] 100° free: error ${fmt(seenFree.error)}°, skull ${fmt(s.yaw[SKULL])} neck ${fmt(s.yaw[NECK])} chest ${fmt(s.yaw[CHEST])} spine ${fmt(s.yaw[SPINE])} body ${fmt(free.result.bodyYaw)} total ${fmt(total)}`,
    );
    expect(seenFree.error).toBeLessThan(2 * DEG);
    expect(free.result.onTarget).toBe(true);
    expect(Math.abs(Math.abs(s.yaw[SKULL]) - YAW_LIMITS[SKULL])).toBeLessThan(0.5 * DEG);
    expect(Math.abs(Math.abs(s.yaw[NECK]) - YAW_LIMITS[NECK])).toBeLessThan(0.5 * DEG);
    expect(headNeck).toBeGreaterThan(69 * DEG);
    // The body is the remainder: what the head and torso together do not turn.
    expect(Math.abs(free.result.bodyYaw)).toBeGreaterThan(0.5 * DEG);
    // Head and body together face the target from where the eye now IS —
    // not the nominal 100°, which was measured from the unturned eye, and
    // the eye rides 9 cm ahead of the skull and further from the root.
    const faced = free.result.headYaw + free.result.bodyYaw;
    expect(Math.abs(Math.atan2(Math.sin(seenFree.yawTo - ROOT_YAW - faced), Math.cos(seenFree.yawTo - ROOT_YAW - faced)))).toBeLessThan(2 * DEG);
    expect(total).toBeGreaterThan(90 * DEG);
    expect(Math.sign(free.result.bodyYaw)).toBe(Math.sign(free.result.headYaw));

    // With the body held, 100° is exactly the chain's reach (40 + 30 + 15
    // + 15) and the eye's parallax brings the need under it, so it is
    // REACHED — measured, not assumed:
    const edge = run(body, turns, frameFor(target, false), SETTLE_FRAMES);
    console.log(
      `[aim ${body.who}] 100° held: error ${fmt(edge.result.error)}°, head ${fmt(edge.result.headYaw)} body ${fmt(edge.result.bodyYaw)}`,
    );
    expect(edge.result.bodyYaw).toBe(0);
    // … and past the reach the look falls short with the head at its limits.
    const beyond = targetAt(body, turns, 115 * DEG, 0, 2);
    const held = run(body, turns, frameFor(beyond, false), SETTLE_FRAMES);
    const seenHeld = worldLook(body, held.result, beyond);
    console.log(
      `[aim ${body.who}] 115° held: error ${fmt(seenHeld.error)}°, skull ${fmt(held.state.yaw[SKULL])} neck ${fmt(held.state.yaw[NECK])} head ${fmt(held.result.headYaw)} body ${fmt(held.result.bodyYaw)}`,
    );
    expect(held.result.onTarget).toBe(false);
    expect(Math.abs(seenHeld.error - held.result.error)).toBeLessThan(1e-6);
    expect(held.result.bodyYaw).toBe(0);
    expect(Math.abs(Math.abs(held.state.yaw[SKULL]) - YAW_LIMITS[SKULL])).toBeLessThan(0.5 * DEG);
    expect(Math.abs(Math.abs(held.state.yaw[NECK]) - YAW_LIMITS[NECK])).toBeLessThan(0.5 * DEG);
    // Well past the reach it is plainly short, and still at the limits.
    const far = run(body, turns, frameFor(targetAt(body, turns, 130 * DEG, 0, 2), false), SETTLE_FRAMES);
    expect(far.result.onTarget).toBe(false);
    expect(far.result.error).toBeGreaterThan(20 * DEG);
    expect(Math.abs(Math.abs(far.state.yaw[SKULL]) - YAW_LIMITS[SKULL])).toBeLessThan(1e-9);
  });

  it('seated, 22° up at a standing face 0.85 m away: pitch lands within 2°', () => {
    // The seated animation pitches the head down 8°; the aim has to undo
    // that as well as reach up.
    const sit = seated(body);
    const target = targetAt(body, sit, 0, 22 * DEG, 0.85 / Math.cos(22 * DEG));
    const r = run(body, sit, frameFor(target, true), SETTLE_FRAMES);
    const seen = worldLook(body, r.result, target);
    console.log(
      `[aim ${body.who}] seated 22° up: error ${fmt(seen.error)}°, look pitch ${fmt(seen.lookPitch)}° vs ${fmt(seen.pitchTo)}°, headPitch ${fmt(r.result.headPitch)}`,
    );
    expect(seen.error).toBeLessThan(2 * DEG);
    expect(Math.abs(seen.lookPitch - seen.pitchTo)).toBeLessThan(2 * DEG);
    expect(r.result.headPitch).toBeGreaterThan(22 * DEG);
    expect(r.result.onTarget).toBe(true);
    // The breath and the slump survive underneath: the spine keeps its animated turn.
    expect(sameRotation(r.result.turns[0], sit[0], 1e-9)).toBe(true);
  });

  it('turns in the human order: the head arrives before the torso, the torso before the body', () => {
    for (const degrees of [60, 120]) {
      const target = targetAt(body, turns, degrees * DEG, 0, 2);
      const settled = run(body, turns, frameFor(target, true), 600);
      const shares = { skull: settled.state.yaw[SKULL], chest: settled.state.yaw[CHEST], body: settled.state.body };
      const r = run(body, turns, frameFor(null, true), 5);
      run(body, turns, frameFor(target, true), 9, r); // t = 0.15 s
      const frac = (now: number, share: number) => (Math.abs(share) > 1e-6 ? now / share : 1);
      const skull = frac(r.state.yaw[SKULL], shares.skull);
      const chest = frac(r.state.yaw[CHEST], shares.chest);
      const bodyFrac = frac(r.state.body, shares.body);
      const seen = worldLook(body, r.result, target);
      console.log(
        `[aim ${body.who}] step to ${degrees}°: at 0.15 s skull ${(skull * 100).toFixed(0)}% chest ${(chest * 100).toFixed(0)}% body ${Math.abs(shares.body) > 1e-6 ? (bodyFrac * 100).toFixed(0) + '%' : 'no share'}; look ${fmt(seen.error)}° off`,
      );
      expect(skull).toBeGreaterThan(chest);
      if (Math.abs(shares.body) > 1e-6) {
        expect(skull).toBeGreaterThan(bodyFrac);
        expect(chest).toBeGreaterThan(bodyFrac);
      }
    }
  });

  it('a target behind turns the body the short way, and follows it across 180° without a flip', () => {
    const right = run(body, turns, frameFor(targetAt(body, turns, 170 * DEG, 0, 2), true), SETTLE_FRAMES);
    const left = run(body, turns, frameFor(targetAt(body, turns, -170 * DEG, 0, 2), true), SETTLE_FRAMES);
    const rightSign = -Math.sign(body.measure.leftSign);
    console.log(
      `[aim ${body.who}] behind: 170° right body ${fmt(right.result.bodyYaw)} error ${fmt(right.result.error)}°; 170° left body ${fmt(left.result.bodyYaw)} error ${fmt(left.result.error)}°`,
    );
    expect(Math.sign(right.result.bodyYaw)).toBe(rightSign);
    expect(Math.sign(left.result.bodyYaw)).toBe(-rightSign);
    expect(Math.abs(right.result.headYaw + right.result.bodyYaw)).toBeLessThan(175 * DEG);
    expect(Math.abs(left.result.headYaw + left.result.bodyYaw)).toBeLessThan(175 * DEG);
    expect(right.result.onTarget).toBe(true);
    expect(left.result.onTarget).toBe(true);

    // Sweep from 160° right, through dead behind, to 200° right, at 20°/s.
    const r = run(body, turns, frameFor(targetAt(body, turns, 160 * DEG, 0, 2), true), SETTLE_FRAMES);
    let prevBody = r.result.bodyYaw;
    let prevHead = r.result.headYaw;
    let worstStep = 0;
    for (let i = 1; i <= 120; i += 1) {
      const deg = 160 + (40 * i) / 120;
      run(body, turns, frameFor(targetAt(body, turns, deg * DEG, 0, 2), true), 1, r);
      worstStep = Math.max(worstStep, Math.abs(r.result.bodyYaw - prevBody), Math.abs(r.result.headYaw - prevHead));
      prevBody = r.result.bodyYaw;
      prevHead = r.result.headYaw;
    }
    run(body, turns, frameFor(targetAt(body, turns, 200 * DEG, 0, 2), true), SETTLE_FRAMES, r);
    console.log(
      `[aim ${body.who}] sweep 160→200°: worst per-frame step ${fmt(worstStep)}°, ends body ${fmt(r.result.bodyYaw)} total ${fmt(r.result.bodyYaw + r.result.headYaw)} error ${fmt(r.result.error)}°`,
    );
    expect(worstStep).toBeLessThan(1 * DEG);
    // It went ON round, not back: the total turn is past 180° to the right
    // (short of the nominal 200° by the eye's parallax as the body swings).
    const turned = r.result.bodyYaw + r.result.headYaw;
    expect(Math.sign(turned)).toBe(rightSign);
    expect(Math.abs(turned)).toBeGreaterThan(185 * DEG);
    expect(r.result.onTarget).toBe(true);
  });

  it('copies every non-aim turn unchanged, allocates nothing after warm-up, and is deterministic', () => {
    const target = targetAt(body, turns, 45 * DEG, 10 * DEG, 1.2);
    const a = run(body, turns, frameFor(target, true), 3);
    const turnsRef = a.result.turns;
    const outLength = a.out.length;
    const resultRef = a.result;
    run(body, turns, frameFor(target, true), 60, a);
    expect(a.result).toBe(resultRef);
    expect(a.result.turns).toBe(turnsRef);
    expect(a.out.length).toBe(outLength);

    const aim = new Set([body.measure.joints.spine, body.measure.joints.chest, body.measure.joints.neck, body.skull]);
    for (let i = 0; i < turns.length; i += 1) {
      if (aim.has(turns[i].joint)) continue;
      expect(a.result.turns[i]).toEqual(turns[i]);
    }

    // An `out` longer than needed: the view is reused, not rebuilt.
    const long: MutableJointTurn[] = Array.from({ length: 40 }, newJointTurn);
    const b = { state: createAim(body.measure, body.bind, FLOOR_Y), out: long, result: undefined as unknown as AimResult };
    run(body, turns, frameFor(target, true), 2, b);
    const view = b.result.turns;
    expect(view.length).toBe(HUMAN_POSE_TURNS + 1);
    run(body, turns, frameFor(target, true), 10, b);
    expect(b.result.turns).toBe(view);
    expect(long.length).toBe(40);

    // Same inputs, same outputs, bit for bit.
    const c = run(body, turns, frameFor(target, true), 63);
    expect(c.result.turns.map((t) => ({ ...t }))).toEqual(a.result.turns.map((t) => ({ ...t })));
    expect(c.result.bodyYaw).toBe(a.result.bodyYaw);
  });

  it('mirrors: a target on the left gives the mirrored yaws of the same target on the right', () => {
    for (const degrees of [25, 80, 140]) {
      const r = run(body, turns, frameFor(targetAt(body, turns, degrees * DEG, 5 * DEG, 1.5), true), SETTLE_FRAMES);
      const l = run(body, turns, frameFor(targetAt(body, turns, -degrees * DEG, 5 * DEG, 1.5), true), SETTLE_FRAMES);
      console.log(
        `[aim ${body.who}] mirror ${degrees}°: head ${fmt(r.result.headYaw)} / ${fmt(l.result.headYaw)}, body ${fmt(r.result.bodyYaw)} / ${fmt(l.result.bodyYaw)}, pitch ${fmt(r.result.headPitch)} / ${fmt(l.result.headPitch)}`,
      );
      // The masters are not perfectly symmetric, so on the body itself the
      // mirror holds within a tolerance. The scans' crowns sat 3-11 mm off
      // the midline and half a degree held for both. Re-measured on the toon
      // masters 2026-10-07: Jack's crown is on the midline and his pairs
      // still agree within 0.4°, but Sarah's crown joint sits 45 mm (bind)
      // to her right of her pelvis and 23 mm behind her neck, which carries
      // her eye off the midline and leans her neck chain one way: her 80°
      // pair comes out 0.79° apart and her 140° bodies 1.66° (37.06 /
      // 38.72). The test below this one shows that is HER and not the
      // solver — her mirror image reproduces it to a millionth of a degree.
      const tolerance = MIRROR_TOLERANCE[body.who];
      expect(Math.abs(r.result.headYaw + l.result.headYaw)).toBeLessThan(tolerance);
      expect(Math.abs(r.result.bodyYaw + l.result.bodyYaw)).toBeLessThan(tolerance);
      expect(Math.abs(r.result.headPitch - l.result.headPitch)).toBeLessThan(tolerance);
      expect(Math.sign(r.result.headYaw)).toBe(-Math.sign(body.measure.leftSign));
    }
  });

  it('is exactly mirror-symmetric: the mirrored body looking right is this body looking left', () => {
    // Every bind x negated: the same person reflected, whose right is this
    // body's left. Whatever asymmetry the test above has to tolerate is in
    // the bind; the solver adds none.
    const reflected = body.bind.map((joint) => ({ ...joint, x: -joint.x }));
    const mirror: Body = { ...body, who: `${body.who}-mirror`, bind: reflected, measure: measureHuman(reflected) };
    const mirrorTurns = standing(mirror);
    for (const degrees of [25, 80, 140]) {
      const l = run(body, turns, frameFor(targetAt(body, turns, -degrees * DEG, 5 * DEG, 1.5), true), SETTLE_FRAMES);
      const m = run(mirror, mirrorTurns, frameFor(targetAt(mirror, mirrorTurns, degrees * DEG, 5 * DEG, 1.5), true), SETTLE_FRAMES);
      expect(m.result.headYaw).toBeCloseTo(-l.result.headYaw, 8);
      expect(m.result.bodyYaw).toBeCloseTo(-l.result.bodyYaw, 8);
      expect(m.result.headPitch).toBeCloseTo(l.result.headPitch, 8);
    }
  });

  it('dt = 0 holds, weight blends, a null target relaxes, and a target at the eye is not a NaN', () => {
    const target = targetAt(body, turns, 50 * DEG, -10 * DEG, 1.5);
    const r = run(body, turns, frameFor(target, true), 20);
    const before = r.result.turns.map((t) => ({ ...t }));
    const beforeBody = r.result.bodyYaw;
    run(body, turns, frameFor(target, true, undefined, 0), 5, r);
    expect(r.result.turns.map((t) => ({ ...t }))).toEqual(before);
    expect(r.result.bodyYaw).toBe(beforeBody);

    run(body, turns, frameFor(target, true), SETTLE_FRAMES, r);
    const full = { head: r.result.headYaw, pitch: r.result.headPitch, body: r.result.bodyYaw };
    run(body, turns, frameFor(target, true, 0.5), 1, r);
    expect(r.result.headYaw).toBeCloseTo(full.head * 0.5, 9);
    expect(r.result.headPitch).toBeCloseTo(full.pitch * 0.5, 9);
    expect(r.result.bodyYaw).toBeCloseTo(full.body * 0.5, 9);
    run(body, turns, frameFor(target, true, 0), 1, r);
    for (let i = 0; i < turns.length; i += 1) expect(r.result.turns[i]).toEqual(turns[i]);
    expect(r.result.bodyYaw).toBe(0);

    run(body, turns, frameFor(null, true), SETTLE_FRAMES, r);
    expect(r.result.onTarget).toBe(false);
    expect(Math.abs(r.result.headYaw)).toBeLessThan(1e-3 * DEG);
    expect(Math.abs(r.result.headPitch)).toBeLessThan(1e-3 * DEG);
    expect(Math.abs(r.result.bodyYaw)).toBeLessThan(1e-3 * DEG);

    // A target exactly at the eye, and one straight overhead.
    const { eye } = eyeOf(body, r.result.turns);
    const at = toWorld(eye, ROOT_YAW + r.result.bodyYaw);
    run(body, turns, frameFor(at, true), 30, r);
    const over = { x: at.x, y: at.y + 1, z: at.z };
    run(body, turns, frameFor(over, true), 30, r);
    for (const t of r.result.turns) {
      expect(Number.isFinite(t.radians) && Number.isFinite(t.ax) && Number.isFinite(t.ay) && Number.isFinite(t.az)).toBe(true);
    }
    expect(Number.isFinite(r.result.bodyYaw) && Number.isFinite(r.result.headYaw) && Number.isFinite(r.result.error)).toBe(true);
    expect(r.state.yaw[SPINE]).toBeCloseTo(0, 9);
  });
});
