import assert from 'node:assert/strict';
import * as T from 'three';
import { newRigFixture } from '../tests/helpers/new-rig-fixture.mjs';
import { assertCompatibleRig } from '../app/game/three/rig-contract.ts';
import { createBodyMotion } from '../app/game/three/body-motion.ts';

for (const who of ['jack', 'sarah']) {
  const { root, doc } = await newRigFixture(who);
  const result = assertCompatibleRig(root, who);
  const motion = createBodyMotion(root, { pregnant: who === 'sarah' });
  for (const pose of ['idle', 'walk', 'seated']) {
    motion.pose(1, pose, true, true, false);
    root.traverse(object => {
      assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${who} ${pose} ${object.name}`);
      if (object.isSkinnedMesh) {
        for (const index of [0, Math.floor(object.geometry.attributes.position.count / 2)]) {
          const vertex = new T.Vector3().fromBufferAttribute(object.geometry.attributes.position, index);
          object.applyBoneTransform(index, vertex);
          assert.ok(vertex.toArray().every(Number.isFinite));
        }
      }
    });
  }
  console.log(`${who}: decoded actual meshopt GLB, ${result.bones} bones, ${result.skins} skins, ${doc.images.length} embedded texture images; chains and pose transforms valid.`);
}