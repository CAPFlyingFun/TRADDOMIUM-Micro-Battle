/**
 * THE SURFACE OF A PLANT HOST.
 *
 * A `PlantSource` is deliberately renderer-free, but a host creature still
 * needs more than the plant's foot and height.  In particular, an aphid on a
 * broadleaf must inherit the leaf's normal and its along-leaf tangent or it
 * will be visibly floating above a horizontal plane.  This small pure module
 * is the shared construction used by population and rendering code.  The
 * renderer remains free to build the mesh however it likes; the source's
 * shape numbers are the agreement between the two.
 *
 * `point` is relative to the plant's foot.  `normal` and `tangent` are unit
 * vectors in world coordinates.  The tangent is the direction in which a
 * creature should face while it is attached to the surface.
 */
import type { PlantSource } from './resources';
import {
  plantDirectionOf, plantNormalOf, plantPointOf, plantTransformOf, type PlantNormals, type PlantVector,
} from '../objects/plantTransform';

export type { PlantVector } from '../objects/plantTransform';

export interface PlantSurface {
  readonly point: PlantVector;
  readonly normal: PlantVector;
  readonly tangent: PlantVector;
}

const TAU = Math.PI * 2;

/** Clamp a perch fraction while tolerating a value from an old save. */
function fractionOf(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

function plantPath(
  plant: PlantSource,
  fraction: number,
  azimuth: number,
  normals: PlantNormals,
  curve: readonly (readonly [number, number])[],
  widths: readonly number[],
  fronds: number,
  frondOffset: number,
): PlantSurface {
  const transform = plantTransformOf(plant, normals);
  const t = fractionOf(fraction) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(t));
  const localT = t - i;
  const [r0, y0] = curve[i];
  const [r1, y1] = curve[i + 1];
  const r = r0 + (r1 - r0) * localT;
  const y = y0 + (y1 - y0) * localT;
  const halfWidth = widths[i] + (widths[i + 1] - widths[i]) * localT;
  const dr = r1 - r0;
  const dy = y1 - y0;
  const branch = Math.round((((Number.isFinite(azimuth) ? azimuth : 0) - frondOffset) / TAU) * fronds) % fronds;
  const index = branch < 0 ? branch + fronds : branch;
  const angle = frondOffset + index * TAU / fronds;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // A small deterministic lateral choice keeps a colony from becoming a
  // single line down each frond, while the branch choice remains stable.
  const side = Math.sin((Number.isFinite(azimuth) ? azimuth : 0) * 5.17 + 0.31) * 0.72;
  // The broadleaf and fern meshes are strips in their frond's vertical
  // plane, turned around local +Y before the instance frame is applied.
  const localPoint = {
    x: r * ca - halfWidth * side * sa,
    y,
    z: r * sa + halfWidth * side * ca,
  };
  const localPath = {
    x: dr * ca,
    y: dy,
    z: dr * sa,
  };
  const localWidth = { x: -sa, y: 0, z: ca };
  return {
    point: plantPointOf(transform, localPoint),
    normal: plantNormalOf(transform, {
      x: localWidth.y * localPath.z - localWidth.z * localPath.y,
      y: localWidth.z * localPath.x - localWidth.x * localPath.z,
      z: localWidth.x * localPath.y - localWidth.y * localPath.x,
    }),
    tangent: plantDirectionOf(transform, localPath),
  };
}

/**
 * Find a point on the visual surface represented by a plant source.
 *
 * `fraction` runs from the foot to the end of a frond. `azimuth` selects a
 * frond and a side of it; callers should use their deterministic population
 * hash for both. The supplied normals must be the same foot and cell normals
 * used by the plant renderer; a legacy single vector is accepted as the foot
 * normal when no cell query is available.
 *
 * Families whose detailed mesh is not a frond still receive a useful stem
 * surface.  This keeps older hand-authored sources attachable while the
 * broadleaf path exactly follows the production mesh.
 */
export function plantSurfaceAt(
  plant: PlantSource,
  fraction: number,
  azimuth: number,
  normalsOrUp: PlantNormals | PlantVector = { x: 0, y: 1, z: 0 },
): PlantSurface {
  const normals: PlantNormals = 'ground' in normalsOrUp
    ? normalsOrUp
    : { ground: normalsOrUp };
  const family = plant.family;
  if (family === 'broadleaf') {
    return plantPath(
      plant,
      fraction,
      azimuth,
      normals,
      [[0, 0.05], [0.35, 0.5], [0.7, 1], [1, 0.8]],
      [0.04, 0.25, 0.32, 0.12],
      3,
      0.5,
    );
  }
  if (family === 'fern') {
    return plantPath(
      plant,
      fraction,
      azimuth,
      normals,
      [[0.02, 0.05], [0.35, 0.6], [0.7, 1], [1, 0.8]],
      [0.03, 0.12, 0.13, 0.04],
      4,
      0.3,
    );
  }

  const transform = plantTransformOf(plant, normals);
  const f = fractionOf(fraction);
  const angle = Number.isFinite(azimuth) ? azimuth : 0;
  let centre: PlantVector;
  let path: PlantVector;
  let radius: number;
  switch (family) {
    case 'flower':
      // flowerGeometry: tube(3, 0, .88, .02, .015, ..., x1=.03).
      centre = { x: 0.03 * f, y: 0.88 * f, z: 0 };
      path = { x: 0.03, y: 0.88, z: 0 };
      radius = 0.02 - 0.005 * f;
      break;
    case 'shrub':
      // shrubGeometry: tube(4, 0, .4, .035, .025). The crown is above
      // the stem; the stem is the stable attachment surface.
      centre = { x: 0, y: 0.4 * f, z: 0 };
      path = { x: 0, y: 0.4, z: 0 };
      radius = 0.035 - 0.01 * f;
      break;
    case 'tree':
      // Tree stands are unit bakes; their matrix, not PlantSource.girth,
      // owns the family scale. This is the trunk's representative surface.
      centre = { x: 0, y: f, z: 0 };
      path = { x: 0, y: 1, z: 0 };
      radius = plant.variant === 2 ? 0.011 : plant.variant === 1 ? 0.03 : 0.02;
      break;
    default:
      centre = { x: 0, y: f, z: 0 };
      path = { x: 0, y: 1, z: 0 };
      radius = 0;
      break;
  }
  const radial = { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };
  const localPoint = { x: centre.x + radial.x, y: centre.y, z: centre.z + radial.z };
  const localNormal = { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
  return {
    point: plantPointOf(transform, localPoint),
    normal: plantNormalOf(transform, localNormal),
    tangent: plantDirectionOf(transform, path),
  };
}
