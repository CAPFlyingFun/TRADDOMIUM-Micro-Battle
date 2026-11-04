import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { clothingModel } from './clothingModels';
import { liftShapeFields, applyShapeFields, type ShapeFields } from '../src/view/bodyShapeView';
import { GarmentShapeTransfer } from '../src/sarahlab/garmentShapeTransfer';
import { applyWomb, applyMilk, parseWombFile, parseMilkFile, babyAnchors, babyFieldWeights, milkAnchors, milkFieldWeights } from '../src/sarahlab/zeroRefine';
import { createJiggleUniforms, attachJiggle } from '../src/sarahlab/softBody';
import { BodySurface } from '../src/sarahlab/bodySurface';
import { SkinPose } from '../src/sarahlab/skinPose';
const bin=(file:string)=>{const b=readFileSync(file);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer};
let body:THREE.SkinnedMesh, shirt:THREE.SkinnedMesh, source:ShapeFields, target:ShapeFields, transfer:GarmentShapeTransfer;
const measures:Record<string,unknown>={};
beforeAll(async()=>{
  body=await clothingModel('public/models/sarah-v2-body-slim.glb');shirt=await clothingModel('public/models/sarah-v2-spandex-lite.glb');
  source=liftShapeFields(body)!;target=liftShapeFields(shirt)!;
  source=applyWomb(body,source,parseWombFile(bin('public/models/sarah-v2-body-womb.bin')))!;
  source=applyMilk(body,source,parseMilkFile(bin('public/models/sarah-v2-body-milk.bin')))!;
  const start=performance.now();transfer=new GarmentShapeTransfer(body,source);const result=transfer.sync(shirt,target,source);target=result.fields;
  measures.prepareMs=performance.now()-start;measures.transferredFields=result.added;
  measures.garmentVertices=target.basePos.length/3;measures.bodyVertices=source.basePos.length/3;
  measures.sparseBytes=[...target.fields].filter(([n])=>n.startsWith('shape:milk:')||n.startsWith('shape:baby:')).reduce((s,[,f])=>s+f.index.byteLength+f.pos.byteLength+(f.nrm?.byteLength??0),0);
},120000);
it('follows actual missing fields at all five belly checkpoints without replacing native fits',()=>{
 const native=target.fields.get('shape:fitBelly100');const times:number[]=[];
 for(const bump of [0,50,100,150,200])for(const weight of [-100,0,100])for(const milk of [0,50,100]){
  const weights={...babyFieldWeights(bump,weight,babyAnchors(source),'hybrid'),...milkFieldWeights(bump,milk,70,milkAnchors(source),'hybrid')};
  const t=performance.now();applyShapeFields(shirt,target,weights,{normalizeNormals:false});times.push(performance.now()-t);
  const p=shirt.geometry.getAttribute('position');let moved=0;for(let v=0;v<p.count;v++){expect(Number.isFinite(p.getX(v)+p.getY(v)+p.getZ(v))).toBe(true);moved+=Math.abs(p.getZ(v)-target.basePos[v*3+2]);}
  if(bump>=50&&(weight!==0||milk>0))expect(moved).toBeGreaterThan(.001);
 }
 expect(target.fields.get('shape:fitBelly100')).toBe(native);
 times.sort((a,b)=>a-b);measures.shapeUpdates=times.length;measures.medianApplyMs=times[Math.floor(times.length/2)];measures.p95ApplyMs=times[Math.floor(times.length*.95)];
 console.log('CLOTHING_REAL_FIELDS',JSON.stringify(measures));
},120000);
it('real-body anchors agree with the existing live SkinPose reader during breast and belly motion',()=>{
 const uniforms=createJiggleUniforms();attachJiggle(body,uniforms);body.updateMatrixWorld(true);
 const surface=new BodySurface(body,body.geometry.index!.array,source.basePos), pose=new SkinPose(body), point=new Float32Array(3), p=new THREE.Vector3(), q=new THREE.Vector3();
 const weights=body.userData.jiggle.weights as Float32Array;let hits=0,worst=0;
 for(let frame=0;frame<8;frame++){
  uniforms.belly.value.set(.005*Math.sin(frame),-.008,.012*Math.cos(frame));uniforms.breastL.value.set(0,.015,0);pose.refresh();
  const inv=body.matrixWorld.clone().invert();
  for(let tri=0;tri<surface.triangleCount;tri+=83){const v=body.geometry.index!.getX(tri*3);if(weights[v*3]+weights[v*3+1]+weights[v*3+2]<.1)continue;
   surface.evaluate({tri,bary:[1,0,0]},p);pose.posedVertex(v,point);q.fromArray(point).applyMatrix4(inv);worst=Math.max(worst,p.distanceTo(q));hits++;
  }
 }
 expect(hits).toBeGreaterThan(50);expect(worst).toBeLessThan(1e-6);console.log('CLOTHING_REAL_SURFACE',JSON.stringify({hits,worstLocalUnits:worst}));
},120000);
