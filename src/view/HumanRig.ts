/**
 * WHERE A HUMAN POSE BECOMES A MESH — the one line of arithmetic that
 * `actor/humanRig.ts` deliberately refused to write.
 *
 * `humanPose.poseHuman` produces `JointTurn[]`: an axis and an angle per
 * joint, in the BIND POSE'S OWN WORLD FRAME. That frame was chosen
 * because an auto-rigged bone's local axes are whatever Meshy happened to
 * emit — not anatomical, not consistent between the left arm and the
 * right, and different between the two masters — so "rotate the upper arm
 * 77.5° about world Z" is the only statement that is true of both bodies
 * and stays true when either is re-exported. The price of that choice is
 * exactly one conversion, and it is paid here, at the render boundary,
 * because `actor/` may not import three.
 *
 * ─── the conversion, and why P is the BIND parent ───────────────────
 *
 * For a joint J with bind world rotation B and parent bind world rotation
 * P, the local quaternion realising a world turn R is
 *
 *     local = P⁻¹ · R · B
 *
 * P is the parent's rotation IN THE BIND POSE, not its rotation this
 * frame, and that is the whole reason `humanPose` can be as short as it
 * is. Substituting the posed bone's world rotation W_j = W_parent · local
 * gives W_j = A_parent · R_j · B_j, so a joint's accumulated world turn is
 * A_j = A_parent · R_j: EVERY TURN IS APPLIED IN THE BIND FRAME AND THEN
 * CARRIED BY ITS PARENTS. That is what lets `humanPose` write the elbow
 * as if the arm were still horizontal and let the shoulder's swing carry
 * the bent forearm down with it, with no angle in that file correcting
 * for another angle above it. Use the parent's LIVE rotation instead and
 * every turn becomes absolute, the arms stop following the chest, and the
 * poses in `humanPose` — which are written against the header quoted
 * above — silently mean something else.
 *
 * P⁻¹ therefore depends on nothing that changes, so it is computed once
 * per master at load (`pre`) and a frame is two quaternion multiplies per
 * joint and no allocation at all.
 *
 * ─── a joint nobody mentions goes BACK to its bind rotation ─────────
 *
 * `apply` restores every bone the turn list does not name. This is not
 * tidiness; it is the bug class `humanPose`'s header already paid for
 * once from the other side ("a consumer applies the turns it is GIVEN, so
 * a knee that appears in `walk` and is omitted from `stand` keeps last
 * frame's bend and the body stands there with a bent leg"). That file
 * closed it by always writing the same fifteen joints. This file closes
 * it again from the consumer's end, so a SECOND poser — a future sit, a
 * flinch, a hand on a console — cannot reintroduce it by writing a
 * shorter list. A pose is the whole body, every frame, or bones keep
 * angles nobody can find the source of.
 *
 * Restoring is a `copy` over 35 or 69 quaternions, which is why it can be
 * unconditional rather than tracked.
 *
 * The turns may also arrive in any order. Every local is a function of
 * constants and its own turn, so nothing here depends on a parent being
 * written before its child — `humanPose` orders them parent-first for its
 * own reasons, and this file does not rely on it.
 *
 * ─── what was measured on the two masters ───────────────────────────
 *
 * Both GLBs were loaded through `GLTFLoader` (with the materials stripped,
 * so node could parse them) and compared against
 * `tests/fixtures/humanBind.json`:
 *
 *  - `readBindJoints` reproduces the fixture's STRUCTURE exactly — 69
 *    joints for Jack and 35 for Sarah, every name and every parent index
 *    identical, zero mismatches, one root each.
 *
 *  - Its POSITIONS come out a uniform 1.384083× the fixture's (measured
 *    over both masters: min 1.384017, median 1.384082, max 1.384254, the
 *    spread being the fixture's six-decimal rounding on millimetre
 *    values). The factor is exactly (1/0.85)², the square of the uniform
 *    scale the inverse bind matrices carry, so whatever generated the
 *    checked-in file divided that scale out twice. IT CHANGES NOTHING
 *    DOWNSTREAM — `humanSkeleton` compares against fractions of the
 *    skeleton's own height and `humanPose` writes amplitudes as fractions
 *    of its own `legLength`, both by explicit design ("the lengths are in
 *    the BIND FILE'S OWN UNITS and are not metres") — but an integrator
 *    who prints a limb length and finds it 1.38× the fixture's is looking
 *    at this and not at a bug.
 *
 *  - The bind matrices' uniform scale is 1.176471 on every bone of both
 *    masters, so ONE BIND UNIT IS 0.85 m. That is not inferred from a
 *    quoted body height: the drawn rest pose is the bind skeleton under
 *    ONE GLOBAL SIMILARITY, and the fit is exact. Divide every bind joint
 *    by 1.176471, subtract where that bone actually stands, and the same
 *    offset comes back for all 69 of Jack's joints and all 35 of Sarah's
 *    — (−0.0011, 0.8500, 0.0003) and (0.0000, 0.8500, 0.0007) — with a
 *    worst residual of 7.0e−7 and 6.6e−7. Bind, scaled by 0.85 and lifted
 *    0.85 m, IS the pose that draws, and it draws exactly 1.7000 m tall
 *    with its feet at y 0.0000 (bounding box, both masters — the figure
 *    `tombs/LabPeople` cites).
 *
 *    THIS FILE ONLY EVER WRITES ROTATIONS, which is what keeps that true.
 *    A bone's local translation is left exactly as the GLB set it, so the
 *    similarity survives every pose and a posed body is still 1.700 m
 *    tall standing on the floor. A rig that also wrote the bind POSITIONS
 *    onto the bones would drop each one 0.85 m and blow the body up by
 *    18% on the first frame it posed.
 *
 *  - THE BIND FRAME'S ORIGIN IS NOT THE FLOOR, which is the other half of
 *    that offset. The lowest joint sits at y −0.98 on both masters and
 *    the pelvis near y +0.05, so a bind y is a height about the HIPS and
 *    never a height above the ground. Nothing may lift a body by one.
 *    `bindHeight` (1.8984 Jack, 1.8594 Sarah) and `bindScale` publish the
 *    span and the conversion so a caller can do this arithmetic rather
 *    than guess at it: in metres those spans are 1.614 and 1.580, 95% and
 *    93% of the bodies — the crown-joint-to-toe-joint fraction, the
 *    highest joint being inside the skull and the lowest a toe rather
 *    than a sole.
 *
 *  - The conversion itself was checked against the loaded skeletons
 *    rather than argued. With a single turn on an arm whose parents are
 *    untouched, the bone's world rotation lands on R · B to 0.0000° on
 *    both masters; adding a turn on that arm's parent lands it on
 *    R_parent · R · B, again to 0.0000° on both. Reversing the order of
 *    the two turns leaves every bone bit-identical.
 *
 *    A WARNING TO WHOEVER CHECKS THIS NEXT: `Quaternion.angleTo` is
 *    `2·acos(|dot|)`, and acos near 1 turns a rounding error into a
 *    visible angle. Measured with it, these same exact results read
 *    0.06° and the identity read 0.0017 rad. Compare two rotations by
 *    their dot product, or normalise first; a residual of a twentieth of
 *    a degree here is the instrument, not the rig.
 *
 *  - Each master loads as TWO `SkinnedMesh`es sharing ONE `Skeleton`
 *    object (verified by identity). Posing the bones therefore poses both
 *    halves, and `findSkinnedMesh` returning one of them is not a partial
 *    answer.
 *
 *  - The rotations the model loads with ARE the bind rotations, and much
 *    more exactly than the positions are: every bone's local quaternion
 *    matches `B_parent⁻¹ · B_j` to 3.1e−4° on Jack and 5.0e−4° on Sarah,
 *    and its world rotation matches `B_j` to the same, with the
 *    `UniRigArmature` above the root at the identity on both masters.
 *
 *    EVERY REST ROTATION HERE IS STILL THE DERIVED ONE, `P⁻¹ · B`, and
 *    never the loaded local, though the loaded local is what the exporter
 *    wrote and the two agree to five decimal places. `apply` gives a
 *    named joint `P⁻¹ · R · B`; restoring an UNNAMED joint from the
 *    loaded local would make a joint written with a zero turn and a joint
 *    left out two different numbers that happen to be close. `humanPose`
 *    writes fifteen joints every frame and leaves the fingers, toes and
 *    clavicles out, so both paths run on one body at once. One source for
 *    both means the rest pose is identical by construction, and stays
 *    identical if a future bake exports node rotations that agree less
 *    well.
 *
 * ─── what this file may not import ──────────────────────────────────
 *
 * `view/` is an adapter, so three is allowed here and nothing else is:
 * no `tombs/` (which owns where a body stands), no `ui/`. It reads a
 * loaded object and writes bone rotations, and it is the only thing in
 * the human chain that knows either of those exist.
 */
import * as THREE from 'three';
import type { BindJoint, JointTurn } from '../actor/humanRig';

/**
 * A model that cannot be rigged. Named and thrown rather than returning
 * an empty array, because the failure it reports — a GLB with no skin, or
 * a skin whose bones were dropped by a bake — produces a body that stands
 * in a T for ever with nothing on screen or in the console saying why.
 */
export class HumanRigError extends Error {
  constructor(message: string) {
    super(`human rig: ${message}`);
    this.name = 'HumanRigError';
  }
}

/**
 * The skinned mesh a loaded human hangs its skeleton off.
 *
 * Both masters load as two skins sharing one `Skeleton`, so the choice is
 * academic on them; it takes the one with the most bones so that a future
 * export which skins a prop — a clipboard, a badge on its own chain — to a
 * short private skeleton cannot win the traversal by being first.
 */
export function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let best: THREE.SkinnedMesh | null = null;
  root.traverse((node) => {
    const skin = node as THREE.SkinnedMesh;
    if (skin.isSkinnedMesh !== true || skin.skeleton === undefined) return;
    if (best === null || skin.skeleton.bones.length > best.skeleton.bones.length) best = skin;
  });
  return best;
}

/**
 * The bind pose of a loaded human, in the shape `actor/humanSkeleton` and
 * `actor/humanPose` read and `tests/fixtures/humanBind.json` stores.
 *
 * Each joint's position is the translation of the INVERSE of
 * `skeleton.boneInverses[i]` — the bone's own world placement at the
 * moment the skin was bound. A bone's local translation is not used and
 * could not be: it says nothing about where a joint is without walking
 * the whole chain first, and the chain above it is only trustworthy while
 * the model is unposed.
 *
 * `parent` is the index of the bone's IMMEDIATE parent within this same
 * list, or -1. A bone whose parent is not itself in the list — the root,
 * under its armature — reads -1, and `measureHuman` refuses a list with
 * more than one of those, which is the honest failure if a re-export ever
 * slips a node in between two bones.
 *
 * Allocates, and is allowed to: it runs once per master as the GLB lands.
 */
export function readBindJoints(root: THREE.Object3D): BindJoint[] {
  const skin = findSkinnedMesh(root);
  if (skin === null) throw new HumanRigError('the loaded model contains no SkinnedMesh, so there is no skeleton to pose');

  const bones = skin.skeleton.bones;
  const inverses = skin.skeleton.boneInverses;
  if (bones.length === 0) throw new HumanRigError('the skin has no bones');
  if (inverses.length !== bones.length) {
    throw new HumanRigError(`${bones.length} bones against ${inverses.length} inverse bind matrices; the skin is malformed`);
  }

  const index = new Map<THREE.Object3D, number>();
  for (let i = 0; i < bones.length; i += 1) index.set(bones[i], i);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  const bind: BindJoint[] = [];
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    matrix.copy(inverses[i]).invert().decompose(position, rotation, scale);
    const parent = bone.parent !== null ? index.get(bone.parent) : undefined;
    bind.push({
      name: bone.name,
      parent: parent === undefined ? -1 : parent,
      x: position.x,
      y: position.y,
      z: position.z,
    });
  }
  return bind;
}

/**
 * A loaded human, posed by `JointTurn[]`.
 *
 * Built once per body as the GLB lands; `apply` then runs every frame and
 * allocates nothing — the two quaternions and the vector it works through
 * are fields, the way `fauna/` keeps its scratch.
 */
export class HumanRig {
  /** The bind pose, for `measureHuman` and `poseHuman` to read. */
  readonly bind: readonly BindJoint[];

  /**
   * Crown joint to lowest joint, in the bind file's own units: 1.8984 on
   * Jack and 1.8594 on Sarah. NOT a body height — see the header: the
   * highest joint is inside the skull and the lowest is a toe, so this
   * span is 95% and 93% of the 1.700 m these two actually draw.
   */
  readonly bindHeight: number;

  /**
   * The uniform scale the inverse bind matrices carry, measured at
   * 1.176471 on every bone of both masters. Its reciprocal, 0.85, is
   * metres per bind unit, which is the conversion a caller needs to turn
   * anything `measureHuman` reports into a length it can compare with the
   * scene. Published rather than assumed because it is a property of the
   * bake, and the next one may choose differently.
   */
  readonly bindScale: number;

  private bones: THREE.Bone[];
  /** `P⁻¹` per joint: the inverse bind world rotation of its parent. */
  private readonly pre: THREE.Quaternion[];
  /** `B` per joint: its own bind world rotation. */
  private readonly bindWorld: THREE.Quaternion[];
  /** `P⁻¹ · B` per joint: where a bone sits when no turn names it. */
  private readonly bindLocal: THREE.Quaternion[];
  /** Which bones this frame's turns named. One byte a bone, reused. */
  private readonly named: Uint8Array;

  private readonly turn = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();

  constructor(root: THREE.Object3D) {
    const skin = findSkinnedMesh(root);
    if (skin === null) throw new HumanRigError('the loaded model contains no SkinnedMesh, so there is no skeleton to pose');

    this.bind = readBindJoints(root);
    this.bones = skin.skeleton.bones.slice();
    const count = this.bones.length;

    this.pre = [];
    this.bindWorld = [];
    this.bindLocal = [];
    this.named = new Uint8Array(count);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    // Measured identical on every bone of both masters (1.176471), so the
    // first bone's is the skeleton's. Read here rather than assumed, so a
    // bake that changed it would move `bindScale` instead of quietly
    // making every metre this rig reports wrong.
    let bindScale = 1;
    for (let i = 0; i < count; i += 1) {
      const world = new THREE.Quaternion();
      matrix.copy(skin.skeleton.boneInverses[i]).invert().decompose(position, world, scale);
      if (i === 0) bindScale = scale.x;
      // `decompose` reads its rotation out of a matrix whose floats came
      // through meshopt, so it lands off unit — measured at 1.15e-7 on
      // Jack and 1.79e-7 on Sarah. Left alone that survives every product
      // below and reaches the bone as a 0.4 ppm scale on a body that is
      // supposed to be exactly 1.700 m. Normalising costs one square root
      // per joint, once, at load.
      this.bindWorld.push(world.normalize());
    }
    this.bindScale = bindScale;

    for (let i = 0; i < count; i += 1) {
      const parent = this.bind[i].parent;
      // A parented bone's three.js parent IS its parent bone, so the
      // frame its local quaternion is applied in is exactly that bone's
      // bind world rotation. The root's is the armature above it, which
      // is not in the list and has no bind rotation of its own recorded —
      // but the root's own local quaternion AS LOADED is B composed with
      // it, so the armature's rotation falls straight out as L · B⁻¹.
      // Measured at the identity on both masters; computed anyway, so a
      // re-export that turns the armature poses correctly.
      const pre = (parent >= 0
        ? this.bindWorld[parent].clone().invert()
        : this.bones[i].quaternion.clone().multiply(this.bindWorld[i].clone().invert())).normalize();
      this.pre.push(pre);
      this.bindLocal.push(pre.clone().multiply(this.bindWorld[i]).normalize());
    }

    // `readBindJoints` has already refused a skin with no bones, so index
    // zero is always there to start from.
    let lowest = 0;
    let highest = 0;
    for (let i = 1; i < count; i += 1) {
      if (this.bind[i].y < this.bind[lowest].y) lowest = i;
      if (this.bind[i].y > this.bind[highest].y) highest = i;
    }
    this.bindHeight = this.bind[highest].y - this.bind[lowest].y;
  }

  /**
   * One frame. Every named joint takes `P⁻¹ · R · B`; every joint the list
   * does not name goes back to its bind rotation, so no bone can hold an
   * angle from a pose that has stopped asking for it.
   *
   * A turn whose index is outside the skeleton is skipped rather than
   * thrown on: the indices come from `measureHuman`, which measured THIS
   * bind list, so an out-of-range index means a pose built against another
   * body — and a frame is the wrong place to discover it, where it would
   * throw sixty times a second.
   */
  apply(turns: readonly JointTurn[]): void {
    const bones = this.bones;
    if (bones.length === 0) return;

    this.named.fill(0);
    for (let t = 0; t < turns.length; t += 1) {
      const turn = turns[t];
      const j = turn.joint;
      if (j < 0 || j >= bones.length) continue;

      // `humanRig.JointTurn` promises a unit axis; the guard costs one dot
      // product and catches the degenerate case a half-filled scratch turn
      // would otherwise turn into a quaternion that SCALES the bone.
      this.axis.set(turn.ax, turn.ay, turn.az);
      const square = this.axis.lengthSq();
      if (square <= 0) continue;
      if (Math.abs(square - 1) > 1e-6) this.axis.multiplyScalar(1 / Math.sqrt(square));

      this.turn.setFromAxisAngle(this.axis, turn.radians);
      this.turn.multiply(this.bindWorld[j]).premultiply(this.pre[j]);
      bones[j].quaternion.copy(this.turn);
      this.named[j] = 1;
    }

    for (let i = 0; i < bones.length; i += 1) {
      if (this.named[i] === 0) bones[i].quaternion.copy(this.bindLocal[i]);
    }
  }

  /**
   * Back to the bind pose — the T these masters ship in. `apply([])` does
   * the same thing; this says so at the call site, and is what a caller
   * wants while a body is being set up or torn down.
   */
  rest(): void {
    for (let i = 0; i < this.bones.length; i += 1) this.bones[i].quaternion.copy(this.bindLocal[i]);
  }

  /**
   * Let the model go. The rig owns no geometry, material or texture —
   * those belong to the loader and to whoever added the body to the scene
   * — so the only thing to release is this rig's own hold on the bones,
   * which would otherwise keep a whole skeleton alive after the body was
   * removed. `apply` and `rest` become no-ops rather than throwing: a
   * disposed rig being posted one more frame by a caller that is tearing
   * down in its own order is not an error worth ending a frame over.
   */
  dispose(): void {
    this.bones = [];
  }
}
