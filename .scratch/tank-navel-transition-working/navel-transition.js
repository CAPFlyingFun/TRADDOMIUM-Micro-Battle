import * as T from 'three';
import {step5} from './high-hem-correction.js';

const saved=new WeakMap();
export function restoreNavelTransition(meshes){
 for(const mesh of meshes){const old=saved.get(mesh);if(old&&old.geometry===mesh.geometry){mesh.geometry.attributes.normal.array.set(old.normals);mesh.geometry.attributes.normal.needsUpdate=true;}saved.delete(mesh);}
}

// Blend the annular shading only. No radius, height, projection or vertex moves.
export function softenNavelTransition(meshes,{enabled=false,center}={}){
 restoreNavelTransition(meshes);
 if(!enabled)return {enabled:false,success:true};
 let changedNormals=0,protectedErrors=0,positionErrors=0,maxAngleDegrees=0;
 for(const mesh of meshes){
  const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,side=mesh.userData.shellSide,old=n.array.slice(),positions=p.array.slice(),area=new Float64Array(p.count),ix=g.index.array;
  saved.set(mesh,{geometry:g,normals:old});
  const front=i=>side[i]>.25&&p.getZ(i)>center[2]-6;
  for(let k=0;k<ix.length;k+=3){const a=ix[k],b=ix[k+1],c=ix[k+2];if(!front(a)||!front(b)||!front(c))continue;const mass=Math.abs((p.getX(b)-p.getX(a))*(p.getY(c)-p.getY(a))-(p.getY(b)-p.getY(a))*(p.getX(c)-p.getX(a)))/6;area[a]+=mass;area[b]+=mass;area[c]+=mass;}
  const bins=new Map(),cell=.3,weights=new Float64Array(p.count);
  for(let i=0;i<p.count;i++){if(!front(i))continue;const x=p.getX(i)-center[0],y=p.getY(i)-center[1],r=Math.hypot(x,y);if(r>3.6)continue;const key=Math.floor(x/cell)+':'+Math.floor(y/cell);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);weights[i]=.65*step5(r,.65,.95)*(1-step5(r,1.8,2.4));}
  for(let i=0;i<p.count;i++){
   const w=weights[i];if(w<=0)continue;const x=p.getX(i)-center[0],y=p.getY(i)-center[1],sum=new T.Vector3(),prior=new T.Vector3(...old.slice(3*i,3*i+3));let mass=0;
   for(let row=Math.floor((y-1.2)/cell);row<=Math.floor((y+1.2)/cell);row++)for(let col=Math.floor((x-1.2)/cell);col<=Math.floor((x+1.2)/cell);col++)for(const j of bins.get(col+':'+row)??[]){const r2=(p.getX(j)-p.getX(i))**2+(p.getY(j)-p.getY(i))**2;if(r2>=1.44||area[j]===0)continue;const q=new T.Vector3(...old.slice(3*j,3*j+3));if(q.dot(prior)<=0)continue;const a=area[j]*Math.exp(-r2/(2*.45*.45))*(1-step5(Math.sqrt(r2),.9,1.2));sum.addScaledVector(q,a);mass+=a;}
   if(mass<=1e-12||sum.lengthSq()<1e-12)continue;const result=prior.clone().lerp(sum.normalize(),w).normalize();n.setXYZ(i,result.x,result.y,result.z);if(result.x!==old[3*i]||result.y!==old[3*i+1]||result.z!==old[3*i+2]){if(n.getX(i)!==old[3*i]||n.getY(i)!==old[3*i+1]||n.getZ(i)!==old[3*i+2])changedNormals++;}maxAngleDegrees=Math.max(maxAngleDegrees,prior.angleTo(result)*180/Math.PI);
  }
  for(let i=0;i<p.count;i++){for(let d=0;d<3;d++){if(p.array[3*i+d]!==positions[3*i+d])positionErrors++;if(weights[i]===0&&n.array[3*i+d]!==old[3*i+d])protectedErrors++;}}n.needsUpdate=true;
 }
 return {enabled:true,center:center.slice(),changedNormals,maxBlend:.65,kernelRadiusCm:1.2,annulusCm:[.65,2.4],maxAngleDegrees,positionErrors,protectedErrors,success:positionErrors===0&&protectedErrors===0};
}
