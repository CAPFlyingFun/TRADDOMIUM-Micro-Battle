import {softenNavelTransition,restoreNavelTransition} from './navel-transition.js';
import {softenSpotShading,restoreSpotShading} from './spot-shading.js';
import {spotPolicy,repairInnerSpot,restoreInnerSpot,spotPantsSurface,inspectSpot} from './inner-spot.js';
import {hemShadingPolicy,softenSpandexHem,restoreHemShading} from './hem-shading.js';
import {contourPolicy,preserveBellyContour as preserveBellyContourPass,restoreBellyContour,highPantsCollider} from './belly-contour.js';
import {resetHighHemOcclusion,applyHighHemOcclusion,inspectHighHemOcclusion,isHighHemOccluded} from './high-hem-occlusion.js';
import { restoreHighHemCorrections,smoothHighLeggings,correctHemLayering } from './high-hem-correction.js';
import { createHighHemInspector } from './high-hem-inspect.js';
import { createReviewView } from './review-view.js';
import { navelPolicy } from './navel-policy.js';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Renderer } from '/src/app/Renderer.ts';
import { buildSarahLabScene } from '/src/sarahlab/SarahLabScene.ts';
import { assets } from '/src/assets/assets.ts';
import { SkinCollider, projectGarment, verifyGarmentClearance } from './collision.js';
import { measureBareNavel, roundDome, hybridMetrics, fitQuadric } from './dome.js';
import { safeShoulderContact as applyShoulderContact, shoulderContact as verifyScopedContact } from './shoulder.js';
import { resetHighLeggingsMasks,maskHighLeggings } from './leggings-mask.js';
import { repairBackLayers } from './back-layer.js';
import { safeShoulderContact as applyOriginalShoulderContact } from './shoulder-original.js';
import { uncoveredSkinIndices, coverMask } from '/src/sarahlab/sarahLabTool.ts';
const renderer=new Renderer(document.querySelector('#host'));
const scene=buildSarahLabScene({renderer,uiLayer:document.querySelector('#ui'),assets},{onBack(){}});
await scene.enter();
const field=name=>document.querySelector(`[data-field="${name}"]`);
const click=name=>document.querySelector(`[data-action="sarahlab:${name}"]`).click();
const slide=(name,value)=>{const label=field(name);const input=label?.nextElementSibling?.matches('input')?label.nextElementSibling:label?.parentElement?.nextElementSibling;if(!input?.matches('input'))throw Error(`Missing slider ${name}`);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
let reviewFrozenTicks=false;
const tick=()=>{for(let i=0;i<30;i++)scene.update({rawDt:reviewFrozenTicks?0:1/60,simDt:reviewFrozenTicks?0:1/60,elapsed:reviewFrozenTicks?0:i/60});scene.three.updateMatrixWorld(true);scene.three.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update();});};
let ready=false,body,baseProfile,shirtProfile,tankMeshes=[],upperCut=[],navelAnchor=-1;
const NY=128,NA=128,Y0=80,Y1=152,CZ=-6;
const angle=(x,z)=>((Math.atan2(x,z-CZ)/(2*Math.PI)+1)%1)*NA;
function profile(){
 const grid=new Float64Array(NY*NA),v=new T.Vector3(),bone=new T.Vector3();
 const pos=body.geometry.attributes.position,si=body.geometry.attributes.skinIndex,sw=body.geometry.attributes.skinWeight;
 const excluded=body.skeleton.bones.map(b=>{b.getWorldPosition(bone);return Math.abs(bone.x)>13&&bone.y>60;});let sampled=0;
 for(let i=0;i<pos.count;i++){
  let arm=0;for(let j=0;j<4;j++)if(excluded[si.getComponent(i,j)])arm+=sw.getComponent(i,j);if(arm>.3)continue;
  body.getVertexPosition(i,v);body.localToWorld(v);if(v.y<Y0||v.y>Y1||Math.abs(v.x)>28)continue;
  const row=Math.max(0,Math.min(NY-1,Math.round((v.y-Y0)/(Y1-Y0)*(NY-1)))),col=Math.round(angle(v.x,v.z))%NA,r=Math.hypot(v.x,v.z-CZ);
  // A small spatial splat fills seams before diffusion; no nearest-sheet binding.
  for(let dy=-1;dy<=1;dy++)for(let da=-1;da<=1;da++){const yy=row+dy;if(yy<0||yy>=NY)continue;const idx=yy*NA+(col+da+NA)%NA;grid[idx]=Math.max(grid[idx],r);}
  sampled++;
 }
 const tight = {grid:fillSmooth(grid.slice(),12)};
 const collider=fillSmooth(grid,4).slice();
 const smooth=fillSmooth(grid,20);
 // Upper concave radius envelope bridges the under-bust recess at front only.
 const lo=Math.ceil((105-Y0)/(Y1-Y0)*(NY-1)),hi=Math.floor((135-Y0)/(Y1-Y0)*(NY-1));
 for(let a=0;a<NA;a++){
  const weight=T.MathUtils.smoothstep(Math.cos(a/NA*2*Math.PI),.3,.65);if(!weight)continue;
  const hull=[];
  for(let y=lo;y<=hi;y++){const p=[y,smooth[y*NA+a]];while(hull.length>1){const q=hull[hull.length-1],r=hull[hull.length-2];if((q[0]-r[0])*(p[1]-q[1])-(q[1]-r[1])*(p[0]-q[0])<0)break;hull.pop();}hull.push(p);}
  for(let i=0;i<hull.length-1;i++){const p=hull[i],q=hull[i+1];for(let y=p[0];y<=q[0];y++){const k=y*NA+a,r=T.MathUtils.lerp(p[1],q[1],(y-p[0])/(q[0]-p[0]));smooth[k]=T.MathUtils.lerp(smooth[k],Math.max(smooth[k],r),weight);}}
 }
 for(let round=0;round<4;round++){const next=smooth.slice();for(let y=0;y<NY;y++)for(let a=0;a<NA;a++)next[y*NA+a]=.5*smooth[y*NA+a]+.25*(smooth[y*NA+(a+1)%NA]+smooth[y*NA+(a+NA-1)%NA]);smooth.set(next);}
 return {grid:smooth,tight,collider:{grid:collider},sampled};
}
function fillSmooth(grid,rounds){
 let missing=grid.reduce((a,b)=>a+!b,0);
 for(let round=0;missing&&round<NY+NA;round++){
  const next=grid.slice();let count=0;
  for(let y=0;y<NY;y++)for(let a=0;a<NA;a++){const i=y*NA+a;if(grid[i])continue;let sum=0,n=0;for(const j of[y>0?i-NA:-1,y<NY-1?i+NA:-1,y*NA+(a+NA-1)%NA,y*NA+(a+1)%NA])if(j>=0&&grid[j]){sum+=grid[j];n++;}if(n)next[i]=sum/n;else count++;}
  grid.set(next);missing=count;
 }
 if(missing)throw Error(`Unfilled body envelope: ${missing}`);
 for(let round=0;round<rounds;round++){const next=grid.slice();for(let y=1;y<NY-1;y++)for(let a=0;a<NA;a++){const i=y*NA+a;next[i]=(grid[i]*4+grid[i-NA]+grid[i+NA]+grid[y*NA+(a+1)%NA]+grid[y*NA+(a+NA-1)%NA])/8;}grid.set(next);}return grid;
}
function cubic(a,b,c,d,t){return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);}
function radius(profile,y,a){const yy=T.MathUtils.clamp((y-Y0)/(Y1-Y0)*(NY-1),0,NY-1),yi=Math.floor(yy),aa=((a%NA)+NA)%NA,ai=Math.floor(aa),rows=[];for(let j=-1;j<=2;j++){const row=T.MathUtils.clamp(yi+j,0,NY-1),v=[];for(let k=-1;k<=2;k++)v.push(profile.grid[row*NA+(ai+k+NA)%NA]);rows.push(cubic(...v,aa-ai));}return cubic(...rows,yy-yi);}

const clearance=y=>y>137?T.MathUtils.lerp(1.5,.5,T.MathUtils.smoothstep(y,137,143)):y>123?T.MathUtils.lerp(1.8,1.5,T.MathUtils.smoothstep(y,123,135)):T.MathUtils.lerp(2.5,1.8,T.MathUtils.smoothstep(y,92,110));
function smoothNormals(mesh){mesh.geometry.computeVertexNormals();const n=mesh.geometry.attributes.normal;for(const group of mesh.userData.normalGroups){let x=0,y=0,z=0;for(const i of group){x+=n.getX(i);y+=n.getY(i);z+=n.getZ(i);}const d=Math.hypot(x,y,z)||1;for(const i of group)n.setXYZ(i,x/d,y/d,z/d);}n.needsUpdate=true;}
function fit(current){
 const bodyBefore=body.geometry.attributes.position.array.slice();
 const rows=[],bands={underBust:{n:0,inward:0,minGap:Infinity},belly:{n:0,inward:0,minGap:Infinity}};
 let boost=0,inactive=0,active=0,minRaw=Infinity;
 // First compute the preserved relaxed result, then blend a shared radial field.
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,orig=mesh.userData.original,records=[];
  for(let i=0;i<p.count;i++){
   const x=orig[i*3],originalY=orig[i*3+1],y=originalY-T.MathUtils.smoothstep(originalY,130,138),z=orig[i*3+2],a=angle(x,z),r=Math.hypot(x,z-CZ),cos=(z-CZ)/r,front=T.MathUtils.smoothstep(cos,-.34,.34),bodyNow=radius(current,originalY,a),base=radius(baseProfile,originalY,a),target=Math.max(base+(bodyNow-base)*front,bodyNow)+clearance(originalY),reference=radius(shirtProfile,originalY,a);
   const fitted=target+.55+.3*(r-reference),scale=fitted/r,u=T.MathUtils.smoothstep(originalY,130,134),xx=T.MathUtils.lerp(x*scale,x,u),zz=T.MathUtils.lerp(CZ+(z-CZ)*scale,z,u);
   const relaxedRadius=Math.hypot(xx,zz-CZ),mask=T.MathUtils.smoothstep(cos,.05,.55)*T.MathUtils.smoothstep(originalY,98,105)*(1-T.MathUtils.smoothstep(originalY,127,131));
   const tightRadius=radius(current.tight,originalY,a)+.6+.18*(r-reference),finalRadius=T.MathUtils.lerp(relaxedRadius,tightRadius,mask),surface=radius(current.collider,y,a),gap=finalRadius-surface;
   if(mask>0){minRaw=Math.min(minRaw,gap);boost=Math.max(boost,(.275-gap)/mask);active++;}else inactive++;
   records.push({i,x,y,z,a,r,originalY,xx,zz,mask,relaxedRadius,finalRadius,surface,cos});
  }rows.push({mesh,records});
 }
 boost=minRaw<.2?Math.max(0,boost):0;
 let vertices=0,minGap=Infinity,maxGap=-Infinity,torsoMin=Infinity,transitionMin=Infinity,upperMin=Infinity,tightMin=Infinity,inwardSum=0,maxInward=-Infinity,inactiveErrors=0;
 for(const {mesh,records} of rows){const p=mesh.geometry.attributes.position;
  for(const q of records){const {i,x,y,z,r,mask,relaxedRadius,originalY,surface,cos}=q,rr=q.finalRadius+boost*mask;
   const xx=mask?x*rr/r:q.xx,zz=mask?CZ+(z-CZ)*rr/r:q.zz;
   if(!Number.isFinite(xx+y+zz))throw Error('Non-finite spandex vertex');
   p.setXYZ(i,xx,y,zz);
   if(!mask&&(p.getX(i)!==Math.fround(q.xx)||p.getY(i)!==Math.fround(y)||p.getZ(i)!==Math.fround(q.zz)))inactiveErrors++;
   const actualR=Math.hypot(p.getX(i),p.getZ(i)-CZ),gap=actualR-radius(current.collider,y,angle(p.getX(i),p.getZ(i))),inward=relaxedRadius-actualR;
   minGap=Math.min(minGap,gap);maxGap=Math.max(maxGap,gap);
   if(originalY<=130)torsoMin=Math.min(torsoMin,gap);else if(originalY>=134)upperMin=Math.min(upperMin,gap);else transitionMin=Math.min(transitionMin,gap);
   if(mask){tightMin=Math.min(tightMin,gap);inwardSum+=inward;maxInward=Math.max(maxInward,inward);}
   if(mask&&cos>.95){const band=originalY>=117&&originalY<=126?bands.underBust:originalY>=103&&originalY<=116?bands.belly:null;if(band){band.n++;band.inward+=inward;band.minGap=Math.min(band.minGap,gap);}}
   vertices++;
  }
  for(let i=0;i<mesh.userData.original.length;i++)if(mesh.userData.original[i]!==mesh.userData.originalCheck[i])throw Error('Immutable source fit buffer changed');
  const source=mesh.userData.sourcePosition;for(let i=0;i<source.length;i++)if(source[i]!==mesh.userData.sourceCheck[i])throw Error('Imported GLB input position buffer changed');
  p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();
 }
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Fit changed approved body buffer');
 if(inactiveErrors)throw Error(`Inactive vertices differ from relaxed fit: ${inactiveErrors}`);
 if(tightMin<.1999)throw Error(`Insufficient tight-profile radial gap: ${tightMin}`);
 for(const b of Object.values(bands)){b.meanInwardCm=b.inward/b.n;delete b.inward;}
 return {vertices,activeVertices:active,inactiveVertices:inactive,inactiveVertexErrors:inactiveErrors,immutableInputBuffersVerified:true,bodyBufferUnchanged:true,minProfileGapCm:minGap,maxProfileGapCm:maxGap,torsoMinGapCm:torsoMin,transitionMinGapCm:transitionMin,upperAffineMinGapCm:upperMin,tightRegionRawMinGapCm:minRaw,tightRegionMinGapCm:tightMin,uniformFrontRadialBoostCm:boost,meanInwardFromRelaxedCm:inwardSum/active,maxInwardFromRelaxedCm:maxInward,centerlineBands:bands,upperFitValidated:false,sampledBodyVertices:current.sampled};
}

function fitRelaxed(current){let minGap=Infinity,maxGap=0,torsoMin=Infinity,upperMin=Infinity,transitionMin=Infinity,vertices=0;for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,orig=mesh.userData.original;for(let i=0;i<p.count;i++){const x=orig[i*3],originalY=orig[i*3+1],y=originalY-T.MathUtils.smoothstep(originalY,130,138),z=orig[i*3+2],a=angle(x,z),r=Math.hypot(x,z-CZ),cos=(z-CZ)/r,front=T.MathUtils.smoothstep(cos,-.34,.34),bodyNow=radius(current,originalY,a),base=radius(baseProfile,originalY,a),target=Math.max(base+(bodyNow-base)*front,bodyNow)+clearance(originalY),reference=radius(shirtProfile,originalY,a);const fitted=target+.55+.3*(r-reference),scale=fitted/r,u=T.MathUtils.smoothstep(originalY,130,134),xx=T.MathUtils.lerp(x*scale,x,u),zz=T.MathUtils.lerp(CZ+(z-CZ)*scale,z,u);p.setXYZ(i,xx,y,zz);const gap=Math.hypot(xx,zz-CZ)-radius(current.collider,y,angle(xx,zz));minGap=Math.min(minGap,gap);maxGap=Math.max(maxGap,gap);if(originalY<=130)torsoMin=Math.min(torsoMin,gap);else if(originalY>=134)upperMin=Math.min(upperMin,gap);else transitionMin=Math.min(transitionMin,gap);vertices++;}p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();}return {vertices,minProfileGapCm:minGap,maxProfileGapCm:maxGap,torsoMinGapCm:torsoMin,transitionMinGapCm:transitionMin,upperAffineMinGapCm:upperMin,upperFitValidated:false,sampledBodyVertices:current.sampled};}

function cutHeight(a){const ai=Math.floor(a)%NA,t=a-Math.floor(a);return T.MathUtils.lerp(upperCut[ai],upperCut[(ai+1)%NA],t);}
function roundedBust(current){
 const bodyBefore=body.geometry.attributes.position.array.slice(),all=[];
 let boost=0,rawMin=Infinity,active=0,unchanged=0;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,orig=mesh.userData.original,prior=p.array.slice(),records=[];
  for(let i=0;i<p.count;i++){
   const x=orig[i*3],oy=orig[i*3+1],z=orig[i*3+2],r=Math.hypot(x,z-CZ),cos=(z-CZ)/r,a=angle(x,z),y=p.getY(i),oldR=Math.hypot(p.getX(i),p.getZ(i)-CZ);
   const collarWeight=1-T.MathUtils.smoothstep(oy,cutHeight(a)-4,cutHeight(a)-1);
   const mask=collarWeight*T.MathUtils.smoothstep(cos,.15,.6)*T.MathUtils.smoothstep(oy,125,129)*(1-T.MathUtils.smoothstep(oy,137,143))*(1-T.MathUtils.smoothstep(Math.abs(x),14,19));
   const tightR=radius(current.tight,y,a)+.6+.18*(r-radius(shirtProfile,oy,a)),nextR=T.MathUtils.lerp(oldR,tightR,mask),surface=radius(current.collider,y,a),gap=nextR-surface;
   if(mask){rawMin=Math.min(rawMin,gap);boost=Math.max(boost,(.275-gap)/mask);active++;}else unchanged++;
   records.push({i,x,y,z,r,a,oy,mask,oldR,nextR});
  }all.push({mesh,prior,records});
 }
 const rejectedMarginBoostCm=rawMin<.2?Math.max(0,boost):0;boost=0;
 let minGap=Infinity,maxChange=0,sumChange=0,inactiveErrors=0,upperRimVertices=0,lowerPreservedVertices=0,upperRimErrors=0,lowerErrors=0,fullyWeightedMinGapCm=Infinity,negativeBefore=0,negativeAfter=0,newlyNegative=0,worsenedNegative=0,mostNegativeChangeCm=0;const worst=[];
 for(const {mesh,prior,records} of all){const p=mesh.geometry.attributes.position;
  for(const q of records){const {i,x,y,z,r,a,mask}=q;if(mask){const rr=q.nextR+boost*mask;p.setXYZ(i,x*rr/r,y,CZ+(z-CZ)*rr/r);const actualR=Math.hypot(p.getX(i),p.getZ(i)-CZ);const surface=radius(current.collider,y,a),gap=actualR-surface,oldGap=q.oldR-surface,change=gap-oldGap;
   if(oldGap<0)negativeBefore++;if(gap<0)negativeAfter++;if(oldGap>=0&&gap<0)newlyNegative++;if(oldGap<0&&change<-.00001)worsenedNegative++;mostNegativeChangeCm=Math.min(mostNegativeChangeCm,change);
   worst.push({vertex:i,originalY:q.oy,actualY:y,angleColumn:a,angleDegrees:a/NA*360,mask,oldGapCm:oldGap,newGapCm:gap,changeCm:change,cutHeightCm:cutHeight(a),x:q.x,z:q.z});
   minGap=Math.min(minGap,gap);if(mask>.99)fullyWeightedMinGapCm=Math.min(fullyWeightedMinGapCm,gap);maxChange=Math.max(maxChange,Math.abs(actualR-q.oldR));sumChange+=actualR-q.oldR;}
   else for(let j=0;j<3;j++)if(p.array[i*3+j]!==prior[i*3+j])inactiveErrors++;
   if(q.oy>=cutHeight(a)-1){upperRimVertices++;for(let j=0;j<3;j++)if(p.array[i*3+j]!==prior[i*3+j])upperRimErrors++;}
   if(q.oy<=125){lowerPreservedVertices++;for(let j=0;j<3;j++)if(p.array[i*3+j]!==prior[i*3+j])lowerErrors++;}
   if(!Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)))throw Error('Non-finite rounded-bust vertex');
  }p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();
 }
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Bust fit changed body');
 if(inactiveErrors||upperRimErrors||lowerErrors)throw Error(`Bust correction preservation failed: inactive=${inactiveErrors} rim=${upperRimErrors} lower=${lowerErrors}`);
 const trace={minGapCm:minGap,fullyWeightedMinGapCm,negativeBefore,negativeAfter,newlyNegative,worsenedNegative,mostNegativeChangeCm,worst:worst.sort((a,b)=>a.newGapCm-b.newGapCm).slice(0,12)};window.roundedBustTrace=trace;
 if(newlyNegative||worsenedNegative||fullyWeightedMinGapCm<=0){console.error('BUST_TRACE '+JSON.stringify(trace));throw Error(`Bust correction clearance regression: newlyNegative=${newlyNegative} worsenedNegative=${worsenedNegative} fullyWeightedGap=${fullyWeightedMinGapCm}`);} 
 return {activeVertices:active,unchangedVertices:unchanged,inactiveVertexErrors:inactiveErrors,upperRimVertices,upperRimErrors,lowerPreservedVertices,lowerErrors,fullyWeightedMinGapCm,minProfileGapCm:minGap,rawMinProfileGapCm:rawMin,uniformBustRadialBoostCm:boost,rejectedMarginBoostCm,upperFitValidated:false,inheritedNegativeEnvelopeSamples:negativeAfter,clearanceTrace:trace,maxRadialChangeCm:maxChange,meanRadialChangeCm:sumChange/active,bodyBufferUnchanged:true};
}
function chestField(){
 const N=65,H=49,X0=-8,X1=8,Y0=124,Y1=136,grid=new Float64Array(N*H),counts=new Uint32Array(N*H);
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,o=mesh.userData.original;for(let i=0;i<p.count;i++){const ox=o[i*3],oz=o[i*3+2],cos=(oz-CZ)/Math.hypot(ox,oz-CZ),x=p.getX(i),y=p.getY(i);if(cos<.6||x<X0||x>X1||y<Y0||y>Y1)continue;const col=Math.round((x-X0)/(X1-X0)*(N-1)),row=Math.round((y-Y0)/(Y1-Y0)*(H-1)),k=row*N+col;grid[k]+=p.getZ(i);counts[k]++;}}
 for(let i=0;i<grid.length;i++)if(counts[i])grid[i]/=counts[i];
 for(let round=0;round<N+H;round++){let missing=0;const next=grid.slice(),cnext=counts.slice();for(let row=0;row<H;row++)for(let col=0;col<N;col++){const k=row*N+col;if(counts[k])continue;let total=0,n=0;for(const j of[row?k-N:-1,row<H-1?k+N:-1,col?k-1:-1,col<N-1?k+1:-1])if(j>=0&&counts[j]){total+=grid[j];n++;}if(n){next[k]=total/n;cnext[k]=1;}else missing++;}grid.set(next);counts.set(cnext);if(!missing)break;}
 for(let round=0;round<2;round++){const next=grid.slice();for(let row=1;row<H-1;row++)for(let col=1;col<N-1;col++){const k=row*N+col;next[k]=(4*grid[k]+grid[k-N]+grid[k+N]+grid[k-1]+grid[k+1])/8;}grid.set(next);}
 function sample(x,y){const xx=T.MathUtils.clamp((x-X0)/(X1-X0)*(N-1),0,N-1),yy=T.MathUtils.clamp((y-Y0)/(Y1-Y0)*(H-1),0,H-1),a=Math.min(N-2,Math.floor(xx)),b=Math.min(H-2,Math.floor(yy));return T.MathUtils.lerp(T.MathUtils.lerp(grid[b*N+a],grid[b*N+a+1],xx-a),T.MathUtils.lerp(grid[(b+1)*N+a],grid[(b+1)*N+a+1],xx-a),yy-b);}
 const metrics=[];for(let y=127;y<=133;y+=.25){const left=sample(-5,y),right=sample(5,y),center=sample(0,y);metrics.push({worldYCm:y,leftZCm:left,rightZCm:right,centerZCm:center,centerDepressionCm:(left+right)/2-center});}
 return {sample,metrics};
}
function smoothChest(current){
 const field=chestField(),bodyBefore=body.geometry.attributes.position.array.slice();let active=0,unchanged=0,outsideErrors=0,rimVertices=0,rimErrors=0,lowerVertices=0,lowerErrors=0,minGap=Infinity,oldNegative=0,newNegative=0,newlyNegative=0,worsenedNegative=0,maxOutwardCm=0,sumOutwardCm=0;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,original=mesh.userData.original,before=p.array.slice();
  for(let i=0;i<p.count;i++){
   const x=before[i*3],y=before[i*3+1],z=before[i*3+2],oy=original[i*3+1],ox=original[i*3],oz=original[i*3+2],sourceAngle=angle(ox,oz),sourceCos=(oz-CZ)/Math.hypot(ox,oz-CZ);
   const weight=(1-T.MathUtils.smoothstep(Math.abs(x),3,5))*T.MathUtils.smoothstep(oy,128,129)*(1-T.MathUtils.smoothstep(oy,131.5,133))*T.MathUtils.smoothstep(sourceCos,.6,.85);
   const chord=T.MathUtils.lerp(field.sample(x,129),field.sample(x,132.25),T.MathUtils.clamp((y-129)/3.25,0,1)),deficit=Math.max(0,chord-field.sample(x,y)),delta=.6*Math.tanh(deficit/.6)*weight*T.MathUtils.smoothstep(y,129,129.5)*(1-T.MathUtils.smoothstep(y,131.75,132.25));
   if(delta>0){p.setZ(i,z+delta);active++;const movedZ=p.getZ(i),oldGap=Math.hypot(x,z-CZ)-radius(current.collider,y,angle(x,z)),gap=Math.hypot(x,movedZ-CZ)-radius(current.collider,y,angle(x,movedZ));minGap=Math.min(minGap,gap);if(oldGap<0)oldNegative++;if(gap<0)newNegative++;if(oldGap>=0&&gap<0)newlyNegative++;if(oldGap<0&&gap<oldGap-.00001)worsenedNegative++;maxOutwardCm=Math.max(maxOutwardCm,movedZ-z);sumOutwardCm+=movedZ-z;if(movedZ<z)throw Error('Chest bridge moved inward');}
   else {unchanged++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])outsideErrors++;}
   if(oy>=cutHeight(sourceAngle)-1){rimVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])rimErrors++;}
   if(oy<=128){lowerVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])lowerErrors++;}
   if(p.getX(i)!==x||p.getY(i)!==y)throw Error('Chest bridge changed X or Y');
   if(!Number.isFinite(p.getZ(i)))throw Error('Non-finite chest bridge vertex');
  }
  for(const {source,check} of mesh.userData.inputChecks)for(let i=0;i<source.length;i++)if(source[i]!==check[i])throw Error('Immutable shirt input buffer changed');
  p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();
 }
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Chest bridge changed body');
 if(outsideErrors||rimErrors||lowerErrors||newlyNegative||worsenedNegative)throw Error(`Chest bridge verification failed: outside=${outsideErrors}, rim=${rimErrors}, lower=${lowerErrors}, newlyNegative=${newlyNegative}, worsenedNegative=${worsenedNegative}`);
 return {activeVertices:active,unchangedVertices:unchanged,outsideVertexErrors:outsideErrors,rimVertices,rimErrors,lowerVertices,lowerErrors,minMovedRegionRadialGapCm:minGap,oldNegativeEnvelopeSamples:oldNegative,newNegativeEnvelopeSamples:newNegative,newlyNegative,worsenedNegative,maxOutwardCm,meanOutwardCm:sumOutwardCm/active,bodyBufferUnchanged:true,inputPositionIndexUVUnchanged:true,upperFitValidated:false};
}
function repairInnerLip(current){
 const bodyBefore=body.geometry.attributes.position.array.slice();let moved=0,unchanged=0,rimVertices=0,rimErrors=0,outsideErrors=0,outerVertices=0,outerErrors=0,minGap=Infinity,maxShiftCm=0;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,before=p.array.slice(),orig=mesh.userData.original,sourceNormals=mesh.userData.sourceNormals;
  for(let i=0;i<p.count;i++){
   const x=before[i*3],y=before[i*3+1],z=before[i*3+2],sourceA=angle(orig[i*3],orig[i*3+2]),isRim=orig[i*3+1]>=cutHeight(sourceA)-1,isInner=sourceNormals[i*3+2]<-.5;
   const weight=isInner&&!isRim?(1-T.MathUtils.smoothstep(Math.abs(x),1.6,3.5))*T.MathUtils.smoothstep(y,128.25,129)*(1-T.MathUtils.smoothstep(y,132.5,132.7))*T.MathUtils.smoothstep(z-CZ,3,7):0;
   if(weight>0){p.setZ(i,z-.3*weight);moved++;const zz=p.getZ(i),gap=Math.hypot(x,zz-CZ)-radius(current.collider,y,angle(x,zz));minGap=Math.min(minGap,gap);maxShiftCm=Math.max(maxShiftCm,z-zz);if(zz>z||z-zz>.300001)throw Error('Inner repair exceeds3mm or moves outward');}
   else{unchanged++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])outsideErrors++;}
   if(!isInner){outerVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])outerErrors++;}
   if(isRim){rimVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])rimErrors++;}
   if(p.getX(i)!==x||p.getY(i)!==y||!Number.isFinite(p.getZ(i)))throw Error('Inner repair changed XY or made nonfiniteZ');
  }p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();
 }
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Inner repair changed body');
 if(outsideErrors||outerErrors||rimErrors||minGap<=0)throw Error(`Inner repair check failed: outside=${outsideErrors} outer=${outerErrors} rim=${rimErrors} gap=${minGap}`);
 return {movedInnerVertices:moved,unchangedVertices:unchanged,outsideErrors,outerVertices,outerErrors,rimVertices,rimErrors,minInnerBodyRadialGapCm:minGap,maxInwardShiftCm:maxShiftCm,bodyBufferUnchanged:true,upperFitValidated:false};
}
function garmentProfile(){
 const grid=new Float64Array(NY*NA),counts=new Uint32Array(NY*NA);
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),row=Math.round((y-Y0)/(Y1-Y0)*(NY-1));if(row<0||row>=NY)continue;const a=Math.round(angle(x,z))%NA,k=row*NA+a;grid[k]+=Math.hypot(x,z-CZ);counts[k]++;}}
 for(let i=0;i<grid.length;i++)if(counts[i])grid[i]/=counts[i];return {grid:fillSmooth(grid,8),counts};
}
function fitLower(current){
 const mean=garmentProfile(),bodyBefore=body.geometry.attributes.position.array.slice();let active=0,upperVertices=0,upperErrors=0,inactive=0,inactiveErrors=0,yErrors=0,minGap=Infinity,negativeBefore=0,negativeAfter=0,newlyNegative=0,worsenedNegative=0,maxInwardCm=0,maxOutwardCm=0;const worst=[];
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,prior=p.array.slice(),orig=mesh.userData.original;
  for(let i=0;i<p.count;i++){const x=prior[i*3],y=prior[i*3+1],z=prior[i*3+2],oy=orig[i*3+1],a=angle(x,z),r=Math.hypot(x,z-CZ),weight=1-T.MathUtils.smoothstep(oy,108,116),delta=(radius(current.tight,y,a)+.7-radius(mean,y,a))*weight;
   if(weight>0){const nextR=r+delta;p.setXYZ(i,x*nextR/r,y,CZ+(z-CZ)*nextR/r);active++;const oldGap=r-radius(current.collider,y,a),newX=p.getX(i),newZ=p.getZ(i),gap=Math.hypot(newX,newZ-CZ)-radius(current.collider,y,angle(newX,newZ));minGap=Math.min(minGap,gap);if(oldGap<0)negativeBefore++;if(gap<0)negativeAfter++;if(oldGap>=0&&gap<0)newlyNegative++;if(oldGap<0&&gap<oldGap-.00001)worsenedNegative++;maxInwardCm=Math.max(maxInwardCm,-delta);maxOutwardCm=Math.max(maxOutwardCm,delta);worst.push({i,originalY:oy,y,angleDegrees:a/NA*360,weight,oldGapCm:oldGap,newGapCm:gap,deltaCm:delta});}
   else {inactive++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==prior[i*3+c])inactiveErrors++;}
   if(oy>=116){upperVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==prior[i*3+c])upperErrors++;}
   if(p.getY(i)!==y)yErrors++;if(!Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)))throw Error('Nonfinite lowerfit coordinate');
  }
  for(const {source,check} of mesh.userData.inputChecks)for(let i=0;i<source.length;i++)if(source[i]!==check[i])throw Error('Lowerfit changed immutableinput');
  p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();
 }
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Lowerfit changed body');
 const result={activeVertices:active,inactiveVertices:inactive,inactiveErrors,upperVertices,upperErrors,yErrors,minMovedRegionRadialGapCm:minGap,negativeBefore,negativeAfter,newlyNegative,worsenedNegative,maxInwardCm,maxOutwardCm,bodyBufferUnchanged:true,inputPositionIndexUVUnchanged:true,upperFitValidated:false,worst:worst.sort((a,b)=>a.newGapCm-b.newGapCm).slice(0,8)};
 if(inactiveErrors||upperErrors||yErrors||newlyNegative||worsenedNegative){console.error('LOWER_TRACE '+JSON.stringify(result));throw Error('Lowerfit preservation or radialclearance regression');}return result;
}
function lowerThicknessGuard(current){
 const bodyBefore=body.geometry.attributes.position.array.slice();let moved=0,upperVertices=0,upperErrors=0,outerVertices=0,outerErrors=0,yErrors=0,maxShiftCm=0,minGap=Infinity;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,before=p.array.slice(),o=mesh.userData.original,n=mesh.userData.sourceNormals;
  for(let i=0;i<p.count;i++){const x=before[i*3],y=before[i*3+1],z=before[i*3+2],oy=o[i*3+1],sourceR=Math.hypot(o[i*3],o[i*3+2]-CZ),dot=(n[i*3]*o[i*3]+n[i*3+2]*(o[i*3+2]-CZ))/sourceR,weight=T.MathUtils.smoothstep(-dot,.4,.8)*(1-T.MathUtils.smoothstep(oy,108,116));
   if(weight>0){const r=Math.hypot(x,z-CZ),shift=.08*weight,rr=r-shift;p.setXYZ(i,x*rr/r,y,CZ+(z-CZ)*rr/r);moved++;maxShiftCm=Math.max(maxShiftCm,r-Math.hypot(p.getX(i),p.getZ(i)-CZ));const gap=Math.hypot(p.getX(i),p.getZ(i)-CZ)-radius(current.collider,y,angle(p.getX(i),p.getZ(i)));minGap=Math.min(minGap,gap);}
   if(dot>=0){outerVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])outerErrors++;}
   if(oy>=116){upperVertices++;for(let c=0;c<3;c++)if(p.array[i*3+c]!==before[i*3+c])upperErrors++;}
   if(p.getY(i)!==y)yErrors++;
  }p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();
 }
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Lowerthickness changed body');
 if(upperErrors||outerErrors||yErrors||minGap<=0||maxShiftCm>.080002)throw Error(`Lowerthickness guard failed: upper=${upperErrors} outer=${outerErrors} y=${yErrors} gap=${minGap} shift=${maxShiftCm}`);
 return {movedInnerVertices:moved,maxRadialInwardCm:maxShiftCm,minInnerBodyRadialGapCm:minGap,outerVertices,outerErrors,upperVertices,upperErrors,yErrors,bodyBufferUnchanged:true};
}
function lowerLayerMetrics({yMin=94,yMax=114,step=.5,angular=32}={}){
 const rays=[];let facesCount=0;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,o=mesh.userData.roundReferenceOriginal??mesh.userData.original,ix=mesh.geometry.index,faces=[];
  for(let k=0;k<(ix?.count||p.count);k+=3){const ids=[0,1,2].map(j=>ix?ix.getX(k+j):k+j),v=ids.map(i=>[p.getX(i),p.getY(i),p.getZ(i)]);if(Math.min(...v.map(a=>a[1]))>yMax||Math.max(...v.map(a=>a[1]))<yMin)continue;const [a,b,c]=ids.map(i=>[o[i*3],o[i*3+1],o[i*3+2]]),u=b.map((q,j)=>q-a[j]),w=c.map((q,j)=>q-a[j]),nx=u[1]*w[2]-u[2]*w[1],ny=u[2]*w[0]-u[0]*w[2],nz=u[0]*w[1]-u[1]*w[0],cx=(a[0]+b[0]+c[0])/3,cz=(a[2]+b[2]+c[2])/3-CZ,dot=(nx*cx+nz*cz)/(Math.hypot(nx,ny,nz)*Math.hypot(cx,cz));if(!Number.isFinite(dot)||Math.abs(dot)<.1)continue;faces.push({v,outer:dot>0,minY:Math.min(...v.map(a=>a[1])),maxY:Math.max(...v.map(a=>a[1]))});}facesCount+=faces.length;
  for(let row=0;row<=Math.round((yMax-yMin)/step);row++){const y=yMin+row*step,segments=[];for(const f of faces){if(y<f.minY||y>f.maxY)continue;const points=[];for(let edge=0;edge<3;edge++){const a=f.v[edge],b=f.v[(edge+1)%3];if((a[1]-y)*(b[1]-y)>0||Math.abs(b[1]-a[1])<1e-10)continue;const t=(y-a[1])/(b[1]-a[1]);points.push([a[0]+t*(b[0]-a[0]),a[2]+t*(b[2]-a[2])-CZ]);}if(points.length>=2)segments.push({a:points[0],b:points[points.length-1],outer:f.outer});}
   for(let col=0;col<angular;col++){const angle=col/angular*2*Math.PI,dx=Math.sin(angle),dz=Math.cos(angle);let outer=-Infinity,inner=-Infinity;for(const s of segments){const vx=s.b[0]-s.a[0],vz=s.b[1]-s.a[1],den=dx*vz-dz*vx;if(Math.abs(den)<1e-10)continue;const t=(s.a[0]*dz-s.a[1]*dx)/den,r=(s.a[0]*vz-s.a[1]*vx)/den;if(t<-.000001||t>1.000001||r<=0)continue;if(s.outer)outer=Math.max(outer,r);else inner=Math.max(inner,r);}if(Number.isFinite(outer+inner))rays.push({yCm:y,angleDegrees:col/angular*360,outerRadiusCm:outer,innerRadiusCm:inner,separationCm:outer-inner});}
  }
 }return {samples:rays.length,innerOvertakes:rays.filter(r=>r.separationCm<0).length,minSeparationCm:Math.min(...rays.map(r=>r.separationCm)),facesChecked:facesCount,rays};
}
function compareLowerLayers(before,after){const old=new Map(before.rays.map(r=>[`${r.yCm}:${r.angleDegrees}`,r]));let newlyNegative=0,worsenedInherited=0,missingBaseline=0,insufficientRepairedMargin=0,minRepairedSeparationCm=Infinity;for(const ray of after.rays){const prior=old.get(`${ray.yCm}:${ray.angleDegrees}`);if(!prior){missingBaseline++;continue;}if(prior.separationCm>=0&&ray.separationCm<0)newlyNegative++;if(prior.separationCm<0&&ray.separationCm<prior.separationCm-.00001)worsenedInherited++;if(prior.separationCm<0){minRepairedSeparationCm=Math.min(minRepairedSeparationCm,ray.separationCm);if(ray.separationCm<.005)insufficientRepairedMargin++;}}const result={newlyNegative,worsenedInherited,missingBaseline,insufficientRepairedMargin,minRepairedSeparationCm,beforeOvertakes:before.innerOvertakes,afterOvertakes:after.innerOvertakes,minAfterSeparationCm:after.minSeparationCm};if(newlyNegative||worsenedInherited||missingBaseline||insufficientRepairedMargin)throw Error(`Lower sheet regression: ${JSON.stringify(result)}`);return result;}
function inspectLower(){return tankMeshes.map(mesh=>{const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,o=mesh.userData.roundReferenceOriginal??mesh.userData.original,ids=new Set(),triangles=[];for(let i=0;i<p.count;i++)if(p.getY(i)>90&&p.getY(i)<117)ids.add(i);const selected=new Set(ids),ix=mesh.geometry.index;for(let i=0;i<(ix?.count||p.count);i+=3){const tri=[0,1,2].map(j=>ix?ix.getX(i+j):i+j);if(tri.some(k=>selected.has(k))){triangles.push(tri);for(const k of tri)ids.add(k);}}return {name:mesh.name,vertices:[...ids].map(i=>({i,p:[p.getX(i),p.getY(i),p.getZ(i)],n:[n.getX(i),n.getY(i),n.getZ(i)],o:[o[i*3],o[i*3+1],o[i*3+2]]})),triangles};});}
function lowerTraces(current){const cloth=garmentProfile(),trace=[];for(let y=90;y<=116;y+=.5){const row=Math.round((y-Y0)/(Y1-Y0)*(NY-1)),r={yCm:y};for(const [direction,a] of [['front',0],['side',32],['back',64]]){const body=radius(current.collider,y,a),fabric=radius(cloth,y,a);r[direction]={bodyColliderRadiusCm:body,bodySmoothRadiusCm:radius(current.tight,y,a),clothMeanRadiusCm:fabric,meanRadialGapCm:fabric-body,clothSamplePresent:cloth.counts[row*NA+a]>0};}trace.push(r);}return trace;}
function upperProfiles(current){
 const clothGrid=new Float64Array(NY*NA);
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),row=Math.round((y-Y0)/(Y1-Y0)*(NY-1));if(row<0||row>=NY)continue;const a=Math.round(angle(x,z))%NA,r=Math.hypot(x,z-CZ);clothGrid[row*NA+a]=Math.max(clothGrid[row*NA+a],r);}}
 const cloth={grid:fillSmooth(clothGrid.slice(),0)},result=[];
 for(let y=120;y<=145;y+=.5){const record={yCm:y};for(const [name,a] of [['frontCenter',0],['frontBreast',10],['quarter',16],['side',32]]){record[name]={bodyColliderCm:radius(current.collider,y,a),bodyTightCm:radius(current.tight,y,a),bodyRelaxedHullCm:radius(current,y,a),clothCm:radius(cloth,y,a),clothSamplePresent:clothGrid[Math.round((y-Y0)/(Y1-Y0)*(NY-1))*NA+Math.round(a)%NA]>0,oldMask:T.MathUtils.smoothstep(Math.cos(a/NA*2*Math.PI),.05,.55)*T.MathUtils.smoothstep(y,98,105)*(1-T.MathUtils.smoothstep(y,127,131))};}result.push(record);}return result;
}
function hideApprovedTop(){scene.three.traverse(mesh=>{if(!mesh.isSkinnedMesh||mesh===body)return;const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];if(!mats.some(m=>m.name==='bikini'))return;const box=new T.Box3().setFromObject(mesh);if(box.max.y>110)mesh.visible=false;});}
async function init(){
 for(let i=0;i<6&&!document.querySelector('[data-action="sarahlab:outfit"]').textContent.endsWith('bikini');i++)click('outfit');
 click('body-reset-all');click('stand');slide('sarahlab-bump',0);slide('sarahlab-arms',0);tick();
 scene.three.traverse(n=>{if(n.isSkinnedMesh&&n.geometry.getAttribute('_cloth_cover'))body=n;});if(!body)throw Error('No v2 body');
 baseProfile=profile();
 // Exact immutable material index measured from the approved GLB authoring
 // world transform joint0World*inverseBind0: [-1.49e-8,1.01190675,.21553268]m.
 // Nearest to x0/Y1.012m by .093mm. Posed coordinates are read per frame.
 navelAnchor=22088;if(body.geometry.attributes.position.count<=navelAnchor)throw Error('Approved navel material index unavailable');
 const imported=(await new GLTFLoader().loadAsync('/@fs/tmp/sarah-meshy-tank.glb')).scene;imported.updateMatrixWorld(true);
 imported.traverse(n=>{if(!n.isMesh)return;const geometry=n.geometry.clone(),p=geometry.attributes.position,v=new T.Vector3();const groups=new Map();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld);p.setXYZ(i,v.x*45,v.y*26.8+117.5,v.z*45-6);const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e4)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}geometry.computeVertexNormals();const material=n.material.clone();material.side=T.DoubleSide;if(material.normalScale)material.normalScale.multiplyScalar(.4);const mesh=new T.Mesh(geometry,material);mesh.name='Meshy tank spandex fit preview';mesh.userData.sourceNormals=geometry.attributes.normal.array.slice();mesh.userData.original=p.array.slice();mesh.userData.originalCheck=p.array.slice();mesh.userData.inputChecks=[n.geometry.attributes.position.array,n.geometry.attributes.uv?.array,n.geometry.index?.array].filter(Boolean).map(source=>({source,check:source.slice()}));mesh.userData.sourcePosition=n.geometry.attributes.position.array;mesh.userData.sourceCheck=n.geometry.attributes.position.array.slice();mesh.userData.normalMaterial=material;mesh.userData.neutralMaterial=new T.MeshStandardMaterial({color:0xdddddd,roughness:.85,metalness:0,side:T.DoubleSide});mesh.userData.baseGeometry=geometry.clone();mesh.userData.baseSourceNormals=mesh.userData.sourceNormals.slice();mesh.userData.originalNormalMap=material.normalMap;mesh.userData.normalGroups=[...groups.values()];scene.three.add(mesh);tankMeshes.push(mesh);});
 const shirtGrid=new Float64Array(NY*NA),counts=new Uint32Array(NY*NA);for(const mesh of tankMeshes){const p=mesh.userData.original;for(let i=0;i<p.length;i+=3){const y=Math.max(0,Math.min(NY-1,Math.round((p[i+1]-Y0)/(Y1-Y0)*(NY-1)))),a=Math.round(angle(p[i],p[i+2]))%NA,k=y*NA+a;shirtGrid[k]+=Math.hypot(p[i],p[i+2]-CZ);counts[k]++;}}for(let i=0;i<shirtGrid.length;i++)if(counts[i])shirtGrid[i]/=counts[i];shirtProfile={grid:fillSmooth(shirtGrid,8)};
 for(let a=0;a<NA;a++)upperCut.push(-Infinity);
 for(const mesh of tankMeshes){const o=mesh.userData.original;for(let i=0;i<o.length;i+=3){const a=Math.round(angle(o[i],o[i+2]))%NA;upperCut[a]=Math.max(upperCut[a],o[i+1]);}}
 hideApprovedTop();ready=true;
}
function inspectChest(){return tankMeshes.map(mesh=>{const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,o=mesh.userData.original,uv=mesh.geometry.attributes.uv,ids=new Set(),triangles=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<6&&p.getY(i)>128&&p.getY(i)<134&&p.getZ(i)>0)ids.add(i);const selected=new Set(ids),ix=mesh.geometry.index;for(let i=0;i<(ix?.count||p.count);i+=3){const tri=[0,1,2].map(j=>ix?ix.getX(i+j):i+j);if(tri.some(k=>selected.has(k))){triangles.push(tri);for(const k of tri)ids.add(k);}}return {name:mesh.name,vertices:[...ids].map(i=>({i,p:[p.getX(i),p.getY(i),p.getZ(i)],n:[n.getX(i),n.getY(i),n.getZ(i)],o:[o[i*3],o[i*3+1],o[i*3+2]],uv:uv?[uv.getX(i),uv.getY(i)]:null})),triangles};});}
function navelPoint(){const v=new T.Vector3();body.getVertexPosition(navelAnchor,v);body.localToWorld(v);return v;}
function setOutfit(leggings){const suffix=leggings==='high'?'tee + leggings':leggings==='low'?'top + low leggings':'bikini';for(let i=0;i<7&&!document.querySelector('[data-action="sarahlab:outfit"]').textContent.endsWith(suffix);i++)click('outfit');if(!document.querySelector('[data-action="sarahlab:outfit"]').textContent.endsWith(suffix))throw Error('Outfit unavailable: '+suffix);tick();}
function showImportedOutfit(leggings){
 const chosen=leggings==='high'?'leggings':leggings==='low'?'leggingsLow':'bikini';
 // The imported cut does not match the grown shirt's coverage; keep only the
 // chosen lower garment's existing hide mask. Restore all source indices before
 // applying that mask, without writing any immutable index array.
 const all=body.userData.allIndices,cover=body.geometry.getAttribute('_cloth_cover');
 if(all&&cover){const bits=body.userData.coverBits??Uint8Array.from({length:cover.count},(_,i)=>cover.getX(i));body.geometry.setIndex(new T.BufferAttribute(uncoveredSkinIndices(all,bits,coverMask([chosen])),1));body.userData.coverMask=-100;}
 scene.three.traverse(mesh=>{
  if(!mesh.isSkinnedMesh||mesh===body)return;const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  if(materials.some(m=>/^shirt(Athletic)?(Trim.*)?$/.test(m.name)))mesh.visible=false;
  if(mesh.geometry.getAttribute('_under_top')&&mesh.userData.allIndices){mesh.geometry.setIndex(new T.BufferAttribute(Uint32Array.from(mesh.userData.allIndices),1));mesh.userData.coverMask=-100;}
 });hideApprovedTop();
}
function gridField({cx=0,cy=130,radius=10,spacing=.2}={}){
 const n=Math.round(radius*2/spacing)+1,grid=new Float64Array(n*n),counts=new Uint32Array(n*n),outer=new Float64Array(n*n).fill(-Infinity),inner=new Float64Array(n*n).fill(-Infinity),loX=cx-radius,loY=cy-radius;let centerHits=0;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,o=mesh.userData.original,ix=mesh.geometry.index;for(let k=0;k<(ix?.count||p.count);k+=3){const ids=[0,1,2].map(j=>ix?ix.getX(k+j):k+j),v=ids.map(i=>[p.getX(i),p.getY(i),p.getZ(i)]),q=ids.map(i=>[o[i*3],o[i*3+1],o[i*3+2]]),sourceX=(q[0][0]+q[1][0]+q[2][0])/3,sourceZ=(q[0][2]+q[1][2]+q[2][2])/3-CZ;
  if(sourceZ/Math.hypot(sourceX,sourceZ)<.65)continue;
  const minX=Math.min(...v.map(q=>q[0])),maxX=Math.max(...v.map(q=>q[0])),minY=Math.min(...v.map(q=>q[1])),maxY=Math.max(...v.map(q=>q[1]));if(maxX<loX||minX>cx+radius||maxY<loY||minY>cy+radius)continue;
  const [a,b,c]=v,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;
  const normalZ=(q[1][0]-q[0][0])*(q[2][1]-q[0][1])-(q[1][1]-q[0][1])*(q[2][0]-q[0][0]),sheet=normalZ>=0?outer:inner;
  function hit(x,y){const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,w=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,t=1-u-w;return u>=-1e-7&&w>=-1e-7&&t>=-1e-7?u*a[2]+w*b[2]+t*c[2]:null;}
  if(hit(cx,cy)!==null)centerHits++;
  for(let row=Math.max(0,Math.ceil((minY-loY)/spacing));row<=Math.min(n-1,Math.floor((maxY-loY)/spacing));row++)for(let col=Math.max(0,Math.ceil((minX-loX)/spacing));col<=Math.min(n-1,Math.floor((maxX-loX)/spacing));col++){const z=hit(loX+col*spacing,loY+row*spacing);if(z!==null){const idx=row*n+col;sheet[idx]=Math.max(sheet[idx],z);}}
 }}
 for(let k=0;k<grid.length;k++){if(Number.isFinite(outer[k]+inner[k])){grid[k]=(outer[k]+inner[k])/2;counts[k]=2;}else if(Number.isFinite(outer[k])){grid[k]=outer[k];counts[k]=1;}else if(Number.isFinite(inner[k])){grid[k]=inner[k];counts[k]=1;}}
 const directCounts=counts.slice();
 for(let pass=0;pass<n*2;pass++){let missing=0;const next=grid.slice(),cn=counts.slice();for(let y=0;y<n;y++)for(let x=0;x<n;x++){const k=y*n+x;if(counts[k])continue;let total=0,num=0;for(const j of[y?k-n:-1,y<n-1?k+n:-1,x?k-1:-1,x<n-1?k+1:-1])if(j>=0&&counts[j]){total+=grid[j];num++;}if(num){next[k]=total/num;cn[k]=1;}else missing++;}grid.set(next);counts.set(cn);if(!missing)break;}
 function sample(x,y,array=grid){const xx=T.MathUtils.clamp((x-loX)/spacing,0,n-1),yy=T.MathUtils.clamp((y-loY)/spacing,0,n-1),a=Math.min(n-2,Math.floor(xx)),b=Math.min(n-2,Math.floor(yy));return T.MathUtils.lerp(T.MathUtils.lerp(array[b*n+a],array[b*n+a+1],xx-a),T.MathUtils.lerp(array[(b+1)*n+a],array[(b+1)*n+a+1],xx-a),yy-b);}
 return {grid,n,spacing,loX,loY,cx,cy,radius,sample,counts,directCounts,centerHits,outer,inner};
}
function upperFixedThicknessGuard(){let moved=0,maxShiftCm=0,outerErrors=0,rimErrors=0;for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,o=mesh.userData.original,n=mesh.userData.sourceNormals,prior=p.array.slice();for(let i=0;i<p.count;i++){const x=prior[i*3],y=prior[i*3+1],z=prior[i*3+2],ox=o[i*3],oy=o[i*3+1],oz=o[i*3+2],sourceR=Math.hypot(ox,oz-CZ),sourceA=angle(ox,oz),cos=(oz-CZ)/sourceR,dot=(n[i*3]*ox+n[i*3+2]*(oz-CZ))/sourceR,collar=1-T.MathUtils.smoothstep(oy,cutHeight(sourceA)-3.2,cutHeight(sourceA)-1),front=T.MathUtils.smoothstep(cos,.05,.4),shoulder=T.MathUtils.smoothstep(Math.abs(ox),10,13)*(1-T.MathUtils.smoothstep(Math.abs(ox),21,25))*T.MathUtils.smoothstep(oy,129,132)*(1-T.MathUtils.smoothstep(oy,142,146)),center=(1-T.MathUtils.smoothstep(Math.abs(ox),3,5))*T.MathUtils.smoothstep(oy,128.5,129.5)*(1-T.MathUtils.smoothstep(oy,132,134)),weight=T.MathUtils.smoothstep(-dot,.1,.5)*Math.sqrt(Math.max(shoulder,center)*collar*front),shift=.14*weight;if(shift){const r=Math.hypot(x,z-CZ),rr=r-shift;p.setXYZ(i,x*rr/r,y,CZ+(z-CZ)*rr/r);moved++;maxShiftCm=Math.max(maxShiftCm,r-Math.hypot(p.getX(i),p.getZ(i)-CZ));}if(dot>=0)for(let c=0;c<3;c++)if(p.array[i*3+c]!==prior[i*3+c])outerErrors++;if(oy>=cutHeight(sourceA)-1)for(let c=0;c<3;c++)if(p.array[i*3+c]!==prior[i*3+c])rimErrors++;if(p.getY(i)!==y)throw Error('Upper guard changedY');}p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();}if(outerErrors||rimErrors||maxShiftCm>.140002)throw Error('Upper guard preservation failure');return {movedInnerVertices:moved,maxInwardRadialCm:maxShiftCm,outerErrors,rimErrors,visibleOuterFitUnchanged:true};}function upperThicknessGuard(current,baseline){
 const fixed=upperFixedThicknessGuard(),states=tankMeshes.map(mesh=>({mesh,original:mesh.geometry.attributes.position.array.slice()})),history=[];let extra=0,extraMoved=0,maxExtra=0,minAdaptiveBodyGapCm=Infinity;
 // Successful fixed-guard frames stay byte-identical. Only a measured newly
 // introduced/worsened crossing activates the bounded additional inner field.
 for(let trial=0;trial<5;trial++){
  const comparison=comparePolishLayers(baseline,lowerLayerMetrics({yMin:128,yMax:146}),false);history.push({trial,additionalStrengthCm:extra,...comparison});if(!comparison.newlyNegative&&!comparison.worsenedInherited)return {...fixed,adaptiveTrials:history,additionalStrengthCm:extra,additionalMovedInnerVertices:extraMoved,maxAdditionalInwardCm:maxExtra,minAdaptiveBodyGapCm,visibleOuterFitUnchanged:true};
  if(trial===4||extra>=.159999)throw Error('Bounded upper inner guard unable to repair: '+JSON.stringify(history));
  const needed=Math.max(...comparison.regressions.map(r=>r.baselineSeparationCm>=0?.005-r.separationCm:r.baselineSeparationCm-r.separationCm+.005));extra=Math.min(.16,Math.max(extra+.025,extra+needed*1.5));extraMoved=0;maxExtra=0;minAdaptiveBodyGapCm=Infinity;
  for(const {mesh,original} of states){const p=mesh.geometry.attributes.position,o=mesh.userData.original,n=mesh.userData.sourceNormals;p.array.set(original);for(let i=0;i<p.count;i++){const x=original[i*3],y=original[i*3+1],z=original[i*3+2],ox=o[i*3],oy=o[i*3+1],oz=o[i*3+2],sourceR=Math.hypot(ox,oz-CZ),sourceA=angle(ox,oz),cos=(oz-CZ)/sourceR,dot=(n[i*3]*ox+n[i*3+2]*(oz-CZ))/sourceR,collar=1-T.MathUtils.smoothstep(oy,cutHeight(sourceA)-3.2,cutHeight(sourceA)-1),front=T.MathUtils.smoothstep(cos,.05,.4),shoulder=T.MathUtils.smoothstep(Math.abs(ox),10,13)*(1-T.MathUtils.smoothstep(Math.abs(ox),21,25))*T.MathUtils.smoothstep(oy,129,132)*(1-T.MathUtils.smoothstep(oy,142,146)),center=(1-T.MathUtils.smoothstep(Math.abs(ox),3,5))*T.MathUtils.smoothstep(oy,128.5,129.5)*(1-T.MathUtils.smoothstep(oy,132,134)),weight=T.MathUtils.smoothstep(-dot,.1,.5)*Math.sqrt(Math.max(shoulder,center)*collar*front),r=Math.hypot(x,z-CZ),oldGap=r-radius(current.collider,y,angle(x,z)),shift=Math.min(extra*weight,Math.max(0,oldGap-.05));if(shift){const rr=r-shift;p.setXYZ(i,x*rr/r,y,CZ+(z-CZ)*rr/r);const gap=Math.hypot(p.getX(i),p.getZ(i)-CZ)-radius(current.collider,y,angle(p.getX(i),p.getZ(i)));if((oldGap>=0&&gap<0)||(oldGap<0&&gap<oldGap-.00001))throw Error('Adaptive upper guard worsened body clearance');minAdaptiveBodyGapCm=Math.min(minAdaptiveBodyGapCm,gap);extraMoved++;maxExtra=Math.max(maxExtra,r-Math.hypot(p.getX(i),p.getZ(i)-CZ));}if(dot>=0||oy>=cutHeight(sourceA)-1){for(let c=0;c<3;c++)if(p.array[i*3+c]!==original[i*3+c])throw Error('Adaptive upper guard changed outer/rim');}if(p.getY(i)!==y||!Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)))throw Error('Adaptive upper guard invalid coordinate');}p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();}
 }
}

function polishUpper(current){
 const originalMean=garmentProfile(),smooth={grid:fillSmooth(originalMean.grid.slice(),96)},bodyBefore=body.geometry.attributes.position.array.slice();let moved=0,shoulder=0,center=0,maxShift=0,minGap=Infinity,outsideErrors=0,rimErrors=0,yErrors=0,newNegative=0,worseNegative=0;
 for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,o=mesh.userData.original,prior=p.array.slice();for(let i=0;i<p.count;i++){const x=prior[i*3],y=prior[i*3+1],z=prior[i*3+2],ox=o[i*3],oy=o[i*3+1],oz=o[i*3+2],a=angle(x,z),sa=angle(ox,oz),cos=(oz-CZ)/Math.hypot(ox,oz-CZ),rim=oy>=cutHeight(sa)-1;
  const collar=1-T.MathUtils.smoothstep(oy,cutHeight(sa)-3.2,cutHeight(sa)-1),front=T.MathUtils.smoothstep(cos,.05,.4),shoulderW=T.MathUtils.smoothstep(Math.abs(ox),10,13)*(1-T.MathUtils.smoothstep(Math.abs(ox),21,25))*T.MathUtils.smoothstep(oy,129,132)*(1-T.MathUtils.smoothstep(oy,142,146)),centerW=(1-T.MathUtils.smoothstep(Math.abs(ox),3,5))*T.MathUtils.smoothstep(oy,128.5,129.5)*(1-T.MathUtils.smoothstep(oy,132,134)),weight=Math.max(shoulderW,centerW)*collar*front,r=Math.hypot(x,z-CZ),deficit=Math.max(0,radius(smooth,y,a)-radius(originalMean,y,a)),delta=.9*Math.tanh(deficit/.9)*weight;
  if(delta>0){const rr=r+delta;p.setXYZ(i,x*rr/r,y,CZ+(z-CZ)*rr/r);moved++;if(shoulderW>centerW)shoulder++;else center++;const gap=Math.hypot(p.getX(i),p.getZ(i)-CZ)-radius(current.collider,y,angle(p.getX(i),p.getZ(i))),old=r-radius(current.collider,y,a);minGap=Math.min(minGap,gap);if(old>=0&&gap<0)newNegative++;if(old<0&&gap<old-.00001)worseNegative++;maxShift=Math.max(maxShift,Math.hypot(p.getX(i),p.getZ(i)-CZ)-r);}else for(let c=0;c<3;c++)if(p.array[i*3+c]!==prior[i*3+c])outsideErrors++;
  if(rim)for(let c=0;c<3;c++)if(p.array[i*3+c]!==prior[i*3+c])rimErrors++;if(p.getY(i)!==y)yErrors++;if(!Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)))throw Error('Nonfinite upper polish');
 }p.needsUpdate=true;smoothNormals(mesh);mesh.geometry.computeBoundingSphere();}
 for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Upper polish changed body');if(outsideErrors||rimErrors||yErrors||newNegative||worseNegative)throw Error('Upper polish preservation/clearance regression');return {movedVertices:moved,shoulderVertices:shoulder,centerVertices:center,maxRadialShiftCm:maxShift,minMovedRegionBodyEnvelopeGapCm:minGap,outsideErrors,rimErrors,yErrors,newNegative,worseNegative,bodyBufferUnchanged:true,sharedOutwardField:true};
}
function comparePolishLayers(before,after,strict=true){const baseline=new Map(before.rays.map(r=>[`${r.yCm}:${r.angleDegrees}`,r]));let newlyNegative=0,worsenedInherited=0,missing=0;const regressions=[];for(const r of after.rays){const old=baseline.get(`${r.yCm}:${r.angleDegrees}`);if(!old){missing++;continue;}const isNew=old.separationCm>=0&&r.separationCm<0,isWorse=old.separationCm<0&&r.separationCm<old.separationCm-.00001;if(isNew)newlyNegative++;if(isWorse)worsenedInherited++;if(isNew||isWorse)regressions.push({...r,baselineSeparationCm:old.separationCm,newCrossing:isNew});}const result={beforeOvertakes:before.innerOvertakes,afterOvertakes:after.innerOvertakes,samples:after.samples,minSeparationCm:after.minSeparationCm,newlyNegative,worsenedInherited,missing,regressions};if(strict&&(newlyNegative||worsenedInherited))throw Error('Upper polish shell regression: '+JSON.stringify(result));return result;}

function immutableCheck(){let checked=0;for(const mesh of tankMeshes){for(const {source,check} of mesh.userData.inputChecks){for(let i=0;i<source.length;i++)if(source[i]!==check[i])throw Error('Source GLB changed');checked++;}const o=mesh.userData.original,c=mesh.userData.originalCheck;for(let i=0;i<o.length;i++)if(o[i]!==c[i])throw Error('Source affine buffer changed');}return {checkedBuffers:checked,inputPositionIndexUVUnchanged:true};}
function inspectRegion({yMin=90,yMax=145,xMax=30,frontOnly=true}={}){return tankMeshes.map(mesh=>{const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,o=mesh.userData.roundReferenceOriginal??mesh.userData.original,selected=new Set();for(let i=0;i<p.count;i++)if(p.getY(i)>=yMin&&p.getY(i)<=yMax&&Math.abs(p.getX(i))<=xMax&&(!frontOnly||p.getZ(i)>CZ))selected.add(i);const ids=new Set(selected),triangles=[],ix=mesh.geometry.index;for(let i=0;i<(ix?.count||p.count);i+=3){const tri=[0,1,2].map(j=>ix?ix.getX(i+j):i+j);if(tri.some(k=>selected.has(k))){triangles.push(tri);for(const k of tri)ids.add(k);}}return {name:mesh.name,vertices:[...ids].map(i=>({i,p:[p.getX(i),p.getY(i),p.getZ(i)],n:[n.getX(i),n.getY(i),n.getZ(i)],o:[o[i*3],o[i*3+1],o[i*3+2]]})),triangles};});}
function bodyWorldData(){const p=body.geometry.attributes.position,v=new T.Vector3(),positions=new Float64Array(p.count*3),si=body.geometry.attributes.skinIndex,sw=body.geometry.attributes.skinWeight,armBones=body.skeleton.bones.map(b=>{b.getWorldPosition(v);return Math.abs(v.x)>13&&v.y>60;}),armWeights=new Float32Array(p.count);for(let i=0;i<p.count;i++){body.getVertexPosition(i,v);body.localToWorld(v);positions.set([v.x,v.y,v.z],i*3);for(let j=0;j<4;j++)if(armBones[si.getComponent(i,j)])armWeights[i]+=sw.getComponent(i,j);}const indices=Uint32Array.from(body.userData.allIndices??body.geometry.index.array),armTriangles=[];for(let k=0;k<indices.length;k+=3)if((armWeights[indices[k]]+armWeights[indices[k+1]]+armWeights[indices[k+2]])/3>.35)armTriangles.push(k/3);return {positions,indices,armTriangles,armWeights};}

function restoreBaseGarments(){for(const mesh of tankMeshes){const old=mesh.geometry;mesh.geometry=mesh.userData.baseGeometry.clone();if(old!==mesh.userData.baseGeometry)old.dispose();mesh.userData.sourceNormals=mesh.userData.baseSourceNormals.slice();delete mesh.userData.roundReferenceOriginal;const o=mesh.userData.original,n=mesh.userData.sourceNormals,side=new Float32Array(o.length/3);for(let i=0;i<side.length;i++){const x=o[i*3],oy=o[i*3+1],y=oy-117.5,z=o[i*3+2]-CZ,use3D=oy>=134&&Math.abs(x)>=10,r=use3D?Math.hypot(x,y,z):Math.hypot(x,z),dot=(n[i*3]*x+(use3D?n[i*3+1]*y:0)+n[i*3+2]*z)/r;side[i]=Math.abs(dot)<.1?0:dot>0?1:-1;}mesh.userData.shellSide=side;mesh.visible=true;}}
function weldRenderNormals(mesh){mesh.geometry.computeVertexNormals();const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,groups=new Map();for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e4)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}for(const ids of groups.values()){if(ids.length<2)continue;let x=0,y=0,z=0;for(const i of ids){x+=n.getX(i);y+=n.getY(i);z+=n.getZ(i);}const r=Math.hypot(x,y,z)||1;for(const i of ids)n.setXYZ(i,x/r,y/r,z/r);}n.needsUpdate=true;}
function clothBaseline(reference){const [cx,cy]=reference.center,field=gridField({cx,cy,radius:9,spacing:.15}),ring=[];for(let row=0;row<field.n;row++)for(let col=0;col<field.n;col++){const x=field.loX+col*field.spacing,y=field.loY+row*field.spacing,r=Math.hypot(x-cx,y-cy),z=field.outer[row*field.n+col];if(r>=5.5&&r<=8&&Number.isFinite(z))ring.push([x,y,z]);}if(!field.centerHits)return {covered:false,ringSamples:ring.length};const fit=fitQuadric(ring,cx,cy),angles=new Set(ring.map(([x,y])=>Math.floor((Math.atan2(y-cy,x-cx)+Math.PI)/(2*Math.PI)*16))),offsets=ring.map(([x,y,z])=>z-reference.surface(x,y)).sort((a,b)=>a-b),median=offsets[Math.floor(offsets.length/2)],partial=angles.size<14,surface=partial?((x,y)=>reference.surface(x,y)+median):fit.sample;return {covered:true,surface,ringSamples:ring.length,ringAngularBins:angles.size,partialHemCoverage:partial,medianBareBodyOffsetCm:median,centerBaselineCm:surface(cx,cy),baselineCoefficients:partial?null:fit.coefficients};}
function layerRayLocation(ray){const a=ray.angleDegrees*Math.PI/180,dx=Math.sin(a),dz=Math.cos(a),hits={outer:null,inner:null};for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,o=mesh.userData.roundReferenceOriginal??mesh.userData.original,ix=mesh.geometry.index.array;for(let k=0;k<ix.length;k+=3){const ids=[ix[k],ix[k+1],ix[k+2]],v=ids.map(i=>[p.getX(i),p.getY(i),p.getZ(i)]),q=ids.map(i=>Array.from(o.slice(i*3,i*3+3)));if(ray.yCm<Math.min(...v.map(q=>q[1]))||ray.yCm>Math.max(...v.map(q=>q[1])))continue;const u=q[1].map((x,j)=>x-q[0][j]),w=q[2].map((x,j)=>x-q[0][j]),n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],cx=q.reduce((s,p)=>s+p[0],0)/3,cz=q.reduce((s,p)=>s+p[2],0)/3-CZ,dot=(n[0]*cx+n[2]*cz)/(Math.hypot(...n)*Math.hypot(cx,cz));if(Math.abs(dot)<.1)continue;const points=[];for(let e=0;e<3;e++){const aa=v[e],bb=v[(e+1)%3];if((aa[1]-ray.yCm)*(bb[1]-ray.yCm)>0||Math.abs(bb[1]-aa[1])<1e-10)continue;const t=(ray.yCm-aa[1])/(bb[1]-aa[1]);points.push({p:[aa[0]+t*(bb[0]-aa[0]),aa[2]+t*(bb[2]-aa[2])-CZ],o:q[e].map((x,j)=>x+t*(q[(e+1)%3][j]-x))});}if(points.length<2)continue;const aa=points[0],bb=points.at(-1),vx=bb.p[0]-aa.p[0],vz=bb.p[1]-aa.p[1],den=dx*vz-dz*vx;if(Math.abs(den)<1e-10)continue;const t=(aa.p[0]*dz-aa.p[1]*dx)/den,r=(aa.p[0]*vz-aa.p[1]*vx)/den;if(t<0||t>1||r<=0)continue;const side=dot>0?'outer':'inner';if(hits[side]&&hits[side].radiusCm>=r)continue;const sourcePoint=aa.o.map((x,j)=>x+t*(bb.o[j]-x));hits[side]={radiusCm:r,point:[r*dx,ray.yCm,CZ+r*dz],sourcePoint,sourceYRange:[Math.min(...q.map(v=>v[1])),Math.max(...q.map(v=>v[1]))],coreVertices:q.filter(v=>Math.abs(v[0])>=8&&Math.abs(v[0])<=25&&v[1]>=140).length,fieldVertices:q.filter(v=>Math.abs(v[0])>=8&&Math.abs(v[0])<=25&&v[1]>137).length};}}return {...ray,hits};}
function navelGeometryStamp(){let hash=2166136261,vertices=0;for(const mesh of tankMeshes){const p=mesh.geometry.attributes.position,words=new Uint32Array(p.array.buffer,p.array.byteOffset,p.array.length);for(let i=0;i<p.count;i++){if(p.getY(i)<85||p.getY(i)>116||p.getZ(i)<=-6)continue;vertices++;for(let d=0;d<3;d++){hash^=words[i*3+d];hash=Math.imul(hash,16777619)>>>0;}}}return {hash:hash.toString(16).padStart(8,'0'),vertices,scope:'existing front garment vertices worldY85–116cm'};}
let transitionReference=null;
window.tankPreview={applyNavelTransition({enabled=true}={}){if(!transitionReference)throw Error("Render the baseline before the navel trial");return softenNavelTransition(tankMeshes,{enabled,center:transitionReference});},setReviewFrozenTicks(value){reviewFrozenTicks=!!value;return {frozen:reviewFrozenTicks};},inspectSpandexSpot(){return inspectSpot(tankMeshes);},inspectHighHemOcclusion(){return inspectHighHemOcclusion(scene.three);},inspectLower,inspectChest,inspectRegion,ready:()=>ready,bodyWorldData,inspectGarment(){return tankMeshes.map(mesh=>({positions:Array.from(mesh.geometry.attributes.position.array),indices:Array.from(mesh.geometry.index.array),shellSide:Array.from(mesh.userData.shellSide),source:Array.from(mesh.userData.roundReferenceOriginal??mesh.userData.original)}));},async render({bump=100,fitStyle='spandex',leggings='high',polish=true,full=false,closeup=false,navelCloseup=false,shoulderCloseup=false,normalMap=true,neutral=false,freeze=false,frontSide=false,bare=false,dome=true,collision=true,strictClearance=true,contactFaces=true,shoulderContact=collision,domeProfile='rounded',backEdgeCleanup=true,leggingsOcclusion=true,highHemCorrection=false,pantsNormals='delta',preserveBellyContour=false,softSpandexHem=false,repairSpandexSpot=false}={}){
 console.time('ROUND_FRAME');restoreNavelTransition(tankMeshes);restoreSpotShading(tankMeshes);const hemShadingRestoration=restoreHemShading(tankMeshes);const spotRestoration=restoreInnerSpot(tankMeshes);const contourRestoration=restoreBellyContour(tankMeshes);resetHighHemOcclusion(scene.three);const highHemRestoration=restoreHighHemCorrections(scene.three);resetHighLeggingsMasks(scene.three);restoreBaseGarments();setOutfit('bikini');if(!freeze)slide('sarahlab-bump',bump);tick();const current=profile(),bareNavel=navelPoint().toArray(),bareData=bodyWorldData(),reference=measureBareNavel(bareData.positions,bareData.indices,bareNavel);let stats={hemShadingRestoration,spotRestoration,bellyContourRestoration:contourRestoration,highHem:{enabled:highHemCorrection,restoration:highHemRestoration},bareReference:{...reference,surface:undefined},inputBuffers:immutableCheck()};
 transitionReference=bareNavel.slice();let finalShadingCollider=null;
 if(!bare){console.time('ROUND_FIT');Object.assign(stats,fitStyle==='relaxed'?fitRelaxed(current):fit(current));if(fitStyle==='spandex'){stats.bustCorrection=roundedBust(current);stats.chestCorrection=smoothChest(current);stats.shellCorrection=repairInnerLip(current);stats.lowerLayersBefore=lowerLayerMetrics();stats.lowerCorrection=fitLower(current);stats.lowerThickness=lowerThicknessGuard(current);stats.lowerLayersAfter=lowerLayerMetrics();stats.lowerSheetComparison=compareLowerLayers(stats.lowerLayersBefore,stats.lowerLayersAfter);}const upperBefore=lowerLayerMetrics({yMin:128,yMax:146});if(polish){stats.upperPolish=polishUpper(current);stats.upperShellGuard=upperThicknessGuard(current,upperBefore);}stats.beforeContactUpperSheetComparison=comparePolishLayers(upperBefore,lowerLayerMetrics({yMin:128,yMax:146}));
  console.timeEnd('ROUND_FIT');const baseline=clothBaseline(reference);console.time('ROUND_DOME');stats.clothBaseline={...baseline,surface:undefined};const navelDecision=navelPolicy({fitStyle,dome,covered:baseline.covered,outward:reference.outward});if(navelDecision.apply){stats.dome=roundDome(tankMeshes,reference,{bodyPositions:bareData.positions,bodyIndices:bareData.indices,clothSurface:baseline.surface,thicknessCm:.08,bump});if(!stats.dome.skipped)stats.domeBeforeContact=hybridMetrics(tankMeshes,reference);}else stats.dome={skipped:true,reason:navelDecision.reason};
  console.timeEnd('ROUND_DOME');console.log('ROUND_DOME_STATS '+JSON.stringify(stats.dome));setOutfit(leggings);showImportedOutfit(leggings);console.time('ROUND_COLLIDER');const shellBefore={upper:lowerLayerMetrics({yMin:128,yMax:146}),lower:lowerLayerMetrics()},finalBody=bodyWorldData(),bodyBefore=body.geometry.attributes.position.array.slice(),collider=new SkinCollider(finalBody.positions,finalBody.indices);finalShadingCollider=collider;if(highHemCorrection&&leggings==='high'){stats.highHem.leggings=smoothHighLeggings(scene.three,{bodyCollider:collider,pantsNormals});if(strictClearance&&!stats.highHem.leggings.success)throw Error('High leggings smoothing verification failed: '+JSON.stringify(stats.highHem.leggings));}stats.skinOrientation={atFrontNavel:collider.closest([reference.center[0],reference.center[1],reference.center[2]+2]).normal,triangles:finalBody.indices.length/3};console.timeEnd('ROUND_COLLIDER');console.time('ROUND_CONTACT');const navBefore=navelGeometryStamp();stats.backEdgeCleanup=backEdgeCleanup;stats.contact=(backEdgeCleanup?applyShoulderContact:applyOriginalShoulderContact)(tankMeshes,collider,{enabled:shoulderContact});if(backEdgeCleanup&&shoulderContact){stats.backLayerGuard=repairBackLayers(tankMeshes,{baseline:shellBefore.upper,measure:()=>lowerLayerMetrics({yMin:128,yMax:146}),locate:layerRayLocation,verify:()=>verifyScopedContact(tankMeshes,collider,{enabled:false})});stats.contactAfterLayerGuard=stats.backLayerGuard.lastClearance??verifyScopedContact(tankMeshes,collider,{enabled:false});if(strictClearance&&(!stats.backLayerGuard.success||!stats.contactAfterLayerGuard.converged))throw Error('Bounded back-layer guard failed: '+JSON.stringify({guard:stats.backLayerGuard,clearance:stats.contactAfterLayerGuard}));}const navAfter=navelGeometryStamp();stats.shoulderProtectedNavel={before:navBefore,after:navAfter,unchanged:navBefore.hash===navAfter.hash&&navBefore.vertices===navAfter.vertices};if(!stats.shoulderProtectedNavel.unchanged)throw Error('Shoulder correction changed navel geometry');stats.clearance=stats.contactAfterLayerGuard??stats.contact;if(strictClearance&&shoulderContact&&(!stats.contact.converged))throw Error('Scoped top-shoulder contact failed: '+JSON.stringify(stats.contact));stats.postContactLayerComparison={upper:comparePolishLayers(shellBefore.upper,lowerLayerMetrics({yMin:128,yMax:146}),false),lower:comparePolishLayers(shellBefore.lower,lowerLayerMetrics(),false)};console.timeEnd('ROUND_CONTACT');console.log('ROUND_CONTACT_STATS '+JSON.stringify(stats.contact));if(stats.dome&&!stats.dome.skipped)stats.domeAfterContact=hybridMetrics(tankMeshes,reference);for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Contact pass changed approved body buffer');stats.upperRegressionLocations=stats.postContactLayerComparison.upper.regressions.map(layerRayLocation);stats.bodyUnchangedDuringContact=true;for(const mesh of tankMeshes)weldRenderNormals(mesh);const contourEnabled=contourPolicy({enabled:preserveBellyContour,fitStyle,leggings,bump});stats.bellyContour=preserveBellyContourPass(tankMeshes,{enabled:contourEnabled,bodyCollider:collider,pantsCollider:contourEnabled?highPantsCollider(scene.three):null,navelCenter:bareNavel,updateNormals:weldRenderNormals});if(strictClearance&&!stats.bellyContour.success)throw Error('Belly contour preservation verification failed: '+JSON.stringify(stats.bellyContour));for(let i=0;i<bodyBefore.length;i++)if(bodyBefore[i]!==body.geometry.attributes.position.array[i])throw Error('Contour pass changed approved body');
 }else{for(const mesh of tankMeshes)mesh.visible=false;hideApprovedTop();}
 if(!bare)stats.leggingsOcclusion=maskHighLeggings(scene.three,tankMeshes,{leggings,enabled:leggingsOcclusion});if(!bare&&highHemCorrection&&leggings==='high'){const hemBodyBefore=body.geometry.attributes.position.array.slice(),preciseMask=applyHighHemOcclusion(scene.three,tankMeshes,{enabled:true,leggings,navelCenter:bareNavel});stats.highHem.preciseOcclusion=preciseMask;stats.highHem.hem=correctHemLayering(scene.three,tankMeshes,{navelCenter:bareNavel,maskPredicate:preciseMask.maskedPredicate,updateMask:preciseMask.refreshProfile,measureLayers:()=>lowerLayerMetrics({yMin:92,yMax:104,step:.25,angular:64})});stats.highHem.preciseOcclusionProfile=inspectHighHemOcclusion(scene.three);stats.highHem.hem.bodyUnchanged=hemBodyBefore.every((v,i)=>v===body.geometry.attributes.position.array[i]);if(!stats.highHem.hem.bodyUnchanged)throw Error('Hem correction changed approved body');if(strictClearance&&!stats.highHem.hem.success)throw Error('Local hem layering verification failed: '+JSON.stringify(stats.highHem.hem));for(const mesh of tankMeshes)weldRenderNormals(mesh);}const spotEnabled=spotPolicy({enabled:repairSpandexSpot,fitStyle,leggings,bump})&&!bare,spotOcclusion=inspectHighHemOcclusion(scene.three),spotMaskConfig=spotOcclusion.enabled?{...spotOcclusion,profile:{bins:spotOcclusion.bins,centerZ:spotOcclusion.centerZ,cellLowerHem:spotOcclusion.cellLowerHem,hem:spotOcclusion.planeSampledHem}}:null;stats.spotRepair=repairInnerSpot(tankMeshes,{enabled:spotEnabled,bodyCollider:finalShadingCollider,pantsSurface:spotEnabled?spotPantsSurface(scene.three):null,pantsMasked:q=>isHighHemOccluded(q,spotMaskConfig),navelCenter:bareNavel});if(strictClearance&&!stats.spotRepair.success)throw Error('Local inner spot repair verification failed: '+JSON.stringify(stats.spotRepair));stats.hemShading=softenSpandexHem(tankMeshes,{enabled:hemShadingPolicy({enabled:softSpandexHem,fitStyle,bare}),bodyCollider:finalShadingCollider,navelCenter:bareNavel});if(!stats.hemShading.success)throw Error('Hem shading preservation failed: '+JSON.stringify(stats.hemShading));stats.spotShading=softenSpotShading(tankMeshes,{enabled:spotEnabled,bodyCollider:finalShadingCollider,navelCenter:bareNavel});if(!stats.spotShading.success)throw Error('Local spot shading preservation failed');stats.outfit=document.querySelector('[data-action="sarahlab:outfit"]').textContent;stats.bareNavelAnchor=bareNavel;stats.finalNavelAnchor=navelPoint().toArray();for(const mesh of tankMeshes){mesh.material=neutral?mesh.userData.neutralMaterial:mesh.userData.normalMaterial;if(!neutral)mesh.material.normalMap=normalMap?mesh.userData.originalNormalMap:null;mesh.material.side=frontSide?T.FrontSide:T.DoubleSide;mesh.material.needsUpdate=true;}
 const nav=new T.Vector3(...bareNavel),target=(navelCloseup||bare)?nav.clone():shoulderCloseup?new T.Vector3(0,140,-6):new T.Vector3(0,full?89:closeup?132:118,0),fov=(navelCloseup||bare)?22:full?38:35,distance=(navelCloseup||bare)?100:shoulderCloseup?110:full?310:closeup?90:200,camera=new T.PerspectiveCamera(fov,.8,1,4000),gl=renderer.gl;gl.setScissorTest(true);gl.clear();for(let side=0;side<2;side++){gl.setViewport(side*800,0,800,1000);gl.setScissor(side*800,0,800,1000);camera.position.copy(target).add(new T.Vector3(side?distance:0,0,side?0:distance));camera.lookAt(target);camera.updateMatrixWorld(true);gl.render(scene.three,camera);}gl.setScissorTest(false);document.querySelector('#title').textContent=bare?`Approved bare-body navel · belly ${bump}%`:`${fitStyle==='spandex'?'Spandex':'Relaxed'} shirt · ${leggings} leggings · belly ${bump}% · 50% closer hybrid · smooth requested navel curve · ${shoulderContact?'top-shoulder contact only':'contact disabled · diagnostic'}`;console.timeEnd('ROUND_FRAME');return {bump,fitStyle,leggings,polish,bare,dome,collision,...stats};
},renderCurrent({full=false,shoulderCloseup=false,navelCloseup=false,backViews=false}={}){const nav=navelPoint(),target=navelCloseup?nav:shoulderCloseup?new T.Vector3(0,140,-6):new T.Vector3(0,full?89:118,0),distance=navelCloseup?100:shoulderCloseup?110:full?310:200,camera=new T.PerspectiveCamera(navelCloseup?22:full?38:35,.8,1,4000),gl=renderer.gl;gl.setScissorTest(true);gl.clear();for(let side=0;side<2;side++){gl.setViewport(side*800,0,800,1000);gl.setScissor(side*800,0,800,1000);camera.position.copy(target).add(backViews?new T.Vector3(side?distance*Math.SQRT1_2:0,0,side?-distance*Math.SQRT1_2:-distance):new T.Vector3(side?distance:0,0,side?0:distance));camera.lookAt(target);camera.updateMatrixWorld(true);gl.render(scene.three,camera);}gl.setScissorTest(false);return {viewOnly:true};},async renderBare(o={}){return this.render({...o,bare:true});}};

Object.assign(window.tankPreview,createReviewView({renderer,scene,getBody:()=>body,getTankMeshes:()=>tankMeshes}));

Object.assign(window.tankPreview,createHighHemInspector({scene,bodyWorldData,getTankMeshes:()=>tankMeshes}));

const wait=setInterval(()=>{if(!field('sarahlab-status')?.textContent?.startsWith('model v2-body'))return;let count=0;scene.three.traverse(n=>{if(n.isSkinnedMesh&&n.geometry.getAttribute('_cloth_cover'))count+=n.geometry.attributes.position.count;});if(count<1000)return;clearInterval(wait);init().catch(e=>{console.error(e);throw e;});},50);
