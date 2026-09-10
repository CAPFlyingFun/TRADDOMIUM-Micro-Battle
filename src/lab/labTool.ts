/**
 * The Creature Lab's entry in the Editors / Dev Tools hub, and the names
 * its controls and readouts answer to.
 *
 * A plain record, like `perf/perfTool.ts` and `devtools/netLabTool.ts`:
 * the tool IS a scene, and the hub opens it by asking the SceneManager
 * for `sceneId`. The id is NOT under the `world:` prefix on purpose — a
 * world scene is entered through the loading screen with a solo session
 * behind it, and the Lab needs no session: it is one cubic metre of
 * bench with five animals on it and a control ledger of its own
 * (`creatures/control.ts`), opened in the `menu` state like the Network
 * Lab, with a BACK control rather than a pause menu.
 *
 * EVERY CONTROL AND EVERY READOUT IS NAMED HERE, so a test and the probe
 * (`scripts/probe-lab.mjs`) drive the buttons a player presses and read
 * the words a player reads (`app/actions.ts` rule) — and so the scene,
 * the UI and the tests cannot drift apart on a string. The names are
 * the brief's, fixed before the scene was written: the possess row is
 * `lab:possess:<species>`, the per-creature overlay block is
 * `lab-<species>`, and the rest are listed below.
 *
 * WHAT A MEDIUM MAY PRESS (`buttonsFor`). The right-thumb cluster shows
 * only the buttons the held creature's body can honour, because "an
 * unavailable action must never look functional" (ARCHITECTURE §2.9):
 * a worker has no UP, a worm has no B, an aphid has neither UP nor DOWN.
 * The rule is read off the same seam the demand goes through —
 * `control/PlayerDemand.verticalFor` says which media read a vertical,
 * and `creatures/demand.wordFor` says what `secondary` means to whom —
 * so the cluster and the body agree by construction, not by a second
 * list kept in step by hand.
 *
 * Pure: no three, no DOM. The species table is read for its names.
 */
import type { DevTool } from '../devtools/DevTool';
import { CREATURE_SPECIES, type CreatureId, type CreatureSpecies, type Medium } from '../creatures/species';
import type { PredationPolicy } from '../creatures/world';

/** The registry id the integration pass binds to `createCreatureLabScene`. */
export const LAB_SCENE_ID = 'lab:creatures';

/** The tool's id: it becomes the hub card's OPEN action, `tool:lab.creatures` (`devtools/DevTool.toolAction`). */
export const LAB_TOOL_ID = 'lab.creatures';

export const creatureLabTool: DevTool = {
  id: LAB_TOOL_ID,
  title: 'Creature Lab',
  description:
    'One cubic metre of bench: a winged queen, a worker, an earthworm, an aphid and a housefly living their AI ' +
    'together. Tap one to drive it; the rest keep living. Free camera, disturbance tool, per-creature readouts.',
  sceneId: LAB_SCENE_ID,
};

/** The `data-role` of the HUD's root element: what a probe waits for to know the lab is up. */
export const LAB_HUD_ROLE = 'creature-lab-hud';

/**
 * The lab's own controls, as `data-action` names. Prefixed so they can
 * never collide with the app's vocabulary (`app/actions.ts`); the shared
 * `back` is the app's own.
 */
export const LAB_ACTION = {
  /** CONTROL = NONE / OBSERVE: the ledger is cleared and the free camera watches all five (brief §29). */
  observe: 'lab:observe',
  /** Follow the held creature, or fly free — a toggle, available only while someone is held. */
  camera: 'lab:camera',
  /** PREDATION: OFF → NORMAL → FORCE → OFF (brief §25). */
  predation: 'lab:predation',
  /** Arm the next tap to emit a synthetic disturbance at the tapped ground point (brief §30). */
  disturb: 'lab:disturb',
  /** CAMERA DISTURBS CREATURES: ON / OFF (brief §30). Default off. */
  cameraDisturbs: 'lab:camera-disturbs',
  /** RESET LAB: the deterministic five, the queen held again, no page reload (brief §26). */
  reset: 'lab:reset',
  /** The per-creature debug overlay on or off (brief §8). */
  debug: 'lab:debug',
  /** THE STRESS TEST: start a run, or stop the one running (Joshua, 2026-09-10). */
  stress: 'lab:stress',
  /** Run the same test again — the same seeded sequence, from the same bench. */
  stressAgain: 'lab:stress-again',
  /** Clear the report and put the bench back to its five. */
  stressReset: 'lab:stress-reset',
  /** Put the finished report on the clipboard. */
  stressCopy: 'lab:stress-copy',
  /** RIGS: ALL (one animated skeleton per creature) or RUNG (the detail budget, the rest as impostors). */
  rigs: 'lab:rigs',
} as const;

export type LabAction = (typeof LAB_ACTION)[keyof typeof LAB_ACTION];

const POSSESS_PREFIX = 'lab:possess:';

/** The possess row's action for a species: `lab:possess:queen`. */
export function possessAction(species: CreatureId): string {
  return `${POSSESS_PREFIX}${species}`;
}

/** The species a possess action names, or null for any other string. */
export function possessedSpeciesOf(action: string): CreatureId | null {
  if (!action.startsWith(POSSESS_PREFIX)) return null;
  const id = action.slice(POSSESS_PREFIX.length);
  return id in CREATURE_SPECIES ? (id as CreatureId) : null;
}

/** The right-thumb cluster's held buttons, by what they mean to `control/PlayerDemand.LabButtons`. */
export type LabButtonKind = 'up' | 'down' | 'primary' | 'secondary' | 'sprint';

export const LAB_BUTTON_KINDS: readonly LabButtonKind[] = Object.freeze(['up', 'down', 'primary', 'secondary', 'sprint']);

export const LAB_BUTTON_ACTION: Readonly<Record<LabButtonKind, string>> = Object.freeze({
  up: 'lab:btn:up',
  down: 'lab:btn:down',
  primary: 'lab:btn:a',
  secondary: 'lab:btn:b',
  sprint: 'lab:btn:sprint',
});

/** Every readout line, by `data-field`. The per-creature blocks are `creatureField`. */
export const LAB_FIELD = {
  control: 'lab-control',
  predation: 'lab-predation',
  camera: 'lab-camera',
  cameraDisturbs: 'lab-camera-disturbs',
  disturb: 'lab-disturb',
  debug: 'lab-debug',
  fps: 'lab-fps',
  frameMs: 'lab-frame-ms',
  aiMs: 'lab-ai-ms',
  animMs: 'lab-anim-ms',
  /** The STRESS button's own label: what it is doing, and the count while it does it. */
  stress: 'lab-stress',
  /** The RIGS toggle's label. */
  rigs: 'lab-rigs',
  /** The live line while a run is going, and the finished report when it is done. */
  stressReport: 'lab-stress-report',
} as const;

/** The debug overlay's block for a species: `lab-earthworm`. */
export function creatureField(species: CreatureId): string {
  return `lab-${species}`;
}

/** The possess row, in the brief's order and with the brief's labels: [QUEEN][WORKER][WORM][APHID][FLY]. */
export const POSSESS_ROW: readonly { readonly species: CreatureId; readonly label: string }[] = Object.freeze([
  Object.freeze({ species: 'queen' as CreatureId, label: 'QUEEN' }),
  Object.freeze({ species: 'worker' as CreatureId, label: 'WORKER' }),
  Object.freeze({ species: 'earthworm' as CreatureId, label: 'WORM' }),
  Object.freeze({ species: 'aphid' as CreatureId, label: 'APHID' }),
  Object.freeze({ species: 'housefly' as CreatureId, label: 'FLY' }),
]);

/** What the CONTROL line reads: the held species' name in capitals, or the observer words. */
export const OBSERVE_LABEL = 'CONTROL: NONE (OBSERVE)';

export function controlLabel(held: CreatureSpecies | null): string {
  return held === null ? OBSERVE_LABEL : `CONTROL: ${held.name.toUpperCase()}`;
}

/** OFF → NORMAL → FORCE → OFF. The lab starts at OFF: "a stable ecology lab" first (brief §25). */
export const PREDATION_ORDER: readonly PredationPolicy[] = Object.freeze(['off', 'normal', 'force']);

export function nextPredation(policy: PredationPolicy): PredationPolicy {
  const i = PREDATION_ORDER.indexOf(policy);
  return PREDATION_ORDER[(i + 1) % PREDATION_ORDER.length];
}

export function predationLabel(policy: PredationPolicy): string {
  return `PREDATION: ${policy.toUpperCase()}`;
}

export type LabCameraMode = 'follow' | 'free';

export function cameraLabel(mode: LabCameraMode): string {
  return mode === 'follow' ? 'CAMERA: FOLLOW' : 'CAMERA: FREE';
}

export function onOffLabel(name: string, on: boolean): string {
  return `${name}: ${on ? 'ON' : 'OFF'}`;
}

/**
 * Which of the five held buttons a body can honour. Mirrors the seam:
 * `verticalFor` reads UP/DOWN for soil, air and a winged ground species
 * and ignores them for plant and a wingless walker; `wordFor` reads
 * `secondary` as LAND for a flier in the air and as DROP for a plant
 * creature and as nothing for anyone else; `primary` is FEED for every
 * medium; SPRINT is the flee pace for every medium.
 */
export function buttonsFor(medium: Medium, winged: boolean): readonly LabButtonKind[] {
  switch (medium) {
    case 'soil':
      return SOIL_BUTTONS;
    case 'air':
      return AIR_BUTTONS;
    case 'plant':
      return PLANT_BUTTONS;
    case 'ground':
      return winged ? AIR_BUTTONS : GROUND_BUTTONS;
    default:
      return GROUND_BUTTONS;
  }
}

const SOIL_BUTTONS: readonly LabButtonKind[] = Object.freeze(['up', 'down', 'primary', 'sprint']);
const AIR_BUTTONS: readonly LabButtonKind[] = Object.freeze(['up', 'down', 'primary', 'secondary', 'sprint']);
const PLANT_BUTTONS: readonly LabButtonKind[] = Object.freeze(['primary', 'secondary', 'sprint']);
const GROUND_BUTTONS: readonly LabButtonKind[] = Object.freeze(['primary', 'sprint']);

/** What a button says for a medium: the species decides what a toggle means (`input/Intent.ts`), so the label follows the medium. */
export function buttonLabel(kind: LabButtonKind, medium: Medium): string {
  switch (kind) {
    case 'up':
      return medium === 'soil' ? 'SURFACE' : 'UP';
    case 'down':
      return medium === 'soil' ? 'BURROW' : 'DOWN';
    case 'primary':
      return 'A · FEED';
    case 'secondary':
      return medium === 'plant' ? 'B · DROP' : 'B · LAND';
    case 'sprint':
      return 'SPRINT';
    default:
      return kind;
  }
}

/** The DISTURB tool's footprint, world units: 5 cm. GAME TUNING (the brief, §30): a hand's width, felt by the whole bench end it lands in. */
export const DISTURB_RADIUS = 5;

/** The camera's presence when it disturbs, world units: the Performance World's `EYE_PRESENCE`, so the same eye means the same thing on the island and on the bench. */
export const CAMERA_PRESENCE = 10;

/** A press that travels further than this, in CSS pixels, is a drag and not a tap. GAME TUNING: a thumb's wobble. */
export const TAP_SLOP_PX = 12;

/** The lab HUD's refresh rate: readable, and cheap in the scene measuring the animals. */
export const HUD_HZ = 10;

// ---------------------------------------------------------------------------
// The stress test's words (Joshua, 2026-09-10)
// ---------------------------------------------------------------------------

/**
 * WHICH SKELETONS A RUN LENDS. `all` gives every creature its own
 * animated rig — what "fully active" means when every animal is within
 * a metre of the camera — and `rung` leaves the detail ladder's budget
 * alone, so everything past it draws as an impostor. The two answer
 * different questions and the report says which was asked
 * (`lab/stressTest.stressReport`).
 */
export type LabRigMode = 'all' | 'rung';

export function nextRigMode(mode: LabRigMode): LabRigMode {
  return mode === 'all' ? 'rung' : 'all';
}

export function rigModeLabel(mode: LabRigMode): string {
  return `RIGS: ${mode === 'all' ? 'ALL' : 'RUNG'}`;
}

/**
 * What the STRESS button says. Idle it offers the run; running it offers
 * to stop it and counts what is on the bench; done it says so, and the
 * panel below it carries the report and RUN AGAIN.
 */
export function stressLabel(phase: string, creatures: number): string {
  switch (phase) {
    case 'warmup':
      return 'STRESS: WARMING UP';
    case 'spawning':
      return `STOP (${creatures})`;
    case 'recovery':
      return `STRESS: SETTLING (${creatures})`;
    case 'done':
      return 'STRESS: DONE';
    default:
      return 'STRESS TEST';
  }
}
