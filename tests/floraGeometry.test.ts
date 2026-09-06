/**
 * The blade, the rocks and the twigs: unit-sized, cheap, outward-facing,
 * and — for the blade — Joshua's own file, digit for digit.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BLADE_OBJ_BOUNDS, BLADE_OBJ_FACES, BLADE_OBJ_VERTICES, bladeGeometry, broadBladeGeometry,
} from '../src/flora/bladeGeometry';
import { ROCK_VARIANTS, rockGeometry, stoneGeometry, twigGeometry } from '../src/flora/propGeometry';

function triangles(g: THREE.BufferGeometry): number {
  return g.getIndex() ? (g.getIndex() as THREE.BufferAttribute).count / 3 : g.getAttribute('position').count / 3;
}

function bounds(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox as THREE.Box3;
}

/** Does every face's normal point away from the shape's centroid? (The two answers to "which way is out", checked against each other.) */
function outwardFraction(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const index = g.getIndex();
  const centroid = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) centroid.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  centroid.divideScalar(pos.count);
  const count = index ? index.count / 3 : pos.count / 3;
  let outward = 0;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  for (let t = 0; t < count; t += 1) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
    b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
    c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).sub(centroid);
    if (n.dot(mid) > 0) outward += 1;
  }
  return outward / count;
}

describe('the blade', () => {
  it('is the file: eight vertices, six quads, the bounding box the OBJ has', () => {
    expect(BLADE_OBJ_VERTICES).toHaveLength(8);
    expect(BLADE_OBJ_FACES).toHaveLength(6);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of BLADE_OBJ_VERTICES) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    }
    expect(min).toEqual([...BLADE_OBJ_BOUNDS.min]);
    expect(max).toEqual([...BLADE_OBJ_BOUNDS.max]);
    // The file's extent, as measured when it was fetched: 0.3256 x 4.9716 x 0.1933.
    expect(max[0] - min[0]).toBeCloseTo(0.3256, 3);
    expect(max[1] - min[1]).toBeCloseTo(4.9716, 3);
    expect(max[2] - min[2]).toBeCloseTo(0.1933, 3);
    // Every face index names a vertex that exists, and each face uses four distinct ones.
    for (const face of BLADE_OBJ_FACES) {
      expect(new Set(face).size).toBe(4);
      for (const i of face) expect(i).toBeLessThan(8);
    }
  });

  it('bakes to a unit blade: foot at zero, tip at one, twelve triangles, proportions kept', () => {
    const g = bladeGeometry();
    expect(triangles(g)).toBe(12);
    const box = bounds(g);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1, 6);
    // Width over height as the file has it: 0.3256 / 4.9716.
    expect(box.max.x - box.min.x).toBeCloseTo(0.3256 / 4.9716, 3);
    expect(g.getAttribute('normal').count).toBe(36);
    // Broad blade: the same, two and a half times wider.
    const broad = bounds(broadBladeGeometry());
    expect(broad.max.x - broad.min.x).toBeCloseTo((0.3256 / 4.9716) * 2.5, 3);
    expect(broad.max.y).toBeCloseTo(1, 6);
  });

  it('faces outward — the file\'s winding and the geometry\'s centroid agree', () => {
    expect(outwardFraction(bladeGeometry())).toBe(1);
  });
});

describe('rocks, stones and twigs', () => {
  it('fit a unit box with their foot on the ground, at a phone\'s triangle count', () => {
    for (let v = 0; v < ROCK_VARIANTS; v += 1) {
      for (const [name, g, cap] of [['rock', rockGeometry(v), 80], ['stone', stoneGeometry(v), 20]] as const) {
        const box = bounds(g);
        const size = new THREE.Vector3();
        box.getSize(size);
        expect(Math.max(size.x, size.y, size.z), name).toBeCloseTo(1, 6);
        expect(box.min.y, name).toBeCloseTo(0, 6);
        expect(triangles(g), name).toBe(cap);
        expect(outwardFraction(g), name).toBeGreaterThan(0.95);
      }
    }
    const twig = twigGeometry();
    const box = bounds(twig);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1, 6);
    expect(triangles(twig)).toBeLessThanOrEqual(40);
    expect(outwardFraction(twig)).toBeGreaterThan(0.9);
  });

  it('gives four rocks that are not the same rock, deterministically', () => {
    const shapes = new Set<string>();
    for (let v = 0; v < ROCK_VARIANTS; v += 1) {
      const a = Array.from((rockGeometry(v).getAttribute('position') as THREE.BufferAttribute).array).map((x) => x.toFixed(5)).join(',');
      const b = Array.from((rockGeometry(v).getAttribute('position') as THREE.BufferAttribute).array).map((x) => x.toFixed(5)).join(',');
      expect(a).toBe(b);
      shapes.add(a);
    }
    expect(shapes.size).toBe(ROCK_VARIANTS);
  });
});
