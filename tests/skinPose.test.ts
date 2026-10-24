/**
 * A FEW OF HER VERTICES POSED ON THE CPU (`skinPose.ts`): the room follows her navel and nipples through about a hundred
 * vertices a frame, without the cloth's weld and neighbour tables. Here: on a small rig -- two bones, one moved, a
 * relative morph target on, a bind matrix that is not the identity, a parent that moves her -- every vertex lands where
 * three's own `SkinnedMesh.getVertexPosition` and her world matrix put it, before and after a bone, an influence and her
 * position array change; a plain mesh with an absolute morph and interleaved positions too; a vertex asked for twice in
 * one refresh is posed once; and 100 vertices × 1,000 refreshes of a body her size is timed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SkinPose } from '../src/sarahlab/skinPose';

/** Three's answer for vertex v: morphs, bones, then her world matrix. */
function threePosed(mesh: THREE.Mesh, v: number): THREE.Vector3 {
  return mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
}

/** Every vertex of `mesh` posed by `pose` (refreshed first) against three's own, to 1e-5. */
function expectMatchesThree(pose: SkinPose, mesh: THREE.Mesh): void {
  pose.refresh();
  const out = new Float32Array(3);
  const n = mesh.geometry.getAttribute('position').count;
  for (let v = 0; v < n; v++) {
    pose.posedVertex(v, out);
    const want = threePosed(mesh, v);
    expect(Math.abs(out[0] - want.x), `vertex ${v} x`).toBeLessThan(1e-5);
    expect(Math.abs(out[1] - want.y), `vertex ${v} y`).toBeLessThan(1e-5);
    expect(Math.abs(out[2] - want.z), `vertex ${v} z`).toBeLessThan(1e-5);
  }
}

/** A small skinned body: six vertices up a column, two bones, one relative morph target, a parent group. */
function rig(opts: { normalizedWeights?: boolean } = {}): { mesh: THREE.SkinnedMesh; parent: THREE.Group; root: THREE.Bone; child: THREE.Bone } {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0, 0, -0.2, 0.4, 0.1, 0.3, 0.8, -0.1, 0, 1.2, 0.2, -0.1, 1.6, 0, 0.2, 2, -0.3], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const weights = [1, 0, 0, 0, 0.75, 0.25, 0, 0, 0.5, 0.5, 0, 0, 0.6, 0.4, 0, 0, 0.9, 0.1, 0, 0, 1, 0, 0, 0];
  g.setAttribute('skinWeight', opts.normalizedWeights
    ? new THREE.Uint8BufferAttribute(weights.map((w) => Math.round(w * 255)), 4, true)
    : new THREE.Float32BufferAttribute(weights, 4));
  g.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0.3, 0.1, 0, 0.2, 0, 0.1, 0, -0.2, 0, 0.1, 0, 0, -0.4, 0.05, 0.05, 0.05], 3)];
  g.morphTargetsRelative = true;
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  mesh.morphTargetInfluences![0] = 0.6;
  const root = new THREE.Bone(), child = new THREE.Bone();
  child.position.set(0, 1, 0);
  root.add(child);
  mesh.add(root);
  const parent = new THREE.Group();
  parent.position.set(3, -1, 2);
  parent.rotation.set(0.2, -0.7, 0.1);
  parent.scale.setScalar(1.3);
  parent.add(mesh);
  mesh.position.set(-0.5, 0.25, 0.75);
  mesh.rotation.set(0, 0.4, -0.2);
  parent.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([root, child]); // inverses from the bones as they stand now
  const bind = new THREE.Matrix4().compose(new THREE.Vector3(0.2, -0.1, 0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0.3)), new THREE.Vector3(0.9, 0.9, 0.9));
  mesh.bind(skeleton, bind);
  // and a pose: the child bent, the root moved
  child.rotation.set(0.3, 0, 0.5);
  root.position.set(0.3, 0.1, 0);
  parent.updateMatrixWorld(true);
  return { mesh, parent, root, child };
}

describe('posing a few of her vertices', () => {
  it('puts every vertex where three does, and follows a bone, an influence and her positions', () => {
    const { mesh, parent, child } = rig();
    const pose = new SkinPose(mesh);
    expectMatchesThree(pose, mesh);

    child.rotation.set(-0.4, 0.2, 1.1);
    parent.updateMatrixWorld(true);
    expectMatchesThree(pose, mesh);

    mesh.morphTargetInfluences![0] = 0.15;
    expectMatchesThree(pose, mesh);

    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (pos.array as Float32Array)[4 * 3 + 2] += 0.5; // a shape slider writes her positions on the CPU
    (pos.array as Float32Array)[1 * 3] -= 0.25;
    expectMatchesThree(pose, mesh);

    parent.position.x += 2; // the room moves her
    parent.updateMatrixWorld(true);
    expectMatchesThree(pose, mesh);
  });

  it('reads normalized skin weights the way three does', () => {
    const { mesh } = rig({ normalizedWeights: true });
    expectMatchesThree(new SkinPose(mesh), mesh);
  });

  it('poses a plain mesh: an absolute morph target and interleaved positions', () => {
    const data = new THREE.InterleavedBuffer(new Float32Array([0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9, 1, 1, 1, 9]), 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
    g.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1, 0, 1, 1, 2, 2, 2], 3)];
    g.morphTargetsRelative = false;
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.morphTargetInfluences![0] = 0.4;
    mesh.position.set(1, 2, 3);
    mesh.rotation.set(0.5, 0.1, -0.3);
    mesh.updateMatrixWorld(true);
    const pose = new SkinPose(mesh);
    expectMatchesThree(pose, mesh);
    data.array[1] = 5; // vertex 0's y, live
    expectMatchesThree(pose, mesh);
  });

  it('poses a vertex once a refresh, however often it is asked for', () => {
    const { mesh } = rig();
    const pose = new SkinPose(mesh);
    const a = [0, 0, 0], b = [0, 0, 0, 0, 0, 0];
    pose.posedVertex(2, a); // before any refresh: refreshes itself
    expect(pose.posedCount).toBe(1);
    pose.posedVertex(2, b, 3);
    expect(pose.posedCount).toBe(1);
    expect(b.slice(3)).toEqual(a);
    // the cache holds for the rest of the refresh: a change to her positions waits for the next one
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (pos.array as Float32Array)[2 * 3] += 1;
    pose.posedVertex(2, b);
    expect(b.slice(0, 3)).toEqual(a);
    expect(pose.posedCount).toBe(1);
    pose.posedVertex(3, b);
    expect(pose.posedCount).toBe(2);
    pose.refresh();
    expect(pose.posedCount).toBe(0);
    pose.posedVertex(2, b);
    expect(pose.posedCount).toBe(1);
    const want = threePosed(mesh, 2);
    expect(Math.abs(b[0] - want.x)).toBeLessThan(1e-5);
    expect(Math.abs(b[0] - a[0])).toBeGreaterThan(0.1);
  });

  it('refuses a vertex she does not have', () => {
    const { mesh } = rig();
    const pose = new SkinPose(mesh);
    pose.refresh();
    expect(() => pose.posedVertex(6, [0, 0, 0])).toThrow(RangeError);
    expect(() => pose.posedVertex(-1, [0, 0, 0])).toThrow(RangeError);
  });

  it('times 100 vertices × 1,000 refreshes on a body her size', () => {
    const nV = 116_000, nBones = 80, nMorphs = 4;
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    const position = new Float32Array(nV * 3).map(() => rand() * 2 - 1);
    const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
    for (let v = 0; v < nV; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) { si[v * 4 + k] = Math.floor(rand() * nBones); sw[v * 4 + k] = k < 2 ? rand() : 0; sum += sw[v * 4 + k]; }
      for (let k = 0; k < 4; k++) sw[v * 4 + k] /= sum;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.morphAttributes.position = Array.from({ length: nMorphs }, () => new THREE.BufferAttribute(new Float32Array(nV * 3).map(() => rand() * 0.01), 3));
    g.morphTargetsRelative = true;
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    mesh.morphTargetInfluences!.fill(0.5);
    const bones = Array.from({ length: nBones }, () => new THREE.Bone());
    for (let b = 1; b < nBones; b++) { bones[b].position.set(0, 0.05, 0); bones[b - 1].add(bones[b]); }
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    for (const b of bones) b.rotation.z = 0.02;
    mesh.updateMatrixWorld(true);

    const followed = Array.from({ length: 100 }, (_, i) => Math.floor((i * nV) / 100) + 7);
    const t0 = performance.now();
    const pose = new SkinPose(mesh);
    const built = performance.now() - t0;
    const t2 = performance.now();
    pose.refresh(); // the first refresh sizes its per-vertex cache to her
    const first = performance.now() - t2;
    const out = new Float32Array(300);
    const frames = 1000, t1 = performance.now();
    for (let f = 0; f < frames; f++) {
      pose.refresh();
      for (let i = 0; i < followed.length; i++) pose.posedVertex(followed[i], out, i * 3);
    }
    const ran = performance.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`[skinPose] ${nV} vertices, ${nBones} bones, ${nMorphs} morphs on: built in ${built.toFixed(2)} ms, first refresh ${first.toFixed(2)} ms; `
      + `100 vertices × ${frames} refreshes in ${ran.toFixed(1)} ms = ${((ran / frames) * 1000).toFixed(1)} µs a frame`);
    expect(pose.posedCount).toBe(100);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
    const want = threePosed(mesh, followed[42]);
    expect(Math.abs(out[42 * 3] - want.x)).toBeLessThan(1e-4);
    expect(Math.abs(out[42 * 3 + 1] - want.y)).toBeLessThan(1e-4);
    expect(Math.abs(out[42 * 3 + 2] - want.z)).toBeLessThan(1e-4);
  });
});
