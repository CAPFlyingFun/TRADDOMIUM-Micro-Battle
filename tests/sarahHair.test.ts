import { statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HAIR_NORMAL_LINE, patchHairMaterial } from '../src/sarahlab/hairMaterial';
import { SARAH_V2_BODY_MODEL, SARAH_V2_HAIR_MODEL } from '../src/sarahlab/sarahLabTool';

const PUBLIC = join(__dirname, '..', 'public');
async function read(path: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(join(PUBLIC, path));
}

describe("Sarah v2's hair (Joshua, 2026-10-24: one hairstyle, following her head, light on a phone)", () => {
  it('is one skinned mesh on her own skeleton, the body file\'s joints in their order, so the room binds it to her', async () => {
    const [hair, body] = await Promise.all([read(SARAH_V2_HAIR_MODEL), read(SARAH_V2_BODY_MODEL)]);
    const names = (d: typeof hair) => d.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
    expect(names(hair)).toEqual(names(body));
    const meshes = hair.getRoot().listMeshes();
    expect(meshes).toHaveLength(1);
    const prims = meshes[0].listPrimitives();
    expect(prims).toHaveLength(1);
    for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']) expect(prims[0].getAttribute(a), a).toBeTruthy();
    const m = prims[0].getMaterial()!;
    expect([m.getAlphaMode(), m.getDoubleSided()]).toEqual(['MASK', true]);
  });

  it('weights only bones of her head, neck and upper back', async () => {
    const hair = await read(SARAH_V2_HAIR_MODEL);
    const joints = hair.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
    const prim = hair.getRoot().listMeshes()[0].listPrimitives()[0];
    const J = prim.getAttribute('JOINTS_0')!.getArray()!, W = prim.getAttribute('WEIGHTS_0')!.getArray()!;
    const used = new Set<string>();
    for (let i = 0; i < W.length; i++) if (W[i] > 1e-3) used.add(joints[J[i]]);
    // head (Bone_016, its end Bone_015), neck (Bone_017), upper back (Bone_002, Bone_003): nothing of her arms or legs
    for (const name of used) expect(['Bone_015', 'Bone_016', 'Bone_017', 'Bone_002', 'Bone_003', 'Bone_022', 'Bone_027']).toContain(name);
  });

  it('stays a light download and a light draw for a phone', async () => {
    const hair = await read(SARAH_V2_HAIR_MODEL);
    const prim = hair.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(statSync(join(PUBLIC, SARAH_V2_HAIR_MODEL)).size).toBeLessThan(2.5 * 1024 * 1024);
    expect(prim.getIndices()!.getCount() / 3).toBeLessThan(40000);
    expect(hair.getRoot().listTextures()).toHaveLength(1);
    const size = hair.getRoot().listTextures()[0].getSize();
    expect(size && Math.max(...size)).toBeLessThanOrEqual(1024);
  });

  it("lights every card by its volume's normal from both sides (the material patch)", () => {
    const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const before = vitestShader();
    patchHairMaterial(material);
    patchHairMaterial(material);
    material.onBeforeCompile(before, {} as THREE.WebGLRenderer);
    expect(before.fragmentShader).toContain(`#include <normal_fragment_begin>${HAIR_NORMAL_LINE}`);
    expect(before.fragmentShader.split(HAIR_NORMAL_LINE)).toHaveLength(2);
    expect(material.customProgramCacheKey()).toContain('sarah-hair-v1');
  });
});

function vitestShader(): THREE.WebGLProgramParametersWithUniforms {
  return { fragmentShader: 'void main() {\n#include <normal_fragment_begin>\n}', vertexShader: 'void main() {}', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
}
