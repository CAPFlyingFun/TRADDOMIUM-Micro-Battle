/**
 * FINDING A HUMAN IN A SKELETON THAT NAMES NOTHING.
 *
 * `humanRig.ts` states the problem; this file is the answer to it. The
 * two masters are Meshy auto-rigs and their bones are called `Bone_000`
 * … `Bone_068`, so there is no `hips`, no `LeftArm` and no mixamorig:
 * prefix — nothing to look a joint up BY. The seventeen joints a pose
 * needs are therefore found the way `fauna/rig.ts` finds an ant's legs:
 * BY MEASUREMENT, from the bind pose's own geometry, and on BOTH rigs at
 * once — Sarah's 35 bones and Jack's 69, which is the same skeleton with
 * five fingers on each hand.
 *
 * WHY NOT A TABLE OF INDICES. One would work, and it would work only
 * until the next bake. The numbers are an auto-rigger's output: a
 * re-export renumbers them, a second pass over Sarah's mesh can add a
 * bone, and the failure mode of a stale table is not an error but a
 * SHOULDER TURNING A THIGH. Every rule below is instead a fact about
 * the shape of a standing human — the legs go down, the arms go out, the
 * head is on top — so the answer survives a renumber, and when it cannot
 * be reached it THROWS (`HumanSkeletonError`) rather than returning an
 * index that is merely wrong.
 *
 * ─── the rules, and the margin each one wins by ──────────────────────
 *
 * Every number here is measured off `tests/fixtures/humanBind.json`,
 * which is these two skeletons' bind joints exactly as the GLBs' inverse
 * bind matrices give them. The units are the file's own (both masters are
 * authored in metres at human scale).
 *
 *  - PELVIS: the shallowest joint below the root with three or more
 *    children. A human branches in exactly two places, the pelvis (spine
 *    + two legs) and the chest (neck + two arms), and the pelvis is the
 *    lower of them. On both masters the root has one child and that child
 *    has three, so the pelvis is index 1 — y 0.031 on Sarah, y 0.087 on
 *    Jack. Searching by DEPTH matters on Jack: his wrists have five
 *    children each, and an index-order search would find a hand.
 *
 *  - LEGS: the pelvis's children whose subtree reaches below the pelvis.
 *    Exactly two, by an enormous margin — the spine's subtree bottoms out
 *    0.10 ABOVE Sarah's pelvis while each leg reaches 0.74 below it.
 *
 *  - ANKLE: the last joint reached from the hip by steps that descend
 *    more in y than they travel horizontally. This is the one rule that
 *    had to be invented rather than copied, because the ankle is not a
 *    branch, not an extremity and not a change of direction — it is where
 *    a leg stops going DOWN and starts going FORWARD. Sarah's knee→ankle
 *    step drops 0.316 and travels 0.018 sideways (18:1); her ankle→toe
 *    step drops 0.073 and travels 0.114, of which 0.107 is forward in z.
 *    Jack's read 0.322/0.023 and 0.073/0.121. A rule that took the last
 *    joint of the chain would pose the TOE as the ankle and stand both
 *    people on their toe tips.
 *
 *  - KNEE: of the joints strictly between hip and ankle, the one nearest
 *    the midpoint of their heights. Sarah's hip is at 0.003 and her ankle
 *    at -0.635, so the midpoint is -0.316 and joint 26 sits at -0.319 —
 *    3 mm out, because a knee IS halfway down a leg.
 *
 *  - CHEST: walking up the spine, the first joint with three or more
 *    children — index 5 on both, y 0.398 (Sarah) and 0.404 (Jack).
 *    SPINE: the joint of that chain nearest the midpoint of pelvis and
 *    chest, which is index 3 on both.
 *
 *  - NECK AND HEAD: of the chest's child chains that rise above it, the
 *    one that STAYS nearest the pelvis's x. Not a close call: the neck
 *    chain strays at most 0.023 (Sarah) and 0.011 (Jack) from the body's
 *    centre line, while on either master the arm chains stray 0.67 and
 *    0.69. Thirty times the margin, so the test does not care that the
 *    arms also rise a little (0.449 against a chest at 0.398).
 *
 *  - ARMS: the two remaining chest children, furthest out in x. Within an
 *    arm ordered from the clavicle the picks are the 2nd, 3rd and 4th
 *    joints; on Sarah's -x arm they stand at x -0.144, -0.330 and -0.528
 *    with four more joints of hand beyond the wrist, and on Jack's at
 *    -0.172, -0.336 and -0.517 with a five-fingered hand beyond it.
 *    A rig with no clavicle (a chain shorter than four) falls back to
 *    proportional picks along the chain's own length.
 *
 * ─── which side is LEFT is a measurement too, and it is worth the care ─
 *
 * `leftSign` cannot be read off a bone name, and left and right are not
 * symmetric facts about a body: a pose that shakes a hand, carries a
 * clipboard or steps off on one foot has to pick the right one. So the
 * body's FACING is measured first, from the ankle→toe step — toes point
 * forward — taken on each foot and summed. That step runs +0.107 in z on
 * Sarah and +0.119 on Jack, against 0.040 and 0.023 of sideways travel,
 * so both masters face +z: glTF's own convention, and what
 * `tombs/LabPeople` verified by rendering them from +z ("you get Jack's
 * polo shirt and Sarah's front").
 *
 * With +y up and the body facing f, the body's left is `up × f`, whose x
 * component is f's z. Facing +z therefore puts the LEFT arm on +x, and
 * `leftSign` is +1 on both masters: Sarah's left wrist is index 20, not
 * index 12. That is worth stating because it contradicts the obvious
 * reading — the -x chain is the one a viewer sees on their left, and a
 * person facing you has their left hand on your right. The mirror is the
 * whole trap, and this is the file that either falls into it once or
 * never falls into it at all.
 *
 * If a rig has no joint beyond the ankle the head is the fallback cue: it
 * sits 0.028 (Sarah) and 0.040 (Jack) forward of the neck, the same sign
 * and a quarter of the signal, which is exactly why it is second and not
 * first. If neither cue is legible the facing is not guessed — it throws.
 *
 * ─── allocation ──────────────────────────────────────────────────────
 *
 * This function allocates, and is allowed to: it runs ONCE per master as
 * the GLB lands, not per frame. The per-frame surface of this pair is
 * `JointTurn`, which `humanPose` writes into caller-owned objects
 * (`newJointTurn`, `humanRig.ts`).
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that.
 */

import { HUMAN_JOINT_NAMES, type BindJoint, type HumanJointName, type HumanJoints, type HumanMeasure } from './humanRig';

/**
 * A skeleton that could not be resolved. Named and explanatory because
 * the alternative — a plausible-looking wrong index — is the exact
 * failure this module exists to prevent: it does not throw, it does not
 * look wrong in a test, and it shows up as an elbow bending a neck.
 */
export class HumanSkeletonError extends Error {
  constructor(message: string) {
    super(`human skeleton: ${message}`);
    this.name = 'HumanSkeletonError';
  }
}

function fail(message: string): never {
  throw new HumanSkeletonError(message);
}

/** How many children make a joint a branch point. A human has two: pelvis and chest. */
const BRANCH = 3;

/**
 * Where an arm's joints sit along its own length when there is no
 * clavicle to count from — fractions of the chain's cumulative length.
 * Only reached by a rig sparser than either master; both of these walk
 * the clavicle path above.
 */
const ARM_FRACTIONS: readonly number[] = [0.25, 0.55, 0.85];

/**
 * Comparisons are made against a fraction of the skeleton's own height
 * rather than an absolute number, because the bind file's units are
 * whatever the master was authored in (`HumanMeasure`'s note). A
 * thousandth of a 1.34-unit body is 1.3 mm — far below every margin
 * quoted in the header, and far above the export's own quantisation
 * (every coordinate in both masters lands on a lattice of 0.0028).
 */
const TOLERANCE = 1e-3;

interface Tree {
  readonly bind: readonly BindJoint[];
  readonly root: number;
  readonly children: readonly (readonly number[])[];
  /** Joints in each subtree, the joint itself included. Picks a limb's main line. */
  readonly size: readonly number[];
  /** Lowest and highest y anywhere in each subtree. Tells a leg from a spine. */
  readonly lowest: readonly number[];
  readonly highest: readonly number[];
}

function distance(a: BindJoint, b: BindJoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Travel in the ground plane only — the other half of the ankle rule. */
function groundTravel(a: BindJoint, b: BindJoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function describe(bind: readonly BindJoint[], joint: number): string {
  const j = bind[joint];
  return `${joint} (${j.name}, y ${j.y.toFixed(3)})`;
}

/**
 * Validate the array and precompute what every rule below asks of it.
 * The checks here are the cheap ones that make a later answer trustworthy
 * rather than merely returned: one root, in-range parents, finite
 * positions, and every joint actually hanging off that root — a pair of
 * joints parented to each other is a legal-looking array and an infinite
 * loop for anything that walks up.
 */
function readTree(bind: readonly BindJoint[]): Tree {
  const n = bind.length;
  const needed = HUMAN_JOINT_NAMES.length;
  if (n < needed) fail(`${n} joints cannot carry ${needed} named ones`);

  const children: number[][] = [];
  for (let i = 0; i < n; i += 1) children.push([]);

  let root = -1;
  let roots = 0;
  for (let i = 0; i < n; i += 1) {
    const joint = bind[i];
    if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y) || !Number.isFinite(joint.z)) {
      fail(`joint ${i} (${joint.name}) is at (${joint.x}, ${joint.y}, ${joint.z}), which is not a position`);
    }
    const parent = joint.parent;
    if (parent === -1) {
      roots += 1;
      if (root < 0) root = i;
      continue;
    }
    if (!Number.isInteger(parent) || parent < 0 || parent >= n || parent === i) {
      fail(`joint ${i} (${joint.name}) has parent ${parent}, which is not another joint of these ${n}`);
    }
    children[parent].push(i);
  }
  if (roots !== 1) fail(`${roots} joints have no parent; a skeleton has exactly one root`);

  const order: number[] = [];
  const stack: number[] = [root];
  while (stack.length > 0) {
    const at = stack.pop() as number;
    order.push(at);
    for (const child of children[at]) stack.push(child);
  }
  if (order.length !== n) {
    fail(`only ${order.length} of ${n} joints hang off the root; the rest are detached or parented in a loop`);
  }

  const size: number[] = new Array<number>(n).fill(1);
  const lowest: number[] = bind.map((j) => j.y);
  const highest: number[] = bind.map((j) => j.y);
  for (let k = n - 1; k >= 0; k -= 1) {
    const at = order[k];
    const parent = bind[at].parent;
    if (parent < 0) continue;
    size[parent] += size[at];
    if (lowest[at] < lowest[parent]) lowest[parent] = lowest[at];
    if (highest[at] > highest[parent]) highest[parent] = highest[at];
  }

  return { bind, root, children, size, lowest, highest };
}

/**
 * The main line of a limb from `start` to a tip: at a branch, the child
 * carrying the most bone, and the further one when two carry the same.
 * A hand's fingers are equal-sized branches off the wrist, so the
 * tie-break only decides which finger the chain ends in — a joint no
 * caller of this file ever asks for.
 */
function mainLine(tree: Tree, start: number): number[] {
  const chain: number[] = [start];
  let at = start;
  for (;;) {
    const children = tree.children[at];
    if (children.length === 0) return chain;
    let best = children[0];
    for (const child of children) {
      if (tree.size[child] > tree.size[best]) best = child;
      else if (tree.size[child] === tree.size[best]
        && distance(tree.bind[at], tree.bind[child]) > distance(tree.bind[at], tree.bind[best])) best = child;
    }
    chain.push(best);
    at = best;
  }
}

/** The shallowest branch point at or below `from`, breadth first. */
function firstBranch(tree: Tree, from: number): number {
  const queue: number[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    if (tree.children[at].length >= BRANCH) return at;
    for (const child of tree.children[at]) queue.push(child);
  }
  return -1;
}

interface Leg {
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  /** The joint beyond the ankle, or -1 when the foot ends there. Carries the facing. */
  readonly toe: number;
}

/**
 * Hip, knee and ankle out of one leg chain. See the header for why the
 * ankle is the last joint that is still going DOWN rather than the last
 * joint of the chain.
 */
function readLeg(tree: Tree, chain: readonly number[]): Leg {
  const bind = tree.bind;
  const hip = chain[0];
  let ankleAt = 0;
  for (let k = 1; k < chain.length; k += 1) {
    const from = bind[chain[k - 1]];
    const to = bind[chain[k]];
    const drop = from.y - to.y;
    if (drop <= groundTravel(from, to)) break;
    ankleAt = k;
  }
  if (ankleAt === 0) {
    fail(`the leg at ${describe(bind, hip)} never descends: its first step travels further sideways than it drops, so nothing in it is an ankle`);
  }
  if (ankleAt < 2) {
    fail(`the leg at ${describe(bind, hip)} reaches its ankle in one step, leaving no joint between hip and ankle to be a knee`);
  }

  const ankle = chain[ankleAt];
  const midpoint = (bind[hip].y + bind[ankle].y) * 0.5;
  let knee = chain[1];
  for (let k = 2; k < ankleAt; k += 1) {
    if (Math.abs(bind[chain[k]].y - midpoint) < Math.abs(bind[knee].y - midpoint)) knee = chain[k];
  }

  return { hip, knee, ankle, toe: ankleAt + 1 < chain.length ? chain[ankleAt + 1] : -1 };
}

interface Arm {
  readonly shoulder: number;
  readonly elbow: number;
  readonly wrist: number;
}

/**
 * Shoulder, elbow and wrist out of one arm chain ordered from the
 * clavicle. Both masters take the first branch: clavicle, then the next
 * three joints. The proportional fallback is for a rig with no clavicle,
 * where the chain IS shoulder-elbow-wrist and the fractions land on 0,
 * 0.5 and 1 of its length; it refuses rather than aliasing two names onto
 * one bone, because an elbow that is also a wrist bends twice.
 */
function readArm(tree: Tree, chain: readonly number[]): Arm {
  if (chain.length >= 4) return { shoulder: chain[1], elbow: chain[2], wrist: chain[3] };
  if (chain.length < ARM_FRACTIONS.length) {
    fail(`a shoulder, an elbow and a wrist need three joints; the arm at ${describe(tree.bind, chain[0])} has ${chain.length}`);
  }

  const cumulative: number[] = [0];
  for (let k = 1; k < chain.length; k += 1) {
    cumulative.push(cumulative[k - 1] + distance(tree.bind[chain[k - 1]], tree.bind[chain[k]]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) fail(`the arm at ${describe(tree.bind, chain[0])} has no length to divide`);

  const picks: number[] = [];
  for (const fraction of ARM_FRACTIONS) {
    let best = 0;
    for (let k = 1; k < chain.length; k += 1) {
      if (Math.abs(cumulative[k] / total - fraction) < Math.abs(cumulative[best] / total - fraction)) best = k;
    }
    picks.push(best);
  }
  if (picks[0] >= picks[1] || picks[1] >= picks[2]) {
    fail(`the arm at ${describe(tree.bind, chain[0])} is too sparse to tell a shoulder, an elbow and a wrist apart`);
  }
  return { shoulder: chain[picks[0]], elbow: chain[picks[1]], wrist: chain[picks[2]] };
}

/**
 * Which way the body faces, as the z of a forward vector. The toes are
 * the strong cue and the head is the weak one; see the header for both
 * sets of numbers and why the order is not arbitrary.
 */
function facingZ(tree: Tree, legs: readonly Leg[], neck: number, head: number, tolerance: number): number {
  let x = 0;
  let z = 0;
  for (const leg of legs) {
    if (leg.toe < 0) continue;
    x += tree.bind[leg.toe].x - tree.bind[leg.ankle].x;
    z += tree.bind[leg.toe].z - tree.bind[leg.ankle].z;
  }
  let cue = 'the feet';
  if (Math.hypot(x, z) <= tolerance) {
    x = tree.bind[head].x - tree.bind[neck].x;
    z = tree.bind[head].z - tree.bind[neck].z;
    cue = 'the head';
  }
  if (Math.abs(z) <= Math.abs(x) || Math.abs(z) <= tolerance) {
    fail(`${cue} say the body faces (${x.toFixed(3)}, ${z.toFixed(3)}), which does not name a front along z; left and right cannot be told apart`);
  }
  return z;
}

/**
 * Seventeen joints and four spans, measured out of one bind pose.
 *
 * Throws `HumanSkeletonError` naming what was looked for and what was
 * found when the shape is not a standing human — which is the contract
 * that matters, because the alternative is a pose that turns the wrong
 * bone and nothing that says so.
 */
export function measureHuman(bind: readonly BindJoint[]): HumanMeasure {
  const tree = readTree(bind);
  const joint = tree.bind;

  let lowestY = joint[0].y;
  let highestY = joint[0].y;
  let crown = 0;
  for (let i = 1; i < joint.length; i += 1) {
    if (joint[i].y < lowestY) lowestY = joint[i].y;
    if (joint[i].y > highestY) {
      highestY = joint[i].y;
      crown = i;
    }
  }
  const height = highestY - lowestY;
  if (height <= 0) fail('every joint is at the same height; this is not a standing body');
  const tolerance = height * TOLERANCE;

  const pelvis = firstBranch(tree, tree.root);
  if (pelvis < 0) {
    fail(`no joint has ${BRANCH} or more children, so there is no pelvis: a human branches at the pelvis and again at the chest`);
  }

  // The legs are the pelvis's children that reach below it; the spine is
  // the one that reaches highest above it. Both are subtree questions,
  // because a child joint on its own says nothing about where its limb goes.
  const legChains: number[][] = [];
  let spineStart = -1;
  for (const child of tree.children[pelvis]) {
    if (tree.lowest[child] < joint[pelvis].y - tolerance) {
      legChains.push(mainLine(tree, child));
      continue;
    }
    if (spineStart < 0 || tree.highest[child] > tree.highest[spineStart]) spineStart = child;
  }
  if (legChains.length !== 2) {
    fail(`${legChains.length} of the pelvis's ${tree.children[pelvis].length} children at ${describe(joint, pelvis)} descend below it; a human has two legs`);
  }
  if (spineStart < 0) fail(`nothing rises from the pelvis at ${describe(joint, pelvis)}; there is no spine`);

  const legs = [readLeg(tree, legChains[0]), readLeg(tree, legChains[1])];

  const torso = mainLine(tree, spineStart);
  const chestAt = torso.findIndex((at) => tree.children[at].length >= BRANCH);
  if (chestAt < 0) {
    fail(`the spine from ${describe(joint, spineStart)} reaches a tip without branching; there is no chest to hang arms and a neck from`);
  }
  const chest = torso[chestAt];
  if (chestAt < 1) {
    fail(`the chest at ${describe(joint, chest)} is the pelvis's own child, leaving no joint between them to be a spine`);
  }
  const spineMid = (joint[pelvis].y + joint[chest].y) * 0.5;
  let spine = torso[0];
  for (let k = 1; k < chestAt; k += 1) {
    if (Math.abs(joint[torso[k]].y - spineMid) < Math.abs(joint[spine].y - spineMid)) spine = torso[k];
  }

  // The neck is the chest's chain that rises AND stays on the centre line.
  // Both clauses are needed: the arms rise a little too (0.449 against a
  // 0.398 chest on Sarah), and they leave the centre line by thirty times
  // what the neck does.
  let neckChain: number[] | null = null;
  let neckStray = Infinity;
  for (const child of tree.children[chest]) {
    const chain = mainLine(tree, child);
    let top = -Infinity;
    let stray = 0;
    for (const at of chain) {
      if (joint[at].y > top) top = joint[at].y;
      stray = Math.max(stray, Math.abs(joint[at].x - joint[pelvis].x));
    }
    if (top <= joint[chest].y + tolerance) continue;
    if (stray < neckStray) {
      neckStray = stray;
      neckChain = chain;
    }
  }
  if (neckChain === null) {
    fail(`nothing rises from the chest at ${describe(joint, chest)}; there is no neck`);
  }
  const neck = neckChain[0];
  let head = neck;
  for (const at of neckChain) if (joint[at].y > joint[head].y) head = at;
  if (head === neck) fail(`the neck at ${describe(joint, neck)} carries nothing above it to be a head`);

  const armStarts = tree.children[chest]
    .filter((child) => child !== neck)
    .sort((a, b) => Math.abs(joint[b].x - joint[chest].x) - Math.abs(joint[a].x - joint[chest].x))
    .slice(0, 2);
  if (armStarts.length < 2) {
    fail(`the chest at ${describe(joint, chest)} carries ${armStarts.length} limb(s) besides the neck; a human has two arms`);
  }
  const arms = [readArm(tree, mainLine(tree, armStarts[0])), readArm(tree, mainLine(tree, armStarts[1]))];

  const leftSign = facingZ(tree, legs, neck, head, tolerance) > 0 ? 1 : -1;

  const legSide = legs.map((leg) => Math.sign(joint[leg.hip].x - joint[pelvis].x));
  if (legSide[0] === 0 || legSide[0] === legSide[1]) {
    fail(`both hips sit on the same side of the pelvis at ${describe(joint, pelvis)} (x ${joint[legs[0].hip].x.toFixed(3)} and ${joint[legs[1].hip].x.toFixed(3)})`);
  }
  const armSide = arms.map((arm) => Math.sign(joint[arm.wrist].x - joint[chest].x));
  if (armSide[0] === 0 || armSide[0] === armSide[1]) {
    fail(`both wrists sit on the same side of the chest at ${describe(joint, chest)} (x ${joint[arms[0].wrist].x.toFixed(3)} and ${joint[arms[1].wrist].x.toFixed(3)})`);
  }

  const legL = legSide[0] === leftSign ? legs[0] : legs[1];
  const legR = legL === legs[0] ? legs[1] : legs[0];
  const armL = armSide[0] === leftSign ? arms[0] : arms[1];
  const armR = armL === arms[0] ? arms[1] : arms[0];

  const joints: HumanJoints = {
    pelvis, spine, chest, neck, head,
    shoulderL: armL.shoulder, elbowL: armL.elbow, wristL: armL.wrist,
    shoulderR: armR.shoulder, elbowR: armR.elbow, wristR: armR.wrist,
    hipL: legL.hip, kneeL: legL.knee, ankleL: legL.ankle,
    hipR: legR.hip, kneeR: legR.knee, ankleR: legR.ankle,
  };

  // The last guard, and the one the header is about: seventeen NAMES that
  // resolved to sixteen bones is a pose with a joint doing two jobs, and
  // every rule above can be locally right and still land there on a rig
  // nobody has seen. Cheap to check, impossible to debug from a screenshot.
  const seen = new Map<number, HumanJointName>();
  for (const name of HUMAN_JOINT_NAMES) {
    const index = joints[name];
    const already = seen.get(index);
    if (already !== undefined) fail(`${name} and ${already} both resolved to joint ${describe(joint, index)}`);
    seen.set(index, name);
  }
  if (joints.head !== crown) {
    fail(`the head resolved to ${describe(joint, joints.head)} while the highest joint is ${describe(joint, crown)}`);
  }

  return {
    joints,
    height,
    armSpan: distance(joint[joints.wristL], joint[joints.wristR]),
    legLength: Math.max(
      distance(joint[joints.hipL], joint[joints.ankleL]),
      distance(joint[joints.hipR], joint[joints.ankleR]),
    ),
    hipWidth: distance(joint[joints.hipL], joint[joints.hipR]),
    leftSign,
  };
}
