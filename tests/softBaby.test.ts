import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BABY_SOFT, createSoftBaby, restorePose, stepSoftBaby } from '../src/sarahlab/softBaby';

// a two-bone arm hanging from a root: shoulder -> elbow -> hand, pointing along +x
function arm() {
  const root = new THREE.Bone(), sh = new THREE.Bone(), el = new THREE.Bone(), hand = new THREE.Bone();
  root.name = 'root'; sh.name = 'sh'; el.name = 'el'; hand.name = 'hand';
  root.add(sh); sh.add(el); el.add(hand); el.position.set(1, 0, 0); hand.position.set(1, 0, 0);
  root.updateMatrixWorld(true);
  const bones = new Map([['sh', sh], ['el', el], ['hand', hand]]);
  return { root, sh, el, hand, s: createSoftBaby(bones, [['sh', 'el', 'hand']]) };
}
const dirOf = (a: THREE.Object3D, b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize();
const down = new THREE.Vector3(0, -1, 0);

describe('her baby soft body (a hybrid: springs, and an automatic move drives it outright)', () => {
  it('a move driving it holds its pose exactly', () => {
    const { root, sh, el, s } = arm();
    for (let k = 0; k < 30; k++) { restorePose(s); root.rotation.z += 0.05; root.updateMatrixWorld(true); stepSoftBaby(s, 1 / 60, { drive: 1, fluid: 0, down }); }
    const want = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    expect(dirOf(sh, el).angleTo(want)).toBeLessThan(1e-3);
  });
  it('left to its springs, it lags a turn and then settles onto its pose (in fluid, no weight)', () => {
    const { root, sh, el, s } = arm();
    stepSoftBaby(s, 1 / 60, { drive: 0, fluid: 1, down });
    let most = 0;
    for (let k = 0; k < 20; k++) { restorePose(s); root.rotation.z += 0.05; root.updateMatrixWorld(true); stepSoftBaby(s, 1 / 60, { drive: 0, fluid: 1, down }); most = Math.max(most, dirOf(sh, el).angleTo(new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion))); }
    expect(most).toBeGreaterThan(0.05);
    expect(most).toBeLessThanOrEqual((BABY_SOFT.mostDeg * Math.PI) / 180 + 1e-3);
    for (let k = 0; k < 600; k++) { restorePose(s); stepSoftBaby(s, 1 / 60, { drive: 0, fluid: 1, down }); }
    expect(dirOf(sh, el).angleTo(new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion))).toBeLessThan(0.02);
  });
  it('in air its weight bends a limb lying across the floor down', () => {
    const { sh, el, s } = arm();
    for (let k = 0; k < 600; k++) { restorePose(s); stepSoftBaby(s, 1 / 60, { drive: 0, fluid: 0, down }); }
    expect(dirOf(sh, el).y).toBeLessThan(-0.15);
  });
  it('something it lies on keeps it out', () => {
    const { sh, el, s } = arm();
    // a floor at y = -0.1: a joint never below it
    const push = (from: THREE.Vector3, dir: THREE.Vector3, length: number) => { const tip = from.clone().addScaledVector(dir, length); if (tip.y >= -0.1) return false; tip.y = -0.1; dir.copy(tip.sub(from)).normalize(); return true; };
    for (let k = 0; k < 600; k++) { restorePose(s); stepSoftBaby(s, 1 / 60, { drive: 0, fluid: 0, down, push }); }
    expect(el.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThanOrEqual(-0.1 - 1e-3);
    void sh;
  });
});
