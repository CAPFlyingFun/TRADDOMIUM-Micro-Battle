import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { createTriangleSampler, resampleGarment, skinningMatrix, bindWorldPoint, prepareShirtVariant } from './shirt-bind.mjs';
const identity = new Matrix4().toArray();
const tri = { positions: [0,0,0, 1,0,0, 0,1,0], source: [0,0,0, 1,0,0, 0,1,0], normals:[0,0,1, 0,0,1, 0,0,1], uv:[0,0, 1,0, 0,1], indices:[0,1,2] };
const native = { joints:[0,0,0,0, 0,0,0,0, 0,0,0,0], weights:[1,0,0,0, 1,0,0,0, 1,0,0,0], targetNames:Array.from({length:43},(_,i)=>`native${i}`), targetPositions:Array.from({length:43},(_,i)=>[0,0,i/100, 0,0,i/100, 0,0,i/100]) };
const snapshot = bump => ({bump,fitStyle:'spandex',leggings:'high', body:{positions:tri.positions,indices:tri.indices},bodyLocal:tri.positions, bodyMatrix:identity,bindMatrix:identity,bindMatrixInverse:identity,boneMatrices:identity,dict:Object.fromEntries(native.targetNames.map((n,i)=>[n,i])),weights:native.targetNames.map((_,i)=>bump/1000+i/100),garments:[{...tri,positions:tri.positions.map((v,i)=>v+(i%3===2?(bump-100)/100:0))}]});

test('canonical snapshot remains byte-for-byte exact without interpolation',()=>{
 const result = resampleGarment(tri,tri);
 assert.deepEqual(Array.from(result.positions),tri.positions);
 assert.deepEqual(Array.from(result.normals),tri.normals);
 assert.equal(result.maxSourceDistance,0);
});

test('source coordinates resample changed subdivision, including interpolated source vertices',()=>{
 const moved = {source:[0,0,0, 1,0,0, 0,1,0, .5,0,0],positions:[0,0,1, 1,0,2, 0,1,3, .5,0,1.5],normals:[0,0,1, 0,0,1, 0,0,1, 0,0,1],uv:[0,0, 1,0, 0,1, .5,0],indices:[0,3,2, 3,1,2]};
 const canonical = {source:[.25,.25,0],uv:[.25,.25],normals:[0,0,1],positions:[.25,.25,0]};
 const result=resampleGarment(canonical,moved);
 assert.deepEqual(Array.from(result.positions),[.25,.25,1.75]);
 assert.ok(result.maxSourceDistance<1e-10);
});

test('coincident cloth shells use UV correspondence to retain the original side',()=>{
 const sampler=createTriangleSampler([0,0,0,1,0,0,0,1,0, 0,0,0,1,0,0,0,1,0],[0,1,2,3,4,5],{uv:[0,0,1,0,0,1, 3,3,4,3,3,4]});
 const hit=sampler([.25,.25,0],{uv:[3.25,3.25]});
 assert.deepEqual(hit.tri,[3,4,5]);
});

test('inverse blended skinning preserves approved world positions under pose and unit transforms',()=>{
 const bodyMatrix=new Matrix4().makeScale(100,100,100).toArray();
 const a=new Matrix4().makeRotationY(.4).setPosition(.2,0,.1).toArray();
 const b=new Matrix4().makeRotationX(-.2).setPosition(0,.3,0).toArray();
 const posed={bodyMatrix,bindMatrix:identity,bindMatrixInverse:identity,boneMatrices:[...a,...b]};
 const weights=[.3,.7,0,0], joints=[0,1,0,0], point=[30,45,12];
 const local=bindWorldPoint(point,posed,joints,weights);
 const roundtrip=new Vector3(...local).applyMatrix4(skinningMatrix(posed,joints,weights));
 assert.ok(roundtrip.distanceTo(new Vector3(...point))<1e-10);
});

test('binding carries all43 native targets, snapshot keys, and per-snapshot baselines without mutating body',()=>{
 const snapshots=[0,50,100,150,200].map(snapshot), before=JSON.stringify(snapshots);
 const result=prepareShirtVariant(snapshots,native);
 assert.equal(JSON.stringify(snapshots),before);
 assert.equal(result.targetNames.length,48);
 assert.deepEqual(result.targetNames.slice(0,43),native.targetNames);
 assert.deepEqual(Array.from(result.garments[0].positions),tri.positions);
 assert.deepEqual(Array.from(result.garments[0].targetPositions[43+2]),Array(9).fill(0));
 const baked=result.garments[0];
 const reconstructed=Array.from(baked.positions,(value,i)=>value+baked.targetPositions[43][i]+native.targetNames.reduce((sum,name,k)=>sum+baked.targetPositions[k][i]*(snapshots[0].weights[k]-snapshots[2].weights[k]),0));
 reconstructed.forEach((value,i)=>assert.ok(Math.abs(value-snapshots[0].garments[0].positions[i])<1e-6));
 assert.equal(result.metadata.baselineMode,'reference100');
 assert.equal(result.metadata.baselineWeightsByBump[0].native42,.42);
 assert.equal(result.metadata.baselineWeightsByBump[200].native42,.62);
 assert.deepEqual(Array.from(result.garments[0].targetPositions[42]),Array.from(Float32Array.from(native.targetPositions[42])));
});

 test('nearest triangle crosses cell boundaries before accepting a farther current-cell triangle',()=>{
 const sample=createTriangleSampler([0,0,0, 0,1,0, 0,0,1, 1.51,0,0, 1.51,1,0, 1.51,0,1],[0,1,2,3,4,5]);
 assert.deepEqual(sample([1.49,.2,.2]).tri,[3,4,5]);
 });

 test('CPU-lifted native target names have zero GPU baseline when absent from snapshot dictionary',()=>{
 const snapshots=[0,50,100,150,200].map(snapshot);
 for(const value of snapshots) delete value.dict.native42;
 const result=prepareShirtVariant(snapshots,native);
 assert.equal(result.metadata.baselineWeightsByBump[100].native42,0);
 });

 test('GLB export preserves source material bytes, clones the native rig, and never rewrites the body file',async()=>{
 const {Document,NodeIO}=await import('@gltf-transform/core');
 const {ALL_EXTENSIONS}=await import('@gltf-transform/extensions');
 const {MeshoptDecoder,MeshoptEncoder}=await import('meshoptimizer');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const path=await import('node:path');
 const {createHash}=await import('node:crypto');
 const {buildShirtVariant,quantizeShirtAsset}=await import('./shirt-bind.mjs');
 const directory=await mkdtemp(path.join(tmpdir(),'shirt-bind-test-'));
 try {
  await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
  const bodyDoc=new Document(),buffer=bodyDoc.createBuffer();
  const acc=(type,array)=>bodyDoc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const bone=bodyDoc.createNode('native-root-bone');
  const skin=bodyDoc.createSkin('native-skin').addJoint(bone).setInverseBindMatrices(acc('MAT4',Float32Array.from(identity)));
  const primitive=bodyDoc.createPrimitive().setIndices(acc('SCALAR',new Uint16Array(tri.indices))).setAttribute('POSITION',acc('VEC3',Float32Array.from(tri.positions))).setAttribute('NORMAL',acc('VEC3',Float32Array.from(tri.normals))).setAttribute('JOINTS_0',acc('VEC4',new Uint16Array(native.joints))).setAttribute('WEIGHTS_0',acc('VEC4',Float32Array.from(native.weights)));
  native.targetNames.forEach((name,k)=>primitive.addTarget(bodyDoc.createPrimitiveTarget(name).setAttribute('POSITION',acc('VEC3',Float32Array.from(native.targetPositions[k])))));
  const bodyMesh=bodyDoc.createMesh('native-body').setExtras({targetNames:native.targetNames}).addPrimitive(primitive);
  bodyDoc.createScene().addChild(bone).addChild(bodyDoc.createNode('body-node').setMesh(bodyMesh).setSkin(skin));
  const nativePath=path.join(directory,'body.glb'),meshyPath=path.join(directory,'meshy.glb'),outPath=path.join(directory,'shirt.glb');
  await io.write(nativePath,bodyDoc);
  const source=new Document(),sourceBuffer=source.createBuffer();
  const sourceAccessor=(type,array)=>source.createAccessor().setType(type).setArray(array).setBuffer(sourceBuffer);
  const texture=source.createTexture('shirt-source-texture').setMimeType('image/png').setImage(new Uint8Array([1,2,3,4]));
  const material=source.createMaterial('approved-meshy-material').setBaseColorFactor([.2,.3,.4,1]).setBaseColorTexture(texture).setRoughnessFactor(.85);
  source.createScene().addChild(source.createNode().setMesh(source.createMesh().addPrimitive(source.createPrimitive().setMaterial(material).setAttribute('POSITION',sourceAccessor('VEC3',Float32Array.from(tri.positions))).setIndices(sourceAccessor('SCALAR',new Uint16Array(tri.indices))))));
  await io.write(meshyPath,source);
  const before=createHash('sha256').update(await readFile(nativePath)).digest('hex');
  const fixtureSnapshots=[0,50,100,150,200].map(snapshot);
  fixtureSnapshots[0].garments[0].normals=[0,.612345,.790591, 0,.612345,.790591, 0,.612345,.790591];
  await buildShirtVariant({snapshots:fixtureSnapshots,nativePath,meshyPath,outPath});
  assert.equal(createHash('sha256').update(await readFile(nativePath)).digest('hex'),before);
  const shirt=await io.read(outPath),nodes=shirt.getRoot().listNodes().filter(n=>n.getMesh());
  assert.equal(nodes.length,1);assert.equal(nodes[0].getSkin().listJoints()[0].getName(),'native-root-bone');
  const exported=nodes[0].getMesh().listPrimitives()[0];
  assert.deepEqual(Array.from(exported.getAttribute('POSITION').getArray()),tri.positions);
  assert.equal(exported.listTargets().length,48);
  assert.equal(exported.getMaterial().getName(),'approved-meshy-material');
  assert.deepEqual(Array.from(exported.getMaterial().getBaseColorTexture().getImage()),[1,2,3,4]);
  assert.deepEqual(shirt.getRoot().listMeshes().map(m=>m.getName()),['sarah-v2-shirt-spandex-high']);
  const quantizedPath=path.join(directory,'shirt-precision.glb');
  const strictHash=createHash('sha256').update(await readFile(outPath)).digest('hex');
  const precision=await quantizeShirtAsset({inputPath:outPath,outPath:quantizedPath,snapshots:fixtureSnapshots,minimumReduction:0});
  assert.equal(precision.accepted,true);assert.ok(precision.maxEndpointErrorCm<.001);
  assert.ok(precision.maxNormalDeltaRounding>0&&precision.maxNormalDeltaRounding<5.1e-6);
  assert.equal(createHash('sha256').update(await readFile(outPath)).digest('hex'),strictHash);
  assert.equal(createHash('sha256').update(await readFile(nativePath)).digest('hex'),before);
  const quantized=await io.read(quantizedPath),qp=quantized.getRoot().listMeshes()[0].listPrimitives()[0];
  for(const semantic of['POSITION','NORMAL','TEXCOORD_0'])assert.deepEqual(qp.getAttribute(semantic).getArray(),exported.getAttribute(semantic).getArray());
  assert.deepEqual(qp.listTargets()[45].getAttribute('POSITION').getArray(),new Float32Array(9));
  const budget=quantized.getRoot().listMeshes()[0].getExtras().recoveredShirt.deltaPrecision;
  assert.equal(budget.positionStepLocal,1e-6);assert.equal(budget.normalStep,1e-5);
  assert.equal(budget.effectivePositionStepLocal,2**-20);assert.equal(budget.effectiveNormalStep,2**-17);
  const roundedNormal=qp.listTargets()[43].getAttribute('NORMAL').getArray()[1];
  assert.equal(roundedNormal/budget.effectiveNormalStep,Math.round(roundedNormal/budget.effectiveNormalStep));
  const tooCoarse=await quantizeShirtAsset({inputPath:outPath,outPath:path.join(directory,'coarse.glb'),snapshots:fixtureSnapshots,positionStep:1,minimumReduction:0});
  assert.equal(tooCoarse.accepted,false);assert.equal(tooCoarse.reason,'endpoint-error');
  const tooSmall=await quantizeShirtAsset({inputPath:outPath,outPath:path.join(directory,'unhelpful.glb'),snapshots:fixtureSnapshots,minimumReduction:.99});
  assert.equal(tooSmall.accepted,false);assert.equal(tooSmall.reason,'insufficient-reduction');
  await assert.rejects(readFile(path.join(directory,'unhelpful.glb')),/ENOENT/);
  await assert.rejects(quantizeShirtAsset({inputPath:meshyPath,outPath:quantizedPath,snapshots:[]}),/recovered shirt/);
  await assert.rejects(quantizeShirtAsset({inputPath:outPath,outPath,snapshots:[]}),/different/);
 } finally {await rm(directory,{recursive:true,force:true});}
 });

 test('fit snapshot morphs retain exported snapshot normals at each approved endpoint',()=>{
 const snapshots=[0,50,100,150,200].map(snapshot);
 snapshots[0].garments[0].normals=[0,.6,.8, 0,.6,.8, 0,.6,.8];
 const result=prepareShirtVariant(snapshots,native),garment=result.garments[0];
 const normal=Array.from(garment.normals, (value,i)=>value+garment.targetNormals[43][i]+native.targetNames.reduce((sum,name,k)=>sum+garment.targetNormals[k][i]*(snapshots[0].weights[k]-snapshots[2].weights[k]),0));
 for(let i=0;i<normal.length;i++)assert.ok(Math.abs(normal[i]-snapshots[0].garments[0].normals[i])<1e-7);
 });

 test('Float32 skin weights use affine GLSL skinning without a homogeneous divide',()=>{
 const weights=Array.from(new Float32Array([1/3,2/3,0,0]));
 const matrix=skinningMatrix({bodyMatrix:identity,bindMatrix:identity,bindMatrixInverse:identity,boneMatrices:[...identity,...identity]},[0,1,0,0],weights);
 const point=new Vector3(3,6,9).applyMatrix4(matrix),sum=weights[0]+weights[1];
 assert.equal(point.x,3*sum);
 });

 test('native intermediate belly curvature survives between the baked fit endpoints',()=>{
 const snapshots=[0,50,100,150,200].map(snapshot);
 for(const value of snapshots)value.weights=value.weights.map((_,i)=>i===42?value.bump/200:0);
 const garment=prepareShirtVariant(snapshots,native).garments[0];
 // At75 the body selects its own native target rather than the linear blend
 // of the native50/100 controls. The custom fit should preserve that excess.
 const currentNativeWeight=1,linearNativeWeight=.375,referenceNativeWeight=.5;
 const actual=garment.positions[2]+garment.targetPositions[44][2]*.5+garment.targetPositions[42][2]*(currentNativeWeight-referenceNativeWeight);
 const expected=-.25+.42*(currentNativeWeight-linearNativeWeight);
 assert.ok(Math.abs(actual-expected)<1e-7);
 });

 test('coincident source vertices with identical UVs preserve opposite cloth normals',()=>{
 const canonical={source:[.25,.25,0],positions:[.25,.25,1],normals:[0,0,-1],uv:[.25,.25]};
 const moved={source:[.25,.25,0,.25,.25,0, 0,0,0,1,0,0,0,1,0],positions:[.25,.25,1,.25,.25,-1, 0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,-1, 0,0,1,0,0,1,0,0,1],uv:[.25,.25,.25,.25,0,0,1,0,0,1],indices:[2,3,4]};
 assert.deepEqual(Array.from(resampleGarment(canonical,moved).positions),[.25,.25,-1]);
 });

 test('approved world normals survive the actual GLSL skin-normal transform under blended joint scale',async()=>{
 const {Matrix3}=await import('three');const {bindWorldNormal}=await import('./shirt-bind.mjs');
 const bone=new Matrix4().makeScale(1.2,.8,1.5).multiply(new Matrix4().makeRotationX(.2)).toArray();
 const posed={bodyMatrix:new Matrix4().makeScale(100,80,120).toArray(),bindMatrix:identity,bindMatrixInverse:identity,boneMatrices:bone};
 const world=new Vector3(.2,.4,.8).normalize(),local=bindWorldNormal(world.toArray(),posed,[0,0,0,0],[1,0,0,0]);
 const reproduced=new Vector3(...local).applyMatrix3(new Matrix3().setFromMatrix4(new Matrix4().fromArray(bone))).applyMatrix3(new Matrix3().getNormalMatrix(new Matrix4().fromArray(posed.bodyMatrix))).normalize();
 assert.ok(reproduced.distanceTo(world)<1e-10);
 });
