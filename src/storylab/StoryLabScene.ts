/**
 * CHAPTER 1'S LABORATORY IN 3D — the story's painted lab, rebuilt as a
 * room, with the real Jack and Sarah in it (Joshua, 2026-09-29: "load the
 * real glb models that are rigged and place them... recreate like an open
 * room with a real camera in a 3D scene, use the textures from the image
 * in the room so it's the same, just in 3D").
 *
 * A DEV TOOL scene (ARCHITECTURE §8), the TOMBS laboratory's shape with a
 * smaller job: no session, no audio yet, a BACK control. It composes what
 * already exists — `assets.loadModel` for the three files, `HumanRig` to
 * pose the bodies, `poseHuman` to stand Sarah, `FreeFlyCamera` and
 * `MoveStick` for FREE — and adds the seated pose (`actor/humanSeated`),
 * the chair, and three cameras:
 *
 *   WIDE     the picture's own camera. From here the room IS the painting.
 *   PUSH IN  the 2D story's slow drift toward Jack asleep, as a real dolly:
 *            the parallax is the point, and it is what a flat picture
 *            could never do.
 *   FREE     stick and drag, from wherever the shot was.
 *
 * ─── the room is unlit on purpose ────────────────────────────────────
 *
 * The painting already carries its light — the ceiling panels, the lamps
 * over the window, the screens — so the room is baked with
 * KHR_materials_unlit and drawn exactly as painted. The PEOPLE are lit, by
 * lights placed where the painting's lights are (the ceiling panels, the
 * monitor Jack fell asleep at), so they sit in the same night.
 *
 * ─── metres in, world units out ──────────────────────────────────────
 *
 * The set is in metres (`storyLabSet.ts`); the app is in centimetres
 * (`UNITS_PER_METRE`). The room and both bodies are models authored in
 * metres, scaled by M on ONE node each — `LabPeople`'s bounded exception,
 * for its reasons: uniform, one deep, nothing reads a world position out
 * from under it. Everything else is converted at placement.
 */
import * as THREE from 'three';
import { HUMAN_POSE_TURNS, poseHuman } from '../actor/humanPose';
import { newJointTurn, type HumanMeasure, type MutableJointTurn } from '../actor/humanRig';
import { SEATED_TURNS, poseSeated } from '../actor/humanSeated';
import { measureHuman } from '../actor/humanSkeleton';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { assets } from '../assets/assets';
import { MoveStick } from '../input/MoveStick';
import { FrameStats } from '../perf/FrameStats';
import { CAMERA_SPEEDS, FreeFlyCamera } from '../perf/FreeFlyCamera';
import { release } from '../tombs/LabPeople';
import { HumanRig, findSkinnedMesh } from '../view/HumanRig';
import { UNITS_PER_METRE } from '../world/dem';
import {
  CHAIR, CLOSE_ON_JACK, JACK_CHAIR, JACK_MONITOR, PUSH_SECONDS, ROOM, SARAH_STAND, WIDE, ease,
  type Placement, type Shot, type Vec3M,
} from './storyLabSet';
import {
  STORY_LAB_ACTION, STORY_LAB_FIELD, STORY_LAB_HUD_ROLE, STORY_LAB_SCENE_ID, loadedLine, shotLine,
  type StoryLabMode,
} from './storyLabTool';

const M = UNITS_PER_METRE;
const NEAR = 2;
const FAR = 5_000;

export interface StoryLabSettings {
  readonly lookSensitivity?: number;
  readonly invertY?: boolean;
}

export interface StoryLabHooks {
  onBack(): void;
  settings?(): StoryLabSettings | null;
}

export type StoryLabWire = (ctx: SceneContext) => StoryLabHooks;

// ------------------------------------------------------------------- the chair

/** A task chair: five-star base on casters, a gas column, a padded seat, arms, a back. */
function buildChair(seatTop: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'story-chair';
  const shell = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.78, metalness: 0.05 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.92, metalness: 0 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x70757c, roughness: 0.35, metalness: 0.85 });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * M, h * M, d * M), mat);
    m.position.set(x * M, y * M, z * M);
    g.add(m);
    return m;
  };
  const c = CHAIR;
  const hubY = c.casterRadius * 2 + 0.03;
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(c.baseRadius, 0.035, 0.05, shell, (Math.sin(a) * c.baseRadius) / 2, hubY, (Math.cos(a) * c.baseRadius) / 2);
    leg.rotation.y = a - Math.PI / 2;
    const caster = new THREE.Mesh(new THREE.SphereGeometry(c.casterRadius * M, 10, 8), shell);
    caster.position.set(Math.sin(a) * c.baseRadius * M, c.casterRadius * M, Math.cos(a) * c.baseRadius * M);
    g.add(caster);
  }
  const colH = seatTop - c.seatThickness - hubY;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(c.columnRadius * M, c.columnRadius * M, colH * M, 12), metal);
  column.position.y = (hubY + colH / 2) * M;
  g.add(column);
  box(c.seatWidth, c.seatThickness, c.seatDepth, pad, 0, seatTop - c.seatThickness / 2, 0);
  // the back, standing clear of the seat on a spine, tilted back
  const back = new THREE.Group();
  back.position.set(0, (seatTop + c.backGap) * M, -(c.seatDepth / 2 - 0.02) * M);
  back.rotation.x = -c.backTiltDeg * Math.PI / 180;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(c.backWidth * M, c.backHeight * M, 0.06 * M), pad);
  panel.position.y = (c.backHeight / 2) * M;
  back.add(panel);
  g.add(back);
  box(0.05, c.backGap + 0.06, 0.03, shell, 0, seatTop + c.backGap / 2 - 0.02, -c.seatDepth / 2 + 0.01);
  // arms
  for (const s of [-1, 1]) {
    box(0.03, c.armHeight, 0.03, shell, s * (c.seatWidth / 2 + 0.01), seatTop + c.armHeight / 2, -0.06);
    box(0.07, 0.03, 0.26, pad, s * (c.seatWidth / 2 + 0.01), seatTop + c.armHeight, -0.02);
  }
  return g;
}

// ------------------------------------------------------------------ helpers

const v3 = (p: Vec3M) => new THREE.Vector3(p[0] * M, p[1] * M, p[2] * M);

/** Horizontal field of view to three's vertical one, for this aspect. */
function verticalFov(hfovDeg: number, aspect: number): number {
  const h = (hfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / Math.max(0.1, aspect)) * 180) / Math.PI;
}

/** Yaw and pitch (FreeFlyCamera's, which are three's rotation.y and .x) looking from a to b. */
function aim(from: THREE.Vector3, to: THREE.Vector3): { yaw: number; pitch: number } {
  const d = to.clone().sub(from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

interface ShotPose { pos: THREE.Vector3; yaw: number; pitch: number; hfov: number }
function shotPose(s: Shot): ShotPose {
  const pos = v3(s.position);
  if (s.target) return { pos, ...aim(pos, v3(s.target)), hfov: s.hfovDeg };
  return { pos, yaw: (s.yawDeg * Math.PI) / 180, pitch: (s.pitchDeg * Math.PI) / 180, hfov: s.hfovDeg };
}

/** Shortest-way angle blend. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

// ------------------------------------------------------------------- the scene

export function buildStoryLabScene(ctx: SceneContext, hooks: StoryLabHooks): AppScene {
  const three = new THREE.Scene();
  three.background = new THREE.Color(0x05070a);
  const free = new FreeFlyCamera(60, NEAR, FAR);
  free.speed = CAMERA_SPEEDS.slow;
  const stats = new FrameStats();

  // THE PEOPLE'S LIGHT, placed where the painting's is: a cool fill from the
  // ceiling panels, a key straight down from the panel row over the desk,
  // and the glow of the monitor Jack fell asleep at.
  const hemi = new THREE.HemisphereLight(0xb8cee0, 0x22272c, 0.9);
  const key = new THREE.DirectionalLight(0xe6f1ff, 1.3);
  key.position.set(0.3 * M, 2.6 * M, -1.6 * M);
  key.target.position.set(-0.3 * M, 0, -3.0 * M);
  const screenGlow = new THREE.PointLight(0x7fd4ff, 1.4, 2.4 * M, 1.6);
  screenGlow.position.copy(v3(JACK_MONITOR)).add(new THREE.Vector3(-0.1 * M, 0, 0.25 * M));
  three.add(hemi, key, key.target, screenGlow);

  let room: THREE.Object3D | null = null;
  const bodies: Array<{ model: THREE.Object3D; rig: HumanRig; measure: HumanMeasure; seated: boolean }> = [];
  let loaded = { room: false, jack: false, sarah: false };
  let disposed = false;
  let seconds = 0;

  let mode: StoryLabMode = 'wide';
  let pushT = 0;
  let aspect = 1;
  const turns: MutableJointTurn[] = Array.from({ length: Math.max(HUMAN_POSE_TURNS, SEATED_TURNS) }, newJointTurn);

  const wide = shotPose(WIDE);
  const close = shotPose(CLOSE_ON_JACK);
  function placeShot(p: ShotPose): void {
    free.setFov(verticalFov(p.hfov, aspect));
    free.place(p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch);
  }

  // ------------------------------------------------------------------ HUD
  let hud: HTMLElement | null = null;
  let stick: MoveStick | null = null;
  const fields: Record<string, HTMLElement> = {};
  function setMode(next: StoryLabMode): void {
    mode = next;
    pushT = 0;
    if (mode === 'wide') placeShot(wide);
    if (mode === 'push') placeShot(wide);
    if (mode === 'free') {
      if (stick === null) stick = new MoveStick(ctx.uiLayer);
    } else if (stick !== null) {
      stick.dispose();
      stick = null;
    }
    if (hud) for (const b of hud.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
      b.style.background = b.dataset.mode === mode ? 'rgba(212,168,83,0.92)' : 'rgba(16,20,26,0.72)';
      b.style.color = b.dataset.mode === mode ? '#15110a' : '#e8e2d8';
    }
    refresh();
  }
  function refresh(): void {
    if (fields.shot) fields.shot.textContent = shotLine(mode);
    if (fields.loaded) fields.loaded.textContent = loadedLine(loaded.room, loaded.jack, loaded.sarah);
  }
  function buildHud(): void {
    const root = document.createElement('div');
    root.dataset.role = STORY_LAB_HUD_ROLE;
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:600 13px system-ui,sans-serif;color:#e8e2d8';
    const btn = (label: string, action: string, css: string, m?: StoryLabMode) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.action = action;
      if (m) b.dataset.mode = m;
      b.style.cssText = `position:absolute;pointer-events:auto;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(16,20,26,0.72);color:#e8e2d8;font:700 13px system-ui,sans-serif;letter-spacing:.06em;${css}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (action === STORY_LAB_ACTION.back) hooks.onBack();
        else if (m) setMode(m);
      });
      root.appendChild(b);
      return b;
    };
    btn('BACK', STORY_LAB_ACTION.back, 'left:max(12px,env(safe-area-inset-left));top:12px');
    btn('WIDE', STORY_LAB_ACTION.wide, 'right:max(12px,env(safe-area-inset-right));bottom:128px', 'wide');
    btn('PUSH IN', STORY_LAB_ACTION.push, 'right:max(12px,env(safe-area-inset-right));bottom:74px', 'push');
    btn('FREE', STORY_LAB_ACTION.free, 'right:max(12px,env(safe-area-inset-right));bottom:20px', 'free');
    const info = document.createElement('div');
    info.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;text-shadow:0 1px 3px #000;opacity:.9';
    const title = document.createElement('div');
    title.textContent = 'Chapter 1 · the lab in 3D';
    title.style.cssText = 'font:700 14px Georgia,serif;letter-spacing:.04em';
    fields.shot = document.createElement('div');
    fields.shot.dataset.field = STORY_LAB_FIELD.shot;
    fields.loaded = document.createElement('div');
    fields.loaded.dataset.field = STORY_LAB_FIELD.loaded;
    fields.loaded.style.cssText = 'font-weight:400;font-size:11px;opacity:.75';
    info.append(title, fields.shot, fields.loaded);
    root.appendChild(info);
    ctx.uiLayer.appendChild(root);
    hud = root;
  }

  // --------------------------------------------------------------- loading
  function placeBody(model: THREE.Object3D, rig: HumanRig, measure: HumanMeasure, where: Placement, seated: boolean): void {
    model.scale.setScalar(M);
    model.rotation.set(0, where.yaw, 0);
    model.position.set(0, 0, 0);
    const skin = findSkinnedMesh(model);
    if (seated && skin) {
      // Pose first (the hips do not move with it), then read where the pose
      // put the hips and the ankles, and seat the body: ankles a sole's
      // height off the floor, hips over the middle of the seat.
      rig.apply(poseSeated(measure, rig.bind, { style: 'doze', seconds: 0, headSide: 1 }, turns));
      model.updateMatrixWorld(true);
      const bones = skin.skeleton.bones;
      const j = measure.joints;
      const hips = new THREE.Vector3().addVectors(
        bones[j.hipL].getWorldPosition(new THREE.Vector3()), bones[j.hipR].getWorldPosition(new THREE.Vector3()),
      ).multiplyScalar(0.5);
      const ankle = Math.min(bones[j.ankleL].getWorldPosition(new THREE.Vector3()).y, bones[j.ankleR].getWorldPosition(new THREE.Vector3()).y);
      const hipAboveAnkle = hips.y - ankle;
      // a sole and a heel put the ankle ~8 cm off the floor; the hip joint sits ~10 cm above the seat pad
      const seatTop = Math.min(0.55, Math.max(0.4, (hipAboveAnkle / M) + 0.08 - 0.10));
      const chair = buildChair(seatTop);
      chair.position.copy(v3(where.at));
      chair.rotation.y = where.yaw;
      three.add(chair);
      chairs.push(chair);
      // hips 4 cm behind the seat's middle, toward the back
      const back = new THREE.Vector3(Math.sin(where.yaw), 0, Math.cos(where.yaw)).multiplyScalar(-0.04 * M);
      const target = v3(where.at).add(back).setY((seatTop + 0.10) * M);
      model.position.add(target.sub(hips));
    } else {
      model.position.copy(v3(where.at));
    }
    model.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh === true) mesh.frustumCulled = false;
    });
  }
  const chairs: THREE.Object3D[] = [];

  function loadPerson(file: string, where: Placement, seated: boolean, done: () => void): void {
    void assets.loadModel(file, () => new THREE.Object3D()).then((model) => {
      if (disposed) { release(model); return; }
      try {
        const rig = new HumanRig(model);
        const measure = measureHuman(rig.bind);
        placeBody(model, rig, measure, where, seated);
        bodies.push({ model, rig, measure, seated });
      } catch (error) {
        console.error(`[storylab] ${file} could not be posed; it keeps its bind pose`, error);
        model.scale.setScalar(M);
        model.position.copy(v3(where.at));
      }
      three.add(model);
      done();
      refresh();
    });
  }

  return {
    name: STORY_LAB_SCENE_ID,
    three,
    camera: free.camera,

    async enter() {
      const s = hooks.settings?.() ?? null;
      free.setLook({ sensitivity: s?.lookSensitivity ?? 1, invertY: s?.invertY ?? false });
      const size = ctx.renderer.size();
      aspect = size.width / Math.max(1, size.height);
      free.resize(size.width, size.height);
      buildHud();
      setMode('wide');
      void assets.loadModel('models/lab-story.glb', () => new THREE.Object3D()).then((model) => {
        if (disposed) { release(model); return; }
        model.scale.setScalar(M);
        room = model;
        three.add(model);
        loaded = { ...loaded, room: true };
        refresh();
      });
      loadPerson('models/jack.glb', JACK_CHAIR, true, () => { loaded = { ...loaded, jack: true }; });
      loadPerson('models/sarah.glb', SARAH_STAND, false, () => { loaded = { ...loaded, sarah: true }; });
    },

    update(frame: FrameInfo) {
      stats.record(frame.rawDt, frame.simDt);
      seconds += frame.rawDt;
      if (mode === 'push') {
        pushT = Math.min(1, pushT + frame.rawDt / PUSH_SECONDS);
        const t = ease(pushT);
        const pos = wide.pos.clone().lerp(close.pos, t);
        free.setFov(verticalFov(wide.hfov + (close.hfov - wide.hfov) * t, aspect));
        free.place(pos.x, pos.y, pos.z, lerpAngle(wide.yaw, close.yaw, t), wide.pitch + (close.pitch - wide.pitch) * t);
      } else if (mode === 'free') {
        free.update(ctx.input.snapshot(), frame.rawDt, stick === null ? null : stick.read());
        // stay inside the room's walls
        const p = free.camera.position;
        p.x = Math.min(ROOM.xr * M - 10, Math.max(ROOM.xl * M + 10, p.x));
        p.z = Math.min(ROOM.zSouth * M - 10, Math.max(ROOM.zBack * M + 10, p.z));
        p.y = Math.min(ROOM.ceiling * M - 10, Math.max(15, p.y));
      }
      // the bodies breathe; Jack stays asleep in his chair, Sarah stands
      for (const b of bodies) {
        if (b.seated) b.rig.apply(poseSeated(b.measure, b.rig.bind, { style: 'doze', seconds, headSide: 1 }, turns));
        else b.rig.apply(poseHuman(b.measure, b.rig.bind, { stance: 'stand', phase: 0, seconds, lean: 0 }, turns));
      }
    },

    resize(width: number, height: number) {
      aspect = width / Math.max(1, height);
      free.resize(width, height);
      if (mode === 'wide') placeShot(wide);
    },

    dispose() {
      disposed = true;
      hud?.remove();
      hud = null;
      stick?.dispose();
      stick = null;
      for (const b of bodies) { three.remove(b.model); b.rig.dispose(); release(b.model); }
      bodies.length = 0;
      for (const c of chairs) { three.remove(c); release(c); }
      chairs.length = 0;
      if (room) { three.remove(room); release(room); room = null; }
      three.remove(hemi, key, key.target, screenGlow);
      three.background = null;
    },
  };
}

export function createStoryLabScene(wire: StoryLabWire): SceneFactory {
  return (ctx) => buildStoryLabScene(ctx, wire(ctx));
}
