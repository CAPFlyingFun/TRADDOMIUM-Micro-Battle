/**
 * THE TWO REAL SKELETONS, AND THE ONES THAT ARE NOT SKELETONS.
 *
 * `measureHuman` exists because Meshy's auto-rigs name nothing: the
 * masters' bones are `Bone_000` … `Bone_068`, so seventeen joints have to
 * be found from the bind pose's geometry (`src/actor/humanSkeleton.ts`
 * explains every rule and the margin it wins by). A rule like that is
 * only worth as much as the skeletons it has been run against, so this
 * file runs it against BOTH masters exactly as they are — Sarah's 35
 * joints and Jack's 69, read out of `fixtures/humanBind.json`, which is
 * what the GLBs' inverse bind matrices give.
 *
 * Two kinds of assertion, and the second kind is the point:
 *
 *  - THE INDICES ARE PINNED. Sarah's left wrist is joint 20 and Jack's is
 *    37, and a change that moves either is a change to the pose of two
 *    people standing in the laboratory. Pinning them is what makes this a
 *    regression test rather than a restatement of the code.
 *  - THE SHAPE IS ASSERTED WITHOUT REFERENCE TO ANY INDEX. Ankles below
 *    knees below hips; wrists further out than elbows than shoulders;
 *    the head on top; both arms within a few degrees of horizontal,
 *    because a Meshy bind pose is a T. Those hold for any rig of a
 *    standing human, so a THIRD master added tomorrow is checked by the
 *    same lines.
 *
 * The error paths use a hand-built twenty-bone figure rather than a
 * mangled master, because each break has to be the ONLY thing wrong with
 * the skeleton for its message to mean anything. That figure also carries
 * the two cases neither master has: an arm with no clavicle, which is
 * what the proportional fallback is for, and a foot with no forward toe,
 * which is what pushes the facing measurement onto its second cue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HUMAN_JOINT_NAMES, type BindJoint, type HumanJoints } from '../src/actor/humanRig';
import { HumanSkeletonError, measureHuman } from '../src/actor/humanSkeleton';

const FIXTURE = fileURLToPath(new URL('./fixtures/humanBind.json', import.meta.url));

interface BindFixture {
  readonly jack: readonly BindJoint[];
  readonly sarah: readonly BindJoint[];
}

const MASTERS = JSON.parse(readFileSync(FIXTURE, 'utf8')) as BindFixture;

/**
 * Both masters are authored at human scale in metres, 1.700 m sole to
 * crown (`tombs/LabPeople.ts`, which scales them by `UNITS_PER_METRE`).
 * The JOINT span is shorter than the stature at both ends — the head
 * joint sits inside the skull and the lowest joint is the toe, above the
 * sole — which is why the checks below are ratios of it and not of 1.700.
 */
const STATURE_M = 1.7;

interface Master {
  readonly who: string;
  readonly bind: readonly BindJoint[];
  readonly count: number;
  readonly joints: HumanJoints;
  readonly height: number;
  readonly armSpan: number;
  readonly legLength: number;
  readonly hipWidth: number;
}

/**
 * What the two masters measure out to. Every number here was read off
 * the fixture, not chosen: the spans are in the file's own metres, and
 * the pinned indices are the joints the poser will turn.
 *
 * `leftSign` is +1 on both and is deliberately not a column, because it
 * is the same answer for both and it is asserted from the geometry
 * below: both masters face +z (glTF's convention, and verified for these
 * two by rendering them from +z), and a body facing +z wears its left
 * arm on +x. So Sarah's left wrist is index 20, the chain a viewer sees
 * on their RIGHT.
 */
const REAL: readonly Master[] = [
  {
    who: 'sarah',
    bind: MASTERS.sarah,
    count: 35,
    joints: {
      pelvis: 1, spine: 3, chest: 5, neck: 6, head: 8,
      shoulderL: 18, elbowL: 19, wristL: 20,
      shoulderR: 10, elbowR: 11, wristR: 12,
      hipL: 30, kneeL: 31, ankleL: 32,
      hipR: 25, kneeR: 26, ankleR: 27,
    },
    height: 1.3434,
    armSpan: 1.0612,
    legLength: 0.6382,
    hipWidth: 0.1355,
  },
  // JACK IS Lab2 SINCE 2026-09-19, and this row is the best evidence the
  // rule is worth having. The new master is the SAME 69-bone armature with
  // the same names in the same order — and its LEGS ARE THE OTHER WAY
  // ROUND: 59-61 was his left leg and is now his right. Nothing here was
  // told that. `measureHuman` reads the sides off the bind pose, so the
  // swap arrived as two lines of this fixture changing and every shape
  // assertion below still passing, including "left and right agree with
  // leftSign on every limb". A rule that matched `Bone_059` to a name
  // would have put the man's knees on backwards and passed its own test.
  //
  // The arms did not move (35-37 left, 10-12 right) and neither did the
  // spine, which is why the two halves are worth pinning separately.
  // `legLength` fell 48 mm because the scan itself is a little shorter —
  // the poser reads it, so his stride follows it (`humanPose`'s hip swing
  // is `asin(step / 2 * legLength)`).
  {
    who: 'jack',
    bind: MASTERS.jack,
    count: 69,
    joints: {
      pelvis: 1, spine: 3, chest: 5, neck: 6, head: 8,
      shoulderL: 35, elbowL: 36, wristL: 37,
      shoulderR: 10, elbowR: 11, wristR: 12,
      hipL: 64, kneeL: 65, ankleL: 66,
      hipR: 59, kneeR: 60, ankleR: 61,
    },
    height: 1.3603,
    armSpan: 1.0499,
    legLength: 0.6298,
    hipWidth: 0.1356,
  },
];

/** How far off horizontal an arm runs, in degrees: the T-pose reading. */
function armTiltDegrees(bind: readonly BindJoint[], shoulder: number, wrist: number): number {
  const a = bind[shoulder];
  const b = bind[wrist];
  return Math.abs(Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z))) * (180 / Math.PI);
}

describe('measureHuman on the two masters', () => {
  it('has both masters in the fixture, at the joint counts the rigs were baked with', () => {
    for (const master of REAL) expect(master.bind, master.who).toHaveLength(master.count);
  });

  for (const master of REAL) {
    const { who, bind } = master;

    it(`${who}: resolves all seventeen joints to distinct bones`, () => {
      const { joints } = measureHuman(bind);
      const used = new Set<number>();
      for (const name of HUMAN_JOINT_NAMES) {
        const index = joints[name];
        expect(Number.isInteger(index), `${name} is ${index}`).toBe(true);
        expect(index, name).toBeGreaterThanOrEqual(0);
        expect(index, name).toBeLessThan(bind.length);
        used.add(index);
      }
      expect(used.size).toBe(HUMAN_JOINT_NAMES.length);
    });

    it(`${who}: pins which bone each name is — a move here re-poses a person in the laboratory`, () => {
      const measure = measureHuman(bind);
      expect(measure.joints).toEqual(master.joints);
      expect(measure.leftSign).toBe(1);
      expect(measure.height).toBeCloseTo(master.height, 3);
      expect(measure.armSpan).toBeCloseTo(master.armSpan, 3);
      expect(measure.legLength).toBeCloseTo(master.legLength, 3);
      expect(measure.hipWidth).toBeCloseTo(master.hipWidth, 3);
    });

    it(`${who}: stands the right way up — ankles under knees under hips, head on top`, () => {
      const { joints } = measureHuman(bind);
      for (const side of ['L', 'R'] as const) {
        const hip = bind[joints[`hip${side}`]];
        const knee = bind[joints[`knee${side}`]];
        const ankle = bind[joints[`ankle${side}`]];
        expect(knee.y, `knee${side}`).toBeLessThan(hip.y);
        expect(ankle.y, `ankle${side}`).toBeLessThan(knee.y);
      }
      const top = bind.reduce((best, joint, index) => (joint.y > bind[best].y ? index : best), 0);
      expect(joints.head).toBe(top);
      expect(bind[joints.head].y).toBeGreaterThan(bind[joints.neck].y);
      expect(bind[joints.chest].y).toBeGreaterThan(bind[joints.spine].y);
      expect(bind[joints.spine].y).toBeGreaterThan(bind[joints.pelvis].y);
    });

    it(`${who}: the ankle is where the leg stops descending, not the end of the chain`, () => {
      const { joints } = measureHuman(bind);
      for (const side of ['L', 'R'] as const) {
        const ankleAt = joints[`ankle${side}`];
        const ankle = bind[ankleAt];
        // Both masters carry two joints of foot past the ankle, and the
        // first of them is the toe: it drops 0.073 while travelling 0.107
        // forward. A rule that took the chain's last joint would pose that
        // one as the ankle and stand the body on its toe tips.
        const toe = bind.findIndex((joint) => joint.parent === ankleAt);
        expect(toe, `${side} foot continues past the ankle`).toBeGreaterThan(0);
        expect(bind[toe].z - ankle.z, `${side} toe runs forward`).toBeGreaterThan(0.05);
        expect(ankle.y - bind[toe].y, `${side} toe drops less than it travels`)
          .toBeLessThan(Math.hypot(bind[toe].x - ankle.x, bind[toe].z - ankle.z));
      }
    });

    it(`${who}: the arms run outward — wrists beyond elbows beyond shoulders`, () => {
      const { joints } = measureHuman(bind);
      const centre = bind[joints.chest].x;
      for (const side of ['L', 'R'] as const) {
        const shoulder = Math.abs(bind[joints[`shoulder${side}`]].x - centre);
        const elbow = Math.abs(bind[joints[`elbow${side}`]].x - centre);
        const wrist = Math.abs(bind[joints[`wrist${side}`]].x - centre);
        expect(elbow, `elbow${side}`).toBeGreaterThan(shoulder);
        expect(wrist, `wrist${side}`).toBeGreaterThan(elbow);
      }
    });

    it(`${who}: left and right agree with leftSign on every limb`, () => {
      const { joints, leftSign } = measureHuman(bind);
      expect(Math.abs(leftSign)).toBe(1);
      const chest = bind[joints.chest].x;
      const pelvis = bind[joints.pelvis].x;
      expect(Math.sign(bind[joints.wristL].x - chest)).toBe(leftSign);
      expect(Math.sign(bind[joints.shoulderL].x - chest)).toBe(leftSign);
      expect(Math.sign(bind[joints.wristR].x - chest)).toBe(-leftSign);
      expect(Math.sign(bind[joints.shoulderR].x - chest)).toBe(-leftSign);
      expect(Math.sign(bind[joints.hipL].x - pelvis)).toBe(leftSign);
      expect(Math.sign(bind[joints.hipR].x - pelvis)).toBe(-leftSign);
    });

    it(`${who}: the toes say which way the body faces, and the answer is +z`, () => {
      const { joints, leftSign } = measureHuman(bind);
      // The measurement leftSign is made from, stated in the test's own
      // terms: the ankle-to-toe step is the forward one, and with +y up a
      // body facing +z wears its left arm on +x.
      let forward = 0;
      for (const side of ['L', 'R'] as const) {
        const ankle = bind[joints[`ankle${side}`]];
        const toe = bind[bind.findIndex((joint) => joint.parent === joints[`ankle${side}`])];
        forward += toe.z - ankle.z;
      }
      expect(forward).toBeGreaterThan(0.1);
      expect(leftSign).toBe(1);
      expect(bind[joints.wristL].x).toBeGreaterThan(bind[joints.wristR].x);
    });

    it(`${who}: is bound in a T — both arms within a few degrees of horizontal`, () => {
      const { joints } = measureHuman(bind);
      // Measured: Sarah's arms rise 0.011 over 0.378 and 0.384 (1.7°),
      // Jack's fall 0.023 and 0.028 over 0.345 (3.8° and 4.7°). Six
      // degrees is the smallest round number that clears both, and a rig
      // that arrived in an A-pose would fail here rather than in a
      // screenshot of a scientist holding their arms out at 45°.
      expect(armTiltDegrees(bind, joints.shoulderL, joints.wristL)).toBeLessThan(6);
      expect(armTiltDegrees(bind, joints.shoulderR, joints.wristR)).toBeLessThan(6);
    });

    it(`${who}: the spans are the body's, in the file's own metres`, () => {
      const measure = measureHuman(bind);
      // The joint span is 79% (Sarah) and 81% (Jack) of the 1.700 m the
      // masters are modelled at, because the crown joint is inside the
      // skull and the lowest joint is the toe. A rig that arrived in
      // centimetres would miss this window by a factor of a hundred.
      expect(measure.height / STATURE_M).toBeGreaterThan(0.75);
      expect(measure.height / STATURE_M).toBeLessThan(0.85);
      // Wrist to wrist, so short of the fingertip span a tape measure
      // would read as roughly the stature.
      expect(measure.armSpan / measure.height).toBeGreaterThan(0.7);
      expect(measure.armSpan / measure.height).toBeLessThan(0.85);
      expect(measure.legLength / measure.height).toBeGreaterThan(0.4);
      expect(measure.legLength / measure.height).toBeLessThan(0.55);
      expect(measure.hipWidth).toBeGreaterThan(0);
      expect(measure.hipWidth).toBeLessThan(measure.armSpan * 0.25);
    });
  }
});

// ---------------------------------------------------------------------------
// A hand-built figure, for the cases the masters do not have
// ---------------------------------------------------------------------------

type MutableBone = { -readonly [K in keyof BindJoint]: BindJoint[K] };

function bone(name: string, parent: number, x: number, y: number, z: number): MutableBone {
  return { name, parent, x, y, z };
}

/**
 * Twenty bones of a standing figure facing +z, sparser than either
 * master in exactly one way that matters: THE ARMS HAVE NO CLAVICLE, so
 * each arm chain is three joints and the proportional fallback decides
 * which is which. Everything else is the shape the finder expects — a
 * root above a three-branch pelvis, a spine to a three-branch chest, a
 * neck and head on the centre line, and feet whose toes run forward.
 */
const PLAIN: readonly MutableBone[] = [
  bone('root', -1, 0, 0.1, 0),
  bone('pelvis', 0, 0, 0, 0),
  bone('spine', 1, 0, 0.25, 0),
  bone('chest', 2, 0, 0.5, 0),
  bone('neck', 3, 0, 0.6, 0),
  bone('head', 4, 0, 0.72, 0.03),
  bone('shoulder-x', 3, -0.06, 0.48, 0),
  bone('elbow-x', 6, -0.25, 0.48, 0),
  bone('wrist-x', 7, -0.44, 0.48, 0),
  bone('shoulder+x', 3, 0.06, 0.48, 0),
  bone('elbow+x', 9, 0.25, 0.48, 0),
  bone('wrist+x', 10, 0.44, 0.48, 0),
  bone('hip-x', 1, -0.08, -0.02, 0),
  bone('knee-x', 12, -0.08, -0.3, 0),
  bone('ankle-x', 13, -0.08, -0.58, 0),
  bone('toe-x', 14, -0.08, -0.62, 0.1),
  bone('hip+x', 1, 0.08, -0.02, 0),
  bone('knee+x', 16, 0.08, -0.3, 0),
  bone('ankle+x', 17, 0.08, -0.58, 0),
  bone('toe+x', 18, 0.08, -0.62, 0.1),
];

function figure(): MutableBone[] {
  return PLAIN.map((joint) => ({ ...joint }));
}

/** The same person turned round to face -z: x and z negated, nothing else. */
function turnedAround(bones: readonly MutableBone[]): MutableBone[] {
  return bones.map((joint) => ({ ...joint, x: -joint.x, z: -joint.z }));
}

const PLAIN_JOINTS: HumanJoints = {
  pelvis: 1, spine: 2, chest: 3, neck: 4, head: 5,
  shoulderL: 9, elbowL: 10, wristL: 11,
  shoulderR: 6, elbowR: 7, wristR: 8,
  hipL: 16, kneeL: 17, ankleL: 18,
  hipR: 12, kneeR: 13, ankleR: 14,
};

describe('measureHuman on a sparser rig', () => {
  it('finds a shoulder, an elbow and a wrist in an arm with no clavicle', () => {
    const measure = measureHuman(figure());
    expect(measure.joints).toEqual(PLAIN_JOINTS);
    expect(measure.leftSign).toBe(1);
    expect(measure.armSpan).toBeCloseTo(0.88, 6);
    expect(measure.hipWidth).toBeCloseTo(0.16, 6);
    expect(measure.legLength).toBeCloseTo(0.56, 6);
    expect(measure.height).toBeCloseTo(1.34, 6);
  });

  it('turning the body round flips leftSign and moves no joint to another name', () => {
    const forward = measureHuman(figure());
    const backward = measureHuman(turnedAround(figure()));
    expect(backward.joints).toEqual(forward.joints);
    expect(backward.leftSign).toBe(-1);
    expect(backward.armSpan).toBeCloseTo(forward.armSpan, 12);
    // The point of the rule: the left hip is the same BONE either way.
    // Only the side of the body that +x lies on has changed.
    expect(backward.joints.hipL).toBe(PLAIN_JOINTS.hipL);
  });

  it('takes the facing from the head when the feet end straight under the ankle', () => {
    // No forward toe to measure: the last joint of each foot is directly
    // below the one above it, so it reads as more leg rather than a foot,
    // and the head — 0.03 in front of the neck here, 0.028 and 0.040 on
    // the masters — is the only cue left.
    const flat = figure();
    flat[15] = bone('sole-x', 14, -0.08, -0.62, 0);
    flat[19] = bone('sole+x', 18, 0.08, -0.62, 0);
    const measure = measureHuman(flat);
    expect(measure.leftSign).toBe(1);
    expect(measure.joints.ankleR).toBe(15);
    expect(measure.joints.ankleL).toBe(19);
    expect(measureHuman(turnedAround(flat)).leftSign).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// What is NOT a human, and how loudly it says so
// ---------------------------------------------------------------------------

interface Broken {
  readonly what: string;
  readonly breaks: (bones: MutableBone[]) => MutableBone[];
  readonly says: RegExp;
}

const BROKEN: readonly Broken[] = [
  {
    what: 'no root at all',
    breaks: (bones) => {
      bones[0].parent = 1;
      return bones;
    },
    says: /0 joints have no parent/,
  },
  {
    what: 'two roots',
    breaks: (bones) => {
      bones[1].parent = -1;
      return bones;
    },
    says: /2 joints have no parent/,
  },
  {
    what: 'a parent outside the array',
    breaks: (bones) => {
      bones[5].parent = 99;
      return bones;
    },
    says: /not another joint of these 20/,
  },
  {
    what: 'a joint parented to itself',
    breaks: (bones) => {
      bones[5].parent = 5;
      return bones;
    },
    says: /not another joint of these 20/,
  },
  {
    what: 'a pair of joints parented to each other, off the tree',
    breaks: (bones) => {
      bones.push(bone('loop-a', 21, 0, 0, 0), bone('loop-b', 20, 0, 0, 0));
      return bones;
    },
    says: /only 20 of 22 joints hang off the root/,
  },
  {
    what: 'a joint with no position',
    breaks: (bones) => {
      bones[5].y = Number.NaN;
      return bones;
    },
    says: /which is not a position/,
  },
  {
    what: 'fewer joints than there are names',
    breaks: (bones) => bones.slice(0, 10),
    says: /10 joints cannot carry 17 named ones/,
  },
  {
    what: 'a straight chain that never branches',
    breaks: () => {
      const chain: MutableBone[] = [];
      for (let i = 0; i < 20; i += 1) chain.push(bone(`link-${i}`, i - 1, 0, i * 0.05, 0));
      return chain;
    },
    says: /there is no pelvis/,
  },
  {
    what: 'only one leg below the pelvis',
    breaks: (bones) => {
      for (const index of [16, 17, 18, 19]) bones[index].y = -bones[index].y;
      return bones;
    },
    says: /a human has two legs/,
  },
  {
    what: 'a leg that travels further sideways than it drops',
    breaks: (bones) => {
      bones[13].x = -0.4;
      bones[13].y = -0.05;
      return bones;
    },
    says: /never descends/,
  },
  {
    what: 'a leg that reaches its ankle in one step',
    breaks: (bones) => {
      bones[13].y = -0.58;
      bones[14] = bone('toe-x', 13, -0.08, -0.62, 0.1);
      bones[15] = bone('tip-x', 14, -0.08, -0.6, 0.2);
      return bones;
    },
    says: /no joint between hip and ankle to be a knee/,
  },
  {
    what: 'arms hung off the pelvis, leaving the spine without a chest',
    breaks: (bones) => {
      bones[6].parent = 1;
      bones[9].parent = 1;
      return bones;
    },
    says: /there is no chest/,
  },
  {
    what: 'a chest on the pelvis itself',
    breaks: (bones) => {
      bones[3].parent = 1;
      return bones;
    },
    says: /no joint between them to be a spine/,
  },
  {
    what: 'an arm of a single joint',
    breaks: (bones) => {
      bones[8].parent = 3;
      return bones;
    },
    says: /need three joints; the arm at 8 \(wrist-x, y 0\.480\) has 1/,
  },
  {
    what: 'both arms on the same side of the chest',
    breaks: (bones) => {
      bones[6].x = 0.06;
      bones[7].x = 0.25;
      bones[8].x = 0.44;
      return bones;
    },
    says: /same side of the chest/,
  },
  {
    what: 'a neck with nothing above it',
    breaks: (bones) => {
      bones[5].y = 0.55;
      return bones;
    },
    says: /to be a head/,
  },
  {
    what: 'a body whose feet both point along x',
    breaks: (bones) => {
      bones[15] = bone('toe-x', 14, 0.02, -0.62, 0);
      bones[19] = bone('toe+x', 18, 0.18, -0.62, 0);
      return bones;
    },
    says: /does not name a front along z/,
  },
  {
    what: 'a body with no forward cue anywhere',
    breaks: (bones) => {
      bones[15] = bone('sole-x', 14, -0.08, -0.62, 0);
      bones[19] = bone('sole+x', 18, 0.08, -0.62, 0);
      bones[5].z = 0;
      return bones;
    },
    says: /does not name a front along z/,
  },
];

describe('measureHuman refuses what it cannot resolve', () => {
  it('accepts the figure every one of these breaks', () => {
    expect(() => measureHuman(figure())).not.toThrow();
  });

  for (const broken of BROKEN) {
    it(`throws a named, explanatory error for ${broken.what}`, () => {
      const bones = broken.breaks(figure());
      expect(() => measureHuman(bones)).toThrow(HumanSkeletonError);
      expect(() => measureHuman(bones)).toThrow(broken.says);
      // Every message names the module, so a stack-less report in a
      // loader still says which file could not do its job.
      try {
        measureHuman(bones);
        expect.unreachable('the skeleton should not have resolved');
      } catch (error) {
        expect((error as Error).name).toBe('HumanSkeletonError');
        expect((error as Error).message.startsWith('human skeleton: ')).toBe(true);
      }
    });
  }
});
