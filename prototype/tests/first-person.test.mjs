import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import * as cameras from '../app/game/three/lab-camera.ts';
import {newRigFixture} from './helpers/new-rig-fixture.mjs';
import {createBodyMotion} from '../app/game/three/body-motion.ts';
import {chapterOneShot} from '../app/game/three/lab-direction.ts';
test('wake switches to first person while arrival retains its cinematic shot',()=>{
 assert.equal(chapterOneShot(6).view,'firstperson');assert.equal(chapterOneShot(54).view,'room');
});
test('both actual rigs have an eye mount outside the head and retain visible body geometry',async()=>{
 assert.equal(typeof cameras.measureEyeMount,'function');
 for(const person of ['jack','sarah']){
  const {root}=await newRigFixture(person),mount=cameras.measureEyeMount(root),motion=createBodyMotion(root);
  assert.ok(mount.height>1.4&&mount.height<2.1);assert.ok(mount.radius>.06&&mount.radius<.4);
  for(const seat of [0,1])for(const yaw of [0,Math.PI/2,Math.PI]){
   root.position.set(2,-.35*seat,1);root.rotation.y=yaw;motion.pose(0,seat?'seated':'idle',false,false,true);
   const shot=cameras.firstPersonShot(root,mount,yaw,-.5);
   const head=root.getObjectByName('Bone_017').getWorldPosition(new T.Vector3());
   assert.ok(Math.hypot(shot.position.x-head.x,shot.position.z-head.z)>mount.radius+.04);
   assert.ok(shot.target.y<shot.position.y,'looking down must remain possible');
   assert.ok(Math.abs(shot.position.y-(head.y+mount.eyeAboveHead))<1e-8);
   root.traverse(o=>assert.equal(o.visible,true,'do not hide the head or body'));
  }
 }
});
