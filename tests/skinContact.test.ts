/**
 * skinContact.ts on a ball whose answer is known: a sphere of radius 1 sampled every 15 cm, asked how deep points are
 * in it and how far a limb through it goes in -- at the origin, and moved and turned (its world matrix is applied, as
 * her model's is).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SkinContact, spreadTriangles } from '../src/sarahlab/skinContact';
import { SkinPose } from '../src/sarahlab/skinPose';

function ball(at = new THREE.Vector3(), turn = new THREE.Euler()) {
  const g = new THREE.SphereGeometry(1, 64, 32), mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.position.copy(at); mesh.rotation.copy(turn); mesh.updateMatrixWorld(true);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const restOf = (v: number, out: THREE.Vector3) => out.fromBufferAttribute(pos, v);
  const corners = spreadTriangles(g.index ? g.index.array : null, pos.count, restOf, () => true, 0.15);
  const pose = new SkinPose(mesh); pose.refresh();
  const contact = new SkinContact(); contact.lay(pose, corners, 0.4);
  return { contact, corners, pos, restOf, g };
}

describe('how far into her (skinContact)', () => {
  it('spreads its samples: far fewer than the triangles, and each a real one of them', () => {
    const { corners, g } = ball();
    const tris = g.index!.count / 3;
    expect(corners.length % 3).toBe(0);
    expect(corners.length / 3).toBeGreaterThan(100);
    expect(corners.length / 3).toBeLessThan(tris / 2);
  });

  it('keeps only the triangles asked for', () => {
    const { pos, restOf, g } = ball();
    const v = new THREE.Vector3();
    const front = spreadTriangles(g.index!.array, pos.count, restOf, (a, b, c) => [a, b, c].every((i) => restOf(i, v).z > 0), 0.15);
    for (const i of front) expect(restOf(i, v).z).toBeGreaterThan(0);
  });

  it('says a point inside is in by how far under the skin it is, and one outside is out', () => {
    const { contact } = ball();
    expect(contact.depth(0, 0, 0.8)).toBeCloseTo(0.2, 1);
    expect(contact.depth(0.5, 0.5, 0)).toBeCloseTo(1 - Math.SQRT1_2, 1);
    expect(contact.depth(0, 0, 1.2)).toBeCloseTo(-0.2, 1);
    expect(contact.depth(0, -1.1, 0)).toBeCloseTo(-0.1, 1);
  });

  it('says nothing of a point with none of the skin near', () => {
    const { contact } = ball();
    expect(contact.depth(5, 5, 5)).toBe(-Infinity);
  });

  it('finds a limb through the skin in by its depth and its radius, and one clear of it out', () => {
    const { contact } = ball();
    const a = new THREE.Vector3(-0.3, 0, 0.9), b = new THREE.Vector3(0.3, 0, 0.9);
    expect(contact.limbIn(a, b, 0.05, 0.05, 0, 1, 6)).toBeCloseTo(0.15, 1);
    const c = new THREE.Vector3(-0.3, 0, 1.2), d = new THREE.Vector3(0.3, 0, 1.2);
    expect(contact.limbIn(c, d, 0.05, 0.05, 0, 1, 6)).toBeLessThan(0);
  });

  it('reads the skin where it is drawn: moved and turned with its world matrix', () => {
    const { contact } = ball(new THREE.Vector3(3, -2, 1), new THREE.Euler(0.4, 1.1, -0.3));
    expect(contact.depth(3, -2, 1.8)).toBeCloseTo(0.2, 1);
    expect(contact.depth(3, -2, 2.2)).toBeCloseTo(-0.2, 1);
    expect(contact.depth(0, 0, 0.8)).toBe(-Infinity);
  });
});
