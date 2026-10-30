import { BELLY_CURVES, BELLY_CURVE_NAMES, DEFAULT_BELLY_CURVE, type BellyCurve } from './bellyInterpolation';
import { attachRecoveredMeshes, applyRecoveredBaseline, fitWeights, LEGGINGS_FIT_KEYS, SHIRT_FINE_FIT_KEYS, updateLeggingsHem, releaseRecoveredMeshes } from './recoveredClothes';
import { garmentTexturePanel } from './garmentTexturePanel';
import { fabricPanel, type FabricPanel } from './fabricPanel';
import { strapBuilder, type StrapBuilder } from './strapBuilder';
import { mapBody } from './bodyRegions';
import { DEFAULT_SHIRT_LENGTH } from './paintTemplates';
import { AUTO_DETAIL, EMPTY_BOOK, type CharacterBook, type SavedBody, type SavedClothes } from './characterSaves';
import { characterPanel, type CharacterPanel } from './characterPanel';
import { outfitPanel, type OutfitPanel, type OutfitSource } from './outfitPanel';
import { NO_RULES, isLocked, randomize, ruleFor, withGroupLock, withRule, type RandomRules, type RandomSpec } from '../actor/bodyRandom';
import { studioLayout, studioSectionAction, type StudioLayout } from './studioLayout';
import { THEME_STAGE, otherTheme, readTheme, storeTheme, type StudioTheme } from './studioTheme';
import { frameBox, shoot, shootDataUrl, savePicture } from './snapshot';
import { History } from './strapData';
import { loadingCard, LOADING_COVERED_VAR, type LoadingCard, type LoadingPlace } from './loadingCard';
import { LoadMeter } from '../assets/loadMeter';
import { ClothShirt } from './clothShirt';
import { setClothNeckline } from './clothNeckline';
import { setClothTrim } from './clothTrim';
import { setClothDetail } from './clothDetail';
import { DetailSpots, SARAH_V2_DETAIL_POINTS, SARAH_V2_LITE_TEE_NAVEL, TeeNavel } from './detailSpots';
import { SkinPose } from './skinPose';
import { SKIN_BRUSH_CM, SKIN_CHOICES, SKIN_ORIGINAL_IMAGE, SKIN_SWATCHES, SKIN_TEXTURE_CM, hexRgb, nextSkin, skinBrushLine, skinLine, skinNote, skinStrengthLine, skinTextureLine, type SkinId } from './skinChoices';
import { SkinPainter, tilePattern, type SkinImage, type SkinPattern, type SkinStrokeSettings } from './skinPaint';
import { ensureRest } from './fabricMaterial';
import { BodyCrease, CREASE_SETTLE_MS, unitBefore } from './bodyCrease';
import { FACE_REST_OFFSET, FACE_REST_SCALE, patchFaceRig, restFromWorld, setFaceRig } from './faceRig';
import { REST_SCALE, RoomGarment } from './garment/roomGarment';
import { BEND_COMPLIANCE } from './garment/garmentCloth';
import { setCutEdge } from './garment/cutEdge';
import { GARMENT_DEFAULTS, GARMENT_RECORD_VERSION, clampGarmentSettings, tailorKey, withConstruction, type GarmentRecord, type GarmentSettings } from './garment/settings';
import { GarmentPanel } from './garmentPanel';
import { FaceMotion } from './faceMotion';
import { patchHairMaterial } from './hairMaterial';
import { SARAH_LOOK } from './sarahLook';
import { collectStoryBake, type StoryBake } from './storyBake';
import { BUILD_INFO } from '../ui/buildInfo';
import { IRIS_CHOICES, browsLine, eyesLine, lipsLine, mouthLine, nextEyeMode } from './faceChoices';
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
 *   (weight)  past full term the bump sags by its size, and her belly and each
 *             breast are simulated masses that lag and settle as she moves
 *             (softBody.ts: the womb's, her left breast's, her right breast's);
 *             BOUNCE nudges all three.
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
import { assets, assetUrl } from '../assets/assets';
import { release } from '../tombs/LabPeople';
import { BODY_CONTROLS, BREAST_DIMENSIONS, clampShape, controlLine, defaultBodyShape, parseShape, resetControl, serializeShape, setControl, setLinkedControl, type BodyControl, type BodyShape } from '../actor/bodyShape';
import { applyShapeFields, baseShapeFields, liftShapeFields, type ShapeFields, type ShapePost } from '../view/bodyShapeView';
import { BUILD_PROFILES, buildAmounts, buildKey, heightLine, heldSegments, profileOf, withProfile, type BuildAmounts, type BuildSegment } from '../actor/bodyBuild';
import { applyBuildToBones, applyBuildToMesh, buildBoneOffsets, buildMeshFields, prepareBuildRig, standingLift, type BuildMeshFields, type BuildRig } from '../view/bodyBuild';
import { dropIdleMorphs } from '../view/morphPrune';
import { attachJiggle, bellyTune, breastTune, createJiggleUniforms, feltAcceleration, restingMass, stepMass } from './softBody';
import { applyMilk, applyWomb, applyZeroRefine, babyAnchors, babyWeightState, chestAnchors, chestFieldWeights, groinAnchors, groinFieldWeights, loadMilk, milkAnchors, milkBalanceState, milkFieldWeights, milkState, MILK_PATH, babyFieldWeights, loadWomb, loadZeroRefine, sidesAnchors, sidesFieldWeights, zeroRefineWeight, UPPER_FIELD_PREFIX, WOMB_PATH, ZERO_FIELD, ZERO_REFINE_PATH } from './zeroRefine';
import { NAVEL_MORPHS, type NavelPiece } from './navelPiece';
import { HumanRig, findSkinnedMesh } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import {
  SARAH_V2_HAIR_MODEL, BELLY_MOTION, BELLY_TARGET, trimShown, BREAST_TARGETS, BUMP_MAX_PERCENT, GARMENTS, RECOVERED_SHIRTS, OUTFITS, outfitLine, modelLine, refineLine, refineWeight, nextOutfit, wornGarments, coverMask, bodyNeverHidden, uncoveredSkinIndices, UNDER_TOP_GARMENT, BELLY_REFINE_TARGET, SEAT_TARGET, seatCorrectiveWeight, SARAH_LAB_MODELS, SARAH_LAB_DEFAULT_MODEL, SARAH_LAB_ACTION, SARAH_LAB_FIELD, SARAH_LAB_HUD_ROLE, SARAH_LAB_SCENE_ID, shirtLengthLine, sarahModelPath, BODY_RANDOM_SPECS, CLOTH_SHIRT_PATH, teeLengthLine, teeLengthParts, sleevesLine, necklineLine, neckShapeLine, CLOTH_NECKLINE_DEFAULT, clothLine, CLOTH_DIALS, CLOTH_TUNE_DEFAULT, CLOTH_TEE_LENGTH_DEFAULT, clothTuning, clothRestScale, type ClothTune,
  labTitle, CLOTH_SEATED_LINE, bellyMotionWeights, bellyWeights, breastWeightsForShape, bodyShapeFieldWeights, SIZE_TILT_PRESETS_DEG, effectiveTiltDeg, stepSeated, bustVolume, BREAST_GROW_TARGET, settledSitFor, bellyUpperWeight, BELLY_UPPER_TARGET, navelWeights, NAVEL_FLAT_TARGET, navelFlatFor, navelState, tPoseTurns, ARM_SIDES, armsLine, ARM_RAISE_TARGETS, armRaiseWeight, SEAT_V2_TARGET, seatCorrectiveV2Weight, fingerBend, THUMB_TO_PALM, bumpLine, fingersLine, restingBellySpring, statusLine, walkBounceAccel, walkSwayAccel,
  offeredOutfits, outfitThumbPath,
  type Garment, type SarahLabPose, recoveredPartsFor, recoveredPartPath, isShirtPart, shirtOfPart, type RecoveredPart, SARAH_DEFAULT_OUTFIT, SIM_TEE_OUTFIT, RECOVERED_GARMENTS,
} from './sarahLabTool';
import { blendJointTurns, sitEase, stepSit } from './poseBlend';

const M = UNITS_PER_METRE;
/** How far two fingers may pan the camera's aim (metres above the floor): her feet to just above her head. GAME TUNING. */
const PAN_BOTTOM = 0.05, PAN_TOP = 1.85;
/**
 * How the outfit's new tee is put on her, in seconds from when it is tailored -- the review probes' own dressing
 * (`.scratch` probe `dress()`): weightless until `weightless` and pinned at the neckline where it settled; her arms
 * eased out to `raise` radians by `out`, held to `hold`, eased down by `down`; pinned again at `done`.
 */
const DRESS = Object.freeze({ weightless: 1.2, raise: 0.55, out: 1.5, hold: 2.7, down: 3.7, done: 4.3 });
/**
 * While her shape is changing (the belly slider dragged), the new tee is cut again at most this often, seconds: a cut
 * (`GarmentCloth.refit`, her shape smoothed over the sheet) is 40-100 ms, too long for every frame of a drag.
 */
const GARMENT_REFIT_EVERY = 0.12;
/** RANDOMIZE's group locks, as their buttons read. */
// (`build` reads PROPORTIONS on screen: the room's Build tab is the strap builder's)
const RANDOM_GROUPS = [['build', 'PROPORTIONS'], ['belly', 'BELLY'], ['breasts', 'BREAST']] as const;
/** A BUILD control's own segment, where it has one (its slider can be held at the segment's shortest or longest). */
const SEGMENT_OF: Partial<Record<BodyControl, BuildSegment>> = { upperLeg: 'upperLeg', lowerLeg: 'lowerLeg', torso: 'torso', neck: 'neck', upperArm: 'upperArm', forearm: 'forearm' };
/** What the fabric editor calls each garment. */
const GARMENT_LABEL: Partial<Record<Garment, string>> = {
  shirt: 'Tee', shirtAthletic: 'Athletic tee', shirtRelaxedHigh: 'Relaxed tee', shirtRelaxedLow: 'Relaxed tee',
  shirtSpandexHigh: 'Spandex tee', shirtSpandexLow: 'Spandex tee', shirtSpandexLite: 'Spandex tee', leggings: 'High leggings', leggingsLow: 'Low leggings',
  bikini: 'Bikini', swimsuit: 'Swimsuit',
};
/** What the card says while the room opens. */
const OPENING_LABEL = 'Opening the character room';
/** The camera's vertical view on a landscape screen (degrees). */
const LANDSCAPE_FOV = 38;
/** Held upright: the CSS pixels BACK and the title take at the top of the stage, kept clear of her. */
const UPRIGHT_TOP = 56;
/** The camera's angles (Joshua, 2026-10-23, from the Character Studio preview): yaw about her, radians. */
const VIEW_ANGLES = Object.freeze([
  { id: 'front', label: 'FRONT', yaw: 0 },
  { id: 'three-quarter', label: '¾', yaw: 0.5 },
  { id: 'side', label: 'SIDE', yaw: Math.PI / 2 },
  { id: 'back', label: 'BACK', yaw: Math.PI },
] as const);
/** How long her body must hold still before a change becomes an UNDO step (ms). */
const BODY_SETTLE_MS = 450;
/** This device's storage, or null where it cannot be had (a private window). */
function localStore(): Storage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }
/** Where the room remembers which skin she wears (SKIN; an uploaded picture is not kept). */
const SKIN_KEY = 'traddomium.sarahlab.skin';
/** The brush paints on a copy of her map at most this many pixels square (skinPaint.ts holds two copies in memory). */
const PAINT_MAX_SIZE = 2048;
/** A card's picture, in pixels (3:4, sharp at twice a card's width on a phone). */
const THUMB_SIZE = Object.freeze({ width: 168, height: 224 });
/** The quick sizes under the bump slider (percent). */
const QUICK_SIZES = Object.freeze([0, 50, 100, 150, 200]);
/** A walk on the spot, metres a second: an unhurried pace. */
const WALK_SPEED = 1.1;

export interface SarahLabHooks {
  onBack(): void;
  /** Offline fitting uses native garments to avoid loading its own generated outputs. */
  readonly nativeOutfitPreview?: boolean;
  /**
   * `?skin=ktx2`: the KTX2 skin pilot (`SARAH_V2_BODY_KTX2_MODEL`). An override from the address, never a setting; the
   * status line says so while it is in force.
   */
  readonly skin?: 'ktx2' | null;
  /**
   * The character book (`characterSaves.ts`): where saved characters and the outfit library are kept. The app gives the
   * device's storage; without it the panel keeps them for the session only.
   */
  readonly characters?: { read(): CharacterBook; write(book: CharacterBook): void };
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

  // the ground half of the sky light is brighter than a dark floor would give, and a soft fill comes up from in front
  // of her, low: so what is under her belly can be seen, not lost in black (Joshua, 2026-10-23: "try adding more
  // lights to see underneath better and/or raise the ambient lighting as well")
  const hemi = new THREE.HemisphereLight(0xe8eef6, 0x5a5f68, 1.35);
  const key = new THREE.DirectionalLight(0xfff2e2, 2.0);
  key.position.set(1.5 * M, 2.8 * M, 2.2 * M);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 0.9);
  rim.position.set(-2 * M, 1.8 * M, -2 * M);
  const under = new THREE.DirectionalLight(0xffeedd, 0.7);
  under.position.set(0.6 * M, -1.0 * M, 2.0 * M);
  three.add(hemi, key, rim, under);
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
  // she opens as Joshua set her (sarahLook.ts, 2026-10-24): 73%, her navel a little out, his tee and leggings
  let bump = SARAH_LOOK?.body.bump ?? 100;
  let curl = 0;
  // v2's ARMS control can override any pose; until used, the pose keeps its natural arms.
  // v1 keeps the original T-POSE-only control and its level-arm default.
  let armsDeg = SARAH_LAB_MODELS[SARAH_LAB_DEFAULT_MODEL].id === 'v1' ? 90 : 0, armSide = 0;
  let armsOverride = false;
  // The bump's spring and the breasts' (lighter, quicker), fed the same motion. The
  // bump's weight is its size's own (`bellyMotionWeights`): the WEIGHT slider that
  // added to it is gone (Joshua, 2026-10-08: "keep the current weights... just not
  // have that slider option").
  // Her belly and breasts are simulated (softBody.ts, Joshua 2026-10-29: "do belly and breast simulation"): three masses
  // -- the womb's, and each breast's own -- moving every patched mesh through `jiggle`. The baked motion shapes they
  // replaced are held at rest: the belly's tilt (its size's own weight, standing and seated) still comes from them.
  const spring = restingBellySpring();
  const masses = { belly: restingMass(), breastL: restingMass(), breastR: restingMass() };
  const jiggle = createJiggleUniforms();
  /** Where each mass hangs from, in a bone's frame: what it feels move. The belly in front of her spine, each breast on her chest. */
  type Anchor = { bone: THREE.Bone; local: THREE.Vector3; bind: THREE.Quaternion; p: THREE.Vector3; v: THREE.Vector3; primed: number };
  let anchors: { belly: Anchor; breastL: Anchor; breastR: Anchor } | null = null;
  const tmp = new THREE.Vector3();
  // she opens in her red light spandex tee over painted leggings (Joshua, 2026-10-23), one small file; a model without
  // the v2 clothes (v1) falls back to the first modelled outfit it has as it loads
  // ...and since 2026-10-27 in the NEW TEE (Joshua: "Make the new shirt the default"): her look was saved in the light
  // tee's cloth copy, which is now the second option, so it opens in the new tee, with the look's own fabrics
  const lookOutfit = OUTFITS.findIndex((o) => o.name === SARAH_LOOK?.clothes.outfit);
  let outfit = lookOutfit >= 0 && lookOutfit !== SIM_TEE_OUTFIT ? lookOutfit : SARAH_DEFAULT_OUTFIT;
  let modelIndex = SARAH_LAB_DEFAULT_MODEL;
  // the body's own proportions (Joshua, 2026-10-15): all approved values to start, so she
  // looks exactly as approved until a control moves
  let body: BodyShape = SARAH_LOOK ? parseShape(SARAH_LOOK.body.shape) : defaultBodyShape();
  let shaped: { mesh: THREE.SkinnedMesh; fields: ShapeFields }[] = [];
  // HER BUILD (Joshua, 2026-10-26: "a height adjuster so you can raise or shorten the length of the legs, hips, arms,
  // hands and more basic body controls"; actor/bodyBuild.ts, view/bodyBuild.ts): measured on her approved v2 body once
  // it is in. Every mesh on her skeleton has its stretch worked out the first time a build needs it; her bones take the
  // build's offsets and sizes, and standing she is lifted so her soles stay on the floor
  let buildRig: BuildRig | null = null;
  const buildFields = new WeakMap<THREE.SkinnedMesh, BuildMeshFields>();
  let bonesBuilt = '';
  let standLift = 0;
  let buildBox: HTMLElement | null = null;
  // her crease under her breasts, untangled where her summed shapes fold it (bodyCrease.ts); the spring's shapes move
  // every frame and are not part of what it was worked out for
  const crease = new BodyCrease([BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway, BREAST_TARGETS.bob]);
  // laid after the room summed her: the cleavage bridge chooses its ends on her repaired skin
  crease.onLaid = () => fabric?.reshaped();
  // ...and looked for on her shape as her build's bones carry it at rest (bodyCrease.ts `shift`)
  crease.shift = (mesh, vertices) => buildShift(mesh as THREE.SkinnedMesh, vertices);
  let creaseTimer = 0;
  // a probe's switch: her crease left as summed, to compare
  let creaseDisabled = false;
  const bodyInputs = new Map<BodyControl, HTMLInputElement>();
  const shownNow = (g: Garment) => wornGarments(outfit, garments).includes(g);
  let turning = false;
  // v2's switchable curve refinement (CURVE), off: her master as modelled
  let refine = false;
  // RANDOMIZE's ranges and locks (`actor/bodyRandom.ts`; Joshua, 2026-10-22), saved with her body
  let randomRules: RandomRules = NO_RULES;
  let rangesShown = false;
  const lockButtons = new Map<string, HTMLButtonElement>();
  const rangeRows: { spec: RandomSpec; row: HTMLElement; lo: HTMLInputElement; hi: HTMLInputElement }[] = [];
  let bumpInput: HTMLInputElement | null = null;
  // the library outfit she last put on (her changes to it save as hers), and saved clothes waiting for their outfit to load
  let wornFrom: string | null = null;
  // ...and in his fabrics, put on as her outfit is dressed the first time
  let pendingClothes: Omit<SavedClothes, 'outfit'> | null = SARAH_LOOK ? (({ outfit: _name, ...rest }) => rest)(SARAH_LOOK.clothes) : null;
  let characters: CharacterPanel | null = null;
  // the outfit editor's SAVE workspace, and where the clothes going on now came from (a character, a shared outfit, a
  // new one); null is the built-in outfit itself
  let outfits: OutfitPanel | null = null;
  let nextSource: OutfitSource | null = null;
  let sessionBook: CharacterBook = EMPTY_BOOK;
  const book = hooks.characters ?? { read: () => sessionBook, write: (b: CharacterBook) => { sessionBook = b; } };
  let seconds = 0;
  let walked = 0;
  const poseOut: MutableJointTurn[] = Array.from({ length: Math.max(HUMAN_POSE_TURNS, SEATED_TURNS) }, newJointTurn);
  const standOut: MutableJointTurn[] = Array.from({ length: Math.max(HUMAN_POSE_TURNS, SEATED_TURNS) }, newJointTurn), blendOut: MutableJointTurn[] = [];
  /**
   * 0 standing, 1 seated: how far she has sat (Joshua, 2026-10-28: "a smooth procedural standing to sitting that lasts
   * about 5s"). SIT from STAND, and STAND from SIT, move it over SIT_SECONDS (`sitMoving`); every other pose switch sets it.
   */
  let sitAmount = 0, sitMoving = false;
  /** How far she has sat, as her shapes and her bump's tilt take it (eased as her bones are). */
  const seatShare = () => sitEase(sitAmount);

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

  // SHE IS FRAMED IN THE STAGE (studioLayout.ts): the rail and the inspector cover part of the screen -- the left and
  // right held landscape, the bottom held upright, where BACK and the title also take the top -- so the view slides
  // until its middle is the stage's middle, and widens until what a landscape screen shows of her, top to bottom, fits
  // the stage's height. The camera's own place and the orbit are as they were.
  let studio: StudioLayout | null = null;
  /** LIGHT or DARK, as this device last chose (studioTheme.ts). */
  let theme: StudioTheme = readTheme(localStore());
  /** Her name over the stage: the CHARACTERS panel's name. */
  let nameLine: HTMLElement | null = null;
  function frame(width: number, height: number, lay = true): void {
    camera.aspect = width / Math.max(1, height);
    if (lay) studio?.setPortrait(height > width);
    const c = studio?.covered() ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const cssWidth = Math.max(1, hud?.clientWidth ?? width), cssHeight = Math.max(1, hud?.clientHeight ?? height);
    // the angles' row floats over the stage's bottom: she stands above it, not behind it
    const top = c.top + (studio?.portrait ? UPRIGHT_TOP : 0), bottom = c.bottom + (studio ? studio.stage.bottom.getBoundingClientRect().height + 12 : 0);
    const shownX = Math.max(0.2, 1 - (c.left + c.right) / cssWidth), shownY = Math.max(0.2, 1 - (top + bottom) / cssHeight);
    if (shownX < 0.999 || shownY < 0.999) {
      const middleX = c.left / cssWidth + shownX / 2, middleY = top / cssHeight + shownY / 2;
      camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(LANDSCAPE_FOV / 2)) / shownY));
      camera.setViewOffset(width, height, width * (0.5 - middleX), height * (0.5 - middleY), width, height);
    } else {
      camera.fov = LANDSCAPE_FOV;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ HUD
  let hud: HTMLElement | null = null;
  let texturePanel: ReturnType<typeof garmentTexturePanel> | null = null;
  // the fabric editor (fabricPanel.ts); while it paints onto her body every garment is hidden (Joshua, 2026-10-20)
  let fabric: FabricPanel | null = null;
  /** The clothing builder (strapBuilder.ts): straps and cords pinned to her skin (Joshua, 2026-10-23). */
  let builder: StrapBuilder | null = null;
  /**
   * Her animation clock, for watching a built strap ride her (Joshua, 2026-10-23: "play, pause, slow and step Walk,
   * Sit"): paused, how fast it runs, and a step owed while paused (one frame of a 30 fps clock).
   */
  const clock = { paused: false, speed: 1, step: 0 };
  /** Which modelled garments the outfit editor lets the room draw (`fabricPanel.ts`): all, none while painting her body, or one ISOLATED. */
  let garmentView: 'all' | 'none' | string = 'all';

  // ------------------------------------------------------------ HER FACE (faceRig.ts, faceMotion.ts)
  // Joshua, 2026-10-24: "would like to somehow add bones 🦴 in or something around the mouth to open and close like
  // talking, and maybe the illusion of the eyes being able to look around in sync". Her sculpt's mouth is shut and its
  // eyes blank, and the file is approved: the face is a shader layer on her body's own material, moved each frame.
  const faceMotion = new FaceMotion(7);
  /** The material the face is laid on (only her approved v2 body's: every number in faceRig.ts is measured on it). */
  let faceMaterial: THREE.Material | null = null;
  let faceOn = true, irisIndex = 0, browPct = 100, lipPct = 55;
  const cameraRest: [number, number, number] = [0, 0, 1];
  /**
   * HER HAIR (`scripts/sarahV2Recovery/hair-bake.mjs`): one skinned mesh on her own skeleton, bound to her as every
   * recovered garment is. It is not a garment: CLOTHES · HIDDEN and the outfit editor leave it on.
   */
  let hairMeshes: THREE.SkinnedMesh[] = [];
  let hairOn = true, hairRequest = 0;
  function loadHair(): void {
    const b = bodyOf();
    if (!b || !recovered) return;
    const request = ++hairRequest;
    void assets.loadModel(SARAH_V2_HAIR_MODEL, () => new THREE.Object3D()).then((root) => {
      if (request !== hairRequest || disposed || bodyOf()?.mesh !== b.mesh || root.userData.isPlaceholder === true) { release(root); return; }
      hairMeshes = attachRecoveredMeshes(root, b.mesh, 'sarahHair');
      for (const m of hairMeshes) { m.visible = hairOn; m.castShadow = b.mesh.castShadow; m.receiveShadow = b.mesh.receiveShadow; for (const mat of Array.isArray(m.material) ? m.material : [m.material]) patchHairMaterial(mat); }
      // her hair takes her build too (its weights on her neck and head)
      const build = currentBuild();
      for (const m of hairMeshes) { const fields = liftShapeFields(m) ?? baseShapeFields(m); shaped.push({ mesh: m, fields }); applyShapeFields(m, fields, {}, { post: buildPost(m, fields, build) }); }
      refresh();
    });
  }
  /** One frame of her face: where the camera is in her head's rest frame, the animator, then the shader's uniforms. */
  function faceFrame(dt: number): void {
    const b = bodyOf();
    if (!faceMaterial || !b || b.material !== faceMaterial || !model?.visible) return;
    model.updateMatrixWorld(true);
    const cam = faceMotion.mode === 'camera' ? restFromWorld(b.mesh, camera.position, cameraRest) : null;
    faceMotion.step(dt, cam);
    setFaceRig(faceMaterial, faceOn ? { jaw: faceMotion.jaw, gazeRight: faceMotion.gazeRight, gazeLeft: faceMotion.gazeLeft, blink: faceMotion.blink, iris: IRIS_CHOICES[irisIndex].linear, brow: browPct / 100, lips: lipPct / 100 } : null);
  }

  // ------------------------------------------------------------ HER SKIN (skinChoices.ts, skinPaint.ts)
  // Joshua, 2026-10-24: "compress all the images and add a button to switch between them, and maybe a simple body
  // texture uploaded/paint". SKIN steps through the file's own map and his enhanced candidates; UPLOAD adds a picture
  // from the phone; PAINT SKIN paints on whichever she wears. Nothing of the body file changes: each is a map laid on
  // her material, the file's own kept to come back to.
  /** The skin chosen, and the one she wears (they differ while a candidate downloads, and after one fails). */
  let skinId: SkinId = readSkin();
  let skinWorn: SkinId = 'original';
  let skinUpload: { readonly name: string; readonly width: number; readonly height: number; readonly texture: THREE.Texture } | null = null;
  let skinState: 'loading' | 'ready' | 'failed' = 'ready';
  let skinRequest = 0;
  /** The candidate fetched last: one at a time is kept on the GPU, the one she wears. */
  let skinFetched: { readonly id: SkinId; readonly texture: THREE.Texture } | null = null;
  /** The brush's copy of her map, once PAINT SKIN has been switched on for this map; the map it was copied from is `under`. */
  let painted: { readonly painter: SkinPainter; readonly under: THREE.Texture | null } | null = null;
  let skinPaintOn = false, skinPainting = false;
  /** Her clothes off while her skin is painted (CLOTHES · HIDDEN), as the fabric editor's brush hides them. */
  let skinBare = false;
  const brush: { cm: number; strength: number; hard: boolean; erase: boolean; hex: string; texture: boolean; stamp: boolean; textureCm: number } = { cm: SKIN_BRUSH_CM.initial, strength: 0.5, hard: false, erase: false, hex: SKIN_SWATCHES[0].hex, texture: false, stamp: false, textureCm: SKIN_TEXTURE_CM.initial };
  /**
   * A picture to paint WITH (Joshua, 2026-10-24: "can you upload custom paint textures like with the clothing?"): TILE
   * repeats it over her every TEXTURE SIZE, as the clothing's patterns do; STAMP lays it once, TEXTURE SIZE wide, where a
   * stroke starts, and the stroke rubs it in. Its pixels are read once, at most 1024 square.
   */
  let paintTexture: { readonly name: string; readonly image: SkinImage } | null = null;
  /** The TILE pattern for the picture at the size set, made again only when either changes. */
  let tileCache: { readonly image: SkinImage; readonly units: number; readonly pattern: SkinPattern } | null = null;
  /** Mesh units a centimetre on her body (for the TILE pattern), from the painter's mesh. */
  let paintUnitsPerCm = 1;
  let paintMeta = '';
  function readSkin(): SkinId {
    const v = localStore()?.getItem(SKIN_KEY);
    return SKIN_CHOICES.some((c) => c.id === v) ? (v as SkinId) : 'original';
  }
  function bodyOf(): { readonly mesh: THREE.SkinnedMesh; readonly material: THREE.MeshStandardMaterial } | null {
    const mesh = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
    const material = mesh && ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial);
    return mesh && material ? { mesh, material } : null;
  }
  /** The file's own map, kept the first time anything else is laid on her. */
  const ownMap = (material: THREE.MeshStandardMaterial) => (material.userData.ownMap ??= material.map) as THREE.Texture | null;
  /** A map set up as the file's own is: sRGB, glTF's flipY, its sampler, its transform. */
  function likeOwn(t: THREE.Texture, own: THREE.Texture | null): THREE.Texture {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
    if (own) { t.colorSpace = own.colorSpace; t.wrapS = own.wrapS; t.wrapT = own.wrapT; t.channel = own.channel; t.anisotropy = own.anisotropy; t.offset.copy(own.offset); t.repeat.copy(own.repeat); t.rotation = own.rotation; t.center.copy(own.center); t.matrixAutoUpdate = own.matrixAutoUpdate; t.matrix.copy(own.matrix); }
    t.needsUpdate = true;
    return t;
  }
  function freeFetched(keep?: THREE.Texture): void {
    if (skinFetched && skinFetched.texture !== keep) skinFetched.texture.dispose();
    if (skinFetched?.texture !== keep) skinFetched = null;
  }
  /** The brush's copy goes; her material gets back the map it was copied from. */
  function dropPainter(): void {
    if (!painted) return;
    const b = bodyOf();
    if (b && b.material.map === painted.painter.texture) { b.material.map = painted.under; b.material.needsUpdate = true; }
    painted.painter.dispose();
    painted = null; skinPainting = false;
  }
  /** Put the chosen skin on her, fetching a candidate the first time; a fresh map is a fresh start for the brush. */
  function applySkin(): void {
    const b = bodyOf();
    if (!b) return;
    const own = ownMap(b.material), request = ++skinRequest;
    const wear = (t: THREE.Texture | null, id: SkinId) => {
      dropPainter();
      if (b.material.map !== t) { b.material.map = t; b.material.needsUpdate = true; }
      skinWorn = id; skinState = 'ready';
      if (id !== 'upload') { try { localStore()?.setItem(SKIN_KEY, id); } catch { /* a private window: the choice is not kept */ } }
      refresh();
    };
    if (skinId === 'original') { wear(own, 'original'); freeFetched(); return; }
    if (skinId === 'upload') { if (skinUpload) { wear(skinUpload.texture, 'upload'); freeFetched(); } else { skinId = 'original'; wear(own, 'original'); } return; }
    if (skinFetched?.id === skinId) { wear(skinFetched.texture, skinId); return; }
    const choice = SKIN_CHOICES.find((c) => c.id === skinId);
    if (!choice?.path) { skinId = 'original'; wear(own, 'original'); return; }
    skinState = 'loading'; refresh();
    void assets.loadTexture(choice.path).then((t) => {
      if (request !== skinRequest || disposed) { t?.dispose(); return; }
      // she keeps the skin she had, and SKIN says it is still that one
      if (!t) { skinState = 'failed'; skinId = skinWorn; refresh(); return; }
      const texture = likeOwn(t, own);
      wear(texture, choice.id);
      freeFetched(texture);
      skinFetched = { id: choice.id, texture };
    });
  }
  /** A picture from the phone becomes UPLOAD, and she wears it. */
  async function uploadSkin(file: File): Promise<void> {
    let image: (CanvasImageSource & { width: number; height: number }) | null = null;
    try { image = await createImageBitmap(file); } catch {
      image = await new Promise<HTMLImageElement | null>((resolve) => { const i = new Image(), url = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(url); resolve(i); }; i.onerror = () => { URL.revokeObjectURL(url); resolve(null); }; i.src = url; });
    }
    if (!image || disposed) { skinState = 'failed'; refresh(); return; }
    const b = bodyOf();
    const texture = likeOwn(new THREE.Texture(image as THREE.Texture['image']), b ? ownMap(b.material) : null);
    const old = skinUpload;
    skinUpload = { name: file.name, width: image.width, height: image.height, texture };
    skinId = 'upload'; applySkin();
    if (old) old.texture.dispose();
  }
  /** The brush's copy of the map she wears, made the first time PAINT SKIN comes on for it. */
  async function ensurePainter(): Promise<SkinPainter | null> {
    if (painted) return painted.painter;
    const b = bodyOf();
    if (!b) return null;
    const under = b.material.map;
    const drawable = (im: unknown): im is CanvasImageSource & { width: number; height: number } =>
      (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement)
      || (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && im instanceof OffscreenCanvas);
    let source: (CanvasImageSource & { width: number; height: number }) | null = drawable(under?.image) ? under.image : null;
    // the KTX2 pilot's map has no pixels a canvas can read: the brush starts from the original as an image
    if (!source) { const t = await assets.loadTexture(SKIN_ORIGINAL_IMAGE); source = drawable(t?.image) ? t.image : null; t?.dispose(); }
    if (!source || disposed || bodyOf()?.mesh !== b.mesh || b.material.map !== under) return null;
    // the brush paints at 2048 at most: a 4096 map would hold 128 MB of pixels in the phone's memory to paint on
    if (source.width > PAINT_MAX_SIZE || source.height > PAINT_MAX_SIZE) {
      const s = PAINT_MAX_SIZE / Math.max(source.width, source.height), c = document.createElement('canvas');
      c.width = Math.round(source.width * s); c.height = Math.round(source.height * s);
      c.getContext('2d')?.drawImage(source, 0, 0, c.width, c.height);
      source = c;
    }
    ensureRest(b.mesh.geometry as THREE.BufferGeometry, shaped.find((x) => x.mesh === b.mesh)?.fields ?? null);
    const scale = b.mesh.getWorldScale(new THREE.Vector3()).x || 1;
    const painter = new SkinPainter(b.mesh, source, under, scale / M);
    paintUnitsPerCm = (M / 100) / scale;
    painted = { painter, under };
    b.material.map = painter.texture; b.material.needsUpdate = true;
    paintMeta = `${source.width}×${source.height}`;
    refresh();
    return painter;
  }
  /** One finger paints her skin: PAINT SKIN on, the FACE section open, and a copy of her map to paint on. */
  const paintingSkin = () => skinPaintOn && !!painted && studio?.open === 'face' && !studio.folded;
  /** A dab where the finger is (a stroke's first one also finds where every vertex of her is on screen now). */
  function skinStroke(x: number, y: number, first: boolean): void {
    const p = painted?.painter;
    if (!p) return;
    if (first) { model?.updateMatrixWorld(true); const { width, height } = ctx.renderer.size(); p.beginStroke(camera, width, height); skinPainting = true; }
    p.stroke(x, y, brushSettings());
  }
  /** The brush as FACE sets it: a colour, or the uploaded picture as a tile or a stamp. */
  function brushSettings(): SkinStrokeSettings {
    const base: SkinStrokeSettings = { colour: hexRgb(brush.hex), radiusCm: brush.cm, strength: brush.strength, hardness: brush.hard ? 0.85 : 0.2, erase: brush.erase };
    if (!brush.texture || !paintTexture || brush.erase) return base;
    if (brush.stamp) return { ...base, stamp: { image: paintTexture.image, widthCm: brush.textureCm } };
    const units = brush.textureCm * paintUnitsPerCm;
    if (!tileCache || tileCache.image !== paintTexture.image || tileCache.units !== units) tileCache = { image: paintTexture.image, units, pattern: tilePattern(paintTexture.image, units) };
    return { ...base, pattern: tileCache.pattern };
  }
  /** A picture from the phone to paint with: TEXTURE comes on with it. */
  async function uploadPaintTexture(file: File): Promise<void> {
    let image: (CanvasImageSource & { width: number; height: number }) | null = null;
    try { image = await createImageBitmap(file); } catch {
      image = await new Promise<HTMLImageElement | null>((resolve) => { const i = new Image(), url = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(url); resolve(i); }; i.onerror = () => { URL.revokeObjectURL(url); resolve(null); }; i.src = url; });
    }
    if (!image || disposed) return;
    paintTexture = { name: file.name, image: SkinPainter.imageOf(image, 1024) };
    if ('close' in image && typeof image.close === 'function') image.close();
    tileCache = null; brush.texture = true; brush.erase = false;
    refresh();
  }
  function endSkinStroke(): void {
    if (!skinPainting) return;
    painted?.painter.endStroke(); skinPainting = false; refresh();
  }
  /**
   * THE BELLY CURVE (`bellyInterpolation.ts`): HYBRID by default (Joshua, 2026-10-22: "change the default as hybrid,
   * but make the current as a backup"); CURRENT, the approved slider, stays one tap away. For this session only.
   */
  let bellyCurve: BellyCurve = DEFAULT_BELLY_CURVE;
  /** The belly sizes her sides smoothing was baked at, once her correction file is on (zeroRefine.ts). */
  let sidesAt: number[] = [];
  /** The belly sizes her baby-weight shapes were baked at, once their file is in (zeroRefine.ts). */
  let babyAt: number[] = [];
  /** The belly sizes her cleavage smoothing and her milk shapes were baked at, once their files are in (zeroRefine.ts). */
  let chestAt: number[] = [], milkAt: number[] = [], groinAt: number[] = [];
  const fields: Record<string, HTMLElement> = {};
  const buttons: Record<string, HTMLButtonElement> = {};
  /** FACE's own controls: the held-open mouth, and the eye-colour swatches. */
  let faceMouthInput: HTMLInputElement | null = null;
  const irisButtons: HTMLButtonElement[] = [];
  /** FACE's brush controls (shown while PAINT SKIN is on) and its colour swatches, by colour. */
  let skinTools: HTMLElement | null = null;
  /** The TEXTURE SIZE slider and its line, shown only with a picture to paint with. */
  let textureSize: HTMLInputElement | null = null, textureLabel: HTMLElement | null = null;
  const swatchButtons = new Map<string, HTMLButtonElement>();
  let armsInput: HTMLInputElement | null = null;
  let shirtLengthInput: HTMLInputElement | null = null;
  /**
   * THE CLOTH EXPERIMENT (Joshua, 2026-10-23: "make that one a true soft body/cloth with simulation over the whole
   * thing... I want to be able to see how much or little having a full soft body cloth fabric would be"): the light tee
   * as one simulated sheet (clothShirt.ts), on while CLOTH SIM is, its length from the tee as made to mid-thigh, and what
   * it costs each frame on the stage. Fetched the first time it is turned on.
   */
  // the FITTED light tee's detail (BREAST and NAVEL DETAIL on the modelled tee, the cloth off): a few points of her and
  // of the tee posed on the CPU each frame -- her navel and nipples, and the tee's own navel against its smooth surface
  /** Her navel as its own piece on her approved body (navelPiece.ts, zeroRefine.ts); null on any other body. */
  let navel: { mesh: THREE.SkinnedMesh; piece: NavelPiece } | null = null;
  let fitted: { body: THREE.SkinnedMesh; tee: THREE.SkinnedMesh; bodyPose: SkinPose; teePose: SkinPose; spots: DetailSpots; navel: TeeNavel } | null = null;
  let fittedLaid = false;
  /**
   * CLOTH SIM ON BY DEFAULT (Joshua, 2026-10-24: "we need to make sure the cloth sim is on by default, you have it
   * off"): she wears the light tee as cloth whenever she has it on, unless CLOTH SIM has been switched off.
   */
  let clothWanted = true;
  /**
   * SEATED, THE CLOTH TEE GIVES WAY TO THE FITTED ONE (Joshua, 2026-10-25: "when the default Sarah sits, her shirt is
   * showing holes and looks teared"). Sitting, her arms come forward and her shoulders roll, and the skin under each arm
   * opens: the sleeve's hem, held to her arm, and the side panel beside it, lying on her trunk, part by up to 7 cm where the
   * cloth between them is a few millimetres long, and the simulated tee tore at both sleeves. The fitted light tee is the
   * same garment in the same fabric, skinned to her as her body is, so it cannot tear: from the moment she sits until she
   * has stood up again it is what she wears, and the cloth is laid on her afresh when she is standing.
   */
  let clothSeated = false;
  /** Whether seated she wears the fitted tee instead of the cloth (a probe can turn this off to watch the cloth seated). */
  let seatedStandIn = true;
  /** Stage 2b's procedural tee, put on her by a probe (`?probe=cloth` garment()) for review; never by the room itself. */
  let garmentRoom: RoomGarment | null = null, garmentPoseKey = '', garmentShapeKey = '', garmentRefit = false, garmentRefitAge = Infinity;
  /**
   * The procedural tee an OUTFIT put on her (`OUTFITS[i].procedural`), its construction; null when none did. Once a
   * probe has put a garment on her (`?probe=cloth` garment()), the probe owns it and the outfit leaves it alone.
   */
  let garmentAuto: 'raglan' | 'setIn' | null = null, garmentProbed = false, garmentDressT = 0, garmentTailoring = false;
  /** A probe's look at the garment's shape alone: false draws her details through it as nothing (the shading off). */
  let garmentShade = true;
  /**
   * THE NEW TEE'S SETTINGS (Stage 3, `garment/settings.ts`): what its panel shows, what it is cut and tailored from, and
   * what a save of the outfit keeps. An outfit puts on its save's or its own (`adoptGarment`); the panel changes them.
   * `garmentCommitted` is the pattern they ask for once a finger has let go (`tailorKey`): a re-tailor setting dragged
   * cuts the tee it is on as it goes, and the tee is tailored again only when it is let go.
   */
  let garmentSettings: GarmentSettings = GARMENT_DEFAULTS, garmentCommitted = tailorKey(GARMENT_DEFAULTS);
  let garmentPanel: GarmentPanel | null = null;
  const clothWorn = (): boolean => clothOn && !!cloth && !clothSeated;
  let cloth: ClothShirt | null = null, clothOn = false, clothLoading = false, clothRestart = false, clothRefit = false, teeLength = CLOTH_TEE_LENGTH_DEFAULT, frameMs = 1000 / 60;
  let teeLengthInput: HTMLInputElement | null = null;
  /** SLEEVES (Joshua, 2026-10-25): the cloth tee's cap sleeves as made, or a tank's armholes. */
  let sleeves = true;
  /** TEE LENGTH (a crop top at 0, the tee as made, mid-thigh at 1) put to the cloth: the crop and the rows below the hem. */
  const applyTeeLength = (): void => { const { crop, length } = teeLengthParts(teeLength); cloth?.setLength(length); cloth?.setCrop(crop); };
  /** NECKLINE (-100 a turtleneck, 0 as made, 100 the front cut to under her bust) and the deeper cut's shape (Joshua, 2026-10-24). */
  let neckline = CLOTH_NECKLINE_DEFAULT, neckShape: 'U' | 'V' = 'U';
  let necklineInput: HTMLInputElement | null = null;
  /** The cloth's dials (CLOTH_DIALS), kept across a reload of the cloth, and their sliders. */
  let clothTune: ClothTune = CLOTH_TUNE_DEFAULT;
  /** Her shape the cloth was last cut for. */
  let clothShapeKey = '';
  const clothDialInputs = new Map<string, HTMLInputElement>();
  /** Put the dials on the cloth, live (the cloth tee's and the new tee's). */
  function tuneCloth(): void {
    tuneGarment();
    if (!cloth) return;
    const { settings, standOff } = clothTuning(clothTune);
    Object.assign(cloth.simSettings, settings);
    cloth.standOff = standOff;
  }
  /**
   * The dials on the new tee, live: as on the cloth tee, but its FIT scales the tee's own drafted size (REST_SCALE at the
   * default) and its stiffer bend is kept (`garmentCloth.ts` BEND_COMPLIANCE).
   */
  function tuneGarment(): void {
    if (!garmentRoom) return;
    const { settings, standOff } = clothTuning(clothTune);
    Object.assign(garmentRoom.cloth.simSettings, { ...settings, restScale: REST_SCALE * garmentFitScale(), bendCompliance: BEND_COMPLIANCE });
    garmentRoom.cloth.standOff = standOff;
  }
  /** The FIT dial against its default, for the new tee (`RoomGarment.fitScale`). */
  const garmentFitScale = (): number => clothRestScale(clothTune.fit) / clothRestScale(CLOTH_TUNE_DEFAULT.fit);
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  /** One finger builds (places and moves a built strap's points) while the builder's EDIT is on and nothing is painting. */
  const building = () => !fabric?.tool() && !!builder?.editing();

  // UNDO / REDO FOR HER BODY (from the Character Studio preview): every settled change to her size and shape -- a
  // slider let go, RANDOMIZE, a reset, a quick size, a saved body put on -- is a step. A drag is one step: the change is
  // recorded once it has been still for BODY_SETTLE_MS.
  interface BodyStep { readonly bump: number; readonly body: BodyShape }
  const stepKey = (s: BodyStep) => `${s.bump}|${serializeShape(s.body)}`;
  let bodyHistory: History<BodyStep> | null = null, bodyKey = '', bodyTimer: ReturnType<typeof setTimeout> | null = null;
  function noteBody(): void {
    const now: BodyStep = { bump, body }, key = stepKey(now);
    if (!bodyHistory) { bodyHistory = new History(now, 60); bodyKey = key; return; }
    if (key === bodyKey) return;
    bodyKey = key;
    if (bodyTimer) clearTimeout(bodyTimer);
    bodyTimer = setTimeout(() => { bodyTimer = null; settleBody(); refresh(); }, BODY_SETTLE_MS);
  }
  function settleBody(): void {
    if (bodyTimer) { clearTimeout(bodyTimer); bodyTimer = null; }
    if (bodyHistory && stepKey(bodyHistory.current) !== stepKey({ bump, body })) bodyHistory.push({ bump, body });
  }
  function travelBody(direction: -1 | 1): void {
    if (!bodyHistory) return;
    settleBody();
    const to = direction < 0 ? bodyHistory.undo() : bodyHistory.redo();
    if (!to) return;
    bump = to.bump; body = to.body; bodyKey = stepKey(to);
    applyLook(); applyMotion();
  }

  /** FACE's lines and buttons: which skin, its state, and the brush (an action with nothing to act on looks it). */
  function refreshSkin(): void {
    const noFace = !faceMaterial;
    if (buttons.face) { buttons.face.textContent = noFace ? 'FACE · v2 body only' : `FACE · ${faceOn ? 'ON' : 'OFF (the sculpt)'}`; buttons.face.disabled = noFace; buttons.face.style.opacity = noFace ? '.4' : '1'; }
    if (buttons.hair) { const none = hairMeshes.length === 0; buttons.hair.textContent = none ? (faceMaterial ? 'HAIR · loading…' : 'HAIR · v2 body only') : `HAIR · ${hairOn ? 'ON' : 'OFF'}`; buttons.hair.disabled = none; buttons.hair.style.opacity = none ? '.4' : '1'; }
    if (buttons.eyes) buttons.eyes.textContent = eyesLine(faceMotion.mode);
    if (buttons.blink) buttons.blink.textContent = `BLINK · ${faceMotion.blinking ? 'ON' : 'OFF'}`;
    if (buttons.talk) buttons.talk.textContent = `TALK · ${faceMotion.talking ? 'ON' : 'OFF'}`;
    const mouthField = fields[SARAH_LAB_FIELD.faceMouth];
    if (mouthField) mouthField.textContent = mouthLine(faceMotion.mouth * 100, faceMotion.talking);
    if (faceMouthInput && Number(faceMouthInput.value) !== Math.round(faceMotion.mouth * 100)) faceMouthInput.value = String(Math.round(faceMotion.mouth * 100));
    const browField = fields[SARAH_LAB_FIELD.faceBrows], lipField = fields[SARAH_LAB_FIELD.faceLips];
    if (browField) browField.textContent = browsLine(browPct);
    if (lipField) lipField.textContent = lipsLine(lipPct);
    irisButtons.forEach((b, i) => { b.style.borderColor = i === irisIndex ? 'var(--sl-accent,#d4a853)' : 'var(--sl-btn-line,#ffffff30)'; });
    if (buttons.skin) buttons.skin.textContent = skinLine(skinId, skinUpload);
    const note = fields[SARAH_LAB_FIELD.skinNote];
    if (note) note.textContent = skinNote(skinId, skinUpload, skinState, !!painted?.painter.canUndo) + (painted ? ` · brush on a ${paintMeta} copy` : '');
    if (buttons.skinPaint) buttons.skinPaint.textContent = `PAINT SKIN · ${skinPaintOn ? (painted ? 'ON' : 'preparing…') : 'OFF'}`;
    if (buttons.skinBare) buttons.skinBare.textContent = `CLOTHES · ${skinBare ? 'HIDDEN' : 'SHOWN'}`;
    if (skinTools) skinTools.style.display = skinPaintOn ? 'flex' : 'none';
    for (const [hex, b] of swatchButtons) b.style.borderColor = !brush.erase && hex === brush.hex ? 'var(--sl-accent,#d4a853)' : 'var(--sl-btn-line,#ffffff30)';
    const sizeLine = fields[SARAH_LAB_FIELD.skinBrush], strengthLine = fields[SARAH_LAB_FIELD.skinStrength];
    if (sizeLine) sizeLine.textContent = skinBrushLine(brush.cm, brush.hard, brush.erase);
    if (strengthLine) strengthLine.textContent = skinStrengthLine(brush.strength);
    if (buttons.skinHard) buttons.skinHard.textContent = `EDGE · ${brush.hard ? 'HARD' : 'SOFT'}`;
    if (buttons.skinErase) buttons.skinErase.textContent = `ERASE · ${brush.erase ? 'ON' : 'OFF'}`;
    const withTexture = !!paintTexture && brush.texture && !brush.erase;
    if (buttons.skinTexture) { buttons.skinTexture.textContent = `PAINT WITH · ${withTexture ? 'TEXTURE' : 'COLOUR'}`; buttons.skinTexture.disabled = !paintTexture; buttons.skinTexture.style.opacity = paintTexture ? '1' : '.4'; }
    if (buttons.skinStamp) { buttons.skinStamp.textContent = `TEXTURE · ${brush.stamp ? 'STAMP' : 'TILE'}`; buttons.skinStamp.style.display = paintTexture ? '' : 'none'; }
    if (textureSize) textureSize.style.display = paintTexture ? '' : 'none';
    if (textureLabel) { textureLabel.style.display = paintTexture ? '' : 'none'; textureLabel.textContent = skinTextureLine(brush.textureCm, brush.stamp, paintTexture?.name ?? '', withTexture); }
    for (const [, b] of swatchButtons) if (withTexture) b.style.borderColor = 'var(--sl-btn-line,#ffffff30)';
    const p = painted?.painter;
    for (const [b, on] of [[buttons.skinUndo, !!p?.canUndo], [buttons.skinRedo, !!p?.canRedo], [buttons.skinClear, !!p], [buttons.skinSave, !!p]] as const) {
      if (!b) continue;
      b.disabled = !on; b.style.opacity = on ? '1' : '.4';
    }
  }
  function refresh(): void {
    if (fields.status) fields.status.textContent = statusLine(loaded && model?.visible === true, failed, garments, hasBelly, modelIndex) + (hooks.skin === 'ktx2' ? ' · KTX2 skin' : '') + (wantedOutfit !== null ? ' · loading outfit…' : '');
    refreshSkin();
    const bumpField = fields[SARAH_LAB_FIELD.bump], fingerField = fields[SARAH_LAB_FIELD.fingers];
    if (bumpField) bumpField.textContent = bumpLine(bump);
    if (fingerField) fingerField.textContent = fingersLine(curl);
    if (bumpInput && Number(bumpInput.value) !== bump) bumpInput.value = String(bump);
    for (const spec of BODY_RANDOM_SPECS) {
      const b = lockButtons.get(spec.key);
      if (!b) continue;
      const own = ruleFor(randomRules, spec).locked, held = isLocked(randomRules, spec);
      b.textContent = held ? '🔒' : '🔓';
      b.style.opacity = held && !own ? '.55' : '1';
      b.title = own ? 'locked: RANDOMIZE keeps this value (tap to unlock)' : held ? 'held by its group lock' : 'lock: RANDOMIZE keeps this value';
    }
    for (const [group, label] of RANDOM_GROUPS) {
      const b = buttons[`groupLock-${group}`];
      if (b) b.textContent = `${label} ${randomRules.groups.includes(group) ? '🔒' : '🔓'}`;
    }
    // her proportions are measured on her approved v2 body: on another, the section and its lock are not shown at all
    if (buildBox) buildBox.style.display = buildRig ? '' : 'none';
    if (buttons['groupLock-build']) buttons['groupLock-build'].style.display = buildRig ? '' : 'none';
    for (const r of rangeRows) {
      r.row.style.display = rangesShown ? 'flex' : 'none';
      const rule = ruleFor(randomRules, r.spec);
      if (document.activeElement !== r.lo) r.lo.value = String(rule.min);
      if (document.activeElement !== r.hi) r.hi.value = String(rule.max);
    }
    const lengthField = fields[SARAH_LAB_FIELD.shirtLength], length = fabric?.shirtLength() ?? DEFAULT_SHIRT_LENGTH;
    // it moves a painted shirt and nothing else: with none on, it says so and cannot be moved
    const shirtOn = fabric?.wearsShirt() ?? false;
    if (lengthField) lengthField.textContent = shirtLengthLine(length) + (shirtOn ? '' : ' · painted shirts only');
    if (shirtLengthInput) shirtLengthInput.disabled = !shirtOn;
    if (shirtLengthInput && Number(shirtLengthInput.value) !== Math.round(length * 100)) shirtLengthInput.value = String(Math.round(length * 100));
    const armsField = fields[SARAH_LAB_FIELD.arms];
    if (armsField) armsField.textContent = armsLine(armsDeg, ARM_SIDES[armSide]);
    if (armsInput && Number(armsInput.value) !== armsDeg) armsInput.value = String(armsDeg);
    if (buttons.armSide) buttons.armSide.textContent = `ARMS · ${ARM_SIDES[armSide]}`;
    for (const c of BODY_CONTROLS) {
      const line = fields[`${SARAH_LAB_FIELD.body}${c.key}`];
      // seated, the tilt in use is not the one chosen: say both, so a sitting body never reads as the slider's
      if (line) line.textContent = controlLine(c.key, body[c.key]) + (c.key === 'bellyTilt' && pose === 'sit' ? ` · seated ${effectiveTiltDeg(body.bellyTilt, 1).toFixed(1)}°` : '') + (c.key === 'breastSize' ? ` · bust ${bustVolume(bump, body.breastSize).toFixed(2)}×` : '') + (c.key === 'navel' ? ` · ${navelState(bump, body.navel)}` : '') + (c.key === 'babyWeight' ? ` · ${babyWeightState(body.babyWeight, babyAt.length > 0, bellyCurve)}` : '') + (c.key === 'milk' ? ` · ${milkState(body.milk, body.milkBalance, milkAt.length > 0, bellyCurve)}` : '') + (c.key === 'milkBalance' ? ` · ${milkBalanceState(body.milkBalance)}` : '') + buildNote(c.key);
      const input = bodyInputs.get(c.key);
      if (input && Number(input.value) !== body[c.key]) input.value = String(body[c.key]);
    }
    if (fields[SARAH_LAB_FIELD.bodyNote]) fields[SARAH_LAB_FIELD.bodyNote].textContent = loaded && !shaped.length ? 'this model has no shape fields: TILT and SIZE work, the rest are in v2-body' : '';
    const lit = (b: HTMLButtonElement | undefined, on: boolean) => {
      if (!b) return;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? 'var(--sl-on,#806020)' : 'var(--sl-btn,#151b23)';
      b.style.borderColor = on ? 'var(--sl-accent,#d4a853)' : 'var(--sl-btn-line,#ffffff30)';
    };
    {
      // the cloth experiment's controls: only with the light tee on (the cloth is a copy of it)
      const lite = recovered && shownNow('shirtSpandexLite') && !OUTFITS[outfit]?.procedural;
      if (buttons.cloth) { buttons.cloth.style.display = lite ? '' : 'none'; buttons.cloth.textContent = clothLoading ? 'CLOTH SIM · loading…' : `CLOTH SIM · ${clothOn ? 'ON' : 'OFF'}`; lit(buttons.cloth, clothOn); }
      const teeField = fields[SARAH_LAB_FIELD.teeLength];
      if (teeField) { teeField.textContent = teeLengthLine(teeLength, clothOn); teeField.style.display = lite ? '' : 'none'; }
      if (teeLengthInput) { teeLengthInput.style.display = lite ? '' : 'none'; teeLengthInput.disabled = !clothOn; }
      const neckField = fields[SARAH_LAB_FIELD.neckline];
      if (neckField) { neckField.textContent = necklineLine(neckline, neckShape, (cloth?.necklineDeepest ?? 0) * 100, clothOn); neckField.style.display = lite ? '' : 'none'; }
      if (necklineInput) { necklineInput.style.display = lite ? '' : 'none'; necklineInput.disabled = !clothOn; }
      if (buttons.neckShape) { buttons.neckShape.style.display = lite ? '' : 'none'; buttons.neckShape.textContent = neckShapeLine(neckShape, neckline); lit(buttons.neckShape, neckShape === 'V'); }
      if (buttons.sleeves) { buttons.sleeves.style.display = lite ? '' : 'none'; buttons.sleeves.textContent = sleevesLine(sleeves, clothOn); lit(buttons.sleeves, !sleeves); buttons.sleeves.disabled = !clothOn; }
      if (fields.cloth) { fields.cloth.style.display = clothOn && cloth ? '' : 'none'; if (clothOn && cloth && clothSeated) fields.cloth.textContent = CLOTH_SEATED_LINE; }
      // the new tee's controls, and the cloth's dials on it too (Stage 3: "The cloth dials show for the new tee too")
      const newTee = recovered && !!OUTFITS[outfit]?.procedural && !!garmentRoom && !!garmentAuto, dials = (lite && clothOn) || newTee;
      if (garmentPanel) { garmentPanel.element.style.display = recovered && OUTFITS[outfit]?.procedural ? '' : 'none'; garmentPanel.refresh(); }
      for (const d of CLOTH_DIALS) {
        const f = fields[`${SARAH_LAB_FIELD.clothDial}${d.key}`], i = clothDialInputs.get(d.key);
        if (f) { f.textContent = d.line(clothTune[d.key]); f.style.display = dials ? '' : 'none'; }
        if (i) i.style.display = dials ? '' : 'none';
      }
      if (buttons.clothReset?.parentElement) buttons.clothReset.parentElement.style.display = dials ? 'flex' : 'none';
    }
    for (const k of BREAST_DIMENSIONS) lit(buttons[`link-${k}`], linked.has(k));
    if (buttons.linkAll) { const all = BREAST_DIMENSIONS.every((k) => linked.has(k)); buttons.linkAll.textContent = all ? 'UNLINK W·H·D' : 'LINK W·H·D'; lit(buttons.linkAll, all); }
    lit(buttons.stand, pose === 'stand');
    lit(buttons.walk, pose === 'walk');
    lit(buttons.sit, pose === 'sit');
    lit(buttons.tpose, pose === 'tpose');
    lit(buttons.ranges, rangesShown);
    for (const [group] of RANDOM_GROUPS) lit(buttons[`groupLock-${group}`], randomRules.groups.includes(group));
    { const p = profileOf(body); for (const pr of BUILD_PROFILES) lit(buttons[`profile-${pr.id}`], p === pr.id); }
    for (const t of SIZE_TILT_PRESETS_DEG) lit(buttons[`tilt${t}`], body.bellyTilt === t);
    if (buttons.outfit) buttons.outfit.textContent = `OUTFIT · ${outfitName(wantedOutfit ?? outfit)}${wantedOutfit !== null ? ' …' : ''}`;
    if (buttons.model) buttons.model.textContent = modelLine(modelIndex);
    if (buttons.refine) {
      // only v2 has the switchable curve: the button is not shown for v1
      buttons.refine.style.display = SARAH_LAB_MODELS[modelIndex].id.startsWith('v2') ? '' : 'none';
      buttons.refine.textContent = refineLine(refine);
      lit(buttons.refine, refine);
    }
    noteBody();
    for (const v of QUICK_SIZES) lit(buttons[`size${v}`], bump === v);
    for (const [b, can] of [[buttons.undoBody, !!bodyHistory?.canUndo || bodyTimer !== null], [buttons.redoBody, !!bodyHistory?.canRedo && bodyTimer === null]] as const) if (b) b.disabled = !can;
    const yaw = ((orbit.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (const a of VIEW_ANGLES) { const b = buttons[`view-${a.id}`]; if (b) b.setAttribute('aria-pressed', String(!turning && Math.abs(Math.atan2(Math.sin(yaw - a.yaw), Math.cos(yaw - a.yaw))) < 0.03)); }
    if (buttons.turn) buttons.turn.setAttribute('aria-pressed', String(turning));
    if (buttons.theme) buttons.theme.textContent = theme === 'light' ? '☾ DARK' : '☀ LIGHT';
    if (nameLine) nameLine.textContent = characters?.name().trim() || 'Sarah';
    // the outfit's new tee on or off with the outfit
    syncGarment();
  }

  /** The bump's weight, every frame: its resting tilt and where the spring has it. */
  function applyMotion(): void {
    // the bump's resting tilt from its shapes; its bounce and sway, and the breasts', are the masses' (`feelMotion`)
    const w: Record<string, number> = { ...bellyMotionWeights(bump, 0, spring, effectiveTiltDeg(body.bellyTilt, seated)), [BREAST_TARGETS.bob]: 0 };
    // on the way between standing and seated, her seated shapes come and go with her (`applyLook` sets them otherwise)
    const names: string[] = [BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway, BREAST_TARGETS.bob];
    if (sitMoving) { w[SEAT_TARGET] = seatCorrectiveWeight(seatShare(), bump); w[SEAT_V2_TARGET] = seatCorrectiveV2Weight(seatShare(), bump); names.push(SEAT_TARGET, SEAT_V2_TARGET); }
    for (const mesh of skinned) {
      const dict = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;
      for (const name of names) {
        const at = dict[name];
        if (at !== undefined) influences[at] = w[name];
      }
      applyRecoveredBaseline(mesh, bump, names);
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

  /**
   * What a BUILD line adds: her standing height on HEIGHT, and on a length its limit when it holds there -- a segment
   * never shorter than 40% of itself nor longer than 2.3x, so HEIGHT and its own slider together can reach a point past
   * which the slider moves nothing, and the line says so rather than looking as if it still worked.
   */
  function buildNote(key: BodyControl): string {
    if (!buildRig) return '';
    if (key === 'height') return ` · ${heightLine(buildAmounts(body, buildRig.measure), buildRig.measure)}`;
    const seg = SEGMENT_OF[key];
    if (!seg || !heldSegments(body, buildRig.measure).includes(seg)) return '';
    return buildAmounts(body, buildRig.measure).add[seg] < 0 ? ' · at its shortest' : ' · at its longest';
  }

  /** Her build as the controls ask for it, on the body measured (approved while there is none). */
  function currentBuild(): { readonly amounts: BuildAmounts | null; readonly key: string } {
    if (!buildRig) return { amounts: null, key: '' };
    const amounts = buildAmounts(body, buildRig.measure);
    return { amounts, key: buildKey(amounts) };
  }

  /** The step after her shape fields that lays her build on one mesh (nothing for the approved build). */
  function buildPost(mesh: THREE.SkinnedMesh, fields: ShapeFields, build: ReturnType<typeof currentBuild>): ShapePost | null {
    const rig = buildRig, amounts = build.amounts;
    if (!rig || !amounts || !build.key) return null;
    return {
      key: build.key,
      apply: (position, normal, normalized) => {
        let f = buildFields.get(mesh);
        if (!f) { f = buildMeshFields(rig, mesh, fields.basePos, slimRest(mesh, fields.basePos)); buildFields.set(mesh, f); }
        applyBuildToMesh(f, amounts, position, normal, normalized);
      },
    };
  }

  /**
   * Her rest shape at 0% (her base mesh carries the 100% bump; the `belly` target takes it to none), which her waist and
   * hips are widened from: on her real waist, with the bump riding out on it rather than stretched sideways.
   */
  function slimRest(mesh: THREE.SkinnedMesh, base: Float32Array): Float32Array {
    const k = mesh.morphTargetDictionary?.[BELLY_TARGET], delta = k === undefined ? undefined : mesh.geometry.morphAttributes.position?.[k];
    if (!delta || !mesh.geometry.morphTargetsRelative) return base;
    const out = base.slice();
    for (let i = 0; i < Math.min(delta.count, out.length / 3); i += 1) { out[3 * i] += delta.getX(i); out[3 * i + 1] += delta.getY(i); out[3 * i + 2] += delta.getZ(i); }
    return out;
  }

  /**
   * Where her build's bones carry the given vertices of a mesh at rest (geometry units, 3 a vertex): Σ weight × that
   * bone's offset. Null for the approved build. Her crease is looked for on her shape with this added (bodyCrease.ts).
   */
  function buildShift(mesh: THREE.SkinnedMesh, vertices: Uint32Array): Float32Array | null {
    const rig = buildRig, build = currentBuild();
    if (!rig || !build.amounts || !build.key || !mesh.isSkinnedMesh) return null;
    const offsets = buildBoneOffsets(rig, build.amounts, new Float64Array(3 * rig.bones.length));
    const si = mesh.geometry.getAttribute('skinIndex'), sw = mesh.geometry.getAttribute('skinWeight');
    if (!si || !sw) return null;
    const map = mesh.skeleton.bones.map((bone) => rig.index.get(bone) ?? -1), out = new Float32Array(3 * vertices.length);
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i];
      for (let j = 0; j < 4; j += 1) {
        const w = sw.getComponent(v, j), k = map[si.getComponent(v, j)] ?? -1;
        if (!(w > 0) || k < 0) continue;
        out[3 * i] += w * offsets[3 * k]; out[3 * i + 1] += w * offsets[3 * k + 1]; out[3 * i + 2] += w * offsets[3 * k + 2];
      }
    }
    return out;
  }

  /** The cloth tee cut again for her shape: her build's bones included, so a longer torso is a longer tee. */
  function refitCloth(c: ClothShirt): void {
    c.setRestShift(restShiftNow());
    c.refit();
  }
  /** Her build's rest shift over every vertex of her body, for a garment's pattern (`ClothSkin.restShift`). */
  function restShiftNow(): Float32Array | null {
    const b = bodyOf();
    return b ? buildShift(b.mesh, Uint32Array.from({ length: b.mesh.geometry.getAttribute('position').count }, (_, i) => i)) : null;
  }
  /** Her shape, as a key: when it changes, the tees are cut again for her. */
  function shapeKeyNow(): string { return `${bump}|${serializeShape(body)}|${bellyCurve}|${refine}`; }

  /** Her bones take the build (offsets and sizes), and standing she is lifted onto her soles; only when it changed. */
  function layBuildBones(build: ReturnType<typeof currentBuild>): void {
    if (!buildRig || build.key === bonesBuilt) return;
    bonesBuilt = build.key;
    const amounts = build.amounts ?? buildAmounts(defaultBodyShape(), buildRig.measure);
    applyBuildToBones(buildRig, amounts);
    standLift = standingLift(buildRig, amounts);
    place();
  }

  /** Her shape fields' weights at a belly size: her controls', and her refined 0% shape fading out (zeroRefine.ts: by 200% on HYBRID, 80% on the others). */
  function fieldWeightsAt(b: number): Record<string, number> {
    const out: Record<string, number> = { ...bodyShapeFieldWeights(body, b, bellyCurve), [ZERO_FIELD]: zeroRefineWeight(b, bellyCurve) };
    // her upper belly smoothed, by each belly key's own weight (zeroRefine.ts)
    for (const [key, w] of Object.entries(bellyWeights(b, bellyCurve))) out[UPPER_FIELD_PREFIX + key] = w;
    // her sides and the underside of her belly smoothed, by a tent over the sizes they were baked at (zeroRefine.ts)
    Object.assign(out, sidesFieldWeights(b, sidesAt, bellyCurve));
    // her baby's weight: her belly carried by the womb inside it (zeroRefine.ts), once its file is in
    Object.assign(out, babyFieldWeights(b, body.babyWeight, babyAt, bellyCurve));
    // her cleavage smoothed, and milk in her breasts, once its file is in (zeroRefine.ts)
    Object.assign(out, chestFieldWeights(b, chestAt, bellyCurve));
    Object.assign(out, groinFieldWeights(b, groinAt, bellyCurve));
    Object.assign(out, milkFieldWeights(b, body.milk, body.milkBalance, milkAt, bellyCurve));
    return out;
  }

  function applyLook(): void {
    const fieldWeights = fieldWeightsAt(bump);
    const build = currentBuild();
    for (const { mesh, fields } of shaped) applyShapeFields(mesh, fields, {
      ...fieldWeights,
      ...(mesh.userData.recoveredShirt ? fitWeights(bump, 'shape:fitBelly') : {}),
      ...(mesh.userData.recoveredShirt ? fitWeights(bump, 'shape:fineFit', SHIRT_FINE_FIT_KEYS) : {}),
      ...(mesh.userData.recoveredLeggings ? fitWeights(bump, 'shape:recoveryLeggings', LEGGINGS_FIT_KEYS) : {}),
    // recovered clothes keep RAW normal sums so the GPU's belly offsets land on what their fit expects; the leggings
    // were normalized here too, and at 0-50% the large belly offsets flipped normals in the fold under her belly
    }, { normalizeNormals: !(mesh.userData.recoveredShirt || mesh.userData.recoveredLeggings), post: buildPost(mesh, fields, build) });
    layBuildBones(build);
    // her navel, laid on her as just shaped (navelPiece.ts)
    layNavel(bump);
    // which garments are drawn: the outfit editor's choice, or none while her skin is painted bare (CLOTHES · HIDDEN)
    const view = skinBare ? 'none' : garmentView;
    for (const mesh of skinned) {
      const dict = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
      // the fitted light tee keeps its own navel's shape as fitted for her size: NAVEL DETAIL settles it in the shader
      // (clothFlatten). Settled by the morph instead -- as paint under it at a low NAVEL DETAIL used to do (the painted
      // leggings over her navel) -- its navel, which past 125% stands above hers, was pushed into her: a hole in the tee.
      if (dict && influences) for (const [name, w] of Object.entries(lookWeights(mesh, bump))) {
        const at = dict[name];
        if (at !== undefined) influences[at] = w;
      }
      applyRecoveredBaseline(mesh, bump);
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name as Garment;
      if (([...GARMENTS, ...RECOVERED_SHIRTS] as readonly string[]).includes(name)) mesh.visible = shownNow(name);
      { const t = trimShown(name, wornGarments(outfit, garments)); if (t !== null) mesh.visible = t; }
      if (mesh.userData.replacedByRecovered) mesh.visible = false;
      // the cloth experiment draws the light tee as cloth: the fitted one stands aside (and keeps its fabric on)
      if ((clothWorn() || garmentRoom) && name === 'shirtSpandexLite') mesh.visible = false;
      if (cloth && name === 'shirtSpandexLite') cloth.mesh.visible = clothOn && !clothSeated && shownNow('shirtSpandexLite') && view === 'all' && !garmentRoom;
      // the new tee, drawn with her clothes (an editor's isolating view puts it aside)
      if (garmentRoom && name === 'shirtSpandexLite') garmentRoom.cloth.mesh.visible = view === 'all';
      // painting onto her body: "don't show any clothing since you would be painting over the body"; a garment
      // ISOLATED in the editor shows on its own (its trim with it)
      if (view !== 'all' && !mesh.geometry.getAttribute('_cloth_cover')) {
        const own = name.endsWith('Trim') ? name.slice(0, -4) : name;
        if (view === 'none' || own !== view) mesh.visible = false;
      }
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
        const mask = view !== 'all' || bodyNeverHidden(SARAH_LAB_MODELS[modelIndex].id) ? 0 : coverMask(wornGarments(outfit, garments));
        if (mesh.userData.coverMask !== mask) {
          mesh.userData.coverMask = mask;
          // read through getX: the file stores the bits with a stride (vertex data is 4-byte
          // aligned), so the raw array is not one entry a vertex
          const bits = (mesh.userData.coverBits ??= Uint8Array.from({ length: cover.count }, (_, i) => cover.getX(i))) as Uint8Array;
          mesh.geometry.setIndex(new THREE.BufferAttribute(mask ? uncoveredSkinIndices(all, bits, mask) : Uint32Array.from(all), 1));
        }
      }
    }
    layCrease();
    fabric?.sync();
    // her shape may have changed: the cleavage bridge chooses its ends again
    fabric?.reshaped();
    // and the cloth tee is cut again for her shape (never for her pose) -- on the cloth's next frame, once her belly's
    // motion shapes have followed the new size too. A quick size changes her in two steps (the size here, those shapes
    // in the frame's feelMotion), and a tee cut at once, for the first, and laid on the second ballooned out in front of
    // her and creased as it fell (Joshua, 2026-10-24: "it's possible it's something else")
    const shapeKey = shapeKeyNow();
    if (cloth && shapeKey !== clothShapeKey) { clothShapeKey = shapeKey; clothRefit = true; }
    // the procedural garment a probe put on her, the same way (on its next frame)
    if (garmentRoom && shapeKey !== garmentShapeKey) { garmentShapeKey = shapeKey; garmentRefit = true; }
  }

  /**
   * A mesh's morph target weights for her look at bump `b` (applyLook's): her belly and bust at that size, her navel, the
   * refinement, the seat's correctives and her raised arms.
   */
  /** Her navel's in/out number at bump `b`: what navelFlat takes on her body (the automatic sync, NAVEL, and fabric). */
  function navelX(b: number): number {
    return Math.max(navelFlatFor(b, body.navel), fabric?.navelFlatten() ?? 0, clothFlatten());
  }
  /** Lay her navel (navelPiece.ts) on her body as shaped for bump `b`; after her shape fields and morphs are set. */
  function layNavel(b: number): void {
    if (!navel) return;
    const lw = lookWeights(navel.mesh, b);
    navel.piece.apply(navel.mesh, lw, navelX(b));
  }

  function lookWeights(mesh: THREE.SkinnedMesh, b: number): Record<string, number> {
    const dict = mesh.morphTargetDictionary ?? {};
    // the fitted light tee keeps its own navel's shape as fitted for her size: NAVEL DETAIL settles it in the shader
    const liteTee = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name === 'shirtSpandexLite';
    const w: Record<string, number> = { ...bellyWeights(b, bellyCurve), ...breastWeightsForShape(b, dict[BREAST_GROW_TARGET] !== undefined, body.breastSize), [BELLY_UPPER_TARGET]: bellyUpperWeight(b, bellyCurve), ...navelWeights(b, body.navel), [NAVEL_FLAT_TARGET]: liteTee ? Math.min(1, Math.max(0, navelFlatFor(b, body.navel))) : Math.max(navelFlatFor(b, body.navel), fabric?.navelFlatten() ?? 0, clothFlatten()), [BELLY_REFINE_TARGET]: refineWeight(refine, b), [SEAT_TARGET]: seatCorrectiveWeight(seatShare(), b), [SEAT_V2_TARGET]: seatCorrectiveV2Weight(seatShare(), b), ...armRaiseWeights() };
    // her approved body's navel is its own piece (navelPiece.ts), laid from the number navelFlat always took: the file's
    // navel morphs stay at zero on her
    if (navel && mesh === navel.mesh) for (const name of NAVEL_MORPHS) if (name in w) w[name] = 0;
    return w;
  }

  /**
   * Her REST shape as designed at 0% belly, for `measure` (the new tee's readings of her design, `RoomGarment.designRest`):
   * her 0% shape fields, and her navel laid for the 'belly' target alone -- all those readings add to her rest shape --
   * then put back as she is. Only her body's rest shape: her morph weights are the reader's own business.
   */
  function designRest(measure: () => void): void {
    const s = shaped.find((x) => !!x.mesh.geometry.getAttribute('_cloth_cover')), mesh = s?.mesh as THREE.SkinnedMesh | undefined;
    if (!s || !mesh) { measure(); return; }
    const opts = { normalizeNormals: true, post: buildPost(mesh, s.fields, currentBuild()) };
    applyShapeFields(mesh, s.fields, fieldWeightsAt(0), opts);
    if (navel && navel.mesh === mesh) navel.piece.apply(mesh, { belly: 1 }, navelX(0));
    try { measure(); } finally {
      applyShapeFields(mesh, s.fields, fieldWeightsAt(bump), opts);
      if (navel && navel.mesh === mesh) layNavel(bump);
    }
  }

  /**
   * BELLY ROOM's reading of her (`GarmentCloth.roomShape`): runs `measure` with her body shaped as she is but for her belly,
   * at `share` of 100% -- her shape fields and morph targets as applyLook lays them at that size -- and puts her back.
   * Only her body: no other mesh, nothing drawn in between.
   */
  function roomShape(share: number, measure: () => void): void {
    const s = shaped.find((x) => !!x.mesh.geometry.getAttribute('_cloth_cover')), mesh = s?.mesh as THREE.SkinnedMesh | undefined;
    if (!s || !mesh) { measure(); return; }
    const inf = mesh.morphTargetInfluences, dict = mesh.morphTargetDictionary, keep = inf ? inf.slice() : null;
    const opts = { normalizeNormals: true, post: buildPost(mesh, s.fields, currentBuild()) };
    applyShapeFields(mesh, s.fields, fieldWeightsAt(share * 100), opts);
    if (inf && dict) for (const [name, w] of Object.entries(lookWeights(mesh, share * 100))) { const at = dict[name]; if (at !== undefined) inf[at] = w; }
    if (navel && navel.mesh === mesh) layNavel(share * 100);
    try { measure(); } finally {
      applyShapeFields(mesh, s.fields, fieldWeightsAt(bump), opts);
      if (inf && keep) for (let j = 0; j < keep.length; j++) inf[j] = keep[j];
      if (navel && navel.mesh === mesh) layNavel(bump);
    }
  }

  /**
   * Her crease (`bodyCrease.ts`, Joshua, 2026-10-26: "blend and merge that area smoother"): a shape it was worked out for
   * is laid again at once; a new one is worked out once her controls have rested, so a drag stays quick.
   */
  function layCrease(): void {
    const s = shaped.find((x) => !!x.mesh.geometry.getAttribute('_cloth_cover'));
    if (!s?.fields.baseNrm || creaseDisabled) return;
    if (crease.relay(s.mesh, s.fields.last, s.fields.basePos, s.fields.baseNrm)) { if (creaseTimer) { clearTimeout(creaseTimer); creaseTimer = 0; } return; }
    if (creaseTimer) clearTimeout(creaseTimer);
    creaseTimer = window.setTimeout(() => { creaseTimer = 0; if (!disposed && !creaseDisabled) crease.request(); }, CREASE_SETTLE_MS);
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
        if (p === 'spandex-lite') { dropCloth(); fitted = null; fittedLaid = false; }
        releaseRecoveredMeshes(old); partMeshes.delete(p);
      }
    }
    const meshes = attachRecoveredMeshes(scene, skin, isShirtPart(part) ? shirtOfPart(part) : undefined);
    for (const mesh of meshes) {
      if (part.startsWith('leggings')) mesh.userData.recoveredLeggings = true;
      skinned.push(mesh);
      const fields = liftShapeFields(mesh) ?? (recovered ? baseShapeFields(mesh) : null);
      if (fields) shaped.push({ mesh, fields });
      dropIdleMorphs(mesh);
      attachJiggle(mesh, jiggle);
    }
    partMeshes.set(part, meshes);
  }

  /**
   * PUT ON OUTFIT `next`. With all its clothes on hand it is immediate; otherwise she keeps what she has on while the
   * missing files download (the card at the top says how far), and changes when they are all in. `opening` is the
   * room's first dressing: it carries on the opening's load rather than starting its own.
   */
  /** A painted outfit's paint goes on with it (and comes off when a modelled one is chosen). */
  function wearPaint(): void {
    fabric?.wearOutfit(recovered ? OUTFITS[outfit]?.paint ?? null : null, recovered ? OUTFITS[outfit]?.fabrics : undefined);
    // the new tee's settings: the save's, or the outfit's own
    adoptGarment(pendingClothes?.garment ?? null);
    // saved clothes put on with this outfit go on over its defaults
    if (pendingClothes && fabric?.putOnClothes(pendingClothes)) { builder?.load(pendingClothes.built ?? null); pendingClothes = null; }
    // what she has on now is what the editor's SAVE compares against
    if (fabric && !pendingClothes) { outfits?.editing(nextSource ?? { kind: 'builtin', name: OUTFITS[outfit].name }); nextSource = null; }
  }
  /** What she wears now, as a save holds it: the outfit, the editor's paint and fabrics, and any built pieces. */
  function currentClothes(): SavedClothes {
    const built = builder?.built() ?? null;
    // an outfit whose tee is the new one keeps its settings and the dials it is worn with (never its mesh)
    const garment: GarmentRecord | null = OUTFITS[outfit]?.procedural ? { version: GARMENT_RECORD_VERSION, settings: garmentSettings, dials: clothTune } : null;
    return { outfit: OUTFITS[outfit].name, ...(fabric?.clothes() ?? { shirtLength: DEFAULT_SHIRT_LENGTH, layers: [], garments: {} }), ...(built ? { built } : {}), ...(garment ? { garment } : {}) };
  }
  /**
   * The new tee's settings as an outfit goes on (Stage 3): a save's record -- its settings and the cloth dials it was
   * worn with -- or, with none (any save from before it, or the outfit chosen), the outfit's own: the approved tee in the
   * outfit's construction. The tee she has on is cut to them at once, and tailored again if they draft another pattern.
   */
  function adoptGarment(record: GarmentRecord | null): void {
    const own = OUTFITS[outfit]?.procedural;
    if (!own) return;
    garmentSettings = record ? clampGarmentSettings(record.settings) : withConstruction(GARMENT_DEFAULTS, own);
    garmentCommitted = tailorKey(garmentSettings);
    if (record) {
      clothTune = { ...CLOTH_TUNE_DEFAULT, ...record.dials };
      for (const [k, i] of clothDialInputs) i.value = String(clothTune[k as keyof ClothTune]);
      tuneCloth();
    }
    if (garmentRoom && garmentAuto) garmentRoom.cut(garmentSettings);
  }
  /**
   * The new tee's panel moved a control (`garmentPanel.ts`): kept at once, and the tee she has on cut to it -- an instant
   * setting is the cut itself; a re-tailor one drafts another pattern, which is tailored when `final` (let go: `syncGarment`).
   * BELLY ROOM cuts the cloth's own lengths: on its next refit.
   */
  function garmentChanged(next: GarmentSettings, final: boolean): void {
    const was = garmentSettings;
    garmentSettings = clampGarmentSettings(next);
    if (final) garmentCommitted = tailorKey(garmentSettings);
    if (garmentRoom && garmentAuto) {
      garmentRoom.cut(garmentSettings);
      if (garmentSettings.bellyRoom !== was.bellyRoom) garmentRefit = true;
    }
    refresh();
  }
  /** Put saved clothes on her: their outfit first if it is another, then every piece as saved. */
  function putOnSaved(saved: SavedClothes, from: string | null, source: OutfitSource): void {
    wornFrom = from;
    nextSource = source;
    const { outfit: name, ...rest } = saved;
    const index = OUTFITS.findIndex((o) => o.name === name);
    pendingClothes = rest;
    if (index >= 0 && index !== outfit) dress(index);
    else {
      adoptGarment(rest.garment ?? null);
      if (fabric?.putOnClothes(rest)) { builder?.load(rest.built ?? null); pendingClothes = null; outfits?.editing(source); nextSource = null; }
      applyLook(); refresh();
    }
  }
  /**
   * CLOTH SIM on or off. The first time, the cloth file is fetched (a third of a megabyte) and laid on her as she stands;
   * after that it is kept, hidden while off, and started again from her body when it comes back on.
   */
  async function toggleCloth(): Promise<void> {
    if (clothLoading) return;
    clothOn = !clothOn;
    // her detail through the tee is the cloth's: the fitted tee shares its material, and shows its own
    if (!clothOn && cloth) { setClothDetail(cloth.mesh.material as THREE.Material, null); setClothNeckline(cloth.mesh.material as THREE.Material, null); setClothTrim(cloth.mesh.material as THREE.Material, null); }
    if (!clothOn || cloth) { if (cloth) { cloth.mesh.visible = clothOn; if (clothOn) clothRestart = true; } applyLook(); refresh(); fabric?.refreshTargets(); return; }
    const body = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover')), tee = partMeshes.get('spandex-lite')?.[0];
    if (!model || !body || !tee) { clothOn = false; refresh(); return; }
    clothLoading = true; refresh();
    begin('Loading the cloth tee', 'aside');
    meter.expect(CLOTH_SHIRT_PATH, assets.assetBytes(CLOTH_SHIRT_PATH));
    const expected = model;
    try {
      const scene = await assets.loadModel(CLOTH_SHIRT_PATH, () => new THREE.Object3D(), { meter });
      let source: THREE.Mesh | null = null;
      scene.traverse((n) => { if (!source && (n as THREE.Mesh).isMesh) source = n as THREE.Mesh; });
      if (disposed || model !== expected || !source || scene.userData.isPlaceholder) { release(scene); clothOn = false; return; }
      model.updateMatrixWorld(true);
      // its dials as they stand (CLOTH_DIALS: weighty and snug to start)
      const tuning = clothTuning(clothTune);
      cloth = new ClothShirt(source, body, tee.material, tuning.settings, tuning.standOff);
      release(scene);
      applyTeeLength();
      cloth.setSleeves(sleeves);
      cloth.setNeckline(neckline / 100, neckShape);
      cloth.mesh.visible = clothOn;
      three.add(cloth.mesh);
      meter.ready();
    } catch (error) {
      console.error('[sarahlab] the cloth tee could not be laid on her', error);
      clothOn = false;
      meter.fail('The cloth tee could not be downloaded. Check your connection, then tap CLOTH SIM again.');
    } finally { clothLoading = false; applyLook(); refresh(); fabric?.refreshTargets(); }
  }
  /** The cloth comes on by itself when she has the light tee on and CLOTH SIM has not been switched off. */
  function wantCloth(): void {
    if (clothWanted && !clothOn && !clothLoading && recovered && partMeshes.get('spandex-lite')?.[0] && shownNow('shirtSpandexLite') && !OUTFITS[outfit]?.procedural) void toggleCloth();
  }
  /**
   * THE NEW TEE AS AN OUTFIT (Joshua, 2026-10-27: "Add both to outfit list and both shirts have simulated shirts. Make
   * the new shirt the default, and the other shirt as the second option to compare"): an outfit whose tee is the
   * procedural garment puts it on her -- tailored to her where she stands, eased on weightless and settled, as the
   * review probes do it -- once the light tee it borrows its material from is in; any other outfit takes it off and
   * gives the light tee its cloth copy back. Tailoring is a few seconds' work on the page, so the loading card says so.
   */
  function syncGarment(): void {
    if (garmentProbed || garmentTailoring) return;
    const want = OUTFITS[outfit]?.procedural ?? null;
    const tee = partMeshes.get('spandex-lite')?.[0];
    if (want && loaded && recovered && tee && model) {
      // on her already, drafted as its settings ask once let go (a re-tailor control let go, a save put on, tailors anew;
      // she keeps the one she has on until the new one is ready -- the Stage 1 plan's re-tailor)
      if (garmentRoom && garmentAuto === want && garmentRoom.tailorKey === garmentCommitted) return;
      garmentTailoring = true;
      begin('Tailoring the new tee', model.visible ? 'aside' : 'centre');
      setTimeout(() => {
        garmentTailoring = false;
        if (disposed || OUTFITS[outfit]?.procedural !== want || garmentProbed) { settle(); return; }
        // the light tee's cloth copy stands aside: the new tee wears its material
        if (cloth) { cloth.mesh.visible = false; }
        putOnGarment(garmentSettings.construction, garmentSettings.gusset, false, {}, garmentSettings);
        garmentAuto = garmentRoom ? want : null; garmentDressT = 0;
        if (garmentRoom) garmentRoom.cloth.weightless = true;
        applyLook(); refresh(); settle();
      }, 30);
      return;
    }
    if (!want && garmentAuto) { takeOffGarment(); garmentAuto = null; applyLook(); }
    if (!want) wantCloth();
  }
  /** The procedural tee off her, and the light tee's cloth copy drawn again if it is on. */
  function takeOffGarment(): void {
    // its cut edge goes with it: the material is the light tee's, which the cloth and fitted tees wear too
    if (garmentRoom) setCutEdge(garmentRoom.cloth.mesh.material as THREE.Material, false);
    garmentRoom?.dispose(); garmentRoom = null; garmentPoseKey = '';
    if (cloth && clothOn) cloth.mesh.visible = true;
  }
  /**
   * Put the procedural tee on her, or take it off (null): tailored to her as she is now, in the light tee's own material
   * (its FABRIC), or a plain one for a wireframe or a room without that tee. For the outfit and for the review probes.
   */
  function putOnGarment(construction: 'raglan' | 'setIn' | null, gusset = 0.5, wire = false, extra: { neckWidth?: number; neckDrop?: number; bustShaping?: 'none' | 'ease' | 'dart'; neckBand?: number; armholeBand?: number; detail?: boolean } = {}, garment?: GarmentSettings) {
    takeOffGarment();
    if (!construction) { applyLook(); return null; }
    const body = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
    if (!body || !model) return null;
    model.updateMatrixWorld(true);
    const { settings, standOff } = clothTuning(clothTune);
    // it wears the cloth tee's own material, and so the room's FABRIC on it, as the cloth tee does (Joshua, 2026-10-27:
    // "Made the new shirt also the same red color and compare"): the light tee's material, whose neckline and trim cuts
    // are the cloth tee's own and are switched off while the garment is on. A wireframe, or a room without that tee,
    // draws in a plain material of its own (drawn a hair in front of her skin where the two touch)
    const teeMaterial = partMeshes.get('spandex-lite')?.[0]?.material;
    const shared = !wire && teeMaterial && !Array.isArray(teeMaterial) ? teeMaterial : null;
    if (shared) { setClothNeckline(shared, null); setClothTrim(shared, null); }
    const material = shared ?? new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.85, side: THREE.DoubleSide, wireframe: wire, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
    garmentRoom = new RoomGarment({
      body, root: model, params: { construction, gusset, ...(extra.neckWidth !== undefined ? { neckWidth: extra.neckWidth } : {}), ...(extra.neckDrop !== undefined ? { neckDrop: extra.neckDrop } : {}), ...(extra.bustShaping ? { bustShaping: extra.bustShaping } : {}), ...(extra.armholeBand !== undefined ? { armholeBand: extra.armholeBand } : {}) },
      neckBand: extra.neckBand, ...(extra.detail === false ? { detail: false } : {}), settings, standOff, unitsPerMetre: M, scale: FACE_REST_SCALE, offset: FACE_REST_OFFSET, material,
      // the outfit's new tee (Stage 3): drafted to its full extent from its settings and worn as they cut it, its edge
      // drawn by the material; BELLY ROOM reads her at the room's size; FIT scales its own size
      ...(garment ? { garment, roomShape } : {}), designRest, fitScale: garmentFitScale(),
    });
    if (garment) setCutEdge(material, true);
    three.add(garmentRoom.cloth.mesh);
    garmentPoseKey = pose;
    // cut at once for her as she is now, measured from the 0% design it was tailored from (`RoomGarment`'s
    // `tailoredShape`), as the cloth tee is cut for the body it is on; her shape changing from here cuts it again
    garmentRoom.cloth.setRestShift(restShiftNow());
    garmentRoom.cloth.refit();
    garmentShapeKey = shapeKeyNow(); garmentRefit = false;
    return garmentRoom;
  }
  /** The cloth goes with the light tee it is a copy of (its material is the tee's). */
  function dropCloth(): void {
    if (cloth) { setClothDetail(cloth.mesh.material as THREE.Material, null); setClothNeckline(cloth.mesh.material as THREE.Material, null); setClothTrim(cloth.mesh.material as THREE.Material, null); }
    cloth?.dispose(); cloth = null; clothOn = false; clothShapeKey = ''; clothFlattenLaid = 0;
  }
  /**
   * How much of her shows through the cloth tee (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it
   * still should have a visible effect"; "the bellybutton also doesn't appear with the slider… the overrides should be
   * working"): BREAST and NAVEL DETAIL as the outfit editor holds them, MANUAL where set, else AUTO from the tee's fabric.
   */
  function clothKeep(): { nipple: number; navel: number } {
    return fabric?.garmentDetail('shirtSpandexLite') ?? { nipple: 0.45, navel: 0.8 };
  }
  /**
   * Under the light tee -- the cloth or the fitted one, or the procedural garment a probe put on her -- her navel is softened the way paint softens it: toward an
   * ordinary navel by what NAVEL DETAIL hides. (Not the fitted tee's own navel: its shapes follow hers, and settled to
   * an ordinary navel it would dip where hers does; that one is settled onto its smooth surface instead, in the shader.)
   */
  let clothFlattenLaid = 0;
  function clothFlatten(): number {
    clothFlattenLaid = clothWorn() || fittedTee() || garmentRoom ? 1 - clothKeep().navel : 0;
    return clothFlattenLaid;
  }
  /** The fitted light tee, when it is what she wears over her middle (the cloth off), or null. */
  function fittedTee(): THREE.SkinnedMesh | null {
    if (clothWorn()) return null;
    const tee = partMeshes.get('spandex-lite')?.[0];
    return tee && recovered && shownNow('shirtSpandexLite') ? tee : null;
  }
  function dress(next: number, opening = false): void {
    // chosen before she is in: the opening dresses her in it
    if (!loaded && !opening) { outfit = next; refresh(); return; }
    const parts = recovered ? recoveredPartsFor(wornGarments(next, garments)) : [];
    const missing = parts.filter(p => !partMeshes.has(p));
    // a shirt download for an outfit no longer wanted is cancelled: 66-77 MB a phone should not finish for nothing
    for (const [p, run] of [...inflight]) if (isShirtPart(p) && !parts.includes(p)) { run.abort.abort(); inflight.delete(p); }
    const request = ++outfitRequest;
    if (!missing.length) {
      wantedOutfit = null; outfit = next; fabric?.refreshTargets(); wearPaint();
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
      wantedOutfit = null; outfit = next; fabric?.refreshTargets(); wearPaint();
      if (model) model.visible = true;
      applyLook(); applyMotion(); refresh(); settle();
      // the light tee as cloth, as she is meant to wear it
      wantCloth();
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
    // THE STUDIO (Joshua, 2026-10-23: "Use the new UI look, but let's keep both themes like a dark/light color"): the
    // controls are built here as they always were, each marked with the section it belongs to (`data-tab`), and
    // studioLayout.ts sorts them into the inspector, rail and stage at the end of this function
    root.style.cssText = 'position:absolute;inset:0;font:600 13px system-ui,sans-serif;color:var(--sl-ink,#e8e2d8);touch-action:none;user-select:none;-webkit-user-select:none';
    // the orbit: the whole screen under the controls
    root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input,select,summary')) return;
      root.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // painting her skin's map (FACE · PAINT SKIN): one finger is the brush, a second takes over as turn and zoom
      if (paintingSkin()) { if (pointers.size === 1) skinStroke(e.clientX, e.clientY, true); else endSkinStroke(); }
      // painting her body: one finger is the brush, a second takes over as turn and zoom
      else if (fabric?.tool()) { if (pointers.size === 1) fabric.strokeStart(e.clientX, e.clientY); else fabric.strokeEnd(); }
      // building: one finger places and moves the points, a second takes over as turn and zoom, the same way
      else if (building()) { if (pointers.size === 1) builder!.pointerDown(e.clientX, e.clientY); else builder!.pointerUp(); }
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
      if (pointers.size === 1 && skinPainting) { skinStroke(now.x, now.y, false); return; }
      if (pointers.size === 1 && fabric?.tool()) { fabric.strokeMove(now.x, now.y); return; }
      if (pointers.size === 1 && building()) { builder!.pointerMove(now.x, now.y); return; }
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
        // two fingers moved together pan her up and down (Joshua, 2026-10-29: "place down two fingers on mobile to be
        // able to pan the camera up and down as it's hard to see the model, paint, or whatever on mobile"): the point
        // between them moves half as far as the finger that moved, and she follows it -- pinch and pan at once
        panBy((now.y - was.y) / 2, root.getBoundingClientRect().height);
      }
    });
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; endSkinStroke(); fabric?.strokeEnd(); builder?.pointerUp(); };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });

    const btn = (label: string, action: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.action = action;
      b.type = 'button';
      b.style.cssText = 'padding:9px 12px;border-radius:10px;border:1px solid var(--sl-btn-line,#ffffff30);background:var(--sl-btn,#151b23);color:var(--sl-ink,#e8e2d8);font:700 12px system-ui,sans-serif;letter-spacing:.05em;cursor:pointer';
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); refresh(); });
      return b;
    };
    const back = btn('‹ BACK', SARAH_LAB_ACTION.back, () => hooks.onBack());

    const poses = document.createElement('div');
    poses.className = 'slab-poses';
    poses.dataset.tab = 'pose';
    poses.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px';
    for (const [p, label, action] of [['stand', 'STAND', SARAH_LAB_ACTION.stand], ['walk', 'WALK', SARAH_LAB_ACTION.walk], ['sit', 'SIT', SARAH_LAB_ACTION.sit], ['tpose', 'T-POSE', SARAH_LAB_ACTION.tpose]] as const) {
      buttons[p] = btn(label, action, () => {
        // STAND to SIT and back is a move over SIT_SECONDS, the cloth on her all the way; any other switch is at once
        sitMoving = (p === 'sit' || p === 'stand') && (pose === 'sit' || pose === 'stand' || sitMoving) && p !== pose;
        if (!sitMoving) sitAmount = p === 'sit' ? 1 : 0;
        pose = p;
        // a pose switch moves her at once: the cloth starts again from her body rather than being flung
        if (!sitMoving) clothRestart = true;
        if (p === 'tpose' && SARAH_LAB_MODELS[modelIndex].id !== 'v1') { armsDeg = 90; armsOverride = true; }
        applyLook(); refresh();
      });
      buttons[p].style.padding = '9px 2px'; buttons[p].style.minWidth = '0';
      poses.appendChild(buttons[p]);
    }
    root.appendChild(poses);

    const right = document.createElement('div');
    // every control is built into this, marked with its section, and moved to that section when the studio is laid out
    right.className = 'slab-panel';
    const slider = (field: string, value: number, onInput: (v: number) => void, max = 100, tab = 'body', min = 0) => {
      const label = document.createElement('div');
      label.dataset.tab = tab;
      label.dataset.field = field;
      label.style.cssText = 'font-size:12px;letter-spacing:.05em';
      fields[field] = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
      input.style.cssText = 'width:100%;accent-color:var(--sl-accent,#d4a853);height:28px';
      input.dataset.tab = tab;
      input.addEventListener('input', () => { onInput(Number(input.value)); applyLook(); refresh(); });
      right.append(label, input);
      return input;
    };
    bumpInput = slider(SARAH_LAB_FIELD.bump, bump, (v) => { bump = v; }, BUMP_MAX_PERCENT);
    {
      // QUICK SIZES (from the Character Studio preview): the five sizes the belly is keyed at, one tap each
      const sizes = document.createElement('div'); sizes.dataset.tab = 'body';
      sizes.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:-2px';
      for (const v of QUICK_SIZES) {
        const b = btn(`${v}%`, `${SARAH_LAB_ACTION.quickSize}${v}`, () => { bump = v; applyLook(); applyMotion(); });
        b.style.padding = '5px 0'; b.style.fontSize = '11px';
        buttons[`size${v}`] = b; sizes.appendChild(b);
      }
      right.appendChild(sizes);
    }
    {
      // the bump's own lock and random range (it is in the BELLY group)
      const spec = BODY_RANDOM_SPECS.find((x) => x.key === 'bump')!;
      const r = document.createElement('div'); r.dataset.tab = 'body';
      r.style.cssText = 'display:flex;justify-content:flex-end;gap:4px;margin-top:-4px';
      r.append(lockButton(spec));
      right.append(r, rangeRow(spec));
    }
    slider(SARAH_LAB_FIELD.fingers, curl, (v) => { curl = v; }, 100, 'pose');
    armsInput = slider(SARAH_LAB_FIELD.arms, armsDeg, (v) => { armsDeg = v; armsOverride = true; }, 90, 'pose');
    // a painted shirt's length, for every painted shirt she puts on (its drape follows: tunicDrape.ts)
    shirtLengthInput = slider(SARAH_LAB_FIELD.shirtLength, Math.round(DEFAULT_SHIRT_LENGTH * 100), (v) => { fabric?.setShirtLength(v / 100); }, 100, 'outfit');
    // THE CLOTH EXPERIMENT: the light tee as cloth, and its length to mid-thigh (Joshua, 2026-10-23)
    buttons.cloth = btn('CLOTH SIM · ON', SARAH_LAB_ACTION.cloth, () => { clothWanted = !clothOn; void toggleCloth(); });
    buttons.cloth.dataset.tab = 'outfit';
    right.appendChild(buttons.cloth);
    teeLengthInput = slider(SARAH_LAB_FIELD.teeLength, Math.round(CLOTH_TEE_LENGTH_DEFAULT * 100), (v) => { teeLength = v / 100; applyTeeLength(); }, 100, 'outfit');
    // ...and its sleeves, as made or a tank's armholes (Joshua, 2026-10-25: TEE LENGTH 0 a cropped tank athletic top, and
    // a SLEEVES switch for tank or cap sleeve at any length)
    buttons.sleeves = btn(sleevesLine(sleeves, clothOn), SARAH_LAB_ACTION.sleeves, () => { sleeves = !sleeves; cloth?.setSleeves(sleeves); refresh(); });
    buttons.sleeves.dataset.tab = 'outfit'; buttons.sleeves.style.padding = '7px 10px'; buttons.sleeves.style.fontSize = '11px';
    right.appendChild(buttons.sleeves);
    // ...and its neckline, up to a turtleneck or down in a U or a V (Joshua, 2026-10-24: "can the neckline also be adjustable
    // like the length so you can do U/V shape and select how deep up to turtleneck?")
    necklineInput = slider(SARAH_LAB_FIELD.neckline, CLOTH_NECKLINE_DEFAULT, (v) => { neckline = v; cloth?.setNeckline(neckline / 100, neckShape); }, 100, 'outfit', -100);
    buttons.neckShape = btn(neckShapeLine(neckShape, neckline), SARAH_LAB_ACTION.neckShape, () => { neckShape = neckShape === 'U' ? 'V' : 'U'; cloth?.setNeckline(neckline / 100, neckShape); refresh(); });
    buttons.neckShape.dataset.tab = 'outfit'; buttons.neckShape.style.padding = '7px 10px'; buttons.neckShape.style.fontSize = '11px';
    right.appendChild(buttons.neckShape);
    // THE NEW TEE'S CONTROLS (Stage 3): shown while an outfit's tee is the new one (`refresh`); every change comes back
    // through `garmentChanged`
    garmentPanel = new GarmentPanel({
      settings: () => garmentSettings,
      change: (next, final) => garmentChanged(next, final),
      stops: () => (garmentRoom && garmentAuto ? garmentRoom.stops() : null),
      tailoring: () => garmentTailoring,
    });
    right.appendChild(garmentPanel.element);
    // ...and its dials, live (Joshua, 2026-10-24: "Could potentially even add sliders to play with values in real time")
    for (const d of CLOTH_DIALS) clothDialInputs.set(d.key, slider(`${SARAH_LAB_FIELD.clothDial}${d.key}`, clothTune[d.key], (v) => { clothTune = { ...clothTune, [d.key]: v }; tuneCloth(); }, 100, 'outfit'));
    {
      const r = document.createElement('div'); r.dataset.tab = 'outfit'; r.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      // (on the new tee as on the cloth tee: laid again where it settled)
      buttons.clothReset = btn('LAY CLOTH AGAIN', SARAH_LAB_ACTION.clothReset, () => { clothRestart = true; garmentRoom?.cloth.restart(); });
      buttons.clothDefaults = btn('CLOTH DEFAULTS', SARAH_LAB_ACTION.clothDefaults, () => { clothTune = CLOTH_TUNE_DEFAULT; for (const [k, i] of clothDialInputs) i.value = String(clothTune[k as keyof ClothTune]); tuneCloth(); clothRestart = true; garmentRoom?.cloth.restart(); });
      for (const b of [buttons.clothReset, buttons.clothDefaults]) { b.style.padding = '7px 10px'; b.style.fontSize = '11px'; r.appendChild(b); }
      right.appendChild(r);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    buttons.outfit = btn(outfitLine(outfit), SARAH_LAB_ACTION.outfit, () => { wornFrom = null; pendingClothes = null; nextSource = null; dress(nextOutfit(wantedOutfit ?? outfit, garments)); });
    buttons.model = btn(modelLine(modelIndex), SARAH_LAB_ACTION.model, () => {
      modelIndex = (modelIndex + 1) % SARAH_LAB_MODELS.length;
      armsDeg = SARAH_LAB_MODELS[modelIndex].id === 'v1' || pose === 'tpose' ? 90 : 0;
      armsOverride = pose === 'tpose';
      loadSarah();
    });
    buttons.refine = btn(refineLine(refine), SARAH_LAB_ACTION.refine, () => { refine = !refine; applyLook(); refresh(); });
    // the belly curve experiment (Joshua, 2026-10-22): CURRENT is the approved slider; the others are for comparing
    const curveLabel = () => `BELLY CURVE · ${BELLY_CURVE_NAMES[bellyCurve]}${bellyCurve === DEFAULT_BELLY_CURVE ? '' : bellyCurve === 'approved' ? ' (backup)' : ' (experiment)'}`;
    buttons.bellyCurve = btn(curveLabel(), SARAH_LAB_ACTION.bellyCurve, () => {
      bellyCurve = BELLY_CURVES[(BELLY_CURVES.indexOf(bellyCurve) + 1) % BELLY_CURVES.length];
      buttons.bellyCurve.textContent = curveLabel();
      applyLook(); applyMotion(); refresh();
    });
    buttons.armSide = btn('ARMS · both', SARAH_LAB_ACTION.armSide, () => { armSide = (armSide + 1) % ARM_SIDES.length; applyLook(); refresh(); });
    buttons.turn = btn('TURN', SARAH_LAB_ACTION.turn, () => { turning = !turning; });
    // a nudge up, as a hop would: the bump lags, drops and settles
    buttons.bounce = btn('BOUNCE', SARAH_LAB_ACTION.bounce, () => { masses.belly.vy -= 0.3; masses.breastL.vy -= 0.3; masses.breastR.vy -= 0.3; });
    for (const b of [buttons.model, buttons.refine, buttons.bellyCurve, buttons.outfit, buttons.armSide, buttons.bounce]) { b.style.padding = '8px 10px'; b.style.fontSize = '12px'; row.appendChild(b); }
    for (const [b, tab] of [[buttons.model, 'body'], [buttons.refine, 'body'], [buttons.bellyCurve, 'body'], [buttons.outfit, 'outfit'], [buttons.armSide, 'pose'], [buttons.bounce, 'pose']] as const) b.dataset.tab = tab;
    right.appendChild(row);
    // BELLY SHAPE and BREAST SHAPE: each control a slider with its own reset, relative to the size shown
    const setBody = (next: BodyShape) => { body = next; applyLook(); applyMotion(); refresh(); };
    // RANDOMIZE (Joshua, 2026-10-22): every unlocked control picked within its own range; a lock (🔒) on a control or
    // its group keeps it exactly as set. RANGES shows each control's range to change it
    function lockButton(spec: RandomSpec): HTMLButtonElement {
      const b = btn('🔓', `${SARAH_LAB_ACTION.randomLock}${spec.key}`, () => { randomRules = withRule(randomRules, spec, { locked: !ruleFor(randomRules, spec).locked }); refresh(); });
      b.title = 'lock: RANDOMIZE keeps this value'; b.style.padding = '2px 6px'; b.style.fontSize = '12px';
      lockButtons.set(spec.key, b);
      return b;
    }
    function rangeRow(spec: RandomSpec): HTMLElement {
      const row = document.createElement('div');
      row.dataset.tab = 'body';
      row.style.cssText = 'display:none;align-items:center;gap:4px;font-size:10px;opacity:.85;margin:2px 0 4px';
      const box = (value: number, which: 'min' | 'max') => {
        const i = document.createElement('input');
        i.type = 'number'; i.min = String(spec.min); i.max = String(spec.max); i.step = String(spec.step); i.value = String(value);
        i.dataset.field = `${SARAH_LAB_FIELD.randomRange}${spec.key}-${which}`;
        i.style.cssText = 'width:62px;height:24px;border-radius:6px;border:1px solid #ffffff30;background:#0d1117;color:#e8e2d8;font:600 11px system-ui;padding:0 4px';
        i.addEventListener('change', () => { if (Number.isFinite(Number(i.value))) randomRules = withRule(randomRules, spec, { [which]: Number(i.value) }); refresh(); });
        i.addEventListener('keydown', (e) => e.stopPropagation());
        return i;
      };
      const r = ruleFor(randomRules, spec), lo = box(r.min, 'min'), hi = box(r.max, 'max');
      const label = document.createElement('span'); label.textContent = 'random';
      const dash = document.createElement('span'); dash.textContent = 'to';
      row.append(label, lo, dash, hi);
      rangeRows.push({ spec, row, lo, hi });
      return row;
    }
    {
      const row = document.createElement('div');
      row.dataset.tab = 'body';
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,0.12);padding-top:6px';
      buttons.randomize = btn('RANDOMIZE', SARAH_LAB_ACTION.randomize, () => {
        const next = randomize({ bump, ...body }, BODY_RANDOM_SPECS, randomRules);
        bump = Math.round(next.bump);
        body = clampShape(Object.fromEntries(BODY_CONTROLS.map((c) => [c.key, next[c.key]])) as BodyShape);
        applyLook(); applyMotion(); refresh();
      });
      for (const [group, label] of RANDOM_GROUPS) {
        buttons[`groupLock-${group}`] = btn(`${label} 🔓`, `${SARAH_LAB_ACTION.randomGroupLock}${group}`, () => { randomRules = withGroupLock(randomRules, group, !randomRules.groups.includes(group)); refresh(); });
      }
      buttons.ranges = btn('RANGES', SARAH_LAB_ACTION.randomRanges, () => { rangesShown = !rangesShown; refresh(); });
      for (const b of [buttons.randomize, buttons['groupLock-build'], buttons['groupLock-belly'], buttons['groupLock-breasts'], buttons.ranges]) { b.style.padding = '8px 10px'; b.style.fontSize = '12px'; row.appendChild(b); }
      right.appendChild(row);
    }
    for (const [group, title] of [['build', 'HEIGHT & PROPORTIONS'], ['belly', 'BELLY SHAPE'], ['breasts', 'BREAST SHAPE']] as const) {
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
      if (group === 'build') {
        // THE FIVE CLASSIC SHAPES (Joshua, 2026-10-26): each sets her shoulders, waist, hips and bust and nothing else
        buildBox = box;
        const presets = document.createElement('div');
        presets.style.cssText = 'display:flex;gap:6px;margin:4px 0;flex-wrap:wrap';
        for (const pr of BUILD_PROFILES) {
          const b = btn(pr.label, `${SARAH_LAB_ACTION.buildProfile}${pr.id}`, () => setBody(withProfile(body, pr.id)));
          b.title = `${pr.help} (sets shoulders, waist, hips and bust size)`;
          b.style.padding = '6px 8px'; b.style.fontSize = '11px';
          buttons[`profile-${pr.id}`] = b; presets.appendChild(b);
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
          pair.append(lockButton(BODY_RANDOM_SPECS.find((x) => x.key === c.key)!), link, reset);
          line.append(label, pair);
        } else {
          const pair = document.createElement('span'); pair.style.cssText = 'display:flex;gap:4px';
          pair.append(lockButton(BODY_RANDOM_SPECS.find((x) => x.key === c.key)!), reset);
          line.append(label, pair);
        }
        const input = document.createElement('input');
        input.type = 'range'; input.min = String(c.min); input.max = String(c.max); input.step = String(c.step); input.value = String(body[c.key]);
        input.style.cssText = 'width:100%;accent-color:#d4a853;height:24px';
        input.addEventListener('input', () => setBody(linked.has(c.key) ? setLinkedControl(body, c.key, Number(input.value), linked) : setControl(body, c.key, Number(input.value))));
        bodyInputs.set(c.key, input);
        box.append(line, input, rangeRow(BODY_RANDOM_SPECS.find((x) => x.key === c.key)!));
      }
      if (group === 'build') {
        const reset = btn('RESET PROPORTIONS', SARAH_LAB_ACTION.buildReset, () => setBody(clampShape({ ...body, ...Object.fromEntries(BODY_CONTROLS.filter((k) => k.group === 'build').map((k) => [k.key, k.fallback])) })));
        reset.style.padding = '6px 8px'; reset.style.fontSize = '11px'; reset.style.marginTop = '6px';
        box.appendChild(reset);
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
    // CHARACTERS & OUTFITS (Joshua, 2026-10-22): save all / body / clothes under a name, the outfit library, the file
    characters = characterPanel({
      read: () => book.read(),
      write: (b) => book.write(b),
      body: (): SavedBody => ({ model: SARAH_LAB_MODELS[modelIndex].id, bump, shape: serializeShape(body), refine, random: randomRules }),
      clothes: () => currentClothes(),
      wornFrom: () => wornFrom,
      putOnBody: (saved) => {
        bump = Math.max(0, Math.min(BUMP_MAX_PERCENT, Math.round(saved.bump)));
        body = parseShape(saved.shape);
        refine = saved.refine;
        randomRules = saved.random;
        const index = SARAH_LAB_MODELS.findIndex((m) => m.id === saved.model);
        if (index >= 0 && index !== modelIndex) {
          modelIndex = index;
          armsDeg = SARAH_LAB_MODELS[modelIndex].id === 'v1' || pose === 'tpose' ? 90 : 0;
          armsOverride = pose === 'tpose';
          loadSarah();
        } else { applyLook(); applyMotion(); }
        refresh();
      },
      putOnClothes: (saved, from, character) => putOnSaved(saved, from, { kind: 'personal', name: character }),
      thumbnail: () => thumbnail(),
      download: (name, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
    });
    characters.element.dataset.tab = 'library';
    characters.element.dataset.slWhole = '';
    (characters.element as HTMLDetailsElement).open = true;
    // the section's own title says CHARACTERS: the drawer's is not needed there
    characters.element.querySelector('summary')?.style.setProperty('display', 'none');
    right.appendChild(characters.element);
    // BREAST & NAVEL DETAIL through her clothes: the outfit editor's own setting, shown here too (filled in once the
    // editor exists, below), so the BODY tab and BODY PAINT can never disagree (Joshua, 2026-10-22)
    const bodyDetail = document.createElement('details');
    bodyDetail.dataset.tab = 'body';
    bodyDetail.style.cssText = 'border-top:1px solid rgba(255,255,255,0.12);padding-top:6px';
    const bodyDetailHead = document.createElement('summary');
    bodyDetailHead.textContent = 'BREAST & NAVEL DETAIL THROUGH CLOTHES';
    bodyDetailHead.style.cssText = 'cursor:pointer;font:700 12px system-ui,sans-serif;letter-spacing:.08em;padding:4px 0';
    bodyDetail.appendChild(bodyDetailHead);
    right.appendChild(bodyDetail);
    // the outfit editor's SAVE workspace (outfitPanel.ts)
    const clothesNow = currentClothes;
    outfits = outfitPanel({
      read: () => book.read(),
      write: (b) => { book.write(b); characters?.refresh(); },
      clothes: clothesNow,
      body: (): SavedBody => ({ model: SARAH_LAB_MODELS[modelIndex].id, bump, shape: serializeShape(body), refine, random: randomRules }),
      characterName: () => characters?.name() ?? '',
      builtins: () => OUTFITS.filter((o) => (o.paint ? recovered : o.name !== 'none')).map((o) => o.name),
      // her own outfit first, then the rest in the room's order
      wearable: () => offeredOutfits(garments).sort((a, b) => Number(b === SARAH_DEFAULT_OUTFIT) - Number(a === SARAH_DEFAULT_OUTFIT)).map((i) => ({ name: OUTFITS[i].name, thumb: assetUrl(outfitThumbPath(OUTFITS[i].name)) })),
      thumbnail: () => thumbnail(),
      wearBuiltin: (name) => {
        const index = OUTFITS.findIndex((o) => o.name === name);
        if (index < 0) return;
        wornFrom = null; pendingClothes = null; nextSource = null;
        dress(index);
      },
      startBlank: () => {
        // a modelled outfit's garments come off too: a blank outfit is her body, ready for paint
        const name = OUTFITS[outfit].garments.length ? 'none' : OUTFITS[outfit].name;
        putOnSaved({ outfit: name, shirtLength: fabric?.shirtLength() ?? DEFAULT_SHIRT_LENGTH, layers: [], garments: {}, detail: AUTO_DETAIL }, null, { kind: 'new', name: '' });
      },
      putOn: (clothes, source) => putOnSaved(clothes, source.kind === 'shared' ? source.name : null, source),
    });
    const note = document.createElement('div');
    note.dataset.field = SARAH_LAB_FIELD.bodyNote;
    note.dataset.tab = 'body';
    note.style.cssText = 'font-size:10px;opacity:.7';
    fields[SARAH_LAB_FIELD.bodyNote] = note;
    right.appendChild(note);
    texturePanel = garmentTexturePanel(() => skinned, (garment) => {
      const next = OUTFITS.findIndex(look => look.garments.includes(garment));
      if (next >= 0 && next !== outfit) dress(next);
      else { applyLook(); refresh(); }
    });
    texturePanel.element.dataset.tab = 'fabric';
    const scaleOf = new THREE.Vector3();
    fabric = fabricPanel({
      meshes: () => skinned,
      body: () => skinned.find(m => !!m.geometry.getAttribute('_cloth_cover')) ?? null,
      worn: () => wornGarments(outfit, garments).map(g => ({ name: g, label: GARMENT_LABEL[g] ?? g, trim: skinned.some(m => (Array.isArray(m.material) ? m.material : [m.material]).some(x => x.name === `${g}Trim`)) })),
      rest: (mesh) => shaped.find(x => x.mesh === mesh)?.fields ?? null,
      unitsPerCm: (mesh) => { mesh.getWorldScale(scaleOf); return (M / 100) / (scaleOf.x || 1); },
      loadImage: (path) => assets.loadTexture(path).then(t => { const image = (t?.image ?? null) as (CanvasImageSource & { width: number; height: number }) | null; t?.dispose(); return image; }),
      garmentsShown: (which) => { garmentView = which; applyLook(); refresh(); },
      view: () => ({ camera, ...ctx.renderer.size() }),
      describe: () => ({ base: SARAH_LAB_MODELS[modelIndex].id, outfit: OUTFITS[outfit].name }),
      reshape: () => { applyLook(); },
      // saving an outfit lives in the OUTFIT section now: the editor's SAVE space points there
      saveSection: () => {
        const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:11px;line-height:1.4';
        const note = document.createElement('div'); note.textContent = 'Outfits are saved, named and worn in OUTFIT, with a picture of her in each.';
        const go = btn('OPEN OUTFIT', studioSectionAction('outfit'), () => studio?.show('outfit'));
        box.append(note, go);
        return box;
      },
      changed: () => outfits?.changed(),
      // the light tee lies over her nipples and navel, as cloth or as the fitted tee: it counts for AUTO's detail
      clothOver: () => (clothWorn() ? { name: 'shirtSpandexLite', label: 'cloth tee' } : fittedTee() ? { name: 'shirtSpandexLite', label: 'spandex tee' } : null),
      navelHint: () => {
        // her navel: the vertex her own navel morphs move most
        const body = skinned.find(m => !!m.geometry.getAttribute('_cloth_cover'));
        const dict = body?.morphTargetDictionary, targets = body?.geometry.morphAttributes.position;
        if (!body || !dict || !targets) return undefined;
        let best = -1, most = 0;
        for (const name of [...Object.keys(navelWeights(150)), NAVEL_FLAT_TARGET]) {
          const t = dict[name] !== undefined ? targets[dict[name]] : undefined;
          if (!t) continue;
          for (let i = 0; i < t.count; i++) { const m = t.getX(i) ** 2 + t.getY(i) ** 2 + t.getZ(i) ** 2; if (m > most) { most = m; best = i; } }
        }
        return best >= 0 ? best : undefined;
      },
      regions: () => {
        const body = skinned.find(m => !!m.geometry.getAttribute('_cloth_cover'));
        if (!body || !rig || !measure) return null;
        const g = body.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), n = g.getAttribute('position').count;
        if (!si || !sw) return null;
        const four = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => Float32Array.from({ length: n * 4 }, (_, i) => a.getComponent(Math.floor(i / 4), i % 4));
        const fields = shaped.find(x => x.mesh === body)?.fields;
        const three3 = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => Float32Array.from({ length: n * 3 }, (_, i) => a.getComponent(Math.floor(i / 3), i % 3));
        // into the skeleton's bind space, where the joints are measured (the bind matrix is identity on her today)
        const position = Float32Array.from(fields?.basePos ?? three3(g.getAttribute('position'))), normal = Float32Array.from(fields?.baseNrm ?? three3(g.getAttribute('normal')));
        const at = new THREE.Vector3(), bindNormal = new THREE.Matrix3().getNormalMatrix(body.bindMatrix);
        for (let i = 0; i < n; i++) {
          at.fromArray(position, i * 3).applyMatrix4(body.bindMatrix).toArray(position, i * 3);
          at.fromArray(normal, i * 3).applyMatrix3(bindNormal).toArray(normal, i * 3);
        }
        const bindRig = rig, jointAt = Object.fromEntries(Object.entries(measure.joints).map(([k, j]) => [k, [bindRig.bind[j].x, bindRig.bind[j].y, bindRig.bind[j].z]])) as Record<keyof typeof measure.joints, [number, number, number]>;
        return mapBody({ skinIndex: four(si), skinWeight: four(sw), parents: rig.bind.map(j => j.parent), joints: measure.joints, restNormal: normal, restPosition: position, jointAt });
      },
    });
    fabric.element.dataset.tab = 'fabric';
    fabric.element.dataset.slWhole = '';
    (fabric.element as HTMLDetailsElement).open = true;
    right.appendChild(fabric.element);
    builder = strapBuilder({
      body: () => skinned.find(m => !!m.geometry.getAttribute('_cloth_cover')) ?? null,
      // her FULL triangle list: the index as loaded, kept before any garment hid skin from the draw
      triangles: (mesh) => (mesh.userData.allIndices as ArrayLike<number> | undefined) ?? mesh.geometry.index?.array ?? [],
      // her approved shape before any slider moved it: where the builder measures, as the paint brush does
      rest: (mesh) => {
        const base = shaped.find(x => x.mesh === mesh)?.fields.basePos;
        const position = mesh.geometry.getAttribute('position');
        return base && base.length === position.count * 3 ? base : Float32Array.from({ length: position.count * 3 }, (_, i) => position.getComponent(Math.floor(i / 3), i % 3));
      },
      unitsPerCm: (mesh) => { mesh.getWorldScale(scaleOf); return (M / 100) / (scaleOf.x || 1); },
      view: () => ({ camera, ...ctx.renderer.size() }),
      loadImage: (path) => assets.loadTexture(path).then(t => { const image = (t?.image ?? null) as (CanvasImageSource & { width: number; height: number }) | null; t?.dispose(); return image; }),
      base: () => SARAH_LAB_MODELS[modelIndex].id,
      changed: () => outfits?.changed(),
      clock: {
        paused: () => clock.paused,
        setPaused: (p) => { clock.paused = p; },
        speed: () => clock.speed,
        setSpeed: (v) => { clock.speed = v; },
        step: () => { clock.paused = true; clock.step += 1 / 30; },
      },
    });
    builder.element.dataset.tab = 'build';
    builder.element.dataset.slWhole = '';
    (builder.element as HTMLDetailsElement).open = true;
    right.appendChild(builder.element);
    bodyDetail.appendChild(fabric.detailControl());
    right.appendChild(texturePanel.element);
    // the outfit cards and saves (outfitPanel.ts): the OUTFIT section's own, not a space inside the fabric editor
    outfits.element.dataset.tab = 'outfit';
    right.appendChild(outfits.element);
    // ------------------------------------------------------------ FACE: her face (faceRig.ts, faceMotion.ts)
    {
      buttons.face = btn('FACE · ON', SARAH_LAB_ACTION.face, () => { faceOn = !faceOn; });
      buttons.eyes = btn(eyesLine(faceMotion.mode), SARAH_LAB_ACTION.eyes, () => { faceMotion.mode = nextEyeMode(faceMotion.mode); });
      buttons.blink = btn('BLINK · ON', SARAH_LAB_ACTION.blink, () => { faceMotion.blinking = !faceMotion.blinking; });
      buttons.talk = btn('TALK · OFF', SARAH_LAB_ACTION.talk, () => { faceMotion.talking = !faceMotion.talking; });
      buttons.hair = btn('HAIR · ON', SARAH_LAB_ACTION.hair, () => { hairOn = !hairOn; for (const m of hairMeshes) m.visible = hairOn; });
      for (const b of [buttons.face, buttons.hair, buttons.eyes, buttons.blink, buttons.talk]) { b.dataset.tab = 'face'; b.style.padding = '8px 10px'; b.style.fontSize = '12px'; right.appendChild(b); }
      faceMouthInput = slider(SARAH_LAB_FIELD.faceMouth, 0, (v) => { faceMotion.mouth = v / 100; }, 100, 'face');
      const irises = document.createElement('div');
      irises.dataset.tab = 'face';
      irises.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;letter-spacing:.05em';
      const irisLabel = document.createElement('span'); irisLabel.textContent = 'EYE COLOUR'; irises.appendChild(irisLabel);
      IRIS_CHOICES.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.action = `${SARAH_LAB_ACTION.faceIris}${c.name}`; b.title = c.name; b.setAttribute('aria-label', `${c.name} eyes`);
        b.style.cssText = `width:26px;height:26px;border-radius:50%;border:2px solid var(--sl-btn-line,#ffffff30);background:${c.swatch};padding:0;cursor:pointer`;
        b.addEventListener('click', (e) => { e.stopPropagation(); irisIndex = i; refresh(); });
        irisButtons.push(b); irises.appendChild(b);
      });
      right.appendChild(irises);
      slider(SARAH_LAB_FIELD.faceBrows, browPct, (v) => { browPct = v; }, 100, 'face');
      slider(SARAH_LAB_FIELD.faceLips, lipPct, (v) => { lipPct = v; }, 100, 'face');
    }
    // ------------------------------------------------------------ FACE: her skin's map (skinChoices.ts, skinPaint.ts)
    {
      const small = (b: HTMLButtonElement) => { b.style.padding = '7px 10px'; b.style.fontSize = '11px'; return b; };
      buttons.skin = btn(skinLine(skinId, skinUpload), SARAH_LAB_ACTION.skin, () => { skinId = nextSkin(skinId, !!skinUpload); applySkin(); });
      // the picker sits in the room's root, not the panel (the studio moves the panel's things and drops the rest)
      const file = document.createElement('input');
      file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none'; file.dataset.role = 'sarahlab-skin-file';
      file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) { skinState = 'loading'; refresh(); void uploadSkin(f); } });
      root.appendChild(file);
      buttons.skinUpload = btn('UPLOAD SKIN…', SARAH_LAB_ACTION.skinUpload, () => file.click());
      for (const b of [buttons.skin, buttons.skinUpload]) { b.dataset.tab = 'face'; b.style.padding = '8px 10px'; b.style.fontSize = '12px'; right.appendChild(b); }
      const note = document.createElement('div');
      note.dataset.tab = 'face'; note.dataset.field = SARAH_LAB_FIELD.skinNote;
      note.style.cssText = 'font:500 11px system-ui,sans-serif;color:var(--sl-muted,#9aa0a8);line-height:1.35';
      fields[SARAH_LAB_FIELD.skinNote] = note; right.appendChild(note);
      buttons.skinPaint = btn('PAINT SKIN · OFF', SARAH_LAB_ACTION.skinPaint, () => { skinPaintOn = !skinPaintOn; if (skinPaintOn) void ensurePainter(); else endSkinStroke(); });
      buttons.skinBare = btn('CLOTHES · SHOWN', SARAH_LAB_ACTION.skinBare, () => { skinBare = !skinBare; fabric?.setBare(skinBare); applyLook(); });
      for (const b of [buttons.skinPaint, buttons.skinBare]) { b.dataset.tab = 'face'; small(b); right.appendChild(b); }
      // the brush: shown while PAINT SKIN is on
      const tools = document.createElement('div');
      tools.dataset.tab = 'face'; tools.dataset.role = 'sarahlab-skin-brush';
      tools.style.cssText = 'display:none;flex-direction:column;gap:6px';
      skinTools = tools;
      const swatches = document.createElement('div');
      swatches.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
      for (const c of SKIN_SWATCHES) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.action = `${SARAH_LAB_ACTION.skinColour}${c.name}`; b.title = c.name; b.setAttribute('aria-label', c.name);
        b.style.cssText = `width:28px;height:28px;border-radius:50%;border:2px solid var(--sl-btn-line,#ffffff30);background:${c.hex};padding:0;cursor:pointer`;
        b.addEventListener('click', (e) => { e.stopPropagation(); brush.hex = c.hex; brush.erase = false; refresh(); });
        swatchButtons.set(c.hex, b); swatches.appendChild(b);
      }
      const any = document.createElement('input');
      any.type = 'color'; any.value = brush.hex; any.title = 'any colour'; any.setAttribute('aria-label', 'any colour');
      any.style.cssText = 'width:36px;height:30px;border:0;background:none;padding:0;cursor:pointer';
      any.addEventListener('input', () => { brush.hex = any.value; brush.erase = false; refresh(); });
      swatches.appendChild(any);
      tools.appendChild(swatches);
      // ...or a picture of his own, as the clothing takes one (Joshua, 2026-10-24)
      const picker = document.createElement('input');
      picker.type = 'file'; picker.accept = 'image/*'; picker.style.display = 'none'; picker.dataset.role = 'sarahlab-paint-texture-file';
      picker.addEventListener('change', () => { const f = picker.files?.[0]; picker.value = ''; if (f) void uploadPaintTexture(f); });
      root.appendChild(picker);
      const textureRow = document.createElement('div');
      textureRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
      buttons.skinTextureUpload = btn('UPLOAD PAINT TEXTURE…', SARAH_LAB_ACTION.skinTextureUpload, () => picker.click());
      buttons.skinTexture = btn('PAINT WITH · COLOUR', SARAH_LAB_ACTION.skinTexture, () => { if (paintTexture) { brush.texture = !brush.texture; if (brush.texture) brush.erase = false; } });
      buttons.skinStamp = btn('TEXTURE · TILE', SARAH_LAB_ACTION.skinStamp, () => { brush.stamp = !brush.stamp; });
      for (const b of [buttons.skinTextureUpload, buttons.skinTexture, buttons.skinStamp]) textureRow.appendChild(small(b));
      tools.appendChild(textureRow);
      const range = (field: string, value: number, min: number, max: number, onInput: (v: number) => void) => {
        const label = document.createElement('div'); label.dataset.field = field; label.style.cssText = 'font-size:12px;letter-spacing:.05em'; fields[field] = label;
        const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value);
        input.style.cssText = 'width:100%;accent-color:var(--sl-accent,#d4a853);height:28px';
        input.addEventListener('input', () => { onInput(Number(input.value)); refresh(); });
        tools.append(label, input);
      };
      range(SARAH_LAB_FIELD.skinBrush, Math.round(brush.cm * 10), Math.round(SKIN_BRUSH_CM.min * 10), Math.round(SKIN_BRUSH_CM.max * 10), (v) => { brush.cm = v / 10; });
      range(SARAH_LAB_FIELD.skinStrength, Math.round(brush.strength * 100), 5, 100, (v) => { brush.strength = v / 100; });
      range(SARAH_LAB_FIELD.skinTextureSize, Math.round(brush.textureCm * 10), Math.round(SKIN_TEXTURE_CM.min * 10), Math.round(SKIN_TEXTURE_CM.max * 10), (v) => { brush.textureCm = v / 10; });
      textureSize = tools.lastElementChild as HTMLInputElement;
      textureLabel = textureSize.previousElementSibling as HTMLElement;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      buttons.skinHard = btn('EDGE · SOFT', SARAH_LAB_ACTION.skinHard, () => { brush.hard = !brush.hard; });
      buttons.skinErase = btn('ERASE · OFF', SARAH_LAB_ACTION.skinErase, () => { brush.erase = !brush.erase; });
      buttons.skinUndo = btn('UNDO', SARAH_LAB_ACTION.skinUndo, () => { painted?.painter.undo(); });
      buttons.skinRedo = btn('REDO', SARAH_LAB_ACTION.skinRedo, () => { painted?.painter.redo(); });
      buttons.skinClear = btn('CLEAR PAINT', SARAH_LAB_ACTION.skinClear, () => { painted?.painter.clear(); });
      buttons.skinSave = btn('SAVE PNG', SARAH_LAB_ACTION.skinSave, () => {
        const p = painted?.painter;
        if (p) void p.png().then((blob) => savePicture(blob, `sarah-skin-${skinWorn}-painted.png`)).catch((e) => console.error('[sarahlab] the painted skin could not be saved', e));
      });
      for (const b of [buttons.skinHard, buttons.skinErase, buttons.skinUndo, buttons.skinRedo, buttons.skinClear, buttons.skinSave]) row.appendChild(small(b));
      tools.appendChild(row);
      const tip = document.createElement('div');
      tip.style.cssText = 'font:500 10.5px system-ui,sans-serif;color:var(--sl-muted,#9aa0a8);line-height:1.35';
      tip.textContent = 'One finger paints her, two turn and zoom. Paint stays on this skin until SKIN changes; SAVE PNG keeps it, and UPLOAD SKIN puts a saved one back on her.';
      tools.appendChild(tip);
      right.appendChild(tools);
    }
    // the view: zoom and the start view sit with the poses (the angles float over her, below)
    for (const [label, action, go] of [['ZOOM −', SARAH_LAB_ACTION.zoomOut, () => zoom(1.25)], ['ZOOM +', SARAH_LAB_ACTION.zoomIn, () => zoom(0.8)], ['RESET VIEW', SARAH_LAB_ACTION.resetView, resetView]] as const) {
      const b = btn(label, action, go); b.style.padding = '8px 10px'; b.style.fontSize = '12px'; b.dataset.tab = 'pose'; right.appendChild(b);
    }
    root.appendChild(right);

    // ------------------------------------------------------------ the studio
    studio = studioLayout(root, {
      first: 'body',
      theme,
      eyebrow: 'Sarah Lab',
      changed: () => {
        // an editor listens to her only while its section is open: a finger on her otherwise turns her
        fabric?.setActive(studio?.open === 'fabric' && !studio.folded);
        builder?.setActive(studio?.open === 'build' && !studio.folded);
        // her skin's brush listens only in FACE, and her clothes come back on as it closes
        if (studio?.open !== 'face' || studio.folded) { endSkinStroke(); if (skinBare) { skinBare = false; fabric?.setBare(false); applyLook(); } }
        const size = ctx.renderer.size(); frame(size.width, size.height, false); refresh();
      },
    });
    right.remove();
    studio.section('outfit').prepend(outfits.element);

    // the stage's top row: BACK, her name and the room's status line, then UNDO / REDO for her body and the theme
    const pill = () => { const p = document.createElement('div'); p.className = 'sl-pill'; return p; };
    const pillButton = (label: string, action: string, onClick: () => void, title = '') => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.action = action; if (title) { b.title = title; b.setAttribute('aria-label', title); }
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); refresh(); });
      return b;
    };
    const backPill = pill(); back.removeAttribute('style'); backPill.appendChild(back);
    const info = document.createElement('div');
    info.className = 'slab-info';
    info.style.cssText = 'flex:1;min-width:0;pointer-events:none;padding:2px 2px 0';
    const eyebrow = document.createElement('div');
    eyebrow.textContent = labTitle(BUILD_INFO.version);
    eyebrow.dataset.field = SARAH_LAB_FIELD.title;
    eyebrow.style.cssText = 'font:700 8.5px system-ui,sans-serif;letter-spacing:.18em;color:var(--sl-muted,#9aa0a8)';
    nameLine = document.createElement('div');
    nameLine.style.cssText = 'font:750 17px system-ui,sans-serif;letter-spacing:-.02em;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    fields.status = document.createElement('div');
    fields.status.dataset.field = SARAH_LAB_FIELD.status;
    fields.status.style.cssText = 'font:500 10px system-ui,sans-serif;color:var(--sl-muted,#9aa0a8);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    fields.cloth = document.createElement('div');
    fields.cloth.dataset.field = SARAH_LAB_FIELD.cloth;
    fields.cloth.style.cssText = 'font:600 10px system-ui,sans-serif;color:var(--sl-accent-deep,#2f6f5e);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none';
    info.append(eyebrow, nameLine, fields.status, fields.cloth);
    const history = pill();
    buttons.undoBody = pillButton('↶', SARAH_LAB_ACTION.undoBody, () => travelBody(-1), 'Undo body change');
    buttons.redoBody = pillButton('↷', SARAH_LAB_ACTION.redoBody, () => travelBody(1), 'Redo body change');
    history.append(buttons.undoBody, buttons.redoBody);
    const themePill = pill();
    buttons.theme = pillButton('', SARAH_LAB_ACTION.theme, () => applyTheme(otherTheme(theme)), 'Light or dark');
    themePill.appendChild(buttons.theme);
    studio.stage.top.append(backPill, info, history, themePill);
    // the bottom row: the camera's angles, the start view and TURN
    const views = pill();
    for (const a of VIEW_ANGLES) {
      buttons[`view-${a.id}`] = pillButton(a.label, `${SARAH_LAB_ACTION.view}${a.id}`, () => { orbit.yaw = a.yaw; orbit.pitch = ORBIT_START.pitch; turning = false; });
      views.appendChild(buttons[`view-${a.id}`]);
    }
    views.appendChild(pillButton('⛶', SARAH_LAB_ACTION.fit, resetView, 'Whole figure'));
    buttons.turn.removeAttribute('style'); buttons.turn.textContent = '⟳'; buttons.turn.title = 'Turn her'; buttons.turn.setAttribute('aria-label', 'Turn her');
    views.appendChild(buttons.turn);
    studio.stage.bottom.appendChild(views);
    // the corner: a PHOTO of her as she is on screen
    const photoPill = pill();
    buttons.photo = pillButton('▣', SARAH_LAB_ACTION.photo, () => { void takePhoto(); }, 'Save a picture');
    photoPill.appendChild(buttons.photo);
    studio.stage.corner.appendChild(photoPill);
    card = loadingCard(document, () => retry());
    studio.stage.element.appendChild(card.element);
    ctx.uiLayer.appendChild(root);
    hud = root;
    applyTheme(theme);
    refresh();
  }
  function resetView(): void { orbit.yaw = ORBIT_START.yaw; orbit.pitch = ORBIT_START.pitch; orbit.distance = ORBIT_START.distance; orbit.target.copy(ORBIT_START.target); turning = false; }
  /** LIGHT or DARK (studioTheme.ts): the panels, and the stage behind her. Remembered on this device. */
  function applyTheme(next: StudioTheme): void {
    theme = next;
    studio?.setTheme(next);
    const look = THEME_STAGE[next];
    (three.background as THREE.Color).setHex(look.background);
    (floor.material as THREE.MeshStandardMaterial).color.setHex(look.floor);
    (ring.material as THREE.MeshBasicMaterial).color.setHex(look.rim);
    storeTheme(localStore(), next);
  }
  /** Resolves after `n` more frames of the room (the bake below waits on the paint and the fabric to settle). */
  const frameWaiters: { left: number; done: () => void }[] = [];
  const frames = (n: number) => new Promise<void>((done) => frameWaiters.push({ left: n, done }));
  /**
   * THE BUILT-IN OUTFITS' PICTURES, for `npm run bake:outfits` (scripts/bakeOutfitThumbs.mjs), which opens the room with
   * `?bake=outfits`: each outfit the room offers is put on her in turn and pictured the way a saved one is.
   */
  async function bakeOutfitPictures(): Promise<{ name: string; path: string; picture: string | null }[]> {
    const out: { name: string; path: string; picture: string | null }[] = [];
    for (const i of offeredOutfits(garments)) {
      wornFrom = null; pendingClothes = null; nextSource = null;
      dress(i);
      for (let tries = 0; tries < 600 && !(outfit === i && wantedOutfit === null && model?.visible); tries++) await frames(1);
      await frames(12);
      out.push({ name: OUTFITS[i].name, path: outfitThumbPath(OUTFITS[i].name), picture: thumbnail() });
    }
    return out;
  }
  /**
   * SARAH FOR THE STORY PLAYER, for `scripts/sarahV2Recovery/story-sarah.mjs`, which opens the room with `?bake=story`
   * (storyBake.ts). READY once she is in, dressed, her hair on, the cloth tee laid and nothing loading.
   */
  function storyReady(): boolean {
    const phase = meter.snapshot().phase;
    return loaded && !failed && recovered && model?.visible === true && wantedOutfit === null && !clothLoading && skinState === 'ready'
      && !!partMeshes.get('spandex-lite')?.length && hairMeshes.length > 0 && !!faceMaterial && phase !== 'downloading' && phase !== 'preparing';
  }
  /**
   * The bake: the room's clock held, the cloth sim off so the fitted, skinned tee is what she wears (the story player
   * cannot run the cloth), her bind pose (T-POSE with ARMS at 0: every turn nothing, her arms down), her face OFF (the
   * story player lays it on `Material_0` itself), her springs at rest and two seconds of her own frames at a fixed step,
   * so what is measured on her each frame -- the fitted tee's navel -- is measured at rest, the same every run.
   */
  async function bakeForStory(options: { readonly splitPaint?: boolean } = {}): Promise<StoryBake> {
    if (!storyReady() || !model) throw new Error('[sarahlab] the story bake was asked for before she was ready');
    // her BUILD lives in her bones as much as in her skin, and the bake reads her rest shape through one bone
    // (`restSkinMatrix`): baked as she is, she would come out torn. Until the story file carries a build, it says so
    if (currentBuild().key) throw new Error('[sarahlab] the story bake does not carry her proportions yet (height, lengths, widths, sizes): RESET PROPORTIONS to bake her');
    clock.paused = true; clock.step = 0;
    try {
      clothWanted = false;
      if (clothOn) await toggleCloth();
      pose = 'tpose'; armsDeg = 0; armsOverride = false; curl = 0; faceOn = false; seated = 0; sitAmount = 0; sitMoving = false;
      settleMasses();
      applyLook(); refresh();
      for (let k = 0; k < 120; k++) advance(1 / 60);
      model.updateMatrixWorld(true);
      const b = bodyOf();
      if (!b) throw new Error('[sarahlab] the story bake found no body');
      const meshes: THREE.SkinnedMesh[] = [];
      model.traverseVisible((n) => { if ((n as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(n as THREE.SkinnedMesh); });
      const keep = clothKeep();
      return collectStoryBake({
        renderer: ctx.renderer.gl, camera, meshes, body: b.mesh, hair: hairMeshes, splitPaint: options.splitPaint,
        // SIT as the room sits her: its correctives, and her bump's tilt handed to her thighs (`seated` 1)
        seat: (on) => { pose = on ? 'sit' : 'tpose'; seated = on ? 1 : 0; sitAmount = on ? 1 : 0; sitMoving = false; applyLook(); applyMotion(); },
        facts: {
          look: SARAH_LOOK?.clothes.outfit ?? null, outfit: OUTFITS[outfit].name, bump, shape: serializeShape(body), bellyCurve, refine,
          skin: { chosen: skinId, worn: skinWorn, own: b.material.map === ownMap(b.material), painted: !!painted },
          cloth: { on: clothOn, wanted: clothWanted, made: !!cloth }, fittedTee: !!fittedTee(), fittedLaid, keep,
          teeDetail: fitted ? fitted.spots.fitted(keep, fitted.navel) : null,
          face: { on: faceOn, laid: !!faceMaterial }, hair: hairOn, pose, armsDeg, armsOverride, curl, garmentView, skinBare,
          springs: { belly: { ...masses.belly }, breastL: { ...masses.breastL }, breastR: { ...masses.breastR } },
          drawn: (() => { const out: string[] = []; three.traverseVisible((n) => { const m = n as THREE.Mesh; if (m.isMesh) out.push(`${m.name}|${(Array.isArray(m.material) ? m.material[0] : m.material).name}|${m.geometry.getAttribute('position')?.count}`); }); return out; })(),
        },
      });
    } finally { clock.paused = false; }
  }
  /**
   * A CARD'S PICTURE (Joshua, 2026-10-23: "we could have little screenshots for the outfit"): her, head to foot, from
   * the front three-quarter, whatever the view on screen -- so every card shows her the same way -- small enough to
   * keep in a save (a 3:4 JPEG of THUMB_SIZE). Null before she is on.
   */
  function thumbnail(): string | null {
    const bodyMesh = skinned.find(m => !!m.geometry.getAttribute('_cloth_cover')) ?? skinned[0];
    if (!model?.visible || !bodyMesh) return null;
    model.updateMatrixWorld(true);
    // her height from her own skeleton as posed (the floor up to a head's width over her highest joint, so she is whole
    // sitting as well as standing); her width a fixed allowance about her middle, as her arms may be out
    const at = new THREE.Vector3(), mid = new THREE.Vector3();
    let low = 0, high = -Infinity;
    for (const bone of bodyMesh.skeleton.bones) { bone.getWorldPosition(at); low = Math.min(low, at.y); high = Math.max(high, at.y); mid.add(at); }
    if (!Number.isFinite(high)) return null;
    mid.divideScalar(Math.max(1, bodyMesh.skeleton.bones.length));
    const box = new THREE.Box3(new THREE.Vector3(mid.x - 0.3 * M, low, mid.z - 0.28 * M), new THREE.Vector3(mid.x + 0.3 * M, high + 0.1 * M, mid.z + 0.28 * M));
    const size = ctx.renderer.size(), lens = new THREE.PerspectiveCamera(30, 1, 1, 10);
    frameBox(lens, box, { yaw: 0.5, pitch: 0.06, renderAspect: size.width / Math.max(1, size.height), fitAspect: THUMB_SIZE.width / THUMB_SIZE.height, margin: 1.04 });
    // the floor runs on behind her: the far plane reaches past it, not just past her
    lens.far = lens.position.distanceTo(box.getCenter(new THREE.Vector3())) + 3 * M; lens.updateProjectionMatrix();
    const picture = shootDataUrl(ctx.renderer.gl, three, lens, { width: THUMB_SIZE.width, height: THUMB_SIZE.height, quality: 0.8 });
    ctx.renderer.render(three, camera);
    return picture;
  }
  /**
   * PHOTO (from the Character Studio preview): what the stage shows of her, at the screen's full resolution, handed to
   * the share sheet where there is one (an iPhone home-screen app) and downloaded elsewhere.
   */
  async function takePhoto(): Promise<void> {
    const gl = ctx.renderer.gl, whole = shoot(gl, three, camera);
    ctx.renderer.render(three, camera);
    if (!whole || !studio) return;
    const canvasRect = gl.domElement.getBoundingClientRect(), stageRect = studio.stage.element.getBoundingClientRect();
    const k = whole.width / Math.max(1, canvasRect.width);
    const x = Math.max(0, Math.round((stageRect.left - canvasRect.left) * k)), y = Math.max(0, Math.round((stageRect.top - canvasRect.top) * k));
    const w = Math.min(whole.width - x, Math.round(stageRect.width * k)), h = Math.min(whole.height - y, Math.round(stageRect.height * k));
    const crop = document.createElement('canvas'); crop.width = Math.max(1, w); crop.height = Math.max(1, h);
    crop.getContext('2d')?.drawImage(whole, x, y, w, h, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) return;
    const name = `${(characters?.name() || 'sarah').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'sarah'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    // a share sheet that will not open this late after the tap: the picture is downloaded instead
    if (await savePicture(blob, name) === 'failed') {
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
  function zoom(factor: number): void {
    orbit.distance = Math.min(4.5 * M, Math.max(0.45 * M, orbit.distance * factor));
  }

  /**
   * Slide the camera up or down by a move on screen (pixels, down positive, on a view `viewHeight` pixels tall): she moves
   * with the fingers, as far on screen as they did at the distance she is seen from. Held between her feet and just above
   * her head.
   */
  function panBy(dyPixels: number, viewHeight: number): void {
    if (!Number.isFinite(dyPixels) || dyPixels === 0) return;
    const h = Math.max(1, Number.isFinite(viewHeight) ? viewHeight : 1);
    const perPixel = (2 * orbit.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / h;
    orbit.target.y = Math.min(PAN_TOP * M, Math.max(PAN_BOTTOM * M, orbit.target.y + dyPixels * perPixel));
    turning = false;
    refresh();
  }

  // ------------------------------------------------------------- posing
  /** Her turns in pose `p` (the room's own by default), the base pose written into `out`. */
  function turnsFor(p: SarahLabPose = pose, out: MutableJointTurn[] = poseOut): readonly JointTurn[] {
    if (!rig || !measure) return [];
    let base: readonly JointTurn[];
    if (p === 'sit') base = poseSeated(measure, rig.bind, { style: 'sit', seconds, posture: 'pregnant', bump: bump / 100, settled: settledSitFor(SARAH_LAB_MODELS[modelIndex].id) }, out);
    else {
      const stance = p === 'walk' ? 'walk' : 'stand';
      // the stride is in bind units, `bindScale` of them to the metre
      const carry = bump / 100;
      const phase = p === 'walk' ? ((walked * rig.bindScale) / humanStride(measure, 'walk', carry)) % 1 : 0;
      base = poseHuman(measure, rig.bind, { stance, phase, seconds, lean: 0, carry }, out);
    }
    const overrideArms = p === 'tpose' || (SARAH_LAB_MODELS[modelIndex].id !== 'v1' && armsOverride);
    // T-POSE restores the whole bind pose. Other poses keep their torso and legs,
    // and the unselected arm keeps its normal animation.
    if (p === 'tpose') base = base.map(turn => ({ ...turn, radians: 0 }));
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

  /** Her turns this frame: her pose, or on the way between standing and seated, the two blended (`poseBlend.ts`). */
  function currentTurns(): readonly JointTurn[] {
    if (!sitMoving || sitAmount <= 0 || sitAmount >= 1) return turnsFor();
    return blendJointTurns(turnsFor('stand', standOut), turnsFor('sit', poseOut), sitEase(sitAmount), blendOut);
  }

  /**
   * Her place on the floor. Standing, her build lifts her so her soles stay on the floor (a longer leg, bigger feet).
   * Seated, and on the way there (`sitAmount`), her feet stay where she stood and the stool is set behind her: her hips
   * 10 cm over its top, her ankles a sole's height off the floor, and her ankles' height moved from standing's to
   * seated's as she goes (Joshua, 2026-10-28: a stand-to-sit move, `poseBlend.ts`). The view keeps her where it framed her
   * seated before (`orbit.target.z`). Leaves her bones in this frame's pose.
   */
  function place(): void {
    if (!model || !rig || !measure) return;
    const skin = findSkinnedMesh(model);
    if (sitAmount <= 0 || !skin) {
      model.position.set(0, standLift * M, 0);
      model.updateMatrixWorld(true);
      stool.visible = false;
      orbit.target.z = ORBIT_START.target.z;
      return;
    }
    const bones = skin.skeleton.bones, j = measure.joints, v = () => new THREE.Vector3();
    // her hips, her feet (between her ankles) and her lower ankle's height in a pose, stood at the origin
    const read = () => {
      model!.position.set(0, 0, 0); model!.updateMatrixWorld(true);
      const al = bones[j.ankleL].getWorldPosition(v()), ar = bones[j.ankleR].getWorldPosition(v());
      return { hips: bones[j.hipL].getWorldPosition(v()).add(bones[j.hipR].getWorldPosition(v())).multiplyScalar(0.5), feet: al.clone().add(ar).multiplyScalar(0.5), low: Math.min(al.y, ar.y) };
    };
    rig.apply(turnsFor('stand', standOut)); const stand = read();
    rig.apply(turnsFor('sit', poseOut)); const sit = read();
    const seatTop = Math.min(0.55, Math.max(0.4, (sit.hips.y - sit.low) / M + 0.08 - 0.1));
    // standing, her feet are here; seated, she is set so they stay there
    const standFeet = stand.feet.clone().add(v().set(0, standLift * M, 0));
    const seatedAt = v().set(standFeet.x - sit.feet.x, (seatTop + 0.1) * M - sit.hips.y, standFeet.z - sit.feet.z);
    // this frame's pose, and her set so her feet are where she stood, at the height they have come to
    rig.apply(currentTurns()); garmentRoom?.applyPose();
    const now = read(), e = sitEase(sitAmount);
    const lowStanding = stand.low + standLift * M, lowSeated = sit.low + seatedAt.y, low = lowStanding + (lowSeated - lowStanding) * e;
    model.position.set(standFeet.x - now.feet.x, low - now.low, standFeet.z - now.feet.z);
    model.updateMatrixWorld(true);
    stool.visible = true;
    stool.scale.set(1, seatTop * M, 1);
    stool.position.set(seatedAt.x + sit.hips.x, (seatTop * M) / 2, seatedAt.z + sit.hips.z - 0.02 * M);
    // seated she used to be set with her hips 4 cm behind the room's middle: the view follows her back to frame her so
    orbit.target.z = ORBIT_START.target.z + (model.position.z + now.hips.z - (stand.hips.z + (-0.04 * M - stand.hips.z) * e));
  }

  /** The masses at rest, and their anchors to be read afresh (a jump, a new body, a bake). */
  function settleMasses(): void {
    for (const m of Object.values(masses)) Object.assign(m, restingMass());
    if (anchors) for (const a of Object.values(anchors)) a.primed = 0;
    for (const u of Object.values(jiggle)) u.value.set(0, 0, 0);
  }

  /**
   * Her belly and breasts, every frame (softBody.ts): what her body does at each mass's anchor -- its acceleration from
   * where it is frame to frame, plus a walk's own bounce, which this walk-on-the-spot leaves out, and gravity as her
   * body leans -- in her own frame, steps each mass, and hands the shaders what her skin shows of it.
   */
  function feelMotion(dt: number): void {
    seated = sitMoving ? seatShare() : stepSeated(seated, pose === 'sit' ? 1 : 0, dt);
    applyMotion();
    const b = bodyOf();
    if (!anchors || !b || !(dt > 0)) return;
    const meshQ = b.mesh.getWorldQuaternion(qMesh).invert();
    let walkUp = 0, walkSide = 0;
    if (pose === 'walk' && measure && rig) {
      const stride = humanStride(measure, 'walk', bump / 100) / rig.bindScale; // metres
      walkUp = walkBounceAccel((walked / stride) % 1, stride / WALK_SPEED);
      walkSide = walkSwayAccel((walked / stride) % 1, stride / WALK_SPEED);
    }
    // her left in the world, for the sway
    side.set(1, 0, 0).applyQuaternion(qSide.copy(meshQ).invert());
    const volume = bustVolume(bump, body.breastSize), milkL = body.milk * (body.milkBalance < 0 ? 1 + 0.4 * body.milkBalance / 100 : 1), milkR = body.milk * (body.milkBalance > 0 ? 1 - 0.4 * body.milkBalance / 100 : 1);
    const tunes = { belly: bellyTune(bump, body.bellyFirmness, body.babyWeight, body.bellyBounce), breastL: breastTune(volume, milkL, body.breastFirmness, 'left', body.breastBounce), breastR: breastTune(volume, milkR, body.breastFirmness, 'right', body.breastBounce) };
    for (const key of ['belly', 'breastL', 'breastR'] as const) {
      const a = anchors[key];
      a.bone.localToWorld(tmp.copy(a.local)).multiplyScalar(1 / M);
      accel.set(0, 0, 0);
      if (a.primed >= 1) {
        vel.copy(tmp).sub(a.p).divideScalar(dt);
        if (a.primed >= 2) accel.copy(vel).sub(a.v).divideScalar(dt);
        a.v.copy(vel);
        a.primed = Math.min(2, a.primed + 1);
      } else a.primed = 1;
      a.p.copy(tmp);
      accel.y += walkUp;
      accel.addScaledVector(side, walkSide);
      // world to her frame: the bone's turn since it was bound, and her mesh's own
      a.bone.getWorldQuaternion(qBone);
      toBody.copy(meshQ).multiply(qBone).multiply(qBind.copy(a.bind).invert()).invert().multiply(meshQ);
      feltAcceleration(accel, toBody, felt);
      const m = masses[key], t = tunes[key];
      stepMass(m, dt, felt.x, felt.y, felt.z, t);
      // the shaders get metres in her frame; the follow weights turn them into each mesh's units
      jiggle[key].value.set(m.x, m.y, m.z).multiplyScalar(t.gain);
    }
  }
  const qMesh = new THREE.Quaternion(), qBone = new THREE.Quaternion(), qBind = new THREE.Quaternion(), toBody = new THREE.Quaternion();
  const accel = new THREE.Vector3(), vel = new THREE.Vector3(), felt = new THREE.Vector3(), side = new THREE.Vector3(), qSide = new THREE.Quaternion();

  /** Load the chosen model, putting away the one shown (MODEL switches v1 and v2). */
  function loadSarah(): void {
    dropCloth();
    // the brush's copy belongs to this body's material, which goes now
    dropPainter();
    // her hair goes with her body (it is in her model's tree); a request still under way is no longer wanted
    hairMeshes = []; hairRequest++;
    if (model) { three.remove(model); rig?.dispose(); release(model); model = null; }
    rig = null; measure = null; fingers = []; skinned = []; shaped = []; garments = []; hasBelly = false; anchors = null; navel = null; sidesAt = []; babyAt = []; chestAt = []; milkAt = []; groinAt = [];
    buildRig = null; bonesBuilt = ''; standLift = 0;
    crease.reset(); if (creaseTimer) { clearTimeout(creaseTimer); creaseTimer = 0; }
    recovered = false; partMeshes.clear(); wantedOutfit = null; outfitRequest++;
    for (const run of inflight.values()) run.abort.abort();
    inflight.clear();
    settleMasses(); loaded = false; failed = false;
    const entry = SARAH_LAB_MODELS[modelIndex], skin = hooks.skin ?? null, path = sarahModelPath(entry, skin);
    if (skin === 'ktx2') assets.enableKtx2(ctx.renderer.gl);
    // THE ORDER (Joshua, 2026-10-20): the room, then her, then what she has on -- only that outfit, its files asked for
    // the moment her body's bytes are in, so its download runs while her body is being built rather than after it
    const planned = hooks.nativeOutfitPreview !== true && entry.id === 'v2-body' ? recoveredPartsFor(wornGarments(outfit, [...GARMENTS, ...RECOVERED_SHIRTS])) : [];
    begin(OPENING_LABEL, 'centre');
    meter.expect(path, assets.assetBytes(path));
    for (const p of planned) meter.expect(recoveredPartPath(p), assets.assetBytes(recoveredPartPath(p)));
    refresh();
    let asked = false;
    const askForClothes = () => { if (!asked) { asked = true; for (const p of planned) void requestPart(p); } };
    // her refined 0% shape and round navel (zeroRefine.ts, Joshua 2026-10-29), fetched beside her body file
    const zeroData = entry.id === 'v2-body' && hooks.nativeOutfitPreview !== true ? loadZeroRefine(assets.assetUrl(ZERO_REFINE_PATH)) : Promise.resolve(null);
    void assets.loadModel(path, () => new THREE.Object3D(), { meter, onDownloaded: askForClothes }).then(async (loadedModel) => {
      if (disposed || path !== sarahModelPath(SARAH_LAB_MODELS[modelIndex], skin)) { release(loadedModel); return; }
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
        // on the approved v2 body every part can take her build, shape fields or none
        else if (recovered) shaped.push({ mesh, fields: baseShapeFields(mesh) });
        // shapes that move nothing on this part are not sent to the GPU (morphPrune.ts)
        dropIdleMorphs(mesh);
        if (mesh.morphTargetDictionary?.[BELLY_TARGET] !== undefined) hasBelly = true;
        // her belly and breasts move it as the masses swing (softBody.ts)
        attachJiggle(mesh, jiggle);
        const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
        if (([...GARMENTS, ...RECOVERED_SHIRTS] as readonly string[]).includes(name)) found.add(name as Garment);

      });
      // on the approved v2 body every garment with its own file is on hand (the slim body file no longer carries the
      // leggings it replaced)
      garments = [...GARMENTS, ...RECOVERED_SHIRTS].filter((g) => found.has(g) || (recovered && RECOVERED_GARMENTS.includes(g)));
      // her build is measured on her approved v2 body (its rest, as approved, before any shape is laid on it)
      if (recovered && measure) {
        const b = bodyOf(), s = b ? shaped.find((x) => x.mesh === b.mesh) : undefined;
        try { buildRig = b && s ? prepareBuildRig(b.mesh, s.fields.basePos, measure.joints, FACE_REST_SCALE) : null; } catch (error) { console.error('[sarahlab] her build could not be measured; BUILD is off', error); buildRig = null; }
      }
      if (!recovered && outfit >= 5) outfit = 0;
      model = loadedModel;
      // her refined 0% shape and her navel as its own piece (zeroRefine.ts), put on her approved body when the file is
      // in -- fetched beside her body file and almost always there first; it never holds up her loading
      if (recovered) void zeroData.then((zero) => {
        const b = bodyOf(), s = b ? shaped.find((x) => x.mesh === b.mesh) : undefined;
        if (!zero || disposed || model !== loadedModel || !b || !s) return;
        const z = applyZeroRefine(s.mesh, s.fields, zero);
        if (!z) return;
        s.fields = z.fields; navel = { mesh: b.mesh, piece: z.navel }; sidesAt = sidesAnchors(z.fields); chestAt = chestAnchors(z.fields); groinAt = groinAnchors(z.fields);
        applyLook();
        // then her baby-weight shapes, in the background: at 0 she is her approved belly, so nothing waits for them
        void loadWomb(assets.assetUrl(WOMB_PATH)).then((womb) => {
          const b2 = bodyOf(), s2 = b2 ? shaped.find((x) => x.mesh === b2.mesh) : undefined;
          if (!womb || disposed || model !== loadedModel || !b2 || !s2) return;
          const f = applyWomb(s2.mesh, s2.fields, womb);
          if (!f) return;
          s2.fields = f; babyAt = babyAnchors(f);
          refresh();
          applyLook();
        });
        // and her milk shapes, the same way: at 0 she is as approved
        void loadMilk(assets.assetUrl(MILK_PATH)).then((milk) => {
          const b2 = bodyOf(), s2 = b2 ? shaped.find((x) => x.mesh === b2.mesh) : undefined;
          if (!milk || disposed || model !== loadedModel || !b2 || !s2) return;
          const f = applyMilk(s2.mesh, s2.fields, milk);
          if (!f) return;
          s2.fields = f; milkAt = milkAnchors(f);
          refresh();
          applyLook();
        });
      });
      // and the skin chosen in FACE goes on (a candidate fetched once is kept for a body loaded again)
      applySkin();
      // and her hair, made for her approved v2 body
      loadHair();
      // and her face, on her approved v2 body only (its measurements are that file's)
      { const b = bodyOf(); faceMaterial = recovered && b ? b.material : null; if (faceMaterial) patchFaceRig(faceMaterial); }
      // she stays out of sight until what she has on is on: never undressed, then dressed a moment later
      loadedModel.visible = !recovered;
      three.add(loadedModel);
      // the masses' anchors: the belly in front of her spine, each breast on her chest (rest metres, x her left)
      const skinMesh = findSkinnedMesh(loadedModel);
      if (skinMesh && measure) {
        loadedModel.updateMatrixWorld(true);
        const bones = skinMesh.skeleton.bones, spine = bones[measure.joints.spine], chest = bones[measure.joints.chest];
        const bindOf = (bone: THREE.Bone) => {
          const k = bones.indexOf(bone), world = new THREE.Matrix4().copy(skinMesh.skeleton.boneInverses[k]).invert();
          const qb = new THREE.Quaternion(), qm = new THREE.Quaternion(), sc = new THREE.Vector3(), at = new THREE.Vector3();
          world.decompose(at, qb, sc); skinMesh.bindMatrix.decompose(at, qm, sc);
          return qm.invert().multiply(qb);
        };
        const at = (bone: THREE.Bone, x: number, y: number, z: number): Anchor => ({ bone, local: bone.worldToLocal(new THREE.Vector3(x * M, y * M, z * M)), bind: bindOf(bone), p: new THREE.Vector3(), v: new THREE.Vector3(), primed: 0 });
        if (spine && chest) anchors = { belly: at(spine, 0, 1.0, 0.2), breastL: at(chest, 0.088, 1.27, 0.08), breastR: at(chest, -0.088, 1.27, 0.08) };
        settleMasses();
      }
      loaded = true;
      dress(outfit, true);
    }).catch(error => { console.error('[sarahlab] model/outfit preparation failed', error); failed = true; loaded = false; failLoad('Sarah', () => loadSarah()); refresh(); });
  }

  /** One frame of her: her walk, her pose, her springs, what is laid on her, and the cloth tee over her. */
  function advance(dt: number): void {
      seconds += dt;
      if (pose === 'walk') walked += WALK_SPEED * dt;
      if (sitMoving) { sitAmount = stepSit(sitAmount, pose === 'sit' ? 1 : 0, dt); if (sitAmount === (pose === 'sit' ? 1 : 0)) { sitMoving = false; applyLook(); } }
      else sitAmount = pose === 'sit' ? 1 : 0;
      if (rig) rig.apply(currentTurns());
      garmentRoom?.applyPose();
      place();
      feelMotion(dt);
      // her face: her eyes, her blinks, her jaw
      faceFrame(dt);
      // a painted top's cleavage bridge is laid where her breasts are this frame
      if (fabric && model) { model.updateMatrixWorld(true); fabric.frame(); }
      // and every built strap laid on her skin as she is this frame
      if (builder && model) builder.frame();
      // seated (or still standing up), the fitted tee is worn; standing again, the cloth is laid on her afresh
      // -- with its sleeves, and not cropped: a tank has no sleeves to tear under her arms, and the fitted tee is far
      // longer than a crop, so both are worn seated as they are standing
      const seatedNow = seatedStandIn && sleeves && teeLengthParts(teeLength).crop === 0 && (pose === 'sit' || seated > 0.02);
      if (seatedNow !== clothSeated) {
        clothSeated = seatedNow;
        if (!seatedNow && cloth && clothOn) clothRestart = true;
        if (cloth && clothOn) { if (seatedNow) { setClothDetail(cloth.mesh.material as THREE.Material, null); setClothNeckline(cloth.mesh.material as THREE.Material, null); setClothTrim(cloth.mesh.material as THREE.Material, null); } applyLook(); refresh(); }
      }
      // and the cloth tee, moved over her as she is this frame (its cost on the stage)
      if (cloth && clothWorn() && cloth.mesh.visible && model?.visible && !clothLoading) {
        model.updateMatrixWorld(true);
        if (clothRefit) { refitCloth(cloth); clothRefit = false; }
        if (clothRestart) { cloth.restart(); clothRestart = false; }
        cloth.frame(dt);
        // her navel and nipples through it, at the editor's BREAST and NAVEL DETAIL; her navel softened under it to match
        const keep = clothKeep();
        cloth.keep = keep;
        setClothDetail(cloth.mesh.material as THREE.Material, cloth.detail(keep));
        // and its neckline, cut by the material along a smooth line
        setClothNeckline(cloth.mesh.material as THREE.Material, cloth.neckline());
        // and its crop's hem and tank's armholes, the same way
        setClothTrim(cloth.mesh.material as THREE.Material, cloth.trim());
        if (Math.abs(1 - keep.navel - clothFlattenLaid) > 1e-3) applyLook();
        if (fields.cloth) fields.cloth.textContent = clothLine(cloth.stats(), frameMs);
      }
      // the procedural tee a probe put on her (Stage 2b review): the room's tees stand aside while it is worn, it is laid
      // on her afresh when she changes pose (as the cloth tee is), and it collides with the stool when she sits
      if (garmentRoom && model?.visible) {
        if (cloth) cloth.mesh.visible = false;
        const lite = partMeshes.get('spandex-lite')?.[0];
        if (lite) lite.visible = false;
        // a pose switch lays it on her afresh; STAND to SIT and back is a move, and it is worn all the way through it
        if (pose !== garmentPoseKey) { garmentPoseKey = pose; if (!sitMoving) garmentRoom.cloth.restart(); }
        if (garmentRoom.capsules.stool !== null || sitAmount > 0) garmentRoom.capsules = { ...garmentRoom.capsules, stool: sitAmount > 0 && stool.visible ? { x: stool.position.x, z: stool.position.z, radius: 0.21 * M, top: stool.scale.y } : null };
        model.updateMatrixWorld(true);
        // BREAST and NAVEL DETAIL, exactly as on the cloth tee: the domes under it, her details drawn through it, and
        // her navel softened under it to match
        const keep = clothKeep();
        garmentRoom.cloth.detailKeep = keep;
        // cut again for her shape when it changed, as the cloth tee is
        // (at most every GARMENT_REFIT_EVERY seconds while the slider is dragged: a cut is 40-100 ms of a phone's frame;
        // the last one, once she stops changing, always lands)
        garmentRefitAge += dt;
        if (garmentRefit && garmentRefitAge >= GARMENT_REFIT_EVERY) { garmentRoom.cloth.setRestShift(restShiftNow()); garmentRoom.cloth.refit(); garmentRefit = false; garmentRefitAge = 0; }
        // the outfit's tee is eased on as the review probes ease it: weightless a moment and pinned at the neckline where it
        // settled, then let hang and pinned again; and seated, her legs and the stool hold it
        if (garmentAuto) {
          // the review probes' own dressing, step for step (DRESS): weightless and pinned where it settled; her arms out a
          // little and down again, so the sleeves and underarms fall into place; pinned again where it hangs
          const was = garmentDressT; garmentDressT += dt;
          const D = DRESS, at = (k: number) => was < k && garmentDressT >= k;
          if (at(D.weightless)) { garmentRoom.cloth.settle(); garmentRoom.cloth.weightless = false; }
          if (garmentDressT < D.done) {
            const ss = (a: number, b: number) => { const t = Math.min(1, Math.max(0, (garmentDressT - a) / (b - a))); return t * t * (3 - 2 * t); };
            garmentRoom.pose.raise = D.raise * (ss(D.weightless, D.out) - ss(D.hold, D.down));
          } else if (was < D.done) garmentRoom.pose.raise = 0;
          if (at(D.done)) garmentRoom.cloth.settle();
          garmentRoom.capsules = { ...garmentRoom.capsules, arms: true, legs: sitAmount > 0 };
        }
        // a slow frame is taken in two halves: at a twentieth of a second a step, the cloth under her bust caught inside her
        // as the room opened at 73% belly (headless, a software renderer's frame), and halved it did not
        const pieces = dt > 1 / 40 ? 2 : 1;
        for (let k = 0; k < pieces; k++) garmentRoom.frame(dt / pieces);
        setClothDetail(garmentRoom.cloth.mesh.material as THREE.Material, garmentShade ? garmentRoom.cloth.detailShading(keep) : null);
        // the cloth tee's cuts stay off a material the garment shares with it, and the garment's own are on (a probe's
        // plain tee carries no cut, so its edge is never dropped)
        setClothNeckline(garmentRoom.cloth.mesh.material as THREE.Material, null); setClothTrim(garmentRoom.cloth.mesh.material as THREE.Material, null);
        if (garmentAuto) setCutEdge(garmentRoom.cloth.mesh.material as THREE.Material, true);
        if (Math.abs(1 - keep.navel - clothFlattenLaid) > 1e-3) applyLook();
      }
      // the fitted light tee (the cloth off): her nipples drawn through it and its own navel settled onto its smooth
      // surface, at the editor's BREAST and NAVEL DETAIL; her navel softened under it to match
      const tee = fittedTee(), bodyMesh = tee ? skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover')) : undefined;
      if (tee && bodyMesh && tee.visible && model?.visible) {
        if (!fitted || fitted.tee !== tee || fitted.body !== bodyMesh) fitted = { body: bodyMesh, tee, bodyPose: new SkinPose(bodyMesh), teePose: new SkinPose(tee), spots: new DetailSpots(SARAH_V2_DETAIL_POINTS), navel: new TeeNavel(SARAH_V2_LITE_TEE_NAVEL) };
        model.updateMatrixWorld(true);
        fitted.bodyPose.refresh(); fitted.teePose.refresh();
        fitted.spots.measure(fitted.bodyPose);
        fitted.navel.measure(fitted.teePose, fitted.spots.navel);
        const keep = clothKeep();
        setClothDetail(tee.material as THREE.Material, fitted.spots.fitted(keep, fitted.navel));
        fittedLaid = true;
        if (Math.abs(1 - keep.navel - clothFlattenLaid) > 1e-3) applyLook();
      } else if (fittedLaid && !clothWorn()) {
        const material = partMeshes.get('spandex-lite')?.[0]?.material;
        if (material) setClothDetail(material as THREE.Material, null);
        fittedLaid = false;
      }
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
      // a bake of the built-in outfits' card pictures asks for it by address (scripts/bakeOutfitThumbs.mjs)
      if (new URLSearchParams(globalThis.location?.search ?? '').get('bake') === 'outfits') (globalThis as unknown as Record<string, unknown>).__sarahLabBakeOutfits = bakeOutfitPictures;
      // ...and a bake of her for the story player (scripts/sarahV2Recovery/story-sarah.mjs)
      if (new URLSearchParams(globalThis.location?.search ?? '').get('bake') === 'story') (globalThis as unknown as Record<string, unknown>).__sarahLabStory = { ready: storyReady, bake: bakeForStory };
      // ?probe=cloth: run the cloth tee N frames at a fixed step between pictures (a software renderer draws ~1 a second)
      if (new URLSearchParams(globalThis.location?.search ?? '').get('probe') === 'cloth') (globalThis as unknown as Record<string, unknown>).__sarahLabCloth = {
        // the three masses (softBody.ts): where each is, and what her skin shows of it (metres)
        masses: () => ({ belly: { ...masses.belly }, breastL: { ...masses.breastL }, breastR: { ...masses.breastR }, shown: { belly: jiggle.belly.value.toArray(), breastL: jiggle.breastL.value.toArray(), breastR: jiggle.breastR.value.toArray() }, anchored: !!anchors }),
        kick: (vy: number, vx = 0, vz = 0) => { for (const m of Object.values(masses)) { m.vy += vy; m.vx += vx; m.vz += vz; } },
        settle: (frames: number, dt = 1 / 60) => { if (!cloth || !model) return null; for (let k = 0; k < frames; k++) { model.updateMatrixWorld(true); if (clothRefit) { refitCloth(cloth); clothRefit = false; } cloth.frame(dt); } return cloth.stats(); },
        settings: () => cloth?.simSettings ?? null,
        // her own frame run `seconds` at a fixed step -- walk, springs, the cloth -- between pictures (a software renderer
        // draws about one frame a second, so the room's own clock cannot show her moving)
        // the room's own clock held (its frames then move nothing), so only animate() moves her: a software renderer's
        // second-long frames are no measure of her motion
        hold: (on: boolean) => { clock.paused = on; clock.step = 0; },
        // the camera at any angle about her (yaw radians, 0 her front; pitch radians, below 0 from beneath)
        // (and how far off, world units, and at what height: for a close look at her neckline)
        look: (yaw: number, pitch?: number, distance?: number, height?: number, across?: number) => { orbit.yaw = yaw; if (pitch !== undefined) orbit.pitch = pitch; if (distance !== undefined) orbit.distance = distance; if (height !== undefined) orbit.target.y = height; if (across !== undefined) orbit.target.x = across; turning = false; },
        // Stage 2b: the procedural tee (garment/roomGarment.ts) tailored to her and put on her in place of the room's tees,
        // or taken off (null). Its construction: 'raglan' or 'setIn', with a gusset share 0..1; `extra` for the follow-up's
        // comparisons (neckline width and drop, a neck band, a set-in's bust shaping and armhole band).
        garment: (construction: 'raglan' | 'setIn' | null, gusset = 0.5, wire = false, extra: { neckWidth?: number; neckDrop?: number; bustShaping?: 'none' | 'ease' | 'dart'; neckBand?: number; armholeBand?: number; detail?: boolean } = {}) => {
          // the probe owns the garment from here: the outfit's own leaves it alone
          garmentProbed = true; garmentAuto = null;
          const g = putOnGarment(construction, gusset, wire, extra);
          if (!g) return null;
          const t = g.tailored;
          return { ms: t.ms, report: { ...t.report, seams: t.report.seams.map((q) => ({ name: q.name, a: q.lengthA, b: q.lengthB })) }, notes: t.draft.notes, particles: t.sewn.count };
        },
        // her arms turned on top of her pose (radians): out to her side, forward, elbows bent
        garmentPose: (raise: number, forward = 0, elbow = 0) => { if (!garmentRoom) return false; garmentRoom.pose.raise = raise; garmentRoom.pose.forward = forward; garmentRoom.pose.elbow = elbow; return true; },
        // which of her limbs it collides with (the stool comes with SIT when legs are on)
        garmentCapsules: (arms: boolean, legs: boolean) => { if (!garmentRoom) return false; garmentRoom.capsules = { arms, legs, stool: null }; return true; },
        // bind it where it lies and hold its neckline there (after it is on her)
        garmentSettle: () => { garmentRoom?.cloth.settle(); return !!garmentRoom; },
        // weightless, it only draws itself to its pattern over her (how it is eased on before it is pinned and let hang)
        garmentWeightless: (on: boolean) => { if (garmentRoom) garmentRoom.cloth.weightless = on; return !!garmentRoom; },
        // its strain now (length / pattern length x FIT): everywhere, and over the underarm
        garmentStrain: () => garmentRoom ? { all: garmentRoom.cloth.strain(), underarm: garmentRoom.cloth.strain((p) => garmentRoom!.underarm[p] === 1) } : null,
        garmentNeck: () => garmentRoom?.neck() ?? null,
        // the most stretched edges now, which particles and where, and what her skin carries under them (a probe's look)
        garmentWorst: (k = 8) => garmentRoom ? garmentRoom.cloth.worst(k).map((w) => ({ ...w, trunkOnly: garmentRoom!.tailored.placed.trunkOnly[w.a], piece: garmentRoom!.tailored.sewn.particlePiece[w.a] })) : null,
        // the particles furthest inside her skin now, and their floors (a probe's look at skin showing through)
        garmentDeepest: (k = 12) => garmentRoom ? garmentRoom.cloth.deepest(k).map((d) => ({ ...d, trunkOnly: garmentRoom!.tailored.placed.trunkOnly[d.p], piece: garmentRoom!.tailored.sewn.particlePiece[d.p] })) : null,
        // how sharply it folds now: the angle between neighbouring triangles (degrees)
        garmentFolds: (over = 70) => garmentRoom?.cloth.folds(over) ?? null,
        // its simulation settings changed in place (bend compliance, the fold limit...): for a probe's comparison
        garmentTune: (patch: Record<string, number>) => { if (!garmentRoom) return false; Object.assign(garmentRoom.cloth.simSettings, patch); return true; },
        // how far it stands off her navel and nipples (below 0: through it)
        garmentDetailGap: () => garmentRoom?.cloth.detailGap() ?? null,
        // her skin in front of the garment: posed vertices of her body inside a box (world) that stand out past the drawn
        // cloth over them (along its normal at the nearest particle, within `reach`), the furthest first, with the vertex
        garmentPokes: (lo: number[], hi: number[], reach = 1.2, k = 12) => {
          const body = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!garmentRoom || !body) return null;
          body.updateMatrixWorld(true);
          const x = garmentRoom.cloth.positions, N = garmentRoom.cloth.drawNormals(), n = garmentRoom.tailored.sewn.count, P = body.geometry.getAttribute('position'), v = new THREE.Vector3();
          const out: { v: number; at: number[]; out: number }[] = [];
          for (let i = 0; i < P.count; i++) {
            body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld);
            if (v.x < lo[0] || v.x > hi[0] || v.y < lo[1] || v.y > hi[1] || v.z < lo[2] || v.z > hi[2]) continue;
            let best = Infinity, bp = -1;
            for (let p = 0; p < n; p++) { const d = (x[p * 3] - v.x) ** 2 + (x[p * 3 + 1] - v.y) ** 2 + (x[p * 3 + 2] - v.z) ** 2; if (d < best) { best = d; bp = p; } }
            if (bp < 0 || best > reach * reach) continue;
            const o = (v.x - x[bp * 3]) * N[bp * 3] + (v.y - x[bp * 3 + 1]) * N[bp * 3 + 1] + (v.z - x[bp * 3 + 2]) * N[bp * 3 + 2];
            if (o > -0.05) out.push({ v: i, at: [v.x, v.y, v.z], out: o });
          }
          return out.sort((a, b) => b.out - a.out).slice(0, k);
        },
        // her skin the CAMERA sees in front of the garment: for each of her posed vertices inside a box (world), a ray
        // from the eye to it; where the drawn garment is met behind the vertex within `depth`, her skin stands in front
        // of the cloth there and shows. The drawn mesh, so the draw lift is included
        garmentSeen: (lo: number[], hi: number[], depth = 3, k = 12) => {
          const body = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!garmentRoom || !body) return null;
          body.updateMatrixWorld(true);
          const mesh = garmentRoom.cloth.mesh, P = body.geometry.getAttribute('position'), v = new THREE.Vector3(), eye = new THREE.Vector3(), dir = new THREE.Vector3();
          mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
          camera.getWorldPosition(eye);
          const ray = new THREE.Raycaster();
          const side = (mesh.material as THREE.Material).side; (mesh.material as THREE.Material).side = THREE.DoubleSide;
          const out: { v: number; at: number[]; by: number }[] = [];
          let tested = 0;
          try {
            for (let i = 0; i < P.count; i++) {
              body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld);
              if (v.x < lo[0] || v.x > hi[0] || v.y < lo[1] || v.y > hi[1] || v.z < lo[2] || v.z > hi[2]) continue;
              tested++;
              dir.subVectors(v, eye); const tv = dir.length(); dir.divideScalar(tv);
              ray.set(eye, dir); ray.near = 0; ray.far = tv + depth;
              const hits = ray.intersectObject(mesh, false);
              if (!hits.length || hits[0].distance <= tv) continue;
              out.push({ v: i, at: [v.x, v.y, v.z], by: hits[0].distance - tv });
            }
          } finally { (mesh.material as THREE.Material).side = side; }
          return { tested, seen: out.length, worst: out.sort((a, b) => b.by - a.by).slice(0, k) };
        },
        garmentShade: (on: boolean) => { garmentShade = on; return true; },
        garmentProfile: (i = 0) => garmentRoom?.cloth.detailProfile(i) ?? null,
        garmentDetailShade: (patch?: { spread?: number; widen?: number; slope?: number; grow?: number }) => garmentRoom?.cloth.detailShade(patch) ?? null,
        garmentStats: () => garmentRoom?.cloth.stats() ?? null,
        // Stage 3: the new tee's settings, as its panel moves them (`final` true: let go, so a re-tailor one tailors),
        // its landmarks, and what of it is worn
        garmentSettings: (patch?: Record<string, unknown>, final = true) => { if (patch) garmentChanged(clampGarmentSettings({ ...garmentSettings, ...patch }, garmentSettings), final); return garmentSettings; },
        garmentStops: () => (garmentRoom && garmentAuto ? garmentRoom.stops() : null),
        // the worn edges in a box (world), with each end's pattern place (piece, u, v): where the cloth is cut too long or short
        garmentEdgesIn: (lo: number[], hi: number[]) => {
          if (!garmentRoom) return null;
          const t = garmentRoom.tailored.sewn, at = new Map<number, [number, number, number]>();
          for (let v = 0; v < t.vertexParticle.length; v++) if (!at.has(t.vertexParticle[v])) at.set(t.vertexParticle[v], [t.vertexPiece[v], t.uv[v * 2], t.uv[v * 2 + 1]]);
          return garmentRoom.cloth.edgesIn(lo, hi).map((e) => ({ ...e, pa: at.get(e.a), pb: at.get(e.b) }));
        },
        garmentWorn: () => (garmentRoom ? { worn: garmentRoom.cloth.active, of: garmentRoom.tailored.sewn.count, tailoring: garmentTailoring, tailorKey: garmentRoom.tailorKey, committed: garmentCommitted, outfit: !!garmentAuto } : null),
        // per particle, where it is (world) and its least and most strain and sharpest fold: a probe's crease map
        garmentStrainMap: () => garmentRoom ? { positions: Array.from(garmentRoom.cloth.positions.subarray(0, garmentRoom.tailored.sewn.count * 3)), map: Array.from(garmentRoom.cloth.strainMap()), fit: Array.from(garmentRoom.cloth.fitMap()), piece: Array.from(garmentRoom.tailored.sewn.particlePiece), pieces: garmentRoom.tailored.sewn.pieces } : null,
        // where the underside of her belly starts to hang, and by where entirely (her normal's height; equal: never), cut again
        garmentHang: (from: number, to: number, offset?: number, smoothing?: number) => { if (!garmentRoom) return false; garmentRoom.cloth.hang = [from, to]; if (offset !== undefined) garmentRoom.cloth.fitOffset = offset; if (smoothing !== undefined) garmentRoom.cloth.fitSmoothing = smoothing; garmentRoom.cloth.setRestShift(restShiftNow()); garmentRoom.cloth.refit(); return true; },
        // for the particles inside a box (world), the nearest of her posed vertices against the contact the cloth is using:
        // a contact far further than her nearest skin is the wrong surface (a probe's look at skin showing through)
        garmentContacts: (lo: number[], hi: number[]) => {
          const body = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!garmentRoom || !body) return null;
          body.updateMatrixWorld(true);
          const x = garmentRoom.cloth.positions, P = body.geometry.getAttribute('position'), v = new THREE.Vector3(), pad = 4;
          const near: number[] = [];
          for (let i = 0; i < P.count; i++) {
            body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld);
            if (v.x < lo[0] - pad || v.x > hi[0] + pad || v.y < lo[1] - pad || v.y > hi[1] + pad || v.z < lo[2] - pad || v.z > hi[2] + pad) continue;
            near.push(v.x, v.y, v.z);
          }
          const out: { p: number; at: number[]; nearest: number; contact: number }[] = [];
          const report = garmentRoom.cloth.contactOf.bind(garmentRoom.cloth);
          for (let p = 0; p < garmentRoom.tailored.sewn.count; p++) {
            const px = x[p * 3], py = x[p * 3 + 1], pz = x[p * 3 + 2];
            if (px < lo[0] || px > hi[0] || py < lo[1] || py > hi[1] || pz < lo[2] || pz > hi[2]) continue;
            let best = Infinity;
            for (let k = 0; k < near.length; k += 3) best = Math.min(best, Math.hypot(near[k] - px, near[k + 1] - py, near[k + 2] - pz));
            out.push({ p, at: [px, py, pz], nearest: best, contact: report(p) });
          }
          return out;
        },
        garmentWire: (on: boolean) => { if (!garmentRoom) return false; (garmentRoom.cloth.mesh.material as THREE.MeshStandardMaterial).wireframe = on; return true; },
        // her particles now (world), and which piece each is of, for a probe drawing its own pictures
        garmentParticles: () => garmentRoom ? { positions: Array.from(garmentRoom.cloth.positions.subarray(0, garmentRoom.tailored.sewn.count * 3)), piece: Array.from(garmentRoom.tailored.sewn.particlePiece) } : null,
        animate: (secondsToRun: number, step = 1 / 60) => { const n = Math.max(0, Math.round(secondsToRun / step)); for (let k = 0; k < n; k++) advance(step); return cloth?.stats() ?? null; },
        tears: (limit = 2) => cloth?.tears(limit) ?? null,
        // seated, the cloth stays on (the fitted tee does not stand in): to watch the cloth itself seated
        standIn: (on: boolean) => { seatedStandIn = on; },
        // (there is no hook to hide her body: "Always keep the base body visible" -- Joshua, 2026-10-27; review shots
        // show the garment on her as it is worn)
        particles: () => cloth?.particles() ?? null,
        // her skin as she is posed and shaped now (world, every vertex), and its triangles: for a probe to measure her
        posedBody: () => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return null;
          b.updateMatrixWorld(true);
          const n = b.geometry.getAttribute('position').count, out = new Array<number>(n * 3), v = new THREE.Vector3();
          for (let i = 0; i < n; i++) { b.getVertexPosition(i, v); v.applyMatrix4(b.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
          return { position: out, index: Array.from(b.geometry.index?.array ?? []) };
        },
        // every mesh in her model, with whether it is drawn (for a probe hunting what shows through her skin)
        meshes: () => { const out: { name: string; material: string; visible: boolean; count: number }[] = []; model?.traverse((n) => { const m = n as THREE.Mesh; if (!m.isMesh) return; let v = true; for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) v = false; out.push({ name: m.name, material: (Array.isArray(m.material) ? m.material[0] : m.material).name, visible: v, count: m.geometry.getAttribute('position').count }); }); return out; },
        // ...and any of them hidden by name (a probe's question, until her look next changes)
        hideMesh: (name: string) => { let k = 0; model?.traverse((n) => { if ((n as THREE.Mesh).isMesh && (n.name === name || (Array.isArray((n as THREE.Mesh).material) ? false : ((n as THREE.Mesh).material as THREE.Material).name === name))) { n.visible = false; k++; } }); return k; },
        // her rest shape replaced by one given (body-local, every vertex, as `restBody` reads it: shape fields and morphs
        // included) and its normals, for a probe to try a correction on her: what the morphs add now is taken back off, so
        // drawn with them it is the shape given. Until her look next changes.
        setRest: (position: number[], normal: number[]) => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return false;
          const g = b.geometry, n = g.getAttribute('position').count;
          const P = new Float32Array(position), N = new Float32Array(normal), D = new Float32Array(n * 3);
          const dict = b.morphTargetDictionary ?? {}, infl = b.morphTargetInfluences ?? [], mp = g.morphAttributes.position ?? [], mn = g.morphAttributes.normal ?? [];
          for (const [, k] of Object.entries(dict)) {
            const w = infl[k] ?? 0, a = mp[k], c = mn[k]; if (!w) continue;
            for (let i = 0; i < n; i++) {
              if (a) { P[i * 3] -= w * a.getX(i); P[i * 3 + 1] -= w * a.getY(i); P[i * 3 + 2] -= w * a.getZ(i); }
              if (c) { D[i * 3] += w * c.getX(i); D[i * 3 + 1] += w * c.getY(i); D[i * 3 + 2] += w * c.getZ(i); }
            }
          }
          // the unit attribute that, with the morphs' normal offsets added, shades along the normal given (bodyCrease.ts)
          const u = [0, 0, 0];
          for (let i = 0; i < n; i++) {
            const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
            unitBefore(N[i * 3] / l, N[i * 3 + 1] / l, N[i * 3 + 2] / l, D[i * 3], D[i * 3 + 1], D[i * 3 + 2], u);
            N[i * 3] = u[0]; N[i * 3 + 1] = u[1]; N[i * 3 + 2] = u[2];
          }
          g.setAttribute('position', new THREE.BufferAttribute(P, 3));
          g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
          return true;
        },
        // her skin coloured per vertex (rgb 0..1, every vertex) with her maps off, or back as it was with null: a probe
        // showing on her where a measurement points
        paintSkin: (rgb: number[] | null) => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return false;
          if (rgb) b.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rgb), 3));
          for (const m of (Array.isArray(b.material) ? b.material : [b.material]) as THREE.MeshStandardMaterial[]) {
            const keep = (m.userData.probeMaps ??= { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap }) as { map: THREE.Texture | null; normalMap: THREE.Texture | null };
            m.vertexColors = !!rgb; m.map = rgb ? null : keep.map; m.normalMap = rgb ? null : keep.normalMap; m.needsUpdate = true;
          }
          return true;
        },
        // her crease's repair: still to come, and the last one worked out (what was found, what was left, how long)
        crease: () => ({ pending: creaseTimer !== 0 || crease.busy, where: crease.where, ms: crease.ms, prepareMs: crease.prepareMs, last: crease.last && { found: crease.last.found, left: crease.last.left, rounds: crease.last.rounds, moved: crease.last.moved, shaded: crease.last.shaded, most: crease.last.most, vertices: crease.last.vertices.length } }),
        // her crease's repair taken off and kept off (`on` false), or back to how the room does it
        creaseOff: (off: boolean) => { creaseDisabled = off; crease.enabled = !off; if (off) { crease.lift(); if (creaseTimer) { clearTimeout(creaseTimer); creaseTimer = 0; } } else applyLook(); return true; },
        // what of her skin is under a point of the screen (css px): the triangle's vertices, the point and how far
        pick: (x: number, y: number) => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return null;
          const { width, height } = ctx.renderer.size();
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), camera);
          const hit = ray.intersectObject(b, false)[0];
          return hit ? { face: hit.face ? [hit.face.a, hit.face.b, hit.face.c] : null, point: hit.point.toArray(), distance: hit.distance, normal: hit.face?.normal.toArray() ?? null } : null;
        },
        // her skin drawn as its normals (a probe seeing what the GPU shades with), or back as it was
        normalSkin: (on: boolean | 'plain' | 'clone') => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return false;
          const keep = (b.userData.probeMaterial ??= b.material) as THREE.Material | THREE.Material[];
          const unpatched = () => { const c = (Array.isArray(keep) ? keep[0] : keep).clone(); c.onBeforeCompile = () => {}; c.customProgramCacheKey = () => 'probe-unpatched'; return c; };
          b.material = on === 'clone' ? unpatched() : on === 'plain' ? new THREE.MeshStandardMaterial({ color: 0xd9cfc7, roughness: 0.55 }) : on ? new THREE.MeshNormalMaterial() : keep;
          return true;
        },
        // her skin drawn one-sided (true) or as the file has it (a probe asking whether a mark is a triangle seen from behind)
        frontSide: (on: boolean) => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return false;
          for (const m of (Array.isArray(b.material) ? b.material : [b.material])) { m.userData.probeSide ??= m.side; m.side = on ? THREE.FrontSide : m.userData.probeSide; m.needsUpdate = true; }
          return true;
        },
        // which patches her skin's material carries (its program cache key)
        skinKey: () => { const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover')); const m = b && (Array.isArray(b.material) ? b.material[0] : b.material); return m ? { key: m.customProgramCacheKey(), side: m.side, type: m.type, attrs: Object.keys(b.geometry.attributes) } : null; },
        // her shape worked out again from her controls (undoing a probe's setRest)
        relook: () => { crease.lift(); for (const s of shaped) s.fields.last = ''; applyLook(); },
        // her skin's maps switched off or back on (a probe telling a mark painted on her from one her shape draws)
        skinMaps: (map: boolean, normalMap: boolean, mr = true) => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return false;
          for (const m of (Array.isArray(b.material) ? b.material : [b.material]) as THREE.MeshStandardMaterial[]) {
            const keep = (m.userData.probeMaps ??= { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap }) as { map: THREE.Texture | null; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null; metalnessMap: THREE.Texture | null };
            m.map = map ? keep.map : null; m.normalMap = normalMap ? keep.normalMap : null;
            m.roughnessMap = mr ? keep.roughnessMap : null; m.metalnessMap = mr ? keep.metalnessMap : null; m.needsUpdate = true;
          }
          return true;
        },
        // ...and unposed (her rest shape with the shape fields and every morph as weighted now, body-local), with the
        // weights: the GPU's by name and the shape fields' (applied on the CPU)
        restBody: () => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          if (!b) return null;
          const g = b.geometry, p = g.getAttribute('position'), n = p.count, out = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { out[i * 3] = p.getX(i); out[i * 3 + 1] = p.getY(i); out[i * 3 + 2] = p.getZ(i); }
          const nr = g.getAttribute('normal'), nout = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { nout[i * 3] = nr.getX(i); nout[i * 3 + 1] = nr.getY(i); nout[i * 3 + 2] = nr.getZ(i); }
          const dict = b.morphTargetDictionary ?? {}, infl = b.morphTargetInfluences ?? [], mp = g.morphAttributes.position ?? [], mn = g.morphAttributes.normal ?? [];
          for (const [, k] of Object.entries(dict)) {
            const w = infl[k] ?? 0, a = mp[k], c = mn[k]; if (!w) continue;
            if (a) for (let i = 0; i < n; i++) { out[i * 3] += w * a.getX(i); out[i * 3 + 1] += w * a.getY(i); out[i * 3 + 2] += w * a.getZ(i); }
            if (c) for (let i = 0; i < n; i++) { nout[i * 3] += w * c.getX(i); nout[i * 3 + 1] += w * c.getY(i); nout[i * 3 + 2] += w * c.getZ(i); }
          }
          return { position: Array.from(out), normal: Array.from(nout), gpu: Object.fromEntries(Object.entries(dict).map(([name, k]) => [name, infl[k] ?? 0])), cpu: bodyShapeFieldWeights(body, bump, bellyCurve), relative: g.morphTargetsRelative };
        },
        strain: () => { if (!cloth) return null; const r = { ...cloth.strain(), jumps: cloth.jumps, moved: cloth.moved, worst: cloth.worstEdge }; cloth.moved = 0; return r; },
        // what shows through the tee now (her navel's height above the skin round it, the spots the shading draws)
        detail: () => (cloth ? { heights: cloth.detailHeights, keep: clothKeep(), spots: cloth.detail(clothKeep()) } : null),
        // the fitted tee's: her detail's heights, the tee's own navel over its smooth surface, and what is laid on it
        fitted: () => (fitted ? { heights: { navel: fitted.spots.navel.h, nipples: fitted.spots.nipples.map((d) => d.h) }, relief: fitted.navel.relief, fit: fitted.navel.last, keep: clothKeep(), state: fitted.spots.fitted(clothKeep(), fitted.navel), laid: fittedLaid } : null),
        // BREAST or NAVEL DETAIL set (null: AUTO), as the outfit editor's sliders do
        keep: (which: 'nipple' | 'navel', value: number | null) => fabric?.setDetail(which, value),
        restart: () => { cloth?.restart(); },
        // her skin's colour map swapped for another image (a URL), set up as the file's own was (sRGB, glTF's flipY): to
        // compare an enhanced skin on her before any file changes (Joshua, 2026-10-24); null puts the file's back
        skinMap: async (url: string | null) => {
          const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover'));
          const mat = b && (Array.isArray(b.material) ? b.material[0] : b.material) as THREE.MeshStandardMaterial;
          if (!mat) return null;
          const own = (mat.userData.ownMap ??= mat.map) as THREE.Texture | null;
          if (!url) { mat.map = own; mat.needsUpdate = true; return null; }
          const t = await new THREE.TextureLoader().loadAsync(url);
          if (own) { t.flipY = own.flipY; t.colorSpace = own.colorSpace; t.wrapS = own.wrapS; t.wrapT = own.wrapT; t.channel = own.channel; t.anisotropy = own.anisotropy; t.offset.copy(own.offset); t.repeat.copy(own.repeat); t.rotation = own.rotation; t.center.copy(own.center); t.matrixAutoUpdate = own.matrixAutoUpdate; t.matrix.copy(own.matrix); }
          mat.map = t; mat.needsUpdate = true;
          const im = t.image as { width: number; height: number };
          return [im.width, im.height];
        },
        // FACE's SKIN as the button sets it (a candidate's file fetched the first time), and what she wears now
        skinChoice: (id?: SkinId) => { if (id) { skinId = id; applySkin(); } return { chosen: skinId, worn: skinWorn, state: skinState, painted: !!painted, map: bodyOf()?.material.map?.name ?? null, size: (bodyOf()?.material.map?.image as { width?: number } | undefined)?.width ?? null }; },
        // a stroke of FACE's brush through screen points (CSS pixels), PAINT SKIN switched on for it; what changed
        skinStroke: async (points: readonly (readonly [number, number])[], set?: Partial<typeof brush>) => {
          skinPaintOn = true; Object.assign(brush, set ?? {});
          const p = await ensurePainter();
          if (!p || points.length === 0) return false;
          model?.updateMatrixWorld(true);
          const { width, height } = ctx.renderer.size();
          p.beginStroke(camera, width, height);
          let any = false;
          for (const [x, y] of points) any = p.stroke(x, y, brushSettings()) || any;
          p.endStroke(); refresh();
          return any;
        },
        skinUndo: () => painted?.painter.undo() ?? false,
        // FACE as its buttons set it, and the face's state now
        face: (set?: { hair?: boolean; on?: boolean; mode?: 'around' | 'camera' | 'ahead'; blinking?: boolean; talking?: boolean; mouth?: number; iris?: number; brows?: number; lips?: number }) => {
          if (set) {
            if (set.hair !== undefined) { hairOn = set.hair; for (const m of hairMeshes) m.visible = hairOn; }
            if (set.on !== undefined) faceOn = set.on;
            if (set.mode) faceMotion.mode = set.mode;
            if (set.blinking !== undefined) faceMotion.blinking = set.blinking;
            if (set.talking !== undefined) faceMotion.talking = set.talking;
            if (set.mouth !== undefined) faceMotion.mouth = set.mouth;
            if (set.iris !== undefined) irisIndex = set.iris;
            if (set.brows !== undefined) browPct = set.brows;
            if (set.lips !== undefined) lipPct = set.lips;
            refresh();
          }
          const b = bodyOf(); model?.updateMatrixWorld(true);
          // where the camera is in her head's rest frame (metres), and where the face's own probe point (her nose tip) lands in the world
          const cam = b ? restFromWorld(b.mesh, camera.position) : null;
          return { on: faceOn, laid: !!faceMaterial, mode: faceMotion.mode, jaw: faceMotion.jaw, blink: faceMotion.blink, gazeRight: [...faceMotion.gazeRight], gazeLeft: [...faceMotion.gazeLeft], cameraRest: cam, cameraWorld: camera.position.toArray() };
        },
        // every mesh drawn now (name, material, vertices): to tell what is what on screen
        drawn: () => { const out: string[] = []; three.traverseVisible((n) => { const m = n as THREE.Mesh; if (m.isMesh) out.push(`${m.name}|${(Array.isArray(m.material) ? m.material[0] : m.material).name}|${m.geometry.getAttribute('position')?.count}`); }); return out; },
        // the cloth's triangles folded over into her, and the particles they hold
        folds: (cos?: number) => cloth?.folds(cos) ?? null,
        // NECKLINE (-100 a turtleneck, 0 as made, 100 to under her bust) and its shape, as the slider and button set them
        neckline: (value: number, shape?: 'U' | 'V') => { neckline = value; if (shape) neckShape = shape; if (necklineInput) necklineInput.value = String(value); cloth?.setNeckline(neckline / 100, neckShape); cloth?.layOut(); refresh(); return cloth ? { particles: cloth.stats().particles, state: cloth.neckline(), deepestCm: cloth.necklineDeepest * 100 } : null; },
        /** SLEEVES as the button sets them (true the cap sleeves as made, false the tank), and what the cloth then trims. */
        sleeves: (on: boolean) => { sleeves = on; cloth?.setSleeves(sleeves); cloth?.layOut(); refresh(); return cloth ? { particles: cloth.stats().particles, trim: cloth.trim() } : null; },
        navelGap: (radius?: number) => { const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover')); return cloth && b ? cloth.navelGap(b, radius) : null; },
        // where the drawn sheet's hem hangs, each side of her (world units): to read a lopsided hang as a number
        hem: () => {
          if (!cloth) return null;
          const g = cloth.mesh.geometry, P = g.getAttribute('position').array as Float32Array, I = g.index!.array, end = Math.min(I.length, g.drawRange.count);
          let cx = 0, n = 0; for (let k = 0; k < end; k++) { cx += P[I[k] * 3]; n++; } cx /= Math.max(1, n);
          let left = Infinity, right = Infinity, front = Infinity, back = Infinity, cz = 0; for (let k = 0; k < end; k++) cz += P[I[k] * 3 + 2] / Math.max(1, n);
          for (let k = 0; k < end; k++) { const v = I[k] * 3, y = P[v + 1]; if (P[v] < cx) left = Math.min(left, y); else right = Math.min(right, y); if (P[v + 2] > cz) front = Math.min(front, y); else back = Math.min(back, y); }
          const r = (x: number) => Math.round(x * 10) / 10;
          return { left: r(left), right: r(right), front: r(front), back: r(back) };
        },
        tune: (t: Partial<ClothTune>) => { clothTune = { ...clothTune, ...t }; for (const [k, i] of clothDialInputs) i.value = String(clothTune[k as keyof ClothTune]); tuneCloth(); refresh(); },
        // her body hidden or shown, the cloth alone (her model's own visibility: the frame loop then leaves the cloth be)
        body: (on: boolean) => { if (model) model.visible = on; },
        // her skin alone undrawn (her clothes still drawn): to see a garment's own shape
        skin: (on: boolean) => { const b = skinned.find((m) => !!m.geometry.getAttribute('_cloth_cover')); for (const m of b ? (Array.isArray(b.material) ? b.material : [b.material]) : []) { m.colorWrite = on; m.depthWrite = on; } },
      };
    },

    update(frame: FrameInfo) {
      if (readyIn > 0 && --readyIn === 0 && readyBatch === batch) meter.ready();
      for (let k = frameWaiters.length - 1; k >= 0; k--) if (--frameWaiters[k].left <= 0) frameWaiters.splice(k, 1)[0].done();
      if (card) {
        const covered = `${Math.round(studio?.stage.bottom.getBoundingClientRect().height ?? 0) + 10}px`;
        if (card.element.style.getPropertyValue(LOADING_COVERED_VAR) !== covered) card.element.style.setProperty(LOADING_COVERED_VAR, covered);
        card.show(meter.snapshot(), cardPlace);
      }
      // her animation's own time: paused, slowed, or stepped one frame at a time (the builder's MOTION controls)
      const dt = clock.paused ? clock.step : frame.rawDt * clock.speed;
      clock.step = 0;
      if (turning) orbit.yaw += frame.rawDt * 0.35;
      placeCamera();
      frameMs += (frame.rawDt * 1000 - frameMs) / 20;
      advance(dt);
    },


    resize(width: number, height: number) {
      frame(width, height);
    },

    dispose() {
      disposed = true;
      if (creaseTimer) clearTimeout(creaseTimer);
      crease.dispose();
      dropPainter();
      skinFetched?.texture.dispose(); skinFetched = null;
      skinUpload?.texture.dispose(); skinUpload = null;
      for (const run of inflight.values()) run.abort.abort();
      inflight.clear();
      texturePanel?.dispose();
      texturePanel = null;
      fabric?.dispose();
      fabric = null;
      builder?.dispose();
      builder = null;
      dropCloth();
      garmentRoom?.dispose(); garmentRoom = null;
      garmentPanel?.dispose(); garmentPanel = null;
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
