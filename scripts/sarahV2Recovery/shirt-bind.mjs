/** Offline bridge from frozen, approved Meshy shirt fits to Sarah's native skin.
 * No fitting occurs here: bump100 is copied exactly and other snapshots are
 * resampled only in the original Meshy source surface, never the fitted surface.
 */
import { readFile, readdir, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { copyToDocument, prune, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { closestBary, vertexNormals } from '../fitMeshyBikini.mjs';

export const FIT_BUMPS = [0, 50, 100, 150, 200];
const vec = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const bary = (a, tri, bc, size = 3) => Array.from({length:size},(_,k)=>tri.reduce((v,i,j)=>v+a[i*size+k]*bc[j],0));
const key = (x,y,z) => `${x},${y},${z}`;
const finiteArray = (array, name, stride) => {
  if (!array || array.length % stride || !Array.from(array).every(Number.isFinite)) throw new Error(`Invalid ${name}`);
};

/** A bounded spatial grid with UV tie breaking for coincident cloth layers. */
export function createTriangleSampler(positions, indices, {cellSize = 1.5, uv = null, normals = null, rejectTriangle = null} = {}) {
  finiteArray(positions, 'sampler positions', 3);
  finiteArray(indices, 'triangle indices', 3);
  const cells = new Map(), boundsMin = [Infinity,Infinity,Infinity], boundsMax = [-Infinity,-Infinity,-Infinity];
  for(let t=0;t<indices.length;t+=3){
    if(rejectTriangle?.(t)) continue;
    const tri=indices.slice(t,t+3);
    const lo=[0,1,2].map(k=>Math.floor(Math.min(...tri.map(i=>positions[i*3+k]))/cellSize));
    const hi=[0,1,2].map(k=>Math.floor(Math.max(...tri.map(i=>positions[i*3+k]))/cellSize));
    for(let k=0;k<3;k++){boundsMin[k]=Math.min(boundsMin[k],lo[k]);boundsMax[k]=Math.max(boundsMax[k],hi[k]);}
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
      const name=key(x,y,z); if(!cells.has(name))cells.set(name,[]); cells.get(name).push(t);
    }
  }
  if(!cells.size) throw new Error('Cannot bind to an empty triangle surface');
  return (p, hint = {}) => {
    const c=p.map(v=>Math.floor(v/cellSize));
    const maxRadius=Math.max(...boundsMin.map((v,k)=>Math.abs(v-c[k])),...boundsMax.map((v,k)=>Math.abs(v-c[k])));
    let best=null; const visited=new Set();
    for(let radius=0;radius<=maxRadius;radius++){
      // The next shell can begin immediately across the query cell edge.
      const outsideDistance=Math.min(...p.map((v,k)=>Math.min(v-(c[k]-radius+1)*cellSize,(c[k]+radius)*cellSize-v)));
      if(radius>0 && best && best.d2 + 1e-12 < outsideDistance**2) break;
      for(let x=-radius;x<=radius;x++)for(let y=-radius;y<=radius;y++)for(let z=-radius;z<=radius;z++){
        if(Math.max(Math.abs(x),Math.abs(y),Math.abs(z))!==radius)continue;
        for(const t of cells.get(key(c[0]+x,c[1]+y,c[2]+z))??[]){
          if(visited.has(t))continue; visited.add(t);
          const tri=Array.from(indices.slice(t,t+3));
          const bc=closestBary(p,...tri.map(i=>vec(positions,i))),q=bary(positions,tri,bc);
          const d2=q.reduce((sum,v,k)=>sum+(v-p[k])**2,0);
          const tuv=uv && hint.uv ? bary(uv,tri,bc,2) : null;
          const uvDistance=tuv ? tuv.reduce((sum,v,k)=>sum+(v-hint.uv[k])**2,0) : 0;
          const tn=normals&&hint.normal?bary(normals,tri,bc):null;
          const normalAlignment=tn?tn.reduce((sum,v,k)=>sum+v*hint.normal[k],0)/(Math.hypot(...tn)||1):0;
          if(!best || d2<best.d2-1e-10 || (Math.abs(d2-best.d2)<=1e-10 && (uvDistance<best.uvDistance-1e-14 || (Math.abs(uvDistance-best.uvDistance)<=1e-14 && normalAlignment>best.normalAlignment)))) best={tri,bc,q,d2,uvDistance,normalAlignment};
        }
      }
    }
    return best;
  };
}

/** Recover each canonical vertex on a differently subdivided snapshot. */
export function resampleGarment(canonical, snapshot, {maxSourceDistance = .02} = {}) {
  finiteArray(canonical.source,'canonical source',3);
  finiteArray(snapshot.source,'snapshot source',3);
  if(snapshot.positions.length!==snapshot.source.length)throw new Error('Snapshot positions/source vertex count differs');
  if(canonical===snapshot) return {positions:Float64Array.from(snapshot.positions),normals:Float64Array.from(snapshot.normals),maxSourceDistance:0};
  const count=canonical.source.length/3,positions=new Float64Array(count*3),normals=new Float64Array(count*3);
  // Original Meshy vertices remain exact across subdivisions. This also avoids
  // mixing coincident layers in the common case and saves most grid lookups.
  const exact = new Map(), sourceKey=p=>p.map(v=>Math.round(v*1e7)).join(',');
  for(let i=0;i<snapshot.source.length/3;i++){
    const k=sourceKey(vec(snapshot.source,i)); if(!exact.has(k))exact.set(k,[]); exact.get(k).push(i);
  }
  let sampler=null,maxDistance=0;
  for(let i=0;i<count;i++){
    const p=vec(canonical.source,i),uv=canonical.uv?.slice(i*2,i*2+2),normal=vec(canonical.normals,i),matches=exact.get(sourceKey(p));
    if(matches?.length){
      const vertex=matches.reduce((a,b)=>{
        const distance=j=>uv&&snapshot.uv?(snapshot.uv[j*2]-uv[0])**2+(snapshot.uv[j*2+1]-uv[1])**2:0;
        const alignment=j=>normal.reduce((sum,v,k)=>sum+v*snapshot.normals[j*3+k],0);
        const da=distance(a),db=distance(b);
        return db<da-1e-14 || (Math.abs(db-da)<=1e-14 && alignment(b)>alignment(a))?b:a;
      });
      positions.set(vec(snapshot.positions,vertex),i*3);normals.set(vec(snapshot.normals,vertex),i*3);
      continue;
    }
    sampler??=createTriangleSampler(snapshot.source,snapshot.indices,{uv:snapshot.uv,normals:snapshot.normals});
    const hit=sampler(p,{uv,normal}),distance=Math.sqrt(hit.d2);maxDistance=Math.max(maxDistance,distance);
    if(distance>maxSourceDistance)throw new Error(`Source correspondence exceeds tolerance at vertex ${i}: ${distance.toFixed(6)} cm > ${maxSourceDistance} cm`);
    positions.set(bary(snapshot.positions,hit.tri,hit.bc),i*3);
    const sampledNormal=new Vector3(...bary(snapshot.normals,hit.tri,hit.bc)).normalize();normals.set(sampledNormal.toArray(),i*3);
  }
  return {positions,normals,maxSourceDistance:maxDistance};
}

/** three.js SkinnedMesh world transform, including its bind matrices. */
export function skinningMatrix(snapshot, joints, weights) {
  const blended=new Matrix4();blended.elements.fill(0);
  for(let j=0;j<4;j++)if(weights[j]){
    const offset=joints[j]*16;
    if(offset+16>snapshot.boneMatrices.length)throw new Error(`Unknown skin joint ${joints[j]}`);
    for(let k=0;k<16;k++)blended.elements[k]+=snapshot.boneMatrices[offset+k]*weights[j];
  }
  // GLSL takes the blended result's xyz, then restores w=1 for the
  // object transform; Float32 weights can sum a few ulps away from1.
  blended.elements[3]=0;blended.elements[7]=0;blended.elements[11]=0;blended.elements[15]=1;
  return new Matrix4().fromArray(snapshot.bodyMatrix)
    .multiply(new Matrix4().fromArray(snapshot.bindMatrixInverse))
    .multiply(blended).multiply(new Matrix4().fromArray(snapshot.bindMatrix));
}

export function bindWorldPoint(point,snapshot,joints,weights){
  const matrix=skinningMatrix(snapshot,joints,weights);
  if(Math.abs(matrix.determinant())<1e-15)throw new Error('Singular blended skin matrix');
  return new Vector3(...point).applyMatrix4(matrix.invert()).toArray();
}

// Skinning shaders apply the blended bone matrix directly to normals,
// followed by the object's inverse-transpose normal matrix. Invert that
// exact transform rather than assuming the blended bones are orthogonal.
export function bindWorldNormal(normal,snapshot,joints,weights,forward=skinningMatrix(snapshot,joints,weights)){
  const body=new Matrix4().fromArray(snapshot.bodyMatrix);
  const localSkin=body.clone().invert().multiply(forward);
  const normalTransform=new Matrix3().getNormalMatrix(body).multiply(new Matrix3().setFromMatrix4(localSkin));
  return new Vector3(...normal).applyMatrix3(normalTransform.invert()).normalize().toArray();
}

function blendedInfluences(hit,native){
  const influences=new Map();
  hit.tri.forEach((vertex,k)=>{
    for(let j=0;j<4;j++){
      const weight=native.weights[vertex*4+j]*hit.bc[k],joint=native.joints[vertex*4+j];
      if(weight>0)influences.set(joint,(influences.get(joint)??0)+weight);
    }
  });
  const top=[...influences].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,v)=>s+v[1],0);
  if(!sum)throw new Error('Body binding has no skin weights');
  const joints=[0,0,0,0],weights=[0,0,0,0];
  top.forEach(([j,w],k)=>{joints[k]=j;weights[k]=w/sum;});
  return {joints,weights};
}

function snapshotBaseline(snapshot,names){
  return Object.fromEntries(names.map(name=>[name,snapshot.weights[snapshot.dict[name]]??0]));
}

/** Pure geometry operation; input snapshots and native arrays are never changed. */
export function prepareShirtVariant(snapshots,native,{sourceTolerance=.02}={}){
  const byBump=new Map(snapshots.map(snapshot=>[Number(snapshot.bump),snapshot]));
  for(const bump of FIT_BUMPS)if(!byBump.has(bump))throw new Error(`Missing approved bump${bump} snapshot`);
  if(byBump.size!==FIT_BUMPS.length)throw new Error('Expected exactly five approved fit snapshots');
  const canonical=byBump.get(100);
  for(const snapshot of snapshots){
    if(snapshot.fitStyle!==canonical.fitStyle || snapshot.leggings!==canonical.leggings)throw new Error('Mixed shirt variants');
    if(snapshot.garments.length!==canonical.garments.length)throw new Error('Garment primitive count changed between snapshots');
    if(snapshot.body.positions.length/3!==native.joints.length/4)throw new Error('Body snapshot does not match native body vertex count');
  }
  const rejectTriangle=native.armJoints ? t=>{
    let total=0;
    for(let k=0;k<3;k++)for(let c=0;c<4;c++){
      const v=canonical.body.indices[t+k];if(native.armJoints.has(native.joints[v*4+c]))total+=native.weights[v*4+c];
    }
    return total>1.5;
  }:null;
  const nearest=createTriangleSampler(canonical.body.positions,canonical.body.indices,{rejectTriangle});
  const targetNames=[...native.targetNames,...FIT_BUMPS.map(bump=>`shape:fitBelly${bump}`)];
  const statistics=[];
  const garments=canonical.garments.map((garment,piece)=>{
    finiteArray(garment.positions,'garment positions',3);
    const count=garment.positions.length/3,positions=new Float32Array(count*3),normals=new Float32Array(count*3);
    const joints=new Uint16Array(count*4),weights=new Float32Array(count*4),bodyTriangles=new Uint32Array(count*3),bodyBarycentric=new Float32Array(count*3);
    const targetPositions=targetNames.map(()=>new Float32Array(count*3));
    const targetNormals=targetNames.map(()=>new Float32Array(count*3));
    const samples=FIT_BUMPS.map(bump=>resampleGarment(garment,byBump.get(bump).garments[piece],{maxSourceDistance:sourceTolerance}));
    let maxBindError=0,maxBodyDistance=0;
    for(let i=0;i<count;i++){
      const world=vec(garment.positions,i),hit=nearest(world),influence=blendedInfluences(hit,native);
      joints.set(influence.joints,i*4);weights.set(influence.weights,i*4);
      influence.weights=Array.from(weights.subarray(i*4,i*4+4));
      bodyTriangles.set(hit.tri,i*3);bodyBarycentric.set(hit.bc,i*3);
      const forward=skinningMatrix(canonical,influence.joints,influence.weights);
      if(Math.abs(forward.determinant())<1e-15)throw new Error(`Singular skin matrix at garment vertex${i}`);
      const inverse=forward.clone().invert(),base=new Vector3(...world).applyMatrix4(inverse);
      positions.set(base.toArray(),i*3);
      const normal=new Vector3(...bindWorldNormal(vec(garment.normals,i),canonical,influence.joints,influence.weights,forward));
      normals.set(normal.toArray(),i*3);
      for(let target=0;target<native.targetNames.length;target++) targetPositions[target].set(bary(native.targetPositions[target],hit.tri,hit.bc),i*3);
      FIT_BUMPS.forEach((bump,k)=>{
        // Pose is frozen across approved fits. Inverting each snapshot's pose
        // also makes that requirement explicit if future export poses differ.
        const sampleForward=bump===100?forward:skinningMatrix(byBump.get(bump),influence.joints,influence.weights);
        const sampleInverse=bump===100?inverse:sampleForward.clone().invert();
        const p=new Vector3(...vec(samples[k].positions,i)).applyMatrix4(sampleInverse).sub(base);
        targetPositions[native.targetNames.length+k].set(p.toArray(),i*3);
        const sampleNormal=new Vector3(...bindWorldNormal(vec(samples[k].normals,i),byBump.get(bump),influence.joints,influence.weights,sampleForward)).sub(normal);
        targetNormals[native.targetNames.length+k].set(sampleNormal.toArray(),i*3);
      });
      const reconstructed=new Vector3(...vec(positions,i)).applyMatrix4(forward);
      maxBindError=Math.max(maxBindError,reconstructed.distanceTo(new Vector3(...world)));
      maxBodyDistance=Math.max(maxBodyDistance,Math.sqrt(hit.d2));
    }
    // Fit normals and native-target normals come from the actual resulting
    // garment surface, retaining the source normal only at the approved base.
    const geometricBase=vertexNormals(positions,garment.indices);
    for(let target=0;target<native.targetNames.length;target++){
      const changed=Float32Array.from(positions,(v,i)=>v+targetPositions[target][i]);
      targetNormals[target]=Float32Array.from(vertexNormals(changed,garment.indices),(v,i)=>v-geometricBase[i]);
    }
    // The native body has intermediate belly keys (25/30/60/75) that
    // cannot be reproduced by interpolating just the five approved fits.
    // Store only the fit residual after the native change from reference100.
    const reference=snapshotBaseline(canonical,native.targetNames);
    FIT_BUMPS.forEach((bump,k)=>{
      const baseline=snapshotBaseline(byBump.get(bump),native.targetNames),fit=native.targetNames.length+k;
      native.targetNames.forEach((name,target)=>{
        const difference=baseline[name]-reference[name];
        if(!difference)return;
        for(let i=0;i<count*3;i++){
          targetPositions[fit][i]-=targetPositions[target][i]*difference;
          targetNormals[fit][i]-=targetNormals[target][i]*difference;
        }
      });
    });
    statistics.push({vertices:count,triangles:garment.indices.length/3,maxBindErrorCm:maxBindError,maxBodyDistanceCm:maxBodyDistance,maxSourceDistanceCm:Math.max(...samples.map(s=>s.maxSourceDistance))});
    return {positions,normals,joints,weights,indices:Uint32Array.from(garment.indices),uv:Float32Array.from(garment.uv),targetPositions,targetNormals,bodyTriangles,bodyBarycentric};
  });
  return {garments,targetNames,metadata:{version:1,fitStyle:canonical.fitStyle,leggings:canonical.leggings,baselineBump:100,baselineMode:'reference100',fitBumps:FIT_BUMPS,nativeTargetNames:native.targetNames,fitTargetNames:targetNames.slice(native.targetNames.length),baselineWeightsByBump:Object.fromEntries(FIT_BUMPS.map(bump=>[bump,snapshotBaseline(byBump.get(bump),native.targetNames)])),statistics}};
}

const readAccessor=accessor=>{
  const result=new Float32Array(accessor.getCount()*accessor.getElementSize()),element=[];
  for(let i=0;i<accessor.getCount();i++){accessor.getElement(i,element);result.set(element,i*accessor.getElementSize());}
  return result;
};
async function createIO(){
  await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
}

/** Write a shirt-only GLB, with an independent copy of Sarah's native rig. */
export async function buildShirtVariant({snapshots,nativePath,meshyPath,outPath,metadataPath=outPath.replace(/\.glb$/i,'.json'),sourceTolerance=.02}){
  const io=await createIO(),doc=await io.read(nativePath),source=await io.read(meshyPath);
  const bodyNode=doc.getRoot().listNodes().find(node=>node.getSkin()&&node.getMesh());
  if(!bodyNode)throw new Error('Native body has no skinned mesh node');
  const bodyMesh=bodyNode.getMesh(),body=bodyMesh.listPrimitives().find(p=>p.getAttribute('JOINTS_0')&&p.listTargets().length);
  if(!body)throw new Error('Native mesh is missing a skinned morph body primitive');
  const targetNames=bodyMesh.getExtras().targetNames??body.listTargets().map(target=>target.getName());
  if(targetNames.length!==43)throw new Error(`Expected native body with43 targets, found${targetNames.length}`);
  const native={joints:readAccessor(body.getAttribute('JOINTS_0')),weights:readAccessor(body.getAttribute('WEIGHTS_0')),targetNames,targetPositions:body.listTargets().map(target=>readAccessor(target.getAttribute('POSITION'))),armJoints:new Set(bodyNode.getSkin().listJoints().map((joint,index)=>{const [x,y]=joint.getWorldTranslation();return Math.abs(x)>.13&&y>.6?index:-1;}).filter(index=>index>=0))};
  const prepared=prepareShirtVariant(snapshots,native,{sourceTolerance});
  const materials=source.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives().map(primitive=>primitive.getMaterial()));
  if(!materials.length || materials.some(material=>!material))throw new Error('Meshy shirt is missing source materials');
  const materialMap=copyToDocument(doc,source,[...new Set(materials)]);
  const mesh=doc.createMesh(`sarah-v2-shirt-${prepared.metadata.fitStyle}-${prepared.metadata.leggings}`).setExtras({targetNames:prepared.targetNames,recoveredShirt:prepared.metadata});
  const buffer=doc.getRoot().listBuffers()[0]??doc.createBuffer();
  const acc=(type,array)=>doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  prepared.garments.forEach((garment,index)=>{
    const primitive=doc.createPrimitive().setMaterial(materialMap.get(materials[index]??materials[0])).setIndices(acc('SCALAR',garment.indices))
      .setAttribute('POSITION',acc('VEC3',garment.positions)).setAttribute('NORMAL',acc('VEC3',garment.normals)).setAttribute('TEXCOORD_0',acc('VEC2',garment.uv))
      .setAttribute('JOINTS_0',acc('VEC4',garment.joints)).setAttribute('WEIGHTS_0',acc('VEC4',garment.weights))
      .setAttribute('_BODY_TRI',acc('VEC3',garment.bodyTriangles)).setAttribute('_BODY_BARY',acc('VEC3',garment.bodyBarycentric));
    prepared.targetNames.forEach((name,k)=>primitive.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION',acc('VEC3',garment.targetPositions[k])).setAttribute('NORMAL',acc('VEC3',garment.targetNormals[k]))));
    mesh.addPrimitive(primitive);
  });
  // Reuse only the body's transform and skin. No native body surface is shipped.
  for(const node of doc.getRoot().listNodes())if(node.getMesh()&&node!==bodyNode)node.setMesh(null).setSkin(null);
  bodyNode.setMesh(mesh).setWeights(prepared.targetNames.map(()=>0));
  bodyNode.setName(mesh.getName());
  for(const animation of doc.getRoot().listAnimations())animation.dispose();
  await doc.transform(prune({keepLeaves:true}),unpartition());
  // Compress raw Float32 data without quantization or filtering. Approved
  // positions and UVs must survive the write/read round trip unchanged.
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  await mkdir(path.dirname(outPath),{recursive:true});await io.write(outPath,doc);
  const metadata={...prepared.metadata,nativePath,meshyPath,output:path.basename(outPath)};
  await writeFile(metadataPath,`${JSON.stringify(metadata,null,2)}\n`);
  return metadata;
}

/**
 * Clothing-only precision budget. The approved reference100 POSITION, NORMAL,
 * TEXCOORD_0 and all topology/skin attributes remain bit-exact. Only morph
 * deltas are rounded: 1e-6 native-local position units and 1e-5 normal units.
 * Native body files are refused, input files are never rewritten, and output
 * is retained only after all five approved world endpoints remain <.001cm
 * from their frozen snapshots and the GLB is at least20% smaller by default.
 * This is a postprocess: it never repeats correspondence or skin binding.
 */
export async function quantizeShirtAsset({inputPath,outPath,snapshots,positionStep=1e-6,normalStep=1e-5,maxEndpointErrorCm=.001,minimumReduction=.2}){
  if(path.resolve(inputPath)===path.resolve(outPath))throw new Error('Precision output must use a different path from the strict input');
  if(!(Number.isFinite(positionStep)&&Number.isFinite(normalStep)&&positionStep>0&&normalStep>0))throw new Error('Precision steps must be positive and finite');
  // A binary lattice at least as fine as the requested decimal budget
  // gives exact Float32 multiples and compressible zero mantissa bits.
  const effectivePositionStepLocal=2**Math.floor(Math.log2(positionStep)),effectiveNormalStep=2**Math.floor(Math.log2(normalStep));
  const io=await createIO(),doc=await io.read(inputPath),meshes=doc.getRoot().listMeshes();
  if(!meshes.length || meshes.some(mesh=>!mesh.getExtras().recoveredShirt))throw new Error('Precision budget applies only to a recovered shirt asset');
  const metadata=meshes[0].getExtras().recoveredShirt;
  if(metadata.baselineMode!=='reference100')throw new Error('Precision budget requires reference100 residual targets');
  const byBump=new Map(snapshots.filter(s=>s.fitStyle===metadata.fitStyle&&s.leggings===metadata.leggings).map(s=>[Number(s.bump),s]));
  for(const bump of FIT_BUMPS)if(!byBump.has(bump))throw new Error(`Missing precision validation snapshot bump${bump}`);
  const canonical=byBump.get(100),primitives=meshes.flatMap(mesh=>mesh.listPrimitives());
  if(primitives.length!==canonical.garments.length)throw new Error('Precision validation primitive count differs');
  const digest=array=>createHash('sha256').update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
  const protectedSemantics=['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0','_BODY_TRI','_BODY_BARY'];
  const protectedHashes=primitives.map(p=>Object.fromEntries(protectedSemantics.filter(s=>p.getAttribute(s)).map(s=>[s,digest(p.getAttribute(s).getArray())])));
  const protectedIndices=primitives.map(p=>digest(p.getIndices().getArray()));
  const endpointErrors=Object.fromEntries(FIT_BUMPS.map(bump=>[bump,0]));
  let maxPositionDeltaRounding=0,maxNormalDeltaRounding=0;
  for(let piece=0;piece<primitives.length;piece++){
    const primitive=primitives[piece],targets=primitive.listTargets();
    for(const target of targets)for(const semantic of['POSITION','NORMAL']){
      const accessor=target.getAttribute(semantic);if(!accessor)continue;
      const step=semantic==='POSITION'?effectivePositionStepLocal:effectiveNormalStep,array=accessor.getArray();
      const rounded=Float32Array.from(array,value=>{const quantized=Math.round(value/step)*step;return quantized===0?0:quantized;});
      for(let i=0;i<array.length;i++){
        const error=Math.abs(array[i]-rounded[i]);
        if(semantic==='POSITION')maxPositionDeltaRounding=Math.max(maxPositionDeltaRounding,error);else maxNormalDeltaRounding=Math.max(maxNormalDeltaRounding,error);
      }
      accessor.setArray(rounded);
    }
    const P=primitive.getAttribute('POSITION').getArray(),J=primitive.getAttribute('JOINTS_0').getArray(),W=primitive.getAttribute('WEIGHTS_0').getArray();
    const names=metadata.nativeTargetNames,reference=metadata.baselineWeightsByBump[100];
    for(const bump of FIT_BUMPS){
      const snapshot=byBump.get(bump),sample=resampleGarment(canonical.garments[piece],snapshot.garments[piece]);
      const fit=targets[names.length+FIT_BUMPS.indexOf(bump)].getAttribute('POSITION').getArray();
      const corrections=names.map((name,k)=>({weight:metadata.baselineWeightsByBump[bump][name]-reference[name],delta:targets[k].getAttribute('POSITION').getArray()})).filter(c=>c.weight);
      for(let i=0;i<P.length/3;i++){
        const point=new Vector3(...vec(P,i));
        for(let c=0;c<3;c++)point.setComponent(c,point.getComponent(c)+fit[i*3+c]+corrections.reduce((sum,correction)=>sum+correction.delta[i*3+c]*correction.weight,0));
        point.applyMatrix4(skinningMatrix(snapshot,J.subarray(i*4,i*4+4),W.subarray(i*4,i*4+4)));
        endpointErrors[bump]=Math.max(endpointErrors[bump],point.distanceTo(new Vector3(...vec(sample.positions,i))));
      }
    }
  }
  const worstError=Math.max(...Object.values(endpointErrors));
  const precision={positionStepLocal:positionStep,normalStep,effectivePositionStepLocal,effectiveNormalStep,maxPositionDeltaRounding,maxNormalDeltaRounding,maxEndpointErrorCm:worstError,endpointErrorsCm:endpointErrors,reference100:'POSITION/NORMAL/TEXCOORD_0 bit-exact',scope:'recovered clothing morph deltas only'};
  if(worstError>=maxEndpointErrorCm)return {accepted:false,reason:'endpoint-error',...precision};
  for(const mesh of meshes)mesh.setExtras({...mesh.getExtras(),recoveredShirt:{...mesh.getExtras().recoveredShirt,deltaPrecision:precision}});
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  await mkdir(path.dirname(outPath),{recursive:true});await io.write(outPath,doc);
  // Verify the serialized Float32 reference, UVs, skinning and binding data.
  const reread=await io.read(outPath),written=reread.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives());
  for(let i=0;i<written.length;i++)for(const [semantic,hash]of Object.entries(protectedHashes[i])){
    if(digest(written[i].getAttribute(semantic).getArray())!==hash){await rm(outPath);throw new Error(`Precision postprocess changed protected ${semantic}`);}
  }
  for(let i=0;i<written.length;i++)if(digest(written[i].getIndices().getArray())!==protectedIndices[i]){await rm(outPath);throw new Error('Precision postprocess changed protected triangle indices');}
  const strictBytes=(await stat(inputPath)).size,outputBytes=(await stat(outPath)).size,reduction=1-outputBytes/strictBytes;
  if(minimumReduction>0&&reduction<minimumReduction){await rm(outPath);return {accepted:false,reason:'insufficient-reduction',strictBytes,outputBytes,reduction,...precision};}
  return {accepted:true,outPath,strictBytes,outputBytes,reduction,...precision};
}

async function main(){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(`--${name}`);return i<0?null:args[i+1];};
  const snapshotDirectory=option('snapshots'),nativePath=option('native')??'public/models/sarah-v2-body.glb',meshyPath=option('meshy')??'/tmp/sarah-meshy-tank.glb',outDirectory=option('out-dir');
  const precisionInput=option('quantize'),precisionOutput=option('out');
  if(!snapshotDirectory||(!outDirectory&&!precisionInput)||(precisionInput&&!precisionOutput))throw new Error('Usage: node scripts/sarahV2Recovery/shirt-bind.mjs --snapshots DIR --out-dir DIR [--native GLB] [--meshy GLB]; postprocess: --quantize STRICT_GLB --snapshots DIR --out SMALL_GLB');
  const files=(await readdir(snapshotDirectory)).filter(file=>file.endsWith('.json'));
  const groups=new Map();
  for(const file of files){
    const snapshot=JSON.parse(await readFile(path.join(snapshotDirectory,file),'utf8'));
    if(!snapshot.garments||snapshot.bump===undefined)continue;
    const name=`${snapshot.fitStyle}-${snapshot.leggings}`;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(snapshot);
  }
  if(!groups.size)throw new Error('No fit snapshots found');
  if(precisionInput){console.log(JSON.stringify(await quantizeShirtAsset({inputPath:precisionInput,outPath:precisionOutput,snapshots:[...groups.values()].flat()})));return;}
  for(const [name,snapshots]of groups){
    const outPath=path.join(outDirectory,`sarah-v2-${name}.glb`);
    const metadata=await buildShirtVariant({snapshots,nativePath,meshyPath,outPath});
    console.log(JSON.stringify({outPath,statistics:metadata.statistics}));
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await main();
