import * as T from 'three';

// The supplied UniRig models use different left/right numbering. Discover the
// side from rest-space position, and aim bones geometrically rather than assume
// their local Euler axes. Model data and bind matrices remain unchanged.
//
// `pregnant` (Sarah, 32 weeks): seated, she sits upright with a slight lean back,
// thighs a little below level and further apart so they clear the bump, and her
// hands resting on her thighs. Her bump keeps its shape because of its bone
// weights (TRADDOMIUM scripts/protectBumpWeights.mjs, baked into sarah.glb),
// not because of this pose: the arms rest beside it, they do not cover it.
export interface BodyMotionOptions { readonly pregnant?: boolean }
export function createBodyMotion(root:T.Object3D,options:BodyMotionOptions={}) {
 const pregnant=options.pregnant===true;
 const bones=new Map<string,T.Bone>(),rest=new Map<T.Bone,T.Quaternion>();
 root.updateMatrixWorld(true);
 root.traverse(o=>{if((o as T.Bone).isBone){bones.set(o.name,o as T.Bone);rest.set(o as T.Bone,o.quaternion.clone());}});
 const world=new T.Quaternion(),parent=new T.Quaternion(),delta=new T.Quaternion(),dir=new T.Vector3();
 const side=(name:string)=>Math.sign(root.worldToLocal(bones.get(name)!.getWorldPosition(new T.Vector3())).x)||1;
 const arms=(bones.size===35?[['Bone_025','Bone_024','Bone_023'],['Bone_033','Bone_032','Bone_031']]:[['Bone_022','Bone_021','Bone_020'],['Bone_027','Bone_026','Bone_025']]).map(names=>({names,side:side(names[0])}));
 const legs=[['Bone_010','Bone_009','Bone_008','Bone_007'],['Bone_015','Bone_014','Bone_013','Bone_012']].map(names=>({names,side:side(names[0])}));
 function aim(name:string,childName:string,target:T.Vector3){
  const bone=bones.get(name),child=bones.get(childName);if(!bone||!child)return;
  root.getWorldQuaternion(world);target.applyQuaternion(world).normalize();
  bone.getWorldQuaternion(world);dir.copy(child.position).normalize().applyQuaternion(world);
  delta.setFromUnitVectors(dir,target);world.premultiply(delta);
  bone.parent!.getWorldQuaternion(parent);bone.quaternion.copy(parent.invert().multiply(world));bone.updateMatrixWorld(true);
 }
 const v=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
 return {pose(time:number,mode:'seated'|'idle'|'walk',speaking:boolean,typing:boolean,reduced:boolean,lookYaw=0,seatBlend=1,opening:{sleep?:number;jolt?:number}={}){
  for(const [b,q] of rest)b.quaternion.copy(q);
  root.updateMatrixWorld(true);
  const breath=reduced?0:Math.sin(time*1.5)*.008,gesture=speaking&&!reduced?Math.sin(time*2.1)*.07:0;
  const spine=bones.get('Bone_004');if(spine)spine.rotateX(breath);
  root.updateMatrixWorld(true);
  for(const arm of arms){
   const s=arm.side,step=mode==='walk'?Math.sin(time*5.2+s)*.20:0;
   aim(arm.names[0],arm.names[1],mode==='seated'?(typing?v(s*.19,-.68,.73):pregnant?v(s*.24,-1,.55):v(s*.2,-1,.2)):v(s*.16,-1,step+.05));
   aim(arm.names[1],arm.names[2],mode==='seated'?(typing?v(s*.08,-.12+(!reduced?Math.sin(time*10+s)*.05:0),1):pregnant?v(s*.12,-.85,1+gesture):v(s*.1,-.5,.5+gesture)):v(s*.1,-1,.15+gesture-step));
  }
  if(mode==='seated')for(const arm of arms){const wrist=bones.get(arm.names[2]);const hand=wrist?.children.find(o=>(o as T.Bone).isBone);if(wrist&&hand)wrist.rotateOnAxis(hand.position.clone().normalize(),Math.PI);}
  const sleep=T.MathUtils.clamp(opening.sleep??0,0,1),jolt=opening.jolt??0;
  if(mode==='seated'&&sleep>0)for(const arm of arms){
   const upper=bones.get(arm.names[0])!,fore=bones.get(arm.names[1])!,uq=upper.quaternion.clone(),fq=fore.quaternion.clone();
   aim(arm.names[0],arm.names[1],v(arm.side*.35,-.8,.38));upper.quaternion.slerpQuaternions(uq,upper.quaternion.clone(),sleep);root.updateMatrixWorld(true);
   aim(arm.names[1],arm.names[2],v(-arm.side*.9,.5,.25));fore.quaternion.slerpQuaternions(fq,fore.quaternion.clone(),sleep);root.updateMatrixWorld(true);
  }
  if(spine){spine.rotateX(sleep*.12-jolt*.1-(pregnant&&mode==='seated'?.05*seatBlend:0));root.updateMatrixWorld(true);}
  const beforeLegs=new Map<T.Bone,T.Quaternion>();
  if(mode==='seated'&&seatBlend<1)for(const leg of legs)for(const name of leg.names){const b=bones.get(name)!;beforeLegs.set(b,b.quaternion.clone());}
  for(const leg of legs){
   const step=mode==='walk'?Math.sin(time*5.2+(leg.side>0?0:Math.PI))*.24:0;
   if(mode==='seated'){
    aim(leg.names[0],leg.names[1],pregnant?v(leg.side*.2,-.17,1):v(leg.side*.04,-.05,1));
    aim(leg.names[1],leg.names[2],pregnant?v(leg.side*.03,-1,.02):v(0,-1,-.06));
    aim(leg.names[2],leg.names[3],v(0,-.65,.76));
   }else if(mode==='walk'){
    aim(leg.names[0],leg.names[1],v(0,-1,step));
    aim(leg.names[1],leg.names[2],v(0,-1,-Math.max(0,-step)*1.2));
    aim(leg.names[2],leg.names[3],v(0,-.55,.83));
   }
  }
  for(const [b,q] of beforeLegs)b.quaternion.slerpQuaternions(q,b.quaternion.clone(),seatBlend);
  const head=bones.get('Bone_017');
  if(head){head.rotateZ(sleep*.24);head.rotateX(sleep*.12-jolt*.14);}
  if(head&&lookYaw){root.getWorldQuaternion(world);const axis=new T.Vector3(0,1,0).applyQuaternion(world);head.parent!.getWorldQuaternion(parent);axis.applyQuaternion(parent.invert());head.quaternion.premultiply(delta.setFromAxisAngle(axis,lookYaw));}
if(head&&speaking&&!reduced)head.rotateX(Math.sin(time*2.8)*.025);
  root.updateMatrixWorld(true);
 }};
}
