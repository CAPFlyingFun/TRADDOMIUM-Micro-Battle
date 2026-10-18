import * as T from 'three';
import {step5} from './high-hem-correction.js';
const cache=new WeakMap();
function sourceHem(mesh){const a=mesh.userData.roundReferenceOriginal??mesh.userData.original,bins=128,hem=new Float64Array(bins).fill(Infinity),bin=i=>Math.floor(((Math.atan2(a[3*i],a[3*i+2]+6)+2*Math.PI)%(2*Math.PI))/(2*Math.PI)*bins)%bins;for(let i=0;i<a.length/3;i++)hem[bin(i)]=Math.min(hem[bin(i)],a[3*i+1]);return i=>a[3*i+1]-hem[bin(i)];}
export function restoreSpotShading(meshes){for(const m of meshes){const old=cache.get(m);if(old&&old.g===m.geometry){m.geometry.attributes.normal.array.set(old.n);m.geometry.attributes.normal.needsUpdate=true;}cache.delete(m);}}
export function softenSpotShading(meshes,{enabled=false,bodyCollider,navelCenter,hemDistance=null}={}){
 restoreSpotShading(meshes);if(!enabled)return {enabled:false,success:true};let changedNormals=0,positionErrors=0,outsideErrors=0;
 for(const m of meshes){const g=m.geometry,p=g.attributes.position,n=g.attributes.normal,old=n.array.slice(),positions=p.array.slice(),distance=hemDistance??sourceHem(m),side=m.userData.shellSide;cache.set(m,{g,n:old});
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),w=side[i]>.25&&z>-6?(1-step5(Math.hypot(x+8.5,y-98.5),1.5,3))*step5(distance(i),1.8,2.4)*step5(Math.hypot(x-navelCenter[0],y-navelCenter[1]),3.5,4.5):0;if(w<=0)continue;
   const target=new T.Vector3();for(const [dx,dy,k] of [[0,0,2],[-.25,0,1],[.25,0,1],[0,-.25,1],[0,.25,1]])target.addScaledVector(new T.Vector3(...bodyCollider.closest([x+dx,y+dy,z]).normal).normalize(),k);target.normalize();const prior=new T.Vector3(...old.slice(3*i,3*i+3));if(target.dot(prior)<0)target.negate();const q=prior.lerp(target,w).normalize();n.setXYZ(i,q.x,q.y,q.z);changedNormals++;
  }
  for(let i=0;i<positions.length;i++)if(positions[i]!==p.array[i])positionErrors++;for(let i=0;i<p.count;i++)if(side[i]<=.25||p.getZ(i)<=-6||Math.hypot(p.getX(i)+8.5,p.getY(i)-98.5)>=3||distance(i)<=1.8||Math.hypot(p.getX(i)-navelCenter[0],p.getY(i)-navelCenter[1])<=3.5)for(let k=0;k<3;k++)if(n.array[3*i+k]!==old[3*i+k])outsideErrors++;n.needsUpdate=true;
 }
 return {enabled:true,changedNormals,positionErrors,outsideErrors,scope:'outer front normals only; radius 3cm about [-8.5,98.5]; C2 fades; navel and hem locked',success:positionErrors===0&&outsideErrors===0};
}
