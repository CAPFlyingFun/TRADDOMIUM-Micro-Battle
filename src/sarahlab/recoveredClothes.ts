/** Recovered v2 garments: fitted keyframes plus the body's existing rig/shape deltas. */
import * as THREE from 'three';

export const FIT_KEYS = [0, 50, 100, 150, 200] as const;
export interface RecoveredShirtMetadata {
  readonly baselineMode?: string;
  readonly baselineWeightsByBump: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
export function fitWeights(bump: number, prefix: string): Record<string, number> {
  const b = Math.min(200, Math.max(0, Number.isFinite(bump) ? bump : 100));
  const lo = Math.min(3, Math.floor(b / 50)), a = FIT_KEYS[lo], z = FIT_KEYS[lo + 1], t = (b - a) / 50;
  const result: Record<string, number> = {};
  if (t < 1) result[`${prefix}${a}`] = 1 - t;
  if (t > 0) result[`${prefix}${z}`] = t;
  return result;
}
export function recoveredMetadata(root: THREE.Object3D): RecoveredShirtMetadata | null {
  let result: RecoveredShirtMetadata | null = null;
  root.traverse(n => { const m = n.userData.recoveredShirt as RecoveredShirtMetadata | undefined; if (m?.baselineWeightsByBump) result = m; });
  return result;
}
/** Called AFTER writing native weights; motion calls provide only their freshly written keys. */
export function applyRecoveredBaseline(mesh: THREE.Mesh, bump: number, names?: readonly string[]): void {
  const meta = mesh.userData.recoveredShirt as RecoveredShirtMetadata | undefined;
  if (!meta || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
  const weights = meta.baselineMode === 'reference100' ? {100: 1} : fitWeights(bump, '');
  for (const [name, at] of Object.entries(mesh.morphTargetDictionary)) {
    if (names && !names.includes(name)) continue;
    let baseline = 0;
    for (const [key, weight] of Object.entries(weights)) baseline += weight * (meta.baselineWeightsByBump[key]?.[name] ?? 0);
    mesh.morphTargetInfluences[at] -= baseline;
  }
}
/** Garment-only GLBs use the approved body's local frame and its live skeleton. */
export function attachRecoveredMeshes(root: THREE.Object3D, body: THREE.SkinnedMesh, materialName?: string): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [], meta = recoveredMetadata(root);
  root.traverse(n => { if ((n as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(n as THREE.SkinnedMesh); });
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
    mesh.bindMode = body.bindMode; mesh.bind(body.skeleton, body.bindMatrix);
    mesh.frustumCulled = false;
    mesh.visible = false;
    if (meta) mesh.userData.recoveredShirt = meta;
    if (materialName) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.name = materialName;
    body.parent!.add(mesh);
  }
  return meshes;
}

const hemPatched = new WeakSet<THREE.Material>();
/** A baked signed hem distance is carried by the pants' own skinning, in every pose. */
export function updateLeggingsHem(mesh: THREE.SkinnedMesh, bump: number, style: 'relaxed' | 'spandex'): void {
  const g = mesh.geometry, key = `${style}:${bump.toFixed(5)}`;
  if (mesh.userData.recoveredHemKey === key) return;
  const weights = fitWeights(bump, '');
  const fields = Object.entries(weights).map(([b, w]) => ({ attr: g.getAttribute(`_hem_${style}_${b}`), w }));
  if (fields.some(f => !f.attr)) return;
  let attr = g.getAttribute('recoveredHemDistance') as THREE.BufferAttribute | undefined;
  if (!attr) { attr = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1); g.setAttribute('recoveredHemDistance', attr); }
  for (let i = 0; i < attr.count; i++) attr.setX(i, fields.reduce((sum, f) => sum + f.w * f.attr.getX(i), 0));
  attr.needsUpdate = true;
  mesh.userData.recoveredHemKey = key;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (hemPatched.has(material)) continue;
    const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
    material.onBeforeCompile = function(shader, renderer) {
      previous.call(this, shader, renderer);
      shader.vertexShader = 'attribute float recoveredHemDistance;\nvarying float vRecoveredHemDistance;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRecoveredHemDistance=recoveredHemDistance;');
      shader.fragmentShader = 'varying float vRecoveredHemDistance;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\nif(vRecoveredHemDistance>=0.) discard;');
    };
    material.customProgramCacheKey = function() { return cacheKey.call(this) + '|recovered-shirt-layer-v1'; };
    material.needsUpdate = true; hemPatched.add(material);
  }
}

/** Dispose a replaced shirt without disposing the body's shared skeleton. */
export function releaseRecoveredMeshes(meshes: readonly THREE.SkinnedMesh[]): void {
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    mesh.removeFromParent(); mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}
