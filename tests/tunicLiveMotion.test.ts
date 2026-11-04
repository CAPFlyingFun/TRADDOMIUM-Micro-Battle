import { expect, it } from 'vitest';
import * as THREE from 'three';
import { TunicDrape } from '../src/sarahlab/tunicDrape';
import { BODY_REGIONS, type BodyMap } from '../src/sarahlab/bodyRegions';
import { attachJiggle, createJiggleUniforms, jiggleOf, jiggleAt } from '../src/sarahlab/softBody';

it('the painted drape follows live mass motion and pushes without rebuilding or baking the displacement twice',()=>{
 const g=new THREE.CylinderGeometry(.18,.2,1.2,32,32,true),p=g.getAttribute('position'),n=p.count;
 g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(n*4),4));
 const sw=new Float32Array(n*4),delta=new Float32Array(n*3);for(let v=0;v<n;v++){sw[v*4]=1;delta[v*3+1]=.01;}
 g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));g.morphAttributes.position=[new THREE.Float32BufferAttribute(delta,3)];g.morphTargetsRelative=true;
 const body=new THREE.SkinnedMesh(g),bone=new THREE.Bone();body.add(bone);body.updateMatrixWorld(true);body.bind(new THREE.Skeleton([bone]));
 body.morphTargetDictionary={bellyBob:0};body.morphTargetInfluences=[0];const uniforms=createJiggleUniforms();attachJiggle(body,uniforms);
 const region=new Uint8Array(n).fill(BODY_REGIONS.findIndex(r=>r.id==='belly')+1),trunk=new Float32Array(n),around=new Float32Array(n);
 for(let v=0;v<n;v++){trunk[v]=p.getY(v)+.2;around[v]=(p.getZ(v)/.2+1)/2;}
 const map={region,trunk,around,arm:new Float32Array(n).fill(NaN),trunkLength:1} as BodyMap;
 const drape=new TunicDrape(body,map,-.3);drape.wear(-.1);drape.update(0);
 const follow=jiggleOf(drape.mesh);expect(follow).not.toBeNull();expect(follow!.uniforms).toBe(uniforms);
 const attribute=drape.mesh.geometry.getAttribute('position') as THREE.BufferAttribute,version=attribute.version,rest=attribute.array.slice();
 uniforms.belly.value.y=.02;jiggleOf(body)!.push.fill(.003);drape.update(1);
 expect(attribute.version).toBe(version);expect(attribute.array).toEqual(rest);
 const at={x:0,y:0,z:0};let moved=0,pushed=0;
 for(let v=0;v<attribute.count;v++){jiggleAt(follow!,v,at);moved=Math.max(moved,at.y);pushed=Math.max(pushed,follow!.push[v*3]);}
 expect(moved).toBeGreaterThan(.015);expect(moved).toBeLessThan(.03);expect(pushed).toBeCloseTo(.003,5);
 expect(drape.mesh.morphTargetInfluences![0]).toBe(0);
 drape.reshape();drape.update(1000);expect(jiggleOf(drape.mesh)!.uniforms).toBe(uniforms);drape.dispose();
});
