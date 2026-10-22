import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {fitWeights,applyRecoveredBaseline,attachRecoveredMeshes,recoveredMetadata} from '../src/sarahlab/recoveredClothes';
describe('recovered clothes share the approved rig and fitted baseline',()=>{
 it('interpolates adjacent fit keys continuously without overshooting',()=>{
  expect(fitWeights(100,'shape:fitBelly')).toEqual({'shape:fitBelly100':1});
  expect(fitWeights(125,'shape:fitBelly')).toEqual({'shape:fitBelly100':.5,'shape:fitBelly150':.5});
  for(let b=0;b<=200;b+=.5){const weights=fitWeights(b,'shape:fitBelly');expect(Object.values(weights).reduce((a,b)=>a+b,0)).toBeCloseTo(1);expect(Object.values(weights).every(w=>w>=0&&w<=1)).toBe(true);}
 });
 it('subtracts the baked native baseline once while retaining slider and spring changes',()=>{
  const m=new THREE.Mesh();m.morphTargetDictionary={bellyTilt:0,breastGrow:1,bellyBob:2};m.morphTargetInfluences=[.8,.6,.12];
  m.userData.recoveredShirt={baselineWeightsByBump:{100:{bellyTilt:1,breastGrow:.3},150:{bellyTilt:1.5,breastGrow:.5}}};
  applyRecoveredBaseline(m,125);expect(m.morphTargetInfluences[0]).toBeCloseTo(-.45);expect(m.morphTargetInfluences[1]).toBeCloseTo(.2);expect(m.morphTargetInfluences[2]).toBe(.12);
 });
 it('rebinds garment siblings to the exact active body skeleton without changing the body',()=>{
  const root=new THREE.Group(),body=new THREE.SkinnedMesh(new THREE.BufferGeometry());body.geometry.setAttribute('position',new THREE.Float32BufferAttribute([1,2,3],3));const bone=new THREE.Bone();root.add(bone,body);body.bind(new THREE.Skeleton([bone]));const before=body.geometry.attributes.position.array.slice();
  const loaded=new THREE.Group(),cloth=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial());loaded.add(cloth);const meshes=attachRecoveredMeshes(loaded,body,'shirtSpandexHigh');
  expect(meshes).toEqual([cloth]);expect(cloth.skeleton).toBe(body.skeleton);expect(cloth.parent).toBe(body.parent);expect(cloth.material.name).toBe('shirtSpandexHigh');expect(body.geometry.attributes.position.array).toEqual(before);
 });
 it('accepts metadata on the loaded root or a mesh',()=>{const g=new THREE.Group(),m=new THREE.Mesh();g.add(m);g.userData.recoveredShirt={baselineWeightsByBump:{100:{}}};expect(recoveredMetadata(g)).toEqual(g.userData.recoveredShirt);});
});

import {wornGarments,nextOutfit,trimShown} from '../src/sarahlab/sarahLabTool';
it('offers both recovered fits and rises on v2 while v1 cycles its existing outfits',()=>{
 const v2=['shirt','leggings','leggingsLow','bikini','swimsuit','shirtRelaxedHigh','shirtRelaxedLow','shirtSpandexHigh','shirtSpandexLow'] as const;
 expect(wornGarments(0,v2)).toEqual(['shirtRelaxedHigh','leggings']);
 expect(wornGarments(1,v2)).toEqual(['shirtRelaxedLow','leggingsLow']);
 expect(wornGarments(5,v2)).toEqual(['shirtSpandexHigh','leggings']);
 expect(wornGarments(6,v2)).toEqual(['shirtSpandexLow','leggingsLow']);
 expect(nextOutfit(4,['shirtAthletic','leggings','bikini','swimsuit'])).toBe(0);
 expect(trimShown('leggingsTrim',['shirtSpandexHigh','leggings'])).toBe(false);
});

import {LEGGINGS_UNDER_SHIRT_CM,updateLeggingsHem} from '../src/sarahlab/recoveredClothes';
it('runs the high leggings on under each shirt before hiding them, less under the closer spandex',()=>{
 // Joshua, 2026-10-18: looking up under the hem at 200% showed skin where the pants were hidden right at it
 expect(LEGGINGS_UNDER_SHIRT_CM.relaxed).toBeGreaterThan(LEGGINGS_UNDER_SHIRT_CM.spandex);
 expect(LEGGINGS_UNDER_SHIRT_CM.spandex).toBeGreaterThan(0);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,1,0],3));
 for(const b of [0,50,100,150,200])for(const st of ['relaxed','spandex'])g.setAttribute(`_hem_${st}_${b}`,new THREE.Float32BufferAttribute([3,-2],1));
 const m=new THREE.SkinnedMesh(g,new THREE.MeshStandardMaterial());
 updateLeggingsHem(m,100,'relaxed');expect(g.getAttribute('recoveredHemDistance').getX(0)).toBeCloseTo(3-LEGGINGS_UNDER_SHIRT_CM.relaxed);
 updateLeggingsHem(m,100,'spandex');expect(g.getAttribute('recoveredHemDistance').getX(0)).toBeCloseTo(3-LEGGINGS_UNDER_SHIRT_CM.spandex);
 expect(g.getAttribute('recoveredHemDistance').getX(1)).toBeLessThan(0);
});
import {LEGGINGS_FIT_KEYS} from '../src/sarahlab/recoveredClothes';
import {bodyNeverHidden} from '../src/sarahlab/sarahLabTool';
it('blends the high leggings across every native belly key, so in-between sizes are two corrected shapes',()=>{
 expect([...LEGGINGS_FIT_KEYS]).toEqual([0,25,30,50,60,75,100,150,200]);
 expect(fitWeights(25,'k',LEGGINGS_FIT_KEYS)).toEqual({k25:1});
 expect(fitWeights(10,'k',LEGGINGS_FIT_KEYS)).toEqual({k0:0.6,k25:0.4});
 const w=fitWeights(27,'k',LEGGINGS_FIT_KEYS);expect(w.k25).toBeCloseTo(0.6,10);expect(w.k30).toBeCloseTo(0.4,10);
 const v=fitWeights(65,'k',LEGGINGS_FIT_KEYS);expect(v.k60).toBeCloseTo(2/3,10);expect(v.k75).toBeCloseTo(1/3,10);
 expect(fitWeights(175,'k',LEGGINGS_FIT_KEYS)).toEqual({k150:0.5,k200:0.5});
 expect(fitWeights(250,'k',LEGGINGS_FIT_KEYS)).toEqual({k200:1});
 // the shirts keep their five keys
 expect(fitWeights(25,'s')).toEqual({s0:0.5,s50:0.5});
 for(let b=0;b<=200;b+=1){const s=Object.values(fitWeights(b,'k',LEGGINGS_FIT_KEYS)).reduce((a,x)=>a+x,0);expect(s).toBeCloseTo(1,10);}
});
it('never hides the v2 body under clothes, and keeps v1 cover masking',()=>{
 expect(bodyNeverHidden('v2')).toBe(true);expect(bodyNeverHidden('v2-recovered')).toBe(true);expect(bodyNeverHidden('v1')).toBe(false);
});
import {SHIRT_FINE_FIT_KEYS} from '../src/sarahlab/recoveredClothes';
import {readFileSync} from 'node:fs';
it('fine-fits the fitted shirts every 10% to 100% and every 5% past it, and leaves the loose shirts alone',()=>{
 // Joshua, 2026-10-20: "appears like to have 3 bellybuttons, lol, shirt defects on the side"
 expect([...SHIRT_FINE_FIT_KEYS]).toEqual([...Array.from({length:10},(_,i)=>i*10),...Array.from({length:21},(_,i)=>100+i*5)]);
 expect(fitWeights(122.5,'n',SHIRT_FINE_FIT_KEYS)).toEqual({n120:0.5,n125:0.5});
 expect(fitWeights(85,'n',SHIRT_FINE_FIT_KEYS)).toEqual({n80:0.5,n90:0.5});
 expect(fitWeights(0,'n',SHIRT_FINE_FIT_KEYS)).toEqual({n0:1});
 for(let b=0;b<=200;b+=2.5){const s=Object.values(fitWeights(b,'n',SHIRT_FINE_FIT_KEYS)).reduce((a,x)=>a+x,0);expect(s).toBeCloseTo(1,10);}
 for(const v of ['spandex-high','spandex-low']){const extras=JSON.parse(readFileSync(`assets-archive/models/sarah-v2-${v}.gltf`,'utf8')).meshes[0].extras,names=extras.targetNames as string[];
  expect(names.filter(n=>n.startsWith('shape:fineFit'))).toEqual(SHIRT_FINE_FIT_KEYS.map(k=>`shape:fineFit${k}`));
  expect(names.filter(n=>n.startsWith('shape:fitBelly'))).toEqual([0,50,100,150,200].map(k=>`shape:fitBelly${k}`));
  expect(names.some(n=>n.startsWith('shape:navelFit'))).toBe(false);
  expect(extras.recoveredShirt.fineFit.fitsSmoothed).toEqual([0,50,100,150,200]);}
 for(const v of ['relaxed-high','relaxed-low']){const names=JSON.parse(readFileSync(`assets-archive/models/sarah-v2-${v}.gltf`,'utf8')).meshes[0].extras.targetNames as string[];expect(names.some(n=>n.startsWith('shape:fineFit')||n.startsWith('shape:navelFit'))).toBe(false);}
});
