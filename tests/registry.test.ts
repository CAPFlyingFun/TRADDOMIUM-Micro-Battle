import { describe, expect, it } from 'vitest';
import type { AppScene, SceneFactory } from '../src/app/Scene';
import { listScenes, registerScene, sceneFactory } from '../src/app/registry';
import { resolveWorld, worldSceneId } from '../src/world/WorldLoader';

const stub: SceneFactory = () => ({}) as unknown as AppScene;

describe('scene registry', () => {
  it('throws on an unknown id and names what is registered', () => {
    expect(() => sceneFactory('nowhere')).toThrow(/No scene registered as "nowhere"/);
  });

  it('registers, lists sorted, and resolves', () => {
    registerScene('zeta', stub);
    registerScene('alpha', stub);
    expect(listScenes()).toEqual(expect.arrayContaining(['alpha', 'zeta']));
    expect(listScenes()).toEqual([...listScenes()].sort());
    expect(sceneFactory('alpha')).toBe(stub);
  });

  it('replaces on re-register (HMR re-evaluates modules) instead of throwing', () => {
    const other: SceneFactory = () => ({}) as unknown as AppScene;
    registerScene('alpha', stub);
    registerScene('alpha', other);
    expect(sceneFactory('alpha')).toBe(other);
  });

  it('resolves worlds under the world: prefix and throws for an unregistered world', () => {
    registerScene(worldSceneId('perf-empty'), stub);
    expect(resolveWorld({ id: 'perf-empty', layers: [] })).toBe(stub);
    expect(() => resolveWorld({ id: 'kauai', layers: ['terrain'] })).toThrow(/world:kauai/);
  });
});
