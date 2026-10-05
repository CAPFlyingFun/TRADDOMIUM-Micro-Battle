import test from 'node:test';
import assert from 'node:assert/strict';
import {findLabPath,walkable,moveOnFloor} from '../app/game/three/lab-navigation.ts';
import {createLabPlayer} from '../app/game/three/lab-player.ts';
const poses={jack:{x:-.9,z:.45,yaw:Math.PI,seat:1,visible:true},sarah:{x:-1.8,z:.45,yaw:Math.PI,seat:1,visible:true}};
test('routes around the desk and never cuts a blocked corner',()=>{
 const start={x:-.9,z:.45},end={x:.7,z:-1.5},route=findLabPath(start,end);
 assert.ok(route.length>2);
 let previous=start;
 for(const next of route){for(let i=0;i<=20;i++)assert.ok(walkable({x:previous.x+(next.x-previous.x)*i/20,z:previous.z+(next.z-previous.z)*i/20}));previous=next;}
 assert.ok(Math.hypot(previous.x-end.x,previous.z-end.z)<.25);
 assert.equal(findLabPath(start,{x:-.9,z:-.35}).length,0);
});
test('direct movement cannot cross furniture or leave the laboratory',()=>{
 assert.deepEqual(moveOnFloor({x:-.9,z:.45},{x:0,z:-1},1),{x:-.9,z:.45});
 assert.ok(walkable(moveOnFloor({x:3.7,z:2},{x:1,z:0},100)));
});
test('character switch and pause preserve positions; dialogue waits for return to seats',()=>{
 const player=createLabPlayer();player.setExploring(true,poses);
 assert.equal(player.select('sarah'),true);player.goTo({x:1,z:2});
 for(let i=0;i<70;i++)player.tick(.05,false);
 const explored=player.snapshot().sarah;
 assert.ok(Math.hypot(explored.x+1.8,explored.z-.45)>1);
 const before=player.snapshot();player.tick(1,true);assert.deepEqual(player.snapshot(),before);
 player.select('jack');assert.deepEqual(player.snapshot().sarah,explored);
 player.setExploring(false,poses);assert.equal(player.returning,true);
 for(let i=0;i<400;i++)player.tick(.05,false);
 assert.equal(player.returning,false);assert.equal(player.active,false);
 assert.deepEqual(player.snapshot().sarah,poses.sarah);
});
test('Sarah cannot be controlled before her entrance; blocked taps do not schedule actions',()=>{
 const player=createLabPlayer();player.setExploring(true,{...poses,sarah:{...poses.sarah,visible:false}});
 assert.equal(player.select('sarah'),false);
 assert.equal(player.goTo({x:-.9,z:-.35},'terminal'),false);
 assert.equal(player.takeInteraction(),null);
 assert.equal(player.goTo({x:.7,z:1.8},'terminal'),true);
 for(let i=0;i<300;i++)player.tick(.05,false);
 assert.equal(player.takeInteraction(),'terminal');assert.equal(player.takeInteraction(),null);
});
test('an interaction at the current position stands up and completes once',()=>{
 const player=createLabPlayer();player.setExploring(true,poses);
 player.goTo(poses.jack,'terminal');
 for(let i=0;i<30;i++)player.tick(.05,false);
 assert.equal(player.snapshot().jack.seat,0);assert.equal(player.takeInteraction(),'terminal');
});
test('conversation approach stays reachable at a floor boundary or beside furniture',async()=>{
 const {findInteractionPoint}=await import('../app/game/three/lab-navigation.ts');
 for(const target of [{x:3.4,z:2.9},{x:-1.8,z:.45},{x:-3.1,z:-1.5}]){
  const start={x:1,z:2},point=findInteractionPoint(start,target);
  assert.ok(point&&walkable(point));assert.ok(findLabPath(start,point).length);
  assert.ok(Math.hypot(point.x-target.x,point.z-target.z)<1);
 }
});
