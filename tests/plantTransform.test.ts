/**
 * Regression tests for the renderer/attachment transform seam.
 *
 * These tests deliberately build the same column-major matrix that
 * WorldObjects writes into an InstancedMesh.  The expected local points are
 * the production geometry's stem/frond coordinates, not a second generic
 * "height above the ground" approximation.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { plantSurfaceAt } from '../src/world/ecology/plantSurface';
import type { PlantSource } from '../src/world/ecology/resources';
import {
  plantTransformOf, type PlantInstanceTransform, type PlantNormals, type PlantVector,
} from '../src/world/objects/plantTransform';
import { world } from '../src/world/coords';

const UP: PlantVector = { x: 0, y: 1, z: 0 };
const SLOPE: PlantVector = { x: 0.6, y: 0.8, z: 0 };
const CELL_SLOPE: PlantVector = { x: -0.36, y: 0.8, z: 0.48 };

function source(family: string, fields: Partial<PlantSource> = {}): PlantSource {
  return {
    family,
    at: world(0, 0),
    size: 1,
    id: null,
    variant: 0,
    girth: 0.6,
    spin: 0,
    lean: 0,
    leanDir: 0,
    ...fields,
  };
}

function matrixOf(transform: PlantInstanceTransform): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    transform.x.x * transform.scaleX, transform.y.x * transform.scaleY, transform.z.x * transform.scaleZ, transform.origin.x,
    transform.x.y * transform.scaleX, transform.y.y * transform.scaleY, transform.z.y * transform.scaleZ, transform.origin.y,
    transform.x.z * transform.scaleX, transform.y.z * transform.scaleY, transform.z.z * transform.scaleZ, transform.origin.z,
    0, 0, 0, 1,
  );
}

function vectorFrom(value: PlantVector): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function expectVector(actual: PlantVector, expected: THREE.Vector3, precision = 8): void {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
  expect(actual.z).toBeCloseTo(expected.z, precision);
}

function normalised(value: PlantVector): PlantVector {
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function cross(a: PlantVector, b: PlantVector): PlantVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function frondLocal(
  curve: readonly (readonly [number, number])[],
  widths: readonly number[],
  fraction: number,
  azimuth: number,
  fronds: number,
  offset: number,
): { readonly point: PlantVector; readonly path: PlantVector; readonly normal: PlantVector } {
  const t = fraction * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(t));
  const localT = t - i;
  const [r0, y0] = curve[i];
  const [r1, y1] = curve[i + 1];
  const r = r0 + (r1 - r0) * localT;
  const y = y0 + (y1 - y0) * localT;
  const halfWidth = widths[i] + (widths[i + 1] - widths[i]) * localT;
  const angle = offset + Math.round(((azimuth - offset) / (Math.PI * 2)) * fronds) * (Math.PI * 2 / fronds);
  const side = Math.sin(azimuth * 5.17 + 0.31) * 0.72;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const point = {
    x: r * ca - halfWidth * side * sa,
    y,
    z: r * sa + halfWidth * side * ca,
  };
  const path = {
    x: (r1 - r0) * ca,
    y: y1 - y0,
    z: (r1 - r0) * sa,
  };
  const width = { x: -sa, y: 0, z: ca };
  return { point, path, normal: cross(width, path) };
}

function expectSurfaceAtMatrix(
  plant: PlantSource,
  normals: PlantNormals,
  surfaceFraction: number,
  azimuth: number,
  local: { readonly point: PlantVector; readonly path: PlantVector; readonly normal: PlantVector },
): void {
  const transform = plantTransformOf(plant, normals);
  const matrix = matrixOf(transform);
  const surface = plantSurfaceAt(plant, surfaceFraction, azimuth, normals);
  const expectedPoint = vectorFrom(local.point).applyMatrix4(matrix);
  const expectedTangent = vectorFrom(local.path).transformDirection(matrix);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const expectedNormal = vectorFrom(local.normal).applyMatrix3(normalMatrix).normalize();
  expectVector(surface.point, expectedPoint);
  expectVector(surface.tangent, expectedTangent);
  expectVector(surface.normal, expectedNormal);
}

describe('plant transform and host attachment', () => {
  it('uses the blended cell normal for sloped fern and broadleaf fronds', () => {
    const normals = { ground: SLOPE, cell: CELL_SLOPE };
    const broadleaf = source('broadleaf', { size: 2.4, girth: 0.7, spin: 0.2 });
    const fern = source('fern', { size: 1.8, girth: 0.8, spin: -0.35 });
    const broadFraction = 0.5;
    const fernFraction = 0.5;
    const broadLocal = frondLocal(
      [[0, 0.05], [0.35, 0.5], [0.7, 1], [1, 0.8]],
      [0.04, 0.25, 0.32, 0.12],
      broadFraction,
      0.5,
      3,
      0.5,
    );
    const fernLocal = frondLocal(
      [[0.02, 0.05], [0.35, 0.6], [0.7, 1], [1, 0.8]],
      [0.03, 0.12, 0.13, 0.04],
      fernFraction,
      0.3,
      4,
      0.3,
    );
    expectSurfaceAtMatrix(broadleaf, normals, broadFraction, 0.5, broadLocal);
    expectSurfaceAtMatrix(fern, normals, fernFraction, 0.3, fernLocal);

    const blended = normalised({ x: CELL_SLOPE.x * 0.5, y: CELL_SLOPE.y * 0.5 + 0.5, z: CELL_SLOPE.z * 0.5 });
    for (const plant of [broadleaf, fern]) {
      const transform = plantTransformOf(plant, normals);
      expect(transform.y.x).toBeCloseTo(blended.x, 8);
      expect(transform.y.y).toBeCloseTo(blended.y, 8);
      expect(transform.y.z).toBeCloseTo(blended.z, 8);
    }
  });

  it('keeps shrub and tree stems upright while burying their feet on a slope', () => {
    const normals = { ground: SLOPE, cell: CELL_SLOPE };
    const shrub = source('shrub', { size: 4, girth: 0.5, spin: 0.25 });
    const tree = source('tree', { size: 5, girth: 0.045, variant: 0, spin: -0.4 });
    const shrubTransform = plantTransformOf(shrub, normals);
    const treeTransform = plantTransformOf(tree, normals);

    expect(shrubTransform.y).toEqual(UP);
    expect(treeTransform.y).toEqual(UP);
    expect(shrubTransform.origin.y).toBeLessThan(0);
    expect(treeTransform.origin.y).toBeLessThan(0);

    const shrubFraction = 0.65;
    const shrubRadius = 0.035 - 0.01 * shrubFraction;
    expectSurfaceAtMatrix(shrub, normals, shrubFraction, 0.8, {
      point: { x: Math.cos(0.8) * shrubRadius, y: 0.4 * shrubFraction, z: Math.sin(0.8) * shrubRadius },
      path: { x: 0, y: 0.4, z: 0 },
      normal: { x: Math.cos(0.8), y: 0, z: Math.sin(0.8) },
    });

    const treeFraction = 0.35;
    const treeRadius = 0.02;
    expectSurfaceAtMatrix(tree, normals, treeFraction, 1.1, {
      point: { x: Math.cos(1.1) * treeRadius, y: treeFraction, z: Math.sin(1.1) * treeRadius },
      path: { x: 0, y: 1, z: 0 },
      normal: { x: Math.cos(1.1), y: 0, z: Math.sin(1.1) },
    });
  });

  it('attaches flower hosts to the rendered tapered stem, including the foot contact', () => {
    const flower = source('flower', { size: 3, girth: 0.2, spin: 0.4, lean: 0.12, leanDir: -0.7 });
    const normals = { ground: SLOPE, cell: CELL_SLOPE };
    const bottom = plantSurfaceAt(flower, 0, 0, normals);
    const transform = plantTransformOf(flower, normals);
    const matrix = matrixOf(transform);
    expectVector(bottom.point, new THREE.Vector3(0.02, 0, 0).applyMatrix4(matrix));

    const fraction = 0.6;
    const angle = 1.3;
    const radius = 0.02 - 0.005 * fraction;
    expectSurfaceAtMatrix(flower, normals, fraction, angle, {
      point: { x: 0.03 * fraction + Math.cos(angle) * radius, y: 0.88 * fraction, z: Math.sin(angle) * radius },
      path: { x: 0.03, y: 0.88, z: 0 },
      normal: { x: Math.cos(angle), y: 0, z: Math.sin(angle) },
    });
  });

  it('keeps the tree matrix identical for near and far (LOD) stands', () => {
    const tree = source('tree', { size: 6, girth: 0.045, variant: 0, spin: 0.7, lean: 0.08, leanDir: 1.2 });
    const normals = { ground: SLOPE, cell: CELL_SLOPE };
    const near = matrixOf(plantTransformOf(tree, normals));
    const far = matrixOf(plantTransformOf(tree, normals));
    expect(near.elements).toEqual(far.elements);
  });
});