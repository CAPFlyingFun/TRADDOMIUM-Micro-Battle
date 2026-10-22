// @vitest-environment jsdom
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SceneContext } from '../src/app/Scene';
import { assets } from '../src/assets/assets';
import { measureHuman } from '../src/actor/humanSkeleton';
import { buildSarahLabScene } from '../src/sarahlab/SarahLabScene';
import { ARM_RAISE_TARGETS, ARM_SIDES, SARAH_LAB_ACTION, SARAH_LAB_FIELD, SARAH_LAB_MODELS, armRaiseWeight, type SarahLabPose } from '../src/sarahlab/sarahLabTool';
import { HumanRig } from '../src/view/HumanRig';

type Source = { matrices: THREE.Matrix4[]; parents: number[]; names: string[]; materials: string[] };
const sources = new Map<string, Source>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const entry of [SARAH_LAB_MODELS[0], SARAH_LAB_MODELS[3]]) {
    const doc = await io.read(`public/${entry.path}`);
    const joints = doc.getRoot().listSkins()[0].listJoints();
    sources.set(entry.id, {
      matrices: joints.map(j => new THREE.Matrix4().fromArray(j.getWorldMatrix())),
      parents: joints.map(j => joints.indexOf(j.getParentNode()!)),
      names: joints.map(j => j.getName()),
      materials: [...new Set(doc.getRoot().listMeshes().flatMap(m => m.listPrimitives().map(p => p.getMaterial()!.getName())))],
    });
  }
}, 60000);

/** Real shipped skeleton/material names, with tiny stand-in surfaces: no textures or GPU. */
function modelFor(id: string): THREE.Object3D {
  const source = sources.get(id === 'v1' ? id : 'v2-body')!;
  const root = new THREE.Group();
  const bones = source.matrices.map((world, i) => {
    const bone = new THREE.Bone();
    bone.name = source.names[i];
    const local = source.parents[i] < 0 ? world : source.matrices[source.parents[i]].clone().invert().multiply(world);
    local.decompose(bone.position, bone.quaternion, bone.scale);
    return bone;
  });
  bones.forEach((bone, i) => (source.parents[i] < 0 ? root : bones[source.parents[i]]).add(bone));
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const name of source.materials) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, .1, 1, 0, 0, 1.1, 0], 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [ARM_RAISE_TARGETS.plusX, ARM_RAISE_TARGETS.minusX, 'shape:bellyWidth'].map(target => {
      const attr = new THREE.Float32BufferAttribute([.01, 0, 0, .01, 0, 0, .01, 0, 0], 3);
      attr.name = target;
      return attr;
    });
    const material = new THREE.MeshStandardMaterial(); material.name = name;
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.bind(skeleton); root.add(mesh);
  }
  return root;
}

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });

async function lab() {
  let model = modelFor('v2-body');
  vi.spyOn(assets, 'loadModel').mockImplementation(async path => {
    const id = SARAH_LAB_MODELS.find(entry => entry.path === path)!.id;
    model = modelFor(id);
    return model;
  });
  const uiLayer = document.createElement('div'); document.body.appendChild(uiLayer);
  const scene = buildSarahLabScene({ uiLayer, renderer: { size: () => ({ width: 932, height: 430 }) } } as unknown as SceneContext, { onBack() {} });
  cleanups.push(() => { scene.dispose(); uiLayer.remove(); });
  await scene.enter(); await Promise.resolve();
  const frame = () => scene.update({ rawDt: 0, simDt: 0, elapsed: 0 });
  const press = (action: string) => uiLayer.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  const input = (field: string) => uiLayer.querySelector<HTMLElement>(`[data-field="${field}"]`)!.nextElementSibling as HTMLInputElement;
  const setArms = (degrees: number) => { const slider = input(SARAH_LAB_FIELD.arms); slider.value = String(degrees); slider.dispatchEvent(new Event('input')); frame(); };
  const rig = () => new HumanRig(model);
  const bones = () => { let found!: THREE.Bone[]; model.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) found = (node as THREE.SkinnedMesh).skeleton.bones; }); return found; };
  frame();
  return { scene, frame, press, input, setArms, rig, bones, model: () => model, uiLayer };
}

function expectRotation(actual: THREE.Quaternion, expected: THREE.Quaternion) {
  expect(Math.abs(actual.clone().normalize().dot(expected.clone().normalize()))).toBeCloseTo(1, 8);
}

function bindRotation(rig: HumanRig, joint: number) {
  const matrices = sources.get('v2-body')!.matrices;
  const parent = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrices[rig.bind[joint].parent])).invert();
  const bind = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrices[joint]));
  return parent.multiply(bind);
}

/** Compute the shoulder's local rotation from the intended bind-world arm direction. */
function raisedShoulder(rig: HumanRig, shoulder: number, elbow: number, degrees: number) {
  const skinSource = sources.get('v2-body')!;
  const s = rig.bind[shoulder], e = rig.bind[elbow];
  const direction = new THREE.Vector3(e.x - s.x, e.y - s.y, e.z - s.z).normalize();
  const target = new THREE.Vector3(Math.sign(s.x), 0, 0);
  const axis = direction.clone().cross(target).normalize();
  const turn = new THREE.Quaternion().setFromAxisAngle(axis, direction.angleTo(target) * degrees / 90);
  const parent = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(skinSource.matrices[s.parent])).invert();
  const bind = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(skinSource.matrices[shoulder]));
  return parent.multiply(turn).multiply(bind);
}

describe('Sarah v2 ARMS scene control', () => {
  it('starts at zero with normal animation, and T-POSE sets and synchronizes 90 degrees', async () => {
    const l = await lab();
    expect(l.input(SARAH_LAB_FIELD.arms).value).toBe('0');
    const rig = l.rig(), shoulder = measureHuman(rig.bind).joints.shoulderL;
    expect(Math.abs(l.bones()[shoulder].quaternion.dot(bindRotation(rig, shoulder)))).toBeLessThan(.999);
    l.setArms(30);
    l.press(SARAH_LAB_ACTION.tpose); l.frame();
    expect(l.input(SARAH_LAB_FIELD.arms).value).toBe('90');
    expect(l.uiLayer.querySelector(`[data-field="${SARAH_LAB_FIELD.arms}"]`)!.textContent).toBe('ARMS · 90°');
  });

  for (const pose of ['stand', 'walk', 'sit'] as const satisfies readonly SarahLabPose[]) {
    it(`raises the selected arms immediately in ${pose}, preserves the other limbs, and updates every garment/trim corrective`, async () => {
      const l = await lab(); l.press(SARAH_LAB_ACTION[pose]); l.frame();
      const rig = l.rig(), joints = measureHuman(rig.bind).joints, bones = l.bones();
      const normal = bones.map(bone => bone.quaternion.clone());
      for (const side of ARM_SIDES) {
        for (const degrees of [30, 45, 60, 90, 0]) {
          l.setArms(degrees);
          for (const [shoulder, elbow, wrist, on] of [[joints.shoulderL, joints.elbowL, joints.wristL, side !== 'right'], [joints.shoulderR, joints.elbowR, joints.wristR, side !== 'left']] as const) {
            expectRotation(bones[shoulder].quaternion, on ? raisedShoulder(rig, shoulder, elbow, degrees) : normal[shoulder]);
            expectRotation(bones[elbow].quaternion, on ? bindRotation(rig, elbow) : normal[elbow]);
            expectRotation(bones[wrist].quaternion, on ? bindRotation(rig, wrist) : normal[wrist]);
          }
          for (const joint of [joints.hipL, joints.hipR, joints.kneeL, joints.kneeR]) expectRotation(bones[joint].quaternion, normal[joint]);
          l.model().traverse(node => {
            const mesh = node as THREE.SkinnedMesh; if (!mesh.isSkinnedMesh) return;
            for (const [shoulder, on] of [[joints.shoulderL, side !== 'right'], [joints.shoulderR, side !== 'left']] as const) {
              const target = rig.bind[shoulder].x >= 0 ? ARM_RAISE_TARGETS.plusX : ARM_RAISE_TARGETS.minusX;
              expect(mesh.morphTargetInfluences![mesh.morphTargetDictionary![target]], `${(mesh.material as THREE.Material).name}: ${target}`).toBeCloseTo(on ? armRaiseWeight(degrees) : 0);
            }
          });
        }
        l.press(SARAH_LAB_ACTION.armSide);
      }
    });
  }

  it('keeps lifted CPU shape fields on the body, every native garment, and trim when arms move', async () => {
    const l = await lab();
    const label = l.uiLayer.querySelector(`[data-field="${SARAH_LAB_FIELD.body}bellyWidth"]`)!;
    const input = label.parentElement!.nextElementSibling as HTMLInputElement;
    input.value = '10'; input.dispatchEvent(new Event('input')); l.setArms(45);
    let surfaces = 0;
    l.model().traverse(node => {
      const mesh = node as THREE.SkinnedMesh; if (!mesh.isSkinnedMesh) return;
      surfaces++;
      expect(mesh.morphTargetDictionary?.['shape:bellyWidth']).toBeUndefined(); // a part left with no shapes has no dictionary at all (morphPrune.ts)
      expect(mesh.geometry.getAttribute('position').getX(0)).toBeCloseTo(.01);
    });
    // every surface the loaded file carries (the slim v2 body: her body and the bikini; its garments have their own files)
    expect(surfaces).toBe(sources.get('v2-body')!.materials.length);
    expect(surfaces).toBeGreaterThanOrEqual(2);
  });

  it('keeps v1 ARMS restricted to T-POSE with its existing 90 degree default', async () => {
    const l = await lab(); l.press(SARAH_LAB_ACTION.model); await Promise.resolve(); l.frame();
    expect(l.input(SARAH_LAB_FIELD.arms).value).toBe('90');
    const normal = l.bones().map(bone => bone.quaternion.clone());
    l.setArms(30);
    l.bones().forEach((bone, i) => expectRotation(bone.quaternion, normal[i]));
    l.press(SARAH_LAB_ACTION.tpose); l.frame();
    expect(l.input(SARAH_LAB_FIELD.arms).value).toBe('30');
  });
});
