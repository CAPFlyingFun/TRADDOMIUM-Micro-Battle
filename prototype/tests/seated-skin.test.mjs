import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {newRigFixture} from './helpers/new-rig-fixture.mjs';import {prepareSeatedSarah} from '../app/game/three/seated-skin.ts';
test('Sarah seating correction preserves rest shape and upper-body weights',async()=>{
 const {root}=await newRigFixture('sarah');let mesh;root.traverse(o=>{if(o.isSkinnedMesh&&(!mesh||o.geometry.attributes.position.count>mesh.geometry.attributes.position.count))mesh=o;});mesh.skeleton.update();
 const p=mesh.geometry.attributes.position,j=mesh.geometry.attributes.skinIndex,w=mesh.geometry.attributes.skinWeight,before=[];
 for(let i=0;i<p.count;i+=37){const v=new T.Vector3().fromBufferAttribute(p,i);mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);before.push({i,v,j:[0,1,2,3].map(k=>j.getComponent(i,k)),w:[0,1,2,3].map(k=>w.getComponent(i,k))});}
 prepareSeatedSarah(root);
 for(const row of before){const v=new T.Vector3().fromBufferAttribute(p,row.i);mesh.applyBoneTransform(row.i,v);v.applyMatrix4(mesh.matrixWorld);assert.ok(v.distanceTo(row.v)<.001);const sw=mesh.geometry.attributes.skinWeight,sj=mesh.geometry.attributes.skinIndex;assert.ok(Math.abs([0,1,2,3].reduce((s,k)=>s+sw.getComponent(row.i,k),0)-1)<1e-5);if(row.v.y>1.0){for(let k=0;k<4;k++)if(row.w[k]>.001){let match=false;for(let n=0;n<4;n++)if(sj.getComponent(row.i,n)===row.j[k]&&Math.abs(sw.getComponent(row.i,n)-row.w[k])<.001)match=true;assert.ok(match);}}}
});
