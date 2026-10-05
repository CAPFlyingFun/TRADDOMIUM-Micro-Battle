import * as T from 'three';

/** Verify actual decoded model data before applying the prototype's poses. */
export function assertCompatibleRig(root: T.Object3D, person: string) {
  const bones = new Map<string, T.Bone>();
  let skins = 0;
  root.traverse(object => {
    if ((object as T.Bone).isBone) bones.set(object.name, object as T.Bone);
    if ((object as T.SkinnedMesh).isSkinnedMesh) skins++;
  });
  const arms = bones.size === 35
    ? [['Bone_025', 'Bone_024', 'Bone_023'], ['Bone_033', 'Bone_032', 'Bone_031']]
    : [['Bone_022', 'Bone_021', 'Bone_020'], ['Bone_027', 'Bone_026', 'Bone_025']];
  const chains = [...arms, ['Bone_010', 'Bone_009', 'Bone_008', 'Bone_007'], ['Bone_015', 'Bone_014', 'Bone_013', 'Bone_012']];
  for (const names of chains) {
    for (let i = 0; i < names.length; i++) {
      const bone = bones.get(names[i]);
      if (!bone) throw new Error(`${person}: required rig bone ${names[i]} missing`);
      if (i && bone.parent !== bones.get(names[i - 1])) {
        throw new Error(`${person}: incompatible chain ${names.join(' → ')}`);
      }
    }
  }
  if (!skins || !bones.has('Bone_001') || !bones.has('Bone_017')) {
    throw new Error(`${person}: prototype requires a skinned UniRig with pelvis and head`);
  }
  return { bones: bones.size, skins, arms };
}