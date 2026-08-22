/**
 * THE QUEEN'S BODY — one winged queen, whose wings can be taken away.
 *
 * A WINGED fire ant queen, rigged to 74 bones with both mandibles
 * articulated, carrying no animations yet: getting the right animal on
 * screen at the right size is a separate job from making her walk, and
 * doing them together means never knowing which one is wrong.
 *
 * SHE STAYS ONE MODEL FOR HER WHOLE LIFE. A queen who has shed her
 * wings is not a different ant, and swapping in a second asset at that
 * moment would mean two files to keep in step forever — two rigs, two
 * sets of mandibles, two things to re-export — plus a visible pop at
 * the one instant the player is watching her closely.
 *
 * So the wings are their own MESH on the same skeleton, split off at
 * bake time by the geometry each bone owns (see scripts/bakeQueen.mjs,
 * which explains how the wing bones are found). Losing them is
 * `wings.visible = false` and nothing else: same body, same bones, same
 * material, same draw of everything that is left.
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
import { Wingbeat, type WingPose } from './wingbeat';

/**
 * Millimetres to a world unit. The island runs at 1:1000, which puts a
 * world unit at a centimetre — see kauai.ts.
 */
export const MM_PER_UNIT = 10;

/** Where the file sits once built. */
const QUEEN_URL = `${import.meta.env.BASE_URL}models/queen-winged.glb`;

/** What the bake calls the two halves. */
const BODY_MESH = 'queen_body';
const WINGS_MESH = 'queen_wings';

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
  /**
   * Show or hide her wings.
   *
   * The whole of dealation, as far as the renderer is concerned. What
   * is left behind is the wing ROOTS, because the bake keeps any
   * triangle that is partly thorax with the body — which is what a
   * shed wing actually leaves: a scar, not a clean socket.
   */
  setWings(on: boolean): void;
  readonly hasWings: boolean;
  /**
   * Beat her wings, or let them settle.
   *
   * @param dt simulated seconds
   * @param beating true while she is working them — airborne, or about
   *   to be
   */
  beat(dt: number, beating: boolean): void;
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

  const wings = model.getObjectByName(WINGS_MESH) ?? null;
  const body = model.getObjectByName(BODY_MESH) ?? null;

  // MEASURE HER BODY, NOT HER WINGSPAN. This is the trap in a winged
  // model: her wings reach 2.5 units either side against a body three
  // long, so the widest thing about her is no longer her length.
  // Measuring the whole object would scale the WINGSPAN down to a
  // queen's body length and leave an ant two thirds too small — and
  // she would look plausible while being wrong, which is the worst
  // kind of wrong. The body mesh is measured on its own.
  const measured = longestSide(new THREE.Box3().setFromObject(body ?? model));
  if (!(measured > 0)) throw new Error('the queen model measured nothing');

  const wanted = liveStat('bodyLength') / MM_PER_UNIT;
  model.scale.setScalar(wanted / measured);

  // Stand her ON the ground rather than through it. Measured again
  // after scaling, because the first box was in the file's units.
  model.updateMatrixWorld(true);
  const stood = new THREE.Box3().setFromObject(model);
  model.position.y -= stood.min.y;

  for (const part of model.children) part.frustumCulled = false;
  // She is drawn at a few centimetres with the camera right behind her;
  // culling her by a bounding sphere that a skeleton can move is how a
  // limb or a wing blinks out at the edge of the view.
  model.traverse((part) => { part.frustumCulled = false; });

  let winged = true;
  const setWings = (on: boolean): void => {
    winged = on;
    if (wings) wings.visible = on;
  };

  // THE FOUR SHOULDERS, by name, out of the asset.
  //
  // The bake worked out which bones these are by measuring the geometry
  // each one owns, and wrote the answer into the file — so nothing here
  // repeats that measurement and hopes for the same result. Turning a
  // root sweeps its whole wing, the way a shoulder does.
  const roots = (gltf.parser.json.extras?.wingRoots ?? {}) as Record<string, string>;
  const shoulder = (key: string) => {
    const name = roots[key];
    return name ? (model.getObjectByName(name) as THREE.Bone | undefined) ?? null : null;
  };
  const hinges = {
    leftFore: shoulder('leftFore'),
    rightFore: shoulder('rightFore'),
    leftHind: shoulder('leftHind'),
    rightHind: shoulder('rightHind'),
  };
  // Their rest pose, to swing AROUND rather than replace: the bind
  // rotation carries how the wing is folded and angled on her back, and
  // overwriting it would lay all four flat.
  const rest = Object.fromEntries(
    Object.entries(hinges).map(([k, bone]) => [k, bone?.quaternion.clone() ?? null]),
  ) as Record<string, THREE.Quaternion | null>;

  const wingbeat = new Wingbeat();
  const swing = new THREE.Quaternion();
  // She sweeps her wings fore-and-aft about her own vertical, which is
  // the stroke plane seen from her back.
  const axis = new THREE.Vector3(0, 1, 0);

  const apply = (key: string, angle: number, mirror: boolean): void => {
    const bone = hinges[key as keyof typeof hinges];
    const base = rest[key];
    if (!bone || !base) return;
    swing.setFromAxisAngle(axis, mirror ? -angle : angle);
    bone.quaternion.copy(base).multiply(swing);
  };

  const beat = (dt: number, beating: boolean): void => {
    if (!winged || !wings) return;
    const pose: WingPose = wingbeat.update(dt, beating);
    apply('leftFore', pose.fore, false);
    apply('rightFore', pose.fore, true);
    apply('leftHind', pose.hind, false);
    apply('rightHind', pose.hind, true);
  };

  return {
    model,
    length: wanted,
    setWings,
    beat,
    get hasWings() { return winged && wings !== null; },
  };
}
