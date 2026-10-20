import { attachRecoveredMeshes, applyRecoveredBaseline, fitWeights, LEGGINGS_FIT_KEYS, SHIRT_FINE_FIT_KEYS, updateLeggingsHem, releaseRecoveredMeshes } from './recoveredClothes';
import { garmentTexturePanel } from './garmentTexturePanel';
import { uprightLayout, type UprightLayout } from './uprightTabs';
import { loadingCard, LOADING_COVERED_VAR, type LoadingCard, type LoadingPlace } from './loadingCard';
import { LoadMeter } from '../assets/loadMeter';
/**
 * THE SARAH LAB — Sarah rebuilt from Joshua's base mannequin, on a turntable,
 * to try before anything of it goes live (Joshua, 2026-10-07: "Good to test
 * Sarah maybe in a separate link in like a Dev menu I can play around with
 * before placing live").
 *
 * A DEV TOOL scene (ARCHITECTURE §8), the Story Lab's shape: no session, a
 * BACK control, one model. What it shows is what the bake put in the file:
 *
 *   BUMP      the belly morph targets (`scripts/bellyMorph.mjs`): 100% is the
 *             master as modelled, 200% twice that (twins and more), 0% nearly flat;
 *             her bust grows from the normal model at 0% to 1.5× at 100% and 2× at 200%. Every primitive that
 *             carries the target follows it, so the clothes grown from her
 *             body shrink with it.
 *   (weight)  past full term the bump sags by its size, and two springs let the
 *             bump and the breasts lag and settle as she moves (the bake's motion
 *             targets, `stepBellySpring`, `stepBreastSpring`); BOUNCE nudges both.
 *   FINGERS   all ten curled together, toward the palm: the master's own
 *             finger chains, found from the bind pose, never by name.
 *   OUTFIT    cycles the garments (`scripts/growClothes.mjs`), by material:
 *             tee + leggings, bikini, swimsuit, none (`OUTFITS`).
 *   STAND, WALK, SIT  the game's own poses: `poseHuman` and the pregnant sit.
 *   T-POSE exposes the side hem by restoring the master's bind pose.
 *
 * The camera ORBITS her: drag to go round, pinch or wheel to come closer.
 * The model is authored in metres and scaled by M on one node, as the Story
 * Lab's bodies are.
 */
import * as THREE from 'three';
import { HUMAN_POSE_TURNS, humanStride, poseHuman } from '../actor/humanPose';
import { newJointTurn, type BindJoint, type HumanMeasure, type JointTurn, type MutableJointTurn } from '../actor/humanRig';
import { SEATED_TURNS, poseSeated } from '../actor/humanSeated';
import { measureHuman } from '../actor/humanSkeleton';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { assets } from '../assets/assets';
import { release } from '../tombs/LabPeople';
import { BODY_CONTROLS, BREAST_DIMENSIONS, controlLine, defaultBodyShape, resetControl, setControl, setLinkedControl, type BodyControl, type BodyShape } from '../actor/bodyShape';
import { applyShapeFields, liftShapeFields, type ShapeFields } from '../view/bodyShapeView';
import { HumanRig, findSkinnedMesh } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import {
  BELLY_MOTION, BELLY_TARGET, trimShown, BREAST_TARGETS, BUMP_MAX_PERCENT, GARMENTS, RECOVERED_SHIRTS, OUTFITS, outfitLine, modelLine, refineLine, refineWeight, nextOutfit, wornGarments, coverMask, bodyNeverHidden, uncoveredSkinIndices, UNDER_TOP_GARMENT, BELLY_REFINE_TARGET, SEAT_TARGET, seatCorrectiveWeight, SARAH_LAB_MODELS, SARAH_LAB_DEFAULT_MODEL, SARAH_LAB_ACTION, SARAH_LAB_FIELD, SARAH_LAB_HUD_ROLE, SARAH_LAB_SCENE_ID,
  bellyMotionWeights, bellyWeights, breastBobWeight, breastWeightsForShape, bodyShapeFieldWeights, SIZE_TILT_PRESETS_DEG, effectiveTiltDeg, stepSeated, bustVolume, BREAST_GROW_TARGET, settledSitFor, bellyUpperWeight, BELLY_UPPER_TARGET, navelWeights, NAVEL_FLAT_TARGET, navelFlatWeight, tPoseTurns, ARM_SIDES, armsLine, ARM_RAISE_TARGETS, armRaiseWeight, SEAT_V2_TARGET, seatCorrectiveV2Weight, fingerBend, THUMB_TO_PALM, bumpLine, fingersLine, restingBellySpring, statusLine, stepBellySpring, stepBreastSpring, walkBounceAccel,
  type Garment, type SarahLabPose, recoveredPartsFor, recoveredPartPath, isShirtPart, shirtOfPart, type RecoveredPart,
} from './sarahLabTool';

const M = UNITS_PER_METRE;
/** What the card says while the room opens. */
const OPENING_LABEL = 'Opening the character room';
/** The camera's vertical view on a landscape screen (degrees). */
const LANDSCAPE_FOV = 38;
/** Held upright: the CSS pixels BACK and the title take at the top of the screen, kept clear of her. */
const UPRIGHT_TOP = 56;
/** A walk on the spot, metres a second: an unhurried pace. */
const WALK_SPEED = 1.1;

export interface SarahLabHooks {
  onBack(): void;
  /** Offline fitting uses native garments to avoid loading its own generated outputs. */
  readonly nativeOutfitPreview?: boolean;
}

export type SarahLabWire = (ctx: SceneContext) => SarahLabHooks;

// ---------------------------------------------------------------- the fingers

interface Finger { readonly joints: readonly number[]; readonly axis: THREE.Vector3; readonly thumb: boolean }

/**
 * Each hand's fingers, from the bind pose: under each wrist, the first joint
 * that branches four ways or more is the hand, and each branch is a finger
 * (its joints down to the tip, the tip itself left out). The thumb is the
 * branch whose base is furthest from the others. A finger curls about the
 * axis across its own length and the palm's normal, signed so the fingers
 * close over the palm on either hand.
 */
function findFingers(bind: readonly BindJoint[], measure: HumanMeasure): Finger[] {
  const kids = bind.map(() => [] as number[]);
  bind.forEach((b, i) => { if (b.parent >= 0) kids[b.parent].push(i); });
  const at = (i: number) => new THREE.Vector3(bind[i].x, bind[i].y, bind[i].z);
  const out: Finger[] = [];
  for (const wrist of [measure.joints.wristL, measure.joints.wristR]) {
    // the hand: the first joint at or below the wrist with four branches or more
    let hand = -1;
    const queue = [wrist];
    while (queue.length) {
      const j = queue.shift()!;
      if (kids[j].length >= 4) { hand = j; break; }
      queue.push(...kids[j]);
    }
    if (hand < 0) continue;
    const chains = kids[hand].map((root) => {
      const chain = [root];
      let j = root;
      while (kids[j].length > 0) { j = kids[j][0]; chain.push(j); }
      return chain;
    });
    const bases = chains.map((c) => at(c[0]));
    const centre = bases.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / bases.length);
    const thumbIndex = bases.reduce((best, b, i) => (b.distanceTo(centre) > bases[best].distanceTo(centre) ? i : best), 0);
    const others = chains.filter((_, i) => i !== thumbIndex);
    if (others.length < 2) continue;
    const thumbBase = bases[thumbIndex];
    others.sort((a, b) => at(a[0]).distanceTo(thumbBase) - at(b[0]).distanceTo(thumbBase));
    const index = at(others[0][0]), pinky = at(others[others.length - 1][0]);
    const along = centre.clone().sub(at(wrist)).normalize();
    const across = index.clone().sub(pinky).normalize();
    // the palm's normal; a mirror image flips a cross product, so the side's sign puts it back
    const side = Math.sign(at(wrist).x) || 1;
    const palm = new THREE.Vector3().crossVectors(along, across).multiplyScalar(side).normalize();
    for (const [i, chain] of chains.entries()) {
      const joints = chain.slice(0, -1);
      if (joints.length === 0) continue;
      const dir = at(chain[chain.length - 1]).sub(at(chain[0])).normalize();
      const thumb = i === thumbIndex;
      // A finger closes toward the palm. THE THUMB folds ACROSS it, toward the little
      // finger (Joshua, 2026-10-08: "some of the fingers are bending the wrong
      // direction like the thumb"): bent straight toward the palm from where it
      // sits, it hooked down under the hand.
      const toward = thumb ? palm.clone().multiplyScalar(THUMB_TO_PALM).sub(across).normalize() : palm;
      const axis = new THREE.Vector3().crossVectors(dir, toward).normalize();
      out.push({ joints, axis, thumb });
    }
  }
  return out;
}

// ------------------------------------------------------------------- the scene

export function buildSarahLabScene(ctx: SceneContext, hooks: SarahLabHooks): AppScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color(0x1b2028);
  const camera = new THREE.PerspectiveCamera(LANDSCAPE_FOV, 1, 2, 4_000);

  const hemi = new THREE.HemisphereLight(0xe8eef6, 0x30343a, 1.2);
  const key = new THREE.DirectionalLight(0xfff2e2, 2.0);
  key.position.set(1.5 * M, 2.8 * M, 2.2 * M);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 0.9);
  rim.position.set(-2 * M, 1.8 * M, -2 * M);
  three.add(hemi, key, rim);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.4 * M, 64),
    new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.38 * M, 1.4 * M, 64), new THREE.MeshBasicMaterial({ color: 0x4a5462 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  three.add(floor, ring);
  // a plain stool for SIT, sized when she sits on it
  const stool = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2 * M, 0.22 * M, 1, 28),
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }),
  );
  stool.visible = false;
  three.add(stool);

  let model: THREE.Object3D | null = null;
  let rig: HumanRig | null = null;
  let measure: HumanMeasure | null = null;
  let fingers: Finger[] = [];
  let skinned: THREE.SkinnedMesh[] = [];
  let garments: Garment[] = [];
  let hasBelly = false;
  let recovered = false;
  let loaded = false;
  let failed = false;
  // ------------------------------------------------------------ loading (Joshua, 2026-10-20): what is downloading,
  // drawn by the card; each recovered file fetched when an outfit first needs it (recoveredPartsFor), its meshes kept
  // on her once fetched -- one shirt at a time -- and a shirt download for an outfit no longer wanted cancelled
  const meter = new LoadMeter();
  let card: LoadingCard | null = null;
  let cardPlace: LoadingPlace = 'centre';
  let batch = 0, readyBatch = -1, readyIn = 0;
  let retry: () => void = () => {};
  const partMeshes = new Map<RecoveredPart, THREE.SkinnedMesh[]>();
  const inflight = new Map<RecoveredPart, { promise: Promise<THREE.Object3D>; abort: AbortController }>();
  /** An outfit whose clothes are on their way; she wears `outfit` until they are on. */
  let wantedOutfit: number | null = null;
  let outfitRequest = 0;
  let disposed = false;

  let pose: SarahLabPose = 'stand';
  /** 0 standing, 1 fully seated: how far the thighs have taken over the bump's tilt (`effectiveTiltDeg`). */
  let seated = 0;
  /** Breast dimensions moved together, as by an aspect-ratio lock: a flag only, never a value. */
  const linked = new Set<BodyControl>();
  let bump = 100;
  let curl = 0;
  // v2's ARMS control can override any pose; until used, the pose keeps its natural arms.
  // v1 keeps the original T-POSE-only control and its level-arm default.
  let armsDeg = SARAH_LAB_MODELS[SARAH_LAB_DEFAULT_MODEL].id === 'v1' ? 90 : 0, armSide = 0;
  let armsOverride = false;
  // The bump's spring and the breasts' (lighter, quicker), fed the same motion. The
  // bump's weight is its size's own (`bellyMotionWeights`): the WEIGHT slider that
  // added to it is gone (Joshua, 2026-10-08: "keep the current weights... just not
  // have that slider option").
  const spring = restingBellySpring();
  const breastSpring = restingBellySpring();
  /** A point at the front of her middle, in the spine bone's frame: what the spring feels move. */
  let feel: { bone: THREE.Bone; local: THREE.Vector3 } | null = null;
  const felt = { p: new THREE.Vector3(), v: new THREE.Vector3(), primed: 0 };
  const tmp = new THREE.Vector3();
  let outfit = 0;
  let modelIndex = SARAH_LAB_DEFAULT_MODEL;
  // the body's own proportions (Joshua, 2026-10-15): all approved values to start, so she
  // looks exactly as approved until a control moves
  let body: BodyShape = defaultBodyShape();
  let shaped: { mesh: THREE.SkinnedMesh; fields: ShapeFields }[] = [];
  const bodyInputs = new Map<BodyControl, HTMLInputElement>();
  const shownNow = (g: Garment) => wornGarments(outfit, garments).includes(g);
  let turning = false;
  // v2's switchable curve refinement (CURVE), off: her master as modelled
  let refine = false;
  let seconds = 0;
  let walked = 0;
  const poseOut: MutableJointTurn[] = Array.from({ length: Math.max(HUMAN_POSE_TURNS, SEATED_TURNS) }, newJointTurn);

  // ------------------------------------------------------------ the orbit
  const ORBIT_START = Object.freeze({ yaw: 0.5, pitch: 0.12, distance: 2.9 * M, target: Object.freeze(new THREE.Vector3(0, 0.95 * M, 0)) });
  const orbit: { yaw: number; pitch: number; distance: number; target: THREE.Vector3 } = { yaw: ORBIT_START.yaw, pitch: ORBIT_START.pitch, distance: ORBIT_START.distance, target: ORBIT_START.target.clone() };
  function placeCamera(): void {
    const c = Math.cos(orbit.pitch);
    camera.position.set(
      orbit.target.x + orbit.distance * c * Math.sin(orbit.yaw),
      orbit.target.y + orbit.distance * Math.sin(orbit.pitch),
      orbit.target.z + orbit.distance * c * Math.cos(orbit.yaw),
    );
    camera.lookAt(orbit.target);
  }

  // HELD UPRIGHT the tab bar (and an open tab's sheet) cover the bottom of the screen and BACK and the title the top,
  // so she is framed in the room between them: the view widens until what a landscape screen shows of her fits that
  // part, and slides so its middle is that part's middle. The camera's own place and the orbit are as they were.
  let upright_: UprightLayout | null = null;
  function frame(width: number, height: number, lay = true): void {
    camera.aspect = width / Math.max(1, height);
    if (lay) upright_?.setPortrait(height > width);
    if (upright_?.portrait && height > width) {
      const cssHeight = Math.max(1, hud?.clientHeight ?? height), top = UPRIGHT_TOP / cssHeight, bottom = Math.min(0.7, upright_.covered() / cssHeight);
      const shown = Math.max(0.2, 1 - top - bottom), middle = top + shown / 2;
      camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(LANDSCAPE_FOV / 2)) / shown));
      camera.setViewOffset(width, height, 0, height * (0.5 - middle), width, height);
    } else {
      camera.fov = LANDSCAPE_FOV;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ HUD
  let hud: HTMLElement | null = null;
  let texturePanel: ReturnType<typeof garmentTexturePanel> | null = null;
  const fields: Record<string, HTMLElement> = {};
  const buttons: Record<string, HTMLButtonElement> = {};
  let armsInput: HTMLInputElement | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  function refresh(): void {
    if (fields.status) fields.status.textContent = statusLine(loaded && model?.visible === true, failed, garments, hasBelly, modelIndex) + (wantedOutfit !== null ? ' · loading outfit…' : '');
    const bumpField = fields[SARAH_LAB_FIELD.bump], fingerField = fields[SARAH_LAB_FIELD.fingers];
    if (bumpField) bumpField.textContent = bumpLine(bump);
    if (fingerField) fingerField.textContent = fingersLine(curl);
    const armsField = fields[SARAH_LAB_FIELD.arms];
    if (armsField) armsField.textContent = armsLine(armsDeg, ARM_SIDES[armSide]);
    if (armsInput && Number(armsInput.value) !== armsDeg) armsInput.value = String(armsDeg);
    if (buttons.armSide) buttons.armSide.textContent = `ARMS · ${ARM_SIDES[armSide]}`;
    for (const c of BODY_CONTROLS) {
      const line = fields[`${SARAH_LAB_FIELD.body}${c.key}`];
      // seated, the tilt in use is not the one chosen: say both, so a sitting body never reads as the slider's
      if (line) line.textContent = controlLine(c.key, body[c.key]) + (c.key === 'bellyTilt' && pose === 'sit' ? ` · seated ${effectiveTiltDeg(body.bellyTilt, 1).toFixed(1)}°` : '') + (c.key === 'breastSize' ? ` · bust ${bustVolume(bump, body.breastSize).toFixed(2)}×` : '');
      const input = bodyInputs.get(c.key);
      if (input && Number(input.value) !== body[c.key]) input.value = String(body[c.key]);
    }
    if (fields[SARAH_LAB_FIELD.bodyNote]) fields[SARAH_LAB_FIELD.bodyNote].textContent = loaded && !shaped.length ? 'this model has no shape fields: TILT and SIZE work, the rest are in v2-body' : '';
    const lit = (b: HTMLButtonElement | undefined, on: boolean) => {
      if (!b) return;
      b.style.background = on ? 'rgba(212,168,83,0.92)' : 'rgba(16,20,26,0.72)';
      b.style.color = on ? '#15110a' : '#e8e2d8';
    };
    for (const k of BREAST_DIMENSIONS) lit(buttons[`link-${k}`], linked.has(k));
    if (buttons.linkAll) { const all = BREAST_DIMENSIONS.every((k) => linked.has(k)); buttons.linkAll.textContent = all ? 'UNLINK W·H·D' : 'LINK W·H·D'; lit(buttons.linkAll, all); }
    lit(buttons.stand, pose === 'stand');
    lit(buttons.walk, pose === 'walk');
    lit(buttons.sit, pose === 'sit');
    lit(buttons.tpose, pose === 'tpose');
    lit(buttons.turn, turning);
    for (const t of SIZE_TILT_PRESETS_DEG) lit(buttons[`tilt${t}`], body.bellyTilt === t);
    if (buttons.outfit) buttons.outfit.textContent = `OUTFIT · ${outfitName(wantedOutfit ?? outfit)}${wantedOutfit !== null ? ' …' : ''}`;
    if (buttons.model) buttons.model.textContent = modelLine(modelIndex);
    if (buttons.refine) {
      // only v2 has the switchable curve: the button is not shown for v1
      buttons.refine.style.display = SARAH_LAB_MODELS[modelIndex].id.startsWith('v2') ? '' : 'none';
      buttons.refine.textContent = refineLine(refine);
      lit(buttons.refine, refine);
    }
  }

  /** The bump's weight, every frame: its resting tilt and where the spring has it. */
  function applyMotion(): void {
    const w: Record<string, number> = { ...bellyMotionWeights(bump, 0, spring, effectiveTiltDeg(body.bellyTilt, seated)), [BREAST_TARGETS.bob]: breastBobWeight(bump, breastSpring) };
    for (const mesh of skinned) {
      const dict = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;
      for (const name of [BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway, BREAST_TARGETS.bob]) {
        const at = dict[name];
        if (at !== undefined) influences[at] = w[name];
      }
      applyRecoveredBaseline(mesh, bump, [BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway, BREAST_TARGETS.bob]);
    }
  }

  /** The raised-arm shapes follow the same override as the bones, on every skinned surface. */
  function armRaiseWeights(): Record<string, number> {
    const out: Record<string, number> = { [ARM_RAISE_TARGETS.plusX]: 0, [ARM_RAISE_TARGETS.minusX]: 0 };
    if (!rig || !measure || (pose !== 'tpose' && (SARAH_LAB_MODELS[modelIndex].id === 'v1' || !armsOverride))) return out;
    const side = ARM_SIDES[armSide], w = armRaiseWeight(armsDeg);
    for (const [arm, on] of [[measure.joints.shoulderL, side !== 'right'], [measure.joints.shoulderR, side !== 'left']] as const) {
      if (!on) continue;
      out[(rig.bind[arm]?.x ?? 0) >= 0 ? ARM_RAISE_TARGETS.plusX : ARM_RAISE_TARGETS.minusX] = w;
    }
    return out;
  }

  function applyLook(): void {
    const fieldWeights = bodyShapeFieldWeights(body, bump);
    for (const { mesh, fields } of shaped) applyShapeFields(mesh, fields, {
      ...fieldWeights,
      ...(mesh.userData.recoveredShirt ? fitWeights(bump, 'shape:fitBelly') : {}),
      ...(mesh.userData.recoveredShirt ? fitWeights(bump, 'shape:fineFit', SHIRT_FINE_FIT_KEYS) : {}),
      ...(mesh.userData.recoveredLeggings ? fitWeights(bump, 'shape:recoveryLeggings', LEGGINGS_FIT_KEYS) : {}),
    // recovered clothes keep RAW normal sums so the GPU's belly offsets land on what their fit expects; the leggings
    // were normalized here too, and at 0-50% the large belly offsets flipped normals in the fold under her belly
    }, { normalizeNormals: !(mesh.userData.recoveredShirt || mesh.userData.recoveredLeggings) });
    for (const mesh of skinned) {
      const dict = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
      if (dict && influences) for (const [name, w] of Object.entries({ ...bellyWeights(bump), ...breastWeightsForShape(bump, dict[BREAST_GROW_TARGET] !== undefined, body.breastSize), [BELLY_UPPER_TARGET]: bellyUpperWeight(bump), ...navelWeights(bump), [NAVEL_FLAT_TARGET]: navelFlatWeight(bump), [BELLY_REFINE_TARGET]: refineWeight(refine, bump), [SEAT_TARGET]: seatCorrectiveWeight(pose === 'sit' ? 1 : 0, bump), [SEAT_V2_TARGET]: seatCorrectiveV2Weight(pose === 'sit' ? 1 : 0, bump), ...armRaiseWeights() })) {
        const at = dict[name];
        if (at !== undefined) influences[at] = w;
      }
      applyRecoveredBaseline(mesh, bump);
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name as Garment;
      if (([...GARMENTS, ...RECOVERED_SHIRTS] as readonly string[]).includes(name)) mesh.visible = shownNow(name);
      { const t = trimShown(name, wornGarments(outfit, garments)); if (t !== null) mesh.visible = t; }
      if (mesh.userData.replacedByRecovered) mesh.visible = false;
      if (mesh.userData.recoveredLeggings) updateLeggingsHem(mesh, bump, shownNow('shirtSpandexHigh') ? 'spandex' : 'relaxed');
      // the leggings under a worn athletic tee, the same way
      const underTop = mesh.geometry.getAttribute('_under_top');
      if (underTop && mesh.geometry.index) {
        const all = (mesh.userData.allIndices ??= mesh.geometry.index.array.slice()) as ArrayLike<number>;
        const on = shownNow(UNDER_TOP_GARMENT) ? 1 : 0;
        if (mesh.userData.coverMask !== on) {
          mesh.userData.coverMask = on;
          const bits = (mesh.userData.coverBits ??= Uint8Array.from({ length: underTop.count }, (_, i) => underTop.getX(i))) as Uint8Array;
          mesh.geometry.setIndex(new THREE.BufferAttribute(on ? uncoveredSkinIndices(all, bits, 1) : Uint32Array.from(all), 1));
        }
      }
      // the body: on v1 the skin the shown clothes cover is left out of the draw. On v2 the body is NEVER
      // hidden (Joshua, 2026-10-19: "the base body should never be hidden... clothing needs to sit over the body,
      // and/or be painted on"): every garment has to clear her skin by itself.
      const cover = mesh.geometry.getAttribute('_cloth_cover');
      if (cover && mesh.geometry.index) {
        const all = (mesh.userData.allIndices ??= mesh.geometry.index.array.slice()) as ArrayLike<number>;
        const mask = bodyNeverHidden(SARAH_LAB_MODELS[modelIndex].id) ? 0 : coverMask(wornGarments(outfit, garments));
        if (mesh.userData.coverMask !== mask) {
          mesh.userData.coverMask = mask;
          // read through getX: the file stores the bits with a stride (vertex data is 4-byte
          // aligned), so the raw array is not one entry a vertex
          const bits = (mesh.userData.coverBits ??= Uint8Array.from({ length: cover.count }, (_, i) => cover.getX(i))) as Uint8Array;
          mesh.geometry.setIndex(new THREE.BufferAttribute(mask ? uncoveredSkinIndices(all, bits, mask) : Uint32Array.from(all), 1));
        }
      }
    }
  }

  /** The outfit as the OUTFIT button names it: on v2 the first two are the relaxed tee over either rise. */
  function outfitName(index: number): string {
    return recovered && index < 2 ? `relaxed + ${index === 0 ? 'high' : 'low'} leggings` : outfitLine(index).replace(/^OUTFIT · /, '');
  }

  /** A new load for the card: what it is called and where it sits. */
  function begin(label: string, place: LoadingPlace): void {
    meter.start(label);
    cardPlace = place;
    batch++;
  }

  /** The room is usable once the GPU has her: compile what is new, then two frames drawn, then the card goes. */
  function settle(): void {
    const b = batch;
    void ctx.renderer.gl.compileAsync(three, camera).catch(() => {}).then(() => { if (b === batch) { readyBatch = b; readyIn = 2; } });
  }

  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
  function failLoad(what: string, again: () => void): void {
    retry = again;
    meter.fail(offline() ? `This device is offline, so ${what} could not be downloaded. Connect, then tap Retry.` : `${what[0].toUpperCase()}${what.slice(1)} could not be downloaded. Check your connection, then tap Retry.`);
  }

  /** Fetch one recovered file, or join the fetch already under way. */
  function requestPart(part: RecoveredPart, onDownloaded?: () => void): Promise<THREE.Object3D> {
    const running = inflight.get(part);
    if (running) { meter.expect(recoveredPartPath(part), assets.assetBytes(recoveredPartPath(part))); return running.promise; }
    const abort = new AbortController();
    const promise = assets.loadModel(recoveredPartPath(part), () => new THREE.Object3D(), { meter, signal: abort.signal, onDownloaded });
    inflight.set(part, { promise, abort });
    // a small file goes on her the moment it lands, whatever became of the outfit that asked for it (the opening's
    // land before her body is built, and the opening puts them on)
    const body = model;
    if (!isShirtPart(part)) promise.then((scene) => { if (!disposed && body && model === body && !scene.userData.isPlaceholder && !partMeshes.has(part)) wearPart(part, scene); }, () => {});
    const forget = () => { if (inflight.get(part)?.promise === promise) inflight.delete(part); };
    promise.then(forget, forget);
    return promise;
  }

  /** Put a fetched file's meshes on her (bound to her live skeleton, hidden until an outfit shows them). */
  function wearPart(part: RecoveredPart, scene: THREE.Object3D): void {
    const skin = model ? findSkinnedMesh(model) : null;
    if (!skin || scene.userData.isPlaceholder || partMeshes.has(part)) { release(scene); return; }
    if (isShirtPart(part)) {
      // one imported shirt in memory: the one she is putting on replaces the last
      for (const [p, old] of [...partMeshes]) {
        if (!isShirtPart(p)) continue;
        skinned = skinned.filter(m => !old.includes(m)); shaped = shaped.filter(x => !old.includes(x.mesh));
        releaseRecoveredMeshes(old); partMeshes.delete(p);
      }
    }
    const meshes = attachRecoveredMeshes(scene, skin, isShirtPart(part) ? shirtOfPart(part) : undefined);
    for (const mesh of meshes) {
      if (part.startsWith('leggings')) mesh.userData.recoveredLeggings = true;
      skinned.push(mesh);
      const fields = liftShapeFields(mesh);
      if (fields) shaped.push({ mesh, fields });
    }
    partMeshes.set(part, meshes);
  }

  /**
   * PUT ON OUTFIT `next`. With all its clothes on hand it is immediate; otherwise she keeps what she has on while the
   * missing files download (the card at the top says how far), and changes when they are all in. `opening` is the
   * room's first dressing: it carries on the opening's load rather than starting its own.
   */
  function dress(next: number, opening = false): void {
    // chosen before she is in: the opening dresses her in it
    if (!loaded && !opening) { outfit = next; refresh(); return; }
    const parts = recovered ? recoveredPartsFor(wornGarments(next, garments)) : [];
    const missing = parts.filter(p => !partMeshes.has(p));
    // a shirt download for an outfit no longer wanted is cancelled: 66-77 MB a phone should not finish for nothing
    for (const [p, run] of [...inflight]) if (isShirtPart(p) && !parts.includes(p)) { run.abort.abort(); inflight.delete(p); }
    const request = ++outfitRequest;
    if (!missing.length) {
      wantedOutfit = null; outfit = next;
      if (model) model.visible = true;
      applyLook(); applyMotion(); refresh();
      if (opening) settle(); else if (meter.snapshot().phase !== 'idle') meter.ready();
      return;
    }
    wantedOutfit = opening ? null : next;
    if (!opening) begin(`Loading ${outfitName(next)}`, model?.visible ? 'aside' : 'centre');
    for (const p of missing) meter.expect(recoveredPartPath(p), assets.assetBytes(recoveredPartPath(p)));
    refresh();
    const expectedModel = model;
    void Promise.all(missing.map(p => requestPart(p))).then(scenes => {
      const stale = disposed || model !== expectedModel || request !== outfitRequest;
      const broken = scenes.some(x => x.userData.isPlaceholder);
      // the small files are worth keeping whatever happened; a shirt is kept only by the outfit it was fetched for
      const sameBody = !disposed && model === expectedModel;
      missing.forEach((p, i) => { if (sameBody && (isShirtPart(p) ? !stale && !broken : true)) wearPart(p, scenes[i]); else release(scenes[i]); });
      if (stale) return;
      if (broken) { failLoad(opening ? 'her outfit' : `the ${outfitName(next)} outfit`, () => again(next, opening)); refresh(); return; }
      wantedOutfit = null; outfit = next;
      if (model) model.visible = true;
      applyLook(); applyMotion(); refresh(); settle();
    }).catch(error => {
      if ((error as Error)?.name === 'AbortError' || request !== outfitRequest) return;
      console.error('[sarahlab] outfit preparation failed', error);
      failLoad('her outfit', () => again(next, opening)); refresh();
    });
  }
  /** Retry an outfit: a fresh count, then dress again (what did arrive is on her already and is not fetched twice). */
  function again(next: number, opening: boolean): void {
    if (opening) begin(OPENING_LABEL, 'centre');
    dress(next, opening);
  }

  function buildHud(): void {
    const root = document.createElement('div');
    root.dataset.role = SARAH_LAB_HUD_ROLE;
    // UPRIGHT ON A PHONE (Joshua, 2026-10-20: "allow both portraits and landscape views", then "maybe optimize UI for
    // portrait better... tabs or buttons similar to the storm tracker at the bottom"): held portrait, the controls
    // are sorted into tabs along the bottom (uprightTabs.ts) and the title keeps to one line between BACK and the
    // corner; the camera frames her above what the controls cover (frame()). Landscape is as it was.
    const upright = document.createElement('style');
    upright.textContent = `@media (orientation: portrait) {
      [data-role="${SARAH_LAB_HUD_ROLE}"] .slab-info { max-width: calc(100vw - 200px) !important; }
      [data-role="${SARAH_LAB_HUD_ROLE}"] .slab-info > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }`;
    root.appendChild(upright);
    root.style.cssText = 'position:absolute;inset:0;font:600 13px system-ui,sans-serif;color:#e8e2d8;touch-action:none;user-select:none';
    // the orbit: the whole screen under the controls
    root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input,select,summary')) return;
      root.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    root.addEventListener('pointermove', (e) => {
      const was = pointers.get(e.pointerId);
      if (!was) return;
      const now = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, now);
      if (pointers.size === 1) {
        orbit.yaw -= (now.x - was.x) * 0.008;
        orbit.pitch = Math.min(1.2, Math.max(-0.35, orbit.pitch + (now.y - was.y) * 0.006));
        turning = false;
        refresh();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) zoom(pinch / Math.max(1, d));
        pinch = d;
      }
    });
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });

    const panel = 'position:absolute;display:flex;gap:8px;';
    const btn = (label: string, action: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.action = action;
      b.style.cssText = 'padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(16,20,26,0.72);color:#e8e2d8;font:700 13px system-ui,sans-serif;letter-spacing:.06em';
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); refresh(); });
      return b;
    };
    const back = btn('BACK', SARAH_LAB_ACTION.back, () => hooks.onBack());
    back.style.cssText += ';position:absolute;left:max(12px,env(safe-area-inset-left));top:12px';
    root.appendChild(back);

    const poses = document.createElement('div');
    poses.className = 'slab-poses';
    poses.dataset.tab = 'pose'; poses.dataset.uprightWhole = '';
    poses.style.cssText = `${panel}left:max(12px,env(safe-area-inset-left));bottom:16px`;
    for (const [p, label, action] of [['stand', 'STAND', SARAH_LAB_ACTION.stand], ['walk', 'WALK', SARAH_LAB_ACTION.walk], ['sit', 'SIT', SARAH_LAB_ACTION.sit], ['tpose', 'T-POSE', SARAH_LAB_ACTION.tpose]] as const) {
      buttons[p] = btn(label, action, () => {
        pose = p;
        if (p === 'tpose' && SARAH_LAB_MODELS[modelIndex].id !== 'v1') { armsDeg = 90; armsOverride = true; }
        applyLook(); refresh();
      });
      poses.appendChild(buttons[p]);
    }
    root.appendChild(poses);

    const right = document.createElement('div');
    right.className = 'slab-panel';
    right.style.cssText = `${panel}flex-direction:column;align-items:stretch;right:max(12px,env(safe-area-inset-right));top:12px;width:min(230px,40vw);padding:10px;border-radius:12px;background:rgba(10,13,18,0.66);border:1px solid rgba(255,255,255,0.1)`;
    const slider = (field: string, value: number, onInput: (v: number) => void, max = 100, tab = 'body') => {
      const label = document.createElement('div');
      label.dataset.tab = tab;
      label.dataset.field = field;
      label.style.cssText = 'font-size:12px;letter-spacing:.05em';
      fields[field] = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = String(max);
      input.value = String(value);
      input.style.cssText = 'width:100%;accent-color:#d4a853;height:28px';
      input.dataset.tab = tab;
      input.addEventListener('input', () => { onInput(Number(input.value)); applyLook(); refresh(); });
      right.append(label, input);
      return input;
    };
    slider(SARAH_LAB_FIELD.bump, bump, (v) => { bump = v; }, BUMP_MAX_PERCENT);
    slider(SARAH_LAB_FIELD.fingers, curl, (v) => { curl = v; }, 100, 'pose');
    armsInput = slider(SARAH_LAB_FIELD.arms, armsDeg, (v) => { armsDeg = v; armsOverride = true; }, 90, 'pose');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    buttons.outfit = btn(outfitLine(outfit), SARAH_LAB_ACTION.outfit, () => { dress(nextOutfit(wantedOutfit ?? outfit, garments)); });
    buttons.model = btn(modelLine(modelIndex), SARAH_LAB_ACTION.model, () => {
      modelIndex = (modelIndex + 1) % SARAH_LAB_MODELS.length;
      armsDeg = SARAH_LAB_MODELS[modelIndex].id === 'v1' || pose === 'tpose' ? 90 : 0;
      armsOverride = pose === 'tpose';
      loadSarah();
    });
    buttons.refine = btn(refineLine(refine), SARAH_LAB_ACTION.refine, () => { refine = !refine; applyLook(); refresh(); });
    buttons.armSide = btn('ARMS · both', SARAH_LAB_ACTION.armSide, () => { armSide = (armSide + 1) % ARM_SIDES.length; applyLook(); refresh(); });
    buttons.turn = btn('TURN', SARAH_LAB_ACTION.turn, () => { turning = !turning; });
    // a nudge up, as a hop would: the bump lags, drops and settles
    buttons.bounce = btn('BOUNCE', SARAH_LAB_ACTION.bounce, () => { spring.vy += 0.3; breastSpring.vy += 0.3; });
    for (const b of [buttons.model, buttons.refine, buttons.outfit, buttons.armSide, buttons.turn, buttons.bounce]) { b.style.padding = '8px 10px'; b.style.fontSize = '12px'; row.appendChild(b); }
    for (const [b, tab] of [[buttons.model, 'body'], [buttons.refine, 'body'], [buttons.outfit, 'clothes'], [buttons.armSide, 'pose'], [buttons.turn, 'camera'], [buttons.bounce, 'pose']] as const) b.dataset.tab = tab;
    right.appendChild(row);
    // BELLY SHAPE and BREAST SHAPE: each control a slider with its own reset, relative to the size shown
    const setBody = (next: BodyShape) => { body = next; applyLook(); applyMotion(); refresh(); };
    for (const [group, title] of [['belly', 'BELLY SHAPE'], ['breasts', 'BREAST SHAPE']] as const) {
      const box = document.createElement('details');
      box.dataset.tab = 'body';
      box.style.cssText = 'border-top:1px solid rgba(255,255,255,0.12);padding-top:6px';
      const head = document.createElement('summary');
      head.textContent = title;
      head.style.cssText = 'cursor:pointer;font:700 12px system-ui,sans-serif;letter-spacing:.08em;padding:4px 0';
      box.appendChild(head);
      if (group === 'belly') {
        const presets = document.createElement('div');
        presets.style.cssText = 'display:flex;gap:6px;margin:4px 0';
        for (const t of SIZE_TILT_PRESETS_DEG) {
          const b = btn(`TILT ${t}°`, `${SARAH_LAB_ACTION.tiltPreset}${t}`, () => setBody(setControl(body, 'bellyTilt', t)));
          b.style.padding = '6px 8px'; b.style.fontSize = '11px';
          buttons[`tilt${t}`] = b; presets.appendChild(b);
        }
        box.appendChild(presets);
      }
      for (const c of BODY_CONTROLS.filter((k) => k.group === group)) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.04em;margin-top:4px';
        const label = document.createElement('span');
        label.dataset.field = `${SARAH_LAB_FIELD.body}${c.key}`;
        fields[`${SARAH_LAB_FIELD.body}${c.key}`] = label;
        const reset = btn('↺', `${SARAH_LAB_ACTION.bodyReset}${c.key}`, () => setBody(resetControl(body, c.key)));
        reset.title = `reset ${c.label.toLowerCase()} to the approved value`;
        reset.style.padding = '2px 8px'; reset.style.fontSize = '12px';
        if (BREAST_DIMENSIONS.includes(c.key)) {
          // the lock: linking changes nothing on her; it decides what the next move carries with it
          const link = btn('LINK', `${SARAH_LAB_ACTION.bodyLink}${c.key}`, () => { if (linked.has(c.key)) linked.delete(c.key); else linked.add(c.key); });
          link.title = `move ${c.label.toLowerCase()} together with the other linked dimensions, keeping their proportions`;
          link.style.padding = '2px 6px'; link.style.fontSize = '10px';
          buttons[`link-${c.key}`] = link;
          const pair = document.createElement('span'); pair.style.cssText = 'display:flex;gap:4px';
          pair.append(link, reset);
          line.append(label, pair);
        } else line.append(label, reset);
        const input = document.createElement('input');
        input.type = 'range'; input.min = String(c.min); input.max = String(c.max); input.step = String(c.step); input.value = String(body[c.key]);
        input.style.cssText = 'width:100%;accent-color:#d4a853;height:24px';
        input.addEventListener('input', () => setBody(linked.has(c.key) ? setLinkedControl(body, c.key, Number(input.value), linked) : setControl(body, c.key, Number(input.value))));
        bodyInputs.set(c.key, input);
        box.append(line, input);
      }
      if (group === 'breasts') {
        const linkAll = btn('LINK W·H·D', SARAH_LAB_ACTION.bodyLinkAll, () => { const all = BREAST_DIMENSIONS.every((k) => linked.has(k)); for (const k of BREAST_DIMENSIONS) if (all) linked.delete(k); else linked.add(k); });
        linkAll.style.padding = '6px 8px'; linkAll.style.fontSize = '11px'; linkAll.style.marginTop = '6px'; linkAll.style.marginRight = '6px';
        buttons.linkAll = linkAll;
        box.appendChild(linkAll);
        const all = btn('RESET ALL SHAPE', SARAH_LAB_ACTION.bodyResetAll, () => setBody(defaultBodyShape()));
        all.style.padding = '6px 8px'; all.style.fontSize = '11px'; all.style.marginTop = '6px';
        box.appendChild(all);
      }
      right.appendChild(box);
    }
    const note = document.createElement('div');
    note.dataset.field = SARAH_LAB_FIELD.bodyNote;
    note.dataset.tab = 'body';
    note.style.cssText = 'font-size:10px;opacity:.7';
    fields[SARAH_LAB_FIELD.bodyNote] = note;
    right.appendChild(note);
    right.style.maxHeight = 'calc(100% - 85px)';
    right.style.overflowY = 'auto';
    right.style.touchAction = 'pan-y';
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) right.addEventListener(event, e => e.stopPropagation());
    texturePanel = garmentTexturePanel(() => skinned, (garment) => {
      const next = OUTFITS.findIndex(look => look.garments.includes(garment));
      if (next >= 0 && next !== outfit) dress(next);
      else { applyLook(); refresh(); }
    });
    texturePanel.element.dataset.tab = 'clothes';
    right.appendChild(texturePanel.element);
    root.appendChild(right);
    // the CAMERA tab's own buttons: held upright only (landscape has the wheel and the pinch beside its panel)
    const cameraOnly = document.createElement('div');
    cameraOnly.style.display = 'none';
    for (const [label, action, go] of [['ZOOM −', SARAH_LAB_ACTION.zoomOut, () => zoom(1.25)], ['ZOOM +', SARAH_LAB_ACTION.zoomIn, () => zoom(0.8)], ['RESET VIEW', SARAH_LAB_ACTION.resetView, () => { orbit.yaw = ORBIT_START.yaw; orbit.pitch = ORBIT_START.pitch; orbit.distance = ORBIT_START.distance; orbit.target.copy(ORBIT_START.target); turning = false; }]] as const) {
      const b = btn(label, action, go); b.style.padding = '8px 10px'; b.style.fontSize = '12px'; b.dataset.tab = 'camera'; b.dataset.uprightOnly = ''; cameraOnly.appendChild(b);
    }
    root.appendChild(cameraOnly);

    const info = document.createElement('div');
    info.className = 'slab-info';
    info.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;text-shadow:0 1px 3px #000;opacity:.92;pointer-events:none;max-width:40vw';
    const title = document.createElement('div');
    title.textContent = 'Sarah Lab · dev';
    title.style.cssText = 'font:700 14px Georgia,serif;letter-spacing:.04em';
    fields.status = document.createElement('div');
    fields.status.dataset.field = SARAH_LAB_FIELD.status;
    fields.status.style.cssText = 'font-weight:400;font-size:11px;opacity:.8';
    info.append(title, fields.status);
    root.appendChild(info);
    card = loadingCard(document, () => retry());
    root.appendChild(card.element);
    ctx.uiLayer.appendChild(root);
    hud = root;
    upright_ = uprightLayout(root, () => { right.style.display = upright_?.portrait ? 'none' : 'flex'; const size = ctx.renderer.size(); frame(size.width, size.height, false); refresh(); });
    refresh();
  }
  function zoom(factor: number): void {
    orbit.distance = Math.min(4.5 * M, Math.max(0.45 * M, orbit.distance * factor));
  }

  // ------------------------------------------------------------- posing
  function turnsFor(): readonly JointTurn[] {
    if (!rig || !measure) return [];
    let base: readonly JointTurn[];
    if (pose === 'sit') base = poseSeated(measure, rig.bind, { style: 'sit', seconds, posture: 'pregnant', bump: bump / 100, settled: settledSitFor(SARAH_LAB_MODELS[modelIndex].id) }, poseOut);
    else {
      const stance = pose === 'walk' ? 'walk' : 'stand';
      // the stride is in bind units, `bindScale` of them to the metre
      const carry = bump / 100;
      const phase = pose === 'walk' ? ((walked * rig.bindScale) / humanStride(measure, 'walk', carry)) % 1 : 0;
      base = poseHuman(measure, rig.bind, { stance, phase, seconds, lean: 0, carry }, poseOut);
    }
    const overrideArms = pose === 'tpose' || (SARAH_LAB_MODELS[modelIndex].id !== 'v1' && armsOverride);
    // T-POSE restores the whole bind pose. Other poses keep their torso and legs,
    // and the unselected arm keeps its normal animation.
    if (pose === 'tpose') base = base.map(turn => ({ ...turn, radians: 0 }));
    if (overrideArms) {
      const j = measure.joints, f = armsDeg / 90, side = ARM_SIDES[armSide];
      const selected = [
        ...(side !== 'right' ? [j.shoulderL, j.elbowL, j.wristL] : []),
        ...(side !== 'left' ? [j.shoulderR, j.elbowR, j.wristR] : []),
      ];
      // Removing all selected arm turns also restores elbows/wrists to bind at 0°,
      // instead of leaving a seated bend or walk swing underneath the slider.
      base = [...base.filter(turn => !selected.includes(turn.joint)), ...tPoseTurns(rig.bind, [
        { shoulder: j.shoulderL, elbow: j.elbowL, out: measure.leftSign > 0 ? 1 : -1, fraction: side === 'right' ? 0 : f },
        { shoulder: j.shoulderR, elbow: j.elbowR, out: measure.leftSign > 0 ? -1 : 1, fraction: side === 'left' ? 0 : f },
      ])];
    }
    if (curl <= 0 || fingers.length === 0) return base;
    const extra: JointTurn[] = [];
    for (const f of fingers) {
      f.joints.forEach((j, k) => extra.push({ joint: j, ax: f.axis.x, ay: f.axis.y, az: f.axis.z, radians: fingerBend(curl, k, f.thumb) }));
    }
    return [...base, ...extra];
  }

  function place(): void {
    if (!model || !rig || !measure) return;
    const skin = findSkinnedMesh(model);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    if (pose !== 'sit' || !skin) {
      stool.visible = false;
      return;
    }
    // seat her: ankles a sole's height off the floor, hips 10 cm over the stool's top
    const bones = skin.skeleton.bones;
    const j = measure.joints;
    const hips = bones[j.hipL].getWorldPosition(new THREE.Vector3()).add(bones[j.hipR].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const ankle = Math.min(bones[j.ankleL].getWorldPosition(new THREE.Vector3()).y, bones[j.ankleR].getWorldPosition(new THREE.Vector3()).y);
    const seatTop = Math.min(0.55, Math.max(0.4, (hips.y - ankle) / M + 0.08 - 0.1));
    model.position.set(-hips.x, (seatTop + 0.1) * M - hips.y, -0.04 * M - hips.z);
    stool.visible = true;
    stool.scale.set(1, seatTop * M, 1);
    stool.position.set(0, (seatTop * M) / 2, -0.06 * M);
  }

  /**
   * The body's acceleration at her middle, from where that point is frame to frame
   * (metres), plus a walk's own bounce, which this walk-on-the-spot leaves out; the
   * spring takes it from there.
   */
  function feelMotion(dt: number): void {
    seated = stepSeated(seated, pose === 'sit' ? 1 : 0, dt);
    if (!feel || !(dt > 0)) { applyMotion(); return; }
    feel.bone.localToWorld(tmp.copy(feel.local)).multiplyScalar(1 / M);
    let up = 0, left = 0;
    if (felt.primed >= 1) {
      const vx = (tmp.x - felt.p.x) / dt, vy = (tmp.y - felt.p.y) / dt;
      if (felt.primed >= 2) { up = (vy - felt.v.y) / dt; left = (vx - felt.v.x) / dt; }
      felt.v.set(vx, vy, 0);
      felt.primed = Math.min(2, felt.primed + 1);
    } else felt.primed = 1;
    felt.p.copy(tmp);
    if (pose === 'walk' && measure && rig) {
      const stride = humanStride(measure, 'walk', bump / 100) / rig.bindScale; // metres
      up += walkBounceAccel((walked / stride) % 1, stride / WALK_SPEED);
    }
    stepBellySpring(spring, dt, up, left);
    stepBreastSpring(breastSpring, dt, up, left);
    applyMotion();
  }

  /** Load the chosen model, putting away the one shown (MODEL switches v1 and v2). */
  function loadSarah(): void {
    if (model) { three.remove(model); rig?.dispose(); release(model); model = null; }
    rig = null; measure = null; fingers = []; skinned = []; shaped = []; garments = []; hasBelly = false; feel = null;
    recovered = false; partMeshes.clear(); wantedOutfit = null; outfitRequest++;
    for (const run of inflight.values()) run.abort.abort();
    inflight.clear();
    felt.primed = 0; loaded = false; failed = false;
    const entry = SARAH_LAB_MODELS[modelIndex], path = entry.path;
    // THE ORDER (Joshua, 2026-10-20): the room, then her, then what she has on -- only that outfit, its files asked for
    // the moment her body's bytes are in, so its download runs while her body is being built rather than after it
    const planned = hooks.nativeOutfitPreview !== true && entry.id === 'v2-body' ? recoveredPartsFor(wornGarments(outfit, [...GARMENTS, ...RECOVERED_SHIRTS])) : [];
    begin(OPENING_LABEL, 'centre');
    meter.expect(path, assets.assetBytes(path));
    for (const p of planned) meter.expect(recoveredPartPath(p), assets.assetBytes(recoveredPartPath(p)));
    refresh();
    let asked = false;
    const askForClothes = () => { if (!asked) { asked = true; for (const p of planned) void requestPart(p); } };
    void assets.loadModel(path, () => new THREE.Object3D(), { meter, onDownloaded: askForClothes }).then(async (loadedModel) => {
      if (disposed || path !== SARAH_LAB_MODELS[modelIndex].path) { release(loadedModel); return; }
      if (loadedModel.userData.isPlaceholder === true) { failed = true; failLoad('Sarah', () => loadSarah()); refresh(); return; }
      try {
        rig = new HumanRig(loadedModel);
        measure = measureHuman(rig.bind);
        fingers = findFingers(rig.bind, measure);
      } catch (error) {
        console.error('[sarahlab] the base model could not be rigged; it stands in its bind pose', error);
        rig = null;
        measure = null;
      }
      loadedModel.scale.setScalar(M);
      const approvedSkin = findSkinnedMesh(loadedModel);
      recovered = hooks.nativeOutfitPreview !== true && SARAH_LAB_MODELS[modelIndex].id === 'v2-body' && approvedSkin?.geometry.attributes.position.count === 115710 && approvedSkin.skeleton.bones.length === 68;
      if (recovered) {
        loadedModel.updateMatrixWorld(true);
        loadedModel.traverse(n => {
          const m = n as THREE.SkinnedMesh;
          if (!m.isSkinnedMesh) return;
          const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
          // both rises are replaced by their recovered, fitted copies (the low pair too, Joshua 2026-10-20: its waistband
          // dug into her belly from ~140% once her body was never hidden)
          if (name === 'leggings' || name === 'leggingsTrim' || name === 'leggingsLow' || name === 'leggingsLowTrim') m.userData.replacedByRecovered = true;
          if (name === 'bikini' && m.geometry.index) {
            const v = new THREE.Vector3(); let max = -Infinity;
            for (const i of m.geometry.index.array) { m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld); max = Math.max(max, v.y); }
            if (max < 110) m.userData.replacedByRecovered = true;
          }
        });
      } else {
        // not the body the recovered clothes were fitted to: nothing fetched for it is any use
        for (const run of inflight.values()) run.abort.abort();
        inflight.clear();
      }
      const found = new Set<Garment>();
      loadedModel.traverse((n) => {
        const mesh = n as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh !== true) return;
        mesh.frustumCulled = false;
        skinned.push(mesh);
        // the body's shape fields come off the GPU's list before the first draw (bodyShapeView)
        const lifted = liftShapeFields(mesh);
        if (lifted) shaped.push({ mesh, fields: lifted });
        if (mesh.morphTargetDictionary?.[BELLY_TARGET] !== undefined) hasBelly = true;
        const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
        if (([...GARMENTS, ...RECOVERED_SHIRTS] as readonly string[]).includes(name)) found.add(name as Garment);

      });
      garments = [...GARMENTS, ...RECOVERED_SHIRTS].filter((g) => found.has(g) || (recovered && (RECOVERED_SHIRTS as readonly string[]).includes(g)));
      if (!recovered && outfit >= 5) outfit = 0;
      model = loadedModel;
      // she stays out of sight until what she has on is on: never undressed, then dressed a moment later
      loadedModel.visible = !recovered;
      three.add(loadedModel);
      // the spring feels a point at the front of her middle, carried by her spine
      const skinMesh = findSkinnedMesh(loadedModel);
      if (skinMesh && measure) {
        loadedModel.updateMatrixWorld(true);
        const bone = skinMesh.skeleton.bones[measure.joints.spine];
        if (bone) feel = { bone, local: bone.worldToLocal(new THREE.Vector3(0, 1.0 * M, 0.2 * M)) };
      }
      loaded = true;
      dress(outfit, true);
    }).catch(error => { console.error('[sarahlab] model/outfit preparation failed', error); failed = true; loaded = false; failLoad('Sarah', () => loadSarah()); refresh(); });
  }

  return {
    name: SARAH_LAB_SCENE_ID,
    three,
    camera,
    // the one room that may be held upright on a phone (Joshua, 2026-10-20); the rotate prompt stands down for it
    portrait: true,

    async enter() {
      const size = ctx.renderer.size();
      placeCamera();
      buildHud();
      frame(size.width, size.height);
      loadSarah();
    },

    update(frame: FrameInfo) {
      if (readyIn > 0 && --readyIn === 0 && readyBatch === batch) meter.ready();
      if (card) {
        const covered = `${Math.round(upright_?.covered() ?? 0)}px`;
        if (card.element.style.getPropertyValue(LOADING_COVERED_VAR) !== covered) card.element.style.setProperty(LOADING_COVERED_VAR, covered);
        card.show(meter.snapshot(), cardPlace);
      }
      seconds += frame.rawDt;
      if (pose === 'walk') walked += WALK_SPEED * frame.rawDt;
      if (turning) orbit.yaw += frame.rawDt * 0.35;
      placeCamera();
      if (rig) rig.apply(turnsFor());
      place();
      feelMotion(frame.rawDt);
    },

    resize(width: number, height: number) {
      frame(width, height);
    },

    dispose() {
      disposed = true;
      for (const run of inflight.values()) run.abort.abort();
      inflight.clear();
      texturePanel?.dispose();
      texturePanel = null;
      hud?.remove();
      hud = null;
      if (model) { three.remove(model); rig?.dispose(); release(model); model = null; }
      skinned = [];
      three.remove(hemi, key, rim, floor, ring, stool);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      stool.geometry.dispose();
      (stool.material as THREE.Material).dispose();
      three.background = null;
    },
  };
}

export function createSarahLabScene(wire: SarahLabWire): SceneFactory {
  return (ctx) => buildSarahLabScene(ctx, wire(ctx));
}
