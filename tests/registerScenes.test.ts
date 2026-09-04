// @vitest-environment jsdom
/**
 * The composition list as facts: every screen ARCHITECTURE §4 names is
 * registered, the menu's EDITORS door and the hub's scene id agree (two
 * modules that may not import each other), and the Performance World is
 * the hub's first tool (§12).
 */
import { describe, expect, it } from 'vitest';
import { registerScenes } from '../src/app/registerScenes';
import { listScenes } from '../src/app/registry';
import { DEVTOOLS_SCENE_ID, NET_LAB_SCENE_ID, listTools, netLabTool } from '../src/devtools';
import { PERF_WORLD_SCENE_ID, perfWorldTool } from '../src/perf/perfTool';
import { SCREEN_ID } from '../src/ui';

registerScenes();

describe('registerScenes', () => {
  it('registers every front-door screen, the loader, the world and the dev-tools hub', () => {
    expect(listScenes()).toEqual(
      expect.arrayContaining([...Object.values(SCREEN_ID), PERF_WORLD_SCENE_ID, DEVTOOLS_SCENE_ID, NET_LAB_SCENE_ID]),
    );
  });

  it("the menu's EDITORS door and the hub's scene id are the same id", () => {
    expect(SCREEN_ID.editors).toBe(DEVTOOLS_SCENE_ID);
  });

  it('lists the Performance World as the first dev tool, opening the registered world scene', () => {
    const [first] = listTools();
    expect(first?.id).toBe(perfWorldTool.id);
    expect(first?.sceneId).toBe(PERF_WORLD_SCENE_ID);
    expect(first?.description.trim().length).toBeGreaterThan(0);
  });

  it('lists the Network Lab after the Performance World, as a plain tool scene (no session, no world: id)', () => {
    const ids = listTools().map((t) => t.id);
    expect(ids.indexOf(netLabTool.id)).toBeGreaterThan(ids.indexOf(perfWorldTool.id));
    expect(listTools().find((t) => t.id === netLabTool.id)?.sceneId).toBe(NET_LAB_SCENE_ID);
    expect(NET_LAB_SCENE_ID.startsWith('world:')).toBe(false);
  });

  it('can run again without duplicating anything (Vite HMR re-evaluates modules)', () => {
    const scenesBefore = listScenes().length;
    registerScenes();
    expect(listScenes().length).toBe(scenesBefore);
    expect(listTools().filter((t) => t.id === perfWorldTool.id)).toHaveLength(1);
  });
});
