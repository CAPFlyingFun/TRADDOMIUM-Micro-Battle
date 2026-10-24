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
import { setClothDetail } from './clothDetail';
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
import { assets, assetUrl } from '../assets/assets';
import { release } from '../tombs/LabPeople';
import { BODY_CONTROLS, BREAST_DIMENSIONS, clampShape, controlLine, defaultBodyShape, parseShape, resetControl, serializeShape, setControl, setLinkedControl, type BodyControl, type BodyShape } from '../actor/bodyShape';
import { applyShapeFields, liftShapeFields, type ShapeFields } from '../view/bodyShapeView';
import { dropIdleMorphs } from '../view/morphPrune';
import { HumanRig, findSkinnedMesh } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import {
  BELLY_MOTION, BELLY_TARGET, trimShown, BREAST_TARGETS, BUMP_MAX_PERCENT, GARMENTS, RECOVERED_SHIRTS, OUTFITS, outfitLine, modelLine, refineLine, refineWeight, nextOutfit, wornGarments, coverMask, bodyNeverHidden, uncoveredSkinIndices, UNDER_TOP_GARMENT, BELLY_REFINE_TARGET, SEAT_TARGET, seatCorrectiveWeight, SARAH_LAB_MODELS, SARAH_LAB_DEFAULT_MODEL, SARAH_LAB_ACTION, SARAH_LAB_FIELD, SARAH_LAB_HUD_ROLE, SARAH_LAB_SCENE_ID, shirtLengthLine, sarahModelPath, BODY_RANDOM_SPECS, CLOTH_SHIRT_PATH, teeLengthLine, clothLine, CLOTH_DIALS, CLOTH_TUNE_DEFAULT, CLOTH_TEE_LENGTH_DEFAULT, clothTuning, type ClothTune,
  bellyMotionWeights, bellyWeights, breastBobWeight, breastWeightsForShape, bodyShapeFieldWeights, SIZE_TILT_PRESETS_DEG, effectiveTiltDeg, stepSeated, bustVolume, BREAST_GROW_TARGET, settledSitFor, bellyUpperWeight, BELLY_UPPER_TARGET, navelWeights, NAVEL_FLAT_TARGET, navelFlatWeight, tPoseTurns, ARM_SIDES, armsLine, ARM_RAISE_TARGETS, armRaiseWeight, SEAT_V2_TARGET, seatCorrectiveV2Weight, fingerBend, THUMB_TO_PALM, bumpLine, fingersLine, restingBellySpring, statusLine, stepBellySpring, stepBreastSpring, walkBounceAccel,
  offeredOutfits, outfitThumbPath,
  type Garment, type SarahLabPose, recoveredPartsFor, recoveredPartPath, isShirtPart, shirtOfPart, type RecoveredPart, SARAH_DEFAULT_OUTFIT, RECOVERED_GARMENTS,
} from './sarahLabTool';

const M = UNITS_PER_METRE;
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
  // she opens in her red light spandex tee over painted leggings (Joshua, 2026-10-23), one small file; a model without
  // the v2 clothes (v1) falls back to the first modelled outfit it has as it loads
  let outfit = SARAH_DEFAULT_OUTFIT;
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
  // RANDOMIZE's ranges and locks (`actor/bodyRandom.ts`; Joshua, 2026-10-22), saved with her body
  let randomRules: RandomRules = NO_RULES;
  let rangesShown = false;
  const lockButtons = new Map<string, HTMLButtonElement>();
  const rangeRows: { spec: RandomSpec; row: HTMLElement; lo: HTMLInputElement; hi: HTMLInputElement }[] = [];
  let bumpInput: HTMLInputElement | null = null;
  // the library outfit she last put on (her changes to it save as hers), and saved clothes waiting for their outfit to load
  let wornFrom: string | null = null;
  let pendingClothes: Omit<SavedClothes, 'outfit'> | null = null;
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
  /**
   * THE BELLY CURVE (`bellyInterpolation.ts`): HYBRID by default (Joshua, 2026-10-22: "change the default as hybrid,
   * but make the current as a backup"); CURRENT, the approved slider, stays one tap away. For this session only.
   */
  let bellyCurve: BellyCurve = DEFAULT_BELLY_CURVE;
  const fields: Record<string, HTMLElement> = {};
  const buttons: Record<string, HTMLButtonElement> = {};
  let armsInput: HTMLInputElement | null = null;
  let shirtLengthInput: HTMLInputElement | null = null;
  /**
   * THE CLOTH EXPERIMENT (Joshua, 2026-10-23: "make that one a true soft body/cloth with simulation over the whole
   * thing... I want to be able to see how much or little having a full soft body cloth fabric would be"): the light tee
   * as one simulated sheet (clothShirt.ts), on while CLOTH SIM is, its length from the tee as made to mid-thigh, and what
   * it costs each frame on the stage. Fetched the first time it is turned on.
   */
  let cloth: ClothShirt | null = null, clothOn = false, clothLoading = false, clothRestart = false, clothRefit = false, teeLength = CLOTH_TEE_LENGTH_DEFAULT, frameMs = 1000 / 60;
  let teeLengthInput: HTMLInputElement | null = null;
  /** The cloth's dials (CLOTH_DIALS), kept across a reload of the cloth, and their sliders. */
  let clothTune: ClothTune = CLOTH_TUNE_DEFAULT;
  /** Her shape the cloth was last cut for. */
  let clothShapeKey = '';
  const clothDialInputs = new Map<string, HTMLInputElement>();
  /** Put the dials on the cloth, live. */
  function tuneCloth(): void {
    if (!cloth) return;
    const { settings, standOff } = clothTuning(clothTune);
    Object.assign(cloth.simSettings, settings);
    cloth.standOff = standOff;
  }
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

  function refresh(): void {
    if (fields.status) fields.status.textContent = statusLine(loaded && model?.visible === true, failed, garments, hasBelly, modelIndex) + (hooks.skin === 'ktx2' ? ' · KTX2 skin' : '') + (wantedOutfit !== null ? ' · loading outfit…' : '');
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
    for (const group of ['belly', 'breasts'] as const) {
      const b = buttons[`groupLock-${group}`];
      if (b) b.textContent = `${group === 'belly' ? 'BELLY' : 'BREAST'} ${randomRules.groups.includes(group) ? '🔒' : '🔓'}`;
    }
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
      if (line) line.textContent = controlLine(c.key, body[c.key]) + (c.key === 'bellyTilt' && pose === 'sit' ? ` · seated ${effectiveTiltDeg(body.bellyTilt, 1).toFixed(1)}°` : '') + (c.key === 'breastSize' ? ` · bust ${bustVolume(bump, body.breastSize).toFixed(2)}×` : '');
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
      const lite = recovered && shownNow('shirtSpandexLite');
      if (buttons.cloth) { buttons.cloth.style.display = lite ? '' : 'none'; buttons.cloth.textContent = clothLoading ? 'CLOTH SIM · loading…' : `CLOTH SIM · ${clothOn ? 'ON' : 'OFF'} (experiment)`; lit(buttons.cloth, clothOn); }
      const teeField = fields[SARAH_LAB_FIELD.teeLength];
      if (teeField) { teeField.textContent = teeLengthLine(teeLength, clothOn); teeField.style.display = lite ? '' : 'none'; }
      if (teeLengthInput) { teeLengthInput.style.display = lite ? '' : 'none'; teeLengthInput.disabled = !clothOn; }
      if (fields.cloth) fields.cloth.style.display = clothOn && cloth ? '' : 'none';
      for (const d of CLOTH_DIALS) {
        const f = fields[`${SARAH_LAB_FIELD.clothDial}${d.key}`], i = clothDialInputs.get(d.key);
        if (f) { f.textContent = d.line(clothTune[d.key]); f.style.display = lite && clothOn ? '' : 'none'; }
        if (i) i.style.display = lite && clothOn ? '' : 'none';
      }
      if (buttons.clothReset?.parentElement) buttons.clothReset.parentElement.style.display = lite && clothOn ? 'flex' : 'none';
    }
    for (const k of BREAST_DIMENSIONS) lit(buttons[`link-${k}`], linked.has(k));
    if (buttons.linkAll) { const all = BREAST_DIMENSIONS.every((k) => linked.has(k)); buttons.linkAll.textContent = all ? 'UNLINK W·H·D' : 'LINK W·H·D'; lit(buttons.linkAll, all); }
    lit(buttons.stand, pose === 'stand');
    lit(buttons.walk, pose === 'walk');
    lit(buttons.sit, pose === 'sit');
    lit(buttons.tpose, pose === 'tpose');
    lit(buttons.ranges, rangesShown);
    lit(buttons['groupLock-belly'], randomRules.groups.includes('belly'));
    lit(buttons['groupLock-breasts'], randomRules.groups.includes('breasts'));
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
    const fieldWeights = bodyShapeFieldWeights(body, bump, bellyCurve);
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
      if (dict && influences) for (const [name, w] of Object.entries({ ...bellyWeights(bump, bellyCurve), ...breastWeightsForShape(bump, dict[BREAST_GROW_TARGET] !== undefined, body.breastSize), [BELLY_UPPER_TARGET]: bellyUpperWeight(bump, bellyCurve), ...navelWeights(bump), [NAVEL_FLAT_TARGET]: Math.max(navelFlatWeight(bump), fabric?.navelFlatten() ?? 0, clothFlatten()), [BELLY_REFINE_TARGET]: refineWeight(refine, bump), [SEAT_TARGET]: seatCorrectiveWeight(pose === 'sit' ? 1 : 0, bump), [SEAT_V2_TARGET]: seatCorrectiveV2Weight(pose === 'sit' ? 1 : 0, bump), ...armRaiseWeights() })) {
        const at = dict[name];
        if (at !== undefined) influences[at] = w;
      }
      applyRecoveredBaseline(mesh, bump);
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name as Garment;
      if (([...GARMENTS, ...RECOVERED_SHIRTS] as readonly string[]).includes(name)) mesh.visible = shownNow(name);
      { const t = trimShown(name, wornGarments(outfit, garments)); if (t !== null) mesh.visible = t; }
      if (mesh.userData.replacedByRecovered) mesh.visible = false;
      // the cloth experiment draws the light tee as cloth: the fitted one stands aside (and keeps its fabric on)
      if (clothOn && cloth && name === 'shirtSpandexLite') mesh.visible = false;
      if (cloth && name === 'shirtSpandexLite') cloth.mesh.visible = clothOn && shownNow('shirtSpandexLite') && garmentView === 'all';
      // painting onto her body: "don't show any clothing since you would be painting over the body"; a garment
      // ISOLATED in the editor shows on its own (its trim with it)
      if (garmentView !== 'all' && !mesh.geometry.getAttribute('_cloth_cover')) {
        const own = name.endsWith('Trim') ? name.slice(0, -4) : name;
        if (garmentView === 'none' || own !== garmentView) mesh.visible = false;
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
        const mask = garmentView !== 'all' || bodyNeverHidden(SARAH_LAB_MODELS[modelIndex].id) ? 0 : coverMask(wornGarments(outfit, garments));
        if (mesh.userData.coverMask !== mask) {
          mesh.userData.coverMask = mask;
          // read through getX: the file stores the bits with a stride (vertex data is 4-byte
          // aligned), so the raw array is not one entry a vertex
          const bits = (mesh.userData.coverBits ??= Uint8Array.from({ length: cover.count }, (_, i) => cover.getX(i))) as Uint8Array;
          mesh.geometry.setIndex(new THREE.BufferAttribute(mask ? uncoveredSkinIndices(all, bits, mask) : Uint32Array.from(all), 1));
        }
      }
    }
    fabric?.sync();
    // her shape may have changed: the cleavage bridge chooses its ends again
    fabric?.reshaped();
    // and the cloth tee is cut again for her shape (never for her pose) -- on the cloth's next frame, once her belly's
    // motion shapes have followed the new size too. A quick size changes her in two steps (the size here, those shapes
    // in the frame's feelMotion), and a tee cut at once, for the first, and laid on the second ballooned out in front of
    // her and creased as it fell (Joshua, 2026-10-24: "it's possible it's something else")
    const shapeKey = `${bump}|${serializeShape(body)}|${bellyCurve}|${refine}`;
    if (cloth && shapeKey !== clothShapeKey) { clothShapeKey = shapeKey; clothRefit = true; }
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
        if (p === 'spandex-lite') dropCloth();
        releaseRecoveredMeshes(old); partMeshes.delete(p);
      }
    }
    const meshes = attachRecoveredMeshes(scene, skin, isShirtPart(part) ? shirtOfPart(part) : undefined);
    for (const mesh of meshes) {
      if (part.startsWith('leggings')) mesh.userData.recoveredLeggings = true;
      skinned.push(mesh);
      const fields = liftShapeFields(mesh);
      if (fields) shaped.push({ mesh, fields });
      dropIdleMorphs(mesh);
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
    // saved clothes put on with this outfit go on over its defaults
    if (pendingClothes && fabric?.putOnClothes(pendingClothes)) { builder?.load(pendingClothes.built ?? null); pendingClothes = null; }
    // what she has on now is what the editor's SAVE compares against
    if (fabric && !pendingClothes) { outfits?.editing(nextSource ?? { kind: 'builtin', name: OUTFITS[outfit].name }); nextSource = null; }
  }
  /** What she wears now, as a save holds it: the outfit, the editor's paint and fabrics, and any built pieces. */
  function currentClothes(): SavedClothes {
    const built = builder?.built() ?? null;
    return { outfit: OUTFITS[outfit].name, ...(fabric?.clothes() ?? { shirtLength: DEFAULT_SHIRT_LENGTH, layers: [], garments: {} }), ...(built ? { built } : {}) };
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
    if (!clothOn && cloth) setClothDetail(cloth.mesh.material as THREE.Material, null);
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
      cloth.setLength(teeLength);
      cloth.mesh.visible = clothOn;
      three.add(cloth.mesh);
      meter.ready();
    } catch (error) {
      console.error('[sarahlab] the cloth tee could not be laid on her', error);
      clothOn = false;
      meter.fail('The cloth tee could not be downloaded. Check your connection, then tap CLOTH SIM again.');
    } finally { clothLoading = false; applyLook(); refresh(); fabric?.refreshTargets(); }
  }
  /** The cloth goes with the light tee it is a copy of (its material is the tee's). */
  function dropCloth(): void {
    if (cloth) setClothDetail(cloth.mesh.material as THREE.Material, null);
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
  /** Under the cloth tee her navel is softened the way paint softens it: toward flat by what NAVEL DETAIL hides. */
  let clothFlattenLaid = 0;
  function clothFlatten(): number {
    clothFlattenLaid = clothOn && cloth ? 1 - clothKeep().navel : 0;
    return clothFlattenLaid;
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
      // painting her body: one finger is the brush, a second takes over as turn and zoom
      if (fabric?.tool()) { if (pointers.size === 1) fabric.strokeStart(e.clientX, e.clientY); else fabric.strokeEnd(); }
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
      }
    });
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; fabric?.strokeEnd(); builder?.pointerUp(); };
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
        pose = p;
        // a pose switch moves her at once: the cloth starts again from her body rather than being flung
        clothRestart = true;
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
    buttons.cloth = btn('CLOTH SIM · OFF', SARAH_LAB_ACTION.cloth, () => { void toggleCloth(); });
    buttons.cloth.dataset.tab = 'outfit';
    right.appendChild(buttons.cloth);
    teeLengthInput = slider(SARAH_LAB_FIELD.teeLength, Math.round(CLOTH_TEE_LENGTH_DEFAULT * 100), (v) => { teeLength = v / 100; cloth?.setLength(teeLength); }, 100, 'outfit');
    // ...and its dials, live (Joshua, 2026-10-24: "Could potentially even add sliders to play with values in real time")
    for (const d of CLOTH_DIALS) clothDialInputs.set(d.key, slider(`${SARAH_LAB_FIELD.clothDial}${d.key}`, clothTune[d.key], (v) => { clothTune = { ...clothTune, [d.key]: v }; tuneCloth(); }, 100, 'outfit'));
    {
      const r = document.createElement('div'); r.dataset.tab = 'outfit'; r.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      buttons.clothReset = btn('LAY CLOTH AGAIN', SARAH_LAB_ACTION.clothReset, () => { clothRestart = true; });
      buttons.clothDefaults = btn('CLOTH DEFAULTS', SARAH_LAB_ACTION.clothDefaults, () => { clothTune = CLOTH_TUNE_DEFAULT; for (const [k, i] of clothDialInputs) i.value = String(clothTune[k as keyof ClothTune]); tuneCloth(); clothRestart = true; });
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
    buttons.bounce = btn('BOUNCE', SARAH_LAB_ACTION.bounce, () => { spring.vy += 0.3; breastSpring.vy += 0.3; });
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
      for (const [group, label] of [['belly', 'BELLY'], ['breasts', 'BREAST']] as const) {
        buttons[`groupLock-${group}`] = btn(`${label} 🔓`, `${SARAH_LAB_ACTION.randomGroupLock}${group}`, () => { randomRules = withGroupLock(randomRules, group, !randomRules.groups.includes(group)); refresh(); });
      }
      buttons.ranges = btn('RANGES', SARAH_LAB_ACTION.randomRanges, () => { rangesShown = !rangesShown; refresh(); });
      for (const b of [buttons.randomize, buttons['groupLock-belly'], buttons['groupLock-breasts'], buttons.ranges]) { b.style.padding = '8px 10px'; b.style.fontSize = '12px'; row.appendChild(b); }
      right.appendChild(row);
    }
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
      // the CLOTH SIM tee lies over her nipples and navel: it counts for AUTO's detail
      clothOver: () => (clothOn && cloth ? { name: 'shirtSpandexLite', label: 'cloth tee' } : null),
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
    eyebrow.textContent = 'CHARACTER STUDIO';
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
    dropCloth();
    if (model) { three.remove(model); rig?.dispose(); release(model); model = null; }
    rig = null; measure = null; fingers = []; skinned = []; shaped = []; garments = []; hasBelly = false; feel = null;
    recovered = false; partMeshes.clear(); wantedOutfit = null; outfitRequest++;
    for (const run of inflight.values()) run.abort.abort();
    inflight.clear();
    felt.primed = 0; loaded = false; failed = false;
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
        // shapes that move nothing on this part are not sent to the GPU (morphPrune.ts)
        dropIdleMorphs(mesh);
        if (mesh.morphTargetDictionary?.[BELLY_TARGET] !== undefined) hasBelly = true;
        const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
        if (([...GARMENTS, ...RECOVERED_SHIRTS] as readonly string[]).includes(name)) found.add(name as Garment);

      });
      // on the approved v2 body every garment with its own file is on hand (the slim body file no longer carries the
      // leggings it replaced)
      garments = [...GARMENTS, ...RECOVERED_SHIRTS].filter((g) => found.has(g) || (recovered && RECOVERED_GARMENTS.includes(g)));
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

  /** One frame of her: her walk, her pose, her springs, what is laid on her, and the cloth tee over her. */
  function advance(dt: number): void {
      seconds += dt;
      if (pose === 'walk') walked += WALK_SPEED * dt;
      if (rig) rig.apply(turnsFor());
      place();
      feelMotion(dt);
      // a painted top's cleavage bridge is laid where her breasts are this frame
      if (fabric && model) { model.updateMatrixWorld(true); fabric.frame(); }
      // and every built strap laid on her skin as she is this frame
      if (builder && model) builder.frame();
      // and the cloth tee, moved over her as she is this frame (its cost on the stage)
      if (cloth && clothOn && cloth.mesh.visible && model?.visible && !clothLoading) {
        model.updateMatrixWorld(true);
        if (clothRefit) { cloth.refit(); clothRefit = false; }
        if (clothRestart) { cloth.restart(); clothRestart = false; }
        cloth.frame(dt);
        // her navel and nipples through it, at the editor's BREAST and NAVEL DETAIL; her navel softened under it to match
        const keep = clothKeep();
        cloth.keep = keep;
        setClothDetail(cloth.mesh.material as THREE.Material, cloth.detail(keep));
        if (Math.abs(1 - keep.navel - clothFlattenLaid) > 1e-3) applyLook();
        if (fields.cloth) fields.cloth.textContent = clothLine(cloth.stats(), frameMs);
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
      // ?probe=cloth: run the cloth tee N frames at a fixed step between pictures (a software renderer draws ~1 a second)
      if (new URLSearchParams(globalThis.location?.search ?? '').get('probe') === 'cloth') (globalThis as unknown as Record<string, unknown>).__sarahLabCloth = {
        settle: (frames: number, dt = 1 / 60) => { if (!cloth || !model) return null; for (let k = 0; k < frames; k++) { model.updateMatrixWorld(true); if (clothRefit) { cloth.refit(); clothRefit = false; } cloth.frame(dt); } return cloth.stats(); },
        settings: () => cloth?.simSettings ?? null,
        // her own frame run `seconds` at a fixed step -- walk, springs, the cloth -- between pictures (a software renderer
        // draws about one frame a second, so the room's own clock cannot show her moving)
        // the room's own clock held (its frames then move nothing), so only animate() moves her: a software renderer's
        // second-long frames are no measure of her motion
        hold: (on: boolean) => { clock.paused = on; clock.step = 0; },
        // the camera at any angle about her (yaw radians, 0 her front; pitch radians, below 0 from beneath)
        look: (yaw: number, pitch?: number) => { orbit.yaw = yaw; if (pitch !== undefined) orbit.pitch = pitch; turning = false; },
        animate: (secondsToRun: number, step = 1 / 60) => { const n = Math.max(0, Math.round(secondsToRun / step)); for (let k = 0; k < n; k++) advance(step); return cloth?.stats() ?? null; },
        strain: () => { if (!cloth) return null; const r = { ...cloth.strain(), jumps: cloth.jumps, moved: cloth.moved }; cloth.moved = 0; return r; },
        // what shows through the tee now (her navel's height above the skin round it, the spots the shading draws)
        detail: () => (cloth ? { heights: cloth.detailHeights, keep: clothKeep(), spots: cloth.detail(clothKeep()) } : null),
        // BREAST or NAVEL DETAIL set (null: AUTO), as the outfit editor's sliders do
        keep: (which: 'nipple' | 'navel', value: number | null) => fabric?.setDetail(which, value),
        restart: () => { cloth?.restart(); },
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
      for (const run of inflight.values()) run.abort.abort();
      inflight.clear();
      texturePanel?.dispose();
      texturePanel = null;
      fabric?.dispose();
      fabric = null;
      builder?.dispose();
      builder = null;
      dropCloth();
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
