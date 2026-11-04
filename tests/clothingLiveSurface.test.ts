import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BodySurface } from '../src/sarahlab/bodySurface';
import { BodyPaint } from '../src/sarahlab/bodyPaint';
import { createJiggleUniforms } from '../src/sarahlab/softBody';
import { SkinPose } from '../src/sarahlab/skinPose';
import { clothingVertex } from '../src/sarahlab/clothingPose';
import { navelOffsetOf, type NavelOffset } from '../src/sarahlab/navelSoft';

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
  // her navel is laid in on the CPU and pushed out by the shaders by her pressure (navelSoft.ts); the readers of her
  // body for her clothes add the same push, or the cloth laid over her navel is pierced by it (Joshua, 2026-11-03)
  it('her clothes see her navel pushed out as the shaders draw it', () => {
    const {mesh, uniforms} = movingSkin();
    uniforms.belly.value.set(0, 0, 0);
    const delta = new Float32Array(3 * 4); delta.set([0, 0, 0.2], 2 * 4);
    const offset: NavelOffset = { out: { value: 0 }, delta };
    mesh.userData.navelSoft = offset;
    expect(navelOffsetOf(mesh)).toBe(offset);
    const at = (pushed: number) => {
      (offset.out as { value: number }).value = pushed;
      const pose = new SkinPose(mesh), q = [0, 0, 0]; pose.refresh(); pose.posedVertex(2, q);
      const c = clothingVertex(mesh, 2, new THREE.Vector3());
      return { pose: q[2], clothing: c.z, other: clothingVertex(mesh, 0, new THREE.Vector3()).z };
    };
    expect(at(0)).toEqual({ pose: 0, clothing: 0, other: 0 });
    const half = at(0.5);
    expect(half.pose).toBeCloseTo(0.1, 6); expect(half.clothing).toBeCloseTo(0.1, 6); expect(half.other).toBe(0);
    expect(at(1.3).pose).toBeCloseTo(0.26, 6);
  });
});

