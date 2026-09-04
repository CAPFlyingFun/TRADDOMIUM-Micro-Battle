/**
 * Resolves a world descriptor to the scene that builds it.
 *
 * Heavy loading happens inside the target scene's `enter()`, behind the
 * loading screen; this module only answers "which scene". World scenes
 * are registered as `world:<id>`, so the id space cannot collide with the
 * menu, the loader or a dev tool.
 *
 * Pure: it imports the registry (a Map) and nothing from three or the DOM.
 */
import { sceneFactory } from '../app/registry';
import type { SceneFactory } from '../app/Scene';

/**
 * The layers in the order the world plan adds them (ARCHITECTURE §9).
 * Each is a toggle in the performance world so its cost is measurable
 * alone on a real device.
 */
export type WorldLayerId = 'terrain' | 'ocean' | 'freshwater' | 'weather' | 'vegetation' | 'player';

export const WORLD_LAYERS: readonly WorldLayerId[] = [
  'terrain',
  'ocean',
  'freshwater',
  'weather',
  'vegetation',
  'player',
];

export interface WorldDescriptor {
  readonly id: string;
  /** Empty array = the empty world: a grid, a camera, nothing to measure but the loop. */
  readonly layers: readonly WorldLayerId[];
}

export const WORLD_SCENE_PREFIX = 'world:';

export function worldSceneId(id: string): string {
  return `${WORLD_SCENE_PREFIX}${id}`;
}

/** Throws (via the registry) when no scene is registered for the world. */
export function resolveWorld(desc: WorldDescriptor): SceneFactory {
  return sceneFactory(worldSceneId(desc.id));
}
