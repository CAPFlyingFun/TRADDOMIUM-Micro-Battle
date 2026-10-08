/**
 * THE SARAH LAB — Sarah rebuilt from Joshua's base mannequin, on a turntable,
 * to try before anything of it goes live (Joshua, 2026-10-07: "Good to test
 * Sarah maybe in a separate link in like a Dev menu I can play around with
 * before placing live").
 *
 * A DEV TOOL scene (ARCHITECTURE §8), the Story Lab's shape: no session, a
 * BACK control, one model. What it shows is what the bake put in the file:
 *
 *   BUMP      the `belly` morph target (`scripts/bellyMorph.mjs`): 100% is
 *             the master as modelled, 0% nearly flat. Every primitive that
 *             carries the target follows it, so the clothes grown from her
 *             body shrink with it.
 *   FINGERS   all ten curled together, toward the palm: the master's own
 *             finger chains, found from the bind pose, never by name.
 *   SHIRT, LEGGINGS   the garments (`scripts/growClothes.mjs`), by material.
 *   STAND, WALK, SIT  the game's own poses: `poseHuman` and the pregnant sit.
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
import { HumanRig, findSkinnedMesh } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import {
  BELLY_TARGET, GARMENTS, SARAH_BASE_MODEL, SARAH_LAB_ACTION, SARAH_LAB_FIELD, SARAH_LAB_HUD_ROLE, SARAH_LAB_SCENE_ID,
  bellyWeight, bumpLine, fingersLine, statusLine, type Garment, type SarahLabPose,
} from './sarahLabTool';

const M = UNITS_PER_METRE;
/** A walk on the spot, metres a second: an unhurried pace. */
const WALK_SPEED = 1.1;
/** A full fist, per finger joint. */
const FIST = (80 * Math.PI) / 180;

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
      const axis = new THREE.Vector3().crossVectors(dir, palm).normalize();
      out.push({ joints, axis, thumb: i === thumbIndex });
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
  let bump = 100;
  let curl = 0;
  const shown: Record<Garment, boolean> = { shirt: true, leggings: true };
  let turning = false;
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
  const fields: Record<string, HTMLElement> = {};
  const buttons: Record<string, HTMLButtonElement> = {};
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  function refresh(): void {
    if (fields.status) fields.status.textContent = statusLine(loaded, failed, garments, hasBelly);
    const bumpField = fields[SARAH_LAB_FIELD.bump], fingerField = fields[SARAH_LAB_FIELD.fingers];
    if (bumpField) bumpField.textContent = bumpLine(bump);
    if (fingerField) fingerField.textContent = fingersLine(curl);
    const lit = (b: HTMLButtonElement | undefined, on: boolean) => {
      if (!b) return;
      b.style.background = on ? 'rgba(212,168,83,0.92)' : 'rgba(16,20,26,0.72)';
      b.style.color = on ? '#15110a' : '#e8e2d8';
    };
    lit(buttons.stand, pose === 'stand');
    lit(buttons.walk, pose === 'walk');
    lit(buttons.sit, pose === 'sit');
    lit(buttons.turn, turning);
    for (const g of GARMENTS) {
      const b = buttons[g];
      if (!b) continue;
      b.style.display = garments.includes(g) ? '' : 'none';
      lit(b, shown[g]);
    }
  }

  function applyLook(): void {
    for (const mesh of skinned) {
      const at = mesh.morphTargetDictionary?.[BELLY_TARGET];
      if (at !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[at] = bellyWeight(bump);
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name as Garment;
      if ((GARMENTS as readonly string[]).includes(name)) mesh.visible = shown[name];
    }
  }

  function buildHud(): void {
    const root = document.createElement('div');
    root.dataset.role = SARAH_LAB_HUD_ROLE;
    root.style.cssText = 'position:absolute;inset:0;font:600 13px system-ui,sans-serif;color:#e8e2d8;touch-action:none;user-select:none';
    // the orbit: the whole screen under the controls
    root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button,input')) return;
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
    for (const [p, label, action] of [['stand', 'STAND', SARAH_LAB_ACTION.stand], ['walk', 'WALK', SARAH_LAB_ACTION.walk], ['sit', 'SIT', SARAH_LAB_ACTION.sit]] as const) {
      buttons[p] = btn(label, action, () => { pose = p; });
      poses.appendChild(buttons[p]);
    }
    root.appendChild(poses);

    const right = document.createElement('div');
    right.style.cssText = `${panel}flex-direction:column;align-items:stretch;right:max(12px,env(safe-area-inset-right));top:12px;width:min(230px,40vw);padding:10px;border-radius:12px;background:rgba(10,13,18,0.66);border:1px solid rgba(255,255,255,0.1)`;
    const slider = (field: string, value: number, onInput: (v: number) => void) => {
      const label = document.createElement('div');
      label.dataset.field = field;
      label.style.cssText = 'font-size:12px;letter-spacing:.05em';
      fields[field] = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(value);
      input.style.cssText = 'width:100%;accent-color:#d4a853;height:28px';
      input.addEventListener('input', () => { onInput(Number(input.value)); applyLook(); refresh(); });
      right.append(label, input);
    };
    slider(SARAH_LAB_FIELD.bump, bump, (v) => { bump = v; });
    slider(SARAH_LAB_FIELD.fingers, curl, (v) => { curl = v; });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    buttons.shirt = btn('SHIRT', SARAH_LAB_ACTION.shirt, () => { shown.shirt = !shown.shirt; applyLook(); });
    buttons.leggings = btn('LEGGINGS', SARAH_LAB_ACTION.leggings, () => { shown.leggings = !shown.leggings; applyLook(); });
    buttons.turn = btn('TURN', SARAH_LAB_ACTION.turn, () => { turning = !turning; });
    for (const b of [buttons.shirt, buttons.leggings, buttons.turn]) { b.style.padding = '8px 10px'; b.style.fontSize = '12px'; row.appendChild(b); }
    right.appendChild(row);
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
    if (pose === 'sit') base = poseSeated(measure, rig.bind, { style: 'sit', seconds, posture: 'pregnant' }, poseOut);
    else {
      const stance = pose === 'walk' ? 'walk' : 'stand';
      // the stride is in bind units, `bindScale` of them to the metre
      const phase = pose === 'walk' ? ((walked * rig.bindScale) / humanStride(measure, 'walk')) % 1 : 0;
      base = poseHuman(measure, rig.bind, { stance, phase, seconds, lean: 0 }, poseOut);
    }
    if (curl <= 0 || fingers.length === 0) return base;
    const k = (curl / 100) * FIST;
    const extra: JointTurn[] = [];
    for (const f of fingers) {
      for (const j of f.joints) extra.push({ joint: j, ax: f.axis.x, ay: f.axis.y, az: f.axis.z, radians: k * (f.thumb ? 0.5 : 1) });
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
      void assets.loadModel(SARAH_BASE_MODEL, () => new THREE.Object3D()).then((loadedModel) => {
        if (disposed) { release(loadedModel); return; }
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
          if (mesh.morphTargetDictionary?.[BELLY_TARGET] !== undefined) hasBelly = true;
          const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
          if ((GARMENTS as readonly string[]).includes(name)) found.add(name as Garment);
        });
        garments = GARMENTS.filter((g) => found.has(g));
        model = loadedModel;
        three.add(loadedModel);
        loaded = true;
        applyLook();
        refresh();
      });
    },

    update(frame: FrameInfo) {
      seconds += frame.rawDt;
      if (pose === 'walk') walked += WALK_SPEED * frame.rawDt;
      if (turning) orbit.yaw += frame.rawDt * 0.35;
      placeCamera();
      if (rig) rig.apply(turnsFor());
      place();
    },

    resize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    dispose() {
      disposed = true;
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
