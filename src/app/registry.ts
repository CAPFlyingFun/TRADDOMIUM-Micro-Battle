/**
 * The registry of navigable scenes, keyed by id.
 *
 * Leaf modules EXPORT factories; they do not register themselves, because
 * a module that registers on import is only present when something
 * happens to import it, and the composition root should be able to read
 * the list of what exists. The integration pass registers everything in
 * one place: `registerScenes.ts`, called once from `App.start()`.
 *
 * Pure: a Map and three functions. `world/WorldLoader` resolves worlds
 * through it, so it must never import three or the DOM itself.
 *
 * Re-registering an id REPLACES the factory rather than throwing: Vite's
 * HMR re-evaluates a module on edit, and a registry that throws on the
 * second evaluation makes every dev-server edit a crash.
 */
import type { SceneFactory } from './Scene';

const factories = new Map<string, SceneFactory>();

export function registerScene(id: string, factory: SceneFactory): void {
  factories.set(id, factory);
}

/** Throws on an unknown id, naming what IS registered. */
export function sceneFactory(id: string): SceneFactory {
  const factory = factories.get(id);
  if (!factory) {
    throw new Error(`No scene registered as "${id}" (registered: ${listScenes().join(', ') || 'none'})`);
  }
  return factory;
}

export function listScenes(): string[] {
  return [...factories.keys()].sort();
}
