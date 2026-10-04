import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {labShot} from '../app/game/three/lab-camera.ts';
test('Together retains its front quarter bearing on portrait and landscape',()=>{
 const wide=labShot('conversation',1.8),tall=labShot('conversation',.65);
 const direction=s=>s.position.clone().sub(s.target).normalize();
 assert.ok(direction(wide).distanceTo(direction(tall))<1e-10);
 assert.ok(wide.position.z<wide.target.z&&tall.position.z<tall.target.z);
 for(const aspect of [.5,.65,1,1.8,2.5]){
  const shot=labShot('conversation',aspect),camera=new T.PerspectiveCamera(shot.fov,aspect,.05,35);
  camera.position.copy(shot.position);camera.lookAt(shot.target);camera.updateMatrixWorld();
  for(const x of [-2.1,-.05])for(const y of [.4,1.9])for(const z of [.15,.9]){
   const projected=new T.Vector3(x,y,z).project(camera);
   assert.ok(Math.abs(projected.x)<.85&&Math.abs(projected.y)<.8,`subject cropped at ${aspect}: ${projected.toArray()}`);
  }
 }
});
test('webcam stays at the monitor and frames the current speaker in portrait',()=>{
 const jack=labShot('webcam',.65,'jack',true),sarah=labShot('webcam',.65,'sarah',true),wide=labShot('webcam',1.8,'sarah',true);
 assert.deepEqual(jack.position.toArray(),sarah.position.toArray());
 assert.equal(jack.target.x,-.9);assert.equal(sarah.target.x,-1.8);assert.equal(wide.target.x,-1.35);
 assert.ok(jack.position.z>-.533&&jack.target.z>jack.position.z);
});
