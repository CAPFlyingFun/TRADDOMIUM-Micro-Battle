/**
 * THE TOMBS LABORATORY'S RENDERER — the building `world/tombs` plans,
 * turned into three.js objects.
 *
 *   labLook.ts   what each surface is made of, what the array's rings
 *                are made of, and how dark the room goes when the
 *                shutdown lever is pulled. Pure: no three, so the
 *                palette is testable in plain node
 *   LabView.ts   the assembly: one InstancedMesh per surface, a torus
 *                per ring, both lamp sets at once, and the ONE place
 *                local metres become world units
 *   LabPeople.ts the two bodies the plan says are in the room, loaded
 *                from `public/models/` and stood at their own desks
 *   tombsTool.ts the Editors / Dev Tools hub entry, the scene id, and
 *                every `data-action` / `data-field` name the laboratory
 *                answers to. Pure: no three, no DOM
 *   TombsLabScene.ts
 *                the door: a free camera at a person's eye height, the
 *                stick, the shutdown lever, the array and a way into
 *                each of the six rooms (three and the DOM)
 *
 * What `terrain/` is to `world/heightfield` and `flora/` to
 * `world/objects`, this is to `world/tombs` (ARCHITECTURE §3): the only
 * place a floor plan meets a mesh. Renderer-side, so three is allowed;
 * `world/tombs` stays three-free and a server can hold the building's
 * collision without a GPU.
 *
 * The scene is a DEV TOOL (ARCHITECTURE §8) and holds no session: the
 * hub opens `TOMBS_SCENE_ID` through the same `SceneManager.goTo`
 * everything else goes through, and the integration pass wires the
 * registration.
 */
export {
  FITTING, FITTING_DARK, FITTING_LIT, LIGHTING, LIGHT_MODES, LOOK, METALLIC, RING_LOOK, SURFACES,
  ambientLevel, lookFor, luminance,
  type FittingLook, type LightingLook, type SurfaceLook,
} from './labLook';
export { LabView, type LabViewOptions, type LabViewStats } from './LabView';
export { LabPeople, type LabPeopleOptions } from './LabPeople';
export {
  BACK_LABEL, EYE_HEIGHT_M, OUTSIDE_ROOM, TOMBS_ACTION, TOMBS_FIELD, TOMBS_HUD_HZ, TOMBS_HUD_ROLE,
  TOMBS_SCENE_ID, TOMBS_TOOL_ID,
  arrayLabel, arrayLine, drawsLine, fpsLine, leverLabel, lightingLine, peopleLine, posLine, roomLabel, roomLine,
  teleportAction, teleportedRoomOf, tombsTool,
  type TombsAction,
} from './tombsTool';
export {
  buildTombsLabScene, createTombsLabScene,
  type TombsLabHooks, type TombsLabScene, type TombsLabSettings, type TombsLabWire,
} from './TombsLabScene';
