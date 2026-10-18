import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import * as correction from './high-hem-correction.js';

function fixture(){
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute([1,2,3],3));
 g.setAttribute('normal',new T.Float32BufferAttribute([.2,.3,.9],3));
 g.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,1,0,0],4));
 g.setAttribute('skinWeight',new T.Float32BufferAttribute([.65,.35,0,0],4));
 g.morphTargetsRelative=true;
 g.morphAttributes.normal=[new T.Float32BufferAttribute([.3,-.2,.15],3),new T.Float32BufferAttribute([-.1,.25,-.2],3)];
 const m=new T.SkinnedMesh(g,new T.MeshBasicMaterial()),a=new T.Bone(),b=new T.Bone();
 a.matrixWorld.makeRotationY(.3);b.matrixWorld.makeRotationZ(-.2);
 m.skeleton=new T.Skeleton([a,b],[new T.Matrix4(),new T.Matrix4()]);
 m.bindMatrix.identity();m.bindMatrixInverse.identity();m.matrixWorld.makeScale(1.2,.9,1.1);m.morphTargetInfluences=[.7,.35];
 return m;
}
// Independent evaluation in the actual three.js shader order. In particular,
// there is NO normalization of the base attribute before adding morph normals.
function shaderWorldNormal(mesh,base){
 const g=mesh.geometry,object=base.clone();
 for(let j=0;j<g.morphAttributes.normal.length;j++)object.addScaledVector(new T.Vector3().fromBufferAttribute(g.morphAttributes.normal[j],0),mesh.morphTargetInfluences[j]);
 const blend=new T.Matrix4();blend.elements.fill(0);
 for(let j=0;j<4;j++){
  const w=g.attributes.skinWeight.getComponent(0,j),i=g.attributes.skinIndex.getComponent(0,j);if(!w)continue;
  const matrix=new T.Matrix4().multiplyMatrices(mesh.skeleton.bones[i].matrixWorld,mesh.skeleton.boneInverses[i]);
  for(let k=0;k<16;k++)blend.elements[k]+=w*matrix.elements[k];
 }
 const skin=new T.Matrix4().multiplyMatrices(mesh.bindMatrixInverse,blend).multiply(mesh.bindMatrix);
 return object.applyMatrix3(new T.Matrix3().setFromMatrix4(skin)).applyMatrix3(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
}

test('backmapping an intended posed normal preserves shader order with active morph normals and blended bones',()=>{
 assert.equal(typeof correction.backmapPosedNormal,'function','normal correction must expose its tested backmapping helper');
 const m=fixture(),base=new T.Vector3().fromBufferAttribute(m.geometry.attributes.normal,0),old=shaderWorldNormal(m,base),target=old.clone().applyAxisAngle(new T.Vector3(1,.4,.2).normalize(),.42).normalize(),snapshot={position:m.geometry.attributes.position.array.slice(),normal:m.geometry.attributes.normal.array.slice(),morph:m.geometry.morphAttributes.normal.map(a=>a.array.slice())};
 const result=correction.backmapPosedNormal(m,0,target);
 assert.ok(shaderWorldNormal(m,result).distanceTo(target)<1e-7);
 const noop=correction.backmapPosedNormal(m,0,old);
 assert.ok(noop.distanceTo(base)<1e-7,'a zero posed-normal change must retain the base normal magnitude');
 assert.deepEqual(m.geometry.attributes.position.array,snapshot.position);
 assert.deepEqual(m.geometry.attributes.normal.array,snapshot.normal);
 m.geometry.morphAttributes.normal.forEach((a,i)=>assert.deepEqual(a.array,snapshot.morph[i]));
 // A base-normal normalize before morph addition is measurably the wrong stage.
 assert.ok(shaderWorldNormal(m,result.clone().normalize()).distanceTo(target)>1e-3);
});


test('radial Jacobian normal is orthogonal to finite-difference deformed tangents',()=>{
 const theta=.43,r=17.2,y=85.7,amount=(t,yy)=>.3+.12*Math.sin(t)+.05*(yy-85),normal=new T.Vector3(.3,.4,.7).normalize(),p=new T.Vector3(r*Math.sin(theta),y,-6+r*Math.cos(theta)),deform=q=>{const rr=Math.hypot(q.x,q.z+6),tt=Math.atan2(q.x,q.z+6),a=amount(tt,q.y);return new T.Vector3(q.x*(rr+a)/rr,q.y,-6+(q.z+6)*(rr+a)/rr);},got=correction.transportRadialNormal(normal,{theta,r,amount:amount(theta,y),dTheta:.12*Math.cos(theta),dY:.05}),tangent=normal.clone().cross(new T.Vector3(1,0,0)).normalize(),second=normal.clone().cross(tangent).normalize(),h=1e-4;
 for(const v of [tangent,second]){const derivative=deform(p.clone().addScaledVector(v,h)).sub(deform(p.clone().addScaledVector(v,-h))).multiplyScalar(1/(2*h));assert.ok(Math.abs(got.dot(derivative))<1e-8);}
 assert.ok(got.distanceTo(normal)>1e-3);
});
test('equal seam normal inputs receive equal Jacobian transport without mesh adjacency',()=>{
 const normal=new T.Vector3(.2,.5,.8).normalize(),field={theta:-.6,r:18,amount:.6,dTheta:.31,dY:-.15};
 const a=correction.transportRadialNormal(normal,field),b=correction.transportRadialNormal(normal.clone(),{...field});assert.deepEqual(a.toArray(),b.toArray());assert.deepEqual(normal.toArray(),new T.Vector3(.2,.5,.8).normalize().toArray());
 const noop=correction.transportRadialNormal(normal,{...field,amount:0,dTheta:0,dY:0});assert.ok(noop.distanceTo(normal)<1e-14);
});
