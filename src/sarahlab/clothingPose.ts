/** Clothing's CPU reads must include the shader-only motion BEFORE skinning.
 * Keep this adapter on the clothing side: the body owns its deformation fields.
 * Like getVertexPosition, matrices must already describe the current pose.
 */
import * as THREE from 'three';
import { jiggleAt, jiggleOf } from './softBody';
import { navelOffsetAt, navelOffsetOf } from './navelSoft';

const morphed = THREE.Mesh.prototype.getVertexPosition;
const offset = { x: 0, y: 0, z: 0 };

/** Current geometry + morphs + her navel as drawn + soft shape / mass motion / pushes, before bones. */
export function clothingMorphedVertex(mesh: THREE.Mesh, vertex: number, out: THREE.Vector3): THREE.Vector3 {
  morphed.call(mesh, vertex, out);
  // her navel as the shaders push it out (navelSoft.ts), ahead of her soft belly's motion as the shader has it
  const navel = navelOffsetOf(mesh);
  if (navel) { navelOffsetAt(navel, vertex, offset); out.x += offset.x; out.y += offset.y; out.z += offset.z; }
  const jiggle = jiggleOf(mesh);
  if (jiggle) {
    jiggleAt(jiggle, vertex, offset, out.x, out.y, out.z);
    out.x += offset.x; out.y += offset.y; out.z += offset.z;
  }
  return out;
}

/** Current displayed position in mesh-local space, including bones exactly once. */
export function clothingVertex(mesh: THREE.SkinnedMesh, vertex: number, out: THREE.Vector3): THREE.Vector3 {
  clothingMorphedVertex(mesh, vertex, out);
  if (mesh.skeleton && mesh.geometry.hasAttribute('skinIndex') && mesh.geometry.hasAttribute('skinWeight')) mesh.applyBoneTransform(vertex, out);
  return out;
}
