import { garmentTexturePanel } from './garmentTexturePanel';
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
import { BODY_CONTROLS, controlLine, defaultBodyShape, resetControl, setControl, type BodyControl, type BodyShape } from '../actor/bodyShape';
import { applyShapeFields, liftShapeFields, type ShapeFields } from '../view/bodyShapeView';
import { HumanRig, findSkinnedMesh } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import {
  BELLY_MOTION, BELLY_TARGET, BREAST_TARGETS, BUMP_MAX_PERCENT, GARMENTS, OUTFITS, outfitLine, modelLine, refineLine, refineWeight, nextOutfit, wornGarments, coverMask, uncoveredSkinIndices, UNDER_TOP_GARMENT, BELLY_REFINE_TARGET, SEAT_TARGET, seatCorrectiveWeight, SARAH_LAB_MODELS, SARAH_LAB_DEFAULT_MODEL, SARAH_LAB_ACTION, SARAH_LAB_FIELD, SARAH_LAB_HUD_ROLE, SARAH_LAB_SCENE_ID,
  bellyMotionWeights, bellyWeights, breastBobWeight, breastWeightsForShape, bodyShapeFieldWeights, SIZE_TILT_PRESETS_DEG, effectiveTiltDeg, stepSeated, BREAST_GROW_TARGET, settledSitFor, bellyUpperWeight, BELLY_UPPER_TARGET, navelWeights, NAVEL_FLAT_TARGET, navelFlatWeight, tPoseTurns, ARM_SIDES, armsLine, ARM_RAISE_TARGETS, armRaiseWeight, SEAT_V2_TARGET, seatCorrectiveV2Weight, fingerBend, THUMB_TO_PALM, bumpLine, fingersLine, restingBellySpring, statusLine, stepBellySpring, stepBreastSpring, walkBounceAccel,
  type Garment, type SarahLabPose,
} from './sarahLabTool';

const M = UNITS_PER_METRE;
/** A walk on the spot, metres a second: an unhurried pace. */
const WALK_SPEED = 1.1;

export interface SarahLabHooks {
  onBack(): void;
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
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 4_000);

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
  let loaded = false;
  let failed = false;
  let disposed = false;

  let pose: SarahLabPose = 'stand';
  /** 0 standing, 1 fully seated: how far the thighs have taken over the bump's tilt (`effectiveTiltDeg`). */
  let seated = 0;
  let bump = 100;
  let curl = 0;
  // the ARMS slider: how far T-POSE raises the arms, and which (Joshua, 2026-10-15)
  let armsDeg = 90, armSide = 0;
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
  const orbit = { yaw: 0.5, pitch: 0.12, distance: 2.9 * M, target: new THREE.Vector3(0, 0.95 * M, 0) };
  function placeCamera(): void {
    const c = Math.cos(orbit.pitch);
    camera.position.set(
      orbit.target.x + orbit.distance * c * Math.sin(orbit.yaw),
      orbit.target.y + orbit.distance * Math.sin(orbit.pitch),
      orbit.target.z + orbit.distance * c * Math.cos(orbit.yaw),
    );
    camera.lookAt(orbit.target);
  }

  // ------------------------------------------------------------------ HUD
  let hud: HTMLElement | null = null;
  let texturePanel: ReturnType<typeof garmentTexturePanel> | null = null;
  const fields: Record<string, HTMLElement> = {};
  const buttons: Record<string, HTMLButtonElement> = {};
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  function refresh(): void {
    if (fields.status) fields.status.textContent = statusLine(loaded, failed, garments, hasBelly, modelIndex);
    const bumpField = fields[SARAH_LAB_FIELD.bump], fingerField = fields[SARAH_LAB_FIELD.fingers];
    if (bumpField) bumpField.textContent = bumpLine(bump);
    if (fingerField) fingerField.textContent = fingersLine(curl);
    const armsField = fields[SARAH_LAB_FIELD.arms];
    if (armsField) armsField.textContent = armsLine(armsDeg, ARM_SIDES[armSide]);
    if (buttons.armSide) buttons.armSide.textContent = `ARMS · ${ARM_SIDES[armSide]}`;
    for (const c of BODY_CONTROLS) {
      const line = fields[`${SARAH_LAB_FIELD.body}${c.key}`];
      // seated, the tilt in use is not the one chosen: say both, so a sitting body never reads as the slider's
      if (line) line.textContent = controlLine(c.key, body[c.key]) + (c.key === 'bellyTilt' && pose === 'sit' ? ` · seated ${effectiveTiltDeg(body.bellyTilt, 1).toFixed(1)}°` : '');
      const input = bodyInputs.get(c.key);
      if (input && Number(input.value) !== body[c.key]) input.value = String(body[c.key]);
    }
    if (fields[SARAH_LAB_FIELD.bodyNote]) fields[SARAH_LAB_FIELD.bodyNote].textContent = loaded && !shaped.length ? 'this model has no shape fields: TILT and SIZE work, the rest are in v2-body' : '';
    const lit = (b: HTMLButtonElement | undefined, on: boolean) => {
      if (!b) return;
      b.style.background = on ? 'rgba(212,168,83,0.92)' : 'rgba(16,20,26,0.72)';
      b.style.color = on ? '#15110a' : '#e8e2d8';
    };
    lit(buttons.stand, pose === 'stand');
    lit(buttons.walk, pose === 'walk');
    lit(buttons.sit, pose === 'sit');
    lit(buttons.tpose, pose === 'tpose');
    lit(buttons.turn, turning);
    for (const t of SIZE_TILT_PRESETS_DEG) lit(buttons[`tilt${t}`], body.bellyTilt === t);
    if (buttons.outfit) buttons.outfit.textContent = outfitLine(outfit);
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
    }
  }

  /** The raised-arm shapes, for whichever arms T-POSE has raised (named by the side of her each arm was modelled on). */
  function armRaiseWeights(): Record<string, number> {
    const out: Record<string, number> = { [ARM_RAISE_TARGETS.plusX]: 0, [ARM_RAISE_TARGETS.minusX]: 0 };
    if (pose !== 'tpose' || !rig || !measure) return out;
    const side = ARM_SIDES[armSide], w = armRaiseWeight(armsDeg);
    for (const [arm, on] of [[measure.joints.shoulderL, side !== 'right'], [measure.joints.shoulderR, side !== 'left']] as const) {
      if (!on) continue;
      out[(rig.bind[arm]?.x ?? 0) >= 0 ? ARM_RAISE_TARGETS.plusX : ARM_RAISE_TARGETS.minusX] = w;
    }
    return out;
  }

  function applyLook(): void {
    const fieldWeights = bodyShapeFieldWeights(body, bump);
    for (const { mesh, fields } of shaped) applyShapeFields(mesh, fields, fieldWeights);
    for (const mesh of skinned) {
      const dict = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
      if (dict && influences) for (const [name, w] of Object.entries({ ...bellyWeights(bump), ...breastWeightsForShape(bump, dict[BREAST_GROW_TARGET] !== undefined, body.breastSize), [BELLY_UPPER_TARGET]: bellyUpperWeight(bump), ...navelWeights(bump), [NAVEL_FLAT_TARGET]: navelFlatWeight(bump), [BELLY_REFINE_TARGET]: refineWeight(refine, bump), [SEAT_TARGET]: seatCorrectiveWeight(pose === 'sit' ? 1 : 0, bump), [SEAT_V2_TARGET]: seatCorrectiveV2Weight(pose === 'sit' ? 1 : 0, bump), ...armRaiseWeights() })) {
        const at = dict[name];
        if (at !== undefined) influences[at] = w;
      }
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name as Garment;
      if ((GARMENTS as readonly string[]).includes(name)) mesh.visible = shownNow(name);
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
      // the body: the skin the shown clothes cover is left out of the draw
      const cover = mesh.geometry.getAttribute('_cloth_cover');
      if (cover && mesh.geometry.index) {
        const all = (mesh.userData.allIndices ??= mesh.geometry.index.array.slice()) as ArrayLike<number>;
        const mask = coverMask(wornGarments(outfit, garments));
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

  function buildHud(): void {
    const root = document.createElement('div');
    root.dataset.role = SARAH_LAB_HUD_ROLE;
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
    poses.style.cssText = `${panel}left:max(12px,env(safe-area-inset-left));bottom:16px`;
    for (const [p, label, action] of [['stand', 'STAND', SARAH_LAB_ACTION.stand], ['walk', 'WALK', SARAH_LAB_ACTION.walk], ['sit', 'SIT', SARAH_LAB_ACTION.sit], ['tpose', 'T-POSE', SARAH_LAB_ACTION.tpose]] as const) {
      buttons[p] = btn(label, action, () => { pose = p; applyLook(); refresh(); });
      poses.appendChild(buttons[p]);
    }
    root.appendChild(poses);

    const right = document.createElement('div');
    right.style.cssText = `${panel}flex-direction:column;align-items:stretch;right:max(12px,env(safe-area-inset-right));top:12px;width:min(230px,40vw);padding:10px;border-radius:12px;background:rgba(10,13,18,0.66);border:1px solid rgba(255,255,255,0.1)`;
    const slider = (field: string, value: number, onInput: (v: number) => void, max = 100) => {
      const label = document.createElement('div');
      label.dataset.field = field;
      label.style.cssText = 'font-size:12px;letter-spacing:.05em';
      fields[field] = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = String(max);
      input.value = String(value);
      input.style.cssText = 'width:100%;accent-color:#d4a853;height:28px';
      input.addEventListener('input', () => { onInput(Number(input.value)); applyLook(); refresh(); });
      right.append(label, input);
    };
    slider(SARAH_LAB_FIELD.bump, bump, (v) => { bump = v; }, BUMP_MAX_PERCENT);
    slider(SARAH_LAB_FIELD.fingers, curl, (v) => { curl = v; });
    slider(SARAH_LAB_FIELD.arms, armsDeg, (v) => { armsDeg = v; }, 90);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    buttons.outfit = btn(outfitLine(outfit), SARAH_LAB_ACTION.outfit, () => { outfit = nextOutfit(outfit, garments); applyLook(); });
    buttons.model = btn(modelLine(modelIndex), SARAH_LAB_ACTION.model, () => { modelIndex = (modelIndex + 1) % SARAH_LAB_MODELS.length; loadSarah(); });
    buttons.refine = btn(refineLine(refine), SARAH_LAB_ACTION.refine, () => { refine = !refine; applyLook(); refresh(); });
    buttons.armSide = btn('ARMS · both', SARAH_LAB_ACTION.armSide, () => { armSide = (armSide + 1) % ARM_SIDES.length; applyLook(); refresh(); });
    buttons.turn = btn('TURN', SARAH_LAB_ACTION.turn, () => { turning = !turning; });
    // a nudge up, as a hop would: the bump lags, drops and settles
    buttons.bounce = btn('BOUNCE', SARAH_LAB_ACTION.bounce, () => { spring.vy += 0.3; breastSpring.vy += 0.3; });
    for (const b of [buttons.model, buttons.refine, buttons.outfit, buttons.armSide, buttons.turn, buttons.bounce]) { b.style.padding = '8px 10px'; b.style.fontSize = '12px'; row.appendChild(b); }
    right.appendChild(row);
    // BELLY SHAPE and BREAST SHAPE: each control a slider with its own reset, relative to the size shown
    const setBody = (next: BodyShape) => { body = next; applyLook(); applyMotion(); refresh(); };
    for (const [group, title] of [['belly', 'BELLY SHAPE'], ['breasts', 'BREAST SHAPE']] as const) {
      const box = document.createElement('details');
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
        line.append(label, reset);
        const input = document.createElement('input');
        input.type = 'range'; input.min = String(c.min); input.max = String(c.max); input.step = String(c.step); input.value = String(body[c.key]);
        input.style.cssText = 'width:100%;accent-color:#d4a853;height:24px';
        input.addEventListener('input', () => setBody(setControl(body, c.key, Number(input.value))));
        bodyInputs.set(c.key, input);
        box.append(line, input);
      }
      if (group === 'breasts') {
        const all = btn('RESET ALL SHAPE', SARAH_LAB_ACTION.bodyResetAll, () => setBody(defaultBodyShape()));
        all.style.padding = '6px 8px'; all.style.fontSize = '11px'; all.style.marginTop = '6px';
        box.appendChild(all);
      }
      right.appendChild(box);
    }
    const note = document.createElement('div');
    note.dataset.field = SARAH_LAB_FIELD.bodyNote;
    note.style.cssText = 'font-size:10px;opacity:.7';
    fields[SARAH_LAB_FIELD.bodyNote] = note;
    right.appendChild(note);
    right.style.maxHeight = 'calc(100% - 85px)';
    right.style.overflowY = 'auto';
    right.style.touchAction = 'pan-y';
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) right.addEventListener(event, e => e.stopPropagation());
    texturePanel = garmentTexturePanel(() => skinned, (garment) => {
      const next = OUTFITS.findIndex(look => look.garments.includes(garment));
      if (next >= 0) outfit = next;
      applyLook(); refresh();
    });
    right.appendChild(texturePanel.element);
    root.appendChild(right);

    const info = document.createElement('div');
    info.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;text-shadow:0 1px 3px #000;opacity:.92;pointer-events:none;max-width:40vw';
    const title = document.createElement('div');
    title.textContent = 'Sarah Lab · dev';
    title.style.cssText = 'font:700 14px Georgia,serif;letter-spacing:.04em';
    fields.status = document.createElement('div');
    fields.status.dataset.field = SARAH_LAB_FIELD.status;
    fields.status.style.cssText = 'font-weight:400;font-size:11px;opacity:.8';
    info.append(title, fields.status);
    root.appendChild(info);
    ctx.uiLayer.appendChild(root);
    hud = root;
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
    // The master bind pose holds both arms out, exposing the shirt's sides.
    if (pose === 'tpose') {
      // every turn undone back to the modelled pose, then the chosen arms raised by the
      // ARMS slider toward level (v2 is modelled arms-down; v1's are already level)
      const j = measure.joints, f = armsDeg / 90, side = ARM_SIDES[armSide];
      base = [...base.map(turn => ({ ...turn, radians: 0 })), ...tPoseTurns(rig.bind, [
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
    felt.primed = 0; loaded = false; failed = false;
    refresh();
    const path = SARAH_LAB_MODELS[modelIndex].path;
    void assets.loadModel(path, () => new THREE.Object3D()).then((loadedModel) => {
      if (disposed || path !== SARAH_LAB_MODELS[modelIndex].path) { release(loadedModel); return; }
      if (loadedModel.userData.isPlaceholder === true) { failed = true; refresh(); return; }
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
        if ((GARMENTS as readonly string[]).includes(name)) found.add(name as Garment);

      });
      garments = GARMENTS.filter((g) => found.has(g));
      model = loadedModel;
      three.add(loadedModel);
      // the spring feels a point at the front of her middle, carried by her spine
      const skinMesh = findSkinnedMesh(loadedModel);
      if (skinMesh && measure) {
        loadedModel.updateMatrixWorld(true);
        const bone = skinMesh.skeleton.bones[measure.joints.spine];
        if (bone) feel = { bone, local: bone.worldToLocal(new THREE.Vector3(0, 1.0 * M, 0.2 * M)) };
      }
      loaded = true;
      applyLook();
      refresh();
    });
  }

  return {
    name: SARAH_LAB_SCENE_ID,
    three,
    camera,

    async enter() {
      const size = ctx.renderer.size();
      camera.aspect = size.width / Math.max(1, size.height);
      camera.updateProjectionMatrix();
      placeCamera();
      buildHud();
      loadSarah();
    },

    update(frame: FrameInfo) {
      seconds += frame.rawDt;
      if (pose === 'walk') walked += WALK_SPEED * frame.rawDt;
      if (turning) orbit.yaw += frame.rawDt * 0.35;
      placeCamera();
      if (rig) rig.apply(turnsFor());
      place();
      feelMotion(frame.rawDt);
    },

    resize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    dispose() {
      disposed = true;
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
