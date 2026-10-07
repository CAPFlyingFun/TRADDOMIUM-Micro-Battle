// Sarah's bump keeps its shape seated, and it is the MODEL that keeps it.
//
// Joshua, 2026-10-07 (PR #10): fix the deformation in the character, not with her arms,
// the camera or a load-time patch. The scan-era `prepareSeatedSarah` blended her skirt's
// weights down the legs; on toon Sarah the same idea drags the bump with the thighs, so
// it is gone, and these tests keep it gone and check the shipped sarah.glb directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createBodyMotion} from '../app/game/three/body-motion.ts';
import {newRigFixture} from './helpers/new-rig-fixture.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('no load-time seating correction is applied to Sarah', () => {
  assert.equal(fs.existsSync(new URL('../app/game/three/seated-skin.ts', import.meta.url)), false);
  for (const p of ['app/game/three/lab-renderer.ts', 'scripts/verify-rigs.mjs']) {
    assert.doesNotMatch(read(p), /prepareSeatedSarah|seated-skin/, p);
  }
});

test('Sarah gets the pregnant seated posture and never types or sleeps on her own', () => {
  const src = read('app/game/three/lab-renderer.ts');
  assert.match(src, /sarahMotion=createBodyMotion\(sarah,\{pregnant:true\}\)/);
  const call = src.match(/sarahMotion\?\.pose\(([^;]*)\);/)[1].split(',');
  assert.equal(call[3].trim(), 'false', 'typing is never passed for Sarah');
  assert.equal(call.length, 7, 'no opening (sleep/jolt) is passed for Sarah');
});

async function bump() {
  const {root} = await newRigFixture('sarah');
  let mesh; root.traverse((o) => { if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
  const bone = (n) => root.getObjectByName(n);
  root.updateMatrixWorld(true); mesh.skeleton.update();
  const at = (n) => bone(n).getWorldPosition(new T.Vector3());
  const hipY = (at('Bone_010').y + at('Bone_015').y) / 2, hipZ = (at('Bone_010').z + at('Bone_015').z) / 2, chestY = at('Bone_003').y;
  const P = mesh.geometry.attributes.position, rows = [];
  for (let i = 0; i < P.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(P, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld);
    const band = (v.y - hipY) / (chestY - hipY);
    if (band < .2 || band > .6 || v.z - hipZ < .08 || Math.abs(v.x) > .18) continue;
    rows.push({i, rest: v});
  }
  return {root, mesh, rows};
}

test('the bump is not skinned to the legs', async () => {
  const {mesh, rows} = await bump();
  const legs = new Set(['Bone_010', 'Bone_009', 'Bone_015', 'Bone_014'].map((n) => mesh.skeleton.bones.findIndex((b) => b.name === n)));
  const J = mesh.geometry.attributes.skinIndex, W = mesh.geometry.attributes.skinWeight;
  let leg = 0, all = 0;
  for (const {i} of rows) for (let k = 0; k < 4; k++) { all += W.getComponent(i, k); if (legs.has(J.getComponent(i, k))) leg += W.getComponent(i, k); }
  assert.ok(rows.length > 500, `${rows.length} bump vertices`);
  assert.ok(leg / all < .02, `leg weight on the bump ${(leg / all * 100).toFixed(1)}%`);
});

test('seated, the bump moves with her pelvis and not with her thighs', async () => {
  const {root, mesh, rows} = await bump();
  const motion = createBodyMotion(root, {pregnant: true});
  motion.pose(1, 'seated', false, false, true, 0, 1);
  root.updateMatrixWorld(true); mesh.skeleton.update();
  const pelvis = mesh.skeleton.bones.findIndex((b) => b.name === 'Bone_001');
  const viaPelvis = new T.Matrix4().multiplyMatrices(mesh.skeleton.bones[pelvis].matrixWorld, mesh.skeleton.boneInverses[pelvis]);
  let sum = 0, worst = 0;
  for (const {i} of rows) {
    const bindV = new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.bindMatrix);
    const ref = bindV.clone().applyMatrix4(viaPelvis).applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
    const v = new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld);
    const d = v.distanceTo(ref); sum += d; worst = Math.max(worst, d);
  }
  assert.ok(sum / rows.length < .015, `mean ${(sum / rows.length * 100).toFixed(1)} cm`);
  assert.ok(worst < .05, `worst ${(worst * 100).toFixed(1)} cm`);
});
