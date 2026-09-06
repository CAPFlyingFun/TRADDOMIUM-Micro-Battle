/**
 * ROCKS, STONES AND TWIGS — the cheapest geometry that reads as the
 * thing at the distance it is drawn.
 *
 * All procedural, by Joshua's choice (2026-09-06): the scanned rock and
 * twig GLBs in v0 and TCS are three thousand triangles each with no
 * recorded licence, and two thousand twigs at three thousand triangles
 * is six million — not a phone's frame. A twig here is a bent five-sided
 * tube, thirty triangles; a rock is an icosahedron pushed about by the
 * hash, eighty. Art can replace either behind the same instance slots
 * the day there is art with a provenance.
 *
 * FOUR ROCK VARIANTS, not one: an instance's spin and lean already turn
 * a rock every way, but every rock being the SAME rock turned is the
 * repeated-clone pattern the brief asks to avoid. Four deformations of
 * the same sphere, chosen per object by its own hash, is enough that
 * no two within sight are obviously twins.
 *
 * UNIT SIZE: every geometry here fits a unit box with its foot at y = 0,
 * and an instance scales it to its own longest axis.
 */
import * as THREE from 'three';
import { stableHash } from '../world/random';

/** How many rock shapes there are. `FamilyBatch.variant` for rocks and stones is 0..ROCK_VARIANTS-1. */
export const ROCK_VARIANTS = 4;

/**
 * A rock: an icosahedron at detail 1 (80 faces), each vertex pushed
 * along its normal by a hash of its index and the variant, then
 * flattened a little so it sits rather than balances. Unit longest
 * axis, foot at y = 0.
 */
export function rockGeometry(variant: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // Unindexed geometry repeats vertices per face; hash by POSITION so
  // the copies of one corner move together and the mesh stays closed.
  for (let i = 0; i < pos.count; i += 1) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key = Math.round(v.x * 1000) * 7 + Math.round(v.y * 1000) * 131 + Math.round(v.z * 1000) * 1_009;
    const bump = 0.72 + 0.56 * stableHash(key, variant, 0x70c);
    v.multiplyScalar(bump);
    // Squat: a rock lying on the ground is wider than it is tall.
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return fitUnit(geometry);
}

/**
 * A stone: the same recipe at detail 0 (20 faces) — a pebble is a
 * handful of triangles at the distance it is drawn from.
 */
export function stoneGeometry(variant: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key = Math.round(v.x * 1000) * 7 + Math.round(v.y * 1000) * 131 + Math.round(v.z * 1000) * 1_009;
    const bump = 0.8 + 0.4 * stableHash(key, variant, 0x570);
    v.multiplyScalar(bump);
    v.y *= 0.65;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return fitUnit(geometry);
}

/**
 * A twig: a five-sided tube along +y with a kink a third of the way up,
 * tapering to the tip. Unit length, foot at y = 0; the instance lays it
 * down (`lean` near a right angle) and spins it. Thirty triangles.
 */
export function twigGeometry(): THREE.BufferGeometry {
  const sides = 5;
  const rings = [0, 0.35, 0.7, 1];
  const radii = [0.5, 0.42, 0.32, 0.18];
  const kink = [0, 0.06, 0.02, 0.09];
  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rings.length; r += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * Math.PI * 2;
      positions.push(Math.cos(a) * radii[r] + kink[r], rings[r], Math.sin(a) * radii[r]);
    }
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      indices.push(a, c, b, b, c, d);
    }
  }
  // End caps: a fan at each end so a twig seen end-on is not hollow.
  const foot = positions.length / 3;
  positions.push(kink[0], 0, 0);
  const tip = foot + 1;
  positions.push(kink[rings.length - 1], 1, 0);
  for (let s = 0; s < sides; s += 1) {
    indices.push(foot, s, (s + 1) % sides);
    const top = (rings.length - 1) * sides;
    indices.push(tip, top + ((s + 1) % sides), top + s);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // A twig's "unit" is its LENGTH; its radius is what `girth` scales.
  // Normalise radius to 1 so girth is a plain multiplier on x and z.
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) pos.setXYZ(i, pos.getX(i) * 2, pos.getY(i), pos.getZ(i) * 2);
  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** Scale so the longest axis is 1 and the lowest point sits on y = 0. */
function fitUnit(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    pos.setXYZ(i, pos.getX(i) / longest, (pos.getY(i) - box.min.y) / longest, pos.getZ(i) / longest);
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
