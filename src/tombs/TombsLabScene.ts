/**
 * THE TOMBS LABORATORY, WALKED — the dev-tool scene that opens the
 * building `world/tombs` plans and `tombs/LabView` draws, so the one
 * person who has to judge it can stand in it on his phone.
 *
 * Everything it composes already existed and this file owns none of it:
 * `planLab()` is the building, `LabView` is the building drawn,
 * `FreeFlyCamera` is the eye, `MoveStick` is the left thumb, `FrameStats`
 * is the frame counter. What is here is the wiring, the six doors into
 * the six rooms, and the lever. It is the Creature Lab's shape
 * (`lab/CreatureLabScene.ts`) with a smaller job: no session, no ledger,
 * no simulation — a tool scene in the `menu` state with a BACK control
 * rather than a pause menu.
 *
 * ─── the island is not in this scene ─────────────────────────────────
 *
 * The building's site is a real coordinate on Kaua'i (`world/tombs/site.ts`)
 * and the day a player walks in through the entrance hall it will be
 * standing on the island's own ground at `TOMBS_GROUND_UNITS`. Not here:
 * this scene builds the view with `groundUnits: 0`, so THE PLAN'S FLOOR
 * IS THE ORIGIN and a camera written from the floor plan lands where the
 * floor plan says — the same choice `scripts/probe-tombs.mjs` makes, for
 * the same reason. Nothing in this scene reads the heightfield or a
 * session, and nothing depends on the floating origin: the camera is
 * PLACED in rendered units and never restored from a saved world pose,
 * so wherever the origin was left standing by the last scene, this
 * building is where the plan says it is. (`FreeFlyCamera.pose()` is
 * asked for a teleport's yaw and pitch, and its WorldPoint — the one
 * part of it the origin touches — is thrown away.) That is why the tool
 * can be opened from the hub with no loading screen behind it.
 *
 * ─── metres in, world units out, AND THE CAMERA DOES ITS OWN ─────────
 *
 * `LabView` converts the plan's metres to world units per placement, for
 * its own meshes and nothing else (its header explains why it refuses to
 * scale its group). A camera is not one of its meshes, so the conversion
 * for the EYE happens here and is the one piece of arithmetic in this
 * file worth reading twice:
 *
 *     x, z:  metres × UNITS_PER_METRE
 *     y:     FLOOR_UNITS + (floor + EYE_HEIGHT_M) × UNITS_PER_METRE
 *
 * — 100 units to the metre, with `FLOOR_UNITS` the same number the view
 * was built with, so the two frames are the same frame by construction.
 * Read back the other way for the `tombs-pos` line, so the HUD prints
 * the plan's own metres and a reading can be checked against the floor
 * plan with no arithmetic at all. Get this wrong and the visitor is
 * either a hundred times too tall or buried in the slab; it is the
 * easiest thing here to get wrong, so it lives in two named helpers
 * (`standAt`, `metresOf`) and nowhere else.
 *
 * ─── the lever ──────────────────────────────────────────────────────
 *
 * Chapter 2: "He pulled the physical shutdown lever, and the room went
 * dark… The emergency lights switched on." `tombs:lever` is that, and it
 * is the reason this scene exists rather than a screenshot of it. The
 * button says what pulling it will DO and the `tombs-lighting` line says
 * what the building is doing now (`tombsTool.ts`). The AIR goes with the
 * lights: a Group cannot own `Scene.fog`, so `LabView` hands its owner
 * the look (`view.lighting`) and this file applies the fog and the
 * background — the arrangement `LabView`'s header asks for and the probe
 * already uses.
 *
 * ─── the camera, and why it is slow ─────────────────────────────────
 *
 * `FreeFlyCamera` at `CAMERA_SPEEDS.slow` — 1 m/s at a nudge, 5 m/s at a
 * full push. The player's own Camera speed setting is deliberately NOT
 * read: `fast` is 30 m/s, a speed for crossing Kaua'i, and this building
 * is 26 m across, so a rung chosen for the island would cross the whole
 * laboratory in under a second. The settings that ARE honoured are the
 * ones about the eye itself — field of view, look sensitivity, invert Y —
 * read through the hook exactly as `PerformanceWorldScene` reads them,
 * so a player who inverted his look does not have it un-inverted by a
 * dev tool.
 *
 * It is a FREE camera that merely STARTS at a person's eye height, and
 * it is not clamped to the floor: a walking body held at 1.65 m with the
 * building's solids under it is the next milestone and another file's
 * (`Slab.solid` is already the one answer to whether a body stops).
 *
 * ─── clocks ─────────────────────────────────────────────────────────
 *
 * FrameClock's rule, as the Creature Lab keeps it: the camera and the
 * HUD advance by RAW dt — an instrument keeps easing while the world
 * stands still — and the array's rings turn by SIM dt, the clamped step,
 * because they are the world.
 *
 * Renderer-side: three and the DOM are allowed here. It imports nothing
 * from `lab/` (whose HUD chrome is duplicated below rather than reached
 * for), nothing from a world scene, and everything it can press or read
 * is named in `tombsTool.ts`.
 */
import * as THREE from 'three';
import { aimBody, createAim, type AimState } from '../actor/humanAim';
import { swingBadge } from '../actor/humanBadge';
import { HUMAN_POSE_TURNS, humanStride, poseHuman } from '../actor/humanPose';
import { createReach, reachHands, type HandTarget, type ReachState } from '../actor/humanReach';
import { poseSeated, posedJoints, SEATED_TURNS } from '../actor/humanSeated';
import { createFeet, groundFeet, type FeetState, type FootGround } from '../actor/humanFeet';
import {
  newJointTurn, type BindJoint, type HumanGait, type HumanMeasure, type HumanStance, type JointTurn, type MutableJointTurn,
} from '../actor/humanRig';
import { measureHuman } from '../actor/humanSkeleton';
import { newWalkerState, step as walkStep, type WalkWorld, type WalkerState } from '../actor/Walker';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import type { InputSnapshot } from '../input/Input';
import type { StickReading } from '../input/MoveStick';
import { assets } from '../assets/assets';
import { AudioEngine, newAudioStatus, type AudioStatus } from '../audio/AudioEngine';
import { MIX_DEFAULTS, type MixLevels } from '../audio/mix';
import { AUDIO_MANIFEST } from '../audio/audioManifest';
import { NO_BUTTONS, demandFrom } from '../control/PlayerDemand';
import { newMutableIntent } from '../creatures/demand';
import { attachBadge, type BadgeHandle } from '../view/HumanBadge';
import { HumanRig } from '../view/HumanRig';
import { detailFor, type DetailTier } from '../assets/detailQuality';
import { textureUrl } from '../assets/textureManifest';
import { SURFACE_TEXTURES } from './labLook';
import { beatOfLine } from '../story/chapter1';
import { tierFor } from '../assets/textureQuality';
import { MoveStick } from '../input/MoveStick';
import { FrameStats } from '../perf/FrameStats';
import { CAMERA_SPEEDS, FreeFlyCamera, headingOfYaw } from '../perf/FreeFlyCamera';
import { UNITS_PER_METRE } from '../world/dem';
import { holds, planLab, type Interaction, type LabLayout, type LightMode, type Room, type RoomId, type Vec3 } from '../world/tombs';
import {
  ceilingOver, groundUnder, indexLab, moveBody, nearestInteraction, newRayHit, rayHit,
  type LabSolids,
} from '../world/tombs/collide';
import { LabPeople, release } from './LabPeople';
import { lookAtOf, rollStep, rolledToward, useOf, type LabUse } from './labUse';
import { LabView } from './LabView';
import { LIGHTING, type LightingLook } from './labLook';
import {
  AUDIO_LABEL, BACK_LABEL, EYE_HEIGHT_M, OUTSIDE_ROOM, PREV_LABEL,
  TOMBS_ACTION, TOMBS_FIELD, TOMBS_HUD_HZ, TOMBS_HUD_ROLE,
  TOMBS_SCENE_ID, arrayLabel, arrayLine, audioLine, drawsLine, fpsLine, interactLabel, leverLabel, lightingLine,
  modeLine, peopleLine, posLine, promptLine, roomLabel, roomLine, runLabel, teleportAction, teleportedRoomOf,
  walkLabel,
  audioLabel, beatLine, dialogueLine, progressLine, speakerLine,
} from './tombsTool';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * THE PLAYER'S OWN SETTINGS, as much of the document as this scene can
 * honour — a structural shape rather than the `Settings` type itself, so
 * `src/tombs/` does not import `src/ui/` for a field it only reads. The
 * real document satisfies it; a test hands in an object literal.
 *
 * Everything is optional because a probe may hand in nothing, and every
 * absent field falls back to the same value the game's defaults carry.
 */
export interface TombsLabSettings {
  /**
   * RENDERING DETAIL. Read through `detailFor`, exactly as the world and
   * the Creature Lab read it, so the light cap and the segment counts
   * this building is drawn at are the rung the player actually plays at
   * (Joshua, 2026-09-11: "should be on High to match settings not
   * medium"). Absent: `medium`, the conservative rung.
   */
  readonly detail?: 'low' | 'medium' | 'high';
  /**
   * THE TEXTURE RUNG, for the screens' atlas. Read through `tierFor`,
   * exactly as the world reads it, so the monitors in this room are drawn
   * at the size the player's Textures setting asks for and not at a size
   * this file chose. Absent: `medium`.
   */
  readonly textures?: 'low' | 'medium' | 'high';
  /** Camera field of view in degrees. */
  readonly fov?: number;
  /** Multiplier on look-drag turn rate; 1 is the tuned feel. */
  readonly lookSensitivity?: number;
  /**
   * THE MASTER AND THE FOUR BUSES, each 0 to 1 (`audio/mix.ts`). Absent:
   * `MIX_DEFAULTS`, the story repository's own measured mix undeparted
   * from. Read at `enter()` with the rest, and again whenever the player
   * plays a line, because Settings is one screen away and a fader moved
   * between two lines should be heard on the second.
   */
  readonly mix?: MixLevels;
  /** False is the shipped feel: dragging DOWN lifts the view. */
  readonly invertY?: boolean;
}

/**
 * Everything the laboratory needs from the app, and nothing else
 * (ARCHITECTURE §2.7). It has no session, no identity and no assets: the
 * building is a function of the plan, and the plan is a constant.
 */
export interface TombsLabHooks {
  /** BACK was pressed (or Escape). The owner decides where that goes — the hub, normally. */
  onBack(): void;
  /**
   * The player's settings, read ONCE when the building is built. Read at
   * build and not per frame because the rung sizes the lights and the
   * geometry, and a rung that changed under a standing building would
   * mean rebuilding it mid-look.
   */
  settings?(): TombsLabSettings | null;
}

export type TombsLabWire = (ctx: SceneContext) => TombsLabHooks;

/** The scene, with the building reachable for a test that wants the numbers behind the words. */
export interface TombsLabScene extends AppScene {
  /** The plan: the same object for the whole life of the scene. */
  readonly layout: LabLayout;
  /** The building drawn, once `enter()` has built it. */
  readonly view: LabView | null;
  readonly free: FreeFlyCamera;
  readonly lighting: LightMode;
  readonly arrayRunning: boolean;
  /** Which room the camera is standing in, or null when it is in none. */
  roomNow(): Room | null;
  /** Drive a control by name, the way the HUD does — what a test presses instead of a button. */
  act(action: string): void;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** 100 world units to the metre, as everywhere. The plan is in metres; the scene is in units. */
const M = UNITS_PER_METRE;

/**
 * WHERE THE BUILDING'S FLOOR IS, in world units. Zero: this scene has no
 * island under it, so the plan's own origin is the scene's. It is passed
 * to `LabView` as `groundUnits` and used to read the camera back into
 * metres, so the view's frame and the camera's frame are the same number
 * and cannot drift.
 */
const FLOOR_UNITS = 0;

/**
 * THE ROOM'S OWN SOUND, by the story repository's id.
 *
 * `amb_computer_lab` is a real recorded computer-room tone Joshua
 * supplied and confirmed loops seamlessly, and it is the one asset in
 * chapter 1 that belongs to THIS room rather than to a moment in it. It
 * is named here rather than chosen at the call site because a bed is a
 * property of the place.
 */
const LAB_BED = 'amb_computer_lab';

// ---- THE HEAD AND THE HANDS (the player drives the body; these follow) ----

/**
 * The eye of a body seated at a desk, above the floor, metres — MEASURED
 * on Jack in `poseSeated` with his soles on the floor: shoulders at
 * 1.00 m, the eye a fifth of a metre over them. The camera rides here
 * while he sits, and INTERACT reaches from here, which is what brings the
 * intercom on his desk (0.74 m from this eye) inside its 0.9 m.
 */
const SEATED_EYE_M = 1.2;

/** The prompt button's words while seated with nothing else in reach, and while looking at a console. */
const GET_UP_LABEL = 'Get up';
const LOOK_AWAY_LABEL = 'Look away';

/**
 * Walking up to a wall control or a lever before the hand goes out:
 * root to target, horizontal metres. GAME TUNING from Jack's measured
 * 0.60 m arm with his shoulder 0.18 m off his middle — at 0.42 m a button
 * at shoulder height is about three quarters of his arm away, inside the
 * 0.85 at which `actor/humanReach` takes hold.
 */
const STAND_OFF_M = 0.42;
/** An approach that has not arrived by then gives up and reaches from where it is. */
const APPROACH_SECONDS = 2.5;
/** The walk up to it: half a push, a walk and not a run. */
const APPROACH_PUSH = 0.5;
/** A push on the stick past this takes the body back: up out of the chair, or off an approach. */
const TAKE_BACK_PUSH = 0.3;

/**
 * With nothing in hand and nothing in reach, the head looks at a person
 * this close (horizontal metres) who is within `PERSON_LOOK_DEG` of
 * where the camera looks — and otherwise along the camera's own line, out
 * to `LOOK_AHEAD_M`. A camera looking more than `LOOK_BEHIND_DEG` away
 * from the body's facing is looking BEHIND it: the head comes home rather
 * than wrenching round to its limit. GAME TUNING.
 */
const PERSON_LOOK_M = 2.5;
const PERSON_LOOK_COS = Math.cos((60 * Math.PI) / 180);
const LOOK_AHEAD_M = 3;
const LOOK_BEHIND_COS = Math.cos((100 * Math.PI) / 180);

/**
 * How far the seated pose lifts the soles above the bind's, metres, so
 * the body can be lowered onto the floor: the lower ankle's rise, in
 * bind units over `bindScale`. Measured once per body.
 */
function seatDropOf(measure: HumanMeasure, bind: readonly BindJoint[], posed: readonly JointTurn[], bindScale: number): number {
  const p = posedJoints(bind, posed);
  const j = measure.joints;
  return Math.min(p[j.ankleL][1] - bind[j.ankleL].y, p[j.ankleR][1] - bind[j.ankleR].y) / bindScale;
}

/**
 * How far behind the head the third-person camera sits, in metres, and
 * how close it is allowed to be pulled when a wall is in the way.
 *
 * The pull-in is not a nicety: the laboratory is 12 m by 6.6 m with
 * workstations in it, so a fixed 2.5 m boom would spend half its time
 * inside a wall, and a camera inside a wall shows the room from the
 * outside. `rayHit` is asked, every frame, how far it may go.
 */
const BOOM_M = 2.4;
const BOOM_MIN_M = 0.45;
/**
 * SEATED, the camera comes in close behind the chair. The ray pulls the
 * boom in only for SOLIDS, and a monitor is not one: at the full 2.4 m,
 * Jack seated at his desk was framed from behind Sarah's, with her screen
 * standing exactly in front of his head (measured in the lab: his head
 * 1.18 m from the back of her monitor). 0.9 m keeps the camera on his
 * side of it, over his shoulders, on his own screen.
 */
const SEATED_BOOM_M = 0.9;

/** The rung a probe or a test with no settings to read gets: the conservative one. */
const RUNG_FALLBACK: DetailTier = 'medium';

/**
 * The eye's glass. 2 units is 2 cm — closer than a visitor's nose gets
 * to a wall — and 20,000 is 200 m, which holds the whole 26 m building
 * and the ground it would stand on with depth precision to spare. The
 * probe's own camera is 62°; the player's `fov` setting replaces it when
 * there is one.
 */
const FOV = 62;
const NEAR = 2;
const FAR = 20_000;

/**
 * How far the air reaches, in world units: clear to 6 m, gone by 46 m.
 * The probe's numbers, so a shot taken there and a look taken here show
 * the same corridor. The COLOUR is the lighting's, which is what makes
 * the lever felt at the far end of a corridor as well as overhead.
 */
const FOG_NEAR = 6 * M;
const FOG_FAR = 46 * M;

/** Scratch: the camera's place in the plan's metres, rewritten in place for the room test. */
interface MutableVec3 extends Vec3 {
  x: number;
  y: number;
  z: number;
}

const POINT: MutableVec3 = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

/** What the HUD is told each refresh. Plain numbers and words; the scene works them out. */
interface TombsReadout {
  /** The plan's own name for the room the camera is in, or `outside`. */
  readonly room: string;
  readonly lighting: LightMode;
  readonly running: boolean;
  readonly drawCalls: number;
  /** How many bodies are standing in the building, and how many of those are stand-ins. */
  readonly standing: number;
  readonly missing: number;
  readonly fps: number;
  /** The camera, in the plan's LOCAL METRES. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Is a body being walked, and what is it doing? */
  readonly walking: boolean;
  readonly stance: string;
  /**
   * Is the RUN button held on? This is the BUTTON'S state, not the
   * body's: a sprinting body standing still still reads `stance:
   * 'stand'`, so a control that took its word from the stance would
   * flip back to RUN every time the player let go of the stick.
   */
  readonly sprinting: boolean;
  /** What is in reach, in the plan's own words, and what to call the control that does it. */
  readonly prompt: string;
  readonly reachLabel: string;
  /** The audio, as `AudioStatus` reports it. */
  readonly audioRunning: boolean;
  readonly decoded: number;
  readonly failed: number;
  readonly playing: number;
  /**
   * THE LINE ON SCREEN, all of it quoted from the manifest and the beat
   * list. `lineAt` is ONE-BASED and 0 means the chapter has not started,
   * which is the one state the pane has to tell apart from line one —
   * before the first press there is nothing to show and the pane is not
   * there at all.
   */
  readonly lineAt: number;
  readonly lineCount: number;
  readonly speaker: string;
  readonly text: string;
  readonly beatTitle: string;
}

interface MutableReadout extends TombsReadout {
  room: string;
  lighting: LightMode;
  running: boolean;
  drawCalls: number;
  standing: number;
  missing: number;
  fps: number;
  x: number;
  y: number;
  z: number;
  walking: boolean;
  stance: string;
  sprinting: boolean;
  prompt: string;
  reachLabel: string;
  audioRunning: boolean;
  decoded: number;
  failed: number;
  playing: number;
  lineAt: number;
  lineCount: number;
  speaker: string;
  text: string;
  beatTitle: string;
}

interface TombsHudHooks {
  readout(): TombsReadout;
  /** Every press, by its `data-action` name. The scene decides what each one means. */
  onAction(action: string): void;
}

// Chrome: TCS black and gold, the same inline-styled sheet the other dev
// tools wear. It is duplicated rather than imported because `src/tombs/`
// may not reach into `src/lab/` and may not import `ui/` — and a HUD that
// only looked right after the menu had loaded a stylesheet would be a
// hidden dependency on load order (`lab/LabUi.ts` says the same).
const GOLD = 'var(--ui-gold,#c9a94a)';
const PARCHMENT = 'var(--ui-ink,#e8e2c8)';
const PANEL = 'rgba(6,9,12,0.72)';
const BUTTON = 'var(--ui-button,#1a2014)';
const FONT = '11px/1.3 var(--ui-mono,ui-monospace,SFMono-Regular,Menlo,monospace)';
const EDGE_LEFT = 'calc(10px + min(env(safe-area-inset-left), 14px))';
const EDGE_RIGHT = 'calc(10px + min(env(safe-area-inset-right), 14px))';

const CSS = {
  root: 'position:absolute;inset:0;pointer-events:none;',
  panel:
    'position:absolute;display:flex;flex-direction:column;gap:4px;padding:6px 8px;pointer-events:auto;'
    + `background:${PANEL};color:${PARCHMENT};font:${FONT};border:1px solid ${GOLD};border-radius:6px;`,
  row: 'display:flex;flex-wrap:wrap;gap:5px;',
  button:
    `min-height:36px;padding:4px 10px;font:${FONT};color:${PARCHMENT};background:${BUTTON};`
    + `border:1px solid ${GOLD};border-radius:6px;touch-action:manipulation;white-space:nowrap;`,
  line: 'white-space:nowrap;',
} as const;

/**
 * THE LABORATORY'S HUD: the room row and where you are on the left, the
 * lever, the array and the way out on the right.
 *
 * MOBILE FIRST, 932 × 430. The room row is top-left, above the stick
 * rather than beside it (`input/MoveStick.ts` owns the bottom-left
 * corner and the thumb that rests there); the lever and the array are
 * top-right where the other thumb reaches without crossing the screen.
 * The left panel is capped at half the width so six room buttons wrap
 * into two rows instead of running under the right-hand panel.
 *
 * Every control carries `data-action` and every readout `data-field`, by
 * the names in `tombsTool.ts` and never as a bare string.
 */
class TombsHud {
  private readonly root: HTMLElement;
  private readonly fields = new Map<string, HTMLElement>();
  private readonly lever: HTMLButtonElement;
  private readonly array: HTMLButtonElement;
  private readonly walk: HTMLButtonElement;
  private readonly run: HTMLButtonElement;
  /**
   * The INTERACT control is CREATED AND DESTROYED rather than shown and
   * hidden, and that is the standing rule rather than a preference: an
   * unavailable action must never look functional, and a disabled button
   * that is on screen nine tenths of the time is a control that reads as
   * broken. When nothing is in reach there is nothing there.
   */
  private readonly prompt: HTMLElement;
  private readonly promptRow: HTMLElement;
  private interact: HTMLButtonElement | null = null;
  /**
   * The dialogue pane. The PANEL is always there because the control
   * that starts the chapter lives in it; the three QUOTED LINES are
   * what appears with the first line and not before.
   */
  private readonly dialogue: HTMLElement;
  private readonly dialogueText: HTMLElement;
  private readonly dialogueControls: HTMLElement;
  private prev: HTMLButtonElement | null = null;
  private readonly next: HTMLButtonElement;
  private readonly detach: Array<() => void> = [];
  private sinceRefresh = Infinity;

  constructor(
    uiLayer: HTMLElement,
    rooms: readonly Room[],
    private readonly hooks: TombsHudHooks,
  ) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = TOMBS_HUD_ROLE;
    this.root.style.cssText = CSS.root;

    // TOP-LEFT: where you are, and the six rooms to be somewhere else.
    const left = el(doc, 'div', `${CSS.panel}top:8px;left:${EDGE_LEFT};max-width:min(440px,52%);`);
    left.appendChild(this.field(doc, TOMBS_FIELD.room, `${CSS.line}color:${GOLD};letter-spacing:0.06em;`));
    left.appendChild(this.field(doc, TOMBS_FIELD.pos, `${CSS.line}opacity:0.85;`));
    left.appendChild(this.field(doc, TOMBS_FIELD.mode, `${CSS.line}opacity:0.85;`));
    const roomRow = el(doc, 'div', CSS.row);
    // THE ROOMS COME FROM THE LAYOUT, in the plan's order and under the
    // plan's names: six buttons because the plan has six rooms, and a
    // seventh room would grow a seventh button without an edit here.
    for (const room of rooms) roomRow.appendChild(this.button(doc, teleportAction(room.id), roomLabel(room.name)));
    left.appendChild(roomRow);
    this.root.appendChild(left);

    // TOP-RIGHT: the lever, the array, the way out, and what the building costs.
    const right = el(doc, 'div', `${CSS.panel}top:8px;right:${EDGE_RIGHT};align-items:flex-end;`);
    const controls = el(doc, 'div', `${CSS.row}justify-content:flex-end;`);
    this.lever = this.button(doc, TOMBS_ACTION.lever, leverLabel('normal'));
    this.array = this.button(doc, TOMBS_ACTION.array, arrayLabel(false));
    this.walk = this.button(doc, TOMBS_ACTION.walk, walkLabel(false));
    this.run = this.button(doc, TOMBS_ACTION.run, runLabel(false));
    controls.appendChild(this.walk);
    controls.appendChild(this.run);
    controls.appendChild(this.lever);
    controls.appendChild(this.array);
    controls.appendChild(this.button(doc, TOMBS_ACTION.back, BACK_LABEL));
    right.appendChild(controls);
    right.appendChild(this.field(doc, TOMBS_FIELD.lighting, `${CSS.line}color:${GOLD};`));
    right.appendChild(this.field(doc, TOMBS_FIELD.array, CSS.line));
    const perf = el(doc, 'div', `${CSS.row}justify-content:flex-end;gap:10px;opacity:0.85;`);
    perf.appendChild(this.field(doc, TOMBS_FIELD.draws, CSS.line));
    perf.appendChild(this.field(doc, TOMBS_FIELD.people, CSS.line));
    perf.appendChild(this.field(doc, TOMBS_FIELD.fps, CSS.line));
    right.appendChild(perf);
    right.appendChild(this.field(doc, TOMBS_FIELD.audio, `${CSS.line}opacity:0.85;`));
    this.root.appendChild(right);

    // BOTTOM CENTRE: what is in reach and the one control that does it.
    // Not bottom-left — `input/MoveStick.ts` owns that corner and the
    // thumb that rests in it — and not top, where the room row already
    // is: a prompt belongs under the eye, near the thing it is about.
    this.promptRow = el(doc, 'div',
      `${CSS.panel}bottom:10px;left:50%;transform:translateX(-50%);align-items:center;gap:6px;`);
    this.prompt = this.field(doc, TOMBS_FIELD.prompt, `${CSS.line}color:${GOLD};`);
    this.promptRow.appendChild(this.prompt);
    this.promptRow.style.display = 'none';
    this.root.appendChild(this.promptRow);

    // BOTTOM-RIGHT: WHO IS TALKING AND WHAT THEY SAID.
    //
    // The only corner left, and the right one anyway. The stick owns
    // bottom-left, the room row and the lever own the two top corners,
    // and the reach prompt owns bottom-centre — a pane here collides
    // with none of them and sits under the thumb that is not steering.
    //
    // THE QUOTED LINES ARE ABSENT UNTIL SOMETHING HAS BEEN SAID, rather
    // than empty: a quotation mark with nothing in it is the unavailable
    // thing this HUD's own rules forbid. THE PANEL IS NOT, and that is a
    // bug the probe caught rather than a preference — the control that
    // starts the chapter lives in this panel, so hiding the panel until
    // the chapter starts hides the only way to start it.
    //
    // PREV is built and destroyed the way INTERACT is, because on line
    // one there is nowhere back to.
    this.dialogue = el(doc, 'div',
      `${CSS.panel}bottom:10px;right:${EDGE_RIGHT};max-width:min(360px,44%);gap:3px;`);
    this.dialogueText = el(doc, 'div', 'display:flex;flex-direction:column;gap:3px;');
    this.dialogueText.appendChild(this.field(doc, TOMBS_FIELD.beat,
      `${CSS.line}color:${GOLD};letter-spacing:0.06em;opacity:0.9;font-size:10px;`));
    this.dialogueText.appendChild(this.field(doc, TOMBS_FIELD.speaker, `${CSS.line}color:${GOLD};`));
    // The one readout in this HUD that WRAPS. Every other line is a
    // reading and fits; a line of dialogue is a sentence and does not.
    this.dialogueText.appendChild(this.field(doc, TOMBS_FIELD.line,
      'white-space:normal;line-height:1.35;'));
    this.dialogueText.style.display = 'none';
    this.dialogue.appendChild(this.dialogueText);
    this.dialogueControls = el(doc, 'div', `${CSS.row}justify-content:flex-end;`);
    this.next = this.button(doc, TOMBS_ACTION.audio, AUDIO_LABEL);
    this.dialogueControls.appendChild(this.next);
    this.dialogue.appendChild(this.dialogueControls);
    this.root.appendChild(this.dialogue);

    uiLayer.appendChild(this.root);
    this.refreshNow();
  }

  /** Every frame with RAW dt; the DOM is written `TOMBS_HUD_HZ` times a second. */
  update(rawDt: number): void {
    this.sinceRefresh += Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;
    if (this.sinceRefresh < 1 / TOMBS_HUD_HZ) return;
    this.refreshNow();
  }

  refreshNow(): void {
    this.sinceRefresh = 0;
    this.render(this.hooks.readout());
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.fields.clear();
    this.root.remove();
  }

  // -------------------------------------------------------------------------

  private field(doc: Document, name: string, css: string): HTMLElement {
    const line = el(doc, 'div', css);
    line.dataset.field = name;
    this.fields.set(name, line);
    return line;
  }

  private button(doc: Document, action: string, label: string): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    button.style.cssText = CSS.button;
    const press = (): void => {
      this.hooks.onAction(action);
      this.refreshNow();
    };
    button.addEventListener('click', press);
    this.detach.push(() => button.removeEventListener('click', press));
    return button;
  }

  private set(name: string, text: string): void {
    const node = this.fields.get(name);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private render(r: TombsReadout): void {
    this.set(TOMBS_FIELD.room, roomLine(r.room));
    this.set(TOMBS_FIELD.pos, posLine(r.x, r.y, r.z));
    this.set(TOMBS_FIELD.lighting, lightingLine(r.lighting));
    this.set(TOMBS_FIELD.array, arrayLine(r.running));
    this.set(TOMBS_FIELD.draws, drawsLine(r.drawCalls));
    this.set(TOMBS_FIELD.people, peopleLine(r.standing, r.missing));
    this.set(TOMBS_FIELD.fps, fpsLine(r.fps));
    this.set(TOMBS_FIELD.mode, modeLine(r.walking, r.stance));
    this.set(TOMBS_FIELD.prompt, promptLine(r.prompt));
    this.set(TOMBS_FIELD.audio, audioLine(r.audioRunning, r.decoded, r.failed, r.playing));
    this.setReach(r.reachLabel);
    this.setDialogue(r);
    // The two buttons offer the CHANGE; the two lines above report the state.
    const lever = leverLabel(r.lighting);
    if (this.lever.textContent !== lever) this.lever.textContent = lever;
    const array = arrayLabel(r.running);
    if (this.array.textContent !== array) this.array.textContent = array;
    const walk = walkLabel(r.walking);
    if (this.walk.textContent !== walk) this.walk.textContent = walk;
    // RUN is offered only while there is a body to run: on a flying
    // camera it would be a control with nothing to act on. Its WORD is
    // the way back, like every other control on this HUD — a button
    // that still reads RUN after it has been pressed is a control the
    // player cannot tell the state of.
    this.run.style.display = r.walking ? '' : 'none';
    const run = runLabel(r.sprinting);
    if (this.run.textContent !== run) this.run.textContent = run;
  }

  /**
   * THE PANE FOLLOWS THE LINE, and the line is the only thing that
   * decides whether it exists. `lineAt === 0` is the chapter not started;
   * `lineAt === 1` is the first line, where PREV has nowhere to go and so
   * is not built.
   */
  private setDialogue(r: TombsReadout): void {
    if (r.lineAt < 1) {
      this.dialogueText.style.display = 'none';
      this.dropPrev();
      if (this.next.textContent !== AUDIO_LABEL) this.next.textContent = AUDIO_LABEL;
      return;
    }
    this.dialogueText.style.display = '';
    const beat = beatLine(r.beatTitle);
    const where = progressLine(r.lineAt, r.lineCount);
    // The beat is a title and the counter is a number, and a reader wants
    // both on one line: `THE SMARTER SCIENTIST · 8 / 85`. A chapter with
    // no beats written yet prints the counter alone rather than a dot
    // with nothing before it.
    this.set(TOMBS_FIELD.beat, beat === '' ? where : `${beat} · ${where}`);
    this.set(TOMBS_FIELD.speaker, speakerLine(r.speaker));
    this.set(TOMBS_FIELD.line, dialogueLine(r.text));
    const next = audioLabel(true);
    if (this.next.textContent !== next) this.next.textContent = next;
    if (r.lineAt > 1) {
      if (this.prev === null) {
        this.prev = this.button(this.dialogue.ownerDocument, TOMBS_ACTION.prevLine, PREV_LABEL);
        this.dialogueControls.insertBefore(this.prev, this.next);
      }
    } else {
      this.dropPrev();
    }
  }

  private dropPrev(): void {
    if (this.prev === null) return;
    this.prev.remove();
    this.prev = null;
  }

  /** The prompt and its control appear together and go together. */
  private setReach(label: string): void {
    const want = interactLabel(label);
    if (want === '') {
      this.promptRow.style.display = 'none';
      if (this.interact !== null) {
        this.interact.remove();
        this.interact = null;
      }
      return;
    }
    this.promptRow.style.display = '';
    if (this.interact === null) {
      this.interact = this.button(this.promptRow.ownerDocument, TOMBS_ACTION.interact, want);
      this.promptRow.appendChild(this.interact);
    } else if (this.interact.textContent !== want) {
      this.interact.textContent = want;
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.style.cssText = css;
  return node;
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function buildTombsLabScene(ctx: SceneContext, hooks: TombsLabHooks): TombsLabScene {
  const three = new THREE.Scene();
  // The plan is expanded ONCE: it is a pure function of a frozen
  // specification, and everything after this reads the same object.
  const layout = planLab();
  const roomIds: readonly RoomId[] = layout.rooms.map((room) => room.id);

  const free = new FreeFlyCamera(FOV, NEAR, FAR);
  // A building, not an island: 1 m/s at a nudge, 5 m/s at a full push (the header).
  free.speed = CAMERA_SPEEDS.slow;
  const stats = new FrameStats();

  const fog = new THREE.Fog(LIGHTING.normal.fog, FOG_NEAR, FOG_FAR);
  const background = new THREE.Color(LIGHTING.normal.fog);
  three.fog = fog;
  three.background = background;

  let view: LabView | null = null;
  let people: LabPeople | null = null;
  let hud: TombsHud | null = null;
  let stick: MoveStick | null = null;
  let offKey: (() => void) | null = null;

  let lighting: LightMode = 'normal';
  let arrayRunning = false;

  // ---------------------------------------------------------------- THE BODY
  //
  // THE PLAYER IS JACK, which is why the walking body wears his model and
  // why the idle copy of him at the next desk is hidden while it is being
  // walked. Chapter 1 opens on Jack at his workstation; a room containing
  // the player AND a second Jack standing beside him is a bug the moment
  // you look at it. FLY mode has no body, so the plan's own room comes
  // straight back the instant the camera takes over again.
  //
  // The collision index is built ONCE from the plan. It is the same
  // `Slab.solid` the renderer reads and the same one a server would hold
  // — `world/tombs/types.ts`'s third rule, cashed in: the player does not
  // get a private list.
  const solids: LabSolids = indexLab(layout);
  /**
   * THE BODY. `spawn.yaw` is a CAMERA yaw — the plan's own "looking up
   * the room" — and an actor's heading is a half turn from it
   * (`FreeFlyCamera.headingOfYaw`). The two share the name `rotation.y`
   * and are not the same number: a camera at yaw 0 looks down -Z, and a
   * body at heading 0 walks and faces +Z. Every heading in this file
   * goes through that one conversion.
   */
  const walker: WalkerState = newWalkerState(
    layout.spawn.at.x, layout.spawn.at.y, layout.spawn.at.z, headingOfYaw(layout.spawn.yaw));
  const ray = newRayHit();
  const intent = newMutableIntent();
  const turns: MutableJointTurn[] = Array.from({ length: HUMAN_POSE_TURNS }, newJointTurn);
  const gait: { stance: HumanStance; phase: number; seconds: number; lean: number } = {
    stance: 'stand', phase: 0, seconds: 0, lean: 0,
  };
  const aim = new THREE.Vector3();
  /** Where the walker stood when the body was last posed, for its stride. */
  const strode = { x: walker.x, z: walker.z };
  /**
   * THE FEET (`actor/humanFeet`): after the pose, each foot is put on the
   * floor under it and HELD there while it carries weight, and the body
   * comes down onto the lower one — the feet drive the body. They let go
   * while the walker is in the air. Every floor here has full grip; the
   * rule for one that does not is `FootGround.grip`, read per solid when a
   * solid has a surface to say so.
   */
  let feet: FeetState | null = null;
  const feetTurns: MutableJointTurn[] = [];
  const underFoot: { y: number; grip: number } = { y: 0, grip: 1 };
  const footFrame = {
    dt: 0, released: false, rootX: 0, rootY: 0, rootZ: 0, rootYaw: 0, unitsPerMetre: 1,
    groundAt: (x: number, z: number, fromY: number): FootGround | null => {
      const y = groundUnder(solids, x, z, fromY);
      if (!Number.isFinite(y)) return null;
      underFoot.y = y;
      return underFoot;
    },
  };

  /**
   * `world/tombs/collide` satisfies `WalkWorld` structurally, which is
   * the whole point of the walker declaring its own query interface: the
   * pure locomotion never imports the building, and the building never
   * hears of a walker.
   */
  const walkWorld: WalkWorld = {
    moveBody: (from, radius, height, delta, out) => moveBody(solids, from, radius, height, delta, out),
    groundUnder: (x, z, fromY) => groundUnder(solids, x, z, fromY),
    ceilingOver: (x, z, fromY) => ceilingOver(solids, x, z, fromY),
  };

  // ------------------------------------------------- THE HEAD AND THE HANDS
  //
  // THE PLAYER MOVES THE BODY; THE HEAD AND THE HANDS FOLLOW (Joshua,
  // 2026-09-30: "you can move the body around, but some of the hands and
  // head movements are automatic... press a button on mobile (like 'E'
  // for computer) to trigger the animations"). The head is a raycast to a
  // target every frame (`actor/humanAim`); the hands go to targets and let
  // go by REACH, not by angle (`actor/humanReach`); and what the targets
  // are comes from the plan's own interaction (`./labUse`). INTERACT — the
  // prompt button, or E — is the only thing that starts a use.
  let aimState: AimState | null = null;
  let reachState: ReachState | null = null;
  const aimTurns: MutableJointTurn[] = [];
  const reachTurns: MutableJointTurn[] = [];
  const seatTurns: MutableJointTurn[] = Array.from({ length: SEATED_TURNS }, newJointTurn);
  /** Metres the seated pose lifts the soles; once per body. */
  let seatDrop: number | null = null;
  const lookPoint = { x: 0, y: 0, z: 0 };
  const aimFrame = {
    dt: 0, rootX: 0, rootY: 0, rootZ: 0, rootYaw: 0, unitsPerMetre: 1,
    target: null as Vec3 | null, bodyFree: false,
  };
  const handsNow: HandTarget[] = [];
  const reachFrame = {
    dt: 0, rootX: 0, rootY: 0, rootZ: 0, rootYaw: 0, unitsPerMetre: 1, seated: false,
    hands: handsNow as readonly HandTarget[],
  };
  /**
   * WHAT THE BODY IS DOING WITH ITS HANDS — the one latch this needs, in
   * one object. `seat` is a sit (a toggle: the stick gets you up); `act`
   * is a press, a grip or a look, which can happen WHILE seated — the
   * intercom is on Jack's desk. Everything else is derived every frame.
   */
  const using = {
    seat: null as LabUse | null,
    act: null as LabUse | null,
    /** Seconds into the current act — or into its approach, while `approaching`. */
    age: 0,
    /** Walking up to a press or a grip before the hand goes out. */
    approaching: false,
    /** Where the body stood before it sat, to stand back up there rather than inside the chair. */
    fromX: 0,
    fromZ: 0,
    fromHeading: 0,
    /** The seated body's roll toward what it reaches for (`labUse.rollStep`), metres, and toward what. */
    roll: 0,
    rollToward: null as Vec3 | null,
  };
  const rolled = { x: 0, z: 0 };

  let walking = false;
  let sprinting = false;
  let body: THREE.Object3D | null = null;
  let bodyRig: HumanRig | null = null;
  let bodyMeasure: HumanMeasure | null = null;
  /** The badge on the player's chest (`view/HumanBadge`), and the template it was cloned from. */
  let bodyBadge: BadgeHandle | null = null;
  let badgeTemplate: THREE.Object3D | null = null;
  let clock = 0;

  const audio = new AudioEngine({ manifest: AUDIO_MANIFEST, levels: MIX_DEFAULTS, assets });
  /** The player's faders, taken from Settings; `MIX_DEFAULTS` where there are none. */
  const applyMix = (): void => { audio.setLevels(hooks.settings?.()?.mix ?? MIX_DEFAULTS); };
  const audioStatus: AudioStatus = newAudioStatus();
  /**
   * Which chapter-1 line the next press speaks. It WALKS THE CHAPTER
   * rather than replaying one line, because the thing being judged is
   * whether eighty-eight clips are all reachable and all sound like the
   * same room — which one clip on repeat cannot answer.
   */
  let lineAt = 0;

  const readout: MutableReadout = {
    room: OUTSIDE_ROOM, lighting: 'normal', running: false, drawCalls: 0, standing: 0, missing: 0, fps: 0, x: 0, y: 0, z: 0,
    walking: false, stance: 'stand', sprinting: false, prompt: '', reachLabel: '',
    audioRunning: false, decoded: 0, failed: 0, playing: 0,
    lineAt: 0, lineCount: AUDIO_MANIFEST.voice.length, speaker: '', text: '', beatTitle: '',
  };

  /** The air this lighting wants: the view's own look while it stands, the same table before it is built. */
  const air = (): LightingLook => (view === null ? LIGHTING[lighting] : view.lighting);

  /** The fog and the background follow the lever, because a Group cannot own `Scene.fog` (`LabView`'s header). */
  const applyAir = (): void => {
    const look = air();
    fog.color.setHex(look.fog);
    background.setHex(look.fog);
  };

  /** The floor of a room, in local metres: the underside of its interior volume. */
  const floorOf = (room: Room): number => room.inside.at.y - room.inside.size.y / 2;

  /**
   * Stand the eye at a place on a floor, both in the PLAN'S metres, and
   * keep whatever it is looking along. THE ONE PLACE metres become the
   * camera's world units (the header).
   */
  const standAt = (x: number, floor: number, z: number, yaw: number, pitch: number): void => {
    free.place(x * M, FLOOR_UNITS + (floor + EYE_HEIGHT_M) * M, z * M, yaw, pitch);
  };

  /** The camera's place read back into the plan's metres, written into the scratch point. */
  const metresOf = (): MutableVec3 => {
    // WALKING, THE PLACE THAT MATTERS IS THE FEET. The camera is on a
    // boom behind the head and is pulled in by whatever is behind it, so
    // reading it back would report a point that is partly a function of
    // the wall — useless for checking a position against the floor plan,
    // which is the whole reason this line exists.
    if (walking) {
      POINT.x = walker.x;
      POINT.y = walker.y;
      POINT.z = walker.z;
      return POINT;
    }
    const p = free.camera.position;
    POINT.x = p.x / M;
    POINT.y = (p.y - FLOOR_UNITS) / M;
    POINT.z = p.z / M;
    return POINT;
  };

  /**
   * WHAT IS IN REACH, worked out from where the body IS — never
   * remembered from the last frame.
   *
   * It used to be a field written once per frame in `walkTheBody`, and
   * that is a latch on a fact that is already measurable. THE HUD
   * REPAINTS ON THE PRESS (`TombsHud.button`), so a teleport repainted
   * the room line from the body's new place and the prompt from the desk
   * the body had just left — a control offering to read a run log two
   * rooms away, and no frame in between to correct it. Deriving it costs
   * a walk over a handful of points; remembering it cost a lie.
   *
   * Null while the camera is flying: a prompt belongs to a body, and
   * there is no body to reach with.
   */
  const reachNow = (): Interaction | null => {
    if (!walking) return null;
    const seat = using.seat;
    if (seat === null) return nearestInteraction(layout, { x: walker.x, y: walker.y + EYE_HEIGHT_M, z: walker.z });
    // SEATED, the desk you sit at is not what INTERACT offers — the stick
    // gets you up — but the next thing in reach from the chair is: Jack's
    // intercom, from his. Measured from the SEATED eye.
    const eyeY = walker.y + SEATED_EYE_M;
    let best: Interaction | null = null;
    let bestD = Infinity;
    for (const i of layout.interactions) {
      if (i.id === seat.id) continue;
      const d = Math.hypot(i.at.x - walker.x, i.at.y - eyeY, i.at.z - walker.z);
      if (d <= i.reach && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  };

  const roomNow = (): Room | null => {
    const at = metresOf();
    for (const room of layout.rooms) if (holds(room.inside, at)) return room;
    return null;
  };

  const readoutNow = (): TombsReadout => {
    const room = roomNow();
    // `metresOf` wrote the scratch point on the way through `roomNow`, and
    // nothing has moved the camera since.
    readout.room = room === null ? OUTSIDE_ROOM : room.name;
    readout.lighting = lighting;
    readout.running = arrayRunning;
    readout.drawCalls = view === null ? 0 : view.stats.drawCalls;
    readout.standing = people === null ? 0 : people.standing;
    readout.missing = people === null ? 0 : people.placeholders;
    readout.fps = stats.summary().meanFps;
    readout.x = POINT.x;
    readout.y = POINT.y;
    readout.z = POINT.z;
    readout.walking = walking;
    readout.stance = walker.stance;
    readout.sprinting = sprinting;
    const reach = reachNow();
    if (reach === null && using.seat !== null) {
      // Nothing else to reach from the chair: the button gets you up.
      readout.prompt = 'Push the stick to stand';
      readout.reachLabel = GET_UP_LABEL;
    } else if (reach !== null && using.act !== null && using.act.mode === 'look' && using.act.id === reach.id) {
      readout.prompt = reach.prompt;
      readout.reachLabel = LOOK_AWAY_LABEL;
    } else {
      readout.prompt = reach === null ? '' : reach.prompt;
      readout.reachLabel = reach === null ? '' : reach.label;
    }
    audio.readStatus(audioStatus);
    readout.audioRunning = audioStatus.state === 'running';
    readout.decoded = audioStatus.decoded;
    readout.failed = audioStatus.failed + audioStatus.missing;
    readout.playing = audioStatus.playing;
    return readout;
  };

  const setLighting = (mode: LightMode): void => {
    lighting = mode;
    view?.setLighting(mode);
    applyAir();
  };

  const setArray = (running: boolean): void => {
    arrayRunning = running;
    view?.setArrayRunning(running);
  };

  /**
   * Into the middle of a room, at eye height above ITS floor, still
   * looking the way the visitor was looking — a step across the
   * building, not a turn as well, which is the least disorienting thing
   * a teleport can be. The coordinates are the LAYOUT'S: nothing about
   * a room is typed in this file.
   */
  const teleport = (id: RoomId): void => {
    for (const room of layout.rooms) {
      if (room.id !== id) continue;
      const pose = free.pose();
      standAt(room.inside.at.x, floorOf(room), room.inside.at.z, pose.yaw, pose.pitch);
      // AND THE BODY GOES TOO. Without this the room buttons silently
      // stop working the moment you stand up: the camera is moved, and
      // the very next frame `walkTheBody` puts it back at the head of a
      // body that never left. The teleport looked broken; it was the
      // camera being overruled by the thing it is supposed to follow.
      if (walking) {
        standUp();
        using.act = null;
        walker.x = room.inside.at.x;
        walker.z = room.inside.at.z;
        walker.y = floorOf(room);
        walker.vx = 0;
        walker.vz = 0;
        walker.vy = 0;
      }
      return;
    }
  };

  /**
   * Stand up, or go back to flying.
   *
   * Entering WALK drops the body where the camera is standing and faces
   * it the way the camera looks, so the switch is continuous rather than
   * a teleport. Leaving it hands the camera back exactly where the eye
   * already was, for the same reason.
   */
  const setWalking = (want: boolean): void => {
    if (want === walking) return;
    standUp();
    using.act = null;
    walking = want;
    feet = null;
    people?.hide('jack', want);
    if (body !== null) body.visible = want;
    // The body is put down somewhere new: what the badge remembers of its
    // last motion belongs to the last walk.
    bodyBadge?.reset();
    if (!want) return;
    const at = metresOf();
    const pose = free.pose();
    walker.x = at.x;
    walker.z = at.z;
    walker.heading = headingOfYaw(pose.yaw);
    walker.vx = 0;
    walker.vz = 0;
    walker.vy = 0;
    // Onto whatever is under the camera, so standing up never starts in a
    // fall from wherever the free camera happened to be flying.
    walker.y = groundUnder(solids, at.x, at.z, at.y);
    if (!Number.isFinite(walker.y)) walker.y = at.y - EYE_HEIGHT_M;
  };

  /**
   * THE TAP THAT UNLOCKS THE SOUND, and the next line of chapter 1.
   *
   * `unlock()` must be called from inside a real gesture — an
   * AudioContext on iOS starts suspended and silence is indistinguishable
   * from a bug — so this is wired to a button and not to `enter()`. The
   * room's own bed starts with it, because a voice line with no room
   * behind it is the thing four separate buses exist to let you balance.
   */
  const speak = async (step: 1 | -1): Promise<void> => {
    const lines = AUDIO_MANIFEST.voice;
    if (lines.length === 0) return;
    // WHERE THE STEP LANDS IS DECIDED BEFORE THE AWAIT, and written to
    // the readout before it too. `unlock()` is a round trip on the first
    // press, and a pane that only caught up after the audio device did
    // would sit blank through it — the reader is watching the words, not
    // the decoder.
    const want = lineAt === 0 && step === 1 ? 1 : lineAt + step;
    if (want < 1 || want > lines.length) return;
    lineAt = want;
    publishLine();
    const ok = await audio.unlock();
    if (!ok) return;
    // The faders may have moved since the last line: Settings is one
    // screen away and this tool is not disposed by opening it.
    applyMix();
    if (AUDIO_MANIFEST.sounds.some((a) => a.assetId === LAB_BED)) void audio.startBed(LAB_BED);
    void audio.playLine(lines[want - 1].lineId);
  };

  /**
   * WHAT THE PANE SAYS, quoted and never composed. The speaker and the
   * words are the manifest's own fields; the beat is whichever of
   * `story/chapter1.ts`'s fourteen owns this line, and EMPTY when none
   * does — chapters 2 to 6 are in the story repository and have no beats
   * written yet, and a pane that guessed a title for them would be
   * inventing structure the chapter does not have.
   */
  const publishLine = (): void => {
    const line = lineAt >= 1 ? AUDIO_MANIFEST.voice[lineAt - 1] : null;
    readout.lineAt = line === null ? 0 : lineAt;
    readout.lineCount = AUDIO_MANIFEST.voice.length;
    readout.speaker = line?.characterName ?? '';
    readout.text = line?.text ?? '';
    readout.beatTitle = line === null ? '' : beatOfLine(line.lineId)?.title ?? '';
  };

  /**
   * ONE FRAME OF THE WALKING BODY: what the thumbs asked for, where that
   * puts the feet, where the eye goes, and what the body looks like doing
   * it.
   *
   * THE ORDER MATTERS AND SO DOES THE CLOCK EACH STEP USES. The body is
   * the WORLD, so it integrates on SIM dt, exactly as the array's rings
   * do. The camera and the gait's breath are instruments and read RAW dt.
   * Mixing them is how a paused world ends up with a body still walking
   * across it.
   */
  /** Into the chair: the body goes to the seat, facing the keyboard, and the hands go to the keys. */
  const sitDown = (use: LabUse): void => {
    if (use.seat === null) return;
    using.fromX = walker.x;
    using.fromZ = walker.z;
    using.fromHeading = walker.heading;
    walker.x = use.seat.x;
    walker.z = use.seat.z;
    walker.heading = use.seat.yaw;
    walker.vx = 0;
    walker.vz = 0;
    walker.vy = 0;
    using.seat = use;
    using.act = null;
    using.roll = 0;
    using.rollToward = null;
    feet = null;
  };

  /** Out of the chair, back where the body stood before it sat — never inside the chair it leaves. */
  const standUp = (): void => {
    if (using.seat === null) return;
    walker.x = using.fromX;
    walker.z = using.fromZ;
    walker.heading = using.fromHeading;
    using.seat = null;
    using.act = null;
    using.roll = 0;
    using.rollToward = null;
    feet = null;
  };

  /**
   * WHERE THE HEAD AIMS, in order: what the hands are using; the thing in
   * reach (a workstation is read off its monitor); a person near and in
   * front of where the camera looks; and otherwise along the camera's own
   * line — unless that line is behind the body, when the head comes home.
   * `look` is the camera's world direction, already measured this frame.
   */
  const lookTarget = (look: THREE.Vector3, eyeY: number): Vec3 | null => {
    if (using.act !== null) return using.act.look;
    if (using.seat !== null) return using.seat.look;
    const reach = reachNow();
    if (reach !== null) return lookAtOf(layout, reach);
    const flat = Math.hypot(look.x, look.z);
    if (people !== null && flat > 1e-6) {
      let best: Vec3 | null = null;
      let bestD = PERSON_LOOK_M;
      for (const eye of people.eyes()) {
        if (eye.id === 'jack') continue; // the player is Jack; his idle double is hidden while he walks
        const dx = eye.x - walker.x;
        const dz = eye.z - walker.z;
        const d = Math.hypot(dx, dz);
        if (d >= bestD || d < 1e-6) continue;
        if ((dx * look.x + dz * look.z) / (d * flat) < PERSON_LOOK_COS) continue;
        best = eye;
        bestD = d;
      }
      if (best !== null) return best;
    }
    if (flat < 1e-6) return null;
    const facing = (Math.sin(walker.heading) * look.x + Math.cos(walker.heading) * look.z) / flat;
    if (facing < LOOK_BEHIND_COS) return null;
    lookPoint.x = walker.x + look.x * LOOK_AHEAD_M;
    lookPoint.y = eyeY + look.y * LOOK_AHEAD_M;
    lookPoint.z = walker.z + look.z * LOOK_AHEAD_M;
    return lookPoint;
  };

  /** The hands' targets this frame: the keys while seated, less any hand an act has taken, plus that act's. */
  const fillHands = (): void => {
    handsNow.length = 0;
    const act = using.act !== null && !using.approaching ? using.act : null;
    if (using.seat !== null) {
      for (const h of using.seat.hands) {
        if (act !== null && act.hands.some((a) => a.side === h.side)) continue;
        handsNow.push(h);
      }
    }
    if (act !== null) for (const h of act.hands) handsNow.push(h);
  };

  const walkTheBody = (snapshot: InputSnapshot, reading: StickReading | null, simDt: number, rawDt: number): void => {
    const yaw = free.pose().yaw;
    // The stick and the keys become ONE Intent in the body's own heading
    // frame — the same call the Creature Lab makes for a possessed ant.
    // `ground` is the medium; RUN is a button here because a thumb has no
    // shift key, and it arrives as the intent's own sprint flag.
    //
    // THE TWO CALLS WANT THE LOOK IN DIFFERENT UNITS, which is the trap
    // this seam exists to spring safely: `demandFrom` takes the CAMERA'S
    // yaw and converts inside, while `walkStep` — core, and so unable to
    // import the conversion — takes the look already in the ACTOR
    // convention. Handing the raw yaw to both is a half turn that cancels
    // itself in the movement and never does in the facing: the body walks
    // where the camera looks and stands there back to front, never
    // turning, because the steering error reads as zero.
    demandFrom(snapshot, reading, yaw, walker.heading, 'ground',
      { ...NO_BUTTONS, sprint: sprinting }, false, intent);

    // THE HANDS' OWN WALK. A press or a grip from where the body stands
    // walks it up to the thing first — approach, then reach — and the
    // stick takes the body back at any moment: out of an approach, or up
    // out of a chair. Seated, the walker stays put; the body is the chair's.
    const push = Math.hypot(intent.forward, intent.strafe);
    let steer = headingOfYaw(yaw);
    if (using.act !== null) using.age += simDt;
    if (using.seat !== null) {
      if (push > TAKE_BACK_PUSH) standUp();
    } else if (using.act !== null && using.approaching) {
      const t: Vec3 = using.act.hands.length > 0 ? using.act.hands[0] : using.act.look;
      const dx = t.x - walker.x;
      const dz = t.z - walker.z;
      if (push > TAKE_BACK_PUSH) {
        using.act = null;
      } else if (Math.hypot(dx, dz) <= STAND_OFF_M || using.age > APPROACH_SECONDS) {
        using.approaching = false;
        using.age = 0;
      } else {
        intent.forward = APPROACH_PUSH;
        intent.strafe = 0;
        intent.turn = 0;
        steer = Math.atan2(dx, dz);
      }
    }
    if (using.act !== null && !using.approaching && using.age > using.act.seconds) using.act = null;
    if (using.seat === null) walkStep(walker, walkWorld, intent, steer, simDt);
    const seated = using.seat !== null;

    // THE EYE: at the head, then pushed back along the camera's OWN
    // forward. Taking the direction from three after the rotation is
    // applied rather than rebuilding it from yaw and pitch means there is
    // no second copy of the camera's convention to get wrong.
    const eyeM = seated ? SEATED_EYE_M : EYE_HEIGHT_M;
    const headY = FLOOR_UNITS + (walker.y + eyeM) * M;
    const pose = free.pose();
    free.place(walker.x * M, headY, walker.z * M, pose.yaw, pose.pitch);
    free.camera.getWorldDirection(aim);
    // How far back the room allows. The ray leaves the HEAD and travels
    // backwards; anything it finds is a wall the camera would otherwise
    // be standing inside.
    const back = { x: -aim.x, y: -aim.y, z: -aim.z };
    const head = { x: walker.x, y: walker.y + eyeM, z: walker.z };
    const boomMax = seated ? SEATED_BOOM_M : BOOM_M;
    const hit = rayHit(solids, head, back, boomMax, ray);
    const boom = Math.max(BOOM_MIN_M, hit ? ray.distance - BOOM_MIN_M : boomMax);
    free.camera.position.addScaledVector(aim, -boom * M);

    // THE BODY. Its gait phase is advanced by DISTANCE covered rather
    // than by time, which is what keeps the feet planted at half speed;
    // the breath runs on the raw clock beside it. The distance is the
    // walker's but the stride is the BODY's (`humanStride`, in bind units,
    // `bindScale` of them to the metre): Jack's pose steps 1.1 m a cycle,
    // and the walker's 1.5 m measured-human stride slid each planted foot
    // a quarter of a step forward.
    let rootDrop = 0;
    let rootX = walker.x;
    let rootZ = walker.z;
    if (bodyRig !== null && bodyMeasure !== null) {
      let base: readonly JointTurn[];
      if (using.seat !== null && using.seat.seat !== null) {
        // SEATED: the seated pose, lowered until the soles meet the floor,
        // rolled toward whatever a hand is reaching for and cannot yet.
        base = poseSeated(bodyMeasure, bodyRig.bind, { style: 'sit', seconds: clock }, seatTurns);
        if (seatDrop === null) seatDrop = seatDropOf(bodyMeasure, bodyRig.bind, base, bodyRig.bindScale);
        rootDrop = seatDrop;
        const reaching = using.act !== null && using.act.hands.length > 0 ? using.act.hands[0] : null;
        if (reaching !== null) using.rollToward = reaching;
        const at = using.rollToward === null ? using.seat.seat : rolledToward(using.seat.seat, using.rollToward, using.roll, rolled);
        rootX = at.x;
        rootZ = at.z;
      } else {
        gait.stance = walker.stance;
        const stride = humanStride(bodyMeasure, walker.stance) / bodyRig.bindScale;
        const travelled = Math.hypot(walker.x - strode.x, walker.z - strode.z);
        if (stride > 0) gait.phase = (gait.phase + travelled / stride) % 1;
        gait.seconds = clock;
        gait.lean = walker.lean;
        const posed = poseHuman(bodyMeasure, bodyRig.bind, gait as HumanGait, turns);
        // The soles stand at bind y −1 on both masters (`view/HumanRig`).
        if (feet === null) feet = createFeet(bodyMeasure, bodyRig.bind, -1);
        footFrame.dt = simDt;
        footFrame.released = !walker.grounded;
        footFrame.rootX = walker.x;
        footFrame.rootY = walker.y;
        footFrame.rootZ = walker.z;
        footFrame.rootYaw = walker.heading;
        footFrame.unitsPerMetre = bodyRig.bindScale;
        const grounded = groundFeet(feet, bodyMeasure, bodyRig.bind, posed, footFrame, feetTurns);
        rootDrop = grounded.rootDrop;
        base = grounded.turns;
      }

      // THE HEAD, then THE HANDS, on top of the pose — the body is the
      // player's (`bodyFree: false`), so only the neck and the chest turn.
      if (aimState === null) aimState = createAim(bodyMeasure, bodyRig.bind, -1);
      if (reachState === null) reachState = createReach(bodyMeasure, bodyRig.bind, -1);
      aimFrame.dt = simDt;
      aimFrame.rootX = rootX;
      aimFrame.rootY = walker.y - rootDrop;
      aimFrame.rootZ = rootZ;
      aimFrame.rootYaw = walker.heading;
      aimFrame.unitsPerMetre = bodyRig.bindScale;
      aimFrame.target = lookTarget(aim, walker.y + eyeM);
      const aimed = aimBody(aimState, bodyMeasure, bodyRig.bind, base, aimFrame, aimTurns);
      fillHands();
      reachFrame.dt = simDt;
      reachFrame.rootX = rootX;
      reachFrame.rootY = walker.y - rootDrop;
      reachFrame.rootZ = rootZ;
      reachFrame.rootYaw = walker.heading;
      reachFrame.unitsPerMetre = bodyRig.bindScale;
      reachFrame.seated = seated;
      const reached = reachHands(reachState, bodyMeasure, bodyRig.bind, aimed.turns, reachFrame, reachTurns);
      if (seated) {
        const act = using.act !== null && !using.approaching && using.act.hands.length > 0 ? using.act.hands[0] : null;
        using.roll = rollStep(using.roll, act !== null, act !== null && reached[act.side].holding, simDt);
      }
      bodyRig.apply(reached.turns);
    }
    if (body !== null) {
      body.position.set(rootX * M, FLOOR_UNITS + (walker.y - rootDrop) * M, rootZ * M);
      body.rotation.y = walker.heading;
    }
    // After the pose AND the placement: the badge reads where the chest
    // is now. Raw time, like the breath — it is the body, not the world.
    swingBadge(bodyBadge, rawDt);
    strode.x = walker.x;
    strode.z = walker.z;
  };

  const act = (action: string): void => {
    if (action === TOMBS_ACTION.back) {
      hooks.onBack();
      return;
    }
    if (action === TOMBS_ACTION.lever) {
      // THE PHYSICAL SHUTDOWN LEVER (ch 2). It can always be pulled back.
      setLighting(lighting === 'normal' ? 'emergency' : 'normal');
      return;
    }
    if (action === TOMBS_ACTION.array) {
      setArray(!arrayRunning);
      return;
    }
    if (action === TOMBS_ACTION.walk) {
      setWalking(!walking);
      return;
    }
    if (action === TOMBS_ACTION.run) {
      sprinting = !sprinting;
      return;
    }
    if (action === TOMBS_ACTION.interact) {
      // THE BODY DOES IT; THE WORLD DOES NOT CHANGE YET. Pressing sits at a
      // workstation with the hands on the keys, presses an intercom, grips
      // the lever or reads a console — all of it the body (`./labUse`).
      // What the press does NOT do is pretend the world answered: no screen
      // changes and no call connects, so the plan's own words still go to
      // the console rather than to a HUD line claiming a result.
      const reach = reachNow();
      if (reach === null) {
        standUp();
        return;
      }
      console.info(`[tombs] ${reach.label}: ${reach.prompt} (${reach.doing})`);
      if (using.act !== null && using.act.mode === 'look' && using.act.id === reach.id) {
        using.act = null;
        return;
      }
      if (bodyMeasure === null) return;
      const from = using.seat !== null && using.seat.seat !== null
        ? using.seat.seat : { x: walker.x, z: walker.z, yaw: walker.heading };
      const use = useOf(layout, reach, from, bodyMeasure.leftSign < 0 ? -1 : 1);
      if (use.mode === 'sit') {
        sitDown(use);
        return;
      }
      using.act = use;
      using.age = 0;
      // Seated, the chair rolls instead (`labUse.rollStep`); standing, the body walks up to it first.
      using.approaching = using.seat === null && use.hands.length > 0;
      return;
    }
    if (action === TOMBS_ACTION.audio) {
      void speak(1);
      return;
    }
    if (action === TOMBS_ACTION.prevLine) {
      void speak(-1);
      return;
    }
    const room = teleportedRoomOf(action, roomIds);
    if (room !== null) teleport(room);
  };

  return {
    name: TOMBS_SCENE_ID,
    three,
    layout,
    free,
    get camera(): THREE.Camera {
      return free.camera;
    },
    get view(): LabView | null {
      return view;
    },
    get lighting(): LightMode {
      return lighting;
    },
    get arrayRunning(): boolean {
      return arrayRunning;
    },
    roomNow,
    act,

    async enter() {
      // THE PLAYER'S OWN SETTINGS, read once: the rung the building is
      // drawn at, and the three that belong to the eye itself. The camera
      // SPEED is deliberately not among them (the header).
      const settings = hooks.settings?.() ?? null;
      const detail: DetailTier = settings?.detail === undefined ? RUNG_FALLBACK : detailFor(settings.detail);
      if (settings?.fov !== undefined) free.setFov(settings.fov);
      free.setLook({ sensitivity: settings?.lookSensitivity ?? 1, invertY: settings?.invertY ?? false });
      applyMix();

      // THE SCREENS' PICTURE, off the texture ladder at the rung the
      // player's Textures setting picks. Awaited before the building is
      // built because `LabView` reads it once, at `build`, to choose the
      // screens' geometry as well as their material — and it is 12 KiB at
      // medium, so waiting for it costs nothing anyone can feel. A null
      // (no network, a bad path) leaves the screens as the dark glass
      // they have always been; it is never a reason not to draw a room.
      const rung = tierFor(settings?.textures ?? 'medium');
      const screenTexture = await assets.loadTexture(textureUrl('tombs-screen', rung));
      if (screenTexture !== null) {
        screenTexture.colorSpace = THREE.SRGBColorSpace;
        screenTexture.anisotropy = 4;
      }

      // THE SURFACES' OWN TEXTURES, fetched together and at the same rung.
      // They REPEAT, so unlike the screen atlas they wrap — and the
      // building is drawn whether or not any of them arrive.
      const surfaceTextures: Record<string, THREE.Texture> = {};
      await Promise.all(SURFACE_TEXTURES.map(async (name) => {
        const map = await assets.loadTexture(textureUrl(name as never, rung));
        if (map === null) return;
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = 8;
        surfaceTextures[name] = map;
      }));

      // `ambient: true`: nothing else lights this scene — there is no sky
      // here to wash, which is the case `LabView` asks for it in.
      // `shadows: false`: no sun either, so a shadow flag on every mesh
      // would be a promise nothing in this scene can keep.
      view = new LabView({
        groundUnits: FLOOR_UNITS, ambient: true, detail: detail, shadows: false,
        screenTexture, surfaceTextures,
      });
      view.build(layout);
      view.setLighting(lighting);
      view.setArrayRunning(arrayRunning);
      three.add(view.group);
      applyAir();

      // JACK AND SARAH, at their own desks. NOT AWAITED: the building is
      // already drawn and the door should open on it, not on a network
      // round trip for 6 MB of human. They arrive when they arrive, and
      // `build` never rejects — one unreachable file cannot take the
      // scene's entry down with it.
      //
      // `shadows: false` for the same reason `LabView` gets it: there is
      // no sun in here, so a shadow flag is a promise nothing in this
      // scene can keep.
      people = new LabPeople({ groundUnits: FLOOR_UNITS, shadows: false });
      three.add(people.group);
      void people.build(layout);

      // WHERE A NEW GAME BEGINS (`LabSpec.spawn`): on the laboratory
      // floor between the workstations, facing north up the room —
      // chapter 1's opening shot. The spawn's yaw is already three's own
      // `rotation.y` convention, which is `FreeFlyCamera`'s yaw, so it is
      // passed through and not negated.
      standAt(layout.spawn.at.x, layout.spawn.at.y, layout.spawn.at.z, layout.spawn.yaw, 0);

      // THE PLAYER'S OWN BODY, loaded the same way the room's people are
      // and NOT AWAITED for the same reason. It starts hidden: the scene
      // opens on the free camera, and a body standing in the room with
      // nobody driving it would be a third person at the desks.
      // A body that does not arrive costs the THIRD PERSON, not the
      // player: the walker still walks, the camera still looks and the
      // room is still solid, because none of that is drawn by the body.
      // So the placeholder is an empty node and a line in the console
      // rather than a magenta column standing where a person should be.
      void assets.loadModel('models/jack.glb', () => {
        console.error('[tombs] the player body did not load; walking continues in first person');
        return new THREE.Object3D();
      }).then((model) => {
        if (view === null) {
          release(model);
          return;
        }
        model.name = 'tombs-player';
        model.scale.setScalar(M);
        model.visible = walking;
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh === true) mesh.frustumCulled = false;
        });
        try {
          bodyRig = new HumanRig(model);
          bodyMeasure = measureHuman(bodyRig.bind);
        } catch (error) {
          console.error('[tombs] the player body could not be posed; it keeps its bind pose', error);
        }
        body = model;
        three.add(model);
        // HIS BADGE, on its own file and its own schedule: the body never
        // waits for it, and a badge that does not arrive is a line in the
        // console and a chest without one.
        void assets.loadModel('models/badge.glb', () => new THREE.Object3D()).then((template) => {
          if (view === null || body !== model) {
            release(template);
            return;
          }
          if (template.userData.isPlaceholder === true) {
            console.error('[tombs] models/badge.glb did not load; the player walks without a badge');
            return;
          }
          badgeTemplate = template;
          const rig = bodyRig;
          const measure = bodyMeasure;
          if (rig === null || measure === null) return;
          try {
            bodyBadge = attachBadge(model, measure, rig.bind, template, { rest: () => rig.rest(), label: 'player' });
          } catch (error) {
            console.error('[tombs] the player badge could not be hung', error);
          }
        });
      });

      hud = new TombsHud(ctx.uiLayer, layout.rooms, { readout: readoutNow, onAction: act });
      // THE STICK — the same fixed, visible one the Performance World and
      // the Creature Lab read, bottom-left, under the left thumb.
      stick = new MoveStick(ctx.uiLayer);

      offKey = ctx.input.onKeyDown((code) => {
        if (code === 'Escape') hooks.onBack();
        // E is INTERACT at a keyboard, as the prompt button is under a thumb.
        if (code === 'KeyE') act(TOMBS_ACTION.interact);
      });
      hud.refreshNow();
    },

    update(frame: FrameInfo) {
      stats.record(frame.rawDt, frame.simDt);
      clock += frame.rawDt;
      const snapshot = ctx.input.snapshot();
      const reading = stick === null ? null : stick.read();
      // THE EYE, by RAW dt: keys and the stick together, camera-relative,
      // the way every free camera in this build flies.
      //
      // WALKING, THE STICK IS THE BODY'S and only the LOOK is the
      // camera's, so it is withheld here and handed to `demandFrom`
      // instead. The keys still reach the free camera and still move it;
      // its position is overwritten below, which is cheaper than teaching
      // it a second mode and leaves one camera in this file rather than
      // two.
      free.update(snapshot, frame.rawDt, walking ? null : reading);
      if (walking) walkTheBody(snapshot, reading, frame.simDt, frame.rawDt);
      // THE RINGS, by SIM dt: they are the world, not an instrument.
      view?.update(frame.simDt);
      // THE PEOPLE, by RAW dt. Their breath and their sway are not the
      // world advancing — a paused room with two bodies frozen mid-breath
      // reads as the renderer having died, which is the same argument the
      // camera and the HUD are on raw time for.
      // Everyone in reach turns their head to the player's eye.
      people?.lookAt(walking && aimState !== null ? aimState.eye : null);
      people?.update(frame.rawDt);
      audio.update(frame.rawDt);
      hud?.update(frame.rawDt);
    },

    resize(width: number, height: number) {
      free.resize(width, height);
    },

    dispose() {
      offKey?.();
      offKey = null;
      hud?.dispose();
      hud = null;
      stick?.dispose();
      stick = null;
      if (view !== null) {
        three.remove(view.group);
        view.dispose();
        view = null;
      }
      // The badge comes off before the body is released: `release` walks
      // the body and would free the template's shared geometry with it.
      bodyBadge?.dispose();
      bodyBadge = null;
      if (badgeTemplate !== null) {
        release(badgeTemplate);
        badgeTemplate = null;
      }
      if (body !== null) {
        three.remove(body);
        bodyRig?.dispose();
        bodyRig = null;
        bodyMeasure = null;
        feet = null;
        aimState = null;
        reachState = null;
        seatDrop = null;
        using.seat = null;
        using.act = null;
        release(body);
        body = null;
      }
      void audio.dispose();
      // A body may still be in flight; `LabPeople` abandons it by epoch.
      if (people !== null) {
        three.remove(people.group);
        people.dispose();
        people = null;
      }
      three.fog = null;
      three.background = null;
    },
  };
}

/**
 * The factory the scene registry binds to `TOMBS_SCENE_ID`. Takes a
 * WIRE, not the hooks themselves, so the hooks are built from the
 * `SceneContext` the SceneManager hands over at open time — the shape
 * `createCreatureLabScene` and `createNetworkLabScene` already have, and
 * what lets the integration pass register this tool in one expression.
 */
export function createTombsLabScene(wire: TombsLabWire): SceneFactory {
  return (ctx) => buildTombsLabScene(ctx, wire(ctx));
}
