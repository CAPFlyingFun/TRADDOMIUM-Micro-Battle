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
  /** POOL: the species the next run draws from — MIX, or one species alone (`nextStressPool`). */
  stressPool: 'lab:stress-pool',
} as const;

export type LabAction = (typeof LAB_ACTION)[keyof typeof LAB_ACTION];

/**
 * WHAT A STRESS RUN HOLDS STILL, and therefore what the Lab refuses
 * while one is going (Joshua: "Keep the player/camera in the normal test
 * position so each run is comparable").
 *
 * It lives here rather than in the scene because BOTH halves of the
 * refusal need it and they may not import each other: the scene ignores
 * these actions, and the HUD greys them so the refusal is visible rather
 * than felt as a dead tap.
 *
 * Every entry is something `startStress` deliberately sets. The list
 * exists because Baseline B (alpha.42) printed a predation setting the
 * run had not been started with — the button worked, mid-run, and the
 * run stopped being comparable to the one before it without saying so.
 *
 * OBSERVE is deliberately absent: it only re-asserts what the run
 * already holds. STOP, COPY, RUN AGAIN, RESET and Back to hub are absent
 * because leaving or ending a run is always allowed.
 */
export const HELD_DURING_A_RUN: readonly LabAction[] = Object.freeze([
  LAB_ACTION.camera, LAB_ACTION.predation, LAB_ACTION.disturb, LAB_ACTION.cameraDisturbs,
  LAB_ACTION.reset, LAB_ACTION.debug, LAB_ACTION.rigs,
]);

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
  /** The POOL toggle's label: which species the next run draws from. */
  stressPool: 'lab-stress-pool',
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
/**
 * WHAT THE LADDER IS ALLOWED THIS RUN — and on this bench the answer to
 * "allowed" is always ALL OF IT.
 *
 * `all` is one animated skeleton per creature, whatever its distance:
 * Baselines A and C's question, "how many fully active insects can this
 * room hold". `lod` is the three tiers decided by DISTANCE ALONE — a
 * full rig inside `LOD0_IN`, the real mesh with its bones held still out
 * to `LOD1_OUT`, the impostor past that — with NO budget capping any of
 * them.
 *
 * It used to read RUNG and mean "the detail rung's pools", which is 13
 * full rigs and 26 frozen meshes at medium. Joshua, 2026-09-11: "Remove
 * any limits because it is a stress test, and if you keep adding rules,
 * how can I actually get the correct numbers?" A bench that stops at
 * thirteen measures thirteen; the phone never gets asked. The word
 * changed with the behaviour, because a button reading RUNG over a run
 * with no rung budget in it would be the lie the labels exist to stop.
 */
export type LabRigMode = 'all' | 'lod';

export function nextRigMode(mode: LabRigMode): LabRigMode {
  return mode === 'all' ? 'lod' : 'all';
}

export function rigModeLabel(mode: LabRigMode): string {
  return `RIGS: ${mode === 'all' ? 'ALL' : 'LOD'}`;
}


/**
 * A RUN'S SPECIES POOL: every species mixed, or one species alone.
 *
 * Joshua, 2026-09-10, after the mixed run gave the first density number:
 * he wants workers only, queens only, flies only, aphids only and worms
 * only, to find which animal is the expensive one. A mixed run cannot
 * answer that — the seeded draw hands out roughly a fifth of each, so a
 * species five times the cost of the others moves the total by less than
 * the noise between two builds.
 *
 * `mix` is not a `CreatureId` and never can be (`creatures/species.ts`
 * lists the five), so the union needs no tag.
 */
export type StressPool = 'mix' | CreatureId;

/** MIX → the first species → ... → the last → MIX. An id the lab does not run falls back to MIX. */
export function nextStressPool(pool: StressPool, ids: readonly CreatureId[]): StressPool {
  if (ids.length === 0) return 'mix';
  if (pool === 'mix') return ids[0];
  const i = ids.indexOf(pool);
  if (i < 0) return 'mix';
  return i + 1 < ids.length ? ids[i + 1] : 'mix';
}

/**
 * THE BUTTON'S TEXT, which is why it is short: it sits in the stress row
 * on a phone in landscape beside STRESS and RIGS. The species id in
 * capitals, except `earthworm`, which is four letters longer than the
 * row can spare and is WORM everywhere else in this file
 * (`POSSESS_ROW`).
 */
export function stressPoolLabel(pool: StressPool): string {
  if (pool === 'mix') return 'POOL: MIX';
  return `POOL: ${pool === 'earthworm' ? 'WORM' : pool.toUpperCase()}`;
}

/**
 * THE REPORT'S WORDS, which is why they are not the button's. A pasted
 * report outlives the conversation that produced it and is read by
 * someone who never saw the row, so the species' REAL id goes in —
 * `earthworm only`, not `WORM only`, which could be any of several
 * animals a year from now.
 */
export function stressPoolWords(pool: StressPool): string {
  return pool === 'mix' ? 'all five, mixed' : `${pool} only`;
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
