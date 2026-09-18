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
  fps: 'tombs-fps',
  /** Where the camera is, in the PLAN'S metres, so a reading can be checked against the floor plan without arithmetic. */
  pos: 'tombs-pos',
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
