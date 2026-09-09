/**
 * THE CREATURE LAB — one cubic metre of bench, five animals living their
 * AI together, the player driving one of them at a time (Joshua's
 * Creature Lab brief). A dev tool: an ordinary scene the hub opens
 * (ARCHITECTURE §8), with no session behind it.
 *
 *   labTool.ts          the tool record, the scene id, and every
 *                       `data-action` / `data-field` name (pure)
 *   labMeshes.ts        the bench drawn: the floor sampled from the
 *                       world's own ground, the block, the plants, the
 *                       litter, the puddle, the bounds, the lights
 *   LabUi.ts            the HUD: possess row, tools, the right thumb's
 *                       held buttons, the per-creature overlay (DOM)
 *   CreatureLabScene.ts the scene and the `CreatureLab` it wraps: the
 *                       bench, the ledger, the simulation, the cameras,
 *                       tap-to-possess and the disturb tool
 *
 * Renderer-side: three and the DOM are allowed. It reads `creatures/`,
 * `control/`, `fauna/`, `input/` and `perf/` and owns none of them.
 */
export {
  LAB_ACTION, LAB_BUTTON_ACTION, LAB_BUTTON_KINDS, LAB_FIELD, LAB_HUD_ROLE, LAB_SCENE_ID, LAB_TOOL_ID, OBSERVE_LABEL, POSSESS_ROW,
  PREDATION_ORDER, CAMERA_PRESENCE, DISTURB_RADIUS, HUD_HZ, TAP_SLOP_PX,
  buttonLabel, buttonsFor, cameraLabel, controlLabel, creatureField, creatureLabTool, nextPredation, onOffLabel, possessAction,
  possessedSpeciesOf, predationLabel,
  type LabAction, type LabButtonKind, type LabCameraMode,
} from './labTool';
export { FLOOR_STEP, HORIZON, ROCK_SPOT, TWIG_SPOT, buildLabMeshes, type LabMeshes, type LabOrigin } from './labMeshes';
export { LabUi, blockText, type CreatureLine, type LabReadout, type LabUiHooks } from './LabUi';
export {
  CreatureLab, FREE_START, LAB_SPECIES, buildCreatureLabScene, createCreatureLabScene,
  type CreatureLabHooks, type CreatureLabOptions, type CreatureLabScene, type CreatureLabWire, type LabIdentity,
} from './CreatureLabScene';
