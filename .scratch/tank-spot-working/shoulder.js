// Scoped static contact: preserve the approved fitted torso and garment cuts.
const weights=[[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]];
const smooth=(v,a,b)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const shoulderMask=(o,i)=>{const x=Math.abs(o[i*3]),y=o[i*3+1];return x>=6.5&&x<=25&&y>137;};
const collarMask=(o,i)=>Math.abs(o[i*3])<10&&o[i*3+1]>130&&o[i*3+2]<-9;
const mask=(o,i)=>shoulderMask(o,i)||collarMask(o,i);
const shoulderCore=(o,i)=>shoulderMask(o,i)&&Math.abs(o[i*3])>=8&&o[i*3+1]>=140;
const collarCore=(o,i)=>Math.abs(o[i*3])<=8&&o[i*3+1]>=137&&o[i*3+2]<=-11;
const core=(o,i)=>shoulderCore(o,i)||collarCore(o,i);
const fieldWeight=(o,i)=>{const x=Math.abs(o[i*3]),y=o[i*3+1],z=o[i*3+2],a=shoulderMask(o,i)?smooth(x,6.5,8)*smooth(y,137,140):0,b=collarMask(o,i)?(1-smooth(x,8,10))*smooth(y,130,137)*(1-smooth(z,-11,-9)):0;return 1-(1-a)*(1-b);};
export function shoulderContact(meshes,collider,{enabled=true,clearanceCm=.025,thicknessCm=.08,curvatureAllowanceCm=0}={}){
 const snapshots=meshes.map(mesh=>({mesh,before:mesh.geometry.attributes.position.array.slice()}));
 let moved=0,maxMoveCm=0,selected=0,iterations=0;
 if(enabled)for(const {mesh,before}of snapshots){const p=mesh.geometry.attributes.position,o=mesh.userData.roundReferenceOriginal??mesh.userData.original,side=mesh.userData.shellSide,groups=new Map();
  for(let i=0;i<p.count;i++){if(!mask(o,i))continue;selected++;const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',')+':'+side[i];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
  for(const ids of groups.values()){const i=ids[0],q=[p.getX(i),p.getY(i),p.getZ(i)],aim=clearanceCm+(side[i]>.25?thicknessCm:0)+curvatureAllowanceCm+.0005;
   for(let pass=0;pass<24;pass++){const hit=collider.closest(q),delta=aim-hit.signedDistance;if(delta<=.0001)break;for(let d=0;d<3;d++)q[d]+=hit.projectionDirection[d]*delta;iterations++;}
   for(const j of ids){const w=fieldWeight(o,j),next=[0,1,2].map(d=>before[j*3+d]+w*(q[d]-before[i*3+d])),move=Math.hypot(...next.map((v,d)=>v-before[j*3+d]));if(move>0){p.setXYZ(j,...next);moved++;maxMoveCm=Math.max(maxMoveCm,move);}}
  }p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
 }
 const results={scope:{sourceAbsX:[6.5,25],sourceYGreaterThan:137,strictCoreAbsX:[8,25],strictCoreY:140,lowXFadeCm:[6.5,8],fadeCm:[137,140],centralBack:{sourceAbsX:[0,10],sourceYGreaterThan:130,sourceZLessThan:-9,strictCoreAbsX:[0,8],strictCoreY:137,strictCoreZ:-11,xFadeCm:[8,10],yFadeCm:[130,137],zFadeCm:[-11,-9]},strictCoreUnion:true},enabled,selected,moved,maxMoveCm,iterations,outsideFieldErrors:0,core:{count:0,minCm:Infinity,belowClearance:0,belowTarget:0},collarCore:{count:0,minCm:Infinity,belowClearance:0,belowTarget:0},transition:{count:0,minCm:Infinity,belowClearance:0},triangles:{scope:'all three source vertices in strict core',count:0,minCm:Infinity,belowClearance:0,belowTarget:0},nonFinite:0};
 for(const {mesh,before}of snapshots){const p=mesh.geometry.attributes.position,o=mesh.userData.roundReferenceOriginal??mesh.userData.original,side=mesh.userData.shellSide,ix=mesh.geometry.index.array;
  for(let i=0;i<p.count;i++){if(!mask(o,i)){for(let d=0;d<3;d++)if(p.array[i*3+d]!==before[i*3+d])results.outsideFieldErrors++;continue;}const q=[p.getX(i),p.getY(i),p.getZ(i)];if(!q.every(Number.isFinite)){results.nonFinite++;continue;}const hit=collider.closest(q),r=core(o,i)?results.core:results.transition;r.count++;r.minCm=Math.min(r.minCm,hit.signedDistance);if(hit.signedDistance<clearanceCm-1e-7)r.belowClearance++;if(core(o,i)&&hit.signedDistance<clearanceCm+(side[i]>.25?thicknessCm:0)-1e-7)r.belowTarget++;if(collarCore(o,i)){const c=results.collarCore;c.count++;c.minCm=Math.min(c.minCm,hit.signedDistance);if(hit.signedDistance<clearanceCm-1e-7)c.belowClearance++;if(hit.signedDistance<clearanceCm+(side[i]>.25?thicknessCm:0)-1e-7)c.belowTarget++;}}
  for(let k=0;k<ix.length;k+=3){const ids=[ix[k],ix[k+1],ix[k+2]];if(!ids.every(i=>core(o,i)))continue;for(const w of weights){const q=[0,1,2].map(d=>ids.reduce((s,i,j)=>s+w[j]*p.array[i*3+d],0)),hit=collider.closest(q),aim=clearanceCm+thicknessCm*ids.reduce((s,i,j)=>s+w[j]*(side[i]>.25?1:0),0);results.triangles.count++;results.triangles.minCm=Math.min(results.triangles.minCm,hit.signedDistance);if(hit.signedDistance<clearanceCm-1e-7)results.triangles.belowClearance++;if(hit.signedDistance<aim-1e-7)results.triangles.belowTarget++;}}
 }
 results.collarCore.minMm=results.collarCore.minCm*10;results.core.minMm=results.core.minCm*10;results.transition.minMm=results.transition.minCm*10;results.triangles.minMm=results.triangles.minCm*10;results.converged=results.outsideFieldErrors===0&&results.nonFinite===0&&results.core.belowClearance===0&&results.triangles.belowClearance===0;return results;
}

export function safeShoulderContact(meshes,collider,options={}){const original=meshes.map(mesh=>mesh.geometry.attributes.position.array.slice()),history=[];let allowance=0,result;for(let attempt=0;attempt<3;attempt++){for(let m=0;m<meshes.length;m++)meshes[m].geometry.attributes.position.array.set(original[m]);result=shoulderContact(meshes,collider,{...options,curvatureAllowanceCm:allowance});history.push({attempt,curvatureAllowanceCm:allowance,vertexMinCm:result.core.minCm,triangleMinCm:result.triangles.minCm,failedTriangles:result.triangles.belowClearance});if(!options.enabled||result.converged)break;const deficit=Math.max(0,.025-result.triangles.minCm);const next=Math.min(.2,allowance+deficit+.005);if(next<=allowance)break;allowance=next;}return {...result,curvatureAllowanceCm:history.at(-1).curvatureAllowanceCm,allowanceHistory:history,topologyUnchanged:true};}
