/**
 * THE POSERS ON KNOWN BONES — the jaws, the wings, the tripod's geometry,
 * the head and the gaster, driven by hand-built signals so each claim
 * is about the arithmetic and nothing else:
 *
 *   the two jaws are independent: during a bite their angles differ,
 *     while walking both are at rest, and neither ever passes the limit
 *   a feed works them alternately; at rest each has its own twitch
 *   the bite is deterministic — the same phase and count, the same jaws
 *   the wings fold on the ground and spread in the air, from EITHER
 *     rest pose (the fly's folded, the queen's spread), beat only while
 *     up, and the queen's hind pair lags the fore
 *   the wingbeat is per species: 96 for the queen, 170 for the fly
 *   on the synthetic legged rig the tripod is real: a mirrored pair's
 *     feet move in OPPOSITE directions and a tripod's three together,
 *     and a swinging foot lifts off the ground
 *   THE ROOT'S FRAME IS (UP, HEADING): on the ground the quaternion is
 *     the old `Euler(−pitch, heading, bank, 'YXZ')` to 1e-12, on a wall
 *     local +Y is the wall's normal and local +Z the heading carried
 *     onto it, the attitude is a local turn, the drawn up eases onto a
 *     new up within a second and settles exactly, and a half turn
 *     (a takeoff from the ceiling) is a turn and not a snap
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FACE_NORMALS, WORLD_UP, aheadOn, rotateBetween, vec3, type MutableVec3 } from '../src/creatures';
import {
  JAW_FEED, JAW_OPEN, JAW_TWITCH, LEG_LIFT, UP_EASE_S, UP_SETTLED, drawnAhead, easeUp, newMotion, poseGaster, poseHead, poseJaws,
  poseLegs, resetMotion, rootQuaternion, stepMotion,
  type BoundJaw, type BoundJoint, type BoundLeg, type RigMotion,
} from '../src/fauna/motion';
import { bonesOf, findLegs, findTrunk, measureRig, type JawSpec } from '../src/fauna/rig';
import {
  HIND_FOLD_FAN, HIND_LAG, WINGBEAT_HZ, WING_FLAP, WING_FOLDED_MAX, WING_FOLDED_YAW, WING_OPEN_S, WING_SPREAD_YAW, foldedYawOf,
  poseWings, wingTurn, wingYawAt, wingbeatHzOf, type BoundWing,
} from '../src/fauna/wings';
import { leggedRig } from './faunaFixtures';

const DT = 1 / 60;

/** Two jaws with identity rests, hinged about the body's up, −X first — the shape `findMandibles` returns. */
function jaws(): BoundJaw[] {
  return [-1, 1].map((side) => {
    const bone = new THREE.Bone();
    const spec: JawSpec = { bone: `jaw${side}`, tip: `tip${side}`, rest: new THREE.Quaternion(), side, hinge: new THREE.Vector3(0, 1, 0) };
    return { bone, spec, angle: 0 };
  });
}

interface Frame { readonly moved: number; readonly biting?: boolean; readonly feeding?: boolean }

/** Run the jaws for `frames` frames of one signal, returning both angles per frame. */
function run(j: BoundJaw[], m: RigMotion, frames: number, f: Frame, phase = 0.3): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < frames; k += 1) {
    stepMotion(m, { dt: DT, moved: f.moved, climbed: 0, turned: 0, airborne: false, biting: f.biting, feeding: f.feeding, bodyLength: 1, phase });
    poseJaws(j, m, phase, DT);
    out.push([j[0].angle, j[1].angle]);
  }
  return out;
}

/** The angle a jaw's bone has actually been turned from rest, radians. */
function turned(j: BoundJaw): number {
  return j.bone.quaternion.angleTo(j.spec.rest);
}

describe('the jaws', () => {
  it('DIFFER during a bite: two angles, one leading, and both open wide then snap shut', () => {
    const j = jaws();
    const m = newMotion();
    const frames = run(j, m, 90, { moved: 0, biting: true });
    let differ = 0;
    let widest = 0;
    for (const [a, b] of frames) {
      if (Math.abs(a - b) > 0.02) differ += 1;
      widest = Math.max(widest, a, b);
    }
    expect(differ, 'frames on which the two jaws differ').toBeGreaterThan(5);
    expect(widest).toBeGreaterThan(JAW_OPEN * 0.6);
    // A snap: somewhere an angle falls by more than it ever rises in one frame.
    let fastestClose = 0;
    let fastestOpen = 0;
    for (let k = 1; k < frames.length; k += 1) {
      fastestClose = Math.max(fastestClose, frames[k - 1][0] - frames[k][0]);
      fastestOpen = Math.max(fastestOpen, frames[k][0] - frames[k - 1][0]);
    }
    expect(fastestClose).toBeGreaterThan(fastestOpen);
    // The bones carry the angles, turned by them from rest.
    expect(turned(j[0])).toBeCloseTo(j[0].angle, 6);
    expect(turned(j[1])).toBeCloseTo(j[1].angle, 6);
  });

  it('are BOTH AT REST while walking, and never open past the limit whatever is asked', () => {
    const j = jaws();
    const m = newMotion();
    // A bite first, then walk away from it: the levers fall and the jaws close.
    run(j, m, 30, { moved: 0, biting: true });
    const walking = run(j, m, 120, { moved: 0.05 });
    const last = walking[walking.length - 1];
    expect(last[0]).toBeLessThan(1e-3);
    expect(last[1]).toBeLessThan(1e-3);
    // Walking with nothing asked: the feed strokes and the twitch are gated off too.
    const still = run(j, m, 120, { moved: 0.05, feeding: true });
    for (const [a, b] of still.slice(60)) { expect(a).toBeLessThan(0.02); expect(b).toBeLessThan(0.02); }
    // The limit, under every ask at once, for a long time.
    const all = run(j, m, 600, { moved: 0, biting: true, feeding: true });
    for (const [a, b] of all) {
      expect(a).toBeLessThanOrEqual(JAW_OPEN + 1e-9);
      expect(b).toBeLessThanOrEqual(JAW_OPEN + 1e-9);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
    }
  });

  it('work ALTERNATELY when feeding, in small strokes, and twitch independently at rest', () => {
    const j = jaws();
    const m = newMotion();
    const feeding = run(j, m, 180, { moved: 0, feeding: true });
    let both = 0;
    let maxA = 0;
    let maxB = 0;
    for (const [a, b] of feeding.slice(30)) {
      if (a > JAW_FEED * 0.5 && b > JAW_FEED * 0.5) both += 1;
      maxA = Math.max(maxA, a);
      maxB = Math.max(maxB, b);
    }
    expect(both, 'frames on which both jaws are mid-stroke').toBe(0);
    expect(maxA).toBeGreaterThan(JAW_FEED * 0.7);
    expect(maxB).toBeGreaterThan(JAW_FEED * 0.7);
    expect(maxA).toBeLessThan(JAW_FEED * 1.2);
    // At rest: each jaw moves a little, on its own, and they are not a mirror of each other.
    const rest = run(j, m, 300, { moved: 0 });
    const a = rest.slice(120).map((f) => f[0]);
    const b = rest.slice(120).map((f) => f[1]);
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(JAW_TWITCH * 0.3);
    expect(Math.max(...b) - Math.min(...b)).toBeGreaterThan(JAW_TWITCH * 0.3);
    expect(Math.max(...a, ...b)).toBeLessThanOrEqual(JAW_TWITCH + 1e-9);
    let same = 0;
    for (let k = 0; k < a.length; k += 1) if (Math.abs(a[k] - b[k]) < 1e-4) same += 1;
    expect(same).toBeLessThan(a.length / 4);
  });

  it('rolls no die: the same phase and bite count pose the same bite twice', () => {
    const first = run(jaws(), newMotion(), 60, { moved: 0, biting: true }, 0.71);
    const second = run(jaws(), newMotion(), 60, { moved: 0, biting: true }, 0.71);
    expect(first).toEqual(second);
    // And a different phase is a different bite.
    const other = run(jaws(), newMotion(), 60, { moved: 0, biting: true }, 0.13);
    expect(other).not.toEqual(first);
  });

  it('resets with the motion when a rig is lent again', () => {
    const j = jaws();
    const m = newMotion();
    run(j, m, 30, { moved: 0, biting: true });
    expect(m.bites).toBe(1);
    expect(m.biteS).toBeGreaterThan(0);
    resetMotion(m, false);
    expect(m.bites).toBe(0);
    expect(m.biteS).toBe(-1);
    expect(m.bite).toBe(0);
    expect(m.feed).toBe(0);
  });
});

/** A wing hinge with its rest yaw baked in, the body's up +Y and forward +Z in the parent frame. */
function wing(side: number, restYawDeg: number, rank: number): BoundWing {
  const bone = new THREE.Bone();
  const restYaw = (side * restYawDeg * Math.PI) / 180;
  return {
    bone,
    spec: {
      bone: `wing${side}${rank}`, tip: 'tip', rest: new THREE.Quaternion(), side, rank, restYaw,
      up: new THREE.Vector3(0, 1, 0), forward: new THREE.Vector3(0, 0, 1),
    },
  };
}

/** Where a wing pointing along its baked rest yaw ends up after the pose: the yaw from −Z, degrees, unsigned. */
function drawnYawDeg(w: BoundWing): number {
  const restDir = new THREE.Vector3(Math.sin(w.spec.restYaw), 0, -Math.cos(w.spec.restYaw));
  const dir = restDir.applyQuaternion(w.bone.quaternion);
  return Math.abs(Math.atan2(dir.x, -dir.z)) * (180 / Math.PI);
}

describe('the wings', () => {
  it('beat at the species\' rate: 96 for the queen (Gui 2010, a congener), 170 for the fly (Pinto 2022), a default for the rest', () => {
    expect(WINGBEAT_HZ.queen).toBe(96);
    expect(WINGBEAT_HZ.housefly).toBe(170);
    expect(wingbeatHzOf('queen')).toBe(96);
    expect(wingbeatHzOf('housefly')).toBe(170);
    expect(wingbeatHzOf('aphid')).toBeGreaterThan(0);
  });

  it('turn from EITHER rest to the yaw the air lever asks: a folded rest stays its fold, a spread rest folds to 8°, both spread to 75°', () => {
    // Baked folded (the fly, 8°; the synthetic rig, 13°): the fold IS the rest. Baked spread (the queen): the fold is 8°.
    expect(foldedYawOf(WING_FOLDED_YAW)).toBeCloseTo(WING_FOLDED_YAW, 9);
    expect(foldedYawOf((13 * Math.PI) / 180)).toBeCloseTo((13 * Math.PI) / 180, 9);
    expect(foldedYawOf(-(13 * Math.PI) / 180)).toBeCloseTo((13 * Math.PI) / 180, 9);
    const queenRest = (88 * Math.PI) / 180;
    expect(foldedYawOf(queenRest)).toBeCloseTo(WING_FOLDED_YAW, 9);
    expect(WING_FOLDED_MAX).toBeGreaterThan((13 * Math.PI) / 180);
    expect(WING_FOLDED_MAX).toBeLessThan((80 * Math.PI) / 180);
    expect(wingYawAt(queenRest, 0)).toBeCloseTo(WING_FOLDED_YAW, 9);
    expect(wingYawAt(queenRest, 1)).toBeCloseTo(WING_SPREAD_YAW, 9);
    expect(wingYawAt(WING_FOLDED_YAW, 1)).toBeCloseTo(WING_SPREAD_YAW, 9);
    // A fly's wing is turned by NOTHING on the ground — its bind pose is its landed pose — and out by 67° in the air;
    // a queen's is turned back by 80° on the ground and by 13° in the air — opposite signs, one rule.
    expect(Math.abs(wingTurn(WING_FOLDED_YAW, 1, 0))).toBe(0);
    expect(Math.abs(wingTurn((13 * Math.PI) / 180, -1, 0))).toBe(0);
    expect(Math.abs(wingTurn(WING_FOLDED_YAW, 1, 1))).toBeCloseTo(WING_SPREAD_YAW - WING_FOLDED_YAW, 9);
    expect(Math.abs(wingTurn(queenRest, 1, 0))).toBeCloseTo(queenRest - WING_FOLDED_YAW, 9);
    expect(Math.sign(wingTurn(queenRest, 1, 0))).toBe(-Math.sign(wingTurn(WING_FOLDED_YAW, 1, 1)));
    // Mirrored per side.
    expect(wingTurn(queenRest, -1, 0)).toBeCloseTo(-wingTurn(queenRest, 1, 0), 9);
    // On bones: the drawn yaw lands on the target from both rests, on both sides, and the flap lifts a spread wing.
    for (const [rest, label, folded] of [[8, 'fly', 8], [13, 'synthetic', 13], [88, 'queen', 8]] as const) {
      for (const side of [1, -1]) {
        const w = wing(side, rest, 0);
        const m = newMotion();
        m.air = 0;
        poseWings([w], m, 0, 96);
        expect(drawnYawDeg(w), `${label} ${side} folded`).toBeCloseTo(folded, 4);
        m.air = 1;
        m.alive = 0; // the beat at zero: the yaw alone
        poseWings([w], m, 0, 96);
        expect(drawnYawDeg(w), `${label} ${side} spread`).toBeCloseTo(75, 4);
        m.alive = 0.25 / 96; // a quarter beat: the stroke at its peak lifts the wing
        poseWings([w], m, 0, 96);
        const dir = new THREE.Vector3(Math.sin(w.spec.restYaw), 0, -Math.cos(w.spec.restYaw)).applyQuaternion(w.bone.quaternion);
        expect(dir.y, `${label} ${side} flapped up`).toBeGreaterThan(0.3);
      }
    }
  });

  it('open over about a third of a second on the air lever, the body\'s own signal for a takeoff', () => {
    const m = newMotion();
    let opened = -1;
    for (let k = 0; k < 60; k += 1) {
      stepMotion(m, { dt: DT, moved: 0, climbed: 0, turned: 0, airborne: true, bodyLength: 1, phase: 0 });
      if (opened < 0 && m.air >= 0.95) opened = (k + 1) * DT;
    }
    expect(opened).toBeGreaterThan(0.2);
    expect(opened).toBeLessThan(0.45);
    expect(Math.abs(opened - WING_OPEN_S)).toBeLessThan(0.05);
    // And they close again on the way down, told nothing.
    for (let k = 0; k < 60; k += 1) stepMotion(m, { dt: DT, moved: 0, climbed: 0, turned: 0, airborne: false, bodyLength: 1, phase: 0 });
    expect(m.air).toBeLessThan(0.01);
  });

  it('beat only while the air lever is up, and the hind pair lags the fore', () => {
    const fore = wing(1, 88, 0);
    const hind = wing(1, 85, 1);
    const m = newMotion();
    m.air = 0;
    for (let k = 0; k < 10; k += 1) {
      m.alive += DT;
      poseWings([fore, hind], m, 0.3, 96);
      // Folded and still: the same quaternion every frame, the hind fanned a few degrees wider than the fore.
      expect(drawnYawDeg(fore)).toBeCloseTo(8, 4);
      expect(drawnYawDeg(hind)).toBeCloseTo(8 + HIND_FOLD_FAN * (180 / Math.PI), 4);
    }
    // A rest already folded is not fanned: the file's pose stands.
    expect(foldedYawOf((13 * Math.PI) / 180, 1)).toBeCloseTo((13 * Math.PI) / 180, 9);
    const still = fore.bone.quaternion.clone();
    m.alive += DT;
    poseWings([fore, hind], m, 0.3, 96);
    expect(fore.bone.quaternion.equals(still)).toBe(true);
    // In the air: a stroke, and the hind's stroke is the fore's a lag later and larger.
    m.air = 1;
    const foreRoll: number[] = [];
    const hindRoll: number[] = [];
    const steps = 200;
    for (let k = 0; k < steps; k += 1) {
      m.alive = k / (96 * steps);
      poseWings([fore, hind], m, 0, 96);
      const f = new THREE.Vector3(1, 0, 0).applyQuaternion(fore.bone.quaternion);
      const h = new THREE.Vector3(1, 0, 0).applyQuaternion(hind.bone.quaternion);
      foreRoll.push(Math.asin(Math.max(-1, Math.min(1, f.y))));
      hindRoll.push(Math.asin(Math.max(-1, Math.min(1, h.y))));
    }
    const peakFore = foreRoll.indexOf(Math.max(...foreRoll));
    const peakHind = hindRoll.indexOf(Math.max(...hindRoll));
    expect(Math.max(...foreRoll)).toBeGreaterThan(WING_FLAP * 0.9);
    expect(Math.max(...hindRoll)).toBeGreaterThan(Math.max(...foreRoll));
    expect(((peakHind - peakFore + steps) % steps) / steps).toBeCloseTo(HIND_LAG, 1);
  });
});

/** The synthetic legged rig, its legs bound the way the view binds them, at the identity. */
function legged(): { root: THREE.Object3D; legs: BoundLeg[] } {
  const root = leggedRig(3.9, false);
  const bones = bonesOf(root);
  const specs = findLegs(root, bones);
  const legs: BoundLeg[] = specs.map((spec) => ({
    bone: root.getObjectByName(spec.coxa) as THREE.Bone,
    spec,
    femur: spec.femur === null ? null : (root.getObjectByName(spec.femur) as THREE.Bone),
  }));
  return { root, legs };
}

function footAt(root: THREE.Object3D, name: string): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(root.getObjectByName(name)!.matrixWorld);
}

describe('the tripod on a rig', () => {
  it('moves a mirrored pair\'s feet in OPPOSITE directions and a tripod\'s three together; a swinging foot lifts', () => {
    const { root, legs } = legged();
    const rest = new Map(legs.map((l) => [l.spec.tip, footAt(root, l.spec.tip)]));
    const m = newMotion();
    m.moving = 1;
    const body = 3.9;
    // The forward station of each foot (z relative to its rest) over one
    // stride, sampled. The legs read the STRIDE COUNT the view keeps
    // (`RigMotion.strides`), not the raw distance.
    const stations = new Map<string, number[]>();
    const heights = new Map<string, number[]>();
    const steps = 40;
    for (let k = 0; k < steps; k += 1) {
      m.strides = k / steps;
      poseLegs(legs, m, body, 0);
      for (const l of legs) {
        const p = footAt(root, l.spec.tip);
        const r = rest.get(l.spec.tip)!;
        stations.set(l.spec.tip, [...(stations.get(l.spec.tip) ?? []), p.z - r.z]);
        heights.set(l.spec.tip, [...(heights.get(l.spec.tip) ?? []), p.y - r.y]);
      }
    }
    const dot = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + v * b[i], 0);
    const norm = (a: number[]): number => Math.sqrt(dot(a, a));
    const corr = (a: number[], b: number[]): number => dot(a, b) / (norm(a) * norm(b));
    for (let rank = 0; rank < 3; rank += 1) {
      const pair = legs.filter((l) => l.spec.rank === rank);
      expect(pair).toHaveLength(2);
      const a = stations.get(pair[0].spec.tip)!;
      const b = stations.get(pair[1].spec.tip)!;
      expect(norm(a)).toBeGreaterThan(0.05);
      expect(corr(a, b), `rank ${rank} pair moves opposite`).toBeLessThan(-0.9);
    }
    for (const half of [0, 1]) {
      const tripod = legs.filter((l) => l.spec.phase === half);
      expect(tripod).toHaveLength(3);
      for (let i = 1; i < 3; i += 1) {
        expect(corr(stations.get(tripod[0].spec.tip)!, stations.get(tripod[i].spec.tip)!), `tripod ${half} moves together`).toBeGreaterThan(0.9);
      }
    }
    // Every foot lifts off the ground at some point in the stride and never goes under it.
    for (const l of legs) {
      const h = heights.get(l.spec.tip)!;
      expect(Math.max(...h), `${l.spec.tip} lifts`).toBeGreaterThan(0.02);
      expect(Math.min(...h), `${l.spec.tip} never digs`).toBeGreaterThan(-0.01);
      expect(l.femur).not.toBeNull();
    }
    expect(LEG_LIFT).toBeGreaterThan(0);
    // Standing: the stride contributes nothing; the feet are within the stir of their rest.
    m.moving = 0;
    m.strides = 0.123;
    poseLegs(legs, m, body, 0);
    for (const l of legs) {
      expect(footAt(root, l.spec.tip).distanceTo(rest.get(l.spec.tip)!)).toBeLessThan(0.05);
    }
  });
});

describe('the head and the gaster', () => {
  it('are found on the synthetic rig and posed within small angles: the head yaws into a turn, the gaster curls on a bite', () => {
    const root = leggedRig(3.9, false);
    const bones = bonesOf(root);
    const legs = findLegs(root, bones);
    const { head, gaster } = findTrunk(root, bones, legs);
    expect(head).not.toBeNull();
    expect(gaster).not.toBeNull();
    expect(measureRig(root, null).head?.bone).toBe(head!.bone);
    const h: BoundJoint = { bone: root.getObjectByName(head!.bone) as THREE.Bone, spec: head! };
    const g: BoundJoint = { bone: root.getObjectByName(gaster!.bone) as THREE.Bone, spec: gaster! };
    const m = newMotion();
    // A left turn (heading growing) yaws the head the same way: about +Y, positive.
    for (let k = 0; k < 30; k += 1) stepMotion(m, { dt: DT, moved: 0.05, climbed: 0, turned: 0.1, airborne: false, bodyLength: 3.9, phase: 0 });
    poseHead(h, m, 0);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(h.bone.quaternion);
    expect(forward.x).toBeGreaterThan(0.05);
    expect(h.bone.quaternion.angleTo(h.spec.rest)).toBeLessThan(0.5);
    // A bite curls the gaster's tip DOWN.
    for (let k = 0; k < 30; k += 1) stepMotion(m, { dt: DT, moved: 0, climbed: 0, turned: 0, airborne: false, biting: true, bodyLength: 3.9, phase: 0 });
    poseGaster(g, m, 3.9, 0);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(g.bone.quaternion);
    expect(back.y).toBeLessThan(-0.1);
    expect(g.bone.quaternion.angleTo(g.spec.rest)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// The root's frame
// ---------------------------------------------------------------------------

const HEADINGS = [0, 0.3, -1.1, Math.PI / 2, -Math.PI / 2, 2.9, Math.PI, -2.2, 3.1];
const PITCHES = [0, 0.25, -0.4, 0.6];
const BANKS = [0, 0.3, -0.7];

function v(): MutableVec3 {
  return { x: 0, y: 0, z: 0 };
}

/** Two quaternions the same rotation: the same components once the sign is aligned. */
function sameRotation(a: THREE.Quaternion, b: THREE.Quaternion, digits: number): void {
  const sign = a.dot(b) < 0 ? -1 : 1;
  expect(a.x).toBeCloseTo(sign * b.x, digits);
  expect(a.y).toBeCloseTo(sign * b.y, digits);
  expect(a.z).toBeCloseTo(sign * b.z, digits);
  expect(a.w).toBeCloseTo(sign * b.w, digits);
}

describe('the root\'s frame', () => {
  it('ON THE GROUND is the old Euler(−pitch, heading, bank, YXZ) to 1e-12, for every heading, pitch and bank', () => {
    const q = new THREE.Quaternion();
    const old = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    for (const h of HEADINGS) for (const p of PITCHES) for (const b of BANKS) {
      const ahead = drawnAhead(WORLD_UP, h, WORLD_UP, v());
      rootQuaternion(WORLD_UP, ahead, p, b, q);
      old.setFromEuler(euler.set(-p, h, b, 'YXZ'));
      sameRotation(q, old, 12);
    }
    // And the ahead on the ground is the actor convention TO THE BIT: nothing was carried.
    for (const h of HEADINGS) {
      const a = drawnAhead(WORLD_UP, h, WORLD_UP, v());
      expect(a.x).toBe(Math.sin(h));
      expect(a.y).toBe(0);
      expect(a.z).toBe(Math.cos(h));
      // The same numbers in a different object are the same up.
      const b = drawnAhead(WORLD_UP, h, vec3(0, 1, 0), v());
      expect(b.x).toBe(a.x);
      expect(b.z).toBe(a.z);
    }
  });

  it('ON A WALL maps local +Y to the wall\'s normal and local +Z to the heading carried onto it, +X to the left', () => {
    const q = new THREE.Quaternion();
    for (const up of FACE_NORMALS) {
      for (const h of HEADINGS) {
        const ahead = aheadOn(up, h, v());
        rootQuaternion(up, ahead, 0, 0, q);
        const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        expect(y.x).toBeCloseTo(up.x, 12); expect(y.y).toBeCloseTo(up.y, 12); expect(y.z).toBeCloseTo(up.z, 12);
        expect(z.x).toBeCloseTo(ahead.x, 12); expect(z.y).toBeCloseTo(ahead.y, 12); expect(z.z).toBeCloseTo(ahead.z, 12);
        // Left is up × ahead: on the ground, (cos h, 0, −sin h) — the mirror of `rightOn`.
        const left = new THREE.Vector3(up.x, up.y, up.z).cross(new THREE.Vector3(ahead.x, ahead.y, ahead.z));
        expect(x.distanceTo(left)).toBeLessThan(1e-12);
        // A right-handed, unit frame: a rotation and never a reflection.
        expect(x.clone().cross(y).distanceTo(z)).toBeLessThan(1e-12);
      }
    }
    // The east wall, heading 0: the body's ahead is the ground's +z carried onto +x's face — straight up the wall.
    const east = FACE_NORMALS[0];
    const ahead = aheadOn(east, 0, v());
    expect(ahead.x).toBeCloseTo(0, 12);
    expect(ahead.z).toBeCloseTo(1, 12);
  });

  it('applies the attitude as LOCAL turns: nose up tilts the ahead toward the body\'s up on the wall as on the ground', () => {
    const q = new THREE.Quaternion();
    for (const up of [WORLD_UP, FACE_NORMALS[0], FACE_NORMALS[3], FACE_NORMALS[5]]) {
      for (const h of HEADINGS) {
        const ahead = aheadOn(up, h, v());
        for (const p of PITCHES) {
          rootQuaternion(up, ahead, p, 0, q);
          const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
          // Nose up positive: the ahead climbs toward the up by sin p, and keeps cos p along the heading.
          expect(nose.x * up.x + nose.y * up.y + nose.z * up.z).toBeCloseTo(Math.sin(p), 12);
          expect(nose.x * ahead.x + nose.y * ahead.y + nose.z * ahead.z).toBeCloseTo(Math.cos(p), 12);
        }
        // A bank rolls about the body's ahead: the ahead does not move, the up does.
        rootQuaternion(up, ahead, 0, 0.5, q);
        const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        expect(nose.x).toBeCloseTo(ahead.x, 12); expect(nose.y).toBeCloseTo(ahead.y, 12); expect(nose.z).toBeCloseTo(ahead.z, 12);
        const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        expect(y.x * up.x + y.y * up.y + y.z * up.z).toBeCloseTo(Math.cos(0.5), 12);
      }
    }
    // A number that is not a number leaves the quaternion as it was.
    q.identity();
    rootQuaternion(WORLD_UP, vec3(Number.NaN, 0, 1), 0, 0, q);
    expect(q.equals(new THREE.Quaternion())).toBe(true);
  });

  it('CARRIES THE HEADING into a drawn up that lags the state\'s: the ahead is aheadOn(up, h) turned by rotateBetween(up, drawn)', () => {
    // The body has just walked off the east wall onto the top: the state's
    // up is +y, the drawn up is still half-way round the edge.
    const drawn = new THREE.Vector3(1, 1, 0).normalize();
    for (const h of HEADINGS) {
      const expected = rotateBetween(WORLD_UP, drawn, aheadOn(WORLD_UP, h, v()), v());
      const got = drawnAhead(WORLD_UP, h, drawn, v());
      expect(got.x).toBeCloseTo(expected.x, 12);
      expect(got.y).toBeCloseTo(expected.y, 12);
      expect(got.z).toBeCloseTo(expected.z, 12);
      // Still a unit tangent of the DRAWN up: the basis the root is built on is orthonormal.
      expect(Math.hypot(got.x, got.y, got.z)).toBeCloseTo(1, 12);
      expect(got.x * drawn.x + got.y * drawn.y + got.z * drawn.z).toBeCloseTo(0, 12);
    }
  });

  it('EASES THE UP onto a new up within a second and then settles on it exactly; on the ground it is WORLD_UP to the bit', () => {
    const DT = 1 / 60;
    const drawn = new THREE.Vector3(0, 1, 0);
    // The ground: a thousand frames, and it is the same object's numbers unchanged.
    for (let k = 0; k < 1000; k += 1) easeUp(drawn, WORLD_UP, DT);
    expect(drawn.x).toBe(0); expect(drawn.y).toBe(1); expect(drawn.z).toBe(0);
    // An edge: a quarter turn to the east wall. Not a snap — after one
    // frame it has barely moved — and a monotone turn that is within a
    // degree in a second and exactly the target soon after.
    const east = FACE_NORMALS[0];
    easeUp(drawn, east, DT);
    // A tenth of the way at most in a sixtieth of a second: about 9° of the 90.
    expect(drawn.y).toBeGreaterThan(0.98);
    expect(drawn.x).toBeGreaterThan(0.05);
    let lastGap = drawn.distanceTo(new THREE.Vector3(1, 0, 0));
    let settledAt = -1;
    for (let k = 1; k < 120; k += 1) {
      easeUp(drawn, east, DT);
      const gap = drawn.distanceTo(new THREE.Vector3(1, 0, 0));
      expect(gap).toBeLessThanOrEqual(lastGap + 1e-12);
      expect(drawn.length()).toBeCloseTo(1, 12);
      lastGap = gap;
      if (settledAt < 0 && drawn.x === 1 && drawn.y === 0 && drawn.z === 0) settledAt = (k + 1) * DT;
    }
    expect(lastGap).toBeLessThan(Math.PI / 180);
    expect(settledAt).toBeGreaterThan(0.5);
    expect(settledAt).toBeLessThan(1.2);
    // The time constant is what it says: after one UP_EASE_S the gap is about 1/e of a quarter turn's chord.
    const fresh = new THREE.Vector3(0, 1, 0);
    let t = 0;
    while (t < UP_EASE_S - 1e-9) { easeUp(fresh, east, DT); t += DT; }
    const angle = Math.acos(Math.min(1, fresh.dot(new THREE.Vector3(1, 0, 0))));
    expect(angle).toBeCloseTo((Math.PI / 2) * Math.exp(-1), 1);
    expect(UP_SETTLED).toBeLessThan(0.01);
  });

  it('turns a HALF TURN — a takeoff from the ceiling — as a turn about the surface frame\'s axis, never a snap or a zero', () => {
    const DT = 1 / 60;
    const drawn = new THREE.Vector3(0, -1, 0);
    const ys: number[] = [];
    for (let k = 0; k < 180; k += 1) {
      easeUp(drawn, WORLD_UP, DT);
      expect(drawn.length()).toBeCloseTo(1, 12);
      // The ceiling's up turns to the ground's about +x (the fixed choice `rotateBetween` makes for −y): it swings through −z... +z, never x.
      expect(Math.abs(drawn.x)).toBeLessThan(1e-9);
      ys.push(drawn.y);
    }
    // Monotone from −1 to +1, no frame jumping more than a few degrees, and exactly up at the end.
    for (let k = 1; k < ys.length; k += 1) {
      expect(ys[k]).toBeGreaterThanOrEqual(ys[k - 1] - 1e-12);
      expect(ys[k] - ys[k - 1]).toBeLessThan(0.2);
    }
    expect(ys[0]).toBeLessThan(-0.9);
    expect(drawn.y).toBe(1);
    // A target that is not a number moves nothing.
    const still = new THREE.Vector3(0, 0, 1);
    easeUp(still, vec3(Number.NaN, 0, 0), DT);
    expect(still.z).toBe(1);
    easeUp(still, WORLD_UP, Number.NaN);
    expect(still.z).toBe(1);
  });
});
