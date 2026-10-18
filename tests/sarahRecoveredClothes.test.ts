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
