/**
 * THE HANDS ARE JUDGED BY WHERE THEY END UP, IN THE WORLD.
 *
 * `humanReach.reachHands` returns turns; nothing about a turn says whether
 * a fingertip is on a key. So every assertion here APPLIES the returned
 * turns with a LOCAL forward-kinematics pass — the renderer's own
 * accumulation, `A_j = A_parent · R_j`, written out again below rather
 * than borrowed from the module under test — carries the bind-frame joint
 * into the world through the same root the frame described, and asks
 * where it is.
 *
 * Both masters, out of `tests/fixtures/humanBind.json`, seated by
 * `poseSeated({ style: 'sit' })`. The units are `humanFeet.test.ts`'s:
 * one fixture unit is 1.1765 m (`UNITS_PER_METRE` 0.85) and the soles
 * sit at fixture y −1.0 / 1.384083 (`FLOOR_Y`).
 *
 * ─── the desk ─────────────────────────────────────────────────────────
 *
 * The keyboard is the approved prototype's (the renders the rules were
 * agreed from): its keys 0.288 m below the shoulders — a desk top 0.30 m
 * below them, the keyboard 12 mm proud of it — and its middle 0.30 m in
 * front of the seat's pivot, on the body's centre line, the grips ±0.10 m
 * along its length. On Jack the pivot and the chest stand within 3 mm of
 * each other front to back, so this is the prototype's "0.30 in front of
 * the chest"; Sarah's chest stands 4 cm behind her pivot, and placing the
 * desk by the CHAIR is what a desk is.
 *
 * ─── the toon masters (2026-10-07) ────────────────────────────────────
 *
 * The desk is a desk: it stays in metres. The bodies at it changed. Since
 * the toon re-sculpts Jack's fingertip reach is 0.68 m and Sarah's 0.55 m
 * (the scans' were 0.60 and 0.63), so the SAME keyboard sits at 67% of
 * his arm and 82% of hers, and every number below that is a share, an
 * angle at which a hand lets go, or a spot both arms can reach is a fact
 * about the body, re-measured on the toon masters 2026-10-07 and pinned
 * per body in `AT_THE_DESK`. The rules those numbers come out of
 * (`humanReach.ts` header) did not change.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BLEND_TIME,
  CAPSULE_MARGIN_M,
  CAPSULE_RADIUS_M,
  createReach,
  reachHands,
  REST_ABOVE_M,
  REST_ALONG,
  type HandTarget,
  type ReachFrame,
  type ReachResult,
  type ReachState,
} from '../src/actor/humanReach';
import { poseSeated, SEATED_TURNS } from '../src/actor/humanSeated';
import { HUMAN_POSE_TURNS, poseHuman } from '../src/actor/humanPose';
import {
  STANDING,
  type BindJoint,
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

/** Fixture units per metre, and the soles in the fixture's frame (see the header). */
const UNITS_PER_METRE = 0.85;
const FLOOR_Y = -1.0 / 1.384083;

const DT = 1 / 60;
const DEG = Math.PI / 180;

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

interface Posed {
  readonly at: Vec3[];
  readonly acc: Quat[];
}

/** Every joint's position and accumulated rotation, bind frame. The LAST turn naming a joint wins, as in the renderer. */
function posed(bind: readonly BindJoint[], turns: readonly JointTurn[]): Posed {
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
  return { at, acc };
}

/** A bind-frame point in the world, through the frame's root. */
function toWorld(p: Vec3, yaw: number, rootX = 0, rootZ = 0): Vec3 {
  const lx = p.x / UNITS_PER_METRE;
  const lz = p.z / UNITS_PER_METRE;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: rootX + lx * c + lz * s, y: (p.y - FLOOR_Y) / UNITS_PER_METRE, z: rootZ - lx * s + lz * c };
}

/** A bind-frame direction in the world. */
function dirToWorld(d: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Closest approach of two segments (Ericson 5.1.9), written out again. */
function segGap(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (u: Vec3, v: Vec3) => u.x * v.x + u.y * v.y + u.z * v.z;
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const c = dot(d1, r);
  const b = dot(d1, d2);
  const den = a * e - b * b;
  let s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a, 0, 1);
  }
  return Math.hypot(r.x + d1.x * s - d2.x * t, r.y + d1.y * s - d2.y * t, r.z + d1.z * s - d2.z * t);
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

/**
 * What each body measures out to at the desk below. Re-measured on the toon
 * masters 2026-10-07; each figure's own test says what it is.
 */
interface AtTheDesk {
  /** Shoulder to middle fingertip, metres, and shoulder joint to shoulder joint. */
  readonly arm: number;
  readonly shoulders: number;
  /** Either hand's share of its arm, holding the keyboard square on. */
  readonly keyboardShare: number;
  /**
   * Turning the chair right: a heading at which the right arm is still
   * holding but STRETCHED (share over 0.84), or null when it never is; and
   * a heading by which both hands have let go, with what let the right one
   * go — its reach (share past HOLD_OUT) or its angle (past ANGLE_OUT).
   */
  readonly stretchedAt: number | null;
  readonly releasedAt: number;
  readonly rightLetsGoBy: 'reach' | 'angle';
  /** The intercom's button from the keyboard's middle, metres: to the body's left, nearer, above. */
  readonly intercom: { readonly left: number; readonly nearer: number; readonly above: number };
}

const AT_THE_DESK: Readonly<Record<string, AtTheDesk>> = {
  // Short toon arms on narrow shoulders: the keyboard is already 82% of her
  // reach square on, so turning right stretches her right arm to 0.89 by
  // 30° and it lets go by REACH at about 35°; the left lets go by angle
  // at about 80°.
  sarah: {
    arm: 0.552, shoulders: 0.239, keyboardShare: 0.818,
    stretchedAt: 30, releasedAt: 90, rightLetsGoBy: 'reach',
    intercom: { left: 0.17, nearer: 0.12, above: 0.04 },
  },
  // The toon arms are longer than the scan's: square on the keyboard is
  // 67% of his reach, and turning right never stretches the right arm past
  // 0.83 of it — it lets go by ANGLE, at about 118°, not by reach. The left
  // lets go by angle at about 80°, as hers does.
  jack: {
    arm: 0.681, shoulders: 0.336, keyboardShare: 0.666,
    stretchedAt: null, releasedAt: 120, rightLetsGoBy: 'angle',
    intercom: { left: 0.24, nearer: 0.06, above: 0.04 },
  },
};

function seated(body: Body): readonly JointTurn[] {
  const out: MutableJointTurn[] = [];
  return poseSeated(body.measure, body.bind, { style: 'sit', seconds: 0 }, out).map((t) => ({ ...t }));
}

function frameOf(hands: readonly HandTarget[], options: { yaw?: number; seated?: boolean; dt?: number; rootX?: number; rootZ?: number } = {}): ReachFrame {
  return {
    dt: options.dt ?? DT,
    rootX: options.rootX ?? 0,
    rootY: 0,
    rootZ: options.rootZ ?? 0,
    rootYaw: options.yaw ?? 0,
    unitsPerMetre: UNITS_PER_METRE,
    seated: options.seated ?? true,
    hands,
  };
}

interface Bench {
  readonly state: ReachState;
  readonly out: MutableJointTurn[];
}

function bench(body: Body): Bench {
  return { state: createReach(body.measure, body.bind, FLOOR_Y), out: [] };
}

function run(b: Bench, body: Body, input: readonly JointTurn[], frame: ReachFrame, frames: number): ReachResult {
  let result: ReachResult | undefined;
  for (let i = 0; i < frames; i += 1) result = reachHands(b.state, body.measure, body.bind, input, frame, b.out);
  return result as ReachResult;
}

/** Where the seated body's joints stand in the world at yaw 0: the desk is laid out from these. */
function desk(body: Body) {
  const p = posed(body.bind, seated(body));
  const j = body.measure.joints;
  const shoulderY = toWorld(p.at[j.shoulderL], 0).y;
  const left = body.measure.leftSign;
  const keys = { x: 0, y: shoulderY - 0.288, z: 0.3 };
  return {
    keys,
    left,
    gripL: { x: keys.x + 0.1 * left, y: keys.y, z: keys.z },
    gripR: { x: keys.x - 0.1 * left, y: keys.y, z: keys.z },
    axis: { x: 1, y: 0, z: 0 },
  };
}

/**
 * The intercom's button: to the body's left of the keyboard's middle,
 * nearer, and 0.04 m above the keys — the top of a 5 cm box standing on
 * the desk. It has to be a spot the right hand reaches across the body to
 * (under the agreed 85% of the arm) AND one that brings the two arms into
 * conflict, or the crossing tests below test nothing.
 *
 * On the scans one spot did both for both bodies (0.20 left, 0.10 nearer).
 * Re-measured on the toon masters 2026-10-07, NO single spot does: a grid
 * over 0.10-0.26 m left and 0.02-0.15 m nearer found every spot Jack's
 * longer arms come into conflict at (0.19 m left or more) past Sarah's
 * reach, and every spot she reaches leaving his arms 10-20 cm apart. So
 * each body has its own (`AT_THE_DESK`), both chosen to be alike: the
 * right hand at about 80% of its arm, the arms 5-7 cm inside each other's
 * clearance, and a slide of about 9 cm making room — Sarah's 0.17 m left
 * and 0.12 m nearer, Jack's 0.24 m and 0.06 m.
 */
function intercom(body: Body): Vec3 {
  const d = desk(body);
  const at = AT_THE_DESK[body.who].intercom;
  return { x: d.keys.x + at.left * d.left, y: d.keys.y + at.above, z: d.keys.z - at.nearer };
}

function keyboard(body: Body): HandTarget[] {
  const d = desk(body);
  return [
    { side: 'L', ...d.gripL, kind: 'hold', slideAxis: d.axis },
    { side: 'R', ...d.gripR, kind: 'hold', slideAxis: d.axis },
  ];
}

/** Turning to the body's RIGHT is a negative three.js yaw when its left lies along +x. */
function yawRight(body: Body, degrees: number): number {
  return -body.measure.leftSign * degrees * DEG;
}

interface ArmWorld {
  readonly S: Vec3;
  readonly E: Vec3;
  readonly W: Vec3;
  readonly tip: Vec3;
  /** The palm's normal: the bind's −Y carried by the wrist. */
  readonly palm: Vec3;
}

function armsOf(body: Body, state: ReachState, turns: readonly JointTurn[], yaw: number): { L: ArmWorld; R: ArmWorld } {
  const p = posed(body.bind, turns);
  const one = (side: 0 | 1): ArmWorld => {
    const arm = state.arms[side];
    return {
      S: toWorld(p.at[arm.shoulder], yaw),
      E: toWorld(p.at[arm.elbow], yaw),
      W: toWorld(p.at[arm.wrist], yaw),
      tip: toWorld(p.at[arm.tip], yaw),
      palm: dirToWorld(rotate(p.acc[arm.wrist], { x: 0, y: -1, z: 0 }), yaw),
    };
  };
  return { L: one(0), R: one(1) };
}

function armGap(a: ArmWorld, b: ArmWorld): number {
  return Math.min(segGap(a.E, a.W, b.E, b.W), segGap(a.E, a.W, b.S, b.E), segGap(a.S, a.E, b.E, b.W), segGap(a.S, a.E, b.S, b.E));
}

function restPoint(body: Body, turns: readonly JointTurn[], side: 'L' | 'R', yaw: number): Vec3 {
  const p = posed(body.bind, turns);
  const j = body.measure.joints;
  const hip = toWorld(p.at[side === 'L' ? j.hipL : j.hipR], yaw);
  const knee = toWorld(p.at[side === 'L' ? j.kneeL : j.kneeR], yaw);
  return {
    x: hip.x + (knee.x - hip.x) * REST_ALONG,
    y: hip.y + (knee.y - hip.y) * REST_ALONG + REST_ABOVE_M,
    z: hip.z + (knee.z - hip.z) * REST_ALONG,
  };
}

const MEASURED: string[] = [];
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`humanReach measured:\n  ${MEASURED.join('\n  ')}`);
});

const ARM_JOINTS = (body: Body): Set<number> => {
  const j = body.measure.joints;
  return new Set([j.shoulderL, j.elbowL, j.wristL, j.shoulderR, j.elbowR, j.wristR]);
};

describe.each(BODIES)('humanReach on $who', (body) => {
  it('measures the arm to the middle fingertip, and the shoulders apart, in metres', () => {
    const state = createReach(body.measure, body.bind, FLOOR_Y);
    const [L, R] = state.arms;
    const j = body.measure.joints;
    const shoulders = dist(body.bind[j.shoulderL], body.bind[j.shoulderR]) / UNITS_PER_METRE;
    // Re-measured on the toon masters 2026-10-07 (the scans' were Jack 0.60
    // and 0.37, Sarah 0.63 and 0.35). Sarah's fingertip is the END of her
    // mitten — one joint past the wrist, 0.10 m — where Jack's is his
    // middle finger's tip, 0.19 m out.
    const want = AT_THE_DESK[body.who];
    for (const arm of [L, R]) {
      expect(arm.ok).toBe(true);
      expect(arm.tip).not.toBe(arm.wrist);
      expect(Math.abs(arm.length / UNITS_PER_METRE - want.arm)).toBeLessThan(0.01);
    }
    expect(Math.abs(shoulders - want.shoulders)).toBeLessThan(0.01);
    MEASURED.push(
      `${body.who}: arm L ${(L.length / UNITS_PER_METRE).toFixed(3)} m, R ${(R.length / UNITS_PER_METRE).toFixed(3)} m ` +
        `(hand ${(L.hand / UNITS_PER_METRE).toFixed(3)}), shoulders ${shoulders.toFixed(3)} m apart`,
    );
  });

  it('holds a keyboard: fingertips on the grips, palms down, elbows below the shoulders', () => {
    const b = bench(body);
    const input = seated(body);
    const targets = keyboard(body);
    const result = run(b, body, input, frameOf(targets), 30);
    const arms = armsOf(body, b.state, result.turns, 0);
    for (const [side, status, arm, target] of [
      ['L', result.L, arms.L, targets[0]],
      ['R', result.R, arms.R, targets[1]],
    ] as const) {
      expect(status.holding, side).toBe(true);
      expect(status.weight).toBe(1);
      expect(status.yielded).toBe('none');
      // The scans both held it at 0.7 ± 0.08. Re-measured on the toon
      // masters 2026-10-07: 0.67 of Jack's arm and 0.82 of Sarah's — still
      // under the 0.85 a hand takes hold at, which is what "comfortably" is.
      expect(Math.abs(status.share - AT_THE_DESK[body.who].keyboardShare)).toBeLessThanOrEqual(0.01);
      expect(status.share).toBeLessThan(0.85);
      expect(dist(arm.tip, target)).toBeLessThan(0.01);
      const down = Math.acos(clamp(-arm.palm.y / Math.hypot(arm.palm.x, arm.palm.y, arm.palm.z), -1, 1)) / DEG;
      expect(down).toBeLessThan(20);
      expect(arm.E.y).toBeLessThan(arm.S.y);
      MEASURED.push(
        `${body.who} keyboard ${side}: share ${status.share.toFixed(3)}, angle ${status.angle.toFixed(1)}°, ` +
          `tip miss ${(dist(arm.tip, target) * 1000).toFixed(2)} mm, palm ${down.toFixed(1)}° off down, ` +
          `elbow ${((arm.S.y - arm.E.y) * 100).toFixed(1)} cm under the shoulder`,
      );
    }
  });

  it('turns in the chair: holds at 30° right, the right arm stretches, both let go and rest on the thighs', () => {
    // The scans both held at 30°, had the right arm stretched past 0.84 at
    // 45°, and had let both hands go by 90°, the right by its reach. On the
    // toon masters (re-measured 2026-10-07) only the first is still true of
    // both: Sarah's short arm is stretched by 30° and let go by 35°, and
    // Jack's long one never stretches and lets go by ANGLE at about 118°.
    // So the headings come from `AT_THE_DESK`, and what let the right hand
    // go is asserted at the moment it lets go.
    const want = AT_THE_DESK[body.who];
    const b = bench(body);
    const input = seated(body);
    const targets = keyboard(body);
    const at = (degrees: number, frames: number) => run(b, body, input, frameOf(targets, { yaw: yawRight(body, degrees) }), frames);
    at(0, 30);
    // The chair swivels at 90°/s, the way a person turns in one.
    let result = at(0, 1);
    const square = result.R.share;
    for (let d = 1; d <= 30; d += 1.5) result = at(d, 1);
    result = at(30, 30);
    expect(result.L.holding).toBe(true);
    expect(result.R.holding).toBe(true);
    // Turning right carries the keyboard toward the left hand and away from the right.
    expect(result.R.share).toBeGreaterThan(square);
    const at30 = `L ${result.L.share.toFixed(3)} R ${result.R.share.toFixed(3)}`;
    let at45 = 'never stretched';
    if (want.stretchedAt !== null) {
      for (let d = 30; d <= want.stretchedAt; d += 1.5) result = at(d, 1);
      result = at(want.stretchedAt, 30);
      expect(result.L.holding).toBe(true);
      expect(result.R.holding).toBe(true);
      expect(result.R.share).toBeGreaterThan(0.84);
      at45 = `at ${want.stretchedAt}° L ${result.L.share.toFixed(3)} R ${result.R.share.toFixed(3)} (${result.R.angle.toFixed(1)}°)`;
    }
    let widest = 0;
    let letGo: { share: number; angle: number } | null = null;
    for (let d = want.stretchedAt ?? 30; d <= want.releasedAt; d += 1.5) {
      result = at(d, 1);
      if (result.R.holding) widest = Math.max(widest, result.R.share);
      else if (letGo === null) letGo = { share: result.R.share, angle: result.R.angle };
    }
    if (want.stretchedAt === null) expect(widest).toBeLessThanOrEqual(0.84);
    expect(letGo).not.toBeNull();
    if (want.rightLetsGoBy === 'reach') {
      expect(letGo!.share).toBeGreaterThan(0.9);
      expect(Math.abs(letGo!.angle)).toBeLessThanOrEqual(90);
    } else {
      expect(Math.abs(letGo!.angle)).toBeGreaterThan(90);
      expect(letGo!.share).toBeLessThanOrEqual(0.9);
    }
    result = at(want.releasedAt, 60);
    expect(result.L.holding).toBe(false);
    expect(Math.abs(result.L.angle)).toBeGreaterThan(90);
    expect(result.L.angle).toBeGreaterThan(0); // outward
    expect(result.R.holding).toBe(false);
    expect(result.L.weight).toBe(0);
    expect(result.R.weight).toBe(0);
    expect(result.L.rest).toBe(1);
    const yaw = yawRight(body, want.releasedAt);
    const arms = armsOf(body, b.state, result.turns, yaw);
    const restL = restPoint(body, input, 'L', yaw);
    const restR = restPoint(body, input, 'R', yaw);
    expect(dist(arms.L.tip, restL)).toBeLessThan(0.03);
    expect(dist(arms.R.tip, restR)).toBeLessThan(0.03);
    MEASURED.push(
      `${body.who} turning: 30° ${at30}; stretched ${at45}; right let go by ${want.rightLetsGoBy} at share ${letGo!.share.toFixed(3)}, ` +
        `${letGo!.angle.toFixed(1)}°; ${want.releasedAt}° L ${result.L.share.toFixed(3)} at ${result.L.angle.toFixed(1)}°, ` +
        `R ${result.R.share.toFixed(3)} at ${result.R.angle.toFixed(1)}°; rest miss L ${(dist(arms.L.tip, restL) * 1000).toFixed(1)} mm ` +
        `R ${(dist(arms.R.tip, restR) * 1000).toFixed(1)} mm`,
    );
  });

  it('has hysteresis: lets go past 90%, stays let go at 87%, takes hold again under 85%', () => {
    const b = bench(body);
    const input = seated(body);
    const p = posed(body.bind, input);
    const arm = b.state.arms[1];
    const S = toWorld(p.at[arm.shoulder], 0);
    const length = arm.length / UNITS_PER_METRE;
    // Forward, down and a little inward from the right shoulder.
    const d = { x: 0.15 * body.measure.leftSign, y: -0.55, z: 0.82 };
    const n = Math.hypot(d.x, d.y, d.z);
    const at = (share: number): HandTarget => ({
      side: 'R',
      x: S.x + (d.x / n) * share * length,
      y: S.y + (d.y / n) * share * length,
      z: S.z + (d.z / n) * share * length,
      kind: 'hold',
    });
    const steps: Array<[number, boolean]> = [
      [0.8, true],
      [0.88, true],
      [0.91, false],
      [0.87, false],
      [0.84, true],
    ];
    for (const [share, holding] of steps) {
      const result = run(b, body, input, frameOf([at(share)]), 3);
      expect(result.R.share).toBeCloseTo(share, 6);
      expect(result.R.holding, `at ${share}`).toBe(holding);
    }
  });

  it('blends over a quarter second, never more than 0.1 of weight a frame, the same at 30 fps as at 120', () => {
    const input = seated(body);
    const targets = keyboard(body);
    const b = bench(body);
    // Settle at rest on the thighs, then take hold.
    run(b, body, input, frameOf([]), 30);
    let prevWeight = 0;
    let prevTip = armsOf(body, b.state, run(b, body, input, frameOf([]), 1).turns, 0).R.tip;
    let full = -1;
    let worstTip = 0;
    for (let i = 1; i <= 30; i += 1) {
      const result = run(b, body, input, frameOf(targets), 1);
      expect(Math.abs(result.R.weight - prevWeight)).toBeLessThanOrEqual(0.1);
      prevWeight = result.R.weight;
      if (full < 0 && result.R.weight >= 1) full = i;
      const tip = armsOf(body, b.state, result.turns, 0).R.tip;
      worstTip = Math.max(worstTip, dist(tip, prevTip));
      prevTip = tip;
    }
    expect(full * DT).toBeCloseTo(BLEND_TIME, 6);
    // And letting go: the same ramp down.
    for (let i = 1; i <= 30; i += 1) {
      const result = run(b, body, input, frameOf([]), 1);
      expect(Math.abs(result.R.weight - prevWeight)).toBeLessThanOrEqual(0.1);
      prevWeight = result.R.weight;
      const tip = armsOf(body, b.state, result.turns, 0).R.tip;
      worstTip = Math.max(worstTip, dist(tip, prevTip));
      prevTip = tip;
    }
    expect(prevWeight).toBe(0);
    // A fingertip moves like a hand, not a pop: under 4 cm in any 1/60 s.
    expect(worstTip).toBeLessThan(0.04);
    MEASURED.push(`${body.who} blend: full at ${(full * DT).toFixed(3)} s, fastest fingertip ${(worstTip * 1000).toFixed(1)} mm per frame`);

    // Frame-rate independence: the weight is the time in over BLEND_TIME, whatever the rate.
    for (const fps of [30, 60, 120]) {
      const c = bench(body);
      for (let n = 1; n <= fps / 2; n += 1) {
        const result = run(c, body, input, frameOf(targets, { dt: 1 / fps }), 1);
        expect(result.R.weight).toBeCloseTo(Math.min(1, n / fps / BLEND_TIME), 9);
      }
    }
  });

  it('crossing: a hold yields to a press by sliding along the keyboard, clear of the other arm', () => {
    const input = seated(body);
    const d = desk(body);
    const grip: HandTarget = { side: 'L', ...d.gripL, kind: 'hold', slideAxis: d.axis, slideRange: 0.2 };
    const button: HandTarget = { side: 'R', ...intercom(body), kind: 'press' };

    // Without the yield: each arm solved alone, put side by side.
    const alone = (target: HandTarget) => {
      const b = bench(body);
      const result = run(b, body, input, frameOf([target]), 30);
      return armsOf(body, b.state, result.turns, 0);
    };
    const before = armGap(alone(grip).L, alone(button).R);
    // The capsules' own trigger: closer than 2 × radius + margin.
    expect(before).toBeLessThan(2 * CAPSULE_RADIUS_M + CAPSULE_MARGIN_M);

    const b = bench(body);
    const result = run(b, body, input, frameOf([grip, button]), 60);
    const arms = armsOf(body, b.state, result.turns, 0);
    const after = armGap(arms.L, arms.R);
    expect(result.crossed).toBe('R');
    expect(result.gap).toBeCloseTo(before, 3);
    expect(result.R.holding).toBe(true);
    expect(result.R.yielded).toBe('none');
    expect(dist(arms.R.tip, button)).toBeLessThan(0.01);
    if (result.L.yielded === 'slid') {
      expect(result.L.holding).toBe(true);
      expect(after).toBeGreaterThanOrEqual(2 * CAPSULE_RADIUS_M + CAPSULE_MARGIN_M - 1e-9);
      expect(Math.abs(result.L.slid)).toBeGreaterThan(0);
      expect(Math.abs(result.L.slid)).toBeLessThanOrEqual(0.2 + 1e-9);
      // It slid ALONG the keyboard: the fingertip is on the axis through the grip.
      const slidTo = { x: grip.x + d.axis.x * result.L.slid, y: grip.y, z: grip.z };
      expect(dist(arms.L.tip, slidTo)).toBeLessThan(0.01);
    } else {
      expect(result.L.yielded).toBe('let go');
      expect(result.L.holding).toBe(false);
    }
    MEASURED.push(
      `${body.who} crossing: gap ${(before * 1000).toFixed(1)} mm alone -> ${(after * 1000).toFixed(1)} mm; ` +
        `left ${result.L.yielded} ${(result.L.slid * 100).toFixed(0)} cm; button miss ${(dist(arms.R.tip, button) * 1000).toFixed(2)} mm`,
    );
  });

  it('crossing: the arm that crossed yields when IT is the hold and the other the press', () => {
    const input = seated(body);
    const d = desk(body);
    // The same two points, the kinds swapped: now the crossing right hand only holds.
    const grip: HandTarget = { side: 'L', ...d.gripL, kind: 'press' };
    const button: HandTarget = { side: 'R', ...intercom(body), kind: 'hold', slideAxis: d.axis };
    const b = bench(body);
    const result = run(b, body, input, frameOf([grip, button]), 60);
    expect(result.crossed).toBe('R');
    expect(result.L.yielded).toBe('none');
    expect(result.L.holding).toBe(true);
    expect(result.R.yielded).not.toBe('none');
    const arms = armsOf(body, b.state, result.turns, 0);
    expect(dist(arms.L.tip, grip)).toBeLessThan(0.01);
    if (result.R.yielded === 'slid') {
      expect(armGap(arms.L, arms.R)).toBeGreaterThanOrEqual(2 * CAPSULE_RADIUS_M + CAPSULE_MARGIN_M - 1e-9);
      expect(Math.abs(result.R.slid)).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    MEASURED.push(`${body.who} crossing, kinds swapped: right ${result.R.yielded} ${(result.R.slid * 100).toFixed(0)} cm`);
  });

  it('a hold with no slide axis lets go instead of sliding, and rests', () => {
    const input = seated(body);
    const d = desk(body);
    const grip: HandTarget = { side: 'L', ...d.gripL, kind: 'hold' };
    const button: HandTarget = { side: 'R', ...intercom(body), kind: 'press' };
    const b = bench(body);
    const result = run(b, body, input, frameOf([grip, button]), 60);
    expect(result.L.yielded).toBe('let go');
    expect(result.L.holding).toBe(false);
    expect(result.L.weight).toBe(0);
    const arms = armsOf(body, b.state, result.turns, 0);
    expect(dist(arms.L.tip, restPoint(body, input, 'L', 0))).toBeLessThan(0.03);
  });

  it('standing, a free hand is the animation, bit for bit, and every non-arm turn is copied through', () => {
    const out: MutableJointTurn[] = [];
    const input = poseHuman(body.measure, body.bind, STANDING, out).map((t) => ({ ...t }));
    expect(input.length).toBe(HUMAN_POSE_TURNS);
    const b = bench(body);
    const result = run(b, body, input, frameOf([], { seated: false }), 5);
    expect(result.turns.length).toBe(input.length);
    for (let i = 0; i < input.length; i += 1) expect(result.turns[i]).toEqual(input[i]);

    // And seated, holding: everything but the six arm joints is untouched.
    const sit = seated(body);
    const c = bench(body);
    const held = run(c, body, sit, frameOf(keyboard(body)), 20);
    expect(held.turns.length).toBe(SEATED_TURNS);
    const arms = ARM_JOINTS(body);
    let replaced = 0;
    for (let i = 0; i < sit.length; i += 1) {
      expect(held.turns[i].joint).toBe(sit[i].joint);
      if (arms.has(sit[i].joint)) replaced += 1;
      else expect(held.turns[i]).toEqual(sit[i]);
    }
    expect(replaced).toBe(6);
  });

  it('appends the arm joints an input does not name, every frame, after the input', () => {
    const j = body.measure.joints;
    const input: JointTurn[] = [{ joint: j.chest, ax: 1, ay: 0, az: 0, radians: 0.05 }];
    const b = bench(body);
    const idle = run(b, body, input, frameOf([], { seated: false }), 2);
    expect(idle.turns.map((t) => t.joint)).toEqual([j.chest, j.shoulderL, j.elbowL, j.wristL, j.shoulderR, j.elbowR, j.wristR]);
    for (let i = 1; i < 7; i += 1) expect(idle.turns[i].radians).toBe(0);
    expect(idle.turns[0]).toEqual(input[0]);
    const held = run(b, body, input, frameOf(keyboard(body)), 30);
    expect(held.turns.length).toBe(7);
    expect(held.R.holding).toBe(true);
    const arms = armsOf(body, b.state, held.turns, 0);
    expect(dist(arms.R.tip, keyboard(body)[1])).toBeLessThan(0.01);
  });

  it('reaches from the posed shoulders, not the bind, wherever the body stands: a chest leaned forward still lands the fingertip', () => {
    const j = body.measure.joints;
    // An aim pass's turn, appended after the pose: the LAST turn naming a
    // joint wins. It leans the SPINE, which the seated pose also names. On
    // the scans it leaned the chest; re-measured on the toon masters
    // 2026-10-07, Jack's chest joint sits level with his shoulders, so a
    // 12° chest pitch carried them only 7.8 mm and this test's own guard
    // (over 1 cm, below) could no longer tell a leaned shoulder from the
    // bind's. The spine is 0.17 lower and carries them 40 mm.
    const input = seated(body).concat([{ joint: j.spine, ax: 1, ay: 0, az: 0, radians: 12 * DEG }]);
    const yaw = 0.4;
    const rootX = 2;
    const rootZ = -3;
    const place = (t: HandTarget): HandTarget => ({
      ...t,
      x: rootX + t.x * Math.cos(yaw) + t.z * Math.sin(yaw),
      z: rootZ - t.x * Math.sin(yaw) + t.z * Math.cos(yaw),
      slideAxis: undefined,
    });
    const targets = keyboard(body).map(place);
    const b = bench(body);
    const result = run(b, body, input, frameOf(targets, { yaw, rootX, rootZ }), 30);
    const p = posed(body.bind, result.turns);
    const leaned = posed(body.bind, input);
    for (const [side, status, target] of [
      [0, result.L, targets[0]],
      [1, result.R, targets[1]],
    ] as const) {
      const arm = b.state.arms[side];
      expect(status.holding).toBe(true);
      const tip = toWorld(p.at[arm.tip], yaw, rootX, rootZ);
      expect(dist(tip, target)).toBeLessThan(0.01);
      // The share is measured from the LEANED shoulder, not the bind's.
      const shoulder = toWorld(leaned.at[arm.shoulder], yaw, rootX, rootZ);
      expect(status.share).toBeCloseTo(dist(shoulder, target) / (arm.length / UNITS_PER_METRE), 9);
      const bindShoulder = toWorld(body.bind[arm.shoulder], yaw, rootX, rootZ);
      expect(Math.abs(dist(bindShoulder, shoulder))).toBeGreaterThan(0.01);
    }
  });

  it('is mirror-symmetric: the mirrored body reaching mirrored targets is the mirror image, left for right', () => {
    const mirrored: BindJoint[] = body.bind.map((joint) => ({ ...joint, x: -joint.x }));
    const mirror: Body = { who: `${body.who}-mirror`, bind: mirrored, measure: measureHuman(mirrored) };
    const j = body.measure.joints;
    const m = mirror.measure.joints;
    // The mirror's left arm is the original's right, reflected.
    expect(m.shoulderL).toBe(j.shoulderR);
    expect(m.shoulderR).toBe(j.shoulderL);
    const flip = (t: HandTarget): HandTarget => ({ ...t, side: t.side === 'L' ? 'R' : 'L', x: -t.x, slideAxis: t.slideAxis && { ...t.slideAxis, x: -t.slideAxis.x } });
    const d = desk(body);
    const targets: HandTarget[] = [
      { side: 'L', x: d.gripL.x + 0.03, y: d.gripL.y + 0.02, z: d.gripL.z - 0.04, kind: 'hold', slideAxis: d.axis },
      { side: 'R', x: d.gripR.x - 0.05, y: d.gripR.y, z: d.gripR.z + 0.02, kind: 'press' },
    ];
    const a = bench(body);
    const b = bench(mirror);
    const yaw = 0;
    for (let i = 0; i < 20; i += 1) {
      const ra = reachHands(a.state, body.measure, body.bind, seated(body), frameOf(targets, { yaw }), a.out);
      const rb = reachHands(b.state, mirror.measure, mirror.bind, seated(mirror), frameOf(targets.map(flip), { yaw: -yaw }), b.out);
      for (const [x, y] of [
        [ra.L, rb.R],
        [ra.R, rb.L],
      ] as const) {
        expect(y.holding).toBe(x.holding);
        expect(y.weight).toBeCloseTo(x.weight, 12);
        expect(y.share).toBeCloseTo(x.share, 9);
        expect(y.angle).toBeCloseTo(x.angle, 6);
      }
      const pa = posed(body.bind, ra.turns).at;
      const pb = posed(mirror.bind, rb.turns).at;
      for (let k = 0; k < pa.length; k += 1) {
        expect(pb[k].x).toBeCloseTo(-pa[k].x, 9);
        expect(pb[k].y).toBeCloseTo(pa[k].y, 9);
        expect(pb[k].z).toBeCloseTo(pa[k].z, 9);
      }
    }
  });

  it('writes into the same buffers every frame after warm-up, and is deterministic', () => {
    const input = seated(body);
    const d = desk(body);
    const grip: HandTarget = { side: 'L', ...d.gripL, kind: 'hold', slideAxis: d.axis };
    const button: HandTarget = { side: 'R', ...intercom(body), kind: 'press' };
    const frames = [frameOf([grip, button]), frameOf(keyboard(body), { yaw: yawRight(body, 60) }), frameOf([])];
    const a = bench(body);
    const warm = run(a, body, input, frames[0], 3);
    const length = a.out.length;
    for (let i = 0; i < 90; i += 1) {
      const result = reachHands(a.state, body.measure, body.bind, input, frames[i % 3], a.out);
      expect(result).toBe(warm);
      expect(result.turns).toBe(warm.turns);
      expect(result.L).toBe(warm.L);
      expect(a.out.length).toBe(length);
    }
    const x = bench(body);
    const y = bench(body);
    for (let i = 0; i < 60; i += 1) {
      const rx = reachHands(x.state, body.measure, body.bind, input, frames[Math.floor(i / 20)], x.out);
      const ry = reachHands(y.state, body.measure, body.bind, input, frames[Math.floor(i / 20)], y.out);
      expect(rx.turns).toEqual(ry.turns);
      expect(rx.L).toEqual(ry.L);
      expect(rx.R).toEqual(ry.R);
    }
  });
});
