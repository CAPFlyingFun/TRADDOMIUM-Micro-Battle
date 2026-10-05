import * as T from 'three';
// Preview-only lower-body weighting for the generated Sarah rig. Original GLB
// bytes stay intact. Smooth bands prevent the skirt/knees tearing at a deep bend.
export function prepareSeatedSarah(root:T.Object3D){
 root.updateMatrixWorld(true);
 root.traverse(o=>{const mesh=o as T.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
 mesh.skeleton.update();
 const g=mesh.geometry,p=g.getAttribute('position'),oldJ=g.getAttribute('skinIndex'),oldW=g.getAttribute('skinWeight'),j=new Uint16Array(p.count*4),w=new Float32Array(p.count*4),point=new T.Vector3();
 const index=(name:string)=>mesh.skeleton.bones.findIndex(b=>b.name===name),smooth=T.MathUtils.smoothstep;
 for(let i=0;i<p.count;i++){
  point.fromBufferAttribute(p,i);mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld);const y=point.y,amount=1-smooth(y,.86,.98),sum=new Map<number,number>();
  const add=(id:number,value:number)=>{if(id>=0&&value>0)sum.set(id,(sum.get(id)||0)+value);};
  for(let k=0;k<4;k++)add(oldJ.getComponent(i,k),oldW.getComponent(i,k)*(1-amount));
  if(amount>0){const hip=smooth(y,.79,.94),knee=smooth(y,.38,.57),ankle=smooth(y,.065,.17),right=smooth(point.x,-.045,.045);
   add(index('Bone_001'),amount*hip);
   for(const [side,factor] of [[false,1-right],[true,right]] as const){const weight=amount*(1-hip)*factor;add(index(side?'Bone_015':'Bone_010'),weight*knee);add(index(side?'Bone_014':'Bone_009'),weight*(1-knee)*ankle);add(index(side?'Bone_013':'Bone_008'),weight*(1-knee)*(1-ankle));}
  }
  const best=[...sum].sort((a,b)=>b[1]-a[1]).slice(0,4),total=best.reduce((s,x)=>s+x[1],0);
  for(let k=0;k<4;k++){j[i*4+k]=best[k]?.[0]||0;w[i*4+k]=(best[k]?.[1]||0)/(total||1);}
 }
 g.setAttribute('skinIndex',new T.Uint16BufferAttribute(j,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(w,4));
 });
}
