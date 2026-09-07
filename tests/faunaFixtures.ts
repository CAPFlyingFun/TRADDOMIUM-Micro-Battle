/**
 * SYNTHETIC RIGS for the fauna tests: the same STRUCTURE the real GLBs
 * have (measured in the Phase 7 fauna commit), in miniature, so the
 * measurement code is tested against the shapes it will meet and the
 * tests never read a 1.5 MB file.
 *
 *   worm     a 17-bone single chain named as the file names it —
 *            `Bone_000` at the root, then `Bone_016 … Bone_001` down the
 *            hierarchy — every child offset along its parent's +Y, the
 *            root turned to lay the chain along +Z.
 *   legged   a root over a thorax hub carrying a head chain (+Z) that
 *            ends in a second hub with two feelers and a proboscis, an
 *            abdomen chain (−Z), six legs in mirrored ±X pairs at three
 *            stations with their tips on the ground, and — for a flier —
 *            two wing chains whose tips are the highest points on the rig.
 *
 * Each carries a SkinnedMesh with a few vertices bound to every bone so
 * the bone-aware bounding box works, and a MeshStandardMaterial wearing
 * a base map and the packed maps `dressRig` is meant to drop.
 */
import * as THREE from 'three';

/** The unit legged rig's body extent (abdomen tip to feeler tip, median band), before `spine` scales it. */
export const LEGGED_UNIT_SPINE = 3.9;

function texture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

function material(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: texture(), normalMap: texture(), roughnessMap: texture(), metalnessMap: texture(), roughness: 1, metalness: 1,
  });
}

/** A geometry with four vertices and two triangles per bone, bound to it, at the bone's rest position ± `radius`. */
function skinnedGeometry(root: THREE.Object3D, bones: readonly THREE.Bone[], radius: number): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const n = bones.length;
  const position = new Float32Array(n * 4 * 3);
  const skinIndex = new Uint16Array(n * 4 * 4);
  const skinWeight = new Float32Array(n * 4 * 4);
  const index: number[] = [];
  const p = new THREE.Vector3();
  const offsets = [[radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, -radius, 0]];
  for (let i = 0; i < n; i += 1) {
    p.setFromMatrixPosition(bones[i].matrixWorld);
    for (let k = 0; k < 4; k += 1) {
      const v = i * 4 + k;
      position[v * 3] = p.x + offsets[k][0];
      position[v * 3 + 1] = p.y + offsets[k][1];
      position[v * 3 + 2] = p.z + offsets[k][2];
      skinIndex[v * 4] = i;
      skinWeight[v * 4] = 1;
    }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  g.setIndex(index);
  return g;
}

function finish(root: THREE.Group, rootBone: THREE.Bone, radius: number): THREE.Group {
  const bones: THREE.Bone[] = [];
  rootBone.traverse((n) => { if ((n as THREE.Bone).isBone) bones.push(n as THREE.Bone); });
  root.add(rootBone);
  root.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(skinnedGeometry(root, bones, radius), material());
  mesh.name = 'output_unwrapped';
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
  return root;
}

function bone(name: string, x: number, y: number, z: number): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

/** The worm: a 17-bone chain of total length `spine` rig units, lying along +Z with its axis `radius` above the skin's underside. */
export function wormRig(spine: number): THREE.Group {
  const radius = 0.033 * spine;
  const root = new THREE.Group();
  const head = bone('Bone_000', 0, radius, 0);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  let at = head;
  const segment = spine / 16;
  for (let k = 16; k >= 1; k -= 1) {
    const next = bone(`Bone_${String(k).padStart(3, '0')}`, 0, segment, 0);
    at.add(next);
    at = next;
  }
  return finish(root, head, radius);
}

/**
 * A legged rig with its body (median band) `spine` rig units long, six
 * legs, two feelers, a proboscis, and wings when `winged`.
 */
export function leggedRig(spine: number, winged: boolean): THREE.Group {
  const k = spine / LEGGED_UNIT_SPINE;
  const root = new THREE.Group();
  let n = 0;
  const next = (x: number, y: number, z: number): THREE.Bone => {
    const b = bone(`Bone_${String(n).padStart(3, '0')}`, x * k, y * k, z * k);
    n += 1;
    return b;
  };
  const rootBone = next(0, 1.0, 0.4);
  const hub = next(0, -0.1, 0);
  rootBone.add(hub);
  // Head chain to +Z, ending in the head hub.
  const h1 = next(0, 0, 0.6);
  const h2 = next(0, 0, 0.5);
  const headHub = next(0, -0.1, 0.2);
  hub.add(h1); h1.add(h2); h2.add(headHub);
  for (const s of [1, -1]) {
    const feeler = next(s * 0.15, 0.05, 0.3);
    const feelerTip = next(0, 0.3, 0.2);
    headHub.add(feeler); feeler.add(feelerTip);
  }
  const proboscis = next(0, -0.4, 0.1);
  const proboscisTip = next(0, -0.3, 0);
  headHub.add(proboscis); proboscis.add(proboscisTip);
  // Abdomen to −Z.
  const a1 = next(0, 0.1, -0.5);
  const a2 = next(0, -0.2, -0.7);
  const a3 = next(0, -0.4, -0.7);
  const a4 = next(0, -0.1, -0.2);
  hub.add(a1); a1.add(a2); a2.add(a3); a3.add(a4);
  // Six legs: coxa at the hub, femur up and out, tibia down, tip on the ground.
  for (const s of [1, -1]) {
    for (const z of [0.8, 0, -0.8]) {
      const coxa = next(s * 0.25, -0.4, z);
      const femur = next(s * 0.7, 0.5, 0);
      const tibia = next(s * 0.6, -0.9, 0);
      const tip = next(s * 0.3, -0.1, 0);
      hub.add(coxa); coxa.add(femur); femur.add(tibia); tibia.add(tip);
    }
  }
  if (winged) {
    for (const s of [1, -1]) {
      const wing = next(s * 0.35, 0.3, -0.1);
      const wingTip = next(s * 0.3, 0.1, -1.3);
      hub.add(wing); wing.add(wingTip);
    }
  }
  const rig = finish(root, rootBone, 0.05 * k);
  // Feet at y = 0 exactly: the tibia reaches the ground.
  return rig;
}

/** A rig with no bones and no skinned mesh: what a stray non-rigged model would be. */
export function boneless(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material()));
  return g;
}
