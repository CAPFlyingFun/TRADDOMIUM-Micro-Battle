/**
 * THE POSE IS JUDGED BY WHERE THE BODY ENDS UP, NOT BY THE ANGLES IT WAS
 * ASKED FOR.
 *
 * Every assertion here APPLIES the turns `poseHuman` returns — plain
 * quaternion arithmetic over the bind positions, the same accumulation
 * the renderer does (`A_j = A_parent · R_j`, a bone offset carried by its
 * parent's accumulation) — and then asks about the resulting skeleton.
 * That is deliberate and it is the whole value of the file: a test that
 * checked "the shoulder was turned 77.5° about Z" would pass with the
 * sign inverted, with the left and right arms swapped, and with an elbow
 * bending a neck. A test that checks "the wrist is below the shoulder
 * and nearer the centre line" cannot.
 *
 * It runs against BOTH masters out of `tests/fixtures/humanBind.json` —
 * Sarah's 35 joints and Jack's 69 — because the pose's amplitudes are
 * written as fractions of a measured limb precisely so that one set of
 * constants is right for two differently proportioned scans.
 *
 * The joints are resolved by a small LOCAL helper rather than by
 * `src/actor/humanSkeleton.ts`. `humanPose` compiles against the
 * `HumanMeasure` contract alone, and a test that reached for the other
 * module would stop being able to say which of the two was wrong.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HUMAN_POSE_TURNS, poseHuman } from '../src/actor/humanPose';
import {
  newJointTurn,
  type BindJoint,
  type HumanGait,
  type HumanJoints,
  type HumanMeasure,
  type JointTurn,
  type MutableJointTurn,
} from '../src/actor/humanRig';

const DEG = Math.PI / 180;

/**
 * Both masters are authored at 1.700 m from the soles to the crown
 * (`src/tombs/LabPeople.ts`), so a millimetre is that fraction of the
 * body's own measured span. Using the JOINT span understates the body's
 * height — the head joint sits inside the skull — which only makes the
 * tolerance stricter than the millimetre asked for.
 */
const MASTER_HEIGHT_MM = 1700;

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

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

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
  // v + 2 q_vec × (q_vec × v + w v), the standard sandwich without the
  // second multiply.
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function unit(v: Vec3): Vec3 {
  const len = length(v);
  return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * The turns applied, exactly as the renderer will apply them: a joint's
 * accumulated world turn is its parent's times its own, and the offset
 * from a parent is rotated by the PARENT'S accumulation. A turn on a
 * joint therefore moves everything below it and nothing above it, which
 * is the property every assertion below leans on.
 */
function posed(bind: readonly BindJoint[], turns: readonly JointTurn[]): Vec3[] {
  const turnAt = new Map<number, JointTurn>();
  for (const turn of turns) {
    expect(turnAt.has(turn.joint)).toBe(false);
    turnAt.set(turn.joint, turn);
  }

  const accumulated: Quat[] = [];
  const at: Vec3[] = [];
  for (let i = 0; i < bind.length; i += 1) {
    const parent = bind[i].parent;
    // The fixture stores parents before their children; the accumulation
    // below is a single forward pass only because that holds.
    expect(parent).toBeLessThan(i);
    const carried = parent < 0 ? IDENTITY : accumulated[parent];
    const own = turnAt.get(i);
    accumulated[i] = own === undefined ? carried : mul(carried, quatOf(own));
    if (parent < 0) {
      at[i] = { x: bind[i].x, y: bind[i].y, z: bind[i].z };
    } else {
      const offset = rotate(carried, sub(bind[i], bind[parent]));
      at[i] = { x: at[parent].x + offset.x, y: at[parent].y + offset.y, z: at[parent].z + offset.z };
    }
  }
  return at;
}

function bindAt(bind: readonly BindJoint[], index: number): Vec3 {
  return { x: bind[index].x, y: bind[index].y, z: bind[index].z };
}

function span(points: readonly Vec3[]): number {
  let low = Infinity;
  let high = -Infinity;
  for (const p of points) {
    if (p.y < low) low = p.y;
    if (p.y > high) high = p.y;
  }
  return high - low;
}

// ─── resolving the fixture, by measurement, locally ───────────────────

interface Tree {
  readonly children: readonly (readonly number[])[];
  readonly root: number;
  readonly lowest: readonly number[];
  readonly highest: readonly number[];
  readonly size: readonly number[];
}

function readTree(bind: readonly BindJoint[]): Tree {
  const children: number[][] = bind.map(() => []);
  let root = -1;
  bind.forEach((joint, i) => {
    if (joint.parent < 0) root = i;
    else children[joint.parent].push(i);
  });
  const lowest = bind.map((j) => j.y);
  const highest = bind.map((j) => j.y);
  const size = bind.map(() => 1);
  for (let i = bind.length - 1; i >= 0; i -= 1) {
    const parent = bind[i].parent;
    if (parent < 0) continue;
    size[parent] += size[i];
    lowest[parent] = Math.min(lowest[parent], lowest[i]);
    highest[parent] = Math.max(highest[parent], highest[i]);
  }
  return { children, root, lowest, highest, size };
}

/** A limb's main line: at every branch, the child carrying the most bone. */
function mainLine(tree: Tree, start: number): number[] {
  const chain = [start];
  let at = start;
  for (;;) {
    const kids = tree.children[at];
    if (kids.length === 0) return chain;
    let best = kids[0];
    for (const kid of kids) if (tree.size[kid] > tree.size[best]) best = kid;
    chain.push(best);
    at = best;
  }
}

function branchBelow(tree: Tree, from: number): number {
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    if (tree.children[queue[head]].length >= 3) return queue[head];
    for (const kid of tree.children[queue[head]]) queue.push(kid);
  }
  return -1;
}

/**
 * Seventeen joints and four spans out of a bind pose, by the same
 * geometric rules a skeleton reader has to use: there is no `LeftArm` in
 * either master, only `Bone_000` … `Bone_068`.
 */
function measureLocally(bind: readonly BindJoint[]): HumanMeasure {
  const tree = readTree(bind);
  const pelvis = branchBelow(tree, tree.root);

  const legChains: number[][] = [];
  let spineStart = -1;
  for (const kid of tree.children[pelvis]) {
    if (tree.lowest[kid] < bind[pelvis].y) legChains.push(mainLine(tree, kid));
    else spineStart = kid;
  }
  expect(legChains).toHaveLength(2);

  const torso = mainLine(tree, spineStart);
  const chestAt = torso.findIndex((i) => tree.children[i].length >= 3);
  const chest = torso[chestAt];
  const middle = (bind[pelvis].y + bind[chest].y) * 0.5;
  let spine = torso[0];
  for (let k = 1; k < chestAt; k += 1) {
    if (Math.abs(bind[torso[k]].y - middle) < Math.abs(bind[spine].y - middle)) spine = torso[k];
  }

  // The neck rises from the chest AND stays on the centre line; the arms
  // rise a little too, and leave that line by thirty times as much.
  let neckChain: number[] = [];
  let stray = Infinity;
  for (const kid of tree.children[chest]) {
    const chain = mainLine(tree, kid);
    if (tree.highest[kid] <= bind[chest].y) continue;
    const off = Math.max(...chain.map((i) => Math.abs(bind[i].x - bind[pelvis].x)));
    if (off < stray) {
      stray = off;
      neckChain = chain;
    }
  }
  const neck = neckChain[0];
  let head = neck;
  for (const i of neckChain) if (bind[i].y > bind[head].y) head = i;

  const armChains = tree.children[chest]
    .filter((kid) => kid !== neck)
    .map((kid) => mainLine(tree, kid))
    .sort((a, b) => Math.abs(bind[b[3]].x) - Math.abs(bind[a[3]].x))
    .slice(0, 2);

  // Both masters face along +z: every toe is forward of its own ankle.
  const toeZ = legChains.reduce((sum, chain) => sum + (bind[chain[3]].z - bind[chain[2]].z), 0);
  const leftSign = toeZ > 0 ? 1 : -1;

  const legL = legChains[0][0] === -1 ? legChains[0] : legChains.find((c) => Math.sign(bind[c[0]].x - bind[pelvis].x) === leftSign);
  const legR = legChains.find((c) => c !== legL);
  const armL = armChains.find((c) => Math.sign(bind[c[3]].x) === leftSign);
  const armR = armChains.find((c) => c !== armL);
  expect(legL && legR && armL && armR).toBeTruthy();

  const joints: HumanJoints = {
    pelvis,
    spine,
    chest,
    neck,
    head,
    shoulderL: (armL as number[])[1],
    elbowL: (armL as number[])[2],
    wristL: (armL as number[])[3],
    shoulderR: (armR as number[])[1],
    elbowR: (armR as number[])[2],
    wristR: (armR as number[])[3],
    hipL: (legL as number[])[0],
    kneeL: (legL as number[])[1],
    ankleL: (legL as number[])[2],
    hipR: (legR as number[])[0],
    kneeR: (legR as number[])[1],
    ankleR: (legR as number[])[2],
  };

  const gap = (a: number, b: number): number => length(sub(bindAt(bind, a), bindAt(bind, b)));

  return {
    joints,
    height: span(bind.map((_, i) => bindAt(bind, i))),
    armSpan: gap(joints.wristL, joints.wristR),
    legLength: Math.max(gap(joints.hipL, joints.ankleL), gap(joints.hipR, joints.ankleR)),
    hipWidth: gap(joints.hipL, joints.hipR),
    leftSign,
  };
}

const RAW = JSON.parse(
  readFileSync(new URL('./fixtures/humanBind.json', import.meta.url), 'utf8'),
) as { jack: BindJoint[]; sarah: BindJoint[] };

const MASTERS = [
  { name: 'sarah', bind: RAW.sarah as readonly BindJoint[] },
  { name: 'jack', bind: RAW.jack as readonly BindJoint[] },
] as const;

function fresh(): MutableJointTurn[] {
  return Array.from({ length: HUMAN_POSE_TURNS }, newJointTurn);
}

function gaitOf(over: Partial<HumanGait>): HumanGait {
  return { stance: 'stand', phase: 0, seconds: 0, lean: 0, ...over };
}

function poseAt(bind: readonly BindJoint[], measure: HumanMeasure, gait: HumanGait): Vec3[] {
  return posed(bind, poseHuman(measure, bind, gait, fresh()));
}

describe('poseHuman: the fixture resolves to a standing human', () => {
  for (const master of MASTERS) {
    it(`${master.name} measures as a T-posed body with the arms horizontal`, () => {
      const measure = measureLocally(master.bind);
      const bind = master.bind;
      const shoulder = bindAt(bind, measure.joints.shoulderL);
      const wrist = bindAt(bind, measure.joints.wristL);
      const arm = sub(wrist, shoulder);

      // This is the bug the module exists for: the arm runs out sideways
      // and stays level the whole way.
      expect(Math.abs(arm.x)).toBeGreaterThan(0.3);
      expect(Math.abs(arm.y / length(arm))).toBeLessThan(0.1);
      expect(Math.sign(arm.x)).toBe(measure.leftSign);
      expect(measure.leftSign).toBe(1);
      expect(measure.legLength).toBeGreaterThan(measure.height * 0.4);
    });
  }
});

describe('poseHuman: standing', () => {
  for (const master of MASTERS) {
    const bind = master.bind;
    const measure = measureLocally(bind);
    const j = measure.joints;
    const stand = gaitOf({ seconds: 3.7 });

    it(`${master.name} brings both wrists below the shoulders and in toward the body`, () => {
      const after = poseAt(bind, measure, stand);
      const centre = bind[j.pelvis].x;

      for (const [shoulderAt, wristAt] of [
        [j.shoulderL, j.wristL],
        [j.shoulderR, j.wristR],
      ]) {
        expect(after[wristAt].y).toBeLessThan(after[shoulderAt].y);
        // And well below: a wrist a centimetre under a shoulder would
        // pass a bare inequality with the arms still out sideways.
        expect(after[shoulderAt].y - after[wristAt].y).toBeGreaterThan(measure.legLength * 0.4);
        expect(Math.abs(after[wristAt].x - centre)).toBeLessThan(Math.abs(bind[wristAt].x - centre));
      }
    });

    it(`${master.name}'s upper arms are no longer horizontal`, () => {
      const after = poseAt(bind, measure, stand);
      for (const [shoulderAt, elbowAt] of [
        [j.shoulderL, j.elbowL],
        [j.shoulderR, j.elbowR],
      ]) {
        const bound = unit(sub(bindAt(bind, elbowAt), bindAt(bind, shoulderAt)));
        const now = unit(sub(after[elbowAt], after[shoulderAt]));
        // The bind arms are level to within a hand's droop: 3.5 degrees
        // off horizontal on both of Sarah's, 7.9 and 9.8 on Jack's.
        expect(Math.abs(bound.y)).toBeLessThan(0.2);
        // 77.5 degrees down leaves sin(77.5) = 0.976 of the arm pointing
        // at the floor; the flare and the roll take a little of it back.
        expect(now.y).toBeLessThan(-0.9);
      }
    });

    it(`${master.name} is exactly as tall posed as bound, at every moment of the breath`, () => {
      // Swept rather than sampled, because the breath and the sway run
      // at incommensurate rates and the worst moment of the pair is
      // three minutes in: Jack's head joint sits 0.051 forward of his
      // neck, so a chest tilt LIFTS the top of him, and five spot checks
      // happily miss it.
      const millimetre = measure.height / MASTER_HEIGHT_MM;
      const bound = span(bind.map((_, i) => bindAt(bind, i)));
      let worst = 0;
      for (let seconds = 0; seconds < 180; seconds += 0.25) {
        const error = Math.abs(span(poseAt(bind, measure, gaitOf({ seconds }))) - bound);
        if (error > worst) worst = error;
      }
      expect(worst).toBeLessThan(millimetre);
    });

    it(`${master.name} breathes and sways off the clock, not off the phase`, () => {
      const still = poseAt(bind, measure, gaitOf({ seconds: 0 }));
      const later = poseAt(bind, measure, gaitOf({ seconds: 2.4 }));
      const elsewhere = poseAt(bind, measure, gaitOf({ seconds: 0, phase: 0.42 }));

      // The clock moves the chest; the phase, on a standing body, moves nothing.
      expect(length(sub(later[j.chest], still[j.chest]))).toBeGreaterThan(0);
      expect(length(sub(elsewhere[j.chest], still[j.chest]))).toBe(0);
      expect(length(sub(elsewhere[j.ankleL], still[j.ankleL]))).toBe(0);
    });

    it(`${master.name} leans into a turn and stands upright out of one`, () => {
      const straight = poseAt(bind, measure, gaitOf({ seconds: 0 }));
      const right = poseAt(bind, measure, gaitOf({ seconds: 0, lean: 1 }));
      const left = poseAt(bind, measure, gaitOf({ seconds: 0, lean: -1 }));
      const centre = bind[j.pelvis].x;

      // A right lean carries the head toward the body's right, which is
      // away from `leftSign`.
      expect((right[j.head].x - centre) * measure.leftSign).toBeLessThan(straight[j.head].x - centre);
      expect((left[j.head].x - centre) * measure.leftSign).toBeGreaterThan(straight[j.head].x - centre);
      // The feet do not come with it: the sway and the lean are put on
      // the spine, above the legs, for exactly this reason.
      expect(length(sub(right[j.ankleL], straight[j.ankleL]))).toBe(0);
      expect(length(sub(right[j.ankleR], straight[j.ankleR]))).toBe(0);
    });
  }
});

describe('poseHuman: walking and running', () => {
  const PHASES = [0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95];

  for (const master of MASTERS) {
    const bind = master.bind;
    const measure = measureLocally(bind);
    const j = measure.joints;

    it(`${master.name}'s ankles alternate which is forward over a cycle`, () => {
      // Sampled half a step off the top of the cycle, so that no sample
      // lands ON a crossing: at phase 0 and phase 0.5 the two ankles are
      // exactly level, which is the gait passing through, not a lead.
      const lead: number[] = [];
      for (let k = 0; k < 16; k += 1) {
        const after = poseAt(bind, measure, gaitOf({ stance: 'walk', phase: (k + 0.5) / 16 }));
        lead.push(Math.sign(after[j.ankleL].z - after[j.ankleR].z));
      }
      expect(lead).toContain(1);
      expect(lead).toContain(-1);
      expect(lead).not.toContain(0);

      // Twice a cycle and no more: a gait that changed lead four times
      // would be two strides pretending to be one.
      let swaps = 0;
      for (let k = 0; k < lead.length; k += 1) {
        if (lead[k] !== lead[(k + 1) % lead.length]) swaps += 1;
      }
      expect(swaps).toBe(2);
    });

    it(`${master.name} swings each arm with the opposite leg`, () => {
      for (const stance of ['walk', 'run'] as const) {
        for (const phase of PHASES) {
          const after = poseAt(bind, measure, gaitOf({ stance, phase }));
          const armLead = after[j.wristL].z - after[j.wristR].z;
          const legLead = after[j.ankleR].z - after[j.ankleL].z;
          expect(Math.abs(legLead)).toBeGreaterThan(0);
          expect(armLead * legLead).toBeGreaterThan(0);
        }
      }
    });

    it(`${master.name}'s knees never reach past straight`, () => {
      const kneeFlex = (at: readonly Vec3[], hip: number, knee: number, ankle: number): number => {
        const thigh = unit(sub(at[knee], at[hip]));
        const shin = unit(sub(at[ankle], at[knee]));
        return cross(thigh, shin).x * measure.leftSign;
      };
      const bound = bind.map((_, i) => bindAt(bind, i));
      const restL = kneeFlex(bound, j.hipL, j.kneeL, j.ankleL);
      const restR = kneeFlex(bound, j.hipR, j.kneeR, j.ankleR);

      for (const stance of ['stand', 'walk', 'run'] as const) {
        for (const phase of PHASES) {
          const after = poseAt(bind, measure, gaitOf({ stance, phase, seconds: phase * 7, lean: phase - 0.5 }));
          // Flexion is positive about the body's left; hyperextension is
          // the only direction a knee cannot go, so the bind pose's own
          // slight bend is the floor.
          expect(kneeFlex(after, j.hipL, j.kneeL, j.ankleL)).toBeGreaterThanOrEqual(restL - 1e-9);
          expect(kneeFlex(after, j.hipR, j.kneeR, j.ankleR)).toBeGreaterThanOrEqual(restR - 1e-9);

          // And not folded past what a leg does either.
          for (const [hip, knee, ankle] of [
            [j.hipL, j.kneeL, j.ankleL],
            [j.hipR, j.kneeR, j.ankleR],
          ]) {
            const thigh = unit(sub(after[knee], after[hip]));
            const shin = unit(sub(after[ankle], after[knee]));
            const bend = Math.acos(Math.min(1, Math.max(-1, thigh.x * shin.x + thigh.y * shin.y + thigh.z * shin.z)));
            expect(bend).toBeLessThan(90 * DEG);
          }
        }
      }
    });

    it(`${master.name} runs with more ankle travel than it walks, at every phase`, () => {
      for (const phase of PHASES) {
        const walk = poseAt(bind, measure, gaitOf({ stance: 'walk', phase }));
        const run = poseAt(bind, measure, gaitOf({ stance: 'run', phase }));
        for (const ankle of [j.ankleL, j.ankleR]) {
          const rest = bindAt(bind, ankle);
          expect(length(sub(run[ankle], rest))).toBeGreaterThan(length(sub(walk[ankle], rest)));
        }
      }
    });

    it(`${master.name} runs leaning further forward than it walks`, () => {
      const stand = poseAt(bind, measure, gaitOf({ stance: 'stand', phase: 0.5 }));
      const walk = poseAt(bind, measure, gaitOf({ stance: 'walk', phase: 0.5 }));
      const run = poseAt(bind, measure, gaitOf({ stance: 'run', phase: 0.5 }));
      expect(walk[j.head].z).toBeGreaterThan(stand[j.head].z);
      expect(run[j.head].z).toBeGreaterThan(walk[j.head].z);
      // Lifting a knee higher is what "higher" means, so check the knee
      // rather than the angle it was asked for.
      const lift = (at: readonly Vec3[]): number => Math.max(at[j.kneeL].y, at[j.kneeR].y);
      const swing = gaitOf({ stance: 'walk', phase: 0.75 });
      expect(lift(poseAt(bind, measure, { ...swing, stance: 'run' }))).toBeGreaterThan(lift(poseAt(bind, measure, swing)));
    });

    it(`${master.name} keeps the standing arm as the base of its swing`, () => {
      // A walking body never returns any part of the way to the T: the
      // wrist stays low and inboard at every phase of the cycle.
      const centre = bind[j.pelvis].x;
      for (const stance of ['walk', 'run'] as const) {
        for (const phase of PHASES) {
          const after = poseAt(bind, measure, gaitOf({ stance, phase }));
          for (const [shoulder, wrist] of [
            [j.shoulderL, j.wristL],
            [j.shoulderR, j.wristR],
          ]) {
            expect(after[wrist].y).toBeLessThan(after[shoulder].y);
            expect(Math.abs(after[wrist].x - centre)).toBeLessThan(Math.abs(bind[wrist].x - centre) * 0.75);
          }
        }
      }
    });
  }
});

describe('poseHuman: the contract with the caller', () => {
  const bind = MASTERS[0].bind;
  const measure = measureLocally(bind);

  it('writes the same fifteen joints, parent before child, in every stance', () => {
    for (const stance of ['stand', 'walk', 'run'] as const) {
      const turns = poseHuman(measure, bind, gaitOf({ stance, phase: 0.3 }), fresh());
      expect(turns).toHaveLength(HUMAN_POSE_TURNS);
      const listed = turns.map((t) => t.joint);
      expect(new Set(listed).size).toBe(HUMAN_POSE_TURNS);
      for (const turn of turns) {
        expect(Math.hypot(turn.ax, turn.ay, turn.az)).toBeCloseTo(1, 12);
        expect(Number.isFinite(turn.radians)).toBe(true);
      }
      const rank = new Map(listed.map((joint, i) => [joint, i]));
      for (const joint of listed) {
        const parent = bind[joint].parent;
        const parentRank = rank.get(parent);
        if (parentRank !== undefined) expect(parentRank).toBeLessThan(rank.get(joint) as number);
      }
    }
  });

  it('gives the same turns for the same gait', () => {
    const gait = gaitOf({ stance: 'run', phase: 0.37, seconds: 12.5, lean: -0.4 });
    const first = poseHuman(measure, bind, gait, fresh()).map((t) => ({ ...t }));
    const second = poseHuman(measure, bind, { ...gait }, fresh());
    expect(second).toHaveLength(first.length);
    second.forEach((turn, i) => {
      expect(turn.joint).toBe(first[i].joint);
      expect(turn.ax).toBe(first[i].ax);
      expect(turn.ay).toBe(first[i].ay);
      expect(turn.az).toBe(first[i].az);
      expect(turn.radians).toBe(first[i].radians);
    });
  });

  it('grows an empty out once and then reuses every object in it', () => {
    const out: MutableJointTurn[] = [];
    const first = poseHuman(measure, bind, gaitOf({ stance: 'walk', phase: 0.1 }), out);
    expect(out).toHaveLength(HUMAN_POSE_TURNS);
    expect(first).toBe(out);

    const held = [...out];
    for (const phase of [0.2, 0.55, 0.9]) {
      const again = poseHuman(measure, bind, gaitOf({ stance: 'run', phase }), out);
      expect(again).toBe(out);
      expect(out).toHaveLength(HUMAN_POSE_TURNS);
      held.forEach((turn, i) => expect(out[i]).toBe(turn));
    }
  });

  it('returns a stable view when out is longer than the pose', () => {
    const out: MutableJointTurn[] = Array.from({ length: HUMAN_POSE_TURNS + 5 }, newJointTurn);
    const first = poseHuman(measure, bind, gaitOf({ stance: 'walk', phase: 0.1 }), out);
    const second = poseHuman(measure, bind, gaitOf({ stance: 'walk', phase: 0.2 }), out);

    expect(first).toHaveLength(HUMAN_POSE_TURNS);
    expect(second).toBe(first);
    expect(out).toHaveLength(HUMAN_POSE_TURNS + 5);
    for (let i = 0; i < HUMAN_POSE_TURNS; i += 1) expect(first[i]).toBe(out[i]);
  });

  it('poses two bodies in one frame without either reading the other', () => {
    // The view is held per out array, so Jack's turns cannot arrive in
    // Sarah's list when both are posed before either is read.
    const jack = { bind: MASTERS[1].bind, measure: measureLocally(MASTERS[1].bind) };
    const longOut = (): MutableJointTurn[] => Array.from({ length: HUMAN_POSE_TURNS + 2 }, newJointTurn);
    const sarahOut = longOut();
    const jackOut = longOut();

    const sarahTurns = poseHuman(measure, bind, gaitOf({ stance: 'walk', phase: 0.25 }), sarahOut);
    const jackTurns = poseHuman(jack.measure, jack.bind, gaitOf({ stance: 'run', phase: 0.75 }), jackOut);

    expect(sarahTurns[0].joint).toBe(measure.joints.spine);
    expect(jackTurns[0].joint).toBe(jack.measure.joints.spine);
    expect(sarahTurns).not.toBe(jackTurns);
  });
});
