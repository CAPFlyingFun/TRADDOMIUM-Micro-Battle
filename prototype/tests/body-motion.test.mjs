import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createBodyMotion} from '../app/game/three/body-motion.ts';
import {newRigFixture} from './helpers/new-rig-fixture.mjs';
async function rigFixture(who){const {root}=await newRigFixture(who),nodes=[];root.traverse(o=>nodes.push(o));return {root,nodes};}
const position=(root,name)=>root.getObjectByName(name).getWorldPosition(new T.Vector3());
test('Jack seated pose reaches the keyboard and keeps feet near floor',async()=>{
 const {root}=await rigFixture('jack'),motion=createBodyMotion(root);root.position.y=-.35;motion.pose(1,'seated',true,true,false);
 for(const name of ['Bone_020','Bone_025']){const p=position(root,name);assert.ok(p.y>.72&&p.y<.92);assert.ok(Math.abs(p.x)<.35);assert.ok(p.z>.2&&p.z<.4);}
 for(const name of ['Bone_007','Bone_012'])assert.ok(Math.abs(position(root,name).y)<.06);
});
test('Sarah walk moves feet and poses never accumulate rotation',async()=>{
 const {root,nodes}=await rigFixture('sarah'),motion=createBodyMotion(root);
 motion.pose(.3,'walk',false,false,false);const start=position(root,'Bone_007');const rotations=nodes.map(o=>o.quaternion.toArray());
 motion.pose(.3+Math.PI/5.2,'walk',false,false,false);const end=position(root,'Bone_007');assert.ok(start.distanceTo(end)>.12);
 for(let i=0;i<120;i++)motion.pose(i*.05,'walk',true,false,false);
 motion.pose(.3,'walk',false,false,false);nodes.forEach((o,i)=>o.quaternion.toArray().forEach((n,k)=>{assert.ok(Number.isFinite(n));assert.ok(Math.abs(n-rotations[i][k])<1e-10);}));
});
test('reduced motion removes idle and conversational oscillation',async()=>{
 const {root,nodes}=await rigFixture('sarah'),motion=createBodyMotion(root);motion.pose(1,'idle',true,false,true);const before=nodes.map(o=>o.quaternion.toArray());motion.pose(4,'idle',true,false,true);nodes.forEach((o,i)=>assert.deepEqual(o.quaternion.toArray(),before[i]));
});
test('seated Sarah keeps feet near floor and gaze changes without accumulating',async()=>{
 const {root}=await rigFixture('sarah'),motion=createBodyMotion(root);root.position.y=-.35;
 motion.pose(1,'seated',false,true,true,0);const head=root.getObjectByName('Bone_017'),neutral=head.quaternion.clone();
 motion.pose(1,'seated',false,true,true,.8);const turned=head.quaternion.clone();assert.ok(Math.abs(neutral.dot(turned))<.99);
 for(let i=0;i<30;i++)motion.pose(1,'seated',false,true,true,.8);
 assert.ok(Math.abs(head.quaternion.dot(turned)-1)<1e-6);
 motion.pose(1,'seated',false,true,true,0);assert.ok(Math.abs(head.quaternion.dot(neutral)-1)<1e-6);
 for(const name of ['Bone_007','Bone_012'])assert.ok(Math.abs(position(root,name).y)<.07);
});
