/**
 * The Performance World's entry in the Editors / Dev Tools hub, and the
 * ids that name it.
 *
 * A plain record: the tool IS the scene, and the hub opens it by asking
 * the SceneManager for `sceneId` (§8: "every tool is an ordinary scene").
 * The `DevTool` contract itself (`id`, `title`, `open()`, `close()`,
 * optional `sceneFactory`) lives in devtools/, which is being written in
 * parallel; this object carries the facts that contract is built from so
 * devtools can wrap it without this module importing anything from there —
 * the dependency runs hub → tool, never tool → hub.
 *
 * Pure: the ids live here rather than on the scene so the hub, the session
 * picker and a test can read them without loading three.
 */
import { worldSceneId } from '../world/WorldLoader';

/** The map id a session carries; the loading screen resolves it through `WorldLoader`. */
export const PERF_WORLD_MAP_ID = 'perf-empty';

/** `world:perf-empty` — the registry id the integration pass binds to `createPerformanceWorldScene`. */
export const PERF_WORLD_SCENE_ID = worldSceneId(PERF_WORLD_MAP_ID);

export interface PerfWorldTool {
  readonly id: 'perf-world';
  readonly title: string;
  /** The scene the hub opens for this tool. */
  readonly sceneId: string;
}

export const perfWorldTool: PerfWorldTool = {
  id: 'perf-world',
  title: 'Performance World',
  sceneId: PERF_WORLD_SCENE_ID,
};
