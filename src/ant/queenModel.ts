/**
 * THE QUEEN'S BODY — the real mesh, replacing the placeholder.
 *
 * The model is Thronemound's wingless fire ant queen, the compressed
 * copy that ships in that repo. She is rigged (54 bones) but carries NO
 * animations, which is deliberate for now: getting the right animal on
 * screen at the right size is a separate job from making her walk, and
 * doing them together means never knowing which one is wrong.
 *
 * SCALE IS MEASURED, NOT TYPED. The model's own units mean nothing —
 * it is whatever the exporter emitted. So she is measured on load and
 * scaled until her length matches `bodyLength` from castes.ts. That
 * makes the stat table the authority on how big she is, which is the
 * point of having one: the day the curve says 5.5 mm she is 5.5 mm on
 * screen, and re-exporting the mesh at a different size changes
 * nothing.
 *
 * This also settles a discrepancy the placeholder was hiding. It was
 * about 1.4 units nose to gaster — 14 mm — against a stat sheet that
 * says 10. She has been 40% oversized, which is part of why the jump
 * looked wrong against her.
 *
 * She faces +Z in her own file, which is the game's forward, so there
 * is no rotation here. If a future export changes that, this is where
 * it gets fixed rather than at every call site.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { liveStat } from './castes';

/**
 * Millimetres to a world unit. The island runs at 1:1000, which puts a
 * world unit at a centimetre — see kauai.ts.
 */
export const MM_PER_UNIT = 10;

/** Where the file sits once built. */
const QUEEN_URL = `${import.meta.env.BASE_URL}models/queen.glb`;

/**
 * Longest horizontal side of a box.
 *
 * Nose to gaster is the long axis, and taking the longer of the two
 * horizontal sides rather than naming Z means an export that lays her
 * along X still measures correctly — it would face the wrong way, but
 * it would not also be the wrong size, and one bug at a time is easier
 * to see than two.
 */
function longestSide(box: THREE.Box3): number {
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.z);
}

export interface QueenBody {
  readonly model: THREE.Object3D;
  /** Her length in world units, after scaling. */
  readonly length: number;
}

/**
 * Load her, scale her to the stat table, and stand her on y = 0.
 *
 * Rejects rather than falling back: the caller keeps the placeholder up
 * until this resolves, so a failure here leaves a playable game with
 * the old body rather than an ant-shaped hole.
 */
export async function loadQueen(): Promise<QueenBody> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(QUEEN_URL);
  const model = gltf.scene;

  const measured = longestSide(new THREE.Box3().setFromObject(model));
  if (!(measured > 0)) throw new Error('the queen model measured nothing');

  const wanted = liveStat('bodyLength') / MM_PER_UNIT;
  model.scale.setScalar(wanted / measured);

  // Stand her ON the ground rather than through it. Measured again
  // after scaling, because the first box was in the file's units.
  model.updateMatrixWorld(true);
  const stood = new THREE.Box3().setFromObject(model);
  model.position.y -= stood.min.y;

  for (const part of model.children) part.frustumCulled = false;

  return { model, length: wanted };
}
