import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BodySurface } from '../src/sarahlab/bodySurface';
import { BodyPaint } from '../src/sarahlab/bodyPaint';
import { createJiggleUniforms } from '../src/sarahlab/softBody';

function movingSkin() {
  const g = new THREE.BufferGeometry();
  const rest = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(rest.slice(), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  g.setIndex([0,1,2]);
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const mesh = new THREE.SkinnedMesh(g);
  const bone = new THREE.Bone(); mesh.add(bone); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton([bone]));
  const uniforms = createJiggleUniforms();
  uniforms.belly.value.set(.4, .2, .5);
  mesh.userData.jiggle = { uniforms, weights: new Float32Array([1,0,0,1,0,0,1,0,0]), push: new Float32Array(9) };
  mesh.updateMatrixWorld(true);
  return {mesh,rest,uniforms};
}

describe('clothing reads the displayed skin', () => {
  it('surface anchors include shader offsets and refresh when motion changes', () => {
    const {mesh,rest,uniforms} = movingSkin();
    const surface = new BodySurface(mesh,[0,1,2],rest), p = new THREE.Vector3();
    const anchor = {tri:0,bary:[.25,.25,.5] as const};
    surface.evaluate(anchor,p);
    expect(p.distanceTo(new THREE.Vector3(.4,.2,.5))).toBeLessThan(1e-7);
    uniforms.belly.value.set(-.3,0,.1);
    surface.evaluate(anchor,p);
    expect(p.distanceTo(new THREE.Vector3(-.3,0,.1))).toBeLessThan(1e-7);
    expect(surface.restPoint(anchor,p).toArray()).toEqual([0,0,0]);
  });
  it('paint picking lands on the displaced skin at stroke start', () => {
    const {mesh} = movingSkin();
    const paint = new BodyPaint(mesh);
    const camera = new THREE.OrthographicCamera(-2,2,2,-2,.1,100);
    camera.position.z=5; camera.updateMatrixWorld(true);
    paint.beginStroke(camera,400,400);
    expect(paint.pick(240,80,2)).toBe(2); // vertex (0,1) plus (.4,.2), x/y in pixels
  });
});
