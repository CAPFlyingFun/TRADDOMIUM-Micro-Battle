/**
 * A BLADE OF GRASS — Joshua's own, from 2022.
 *
 * `/Micro Battle/3D .obj files/Blade of Grass.obj` in his Dropbox: eight
 * vertices, six quads, a tapered box 0.33 wide at the foot, 4.97 tall,
 * 0.19 thick, leaning a little toward −z at the tip, made in an iOS
 * modelling app for the original Micro Battle. He asked for it as the
 * reference and test asset for this milestone, and it is a good one
 * for exactly the reason it is small: twelve triangles a blade is what
 * lets twenty-five thousand of them exist on a phone.
 *
 * INLINED, NOT LOADED. The file has no normals, no material, an empty
 * group line and a unit nobody recorded, and v1 has one loader and it
 * loads glTF (ARCHITECTURE §2.5). Eight vertices do not need a loader;
 * they need a comment saying where they came from, which is this one.
 * The numbers below ARE the file's `v` lines, and a test pins their
 * bounding box to the file's so a retyped digit shows up.
 *
 * NORMALISED TO A UNIT BLADE: the foot at y = 0, the tip at y = 1, the
 * width and thickness scaled by the same factor so the proportions are
 * his. An instance scales it to its own height (5 cm to a metre) and
 * width (`girth`, a fraction of height) — one geometry, one draw call,
 * every blade on the island.
 *
 * NORMALS ARE FLAT, per face. Six faces, twelve triangles, and a blade
 * three millimetres wide does not need smooth shading to look like a
 * blade; what it needs is to catch the light differently from its
 * neighbour, which the per-instance spin and lean give it.
 */
import * as THREE from 'three';

/**
 * The file's vertices, verbatim, in file order (1-based in the OBJ).
 * Y is up; the foot is the first four, the tip the last four.
 */
export const BLADE_OBJ_VERTICES: readonly (readonly [number, number, number])[] = Object.freeze([
  [-0.1635029, -0.04996968, -0.03236551],
  [0.1621028, -0.04997206, -0.0323661],
  [-0.163503, -0.04744149, 0.1124959],
  [0.1621027, -0.04744292, 0.1124959],
  [-0.03180454, 4.92113, -0.08078671],
  [-0.002312104, 4.921612, -0.0761064],
  [-0.02072876, 4.875824, -0.07748374],
  [0.01050175, 4.892698, -0.06675909],
]);

/** The file's quads, verbatim, as 0-based vertex indices in the file's winding. */
export const BLADE_OBJ_FACES: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [0, 1, 3, 2],
  [2, 3, 5, 4],
  [4, 5, 7, 6],
  [6, 7, 1, 0],
  [6, 0, 2, 4],
  [1, 7, 5, 3],
]);

/** The file's extent, for the test: 0.3256 x 4.9716 x 0.1933, y from −0.0500 to 4.9216. */
export const BLADE_OBJ_BOUNDS = Object.freeze({
  min: Object.freeze([-0.163503, -0.04997206, -0.08078671] as const),
  max: Object.freeze([0.1621028, 4.921612, 0.1124959] as const),
});

/** What the file's height is, and the factor that makes it one. */
const OBJ_HEIGHT = BLADE_OBJ_BOUNDS.max[1] - BLADE_OBJ_BOUNDS.min[1];

/**
 * The blade as a unit-height, flat-shaded, unindexed geometry. Twelve
 * triangles. Built once and shared by every instance.
 */
export function bladeGeometry(): THREE.BufferGeometry {
  const scale = 1 / OBJ_HEIGHT;
  const footY = BLADE_OBJ_BOUNDS.min[1];
  const positions: number[] = [];
  const normals: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const push = (i: number, j: number, k: number): void => {
    const p = (idx: number): THREE.Vector3 => {
      const v = BLADE_OBJ_VERTICES[idx];
      return new THREE.Vector3(v[0] * scale, (v[1] - footY) * scale, v[2] * scale);
    };
    a.copy(p(i));
    b.copy(p(j));
    c.copy(p(k));
    n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
  };
  // Each quad as two triangles. THE FILE'S WINDING IS NOT TRUSTED: three
  // of its six faces wind inward (an iOS app's export, and it had no
  // normals to say which way it meant), so every triangle is turned to
  // face away from the blade's centre. A blade is convex, so that is
  // always the right answer, and the test checks it against the
  // centroid rather than against the file.
  const centre = new THREE.Vector3();
  for (const v of BLADE_OBJ_VERTICES) centre.add(new THREE.Vector3(v[0] * scale, (v[1] - footY) * scale, v[2] * scale));
  centre.divideScalar(BLADE_OBJ_VERTICES.length);
  const outward = (i: number, j: number, k: number): [number, number, number] => {
    const vi = BLADE_OBJ_VERTICES[i]; const vj = BLADE_OBJ_VERTICES[j]; const vk = BLADE_OBJ_VERTICES[k];
    a.set(vi[0] * scale, (vi[1] - footY) * scale, vi[2] * scale);
    b.set(vj[0] * scale, (vj[1] - footY) * scale, vj[2] * scale);
    c.set(vk[0] * scale, (vk[1] - footY) * scale, vk[2] * scale);
    n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).sub(centre);
    return n.dot(mid) >= 0 ? [i, j, k] : [i, k, j];
  };
  for (const [p0, p1, p2, p3] of BLADE_OBJ_FACES) {
    push(...outward(p0, p1, p2));
    push(...outward(p0, p2, p3));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A broader blade for the few in a patch that are: the same eight
 * points widened 2.5x. Instances that draw variant 1 wear this so a lawn
 * is not twenty-five thousand of one silhouette.
 */
export function broadBladeGeometry(): THREE.BufferGeometry {
  const geometry = bladeGeometry();
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) pos.setX(i, pos.getX(i) * 2.5);
  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}
