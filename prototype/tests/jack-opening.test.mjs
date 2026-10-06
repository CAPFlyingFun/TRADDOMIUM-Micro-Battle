import test from 'node:test';import assert from 'node:assert/strict';
import {jackOpening,rearWorkstation} from '../app/game/three/jack-opening.ts';
import {newRigFixture} from './helpers/new-rig-fixture.mjs';
import {createBodyMotion} from '../app/game/three/body-motion.ts';
test('Jack stays asleep through the warning, then rolls near the rear desk without hitting it',()=>{
 for(const source of [2,3,4,5])assert.equal(jackOpening(source,4).sleep,1);
 assert.equal(jackOpening(6,0).sleep,1);assert.equal(jackOpening(6,1).sleep,0);
 const backEdge=.51+jackOpening(6,1).roll+.38;
 assert.ok(backEdge<rearWorkstation.z-rearWorkstation.depth/2);
 assert.ok(rearWorkstation.z-rearWorkstation.depth/2-backEdge<.2);
 assert.equal(jackOpening(6,5).roll,0);assert.equal(jackOpening(7,0).roll,0);
 assert.deepEqual(jackOpening(6,0),jackOpening(6,0));
 assert.equal(jackOpening(6,.2,true).jolt,0);
});
test('sleep folds arms and tilts the head without cumulative bone drift',async()=>{
 const {root}=await newRigFixture('jack'),motion=createBodyMotion(root);
 motion.pose(0,'seated',false,false,true);const head=root.getObjectByName('Bone_017').quaternion.clone();
 motion.pose(0,'seated',false,false,true,0,1,{sleep:1});const asleep=root.getObjectByName('Bone_017').quaternion.clone();assert.ok(Math.abs(asleep.dot(head))<.995);
 for(let i=0;i<30;i++)motion.pose(0,'seated',false,false,true,0,1,{sleep:1});asleep.toArray().forEach((value,i)=>assert.ok(Math.abs(value-root.getObjectByName('Bone_017').quaternion.toArray()[i])<1e-9));
});
