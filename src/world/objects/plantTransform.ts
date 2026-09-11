/**
 * THE PLANT INSTANCE TRANSFORM.
 *
 * Flora and the ecology layer must not each invent a plant pose.  The
 * renderer's matrix is the authority: this pure module carries the same
 * frame, family scale, burial and lean without importing Three.js.  A host
 * creature can therefore evaluate a point on the same unit geometry that the
 * instanced mesh draws.
 */
import type { PlantSource } from '../ecology/resources';

export interface PlantVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlantNormals {
  /** The normal read at this instance's foot. */
  readonly ground: PlantVector;
  /** The cell normal used by families that grow like grass. */
  readonly cell?: PlantVector;
}

export interface PlantInstanceTransform {
  /** The post-lean, unscaled matrix columns. */
  readonly x: PlantVector;
  readonly y: PlantVector;
  readonly z: PlantVector;
  /** The instance matrix's per-column scales. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  /** Translation from the ground foot, in world axes. */
  readonly origin: PlantVector;
}

const EPSILON = 1e-9;
const WORLD_UP: PlantVector = Object.freeze({ x: 0, y: 1, z: 0 });

/** The instance constants are the unit geometries' dimensions. */
export const BLADE_WIDTH_OF_HEIGHT = 0.3256 / 4.9716;
export const BLADE_MAX_WIDTH = 1 / 100;
export const TREE_BAKED_GIRTH = 0.045;
export const LEAF_LIFT = 0.3;
export const SHRUB_BURIAL = 0.04;
export const TREE_BURIAL = 0.02;
export const TREE_BURIAL_MAX = 0.3;
export const FLOWER_UNIT_HEAD = 0.2;
export const FERN_UNIT_SPREAD = 1;
export const BROADLEAF_UNIT_REACH = 1;
export const SHRUB_UNIT_WIDTH = 1;
export const COASTAL_UNIT_SPREAD = 2;

/** The exact family routing used by WorldObjects before this helper existed. */
export const GROWS_LIKE_GRASS: ReadonlySet<string> = new Set([
  'grass', 'fern', 'reed', 'flower', 'broadleaf', 'coastal',
]);
export const LIES_FLAT: ReadonlySet<string> = new Set(['twig', 'leaf']);

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function normalise(x: number, y: number, z: number, fallback: PlantVector = WORLD_UP): PlantVector {
  const length = Math.hypot(x, y, z);
  return length > EPSILON && Number.isFinite(length)
    ? { x: x / length, y: y / length, z: z / length }
    : fallback;
}

function frameOf(upInput: PlantVector, spin: number): { x: PlantVector; up: PlantVector; z: PlantVector } {
  const up = normalise(upInput.x, upInput.y, upInput.z);
  const angle = finiteOr(spin, 0);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const d = cs * up.x + sn * up.z;
  let x = { x: cs - d * up.x, y: -d * up.y, z: sn - d * up.z };
  const length = Math.hypot(x.x, x.y, x.z);
  if (length > EPSILON && Number.isFinite(length)) {
    x = { x: x.x / length, y: x.y / length, z: x.z / length };
  } else {
    x = Math.abs(up.y) < 0.9
      ? normalise(-up.z, 0, up.x, { x: 1, y: 0, z: 0 })
      : { x: 1, y: 0, z: 0 };
  }
  return {
    x,
    up,
    z: {
      x: x.y * up.z - x.z * up.y,
      y: x.z * up.x - x.x * up.z,
      z: x.x * up.y - x.y * up.x,
    },
  };
}

function leanMatrix(lean: number, leanDir: number, liesFlat: boolean): readonly number[] {
  const amount = finiteOr(lean, 0);
  const direction = finiteOr(leanDir, 0);
  const cl = Math.cos(amount);
  const sl = Math.sin(amount);
  const ax = liesFlat ? 1 : Math.cos(direction);
  const az = liesFlat ? 0 : -Math.sin(direction);
  const k = 1 - cl;
  return [
    cl + ax * ax * k, -az * sl, ax * az * k,
    az * sl, cl, -ax * sl,
    ax * az * k, ax * sl, cl + az * az * k,
  ];
}

function rotatedColumns(
  frame: { x: PlantVector; up: PlantVector; z: PlantVector },
  lean: number,
  leanDir: number,
  liesFlat: boolean,
): { x: PlantVector; y: PlantVector; z: PlantVector } {
  let a = frame.x;
  let b = frame.up;
  let c = frame.z;
  if (liesFlat) [a, b, c] = [frame.z, frame.x, frame.up];
  const t = leanMatrix(lean, leanDir, liesFlat);
  // R = F * T. Each matrix column is F applied to T's column.
  return {
    x: {
      x: a.x * t[0] + b.x * t[3] + c.x * t[6],
      y: a.y * t[0] + b.y * t[3] + c.y * t[6],
      z: a.z * t[0] + b.z * t[3] + c.z * t[6],
    },
    y: {
      x: a.x * t[1] + b.x * t[4] + c.x * t[7],
      y: a.y * t[1] + b.y * t[4] + c.y * t[7],
      z: a.z * t[1] + b.z * t[4] + c.z * t[7],
    },
    z: {
      x: a.x * t[2] + b.x * t[5] + c.x * t[8],
      y: a.y * t[2] + b.y * t[5] + c.y * t[8],
      z: a.z * t[2] + b.z * t[5] + c.z * t[8],
    },
  };
}

/**
 * Compose the exact matrix terms used by `WorldObjects.compose`.
 *
 * `cell` is required by the caller for a streamed renderer and optional for
 * old source records; in the latter case the foot normal is used as the
 * deterministic best answer.
 */
export function plantTransformOf(
  plant: Pick<PlantSource, 'family' | 'size' | 'variant' | 'girth' | 'spin' | 'lean' | 'leanDir'>,
  normals: PlantNormals,
): PlantInstanceTransform {
  const family = plant.family;
  const size = finiteOr(plant.size, 0);
  const girth = finiteOr(plant.girth, 0.65);
  const followsCell = GROWS_LIKE_GRASS.has(family);
  const cell = normals.cell;
  const raw = followsCell && cell !== undefined
    ? normalise(0.5 * cell.x, 0.5 * cell.y + 0.5, 0.5 * cell.z)
    : normalise(normals.ground.x, normals.ground.y, normals.ground.z);
  let up = raw;
  let scaleX = size;
  let scaleY = size;
  let scaleZ = size;
  let origin: PlantVector = { x: 0, y: 0, z: 0 };

  switch (family) {
    case 'grass': {
      const width = Math.min(BLADE_MAX_WIDTH, size * girth) / BLADE_WIDTH_OF_HEIGHT;
      scaleX = width; scaleY = size; scaleZ = width * 0.6;
      break;
    }
    case 'fern': {
      const spread = size * girth / FERN_UNIT_SPREAD;
      scaleX = spread; scaleY = size; scaleZ = spread;
      break;
    }
    case 'reed': {
      const width = size * girth / BLADE_WIDTH_OF_HEIGHT;
      scaleX = width; scaleY = size; scaleZ = width;
      break;
    }
    case 'flower': {
      const head = size * girth / FLOWER_UNIT_HEAD;
      scaleX = head; scaleY = size; scaleZ = head;
      break;
    }
    case 'leaf': {
      const width = size * girth;
      scaleX = width; scaleY = size; scaleZ = width;
      origin = {
        x: raw.x * LEAF_LIFT, y: raw.y * LEAF_LIFT, z: raw.z * LEAF_LIFT,
      };
      break;
    }
    case 'shrub': {
      const width = size * girth / SHRUB_UNIT_WIDTH;
      scaleX = width; scaleY = size; scaleZ = width;
      const slopeRise = raw.y > 1e-6
        ? 0.5 * (width * 0.5) * Math.hypot(raw.x, raw.z) / raw.y
        : size * TREE_BURIAL_MAX;
      origin = { x: 0, y: -Math.min(size * TREE_BURIAL_MAX, Math.max(size * SHRUB_BURIAL, slopeRise)), z: 0 };
      up = WORLD_UP;
      break;
    }
    case 'broadleaf': {
      const reach = size * girth * 1.6 / BROADLEAF_UNIT_REACH;
      scaleX = reach; scaleY = size; scaleZ = reach;
      break;
    }
    case 'coastal': {
      const spread = size * girth / COASTAL_UNIT_SPREAD;
      scaleX = spread; scaleY = size; scaleZ = spread;
      break;
    }
    case 'twig': {
      const radius = size * girth;
      scaleX = radius; scaleY = size; scaleZ = radius;
      origin = { x: raw.x * radius, y: raw.y * radius, z: raw.z * radius };
      break;
    }
    case 'stone': {
      scaleX = size; scaleY = size; scaleZ = size * girth;
      const sink = size * 0.15 * 0.5;
      origin = { x: -raw.x * sink, y: -raw.y * sink, z: -raw.z * sink };
      break;
    }
    case 'rock': {
      scaleX = size; scaleY = size; scaleZ = size * girth;
      const sink = size * 0.15;
      origin = { x: -raw.x * sink, y: -raw.y * sink, z: -raw.z * sink };
      break;
    }
    case 'tree': {
      const wide = plant.variant === 0 ? girth / TREE_BAKED_GIRTH : 1;
      scaleX = size * wide; scaleY = size; scaleZ = size * wide;
      const trunk = size * girth * 0.5;
      const slopeRise = raw.y > 1e-6
        ? trunk * Math.hypot(raw.x, raw.z) / raw.y
        : size * TREE_BURIAL_MAX;
      origin = { x: 0, y: -Math.min(size * TREE_BURIAL_MAX, Math.max(size * TREE_BURIAL, slopeRise)), z: 0 };
      up = WORLD_UP;
      break;
    }
    default:
      break;
  }
  const columns = rotatedColumns(
    frameOf(up, finiteOr(plant.spin, 0)),
    finiteOr(plant.lean, 0),
    finiteOr(plant.leanDir, 0),
    LIES_FLAT.has(family),
  );
  return { ...columns, scaleX, scaleY, scaleZ, origin };
}

/** Transform a point in the family geometry's unit coordinates. */
export function plantPointOf(transform: PlantInstanceTransform, point: PlantVector): PlantVector {
  return {
    x: transform.origin.x + transform.x.x * point.x * transform.scaleX
      + transform.y.x * point.y * transform.scaleY + transform.z.x * point.z * transform.scaleZ,
    y: transform.origin.y + transform.x.y * point.x * transform.scaleX
      + transform.y.y * point.y * transform.scaleY + transform.z.y * point.z * transform.scaleZ,
    z: transform.origin.z + transform.x.z * point.x * transform.scaleX
      + transform.y.z * point.y * transform.scaleY + transform.z.z * point.z * transform.scaleZ,
  };
}

/** Transform a geometry tangent or path vector, preserving nonuniform scale. */
export function plantDirectionOf(transform: PlantInstanceTransform, direction: PlantVector): PlantVector {
  return normalise(
    transform.x.x * direction.x * transform.scaleX
      + transform.y.x * direction.y * transform.scaleY + transform.z.x * direction.z * transform.scaleZ,
    transform.x.y * direction.x * transform.scaleX
      + transform.y.y * direction.y * transform.scaleY + transform.z.y * direction.z * transform.scaleZ,
    transform.x.z * direction.x * transform.scaleX
      + transform.y.z * direction.y * transform.scaleY
      + transform.z.z * direction.z * transform.scaleZ,
  );
}

/** Transform a geometry normal using the inverse-transpose of the matrix. */
export function plantNormalOf(transform: PlantInstanceTransform, normal: PlantVector): PlantVector {
  return normalise(
    transform.x.x * normal.x / Math.max(EPSILON, transform.scaleX)
      + transform.y.x * normal.y / Math.max(EPSILON, transform.scaleY)
      + transform.z.x * normal.z / Math.max(EPSILON, transform.scaleZ),
    transform.x.y * normal.x / Math.max(EPSILON, transform.scaleX)
      + transform.y.y * normal.y / Math.max(EPSILON, transform.scaleY)
      + transform.z.y * normal.z / Math.max(EPSILON, transform.scaleZ),
    transform.x.z * normal.x / Math.max(EPSILON, transform.scaleX)
      + transform.y.z * normal.y / Math.max(EPSILON, transform.scaleY)
      + transform.z.z * normal.z / Math.max(EPSILON, transform.scaleZ),
  );
}
