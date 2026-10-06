import * as T from 'three';
export type LabView='room'|'terminal'|'conversation'|'webcam'|'firstperson';
export type CameraGesture='orbit'|'pan';

// All orientations share a bearing. Only distance changes to fit the viewport.
export function labShot(view:LabView,aspect:number,speaker='jack',together=false){
 const safeAspect=Math.max(.3,aspect);
 if(view==='webcam'){
  // Lens sits just in front of the top edge of Jack's monitor.
  // Portrait is a speaker close-up; landscape holds the adjacent seats.
  const x=together?(safeAspect<1?(speaker==='sarah'?-1.8:-.9):-1.35):-.9;
  return {position:new T.Vector3(-.9,1.66,-.49),target:new T.Vector3(x,1.22,.5),fov:78};
 }
 if(view==='terminal')return {position:new T.Vector3(-.8,1.48,1.05+(safeAspect<1?.65:0)),target:new T.Vector3(-.9,1.28,-.55),fov:42};
 if(view==='room'){const target=new T.Vector3(-.15,1,-.7),offset=new T.Vector3(4.05,1.45,5.2);if(safeAspect<1)offset.multiplyScalar(1.22);return {position:target.clone().add(offset),target,fov:48};}
 const target=new T.Vector3(-1.05,1.16,.5);
 const bearing=new T.Vector3(1,.24,-.38).normalize();
 const size=new T.Vector3(2.25,1.65,1.1);
 const fov=48,tan=Math.tan(T.MathUtils.degToRad(fov/2));
 const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),bearing).normalize();
 const up=new T.Vector3().crossVectors(bearing,right).normalize();
 let distance=2.7;
 for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
  const corner=new T.Vector3(x*size.x/2,y*size.y/2,z*size.z/2);
  distance=Math.max(distance,corner.dot(bearing)+Math.max(Math.abs(corner.dot(right))/(tan*safeAspect*.8),Math.abs(corner.dot(up))/(tan*.74)));
 }
 return {position:target.clone().addScaledVector(bearing,distance),target,fov};
}

export type EyeMount={height:number;eyeAboveHead:number;radius:number;head:T.Object3D};
/** Measure the actual head-weighted skin once at load; keep the whole model visible.
 * The lens clears the head envelope plus the near plane, including side/back looks. */
export function measureEyeMount(root:T.Object3D):EyeMount{
 root.updateMatrixWorld(true);
 const head=root.getObjectByName('Bone_017');if(!head)throw new Error('First person requires the head joint');
 const center=root.worldToLocal(head.getWorldPosition(new T.Vector3())),bounds=new T.Box3(),point=new T.Vector3();let radius=0;
 root.traverse(o=>{
  const mesh=o as T.SkinnedMesh;if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();
  const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
  const headIndices=new Set(mesh.skeleton.bones.map((bone,i)=>{let p:T.Object3D|null=bone;while(p&&p!==head)p=p.parent;return p===head?i:-1;}).filter(i=>i>=0));
  for(let i=0;i<indices.count;i++){
   let influence=0;for(let j=0;j<4;j++)if(headIndices.has(indices.getComponent(i,j)))influence+=weights.getComponent(i,j);
   if(influence<.4)continue;
   mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);root.worldToLocal(point);
   if(point.y<center.y-.04)continue;bounds.expandByPoint(point);radius=Math.max(radius,Math.hypot(point.x-center.x,point.z-center.z));
  }
 });
 if(bounds.isEmpty())throw new Error('Cannot measure the skinned head');
 const height=bounds.max.y-(bounds.max.y-bounds.min.y)*.32;
 return {head,height,eyeAboveHead:height-center.y,radius};
}
export function firstPersonShot(root:T.Object3D,mount:EyeMount,yaw:number,pitch:number){
 root.updateMatrixWorld(true);
 const position=mount.head.getWorldPosition(new T.Vector3());position.y+=mount.eyeAboveHead;
 const forward=new T.Vector3(Math.sin(yaw),0,Math.cos(yaw));// Regular Beyond-Extinction KauaiStreamScene uses a 0.10 m forward
 // nudge. Increase only for measured head clearance so no head hiding is needed.
 position.addScaledVector(forward,Math.max(.10,mount.radius+.065));
 const direction=forward.multiplyScalar(Math.cos(pitch));direction.y=Math.sin(pitch);
 return {position,target:position.clone().add(direction),fov:76};
}
