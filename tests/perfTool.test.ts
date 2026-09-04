/**
 * The dev-tool record for the Performance World, and the one fact that
 * matters about its ids: the scene the hub opens is the scene the loading
 * screen resolves for a `perf-empty` session.
 */
import { describe, expect, it } from 'vitest';
import { registerScene } from '../src/app/registry';
import type { SceneFactory } from '../src/app/Scene';
import { PERF_WORLD_MAP_ID, PERF_WORLD_SCENE_ID, perfWorldTool } from '../src/perf/perfTool';
import { resolveWorld, worldSceneId } from '../src/world/WorldLoader';

describe('perfWorldTool', () => {
  it('is the record the dev-tools hub registers', () => {
    expect(perfWorldTool).toEqual({ id: 'perf-world', title: 'Performance World', sceneId: 'world:perf-empty' });
  });

  it('opens the same scene the loading screen resolves for the perf-empty map', () => {
    expect(PERF_WORLD_MAP_ID).toBe('perf-empty');
    expect(PERF_WORLD_SCENE_ID).toBe(worldSceneId(PERF_WORLD_MAP_ID));
    const marker: SceneFactory = () => {
      throw new Error('a marker factory: identity is all this test compares');
    };
    registerScene(perfWorldTool.sceneId, marker);
    expect(resolveWorld({ id: PERF_WORLD_MAP_ID, layers: [] })).toBe(marker);
  });
});
