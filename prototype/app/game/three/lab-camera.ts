import * as T from 'three';
export type LabView='room'|'terminal'|'conversation'|'webcam';
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
