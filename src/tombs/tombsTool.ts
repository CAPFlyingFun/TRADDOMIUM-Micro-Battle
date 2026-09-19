/**
 * THE TOMBS LABORATORY'S ENTRY IN THE EDITORS / DEV TOOLS HUB, and the
 * names its controls and readouts answer to.
 *
 * A plain record, like `lab/labTool.ts`, `perf/perfTool.ts` and
 * `devtools/netLabTool.ts`: the tool IS a scene, and the hub opens it by
 * asking the SceneManager for `sceneId`. The id is deliberately NOT
 * under the `world:` prefix — a world scene is entered through the
 * loading screen with a solo session behind it, and this one holds no
 * session at all. It is one building, standing on nothing, opened in the
 * `menu` state like the Creature Lab, with a BACK control rather than a
 * pause menu.
 *
 * WHY THE TOOL EXISTS. `world/tombs` has planned the building and
 * `tombs/LabView` has drawn it since 2026-09-18, and `npm run probe:tombs`
 * photographs it — but nothing in the APP opened it, so the one person
 * who has to judge whether a corridor feels like a corridor could not
 * walk into it from his phone. This is that door, and nothing more: a
 * free camera at a person's eye height, the lever, the array and a way
 * to stand in each of the six rooms.
 *
 * EVERY CONTROL AND EVERY READOUT IS NAMED HERE, so a test and a probe
 * drive the buttons a player presses and read the words a player reads
 * (`app/actions.ts`'s rule) — and so the scene, its HUD and the tests
 * cannot drift apart on a string. `labTool.ts` earned that rule and this
 * file follows it: the scene imports these names and writes none of its
 * own.
 *
 * THE LEVER IS THE POINT, and its LABEL SAYS WHAT PULLING IT WILL DO
 * while the `tombs-lighting` line says what the room is doing now. Two
 * different jobs — a control announces an action, a readout reports a
 * state — and the one time they were the same word (a button reading
 * "EMERGENCY" over a room already in it) nobody could tell which of the
 * two it meant. Chapter 2: "He pulled the physical shutdown lever, and
 * the room went dark… The emergency lights switched on."
 *
 * Pure: no three, no DOM. It reads `world/tombs`'s types for a room id
 * and a lighting mode and nothing else, so it is testable in plain node.
 */
import type { DevTool } from '../devtools/DevTool';
import type { LightMode, RoomId } from '../world/tombs/types';

/** The registry id the integration pass binds to `createTombsLabScene`. */
export const TOMBS_SCENE_ID = 'lab:tombs';

/** The tool's id: it becomes the hub card's OPEN action, `tool:lab.tombs` (`devtools/DevTool.toolAction`). */
export const TOMBS_TOOL_ID = 'lab.tombs';

export const tombsTool: DevTool = {
  id: TOMBS_TOOL_ID,
  title: 'TOMBS Laboratory',
  description:
    "The building from chapters 1-3, walked at eye height: Jack's laboratory, the corridor, the main control room, "
    + 'the array chamber behind the reinforced port, and the plant. Pull the shutdown lever, turn the array, step '
    + 'between the rooms. The island is not in this scene — the building stands on its own floor.',
  sceneId: TOMBS_SCENE_ID,
};

/** The `data-role` of the HUD's root element: what a probe waits for to know the laboratory is up. */
export const TOMBS_HUD_ROLE = 'tombs-lab-hud';

/**
 * The laboratory's own controls, as `data-action` names. Prefixed so
 * they can never collide with the app's vocabulary (`app/actions.ts`);
 * BACK is this scene's own rather than the app's shared one, because a
 * tool scene's only way out is the hub and naming it here keeps the
 * whole control surface in one file.
 */
export const TOMBS_ACTION = {
  /** Leave for the hub. Escape does the same thing. */
  back: 'tombs:back',
  /** THE PHYSICAL SHUTDOWN LEVER (ch 2): normal lighting ⇄ emergency lighting. */
  lever: 'tombs:lever',
  /** The array's five articulated rings: turning, or at rest (ch 2, ch 3). */
  array: 'tombs:array',
  /** Stand up and walk, or go back to flying the camera. */
  walk: 'tombs:walk',
  /** Hold the run ceiling on, for a thumb that has no shift key. */
  run: 'tombs:run',
  /**
   * Do the thing that is in reach. Offered ONLY when something is —
   * a control that is always there and usually does nothing is exactly
   * the unavailable action that must never look functional.
   */
  interact: 'tombs:interact',
  /**
   * Play the chapter-1 sample, AND — the part that matters on a phone —
   * be the user gesture that unlocks the AudioContext. iOS starts one
   * suspended and will only resume it inside a real tap, so the first
   * press of this button is the difference between audio and silence.
   */
  audio: 'tombs:audio',
} as const;

export type TombsAction = (typeof TOMBS_ACTION)[keyof typeof TOMBS_ACTION];

const TELEPORT_PREFIX = 'tombs:teleport:';

/** The room row's action for a room: `tombs:teleport:chamber`. */
export function teleportAction(room: RoomId): string {
  return `${TELEPORT_PREFIX}${room}`;
}

/**
 * The room a teleport action names, or null for any other string.
 *
 * The rooms are passed IN rather than listed here on purpose. The plan
 * is the one place the building's rooms are written down
 * (`world/tombs/plan.LAB_SPEC`), and a second list in this file would be
 * a table to keep in step with it — exactly what the plan's own header
 * warns against. The caller has a layout in its hands already.
 */
export function teleportedRoomOf(action: string, rooms: readonly RoomId[]): RoomId | null {
  if (!action.startsWith(TELEPORT_PREFIX)) return null;
  const id = action.slice(TELEPORT_PREFIX.length);
  for (const room of rooms) if (room === id) return room;
  return null;
}

/** Every readout line, by `data-field`. */
export const TOMBS_FIELD = {
  /** Which room the camera is standing in, by the plan's own name for it — or `outside`. */
  room: 'tombs-room',
  /** Which lighting set is live: what the lever has left the building in. */
  lighting: 'tombs-lighting',
  /** Whether the array's rings are turning. */
  array: 'tombs-array',
  /** `LabView.stats.drawCalls`: what the building costs to submit. */
  draws: 'tombs-draws',
  /** How many people are standing in the building, and how many are stand-ins. */
  people: 'tombs-people',
  fps: 'tombs-fps',
  /** Where the camera is, in the PLAN'S metres, so a reading can be checked against the floor plan without arithmetic. */
  pos: 'tombs-pos',
  /** Whether a body is being walked or the camera is being flown, and what the body is doing. */
  mode: 'tombs-mode',
  /** What is in reach, in the plan's own words — or empty when nothing is. */
  prompt: 'tombs-prompt',
  /** The audio: whether the context is running, what is decoded, what is playing. */
  audio: 'tombs-audio',
} as const;

/** What the room line reads when the camera is in none of them — outside the building, or inside a wall. */
export const OUTSIDE_ROOM = 'outside';

export function roomLine(name: string): string {
  return `ROOM: ${name}`;
}

export function lightingLine(mode: LightMode): string {
  return `LIGHTING: ${mode.toUpperCase()}`;
}

export function arrayLine(running: boolean): string {
  return `ARRAY: ${running ? 'RUNNING' : 'AT REST'}`;
}

export function drawsLine(drawCalls: number): string {
  return `draws ${Math.max(0, Math.round(drawCalls))}`;
}

/**
 * WHO IS ACTUALLY IN THE ROOM.
 *
 * The draw count cannot answer this — it reads `LabView.stats`, which is
 * the BUILDING and has never included a body. So a laboratory with two
 * unreachable models in it printed exactly what a laboratory with two
 * people in it printed, which is how "I don't see any Jack or Sarah in
 * the Lab" went unnoticed on this side.
 *
 * `missing` is named separately for the same reason: a line reading
 * "2 standing" with two magenta capsules in the room is not a reading.
 */
export function peopleLine(standing: number, missing: number): string {
  const n = Math.max(0, Math.round(standing));
  const gone = Math.max(0, Math.round(missing));
  if (n === 0) return 'nobody here';
  return gone > 0 ? `${n} standing, ${gone} missing` : `${n} standing`;
}

export function fpsLine(fps: number): string {
  return `${Number.isFinite(fps) ? Math.round(fps) : 0} fps`;
}

/** The camera's place in LOCAL METRES — the plan's frame, floor at y = 0 (`world/tombs/types.ts`, rule 2). */
export function posLine(x: number, y: number, z: number): string {
  const n = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '—');
  return `at ${n(x)}, ${n(y)}, ${n(z)} m`;
}

/**
 * THE LEVER'S LABEL: what pulling it will DO, never what the room is
 * doing. `tombs-lighting` reports the state; this offers the action.
 */
export function leverLabel(mode: LightMode): string {
  return mode === 'normal' ? 'PULL SHUTDOWN LEVER' : 'RESTORE MAIN POWER';
}

/** Same rule as the lever: the button offers the change, the line reports the state. */
export function arrayLabel(running: boolean): string {
  return running ? 'STOP ARRAY' : 'START ARRAY';
}

/**
 * WALKING OR FLYING, and what the body is doing while it walks.
 *
 * Two facts on one line because they are one question — "is a person
 * standing in this building, and is he moving" — and because the stance
 * is the only outward sign that the gait is running at all. A pose bug
 * shows up here as a body that reports `walk` and stands still.
 */
export function modeLine(walking: boolean, stance: string): string {
  return walking ? `MODE: WALKING (${stance})` : 'MODE: FLYING';
}

/** Same rule as the lever: the button offers the change, `tombs-mode` reports the state. */
export function walkLabel(walking: boolean): string {
  return walking ? 'FLY THE CAMERA' : 'STAND AND WALK';
}

/** And again: pressing it starts running, or stops. */
export function runLabel(running: boolean): string {
  return running ? 'STOP RUNNING' : 'RUN';
}

/**
 * WHAT IS IN REACH, in the plan's own words — `Interaction.prompt`,
 * which already reads "Read the diagnostic data" rather than
 * "use:jack-workstation".
 *
 * Empty when nothing is in reach, and the INTERACT control is hidden
 * with it. A prompt line that always said something would be a line
 * nobody reads, and a button that is always there and usually does
 * nothing is the unavailable action the standing rule forbids.
 */
export function promptLine(prompt: string | null): string {
  return prompt === null || prompt.length === 0 ? '' : prompt;
}

/** The INTERACT control's face: the plan's own label for the thing, or nothing to show. */
export function interactLabel(label: string | null): string {
  return label === null || label.length === 0 ? '' : label.toUpperCase();
}

/**
 * THE AUDIO LINE, and it leads with the LOCK because that is the one
 * state that looks identical to a bug.
 *
 * A phone that has not been tapped has a suspended AudioContext, and a
 * suspended context plays nothing while every counter reads healthy. So
 * `locked` is the first word when the context is not running, and the
 * counts follow — decoded, failed, and what is sounding now. `failed` is
 * printed even at zero for the same reason `peopleLine` prints
 * `missing`: a clip that did not load is a silent no-op by design, and a
 * silent no-op that is never counted is a silent no-op nobody finds.
 */
export function audioLine(running: boolean, decoded: number, failed: number, playing: number): string {
  const n = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const head = running ? 'AUDIO' : 'AUDIO: locked';
  return `${head} ${n(decoded)} decoded, ${n(failed)} failed, ${n(playing)} playing`;
}

/** The sample button's face. It never reports state: pressing it always plays the line. */
export const AUDIO_LABEL = 'PLAY CH.1 LINE';

/** A room button's face: the plan's own name for the room, in capitals. */
export function roomLabel(name: string): string {
  return name.toUpperCase();
}

export const BACK_LABEL = 'Back to hub';

/**
 * A PERSON'S EYE, 1.65 m above the floor. GAME TUNING from ordinary
 * human scale rather than measured anything — the same figure
 * `scripts/probe-tombs.mjs` photographs the building from, kept here so
 * the tool and the probe cannot disagree about how tall the visitor is.
 *
 * It is the height the camera STARTS at and the height every room
 * teleport puts it back to. It is not a constraint: the camera flies.
 * A body that is actually held at this height is the walking controller,
 * which is the next milestone and another file's.
 */
export const EYE_HEIGHT_M = 1.65;

/** The HUD's refresh rate: readable, and cheap in a scene whose whole job is a look around. */
export const TOMBS_HUD_HZ = 10;
