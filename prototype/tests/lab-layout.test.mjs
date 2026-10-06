import test from 'node:test';
import assert from 'node:assert/strict';
import {chairRetrievalPosition,spareChairHome} from '../app/game/three/lab-layout.ts';
import {walkable,findLabPath} from '../app/game/three/lab-navigation.ts';
test('chair retrieval clears Sarah and the workstation on outbound and return',()=>{
 for(let i=0;i<=100;i++){const p=chairRetrievalPosition(i/100);assert.ok(walkable(p));assert.ok(Math.hypot(p.x+1.8,p.z-.45)>.6,'Do not walk through Sarah or her seat');}
 const end=chairRetrievalPosition(1);assert.equal(end.x,spareChairHome.x);assert.ok(Math.abs(end.z-spareChairHome.z-.12)<1e-8);
});
test('Layout D keeps the right aisle reachable and perimeter benches solid',()=>{
 assert.ok(walkable({x:4,z:1}));assert.ok(findLabPath({x:-.9,z:.45},{x:4,z:1}).length);
 for(const p of [{x:5.5,z:0},{x:-5.5,z:0},{x:-4.3,z:1.7},{x:-4.3,z:2.35}])assert.equal(walkable(p),false);
});
